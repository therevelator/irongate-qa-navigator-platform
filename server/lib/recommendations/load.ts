/**
 * Facts of a team for the recommendations rules (server/lib/recommendations/rules.ts), from the
 * stored data only:
 *   metrics    latest value, target valid now, weekly medians of 26 weeks (metric_values; QA score
 *              from the snapshots) and the stored forecast (forecasts)
 *   flaky      raw CI data (flaky_test_evidence, test_runs re-runs, test_results) of the last 14
 *              days; else the tracked flaky tests (flaky_tests, not quarantined)
 *   coverage   the latest coverage report on the main branch with its per-file lines (coverage_files)
 *   stages     median duration per pipeline stage, last 7 days vs the 7 before; stages failing in 30 days
 *   wellbeing  the team's latest closed pulse period (k-anonymous, as Team detail shows it)
 *   debt       open technical-debt items (technical_debt), highest cost of delay first
 */
import { query, queryOne } from '../../../src/lib/db';
import { judgeInstant } from '../../../src/config/metricsConfig';
import { weeklyPoints, type Obs } from '../forecast/math';
import { FORECAST_METRICS, loadObservations, metricMeta, type ForecastJson, type TeamRefLite } from '../forecast/store';
import { isTargetMetric, type TargetBook } from '../targets';
import { QA_SCORE_THRESHOLDS } from '../metricFormulas';
import { addDays, loadCadences, previousPeriod, wellbeingAcrossTeams } from '../pulse';
import type { EvalContext } from '../kpiEvaluation';
import type { MetricFacts, TeamFacts } from './rules';

export const FLAKY_WINDOW_DAYS = 14;
export const STAGE_WINDOW_DAYS = 7;

const dayStr = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

export function metricFacts(metric: string, obs: Obs[] | undefined, forecast: ForecastJson | undefined, target: { good: number; warning: number } | null, asOf: string): MetricFacts {
  const meta = metricMeta(metric);
  const sorted = [...(obs ?? [])].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const last = sorted[sorted.length - 1] ?? null;
  const end = forecast?.projection?.[forecast.projection.length - 1];
  return {
    key: metric, label: meta.label, unit: meta.unit, lowerIsBetter: meta.lowerIsBetter,
    current: last ? last.value : null, currentDay: last ? last.day : null,
    target,
    weekly: weeklyPoints(sorted, asOf),
    forecast: forecast ? {
      status: forecast.status, trend: forecast.trend, outlook: forecast.outlook, crossingDay: forecast.crossing?.day ?? null,
      slopePerWeek: forecast.slopePerWeek, endValue: end?.value ?? null, endDay: end?.day ?? null, confidence: forecast.confidence,
    } : null,
  };
}

export async function loadTeamFacts(team: TeamRefLite & { name: string }, forecasts: ForecastJson[], book: TargetBook, ctx: EvalContext, asOf = new Date().toISOString().slice(0, 10)): Promise<TeamFacts> {
  const obs = await loadObservations(team, asOf, ctx);
  const fcOf = new Map(forecasts.map((f) => [f.metric, f]));
  const metrics: TeamFacts['metrics'] = {};
  for (const metric of FORECAST_METRICS) {
    if (!obs.get(metric)?.length) continue;
    let target: { good: number; warning: number } | null = null;
    if (metric === 'qa_score') target = { good: QA_SCORE_THRESHOLDS.good, warning: QA_SCORE_THRESHOLDS.warning };
    else if (isTargetMetric(metric)) {
      const t = book.at({ id: team.id, department_id: team.department_id }, team.company_id, metric, judgeInstant(asOf));
      target = { good: Number(t.good), warning: Number(t.warning) };
    }
    metrics[metric] = metricFacts(metric, obs.get(metric), fcOf.get(metric), target, asOf);
  }

  const [flaky, coverage, stages, wellbeing, debt, slow] = await Promise.all([
    loadFlaky(team.id), loadCoverage(team.id), loadStages(team.id), loadWellbeing(team.id, asOf), loadDebt(team.id), loadSlowTests(team.id),
  ]);
  return { teamId: team.id, teamName: team.name, asOf, metrics, flaky, coverage, stages, wellbeing, debt, slowTests: slow?.tests ?? null, slowTestsTotalMs: slow?.totalMs ?? null };
}

