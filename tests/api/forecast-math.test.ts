import {
  dayNum, dayStr, fitTrend, forecastSeries, mad, median, meets, predictAt, theilSen, weeklyPoints, Z80, MIN_POINTS,
  type Obs, type TargetSpec,
} from '../../server/lib/forecast/math';
import { atThisRateText, crossingRangeText, forecastText, forecastValue, shortDay } from '../../src/lib/forecastText';

/**
 * Forecast maths (server/lib/forecast/math.ts) on known series: weekly points, the Theil–Sen line,
 * the residual-based 80 % band, the "not enough data" reasons, and the target crossing with the
 * target valid on each future day. Pure: no database.
 */

const AS_OF = '2026-11-20';
const plus = (d: number) => dayStr(dayNum(AS_OF) + d);
/** One observation per week: x = 0, -1, … weeks before the as-of day. */
const weekly = (f: (x: number) => number, weeks = 10): Obs[] =>
  Array.from({ length: weeks }, (_, k) => ({ day: plus(-7 * k), value: f(-k) }));
const min = (good: number, warning = good - 10): TargetSpec => ({ kind: 'min', good, warning });
const max = (good: number, warning = good + 10): TargetSpec => ({ kind: 'max', good, warning });

describe('statistics helpers', () => {
  test('median and median absolute deviation', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
  });

  test('Theil–Sen ignores one outlier: the slope and intercept of the other points', () => {
    const xs = [-9, -8, -7, -6, -5, -4, -3, -2, -1, 0];
    const ys = xs.map((x) => 80 - x);
    ys[6] += 40; // x = -3
    const { slope, intercept } = theilSen(xs, ys);
    expect(slope).toBe(-1);
    expect(intercept).toBe(80);
  });

  test('weekly points: daily values grouped in 7-day buckets ending on the as-of day, median per bucket', () => {
    const obs: Obs[] = Array.from({ length: 14 }, (_, i) => ({ day: plus(-i), value: i < 7 ? 10 + i : 50 + i }));
    const pts = weeklyPoints(obs, AS_OF);
    expect(pts).toHaveLength(2);
    expect(pts[1]).toMatchObject({ value: 13, n: 7, from: plus(-6), to: AS_OF });
    expect(pts[1].x).toBeCloseTo(-3 / 7, 10);
    expect(pts[0]).toMatchObject({ value: 60, n: 7 });
    expect(pts[0].x).toBeCloseTo(-10 / 7, 10);
    // Future observations and those older than 26 weeks are ignored; empty weeks give no point.
    expect(weeklyPoints([{ day: plus(3), value: 1 }, { day: plus(-200), value: 1 }, { day: plus(-21), value: 5 }], AS_OF)).toHaveLength(1);
  });

  test('residual band: σ = 1.4826 × MAD, half-width z·σ·√(1 + 1/n + (x − x̄)²/Sxx)', () => {
    // Level 10 with residuals alternating ±1 over 10 weeks: slope 0, intercept 10, MAD 1.
    const pts = weeklyPoints(weekly((x) => (x % 2 === 0 ? 9 : 11)), AS_OF);
    const fit = fitTrend(pts);
    expect(fit.slope).toBe(0);
    expect(fit.intercept).toBe(10);
    expect(fit.sigma).toBeCloseTo(1.4826, 10);
    expect(fit.sxx).toBeCloseTo(82.5, 10);
    const p = predictAt(fit, 1);
    const half = Z80 * 1.4826 * Math.sqrt(1 + 1 / 10 + (1 + 4.5) ** 2 / 82.5);
    expect(p.value).toBe(10);
    expect(p.high - p.value).toBeCloseTo(half, 10);
    expect(p.value - p.low).toBeCloseTo(half, 10);
    expect(half).toBeCloseTo(2.3011, 3);
  });

  test('meets: one-sided targets and a band', () => {
    expect(meets(min(80), 80)).toBe(true);
    expect(meets(min(80), 79.9)).toBe(false);
    expect(meets(max(5), 5)).toBe(true);
    expect(meets({ kind: 'band', low: 0.85, high: 1.15 }, 1.2)).toBe(false);
  });
});

