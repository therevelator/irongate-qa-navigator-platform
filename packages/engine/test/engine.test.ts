/**
 * The engine stays a pure, dependency-free package: only relative imports and Node's built-in crypto and zlib; no
 * database, HTTP, file system, process or environment access anywhere in src/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../src/index';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : f.endsWith('.ts') ? [join(d, f)] : []));

test('only relative imports and node:crypto / node:zlib', () => {
  for (const f of files(src)) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm)) {
      assert.ok(m[1].startsWith('.') || ['node:crypto', 'node:zlib'].includes(m[1]), `${f} imports ${m[1]}`);
    }
    assert.doesNotMatch(text, /\bprocess\.|require\(|\bfetch\(|node:(fs|http|https|net|child_process)/, `${f} reaches outside the engine`);
  }
});

test('the version and the metric catalogue', () => {
  assert.match(E.ENGINE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(Object.keys(E.METRICS).length, 32);
  for (const m of Object.values(E.METRICS)) assert.ok(m.formula && m.unit && m.label, m.key);
  assert.equal(E.EVIDENCE_FOR_KPI.test_coverage, 'line_coverage');
  assert.match(E.buildMetrics({ changeFailureWindowHours: 48 }).change_failure_rate.formula, /within 48 h/);
});

test('evidence lists from records: flaky tests, lowest-coverage files, slowest tests, failing stages', () => {
  const day = '2026-11-20';
  const at = (h: number) => Date.parse(`${day}T${String(h).padStart(2, '0')}:00:00Z`);
  const run = (id: string, h: number, status: 'passed' | 'failed', ms: number) => ({
    id, commit: 'c1', runId: id, attempt: 1, branch: 'main', day, startedAt: at(h), passed: status === 'passed' ? 1 : 0, failed: status === 'failed' ? 1 : 0, errored: 0, skipped: 0, durationMs: ms,
    cases: [{ testKey: 'k1', suite: 's', name: 'checkout pays', status, durationMs: ms, retries: 0 }, { testKey: 'k2', suite: 's', name: 'cart adds', status: 'passed' as const, durationMs: 10, retries: 0 }],
  });
  const data: E.CiData = {
    mainBranch: null,
    testRuns: [run('a', 8, 'failed', 900), run('b', 9, 'passed', 700)],
    coverage: [{ id: 'cov', commit: 'c1', branch: 'main', attempt: 1, day, createdAt: at(10), format: 'lcov', linesFound: 30, linesHit: 15, branchesFound: 0, branchesHit: 0, fileCount: 2, changedLinesFound: null, changedLinesHit: null,
      files: [{ path: 'src/a.ts', linesFound: 10, linesHit: 1 }, { path: 'src/b.ts', linesFound: 20, linesHit: 14 }] }],
    pipelines: [{ id: 'p', externalId: '101', attempt: 1, day, startedAt: at(8), finishedAt: at(9), durationS: 3600, result: 'failed', url: null,
      stages: [{ name: 'e2e', kind: 'test', parallelGroup: null, startedAt: at(8), finishedAt: at(9), durationS: 3600, result: 'failed' }] }],
  };
  const ev = E.ciEvidence(day, data);
  assert.deepEqual(ev.flakyTests.map((f) => [f.name, f.failedRuns, f.passedRuns]), [['checkout pays', 1, 1]]);
  assert.deepEqual(ev.lowestFiles.map((f) => [f.path, f.coverage]), [['src/a.ts', 10], ['src/b.ts', 70]]);
  assert.deepEqual(ev.slowestTests.map((t) => [t.name, t.medianMs]), [['checkout pays', 800], ['cart adds', 10]]);
  assert.deepEqual(ev.failingStages.map((s) => [s.name, s.failed, s.lastFailedRuns[0].runId]), [['e2e', 1, '101']]);
  const values = Object.fromEntries(E.computeCiDay(day, data).map((m) => [m.key, m.value]));
  assert.equal(values.flaky_tests, 1);
  assert.equal(values.line_coverage, 50);
  assert.equal(values.pass_rate, 50); // the run counts: 1 passed, 1 failed
});
