/**
 * Shared parts of the CI and code-quality connectors: the items they produce (the raw data in the JSON shapes the
 * QE Navigator envelope takes), artifact name matching, and the report files found in downloaded artifacts (zip
 * archives or plain files), recognised by their content and sent as files: the Exporter does not parse a report
 * into results and calculates nothing; QE Navigator parses and calculates. Before a file leaves, failure messages,
 * stack traces, output and finding messages are stripped (minimise.ts).
 *
 * The only conversions are of form, not of content: a CI that gives its test results only as structured JSON
 * (GitLab's test report API, Jenkins' JUnit plugin, Azure DevOps test runs) is written out as a JUnit file, and
 * SonarQube's open issues as a SARIF file, so QE Navigator receives every report as a file.
 */
import { isZip, readZip, ZipError } from '../../zip';
import { minimiseReport } from '../../minimise';
import type { ArtifactSettings } from '../../config';

/** The envelope kinds the CI connectors produce. */
export type CiKind = 'pipeline-runs' | 'test-report' | 'coverage' | 'sarif' | 'deployments';

export interface CiRecord {
  kind: CiKind;
  /** The QE Navigator team id the source mapping gives. */
  team: string;
  /** Stable identity of the item within the source (state fingerprints are keyed by it). */
  id: string;
  /** The item exactly as it is sent in the envelope's items. */
  item: Record<string, unknown>;
  /** The time the item is about (for the run summary). */
  at: number | null;
}

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

