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
 *   escapes    raw issues (v2 phase 3): bugs of the last 28 days, the escaped ones and their components
 *   sprintIssues  the latest closed sprint's most blocked issues and those furthest from their estimate
 *   findings   static-analysis findings of the latest main-branch reports, by rule
 * A team whose values come from a QE Navigator Collector (no raw records here): the same facts from what it
 * sent (collectorFacts): in evidence mode the evidence lists (flaky test names, lowest-coverage files, failing
 * stages, failed deployments, escaped issue keys) with the counts; in metrics mode the counts only (the rules
 * then name no test, file or issue, and say how many).
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
import { pool } from '../../../src/lib/db';
import { confirmedBug, loadWorkData, phase3Tables, summariseSprint, WORK_WINDOW_DAYS } from '../calc/work';
import { latestReports, loadQualityData } from '../calc/quality';

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

  const [flaky, coverage, stages, wellbeing, debt, slow, incidents, deploys, work] = await Promise.all([
    loadFlaky(team.id), loadCoverage(team.id), loadStages(team.id), loadWellbeing(team.id, asOf), loadDebt(team.id), loadSlowTests(team.id),
    loadIncidents(team.id), loadDeploys(team.id), loadWork(team.id),
  ]);
  const facts: TeamFacts = { teamId: team.id, teamName: team.name, asOf, metrics, flaky, coverage, stages, wellbeing, debt, slowTests: slow?.tests ?? null, slowTestsTotalMs: slow?.totalMs ?? null, incidents, deploys, ...work };
  return withCollectorFacts(facts, await loadCollectorRows(team.id));
}

export interface CollectorRows {
  values: Record<string, { day: string; value: number; inputs: Record<string, any>; sources: Record<string, any>; mode: string | null }>;
  evidence: Record<string, any> | null;
}

/** The latest Collector values of the metrics the rules read, and the team's evidence panel (evidence mode). */
export async function loadCollectorRows(teamId: string): Promise<CollectorRows> {
  try {
    const rows = await query<any[]>(
      `SELECT DISTINCT ON (metric_key) metric_key, day, value::float8 AS value, inputs, sources, privacy_mode FROM metric_evidence
        WHERE team_id = ? AND origin = 'collector' AND metric_key = ANY(?::text[]) AND day >= CURRENT_DATE - 30 ORDER BY metric_key, day DESC`,
      [teamId, ['flaky_tests', 'line_coverage', 'change_failure_rate', 'escape_rate', 'findings']]);
    const ev = await queryOne<any>(`SELECT payload FROM collector_evidence WHERE team_id = ? AND as_of >= CURRENT_DATE - 30`, [teamId]);
    return {
      values: Object.fromEntries(rows.map((r: any) => [r.metric_key, { day: dayStr(r.day), value: Number(r.value), inputs: r.inputs ?? {}, sources: r.sources ?? {}, mode: r.privacy_mode }])),
      evidence: ev?.payload ?? null,
    };
  } catch {
    return { values: {}, evidence: null };
  }
}

