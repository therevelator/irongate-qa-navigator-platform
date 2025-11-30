import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken } from '../middleware/auth';
import { seedAllAnalyticsData, updateDailyAnalytics } from '../jobs/analyticsSync';

const router = express.Router();

// ============================================================================
// TEST EXECUTION TIMELINE
// ============================================================================

router.get('/test-executions', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { teamId, days = '7' } = req.query;
    const numDays = Math.min(parseInt(days as string) || 7, 30);

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
    const { companyId } = req.user;
    const { teamId, status } = req.query;

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
    const { companyId } = req.user;
    const { teamId } = req.query;

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

    // Generate history from execution records
    const result = await Promise.all(flakyTests.map(async (ft: any) => {
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
  }
});

// ============================================================================
// TECHNICAL DEBT TRACKER
// ============================================================================

router.get('/technical-debt', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { teamId, status } = req.query;

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

    const result = debts.map((d: any) => ({
      id: d.id,
      title: d.title,
      description: d.description || '',
      category: d.category || 'code_quality',
      severity: d.severity,
      estimated_effort_hours: Number(d.estimated_effort_hours) || 0,
      cost_of_delay: Number(d.cost_of_delay) || 0,
      priority_score: Number(d.priority_score) || 0,
      status: d.status,
      created_date: d.created_date,
      assigned_to: d.assigned_to_name
    }));

    res.json({ debts: result });
  } catch (error) {
    console.error('Error fetching technical debt:', error);
    res.status(500).json({ error: 'Failed to fetch technical debt' });
  }
});

// ============================================================================
// CI/CD PIPELINE INSIGHTS
// ============================================================================

router.get('/pipeline-stages', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { teamId } = req.query;

    let sql = `
      SELECT 
        ps.id,
        ps.name,
        ps.stage_order,
        ps.avg_duration_seconds as duration,
        ps.success_rate,
        ps.cpu_usage,
        ps.memory_usage,
        ps.cost_per_run as cost,
        ps.bottleneck_score
      FROM pipeline_stages ps
      WHERE ps.company_id = ? AND ps.is_active = true
    `;
    const params: any[] = [companyId];

    if (teamId) {
      sql += ' AND (ps.team_id = ? OR ps.team_id IS NULL)';
      params.push(teamId);
    }

    sql += ' ORDER BY ps.stage_order ASC';

    const stages = await query<any>(sql, params);

    const result = stages.map((s: any) => ({
      id: s.id,
      name: s.name,
      duration: Number(s.duration) || 0,
      success_rate: Number(s.success_rate) || 100,
      resource_usage: {
        cpu: Number(s.cpu_usage) || 0,
        memory: Number(s.memory_usage) || 0,
        cost: Number(s.cost) || 0
      },
      bottleneck_score: Number(s.bottleneck_score) || 0
    }));

    res.json({ stages: result });
  } catch (error) {
    console.error('Error fetching pipeline stages:', error);
    res.status(500).json({ error: 'Failed to fetch pipeline stages' });
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

    const result = metrics.map((m: any) => ({
      metric_name: m.metric_name,
      quality_score: Number(m.quality_score) || 0,
      revenue_impact: Number(m.revenue_impact) || 0,
      customer_satisfaction: Number(m.customer_satisfaction) || 0,
      feature_adoption_rate: Number(m.feature_adoption_rate) || 0,
      correlation_strength: Number(m.correlation_strength) || 0
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

export default router;
