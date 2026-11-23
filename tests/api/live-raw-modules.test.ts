import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post, put } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

/**
 * The Analytics modules read the raw CI data a team sent (server/lib/analyticsFromRaw.ts), and the
 * "live data only" company setting (server/lib/liveData.ts): nothing typed, no finished value for a
 * KPI QE Navigator calculates. Against a live backend with the golden fixture company
 * (golden-team-empty: no other data). Skips when no backend runs.
 *
 *   LRM-01  a team that sent nothing: the modules answer from the module tables, empty
 *   LRM-02  two reports of one commit (failed, then passed): Flaky tests names the test, from CI
 *   LRM-03  Test execution lists the two runs with their counts and results
 *   LRM-04  CI/CD pipeline: stages with hand-counted mean duration and success rate, daily executions
 *   LRM-05  a stage calculated from CI cannot be edited
 *   LRM-06  SonarQube's coverage totals (Exporter envelope): accepted, the percentage calculated here
 *   LIVE-01 the setting reaches the signed-in user (/auth/me)
 *   LIVE-02 Manual metrics, developer metrics: refused (403, code live_data_only)
 *   LIVE-03 POST /ingest/kpis: a finished value is refused for every KPI (all 23 are calculated from raw data)
 *   LIVE-04 Business impact: typed quality values refused or left out; business figures saved
 *   LIVE-05 with the setting off again, manual entry works as before
 */
const TEAM = 'golden-team-empty';
const COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

let up = true;
let db: Client;
let admin = '';
let apiKey = '';

const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const junit = (flakyFails: boolean) =>
  `<?xml version="1.0"?><testsuites><testsuite name="checkout" time="3.5">` +
  `<testcase classname="checkout" name="pays with a saved card" time="2.0">${flakyFails ? '<failure message="timeout"/>' : ''}</testcase>` +
  `<testcase classname="checkout" name="declines an expired card" time="1.5"/></testsuite></testsuites>`;
const sendTests = (attempt: number, body: string) =>
  request(API_URL).post(`/api/ingest/tests?${new URLSearchParams({ team: TEAM, commit: COMMIT, branch: 'main', run: 'lrm-run-1', attempt: String(attempt) })}`)
    .set('Authorization', `Bearer ${apiKey}`).set('Content-Type', 'application/xml').send(body);
const setLive = (on: boolean) =>
  db.query(`UPDATE companies SET settings = COALESCE(settings, '{}'::jsonb) ${on ? `|| '{"liveDataOnly": true}'::jsonb` : `- 'liveDataOnly'`} WHERE id = $1`, [GOLDEN_COMPANY]);

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running at', API_URL, '- live raw modules tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  await setLive(false);
  admin = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  apiKey = (await post('/api/admin/api-keys', admin, { name: 'Live raw modules test key' })).body.plaintextKey;
});

afterAll(async () => {
  if (db) { await setLive(false); await removeGolden(db); await db.end(); }
});

