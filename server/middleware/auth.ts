import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { loadAccessContext } from '../lib/assignments';
import type { Grant } from '../lib/userPolicy';

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
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  let row: Awaited<ReturnType<typeof loadAccessContext>>;
  try {
    row = typeof decoded?.userId === 'string' ? await loadAccessContext(decoded.userId) : null;
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
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
