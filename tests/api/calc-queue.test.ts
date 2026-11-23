/**
 * The calculation queue (server/lib/calc/queue.ts, migration 20261206000000): on Netlify an ingestion request stores
 * the raw records and queues the affected days; the background function calc-drain-background recalculates them.
 * Run against the local database: the Netlify API function in-process (NETLIFY set: queued), the long-running API on
 * :3000 (inline, the old synchronous behaviour) for comparison, and the queue's functions directly.
 *
 *   CQ-001  enqueue merges overlapping and touching ranges per team and kinds; other kinds and running entries are kept apart
 *   CQ-002  a 15-run Exporter batch through the Netlify function answers with calculation "queued", in few round trips,
 *           without calculating; it starts one background drain; the background function then calculates it
 *   CQ-003  after the drain, every value equals what the synchronous path (the API on :3000) stored for the same data:
 *           pipeline runs, test reports, deployments, incidents and issues
 *   CQ-004  two drains at once never take the same entry
 *   CQ-005  a failing entry is retried with a delay, then marked failed with its error (and job_runs records it)
 *   CQ-006  a company's drain never touches another company's entries
 *   CQ-007  the direct endpoints defer too on Netlify; the ingestion log and Connect your CI show "calculation pending"
 *   CQ-008  the background function ignores a request without the signed token; the drain start is held while one runs
 *   CQ-009  off Netlify (INGEST_CALC=queued on the long-running server) the drain runs in this process after the answer
 */
import http from 'http';
import pg from 'pg';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

const saved = { NETLIFY: process.env.NETLIFY, URL: process.env.URL, INGEST_CALC: process.env.INGEST_CALC };
process.env.NETLIFY = 'true';
delete process.env.INGEST_CALC;

const DEPT = 'golden-dept-b';
const INLINE = 'golden-team-cq-inline';
const QUEUED = 'golden-team-cq-queued';
const SPARE = 'golden-team-cq-spare';
const DAY = 86_400_000;
const at = (daysAgo: number, hhmm = '10:00') => `${new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10)}T${hhmm}:00.000Z`;
const dayAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

let up = true;
let db: Client;
let apiKey = '';
let cookie = '';
let handler: (event: any, context: any) => Promise<any>;
let background: (req: Request) => Promise<void>;
let queue: typeof import('../../server/lib/calc/queue');
let stub: http.Server;
let kicks = 0;
let otherTeam: { company: string; team: string } | null = null;

const event = (path: string, body: unknown, headers: Record<string, string> = {}) => ({
  httpMethod: 'POST', path, rawUrl: `https://example.test${path}`, rawQuery: '', queryStringParameters: {}, multiValueQueryStringParameters: {},
  headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'user-agent': 'qe-exporter/0.3.0 (calc queue test)', 'x-nf-client-connection-ip': '203.0.113.20', ...headers },
  multiValueHeaders: {}, body: JSON.stringify(body), isBase64Encoded: false,
});
const envelope = (teamId: string, kind: string, items: unknown[], source = 'github') => ({ companyId: GOLDEN_COMPANY, departmentId: DEPT, teamId, source, kind, items });

async function viaNetlify(path: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await handler(event(path, body, headers), {});
  return { status: r.statusCode as number, body: JSON.parse(r.body) };
}
async function viaServer(path: string, body: unknown) {
  const r = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'qe-exporter/0.3.0 (calc queue test)' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() as any };
}
async function drainViaBackground(companyId = GOLDEN_COMPANY) {
  await background(new Request('https://example.test/.netlify/functions/calc-drain-background', {
    method: 'POST', headers: { [queue.CALC_DRAIN_HEADER]: queue.calcDrainToken()!, 'content-type': 'application/json' }, body: JSON.stringify({ companyId }),
  }));
}
const queueRows = async (team: string) => (await db.query(
  `SELECT id, to_char(from_day, 'YYYY-MM-DD') AS from_day, to_char(to_day, 'YYYY-MM-DD') AS to_day, kinds, status, attempts, last_error
     FROM calc_queue WHERE team_id = $1 ORDER BY from_day, kinds`, [team])).rows;

