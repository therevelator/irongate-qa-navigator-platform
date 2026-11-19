import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import { queryOne, transaction } from '../../src/lib/db';
import { execOn, resolveGrant, grantAssignment, syncUserDisplay, AssignmentError, type Exec } from './assignments';
import { recordAudit } from './audit';
import { sendMail, escapeHtml, type MailResult } from './mailer';
import { appBaseUrl } from './sso';
import { passwordProblem } from '../../src/lib/passwordPolicy';
import type { Grant } from './userPolicy';
import { ROLE_LABELS } from './roleLabels';

/**
 * Invitations (table invitations): invite a person by email to exactly one role assignment.
 *
 * Tokens: 32 random bytes (base64url, prefix "igi_"), sent only in the link
 * APP_URL/accept-invite?token=…; the database stores only their sha256. A token is single-use
 * (accepting sets accepted_at in the same statement that checks it is still open), expires
 * (INVITE_TTL_HOURS, default 168 = 7 days) and can be revoked; resending replaces the token, so
 * the previous link stops working. Accepting creates the user and grants exactly the invited
 * assignment, in one transaction.
 */

export const INVITE_TTL_HOURS = () => Math.min(Math.max(Number(process.env.INVITE_TTL_HOURS) || 168, 1), 24 * 30);

export function newToken(): { token: string; hash: string } {
  const token = `igi_${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashToken(token) };
}
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const inviteLink = (token: string) => `${appBaseUrl()}/accept-invite?token=${encodeURIComponent(token)}`;

export type InvitationStatus = 'open' | 'expired' | 'accepted' | 'revoked';
export const statusSql = (a = 'i') =>
  `CASE WHEN ${a}.accepted_at IS NOT NULL THEN 'accepted' WHEN ${a}.revoked_at IS NOT NULL THEN 'revoked' WHEN ${a}.expires_at <= now() THEN 'expired' ELSE 'open' END`;

/** Role display names (server/lib/roleLabels.ts). */
export const ROLE_NAMES = ROLE_LABELS;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class InvitationError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

/**
 * Re-send: a new token replaces the old one (the previous link stops working), the expiry starts
 * again, and the change is recorded in the change history. Shared by the Users page
 * (POST /api/admin/invitations/:id/resend) and the platform operator panel. Returns the new token
 * for the e-mail; null when the invitation was accepted or revoked meanwhile.
 */
export async function reissueInvitation(args: { companyId: string; invitation: { id: string; email: string; department_id: string | null }; actorId: string | null; summary?: string }): Promise<{ token: string; expiresAt: Date } | null> {
  const { token, hash } = newToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS() * 3600 * 1000);
  const updated = await queryOne<any>(
    `UPDATE invitations SET token_hash = ?, expires_at = ?, last_sent_at = now(), send_count = send_count + 1
      WHERE id = ? AND company_id = ? AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
    [hash, expiresAt.toISOString(), args.invitation.id, args.companyId]
  );
  if (!updated) return null;
  await recordAudit({
    companyId: args.companyId, actorId: args.actorId, action: 'invitation.resend', entityType: 'invitation', entityId: args.invitation.id,
    summary: args.summary ?? `Re-sent the invitation to ${args.invitation.email} (new link; the previous one no longer works)`, after: { expiresAt },
    departmentIds: [args.invitation.department_id], subjectIds: [args.invitation.id],
  });
  return { token, expiresAt };
}

/** The invitation behind a token (any status), with names for the accept page. */
export async function findByToken(token: unknown) {
  if (typeof token !== 'string' || !token.startsWith('igi_') || token.length > 200) return null;
  return queryOne<any>(
    `SELECT i.*, ${statusSql('i')} AS status, c.name AS company_name,
            CASE i.scope_type WHEN 'company' THEN c.name WHEN 'department' THEN d.name ELSE t.name END AS scope_name,
            NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS invited_by_name
       FROM invitations i
       JOIN companies c ON c.id = i.company_id
       LEFT JOIN departments d ON i.scope_type = 'department' AND d.id = i.scope_id
       LEFT JOIN teams t ON i.scope_type = 'team' AND t.id = i.scope_id
       LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.token_hash = ?`,
    [hashToken(token)]
  );
}

const STATUS_MESSAGE: Record<string, string> = {
  expired: 'This invitation has expired. Ask the person who invited you to send a new one.',
  accepted: 'This invitation has already been used. Sign in with your account instead.',
  revoked: 'This invitation was withdrawn. Ask your administrator if you still need access.',
};
export const statusMessage = (s: string) => STATUS_MESSAGE[s] ?? 'This invitation link is not valid.';

/** Send (or re-send) the invitation email. Never throws: a failed send is reported to the caller. */
export async function sendInvitationEmail(args: {
  to: string; token: string; companyName: string; inviterName: string | null; role: string; scopeName: string | null; expiresAt: Date;
}): Promise<MailResult & { link: string }> {
  const link = inviteLink(args.token);
  const what = `${ROLE_NAMES[args.role] ?? args.role}${args.scopeName ? ` of ${args.scopeName}` : ''}`;
  const by = args.inviterName ? `${args.inviterName} invited you` : 'You are invited';
  const expires = args.expiresAt.toUTCString();
  const text = `${by} to join ${args.companyName} on QE Navigator as ${what}.\n\nAccept the invitation and choose your password:\n${link}\n\nThe link works once and expires on ${expires}. If you did not expect this email, ignore it.`;
  const html = `<p>${escapeHtml(by)} to join <strong>${escapeHtml(args.companyName)}</strong> on QE Navigator as ${escapeHtml(what)}.</p>
<p><a href="${escapeHtml(link)}">Accept the invitation</a> and choose your password.</p>
<p style="color:#475569;font-size:13px">The link works once and expires on ${escapeHtml(expires)}. If you did not expect this email, ignore it.</p>`;
  const result = await sendMail({ to: args.to, subject: `Invitation to ${args.companyName} on QE Navigator`, text, html });
  return { ...result, link };
}