describe('forecastSeries', () => {
  test('a straight line: exact projection, zero band, and the day it reaches the target', () => {
    const f = forecastSeries({ observations: weekly((x) => 50 + 2 * x), asOf: AS_OF, lowerIsBetter: false, targetOn: () => min(60) });
    if (f.status !== 'ok') throw new Error(f.reason);
    expect(f.slopePerWeek).toBe(2);
    expect(f.sigma).toBe(0);
    expect(f.projection).toHaveLength(8);
    expect(f.projection[0]).toEqual({ day: plus(7), value: 52, low: 52, high: 52 });
    expect(f.projection[7]).toEqual({ day: plus(56), value: 66, low: 66, high: 66 });
    expect(f.trend).toBe('improving');
    expect(f.outlook).toBe('will_reach');
    // 50 + 2·d/7 ≥ 60 from d = 35.
    expect(f.crossing).toEqual({ day: plus(35), earliest: plus(35), latest: plus(35) });
    expect(f.confidence).toBe('medium'); // 10 weeks (high needs 12)
  });

  test('on target and declining: misses the target on the first day below it', () => {
    const f = forecastSeries({ observations: weekly((x) => 82 - 0.5 * x, 14), asOf: AS_OF, lowerIsBetter: false, targetOn: () => min(80) });
    if (f.status !== 'ok') throw new Error(f.reason);
    expect(f.trend).toBe('worsening');
    expect(f.outlook).toBe('will_miss');
    // 82 − 0.5·d/7 < 80 from d = 29 (d = 28 is exactly 80, still on target).
    expect(f.crossing?.day).toBe(plus(29));
    expect(f.confidence).toBe('high');
    expect(forecastText({ ...f, unit: '%' })).toBe('Misses target ≥ 80% around 19 Dec');
    expect(atThisRateText('Test coverage', { ...f, unit: '%' })).toBe('At this rate test coverage misses its target ≥ 80% around 19 Dec');
  });

  test('lower is better: rising build time misses ≤ 10 min; flat on target is on track', () => {
    const rising = forecastSeries({ observations: weekly((x) => 9 + 0.25 * x), asOf: AS_OF, lowerIsBetter: true, targetOn: () => max(10) });
    if (rising.status !== 'ok') throw new Error(rising.reason);
    expect(rising.trend).toBe('worsening');
    expect(rising.outlook).toBe('will_miss');
    expect(rising.crossing?.day).toBe(plus(29)); // 9 + 0.25·d/7 > 10 from d = 29
    const flat = forecastSeries({ observations: weekly(() => 7), asOf: AS_OF, lowerIsBetter: true, targetOn: () => max(10) });
    if (flat.status !== 'ok') throw new Error(flat.reason);
    expect(flat.trend).toBe('flat');
    expect(flat.outlook).toBe('on_track');
    expect(flat.crossing).toBeNull();
    expect(forecastText({ ...flat, unit: 'min' })).toBe('On track: stays ≤ 10 min (about 7 min by 15 Jan)');
  });

  test('the target valid then: a raised target on a future day is a miss from that day', () => {
    const targetOn = (day: string) => (day >= plus(20) ? min(85) : min(80));
    const f = forecastSeries({ observations: weekly(() => 82), asOf: AS_OF, lowerIsBetter: false, targetOn });
    if (f.status !== 'ok') throw new Error(f.reason);
    expect(f.outlook).toBe('will_miss');
    expect(f.crossing?.day).toBe(plus(20));
    expect(f.targetNow).toEqual(min(80));
    expect(f.targetAtEnd).toEqual(min(85));
  });

  test('off target and not reaching it: stays off, with the value at the horizon', () => {
    const f = forecastSeries({ observations: weekly((x) => 60 + x), asOf: AS_OF, lowerIsBetter: false, targetOn: () => min(80), bounds: { min: 0, max: 100 } });
    if (f.status !== 'ok') throw new Error(f.reason);
    expect(f.outlook).toBe('stays_off');
    expect(f.projection[7].value).toBe(68);
    expect(forecastText({ ...f, unit: '%' })).toBe('Stays off target ≥ 80%: about 68% by 15 Jan');
  });

  test('values are clamped to the metric range', () => {
    const f = forecastSeries({ observations: weekly((x) => 4 - x), asOf: AS_OF, lowerIsBetter: true, targetOn: () => max(2), bounds: { min: 0, max: 100 } });
    if (f.status !== 'ok') throw new Error(f.reason);
    expect(f.projection[7].value).toBe(0);
    expect(f.projection[7].low).toBe(0);
  });

  test('a noisy latest value on the other side of the target is not a crossing', () => {
    // Rising line around 79–80 with the latest value just above 80: the line ends above the target.
    const obs = weekly((x) => 79 + 0.3 * x + 0.3 * 9);
    obs[0] = { day: AS_OF, value: 80.5 };
    const f = forecastSeries({ observations: obs, asOf: AS_OF, lowerIsBetter: false, targetOn: () => min(80) });
    if (f.status !== 'ok') throw new Error(f.reason);
    expect(f.outlook).toBe('on_track');
  });

  test('a band (sizing accuracy within 0.85–1.15): drifting out of it is a miss', () => {
    const f = forecastSeries({ observations: weekly((x) => 1.1 + 0.02 * x), asOf: AS_OF, lowerIsBetter: null, targetOn: () => ({ kind: 'band', low: 0.85, high: 1.15 }) });
    if (f.status !== 'ok') throw new Error(f.reason);
    expect(f.outlook).toBe('will_miss');
    // 1.1 + 0.02·d/7 > 1.15 from d = 18.
    expect(f.crossing?.day).toBe(plus(18));
    expect(forecastText({ ...f, unit: 'ratio' })).toBe('Misses target within 0.85–1.15× around 8 Dec');
  });

  test('with spread, the crossing comes with earliest and latest days from the band edges', () => {
    const f = forecastSeries({ observations: weekly((x) => 82 - 0.5 * x + (x % 2 === 0 ? 0.4 : -0.4), 14), asOf: AS_OF, lowerIsBetter: false, targetOn: () => min(80) });
    if (f.status !== 'ok') throw new Error(f.reason);
    expect(f.outlook).toBe('will_miss');
    const c = f.crossing!;
    expect(c.earliest <= c.day).toBe(true);
    expect(c.latest === null || c.latest >= c.day).toBe(true);
    expect(dayNum(c.earliest)).toBeLessThan(dayNum(c.day));
    expect(crossingRangeText(c)).toMatch(/^(between \d+ \w+ and \d+ \w+|from \d+ \w+ at the earliest)$/);
  });

  test('no target: projection only, without better / worse', () => {
    const f = forecastSeries({ observations: weekly((x) => 40 + x), asOf: AS_OF, lowerIsBetter: null });
    if (f.status !== 'ok') throw new Error(f.reason);
    expect(f.outlook).toBe('no_target');
    expect(f.trend).toBe('flat');
    expect(forecastText({ ...f, unit: 'points' })).toBe('About 48 points by 15 Jan');
  });
});

