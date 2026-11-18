import { olsFit, studentTQuantile, studentTTwoSidedP } from '../../server/lib/stats';
import {
  REVENUE_MIN_PAIRED_MONTHS, REVENUE_OVERLAP_R, revenueSensitivity, allRevenueSensitivities, fitWindow, latestValues,
  revenueAtStake, debtRevenueAtRisk, incidentDowntimeCost, churnRevenueLoss, whatIf, rollUpRevenue, metricOverlap,
  supportTicketCost, downtimeGapGain, buildMoneySummary,
  type MonthlyRow, type RevenueSensitivity, type TargetToday,
} from '../../server/lib/revenueImpact';
import { FINANCIAL_DEFAULTS, techDebtCostOfDelay, techDebtRoi } from '../../server/lib/metricFormulas';

/**
 * Revenue impact math (server/lib/stats.ts, server/lib/revenueImpact.ts) against values computed
 * by hand. Reference data set: x = 1..6, y = 2, 4, 5, 4, 5, 7
 *   x̄ = 3.5, ȳ = 4.5, Sxx = 17.5, Sxy = 13.5, Syy = 13.5
 *   b = 13.5 / 17.5 = 0.7714286, a = 4.5 − b·3.5 = 1.8
 *   r = 13.5 / √(17.5·13.5) = 0.8783101, R² = 0.7714286
 *   SSE = Syy − b·Sxy = 3.0857143, s² = SSE / 4 = 0.7714286, SE(b) = √(s² / Sxx) = 0.2099563
 *   t = b / SE = 3.6742346, df = 4, two-sided p = 0.0213116 (closed form of the t(4) CDF)
 *   t(0.975, 4) = 2.7764451, CI = b ± 2.7764451 · 0.2099563 = [0.1884966, 1.3543606]
 */

const X = [1, 2, 3, 4, 5, 6];
const Y = [2, 4, 5, 4, 5, 7];

describe('OLS fit and Student-t (server/lib/stats.ts)', () => {
  it('REV-LIB-001: slope, intercept, r, R², SE, t, p and the 95% interval match the hand computation', () => {
    const f = olsFit(X, Y)!;
    expect(f.n).toBe(6);
    expect(f.df).toBe(4);
    expect(f.slope).toBeCloseTo(0.7714286, 6);
    expect(f.intercept).toBeCloseTo(1.8, 6);
    expect(f.r).toBeCloseTo(0.8783101, 6);
    expect(f.r2).toBeCloseTo(0.7714286, 6);
    expect(f.slopeSe).toBeCloseTo(0.2099563, 6);
    expect(f.t).toBeCloseTo(3.6742346, 5);
    expect(f.pValue).toBeCloseTo(0.0213116, 6);
    expect(f.tCritical).toBeCloseTo(2.7764451, 6);
    expect(f.ciLow).toBeCloseTo(0.1884966, 6);
    expect(f.ciHigh).toBeCloseTo(1.3543606, 6);
    expect([f.minX, f.maxX]).toEqual([1, 6]);
  });

  it('REV-LIB-002: t quantiles match the tables (df 1, 4, 10, 30) and invert the p-value', () => {
    expect(studentTQuantile(0.05, 1)).toBeCloseTo(12.7062047, 5);
    expect(studentTQuantile(0.05, 4)).toBeCloseTo(2.7764451, 6);
    expect(studentTQuantile(0.05, 10)).toBeCloseTo(2.2281389, 6);
    expect(studentTQuantile(0.05, 30)).toBeCloseTo(2.0422725, 6);
    expect(studentTTwoSidedP(studentTQuantile(0.01, 7), 7)).toBeCloseTo(0.01, 9);
  });

  it('REV-LIB-003: no fit for n < 3 or zero variance; a perfect line has p = 0 and a zero-width interval', () => {
    expect(olsFit([1, 2], [3, 4])).toBeNull();
    expect(olsFit([5, 5, 5, 5], [1, 2, 3, 4])).toBeNull();
    expect(olsFit([1, 2, 3, 4], [7, 7, 7, 7])).toBeNull();
    const p = olsFit([1, 2, 3, 4], [10, 20, 30, 40])!;
    expect(p.slope).toBeCloseTo(10, 9);
    expect(p.pValue).toBe(0);
    expect(p.ciLow).toBeCloseTo(10, 9);
    expect(p.ciHigh).toBeCloseTo(10, 9);
  });

  it('REV-LIB-004: scaling y scales the slope and its interval; scaling x divides them', () => {
    const f = olsFit(X, Y.map(v => v * 1000 + 100000))!;
    expect(f.slope).toBeCloseTo(771.4286, 3);
    expect(f.ciLow).toBeCloseTo(188.4966, 3);
    expect(f.ciHigh).toBeCloseTo(1354.3606, 3);
    expect(f.pValue).toBeCloseTo(0.0213116, 6);
    const g = olsFit(X.map(v => v * 2), Y)!;
    expect(g.slope).toBeCloseTo(0.7714286 / 2, 6);
  });
});

