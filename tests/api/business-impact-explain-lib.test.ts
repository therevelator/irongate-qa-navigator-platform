import { studentTTwoSidedP } from '../../server/lib/stats';
import {
  REVENUE_QUALITY_METRICS, WEEKS_PER_MONTH, pooledRevenueFit, pooledRevenueFits, revenueSensitivity, allRevenueSensitivities, fitWindow,
  revenueAtStake, buildMoneySummary, whatIf, type MonthlyRow, type PoolTeamSeries,
} from '../../server/lib/revenueImpact';
import { FINANCIAL_DEFAULTS } from '../../server/lib/metricFormulas';
import { correlationSummaryHtml, criticalR } from '../../server/lib/correlationSummary';
import { sampleRates, SAMPLE_COST_RATES, teamDefFor } from '../../server/seeds/demoData';

/**
 * Business impact: the company-wide (pooled, within-team) revenue slope used when a team's own
 * months are inconclusive, the deployment-frequency target conversion, the rule-based summary
 * shown when no AI provider answers, and the sample financial rates.
 *
 * Hand computation for the pooled fit: two teams with the reference data set x = 1..6,
 * y = 2, 4, 5, 4, 5, 7 (× 1000). Per team: x − x̄ = −2.5..2.5 (Σ = 17.5), y ÷ ȳ − 1 = (y − 4.5) ÷ 4.5,
 * Σxy = 13.5 ÷ 4.5 = 3, Σy² = 13.5 ÷ 20.25 = 0.666667. Pooled: Sxx = 35, Sxy = 6, Syy = 1.333333,
 * b = 6 ÷ 35 = 0.1714286 (17.14 % of revenue per +1), SSE = Syy − b·Sxy = 0.3047619,
 * df = 12 − 2 − 1 = 9, SE = √(0.3047619 ÷ 9 ÷ 35) = 0.0311046, t = 5.511299, r = 6 ÷ √(35 · 1.333333) = 0.8783101.
 */

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
const Y = [2, 4, 5, 4, 5, 7];

function series(teamId: string, xs: number[], ys: number[], source = 'manual', metric = 'test_coverage'): PoolTeamSeries {
  return {
    teamId,
    quality: MONTHS.map((m, i) => ({ month_year: m, [metric]: xs[i], data_source: source })),
    kpis: MONTHS.map((m, i) => ({ month_year: m, monthly_revenue: ys[i], data_source: source })),
  };
}
const X = [1, 2, 3, 4, 5, 6];
const A = series('a', X, Y.map(v => v * 1000));
const B = series('b', X, Y.map(v => v * 1000));
// A steady team: coverage barely moves and revenue is noise around 500 000 (own slope not significant).
const FLAT = series('flat', [90, 90.2, 90.1, 90.3, 90.1, 90.2], [500000, 498000, 503000, 499000, 502000, 500500]);