describe('Analytics modules from raw CI data', () => {
  it('LRM-01 a team that sent nothing answers from the module tables, empty', async () => {
    if (!up) return;
    const flaky = await get(`/api/analytics/flaky-tests?teamId=${TEAM}`, admin);
    expect(flaky.status).toBe(200);
    expect(flaky.body.flakyTests).toEqual([]);
    const runs = await get(`/api/analytics/test-executions?teamId=${TEAM}&days=7`, admin);
    expect(runs.body).toEqual(expect.objectContaining({ executions: [], source: 'module' }));
    const hist = await get(`/api/analytics/pipeline-history?teamId=${TEAM}`, admin);
    expect(hist.body).toEqual(expect.objectContaining({ history: [], source: 'module' }));
    expect((await get(`/api/analytics/pipeline-stages?teamId=${TEAM}`, admin)).body.stages_source).not.toBe('ci');
  });

  it('LRM-02 a test that failed and then passed on the same commit is listed as flaky, from CI', async () => {
    if (!up) return;
    expect((await sendTests(1, junit(true))).status).toBe(201);
    expect((await sendTests(2, junit(false))).status).toBe(201);
    const res = await get(`/api/analytics/flaky-tests?teamId=${TEAM}`, admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ source: 'ci', sample: false, windowDays: 30 }));
    expect(res.body.flakyTests).toHaveLength(1);
    const t = res.body.flakyTests[0];
    expect(t.test_name).toContain('pays with a saved card');
    // 1 flaky (failed) run of 2 runs of the test: 50; one passed.
    expect(t).toEqual(expect.objectContaining({ occurrences: 1, total_runs: 2, pass_count: 1, flakiness_score: 50, root_cause: null, root_cause_verified: false }));
    expect(t.commits).toEqual([COMMIT]);
    expect(t.history.map((h: any) => h.passed).sort()).toEqual([false, true]);
  });

  it('LRM-03 Test execution lists the two runs with their results and counts', async () => {
    if (!up) return;
    const res = await get(`/api/analytics/test-executions?teamId=${TEAM}&days=7`, admin);
    expect(res.body.source).toBe('ci');
    expect(res.body.executions).toHaveLength(2);
    const byAttempt = Object.fromEntries(res.body.executions.map((e: any) => [e.attempt, e]));
    expect(byAttempt[1]).toEqual(expect.objectContaining({ status: 'failed', total: 2, passed: 1, failed: 1, commit: COMMIT, branch: 'main', run_id: 'lrm-run-1' }));
    expect(byAttempt[2]).toEqual(expect.objectContaining({ status: 'passed', total: 2, passed: 2, failed: 0 }));
    expect(byAttempt[2].test_suite).toContain('attempt 2');
  });

  it('LRM-04 CI/CD pipeline shows the stages of the runs received, with hand-counted values', async () => {
    if (!up) return;
    const run = (id: string, startMin: number, testResult: 'success' | 'failed', testSeconds: number) => ({
      id, attempt: 1, name: 'ci', commit: COMMIT, branch: 'main', startedAt: iso(startMin), finishedAt: iso(startMin - 10),
      result: testResult,
      stages: [
        { name: 'build', startedAt: iso(startMin), finishedAt: iso(startMin - 2), durationSeconds: 120, result: 'success' },
        { name: 'unit tests', startedAt: iso(startMin - 2), finishedAt: iso(startMin - 6), durationSeconds: testSeconds, result: testResult },
      ],
    });
    const sent = await request(API_URL).post(`/api/ingest/pipelines?team=${TEAM}`).set('Authorization', `Bearer ${apiKey}`)
      .send([run('lrm-p1', 90, 'success', 200), run('lrm-p2', 60, 'failed', 300), run('lrm-p3', 30, 'success', 100)]);
    expect(sent.status).toBe(201);

    const res = await get(`/api/analytics/pipeline-stages?teamId=${TEAM}`, admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ stages_source: 'ci', source: 'ci', sample: false, pipeline_runs: 3 }));
    expect(res.body.stages.map((s: any) => s.name)).toEqual(['build', 'unit tests']);
    const [build, tests] = res.body.stages;
    expect(build).toEqual(expect.objectContaining({ duration: 120, success_rate: 100, runs: 3, failed_runs: 0, manually_edited: false }));
    // (200 + 300 + 100) / 3 = 200 s; 2 of 3 executions succeeded.
    expect(tests).toEqual(expect.objectContaining({ duration: 200, success_rate: 66.7, runs: 3, failed_runs: 1 }));
    expect(build.resource_usage).toEqual(expect.objectContaining({ cpu: null, memory: null }));
    expect(tests.bottleneck_score).toBeGreaterThan(build.bottleneck_score);

    const hist = await get(`/api/analytics/pipeline-history?teamId=${TEAM}&days=14`, admin);
    expect(hist.body.source).toBe('ci');
    const total = hist.body.history.reduce((n: number, d: any) => n + d.total_runs, 0);
    const failed = hist.body.history.reduce((n: number, d: any) => n + d.failed_runs, 0);
    expect({ total, failed }).toEqual({ total: 6, failed: 1 });
  });

  it('LRM-05 a stage calculated from CI is not an editable row', async () => {
    if (!up) return;
    const id = (await get(`/api/analytics/pipeline-stages?teamId=${TEAM}`, admin)).body.stages[0].id;
    expect((await put(`/api/analytics/pipeline-stages/${id}`, admin, { duration: 1 })).status).toBe(404);
  });
});

