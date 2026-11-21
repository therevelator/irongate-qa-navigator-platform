import { queryOne } from '../../src/lib/db';
import { isOperatorEmail } from './operator';
import { EMAIL_RE } from './invitations';

/**
 * Changing a user's sign-in e-mail address (one rule for every route that may do it).
 *
 * Who: the person themselves (PUT /api/users/:id, or their own row on the Users page) and a
 * super admin of the company (PUT /api/admin/users/:id). Nobody else: a manager or team lead who
 * could change someone's e-mail could then send a reset link to an address they own
 * (userPolicy.canChangeUserEmail).
 *
 * The new address must be a valid e-mail address (the same check as invitations and
 * registration), at most 255 characters, not a platform operator's address (an operator is never a
 * company user) and not used by another account. It is stored trimmed and in lower case.
 *
 * After a change every OTHER session of that person ends (server/lib/sessions.ts endUserSessions;
 * the caller re-issues the current browser's cookie when the person changed their own address).
 * There is no confirmation e-mail to the new address (no verification flow exists); ending the
 * other sessions means a stolen session cannot quietly move the account to a new address and keep
 * a foothold elsewhere, and every change is in the change history.
 */
/** ok: the address to store (email); otherwise the HTTP status and message (status, error). */
export interface EmailCheck { ok: boolean; email: string; status: number; error: string }

export async function checkNewEmail(raw: unknown, userId: string): Promise<EmailCheck> {
  if (typeof raw !== 'string') return { ok: false, email: '', status: 400, error: 'Enter a valid email address' };
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 255 || !EMAIL_RE.test(email)) return { ok: false, email: '', status: 400, error: 'Enter a valid email address' };
  if (await isOperatorEmail(email)) return { ok: false, email: '', status: 409, error: 'This e-mail address cannot be used for a company account.' };
  const clash = await queryOne<any>('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?', [email, userId]);
  if (clash) return { ok: false, email: '', status: 400, error: 'Email already registered' };
  return { ok: true, email, status: 200, error: '' };
}

/** Is `raw` (a request field) a different address from `current` (case-insensitive, trimmed)? */
export function isEmailChange(raw: unknown, current: string | null | undefined): boolean {
  if (raw === undefined || raw === null) return false;
  if (typeof raw !== 'string') return true;
  return raw.trim().toLowerCase() !== String(current ?? '').trim().toLowerCase();
}
