import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { assertTeamRead, assertTeamWrite, getOwnedTeam, canManageCompanyData } from '../middleware/access';
import { aiLimiter } from '../middleware/rateLimit';
import { updateDailyAnalytics } from '../jobs/analyticsSync';
import { runDemoSeed, runFillExisting, isDemoSeeded, teamsLackingData } from '../seeds/demoSeed';
import { demoSummary, todayUtc } from '../seeds/demoData';
import { randomUUID } from 'crypto';
import { groqChatCompletion, isGroqConfigured } from '../lib/groq';
import { KPI_TARGETS, METRICS_CONFIG, teamAttentionIssues } from '../../src/config/metricsConfig';
import { toNum, QA_SCORE_THRESHOLDS, TECH_DEBT_OPEN_WEIGHT_SQL, computeDdps, computeBurnoutRisk, burnoutRiskLabel } from '../lib/metricFormulas';
import { isSyntheticDataEnabled } from '../lib/syntheticData';
import { resolveConfigs } from '../lib/configResolver';

const router = express.Router();

/** Roles that may use the Analytics modules (same list as the UI: Layout ANALYTICS_ROLES / App.hasPermission). */
const ANALYTICS_ROLES = ['super_admin', 'qa_manager', 'team_lead'];

/**
 * Resolve which team an Analytics request may read.
 * - qa_engineer / viewer: 403 (the UI does not offer Analytics to them).
 * - team_lead: only their own primary team; with no teamId the request is scoped to it.
 * - super_admin / qa_manager: any team in their company (assertTeamRead), or company-wide
 *   when no teamId is given.
 * Writes the error response and returns null when access is denied.
 */
async function resolveAnalyticsTeam(req: any, res: any, requestedTeamId: unknown): Promise<{ teamId: string | undefined } | null> {
  const role = req.user?.role;
  if (!ANALYTICS_ROLES.includes(role)) {
    res.status(403).json({ error: 'Analytics is not available for your role.' });
    return null;
  }
  const requested = typeof requestedTeamId === 'string' && requestedTeamId && requestedTeamId !== 'all' ? requestedTeamId : undefined;
  if (role === 'team_lead') {
    const own = req.user?.primaryTeamId as string | undefined;
    if (requested && requested !== own) {
      res.status(403).json({ error: 'Access denied. You can only view analytics for your own team.' });
      return null;
    }
    if (!own) {
      res.status(403).json({ error: 'You are not assigned to a team.' });
      return null;
    }
    return (await assertTeamRead(req, res, own)) ? { teamId: own } : null;
  }
  if (requested) {
    return (await assertTeamRead(req, res, requested)) ? { teamId: requested } : null;
  }
  return { teamId: undefined };
}

/** Role gate for Analytics endpoints that are not team-scoped. */
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
    const { companyId, role, primaryTeamId, id: userId } = req.user;
    const requestedTeamId = typeof req.query.teamId === 'string' && req.query.teamId ? req.query.teamId : undefined;

    // Individual developer metrics: same gate as /teams/:id/developer-ai-suggestions.
    // super_admin / qa_manager: any team in the company; team_lead: own team only;
    // other roles: only their own row.
    if (!assertAnalyticsRole(req, res)) return;
    const privileged = ['super_admin', 'qa_manager', 'team_lead'].includes(role);
    let scopeTeamId: string | undefined = requestedTeamId;

    if (requestedTeamId) {
      // Tenant check + team-lead/own-team restriction.
      if (!(await assertTeamRead(req, res, requestedTeamId))) return;
    } else if (role === 'team_lead') {
      if (!primaryTeamId) return res.json({ developers: [] });
      scopeTeamId = primaryTeamId;
    }

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

    if (scopeTeamId) {
      sql += ' AND dm.team_id = ?';
      params.push(scopeTeamId);
    }
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

    res.json({ developers: result });
  } catch (error) {
    console.error('Error fetching developer metrics:', error);
    res.status(500).json({ error: 'Failed to fetch developer metrics' });
  }
});

// ============================================================================
// TECHNICAL DEBT TRACKER
// ============================================================================

// Helper to get financial config with inheritance (company -> team; team overrides company).
// Keys with no configured value keep the built-in default and are listed in `defaultsUsed`.
const FINANCIAL_DEFAULTS: Record<string, number> = {
  developer_hourly_rate: 75,
  support_ticket_cost: 25,
  revenue_per_user_monthly: 50,
  downtime_cost_per_minute: 100,
  sla_breach_penalty: 1000
};

