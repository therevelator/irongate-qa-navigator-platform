/**
 * The Analytics modules read from the raw CI data customers send (the QE Navigator Exporter, the
 * ingestion API or Upload files): the same tables the calculation engine and the evidence panels use.
 *
 *   Flaky tests       flaky_test_evidence + test_results / test_runs
 *   Test execution    test_runs
 *   CI/CD pipeline    pipeline_stage_runs + pipeline_runs_raw
 *   Performance       performance_results + performance_runs (load-test result files: k6, JMeter, Gatling)
 *
 * Each function returns null when the scope (one team, or every team of the company the caller may
 * see) has no raw data of that kind at all; the route then falls back to the older module tables
 * (flaky_tests, test_execution_runs, pipeline_stages, pipeline_execution_summary), which hold sample
 * data only. Nothing here is typed in and nothing is invented: a value the raw data cannot give
 * (CPU, memory, cost per run, a root cause) is null.
 */
import { createHash } from 'crypto';
import { query, queryOne } from '../../src/lib/db';

/** The window the Flaky tests module looks at (the same 30 days as Evidence from CI on Team detail). */
export const RAW_FLAKY_WINDOW_DAYS = 30;
/** The window the pipeline stages are averaged over. */
export const RAW_STAGE_WINDOW_DAYS = 30;

export interface RawScope {
  companyId: string;
  /** One team, or null for the teams in `teamIds` (null there too: every active team of the company). */
  teamId: string | null;
  teamIds?: string[] | null;
}

/** SQL condition and parameters limiting `alias` (a table with company_id and team_id) to the scope. */
function scopeSql(alias: string, s: RawScope): { sql: string; params: unknown[] } {
  if (s.teamId) return { sql: `${alias}.company_id = ? AND ${alias}.team_id = ?`, params: [s.companyId, s.teamId] };
  if (s.teamIds) return { sql: `${alias}.company_id = ? AND ${alias}.team_id = ANY(?::text[])`, params: [s.companyId, s.teamIds] };
  return { sql: `${alias}.company_id = ? AND ${alias}.team_id IN (SELECT id FROM teams WHERE company_id = ? AND is_active = TRUE)`, params: [s.companyId, s.companyId] };
}

const n = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v: number, d = 1): number => Math.round(v * 10 ** d) / 10 ** d;

async function hasRows(table: 'test_runs' | 'pipeline_runs_raw' | 'performance_runs', s: RawScope): Promise<{ any: boolean; sampleOnly: boolean }> {
  const w = scopeSql('x', s);
  const r = await queryOne<any>(
    `SELECT EXISTS (SELECT 1 FROM ${table} x WHERE ${w.sql}) AS any_rows,
            EXISTS (SELECT 1 FROM ${table} x WHERE ${w.sql} AND NOT x.is_sample) AS real_rows`, [...w.params, ...w.params]);
  return { any: !!r?.any_rows, sampleOnly: !!r?.any_rows && !r?.real_rows };
}

// ---------------------------------------------------------------------------------------------
// Flaky tests
// ---------------------------------------------------------------------------------------------

export interface RawFlakyTest {
  id: string;
  test_name: string;
  suite: string | null;
  /** flaky runs ÷ runs of the test in the window × 100 (see RAW_FLAKY_SCORE_FORMULA). */
  flakiness_score: number | null;
  failure_pattern: 'unknown';
  occurrences: number;
  pass_count: number | null;
  total_runs: number | null;
  first_detected: string | null;
  last_occurrence: string | null;
  suggested_fix: null;
  root_cause: null;
  root_cause_verified: false;
  commits: string[];
  history: Array<{ date: string; passed: boolean }>;
}

export const RAW_FLAKY_SCORE_FORMULA =
  'runs in which the test failed on a commit where it also passed ÷ runs of the test in the last 30 days × 100';

/**
 * Flaky tests of the scope from the raw test reports: tests that failed and passed on the same commit
 * (flaky_test_evidence, written by the calculation engine), with the runs of each in the last 30 days.
 * null when the scope never sent a test report.
 */
