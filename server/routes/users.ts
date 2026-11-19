import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

/**
 * Self-service profile routes.
 *
 * User administration (listing other users, changing role / department / team /
 * status, deactivation) lives in /api/admin/users, which enforces the role
 * hierarchy and department scope. These routes only let a person read and edit
 * their OWN profile, so there is one set of rules for managing other users.
 */
const router = express.Router();

const PROFILE_COLUMNS = `u.id, u.email, u.first_name, u.last_name, u.role,
  u.company_id, u.department_id, u.primary_team_id,
  u.avatar_url, u.phone, u.timezone,
  u.created_at, u.last_login, u.is_active, u.email_verified,
  u.job_title,
  (SELECT c.name FROM companies c WHERE c.id = u.company_id) AS company_name,
  d.name as department_name,
  t.name as primary_team_name`;

async function loadProfile(userId: string, companyId: string) {
  return queryOne<any>(
    `SELECT ${PROFILE_COLUMNS}
     FROM users u
     LEFT JOIN departments d ON u.department_id = d.id
     LEFT JOIN teams t ON u.primary_team_id = t.id
     WHERE u.id = ? AND u.company_id = ?`,
    [userId, companyId]
  );
}

// The user directory is served by GET /api/admin/users (scoped by role).
router.get('/', authenticateToken, (_req, res) => {
  res.status(410).json({ error: 'Use GET /api/admin/users' });
});

// Own profile only.
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (req.params.id !== req.userId) {
      return res.status(403).json({ error: 'You can only view your own profile here' });
    }
    const user = await loadProfile(req.userId!, req.companyId!);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const teams = await query<any[]>(
      `SELECT t.id, t.name, tm.role as team_role, tm.joined_at
       FROM team_members tm
       JOIN teams t ON tm.team_id = t.id
       WHERE tm.user_id = ?`,
      [req.userId]
    );
    user.assignedTeams = teams;
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Edit own profile fields. Role, department, team and status are refused here; an
// admin changes those through PUT /api/admin/users/:id.
router.put('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (req.params.id !== req.userId) {
      return res.status(403).json({ error: 'Use the Users page to edit other people' });
    }
    const { firstName, lastName, email, phone, timezone, role, departmentId, primaryTeamId, isActive } = req.body ?? {};
    if ([role, departmentId, primaryTeamId, isActive].some(v => v !== undefined)) {
      return res.status(403).json({ error: 'You cannot change role, team, department, or status' });
    }

    const updates: string[] = [];
    const values: any[] = [];
    if (firstName !== undefined) { updates.push('first_name = ?'); values.push(firstName); }
    if (lastName !== undefined) { updates.push('last_name = ?'); values.push(lastName); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
    if (timezone !== undefined) { updates.push('timezone = ?'); values.push(timezone); }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    if (email !== undefined) {
      const clash = await queryOne<any>('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?', [email, req.userId]);
      if (clash) return res.status(400).json({ error: 'Email already registered' });
    }

    values.push(req.userId, req.companyId);
    await query(`UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ? AND company_id = ?`, values);
    res.json({ user: await loadProfile(req.userId!, req.companyId!) });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Deleting users is not supported here: DELETE /api/admin/users/:id deactivates with
// ownership checks and keeps the user's history.
router.delete('/:id', authenticateToken, (_req, res) => {
  res.status(410).json({ error: 'Use DELETE /api/admin/users/:id' });
});

export default router;
