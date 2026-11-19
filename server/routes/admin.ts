import express from 'express';
import { isOperatorEmail } from '../lib/operator';
import bcrypt from 'bcrypt';
import { query, queryOne, transaction } from '../../src/lib/db';
import { authenticateToken, JWT_SECRET } from '../middleware/auth';
import { policyActor } from '../middleware/access';
import { generateApiKey } from '../middleware/apiKey';
import { randomUUID } from 'crypto';
import {
  ROLE_HIERARCHY, TEAM_OPTIONAL_ROLES, canAssignRole, canManageUser, canEditUser, canSetJobTitle, canEditAssignment,
  canResetPassword, canDeleteUser, canGrant, canCreateUsers, canManageTeam, canManageDepartment, canManageCompanyConfig,
  isCompanyAdmin, highestRole, managedDepartmentIds, ledTeamIds, holdsRole, type PolicyActor,
} from '../lib/userPolicy';
import { teamMemberCountSql, teamLeadNameSql, teamLeadIdSql } from '../lib/teamMembership';
import {
  execOn, grantsForPrimary, grantAssignment, setPrimaryAssignment, syncUserDisplay, lastSuperAdminGuard, departmentManagers,
  listAssignments, userTeamIdsSql, userDepartmentIdsSql, AssignmentError,
} from '../lib/assignments';
import { recordAudit, auditedUserChange } from '../lib/audit';
import orgAdminRoutes from './orgAdmin';
import { loadResetTarget, sendResetLinkByAdmin, RESET_TTL_MINUTES } from '../lib/passwordReset';
import {
  currentSessionPersistent, endUserSessions, issueSessionCookie, isAllowedLifetime, lifetimeHours, lifetimeLabel,
  DEFAULT_SESSION_HOURS, SESSION_LIFETIME_CHOICES, SESSION_LIFETIME_KEY,
} from '../lib/sessions';
import { resolveConfigs, isSecretConfigKey } from '../lib/configResolver';
import { configValueProblem } from '../../src/lib/configRules';
import { planTeamDepartmentMove, applyTeamDepartmentMove } from '../lib/teamDepartment';
import {
  planAssignManager, applyAssignManager, planRemoveManager, applyRemoveManager, planAssignLead, applyAssignLead,
  type PlanResult, type AssignmentPlan,
} from '../lib/roleAssignment';

const router = express.Router();

// Role assignments, change history (Activity) and invitations: server/routes/orgAdmin.ts.
router.use(orgAdminRoutes);

// User-management rules live in server/lib/userPolicy.ts (shared with the Users and
// Teams pages, so the UI only offers what the server allows); the actor carries the caller's
// role assignments (server/lib/assignments.ts).
const actorOf = (req: any): PolicyActor => policyActor(req);

/** A user of the caller's company as a policy target (display columns + assigned departments / teams). */
async function loadTarget(userId: string, companyId: string) {
  return queryOne<any>(
    `SELECT u.id, u.role, u.email, u.first_name, u.last_name, u.department_id, u.primary_team_id, u.is_active, u.job_title,
            ${userTeamIdsSql('u')} AS team_ids, ${userDepartmentIdsSql('u')} AS department_ids
       FROM users u WHERE u.id = ? AND u.company_id = ?`,
    [userId, companyId]
  );
}

const USER_LIST_COLUMNS = `u.id, u.email, u.first_name, u.last_name, u.job_title, u.role, u.company_id,
  u.department_id, u.primary_team_id, u.is_active, u.created_at, u.developer_insights_enabled,
  t.name as team_name, d.name as department_name,
  ${userTeamIdsSql('u')} AS team_ids,
  ${userDepartmentIdsSql('u')} AS department_ids`;

/** Attach each user's active assignments (with scope names) for the Users page chips. */
async function withAssignments(companyId: string, users: any[]): Promise<any[]> {
  if (!users.length) return users;
  const rows = await listAssignments(companyId, users.map((u) => u.id));
  const byUser = new Map<string, any[]>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  return users.map((u) => ({ ...u, assignments: byUser.get(u.id) ?? [] }));
}