/** Fill the facts that raw records would give from a Collector's values (graceful in metrics mode: counts only). Pure. */
export function withCollectorFacts(f: TeamFacts, c: CollectorRows): TeamFacts {
  const out = { ...f };
  const v = c.values;
  const list = (x: unknown) => (Array.isArray(x) ? x : []);
  if (!out.flaky && v.flaky_tests) {
    const named = list(c.evidence?.flakyTests).length ? list(c.evidence?.flakyTests) : list(v.flaky_tests.sources.flakyTests);
    const tests = named.map((t: any) => ({ name: String(t.name), suite: t.suite ?? null, failedRuns: Number(t.failedRuns) || 0, passedRuns: Number(t.passedRuns) || 0, lastSeen: t.lastSeen ?? null }));
    out.flaky = {
      source: 'ci', windowDays: 7, tests, flakyCount: Math.round(v.flaky_tests.value), failedRunsTotal: tests.reduce((n, t) => n + t.failedRuns, 0),
      reruns: null, rerunMinutes: null, testsRun: Number(v.flaky_tests.inputs.distinctTests) || null,
    };
  }
  if (!out.coverage && v.line_coverage && Number(v.line_coverage.inputs.linesFound) > 0) {
    const files = list(c.evidence?.lowestFiles).length ? list(c.evidence?.lowestFiles) : list(v.line_coverage.sources.lowestFiles);
    out.coverage = {
      day: v.line_coverage.day, commit: '', linesFound: Number(v.line_coverage.inputs.linesFound), linesHit: Number(v.line_coverage.inputs.linesHit),
      files: files.map((x: any) => ({ path: String(x.path), linesFound: Number(x.linesFound) || 0, linesHit: Number(x.linesHit) || 0 })),
    };
  }
  if (!out.stages && c.evidence && list(c.evidence.failingStages).length) {
    out.stages = { windowDays: 7, stages: [], failing: list(c.evidence.failingStages).map((x: any) => ({ name: String(x.name), runs: Number(x.runs) || 0, failed: Number(x.failed) || 0 })) };
  }
  if (!out.deploys && v.change_failure_rate) {
    const failed = list(v.change_failure_rate.sources.failedDeployments);
    out.deploys = {
      windowDays: 28, production: Number(v.change_failure_rate.inputs.productionDeploys) || 0, failed: Number(v.change_failure_rate.inputs.failedChanges) || 0,
      failedList: failed.slice(0, 3).map((d: any) => ({ id: String(d.deploymentId), service: null, day: String(list(d.reasons)[0]?.at ?? v.change_failure_rate.day).slice(0, 10) })), services: [],
    };
  }
  if (!out.escapes && v.escape_rate) {
    out.escapes = {
      windowDays: 28, bugs: Number(v.escape_rate.inputs.bugsWithEnvironment) || 0, escaped: Number(v.escape_rate.inputs.escapedBugs) || 0,
      list: list(v.escape_rate.sources.escaped).slice(0, 10).map((k: any) => ({ key: String(k), title: null, components: [], opened: v.escape_rate.day })), byComponent: [],
    };
  }
  if (!out.findings && v.findings) {
    out.findings = { reports: Number(v.findings.inputs.reports) || 0, total: Math.round(v.findings.value), critical: Number(v.findings.inputs.critical) || 0, high: Number(v.findings.inputs.high) || 0, rules: [] };
  }
  return out;
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

export const DELIVERY_WINDOW_DAYS = 30;

/** Raw delivery tables (v2 phase 2) may be missing on a database without that migration: no evidence then. */
async function optional<T>(work: () => Promise<T>): Promise<T | null> {
  try { return await work(); } catch (e: any) { if (e?.code === '42P01') return null; throw e; }
}

/** Incidents resolved in the last 30 days: median time to recover and to acknowledge, the longest ones. */
async function loadIncidents(teamId: string): Promise<TeamFacts['incidents']> {
  return optional(async () => {
    const rows = await query<any[]>(
      `SELECT title, service, severity, opened_at, acknowledged_at, resolved_at,
              extract(epoch FROM resolved_at - opened_at)::float8 / 3600 AS hours,
              CASE WHEN acknowledged_at IS NULL THEN NULL ELSE extract(epoch FROM acknowledged_at - opened_at)::float8 / 3600 END AS ack_hours
         FROM incidents_raw WHERE team_id = ? AND resolved_at IS NOT NULL AND resolved_at >= now() - make_interval(days => ?)
        ORDER BY hours DESC`,
      [teamId, DELIVERY_WINDOW_DAYS]
    );
    if (!rows.length) return null;
    const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null; };
    const acks = rows.map((r: any) => r.ack_hours).filter((x: any) => x !== null).map(Number);
    return {
      windowDays: DELIVERY_WINDOW_DAYS, count: rows.length,
      medianHours: med(rows.map((r: any) => Number(r.hours))) as number,
      medianAckHours: med(acks),
      longest: rows.slice(0, 3).map((r: any) => ({ title: r.title ?? 'Untitled incident', service: r.service ?? null, severity: r.severity, hours: Number(r.hours), opened: new Date(r.opened_at).toISOString() })),
    };
  });
}