export async function rawFlakyTests(s: RawScope): Promise<{ tests: RawFlakyTest[]; sample: boolean } | null> {
  const has = await hasRows('test_runs', s);
  if (!has.any) return null;
  const w = scopeSql('f', s);
  const rows = await query<any[]>(
    `SELECT f.team_id, f.test_key, f.suite, f.name, f.commit_sha, f.failed_run_ids, f.passed_run_ids, f.first_seen, f.last_seen
       FROM flaky_test_evidence f
      WHERE ${w.sql} AND f.last_seen >= now() - interval '${RAW_FLAKY_WINDOW_DAYS} days'
      ORDER BY f.last_seen DESC LIMIT 2000`, w.params);
  const byTest = new Map<string, { teamId: string; testKey: string; suite: string | null; name: string; commits: string[]; failed: Set<string>; first: string; last: string }>();
  for (const f of rows as any[]) {
    const key = `${f.team_id}:${f.test_key}`;
    const t = byTest.get(key) ?? { teamId: f.team_id, testKey: f.test_key, suite: f.suite, name: f.name, commits: [] as string[], failed: new Set<string>(), first: f.first_seen, last: f.last_seen };
    if (!t.commits.includes(f.commit_sha)) t.commits.push(f.commit_sha);
    (f.failed_run_ids ?? []).forEach((x: string) => t.failed.add(x));
    if (+new Date(f.first_seen) < +new Date(t.first)) t.first = f.first_seen;
    if (+new Date(f.last_seen) > +new Date(t.last)) t.last = f.last_seen;
    byTest.set(key, t);
  }
  const list = Array.from(byTest.values());
  if (list.length === 0) return { tests: [], sample: has.sampleOnly };

  // Every result of these tests in the window: the counts and the last 20 results of each.
  const teamIds = Array.from(new Set(list.map((t) => t.teamId)));
  const keys = Array.from(new Set(list.map((t) => t.testKey)));
  const results = await query<any[]>(
    `SELECT r.team_id, r.test_key, r.status, tr.started_at
       FROM test_results r JOIN test_runs tr ON tr.id = r.test_run_id
      WHERE r.team_id = ANY(?::text[]) AND r.test_key = ANY(?::text[])
        AND tr.day >= CURRENT_DATE - ${RAW_FLAKY_WINDOW_DAYS} AND r.status <> 'skipped'
      ORDER BY tr.started_at DESC LIMIT 50000`, [teamIds, keys]);
  const stats = new Map<string, { total: number; passed: number; history: Array<{ date: string; passed: boolean }> }>();
  for (const r of results as any[]) {
    const key = `${r.team_id}:${r.test_key}`;
    const st = stats.get(key) ?? { total: 0, passed: 0, history: [] };
    st.total += 1;
    if (r.status === 'passed') st.passed += 1;
    if (st.history.length < 20) st.history.push({ date: new Date(r.started_at).toISOString(), passed: r.status === 'passed' });
    stats.set(key, st);
  }
  const tests: RawFlakyTest[] = list.map((t) => {
    const st = stats.get(`${t.teamId}:${t.testKey}`);
    const total = st?.total ?? null;
    const flakyRuns = t.failed.size;
    return {
      id: createHash('sha256').update(`${t.teamId}:${t.testKey}`).digest('hex').slice(0, 32),
      test_name: t.suite && !t.name.startsWith(t.suite) ? `${t.suite} › ${t.name}` : t.name,
      suite: t.suite,
      flakiness_score: total && total > 0 ? round(Math.min(100, (flakyRuns / total) * 100)) : null,
      failure_pattern: 'unknown' as const,
      occurrences: flakyRuns,
      pass_count: st?.passed ?? null,
      total_runs: total,
      first_detected: t.first ? new Date(t.first).toISOString() : null,
      last_occurrence: t.last ? new Date(t.last).toISOString() : null,
      suggested_fix: null,
      root_cause: null,
      root_cause_verified: false as const,
      commits: t.commits.slice(0, 5),
      history: st?.history ?? [],
    };
  }).sort((a, b) => (b.flakiness_score ?? -1) - (a.flakiness_score ?? -1) || b.occurrences - a.occurrences).slice(0, 50);
  return { tests, sample: has.sampleOnly };
}

// ---------------------------------------------------------------------------------------------
// Test execution
// ---------------------------------------------------------------------------------------------

