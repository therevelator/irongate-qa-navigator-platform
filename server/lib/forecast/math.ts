/**
 * Forecast maths (pure; server/lib/forecast/store.ts loads the data and stores the result).
 *
 * Method, for one metric of one team:
 *   1. Weekly points: the observations of the last HISTORY_WEEKS weeks (one value per recorded day)
 *      grouped in 7-day buckets ending on the as-of day; each bucket gives one point: x = the mean
 *      day of its observations (in weeks before the as-of day, negative), y = the median value. A
 *      week without observations gives no point (nothing is filled in).
 *   2. Trend: Theil–Sen line through the weekly points (slope = median of the pairwise slopes,
 *      intercept = median of y − slope·x). Robust: one odd week does not tilt the line.
 *   3. Band: residual-based. σ = 1.4826 × MAD of the residuals (a robust standard deviation);
 *      half-width at x = z · σ · √(1 + 1/n + (x − x̄)² / Sxx), z = 1.2816 (80 % band).
 *      Values are clamped to the metric's range (e.g. 0–100 %).
 *   4. Not enough data (no forecast, with the reason): fewer than MIN_POINTS weekly points, a
 *      history shorter than MIN_SPAN_WEEKS, a latest value older than MAX_AGE_DAYS, or too noisy
 *      (σ larger than NOISE_LIMIT of the series' typical level).
 *   5. Target crossing, day by day over the horizon, with the target valid on each day (target
 *      history): on target now (the latest value) and the line leaves the target → "will_miss"
 *      on the first day it does; off target now and the line reaches it → "will_reach"; else
 *      "on_track" / "stays_off". Earliest / latest: the same day for the band's pessimistic and
 *      optimistic edges (latest null when the optimistic edge stays inside the horizon).
 */

export const HISTORY_WEEKS = 26;
export const HORIZON_WEEKS = 8;
export const MIN_POINTS = 6;
export const MIN_SPAN_WEEKS = 5;
export const MAX_AGE_DAYS = 21;
export const NOISE_LIMIT = 0.35;
export const Z80 = 1.2816;
export const BAND_LEVEL = 80;

export const METHOD_TEXT =
  `Trend: Theil–Sen line through weekly medians of the last ${HISTORY_WEEKS} weeks (at least ${MIN_POINTS} weeks with values). ` +
  `Band: ${BAND_LEVEL} % range from the spread of the weeks around the line (1.4826 × median absolute deviation). ` +
  `Projected ${HORIZON_WEEKS} weeks ahead; the target crossing uses the target valid on each future day. ` +
  `No forecast when the history is too short, too old or too noisy.`;

export interface Obs { day: string; value: number }
export interface WeeklyPoint { x: number; value: number; n: number; from: string; to: string }

/** A target on a day: one-sided (≥ / ≤ good) or a band (sizing accuracy: within low..high). */
export type TargetSpec =
  | { kind: 'min' | 'max'; good: number; warning: number }
  | { kind: 'band'; low: number; high: number };

export type Outlook = 'on_track' | 'will_miss' | 'will_reach' | 'stays_off' | 'no_target';
export type Trend = 'improving' | 'worsening' | 'flat';
export type Confidence = 'high' | 'medium' | 'low';

export interface ProjectionPoint { day: string; value: number; low: number; high: number }

export interface ForecastOk {
  status: 'ok';
  pointsUsed: number;
  historyFrom: string;
  historyTo: string;
  lastValue: number;
  lastDay: string;
  slopePerWeek: number;
  sigma: number;
  trend: Trend;
  projection: ProjectionPoint[];
  outlook: Outlook;
  crossing: { day: string; earliest: string; latest: string | null } | null;
  targetNow: TargetSpec | null;
  targetAtEnd: TargetSpec | null;
  confidence: Confidence;
}
export interface ForecastInsufficient {
  status: 'insufficient';
  reason: string;
  pointsUsed: number;
  historyFrom: string | null;
  historyTo: string | null;
  lastValue: number | null;
  lastDay: string | null;
}
export type ForecastResult = ForecastOk | ForecastInsufficient;

export interface ForecastInput {
  observations: Obs[];
  asOf: string;
  /** null: no direction (no target, projection only). */
  lowerIsBetter: boolean | null;
  bounds?: { min: number; max: number };
  /** The target valid on a day ('YYYY-MM-DD'), or null when the metric has none. */
  targetOn?: (day: string) => TargetSpec | null;
  horizonWeeks?: number;
}

