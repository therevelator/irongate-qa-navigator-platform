import { BATTERY_BANDS, BATTERY_SHELL, batteryBand, contrastRatio, relativeLuminance } from '../../src/lib/batteryScale';

/**
 * The battery colour scale (src/lib/batteryScale.ts), used by every battery of the app:
 * <30 red, 30–45 deep amber, 45–60 amber, 60–75 yellow, 75–90 light green, 90–100 solid green.
 * Pure function: no backend needed.
 */
describe('batteryBand', () => {
  it('BAT-001: every boundary falls in the upper band; values inside each band', () => {
    const cases: Array<[number, string]> = [
      [0, 'red'], [12, 'red'], [29.9, 'red'],
      [30, 'deepAmber'], [44.99, 'deepAmber'],
      [45, 'amber'], [59.5, 'amber'],
      [60, 'yellow'], [68, 'yellow'], [74.9, 'yellow'],
      [75, 'lightGreen'], [89.9, 'lightGreen'],
      [90, 'green'], [100, 'green'],
    ];
    for (const [v, key] of cases) expect([v, batteryBand(v)?.key]).toEqual([v, key]);
  });

  it('BAT-002: out-of-range values are clamped; a missing value has no band', () => {
    expect(batteryBand(-5)?.key).toBe('red');
    expect(batteryBand(140)?.key).toBe('green');
    expect(batteryBand(null)).toBeNull();
    expect(batteryBand(undefined)).toBeNull();
    expect(batteryBand(Number.NaN)).toBeNull();
  });

  it('BAT-003: six bands in ascending order starting at 0', () => {
    expect(BATTERY_BANDS.map((b) => b.min)).toEqual([0, 30, 45, 60, 75, 90]);
  });

  it('BAT-004: the liquid stands out from the dark battery shell (at least 3:1, WCAG non-text contrast)', () => {
    for (const b of BATTERY_BANDS) {
      expect([b.key, contrastRatio(b.stops[2], BATTERY_SHELL) >= 3]).toEqual([b.key, true]);
      expect([b.key, contrastRatio(b.flat, BATTERY_SHELL) >= 3]).toEqual([b.key, true]);
    }
  });

  it('BAT-005: neighbouring bands are distinguishable (different body colours)', () => {
    const bodies = BATTERY_BANDS.map((b) => b.stops[2]);
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  it('BAT-006: each band\'s five shades keep the Cell reference\'s relationship (edge-dark, highlight, body, bright leading edge, dark leading edge)', () => {
    // Reference green: #316d08, #60b939, #51aa31, #64ce11, #255405.
    const L = relativeLuminance;
    const ref = ['#316d08', '#60b939', '#51aa31', '#64ce11', '#255405'];
    const order = (c: string[]) => [L(c[4]) < L(c[0]), L(c[0]) < L(c[2]), L(c[2]) < L(c[1]), L(c[1]) < L(c[3])];
    expect(order(ref)).toEqual([true, true, true, true]);
    for (const b of BATTERY_BANDS) expect([b.key, ...order(b.stops)]).toEqual([b.key, true, true, true, true]);
  });
});
