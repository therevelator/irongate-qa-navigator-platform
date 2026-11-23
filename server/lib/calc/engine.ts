/**
 * Calculation engine (docs/V2_PLAN.md, "Calculation rules"): the server side.
 *
 * The rules themselves are the shared engine's (packages/engine: phase 1 tests / coverage / pipelines in
 * calc/ci.ts, phase 2 delivery in calc/delivery.ts, phase 3 work and code quality in calc/work.ts and
 * calc/quality.ts). This file reads
 * the records a team's days depend on from the raw store (test_runs / test_results, coverage_reports /
 * coverage_files, pipeline_runs_raw / pipeline_stage_runs, and through delivery.ts, work.ts and quality.ts the
 * deliveries, incidents, issues and static-analysis reports), runs the engine and stores the result.
 *
 * Each value is stored in metric_evidence with its formula, the values used, the number of runs
 * (confidence) and the source records; the values that have a KPI column are written through the
 * one KPI write path (recordKpiValues, source 'computed'), so dashboards, alerts, targets and the
 * QA score use them. A value that did not change is not written again.
 */
import type pg from 'pg';
import { pool } from '../../../src/lib/db';
import { KPI_COLUMNS, recordKpiValues, withTransaction, type KpiColumn } from '../kpiIngest';
import { computeDeliveryDays, WINDOW_DAYS, CHANGE_FAILURE_WINDOW_HOURS } from './delivery';
import { computeWorkDays, phase3Tables, SPRINT_STALE_DAYS } from './work';
import { computeQualityDays, REPORT_STALE_DAYS } from './quality';
import { buildMetrics, ALL_GROUPS, confidenceFor, type ComputedMetric, type Confidence, type MetricGroup, type MetricSpec } from '../../../packages/engine/src/index';
import { computeCiDay, pickCoverageReport, type CiData } from '../../../packages/engine/src/calc/ci';

export { ALL_GROUPS, confidenceFor, median, type ComputedMetric, type MetricGroup, type MetricSpec, type Confidence } from '../../../packages/engine/src/calc/types';
export { affectedDays } from '../../../packages/engine/src/calc/ci';
export { ENGINE_VERSION } from '../../../packages/engine/src/version';

/** Every computed metric (the engine's specs, with the server's hotfix window in the change-failure formula). */
export const METRICS: Record<string, MetricSpec> = buildMetrics({ changeFailureWindowHours: CHANGE_FAILURE_WINDOW_HOURS });
export const groupOf = (key: string): MetricGroup => METRICS[key]?.group ?? 'ci';

/** The metric_evidence key behind a KPI column (for "How this was calculated"). */
export const EVIDENCE_FOR_KPI: Partial<Record<string, string>> = Object.fromEntries(
  Object.values(METRICS).filter((m) => m.kpi).map((m) => [m.kpi as string, m.key])
);

async function rows<T = any>(client: pg.PoolClient, sql: string, params: any[]): Promise<T[]> {
  return (await client.query(sql, params)).rows as T[];
}

const iso = (d: any) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());
const ms = (d: any): number | null => (d === null || d === undefined ? null : new Date(d).getTime());

/**
 * The records the phase-1 values of one day depend on: the day's coverage reports (with the files of the report
 * the values use), the test runs of the 7 days ending the day (with their results when the day has runs: flaky
 * tests) and the day's pipeline runs with their stages.
 */
