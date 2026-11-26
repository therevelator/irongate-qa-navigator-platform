/**
 * Staleness: a metric value is stale when (reference time − its recorded_at) is longer than
 * the metric's expected update interval (Administration → Update frequency;
 * metric_update_intervals per company, else DEFAULT_METRIC_INTERVALS).
 *
 * recorded_at is the time the value is FOR (field_sources.<column>.recorded_at, kept in step
 * with metric_values by the write path); for older snapshots without provenance, the snapshot
 * day (00:00 UTC) is the latest time the value is known to be from.
 *
 * The reference time is now for current values, and the end of the day for a past snapshot day
 * (what was current on that day). Stale values are still shown (greyed, "stale since"), but
 * composites (QA score, KPI targets, company aggregates) leave them out.
 */
import { loadSchedules, type DataGroup, type TeamSchedule } from './collectionSchedule';
import { METRICS } from '../../packages/engine/src/calc/metrics';
import { query } from '../../src/lib/db';
import { DEFAULT_METRIC_INTERVALS } from './metricIntervals';

export const INTERVAL_UNIT_MS: Record<string, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 7 * 86_400_000,
  months: 30 * 86_400_000,
};

export const STALENESS_RULE_TEXT =
  'A value is stale when it is older than the metric’s expected update interval (Administration → Update frequency). ' +
  'Stale values are shown greyed with the time they became stale and are left out of composite scores.';

export type IntervalMap = Record<string, number>;

export function defaultIntervals(): IntervalMap {
  const out: IntervalMap = {};
  for (const d of DEFAULT_METRIC_INTERVALS) out[d.metric_key] = d.interval_value * (INTERVAL_UNIT_MS[d.interval_unit] ?? 0);
  return out;
}

/** Expected interval (ms) per metric for a company: saved values over the defaults. */
export async function loadIntervals(companyId: string): Promise<IntervalMap> {
  const out = defaultIntervals();
  const rows = await query<any>(
    'SELECT metric_key, interval_value, interval_unit FROM metric_update_intervals WHERE company_id = ?',
    [companyId]
  );
  for (const r of rows) {
    const ms = Number(r.interval_value) * (INTERVAL_UNIT_MS[r.interval_unit] ?? 0);
    if (Number.isFinite(ms) && ms > 0) out[r.metric_key] = ms;
  }
  // The teams' collection schedules travel with the map (not enumerable: the map stays metric → ms for everyone else).
  const schedules = await loadSchedules(companyId).catch(() => new Map<string, Partial<TeamSchedule>>());
  if (schedules.size) Object.defineProperty(out, TEAM_SCHEDULES, { value: schedules, enumerable: false });
  return out;
}

const TEAM_SCHEDULES = Symbol('teamSchedules');
/** Collection may run late by this factor of its interval before a value counts as stale. */
export const COLLECTION_GRACE = 2;
const GROUP_OF_COLUMN: Record<string, DataGroup> = Object.fromEntries(
  Object.values(METRICS).filter((m) => m.kpi).map((m) => [m.kpi as string, (m.group ?? 'ci') as DataGroup])); // the CI metrics carry no group: it is the default

/**
 * The expected intervals for one team: the company's, except that a metric whose data the team chose to collect
 * less often (collection_schedules) is expected no sooner than COLLECTION_GRACE × that interval. A team that reads
 * its pipelines once a day is not shown as stale an hour after the last run.
 */
export function intervalsForTeam(intervals: IntervalMap, teamId: string | null | undefined): IntervalMap {
  const schedules = (intervals as any)[TEAM_SCHEDULES] as Map<string, Partial<TeamSchedule>> | undefined;
  const mine = teamId ? schedules?.get(String(teamId)) : undefined;
  if (!mine) return intervals;
  const out: IntervalMap = { ...intervals };
  for (const [column, group] of Object.entries(GROUP_OF_COLUMN)) {
    const minutes = mine[group];
    if (minutes && out[column] !== undefined) out[column] = Math.max(out[column], minutes * 60_000 * COLLECTION_GRACE);
  }
  return out;
}

