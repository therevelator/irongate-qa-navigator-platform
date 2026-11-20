/**
 * Wording of a forecast (server/lib/forecast): one line for the KPI tiles of Team detail, the
 * executive summary's risks and the TV mode, so every place says the same thing.
 *
 *   will_miss    Misses target ≥ 80% around 18 Dec
 *   will_reach   Reaches target ≥ 80% around 3 Jan
 *   on_track     On track: stays ≥ 80% (about 86% by 15 Jan)
 *   stays_off    Stays off target ≥ 80%: about 55% by 15 Jan
 *   no_target    About 42 points by 15 Jan
 *   insufficient Not enough data: <reason>
 */
import { targetNumber, targetUnit } from './targetText';

export type ForecastTarget = { kind: 'min' | 'max'; good: number; warning: number } | { kind: 'band'; low: number; high: number };

export interface ForecastLike {
  status: 'ok' | 'insufficient';
  reason?: string | null;
  unit?: string | null;
  outlook?: 'on_track' | 'will_miss' | 'will_reach' | 'stays_off' | 'no_target' | null;
  crossing?: { day: string; earliest: string; latest: string | null } | null;
  targetNow?: ForecastTarget | null;
  targetAtEnd?: ForecastTarget | null;
  projection?: Array<{ day: string; value: number; low: number; high: number }>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "18 Dec" (UTC day). */
export function shortDay(day: string): string {
  const [, m, d] = day.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** A forecast value in its unit: 55.2%, 12 min, 1.43× estimate. */
export function forecastValue(v: number, unit?: string | null): string {
  const digits = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  const n = Number(v.toFixed(digits)).toLocaleString('en-GB', { maximumFractionDigits: digits });
  if (unit === 'ratio') return `${n}×`;
  if (unit === '/100') return n;
  return `${n}${targetUnit(unit)}`;
}

/** "≥ 80%", "≤ 10 min", "within 0.85–1.15". */
export function forecastTargetText(t: ForecastTarget, unit?: string | null): string {
  if (t.kind === 'band') return `within ${targetNumber(t.low)}–${targetNumber(t.high)}${unit === 'ratio' ? '×' : targetUnit(unit)}`;
  return `${t.kind === 'max' ? '≤' : '≥'} ${targetNumber(t.good)}${unit === '/100' ? '' : targetUnit(unit)}`;
}

export function forecastText(f: ForecastLike): string {
  if (f.status !== 'ok') return `Not enough data: ${f.reason ?? 'too little history'}`;
  const end = f.projection?.[f.projection.length - 1];
  const endText = end ? `about ${forecastValue(end.value, f.unit)} by ${shortDay(end.day)}` : '';
  const target = f.targetNow ? forecastTargetText(f.targetNow, f.unit) : '';
  switch (f.outlook) {
    case 'will_miss': return `Misses target ${target} around ${shortDay(f.crossing!.day)}`;
    case 'will_reach': return `Reaches target ${target} around ${shortDay(f.crossing!.day)}`;
    case 'on_track': return `On track: stays ${target}${end ? ` (${endText})` : ''}`;
    case 'stays_off': return `Stays off target ${target}${end ? `: ${endText}` : ''}`;
    default: return end ? `${endText[0].toUpperCase()}${endText.slice(1)}` : 'Projection only';
  }
}

/** "between 2 Dec and 10 Jan" / "from 2 Dec" for the crossing's band. */
export function crossingRangeText(c: { earliest: string; latest: string | null } | null | undefined): string | null {
  if (!c) return null;
  if (c.latest && c.latest !== c.earliest) return `between ${shortDay(c.earliest)} and ${shortDay(c.latest)}`;
  if (!c.latest) return `from ${shortDay(c.earliest)} at the earliest`;
  return null;
}

/** "At this rate test coverage misses its target ≥ 80% around 18 Dec" (executive summary). */
export function atThisRateText(label: string, f: ForecastLike): string | null {
  if (f.status !== 'ok' || !f.targetNow) return null;
  const target = forecastTargetText(f.targetNow, f.unit);
  const end = f.projection?.[f.projection.length - 1];
  const l = label.charAt(0).toLowerCase() + label.slice(1);
  const name = /^(QA|MTTR|MTBF)/.test(label) ? label : l;
  switch (f.outlook) {
    case 'will_miss': return `At this rate ${name} misses its target ${target} around ${shortDay(f.crossing!.day)}`;
    case 'will_reach': return `At this rate ${name} reaches its target ${target} around ${shortDay(f.crossing!.day)}`;
    case 'stays_off': return end ? `At this rate ${name} stays off target: about ${forecastValue(end.value, f.unit)} by ${shortDay(end.day)} (target ${target})` : null;
    case 'on_track': return `At this rate ${name} stays on target ${target}`;
    default: return null;
  }
}