describe('Coverage totals from SonarQube (Exporter, coverage: true)', () => {
  it('LRM-06 a totals-only coverage report with lines of code is accepted and QE Navigator calculates the percentage', async () => {
    if (!up) return;
    const res = await request(API_URL).post('/api/ingest/exporter/batch').set('Authorization', `Bearer ${apiKey}`).set('User-Agent', 'qe-exporter/0.3.0').send({
      companyId: GOLDEN_COMPANY, departmentId: 'golden-dept-b', teamId: TEAM, source: 'sonarqube', kind: 'coverage',
      items: [{ commit: COMMIT, branch: 'main', run: 'AYx-1', attempt: 1, startedAt: iso(20), format: 'lcov', repo: 'acme_payments', loc: 48000,
        files: [{ name: 'coverage-summary.info', content: 'TN:\nSF:(total)\nLF:20000\nLH:15600\nBRF:3000\nBRH:2100\nend_of_record\n' }] }],
    });
    expect(res.status).toBe(201);
    const day = iso(20).slice(0, 10);
    const ev = await db.query(`SELECT value::float8 AS v FROM metric_evidence WHERE team_id = $1 AND day = $2::date AND metric_key = 'line_coverage'`, [TEAM, day]);
    expect(ev.rows[0]?.v).toBe(78);
    const snap = await db.query(`SELECT test_coverage::float8 AS v, field_sources -> 'test_coverage' ->> 'source' AS source FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date = $2::date`, [TEAM, day]);
    expect(snap.rows[0]).toEqual({ v: 78, source: 'computed' });
  });
});

describe('Live data only', () => {
  it('LIVE-01 the setting reaches the signed-in user', async () => {
    if (!up) return;
    expect((await get('/api/auth/me', admin)).body.user.live_data_only).toBe(false);
    await setLive(true);
    expect((await get('/api/auth/me', admin)).body.user.live_data_only).toBe(true);
  });

  it('LIVE-02 typed metrics are refused: Manual metrics and developer metrics', async () => {
    if (!up) return;
    const manual = await post('/api/metrics/manual', admin, { teamId: TEAM, test_coverage: 81 });
    expect(manual.status).toBe(403);
    expect(manual.body.code).toBe('live_data_only');
    const dev = await post('/api/metrics/developer', admin, { teamId: TEAM, developerId: 'anyone', focusTimeHours: 5 });
    expect(dev.status).toBe(403);
    expect(dev.body.code).toBe('live_data_only');
    expect(Number((await db.query(`SELECT COUNT(*) AS n FROM metric_values WHERE team_id = $1 AND source = 'manual'`, [TEAM])).rows[0].n)).toBe(0);
  });

  it('LIVE-03 a finished value is refused: every KPI is calculated from raw data', async () => {
    if (!up) return;
    const kpis = (metrics: object) => request(API_URL).post('/api/ingest/kpis').set('Authorization', `Bearer ${apiKey}`).send({ teamId: TEAM, source: 'jenkins', metrics });
    const refused = await kpis({ test_coverage: 80, automation_coverage: 61.5 });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain('test_coverage is calculated by QE Navigator');
    expect(JSON.stringify(refused.body)).toContain('automation_coverage is calculated by QE Navigator');
    expect((await kpis({ automation_roi: 12 })).status).toBe(400);
  });

  it('LIVE-04 Business impact: quality values are not typed; business figures are', async () => {
    if (!up) return;
    const q = await post(`/api/analytics/business-impact-v2/${TEAM}/quality-metrics`, admin, { month_year: '2026-01', test_coverage: 99 });
    expect(q.status).toBe(403);
    expect(q.body.code).toBe('live_data_only');
    const bulk = await post(`/api/analytics/business-impact-v2/${TEAM}/bulk-save`, admin,
      { monthlyData: [{ month_year: '2026-01', quality: { test_coverage: 99 }, kpis: { monthly_revenue: 120000 } }] });
    expect(bulk.status).toBe(200);
    expect(bulk.body).toEqual(expect.objectContaining({ monthsSaved: 1, qualityDerived: true }));
    const stored = await db.query(`SELECT test_coverage FROM business_impact_quality_metrics WHERE team_id = $1 AND month_year = '2026-01'`, [TEAM]);
    expect(stored.rows.some((r: any) => Number(r.test_coverage) === 99)).toBe(false);
    const revenue = await db.query(`SELECT monthly_revenue::float8 AS v FROM business_impact_business_kpis WHERE team_id = $1 AND month_year = '2026-01'`, [TEAM]);
    expect(revenue.rows[0]?.v).toBe(120000);
  });

  it('LIVE-05 with the setting off, manual entry works as before', async () => {
    if (!up) return;
    await setLive(false);
    const manual = await post('/api/metrics/manual', admin, { teamId: TEAM, automation_roi: 12 });
    expect([200, 201]).toContain(manual.status);
  });
});
