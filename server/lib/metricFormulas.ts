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
// CONFIDENCE OF A COMPOSITE (how many of its inputs it is based on)
// ============================================================================

export type Confidence = 'high' | 'medium' | 'low';

/** Share of inputs used: high ≥ 90 %, medium ≥ 50 %, otherwise low (also low when there is no value). */
export const CONFIDENCE_RULE = { high: 0.9, medium: 0.5 } as const;

export const CONFIDENCE_RULE_TEXT =
  'Confidence = inputs used ÷ inputs expected: high at 90 % or more, medium at 50 % or more, otherwise low. ' +
  'Stale and missing inputs are not used.';

/** Every composite score is returned with the inputs it is based on. */
export interface Composite {
  value: number | null;
  inputsUsed: number;
  inputsTotal: number;
  confidence: Confidence;
}

export function confidenceOf(inputsUsed: number, inputsTotal: number, hasValue = true): Confidence {
  if (!hasValue || inputsTotal <= 0 || inputsUsed <= 0) return 'low';
  const share = inputsUsed / inputsTotal;
  return share >= CONFIDENCE_RULE.high ? 'high' : share >= CONFIDENCE_RULE.medium ? 'medium' : 'low';
}

export function composite(value: number | null, inputsUsed: number, inputsTotal: number): Composite {
  return { value, inputsUsed, inputsTotal, confidence: confidenceOf(inputsUsed, inputsTotal, value !== null) };
}

/** "based on 3 of 4 inputs" (UI wording; the noun is per composite: inputs, teams, components). */
export function basedOnText(c: Pick<Composite, 'inputsUsed' | 'inputsTotal'>, noun = 'inputs'): string {
  return `based on ${c.inputsUsed} of ${c.inputsTotal} ${noun}`;
}

export const QA_SCORE_INPUTS = Object.keys(QA_SCORE_WEIGHTS) as Array<keyof typeof QA_SCORE_WEIGHTS>;

export interface QaScoreComposite extends Composite {
  status: QaStatus | null;
  /** Inputs left out because their latest value is older than the expected update interval. */
  staleInputs: string[];
  /** Inputs with no recorded value. */
  missingInputs: string[];
}

/**
 * The QA score of a snapshot with stale inputs left out: exactly computeQaScore() on the same
 * row with every stale input treated as not recorded (the database's compute_qa_score gives the
 * same result for the same inputs; tests/database/qaScoreTrigger.test.ts checks every stale
 * combination). Minimum-inputs rule unchanged: coverage plus at least 2 of the 4 inputs.
 */
export function qaScoreComposite(row: QaScoreInputs | null | undefined, stale: Iterable<string> = []): QaScoreComposite {
  const staleSet = new Set(stale);
  const fresh: QaScoreInputs = {};
  const staleInputs: string[] = [];
  const missingInputs: string[] = [];
  for (const key of QA_SCORE_INPUTS) {
    const v = toNum(row?.[key]);
    if (v === null) missingInputs.push(key);
    else if (staleSet.has(key)) staleInputs.push(key);
    else fresh[key] = v;
  }
  const r = computeQaScore(fresh);
  const used = QA_SCORE_INPUTS.length - staleInputs.length - missingInputs.length;
  return { ...composite(r.score, used, QA_SCORE_INPUTS.length), status: r.status, staleInputs, missingInputs };
}

// ============================================================================
// COMPANY AGGREGATES (team-size weighted, with the distribution)
// ============================================================================

export const COMPANY_AGGREGATE_TEXT =
  'Company value = mean of the team values weighted by active team size (assigned members; a team with no members counts as 1). ' +
  'Teams without a current value are left out. The unweighted mean, median, 25th percentile (weakest quartile), minimum and count are reported alongside.';

export interface Distribution {
  weightedMean: number | null;
  unweightedMean: number | null;
  median: number | null;
  /** 25th percentile (linear interpolation): the weakest quarter of teams is at or below it. */
  p25: number | null;
  min: number | null;
  count: number;
}

