import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get all departments
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const departments = await query<any[]>(
      `SELECT d.*, 
              CONCAT(u.first_name, ' ', u.last_name) as manager_name,
              (SELECT COUNT(*) FROM teams WHERE department_id = d.id AND is_active = true) as team_count
       FROM departments d
       LEFT JOIN users u ON d.manager_id = u.id
       WHERE d.company_id = ? AND d.is_active = true
       ORDER BY d.name`,
      [req.companyId]
    );

    res.json({ departments });
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({ error: 'Failed to get departments' });
  }
});

// Get department by ID
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const department = await queryOne<any>(
      `SELECT d.*, 
              CONCAT(u.first_name, ' ', u.last_name) as manager_name
       FROM departments d
       LEFT JOIN users u ON d.manager_id = u.id
       WHERE d.id = ? AND d.company_id = ?`,
      [req.params.id, req.companyId]
    );

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    // Get teams in this department
    const teams = await query<any[]>(
      `SELECT t.*, 
              CONCAT(u.first_name, ' ', u.last_name) as team_lead_name,
              (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
       FROM teams t
       LEFT JOIN users u ON t.lead_id = u.id
       WHERE t.department_id = ? AND t.is_active = true
       ORDER BY t.name`,
      [req.params.id]
    );

    department.teams = teams;

    res.json({ department });
  } catch (error) {
    console.error('Get department error:', error);
    res.status(500).json({ error: 'Failed to get department' });
  }
});

export default router;
