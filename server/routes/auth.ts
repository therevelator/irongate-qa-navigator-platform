import express from 'express';
import { isOperatorEmail } from '../lib/operator';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query, queryOne } from '../../src/lib/db';
import { JWT_SECRET } from '../middleware/auth';
import { authLimiter, forgotPasswordIpLimiter, forgotPasswordEmailLimiter, resetPasswordLimiter } from '../middleware/rateLimit';
import { execOn, grantAssignment, listAssignments } from '../lib/assignments';
import { recordAudit } from '../lib/audit';
import { transaction } from '../../src/lib/db';
import ssoRoutes, { setSessionCookie } from './authSso';
import { noteActivityUser, noteFailedSignIn } from '../lib/userActivity';
import { requestPasswordReset, completePasswordReset, PasswordResetError } from '../lib/passwordReset';
import { clientIp } from '../lib/requestContext';
import { recordServerError } from '../lib/opsLog';
import {
  clearSessionCookie, currentSessionPersistent, endUserSessions, issueSessionCookie, wantsPersistentSession, lifetimeHours, lifetimeSettingSql, refuseSession, sessionProblem, SESSION_EXPIRED_MESSAGE,
  companyProblem, companyStatusSql, hideSampleNoticeSql, sessionIdOf, COMPANY_SUSPENDED, COMPANY_SUSPENDED_MESSAGE,
} from '../lib/sessions';
import { recordAuthEvent } from '../lib/authEvents';
import { authenticateToken, type AuthRequest } from '../middleware/auth';
import { passwordProblem } from '../../src/lib/passwordPolicy';
import { emailDomainOf, isPublicEmailDomain } from '../../src/lib/emailDomains';
import { EMAIL_RE } from '../lib/invitations';

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

