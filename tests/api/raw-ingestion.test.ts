import fs from 'fs';
import path from 'path';
import { gzipSync } from 'zlib';
import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post, put } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

/**
 * v2 phase 1 raw ingestion (POST /api/ingest/tests, /coverage, /pipelines) and the calculation
 * engine, end to end against a live backend: API key auth, tenant check, formats (raw body,
 * multipart, gzip), errors (400 / 413 / 415), idempotency, dry runs, the ingestion log, the values
 * computed from hand-counted fixtures (tests/fixtures/ingest), recalculation when late data
 * arrives, the KPI write (source "computed"), and the evidence / "How this was calculated" /
 * Connect your CI endpoints with their access rules.
 * Uses the golden fixture company (golden-team-empty: no other data). Skips when no backend runs.
 */
const F = (name: string) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'ingest', name));
const TEAM = 'golden-team-empty';

let up = true;
let db: Client;
let adminCookie = '';
let apiKey = '';
let foreignTeam = '';
let D = ''; // two days ago (UTC)
let D1 = ''; // three days ago

const dayBefore = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const raw = (kind: string, params: Record<string, string>, body: Buffer | string, headers: Record<string, string> = {}) => {
  let r = request(API_URL).post(`/api/ingest/${kind}?${new URLSearchParams(params)}`).set('Authorization', `Bearer ${apiKey}`).set('Content-Type', headers['Content-Type'] ?? 'application/octet-stream');
  for (const [k, v] of Object.entries(headers)) if (k !== 'Content-Type') r = r.set(k, v);
  return r.send(body);
};
const evidence = async (metric: string, day: string) =>
  (await db.query(`SELECT value::float8 AS value, sample_size, confidence, inputs, sources FROM metric_evidence WHERE team_id = $1 AND day = $2::date AND metric_key = $3`, [TEAM, day, metric])).rows[0] ?? null;
const snapshot = async (day: string, col: string) =>
  (await db.query(`SELECT ${col}::float8 AS v, field_sources -> '${col}' ->> 'source' AS source FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date = $2::date`, [TEAM, day])).rows[0] ?? null;
const count = async (sql: string, params: any[] = []) => Number((await db.query(sql, params)).rows[0].n);

const junit = (cases: string, time = '4.750') =>
  `<?xml version="1.0"?><testsuites><testsuite name="pytest" time="${time}">${cases}</testsuite></testsuites>`;
const PASS_ALL = junit(
  '<testcase classname="tests.test_payments" name="test_authorise_card" time="0.5"/>' +
  '<testcase classname="tests.test_payments" name="test_refund_partial" time="1.2"/>' +
  '<testcase classname="tests.test_payments" name="test_currency[EUR]" time="0.02"/>' +
  '<testcase classname="tests.test_ledger" name="test_ledger_balance" time="0"><skipped/></testcase>' +
  '<testcase classname="tests.test_ledger" name="test_ledger_close" time="0.15"/>'
);

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running at', API_URL, '- raw ingestion tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  adminCookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  apiKey = (await post('/api/admin/api-keys', adminCookie, { name: 'Raw ingestion test key' })).body.plaintextKey;
  foreignTeam = (await db.query(`SELECT id FROM teams WHERE company_id <> $1 LIMIT 1`, [GOLDEN_COMPANY])).rows[0]?.id ?? 'no-such-team';
  D = dayBefore(2);
  D1 = dayBefore(3);
});

afterAll(async () => {
  if (db) { await removeGolden(db); await db.end(); }
});

