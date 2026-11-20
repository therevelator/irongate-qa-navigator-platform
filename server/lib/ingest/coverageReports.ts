/**
 * Coverage report parsers: lcov, Cobertura XML, JaCoCo XML, Istanbul coverage-final.json and
 * coverage-summary.json (json-summary), into one shape; plus the changed lines of a unified diff
 * (or a changed-lines list) for the coverage of changed code.
 */
import { parseXml, rootElementName, XmlError } from './xml';
import { ReportError } from './testReports';

export const COVERAGE_FORMATS = ['lcov', 'cobertura', 'jacoco', 'istanbul', 'istanbul-summary'] as const;
export type CoverageFormat = typeof COVERAGE_FORMATS[number];

export interface CoverageFile {
  path: string;
  linesFound: number;
  linesHit: number;
  branchesFound: number;
  branchesHit: number;
  /** line number → hits (not for json-summary, which has no per-line data). */
  lines: Map<number, number> | null;
}

export interface ParsedCoverage {
  format: CoverageFormat;
  files: CoverageFile[];
  totals: { linesFound: number; linesHit: number; branchesFound: number; branchesHit: number };
}

export const MAX_COVERAGE_FILES = 100_000;

const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').slice(0, 1000);

function totalsOf(files: CoverageFile[]) {
  const t = { linesFound: 0, linesHit: 0, branchesFound: 0, branchesHit: 0 };
  for (const f of files) { t.linesFound += f.linesFound; t.linesHit += f.linesHit; t.branchesFound += f.branchesFound; t.branchesHit += f.branchesHit; }
  return t;
}

function fromLineMap(path: string, lines: Map<number, number>, branchesFound: number, branchesHit: number): CoverageFile {
  let hit = 0;
  for (const h of lines.values()) if (h > 0) hit++;
  return { path: normPath(path), linesFound: lines.size, linesHit: hit, branchesFound, branchesHit, lines };
}

function guardCount(n: number) {
  if (n > MAX_COVERAGE_FILES) throw new ReportError(`More than ${MAX_COVERAGE_FILES} files in one coverage report`);
}

// ---------------------------------------------------------------------------------------------
// lcov
// ---------------------------------------------------------------------------------------------
export function parseLcov(text: string): ParsedCoverage {
  const files: CoverageFile[] = [];
  let path: string | null = null;
  let lines = new Map<number, number>();
  let lf: number | null = null, lh: number | null = null, brf: number | null = null, brh: number | null = null;
  let bFound = 0, bHit = 0;
  let sawRecord = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    const tag = colon >= 0 ? line.slice(0, colon) : line;
    const val = colon >= 0 ? line.slice(colon + 1) : '';
    if (tag === 'SF') { path = val; lines = new Map(); lf = lh = brf = brh = null; bFound = bHit = 0; }
    else if (tag === 'DA' && path !== null) {
      const [ln, hits] = val.split(',');
      const n = Number(ln), h = Number(hits);
      if (Number.isInteger(n) && Number.isFinite(h)) lines.set(n, Math.max(lines.get(n) ?? 0, h));
    } else if (tag === 'BRDA' && path !== null) {
      const parts = val.split(',');
      bFound++;
      if (parts[3] !== undefined && parts[3] !== '-' && Number(parts[3]) > 0) bHit++;
    } else if (tag === 'LF') lf = Number(val);
    else if (tag === 'LH') lh = Number(val);
    else if (tag === 'BRF') brf = Number(val);
    else if (tag === 'BRH') brh = Number(val);
    else if (tag === 'end_of_record') {
      if (path === null) continue;
      sawRecord = true;
      const f = fromLineMap(path, lines, brf ?? bFound, brh ?? bHit);
      // Without DA lines, the LF/LH summary counts.
      if (lines.size === 0 && lf !== null) { f.linesFound = lf || 0; f.linesHit = lh || 0; f.lines = null; }
      files.push(f);
      guardCount(files.length);
      path = null;
    }
  }
  if (!sawRecord) throw new ReportError('Not an lcov report: no SF … end_of_record section');
  return { format: 'lcov', files, totals: totalsOf(files) };
}