const fullName = (u: { first_name?: string | null; last_name?: string | null; email?: string }) =>
  `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email || 'user';

// Get users based on role permissions
router.get('/users', authenticateToken, async (req: any, res) => {
  try {
    const { id: userId, companyId } = req.user;
    const actor = actorOf(req);
    // Scope (role assignments): super_admin everyone; QA managers the users of the departments
    // they manage; team leads the users of the teams they lead; everyone themselves.
    const depts = managedDepartmentIds(actor);
    const led = ledTeamIds(actor);
    const users = await query<any>(
      `SELECT ${USER_LIST_COLUMNS}
         FROM users u
         LEFT JOIN teams t ON u.primary_team_id = t.id
         LEFT JOIN departments d ON u.department_id = d.id
        WHERE u.company_id = ?
          AND (?::boolean OR u.id = ?
               OR u.department_id = ANY(?::text[]) OR ${userDepartmentIdsSql('u')} && ?::varchar[]
               OR ${userTeamIdsSql('u')} && ?::varchar[])
        ORDER BY u.created_at DESC`,
      [companyId, isCompanyAdmin(actor), userId, depts, depts, led]
    );
    res.json(await withAssignments(companyId, users));
  } catch (error: any) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create user with a password (role-based). Kept for demos and scripted setups; the Users page
// invites people by email instead (POST /api/admin/invitations), so they choose their own password.
// The role / department / team become the user's role assignments (server/lib/assignments.ts).
router.post('/users', authenticateToken, async (req: any, res) => {
  try {
    const actor = actorOf(req);
    const actorRole = highestRole(actor);
    const { companyId } = req.user;
    const { email, password, firstName, lastName, role } = req.body ?? {};
    let teamId: string | null = req.body?.teamId || null;
    let departmentId: string | null = req.body?.departmentId || null;

    // Permission before the body is looked at (FI-15): who cannot create anyone gets 403, not 400.
    if (!canCreateUsers(actorRole)) {
      return res.status(403).json({ error: 'You cannot create users' });
    }
    if (!email || !password || !firstName || !lastName || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!canAssignRole(actorRole, role)) {
      return res.status(403).json({ error: `${actorRole} cannot create ${role} users` });
    }

    // Scope: a team lead creates users on a team they lead; a manager in a department they manage.
    if (!isCompanyAdmin(actor) && !managedDepartmentIds(actor).length) {
      const led = ledTeamIds(actor);
      if (teamId && !led.includes(teamId)) {
        return res.status(403).json({ error: 'Team leads can only add users to their own team' });
      }
      teamId = teamId ?? (actor.primaryTeamId && led.includes(actor.primaryTeamId) ? actor.primaryTeamId : led[0] ?? null);
      departmentId = null;
    }
    if (!teamId && !TEAM_OPTIONAL_ROLES.includes(role)) {
      return res.status(400).json({ error: 'A primary team is required for this role' });
    }

    let team: { id: string; department_id: string | null } | null = null;
    if (teamId) {
      team = await queryOne<any>('SELECT id, department_id FROM teams WHERE id = ? AND company_id = ? AND is_active = TRUE', [teamId, companyId]);
      if (!team) return res.status(400).json({ error: 'Invalid team ID' });
      if (departmentId && team.department_id !== departmentId) {
        return res.status(400).json({ error: 'Team must be in the specified department' });
      }
      departmentId = team.department_id;
    }
    if (!isCompanyAdmin(actor) && managedDepartmentIds(actor).length) {
      departmentId = departmentId || actor.departmentId || managedDepartmentIds(actor)[0] || null;
      if (!canManageDepartment(actor, departmentId)) {
        return res.status(403).json({ error: 'Can only add users to your department' });
      }
    }
    if (!departmentId) {
      return res.status(400).json({ error: 'Department ID is required' });
    }
    const dept = await queryOne<any>('SELECT id FROM departments WHERE id = ? AND company_id = ? AND is_active = TRUE', [departmentId, companyId]);
    if (!dept) return res.status(400).json({ error: 'Invalid department ID' });
    const grants = grantsForPrimary(companyId, role, departmentId, teamId);
    for (const g of grants) {
      if (!canGrant(actor, g, g.scopeType === 'team' ? team : null)) return res.status(403).json({ error: 'You cannot give that assignment' });
    }

    const existingUser = await queryOne<any>('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email]);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    if (await isOperatorEmail(email)) return res.status(409).json({ error: 'This e-mail address cannot be used for a company account.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = randomUUID();
    await transaction(async (client) => {
      const exec = execOn(client);
      await exec(
        `INSERT INTO users (
          id, email, password_hash, first_name, last_name, role,
          company_id, department_id, primary_team_id, created_by, is_active, email_verified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, true)`,
        [userId, email, passwordHash, firstName, lastName, role, companyId, departmentId, teamId, actor.id]
      );
      for (const g of grants) await grantAssignment(exec, { companyId, userId, grant: g, actorId: actor.id });
      await syncUserDisplay(exec, userId, { primaryTeamId: teamId, departmentId, fallbackRole: role });
      await recordAudit({
        companyId, actorId: actor.id, action: 'user.create', entityType: 'user', entityId: userId,
        summary: `Created ${firstName} ${lastName} (${email}) with a password`,
        after: { email, role, departmentId, teamId, grants }, departmentIds: [departmentId], subjectIds: [userId],
      }, exec);
    });

    const newUser = await queryOne<any>(
      `SELECT ${USER_LIST_COLUMNS}
       FROM users u
       LEFT JOIN teams t ON u.primary_team_id = t.id
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = ?`,
      [userId]
    );
    res.status(201).json((await withAssignments(companyId, [newUser]))[0]);
  } catch (error: any) {
    if (error instanceof AssignmentError) return res.status(error.status).json({ error: error.message });
    console.error('Error creating user:', error);
    if (error?.code === '23505') return res.status(400).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user. Self: name and email only. Others: super_admin / qa_manager for users they
// can manage; a changed role must be one they may assign. Fields not sent keep their value.
// role / departmentId / primaryTeamId change the user's PRIMARY assignment (other assignments
// stay; they are managed with /users/:id/assignments). Recorded in the change history (undoable).
router.put('/users/:id', authenticateToken, async (req: any, res) => {
  try {
    const actor = actorOf(req);
    const { companyId } = req.user;
    const target = await loadTarget(req.params.id, companyId);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const body = req.body ?? {};
    const firstName = body.firstName ?? undefined;
    const lastName = body.lastName ?? undefined;
    const email = body.email ?? undefined;
    const role: string = body.role ?? target.role;
    const departmentId: string | null = body.departmentId === undefined ? target.department_id : (body.departmentId || null);
    const primaryTeamId: string | null = body.primaryTeamId === undefined ? target.primary_team_id : (body.primaryTeamId || null);
    const assignmentChanged = role !== target.role || departmentId !== target.department_id || primaryTeamId !== target.primary_team_id;

    if (!canEditUser(actor, target)) {
      return res.status(403).json({ error: 'You cannot edit this user' });
    }
    // Job title (shown in the top bar and on Team detail): super admins only; '' clears it.
    let jobTitle: string | null | undefined;
    if (body.jobTitle !== undefined) {
      if (!canSetJobTitle(actor)) return res.status(403).json({ error: 'Only super admins can set job titles' });
      if (body.jobTitle !== null && typeof body.jobTitle !== 'string') return res.status(400).json({ error: 'Job title must be text' });
      jobTitle = typeof body.jobTitle === 'string' && body.jobTitle.trim() ? body.jobTitle.trim() : null;
      if (jobTitle && jobTitle.length > 120) return res.status(400).json({ error: 'Job title must be at most 120 characters' });
    }
    const jobTitleChanged = jobTitle !== undefined && jobTitle !== (target.job_title ?? null);
    let team: { id: string; department_id: string | null } | null = null;
    if (assignmentChanged) {
      if (!canEditAssignment(actor, target)) {
        return res.status(403).json({ error: 'You cannot change your own role, department or team' });
      }
      if (role !== target.role && !canAssignRole(highestRole(actor), role)) {
        return res.status(403).json({ error: `${highestRole(actor)} cannot assign the ${role} role` });
      }
      if (!canManageDepartment(actor, departmentId)) {
        return res.status(403).json({ error: 'Can only assign users to your department' });
      }
      if (!departmentId) return res.status(400).json({ error: 'Department is required' });
      const dept = await queryOne<any>('SELECT id FROM departments WHERE id = ? AND company_id = ?', [departmentId, companyId]);
      if (!dept) return res.status(400).json({ error: 'Invalid department ID' });
      if (primaryTeamId) {
        team = await queryOne<any>('SELECT id, department_id FROM teams WHERE id = ? AND company_id = ?', [primaryTeamId, companyId]);
        if (!team) return res.status(400).json({ error: 'Invalid team ID' });
        if (team.department_id !== departmentId) return res.status(400).json({ error: 'Team must be in the selected department' });
      } else if (!TEAM_OPTIONAL_ROLES.includes(role)) {
        return res.status(400).json({ error: 'A primary team is required for this role' });
      }
      for (const g of grantsForPrimary(companyId, role, departmentId, primaryTeamId)) {
        if (!canGrant(actor, g, g.scopeType === 'team' ? team : null)) return res.status(403).json({ error: 'You cannot give that assignment' });
      }
      if (target.role === 'super_admin' && role !== 'super_admin') await lastSuperAdminGuard(companyId, target.id);
    }
    if (email !== undefined) {
      const clash = await queryOne<any>('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?', [email, target.id]);
      if (clash) return res.status(400).json({ error: 'Email already registered' });
    }

    await auditedUserChange(
      { companyId, actorId: actor.id, action: 'user.update', userIds: [target.id] },
      async (exec) => {
        await exec(
          `UPDATE users SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), email = COALESCE(?, email), updated_at = NOW()
            WHERE id = ? AND company_id = ?`,
          [firstName ?? null, lastName ?? null, email ?? null, target.id, companyId]
        );
        if (jobTitleChanged) await exec('UPDATE users SET job_title = ? WHERE id = ? AND company_id = ?', [jobTitle, target.id, companyId]);
        if (assignmentChanged) {
          await setPrimaryAssignment(exec, {
            companyId, userId: target.id, actorId: actor.id,
            from: { role: target.role, departmentId: target.department_id, teamId: target.primary_team_id },
            to: { role, departmentId, teamId: primaryTeamId },
          });
        }
        const parts = [assignmentChanged ? `role / team changed to ${role}` : null, (firstName || lastName || email) ? 'profile updated' : null, jobTitleChanged ? `job title ${jobTitle ? `set to "${jobTitle}"` : 'cleared'}` : null].filter(Boolean);
        return { summary: `${fullName(target)}: ${parts.join(', ') || 'saved without changes'}`, result: null };
      },
    );

    const updatedUser = await queryOne<any>(
      `SELECT ${USER_LIST_COLUMNS}
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN teams t ON u.primary_team_id = t.id
       WHERE u.id = ?`,
      [target.id]
    );
    res.json((await withAssignments(companyId, [updatedUser]))[0]);
  } catch (error: any) {
    if (error instanceof AssignmentError) return res.status(error.status).json({ error: error.message });
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Toggle user active status
router.post('/users/:id/toggle-status', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const target = await loadTarget(req.params.id, companyId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canManageUser(actorOf(req), target)) {
      return res.status(403).json({ error: 'You cannot change this user\'s status' });
    }
    const newStatus = !target.is_active;
    if (!newStatus && target.role === 'super_admin') await lastSuperAdminGuard(companyId, target.id);
    await auditedUserChange(
      { companyId, actorId: req.user.id, action: newStatus ? 'user.activate' : 'user.deactivate', userIds: [target.id] },
      async (exec) => {
        await exec('UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ? AND company_id = ?', [newStatus, target.id, companyId]);
        return { summary: `${newStatus ? 'Activated' : 'Deactivated'} ${fullName(target)}`, result: null };
      },
    );
    res.json({ message: `User ${newStatus ? 'activated' : 'deactivated'} successfully`, is_active: newStatus });
  } catch (error: any) {
    if (error instanceof AssignmentError) return res.status(error.status).json({ error: error.message });
    console.error('Error toggling user status:', error);
    res.status(500).json({ error: 'Failed to toggle user status' });
  }
});

// Toggle developer insights for a user
router.patch('/users/:id/developer-insights-toggle', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const target = await loadTarget(req.params.id, companyId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canManageUser(actorOf(req), target)) {
      return res.status(403).json({ error: 'You cannot change this user\'s developer insights' });
    }
    const enabled = !!req.body?.enabled;
    await query('UPDATE users SET developer_insights_enabled = ?, updated_at = NOW() WHERE id = ? AND company_id = ?', [enabled, target.id, companyId]);
    await recordAudit({
      companyId, actorId: req.user.id, action: 'user.developer_insights', entityType: 'user', entityId: target.id,
      summary: `Developer insights ${enabled ? 'enabled' : 'disabled'} for ${fullName(target)}`,
      after: { developer_insights_enabled: enabled }, departmentIds: [target.department_id, ...(target.department_ids ?? [])], subjectIds: [target.id],
    });
    res.json({ success: true, developer_insights_enabled: enabled });
  } catch (error: any) {
    console.error('Error toggling developer insights:', error);
    res.status(500).json({ error: 'Failed to toggle developer insights' });
  }
});

// Toggle team active status
router.post('/teams/:id/toggle-status', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { id: teamId } = req.params;
    const actor = actorOf(req);

    // Only Super Admin and QA Managers (teams of their departments): canManageTeam.
    if (!canManageCompanyConfig(actor)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Get team to check department and current status
    const existingTeam = await queryOne<any>('SELECT name, department_id, is_active FROM teams WHERE id = ? AND company_id = ?', [teamId, companyId]);
    if (!existingTeam) {
      return res.status(404).json({ error: 'Team not found' });
    }
    if (!canManageTeam(actor, existingTeam)) {
      return res.status(403).json({ error: 'Can only manage teams in your department' });
    }

    // Toggle the status
    const newStatus = !existingTeam.is_active;
    await query(
      'UPDATE teams SET is_active = ?, updated_at = NOW() WHERE id = ? AND company_id = ?',
      [newStatus, teamId, companyId]
    );
    await recordAudit({
      companyId, actorId: actor.id, action: newStatus ? 'team.activate' : 'team.deactivate', entityType: 'team', entityId: teamId,
      summary: `${newStatus ? 'Activated' : 'Deactivated'} team ${existingTeam.name}`, before: { is_active: existingTeam.is_active }, after: { is_active: newStatus },
      departmentIds: [existingTeam.department_id], subjectIds: [teamId],
    });

    res.json({ message: `Team ${newStatus ? 'activated' : 'deactivated'} successfully`, is_active: newStatus });
  } catch (error: any) {
    console.error('Error toggling team status:', error);
    res.status(500).json({ error: 'Failed to toggle team status' });
  }
});

// Reset password: yourself, or a user you can manage (userPolicy.canResetPassword).
router.post('/users/:id/reset-password', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { newPassword } = req.body ?? {};
    const target = await loadTarget(req.params.id, companyId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canResetPassword(actorOf(req), target)) {
      return res.status(403).json({ error: 'You cannot reset this user\'s password' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ? AND company_id = ?', [passwordHash, target.id, companyId]);
    // Existing sessions of that person end. Changing your own password keeps this browser signed in.
    await endUserSessions(target.id);
    if (target.id === req.user.id) await issueSessionCookie(res, req.user.id, JWT_SECRET, { persistent: currentSessionPersistent(req) });
    await recordAudit({
      companyId, actorId: req.user.id, action: 'user.password_reset', entityType: 'user', entityId: target.id,
      summary: target.id === req.user.id ? 'Changed own password' : `Reset the password of ${fullName(target)}`,
      departmentIds: [target.department_id, ...(target.department_ids ?? [])], subjectIds: [target.id],
    });
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Sign a user out everywhere: every session of that person ends (same permission as resetting
// their password). For yourself it is "sign out my other devices": this browser stays signed in.
router.post('/users/:id/sign-out-everywhere', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const target = await loadTarget(req.params.id, companyId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canResetPassword(actorOf(req), target)) {
      return res.status(403).json({ error: 'You cannot sign out this user' });
    }
    const self = target.id === req.user.id;
    await transaction(async (client) => {
      const exec = execOn(client);
      await endUserSessions(target.id, exec);
      await recordAudit({
        companyId, actorId: req.user.id, action: 'user.sessions_end', entityType: 'user', entityId: target.id,
        summary: self ? `${fullName(target)} signed out of all other devices` : `Signed ${fullName(target)} out everywhere`,
        departmentIds: [target.department_id, ...(target.department_ids ?? [])], subjectIds: [target.id],
      }, exec);
    });
    if (self) await issueSessionCookie(res, req.user.id, JWT_SECRET, { persistent: currentSessionPersistent(req) });
    res.json({ message: self ? 'You were signed out on all other devices.' : `${fullName(target)} was signed out on every device.` });
  } catch (error) {
    console.error('Error signing a user out:', (error as any)?.code ?? (error as Error)?.name ?? 'error');
    res.status(500).json({ error: 'Failed to sign the user out' });
  }
});

// "Sign-in lasts" (company setting, super admins only): GET the current value and the choices,
// PUT { lifetimeHours } with one of the choices. Applies at once to existing sessions
// (server/lib/sessions.ts); the generic configs endpoint refuses this key.
router.get('/session-settings', authenticateToken, async (req: any, res) => {
  try {
    if (!isCompanyAdmin(actorOf(req))) return res.status(403).json({ error: 'Only a super admin can change how long sign-ins last' });
    const row = await queryOne<any>(
      `SELECT config_value, updated_at FROM configs WHERE company_id = ? AND config_key = ? AND department_id IS NULL AND team_id IS NULL`,
      [req.user.companyId, SESSION_LIFETIME_KEY]
    );
    res.json({ lifetimeHours: lifetimeHours(row?.config_value), choices: SESSION_LIFETIME_CHOICES, defaultHours: DEFAULT_SESSION_HOURS, updatedAt: row?.updated_at ?? null });
  } catch (error) {
    console.error('Error reading session settings:', (error as any)?.code ?? 'error');
    res.status(500).json({ error: 'Failed to read the sign-in settings' });
  }
});

router.put('/session-settings', authenticateToken, async (req: any, res) => {
  try {
    if (!isCompanyAdmin(actorOf(req))) return res.status(403).json({ error: 'Only a super admin can change how long sign-ins last' });
    const next = req.body?.lifetimeHours;
    if (!isAllowedLifetime(next)) {
      return res.status(400).json({ error: `lifetimeHours must be one of ${SESSION_LIFETIME_CHOICES.join(', ')}` });
    }
    const { companyId } = req.user;
    const before = await transaction(async (client) => {
      const exec = execOn(client);
      const [prev] = await exec<any>(
        `SELECT config_value FROM configs WHERE company_id = ? AND config_key = ? AND department_id IS NULL AND team_id IS NULL FOR UPDATE`,
        [companyId, SESSION_LIFETIME_KEY]
      );
      const from = lifetimeHours(prev?.config_value);
      if (prev) {
        await exec(`UPDATE configs SET config_value = ?, updated_at = NOW() WHERE company_id = ? AND config_key = ? AND department_id IS NULL AND team_id IS NULL`,
          [String(next), companyId, SESSION_LIFETIME_KEY]);
      } else {
        await exec(`INSERT INTO configs (id, company_id, department_id, team_id, config_key, config_value) VALUES (gen_random_uuid(), ?, NULL, NULL, ?, ?)`,
          [companyId, SESSION_LIFETIME_KEY, String(next)]);
      }
      if (from !== next) {
        await recordAudit({
          companyId, actorId: req.user.id, action: 'config.session_lifetime', entityType: 'config', entityId: SESSION_LIFETIME_KEY,
          summary: `Sign-in lasts: ${lifetimeLabel(from)} → ${lifetimeLabel(next)}`, before: { lifetimeHours: from }, after: { lifetimeHours: next },
          departmentIds: [], subjectIds: [companyId],
        }, exec);
      }
      return from;
    });
    res.json({ lifetimeHours: next, previousHours: before, choices: SESSION_LIFETIME_CHOICES, defaultHours: DEFAULT_SESSION_HOURS });
  } catch (error) {
    console.error('Error saving session settings:', (error as any)?.code ?? 'error');
    res.status(500).json({ error: 'Failed to save the sign-in settings' });
  }
});

// Send a password reset link by e-mail (the same e-mail as "Forgot password?"): same permission
// as resetting the password directly (userPolicy.canResetPassword). Never returns the link.
router.post('/users/:id/send-reset-link', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const target = await loadTarget(req.params.id, companyId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canResetPassword(actorOf(req), target)) {
      return res.status(403).json({ error: 'You cannot reset this user\'s password' });
    }
    if (!target.is_active) return res.status(409).json({ error: 'This user is deactivated. Reactivate the account first.' });
    const full = await loadResetTarget(target.id, companyId);
    if (!full) return res.status(404).json({ error: 'User not found' });
    const me = await queryOne<any>('SELECT first_name, last_name, email FROM users WHERE id = ?', [req.user.id]);
    const mail = await sendResetLinkByAdmin(full, { id: req.user.id, name: me ? fullName(me) : 'Your administrator' });
    res.json({
      delivered: mail.delivered, channel: mail.channel, error: mail.error ?? null,
      message: mail.delivered ? `A reset link was sent to ${target.email}. It works once and expires in ${RESET_TTL_MINUTES} minutes.` : mail.error ?? 'The e-mail could not be sent.',
    });
  } catch (error) {
    console.error('Error sending reset link:', (error as any)?.code ?? (error as Error)?.name ?? 'error');
    res.status(500).json({ error: 'Failed to send the reset link' });
  }
});

// Get all teams (with department names) - everyone can view for dashboard
router.get('/teams', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;

    // Everyone can see all teams in their company for the dashboard
    // member_count / team_lead_name: the shared membership definition (server/lib/teamMembership).
    const teams = await query<any>(
      `SELECT t.*, d.name as department_name,
              ${teamMemberCountSql('t')} AS member_count,
              ${teamLeadNameSql('t')} AS team_lead_name
       FROM teams t 
       LEFT JOIN departments d ON t.department_id = d.id 
       WHERE t.company_id = ? AND t.is_active = true
       ORDER BY t.created_at DESC`,
      [companyId]
    );

    res.json(teams);
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

// Create team (QA Manager and Super Admin)
router.post('/teams', authenticateToken, async (req: any, res) => {
  try {
    const { companyId, departmentId: userDepartmentId } = req.user;
    const { name, description, departmentId: requestDepartmentId } = req.body;
    const actor = actorOf(req);

    // Only QA Managers and Super Admins can create teams (canManageDepartment for the department).
    if (!canManageCompanyConfig(actor)) {
      return res.status(403).json({ error: 'Only managers and super admins can create teams' });
    }

    if (!name) {
      return res.status(400).json({ error: 'Team name is required' });
    }

    // Department: the one requested, else the caller's own (a manager: one they manage).
    const managed = managedDepartmentIds(actor);
    const targetDepartmentId = requestDepartmentId
      || (isCompanyAdmin(actor) ? userDepartmentId : (managed.includes(userDepartmentId) ? userDepartmentId : managed[0]));
    if (!targetDepartmentId) {
      return res.status(400).json({ error: 'Department is required' });
    }
    if (!canManageDepartment(actor, targetDepartmentId)) {
      return res.status(403).json({ error: 'Can only create teams in your department' });
    }
    const deptRow = await queryOne<any>('SELECT id FROM departments WHERE id = ? AND company_id = ? AND is_active = TRUE', [targetDepartmentId, companyId]);
    if (!deptRow) return res.status(400).json({ error: 'Department not found in your company' });

    // Check if team with same name exists in this department for this company (including inactive)
    const existingTeam = await queryOne<any>(
      'SELECT id, is_active FROM teams WHERE company_id = ? AND department_id = ? AND LOWER(name) = LOWER(?)',
      [companyId, targetDepartmentId, name]
    );

    let teamId: string;
    let newTeam: any;

    if (existingTeam) {
      if (existingTeam.is_active) {
        return res.status(409).json({ error: 'A team with this name already exists in this department' });
      }
      // Reactivate the inactive team
      teamId = existingTeam.id;
      await query<any>(
        'UPDATE teams SET is_active = true, description = ? WHERE id = ?',
        [description || '', teamId]
      );
      newTeam = await queryOne<any>('SELECT * FROM teams WHERE id = ?', [teamId]);
    } else {
      // Generate UUID for new team
      teamId = `team-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Insert team
      await query<any>(
        `INSERT INTO teams (id, company_id, department_id, name, description, is_active)
         VALUES (?, ?, ?, ?, ?, true)`,
        [teamId, companyId, targetDepartmentId, name, description || '']
      );

      // No initial KPI snapshot: a placeholder row of zeros (0% coverage, 0% CFR,
      // 99.9% availability, QA 0) would be shown as real measurements. The first
      // snapshot is created when metrics are entered.

      newTeam = await queryOne<any>('SELECT * FROM teams WHERE id = ?', [teamId]);
    }
    await recordAudit({
      companyId, actorId: actor.id, action: existingTeam ? 'team.activate' : 'team.create', entityType: 'team', entityId: teamId,
      summary: `${existingTeam ? 'Reactivated' : 'Created'} team ${name}`, after: { name, description: description || '', departmentId: targetDepartmentId },
      departmentIds: [targetDepartmentId], subjectIds: [teamId],
    });

    res.status(201).json(newTeam);
  } catch (error) {
    console.error('Error creating team:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// Update team
router.put('/teams/:id', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { id: teamId } = req.params;
    const { name, description } = req.body;
    const actor = actorOf(req);

    // Only Super Admin and QA Managers (teams of their departments) can update teams.
    if (!canManageCompanyConfig(actor)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Get team to check department — scoped to the caller's company.
    const team = await queryOne<any>('SELECT name, description, department_id FROM teams WHERE id = ? AND company_id = ?', [teamId, companyId]);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    if (!canManageTeam(actor, team)) {
      return res.status(403).json({ error: 'Can only update teams in your department' });
    }

    await query(
      'UPDATE teams SET name = ?, description = ? WHERE id = ? AND company_id = ?',
      [name, description, teamId, companyId]
    );
    if (team.name !== name || (team.description ?? null) !== (description ?? null)) {
      await recordAudit({
        companyId, actorId: actor.id, action: 'team.update', entityType: 'team', entityId: teamId,
        summary: team.name !== name ? `Renamed team ${team.name} to ${name}` : `Updated the description of ${team.name}`,
        before: { name: team.name, description: team.description ?? null }, after: { name, description: description ?? null },
        departmentIds: [team.department_id], subjectIds: [teamId],
      });
    }

    const updatedTeam = await queryOne<any>('SELECT * FROM teams WHERE id = ? AND company_id = ?', [teamId, companyId]);
    res.json(updatedTeam);
  } catch (error: any) {
    console.error('Error updating team:', error);
    res.status(500).json({ error: 'Failed to update team' });
  }
});

// Move a team to another department (super_admin only). Body: { departmentId, dryRun? }.
// The target must be an active department of the caller's company. In one transaction the
// team, the members who follow it and its team-level configs move (server/lib/teamDepartment).
// dryRun: true validates and returns the same plan without writing (the confirm dialog).
router.put('/teams/:id/department', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    if (!isCompanyAdmin(actorOf(req))) {
      return res.status(403).json({ error: 'Only Super Admins can move teams between departments' });
    }
    const { departmentId, dryRun } = req.body ?? {};
    const result = await planTeamDepartmentMove(companyId, req.params.id, departmentId);
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    const { plan } = result;
    if (dryRun === true) return res.json({ dryRun: true, ...plan });

    const movedUserIds = await applyTeamDepartmentMove(companyId, plan, req.user.id);
    res.json({ ...plan, movedUserIds, message: `${plan.team.name} moved to ${plan.to.name}` });
  } catch (error: any) {
    if (error?.status === 409) return res.status(409).json({ error: 'The team was changed by someone else. Refresh and try again.' });
    if (error?.code === '23505') return res.status(409).json({ error: 'The target department already has a team with this name' });
    console.error('Error moving team:', error);
    res.status(500).json({ error: 'Failed to move team' });
  }
});

