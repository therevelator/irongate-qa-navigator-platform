/**
 * Test report parsers: JUnit XML (pytest, Jest, Maven Surefire / Gradle, Playwright, Cypress and
 * other writers), TRX (Visual Studio / dotnet test) and Cucumber JSON, all into one shape.
 */
import { createHash } from 'node:crypto';
import { parseXml, rootElementName, XmlError } from './xml';

export type TestStatus = 'passed' | 'failed' | 'error' | 'skipped';
export const TEST_FORMATS = ['junit', 'trx', 'cucumber'] as const;
export type TestFormat = typeof TEST_FORMATS[number];

export interface TestCase {
  suite: string;
  name: string;
  status: TestStatus;
  durationMs: number;
  /** Failed attempts before the final result inside this run (Surefire flakyFailure / rerunFailure). */
  retries: number;
  message: string | null;
}

export interface ParsedTestReport {
  format: TestFormat;
  /** The time the run started, when the report says so. */
  startedAt: Date | null;
  /** Wall-clock duration of the run (the report's own total), else the sum of the cases. */
  durationMs: number;
  testsDurationMs: number;
  cases: TestCase[];
  counts: { total: number; passed: number; failed: number; errored: number; skipped: number };
}

export class ReportError extends Error {}

export const MAX_TEST_CASES = 250_000;
const MSG = 500;