// ---------------------------------------------------------------------------------------------
// Cobertura
// ---------------------------------------------------------------------------------------------
export function parseCobertura(xml: string): ParsedCoverage {
  const byFile = new Map<string, { lines: Map<number, number>; bf: number; bh: number; branchLines: Map<number, [number, number]> }>();
  let root = '';
  let cls: string | null = null;
  let inMethod = 0;
  parseXml(xml, {
    open(name, a) {
      if (!root) { root = name; if (name !== 'coverage') throw new ReportError(`Not a Cobertura report: the root element is <${name}>`); }
      if (name === 'class') {
        cls = normPath(a.filename ?? a.name ?? '');
        if (!byFile.has(cls)) { byFile.set(cls, { lines: new Map(), bf: 0, bh: 0, branchLines: new Map() }); guardCount(byFile.size); }
      } else if (name === 'method') inMethod++;
      else if (name === 'line' && cls !== null && inMethod === 0) {
        const f = byFile.get(cls)!;
        const n = Number(a.number), h = Number(a.hits);
        if (!Number.isInteger(n) || !Number.isFinite(h)) return;
        f.lines.set(n, Math.max(f.lines.get(n) ?? 0, h));
        if ((a.branch ?? '').toLowerCase() === 'true') {
          const m = /\((\d+)\s*\/\s*(\d+)\)/.exec(a['condition-coverage'] ?? '');
          if (m) {
            const prev = f.branchLines.get(n);
            const cov = Number(m[1]), tot = Number(m[2]);
            if (!prev || cov > prev[0]) f.branchLines.set(n, [cov, tot]);
          }
        }
      }
    },
    close(name) {
      if (name === 'class') cls = null;
      else if (name === 'method') inMethod--;
    },
  });
  const files: CoverageFile[] = [];
  for (const [path, f] of byFile) {
    let bf = 0, bh = 0;
    for (const [cov, tot] of f.branchLines.values()) { bh += cov; bf += tot; }
    files.push(fromLineMap(path, f.lines, bf, bh));
  }
  return { format: 'cobertura', files, totals: totalsOf(files) };
}

// ---------------------------------------------------------------------------------------------
// JaCoCo
// ---------------------------------------------------------------------------------------------
export function parseJaCoCo(xml: string): ParsedCoverage {
  const files: CoverageFile[] = [];
  let root = '';
  let pkg = '';
  let src: { path: string; lines: Map<number, number>; bf: number; bh: number; counters: Record<string, [number, number]> } | null = null;
  parseXml(xml, {
    open(name, a) {
      if (!root) { root = name; if (name !== 'report') throw new ReportError(`Not a JaCoCo report: the root element is <${name}>`); }
      if (name === 'package') pkg = a.name ?? '';
      else if (name === 'sourcefile') src = { path: pkg ? `${pkg}/${a.name ?? ''}` : a.name ?? '', lines: new Map(), bf: 0, bh: 0, counters: {} };
      else if (name === 'line' && src) {
        const n = Number(a.nr), mi = Number(a.mi) || 0, ci = Number(a.ci) || 0, mb = Number(a.mb) || 0, cb = Number(a.cb) || 0;
        if (!Number.isInteger(n)) return;
        if (mi + ci > 0) src.lines.set(n, ci);
        src.bf += mb + cb;
        src.bh += cb;
      } else if (name === 'counter' && src) {
        src.counters[a.type ?? ''] = [Number(a.missed) || 0, Number(a.covered) || 0];
      }
    },
    close(name) {
      if (name === 'sourcefile' && src) {
        const f = fromLineMap(src.path, src.lines, src.bf, src.bh);
        if (src.lines.size === 0 && src.counters.LINE) {
          const [m, c] = src.counters.LINE;
          f.linesFound = m + c; f.linesHit = c; f.lines = null;
        }
        if (src.bf === 0 && src.counters.BRANCH) { const [m, c] = src.counters.BRANCH; f.branchesFound = m + c; f.branchesHit = c; }
        files.push(f);
        guardCount(files.length);
        src = null;
      } else if (name === 'package') pkg = '';
    },
  });
  return { format: 'jacoco', files, totals: totalsOf(files) };
}

