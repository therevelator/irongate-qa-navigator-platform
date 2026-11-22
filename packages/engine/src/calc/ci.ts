/**
 * Calculation engine, phase 1: tests, coverage and pipelines (docs/V2_PLAN.md, "Calculation rules (phase 1)").
 *
 * Per team and UTC day:
 *
 *   line_coverage → test_coverage      lines hit ÷ lines found, latest report of the day's latest
 *                                      main-branch commit
 *   branch_coverage                    branches hit ÷ branches found, same report
 *   changed_code_coverage              hit ÷ found over the changed lines (when a diff was sent)
 *   pass_rate                          passed ÷ (passed + failed + errors), main-branch runs of the day
 *   first_time_pass_rate               share of pipeline runs whose first attempt passed (test runs'
 *                                      first attempts when no pipeline data exists)
 *   flaky_tests, test_flakiness_rate   tests that failed and passed on the same commit within 7 days
 *                                      (or failed then passed in a rerun inside one run) ÷ distinct tests
 *   test_execution_time_minutes        median total test duration per run
 *   avg_build_time_minutes             median pipeline duration
 *   pipeline_success_rate              successful ÷ (successful + failed) pipeline runs
 *   parallel_test_efficiency           Σ shard durations ÷ (shards × longest shard), median over runs
 *                                      with parallel test stages
 *
 * Runs without a branch count as main-branch runs; the main branch is the team's main branch, or
 * main / master when it is not set.
 *
 * Pure: the records in, metric values and their evidence out. The server reads the records from its raw
 * store (server/lib/calc/engine.ts, computeTeamDay); the QE Navigator Collector from its local copy.
 */
import type { ComputedMetric, MetricSpec } from './types';
import { DAY_MS, median } from './types';

export const CI_METRICS: Record<string, MetricSpec> = {
  line_coverage: { key: 'line_coverage', label: 'Line coverage', unit: '%', kpi: 'test_coverage', formula: 'lines hit ÷ lines found × 100 (latest report of the latest main-branch commit of the day)' },
  branch_coverage: { key: 'branch_coverage', label: 'Branch coverage', unit: '%', kpi: null, formula: 'branches hit ÷ branches found × 100 (same report)' },
  changed_code_coverage: { key: 'changed_code_coverage', label: 'Coverage of changed code', unit: '%', kpi: null, formula: 'changed lines hit ÷ changed coverable lines × 100 (latest report with a diff)' },
  pass_rate: { key: 'pass_rate', label: 'Pass rate', unit: '%', kpi: null, formula: 'passed ÷ (passed + failed + errors) × 100 over the day’s main-branch test runs; skipped counted separately' },
  first_time_pass_rate: { key: 'first_time_pass_rate', label: 'First-time pass rate', unit: '%', kpi: 'first_time_pass_rate', formula: 'runs whose first attempt passed ÷ runs × 100' },
  flaky_tests: { key: 'flaky_tests', label: 'Flaky tests', unit: 'tests', kpi: null, formula: 'tests that both failed and passed on the same commit within the last 7 days' },
  test_flakiness_rate: { key: 'test_flakiness_rate', label: 'Test flakiness rate', unit: '%', kpi: 'test_flakiness_rate', formula: 'flaky tests ÷ distinct tests run in the last 7 days × 100' },
  test_execution_time: { key: 'test_execution_time', label: 'Test execution time', unit: 'min', kpi: 'test_execution_time_minutes', formula: 'median total test duration per run (minutes)' },
  build_time: { key: 'build_time', label: 'Average build time', unit: 'min', kpi: 'avg_build_time_minutes', formula: 'median pipeline duration (minutes), cancelled runs excluded' },
  pipeline_success_rate: { key: 'pipeline_success_rate', label: 'Pipeline success rate', unit: '%', kpi: null, formula: 'successful ÷ (successful + failed) pipeline runs × 100; cancelled runs excluded' },
  parallel_test_efficiency: { key: 'parallel_test_efficiency', label: 'Parallel test efficiency', unit: '%', kpi: 'parallel_test_efficiency', formula: 'Σ shard durations ÷ (shards × longest shard) × 100, median over runs with parallel test stages' },
};

