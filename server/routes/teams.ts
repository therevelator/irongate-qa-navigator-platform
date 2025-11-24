import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

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
             CONCAT(u.first_name, ' ', u.last_name) as team_lead_name,
             (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count,
             k.qa_score as qaScore,
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
             k.snapshot_date
      FROM teams t
      JOIN departments d ON t.department_id = d.id
      JOIN companies c ON t.company_id = c.id
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

    // Role-based filtering
    if (userRole === 'team_lead') {
      // Team leads only see their own team
      sql += ' AND t.id = ?';
      params.push(userPrimaryTeamId);
    } else if (userRole === 'qa_manager') {
      // QA managers see teams in their department
      sql += ' AND t.department_id = (SELECT department_id FROM users WHERE id = ?)';
      params.push(userId);
    }
    // super_admin sees all teams (no additional filter)

    if (departmentId) {
      sql += ' AND t.department_id = ?';
      params.push(departmentId);
    }

    sql += ' ORDER BY t.name';

    const teams = await query<any[]>(sql, params);
    
    // Transform teams to match frontend format
    const transformedTeams = teams.map(team => ({
      id: team.id,
      name: team.name,
      department: team.department,
      platform: team.platform,
      description: team.description,
      qaScore: team.qaScore || 0,
      status: team.status || 'unknown',
      memberCount: team.member_count || 0,
      teamLead: team.team_lead_name,
      metrics: [
        {
          id: 'test-coverage',
          name: 'Test Coverage',
          value: team.test_coverage || 0,
          unit: '%',
          trend: 'up'
        },
        {
          id: 'defect-density',
          name: 'Defect Density',
          value: team.defect_density || 0,
          unit: '',
          trend: 'down'
        },
        {
          id: 'automation-coverage',
          name: 'Automation',
          value: team.automation_coverage || 0,
          unit: '%',
          trend: 'up'
        },
        {
          id: 'deployment-frequency',
          name: 'Deployments/Week',
          value: team.deployment_frequency_per_week || 0,
          unit: '',
          trend: 'up'
        }
      ],
      technicalDebtScore: Math.round((team.code_quality_score || 80) * 0.3 + Math.random() * 20),
      taskSizingAccuracy: 0.85 + Math.random() * 0.3,
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
      }
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
              CONCAT(u.first_name, ' ', u.last_name) as team_lead_name
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

    // Get team members from team_members table
    const teamMembers = await query<any[]>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.avatar_url,
              tm.role as team_role, tm.joined_at
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = ?`,
      [req.params.id]
    );

    // Also get users who have this as their primary team
    const primaryTeamMembers = await query<any[]>(
      `SELECT id, email, first_name, last_name, role, avatar_url,
              'member' as team_role, created_at as joined_at
       FROM users
       WHERE primary_team_id = ?`,
      [req.params.id]
    );

    // Combine both lists and remove duplicates
    const memberMap = new Map();
    
    // Add team_members first (they have explicit roles)
    teamMembers.forEach(member => {
      memberMap.set(member.id, member);
    });
    
    // Add primary team members (if not already in team_members)
    primaryTeamMembers.forEach(member => {
      if (!memberMap.has(member.id)) {
        memberMap.set(member.id, member);
      }
    });

    team.members = Array.from(memberMap.values());

    res.json({ team });
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ error: 'Failed to get team' });
  }
});

// Create team
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { name, description, departmentId, platform, leadId } = req.body;

    if (!name || !departmentId) {
      return res.status(400).json({ error: 'Name and department required' });
    }

    const [result] = await query<any>(
      `INSERT INTO teams (company_id, department_id, name, description, platform, lead_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.companyId, departmentId, name, description, platform, leadId]
    );

    const team = await queryOne<any>(
      'SELECT * FROM teams WHERE id = ?',
      [result.insertId]
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
    const { name, description, platform, leadId, isActive } = req.body;

    await query(
      `UPDATE teams 
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           platform = COALESCE(?, platform),
           lead_id = COALESCE(?, lead_id),
           is_active = COALESCE(?, is_active)
       WHERE id = ? AND company_id = ?`,
      [name, description, platform, leadId, isActive, req.params.id, req.companyId]
    );

    const team = await queryOne<any>(
      'SELECT * FROM teams WHERE id = ?',
      [req.params.id]
    );

    res.json({ team });
  } catch (error) {
    console.error('Update team error:', error);
    res.status(500).json({ error: 'Failed to update team' });
  }
});

export default router;
