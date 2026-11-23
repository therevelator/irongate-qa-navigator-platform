/**
 * Hours lost per week (packages/engine/src/calc/lostHours.ts) and the logic of the "next move" pages
 * (server/lib/navigator.ts). Pure: no server, no database.
 *
 *   LH-01  12 rolling 7-day windows ending at the end of the day; working hours skip weekends
 *   LH-02  a stage slower than its own best week costs (median − best) × runs; noise below 30 s or 10 % is not counted;
 *          the change is between the last fast run and the first slow one
 *   LH-03  a run that failed and then passed on the same commit costs the failed run's duration; a failure never
 *          followed by a success on that commit is a real failure and costs nothing here
 *   LH-04  blocked issues cost 8 hours per blocked weekday
 *   LH-05  a failed change costs the hours from the deploy to its fix, at most 24
 *   LH-06  review wait beyond the team's best weekly median
 *   NV-01  the team's state from its 12 weeks; the verdict of an action from its checkpoints; readiness
 *   NV-02  findings: a cause below half an hour is no finding; a recommendation about a cause takes its hours
 */
import {
  computeLostHours, lostWindows, workingHours, LOST_WEEKS, type LostInput, type PipelineRunRow, type StageRunRow,
} from '../../packages/engine/src/calc/lostHours';
import { causeFinding, discoveryHints, readinessPercent, teamFindings, teamState, verdictOf, SOURCES } from '../../server/lib/navigator';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-20T12:00:00Z'); // a Friday
const base = (): LostInput => ({ now: NOW, stageRuns: [], runs: [], issues: [], deploys: [], incidents: [], pulls: [] });
const weekStart = (w: number) => lostWindows(NOW)[w].from;

