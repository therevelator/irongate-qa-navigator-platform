/**
 * The one HTML escaper of the front end. Use it wherever markup has to be built as a
 * string (SweetAlert2 `html:` dialogs): every value that is not a literal in the code —
 * people's names, team / department names, e-mail addresses, server error text — goes
 * through escapeHtml before it is put in the string. Plain text should not be built as
 * HTML at all: use SweetAlert2's `text:` / `titleText:` or React text instead.
 *
 * Escapes the five characters that matter in element content and in quoted attribute
 * values: & < > " '. null / undefined become ''.
 */
const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
