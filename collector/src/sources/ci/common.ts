/**
 * Shared parts of the CI and code-quality connectors: the records they produce (the shared engine's record
 * types, so the Collector calculates exactly like QE Navigator), artifact name matching, and reading test,
 * coverage and SARIF reports out of downloaded artifacts (zip archives or plain files), recognised by content
 * with the engine's own parsers. Size and zip-bomb limits come from the engine's zip reader.
 */
import type { CoverageRec, PipelineRec, TestRunRec, AnalysisRec, DeploymentRec, CommitRec } from '../../../../packages/engine/src/index';
import { isZip, readZip, ZipError } from '../../../../packages/engine/src/parsers/zip';
import { detectTestFormat, parseTestReport, mergeTestReports, ReportError, type ParsedTestReport } from '../../../../packages/engine/src/parsers/testReports';
import { detectCoverageFormat, parseCoverageReport, mergeCoverage, type ParsedCoverage } from '../../../../packages/engine/src/parsers/coverageReports';
import { looksLikeSarif, parseSarif, type ParsedAnalysis } from '../../../../packages/engine/src/parsers/sarif';
import type { ArtifactSettings } from '../../config';

export type CiRecord =
  | { kind: 'testRun'; team: string; rec: TestRunRec }
  | { kind: 'coverage'; team: string; rec: CoverageRec }
  | { kind: 'pipeline'; team: string; rec: PipelineRec }
  | { kind: 'deployment'; team: string; rec: DeploymentRec }
  | { kind: 'commits'; team: string; deployment: string; commits: CommitRec[] }
  | { kind: 'analysis'; team: string; rec: AnalysisRec };

export interface CiPage {
  records: CiRecord[];
  skipped: Array<{ id: string; reason: string }>;
  /** The newest change time covered by this page (the cursor moves to the newest one of a successful run). */
  changedAt: string | null;
}

export interface CiAdapter {
  kind: 'ci';
  describe(): string[];
  check(): Promise<string[]>;
  collect(since: Date, until: Date): AsyncIterable<CiPage>;
  requests(): number;
}

/** A glob (* and ?, case-insensitive) against a name. */
export function globMatch(pattern: string, name: string): boolean {
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  return re.test(name);
}

export type ArtifactKind = 'tests' | 'coverage' | 'sarif';
/** Which report kinds an artifact name may hold (by the configured patterns). */
export const kindsOf = (name: string, a: ArtifactSettings): ArtifactKind[] =>
  (['tests', 'coverage', 'sarif'] as ArtifactKind[]).filter((k) => a[k].some((p) => globMatch(p, name)));

export interface ParsedArtifacts {
  tests: ParsedTestReport | null;
  coverage: ParsedCoverage | null;
  sarif: ParsedAnalysis[];
  files: number;
  skipped: Array<{ id: string; reason: string }>;
}

const MAX_FILE = 50 * 1024 * 1024;

/**
 * Read the report files of one run's artifacts: zip archives are opened (one level, the engine's limits), each
 * file is recognised by content and parsed when its artifact may hold that kind. Several test files become one
 * report (one per test class is common), several coverage files one report, SARIF files one analysis per tool.
 */
export function parseArtifacts(files: Array<{ artifact: string; name: string; data: Buffer; kinds: ArtifactKind[] }>): ParsedArtifacts {
  const out: ParsedArtifacts = { tests: null, coverage: null, sarif: [], files: 0, skipped: [] };
  const queue: Array<{ artifact: string; name: string; data: Buffer; kinds: ArtifactKind[] }> = [];
  for (const f of files) {
    if (isZip(f.data)) {
      try {
        const z = readZip(f.data, { maxEntries: 2000, maxEntry: MAX_FILE, maxTotal: 200 * 1024 * 1024 });
        for (const e of z.entries) queue.push({ artifact: f.artifact, name: e.name, data: e.data, kinds: f.kinds });
        for (const s of z.skipped) out.skipped.push({ id: `${f.artifact}/${s.name}`, reason: s.reason });
      } catch (e) {
        out.skipped.push({ id: f.artifact, reason: e instanceof ZipError ? e.message : `not readable: ${(e as Error).message}` });
      }
    } else queue.push(f);
  }
  for (const f of queue) {
    if (f.data.length > MAX_FILE) { out.skipped.push({ id: `${f.artifact}/${f.name}`, reason: 'file larger than 50 MB' }); continue; }
    if (!/\.(xml|trx|json|info|lcov|sarif|txt)$/i.test(f.name) && !/lcov/i.test(f.name)) continue;
    let text = f.data.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    try {
      if (f.kinds.includes('sarif') && /\.(sarif|json)$/i.test(f.name)) {
        let doc: unknown = null;
        try { doc = JSON.parse(text); } catch { doc = null; }
        if (doc && looksLikeSarif(doc)) { out.sarif.push(...parseSarif(text)); out.files++; continue; }
      }
      if (f.kinds.includes('tests')) {
        const fmt = detectTestFormat(text);
        if (fmt) {
          const rep = parseTestReport(text, fmt);
          if (rep.cases.length) { out.tests = out.tests ? mergeTestReports(out.tests, rep) : rep; out.files++; continue; }
        }
      }
      if (f.kinds.includes('coverage')) {
        const fmt = detectCoverageFormat(text);
        if (fmt) {
          const cov = parseCoverageReport(text, fmt);
          if (cov.files.length || cov.totals.linesFound) { out.coverage = out.coverage ? mergeCoverage(out.coverage, cov) : cov; out.files++; continue; }
        }
      }
    } catch (e) {
      out.skipped.push({ id: `${f.artifact}/${f.name}`, reason: e instanceof ReportError ? e.message : `not readable: ${(e as Error).message}` });
    }
  }
  return out;
}

/** A parsed test report from structured test results (GitLab's test report API, Jenkins' JUnit plugin, Azure test results). */
export function testReportOf(cases: Array<{ suite: string; name: string; status: 'passed' | 'failed' | 'error' | 'skipped'; durationMs: number; retries?: number }>, format: 'junit' | 'trx' = 'junit', startedAt: Date | null = null, durationMs?: number): ParsedTestReport {
  const counts = { total: cases.length, passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const c of cases) {
    if (c.status === 'passed') counts.passed++;
    else if (c.status === 'failed') counts.failed++;
    else if (c.status === 'error') counts.errored++;
    else counts.skipped++;
  }
  const testsDurationMs = cases.reduce((n, c) => n + c.durationMs, 0);
  return {
    format, startedAt, durationMs: durationMs ?? testsDurationMs, testsDurationMs,
    cases: cases.map((c) => ({ suite: c.suite.slice(0, 500), name: c.name.slice(0, 1000), status: c.status, durationMs: Math.max(0, Math.round(c.durationMs)), retries: c.retries ?? 0, message: null })),
    counts,
  };
}

/** A matrix / sharded job name ("test (ubuntu, 18)", "rspec 2/4", "Job 1 of 3") → its group, else null. */
export function parallelGroupOf(name: string, siblings: string[]): string | null {
  const base = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+\d+\s*(\/|of)\s*\d+\s*$/i, '').trim();
  const b = base(name);
  if (b === name.trim()) return null;
  return siblings.filter((s) => base(s) === b).length >= 2 ? b : null;
}

export const secondsBetween = (a: number | null, b: number | null) => (a !== null && b !== null && b >= a ? Math.round((b - a) / 1000) : null);
export const ms = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  const t = d.getTime();
  return Number.isNaN(t) || t <= 0 ? null : t;
};
