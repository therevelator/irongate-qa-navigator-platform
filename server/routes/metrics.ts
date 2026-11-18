import express from 'express';
import { randomUUID } from 'crypto';
import { afterKpiWrite } from '../lib/alerts';
import { KpiValidationError, normaliseIdempotencyKey, notifyKpisUpdated, parseRecordedAt, recordKpiValues, validateKpiValues } from '../lib/kpiIngest';
import { findReplay, logRejected, requestHash, runLogged, sendReplay, type IngestCaller, type ItemSummary } from '../lib/ingestionLog';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { assertTeamRead, assertTeamWrite, canManageCompanyData, getOwnedTeam, policyActor } from '../middleware/access';
import { canViewDeveloperRow } from '../lib/userPolicy';
import { BI_CONFIG_FIELDS, DEVELOPER_METRIC_FIELDS, dataExceptionMessage, isDataException, parseRangedFields } from '../lib/inputRanges';
import { teamMemberCountSql } from '../lib/teamMembership';
import { teamDeveloperSummary } from '../lib/developerAggregates';
import { K_ANONYMITY_MIN, K_ANONYMITY_RULE, SUPPRESSED_TEXT } from '../lib/privacy';
import { WELLBEING_FORMULA, wellbeingAcrossTeams } from '../lib/pulse';
import {
  BURNOUT_DEFINITION,
  computeQaScore,
  QA_SCORE_FORMULA,
  QA_SCORE_WEIGHTS,
  TECH_DEBT_SEVERITY_WEIGHTS,
  TECH_DEBT_OPEN_WEIGHT_SQL,
  TECH_DEBT_SCORE_FORMULA,
  techDebtScoreFromWeight,
  toNum,
  COMPANY_AGGREGATE_TEXT,
  distributionOf,
} from '../lib/metricFormulas';
import { evaluateSnapshot, type EvalContext, type SnapshotEvaluation } from '../lib/kpiEvaluation';
import { loadIntervals, referenceFor, STALENESS_RULE_TEXT } from '../lib/staleness';
import { loadTargetBook } from '../lib/targets';

/** Round a DB numeric (often a string) to `digits` decimals; null stays null. */
function roundOrNull(value: unknown, digits: number): number | null {
  const n = toNum(value as any);
  return n === null ? null : Number(n.toFixed(digits));
}

const router = express.Router();

/* ------------------------------------------------------------------------------------------
 * Company-level metric reads. Staleness-aware (R2 Phase 4): a value older than its expected
 * update interval is left out (server/lib/kpiEvaluation.ts), and the QA score is the composite
 * with stale inputs left out (qaScoreComposite), as on the dashboard and team detail.
 * ---------------------------------------------------------------------------------------- */

/** Snapshot columns averaged by GET /analytics/history (column → response key, digits). */
const HISTORY_COLUMNS: Array<[string, string, number]> = [
  ['test_coverage', 'testCoverage', 2], ['defect_density', 'defectDensity', 3], ['automation_coverage', 'automationCoverage', 2],
  ['code_quality_score', 'codeQuality', 2], ['deployment_frequency_per_week', 'deploymentFrequency', 2], ['mttr_hours', 'mttr', 2],
  ['lead_time_days', 'leadTime', 2], ['change_failure_rate', 'changeFailureRate', 2], ['sprint_velocity', 'sprintVelocity', 2],
  ['first_time_pass_rate', 'firstTimePassRate', 2],
];
const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

async function evalContext(companyId: string): Promise<EvalContext> {
  return { companyId, intervals: await loadIntervals(companyId), book: await loadTargetBook(companyId) };
}

/** Latest snapshot of every active team of the company, evaluated now (stale values flagged). */
async function latestEvaluated(companyId: string): Promise<Array<{ row: any; ev: SnapshotEvaluation | null }>> {
  const rows: any[] = await query<any>(
    `SELECT t.id, t.name, t.department_id, d.name AS department_name, ${teamMemberCountSql('t')} AS member_count, k.*,
            t.id AS id, t.name AS name
       FROM teams t
       LEFT JOIN departments d ON d.id = t.department_id
       LEFT JOIN LATERAL (SELECT * FROM kpi_snapshots ks WHERE ks.team_id = t.id ORDER BY ks.snapshot_date DESC LIMIT 1) k ON TRUE
      WHERE t.company_id = ? AND t.is_active = TRUE`,
    [companyId]
  );
  const ctx = await evalContext(companyId);
  const now = Date.now();
  return rows.map((r: any) => ({
    row: r,
    ev: r.snapshot_date ? evaluateSnapshot(r, { id: String(r.id), department_id: r.department_id }, ctx, now) : null,
  }));
}