export type CaseStatus = 'passed' | 'failed' | 'error' | 'skipped';

/** One test result of a run (test_results). */
export interface TestCaseRec { testKey: string; suite: string; name: string; status: CaseStatus; durationMs: number; retries: number }

/** One test run (test_runs): a report of a CI run attempt. Times are epoch milliseconds; day is the UTC day of startedAt. */
export interface TestRunRec {
  id: string; commit: string; runId: string; attempt: number; branch: string | null; day: string; startedAt: number;
  passed: number; failed: number; errored: number; skipped: number; durationMs: number; format?: string;
  /** The per-test results (needed for flaky tests, slowest tests). */
  cases?: TestCaseRec[];
}

export interface CoverageFileRec { path: string; linesFound: number; linesHit: number; branchesFound?: number; branchesHit?: number }

/** One coverage report (coverage_reports). */
export interface CoverageRec {
  id: string; commit: string; branch: string | null; attempt: number; day: string; createdAt: number; format: string;
  /** The CI run the report came from (identity, with team, commit and attempt). */
  runId?: string;
  linesFound: number; linesHit: number; branchesFound: number; branchesHit: number; fileCount: number;
  changedLinesFound: number | null; changedLinesHit: number | null;
  /** The per-file figures (needed for the lowest-coverage files). */
  files?: CoverageFileRec[];
}

export interface StageRec {
  name: string; kind: string; parallelGroup: string | null; startedAt: number | null; finishedAt: number | null; durationS: number | null;
  result: 'success' | 'failed' | 'cancelled' | 'skipped';
}

/** One pipeline run attempt (pipeline_runs_raw) with its stages (pipeline_stage_runs). */
export interface PipelineRec {
  id: string; externalId: string; attempt: number; name?: string | null; commit?: string; branch?: string | null; day: string;
  startedAt: number; finishedAt: number | null; durationS: number | null; result: 'success' | 'failed' | 'cancelled'; url?: string | null;
  stages?: StageRec[];
  /** The steps of each stage (job), when the CI reports them: shown as evidence (slowest steps), not used by the calculations. */
  steps?: Array<{ job: string; name: string; durationS: number | null; result: StageRec['result'] }>;
}

