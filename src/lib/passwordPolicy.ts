/**
 * Password strength rules: the ONE definition used by the server (registration, accepting an
 * invitation, reset links, and passwords set by an admin or a platform operator) and by the UI
 * (live checklists, help text). Pure, no dependencies.
 *
 *   at least 10 characters (at most 128)
 *   at least three of: lower-case letter, upper-case letter, digit, symbol
 *   does not contain the part of the email address before the @ (4+ characters)
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordCheck {
  key: 'length' | 'variety' | 'email';
  label: string;
  ok: boolean;
}

export function passwordChecks(password: string, email?: string | null): PasswordCheck[] {
  const p = password ?? '';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  const local = (email ?? '').split('@')[0]?.toLowerCase() ?? '';
  return [
    { key: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, ok: p.length >= PASSWORD_MIN_LENGTH && p.length <= PASSWORD_MAX_LENGTH },
    { key: 'variety', label: 'Three of: lower case, upper case, number, symbol', ok: classes >= 3 },
    { key: 'email', label: 'Does not contain your email name', ok: local.length < 4 || !p.toLowerCase().includes(local) },
  ];
}

/** The rules in one line, for help text under a password field (admin and operator forms). */
export const PASSWORD_RULES_TEXT = `${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters, with three of: lower case, upper case, number, symbol; not the email name.`;

/** The first rule the password breaks, as a sentence; null when it is strong enough. */
export function passwordProblem(password: string, email?: string | null): string | null {
  const bad = passwordChecks(password, email).find((c) => !c.ok);
  if (!bad) return null;
  if (bad.key === 'length') return `The password must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters long.`;
  if (bad.key === 'variety') return 'The password must contain three of: a lower-case letter, an upper-case letter, a number, a symbol.';
  return 'The password must not contain your email name.';
}
