/**
 * Forecasts of a team (table forecasts): loads the team's history, runs server/lib/forecast/math.ts
 * per metric and stores one row per metric (replaced on every run).
 *
 *   KPI columns  observations = the stored values (metric_values, not superseded), the latest
 *                value of each recorded day, last HISTORY_WEEKS weeks.
 *   qa_score     observations = the QA score of each daily snapshot as Team detail charts it
 *                (stale inputs left out: evaluateSnapshot).
 * Targets: the team's target valid on each future day (target history: team → department →
 * company → default); QA score ≥ QA_SCORE_THRESHOLDS.good; sizing accuracy within
 * 1 ± SIZING_ACCURACY_TOLERANCE.good; sprint velocity and automation ROI have no target (projection only).
 */
import { query } from '../../../src/lib/db';
import { judgeInstant, METRICS_CONFIG } from '../../../src/config/metricsConfig';
import { forecastText } from '../../../src/lib/forecastText';
import { SIZING_ACCURACY_TOLERANCE } from '../../../src/data/metricCatalog';
import { KPI_COLUMNS, KPI_COLUMN_NAMES } from '../kpiIngest';
import { QA_SCORE_THRESHOLDS } from '../metricFormulas';
import { evaluateSnapshot, type EvalContext } from '../kpiEvaluation';
import { loadIntervals, referenceFor, referenceForRow } from '../staleness';
import { isTargetMetric, loadTargetBook, TARGET_METRICS, type TargetBook } from '../targets';
import { metricLabel } from '../alerts';
import {
  dayNum, dayStr, forecastSeries, HISTORY_WEEKS, METHOD_TEXT, type ForecastResult, type Obs, type TargetSpec,
} from './math';

export const FORECAST_METRICS = [...KPI_COLUMN_NAMES, 'qa_score'] as const;
export type ForecastMetric = (typeof FORECAST_METRICS)[number];

/** Forecasts older than this are recalculated when read and by the hourly job. */
export const FORECAST_MAX_AGE_HOURS = 20;

export interface TeamRefLite { id: string; company_id: string; department_id: string | null }

export function metricMeta(metric: string): { label: string; unit: string; lowerIsBetter: boolean | null; bounds: { min: number; max: number } } {
  if (metric === 'qa_score') return { label: 'QA score', unit: '/100', lowerIsBetter: false, bounds: { min: 0, max: 100 } };
  const spec = (KPI_COLUMNS as Record<string, { label: string; unit?: string; min: number; max: number }>)[metric];
  const lowerIsBetter = isTargetMetric(metric) ? METRICS_CONFIG[TARGET_METRICS[metric]].lowerIsBetter : null;
  return { label: spec?.label ?? metricLabel(metric), unit: spec?.unit ?? '', lowerIsBetter, bounds: { min: spec?.min ?? 0, max: spec?.max ?? 1e9 } };
}

/** The target of a metric on a day for a team (null when the metric has none). */
export function targetFor(book: TargetBook, team: TeamRefLite, metric: string): ((day: string) => TargetSpec | null) | undefined {
  if (metric === 'qa_score') return () => ({ kind: 'min', good: QA_SCORE_THRESHOLDS.good, warning: QA_SCORE_THRESHOLDS.warning });
  if (metric === 'sizing_accuracy') return () => ({ kind: 'band', low: 1 - SIZING_ACCURACY_TOLERANCE.good, high: 1 + SIZING_ACCURACY_TOLERANCE.good });
  if (!isTargetMetric(metric)) return undefined;
  return (day: string) => {
    const t = book.at({ id: team.id, department_id: team.department_id }, team.company_id, metric, judgeInstant(day));
    return { kind: t.lowerIsBetter ? 'max' : 'min', good: Number(t.good), warning: Number(t.warning) };
  };
}

export interface ForecastJson {
  metric: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean | null;
  status: 'ok' | 'insufficient';
  reason: string | null;
  asOf: string;
  pointsUsed: number;
  historyFrom: string | null;
  historyTo: string | null;
  lastValue: number | null;
  lastDay: string | null;
  slopePerWeek: number | null;
  sigma: number | null;
  trend: 'improving' | 'worsening' | 'flat' | null;
  projection: Array<{ day: string; value: number; low: number; high: number }>;
  outlook: 'on_track' | 'will_miss' | 'will_reach' | 'stays_off' | 'no_target' | null;
  crossing: { day: string; earliest: string; latest: string | null } | null;
  targetNow: TargetSpec | null;
  targetAtEnd: TargetSpec | null;
  confidence: 'high' | 'medium' | 'low' | null;
  computedAt: string;
  text: string;
}

