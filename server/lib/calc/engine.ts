/**
 * Calculation engine, phase 1 (docs/V2_PLAN.md, "Calculation rules (phase 1)").
 *
 * From the raw store (test_runs / test_results, coverage_reports / coverage_files,
 * pipeline_runs_raw / pipeline_stage_runs) it computes, per team and UTC day:
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
 * Each value is stored in metric_evidence with its formula, the values used, the number of runs
 * (confidence) and the source records; the values that have a KPI column are written through the
 * one KPI write path (recordKpiValues, source 'computed'), so dashboards, alerts, targets and the
 * QA score use them. A value that did not change is not written again.
 *
 * Runs without a branch count as main-branch runs; the main branch is teams.main_branch, or
 * main / master when it is not set.
 */
import type pg from 'pg';
import { recordKpiValues, type KpiColumn } from '../kpiIngest';

export interface MetricSpec {
  key: string;
  label: string;
  unit: string;
  kpi: KpiColumn | null;
  formula: string;
}

export const METRICS: Record<string, MetricSpec> = {
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

/** The metric_evidence key behind a KPI column (for "How this was calculated"). */
export const EVIDENCE_FOR_KPI: Partial<Record<string, string>> = Object.fromEntries(
  Object.values(METRICS).filter((m) => m.kpi).map((m) => [m.kpi as string, m.key])
);

export type Confidence = 'high' | 'medium' | 'low';
export const confidenceFor = (n: number): Confidence => (n >= 10 ? 'high' : n >= 3 ? 'medium' : 'low');

export interface ComputedMetric {
  key: string;
  value: number;
  inputs: Record<string, unknown>;
  sources: Record<string, unknown>;
  sampleSize: number;
  /** The latest source time the value is based on (recorded_at of the KPI value). */
  recordedAt: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

async function rows<T = any>(client: pg.PoolClient, sql: string, params: any[]): Promise<T[]> {
  return (await client.query(sql, params)).rows as T[];
}

const MAIN = (alias: string) =>
  `(${alias}.branch IS NULL OR ${alias}.branch = '' OR (t.main_branch IS NULL AND ${alias}.branch IN ('main', 'master')) OR ${alias}.branch = t.main_branch)`;

const iso = (d: any) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

/** Compute every phase-1 metric of a team for one day (UTC). Pure reads. */
export async function computeTeamDay(client: pg.PoolClient, teamId: string, day: string): Promise<ComputedMetric[]> {
  const out: ComputedMetric[] = [];

  // --- Coverage ---------------------------------------------------------------------------
  const cov = await rows(client,
    `SELECT r.*, (SELECT COUNT(DISTINCT r2.commit_sha) FROM coverage_reports r2 JOIN teams t ON t.id = r2.team_id
                   WHERE r2.team_id = $1 AND r2.day = $2::date AND ${MAIN('r2')})::int AS commits
       FROM coverage_reports r JOIN teams t ON t.id = r.team_id
      WHERE r.team_id = $1 AND r.day = $2::date AND ${MAIN('r')}
      ORDER BY r.created_at DESC, r.attempt DESC LIMIT 1`, [teamId, day]);
  if (cov[0]) {
    const c = cov[0];
    const lowest = await rows(client,
      `SELECT path, lines_found, lines_hit FROM coverage_files WHERE report_id = $1 AND lines_found > 0
        ORDER BY lines_hit::float / lines_found, lines_found DESC LIMIT 10`, [c.id]);
    const sources = { coverageReports: [c.id], commit: c.commit_sha, lowestFiles: lowest.map((f) => ({ path: f.path, linesFound: f.lines_found, linesHit: f.lines_hit })) };
    const n = Number(c.commits) || 1;
    if (c.lines_found > 0) {
      out.push({ key: 'line_coverage', value: r2((c.lines_hit / c.lines_found) * 100), inputs: { linesHit: c.lines_hit, linesFound: c.lines_found, files: c.file_count, format: c.format }, sources, sampleSize: n, recordedAt: iso(c.created_at) });
    }
    if (c.branches_found > 0) {
      out.push({ key: 'branch_coverage', value: r2((c.branches_hit / c.branches_found) * 100), inputs: { branchesHit: c.branches_hit, branchesFound: c.branches_found }, sources: { coverageReports: [c.id], commit: c.commit_sha }, sampleSize: n, recordedAt: iso(c.created_at) });
    }
  }
  const chg = await rows(client,
    `SELECT r.* FROM coverage_reports r JOIN teams t ON t.id = r.team_id
      WHERE r.team_id = $1 AND r.day = $2::date AND r.changed_lines_found > 0
      ORDER BY r.created_at DESC LIMIT 1`, [teamId, day]);
  if (chg[0]) {
    const c = chg[0];
    out.push({ key: 'changed_code_coverage', value: r2((c.changed_lines_hit / c.changed_lines_found) * 100), inputs: { changedLinesHit: c.changed_lines_hit, changedLinesFound: c.changed_lines_found, branch: c.branch }, sources: { coverageReports: [c.id], commit: c.commit_sha }, sampleSize: 1, recordedAt: iso(c.created_at) });
  }

  // --- Tests -------------------------------------------------------------------------------
  const runs = await rows(client,
    `SELECT tr.id, tr.commit_sha, tr.run_id, tr.attempt, tr.passed, tr.failed, tr.errored, tr.skipped, tr.duration_ms, tr.started_at, ${MAIN('tr')} AS is_main
       FROM test_runs tr JOIN teams t ON t.id = tr.team_id
      WHERE tr.team_id = $1 AND tr.day = $2::date ORDER BY tr.started_at`, [teamId, day]);
  const lastRunAt = runs.length ? iso(runs[runs.length - 1].started_at) : null;
  const main = runs.filter((r) => r.is_main);
  if (main.length) {
    const p = main.reduce((n, r) => n + r.passed, 0);
    const f = main.reduce((n, r) => n + r.failed, 0);
    const e = main.reduce((n, r) => n + r.errored, 0);
    const s = main.reduce((n, r) => n + r.skipped, 0);
    if (p + f + e > 0) {
      out.push({ key: 'pass_rate', value: r2((p / (p + f + e)) * 100), inputs: { passed: p, failed: f, errors: e, skipped: s, runs: main.length }, sources: { testRuns: main.slice(-50).map((r) => r.id) }, sampleSize: main.length, recordedAt: iso(main[main.length - 1].started_at) });
    }
  }
  if (runs.length) {
    const durations = runs.map((r) => Number(r.duration_ms));
    const med = median(durations)!;
    out.push({ key: 'test_execution_time', value: r2(med / 60000), inputs: { medianMs: med, runs: runs.length, minMs: Math.min(...durations), maxMs: Math.max(...durations) }, sources: { testRuns: runs.slice(-50).map((r) => r.id) }, sampleSize: runs.length, recordedAt: lastRunAt! });

    // Flaky tests over the 7 days ending today (on days with test runs).
    const flaky = await rows(client,
      `SELECT x.test_key, MAX(x.name) AS name, MAX(x.suite) AS suite, x.commit_sha,
              array_agg(DISTINCT x.run) FILTER (WHERE x.status IN ('failed', 'error') OR x.retries > 0) AS failed_runs,
              array_agg(DISTINCT x.run) FILTER (WHERE x.status = 'passed') AS passed_runs
         FROM (SELECT r.test_key, r.name, r.suite, r.status, r.retries, tr.commit_sha, tr.id AS run
                 FROM test_results r JOIN test_runs tr ON tr.id = r.test_run_id
                WHERE tr.team_id = $1 AND tr.day BETWEEN $2::date - 6 AND $2::date) x
        GROUP BY x.test_key, x.commit_sha
       HAVING (bool_or(x.status = 'passed') AND bool_or(x.status IN ('failed', 'error'))) OR bool_or(x.status = 'passed' AND x.retries > 0)`,
      [teamId, day]);
    const distinct = await rows(client,
      `SELECT COUNT(DISTINCT r.test_key)::int AS n, COUNT(DISTINCT tr.id)::int AS runs
         FROM test_results r JOIN test_runs tr ON tr.id = r.test_run_id
        WHERE tr.team_id = $1 AND tr.day BETWEEN $2::date - 6 AND $2::date AND r.status <> 'skipped'`, [teamId, day]);
    const keys = new Map<string, any>();
    for (const f of flaky) if (!keys.has(f.test_key)) keys.set(f.test_key, f);
    const total = distinct[0]?.n ?? 0;
    const windowRuns = distinct[0]?.runs ?? 0;
    if (total > 0) {
      const list = Array.from(keys.values()).slice(0, 25).map((f) => ({ testKey: f.test_key, name: f.name, suite: f.suite, commit: f.commit_sha, failedRuns: (f.failed_runs ?? []).slice(0, 10), passedRuns: (f.passed_runs ?? []).slice(0, 10) }));
      out.push({ key: 'flaky_tests', value: keys.size, inputs: { flakyTests: keys.size, distinctTests: total, windowDays: 7, runs: windowRuns }, sources: { flakyTests: list }, sampleSize: windowRuns, recordedAt: lastRunAt! });
      out.push({ key: 'test_flakiness_rate', value: r2((keys.size / total) * 100), inputs: { flakyTests: keys.size, distinctTests: total, windowDays: 7, runs: windowRuns }, sources: { flakyTests: list }, sampleSize: windowRuns, recordedAt: lastRunAt! });
    }
  }

  // --- Pipelines ---------------------------------------------------------------------------
  const pipes = await rows(client,
    `SELECT id, external_id, attempt, result, duration_s, started_at, COALESCE(finished_at, started_at) AS at
       FROM pipeline_runs_raw WHERE team_id = $1 AND day = $2::date ORDER BY started_at`, [teamId, day]);
  const done = pipes.filter((p) => p.result !== 'cancelled');
  if (done.length) {
    const lastAt = iso(done.reduce((m, p) => (new Date(p.at) > new Date(m) ? p.at : m), done[0].at));
    const ok = done.filter((p) => p.result === 'success').length;
    out.push({ key: 'pipeline_success_rate', value: r2((ok / done.length) * 100), inputs: { successful: ok, failed: done.length - ok, cancelled: pipes.length - done.length }, sources: { pipelineRuns: done.slice(-50).map((p) => p.id) }, sampleSize: done.length, recordedAt: lastAt });
    const ds = done.map((p) => p.duration_s).filter((d) => d !== null && d !== undefined).map(Number);
    if (ds.length) {
      const med = median(ds)!;
      out.push({ key: 'build_time', value: r2(med / 60), inputs: { medianSeconds: med, runs: ds.length, minSeconds: Math.min(...ds), maxSeconds: Math.max(...ds) }, sources: { pipelineRuns: done.slice(-50).map((p) => p.id) }, sampleSize: ds.length, recordedAt: lastAt });
    }
  }
  // First-time pass rate: pipelines (first attempt per run id), else test runs.
  const firsts = new Map<string, any>();
  for (const p of pipes) {
    const prev = firsts.get(p.external_id);
    if (!prev || p.attempt < prev.attempt) firsts.set(p.external_id, p);
  }
  const firstDone = Array.from(firsts.values()).filter((p) => p.result !== 'cancelled');
  if (firstDone.length) {
    const ok = firstDone.filter((p) => p.result === 'success').length;
    out.push({ key: 'first_time_pass_rate', value: r2((ok / firstDone.length) * 100), inputs: { firstAttemptPassed: ok, runs: firstDone.length, basis: 'pipeline runs' }, sources: { pipelineRuns: firstDone.slice(-50).map((p) => p.id) }, sampleSize: firstDone.length, recordedAt: iso(firstDone[firstDone.length - 1].at) });
  } else if (runs.length) {
    const tfirst = new Map<string, any>();
    for (const r of runs) {
      const k = `${r.commit_sha}\u0000${r.run_id}`;
      const prev = tfirst.get(k);
      if (!prev || r.attempt < prev.attempt) tfirst.set(k, r);
    }
    const list = Array.from(tfirst.values());
    const ok = list.filter((r) => r.failed + r.errored === 0).length;
    out.push({ key: 'first_time_pass_rate', value: r2((ok / list.length) * 100), inputs: { firstAttemptPassed: ok, runs: list.length, basis: 'test runs' }, sources: { testRuns: list.slice(-50).map((r) => r.id) }, sampleSize: list.length, recordedAt: lastRunAt! });
  }
  // Parallel test efficiency: stages of a run in one parallel group (or overlapping test stages).
  const groups = await rows(client,
    `SELECT s.pipeline_run_id, COALESCE(s.parallel_group, '__tests') AS grp, COUNT(*)::int AS shards,
            SUM(s.duration_s)::float AS total, MAX(s.duration_s)::float AS longest
       FROM pipeline_stage_runs s JOIN pipeline_runs_raw p ON p.id = s.pipeline_run_id
      WHERE p.team_id = $1 AND p.day = $2::date AND s.duration_s > 0 AND s.result <> 'skipped'
        AND (s.parallel_group IS NOT NULL OR s.kind = 'test')
      GROUP BY s.pipeline_run_id, COALESCE(s.parallel_group, '__tests')
     HAVING COUNT(*) >= 2 AND (bool_and(s.parallel_group IS NOT NULL) OR MAX(s.started_at) < MIN(s.finished_at))`, [teamId, day]);
  if (groups.length) {
    const effs = groups.map((g) => (g.total / (g.shards * g.longest)) * 100);
    const med = median(effs)!;
    const last = groups[groups.length - 1];
    out.push({ key: 'parallel_test_efficiency', value: r2(med), inputs: { runs: groups.length, example: { shards: last.shards, totalSeconds: last.total, longestSeconds: last.longest } }, sources: { pipelineRuns: Array.from(new Set(groups.map((g) => g.pipeline_run_id))).slice(-50) }, sampleSize: groups.length, recordedAt: pipes.length ? iso(pipes[pipes.length - 1].at) : `${day}T12:00:00.000Z` });
  }
  return out;
}

export interface RecomputeOptions {
  /** Write values with a KPI column into the KPI storage (default true; demo data: false). */
  writeKpis?: boolean;
  actorId?: string | null;
  ingestionId?: string | null;
}

export interface DayResult { day: string; metrics: Array<{ key: string; value: number; sampleSize: number; confidence: Confidence; kpi: string | null; written: boolean }> }

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** The days whose values depend on raw data of `day` for `kind` (flaky tests look back 7 days). */
export function affectedDays(kind: 'tests' | 'coverage' | 'pipelines', day: string, today = todayUtc()): string[] {
  if (kind !== 'tests') return [day];
  const out: string[] = [];
  const d = new Date(`${day}T00:00:00Z`);
  for (let i = 0; i < 7; i++) {
    const x = new Date(d.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    if (x > today) break;
    out.push(x);
  }
  return out;
}

/** Recompute days of a team: metric_evidence upserted, changed KPI values written (source 'computed'). */
export async function recomputeTeamDays(client: pg.PoolClient, teamId: string, days: string[], opts: RecomputeOptions = {}): Promise<DayResult[]> {
  const [team] = await rows(client, 'SELECT company_id FROM teams WHERE id = $1', [teamId]);
  if (!team) return [];
  const results: DayResult[] = [];
  for (const day of Array.from(new Set(days)).sort()) {
    const computed = await computeTeamDay(client, teamId, day);
    const prev = new Map((await rows(client, 'SELECT metric_key, value::float8 AS value, recorded_at FROM metric_evidence WHERE team_id = $1 AND day = $2::date', [teamId, day])).map((r) => [r.metric_key, r]));
    const kpiValues: Record<string, number> = {};
    let recordedAt = '';
    const dayOut: DayResult = { day, metrics: [] };
    for (const m of computed) {
      const spec = METRICS[m.key];
      const conf = confidenceFor(m.sampleSize);
      await client.query(
        `INSERT INTO metric_evidence (company_id, team_id, day, metric_key, value, unit, formula, inputs, sources, sample_size, confidence, kpi_column, recorded_at, computed_at)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13::timestamptz, now())
         ON CONFLICT (team_id, day, metric_key) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit, formula = EXCLUDED.formula,
           inputs = EXCLUDED.inputs, sources = EXCLUDED.sources, sample_size = EXCLUDED.sample_size, confidence = EXCLUDED.confidence,
           kpi_column = EXCLUDED.kpi_column, recorded_at = EXCLUDED.recorded_at, computed_at = now()`,
        [team.company_id, teamId, day, m.key, m.value, spec.unit, spec.formula, JSON.stringify(m.inputs), JSON.stringify(m.sources), m.sampleSize, conf, spec.kpi, m.recordedAt]
      );
      const old = prev.get(m.key);
      const changed = !old || Number(old.value) !== m.value || iso(old.recorded_at) !== m.recordedAt;
      const write = opts.writeKpis !== false && !!spec.kpi && changed;
      if (write) {
        kpiValues[spec.kpi as string] = m.value;
        if (m.recordedAt > recordedAt) recordedAt = m.recordedAt;
      }
      dayOut.metrics.push({ key: m.key, value: m.value, sampleSize: m.sampleSize, confidence: conf, kpi: spec.kpi, written: write });
    }
    // A metric that has no data any more (e.g. its only run was removed) loses its evidence row.
    const keep = computed.map((m) => m.key);
    await client.query('DELETE FROM metric_evidence WHERE team_id = $1 AND day = $2::date AND NOT (metric_key = ANY($3::text[]))', [teamId, day, keep]);
    if (Object.keys(kpiValues).length) {
      // Never later than now (a KPI value is for a moment that has happened).
      const at = new Date(Math.min(new Date(recordedAt).getTime(), Date.now()));
      await recordKpiValues(teamId, kpiValues, { source: 'computed', recordedAt: at, client, notify: false, actorId: opts.actorId ?? null, ingestionId: opts.ingestionId ?? null });
    }
    results.push(dayOut);
  }
  return results;
}

/** Record flaky-test evidence for the commits given (tests that failed and passed on the same commit within 7 days). */
export async function refreshFlakyEvidence(client: pg.PoolClient, teamId: string, commits: string[]): Promise<number> {
  const list = commits.filter((c) => c);
  if (!list.length) return 0;
  const r = await client.query(
    `INSERT INTO flaky_test_evidence (company_id, team_id, test_key, suite, name, commit_sha, failed_run_ids, passed_run_ids, failure_message, first_seen, last_seen)
     SELECT MAX(tr.company_id), tr.team_id, r.test_key, MAX(r.suite), MAX(r.name), tr.commit_sha,
            COALESCE(array_agg(DISTINCT tr.id) FILTER (WHERE r.status IN ('failed', 'error') OR r.retries > 0), '{}'),
            COALESCE(array_agg(DISTINCT tr.id) FILTER (WHERE r.status = 'passed'), '{}'),
            MAX(r.failure_message), MIN(tr.started_at), MAX(tr.started_at)
       FROM test_results r JOIN test_runs tr ON tr.id = r.test_run_id
      WHERE tr.team_id = $1 AND tr.commit_sha = ANY($2::text[]) AND tr.started_at >= now() - interval '400 days'
      GROUP BY tr.team_id, r.test_key, tr.commit_sha
     HAVING (bool_or(r.status = 'passed') AND bool_or(r.status IN ('failed', 'error'))) OR bool_or(r.status = 'passed' AND r.retries > 0)
     ON CONFLICT (team_id, test_key, commit_sha) DO UPDATE SET failed_run_ids = EXCLUDED.failed_run_ids, passed_run_ids = EXCLUDED.passed_run_ids,
       failure_message = COALESCE(EXCLUDED.failure_message, flaky_test_evidence.failure_message), first_seen = EXCLUDED.first_seen, last_seen = EXCLUDED.last_seen`,
    [teamId, list]
  );
  return r.rowCount ?? 0;
}

/** Nightly: recompute the last `days` days of every team that has raw data in that period. */
export async function recomputeRecent(client: pg.PoolClient, days = 8): Promise<{ teams: number; values: number }> {
  const teams = await rows(client,
    `SELECT DISTINCT team_id FROM (
       SELECT team_id FROM test_runs WHERE day >= CURRENT_DATE - $1::int
       UNION SELECT team_id FROM coverage_reports WHERE day >= CURRENT_DATE - $1::int
       UNION SELECT team_id FROM pipeline_runs_raw WHERE day >= CURRENT_DATE - $1::int) x`, [days]);
  let values = 0;
  for (const { team_id } of teams) {
    // Demo (sample) teams keep their sample KPI values; only their evidence is refreshed.
    const demo = await rows(client,
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM test_runs WHERE team_id = $1 AND is_sample)
          OR EXISTS (SELECT 1 FROM coverage_reports WHERE team_id = $1 AND is_sample)
          OR EXISTS (SELECT 1 FROM pipeline_runs_raw WHERE team_id = $1 AND is_sample)`, [team_id]);
    const list: string[] = [];
    for (let i = days; i >= 0; i--) list.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
    const res = await recomputeTeamDays(client, team_id, list, { writeKpis: demo.length === 0 });
    values += res.reduce((n, d) => n + d.metrics.filter((m) => m.written).length, 0);
  }
  return { teams: teams.length, values };
}