/** "1.234", "1,234.5" (thousands), "1,5" (decimal comma) → seconds. */
export function parseSeconds(v: string | undefined): number {
  if (!v) return 0;
  let s = v.trim();
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** A timestamp from a report; without a zone it is read as UTC. */
export function parseReportTime(v: string | undefined): Date | null {
  if (!v) return null;
  const s = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v.trim()) ? v.trim() : `${v.trim()}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const testKey = (suite: string, name: string) => createHash('md5').update(`${suite}\u0000${name}`).digest('hex');
export const failureHash = (msg: string | null) => (msg ? createHash('sha1').update(msg.split('\n')[0].slice(0, 300)).digest('hex').slice(0, 16) : null);

function finish(format: TestFormat, cases: TestCase[], startedAt: Date | null, reportDurationMs: number | null): ParsedTestReport {
  const counts = { total: cases.length, passed: 0, failed: 0, errored: 0, skipped: 0 };
  let testsDurationMs = 0;
  for (const c of cases) {
    if (c.status === 'passed') counts.passed++;
    else if (c.status === 'failed') counts.failed++;
    else if (c.status === 'error') counts.errored++;
    else counts.skipped++;
    testsDurationMs += c.durationMs;
  }
  return { format, startedAt, durationMs: Math.round(reportDurationMs ?? testsDurationMs), testsDurationMs: Math.round(testsDurationMs), cases, counts };
}

const clip = (s: string | null | undefined, n = MSG) => (s ? s.trim().slice(0, n) || null : null);

// ---------------------------------------------------------------------------------------------
// JUnit XML
// ---------------------------------------------------------------------------------------------
export function parseJUnit(xml: string): ParsedTestReport {
  const cases: TestCase[] = [];
  const suiteStack: Array<{ name: string; time: number }> = [];
  let rootTime: number | null = null;
  let topSuitesTime = 0;
  let topSuites = 0;
  let startedAt: Date | null = null;
  let current: TestCase | null = null;
  let textBuf = '';
  let collecting = false;
  let root = '';

  parseXml(xml, {
    open(name, a) {
      if (!root) {
        root = name;
        if (name !== 'testsuites' && name !== 'testsuite') throw new ReportError(`Not a JUnit report: the root element is <${name}>, expected <testsuites> or <testsuite>`);
        if (name === 'testsuites' && a.time !== undefined) rootTime = parseSeconds(a.time) * 1000;
      }
      if (name === 'testsuite') {
        if (suiteStack.length === 0) { topSuites++; topSuitesTime += parseSeconds(a.time) * 1000; }
        if (!startedAt && a.timestamp) startedAt = parseReportTime(a.timestamp);
        suiteStack.push({ name: a.name ?? '', time: parseSeconds(a.time) });
      } else if (name === 'testcase') {
        if (cases.length >= MAX_TEST_CASES) throw new ReportError(`More than ${MAX_TEST_CASES} test cases in one report`);
        const suiteName = suiteStack[suiteStack.length - 1]?.name || a.file || '';
        const name = a.name ?? '(unnamed)';
        let cls = a.classname || a.class || '';
        // Jest (classname = the title) and mocha / Cypress (classname = the end of the title) put the test
        // title in classname: the enclosing suite (the file or describe block) is the better suite then.
        if (cls && suiteName && (cls === name || (name.endsWith(cls) && name !== cls))) cls = '';
        const suite = cls || suiteName;
        const st = (a.status ?? '').toLowerCase();
        current = {
          suite: suite.slice(0, 500), name: name.slice(0, 1000),
          status: st === 'skipped' || st === 'disabled' || st === 'notrun' ? 'skipped' : 'passed',
          durationMs: Math.round(parseSeconds(a.time) * 1000), retries: 0, message: null,
        };
      } else if (current) {
        if (name === 'failure' || name === 'error') {
          current.status = name === 'failure' ? 'failed' : 'error';
          current.message = clip(a.message) ?? current.message;
          if (!current.message) { collecting = true; textBuf = ''; }
        } else if (name === 'skipped') {
          if (current.status === 'passed') current.status = 'skipped';
        } else if (name === 'flakyFailure' || name === 'flakyError' || name === 'rerunFailure' || name === 'rerunError') {
          current.retries++;
          if (!current.message) current.message = clip(a.message);
        }
      }
    },
    text(t) {
      if (collecting && textBuf.length < MSG) textBuf += t;
    },
    close(name) {
      if (name === 'testsuite') suiteStack.pop();
      else if ((name === 'failure' || name === 'error') && current && collecting) {
        current.message = clip(textBuf);
        collecting = false;
      } else if (name === 'testcase' && current) {
        // Rerun failures with a final pass are flaky retries; a final failure keeps its status.
        cases.push(current);
        current = null;
      }
    },
  });
  const duration = rootTime !== null && rootTime > 0 ? rootTime : topSuites > 0 && topSuitesTime > 0 ? topSuitesTime : null;
  return finish('junit', cases, startedAt, duration);
}

// ---------------------------------------------------------------------------------------------
// TRX
// ---------------------------------------------------------------------------------------------
/** "00:00:01.2345678" or "1.02:03:04.5" → ms. */
export function parseTimeSpan(v: string | undefined): number {
  if (!v) return 0;
  const m = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(v.trim());
  if (!m) return 0;
  return Math.round(((Number(m[1] ?? 0) * 24 + Number(m[2])) * 3600 + Number(m[3]) * 60 + Number(m[4])) * 1000);
}

const TRX_OUTCOME: Record<string, TestStatus> = {
  passed: 'passed', warning: 'passed', passedbutrunaborted: 'passed',
  failed: 'failed', error: 'error', timeout: 'error', aborted: 'error',
  notexecuted: 'skipped', inconclusive: 'skipped', pending: 'skipped', notrunnable: 'skipped', disconnected: 'skipped', inprogress: 'skipped',
};

export function parseTrx(xml: string): ParsedTestReport {
  const results: Array<TestCase & { testId: string }> = [];
  const classOf = new Map<string, string>();
  let start: Date | null = null;
  let finishAt: Date | null = null;
  let depth = 0;
  let current: (TestCase & { testId: string }) | null = null;
  let inMessage = false;
  let msg = '';
  let unitTestId: string | null = null;
  let root = '';
  parseXml(xml, {
    open(name, a) {
      if (!root) {
        root = name;
        if (name !== 'TestRun') throw new ReportError(`Not a TRX report: the root element is <${name}>, expected <TestRun>`);
      }
      if (name === 'Times') { start = parseReportTime(a.start); finishAt = parseReportTime(a.finish); }
      else if (name === 'UnitTestResult' || name === 'TestResult') {
        depth++;
        if (depth === 1) {
          if (results.length >= MAX_TEST_CASES) throw new ReportError(`More than ${MAX_TEST_CASES} test cases in one report`);
          current = {
            testId: a.testId ?? '', suite: '', name: (a.testName ?? '(unnamed)').slice(0, 1000),
            status: TRX_OUTCOME[(a.outcome ?? '').toLowerCase()] ?? 'skipped',
            durationMs: parseTimeSpan(a.duration), retries: 0, message: null,
          };
        }
      } else if (name === 'Message' && current && depth === 1) { inMessage = true; msg = ''; }
      else if (name === 'UnitTest') unitTestId = a.id ?? null;
      else if (name === 'TestMethod' && unitTestId) classOf.set(unitTestId, a.className ?? '');
    },
    text(t) { if (inMessage && msg.length < MSG) msg += t; },
    close(name) {
      if (name === 'Message' && inMessage) { if (current) current.message = clip(msg); inMessage = false; }
      else if (name === 'UnitTestResult' || name === 'TestResult') {
        if (depth === 1 && current) { results.push(current); current = null; }
        depth--;
      } else if (name === 'UnitTest') unitTestId = null;
    },
  });
  const cases: TestCase[] = results.map(({ testId, ...c }) => ({ ...c, suite: (classOf.get(testId) ?? '').slice(0, 500) }));
  const s = start as Date | null;
  const f = finishAt as Date | null;
  const wall = s && f && f.getTime() >= s.getTime() ? f.getTime() - s.getTime() : null;
  return finish('trx', cases, s, wall);
}

// ---------------------------------------------------------------------------------------------
// Cucumber JSON
// ---------------------------------------------------------------------------------------------
export function parseCucumber(json: string): ParsedTestReport {
  let doc: unknown;
  try { doc = JSON.parse(json); } catch { throw new ReportError('Cucumber report is not valid JSON'); }
  if (!Array.isArray(doc)) throw new ReportError('Cucumber JSON must be an array of features');
  const cases: TestCase[] = [];
  for (const feature of doc as any[]) {
    if (!feature || typeof feature !== 'object' || !Array.isArray(feature.elements)) {
      throw new ReportError('Cucumber JSON: each feature needs an "elements" array');
    }
    const suite = String(feature.uri ?? feature.name ?? '').slice(0, 500);
    let background: any[] = [];
    for (const el of feature.elements) {
      if (!el || typeof el !== 'object') continue;
      const steps: any[] = Array.isArray(el.steps) ? el.steps : [];
      if (el.type === 'background' || el.keyword === 'Background') { background = steps; continue; }
      if (cases.length >= MAX_TEST_CASES) throw new ReportError(`More than ${MAX_TEST_CASES} test cases in one report`);
      const all = [...background, ...steps, ...(Array.isArray(el.before) ? el.before : []), ...(Array.isArray(el.after) ? el.after : [])];
      let failed = false;
      let skipped = false;
      let durationNs = 0;
      let message: string | null = null;
      for (const st of all) {
        const r = st?.result ?? {};
        const status = String(r.status ?? '').toLowerCase();
        if (status === 'failed') { failed = true; message = message ?? clip(r.error_message); }
        else if (status && status !== 'passed') skipped = true;
        const d = Number(r.duration);
        if (Number.isFinite(d) && d > 0) durationNs += d;
      }
      cases.push({
        suite, name: String(el.name ?? el.id ?? '(unnamed)').slice(0, 1000),
        status: failed ? 'failed' : skipped ? 'skipped' : 'passed',
        durationMs: Math.round(durationNs / 1e6), retries: 0, message,
      });
    }
  }
  return finish('cucumber', cases, null, null);
}

/** Detect the format of a test report from its content. */
export function detectTestFormat(text: string): TestFormat | null {
  const head = text.slice(0, 2048).trimStart();
  if (head.startsWith('[')) return 'cucumber';
  if (head.startsWith('<')) {
    const root = rootElementName(text);
    if (root === 'testsuites' || root === 'testsuite') return 'junit';
    if (root === 'TestRun') return 'trx';
  }
  return null;
}

/**
 * Several XML documents one after the other in one body, e.g. `gzip -c results/*.trx` (gzip members are
 * decompressed as one stream) or `cat reports/*.xml`: split at each XML declaration after the first. A body with
 * one declaration (or none) is returned as it is.
 */
export function splitXmlDocuments(text: string): string[] {
  const body = text.replace(/^\uFEFF/, '');
  const starts: number[] = [];
  const re = /(?:\uFEFF)?<\?xml[\s?]/g;
  for (let m = re.exec(body); m; m = re.exec(body)) starts.push(m.index);
  if (starts.length < 2) return [text];
  const head = body.slice(0, starts[0]);
  if (head.trim()) return [text];
  return starts.map((at, i) => body.slice(at, starts[i + 1] ?? body.length).replace(/^\uFEFF/, '')).filter((d) => d.trim());
}

export function parseTestReport(text: string, format: TestFormat): ParsedTestReport {
  try {
    if (format === 'junit' || format === 'trx') {
      const parse = format === 'junit' ? parseJUnit : parseTrx;
      const docs = splitXmlDocuments(text);
      return docs.slice(1).reduce((acc, d) => mergeTestReports(acc, parse(d)), parse(docs[0]));
    }
    return parseCucumber(text);
  } catch (e) {
    if (e instanceof XmlError) throw new ReportError(`Invalid XML: ${e.message}`);
    throw e;
  }
}

/** Several report files of one run (e.g. Surefire / Gradle: one file per test class) as one report. */
export function mergeTestReports(a: ParsedTestReport, b: ParsedTestReport): ParsedTestReport {
  if (a.cases.length + b.cases.length > MAX_TEST_CASES) throw new ReportError(`More than ${MAX_TEST_CASES} test cases in one upload`);
  const cases = a.cases.concat(b.cases);
  const startedAt = a.startedAt && b.startedAt ? (a.startedAt < b.startedAt ? a.startedAt : b.startedAt) : a.startedAt ?? b.startedAt;
  return finish(a.format, cases, startedAt, a.durationMs + b.durationMs);
}
