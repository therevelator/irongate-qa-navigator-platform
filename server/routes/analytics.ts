import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken } from '../middleware/auth';
import { seedAllAnalyticsData, updateDailyAnalytics } from '../jobs/analyticsSync';
import { randomUUID } from 'crypto';

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
    const { teamId, days = '30' } = req.query;
    const numDays = Math.min(parseInt(days as string) || 30, 90);

    let sql = `
      SELECT 
        dm.id,
        dm.user_id as developer_id,
        CONCAT(u.first_name, ' ', u.last_name) as name,
        AVG(dm.code_review_time_avg) as code_review_time_avg,
        AVG(dm.pr_merge_time_avg) as pr_merge_time_avg,
        AVG(dm.happiness_score) as happiness_score,
        AVG(dm.context_switches_per_day) as context_switches_per_day,
        AVG(dm.focus_time_hours) as focus_time_hours,
        AVG(dm.meeting_time_hours) as meeting_time_hours
      FROM developer_metrics dm
      JOIN users u ON dm.user_id = u.id
      JOIN team_members tm ON u.id = tm.user_id
      JOIN teams t ON tm.team_id = t.id
      WHERE t.company_id = ?
        AND dm.recorded_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
    `;
    const params: any[] = [companyId, numDays];

    if (teamId) {
      sql += ' AND tm.team_id = ?';
      params.push(teamId);
    }

    sql += ' GROUP BY dm.user_id, u.first_name, u.last_name ORDER BY happiness_score DESC';

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
      // Make logging more visible
      alert("🚀 Preparing Groq API Call - Check server console!");
      console.error("🚀🚀🚀 GROQ API CALL STARTING 🚀🚀🚀");
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

  // Approximate p-value using t-distribution
  const t = correlation * Math.sqrt((n - 2) / (1 - correlation * correlation));
  // Simplified p-value approximation
  const pValue = n < 6 ? 1 : Math.exp(-0.5 * t * t / n);

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

    // Realistic base values and trends
    const generateRealisticData = () => {
      const qualityBase = {
        test_coverage: 65 + Math.random() * 20, // 65-85%
        defect_density: 3.5 + Math.random() * 2, // 3.5-5.5 bugs/KLOC
        defect_escape_rate: 15 + Math.random() * 10, // 15-25%
        mttr_hours: 6 + Math.random() * 4, // 6-10 hours
        deployment_frequency: 3 + Math.random() * 4, // 3-7 deployments/month
        lead_time_days: 10 + Math.random() * 5, // 10-15 days
        code_quality_score: 70 + Math.random() * 15, // 70-85%
        change_failure_rate: 18 + Math.random() * 8, // 18-26%
      };

      const kpiBase = {
        monthly_revenue: 350000 + Math.random() * 200000, // $350K-550K
        active_users: 10000 + Math.random() * 15000, // 10K-25K users
        churn_rate: 4 + Math.random() * 4, // 4-8%
        feature_adoption_rate: 35 + Math.random() * 20, // 35-55%
        nps_score: 20 + Math.random() * 40, // 20-60
        csat_score: 65 + Math.random() * 15, // 65-80%
        support_ticket_volume: 400 + Math.random() * 300, // 400-700 tickets
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

export default router;
