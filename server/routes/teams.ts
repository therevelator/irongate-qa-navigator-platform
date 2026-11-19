import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { assertTeamWrite, assertTeamAnalytics, getOwnedTeam, canManageCompanyData, policyActor } from '../middleware/access';
import { canViewIndividualDevelopers, canManageDepartment, canRequestTeamInsights, canViewTeamMembers } from '../lib/userPolicy';
import { aiLimiter } from '../middleware/rateLimit';
import { groqChatCompletion, parseGroqJson, isGroqConfigured } from '../lib/groq';
import {
  TECH_DEBT_OPEN_WEIGHT_SQL,
  techDebtScoreFromWeight,
  toNum,
  qaStatusFromScore
} from '../lib/metricFormulas';
import {
  assessDeveloper,
  developerMetricsFromRow,
  normaliseDeveloperStatus,
  summariseTeamDevelopers,
  DEVELOPER_RULES_TEXT,
  type DeveloperAssessment
} from '../lib/developerHealth';
import { METRICS_CONFIG, type MetricsConfig } from '../../src/config/metricsConfig';
import { teamMemberCountSql, teamLeadNameSql } from '../lib/teamMembership';
import { teamMembers } from '../lib/assignments';
import { SUPPRESSED_TEXT, privacyInfo } from '../lib/privacy';
import { recordAudit } from '../lib/audit';
import { evaluateLatestSnapshot, kpiHistoryFor, loadDataClock, qaConfidenceJson, type EvalContext, type SnapshotEvaluation } from '../lib/kpiEvaluation';
import { loadIntervals } from '../lib/staleness';
import { loadTargetBook } from '../lib/targets';

const router = express.Router();

async function getTechnicalDebtScore(teamId: string): Promise<number> {
  const summary = await queryOne<any>(
    `SELECT ${TECH_DEBT_OPEN_WEIGHT_SQL} AS open_weight
       FROM technical_debt
      WHERE team_id = ?`,
    [teamId]
  );
  // Shared formula (server/lib/metricFormulas.ts): MIN(100, Σ open severity weights).
  return techDebtScoreFromWeight(summary?.open_weight);
}

// ---------------------------------------------------------------------------
// Rule-based team suggestions: benchmark thresholds from METRICS_CONFIG
// (src/config/metricsConfig.ts, the same thresholds the UI colours use).
//   value within "good"     -> strongpoint
//   between good and warning -> area of improvement, Moderate action
//   beyond "warning"         -> area of improvement, Urgent action
//   null                     -> not measured (neither good nor bad)
// ---------------------------------------------------------------------------
interface TeamBenchmark {
  key: keyof MetricsConfig;
  label: string;
  unit: string;
  digits: number;
  lowerIsBetter: boolean;
  action: { initiative: string; owner: string; timebox: string; kpi: string };
}

const TEAM_BENCHMARKS: TeamBenchmark[] = [
  { key: 'defectEscapeRate', label: 'Defect escape rate', unit: '%', digits: 1, lowerIsBetter: true,
    action: { initiative: 'Run a post-mortem on escaped defects and add regression tests for each root cause', owner: 'Team lead', timebox: '2 weeks', kpi: 'Defect escape rate' } },
  { key: 'changeFailureRate', label: 'Change failure rate', unit: '%', digits: 1, lowerIsBetter: true,
    action: { initiative: 'Review failed changes; add pre-merge checks and staged rollouts for risky changes', owner: 'Release Lead', timebox: '2 weeks', kpi: 'Change failure rate' } },
  { key: 'mttrHours', label: 'Mean time to recovery', unit: ' h', digits: 1, lowerIsBetter: true,
    action: { initiative: 'Write runbooks for the most common incidents and practise one-click rollback', owner: 'DevOps', timebox: '3 weeks', kpi: 'MTTR' } },
  { key: 'testCoverage', label: 'Test coverage', unit: '%', digits: 1, lowerIsBetter: false,
    action: { initiative: 'Add tests for the least-covered critical modules and enforce coverage on new code', owner: 'Team lead', timebox: '1 sprint', kpi: 'Test coverage' } },
  { key: 'defectDensity', label: 'Defect density', unit: ' /KLOC', digits: 3, lowerIsBetter: true,
    action: { initiative: 'Identify the modules with the most defects and schedule focused review/refactoring', owner: 'Tech Lead', timebox: '1 sprint', kpi: 'Defect density' } },
  { key: 'testFlakinessRate', label: 'Test flakiness', unit: '%', digits: 1, lowerIsBetter: true,
    action: { initiative: 'Quarantine flaky tests, fix the top offenders and track flakiness per test', owner: 'Team lead', timebox: '3 weeks', kpi: 'Test flakiness rate' } },
  { key: 'automationCoverage', label: 'Automation coverage', unit: '%', digits: 1, lowerIsBetter: false,
    action: { initiative: 'Automate the highest-value manual regression cases', owner: 'Team lead', timebox: '1 sprint', kpi: 'Automation coverage' } },
  { key: 'codeQualityScore', label: 'Code quality score', unit: '/100', digits: 0, lowerIsBetter: false,
    action: { initiative: 'Fix the top static-analysis findings and add a quality gate to CI', owner: 'Tech Lead', timebox: '2 weeks', kpi: 'Code quality score' } },
  { key: 'avgBuildTimeMinutes', label: 'Build time', unit: ' min', digits: 1, lowerIsBetter: true,
    action: { initiative: 'Profile the build; add caching and parallelise slow steps', owner: 'DevOps', timebox: '4 weeks', kpi: 'Average build time' } },
  { key: 'leadTimeDays', label: 'Lead time for changes', unit: ' days', digits: 1, lowerIsBetter: true,
    action: { initiative: 'Shrink batch size and remove waiting steps between merge and deploy', owner: 'Tech Lead', timebox: '1 sprint', kpi: 'Lead time' } },
  { key: 'deploymentFrequencyPerWeek', label: 'Deployment frequency', unit: '/week', digits: 1, lowerIsBetter: false,
    action: { initiative: 'Automate the release pipeline so small changes can ship independently', owner: 'DevOps', timebox: '1 sprint', kpi: 'Deployment frequency' } },
  { key: 'firstTimePassRate', label: 'First-time pass rate', unit: '%', digits: 1, lowerIsBetter: false,
    action: { initiative: 'Run the fast test suite locally/pre-push and clarify acceptance criteria before development', owner: 'Team lead', timebox: '2 weeks', kpi: 'First-time pass rate' } },
  { key: 'sprintCommitmentRate', label: 'Sprint commitment rate', unit: '%', digits: 1, lowerIsBetter: false,
    action: { initiative: 'Plan to measured capacity and split stories that do not fit a sprint', owner: 'Scrum Master', timebox: '1 sprint', kpi: 'Sprint commitment rate' } },
  { key: 'sprintCarryover', label: 'Sprint carryover', unit: '%', digits: 1, lowerIsBetter: true,
    action: { initiative: 'Limit work in progress and review carried-over items at each planning', owner: 'Scrum Master', timebox: '1 sprint', kpi: 'Sprint carryover' } },
  { key: 'blockedTimeHours', label: 'Blocked time', unit: ' h', digits: 1, lowerIsBetter: true,
    action: { initiative: 'Surface blockers daily and agree a same-day escalation path', owner: 'Scrum Master', timebox: '1 week', kpi: 'Blocked time' } },
  { key: 'systemAvailability', label: 'System availability', unit: '%', digits: 3, lowerIsBetter: false,
    action: { initiative: 'Review recent outages and add alerting/redundancy for the weakest components', owner: 'DevOps', timebox: '4 weeks', kpi: 'System availability' } },
  { key: 'technicalDebtScore', label: 'Technical debt score', unit: '/100', digits: 0, lowerIsBetter: true,
    action: { initiative: 'Reserve sprint capacity for the critical and high-severity debt items', owner: 'Tech Lead', timebox: '1 sprint', kpi: 'Technical debt score' } }
];

