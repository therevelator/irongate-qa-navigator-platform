import {
  buildTimeRule, changeFailureRule, coverageGapRule, effectText, escapeWithFallingCoverageRule, failingStageRule, flakyTestsRule,
  historyEffect, MAX_RECOMMENDATIONS, mttrRule, ownBest, recommend, scoreOf, sizingDriftRule, slowTestsRule, technicalDebtRule,
  valueWeeksAgo, wellbeingBlockedRule, type MetricFacts, type TeamFacts,
} from '../../server/lib/recommendations/rules';

/**
 * Recommendations rules (server/lib/recommendations/rules.ts): each rule on facts built by hand,
 * with the numbers, tests, files and stages it must name, its next step, the expected effect range
 * and when it must stay silent; then the ranking. Pure: no database.
 */

const AS_OF = '2026-11-20';
const DAY = 86_400_000;
const dayOf = (weeksAgo: number) => new Date(Date.parse(`${AS_OF}T00:00:00Z`) - weeksAgo * 7 * DAY).toISOString().slice(0, 10);

interface MetricOpts {
  label?: string; unit?: string; lowerIsBetter?: boolean | null; target?: { good: number; warning: number } | null;
  /** value(weeksAgo) for 26 weekly points. */
  series: (weeksAgo: number) => number;
  forecast?: Partial<NonNullable<MetricFacts['forecast']>>;
}
function metric(key: string, o: MetricOpts): MetricFacts {
  const weekly = Array.from({ length: 26 }, (_, i) => 25 - i).map((w) => ({ x: -w, value: o.series(w), n: 7, from: dayOf(w), to: dayOf(w) }));
  return {
    key, label: o.label ?? key, unit: o.unit ?? '%', lowerIsBetter: o.lowerIsBetter === undefined ? false : o.lowerIsBetter,
    current: o.series(0), currentDay: AS_OF, target: o.target === undefined ? null : o.target, weekly,
    forecast: o.forecast ? { status: 'ok', trend: 'flat', outlook: null, crossingDay: null, slopePerWeek: 0, endValue: null, endDay: null, confidence: 'high', ...o.forecast } : null,
  };
}
function facts(metrics: MetricFacts[], extra: Partial<TeamFacts> = {}): TeamFacts {
  return { teamId: 't', teamName: 'Lending Journey', asOf: AS_OF, metrics: Object.fromEntries(metrics.map((m) => [m.key, m])), flaky: null, coverage: null, stages: null, wellbeing: null, debt: [], ...extra };
}

// Lending-like metrics: worsening over 26 weeks.
const coverage = (opts: Partial<MetricOpts> = {}) => metric('test_coverage', { label: 'Test coverage', target: { good: 80, warning: 70 }, series: (w) => 56 + w * 0.8, forecast: { trend: 'worsening', outlook: 'stays_off', endValue: 48, endDay: '2027-01-15' }, ...opts });
const escape = metric('defect_escape_rate', { label: 'Defect escape rate', lowerIsBetter: true, target: { good: 5, warning: 10 }, series: (w) => 21 - w * 0.4, forecast: { trend: 'worsening', outlook: 'stays_off', endValue: 25.6, endDay: '2027-01-15' } });
const flakiness = metric('test_flakiness_rate', { label: 'Test flakiness rate', lowerIsBetter: true, target: { good: 2, warning: 5 }, series: (w) => 6 - w * 0.12, forecast: { trend: 'worsening', outlook: 'stays_off', endValue: 7.6, endDay: '2027-01-15' } });