/** Department of the new user (users.department_id is required). */
async function departmentFor(exec: Exec, companyId: string, grant: Grant): Promise<string | null> {
  if (grant.scopeType === 'department') return grant.scopeId;
  if (grant.scopeType === 'team') {
    const [t] = await exec<any>('SELECT department_id FROM teams WHERE id = ?', [grant.scopeId]);
    return t?.department_id ?? null;
  }
  const [d] = await exec<any>('SELECT id FROM departments WHERE company_id = ? AND is_active = TRUE ORDER BY created_at NULLS LAST, name LIMIT 1', [companyId]);
  return d?.id ?? null;
}

/**
 * Accept an invitation: claim the token (single statement: open + not expired + not used),
 * create the user and grant exactly the invited assignment. `password` null = SSO (an unusable
 * random password hash; the person signs in with their provider).
 */
export async function acceptInvitation(args: {
  /** The token from the link, or (SSO matched by verified email) the invitation id. */
  token?: string | null; invitationId?: string | null; firstName: string; lastName: string; password: string | null; sso?: { provider: string; subject: string } | null;
  /** SSO: the verified email must be the invited one. */
  verifiedEmail?: string | null;
}): Promise<{ userId: string; companyId: string }> {
  const first = args.firstName.trim();
  const last = args.lastName.trim();
  if (!first || !last || first.length > 100 || last.length > 100) throw new InvitationError(400, 'Enter your first and last name (up to 100 characters each).');
  return transaction(async (client) => {
    const exec = execOn(client);
    const byId = !args.token && !!args.invitationId;
    const [inv] = await exec<any>(
      `UPDATE invitations SET accepted_at = now()
        WHERE ${byId ? 'id = ?' : 'token_hash = ?'} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING *`,
      [byId ? args.invitationId : hashToken(String(args.token ?? ''))]
    );
    if (!inv) {
      const found = byId ? null : await findByToken(args.token);
      throw new InvitationError(found ? 410 : 404, found ? statusMessage(found.status) : 'This invitation link is not valid.', found?.status ?? 'invalid');
    }
    // A suspended organisation (companies.status) admits nobody new (the transaction rolls back).
    const [co] = await exec<any>('SELECT status FROM companies WHERE id = ?', [inv.company_id]);
    if (co?.status === 'suspended') {
      throw new InvitationError(403, "Your organisation's access is suspended. Contact your administrator.", 'company_suspended');
    }
    if (args.verifiedEmail && args.verifiedEmail.toLowerCase() !== String(inv.email).toLowerCase()) {
      throw new InvitationError(403, 'This invitation is for a different email address than the account you signed in with.');
    }
    if (args.password !== null) {
      const problem = passwordProblem(args.password, inv.email);
      if (problem) throw new InvitationError(400, problem);
    }
    const [taken] = await exec<any>('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [inv.email]);
    if (taken) throw new InvitationError(409, 'An account with this email address already exists. Sign in instead.');

    let grant: Grant;
    try {
      grant = (await resolveGrant(inv.company_id, { role: inv.role, scopeType: inv.scope_type, scopeId: inv.scope_id }, exec)).grant;
    } catch (e) {
      if (e instanceof AssignmentError) throw new InvitationError(409, `The invitation cannot be used any more: ${e.message}. Ask for a new invitation.`);
      throw e;
    }
    const departmentId = await departmentFor(exec, inv.company_id, grant);
    if (!departmentId) throw new InvitationError(409, 'The organisation has no active department yet. Ask your administrator to create one.');

    const hash = await bcrypt.hash(args.password ?? randomBytes(32).toString('base64url'), 10);
    const [user] = await exec<any>(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id,
                          created_by, is_active, email_verified, email_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, TRUE, now()) RETURNING id`,
      [inv.email, hash, first, last, inv.role, inv.company_id, departmentId, grant.scopeType === 'team' ? grant.scopeId : null, inv.invited_by]
    );
    try {
      await grantAssignment(exec, { companyId: inv.company_id, userId: user.id, grant, actorId: inv.invited_by });
    } catch (e) {
      if (e instanceof AssignmentError) throw new InvitationError(409, `The invitation cannot be used any more: ${e.message}`);
      throw e;
    }
    await syncUserDisplay(exec, user.id, { primaryTeamId: grant.scopeType === 'team' ? grant.scopeId : null, departmentId, fallbackRole: inv.role });
    await exec('UPDATE invitations SET accepted_user_id = ? WHERE id = ?', [user.id, inv.id]);
    if (args.sso) {
      await exec(`INSERT INTO user_identities (user_id, provider, subject, email, last_login_at) VALUES (?, ?, ?, ?, now())`,
        [user.id, args.sso.provider, args.sso.subject, inv.email]);
    }
    await recordAudit({
      companyId: inv.company_id, actorId: user.id, action: 'invitation.accept', entityType: 'invitation', entityId: inv.id,
      summary: `${first} ${last} (${inv.email}) accepted the invitation as ${ROLE_NAMES[inv.role] ?? inv.role}${args.sso ? ` (${args.sso.provider} sign-in)` : ''}`,
      after: { userId: user.id, grant }, departmentIds: [departmentId], subjectIds: [user.id, inv.id],
    }, exec);
    return { userId: user.id, companyId: inv.company_id };
  });
}

/** The open invitation for an email address (SSO without a token in the link). */
export async function openInvitationForEmail(email: string) {
  return queryOne<any>(
    `SELECT * FROM invitations WHERE LOWER(email) = LOWER(?) AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [email]
  );
}
