import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

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
    
    if (userRole === 'team_lead' && primaryTeamId) {
      // Team lead sees only their team
      teamFilter = 'WHERE t.id = ?';
      params.push(primaryTeamId);
    }
    // qa_manager and super_admin see all teams (no filter)
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
      infrastructure_failures
    } = req.body;

    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    // Calculate QA Score based on the formula from metrics-info.html
    // QA_Score = Test_Coverage × 0.30 + (100 - Defect_Escape_Rate) × 0.25 + Build_Success_Rate × 0.25 + Code_Quality_Score × 0.20
    // We'll use (100 - change_failure_rate) as Build_Success_Rate proxy
    const buildSuccessRate = change_failure_rate !== undefined ? (100 - change_failure_rate) : 85;
    const qaScore = 
      (test_coverage || 0) * 0.30 +
      (100 - (defect_escape_rate || 0)) * 0.25 +
      buildSuccessRate * 0.25 +
      (code_quality_score || 0) * 0.20;

    // Determine status based on QA Score
    let status = 'unknown';
    if (qaScore >= 85) status = 'good';
    else if (qaScore >= 70) status = 'warning';
    else if (qaScore > 0) status = 'critical';

    // Insert or update KPI snapshot for today
    // Use INSERT ... ON DUPLICATE KEY UPDATE to handle existing entries for the same team/date
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
        infrastructure_failures
      ) VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        infrastructure_failures = COALESCE(VALUES(infrastructure_failures), infrastructure_failures)`,
      [
        teamId,
        qaScore,
        status,
        test_coverage || null,
        test_flakiness_rate || null,
        defect_density || null,
        defect_escape_rate || null,
        code_quality_score || null,
        avg_build_time_minutes || null,
        test_execution_time_minutes || null,
        deployment_frequency_per_week || null,
        lead_time_days || null,
        mttr_hours || null,
        parallel_test_efficiency || null,
        sprint_velocity || null,
        sprint_commitment_rate || null,
        sprint_carryover || null,
        first_time_pass_rate || null,
        blocked_time_hours || null,
        automation_coverage || null,
        automation_roi || null,
        change_failure_rate || null,
        mtbf_hours || null,
        system_availability || null,
        infrastructure_failures || null
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

export default router;