function buildTeamRuleBasedSuggestions(metrics: Record<string, number | null | string>) {
  const strongpoints: string[] = [];
  const areas: Array<{ text: string; urgent: boolean; action: TeamBenchmark['action'] }> = [];
  const notMeasured: string[] = [];

  for (const b of TEAM_BENCHMARKS) {
    const value = metrics[b.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      notMeasured.push(b.label);
      continue;
    }
    const cfg = METRICS_CONFIG[b.key];
    const isGood = cfg.lowerIsBetter ? value <= cfg.good : value >= cfg.good;
    const isAcceptable = cfg.lowerIsBetter ? value <= cfg.warning : value >= cfg.warning;
    const shown = `${value.toFixed(b.digits)}${b.unit}`;
    const target = `target ${cfg.lowerIsBetter ? '≤' : '≥'} ${cfg.good}${b.unit}`;
    if (isGood) {
      strongpoints.push(`${b.label}: ${shown} (${target})`);
    } else {
      areas.push({ text: `${b.label}: ${shown} (${target})`, urgent: !isAcceptable, action: b.action });
    }
  }

  // Urgent (beyond the warning threshold) first; order within a group follows TEAM_BENCHMARKS.
  areas.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  const actionPlan = areas.slice(0, 5).map((a) => ({
    priority: a.urgent ? 'Urgent' : 'Moderate',
    initiative: a.action.initiative,
    owner: a.action.owner,
    timebox: a.action.timebox,
    kpi: `${a.action.kpi} (currently ${a.text.split(': ')[1]})`
  }));

  return { strongpoints, areasOfImprovement: areas.map((a) => a.text), actionPlan, notMeasured };
}

