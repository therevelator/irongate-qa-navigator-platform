/**
 * Shared metric formulas — the single definition of each composite metric.
 *
 * This module is dependency-free (no Node/DB imports) so it can be imported by
 * both the API (server/) and, if needed, the frontend (src/). Any text shown to
 * users that describes one of these formulas should use the *_FORMULA constant
 * exported next to it so the description cannot drift from the calculation.
 */

type Num = number | string | null | undefined;

/** Parse a DB/JSON value into a finite number, or null when missing/invalid. */
export function toNum(value: Num): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ============================================================================
// QA SCORE
// ============================================================================

export type QaStatus = 'good' | 'warning' | 'critical';

export const QA_SCORE_THRESHOLDS = { good: 85, warning: 70 } as const;

export const QA_SCORE_WEIGHTS = {
  test_coverage: 0.30,
  defect_escape_rate: 0.25,
  change_failure_rate: 0.25,
  code_quality_score: 0.20,
} as const;

export const QA_SCORE_FORMULA =
  'QA Score = [Test Coverage × 0.30 + (100 − Defect Escape Rate) × 0.25 + (100 − Change Failure Rate) × 0.25 + Code Quality Score × 0.20] ÷ (sum of the weights of the inputs that are recorded). ' +
  'Each term is limited to 0–100; missing inputs are left out (not counted as 0 or 100). ' +
  'No score when Test Coverage is missing or fewer than 2 of the 4 inputs are recorded. Rounded to a whole number. ' +
  'Status: ≥85 good, ≥70 warning, otherwise critical.';

export interface QaScoreInputs {
  test_coverage?: Num;
  defect_escape_rate?: Num;
  change_failure_rate?: Num;
  code_quality_score?: Num;
}

export interface QaScoreResult {
  /** 0–100 integer, or null when there is not enough data. */
  score: number | null;
  status: QaStatus | null;
  /** Share (0–1) of the formula weight backed by recorded inputs. */
  weightCoverage: number;
  missingInputs: string[];
}

export function qaStatusFromScore(score: number | null | undefined): QaStatus | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (score >= QA_SCORE_THRESHOLDS.good) return 'good';
  if (score >= QA_SCORE_THRESHOLDS.warning) return 'warning';
  return 'critical';
}

/**
 * The one QA score formula, used by manual entry, the sync job and the
 * /metrics/team/:id/all view.
 */
export function computeQaScore(row: QaScoreInputs | null | undefined): QaScoreResult {
  const cov = toNum(row?.test_coverage);
  const esc = toNum(row?.defect_escape_rate);
  const cfr = toNum(row?.change_failure_rate);
  const cq = toNum(row?.code_quality_score);

  const terms: Array<{ key: keyof typeof QA_SCORE_WEIGHTS; value: number | null }> = [
    { key: 'test_coverage', value: cov === null ? null : clamp(cov, 0, 100) },
    { key: 'defect_escape_rate', value: esc === null ? null : clamp(100 - esc, 0, 100) },
    { key: 'change_failure_rate', value: cfr === null ? null : clamp(100 - cfr, 0, 100) },
    { key: 'code_quality_score', value: cq === null ? null : clamp(cq, 0, 100) },
  ];

  const present = terms.filter((t) => t.value !== null);
  const missingInputs = terms.filter((t) => t.value === null).map((t) => t.key);
  const weightSum = present.reduce((s, t) => s + QA_SCORE_WEIGHTS[t.key], 0);

  if (cov === null || present.length < 2 || weightSum <= 0) {
    return { score: null, status: null, weightCoverage: Math.round(weightSum * 100) / 100, missingInputs };
  }

  const weighted = present.reduce((s, t) => s + (t.value as number) * QA_SCORE_WEIGHTS[t.key], 0);
  const score = Math.round(weighted / weightSum);
  return {
    score,
    status: qaStatusFromScore(score),
    weightCoverage: Math.round(weightSum * 100) / 100,
    missingInputs,
  };
}

// ============================================================================
// TECHNICAL DEBT SCORE (team)
// ============================================================================

/** One weight set for open technical-debt items (also used by the company summary). */
export const TECH_DEBT_SEVERITY_WEIGHTS = {
  critical: 30,
  high: 20,
  medium: 10,
  low: 5,
} as const;

export const TECH_DEBT_SCORE_FORMULA =
  'Technical Debt Score = MIN(100, Σ severity weight of open items) where critical=30, high=20, medium=10, low=5; ' +
  'items with status resolved or wont_fix are excluded. Lower is better (0 = no open debt).';

/** SQL fragment (no parameters) summing open-item weights from the technical_debt table. */
export const TECH_DEBT_OPEN_WEIGHT_SQL = `SUM(CASE
  WHEN status NOT IN ('resolved','wont_fix') THEN
    CASE severity
      WHEN 'critical' THEN ${TECH_DEBT_SEVERITY_WEIGHTS.critical}
      WHEN 'high' THEN ${TECH_DEBT_SEVERITY_WEIGHTS.high}
      WHEN 'medium' THEN ${TECH_DEBT_SEVERITY_WEIGHTS.medium}
      WHEN 'low' THEN ${TECH_DEBT_SEVERITY_WEIGHTS.low}
      ELSE 0
    END
  ELSE 0
END)`;