// Manager and team-lead assignment (Departments page). super_admin only; every rule lives in
// server/lib/roleAssignment.ts. dryRun: true returns the plan (with its consequences) unchanged.
async function runAssignment(
  req: any, res: any,
  plan: () => Promise<PlanResult>,
  apply: (companyId: string, actorId: string, p: AssignmentPlan) => Promise<void>,
) {
  try {
    if (!isCompanyAdmin(actorOf(req))) {
      return res.status(403).json({ error: 'Only Super Admins can assign managers and team leads' });
    }
    const result = await plan();
    if (result.ok === false) return res.status(result.status).json({ error: result.error });
    if (req.body?.dryRun === true) return res.json({ dryRun: true, ...result.plan });
    await apply(req.user.companyId, req.user.id, result.plan);
    res.json(result.plan);
  } catch (error) {
    if (error instanceof AssignmentError) return res.status(error.status).json({ error: error.message });
    console.error('Error assigning role:', error);
    res.status(500).json({ error: 'Failed to save the assignment' });
  }
}

router.post('/departments/:id/managers', authenticateToken, (req: any, res) =>
  runAssignment(req, res, () => planAssignManager(req.user.companyId, req.user.id, req.params.id, req.body?.userId), applyAssignManager));

router.post('/departments/:id/managers/:userId/remove', authenticateToken, (req: any, res) =>
  runAssignment(req, res, () => planRemoveManager(req.user.companyId, req.user.id, req.params.id, req.params.userId, req.body?.role, req.body?.teamId), applyRemoveManager));

