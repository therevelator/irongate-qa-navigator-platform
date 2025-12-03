import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get aggregated metrics history for analytics (across all teams in company)
router.get('/analytics/history', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { days = '30', metric } = req.query;
    const numDays = Math.min(parseInt(days as string) || 30, 90);

    let sql = `
      SELECT 
        k.snapshot_date,
        AVG(k.test_coverage) as avg_test_coverage,
        AVG(k.defect_density) as avg_defect_density,
        AVG(k.automation_coverage) as avg_automation_coverage,
        AVG(k.code_quality_score) as avg_code_quality_score,
        AVG(k.qa_score) as avg_qa_score,
        AVG(k.deployment_frequency_per_week) as avg_deployment_frequency,
        AVG(k.mttr_hours) as avg_mttr,
        AVG(k.lead_time_days) as avg_lead_time,
        AVG(k.change_failure_rate) as avg_change_failure_rate,
        AVG(k.sprint_velocity) as avg_sprint_velocity,
        AVG(k.first_time_pass_rate) as avg_first_time_pass_rate,
        COUNT(DISTINCT k.team_id) as team_count
      FROM kpi_snapshots k
      JOIN teams t ON k.team_id = t.id
      WHERE t.company_id = ? 
        AND t.is_active = true
        AND k.snapshot_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY k.snapshot_date
      ORDER BY k.snapshot_date ASC
    `;

    const history = await query<any>(sql, [companyId, numDays]);

    // Transform to chart-friendly format
    const chartData = history.map((row: any) => ({
      date: new Date(row.snapshot_date).toISOString().split('T')[0],
      testCoverage: Number(row.avg_test_coverage?.toFixed(2)) || 0,
      defectDensity: Number(row.avg_defect_density?.toFixed(3)) || 0,
      automationCoverage: Number(row.avg_automation_coverage?.toFixed(2)) || 0,
      codeQuality: Number(row.avg_code_quality_score?.toFixed(2)) || 0,
      qaScore: Number(row.avg_qa_score?.toFixed(2)) || 0,
      deploymentFrequency: Number(row.avg_deployment_frequency?.toFixed(2)) || 0,
      mttr: Number(row.avg_mttr?.toFixed(2)) || 0,
      leadTime: Number(row.avg_lead_time?.toFixed(2)) || 0,
      changeFailureRate: Number(row.avg_change_failure_rate?.toFixed(2)) || 0,
      sprintVelocity: Number(row.avg_sprint_velocity?.toFixed(2)) || 0,
      firstTimePassRate: Number(row.avg_first_time_pass_rate?.toFixed(2)) || 0,
      teamCount: row.team_count
    }));

    res.json({ history: chartData, days: numDays });
  } catch (error) {
    console.error('Error fetching analytics history:', error);
    res.status(500).json({ error: 'Failed to fetch analytics history' });
  }
});

// Get per-team metrics comparison for analytics
router.get('/analytics/teams', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;

    const teams = await query<any>(`
      SELECT 
        t.id,
        t.name,
        k.qa_score,
        k.test_coverage,
        k.defect_density,
        k.automation_coverage,
        k.deployment_frequency_per_week,
        k.mttr_hours,
        k.change_failure_rate,
        k.sprint_velocity
      FROM teams t
      LEFT JOIN kpi_snapshots k ON t.id = k.team_id 
        AND k.snapshot_date = (SELECT MAX(snapshot_date) FROM kpi_snapshots WHERE team_id = t.id)
      WHERE t.company_id = ? AND t.is_active = true
      ORDER BY k.qa_score DESC
    `, [companyId]);

    res.json({ teams });
  } catch (error) {
    console.error('Error fetching team analytics:', error);
    res.status(500).json({ error: 'Failed to fetch team analytics' });
  }
});