// Six months of coverage 70..75 % and revenue 102 000 .. 107 000 (the reference set, scaled).
const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
const quality = (extra: Partial<Record<string, number[]>> = {}, source = 'manual'): MonthlyRow[] =>
  months.map((m, i) => ({
    month_year: m, data_source: source,
    test_coverage: 69 + X[i],
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, (v as number[])[i]])),
  }));
const kpis = (source = 'manual', revenue = Y.map(v => v * 1000 + 100000)): MonthlyRow[] =>
  months.map((m, i) => ({ month_year: m, data_source: source, monthly_revenue: revenue[i], churn_rate: 2 + i * 0.1 }));

describe('Revenue sensitivity (revenueSensitivity)', () => {
  it('REV-LIB-010: $ per month for +1 percentage point of coverage, with n, r, R², p and the 95% interval', () => {
    const s = revenueSensitivity(quality(), kpis(), 'test_coverage');
    expect(s.status).toBe('fitted');
    expect(s.n).toBe(6);
    expect(s.slope).toBeCloseTo(771.4286, 3);
    expect(s.ciLow).toBeCloseTo(188.4966, 3);
    expect(s.ciHigh).toBeCloseTo(1354.3606, 3);
    expect(s.r).toBeCloseTo(0.8783101, 6);
    expect(s.r2).toBeCloseTo(0.7714286, 6);
    expect(s.pValue).toBeCloseTo(0.0213116, 6);
    expect(s.significant).toBe(true);
    expect([s.firstMonth, s.lastMonth]).toEqual(['2026-01', '2026-06']);
  });

  it(`REV-LIB-011: fewer than ${REVENUE_MIN_PAIRED_MONTHS} paired months → no slope, with the months missing`, () => {
    const q = quality().slice(0, 4);
    const k = kpis();
    const s = revenueSensitivity(q, k, 'test_coverage');
    expect(s.status).toBe('insufficient_data');
    expect(s.n).toBe(4);
    expect(s.monthsMissing).toBe(2);
    expect(s.slope).toBeNull();
    expect(s.significant).toBe(false);
    expect(s.reason).toContain('2 more');
    // A month with revenue missing is not a pair.
    const k2 = kpis().map((r, i) => (i === 0 ? { ...r, monthly_revenue: null } : r));
    expect(revenueSensitivity(quality(), k2, 'test_coverage').n).toBe(5);
  });

  it('REV-LIB-012: significance gating: a weak association (p ≥ 0.05) is fitted but not significant', () => {
    // revenue unrelated to coverage: r = 0.0857..., p ≈ 0.87
    const s = revenueSensitivity(quality(), kpis('manual', [5, 1, 4, 6, 2, 5].map(v => v * 1000)), 'test_coverage');
    expect(s.status).toBe('fitted');
    expect(s.pValue!).toBeGreaterThan(0.05);
    expect(s.significant).toBe(false);
    expect(s.ciLow! < 0 && s.ciHigh! > 0).toBe(true);
    expect(s.reason).toMatch(/Not significant/);
  });

  it('REV-LIB-013: a metric that never changed has no slope (no_variance)', () => {
    const s = revenueSensitivity(quality({ mttr_hours: [4, 4, 4, 4, 4, 4] }), kpis(), 'mttr_hours');
    expect(s.status).toBe('no_variance');
    expect(s.slope).toBeNull();
  });

  it('REV-LIB-014: sample and measured months are never fitted together (latest kind of source wins)', () => {
    const older: MonthlyRow[] = ['2025-01', '2025-02', '2025-03'].map((m, i) => ({ month_year: m, data_source: 'manual', test_coverage: 90 + i }));
    const olderK: MonthlyRow[] = ['2025-01', '2025-02', '2025-03'].map((m) => ({ month_year: m, data_source: 'manual', monthly_revenue: 1_000_000 }));
    const q = [...older, ...quality({}, 'synthetic')];
    const k = [...olderK, ...kpis('manual')];
    const w = fitWindow(q, k);
    expect(w.source).toBe('sample');
    expect(w.months).toEqual(months);
    expect(w.excludedMonths).toBe(3);
    const s = allRevenueSensitivities(q, k).find(x => x.metric === 'test_coverage')!;
    expect(s.slope).toBeCloseTo(771.4286, 3);
    expect(latestValues(q, w.months).test_coverage).toEqual({ value: 75, month: '2026-06' });
  });
});