router.put('/teams/:id/lead', authenticateToken, (req: any, res) =>
  runAssignment(req, res, () => planAssignLead(req.user.companyId, req.user.id, req.params.id, req.body?.userId), applyAssignLead));

// Delete team
router.delete('/teams/:id', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const { id: teamId } = req.params;
    const actor = actorOf(req);

    // Only Super Admin and QA Managers (teams of their departments) can delete teams.
    if (!canManageCompanyConfig(actor)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Get team to check department — scoped to the caller's company.
    const team = await queryOne<any>('SELECT name, department_id FROM teams WHERE id = ? AND company_id = ?', [teamId, companyId]);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    if (!canManageTeam(actor, team)) {
      return res.status(403).json({ error: 'Can only delete teams in your department' });
    }

    // Check if team has active users assigned to it
    const activeUsers = await query<any>(
      'SELECT id, first_name, last_name FROM users WHERE primary_team_id = ? AND is_active = true',
      [teamId]
    );

    if (activeUsers && activeUsers.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete team with active users',
        hasActiveUsers: true,
        userCount: activeUsers.length,
        users: activeUsers.slice(0, 5).map((u: any) => `${u.first_name} ${u.last_name}`)
      });
    }

    // Soft delete - deactivate the team instead of hard delete
    await query('UPDATE teams SET is_active = false, updated_at = NOW() WHERE id = ? AND company_id = ?', [teamId, companyId]);
    await recordAudit({
      companyId, actorId: actor.id, action: 'team.deactivate', entityType: 'team', entityId: teamId,
      summary: `Deactivated team ${team.name}`, before: { is_active: true }, after: { is_active: false },
      departmentIds: [team.department_id], subjectIds: [teamId],
    });
    res.json({ message: 'Team deactivated successfully' });
  } catch (error: any) {
    console.error('Error deleting team:', error);
    res.status(500).json({ error: 'Failed to delete team' });
  }
});