describe('Authentication, tenant and request errors', () => {
  it('RAW-001 no key or a wrong key: 401; a team of another company: 403, logged as rejected', async () => {
    if (!up) return;
    const none = await request(API_URL).post(`/api/ingest/tests?team=${TEAM}`).send(F('junit-pytest.xml'));
    expect(none.status).toBe(401);
    const bad = await request(API_URL).post(`/api/ingest/coverage?team=${TEAM}`).set('Authorization', 'Bearer igk_nope').send('SF:a\nend_of_record');
    expect(bad.status).toBe(401);
    const foreign = await raw('tests', { team: foreignTeam }, F('junit-pytest.xml'));
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toMatch(/not accessible with this API key/);
    const log = (await db.query(`SELECT status, http_status, source, errors FROM ingestion_log WHERE id = $1`, [foreign.body.ingestionId])).rows[0];
    expect(log).toMatchObject({ status: 'rejected', http_status: 403, source: 'tests (junit)' });
  });

  it('RAW-002 400s name the problem: no team, bad attempt, a future run, an empty body, malformed or hostile XML', async () => {
    if (!up) return;
    expect((await raw('tests', {}, F('junit-pytest.xml'))).body.error).toMatch(/team is required/);
    expect((await raw('tests', { team: TEAM, attempt: '0' }, F('junit-pytest.xml'))).body.error).toMatch(/attempt must be a whole number/);
    const future = await raw('tests', { team: TEAM, startedAt: new Date(Date.now() + 86_400_000).toISOString() }, F('junit-pytest.xml'));
    expect(future.status).toBe(400);
    expect(future.body.error).toMatch(/in the future/);
    expect((await raw('tests', { team: TEAM }, '')).body.error).toMatch(/Empty report/);
    const trunc = await raw('tests', { team: TEAM }, F('malformed-truncated.xml'));
    expect(trunc.status).toBe(400);
    expect(trunc.body.error).toMatch(/Invalid XML: Unterminated start tag/);
    const xxe = await raw('tests', { team: TEAM }, F('hostile-xxe.xml'));
    expect(xxe.status).toBe(400);
    expect(xxe.body.error).toMatch(/entity declarations are not allowed/);
    const empty = await raw('tests', { team: TEAM }, '<testsuites><testsuite name="x"/></testsuites>');
    expect(empty.body.error).toBe('The report has no test cases');
  });

  it('RAW-003 unknown or undetectable format: 415 with the supported list', async () => {
    if (!up) return;
    const named = await raw('coverage', { team: TEAM, format: 'clover' }, F('lcov.info'));
    expect(named.status).toBe(415);
    expect(named.body.supported).toEqual(['lcov', 'cobertura', 'jacoco', 'istanbul', 'istanbul-summary']);
    const unknown = await raw('tests', { team: TEAM }, 'just some text');
    expect(unknown.status).toBe(415);
    expect(unknown.body.error).toMatch(/Supported: junit, trx, cucumber/);
  });

  it('RAW-004 an upload over 20 MB: 413, with the advice to send gzip', async () => {
    if (!up) return;
    const big = Buffer.alloc(21 * 1024 * 1024, 0x20);
    const r = await raw('tests', { team: TEAM }, big);
    expect(r.status).toBe(413);
    expect(r.body.error).toMatch(/at most 20 MB.*gzip/);
  });
});