const target = (good: number, lowerIsBetter: boolean): TargetToday => ({ good, lowerIsBetter, scope: 'company', validFrom: '2026-01-01T00:00:00.000Z' });
const fitted = (metric: string, slope: number, lo: number, hi: number, p: number, label = metric): RevenueSensitivity => ({
  metric, label, unit: 'unit', lowerIsBetter: false, status: 'fitted', n: 12, monthsMissing: 0, firstMonth: '2025-12', lastMonth: '2026-11',
  slope, ciLow: lo, ciHigh: hi, r: 0.8, r2: 0.64, pValue: p, significant: p < 0.05, minX: 50, maxX: 80,
  reason: p < 0.05 ? null : 'Not significant',
});

describe('Monthly revenue at stake (revenueAtStake)', () => {
  it('REV-LIB-020: slope × gap to the target valid today, direction-aware, with the summed interval and ×12', () => {
    const sens = [
      fitted('test_coverage', 1000, 400, 1600, 0.001),     // higher is better: 70 → 80 = +10
      fitted('defect_escape_rate', -2000, -3000, -1000, 0.01), // lower is better: 12 → 5 = −7
    ];
    const cur = { test_coverage: { value: 70, month: '2026-11' }, defect_escape_rate: { value: 12, month: '2026-11' } };
    const tg = { test_coverage: target(80, false), defect_escape_rate: target(5, true) };
    const r = revenueAtStake(sens, cur, tg);
    const cov = r.rows.find(x => x.metric === 'test_coverage')!;
    const esc = r.rows.find(x => x.metric === 'defect_escape_rate')!;
    expect(cov.gap).toBe(10);
    expect(cov.monthly).toBe(10000);
    expect([cov.monthlyLow, cov.monthlyHigh]).toEqual([4000, 16000]);
    expect(esc.gap).toBe(-7);
    expect(esc.monthly).toBe(14000);
    expect([esc.monthlyLow, esc.monthlyHigh]).toEqual([7000, 21000]); // (−1000·−7, −3000·−7) ordered
    expect(r.metricsIncluded).toBe(2);
    expect(r.monthly).toBe(24000);
    expect([r.monthlyLow, r.monthlyHigh]).toEqual([11000, 37000]);
    expect([r.annual, r.annualLow, r.annualHigh]).toEqual([288000, 132000, 444000]);
  });

  it('REV-LIB-021: a met target adds 0; a non-significant slope, a missing target or value add nothing, with the reason', () => {
    const sens = [
      fitted('test_coverage', 1000, 400, 1600, 0.001),
      fitted('code_quality_score', 900, -100, 1900, 0.2),
      fitted('deployment_frequency', 500, 100, 900, 0.01),
      fitted('mttr_hours', -800, -1200, -400, 0.02),
    ];
    const cur = { test_coverage: { value: 85, month: '2026-11' }, code_quality_score: { value: 60, month: '2026-11' }, deployment_frequency: { value: 3, month: '2026-11' }, mttr_hours: null };
    const tg = { test_coverage: target(80, false), code_quality_score: target(80, false), deployment_frequency: null, mttr_hours: target(2, true) };
    const r = revenueAtStake(sens, cur, tg);
    const by = (m: string) => r.rows.find(x => x.metric === m)!;
    expect(by('test_coverage')).toMatchObject({ included: true, targetMet: true, gap: 0, monthly: 0 });
    expect(by('code_quality_score')).toMatchObject({ included: false, reason: 'Slope not significant', monthly: null });
    expect(by('deployment_frequency')).toMatchObject({ included: false, reason: 'No KPI target in the same unit' });
    expect(by('mttr_hours')).toMatchObject({ included: false, reason: 'No current value' });
    expect(r.monthly).toBe(0);
  });

  it('REV-LIB-022: no significant slope → no figure ("—") with the reason; no fitted slope → months needed', () => {
    const none = revenueAtStake([fitted('test_coverage', 1000, -10, 2010, 0.3)], { test_coverage: { value: 70, month: '2026-11' } }, { test_coverage: target(80, false) });
    expect(none.monthly).toBeNull();
    expect(none.annual).toBeNull();
    expect(none.reason).toMatch(/No quality metric has a significant association/);
    const empty = revenueAtStake([revenueSensitivity([], [], 'test_coverage')], {}, {});
    expect(empty.monthly).toBeNull();
    expect(empty.reason).toMatch(/at least 6 months/);
  });

  it(`REV-LIB-023: a metric overlapping a counted one (|r| ≥ ${REVENUE_OVERLAP_R}) is shown but not added; strongest evidence first`, () => {
    const sens = [
      fitted('code_quality_score', 800, 300, 1300, 0.004, 'Code quality'),
      fitted('test_coverage', 1000, 400, 1600, 0.001, 'Test coverage'),
      fitted('lead_time_days', -500, -900, -100, 0.03, 'Lead time'),
    ];
    const cur = { test_coverage: { value: 70, month: 'm' }, code_quality_score: { value: 70, month: 'm' }, lead_time_days: { value: 5, month: 'm' } };
    const tg = { test_coverage: target(80, false), code_quality_score: target(80, false), lead_time_days: target(3, true) };
    const overlap = (a: string, b: string) => ([a, b].sort().join() === 'code_quality_score,test_coverage' ? 0.95 : 0.2);
    const r = revenueAtStake(sens, cur, tg, overlap);
    const cq = r.rows.find(x => x.metric === 'code_quality_score')!;
    expect(cq.included).toBe(false);
    expect(cq.overlapsWith).toBe('test_coverage');
    expect(cq.monthly).toBe(8000); // still shown
    expect(cq.reason).toContain('Overlaps with Test coverage (r = 0.95)');
    expect(r.metricsIncluded).toBe(2);
    expect(r.monthly).toBe(10000 + 1000); // coverage 1000×10 + lead time −500×−2
  });

  it('REV-LIB-024: metricOverlap is the Pearson r of two metric series over the months used', () => {
    const q = quality({ code_quality_score: [60, 62, 64, 66, 68, 70] });
    expect(metricOverlap(q, 'test_coverage', 'code_quality_score', months)).toBeCloseTo(1, 9);
    expect(metricOverlap(q, 'test_coverage', 'mttr_hours', months)).toBeNull();
  });
});