const DAY_MS = 86_400_000;
export const dayNum = (d: string) => Math.floor(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / DAY_MS);
export const dayStr = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation from the median. */
export function mad(xs: number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Weekly points (step 1). Observations after the as-of day are ignored. */
export function weeklyPoints(obs: Obs[], asOf: string, weeks = HISTORY_WEEKS): WeeklyPoint[] {
  const end = dayNum(asOf);
  const buckets = new Map<number, Obs[]>();
  for (const o of obs) {
    if (!Number.isFinite(o.value)) continue;
    const age = end - dayNum(o.day);
    if (age < 0 || age >= weeks * 7) continue;
    const k = Math.floor(age / 7);
    const list = buckets.get(k) ?? [];
    list.push(o);
    buckets.set(k, list);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, list]) => {
      const days = list.map((o) => dayNum(o.day));
      const meanDay = days.reduce((s, d) => s + d, 0) / days.length;
      return {
        x: (meanDay - end) / 7,
        value: median(list.map((o) => o.value)),
        n: list.length,
        from: dayStr(Math.min(...days)),
        to: dayStr(Math.max(...days)),
      };
    });
}

/** Theil–Sen line: slope = median pairwise slope, intercept = median(y − slope·x). */
export function theilSen(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
    }
  }
  const slope = slopes.length ? median(slopes) : 0;
  const intercept = median(ys.map((y, i) => y - slope * xs[i]));
  return { slope, intercept };
}

export interface Fit { slope: number; intercept: number; sigma: number; n: number; xMean: number; sxx: number }

export function fitTrend(points: WeeklyPoint[]): Fit {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.value);
  const { slope, intercept } = theilSen(xs, ys);
  const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]));
  const sigma = 1.4826 * mad(residuals);
  const xMean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sxx = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
  return { slope, intercept, sigma, n: xs.length, xMean, sxx };
}

/** Value and band at x weeks after the as-of day (step 3, before clamping). */
export function predictAt(fit: Fit, x: number, z = Z80): { value: number; low: number; high: number } {
  const value = fit.intercept + fit.slope * x;
  const half = z * fit.sigma * Math.sqrt(1 + 1 / fit.n + (fit.sxx > 0 ? (x - fit.xMean) ** 2 / fit.sxx : 0));
  return { value, low: value - half, high: value + half };
}

export function meets(t: TargetSpec, v: number): boolean {
  if (t.kind === 'band') return v >= t.low && v <= t.high;
  return t.kind === 'max' ? v <= t.good : v >= t.good;
}

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const clampTo = (v: number, b?: { min: number; max: number }) => (b ? Math.min(b.max, Math.max(b.min, v)) : v);