// Get all teams (with filters and latest metrics)
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { departmentId, companyId } = req.query;
    const userRole = req.user?.role;
    const userId = req.user?.id;
    const userPrimaryTeamId = req.user?.primaryTeamId;

    let sql = `
      SELECT t.*, 
             d.name as department,
             c.name as company_name,
             ${teamLeadNameSql('t')} as team_lead_name,
             ${teamMemberCountSql('t')} as member_count,
             k.qa_score as "qaScore",
             k.status,
             k.test_coverage,
             k.test_flakiness_rate,
             k.defect_density,
             k.defect_escape_rate,
             k.code_quality_score,
             k.avg_build_time_minutes,
             k.test_execution_time_minutes,
             k.deployment_frequency_per_week,
             k.lead_time_days,
             k.mttr_hours,
             k.parallel_test_efficiency,
             k.sprint_velocity,
             k.sprint_commitment_rate,
             k.sprint_carryover,
             k.first_time_pass_rate,
             k.blocked_time_hours,
             k.automation_coverage,
             k.automation_roi,
             k.change_failure_rate,
             k.mtbf_hours,
             k.system_availability,
             k.infrastructure_failures,
             k.sizing_accuracy,
             k.field_sources,
             k.snapshot_date
      FROM teams t
      LEFT JOIN departments d ON t.department_id = d.id
      LEFT JOIN companies c ON t.company_id = c.id
      LEFT JOIN users u ON t.lead_id = u.id
      LEFT JOIN (
        SELECT ks.* FROM kpi_snapshots ks
        INNER JOIN (
          SELECT team_id, MAX(snapshot_date) as max_date
          FROM kpi_snapshots
          GROUP BY team_id
        ) latest ON ks.team_id = latest.team_id AND ks.snapshot_date = latest.max_date
      ) k ON t.id = k.team_id
      WHERE t.is_active = true
    `;

    const params: any[] = [];

    // Filter by company (enforce user's company)
    sql += ' AND t.company_id = ?';
    params.push(req.companyId);

    // Role-based filtering for main dashboard
    // Everyone can see all teams on the dashboard - filtering is optional
    // Only filter by department if a specific departmentId is requested

    if (departmentId) {
      sql += ' AND t.department_id = ?';
      params.push(departmentId);
    }

    sql += ' ORDER BY t.name';

    const teams = await query<any[]>(sql, params);

    // Staleness and targets: one load per request (server/lib/kpiEvaluation.ts).
    const evalCtx: EvalContext = {
      companyId: req.companyId as string,
      intervals: await loadIntervals(req.companyId as string),
      book: await loadTargetBook(req.companyId as string),
    };
    evalCtx.dataClock = await loadDataClock(evalCtx.companyId, evalCtx.intervals);
    const now = Date.now();

    // Transform teams to match frontend format
    // Status of a single headline metric against the target valid at the value's date; null when
    // not recorded or when the value is stale (shown, not judged).
    const metricStatus = (value: number | null, key: string, ev: SnapshotEvaluation | null) => {
      if (value === null) return null;
      if (ev?.staleness[key]?.stale) return null;
      const cfg = ev?.thresholds[key] ?? METRICS_CONFIG[key as keyof MetricsConfig];
      if (cfg.lowerIsBetter) return value <= cfg.good ? 'good' : value <= cfg.warning ? 'warning' : 'critical';
      return value >= cfg.good ? 'good' : value >= cfg.warning ? 'warning' : 'critical';
    };

    const transformedTeams = await Promise.all(teams.map(async team => {
      const technicalDebtScore = await getTechnicalDebtScore(team.id);
      // QA score with stale inputs left out, and what it is based on. A team with no snapshot
      // (or not enough current inputs) has no score — never 0/critical.
      const ev = team.snapshot_date ? evaluateLatestSnapshot(team, { id: team.id, department_id: team.department_id }, evalCtx, now) : null;
      const qaScore = ev ? ev.qa.value : null;
      const status = qaScore === null ? 'no-data' : (ev?.qa.status ?? qaStatusFromScore(qaScore));

      const coverage = toNum(team.test_coverage);
      const density = toNum(team.defect_density);
      const automation = toNum(team.automation_coverage);
      const deploys = toNum(team.deployment_frequency_per_week);
      const staleFlag = (key: string) => (ev?.staleness[key]?.stale ? { stale: true, staleSince: ev.staleness[key].staleSince } : {});

      return {
        id: team.id,
        name: team.name,
        department: team.department || 'Unknown Department',
        department_id: team.department_id,
        platform: team.platform,
        description: team.description,
        qaScore,
        status,
        // The stored snapshot score (every input the snapshot holds, stale ones included).
        qaScoreRecorded: toNum(team.qaScore),
        qaScoreConfidence: ev ? qaConfidenceJson(ev.qa) : null,
        snapshotDate: team.snapshot_date ?? null,
        // Newest value time, and whether it is over a day old (read as of then: "Last updated").
        lastUpdated: ev?.lastUpdated ?? null,
        dataOutdated: ev?.outdated ?? false,
        memberCount: team.member_count || 0,
        teamLead: team.team_lead_name,
        // No sprint history is computed here; the previous random values were removed.
        velocity: [],
        // change/trend are not computed (there is no comparison period here) and are null.
        metrics: [
          {
            id: 'test-coverage',
            name: 'Test Coverage',
            value: coverage,
            unit: '%',
            change: null,
            trend: null,
            status: metricStatus(coverage, 'testCoverage', ev),
            history: [],
            ...staleFlag('testCoverage')
          },
          {
            id: 'defect-density',
            name: 'Defect Density',
            value: density,
            unit: '/1k',
            change: null,
            trend: null,
            status: metricStatus(density, 'defectDensity', ev),
            history: [],
            ...staleFlag('defectDensity')
          },
          {
            id: 'automation-coverage',
            name: 'Automation',
            value: automation,
            unit: '%',
            change: null,
            trend: null,
            status: metricStatus(automation, 'automationCoverage', ev),
            history: [],
            ...staleFlag('automationCoverage')
          },
          {
            id: 'deployment-frequency',
            name: 'Deployments/Week',
            value: deploys,
            unit: '',
            change: null,
            trend: null,
            status: metricStatus(deploys, 'deploymentFrequencyPerWeek', ev),
            history: [],
            ...staleFlag('deploymentFrequencyPerWeek')
          }
        ],
        technicalDebtScore,
        // Estimation accuracy ratio (actual ÷ estimate) from the latest snapshot; null when not recorded.
        taskSizingAccuracy: toNum(team.sizing_accuracy),
        kpiData: {
          testCoverage: team.test_coverage,
          testFlakinessRate: team.test_flakiness_rate,
          defectDensity: team.defect_density,
          defectEscapeRate: team.defect_escape_rate,
          codeQualityScore: team.code_quality_score,
          avgBuildTimeMinutes: team.avg_build_time_minutes,
          testExecutionTimeMinutes: team.test_execution_time_minutes,
          deploymentFrequencyPerWeek: team.deployment_frequency_per_week,
          leadTimeDays: team.lead_time_days,
          mttrHours: team.mttr_hours,
          parallelTestEfficiency: team.parallel_test_efficiency,
          sprintVelocity: team.sprint_velocity,
          sprintCommitmentRate: team.sprint_commitment_rate,
          sprintCarryover: team.sprint_carryover,
          firstTimePassRate: team.first_time_pass_rate,
          blockedTimeHours: team.blocked_time_hours,
          automationCoverage: team.automation_coverage,
          automationRoi: team.automation_roi,
          changeFailureRate: team.change_failure_rate,
          mtbfHours: team.mtbf_hours,
          systemAvailability: team.system_availability,
          infrastructureFailures: team.infrastructure_failures
        },
        // Per-field provenance of the latest snapshot: { column: { source, recorded_at, ... } }.
        kpiFieldSources: team.field_sources ?? {},
        // camelCase KPI key -> { recordedAt, stale, staleSince, source } (server/lib/staleness.ts).
        kpiStaleness: ev?.staleness ?? {},
        // camelCase KPI key -> target valid at the value's date (target history).
        kpiThresholds: ev?.thresholds ?? null,
        // teamKpiTrack / teamAttentionIssues inputs: targets at the values' dates and stale KPIs.
        kpiTargets: ev ? ev.judge.targets : null,
        staleKpis: ev ? Array.from(ev.judge.stale) : [],
        // Any value of the latest snapshot is generated sample data (source 'synthetic').
        sampleData: ev?.sampleData ?? false
      };
    }));
    
    res.json({ teams: transformedTeams });
  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({ error: 'Failed to get teams' });
  }
});