async function loadFlaky(teamId: string): Promise<TeamFacts['flaky']> {
  const rows = await query<any[]>(
    `SELECT test_key, max(suite) AS suite, max(name) AS name, max(last_seen) AS last_seen,
            count(DISTINCT f) AS fr, count(DISTINCT p) AS pr
       FROM flaky_test_evidence e
       LEFT JOIN LATERAL unnest(e.failed_run_ids) AS f ON TRUE
       LEFT JOIN LATERAL unnest(e.passed_run_ids) AS p ON TRUE
      WHERE e.team_id = ? AND e.last_seen >= now() - make_interval(days => ?)
      GROUP BY test_key ORDER BY count(DISTINCT f) DESC, max(last_seen) DESC`,
    [teamId, FLAKY_WINDOW_DAYS]
  );
  if (rows.length) {
    const reruns = await queryOne<any>(
      `SELECT count(*)::int AS n, COALESCE(sum(duration_ms), 0)::float8 AS ms FROM test_runs
        WHERE team_id = ? AND attempt > 1 AND day >= CURRENT_DATE - CAST(? AS INTEGER)`,
      [teamId, FLAKY_WINDOW_DAYS - 1]
    );
    const run = await queryOne<any>(
      `SELECT count(DISTINCT r.test_key)::int AS n FROM test_results r JOIN test_runs tr ON tr.id = r.test_run_id
        WHERE tr.team_id = ? AND tr.day >= CURRENT_DATE - CAST(? AS INTEGER)`,
      [teamId, FLAKY_WINDOW_DAYS - 1]
    );
    return {
      source: 'ci', windowDays: FLAKY_WINDOW_DAYS,
      tests: rows.map((r: any) => ({ name: r.name, suite: r.suite ?? null, failedRuns: Number(r.fr), passedRuns: Number(r.pr), lastSeen: r.last_seen ? new Date(r.last_seen).toISOString() : null })),
      flakyCount: rows.length,
      failedRunsTotal: rows.reduce((s: number, r: any) => s + Number(r.fr), 0),
      reruns: reruns ? Number(reruns.n) : null,
      rerunMinutes: reruns ? Math.round(Number(reruns.ms) / 60000) : null,
      testsRun: run ? Number(run.n) || null : null,
    };
  }
  const tracked = await query<any[]>(
    `SELECT test_name, failure_count, pass_count, total_runs, last_flaky_at FROM flaky_tests
      WHERE team_id = ? AND NOT COALESCE(is_quarantined, FALSE) AND COALESCE(failure_count, 0) > 0
        AND (last_flaky_at IS NULL OR last_flaky_at >= now() - interval '60 days')
      ORDER BY flakiness_score DESC NULLS LAST, failure_count DESC LIMIT 20`,
    [teamId]
  );
  if (!tracked.length) return null;
  return {
    source: 'tracked', windowDays: FLAKY_WINDOW_DAYS,
    tests: tracked.map((r: any) => ({ name: r.test_name ?? 'Unnamed test', suite: null, failedRuns: Number(r.failure_count) || 0, passedRuns: Number(r.pass_count) || Math.max(0, (Number(r.total_runs) || 0) - (Number(r.failure_count) || 0)), lastSeen: r.last_flaky_at ? new Date(r.last_flaky_at).toISOString() : null })),
    flakyCount: tracked.length,
    failedRunsTotal: tracked.reduce((s: number, r: any) => s + (Number(r.failure_count) || 0), 0),
    reruns: null, rerunMinutes: null, testsRun: null,
  };
}

async function loadCoverage(teamId: string): Promise<TeamFacts['coverage']> {
  const report = await queryOne<any>(
    `SELECT r.id, r.commit_sha, r.day, r.lines_found, r.lines_hit
       FROM coverage_reports r JOIN teams t ON t.id = r.team_id
      WHERE r.team_id = ? AND r.day >= CURRENT_DATE - 30
      ORDER BY (r.branch IS NULL OR r.branch = '' OR (t.main_branch IS NULL AND r.branch IN ('main', 'master')) OR r.branch = t.main_branch) DESC, r.created_at DESC LIMIT 1`,
    [teamId]
  );
  if (!report || !Number(report.lines_found)) return null;
  const files = await query<any[]>(
    `SELECT path, lines_found, lines_hit FROM coverage_files WHERE report_id = ? AND lines_found > 0
      ORDER BY (lines_found - lines_hit) DESC LIMIT 200`,
    [report.id]
  );
  return {
    day: dayStr(report.day), commit: report.commit_sha ?? '', linesFound: Number(report.lines_found), linesHit: Number(report.lines_hit),
    files: files.map((f: any) => ({ path: f.path, linesFound: Number(f.lines_found), linesHit: Number(f.lines_hit) })),
  };
}