export function forecastSeries(input: ForecastInput): ForecastResult {
  const horizon = input.horizonWeeks ?? HORIZON_WEEKS;
  const points = weeklyPoints(input.observations, input.asOf);
  const latest = [...input.observations].filter((o) => dayNum(o.day) <= dayNum(input.asOf)).sort((a, b) => dayNum(a.day) - dayNum(b.day)).pop() ?? null;
  const base = {
    pointsUsed: points.length,
    historyFrom: points.length ? points[0].from : null,
    historyTo: points.length ? points[points.length - 1].to : null,
    lastValue: latest ? latest.value : null,
    lastDay: latest ? latest.day.slice(0, 10) : null,
  };
  if (!latest) return { status: 'insufficient', reason: 'No values recorded in the last 26 weeks.', ...base };
  const age = dayNum(input.asOf) - dayNum(latest.day);
  if (age > MAX_AGE_DAYS) return { status: 'insufficient', reason: `The latest value is from ${latest.day.slice(0, 10)} (${age} days ago); a forecast needs a value from the last ${MAX_AGE_DAYS} days.`, ...base };
  if (points.length < MIN_POINTS) return { status: 'insufficient', reason: `Values in ${points.length} of the last ${HISTORY_WEEKS} weeks; a forecast needs at least ${MIN_POINTS} weeks with values.`, ...base };
  const span = points[points.length - 1].x - points[0].x;
  if (span < MIN_SPAN_WEEKS) return { status: 'insufficient', reason: `The history covers ${Math.max(0, Math.round(span * 7))} days; a forecast needs at least ${MIN_SPAN_WEEKS * 7}.`, ...base };

  const fit = fitTrend(points);
  const level = Math.abs(median(points.map((p) => p.value)));
  const t0 = input.targetOn?.(input.asOf) ?? null;
  const targetScale = t0 ? (t0.kind === 'band' ? Math.abs(t0.high - t0.low) : Math.abs(t0.good)) : 0;
  const scale = Math.max(level, targetScale, 1e-9);
  if (fit.sigma > NOISE_LIMIT * scale) {
    return { status: 'insufficient', reason: `Too noisy: the weeks vary by about ±${round(fit.sigma, 2)} around the trend, more than ${Math.round(NOISE_LIMIT * 100)} % of the usual level (${round(scale, 2)}).`, ...base };
  }

  const asOfN = dayNum(input.asOf);
  const projection: ProjectionPoint[] = [];
  for (let w = 1; w <= horizon; w++) {
    const p = predictAt(fit, w);
    projection.push({ day: dayStr(asOfN + 7 * w), value: round(clampTo(p.value, input.bounds)), low: round(clampTo(p.low, input.bounds)), high: round(clampTo(p.high, input.bounds)) });
  }

  // Trend: the change over the horizon against the spread around the line.
  const change = fit.slope * horizon;
  let trend: Trend = 'flat';
  // A metric without a direction (velocity, ROI) has no better / worse: its trend stays "flat"
  // and the slope says which way it moves.
  if (input.lowerIsBetter !== null && Math.abs(change) > Math.max(fit.sigma, 0.01 * level, 1e-9)) {
    trend = (change < 0) === input.lowerIsBetter ? 'improving' : 'worsening';
  }

  let outlook: Outlook = 'no_target';
  let crossing: ForecastOk['crossing'] = null;
  const tEnd = input.targetOn?.(dayStr(asOfN + 7 * horizon)) ?? null;
  if (t0) {
    const okNow = meets(t0, latest.value);
    const firstDay = (pick: (p: { value: number; low: number; high: number }, t: TargetSpec) => number): number | null => {
      for (let d = 1; d <= horizon * 7; d++) {
        const t = input.targetOn!(dayStr(asOfN + d));
        if (!t) continue;
        const p = predictAt(fit, d / 7);
        const v = clampTo(pick(p, t), input.bounds);
        if (meets(t, v) !== okNow) return d;
      }
      return null;
    };
    // For a "max" target the pessimistic edge is the high one; for "min" the low one. A band's
    // pessimistic edge is the one farther from its middle.
    const pessimistic = (p: { value: number; low: number; high: number }, t: TargetSpec) =>
      t.kind === 'band' ? (Math.abs(p.high - (t.low + t.high) / 2) > Math.abs(p.low - (t.low + t.high) / 2) ? p.high : p.low) : t.kind === 'max' ? p.high : p.low;
    const optimistic = (p: { value: number; low: number; high: number }, t: TargetSpec) =>
      t.kind === 'band' ? (pessimistic(p, t) === p.high ? p.low : p.high) : t.kind === 'max' ? p.low : p.high;
    // The outlook follows the line at the end of the horizon: a latest value on the other side of
    // the target than the line (noise around the target) does not count as a crossing.
    const endDay = horizon * 7;
    const tLast = input.targetOn!(dayStr(asOfN + endDay)) ?? t0;
    const okEnd = meets(tLast, clampTo(predictAt(fit, horizon).value, input.bounds));
    const central = okEnd !== okNow ? firstDay((p) => p.value) : null;
    if (central !== null) {
      // Leaving the target: the pessimistic edge leaves first; reaching it: the optimistic edge.
      const early = firstDay(okNow ? pessimistic : optimistic) ?? central;
      const late = firstDay(okNow ? optimistic : pessimistic);
      outlook = okNow ? 'will_miss' : 'will_reach';
      crossing = { day: dayStr(asOfN + central), earliest: dayStr(asOfN + Math.min(early, central)), latest: late === null ? null : dayStr(asOfN + Math.max(late, central)) };
    } else {
      outlook = okNow ? 'on_track' : 'stays_off';
    }
  }

  const rel = fit.sigma / scale;
  const confidence: Confidence = points.length >= 12 && rel <= 0.1 ? 'high' : points.length >= 8 && rel <= 0.2 ? 'medium' : 'low';

  return {
    status: 'ok',
    pointsUsed: points.length,
    historyFrom: points[0].from,
    historyTo: points[points.length - 1].to,
    lastValue: latest.value,
    lastDay: latest.day.slice(0, 10),
    slopePerWeek: round(fit.slope, 6),
    sigma: round(fit.sigma, 6),
    trend,
    projection,
    outlook,
    crossing,
    targetNow: t0,
    targetAtEnd: tEnd,
    confidence,
  };
}
