import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { loadAccessContext } from '../lib/assignments';
import { companyProblem, refuseSession, sessionIdOf, sessionProblem, touchSession, SESSION_EXPIRED_MESSAGE } from '../lib/sessions';
import type { Grant } from '../lib/userPolicy';
import { PLATFORM_SUPPORT_REQUEST, platformSupportContext, type PlatformSupportRequest } from '../lib/platformContext';
import { apiPathOf, isSandboxCompany, sandboxBody, sandboxVerdict, SANDBOX_REFUSED_CODE, SANDBOX_REFUSED_MESSAGE } from '../lib/sandboxConfig';
import { runAsSandbox } from '../lib/sandboxContext';

// Resolve the signing secret once. In production a secret MUST be provided;
// we fail closed (throw on startup) rather than fall back to a public default,
// which would let anyone forge a super_admin token for any company.
const CONFIGURED_SECRET = process.env.JWT_SECRET || process.env.secrettoken;
if (!CONFIGURED_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET (or secrettoken) must be set in production. Refusing to start with a default secret.');
}
export const JWT_SECRET = CONFIGURED_SECRET || 'dev-only-insecure-secret-change-me';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    companyId: string;
    primaryTeamId?: string;
    departmentId?: string;
    /** Active role assignments (server/lib/assignments.ts): what every access decision reads. */
    grants: Grant[];
  };
  userId?: string;
  userRole?: string;
  companyId?: string;
}

/**
 * Verify the session token, then load the caller's CURRENT row (company, active flag, display
 * role / department / primary team) and active role assignments from the database. The JWT
 * only proves identity (userId); authorisation always uses the live assignments, so a
 * deactivated user or one whose assignments changed loses the old rights on their next
 * request — the same state /auth/me shows the UI.
 */
export async function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  // IronGate platform support running a company handler (server/routes/operator.ts forward()):
  // a super admin of that one company, with no user id. Never reachable from a client request.
  const ps = (req as any)[PLATFORM_SUPPORT_REQUEST] as PlatformSupportRequest | undefined;
  if (ps && platformSupportContext()) {
    req.user = { id: null as unknown as string, role: 'super_admin', companyId: ps.companyId, grants: [{ role: 'super_admin', scopeType: 'company', scopeId: ps.companyId } as Grant] };
    req.userId = undefined;
    req.userRole = 'super_admin';
    req.companyId = ps.companyId;
    return next();
  }
  let token = req.cookies?.irongate_token;
  if (!token) {
    const authHeader = req.headers['authorization'];
    token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  }
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (error: any) {
    // An expired session is a normal end of the sign-in: the app shows the sign-in screen with a message.
    if (error instanceof jwt.TokenExpiredError) return refuseSession(res, { code: 'session_expired', message: SESSION_EXPIRED_MESSAGE });
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  let row: Awaited<ReturnType<typeof loadAccessContext>>;
  try {
    row = typeof decoded?.userId === 'string' ? await loadAccessContext(decoded.userId, sessionIdOf(decoded)) : null;
  } catch (error) {
    console.error('[Auth] Failed to load user:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
  if (!row) {
    return res.status(401).json({ error: 'User not found' });
  }
  if (!row.is_active) {
    return res.status(401).json({ error: 'Your account has been deactivated. Please contact your administrator.' });
  }
  // Signed out everywhere, or older than the company's sign-in lifetime (server/lib/sessions.ts).
  // Suspended organisation (companies.status): 403 company_suspended (said first: the suspension
  // also revokes the session rows, and the person should see why).
  const suspended = companyProblem(row);
  if (suspended) return refuseSession(res, suspended);
  // Revoked session row (server/lib/sessions.ts user_sessions), from the same query.
  const problem = sessionProblem(decoded, row);
  if (problem) return refuseSession(res, problem);
  const sid = sessionIdOf(decoded);
  const sandbox = isSandboxCompany(row.company_id);
  // A sandbox session's row keeps no address (the persona is shared by every visitor): not touched.
  if (sid && row.session_last_seen_at && !sandbox) touchSession(req, sid, row.session_last_seen_at);

  req.user = {
    id: row.id,
    role: row.role,
    companyId: row.company_id,
    primaryTeamId: row.primary_team_id ?? undefined,
    departmentId: row.department_id ?? undefined,
    grants: row.grants,
  };
  // Backward-compatible fields used by older handlers.
  req.userId = row.id;
  req.userRole = row.role;
  req.companyId = row.company_id;
  if (sandbox) return sandboxGate(req, res, next);
  next();
}

/**
 * Demo sandbox session (server/lib/sandboxConfig.ts): every request of a sandbox user passes here,
 * whatever the route. Reads are allowed (except API keys, the user activity log and CSV exports of
 * people); writes only from a short allowlist (recommendations, action statuses, alerts and
 * notifications read), with their bodies narrowed so no free text is kept. Everything else answers
 * 403 sandbox_read_only before the route's handler runs. The request then runs in the sandbox
 * context, where no AI provider is ever called (server/lib/groq.ts).
 */
function sandboxGate(req: AuthRequest, res: Response, next: NextFunction) {
  const path = apiPathOf(req.originalUrl || req.url || '');
  const verdict = sandboxVerdict(req.method, path);
  const refuse = () => res.status(403).json({ error: SANDBOX_REFUSED_MESSAGE, code: SANDBOX_REFUSED_CODE });
  if (verdict === 'refuse') return refuse();
  if (verdict === 'noop') {
    res.locals.activitySkip = true;
    return res.status(204).end();
  }
  const m = req.method.toUpperCase();
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    const body = sandboxBody(m, path, req.body);
    if (!body) return refuse();
    req.body = body;
  }
  (req as any).sandbox = true;
  return runAsSandbox(req.user!.companyId, () => next());
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
