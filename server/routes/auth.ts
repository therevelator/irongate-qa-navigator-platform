import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query, queryOne } from '../../src/lib/db';

// WebSocket imports - disabled for Netlify Functions compatibility
// import { broadcast } from '../websocket';
// import { wss } from '../index';
const broadcast = (_wss: any, _data: any) => {}; // No-op in serverless
const wss = null; // Not available in serverless

const router = express.Router();
const secrettoken = process.env.secrettoken || 'your-secret-key-change-in-production';

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
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, companyName, departmentName, teamName } = req.body;
    // First registered user is always super_admin - additional users created via Admin Panel
    const role = 'super_admin';

    // Validate required fields
    if (!email || !password || !firstName || !lastName || !companyName || !departmentName || !teamName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user already exists
    const existingUser = await queryOne<any>(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Extract domain from email for company
    const emailDomain = email.split('@')[1] || 'unknown.com';

    // Check if company exists by name (case-insensitive)
    let company = await queryOne<any>(
      'SELECT id FROM companies WHERE LOWER(name) = LOWER(?)',
      [companyName]
    );

    let companyId: string;

    if (!company) {
      // Create new company with human-readable ID
      companyId = generateCompanyId();
      await query(
        `INSERT INTO companies (id, name, domain, is_active) VALUES (?, ?, ?, 1)`,
        [companyId, companyName, emailDomain]
      );
    } else {
      companyId = company.id;
    }

    // Check if department exists for this company (case-insensitive)
    let department = await queryOne<any>(
      'SELECT id FROM departments WHERE company_id = ? AND LOWER(name) = LOWER(?)',
      [companyId, departmentName]
    );

    let departmentId: string;

    if (!department) {
      // Create new department tied to company
      departmentId = generateUUID();
      await query(
        `INSERT INTO departments (id, company_id, name, is_active) VALUES (?, ?, ?, 1)`,
        [departmentId, companyId, departmentName]
      );
    } else {
      departmentId = department.id;
    }

    // Check if team exists for this department (case-insensitive)
    let team = await queryOne<any>(
      'SELECT id FROM teams WHERE department_id = ? AND LOWER(name) = LOWER(?)',
      [departmentId, teamName]
    );

    let teamId: string;

    if (!team) {
      // Create new team tied to company and department
      teamId = generateUUID();
      await query(
        `INSERT INTO teams (id, company_id, department_id, name, is_active) VALUES (?, ?, ?, ?, 1)`,
        [teamId, companyId, departmentId, teamName]
      );
    } else {
      teamId = team.id;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate user ID
    const userId = generateUUID();

    // Insert user
    await query(
      `INSERT INTO users (
        id, email, password_hash, first_name, last_name, role,
        company_id, department_id, primary_team_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, email, passwordHash, firstName, lastName, role, companyId, departmentId, teamId]
    );

    // Add to team_members
    await query(
      'INSERT INTO team_members (user_id, team_id, role) VALUES (?, ?, ?)',
      [userId, teamId, 'member']
    );

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

    // Generate token
    const token = jwt.sign(
      { userId: user.id, role: user.role, companyId: user.company_id },
      secrettoken,
      { expiresIn: '7d' }
    );

    res.status(201).json({ user, token });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Get user
    const user = await queryOne<any>(
      `SELECT id, email, password_hash, first_name, last_name, role, 
              company_id, department_id, primary_team_id, is_active
       FROM users WHERE email = ?`,
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
      'SELECT team_id FROM team_members WHERE user_id = ?',
      [user.id]
    );
    user.assignedTeams = teams.map(t => t.team_id);

    // Generate token
    const token = jwt.sign(
      { 
        userId: user.id, 
        role: user.role, 
        companyId: user.company_id,
        departmentId: user.department_id,
        primaryTeamId: user.primary_team_id
      },
      secrettoken,
      { expiresIn: '7d' }
    );

    res.json({ user, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, secrettoken) as any;

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
      'SELECT team_id FROM team_members WHERE user_id = ?',
      [user.id]
    );
    user.assignedTeams = teams.map(t => t.team_id);

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;