export function techDebtScoreFromWeight(openWeight: Num): number {
  const w = toNum(openWeight) ?? 0;
  return w <= 0 ? 0 : Math.min(100, Math.round(w));
}

// ============================================================================
// DDPS — Daily Developer Productivity Score (0–100)
// ============================================================================

export const DDPS_FORMULA =
  'DDPS (0–100) = clamp(raw, 0, 75) ÷ 75 × 100, where raw = Focus + Meetings + Context switches + PR merge + Review + Balance: ' +
  'Focus = min(focus hours ÷ 5, 1) × 50; ' +
  'Meetings = 0 (≤1 h), −3 (≤2 h), −6 (≤3 h), −10 (>3 h); ' +
  'Context switches = 0 (≤2/day), −5 (≤4), −10 (≤6), −15 (>6); ' +
  'PR merge time = +10 (<4 h), +5 (<8 h), 0 (<24 h), −5 (<48 h), −10 (≥48 h); ' +
  'Review turnaround = +5 (<2 h), +2 (<4 h), 0 (<8 h), −5 (≥8 h); ' +
  'Balance = max(0, 100 − 25 × max(0, focus hours + meeting hours − 8)) ÷ 10. ' +
  'PR merge and review times are elapsed (wall-clock) times, so they are not counted as hours worked. ' +
  'No score when any input is missing. The maximum raw total is 75, hence the rescale to 0–100.';

export const DDPS_RAW_MAX = 75;

export interface DdpsInputs {
  focus_time_hours?: Num;
  meeting_time_hours?: Num;
  context_switches_per_day?: Num;
  pr_merge_time_avg?: Num;
  code_review_time_avg?: Num;
}

export interface DdpsResult {
  /** 0–100, or null when any input is missing. */
  score: number | null;
  components: {
    focus: number;
    meetings: number;
    contextSwitches: number;
    prMerge: number;
    review: number;
    balance: number;
  } | null;
  /** focus + meetings (hours/day); used for the balance term. */
  scheduledHours: number | null;
}

export function computeDdps(input: DdpsInputs): DdpsResult {
  const focus = toNum(input.focus_time_hours);
  const meetings = toNum(input.meeting_time_hours);
  const cs = toNum(input.context_switches_per_day);
  const pr = toNum(input.pr_merge_time_avg);
  const review = toNum(input.code_review_time_avg);
  if (focus === null || meetings === null || cs === null || pr === null || review === null) {
    return { score: null, components: null, scheduledHours: null };
  }

  const focusPts = Math.min(Math.max(focus, 0) / 5, 1) * 50;
  const meetingPts = meetings <= 1 ? 0 : meetings <= 2 ? -3 : meetings <= 3 ? -6 : -10;
  const csPts = cs <= 2 ? 0 : cs <= 4 ? -5 : cs <= 6 ? -10 : -15;
  const prPts = pr < 4 ? 10 : pr < 8 ? 5 : pr < 24 ? 0 : pr < 48 ? -5 : -10;
  const reviewPts = review < 2 ? 5 : review < 4 ? 2 : review < 8 ? 0 : -5;
  const scheduledHours = focus + meetings;
  const overtime = Math.max(0, scheduledHours - 8);
  const balancePts = Math.max(0, 100 - overtime * 25) / 10;

  const raw = focusPts + meetingPts + csPts + prPts + reviewPts + balancePts;
  const score = Math.round((clamp(raw, 0, DDPS_RAW_MAX) / DDPS_RAW_MAX) * 1000) / 10;

  return {
    score,
    components: {
      focus: focusPts,
      meetings: meetingPts,
      contextSwitches: csPts,
      prMerge: prPts,
      review: reviewPts,
      balance: balancePts,
    },
    scheduledHours,
  };
}

// ============================================================================
// BURNOUT RISK (developer or team averages)
// ============================================================================

export type BurnoutRiskLevel = 'low' | 'moderate' | 'high';

export const BURNOUT_DEFINITION =
  'High when focus time < 3 h/day, meetings > 5 h/day or context switches > 10/day; ' +
  'moderate when focus time < 4 h/day, meetings > 4 h/day or context switches > 7/day; otherwise low. ' +
  'Not rated when any of the three inputs is missing.';

/** The one burnout-risk rule (developer values or team averages). Null when any input is missing. */
export function computeBurnoutRisk(input: {
  focus_time_hours?: Num;
  meeting_time_hours?: Num;
  context_switches_per_day?: Num;
}): BurnoutRiskLevel | null {
  const focus = toNum(input.focus_time_hours);
  const meetings = toNum(input.meeting_time_hours);
  const switches = toNum(input.context_switches_per_day);
  if (focus === null || meetings === null || switches === null) return null;
  if (focus < 3 || meetings > 5 || switches > 10) return 'high';
  if (focus < 4 || meetings > 4 || switches > 7) return 'moderate';
  return 'low';
}

/** Capitalised label used in API responses ('High' | 'Moderate' | 'Low' | 'Unknown'). */
export function burnoutRiskLabel(level: BurnoutRiskLevel | null): 'High' | 'Moderate' | 'Low' | 'Unknown' {
  return level === 'high' ? 'High' : level === 'moderate' ? 'Moderate' : level === 'low' ? 'Low' : 'Unknown';
}
