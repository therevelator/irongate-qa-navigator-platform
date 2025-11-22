import express from 'express';
import bcrypt from 'bcrypt';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

// Role hierarchy and permissions
const ROLE_HIERARCHY = {
  super_admin: ['qa_manager', 'team_lead', 'qa_engineer', 'viewer'],
  qa_manager: ['team_lead', 'qa_engineer', 'viewer'],
  team_lead: ['qa_engineer', 'viewer'],
  qa_engineer: [],
  viewer: []
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
    } else if (role === 'qa_manager') {
      // QA Manager sees users they created and in their department
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
      // Team Lead sees only users in their team
      users = await query<any>(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.company_id, 
                u.department_id, u.primary_team_id, u.is_active, u.created_at,
                t.name as team_name, d.name as department_name
         FROM users u
         LEFT JOIN teams t ON u.primary_team_id = t.id
         LEFT JOIN departments d ON u.department_id = d.id
         WHERE u.primary_team_id = ?
         ORDER BY u.created_at DESC`,
        [primaryTeamId]
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
    if (creatorRole === 'qa_manager') {
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

// Create team (QA Manager only)
router.post('/teams', authenticateToken, async (req: any, res) => {
  try {
    const { role, companyId, departmentId } = req.user;
    const { name, description, platform } = req.body;

    // Only QA Manager and Super Admin can create teams
    if (role !== 'qa_manager' && role !== 'super_admin') {
      return res.status(403).json({ error: 'Only QA Managers can create teams' });
    }

    if (!name || !platform) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate UUID for team
    const teamId = `team-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Insert team
    await query<any>(
      `INSERT INTO teams (id, company_id, department_id, name, description, platform, is_active)
       VALUES (?, ?, ?, ?, ?, ?, true)`,
      [teamId, companyId, departmentId, name, description || '', platform]
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
    if (role !== 'super_admin' && role !== 'qa_manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Get team to check department
    const team = await queryOne<any>('SELECT department_id FROM teams WHERE id = ?', [teamId]);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // QA Manager can only update teams in their department
    if (role === 'qa_manager' && team.department_id !== userDeptId) {
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
    if (role !== 'super_admin' && role !== 'qa_manager') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Get team to check department
    const team = await queryOne<any>('SELECT department_id FROM teams WHERE id = ?', [teamId]);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // QA Manager can only delete teams in their department
    if (role === 'qa_manager' && team.department_id !== userDeptId) {
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
    else if (role === 'qa_manager') {
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

export default router;
