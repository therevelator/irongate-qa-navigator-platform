import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { assertTeamWrite, assertTeamAnalytics, getOwnedTeam, canManageCompanyData, policyActor, type OwnedTeam } from '../middleware/access';
import { ANALYTICS_ROLES, analyticsScopeLevelOf, analyticsTeamsInScope, canManageSampleData, canManageTeam, isCompanyAdmin, canRequestExecutiveBriefing, canViewTeamAnalytics, canViewIndividualDevelopers, defaultAnalyticsTeamId } from '../lib/userPolicy';
import { aiLimiter } from '../middleware/rateLimit';
import { updateDailyAnalytics } from '../jobs/analyticsSync';
import { runDemoSeed, runFillExisting, isDemoSeeded, teamsLackingData } from '../seeds/demoSeed';
import { demoSummary, todayUtc } from '../seeds/demoData';
import { randomUUID } from 'crypto';
import { groqChatCompletion, isGroqConfigured } from '../lib/groq';
import { KPI_TARGETS, METRICS_CONFIG, teamAttentionIssues, teamKpiTrack } from '../../src/config/metricsConfig';
import { toNum, QA_SCORE_THRESHOLDS, TECH_DEBT_OPEN_WEIGHT_SQL, computeDdps, computeBottleneckScores, composite, distributionOf, COMPANY_AGGREGATE_TEXT, techDebtRoi } from '../lib/metricFormulas';
import { isSyntheticDataEnabled, separateSampleCompanyEnabled } from '../lib/syntheticData';
import { resolveConfigs } from '../lib/configResolver';
import { isTeamMemberSql } from '../lib/assignments';
import { recordAudit } from '../lib/audit';
import { evaluateLatestSnapshot, evaluateSnapshot, loadDataClock, qaConfidenceJson, type EvalContext, type SnapshotEvaluation } from '../lib/kpiEvaluation';
import { loadIntervals, referenceFor } from '../lib/staleness';
import { loadTargetBook } from '../lib/targets';
import { teamMemberCountSql } from '../lib/teamMembership';
import { multiTeamDeveloperSummary, teamDeveloperSummary } from '../lib/developerAggregates';
import { K_ANONYMITY_MIN, privacyInfo } from '../lib/privacy';
import { wellbeingAcrossTeams } from '../lib/pulse';
import { benjaminiHochberg, studentTTwoSidedP } from '../lib/stats';
import { getFinancialConfig } from '../lib/financialConfig';
import { BI_CONTEXT_RANGES, BI_KPI_RANGES, BI_QUALITY_RANGES, DEBT_IMPACT_FIELDS, bulkMonthErrors, dataExceptionMessage, isDataException, parseRangedFields } from '../lib/inputRanges';

const router = express.Router();

/**
 * Analytics scope (audited for the team-scoped Analytics modules).
 *
 * Every team-scoped Analytics endpoint resolves exactly ONE team and checks it with the
 * shared rule canViewTeamAnalytics (server/lib/userPolicy.ts) through assertTeamAnalytics:
 *   super_admin  any team of their company
 *   qa_manager   the teams of the departments they manage
 *   team_lead / qa_engineer / viewer  the teams they are assigned to
 * (all from the caller's role assignments). A team out of scope, of another company or
 * unknown gets 403.
 *
 * teamId: required in principle. When a request carries none, it defaults to the caller's
 * own primary team (and is checked like any other team); a caller with no primary team
 * gets 400 "teamId is required". There is no company-wide ("all teams") mode any more:
 * company-wide figures are served only by /company-summary (dashboard), as before.
 * Writes the error response and returns null when access is denied.
 */
async function resolveAnalyticsTeam(req: any, res: any, requestedTeamId: unknown): Promise<{ teamId: string; team: OwnedTeam } | null> {
  const requested = typeof requestedTeamId === 'string' && requestedTeamId && requestedTeamId !== 'all' ? requestedTeamId : undefined;
  let teamId = requested;
  if (!teamId) {
    // No teamId: the caller's default team of their analytics scope (primary team, else a led
    // team, else the first in scope — as GET /api/analytics/scope); 400 only when none is in scope.
    const actor = policyActor(req);
    const rows = await query<any>('SELECT id, department_id FROM teams WHERE company_id = ? AND is_active = TRUE ORDER BY name', [req.user?.companyId]);
    const inScope = analyticsTeamsInScope(actor, rows.map((r: any) => ({ id: String(r.id), department_id: r.department_id ?? null })));
    const fallback = defaultAnalyticsTeamId(actor, inScope);
    if (!fallback) {
      res.status(400).json({ error: 'teamId is required. Choose a team for this analytics view.' });
      return null;
    }
    teamId = fallback;
  }
  const team = await assertTeamAnalytics(req, res, teamId);
  return team ? { teamId: team.id, team } : null;
}

/** Role gate for Analytics endpoints that are not team-scoped (company-level config). */
function assertAnalyticsRole(req: any, res: any): boolean {
  if (ANALYTICS_ROLES.includes(req.user?.role)) return true;
  res.status(403).json({ error: 'Analytics is not available for your role.' });
  return false;
}

// ============================================================================
// SHARED NUMERIC HELPERS
// ============================================================================

/** Synthetic-data refusal (409) used by every endpoint that generates random data. */
const SYNTHETIC_DISABLED_MESSAGE =
  'Synthetic (sample) data generation is disabled on this server. Start the API with ENABLE_SYNTHETIC_DATA=true to use it.';

/**
 * Parse a DB/body value to a number, keeping 0 as a real value.
 * null / undefined / '' / non-finite -> null (shared definition: metricFormulas.toNum).
 */
const num = (v: any): number | null => toNum(v);

