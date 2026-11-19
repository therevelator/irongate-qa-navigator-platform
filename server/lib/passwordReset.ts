import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { queryOne, transaction } from '../../src/lib/db';
import { execOn, userDepartmentIdsSql, type Exec } from './assignments';
import { recordAudit } from './audit';
import { sendMail, escapeHtml, type MailResult } from './mailer';
import { appBaseUrl } from './sso';
import { passwordProblem } from '../../src/lib/passwordPolicy';
import { endUserSessions } from './sessions';

/**
 * Reset a forgotten password by e-mail (table password_resets).
 *
 *   request   POST /api/auth/forgot-password { email }: an ACTIVE user with that e-mail gets a link
 *             APP_URL/reset-password?token=…; nobody else gets anything, and the caller cannot tell
 *             the difference (same answer, same minimum response time).
 *   admin     POST /api/admin/users/:id/send-reset-link (canResetPassword): the same e-mail.
 *   complete  POST /api/auth/reset-password { token, password }: sets the new password (the app's
 *             password rules, src/lib/passwordPolicy.ts), clears a lockout and e-mails the person
 *             that the password was changed.
 *
 * Tokens: "igr_" + 32 random bytes (base64url). Only the sha256 is stored. A link expires after
 * RESET_TTL_MINUTES, works once, and a newer link (or a completed reset) closes the person's other
 * open links. Tokens never go into the change history, the user activity log or a server log.
 *
 * Sessions: a completed reset ends every existing session of the person (users.sessions_valid_after,
 * server/lib/sessions.ts), so a browser signed in with the old password is signed out.
 */

export const RESET_TTL_MINUTES = 60;
const TOKEN_PREFIX = 'igr_';

export const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function newResetToken(): { token: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashResetToken(token) };
}

export const resetLink = (token: string) => `${appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;

export class PasswordResetError extends Error {
  constructor(public status: number, message: string, public code: string) { super(message); }
}

interface ResetUser {
  id: string; email: string; first_name: string | null; last_name: string | null; company_id: string;
  department_id: string | null; department_ids: string[] | null; is_active: boolean;
}

const nameOf = (u: { first_name?: string | null; last_name?: string | null; email: string }) =>
  `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email;

const USER_COLUMNS = (a = 'u') => `${a}.id, ${a}.email, ${a}.first_name, ${a}.last_name, ${a}.company_id, ${a}.department_id, ${a}.is_active,
  ${userDepartmentIdsSql(a)} AS department_ids`;

/* ------------------------------------------------------------------------------------------
 * E-mails
 * ---------------------------------------------------------------------------------------- */

export function renderResetEmail(args: { firstName: string | null; link: string; byAdmin?: string | null }): { subject: string; text: string; html: string } {
  const hello = args.firstName ? `Hello ${args.firstName},` : 'Hello,';
  const lead = args.byAdmin
    ? `${args.byAdmin} sent you a link to choose a new password for IronGate QE Navigator.`
    : 'Someone asked to reset the password of your IronGate QE Navigator account.';
  const fine = `The link works once and expires in ${RESET_TTL_MINUTES} minutes. If you did not ask for this, ignore this e-mail: your password stays the same.`;
  const text = `${hello}\n\n${lead}\n\nChoose a new password:\n${args.link}\n\n${fine}`;
  const html = `<p>${escapeHtml(hello)}</p><p>${escapeHtml(lead)}</p>
<p><a href="${escapeHtml(args.link)}">Choose a new password</a></p>
<p style="color:#475569;font-size:13px">${escapeHtml(fine)}</p>`;
  return { subject: 'Reset your IronGate QE Navigator password', text, html };
}

export function renderPasswordChangedEmail(args: { firstName: string | null; email: string }): { subject: string; text: string; html: string } {
  const hello = args.firstName ? `Hello ${args.firstName},` : 'Hello,';
  const lead = `The password of your IronGate QE Navigator account (${args.email}) was just changed with a reset link.`;
  const fine = 'If this was you, there is nothing else to do. If this was not you, contact your administrator straight away.';
  const text = `${hello}\n\n${lead}\n\n${fine}\n\nSign in: ${appBaseUrl()}/`;
  const html = `<p>${escapeHtml(hello)}</p><p>${escapeHtml(lead)}</p><p><strong>${escapeHtml(fine)}</strong></p>
<p><a href="${escapeHtml(`${appBaseUrl()}/`)}">Sign in</a></p>`;
  return { subject: 'Your IronGate QE Navigator password was changed', text, html };
}

/* ------------------------------------------------------------------------------------------
 * Issue a link
 * ---------------------------------------------------------------------------------------- */

/** Close the person's open links, store a new one (hash only) and e-mail it. Never throws on a failed send. */
async function issueAndSend(user: ResetUser, opts: { ip: string | null; requestedBy: { id: string; name: string } | null }): Promise<MailResult> {
  const { token, hash } = newResetToken();
  await transaction(async (client) => {
    const exec = execOn(client);
    await exec('UPDATE password_resets SET revoked_at = now() WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL', [user.id]);
    await exec(
      `INSERT INTO password_resets (user_id, company_id, token_hash, expires_at, ip, requested_by)
       VALUES (?, ?, ?, now() + make_interval(mins => ?), ?, ?)`,
      [user.id, user.company_id, hash, RESET_TTL_MINUTES, opts.ip ? opts.ip.slice(0, 64) : null, opts.requestedBy?.id ?? null]
    );
    await recordAudit({
      companyId: user.company_id, actorId: opts.requestedBy?.id ?? user.id, action: 'user.password_reset_request', entityType: 'user', entityId: user.id,
      summary: opts.requestedBy
        ? `Sent a password reset link to ${nameOf(user)}`
        : `Password reset requested by ${nameOf(user)} (link e-mailed)`,
      departmentIds: [user.department_id, ...(user.department_ids ?? [])], subjectIds: [user.id],
    }, exec);
  });
  const mail = renderResetEmail({ firstName: user.first_name, link: resetLink(token), byAdmin: opts.requestedBy?.name ?? null });
  return sendMail({ to: user.email, ...mail });
}