export async function loadCiDay(client: pg.PoolClient, teamId: string, day: string): Promise<CiData> {
  const team = (await rows(client, 'SELECT main_branch FROM teams WHERE id = $1', [teamId]))[0];
  const mainBranch: string | null = team?.main_branch || null;
  const coverage = (await rows(client,
    `SELECT id, commit_sha, branch, attempt, day::text AS day, created_at, format, lines_found, lines_hit, branches_found, branches_hit, file_count,
            changed_lines_found, changed_lines_hit
       FROM coverage_reports WHERE team_id = $1 AND day = $2::date ORDER BY created_at`, [teamId, day])).map((c) => ({
    id: c.id, commit: c.commit_sha, branch: c.branch, attempt: c.attempt, day: c.day, createdAt: ms(c.created_at)!, format: c.format,
    linesFound: Number(c.lines_found), linesHit: Number(c.lines_hit), branchesFound: Number(c.branches_found), branchesHit: Number(c.branches_hit), fileCount: Number(c.file_count),
    changedLinesFound: c.changed_lines_found === null ? null : Number(c.changed_lines_found), changedLinesHit: c.changed_lines_hit === null ? null : Number(c.changed_lines_hit),
  }));
  const picked = pickCoverageReport(day, { coverage, mainBranch });
  if (picked) {
    (picked as CiData['coverage'][number]).files = (await rows(client, 'SELECT path, lines_found, lines_hit FROM coverage_files WHERE report_id = $1 AND lines_found > 0', [picked.id]))
      .map((f) => ({ path: f.path, linesFound: Number(f.lines_found), linesHit: Number(f.lines_hit) }));
  }
  const testRuns = (await rows(client,
    `SELECT id, commit_sha, run_id, attempt, branch, day::text AS day, started_at, passed, failed, errored, skipped, duration_ms, format
       FROM test_runs WHERE team_id = $1 AND day BETWEEN $2::date - 6 AND $2::date ORDER BY started_at`, [teamId, day])).map((r) => ({
    id: r.id, commit: r.commit_sha, runId: r.run_id, attempt: r.attempt, branch: r.branch, day: r.day, startedAt: ms(r.started_at)!,
    passed: Number(r.passed), failed: Number(r.failed), errored: Number(r.errored), skipped: Number(r.skipped), durationMs: Number(r.duration_ms), format: r.format,
    cases: [] as NonNullable<CiData['testRuns'][number]['cases']>,
  }));
  if (testRuns.some((r) => r.day === day)) {
    const byRun = new Map(testRuns.map((r) => [r.id, r]));
    const results = await rows(client,
      `SELECT r.test_run_id, r.test_key, r.suite, r.name, r.status, r.retries, r.duration_ms
         FROM test_results r JOIN test_runs tr ON tr.id = r.test_run_id
        WHERE tr.team_id = $1 AND tr.day BETWEEN $2::date - 6 AND $2::date`, [teamId, day]);
    for (const x of results) byRun.get(x.test_run_id)?.cases.push({ testKey: x.test_key, suite: x.suite, name: x.name, status: x.status, retries: Number(x.retries), durationMs: Number(x.duration_ms) });
  }
  const pipes = await rows(client,
    `SELECT id, external_id, attempt, name, commit_sha, branch, day::text AS day, started_at, finished_at, duration_s, result, url
       FROM pipeline_runs_raw WHERE team_id = $1 AND day = $2::date ORDER BY started_at`, [teamId, day]);
  const stages = pipes.length ? await rows(client,
    `SELECT s.pipeline_run_id, s.name, s.kind, s.parallel_group, s.started_at, s.finished_at, s.duration_s, s.result
       FROM pipeline_stage_runs s JOIN pipeline_runs_raw p ON p.id = s.pipeline_run_id
      WHERE p.team_id = $1 AND p.day = $2::date`, [teamId, day]) : [];
  const pipelines = pipes.map((p) => ({
    id: p.id, externalId: p.external_id, attempt: p.attempt, name: p.name, commit: p.commit_sha, branch: p.branch, day: p.day,
    startedAt: ms(p.started_at)!, finishedAt: ms(p.finished_at), durationS: p.duration_s === null ? null : Number(p.duration_s), result: p.result, url: p.url,
    stages: stages.filter((s) => s.pipeline_run_id === p.id).map((s) => ({
      name: s.name, kind: s.kind, parallelGroup: s.parallel_group, startedAt: ms(s.started_at), finishedAt: ms(s.finished_at),
      durationS: s.duration_s === null ? null : Number(s.duration_s), result: s.result,
    })),
  }));
  return { mainBranch, coverage, testRuns, pipelines };
}

/** Compute every phase-1 metric of a team for one day (UTC). Pure reads; the rules are the shared engine's. */
export async function computeTeamDay(client: pg.PoolClient, teamId: string, day: string): Promise<ComputedMetric[]> {
  return computeCiDay(day, await loadCiDay(client, teamId, day));
}