// Get aggregated metrics history for analytics (across all teams in company): per day, the
// mean of the teams' values that were current on that day (stale values left out).
router.get('/analytics/history', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { days = '30' } = req.query;
    const numDays = Math.min(parseInt(days as string) || 30, 90);

    const rows = await query<any>(
      `SELECT k.*, t.department_id
         FROM kpi_snapshots k
         JOIN teams t ON k.team_id = t.id
        WHERE t.company_id = ? AND t.is_active = true
          AND k.snapshot_date >= CURRENT_DATE - CAST(? AS INTEGER)
        ORDER BY k.snapshot_date ASC`,
      [companyId, numDays]
    );
    const ctx = await evalContext(companyId);
    const byDay = new Map<string, any[]>();
    for (const r of rows) {
      const day = String(r.snapshot_date);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(r);
    }
    const chartData = [...byDay.entries()].map(([day, list]) => {
      const evs = list.map((r) => ({ r, ev: evaluateSnapshot(r, { id: String(r.team_id), department_id: r.department_id }, ctx, referenceFor(day)) }));
      const out: Record<string, any> = { date: day };
      for (const [col, key, digits] of HISTORY_COLUMNS) {
        const vals = evs.filter((x) => x.ev.values[col] && !x.ev.values[col].stale).map((x) => toNum(x.r[col])).filter((v): v is number => v !== null);
        out[key] = roundOrNull(meanOf(vals), digits);
      }
      out.qaScore = roundOrNull(meanOf(evs.map((x) => x.ev.qa.value).filter((v): v is number => v !== null)), 2);
      out.teamCount = new Set(list.map((r) => r.team_id)).size;
      return out;
    });

    res.json({ history: chartData, days: numDays, staleness: STALENESS_RULE_TEXT });
  } catch (error) {
    console.error('Error fetching analytics history:', error);
    res.status(500).json({ error: 'Failed to fetch analytics history' });
  }
});

// Get per-team metrics comparison for analytics (latest snapshot per active team). Stale values
// are null (listed in stale_metrics); qa_score leaves stale inputs out (qa_score_recorded = stored).
router.get('/analytics/teams', authenticateToken, async (req: any, res) => {
  try {
    const cols = ['test_coverage', 'defect_density', 'automation_coverage', 'deployment_frequency_per_week', 'mttr_hours', 'change_failure_rate', 'sprint_velocity'];
    const teams = (await latestEvaluated(req.user.companyId)).map(({ row, ev }): Record<string, any> => {
      const stale = cols.filter((c) => ev?.values[c]?.stale);
      const t: Record<string, any> = {
        id: row.id, name: row.name,
        qa_score: ev ? ev.qa.value : null,
        qa_score_recorded: toNum(row.qa_score),
        snapshot_date: row.snapshot_date ?? null,
        stale_metrics: stale,
      };
      for (const c of cols) t[c] = stale.includes(c) ? null : toNum(row[c]);
      return t;
    }).sort((a, b) => (b.qa_score ?? -1) - (a.qa_score ?? -1) || String(a.name).localeCompare(String(b.name)));

    res.json({ teams, staleness: STALENESS_RULE_TEXT });
  } catch (error) {
    console.error('Error fetching team analytics:', error);
    res.status(500).json({ error: 'Failed to fetch team analytics' });
  }
});

