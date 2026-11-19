import { createHmac, randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import type express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { JWT_SECRET } from '../middleware/auth';
import { recordAudit } from './audit';
import { clientIp, ctxOf } from './requestContext';

/**
 * Platform operator (the product owner's support access across companies).
 *
 *   Who:      a signed-in user whose email is in PLATFORM_OPERATOR_EMAILS (comma-separated,
 *             case-insensitive). Unset or empty: the feature is off and every /api/operator
 *             route answers 404. Re-checked on every request against the user's current email.
 *   Network:  PLATFORM_OPERATOR_ALLOWED_IPS (comma-separated, optional): other client IPs are
 *             refused (clientIp: Netlify's x-nf-client-connection-ip, else req.ip).
 *   Step-up:  the password is entered again; then a separate operator token (30 minutes) is
 *             issued. It is signed with a key DERIVED from JWT_SECRET (HMAC with a fixed label)
 *             and carries its own audience and type claim, so a session JWT can never be used as
 *             an operator token and an operator token never verifies as a session JWT. Its id is a
 *             row of platform_operator_sessions; "Leave" ends the row (revocation on every
 *             instance). The web app keeps the token in memory only.
 *   Logging:  platform_access_log (every access, platform-wide) and, per company, a readable
 *             entry in that company's audit_log (platform_support.view, throttled to one per
 *             company and section per 30 minutes; platform_support.action for every repair).
 */

export const OPERATOR_TOKEN_HEADER = 'x-operator-token';
export const OPERATOR_REASON_HEADER = 'x-operator-reason';
export const OPERATOR_AUDIENCE = 'irongate-platform-operator';
export const OPERATOR_TOKEN_TYPE = 'platform_operator';
export const OPERATOR_SESSION_MINUTES = 30;
export const VIEW_THROTTLE_MINUTES = 30;

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const operatorEmails = (env: NodeJS.ProcessEnv = process.env) => new Set(list(env.PLATFORM_OPERATOR_EMAILS));
export const operatorEnabled = (env: NodeJS.ProcessEnv = process.env) => operatorEmails(env).size > 0;
export const isOperatorEmail = (email: unknown, env: NodeJS.ProcessEnv = process.env) =>
  typeof email === 'string' && operatorEmails(env).has(email.trim().toLowerCase());

/** IPv4-mapped IPv6 (::ffff:1.2.3.4) compares as the IPv4 address. */
const normIp = (ip: string) => ip.trim().toLowerCase().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1');
export function ipAllowed(ip: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const allowed = list(env.PLATFORM_OPERATOR_ALLOWED_IPS).map(normIp);
  return allowed.length === 0 || allowed.includes(normIp(ip));
}

/** The operator token key: never JWT_SECRET itself. */
const operatorKey = () => createHmac('sha256', JWT_SECRET).update('irongate-platform-operator-token-v1').digest();

export interface OperatorClaims { sub: string; sid: string; typ: string }

export function signOperatorToken(userId: string, sessionId: string, minutes = OPERATOR_SESSION_MINUTES): string {
  return jwt.sign({ typ: OPERATOR_TOKEN_TYPE, sid: sessionId }, operatorKey(), {
    subject: userId, audience: OPERATOR_AUDIENCE, issuer: 'irongate', expiresIn: minutes * 60, algorithm: 'HS256',
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

export async function startOperatorSession(userId: string, ip: string): Promise<{ token: string; expiresAt: string; sessionId: string }> {
  const sessionId = randomUUID();
  const expires = new Date(Date.now() + OPERATOR_SESSION_MINUTES * 60_000);
  await query('INSERT INTO platform_operator_sessions (id, user_id, expires_at, ip) VALUES (?, ?, ?, ?)', [sessionId, userId, expires.toISOString(), ip.slice(0, 64)]);
  return { token: signOperatorToken(userId, sessionId), expiresAt: expires.toISOString(), sessionId };
}

export async function openOperatorSession(sessionId: string, userId: string): Promise<{ expires_at: string } | null> {
  return queryOne<any>(
    'SELECT expires_at FROM platform_operator_sessions WHERE id = ? AND user_id = ? AND ended_at IS NULL AND expires_at > now()',
    [sessionId, userId],
  );
}

export async function endOperatorSession(sessionId: string): Promise<void> {
  await query('UPDATE platform_operator_sessions SET ended_at = COALESCE(ended_at, now()) WHERE id = ?', [sessionId]);
}

/* ------------------------------------------------------------------------------------------
 * Logging
 * ---------------------------------------------------------------------------------------- */

export interface OperatorRequest extends express.Request {
  user?: any;
  operator?: { userId: string; email: string; sessionId: string; expiresAt: string };
}

export async function logPlatformAccess(req: OperatorRequest, entry: { action: string; companyId?: string | null; section?: string | null; reason?: string | null; detail?: unknown; email?: string | null; userId?: string | null }): Promise<void> {
  await query(
    `INSERT INTO platform_access_log (operator_user_id, operator_email, action, company_id, section, reason, detail, ip, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)`,
    [
      entry.userId ?? req.operator?.userId ?? req.user?.id ?? null, (entry.email ?? req.operator?.email ?? null)?.slice(0, 255) ?? null,
      entry.action, entry.companyId ?? null, entry.section ?? null, entry.reason?.slice(0, 500) ?? null,
      entry.detail === undefined ? null : JSON.stringify(entry.detail), clientIp(req), ctxOf(req).requestId,
    ],
  ).catch((e) => console.error(`[operator] access log write failed (${(e as any)?.code ?? 'error'})`));
}

export const SECTION_LABELS: Record<string, string> = {
  overview: 'the company overview', organisation: 'the organisation', users: 'users and invitations', settings: 'settings and targets',
  data: 'metric data', alerts: 'alerts and actions', pulse: 'the wellbeing pulse', activity: 'the activity log',
  user_activity: 'the user activity log', errors: 'server errors',
};

/** A view of a company section: platform log always, the company's audit_log at most once per 30 minutes. */
export async function recordCompanyView(req: OperatorRequest, companyId: string, section: string, reason: string): Promise<void> {
  await logPlatformAccess(req, { action: 'view', companyId, section, reason });
  try {
    const recent = await queryOne<any>(
      `SELECT 1 FROM audit_log WHERE company_id = ? AND action = 'platform_support.view' AND after->>'section' = ?
          AND created_at > now() - make_interval(mins => ?)`,
      [companyId, section, VIEW_THROTTLE_MINUTES],
    );
    if (recent) return;
    await recordAudit({
      companyId, actorId: null, action: 'platform_support.view', entityType: 'company', entityId: companyId,
      summary: `Platform support viewed ${SECTION_LABELS[section] ?? section}. Reason: ${reason}`,
      after: { section, reason, by: 'IronGate platform support' }, subjectIds: [companyId],
    });
  } catch (e) {
    console.error(`[operator] company audit write failed (${(e as any)?.code ?? 'error'})`);
  }
}

/** A repair action: platform log and the company's audit_log, always. */
export async function recordCompanyAction(req: OperatorRequest, companyId: string | null, action: string, summary: string, reason: string, detail?: unknown): Promise<void> {
  await logPlatformAccess(req, { action: 'action', companyId, section: action, reason, detail });
  if (!companyId) return;
  await recordAudit({
    companyId, actorId: null, action: 'platform_support.action', entityType: 'company', entityId: companyId,
    summary: `Platform support: ${summary}. Reason: ${reason}`.slice(0, 500),
    after: { action, reason, by: 'IronGate platform support', ...(detail && typeof detail === 'object' ? { detail } : {}) }, subjectIds: [companyId],
  });
}

/** Reason text: required, 3 to 300 characters, one line. */
export function cleanReason(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\r\n\t]+/g, ' ').trim();
  return s.length >= 3 && s.length <= 300 ? s : null;
}