describe('hours lost per week', () => {
  it('LH-01 windows and working hours', () => {
    const w = lostWindows(NOW);
    expect(w).toHaveLength(LOST_WEEKS);
    expect(new Date(w[11].to).toISOString()).toBe('2026-11-21T00:00:00.000Z');
    expect(w[11].to - w[11].from).toBe(7 * DAY);
    expect(w[0].to).toBe(w[1].from);
    // Friday 00:00 to Monday 24:00: Friday and Monday count, the weekend does not.
    expect(workingHours(Date.parse('2026-11-20T00:00:00Z'), Date.parse('2026-11-24T00:00:00Z'))).toBe(16);
    expect(workingHours(Date.parse('2026-11-18T06:00:00Z'), Date.parse('2026-11-18T18:00:00Z'))).toBe(4);
    const empty = computeLostHours(base());
    expect(empty.weeks.map((x) => x.total)).toEqual(Array(12).fill(0));
  });

  it('LH-02 a stage slower than its own best week', () => {
    const stageRuns: StageRunRow[] = [];
    for (let w = 0; w < 12; w++) {
      for (let i = 0; i < 10; i++) {
        const slow = w >= 10;
        stageRuns.push({ name: 'CI › integration', at: weekStart(w) + i * 3_600_000, durationS: slow ? 660 : 240, commit: `c${w}-${i}` });
        stageRuns.push({ name: 'CI › lint', at: weekStart(w) + i * 3_600_000, durationS: w === 11 ? 75 : 60, commit: `c${w}-${i}` }); // +15 s: noise
      }
    }
    const r = computeLostHours({ ...base(), stageRuns });
    // (660 − 240) s × 10 runs = 4200 s = 1.17 h in each of the two slow weeks.
    expect(r.weeks.map((x) => x.hours.slow_stage)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.17, 1.17]);
    expect(r.detail.slow_stage).toHaveLength(1);
    expect(r.detail.slow_stage[0]).toMatchObject({ stage: 'CI › integration', bestMedianS: 240, medianS: 660, runs: 10, hours: 1.17, change: { fromCommit: 'c9-9', toCommit: 'c10-0' } });
    expect(r.detail.slow_stage[0].since).toBe(new Date(weekStart(10)).toISOString().slice(0, 10));
  });

  it('LH-03 failed runs that passed on a rerun of the same commit', () => {
    const at = weekStart(11) + DAY;
    const runs: PipelineRunRow[] = [
      { id: '1', name: 'CI', commit: 'aaa', at, durationS: 1200, result: 'failed' },
      { id: '2', name: 'CI', commit: 'aaa', at: at + 3_600_000, durationS: 1300, result: 'success' },
      { id: '3', name: 'CI', commit: 'bbb', at, durationS: 900, result: 'failed' }, // never passed: a real failure
      { id: '4', name: 'CI', commit: 'ccc', at, durationS: 900, result: 'success' },
      { id: '5', name: 'CI', commit: '', at, durationS: 900, result: 'failed' }, // no commit: cannot be matched
    ];
    const r = computeLostHours({ ...base(), runs });
    expect(r.weeks[11].hours.flaky_rerun).toBe(0.33);
    expect(r.detail.flaky_rerun).toEqual([{ pipeline: 'CI', failedRuns: 1, hours: 0.33 }]);
  });

  it('LH-04 blocked work in working hours', () => {
    const from = Date.parse('2026-11-16T00:00:00Z'); // Monday of the latest window (14–20 Nov)
    const issue: any = {
      id: 'i1', key: 'PAY-1', title: 'Waits for an environment', type: 'story', statusCategory: 'in_progress', resolution: null, foundIn: null, environment: null, points: null, estimate: null, logged: null,
      sprintIds: [], openedAt: from - DAY, resolvedAt: null, url: null, components: [],
      transitions: [{ field: 'status', from: 'In progress', to: 'Blocked', toCategory: 'blocked', at: from }, { field: 'status', from: 'Blocked', to: 'In progress', toCategory: 'in_progress', at: from + 2 * DAY }],
    };
    const r = computeLostHours({ ...base(), issues: [issue] });
    expect(r.weeks[11].hours.blocked).toBe(16);
    expect(r.detail.blocked).toEqual([{ key: 'PAY-1', title: 'Waits for an environment', hours: 16, url: null }]);
  });

  it('LH-05 failed changes: from the deploy to its fix, at most 24 hours', () => {
    const t = weekStart(11) + DAY;
    const dep = (id: string, finishedAt: number, extra: object = {}): any => ({
      id, externalId: id, service: 'web-api', environment: 'production', result: 'success', rollbackOf: null, hotfix: false, startedAt: finishedAt - 60_000, finishedAt,
      firstAuthoredAt: null, commitCount: 1, commit: id, url: null, ...extra,
    });
    const r = computeLostHours({ ...base(), deploys: [dep('rel-1', t), dep('rel-1-rb', t + 2 * 3_600_000, { rollbackOf: 'rel-1' }), dep('rel-2', t + DAY), dep('rel-3', t + DAY + 60 * 3_600_000, { hotfix: true })] });
    // rel-1: rolled back after 2 h. rel-2: hotfixed 60 h later → capped at 24.
    expect(r.weeks[11].hours.failed_change).toBe(26);
    expect(r.detail.failed_change.map((f) => [f.deploy, f.hours])).toEqual([['rel-1', 2], ['rel-2', 24]]);
  });

  it('LH-06 review wait beyond the best weekly median', () => {
    const pulls = [];
    for (let w = 0; w < 12; w++) for (let i = 0; i < 6; i++) {
      const opened = weekStart(w) + 2 * DAY + i * 60_000; // the windows start on a Saturday: this is a Monday
      pulls.push({ openedAt: opened, firstReviewAt: opened + (w === 11 ? 24 : 6) * 3_600_000 });
    }
    const r = computeLostHours({ ...base(), pulls });
    // 6 clock hours on a weekday = 2 working hours; 24 = 8. Six pull requests wait 6 working hours more each.
    expect(r.weeks[11].hours.review_wait).toBe(36);
    expect(r.weeks[5].hours.review_wait).toBe(0);
    expect(r.detail.review_wait).toEqual({ pulls: 6, medianWaitH: 8, bestMedianH: 2, hours: 36 });
  });
});