function roundTo(v: number | null, dp = 1): number | null {
  if (v === null) return null;
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

/** Mean of the non-null values; null when there are none (never 0 for "no data"). */
function meanOf(values: Array<number | null>): number | null {
  const xs = values.filter((v): v is number => v !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Weighted mean over the components that have data, re-normalising the weights. */
function weightedMeanOf(parts: Array<{ value: number | null; weight: number }>): number | null {
  const avail = parts.filter(p => p.value !== null);
  const totalWeight = avail.reduce((s, p) => s + p.weight, 0);
  if (!avail.length || totalWeight <= 0) return null;
  return avail.reduce((s, p) => s + (p.value as number) * p.weight, 0) / totalWeight;
}

// ============================================================================
// ANALYTICS SCOPE (department / team selectors of the Analytics pages)
// ============================================================================

/**
 * The departments and teams the caller may choose on the Analytics pages, from the shared
 * rule (analyticsTeamsInScope, server/lib/userPolicy.ts): super_admin every active team of
 * their company, qa_manager the active teams of their department, everyone else their own
 * primary team. `level` says which selectors are editable ('company': department + team,
 * 'department': team only, 'team': read-only). `defaultTeamId` is the caller's primary team
 * when in scope, else the first team in scope (null = nothing in scope: empty state).
 */
router.get('/scope', authenticateToken, async (req: any, res) => {
  try {
    if (!assertAnalyticsRole(req, res)) return;
    const actor = policyActor(req);
    const rows = await query<any>(
      `SELECT t.id, t.name, t.department_id, d.name AS department_name
         FROM teams t
         LEFT JOIN departments d ON d.id = t.department_id
        WHERE t.company_id = ? AND t.is_active = TRUE
        ORDER BY d.name NULLS LAST, t.name`,
      [req.user.companyId]
    );
    type ScopeRow = { id: string; name: string; department_id: string | null; department_name: string | null };
    const teams = analyticsTeamsInScope<ScopeRow>(actor, rows.map((r: any): ScopeRow => ({
      id: String(r.id),
      name: r.name as string,
      department_id: r.department_id ? String(r.department_id) : null,
      department_name: (r.department_name as string | null) ?? null,
    })));
    const departments: Array<{ id: string; name: string }> = [];
    for (const t of teams) {
      if (t.department_id && !departments.some((d) => d.id === t.department_id)) {
        departments.push({ id: t.department_id, name: t.department_name || 'Unnamed department' });
      }
    }
    res.json({
      level: analyticsScopeLevelOf(actor),
      departments,
      teams,
      defaultTeamId: defaultAnalyticsTeamId(actor, teams),
    });
  } catch (error) {
    console.error('Error fetching analytics scope:', error);
    res.status(500).json({ error: 'Failed to fetch analytics scope' });
  }
});

// ============================================================================
// TEST EXECUTION TIMELINE
// ============================================================================

router.get('/test-executions', authenticateToken, async (req: any, res) => {
  try {
    const { companyId, role, primaryTeamId } = req.user;
    const { teamId: requestedTeamId, days = '7' } = req.query;
    const numDays = Math.min(parseInt(days as string) || 7, 30);

    const scope = await resolveAnalyticsTeam(req, res, requestedTeamId);
    if (!scope) return;
    const teamId = scope.teamId;

    let sql = `
      SELECT 
        ter.id,
        ter.test_suite,
        ter.status,
        ter.start_time,
        ter.end_time,
        ter.duration_seconds as duration,
        (u.first_name || ' ' || u.last_name) as assigned_to,
        ter.dependencies
      FROM test_execution_runs ter
      LEFT JOIN users u ON ter.assigned_to = u.id
      WHERE ter.company_id = ?
        AND ter.start_time >= NOW() - CAST(? AS INTEGER) * INTERVAL '1 day'
    `;
    const params: any[] = [companyId, numDays];

    if (teamId) {
      sql += ' AND ter.team_id = ?';
      params.push(teamId);
    }

    sql += ' ORDER BY ter.start_time DESC LIMIT 100';

    const executions = await query<any>(sql, params);

    // Transform to expected format
    const result = executions.map((e: any) => ({
      id: e.id,
      test_suite: e.test_suite,
      status: e.status,
      start_time: e.start_time,
      // Derive the end time from start + duration only when a duration was recorded.
      end_time: e.end_time || (num(e.duration) !== null
        ? new Date(new Date(e.start_time).getTime() + (num(e.duration) as number) * 1000).toISOString()
        : null),
      duration: num(e.duration),
      assigned_to: e.assigned_to || 'Unassigned',
      dependencies: typeof e.dependencies === 'string' ? JSON.parse(e.dependencies) : (e.dependencies || [])
    }));

    res.json({ executions: result });
  } catch (error) {
    console.error('Error fetching test executions:', error);
    res.status(500).json({ error: 'Failed to fetch test executions' });
  }
});

// ============================================================================
// TEST CASE MANAGEMENT
// ============================================================================


// ============================================================================
// FLAKY TEST INTELLIGENCE
// ============================================================================

// ============================================================================
// PRODUCTION: Auto-Classification Engine
// ============================================================================
// When ready for production, uncomment this section and integrate with your
// CI/CD pipeline to automatically classify failure patterns from test logs.
//
// const PATTERN_KEYWORDS = {
//   timing: [
//     'timeout', 'timed out', 'TimeoutError', 'async', 'await', 'Promise',
//     'race condition', 'flaky wait', 'sleep', 'delay exceeded', 'Exceeded timeout'
//   ],
//   environment: [
//     'environment', 'config', 'configuration', 'docker', 'container',
//     'service unavailable', 'connection refused', 'port already in use',
//     'permission denied', 'file not found', 'ENOENT', 'health check'
//   ],
//   data: [
//     'assertion failed', 'expected', 'but got', 'duplicate key', 'constraint',
//     'null', 'undefined', 'NaN', 'fixture', 'seed data', 'database state',
//     'data mismatch', 'stale data'
//   ],
//   network: [
//     'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'fetch failed', 'request timeout',
//     'HTTP 5', 'API error', 'socket hang up', 'SSL', 'certificate', 'network error'
//   ]
// };
//
// function classifyFailurePattern(errorMessage: string): string {
//   const lowerError = errorMessage.toLowerCase();
//   for (const [pattern, keywords] of Object.entries(PATTERN_KEYWORDS)) {
//     if (keywords.some(kw => lowerError.includes(kw.toLowerCase()))) {
//       return pattern;
//     }
//   }
//   return 'unknown';
// }
//
// Endpoint to ingest test results from Jenkins/CI:
// router.post('/flaky-tests/ingest', authenticateToken, async (req: any, res) => {
//   const { testCaseId, status, errorMessage, buildNumber, jenkinsJobUrl } = req.body;
//   const pattern = classifyFailurePattern(errorMessage || '');
//   // Update flaky_tests with new execution and auto-classified pattern
//   // Store errorMessage in last_error_message column for audit
// });
// ============================================================================

router.get('/flaky-tests', authenticateToken, async (req: any, res) => {
  try {
    const { companyId, role, primaryTeamId } = req.user;
    const { teamId: requestedTeamId } = req.query;

    const scope = await resolveAnalyticsTeam(req, res, requestedTeamId);
    if (!scope) return;
    const teamId = scope.teamId;

    let sql = `
      SELECT 
        ft.id,
        ft.test_case_id,
        COALESCE(ft.test_name, tc.name) as test_name,
        ft.flakiness_score,
        ft.failure_pattern,
        ft.failure_count as occurrences,
        ft.pass_count,
        ft.total_runs,
        ft.root_cause,
        ft.suggested_fix,
        ft.last_flaky_at as last_occurrence,
        ft.created_at as first_detected
      FROM flaky_tests ft
      LEFT JOIN test_cases tc ON ft.test_case_id = tc.id
      WHERE (ft.company_id = ? OR tc.team_id IN (SELECT id FROM teams WHERE company_id = ?))
    `;
    const params: any[] = [companyId, companyId];

    if (teamId) {
      sql += ' AND (ft.team_id = ? OR tc.team_id = ?)';
      params.push(teamId, teamId);
    }

    sql += ' ORDER BY ft.flakiness_score DESC NULLS LAST LIMIT 50';

    const flakyTests = await query<any>(sql, params);

    // No rows -> empty list. The UI shows an empty state; nothing is fabricated.
    // Generic guidance per stored failure_pattern label. This is NOT derived from
    // error logs (no log classifier runs), so it is always marked unverified.
    const patternGuidance: Record<string, string> = {
      timing: 'Typical for timing issues: add explicit waits or review timeout thresholds',
      environment: 'Typical for environment issues: ensure consistent environment setup with health checks',
      data: 'Typical for data issues: use isolated fixtures and per-test transactions',
      network: 'Typical for network issues: mock external APIs or add retry logic',
      unknown: 'Collect more failure data to identify a pattern'
    };

    const result = await Promise.all(flakyTests.map(async (ft: any) => {
      // Last 20 recorded executions (not a calendar window)
      const history = await query<any>(`
        SELECT executed_at as date, status
        FROM test_executions
        WHERE test_case_id = ?
        ORDER BY executed_at DESC
        LIMIT 20
      `, [ft.test_case_id || ft.id]);

      const pattern = ft.failure_pattern || 'unknown';
      // The synthetic seeder (analyticsSync) stores canned "... keyword detected in error
      // logs" strings although no log is analysed; those are never treated as verified.
      const rawRootCause = typeof ft.root_cause === 'string' ? ft.root_cause.trim() : '';
      const isCannedRootCause = /keyword detected in error logs$/i.test(rawRootCause) || rawRootCause === 'No matching pattern found';
      const storedRootCause = rawRootCause && !isCannedRootCause ? rawRootCause : null;
      const storedFix = storedRootCause && typeof ft.suggested_fix === 'string' && ft.suggested_fix.trim() ? ft.suggested_fix : null;

      return {
        id: ft.id,
        test_name: ft.test_name || 'Unknown Test',
        flakiness_score: num(ft.flakiness_score),
        failure_pattern: pattern,
        occurrences: num(ft.occurrences),
        pass_count: num(ft.pass_count),
        total_runs: num(ft.total_runs),
        first_detected: ft.first_detected,
        last_occurrence: ft.last_occurrence,
        suggested_fix: storedFix ?? (patternGuidance[pattern] || patternGuidance.unknown),
        root_cause: storedRootCause ?? `Pattern: ${pattern} (unverified, not derived from error logs)`,
        // true only when a person/tool stored a root cause for this test
        root_cause_verified: storedRootCause !== null,
        history: history.map((h: any) => ({
          date: h.date,
          passed: h.status === 'passed'
        }))
      };
    }));

    res.json({ flakyTests: result });
  } catch (error) {
    console.error('Error fetching flaky tests:', error);
    res.status(500).json({ error: 'Failed to fetch flaky tests' });
  }
});

// ============================================================================
// PERFORMANCE TESTING
// ============================================================================

router.get('/performance-metrics', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { days = '30' } = req.query;
    const numDays = Math.min(parseInt(days as string) || 30, 90);
    const scope = await resolveAnalyticsTeam(req, res, req.query.teamId);
    if (!scope) return;
    const teamId = scope.teamId;

    let sql = `
      SELECT 
        pm.id,
        pm.endpoint,
        pm.method,
        pm.response_time_p50_ms as response_time_p50,
        pm.response_time_p95_ms as response_time_p95,
        pm.response_time_p99_ms as response_time_p99,
        pm.throughput_per_minute as throughput,
        pm.error_rate,
        to_char(pm.recorded_date, 'YYYY-MM-DD') as timestamp
      FROM performance_metrics pm
      WHERE pm.company_id = ?
        AND pm.recorded_date >= CURRENT_DATE - CAST(? AS INTEGER)
    `;
    const params: any[] = [companyId, numDays];

    if (teamId) {
      sql += ' AND pm.team_id = ?';
      params.push(teamId);
    }

    sql += ' ORDER BY pm.recorded_date DESC LIMIT 500';

    const metrics = await query<any>(sql, params);

    const result = metrics.map((m: any) => ({
      id: m.id,
      endpoint: m.endpoint,
      method: m.method || null,
      response_time_p50: num(m.response_time_p50),
      response_time_p95: num(m.response_time_p95),
      response_time_p99: num(m.response_time_p99),
      throughput: num(m.throughput), // requests per MINUTE (column throughput_per_minute)
      error_rate: num(m.error_rate),
      // Calendar date ('YYYY-MM-DD'), formatted in SQL so no timezone shift can occur.
      recorded_date: m.timestamp,
      timestamp: m.timestamp
    }));

    res.json({ metrics: result });
  } catch (error) {
    console.error('Error fetching performance metrics:', error);
    res.status(500).json({ error: 'Failed to fetch performance metrics' });
  }
});

// ============================================================================
// DEVELOPER PRODUCTIVITY
// ============================================================================

router.get('/developer-metrics', authenticateToken, async (req: any, res) => {
  try {
    const { companyId, id: userId } = req.user;

    // Individual developer metrics for ONE team in the caller's analytics scope (teamId
    // defaults to the caller's own team). super_admin / qa_manager / team_lead see the
    // team's developers who have not opted out (plus themselves); qa_engineer / viewer
    // see only their own row (canViewIndividualDevelopers, server/lib/userPolicy.ts).
    // Without a teamId, a caller who has no team of their own in scope (e.g. a super admin
    // with no team assignment, as the Users page asks) gets an empty list, not an error.
    const requestedTeam = typeof req.query.teamId === 'string' && req.query.teamId && req.query.teamId !== 'all' ? req.query.teamId : null;
    if (!requestedTeam) {
      const own = req.user?.primaryTeamId ? await getOwnedTeam(req, req.user.primaryTeamId) : null;
      if (!own || !canViewTeamAnalytics(policyActor(req), own)) {
        return res.json({ teamId: null, individualScope: 'none', developers: [], message: 'No team of your own: choose a team to see developer metrics.' });
      }
    }
    const scope = await resolveAnalyticsTeam(req, res, req.query.teamId);
    if (!scope) return;
    const scopeTeamId = scope.teamId;
    const privileged = canViewIndividualDevelopers(policyActor(req), scope.team);

    // One row per (developer, team) recorded in developer_metrics; the team is the
    // team the metrics were recorded for (dm.team_id), not the user's primary team.
    let sql = `
      SELECT 
        dm.developer_id as developer_id,
        dm.team_id,
        t.name as team_name,
        (u.first_name || ' ' || u.last_name) as name,
        dm.code_review_time_avg,
        dm.pr_merge_time_avg,
        dm.happiness_score,
        dm.context_switches_per_day,
        dm.focus_time_hours,
        dm.meeting_time_hours,
        dm.updated_at
      FROM developer_metrics dm
      JOIN users u ON dm.developer_id = u.id
      JOIN teams t ON dm.team_id = t.id
      WHERE t.company_id = ? AND u.company_id = ? AND t.is_active = TRUE
        AND (u.developer_insights_enabled = TRUE OR u.id = ?)
    `;
    const params: any[] = [companyId, companyId, userId];

    sql += ' AND dm.team_id = ?';
    params.push(scopeTeamId);
    if (!privileged) {
      sql += ' AND dm.developer_id = ?';
      params.push(userId);
    }

    sql += ' ORDER BY dm.happiness_score DESC NULLS LAST, u.first_name';

    const metrics = await query<any>(sql, params);

    const result = metrics.map((m: any) => ({
      developer_id: m.developer_id,
      team_id: m.team_id,
      team_name: m.team_name,
      name: m.name,
      code_review_time_avg: num(m.code_review_time_avg),
      pr_merge_time_avg: num(m.pr_merge_time_avg),
      happiness_score: num(m.happiness_score),
      context_switches_per_day: num(m.context_switches_per_day),
      focus_time_hours: num(m.focus_time_hours),
      meeting_time_hours: num(m.meeting_time_hours),
      updated_at: m.updated_at
    }));

    // individualScope: 'team' = every in-scope developer; 'self' = only the caller's own row.
    // summary: the team's averages and burnout counts (server/lib/developerAggregates.ts), only
    // with at least 3 opted-in contributors (server/lib/privacy.ts), for every role in scope.
    const summary = await teamDeveloperSummary(companyId, scopeTeamId);
    res.json({ teamId: scopeTeamId, individualScope: privileged ? 'team' : 'self', developers: result, summary });
  } catch (error) {
    console.error('Error fetching developer metrics:', error);
    res.status(500).json({ error: 'Failed to fetch developer metrics' });
  }
});

// ============================================================================
// TECHNICAL DEBT TRACKER
// ============================================================================

// Financial config (getFinancialConfig, server/lib/financialConfig.ts) and the per-item ROI
// (techDebtRoi, server/lib/metricFormulas.ts) are shared with the revenue impact analysis.
const calculateROI = techDebtRoi;

router.get('/technical-debt', authenticateToken, async (req: any, res) => {
  try {
    const { companyId, role, primaryTeamId } = req.user;
    const { teamId: requestedTeamId, status } = req.query;

    const scope = await resolveAnalyticsTeam(req, res, requestedTeamId);
    if (!scope) return;
    const teamId = scope.teamId;
    if (teamId && !(await getOwnedTeam(req, teamId as string))) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // Get financial config for ROI calculations
    const { config: financialConfig, defaultsUsed } = await getFinancialConfig(companyId, teamId as string);

    let sql = `
      SELECT 
        td.id,
        td.title,
        td.description,
        td.category,
        td.severity,
        td.effort_hours as estimated_effort_hours,
        td.cost_of_delay,
        td.priority_score,
        td.status,
        td.created_at as created_date,
        td.affected_users,
        td.support_tickets_monthly,
        td.downtime_minutes_monthly,
        td.revenue_impact_percent,
        td.sla_breaches_monthly,
        td.source,
        td.manually_edited,
        td.updated_at,
        (u.first_name || ' ' || u.last_name) as assigned_to_name
      FROM technical_debt td
      LEFT JOIN users u ON td.assigned_to = u.id
      WHERE td.company_id = ?
    `;
    const params: any[] = [companyId];

    if (teamId) {
      sql += ' AND td.team_id = ?';
      params.push(teamId);
    }

    if (status) {
      sql += ' AND td.status = ?';
      params.push(status);
    }

    // Severity was a MySQL ENUM, which sorts by declaration order (critical, high, medium, low)
    sql += " ORDER BY td.priority_score DESC NULLS LAST, CASE td.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END DESC LIMIT 100";

    const debts = await query<any>(sql, params);

    const result = debts.map((d: any) => {
      const roi = calculateROI(d, financialConfig);
      const monthlyCostOfDelay = roi.monthlyCost !== null ? Math.round(roi.monthlyCost) : null;

      return {
        id: d.id,
        title: d.title,
        description: d.description || '',
        category: d.category || 'code_quality',
        severity: d.severity,
        estimated_effort_hours: num(d.estimated_effort_hours),
        // Single definition: cost_of_delay is the computed monthly cost of delay (same as
        // monthly_cost_of_delay). The legacy stored td.cost_of_delay column is not used.
        cost_of_delay: monthlyCostOfDelay,
        priority_score: num(d.priority_score),
        status: d.status,
        created_date: d.created_date,
        assigned_to: d.assigned_to_name,
        // Impact metrics
        affected_users: num(d.affected_users),
        support_tickets_monthly: num(d.support_tickets_monthly),
        downtime_minutes_monthly: num(d.downtime_minutes_monthly),
        revenue_impact_percent: num(d.revenue_impact_percent),
        sla_breaches_monthly: num(d.sla_breaches_monthly),
        // Provenance: where the item came from (e.g. 'SonarQube') and whether its impact was edited by hand
        source: d.source ?? null,
        manually_edited: d.manually_edited === true,
        updated_at: d.updated_at ?? null,
        // Calculated ROI fields (null when inputs are missing)
        investment_cost: roi.investment !== null ? Math.round(roi.investment) : null,
        monthly_cost_of_delay: monthlyCostOfDelay,
        annual_savings: roi.annualSavings !== null ? Math.round(roi.annualSavings) : null,
        roi_percentage: roi.roi !== null ? Math.round(roi.roi) : null,
        payback_months: roi.paybackMonths !== null ? Math.round(roi.paybackMonths * 10) / 10 : null
      };
    });

    // Also return the financial config for transparency
    res.json({
      debts: result,
      financial_config: financialConfig,
      // Keys not configured for this company/team; these use built-in defaults.
      financial_config_defaults_used: defaultsUsed
    });
  } catch (error) {
    console.error('Error fetching technical debt:', error);
    res.status(500).json({ error: 'Failed to fetch technical debt' });
  }
});

// Update technical debt impact metrics
router.put('/technical-debt/:id/impact', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    if (!canManageCompanyData(req)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const { id } = req.params;
    // Partial update: only the fields present in the body change (an omitted field keeps its
    // value, an explicit null clears it); every value is range-checked.
    const parsed = parseRangedFields(req.body, DEBT_IMPACT_FIELDS);
    if (parsed.errors.length) return res.status(400).json({ error: parsed.errors[0], details: parsed.errors });
    const given = DEBT_IMPACT_FIELDS.filter((fld) => parsed.values[fld.key] !== undefined);
    if (!given.length) return res.status(400).json({ error: 'Nothing to update' });

    // Verify the debt item belongs to the company
    const existing = await queryOne<any>(
      `SELECT td.id, td.team_id, t.department_id FROM technical_debt td
         LEFT JOIN teams t ON t.id = td.team_id
        WHERE td.id = ? AND td.company_id = ?`,
      [id, companyId]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Technical debt item not found' });
    }
    // A qa_manager may only edit items of teams in their department (canManageTeam).
    if (existing.team_id && !canManageTeam(policyActor(req), { department_id: existing.department_id })) {
      return res.status(403).json({ error: 'Can only manage teams in your department' });
    }

    await query(
      `UPDATE technical_debt SET
        ${given.map((fld) => `${fld.column} = ?`).join(',\n        ')},
        manually_edited = TRUE,
        updated_at = NOW()
      WHERE id = ?`,
      [...given.map((fld) => parsed.values[fld.key]), id]
    );

    res.json({ message: 'Impact metrics updated successfully' });
  } catch (error) {
    if (isDataException(error)) return res.status(400).json({ error: dataExceptionMessage(error) });
    console.error('Error updating technical debt impact:', error);
    res.status(500).json({ error: 'Failed to update impact metrics' });
  }
});

// ============================================================================
// CI/CD PIPELINE INSIGHTS
// ============================================================================

// Default savings assumptions used until an admin saves a pipeline config.
// These are assumptions, not measurements; responses flag them with is_default.
const PIPELINE_CONFIG_DEFAULTS = { time_savings_percent: 30, cost_savings_percent: 25, cost_per_minute: 0.5 };

function toPipelineConfig(row: any | null) {
  return {
    time_savings_percent: num(row?.time_savings_percent) ?? PIPELINE_CONFIG_DEFAULTS.time_savings_percent,
    cost_savings_percent: num(row?.cost_savings_percent) ?? PIPELINE_CONFIG_DEFAULTS.cost_savings_percent,
    cost_per_minute: num(row?.cost_per_minute) ?? PIPELINE_CONFIG_DEFAULTS.cost_per_minute,
    is_default: !row
  };
}

// Get pipeline configuration (read-only: a GET never inserts rows)
router.get('/pipeline-config', authenticateToken, async (req: any, res) => {
  try {
    if (!assertAnalyticsRole(req, res)) return;
    const { companyId } = req.user;

    const config = await queryOne<any>(
      'SELECT * FROM pipeline_config WHERE company_id = ?',
      [companyId]
    );

    res.json({ config: toPipelineConfig(config) });
  } catch (error) {
    console.error('Error fetching pipeline config:', error);
    res.status(500).json({ error: 'Failed to fetch pipeline config' });
  }
});

// Update pipeline configuration. One row per company (a company-wide value): super admin only
// (docs/ROLE_ACCESS.md: company-wide values belong to the super admin).
router.put('/pipeline-config', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    if (!isCompanyAdmin(policyActor(req))) {
      return res.status(403).json({ error: 'Only a super admin can change the company-wide pipeline settings' });
    }
    const { time_savings_percent, cost_savings_percent, cost_per_minute } = req.body;

    // Validate inputs (0 is a valid value; only missing values fall back to the default)
    const timeSavings = Math.min(100, Math.max(0, num(time_savings_percent) ?? PIPELINE_CONFIG_DEFAULTS.time_savings_percent));
    const costSavings = Math.min(100, Math.max(0, num(cost_savings_percent) ?? PIPELINE_CONFIG_DEFAULTS.cost_savings_percent));
    const costPerMin = Math.max(0, num(cost_per_minute) ?? PIPELINE_CONFIG_DEFAULTS.cost_per_minute);

    // Check if config exists
    const existing = await queryOne<any>(
      'SELECT id FROM pipeline_config WHERE company_id = ?',
      [companyId]
    );

    if (existing) {
      await query(
        `UPDATE pipeline_config 
         SET time_savings_percent = ?, cost_savings_percent = ?, cost_per_minute = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE company_id = ?`,
        [timeSavings, costSavings, costPerMin, companyId]
      );
    } else {
      const id = randomUUID();
      await query(
        `INSERT INTO pipeline_config (id, company_id, time_savings_percent, cost_savings_percent, cost_per_minute)
         VALUES (?, ?, ?, ?, ?)`,
        [id, companyId, timeSavings, costSavings, costPerMin]
      );
    }
    await recordAudit({
      companyId, actorId: req.user.id, action: 'config.pipeline', entityType: 'config', entityId: companyId,
      summary: `Pipeline cost settings saved (time savings ${timeSavings} %, cost savings ${costSavings} %, ${costPerMin} per minute)`,
      after: { time_savings_percent: timeSavings, cost_savings_percent: costSavings, cost_per_minute: costPerMin }, subjectIds: [`pipeline-config:${companyId}`],
    });

    res.json({
      success: true,
      config: {
        time_savings_percent: timeSavings,
        cost_savings_percent: costSavings,
        cost_per_minute: costPerMin,
        is_default: false
      }
    });
  } catch (error) {
    console.error('Error updating pipeline config:', error);
    res.status(500).json({ error: 'Failed to update pipeline config' });
  }
});