// Delete user = deactivate (history is kept). super_admin / qa_manager for users they can manage.
router.delete('/users/:id', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const actor = actorOf(req);
    const target = await loadTarget(req.params.id, companyId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.id === actor.id) {
      return res.status(403).json({ error: 'Cannot delete your own account' });
    }
    if (!canDeleteUser(actor, target)) {
      return res.status(403).json({ error: 'Insufficient permissions to delete this user' });
    }
    if (!target.is_active) return res.json({ message: 'User deactivated successfully', deactivated: true });
    if (target.role === 'super_admin') await lastSuperAdminGuard(companyId, target.id);
    await auditedUserChange(
      { companyId, actorId: actor.id, action: 'user.deactivate', userIds: [target.id] },
      async (exec) => {
        await exec('UPDATE users SET is_active = false, updated_at = NOW() WHERE id = ? AND company_id = ?', [target.id, companyId]);
        return { summary: `Deactivated ${fullName(target)}`, result: null };
      },
    );
    res.json({ message: 'User deactivated successfully', deactivated: true });
  } catch (error: any) {
    if (error instanceof AssignmentError) return res.status(error.status).json({ error: error.message });
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get available roles for current user
router.get('/available-roles', authenticateToken, async (req: any, res) => {
  try {
    const { role } = req.user;
    const availableRoles = ROLE_HIERARCHY[role as keyof typeof ROLE_HIERARCHY] || [];
    
    res.json({ availableRoles });
  } catch (error) {
    console.error('Error fetching available roles:', error);
    res.status(500).json({ error: 'Failed to fetch available roles' });
  }
});

// Get departments - everyone can view all departments for dashboard
router.get('/departments', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;

    // Everyone can see all departments in their company for the dashboard
    const departments = await query<any>(
      'SELECT id, name, company_id, created_at FROM departments WHERE company_id = ? AND is_active = true ORDER BY name',
      [companyId]
    );

    res.json(departments);
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

// Get all departments with description (Super Admin only)
router.get('/departments/all', authenticateToken, async (req: any, res) => {
  try {
    const { role, companyId } = req.user;

    if (!isCompanyAdmin(actorOf(req))) {
      return res.status(403).json({ error: 'Only Super Admins can access all departments' });
    }

    // Counts follow the same columns the rest of the app keys off: teams.department_id
    // (active teams; inactive ones counted separately) and users.department_id (active users).
    const departments = await query<any>(
      `SELECT d.id, d.name, d.description, d.company_id, d.created_at,
              (SELECT COUNT(*)::int FROM teams t WHERE t.department_id = d.id AND t.company_id = d.company_id AND t.is_active = TRUE) AS team_count,
              (SELECT COUNT(*)::int FROM teams t WHERE t.department_id = d.id AND t.company_id = d.company_id AND t.is_active = FALSE) AS inactive_team_count,
              (SELECT COUNT(*)::int FROM users u WHERE u.department_id = d.id AND u.company_id = d.company_id AND u.is_active = TRUE) AS user_count
         FROM departments d
        WHERE d.company_id = ? AND d.is_active = true
        ORDER BY d.name`,
      [companyId]
    );

    res.json(departments);
  } catch (error) {
    console.error('Error fetching all departments:', error);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

// A department's teams (active and inactive) for the Departments page detail (Super Admin only):
// member count and lead from the shared membership definition, the latest QA score, and the
// department's active QA managers (who see these teams' analytics).
router.get('/departments/:id/teams', authenticateToken, async (req: any, res) => {
  try {
    const { role, companyId } = req.user;
    if (!isCompanyAdmin(actorOf(req))) {
      return res.status(403).json({ error: 'Only Super Admins can view department details' });
    }
    const department = await queryOne<any>(
      'SELECT id, name, description, is_active FROM departments WHERE id = ? AND company_id = ?',
      [req.params.id, companyId]
    );
    if (!department) return res.status(404).json({ error: 'Department not found' });

    const teams = await query<any>(
      `SELECT t.id, t.name, t.description, t.is_active, t.department_id,
              ${teamMemberCountSql('t')}::int AS member_count,
              ${teamLeadNameSql('t')} AS team_lead_name,
              ${teamLeadIdSql('t')} AS team_lead_id,
              k.qa_score, k.snapshot_date
         FROM teams t
         LEFT JOIN LATERAL (
           SELECT ks.qa_score, ks.snapshot_date FROM kpi_snapshots ks
            WHERE ks.team_id = t.id ORDER BY ks.snapshot_date DESC LIMIT 1
         ) k ON TRUE
        WHERE t.company_id = ? AND t.department_id = ?
        ORDER BY t.is_active DESC, t.name`,
      [companyId, department.id]
    );
    // The department's QA managers: their active qa_manager assignments (server/lib/assignments.ts).
    const managers = (await departmentManagers(companyId, department.id)).map((m) => ({
      id: m.id, name: fullName(m), email: m.email, primary_team_id: m.primary_team_id,
    }));
    res.json({
      department,
      managers,
      teams: teams.map((t: any) => ({ ...t, qa_score: t.qa_score == null ? null : Number(t.qa_score) })),
    });
  } catch (error) {
    console.error('Error fetching department teams:', error);
    res.status(500).json({ error: 'Failed to fetch department teams' });
  }
});

// Create department (Super Admin only)
router.post('/departments', authenticateToken, async (req: any, res) => {
  try {
    const { role, companyId } = req.user;
    const { name, description } = req.body;

    if (!isCompanyAdmin(actorOf(req))) {
      return res.status(403).json({ error: 'Only Super Admins can create departments' });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Department name is required' });
    }

    // Duplicate names are checked among active departments only. A deleted (inactive)
    // department with the same name is reactivated instead of creating a second row.
    const existing = await queryOne<any>(
      'SELECT id, is_active FROM departments WHERE LOWER(name) = LOWER(?) AND company_id = ?',
      [name.trim(), companyId]
    );
    if (existing?.is_active) {
      return res.status(400).json({ error: 'Department name already exists' });
    }

    let departmentId: string;
    if (existing) {
      departmentId = existing.id;
      await query(
        'UPDATE departments SET is_active = true, name = ?, description = ?, updated_at = NOW() WHERE id = ? AND company_id = ?',
        [name.trim(), description?.trim() || null, departmentId, companyId]
      );
    } else {
      // Random id: a slug id is a global primary key, so two companies could not both have "QA".
      departmentId = randomUUID();
      await query(
        'INSERT INTO departments (id, name, description, company_id, is_active) VALUES (?, ?, ?, ?, true)',
        [departmentId, name.trim(), description?.trim() || null, companyId]
      );
    }

    const newDepartment = await queryOne<any>(
      'SELECT id, name, description, company_id, created_at FROM departments WHERE id = ?',
      [departmentId]
    );
    await recordAudit({
      companyId, actorId: req.user.id, action: existing ? 'department.activate' : 'department.create', entityType: 'department', entityId: departmentId,
      summary: `${existing ? 'Reactivated' : 'Created'} department ${name.trim()}`, after: { name: name.trim(), description: description?.trim() || null },
      departmentIds: [departmentId], subjectIds: [departmentId],
    });

    res.status(201).json(newDepartment);
  } catch (error: any) {
    console.error('Error creating department:', error);
    if (error?.code === '23505') {
      res.status(400).json({ error: 'Department already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create department' });
    }
  }
});

// Update department (Super Admin only)
router.put('/departments/:id', authenticateToken, async (req: any, res) => {
  try {
    const { role, companyId } = req.user;
    const { id } = req.params;
    const { name, description } = req.body;

    if (!isCompanyAdmin(actorOf(req))) {
      return res.status(403).json({ error: 'Only Super Admins can update departments' });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Department name is required' });
    }

    // Check if department exists and belongs to company
    const department = await queryOne<any>(
      'SELECT id, name, description FROM departments WHERE id = ? AND company_id = ?',
      [id, companyId]
    );

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    // Check for duplicate name (excluding current department)
    const existing = await queryOne<any>(
      'SELECT id FROM departments WHERE LOWER(name) = LOWER(?) AND company_id = ? AND id != ? AND is_active = true',
      [name.trim(), companyId, id]
    );

    if (existing) {
      return res.status(400).json({ error: 'Department name already exists' });
    }

    // Update department (recorded in the change history; a rename / new description is undoable)
    const after = { name: name.trim(), description: description?.trim() || null };
    await transaction(async (client) => {
      const exec = execOn(client);
      await exec('UPDATE departments SET name = ?, description = ?, updated_at = NOW() WHERE id = ? AND company_id = ?', [after.name, after.description, id, companyId]);
      if (department.name !== after.name || (department.description ?? null) !== after.description) {
        await recordAudit({
          companyId, actorId: req.user.id, action: 'department.rename', entityType: 'department', entityId: id,
          summary: department.name !== after.name ? `Renamed department ${department.name} to ${after.name}` : `Updated the description of ${after.name}`,
          before: { name: department.name, description: department.description ?? null }, after,
          departmentIds: [id], subjectIds: [id],
        }, exec);
      }
    });

    const updatedDepartment = await queryOne<any>(
      'SELECT id, name, description, company_id, created_at FROM departments WHERE id = ?',
      [id]
    );

    res.json(updatedDepartment);
  } catch (error: any) {
    console.error('Error updating department:', error);
    if (error?.code === '23505') {
      res.status(400).json({ error: 'Department name already exists' });
    } else {
      res.status(500).json({ error: 'Failed to update department' });
    }
  }
});

// Delete department (Super Admin only)
router.delete('/departments/:id', authenticateToken, async (req: any, res) => {
  try {
    const { role, companyId } = req.user;
    const { id } = req.params;

    if (!isCompanyAdmin(actorOf(req))) {
      return res.status(403).json({ error: 'Only Super Admins can delete departments' });
    }

    // Check if department exists and belongs to company
    const department = await queryOne<any>(
      'SELECT id, name FROM departments WHERE id = ? AND company_id = ?',
      [id, companyId]
    );

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    // Check if department has active teams
    const activeTeams = await query<any>(
      'SELECT id, name FROM teams WHERE department_id = ? AND is_active = true',
      [id]
    );

    if (activeTeams.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete department with active teams',
        hasActiveTeams: true,
        teamCount: activeTeams.length,
        teams: activeTeams.slice(0, 5).map((t: any) => t.name)
      });
    }

    // Check if department has active users
    const activeUsers = await query<any>(
      'SELECT id, first_name, last_name FROM users WHERE department_id = ? AND is_active = true',
      [id]
    );

    if (activeUsers.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete department with active users',
        hasActiveUsers: true,
        userCount: activeUsers.length,
        users: activeUsers.slice(0, 5).map((u: any) => `${u.first_name} ${u.last_name}`)
      });
    }

    // Soft delete - deactivate the department
    await query('UPDATE departments SET is_active = false, updated_at = NOW() WHERE id = ? AND company_id = ?', [id, companyId]);
    await recordAudit({
      companyId, actorId: req.user.id, action: 'department.deactivate', entityType: 'department', entityId: id,
      summary: `Deleted (deactivated) department ${department.name}`, before: { is_active: true }, after: { is_active: false },
      departmentIds: [id], subjectIds: [id],
    });

    res.json({ message: 'Department deleted successfully' });
  } catch (error) {
    console.error('Error deleting department:', error);
    res.status(500).json({ error: 'Failed to delete department' });
  }
});

// ============================================
// CONFIGS - hierarchical settings per company/department/team
// ============================================

// Configs are readable by the roles that use them: super_admin / qa_manager (Parameters
// page) and team_lead (SLA thresholds on Performance). Credential-like keys are never
// returned: the merged view omits them and the raw view reports them only as set/not set.
const SECRET_MASK = '__secret_set__';

// Get configs (resolved with the one inheritance rule: team → department → company)
router.get('/configs', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const actor = actorOf(req);
    // super_admin / QA managers (Parameters page) and team leads (SLA thresholds of the teams they lead).
    const isManager = canManageCompanyConfig(actor);
    if (!isManager && !holdsRole(actor, 'team_lead')) return res.status(403).json({ error: 'Insufficient permissions' });
    const { departmentId, teamId } = req.query;
    if (!isManager && teamId && !ledTeamIds(actor).includes(String(teamId))) {
      return res.status(403).json({ error: 'Access denied for this team' });
    }
    const resolved = await resolveConfigs(companyId, {
      teamId: typeof teamId === 'string' ? teamId : null,
      departmentId: typeof departmentId === 'string' ? departmentId : null,
    });
    const configs: Record<string, any> = {};
    for (const [key, cfg] of Object.entries(resolved)) {
      if (!isSecretConfigKey(key)) configs[key] = cfg;
    }
    res.json({ configs });
  } catch (error) {
    console.error('Error fetching configs:', error);
    res.status(500).json({ error: 'Failed to fetch configs' });
  }
});