/** Reference time for a snapshot day: the end of that UTC day, never later than now. */
export function referenceFor(day: string | null | undefined, now = Date.now()): number {
  if (!day) return now;
  const end = Date.parse(`${String(day).slice(0, 10)}T00:00:00Z`) + 86_400_000;
  return Number.isFinite(end) ? Math.min(end, now) : now;
}

/**
 * Reference time for evaluating a snapshot row of `day`: referenceFor(day), except that a row holding generated
 * sample data is never measured later than the start of today (UTC). Sample records exist for complete days only
 * (the nightly refresh adds yesterday), so today's sample snapshot carries yesterday evening's values; measured at
 * now they would pass a 24-hour interval in the evening, hours before the next refresh.
 */
export function referenceForRow(row: Record<string, any> | null | undefined, day: string | null | undefined, now = Date.now()): number {
  const r = referenceFor(day, now);
  return row && hasSampleData(row.field_sources) ? Math.min(r, Math.max(Math.floor(now / 86_400_000) * 86_400_000, day ? Date.parse(`${String(day).slice(0, 10)}T00:00:00Z`) || 0 : 0)) : r;
}

export interface ValueInfo {
  /** ISO time the value is for (field_sources recorded_at, else the snapshot day). */
  recordedAt: string | null;
  source: string | null;
  stale: boolean;
  /** When the value became stale (recordedAt + interval), when it is stale. */
  staleSince: string | null;
  /** Expected update interval in ms, when one is configured. */
  intervalMs: number | null;
}

const dayStart = (day: string) => `${String(day).slice(0, 10)}T00:00:00.000Z`;

/** recorded_at of one column of a snapshot (provenance, else the snapshot day). */
export function recordedAtOf(fieldSources: any, column: string, snapshotDate: string | null | undefined): string | null {
  const fs = fieldSources && typeof fieldSources === 'object' ? fieldSources[column] : null;
  const t = fs && typeof fs.recorded_at === 'string' ? Date.parse(fs.recorded_at) : NaN;
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return snapshotDate ? dayStart(snapshotDate) : null;
}

/**
 * Per-column value info of a snapshot row (only columns that hold a value).
 * `reference` defaults to the row's own day (history) — pass Date.now() for current values.
 */
export function valueInfo(row: Record<string, any>, columns: readonly string[], intervals: IntervalMap, reference: number): Record<string, ValueInfo> {
  const out: Record<string, ValueInfo> = {};
  const snapshotDate = row.snapshot_date ? String(row.snapshot_date).slice(0, 10) : null;
  for (const c of columns) {
    if (row[c] === null || row[c] === undefined) continue;
    const recordedAt = recordedAtOf(row.field_sources, c, snapshotDate);
    const intervalMs = intervals[c] ?? null;
    const t = recordedAt ? Date.parse(recordedAt) : NaN;
    const stale = intervalMs !== null && Number.isFinite(t) && reference - t > intervalMs;
    const fs = row.field_sources && typeof row.field_sources === 'object' ? row.field_sources[c] : null;
    out[c] = {
      recordedAt,
      source: fs && typeof fs.source === 'string' ? fs.source : null,
      stale,
      staleSince: stale ? new Date(t + (intervalMs as number)).toISOString() : null,
      intervalMs,
    };
  }
  return out;
}

/** Columns of the row whose value is stale at `reference`. */
export function staleColumns(row: Record<string, any>, columns: readonly string[], intervals: IntervalMap, reference: number): Set<string> {
  const info = valueInfo(row, columns, intervals, reference);
  return new Set(Object.entries(info).filter(([, v]) => v.stale).map(([k]) => k));
}

/** Any value of the snapshot from generated sample data (field_sources source 'synthetic'). */
export function hasSampleData(fieldSources: any): boolean {
  if (!fieldSources || typeof fieldSources !== 'object') return false;
  return Object.values(fieldSources).some((s: any) => s && s.source === 'synthetic');
}
