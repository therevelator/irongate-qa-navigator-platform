import { createHash } from 'crypto';
import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

/**
 * The raw sources of the last typed-in modules (server/routes/ingestMore.ts, migration 20261209000000), end to end
 * against a live backend with the golden fixture company. Every expected value is counted by hand from the records
 * sent. Skips when no backend runs.
 *
 *   PERF-01  a k6 summary export and a JMeter statistics.json are parsed; the Performance page shows the latest run
 *            of the day per endpoint; the same run again is a duplicate; another file is refused (415)
 *   TM-01    test cases → automation_coverage (computed); a re-send changes nothing
 *   TM-02    automated executions of cases with an estimate, and time logged on test-automation work → automation_roi
 *   TM-03    in live operation a finished automation_coverage is refused: QE Navigator calculates all 23 KPIs
 *   DEV-01   pull requests and calendar days of an opted-in developer → their developer metrics, calculated
 *   DEV-02   a person who did not enable developer insights: the pull request loses its author, the calendar day is not kept
 *   DEV-03   a name or an e-mail address instead of a pseudonym is refused; an unknown field is refused
 *   EXP-01   the same records in the Exporter's envelope (kinds performance, test-management, pull-requests, calendar)
 */
const TEAM = 'golden-team-empty';
const DEV_TEAM = 'golden-team-big';
const DEV_EMAIL = 'team-big-1@golden.example';

let up = true;
let db: Client;
let admin = '';
let apiKey = '';
let devEmail = DEV_EMAIL;
let devId = '';

const hash = (email: string) => createHash('sha256').update(`${email.toLowerCase()}:${GOLDEN_COMPANY}`).digest('hex');
const send = (kind: string, team: string, body: unknown, query = '') =>
  request(API_URL).post(`/api/ingest/${kind}?team=${team}${query}`).set('Authorization', `Bearer ${apiKey}`).send(body as object);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const dayAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
const snapshot = async (team: string, col: string) =>
  (await db.query(`SELECT ${col}::float8 AS v, field_sources -> '${col}' ->> 'source' AS source FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date = $2::date`, [team, today()])).rows[0] ?? null;

const K6 = JSON.stringify({ metrics: {
  http_req_duration: { avg: 180.2, med: 150.5, 'p(90)': 320, 'p(95)': 410.25, 'p(99)': 980, max: 2100 },
  http_reqs: { count: 12000, rate: 100 },
  http_req_failed: { value: 0.015, passes: 180, fails: 11820 },
} });
const JMETER = JSON.stringify({
  'GET /orders': { transaction: 'GET /orders', sampleCount: 600, errorCount: 6, errorPct: 1.0, medianResTime: 120, pct1ResTime: 200, pct2ResTime: 260, pct3ResTime: 480, throughput: 10 },
  Total: { transaction: 'Total', sampleCount: 1000, errorCount: 30, errorPct: 3.0, medianResTime: 140, pct1ResTime: 240, pct2ResTime: 300, pct3ResTime: 700, throughput: 16.5 },
});

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running at', API_URL, '- more sources tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  await db.query(`UPDATE companies SET settings = COALESCE(settings, '{}'::jsonb) - 'liveDataOnly' WHERE id = $1`, [GOLDEN_COMPANY]);
  admin = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  apiKey = (await post('/api/admin/api-keys', admin, { name: 'More sources test key' })).body.plaintextKey;
  const dev = (await db.query(
    `SELECT u.id, u.email FROM users u JOIN role_assignments ra ON ra.user_id = u.id AND ra.scope_type = 'team' AND ra.scope_id = $1
      WHERE u.company_id = $2 AND u.developer_insights_enabled ORDER BY u.id LIMIT 1`, [DEV_TEAM, GOLDEN_COMPANY])).rows[0];
  devEmail = dev.email;
  devId = dev.id;
});

afterAll(async () => {
  if (db) {
    await db.query(`UPDATE companies SET settings = COALESCE(settings, '{}'::jsonb) - 'liveDataOnly' WHERE id = $1`, [GOLDEN_COMPANY]);
    await removeGolden(db);
    await db.end();
  }
});

