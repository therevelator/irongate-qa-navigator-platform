/**
 * CSV export: ONE implementation for the browser (ExportCsvButton on every table / list view)
 * and the server (GET /api/compare/teams.csv).
 *
 *   - RFC 4180: fields with a comma, quote, CR or LF (or leading / trailing spaces) are quoted,
 *     quotes doubled, rows end with CRLF.
 *   - Formula injection (CSV injection): a text cell starting with = + - @ TAB or CR would be run
 *     as a formula by Excel / LibreOffice / Sheets. Such cells get a leading apostrophe ('), the
 *     OWASP recommendation, so they are shown as text. Plain numbers (a JS number, or text that is
 *     only a signed decimal, optionally with a % or unit suffix such as "-3.5%") are not changed.
 *   - Each column may have a raw value next to the shown one: "Coverage" holds the value exactly as
 *     the screen shows it ("82.4%"), "Coverage (raw)" the unrounded number (82.4312).
 *
 * Exports only ever contain what the caller's screen already received from the API, so the
 * API's scope and privacy rules (analytics scope, individual developer rows, minimum group
 * sizes) apply to them unchanged.
 */

export type CsvCell = string | number | boolean | null | undefined | Date;

export interface CsvColumn<T> {
  header: string;
  /** The value as shown on screen (formatted text, or a number shown as is). */
  value: (row: T) => CsvCell;
  /** Optional raw (unformatted) value, exported in an extra "<header> (raw)" column. */
  raw?: (row: T) => CsvCell;
}

/** Text that is only a number (optionally signed, with a % or short unit): never a formula. */
const PLAIN_NUMBER = /^[-+]?\d+(?:[.,]\d+)?(?:e[-+]?\d+)?(?:\s?%|\s?[a-zA-Z/]{1,12})?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

/** One cell, escaped for formula injection and quoted when needed. */
export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : '';
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  else if (v instanceof Date) s = Number.isNaN(v.getTime()) ? '' : v.toISOString();
  else {
    s = String(v);
    if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  }
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header row + one row per item. */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header: string[] = [];
  for (const c of columns) {
    header.push(c.header);
    if (c.raw) header.push(`${c.header} (raw)`);
  }
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    const cells: string[] = [];
    for (const c of columns) {
      cells.push(csvCell(c.value(r)));
      if (c.raw) cells.push(csvCell(c.raw(r)));
    }
    lines.push(cells.join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/** Parse CSV text (RFC 4180, as written by toCsv) into rows of cells. Used by tests and checks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && src[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** File name for an export: irongate-<what>-<YYYY-MM-DD>.csv (lowercase, safe characters). */
export function csvFileName(what: string, date = new Date()): string {
  const slug = what.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'export';
  return `irongate-${slug}-${date.toISOString().slice(0, 10)}.csv`;
}