/**
 * Self-service request. Returns the user id when a link was sent (for the user activity log only;
 * the HTTP answer is the same either way), null otherwise (unknown e-mail or inactive account).
 */
export async function requestPasswordReset(email: unknown, ip: string | null): Promise<string | null> {
  if (typeof email !== 'string') return null;
  const clean = email.trim();
  if (!clean || clean.length > 255 || !/^[^\s@]+@[^\s@]+$/.test(clean)) return null;
  const user = await queryOne<ResetUser>(`SELECT ${USER_COLUMNS('u')} FROM users u WHERE LOWER(u.email) = LOWER(?)`, [clean]);
  if (!user || !user.is_active) return null;
  const mail = await issueAndSend(user, { ip, requestedBy: null });
  if (!mail.delivered) console.warn(`[password-reset] reset e-mail not delivered (${mail.channel})`);
  return user.id;
}

/** Administrator sends the link (the route checks canResetPassword). */
export async function sendResetLinkByAdmin(target: ResetUser, admin: { id: string; name: string }): Promise<MailResult> {
  return issueAndSend(target, { ip: null, requestedBy: admin });
}

export async function loadResetTarget(userId: string, companyId: string, exec: Exec = execOn()): Promise<ResetUser | null> {
  const [u] = await exec<ResetUser>(`SELECT ${USER_COLUMNS('u')} FROM users u WHERE u.id = ? AND u.company_id = ?`, [userId, companyId]);
  return u ?? null;
}

/* ------------------------------------------------------------------------------------------
 * Use a link
 * ---------------------------------------------------------------------------------------- */

const INVALID = 'This reset link is not valid. Ask for a new one on the sign-in page.';

/** Basic shape check before touching the database. */
const plausible = (token: unknown): token is string =>
  typeof token === 'string' && token.startsWith(TOKEN_PREFIX) && token.length <= 200;

/**
 * Check a token and set the new password. Throws PasswordResetError (400 weak password, 400 bad
 * link with code invalid / expired / used). `onUser` receives the user id as soon as the token is
 * known (for the user activity log), even when the reset then fails.
 */
export async function completePasswordReset(token: unknown, password: unknown, onUser?: (userId: string) => void): Promise<{ userId: string }> {
  if (!plausible(token)) throw new PasswordResetError(400, INVALID, 'invalid');
  if (typeof password !== 'string') throw new PasswordResetError(400, 'Enter a new password.', 'password');
  const user = await transaction(async (client) => {
    const exec = execOn(client);
    const [row] = await exec<ResetUser & { reset_id: string; used_at: string | null; revoked_at: string | null; expired: boolean }>(
      `SELECT r.id AS reset_id, r.used_at, r.revoked_at, r.expires_at <= now() AS expired, ${USER_COLUMNS('u')}
         FROM password_resets r JOIN users u ON u.id = r.user_id
        WHERE r.token_hash = ?
        FOR UPDATE OF r`,
      [hashResetToken(token)]
    );
    if (!row) throw new PasswordResetError(400, INVALID, 'invalid');
    onUser?.(row.id);
    if (row.used_at) throw new PasswordResetError(400, 'This reset link has already been used. Ask for a new one if you still need it.', 'used');
    if (row.revoked_at) throw new PasswordResetError(400, 'A newer reset link was sent, so this one no longer works. Use the link in the latest e-mail.', 'used');
    if (row.expired) throw new PasswordResetError(400, `This reset link has expired (links work for ${RESET_TTL_MINUTES} minutes). Ask for a new one.`, 'expired');
    if (!row.is_active) throw new PasswordResetError(400, INVALID, 'invalid');
    const problem = passwordProblem(password, row.email);
    if (problem) throw new PasswordResetError(400, problem, 'password');

    const hash = await bcrypt.hash(password, 10);
    await exec('UPDATE users SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = ?', [hash, row.id]);
    await exec('UPDATE password_resets SET used_at = now() WHERE id = ?', [row.reset_id]);
    // Every existing session of the person ends (and their platform support sessions).
    await endUserSessions(row.id, exec);
    await exec('UPDATE password_resets SET revoked_at = now() WHERE user_id = ? AND id <> ? AND used_at IS NULL AND revoked_at IS NULL', [row.id, row.reset_id]);
    await recordAudit({
      companyId: row.company_id, actorId: row.id, action: 'user.password_reset_email', entityType: 'user', entityId: row.id,
      summary: `Password changed via e-mail link by ${nameOf(row)}`,
      departmentIds: [row.department_id, ...(row.department_ids ?? [])], subjectIds: [row.id],
    }, exec);
    return row;
  });
  const mail = await sendMail({ to: user.email, ...renderPasswordChangedEmail({ firstName: user.first_name, email: user.email }) });
  if (!mail.delivered) console.warn(`[password-reset] password-changed e-mail not delivered (${mail.channel})`);
  return { userId: user.id };
}
