/**
 * Full mode for the CI sources: the minimised raw records, in formats QE Navigator's existing ingestion
 * endpoints accept, so QE Navigator calculates itself (exactly as for a team that uploads from its pipeline):
 *
 *   POST /api/ingest/tests?team&commit&branch&run&attempt&startedAt&format=junit   JUnit XML: suite, test name,
 *                                                                                  status, duration, retries
 *                                                                                  (no failure messages or output)
 *   POST /api/ingest/coverage?…&format=lcov            lcov: per file lines / branches found and hit (no line data)
 *   POST /api/ingest/pipelines?team                    runs with their stages (name, kind, group, times, result)
 *   POST /api/ingest/deployments?team                  deployments with their commits (sha, author / commit time)
 *   POST /api/ingest/static-analysis?…&loc             SARIF: rule, severity, file, fingerprint (no messages)
 */
import type { AnalysisRec, CommitRec, CoverageRec, DeploymentRec, PipelineRec, TestRunRec } from '../../packages/engine/src/index';

const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export interface RawRequest { kind: 'tests' | 'coverage' | 'pipelines' | 'deployments' | 'static-analysis'; id: string; query: Record<string, string>; contentType: string; body: string }

export function junitXml(r: TestRunRec): string {
  const bySuite = new Map<string, NonNullable<TestRunRec['cases']>>();
  for (const c of r.cases ?? []) { const l = bySuite.get(c.suite) ?? []; l.push(c); bySuite.set(c.suite, l); }
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>', `<testsuites time="${(r.durationMs / 1000).toFixed(3)}">`];
  for (const [suite, cases] of bySuite) {
    parts.push(`<testsuite name="${x(suite)}" tests="${cases.length}">`);
    for (const c of cases) {
      const t = (c.durationMs / 1000).toFixed(3);
      const inner = c.status === 'failed' ? '<failure/>' : c.status === 'error' ? '<error/>' : c.status === 'skipped' ? '<skipped/>' : '';
      // Retries inside the run (Surefire's flakyFailure) keep a flaky test visible as one.
      const flaky = c.status === 'passed' && c.retries > 0 ? Array.from({ length: Math.min(c.retries, 10) }, () => '<flakyFailure/>').join('') : '';
      parts.push(`<testcase classname="${x(suite)}" name="${x(c.name)}" time="${t}">${inner}${flaky}</testcase>`);
    }
    parts.push('</testsuite>');
  }
  parts.push('</testsuites>');
  return parts.join('\n');
}

export function lcov(r: CoverageRec): string {
  const files = r.files ?? [];
  if (!files.length) return `TN:\nSF:(total)\nLF:${r.linesFound}\nLH:${r.linesHit}\nBRF:${r.branchesFound}\nBRH:${r.branchesHit}\nend_of_record\n`;
  return files.map((f) => `TN:\nSF:${f.path.replace(/[\r\n]/g, '')}\nLF:${f.linesFound}\nLH:${f.linesHit}\nBRF:${f.branchesFound ?? 0}\nBRH:${f.branchesHit ?? 0}\nend_of_record\n`).join('');
}

const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);

export function pipelineJson(r: PipelineRec): Record<string, unknown> {
  return {
    id: r.externalId, attempt: r.attempt, name: r.name ?? null, commit: r.commit ?? '', branch: r.branch ?? null, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt),
    durationSeconds: r.durationS, result: r.result, ...(r.url ? { url: r.url } : {}),
    stages: (r.stages ?? []).slice(0, 200).map((s) => ({ name: s.name, kind: s.kind, parallelGroup: s.parallelGroup, startedAt: iso(s.startedAt), finishedAt: iso(s.finishedAt), durationSeconds: s.durationS, result: s.result })),
  };
}

export function deploymentJson(d: DeploymentRec, commits: CommitRec[]): Record<string, unknown> {
  return {
    id: d.externalId, environment: d.environment, production: d.production, service: d.service, commit: d.commit || undefined, ...(d.commitFrom ? { previousCommit: d.commitFrom } : {}),
    startedAt: iso(d.startedAt), finishedAt: iso(d.finishedAt), result: d.result, rollbackOf: d.rollbackOf, hotfix: d.hotfix, ...(d.url ? { url: d.url } : {}),
    commits: commits.slice(0, 5000).map((c) => ({ sha: c.sha, authoredAt: iso(c.authoredAt), committedAt: iso(c.committedAt) })),
  };
}

const SEV_PROP: Record<string, string> = { critical: 'blocker', high: 'high', medium: 'medium', low: 'low', info: 'info' };

export function sarifJson(a: AnalysisRec): string {
  const rules = Array.from(new Set(a.rules.map((r) => r.ruleId))).map((id) => ({ id }));
  const results = a.rules.map((r, i) => ({
    ruleId: r.ruleId, properties: { severity: SEV_PROP[r.severity] ?? 'medium' },
    ...(r.path ? { locations: [{ physicalLocation: { artifactLocation: { uri: r.path } } }] } : {}),
    partialFingerprints: { primaryLocationLineHash: a.fingerprints[i] ?? `${r.ruleId}:${i}` },
  }));
  return JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: a.tool, rules } }, results }] });
}

export const testsRequest = (team: string, r: TestRunRec): RawRequest => ({
  kind: 'tests', id: r.id, contentType: 'application/xml', body: junitXml(r),
  query: { team, commit: r.commit, ...(r.branch ? { branch: r.branch } : {}), run: r.runId, attempt: String(r.attempt), startedAt: new Date(r.startedAt).toISOString(), format: 'junit' },
});
export const coverageRequest = (team: string, r: CoverageRec): RawRequest => ({
  kind: 'coverage', id: r.id, contentType: 'text/plain', body: lcov(r),
  query: { team, commit: r.commit, ...(r.branch ? { branch: r.branch } : {}), run: r.runId ?? r.id, attempt: String(r.attempt), startedAt: new Date(r.createdAt).toISOString(), format: 'lcov' },
});
export const analysisRequest = (team: string, a: AnalysisRec): RawRequest => ({
  kind: 'static-analysis', id: a.id, contentType: 'application/json', body: sarifJson(a),
  query: { team, commit: a.commit, ...(a.branch ? { branch: a.branch } : {}), run: a.runId, attempt: String(a.attempt), startedAt: new Date(a.analyzedAt).toISOString(), repo: a.repo, ...(a.linesOfCode ? { loc: String(a.linesOfCode) } : {}) },
});