describe('not enough data', () => {
  test('fewer than 6 weeks with values', () => {
    const f = forecastSeries({ observations: weekly((x) => 50 + x, MIN_POINTS - 1), asOf: AS_OF, lowerIsBetter: false });
    expect(f.status).toBe('insufficient');
    if (f.status === 'insufficient') {
      expect(f.reason).toBe('Values in 5 of the last 26 weeks; a forecast needs at least 6 weeks with values.');
      expect(forecastText(f)).toBe(`Not enough data: ${f.reason}`);
    }
  });

  test('a latest value older than 21 days', () => {
    const obs = weekly((x) => 50 + x, 12).map((o) => ({ ...o, day: dayStr(dayNum(o.day) - 30) }));
    const f = forecastSeries({ observations: obs, asOf: AS_OF, lowerIsBetter: false });
    expect(f.status).toBe('insufficient');
    if (f.status === 'insufficient') expect(f.reason).toMatch(/^The latest value is from 2026-10-21 \(30 days ago\)/);
  });

  test('a history shorter than 5 weeks (several values a week)', () => {
    const obs: Obs[] = Array.from({ length: 30 }, (_, i) => ({ day: plus(-i), value: 50 + i }));
    const f = forecastSeries({ observations: obs, asOf: AS_OF, lowerIsBetter: false });
    expect(f.status).toBe('insufficient');
    if (f.status === 'insufficient') expect(f.reason).toMatch(/Values in 5 of the last 26 weeks|covers \d+ days/);
  });

  test('too noisy: the weeks swing more than 35 % of the level around the trend', () => {
    const f = forecastSeries({ observations: weekly((x) => (x % 2 === 0 ? 2 : 18), 12), asOf: AS_OF, lowerIsBetter: true, targetOn: () => max(5) });
    expect(f.status).toBe('insufficient');
    if (f.status === 'insufficient') expect(f.reason).toMatch(/^Too noisy/);
  });

  test('no values at all', () => {
    const f = forecastSeries({ observations: [], asOf: AS_OF, lowerIsBetter: false });
    expect(f).toMatchObject({ status: 'insufficient', pointsUsed: 0, lastValue: null });
  });
});

describe('wording helpers', () => {
  test('dates and values', () => {
    expect(shortDay('2026-12-18')).toBe('18 Dec');
    expect(forecastValue(55.234, '%')).toBe('55.2%');
    expect(forecastValue(1.4321, 'ratio')).toBe('1.43×');
    expect(forecastValue(1198.4, 'h')).toBe('1,198 h');
    expect(forecastValue(72.4, '/100')).toBe('72.4');
  });
});
