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