// Get team by ID
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await queryOne<any>(
      `SELECT t.*, 
              d.name as department_name,
              c.name as company_name,
              ${teamLeadNameSql('t')} as team_lead_name
       FROM teams t
       JOIN departments d ON t.department_id = d.id
       JOIN companies c ON t.company_id = c.id
       LEFT JOIN users u ON t.lead_id = u.id
       WHERE t.id = ? AND t.company_id = ?`,
      [req.params.id, req.companyId]
    );

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const technicalDebtScore = await getTechnicalDebtScore(team.id);

    // Get latest KPI snapshot for this team
    const kpiSnapshot = await queryOne<any>(
      `SELECT * FROM kpi_snapshots 
       WHERE team_id = ? 
       ORDER BY snapshot_date DESC 
       LIMIT 1`,
      [req.params.id]
    );

    // Add KPI data to team response. QA score with stale inputs left out (and what it is
    // based on); the stored snapshot score is qaScoreRecorded.
    const evalCtx: EvalContext = {
      companyId: req.companyId as string,
      intervals: await loadIntervals(req.companyId as string),
      book: await loadTargetBook(req.companyId as string),
    };
    evalCtx.dataClock = await loadDataClock(evalCtx.companyId, evalCtx.intervals);
    const ev = kpiSnapshot ? evaluateLatestSnapshot(kpiSnapshot, { id: team.id, department_id: team.department_id }, evalCtx) : null;
    team.qaScore = ev ? ev.qa.value : null;
    team.status = team.qaScore === null ? 'no-data' : (ev?.qa.status ?? qaStatusFromScore(team.qaScore));
    team.qaScoreRecorded = toNum(kpiSnapshot?.qa_score);
    team.qaScoreConfidence = ev ? qaConfidenceJson(ev.qa) : null;
    team.snapshotDate = kpiSnapshot?.snapshot_date ?? null;
    team.lastUpdated = ev?.lastUpdated ?? null;
    team.dataOutdated = ev?.outdated ?? false;
    team.taskSizingAccuracy = toNum(kpiSnapshot?.sizing_accuracy);
    if (kpiSnapshot) {
      team.kpiData = {
        snapshotDate: kpiSnapshot.snapshot_date,
        testCoverage: kpiSnapshot.test_coverage,
        testFlakinessRate: kpiSnapshot.test_flakiness_rate,
        defectDensity: kpiSnapshot.defect_density,
        defectEscapeRate: kpiSnapshot.defect_escape_rate,
        codeQualityScore: kpiSnapshot.code_quality_score,
        avgBuildTimeMinutes: kpiSnapshot.avg_build_time_minutes,
        testExecutionTimeMinutes: kpiSnapshot.test_execution_time_minutes,
        deploymentFrequencyPerWeek: kpiSnapshot.deployment_frequency_per_week,
        leadTimeDays: kpiSnapshot.lead_time_days,
        mttrHours: kpiSnapshot.mttr_hours,
        parallelTestEfficiency: kpiSnapshot.parallel_test_efficiency,
        sprintVelocity: kpiSnapshot.sprint_velocity,
        sprintCommitmentRate: kpiSnapshot.sprint_commitment_rate,
        sprintCarryover: kpiSnapshot.sprint_carryover,
        firstTimePassRate: kpiSnapshot.first_time_pass_rate,
        blockedTimeHours: kpiSnapshot.blocked_time_hours,
        automationCoverage: kpiSnapshot.automation_coverage,
        automationRoi: kpiSnapshot.automation_roi,
        changeFailureRate: kpiSnapshot.change_failure_rate,
        mtbfHours: kpiSnapshot.mtbf_hours,
        systemAvailability: kpiSnapshot.system_availability,
        infrastructureFailures: kpiSnapshot.infrastructure_failures
      };
      team.kpiFieldSources = kpiSnapshot.field_sources ?? {};
      team.kpiStaleness = ev?.staleness ?? {};
      team.kpiThresholds = ev?.thresholds ?? null;
      team.kpiTargets = ev ? ev.judge.targets : null;
      team.staleKpis = ev ? Array.from(ev.judge.stale) : [];
      team.sampleData = ev?.sampleData ?? false;
    }

    team.technicalDebtScore = technicalDebtScore;

    // Team members (names, emails, roles): only for callers who may see the people of this team
    // (canViewTeamMembers in server/lib/userPolicy.ts: super_admin, the QA manager of its
    // department, people assigned to the team). Others get the team and its KPIs only.
    const actor = policyActor(req);
    if (canViewTeamMembers(actor, { id: team.id, department_id: team.department_id })) {
      // Active users with an active role assignment on the team (server/lib/assignments.ts).
      team.members = await teamMembers(req.params.id);
      team.membersHidden = false;
    } else {
      team.members = [];
      team.membersHidden = true;
    }

    res.json({ team });
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ error: 'Failed to get team' });
  }
});

