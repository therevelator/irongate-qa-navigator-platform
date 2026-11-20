/**
 * Revenue impact: the single definition of every revenue figure on Delivery → Business impact
 * (tab "Revenue impact"), the company / department roll-up and the what-if projection.
 * Dependency-free (no Node / DB imports): the API computes with it (server/lib/revenueImpactData.ts)
 * and the page imports the formula texts and the what-if projection from it.
 *
 * Inputs are the team's own stored values only: the monthly business-impact series
 * (business_impact_quality_metrics, business_impact_business_kpis, business_impact_context), the
 * KPI targets valid today (target history), the open technical-debt items and the Financial and
 * ROI settings. Nothing is estimated from industry multipliers; missing inputs give null with a
 * reason, never 0.
 *
 * Wording rule: results are associations in the team's history ("associated with"), never causes.
 */
import { olsFit, studentTQuantile, studentTTwoSidedP, type OlsFit } from './stats';
import {
  FINANCIAL_PARAM_LABELS, techDebtCostOfDelay, toNum,
  type FinancialConfig, type FinancialKey, type TechDebtImpactInputs,
} from './metricFormulas';

// ---------------------------------------------------------------------------
// Constants and formula texts (shown in the page and in formula mode)
// ---------------------------------------------------------------------------

/** Same minimum as the correlations (BI_MIN_PAIRED_MONTHS in server/routes/analytics.ts). */
export const REVENUE_MIN_PAIRED_MONTHS = 6;
/** Significance level of the slope test (two-sided, uncorrected). */
export const REVENUE_ALPHA = 0.05;
export const REVENUE_CONFIDENCE = 0.95;
export const MONTHS_PER_YEAR = 12;
/** Two metrics whose monthly series correlate at |r| ≥ this are treated as one movement (not added twice). */
export const REVENUE_OVERLAP_R = 0.7;

export interface RevenueQualityMetric {
  key: string;
  label: string;
  /** unit of one step of the metric, used in "+1 <unit>" */
  unit: string;
  /** target_history metric key whose target applies, or null when none matches */
  targetKey: string | null;
  /** factor that converts the KPI target into this metric's unit (default 1) */
  targetScale?: number;
  lowerIsBetter: boolean;
}

/** Weeks per month (52 ÷ 12): converts a per-week KPI target into a per-month value. */
export const WEEKS_PER_MONTH = 52 / 12;

/**
 * The eight monthly quality metrics of the business-impact data (BI_QUALITY_FIELDS) with the KPI
 * target that applies to each. Deployment frequency is recorded per month; its KPI target is per
 * week, so the target is converted with × 52 ÷ 12 (WEEKS_PER_MONTH).
 */
export const REVENUE_QUALITY_METRICS: RevenueQualityMetric[] = [
  { key: 'test_coverage', label: 'Test coverage', unit: 'percentage point', targetKey: 'test_coverage', lowerIsBetter: false },
  { key: 'defect_density', label: 'Defect density', unit: 'defect per KLOC', targetKey: 'defect_density', lowerIsBetter: true },
  { key: 'defect_escape_rate', label: 'Defect escape rate', unit: 'percentage point', targetKey: 'defect_escape_rate', lowerIsBetter: true },
  { key: 'mttr_hours', label: 'MTTR', unit: 'hour', targetKey: 'mttr_hours', lowerIsBetter: true },
  { key: 'deployment_frequency', label: 'Deploy frequency', unit: 'deployment', targetKey: 'deployment_frequency_per_week', targetScale: WEEKS_PER_MONTH, lowerIsBetter: false },
  { key: 'lead_time_days', label: 'Lead time', unit: 'day', targetKey: 'lead_time_days', lowerIsBetter: true },
  { key: 'code_quality_score', label: 'Code quality', unit: 'point', targetKey: 'code_quality_score', lowerIsBetter: false },
  { key: 'change_failure_rate', label: 'Change failure rate', unit: 'percentage point', targetKey: 'change_failure_rate', lowerIsBetter: true },
];

export const REVENUE_SENSITIVITY_FORMULA =
  'Revenue sensitivity of a metric = slope b of the ordinary least-squares line monthly revenue = a + b × metric, ' +
  `fitted over the team's months that have both values (at least ${REVENUE_MIN_PAIRED_MONTHS}). ` +
  'b = Σ(x − x̄)(y − ȳ) ÷ Σ(x − x̄)²; SE(b) = √(Σ residual² ÷ (n − 2) ÷ Σ(x − x̄)²); t = b ÷ SE(b), df = n − 2, two-sided p; ' +
  `${REVENUE_CONFIDENCE * 100}% interval = b ± t(0.975, n − 2) × SE(b); r = Pearson correlation, R² = r². ` +
  `Significant when p < ${REVENUE_ALPHA} (exploratory, not corrected for multiple comparisons). ` +
  'Sample data and measured data are never fitted together: when both exist, only the months with the same kind of source as the latest month are used. ' +
  'When the team\'s own slope is not significant (or the metric did not change), the company-wide slope is used if it is significant (see below).';

/** Company-wide (pooled) fallback for a team whose own months show no reliable association. */
export const REVENUE_POOLED_FORMULA =
  'Company-wide slope (used only when the team\'s own slope is not significant): the company\'s teams with at least ' +
  `${REVENUE_MIN_PAIRED_MONTHS} paired months of the same kind of source are fitted together, each against its own averages ` +
  '(within-team fit): x = metric − the team\'s average metric, y = monthly revenue ÷ the team\'s average monthly revenue − 1. ' +
  'b = Σxy ÷ Σx² (share of revenue per +1 unit); SE(b) = √(Σ residual² ÷ (N − teams − 1) ÷ Σx²); t-test with df = N − teams − 1; ' +
  `${REVENUE_CONFIDENCE * 100}% interval = b ± t × SE(b). Needs at least 2 teams. $ per +1 unit for this team = b × this team's average monthly revenue.`;