// Get raw configs for editing (exact scope match). super_admin / qa_manager only.
router.get('/configs/raw', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    if (!canManageCompanyConfig(actorOf(req))) return res.status(403).json({ error: 'Insufficient permissions' });
    const { departmentId, teamId } = req.query;

    let sql = `SELECT * FROM configs WHERE company_id = ?`;
    const params: any[] = [companyId];

    if (teamId && teamId !== 'all') {
      sql += ` AND team_id = ?`;
      params.push(teamId);
    } else if (departmentId && departmentId !== 'all') {
      sql += ` AND department_id = ? AND team_id IS NULL`;
      params.push(departmentId);
    } else {
      sql += ` AND department_id IS NULL AND team_id IS NULL`;
    }

    const configs = await query<any>(sql, params);
    const configMap: Record<string, string> = {};
    for (const cfg of configs) {
      configMap[cfg.config_key] = isSecretConfigKey(cfg.config_key) ? SECRET_MASK : cfg.config_value;
    }
    res.json({ configs: configMap });
  } catch (error) {
    console.error('Error fetching raw configs:', error);
    res.status(500).json({ error: 'Failed to fetch configs' });
  }
});

// Save configs (upsert)
router.post('/configs', authenticateToken, async (req: any, res) => {
  try {
    const { companyId } = req.user;
    const actor = actorOf(req);

    // Only super_admin and QA managers can modify configs; a QA manager only the department /
    // team levels of departments they manage (company-level defaults: as before, any manager).
    if (!canManageCompanyConfig(actor)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { departmentId, teamId, configs, applyToAll } = req.body;

    if (!configs || typeof configs !== 'object' || Array.isArray(configs)) {
      return res.status(400).json({ error: 'Invalid configs format' });
    }

    const deptId = departmentId === 'all' ? null : departmentId || null;
    const tmId = teamId === 'all' ? null : teamId || null;
    let scopeDept: string | null = deptId;
    if (tmId) {
      const t = await queryOne<any>('SELECT department_id FROM teams WHERE id = ? AND company_id = ?', [tmId, companyId]);
      if (!t) return res.status(404).json({ error: 'Team not found' });
      scopeDept = t.department_id;
    } else if (deptId) {
      const d = await queryOne<any>('SELECT id FROM departments WHERE id = ? AND company_id = ?', [deptId, companyId]);
      if (!d) return res.status(404).json({ error: 'Department not found' });
    }
    if (scopeDept && !canManageDepartment(actor, scopeDept)) {
      return res.status(403).json({ error: 'Can only change settings of your department' });
    }
    const applyAll = applyToAll === true && !deptId && !tmId;
    if (applyAll && !isCompanyAdmin(actor)) {
      return res.status(403).json({ error: 'Only a super admin can apply settings to every department' });
    }
    const changes: Record<string, { from: string | null; to: string | null }> = {};

    // The sign-in lifetime has its own endpoint (super admins only, allowed values only).
    if (Object.prototype.hasOwnProperty.call(configs, SESSION_LIFETIME_KEY)) {
      return res.status(400).json({ error: 'Change how long sign-ins last under Parameters → Sign-in (super admins only).' });
    }
    // The same rules as the Parameters page (src/lib/configRules.ts): numbers of 0 or more within
    // their range for the SLA and financial settings; short plain text under a valid key otherwise.
    // Nothing is stored when one value is refused.
    const entries = Object.entries(configs);
    if (entries.length > 100) return res.status(400).json({ error: 'Too many settings in one request (at most 100).' });
    const problems = entries.filter(([, v]) => v !== SECRET_MASK).map(([k, v]) => configValueProblem(k, v)).filter((p): p is string => !!p);
    if (problems.length) return res.status(400).json({ error: problems[0], errors: problems });

    // Upsert each config key. The secret mask means "unchanged" and is never stored.
    for (const [key, value] of Object.entries(configs)) {
      if (value === SECRET_MASK) continue;
      const prev = await queryOne<any>(
        `SELECT config_value FROM configs WHERE company_id = ? AND config_key = ?
          AND (department_id = ? OR (department_id IS NULL AND CAST(? AS TEXT) IS NULL))
          AND (team_id = ? OR (team_id IS NULL AND CAST(? AS TEXT) IS NULL))`,
        [companyId, key, deptId, deptId, tmId, tmId]
      );
      const next = value === null || value === undefined || value === '' ? null : String(value);
      if ((prev?.config_value ?? null) !== next) {
        changes[key] = isSecretConfigKey(key)
          ? { from: prev ? SECRET_MASK : null, to: next === null ? null : SECRET_MASK }
          : { from: prev?.config_value ?? null, to: next };
      }
      if (value === null || value === undefined || value === '') {
        // Delete if empty
        await query(
          `DELETE FROM configs WHERE company_id = ? AND config_key = ? 
           AND (department_id = ? OR (department_id IS NULL AND CAST(? AS TEXT) IS NULL))
           AND (team_id = ? OR (team_id IS NULL AND CAST(? AS TEXT) IS NULL))`,
          [companyId, key, deptId, deptId, tmId, tmId]
        );
      } else {
        // Check if exists
        const existing = await queryOne<any>(
          `SELECT id FROM configs WHERE company_id = ? AND config_key = ?
           AND (department_id = ? OR (department_id IS NULL AND CAST(? AS TEXT) IS NULL))
           AND (team_id = ? OR (team_id IS NULL AND CAST(? AS TEXT) IS NULL))`,
          [companyId, key, deptId, deptId, tmId, tmId]
        );

        if (existing) {
          await query(
            `UPDATE configs SET config_value = ?, updated_at = NOW() WHERE id = ?`,
            [String(value), existing.id]
          );
        } else {
          await query(
            `INSERT INTO configs (id, company_id, department_id, team_id, config_key, config_value)
             VALUES (gen_random_uuid(), ?, ?, ?, ?, ?)`,
            [companyId, deptId, tmId, key, String(value)]
          );
        }
      }
    }

    // Company level with "apply to all": the department and team values of the saved settings are
    // removed, so every department and team follows the company value (super admins only).
    let replaced = 0;
    const replacedKeys: string[] = [];
    if (applyAll) {
      for (const key of Object.keys(configs)) {
        const rows = await query<any>(
          `DELETE FROM configs WHERE company_id = ? AND config_key = ? AND (department_id IS NOT NULL OR team_id IS NOT NULL)
           RETURNING id`,
          [companyId, key]
        );
        if (rows.length) { replaced += rows.length; replacedKeys.push(key); }
      }
    }

    if (!deptId && !tmId && (replaced > 0 || !Object.keys(changes).length)) {
      // Recorded even without a change: confirming the company-wide settings completes that
      // onboarding step (server/lib/onboarding.ts).
      await recordAudit({
        companyId, actorId: actor.id, action: replaced > 0 ? 'config.apply_all' : 'config.confirm', entityType: 'config', entityId: companyId,
        summary: replaced > 0
          ? `Applied company-wide settings to every department and team (replaced ${replaced} department/team value${replaced === 1 ? '' : 's'}: ${replacedKeys.slice(0, 4).join(', ')})`
          : 'Confirmed the company-wide settings',
        departmentIds: [], subjectIds: [`company:${companyId}`],
      });
    }

    if (Object.keys(changes).length) {
      await recordAudit({
        companyId, actorId: actor.id, action: 'config.update', entityType: 'config', entityId: tmId ?? deptId ?? companyId,
        summary: `Changed ${Object.keys(changes).length} setting${Object.keys(changes).length === 1 ? '' : 's'} (${tmId ? 'team' : deptId ? 'department' : 'company'} level): ${Object.keys(changes).slice(0, 4).join(', ')}`,
        before: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.from])),
        after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])),
        departmentIds: [scopeDept], subjectIds: [tmId ?? deptId ?? `company:${companyId}`],
      });
    }
    res.json({ message: 'Configs saved successfully', replaced });
  } catch (error) {
    console.error('Error saving configs:', error);
    res.status(500).json({ error: 'Failed to save configs' });
  }
});