describe('Performance: load-test result files', () => {
  it('PERF-01 k6 and JMeter results are parsed and shown; a repeat is a duplicate; another file is refused', async () => {
    if (!up) return;
    const before = await get(`/api/analytics/performance-metrics?teamId=${TEAM}`, admin);
    expect(before.body).toEqual(expect.objectContaining({ metrics: [], source: 'module' }));

    const k6 = await send('performance', TEAM, [{ run: 'load-1', commit: 'abc123', branch: 'main', startedAt: hoursAgo(3), files: [{ name: 'summary.json', content: K6 }] }]);
    expect(k6.status).toBe(201);
    expect(k6.body.runs).toEqual([{ run: 'load-1#1', tool: 'k6', endpoints: 1, status: 'written' }]);
    // A later run of the same day: its values are the day's.
    const jm = await send('performance', TEAM, [{ run: 'load-2', startedAt: hoursAgo(1), files: [{ name: 'statistics.json', content: JMETER }] }]);
    expect(jm.status).toBe(201);
    expect(jm.body.runs[0]).toEqual(expect.objectContaining({ tool: 'jmeter', endpoints: 2 }));
    expect((await send('performance', TEAM, [{ run: 'load-2', startedAt: hoursAgo(1), files: [{ name: 'statistics.json', content: JMETER }] }])).body.status).toBe('duplicate');

    const page = await get(`/api/analytics/performance-metrics?teamId=${TEAM}`, admin);
    expect(page.body.source).toBe('ci');
    const by = Object.fromEntries(page.body.metrics.map((m: any) => [m.endpoint, m]));
    // "(all requests)": the JMeter run is the later one. 16.5 requests per second = 990 per minute.
    expect(by['(all requests)']).toEqual(expect.objectContaining({ tool: 'jmeter', response_time_p50: 140, response_time_p95: 300, response_time_p99: 700, throughput: 990, error_rate: 3, requests: 1000 }));
    expect(by['GET /orders']).toEqual(expect.objectContaining({ response_time_p50: 120, response_time_p95: 260, response_time_p99: 480, throughput: 600, error_rate: 1 }));
    // The k6 run alone: median 150.5, p95 410.25, p99 980, 100 requests per second, 1.5 % failed.
    const k6row = (await db.query(
      `SELECT r.requests, r.errors, r.p50_ms::float8 AS p50, r.p95_ms::float8 AS p95, r.p99_ms::float8 AS p99, r.throughput_per_minute::float8 AS tpm, r.error_rate::float8 AS er
         FROM performance_results r JOIN performance_runs p ON p.id = r.run_id WHERE p.team_id = $1 AND p.run_key = 'load-1#1'`, [TEAM])).rows[0];
    expect(k6row).toEqual({ requests: 12000, errors: 180, p50: 150.5, p95: 410.25, p99: 980, tpm: 6000, er: 1.5 });

    const bad = await send('performance', TEAM, [{ run: 'load-3', startedAt: hoursAgo(1), files: [{ name: 'package.json', content: '{"name":"x"}' }] }]);
    expect(bad.status).toBe(415);
    expect((await send('performance', TEAM, [{ run: 'x', startedAt: hoursAgo(1), files: [{ name: 'a', content: K6 }], p95: 12 }])).status).toBe(400);
  });
});

