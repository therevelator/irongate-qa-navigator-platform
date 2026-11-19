import { computeQaScore, qaScoreInputLosses } from '../../server/lib/metricFormulas';

/** qaScoreInputLosses: which input costs the QA score most (Team detail "Costs the score most"). */
describe('qaScoreInputLosses', () => {
  const row = { test_coverage: 60, defect_escape_rate: 10, change_failure_rate: 5, code_quality_score: 90 };

  it('QAL-001: points lost add up to 100 − the unrounded score, largest first', () => {
    const losses = qaScoreInputLosses(row);
    // coverage: 40 × 0.30 = 12; escape: 10 × 0.25 = 2.5; cfr: 5 × 0.25 = 1.25; quality: 10 × 0.20 = 2
    expect(losses.map((l) => [l.key, Number(l.pointsLost.toFixed(2))])).toEqual([
      ['test_coverage', 12], ['defect_escape_rate', 2.5], ['code_quality_score', 2], ['change_failure_rate', 1.25],
    ]);
    const total = losses.reduce((s, l) => s + l.pointsLost, 0);
    expect(Math.round(100 - total)).toBe(computeQaScore(row).score);
    expect(losses[0]).toMatchObject({ label: 'Test coverage', value: 60, term: 60 });
  });

  it('QAL-002: stale inputs are left out and the weights renormalised, as the score', () => {
    const losses = qaScoreInputLosses(row, ['test_coverage']);
    expect(losses).toEqual([]); // no score without coverage
    const l2 = qaScoreInputLosses(row, ['code_quality_score']);
    expect(l2.map((l) => l.key)).not.toContain('code_quality_score');
    expect(Number(l2[0].pointsLost.toFixed(3))).toBe(Number(((40 * 0.3) / 0.8).toFixed(3)));
  });

  it('QAL-003: no score, no losses', () => {
    expect(qaScoreInputLosses({ test_coverage: 80 })).toEqual([]);
    expect(qaScoreInputLosses(null)).toEqual([]);
  });
});
