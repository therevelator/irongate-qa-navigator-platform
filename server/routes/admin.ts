import express from 'express';
import bcrypt from 'bcrypt';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken } from '../middleware/auth';
import { generateApiKey } from '../middleware/apiKey';
import { randomUUID } from 'crypto';
import {
  ROLE_HIERARCHY, TEAM_OPTIONAL_ROLES, canAssignRole, canManageUser, canEditUser, canEditAssignment,
  canResetPassword, canDeleteUser, type PolicyActor
} from '../lib/userPolicy';
import { syncPrimaryTeamMembership, teamMemberCountSql, teamLeadNameSql } from '../lib/teamMembership';
import { resolveConfigs, isSecretConfigKey } from '../lib/configResolver';
import { planTeamDepartmentMove, applyTeamDepartmentMove } from '../lib/teamDepartment';

const router = express.Router();

// User-management rules live in server/lib/userPolicy.ts (shared with the Users and
// Teams pages, so the UI only offers what the server allows).
const actorOf = (req: any): PolicyActor => ({
  id: req.user.id,
  role: req.user.role,
  departmentId: req.user.departmentId ?? null,
  primaryTeamId: req.user.primaryTeamId ?? null,
});

async function loadTarget(userId: string, companyId: string) {
  return queryOne<any>(
    'SELECT id, role, email, department_id, primary_team_id, is_active FROM users WHERE id = ? AND company_id = ?',
    [userId, companyId]
  );
}

const USER_LIST_COLUMNS = `u.id, u.email, u.first_name, u.last_name, u.role, u.company_id,
  u.department_id, u.primary_team_id, u.is_active, u.created_at, u.developer_insights_enabled,
  t.name as team_name, d.name as department_name,
  ARRAY(
    SELECT DISTINCT x.team_id FROM (
      SELECT tm.team_id FROM team_members tm WHERE tm.user_id = u.id
      UNION SELECT u.primary_team_id WHERE u.primary_team_id IS NOT NULL
    ) x
  ) AS team_ids`;