describe('helpers', () => {
  test('value weeks ago and own best (in the metric direction)', () => {
    const c = coverage();
    expect(valueWeeksAgo(c, 12)).toEqual({ value: 56 + 12 * 0.8, day: dayOf(12) });
    expect(valueWeeksAgo({ ...c, weekly: [] }, 12)).toBeNull();
    expect(ownBest(c)).toEqual({ value: 56 + 25 * 0.8, day: dayOf(25) });
    expect(ownBest(escape)?.value).toBe(21 - 25 * 0.4);
  });

  test('history effect: half-way to the team’s best (low) and its best (high); the target when the best bettered it', () => {
    const e = historyEffect(coverage())!;
    expect(e).toMatchObject({ kind: 'improve', from: 56, low: 66, high: 76 });
    expect(e.basis).toMatch(/own best weekly level in the last 26 weeks \(76% in/);
    // Escape best 11 % is worse than the target 5 %: back to its best.
    expect(historyEffect(escape)).toMatchObject({ from: 21, high: 11, low: 16 });
    // A team that bettered the target: the target is the high end.
    const ttr = metric('mttr_hours', { label: 'MTTR', unit: 'h', lowerIsBetter: true, target: { good: 2, warning: 8 }, series: (w) => 6 - w * 0.25 });
    expect(historyEffect(ttr)).toMatchObject({ from: 6, high: 2, low: 4 });
    expect(historyEffect(ttr)!.basis).toMatch(/^the target \(≤ 2 h\)/);
  });

  test('history effect "hold": current is the best and the forecast worsens', () => {
    const m = metric('test_coverage', { label: 'Test coverage', target: { good: 80, warning: 70 }, series: (w) => 85 - w * 0.2, forecast: { trend: 'worsening', outlook: 'on_track', endValue: 80, endDay: '2027-01-15' } });
    // Rising series: current 85 is the best → nothing to regain; flat or improving forecast → no effect.
    expect(historyEffect({ ...m, forecast: { ...m.forecast!, trend: 'improving' } })).toBeNull();
    expect(historyEffect(m)).toMatchObject({ kind: 'hold', from: 80, low: 82.5, high: 85 });
    expect(effectText(historyEffect(m)!)).toBe('Test coverage holds at 82.5%–85% instead of about 80% in 6–8 weeks');
  });

  test('effect wording', () => {
    expect(effectText({ metric: 'test_coverage', label: 'Test coverage', unit: '%', from: 55.7, low: 61.2, high: 66.7, horizonWeeks: [4, 8], basis: '', kind: 'improve' }))
      .toBe('Test coverage +5.5 to +11 points (to 61.2%–66.7%) in 4–8 weeks');
    expect(effectText({ metric: 'blocked_time_hours', label: 'Blocked time', unit: 'h', from: 15, low: 11, high: 7, horizonWeeks: [6, 8], basis: '', kind: 'improve' }))
      .toBe('Blocked time −4 to −8 h (to 7 h–11 h) in 6–8 weeks');
  });
});

describe('rules', () => {
  test('flaky tests with CI evidence: names the tests, failed runs, rerun time; effect from the share fixed', () => {
    const f = facts([flakiness], {
      flaky: {
        source: 'ci', windowDays: 14, flakyCount: 4, failedRunsTotal: 14, reruns: 19, rerunMinutes: 84, testsRun: 80,
        tests: [
          { name: 'refunds a rate quote', suite: 'src/offers/offers.test.ts', failedRuns: 5, passedRuns: 5, lastSeen: '2026-11-11T09:00:00Z' },
          { name: 'updates a document upload', suite: 'src/underwriting.test.ts', failedRuns: 4, passedRuns: 4, lastSeen: '2026-11-14T09:00:00Z' },
          { name: 'exports a loan offer', suite: null, failedRuns: 4, passedRuns: 4, lastSeen: null },
          { name: 'retries a missed payment', suite: null, failedRuns: 1, passedRuns: 1, lastSeen: null },
        ],
      },
    });
    const r = flakyTestsRule(f)!;
    expect(r.title).toBe('Fix the 4 flaky tests: they failed 14 runs in the last 14 days and cost about 1.4 hours of reruns');
    expect(r.items.map((i) => i.name)).toEqual(['src/offers/offers.test.ts › refunds a rate quote', 'src/underwriting.test.ts › updates a document upload', 'exports a loan offer', 'retries a missed payment']);
    expect(r.items[0].detail).toBe('failed 5, passed 5 · last seen 11 Nov');
    expect(r.evidence.map((e) => e.label)).toEqual(expect.arrayContaining(['Re-runs in the last 14 days', 'Distinct tests run']));
    expect(r.nextStep).toMatch(/^Quarantine these 4 tests in CI today .* starting with “refunds a rate quote” \(5 failed runs\)/);
    expect(r.metricKey).toBe('test_flakiness_rate');
    expect(r.effect).toMatchObject({ from: 6, horizonWeeks: [2, 4] });
    expect(r.effect!.low).toBeCloseTo(6 * 0.6, 10);
    expect(r.effect!.high).toBeCloseTo(6 * 0.2, 10);
    expect(r.confidence).toBe('high');
  });

  test('flaky tests without test names: KPI-based, lower confidence; silent on target', () => {
    const r = flakyTestsRule(facts([flakiness]))!;
    expect(r.title).toBe('Bring test flakiness down from 6% to ≤ 2%');
    expect(r.items).toEqual([]);
    expect(r.confidence).toBe('medium');
    const ok = metric('test_flakiness_rate', { lowerIsBetter: true, target: { good: 2, warning: 5 }, series: () => 1.5, forecast: { trend: 'flat', outlook: 'on_track' } });
    expect(flakyTestsRule(facts([ok]))).toBeNull();
    // Off target but forecast to reach the target anyway (improving): nothing to add.
    const improving = metric('test_flakiness_rate', { lowerIsBetter: true, target: { good: 2, warning: 5 }, series: (w) => 2.6 + w * 0.1, forecast: { trend: 'improving', outlook: 'will_reach', crossingDay: '2027-01-14' } });
    expect(flakyTestsRule(facts([improving]))).toBeNull();
  });

  test('coverage gap: the files holding most uncovered lines and the points raising them to target adds', () => {
    const f = facts([coverage(), escape], {
      coverage: {
        day: '2026-11-19', commit: '48b35c5aa', linesFound: 1000, linesHit: 600,
        files: [
          { path: 'src/credit/client.ts', linesFound: 200, linesHit: 20 },
          { path: 'src/offers/controller.ts', linesFound: 100, linesHit: 50 },
          { path: 'src/ok.ts', linesFound: 300, linesHit: 290 },
          { path: 'src/rest.ts', linesFound: 400, linesHit: 240 },
        ],
      },
    });
    const r = coverageGapRule(f)!;
    // Gains to 80 %: client 140, rest 80, controller 30 → 250 of 1000 lines = 25 points; uncovered 400, listed 180+50+160 = 390 → 98 %.
    expect(r.items.map((i) => i.name)).toEqual(['src/credit/client.ts', 'src/rest.ts', 'src/offers/controller.ts']);
    expect(r.items[0].detail).toBe('10% of 200 lines · +140 lines to reach 80%');
    expect(r.title).toBe('Close the coverage gap in 3 files that hold 98% of the uncovered lines');
    expect(r.effect).toMatchObject({ from: 56, low: 68.5, high: 81 });
    expect(r.evidence.find((e) => e.label === 'Defect escape rate')?.detail).toMatch(/escaped defects point at untested code/);
    expect(r.nextStep).toMatch(/^Add tests for client\.ts and the 2 other files listed/);
    expect(r.confidence).toBe('high');
    // On target but forecast to miss: says when.
    const falling = coverage({ series: (w) => 84 + w * 0.6, forecast: { trend: 'worsening', outlook: 'will_miss', crossingDay: '2027-01-06', endValue: 79, endDay: '2027-01-15' } });
    expect(coverageGapRule(facts([falling]))!.title).toBe('Test coverage (84% now) misses ≥ 80% around 6 Jan at this rate');
    // Without a coverage report: KPI-based with the history effect.
    const k = coverageGapRule(facts([coverage()]))!;
    expect(k.title).toBe('Raise test coverage from 56% to ≥ 80%');
    expect(k.effect).toMatchObject({ low: 66, high: 76 });
  });

  test('build time regression names the stage that grew', () => {
    const bt = metric('avg_build_time_minutes', { label: 'Average build time', unit: 'min', lowerIsBetter: true, target: { good: 10, warning: 20 }, series: (w) => Math.max(10, 21 - w), forecast: { trend: 'worsening', outlook: 'stays_off', endValue: 25, endDay: '2027-01-15' } });
    const stages = {
      windowDays: 7,
      stages: [
        { name: 'integration-tests', recentMedianS: 660, earlierMedianS: 240, recentRuns: 20, earlierRuns: 20 },
        { name: 'lint', recentMedianS: 70, earlierMedianS: 60, recentRuns: 20, earlierRuns: 20 },
      ],
      failing: [],
    };
    const r = buildTimeRule(facts([bt], { stages }))!;
    expect(r.title).toBe('Build time rose from 13 min to 21 min; the “integration-tests” stage went from 4 to 11 minutes');
    expect(r.items).toEqual([{ kind: 'stage', name: 'integration-tests', detail: 'median 4 → 11 min' }]);
    expect(r.confidence).toBe('high');
    // A rise under 25 % in 8 weeks: silent.
    const flat = metric('avg_build_time_minutes', { unit: 'min', lowerIsBetter: true, target: { good: 10, warning: 20 }, series: (w) => 21 - w * 0.1 });
    expect(buildTimeRule(facts([flat], { stages }))).toBeNull();
  });

  test('defect escape rising while coverage falls (12 weeks)', () => {
    const r = escapeWithFallingCoverageRule(facts([coverage(), escape]))!;
    expect(r.title).toBe('Defect escapes rose from 16.2% to 21% while coverage fell from 65.6% to 56%');
    expect(r.effect).toMatchObject({ from: 21, high: 16.2 });
    expect(r.effect!.low).toBeCloseTo(18.6, 10);
    expect(r.metricKey).toBe('defect_escape_rate');
    // Coverage steady: silent.
    expect(escapeWithFallingCoverageRule(facts([coverage({ series: () => 70 }), escape]))).toBeNull();
  });

  test('sizing drift: estimates too low with carryover off target, effect on carryover', () => {
    const s = metric('sizing_accuracy', { label: 'Sizing accuracy', unit: 'ratio', lowerIsBetter: null, series: (w) => 1.47 - w * 0.01 });
    const carry = metric('sprint_carryover', { label: 'Sprint carryover', lowerIsBetter: true, target: { good: 10, warning: 20 }, series: (w) => 22 - w * 0.5 });
    const r = sizingDriftRule(facts([s, carry]))!;
    expect(r.title).toBe('Estimates are 47% too low (actual 1.47× the estimate), and 22% of the sprint carries over');
    expect(r.nextStep).toMatch(/plan about 32% less/);
    expect(r.metricKey).toBe('sprint_carryover');
    expect(r.effect).toMatchObject({ from: 22, high: 10 });
    // Within 0.85–1.15: silent.
    expect(sizingDriftRule(facts([metric('sizing_accuracy', { unit: 'ratio', lowerIsBetter: null, series: () => 1.1 }), carry]))).toBeNull();
  });

  test('wellbeing low with blocked time off target', () => {
    const b = metric('blocked_time_hours', { label: 'Blocked time', unit: 'h', lowerIsBetter: true, target: { good: 4, warning: 12 }, series: (w) => 15 - w * 0.3 });
    const r = wellbeingBlockedRule(facts([b], { wellbeing: { value: 55, responses: 5, periodEnd: '2026-11-08' } }))!;
    expect(r.title).toBe('Wellbeing is 55/100 and work waits 15 h blocked: remove blockers first');
    expect(r.evidence[0]).toEqual({ label: 'Wellbeing (anonymous pulse survey)', value: '55/100', detail: '5 responses, period ending 8 Nov; watch below 70' });
    expect(wellbeingBlockedRule(facts([b], { wellbeing: { value: 72, responses: 5, periodEnd: '2026-11-08' } }))).toBeNull();
    expect(wellbeingBlockedRule(facts([b]))).toBeNull(); // no (or suppressed) survey result
  });

  test('MTTR rising 25 % or more in 12 weeks', () => {
    const m = metric('mttr_hours', { label: 'Mean time to recovery', unit: 'h', lowerIsBetter: true, target: { good: 2, warning: 8 }, series: (w) => 5.5 - w * 0.2 });
    expect(mttrRule(facts([m]))!.title).toBe('Recovery takes longer: MTTR rose from 3.1 h to 5.5 h in 12 weeks');
    expect(mttrRule(facts([metric('mttr_hours', { unit: 'h', lowerIsBetter: true, target: { good: 2, warning: 8 }, series: () => 5 })]))).toBeNull();
  });

  test('MTTR with incidents from the delivery data: the longest incidents and the time before acknowledgement', () => {
    const m = metric('mttr_hours', { label: 'Mean time to recovery', unit: 'h', lowerIsBetter: true, target: { good: 2, warning: 8 }, series: (w) => 5.5 - w * 0.2 });
    const r = mttrRule(facts([m], { incidents: { windowDays: 30, count: 4, medianHours: 6, medianAckHours: 2.4, longest: [{ title: 'Offers API down', service: 'offers', severity: 'high', hours: 11.5, opened: '2026-11-03T10:00:00Z' }] } }))!;
    expect(r.title).toBe('Recovery takes longer: MTTR rose from 3.1 h to 5.5 h in 12 weeks; 40% of it passes before anyone acknowledges');
    expect(r.items).toEqual([{ kind: 'incident', name: 'Offers API down', detail: 'high · offers · 12 h · opened 3 Nov' }]);
    expect(r.nextStep).toMatch(/^Page the on-call engineer directly/);
    expect(r.evidence.find((e) => e.label === 'Incidents resolved in the last 30 days')).toEqual({ label: 'Incidents resolved in the last 30 days', value: '4', detail: 'median 6 h to recover, 2.4 h to acknowledge' });
    expect(r.confidence).toBe('high');
  });

  test('change failures with the failed deploys and services from the delivery data', () => {
    const m = metric('change_failure_rate', { label: 'Change failure rate', lowerIsBetter: true, target: { good: 5, warning: 15 }, series: (w) => 25 - w * 0.5 });
    const r = changeFailureRule(facts([m], { deploys: { windowDays: 30, production: 12, failed: 3, failedList: [{ id: 'dep-41', service: 'offers-api', day: '2026-11-12' }], services: [{ service: 'offers-api', total: 5, failed: 2 }, { service: 'web', total: 7, failed: 1 }] } }))!;
    expect(r.title).toBe('3 of 12 production deploys failed in 30 days (2 in offers-api): release smaller and behind flags');
    expect(r.items.map((i) => `${i.kind}:${i.name}`)).toEqual(['service:offers-api', 'service:web', 'deploy:dep-41']);
    expect(r.nextStep).toMatch(/starting with offers-api/);
  });

  test('failing stage with a low first-time pass rate', () => {
    const m = metric('first_time_pass_rate', { label: 'First-time pass rate', target: { good: 85, warning: 70 }, series: (w) => 74 + w * 0.5 });
    const r = failingStageRule(facts([m], { stages: { windowDays: 7, stages: [], failing: [{ name: 'e2e', runs: 60, failed: 20 }, { name: 'lint', runs: 60, failed: 2 }] } }))!;
    expect(r.title).toBe('The “e2e” stage fails 33% of runs (20 of 60 in 30 days)');
    expect(r.subjectKey).toBe('e2e');
    expect(failingStageRule(facts([m], { stages: { windowDays: 7, stages: [], failing: [{ name: 'lint', runs: 60, failed: 2 }] } }))).toBeNull();
  });

  test('technical debt while code quality is off target', () => {
    const q = metric('code_quality_score', { label: 'Code quality score', unit: '', target: { good: 80, warning: 60 }, series: (w) => 60 + w });
    const debt = [{ title: 'Report generation blocks the request thread', severity: 'high', category: 'performance', costOfDelay: 5458.42, effortHours: 23.4, filePath: null }, { title: 'Docs', severity: 'low', category: 'documentation', costOfDelay: 10, effortHours: 1, filePath: null }];
    const r = technicalDebtRule(facts([q], { debt }))!;
    expect(r.title).toBe('Pay down “Report generation blocks the request thread” while code quality is 60');
    expect(r.items[0].detail).toBe('high · about 23 h of work · cost of delay 5,458 a month (as recorded)');
    expect(technicalDebtRule(facts([q], { debt: [debt[1]] }))).toBeNull();
  });

  test('slow tests: the slowest tests and their share of the run', () => {
    const m = metric('test_execution_time_minutes', { label: 'Test execution time', unit: 'min', lowerIsBetter: true, target: { good: 15, warning: 30 }, series: () => 22 });
    const r = slowTestsRule(facts([m], { slowTests: [{ name: 'cancels a statement download', suite: 'push', medianMs: 18_300, runs: 25 }], slowTestsTotalMs: 183_000 }))!;
    expect(r.title).toBe('Speed up the slowest test: it takes 10% of the 22 min test run');
    expect(r.effect).toMatchObject({ from: 22 });
    expect(r.effect!.high).toBeCloseTo(22 * 0.95, 10);
    expect(r.items[0]).toEqual({ kind: 'test', name: 'push › cancels a statement download', detail: 'median 18.3 s over 25 runs' });
  });

  test('change failure rate off target', () => {
    const m = metric('change_failure_rate', { label: 'Change failure rate', lowerIsBetter: true, target: { good: 5, warning: 15 }, series: (w) => 25 - w * 0.5 });
    expect(changeFailureRule(facts([m]))!.title).toBe('25% of changes fail in production (target ≤ 5%): release smaller and behind flags');
  });
});

describe('ranking', () => {
  test('ranked by expected effect in watch bands × confidence (+ urgency), deterministic, at most 6', () => {
    const f = facts([coverage(), escape, flakiness,
      metric('mttr_hours', { label: 'MTTR', unit: 'h', lowerIsBetter: true, target: { good: 2, warning: 8 }, series: (w) => 5.5 - w * 0.2 }),
      metric('change_failure_rate', { label: 'Change failure rate', lowerIsBetter: true, target: { good: 5, warning: 15 }, series: (w) => 25 - w * 0.5 }),
      metric('blocked_time_hours', { label: 'Blocked time', unit: 'h', lowerIsBetter: true, target: { good: 4, warning: 12 }, series: (w) => 15 - w * 0.3 }),
      metric('code_quality_score', { label: 'Code quality score', unit: '', target: { good: 80, warning: 60 }, series: (w) => 60 + w }),
    ], {
      wellbeing: { value: 50, responses: 6, periodEnd: '2026-11-08' },
      debt: [{ title: 'Big debt', severity: 'critical', category: 'code_quality', costOfDelay: null, effortHours: null, filePath: null }],
    });
    const a = recommend(f);
    const b = recommend(f);
    expect(a).toEqual(b);
    expect(a.length).toBe(MAX_RECOMMENDATIONS);
    for (let i = 1; i < a.length; i++) expect(a[i - 1].score).toBeGreaterThanOrEqual(a[i].score);
    // Coverage: mid effect 15 points over a 10-point watch band, medium confidence (KPI history with a
    // confident forecast), worsening forecast.
    const cov = a.find((r) => r.ruleKey === 'coverage_gap')!;
    expect(cov.score).toBeCloseTo(scoreOf(cov, f), 10);
    expect(cov.confidence).toBe('medium');
    expect(cov.score).toBeCloseTo((1.5 + 0.5) * 0.7, 10);
  });

  test('a healthy team gets no recommendation', () => {
    const ok = (key: string, lower: boolean, good: number, warning: number, v: number) => metric(key, { lowerIsBetter: lower, target: { good, warning }, series: () => v, forecast: { trend: 'flat', outlook: 'on_track' } });
    expect(recommend(facts([ok('test_coverage', false, 80, 70, 92), ok('test_flakiness_rate', true, 2, 5, 1.5), ok('defect_escape_rate', true, 5, 10, 3)]))).toEqual([]);
  });
});
