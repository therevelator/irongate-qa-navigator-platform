import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query, queryOne } from '../../src/lib/db';
import { broadcast } from '../websocket';
import { wss } from '../index';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, role, companyId, departmentId, teamId } = req.body;

    // Validate required fields
    if (!email || !password || !firstName || !lastName || !companyId || !departmentId || !teamId) {
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

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user
    const [result] = await query<any>(
      `INSERT INTO users (
        email, password_hash, first_name, last_name, role,
        company_id, department_id, primary_team_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [email, passwordHash, firstName, lastName, role || 'qa_engineer', companyId, departmentId, teamId]
    );

    const userId = result.insertId;

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
      JWT_SECRET,
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
      JWT_SECRET,
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