export interface RecomputeOptions {
  /** Write values with a KPI column into the KPI storage (default true; demo data: false). */
  writeKpis?: boolean;
  /** The metric groups to recompute (default all): 'ci' after test / coverage / pipeline data, 'delivery' after deployments / incidents, 'work' after issues, 'quality' after static-analysis reports. */
  groups?: MetricGroup[];
  actorId?: string | null;
  ingestionId?: string | null;
}

export interface DayResult { day: string; metrics: Array<{ key: string; value: number; sampleSize: number; confidence: Confidence; kpi: string | null; written: boolean }> }

/** Recompute days of a team: metric_evidence upserted, changed KPI values written (source 'computed'). */
export async function recomputeTeamDays(client: pg.PoolClient, teamId: string, days: string[], opts: RecomputeOptions = {}): Promise<DayResult[]> {
  const [team] = await rows(client, 'SELECT company_id FROM teams WHERE id = $1', [teamId]);
  if (!team) return [];
  const results: DayResult[] = [];
  const groups: MetricGroup[] = opts.groups ?? ALL_GROUPS;
  const list = Array.from(new Set(days)).sort();
  const none = new Map<string, ComputedMetric[]>();
  const delivery = groups.includes('delivery') ? await computeDeliveryDays(client, teamId, list) : none;
  const work = groups.includes('work') ? await computeWorkDays(client, teamId, list) : none;
  const quality = groups.includes('quality') ? await computeQualityDays(client, teamId, list) : none;
  const groupKeys = Object.keys(METRICS).filter((k) => groups.includes(groupOf(k)));
  // Sample (demo) issues and static-analysis reports are evidence only: never written as KPI values.
  const sampleOnly = new Set<MetricGroup>();
  if (opts.writeKpis !== false && (work.size || quality.size)) {
    const so = (await rows(client,
      `SELECT EXISTS (SELECT 1 FROM issues WHERE team_id = $1 AND is_sample) AND NOT EXISTS (SELECT 1 FROM issues WHERE team_id = $1 AND NOT is_sample) AS work,
              EXISTS (SELECT 1 FROM analysis_reports WHERE team_id = $1 AND is_sample) AND NOT EXISTS (SELECT 1 FROM analysis_reports WHERE team_id = $1 AND NOT is_sample) AS quality`, [teamId]))[0];
    if (so?.work) sampleOnly.add('work');
    if (so?.quality) sampleOnly.add('quality');
  }
  // Every day's values first (reads only), then the evidence of all the days in three statements (the previous values,
  // one multi-row upsert, one delete of the values that have no data any more) and the KPI values day by day.
  const perDay = new Map<string, ComputedMetric[]>();
  for (const day of list) {
    const computed = [...(groups.includes('ci') ? await computeTeamDay(client, teamId, day) : []), ...(delivery.get(day) ?? []), ...(work.get(day) ?? []), ...(quality.get(day) ?? [])];
    // One value per metric and day (a later one replaces an earlier one, as consecutive upserts did).
    perDay.set(day, Array.from(new Map(computed.map((m) => [m.key, m])).values()));
  }
  if (!list.length) return results;
  const prevAll = new Map<string, any>((await rows(client,
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, metric_key, value::float8 AS value, recorded_at FROM metric_evidence WHERE team_id = $1 AND day = ANY($2::date[])`, [teamId, list]))
    .map((r) => [`${r.day}|${r.metric_key}`, r]));
  const evidence = list.flatMap((day) => perDay.get(day)!.map((m) => {
    const spec = METRICS[m.key];
    return { day, key: m.key, value: m.value, unit: spec.unit, formula: spec.formula, inputs: m.inputs, sources: m.sources, n: m.sampleSize, conf: confidenceFor(m.sampleSize), kpi: spec.kpi, at: m.recordedAt };
  }));
  const CHUNK = 500;
  for (let i = 0; i < evidence.length; i += CHUNK) {
    await client.query(
      `INSERT INTO metric_evidence (company_id, team_id, day, metric_key, value, unit, formula, inputs, sources, sample_size, confidence, kpi_column, recorded_at, computed_at)
       SELECT $1, $2, x.day, x.key, x.value, x.unit, x.formula, COALESCE(x.inputs, '{}'::jsonb), COALESCE(x.sources, '{}'::jsonb), x.n, x.conf, x.kpi, x.at, now()
         FROM jsonb_to_recordset($3::jsonb) AS x(day date, key text, value numeric, unit text, formula text, inputs jsonb, sources jsonb, n int, conf text, kpi text, at timestamptz)
       ON CONFLICT (team_id, day, metric_key) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit, formula = EXCLUDED.formula,
         inputs = EXCLUDED.inputs, sources = EXCLUDED.sources, sample_size = EXCLUDED.sample_size, confidence = EXCLUDED.confidence,
         kpi_column = EXCLUDED.kpi_column, recorded_at = EXCLUDED.recorded_at, computed_at = now()`,
      [team.company_id, teamId, JSON.stringify(evidence.slice(i, i + CHUNK))]
    );
  }
  // A metric that has no data any more (e.g. its only run was removed) loses its evidence row.
  await client.query(
    `DELETE FROM metric_evidence e WHERE e.team_id = $1 AND e.day = ANY($2::date[]) AND e.metric_key = ANY($3::text[])
        AND NOT EXISTS (SELECT 1 FROM unnest($4::date[], $5::text[]) AS k(day, key) WHERE k.day = e.day AND k.key = e.metric_key)`,
    [teamId, list, groupKeys, evidence.map((x) => x.day), evidence.map((x) => x.key)]);
  for (const day of list) {
    const computed = perDay.get(day)!;
    const kpiValues: Record<string, number> = {};
    let recordedAt = '';
    const dayOut: DayResult = { day, metrics: [] };
    for (const m of computed) {
      const spec = METRICS[m.key];
      const conf = confidenceFor(m.sampleSize);
      const old = prevAll.get(`${day}|${m.key}`);
      const changed = !old || Number(old.value) !== m.value || iso(old.recorded_at) !== m.recordedAt;
      const write = opts.writeKpis !== false && !!spec.kpi && changed && !sampleOnly.has(groupOf(m.key));
      if (write) {
        // The evidence keeps the exact value; the KPI column holds what its type can (e.g. lead time ≤ 99.99 days).
        const range = KPI_COLUMNS[spec.kpi as KpiColumn];
        kpiValues[spec.kpi as string] = Math.min(range.max, Math.max(range.min, m.value));
        if (m.recordedAt > recordedAt) recordedAt = m.recordedAt;
      }
      dayOut.metrics.push({ key: m.key, value: m.value, sampleSize: m.sampleSize, confidence: conf, kpi: spec.kpi, written: write });
    }
    if (Object.keys(kpiValues).length) {
      // Never later than now (a KPI value is for a moment that has happened).
      const at = new Date(Math.min(new Date(recordedAt).getTime(), Date.now()));
      await recordKpiValues(teamId, kpiValues, { source: 'computed', recordedAt: at, client, notify: false, actorId: opts.actorId ?? null, ingestionId: opts.ingestionId ?? null, companyId: team.company_id });
    }
    results.push(dayOut);
  }
  return results;
}

/**
 * The phase-1 records of a range of days in one pass (six queries): the coverage reports of the days (with the
 * files of each day's report that the values use), the test runs of the range and the 6 days before it with
 * their results, and the pipeline runs with their stages. computeCiDay selects each day's records from them
 * exactly as loadCiDay does for one day.
 */
export async function loadCiRange(client: pg.PoolClient, teamId: string, from: string, to: string): Promise<CiData> {
  const team = (await rows(client, 'SELECT main_branch FROM teams WHERE id = $1', [teamId]))[0];
  const mainBranch: string | null = team?.main_branch || null;
  const coverage = (await rows(client,
    `SELECT id, commit_sha, branch, attempt, day::text AS day, created_at, format, lines_found, lines_hit, branches_found, branches_hit, file_count,
            changed_lines_found, changed_lines_hit
       FROM coverage_reports WHERE team_id = $1 AND day BETWEEN $2::date AND $3::date ORDER BY created_at`, [teamId, from, to])).map((c) => ({
    id: c.id, commit: c.commit_sha, branch: c.branch, attempt: c.attempt, day: c.day, createdAt: ms(c.created_at)!, format: c.format,
    linesFound: Number(c.lines_found), linesHit: Number(c.lines_hit), branchesFound: Number(c.branches_found), branchesHit: Number(c.branches_hit), fileCount: Number(c.file_count),
    changedLinesFound: c.changed_lines_found === null ? null : Number(c.changed_lines_found), changedLinesHit: c.changed_lines_hit === null ? null : Number(c.changed_lines_hit),
  })) as CiData['coverage'];
  const picked = new Map<string, CiData['coverage'][number]>();
  for (const day of new Set(coverage.map((c) => c.day))) {
    const p = pickCoverageReport(day, { coverage, mainBranch });
    if (p) picked.set(p.id, p as CiData['coverage'][number]);
  }
  if (picked.size) {
    for (const p of picked.values()) p.files = [];
    for (const f of await rows(client, 'SELECT report_id, path, lines_found, lines_hit FROM coverage_files WHERE report_id = ANY($1::text[]) AND lines_found > 0', [Array.from(picked.keys())])) {
      picked.get(f.report_id)!.files!.push({ path: f.path, linesFound: Number(f.lines_found), linesHit: Number(f.lines_hit) });
    }
  }
  const testRuns = (await rows(client,
    `SELECT id, commit_sha, run_id, attempt, branch, day::text AS day, started_at, passed, failed, errored, skipped, duration_ms, format
       FROM test_runs WHERE team_id = $1 AND day BETWEEN $2::date - 6 AND $3::date ORDER BY started_at`, [teamId, from, to])).map((r) => ({
    id: r.id, commit: r.commit_sha, runId: r.run_id, attempt: r.attempt, branch: r.branch, day: r.day, startedAt: ms(r.started_at)!,
    passed: Number(r.passed), failed: Number(r.failed), errored: Number(r.errored), skipped: Number(r.skipped), durationMs: Number(r.duration_ms), format: r.format,
    cases: [] as NonNullable<CiData['testRuns'][number]['cases']>,
  }));
  if (testRuns.length) {
    const byRun = new Map(testRuns.map((r) => [r.id, r]));
    const results = await rows(client,
      `SELECT r.test_run_id, r.test_key, r.suite, r.name, r.status, r.retries, r.duration_ms
         FROM test_results r JOIN test_runs tr ON tr.id = r.test_run_id
        WHERE tr.team_id = $1 AND tr.day BETWEEN $2::date - 6 AND $3::date`, [teamId, from, to]);
    for (const x of results) byRun.get(x.test_run_id)?.cases.push({ testKey: x.test_key, suite: x.suite, name: x.name, status: x.status, retries: Number(x.retries), durationMs: Number(x.duration_ms) });
  }
  const pipes = await rows(client,
    `SELECT id, external_id, attempt, name, commit_sha, branch, day::text AS day, started_at, finished_at, duration_s, result, url
       FROM pipeline_runs_raw WHERE team_id = $1 AND day BETWEEN $2::date AND $3::date ORDER BY started_at`, [teamId, from, to]);
  const stages = pipes.length ? await rows(client,
    `SELECT s.pipeline_run_id, s.name, s.kind, s.parallel_group, s.started_at, s.finished_at, s.duration_s, s.result
       FROM pipeline_stage_runs s JOIN pipeline_runs_raw p ON p.id = s.pipeline_run_id
      WHERE p.team_id = $1 AND p.day BETWEEN $2::date AND $3::date`, [teamId, from, to]) : [];
  const stagesOf = new Map<string, any[]>();
  for (const st of stages) stagesOf.set(st.pipeline_run_id, [...(stagesOf.get(st.pipeline_run_id) ?? []), st]);
  const pipelines = pipes.map((p) => ({
    id: p.id, externalId: p.external_id, attempt: p.attempt, name: p.name, commit: p.commit_sha, branch: p.branch, day: p.day,
    startedAt: ms(p.started_at)!, finishedAt: ms(p.finished_at), durationS: p.duration_s === null ? null : Number(p.duration_s), result: p.result, url: p.url,
    stages: (stagesOf.get(p.id) ?? []).map((s) => ({
      name: s.name, kind: s.kind, parallelGroup: s.parallel_group, startedAt: ms(s.started_at), finishedAt: ms(s.finished_at),
      durationS: s.duration_s === null ? null : Number(s.duration_s), result: s.result,
    })),
  }));
  return { mainBranch, coverage, testRuns, pipelines };
}

/**
 * Recompute a range of days of a team in one pass and store the evidence in batches (a few queries for any number
 * of days: a year of sample data). The values are those of recomputeTeamDays (the same engine on the same records);
 * no KPI value is written (the sample KPI snapshots are built from this evidence: server/seeds/demoSeed.ts).
 */
export async function recomputeTeamRange(client: pg.PoolClient, teamId: string, days: string[], opts: { groups?: MetricGroup[] } = {}): Promise<DayResult[]> {
  const [team] = await rows(client, 'SELECT company_id FROM teams WHERE id = $1', [teamId]);
  const list = Array.from(new Set(days)).sort();
  if (!team || !list.length) return [];
  const groups: MetricGroup[] = opts.groups ?? ALL_GROUPS;
  const none = new Map<string, ComputedMetric[]>();
  const ci = groups.includes('ci') ? await loadCiRange(client, teamId, list[0], list[list.length - 1]) : null;
  const delivery = groups.includes('delivery') ? await computeDeliveryDays(client, teamId, list) : none;
  const work = groups.includes('work') ? await computeWorkDays(client, teamId, list) : none;
  const quality = groups.includes('quality') ? await computeQualityDays(client, teamId, list) : none;
  const groupKeys = Object.keys(METRICS).filter((k) => groups.includes(groupOf(k)));
  const results: DayResult[] = [];
  const out: unknown[][] = [];
  for (const day of list) {
    const computed = [...(ci ? computeCiDay(day, ci) : []), ...(delivery.get(day) ?? []), ...(work.get(day) ?? []), ...(quality.get(day) ?? [])];
    const res: DayResult = { day, metrics: [] };
    for (const m of computed) {
      const spec = METRICS[m.key];
      const conf = confidenceFor(m.sampleSize);
      out.push([team.company_id, teamId, day, m.key, m.value, spec.unit, spec.formula, JSON.stringify(m.inputs), JSON.stringify(m.sources), m.sampleSize, conf, spec.kpi, m.recordedAt]);
      res.metrics.push({ key: m.key, value: m.value, sampleSize: m.sampleSize, confidence: conf, kpi: spec.kpi, written: false });
    }
    results.push(res);
  }
  const COLS = 13;
  const cast = (c: number) => (c === 2 ? '::date' : c === 7 || c === 8 ? '::jsonb' : c === 12 ? '::timestamptz' : '');
  for (let i = 0; i < out.length; i += 400) {
    const batch = out.slice(i, i + 400);
    const values = batch.map((_, k) => `(${Array.from({ length: COLS }, (__, c) => `$${k * COLS + c + 1}${cast(c)}`).join(', ')}, now())`).join(', ');
    await client.query(
      `INSERT INTO metric_evidence (company_id, team_id, day, metric_key, value, unit, formula, inputs, sources, sample_size, confidence, kpi_column, recorded_at, computed_at)
       VALUES ${values}
       ON CONFLICT (team_id, day, metric_key) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit, formula = EXCLUDED.formula,
         inputs = EXCLUDED.inputs, sources = EXCLUDED.sources, sample_size = EXCLUDED.sample_size, confidence = EXCLUDED.confidence,
         kpi_column = EXCLUDED.kpi_column, recorded_at = EXCLUDED.recorded_at, computed_at = now()`, batch.flat());
  }
  // A metric that has no data any more on a day loses its evidence row.
  await client.query(
    `DELETE FROM metric_evidence WHERE team_id = $1 AND day = ANY($2::date[]) AND metric_key = ANY($3::text[]) AND NOT ((day::text || '|' || metric_key) = ANY($4::text[]))`,
    [teamId, list, groupKeys, out.map((r) => `${r[2]}|${r[3]}`)]);
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

/**
 * Nightly: recompute the last `days` days of every team that has real raw data in that period (one
 * transaction per team). Teams with sample raw data only are left to the sample refresh (demo-refresh:
 * runRefreshDates → addRawSampleData), which adds their new day and its evidence. `budgetMs` stops
 * before a scheduled function's time limit (the rest follows the next night; values are idempotent).
 */
export async function recomputeRecent(days = 8, budgetMs = Number(process.env.CALC_RECOMPUTE_BUDGET_MS) || 25_000): Promise<{ teams: number; values: number; skipped: number }> {
  const started = Date.now();
  const phase3 = await (async () => { const c = await pool.connect(); try { return await phase3Tables(c); } finally { c.release(); } })();
  const teams = (await pool.query(
    `SELECT team_id FROM (
       SELECT team_id FROM test_runs WHERE day >= CURRENT_DATE - $1::int AND NOT is_sample
       UNION SELECT team_id FROM coverage_reports WHERE day >= CURRENT_DATE - $1::int AND NOT is_sample
       UNION SELECT team_id FROM pipeline_runs_raw WHERE day >= CURRENT_DATE - $1::int AND NOT is_sample
       -- Delivery values look back 28 days: a team whose last deploy or incident is that old still changes today.
       UNION SELECT team_id FROM deployments_raw WHERE day >= CURRENT_DATE - $1::int - ${WINDOW_DAYS} AND NOT is_sample
       UNION SELECT team_id FROM incidents_raw WHERE (day >= CURRENT_DATE - $1::int - ${WINDOW_DAYS} OR resolved_at IS NULL) AND NOT is_sample
       ${phase3 ? `-- Work values look back up to 42 days (the latest closed sprint), code quality 30 days (the latest report).
       UNION SELECT team_id FROM issues WHERE (opened_at >= CURRENT_DATE - $1::int - ${SPRINT_STALE_DAYS} OR resolved_at >= CURRENT_DATE - $1::int - ${SPRINT_STALE_DAYS} OR resolved_at IS NULL) AND NOT is_sample
       UNION SELECT team_id FROM issue_sprints WHERE completed_at >= CURRENT_DATE - $1::int - ${SPRINT_STALE_DAYS} AND NOT is_sample
       UNION SELECT team_id FROM analysis_reports WHERE day >= CURRENT_DATE - $1::int - ${REPORT_STALE_DAYS} AND NOT is_sample` : ''}) x
      ORDER BY md5(team_id || CURRENT_DATE::text)` /* a different order every day: no team waits behind the budget twice */, [days])).rows;
  let values = 0;
  let done = 0;
  const list: string[] = [];
  for (let i = days; i >= 0; i--) list.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  for (const { team_id } of teams) {
    if (Date.now() - started > budgetMs) break;
    values += await withTransaction(async (client) => {
      const res = await recomputeTeamDays(client, team_id, list);
      return res.reduce((n, d) => n + d.metrics.filter((m) => m.written).length, 0);
    });
    done++;
  }
  return { teams: done, values, skipped: teams.length - done };
}

export const RAW_RETENTION_DAYS = 396; // 13 months
/** Per-test results, per-file coverage and static-analysis findings: 13 months, like the rest of the raw store. */
export const RAW_DETAIL_DAYS = RAW_RETENTION_DAYS;
/**
 * Days the gzipped payloads are kept: 13 months by default (RAW_PAYLOAD_DAYS may raise it; a value below 396 is
 * ignored, so a stale setting can never delete a payload younger than 13 months). The raw_uploads row itself goes
 * after RAW_RETENTION_DAYS, so in practice payloads are kept 13 months.
 */
export const RAW_PAYLOAD_DAYS = Math.max(RAW_RETENTION_DAYS, Number(process.env.RAW_PAYLOAD_DAYS) || 0);

/**
 * Retention of the raw store (db-keepalive, daily): everything raw is kept 13 months (396 days) so teams keep a
 * year of history: uploads with their gzipped payloads, test runs with their per-test results, coverage reports
 * with their per-file rows, pipeline runs, deployments, commits, incidents with their updates, static-analysis
 * reports with their findings, closed sprints, resolved issues and the evidence. Nothing younger than 396 days is
 * deleted. The latest coverage report of each team and the latest static-analysis report of each repository and
 * tool keep their files / findings. Calculated KPI values (metric_values) and snapshots are never deleted here.
 */
export async function cleanupRawData(): Promise<Record<string, number>> {
  const n = async (sql: string, params: any[] = []) => (await pool.query(`WITH d AS (${sql} RETURNING 1) SELECT COUNT(*)::int AS n FROM d`, params)).rows[0]?.n ?? 0;
  return {
    payloads: await n(`UPDATE raw_uploads SET payload = NULL WHERE payload IS NOT NULL AND received_at < now() - make_interval(days => $1)`, [RAW_PAYLOAD_DAYS]),
    testResults: await n(`DELETE FROM test_results r USING test_runs tr WHERE tr.id = r.test_run_id AND tr.started_at < now() - make_interval(days => $1)`, [RAW_DETAIL_DAYS]),
    coverageFiles: await n(`DELETE FROM coverage_files f USING coverage_reports r WHERE r.id = f.report_id AND r.created_at < now() - make_interval(days => $1)
                              AND r.id <> (SELECT r2.id FROM coverage_reports r2 WHERE r2.team_id = r.team_id ORDER BY r2.created_at DESC LIMIT 1)`, [RAW_DETAIL_DAYS]),
    testRuns: await n(`DELETE FROM test_runs WHERE started_at < now() - make_interval(days => $1)`, [RAW_RETENTION_DAYS]),
    coverageReports: await n(`DELETE FROM coverage_reports WHERE created_at < now() - make_interval(days => $1)`, [RAW_RETENTION_DAYS]),
    pipelineRuns: await n(`DELETE FROM pipeline_runs_raw WHERE started_at < now() - make_interval(days => $1)`, [RAW_RETENTION_DAYS]),
    deployments: await n(`DELETE FROM deployments_raw WHERE finished_at < now() - make_interval(days => $1)`, [RAW_RETENTION_DAYS]),
    deploymentCommits: await n(`DELETE FROM deployment_commits WHERE created_at < now() - make_interval(days => $1)`, [RAW_RETENTION_DAYS]),
    incidents: await n(`DELETE FROM incidents_raw WHERE opened_at < now() - make_interval(days => $1) AND resolved_at IS NOT NULL AND resolved_at < now() - make_interval(days => $1)`, [RAW_RETENTION_DAYS]),
    ...(await (async () => { const c = await pool.connect(); try { return await phase3Tables(c); } finally { c.release(); } })() ? {
    analysisFindings: await n(`DELETE FROM analysis_findings f USING analysis_reports r WHERE r.id = f.report_id AND r.analyzed_at < now() - make_interval(days => $1)
                                 AND r.id <> (SELECT r2.id FROM analysis_reports r2 WHERE r2.team_id = r.team_id AND r2.repo = r.repo AND r2.tool = r.tool ORDER BY r2.analyzed_at DESC LIMIT 1)`, [RAW_DETAIL_DAYS]),
    analysisReports: await n(`DELETE FROM analysis_reports WHERE analyzed_at < now() - make_interval(days => $1)`, [RAW_RETENTION_DAYS]),
    issues: await n(`DELETE FROM issues WHERE resolved_at IS NOT NULL AND resolved_at < now() - make_interval(days => $1)`, [RAW_RETENTION_DAYS]),
    issueSprints: await n(`DELETE FROM issue_sprints WHERE completed_at IS NOT NULL AND completed_at < now() - make_interval(days => $1)`, [RAW_RETENTION_DAYS]),
    } : {}),
    flakyEvidence: await n(`DELETE FROM flaky_test_evidence WHERE last_seen < now() - make_interval(days => $1)`, [RAW_RETENTION_DAYS]),
    metricEvidence: await n(`DELETE FROM metric_evidence WHERE day < CURRENT_DATE - $1::int`, [RAW_RETENTION_DAYS]),
    uploads: await n(`DELETE FROM raw_uploads WHERE received_at < now() - make_interval(days => $1)`, [RAW_RETENTION_DAYS]),
  };
}