// Get team KPIs (latest snapshot)
router.get('/teams/:teamId', authenticateToken, async (req: AuthRequest, res) => {
  try {
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
    const { days = '30' } = req.query;
    
    const history = await query<any[]>(
      `SELECT * FROM kpi_snapshots 
       WHERE team_id = ? 
       AND snapshot_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       ORDER BY snapshot_date DESC`,
      [req.params.teamId, parseInt(days as string)]
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

// Get dashboard summary (public endpoint, but filtered by role if authenticated)
router.get('/dashboard', async (req: AuthRequest, res) => {
  try {
    // Check if user is authenticated
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    let userRole = null;
    let userId = null;
    let primaryTeamId = null;
    
    if (token) {
      // Try to decode token to get user info
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
        userRole = decoded.role;
        userId = decoded.userId;
        primaryTeamId = decoded.primaryTeamId;
      } catch (error) {
        // Token invalid, treat as public access
      }
    }
    
    // Build query based on role
    let teamFilter = '';
    let params: any[] = [];
    
    // All roles can see all teams on the dashboard
    // No role-based filtering for the main dashboard view
    // qa_manager, team_lead, and super_admin see all teams (no filter)
    // Public users see all teams (no filter)
    
    // Get total teams count
    const totalTeamsResult = await queryOne<any>(
      `SELECT COUNT(*) as count FROM teams t ${teamFilter}`,
      params
    );
    const totalTeams = totalTeamsResult?.count || 0;
    
    // Get overall pass rate from recent test executions
    const passRateResult = await queryOne<any>(
      `SELECT 
        AVG(CASE WHEN total_tests > 0 THEN (passed * 100.0 / total_tests) ELSE 0 END) as avg_pass_rate
       FROM test_executions te
       JOIN teams t ON te.team_id = t.id
       ${teamFilter}
       WHERE te.execution_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
      params
    );
    const overallPassRate = passRateResult?.avg_pass_rate || 0;
    
    // Get open defects count
    const openDefectsResult = await queryOne<any>(
      `SELECT COUNT(*) as count 
       FROM defects d
       JOIN teams t ON d.team_id = t.id
       ${teamFilter}
       WHERE d.status IN ('open', 'in_progress')`,
      params
    );
    const openDefects = openDefectsResult?.count || 0;
    
    // Get critical defects count
    const criticalDefectsResult = await queryOne<any>(
      `SELECT COUNT(*) as count 
       FROM defects d
       JOIN teams t ON d.team_id = t.id
       ${teamFilter}
       WHERE d.severity = 'critical' AND d.status IN ('open', 'in_progress')`,
      params
    );
    const criticalDefects = criticalDefectsResult?.count || 0;
    
    // Get top performing teams (last 30 days)
    const topTeams = await query<any[]>(
      `SELECT 
        t.id,
        t.name,
        t.platform,
        d.name as department_name,
        COUNT(DISTINCT te.id) as total_tests,
        AVG(CASE WHEN te.total_tests > 0 THEN (te.passed * 100.0 / te.total_tests) ELSE 0 END) as pass_rate
       FROM teams t
       LEFT JOIN departments d ON t.department_id = d.id
       LEFT JOIN test_executions te ON t.id = te.team_id 
         AND te.execution_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       ${teamFilter}
       GROUP BY t.id, t.name, t.platform, d.name
       HAVING COUNT(DISTINCT te.id) > 0
       ORDER BY pass_rate DESC
       LIMIT 5`,
      params
    );
    
    res.json({
      stats: {
        totalTeams,
        overallPassRate: parseFloat(overallPassRate.toFixed(1)),
        openDefects,
        criticalDefects
      },
      topTeams: topTeams.map(team => ({
        id: team.id,
        name: team.name,
        platform: team.platform,
        department_name: team.department_name,
        totalTests: team.total_tests,
        passRate: parseFloat((team.pass_rate || 0).toFixed(1))
      }))
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to get dashboard data' });
  }
});

// Trigger manual sync (admin only)
router.post('/sync', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (req.userRole !== 'super_admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // This would trigger the sync job manually
    // For now, just return success
    res.json({ message: 'Sync triggered successfully' });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Failed to trigger sync' });
  }
});

// Manual metrics input (super_admin, manager, team_lead)
router.post('/manual', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const allowedRoles = ['super_admin', 'manager', 'team_lead'];
    if (!allowedRoles.includes(req.userRole || '')) {
      return res.status(403).json({ error: 'Access denied. Requires Super Admin, Manager, or Team Lead role.' });
    }

    const {
      teamId,
      test_coverage,
      test_flakiness_rate,
      defect_density,
      defect_escape_rate,
      code_quality_score,
      avg_build_time_minutes,
      test_execution_time_minutes,
      deployment_frequency_per_week,
      lead_time_days,
      mttr_hours,
      parallel_test_efficiency,
      sprint_velocity,
      sprint_commitment_rate,
      sprint_carryover,
      first_time_pass_rate,
      blocked_time_hours,
      automation_coverage,
      automation_roi,
      change_failure_rate,
      mtbf_hours,
      system_availability,
      infrastructure_failures,
      sizing_accuracy
    } = req.body;

    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    // Calculate QA Score based on the formula:
    // QA_Score = Test_Coverage × 0.30 + (100 - Defect_Escape_Rate) × 0.25 + (100 - Change_Failure_Rate) × 0.25 + Code_Quality_Score × 0.20
    const testCov = Number(test_coverage) || 0;
    const defectEscape = Number(defect_escape_rate) || 0;
    const changeFailure = Number(change_failure_rate) || 0;
    const codeQuality = Number(code_quality_score) || 0;
    
    const qaScore = 
      testCov * 0.30 +
      (100 - defectEscape) * 0.25 +
      (100 - changeFailure) * 0.25 +
      codeQuality * 0.20;

    // Determine status based on QA Score
    let status = 'unknown';
    if (qaScore >= 85) status = 'good';
    else if (qaScore >= 70) status = 'warning';
    else if (qaScore > 0) status = 'critical';

    // Insert or update KPI snapshot for today
    // Use INSERT ... ON DUPLICATE KEY UPDATE to handle existing entries for the same team/date
    //this will be the part that inserts into the DB from the aggregator
    await query(
      `INSERT INTO kpi_snapshots (
        team_id,
        snapshot_date,
        qa_score,
        status,
        test_coverage,
        test_flakiness_rate,
        defect_density,
        defect_escape_rate,
        code_quality_score,
        avg_build_time_minutes,
        test_execution_time_minutes,
        deployment_frequency_per_week,
        lead_time_days,
        mttr_hours,
        parallel_test_efficiency,
        sprint_velocity,
        sprint_commitment_rate,
        sprint_carryover,
        first_time_pass_rate,
        blocked_time_hours,
        automation_coverage,
        automation_roi,
        change_failure_rate,
        mtbf_hours,
        system_availability,
        infrastructure_failures,
        sizing_accuracy,
        manually_edited
      ) VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
      ON DUPLICATE KEY UPDATE
        qa_score = VALUES(qa_score),
        status = VALUES(status),
        test_coverage = COALESCE(VALUES(test_coverage), test_coverage),
        test_flakiness_rate = COALESCE(VALUES(test_flakiness_rate), test_flakiness_rate),
        defect_density = COALESCE(VALUES(defect_density), defect_density),
        defect_escape_rate = COALESCE(VALUES(defect_escape_rate), defect_escape_rate),
        code_quality_score = COALESCE(VALUES(code_quality_score), code_quality_score),
        avg_build_time_minutes = COALESCE(VALUES(avg_build_time_minutes), avg_build_time_minutes),
        test_execution_time_minutes = COALESCE(VALUES(test_execution_time_minutes), test_execution_time_minutes),
        deployment_frequency_per_week = COALESCE(VALUES(deployment_frequency_per_week), deployment_frequency_per_week),
        lead_time_days = COALESCE(VALUES(lead_time_days), lead_time_days),
        mttr_hours = COALESCE(VALUES(mttr_hours), mttr_hours),
        parallel_test_efficiency = COALESCE(VALUES(parallel_test_efficiency), parallel_test_efficiency),
        sprint_velocity = COALESCE(VALUES(sprint_velocity), sprint_velocity),
        sprint_commitment_rate = COALESCE(VALUES(sprint_commitment_rate), sprint_commitment_rate),
        sprint_carryover = COALESCE(VALUES(sprint_carryover), sprint_carryover),
        first_time_pass_rate = COALESCE(VALUES(first_time_pass_rate), first_time_pass_rate),
        blocked_time_hours = COALESCE(VALUES(blocked_time_hours), blocked_time_hours),
        automation_coverage = COALESCE(VALUES(automation_coverage), automation_coverage),
        automation_roi = COALESCE(VALUES(automation_roi), automation_roi),
        change_failure_rate = COALESCE(VALUES(change_failure_rate), change_failure_rate),
        mtbf_hours = COALESCE(VALUES(mtbf_hours), mtbf_hours),
        system_availability = COALESCE(VALUES(system_availability), system_availability),
        infrastructure_failures = COALESCE(VALUES(infrastructure_failures), infrastructure_failures),
        sizing_accuracy = COALESCE(VALUES(sizing_accuracy), sizing_accuracy),
        manually_edited = TRUE`,
      [
        teamId,
        qaScore,
        status,
        test_coverage ?? null,
        test_flakiness_rate ?? null,
        defect_density ?? null,
        defect_escape_rate ?? null,
        code_quality_score ?? null,
        avg_build_time_minutes ?? null,
        test_execution_time_minutes ?? null,
        deployment_frequency_per_week ?? null,
        lead_time_days ?? null,
        mttr_hours ?? null,
        parallel_test_efficiency ?? null,
        sprint_velocity ?? null,
        sprint_commitment_rate ?? null,
        sprint_carryover ?? null,
        first_time_pass_rate ?? null,
        blocked_time_hours ?? null,
        automation_coverage ?? null,
        automation_roi ?? null,
        change_failure_rate ?? null,
        mtbf_hours ?? null,
        system_availability ?? null,
        infrastructure_failures ?? null,
        sizing_accuracy ?? null
      ]
    );

    res.json({ 
      message: 'Metrics saved successfully',
      qaScore: qaScore.toFixed(2),
      status
    });
  } catch (error) {
    console.error('Manual metrics error:', error);
    res.status(500).json({ error: 'Failed to save metrics' });
  }
});

// Save developer metrics (super_admin, manager, team_lead)
router.post('/developer', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const allowedRoles = ['super_admin', 'manager', 'team_lead'];
    if (!allowedRoles.includes(req.userRole || '')) {
      return res.status(403).json({ error: 'Access denied. Requires Super Admin, Manager, or Team Lead role.' });
    }

    const {
      teamId,
      developerId,
      prMergeTimeAvg,
      codeReviewTimeAvg,
      focusTimeHours,
      meetingTimeHours,
      contextSwitchesPerDay,
      happinessScore
    } = req.body;

    if (!teamId || !developerId) {
      return res.status(400).json({ error: 'Team ID and developer ID are required' });
    }

    await query(
      `INSERT INTO developer_metrics (
        team_id,
        developer_id,
        pr_merge_time_avg,
        code_review_time_avg,
        focus_time_hours,
        meeting_time_hours,
        context_switches_per_day,
        happiness_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        pr_merge_time_avg = VALUES(pr_merge_time_avg),
        code_review_time_avg = VALUES(code_review_time_avg),
        focus_time_hours = VALUES(focus_time_hours),
        meeting_time_hours = VALUES(meeting_time_hours),
        context_switches_per_day = VALUES(context_switches_per_day),
        happiness_score = VALUES(happiness_score)` ,
      [
        teamId,
        developerId,
        prMergeTimeAvg ?? null,
        codeReviewTimeAvg ?? null,
        focusTimeHours ?? null,
        meetingTimeHours ?? null,
        contextSwitchesPerDay ?? null,
        happinessScore ?? null
      ]
    );

    res.json({ 
      message: 'Developer metrics saved successfully',
      teamId,
      developerId
    });
  } catch (error) {
    console.error('Developer metrics error:', error);
    res.status(500).json({ error: 'Failed to save developer metrics' });
  }
});

// Get developer metrics for a user
router.get('/developer/:userId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const metrics = await queryOne<any>(
      `SELECT * FROM developer_metrics 
       WHERE user_id = ? 
       ORDER BY recorded_date DESC 
       LIMIT 1`,
      [req.params.userId]
    );

    if (!metrics) {
      return res.status(404).json({ error: 'No metrics found for this developer' });
    }

    res.json({ metrics });
  } catch (error) {
    console.error('Get developer metrics error:', error);
    res.status(500).json({ error: 'Failed to get developer metrics' });
  }
});

// Get developer metrics history
router.get('/developer/:userId/history', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { days = '30' } = req.query;
    
    const history = await query<any[]>(
      `SELECT * FROM developer_metrics 
       WHERE user_id = ? 
       AND recorded_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       ORDER BY recorded_date DESC`,
      [req.params.userId, parseInt(days as string)]
    );

    res.json({ history });
  } catch (error) {
    console.error('Get developer history error:', error);
    res.status(500).json({ error: 'Failed to get developer history' });
  }
});

// Get all metrics for a team (primary + composite with formulas)
router.get('/team/:teamId/all', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { teamId } = req.params;

    // Get latest KPI snapshot
    const kpi = await queryOne<any>(
      `SELECT * FROM kpi_snapshots 
       WHERE team_id = ? 
       ORDER BY snapshot_date DESC LIMIT 1`,
      [teamId]
    );

    // Get technical debt summary
    const SEVERITY_WEIGHTS = { critical: 20, high: 10, medium: 5, low: 2 };
    const debtSummary = await queryOne<any>(
      `SELECT 
        SUM(CASE 
          WHEN status NOT IN ('resolved','wont_fix') THEN
            CASE severity
              WHEN 'critical' THEN 20
              WHEN 'high' THEN 10
              WHEN 'medium' THEN 5
              WHEN 'low' THEN 2
              ELSE 0
            END
          ELSE 0
        END) AS open_weight,
        SUM(CASE WHEN status NOT IN ('resolved','wont_fix') THEN 1 ELSE 0 END) AS open_items,
        COUNT(*) as total_items
      FROM technical_debt WHERE team_id = ?`,
      [teamId]
    );

    // Get developer metrics averages
    const devMetrics = await queryOne<any>(
      `SELECT 
        AVG(pr_merge_time_avg) as avg_pr_merge_time,
        AVG(code_review_time_avg) as avg_code_review_time,
        AVG(focus_time_hours) as avg_focus_time,
        AVG(meeting_time_hours) as avg_meeting_time,
        AVG(context_switches_per_day) as avg_context_switches,
        AVG(happiness_score) as avg_happiness_score,
        COUNT(DISTINCT developer_id) as developer_count
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
        (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
      FROM teams t 
      LEFT JOIN departments d ON t.department_id = d.id
      WHERE t.id = ?`,
      [teamId]
    );

    const technicalDebtScore = Math.min(100, Math.round(Number(debtSummary?.open_weight ?? 0)));

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
      { id: 'avg_pr_merge_time', name: 'Avg PR Merge Time', value: devMetrics?.avg_pr_merge_time ? Number(devMetrics.avg_pr_merge_time).toFixed(2) : null, unit: 'hours', category: 'developer', source: 'developer_metrics' },
      { id: 'avg_code_review_time', name: 'Avg Code Review Time', value: devMetrics?.avg_code_review_time ? Number(devMetrics.avg_code_review_time).toFixed(2) : null, unit: 'hours', category: 'developer', source: 'developer_metrics' },
      { id: 'avg_focus_time', name: 'Avg Focus Time', value: devMetrics?.avg_focus_time ? Number(devMetrics.avg_focus_time).toFixed(2) : null, unit: 'hours/day', category: 'developer', source: 'developer_metrics' },
      { id: 'avg_meeting_time', name: 'Avg Meeting Time', value: devMetrics?.avg_meeting_time ? Number(devMetrics.avg_meeting_time).toFixed(2) : null, unit: 'hours/day', category: 'developer', source: 'developer_metrics' },
      { id: 'avg_context_switches', name: 'Avg Context Switches', value: devMetrics?.avg_context_switches ? Number(devMetrics.avg_context_switches).toFixed(1) : null, unit: '/day', category: 'developer', source: 'developer_metrics' },
      
      // Pipeline Metrics
      { id: 'pipeline_stages_count', name: 'Pipeline Stages', value: pipelineMetrics?.total_stages, unit: 'count', category: 'pipeline', source: 'pipeline_stages' },
      { id: 'avg_stage_duration', name: 'Avg Stage Duration', value: pipelineMetrics?.avg_duration ? Number(pipelineMetrics.avg_duration).toFixed(2) : null, unit: 'min', category: 'pipeline', source: 'pipeline_stages' },
      { id: 'avg_stage_success_rate', name: 'Avg Stage Success Rate', value: pipelineMetrics?.avg_success_rate ? Number(pipelineMetrics.avg_success_rate).toFixed(2) : null, unit: '%', category: 'pipeline', source: 'pipeline_stages' },
      { id: 'pipeline_bottlenecks', name: 'Pipeline Bottlenecks', value: pipelineMetrics?.bottleneck_count, unit: 'count', category: 'pipeline', source: 'pipeline_stages' },
      
      // Technical Debt Items
      { id: 'tech_debt_open_items', name: 'Open Tech Debt Items', value: debtSummary?.open_items, unit: 'count', category: 'tech_debt', source: 'technical_debt' },
      { id: 'tech_debt_total_items', name: 'Total Tech Debt Items', value: debtSummary?.total_items, unit: 'count', category: 'tech_debt', source: 'technical_debt' },
      
      // Team Info
      { id: 'team_member_count', name: 'Team Members', value: team?.member_count, unit: 'count', category: 'team', source: 'team_members' },
      { id: 'developer_count', name: 'Active Developers (30d)', value: devMetrics?.developer_count, unit: 'count', category: 'team', source: 'developer_metrics' }
    ];

    // Composite metrics (calculated from primary metrics)
    const testCov = Number(kpi?.test_coverage) || 0;
    const defectEscape = Number(kpi?.defect_escape_rate) || 0;
    const changeFailure = Number(kpi?.change_failure_rate) || 0;
    const codeQuality = Number(kpi?.code_quality_score) || 0;
    
    const calculatedQaScore = 
      testCov * 0.30 +
      (100 - defectEscape) * 0.25 +
      (100 - changeFailure) * 0.25 +
      codeQuality * 0.20;

    // Developer happiness average
    const avgHappiness = devMetrics?.avg_happiness_score ? Number(devMetrics.avg_happiness_score) : null;
    
    // Burnout risk calculation
    const focusTime = Number(devMetrics?.avg_focus_time) || 0;
    const meetingTime = Number(devMetrics?.avg_meeting_time) || 0;
    const contextSwitches = Number(devMetrics?.avg_context_switches) || 0;
    let burnoutRisk = 'Unknown';
    if (devMetrics?.avg_focus_time) {
      if (focusTime < 3 || meetingTime > 5 || contextSwitches > 10) burnoutRisk = 'High';
      else if (focusTime < 4 || meetingTime > 4 || contextSwitches > 7) burnoutRisk = 'Moderate';
      else burnoutRisk = 'Low';
    }

    const compositeMetrics = [
      {
        id: 'qa_score',
        name: 'Overall QA Score',
        value: kpi?.qa_score ?? Math.round(calculatedQaScore),
        unit: '/100',
        category: 'composite',
        formula: 'Test_Coverage × 0.30 + (100 - Defect_Escape_Rate) × 0.25 + (100 - Change_Failure_Rate) × 0.25 + Code_Quality_Score × 0.20',
        components: { test_coverage: testCov, defect_escape_rate: defectEscape, change_failure_rate: changeFailure, code_quality_score: codeQuality },
        source: 'calculated from kpi_snapshots'
      },
      {
        id: 'technical_debt_score',
        name: 'Technical Debt Score',
        value: technicalDebtScore,
        unit: '/100',
        category: 'composite',
        formula: 'MIN(100, SUM(open_items × severity_weight)) where critical=20, high=10, medium=5, low=2',
        components: { open_items: Number(debtSummary?.open_items ?? 0), weighted_sum: Number(debtSummary?.open_weight ?? 0), severity_weights: SEVERITY_WEIGHTS },
        source: 'calculated from technical_debt'
      },
      {
        id: 'dora_performance',
        name: 'DORA Performance Level',
        value: getDORALevel(kpi),
        unit: 'level',
        category: 'composite',
        formula: 'Elite: deploy ≥7/wk + lead<1d + CFR<5% + MTTR<1h | High: deploy ≥1/wk + lead<7d + CFR<10% + MTTR<24h | Medium: deploy ≥0.25/wk + lead<30d + CFR<15% + MTTR<168h | Low: otherwise',
        components: { deployment_frequency: kpi?.deployment_frequency_per_week, lead_time_days: kpi?.lead_time_days, change_failure_rate: kpi?.change_failure_rate, mttr_hours: kpi?.mttr_hours },
        source: 'calculated from kpi_snapshots'
      },
      {
        id: 'avg_developer_happiness',
        name: 'Avg Developer Happiness',
        value: avgHappiness ? avgHappiness.toFixed(1) : null,
        unit: '/100',
        category: 'composite',
        formula: '100 - (meeting_burden × 5) - (context_switch_penalty × 3) + (focus_time_bonus × 5) where meeting_burden = max(0, meeting_hours - 2), context_switch_penalty = max(0, switches - 5), focus_bonus = max(0, focus_hours - 4)',
        components: { avg_focus_time: focusTime, avg_meeting_time: meetingTime, avg_context_switches: contextSwitches },
        source: 'calculated from developer_metrics'
      },
      {
        id: 'team_burnout_risk',
        name: 'Team Burnout Risk',
        value: burnoutRisk,
        unit: 'level',
        category: 'composite',
        formula: 'High: focus<3h OR meetings>5h OR switches>10 | Moderate: focus<4h OR meetings>4h OR switches>7 | Low: otherwise',
        components: { avg_focus_time: focusTime, avg_meeting_time: meetingTime, avg_context_switches: contextSwitches },
        source: 'calculated from developer_metrics'
      },
      {
        id: 'pipeline_health',
        name: 'Pipeline Health Score',
        value: pipelineMetrics?.avg_success_rate ? Math.round(Number(pipelineMetrics.avg_success_rate)) : null,
        unit: '/100',
        category: 'composite',
        formula: 'AVG(success_rate) across all pipeline stages',
        components: { total_stages: pipelineMetrics?.total_stages, avg_success_rate: pipelineMetrics?.avg_success_rate, bottleneck_count: pipelineMetrics?.bottleneck_count },
        source: 'calculated from pipeline_stages'
      },
      {
        id: 'tech_debt_ratio',
        name: 'Tech Debt Resolution Rate',
        value: debtSummary?.total_items > 0 ? Math.round(((Number(debtSummary.total_items) - Number(debtSummary.open_items)) / Number(debtSummary.total_items)) * 100) : null,
        unit: '%',
        category: 'composite',
        formula: '(total_items - open_items) / total_items × 100',
        components: { total_items: debtSummary?.total_items, open_items: debtSummary?.open_items, resolved_items: Number(debtSummary?.total_items ?? 0) - Number(debtSummary?.open_items ?? 0) },
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
    const { impactConfigs, historicalConfigs } = req.body;

    // Validate input
    if (!Array.isArray(impactConfigs) || !Array.isArray(historicalConfigs)) {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    // Save impact configurations
    for (const config of impactConfigs) {
      await query(
        `INSERT INTO business_impact_config
         (id, team_id, metric_name, quality_score, revenue_impact, customer_satisfaction,
          feature_adoption_rate, correlation_strength, manually_edited)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE
           quality_score = VALUES(quality_score),
           revenue_impact = VALUES(revenue_impact),
           customer_satisfaction = VALUES(customer_satisfaction),
           feature_adoption_rate = VALUES(feature_adoption_rate),
           correlation_strength = VALUES(correlation_strength),
           manually_edited = TRUE,
           updated_at = CURRENT_TIMESTAMP`,
        [
          require('crypto').randomUUID(),
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
         ON DUPLICATE KEY UPDATE
           quality_score = VALUES(quality_score),
           revenue_impact = VALUES(revenue_impact),
           customer_satisfaction = VALUES(customer_satisfaction),
           churn_rate = VALUES(churn_rate),
           manually_edited = TRUE,
           updated_at = CURRENT_TIMESTAMP`,
        [
          require('crypto').randomUUID(),
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
    console.error('Save business impact config error:', error);
    res.status(500).json({ error: 'Failed to save business impact configuration' });
  }
});

// Helper function to determine DORA performance level
function getDORALevel(kpi: any): string {
  if (!kpi) return 'Unknown';

  const deployFreq = Number(kpi.deployment_frequency_per_week) || 0;
  const leadTime = Number(kpi.lead_time_days) || 999;
  const changeFailure = Number(kpi.change_failure_rate) || 100;
  const mttr = Number(kpi.mttr_hours) || 999;

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
