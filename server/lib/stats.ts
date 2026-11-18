/**
 * Small statistics toolkit shared by the business-impact correlations and the revenue impact
 * analysis. Dependency-free (no Node / DB imports) so the frontend can import it too.
 *
 *   studentTTwoSidedP   exact two-sided p-value of a Student-t statistic (regularized incomplete beta)
 *   studentTQuantile    t value with a given two-sided tail probability (inverse of the above)
 *   benjaminiHochberg   false-discovery-rate adjusted q-values
 *   olsFit              ordinary least squares y = a + b·x with r, R², p-value and a CI for b
 */

const LANCZOS_COEFFS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = LANCZOS_COEFFS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS_COEFFS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Continued fraction for the incomplete beta function (Numerical Recipes, betacf)
function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAXIT = 300, EPS = 3e-16, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return bt * betaContinuedFraction(a, b, x) / a;
  return 1 - bt * betaContinuedFraction(b, a, 1 - x) / b;
}

/** Two-sided p-value of a Student-t statistic: p = I_{df/(df+t^2)}(df/2, 1/2). */
export function studentTTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.min(1, regularizedIncompleteBeta(df / (df + t * t), df / 2, 0.5)));
}

/**
 * The t value whose two-sided tail probability is `alpha` (e.g. 0.05 → the 97.5 % quantile
 * used for a 95 % confidence interval), by bisection on studentTTwoSidedP. Accurate to ~1e-10.
 */
export function studentTQuantile(alpha: number, df: number): number {
  if (!(df > 0) || !(alpha > 0 && alpha < 1)) return NaN;
  let lo = 0;
  let hi = 1;
  while (studentTTwoSidedP(hi, df) > alpha) hi *= 2;
  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    if (studentTTwoSidedP(mid, df) > alpha) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Benjamini-Hochberg adjusted q-values (same order as input; null stays null). */
export function benjaminiHochberg(pValues: Array<number | null>): Array<number | null> {
  const indexed = pValues
    .map((p, i) => ({ p, i }))
    .filter((o): o is { p: number; i: number } => o.p !== null)
    .sort((a, b) => a.p - b.p);
  const m = indexed.length;
  const q: Array<number | null> = pValues.map(() => null);
  let running = 1;
  for (let k = m - 1; k >= 0; k--) {
    running = Math.min(running, (indexed[k].p * m) / (k + 1));
    q[indexed[k].i] = Math.min(1, running);
  }
  return q;
}

export interface OlsFit {
  n: number;
  df: number;
  /** b: change in y per +1 unit of x */
  slope: number;
  /** a: fitted y at x = 0 */
  intercept: number;
  /** Pearson r of x and y */
  r: number;
  /** R² = r² (share of the variance of y explained by the line) */
  r2: number;
  /** standard error of the slope: sqrt(SSE / (n − 2) / Sxx) */
  slopeSe: number;
  /** t = b / SE(b), df = n − 2 */
  t: number;
  /** two-sided p-value of t (H0: slope = 0); identical to the p-value of Pearson r */
  pValue: number;
  /** confidence level of [ciLow, ciHigh], e.g. 0.95 */
  confidence: number;
  /** t quantile used for the interval */
  tCritical: number;
  ciLow: number;
  ciHigh: number;
  meanX: number;
  meanY: number;
  minX: number;
  maxX: number;
}

/**
 * Ordinary least squares fit of y on x.
 *   b = Sxy / Sxx,  a = ȳ − b·x̄,  SSE = Σ (y − a − b·x)²,  SE(b) = √(SSE / (n − 2) / Sxx)
 *   t = b / SE(b) with df = n − 2, two-sided p;  CI = b ± t(1 − α/2, n − 2) · SE(b)
 * Returns null when n < 3 or x (or y) has zero variance (the slope is undefined / untestable).
 * A perfect fit (SSE = 0) gives SE 0, p = 0 and a zero-width interval.
 */
export function olsFit(x: number[], y: number[], confidence = 0.95): OlsFit | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let meanX = 0, meanY = 0, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < n; i++) {
    meanX += x[i]; meanY += y[i];
    if (x[i] < minX) minX = x[i];
    if (x[i] > maxX) maxX = x[i];
  }
  meanX /= n; meanY /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX, dy = y[i] - meanY;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const e = y[i] - intercept - slope * x[i];
    sse += e * e;
  }
  const df = n - 2;
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  const slopeSe = Math.sqrt(sse / df / sxx);
  const perfect = slopeSe === 0 || 1 - Math.abs(r) < 1e-12;
  const t = perfect ? (slope >= 0 ? Infinity : -Infinity) : slope / slopeSe;
  const pValue = perfect ? 0 : studentTTwoSidedP(t, df);
  const tCritical = studentTQuantile(1 - confidence, df);
  const half = perfect ? 0 : tCritical * slopeSe;
  return {
    n, df, slope, intercept, r, r2: r * r, slopeSe: perfect ? 0 : slopeSe, t, pValue,
    confidence, tCritical, ciLow: slope - half, ciHigh: slope + half, meanX, meanY, minX, maxX,
  };
}
