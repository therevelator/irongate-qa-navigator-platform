/**
 * CSV reading for file uploads (Admin console → Upload files): the exports of Jira, Linear, PagerDuty,
 * Opsgenie and the QE Navigator templates, as people get them from their tools.
 *
 *   - a UTF-8 byte order mark is removed; UTF-16 (LE / BE, with a BOM, as Excel's "Unicode text" saves)
 *     is decoded;
 *   - the separator is detected from the header line: comma, semicolon (locales where the comma is the
 *     decimal mark), tab or pipe;
 *   - quoted fields may hold separators, doubled quotes and line breaks (Jira descriptions, comments);
 *   - repeated column names are kept apart (Jira repeats Sprint, Labels, Component/s, Comment);
 *   - limits: at most MAX_ROWS rows, MAX_COLUMNS columns and MAX_CELL characters per cell (longer cells
 *     are cut: only descriptions and comments are that long, and they are never kept).
 * Cells are data only: nothing is evaluated (a cell starting with "=" is text).
 *
 * Dates: parseDate() reads ISO 8601, epoch milliseconds / seconds and the formats of Jira's CSV export
 * ("21/Nov/26 3:45 PM", month names in English, German, French, Spanish, Dutch, Portuguese, Italian),
 * day/month/year and month/day/year with "/", "." or "-" (order detected per column by detectDateOrder,
 * or chosen in the preview), with an optional time; a time without a zone is UTC unless an offset is given.
 */
export const MAX_ROWS = 50_000;
export const MAX_COLUMNS = 500;
export const MAX_CELL = 32_768;

export class CsvError extends Error {}

export interface Csv {
  delimiter: string;
  headers: string[];
  rows: string[][];
  /** Data rows whose number of cells differs from the header (kept, padded / cut). */
  ragged: number;
}

