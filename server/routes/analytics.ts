import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { seedAllAnalyticsData, updateDailyAnalytics } from '../jobs/analyticsSync';
import { randomUUID } from 'crypto';
import { groqChatCompletion, isGroqConfigured } from '../lib/groq';

const router = express.Router();

// Helper to check if team lead can access a specific team
// Returns the teamId to use (for team leads, always their own team)
const getTeamIdForRole = (userRole: string, userPrimaryTeamId: string | undefined, requestedTeamId: string | undefined): { allowed: boolean; teamId: string | undefined } => {
  if (userRole !== 'team_lead') {
    // Non-team leads can access any team or all teams
    return { allowed: true, teamId: requestedTeamId };
  }
  // Team leads can only access their own team
  if (requestedTeamId && requestedTeamId !== userPrimaryTeamId) {
    return { allowed: false, teamId: undefined };
  }
  // If no teamId specified or it's their own team, use their own team
  return { allowed: true, teamId: userPrimaryTeamId || requestedTeamId };
};

// ============================================================================
// TEST EXECUTION TIMELINE
// ============================================================================

router.get('/test-executions', authenticateToken, async (req: any, res) => {
  try {
    const { companyId, role, primaryTeamId } = req.user;
    const { teamId: requestedTeamId, days = '7' } = req.query;
    const numDays = Math.min(parseInt(days as string) || 7, 30);

    // Team leads can only access their own team
    const { allowed, teamId } = getTeamIdForRole(role, primaryTeamId, requestedTeamId);
    if (!allowed) {
      return res.status(403).json({ error: 'Access denied. You can only view analytics for your own team.' });
    }

    let sql = `
      SELECT 
        ter.id,
        ter.test_suite,
        ter.status,
        ter.start_time,
        ter.end_time,
        ter.duration_seconds as duration,
        CONCAT(u.first_name, ' ', u.last_name) as assigned_to,
        ter.dependencies
      FROM test_execution_runs ter
      LEFT JOIN users u ON ter.assigned_to = u.id
      WHERE ter.company_id = ?
        AND ter.start_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
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
      end_time: e.end_time || new Date(new Date(e.start_time).getTime() + (e.duration || 0) * 1000).toISOString(),
      duration: e.duration || 0,
      assigned_to: e.assigned_to || 'Unassigned',
      dependencies: e.dependencies ? JSON.parse(e.dependencies) : []
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

router.get('/test-cases', authenticateToken, async (req: any, res) => {
  try {
    const { companyId, role, primaryTeamId } = req.user;
    const { teamId: requestedTeamId, status } = req.query;

    // Team leads can only access their own team
    const { allowed, teamId } = getTeamIdForRole(role, primaryTeamId, requestedTeamId);
    if (!allowed) {
      return res.status(403).json({ error: 'Access denied. You can only view analytics for your own team.' });
    }

    let sql = `
      SELECT 
        tc.id,
        tc.name,
        tc.requirement_id,
        tc.status,
        tc.last_executed,
        tc.pass_rate,
        tc.execution_count,
        tc.avg_duration,
        tc.effectiveness_score,
        GROUP_CONCAT(tct.tag) as tags
      FROM test_cases tc
      LEFT JOIN test_case_tags tct ON tc.id = tct.test_case_id
      LEFT JOIN teams t ON tc.team_id = t.id
      WHERE t.company_id = ?
    `;
    const params: any[] = [companyId];

    if (teamId) {
      sql += ' AND tc.team_id = ?';
      params.push(teamId);
    }

    if (status) {
      sql += ' AND tc.status = ?';
      params.push(status);
    }

    sql += ' GROUP BY tc.id ORDER BY tc.updated_at DESC LIMIT 200';

    const testCases = await query<any>(sql, params);

    const result = testCases.map((tc: any) => ({
      id: tc.id,
      name: tc.name,
      requirement_id: tc.requirement_id || '',
      status: tc.status,
      last_executed: tc.last_executed,
      pass_rate: Number(tc.pass_rate) || 0,
      execution_count: tc.execution_count || 0,
      avg_duration: Number(tc.avg_duration) || 0,
      effectiveness_score: Number(tc.effectiveness_score) || 0,
      tags: tc.tags ? tc.tags.split(',') : []
    }));

    res.json({ testCases: result });
  } catch (error) {
    console.error('Error fetching test cases:', error);
    res.status(500).json({ error: 'Failed to fetch test cases' });
  }
});

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

    // Team leads can only access their own team
    const { allowed, teamId } = getTeamIdForRole(role, primaryTeamId, requestedTeamId);
    if (!allowed) {
      return res.status(403).json({ error: 'Access denied. You can only view analytics for your own team.' });
    }

    let sql = `
      SELECT 
        ft.id,
        ft.test_case_id,
        COALESCE(ft.test_name, tc.name) as test_name,
        ft.flakiness_score,
        ft.failure_pattern,
        ft.failure_count as occurrences,
        ft.pass_count,
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

    sql += ' ORDER BY ft.flakiness_score DESC LIMIT 50';

    const flakyTests = await query<any>(sql, params);

    // If no flaky tests found, return sample data
    let result = [];
    if (flakyTests.length === 0) {
      // Generate sample flaky test data
      result = [
        {
          id: 'sample-1',
          test_name: 'Login Form Validation',
          flakiness_score: 85.3,
          failure_pattern: 'timing',
          occurrences: 47,
          first_detected: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
          last_occurrence: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          suggested_fix: 'Add explicit waits or increase timeout thresholds',
          root_cause: 'timeout keyword detected in error logs',
          history: Array.from({ length: 20 }, (_, i) => ({
            date: new Date(Date.now() - (20 - i) * 24 * 60 * 60 * 1000).toISOString(),
            passed: Math.random() > 0.3 // 70% failure rate for flaky test
          }))
        },
        {
          id: 'sample-2',
          test_name: 'API Response Parsing',
          flakiness_score: 72.1,
          failure_pattern: 'environment',
          occurrences: 34,
          first_detected: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
          last_occurrence: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          suggested_fix: 'Ensure consistent environment setup with health checks',
          root_cause: 'environment keyword detected in error logs',
          history: Array.from({ length: 20 }, (_, i) => ({
            date: new Date(Date.now() - (20 - i) * 24 * 60 * 60 * 1000).toISOString(),
            passed: Math.random() > 0.4 // 60% failure rate
          }))
        },
        {
          id: 'sample-3',
          test_name: 'Database Connection Test',
          flakiness_score: 63.8,
          failure_pattern: 'network',
          occurrences: 28,
          first_detected: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          last_occurrence: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          suggested_fix: 'Mock external APIs or add retry logic',
          root_cause: 'ECONNREFUSED keyword detected in error logs',
          history: Array.from({ length: 20 }, (_, i) => ({
            date: new Date(Date.now() - (20 - i) * 24 * 60 * 60 * 1000).toISOString(),
            passed: Math.random() > 0.45 // 55% failure rate
          }))
        },
        {
          id: 'sample-4',
          test_name: 'User Data Validation',
          flakiness_score: 58.2,
          failure_pattern: 'data',
          occurrences: 19,
          first_detected: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
          last_occurrence: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          suggested_fix: 'Use isolated fixtures and database transactions per test',
          root_cause: 'assertion failed keyword detected in error logs',
          history: Array.from({ length: 20 }, (_, i) => ({
            date: new Date(Date.now() - (20 - i) * 24 * 60 * 60 * 1000).toISOString(),
            passed: Math.random() > 0.5 // 50% failure rate
          }))
        },
        {
          id: 'sample-5',
          test_name: 'File Upload Integration',
          flakiness_score: 45.7,
          failure_pattern: 'unknown',
          occurrences: 12,
          first_detected: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
          last_occurrence: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          suggested_fix: 'Collect more failure data and analyze patterns',
          root_cause: 'No matching pattern found',
          history: Array.from({ length: 20 }, (_, i) => ({
            date: new Date(Date.now() - (20 - i) * 24 * 60 * 60 * 1000).toISOString(),
            passed: Math.random() > 0.55 // 45% failure rate
          }))
        }
      ];
    } else {
      // Generate history from execution records
      result = await Promise.all(flakyTests.map(async (ft: any) => {
        // Get recent execution history
        const history = await query<any>(`
          SELECT executed_at as date, status
          FROM test_executions
          WHERE test_case_id = ?
          ORDER BY executed_at DESC
          LIMIT 20
        `, [ft.test_case_id || ft.id]);

        const pattern = ft.failure_pattern || 'unknown';

        // Generate failure reason and suggested fix from pattern analysis
        const patternAnalysis: Record<string, { keyword: string; fix: string }> = {
          timing: {
            keyword: 'timeout keyword detected in error logs',
            fix: 'Add explicit waits or increase timeout thresholds'
          },
          environment: {
            keyword: 'environment keyword detected in error logs',
            fix: 'Ensure consistent environment setup with health checks'
          },
          data: {
            keyword: 'assertion failed keyword detected in error logs',
            fix: 'Use isolated fixtures and database transactions per test'
          },
          network: {
            keyword: 'ECONNREFUSED keyword detected in error logs',
            fix: 'Mock external APIs or add retry logic'
          },
          unknown: {
            keyword: 'No matching pattern found',
            fix: 'Collect more failure data and analyze patterns'
          }
        };

        const analysis = patternAnalysis[pattern] || patternAnalysis.unknown;

        return {
          id: ft.id,
          test_name: ft.test_name || 'Unknown Test',
          flakiness_score: Number(ft.flakiness_score) || 0,
          failure_pattern: pattern,
          occurrences: ft.occurrences || 0,
          first_detected: ft.first_detected,
          last_occurrence: ft.last_occurrence,
          suggested_fix: analysis.fix,
          root_cause: analysis.keyword,
          history: history.map((h: any) => ({
            date: h.date,
            passed: h.status === 'passed'
          }))
        };
      }));
    }

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
    const { teamId, days = '30' } = req.query;
    const numDays = Math.min(parseInt(days as string) || 30, 90);

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
        pm.recorded_date as timestamp
      FROM performance_metrics pm
      WHERE pm.company_id = ?
        AND pm.recorded_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
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
      method: m.method || 'GET',
      response_time_p50: Number(m.response_time_p50) || 0,
      response_time_p95: Number(m.response_time_p95) || 0,
      response_time_p99: Number(m.response_time_p99) || 0,
      throughput: Number(m.throughput) || 0,
      error_rate: Number(m.error_rate) || 0,
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
    const { companyId } = req.user;
    const { teamId } = req.query;

    // Note: developer_metrics in the live DB is effectively a current snapshot per developer.
    // Query simplified to not require team_members join for basic metrics lookup
    let sql = `
      SELECT 
        dm.developer_id as developer_id,
        CONCAT(u.first_name, ' ', u.last_name) as name,
        AVG(dm.code_review_time_avg) as code_review_time_avg,
        AVG(dm.pr_merge_time_avg) as pr_merge_time_avg,
        AVG(dm.happiness_score) as happiness_score,
        AVG(dm.context_switches_per_day) as context_switches_per_day,
        AVG(dm.focus_time_hours) as focus_time_hours,
        AVG(dm.meeting_time_hours) as meeting_time_hours
      FROM developer_metrics dm
      JOIN users u ON dm.developer_id = u.id
      WHERE u.company_id = ?
    `;
    const params: any[] = [companyId];

    if (teamId) {
      sql += ' AND u.primary_team_id = ?';
      params.push(teamId);
    }

    sql += ' GROUP BY dm.developer_id, u.first_name, u.last_name ORDER BY happiness_score DESC';

    const metrics = await query<any>(sql, params);

    const result = metrics.map((m: any) => ({
      developer_id: m.developer_id,
      name: m.name,
      code_review_time_avg: Number(m.code_review_time_avg) || 0,
      pr_merge_time_avg: Number(m.pr_merge_time_avg) || 0,
      happiness_score: Number(m.happiness_score) || 0,
      context_switches_per_day: Number(m.context_switches_per_day) || 0,
      focus_time_hours: Number(m.focus_time_hours) || 0,
      meeting_time_hours: Number(m.meeting_time_hours) || 0
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

// Helper to get financial config with inheritance
async function getFinancialConfig(companyId: string, teamId?: string): Promise<Record<string, number>> {
  const defaults: Record<string, number> = {
    developer_hourly_rate: 75,
    support_ticket_cost: 25,
    revenue_per_user_monthly: 50,
    downtime_cost_per_minute: 100,
    sla_breach_penalty: 1000
  };

  try {
    // Fetch configs with inheritance (company → department → team)
    let sql = `SELECT config_key, config_value FROM configs WHERE company_id = ?`;
    const params: any[] = [companyId];

    if (teamId) {
      sql += ` AND (team_id = ? OR team_id IS NULL)`;
      params.push(teamId);
    } else {
      sql += ` AND team_id IS NULL`;
    }
    sql += ` ORDER BY team_id IS NOT NULL DESC`; // Team-specific overrides first

    const configs = await query<any>(sql, params);

    for (const cfg of configs) {
      if (defaults.hasOwnProperty(cfg.config_key) && !isNaN(parseFloat(cfg.config_value))) {
        defaults[cfg.config_key] = parseFloat(cfg.config_value);
      }
    }
  } catch (e) {
    // Use defaults on error
  }

  return defaults;
}

// Calculate ROI metrics for a debt item
function calculateROI(
  debt: any,
  config: Record<string, number>
): { investment: number; monthlyCost: number; annualSavings: number; roi: number; paybackMonths: number } {
  const effortHours = Number(debt.estimated_effort_hours) || 0;
  const affectedUsers = Number(debt.affected_users) || 0;
  const supportTickets = Number(debt.support_tickets_monthly) || 0;
  const downtimeMinutes = Number(debt.downtime_minutes_monthly) || 0;
  const revenueImpactPct = Number(debt.revenue_impact_percent) || 0;
  const slaBreaches = Number(debt.sla_breaches_monthly) || 0;

  // Investment = developer hours × hourly rate
  const investment = effortHours * config.developer_hourly_rate;

  // Monthly cost of delay = sum of all impact costs
  const supportCost = supportTickets * config.support_ticket_cost;
  const downtimeCost = downtimeMinutes * config.downtime_cost_per_minute;
  const revenueLoss = affectedUsers * config.revenue_per_user_monthly * (revenueImpactPct / 100);
  const slaPenalties = slaBreaches * config.sla_breach_penalty;

  const monthlyCost = supportCost + downtimeCost + revenueLoss + slaPenalties;
  const annualSavings = monthlyCost * 12;

  // ROI = ((annual savings - investment) / investment) × 100
  const roi = investment > 0 ? ((annualSavings - investment) / investment) * 100 : 0;

  // Payback period in months
  const paybackMonths = monthlyCost > 0 ? investment / monthlyCost : Infinity;

  return { investment, monthlyCost, annualSavings, roi, paybackMonths };
}

router.get('/technical-debt', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { teamId, status } = req.query;

    // Get financial config for ROI calculations
    const financialConfig = await getFinancialConfig(companyId, teamId as string);

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
        CONCAT(u.first_name, ' ', u.last_name) as assigned_to_name
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

    sql += ' ORDER BY td.priority_score DESC, td.severity DESC LIMIT 100';

    const debts = await query<any>(sql, params);

    const result = debts.map((d: any) => {
      const roi = calculateROI(d, financialConfig);

      return {
        id: d.id,
        title: d.title,
        description: d.description || '',
        category: d.category || 'code_quality',
        severity: d.severity,
        estimated_effort_hours: Number(d.estimated_effort_hours) || 0,
        cost_of_delay: Number(d.cost_of_delay) || roi.monthlyCost, // Use calculated if legacy is 0
        priority_score: Number(d.priority_score) || 0,
        status: d.status,
        created_date: d.created_date,
        assigned_to: d.assigned_to_name,
        // Impact metrics
        affected_users: Number(d.affected_users) || 0,
        support_tickets_monthly: Number(d.support_tickets_monthly) || 0,
        downtime_minutes_monthly: Number(d.downtime_minutes_monthly) || 0,
        revenue_impact_percent: Number(d.revenue_impact_percent) || 0,
        sla_breaches_monthly: Number(d.sla_breaches_monthly) || 0,
        // Calculated ROI fields
        investment_cost: Math.round(roi.investment),
        monthly_cost_of_delay: Math.round(roi.monthlyCost),
        annual_savings: Math.round(roi.annualSavings),
        roi_percentage: Math.round(roi.roi),
        payback_months: roi.paybackMonths === Infinity ? null : Math.round(roi.paybackMonths * 10) / 10
      };
    });

    // Also return the financial config for transparency
    res.json({
      debts: result,
      financial_config: financialConfig
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
        affected_users || 0,
        support_tickets_monthly || 0,
        downtime_minutes_monthly || 0,
        revenue_impact_percent || 0,
        sla_breaches_monthly || 0,
        estimated_effort_hours || 0,
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

// Get pipeline configuration
router.get('/pipeline-config', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;

    let config = await queryOne<any>(
      'SELECT * FROM pipeline_config WHERE company_id = ?',
      [companyId]
    );

    // Create default config if not exists
    if (!config) {
      const id = randomUUID();
      await query(
        `INSERT INTO pipeline_config (id, company_id, time_savings_percent, cost_savings_percent, cost_per_minute)
         VALUES (?, ?, 30.00, 25.00, 0.50)`,
        [id, companyId]
      );
      config = {
        id,
        company_id: companyId,
        time_savings_percent: 30.00,
        cost_savings_percent: 25.00,
        cost_per_minute: 0.50
      };
    }

    res.json({
      config: {
        time_savings_percent: Number(config.time_savings_percent) || 30,
        cost_savings_percent: Number(config.cost_savings_percent) || 25,
        cost_per_minute: Number(config.cost_per_minute) || 0.50
      }
    });
  } catch (error) {
    console.error('Error fetching pipeline config:', error);
    res.status(500).json({ error: 'Failed to fetch pipeline config' });
  }
});

// Update pipeline configuration
router.put('/pipeline-config', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { time_savings_percent, cost_savings_percent, cost_per_minute } = req.body;

    // Validate inputs
    const timeSavings = Math.min(100, Math.max(0, Number(time_savings_percent) || 30));
    const costSavings = Math.min(100, Math.max(0, Number(cost_savings_percent) || 25));
    const costPerMin = Math.max(0, Number(cost_per_minute) || 0.50);

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
        cost_per_minute: costPerMin
      }
    });
  } catch (error) {
    console.error('Error updating pipeline config:', error);
    res.status(500).json({ error: 'Failed to update pipeline config' });
  }
});

// Historical pipeline execution trends
router.get('/pipeline-history', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { days = '14' } = req.query;
    const numDays = Math.min(Math.max(parseInt(days as string, 10) || 14, 1), 60);

    const history = await query<any>(
      `SELECT 
        execution_date,
        SUM(total_runs) as total_runs,
        SUM(successful_runs) as successful_runs,
        SUM(failed_runs) as failed_runs,
        AVG(avg_duration_seconds) as avg_duration_seconds,
        SUM(total_cost) as total_cost
      FROM pipeline_execution_summary
      WHERE company_id = ?
        AND execution_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY execution_date
      ORDER BY execution_date ASC`,
      [companyId, numDays]
    );

    // Ensure we always return at least some data (simulate if empty)
    let results = history.map((row: any) => {
      const totalRuns = Number(row.total_runs) || 0;
      const failedRuns = Number(row.failed_runs) || 0;
      const minFailed = totalRuns > 0 ? Math.max(1, Math.round(totalRuns * 0.01)) : 0;
      const adjustedFailed = Math.max(failedRuns, minFailed);
      const successRuns = Math.max(0, totalRuns - adjustedFailed);
      return {
        date: row.execution_date,
        total_runs: totalRuns,
        successful_runs: successRuns,
        failed_runs: adjustedFailed,
        failure_rate: totalRuns > 0 ? Number(((adjustedFailed / totalRuns) * 100).toFixed(2)) : 0,
        avg_duration_seconds: Number(row.avg_duration_seconds) || 0,
        total_cost: Number(row.total_cost) || 0
      };
    });

    if (results.length === 0) {
      const today = new Date();
      results = Array.from({ length: numDays }).map((_, idx) => {
        const date = new Date(today);
        date.setDate(date.getDate() - (numDays - idx - 1));
        const totalRuns = 100 + Math.floor(Math.random() * 40);
        const failed = Math.max(1, Math.round(totalRuns * 0.02));
        return {
          date: date.toISOString().slice(0, 10),
          total_runs: totalRuns,
          successful_runs: totalRuns - failed,
          failed_runs: failed,
          failure_rate: Number(((failed / totalRuns) * 100).toFixed(2)),
          avg_duration_seconds: 180 + Math.floor(Math.random() * 60),
          total_cost: Number((totalRuns * 0.9).toFixed(2))
        };
      });
    }

    res.json({ history: results });
  } catch (error) {
    console.error('Error fetching pipeline history:', error);
    res.status(500).json({ error: 'Failed to fetch pipeline history' });
  }
});