// Toggle AI enabled for a team (admin, manager, or team lead for own team)
router.patch('/:id/ai-toggle', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const teamId = req.params.id;
    
    // Same rule as every other team write (assertTeamWrite): super_admin any team,
    // qa_manager teams in their department, team_lead their own team.
    if (!(await assertTeamWrite(req, res, teamId))) return;

    const { enabled } = req.body;
    
    await query(
      'UPDATE teams SET ai_enabled = ? WHERE id = ? AND company_id = ?',
      [enabled ? 1 : 0, teamId, req.companyId]
    );

    res.json({ success: true, ai_enabled: !!enabled });
  } catch (error) {
    console.error('AI toggle error:', error);
    res.status(500).json({ error: 'Failed to toggle AI' });
  }
});

// Get KPI history for a team (for graphs)
// Scope: the team's analytics scope (assertTeamAnalytics → canViewTeamAnalytics).
// qa_score per day is the score of that day with the inputs that were stale on that day left out
// (qaScoreConfidence per day says what it is based on); targets lists the target periods valid
// in the window (target history) so every day is judged with the target of that day.
router.get('/:id/kpi-history', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const owned = await assertTeamAnalytics(req, res, req.params.id);
    if (!owned) return;
    const { days = '30' } = req.query;
    const numDays = Math.min(parseInt(days as string) || 30, 90);
    const out = await kpiHistoryFor(req.companyId as string, owned, numDays);
    res.json(out);
  } catch (error) {
    console.error('Error fetching KPI history:', error);
    res.status(500).json({ error: 'Failed to fetch KPI history' });
  }
});

