import { movement, offTargetItems, rankImproved, rankRisks, statusChanges, trendOf, weekChange, type SummaryTeamInput } from '../../server/lib/executiveSummary';
import { teamKpiTrack } from '../../src/config/metricsConfig';

/** The executive summary's ranking rules (server/lib/executiveSummary.ts), without a database. */

const team = (id: string, qa: number | null, prev: number | null, kpis: { cov?: number; aut?: number; flk?: number; esc?: number } = {}, prevValues: SummaryTeamInput['prevValues'] = {}): SummaryTeamInput => ({
  teamId: id, teamName: `Team ${id}`, departmentName: null, qaScore: qa, prevQaScore: prev, snapshotDate: '2026-11-20', prevValues,
  checks: teamKpiTrack({ testCoverage: kpis.cov ?? 90, automationCoverage: kpis.aut ?? 80, testFlakinessRate: kpis.flk ?? 1, defectEscapeRate: kpis.esc ?? 2 }).checks,
});

describe('Executive summary rules', () => {
  it('ESL-001: weekly change and its direction (lower is better for rates)', () => {
    expect(weekChange(70, 65)).toBe(5);
    expect(weekChange(70, null)).toBeNull();
    expect(trendOf(-2, true)).toBe('better');
    expect(trendOf(-2, false)).toBe('worse');
    expect(trendOf(0, false)).toBe('same');
  });

  it('ESL-002: off-target items: QA score below 85 first, then the KPIs missed, largest relative gap first', () => {
    const items = offTargetItems(team('a', 72, 75, { cov: 70, esc: 15 }, { defectEscapeRate: 12 }));
    expect(items.map((i) => i.key)).toEqual(['qaScore', 'defectEscapeRate', 'testCoverage']);
    expect(items[0]).toMatchObject({ value: 72, target: 85, weekChange: -3, trend: 'worse' });
    expect(items[1]).toMatchObject({ value: 15, target: 5, weekChange: 3, trend: 'worse' });
    expect(offTargetItems(team('b', 90, 88))).toEqual([]);
  });

  it('ESL-003: risks: lowest QA score first, top 3 of all; improved: biggest rise first, rises only', () => {
    const teams = [team('a', 60, 62, { cov: 50 }), team('b', 95, 90), team('c', 80, 79), team('d', 84, 84), team('e', 70, 60, { esc: 9 })];
    const r = rankRisks(teams);
    expect(r.top.map((x) => x.teamId)).toEqual(['a', 'e', 'c']);
    expect(r.total).toBe(4);
    expect(rankImproved(teams).top.map((x) => [x.teamId, x.weekChange])).toEqual([['e', 10], ['b', 5], ['c', 1]]);
    expect(movement(teams)).toEqual({ up: 3, down: 1, same: 1, compared: 5 });
  });

  it('ESL-004: status changes, worse ones first', () => {
    const changes = statusChanges([team('a', 60, 75), team('b', 90, 80), team('c', 80, 79)]);
    expect(changes).toEqual([
      expect.objectContaining({ teamId: 'a', from: 'warning', to: 'critical', better: false }),
      expect.objectContaining({ teamId: 'b', from: 'warning', to: 'good', better: true }),
    ]);
  });
});
