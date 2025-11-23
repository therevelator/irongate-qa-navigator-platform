import express from 'express';
import bcrypt from 'bcrypt';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

// Role hierarchy and permissions
const ROLE_HIERARCHY = {
  super_admin: ['manager', 'team_lead', 'qa_engineer', 'viewer'],
  manager: ['team_lead', 'qa_engineer', 'viewer'],
  team_lead: ['qa_engineer', 'viewer'],
  qa_engineer: [],
  viewer: []
};

// Permission levels for each role
const ROLE_PERMISSIONS = {
  super_admin: {
    departments: { create: true, read: true, update: true, delete: true },
    teams: { create: true, read: true, update: true, delete: true },
    users: { create: true, read: true, update: true, delete: true },
    resetPassword: true,
    advancedFeatures: true
  },
  manager: {
    departments: { create: false, read: true, update: false, delete: false },
    teams: { create: true, read: true, update: true, delete: true },
    users: { create: true, read: true, update: true, delete: true },
    resetPassword: true,
    advancedFeatures: true
  },
  team_lead: {
    departments: { create: false, read: true, update: false, delete: false },
    teams: { create: true, read: true, update: true, delete: false },
    users: { create: true, read: true, update: true, delete: false },
    resetPassword: true,
    advancedFeatures: true
  },
  qa_engineer: {
    departments: { create: false, read: true, update: false, delete: false },
    teams: { create: false, read: true, update: false, delete: false },
    users: { create: false, read: true, update: false, delete: false },
    resetPassword: true, // Only their own
    advancedFeatures: true // Can see metrics but not generate reports
  },
  viewer: {
    departments: { create: false, read: true, update: false, delete: false },
    teams: { create: false, read: true, update: false, delete: false },
    users: { create: false, read: true, update: false, delete: false },
    resetPassword: false,
    advancedFeatures: false
  }
};

// Check if user can create a specific role
function canCreateRole(userRole: string, targetRole: string): boolean {
  return ROLE_HIERARCHY[userRole as keyof typeof ROLE_HIERARCHY]?.includes(targetRole) || false;
}

// Check if user can manage another user (created by them or themselves)
async function canManageUser(managerId: string, targetUserId: string): Promise<boolean> {
  if (managerId === targetUserId) return true; // Can manage self
  
  const targetUser = await queryOne<any>(
    'SELECT created_by FROM users WHERE id = ?',
    [targetUserId]
  );
  
  return targetUser?.created_by === managerId;
}

// Get users based on role permissions
router.get('/users', authenticateToken, async (req: any, res) => {
  try {
    const { role, id: userId, companyId, primaryTeamId } = req.user;

    let users;

    if (role === 'super_admin') {
      // Super admin sees all users in their company
      users = await query<any>(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.company_id, 
                u.department_id, u.primary_team_id, u.is_active, u.created_at,
                t.name as team_name, d.name as department_name
         FROM users u
         LEFT JOIN teams t ON u.primary_team_id = t.id
         LEFT JOIN departments d ON u.department_id = d.id
         WHERE u.company_id = ?
         ORDER BY u.created_at DESC`,
        [companyId]
      );
    } else if (role === 'manager') {
      // Manager sees users in their department
      users = await query<any>(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.company_id, 
                u.department_id, u.primary_team_id, u.is_active, u.created_at,
                t.name as team_name, d.name as department_name
         FROM users u
         LEFT JOIN teams t ON u.primary_team_id = t.id
         LEFT JOIN departments d ON u.department_id = d.id
         WHERE u.company_id = ? AND (u.created_by = ? OR u.department_id = (
           SELECT department_id FROM users WHERE id = ?
         ))
         ORDER BY u.created_at DESC`,
        [companyId, userId, userId]
      );
    } else if (role === 'team_lead') {
      // Team Lead sees users in their department
      users = await query<any>(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.company_id, 
                u.department_id, u.primary_team_id, u.is_active, u.created_at,
                t.name as team_name, d.name as department_name
         FROM users u
         LEFT JOIN teams t ON u.primary_team_id = t.id
         LEFT JOIN departments d ON u.department_id = d.id
         WHERE u.department_id = (SELECT department_id FROM users WHERE id = ?)
         ORDER BY u.created_at DESC`,
        [userId]
      );
    } else {
      // QA Engineer and Viewer see only themselves
      users = await query<any>(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.company_id, 
                u.department_id, u.primary_team_id, u.is_active, u.created_at,
                t.name as team_name, d.name as department_name
         FROM users u
         LEFT JOIN teams t ON u.primary_team_id = t.id
         LEFT JOIN departments d ON u.department_id = d.id
         WHERE u.id = ?`,
        [userId]
      );
    }

    res.json(users);
  } catch (error: any) {
    console.error('Error fetching users:', error);
    res.status(500).json({ 
      error: 'Failed to fetch users',
      details: error.message || String(error)
    });
  }
});