// Get AI suggestions for a team (uses Groq API if available, otherwise rule-based fallback)
// Only accessible by team_lead, manager, and super_admin
router.get('/:id/ai-suggestions', aiLimiter, authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Leads of the team, QA managers of its department and super admins (canRequestTeamInsights,
    // server/lib/userPolicy.ts) — checked before any Groq call.
    const owned = await getOwnedTeam(req, req.params.id as string);
    if (!owned || !canRequestTeamInsights(policyActor(req), owned)) {
      return res.status(403).json({
        error: 'AI insights are available to the team’s leads, its department’s managers and administrators',
        restricted: true
      });
    }

    const team = await queryOne<any>(
      `SELECT t.*,
              t.ai_enabled,
              d.name as department_name,
              c.name as company_name,
              ${teamLeadNameSql('t')} as team_lead_name
       FROM teams t
       JOIN departments d ON t.department_id = d.id
       JOIN companies c ON t.company_id = c.id
       LEFT JOIN users u ON t.lead_id = u.id
       WHERE t.id = ? AND t.company_id = ?`,
      [req.params.id, req.companyId]
    );

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // Check if AI is enabled for this team
    if (!team.ai_enabled) {
      return res.json({
        teamId: team.id,
        teamName: team.name,
        aiEnabled: false,
        strongpoints: [],
        areasOfImprovement: [],
        actionPlan: [],
        message: 'AI suggestions are disabled for this team. Enable AI in admin settings.'
      });
    }

    const kpiSnapshot = await queryOne<any>(
      `SELECT * FROM kpi_snapshots 
       WHERE team_id = ? 
       ORDER BY snapshot_date DESC 
       LIMIT 1`,
      [req.params.id]
    );

    if (!kpiSnapshot) {
      return res.status(404).json({ error: 'No KPI data found for this team' });
    }

    const technicalDebtScore = await getTechnicalDebtScore(team.id);

    // Build team metrics payload. Missing values stay null ("not recorded") — never 0.
    const teamMetrics: Record<string, any> = {
      teamName: team.name,
      department: team.department_name,
      snapshotDate: kpiSnapshot.snapshot_date,
      qaScore: toNum(kpiSnapshot.qa_score),
      testCoverage: toNum(kpiSnapshot.test_coverage),
      defectDensity: toNum(kpiSnapshot.defect_density),
      defectEscapeRate: toNum(kpiSnapshot.defect_escape_rate),
      codeQualityScore: toNum(kpiSnapshot.code_quality_score),
      automationCoverage: toNum(kpiSnapshot.automation_coverage),
      deploymentFrequencyPerWeek: toNum(kpiSnapshot.deployment_frequency_per_week),
      leadTimeDays: toNum(kpiSnapshot.lead_time_days),
      mttrHours: toNum(kpiSnapshot.mttr_hours),
      changeFailureRate: toNum(kpiSnapshot.change_failure_rate),
      blockedTimeHours: toNum(kpiSnapshot.blocked_time_hours),
      testFlakinessRate: toNum(kpiSnapshot.test_flakiness_rate),
      sprintCarryover: toNum(kpiSnapshot.sprint_carryover),
      sprintVelocity: toNum(kpiSnapshot.sprint_velocity),
      sprintCommitmentRate: toNum(kpiSnapshot.sprint_commitment_rate),
      firstTimePassRate: toNum(kpiSnapshot.first_time_pass_rate),
      mtbfHours: toNum(kpiSnapshot.mtbf_hours),
      systemAvailability: toNum(kpiSnapshot.system_availability),
      parallelTestEfficiency: toNum(kpiSnapshot.parallel_test_efficiency),
      infrastructureFailures: toNum(kpiSnapshot.infrastructure_failures),
      avgBuildTimeMinutes: toNum(kpiSnapshot.avg_build_time_minutes),
      technicalDebtScore
    };

    const ruleBased = buildTeamRuleBasedSuggestions(teamMetrics);

    // Try Groq (retries on the primary model, then a smaller model, then rule-based)
    if (isGroqConfigured()) {
      try {
        console.log('[AI:Team] Calling Groq API for team suggestions...');
        const benchmarkText = TEAM_BENCHMARKS
          .map((b) => `- ${b.key}: ${b.lowerIsBetter ? '≤' : '≥'}${METRICS_CONFIG[b.key].good} good, ${b.lowerIsBetter ? '≤' : '≥'}${METRICS_CONFIG[b.key].warning} acceptable, otherwise poor`)
          .join('\n');
        const { content, model } = await groqChatCompletion({
          label: 'AI:Team',
          temperature: 0.2,
          maxTokens: 2000,
          messages: [
            {
              role: 'system',
              content: `You are a QA/Engineering advisor. Analyze team metrics and provide actionable insights.

Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:
{
  "strongpoints": ["string array of up to 7 team strengths based on metrics"],
  "areasOfImprovement": ["string array of up to 10 areas needing improvement"],
  "actionPlan": [
    {
      "priority": "Urgent" or "Moderate" or "Low",
      "initiative": "specific action to take",
      "owner": "role responsible (e.g., Team lead, DevOps, Scrum Master)",
      "timebox": "timeframe (e.g., 1 week, 2 weeks, 1 sprint)",
      "kpi": "which metric should improve"
    }
  ]
}

Rules:
- A value of null means the metric was NOT RECORDED. Do not treat it as good or bad; you may suggest recording it.
- Only call a metric a problem when it is outside the "good" benchmark below. A value of 0 for a lower-is-better metric is good.
- Every action plan item must address a metric that is outside its "good" benchmark.

Benchmarks:
${benchmarkText}`
            },
            {
              role: 'user',
              content: `Analyze this team's metrics and provide suggestions:\n\n${JSON.stringify(teamMetrics, null, 2)}`
            }
          ]
        });

        const aiResult = parseGroqJson(content);
        console.log('[AI:Team] Groq responded via', model);

        const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
        const actionPlan = (Array.isArray(aiResult?.actionPlan) ? aiResult.actionPlan : [])
          .filter((a: any) => a && typeof a.initiative === 'string')
          .map((a: any) => ({
            priority: ['Urgent', 'Moderate', 'Low'].includes(a.priority) ? a.priority : 'Moderate',
            initiative: a.initiative,
            owner: typeof a.owner === 'string' ? a.owner : '',
            timebox: typeof a.timebox === 'string' ? a.timebox : '',
            kpi: typeof a.kpi === 'string' ? a.kpi : ''
          }));

        return res.json({
          teamId: team.id,
          teamName: team.name,
          qaScore: teamMetrics.qaScore,
          snapshotDate: kpiSnapshot.snapshot_date,
          aiEnabled: true,
          source: 'groq',
          strongpoints: strings(aiResult?.strongpoints),
          areasOfImprovement: strings(aiResult?.areasOfImprovement),
          actionPlan,
          notMeasured: ruleBased.notMeasured
        });
      } catch (groqError: any) {
        console.error('[AI:Team] Groq unavailable, using rule-based:', groqError.message);
        // Fall through to rule-based fallback
      }
    } else {
      console.log('[AI:Team] Skipping Groq (no or short key), using rule-based suggestions');
    }

    res.json({
      teamId: team.id,
      teamName: team.name,
      qaScore: teamMetrics.qaScore,
      snapshotDate: kpiSnapshot.snapshot_date,
      aiEnabled: true,
      source: 'rule-based',
      strongpoints: ruleBased.strongpoints,
      areasOfImprovement: ruleBased.areasOfImprovement,
      actionPlan: ruleBased.actionPlan,
      notMeasured: ruleBased.notMeasured
    });
  } catch (error) {
    console.error('AI suggestions error:', error);
    res.status(500).json({ error: 'Failed to generate AI suggestions' });
  }
});

