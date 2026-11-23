import type { Tone } from '../components/ui';

/** One point of GET /api/teams/:id/kpi-history (and /api/tv/teams/:id history). */
export type HistoryPoint = { date: string; value: number };

export interface KpiChange {
  delta: number;
  /** relative change in %, null when the previous value is 0 */
  pct: number | null;
  direction: 'up' | 'down' | 'flat';
  /** good = moved the right way for the metric's polarity; neutral without a direction */
  tone: Tone;
  prevDate: string;
}

/**
 * Change between the last two snapshots of a metric (Team detail and TV mode).
 * The tone respects the metric's polarity (lowerIsBetter); metrics without a target
 * direction (hasDirection false) are always neutral.
 */
export const describeChange = (history: HistoryPoint[], lowerIsBetter: boolean, hasDirection: boolean): KpiChange | null => {
  if (history.length < 2) return null;
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const delta = last.value - prev.value;
  const direction: 'up' | 'down' | 'flat' = Math.abs(delta) < 1e-9 ? 'flat' : delta > 0 ? 'up' : 'down';
  const improved = direction === 'flat' ? null : lowerIsBetter ? direction === 'down' : direction === 'up';
  const tone: Tone = !hasDirection || improved === null ? 'neutral' : improved ? 'good' : 'bad';
  const pct = prev.value !== 0 ? (delta / Math.abs(prev.value)) * 100 : null;
  return { delta, pct, direction, tone, prevDate: prev.date };
};

/**
 * The points a value's change is described on: the history up to the day the value is for (its recorded_at), so
 * a value carried forward into a later snapshot (no new data since) is compared with the value before it, not with
 * its own copy ("no change vs yesterday" every morning). Without a recorded_at, the whole history.
 */
export const historyToValueDay = (history: HistoryPoint[], recordedAt?: string | null): HistoryPoint[] => {
  const day = typeof recordedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(recordedAt) ? recordedAt.slice(0, 10) : null;
  if (!day) return history;
  const upTo = history.filter((p) => String(p.date).slice(0, 10) <= day);
  return upTo.length >= 2 ? upTo : history;
};

/**
 * Change of a metric over a period: the latest snapshot against the latest snapshot dated at least
 * `days` days before it (e.g. "+4 pts vs 30 days ago"). Null when the history does not reach back
 * that far. Same polarity rules as describeChange.
 */
export const changeOverDays = (history: HistoryPoint[], days: number, lowerIsBetter: boolean, hasDirection: boolean): KpiChange | null => {
  if (history.length < 2) return null;
  const last = history[history.length - 1];
  const cutoff = Date.parse(`${String(last.date).slice(0, 10)}T00:00:00Z`) - days * 86_400_000;
  let prev: HistoryPoint | null = null;
  for (const p of history) {
    if (Date.parse(`${String(p.date).slice(0, 10)}T00:00:00Z`) <= cutoff) prev = p;
  }
  if (!prev) return null;
  return describeChange([prev, last], lowerIsBetter, hasDirection);
};

/** The points of the last `days` days of a history (for 30 / 90 day sparklines). */
export const lastDays = (history: HistoryPoint[], days: number): HistoryPoint[] => {
  if (!history.length) return [];
  const last = Date.parse(`${String(history[history.length - 1].date).slice(0, 10)}T00:00:00Z`);
  return history.filter((p) => Date.parse(`${String(p.date).slice(0, 10)}T00:00:00Z`) >= last - days * 86_400_000);
};