describe('Company-wide revenue slope (pooledRevenueFit)', () => {
  it('BI-LIB-001: within-team pooled slope, interval, r and p match the hand computation', () => {
    const f = pooledRevenueFit([A, B], 'test_coverage', 'measured')!;
    expect(f.teams).toBe(2);
    expect(f.n).toBe(12);
    expect(f.df).toBe(9);
    expect(f.share).toBeCloseTo(0.1714286, 6);
    expect(f.r).toBeCloseTo(0.8783101, 6);
    expect(f.pValue).toBeCloseTo(studentTTwoSidedP(0.1714286 / 0.0311046, 9), 6);
    expect(f.pValue).toBeLessThan(0.001);
    expect(f.significant).toBe(true);
    expect(f.shareLow).toBeLessThan(f.share);
    expect(f.shareHigh).toBeGreaterThan(f.share);
    expect(f.shareHigh - f.share).toBeCloseTo(f.share - f.shareLow, 9);
    expect([f.minX, f.maxX]).toEqual([1, 6]);
  });

  it('BI-LIB-002: needs two contributing teams; sample and recorded months are never pooled together', () => {
    expect(pooledRevenueFit([A], 'test_coverage', 'measured')).toBeNull();
    const sampleB = series('b', X, Y.map(v => v * 1000), 'synthetic');
    expect(pooledRevenueFit([A, sampleB], 'test_coverage', 'measured')).toBeNull();
    expect(pooledRevenueFit([A, sampleB], 'test_coverage', 'sample')).toBeNull();
    // A team whose metric never changed adds nothing (and does not count as a team).
    const still = series('still', [80, 80, 80, 80, 80, 80], Y.map(v => v * 1000));
    expect(pooledRevenueFit([A, still], 'test_coverage', 'measured')).toBeNull();
  });

  it('BI-LIB-003: a team with inconclusive own months uses the company-wide slope × its own average revenue', () => {
    const pool = [A, B, FLAT];
    const fits = pooledRevenueFits(pool, 'measured');
    const own = revenueSensitivity(FLAT.quality, FLAT.kpis, 'test_coverage', MONTHS);
    expect(own.basis).toBe('team');
    expect(own.significant).toBe(false);
    const s = revenueSensitivity(FLAT.quality, FLAT.kpis, 'test_coverage', MONTHS, fits.test_coverage);
    const meanRevenue = FLAT.kpis.reduce((a, k) => a + Number(k.monthly_revenue), 0) / 6;
    expect(s.basis).toBe('company');
    expect(s.significant).toBe(true);
    expect(s.slope).toBeCloseTo(fits.test_coverage!.share * meanRevenue, 4);
    expect(s.ciLow).toBeCloseTo(fits.test_coverage!.shareLow * meanRevenue, 4);
    expect(s.pValue).toBe(fits.test_coverage!.pValue);
    expect(s.n).toBe(fits.test_coverage!.n);
    expect(s.own?.n).toBe(6);
    expect(s.own?.pValue).toBe(own.pValue);
    expect(s.reason).toMatch(/company-wide slope over 3 teams/);
  });

  it('BI-LIB-004: a team with its own significant slope keeps it; a team with too few months gets no slope', () => {
    const fits = pooledRevenueFits([A, B, FLAT], 'measured');
    const s = revenueSensitivity(A.quality, A.kpis, 'test_coverage', MONTHS, fits.test_coverage);
    expect(s.basis).toBe('team');
    expect(s.slope).toBeCloseTo(771.4286, 3);
    const few = revenueSensitivity(A.quality.slice(0, 4), A.kpis.slice(0, 4), 'test_coverage', MONTHS.slice(0, 4), fits.test_coverage);
    expect(few.status).toBe('insufficient_data');
    expect(few.basis).toBe('team');
  });

  it('BI-LIB-005: the money summary labels a company-wide gain "company"; what-if projects with the company-wide slope', () => {
    const fits = pooledRevenueFits([A, B, FLAT], 'measured');
    const w = fitWindow(FLAT.quality, FLAT.kpis);
    const sens = allRevenueSensitivities(FLAT.quality, FLAT.kpis, w.months, fits);
    const cov = sens.find(x => x.metric === 'test_coverage')!;
    const current = { test_coverage: { value: 90.2, month: '2026-06' } };
    const targets = { test_coverage: { good: 92, lowerIsBetter: false, scope: 'company', validFrom: null } };
    const stake = revenueAtStake(sens, current, targets);
    expect(stake.monthly).toBeCloseTo((cov.slope as number) * (92 - 90.2), 4);
    const summary = buildMoneySummary({
      sensitivities: sens, stake, debt: { openItems: 0, itemsWithImpact: 0, monthly: null, annual: null, components: null, parameters: [], reason: 'none' },
      debtItems: [], incidents: { month: null, monthly: null, annual: null, inputs: {}, parameters: [], reason: 'x' },
      support: { month: null, monthly: null, annual: null, inputs: {}, parameters: [], reason: 'x' },
      churn: { month: null, monthly: null, annual: null, inputs: {}, parameters: [], reason: 'x' },
      availabilityTarget: null, config: { ...FINANCIAL_DEFAULTS }, defaultsUsed: [],
    });
    expect(summary.gains[0].confidence).toBe('company');
    expect(summary.goingNow[0].sentence).toMatch(/company-wide link/);
    const wi = whatIf(cov, 1, current.test_coverage);
    expect(wi.enabled).toBe(true);
    expect(wi.monthly).toBeCloseTo(cov.slope as number, 6);
  });

  it('BI-LIB-007: a metric already at its target does not hide a gap in a metric that moves with it', () => {
    const fitted = (metric: string, slope: number, p: number) => ({
      metric, label: metric, unit: 'u', lowerIsBetter: false, status: 'fitted' as const, n: 12, monthsMissing: 0, firstMonth: 'a', lastMonth: 'b',
      slope, ciLow: slope / 2, ciHigh: slope * 1.5, r: 0.9, r2: 0.81, pValue: p, significant: true, minX: 0, maxX: 100, reason: null, basis: 'team' as const,
    });
    // deployment frequency has the smallest p but is at its target; defect escape rate (same movement) is 5 points above.
    const sens = [fitted('deployment_frequency', 5000, 0.00001), { ...fitted('defect_escape_rate', -9000, 0.0001), lowerIsBetter: true }];
    const cur = { deployment_frequency: { value: 33, month: 'm' }, defect_escape_rate: { value: 10, month: 'm' } };
    const tg = { deployment_frequency: { good: 21.67, lowerIsBetter: false, scope: 'default', validFrom: null }, defect_escape_rate: { good: 5, lowerIsBetter: true, scope: 'default', validFrom: null } };
    const r = revenueAtStake(sens, cur, tg, () => 0.95);
    expect(r.monthly).toBe(45000);
    expect(r.rows.find(x => x.metric === 'defect_escape_rate')!.included).toBe(true);
    expect(r.rows.find(x => x.metric === 'deployment_frequency')!.overlapsWith).toBe('defect_escape_rate');
  });

  it('BI-LIB-006: deployment frequency (per month) is compared with the weekly KPI target × 52 ÷ 12', () => {
    const d = REVENUE_QUALITY_METRICS.find(m => m.key === 'deployment_frequency')!;
    expect(d.targetKey).toBe('deployment_frequency_per_week');
    expect(d.targetScale).toBeCloseTo(52 / 12, 12);
    expect(WEEKS_PER_MONTH * 5).toBeCloseTo(21.6667, 4);
  });
});

