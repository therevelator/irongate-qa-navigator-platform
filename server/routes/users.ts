import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest, requireRole } from '../middleware/auth';

const router = express.Router();

// Get all users (filtered by company)
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { departmentId, teamId, role } = req.query;

    let sql = `
      SELECT u.id, u.email, u.first_name, u.last_name, u.role,
             u.company_id, u.department_id, u.primary_team_id,
             u.avatar_url, u.created_at, u.last_login, u.is_active,
             d.name as department_name,
             t.name as primary_team_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      LEFT JOIN teams t ON u.primary_team_id = t.id
      WHERE u.company_id = ? AND u.is_active = true
    `;

    const params: any[] = [req.companyId];

    if (departmentId) {
      sql += ' AND u.department_id = ?';
      params.push(departmentId);
    }

    if (teamId) {
      sql += ' AND u.primary_team_id = ?';
      params.push(teamId);
    }

    if (role) {
      sql += ' AND u.role = ?';
      params.push(role);
    }

    sql += ' ORDER BY u.last_name, u.first_name';

    const users = await query<any[]>(sql, params);
    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Get user by ID
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await queryOne<any>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role,
              u.company_id, u.department_id, u.primary_team_id,
              u.avatar_url, u.phone, u.timezone,
              u.created_at, u.last_login, u.is_active, u.email_verified,
              d.name as department_name,
              t.name as primary_team_name
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN teams t ON u.primary_team_id = t.id
       WHERE u.id = ? AND u.company_id = ?`,
      [req.params.id, req.companyId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get assigned teams
    const teams = await query<any[]>(
      `SELECT t.id, t.name, tm.role as team_role, tm.joined_at
       FROM team_members tm
       JOIN teams t ON tm.team_id = t.id
       WHERE tm.user_id = ?`,
      [req.params.id]
    );

    user.assignedTeams = teams;

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update user
router.put('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { firstName, lastName, email, role, departmentId, primaryTeamId, phone, timezone, isActive } = req.body;

    console.log('Update user request:', { userId: req.params.id, body: req.body, companyId: req.companyId });

    // Only allow users to update themselves, or admins to update anyone
    if (req.userId !== req.params.id && req.userRole !== 'super_admin' && req.userRole !== 'qa_manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    
    if (firstName !== undefined) { updates.push('first_name = ?'); values.push(firstName); }
    if (lastName !== undefined) { updates.push('last_name = ?'); values.push(lastName); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email); }
    if (role !== undefined) { updates.push('role = ?'); values.push(role); }
    if (departmentId !== undefined) { updates.push('department_id = ?'); values.push(departmentId); }
    if (primaryTeamId !== undefined) { updates.push('primary_team_id = ?'); values.push(primaryTeamId); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
    if (timezone !== undefined) { updates.push('timezone = ?'); values.push(timezone); }
    if (isActive !== undefined) { updates.push('is_active = ?'); values.push(isActive); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(req.params.id, req.companyId);
    
    await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ? AND company_id = ?`,
      values
    );

    const user = await queryOne<any>(
      'SELECT * FROM users WHERE id = ?',
      [req.params.id]
    );

    console.log('User updated successfully:', user);
    res.json({ user });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user (admin only)
router.delete('/:id', authenticateToken, requireRole('super_admin', 'qa_manager'), async (req: AuthRequest, res) => {
  try {
    await query(
      'DELETE FROM users WHERE id = ? AND company_id = ?',
      [req.params.id, req.companyId]
    );

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