async function getFinancialConfig(companyId: string, teamId?: string): Promise<{ config: Record<string, number>; defaultsUsed: string[] }> {
  const config: Record<string, number> = { ...FINANCIAL_DEFAULTS };
  const configured = new Set<string>();

  try {
    // Same inheritance as every other config reader: team, then department, then company.
    const resolved = await resolveConfigs(companyId, { teamId });
    for (const [key, cfg] of Object.entries(resolved)) {
      const value = num(cfg.value);
      if (Object.prototype.hasOwnProperty.call(FINANCIAL_DEFAULTS, key) && value !== null) {
        config[key] = value;
        configured.add(key);
      }
    }
  } catch (e) {
    console.error('Error loading financial config, using defaults:', e);
  }

  return { config, defaultsUsed: Object.keys(FINANCIAL_DEFAULTS).filter(k => !configured.has(k)) };
}

// Calculate ROI metrics for a debt item.
// Returns null for values that cannot be computed (no effort estimate / no impact data).
function calculateROI(
  debt: any,
  config: Record<string, number>
): { investment: number | null; monthlyCost: number | null; annualSavings: number | null; roi: number | null; paybackMonths: number | null } {
  const effortHours = num(debt.estimated_effort_hours);
  const impacts = [
    num(debt.affected_users), num(debt.support_tickets_monthly), num(debt.downtime_minutes_monthly),
    num(debt.revenue_impact_percent), num(debt.sla_breaches_monthly)
  ];
  const hasImpactData = impacts.some(v => v !== null);
  const [affectedUsers, supportTickets, downtimeMinutes, revenueImpactPct, slaBreaches] = impacts.map(v => v ?? 0);

  // Investment = developer hours x hourly rate
  const investment = effortHours !== null ? effortHours * config.developer_hourly_rate : null;

  // Monthly cost of delay = sum of all impact costs (only when impact data was entered)
  const monthlyCost = hasImpactData
    ? supportTickets * config.support_ticket_cost +
      downtimeMinutes * config.downtime_cost_per_minute +
      affectedUsers * config.revenue_per_user_monthly * (revenueImpactPct / 100) +
      slaBreaches * config.sla_breach_penalty
    : null;
  const annualSavings = monthlyCost !== null ? monthlyCost * 12 : null;

  // ROI = ((annual savings - investment) / investment) x 100
  const roi = investment !== null && investment > 0 && annualSavings !== null
    ? ((annualSavings - investment) / investment) * 100
    : null;

  // Payback period in months (null when there is no monthly cost to recover)
  const paybackMonths = investment !== null && monthlyCost !== null && monthlyCost > 0 ? investment / monthlyCost : null;

  return { investment, monthlyCost, annualSavings, roi, paybackMonths };
}

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
    if (!canManageCompanyData(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const { id } = req.params;
    const {
      affected_users,
      support_tickets_monthly,
      downtime_minutes_monthly,
      revenue_impact_percent,
      sla_breaches_monthly,
      estimated_effort_hours
    } = req.body;

    // Verify the debt item belongs to the company
    const existing = await queryOne<any>(
      'SELECT id FROM technical_debt WHERE id = ? AND company_id = ?',
      [id, companyId]
    );

    if (!existing) {
      return res.status(404).json({ error: 'Technical debt item not found' });
    }

    await query(
      `UPDATE technical_debt SET
        affected_users = ?,
        support_tickets_monthly = ?,
        downtime_minutes_monthly = ?,
        revenue_impact_percent = ?,
        sla_breaches_monthly = ?,
        effort_hours = ?,
        manually_edited = TRUE,
        updated_at = NOW()
      WHERE id = ?`,
      [
        num(affected_users),
        num(support_tickets_monthly),
        num(downtime_minutes_monthly),
        num(revenue_impact_percent),
        num(sla_breaches_monthly),
        num(estimated_effort_hours),
        id
      ]
    );

    res.json({ message: 'Impact metrics updated successfully' });
  } catch (error) {
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

// Update pipeline configuration
router.put('/pipeline-config', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    if (!canManageCompanyData(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
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
            ps.updated_at
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

    // Duration z-score over stages that have a recorded duration
    const durations = stages.map((s: any) => num(s.duration)).filter((d): d is number => d !== null);
    const meanDuration = durations.length
      ? durations.reduce((sum: number, val: number) => sum + val, 0) / durations.length
      : 0;
    const variance = durations.length
      ? durations.reduce((sum: number, val: number) => sum + Math.pow(val - meanDuration, 2), 0) / durations.length
      : 0;
    const stdDev = Math.sqrt(Math.max(variance, 1e-6));

    // Bottleneck score = duration factor (0-60, from z-score) + failure factor (0-40).
    // Null when duration or success rate is missing.
    const result = stages.map((s: any) => {
      const duration = num(s.duration);
      const successRate = num(s.success_rate);
      let bottleneck: number | null = null;
      if (duration !== null && successRate !== null) {
        const durationZ = stdDev > 0 ? (duration - meanDuration) / stdDev : 0;
        const durationFactor = Math.min(60, Math.max(0, ((durationZ + 2) / 4) * 60));
        const successDecimal = Math.max(0, Math.min(1, successRate / 100));
        const failureFactor = (1 - successDecimal) * 40;
        bottleneck = Math.round(Math.min(100, Math.max(0, durationFactor + failureFactor)) * 10) / 10;
      }

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
    if (!canManageCompanyData(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const { id } = req.params;
    const { team_id, duration, success_rate, cpu_usage, memory_usage, cost_per_run } = req.body;

    // Verify stage belongs to company
    const stage = await queryOne<any>(
      'SELECT id, team_id FROM pipeline_stages WHERE id = ? AND company_id = ?',
      [id, companyId]
    );

    if (!stage) {
      return res.status(404).json({ error: 'Pipeline stage not found' });
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
    if (!assertAnalyticsRole(req, res)) return;
    const { companyId } = req.user;

    const configuredMetrics = await query<any>(
      `SELECT bic.team_id, bic.metric_name, bic.quality_score, bic.revenue_impact, bic.customer_satisfaction,
              bic.feature_adoption_rate, bic.correlation_strength
       FROM business_impact_config bic
       JOIN teams t ON t.id = bic.team_id
       WHERE t.company_id = ? AND t.is_active = TRUE AND bic.manually_edited = TRUE
       ORDER BY bic.team_id, bic.metric_name`,
      [companyId]
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
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super admin can load sample data' });
    }
    const enabled = isSyntheticDataEnabled();
    const summary = demoSummary(todayUtc());
    res.json({
      enabled,
      message: enabled ? null : SYNTHETIC_DISABLED_MESSAGE,
      seeded: await isDemoSeeded(),
      ownCompany: req.user.companyId && !String(req.user.companyId).startsWith('demo-')
        ? await teamsLackingData(req.user.companyId)
        : null,
      companyName: summary.companyName,
      teams: summary.teams,
      users: summary.users,
      logins: summary.logins,
      password: summary.password,
    });
  } catch (error) {
    console.error('Error reading sample data status:', error);
    res.status(500).json({ error: 'Failed to read sample data status' });
  }
});

router.post('/seed-data', authenticateToken, async (req: any, res) => {
  try {
    const { role } = req.user;

    if (role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super admin can load sample data' });
    }
    if (!isSyntheticDataEnabled()) {
      return res.status(409).json({ error: SYNTHETIC_DISABLED_MESSAGE, disabled: true });
    }

    const result = await runDemoSeed();
    const companyId = String(req.user.companyId ?? '');
    const fill = companyId && !companyId.startsWith('demo-') ? await runFillExisting({ companyIds: [companyId] }) : null;
    const filledTeams = fill?.companies[0]?.teamsFilled ?? 0;
    const total = result.insertedTotal + (fill?.insertedTotal ?? 0);
    res.json({
      success: true,
      message: total > 0
        ? `Sample data loaded: ${result.insertedTotal} rows for "${result.companyName}"` +
          (fill ? ` and ${fill.insertedTotal} rows for ${filledTeams} of your teams that lacked data.` : '.')
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
    const { role } = req.user;

    if (role !== 'super_admin') {
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

const LANCZOS_COEFFS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7
];

function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = LANCZOS_COEFFS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS_COEFFS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Continued fraction for the incomplete beta function (Numerical Recipes, betacf)
function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAXIT = 300, EPS = 3e-16, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return bt * betaContinuedFraction(a, b, x) / a;
  return 1 - bt * betaContinuedFraction(b, a, 1 - x) / b;
}

/** Two-sided p-value of a Student-t statistic: p = I_{df/(df+t^2)}(df/2, 1/2). */
function studentTTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.min(1, regularizedIncompleteBeta(df / (df + t * t), df / 2, 0.5)));
}

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

/** Benjamini-Hochberg adjusted q-values (same order as input; null stays null). */
function benjaminiHochberg(pValues: Array<number | null>): Array<number | null> {
  const indexed = pValues
    .map((p, i) => ({ p, i }))
    .filter((o): o is { p: number; i: number } => o.p !== null)
    .sort((a, b) => a.p - b.p);
  const m = indexed.length;
  const q: Array<number | null> = pValues.map(() => null);
  let running = 1;
  for (let k = m - 1; k >= 0; k--) {
    running = Math.min(running, (indexed[k].p * m) / (k + 1));
    q[indexed[k].i] = Math.min(1, running);
  }
  return q;
}

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
    // Tenant + role scope (also limits who can spend Groq budget).
    if (!(await assertTeamRead(req, res, teamId))) return;

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
  // Workload balance (derived) already contains focus, meetings and context switches, so the
  // burnout rule (built from the same inputs) is not weighted separately.
  workloadBalance: 0.20
};

async function computeCompanyMetrics(companyId: string) {
  // Active teams and the latest KPI snapshot per active team
  const activeTeams = await query<any>(
    'SELECT id, name FROM teams WHERE company_id = ? AND is_active = TRUE',
    [companyId]
  );
  const latestSnapshots = await query<any>(`
    SELECT DISTINCT ON (ks.team_id)
      ks.*, t.name, to_char(ks.snapshot_date, 'YYYY-MM-DD') AS snapshot_day
    FROM kpi_snapshots ks
    JOIN teams t ON t.id = ks.team_id
    WHERE t.company_id = ? AND t.is_active = TRUE
    ORDER BY ks.team_id, ks.snapshot_date DESC, ks.created_at DESC
  `, [companyId]);
  const teamsWithData = latestSnapshots.filter((t: any) => num(t.qa_score) !== null);

  const snapshotDays = teamsWithData.map((t: any) => t.snapshot_day as string).sort();
  const asOf: string | null = snapshotDays.length ? snapshotDays[snapshotDays.length - 1] : null;
  const oldestSnapshotDate: string | null = snapshotDays.length ? snapshotDays[0] : null;

  // Global QA score: mean of each active team's latest qa_score
  const globalQaScoreRaw = meanOf(teamsWithData.map((t: any) => num(t.qa_score)));
  const globalQaScore = globalQaScoreRaw !== null ? Math.round(globalQaScoreRaw) : null;

  // Trend: vs. mean of each active team's latest qa_score dated 7-14 days ago.
  // Null (not "stable") when that window has no snapshots.
  const prev = await queryOne<any>(`
    SELECT AVG(p.qa_score) AS avg_score, COUNT(*) AS n FROM (
      SELECT DISTINCT ON (ks.team_id) ks.qa_score
      FROM kpi_snapshots ks
      JOIN teams t ON t.id = ks.team_id
      WHERE t.company_id = ? AND t.is_active = TRUE
        AND ks.qa_score IS NOT NULL
        AND ks.snapshot_date >= CURRENT_DATE - 14
        AND ks.snapshot_date < CURRENT_DATE - 7
      ORDER BY ks.team_id, ks.snapshot_date DESC
    ) p
  `, [companyId]);
  const prevScore = num(prev?.n) ? num(prev?.avg_score) : null;
  const globalQaScoreTrend = globalQaScoreRaw !== null && prevScore !== null
    ? Math.round(globalQaScoreRaw - prevScore)
    : null;

  let riskLevel: 'stable' | 'watch' | 'at-risk' | 'unknown' = 'unknown';
  if (globalQaScore !== null) {
    if (globalQaScore < QA_WARNING_THRESHOLD) riskLevel = 'at-risk';
    else if (globalQaScore < QA_GOOD_THRESHOLD) riskLevel = 'watch';
    else riskLevel = 'stable';
  }

  // Averages over teams that have a value (nulls excluded, never counted as 0)
  const avgField = (field: string) => roundTo(meanOf(teamsWithData.map((t: any) => num(t[field]))), 1);
  const avgTestCoverage = avgField('test_coverage');
  const avgDefectEscapeRate = avgField('defect_escape_rate');
  const automationCoverage = avgField('automation_coverage');
  const avgFlakinessRate = avgField('test_flakiness_rate');

  // Top teams by current score (not an improvement measure)
  const sortedByScore = [...teamsWithData].sort((a, b) => (num(b.qa_score) as number) - (num(a.qa_score) as number));
  const topImproving = sortedByScore.slice(0, 3).map(t => ({ name: t.name, score: Math.round(num(t.qa_score) as number) }));

  // Needs attention: QA score critical or any recorded KPI off target. Same rule as the
  // dashboard table's "Needs attention" filter (teamAttentionIssues in metricsConfig).
  type AttentionItem = { name: string; score: number; issue: string; issues: string[]; snapshotDate: string };
  const needsAttention: AttentionItem[] = teamsWithData
    .map((t: any): AttentionItem => {
      const score = num(t.qa_score) as number;
      const issues = teamAttentionIssues({
        qaScore: score,
        testCoverage: num(t.test_coverage),
        testFlakinessRate: num(t.test_flakiness_rate),
        defectEscapeRate: num(t.defect_escape_rate),
        automationCoverage: num(t.automation_coverage),
      });
      return { name: t.name, score: Math.round(score), issue: issues.join('; '), issues, snapshotDate: t.snapshot_day };
    })
    .filter((t: AttentionItem) => t.issues.length > 0)
    .sort((a: AttentionItem, b: AttentionItem) => a.score - b.score || b.issues.length - a.issues.length);

  // KPI status: share of recorded KPI targets met (needs >= 2 recorded KPIs)
  let onTrack = 0, atRisk = 0, offTrack = 0, noData = 0;
  for (const t of teamsWithData) {
    const checks = [
      num(t.test_coverage) === null ? null : (num(t.test_coverage) as number) >= KPI_TARGETS.coverage,
      num(t.test_flakiness_rate) === null ? null : (num(t.test_flakiness_rate) as number) <= KPI_TARGETS.flakiness,
      num(t.defect_escape_rate) === null ? null : (num(t.defect_escape_rate) as number) <= KPI_TARGETS.escapeRate,
      num(t.automation_coverage) === null ? null : (num(t.automation_coverage) as number) >= KPI_TARGETS.automation
    ].filter((c): c is boolean => c !== null);
    if (checks.length < 2) { noData++; continue; }
    const share = checks.filter(Boolean).length / checks.length;
    if (share >= 0.75) onTrack++;
    else if (share >= 0.5) atRisk++;
    else offTrack++;
  }

  // Technical debt status (active teams only)
  const techDebtSummary = await queryOne<any>(
    `SELECT 
       ${TECH_DEBT_OPEN_WEIGHT_SQL} AS total_weight,
       SUM(CASE WHEN status NOT IN ('resolved','wont_fix') THEN 1 ELSE 0 END) AS open_items,
       COUNT(*) as total_items
     FROM technical_debt td
     JOIN teams t ON td.team_id = t.id
     WHERE t.company_id = ? AND t.is_active = TRUE`,
    [companyId]
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

  // Developer wellness: developer_metrics rows recorded for active teams (dm.team_id),
  // averaged per developer first so a developer on several teams counts once.
  const dev = await queryOne<any>(`
    SELECT COUNT(*) AS developers,
           AVG(d.h) AS avg_happiness, AVG(d.f) AS avg_focus,
           AVG(d.m) AS avg_meetings, AVG(d.s) AS avg_switches
    FROM (
      SELECT dm.developer_id,
             AVG(dm.happiness_score) AS h, AVG(dm.focus_time_hours) AS f,
             AVG(dm.meeting_time_hours) AS m, AVG(dm.context_switches_per_day) AS s
      FROM developer_metrics dm
      JOIN teams t ON t.id = dm.team_id
      JOIN users u ON u.id = dm.developer_id
      WHERE t.company_id = ? AND t.is_active = TRUE AND u.company_id = ? AND u.is_active = TRUE
      GROUP BY dm.developer_id
    ) d
  `, [companyId, companyId]);
  const developerCount = num(dev?.developers) ?? 0;
  const happiness = developerCount > 0 ? num(dev?.avg_happiness) : null;
  const focusTime = developerCount > 0 ? num(dev?.avg_focus) : null;
  const meetingTime = developerCount > 0 ? num(dev?.avg_meetings) : null;
  const contextSwitches = developerCount > 0 ? num(dev?.avg_switches) : null;

  // Burnout risk: the shared rule (metricFormulas.computeBurnoutRisk / BURNOUT_DEFINITION),
  // applied to the company averages; reported in developerWellnessBasis, not scored.
  const burnoutRisk = burnoutRiskLabel(computeBurnoutRisk({
    focus_time_hours: focusTime, meeting_time_hours: meetingTime, context_switches_per_day: contextSwitches
  }));
  // Workload balance (derived): the mean of each developer's stored happiness_score, which
  // is calculateWorkloadBalance() of focus, meetings, context switches, PR and review times.
  // It is used on its own: adding burnout risk or separate focus/meeting bands on top would
  // count the same inputs twice. (Field name kept as developerWellnessIndex for the API.)
  const wellnessRaw = happiness;
  const developerWellnessIndex = wellnessRaw !== null ? Math.round(wellnessRaw) : null;

  // Delivery performance (DORA): mean of per-team level scores over classified teams
  const doraLevels: Record<DoraLevelOrUnknown, number> = { Elite: 0, High: 0, Medium: 0, Low: 0, Unknown: 0 };
  const doraScores: number[] = [];
  for (const t of teamsWithData) {
    const level = classifyDoraLevel(t);
    doraLevels[level]++;
    if (level !== 'Unknown') doraScores.push(DORA_LEVEL_SCORE[level]);
  }
  const doraMean = meanOf(doraScores);
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
  `, [companyId]);
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
    workloadBalance: happiness
  };
  const healthRaw = weightedMeanOf(
    (Object.keys(ENGINEERING_HEALTH_WEIGHTS) as Array<keyof typeof ENGINEERING_HEALTH_WEIGHTS>)
      .map(k => ({ value: healthParts[k], weight: ENGINEERING_HEALTH_WEIGHTS[k] }))
  );
  const engineeringHealthScore = healthRaw !== null ? Math.round(healthRaw) : null;
  const healthIncluded = (Object.keys(healthParts) as Array<keyof typeof healthParts>).filter(k => healthParts[k] !== null);
  const healthMissing = (Object.keys(healthParts) as Array<keyof typeof healthParts>).filter(k => healthParts[k] === null);

  // Rule-based summary text (no AI)
  let aiSummary: string;
  if (globalQaScore === null) {
    aiSummary = 'No KPI data available. Add KPI snapshots for active teams to see insights.';
  } else {
    if (globalQaScoreTrend === null) aiSummary = 'No QA score trend available (no snapshots 7-14 days ago). ';
    else if (globalQaScoreTrend > 0) aiSummary = `Quality improved by ${globalQaScoreTrend} points vs. 7-14 days ago. `;
    else if (globalQaScoreTrend < 0) aiSummary = `Quality declined by ${Math.abs(globalQaScoreTrend)} points vs. 7-14 days ago. `;
    else aiSummary = 'Quality unchanged vs. 7-14 days ago. ';
    const teamsLowCoverage = teamsWithData.filter((t: any) => num(t.test_coverage) !== null && (num(t.test_coverage) as number) < KPI_TARGETS.coverage).length;
    if (teamsLowCoverage > 0) aiSummary += `${teamsLowCoverage} team${teamsLowCoverage > 1 ? 's' : ''} below ${KPI_TARGETS.coverage}% coverage. `;
    if (automationCoverage !== null) {
      aiSummary += automationCoverage < KPI_TARGETS.automation
        ? `Automation at ${automationCoverage}% - below the ${KPI_TARGETS.automation}% target. `
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
    riskLevel,
    avgTestCoverage,
    avgDefectEscapeRate,
    automationCoverage,
    avgFlakinessRate,

    topImproving,
    needsAttention,
    kpiStatus: { onTrack, atRisk, offTrack, noData },
    aiSummary,
    teamCount: activeTeams.length,
    teamsWithKpiData: teamsWithData.length,

    // Staleness / provenance
    asOf,
    oldestSnapshotDate,
    engineeringHealthBasis: {
      weights: ENGINEERING_HEALTH_WEIGHTS,
      included: healthIncluded,
      missing: healthMissing
    },
    deliveryPerformanceBasis: {
      method: 'Mean of per-team DORA level scores (Elite 100, High 80, Medium 60, Low 40); bands as getDORALevel',
      teamsClassified: doraScores.length,
      levels: doraLevels
    },
    developerWellnessBasis: {
      method: 'Workload balance (derived): mean of developer_metrics.happiness_score per developer, which is calculated from focus, meetings, context switches, PR and review times. Not a survey score.',
      developers: developerCount,
      avgHappiness: roundTo(happiness, 1),
      avgFocusHours: roundTo(focusTime, 1),
      avgMeetingHours: roundTo(meetingTime, 1),
      avgContextSwitches: roundTo(contextSwitches, 1),
      burnoutRisk
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
    const metrics = await computeCompanyMetrics(companyId);
    res.json(metrics);
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

    const { companyId, role } = user;

    if (!['super_admin', 'qa_manager', 'team_lead'].includes(role)) {
      return res.status(403).json({ error: 'Executive insights are restricted.' });
    }

    // 1. Same numbers as company-summary (shared helper)
    const m = await computeCompanyMetrics(companyId);

    // 2. Store Snapshot (nulls stay null)
    await query(`
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

    // 3. History: snapshots from the last 30 days
    const history = await query<any>(`
      SELECT * FROM company_kpi_snapshots 
      WHERE company_id = ? 
        AND snapshot_date >= CURRENT_DATE - 30
      ORDER BY snapshot_date ASC
    `, [companyId]);

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
              content: `You are a CTO/VP of Engineering advisor. Analyze these company-wide metrics and trends.

Current Metrics (team KPI snapshots as of ${m.asOf ?? 'unknown date'}; "no data" means not measured, do not guess a value):
- Engineering Health: ${fmt(m.engineeringHealthScore)} (components without data are excluded: ${m.engineeringHealthBasis.missing.join(', ') || 'none'})
- Delivery (DORA): ${fmt(m.deliveryPerformanceScore)}
- Workload balance (derived from focus/meeting/context-switch/PR/review inputs): ${fmt(m.developerWellnessIndex)}
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
    // Tenant scope: if a team is requested it must belong to the caller's company.
    if (teamId && !(await getOwnedTeam(req, teamId as string))) {
      return res.status(404).json({ error: 'Team not found' });
    }
    // Individual productivity data: roles other than super_admin / qa_manager / team_lead
    // may only see their own snapshots.
    const privileged = ['super_admin', 'qa_manager', 'team_lead'].includes(role);

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
        dps.context_switches_norm
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

    // Filter by team membership (snapshots carry no team id): team members, or users
    // whose metrics are recorded for the team, or whose primary team it is.
    if (teamId) {
      sql += ` AND (u.primary_team_id = ?
        OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = u.id AND tm.team_id = ?)
        OR EXISTS (SELECT 1 FROM developer_metrics dm WHERE dm.developer_id = u.id AND dm.team_id = ?))`;
      params.push(teamId, teamId, teamId);
    }

    sql += ' ORDER BY dps.snapshot_date ASC, dps.developer_id';

    const rawSnapshots = await query<any>(sql, params);

    // One DDPS definition: computeDdps (0-100) from each snapshot's inputs, returned as
    // a 0-1 fraction (score / 100) like the ddps_score column. Snapshots with missing
    // inputs have no score and are left out.
    const snapshots = rawSnapshots
      .map((s: any) => {
        const { score } = computeDdps(s);
        return score === null ? null : { ...s, ddps_score: Math.round(score * 100) / 10000 };
      })
      .filter((s: any) => s !== null) as any[];

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
      .map(d => ({
        date: d.date,
        ddps: Math.round((d.totalDDPS / d.count) * 100) / 100,
        developers: d.count
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calculate overall stats (null when there are no snapshots in the range)
    const allDDPS = snapshots.map((s: any) => parseFloat(s.ddps_score)).filter((v: number) => Number.isFinite(v));
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

    const recentAvg = recent.length > 0
      ? recent.reduce((a: number, s: any) => a + parseFloat(s.ddps_score), 0) / recent.length
      : null;
    const previousAvg = previous.length > 0
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
      executiveSummary,
      chartData,
      snapshots: snapshots.slice(-100) // Last 100 for detail view
    });

  } catch (error) {
    console.error('Error fetching DDPS history:', error);
    res.status(500).json({ error: 'Failed to fetch DDPS history' });
  }
});

export default router;