// Get team KPIs (latest snapshot)
router.get('/teams/:teamId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!(await assertTeamRead(req, res, req.params.teamId))) return;
    const snapshot = await queryOne<any>(
      `SELECT * FROM kpi_snapshots
       WHERE team_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      [req.params.teamId]
    );

    if (!snapshot) {
      return res.status(404).json({ error: 'No metrics found for this team' });
    }

    res.json({ snapshot });
  } catch (error) {
    console.error('Get metrics error:', error);
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

// Get team KPI history
router.get('/teams/:teamId/history', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!(await assertTeamRead(req, res, req.params.teamId))) return;
    const { days = '30' } = req.query;

    const history = await query<any[]>(
      `SELECT * FROM kpi_snapshots
       WHERE team_id = ?
       AND snapshot_date >= CURRENT_DATE - CAST(? AS INTEGER)
       ORDER BY snapshot_date DESC`,
      [req.params.teamId, Math.min(parseInt(days as string) || 30, 365)]
    );

    res.json({ history });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

// Get sprint velocity
router.get('/teams/:teamId/velocity', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!(await assertTeamRead(req, res, req.params.teamId))) return;
    const velocity = await query<any[]>(
      `SELECT * FROM sprint_velocity
       WHERE team_id = ?
       ORDER BY start_date DESC
       LIMIT 10`,
      [req.params.teamId]
    );

    res.json({ velocity });
  } catch (error) {
    console.error('Get velocity error:', error);
    res.status(500).json({ error: 'Failed to get velocity' });
  }
});

// Get dashboard summary for the caller's company.
router.get('/dashboard', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const companyId = req.companyId;

    // Total active teams in this company.
    const totalTeamsResult = await queryOne<any>(
      `SELECT COUNT(*) as count FROM teams WHERE company_id = ? AND is_active = true`,
      [companyId]
    );
    const totalTeams = Number(totalTeamsResult?.count) || 0;

    // Company QA score: team-size weighted mean of the teams' current QA scores (stale inputs
    // left out), the same definition as the dashboard hero (distributionOf, COMPANY_AGGREGATE_TEXT).
    const evaluated = await latestEvaluated(companyId as string);
    const scored = evaluated.filter((e) => e.ev && e.ev.qa.value !== null);
    const overallPassRate = distributionOf(scored.map((e) => ({ value: e.ev!.qa.value, weight: e.row.member_count }))).weightedMean;

    // Open / critical technical-debt items act as the "defects" signal.
    const openDefectsResult = await queryOne<any>(
      `SELECT COUNT(*) as count
       FROM technical_debt td
       JOIN teams t ON td.team_id = t.id
       WHERE t.company_id = ? AND t.is_active = true AND td.status IN ('open', 'in_progress')`,
      [companyId]
    );
    const openDefects = Number(openDefectsResult?.count) || 0;

    const criticalDefectsResult = await queryOne<any>(
      `SELECT COUNT(*) as count
       FROM technical_debt td
       JOIN teams t ON td.team_id = t.id
       WHERE t.company_id = ? AND t.is_active = true AND td.severity = 'critical' AND td.status IN ('open', 'in_progress')`,
      [companyId]
    );
    const criticalDefects = Number(criticalDefectsResult?.count) || 0;

    // Top teams by current QA score (stale inputs left out).
    const topTeams = scored
      .sort((a, b) => b.ev!.qa.value! - a.ev!.qa.value! || String(a.row.name).localeCompare(String(b.row.name)))
      .slice(0, 5)
      .map((e) => ({ id: e.row.id, name: e.row.name, department_name: e.row.department_name, pass_rate: e.ev!.qa.value }));

    res.json({
      stats: {
        totalTeams,
        overallPassRate: overallPassRate === null ? null : parseFloat(overallPassRate.toFixed(1)),
        openDefects,
        criticalDefects
      },
      aggregate: COMPANY_AGGREGATE_TEXT,
      topTeams: topTeams.map(team => ({
        id: team.id,
        name: team.name,
        department_name: team.department_name,
        passRate: roundOrNull(team.pass_rate, 1)
      }))
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to get dashboard data' });
  }
});

// Manual metrics input (super_admin, qa_manager, team_lead)
// Body: { teamId, recordedAt?, <column>: number, … }. recordedAt = the time the values are for
// (default now; backdating updates that day's snapshot and later days without a newer value).
// Header Idempotency-Key: a retried submit returns the stored result without writing twice.
// Recorded in the ingestion log (channel 'manual').
router.post('/manual', authenticateToken, async (req: AuthRequest, res) => {
  const caller: IngestCaller = { companyId: req.companyId as string, channel: 'manual', actorId: req.userId ?? null };
  const hash = requestHash(req.body ?? null);
  let key: string | null = null;
  const { teamId, recordedAt: rawRecordedAt, ...metricValues } = req.body ?? {};
  const summary = (status: ItemSummary['status'], extra: Partial<ItemSummary> = {}): ItemSummary => ({
    index: 0, teamId: typeof teamId === 'string' ? teamId : null, source: 'manual',
    recordedAt: typeof rawRecordedAt === 'string' ? rawRecordedAt.slice(0, 40) : null,
    metrics: Object.keys(metricValues).slice(0, 40), status, ...extra,
  });
  try {
    // Who may write is the shared team-write rule (assertTeamWrite → canWriteTeamData).
    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    // Tenant + role scope: team must belong to the caller's company and the
    // caller must be allowed to write it (team_lead -> own team only).
    if (!(await assertTeamWrite(req, res, teamId))) return;

    key = normaliseIdempotencyKey(req.get('Idempotency-Key'), 'Idempotency-Key');
    if (key) {
      const replay = await findReplay(caller, key);
      if (replay) return sendReplay(res, replay, hash);
    }
    const recordedAt = parseRecordedAt(rawRecordedAt);
    validateKpiValues(metricValues);

    // The shared ingestion path: validates against the KPI whitelist, stores the values
    // (metric_values) and re-derives the snapshots of that day and later, records provenance
    // (source 'manual') and notifies open dashboards. qa_score/status are computed by the
    // database trigger from the stored inputs.
    const out = await runLogged(caller, { key, hash, source: 'manual' }, async (client, ingestionId) => {
      const result = await recordKpiValues(teamId, metricValues, {
        source: 'manual',
        actorId: req.userId ?? null,
        recordedAt,
        client,
        notify: false,
        ingestionId,
      });
      const [qa] = (await client.query(
        `SELECT test_coverage, defect_escape_rate, change_failure_rate, code_quality_score
           FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date = $2::date`,
        [teamId, result.snapshotDate]
      )).rows;
      const response = {
        message: 'Metrics saved successfully',
        qaScore: result.qaScore,
        status: result.status ?? 'insufficient-data',
        qaScoreFormula: QA_SCORE_FORMULA,
        qaScoreMissingInputs: computeQaScore(qa).missingInputs,
        snapshotDate: result.snapshotDate,
        recordedAt: result.recordedAt,
        updated: result.updated,
        carriedForward: result.carriedForward
      };
      return {
        status: 'accepted' as const, httpStatus: 200, response,
        items: [summary('written', { snapshotDate: result.snapshotDate, recordedAt: result.recordedAt, qaScore: result.qaScore })],
        errors: [], teamIds: [teamId], valueCount: result.updated.length, source: 'manual',
      };
    });
    if ('replay' in out) return sendReplay(res, out.replay, hash);
    notifyKpisUpdated(out.outcome.response.updated, 'manual');
    await afterKpiWrite(caller.companyId, [teamId]);
    res.json(out.outcome.response);
  } catch (error) {
    if (error instanceof KpiValidationError) {
      await logRejected(caller, { key, hash }, {
        httpStatus: 400, response: { error: error.message, details: error.errors },
        items: [summary('error', { errors: error.errors })], errors: [{ index: 0, errors: error.errors }],
        teamIds: typeof teamId === 'string' ? [teamId] : [], source: 'manual',
      });
      return res.status(400).json({ error: error.message, details: error.errors });
    }
    console.error('Manual metrics error:', error);
    res.status(500).json({ error: 'Failed to save metrics' });
  }
});

// Save developer metrics (team data writers: super_admin, the department's QA managers, the team's leads).
// Partial update: only the fields present in the body change; an omitted field keeps its stored
// value and an explicit null clears it. Every value is range-checked (400, never a database error).
router.post('/developer', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { teamId, developerId } = req.body ?? {};
    if (!teamId || !developerId) {
      return res.status(400).json({ error: 'Team ID and developer ID are required' });
    }

    // Team must belong to the caller's company and be writable by them (canWriteTeamData).
    if (!(await assertTeamWrite(req, res, teamId))) return;
    // The developer must belong to the same company (prevents cross-tenant ids).
    if (!(await developerInCompany(req, developerId))) {
      return res.status(400).json({ error: 'Invalid developer ID' });
    }

    // happiness_score is workload balance (derived), 0–100 (column numeric(4,1)).
    const parsed = parseRangedFields(req.body, DEVELOPER_METRIC_FIELDS);
    if (parsed.errors.length) return res.status(400).json({ error: parsed.errors[0], details: parsed.errors });
    const given = DEVELOPER_METRIC_FIELDS.filter((f) => parsed.values[f.key] !== undefined);
    const value = (key: string) => (parsed.values[key] === undefined ? null : parsed.values[key]);
    const cols = DEVELOPER_METRIC_FIELDS.map((f) => f.column);

    await query(
      `INSERT INTO developer_metrics (team_id, developer_id, ${cols.join(', ')})
       VALUES (?, ?, ${cols.map(() => '?').join(', ')})
       ON CONFLICT (team_id, developer_id) DO UPDATE SET
         ${given.length ? given.map((f) => `${f.column} = EXCLUDED.${f.column}`).join(', ') : 'team_id = EXCLUDED.team_id'}`,
      [teamId, developerId, ...DEVELOPER_METRIC_FIELDS.map((f) => value(f.key))]
    );

    res.json({
      message: 'Developer metrics saved successfully',
      teamId,
      developerId,
      updated: given.map((f) => f.key),
    });
  } catch (error) {
    if (isDataException(error)) return res.status(400).json({ error: dataExceptionMessage(error) });
    console.error('Developer metrics error:', error);
    res.status(500).json({ error: 'Failed to save developer metrics' });
  }
});

// Confirm the target developer is in the caller's company (tenant scope).
async function developerInCompany(req: AuthRequest, developerId: string): Promise<boolean> {
  const row = await queryOne<any>(
    'SELECT id FROM users WHERE id = ? AND company_id = ?',
    [developerId, req.companyId]
  );
  return !!row;
}

/**
 * Individual developer metric rows the caller may read for one developer: same company,
 * and per row the shared rule canViewDeveloperRow (server/lib/userPolicy.ts) for the team
 * the row was recorded for: your own rows on a team in your analytics scope; other
 * people's rows only for super_admin / qa_manager (department) / team_lead (own team) and
 * only when that person has not opted out of developer insights.
 * Returns null after writing 404 (no rows) or 403 (rows exist but none visible).
 */
async function visibleDeveloperRows(req: AuthRequest, res: express.Response, developerId: string, sinceDays?: number): Promise<any[] | null> {
  const params: any[] = [developerId, req.companyId, req.companyId];
  let sql = `SELECT dm.*, t.department_id AS team_department_id, u.developer_insights_enabled
       FROM developer_metrics dm
       JOIN users u ON u.id = dm.developer_id
       JOIN teams t ON t.id = dm.team_id
      WHERE dm.developer_id = ? AND u.company_id = ? AND t.company_id = ?`;
  sql += ' ORDER BY dm.created_at DESC';
  const rows = await query<any>(sql, params);
  if (!rows.length) {
    res.status(404).json({ error: 'No metrics found for this developer' });
    return null;
  }
  const actor = policyActor(req);
  const visible = rows.filter((r: any) => canViewDeveloperRow(
    actor,
    { id: String(r.team_id), department_id: r.team_department_id },
    { id: String(r.developer_id), developer_insights_enabled: r.developer_insights_enabled }
  ));
  if (!visible.length) {
    res.status(403).json({ error: 'You can only view your own individual developer metrics.' });
    return null;
  }
  const since = sinceDays === undefined ? null : Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  return visible
    .filter((r: any) => since === null || new Date(r.created_at).getTime() >= since)
    .map(({ team_department_id, developer_insights_enabled, ...row }: any) => row);
}

// Get latest developer metrics for a user (rows the caller may see; see visibleDeveloperRows).
router.get('/developer/:userId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const rows = await visibleDeveloperRows(req, res, req.params.userId as string);
    if (!rows) return;
    res.json({ metrics: rows[0] });
  } catch (error) {
    console.error('Get developer metrics error:', error);
    res.status(500).json({ error: 'Failed to get developer metrics' });
  }
});

// Get developer metrics history (rows the caller may see; see visibleDeveloperRows).
router.get('/developer/:userId/history', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { days = '30' } = req.query;
    const rows = await visibleDeveloperRows(req, res, req.params.userId as string, Math.min(parseInt(days as string) || 30, 365));
    if (!rows) return;
    res.json({ history: rows });
  } catch (error) {
    console.error('Get developer history error:', error);
    res.status(500).json({ error: 'Failed to get developer history' });
  }
});

// Get all metrics for a team (primary + composite with formulas)
router.get('/team/:teamId/all', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { teamId } = req.params;
    if (!(await assertTeamRead(req, res, teamId))) return;

    // Get latest KPI snapshot
    const kpi = await queryOne<any>(
      `SELECT * FROM kpi_snapshots 
       WHERE team_id = ? 
       ORDER BY snapshot_date DESC LIMIT 1`,
      [teamId]
    );

    // Get technical debt summary (shared weights: server/lib/metricFormulas.ts)
    const debtSummary = await queryOne<any>(
      `SELECT
        ${TECH_DEBT_OPEN_WEIGHT_SQL} AS open_weight,
        SUM(CASE WHEN status NOT IN ('resolved','wont_fix') THEN 1 ELSE 0 END) AS open_items,
        COUNT(*) as total_items
      FROM technical_debt WHERE team_id = ?`,
      [teamId]
    );

    // Developer metrics team averages: k-anonymous (server/lib/developerAggregates.ts; at least 3
    // opted-in contributing developers, else null). The 30-day head count is not an aggregate of
    // anyone's values.
    const devSummary = await teamDeveloperSummary(req.companyId!, teamId as string);
    const devAvg = devSummary.averages;
    const devMetrics = await queryOne<any>(
      `SELECT
        COUNT(DISTINCT CASE WHEN COALESCE(updated_at, created_at) >= NOW() - INTERVAL '30 days' THEN developer_id END) as developer_count_30d
      FROM developer_metrics
      WHERE team_id = ?`,
      [teamId]
    );

    // Get pipeline stages summary
    const pipelineMetrics = await queryOne<any>(
      `SELECT 
        COUNT(*) as total_stages,
        AVG(avg_duration_seconds / 60) as avg_duration,
        AVG(success_rate) as avg_success_rate,
        AVG(bottleneck_score) as avg_bottleneck_score,
        SUM(CASE WHEN bottleneck_score >= 70 THEN 1 ELSE 0 END) as bottleneck_count
      FROM pipeline_stages WHERE team_id = ?`,
      [teamId]
    );

    // Get team info
    const team = await queryOne<any>(
      `SELECT t.name, d.name as department_name,
        ${teamMemberCountSql('t')} as member_count
      FROM teams t 
      LEFT JOIN departments d ON t.department_id = d.id
      WHERE t.id = ?`,
      [teamId]
    );

    const technicalDebtScore = techDebtScoreFromWeight(debtSummary?.open_weight);

    // Privacy of the developer averages (suppressed: true when fewer than 3 contributors).
    const devPrivacy = { privacy: devSummary.privacy };
    // Wellbeing (survey): the team's latest closed pulse period (k-anonymous, server/lib/pulse.ts).
    const wellbeing = await wellbeingAcrossTeams([teamId as string]);

    // Primary metrics (directly stored/input) - show ALL even if null
    const primaryMetrics = [
      // Quality Metrics
      { id: 'test_coverage', name: 'Test Coverage', value: kpi?.test_coverage, unit: '%', category: 'quality', source: 'kpi_snapshots' },
      { id: 'test_flakiness_rate', name: 'Test Flakiness Rate', value: kpi?.test_flakiness_rate, unit: '%', category: 'quality', source: 'kpi_snapshots' },
      { id: 'defect_density', name: 'Defect Density', value: kpi?.defect_density, unit: '/1k LOC', category: 'quality', source: 'kpi_snapshots' },
      { id: 'defect_escape_rate', name: 'Defect Escape Rate', value: kpi?.defect_escape_rate, unit: '%', category: 'quality', source: 'kpi_snapshots' },
      { id: 'code_quality_score', name: 'Code Quality Score', value: kpi?.code_quality_score, unit: '/100', category: 'quality', source: 'kpi_snapshots' },
      { id: 'first_time_pass_rate', name: 'First-Time Pass Rate', value: kpi?.first_time_pass_rate, unit: '%', category: 'quality', source: 'kpi_snapshots' },
      
      // Speed & Efficiency Metrics
      { id: 'avg_build_time_minutes', name: 'Average Build Time', value: kpi?.avg_build_time_minutes, unit: 'min', category: 'speed', source: 'kpi_snapshots' },
      { id: 'test_execution_time_minutes', name: 'Test Execution Time', value: kpi?.test_execution_time_minutes, unit: 'min', category: 'speed', source: 'kpi_snapshots' },
      { id: 'deployment_frequency_per_week', name: 'Deployment Frequency', value: kpi?.deployment_frequency_per_week, unit: '/week', category: 'speed', source: 'kpi_snapshots' },
      { id: 'lead_time_days', name: 'Lead Time for Changes', value: kpi?.lead_time_days, unit: 'days', category: 'speed', source: 'kpi_snapshots' },
      { id: 'mttr_hours', name: 'Mean Time to Recovery', value: kpi?.mttr_hours, unit: 'hours', category: 'speed', source: 'kpi_snapshots' },
      { id: 'parallel_test_efficiency', name: 'Parallel Test Efficiency', value: kpi?.parallel_test_efficiency, unit: '%', category: 'speed', source: 'kpi_snapshots' },
      
      // Agile Metrics
      { id: 'sprint_velocity', name: 'Sprint Velocity', value: kpi?.sprint_velocity, unit: 'pts', category: 'agile', source: 'kpi_snapshots' },
      { id: 'sprint_commitment_rate', name: 'Sprint Commitment Rate', value: kpi?.sprint_commitment_rate, unit: '%', category: 'agile', source: 'kpi_snapshots' },
      { id: 'sprint_carryover', name: 'Sprint Carryover', value: kpi?.sprint_carryover, unit: '%', category: 'agile', source: 'kpi_snapshots' },
      { id: 'blocked_time_hours', name: 'Blocked Time', value: kpi?.blocked_time_hours, unit: 'hours', category: 'agile', source: 'kpi_snapshots' },
      { id: 'automation_coverage', name: 'Automation Coverage', value: kpi?.automation_coverage, unit: '%', category: 'agile', source: 'kpi_snapshots' },
      { id: 'automation_roi', name: 'Automation ROI', value: kpi?.automation_roi, unit: '%', category: 'agile', source: 'kpi_snapshots' },
      { id: 'sizing_accuracy', name: 'Sizing Accuracy', value: kpi?.sizing_accuracy, unit: 'x', category: 'agile', source: 'kpi_snapshots' },
      
      // Reliability Metrics
      { id: 'change_failure_rate', name: 'Change Failure Rate', value: kpi?.change_failure_rate, unit: '%', category: 'reliability', source: 'kpi_snapshots' },
      { id: 'mtbf_hours', name: 'Mean Time Between Failures', value: kpi?.mtbf_hours, unit: 'hours', category: 'reliability', source: 'kpi_snapshots' },
      { id: 'system_availability', name: 'System Availability', value: kpi?.system_availability, unit: '%', category: 'reliability', source: 'kpi_snapshots' },
      { id: 'infrastructure_failures', name: 'Infrastructure Failures', value: kpi?.infrastructure_failures, unit: 'count', category: 'reliability', source: 'kpi_snapshots' },
      
      // Developer Metrics (team averages)
      { id: 'avg_pr_merge_time', name: 'Avg PR Merge Time', value: devAvg.prMergeHours, unit: 'hours', category: 'developer', source: 'developer_metrics', ...devPrivacy },
      { id: 'avg_code_review_time', name: 'Avg Code Review Time', value: devAvg.reviewHours, unit: 'hours', category: 'developer', source: 'developer_metrics', ...devPrivacy },
      { id: 'avg_focus_time', name: 'Avg Focus Time', value: devAvg.focusHours, unit: 'hours/day', category: 'developer', source: 'developer_metrics', ...devPrivacy },
      { id: 'avg_meeting_time', name: 'Avg Meeting Time', value: devAvg.meetingHours, unit: 'hours/day', category: 'developer', source: 'developer_metrics', ...devPrivacy },
      { id: 'avg_context_switches', name: 'Avg Context Switches', value: devAvg.contextSwitches, unit: '/day', category: 'developer', source: 'developer_metrics', ...devPrivacy },
      
      // Pipeline Metrics
      { id: 'pipeline_stages_count', name: 'Pipeline Stages', value: pipelineMetrics?.total_stages, unit: 'count', category: 'pipeline', source: 'pipeline_stages' },
      { id: 'avg_stage_duration', name: 'Avg Stage Duration', value: roundOrNull(pipelineMetrics?.avg_duration, 2), unit: 'min', category: 'pipeline', source: 'pipeline_stages' },
      { id: 'avg_stage_success_rate', name: 'Avg Stage Success Rate', value: roundOrNull(pipelineMetrics?.avg_success_rate, 2), unit: '%', category: 'pipeline', source: 'pipeline_stages' },
      { id: 'pipeline_bottlenecks', name: 'Pipeline Bottlenecks', value: pipelineMetrics?.bottleneck_count, unit: 'count', category: 'pipeline', source: 'pipeline_stages' },
      
      // Technical Debt Items
      { id: 'tech_debt_open_items', name: 'Open Tech Debt Items', value: debtSummary?.open_items, unit: 'count', category: 'tech_debt', source: 'technical_debt' },
      { id: 'tech_debt_total_items', name: 'Total Tech Debt Items', value: debtSummary?.total_items, unit: 'count', category: 'tech_debt', source: 'technical_debt' },
      
      // Team Info
      { id: 'team_member_count', name: 'Team Members', value: team?.member_count, unit: 'count', category: 'team', source: 'role_assignments' },
      { id: 'developer_count', name: 'Active Developers (30d)', value: devMetrics?.developer_count_30d ?? 0, unit: 'count', category: 'team', source: 'developer_metrics (rows updated in the last 30 days)' }
    ];

    // Composite metrics (calculated from primary metrics)
    // QA score: shared formula; the value shown is computed from the inputs shown,
    // and the stored snapshot value is returned alongside for transparency.
    const qa = computeQaScore(kpi);

    // Workload balance (derived) average, 0–100; null when suppressed or nobody has a value
    const avgHappiness = devAvg.workloadBalance;

    // Burnout risk of the team averages (shared rule; 'Unknown' when the averages are not shown)
    const focusTime = devAvg.focusHours;
    const meetingTime = devAvg.meetingHours;
    const contextSwitches = devAvg.contextSwitches;
    const burnoutRisk = devSummary.burnoutOfAverages;
    const pipelineSuccess = toNum(pipelineMetrics?.avg_success_rate);
    const totalDebtItems = Number(debtSummary?.total_items ?? 0);
    const openDebtItems = Number(debtSummary?.open_items ?? 0);

    const compositeMetrics = [
      {
        id: 'qa_score',
        name: 'Overall QA Score',
        value: qa.score,
        storedValue: toNum(kpi?.qa_score),
        unit: '/100',
        category: 'composite',
        formula: QA_SCORE_FORMULA,
        components: {
          test_coverage: toNum(kpi?.test_coverage),
          defect_escape_rate: toNum(kpi?.defect_escape_rate),
          change_failure_rate: toNum(kpi?.change_failure_rate),
          code_quality_score: toNum(kpi?.code_quality_score),
          weights: QA_SCORE_WEIGHTS,
          weight_coverage: qa.weightCoverage,
          missing_inputs: qa.missingInputs
        },
        source: 'calculated from kpi_snapshots'
      },
      {
        id: 'technical_debt_score',
        name: 'Technical Debt Score',
        value: technicalDebtScore,
        unit: '/100',
        category: 'composite',
        formula: TECH_DEBT_SCORE_FORMULA,
        components: { open_items: openDebtItems, weighted_sum: Number(debtSummary?.open_weight ?? 0), severity_weights: TECH_DEBT_SEVERITY_WEIGHTS },
        source: 'calculated from technical_debt'
      },
      {
        id: 'dora_performance',
        name: 'DORA Performance Level',
        value: getDORALevel(kpi),
        unit: 'level',
        category: 'composite',
        formula: 'Elite: deploy ≥7/wk + lead<1d + CFR<5% + MTTR<1h | High: deploy ≥1/wk + lead<7d + CFR<10% + MTTR<24h | Medium: deploy ≥0.25/wk + lead<30d + CFR<15% + MTTR<168h | Low: otherwise | Unknown: any of the four inputs not recorded',
        components: { deployment_frequency: kpi?.deployment_frequency_per_week, lead_time_days: kpi?.lead_time_days, change_failure_rate: kpi?.change_failure_rate, mttr_hours: kpi?.mttr_hours },
        source: 'calculated from kpi_snapshots'
      },
      {
        id: 'avg_developer_happiness',
        name: 'Workload balance (derived), team average',
        value: avgHappiness === null ? null : Number(avgHappiness.toFixed(1)),
        unit: '/100',
        category: 'composite',
        formula: `AVG(happiness_score) over the team’s contributing developers (0–100). happiness_score = workload balance calculated from focus, meetings, context switches, PR and review times; a workload signal, not a survey and not wellbeing. ${K_ANONYMITY_RULE}`,
        components: { avg_happiness_score: avgHappiness, developer_count: devSummary.privacy.contributors },
        source: 'calculated from developer_metrics',
        privacy: devSummary.privacy
      },
      {
        id: 'wellbeing_survey',
        name: 'Wellbeing (survey)',
        value: wellbeing.value,
        unit: '/100',
        category: 'composite',
        formula: WELLBEING_FORMULA,
        components: { responses: wellbeing.teamsReporting ? wellbeing.responses : null, latest_period_shown: wellbeing.teamsReporting > 0 },
        source: 'calculated from pulse_responses (anonymous)',
        privacy: { suppressed: wellbeing.teamsSuppressed > 0, contributors: wellbeing.teamsReporting ? wellbeing.responses : null, reason: wellbeing.teamsSuppressed > 0 ? SUPPRESSED_TEXT : null, minContributors: K_ANONYMITY_MIN }
      },
      {
        id: 'team_burnout_risk',
        name: 'Team Burnout Risk',
        value: burnoutRisk,
        unit: 'level',
        category: 'composite',
        formula: `${BURNOUT_DEFINITION} Applied to the team averages. ${K_ANONYMITY_RULE}`,
        components: { avg_focus_time: focusTime, avg_meeting_time: meetingTime, avg_context_switches: contextSwitches },
        source: 'calculated from developer_metrics',
        privacy: devSummary.privacy
      },
      {
        id: 'pipeline_health',
        name: 'Pipeline Health Score',
        value: pipelineSuccess === null ? null : Math.round(pipelineSuccess),
        unit: '/100',
        category: 'composite',
        formula: 'AVG(success_rate) across all pipeline stages',
        components: { total_stages: pipelineMetrics?.total_stages, avg_success_rate: pipelineMetrics?.avg_success_rate, bottleneck_count: pipelineMetrics?.bottleneck_count },
        source: 'calculated from pipeline_stages'
      },
      {
        id: 'tech_debt_ratio',
        name: 'Tech Debt Resolution Rate',
        value: totalDebtItems > 0 ? Math.round(((totalDebtItems - openDebtItems) / totalDebtItems) * 100) : null,
        unit: '%',
        category: 'composite',
        formula: '(total_items - open_items) / total_items × 100',
        components: { total_items: totalDebtItems, open_items: openDebtItems, resolved_items: totalDebtItems - openDebtItems },
        source: 'calculated from technical_debt'
      }
    ];

    res.json({
      teamId,
      teamName: team?.name,
      department: team?.department_name,
      snapshotDate: kpi?.snapshot_date,
      status: kpi?.status,
      primaryMetrics, // Show ALL metrics, even null ones
      compositeMetrics,
      summary: {
        totalPrimaryMetrics: primaryMetrics.length,
        metricsWithData: primaryMetrics.filter(m => m.value !== null && m.value !== undefined).length,
        totalCompositeMetrics: compositeMetrics.length
      }
    });
  } catch (error) {
    console.error('Get all metrics error:', error);
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

// Get business impact configuration for a team
router.get('/business-impact-config/:teamId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { teamId } = req.params;
    if (!(await assertTeamRead(req, res, teamId))) return;

    // Get business impact configurations
    const impactConfigs = await query<any>(
      `SELECT metric_name, quality_score, revenue_impact, customer_satisfaction,
              feature_adoption_rate, correlation_strength
       FROM business_impact_config
       WHERE team_id = ? AND manually_edited = TRUE
       ORDER BY metric_name`,
      [teamId]
    );

    // Get historical trends configuration
    const historicalConfigs = await query<any>(
      `SELECT month_year, quality_score, revenue_impact, customer_satisfaction, churn_rate
       FROM business_impact_history
       WHERE team_id = ? AND manually_edited = TRUE
       ORDER BY month_year`,
      [teamId]
    );

    res.json({
      impactConfigs,
      historicalConfigs,
      hasConfiguredData: impactConfigs.length > 0 || historicalConfigs.length > 0
    });
  } catch (error) {
    console.error('Get business impact config error:', error);
    res.status(500).json({ error: 'Failed to get business impact configuration' });
  }
});

// Save business impact configuration for a team
router.post('/business-impact-config/:teamId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { teamId } = req.params;
    if (!(await assertTeamWrite(req, res, teamId))) return;
    const { impactConfigs, historicalConfigs } = req.body;

    // Validate input
    if (!Array.isArray(impactConfigs) || !Array.isArray(historicalConfigs)) {
      return res.status(400).json({ error: 'Invalid data format' });
    }
    const configErrors = [...impactConfigs, ...historicalConfigs]
      .flatMap((c: any) => parseRangedFields(c && typeof c === 'object' ? c : {}, BI_CONFIG_FIELDS).errors);
    if (configErrors.length) return res.status(400).json({ error: configErrors[0], details: configErrors.slice(0, 20) });

    // Save impact configurations
    for (const config of impactConfigs) {
      await query(
        `INSERT INTO business_impact_config
         (id, team_id, metric_name, quality_score, revenue_impact, customer_satisfaction,
          feature_adoption_rate, correlation_strength, manually_edited)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)
         ON CONFLICT (team_id, metric_name) DO UPDATE SET
           quality_score = EXCLUDED.quality_score,
           revenue_impact = EXCLUDED.revenue_impact,
           customer_satisfaction = EXCLUDED.customer_satisfaction,
           feature_adoption_rate = EXCLUDED.feature_adoption_rate,
           correlation_strength = EXCLUDED.correlation_strength,
           manually_edited = TRUE,
           updated_at = CURRENT_TIMESTAMP`,
        [
          randomUUID(),
          teamId,
          config.metric_name,
          config.quality_score,
          config.revenue_impact,
          config.customer_satisfaction,
          config.feature_adoption_rate,
          config.correlation_strength
        ]
      );
    }

    // Save historical configurations
    for (const config of historicalConfigs) {
      await query(
        `INSERT INTO business_impact_history
         (id, team_id, month_year, quality_score, revenue_impact, customer_satisfaction,
          churn_rate, manually_edited)
         VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
         ON CONFLICT (team_id, month_year) DO UPDATE SET
           quality_score = EXCLUDED.quality_score,
           revenue_impact = EXCLUDED.revenue_impact,
           customer_satisfaction = EXCLUDED.customer_satisfaction,
           churn_rate = EXCLUDED.churn_rate,
           manually_edited = TRUE,
           updated_at = CURRENT_TIMESTAMP`,
        [
          randomUUID(),
          teamId,
          config.month_year,
          config.quality_score,
          config.revenue_impact,
          config.customer_satisfaction,
          config.churn_rate
        ]
      );
    }

    res.json({ success: true, message: 'Business impact configuration saved successfully' });
  } catch (error) {
    if (isDataException(error)) return res.status(400).json({ error: dataExceptionMessage(error) });
    console.error('Save business impact config error:', error);
    res.status(500).json({ error: 'Failed to save business impact configuration' });
  }
});

// Helper function to determine DORA performance level
function getDORALevel(kpi: any): string {
  if (!kpi) return 'Unknown';

  // A recorded 0 is a real value (e.g. 0% CFR); only null/missing is unknown.
  const deployFreq = toNum(kpi.deployment_frequency_per_week);
  const leadTime = toNum(kpi.lead_time_days);
  const changeFailure = toNum(kpi.change_failure_rate);
  const mttr = toNum(kpi.mttr_hours);
  if (deployFreq === null || leadTime === null || changeFailure === null || mttr === null) return 'Unknown';

  // Elite: Deploy multiple times/day, lead time <1 day, CFR <5%, MTTR <1hr
  if (deployFreq >= 7 && leadTime < 1 && changeFailure < 5 && mttr < 1) return 'Elite';
  // High: Deploy weekly-daily, lead time <1 week, CFR <10%, MTTR <1 day
  if (deployFreq >= 1 && leadTime < 7 && changeFailure < 10 && mttr < 24) return 'High';
  // Medium: Deploy weekly-monthly, lead time <1 month, CFR <15%, MTTR <1 week
  if (deployFreq >= 0.25 && leadTime < 30 && changeFailure < 15 && mttr < 168) return 'Medium';
  // Low: Everything else
  return 'Low';
}

export default router;