export const REVENUE_AT_STAKE_FORMULA =
  'Monthly revenue at stake = Σ over metrics with a significant slope (the team\'s own, else the company-wide one) of b × (target − current value), ' +
  'where current value = the latest month of the series and target = the KPI target valid today (team, else department, else company, else default; ' +
  'deployment frequency: the weekly target × 52 ÷ 12); ' +
  'a metric already at its target adds 0. Metrics below target are taken first, in order of evidence (smallest p first); a metric whose monthly series ' +
  `correlates at |r| ≥ ${REVENUE_OVERLAP_R} with one already counted is shown but not added (the same movement would be counted twice). ` +
  'Range = Σ of each counted metric\'s (interval low × gap, interval high × gap). ' +
  `Annualised = monthly × ${MONTHS_PER_YEAR}.`;

export const REVENUE_AT_RISK_DEBT_FORMULA =
  'Monthly cost of open technical debt = Σ over open items (not resolved / won\'t fix) with impact data of ' +
  'support tickets/mo × support ticket cost + downtime min/mo × downtime cost per minute + ' +
  'affected users × revenue per user per month × revenue impact % ÷ 100 + SLA breaches/mo × SLA breach penalty. ' +
  `Revenue part = the affected-users term. Annualised = monthly × ${MONTHS_PER_YEAR}.`;

export const INCIDENT_COST_FORMULA =
  'Incident downtime cost (latest month) = downtime minutes recorded for the month × downtime cost per minute. ' +
  `Annualised = monthly × ${MONTHS_PER_YEAR}. Not added to the debt figure: a debt item's downtime can be the same minutes.`;

export const CHURN_REVENUE_FORMULA =
  'Revenue lost to churn (latest month) = churn rate % ÷ 100 × monthly revenue of the same month ' +
  `(assumes churned customers had average revenue). Annualised = monthly × ${MONTHS_PER_YEAR}.`;

export const WHAT_IF_FORMULA =
  'Projected change in monthly revenue = b × change in the metric; range = (interval low × change, interval high × change); ' +
  `annual = monthly × ${MONTHS_PER_YEAR}. Only for a significant slope (the team's own, else the company-wide one).`;

export const REVENUE_ROLLUP_FORMULA =
  'Roll-up = the sum of the team figures (revenue at stake with its range, cost of open debt) over the teams in scope that have the figure; ' +
  'teams without it are listed with the reason and add nothing.';