// Historical pipeline execution trends.
// Units: total_runs / successful_runs / failed_runs count STAGE executions (one row per
// stage run in pipeline_execution_summary), not end-to-end pipeline runs.
// avg_duration_seconds is the mean stage-execution duration for the day, weighted by runs.
router.get('/pipeline-history', authenticateToken, async (req: any, res) => {
  try {
    const { companyId, role, primaryTeamId } = req.user;
    const { days = '14', teamId: requestedTeamId } = req.query;
    const numDays = Math.min(Math.max(parseInt(days as string, 10) || 14, 1), 60);

    const scope = await resolveAnalyticsTeam(req, res, requestedTeamId);
    if (!scope) return;
    const teamId = scope.teamId;
    if (teamId && !(await getOwnedTeam(req, teamId as string))) {
      return res.status(404).json({ error: 'Team not found' });
    }

    let sql = `SELECT 
        to_char(execution_date, 'YYYY-MM-DD') as execution_date,
        SUM(total_runs) as total_runs,
        SUM(successful_runs) as successful_runs,
        SUM(failed_runs) as failed_runs,
        SUM(avg_duration_seconds::numeric * total_runs) / NULLIF(SUM(total_runs), 0) as avg_duration_seconds,
        SUM(total_cost) as total_cost
      FROM pipeline_execution_summary
      WHERE company_id = ?
        AND execution_date >= CURRENT_DATE - CAST(? AS INTEGER)`;
    const params: any[] = [companyId, numDays];
    if (teamId) {
      sql += ' AND team_id = ?';
      params.push(teamId);
    }
    sql += ' GROUP BY execution_date ORDER BY execution_date ASC';

    const history = await query<any>(sql, params);

    // Actual recorded counts only. No minimum failure floor, no simulated history:
    // an empty result is returned as [] and the UI shows an empty state.
    const results = history.map((row: any) => {
      const totalRuns = num(row.total_runs) ?? 0;
      const failedRuns = num(row.failed_runs);
      const successRuns = num(row.successful_runs);
      return {
        date: row.execution_date,
        total_runs: totalRuns,
        successful_runs: successRuns,
        failed_runs: failedRuns,
        failure_rate: totalRuns > 0 && failedRuns !== null ? Number(((failedRuns / totalRuns) * 100).toFixed(2)) : null,
        avg_duration_seconds: roundTo(num(row.avg_duration_seconds), 1),
        total_cost: num(row.total_cost)
      };
    });

    res.json({
      history: results,
      units: {
        runs: 'stage executions',
        avg_duration_seconds: 'mean stage-execution duration, weighted by executions',
        failure_rate: 'failed / total stage executions for the day, %'
      }
    });
  } catch (error) {
    console.error('Error fetching pipeline history:', error);
    res.status(500).json({ error: 'Failed to fetch pipeline history' });
  }
});

router.get('/pipeline-stages', authenticateToken, async (req: any, res) => {
  try {
    const { companyId, role, primaryTeamId } = req.user;
    const { teamId: requestedTeamId } = req.query;

    const scope = await resolveAnalyticsTeam(req, res, requestedTeamId);
    if (!scope) return;
    const teamId = scope.teamId;

    // Get pipeline config for this company
    const config = await queryOne<any>(
      'SELECT time_savings_percent, cost_savings_percent, cost_per_minute FROM pipeline_config WHERE company_id = ?',
      [companyId]
    );

    // Reject team ids that are not in the caller's company.
    if (teamId && !(await getOwnedTeam(req, teamId as string))) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // One row per stage name: if duplicates exist for the same company/team/name,
    // only the most recently updated one is returned.
    const stageSelect = (where: string) => `
        SELECT * FROM (
          SELECT DISTINCT ON (ps.name)
            ps.id, ps.name, ps.stage_order,
            ps.avg_duration_seconds as duration, ps.success_rate,
            ps.cpu_usage, ps.memory_usage, ps.cost_per_run as cost, ps.bottleneck_score,
            ps.manually_edited, ps.updated_at
          FROM pipeline_stages ps
          WHERE ${where}
          ORDER BY ps.name, ps.updated_at DESC NULLS LAST, ps.created_at DESC NULLS LAST, ps.id
        ) latest
        ORDER BY latest.stage_order ASC, latest.name ASC`;

    let stages: any[] = [];
    // 'team' = the team's own stages; 'company_default' = the team has none, so the
    // company-level stages are shown (read-only GET: nothing is copied or inserted).
    let stagesSource: 'team' | 'company_default' = 'company_default';

    if (teamId) {
      stages = await query<any>(
        stageSelect('ps.company_id = ? AND ps.team_id = ? AND ps.is_active = true'),
        [companyId, teamId]
      );
      if (stages.length > 0) stagesSource = 'team';
    }

    if (stages.length === 0) {
      stages = await query<any>(
        stageSelect('ps.company_id = ? AND ps.team_id IS NULL AND ps.is_active = true'),
        [companyId]
      );
    }

    // Bottleneck score = duration factor (0-60, from z-score) + failure factor (0-40);
    // null when duration or success rate is missing. One definition: computeBottleneckScores()
    // in server/lib/metricFormulas.ts (BOTTLENECK_SCORE_FORMULA).
    const bottlenecks = computeBottleneckScores(
      stages.map((s: any) => ({ duration: s.duration, success_rate: s.success_rate }))
    ).results;
    const result = stages.map((s: any, i: number) => {
      const duration = num(s.duration);
      const successRate = num(s.success_rate);
      const bottleneck = bottlenecks[i].score;

      return {
        id: s.id,
        name: s.name,
        duration,
        success_rate: successRate,
        resource_usage: {
          cpu: num(s.cpu_usage),
          memory: num(s.memory_usage),
          cost: num(s.cost)
        },
        bottleneck_score: bottleneck,
        manually_edited: s.manually_edited === true,
        updated_at: s.updated_at ?? null
      };
    });

    res.json({
      stages: result,
      stages_source: stagesSource,
      config: toPipelineConfig(config)
    });
  } catch (error) {
    console.error('Error fetching pipeline stages:', error);
    res.status(500).json({ error: 'Failed to fetch pipeline stages' });
  }
});

