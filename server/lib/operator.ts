import { createHmac, randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { JWT_SECRET } from '../middleware/auth';
import { clientIp, ctxOf } from './requestContext';

/**
 * Platform operator (IronGate platform support: the product owner's access across companies).
 *
 *   Who:      a row of platform_operators (migration 20261125000000). Operators are NOT users of
 *             any company and a company user can never be one (the same e-mail cannot be in both
 *             tables: database triggers). No active operator: the feature is off and every
 *             /api/operator route answers 404. Create one with `npm run operator:create`.
 *   Sign-in:  /operator has its own sign-in (e-mail + password, bcrypt). An operator account is
 *             NEVER locked and its sign-in is not rate limited, however many wrong passwords (owner's
 *             rule). A session lasts 8 hours.
 *   Token:    signed with a key DERIVED from JWT_SECRET (HMAC with a fixed label), with its own
 *             audience and type claim, so a company session JWT can never be used as an operator
 *             token and an operator token never verifies as a company session. It is sent as the
 *             httpOnly cookie irongate_operator (or the X-Operator-Token header). Its id is a row of
 *             platform_operator_sessions; "Sign out" ends the row (revocation on every instance).
 *   Network:  PLATFORM_OPERATOR_ALLOWED_IPS (comma-separated, optional): other client IPs are
 *             refused (clientIp: Netlify's x-nf-client-connection-ip, else req.ip).
 *   Logging:  none. Nothing an operator does is logged: no company audit_log entry (recordAudit is a
 *             no-op inside an operator request, server/lib/platformContext.ts), no user_activity row,
 *             and the former platform_access_log is no longer written (the table is left in place,
 *             unused). Operators give no reason (support tickets live in a separate system).
 */

export const OPERATOR_TOKEN_HEADER = 'x-operator-token';
export const OPERATOR_COOKIE = 'irongate_operator';
export const OPERATOR_AUDIENCE = 'irongate-platform-operator';
export const OPERATOR_TOKEN_TYPE = 'platform_operator';
export const OPERATOR_SESSION_MINUTES = 8 * 60;
/** bcrypt cost of operator passwords (the hash is $2b$12$…; $2a$ hashes verify too). */
export const OPERATOR_BCRYPT_COST = 12;

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** At least one active operator exists. */
export async function operatorEnabled(): Promise<boolean> {
  const r = await queryOne<any>('SELECT EXISTS (SELECT 1 FROM platform_operators WHERE is_active) AS on').catch(() => null);
  return !!r?.on;
}

/** IPv4-mapped IPv6 (::ffff:1.2.3.4) compares as the IPv4 address. */
const normIp = (ip: string) => ip.trim().toLowerCase().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1');
export function ipAllowed(ip: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const allowed = list(env.PLATFORM_OPERATOR_ALLOWED_IPS).map(normIp);
  return allowed.length === 0 || allowed.includes(normIp(ip));
}

/** The operator token key: never JWT_SECRET itself. */
const operatorKey = () => createHmac('sha256', JWT_SECRET).update('irongate-platform-operator-token-v1').digest();

export interface OperatorClaims { sub: string; sid: string; typ: string }

export function signOperatorToken(operatorId: string, sessionId: string, minutes = OPERATOR_SESSION_MINUTES): string {
  return jwt.sign({ typ: OPERATOR_TOKEN_TYPE, sid: sessionId }, operatorKey(), {
    subject: operatorId, audience: OPERATOR_AUDIENCE, issuer: 'irongate', expiresIn: minutes * 60, algorithm: 'HS256',
  });
}

export function verifyOperatorToken(token: string): OperatorClaims | null {
  try {
    const c = jwt.verify(token, operatorKey(), { audience: OPERATOR_AUDIENCE, issuer: 'irongate', algorithms: ['HS256'] }) as any;
    if (c?.typ !== OPERATOR_TOKEN_TYPE || typeof c.sub !== 'string' || typeof c.sid !== 'string') return null;
    return { sub: c.sub, sid: c.sid, typ: c.typ };
  } catch {
    return null;
  }
}

export interface OperatorRow { id: string; email: string; name: string; is_active: boolean }

export type SignInResult =
  | { ok: true; operator: OperatorRow }
  | { ok: false; why: 'unknown' | 'inactive' | 'wrong_password'; operator?: OperatorRow };

/**
 * Check an operator's e-mail and password. An operator is never locked out: a wrong password is
 * only counted (failed_login_attempts, for the record) and a success clears the counter and
 * records last_login. An unknown e-mail still runs a bcrypt comparison (same timing).
 */
export async function checkOperatorPassword(email: string, password: string): Promise<SignInResult> {
  const row = await queryOne<any>(
    'SELECT id, email, name, password_hash, is_active, failed_login_attempts FROM platform_operators WHERE LOWER(email) = LOWER(?)',
    [email.trim()],
  );
  if (!row) {
    await bcrypt.compare(password, '$2b$12$C6UzMDM.H6dfI/f/IKcEeO5dOsZb3n2BSb7tzNWbbUk8C5XbNq3uS').catch(() => false);
    return { ok: false, why: 'unknown' };
  }
  const op: OperatorRow = { id: row.id, email: row.email, name: row.name, is_active: row.is_active };
  const good = await bcrypt.compare(password, row.password_hash).catch(() => false);
  if (!good) {
    await query('UPDATE platform_operators SET failed_login_attempts = failed_login_attempts + 1, locked_until = NULL WHERE id = ?', [row.id]);
    return { ok: false, why: 'wrong_password', operator: op };
  }
  if (!row.is_active) return { ok: false, why: 'inactive', operator: op };
  await query('UPDATE platform_operators SET failed_login_attempts = 0, locked_until = NULL, last_login = now() WHERE id = ?', [row.id]);
  return { ok: true, operator: op };
}

export async function startOperatorSession(operatorId: string, ip: string): Promise<{ token: string; expiresAt: string; sessionId: string }> {
  const sessionId = randomUUID();
  const expires = new Date(Date.now() + OPERATOR_SESSION_MINUTES * 60_000);
  await query('INSERT INTO platform_operator_sessions (id, operator_id, expires_at, ip) VALUES (?, ?, ?, ?)', [sessionId, operatorId, expires.toISOString(), ip.slice(0, 64)]);
  return { token: signOperatorToken(operatorId, sessionId), expiresAt: expires.toISOString(), sessionId };
}

/** The open session of an active operator, with the operator. */
export async function openOperatorSession(sessionId: string, operatorId: string): Promise<{ expires_at: string; email: string; name: string } | null> {
  return queryOne<any>(
    `SELECT s.expires_at, o.email, o.name FROM platform_operator_sessions s JOIN platform_operators o ON o.id = s.operator_id
      WHERE s.id = ? AND s.operator_id = ? AND s.ended_at IS NULL AND s.expires_at > now() AND o.is_active`,
    [sessionId, operatorId],
  );
}

export async function endOperatorSession(sessionId: string): Promise<void> {
  await query('UPDATE platform_operator_sessions SET ended_at = COALESCE(ended_at, now()) WHERE id = ?', [sessionId]);
}

/** Create or update an operator (npm run operator:create). Refuses an e-mail of a company user. */
export async function upsertOperator(email: string, name: string, password: string): Promise<{ id: string; created: boolean }> {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('Give a valid e-mail address.');
  if (!name.trim()) throw new Error('Give a name.');
  if (password.length < 12) throw new Error('The password needs at least 12 characters.');
  const user = await queryOne<any>('SELECT 1 FROM users WHERE LOWER(email) = ?', [e]);
  if (user) throw new Error('This e-mail address belongs to a company user. A platform operator must use another address.');
  const hash = await bcrypt.hash(password, OPERATOR_BCRYPT_COST);
  const existing = await queryOne<any>('SELECT id FROM platform_operators WHERE LOWER(email) = ?', [e]);
  if (existing) {
    await query('UPDATE platform_operators SET name = ?, password_hash = ?, is_active = TRUE, failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [name.trim(), hash, existing.id]);
    return { id: existing.id, created: false };
  }
  const rows = await query<any[]>('INSERT INTO platform_operators (email, name, password_hash) VALUES (?, ?, ?) RETURNING id', [e, name.trim(), hash]);
  return { id: rows[0].id, created: true };
}

/** Is this e-mail a platform operator's? (company sign-up and user creation refuse it) */
export async function isOperatorEmail(email: unknown): Promise<boolean> {
  if (typeof email !== 'string' || !email.trim()) return false;
  const r = await queryOne<any>('SELECT 1 FROM platform_operators WHERE LOWER(email) = LOWER(?)', [email.trim()]).catch(() => null);
  return !!r;
}

export interface OperatorRequest extends express.Request {
  operator?: { operatorId: string; email: string; name: string; sessionId: string; expiresAt: string };
}