async function loadStages(teamId: string): Promise<TeamFacts['stages']> {
  const rows = await query<any[]>(
    `SELECT s.name,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY s.duration_s) FILTER (WHERE p.day >= CURRENT_DATE - CAST(? AS INTEGER))::float8 AS recent,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY s.duration_s) FILTER (WHERE p.day < CURRENT_DATE - CAST(? AS INTEGER))::float8 AS earlier,
            count(*) FILTER (WHERE p.day >= CURRENT_DATE - CAST(? AS INTEGER))::int AS recent_runs,
            count(*) FILTER (WHERE p.day < CURRENT_DATE - CAST(? AS INTEGER))::int AS earlier_runs
       FROM pipeline_stage_runs s JOIN pipeline_runs_raw p ON p.id = s.pipeline_run_id
      WHERE p.team_id = ? AND p.day >= CURRENT_DATE - CAST(? AS INTEGER) AND s.duration_s IS NOT NULL AND s.result <> 'skipped'
      GROUP BY s.name`,
    [STAGE_WINDOW_DAYS - 1, STAGE_WINDOW_DAYS - 1, STAGE_WINDOW_DAYS - 1, STAGE_WINDOW_DAYS - 1, teamId, 2 * STAGE_WINDOW_DAYS - 1]
  );
  const failing = await query<any[]>(
    `SELECT s.name, count(*)::int AS runs, count(*) FILTER (WHERE s.result = 'failed')::int AS failed
       FROM pipeline_stage_runs s JOIN pipeline_runs_raw p ON p.id = s.pipeline_run_id
      WHERE p.team_id = ? AND p.day >= CURRENT_DATE - 29 AND s.result <> 'skipped'
      GROUP BY s.name HAVING count(*) FILTER (WHERE s.result = 'failed') > 0`,
    [teamId]
  );
  if (!rows.length && !failing.length) return null;
  return {
    windowDays: STAGE_WINDOW_DAYS,
    stages: rows.map((r: any) => ({ name: r.name, recentMedianS: r.recent === null ? null : Number(r.recent), earlierMedianS: r.earlier === null ? null : Number(r.earlier), recentRuns: Number(r.recent_runs), earlierRuns: Number(r.earlier_runs) })),
    failing: failing.map((r: any) => ({ name: r.name, runs: Number(r.runs), failed: Number(r.failed) })),
  };
}

async function loadWellbeing(teamId: string, asOf: string): Promise<TeamFacts['wellbeing']> {
  const w = await wellbeingAcrossTeams([teamId], asOf);
  if (w.value === null || !w.teamsReporting) return null;
  const period = previousPeriod((await loadCadences([teamId])).get(teamId) ?? [], asOf);
  return { value: w.value, responses: w.responses, periodEnd: addDays(period.end, -1) };
}

async function loadDebt(teamId: string): Promise<TeamFacts['debt']> {
  const rows = await query<any[]>(
    `SELECT title, severity, category, cost_of_delay, effort_hours, file_path FROM technical_debt
      WHERE team_id = ? AND status IN ('open', 'in_progress')
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, cost_of_delay DESC NULLS LAST LIMIT 10`,
    [teamId]
  );
  return rows.map((r: any) => ({ title: r.title, severity: r.severity, category: r.category, costOfDelay: r.cost_of_delay === null ? null : Number(r.cost_of_delay), effortHours: r.effort_hours === null ? null : Number(r.effort_hours), filePath: r.file_path ?? null }));
}

async function loadSlowTests(teamId: string): Promise<{ tests: NonNullable<TeamFacts['slowTests']>; totalMs: number | null } | null> {
  const rows = await query<any[]>(
    `SELECT r.test_key, max(r.suite) AS suite, max(r.name) AS name, count(*)::int AS runs,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY r.duration_ms)::float8 AS median_ms
       FROM test_results r JOIN test_runs tr ON tr.id = r.test_run_id
      WHERE tr.team_id = ? AND tr.day >= CURRENT_DATE - 6 AND r.status <> 'skipped'
      GROUP BY r.test_key HAVING count(*) >= 3 ORDER BY median_ms DESC LIMIT 5`,
    [teamId]
  );
  if (!rows.length) return null;
  const total = await queryOne<any>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY tests_duration_ms)::float8 AS ms FROM test_runs
      WHERE team_id = ? AND day >= CURRENT_DATE - 6 AND tests_duration_ms > 0`,
    [teamId]
  );
  return {
    tests: rows.map((r: any) => ({ name: r.name, suite: r.suite ?? null, medianMs: Math.round(Number(r.median_ms)), runs: Number(r.runs) })),
    totalMs: total?.ms ? Number(total.ms) : null,
  };
}
