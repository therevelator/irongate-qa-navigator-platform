/**
 * The expectation shown next to every metric status ("On target", "Watch", "Off target"), in one
 * wording for the whole app (Team detail, overview team cards, Compare, TV mode, Analytics, PDF):
 *
 *   higher is better   Target ≥ 80%          Watch: 70–80%
 *   lower is better    Target ≤ 1 /1k LOC    Watch: 1–2 /1k LOC
 *
 * The threshold is the target valid at the value's date (target history: GET /api/teams
 * kpiThresholds, /kpi-history targets, getThreshold in src/data/detailedKPIs.ts). "Watch" is the
 * band between the target (good) and the warning threshold.
 */

export interface TargetThreshold {
  good: number;
  warning: number;
  lowerIsBetter: boolean;
}

export type TargetStatus = 'good' | 'warning' | 'critical' | 'neutral' | 'no-data' | 'none' | null | undefined;

/** A threshold number without trailing zeros (80, 1.5, 99.9). */
export const targetNumber = (v: number): string =>
  Number.isInteger(v) ? String(v) : v.toLocaleString('en-GB', { maximumFractionDigits: 3 });

/** Unit as written after a target number: "%" sticks to the number, others after a space. */
export const targetUnit = (unit?: string | null): string => {
  if (!unit) return '';
  if (unit === '%') return '%';
  if (unit === '/100') return '';
  return ` ${unit.trim()}`;
};

/** "Target ≥ 80%" / "Target ≤ 1 /1k LOC". */
export function targetLabel(t: TargetThreshold | null | undefined, unit?: string | null): string | null {
  if (!t) return null;
  return `Target ${t.lowerIsBetter ? '≤' : '≥'} ${targetNumber(t.good)}${targetUnit(unit)}`;
}

/**
 * "Watch: 70–80%" (higher is better: warning–good; lower is better: good–warning). With
 * `withUnit` false a word unit is left out ("Watch: 0.5–1"), for lines that name the unit again
 * in the target right after it; "%" always stays.
 */
export function watchBand(t: TargetThreshold | null | undefined, unit?: string | null, withUnit = true): string | null {
  if (!t) return null;
  const [lo, hi] = t.lowerIsBetter ? [t.good, t.warning] : [t.warning, t.good];
  const u = withUnit || unit === '%' ? targetUnit(unit) : '';
  return `Watch: ${targetNumber(lo)}–${targetNumber(hi)}${u}`;
}

/**
 * The expectation for a value with this status: the target, and for Watch the band as well
 * ("Watch: 70–80% · Target ≥ 80%", "Watch: 0.5–1 · Target ≤ 0.5 /1k LOC"). Null without a target.
 */
export function expectationText(t: TargetThreshold | null | undefined, unit?: string | null, status?: TargetStatus): string | null {
  const target = targetLabel(t, unit);
  if (!target) return null;
  return status === 'warning' ? `${watchBand(t, unit, false)} · ${target}` : target;
}

/** Short status words used with the expectation. */
export const STATUS_WORD: Record<'good' | 'warning' | 'critical', string> = {
  good: 'On target',
  warning: 'Watch',
  critical: 'Off target',
};

/**
 * Status and expectation in one compact line: "On target · Target ≥ 80%",
 * "Watch: 70–80% · Target ≥ 80%", "Off target · Target ≤ 1 /1k LOC".
 */
export function statusWithTarget(t: TargetThreshold | null | undefined, unit: string | null | undefined, status: TargetStatus): string | null {
  if (status !== 'good' && status !== 'warning' && status !== 'critical') return targetLabel(t, unit);
  const target = targetLabel(t, unit);
  if (!target) return STATUS_WORD[status];
  if (status === 'warning') return `${watchBand(t, unit, false)} · ${target}`;
  return `${STATUS_WORD[status]} · ${target}`;
}