const ds = (v: any) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const n = (v: any) => (v === null || v === undefined ? null : Number(v));

export function forecastRowJson(r: any): ForecastJson {
  const meta = metricMeta(r.metric_key);
  const crossing = r.crossing_day ? { day: ds(r.crossing_day)!, earliest: ds(r.crossing_earliest) ?? ds(r.crossing_day)!, latest: ds(r.crossing_latest) } : null;
  const json: Omit<ForecastJson, 'text'> = {
    metric: r.metric_key, label: meta.label, unit: meta.unit, lowerIsBetter: meta.lowerIsBetter,
    status: r.status, reason: r.reason ?? null, asOf: ds(r.as_of)!, pointsUsed: Number(r.points_used) || 0,
    historyFrom: ds(r.history_from), historyTo: ds(r.history_to), lastValue: n(r.last_value), lastDay: ds(r.last_day),
    slopePerWeek: n(r.slope_per_week), sigma: n(r.sigma), trend: r.trend ?? null,
    projection: Array.isArray(r.projection) ? r.projection : [], outlook: r.outlook ?? null, crossing,
    targetNow: r.target_now ?? null, targetAtEnd: r.target_at_end ?? null, confidence: r.confidence ?? null,
    computedAt: new Date(r.computed_at).toISOString(),
  };
  return { ...json, text: forecastText(json) };
}

/** Observations per metric for a team: KPI columns from metric_values, qa_score from the snapshots. */
export async function loadObservations(team: TeamRefLite, asOf: string, ctx?: EvalContext): Promise<Map<string, Obs[]>> {
  const from = dayStr(dayNum(asOf) - HISTORY_WEEKS * 7 + 1);
  const rows = await query<any[]>(
    `SELECT DISTINCT ON (metric_key, (recorded_at AT TIME ZONE 'UTC')::date)
            metric_key, to_char((recorded_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day, value::float8 AS value
       FROM metric_values
      WHERE team_id = ? AND superseded_by IS NULL
        AND recorded_at >= ?::date AND recorded_at < (?::date + 1)
      ORDER BY metric_key, (recorded_at AT TIME ZONE 'UTC')::date, recorded_at DESC, received_at DESC`,
    [team.id, from, asOf]
  );
  const out = new Map<string, Obs[]>();
  for (const r of rows) {
    const list = out.get(r.metric_key) ?? [];
    list.push({ day: r.day, value: Number(r.value) });
    out.set(r.metric_key, list);
  }
  const snaps = await query<any[]>(
    `SELECT *, to_char(snapshot_date, 'YYYY-MM-DD') AS snapshot_day FROM kpi_snapshots
      WHERE team_id = ? AND snapshot_date >= ?::date AND snapshot_date <= ?::date ORDER BY snapshot_date`,
    [team.id, from, asOf]
  );
  if (snaps.length) {
    const c = ctx ?? { companyId: team.company_id, intervals: await loadIntervals(team.company_id), book: await loadTargetBook(team.company_id) };
    const now = Date.now();
    const qa: Obs[] = [];
    for (const s of snaps) {
      const ev = evaluateSnapshot(s, { id: team.id, department_id: team.department_id }, c, referenceForRow(s, s.snapshot_day, now));
      if (ev.qa.value !== null) qa.push({ day: s.snapshot_day, value: ev.qa.value });
    }
    if (qa.length) out.set('qa_score', qa);
  }
  return out;
}

export function forecastTeamFromObservations(team: TeamRefLite, obs: Map<string, Obs[]>, book: TargetBook, asOf: string): Array<{ metric: string; result: ForecastResult }> {
  const out: Array<{ metric: string; result: ForecastResult }> = [];
  for (const metric of FORECAST_METRICS) {
    const series = obs.get(metric);
    if (!series?.length) continue;
    const meta = metricMeta(metric);
    out.push({ metric, result: forecastSeries({ observations: series, asOf, lowerIsBetter: meta.lowerIsBetter, bounds: meta.bounds, targetOn: targetFor(book, team, metric) }) });
  }
  return out;
}