describe('Rule-based correlation summary (no AI provider)', () => {
  const months = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
  const pair = (q: string, k: string, r: number, p: number, qv: number) => ({ quality_metric: q, business_kpi: k, pearson_correlation: r, p_value: p, q_value: qv, sample_size: 12, is_significant: qv < 0.05 });

  it('BI-LIB-010: the critical |r| for p < 0.05 with 12 months is about 0.576', () => {
    expect(criticalR(12)).toBeCloseTo(0.5760, 3);
    expect(criticalR(2)).toBeNull();
  });

  it('BI-LIB-011: no significant pair: names the strongest, explains why, and says what it does not claim', () => {
    const html = correlationSummaryHtml({ correlations: [pair('change_failure_rate', 'csat_score', -0.605, 0.037, 0.942), pair('test_coverage', 'nps_score', 0.2, 0.5, 0.9)], pairedMonths: months });
    expect(html).toContain('<strong>0</strong> significant');
    expect(html).toContain('change failure rate and CSAT');
    expect(html).toContain('0.58');
    expect(html).toMatch(/Correlation is not causation/);
  });

  it('BI-LIB-012: significant pairs are listed in plain words with direction, r, q and months; a mostly-significant matrix warns of a shared trend', () => {
    const html = correlationSummaryHtml({ correlations: [pair('test_coverage', 'nps_score', 0.91, 0.0001, 0.0002), pair('defect_escape_rate', 'churn_rate', 0.88, 0.0002, 0.0003)], pairedMonths: months });
    expect(html).toContain('months with higher test coverage tended to have higher NPS');
    expect(html).toContain('r +0.91');
    expect(html).toMatch(/shared movement/);
    expect(correlationSummaryHtml({ correlations: [], pairedMonths: months.slice(0, 3) })).toMatch(/at least 6 months/);
  });
});

describe('Sample financial rates (demo data, Populate metrics)', () => {
  it('BI-LIB-020: a filled team gets the company cost rates plus its own revenue per user and revenue per minute', () => {
    const t = teamDefFor({ id: 'mft-team-payments-core-116', name: 'Payments Core', platform: null });
    const r = sampleRates(t, false);
    expect(r.hourly).toBe(SAMPLE_COST_RATES.developer_hourly_rate);
    expect(r.ticket).toBe(SAMPLE_COST_RATES.support_ticket_cost);
    expect(r.sla).toBe(SAMPLE_COST_RATES.sla_breach_penalty);
    expect(r.rpu).toBeGreaterThanOrEqual(18);
    expect(r.rpu).toBeLessThanOrEqual(48);
    expect(r.downtime).toBe(Math.max(1, Math.round(t.revenue / 43200)));
    expect(sampleRates(t, true)).toEqual({ hourly: 85, ticket: 30, rpu: 42, downtime: 180, sla: 2500 });
  });
});

// Keep the MonthlyRow type in use for readers of this file.
export type _Row = MonthlyRow;