describe('Test management: automation coverage and ROI', () => {
  const CASES = [
    { type: 'case', key: 'C1', automated: true, manualEstimateSeconds: 1800 },
    { type: 'case', key: 'C2', automated: true, manualEstimateSeconds: 1800 },
    { type: 'case', key: 'C3', automated: true },
    { type: 'case', key: 'C4', automated: false, manualEstimateSeconds: 600 },
    { type: 'case', key: 'C5', automated: true, archived: true },
  ];

  it('TM-01 automation coverage is calculated from the test cases', async () => {
    if (!up) return;
    const res = await send('test-management', TEAM, CASES, '&source=testrail');
    expect(res.status).toBe(201);
    expect(res.body.cases).toEqual({ received: 5, changed: 5 });
    // 3 automated of 4 cases (the archived one is not counted): 75 %.
    expect(await snapshot(TEAM, 'automation_coverage')).toEqual({ v: 75, source: 'computed' });
    const ev = (await db.query(`SELECT inputs FROM metric_evidence WHERE team_id = $1 AND day = $2::date AND metric_key = 'automation_coverage'`, [TEAM, today()])).rows[0];
    expect(ev.inputs).toEqual(expect.objectContaining({ automatedCases: 3, testCases: 4 }));
    const again = await send('test-management', TEAM, CASES, '&source=testrail');
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('duplicate');
    // How this was calculated answers for the KPI.
    const how = await get(`/api/ci/teams/${TEAM}/metrics/automation_coverage`, admin);
    expect(how.status).toBe(200);
    expect(how.body.value).toBe(75);
  });

  it('TM-02 automation ROI from automated executions and the time logged on test-automation work', async () => {
    if (!up) return;
    expect(await snapshot(TEAM, 'automation_roi')).toEqual(expect.objectContaining({ v: null }));
    const runs = await send('test-management', TEAM, [
      { type: 'execution', key: 'R1', case: 'C1', automated: true, status: 'passed', executedAt: hoursAgo(30), durationSeconds: 60 },
      { type: 'execution', key: 'R2', case: 'C2', automated: true, status: 'failed', executedAt: hoursAgo(20), durationSeconds: 60 },
      { type: 'execution', key: 'R3', case: 'C3', automated: true, executedAt: hoursAgo(10), durationSeconds: 30 }, // no estimate: not counted
      { type: 'execution', key: 'R4', case: 'C4', automated: false, executedAt: hoursAgo(10), durationSeconds: 500 }, // a manual run
    ], '&source=testrail');
    expect(runs.status).toBe(201);
    // No time invested is known yet: no ROI.
    expect(await snapshot(TEAM, 'automation_roi')).toEqual(expect.objectContaining({ v: null }));
    const issues = await request(API_URL).post(`/api/ingest/issues?team=${TEAM}&format=json`).set('Authorization', `Bearer ${apiKey}`).send({ issues: [
      { key: 'QA-1', type: 'Task', status: 'Done', statusCategory: 'done', createdAt: hoursAgo(200), resolvedAt: hoursAgo(40), updatedAt: hoursAgo(40), timeLoggedHours: 0.5, labels: ['test-automation'] },
      { key: 'QA-2', type: 'Task', status: 'Done', statusCategory: 'done', createdAt: hoursAgo(200), resolvedAt: hoursAgo(40), updatedAt: hoursAgo(40), timeLoggedHours: 8, labels: ['feature'] },
    ] });
    expect(issues.status).toBe(201);
    // Issues recalculate their own group; the automation values follow with the next test management delivery.
    const more = await send('test-management', TEAM, [{ type: 'execution', key: 'R5', case: 'C4', automated: false, executedAt: hoursAgo(5) }], '&source=testrail');
    expect(more.status).toBe(201);
    // Saved: (1800 − 60) × 2 = 3480 s. Invested: 0.5 h = 1800 s. (3480 − 1800) ÷ 1800 × 100 = 93.33.
    expect(await snapshot(TEAM, 'automation_roi')).toEqual({ v: 93.33, source: 'computed' });
    const ev = (await db.query(`SELECT inputs FROM metric_evidence WHERE team_id = $1 AND day = $2::date AND metric_key = 'automation_roi'`, [TEAM, today()])).rows[0];
    expect(ev.inputs).toEqual(expect.objectContaining({ timeSavedHours: 0.97, timeInvestedHours: 0.5, automatedExecutions: 2, automationWorkItems: 1 }));
  });

  it('TM-03 in live operation a finished automation value is refused: every KPI is calculated', async () => {
    if (!up) return;
    await db.query(`UPDATE companies SET settings = COALESCE(settings, '{}'::jsonb) || '{"liveDataOnly": true}'::jsonb WHERE id = $1`, [GOLDEN_COMPANY]);
    const res = await request(API_URL).post('/api/ingest/kpis').set('Authorization', `Bearer ${apiKey}`).send({ teamId: TEAM, source: 'testrail', metrics: { automation_coverage: 61.5, automation_roi: 10 } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('automation_coverage is calculated by QE Navigator');
    expect(JSON.stringify(res.body)).toContain('automation_roi is calculated by QE Navigator');
    await db.query(`UPDATE companies SET settings = COALESCE(settings, '{}'::jsonb) - 'liveDataOnly' WHERE id = $1`, [GOLDEN_COMPANY]);
  });
});

describe('Developer metrics from pull requests and calendars', () => {
  it('DEV-01 the metrics of an opted-in developer are calculated from their records', async () => {
    if (!up) return;
    const me = hash(devEmail);
    const prs = await send('pull-requests', DEV_TEAM, [
      { id: '101', repo: 'acme/payments', author: me, state: 'merged', openedAt: hoursAgo(100), firstReviewAt: hoursAgo(98), mergedAt: hoursAgo(94) },
      { id: '102', repo: 'acme/payments', author: me, state: 'merged', openedAt: hoursAgo(60), firstReviewAt: hoursAgo(56), mergedAt: hoursAgo(50) },
      { id: '103', repo: 'acme/payments', author: me, state: 'open', openedAt: hoursAgo(5) },
    ], '&source=github');
    expect(prs.status).toBe(201);
    expect(prs.body.pullRequests).toEqual({ received: 3, changed: 3, withAuthor: 3 });
    const d1 = dayAgo(2);
    const d2 = dayAgo(1);
    const cal = await send('calendar', DEV_TEAM, [
      { person: me, day: d1, workStart: '09:00', workEnd: '17:00', utcOffsetMinutes: 0, busy: [{ start: `${d1}T10:00:00Z`, end: `${d1}T11:00:00Z` }, { start: `${d1}T13:00:00Z`, end: `${d1}T13:30:00Z` }, { start: `${d1}T19:00:00Z`, end: `${d1}T20:00:00Z` }] },
      { person: me, day: d2, busy: [] },
    ], '&source=google-calendar');
    expect(cal.status).toBe(201);
    expect(cal.body.days).toEqual({ received: 2, kept: 2, changed: 2, notOptedIn: 0 });
    expect(cal.body.developers.developers).toBe(1);

    const row = (await db.query(
      `SELECT pr_merge_time_avg::float8 AS merge, code_review_time_avg::float8 AS review, focus_time_hours::float8 AS focus, meeting_time_hours::float8 AS meetings,
              context_switches_per_day AS switches, happiness_score::float8 AS balance, source FROM developer_metrics WHERE team_id = $1 AND developer_id = $2`, [DEV_TEAM, devId])).rows[0];
    // Merge: (6 + 10) ÷ 2 = 8 h. First review: (2 + 4) ÷ 2 = 3 h.
    // Day 1 (09:00–17:00): busy 60 + 30 min inside working hours (the 19:00 one is outside) = 1.5 h; free blocks of two hours or
    // more: 11:00–13:00 (2 h) and 13:30–17:00 (3.5 h) = 5.5 h; 2 busy blocks. Day 2: no meeting, 8 h free, 0 blocks.
    // Means over the 2 working days: meetings 0.75 h, focus 6.75 h, 1 block.
    expect(row).toEqual(expect.objectContaining({ merge: 8, review: 3, focus: 6.75, meetings: 0.75, switches: 1, source: 'computed' }));
    expect(row.balance).toBeGreaterThan(0);
    // The DDPS history has today's snapshot.
    const snap = (await db.query(`SELECT ddps_score::float8 AS s FROM developer_productivity_snapshots WHERE developer_id = $1 AND snapshot_date = CURRENT_DATE`, [devId])).rows[0];
    expect(snap.s).toBeGreaterThan(0);
    // The same records again: nothing changes.
    expect((await send('calendar', DEV_TEAM, [{ person: me, day: d2, busy: [] }], '&source=google-calendar')).body.status).toBe('duplicate');
  });

  it('DEV-02 someone who did not enable developer insights is not kept as a person', async () => {
    if (!up) return;
    const stranger = hash('not.a.user@golden.example');
    const prs = await send('pull-requests', DEV_TEAM, [{ id: '201', repo: 'acme/payments', author: stranger, state: 'merged', openedAt: hoursAgo(30), mergedAt: hoursAgo(20) }], '&source=github');
    expect(prs.body.pullRequests).toEqual({ received: 1, changed: 1, withAuthor: 0 });
    expect((await db.query(`SELECT author_hash FROM pull_requests_raw WHERE team_id = $1 AND pr_key = '201'`, [DEV_TEAM])).rows[0].author_hash).toBeNull();
    const cal = await send('calendar', DEV_TEAM, [{ person: stranger, day: dayAgo(1), busy: [] }], '&source=google-calendar');
    expect(cal.body.days).toEqual({ received: 1, kept: 0, changed: 0, notOptedIn: 1 });
    expect(Number((await db.query(`SELECT COUNT(*) AS n FROM calendar_days WHERE person_hash = $1`, [stranger])).rows[0].n)).toBe(0);
  });

  it('DEV-03 a name or an e-mail address instead of a pseudonym, and an unknown field, are refused', async () => {
    if (!up) return;
    const named = await send('pull-requests', DEV_TEAM, [{ id: '301', author: 'alice@golden.example', openedAt: hoursAgo(3) }]);
    expect(named.status).toBe(400);
    expect(named.body.error).toContain('pseudonym');
    expect((await send('pull-requests', DEV_TEAM, [{ id: '302', openedAt: hoursAgo(3), title: 'Fix the thing' }])).status).toBe(400);
    expect((await send('calendar', DEV_TEAM, [{ person: hash(devEmail), day: dayAgo(1), busy: [{ start: hoursAgo(30), end: hoursAgo(29), subject: '1:1' }] }])).status).toBe(400);
    expect((await send('calendar', 'no-such-team', [{ person: hash(devEmail), day: dayAgo(1) }])).status).toBe(403);
  });
});

describe('The same records in the Exporter envelope', () => {
  it('EXP-01 the four kinds are accepted, checked against the key and written to the team of the envelope', async () => {
    if (!up) return;
    const batch = (kind: string, items: unknown[], team = TEAM, dept = 'golden-dept-b') =>
      request(API_URL).post('/api/ingest/exporter/batch').set('Authorization', `Bearer ${apiKey}`).set('User-Agent', 'qe-exporter/0.4.0')
        .send({ companyId: GOLDEN_COMPANY, departmentId: dept, teamId: team, source: 'jenkins', kind, items });
    const perf = await batch('performance', [{ run: 'exp-load-1', startedAt: hoursAgo(50), files: [{ name: 'summary.json', content: K6 }] }]);
    expect(perf.status).toBe(201);
    expect(perf.body.written).toBe(1);
    const tm = await batch('test-management', [{ type: 'case', key: 'C9', automated: false }]);
    expect(tm.status).toBe(201);
    // 3 automated of 5 cases now.
    expect(await snapshot(TEAM, 'automation_coverage')).toEqual({ v: 60, source: 'computed' });
    const dept = (await db.query('SELECT department_id FROM teams WHERE id = $1', [DEV_TEAM])).rows[0].department_id;
    expect((await batch('pull-requests', [{ id: '401', repo: 'acme/web', author: hash(devEmail), openedAt: hoursAgo(2) }], DEV_TEAM, dept)).status).toBe(201);
    expect((await batch('calendar', [{ person: hash(devEmail), day: dayAgo(3), busy: [] }], DEV_TEAM, dept)).status).toBe(201);
    // An item the handler refuses refuses the batch; nothing is written.
    const bad = await batch('pull-requests', [{ id: '402', openedAt: hoursAgo(2), author: 'Bob' }], DEV_TEAM, dept);
    expect(bad.status).toBe(400);
    expect(Number((await db.query(`SELECT COUNT(*) AS n FROM pull_requests_raw WHERE pr_key = '402'`)).rows[0].n)).toBe(0);
  });
});
