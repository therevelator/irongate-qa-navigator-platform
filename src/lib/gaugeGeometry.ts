/**
 * Geometry of the radial score gauge (src/components/ScoreGauge.tsx): a 240° arc open at the
 * bottom. Angles are in degrees, 0 at twelve o'clock, growing clockwise; the arc runs from
 * -GAUGE_SWEEP/2 (value 0) to +GAUGE_SWEEP/2 (value 100).
 */

export const GAUGE_SWEEP = 240;
export const GAUGE_START = -GAUGE_SWEEP / 2;
export const GAUGE_END = GAUGE_SWEEP / 2;

/** Box width per size (px) of ScoreGauge, chosen to sit where the battery of the same size sits. */
export const GAUGE_SIZES = { xs: 52, sm: 68, md: 100, lg: 152 } as const;

/** A 0–100 value clamped into range; null for a missing or non-finite value. */
export function clampGaugeValue(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, v));
}

/** Angle of a 0–100 value on the arc (clamped). */
export function valueToAngle(value: number): number {
  const v = Math.max(0, Math.min(100, value));
  return GAUGE_START + (v / 100) * GAUGE_SWEEP;
}

/** Point on a circle at an angle (0° = up, clockwise), rounded to 3 decimals for stable SVG. */
export function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { x: round(cx + r * Math.cos(a)), y: round(cy + r * Math.sin(a)) };
}

/** SVG path of the arc between two angles (clockwise). Empty for a zero-length arc. */
export function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  if (toDeg - fromDeg <= 0.001) return '';
  const s = polar(cx, cy, r, fromDeg);
  const e = polar(cx, cy, r, toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

/** Length of the arc of a value (for the sweep animation's dash offset). */
export function arcLength(r: number, value: number): number {
  const v = Math.max(0, Math.min(100, value));
  return (Math.PI * r * GAUGE_SWEEP * (v / 100)) / 180;
}

/**
 * Layout of a gauge in a square box of `size` px: centre, radius and stroke width. The arc is
 * open at the bottom, so the box is trimmed to the part the arc uses (height < width).
 */
export function gaugeLayout(size: number): { cx: number; cy: number; r: number; stroke: number; width: number; height: number } {
  const stroke = Math.max(4, Math.round(size * 0.11));
  const r = (size - stroke) / 2 - 1;
  const cx = size / 2;
  const cy = size / 2;
  // Lowest point of the arc ends (at ±120°) plus the round cap.
  const bottom = polar(cx, cy, r, GAUGE_END).y + stroke / 2 + 1;
  return { cx, cy, r, stroke, width: size, height: Math.ceil(Math.max(bottom, cy + size * 0.18)) };
}

/**
 * Needle of a gauge of `size` px (ScoreGauge): it reaches `reach` px past the outside of the arc
 * and is `width` px thick (round caps).
 */
export function gaugeNeedle(size: number): { reach: number; width: number } {
  return { reach: Math.max(1.5, size * 0.02), width: Math.max(1.5, size * 0.022) };
}

/**
 * How far the needle can stick out of the gauge's box (px) on the top, left and right: the outside
 * of the arc is 1 px inside the box (gaugeLayout), the needle reaches past it, plus its round cap.
 */
export function gaugeOverhang(size: number): number {
  const n = gaugeNeedle(size);
  return Math.max(0, n.reach + n.width / 2 - 1);
}

/**
 * Largest box width (whole px, at least `min`) whose gauge, needle included (gaugeOverhang), fits
 * inside maxWidth × maxHeight when centred. Used where a gauge fills the space it is given (TV
 * mode) instead of having a fixed size.
 */
export function fitGaugeWidth(maxWidth: number, maxHeight: number, min = 40): number {
  if (!(maxWidth > 0) || !(maxHeight > 0)) return min;
  const fits = (w: number) => {
    const o = gaugeOverhang(w);
    return w + 2 * o <= maxWidth && gaugeLayout(w).height + 2 * o <= maxHeight;
  };
  const ref = gaugeLayout(1000);
  let w = Math.floor(Math.min(maxWidth, (maxHeight * ref.width) / ref.height));
  while (w > min && !fits(w)) w -= 1;
  return Math.max(min, w);
}
