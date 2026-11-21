/**
 * Display names: people's first / last names, team, department and company names.
 *
 * These values are shown all over the app and in e-mails, Slack messages, PDFs and
 * CSV exports. The front end renders them as text (and escapes them where markup is
 * built, src/lib/escapeHtml.ts), so this is defence in depth: a name that looks like
 * markup is refused at the door instead of relying on every renderer to get it right.
 *
 * Rules (validateDisplayName):
 *   - must be a string; surrounding whitespace is trimmed
 *   - 1 to 100 characters after trimming (maxLength can lower or raise it for one field)
 *   - no `<` or `>`
 *   - no control characters (C0 U+0000–U+001F, DEL, C1 U+0080–U+009F) and no
 *     line / paragraph separators (U+2028, U+2029)
 *
 * Apostrophes, hyphens, ampersands, accents and non-Latin scripts are all allowed
 * ("O'Brien", "R&D", "José", "Zoë", "李").
 *
 * SSO-provisioned names come from the identity provider and are not typed by the
 * person, so they are normalised instead of refused (normaliseDisplayName).
 */

export const DISPLAY_NAME_MAX = 100;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;
// eslint-disable-next-line no-control-regex
const CONTROL_ALL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
const ANGLE = /[<>]/;

export type DisplayNameResult = { ok: true; value: string; error?: undefined } | { ok: false; value?: undefined; error: string };

export function validateDisplayName(raw: unknown, label = 'Name', maxLength = DISPLAY_NAME_MAX): DisplayNameResult {
  if (typeof raw !== 'string') return { ok: false, error: `${label} is required` };
  const value = raw.trim();
  if (!value) return { ok: false, error: `${label} is required` };
  if (value.length > maxLength) return { ok: false, error: `${label} must be at most ${maxLength} characters` };
  if (ANGLE.test(value)) return { ok: false, error: `${label} cannot contain < or >` };
  if (CONTROL.test(value)) return { ok: false, error: `${label} cannot contain control characters or line breaks` };
  return { ok: true, value };
}

/**
 * For names that arrive from an identity provider: control characters become spaces,
 * `<` and `>` are dropped, runs of whitespace collapse, and the result is trimmed and
 * cut to maxLength. Returns '' when nothing usable is left (the caller picks a fallback).
 */
export function normaliseDisplayName(raw: unknown, maxLength = DISPLAY_NAME_MAX): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(CONTROL_ALL, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}