// Update pipeline stage metrics
router.put('/pipeline-stages/:id', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    if (!canManageCompanyData(req)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const { id } = req.params;
    const { team_id, duration, success_rate, cpu_usage, memory_usage, cost_per_run } = req.body;

    // Verify stage belongs to company
    const stage = await queryOne<any>(
      `SELECT ps.id, ps.team_id, t.department_id FROM pipeline_stages ps
         LEFT JOIN teams t ON t.id = ps.team_id
        WHERE ps.id = ? AND ps.company_id = ?`,
      [id, companyId]
    );

    if (!stage) {
      return res.status(404).json({ error: 'Pipeline stage not found' });
    }
    // Company default stages (team_id empty) are company-wide values: super admin only.
    if (!stage.team_id && !isCompanyAdmin(policyActor(req))) {
      return res.status(403).json({ error: 'Only a super admin can change the company default pipeline stages' });
    }
    // A qa_manager may only edit stages of teams in their department (canManageTeam).
    if (stage.team_id && !canManageTeam(policyActor(req), { department_id: stage.department_id })) {
      return res.status(403).json({ error: 'Can only manage teams in your department' });
    }

    // Update the stage and mark as manually edited
    await query(
      `UPDATE pipeline_stages SET 
        avg_duration_seconds = COALESCE(?, avg_duration_seconds),
        success_rate = COALESCE(?, success_rate),
        cpu_usage = COALESCE(?, cpu_usage),
        memory_usage = COALESCE(?, memory_usage),
        cost_per_run = COALESCE(?, cost_per_run),
        manually_edited = TRUE,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [duration, success_rate, cpu_usage, memory_usage, cost_per_run, id]
    );

    // Save history snapshot for tracking
    await query(
      `INSERT INTO pipeline_stage_history 
       (id, stage_id, company_id, team_id, name, duration_seconds, success_rate,
        cpu_usage, memory_usage, cost_per_run, bottleneck_score)
       SELECT gen_random_uuid(), id, company_id, team_id, name, avg_duration_seconds, success_rate,
              cpu_usage, memory_usage, cost_per_run, bottleneck_score
       FROM pipeline_stages WHERE id = ?`,
      [id]
    );

    res.json({ success: true, message: 'Pipeline stage updated' });
  } catch (error) {
    console.error('Error updating pipeline stage:', error);
    res.status(500).json({ error: 'Failed to update pipeline stage' });
  }
});

// ============================================================================
// BUSINESS IMPACT ANALYSIS
// ============================================================================

// V1 business impact. Returns only values a person entered in business_impact_config
// (source 'manual_config'). There is no simulated/hard-coded fallback, and the
// business_impact_metrics table (filled only by the synthetic analytics job) is not served.
router.get('/business-impact', authenticateToken, async (req: any, res) => {
  try {
    // One team in the caller's analytics scope (teamId defaults to the caller's own team).
    const scope = await resolveAnalyticsTeam(req, res, req.query.teamId);
    if (!scope) return;
    const { companyId } = req.user;

    const configuredMetrics = await query<any>(
      `SELECT bic.team_id, bic.metric_name, bic.quality_score, bic.revenue_impact, bic.customer_satisfaction,
              bic.feature_adoption_rate, bic.correlation_strength
       FROM business_impact_config bic
       JOIN teams t ON t.id = bic.team_id
       WHERE t.company_id = ? AND t.id = ? AND bic.manually_edited = TRUE
       ORDER BY bic.team_id, bic.metric_name`,
      [companyId, scope.teamId]
    );

    const result = configuredMetrics.map((m: any) => ({
      team_id: m.team_id,
      metric_name: m.metric_name,
      quality_score: num(m.quality_score),
      revenue_impact: num(m.revenue_impact),
      customer_satisfaction: num(m.customer_satisfaction),
      feature_adoption_rate: num(m.feature_adoption_rate),
      correlation_strength: num(m.correlation_strength),
      source: 'manual_config'
    }));

    res.json({ metrics: result });
  } catch (error) {
    console.error('Error fetching business impact:', error);
    res.status(500).json({ error: 'Failed to fetch business impact' });
  }
});

// ============================================================================
// SEED & UPDATE ANALYTICS DATA
// ============================================================================

// Sample data: the one-shot demo dataset (server/seeds/demoData.ts), the same data as
// `npm run seed:demo` + `--fill-existing`. It creates the separate sample company (own users,
// password demo123) and fills the caller's own active teams that lack data (demo- ids, removed
// by seed:demo:clear). Additive: existing rows are never changed; re-running adds nothing new
// on the same day. super_admin only; off unless ENABLE_SYNTHETIC_DATA=true.
router.get('/seed-data/status', authenticateToken, async (req: any, res) => {
  try {
    if (!canManageSampleData(policyActor(req))) {
      return res.status(403).json({ error: 'Only super admin can load sample data' });
    }
    const enabled = isSyntheticDataEnabled();
    const summary = demoSummary(todayUtc());
    const separate = separateSampleCompanyEnabled();
    res.json({
      enabled,
      message: enabled ? null : SYNTHETIC_DISABLED_MESSAGE,
      separateCompany: separate,
      seeded: separate ? await isDemoSeeded() : false,
      ownCompany: req.user.companyId && !String(req.user.companyId).startsWith('demo-')
        ? await teamsLackingData(req.user.companyId)
        : null,
      companyName: summary.companyName,
      teams: summary.teams,
      users: summary.users,
      logins: separate ? summary.logins : [],
      password: separate ? summary.password : '',
    });
  } catch (error) {
    console.error('Error reading sample data status:', error);
    res.status(500).json({ error: 'Failed to read sample data status' });
  }
});

router.post('/seed-data', authenticateToken, async (req: any, res) => {
  try {
    if (!canManageSampleData(policyActor(req))) {
      return res.status(403).json({ error: 'Only super admin can load sample data' });
    }
    if (!isSyntheticDataEnabled()) {
      return res.status(409).json({ error: SYNTHETIC_DISABLED_MESSAGE, disabled: true });
    }

    // The separate sample company (shared accounts) only where demo accounts make sense.
    const separate = separateSampleCompanyEnabled();
    const result = separate ? await runDemoSeed() : { insertedTotal: 0, inserted: {}, companyName: null as string | null, logins: [] as any[], password: '' };
    const companyId = String(req.user.companyId ?? '');
    const fill = companyId && !companyId.startsWith('demo-') ? await runFillExisting({ companyIds: [companyId] }) : null;
    const filledTeams = fill?.companies[0]?.teamsFilled ?? 0;
    const total = result.insertedTotal + (fill?.insertedTotal ?? 0);
    res.json({
      success: true,
      message: total > 0
        ? (separate ? `Sample data loaded: ${result.insertedTotal} rows for "${result.companyName}"` + (fill ? ' and ' : '.') : 'Sample data loaded: ') +
          (fill ? `${fill.insertedTotal} rows for ${filledTeams} of your teams that lacked data.` : '')
        : 'Sample data is already loaded (nothing new to add).',
      companyName: result.companyName,
      insertedTotal: total,
      inserted: result.inserted,
      ownCompany: fill ? { insertedTotal: fill.insertedTotal, inserted: fill.inserted, teams: fill.companies[0]?.teams ?? 0, teamsFilled: filledTeams } : null,
      logins: result.logins,
      password: result.password,
    });
  } catch (error) {
    console.error('Error loading sample data:', error);
    res.status(500).json({ error: 'Failed to load sample data' });
  }
});

// Manually trigger daily update
router.post('/update-daily', authenticateToken, async (req: any, res) => {
  try {
    if (!canManageSampleData(policyActor(req))) {
      return res.status(403).json({ error: 'Only super admin can trigger updates' });
    }
    // updateDailyAnalytics applies random drift / random rows: synthetic only.
    if (!isSyntheticDataEnabled()) {
      return res.status(409).json({ error: SYNTHETIC_DISABLED_MESSAGE, disabled: true });
    }

    // Run update in background
    updateDailyAnalytics().catch(err => console.error('Update error:', err));

    res.json({ success: true, message: 'Daily analytics update triggered' });
  } catch (error) {
    console.error('Error triggering update:', error);
    res.status(500).json({ error: 'Failed to trigger update' });
  }
});

// ============================================================================
// ENHANCED BUSINESS IMPACT CORRELATION API (V2)
// ============================================================================

// ---------------------------------------------------------------------------
// Statistics
// Pearson r with an exact two-sided Student-t test (df = n - 2), and
// Benjamini-Hochberg FDR adjustment across all pairs tested for a team.
// Results are exploratory: monthly series are short and often share trends.
// ---------------------------------------------------------------------------

// logGamma, regularized incomplete beta and the Student-t p-value: server/lib/stats.ts

interface PearsonResult { correlation: number | null; pValue: number | null; sampleSize: number }

// Pearson correlation with exact t-test. Edge cases:
//   n < 3          -> r = null, p = null (not computable; never shown as "no correlation")
//   zero variance  -> r = null, p = null (undefined)
//   |r| = 1        -> p = 0
function calculatePearsonCorrelation(x: number[], y: number[]): PearsonResult {
  const n = Math.min(x.length, y.length);
  if (n < 3) return { correlation: null, pValue: null, sampleSize: n };

  let meanX = 0, meanY = 0;
  for (let i = 0; i < n; i++) { meanX += x[i]; meanY += y[i]; }
  meanX /= n; meanY /= n;

  let numerator = 0, denomX = 0, denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  if (denomX === 0 || denomY === 0) return { correlation: null, pValue: null, sampleSize: n };

  const r = Math.max(-1, Math.min(1, numerator / Math.sqrt(denomX * denomY)));
  const df = n - 2;
  let pValue: number;
  if (1 - Math.abs(r) < 1e-12) {
    pValue = 0;
  } else {
    const t = r * Math.sqrt(df / (1 - r * r));
    pValue = studentTTwoSidedP(t, df);
  }

  return { correlation: Math.round(r * 1000) / 1000, pValue, sampleSize: n };
}

// benjaminiHochberg: server/lib/stats.ts

// Helper: Get correlation strength label (magnitude only; see is_significant for evidence)
function getCorrelationStrength(r: number): string {
  const absR = Math.abs(r);
  if (absR >= 0.7) return 'strong';
  if (absR >= 0.5) return 'moderate';
  if (absR >= 0.3) return 'weak';
  return 'none';
}

const BI_QUALITY_FIELDS = [
  'test_coverage', 'defect_density', 'defect_escape_rate', 'mttr_hours',
  'deployment_frequency', 'lead_time_days', 'code_quality_score', 'change_failure_rate'
];
const BI_KPI_FIELDS = [
  'monthly_revenue', 'active_users', 'churn_rate', 'feature_adoption_rate',
  'nps_score', 'csat_score', 'support_ticket_volume'
];
const BI_MIN_PAIRED_MONTHS = 6;
const BI_FDR_ALPHA = 0.05;

const CORRELATION_METHOD = {
  coefficient: 'Pearson r',
  test: 'two-sided Student t-test, df = n - 2 (exact, regularized incomplete beta)',
  multipleComparison: 'Benjamini-Hochberg FDR across all metric pairs tested for this team',
  significance: `q < ${BI_FDR_ALPHA}`,
  minimumPairedMonths: BI_MIN_PAIRED_MONTHS,
  exploratory: true,
  caveat: 'Correlation does not show causation. Monthly series that share a trend can correlate without any causal link.'
};

interface CorrelationRow {
  quality_metric: string;
  business_kpi: string;
  pearson_correlation: number;
  p_value: number;
  q_value: number;
  sample_size: number;
  correlation_strength: string;
  is_significant: boolean;
  start_month: string;
  end_month: string;
}

/**
 * Single definition of the business-impact correlation matrix, used by the GET,
 * calculate-correlations, ai-analysis and (synthetic) generate endpoints.
 * Pairs months present in both series, drops nulls pairwise, requires
 * >= BI_MIN_PAIRED_MONTHS non-null pairs, skips zero-variance pairs, then applies BH-FDR.
 */
function computeCorrelationMatrix(qualityRows: any[], kpiRows: any[]): {
  correlations: CorrelationRow[];
  pairedMonths: string[];
  pairsSkippedZeroVariance: number;
} {
  const qualityByMonth: Record<string, any> = {};
  qualityRows.forEach((m: any) => { qualityByMonth[m.month_year] = m; });
  const kpiByMonth: Record<string, any> = {};
  kpiRows.forEach((k: any) => { kpiByMonth[k.month_year] = k; });
  const pairedMonths = Object.keys(qualityByMonth).filter(m => kpiByMonth[m]).sort();

  const tested: Array<Omit<CorrelationRow, 'q_value' | 'is_significant'>> = [];
  let pairsSkippedZeroVariance = 0;

  for (const qField of BI_QUALITY_FIELDS) {
    for (const kField of BI_KPI_FIELDS) {
      const xValues: number[] = [];
      const yValues: number[] = [];
      const months: string[] = [];
      for (const month of pairedMonths) {
        const qVal = num(qualityByMonth[month][qField]);
        const kVal = num(kpiByMonth[month][kField]);
        if (qVal !== null && kVal !== null) {
          xValues.push(qVal);
          yValues.push(kVal);
          months.push(month);
        }
      }
      if (xValues.length < BI_MIN_PAIRED_MONTHS) continue;

      const { correlation, pValue, sampleSize } = calculatePearsonCorrelation(xValues, yValues);
      if (correlation === null || pValue === null) {
        pairsSkippedZeroVariance++;
        continue;
      }
      tested.push({
        quality_metric: qField,
        business_kpi: kField,
        pearson_correlation: correlation,
        p_value: pValue,
        sample_size: sampleSize,
        correlation_strength: getCorrelationStrength(correlation),
        start_month: months[0],
        end_month: months[months.length - 1]
      });
    }
  }

  const qValues = benjaminiHochberg(tested.map(t => t.p_value));
  const correlations: CorrelationRow[] = tested.map((t, i) => ({
    ...t,
    q_value: qValues[i] as number,
    is_significant: (qValues[i] as number) < BI_FDR_ALPHA
  }));
  correlations.sort((a, b) => Math.abs(b.pearson_correlation) - Math.abs(a.pearson_correlation));

  return { correlations, pairedMonths, pairsSkippedZeroVariance };
}

// GET: Fetch all correlation data for a team
router.get('/business-impact-v2/:teamId', authenticateToken, async (req: any, res) => {
  try {
    const { teamId: requestedTeamId } = req.params;
    const { role, primaryTeamId } = req.user;

    const scope = await resolveAnalyticsTeam(req, res, requestedTeamId);
    if (!scope) return;
    const teamId = scope.teamId;
    // Tenant scope: the team must belong to the caller's company.
    if (!(await getOwnedTeam(req, teamId))) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // Fetch quality metrics time series
    const qualityMetrics = await query<any>(
      `SELECT * FROM business_impact_quality_metrics
       WHERE team_id = ? ORDER BY month_year ASC`,
      [teamId]
    );

    // Fetch business KPIs time series
    const businessKpis = await query<any>(
      `SELECT * FROM business_impact_business_kpis 
       WHERE team_id = ? ORDER BY month_year ASC`,
      [teamId]
    );

    // Fetch context data
    const contextData = await query<any>(
      `SELECT * FROM business_impact_context 
       WHERE team_id = ? ORDER BY month_year ASC`,
      [teamId]
    );

    // Correlations are computed from the current monthly data on every request
    // (single definition: computeCorrelationMatrix). Cached rows in
    // business_impact_correlations are not served, so they can never be stale or
    // differ from the data shown next to them.
    const matrix = computeCorrelationMatrix(qualityMetrics, businessKpis);
    const calculatedAt = new Date().toISOString();
    const correlations = matrix.correlations.map(c => ({
      id: `${c.quality_metric}:${c.business_kpi}`,
      team_id: teamId,
      ...c,
      calculated_at: calculatedAt
    }));

    // Fetch data status
    const dataStatus = await query<any>(
      `SELECT * FROM business_impact_data_status WHERE team_id = ?`,
      [teamId]
    );

    // Calculate data completeness
    const monthsWithQuality = qualityMetrics.length;
    const monthsWithKpis = businessKpis.length;

    // Find paired months (both X and Y exist)
    const qualityMonths = new Set(qualityMetrics.map((m: any) => m.month_year));
    const kpiMonths = new Set(businessKpis.map((m: any) => m.month_year));
    const pairedMonths = [...qualityMonths].filter(m => kpiMonths.has(m));

    res.json({
      qualityMetrics,
      businessKpis,
      contextData,
      correlations,
      dataStatus: dataStatus[0] || null,
      summary: {
        monthsWithQualityData: monthsWithQuality,
        monthsWithKpiData: monthsWithKpis,
        monthsWithPairedData: pairedMonths.length,
        isCorrelationReady: correlations.length > 0,
        correlationsTested: correlations.length,
        pairsSkippedZeroVariance: matrix.pairsSkippedZeroVariance,
        earliestMonth: qualityMetrics[0]?.month_year || businessKpis[0]?.month_year || null,
        latestMonth: qualityMetrics[qualityMetrics.length - 1]?.month_year ||
          businessKpis[businessKpis.length - 1]?.month_year || null
      },
      correlationMethod: CORRELATION_METHOD
    });
  } catch (error) {
    console.error('Error fetching business impact v2:', error);
    res.status(500).json({ error: 'Failed to fetch business impact data' });
  }
});

// POST: Save quality metrics for a month
router.post('/business-impact-v2/:teamId/quality-metrics', authenticateToken, async (req: any, res) => {
  try {
    const { teamId } = req.params;
    if (!(await assertTeamWrite(req, res, teamId))) return;
    const { month_year, ...metrics } = req.body;

    if (!month_year || !/^\d{4}-\d{2}$/.test(month_year)) {
      return res.status(400).json({ error: 'Invalid month_year format. Use YYYY-MM' });
    }
    const rangeErrors = parseRangedFields(metrics, BI_QUALITY_RANGES).errors;
    if (rangeErrors.length) return res.status(400).json({ error: rangeErrors[0], details: rangeErrors });

    const id = randomUUID();

    await query(
      `INSERT INTO business_impact_quality_metrics
       (id, team_id, month_year, test_coverage, defect_density, defect_escape_rate,
        mttr_hours, deployment_frequency, lead_time_days, code_quality_score,
        change_failure_rate, manually_edited, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, 'manual')
       ON CONFLICT (team_id, month_year) DO UPDATE SET
         test_coverage = COALESCE(EXCLUDED.test_coverage, business_impact_quality_metrics.test_coverage),
         defect_density = COALESCE(EXCLUDED.defect_density, business_impact_quality_metrics.defect_density),
         defect_escape_rate = COALESCE(EXCLUDED.defect_escape_rate, business_impact_quality_metrics.defect_escape_rate),
         mttr_hours = COALESCE(EXCLUDED.mttr_hours, business_impact_quality_metrics.mttr_hours),
         deployment_frequency = COALESCE(EXCLUDED.deployment_frequency, business_impact_quality_metrics.deployment_frequency),
         lead_time_days = COALESCE(EXCLUDED.lead_time_days, business_impact_quality_metrics.lead_time_days),
         code_quality_score = COALESCE(EXCLUDED.code_quality_score, business_impact_quality_metrics.code_quality_score),
         change_failure_rate = COALESCE(EXCLUDED.change_failure_rate, business_impact_quality_metrics.change_failure_rate),
         manually_edited = TRUE,
         updated_at = CURRENT_TIMESTAMP`,
      [
        id, teamId, month_year,
        num(metrics.test_coverage),
        num(metrics.defect_density),
        num(metrics.defect_escape_rate),
        num(metrics.mttr_hours),
        num(metrics.deployment_frequency),
        num(metrics.lead_time_days),
        num(metrics.code_quality_score),
        num(metrics.change_failure_rate)
      ]
    );

    res.json({ success: true, message: 'Quality metrics saved' });
  } catch (error) {
    if (isDataException(error)) return res.status(400).json({ error: dataExceptionMessage(error) });
    console.error('Error saving quality metrics:', error);
    res.status(500).json({ error: 'Failed to save quality metrics' });
  }
});

// POST: Save business KPIs for a month
router.post('/business-impact-v2/:teamId/business-kpis', authenticateToken, async (req: any, res) => {
  try {
    const { teamId } = req.params;
    if (!(await assertTeamWrite(req, res, teamId))) return;
    const { month_year, ...kpis } = req.body;

    if (!month_year || !/^\d{4}-\d{2}$/.test(month_year)) {
      return res.status(400).json({ error: 'Invalid month_year format. Use YYYY-MM' });
    }
    const rangeErrors = parseRangedFields(kpis, BI_KPI_RANGES).errors;
    if (rangeErrors.length) return res.status(400).json({ error: rangeErrors[0], details: rangeErrors });

    const id = randomUUID();

    await query(
      `INSERT INTO business_impact_business_kpis
       (id, team_id, month_year, monthly_revenue, active_users, churn_rate,
        feature_adoption_rate, new_customers, customer_lifetime_value,
        nps_score, csat_score, support_ticket_volume, avg_resolution_time_hours,
        manually_edited, data_source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, 'manual')
       ON CONFLICT (team_id, month_year) DO UPDATE SET
         monthly_revenue = COALESCE(EXCLUDED.monthly_revenue, business_impact_business_kpis.monthly_revenue),
         active_users = COALESCE(EXCLUDED.active_users, business_impact_business_kpis.active_users),
         churn_rate = COALESCE(EXCLUDED.churn_rate, business_impact_business_kpis.churn_rate),
         feature_adoption_rate = COALESCE(EXCLUDED.feature_adoption_rate, business_impact_business_kpis.feature_adoption_rate),
         new_customers = COALESCE(EXCLUDED.new_customers, business_impact_business_kpis.new_customers),
         customer_lifetime_value = COALESCE(EXCLUDED.customer_lifetime_value, business_impact_business_kpis.customer_lifetime_value),
         nps_score = COALESCE(EXCLUDED.nps_score, business_impact_business_kpis.nps_score),
         csat_score = COALESCE(EXCLUDED.csat_score, business_impact_business_kpis.csat_score),
         support_ticket_volume = COALESCE(EXCLUDED.support_ticket_volume, business_impact_business_kpis.support_ticket_volume),
         avg_resolution_time_hours = COALESCE(EXCLUDED.avg_resolution_time_hours, business_impact_business_kpis.avg_resolution_time_hours),
         manually_edited = TRUE,
         updated_at = CURRENT_TIMESTAMP`,
      [
        id, teamId, month_year,
        num(kpis.monthly_revenue),
        num(kpis.active_users),
        num(kpis.churn_rate),
        num(kpis.feature_adoption_rate),
        num(kpis.new_customers),
        num(kpis.customer_lifetime_value),
        num(kpis.nps_score),
        num(kpis.csat_score),
        num(kpis.support_ticket_volume),
        num(kpis.avg_resolution_time_hours)
      ]
    );

    res.json({ success: true, message: 'Business KPIs saved' });
  } catch (error) {
    if (isDataException(error)) return res.status(400).json({ error: dataExceptionMessage(error) });
    console.error('Error saving business KPIs:', error);
    res.status(500).json({ error: 'Failed to save business KPIs' });
  }
});

// POST: Save context data for a month
router.post('/business-impact-v2/:teamId/context', authenticateToken, async (req: any, res) => {
  try {
    const { teamId } = req.params;
    if (!(await assertTeamWrite(req, res, teamId))) return;
    const { month_year, ...context } = req.body;

    if (!month_year || !/^\d{4}-\d{2}$/.test(month_year)) {
      return res.status(400).json({ error: 'Invalid month_year format. Use YYYY-MM' });
    }
    const rangeErrors = parseRangedFields(context, BI_CONTEXT_RANGES).errors;
    if (rangeErrors.length) return res.status(400).json({ error: rangeErrors[0], details: rangeErrors });

    const id = randomUUID();

    await query(
      `INSERT INTO business_impact_context
       (id, team_id, month_year, team_size, sprint_length_days, working_days,
        feature_release_count, bug_fix_count, tech_debt_items_resolved,
        user_growth_rate, total_user_base, is_holiday_season, marketing_spend,
        major_incident_count, downtime_minutes, notes, manually_edited)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
       ON CONFLICT (team_id, month_year) DO UPDATE SET
         team_size = COALESCE(EXCLUDED.team_size, business_impact_context.team_size),
         sprint_length_days = COALESCE(EXCLUDED.sprint_length_days, business_impact_context.sprint_length_days),
         working_days = COALESCE(EXCLUDED.working_days, business_impact_context.working_days),
         feature_release_count = COALESCE(EXCLUDED.feature_release_count, business_impact_context.feature_release_count),
         bug_fix_count = COALESCE(EXCLUDED.bug_fix_count, business_impact_context.bug_fix_count),
         tech_debt_items_resolved = COALESCE(EXCLUDED.tech_debt_items_resolved, business_impact_context.tech_debt_items_resolved),
         user_growth_rate = COALESCE(EXCLUDED.user_growth_rate, business_impact_context.user_growth_rate),
         total_user_base = COALESCE(EXCLUDED.total_user_base, business_impact_context.total_user_base),
         is_holiday_season = COALESCE(EXCLUDED.is_holiday_season, business_impact_context.is_holiday_season),
         marketing_spend = COALESCE(EXCLUDED.marketing_spend, business_impact_context.marketing_spend),
         major_incident_count = COALESCE(EXCLUDED.major_incident_count, business_impact_context.major_incident_count),
         downtime_minutes = COALESCE(EXCLUDED.downtime_minutes, business_impact_context.downtime_minutes),
         notes = COALESCE(EXCLUDED.notes, business_impact_context.notes),
         manually_edited = TRUE,
         updated_at = CURRENT_TIMESTAMP`,
      [
        id, teamId, month_year,
        num(context.team_size),
        num(context.sprint_length_days),
        num(context.working_days),
        num(context.feature_release_count),
        num(context.bug_fix_count),
        num(context.tech_debt_items_resolved),
        num(context.user_growth_rate),
        num(context.total_user_base),
        context.is_holiday_season === undefined || context.is_holiday_season === null ? null : (context.is_holiday_season ? 1 : 0),
        num(context.marketing_spend),
        num(context.major_incident_count),
        num(context.downtime_minutes),
        context.notes || null
      ]
    );

    res.json({ success: true, message: 'Context data saved' });
  } catch (error) {
    if (isDataException(error)) return res.status(400).json({ error: dataExceptionMessage(error) });
    console.error('Error saving context data:', error);
    res.status(500).json({ error: 'Failed to save context data' });
  }
});

// POST: Calculate and cache correlations for a team
router.post('/business-impact-v2/:teamId/calculate-correlations', authenticateToken, async (req: any, res) => {
  try {
    const { teamId } = req.params;
    if (!(await assertTeamWrite(req, res, teamId))) return;

    // Fetch all quality metrics
    const qualityMetrics = await query<any>(
      `SELECT * FROM business_impact_quality_metrics 
       WHERE team_id = ? ORDER BY month_year ASC`,
      [teamId]
    );

    // Fetch all business KPIs
    const businessKpis = await query<any>(
      `SELECT * FROM business_impact_business_kpis 
       WHERE team_id = ? ORDER BY month_year ASC`,
      [teamId]
    );

    if (qualityMetrics.length < 6 || businessKpis.length < 6) {
      return res.status(400).json({
        error: 'Insufficient data. Need at least 6 months of both quality metrics and business KPIs.',
        qualityMonths: qualityMetrics.length,
        kpiMonths: businessKpis.length
      });
    }

    const { correlations: correlationResults, pairedMonths, pairsSkippedZeroVariance } =
      computeCorrelationMatrix(qualityMetrics, businessKpis);

    if (pairedMonths.length < BI_MIN_PAIRED_MONTHS) {
      return res.status(400).json({
        error: 'Insufficient paired data. Need at least 6 months where both X and Y data exist.',
        pairedMonths: pairedMonths.length
      });
    }

    // Cache results. p_value is the exact Student-t p; is_significant uses the
    // Benjamini-Hochberg q-value (q < 0.05) across all pairs tested for this team.
    for (const c of correlationResults) {
      const id = randomUUID();
      await query(
        `INSERT INTO business_impact_correlations
         (id, team_id, quality_metric, business_kpi, pearson_correlation, p_value,
          sample_size, correlation_strength, is_significant, start_month, end_month, calculated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON CONFLICT (team_id, quality_metric, business_kpi) DO UPDATE SET
           pearson_correlation = EXCLUDED.pearson_correlation,
           p_value = EXCLUDED.p_value,
           sample_size = EXCLUDED.sample_size,
           correlation_strength = EXCLUDED.correlation_strength,
           is_significant = EXCLUDED.is_significant,
           start_month = EXCLUDED.start_month,
           end_month = EXCLUDED.end_month,
           calculated_at = NOW(),
           updated_at = CURRENT_TIMESTAMP`,
        [
          id, teamId, c.quality_metric, c.business_kpi, c.pearson_correlation, c.p_value, c.sample_size,
          c.correlation_strength, c.is_significant,
          c.start_month, c.end_month
        ]
      );
    }

    // Update data status
    const statusId = randomUUID();
    await query(
      `INSERT INTO business_impact_data_status
       (id, team_id, months_with_quality_data, months_with_kpi_data, months_with_paired_data,
        earliest_month, latest_month, is_correlation_ready, last_validated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, NOW())
       ON CONFLICT (team_id) DO UPDATE SET
         months_with_quality_data = EXCLUDED.months_with_quality_data,
         months_with_kpi_data = EXCLUDED.months_with_kpi_data,
         months_with_paired_data = EXCLUDED.months_with_paired_data,
         earliest_month = EXCLUDED.earliest_month,
         latest_month = EXCLUDED.latest_month,
         is_correlation_ready = TRUE,
         last_validated_at = NOW(),
         updated_at = CURRENT_TIMESTAMP`,
      [
        statusId, teamId, qualityMetrics.length, businessKpis.length, pairedMonths.length,
        pairedMonths[0], pairedMonths[pairedMonths.length - 1]
      ]
    );

    // Return top correlations sorted by absolute value (already sorted)
    const topCorrelations = correlationResults.slice(0, 20);

    res.json({
      success: true,
      correlationsCalculated: correlationResults.length,
      pairsSkippedZeroVariance,
      pairedMonths: pairedMonths.length,
      dateRange: { start: pairedMonths[0], end: pairedMonths[pairedMonths.length - 1] },
      topCorrelations,
      correlationMethod: CORRELATION_METHOD
    });
  } catch (error) {
    console.error('Error calculating correlations:', error);
    res.status(500).json({ error: 'Failed to calculate correlations' });
  }
});

// POST: Bulk save monthly data (quality + KPIs + context for multiple months)
router.post('/business-impact-v2/:teamId/bulk-save', authenticateToken, async (req: any, res) => {
  try {
    const { teamId } = req.params;
    if (!(await assertTeamWrite(req, res, teamId))) return;
    const { monthlyData } = req.body;

    if (!Array.isArray(monthlyData)) {
      return res.status(400).json({ error: 'monthlyData must be an array' });
    }

    // Data produced by the "generate sample data" endpoint must never be stored as if a
    // person entered it. The client marks it with data_source: 'synthetic' (top level or
    // per month/section); such data is refused unless synthetic data is enabled, and is
    // then stored with data_source='synthetic' and manually_edited=FALSE.
    const isSyntheticPayload =
      req.body.data_source === 'synthetic' || req.body.synthetic === true ||
      monthlyData.some((m: any) =>
        m?.data_source === 'synthetic' || m?.quality?.data_source === 'synthetic' || m?.kpis?.data_source === 'synthetic');
    if (isSyntheticPayload && !isSyntheticDataEnabled()) {
      return res.status(409).json({ error: 'Sample (synthetic) data cannot be saved. ' + SYNTHETIC_DISABLED_MESSAGE, disabled: true });
    }
    const monthErrors = bulkMonthErrors(monthlyData);
    if (monthErrors.length) return res.status(400).json({ error: monthErrors[0], details: monthErrors });
    const dataSource = isSyntheticPayload ? 'synthetic' : 'manual';
    const manuallyEdited = !isSyntheticPayload;

    let saved = 0;

    for (const month of monthlyData) {
      const { month_year, quality, kpis, context } = month;

      if (!month_year || !/^\d{4}-\d{2}$/.test(month_year)) continue;

      // Save quality metrics
      if (quality && Object.keys(quality).length > 0) {
        const qId = randomUUID();
        await query(
          `INSERT INTO business_impact_quality_metrics
           (id, team_id, month_year, test_coverage, defect_density, defect_escape_rate,
            mttr_hours, deployment_frequency, lead_time_days, code_quality_score,
            change_failure_rate, manually_edited, data_source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (team_id, month_year) DO UPDATE SET
             test_coverage = COALESCE(EXCLUDED.test_coverage, business_impact_quality_metrics.test_coverage),
             defect_density = COALESCE(EXCLUDED.defect_density, business_impact_quality_metrics.defect_density),
             defect_escape_rate = COALESCE(EXCLUDED.defect_escape_rate, business_impact_quality_metrics.defect_escape_rate),
             mttr_hours = COALESCE(EXCLUDED.mttr_hours, business_impact_quality_metrics.mttr_hours),
             deployment_frequency = COALESCE(EXCLUDED.deployment_frequency, business_impact_quality_metrics.deployment_frequency),
             lead_time_days = COALESCE(EXCLUDED.lead_time_days, business_impact_quality_metrics.lead_time_days),
             code_quality_score = COALESCE(EXCLUDED.code_quality_score, business_impact_quality_metrics.code_quality_score),
             change_failure_rate = COALESCE(EXCLUDED.change_failure_rate, business_impact_quality_metrics.change_failure_rate),
             manually_edited = EXCLUDED.manually_edited,
             data_source = EXCLUDED.data_source,
             updated_at = CURRENT_TIMESTAMP`,
          [
            qId, teamId, month_year,
            num(quality.test_coverage), num(quality.defect_density), num(quality.defect_escape_rate),
            num(quality.mttr_hours), num(quality.deployment_frequency), num(quality.lead_time_days),
            num(quality.code_quality_score), num(quality.change_failure_rate),
            manuallyEdited, dataSource
          ]
        );
      }

      // Save business KPIs
      if (kpis && Object.keys(kpis).length > 0) {
        const kId = randomUUID();
        await query(
          `INSERT INTO business_impact_business_kpis
           (id, team_id, month_year, monthly_revenue, active_users, churn_rate,
            feature_adoption_rate, nps_score, csat_score, support_ticket_volume, manually_edited, data_source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (team_id, month_year) DO UPDATE SET
             monthly_revenue = COALESCE(EXCLUDED.monthly_revenue, business_impact_business_kpis.monthly_revenue),
             active_users = COALESCE(EXCLUDED.active_users, business_impact_business_kpis.active_users),
             churn_rate = COALESCE(EXCLUDED.churn_rate, business_impact_business_kpis.churn_rate),
             feature_adoption_rate = COALESCE(EXCLUDED.feature_adoption_rate, business_impact_business_kpis.feature_adoption_rate),
             nps_score = COALESCE(EXCLUDED.nps_score, business_impact_business_kpis.nps_score),
             csat_score = COALESCE(EXCLUDED.csat_score, business_impact_business_kpis.csat_score),
             support_ticket_volume = COALESCE(EXCLUDED.support_ticket_volume, business_impact_business_kpis.support_ticket_volume),
             manually_edited = EXCLUDED.manually_edited,
             data_source = EXCLUDED.data_source,
             updated_at = CURRENT_TIMESTAMP`,
          [
            kId, teamId, month_year,
            num(kpis.monthly_revenue), num(kpis.active_users), num(kpis.churn_rate),
            num(kpis.feature_adoption_rate), num(kpis.nps_score), num(kpis.csat_score), num(kpis.support_ticket_volume),
            manuallyEdited, dataSource
          ]
        );
      }

      // Save context
      if (context && Object.keys(context).length > 0) {
        const cId = randomUUID();
        await query(
          `INSERT INTO business_impact_context
           (id, team_id, month_year, team_size, feature_release_count, user_growth_rate,
            total_user_base, is_holiday_season, downtime_minutes, manually_edited)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (team_id, month_year) DO UPDATE SET
             team_size = COALESCE(EXCLUDED.team_size, business_impact_context.team_size),
             feature_release_count = COALESCE(EXCLUDED.feature_release_count, business_impact_context.feature_release_count),
             user_growth_rate = COALESCE(EXCLUDED.user_growth_rate, business_impact_context.user_growth_rate),
             total_user_base = COALESCE(EXCLUDED.total_user_base, business_impact_context.total_user_base),
             is_holiday_season = COALESCE(EXCLUDED.is_holiday_season, business_impact_context.is_holiday_season),
             downtime_minutes = COALESCE(EXCLUDED.downtime_minutes, business_impact_context.downtime_minutes),
             manually_edited = EXCLUDED.manually_edited,
             updated_at = CURRENT_TIMESTAMP`,
          [
            cId, teamId, month_year,
            num(context.team_size), num(context.feature_release_count), num(context.user_growth_rate),
            num(context.total_user_base),
            context.is_holiday_season === undefined || context.is_holiday_season === null ? null : (context.is_holiday_season ? 1 : 0),
            num(context.downtime_minutes),
            manuallyEdited
          ]
        );
      }

      saved++;
    }

    res.json({ success: true, monthsSaved: saved, dataSource });
  } catch (error) {
    if (isDataException(error)) return res.status(400).json({ error: dataExceptionMessage(error) });
    console.error('Error bulk saving:', error);
    res.status(500).json({ error: 'Failed to bulk save data' });
  }
});

// POST: Generate SAMPLE (synthetic) correlation data. Not persisted, not a measurement.
// Disabled unless ENABLE_SYNTHETIC_DATA === 'true'.
router.post('/business-impact-v2/:teamId/generate-realistic-data', authenticateToken, async (req: any, res) => {
  try {
    const { teamId } = req.params;
    if (!isSyntheticDataEnabled()) {
      return res.status(409).json({ error: SYNTHETIC_DISABLED_MESSAGE, disabled: true });
    }
    if (!(await assertTeamWrite(req, res, teamId))) return;

    // Generate 12 months of realistic data
    const months: string[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // Realistic base values and trends (biased towards generally positive performance)
    const generateRealisticData = () => {
      const qualityBase = {
        // Higher starting quality and faster improvement
        test_coverage: 75 + Math.random() * 15, // 75-90%
        defect_density: 1.5 + Math.random() * 1.5, // 1.5-3.0 bugs/KLOC
        defect_escape_rate: 8 + Math.random() * 6, // 8-14%
        mttr_hours: 3 + Math.random() * 3, // 3-6 hours
        deployment_frequency: 5 + Math.random() * 4, // 5-9 deployments/month
        lead_time_days: 5 + Math.random() * 5, // 5-10 days
        code_quality_score: 80 + Math.random() * 15, // 80-95%
        change_failure_rate: 8 + Math.random() * 8, // 8-16%
      };

      const kpiBase = {
        // Stronger business performance baseline
        monthly_revenue: 500000 + Math.random() * 300000, // $500K-800K
        active_users: 20000 + Math.random() * 30000, // 20K-50K users
        churn_rate: 2 + Math.random() * 4, // 2-6%
        feature_adoption_rate: 50 + Math.random() * 25, // 50-75%
        nps_score: 30 + Math.random() * 40, // 30-70
        csat_score: 80 + Math.random() * 15, // 80-95%
        support_ticket_volume: 200 + Math.random() * 400, // 200-600 tickets
      };

      return { qualityBase, kpiBase };
    };

    const { qualityBase, kpiBase } = generateRealisticData();

    // Generate time series with realistic correlations and noise
    const qualityMetrics = [];
    const businessKpis = [];
    const contextData = [];

    for (let i = 0; i < 12; i++) {
      const progress = i / 11; // 0 to 1 over 12 months
      const seasonalFactor = 1 + 0.1 * Math.sin(2 * Math.PI * i / 12); // Seasonal variation
      const randomNoise = () => (Math.random() - 0.5) * 0.15; // ±7.5% noise

      // Quality metrics with gradual improvement trend + realistic noise
      const qualityTrend = progress * 0.3; // 30% improvement over 12 months
      const qualityData = {
        id: `q_${i + 1}`,
        team_id: teamId,
        month_year: months[i],
        test_coverage: Math.max(40, Math.min(95, qualityBase.test_coverage + qualityTrend * 25 + randomNoise() * 20)),
        defect_density: Math.max(1, qualityBase.defect_density - qualityTrend * 2 + randomNoise() * 1.5),
        defect_escape_rate: Math.max(5, Math.min(40, qualityBase.defect_escape_rate - qualityTrend * 8 + randomNoise() * 6)),
        mttr_hours: Math.max(2, qualityBase.mttr_hours - qualityTrend * 3 + randomNoise() * 2),
        deployment_frequency: Math.max(1, qualityBase.deployment_frequency + qualityTrend * 8 + randomNoise() * 3),
        lead_time_days: Math.max(3, qualityBase.lead_time_days - qualityTrend * 4 + randomNoise() * 3),
        code_quality_score: Math.max(50, Math.min(95, qualityBase.code_quality_score + qualityTrend * 20 + randomNoise() * 12)),
        change_failure_rate: Math.max(5, Math.min(35, qualityBase.change_failure_rate - qualityTrend * 10 + randomNoise() * 6)),
        manually_edited: false,
        data_source: 'synthetic'
      };
      qualityMetrics.push(qualityData);

      // Business KPIs with realistic correlation but not perfect
      // Add independent noise to break perfect correlations
      const qualityScore = (qualityData.test_coverage * 0.4 + qualityData.code_quality_score * 0.4 + (100 - qualityData.defect_escape_rate) * 0.2) / 100;
      const correlationStrength = 0.6 + Math.random() * 0.3; // 0.6-0.9 realistic correlation

      // Independent business factors (external influences)
      const marketConditions = 0.8 + Math.random() * 0.4; // Market conditions affect business
      const competitivePressure = 0.9 + Math.random() * 0.2; // Competition affects business
      const operationalEfficiency = 0.85 + Math.random() * 0.3; // Internal operations

      const businessData = {
        id: `k_${i + 1}`,
        team_id: teamId,
        month_year: months[i],
        monthly_revenue: Math.max(200000, kpiBase.monthly_revenue * seasonalFactor * marketConditions * operationalEfficiency *
          (1 + qualityScore * correlationStrength * 0.5 + randomNoise() * 0.4)),
        active_users: Math.max(5000, kpiBase.active_users * seasonalFactor * competitivePressure * operationalEfficiency *
          (1 + qualityScore * correlationStrength * 0.4 + randomNoise() * 0.35)),
        churn_rate: Math.max(1, Math.min(15, kpiBase.churn_rate * (1 - marketConditions * 0.3) * (1 - operationalEfficiency * 0.2) *
          (1 - qualityScore * correlationStrength * 0.6 + randomNoise() * 0.5))),
        feature_adoption_rate: Math.max(20, Math.min(80, kpiBase.feature_adoption_rate * competitivePressure * operationalEfficiency +
          qualityScore * correlationStrength * 25 + randomNoise() * 12)),
        nps_score: Math.max(-20, Math.min(80, kpiBase.nps_score * marketConditions * operationalEfficiency +
          qualityScore * correlationStrength * 50 + randomNoise() * 20)),
        csat_score: Math.max(40, Math.min(95, kpiBase.csat_score * operationalEfficiency * competitivePressure +
          qualityScore * correlationStrength * 20 + randomNoise() * 12)),
        support_ticket_volume: Math.max(100, Math.min(1500, kpiBase.support_ticket_volume * (1 - operationalEfficiency * 0.3) * (1 - qualityScore * correlationStrength * 0.4) +
          randomNoise() * 200)),
        manually_edited: false,
        data_source: 'synthetic'
      };
      businessKpis.push(businessData);

      // Context data
      const contextItem = {
        id: `c_${i + 1}`,
        team_id: teamId,
        month_year: months[i],
        team_size: 8 + Math.floor(i / 3), // Team grows every 3 months
        sprint_length_days: 14,
        feature_release_count: 2 + Math.floor(i / 2) + Math.floor(Math.random() * 3), // 2-4 features/month
        total_user_base: 40000 + i * 2000 + Math.floor(Math.random() * 5000), // Growing user base
        user_growth_rate: 4 + Math.random() * 8, // 4-12% growth
        downtime_minutes: 150 - i * 10 + Math.floor(Math.random() * 100), // Decreasing downtime
        is_holiday_season: i === 0 ? 1 : 0, // December has holiday season
        manually_edited: false,
        data_source: 'synthetic'
      };
      contextData.push(contextItem);
    }

    // Same statistics as for real data (exact t-test + BH-FDR)
    const { correlations } = computeCorrelationMatrix(qualityMetrics, businessKpis);

    res.json({
      success: true,
      dataGenerated: true,
      synthetic: true,
      dataSource: 'synthetic',
      message: 'SAMPLE DATA: 12 months of synthetic, randomly generated values. Not measured and not saved. Do not use for decisions.',
      dateRange: { start: months[0], end: months[11] },
      qualityMetrics,
      businessKpis,
      contextData,
      correlations: correlations.slice(0, 20), // Top 20 correlations
      correlationMethod: CORRELATION_METHOD,
      summary: {
        monthsWithQualityData: 12,
        monthsWithKpiData: 12,
        monthsWithPairedData: 12,
        isCorrelationReady: correlations.length > 0,
        earliestMonth: months[0],
        latestMonth: months[11]
      }
    });
  } catch (error) {
    console.error('Error generating sample data:', error);
    res.status(500).json({ error: 'Failed to generate sample data' });
  }
});

// POST: AI analysis of correlations using backend Groq API key
router.post('/business-impact-v2/:teamId/ai-analysis', aiLimiter, authenticateToken, async (req: any, res) => {
  try {
    const { teamId } = req.params;
    // Tenant + analytics scope (team-level statistics; also limits whose budget is spent).
    if (!(await assertTeamAnalytics(req, res, teamId))) return;

    // Rebuild the correlation matrix from THIS team's stored monthly data (same
    // computation as the GET endpoint) rather than trusting the request body.
    const [aiQuality, aiKpis] = await Promise.all([
      query<any>(`SELECT * FROM business_impact_quality_metrics WHERE team_id = ? ORDER BY month_year ASC`, [teamId]),
      query<any>(`SELECT * FROM business_impact_business_kpis WHERE team_id = ? ORDER BY month_year ASC`, [teamId])
    ]);
    const aiMatrix = computeCorrelationMatrix(aiQuality, aiKpis);
    const correlations = aiMatrix.correlations.slice(0, 50);

    if (!correlations || correlations.length === 0) {
      return res.status(400).json({ error: 'No correlations available for analysis. At least 6 months of paired data are needed.' });
    }
    const periodStart = aiMatrix.pairedMonths[0];
    const periodEnd = aiMatrix.pairedMonths[aiMatrix.pairedMonths.length - 1];
    const testedCount = aiMatrix.correlations.length;

    const groqApiKey = process.env.GROQ_API_KEY;

    if (!groqApiKey || groqApiKey.length <= 10) {
      return res.status(400).json({ error: 'Groq API key not configured on server' });
    }

    // Sanitise the metric labels that go into the prompt to letters/numbers/space
    // only, so DB text cannot carry prompt-injection payloads into the model.
    const clean = (v: any) => String(v ?? '').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/_/g, ' ').slice(0, 60);

    // Create correlation matrix for analysis
    const correlationMatrix = correlations.map((c: any) => ({
      quality_metric: clean(c.quality_metric),
      business_kpi: clean(c.business_kpi),
      correlation: c.pearson_correlation,
      p_value: c.p_value,
      q_value: c.q_value,
      n: c.sample_size,
      strength: clean(c.correlation_strength),
      significant: c.is_significant
    }));

    const analysisPrompt = `You are a Senior Data Scientist and Business Intelligence expert. Analyze this correlation matrix from a QA dashboard that measures the relationship between software quality metrics and business outcomes over ${aiMatrix.pairedMonths.length} paired months (${periodStart} to ${periodEnd}).

IMPORTANT: Output your response as clean HTML that can be directly rendered. Use these HTML elements:
- <h2> for section headers
- <h3> for subsection headers  
- <p> for paragraphs
- <ul> and <li> for bullet lists
- <table>, <thead>, <tbody>, <tr>, <th>, <td> for any tables
- <strong> for bold text
- <span class="positive"> for positive correlations, <span class="negative"> for negative ones

DATASET CONTEXT:
- Time Period: ${aiMatrix.pairedMonths.length} months with both quality and business data (${periodStart} to ${periodEnd}); each pair uses only months where both values exist (n shown per row)
- Quality Metrics (X variables): Software testing and development metrics
- Business KPIs (Y variables): Revenue, user engagement, satisfaction metrics
- Statistical Method: Pearson r, two-sided Student t-test (df = n-2). ${testedCount} pairs were tested, so p-values are adjusted with Benjamini-Hochberg FDR; "significant" means q < 0.05.
- These results are exploratory. Correlation does not show causation; small monthly samples and shared time trends can produce strong correlations without any causal link. Do not claim that one metric drives another.

CORRELATION MATRIX DATA:
${correlationMatrix.map((c: any) =>
      `${c.quality_metric} → ${c.business_kpi}: r=${Number(c.correlation).toFixed(3)}, n=${c.n}, p=${Number(c.p_value) < 0.001 ? '<0.001' : Number(c.p_value).toFixed(4)}, q=${Number(c.q_value) < 0.001 ? '<0.001' : Number(c.q_value).toFixed(4)}, ${c.strength}, ${c.significant ? 'significant after FDR correction' : 'not significant after FDR correction'}`
    ).join('\n')}

ANALYSIS REQUIREMENTS:
1. Executive Summary: Key findings in 3-5 bullet points
2. Statistical Assessment: Evaluate data quality and correlation validity
3. Business Impact Analysis: What could these associations mean, and what further evidence (e.g. experiments, controlling for trends) would be needed before acting on them?
4. Strategic Recommendations: Which relationships are worth investigating further? Do not present correlations as causes.
5. Risk Assessment: Business risks from quality degradation
6. Keep the total response under approximately 1500 words and limit any correlation tables to at most 25 rows.

Provide actionable insights that a CTO would understand and use to make investment decisions. In another section, forget about the numerics and provide explanations about the correlations that both a business person and a technical person can understand. Easy to read, easy to follow, with explanation of the terms and numbers. Output ONLY valid HTML, no markdown.`;

    console.log('[AI:BIA] Calling Groq API for correlation analysis...');

    try {
      const { content: aiText, model, finishReason } = await groqChatCompletion({
        label: 'AI:BIA',
        maxTokens: 3500,
        timeoutMs: 30000,
        messages: [
          {
            role: 'system',
            content: 'You are a Senior Data Scientist and Business Intelligence expert. Analyze correlation data and provide actionable business insights.'
          },
          {
            role: 'user',
            content: analysisPrompt
          }
        ]
      });

      let content = aiText || 'No response from AI';
      if (finishReason === 'length') {
        console.warn('[AI:BIA] Groq response was truncated due to max_tokens limit');
        content += '<p><em>Note: This AI response was truncated due to token limits. Consider reducing the time range or number of metrics if you need a shorter, more focused analysis.</em></p>';
      }

      console.log('[AI:BIA] Groq responded via', model);
      res.json({ success: true, analysis: content });
    } catch (aiError: any) {
      console.error('[AI:BIA] Groq analysis failed after retries:', aiError.message);
      res.status(502).json({ error: 'AI analysis unavailable — please try again in a moment' });
    }
  } catch (error) {
    console.error('[AI][BIA] Error:', error);
    res.status(500).json({ error: 'Failed to analyze correlations' });
  }
});

// ============================================================================
// COMPANY-WIDE METRICS (single definition shared by company-summary and company-insights)
// ============================================================================

// QA score thresholds: one set everywhere (same as kpi_snapshots.status).
const QA_GOOD_THRESHOLD = QA_SCORE_THRESHOLDS.good;
const QA_WARNING_THRESHOLD = QA_SCORE_THRESHOLDS.warning; // below this = critical

// Per-team KPI targets (kpiStatus, needsAttention): KPI_TARGETS from src/config/metricsConfig,
// the same thresholds Team detail and team suggestions use.

// DORA performance level per team. Bands are identical to getDORALevel() in
// server/routes/metrics.ts (DORA State of DevOps bands):
//   Elite:  deploys >= 7/week AND lead time < 1 day  AND CFR < 5%  AND MTTR < 1 h
//   High:   deploys >= 1/week AND lead time < 7 days AND CFR < 10% AND MTTR < 24 h
//   Medium: deploys >= 0.25/week AND lead time < 30 days AND CFR < 15% AND MTTR < 168 h
//   Low:    otherwise
// A team missing any of the four inputs is 'Unknown' (excluded from the score), never treated as 0.
type DoraLevel = 'Elite' | 'High' | 'Medium' | 'Low';
type DoraLevelOrUnknown = DoraLevel | 'Unknown';
const DORA_LEVEL_SCORE: Record<DoraLevel, number> = { Elite: 100, High: 80, Medium: 60, Low: 40 };

function classifyDoraLevel(k: any): DoraLevelOrUnknown {
  const deployFreq = num(k.deployment_frequency_per_week);
  const leadTime = num(k.lead_time_days);
  const cfr = num(k.change_failure_rate);
  const mttr = num(k.mttr_hours);
  if (deployFreq === null || leadTime === null || cfr === null || mttr === null) return 'Unknown';
  if (deployFreq >= 7 && leadTime < 1 && cfr < 5 && mttr < 1) return 'Elite';
  if (deployFreq >= 1 && leadTime < 7 && cfr < 10 && mttr < 24) return 'High';
  if (deployFreq >= 0.25 && leadTime < 30 && cfr < 15 && mttr < 168) return 'Medium';
  return 'Low';
}

const ENGINEERING_HEALTH_WEIGHTS = {
  deliveryPerformance: 0.35,
  pipelineHealth: 0.25,
  techDebtStatus: 0.20,
  // Wellbeing (survey): the anonymous pulse survey (server/lib/pulse.ts). When no team has a
  // shown result it is left out (never replaced by workload balance) and the confidence drops.
  // Workload balance (derived) is a separate workload signal and is not part of this score.
  wellbeingSurvey: 0.20
};

/**
 * The teams the overview summary covers for this caller: null (every active team of the company)
 * for a company-wide scope (super admins), else the ids of the active teams of the caller's
 * analytics scope (canViewTeamAnalytics: a QA manager's departments, everyone else's teams).
 */
export async function summaryTeamIds(req: AuthRequest): Promise<{ teamIds: string[] | null; level: string; companyTeamCount: number }> {
  const actor = policyActor(req);
  const rows = await query<any>('SELECT id, department_id FROM teams WHERE company_id = ? AND is_active = TRUE', [req.companyId]);
  const level = analyticsScopeLevelOf(actor);
  if (level === 'company') return { teamIds: null, level, companyTeamCount: rows.length };
  return { teamIds: analyticsTeamsInScope(actor, rows.map((r: any) => ({ id: String(r.id), department_id: r.department_id }))).map((t) => t.id), level, companyTeamCount: rows.length };
}

export async function computeCompanyMetrics(companyId: string, teamIds: string[] | null = null) {
  // Active teams (with their size: active assigned members) and the latest KPI snapshot per active
  // team; with teamIds only those teams (the caller's analytics scope).
  const activeTeams = await query<any>(
    `SELECT t.id, t.name, t.department_id, ${teamMemberCountSql('t')} AS member_count
       FROM teams t WHERE t.company_id = ? AND t.is_active = TRUE AND (?::text[] IS NULL OR t.id = ANY(?::text[]))`,
    [companyId, teamIds, teamIds]
  );
  const sizeOf = new Map<string, number>(activeTeams.map((t: any) => [t.id as string, Number(t.member_count) || 0]));
  const latestSnapshots = await query<any>(`
    SELECT DISTINCT ON (ks.team_id)
      ks.*, t.name, t.department_id, to_char(ks.snapshot_date, 'YYYY-MM-DD') AS snapshot_day,
      (SELECT d.name FROM departments d WHERE d.id = t.department_id) AS department_name
    FROM kpi_snapshots ks
    JOIN teams t ON t.id = ks.team_id
    WHERE t.company_id = ? AND t.is_active = TRUE AND (?::text[] IS NULL OR t.id = ANY(?::text[]))
    ORDER BY ks.team_id, ks.snapshot_date DESC, ks.created_at DESC
  `, [companyId, teamIds, teamIds]);

  // Current values only: staleness at now (server/lib/staleness.ts) and the targets valid at
  // each value's date (server/lib/targets.ts). A team's QA score leaves its stale inputs out.
  const evalCtx: EvalContext = { companyId, intervals: await loadIntervals(companyId), book: await loadTargetBook(companyId) };
  evalCtx.dataClock = await loadDataClock(companyId, evalCtx.intervals);
  const now = Date.now();
  const evaluated = latestSnapshots.map((t: any) => ({ t, ev: evaluateLatestSnapshot(t, { id: t.team_id, department_id: t.department_id }, evalCtx, now) }));
  const evalOf = new Map<string, SnapshotEvaluation>(evaluated.map((x: any) => [x.t.team_id as string, x.ev]));
  const teamsWithData = evaluated.filter((x: any) => x.ev.qa.value !== null).map((x: any) => x.t);
  const qaOf = (t: any) => evalOf.get(t.team_id)!.qa.value as number;
  /** A KPI value of a team, null when not recorded or stale. */
  const fresh = (t: any, field: string) => (evalOf.get(t.team_id)?.values[field]?.stale ? null : num(t[field]));
  const weightOf = (teamId: string) => Math.max(1, sizeOf.get(teamId) ?? 0);

  const snapshotDays = teamsWithData.map((t: any) => t.snapshot_day as string).sort();
  const asOf: string | null = snapshotDays.length ? snapshotDays[snapshotDays.length - 1] : null;
  const oldestSnapshotDate: string | null = snapshotDays.length ? snapshotDays[0] : null;
  // Newest value of any active team; dataOutdated when even that is over a day old (FI-22: the
  // latest snapshots are then read as of their day and the overview says "Last updated <date>").
  const lastUpdatedTimes = evaluated.map((x: any) => x.ev.lastUpdated).filter((v: any): v is string => !!v).sort();
  const lastUpdated: string | null = lastUpdatedTimes.length ? lastUpdatedTimes[lastUpdatedTimes.length - 1] : null;
  const dataOutdated = evaluated.length > 0 && evaluated.every((x: any) => x.ev.outdated);

  // Global QA score: mean of each active team's current QA score weighted by team size
  // (COMPANY_AGGREGATE_TEXT), with the unweighted mean and the distribution alongside.
  const qaDist = distributionOf(teamsWithData.map((t: any) => ({ value: qaOf(t), weight: weightOf(t.team_id) })));
  const globalQaScoreRaw = qaDist.weightedMean;
  const globalQaScore = globalQaScoreRaw !== null ? Math.round(globalQaScoreRaw) : null;
  const globalQaScoreConfidence = composite(globalQaScore, teamsWithData.length, activeTeams.length);

  // Trend: vs. the same weighted mean over each active team's latest snapshot dated 7-14 days
  // ago (QA score of that day, without the inputs stale on that day).
  // Null (not "stable") when that window has no scored snapshots.
  const prevRows = await query<any>(`
    SELECT DISTINCT ON (ks.team_id) ks.*, t.department_id, to_char(ks.snapshot_date, 'YYYY-MM-DD') AS snapshot_day
    FROM kpi_snapshots ks
    JOIN teams t ON t.id = ks.team_id
    WHERE t.company_id = ? AND t.is_active = TRUE AND (?::text[] IS NULL OR t.id = ANY(?::text[]))
      AND ks.snapshot_date >= CURRENT_DATE - 14
      AND ks.snapshot_date < CURRENT_DATE - 7
    ORDER BY ks.team_id, ks.snapshot_date DESC
  `, [companyId, teamIds, teamIds]);
  const prevDist = distributionOf(prevRows.map((r: any) => ({
    value: evaluateSnapshot(r, { id: r.team_id, department_id: r.department_id }, evalCtx, referenceFor(r.snapshot_day, now)).qa.value,
    weight: weightOf(r.team_id),
  })));
  const prevScore = prevDist.weightedMean;
  const globalQaScoreTrend = globalQaScoreRaw !== null && prevScore !== null
    ? Math.round(globalQaScoreRaw - prevScore)
    : null;

  let riskLevel: 'stable' | 'watch' | 'at-risk' | 'unknown' = 'unknown';
  if (globalQaScore !== null) {
    if (globalQaScore < QA_WARNING_THRESHOLD) riskLevel = 'at-risk';
    else if (globalQaScore < QA_GOOD_THRESHOLD) riskLevel = 'watch';
    else riskLevel = 'stable';
  }

  // Averages over teams that have a current value (stale and missing values excluded, never
  // counted as 0), weighted by team size; the unweighted means are in kpiAveragesUnweighted.
  const avgDist = (field: string) => distributionOf(teamsWithData.map((t: any) => ({ value: fresh(t, field), weight: weightOf(t.team_id) })));
  const avgField = (field: string) => roundTo(avgDist(field).weightedMean, 1);
  const avgTestCoverage = avgField('test_coverage');
  const avgDefectEscapeRate = avgField('defect_escape_rate');
  const automationCoverage = avgField('automation_coverage');
  const avgFlakinessRate = avgField('test_flakiness_rate');
  const kpiAveragesUnweighted = {
    avgTestCoverage: roundTo(avgDist('test_coverage').unweightedMean, 1),
    avgDefectEscapeRate: roundTo(avgDist('defect_escape_rate').unweightedMean, 1),
    automationCoverage: roundTo(avgDist('automation_coverage').unweightedMean, 1),
    avgFlakinessRate: roundTo(avgDist('test_flakiness_rate').unweightedMean, 1),
  };

  // Top teams by current score (not an improvement measure)
  const sortedByScore = [...teamsWithData].sort((a, b) => qaOf(b) - qaOf(a));
  const topImproving = sortedByScore.slice(0, 3).map(t => ({ name: t.name, score: Math.round(qaOf(t)) }));

  // Needs attention: QA score critical or any current KPI off the target valid at its date. Same
  // rule as the dashboard table's "Needs attention" filter (teamAttentionIssues in metricsConfig).
  type AttentionItem = { name: string; score: number; issue: string; issues: string[]; snapshotDate: string };
  const needsAttention: AttentionItem[] = teamsWithData
    .map((t: any): AttentionItem => {
      const score = qaOf(t);
      const issues = teamAttentionIssues({
        qaScore: score,
        testCoverage: num(t.test_coverage),
        testFlakinessRate: num(t.test_flakiness_rate),
        defectEscapeRate: num(t.defect_escape_rate),
        automationCoverage: num(t.automation_coverage),
      }, evalOf.get(t.team_id)!.judge);
      return { name: t.name, score: Math.round(score), issue: issues.join('; '), issues, snapshotDate: t.snapshot_day };
    })
    .filter((t: AttentionItem) => t.issues.length > 0)
    .sort((a: AttentionItem, b: AttentionItem) => a.score - b.score || b.issues.length - a.issues.length);

  // KPI status: share of current KPI targets met (needs >= 2). One rule (teamKpiTrack in
  // src/config/metricsConfig.ts, with the targets valid at each value's date and stale values
  // left out) gives both the per-team list and the counts, so the dashboard's breakdown can
  // never disagree with the numbers.
  const kpiStatusTeams = teamsWithData.map((t: any) => {
    const ev = evalOf.get(t.team_id)!;
    const track = teamKpiTrack({
      testCoverage: num(t.test_coverage),
      testFlakinessRate: num(t.test_flakiness_rate),
      defectEscapeRate: num(t.defect_escape_rate),
      automationCoverage: num(t.automation_coverage),
    }, ev.judge);
    return {
      teamId: t.team_id as string,
      name: t.name as string,
      department: (t.department_name ?? null) as string | null,
      qaScore: qaOf(t),
      qaScoreConfidence: qaConfidenceJson(ev.qa),
      snapshotDate: t.snapshot_day as string,
      ...track,
    };
  });
  const countBucket = (b: string) => kpiStatusTeams.filter((x: any) => x.bucket === b).length;
  const onTrack = countBucket('onTrack'), atRisk = countBucket('atRisk'), offTrack = countBucket('offTrack'), noData = countBucket('noData');

  // Technical debt status (active teams only)
  const techDebtSummary = await queryOne<any>(
    `SELECT 
       ${TECH_DEBT_OPEN_WEIGHT_SQL} AS total_weight,
       SUM(CASE WHEN status NOT IN ('resolved','wont_fix') THEN 1 ELSE 0 END) AS open_items,
       COUNT(*) as total_items
     FROM technical_debt td
     JOIN teams t ON td.team_id = t.id
     WHERE t.company_id = ? AND t.is_active = TRUE AND (?::text[] IS NULL OR t.id = ANY(?::text[]))`,
    [companyId, teamIds, teamIds]
  );
  const techDebtTotalItems = num(techDebtSummary?.total_items) ?? 0;
  const techDebtOpenItems = num(techDebtSummary?.open_items) ?? 0;
  // Score = 100 - min(100, open-debt severity weight per active team). Null when no debt is tracked.
  const techDebtStatusScore = techDebtTotalItems > 0
    ? roundTo(Math.max(0, 100 - Math.min(100, (num(techDebtSummary?.total_weight) ?? 0) / (activeTeams.length || 1))), 1)
    : null;
  const techDebtResolutionRate = techDebtTotalItems > 0
    ? Math.round(((techDebtTotalItems - techDebtOpenItems) / techDebtTotalItems) * 100)
    : null;

  // Workload balance (derived) and burnout risk: k-anonymous company aggregates of developer
  // metrics (server/lib/developerAggregates.ts): only teams with at least 3 opted-in contributing
  // developers count, each developer once. A separate workload signal, not wellbeing.
  const devSummary = await multiTeamDeveloperSummary(companyId, activeTeams.map((t: any) => String(t.id)));
  const workloadBalanceIndex = devSummary.averages.workloadBalance !== null ? Math.round(devSummary.averages.workloadBalance) : null;

  // Wellbeing (survey): the teams' latest closed pulse-survey period with at least 3 responses
  // (server/lib/pulse.ts wellbeingAcrossTeams). Field name developerWellnessIndex kept for the API.
  const wellbeing = await wellbeingAcrossTeams(activeTeams.map((t: any) => String(t.id)));
  const developerWellnessIndex = wellbeing.value !== null ? Math.round(wellbeing.value) : null;

  // Delivery performance (DORA): mean of per-team level scores over classified teams, weighted
  // by team size. A team with a stale DORA input is 'Unknown' (left out), like a missing one.
  const doraLevels: Record<DoraLevelOrUnknown, number> = { Elite: 0, High: 0, Medium: 0, Low: 0, Unknown: 0 };
  const doraScores: Array<{ value: number; weight: number }> = [];
  for (const t of teamsWithData) {
    const level = classifyDoraLevel({
      deployment_frequency_per_week: fresh(t, 'deployment_frequency_per_week'),
      lead_time_days: fresh(t, 'lead_time_days'),
      change_failure_rate: fresh(t, 'change_failure_rate'),
      mttr_hours: fresh(t, 'mttr_hours'),
    });
    doraLevels[level]++;
    if (level !== 'Unknown') doraScores.push({ value: DORA_LEVEL_SCORE[level], weight: weightOf(t.team_id) });
  }
  const doraMean = distributionOf(doraScores).weightedMean;
  const deliveryPerformanceScore = doraMean !== null ? Math.round(doraMean) : null;

  // Pipeline health: successful / (successful + failed) pipeline runs in the last
  // 30 days, for company-level pipelines (team_id NULL) and active teams.
  // Running and cancelled runs are excluded. Null when no completed runs.
  const pipe = await queryOne<any>(`
    SELECT COUNT(*) FILTER (WHERE pr.status = 'success') AS successful_runs,
           COUNT(*) FILTER (WHERE pr.status IN ('success', 'failed')) AS total_runs
    FROM pipeline_runs pr
    LEFT JOIN teams t ON t.id = pr.team_id
    WHERE pr.company_id = ?
      AND pr.started_at >= NOW() - INTERVAL '30 days'
      AND (pr.team_id IS NULL OR t.is_active = TRUE)
      AND (?::text[] IS NULL OR pr.team_id = ANY(?::text[]))
  `, [companyId, teamIds, teamIds]);
  const pipelineSuccessfulRuns = num(pipe?.successful_runs) ?? 0;
  const pipelineTotalRuns = num(pipe?.total_runs) ?? 0;
  const pipelineHealthScore = pipelineTotalRuns > 0
    ? roundTo((pipelineSuccessfulRuns / pipelineTotalRuns) * 100, 1)
    : null;

  // Engineering health: weighted mean over the components that have data
  const healthParts = {
    deliveryPerformance: deliveryPerformanceScore,
    pipelineHealth: pipelineHealthScore,
    techDebtStatus: techDebtStatusScore,
    wellbeingSurvey: wellbeing.value
  };
  const healthRaw = weightedMeanOf(
    (Object.keys(ENGINEERING_HEALTH_WEIGHTS) as Array<keyof typeof ENGINEERING_HEALTH_WEIGHTS>)
      .map(k => ({ value: healthParts[k], weight: ENGINEERING_HEALTH_WEIGHTS[k] }))
  );
  const engineeringHealthScore = healthRaw !== null ? Math.round(healthRaw) : null;
  const healthIncluded = (Object.keys(healthParts) as Array<keyof typeof healthParts>).filter(k => healthParts[k] !== null);
  const healthMissing = (Object.keys(healthParts) as Array<keyof typeof healthParts>).filter(k => healthParts[k] === null);
  const engineeringHealthConfidence = composite(engineeringHealthScore, healthIncluded.length, Object.keys(healthParts).length);
  const deliveryPerformanceConfidence = composite(deliveryPerformanceScore, doraScores.length, teamsWithData.length);
  // Any current KPI value of an active team comes from generated sample data.
  const sampleData = evaluated.some((x: any) => x.ev.sampleData);
  const round1 = (v: number | null) => roundTo(v, 1);

  // Rule-based summary text (no AI)
  let aiSummary: string;
  if (globalQaScore === null) {
    aiSummary = 'No KPI data available. Add KPI snapshots for active teams to see insights.';
  } else {
    if (globalQaScoreTrend === null) aiSummary = 'No QA score trend available (no snapshots 7-14 days ago). ';
    else if (globalQaScoreTrend > 0) aiSummary = `Quality improved by ${globalQaScoreTrend} points vs. 7-14 days ago. `;
    else if (globalQaScoreTrend < 0) aiSummary = `Quality declined by ${Math.abs(globalQaScoreTrend)} points vs. 7-14 days ago. `;
    else aiSummary = 'Quality unchanged vs. 7-14 days ago. ';
    const teamsLowCoverage = teamsWithData.filter((t: any) => {
      const v = fresh(t, 'test_coverage');
      return v !== null && v < evalOf.get(t.team_id)!.judge.targets.coverage;
    }).length;
    if (teamsLowCoverage > 0) aiSummary += `${teamsLowCoverage} team${teamsLowCoverage > 1 ? 's' : ''} below their test coverage target. `;
    if (automationCoverage !== null) {
      // The company-level automation target in force today (target history; default KPI_TARGETS).
      const automationTarget = evalCtx.book.at({ id: '', department_id: null }, companyId, 'automation_coverage', now).good;
      aiSummary += automationCoverage < automationTarget
        ? `Automation at ${automationCoverage}% - below the ${automationTarget}% target. `
        : `Automation coverage at ${automationCoverage}%. `;
    }
    if (asOf) aiSummary += `Based on KPI snapshots as of ${asOf}.`;
  }

  return {
    engineeringHealthScore,
    deliveryPerformanceScore,
    developerWellnessIndex,
    techDebtStatusScore,
    pipelineHealthScore,
    techDebtResolutionRate,

    globalQaScore,
    globalQaScoreTrend,
    // What the headline is based on (teams with a current QA score of the active teams).
    globalQaScoreConfidence,
    // Distribution of the current team QA scores (COMPANY_AGGREGATE_TEXT).
    globalQaScoreDistribution: {
      weightedMean: round1(qaDist.weightedMean),
      unweightedMean: round1(qaDist.unweightedMean),
      median: round1(qaDist.median),
      p25: round1(qaDist.p25),
      min: round1(qaDist.min),
      count: qaDist.count,
      weighting: COMPANY_AGGREGATE_TEXT,
    },
    engineeringHealthConfidence,
    deliveryPerformanceConfidence,
    kpiAveragesUnweighted,
    // The company-level KPI targets in force today (target history; the averages are compared with them).
    companyKpiTargets: {
      coverage: evalCtx.book.at({ id: '', department_id: null }, companyId, 'test_coverage', now).good,
      automation: evalCtx.book.at({ id: '', department_id: null }, companyId, 'automation_coverage', now).good,
      flakiness: evalCtx.book.at({ id: '', department_id: null }, companyId, 'test_flakiness_rate', now).good,
      escapeRate: evalCtx.book.at({ id: '', department_id: null }, companyId, 'defect_escape_rate', now).good,
    },
    sampleData,
    riskLevel,
    avgTestCoverage,
    avgDefectEscapeRate,
    automationCoverage,
    avgFlakinessRate,

    topImproving,
    needsAttention,
    kpiStatus: { onTrack, atRisk, offTrack, noData },
    kpiStatusTeams,
    aiSummary,
    teamCount: activeTeams.length,
    teamsWithKpiData: teamsWithData.length,

    // Staleness / provenance
    asOf,
    oldestSnapshotDate,
    lastUpdated,
    dataOutdated,
    engineeringHealthBasis: {
      weights: ENGINEERING_HEALTH_WEIGHTS,
      included: healthIncluded,
      missing: healthMissing
    },
    deliveryPerformanceBasis: {
      method: 'Mean of per-team DORA level scores (Elite 100, High 80, Medium 60, Low 40), weighted by team size; bands as getDORALevel; teams with a missing or stale input are not classified',
      teamsClassified: doraScores.length,
      levels: doraLevels
    },
    developerWellnessBasis: {
      method: wellbeing.method,
      teamsReporting: wellbeing.teamsReporting,
      teamsTotal: wellbeing.teamsTotal,
      teamsSuppressed: wellbeing.teamsSuppressed,
      responses: wellbeing.responses,
      minResponses: K_ANONYMITY_MIN
    },
    // Workload balance (derived): a separate workload signal from developer metrics, not wellbeing.
    workloadBalanceIndex,
    workloadBalanceBasis: {
      method: 'Workload balance (derived): mean of developer_metrics.happiness_score, calculated from focus, meetings, context switches, PR and review times. Not a survey score and not wellbeing.',
      basis: devSummary.basis,
      ...devSummary.privacy,
      teamsIncluded: devSummary.teamsIncluded,
      teamsSuppressed: devSummary.teamsSuppressed,
      avgFocusHours: roundTo(devSummary.averages.focusHours, 1),
      avgMeetingHours: roundTo(devSummary.averages.meetingHours, 1),
      avgContextSwitches: roundTo(devSummary.averages.contextSwitches, 1),
      burnoutRisk: devSummary.burnoutOfAverages
    },
    pipelineHealthBasis: {
      definition: 'Successful pipeline runs / (successful + failed) runs, last 30 days',
      successfulRuns: pipelineSuccessfulRuns,
      totalRuns: pipelineTotalRuns,
      windowDays: 30
    },
    techDebtBasis: { openItems: techDebtOpenItems, totalItems: techDebtTotalItems }
  };
}

// ============================================================================
// COMPANY-WIDE DASHBOARD SUMMARY (Hero Section)
// ============================================================================

router.get('/company-summary', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    // Super admins: the whole company. Everyone else: the teams of their analytics scope (the
    // same teams the overview lists), so no other team's figures reach them through the summary.
    const scope = await summaryTeamIds(req);
    const metrics = await computeCompanyMetrics(companyId, scope.teamIds);
    res.json({ ...metrics, scope: { level: scope.level, teamCount: metrics.teamCount, companyTeamCount: scope.companyTeamCount, companyWide: scope.teamIds === null } });
  } catch (error) {
    console.error('Error fetching company summary:', error);
    res.status(500).json({ error: 'Failed to fetch company summary' });
  }
});

// Get AI insights for company-wide metrics (Exec Dashboard)
router.post('/company-insights', aiLimiter, authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { companyId } = user;

    if (!canRequestExecutiveBriefing(policyActor(req))) {
      return res.status(403).json({ error: 'Executive insights are restricted.' });
    }

    // 1. Same numbers as company-summary (shared helper), for the caller's scope
    const scope = await summaryTeamIds(req);
    const m = await computeCompanyMetrics(companyId, scope.teamIds);
    const companyWide = scope.teamIds === null;

    // 2. Store Snapshot (nulls stay null): company-wide figures only
    if (companyWide) await query(`
      INSERT INTO company_kpi_snapshots 
      (company_id, snapshot_date, engineering_health_score, delivery_performance_score, developer_wellness_index, tech_debt_status_score, pipeline_health_score, avg_qa_score, avg_test_coverage, avg_defect_escape_rate, avg_flakiness_rate, automation_coverage)
      VALUES (?, CURRENT_DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (company_id, snapshot_date) DO UPDATE SET
      engineering_health_score = EXCLUDED.engineering_health_score,
      delivery_performance_score = EXCLUDED.delivery_performance_score,
      developer_wellness_index = EXCLUDED.developer_wellness_index,
      tech_debt_status_score = EXCLUDED.tech_debt_status_score,
      pipeline_health_score = EXCLUDED.pipeline_health_score,
      avg_qa_score = EXCLUDED.avg_qa_score,
      avg_test_coverage = EXCLUDED.avg_test_coverage,
      avg_defect_escape_rate = EXCLUDED.avg_defect_escape_rate,
      avg_flakiness_rate = EXCLUDED.avg_flakiness_rate,
      automation_coverage = EXCLUDED.automation_coverage
    `, [
      companyId,
      m.engineeringHealthScore, m.deliveryPerformanceScore, m.developerWellnessIndex, m.techDebtStatusScore, m.pipelineHealthScore,
      m.globalQaScore, m.avgTestCoverage, m.avgDefectEscapeRate, m.avgFlakinessRate, m.automationCoverage
    ]);

    // 3. History: company snapshots from the last 30 days (company-wide callers only; the stored
    // snapshots are company aggregates and would show other teams' figures to a scoped caller)
    const history = companyWide ? await query<any>(`
      SELECT * FROM company_kpi_snapshots 
      WHERE company_id = ? 
        AND snapshot_date >= CURRENT_DATE - 30
      ORDER BY snapshot_date ASC
    `, [companyId]) : [];

    // 4. Generate AI Analysis (retries + smaller-model fallback)
    let aiAnalysis = isGroqConfigured()
      ? "AI analysis unavailable: the AI service did not respond. Try again in a minute."
      : "AI analysis unavailable: no AI key is configured on the server (set GROQ_API_KEY).";
    const fmt = (v: number | null) => (v === null ? 'no data' : `${v}/100`);

    if (isGroqConfigured()) {
      console.log('Generating Company Insights via Groq AI...');
      try {
        const { content, model } = await groqChatCompletion({
          label: 'AI:Company',
          maxTokens: 500,
          messages: [
            {
              role: 'system',
              content: `You are a CTO/VP of Engineering advisor. Analyze these ${companyWide ? 'company-wide metrics' : `metrics of the ${m.teamCount} team${m.teamCount === 1 ? '' : 's'} in the reader's scope`} and trends.

Current Metrics (team KPI snapshots as of ${m.asOf ?? 'unknown date'}; "no data" means not measured, do not guess a value):
- Engineering Health: ${fmt(m.engineeringHealthScore)} (components without data are excluded: ${m.engineeringHealthBasis.missing.join(', ') || 'none'})
- Delivery (DORA): ${fmt(m.deliveryPerformanceScore)}
- Wellbeing (anonymous pulse survey, teams with at least 3 responses): ${fmt(m.developerWellnessIndex)}
- Workload balance (derived from focus/meeting/context-switch/PR/review inputs; a workload signal, not wellbeing): ${fmt(m.workloadBalanceIndex)}
- Tech Debt Status: ${fmt(m.techDebtStatusScore)}
- Pipeline Health (successful pipeline runs, last 30 days): ${m.pipelineHealthScore === null ? 'no data' : `${m.pipelineHealthScore}%`}

Provide a concise executive summary (3-4 sentences) highlighting the biggest risk and the biggest win. If the data is old, say so. Then provide 3 strategic recommendations.`
            },
            {
              role: 'user',
              content: `Here are the company snapshots from the last 30 days (${history.length} snapshot${history.length === 1 ? '' : 's'}): ${JSON.stringify(history.map((h: any) => ({ date: h.snapshot_date, health: h.engineering_health_score, dora: h.delivery_performance_score })))}`
            }
          ]
        });
        aiAnalysis = content || "Analysis generation failed.";
        console.log('[AI:Company] Groq responded via', model);
      } catch (err: any) {
        console.error("[AI:Company] Groq failed after retries:", err.message);
      }
    }

    res.json({
      metrics: {
        engineeringHealthScore: m.engineeringHealthScore,
        deliveryPerformanceScore: m.deliveryPerformanceScore,
        developerWellnessIndex: m.developerWellnessIndex,
        workloadBalanceIndex: m.workloadBalanceIndex,
        techDebtStatusScore: m.techDebtStatusScore,
        pipelineHealthScore: m.pipelineHealthScore
      },
      asOf: m.asOf,
      history,
      analysis: aiAnalysis
    });

  } catch (error) {
    console.error('Error generating company insights:', error);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

// ============================================================================
// DDPS (Daily Developer Productivity Score) HISTORY
// ============================================================================
router.get('/ddps-history', authenticateToken, async (req: any, res) => {
  try {
    const { companyId, role, primaryTeamId, id: userId } = req.user;
    const {
      developerId,
      teamId: requestedTeamId,
      range = '30d' // 1d, 7d, 30d, 3m, 6m
    } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate: Date;
    switch (range) {
      case '1d': startDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); break;
      case '7d': startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
      case '30d': startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      case '3m': startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); break;
      case '6m': startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000); break;
      default: startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    const startDateStr = startDate.toISOString().split('T')[0];

    const scope = await resolveAnalyticsTeam(req, res, requestedTeamId);
    if (!scope) return;
    const teamId = scope.teamId;
    // Individual productivity data: only roles with canViewIndividualDevelopers see other
    // developers' snapshots; qa_engineer / viewer see only their own.
    const privileged = canViewIndividualDevelopers(policyActor(req), scope.team);

    // Build query
    let sql = `
      SELECT
        dps.developer_id,
        (u.first_name || ' ' || u.last_name) as developer_name,
        dps.snapshot_date,
        dps.ddps_score,
        dps.focus_time_hours,
        dps.pr_merge_time_avg,
        dps.code_review_time_avg,
        dps.meeting_time_hours,
        dps.context_switches_per_day,
        dps.focus_time_norm,
        dps.pr_time_norm,
        dps.review_time_norm,
        dps.meeting_time_norm,
        dps.context_switches_norm,
        u.developer_insights_enabled AS insights_enabled,
        u.is_active AS user_active
      FROM developer_productivity_snapshots dps
      JOIN users u ON dps.developer_id = u.id
      WHERE u.company_id = ?
        AND dps.snapshot_date >= ?
        AND (u.developer_insights_enabled = TRUE OR u.id = ?)
    `;
    // Same opt-out rule as /developer-metrics: individual data only for people who
    // enabled developer insights (everyone may see their own).
    const params: any[] = [companyId, startDateStr, userId];

    // Filter by specific developer
    if (!privileged) {
      sql += ' AND dps.developer_id = ?';
      params.push(userId);
    } else if (developerId && developerId !== 'all') {
      sql += ' AND dps.developer_id = ?';
      params.push(developerId);
    }

    // Filter by team membership (snapshots carry no team id): team members (assignments),
    // or users whose metrics are recorded for the team.
    if (teamId) {
      sql += ` AND (${isTeamMemberSql('u', '?')}
        OR EXISTS (SELECT 1 FROM developer_metrics dm WHERE dm.developer_id = u.id AND dm.team_id = ?))`;
      params.push(teamId, teamId);
    }

    sql += ' ORDER BY dps.snapshot_date ASC, dps.developer_id';

    const rawSnapshots = await query<any>(sql, params);

    // One DDPS definition: computeDdps (0-100) from each snapshot's inputs, returned as
    // a 0-1 fraction (score / 100) like the ddps_score column. Snapshots with missing
    // inputs have no score and are left out.
    const scored = rawSnapshots
      .map((s: any) => {
        const { score } = computeDdps(s);
        return score === null ? null : { ...s, ddps_score: Math.round(score * 100) / 10000 };
      })
      .filter((s: any) => s !== null) as any[];

    // Team mode (several developers): every statistic below is an aggregate of individual data,
    // so only opted-in, active developers contribute and each figure needs at least 3 of them
    // (server/lib/privacy.ts); a day with fewer is not shown. Single-developer mode (your own
    // snapshots, or one developer a lead may see) is individual data under the row rules above.
    const teamMode = privileged && !(developerId && developerId !== 'all');
    const snapshots = teamMode ? scored.filter((s: any) => s.insights_enabled === true && s.user_active !== false) : scored;
    const distinctDevs = (rows: any[]) => new Set(rows.map((r: any) => String(r.developer_id))).size;
    const aggregatePrivacy = teamMode ? privacyInfo(distinctDevs(snapshots)) : null;
    const shown = (rows: any[]) => !teamMode || distinctDevs(rows) >= K_ANONYMITY_MIN;

    // Aggregate data by date for chart
    const dailyAverages: Record<string, { count: number; totalDDPS: number; date: string }> = {};
    snapshots.forEach((s: any) => {
      const dateStr = String(s.snapshot_date); // DATE → 'YYYY-MM-DD' (db.ts type parser)
      if (!dailyAverages[dateStr]) {
        dailyAverages[dateStr] = { count: 0, totalDDPS: 0, date: dateStr };
      }
      dailyAverages[dateStr].count++;
      dailyAverages[dateStr].totalDDPS += parseFloat(s.ddps_score);
    });

    const chartData = Object.values(dailyAverages)
      .map(d => {
        const ok = !teamMode || d.count >= K_ANONYMITY_MIN;
        return {
          date: d.date,
          ddps: ok ? Math.round((d.totalDDPS / d.count) * 100) / 100 : null,
          developers: ok ? d.count : null,
          suppressed: !ok
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calculate overall stats (null when there are no snapshots in the range)
    const allDDPS = (shown(snapshots) ? snapshots : []).map((s: any) => parseFloat(s.ddps_score)).filter((v: number) => Number.isFinite(v));
    const hasData = allDDPS.length > 0;
    const avgDDPS = hasData ? allDDPS.reduce((a: number, b: number) => a + b, 0) / allDDPS.length : null;
    const minDDPS = hasData ? Math.min(...allDDPS) : null;
    const maxDDPS = hasData ? Math.max(...allDDPS) : null;

    // Trend (last 7 days vs previous 7 days); null unless both windows have data
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const recent = snapshots.filter((s: any) =>
      String(s.snapshot_date) >= sevenDaysAgo
    );
    const previous = snapshots.filter((s: any) => {
      const dateStr = String(s.snapshot_date); // DATE → 'YYYY-MM-DD' (db.ts type parser)
      return dateStr >= fourteenDaysAgo && dateStr < sevenDaysAgo;
    });

    const recentAvg = recent.length > 0 && shown(recent)
      ? recent.reduce((a: number, s: any) => a + parseFloat(s.ddps_score), 0) / recent.length
      : null;
    const previousAvg = previous.length > 0 && shown(previous)
      ? previous.reduce((a: number, s: any) => a + parseFloat(s.ddps_score), 0) / previous.length
      : null;
    const trend = recentAvg !== null && previousAvg !== null && previousAvg > 0
      ? ((recentAvg - previousAvg) / previousAvg) * 100
      : null;

    // Executive summary: only when there is data. DDPS is a composite points score
    // (see DDPS_FORMULA in server/lib/metricFormulas.ts); it is not a measured share
    // of the working day. Values here are 0-1 fractions (score / 100).
    let executiveSummary: null | { headline: string; status: string; lossDrivers: string; recommendation: string } = null;
    if (hasData && avgDDPS !== null) {
      let summaryStatus = 'fragmented';
      if (avgDDPS >= 0.8) summaryStatus = 'exceptional deep-focus';
      else if (avgDDPS >= 0.6) summaryStatus = 'high productivity';
      else if (avgDDPS >= 0.4) summaryStatus = 'healthy';
      else if (avgDDPS >= 0.2) summaryStatus = 'low productivity';

      const avgOf = (field: string) =>
        snapshots.reduce((a: number, s: any) => a + parseFloat(s[field]), 0) / snapshots.length;
      const avgMetrics = {
        meeting: avgOf('meeting_time_hours'),
        contextSwitches: avgOf('context_switches_per_day'),
        focusTime: avgOf('focus_time_hours')
      };

      const lossDrivers: string[] = [];
      // Same bands as developer health and Team detail (METRICS_CONFIG "good" thresholds).
      if (avgMetrics.meeting > METRICS_CONFIG.meetingTimeHours.good) lossDrivers.push(`meetings above ${METRICS_CONFIG.meetingTimeHours.good} h/day`);
      if (avgMetrics.contextSwitches > METRICS_CONFIG.contextSwitchesPerDay.good) lossDrivers.push(`context switching above ${METRICS_CONFIG.contextSwitchesPerDay.good}/day`);
      if (avgMetrics.focusTime < METRICS_CONFIG.focusTimeHours.good) lossDrivers.push(`focus time below ${METRICS_CONFIG.focusTimeHours.good} h/day`);

      executiveSummary = {
        headline: `Average DDPS ${Math.round(avgDDPS * 100)}/100 across ${snapshots.length} daily snapshots.`,
        status: summaryStatus,
        lossDrivers: lossDrivers.length > 0
          ? `Possible loss drivers: ${lossDrivers.join(' and ')}.`
          : 'No significant loss drivers identified.',
        recommendation: avgDDPS < 0.4
          ? 'Consider reducing meetings and protecting focus time blocks.'
          : avgDDPS < 0.6
            ? 'Look for opportunities to minimize interruptions.'
            : 'Maintain current practices.'
      };
    }

    const r4 = (v: number | null) => (v === null ? null : Math.round(v * 10000) / 10000);

    res.json({
      range,
      startDate: startDateStr,
      endDate: now.toISOString().split('T')[0],
      stats: {
        average: r4(avgDDPS),
        min: r4(minDDPS),
        max: r4(maxDDPS),
        trend: trend === null ? null : Math.round(trend * 100) / 100,
        totalSnapshots: snapshots.length,
        latestSnapshotDate: chartData.length ? chartData[chartData.length - 1].date : null
      },
      // 'team': aggregates over developers (k-anonymous, see aggregatePrivacy); 'developer': one person's own data.
      mode: teamMode ? 'team' : 'developer',
      aggregatePrivacy,
      executiveSummary,
      chartData,
      // Individual rows the caller may see (last 100 for the detail view).
      snapshots: scored.slice(-100).map(({ insights_enabled, user_active, ...row }: any) => row)
    });

  } catch (error) {
    console.error('Error fetching DDPS history:', error);
    res.status(500).json({ error: 'Failed to fetch DDPS history' });
  }
});

export default router;