/** Production deploys of the last 30 days and the failed changes among them (rolled back, or with a linked incident). */
async function loadDeploys(teamId: string): Promise<TeamFacts['deploys']> {
  return optional(async () => {
    const rows = await query<any[]>(
      `WITH d AS (
         SELECT * FROM deployments_raw WHERE team_id = ? AND is_production AND finished_at >= now() - make_interval(days => ?))
       SELECT d.external_id, d.service, d.day, d.result, d.rollback_of,
              (d.result = 'rolled_back'
               OR EXISTS (SELECT 1 FROM deployments_raw r WHERE r.team_id = d.team_id AND r.rollback_of = d.external_id)
               OR EXISTS (SELECT 1 FROM incidents_raw i WHERE i.team_id = d.team_id AND i.deployment_external_id = d.external_id)) AS failed
         FROM d WHERE d.result <> 'failure' AND d.rollback_of IS NULL ORDER BY d.finished_at DESC`,
      [teamId, DELIVERY_WINDOW_DAYS]
    );
    if (!rows.length) return null;
    const failed = rows.filter((r: any) => r.failed);
    const bySvc = new Map<string, { service: string; total: number; failed: number }>();
    for (const r of rows) {
      const k = r.service ?? '(no service)';
      const x = bySvc.get(k) ?? { service: k, total: 0, failed: 0 };
      x.total++; if (r.failed) x.failed++;
      bySvc.set(k, x);
    }
    return {
      windowDays: DELIVERY_WINDOW_DAYS, production: rows.length, failed: failed.length,
      failedList: failed.slice(0, 3).map((r: any) => ({ id: r.external_id, service: r.service ?? null, day: dayStr(r.day) })),
      services: [...bySvc.values()].filter((x) => x.failed > 0).sort((a, b) => b.failed - a.failed || b.total - a.total).slice(0, 3),
    };
  });
}

/** Phase 3 evidence: escaped defects, the latest sprint's blocked and mis-sized issues, static-analysis findings by rule. */
export async function loadWork(teamId: string): Promise<Pick<TeamFacts, 'escapes' | 'sprintIssues' | 'findings'>> {
  const client = await pool.connect();
  try {
    if (!(await phase3Tables(client))) return { escapes: null, sprintIssues: null, findings: null };
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const from = new Date(now - 60 * 86_400_000).toISOString().slice(0, 10);
    const w = await loadWorkData(client, teamId, from, today);
    const wStart = Date.parse(`${today}T00:00:00Z`) - (WORK_WINDOW_DAYS - 1) * 86_400_000;
    const bugs = w.issues.filter((i) => confirmedBug(i) && i.openedAt >= wStart && i.foundIn);
    const escaped = bugs.filter((i) => i.foundIn === 'production').sort((a, b) => b.openedAt - a.openedAt);
    const comp = new Map<string, number>();
    for (const b of escaped) for (const c of b.components) comp.set(c, (comp.get(c) ?? 0) + 1);
    const escapes = bugs.length ? {
      windowDays: WORK_WINDOW_DAYS, bugs: bugs.length, escaped: escaped.length,
      list: escaped.slice(0, 10).map((i) => ({ key: i.key, title: i.title, components: i.components, opened: new Date(i.openedAt).toISOString() })),
      byComponent: Array.from(comp.entries()).map(([component, n]) => ({ component, escaped: n })).sort((a, b) => b.escaped - a.escaped),
    } : null;
    const last = w.sprints.filter((x) => x.completedAt !== null && x.completedAt <= now && x.completedAt >= now - 42 * 86_400_000).sort((a, b) => b.completedAt! - a.completedAt!)[0];
    let sprintIssues: TeamFacts['sprintIssues'] = null;
    if (last) {
      const x = summariseSprint(last, w, now);
      sprintIssues = {
        sprint: last.name ?? last.externalId,
        blocked: x.blocked.slice(0, 5).map((b) => ({ key: b.issue.key, title: b.issue.title, hours: b.hours })),
        sizing: x.sized.map((i) => ({ key: i.key, title: i.title, estimateHours: i.estimate!, loggedHours: i.logged! }))
          .sort((a, b) => Math.abs(Math.log(b.loggedHours / b.estimateHours)) - Math.abs(Math.log(a.loggedHours / a.estimateHours))).slice(0, 5),
      };
    }
    const q = await loadQualityData(client, teamId, from, today);
    const reports = latestReports(q, now);
    let findings: TeamFacts['findings'] = null;
    if (reports.length) {
      const rules = (await client.query(
        `SELECT rule_id, MAX(rule_name) AS name, COUNT(*)::int AS n, (array_agg(path ORDER BY line NULLS LAST))[1:3] AS paths,
                (array_agg(severity ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END))[1] AS severity
           FROM analysis_findings WHERE report_id = ANY($1::text[]) GROUP BY rule_id
          ORDER BY MIN(CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END), COUNT(*) DESC LIMIT 10`, [reports.map((r) => r.id)])).rows;
      findings = {
        reports: reports.length, total: reports.reduce((n, r) => n + r.findings, 0), critical: reports.reduce((n, r) => n + r.critical, 0), high: reports.reduce((n, r) => n + r.high, 0),
        rules: rules.map((r: any) => ({ ruleId: r.rule_id, name: r.name, severity: r.severity, count: r.n, paths: (r.paths ?? []).filter(Boolean) })),
      };
    }
    return { escapes, sprintIssues, findings };
  } finally {
    client.release();
  }
}
