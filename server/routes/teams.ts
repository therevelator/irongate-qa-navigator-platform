import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get all teams (with filters)
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { departmentId, companyId } = req.query;
    const userRole = req.user?.role;
    const userId = req.user?.id;
    const userPrimaryTeamId = req.user?.primaryTeamId;

    let sql = `
      SELECT t.*, 
             d.name as department_name,
             c.name as company_name,
             CONCAT(u.first_name, ' ', u.last_name) as team_lead_name,
             (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
      FROM teams t
      JOIN departments d ON t.department_id = d.id
      JOIN companies c ON t.company_id = c.id
      LEFT JOIN users u ON t.lead_id = u.id
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
    res.json({ teams });
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

    // Get team members
    const members = await query<any[]>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.avatar_url,
              tm.role as team_role, tm.joined_at
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = ?`,
      [req.params.id]
    );

    team.members = members;

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