describe('Revenue and cost at risk: debt, incidents, churn', () => {
  const cfg = { ...FINANCIAL_DEFAULTS };
  const items = [
    // 10×25 + 30×100 + 1000×50×2% + 1×1000 = 250 + 3000 + 1000 + 1000 = 5250
    { status: 'open', affected_users: 1000, support_tickets_monthly: 10, downtime_minutes_monthly: 30, revenue_impact_percent: 2, sla_breaches_monthly: 1, estimated_effort_hours: 40 },
    // 4×25 = 100
    { status: 'in_progress', support_tickets_monthly: 4 },
    { status: 'open' }, // no impact data: not counted
    { status: 'resolved', support_tickets_monthly: 999 },
    { status: 'wont_fix', support_tickets_monthly: 999 },
  ];

  it('REV-LIB-030: open items with impact data, by component, with the parameters used and their default flags', () => {
    const d = debtRevenueAtRisk(items, cfg, ['support_ticket_cost', 'downtime_cost_per_minute', 'revenue_per_user_monthly', 'sla_breach_penalty']);
    expect(d.openItems).toBe(3);
    expect(d.itemsWithImpact).toBe(2);
    expect(d.components).toEqual({ revenueLoss: 1000, support: 350, downtime: 3000, sla: 1000 });
    expect(d.monthly).toBe(5350);
    expect(d.annual).toBe(64200);
    expect(d.parameters.every(p => p.isDefault)).toBe(true);
    const configured = debtRevenueAtRisk(items, { ...cfg, support_ticket_cost: 40 }, ['downtime_cost_per_minute']);
    expect(configured.components!.support).toBe(560);
    expect(configured.parameters.find(p => p.key === 'support_ticket_cost')).toMatchObject({ value: 40, isDefault: false });
  });

  it('REV-LIB-031: the same per-item cost as the Technical debt page (techDebtRoi)', () => {
    expect(techDebtCostOfDelay(items[0], cfg).monthly).toBe(5250);
    expect(techDebtRoi(items[0], cfg)).toEqual({ investment: 3000, monthlyCost: 5250, annualSavings: 63000, roi: 2000, paybackMonths: 3000 / 5250 });
  });

  it('REV-LIB-032: no open item with impact data → no figure with the reason', () => {
    expect(debtRevenueAtRisk([{ status: 'open' }], cfg, []).monthly).toBeNull();
    expect(debtRevenueAtRisk([{ status: 'open' }], cfg, []).reason).toMatch(/No open item has impact data/);
    expect(debtRevenueAtRisk([], cfg, []).reason).toBe('No open technical-debt items.');
  });

  it('REV-LIB-033: incident downtime cost of the latest month with downtime; churn loss = churn % × revenue', () => {
    const ctx = [{ month_year: '2026-10', downtime_minutes: 50 }, { month_year: '2026-11', downtime_minutes: null }, { month_year: '2026-09', downtime_minutes: 10 }];
    const inc = incidentDowntimeCost(ctx, cfg, ['downtime_cost_per_minute']);
    expect(inc).toMatchObject({ month: '2026-10', monthly: 5000, annual: 60000 });
    expect(inc.parameters[0]).toMatchObject({ key: 'downtime_cost_per_minute', value: 100, isDefault: true });
    expect(incidentDowntimeCost([], cfg, []).monthly).toBeNull();
    const ch = churnRevenueLoss(kpis());
    expect(ch.month).toBe('2026-06');
    expect(ch.monthly).toBeCloseTo(0.025 * 107000, 6);
    expect(churnRevenueLoss([{ month_year: '2026-01', churn_rate: 2 }]).monthly).toBeNull();
  });
});