/** What kind of report a file's text is, by its content only (QE Navigator detects the exact format again). */
export function sniff(name: string, text: string): ArtifactKind | null {
  const head = text.slice(0, 4096);
  if (/^\s*\{/.test(head) && /"runs"\s*:/.test(text.slice(0, 200_000)) && /"version"\s*:\s*"2\.1\.0"/.test(text.slice(0, 200_000))) return 'sarif';
  if (/<testsuites?[\s>]/.test(head) || /<TestRun[\s>]/.test(head) || /<assemblies[\s>]/.test(head)) return 'tests';
  if (/^\s*\[/.test(head) && /"elements"\s*:/.test(head) && /"keyword"\s*:/.test(text.slice(0, 50_000))) return 'tests';
  if (/^(TN:|SF:)/m.test(head) && /end_of_record/.test(text)) return 'coverage';
  if (/<coverage[\s>]/.test(head) && /line-rate|lines-valid|<packages/.test(head)) return 'coverage';
  if (/<report[\s>]/.test(head) && /<counter|<package|jacoco/i.test(text.slice(0, 50_000))) return 'coverage';
  if (/^\s*\{/.test(head) && (/"statementMap"\s*:/.test(text.slice(0, 50_000)) || /"total"\s*:\s*\{\s*"lines"/.test(head))) return 'coverage';
  if (/\.(sarif)$/i.test(name) && /"runs"/.test(head)) return 'sarif';
  return null;
}

export interface ReportFile { name: string; content: string }
export interface FoundReports { tests: ReportFile[]; coverage: ReportFile[]; sarif: ReportFile[]; files: number; skipped: Array<{ id: string; reason: string }> }

const MAX_FILE = 50 * 1024 * 1024;

/**
 * The report files of one run's artifacts: zip archives are opened (one level, the server's limits), each file is
 * recognised by its content and kept as text when its artifact may hold that kind. Nothing is parsed.
 */
export function findReports(files: Array<{ artifact: string; name: string; data: Buffer; kinds: ArtifactKind[] }>): FoundReports {
  const out: FoundReports = { tests: [], coverage: [], sarif: [], files: 0, skipped: [] };
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
    const kind = sniff(f.name, text);
    if (!kind || !f.kinds.includes(kind)) continue;
    try {
      out[kind].push({ name: `${f.artifact}/${f.name}`.slice(-255), content: minimiseReport(kind, text) });
      out.files++;
    } catch (e) {
      out.skipped.push({ id: `${f.artifact}/${f.name}`, reason: `not sent: ${(e as Error).message}` });
    }
  }
  return out;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export interface StructuredCase { suite: string; name: string; status: 'passed' | 'failed' | 'error' | 'skipped'; durationMs: number; retries?: number }

/** A JUnit file of structured test results (a change of form only: suite, name, status, time; no messages). */
export function junitOf(cases: StructuredCase[], durationMs?: number): ReportFile {
  const bySuite = new Map<string, StructuredCase[]>();
  for (const c of cases) { const l = bySuite.get(c.suite) ?? []; l.push(c); bySuite.set(c.suite, l); }
  const total = durationMs ?? cases.reduce((n, c) => n + c.durationMs, 0);
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>', `<testsuites time="${(total / 1000).toFixed(3)}">`];
  for (const [suite, list] of bySuite) {
    parts.push(`<testsuite name="${xml(suite)}" tests="${list.length}">`);
    for (const c of list) {
      const inner = c.status === 'failed' ? '<failure/>' : c.status === 'error' ? '<error/>' : c.status === 'skipped' ? '<skipped/>' : '';
      const flaky = c.status === 'passed' && (c.retries ?? 0) > 0 ? Array.from({ length: Math.min(c.retries!, 10) }, () => '<flakyFailure/>').join('') : '';
      parts.push(`<testcase classname="${xml(suite)}" name="${xml(c.name)}" time="${(Math.max(0, c.durationMs) / 1000).toFixed(3)}">${inner}${flaky}</testcase>`);
    }
    parts.push('</testsuite>');
  }
  parts.push('</testsuites>');
  return { name: 'junit.xml', content: parts.join('\n') };
}

/** An lcov file of coverage totals (a CI that gives only the totals, e.g. Azure DevOps' code coverage summary). */
export function lcovTotalsOf(t: { linesFound: number; linesHit: number; branchesFound: number; branchesHit: number }): ReportFile {
  return { name: 'coverage-summary.info', content: `TN:\nSF:(total)\nLF:${t.linesFound}\nLH:${t.linesHit}\nBRF:${t.branchesFound}\nBRH:${t.branchesHit}\nend_of_record\n` };
}

export interface Finding { ruleId: string; severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; path: string | null; line: number | null; fingerprint: string; category: string | null }
const SEV_PROP: Record<string, string> = { critical: 'blocker', high: 'high', medium: 'medium', low: 'low', info: 'info' };
/** A SARIF file of findings read from an API (SonarQube): rule, severity, file, fingerprint; no messages. */
export function sarifOf(tool: string, findings: Finding[]): ReportFile {
  const rules = Array.from(new Set(findings.map((f) => f.ruleId))).map((id) => ({ id }));
  const results = findings.map((f) => ({
    ruleId: f.ruleId, properties: { severity: SEV_PROP[f.severity] ?? 'medium', ...(f.category ? { category: f.category } : {}) },
    ...(f.path ? { locations: [{ physicalLocation: { artifactLocation: { uri: f.path }, ...(f.line ? { region: { startLine: f.line } } : {}) } }] } : {}),
    partialFingerprints: { primaryLocationLineHash: f.fingerprint },
  }));
  return { name: `${tool.toLowerCase()}.sarif`, content: JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: tool, rules } }, results }] }) };
}

const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);

export interface StageIn { name: string; kind?: 'build' | 'test' | 'deploy' | 'other'; parallelGroup?: string | null; startedAt: number | null; finishedAt: number | null; durationS?: number | null; result: string }
export interface RunIn { id: string; attempt: number; name: string | null; commit: string; branch: string | null; startedAt: number; finishedAt: number | null; durationS?: number | null; result: string; url?: string | null; stages: StageIn[] }

