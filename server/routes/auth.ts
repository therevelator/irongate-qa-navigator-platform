import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query, queryOne } from '../../src/lib/db';
import { JWT_SECRET } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';
import { execOn, grantAssignment, listAssignments } from '../lib/assignments';
import { recordAudit } from '../lib/audit';
import { transaction } from '../../src/lib/db';
import ssoRoutes, { setSessionCookie } from './authSso';

// WebSocket imports - disabled for Netlify Functions compatibility
// import { broadcast } from '../websocket';
// import { wss } from '../index';
const broadcast = (_wss: any, _data: any) => {}; // No-op in serverless
const wss = null; // Not available in serverless

const router = express.Router();

// SSO (Google / Microsoft), invitation acceptance and GET /providers: server/routes/authSso.ts.
router.use(ssoRoutes);

/** The user's active assignments with scope names (the UI builds its policy actor from them). */
async function assignmentsOf(user: { id: string; company_id: string }) {
  const rows = await listAssignments(user.company_id, [user.id]);
  return rows.map((r) => ({
    id: r.id, role: r.role, scopeType: r.scope_type, scopeId: r.scope_id, scopeName: r.scope_name,
    departmentId: r.department_id, departmentName: r.department_name,
  }));
}

// Helper to generate human-readable 12-character company ID
// Format: 8 alphanumeric chars + 4 digit checksum
const generateCompanyId = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Add 4-digit timestamp-based suffix for uniqueness
  const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${id}${suffix}`;
};

// Helper to generate UUID for other entities (departments, teams, users)
const generateUUID = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// Register
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password, firstName, lastName, companyName, departmentName, teamName } = req.body;
    // The registering user creates a new organisation and becomes its super_admin.
    // Additional users are created by an admin in Users.
    const role = 'super_admin';

    // Validate required fields
    if (!email || !password || !firstName || !lastName || !companyName || !departmentName || !teamName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user already exists
    const existingUser = await queryOne<any>(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?)',
      [email]
    );

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Extract domain from email for company
    const emailDomain = email.split('@')[1] || 'unknown.com';

    // Registration only ever creates a NEW organisation, and its first user becomes
    // that organisation's super_admin. Joining an existing organisation is by invite
    // (an admin creates the account in Users), never by typing its name here —
    // otherwise anyone could make themselves super_admin of an existing tenant.
    const existingCompany = await queryOne<any>(
      'SELECT id FROM companies WHERE LOWER(name) = LOWER(?)',
      [companyName]
    );
    if (existingCompany) {
      return res.status(409).json({
        error: 'An organisation with this name already exists. Ask its administrator to create an account for you.'
      });
    }

    const companyId = generateCompanyId();
    await query(
      `INSERT INTO companies (id, name, domain, is_active) VALUES (?, ?, ?, true)`,
      [companyId, companyName, emailDomain]
    );

    const departmentId = generateUUID();
    await query(
      `INSERT INTO departments (id, company_id, name, is_active) VALUES (?, ?, ?, true)`,
      [departmentId, companyId, departmentName]
    );

    const teamId = generateUUID();
    await query(
      `INSERT INTO teams (id, company_id, department_id, name, is_active) VALUES (?, ?, ?, ?, true)`,
      [teamId, companyId, departmentId, teamName]
    );

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate user ID
    const userId = generateUUID();

    // Insert user, their role assignments (super admin of the company, member of the first
    // team) and the compatibility membership row, in one transaction.
    await transaction(async (client) => {
      const exec = execOn(client);
      await exec(
        `INSERT INTO users (
          id, email, password_hash, first_name, last_name, role,
          company_id, department_id, primary_team_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, email, passwordHash, firstName, lastName, role, companyId, departmentId, teamId]
      );
      await grantAssignment(exec, { companyId, userId, grant: { role: 'super_admin', scopeType: 'company', scopeId: companyId }, actorId: userId });
      await grantAssignment(exec, { companyId, userId, grant: { role: 'qa_engineer', scopeType: 'team', scopeId: teamId }, actorId: userId });
      await exec('INSERT INTO team_members (user_id, team_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [userId, teamId, 'member']);
      await recordAudit({
        companyId, actorId: userId, action: 'company.create', entityType: 'company', entityId: companyId,
        summary: `${firstName} ${lastName} created the organisation ${companyName}`, after: { companyName, departmentName, teamName },
        departmentIds: [departmentId], subjectIds: [userId, companyId],
      }, exec);
    });

    // Get created user
    const user = await queryOne<any>(
      `SELECT id, email, first_name, last_name, role, company_id, department_id, primary_team_id
       FROM users WHERE id = ?`,
      [userId]
    );

    // Broadcast user creation
    broadcast(wss, {
      type: 'USER_CREATED',
      data: user
    });

    setSessionCookie(res, user.id);
    user.assignments = await assignmentsOf(user);

    res.status(201).json({ user });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Get user
    const user = await queryOne<any>(
      `SELECT id, email, password_hash, first_name, last_name, role, 
              company_id, department_id, primary_team_id, is_active
       FROM users WHERE LOWER(email) = LOWER(?)`,
      [email]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if user is inactive - return same error as invalid credentials for security
    if (!user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    // Remove password hash from response
    delete user.password_hash;

    // Get assigned teams
    const teams = await query<any[]>(
      "SELECT scope_id AS team_id FROM role_assignments WHERE user_id = ? AND scope_type = 'team' AND revoked_at IS NULL",
      [user.id]
    );
    user.assignedTeams = teams.map(t => t.team_id);

    setSessionCookie(res, user.id);
    user.assignments = await assignmentsOf(user);

    res.json({ user });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('irongate_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
  });
  res.json({ message: 'Logged out successfully' });
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    // Check cookie first, then header
    let token = req.cookies.irongate_token;
    
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;

    const user = await queryOne<any>(
      `SELECT id, email, first_name, last_name, role, 
              company_id, department_id, primary_team_id, avatar_url,
              created_at, last_login, is_active, email_verified
       FROM users WHERE id = ?`,
      [decoded.userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.is_active) {
      return res.status(403).json({ 
        error: 'Your account has been deactivated. Please contact your administrator for assistance.' 
      });
    }

    // Get assigned teams
    const teams = await query<any[]>(
      "SELECT scope_id AS team_id FROM role_assignments WHERE user_id = ? AND scope_type = 'team' AND revoked_at IS NULL",
      [user.id]
    );
    user.assignedTeams = teams.map(t => t.team_id);
    user.assignments = await assignmentsOf(user);

    res.json({ user });
  } catch (error) {
    // Don't log "jwt malformed" or "jwt expired" as errors, just return 401
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;
