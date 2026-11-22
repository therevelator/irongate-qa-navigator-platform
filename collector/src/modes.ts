/**
 * What each privacy mode sends for the calculated values (evidence and metrics modes; full mode sends the
 * minimised raw records instead, see rawPayloads.ts). Two allow-lists, applied here and again by QE Navigator
 * (server/lib/collectorIngest.ts), so nothing else can leave even by mistake:
 *
 *   both modes, per metric   key, value, sampleSize, recordedAt, and inputs: numbers only (counts, medians,
 *                            windows). Text inputs (a sprint name, a report format, a branch) are dropped.
 *   evidence mode, per metric
 *     flaky_tests, test_flakiness_rate   flakyTests: name, suite, commit, failed runs (count), passed runs (count)
 *     line_coverage                      lowestFiles: path, lines found, lines hit
 *     change_failure_rate                failedDeployments: deployment id, reasons (rolled back / hotfix /
 *                                        incident, the other deployment's or the incident's id, time)
 *     escape_rate, defect_density        escaped: issue keys
 *   evidence mode, per team (the CI evidence panel)
 *     flakyTests (name, suite, commits, counts, last seen), lowestFiles (path, lines, branches, coverage),
 *     slowestStages (name, runs, median and longest seconds), failingStages (name, runs, failed, rate, median)
 *   metrics mode: no evidence at all (no names, keys, paths or titles); the app links to your local page.
 */
import type { ComputedMetric, CiEvidence } from '../../packages/engine/src/index';
import type { PrivacyMode } from './config';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const text = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() && !EMAIL.test(v) ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const count = (v: unknown): number => (Array.isArray(v) ? v.length : num(v) ?? 0);

export interface MetricItem { key: string; value: number; sampleSize: number; recordedAt: string; inputs: Record<string, number>; evidence?: Record<string, unknown> }

/** Numeric inputs only (counts, medians, windows); nested objects and text are dropped. */
export function numericInputs(inputs: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(inputs)) {
    const n = num(v);
    if (n !== null && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k)) out[k] = Math.round(n * 10000) / 10000;
  }
  return out;
}

/** The evidence of one metric that evidence mode may send (from the engine's sources). */
export function metricEvidence(m: ComputedMetric): Record<string, unknown> | undefined {
  const s = m.sources as Record<string, any>;
  if ((m.key === 'flaky_tests' || m.key === 'test_flakiness_rate') && Array.isArray(s.flakyTests)) {
    const list = s.flakyTests.slice(0, 25).map((f: any) => ({ name: text(f.name, 1000), suite: text(f.suite), commit: text(f.commit, 80), failedRuns: count(f.failedRuns), passedRuns: count(f.passedRuns) })).filter((f: any) => f.name);
    return { flakyTests: list };
  }
  if (m.key === 'line_coverage' && Array.isArray(s.lowestFiles)) {
    return { lowestFiles: s.lowestFiles.slice(0, 10).map((f: any) => ({ path: text(f.path, 1000), linesFound: num(f.linesFound) ?? 0, linesHit: num(f.linesHit) ?? 0 })).filter((f: any) => f.path) };
  }
  if (m.key === 'change_failure_rate' && Array.isArray(s.failedDeployments)) {
    return {
      failedDeployments: s.failedDeployments.slice(0, 50).map((d: any) => ({
        deploymentId: text(d.externalId, 200),
        reasons: (Array.isArray(d.reasons) ? d.reasons : []).slice(0, 10).map((r: any) => ({ type: ['rolled_back', 'rollback', 'hotfix', 'incident'].includes(r.type) ? r.type : 'other', ref: text(r.ref, 200), at: text(r.at, 40) })),
      })).filter((d: any) => d.deploymentId),
    };
  }
  if ((m.key === 'escape_rate' || m.key === 'defect_density') && Array.isArray(s.escaped)) {
    return { escaped: s.escaped.slice(0, 50).map((k: unknown) => text(k, 200)).filter(Boolean) };
  }
  return undefined;
}

export function metricItem(m: ComputedMetric, mode: PrivacyMode): MetricItem {
  const item: MetricItem = { key: m.key, value: Math.round(m.value * 10000) / 10000, sampleSize: m.sampleSize, recordedAt: m.recordedAt, inputs: numericInputs(m.inputs) };
  if (mode === 'evidence') {
    const ev = metricEvidence(m);
    if (ev) item.evidence = ev;
  }
  return item;
}

/** The team's evidence panel (evidence mode only). */
export function teamEvidenceItem(ev: CiEvidence, mode: PrivacyMode): Record<string, unknown> | undefined {
  if (mode !== 'evidence') return undefined;
  return {
    flakyTests: ev.flakyTests.map((f) => ({ name: text(f.name, 1000), suite: text(f.suite), commits: f.commits.map((c) => text(c, 80)).filter(Boolean).slice(0, 5), failedRuns: f.failedRuns, passedRuns: f.passedRuns, lastSeen: f.lastSeen })).filter((f) => f.name),
    lowestFiles: ev.lowestFiles.map((f) => ({ path: text(f.path, 1000), linesFound: f.linesFound, linesHit: f.linesHit, branchesFound: f.branchesFound, branchesHit: f.branchesHit, coverage: f.coverage })).filter((f) => f.path),
    slowestStages: ev.slowestStages.map((s) => ({ name: text(s.name, 255), runs: s.runs, medianSeconds: s.medianSeconds, maxSeconds: s.maxSeconds })).filter((s) => s.name),
    failingStages: ev.failingStages.map((s) => ({ name: text(s.name, 255), runs: s.runs, failed: s.failed, failureRate: s.failureRate, medianSeconds: s.medianSeconds })).filter((s) => s.name),
  };
}

/** Every string anywhere in a value (to prove what metrics mode sends). */
export function stringsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsIn(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => stringsIn(x, out));
  return out;
}