describe('What-if and roll-up', () => {
  it('REV-LIB-040: projected change = slope × change with the interval, ×12; extrapolation flagged', () => {
    const s = revenueSensitivity(quality(), kpis(), 'test_coverage');
    const w = whatIf(s, 2, { value: 75, month: '2026-06' });
    expect(w.enabled).toBe(true);
    expect(w.monthly).toBeCloseTo(1542.857, 3);
    expect(w.monthlyLow).toBeCloseTo(376.993, 3);
    expect(w.monthlyHigh).toBeCloseTo(2708.721, 3);
    expect(w.annual).toBeCloseTo(18514.286, 3);
    expect(w.projectedValue).toBe(77);
    expect(w.extrapolation).toBe(true); // recorded 70..75
    const down = whatIf(s, -1, { value: 75, month: '2026-06' });
    expect(down.monthlyLow!).toBeLessThan(down.monthlyHigh!);
    expect(down.extrapolation).toBe(false);
  });

  it('REV-LIB-041: disabled for a non-significant slope or missing data, with the reason', () => {
    const weak = revenueSensitivity(quality(), kpis('manual', [5, 1, 4, 6, 2, 5].map(v => v * 1000)), 'test_coverage');
    const w = whatIf(weak, 5, null);
    expect(w.enabled).toBe(false);
    expect(w.monthly).toBeNull();
    expect(w.reason).toMatch(/no significant association/);
    const none = whatIf(revenueSensitivity([], [], 'test_coverage'), 5, null);
    expect(none.enabled).toBe(false);
    expect(none.reason).toMatch(/needs 6/);
  });

  it('REV-LIB-042: roll-up sums the team figures that exist and lists the teams without them', () => {
    const team = (id: string, stake: number | null, debt: number | null) => ({
      teamId: id, teamName: id.toUpperCase(), departmentId: 'd', departmentName: 'D', sampleData: false,
      stake: { monthly: stake, monthlyLow: stake === null ? null : stake / 2, monthlyHigh: stake === null ? null : stake * 2, reason: stake === null ? 'No significant slope' : null, metricsIncluded: stake === null ? 0 : 1 },
      debt: { monthly: debt, reason: debt === null ? 'No open technical-debt items.' : null },
    });
    const r = rollUpRevenue([team('a', 1000, 50), team('b', null, 25), team('c', 3000, null)]);
    expect(r.teams).toBe(3);
    expect([r.stake.monthly, r.stake.monthlyLow, r.stake.monthlyHigh, r.stake.annual]).toEqual([4000, 2000, 8000, 48000]);
    expect(r.stake.contributing).toEqual(['a', 'c']);
    expect(r.stake.lacking).toEqual([{ teamId: 'b', teamName: 'B', reason: 'No significant slope' }]);
    expect([r.debt.monthly, r.debt.annual]).toEqual([75, 900]);
    expect(r.debt.lacking.map(x => x.teamId)).toEqual(['c']);
    const empty = rollUpRevenue([team('b', null, null)]);
    expect(empty.stake.monthly).toBeNull();
    expect(empty.debt.monthly).toBeNull();
  });
});