// Get AI suggestions for developers in a team.
// Scope: the team must be in the caller's analytics scope (assertTeamAnalytics). Rows:
// super_admin / qa_manager / team_lead get every developer of the team who has not opted
// out; qa_engineer / viewer get only their own row (canViewIndividualDevelopers).
router.get('/:id/developer-ai-suggestions', aiLimiter, authenticateToken, async (req: AuthRequest, res) => {
  try {
    const scopedTeam = await assertTeamAnalytics(req, res, req.params.id);
    if (!scopedTeam) return;
    const seeAll = canViewIndividualDevelopers(policyActor(req), scopedTeam);

    const team = await queryOne<any>(
      `SELECT t.*, t.ai_enabled FROM teams t WHERE t.id = ? AND t.company_id = ?`,
      [req.params.id, req.companyId]
    );

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (!team.ai_enabled) {
      return res.json({
        teamId: team.id,
        aiEnabled: false,
        developers: [],
        message: 'AI suggestions are disabled for this team.'
      });
    }

    // Get developer metrics for this team — only for users who have opted in
    // to developer insights (respect the per-user opt-out; everyone may see their own).
    // Without canViewIndividualDevelopers only the caller's own row is read, so no other
    // person's data reaches the response or the model.
    const developerMetrics = await query<any>(
      `SELECT dm.*,
              (u.first_name || ' ' || u.last_name) as name,
              u.email,
              u.developer_insights_enabled
       FROM developer_metrics dm
       JOIN users u ON dm.developer_id = u.id
       WHERE dm.team_id = ? AND u.company_id = ?
         AND (u.developer_insights_enabled = true OR u.id = ?)
         ${seeAll ? '' : 'AND u.id = ?'}
       ORDER BY u.first_name`,
      seeAll ? [req.params.id, req.companyId, req.user?.id] : [req.params.id, req.companyId, req.user?.id, req.user?.id]
    );

    if (!developerMetrics || developerMetrics.length === 0) {
      return res.json({
        teamId: team.id,
        aiEnabled: true,
        developers: [],
        message: 'No developer metrics found for this team.'
      });
    }

    // Metrics payload: null = not measured (never coerced to 0).
    const devMetricsPayload = developerMetrics.map((row: any) => developerMetricsFromRow(row));

    // Rule-based assessment is always computed: it is the authoritative status
    // and the fallback for any developer the LLM omits or mislabels.
    const ruleAssessments: DeveloperAssessment[] = devMetricsPayload.map(assessDeveloper);

    // Team summary (status counts) is an aggregate of individual data: only opted-in developers
    // count, and only with at least 3 of them (server/lib/privacy.ts). Callers who see only their
    // own row get no team summary.
    const optedIn = new Set(developerMetrics.filter((r: any) => r.developer_insights_enabled === true).map((r: any) => String(r.developer_id)));
    const teamAssessments = seeAll ? ruleAssessments.filter((a) => optedIn.has(String(a.developerId))) : [];
    const teamSummaryPrivacy = privacyInfo(teamAssessments.length);
    const teamInsight = !seeAll || teamAssessments.length === 0
      ? null
      : teamSummaryPrivacy.suppressed
        ? `Team summary ${SUPPRESSED_TEXT.charAt(0).toLowerCase()}${SUPPRESSED_TEXT.slice(1)}.`
        : summariseTeamDevelopers(teamAssessments);

    // Try Groq (retries on the primary model, then a smaller model, then rule-based)
    if (isGroqConfigured()) {
      try {
        console.log('[AI:Developers] Calling Groq API for developer suggestions...');
        const { content, model } = await groqChatCompletion({
          label: 'AI:Developers',
          temperature: 0.2,
          maxTokens: 2000,
          timeoutMs: 15000, // allow longer for multiple devs
          messages: [
            {
              role: 'system',
              content: `You are a developer productivity advisor. Analyze individual developer metrics and provide personalized suggestions.

For each developer, analyze their metrics and provide insights. Return ONLY valid JSON (no markdown) with this structure:
{
  "developers": [
    {
      "developerId": "the developerId from the input",
      "name": "Developer Name",
      "status": "healthy" or "needs-attention" or "at-risk",
      "summary": "One sentence summary of their productivity state",
      "strengths": ["0-3 strengths based on metrics"],
      "concerns": ["0-4 concerns if any"],
      "suggestion": "One or two concrete, actionable recommendations that address the concerns"
    }
  ],
  "teamInsight": "One sentence about overall team developer health"
}

Metric benchmarks (per day unless noted):
- PR Merge Time: <4h excellent, 4-24h acceptable, >24h slow (concern, weight 1)
- Code Review Time: <2h excellent, 2-4h good, >4h slow (concern, weight 1)
- Focus Time: >=5h excellent, 3-5h good, <3h concerning (concern, weight 2)
- Meeting Time: <=2h ideal, 2-4h acceptable, >4h too high (concern, weight 2)
- Context Switches: <=3 excellent, 3-6 acceptable, >6 disruptive (concern, weight 2)
- happinessScore is "workload balance (derived)", 0-100, calculated from the five inputs above. It is NOT a survey or wellbeing score (wellbeing comes only from the anonymous team survey, which is not part of this data) and is NOT a separate concern (that would count the same inputs twice); you may mention it, but do not weight it.

Status rules: "at-risk" if the summed concern weight is 3 or more; "needs-attention" if the summed weight is 1 or 2; "healthy" only when there are no concerns.
A null value means the metric was NOT MEASURED: never treat it as good, and mention that it is missing.
Only give praise (e.g. "keep up the good work") when there are no concerns. When there are concerns, the suggestion must address them (e.g. protect 2-3h focus blocks and batch meetings; set a review SLA or reviewer rotation).`
            },
            {
              role: 'user',
              content: `Analyze these developer metrics and provide suggestions:\n\n${JSON.stringify(devMetricsPayload, null, 2)}`
            }
          ]
        });

        const aiResult = parseGroqJson(content);
        console.log('[AI:Developers] Groq responded via', model);

        const aiDevs: any[] = Array.isArray(aiResult?.developers) ? aiResult.developers : [];
        const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
        const praise = /keep up|good work|great job|well done/i;

        // Merge: status and concerns always come from the rules. The LLM wording is used
        // only when its (normalised) status agrees with the rules and it does not praise a
        // developer who has concerns; otherwise the rule-based entry is used as-is.
        const developers = ruleAssessments.map((rule) => {
          const ai = aiDevs.find((d) => d && (d.developerId === rule.developerId || d.name === rule.name));
          const aiStatus = normaliseDeveloperStatus(ai?.status);
          const aiSuggestion = typeof ai?.suggestion === 'string' ? ai.suggestion.trim() : '';
          const aiSummary = typeof ai?.summary === 'string' ? ai.summary.trim() : '';
          const usable = ai && aiStatus === rule.status && aiSuggestion && aiSummary &&
            !(rule.concerns.length > 0 && praise.test(aiSuggestion));
          if (!usable) return { ...rule, source: 'rule-based' as const };
          return {
            ...rule,
            summary: aiSummary,
            strengths: strings(ai.strengths).slice(0, 3),
            suggestion: aiSuggestion,
            source: 'groq' as const
          };
        });

        return res.json({
          teamId: team.id,
          aiEnabled: true,
          source: 'groq',
          developers,
          teamInsight,
          teamSummaryPrivacy,
          rules: DEVELOPER_RULES_TEXT,
          individualScope: seeAll ? 'team' : 'self',
          metrics: devMetricsPayload
        });
      } catch (groqError: any) {
        console.error('[AI:Developers] Groq unavailable, using rule-based:', groqError.message);
      }
    } else {
      console.log('[AI:Developers] Skipping Groq (no or short key), using rule-based assessment');
    }

    res.json({
      teamId: team.id,
      aiEnabled: true,
      source: 'rule-based',
      developers: ruleAssessments.map((a) => ({ ...a, source: 'rule-based' as const })),
      teamInsight,
      teamSummaryPrivacy,
      rules: DEVELOPER_RULES_TEXT,
      individualScope: seeAll ? 'team' : 'self',
      metrics: devMetricsPayload
    });
  } catch (error) {
    console.error('Developer AI suggestions error:', error);
    res.status(500).json({ error: 'Failed to generate developer AI suggestions' });
  }
});

