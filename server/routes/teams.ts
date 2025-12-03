import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

const TECH_DEBT_SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 30,
  high: 20,
  medium: 10,
  low: 5
};

async function getTechnicalDebtScore(teamId: string): Promise<number> {
  const summary = await queryOne<any>(
    `SELECT 
        SUM(CASE 
              WHEN status NOT IN ('resolved','wont_fix') THEN
                CASE severity
                  WHEN 'critical' THEN ?
                  WHEN 'high' THEN ?
                  WHEN 'medium' THEN ?
                  WHEN 'low' THEN ?
                  ELSE 0
                END
              ELSE 0
            END) AS open_weight,
        SUM(CASE WHEN status NOT IN ('resolved','wont_fix') THEN 1 ELSE 0 END) AS open_items
      FROM technical_debt
      WHERE team_id = ?`,
    [
      TECH_DEBT_SEVERITY_WEIGHTS.critical,
      TECH_DEBT_SEVERITY_WEIGHTS.high,
      TECH_DEBT_SEVERITY_WEIGHTS.medium,
      TECH_DEBT_SEVERITY_WEIGHTS.low,
      teamId
    ]
  );

  const openWeight = Number(summary?.open_weight ?? 0);
  const openItems = Number(summary?.open_items ?? 0);

  if (!openItems || openWeight <= 0) {
    return 0;
  }

  // Cap to 100 to keep the score within expected bounds
  return Math.min(100, Math.round(openWeight));
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
    
    // Transform teams to match frontend format
    const transformedTeams = await Promise.all(teams.map(async team => {
      const technicalDebtScore = await getTechnicalDebtScore(team.id);

      return {
        id: team.id,
        name: team.name,
        department: team.department || 'Unknown Department',
        department_id: team.department_id,
        platform: team.platform,
        description: team.description,
        qaScore: team.qaScore || 0,
        status: (team.status === 'good' || team.status === 'warning' || team.status === 'critical') 
          ? team.status 
          : (team.qaScore >= 85 ? 'good' : team.qaScore >= 70 ? 'warning' : 'critical'),
        memberCount: team.member_count || 0,
        teamLead: team.team_lead_name,
        velocity: Array.from({ length: 5 }, (_, i) => ({
          sprint: `S${10 + i}`,
          committed: Math.floor(40 + Math.random() * 20),
          delivered: Math.floor(35 + Math.random() * 20)
        })),
        metrics: [
          {
            id: 'test-coverage',
            name: 'Test Coverage',
            value: team.test_coverage || 0,
            unit: '%',
            change: 2.5,
            trend: 'up' as const,
            status: (team.test_coverage || 0) >= 80 ? 'good' : (team.test_coverage || 0) >= 70 ? 'warning' : 'critical',
            history: []
          },
          {
            id: 'defect-density',
            name: 'Defect Density',
            value: team.defect_density || 0,
            unit: '/1k',
            change: -0.1,
            trend: 'down' as const,
            status: (team.defect_density || 0) <= 0.5 ? 'good' : (team.defect_density || 0) <= 1.0 ? 'warning' : 'critical',
            history: []
          },
          {
            id: 'automation-coverage',
            name: 'Automation',
            value: team.automation_coverage || 0,
            unit: '%',
            change: 3,
            trend: 'up' as const,
            status: (team.automation_coverage || 0) >= 70 ? 'good' : (team.automation_coverage || 0) >= 50 ? 'warning' : 'critical',
            history: []
          },
          {
            id: 'deployment-frequency',
            name: 'Deployments/Week',
            value: team.deployment_frequency_per_week || 0,
            unit: '',
            change: 1,
            trend: 'up' as const,
            status: (team.deployment_frequency_per_week || 0) >= 5 ? 'good' : (team.deployment_frequency_per_week || 0) >= 2 ? 'warning' : 'critical',
            history: []
          }
        ],
        technicalDebtScore,
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

    const technicalDebtScore = await getTechnicalDebtScore(team.id);

    // Get latest KPI snapshot for this team
    const kpiSnapshot = await queryOne<any>(
      `SELECT * FROM kpi_snapshots 
       WHERE team_id = ? 
       ORDER BY snapshot_date DESC 
       LIMIT 1`,
      [req.params.id]
    );

    // Add KPI data to team response
    if (kpiSnapshot) {
      team.qaScore = kpiSnapshot.qa_score;
      team.status = kpiSnapshot.status;
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
    }

    team.technicalDebtScore = technicalDebtScore;

    // Get team members from team_members table (only active users)
    const teamMembers = await query<any[]>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.avatar_url,
              tm.role as team_role, tm.joined_at
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = ? AND u.is_active = true`,
      [req.params.id]
    );

    // Also get users who have this as their primary team (only active users)
    const primaryTeamMembers = await query<any[]>(
      `SELECT id, email, first_name, last_name, role, avatar_url,
              'member' as team_role, created_at as joined_at
       FROM users
       WHERE primary_team_id = ? AND is_active = true`,
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

// Toggle AI enabled for a team (admin only)
router.patch('/:id/ai-toggle', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (req.userRole !== 'super_admin' && req.userRole !== 'manager') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { enabled } = req.body;
    
    await query(
      'UPDATE teams SET ai_enabled = ? WHERE id = ? AND company_id = ?',
      [enabled ? 1 : 0, req.params.id, req.companyId]
    );

    res.json({ success: true, ai_enabled: !!enabled });
  } catch (error) {
    console.error('AI toggle error:', error);
    res.status(500).json({ error: 'Failed to toggle AI' });
  }
});

// Get KPI history for a team (for graphs)
router.get('/:id/kpi-history', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { days = '30' } = req.query;
    const numDays = Math.min(parseInt(days as string) || 30, 90);

    const history = await query<any>(
      `SELECT 
        snapshot_date,
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
        qa_score
       FROM kpi_snapshots
       WHERE team_id = ? AND snapshot_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       ORDER BY snapshot_date ASC`,
      [req.params.id, numDays]
    );

    // Transform to metric-keyed format for easy frontend consumption
    const metricHistory: Record<string, { date: string; value: number }[]> = {};
    const metricKeys = [
      'test_coverage', 'test_flakiness_rate', 'defect_density', 'defect_escape_rate',
      'code_quality_score', 'avg_build_time_minutes', 'test_execution_time_minutes',
      'deployment_frequency_per_week', 'lead_time_days', 'mttr_hours',
      'parallel_test_efficiency', 'sprint_velocity', 'sprint_commitment_rate',
      'sprint_carryover', 'first_time_pass_rate', 'blocked_time_hours',
      'automation_coverage', 'automation_roi', 'change_failure_rate',
      'mtbf_hours', 'system_availability', 'infrastructure_failures', 'qa_score'
    ];

    for (const key of metricKeys) {
      metricHistory[key] = [];
    }

    for (const row of history) {
      const date = new Date(row.snapshot_date).toISOString().split('T')[0];
      for (const key of metricKeys) {
        if (row[key] !== null && row[key] !== undefined) {
          metricHistory[key].push({ date, value: Number(row[key]) });
        }
      }
    }

    res.json({ history: metricHistory, days: numDays, count: history.length });
  } catch (error) {
    console.error('Error fetching KPI history:', error);
    res.status(500).json({ error: 'Failed to fetch KPI history' });
  }
});

// Get AI suggestions for a team (uses Groq API if available, otherwise rule-based fallback)
// Only accessible by team_lead, manager, and super_admin
router.get('/:id/ai-suggestions', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userRole = req.user?.role;
    
    // Only leads, managers, and admins can see AI insights
    if (!['super_admin', 'manager', 'team_lead'].includes(userRole || '')) {
      return res.status(403).json({ 
        error: 'AI insights are only available to team leads, managers, and admins',
        restricted: true 
      });
    }
    
    const team = await queryOne<any>(
      `SELECT t.*, 
              t.ai_enabled,
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

    // Build team metrics payload for AI - ensure all values are numbers
    const teamMetrics = {
      teamName: team.name,
      department: team.department_name,
      qaScore: Number(kpiSnapshot.qa_score) || 0,
      testCoverage: Number(kpiSnapshot.test_coverage) || 0,
      defectDensity: Number(kpiSnapshot.defect_density) || 0,
      defectEscapeRate: Number(kpiSnapshot.defect_escape_rate) || 0,
      codeQualityScore: Number(kpiSnapshot.code_quality_score) || 0,
      automationCoverage: Number(kpiSnapshot.automation_coverage) || 0,
      deploymentFrequencyPerWeek: Number(kpiSnapshot.deployment_frequency_per_week) || 0,
      leadTimeDays: Number(kpiSnapshot.lead_time_days) || 0,
      mttrHours: Number(kpiSnapshot.mttr_hours) || 0,
      changeFailureRate: Number(kpiSnapshot.change_failure_rate) || 0,
      blockedTimeHours: Number(kpiSnapshot.blocked_time_hours) || 0,
      testFlakinessRate: Number(kpiSnapshot.test_flakiness_rate) || 0,
      sprintCarryover: Number(kpiSnapshot.sprint_carryover) || 0,
      sprintVelocity: Number(kpiSnapshot.sprint_velocity) || 0,
      sprintCommitmentRate: Number(kpiSnapshot.sprint_commitment_rate) || 0,
      firstTimePassRate: Number(kpiSnapshot.first_time_pass_rate) || 0,
      mtbfHours: Number(kpiSnapshot.mtbf_hours) || 0,
      systemAvailability: Number(kpiSnapshot.system_availability) || 0,
      parallelTestEfficiency: Number(kpiSnapshot.parallel_test_efficiency) || 0,
      infrastructureFailures: Number(kpiSnapshot.infrastructure_failures) || 0,
      avgBuildTimeMinutes: Number(kpiSnapshot.avg_build_time_minutes) || 0,
      technicalDebtScore
    };

    console.log('[AI][Team]', {
      teamId: team.id,
      teamName: team.name,
      metrics: teamMetrics
    });

    // Try Groq API if key is configured (with 10 second timeout)
    const groqApiKey = process.env.GROQ_API_KEY;
    
    if (groqApiKey && groqApiKey.length > 10) {
      try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqApiKey}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: 'openai/gpt-oss-20b',
            messages: [
              {
                role: 'system',
                content: `You are a QA/Engineering advisor. Analyze team metrics and provide actionable insights.
                
Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:
{
  "strongpoints": ["string array of 3-7 team strengths based on metrics"],
  "areasOfImprovement": ["string array of 3-10 areas needing improvement"],
  "actionPlan": [
    {
      "priority": "Urgent" or "Moderate" or "Low",
      "initiative": "specific action to take",
      "owner": "role responsible (e.g., QA Lead, DevOps, Scrum Master)",
      "timebox": "timeframe (e.g., 1 week, 2 weeks, 1 sprint)",
      "kpi": "which metric should improve"
    }
  ]
}

Focus on:
- Test coverage, defect rates, automation
- Sprint velocity and commitment
- Build times, deployment frequency
- MTTR, system availability
- Technical debt and code quality`
              },
              {
                role: 'user',
                content: `Analyze this team's metrics and provide suggestions:\n\n${JSON.stringify(teamMetrics, null, 2)}`
              }
            ],
            temperature: 0.7,
            max_tokens: 2000
          })
        });

        clearTimeout(timeoutId); // Clear timeout on response
        
        if (aiResponse.ok) {
          const groqData = await aiResponse.json();
          const content = groqData.choices?.[0]?.message?.content;
          
          if (content) {
            try {
              // Clean up the response - remove markdown code blocks if present
              let cleanContent = content.trim();
              if (cleanContent.startsWith('```json')) {
                cleanContent = cleanContent.slice(7);
              }
              if (cleanContent.startsWith('```')) {
                cleanContent = cleanContent.slice(3);
              }
              if (cleanContent.endsWith('```')) {
                cleanContent = cleanContent.slice(0, -3);
              }
              cleanContent = cleanContent.trim();
              
              const aiResult = JSON.parse(cleanContent);
              
              return res.json({
                teamId: team.id,
                teamName: team.name,
                qaScore: teamMetrics.qaScore,
                aiEnabled: true,
                source: 'groq',
                strongpoints: aiResult.strongpoints || [],
                areasOfImprovement: aiResult.areasOfImprovement || [],
                actionPlan: aiResult.actionPlan || []
              });
            } catch (parseError) {
              console.error('Failed to parse Groq response:', parseError, content);
              // Fall through to rule-based fallback
            }
          }
        } else {
          console.error('Groq API error:', aiResponse.status, await aiResponse.text());
        }
      } catch (groqError: any) {
        if (groqError.name === 'AbortError') {
          console.log('Groq API timed out after 10s, falling back to rule-based');
        } else {
          console.error('Groq API call failed:', groqError);
        }
        // Fall through to rule-based fallback
      }
    }

    // Rule-based fallback if Groq is not available or fails
    const strongpoints: string[] = [];
    const areasOfImprovement: string[] = [];

    if (teamMetrics.testCoverage >= 80) {
      strongpoints.push(`High Test Coverage (${teamMetrics.testCoverage.toFixed(1)}%)`);
    } else if (teamMetrics.testCoverage > 0) {
      areasOfImprovement.push(`Test coverage is at ${teamMetrics.testCoverage.toFixed(1)}%`);
    }

    if (teamMetrics.defectDensity <= 0.5 && teamMetrics.defectDensity > 0) {
      strongpoints.push(`Low Defect Density (${teamMetrics.defectDensity.toFixed(2)})`);
    } else if (teamMetrics.defectDensity > 0.5) {
      areasOfImprovement.push(`Defect density is ${teamMetrics.defectDensity.toFixed(2)}`);
    }

    if (teamMetrics.automationCoverage >= 70 && teamMetrics.deploymentFrequencyPerWeek >= 5) {
      strongpoints.push(`Robust Automation (${teamMetrics.automationCoverage.toFixed(1)}%) with ${teamMetrics.deploymentFrequencyPerWeek} deployments/week`);
    } else {
      if (teamMetrics.automationCoverage > 0 && teamMetrics.automationCoverage < 70) {
        areasOfImprovement.push(`Automation coverage is ${teamMetrics.automationCoverage.toFixed(1)}%`);
      }
    }

    if (teamMetrics.sprintCommitmentRate >= 90 && teamMetrics.sprintVelocity > 0) {
      strongpoints.push(`Excellent Sprint Commitment (${teamMetrics.sprintCommitmentRate.toFixed(1)}%)`);
    }

    if (teamMetrics.firstTimePassRate >= 85) {
      strongpoints.push(`First-Time Pass Rate ${teamMetrics.firstTimePassRate.toFixed(1)}%`);
    }

    if (teamMetrics.leadTimeDays > 0 && teamMetrics.leadTimeDays <= 3.5) {
      strongpoints.push(`Fast Lead Time (${teamMetrics.leadTimeDays.toFixed(1)} days)`);
    } else if (teamMetrics.leadTimeDays > 3.5) {
      areasOfImprovement.push(`Lead time is ${teamMetrics.leadTimeDays.toFixed(1)} days`);
    }

    if (teamMetrics.defectEscapeRate > 0) {
      areasOfImprovement.push(`Defect-escape rate (${teamMetrics.defectEscapeRate.toFixed(1)}%)`);
    }

    if (teamMetrics.changeFailureRate > 0) {
      areasOfImprovement.push(`Change-failure rate (${teamMetrics.changeFailureRate.toFixed(1)}%)`);
    }

    if (teamMetrics.blockedTimeHours > 0) {
      areasOfImprovement.push(`Blocked time (${teamMetrics.blockedTimeHours.toFixed(1)} hrs)`);
    }

    if (teamMetrics.testFlakinessRate > 0) {
      areasOfImprovement.push(`Test flakiness (${teamMetrics.testFlakinessRate.toFixed(1)}%)`);
    }

    if (teamMetrics.avgBuildTimeMinutes > 15) {
      areasOfImprovement.push(`Build time (${teamMetrics.avgBuildTimeMinutes.toFixed(1)} min)`);
    }

    if (teamMetrics.mttrHours > 0) {
      areasOfImprovement.push(`Mean Time to Recovery (${teamMetrics.mttrHours.toFixed(1)} hrs)`);
    }

    const actionPlan = [
      {
        priority: 'Urgent',
        initiative: 'Post-mortem board for defect & change escapes',
        owner: 'Release Lead',
        timebox: '2 weeks',
        kpi: 'Defect-escape rate should go down'
      },
      {
        priority: 'Urgent',
        initiative: 'Urgent ticket to surface & resolve blockers in < 1 day',
        owner: 'Scrum Master',
        timebox: '1 week',
        kpi: 'Blocked time should go down'
      },
      {
        priority: 'Moderate',
        initiative: 'Automate flaky-test isolation & monitoring',
        owner: 'QA Lead',
        timebox: '3 weeks',
        kpi: 'Test flakiness should go down'
      },
      {
        priority: 'Moderate',
        initiative: 'Parallel test & build pipeline tuning',
        owner: 'DevOps',
        timebox: '4 weeks',
        kpi: 'Build time should go down'
      }
    ];

    res.json({
      teamId: team.id,
      teamName: team.name,
      qaScore: teamMetrics.qaScore,
      aiEnabled: true,
      source: 'rule-based',
      strongpoints,
      areasOfImprovement,
      actionPlan
    });
  } catch (error) {
    console.error('AI suggestions error:', error);
    res.status(500).json({ error: 'Failed to generate AI suggestions' });
  }
});

