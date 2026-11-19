import { expectationText, statusWithTarget, targetLabel, watchBand } from '../../src/lib/targetText';

/** The expectation shown next to every metric status (src/lib/targetText.ts). Pure functions. */
const higher = { good: 80, warning: 70, lowerIsBetter: false };
const lower = { good: 0.5, warning: 1, lowerIsBetter: true };

describe('target texts', () => {
  it('TGT-001: target with direction and unit', () => {
    expect(targetLabel(higher, '%')).toBe('Target ≥ 80%');
    expect(targetLabel(lower, '/1k LOC')).toBe('Target ≤ 0.5 /1k LOC');
    expect(targetLabel({ good: 85, warning: 70, lowerIsBetter: false }, '/100')).toBe('Target ≥ 85');
    expect(targetLabel(null, '%')).toBeNull();
  });

  it('TGT-002: watch band low–high for both directions', () => {
    expect(watchBand(higher, '%')).toBe('Watch: 70–80%');
    expect(watchBand(lower, '/1k LOC')).toBe('Watch: 0.5–1 /1k LOC');
    expect(watchBand(lower, '/1k LOC', false)).toBe('Watch: 0.5–1');
  });

  it('TGT-003: status with target: watch shows the band, others the status word', () => {
    expect(statusWithTarget(higher, '%', 'good')).toBe('On target · Target ≥ 80%');
    expect(statusWithTarget(higher, '%', 'warning')).toBe('Watch: 70–80% · Target ≥ 80%');
    expect(statusWithTarget(lower, '/1k LOC', 'critical')).toBe('Off target · Target ≤ 0.5 /1k LOC');
    expect(statusWithTarget(lower, '/1k LOC', 'warning')).toBe('Watch: 0.5–1 · Target ≤ 0.5 /1k LOC');
    expect(statusWithTarget(null, '%', 'critical')).toBe('Off target');
    expect(statusWithTarget(higher, '%', 'no-data')).toBe('Target ≥ 80%');
  });

  it('TGT-004: expectation only', () => {
    expect(expectationText(higher, '%', 'critical')).toBe('Target ≥ 80%');
    expect(expectationText(higher, '%', 'warning')).toBe('Watch: 70–80% · Target ≥ 80%');
  });
});
