import type express from 'express';
import jwt from 'jsonwebtoken';
import { query, queryOne } from '../../src/lib/db';
import type { Exec } from './assignments';

// No runtime import of assignments.ts (it imports this file): the default runs on the pool.
const onPool: Exec = (sql, params) => query<never[]>(sql, params);

/**
 * Sign-in sessions: a signed cookie (JWT { userId }, irongate_token). Two server-side limits are
 * checked on EVERY request that reads the session (authenticateToken, GET /api/auth/me, the
 * operator status check), from the user row loaded anyway:
 *
 *   users.sessions_valid_after  "sign out everywhere": a token issued (iat) before it is refused.
 *       Set by a password reset (e-mail link, admin, own change), "Sign out my other devices",
 *       the admin's "Sign out everywhere" and the operator repair action. The value is truncated
 *       to the second (iat has 1-second granularity), so the token issued by the same request
 *       (the current device after "Sign out my other devices") stays valid, and every token from
 *       an earlier second does not. Both times come from this server's clock.
 *   company setting session_lifetime_hours  "Sign-in lasts" (Parameters, super admins): a token
 *       older than the CURRENT setting is refused, so shortening it ends longer sessions at once;
 *       lengthening it only applies to new sign-ins (JWT exp and the cookie's max age are set
 *       from the setting at sign-in).
 *
 * A refused session answers 401 with code session_ended / session_expired and the header
 * X-Session-Ended, so the app shows the sign-in screen with a clear message.
 */

export const SESSION_COOKIE = 'irongate_token';
export const SESSION_LIFETIME_KEY = 'session_lifetime_hours';
export const SESSION_LIFETIME_CHOICES = [1, 8, 24, 168, 336, 720] as const;
export const DEFAULT_SESSION_HOURS = 168;
export const SESSION_ENDED_HEADER = 'X-Session-Ended';

export const SESSION_ENDED_MESSAGE = 'Your session has ended. Please sign in again.';
export const SESSION_EXPIRED_MESSAGE = 'Your sign-in has expired. Please sign in again.';

/** The lifetime in hours from the stored setting (anything not allowed = the default). */
export function lifetimeHours(raw: unknown): number {
  const n = Number(raw);
  return (SESSION_LIFETIME_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_SESSION_HOURS;
}

/** "1 hour", "8 hours", "1 day", "7 days", … */
export function lifetimeLabel(hours: number): string {
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const d = hours / 24;
  return `${d} day${d === 1 ? '' : 's'}`;
}

export const isAllowedLifetime = (v: unknown): v is number =>
  typeof v === 'number' && (SESSION_LIFETIME_CHOICES as readonly number[]).includes(v);

/** SQL (scalar) of a user's company sign-in lifetime setting; alias = the users row. */
export const lifetimeSettingSql = (alias = 'u') =>
  `(SELECT c.config_value FROM configs c WHERE c.company_id = ${alias}.company_id AND c.config_key = '${SESSION_LIFETIME_KEY}'
     AND c.department_id IS NULL AND c.team_id IS NULL LIMIT 1)`;

export interface SessionRow { sessions_valid_after?: string | Date | null; session_lifetime?: string | null }
export interface SessionProblem { code: 'session_ended' | 'session_expired'; message: string }

/** Why this (verified) token may no longer be used, or null when it is fine. */
export function sessionProblem(decoded: { iat?: unknown }, row: SessionRow, now = Date.now()): SessionProblem | null {
  const iatMs = typeof decoded?.iat === 'number' ? decoded.iat * 1000 : 0;
  if (row.sessions_valid_after) {
    const after = new Date(row.sessions_valid_after).getTime();
    if (iatMs < after) return { code: 'session_ended', message: SESSION_ENDED_MESSAGE };
  }
  if (now - iatMs > lifetimeHours(row.session_lifetime) * 3600 * 1000) return { code: 'session_expired', message: SESSION_EXPIRED_MESSAGE };
  return null;
}

/** Answer a refused session (401 + header; the cookie is cleared). */
export function refuseSession(res: express.Response, problem: SessionProblem): void {
  res.setHeader(SESSION_ENDED_HEADER, problem.code);
  res.setHeader('Access-Control-Expose-Headers', `X-Request-Id, ${SESSION_ENDED_HEADER}`);
  clearSessionCookie(res);
  res.status(401).json({ error: problem.message, code: problem.code });
}

const isProduction = () => process.env.NODE_ENV === 'production';
const cookieOptions = () => ({ httpOnly: true, secure: isProduction(), sameSite: (isProduction() ? 'strict' : 'lax') as 'strict' | 'lax' });

export function clearSessionCookie(res: express.Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/** The current sign-in lifetime (hours) of the user's company. */
export async function lifetimeForUser(userId: string, exec: Exec = onPool): Promise<number> {
  const [row] = await exec<{ v: string | null }>(`SELECT ${lifetimeSettingSql('u')} AS v FROM users u WHERE u.id = ?`, [userId]);
  return lifetimeHours(row?.v);
}

/** Sign the session token and set the cookie; exp and max age follow the company's lifetime. */
export async function issueSessionCookie(res: express.Response, userId: string, secret: string): Promise<{ token: string; hours: number }> {
  const hours = await lifetimeForUser(userId);
  const token = jwt.sign({ userId }, secret, { expiresIn: hours * 3600 });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: hours * 3600 * 1000 });
  return { token, hours };
}

/** Now, truncated to the second (see the header): the value stored in sessions_valid_after. */
export const sessionCutoff = (now = Date.now()) => new Date(Math.floor(now / 1000) * 1000);

/**
 * End every session of the user issued before this second, and their platform support (operator)
 * sessions. Runs in the caller's transaction when one is given.
 */
export async function endUserSessions(userId: string, exec: Exec = onPool): Promise<Date> {
  const cutoff = sessionCutoff();
  await exec('UPDATE users SET sessions_valid_after = ? WHERE id = ?', [cutoff.toISOString(), userId]);
  await exec('UPDATE platform_operator_sessions SET ended_at = now() WHERE user_id = ? AND ended_at IS NULL', [userId]);
  return cutoff;
}

/** Session columns of one user (for routes that verify the token themselves). */
type SessionUserRow = SessionRow & { email: string; is_active: boolean };
export async function sessionRowOf(userId: string): Promise<SessionUserRow | null> {
  return queryOne<SessionUserRow>(
    `SELECT u.email, u.is_active, u.sessions_valid_after, ${lifetimeSettingSql('u')} AS session_lifetime FROM users u WHERE u.id = ?`,
    [userId]
  );
}