describe('Money summary (buildMoneySummary)', () => {
  const cfg = { ...FINANCIAL_DEFAULTS };

  it('REV-LIB-050: support ticket cost and downtime above the availability target', () => {
    const sup = supportTicketCost([{ month_year: '2026-05', support_ticket_volume: 10 }, { month_year: '2026-06', support_ticket_volume: 40 }], cfg, ['support_ticket_cost']);
    expect(sup).toMatchObject({ month: '2026-06', monthly: 1000, annual: 12000 });
    expect(sup.parameters[0].isDefault).toBe(true);
    expect(supportTicketCost([], cfg, []).monthly).toBeNull();
    // June: 30 days = 43 200 min; 99.9 % allows 43.2 min; 100 recorded → 56.8 min over × $100
    const inc = incidentDowntimeCost([{ month_year: '2026-06', downtime_minutes: 100 }], cfg, []);
    const gap = downtimeGapGain(inc, 99.9, cfg)!;
    expect(gap.allowedMinutes).toBeCloseTo(43.2, 9);
    expect(gap.minutesOver).toBeCloseTo(56.8, 9);
    expect(gap.monthly).toBeCloseTo(5680, 6);
    expect(downtimeGapGain(incidentDowntimeCost([{ month_year: '2026-06', downtime_minutes: 20 }], cfg, []), 99.9, cfg)!.monthly).toBe(0);
    expect(downtimeGapGain(inc, null, cfg)).toBeNull();
  });

  it('REV-LIB-051: going-now lines by cause, gains ranked biggest first with fix cost, return and payback; overlaps counted once', () => {
    const sens = [
      fitted('test_coverage', 1000, 400, 1600, 0.001, 'Test coverage'),
      fitted('code_quality_score', 800, 300, 1300, 0.004, 'Code quality'),
      fitted('defect_escape_rate', 500, 100, 900, 0.03, 'Defect escape rate'),
    ];
    const cur = { test_coverage: { value: 70, month: '2026-06' }, code_quality_score: { value: 70, month: '2026-06' }, defect_escape_rate: { value: 10, month: '2026-06' } };
    const tg = { test_coverage: target(80, false), code_quality_score: target(80, false), defect_escape_rate: target(5, true) };
    const stake = revenueAtStake(sens, cur, tg, (a, b) => ([a, b].sort().join() === 'code_quality_score,test_coverage' ? 0.9 : 0));
    const items = [
      { id: 'd1', title: 'Flaky checkout', status: 'open', support_tickets_monthly: 40, estimated_effort_hours: 10 }, // 1000/mo, fix 750
      { id: 'd2', title: 'Old SDK', status: 'open', sla_breaches_monthly: 2 },                                     // 2000/mo, no estimate
      { id: 'd3', title: 'Done', status: 'resolved', sla_breaches_monthly: 9 },
    ];
    const debt = debtRevenueAtRisk(items, cfg, []);
    const incidents = incidentDowntimeCost([{ month_year: '2026-06', downtime_minutes: 100 }], cfg, []);
    const support = supportTicketCost([{ month_year: '2026-06', support_ticket_volume: 40 }], cfg, []);
    const churn = churnRevenueLoss([{ month_year: '2026-06', churn_rate: 2, monthly_revenue: 100000 }]);
    const m = buildMoneySummary({ sensitivities: sens, stake, debt, debtItems: items, incidents, support, churn, availabilityTarget: 99.9, config: cfg, defaultsUsed: ['developer_hourly_rate'] });

    expect(m.goingNow.map(l => [l.key, l.monthly])).toEqual([
      ['quality_gaps', 7500], ['debt', 3000], ['downtime', 10000], ['support', 1000], ['churn', 2000],
    ]);
    // net stake: coverage +10 000, escape rate 500 × (5 − 10) = −2 500 (counted in the net figure).
    // Gains: coverage 1000×10 counted; code quality overlaps it (not a separate gain); escape rate 500×−5 < 0 left out
    expect(m.gains.map(g => [g.id, Math.round(g.monthly)])).toEqual([
      ['quality:test_coverage', 10000], ['downtime', 5680], ['debt:d2', 2000], ['debt:d1', 1000],
    ]);
    const cov = m.gains[0];
    expect(cov).toMatchObject({ confidence: 'strong', monthlyLow: 4000, monthlyHigh: 16000, annual: 120000, movesWith: ['Code quality'], fixCost: null });
    const d1 = m.gains.find(g => g.id === 'debt:d1')!;
    expect(d1).toMatchObject({ fixCost: 750, returnPerDollar: 16, paybackMonths: 0.75, usesDefaults: true, confidence: 'estimate' });
    expect(m.gainsLeftOut).toHaveLength(1);
    expect(m.gainsLeftOut[0].label).toBe('Defect escape rate');
    expect(m.priorities.byGain).toEqual(['quality:test_coverage', 'downtime', 'debt:d2', 'debt:d1']);
    expect(m.priorities.byReturn).toEqual(['debt:d1']);
  });

  it('REV-LIB-052: missing inputs give "—" (null) with a reason, never 0', () => {
    const empty = buildMoneySummary({
      sensitivities: [revenueSensitivity([], [], 'test_coverage')], stake: revenueAtStake([revenueSensitivity([], [], 'test_coverage')], {}, {}),
      debt: debtRevenueAtRisk([], cfg, []), debtItems: [], incidents: incidentDowntimeCost([], cfg, []), support: supportTicketCost([], cfg, []),
      churn: churnRevenueLoss([]), availabilityTarget: 99.9, config: cfg, defaultsUsed: [],
    });
    for (const l of empty.goingNow) {
      expect(l.monthly).toBeNull();
      expect(l.reason).toBeTruthy();
    }
    expect(empty.gains).toEqual([]);
  });
});