describe('Tests: pass rate, flakiness, first-time pass rate, execution time', () => {
  let firstRun = '';
  it('RAW-010 a pytest JUnit report (raw body): counts, and the values for that day computed and written as "computed"', async () => {
    if (!up) return;
    const r = await raw('tests', { team: TEAM, commit: 'c1', branch: 'main', run: 'r1', attempt: '1', startedAt: `${D}T10:00:00Z` }, F('junit-pytest.xml'), { 'Content-Type': 'application/xml' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'accepted', format: 'junit', counts: { total: 5, passed: 2, failed: 1, errored: 1, skipped: 1 }, durationMs: 3250 });
    firstRun = r.body.testRunId;
    const day = r.body.computed.find((d: any) => d.day === D);
    const by = Object.fromEntries(day.metrics.map((m: any) => [m.key, m]));
    expect(by.pass_rate.value).toBe(50); // 2 ÷ (2 + 1 + 1)
    expect(by.test_execution_time.value).toBe(0.05); // 3.25 s
    expect(by.first_time_pass_rate.value).toBe(0);
    expect(by.test_flakiness_rate.value).toBe(0);
    expect(by.pass_rate.confidence).toBe('low');
    expect(await snapshot(D, 'first_time_pass_rate')).toEqual({ v: 0, source: 'computed' });
    const mv = (await db.query(`SELECT source, ingestion_id FROM metric_values WHERE team_id = $1 AND metric_key = 'test_flakiness_rate' AND superseded_by IS NULL ORDER BY received_at DESC LIMIT 1`, [TEAM])).rows[0];
    expect(mv).toEqual({ source: 'computed', ingestion_id: r.body.ingestionId });
  });

  it('RAW-011 the same team, commit, run and attempt again: "duplicate", nothing written', async () => {
    if (!up) return;
    const before = await count(`SELECT COUNT(*) AS n FROM test_results r JOIN test_runs tr ON tr.id = r.test_run_id WHERE tr.team_id = $1`, [TEAM]);
    const r = await raw('tests', { team: TEAM, commit: 'c1', branch: 'main', run: 'r1', attempt: '1', startedAt: `${D}T10:00:00Z` }, F('junit-pytest.xml'));
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('duplicate');
    expect(await count(`SELECT COUNT(*) AS n FROM test_results r JOIN test_runs tr ON tr.id = r.test_run_id WHERE tr.team_id = $1`, [TEAM])).toBe(before);
  });

  it('RAW-012 a rerun (attempt 2) where the failing tests pass: 2 flaky tests of 4 run, with the proving runs', async () => {
    if (!up) return;
    const r = await raw('tests', { team: TEAM, commit: 'c1', branch: 'main', run: 'r1', attempt: '2', startedAt: `${D}T10:30:00Z` }, PASS_ALL);
    expect(r.status).toBe(201);
    const flaky = await evidence('test_flakiness_rate', D);
    expect(flaky.value).toBe(50); // test_refund_partial and test_ledger_close ÷ 4 distinct tests (the skipped one is not counted)
    expect(flaky.inputs).toMatchObject({ flakyTests: 2, distinctTests: 4, windowDays: 7, runs: 2 });
    expect((await evidence('pass_rate', D)).value).toBe(75); // (2 + 4) ÷ (6 + 1 failed + 1 error)
    expect((await evidence('test_execution_time', D)).value).toBe(0.07); // median(3.25 s, 4.75 s) = 4 s
    expect((await evidence('first_time_pass_rate', D)).value).toBe(0); // the run's first attempt failed
    const rows = (await db.query(`SELECT name, failed_run_ids, passed_run_ids FROM flaky_test_evidence WHERE team_id = $1 ORDER BY name`, [TEAM])).rows;
    expect(rows.map((x) => x.name)).toEqual(['test_ledger_close', 'test_refund_partial']);
    expect(rows[0].failed_run_ids).toEqual([firstRun]);
    expect(rows[0].passed_run_ids).toEqual([r.body.testRunId]);
  });

  it('RAW-013 late data: an earlier run of the same day arrives later; the day is recalculated and its KPI snapshot updated', async () => {
    if (!up) return;
    const r = await raw('tests', { team: TEAM, commit: 'c2', branch: 'main', run: 'r9', startedAt: `${D}T08:00:00Z` }, PASS_ALL);
    expect(r.status).toBe(201);
    expect((await evidence('first_time_pass_rate', D)).value).toBe(50); // (c1, r1) failed first time; (c2, r9) passed
    expect((await evidence('pass_rate', D)).value).toBe(83.33); // 10 ÷ 12
    expect(await snapshot(D, 'first_time_pass_rate')).toEqual({ v: 50, source: 'computed' });
  });

  it('RAW-014 a feature-branch run counts for flakiness and execution time but not for the main-branch pass rate', async () => {
    if (!up) return;
    await raw('tests', { team: TEAM, commit: 'c3', branch: 'feature/x', run: 'r10', startedAt: `${D}T12:00:00Z` }, F('junit-pytest.xml'));
    expect((await evidence('pass_rate', D)).value).toBe(83.33);
    expect((await evidence('test_execution_time', D)).inputs.runs).toBe(4);
  });

  it('RAW-015 multipart TRX and Cucumber uploads; an Idempotency-Key retry is replayed', async () => {
    if (!up) return;
    const trx = await request(API_URL).post('/api/ingest/tests').set('Authorization', `Bearer ${apiKey}`)
      .field('team', TEAM).field('commit', 'c4').field('run', 'trx-1').field('startedAt', `${D1}T09:00:00Z`).attach('report', F('trx-dotnet.trx'), 'results.trx');
    expect(trx.status).toBe(201);
    expect(trx.body).toMatchObject({ format: 'trx', counts: { total: 4, passed: 2, failed: 1, skipped: 1 } });
    const key = `cuc-key-${Date.now()}`;
    const a = await raw('tests', { team: TEAM, commit: 'c5', run: 'cuc-1', startedAt: `${D1}T09:30:00Z` }, F('cucumber.json'), { 'Idempotency-Key': key });
    const b = await raw('tests', { team: TEAM, commit: 'c5', run: 'cuc-1', startedAt: `${D1}T09:30:00Z` }, F('cucumber.json'), { 'Idempotency-Key': key });
    expect(a.status).toBe(201);
    expect(a.body.format).toBe('cucumber');
    expect(b.status).toBe(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.uploadId).toBe(a.body.uploadId);
  });

  it('RAW-016 a dry run (the "send a test call" check) validates and stores nothing', async () => {
    if (!up) return;
    const before = await count(`SELECT COUNT(*) AS n FROM test_runs WHERE team_id = $1`, [TEAM]);
    const r = await raw('tests', { team: TEAM, dryRun: 'true' }, F('junit-jest.xml'));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'dry-run', format: 'junit', counts: { total: 4 } });
    expect(await count(`SELECT COUNT(*) AS n FROM test_runs WHERE team_id = $1`, [TEAM])).toBe(before);
  });
});