// ---------------------------------------------------------------------------------------------
// Istanbul (coverage-final.json, coverage-summary.json)
// ---------------------------------------------------------------------------------------------
export function parseIstanbulFinal(doc: Record<string, any>): ParsedCoverage {
  const files: CoverageFile[] = [];
  for (const [key, fc] of Object.entries(doc)) {
    if (!fc || typeof fc !== 'object' || typeof fc.statementMap !== 'object' || typeof fc.s !== 'object') {
      throw new ReportError(`Istanbul coverage-final.json: entry "${key.slice(0, 80)}" has no statementMap / s`);
    }
    const lines = new Map<number, number>();
    for (const [id, loc] of Object.entries<any>(fc.statementMap)) {
      const ln = Number(loc?.start?.line);
      const count = Number(fc.s[id]) || 0;
      if (!Number.isInteger(ln)) continue;
      const prev = lines.get(ln);
      if (prev === undefined || prev < count) lines.set(ln, count);
    }
    let bf = 0, bh = 0;
    for (const arr of Object.values<any>(fc.b ?? {})) {
      if (!Array.isArray(arr)) continue;
      for (const n of arr) { bf++; if (Number(n) > 0) bh++; }
    }
    files.push(fromLineMap(String(fc.path ?? key), lines, bf, bh));
    guardCount(files.length);
  }
  return { format: 'istanbul', files, totals: totalsOf(files) };
}

export function parseIstanbulSummary(doc: Record<string, any>): ParsedCoverage {
  const files: CoverageFile[] = [];
  for (const [key, v] of Object.entries(doc)) {
    if (key === 'total') continue;
    if (!v || typeof v !== 'object' || !v.lines) throw new ReportError(`coverage-summary.json: entry "${key.slice(0, 80)}" has no "lines"`);
    files.push({
      path: normPath(key),
      linesFound: Number(v.lines.total) || 0, linesHit: Number(v.lines.covered) || 0,
      branchesFound: Number(v.branches?.total) || 0, branchesHit: Number(v.branches?.covered) || 0,
      lines: null,
    });
    guardCount(files.length);
  }
  // A summary with only "total" still has the totals.
  let totals = totalsOf(files);
  if (!files.length && doc.total?.lines) {
    totals = {
      linesFound: Number(doc.total.lines.total) || 0, linesHit: Number(doc.total.lines.covered) || 0,
      branchesFound: Number(doc.total.branches?.total) || 0, branchesHit: Number(doc.total.branches?.covered) || 0,
    };
  }
  return { format: 'istanbul-summary', files, totals };
}