// ----- the data set (no "today" records, every incident and issue closed: values that do not depend on the hour) -----
const pipelineRuns = Array.from({ length: 15 }, (_v, i) => ({
  id: `cq-run-${i}`, attempt: 1, name: 'ci', commit: `cqc${i}`, branch: 'main', startedAt: at(14 - Math.floor(i * 13 / 15), '09:00'), finishedAt: at(14 - Math.floor(i * 13 / 15), '09:12'),
  result: i % 4 === 0 ? 'failure' : 'success',
  stages: [{ name: 'build', startedAt: at(14 - Math.floor(i * 13 / 15), '09:00'), finishedAt: at(14 - Math.floor(i * 13 / 15), '09:05'), result: 'success' },
    { name: 'unit tests', startedAt: at(14 - Math.floor(i * 13 / 15), '09:05'), finishedAt: at(14 - Math.floor(i * 13 / 15), '09:12'), result: i % 4 === 0 ? 'failure' : 'success' }],
}));
const junit = (cases: string) => `<?xml version="1.0"?><testsuites><testsuite name="s" tests="3">${cases}</testsuite></testsuites>`;
const testReports = [
  { commit: 'cqt1', branch: 'main', run: 'r1', startedAt: at(3, '08:00'), files: [{ name: 'a.xml', content: junit('<testcase classname="A" name="one" time="0.5"/><testcase classname="A" name="two" time="1.0"><failure message="x">x</failure></testcase><testcase classname="A" name="three" time="0.2"/>') }] },
  { commit: 'cqt1', branch: 'main', run: 'r2', startedAt: at(3, '09:00'), files: [{ name: 'a.xml', content: junit('<testcase classname="A" name="one" time="0.5"/><testcase classname="A" name="two" time="1.0"/><testcase classname="A" name="three" time="0.2"/>') }] },
  { commit: 'cqt2', branch: 'main', run: 'r3', startedAt: at(2, '08:00'), files: [{ name: 'a.xml', content: junit('<testcase classname="A" name="one" time="0.4"/><testcase classname="A" name="two" time="0.9"/><testcase classname="A" name="three" time="0.3"><skipped/></testcase>') }] },
];
const deployments = Array.from({ length: 6 }, (_v, i) => ({
  id: `cq-dep-${i}`, environment: 'production', service: 'api', commit: `cqd${i}`, startedAt: at(12 - i * 2, '11:00'), finishedAt: at(12 - i * 2, '11:10'),
  result: i === 2 ? 'rolled_back' : 'success', commits: [{ sha: `cqd${i}`, authoredAt: at(13 - i * 2, '15:00') }, { sha: `cqd${i}b`, authoredAt: at(14 - i * 2, '15:00') }],
}));
const incidents = [
  { id: 'cq-inc-1', title: 'API down', severity: 'high', service: 'api', status: 'resolved', openedAt: at(8, '12:00'), resolvedAt: at(8, '14:30'), outage: true },
  { id: 'cq-inc-2', title: 'Slow', severity: 'medium', service: 'api', status: 'resolved', openedAt: at(5, '10:00'), acknowledgedAt: at(5, '10:10'), resolvedAt: at(4, '09:00') },
  { id: 'cq-inc-3', title: 'Errors', severity: 'low', service: 'api', status: 'resolved', openedAt: at(3, '16:00'), resolvedAt: at(3, '18:00'), deployment: 'cq-dep-4' },
];
const issues = Array.from({ length: 6 }, (_v, i) => ({
  key: `CQ-${i + 1}`, type: i % 3 === 0 ? 'bug' : 'story', title: `Issue ${i + 1}`, status: 'Done', statusCategory: 'done', storyPoints: (i % 3) + 1,
  createdAt: at(13 - i, '09:00'), resolvedAt: at(10 - i, '17:00'), updatedAt: at(10 - i, '17:00'), ...(i % 3 === 0 ? { foundIn: 'production' } : {}),
  transitions: [{ field: 'status', from: 'To Do', to: 'In Progress', toCategory: 'indeterminate', at: at(12 - i, '10:00') }, { field: 'status', from: 'In Progress', to: 'Done', toCategory: 'done', at: at(10 - i, '17:00') }],
}));
const batches = (team: string) => [
  envelope(team, 'pipeline-runs', pipelineRuns),
  envelope(team, 'test-report', testReports),
  envelope(team, 'deployments', deployments),
  envelope(team, 'incidents', incidents, 'pagerduty'),
  envelope(team, 'issues', issues, 'jira'),
];

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running - calculation queue tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  for (const id of [INLINE, QUEUED, SPARE]) {
    await db.query(`INSERT INTO teams (id, company_id, department_id, name, is_active) VALUES ($1, $2, $3, $4, true)`, [id, GOLDEN_COMPANY, DEPT, `CQ ${id.slice(-6)}`]);
  }
  cookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  apiKey = (await post('/api/admin/api-keys', cookie, { name: 'Calculation queue test key' })).body.plaintextKey;
  stub = http.createServer((req, res) => { if (req.headers[queue.CALC_DRAIN_HEADER]) kicks++; req.resume(); res.statusCode = 202; res.end(); });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', () => r()));
  process.env.URL = `http://127.0.0.1:${(stub.address() as any).port}`;
  queue = await import('../../server/lib/calc/queue');
  ({ handler } = await import('../../netlify/functions/api'));
  background = (await import('../../netlify/functions/calc-drain-background')).default as any;
  const o = (await db.query(`SELECT t.id, t.company_id FROM teams t WHERE t.company_id <> $1 AND t.is_active IS NOT FALSE ORDER BY t.id LIMIT 1`, [GOLDEN_COMPANY])).rows[0];
  otherTeam = o ? { company: o.company_id, team: o.id } : null;
});