const domainTakenMessage = (domain: string) =>
  `An organisation already uses the e-mail domain ${domain}. Ask its administrator to invite you.`;

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

    if (typeof email !== 'string' || email.length > 255 || !EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ error: 'Enter a valid e-mail address.' });
    }
    // The same password rules as accepting an invitation and resetting a password (src/lib/passwordPolicy.ts).
    const weak = typeof password === 'string' ? passwordProblem(password, email) : 'The password is required.';
    if (weak) {
      return res.status(400).json({ error: weak });
    }

    // Check if user already exists
    const existingUser = await queryOne<any>(
      'SELECT id FROM users WHERE LOWER(email) = LOWER(?)',
      [email]
    );

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    // A platform operator is never a company user (server/lib/operator.ts).
    if (await isOperatorEmail(email)) return res.status(409).json({ error: 'This e-mail address cannot be used for a company account.' });

    // The organisation's e-mail domain (src/lib/emailDomains.ts): a company domain belongs to one
    // organisation only; a public one (gmail.com, outlook.com, …) never blocks a registration.
    // Nobody is ever added to an organisation because of their domain.
    const emailDomain = emailDomainOf(email);
    const publicDomain = isPublicEmailDomain(emailDomain);

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

    // One organisation per company domain (index companies_domain_company_unique): say so instead of
    // failing with a 500 on the insert.
    if (!publicDomain) {
      const domainTaken = await queryOne<any>(
        'SELECT id FROM companies WHERE LOWER(domain) = LOWER(?) AND email_domain_public = FALSE', [emailDomain]
      );
      if (domainTaken) return res.status(409).json({ error: domainTakenMessage(emailDomain) });
    }

    const companyId = generateCompanyId();
    await query(
      `INSERT INTO companies (id, name, domain, email_domain_public, is_active) VALUES (?, ?, ?, ?, true)`,
      [companyId, companyName, emailDomain, publicDomain]
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
      `SELECT id, email, first_name, last_name, role, company_id, department_id, primary_team_id, ${hideSampleNoticeSql('users')} AS hide_sample_notice
       FROM users WHERE id = ?`,
      [userId]
    );

    // Broadcast user creation
    broadcast(wss, {
      type: 'USER_CREATED',
      data: user
    });

    await setSessionCookie(res, user.id, { method: 'registration' });
    user.assignments = await assignmentsOf(user);

    res.status(201).json({ user });
  } catch (error: any) {
    // Two registrations with the same company domain at the same moment: the index decides.
    if (error?.code === '23505' && String(error?.constraint ?? error?.message ?? '').includes('companies_domain')) {
      return res.status(409).json({ error: domainTakenMessage(emailDomainOf(req.body?.email)) });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const persistent = wantsPersistentSession(req.body?.rememberMe);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Get user
    const user = await queryOne<any>(
      `SELECT id, email, password_hash, first_name, last_name, role, 
              company_id, department_id, primary_team_id, is_active, ${companyStatusSql('users')} AS company_status,
              ${hideSampleNoticeSql('users')} AS hide_sample_notice
       FROM users WHERE LOWER(email) = LOWER(?)`,
      [email]
    );

    // Sign-in events (server/lib/authEvents.ts): every failure with its reason; an unknown e-mail
    // only as a keyed hash.
    const failed = (reason: string) => recordAuthEvent(req, { outcome: 'failure', method: 'password', userId: user?.id ?? null, email, failureReason: reason });
    if (!user) {
      await failed('unknown_email');
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // From here the email belongs to a user: a failure is recorded in their company's user activity.
    noteFailedSignIn(res, user.email);

    // Check if user is inactive - return same error as invalid credentials for security
    if (!user.is_active) {
      await failed('inactive');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = typeof password === 'string' && !!user.password_hash && await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      await failed('wrong_password');
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // A suspended organisation (companies.status): said only after the right password.
    if (user.company_status === 'suspended') {
      await failed('company_suspended');
      return res.status(403).json({ error: COMPANY_SUSPENDED_MESSAGE, code: COMPANY_SUSPENDED.code });
    }

    // Update last login
    await query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    // Remove password hash (and the internal company status) from the response
    delete user.password_hash;
    delete user.company_status;

    // Get assigned teams
    const teams = await query<any[]>(
      "SELECT scope_id AS team_id FROM role_assignments WHERE user_id = ? AND scope_type = 'team' AND revoked_at IS NULL",
      [user.id]
    );
    user.assignedTeams = teams.map(t => t.team_id);

    // "Keep me signed in": a persistent cookie; otherwise a browser-session cookie (server/lib/sessions.ts).
    await setSessionCookie(res, user.id, { persistent, method: 'password' });
    user.assignments = await assignmentsOf(user);

    res.json({ user });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/* ------------------------------------------------------------------------------------------
 * Forgot / reset password by e-mail (server/lib/passwordReset.ts)
 * ---------------------------------------------------------------------------------------- */

export const FORGOT_PASSWORD_MESSAGE = "If an account exists for that e-mail, we've sent a link.";
/** Every answer takes at least this long, so the time does not tell whether an e-mail was sent. */
const FORGOT_MIN_MS = 900;

// The same 200 answer for every e-mail address (unknown, inactive or active): no account enumeration.
router.post('/forgot-password', forgotPasswordIpLimiter, forgotPasswordEmailLimiter, async (req, res) => {
  const started = Date.now();
  try {
    const userId = await requestPasswordReset(req.body?.email, clientIp(req) || null);
    if (userId) noteActivityUser(res, userId);
  } catch (error) {
    // Logged for the operator; the caller still gets the same answer.
    console.error('Forgot password error:', (error as any)?.code ?? (error as Error)?.name ?? 'error');
    recordServerError({ error, method: 'POST', route: '/api/auth/forgot-password', status: 200 });
  }
  const wait = FORGOT_MIN_MS + Math.floor(Math.random() * 100) - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  res.json({ message: FORGOT_PASSWORD_MESSAGE });
});

// Choose the new password with the link's token. Never signs in: the person signs in afterwards.
router.post('/reset-password', resetPasswordLimiter, async (req, res) => {
  try {
    const { userId } = await completePasswordReset(req.body?.token, req.body?.password, (id) => noteActivityUser(res, id));
    await recordAuthEvent(req, { outcome: 'success', method: 'reset', userId });
    res.json({ message: 'Your password was changed. Sign in with your new password.' });
  } catch (error) {
    if (error instanceof PasswordResetError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error('Reset password error:', (error as any)?.code ?? (error as Error)?.name ?? 'error');
    res.status(500).json({ error: 'The password could not be changed. Try again in a moment.' });
  }
});

// "Sign out my other devices": every other session of the caller ends; this browser gets a new
// session cookie (issued after the cut-off, so it stays valid). Platform support sessions end too.
router.post('/sessions/sign-out-others', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const me = req.user!;
    await transaction(async (client) => {
      const exec = execOn(client);
      await endUserSessions(me.id, exec);
      const [u] = await exec<any>(`SELECT first_name, last_name, email, department_id FROM users WHERE id = ?`, [me.id]);
      await recordAudit({
        companyId: me.companyId, actorId: me.id, action: 'user.sessions_end', entityType: 'user', entityId: me.id,
        summary: `${`${u?.first_name ?? ''} ${u?.last_name ?? ''}`.trim() || u?.email} signed out of all other devices`,
        departmentIds: [u?.department_id], subjectIds: [me.id],
      }, exec);
    });
    await issueSessionCookie(res, me.id, JWT_SECRET, { persistent: currentSessionPersistent(req), method: 'reissue' });
    res.json({ message: 'You were signed out on all other devices. This device stays signed in.' });
  } catch (error) {
    console.error('Sign out other devices error:', (error as any)?.code ?? (error as Error)?.name ?? 'error');
    res.status(500).json({ error: 'Could not sign out the other devices. Try again.' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  clearSessionCookie(res);
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
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role,
              u.company_id, u.department_id, u.primary_team_id, u.avatar_url,
              u.created_at, u.last_login, u.is_active, u.email_verified,
              u.sessions_valid_after, ${lifetimeSettingSql('u')} AS session_lifetime, ${companyStatusSql('u')} AS company_status,
              (SELECT s.revoked_at FROM user_sessions s WHERE s.id = ?::text AND s.user_id = u.id) AS session_revoked_at,
              ${hideSampleNoticeSql('u')} AS hide_sample_notice
       FROM users u WHERE u.id = ?`,
      [sessionIdOf(decoded), decoded.userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.is_active) {
      return res.status(403).json({ 
        error: 'Your account has been deactivated. Please contact your administrator for assistance.' 
      });
    }

    // Signed out everywhere, or older than the company's sign-in lifetime.
    const problem = companyProblem(user) ?? sessionProblem(decoded, user);
    if (problem) return refuseSession(res, problem);
    delete user.company_status;
    delete user.session_revoked_at;
    const sessionHours = lifetimeHours(user.session_lifetime);
    delete user.sessions_valid_after;
    delete user.session_lifetime;

    // Get assigned teams
    const teams = await query<any[]>(
      "SELECT scope_id AS team_id FROM role_assignments WHERE user_id = ? AND scope_type = 'team' AND revoked_at IS NULL",
      [user.id]
    );
    user.assignedTeams = teams.map(t => t.team_id);
    user.assignments = await assignmentsOf(user);

    res.json({ user, session: { issuedAt: new Date(decoded.iat * 1000).toISOString(), lifetimeHours: sessionHours } });
  } catch (error) {
    // Don't log "jwt malformed" or "jwt expired" as errors, just return 401
    if (error instanceof jwt.TokenExpiredError) return refuseSession(res, { code: 'session_expired', message: SESSION_EXPIRED_MESSAGE });
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;