describe('Coverage', () => {
  it('RAW-020 lcov with a unified diff (multipart): line, branch and changed-code coverage; test_coverage written', async () => {
    if (!up) return;
    const r = await request(API_URL).post('/api/ingest/coverage').set('Authorization', `Bearer ${apiKey}`)
      .field('team', TEAM).field('commit', 'c2').field('branch', 'main').field('startedAt', `${D}T11:00:00Z`)
      .attach('report', F('lcov.info'), 'lcov.info').attach('diff', F('changes.diff'), 'changes.diff');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ format: 'lcov', totals: { linesFound: 14, linesHit: 11 }, changedLines: { found: 3, hit: 1 } });
    expect((await evidence('line_coverage', D)).value).toBe(78.57);
    expect((await evidence('branch_coverage', D)).value).toBe(50);
    expect((await evidence('changed_code_coverage', D)).value).toBe(33.33);
    expect(await snapshot(D, 'test_coverage')).toEqual({ v: 78.57, source: 'computed' });
  });

  it('RAW-021 gzip (Content-Encoding) Cobertura on a feature branch does not replace the main-branch coverage; until it is the main branch', async () => {
    if (!up) return;
    const r = await raw('coverage', { team: TEAM, commit: 'c6', branch: 'develop', startedAt: `${D}T13:00:00Z` }, gzipSync(F('cobertura.xml')), { 'Content-Encoding': 'gzip', 'Content-Type': 'application/xml' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ format: 'cobertura', totals: { linesFound: 6, linesHit: 3 } });
    expect((await evidence('line_coverage', D)).value).toBe(78.57);
    const set = await put(`/api/ci/teams/${TEAM}/main-branch`, adminCookie, { mainBranch: 'develop' });
    expect(set.status).toBe(200);
    // The next upload recalculates the day with the new main branch.
    await raw('coverage', { team: TEAM, commit: 'c7', branch: 'develop', format: 'jacoco', startedAt: `${D}T14:00:00Z` }, F('jacoco.xml'));
    expect((await evidence('line_coverage', D)).value).toBe(73.91); // JaCoCo 17 ÷ 23
    await put(`/api/ci/teams/${TEAM}/main-branch`, adminCookie, { mainBranch: '' });
  });

  it('RAW-022 Istanbul json-summary and coverage-final.json (gzipped file in multipart)', async () => {
    if (!up) return;
    const s = await raw('coverage', { team: TEAM, commit: 'c8', run: 's1', startedAt: `${D1}T10:00:00Z` }, F('istanbul-summary.json').toString(), { 'Content-Type': 'application/json' });
    expect(s.status).toBe(201);
    expect(s.body).toMatchObject({ format: 'istanbul-summary', totals: { linesFound: 30, linesHit: 18 } });
    const f = await request(API_URL).post('/api/ingest/coverage').set('Authorization', `Bearer ${apiKey}`)
      .field('team', TEAM).field('commit', 'c9').field('startedAt', `${D1}T11:00:00Z`).attach('report', gzipSync(F('istanbul-final.json')), 'coverage-final.json.gz');
    expect(f.status).toBe(201);
    expect(f.body).toMatchObject({ format: 'istanbul', totals: { linesFound: 3, linesHit: 2 } });
    expect((await evidence('line_coverage', D1)).value).toBe(66.67); // the day's latest main-branch report
  });
});

