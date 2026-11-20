import { arcLength, arcPath, clampGaugeValue, fitGaugeWidth, gaugeLayout, gaugeOverhang, GAUGE_END, GAUGE_START, GAUGE_SWEEP, polar, valueToAngle } from '../../src/lib/gaugeGeometry';
import { batteryBand } from '../../src/lib/batteryScale';

/**
 * Geometry of the radial score gauge (src/lib/gaugeGeometry.ts, drawn by src/components/ScoreGauge.tsx).
 * Pure functions: no backend needed.
 */
describe('score gauge geometry', () => {
  it('GAU-001: a 240° arc open at the bottom: 0 → -120°, 50 → 0° (top), 100 → +120°', () => {
    expect(GAUGE_SWEEP).toBe(240);
    expect([GAUGE_START, GAUGE_END]).toEqual([-120, 120]);
    expect(valueToAngle(0)).toBe(-120);
    expect(valueToAngle(50)).toBe(0);
    expect(valueToAngle(100)).toBe(120);
    expect(valueToAngle(85)).toBeCloseTo(84);
  });

  it('GAU-002: values are clamped; a missing value has no arc', () => {
    expect(valueToAngle(-10)).toBe(-120);
    expect(valueToAngle(140)).toBe(120);
    expect(clampGaugeValue(null)).toBeNull();
    expect(clampGaugeValue(Number.NaN)).toBeNull();
    expect(clampGaugeValue(112)).toBe(100);
  });

  it('GAU-003: polar coordinates: 0° is straight up, 90° to the right', () => {
    expect(polar(50, 50, 40, 0)).toEqual({ x: 50, y: 10 });
    expect(polar(50, 50, 40, 90)).toEqual({ x: 90, y: 50 });
    expect(polar(50, 50, 40, 180)).toEqual({ x: 50, y: 90 });
  });

  it('GAU-004: arc paths use the large-arc flag past 180° and are empty for no length', () => {
    expect(arcPath(50, 50, 40, -120, 120)).toMatch(/ A 40 40 0 1 1 /);
    expect(arcPath(50, 50, 40, -120, 0)).toMatch(/ A 40 40 0 0 1 /);
    expect(arcPath(50, 50, 40, 10, 10)).toBe('');
  });

  it('GAU-005: arc length grows linearly with the value (the sweep animation dash)', () => {
    const r = 40;
    expect(arcLength(r, 0)).toBe(0);
    expect(arcLength(r, 100)).toBeCloseTo((2 * Math.PI * r * 240) / 360);
    expect(arcLength(r, 50)).toBeCloseTo(arcLength(r, 100) / 2);
  });

  it('GAU-006: the layout fits the arc (with its round caps) inside the box', () => {
    for (const size of [52, 68, 100, 152]) {
      const l = gaugeLayout(size);
      expect(l.cx - l.r - l.stroke / 2).toBeGreaterThanOrEqual(0);
      expect(l.cx + l.r + l.stroke / 2).toBeLessThanOrEqual(size);
      expect(polar(l.cx, l.cy, l.r, GAUGE_END).y + l.stroke / 2).toBeLessThanOrEqual(l.height);
      expect(l.height).toBeLessThan(size);
    }
  });

  it('GAU-007: the value arc uses the battery colour scale (same band as the battery)', () => {
    expect([batteryBand(81)?.key, batteryBand(68)?.key, batteryBand(25)?.key]).toEqual(['lightGreen', 'yellow', 'red']);
  });

  it('GAU-008: fitGaugeWidth gives the largest gauge whose box and needle fit the space (TV mode)', () => {
    for (const [W, H] of [[586, 330], [410, 230], [1172, 660], [300, 900], [900, 300]]) {
      const w = fitGaugeWidth(W, H);
      const o = gaugeOverhang(w);
      expect(w + 2 * o).toBeLessThanOrEqual(W);
      expect(gaugeLayout(w).height + 2 * o).toBeLessThanOrEqual(H);
      const n = w + 1;
      const on = gaugeOverhang(n);
      expect(n + 2 * on > W || gaugeLayout(n).height + 2 * on > H).toBe(true);
    }
    // Height-driven when the space is wide, width-driven when it is tall.
    expect(gaugeLayout(fitGaugeWidth(5000, 300)).height).toBeGreaterThan(270);
    expect(fitGaugeWidth(300, 5000)).toBeGreaterThan(280);
    expect(fitGaugeWidth(0, 100, 52)).toBe(52);
  });
});