// ============================================================================
// API KEYS (KPI ingestion) — super_admin only, scoped to the caller's company.
// The plaintext key is returned once, on creation; only its sha256 hash is stored.
// ============================================================================

const apiKeyRow = (k: any) => ({
  id: k.id,
  name: k.name,
  keyPrefix: k.key_prefix,
  createdAt: k.created_at,
  createdBy: k.created_by_name ?? null,
  lastUsedAt: k.last_used_at ?? null,
  revokedAt: k.revoked_at ?? null
});

router.get('/api-keys', authenticateToken, async (req: any, res) => {
  try {
    if (!isCompanyAdmin(actorOf(req))) return res.status(403).json({ error: 'Super admin access required' });
    const keys = await query<any>(
      `SELECT k.id, k.name, k.key_prefix, k.created_at, k.last_used_at, k.revoked_at,
              NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS created_by_name
         FROM api_keys k
         LEFT JOIN users u ON u.id = k.created_by
        WHERE k.company_id = ?
        ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`,
      [req.user.companyId]
    );
    res.json({ keys: keys.map(apiKeyRow) });
  } catch (error) {
    console.error('List API keys error:', error);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

router.post('/api-keys', authenticateToken, async (req: any, res) => {
  try {
    if (!isCompanyAdmin(actorOf(req))) return res.status(403).json({ error: 'Super admin access required' });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 100) return res.status(400).json({ error: 'Name is required (max 100 characters)' });
    const { key, prefix, hash } = generateApiKey();
    const row = await queryOne<any>(
      `INSERT INTO api_keys (company_id, name, key_prefix, key_hash, created_by)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id, name, key_prefix, created_at, last_used_at, revoked_at`,
      [req.user.companyId, name, prefix, hash, req.user.id]
    );
    await recordAudit({
      companyId: req.user.companyId, actorId: req.user.id, action: 'api_key.create', entityType: 'api_key', entityId: row.id,
      summary: `Created API key ${name} (${prefix}…)`, after: { name, keyPrefix: prefix }, subjectIds: [row.id],
    });
    res.status(201).json({ key: apiKeyRow(row), plaintextKey: key });
  } catch (error) {
    console.error('Create API key error:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

router.post('/api-keys/:id/revoke', authenticateToken, async (req: any, res) => {
  try {
    if (!isCompanyAdmin(actorOf(req))) return res.status(403).json({ error: 'Super admin access required' });
    const row = await queryOne<any>(
      `UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = ? AND company_id = ?
        RETURNING id, name, key_prefix, created_at, last_used_at, revoked_at`,
      [req.params.id, req.user.companyId]
    );
    if (!row) return res.status(404).json({ error: 'API key not found' });
    await recordAudit({
      companyId: req.user.companyId, actorId: req.user.id, action: 'api_key.revoke', entityType: 'api_key', entityId: row.id,
      summary: `Revoked API key ${row.name} (${row.key_prefix}…)`, subjectIds: [row.id],
    });
    res.json({ key: apiKeyRow(row) });
  } catch (error) {
    console.error('Revoke API key error:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

export default router;