afterAll(async () => {
  if (db) {
    if (otherTeam) await db.query(`DELETE FROM calc_queue WHERE team_id = $1 AND actor_id = 'calc-queue-test'`, [otherTeam.team]);
    await db.query(`DELETE FROM calc_queue_kicks WHERE company_id = $1`, [GOLDEN_COMPANY]).catch(() => undefined);
    await removeGolden(db);
    await db.end();
  }
  stub?.close();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const { flushBackgroundWrites } = await import('../../server/lib/opsLog');
  await flushBackgroundWrites(500);
  const { pool } = await import('../../src/lib/db');
  await pool.end().catch(() => undefined);
});

describe('Calculation queue', () => {
  it('CQ-001 enqueue merges overlapping and touching ranges per team and kinds', async () => {
    if (!up) return;
    const { pool } = await import('../../src/lib/db');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const add = (days: string[], kinds: any[] = ['ci']) => queue.enqueueCalc(client, { companyId: GOLDEN_COMPANY, teamId: SPARE, days, kinds });
      await add([dayAgo(20), dayAgo(19), dayAgo(18)]);
      await add([dayAgo(15), dayAgo(14)]);
      const list = async () => (await client.query(`SELECT to_char(from_day, 'YYYY-MM-DD') AS f, to_char(to_day, 'YYYY-MM-DD') AS t, kinds FROM calc_queue WHERE team_id = $1 ORDER BY from_day, kinds`, [SPARE])).rows;
      expect(await list()).toEqual([{ f: dayAgo(20), t: dayAgo(18), kinds: ['ci'] }, { f: dayAgo(15), t: dayAgo(14), kinds: ['ci'] }]);
      // Touching on both sides: one entry.
      await add([dayAgo(17), dayAgo(16)]);
      expect(await list()).toEqual([{ f: dayAgo(20), t: dayAgo(14), kinds: ['ci'] }]);
      // Overlapping, and days with a gap in one request: the gap stays a gap.
      await add([dayAgo(15), dayAgo(13), dayAgo(10)]);
      expect(await list()).toEqual([{ f: dayAgo(20), t: dayAgo(13), kinds: ['ci'] }, { f: dayAgo(10), t: dayAgo(10), kinds: ['ci'] }]);
      // Other kinds: their own entry.
      await add([dayAgo(12)], ['delivery']);
      expect((await list()).map((r) => r.kinds)).toEqual([['ci'], ['delivery'], ['ci']]);
      // A running entry is never merged (its days are being calculated with the data before this request).
      await client.query(`UPDATE calc_queue SET status = 'running' WHERE team_id = $1 AND kinds = '{ci}' AND to_day = $2::date`, [SPARE, dayAgo(10)]);
      await add([dayAgo(10), dayAgo(9)]);
      expect((await client.query(`SELECT status, to_char(from_day, 'YYYY-MM-DD') AS f, to_char(to_day, 'YYYY-MM-DD') AS t FROM calc_queue WHERE team_id = $1 AND kinds = '{ci}' AND from_day >= $2::date ORDER BY status`, [SPARE, dayAgo(10)])).rows)
        .toEqual([{ status: 'pending', f: dayAgo(10), t: dayAgo(9) }, { status: 'running', f: dayAgo(10), t: dayAgo(10) }]);
      expect(queue.contiguousRanges([dayAgo(3), dayAgo(1), dayAgo(2), dayAgo(5)])).toEqual([[dayAgo(5), dayAgo(5)], [dayAgo(3), dayAgo(1)]]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('CQ-002 a 15-run batch on Netlify answers "queued" in few round trips; the background function calculates it', async () => {
    if (!up) return;
    kicks = 0;
    await db.query(`DELETE FROM calc_queue_kicks WHERE company_id = $1`, [GOLDEN_COMPANY]);
    // Count the database round trips of the request (each costs ~80 ms in production).
    const original = pg.Client.prototype.query;
    let trips = 0;
    (pg.Client.prototype as any).query = function (...args: any[]) { trips++; return (original as any).apply(this, args); };
    const t0 = Date.now();
    let r: { status: number; body: any };
    try {
      r = await viaNetlify('/api/ingest/exporter/batch', envelope(QUEUED, 'pipeline-runs', pipelineRuns), { 'idempotency-key': `cq-002-${Date.now()}` });
    } finally {
      (pg.Client.prototype as any).query = original;
    }
    const ms = Date.now() - t0;
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'accepted', recordsStored: 15, calculation: 'queued' });
    expect(r.body.items[0].result).toMatchObject({ calculation: 'queued', computed: [] });
    // Before: ~330 round trips (calculation inline); now the store path only: ≤ 30 (≈ 2.4 s at 80 ms per round trip).
    expect(trips).toBeLessThanOrEqual(30);
    expect(ms).toBeLessThan(5000);
    // Stored, not calculated; one drain started for the batch.
    expect(Number((await db.query(`SELECT COUNT(*) FROM pipeline_runs_raw WHERE team_id = $1`, [QUEUED])).rows[0].count)).toBe(15);
    expect(Number((await db.query(`SELECT COUNT(*) FROM metric_evidence WHERE team_id = $1`, [QUEUED])).rows[0].count)).toBe(0);
    const waiting = await queueRows(QUEUED);
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((w: any) => w.status === 'pending' && w.kinds.join() === 'ci')).toBe(true);
    expect(kicks).toBe(1);

    await drainViaBackground();
    expect((await queueRows(QUEUED)).every((w: any) => w.status === 'done')).toBe(true);
    expect(Number((await db.query(`SELECT COUNT(*) FROM metric_evidence WHERE team_id = $1`, [QUEUED])).rows[0].count)).toBeGreaterThan(0);
    const job = (await db.query(`SELECT ok, summary FROM job_runs WHERE job = 'calc-queue' ORDER BY started_at DESC LIMIT 1`)).rows[0];
    expect(job.ok).toBe(true);
    expect(job.summary).toMatch(/entries/);
  });

  it('CQ-003 after the drain, every value equals what the synchronous path stored for the same data', async () => {
    if (!up) return;
    // The synchronous path: the long-running API (inline calculation, as before the queue).
    for (const b of batches(INLINE)) {
      const r = await viaServer('/api/ingest/exporter/batch', b);
      expect([200, 201]).toContain(r.status);
      expect(r.body.calculation).toBe('done');
    }
    // The queued path: the Netlify function, then the background drain.
    for (const b of batches(QUEUED)) {
      const r = await viaNetlify('/api/ingest/exporter/batch', b);
      expect([200, 201]).toContain(r.status);
      if (r.body.written) expect(r.body.calculation).toBe('queued');
    }
    expect((await queueRows(QUEUED)).some((w: any) => w.status === 'pending')).toBe(true);
    await drainViaBackground();
    expect((await queueRows(QUEUED)).filter((w: any) => w.status !== 'done')).toEqual([]);

    const evidence = async (team: string) => (await db.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, metric_key, value::text AS value, sample_size, confidence, kpi_column, recorded_at
         FROM metric_evidence WHERE team_id = $1 ORDER BY day, metric_key`, [team])).rows
      // Today's values are "as of now" (the time they were calculated).
      .map((r: any) => ({ ...r, recorded_at: r.day === dayAgo(0) ? 'now' : r.recorded_at?.toISOString() ?? null }));
    const a = await evidence(INLINE);
    const b = await evidence(QUEUED);
    expect(a.length).toBeGreaterThan(40);
    expect(new Set(a.map((x: any) => x.metric_key)).size).toBeGreaterThan(8);
    expect(b).toEqual(a);
    // The KPI values: the latest of each metric and day (the synchronous path also wrote the in-between values of each
    // request; a value for today is recorded at "now", so the day is compared).
    const values = async (team: string) => (await db.query(
      `SELECT DISTINCT ON (metric_key, to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')) metric_key, to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, value::text AS value, source
         FROM metric_values WHERE team_id = $1 AND superseded_by IS NULL ORDER BY metric_key, to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), recorded_at DESC, received_at DESC`, [team])).rows;
    const va = await values(INLINE);
    expect(va.length).toBeGreaterThan(20);
    expect(await values(QUEUED)).toEqual(va);
    const snaps = async (team: string) => (await db.query(
      `SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS d, test_coverage, test_flakiness_rate, defect_escape_rate, avg_build_time_minutes, test_execution_time_minutes,
              deployment_frequency_per_week, lead_time_days, mttr_hours, first_time_pass_rate, change_failure_rate, mtbf_hours, system_availability, sprint_velocity, qa_score, status
         FROM kpi_snapshots WHERE team_id = $1 ORDER BY snapshot_date`, [team])).rows;
    expect(await snaps(QUEUED)).toEqual(await snaps(INLINE));
  });

  it('CQ-004 two drains at once never take the same entry', async () => {
    if (!up) return;
    await db.query(`DELETE FROM calc_queue WHERE team_id = $1`, [SPARE]);
    const { pool } = await import('../../src/lib/db');
    const client = await pool.connect();
    try {
      for (const n of [2, 4, 6, 8, 10, 12, 14, 16]) await queue.enqueueCalc(client, { companyId: GOLDEN_COMPANY, teamId: SPARE, days: [dayAgo(n)], kinds: ['ci'] });
    } finally { client.release(); }
    const seen: string[] = [];
    const slow: any = async (_c: any, team: string, days: string[]) => { seen.push(`${team}:${days.join(',')}`); await new Promise((r) => setTimeout(r, 30)); return []; };
    const [x, y] = await Promise.all([
      queue.drainCalcQueue({ companyId: GOLDEN_COMPANY, recompute: slow, budgetMs: 60_000 }),
      queue.drainCalcQueue({ companyId: GOLDEN_COMPANY, recompute: slow, budgetMs: 60_000 }),
    ]);
    expect(x.processed + y.processed).toBe(8);
    expect(x.processed).toBeGreaterThan(0);
    expect(y.processed).toBeGreaterThan(0);
    expect(seen.length).toBe(8);
    expect(new Set(seen).size).toBe(8);
    expect((await queueRows(SPARE)).map((r: any) => `${r.status}/${r.attempts}`)).toEqual(Array(8).fill('done/1'));
  });

  it('CQ-005 a failing entry is retried with a delay, then marked failed with its error', async () => {
    if (!up) return;
    await db.query(`DELETE FROM calc_queue WHERE team_id = $1`, [SPARE]);
    const { pool } = await import('../../src/lib/db');
    const client = await pool.connect();
    try {
      await queue.enqueueCalc(client, { companyId: GOLDEN_COMPANY, teamId: SPARE, days: [dayAgo(3)], kinds: ['ci'] });
      await queue.enqueueCalc(client, { companyId: GOLDEN_COMPANY, teamId: SPARE, days: [dayAgo(9)], kinds: ['delivery'] });
    } finally { client.release(); }
    let calls = 0;
    let flaky = 0;
    const failing: any = async (c: any, team: string, days: string[], opts: any) => {
      if (opts.groups.includes('delivery')) { flaky++; if (flaky === 1) throw new Error('transient failure'); return []; }
      calls++;
      throw new Error('engine exploded');
    };
    const r = await queue.drainCalcQueue({ companyId: GOLDEN_COMPANY, recompute: failing, maxAttempts: 3, retryDelayMs: 50, waitForRetriesMs: 5_000, budgetMs: 20_000 });
    expect(calls).toBe(3);
    expect(flaky).toBe(2);
    expect(r).toMatchObject({ processed: 1, failed: 1, retried: 3 });
    const rows = await queueRows(SPARE);
    expect(rows.map((x: any) => ({ kinds: x.kinds.join(), status: x.status, attempts: x.attempts }))).toEqual([
      { kinds: 'delivery', status: 'done', attempts: 2 }, { kinds: 'ci', status: 'failed', attempts: 3 },
    ]);
    expect(rows.find((x: any) => x.kinds.join() === 'ci').last_error).toBe('engine exploded');
    // As a job run (the background function's wrapper, MAX_ATTEMPTS tries): the last try fails, recorded in job_runs.
    await db.query(`UPDATE calc_queue SET status = 'pending', attempts = $2, not_before = now() WHERE team_id = $1 AND kinds = '{ci}'`, [SPARE, queue.MAX_ATTEMPTS - 1]);
    const res = await queue.runCalcDrain({ companyId: GOLDEN_COMPANY, mode: 'inline', recompute: failing });
    expect(res.failed).toBe(1);
    expect((await queueRows(SPARE)).find((x: any) => x.kinds.join() === 'ci')).toMatchObject({ status: 'failed', attempts: queue.MAX_ATTEMPTS });
    const job = (await db.query(`SELECT ok, summary FROM job_runs WHERE job = 'calc-queue' ORDER BY started_at DESC LIMIT 1`)).rows[0];
    expect(job).toMatchObject({ ok: false });
    expect(job.summary).toMatch(/1 failed/);
  });

  it('CQ-006 a company\'s drain never touches another company\'s entries', async () => {
    if (!up || !otherTeam) return;
    await db.query(`INSERT INTO calc_queue (company_id, team_id, from_day, to_day, kinds, actor_id) VALUES ($1, $2, $3::date, $3::date, '{ci}', 'calc-queue-test')`, [otherTeam.company, otherTeam.team, dayAgo(2)]);
    const before = (await db.query(`SELECT COUNT(*)::int AS n, MAX(computed_at) AS at FROM metric_evidence WHERE team_id = $1`, [otherTeam.team])).rows[0];
    await db.query(`DELETE FROM calc_queue WHERE team_id = $1`, [SPARE]);
    const { pool } = await import('../../src/lib/db');
    const client = await pool.connect();
    try { await queue.enqueueCalc(client, { companyId: GOLDEN_COMPANY, teamId: SPARE, days: [dayAgo(2)], kinds: ['ci'] }); } finally { client.release(); }
    const teams: string[] = [];
    const r = await queue.drainCalcQueue({ companyId: GOLDEN_COMPANY, recompute: (async (c: any, team: string, d: string[], o: any) => { teams.push(team); return (await import('../../server/lib/calc/engine')).recomputeTeamDays(c, team, d, o); }) as any });
    expect(r.processed).toBe(1);
    expect(teams).toEqual([SPARE]);
    expect((await db.query(`SELECT status, attempts FROM calc_queue WHERE team_id = $1 AND actor_id = 'calc-queue-test'`, [otherTeam.team])).rows).toEqual([{ status: 'pending', attempts: 0 }]);
    const after = (await db.query(`SELECT COUNT(*)::int AS n, MAX(computed_at) AS at FROM metric_evidence WHERE team_id = $1`, [otherTeam.team])).rows[0];
    expect(after).toEqual(before);
    await db.query(`DELETE FROM calc_queue WHERE team_id = $1 AND actor_id = 'calc-queue-test'`, [otherTeam.team]);
  });

  it('CQ-007 direct endpoints defer on Netlify; the ingestion log and Connect your CI show the pending calculation', async () => {
    if (!up) return;
    await db.query(`DELETE FROM calc_queue WHERE team_id = $1`, [SPARE]);
    const r = await viaNetlify('/api/ingest/pipelines', { team: SPARE, runs: [{ id: 'cq-direct-1', attempt: 1, name: 'ci', commit: 'cqx1', branch: 'main', startedAt: at(1, '09:00'), finishedAt: at(1, '09:10'), result: 'success' }] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'accepted', calculation: 'queued', computed: [] });
    const dep = await viaNetlify('/api/ingest/deployments', { team: SPARE, deployments: [{ id: 'cq-direct-d1', environment: 'production', commit: 'cqx1', finishedAt: at(1, '12:00'), result: 'success' }] });
    expect(dep.status).toBe(201);
    expect(dep.body.calculation).toBe('queued');
    const status = await get('/api/ci/status', cookie);
    expect(status.status).toBe(200);
    const row = status.body.teams.find((t: any) => t.id === SPARE);
    expect(row.calculation).toMatchObject({ pending: true, from: dayAgo(1) });
    expect(status.body.calculationPending).toBeGreaterThanOrEqual(1);
    const log = await get(`/api/ingestion-log?teamId=${SPARE}`, cookie);
    expect(log.body.entries.slice(0, 2).map((e: any) => e.calculation)).toEqual(['pending', 'pending']);
    await drainViaBackground();
    const after = await get(`/api/ingestion-log?teamId=${SPARE}`, cookie);
    expect(after.body.entries.slice(0, 2).map((e: any) => e.calculation)).toEqual(['done', 'done']);
    expect((await get('/api/ci/status', cookie)).body.teams.find((t: any) => t.id === SPARE).calculation.pending).toBe(false);
    // The inline server answers as before (no "calculation" field, values computed in the answer).
    const inline = await viaServer('/api/ingest/pipelines', { team: SPARE, runs: [{ id: 'cq-direct-2', attempt: 1, name: 'ci', commit: 'cqx2', branch: 'main', startedAt: at(1, '10:00'), finishedAt: at(1, '10:10'), result: 'success' }] });
    expect(inline.status).toBe(201);
    expect(inline.body.calculation).toBeUndefined();
    expect(inline.body.computed.length).toBe(1);
  });

  it('CQ-008 the background function needs the signed token; a drain start is held while one runs', async () => {
    if (!up) return;
    await db.query(`DELETE FROM calc_queue WHERE team_id = $1`, [SPARE]);
    const { pool } = await import('../../src/lib/db');
    const client = await pool.connect();
    try { await queue.enqueueCalc(client, { companyId: GOLDEN_COMPANY, teamId: SPARE, days: [dayAgo(4)], kinds: ['ci'] }); } finally { client.release(); }
    await background(new Request('https://example.test/x', { method: 'POST', headers: { [queue.CALC_DRAIN_HEADER]: 'forged' }, body: JSON.stringify({ companyId: GOLDEN_COMPANY }) }));
    expect((await queueRows(SPARE)).map((x: any) => x.status)).toEqual(['pending']);
    // Held: the first start goes out, the next ones wait for the drain to report idle.
    await db.query(`DELETE FROM calc_queue_kicks WHERE company_id = $1`, [GOLDEN_COMPANY]);
    kicks = 0;
    expect((await queue.triggerCalcDrain(GOLDEN_COMPANY)).started).toBe(true);
    expect((await queue.triggerCalcDrain(GOLDEN_COMPANY)).started).toBe(false);
    expect(kicks).toBe(1);
    await drainViaBackground();
    expect((await queueRows(SPARE)).map((x: any) => x.status)).toEqual(['done']);
    // The drain reported idle: the next request starts a new one.
    expect((await queue.triggerCalcDrain(GOLDEN_COMPANY)).started).toBe(true);
    expect(kicks).toBe(2);
    // The safety net starts nothing when nothing waits.
    await db.query(`DELETE FROM calc_queue_kicks WHERE company_id = $1`, [GOLDEN_COMPANY]);
    const net = await queue.kickPendingCalc();
    expect(net.started).toBe(0);
  });

  it('CQ-009 off Netlify the drain runs in this process, after the answer', async () => {
    if (!up) return;
    await db.query(`DELETE FROM calc_queue WHERE team_id = $1`, [SPARE]);
    const { pool } = await import('../../src/lib/db');
    const client = await pool.connect();
    try { await queue.enqueueCalc(client, { companyId: GOLDEN_COMPANY, teamId: SPARE, days: [dayAgo(5), dayAgo(6)], kinds: ['ci'] }); } finally { client.release(); }
    kicks = 0;
    const t = await queue.triggerCalcDrain(GOLDEN_COMPANY, { env: {} });
    expect(t).toMatchObject({ mode: 'inline', started: true });
    // Not yet: it starts after the current answer.
    expect((await queueRows(SPARE)).map((x: any) => x.status)).toEqual(['pending']);
    await queue.waitForLocalDrains();
    expect((await queueRows(SPARE)).map((x: any) => x.status)).toEqual(['done']);
    expect(kicks).toBe(0);
    expect(queue.calcDeferred({ INGEST_CALC: 'queued' })).toBe(true);
    expect(queue.calcDeferred({ INGEST_CALC: 'inline', NETLIFY: 'true' })).toBe(false);
    expect(queue.calcDeferred({ NETLIFY: 'true' })).toBe(true);
    expect(queue.calcDeferred({})).toBe(false);
  });
});