// Create team
// Validate that a referenced department belongs to the caller's company.
async function departmentInCompany(req: AuthRequest, departmentId?: string | null): Promise<boolean> {
  if (!departmentId) return false;
  return !!(await queryOne<any>('SELECT id FROM departments WHERE id = ? AND company_id = ?', [departmentId, req.companyId]));
}

router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!canManageCompanyData(req)) {
      return res.status(403).json({ error: 'Only managers and super admins can create teams' });
    }
    const { name, description, departmentId, platform, leadId } = req.body;

    if (!name || !departmentId) {
      return res.status(400).json({ error: 'Name and department required' });
    }
    // The department and optional lead must belong to the caller's company.
    if (!(await departmentInCompany(req, departmentId))) {
      return res.status(400).json({ error: 'Invalid department' });
    }
    // The lead is a role assignment (one source of truth): set it with PUT /api/admin/teams/:id/lead.
    if (leadId) {
      return res.status(400).json({ error: 'Set the team lead with PUT /api/admin/teams/:id/lead (Departments page)' });
    }
    // A QA manager can only create teams in a department they manage.
    if (!canManageDepartment(policyActor(req), departmentId)) {
      return res.status(403).json({ error: 'Can only create teams in your department' });
    }

    const [result] = await query<any>(
      `INSERT INTO teams (company_id, department_id, name, description, platform)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id`,
      [req.companyId, departmentId, name, description, platform]
    );
    await recordAudit({
      companyId: req.companyId!, actorId: req.user!.id, action: 'team.create', entityType: 'team', entityId: result.id,
      summary: `Created team ${name}`, after: { name, description: description ?? null, departmentId }, departmentIds: [departmentId], subjectIds: [result.id],
    });

    const team = await queryOne<any>(
      'SELECT * FROM teams WHERE id = ? AND company_id = ?',
      [result.id, req.companyId]
    );

    res.status(201).json({ team });
  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// Update team
router.put('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // Only roles with team-write access may modify a team; also confirms the
    // team is in the caller's company (team_lead limited to own team).
    const owned = await assertTeamWrite(req, res, req.params.id);
    if (!owned) return;

    const { name, description, platform, leadId, isActive } = req.body;
    // The lead is a role assignment (one source of truth): set it with PUT /api/admin/teams/:id/lead.
    if (leadId !== undefined && leadId !== null) {
      return res.status(400).json({ error: 'Set the team lead with PUT /api/admin/teams/:id/lead (Departments page)' });
    }
    const before = await queryOne<any>('SELECT name, description, platform, is_active FROM teams WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);

    await query(
      `UPDATE teams
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           platform = COALESCE(?, platform),
           is_active = COALESCE(?, is_active)
       WHERE id = ? AND company_id = ?`,
      [name, description, platform, isActive, req.params.id, req.companyId]
    );
    const after = await queryOne<any>('SELECT name, description, platform, is_active FROM teams WHERE id = ? AND company_id = ?', [req.params.id, req.companyId]);
    await recordAudit({
      companyId: req.companyId!, actorId: req.user!.id, action: 'team.update', entityType: 'team', entityId: req.params.id,
      summary: `Updated team ${after?.name ?? ''}`, before, after, departmentIds: [owned.department_id], subjectIds: [req.params.id],
    });

    const team = await queryOne<any>(
      'SELECT * FROM teams WHERE id = ? AND company_id = ?',
      [req.params.id, req.companyId]
    );

    res.json({ team });
  } catch (error) {
    console.error('Update team error:', error);
    res.status(500).json({ error: 'Failed to update team' });
  }
});

export default router;