/** Text of a file: UTF-8 (BOM removed) or UTF-16 with a BOM. */
export function decodeText(b: Buffer): string {
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    const swapped = Buffer.from(b.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  const s = b.toString('utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** The separator of the header line (outside quotes): the most frequent of , ; tab |. */
export function detectDelimiter(text: string): string {
  let line = '';
  let q = false;
  for (let i = 0; i < text.length && i < 64 * 1024; i++) {
    const c = text[i];
    if (c === '"') q = !q;
    if (!q && (c === '\n' || c === '\r')) break;
    line += c;
  }
  const count = (d: string) => {
    let n = 0;
    let inQ = false;
    for (const c of line) { if (c === '"') inQ = !inQ; else if (!inQ && c === d) n++; }
    return n;
  };
  const cands = [',', ';', '\t', '|'].map((d) => ({ d, n: count(d) })).sort((a, b) => b.n - a.n);
  return cands[0].n > 0 ? cands[0].d : ',';
}

/** Parse CSV text (RFC 4180 with the tolerances above). The first non-empty row is the header. */
export function parseCsv(input: string, delimiter?: string): Csv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let cellLen = 0;
  let inQuotes = false;
  let i = 0;
  const pushCell = () => {
    if (row.length >= MAX_COLUMNS) throw new CsvError(`Too many columns: at most ${MAX_COLUMNS}`);
    row.push(cell);
    cell = '';
    cellLen = 0;
  };
  const pushRow = () => {
    pushCell();
    if (!(row.length === 1 && row[0].trim() === '')) {
      rows.push(row);
      if (rows.length > MAX_ROWS + 1) throw new CsvError(`Too many rows: at most ${MAX_ROWS.toLocaleString('en-GB')} per file (export in parts)`);
    }
    row = [];
  };
  const add = (c: string) => { if (cellLen < MAX_CELL) { cell += c; cellLen++; } };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { add('"'); i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      add(c); i++; continue;
    }
    if (c === '"' && cell.trim() === '') { cell = ''; cellLen = 0; inQuotes = true; i++; continue; }
    if (c === d) { pushCell(); i++; continue; }
    if (c === '\r') { pushRow(); i += text[i + 1] === '\n' ? 2 : 1; continue; }
    if (c === '\n') { pushRow(); i++; continue; }
    add(c); i++;
  }
  if (inQuotes) throw new CsvError('The file ends inside a quoted value (a quote is not closed)');
  if (cell !== '' || row.length) pushRow();
  if (!rows.length) throw new CsvError('The file is empty');
  const headers = rows[0].map((h) => h.replace(/^﻿/, '').trim());
  let ragged = 0;
  const data = rows.slice(1).map((r) => {
    if (r.length !== headers.length) ragged++;
    return r.length >= headers.length ? r.slice(0, headers.length) : [...r, ...Array(headers.length - r.length).fill('')];
  });
  return { delimiter: d, headers, rows: data, ragged };
}

/** A header in a comparable form: lower case, accents removed, only letters and digits. */
export function normHeader(h: string): string {
  return h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

const MONTHS: Record<string, number> = {};
[
  ['jan', 'january', 'janv', 'janvier', 'januar', 'jän', 'jaen', 'ene', 'enero', 'gen', 'gennaio', 'januari', 'janeiro'],
  ['feb', 'february', 'fev', 'fevr', 'fevrier', 'februar', 'febrero', 'febbraio', 'februari', 'fevereiro'],
  ['mar', 'march', 'mars', 'marz', 'maerz', 'mrz', 'marzo', 'maart', 'marco'],
  ['apr', 'april', 'avr', 'avril', 'abr', 'abril', 'aprile'],
  ['may', 'mai', 'mayo', 'mag', 'maggio', 'mei', 'maio'],
  ['jun', 'june', 'juin', 'juni', 'junio', 'giu', 'giugno', 'junho'],
  ['jul', 'july', 'juil', 'juillet', 'juli', 'julio', 'lug', 'luglio', 'julho'],
  ['aug', 'august', 'aout', 'ago', 'agosto', 'augustus'],
  ['sep', 'sept', 'september', 'septembre', 'septiembre', 'set', 'settembre', 'setembro'],
  ['oct', 'october', 'octobre', 'okt', 'oktober', 'octubre', 'ott', 'ottobre', 'out', 'outubro'],
  ['nov', 'november', 'novembre', 'noviembre', 'novembro'],
  ['dec', 'december', 'decembre', 'dez', 'dezember', 'dic', 'diciembre', 'dicembre', 'dezembro'],
].forEach((names, m) => names.forEach((n) => { MONTHS[n] = m; }));

const monthOf = (s: string): number | null => {
  const k = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\.$/, '');
  return k in MONTHS ? MONTHS[k] : null;
};

/** "+01:00", "-0530", "Z", "UTC" → minutes east of UTC; null when not an offset. */
export function parseOffset(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = s.trim().toUpperCase();
  if (t === 'Z' || t === 'UTC' || t === 'GMT') return 0;
  const m = /^(?:UTC|GMT)?([+-])(\d{1,2}):?(\d{2})?$/.exec(t);
  if (!m) return null;
  const v = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return v > 14 * 60 ? null : (m[1] === '-' ? -v : v);
}

function build(y: number, mo: number, d: number, h: number, mi: number, s: number, offsetMin: number): Date | null {
  if (y < 100) y += 2000;
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const ms = Date.UTC(y, mo, d, h, mi, s) - offsetMin * 60_000;
  const dt = new Date(ms);
  if (dt.getUTCDate() !== new Date(Date.UTC(y, mo, d)).getUTCDate()) return null;
  return dt;
}

const TIME = String.raw`(?:[ T,]+(\d{1,2})[:.h](\d{2})(?:[:.](\d{2}))?(?:[.,]\d+)?\s*([AaPp]\.?[Mm]\.?)?)?\s*(Z|[+-]\d{2}:?\d{2}|UTC|GMT)?`;
const RE_NAMED = new RegExp(String.raw`^(\d{1,2})[/\-. ]([A-Za-zÀ-ÿ]{3,10}\.?)[/\-. ](\d{2,4})${TIME}$`);
const RE_NAMED_MDY = new RegExp(String.raw`^([A-Za-zÀ-ÿ]{3,10}\.?)[ ](\d{1,2}),?[ ](\d{4})${TIME}$`);
const RE_NUM = new RegExp(String.raw`^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})${TIME}$`);

const hour = (h: string | undefined, ampm: string | undefined) => {
  let x = Number(h ?? 0);
  if (ampm) {
    const pm = /^p/i.test(ampm);
    if (x === 12) x = pm ? 12 : 0; else if (pm) x += 12;
  }
  return x;
};

/**
 * One date / time cell → Date, or null when empty; undefined when it is not a date.
 * order: the order of a numeric date (detected per column); offsetMin: the zone of times without one.
 */
export function parseDate(v: string | null | undefined, order: DateOrder = 'dmy', offsetMin = 0): Date | null | undefined {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (/^\d{12,14}$/.test(s)) return new Date(Number(s));
  if (/^\d{9,11}$/.test(s)) return new Date(Number(s) * 1000);
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)) {
    const iso = s.replace(' ', 'T');
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(iso) && iso.length > 10;
    if (hasZone) { const d = new Date(iso.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')); return Number.isNaN(d.getTime()) ? undefined : d; }
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(iso)!;
    return build(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), offsetMin) ?? undefined;
  }
  let m = RE_NAMED.exec(s);
  if (m) {
    const mo = monthOf(m[2]);
    if (mo === null) return undefined;
    const off = parseOffset(m[8]) ?? offsetMin;
    return build(Number(m[3]), mo, Number(m[1]), hour(m[4], m[7]), Number(m[5] ?? 0), Number(m[6] ?? 0), off) ?? undefined;
  }
  m = RE_NAMED_MDY.exec(s);
  if (m) {
    const mo = monthOf(m[1]);
    if (mo === null) return undefined;
    const off = parseOffset(m[8]) ?? offsetMin;
    return build(Number(m[3]), mo, Number(m[2]), hour(m[4], m[7]), Number(m[5] ?? 0), Number(m[6] ?? 0), off) ?? undefined;
  }
  m = RE_NUM.exec(s);
  if (m) {
    const a = Number(m[1]); const b = Number(m[2]); const c = Number(m[3]);
    const off = parseOffset(m[8]) ?? offsetMin;
    const h = hour(m[4], m[7]); const mi = Number(m[5] ?? 0); const sec = Number(m[6] ?? 0);
    if (m[1].length === 4) return build(a, b - 1, c, h, mi, sec, off) ?? undefined;
    if (order === 'mdy') return build(c, a - 1, b, h, mi, sec, off) ?? undefined;
    return build(c, b - 1, a, h, mi, sec, off) ?? undefined;
  }
  const d = Date.parse(s);
  return Number.isNaN(d) ? undefined : new Date(d);
}

