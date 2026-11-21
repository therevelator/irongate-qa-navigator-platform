import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest, JWT_SECRET } from '../middleware/auth';
import { checkNewEmail, isEmailChange } from '../lib/emailChange';
import { currentSessionPersistent, endUserSessions, issueSessionCookie } from '../lib/sessions';
import { recordAudit } from '../lib/audit';

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

    const current = await queryOne<any>('SELECT email, department_id FROM users WHERE id = ? AND company_id = ?', [req.userId, req.companyId]);
    if (!current) return res.status(404).json({ error: 'User not found' });
    // A new sign-in address: valid, not a platform operator's, not taken (server/lib/emailChange.ts).
    let newEmail: string | null = null;
    if (isEmailChange(email, current.email)) {
      const check = await checkNewEmail(email, req.userId!);
      if (!check.ok) return res.status(check.status).json({ error: check.error });
      newEmail = check.email;
    }

    const updates: string[] = [];
    const values: any[] = [];
    if (firstName !== undefined) { updates.push('first_name = ?'); values.push(firstName); }
    if (lastName !== undefined) { updates.push('last_name = ?'); values.push(lastName); }
    if (newEmail !== null) { updates.push('email = ?'); values.push(newEmail); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
    if (timezone !== undefined) { updates.push('timezone = ?'); values.push(timezone); }
    if (updates.length === 0) {
      // An unchanged e-mail alone is not an error.
      if (email !== undefined) return res.json({ user: await loadProfile(req.userId!, req.companyId!) });
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.userId, req.companyId);
    await query(`UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ? AND company_id = ?`, values);
    if (newEmail !== null) {
      // Every other session ends; this browser gets a fresh cookie and stays signed in.
      await endUserSessions(req.userId!, undefined, { by: req.userId!, reason: 'E-mail address changed' });
      await issueSessionCookie(res, req.userId!, JWT_SECRET, { persistent: currentSessionPersistent(req), method: 'reissue' });
      await recordAudit({
        companyId: req.companyId!, actorId: req.userId!, action: 'user.email_change', entityType: 'user', entityId: req.userId!,
        summary: 'Changed own e-mail address; other sessions were signed out', departmentIds: [current.department_id].filter(Boolean), subjectIds: [req.userId!],
      });
    }
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