describe('next move: state, verdict, readiness, findings', () => {
  const weeks = (totals: number[]) => totals.map((t, i) => ({ start: `w${i}`, end: `w${i}`, hours: { slow_stage: t, flaky_rerun: 0, blocked: 0, failed_change: 0, review_wait: 0 }, total: t }));
  const samples = { slow_stage: 50 };

  it('NV-01 state, verdict and readiness', () => {
    expect(teamState(weeks([10, 10, 10, 10, 8, 8, 6, 6, 4, 4, 4, 4]), samples)).toBe('improving');
    expect(teamState(weeks([4, 4, 4, 4, 5, 5, 6, 6, 9, 9, 9, 9]), samples)).toBe('slipping');
    expect(teamState(weeks(Array(12).fill(5)), samples)).toBe('steady');
    expect(teamState(weeks(Array(12).fill(0)), {})).toBe('unknown');
    const o = (d14: string, d30: string) => [{ checkpoint: 'completion', outcome: 'improved' }, { checkpoint: 'd14', outcome: d14 }, { checkpoint: 'd30', outcome: d30 }] as any;
    expect(verdictOf({ status: 'in_progress', outcomes: [] })).toBe('owned');
    expect(verdictOf({ status: 'done', outcomes: o('pending', 'pending') })).toBe('waiting');
    expect(verdictOf({ status: 'done', outcomes: o('improved', 'pending') })).toBe('verified');
    expect(verdictOf({ status: 'done', outcomes: o('improved', 'worse') })).toBe('not_held');
    expect(verdictOf({ status: 'done', outcomes: o('unchanged', 'pending') })).toBe('not_held');
    expect(verdictOf({ status: 'done', outcomes: [] })).toBe('waiting'); // no KPI linked: nothing to judge by
    expect(verdictOf({ status: 'dropped', outcomes: [] })).toBeNull();
    const cells = Object.fromEntries(SOURCES.map((s) => [s.key, 'ok'])) as any;
    expect(readinessPercent(cells)).toBe(100);
    expect(readinessPercent({ ...cells, tests: 'missing', coverage: 'stale', performance: 'missing' })).toBe(67); // optional sources do not count
    expect(discoveryHints('tests', [{ source: 'jenkins', reportedAt: '', exporterVersion: null, counts: { pipelineRuns: 12 }, runsWithoutTests: 12, runsWithoutCoverage: 0, unmapped: [], notes: [] }]))
      .toEqual(['jenkins: 12 of 12 pipeline runs kept no test report.']);
  });

  it('NV-02 findings', () => {
    const team = { id: 't1', name: 'Team One' };
    const w = weeks([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3.2]);
    const detail: any = { slow_stage: [{ stage: 'CI › integration', bestMedianS: 240, medianS: 660, runs: 27, hours: 3.2, since: '2026-11-07', change: { day: '2026-11-08', fromCommit: 'aaaaaaa1111', toCommit: 'bbbbbbb2222' } }], flaky_rerun: [], blocked: [], failed_change: [], review_wait: null };
    const f = causeFinding(team, 'slow_stage', w, detail, samples)!;
    expect(f).toMatchObject({ id: 'lost:t1:slow_stage', hours: 3.2, cause: 'slow_stage', confidence: 'high', since: '2026-11-08', metricKey: 'avg_build_time_minutes' });
    expect(f.nextStep).toContain('aaaaaaa … bbbbbbb');
    // Below half an hour a week: not a finding.
    expect(causeFinding(team, 'slow_stage', weeks([...Array(11).fill(0), 0.4]), detail, samples)).toBeNull();
    // A recommendation about the same cause takes the hours; the cause's own finding is not listed twice.
    const rec = { id: 'r1', team_id: 't1', rule_key: 'build_time_regression', title: 'Build time went up', evidence: [{ label: 'Build time', value: '19 min' }], items: [], next_step: 'Split the stage', metric_key: 'avg_build_time_minutes', effect: null, confidence: 'medium' };
    const other = { ...rec, id: 'r2', rule_key: 'coverage_gap', title: 'Close the coverage gap', metric_key: 'test_coverage' };
    const list = teamFindings(team, w, detail, samples, [other, rec]);
    expect(list.map((x) => [x.id, x.hours])).toEqual([['rec:r1', 3.2], ['rec:r2', null]]);
    expect(list[0].items[0].name).toBe('CI › integration');
  });
});
