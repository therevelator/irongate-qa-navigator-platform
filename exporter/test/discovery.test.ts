/**
 * The discovery report (run.ts discoveryOf): what a CI source held for each team in a run's window, for QE
 * Navigator's Data readiness page. Counts and names of unmapped jobs only.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { discoveryOf } from '../src/run';

const since = new Date('2026-11-20T00:00:00Z');
const until = new Date('2026-11-23T00:00:00Z');

describe('discovery report', () => {
  test('counts the records per kind and the runs that kept no test report or coverage file', () => {
    const seen = [
      { team: 'team-pay', kind: 'pipeline-runs', id: 'run:101#1' },
      { team: 'team-pay', kind: 'pipeline-runs', id: 'run:102#1' },
      { team: 'team-pay', kind: 'pipeline-runs', id: 'run:102#2' },
      { team: 'team-pay', kind: 'test-report', id: 'test-report:101#1' },
      { team: 'team-pay', kind: 'coverage', id: 'coverage:101#1' },
      { team: 'team-pay', kind: 'coverage', id: 'coverage:102#2' },
      { team: 'team-pay', kind: 'deployments', id: 'deployment:9' },
      { team: 'team-web', kind: 'deployments', id: 'deployment:10' },
    ];
    const out = discoveryOf(seen, [{ id: 'build 7', reason: 'pipeline nightly-load is not mapped' }, { id: 'build 8', reason: 'pipeline nightly-load is not mapped' }, { id: 'build 9', reason: 'result canceled' }], since, until);
    assert.deepEqual(out.get('team-pay'), {
      from: '2026-11-20T00:00:00.000Z', to: '2026-11-23T00:00:00.000Z',
      counts: { pipelineRuns: 3, testReports: 1, coverageReports: 2, deployments: 1 },
      runsWithoutTests: 2, runsWithoutCoverage: 1, unmapped: ['pipeline nightly-load is not mapped'],
    });
    // A team without pipeline runs in the window gets no report: nothing can be said about what its pipelines keep.
    assert.equal(out.has('team-web'), false);
  });

  test('holds no record of the tool: only counts, the window and the names of what is not mapped', () => {
    const out = discoveryOf([{ team: 't', kind: 'pipeline-runs', id: 'run:1#1' }], [], since, until);
    assert.deepEqual(Object.keys(out.get('t')!).sort(), ['counts', 'from', 'runsWithoutCoverage', 'runsWithoutTests', 'to']);
  });
});