export function detectCoverageFormat(text: string): CoverageFormat | null {
  const head = text.slice(0, 4096).trimStart();
  if (head.startsWith('{')) {
    if (/"total"\s*:\s*\{\s*"lines"/.test(head) || /"lines"\s*:\s*\{\s*"total"/.test(head)) return 'istanbul-summary';
    if (/"statementMap"/.test(text.slice(0, 256 * 1024))) return 'istanbul';
    return null;
  }
  if (head.startsWith('<')) {
    const root = rootElementName(text);
    if (root === 'coverage') return 'cobertura';
    if (root === 'report') return 'jacoco';
    return null;
  }
  if (/^(TN:|SF:)/m.test(head)) return 'lcov';
  return null;
}

export function parseCoverageReport(text: string, format: CoverageFormat): ParsedCoverage {
  try {
    if (format === 'lcov') return parseLcov(text);
    if (format === 'cobertura') return parseCobertura(text);
    if (format === 'jacoco') return parseJaCoCo(text);
    let doc: unknown;
    try { doc = JSON.parse(text); } catch { throw new ReportError('Istanbul report is not valid JSON'); }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new ReportError('Istanbul report must be a JSON object keyed by file');
    return format === 'istanbul' ? parseIstanbulFinal(doc as any) : parseIstanbulSummary(doc as any);
  } catch (e) {
    if (e instanceof XmlError) throw new ReportError(`Invalid XML: ${e.message}`);
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Changed lines (unified diff or a list)
// ---------------------------------------------------------------------------------------------
export type ChangedLines = Map<string, Set<number>>;

/** The added / modified lines (new-file line numbers) per file of a unified diff. */
export function parseUnifiedDiff(diff: string): ChangedLines {
  const out: ChangedLines = new Map();
  let file: string | null = null;
  let newLine = 0;
  let inHunk = false;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      let p = line.slice(4).trim().split('\t')[0];
      if (p === '/dev/null') { file = null; continue; }
      if (p.startsWith('b/')) p = p.slice(2);
      file = normPath(p);
      inHunk = false;
      continue;
    }
    if (line.startsWith('diff --git') || line.startsWith('--- ')) { inHunk = false; continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h) { newLine = Number(h[1]); inHunk = true; continue; }
    if (!inHunk || file === null) continue;
    if (line.startsWith('+')) {
      if (!out.has(file)) out.set(file, new Set());
      out.get(file)!.add(newLine);
      newLine++;
    } else if (line.startsWith('-')) { /* removed: no new line */ }
    else if (line.startsWith('\\')) { /* "\ No newline at end of file" */ }
    else newLine++;
  }
  return out;
}

/** {"path": [3, 4, "10-12"], …} or {"files": {…}} → changed lines. */
export function parseChangedLinesList(json: string): ChangedLines {
  let doc: any;
  try { doc = JSON.parse(json); } catch { throw new ReportError('changedLines must be JSON: {"path/to/file": [12, 13, "20-24"]}'); }
  if (doc && typeof doc === 'object' && doc.files && typeof doc.files === 'object') doc = doc.files;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new ReportError('changedLines must be an object of {file: [line numbers or "from-to" ranges]}');
  const out: ChangedLines = new Map();
  for (const [p, list] of Object.entries(doc)) {
    if (!Array.isArray(list)) throw new ReportError(`changedLines: "${p.slice(0, 80)}" must be an array`);
    const set = new Set<number>();
    for (const v of list) {
      if (typeof v === 'number' && Number.isInteger(v) && v > 0) set.add(v);
      else if (typeof v === 'string' && /^\d+-\d+$/.test(v)) {
        const [a, b] = v.split('-').map(Number);
        if (b - a > 100_000) throw new ReportError('changedLines: range too large');
        for (let n = a; n <= b; n++) set.add(n);
      } else throw new ReportError(`changedLines: invalid line "${String(v).slice(0, 20)}" for "${p.slice(0, 80)}"`);
    }
    out.set(normPath(p), set);
  }
  return out;
}

/** Coverage paths are often absolute (CI workspace); diff paths relative to the repository root. */
export function pathsMatch(coveragePath: string, diffPath: string): boolean {
  return coveragePath === diffPath || coveragePath.endsWith(`/${diffPath}`) || diffPath.endsWith(`/${coveragePath}`);
}

/** Per file and in total: found / hit over the changed lines that are coverable. */
export function changedCoverage(cov: ParsedCoverage, changed: ChangedLines): { found: number; hit: number; perFile: Map<string, { found: number; hit: number }> } {
  const perFile = new Map<string, { found: number; hit: number }>();
  let found = 0, hit = 0;
  const diffPaths = Array.from(changed.keys());
  for (const f of cov.files) {
    if (!f.lines) continue;
    const dp = diffPaths.find((d) => pathsMatch(f.path, d));
    if (!dp) continue;
    let ff = 0, fh = 0;
    for (const ln of changed.get(dp)!) {
      const h = f.lines.get(ln);
      if (h === undefined) continue; // not a coverable line (comment, blank)
      ff++;
      if (h > 0) fh++;
    }
    perFile.set(f.path, { found: ff, hit: fh });
    found += ff; hit += fh;
  }
  return { found, hit, perFile };
}

/** Several coverage files of one run (e.g. one JaCoCo report per module) as one report. */
export function mergeCoverage(a: ParsedCoverage, b: ParsedCoverage): ParsedCoverage {
  const files = a.files.concat(b.files);
  guardCount(files.length);
  return { format: a.format, files, totals: totalsOf(files) };
}