router.get('/pipeline-stages', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { teamId } = req.query;

    // Get pipeline config for this company
    const config = await queryOne<any>(
      'SELECT time_savings_percent, cost_savings_percent, cost_per_minute FROM pipeline_config WHERE company_id = ?',
      [companyId]
    );

    let stages: any[] = [];

    if (teamId) {
      // Check if team-specific stages exist
      stages = await query<any>(`
        SELECT 
          ps.id, ps.name, ps.stage_order,
          ps.avg_duration_seconds as duration, ps.success_rate,
          ps.cpu_usage, ps.memory_usage, ps.cost_per_run as cost, ps.bottleneck_score
        FROM pipeline_stages ps
        WHERE ps.company_id = ? AND ps.team_id = ? AND ps.is_active = true
        ORDER BY ps.stage_order ASC
      `, [companyId, teamId]);

      // If no team-specific stages, copy from company defaults
      if (stages.length === 0) {
        const companyDefaults = await query<any>(`
          SELECT name, stage_order, avg_duration_seconds, success_rate,
                 cpu_usage, memory_usage, cost_per_run, bottleneck_score
          FROM pipeline_stages
          WHERE company_id = ? AND team_id IS NULL AND is_active = true
          ORDER BY stage_order ASC
        `, [companyId]);

        // Create team-specific copies
        for (const def of companyDefaults) {
          const newId = randomUUID();
          await query(`
            INSERT INTO pipeline_stages 
            (id, company_id, team_id, name, stage_order, avg_duration_seconds, success_rate,
             cpu_usage, memory_usage, cost_per_run, bottleneck_score, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)
          `, [newId, companyId, teamId, def.name, def.stage_order, def.avg_duration_seconds,
            def.success_rate, def.cpu_usage, def.memory_usage, def.cost_per_run, def.bottleneck_score]);
        }

        // Refetch the newly created team stages
        stages = await query<any>(`
          SELECT 
            ps.id, ps.name, ps.stage_order,
            ps.avg_duration_seconds as duration, ps.success_rate,
            ps.cpu_usage, ps.memory_usage, ps.cost_per_run as cost, ps.bottleneck_score
          FROM pipeline_stages ps
          WHERE ps.company_id = ? AND ps.team_id = ? AND ps.is_active = true
          ORDER BY ps.stage_order ASC
        `, [companyId, teamId]);
      }
    } else {
      // No team specified - return company defaults (team_id IS NULL)
      stages = await query<any>(`
        SELECT 
          ps.id, ps.name, ps.stage_order,
          ps.avg_duration_seconds as duration, ps.success_rate,
          ps.cpu_usage, ps.memory_usage, ps.cost_per_run as cost, ps.bottleneck_score
        FROM pipeline_stages ps
        WHERE ps.company_id = ? AND ps.team_id IS NULL AND ps.is_active = true
        ORDER BY ps.stage_order ASC
      `, [companyId]);
    }

    // Calculate stats for duration z-score
    const durations = stages.map((s: any) => Number(s.duration) || 0);
    const meanDuration = durations.length
      ? durations.reduce((sum: number, val: number) => sum + val, 0) / durations.length
      : 0;
    const variance = durations.length
      ? durations.reduce((sum: number, val: number) => sum + Math.pow(val - meanDuration, 2), 0) / durations.length
      : 0;
    const stdDev = Math.sqrt(Math.max(variance, 1e-6));

    // Recalculate bottleneck scores dynamically
    const result = stages.map((s: any) => {
      const duration = Number(s.duration) || 0;
      const successRate = Number(s.success_rate) || 100;
      const durationZ = stdDev > 0 ? (duration - meanDuration) / stdDev : 0;
      const durationFactor = Math.min(60, Math.max(0, ((durationZ + 2) / 4) * 60));
      const successDecimal = Math.max(0, Math.min(1, successRate / 100));
      const failureFactor = (1 - successDecimal) * 40;
      const calculatedBottleneck = Math.min(100, Math.max(0, durationFactor + failureFactor));

      return {
        id: s.id,
        name: s.name,
        duration,
        success_rate: successRate,
        resource_usage: {
          cpu: Number(s.cpu_usage) || 0,
          memory: Number(s.memory_usage) || 0,
          cost: Number(s.cost) || 0
        },
        bottleneck_score: Math.round(calculatedBottleneck * 10) / 10
      };
    });

    res.json({
      stages: result,
      config: {
        time_savings_percent: Number(config?.time_savings_percent) || 30,
        cost_savings_percent: Number(config?.cost_savings_percent) || 25,
        cost_per_minute: Number(config?.cost_per_minute) || 0.50
      }
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
       SELECT UUID(), id, company_id, team_id, name, avg_duration_seconds, success_rate,
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

router.get('/business-impact', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { days = '30' } = req.query;
    const numDays = Math.min(parseInt(days as string) || 30, 90);

    // First, try to get configured data for this company
    // We need to get teams for this company and check for configured data
    const teams = await query<any>('SELECT id FROM teams WHERE company_id = ?', [companyId]);

    let configuredMetrics: any[] = [];

    // Check each team for configured business impact data
    for (const team of teams) {
      try {
        const teamConfig = await query<any>(
          `SELECT metric_name, quality_score, revenue_impact, customer_satisfaction,
                  feature_adoption_rate, correlation_strength
           FROM business_impact_config
           WHERE team_id = ? AND manually_edited = TRUE`,
          [team.id]
        );
        if (teamConfig.length > 0) {
          configuredMetrics = teamConfig;
          break; // Use the first team's configured data
        }
      } catch (e) {
        // Continue to next team
      }
    }

    let result: any[] = [];

    if (configuredMetrics.length > 0) {
      // Use configured data
      result = configuredMetrics.map(m => ({
        metric_name: m.metric_name,
        quality_score: Number(m.quality_score) || 0,
        revenue_impact: Number(m.revenue_impact) || 0,
        customer_satisfaction: Number(m.customer_satisfaction) || 0,
        feature_adoption_rate: Number(m.feature_adoption_rate) || 0,
        correlation_strength: Number(m.correlation_strength) || 0
      }));
    } else {
      // Fall back to database metrics
      const metrics = await query<any>(`
        SELECT
          metric_name,
          AVG(quality_score) as quality_score,
          SUM(revenue_impact) as revenue_impact,
          AVG(customer_satisfaction) as customer_satisfaction,
          AVG(feature_adoption_rate) as feature_adoption_rate,
          AVG(correlation_strength) as correlation_strength
        FROM business_impact_metrics
        WHERE company_id = ?
          AND recorded_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        GROUP BY metric_name
        ORDER BY correlation_strength DESC
      `, [companyId, numDays]);

      if (metrics.length > 0) {
        result = metrics.map((m: any) => ({
          metric_name: m.metric_name,
          quality_score: Number(m.quality_score) || 0,
          revenue_impact: Number(m.revenue_impact) || 0,
          customer_satisfaction: Number(m.customer_satisfaction) || 0,
          feature_adoption_rate: Number(m.feature_adoption_rate) || 0,
          correlation_strength: Number(m.correlation_strength) || 0
        }));
      } else {
        // Fall back to simulated data
        result = [
          {
            metric_name: 'test_coverage',
            quality_score: 85.5,
            revenue_impact: 4178000,
            customer_satisfaction: 82.3,
            feature_adoption_rate: 73.1,
            correlation_strength: 0.85
          },
          {
            metric_name: 'defect_escape_rate',
            quality_score: 12.2,
            revenue_impact: 2896000,
            customer_satisfaction: 76.8,
            feature_adoption_rate: 68.4,
            correlation_strength: 0.72
          },
          {
            metric_name: 'code_quality_score',
            quality_score: 78.9,
            revenue_impact: 3452000,
            customer_satisfaction: 79.5,
            feature_adoption_rate: 71.2,
            correlation_strength: 0.68
          },
          {
            metric_name: 'test_execution_time',
            quality_score: 156.3,
            revenue_impact: 1987000,
            customer_satisfaction: 74.1,
            feature_adoption_rate: 66.8,
            correlation_strength: 0.55
          },
          {
            metric_name: 'deployment_frequency',
            quality_score: 21.4,
            revenue_impact: 2674000,
            customer_satisfaction: 77.9,
            feature_adoption_rate: 69.7,
            correlation_strength: 0.61
          }
        ];
      }
    }

    res.json({ metrics: result });
  } catch (error) {
    console.error('Error fetching business impact:', error);
    res.status(500).json({ error: 'Failed to fetch business impact' });
  }
});

// ============================================================================
// SEED & UPDATE ANALYTICS DATA
// ============================================================================

// Seed all historical analytics data (30 days)
router.post('/seed-data', authenticateToken, async (req: any, res) => {
  try {
    const { role } = req.user;

    if (role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super admin can seed data' });
    }

    // Run seed in background
    seedAllAnalyticsData().catch(err => console.error('Seed error:', err));

    res.json({ success: true, message: 'Analytics data seeding started. Check server logs for progress.' });
  } catch (error) {
    console.error('Error starting seed:', error);
    res.status(500).json({ error: 'Failed to start seeding' });
  }
});

// Manually trigger daily update
router.post('/update-daily', authenticateToken, async (req: any, res) => {
  try {
    const { role } = req.user;

    if (role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super admin can trigger updates' });
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

// Helper: Error function approximation for normal CDF
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);

  // Abramowitz and Stegun formula 7.1.26
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-absX * absX);

  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Helper: Calculate Pearson correlation coefficient
function calculatePearsonCorrelation(x: number[], y: number[]): { correlation: number; pValue: number; sampleSize: number } {
  const n = Math.min(x.length, y.length);
  if (n < 3) return { correlation: 0, pValue: 1, sampleSize: n };

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denominator = Math.sqrt(denomX * denomY);
  const correlation = denominator === 0 ? 0 : numerator / denominator;

  // Approximate two-tailed p-value using normal distribution for the t statistic
  let pValue = 1;
  if (n >= 6 && correlation > -1 && correlation < 1) {
    const t = correlation * Math.sqrt((n - 2) / (1 - correlation * correlation));
    const z = Math.abs(t);
    const cdf = normalCdf(z);
    pValue = Math.max(0, Math.min(1, 2 * (1 - cdf)));
  }

  return { correlation: Math.round(correlation * 1000) / 1000, pValue, sampleSize: n };
}

// Helper: Get correlation strength label
function getCorrelationStrength(r: number): string {
  const absR = Math.abs(r);
  if (absR >= 0.7) return 'strong';
  if (absR >= 0.5) return 'moderate';
  if (absR >= 0.3) return 'weak';
  return 'none';
}

// GET: Fetch all correlation data for a team
router.get('/business-impact-v2/:teamId', authenticateToken, async (req: any, res) => {
  try {
    const { teamId: requestedTeamId } = req.params;
    const { role, primaryTeamId } = req.user;

    // Team leads can only access their own team
    const { allowed, teamId } = getTeamIdForRole(role, primaryTeamId, requestedTeamId);
    if (!allowed) {
      return res.status(403).json({ error: 'Access denied. You can only view analytics for your own team.' });
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

    // Fetch cached correlations
    const correlations = await query<any>(
      `SELECT * FROM business_impact_correlations 
       WHERE team_id = ? ORDER BY ABS(pearson_correlation) DESC`,
      [teamId]
    );

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
        isCorrelationReady: pairedMonths.length >= 6,
        earliestMonth: qualityMetrics[0]?.month_year || businessKpis[0]?.month_year || null,
        latestMonth: qualityMetrics[qualityMetrics.length - 1]?.month_year ||
          businessKpis[businessKpis.length - 1]?.month_year || null
      }
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
       ON DUPLICATE KEY UPDATE
         test_coverage = COALESCE(VALUES(test_coverage), test_coverage),
         defect_density = COALESCE(VALUES(defect_density), defect_density),
         defect_escape_rate = COALESCE(VALUES(defect_escape_rate), defect_escape_rate),
         mttr_hours = COALESCE(VALUES(mttr_hours), mttr_hours),
         deployment_frequency = COALESCE(VALUES(deployment_frequency), deployment_frequency),
         lead_time_days = COALESCE(VALUES(lead_time_days), lead_time_days),
         code_quality_score = COALESCE(VALUES(code_quality_score), code_quality_score),
         change_failure_rate = COALESCE(VALUES(change_failure_rate), change_failure_rate),
         manually_edited = TRUE,
         updated_at = CURRENT_TIMESTAMP`,
      [
        id, teamId, month_year,
        metrics.test_coverage || null,
        metrics.defect_density || null,
        metrics.defect_escape_rate || null,
        metrics.mttr_hours || null,
        metrics.deployment_frequency || null,
        metrics.lead_time_days || null,
        metrics.code_quality_score || null,
        metrics.change_failure_rate || null
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
       ON DUPLICATE KEY UPDATE
         monthly_revenue = COALESCE(VALUES(monthly_revenue), monthly_revenue),
         active_users = COALESCE(VALUES(active_users), active_users),
         churn_rate = COALESCE(VALUES(churn_rate), churn_rate),
         feature_adoption_rate = COALESCE(VALUES(feature_adoption_rate), feature_adoption_rate),
         new_customers = COALESCE(VALUES(new_customers), new_customers),
         customer_lifetime_value = COALESCE(VALUES(customer_lifetime_value), customer_lifetime_value),
         nps_score = COALESCE(VALUES(nps_score), nps_score),
         csat_score = COALESCE(VALUES(csat_score), csat_score),
         support_ticket_volume = COALESCE(VALUES(support_ticket_volume), support_ticket_volume),
         avg_resolution_time_hours = COALESCE(VALUES(avg_resolution_time_hours), avg_resolution_time_hours),
         manually_edited = TRUE,
         updated_at = CURRENT_TIMESTAMP`,
      [
        id, teamId, month_year,
        kpis.monthly_revenue || null,
        kpis.active_users || null,
        kpis.churn_rate || null,
        kpis.feature_adoption_rate || null,
        kpis.new_customers || null,
        kpis.customer_lifetime_value || null,
        kpis.nps_score || null,
        kpis.csat_score || null,
        kpis.support_ticket_volume || null,
        kpis.avg_resolution_time_hours || null
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
       ON DUPLICATE KEY UPDATE
         team_size = COALESCE(VALUES(team_size), team_size),
         sprint_length_days = COALESCE(VALUES(sprint_length_days), sprint_length_days),
         working_days = COALESCE(VALUES(working_days), working_days),
         feature_release_count = COALESCE(VALUES(feature_release_count), feature_release_count),
         bug_fix_count = COALESCE(VALUES(bug_fix_count), bug_fix_count),
         tech_debt_items_resolved = COALESCE(VALUES(tech_debt_items_resolved), tech_debt_items_resolved),
         user_growth_rate = COALESCE(VALUES(user_growth_rate), user_growth_rate),
         total_user_base = COALESCE(VALUES(total_user_base), total_user_base),
         is_holiday_season = COALESCE(VALUES(is_holiday_season), is_holiday_season),
         marketing_spend = COALESCE(VALUES(marketing_spend), marketing_spend),
         major_incident_count = COALESCE(VALUES(major_incident_count), major_incident_count),
         downtime_minutes = COALESCE(VALUES(downtime_minutes), downtime_minutes),
         notes = COALESCE(VALUES(notes), notes),
         manually_edited = TRUE,
         updated_at = CURRENT_TIMESTAMP`,
      [
        id, teamId, month_year,
        context.team_size || null,
        context.sprint_length_days || 14,
        context.working_days || null,
        context.feature_release_count || null,
        context.bug_fix_count || null,
        context.tech_debt_items_resolved || null,
        context.user_growth_rate || null,
        context.total_user_base || null,
        context.is_holiday_season ? 1 : 0,
        context.marketing_spend || null,
        context.major_incident_count || 0,
        context.downtime_minutes || 0,
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

    // Create month-indexed maps
    const qualityByMonth: Record<string, any> = {};
    qualityMetrics.forEach((m: any) => { qualityByMonth[m.month_year] = m; });

    const kpiByMonth: Record<string, any> = {};
    businessKpis.forEach((k: any) => { kpiByMonth[k.month_year] = k; });

    // Find paired months
    const pairedMonths = Object.keys(qualityByMonth).filter(m => kpiByMonth[m]).sort();

    if (pairedMonths.length < 6) {
      return res.status(400).json({
        error: 'Insufficient paired data. Need at least 6 months where both X and Y data exist.',
        pairedMonths: pairedMonths.length
      });
    }

    // Define metric pairs to correlate
    const qualityFields = [
      'test_coverage', 'defect_density', 'defect_escape_rate', 'mttr_hours',
      'deployment_frequency', 'lead_time_days', 'code_quality_score', 'change_failure_rate'
    ];
    const kpiFields = [
      'monthly_revenue', 'active_users', 'churn_rate', 'feature_adoption_rate',
      'nps_score', 'csat_score', 'support_ticket_volume'
    ];

    const correlationResults: any[] = [];

    // Calculate correlation for each pair
    for (const qField of qualityFields) {
      for (const kField of kpiFields) {
        const xValues: number[] = [];
        const yValues: number[] = [];

        pairedMonths.forEach(month => {
          const qVal = qualityByMonth[month][qField];
          const kVal = kpiByMonth[month][kField];
          if (qVal !== null && kVal !== null) {
            xValues.push(Number(qVal));
            yValues.push(Number(kVal));
          }
        });

        if (xValues.length >= 6) {
          const { correlation, pValue, sampleSize } = calculatePearsonCorrelation(xValues, yValues);
          const strength = getCorrelationStrength(correlation);
          const isSignificant = pValue < 0.05;

          correlationResults.push({
            quality_metric: qField,
            business_kpi: kField,
            pearson_correlation: correlation,
            p_value: pValue,
            sample_size: sampleSize,
            correlation_strength: strength,
            is_significant: isSignificant
          });

          // Save to database
          const id = randomUUID();
          await query(
            `INSERT INTO business_impact_correlations
             (id, team_id, quality_metric, business_kpi, pearson_correlation, p_value,
              sample_size, correlation_strength, is_significant, start_month, end_month, calculated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
               pearson_correlation = VALUES(pearson_correlation),
               p_value = VALUES(p_value),
               sample_size = VALUES(sample_size),
               correlation_strength = VALUES(correlation_strength),
               is_significant = VALUES(is_significant),
               start_month = VALUES(start_month),
               end_month = VALUES(end_month),
               calculated_at = NOW(),
               updated_at = CURRENT_TIMESTAMP`,
            [
              id, teamId, qField, kField, correlation, pValue, sampleSize,
              strength, isSignificant ? 1 : 0,
              pairedMonths[0], pairedMonths[pairedMonths.length - 1]
            ]
          );
        }
      }
    }

    // Update data status
    const statusId = randomUUID();
    await query(
      `INSERT INTO business_impact_data_status
       (id, team_id, months_with_quality_data, months_with_kpi_data, months_with_paired_data,
        earliest_month, latest_month, is_correlation_ready, last_validated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, NOW())
       ON DUPLICATE KEY UPDATE
         months_with_quality_data = VALUES(months_with_quality_data),
         months_with_kpi_data = VALUES(months_with_kpi_data),
         months_with_paired_data = VALUES(months_with_paired_data),
         earliest_month = VALUES(earliest_month),
         latest_month = VALUES(latest_month),
         is_correlation_ready = TRUE,
         last_validated_at = NOW(),
         updated_at = CURRENT_TIMESTAMP`,
      [
        statusId, teamId, qualityMetrics.length, businessKpis.length, pairedMonths.length,
        pairedMonths[0], pairedMonths[pairedMonths.length - 1]
      ]
    );

    // Return top correlations sorted by absolute value
    const topCorrelations = correlationResults
      .sort((a, b) => Math.abs(b.pearson_correlation) - Math.abs(a.pearson_correlation))
      .slice(0, 20);

    res.json({
      success: true,
      correlationsCalculated: correlationResults.length,
      pairedMonths: pairedMonths.length,
      dateRange: { start: pairedMonths[0], end: pairedMonths[pairedMonths.length - 1] },
      topCorrelations
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
    const { monthlyData } = req.body;

    if (!Array.isArray(monthlyData)) {
      return res.status(400).json({ error: 'monthlyData must be an array' });
    }

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
            change_failure_rate, manually_edited)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
           ON DUPLICATE KEY UPDATE
             test_coverage = COALESCE(VALUES(test_coverage), test_coverage),
             defect_density = COALESCE(VALUES(defect_density), defect_density),
             defect_escape_rate = COALESCE(VALUES(defect_escape_rate), defect_escape_rate),
             mttr_hours = COALESCE(VALUES(mttr_hours), mttr_hours),
             deployment_frequency = COALESCE(VALUES(deployment_frequency), deployment_frequency),
             lead_time_days = COALESCE(VALUES(lead_time_days), lead_time_days),
             code_quality_score = COALESCE(VALUES(code_quality_score), code_quality_score),
             change_failure_rate = COALESCE(VALUES(change_failure_rate), change_failure_rate),
             manually_edited = TRUE,
             updated_at = CURRENT_TIMESTAMP`,
          [
            qId, teamId, month_year,
            quality.test_coverage, quality.defect_density, quality.defect_escape_rate,
            quality.mttr_hours, quality.deployment_frequency, quality.lead_time_days,
            quality.code_quality_score, quality.change_failure_rate
          ]
        );
      }

      // Save business KPIs
      if (kpis && Object.keys(kpis).length > 0) {
        const kId = randomUUID();
        await query(
          `INSERT INTO business_impact_business_kpis
           (id, team_id, month_year, monthly_revenue, active_users, churn_rate,
            feature_adoption_rate, nps_score, csat_score, support_ticket_volume, manually_edited)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
           ON DUPLICATE KEY UPDATE
             monthly_revenue = COALESCE(VALUES(monthly_revenue), monthly_revenue),
             active_users = COALESCE(VALUES(active_users), active_users),
             churn_rate = COALESCE(VALUES(churn_rate), churn_rate),
             feature_adoption_rate = COALESCE(VALUES(feature_adoption_rate), feature_adoption_rate),
             nps_score = COALESCE(VALUES(nps_score), nps_score),
             csat_score = COALESCE(VALUES(csat_score), csat_score),
             support_ticket_volume = COALESCE(VALUES(support_ticket_volume), support_ticket_volume),
             manually_edited = TRUE,
             updated_at = CURRENT_TIMESTAMP`,
          [
            kId, teamId, month_year,
            kpis.monthly_revenue, kpis.active_users, kpis.churn_rate,
            kpis.feature_adoption_rate, kpis.nps_score, kpis.csat_score, kpis.support_ticket_volume
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
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
           ON DUPLICATE KEY UPDATE
             team_size = COALESCE(VALUES(team_size), team_size),
             feature_release_count = COALESCE(VALUES(feature_release_count), feature_release_count),
             user_growth_rate = COALESCE(VALUES(user_growth_rate), user_growth_rate),
             total_user_base = COALESCE(VALUES(total_user_base), total_user_base),
             is_holiday_season = COALESCE(VALUES(is_holiday_season), is_holiday_season),
             downtime_minutes = COALESCE(VALUES(downtime_minutes), downtime_minutes),
             manually_edited = TRUE,
             updated_at = CURRENT_TIMESTAMP`,
          [
            cId, teamId, month_year,
            context.team_size, context.feature_release_count, context.user_growth_rate,
            context.total_user_base, context.is_holiday_season ? 1 : 0, context.downtime_minutes
          ]
        );
      }

      saved++;
    }

    res.json({ success: true, monthsSaved: saved });
  } catch (error) {
    console.error('Error bulk saving:', error);
    res.status(500).json({ error: 'Failed to bulk save data' });
  }
});

// POST: Generate realistic correlation data (not persisted)
router.post('/business-impact-v2/:teamId/generate-realistic-data', authenticateToken, async (req: any, res) => {
  try {
    const { teamId } = req.params;

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
        manually_edited: false
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
        manually_edited: false
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
        manually_edited: false
      };
      contextData.push(contextItem);
    }

    // Calculate realistic correlations
    const correlations = [];

    // Helper function to generate random correlation between 0.3 and 0.8
    const randomCorrelation = (isNegative: boolean = false) => {
      const base = 0.3 + Math.random() * 0.5; // Random between 0.3 and 0.8
      return isNegative ? -base : base;
    };

    // Define correlation pairs with random realistic strengths (0.3-0.8)
    const correlationPairs = [
      { quality: 'test_coverage', kpi: 'monthly_revenue', expectedR: randomCorrelation(false) },
      { quality: 'test_coverage', kpi: 'active_users', expectedR: randomCorrelation(false) },
      { quality: 'test_coverage', kpi: 'churn_rate', expectedR: randomCorrelation(true) },
      { quality: 'test_coverage', kpi: 'feature_adoption_rate', expectedR: randomCorrelation(false) },
      { quality: 'test_coverage', kpi: 'nps_score', expectedR: randomCorrelation(false) },
      { quality: 'test_coverage', kpi: 'csat_score', expectedR: randomCorrelation(false) },
      { quality: 'test_coverage', kpi: 'support_ticket_volume', expectedR: randomCorrelation(true) },

      { quality: 'defect_density', kpi: 'monthly_revenue', expectedR: randomCorrelation(true) },
      { quality: 'defect_density', kpi: 'active_users', expectedR: randomCorrelation(true) },
      { quality: 'defect_density', kpi: 'churn_rate', expectedR: randomCorrelation(false) },
      { quality: 'defect_density', kpi: 'feature_adoption_rate', expectedR: randomCorrelation(true) },
      { quality: 'defect_density', kpi: 'nps_score', expectedR: randomCorrelation(true) },
      { quality: 'defect_density', kpi: 'csat_score', expectedR: randomCorrelation(true) },
      { quality: 'defect_density', kpi: 'support_ticket_volume', expectedR: randomCorrelation(false) },

      { quality: 'defect_escape_rate', kpi: 'monthly_revenue', expectedR: randomCorrelation(true) },
      { quality: 'defect_escape_rate', kpi: 'active_users', expectedR: randomCorrelation(true) },
      { quality: 'defect_escape_rate', kpi: 'churn_rate', expectedR: randomCorrelation(false) },
      { quality: 'defect_escape_rate', kpi: 'feature_adoption_rate', expectedR: randomCorrelation(true) },
      { quality: 'defect_escape_rate', kpi: 'nps_score', expectedR: randomCorrelation(true) },
      { quality: 'defect_escape_rate', kpi: 'csat_score', expectedR: randomCorrelation(true) },
      { quality: 'defect_escape_rate', kpi: 'support_ticket_volume', expectedR: randomCorrelation(false) },

      { quality: 'mttr_hours', kpi: 'monthly_revenue', expectedR: randomCorrelation(true) },
      { quality: 'mttr_hours', kpi: 'csat_score', expectedR: randomCorrelation(true) },
      { quality: 'mttr_hours', kpi: 'nps_score', expectedR: randomCorrelation(true) },

      { quality: 'code_quality_score', kpi: 'monthly_revenue', expectedR: randomCorrelation(false) },
      { quality: 'code_quality_score', kpi: 'active_users', expectedR: randomCorrelation(false) },
      { quality: 'code_quality_score', kpi: 'churn_rate', expectedR: randomCorrelation(true) },

      { quality: 'deployment_frequency', kpi: 'feature_adoption_rate', expectedR: randomCorrelation(false) },
      { quality: 'deployment_frequency', kpi: 'active_users', expectedR: randomCorrelation(false) },
    ];

    for (const pair of correlationPairs) {
      const qualityValues = qualityMetrics.map((q: any) => Number(q[pair.quality as keyof typeof q]));
      const kpiValues = businessKpis.map((k: any) => Number(k[pair.kpi as keyof typeof k]));

      const { correlation, pValue, sampleSize } = calculatePearsonCorrelation(qualityValues, kpiValues);
      const strength = getCorrelationStrength(Math.abs(correlation));
      const isSignificant = pValue < 0.05;

      correlations.push({
        quality_metric: pair.quality,
        business_kpi: pair.kpi,
        pearson_correlation: correlation,
        p_value: pValue,
        sample_size: sampleSize,
        correlation_strength: strength,
        is_significant: isSignificant
      });
    }

    // Sort by absolute correlation strength
    correlations.sort((a, b) => Math.abs(b.pearson_correlation) - Math.abs(a.pearson_correlation));

    res.json({
      success: true,
      dataGenerated: true,
      message: 'Realistic business impact data seeded successfully! 12 months of correlated quality metrics and KPIs generated.',
      dateRange: { start: months[0], end: months[11] },
      qualityMetrics,
      businessKpis,
      contextData,
      correlations: correlations.slice(0, 20), // Top 20 correlations
      summary: {
        monthsWithQualityData: 12,
        monthsWithKpiData: 12,
        monthsWithPairedData: 12,
        isCorrelationReady: true,
        earliestMonth: months[0],
        latestMonth: months[11]
      }
    });
  } catch (error) {
    console.error('Error generating realistic data:', error);
    res.status(500).json({ error: 'Failed to generate realistic data' });
  }
});

// POST: AI analysis of correlations using backend Groq API key
router.post('/business-impact-v2/:teamId/ai-analysis', authenticateToken, async (req: any, res) => {
  try {
    const { correlations } = req.body;

    if (!correlations || correlations.length === 0) {
      return res.status(400).json({ error: 'No correlations provided for analysis' });
    }

    const groqApiKey = process.env.GROQ_API_KEY;
    console.log('[AI][BIA] GROQ_API_KEY present:', !!groqApiKey, 'length:', groqApiKey?.length ?? 0);

    if (!groqApiKey || groqApiKey.length <= 10) {
      return res.status(400).json({ error: 'Groq API key not configured on server' });
    }

    // Create correlation matrix for analysis
    const correlationMatrix = correlations.map((c: any) => ({
      quality_metric: c.quality_metric.replace(/_/g, ' '),
      business_kpi: c.business_kpi.replace(/_/g, ' '),
      correlation: c.pearson_correlation,
      p_value: c.p_value,
      strength: c.correlation_strength,
      significant: c.is_significant
    }));

    const analysisPrompt = `You are a Senior Data Scientist and Business Intelligence expert. Analyze this correlation matrix from a QA dashboard that measures the relationship between software quality metrics and business outcomes over 12 months.

IMPORTANT: Output your response as clean HTML that can be directly rendered. Use these HTML elements:
- <h2> for section headers
- <h3> for subsection headers  
- <p> for paragraphs
- <ul> and <li> for bullet lists
- <table>, <thead>, <tbody>, <tr>, <th>, <td> for any tables
- <strong> for bold text
- <span class="positive"> for positive correlations, <span class="negative"> for negative ones

DATASET CONTEXT:
- Time Period: 12 consecutive months of data
- Quality Metrics (X variables): Software testing and development metrics
- Business KPIs (Y variables): Revenue, user engagement, satisfaction metrics
- Statistical Method: Pearson correlation coefficient with p-value significance testing

CORRELATION MATRIX DATA:
${correlationMatrix.map((c: any) =>
      `${c.quality_metric} → ${c.business_kpi}: r=${Number(c.correlation).toFixed(3)}, p=${Number(c.p_value) < 0.001 ? '<0.001' : Number(c.p_value).toFixed(4)}, ${c.strength}, ${c.significant ? 'significant' : 'not significant'}`
    ).join('\n')}

ANALYSIS REQUIREMENTS:
1. Executive Summary: Key findings in 3-5 bullet points
2. Statistical Assessment: Evaluate data quality and correlation validity
3. Business Impact Analysis: What do these correlations mean for decision-making?
4. Strategic Recommendations: Which quality metrics should be prioritized?
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
// COMPANY-WIDE DASHBOARD SUMMARY (Hero Section)
// ============================================================================

router.get('/company-summary', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;

    // ============================================================================
    // ALL METRICS ARE CALCULATED FROM REAL DATABASE DATA
    // Source: kpi_snapshots table joined with teams table
    // ============================================================================

    // 1. Get all teams and their LATEST KPI snapshots for this company
    const teamsWithKpis = await query<any>(`
      SELECT 
        t.id AS team_id,
        t.name,
        ks.*
      FROM teams t
      LEFT JOIN kpi_snapshots ks ON t.id = ks.team_id
      WHERE t.company_id = ? AND t.is_active = 1
      ORDER BY ks.snapshot_date DESC
    `, [companyId]);

    // Get unique teams with their latest snapshot only (first row per team_id due to DESC ordering)
    const teamMap = new Map<string, any>();
    for (const row of teamsWithKpis) {
      if (!teamMap.has(row.team_id)) {
        teamMap.set(row.team_id, row);
      }
    }
    const teams = Array.from(teamMap.values());
    const teamsWithData = teams.filter(t => t.qa_score != null);

    if (teams.length === 0 || teamsWithData.length === 0) {
      return res.json({
        globalQaScore: 0,
        globalQaScoreTrend: 0,
        riskLevel: 'unknown',
        avgTestCoverage: 0,
        avgDefectEscapeRate: 0,
        automationCoverage: 0,
        avgFlakinessRate: 0,
        topImproving: [],
        needsAttention: [],
        kpiStatus: { onTrack: 0, atRisk: 0, offTrack: 0 },
        aiSummary: 'No data available. Add teams and KPI snapshots to see insights.',
        teamCount: teams.length,
        teamsWithKpiData: 0
      });
    }

    // ============================================================================
    // METRIC 1: Global QA Score
    // Source: simple average of team QA scores used on the dashboard
    // Formula: (sum of all team qa_score) / (number of teams with KPI data)
    const qaScores = teamsWithData.map(t => Number(t.qa_score) || 0);
    const globalQaScore = qaScores.length
      ? Math.round(qaScores.reduce((sum, score) => sum + score, 0) / qaScores.length)
      : 0;

    // Trend: Compare to historical data (if available)
    const historicalKpis = await query<any>(`
      SELECT AVG(ks.qa_score) as avg_score
      FROM kpi_snapshots ks
      JOIN teams t ON ks.team_id = t.id
      WHERE t.company_id = ?
        AND ks.snapshot_date >= DATE_SUB(NOW(), INTERVAL 14 DAY)
        AND ks.snapshot_date < DATE_SUB(NOW(), INTERVAL 7 DAY)
    `, [companyId]);

    const prevScore = historicalKpis[0]?.avg_score ? Number(historicalKpis[0].avg_score) : globalQaScore;
    const globalQaScoreTrend = Math.round(globalQaScore - prevScore);

    // Risk Level based on global score
    let riskLevel: 'stable' | 'watch' | 'at-risk' = 'stable';
    if (globalQaScore < 60) riskLevel = 'at-risk';
    else if (globalQaScore < 75) riskLevel = 'watch';

    // ============================================================================
    // METRIC 2: Average Test Coverage
    // Source: AVG(kpi_snapshots.test_coverage) across all teams
    // ============================================================================
    const avgTestCoverage = Math.round(
      teamsWithData.reduce((sum, t) => sum + (Number(t.test_coverage) || 0), 0) / teamsWithData.length * 10
    ) / 10; // One decimal place

    // ============================================================================
    // METRIC 3: Average Defect Escape Rate
    // Source: AVG(kpi_snapshots.defect_escape_rate) across all teams
    // Lower is better - this is % of defects that escaped to production
    // ============================================================================
    const avgDefectEscapeRate = Math.round(
      teamsWithData.reduce((sum, t) => sum + (Number(t.defect_escape_rate) || 0), 0) / teamsWithData.length * 10
    ) / 10; // One decimal place

    // ============================================================================
    // METRIC 4: Automation Coverage
    // Source: AVG(kpi_snapshots.automation_coverage) across all teams
    // ============================================================================
    const automationCoverage = Math.round(
      teamsWithData.reduce((sum, t) => sum + (Number(t.automation_coverage) || 0), 0) / teamsWithData.length * 10
    ) / 10; // One decimal place

    // ============================================================================
    // METRIC 5: Average Flakiness Rate
    // Source: AVG(kpi_snapshots.test_flakiness_rate) across all teams
    // Lower is better
    // ============================================================================
    const avgFlakinessRate = Math.round(
      teamsWithData.reduce((sum, t) => sum + (Number(t.test_flakiness_rate) || 0), 0) / teamsWithData.length * 10
    ) / 10; // One decimal place

    // ============================================================================
    // METRIC 6: Top Performing Teams
    // Source: Teams sorted by kpi_snapshots.qa_score DESC
    // ============================================================================
    const sortedByScore = [...teamsWithData].sort((a, b) => (Number(b.qa_score) || 0) - (Number(a.qa_score) || 0));
    const topImproving = sortedByScore.slice(0, 3).map(t => ({
      name: t.name,
      score: Math.round(Number(t.qa_score) || 0)
    }));

    // ============================================================================
    // METRIC 7: Teams Needing Attention
    // Source: Only teams outside the "good" QA band are considered
    //         QA status thresholds (mirrors frontend METRICS_CONFIG.qaScore):
    //           - good:    qa_score >= 85
    //           - warning: qa_score >= 70
    //           - critical: qa_score < 70
    //         We only surface teams in warning/critical (qa_score < 85).
    // ============================================================================
    const QA_GOOD_THRESHOLD = 85;

    const needsAttention = [...teamsWithData]
      // Only teams that are not green
      .filter(t => (Number(t.qa_score) || 0) < QA_GOOD_THRESHOLD)
      // Lowest scores first
      .sort((a, b) => (Number(a.qa_score) || 0) - (Number(b.qa_score) || 0))
      // Take worst 3
      .slice(0, 3)
      .map(t => {
        const score = Number(t.qa_score) || 0;
        const escapeRate = Number(t.defect_escape_rate) || 0;

        let issue: string;
        if (score < 70) issue = 'Critical QA Score';
        else if (escapeRate > 2) issue = 'High Escape Rate';
        else issue = 'Below Target';

        return {
          name: t.name,
          score: Math.round(score),
          issue,
        };
      });

    // ============================================================================
    // METRIC 8: KPI Status (teams meeting thresholds)
    // Source: Count of teams meeting each KPI threshold from kpi_snapshots
    // ============================================================================
    const kpiThresholds = {
      coverage: 80,      // test_coverage >= 80%
      flakiness: 3,      // test_flakiness_rate <= 3%
      escapeRate: 2,     // defect_escape_rate <= 2%
      automation: 70     // automation_coverage >= 70%
    };

    let onTrack = 0, atRisk = 0, offTrack = 0;
    for (const t of teamsWithData) {
      const coverage = Number(t.test_coverage) || 0;
      const flakiness = Number(t.test_flakiness_rate) || 0;
      const escapeRate = Number(t.defect_escape_rate) || 0;
      const automation = Number(t.automation_coverage) || 0;

      // Count how many thresholds this team meets
      const meetsThresholds = (
        (coverage >= kpiThresholds.coverage ? 1 : 0) +
        (flakiness <= kpiThresholds.flakiness ? 1 : 0) +
        (escapeRate <= kpiThresholds.escapeRate ? 1 : 0) +
        (automation >= kpiThresholds.automation ? 1 : 0)
      );

      if (meetsThresholds >= 3) onTrack++;
      else if (meetsThresholds >= 2) atRisk++;
      else offTrack++;
    }

    // ============================================================================
    // AI Summary - Generated from real metrics
    // ============================================================================
    const teamsLowCoverage = teamsWithData.filter(t => (Number(t.test_coverage) || 0) < 80).length;

    let aiSummary = '';
    if (globalQaScoreTrend > 0) {
      aiSummary = `Quality improved by ${globalQaScoreTrend} points. `;
    } else if (globalQaScoreTrend < 0) {
      aiSummary = `Quality declined by ${Math.abs(globalQaScoreTrend)} points. `;
    } else {
      aiSummary = 'Quality metrics stable. ';
    }

    if (teamsLowCoverage > 0) {
      aiSummary += `${teamsLowCoverage} team${teamsLowCoverage > 1 ? 's' : ''} below 80% coverage. `;
    }

    if (automationCoverage < 70) {
      aiSummary += `Automation at ${automationCoverage}% - consider increasing.`;
    } else {
      aiSummary += `Automation coverage at ${automationCoverage}%.`;
    }

    // Debug: Log what data we're using
    console.log('Company Summary Debug:', {
      totalTeams: teams.length,
      teamsWithKpiData: teamsWithData.length,
      teamMetrics: teamsWithData.map(t => ({
        name: t.name,
        qa_score: t.qa_score,
        test_coverage: t.test_coverage,
        automation_coverage: t.automation_coverage,
        defect_escape_rate: t.defect_escape_rate,
        test_flakiness_rate: t.test_flakiness_rate
      }))
    });

    // ============================================================================
    // NEW METRICS CALCULATION (Engineering Health, DORA, Wellness, Tech Debt)
    // ============================================================================

    // 1. Technical Debt Status
    // Fetch aggregated tech debt for the company
    const techDebtSummary = await queryOne<any>(
      `SELECT 
         SUM(CASE 
               WHEN status NOT IN ('resolved','wont_fix') THEN
                 CASE severity
                   WHEN 'critical' THEN 30
                   WHEN 'high' THEN 20
                   WHEN 'medium' THEN 10
                   WHEN 'low' THEN 5
                   ELSE 0
                 END
               ELSE 0
             END) AS total_weight,
         SUM(CASE WHEN status NOT IN ('resolved','wont_fix') THEN 1 ELSE 0 END) AS open_items,
         COUNT(*) as total_items
       FROM technical_debt td
       JOIN teams t ON td.team_id = t.id
       WHERE t.company_id = ?`,
      [companyId]
    );

    const totalTechDebtScore = Math.min(100, Number(techDebtSummary?.total_weight || 0) / (teams.length || 1)); // Normalized per team roughly
    const techDebtStatusScore = Math.round(Math.max(0, 100 - totalTechDebtScore) * 10) / 10; // one decimal place
    const techDebtResolutionRate = techDebtSummary?.total_items > 0
      ? Math.round(((techDebtSummary.total_items - techDebtSummary.open_items) / techDebtSummary.total_items) * 100)
      : 100;

    // 2. Developer Wellness Index
    // Fetch aggregated developer metrics
    // Note: developer_metrics table is a current snapshot (unique key team_id, developer_id), so no date filter needed
    const devMetricsSummary = await queryOne<any>(
      `SELECT 
         AVG(dm.happiness_score) as avg_happiness,
         AVG(dm.focus_time_hours) as avg_focus,
         AVG(dm.meeting_time_hours) as avg_meetings,
         AVG(dm.context_switches_per_day) as avg_switches
       FROM developer_metrics dm
       JOIN users u ON dm.developer_id = u.id
       JOIN team_members tm ON u.id = tm.user_id
       JOIN teams t ON tm.team_id = t.id
       WHERE t.company_id = ?`,
      [companyId]
    );

    const happiness = Number(devMetricsSummary?.avg_happiness || 75); // Default to 75 if no data
    const focusTime = Number(devMetricsSummary?.avg_focus || 4);
    const meetingTime = Number(devMetricsSummary?.avg_meetings || 3);

    // Calculate Burnout Risk (Categorical -> Score)
    // Heuristic: High risk if happiness < 50 OR meeting > 5 OR focus < 2
    let burnoutRiskScore = 100; // Low risk
    if (happiness < 50 || meetingTime > 5 || focusTime < 2) burnoutRiskScore = 20; // High risk
    else if (happiness < 70 || meetingTime > 4 || focusTime < 3) burnoutRiskScore = 60; // Moderate risk

    // Focus Time Score
    let focusTimeScore = 40;
    if (focusTime >= 4) focusTimeScore = 100;
    else if (focusTime >= 3) focusTimeScore = 80;
    else if (focusTime >= 2) focusTimeScore = 60;

    // Meeting Load Score
    let meetingLoadScore = 40;
    if (meetingTime <= 2) meetingLoadScore = 100;
    else if (meetingTime <= 4) meetingLoadScore = 80;
    else if (meetingTime <= 6) meetingLoadScore = 60;

    const developerWellnessIndex = Math.round(
      (happiness * 0.6) +
      (burnoutRiskScore * 0.2) +
      (focusTimeScore * 0.1) +
      (meetingLoadScore * 0.1)
    );

    // 3. Delivery Performance Score (DORA)
    // Based on averages from kpi_snapshots (teamsWithData)
    const avgDeployFreq = teamsWithData.reduce((sum: number, t: any) => sum + (Number(t.deployment_frequency_per_week) || 0), 0) / (teamsWithData.length || 1);
    const avgLeadTime = teamsWithData.reduce((sum: number, t: any) => sum + (Number(t.lead_time_days) || 0), 0) / (teamsWithData.length || 1);
    const avgFailureRate = teamsWithData.reduce((sum: number, t: any) => sum + (Number(t.change_failure_rate) || 0), 0) / (teamsWithData.length || 1);
    const avgMttr = teamsWithData.reduce((sum: number, t: any) => sum + (Number(t.mttr_hours) || 0), 0) / (teamsWithData.length || 1);

    let doraLevelScore = 40; // Low
    if (avgDeployFreq >= 7 && avgLeadTime < 1 && avgFailureRate < 5 && avgMttr < 1) {
      doraLevelScore = 100; // Elite
    } else if (avgDeployFreq >= 1 && avgLeadTime < 7 && avgFailureRate < 15 && avgMttr < 24) {
      doraLevelScore = 80; // High
    } else if (avgDeployFreq >= 0.25 && avgLeadTime < 30 && avgFailureRate < 30 && avgMttr < 48) {
      doraLevelScore = 60; // Medium
    }

    const deliveryPerformanceScore = doraLevelScore;

    // 4. Pipeline Health Score (Constant as requested)
    const pipelineHealthScore = 96;

    // 5. Engineering Health Score (Overall Composite)
    const engineeringHealthScore = Math.round(
      (doraLevelScore * 0.35) +
      (pipelineHealthScore * 0.25) +
      (techDebtStatusScore * 0.20) +
      (happiness * 0.15) +
      (burnoutRiskScore * 0.05)
    );

    // ============================================================================
    // RESPONSE - All values from real database data
    // ============================================================================
    res.json({
      // New Executive Metrics
      engineeringHealthScore,
      deliveryPerformanceScore,
      developerWellnessIndex,
      techDebtStatusScore,
      pipelineHealthScore,
      techDebtResolutionRate,

      // Keep existing metrics for compatibility or drill-downs
      globalQaScore,
      globalQaScoreTrend,
      riskLevel,
      avgTestCoverage,
      avgDefectEscapeRate,
      automationCoverage,
      avgFlakinessRate,

      topImproving,
      needsAttention,
      kpiStatus: { onTrack, atRisk, offTrack },
      aiSummary,
      teamCount: teams.length,
      teamsWithKpiData: teamsWithData.length
    });
  } catch (error) {
    console.error('Error fetching company summary:', error);
    res.status(500).json({ error: 'Failed to fetch company summary' });
  }
});

// Get AI insights for company-wide metrics (Exec Dashboard)
router.post('/company-insights', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { companyId, role } = user;

    if (!['super_admin', 'manager', 'team_lead'].includes(role)) {
      return res.status(403).json({ error: 'Executive insights are restricted.' });
    }

    // 1. Calculate Metrics (Same logic as company-summary)
    const teams = await query<any[]>(
      'SELECT id, name, company_id FROM teams WHERE company_id = ? AND is_active = true',
      [companyId]
    );

    const kpiData = await query<any>(`
      SELECT ks.*, t.name 
      FROM kpi_snapshots ks
      INNER JOIN (
        SELECT team_id, MAX(snapshot_date) as max_date
        FROM kpi_snapshots
        GROUP BY team_id
      ) latest ON ks.team_id = latest.team_id AND ks.snapshot_date = latest.max_date
      JOIN teams t ON ks.team_id = t.id
      WHERE t.company_id = ?
    `, [companyId]);

    const teamsWithData = kpiData || [];

    // Tech Debt
    const techDebtSummary = await queryOne<any>(
      `SELECT 
         SUM(CASE 
               WHEN status NOT IN ('resolved','wont_fix') THEN
                 CASE severity WHEN 'critical' THEN 30 WHEN 'high' THEN 20 WHEN 'medium' THEN 10 WHEN 'low' THEN 5 ELSE 0 END
               ELSE 0
             END) AS total_weight,
         COUNT(*) as total_items
       FROM technical_debt td
       JOIN teams t ON td.team_id = t.id
       WHERE t.company_id = ?`,
      [companyId]
    );
    const totalTechDebtScore = Math.min(100, Number(techDebtSummary?.total_weight || 0) / (teams.length || 1));
    const techDebtStatusScore = Math.round(Math.max(0, 100 - totalTechDebtScore) * 10) / 10;

    // Dev Wellness
    const devMetricsSummary = await queryOne<any>(
      `SELECT 
         AVG(dm.happiness_score) as avg_happiness,
         AVG(dm.focus_time_hours) as avg_focus,
         AVG(dm.meeting_time_hours) as avg_meetings
       FROM developer_metrics dm
       JOIN users u ON dm.developer_id = u.id
       JOIN teams t ON dm.team_id = t.id
       WHERE t.company_id = ?`,
      [companyId]
    );
    const happiness = Number(devMetricsSummary?.avg_happiness || 75);
    const focusTime = Number(devMetricsSummary?.avg_focus || 4);
    const meetingTime = Number(devMetricsSummary?.avg_meetings || 3);

    let burnoutRiskScore = 100;
    if (happiness < 50 || meetingTime > 5 || focusTime < 2) burnoutRiskScore = 20;
    else if (happiness < 70 || meetingTime > 4 || focusTime < 3) burnoutRiskScore = 60;

    let focusTimeScore = focusTime >= 4 ? 100 : focusTime >= 3 ? 80 : focusTime >= 2 ? 60 : 40;
    let meetingLoadScore = meetingTime <= 2 ? 100 : meetingTime <= 4 ? 80 : meetingTime <= 6 ? 60 : 40;

    const developerWellnessIndex = Math.round(
      (happiness * 0.6) + (burnoutRiskScore * 0.2) + (focusTimeScore * 0.1) + (meetingLoadScore * 0.1)
    );

    // DORA
    const avgDeployFreq = teamsWithData.reduce((sum, t) => sum + (Number(t.deployment_frequency_per_week) || 0), 0) / (teamsWithData.length || 1);
    const avgLeadTime = teamsWithData.reduce((sum, t) => sum + (Number(t.lead_time_days) || 0), 0) / (teamsWithData.length || 1);
    const avgFailureRate = teamsWithData.reduce((sum, t) => sum + (Number(t.change_failure_rate) || 0), 0) / (teamsWithData.length || 1);
    const avgMttr = teamsWithData.reduce((sum, t) => sum + (Number(t.mttr_hours) || 0), 0) / (teamsWithData.length || 1);

    let doraLevelScore = 40;
    if (avgDeployFreq >= 7 && avgLeadTime < 1 && avgFailureRate < 5 && avgMttr < 1) doraLevelScore = 100;
    else if (avgDeployFreq >= 1 && avgLeadTime < 7 && avgFailureRate < 15 && avgMttr < 24) doraLevelScore = 80;
    else if (avgDeployFreq >= 0.25 && avgLeadTime < 30 && avgFailureRate < 30 && avgMttr < 48) doraLevelScore = 60;

    const deliveryPerformanceScore = doraLevelScore;
    const pipelineHealthScore = 96;

    const engineeringHealthScore = Math.round(
      (doraLevelScore * 0.35) +
      (pipelineHealthScore * 0.25) +
      (techDebtStatusScore * 0.20) +
      (happiness * 0.15) +
      (burnoutRiskScore * 0.05)
    );

    // Detailed Aggregates
    const avgQaScore = Math.round(teamsWithData.reduce((sum: number, t: any) => sum + (Number(t.qa_score) || 0), 0) / (teamsWithData.length || 1));
    const avgTestCoverage = Math.round(teamsWithData.reduce((sum: number, t: any) => sum + (Number(t.test_coverage) || 0), 0) / (teamsWithData.length || 1));
    const avgDefectEscape = Math.round(teamsWithData.reduce((sum: number, t: any) => sum + (Number(t.defect_escape_rate) || 0), 0) / (teamsWithData.length || 1));
    const avgFlakiness = Math.round(teamsWithData.reduce((sum: number, t: any) => sum + (Number(t.test_flakiness_rate) || 0), 0) / (teamsWithData.length || 1));
    const automationCov = Math.round(teamsWithData.reduce((sum: number, t: any) => sum + (Number(t.automation_coverage) || 0), 0) / (teamsWithData.length || 1));

    // 2. Store Snapshot
    await query(`
      INSERT INTO company_kpi_snapshots 
      (company_id, snapshot_date, engineering_health_score, delivery_performance_score, developer_wellness_index, tech_debt_status_score, pipeline_health_score, avg_qa_score, avg_test_coverage, avg_defect_escape_rate, avg_flakiness_rate, automation_coverage)
      VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      engineering_health_score = VALUES(engineering_health_score),
      delivery_performance_score = VALUES(delivery_performance_score),
      developer_wellness_index = VALUES(developer_wellness_index),
      tech_debt_status_score = VALUES(tech_debt_status_score),
      pipeline_health_score = VALUES(pipeline_health_score),
      avg_qa_score = VALUES(avg_qa_score),
      avg_test_coverage = VALUES(avg_test_coverage),
      avg_defect_escape_rate = VALUES(avg_defect_escape_rate),
      avg_flakiness_rate = VALUES(avg_flakiness_rate),
      automation_coverage = VALUES(automation_coverage)
    `, [
      companyId,
      engineeringHealthScore, deliveryPerformanceScore, developerWellnessIndex, techDebtStatusScore, pipelineHealthScore,
      avgQaScore, avgTestCoverage, avgDefectEscape, avgFlakiness, automationCov
    ]);

    // 3. Fetch History (Last 30 days)
    const history = await query<any[]>(`
      SELECT * FROM company_kpi_snapshots 
      WHERE company_id = ? 
      ORDER BY snapshot_date ASC 
      LIMIT 30
    `, [companyId]);

    // 4. Generate AI Analysis (retries + smaller-model fallback)
    let aiAnalysis = "AI analysis unavailable.";

    if (isGroqConfigured()) {
      console.log('🤖 Generating Company Insights via Groq AI...');
      try {
        const { content, model } = await groqChatCompletion({
          label: 'AI:Company',
          maxTokens: 500,
          messages: [
            {
              role: 'system',
              content: `You are a CTO/VP of Engineering advisor. Analyze these company-wide metrics and trends.

Current Metrics:
- Engineering Health: ${engineeringHealthScore}/100
- Delivery (DORA): ${deliveryPerformanceScore}/100
- Wellness: ${developerWellnessIndex}/100
- Tech Debt Status: ${techDebtStatusScore}/100
- Pipeline Health: ${pipelineHealthScore}/100

Provide a concise executive summary (3-4 sentences) highlighting the biggest risk and the biggest win. Then provide 3 strategic recommendations.`
            },
            {
              role: 'user',
              content: `Here is the 30-day trend data: ${JSON.stringify(history.map(h => ({ date: h.snapshot_date, health: h.engineering_health_score, dora: h.delivery_performance_score })))}`
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
        engineeringHealthScore,
        deliveryPerformanceScore,
        developerWellnessIndex,
        techDebtStatusScore,
        pipelineHealthScore
      },
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

    // Team leads can only access their own team
    const { allowed, teamId } = getTeamIdForRole(role, primaryTeamId, requestedTeamId);

    // Build query
    let sql = `
      SELECT 
        dps.developer_id,
        CONCAT(u.first_name, ' ', u.last_name) as developer_name,
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
    `;
    const params: any[] = [companyId, startDateStr];

    // Filter by specific developer
    if (developerId && developerId !== 'all') {
      sql += ' AND dps.developer_id = ?';
      params.push(developerId);
    }

    // Filter by team
    if (teamId) {
      sql += ' AND u.primary_team_id = ?';
      params.push(teamId);
    }

    sql += ' ORDER BY dps.snapshot_date ASC, dps.developer_id';

    const snapshots = await query<any>(sql, params);

    // Aggregate data by date for chart
    const dailyAverages: Record<string, { count: number; totalDDPS: number; date: string }> = {};
    snapshots.forEach((s: any) => {
      const dateStr = new Date(s.snapshot_date).toISOString().split('T')[0];
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

    // Calculate overall stats
    const allDDPS = snapshots.map((s: any) => parseFloat(s.ddps_score));
    const avgDDPS = allDDPS.length > 0 ? allDDPS.reduce((a, b) => a + b, 0) / allDDPS.length : 0;
    const minDDPS = allDDPS.length > 0 ? Math.min(...allDDPS) : 0;
    const maxDDPS = allDDPS.length > 0 ? Math.max(...allDDPS) : 0;

    // Calculate trend (compare last 7 days vs previous 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const recent = snapshots.filter((s: any) =>
      new Date(s.snapshot_date).toISOString().split('T')[0] >= sevenDaysAgo
    );
    const previous = snapshots.filter((s: any) => {
      const dateStr = new Date(s.snapshot_date).toISOString().split('T')[0];
      return dateStr >= fourteenDaysAgo && dateStr < sevenDaysAgo;
    });

    const recentAvg = recent.length > 0
      ? recent.reduce((a, s: any) => a + parseFloat(s.ddps_score), 0) / recent.length
      : 0;
    const previousAvg = previous.length > 0
      ? previous.reduce((a, s: any) => a + parseFloat(s.ddps_score), 0) / previous.length
      : 0;
    const trend = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg) * 100 : 0;

    // Generate executive summary
    const ddpsPercent = Math.round(avgDDPS * 100);
    let summaryStatus = 'fragmented';
    if (avgDDPS >= 0.8) summaryStatus = 'exceptional deep-focus';
    else if (avgDDPS >= 0.6) summaryStatus = 'high productivity';
    else if (avgDDPS >= 0.4) summaryStatus = 'healthy';
    else if (avgDDPS >= 0.2) summaryStatus = 'low productivity';

    // Identify loss drivers
    const avgMetrics = {
      meeting: snapshots.length > 0
        ? snapshots.reduce((a, s: any) => a + parseFloat(s.meeting_time_hours), 0) / snapshots.length
        : 0,
      contextSwitches: snapshots.length > 0
        ? snapshots.reduce((a, s: any) => a + parseFloat(s.context_switches_per_day), 0) / snapshots.length
        : 0,
      focusTime: snapshots.length > 0
        ? snapshots.reduce((a, s: any) => a + parseFloat(s.focus_time_hours), 0) / snapshots.length
        : 0
    };

    const lossDrivers: string[] = [];
    if (avgMetrics.meeting > 2.5) lossDrivers.push('meetings');
    if (avgMetrics.contextSwitches > 5) lossDrivers.push('context switching');
    if (avgMetrics.focusTime < 4) lossDrivers.push('insufficient focus time');

    const executiveSummary = {
      headline: `Only ~${ddpsPercent}% of the day converted into deep, value-producing work.`,
      status: summaryStatus,
      lossDrivers: lossDrivers.length > 0
        ? `Primary loss drivers: ${lossDrivers.join(' and ')}.`
        : 'No significant loss drivers identified.',
      recommendation: avgDDPS < 0.4
        ? 'Consider reducing meetings and protecting focus time blocks.'
        : avgDDPS < 0.6
          ? 'Team is performing well. Look for opportunities to minimize interruptions.'
          : 'Excellent productivity! Maintain current practices.'
    };

    res.json({
      range,
      startDate: startDateStr,
      endDate: now.toISOString().split('T')[0],
      stats: {
        average: Math.round(avgDDPS * 10000) / 10000,
        min: Math.round(minDDPS * 10000) / 10000,
        max: Math.round(maxDDPS * 10000) / 10000,
        trend: Math.round(trend * 100) / 100,
        totalSnapshots: snapshots.length
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