export interface RawTestExecution {
  id: string;
  test_suite: string;
  status: 'passed' | 'failed';
  start_time: string;
  end_time: string | null;
  duration: number | null;
  /** A CI run has no assignee; the label says where the run came from. */
  assigned_to: 'CI';
  dependencies: string[];
  commit: string | null;
  branch: string | null;
  run_id: string | null;
  attempt: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

/**
 * The test runs of the scope in the last `days` days (newest first, at most 100), one row per report
 * received. A run with a failed or errored test is "failed". null when the scope never sent a report.
 */
export async function rawTestExecutions(s: RawScope, days: number): Promise<{ executions: RawTestExecution[]; sample: boolean } | null> {
  const has = await hasRows('test_runs', s);
  if (!has.any) return null;
  const w = scopeSql('tr', s);
  const rows = await query<any[]>(
    `SELECT tr.id, tr.repo, tr.branch, tr.commit_sha, tr.run_id, tr.attempt, tr.started_at, tr.duration_ms, tr.tests_duration_ms,
            tr.total, tr.passed, tr.failed, tr.errored, tr.skipped, tr.format
       FROM test_runs tr
      WHERE ${w.sql} AND tr.started_at >= now() - CAST(? AS INTEGER) * INTERVAL '1 day'
      ORDER BY tr.started_at DESC LIMIT 100`, [...w.params, days]);
  const executions = (rows as any[]).map((r): RawTestExecution => {
    const ms = n(r.duration_ms) || n(r.tests_duration_ms);
    const seconds = ms !== null && ms > 0 ? round(ms / 1000, 1) : null;
    const start = new Date(r.started_at);
    const label = [r.repo || null, r.branch || null, r.run_id ? `run ${r.run_id}${r.attempt > 1 ? ` (attempt ${r.attempt})` : ''}` : null].filter(Boolean).join(' · ');
    return {
      id: r.id,
      test_suite: label || `${String(r.format ?? 'test').toUpperCase()} report`,
      status: (n(r.failed) ?? 0) + (n(r.errored) ?? 0) > 0 ? 'failed' : 'passed',
      start_time: start.toISOString(),
      end_time: seconds !== null ? new Date(start.getTime() + seconds * 1000).toISOString() : null,
      duration: seconds,
      assigned_to: 'CI',
      dependencies: [],
      commit: r.commit_sha || null,
      branch: r.branch || null,
      run_id: r.run_id || null,
      attempt: n(r.attempt) ?? 1,
      total: n(r.total) ?? 0,
      passed: n(r.passed) ?? 0,
      failed: (n(r.failed) ?? 0) + (n(r.errored) ?? 0),
      skipped: n(r.skipped) ?? 0,
    };
  });
  return { executions, sample: has.sampleOnly };
}

// ---------------------------------------------------------------------------------------------
// CI/CD pipeline: stages and daily stage executions
// ---------------------------------------------------------------------------------------------

export interface RawPipelineStage {
  id: string;
  name: string;
  /** Mean duration of the stage's completed executions, seconds. */
  duration: number | null;
  /** successful ÷ (successful + failed) executions × 100. */
  success_rate: number | null;
  runs: number;
  failed_runs: number;
}

/**
 * The stages of the scope's pipelines over the last 30 days, in the order they start within a run.
 * Skipped and cancelled stage executions are left out. null when the scope never sent a pipeline run;
 * an empty list when its runs carry no stages (the CI does not report them).
 */
export async function rawPipelineStages(s: RawScope): Promise<{ stages: RawPipelineStage[]; sample: boolean; pipelineRuns: number } | null> {
  const has = await hasRows('pipeline_runs_raw', s);
  if (!has.any) return null;
  const w = scopeSql('p', s);
  const rows = await query<any[]>(
    `SELECT st.name,
            COUNT(*) FILTER (WHERE st.result IN ('success', 'failed'))::int AS runs,
            COUNT(*) FILTER (WHERE st.result = 'failed')::int AS failed,
            AVG(st.duration_s) FILTER (WHERE st.result IN ('success', 'failed') AND st.duration_s IS NOT NULL)::float AS mean_s,
            AVG(EXTRACT(EPOCH FROM (st.started_at - p.started_at))) FILTER (WHERE st.started_at IS NOT NULL)::float AS start_offset
       FROM pipeline_stage_runs st JOIN pipeline_runs_raw p ON p.id = st.pipeline_run_id
      WHERE ${w.sql} AND p.day >= CURRENT_DATE - ${RAW_STAGE_WINDOW_DAYS - 1}
      GROUP BY st.name
     HAVING COUNT(*) FILTER (WHERE st.result IN ('success', 'failed')) > 0
      ORDER BY start_offset ASC NULLS LAST, st.name ASC LIMIT 60`, w.params);
  const count = await queryOne<any>(
    `SELECT COUNT(*)::int AS c FROM pipeline_runs_raw p WHERE ${w.sql} AND p.day >= CURRENT_DATE - ${RAW_STAGE_WINDOW_DAYS - 1}`, w.params);
  const stages = (rows as any[]).map((r): RawPipelineStage => {
    const runs = n(r.runs) ?? 0;
    const failed = n(r.failed) ?? 0;
    return {
      id: `ci-${createHash('sha256').update(String(r.name)).digest('hex').slice(0, 16)}`,
      name: String(r.name),
      duration: n(r.mean_s) !== null ? round(n(r.mean_s) as number, 1) : null,
      success_rate: runs > 0 ? round(((runs - failed) / runs) * 100, 1) : null,
      runs,
      failed_runs: failed,
    };
  });
  return { stages, sample: has.sampleOnly, pipelineRuns: n(count?.c) ?? 0 };
}

export interface RawPipelineDay {
  date: string;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  failure_rate: number | null;
  avg_duration_seconds: number | null;
  total_cost: null;
}

/** Stage executions per day (completed ones: successful or failed) over the last `days` days. */
export async function rawPipelineHistory(s: RawScope, days: number): Promise<{ history: RawPipelineDay[]; sample: boolean } | null> {
  const has = await hasRows('pipeline_runs_raw', s);
  if (!has.any) return null;
  const w = scopeSql('p', s);
  const rows = await query<any[]>(
    `SELECT to_char(p.day, 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE st.result = 'success')::int AS ok,
            COUNT(*) FILTER (WHERE st.result = 'failed')::int AS failed,
            AVG(st.duration_s) FILTER (WHERE st.duration_s IS NOT NULL)::float AS mean_s
       FROM pipeline_stage_runs st JOIN pipeline_runs_raw p ON p.id = st.pipeline_run_id
      WHERE ${w.sql} AND p.day >= CURRENT_DATE - CAST(? AS INTEGER) AND st.result IN ('success', 'failed')
      GROUP BY p.day ORDER BY p.day ASC`, [...w.params, days]);
  const history = (rows as any[]).map((r): RawPipelineDay => {
    const total = n(r.total) ?? 0;
    const failed = n(r.failed) ?? 0;
    return {
      date: r.day,
      total_runs: total,
      successful_runs: n(r.ok) ?? 0,
      failed_runs: failed,
      failure_rate: total > 0 ? Number(((failed / total) * 100).toFixed(2)) : null,
      avg_duration_seconds: n(r.mean_s) !== null ? round(n(r.mean_s) as number, 1) : null,
      total_cost: null,
    };
  });
  return { history, sample: has.sampleOnly };
}

// ---------------------------------------------------------------------------------------------
// Performance: load-test results
// ---------------------------------------------------------------------------------------------

export interface RawPerformanceRow {
  id: string;
  endpoint: string;
  method: null;
  response_time_p50: number | null;
  response_time_p95: number | null;
  response_time_p99: number | null;
  /** Requests per minute. */
  throughput: number | null;
  error_rate: number | null;
  recorded_date: string;
  timestamp: string;
  tool: string;
  run: string;
  requests: number | null;
}

/**
 * The load-test results of the scope in the last `days` days: per day and endpoint, the values of the latest run
 * of that day (one run's own percentiles; runs are never averaged together). null when the scope never sent a
 * load-test result, or the tables do not exist yet (a deploy before migration 20261209000000).
 */
export async function rawPerformance(s: RawScope, days: number): Promise<{ metrics: RawPerformanceRow[]; sample: boolean } | null> {
  const exists = await queryOne<any>(`SELECT to_regclass('public.performance_runs') IS NOT NULL AS ok`, []);
  if (!exists?.ok) return null;
  const has = await hasRows('performance_runs', s);
  if (!has.any) return null;
  const w = scopeSql('p', s);
  const rows = await query<any[]>(
    `SELECT DISTINCT ON (p.team_id, p.day, r.endpoint)
            r.id, r.endpoint, r.requests, r.p50_ms::float8 AS p50, r.p95_ms::float8 AS p95, r.p99_ms::float8 AS p99,
            r.throughput_per_minute::float8 AS tpm, r.error_rate::float8 AS error_rate, to_char(p.day, 'YYYY-MM-DD') AS day, p.tool, p.run_key
       FROM performance_results r JOIN performance_runs p ON p.id = r.run_id
      WHERE ${w.sql} AND p.day >= CURRENT_DATE - CAST(? AS INTEGER)
      ORDER BY p.team_id, p.day DESC, r.endpoint, p.started_at DESC LIMIT 500`, [...w.params, days]);
  const metrics = (rows as any[]).map((r): RawPerformanceRow => ({
    id: r.id, endpoint: r.endpoint, method: null,
    response_time_p50: n(r.p50) === null ? null : Math.round(n(r.p50) as number), response_time_p95: n(r.p95) === null ? null : Math.round(n(r.p95) as number),
    response_time_p99: n(r.p99) === null ? null : Math.round(n(r.p99) as number),
    throughput: n(r.tpm) === null ? null : Math.round(n(r.tpm) as number), error_rate: n(r.error_rate),
    recorded_date: r.day, timestamp: r.day, tool: r.tool, run: r.run_key, requests: n(r.requests),
  }));
  return { metrics, sample: has.sampleOnly };
}