export interface CiData {
  /** The team's main branch (null: main or master). */
  mainBranch: string | null;
  testRuns: TestRunRec[];
  coverage: CoverageRec[];
  pipelines: PipelineRec[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (ms: number) => new Date(ms).toISOString();

/** A run or report on the main branch (no branch counts as main). */
export const isMainBranch = (branch: string | null | undefined, mainBranch: string | null): boolean =>
  !branch || (mainBranch === null && (branch === 'main' || branch === 'master')) || branch === mainBranch;

/** The coverage report a day's coverage values are based on: the latest main-branch report of the day (latest attempt). */
export function pickCoverageReport(day: string, data: Pick<CiData, 'coverage' | 'mainBranch'>): CoverageRec | null {
  const main = data.coverage.filter((c) => c.day === day && isMainBranch(c.branch, data.mainBranch));
  if (!main.length) return null;
  return [...main].sort((a, b) => b.createdAt - a.createdAt || b.attempt - a.attempt)[0];
}

/** The lowest-coverage files of a report (coverage ascending, larger files first), at most n. */
export function lowestCoverageFiles(files: CoverageFileRec[], n: number): CoverageFileRec[] {
  return files.filter((f) => f.linesFound > 0).sort((a, b) => a.linesHit / a.linesFound - b.linesHit / b.linesFound || b.linesFound - a.linesFound).slice(0, n);
}

/** The day `n` days before `day` (YYYY-MM-DD). */
export const dayMinus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);

export interface FlakyTest { testKey: string; name: string; suite: string; commit: string; failedRuns: string[]; passedRuns: string[] }

/**
 * Tests that failed and passed on the same commit (or passed after a retry) in the runs given, grouped by test and
 * commit (sorted), with the distinct tests and runs that are not skipped.
 */
export function flakyGroups(runs: TestRunRec[]): { groups: FlakyTest[]; distinctTests: number; runs: number } {
  const by = new Map<string, { t: FlakyTest; pass: boolean; fail: boolean; retried: boolean; failed: Set<string>; passed: Set<string> }>();
  const tests = new Set<string>();
  const counted = new Set<string>();
  for (const r of runs) {
    for (const c of r.cases ?? []) {
      if (c.status !== 'skipped') { tests.add(c.testKey); counted.add(r.id); }
      const k = `${c.testKey}\u0000${r.commit}`;
      let g = by.get(k);
      if (!g) {
        g = { t: { testKey: c.testKey, name: c.name, suite: c.suite, commit: r.commit, failedRuns: [], passedRuns: [] }, pass: false, fail: false, retried: false, failed: new Set(), passed: new Set() };
        by.set(k, g);
      }
      if (c.name > g.t.name) g.t.name = c.name;
      if (c.suite > g.t.suite) g.t.suite = c.suite;
      if (c.status === 'passed') { g.pass = true; g.passed.add(r.id); if (c.retries > 0) g.retried = true; }
      if (c.status === 'failed' || c.status === 'error') g.fail = true;
      if (c.status === 'failed' || c.status === 'error' || c.retries > 0) g.failed.add(r.id);
    }
  }
  const groups = Array.from(by.values())
    .filter((g) => (g.pass && g.fail) || g.retried)
    .map((g) => ({ ...g.t, failedRuns: Array.from(g.failed).sort(), passedRuns: Array.from(g.passed).sort() }))
    .sort((a, b) => (a.testKey < b.testKey ? -1 : a.testKey > b.testKey ? 1 : a.commit < b.commit ? -1 : a.commit > b.commit ? 1 : 0));
  return { groups, distinctTests: tests.size, runs: counted.size };
}

/** Compute every phase-1 metric of a team for one day (UTC). Pure. */
export function computeCiDay(day: string, data: CiData): ComputedMetric[] {
  const out: ComputedMetric[] = [];
  const isMain = (b: string | null | undefined) => isMainBranch(b, data.mainBranch);

  // --- Coverage ---------------------------------------------------------------------------
  const c = pickCoverageReport(day, data);
  if (c) {
    const commits = new Set(data.coverage.filter((x) => x.day === day && isMain(x.branch)).map((x) => x.commit)).size;
    const lowest = lowestCoverageFiles(c.files ?? [], 10);
    const sources = { coverageReports: [c.id], commit: c.commit, lowestFiles: lowest.map((f) => ({ path: f.path, linesFound: f.linesFound, linesHit: f.linesHit })) };
    const n = commits || 1;
    if (c.linesFound > 0) {
      out.push({ key: 'line_coverage', value: r2((c.linesHit / c.linesFound) * 100), inputs: { linesHit: c.linesHit, linesFound: c.linesFound, files: c.fileCount, format: c.format }, sources, sampleSize: n, recordedAt: iso(c.createdAt) });
    }
    if (c.branchesFound > 0) {
      out.push({ key: 'branch_coverage', value: r2((c.branchesHit / c.branchesFound) * 100), inputs: { branchesHit: c.branchesHit, branchesFound: c.branchesFound }, sources: { coverageReports: [c.id], commit: c.commit }, sampleSize: n, recordedAt: iso(c.createdAt) });
    }
  }
  const chg = data.coverage.filter((x) => x.day === day && (x.changedLinesFound ?? 0) > 0).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (chg) {
    out.push({ key: 'changed_code_coverage', value: r2((chg.changedLinesHit! / chg.changedLinesFound!) * 100), inputs: { changedLinesHit: chg.changedLinesHit, changedLinesFound: chg.changedLinesFound, branch: chg.branch }, sources: { coverageReports: [chg.id], commit: chg.commit }, sampleSize: 1, recordedAt: iso(chg.createdAt) });
  }

  // --- Tests -------------------------------------------------------------------------------
  const runs = data.testRuns.filter((r) => r.day === day).sort((a, b) => a.startedAt - b.startedAt);
  const lastRunAt = runs.length ? iso(runs[runs.length - 1].startedAt) : null;
  const main = runs.filter((r) => isMain(r.branch));
  if (main.length) {
    const p = main.reduce((n, r) => n + r.passed, 0);
    const f = main.reduce((n, r) => n + r.failed, 0);
    const e = main.reduce((n, r) => n + r.errored, 0);
    const s = main.reduce((n, r) => n + r.skipped, 0);
    if (p + f + e > 0) {
      out.push({ key: 'pass_rate', value: r2((p / (p + f + e)) * 100), inputs: { passed: p, failed: f, errors: e, skipped: s, runs: main.length }, sources: { testRuns: main.slice(-50).map((r) => r.id) }, sampleSize: main.length, recordedAt: iso(main[main.length - 1].startedAt) });
    }
  }
  if (runs.length) {
    const durations = runs.map((r) => Number(r.durationMs));
    const med = median(durations)!;
    out.push({ key: 'test_execution_time', value: r2(med / 60000), inputs: { medianMs: med, runs: runs.length, minMs: Math.min(...durations), maxMs: Math.max(...durations) }, sources: { testRuns: runs.slice(-50).map((r) => r.id) }, sampleSize: runs.length, recordedAt: lastRunAt! });

    // Flaky tests over the 7 days ending today (on days with test runs).
    const from = dayMinus(day, 6);
    const window = data.testRuns.filter((r) => r.day >= from && r.day <= day);
    const fl = flakyGroups(window);
    const keys = new Map<string, FlakyTest>();
    for (const g of fl.groups) if (!keys.has(g.testKey)) keys.set(g.testKey, g);
    if (fl.distinctTests > 0) {
      const list = Array.from(keys.values()).slice(0, 25).map((g) => ({ testKey: g.testKey, name: g.name, suite: g.suite, commit: g.commit, failedRuns: g.failedRuns.slice(0, 10), passedRuns: g.passedRuns.slice(0, 10) }));
      const inputs = { flakyTests: keys.size, distinctTests: fl.distinctTests, windowDays: 7, runs: fl.runs };
      out.push({ key: 'flaky_tests', value: keys.size, inputs, sources: { flakyTests: list }, sampleSize: fl.runs, recordedAt: lastRunAt! });
      out.push({ key: 'test_flakiness_rate', value: r2((keys.size / fl.distinctTests) * 100), inputs: { ...inputs }, sources: { flakyTests: list }, sampleSize: fl.runs, recordedAt: lastRunAt! });
    }
  }

  // --- Pipelines ---------------------------------------------------------------------------
  const pipes = data.pipelines.filter((p) => p.day === day).sort((a, b) => a.startedAt - b.startedAt).map((p) => ({ ...p, at: p.finishedAt ?? p.startedAt }));
  const done = pipes.filter((p) => p.result !== 'cancelled');
  if (done.length) {
    const lastAt = iso(done.reduce((m, p) => (p.at > m ? p.at : m), done[0].at));
    const ok = done.filter((p) => p.result === 'success').length;
    out.push({ key: 'pipeline_success_rate', value: r2((ok / done.length) * 100), inputs: { successful: ok, failed: done.length - ok, cancelled: pipes.length - done.length }, sources: { pipelineRuns: done.slice(-50).map((p) => p.id) }, sampleSize: done.length, recordedAt: lastAt });
    const ds = done.map((p) => p.durationS).filter((d) => d !== null && d !== undefined).map(Number);
    if (ds.length) {
      const med = median(ds)!;
      out.push({ key: 'build_time', value: r2(med / 60), inputs: { medianSeconds: med, runs: ds.length, minSeconds: Math.min(...ds), maxSeconds: Math.max(...ds) }, sources: { pipelineRuns: done.slice(-50).map((p) => p.id) }, sampleSize: ds.length, recordedAt: lastAt });
    }
  }
  // First-time pass rate: pipelines (first attempt per run id), else test runs.
  const firsts = new Map<string, (typeof pipes)[number]>();
  for (const p of pipes) {
    const prev = firsts.get(p.externalId);
    if (!prev || p.attempt < prev.attempt) firsts.set(p.externalId, p);
  }
  const firstDone = Array.from(firsts.values()).filter((p) => p.result !== 'cancelled');
  if (firstDone.length) {
    const ok = firstDone.filter((p) => p.result === 'success').length;
    out.push({ key: 'first_time_pass_rate', value: r2((ok / firstDone.length) * 100), inputs: { firstAttemptPassed: ok, runs: firstDone.length, basis: 'pipeline runs' }, sources: { pipelineRuns: firstDone.slice(-50).map((p) => p.id) }, sampleSize: firstDone.length, recordedAt: iso(firstDone[firstDone.length - 1].at) });
  } else if (runs.length) {
    const tfirst = new Map<string, TestRunRec>();
    for (const r of runs) {
      const k = `${r.commit}\u0000${r.runId}`;
      const prev = tfirst.get(k);
      if (!prev || r.attempt < prev.attempt) tfirst.set(k, r);
    }
    const list = Array.from(tfirst.values());
    const ok = list.filter((r) => r.failed + r.errored === 0).length;
    out.push({ key: 'first_time_pass_rate', value: r2((ok / list.length) * 100), inputs: { firstAttemptPassed: ok, runs: list.length, basis: 'test runs' }, sources: { testRuns: list.slice(-50).map((r) => r.id) }, sampleSize: list.length, recordedAt: lastRunAt! });
  }
  // Parallel test efficiency: stages of a run in one parallel group (or overlapping test stages).
  const groups: Array<{ run: string; shards: number; total: number; longest: number }> = [];
  for (const p of pipes) {
    const by = new Map<string, StageRec[]>();
    for (const s of p.stages ?? []) {
      if (!(s.durationS !== null && s.durationS > 0) || s.result === 'skipped' || !(s.parallelGroup !== null || s.kind === 'test')) continue;
      const k = s.parallelGroup ?? '__tests';
      const l = by.get(k) ?? [];
      l.push(s);
      by.set(k, l);
    }
    for (const list of by.values()) {
      if (list.length < 2) continue;
      const named = list.every((s) => s.parallelGroup !== null);
      const starts = list.map((s) => s.startedAt).filter((x): x is number => x !== null);
      const ends = list.map((s) => s.finishedAt).filter((x): x is number => x !== null);
      const overlap = starts.length > 0 && ends.length > 0 && Math.max(...starts) < Math.min(...ends);
      if (!named && !overlap) continue;
      const ds = list.map((s) => Number(s.durationS));
      groups.push({ run: p.id, shards: list.length, total: ds.reduce((a, b) => a + b, 0), longest: Math.max(...ds) });
    }
  }
  if (groups.length) {
    const effs = groups.map((g) => (g.total / (g.shards * g.longest)) * 100);
    const med = median(effs)!;
    const last = groups[groups.length - 1];
    out.push({ key: 'parallel_test_efficiency', value: r2(med), inputs: { runs: groups.length, example: { shards: last.shards, totalSeconds: last.total, longestSeconds: last.longest } }, sources: { pipelineRuns: Array.from(new Set(groups.map((g) => g.run))).slice(-50) }, sampleSize: groups.length, recordedAt: pipes.length ? iso(pipes[pipes.length - 1].at) : `${day}T12:00:00.000Z` });
  }
  return out;
}

/** The days whose values depend on raw data of `day` for `kind` (flaky tests look back 7 days). */
export function affectedDays(kind: 'tests' | 'coverage' | 'pipelines', day: string, today = new Date().toISOString().slice(0, 10)): string[] {
  if (kind !== 'tests') return [day];
  const out: string[] = [];
  const d = new Date(`${day}T00:00:00Z`);
  for (let i = 0; i < 7; i++) {
    const x = new Date(d.getTime() + i * DAY_MS).toISOString().slice(0, 10);
    if (x > today) break;
    out.push(x);
  }
  return out;
}