/**
 * The order of numeric dates in a column: day first when a first part is above 12, month first when a
 * second part is; null when every value fits both (ambiguous: the preview asks).
 */
export function detectDateOrder(values: string[]): { order: DateOrder; ambiguous: boolean } {
  let dayFirst = false;
  let monthFirst = false;
  let numeric = false;
  for (const v of values) {
    const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec((v ?? '').trim());
    if (!m) continue;
    numeric = true;
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return { order: 'dmy', ambiguous: false };
  if (monthFirst && !dayFirst) return { order: 'mdy', ambiguous: false };
  return { order: 'dmy', ambiguous: numeric && !(dayFirst && monthFirst) };
}

/** A number cell: "3", "3.5", "3,5" (decimal comma), "1 234,5", "1,234.5"; null when empty, NaN when not a number. */
export function parseNumber(v: string | null | undefined): number | null {
  const s = (v ?? '').trim().replace(/[\s ']/g, '');
  if (!s) return null;
  let t = s;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** A duration cell in seconds (Jira's time fields) or as "1w 2d 3h 30m" / "2h" / "1.5h" (hours returned). */
export function parseDurationHours(v: string | null | undefined, plainUnit: 'seconds' | 'hours' = 'seconds'): number | null | undefined {
  const s = (v ?? '').trim();
  if (!s) return null;
  const n = parseNumber(s);
  if (n !== null && !Number.isNaN(n)) return n < 0 ? undefined : Math.round((plainUnit === 'seconds' ? n / 3600 : n) * 100) / 100;
  const re = /(\d+(?:[.,]\d+)?)\s*(w|d|h|m)\b/gi;
  let total = 0;
  let any = false;
  let x: RegExpExecArray | null;
  while ((x = re.exec(s))) {
    any = true;
    const q = Number(x[1].replace(',', '.'));
    const u = x[2].toLowerCase();
    total += u === 'w' ? q * 40 : u === 'd' ? q * 8 : u === 'h' ? q : q / 60;
  }
  return any ? Math.round(total * 100) / 100 : undefined;
}