/** Recalculate and store the forecasts of one team. Returns the stored rows. */
export async function refreshTeamForecasts(team: TeamRefLite, opts: { asOf?: string; book?: TargetBook; ctx?: EvalContext } = {}): Promise<ForecastJson[]> {
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const book = opts.book ?? opts.ctx?.book ?? await loadTargetBook(team.company_id);
  const ctx = opts.ctx ?? { companyId: team.company_id, intervals: await loadIntervals(team.company_id), book };
  const obs = await loadObservations(team, asOf, ctx);
  const results = forecastTeamFromObservations(team, obs, book, asOf);
  const keep = results.map((r) => r.metric);
  await query(`DELETE FROM forecasts WHERE team_id = ? AND NOT (metric_key = ANY(?::text[]))`, [team.id, keep]);
  for (const { metric, result: f } of results) {
    const ok = f.status === 'ok' ? f : null;
    await query(
      `INSERT INTO forecasts (company_id, team_id, metric_key, status, reason, method, as_of, points_used, history_from, history_to, last_value, last_day,
                              slope_per_week, sigma, trend, projection, outlook, crossing_day, crossing_earliest, crossing_latest, target_now, target_at_end, confidence, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?::date, ?, ?::date, ?::date, ?, ?::date, ?, ?, ?, ?::jsonb, ?, ?::date, ?::date, ?::date, ?::jsonb, ?::jsonb, ?, now())
       ON CONFLICT (team_id, metric_key) DO UPDATE SET
         company_id = EXCLUDED.company_id, status = EXCLUDED.status, reason = EXCLUDED.reason, method = EXCLUDED.method, as_of = EXCLUDED.as_of,
         points_used = EXCLUDED.points_used, history_from = EXCLUDED.history_from, history_to = EXCLUDED.history_to, last_value = EXCLUDED.last_value,
         last_day = EXCLUDED.last_day, slope_per_week = EXCLUDED.slope_per_week, sigma = EXCLUDED.sigma, trend = EXCLUDED.trend, projection = EXCLUDED.projection,
         outlook = EXCLUDED.outlook, crossing_day = EXCLUDED.crossing_day, crossing_earliest = EXCLUDED.crossing_earliest, crossing_latest = EXCLUDED.crossing_latest,
         target_now = EXCLUDED.target_now, target_at_end = EXCLUDED.target_at_end, confidence = EXCLUDED.confidence, computed_at = now()`,
      [team.company_id, team.id, metric, f.status, f.status === 'insufficient' ? f.reason : null, METHOD_TEXT, asOf, f.pointsUsed, f.historyFrom, f.historyTo,
        f.lastValue, f.lastDay, ok?.slopePerWeek ?? null, ok?.sigma ?? null, ok?.trend ?? null, JSON.stringify(ok?.projection ?? []), ok?.outlook ?? null,
        ok?.crossing?.day ?? null, ok?.crossing?.earliest ?? null, ok?.crossing?.latest ?? null,
        ok?.targetNow ? JSON.stringify(ok.targetNow) : null, ok?.targetAtEnd ? JSON.stringify(ok.targetAtEnd) : null, ok?.confidence ?? null]
    );
  }
  return loadTeamForecasts(team.id);
}

export async function loadTeamForecasts(teamId: string): Promise<ForecastJson[]> {
  const rows = await query<any[]>(`SELECT * FROM forecasts WHERE team_id = ?`, [teamId]);
  const order = new Map<string, number>(FORECAST_METRICS.map((m, i) => [m, i]));
  return rows.map(forecastRowJson).sort((a, b) => (order.get(a.metric) ?? 99) - (order.get(b.metric) ?? 99));
}

export async function loadForecastsForTeams(teamIds: string[]): Promise<Map<string, ForecastJson[]>> {
  const out = new Map<string, ForecastJson[]>();
  if (!teamIds.length) return out;
  const rows = await query<any[]>(`SELECT * FROM forecasts WHERE team_id = ANY(?::text[])`, [teamIds]);
  for (const r of rows) {
    const list = out.get(String(r.team_id)) ?? [];
    list.push(forecastRowJson(r));
    out.set(String(r.team_id), list);
  }
  return out;
}