// Create user (role-based)
router.post('/users', authenticateToken, async (req: any, res) => {
  try {
    const { role: creatorRole, id: creatorId, companyId, departmentId } = req.user;
    const { email, password, firstName, lastName, role, teamId, departmentId: targetDeptId } = req.body;

    // Validate required fields
    if (!email || !password || !firstName || !lastName || !role || !teamId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if creator can create this role
    if (!canCreateRole(creatorRole, role)) {
      return res.status(403).json({ 
        error: `${creatorRole} cannot create ${role} users` 
      });
    }

    // Check if user already exists
    const existingUser = await queryOne<any>(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Determine department and validate team assignment
    let finalDeptId = targetDeptId || departmentId;
    
    if (!finalDeptId) {
      return res.status(400).json({ error: 'Department ID is required' });
    }

    // Get team to validate department
    const team = await queryOne<any>(
      'SELECT department_id FROM teams WHERE id = ?',
      [teamId]
    );

    if (!team) {
      return res.status(400).json({ error: 'Invalid team ID' });
    }

    // QA Manager can only assign users to teams in their department
    if (creatorRole === 'manager') {
      if (team.department_id !== departmentId) {
        return res.status(403).json({ 
          error: 'Can only assign users to teams in your department' 
        });
      }
      finalDeptId = departmentId; // Force QA Manager's department
    }

    // Super Admin can assign to any department, but team must match
    if (creatorRole === 'super_admin' && targetDeptId && team.department_id !== targetDeptId) {
      return res.status(400).json({ 
        error: 'Team must be in the specified department' 
      });
    }

    // Generate UUID for user
    const userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Insert user
    await query<any>(
      `INSERT INTO users (
        id, email, password_hash, first_name, last_name, role,
        company_id, department_id, primary_team_id, created_by, is_active, email_verified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, true)`,
      [userId, email, passwordHash, firstName, lastName, role, companyId, finalDeptId, teamId, creatorId]
    );

    // Add to team_members
    await query(
      'INSERT INTO team_members (user_id, team_id, role) VALUES (?, ?, ?)',
      [userId, teamId, role === 'team_lead' ? 'lead' : 'member']
    );

    // Fetch created user
    const newUser = await queryOne<any>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.company_id, 
              u.department_id, u.primary_team_id, u.is_active, u.created_at,
              t.name as team_name, d.name as department_name
       FROM users u
       LEFT JOIN teams t ON u.primary_team_id = t.id
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = ?`,
      [userId]
    );

    res.status(201).json(newUser);
  } catch (error: any) {
    console.error('Error creating user:', error);
    res.status(500).json({ 
      error: 'Failed to create user',
      details: error.message || String(error)
    });
  }
});

// Reset password (for users you created or yourself)
router.post('/users/:id/reset-password', authenticateToken, async (req: any, res) => {
  try {
    const { id: managerId } = req.user;
    const { id: targetUserId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user can manage this user
    const canManage = await canManageUser(managerId, targetUserId);
    if (!canManage) {
      return res.status(403).json({ error: 'You can only reset passwords for users you created or yourself' });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    await query(
      'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?',
      [passwordHash, targetUserId]
    );

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Get all teams (with department names)
router.get('/teams', authenticateToken, async (req: any, res) => {
  try {
    const { role, companyId, departmentId } = req.user;

    let teams;
    
    if (role === 'super_admin') {
      // Super admin sees all teams in their company
      teams = await query<any>(
        `SELECT t.*, d.name as department_name 
         FROM teams t 
         LEFT JOIN departments d ON t.department_id = d.id 
         WHERE t.company_id = ? 
         ORDER BY t.created_at DESC`,
        [companyId]
      );
    } else if (role === 'manager' || role === 'team_lead') {
      // Manager and Team Lead see teams in their department
      teams = await query<any>(
        `SELECT t.*, d.name as department_name 
         FROM teams t 
         LEFT JOIN departments d ON t.department_id = d.id 
         WHERE t.company_id = ? AND t.department_id = ? 
         ORDER BY t.created_at DESC`,
        [companyId, departmentId]
      );
    } else {
      // Other roles don't have access to teams list
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

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
    if (role !== 'manager' && role !== 'super_admin') {
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

    // Generate UUID for team
    const teamId = `team-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Insert team
    await query<any>(
      `INSERT INTO teams (id, company_id, department_id, name, description, is_active)
       VALUES (?, ?, ?, ?, ?, true)`,
      [teamId, companyId, targetDepartmentId, name, description || '']
    );

    // Fetch created team
    const newTeam = await queryOne<any>(
      'SELECT * FROM teams WHERE id = ?',
      [teamId]
    );

    res.status(201).json(newTeam);
  } catch (error) {
    console.error('Error creating team:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// Update team
router.put('/teams/:id', authenticateToken, async (req: any, res) => {
  try {
    const { role, departmentId: userDeptId } = req.user;
    const { id: teamId } = req.params;
    const { name, description, platform } = req.body;

    // Only Super Admin and QA Manager can update teams
    if (role !== 'super_admin' && role !== 'manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Get team to check department
    const team = await queryOne<any>('SELECT department_id FROM teams WHERE id = ?', [teamId]);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // QA Manager can only update teams in their department
    if (role === 'manager' && team.department_id !== userDeptId) {
      return res.status(403).json({ error: 'Can only update teams in your department' });
    }

    await query(
      'UPDATE teams SET name = ?, description = ?, platform = ? WHERE id = ?',
      [name, description, platform, teamId]
    );

    const updatedTeam = await queryOne<any>('SELECT * FROM teams WHERE id = ?', [teamId]);
    res.json(updatedTeam);
  } catch (error: any) {
    console.error('Error updating team:', error);
    res.status(500).json({ error: 'Failed to update team', details: error.message });
  }
});

// Delete team
router.delete('/teams/:id', authenticateToken, async (req: any, res) => {
  try {
    const { role, departmentId: userDeptId } = req.user;
    const { id: teamId } = req.params;

    // Only Super Admin and QA Manager can delete teams
    if (role !== 'super_admin' && role !== 'manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Get team to check department
    const team = await queryOne<any>('SELECT department_id FROM teams WHERE id = ?', [teamId]);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // QA Manager can only delete teams in their department
    if (role === 'manager' && team.department_id !== userDeptId) {
      return res.status(403).json({ error: 'Can only delete teams in your department' });
    }

    // Check if team has members
    const memberCount = await queryOne<any>(
      'SELECT COUNT(*) as count FROM team_members WHERE team_id = ?',
      [teamId]
    );

    if (memberCount && memberCount.count > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete team with members',
        warning: `Team has ${memberCount.count} member(s). Remove all members before deleting.`
      });
    }

    await query('DELETE FROM teams WHERE id = ?', [teamId]);
    res.json({ message: 'Team deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting team:', error);
    res.status(500).json({ error: 'Failed to delete team', details: error.message });
  }
});

// Delete user
router.delete('/users/:id', authenticateToken, async (req: any, res) => {
  try {
    const { role, id: userId, departmentId: userDeptId } = req.user;
    const { id: targetUserId } = req.params;

    // QA Engineers cannot delete users (including themselves)
    if (role === 'qa_engineer' || role === 'viewer') {
      return res.status(403).json({ error: 'Insufficient permissions to delete users' });
    }

    // Get target user
    const targetUser = await queryOne<any>(
      'SELECT role, department_id, created_by FROM users WHERE id = ?',
      [targetUserId]
    );

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Super Admin can delete any user except themselves
    if (role === 'super_admin') {
      if (userId === targetUserId) {
        return res.status(403).json({ error: 'Cannot delete your own account' });
      }
    }
    // QA Manager can delete users in their department that they created
    else if (role === 'manager') {
      if (targetUser.department_id !== userDeptId) {
        return res.status(403).json({ error: 'Can only delete users in your department' });
      }
      if (targetUser.created_by !== userId) {
        return res.status(403).json({ error: 'Can only delete users you created' });
      }
    }
    // Team Lead can delete users they created
    else if (role === 'team_lead') {
      if (targetUser.created_by !== userId) {
        return res.status(403).json({ error: 'Can only delete users you created' });
      }
    }

    // Delete user from team_members first
    await query('DELETE FROM team_members WHERE user_id = ?', [targetUserId]);
    
    // Delete user
    await query('DELETE FROM users WHERE id = ?', [targetUserId]);
    
    res.json({ message: 'User deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user', details: error.message });
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

// Get departments based on user role
router.get('/departments', authenticateToken, async (req: any, res) => {
  try {
    const { role, companyId, departmentId } = req.user;

    let departments;

    if (role === 'super_admin') {
      // Super admin sees all departments in their company
      departments = await query<any>(
        'SELECT id, name, company_id, created_at FROM departments WHERE company_id = ? ORDER BY name',
        [companyId]
      );
    } else {
      // All other roles see only their department
      departments = await query<any>(
        'SELECT id, name, company_id, created_at FROM departments WHERE id = ? AND company_id = ?',
        [departmentId, companyId]
      );
    }

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

    const departments = await query<any>(
      'SELECT id, name, description, company_id, created_at FROM departments WHERE company_id = ? ORDER BY name',
      [companyId]
    );

    res.json(departments);
  } catch (error) {
    console.error('Error fetching all departments:', error);
    res.status(500).json({ error: 'Failed to fetch departments' });
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

    // Check for duplicate name
    const existing = await queryOne<any>(
      'SELECT id FROM departments WHERE name = ? AND company_id = ?',
      [name.trim(), companyId]
    );

    if (existing) {
      return res.status(400).json({ error: 'Department name already exists' });
    }

    // Generate unique ID
    const departmentId = `dept-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    // Insert department
    await query(
      'INSERT INTO departments (id, name, description, company_id) VALUES (?, ?, ?, ?)',
      [departmentId, name.trim(), description?.trim() || null, companyId]
    );

    const newDepartment = await queryOne<any>(
      'SELECT id, name, description, company_id, created_at FROM departments WHERE id = ?',
      [departmentId]
    );

    res.status(201).json(newDepartment);
  } catch (error: any) {
    console.error('Error creating department:', error);
    if (error.code === 'ER_DUP_ENTRY') {
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
      'SELECT id FROM departments WHERE name = ? AND company_id = ? AND id != ?',
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
    if (error.code === 'ER_DUP_ENTRY') {
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

    // Check if department has teams
    const teams = await query<any>(
      'SELECT id FROM teams WHERE department_id = ?',
      [id]
    );

    if (teams.length > 0) {
      return res.status(400).json({ error: 'Cannot delete department with existing teams' });
    }

    // Check if department has users
    const users = await query<any>(
      'SELECT id FROM users WHERE department_id = ?',
      [id]
    );

    if (users.length > 0) {
      return res.status(400).json({ error: 'Cannot delete department with assigned users' });
    }

    // Delete department
    await query('DELETE FROM departments WHERE id = ? AND company_id = ?', [id, companyId]);

    res.json({ message: 'Department deleted successfully' });
  } catch (error) {
    console.error('Error deleting department:', error);
    res.status(500).json({ error: 'Failed to delete department' });
  }
});

// Get permissions for current user's role
router.get('/permissions', authenticateToken, async (req: any, res) => {
  try {
    const { role } = req.user;
    const permissions = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS] || ROLE_PERMISSIONS.viewer;
    
    res.json({
      role,
      permissions,
      availableRoles: ROLE_HIERARCHY[role as keyof typeof ROLE_HIERARCHY] || []
    });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

export default router;