/** A pipeline run item (QE Navigator's pipeline run JSON): the CI's own values; the stage kind is QE Navigator's to decide unless the CI says it. */
export function pipelineRun(team: string, r: RunIn): CiRecord {
  const item: Record<string, unknown> = {
    id: r.id, attempt: r.attempt, name: r.name, commit: r.commit, branch: r.branch, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt),
    ...(r.durationS !== undefined && r.durationS !== null ? { durationSeconds: r.durationS } : {}), result: r.result, ...(r.url ? { url: r.url } : {}),
    stages: r.stages.slice(0, 200).map((s) => ({
      name: s.name.slice(0, 255), ...(s.kind ? { kind: s.kind } : {}), ...(s.parallelGroup ? { parallelGroup: s.parallelGroup } : {}),
      startedAt: iso(s.startedAt), finishedAt: iso(s.finishedAt), ...(s.durationS !== undefined && s.durationS !== null ? { durationSeconds: s.durationS } : {}), result: s.result,
    })),
  };
  return { kind: 'pipeline-runs', team, id: `run:${r.id}#${r.attempt}`, item, at: r.finishedAt ?? r.startedAt };
}

export interface ReportMeta { commit: string; branch: string | null; run: string; attempt: number; startedAt: number }

/** A report item: the files as they are, with the run they belong to. */
export function reportItem(kind: 'test-report' | 'coverage' | 'sarif', team: string, files: ReportFile[], m: ReportMeta, extra: { repo?: string | null; loc?: number | null; format?: string } = {}): CiRecord {
  const item: Record<string, unknown> = {
    commit: m.commit, ...(m.branch ? { branch: m.branch } : {}), run: m.run, attempt: m.attempt, startedAt: iso(m.startedAt),
    ...(extra.format ? { format: extra.format } : {}), ...(extra.repo ? { repo: extra.repo } : {}), ...(extra.loc ? { loc: extra.loc } : {}),
    files: files.map((f) => ({ name: f.name, content: f.content })),
  };
  return { kind, team, id: `${kind}:${m.run}#${m.attempt}`, item, at: m.startedAt };
}

/** The report items of one run: one test report (all its test files), one coverage report, one per SARIF file. */
export function reportItems(team: string, found: { tests: ReportFile[]; coverage: ReportFile[]; sarif: ReportFile[] }, m: ReportMeta, repo: string | null): CiRecord[] {
  const out: CiRecord[] = [];
  if (found.tests.length) out.push(reportItem('test-report', team, found.tests.slice(0, 50), m));
  if (found.coverage.length) out.push(reportItem('coverage', team, found.coverage.slice(0, 50), m));
  found.sarif.forEach((f, i) => out.push(reportItem('sarif', team, [f], { ...m, run: found.sarif.length > 1 ? `${m.run}:sarif-${i + 1}` : m.run }, { repo })));
  return out;
}

export interface DeploymentIn {
  id: string; environment: string; service: string | null; commit: string; previousCommit?: string | null; startedAt: number | null; finishedAt: number;
  result: 'success' | 'failure'; rollbackOf?: string | null; hotfix?: boolean; url?: string | null;
  commits?: Array<{ sha: string; authoredAt: number | null; committedAt: number | null }>;
}

/** A deployment item (QE Navigator's deployment JSON) with the commits it shipped (sha and times; no author, no message). */
export function deployment(team: string, d: DeploymentIn): CiRecord {
  const item: Record<string, unknown> = {
    id: d.id, environment: d.environment, production: true, ...(d.service ? { service: d.service } : {}), ...(d.commit ? { commit: d.commit } : {}),
    ...(d.previousCommit ? { previousCommit: d.previousCommit } : {}), startedAt: iso(d.startedAt), finishedAt: iso(d.finishedAt), result: d.result,
    ...(d.rollbackOf ? { rollbackOf: d.rollbackOf } : {}), ...(d.hotfix ? { hotfix: true } : {}), ...(d.url ? { url: d.url } : {}),
    ...(d.commits?.length ? { commits: d.commits.slice(0, 5000).map((c) => ({ sha: c.sha, authoredAt: iso(c.authoredAt), committedAt: iso(c.committedAt) })) } : {}),
  };
  return { kind: 'deployments', team, id: `deployment:${d.id}`, item, at: d.finishedAt };
}

/** A matrix / sharded job name ("test (ubuntu, 18)", "rspec 2/4", "Job 1 of 3") → its group, else null (the CI's own grouping). */
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