// Get users based on role permissions
router.get('/users', authenticateToken, async (req: any, res) => {
  try {
    const { role, id: userId, companyId, departmentId, primaryTeamId } = req.user;
    const base = `SELECT ${USER_LIST_COLUMNS}
         FROM users u
         LEFT JOIN teams t ON u.primary_team_id = t.id
         LEFT JOIN departments d ON u.department_id = d.id
         WHERE u.company_id = ?`;

    let users;
    if (role === 'super_admin') {
      users = await query<any>(`${base} ORDER BY u.created_at DESC`, [companyId]);
    } else if (role === 'qa_manager') {
      // Their department (the users they can manage), plus themselves.
      users = await query<any>(`${base} AND (u.department_id = ? OR u.id = ?) ORDER BY u.created_at DESC`, [companyId, departmentId ?? null, userId]);
    } else if (role === 'team_lead') {
      // Their own team, plus themselves.
      users = await query<any>(`${base} AND (u.primary_team_id = ? OR u.id = ?) ORDER BY u.created_at DESC`, [companyId, primaryTeamId ?? null, userId]);
    } else {
      users = await query<any>(`${base} AND u.id = ?`, [companyId, userId]);
    }
    res.json(users);
  } catch (error: any) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create user (role-based)
router.post('/users', authenticateToken, async (req: any, res) => {
  try {
    const actor = actorOf(req);
    const { companyId } = req.user;
    const { email, password, firstName, lastName, role } = req.body ?? {};
    let teamId: string | null = req.body?.teamId || null;
    let departmentId: string | null = req.body?.departmentId || null;

    if (!email || !password || !firstName || !lastName || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!canAssignRole(actor.role, role)) {
      return res.status(403).json({ error: `${actor.role} cannot create ${role} users` });
    }

    // Scope: a team lead creates users on their own team only; a manager in their department.
    if (actor.role === 'team_lead') {
      if (teamId && teamId !== actor.primaryTeamId) {
        return res.status(403).json({ error: 'Team leads can only add users to their own team' });
      }
      teamId = actor.primaryTeamId ?? null;
      departmentId = actor.departmentId ?? null;
    }
    if (!teamId && !TEAM_OPTIONAL_ROLES.includes(role)) {
      return res.status(400).json({ error: 'A primary team is required for this role' });
    }

    if (teamId) {
      const team = await queryOne<any>('SELECT department_id FROM teams WHERE id = ? AND company_id = ? AND is_active = TRUE', [teamId, companyId]);
      if (!team) return res.status(400).json({ error: 'Invalid team ID' });
      if (departmentId && team.department_id !== departmentId) {
        return res.status(400).json({ error: 'Team must be in the specified department' });
      }
      departmentId = team.department_id;
    }
    if (actor.role === 'qa_manager') {
      departmentId = departmentId || actor.departmentId || null;
      if (departmentId !== actor.departmentId) {
        return res.status(403).json({ error: 'Can only add users to your department' });
      }
    }
    if (!departmentId) {
      return res.status(400).json({ error: 'Department ID is required' });
    }
    const dept = await queryOne<any>('SELECT id FROM departments WHERE id = ? AND company_id = ? AND is_active = TRUE', [departmentId, companyId]);
    if (!dept) return res.status(400).json({ error: 'Invalid department ID' });

    const existingUser = await queryOne<any>('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email]);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = randomUUID();
    await query<any>(
      `INSERT INTO users (
        id, email, password_hash, first_name, last_name, role,
        company_id, department_id, primary_team_id, created_by, is_active, email_verified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, true)`,
      [userId, email, passwordHash, firstName, lastName, role, companyId, departmentId, teamId, actor.id]
    );
    await syncPrimaryTeamMembership(userId, null, teamId, role);

    const newUser = await queryOne<any>(
      `SELECT ${USER_LIST_COLUMNS}
       FROM users u
       LEFT JOIN teams t ON u.primary_team_id = t.id
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = ?`,
      [userId]
    );
    res.status(201).json(newUser);
  } catch (error: any) {
    console.error('Error creating user:', error);
    if (error?.code === '23505') return res.status(400).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user. Self: name and email only. Others: super_admin / qa_manager for users they
// can manage; a changed role must be one they may assign. Fields not sent keep their value.
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
    if (assignmentChanged) {
      if (!canEditAssignment(actor, target)) {
        return res.status(403).json({ error: 'You cannot change your own role, department or team' });
      }
      if (role !== target.role && !canAssignRole(actor.role, role)) {
        return res.status(403).json({ error: `${actor.role} cannot assign the ${role} role` });
      }
      if (actor.role === 'qa_manager' && departmentId !== actor.departmentId) {
        return res.status(403).json({ error: 'Can only assign users to your department' });
      }
      if (!departmentId) return res.status(400).json({ error: 'Department is required' });
      const dept = await queryOne<any>('SELECT id FROM departments WHERE id = ? AND company_id = ?', [departmentId, companyId]);
      if (!dept) return res.status(400).json({ error: 'Invalid department ID' });
      if (primaryTeamId) {
        const team = await queryOne<any>('SELECT department_id FROM teams WHERE id = ? AND company_id = ?', [primaryTeamId, companyId]);
        if (!team) return res.status(400).json({ error: 'Invalid team ID' });
        if (team.department_id !== departmentId) return res.status(400).json({ error: 'Team must be in the selected department' });
      } else if (!TEAM_OPTIONAL_ROLES.includes(role)) {
        return res.status(400).json({ error: 'A primary team is required for this role' });
      }
    }
    if (email !== undefined) {
      const clash = await queryOne<any>('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?', [email, target.id]);
      if (clash) return res.status(400).json({ error: 'Email already registered' });
    }

    await query(
      `UPDATE users
       SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), email = COALESCE(?, email),
           role = ?, department_id = ?, primary_team_id = ?, updated_at = NOW()
       WHERE id = ? AND company_id = ?`,
      [firstName ?? null, lastName ?? null, email ?? null, role, departmentId, primaryTeamId, target.id, companyId]
    );
    await syncPrimaryTeamMembership(target.id, target.primary_team_id, primaryTeamId, role);

    const updatedUser = await queryOne<any>(
      `SELECT ${USER_LIST_COLUMNS}
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN teams t ON u.primary_team_id = t.id
       WHERE u.id = ?`,
      [target.id]
    );
    res.json(updatedUser);
  } catch (error: any) {
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
    await query('UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ? AND company_id = ?', [newStatus, target.id, companyId]);
    res.json({ message: `User ${newStatus ? 'activated' : 'deactivated'} successfully`, is_active: newStatus });
  } catch (error: any) {
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
    res.json({ success: true, developer_insights_enabled: enabled });
  } catch (error: any) {
    console.error('Error toggling developer insights:', error);
    res.status(500).json({ error: 'Failed to toggle developer insights' });
  }
});

// Toggle team active status
router.post('/teams/:id/toggle-status', authenticateToken, async (req: any, res) => {
  try {
    const { role: userRole, companyId, departmentId: userDeptId } = req.user;
    const { id: teamId } = req.params;

    // Only Super Admin and QA Manager can toggle team status
    if (userRole !== 'super_admin' && userRole !== 'qa_manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Get team to check department and current status
    const existingTeam = await queryOne<any>('SELECT department_id, is_active FROM teams WHERE id = ? AND company_id = ?', [teamId, companyId]);
    if (!existingTeam) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // QA Manager can only toggle teams in their department
    if (userRole === 'qa_manager' && existingTeam.department_id !== userDeptId) {
      return res.status(403).json({ error: 'Can only manage teams in your department' });
    }

    // Toggle the status
    const newStatus = !existingTeam.is_active;
    await query(
      'UPDATE teams SET is_active = ?, updated_at = NOW() WHERE id = ? AND company_id = ?',
      [newStatus, teamId, companyId]
    );

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
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const target = await loadTarget(req.params.id, companyId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!canResetPassword(actorOf(req), target)) {
      return res.status(403).json({ error: 'You cannot reset this user\'s password' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ? AND company_id = ?', [passwordHash, target.id, companyId]);
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
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
    const { role, companyId, departmentId: userDepartmentId } = req.user;
    const { name, description, departmentId: requestDepartmentId } = req.body;

    // Only QA Manager and Super Admin can create teams
    if (role !== 'qa_manager' && role !== 'super_admin') {
      return res.status(403).json({ error: 'Only QA Managers and Super Admins can create teams' });
    }

    if (!name) {
      return res.status(400).json({ error: 'Team name is required' });
    }

    // Determine department ID
    // Super admin can specify department, others use their own
    let targetDepartmentId;
    if (role === 'super_admin') {
      targetDepartmentId = requestDepartmentId || userDepartmentId;
      if (!targetDepartmentId) {
        return res.status(400).json({ error: 'Department is required' });
      }
    } else {
      targetDepartmentId = userDepartmentId;
    }

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

    res.status(201).json(newTeam);
  } catch (error) {
    console.error('Error creating team:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// Update team
router.put('/teams/:id', authenticateToken, async (req: any, res) => {
  try {
    const { role, companyId, departmentId: userDeptId } = req.user;
    const { id: teamId } = req.params;
    const { name, description } = req.body;

    // Only Super Admin and QA Manager can update teams
    if (role !== 'super_admin' && role !== 'qa_manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Get team to check department — scoped to the caller's company.
    const team = await queryOne<any>('SELECT department_id FROM teams WHERE id = ? AND company_id = ?', [teamId, companyId]);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // QA Manager can only update teams in their department
    if (role === 'qa_manager' && team.department_id !== userDeptId) {
      return res.status(403).json({ error: 'Can only update teams in your department' });
    }

    await query(
      'UPDATE teams SET name = ?, description = ? WHERE id = ? AND company_id = ?',
      [name, description, teamId, companyId]
    );

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
    const { role, companyId } = req.user;
    if (role !== 'super_admin') {
      return res.status(403).json({ error: 'Only Super Admins can move teams between departments' });
    }
    const { departmentId, dryRun } = req.body ?? {};
    const result = await planTeamDepartmentMove(companyId, req.params.id, departmentId);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    const { plan } = result;
    if (dryRun === true) return res.json({ dryRun: true, ...plan });

    const movedUserIds = await applyTeamDepartmentMove(companyId, plan);
    res.json({ ...plan, movedUserIds, message: `${plan.team.name} moved to ${plan.to.name}` });
  } catch (error: any) {
    if (error?.status === 409) return res.status(409).json({ error: 'The team was changed by someone else. Refresh and try again.' });
    if (error?.code === '23505') return res.status(409).json({ error: 'The target department already has a team with this name' });
    console.error('Error moving team:', error);
    res.status(500).json({ error: 'Failed to move team' });
  }
});

// Delete team
router.delete('/teams/:id', authenticateToken, async (req: any, res) => {
  try {
    const { role, companyId, departmentId: userDeptId } = req.user;
    const { id: teamId } = req.params;

    // Only Super Admin and QA Manager can delete teams
    if (role !== 'super_admin' && role !== 'qa_manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Get team to check department — scoped to the caller's company.
    const team = await queryOne<any>('SELECT department_id FROM teams WHERE id = ? AND company_id = ?', [teamId, companyId]);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // QA Manager can only delete teams in their department
    if (role === 'qa_manager' && team.department_id !== userDeptId) {
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
    await query('UPDATE users SET is_active = false, updated_at = NOW() WHERE id = ? AND company_id = ?', [target.id, companyId]);
    res.json({ message: 'User deactivated successfully', deactivated: true });
  } catch (error: any) {
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

    if (role !== 'super_admin') {
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
    if (role !== 'super_admin') {
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
    const managers = await query<any>(
      `SELECT id, TRIM(first_name || ' ' || last_name) AS name, email FROM users
        WHERE company_id = ? AND department_id = ? AND role = 'qa_manager' AND is_active = TRUE
        ORDER BY first_name, last_name`,
      [companyId, department.id]
    );
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

    if (role !== 'super_admin') {
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

    if (role !== 'super_admin') {
      return res.status(403).json({ error: 'Only Super Admins can update departments' });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Department name is required' });
    }

    // Check if department exists and belongs to company
    const department = await queryOne<any>(
      'SELECT id FROM departments WHERE id = ? AND company_id = ?',
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

    // Update department
    await query(
      'UPDATE departments SET name = ?, description = ? WHERE id = ? AND company_id = ?',
      [name.trim(), description?.trim() || null, id, companyId]
    );

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

    if (role !== 'super_admin') {
      return res.status(403).json({ error: 'Only Super Admins can delete departments' });
    }

    // Check if department exists and belongs to company
    const department = await queryOne<any>(
      'SELECT id FROM departments WHERE id = ? AND company_id = ?',
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
const CONFIG_READ_ROLES = ['super_admin', 'qa_manager', 'team_lead'];
const SECRET_MASK = '__secret_set__';

// Get configs (resolved with the one inheritance rule: team → department → company)
router.get('/configs', authenticateToken, async (req: any, res) => {
  try {
    const { companyId, role } = req.user;
    if (!CONFIG_READ_ROLES.includes(role)) return res.status(403).json({ error: 'Insufficient permissions' });
    const { departmentId, teamId } = req.query;
    if (role === 'team_lead' && teamId && teamId !== req.user.primaryTeamId) {
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
    const { companyId, role } = req.user;
    if (role !== 'super_admin' && role !== 'qa_manager') return res.status(403).json({ error: 'Insufficient permissions' });
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
    const { companyId, role } = req.user;
    
    // Only super_admin and manager can modify configs
    if (role !== 'super_admin' && role !== 'qa_manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { departmentId, teamId, configs } = req.body;

    if (!configs || typeof configs !== 'object') {
      return res.status(400).json({ error: 'Invalid configs format' });
    }

    const deptId = departmentId === 'all' ? null : departmentId || null;
    const tmId = teamId === 'all' ? null : teamId || null;

    // Upsert each config key. The secret mask means "unchanged" and is never stored.
    for (const [key, value] of Object.entries(configs)) {
      if (value === SECRET_MASK) continue;
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

    res.json({ message: 'Configs saved successfully' });
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
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Super admin access required' });
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
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Super admin access required' });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 100) return res.status(400).json({ error: 'Name is required (max 100 characters)' });
    const { key, prefix, hash } = generateApiKey();
    const row = await queryOne<any>(
      `INSERT INTO api_keys (company_id, name, key_prefix, key_hash, created_by)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id, name, key_prefix, created_at, last_used_at, revoked_at`,
      [req.user.companyId, name, prefix, hash, req.user.id]
    );
    res.status(201).json({ key: apiKeyRow(row), plaintextKey: key });
  } catch (error) {
    console.error('Create API key error:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

router.post('/api-keys/:id/revoke', authenticateToken, async (req: any, res) => {
  try {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Super admin access required' });
    const row = await queryOne<any>(
      `UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = ? AND company_id = ?
        RETURNING id, name, key_prefix, created_at, last_used_at, revoked_at`,
      [req.params.id, req.user.companyId]
    );
    if (!row) return res.status(404).json({ error: 'API key not found' });
    res.json({ key: apiKeyRow(row) });
  } catch (error) {
    console.error('Revoke API key error:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

export default router;