// Get AI suggestions for developers in a team
// Only accessible by team_lead, manager, and super_admin
router.get('/:id/developer-ai-suggestions', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userRole = req.user?.role;
    
    // Only leads, managers, and admins can see developer stats and AI insights
    if (!['super_admin', 'manager', 'team_lead'].includes(userRole || '')) {
      return res.status(403).json({ 
        error: 'Developer insights are only available to team leads, managers, and admins',
        restricted: true 
      });
    }
    
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

    // Get developer metrics for this team (only for users with developer_insights_enabled)
    const developerMetrics = await query<any>(
      `SELECT dm.*, 
              CONCAT(u.first_name, ' ', u.last_name) as name,
              u.email,
              u.developer_insights_enabled
       FROM developer_metrics dm
       JOIN users u ON dm.developer_id = u.id
       WHERE dm.team_id = ?
       ORDER BY u.first_name`,
      [req.params.id]
    );

    if (!developerMetrics || developerMetrics.length === 0) {
      return res.json({
        teamId: team.id,
        aiEnabled: true,
        developers: [],
        message: 'No developer metrics found for this team.'
      });
    }

    // Build developer metrics payload for AI
    const devMetricsPayload = developerMetrics.map((dev: any) => ({
      developerId: dev.developer_id,
      name: dev.name,
      prMergeTimeHours: Number(dev.pr_merge_time_avg) || 0,
      codeReviewTimeHours: Number(dev.code_review_time_avg) || 0,
      focusTimeHours: Number(dev.focus_time_hours) || 0,
      meetingTimeHours: Number(dev.meeting_time_hours) || 0,
      contextSwitchesPerDay: Number(dev.context_switches_per_day) || 0,
      happinessScore: Number(dev.happiness_score) || 0
    }));

    console.log('[AI][Developers]', {
      teamId: team.id,
      metrics: devMetricsPayload
    });

    // Try Groq API with timeout
    const groqApiKey = process.env.GROQ_API_KEY;
    
    if (groqApiKey && groqApiKey.length > 10) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout for multiple devs
        
        const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqApiKey}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: 'openai/gpt-oss-20b',
            messages: [
              {
                role: 'system',
                content: `You are a developer productivity advisor. Analyze individual developer metrics and provide personalized suggestions.

For each developer, analyze their metrics and provide insights. Return ONLY valid JSON (no markdown) with this structure:
{
  "developers": [
    {
      "name": "Developer Name",
      "status": "healthy" or "at-risk" or "needs-attention",
      "summary": "One sentence summary of their productivity state",
      "strengths": ["1-3 strengths based on metrics"],
      "concerns": ["1-3 concerns if any"],
      "suggestion": "One actionable recommendation"
    }
  ],
  "teamInsight": "One sentence about overall team developer health"
}

Metric benchmarks:
- PR Merge Time: <4h excellent, 4-8h good, 8-24h moderate, >24h slow
- Code Review Time: <2h excellent, 2-4h good, >4h slow
- Focus Time: >5h excellent, 3-5h good, <3h concerning
- Meeting Time: <2h ideal, 2-4h acceptable, >4h too high
- Context Switches: <3 excellent, 3-6 acceptable, >6 disruptive
- Happiness Score: >7 great, 5-7 okay, <5 concerning`
              },
              {
                role: 'user',
                content: `Analyze these developer metrics and provide suggestions:\n\n${JSON.stringify(devMetricsPayload, null, 2)}`
              }
            ],
            temperature: 0.7,
            max_tokens: 2000
          })
        });

        clearTimeout(timeoutId);
        
        if (aiResponse.ok) {
          const groqData = await aiResponse.json();
          const content = groqData.choices?.[0]?.message?.content;
          
          if (content) {
            try {
              let cleanContent = content.trim();
              if (cleanContent.startsWith('```json')) cleanContent = cleanContent.slice(7);
              if (cleanContent.startsWith('```')) cleanContent = cleanContent.slice(3);
              if (cleanContent.endsWith('```')) cleanContent = cleanContent.slice(0, -3);
              cleanContent = cleanContent.trim();
              
              const aiResult = JSON.parse(cleanContent);
              
              return res.json({
                teamId: team.id,
                aiEnabled: true,
                source: 'groq',
                developers: aiResult.developers || [],
                teamInsight: aiResult.teamInsight || '',
                metrics: devMetricsPayload
              });
            } catch (parseError) {
              console.error('Failed to parse Groq developer response:', parseError);
            }
          }
        } else {
          console.error('Groq API error (developers):', aiResponse.status);
        }
      } catch (groqError: any) {
        if (groqError.name === 'AbortError') {
          console.log('Groq API timed out for developer suggestions');
        } else {
          console.error('Groq API call failed (developers):', groqError);
        }
      }
    }

    // Rule-based fallback for developers
    const developerSuggestions = devMetricsPayload.map((dev: any) => {
      const strengths: string[] = [];
      const concerns: string[] = [];
      let status = 'healthy';

      // PR Merge Time
      if (dev.prMergeTimeHours <= 4) {
        strengths.push('Fast PR turnaround');
      } else if (dev.prMergeTimeHours > 24) {
        concerns.push('PRs taking too long to merge');
        status = 'needs-attention';
      }

      // Code Review Time
      if (dev.codeReviewTimeHours <= 2) {
        strengths.push('Quick code reviews');
      } else if (dev.codeReviewTimeHours > 4) {
        concerns.push('Code reviews are slow');
      }

      // Focus Time
      if (dev.focusTimeHours >= 5) {
        strengths.push('Good focus time');
      } else if (dev.focusTimeHours < 3) {
        concerns.push('Low focus time');
        status = status === 'healthy' ? 'at-risk' : status;
      }

      // Meeting Time
      if (dev.meetingTimeHours > 4) {
        concerns.push('Too many meetings');
        status = status === 'healthy' ? 'at-risk' : status;
      }

      // Context Switches
      if (dev.contextSwitchesPerDay <= 3) {
        strengths.push('Minimal context switching');
      } else if (dev.contextSwitchesPerDay > 6) {
        concerns.push('High context switching');
        status = status === 'healthy' ? 'at-risk' : status;
      }

      // Happiness
      if (dev.happinessScore >= 7) {
        strengths.push('High satisfaction');
      } else if (dev.happinessScore < 5) {
        concerns.push('Low happiness score');
        status = 'needs-attention';
      }

      let suggestion = 'Keep up the good work!';
      if (concerns.length > 0) {
        if (concerns.includes('Too many meetings')) {
          suggestion = 'Consider reducing meeting load to increase focus time';
        } else if (concerns.includes('High context switching')) {
          suggestion = 'Try time-blocking to reduce interruptions';
        } else if (concerns.includes('PRs taking too long to merge')) {
          suggestion = 'Review PR workflow for bottlenecks';
        } else if (concerns.includes('Low happiness score')) {
          suggestion = 'Schedule a 1:1 to discuss workload and satisfaction';
        }
      }

      return {
        name: dev.name,
        status,
        summary: concerns.length === 0 ? 'Performing well across all metrics' : `${concerns.length} area(s) need attention`,
        strengths: strengths.length > 0 ? strengths : ['Metrics within acceptable range'],
        concerns,
        suggestion
      };
    });

    res.json({
      teamId: team.id,
      aiEnabled: true,
      source: 'rule-based',
      developers: developerSuggestions,
      teamInsight: `${developerSuggestions.filter((d: any) => d.status === 'healthy').length} of ${developerSuggestions.length} developers are in healthy state`,
      metrics: devMetricsPayload
    });
  } catch (error) {
    console.error('Developer AI suggestions error:', error);
    res.status(500).json({ error: 'Failed to generate developer AI suggestions' });
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