/** Percentile p (0..1) of sorted values, linear interpolation between closest ranks. */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function distributionOf(items: Array<{ value: Num; weight?: Num }>): Distribution {
  const vals = items
    .map((i) => ({ v: toNum(i.value), w: Math.max(1, toNum(i.weight) ?? 1) }))
    .filter((i): i is { v: number; w: number } => i.v !== null);
  if (!vals.length) return { weightedMean: null, unweightedMean: null, median: null, p25: null, min: null, count: 0 };
  const sorted = vals.map((i) => i.v).sort((a, b) => a - b);
  const wSum = vals.reduce((s, i) => s + i.w, 0);
  return {
    weightedMean: vals.reduce((s, i) => s + i.v * i.w, 0) / wSum,
    unweightedMean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
    median: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.25),
    min: sorted[0],
    count: sorted.length,
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

// ============================================================================
// TECHNICAL DEBT ROI (per debt item)
// ============================================================================

/** ROI of fixing one technical-debt item (GET /api/analytics/technical-debt, Manual metrics). */
export const TECH_DEBT_ROI_FORMULA =
  'Investment = effort hours × developer hourly rate; ' +
  'Monthly cost of delay = support tickets/mo × support ticket cost + downtime min/mo × downtime cost per minute + ' +
  'affected users × revenue per user per month × revenue impact % ÷ 100 + SLA breaches/mo × SLA breach penalty; ' +
  'Annual savings = monthly cost of delay × 12; ROI % = (annual savings − investment) ÷ investment × 100; ' +
  'Payback months = investment ÷ monthly cost of delay.';

/**
 * Financial and ROI settings (Parameters → Financial and ROI settings; team overrides department
 * overrides company). Keys without a configured value use these built-in defaults, which every
 * screen labels as defaults.
 */
export const FINANCIAL_DEFAULTS = {
  developer_hourly_rate: 75,
  support_ticket_cost: 25,
  revenue_per_user_monthly: 50,
  downtime_cost_per_minute: 100,
  sla_breach_penalty: 1000,
} as const;

export type FinancialKey = keyof typeof FINANCIAL_DEFAULTS;
export type FinancialConfig = Record<FinancialKey, number>;

export const FINANCIAL_PARAM_LABELS: Record<FinancialKey, string> = {
  developer_hourly_rate: 'Developer hourly rate',
  support_ticket_cost: 'Support ticket cost',
  revenue_per_user_monthly: 'Revenue per user per month',
  downtime_cost_per_minute: 'Downtime cost per minute',
  sla_breach_penalty: 'SLA breach penalty',
};

export interface TechDebtImpactInputs {
  estimated_effort_hours?: Num;
  affected_users?: Num;
  support_tickets_monthly?: Num;
  downtime_minutes_monthly?: Num;
  revenue_impact_percent?: Num;
  sla_breaches_monthly?: Num;
}

export interface TechDebtCostOfDelay {
  /** false when none of the five impact inputs was entered: the cost is unknown, not 0 */
  hasImpactData: boolean;
  supportCost: number;
  downtimeCost: number;
  /** affected users × revenue per user per month × revenue impact % ÷ 100 */
  revenueLoss: number;
  slaCost: number;
  /** null when hasImpactData is false */
  monthly: number | null;
}

/** Monthly cost of delay of one debt item, by component (TECH_DEBT_ROI_FORMULA). */
export function techDebtCostOfDelay(debt: TechDebtImpactInputs, config: FinancialConfig): TechDebtCostOfDelay {
  const impacts = [debt.affected_users, debt.support_tickets_monthly, debt.downtime_minutes_monthly, debt.revenue_impact_percent, debt.sla_breaches_monthly].map(toNum);
  const hasImpactData = impacts.some(v => v !== null);
  const [affectedUsers, supportTickets, downtimeMinutes, revenueImpactPct, slaBreaches] = impacts.map(v => v ?? 0);
  const supportCost = supportTickets * config.support_ticket_cost;
  const downtimeCost = downtimeMinutes * config.downtime_cost_per_minute;
  const revenueLoss = affectedUsers * config.revenue_per_user_monthly * (revenueImpactPct / 100);
  const slaCost = slaBreaches * config.sla_breach_penalty;
  return {
    hasImpactData, supportCost, downtimeCost, revenueLoss, slaCost,
    monthly: hasImpactData ? supportCost + downtimeCost + revenueLoss + slaCost : null,
  };
}

/** Per-item ROI (TECH_DEBT_ROI_FORMULA). Values that cannot be computed are null. */
export function techDebtRoi(debt: TechDebtImpactInputs, config: FinancialConfig): {
  investment: number | null; monthlyCost: number | null; annualSavings: number | null; roi: number | null; paybackMonths: number | null;
} {
  const effortHours = toNum(debt.estimated_effort_hours);
  const investment = effortHours !== null ? effortHours * config.developer_hourly_rate : null;
  const monthlyCost = techDebtCostOfDelay(debt, config).monthly;
  const annualSavings = monthlyCost !== null ? monthlyCost * 12 : null;
  const roi = investment !== null && investment > 0 && annualSavings !== null ? ((annualSavings - investment) / investment) * 100 : null;
  const paybackMonths = investment !== null && monthlyCost !== null && monthlyCost > 0 ? investment / monthlyCost : null;
  return { investment, monthlyCost, annualSavings, roi, paybackMonths };
}

// ============================================================================
// PIPELINE BOTTLENECK SCORE (per stage, relative to the other stages)
// ============================================================================

export const BOTTLENECK_SCORE_FORMULA =
  'Bottleneck score = min(100, duration factor + failure factor), rounded to 1 decimal. ' +
  'Duration factor = min(60, max(0, (z + 2) ÷ 4 × 60)), where z = (stage duration − mean stage duration) ÷ standard deviation of the stage durations; ' +
  'failure factor = (1 − success rate ÷ 100) × 40. No score when duration or success rate is missing.';

export interface BottleneckStageResult {
  score: number | null;
  z: number | null;
  durationFactor: number | null;
  failureFactor: number | null;
}

/**
 * The one bottleneck-score calculation, over a set of stages (population standard deviation
 * of the recorded durations). Used by GET /api/analytics/pipeline-stages.
 */
export function computeBottleneckScores(stages: Array<{ duration: Num; success_rate: Num }>): {
  meanDuration: number;
  stdDev: number;
  stagesWithDuration: number;
  results: BottleneckStageResult[];
} {
  const durations = stages.map((s) => toNum(s.duration)).filter((d): d is number => d !== null);
  const meanDuration = durations.length ? durations.reduce((sum, v) => sum + v, 0) / durations.length : 0;
  const variance = durations.length
    ? durations.reduce((sum, v) => sum + Math.pow(v - meanDuration, 2), 0) / durations.length
    : 0;
  const stdDev = Math.sqrt(Math.max(variance, 1e-6));

  const results = stages.map((s): BottleneckStageResult => {
    const duration = toNum(s.duration);
    const successRate = toNum(s.success_rate);
    if (duration === null || successRate === null) return { score: null, z: null, durationFactor: null, failureFactor: null };
    const z = stdDev > 0 ? (duration - meanDuration) / stdDev : 0;
    const durationFactor = Math.min(60, Math.max(0, ((z + 2) / 4) * 60));
    const failureFactor = (1 - clamp(successRate / 100, 0, 1)) * 40;
    const score = Math.round(Math.min(100, Math.max(0, durationFactor + failureFactor)) * 10) / 10;
    return { score, z, durationFactor, failureFactor };
  });

  return { meanDuration, stdDev, stagesWithDuration: durations.length, results };
}