describe('Pipelines', () => {
  const run = (over: Record<string, unknown>) => ({ ...JSON.parse(F('pipeline-github.json').toString()), ...over });
  const at = (t: string) => `${D1}T${t}:00Z`;
  it('RAW-030 runs with stages: build time, success rate, first-time pass rate, parallel test efficiency', async () => {
    if (!up) return;
    const p1 = run({ startedAt: at('08:00'), finishedAt: at('08:12'), stages: run({}).stages.map((s: any) => ({ ...s, startedAt: s.startedAt.replace('2026-11-18', D1), finishedAt: s.finishedAt.replace('2026-11-18', D1) })) });
    const r1 = await raw('pipelines', { team: TEAM }, JSON.stringify(p1), { 'Content-Type': 'application/json' });
    expect(r1.status).toBe(201);
    const r2 = await raw('pipelines', {}, JSON.stringify({ team: TEAM, runs: [
      { id: 'p2', attempt: 1, startedAt: at('09:00'), durationSeconds: 600, result: 'failure', stages: [{ name: 'integration-tests', durationSeconds: 500, result: 'failed' }] },
      { id: 'p2', attempt: 2, startedAt: at('09:20'), durationSeconds: 900, result: 'success', stages: [{ name: 'integration-tests', durationSeconds: 800, result: 'success' }] },
    ] }), { 'Content-Type': 'application/json' });
    expect(r2.status).toBe(201);
    expect((await evidence('build_time', D1)).value).toBe(12); // median(720, 600, 900) s
    expect((await evidence('pipeline_success_rate', D1)).value).toBe(66.67);
    expect((await evidence('first_time_pass_rate', D1)).value).toBe(50); // pipelines replace the test-run basis
    expect((await evidence('parallel_test_efficiency', D1)).value).toBe(83.33); // (6 + 4 + 5) ÷ (3 × 6) min
    expect(await snapshot(D1, 'avg_build_time_minutes')).toEqual({ v: 12, source: 'computed' });
  });

  it('RAW-031 a repeated run is a duplicate; invalid events name the field', async () => {
    if (!up) return;
    const dup = await raw('pipelines', { team: TEAM }, JSON.stringify({ id: 'p2', attempt: 2, startedAt: at('09:20'), durationSeconds: 900, result: 'success' }), { 'Content-Type': 'application/json' });
    expect(dup.status).toBe(200);
    expect(dup.body.status).toBe('duplicate');
    const bad = await raw('pipelines', { team: TEAM }, JSON.stringify({ id: 'p3', startedAt: at('10:00'), result: 'maybe' }), { 'Content-Type': 'application/json' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/runs\[0\]\.result must be one of/);
    const notJson = await raw('pipelines', { team: TEAM }, 'id=1', { 'Content-Type': 'application/json' });
    expect(notJson.body.error).toMatch(/must be JSON/);
  });
});

describe('Ingestion log, evidence, How this was calculated, Connect your CI', () => {
  it('RAW-040 every request is in the ingestion log: accepted uploads with their kind and format, rejected ones with the reason', async () => {
    if (!up) return;
    const rows = (await db.query(`SELECT source, status, value_count FROM ingestion_log WHERE company_id = $1 AND source ~ '^(tests|coverage|pipelines)'`, [GOLDEN_COMPANY])).rows;
    expect(rows.some((r) => r.source === 'tests (junit)' && r.status === 'accepted' && r.value_count === 5)).toBe(true);
    expect(rows.some((r) => r.source === 'coverage (lcov)' && r.status === 'accepted')).toBe(true);
    expect(rows.some((r) => r.source === 'pipelines' && r.status === 'accepted')).toBe(true);
    expect(rows.some((r) => r.source === 'tests (junit, test call)')).toBe(true);
    expect(rows.filter((r) => r.status === 'rejected').length).toBeGreaterThanOrEqual(5);
    const list = await get('/api/ingestion-log', adminCookie);
    expect(list.status).toBe(200);
  });

  it('RAW-041 evidence: flaky tests with proving runs, lowest-coverage files, slowest tests, failing stages, last data received', async () => {
    if (!up) return;
    const r = await get(`/api/ci/teams/${TEAM}/evidence`, adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.flakyTests.map((f: any) => f.name).sort()).toEqual(['test_ledger_close', 'test_refund_partial']);
    const f = r.body.flakyTests.find((x: any) => x.name === 'test_refund_partial');
    expect(f.failedRuns[0]).toMatchObject({ runId: 'r1', attempt: 1, commit: 'c1' });
    expect(f.passedRuns[0]).toMatchObject({ runId: 'r1', attempt: 2 });
    expect(r.body.coverage.lowestFiles[0]).toMatchObject({ coverage: expect.any(Number) });
    expect(r.body.slowestTests.length).toBeGreaterThan(0);
    expect(r.body.failingStages[0]).toMatchObject({ name: 'integration-tests', failed: 1, runs: 2, failureRate: 50 });
    expect(r.body.lastReceived.tests.uploads).toBeGreaterThan(0);
  });

  it('RAW-042 How this was calculated: formula, values used, runs and the source records (by KPI column or metric key)', async () => {
    if (!up) return;
    const cov = await get(`/api/ci/teams/${TEAM}/metrics/test_coverage?date=${D}`, adminCookie);
    expect(cov.status).toBe(200);
    expect(cov.body).toMatchObject({ metric: 'line_coverage', value: 73.91, day: D, kpiColumn: 'test_coverage' });
    expect(cov.body.formula).toMatch(/lines hit ÷ lines found/);
    expect(cov.body.sources.coverageReports[0]).toMatchObject({ format: 'jacoco', linesFound: 23, linesHit: 17 });
    const flaky = await get(`/api/ci/teams/${TEAM}/metrics/test_flakiness_rate?date=${D}`, adminCookie);
    expect(flaky.body.flakyTests.length).toBe(2);
    expect(flaky.body.sources.testRuns.length).toBeGreaterThanOrEqual(2);
    const build = await get(`/api/ci/teams/${TEAM}/metrics/build_time?date=${D1}`, adminCookie);
    expect(build.body.sources.pipelineRuns.map((p: any) => p.runId).sort()).toEqual(['6612345678', 'p2', 'p2']);
    expect((await get(`/api/ci/teams/${TEAM}/metrics/defect_density`, adminCookie)).status).toBe(404);
  });

  it('RAW-043 access: an engineer of another team is refused the evidence and the CI status; the admin sees the status', async () => {
    if (!up) return;
    const eng = (await login('small-2@golden.example')).cookie;
    expect((await get(`/api/ci/teams/${TEAM}/evidence`, eng)).status).toBe(403);
    expect((await get(`/api/ci/teams/${TEAM}/metrics/pass_rate`, eng)).status).toBe(403);
    expect((await get('/api/ci/status', eng)).status).toBe(403);
    expect((await put(`/api/ci/teams/${TEAM}/main-branch`, eng, { mainBranch: 'x' })).status).toBe(403);
    const st = await get('/api/ci/status', adminCookie);
    expect(st.status).toBe(200);
    const row = st.body.teams.find((t: any) => t.id === TEAM);
    expect(row.tests.uploads).toBeGreaterThan(0);
    expect(row.coverage.format).toBeTruthy();
    expect(row.pipelines.uploads).toBe(2);
    expect((await put(`/api/ci/teams/${TEAM}/main-branch`, adminCookie, { mainBranch: 'has space' })).status).toBe(400);
  });
});