export const REVENUE_CAVEATS = [
  'Associations in this team\'s own monthly history, not causes: revenue and quality can both follow a trend, seasonality or growth.',
  'Exploratory: each slope is tested on its own, not corrected for multiple comparisons.',
  `Metrics that move together (|r| ≥ ${REVENUE_OVERLAP_R}) are counted once; weaker overlaps between the counted metrics can still count some revenue twice.`,
  'A projection outside the range of values the team has recorded is an extrapolation.',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Num = number | string | null | undefined;

export interface MonthlyRow { month_year: string; [key: string]: unknown }

export type SensitivityStatus = 'fitted' | 'insufficient_data' | 'no_variance';

export interface RevenueSensitivity {
  metric: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  status: SensitivityStatus;
  /** paired months with both the metric and monthly revenue */
  n: number;
  /** paired months still needed (insufficient_data only) */
  monthsMissing: number;
  firstMonth: string | null;
  lastMonth: string | null;
  /** $ per month associated with +1 unit of the metric */
  slope: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  r: number | null;
  r2: number | null;
  pValue: number | null;
  significant: boolean;
  /** observed range of the metric over the paired months */
  minX: number | null;
  maxX: number | null;
  reason: string | null;
  /** 'team': fitted on the team's own months; 'company': the company-wide (pooled) slope, used when the team's own is not significant */
  basis?: 'team' | 'company';
  /** the team's own fit when the company-wide slope is used (null when the metric did not change) */
  own?: { slope: number | null; r: number | null; pValue: number | null; n: number; minX: number | null; maxX: number | null; reason: string | null } | null;
  /** the company-wide fit behind a 'company' slope */
  pooled?: PooledFit | null;
}

export interface CurrentValue { value: number; month: string }

export interface TargetToday {
  good: number;
  lowerIsBetter: boolean;
  scope: string;
  validFrom: string | null;
}

export interface StakeRow {
  metric: string;
  label: string;
  /** counted in the sum */
  included: boolean;
  /** the counted metric this one overlaps with (then not counted) */
  overlapsWith: string | null;
  /** why the metric adds nothing (not significant, no target, ...) */
  reason: string | null;
  current: CurrentValue | null;
  target: TargetToday | null;
  /** target − current when the target is not met, 0 when met, null when unknown */
  gap: number | null;
  targetMet: boolean | null;
  monthly: number | null;
  monthlyLow: number | null;
  monthlyHigh: number | null;
}

export interface MoneyRange {
  monthly: number | null;
  monthlyLow: number | null;
  monthlyHigh: number | null;
  annual: number | null;
  annualLow: number | null;
  annualHigh: number | null;
}

export interface RevenueAtStake extends MoneyRange {
  rows: StakeRow[];
  metricsIncluded: number;
  reason: string | null;
}

export interface FinancialParamUsed { key: FinancialKey; label: string; value: number; isDefault: boolean }

export interface DebtAtRisk {
  openItems: number;
  itemsWithImpact: number;
  monthly: number | null;
  annual: number | null;
  components: { revenueLoss: number; support: number; downtime: number; sla: number } | null;
  parameters: FinancialParamUsed[];
  reason: string | null;
}

export interface SimpleMonthlyFigure {
  month: string | null;
  monthly: number | null;
  annual: number | null;
  inputs: Record<string, number | null>;
  parameters: FinancialParamUsed[];
  reason: string | null;
}

export interface WhatIfResult {
  enabled: boolean;
  reason: string | null;
  metric: string;
  change: number;
  projectedValue: number | null;
  extrapolation: boolean;
  monthly: number | null;
  monthlyLow: number | null;
  monthlyHigh: number | null;
  annual: number | null;
  annualLow: number | null;
  annualHigh: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const metricDef = (key: string) => REVENUE_QUALITY_METRICS.find(m => m.key === key);
const ordered = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);
const annualOf = (v: number | null) => (v === null ? null : v * MONTHS_PER_YEAR);

/** "n more paired months" message used by the empty state. */
export function monthsMissingText(n: number): string {
  const missing = Math.max(0, REVENUE_MIN_PAIRED_MONTHS - n);
  return `${n} paired month${n === 1 ? '' : 's'} with this metric and monthly revenue; needs ${REVENUE_MIN_PAIRED_MONTHS} (${missing} more).`;
}

const isSample = (r: MonthlyRow | undefined) => String(r?.data_source ?? '').toLowerCase() === 'synthetic';

export interface FitWindow {
  /** months with both a quality row and a business-KPI row, of the kind of source used */
  months: string[];
  /** 'sample' when the months used are generated sample data */
  source: 'measured' | 'sample' | null;
  /** paired months left out because they are of the other kind of source */
  excludedMonths: number;
}

/**
 * The months the analysis uses: months with both rows, of the same kind of source (sample /
 * measured) as the latest such month. A pair is sample data when either of its rows is.
 */
export function fitWindow(qualityRows: MonthlyRow[], kpiRows: MonthlyRow[]): FitWindow {
  const kpiByMonth = new Map(kpiRows.map(k => [k.month_year, k]));
  const paired = qualityRows
    .filter(q => kpiByMonth.has(q.month_year))
    .map(q => ({ month: q.month_year, sample: isSample(q) || isSample(kpiByMonth.get(q.month_year)) }))
    .sort((a, b) => a.month.localeCompare(b.month));
  if (!paired.length) return { months: [], source: null, excludedMonths: 0 };
  const latestSample = paired[paired.length - 1].sample;
  const used = paired.filter(p => p.sample === latestSample);
  return { months: used.map(p => p.month), source: latestSample ? 'sample' : 'measured', excludedMonths: paired.length - used.length };
}

function series(qualityRows: MonthlyRow[], kpiRows: MonthlyRow[], metric: string, months: string[]) {
  const qByMonth = new Map(qualityRows.map(q => [q.month_year, q]));
  const kByMonth = new Map(kpiRows.map(k => [k.month_year, k]));
  const out: Array<{ month: string; x: number; y: number | null }> = [];
  for (const month of months) {
    const x = toNum(qByMonth.get(month)?.[metric] as Num);
    if (x === null) continue;
    out.push({ month, x, y: toNum(kByMonth.get(month)?.monthly_revenue as Num) });
  }
  return out;
}

function pairs(qualityRows: MonthlyRow[], kpiRows: MonthlyRow[], metric: string, months?: string[]) {
  const m = months ?? fitWindow(qualityRows, kpiRows).months;
  return series(qualityRows, kpiRows, metric, m).filter((p): p is { month: string; x: number; y: number } => p.y !== null);
}

/** Pearson r of two metrics over the months where both have a value (null when not computable). */
export function metricOverlap(qualityRows: MonthlyRow[], a: string, b: string, months: string[]): number | null {
  const qByMonth = new Map(qualityRows.map(q => [q.month_year, q]));
  const xs: number[] = [], ys: number[] = [];
  for (const m of months) {
    const x = toNum(qByMonth.get(m)?.[a] as Num), y = toNum(qByMonth.get(m)?.[b] as Num);
    if (x !== null && y !== null) { xs.push(x); ys.push(y); }
  }
  const fit = olsFit(xs, ys);
  return fit ? fit.r : null;
}

// ---------------------------------------------------------------------------
// 1a. Company-wide (pooled, within-team) slope: the fallback for a team whose own months are inconclusive
// ---------------------------------------------------------------------------

/** One team's stored monthly series, for the company-wide fit. */
export interface PoolTeamSeries { teamId: string; quality: MonthlyRow[]; kpis: MonthlyRow[] }

export interface PooledFit {
  metric: string;
  /** months used, over all contributing teams */
  n: number;
  /** number of contributing teams (at least 2); no team ids, the fit may include teams outside the reader's scope */
  teams: number;
  df: number;
  /** share of monthly revenue per +1 unit of the metric (0.01 = 1 %) */
  share: number;
  shareLow: number;
  shareHigh: number;
  r: number;
  pValue: number;
  significant: boolean;
  /** range of the metric over the months used (all contributing teams) */
  minX: number;
  maxX: number;
  source: 'measured' | 'sample' | null;
}

/**
 * Within-team pooled fit of one metric over the company's teams (REVENUE_POOLED_FORMULA): each team
 * against its own averages (x − x̄ₜ, y ÷ ȳₜ − 1), so differences in revenue size between teams and
 * each team's level do not count, only how revenue moved with the metric inside each team.
 * Only teams whose months used are of `source` (sample or measured, never mixed). null when fewer
 * than 2 teams contribute or the metric / revenue never changed.
 */
export function pooledRevenueFit(pool: PoolTeamSeries[], metric: string, source: 'measured' | 'sample' | null): PooledFit | null {
  let sxx = 0, sxy = 0, syy = 0, n = 0, minX = Infinity, maxX = -Infinity;
  let teams = 0;
  for (const t of pool) {
    const w = fitWindow(t.quality, t.kpis);
    if (w.source !== source) continue;
    const p = pairs(t.quality, t.kpis, metric, w.months);
    if (p.length < REVENUE_MIN_PAIRED_MONTHS) continue;
    const mx = p.reduce((a, v) => a + v.x, 0) / p.length;
    const my = p.reduce((a, v) => a + v.y, 0) / p.length;
    if (!(my > 0)) continue;
    let tx = 0;
    for (const v of p) tx += (v.x - mx) ** 2;
    if (tx === 0) continue;
    for (const v of p) {
      const dx = v.x - mx, dy = v.y / my - 1;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
    }
    n += p.length;
    teams++;
  }
  const df = n - teams - 1;
  if (teams < 2 || df < 3 || sxx === 0 || syy === 0) return null;
  const share = sxy / sxx;
  const sse = Math.max(0, syy - share * sxy);
  const se = Math.sqrt(sse / df / sxx);
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  const pValue = se === 0 ? 0 : studentTTwoSidedP(share / se, df);
  const half = studentTQuantile(1 - REVENUE_CONFIDENCE, df) * se;
  return {
    metric, n, teams, df, share, shareLow: share - half, shareHigh: share + half, r, pValue,
    significant: pValue < REVENUE_ALPHA, minX, maxX, source,
  };
}

/** Company-wide fits of every metric (null where none is possible). */
export function pooledRevenueFits(pool: PoolTeamSeries[], source: 'measured' | 'sample' | null): Record<string, PooledFit | null> {
  return Object.fromEntries(REVENUE_QUALITY_METRICS.map(m => [m.key, pooledRevenueFit(pool, m.key, source)]));
}

// ---------------------------------------------------------------------------
// 1b. Revenue sensitivity per quality metric
// ---------------------------------------------------------------------------

/**
 * The team's slope for a metric. When the team's own slope is not significant (or the metric did
 * not change) and `pooled` is a significant company-wide fit, the company-wide slope is used,
 * scaled to this team's average monthly revenue (basis 'company'); the team's own fit is kept in `own`.
 */
export function revenueSensitivity(qualityRows: MonthlyRow[], kpiRows: MonthlyRow[], metric: string, months?: string[], pooled?: PooledFit | null): RevenueSensitivity {
  const own = ownRevenueSensitivity(qualityRows, kpiRows, metric, months);
  if (own.status === 'insufficient_data' || own.significant || !pooled || !pooled.significant) return own;
  const p = pairs(qualityRows, kpiRows, metric, months);
  const meanRevenue = p.reduce((a, v) => a + v.y, 0) / p.length;
  if (!(meanRevenue > 0)) return own;
  const [lo, hi] = ordered(pooled.shareLow * meanRevenue, pooled.shareHigh * meanRevenue);
  return {
    ...own,
    status: 'fitted', basis: 'company', monthsMissing: 0, n: pooled.n,
    slope: pooled.share * meanRevenue, ciLow: lo, ciHigh: hi, r: pooled.r, r2: pooled.r * pooled.r, pValue: pooled.pValue, significant: true,
    minX: pooled.minX, maxX: pooled.maxX,
    own: { slope: own.slope, r: own.r, pValue: own.pValue, n: own.n, minX: own.minX ?? Math.min(...p.map(v => v.x)), maxX: own.maxX ?? Math.max(...p.map(v => v.x)), reason: own.reason },
    pooled,
    reason: `This team's own months show no reliable association (${own.status === 'no_variance' ? 'the metric did not change' : `p = ${(own.pValue ?? 1) < 0.001 ? '< 0.001' : (own.pValue ?? 1).toFixed(3)}`}); ` +
      `the company-wide slope over ${pooled.teams} teams (${pooled.n} months, p ${pooled.pValue < 0.001 ? '< 0.001' : `= ${pooled.pValue.toFixed(3)}`}) is used, scaled to this team's average monthly revenue.`,
  };
}

function ownRevenueSensitivity(qualityRows: MonthlyRow[], kpiRows: MonthlyRow[], metric: string, months?: string[]): RevenueSensitivity {
  const def = metricDef(metric);
  const p = pairs(qualityRows, kpiRows, metric, months);
  const base: RevenueSensitivity = {
    metric, label: def?.label ?? metric, unit: def?.unit ?? 'unit', lowerIsBetter: def?.lowerIsBetter ?? false,
    status: 'insufficient_data', n: p.length, monthsMissing: Math.max(0, REVENUE_MIN_PAIRED_MONTHS - p.length),
    firstMonth: p[0]?.month ?? null, lastMonth: p[p.length - 1]?.month ?? null,
    slope: null, ciLow: null, ciHigh: null, r: null, r2: null, pValue: null, significant: false, minX: null, maxX: null, reason: null, basis: 'team',
  };
  if (p.length < REVENUE_MIN_PAIRED_MONTHS) return { ...base, reason: monthsMissingText(p.length) };
  const fit: OlsFit | null = olsFit(p.map(v => v.x), p.map(v => v.y), REVENUE_CONFIDENCE);
  if (!fit) {
    return { ...base, status: 'no_variance', monthsMissing: 0, reason: 'The metric or monthly revenue did not change over these months, so no slope can be fitted.' };
  }
  const significant = fit.pValue < REVENUE_ALPHA;
  return {
    ...base, status: 'fitted', monthsMissing: 0,
    slope: fit.slope, ciLow: fit.ciLow, ciHigh: fit.ciHigh, r: fit.r, r2: fit.r2, pValue: fit.pValue,
    significant, minX: fit.minX, maxX: fit.maxX,
    reason: significant ? null : `Not significant (p = ${fit.pValue < 0.001 ? '< 0.001' : fit.pValue.toFixed(3)} ≥ ${REVENUE_ALPHA}): the data do not show a reliable association.`,
  };
}

export function allRevenueSensitivities(qualityRows: MonthlyRow[], kpiRows: MonthlyRow[], months?: string[], pooled?: Record<string, PooledFit | null>): RevenueSensitivity[] {
  const m = months ?? fitWindow(qualityRows, kpiRows).months;
  return REVENUE_QUALITY_METRICS.map(d => revenueSensitivity(qualityRows, kpiRows, d.key, m, pooled?.[d.key] ?? null));
}

/** The latest month with a value of each quality metric (within `months` when given). */
export function latestValues(qualityRows: MonthlyRow[], months?: string[]): Record<string, CurrentValue | null> {
  const out: Record<string, CurrentValue | null> = {};
  const allowed = months ? new Set(months) : null;
  const sorted = qualityRows.filter(r => !allowed || allowed.has(r.month_year)).sort((a, b) => b.month_year.localeCompare(a.month_year));
  for (const m of REVENUE_QUALITY_METRICS) {
    const row = sorted.find(r => toNum(r[m.key] as Num) !== null);
    out[m.key] = row ? { value: toNum(row[m.key] as Num) as number, month: row.month_year } : null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2a. Monthly revenue at stake (gap to target × slope)
// ---------------------------------------------------------------------------

export function revenueAtStake(
  sensitivities: RevenueSensitivity[],
  current: Record<string, CurrentValue | null>,
  targets: Record<string, TargetToday | null>,
  /** r between two metrics' monthly series; null = not computable (treated as no overlap) */
  overlap: (a: string, b: string) => number | null = () => null,
): RevenueAtStake {
  const rows: StakeRow[] = sensitivities.map(s => {
    const cur = current[s.metric] ?? null;
    const tgt = targets[s.metric] ?? null;
    let gap: number | null = null;
    let targetMet: boolean | null = null;
    if (cur && tgt) {
      targetMet = tgt.lowerIsBetter ? cur.value <= tgt.good : cur.value >= tgt.good;
      gap = targetMet ? 0 : tgt.good - cur.value;
    }
    const row: StakeRow = { metric: s.metric, label: s.label, included: false, overlapsWith: null, reason: null, current: cur, target: tgt, gap, targetMet, monthly: null, monthlyLow: null, monthlyHigh: null };
    if (s.status !== 'fitted') return { ...row, reason: s.reason };
    if (!s.significant) return { ...row, reason: 'Slope not significant' };
    if (!tgt) return { ...row, reason: 'No KPI target in the same unit' };
    if (!cur) return { ...row, reason: 'No current value' };
    const [lo, hi] = ordered((s.ciLow as number) * (gap as number), (s.ciHigh as number) * (gap as number));
    return { ...row, included: true, monthly: (s.slope as number) * (gap as number), monthlyLow: lo, monthlyHigh: hi };
  });

  // Count each movement once: metrics below target first (a metric already at its target adds 0 and
  // must not hide a gap in a metric that moves with it), strongest evidence first; skip a metric
  // that overlaps a counted one.
  const pOf = (m: string) => sensitivities.find(s => s.metric === m)?.pValue ?? 1;
  const met = (r: StakeRow) => (r.gap === 0 ? 1 : 0);
  const counted: StakeRow[] = [];
  for (const row of rows.filter(r => r.included).sort((a, b) => met(a) - met(b) || pOf(a.metric) - pOf(b.metric) || a.metric.localeCompare(b.metric))) {
    const hit = counted.map(c => ({ c, r: overlap(row.metric, c.metric) })).find(o => o.r !== null && Math.abs(o.r) >= REVENUE_OVERLAP_R);
    if (hit) {
      row.included = false;
      row.overlapsWith = hit.c.metric;
      row.reason = `Overlaps with ${hit.c.label} (r = ${(hit.r as number).toFixed(2)}): the same movement, not added again`;
    } else {
      counted.push(row);
    }
  }

  if (!counted.length) {
    const anyFitted = sensitivities.some(s => s.status === 'fitted');
    const reason = !anyFitted
      ? `Needs at least ${REVENUE_MIN_PAIRED_MONTHS} months with both a quality metric and monthly revenue.`
      : sensitivities.some(s => s.significant)
        ? 'The metrics with a significant slope have no KPI target or current value.'
        : 'No quality metric has a significant association with monthly revenue in this team\'s data.';
    return { rows, metricsIncluded: 0, reason, monthly: null, monthlyLow: null, monthlyHigh: null, annual: null, annualLow: null, annualHigh: null };
  }
  const sum = (f: (r: StakeRow) => number | null) => counted.reduce((a, r) => a + (f(r) as number), 0);
  const monthly = sum(r => r.monthly), monthlyLow = sum(r => r.monthlyLow), monthlyHigh = sum(r => r.monthlyHigh);
  return {
    rows, metricsIncluded: counted.length, reason: null,
    monthly, monthlyLow, monthlyHigh, annual: annualOf(monthly), annualLow: annualOf(monthlyLow), annualHigh: annualOf(monthlyHigh),
  };
}

// ---------------------------------------------------------------------------
// 2b. Revenue and cost at risk: open technical debt, incidents, churn
// ---------------------------------------------------------------------------

export function financialParams(config: FinancialConfig, defaultsUsed: readonly FinancialKey[], keys: FinancialKey[]): FinancialParamUsed[] {
  return keys.map(key => ({ key, label: FINANCIAL_PARAM_LABELS[key], value: config[key], isDefault: defaultsUsed.includes(key) }));
}

export const OPEN_DEBT_EXCLUDED_STATUSES = ['resolved', 'wont_fix'];

export function debtRevenueAtRisk(
  items: Array<TechDebtImpactInputs & { status?: string | null }>,
  config: FinancialConfig,
  defaultsUsed: readonly FinancialKey[],
): DebtAtRisk {
  const open = items.filter(i => !OPEN_DEBT_EXCLUDED_STATUSES.includes(String(i.status ?? '')));
  const parameters = financialParams(config, defaultsUsed, ['support_ticket_cost', 'downtime_cost_per_minute', 'revenue_per_user_monthly', 'sla_breach_penalty']);
  const costs = open.map(i => techDebtCostOfDelay(i, config)).filter(c => c.hasImpactData);
  if (!costs.length) {
    return {
      openItems: open.length, itemsWithImpact: 0, monthly: null, annual: null, components: null, parameters,
      reason: open.length ? 'No open item has impact data (tickets, downtime, affected users, SLA breaches). Enter it in Manual metrics → Technical Debt ROI Impact.' : 'No open technical-debt items.',
    };
  }
  const components = {
    revenueLoss: costs.reduce((a, c) => a + c.revenueLoss, 0),
    support: costs.reduce((a, c) => a + c.supportCost, 0),
    downtime: costs.reduce((a, c) => a + c.downtimeCost, 0),
    sla: costs.reduce((a, c) => a + c.slaCost, 0),
  };
  const monthly = components.revenueLoss + components.support + components.downtime + components.sla;
  return { openItems: open.length, itemsWithImpact: costs.length, monthly, annual: annualOf(monthly), components, parameters, reason: null };
}

/** Downtime cost of the latest month with recorded downtime (business_impact_context). */
export function incidentDowntimeCost(contextRows: MonthlyRow[], config: FinancialConfig, defaultsUsed: readonly FinancialKey[]): SimpleMonthlyFigure {
  const parameters = financialParams(config, defaultsUsed, ['downtime_cost_per_minute']);
  const row = [...contextRows].sort((a, b) => b.month_year.localeCompare(a.month_year)).find(r => toNum(r.downtime_minutes as Num) !== null);
  if (!row) return { month: null, monthly: null, annual: null, inputs: { downtime_minutes: null, major_incident_count: null }, parameters, reason: 'No downtime recorded in the monthly context data.' };
  const minutes = toNum(row.downtime_minutes as Num) as number;
  const monthly = minutes * config.downtime_cost_per_minute;
  return { month: row.month_year, monthly, annual: annualOf(monthly), inputs: { downtime_minutes: minutes, major_incident_count: toNum(row.major_incident_count as Num) }, parameters, reason: null };
}

/** Revenue lost to churn in the latest month with both churn rate and monthly revenue. */
export function churnRevenueLoss(kpiRows: MonthlyRow[]): SimpleMonthlyFigure {
  const row = [...kpiRows].sort((a, b) => b.month_year.localeCompare(a.month_year))
    .find(r => toNum(r.churn_rate as Num) !== null && toNum(r.monthly_revenue as Num) !== null);
  if (!row) return { month: null, monthly: null, annual: null, inputs: { churn_rate: null, monthly_revenue: null }, parameters: [], reason: 'No month with both churn rate and monthly revenue.' };
  const churn = toNum(row.churn_rate as Num) as number;
  const revenue = toNum(row.monthly_revenue as Num) as number;
  const monthly = (churn / 100) * revenue;
  return { month: row.month_year, monthly, annual: annualOf(monthly), inputs: { churn_rate: churn, monthly_revenue: revenue }, parameters: [], reason: null };
}

// ---------------------------------------------------------------------------
// 3. What-if
// ---------------------------------------------------------------------------

/** Projected revenue change for a change of `change` units in the metric (signed, in the metric's unit). */
export function whatIf(s: RevenueSensitivity, change: number, current: CurrentValue | null): WhatIfResult {
  const base: WhatIfResult = {
    enabled: false, reason: null, metric: s.metric, change, projectedValue: current ? current.value + change : null, extrapolation: false,
    monthly: null, monthlyLow: null, monthlyHigh: null, annual: null, annualLow: null, annualHigh: null,
  };
  if (!Number.isFinite(change)) return { ...base, reason: 'Enter a number for the change.' };
  if (s.status !== 'fitted') return { ...base, reason: s.reason };
  if (!s.significant) return { ...base, reason: `${s.label} has no significant association with monthly revenue (p ≥ ${REVENUE_ALPHA}), so its slope cannot support a projection.` };
  const monthly = (s.slope as number) * change;
  const [lo, hi] = ordered((s.ciLow as number) * change, (s.ciHigh as number) * change);
  const projected = base.projectedValue;
  const extrapolation = projected !== null && s.minX !== null && s.maxX !== null && (projected < s.minX || projected > s.maxX);
  return {
    ...base, enabled: true, extrapolation,
    monthly, monthlyLow: lo, monthlyHigh: hi, annual: annualOf(monthly), annualLow: annualOf(lo), annualHigh: annualOf(hi),
  };
}

// ---------------------------------------------------------------------------
// 4. Roll-up
// ---------------------------------------------------------------------------

export interface TeamRevenueFigures {
  teamId: string;
  teamName: string;
  departmentId: string | null;
  departmentName: string | null;
  stake: Pick<RevenueAtStake, 'monthly' | 'monthlyLow' | 'monthlyHigh' | 'reason' | 'metricsIncluded'>;
  debt: Pick<DebtAtRisk, 'monthly' | 'reason'>;
  sampleData: boolean;
}

export interface RevenueRollup {
  teams: number;
  stake: MoneyRange & { contributing: string[]; lacking: Array<{ teamId: string; teamName: string; reason: string }> };
  debt: { monthly: number | null; annual: number | null; contributing: string[]; lacking: Array<{ teamId: string; teamName: string; reason: string }> };
}

export function rollUpRevenue(teams: TeamRevenueFigures[]): RevenueRollup {
  const stakeTeams = teams.filter(t => t.stake.monthly !== null);
  const debtTeams = teams.filter(t => t.debt.monthly !== null);
  const sum = (list: TeamRevenueFigures[], f: (t: TeamRevenueFigures) => number | null) => (list.length ? list.reduce((a, t) => a + (f(t) as number), 0) : null);
  const monthly = sum(stakeTeams, t => t.stake.monthly), monthlyLow = sum(stakeTeams, t => t.stake.monthlyLow), monthlyHigh = sum(stakeTeams, t => t.stake.monthlyHigh);
  const debtMonthly = sum(debtTeams, t => t.debt.monthly);
  return {
    teams: teams.length,
    stake: {
      monthly, monthlyLow, monthlyHigh, annual: annualOf(monthly), annualLow: annualOf(monthlyLow), annualHigh: annualOf(monthlyHigh),
      contributing: stakeTeams.map(t => t.teamId),
      lacking: teams.filter(t => t.stake.monthly === null).map(t => ({ teamId: t.teamId, teamName: t.teamName, reason: t.stake.reason ?? 'No figure' })),
    },
    debt: {
      monthly: debtMonthly, annual: annualOf(debtMonthly),
      contributing: debtTeams.map(t => t.teamId),
      lacking: teams.filter(t => t.debt.monthly === null).map(t => ({ teamId: t.teamId, teamName: t.teamName, reason: t.debt.reason ?? 'No figure' })),
    },
  };
}

// ---------------------------------------------------------------------------
// 5. Money summary: where the money goes now, what fixing gains, where to put money first
// ---------------------------------------------------------------------------

export const SUPPORT_COST_FORMULA =
  'Support tickets (latest month) = support tickets recorded for the month × support ticket cost. ' +
  `Annualised = monthly × ${MONTHS_PER_YEAR}.`;

export const DOWNTIME_GAP_FORMULA =
  'Downtime above the availability target = downtime minutes of the latest month − (100 − availability target %) ÷ 100 × minutes in that month; ' +
  'gain when fixed = those minutes × downtime cost per minute (0 when within the target).';

export const MONEY_SUMMARY_TEXT = {
  goingNow: 'Money the team\'s data says is lost or at risk each month, by cause. The causes overlap (a debt item\'s downtime is also in the downtime figure), so they are not added up.',
  gains: 'What each issue is worth each month once it reaches its target, biggest first. Quality gaps are associations in the team\'s own history; debt and downtime are costs computed from entered impact and your financial settings.',
  priorities: 'Fixes ranked by the monthly gain; where a fix has an effort estimate, also by gain per dollar spent (from the technical-debt ROI).',
};

export type GainConfidence = 'strong' | 'some' | 'company' | 'estimate';

export const CONFIDENCE_TEXT: Record<GainConfidence, string> = {
  strong: 'Strong evidence (p < 0.01) in this team\'s own months',
  some: 'Some evidence (p < 0.05) in this team\'s own months',
  company: 'Company-wide evidence (p < 0.05 across the company\'s teams); this team\'s own months are inconclusive',
  estimate: 'Cost estimate from entered impact and your financial settings',
};

export interface MoneyLine {
  key: 'quality_gaps' | 'debt' | 'downtime' | 'support' | 'churn';
  label: string;
  sentence: string;
  monthly: number | null;
  monthlyLow: number | null;
  monthlyHigh: number | null;
  annual: number | null;
  reason: string | null;
  formula: string;
}

export interface GainItem {
  id: string;
  kind: 'quality' | 'debt_item' | 'downtime';
  label: string;
  /** one plain sentence */
  sentence: string;
  monthly: number;
  monthlyLow: number | null;
  monthlyHigh: number | null;
  annual: number;
  annualLow: number | null;
  annualHigh: number | null;
  confidence: GainConfidence;
  /** a counted metric this one overlaps (its gain is not extra) */
  overlapsWith: string | null;
  /** metrics that move together with this one (|r| ≥ REVENUE_OVERLAP_R): reaching this target is the same movement */
  movesWith: string[];
  /** fix cost (effort hours × developer hourly rate), debt items with an estimate only */
  fixCost: number | null;
  /** annual gain ÷ fix cost */
  returnPerDollar: number | null;
  /** fix cost ÷ monthly gain */
  paybackMonths: number | null;
  usesDefaults: boolean;
  formula: string;
}

export interface DebtItemInput extends TechDebtImpactInputs { id: string; title: string; status?: string | null }

export interface MoneySummary {
  goingNow: MoneyLine[];
  gains: GainItem[];
  /** quality metrics whose target gap is associated with no extra revenue (slope × gap ≤ 0) */
  gainsLeftOut: Array<{ label: string; reason: string }>;
  priorities: { byGain: string[]; byReturn: string[] };
  text: typeof MONEY_SUMMARY_TEXT;
}

const daysIn = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export function supportTicketCost(kpiRows: MonthlyRow[], config: FinancialConfig, defaultsUsed: readonly FinancialKey[]): SimpleMonthlyFigure {
  const parameters = financialParams(config, defaultsUsed, ['support_ticket_cost']);
  const row = [...kpiRows].sort((a, b) => b.month_year.localeCompare(a.month_year)).find(r => toNum(r.support_ticket_volume as Num) !== null);
  if (!row) return { month: null, monthly: null, annual: null, inputs: { support_ticket_volume: null }, parameters, reason: 'No support ticket volume recorded.' };
  const tickets = toNum(row.support_ticket_volume as Num) as number;
  const monthly = tickets * config.support_ticket_cost;
  return { month: row.month_year, monthly, annual: annualOf(monthly), inputs: { support_ticket_volume: tickets }, parameters, reason: null };
}

/** Gain from bringing the latest month's downtime within the availability target. */
export function downtimeGapGain(incidents: SimpleMonthlyFigure, availabilityTargetPct: number | null, config: FinancialConfig): { minutesOver: number; monthly: number; allowedMinutes: number } | null {
  const minutes = incidents.inputs.downtime_minutes;
  if (!incidents.month || minutes === null || minutes === undefined || availabilityTargetPct === null) return null;
  const allowedMinutes = ((100 - availabilityTargetPct) / 100) * daysIn(incidents.month) * 1440;
  const minutesOver = Math.max(0, minutes - allowedMinutes);
  return { minutesOver, allowedMinutes, monthly: minutesOver * config.downtime_cost_per_minute };
}

const money = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}k` : `$${Math.round(a)}`;
  return v < 0 ? `−${s}` : s;
};

export function buildMoneySummary(input: {
  sensitivities: RevenueSensitivity[];
  stake: RevenueAtStake;
  debt: DebtAtRisk;
  debtItems: DebtItemInput[];
  incidents: SimpleMonthlyFigure;
  support: SimpleMonthlyFigure;
  churn: SimpleMonthlyFigure;
  availabilityTarget: number | null;
  config: FinancialConfig;
  defaultsUsed: readonly FinancialKey[];
}): MoneySummary {
  const { sensitivities, stake, debt, incidents, support, churn, config, defaultsUsed } = input;
  const usesDefault = (keys: FinancialKey[]) => keys.some(k => defaultsUsed.includes(k));
  const gapCount = stake.rows.filter(r => r.included && r.gap !== 0).length;

  const goingNow: MoneyLine[] = [
    {
      key: 'quality_gaps', label: 'Quality below target',
      sentence: stake.monthly !== null
        ? `Revenue associated with closing the gaps to target in ${gapCount} metric${gapCount === 1 ? '' : 's'} (each movement counted once)` +
          `${sensitivities.some(x => x.basis === 'company' && stake.rows.some(r => r.included && r.metric === x.metric)) ? '; uses the company-wide link where this team\'s own months are inconclusive' : ''}.`
        : 'Revenue associated with quality below target.',
      monthly: stake.monthly, monthlyLow: stake.monthlyLow, monthlyHigh: stake.monthlyHigh, annual: stake.annual, reason: stake.reason, formula: REVENUE_AT_STAKE_FORMULA,
    },
    {
      key: 'debt', label: 'Open technical debt',
      sentence: debt.monthly !== null ? `Cost of delay of ${debt.itemsWithImpact} open item${debt.itemsWithImpact === 1 ? '' : 's'}: tickets, downtime, lost users' revenue and SLA penalties.` : 'Cost of delay of open technical-debt items.',
      monthly: debt.monthly, monthlyLow: null, monthlyHigh: null, annual: debt.annual, reason: debt.reason, formula: REVENUE_AT_RISK_DEBT_FORMULA,
    },
    {
      key: 'downtime', label: 'Incidents and downtime',
      sentence: incidents.monthly !== null ? `${Math.round(incidents.inputs.downtime_minutes ?? 0)} minutes of downtime recorded in the latest month.` : 'Downtime recorded in the latest month.',
      monthly: incidents.monthly, monthlyLow: null, monthlyHigh: null, annual: incidents.annual, reason: incidents.reason, formula: INCIDENT_COST_FORMULA,
    },
    {
      key: 'support', label: 'Support tickets (incl. escaped defects)',
      sentence: support.monthly !== null ? `${Math.round(support.inputs.support_ticket_volume ?? 0)} tickets handled in the latest month.` : 'Cost of handling support tickets.',
      monthly: support.monthly, monthlyLow: null, monthlyHigh: null, annual: support.annual, reason: support.reason, formula: SUPPORT_COST_FORMULA,
    },
    {
      key: 'churn', label: 'Customers leaving (churn)',
      sentence: churn.monthly !== null ? `${churn.inputs.churn_rate}% of customers left in the latest month.` : 'Revenue of customers who left.',
      monthly: churn.monthly, monthlyLow: null, monthlyHigh: null, annual: churn.annual, reason: churn.reason, formula: CHURN_REVENUE_FORMULA,
    },
  ];

  const gains: GainItem[] = [];
  const gainsLeftOut: MoneySummary['gainsLeftOut'] = [];
  const unitText = (m: string, v: number) => {
    const def = metricDef(m);
    const u = def?.unit ?? 'unit';
    const abs = Math.abs(v);
    const rounded = abs >= 10 ? abs.toFixed(0) : abs >= 1 ? abs.toFixed(1) : abs.toFixed(2);
    return `${rounded} ${u}${abs === 1 ? '' : 's'}`;
  };
  for (const row of stake.rows) {
    if (row.monthly === null || row.gap === null || row.gap === 0 || row.overlapsWith) continue;
    const s = sensitivities.find(x => x.metric === row.metric)!;
    if (row.monthly <= 0) {
      gainsLeftOut.push({ label: row.label, reason: `Reaching the target is associated with lower revenue in this team's data (${money(row.monthly)}/month); not counted as a gain.` });
      continue;
    }
    const lower = row.target!.lowerIsBetter;
    gains.push({
      id: `quality:${row.metric}`, kind: 'quality', label: `${row.label} to target`,
      sentence: `${lower ? 'Bring' : 'Raise'} ${/^[A-Z]{2,}/.test(row.label) ? row.label : row.label.toLowerCase()} from ${row.current!.value} to ${row.target!.good} (${lower ? 'down' : 'up'} ${unitText(row.metric, row.gap)}).`,
      monthly: row.monthly, monthlyLow: row.monthlyLow, monthlyHigh: row.monthlyHigh,
      annual: row.monthly * MONTHS_PER_YEAR, annualLow: row.monthlyLow === null ? null : row.monthlyLow * MONTHS_PER_YEAR, annualHigh: row.monthlyHigh === null ? null : row.monthlyHigh * MONTHS_PER_YEAR,
      confidence: s.basis === 'company' ? 'company' : (s.pValue ?? 1) < 0.01 ? 'strong' : 'some',
      overlapsWith: null,
      movesWith: stake.rows.filter(o => o.overlapsWith === row.metric).map(o => o.label),
      fixCost: null, returnPerDollar: null, paybackMonths: null, usesDefaults: false, formula: REVENUE_AT_STAKE_FORMULA,
    });
  }
  for (const item of input.debtItems.filter(i => !OPEN_DEBT_EXCLUDED_STATUSES.includes(String(i.status ?? '')))) {
    const cost = techDebtCostOfDelay(item, config);
    if (!cost.hasImpactData || !cost.monthly || cost.monthly <= 0) continue;
    const effort = toNum(item.estimated_effort_hours);
    const fixCost = effort !== null && effort > 0 ? effort * config.developer_hourly_rate : null;
    const annual = cost.monthly * MONTHS_PER_YEAR;
    gains.push({
      id: `debt:${item.id}`, kind: 'debt_item', label: item.title,
      sentence: fixCost !== null ? `Pay off this debt item (about ${Math.round(effort as number)} h of work, ${money(fixCost)}).` : 'Pay off this debt item (no effort estimate yet).',
      monthly: cost.monthly, monthlyLow: null, monthlyHigh: null, annual, annualLow: null, annualHigh: null, confidence: 'estimate', overlapsWith: null, movesWith: [],
      fixCost, returnPerDollar: fixCost ? annual / fixCost : null, paybackMonths: fixCost ? fixCost / cost.monthly : null,
      usesDefaults: usesDefault(['support_ticket_cost', 'downtime_cost_per_minute', 'revenue_per_user_monthly', 'sla_breach_penalty', ...(fixCost !== null ? ['developer_hourly_rate' as FinancialKey] : [])]),
      formula: REVENUE_AT_RISK_DEBT_FORMULA,
    });
  }
  const dt = downtimeGapGain(incidents, input.availabilityTarget, config);
  if (dt && dt.monthly > 0) {
    gains.push({
      id: 'downtime', kind: 'downtime', label: 'Downtime within the availability target',
      sentence: `Cut downtime by ${Math.round(dt.minutesOver)} minutes a month to meet ${input.availabilityTarget}% availability.`,
      monthly: dt.monthly, monthlyLow: null, monthlyHigh: null, annual: dt.monthly * MONTHS_PER_YEAR, annualLow: null, annualHigh: null,
      confidence: 'estimate', overlapsWith: null, movesWith: [], fixCost: null, returnPerDollar: null, paybackMonths: null,
      usesDefaults: usesDefault(['downtime_cost_per_minute']), formula: DOWNTIME_GAP_FORMULA,
    });
  }
  gains.sort((a, b) => b.monthly - a.monthly || a.id.localeCompare(b.id));
  const byGain = gains.map(g => g.id);
  const byReturn = gains.filter(g => g.returnPerDollar !== null).sort((a, b) => (b.returnPerDollar as number) - (a.returnPerDollar as number)).map(g => g.id);
  return { goingNow, gains, gainsLeftOut, priorities: { byGain, byReturn }, text: MONEY_SUMMARY_TEXT };
}
