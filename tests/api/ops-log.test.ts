/**
 * Request ids, the server error log and scheduled job runs (server/lib/requestContext.ts,
 * server/lib/opsLog.ts, server/middleware/errorHandler.ts), with an in-process copy of the API.
 *
 *   OPS-001  every response has X-Request-Id (a safe incoming one is kept, an unsafe one replaced)
 *   OPS-002  a thrown error: 500 { error, requestId }, one server_errors row without the body,
 *            query string, headers or cookies
 *   OPS-003  a handler's own res.status(500).json(...): requestId added, the logged error kept
 *   OPS-004  4xx answers have no requestId in the body and no server_errors row
 *   OPS-005  job_runs: a successful and a failed run (the failure also in server_errors)
 *   OPS-006  db-keepalive: job run recorded; retention deletes server_errors older than 30 days and
 *            user_activity older than 90 days, nothing newer
 *   OPS-007  the live API answers with X-Request-Id too
 */
import 'dotenv/config';
import request from 'supertest';
import type { Client } from 'pg';
import { buildApp } from './helpers/inProcessApp';
import { API_URL, backendUp, localDb } from './helpers/http';
import { flushBackgroundWrites, withJobRun } from '../../server/lib/opsLog';
import keepalive from '../../netlify/functions/db-keepalive';
import { pool } from '../../src/lib/db';

const MARK = `OPSMARK${Date.now()}`;
const app = buildApp((a) => {
  a.post('/api/test/boom/:teamId', () => { throw new Error('Kaboom in the handler'); });
  a.get('/api/test/inline', (_req, res) => {
    console.error('Inline failure:', new TypeError('inline type error'));
    res.status(500).json({ error: 'Failed to do the thing' });
  });
  a.get('/api/test/bad', (_req, res) => { res.status(400).json({ error: 'Bad input' }); });
});

let up = true;
let db: Client;
beforeAll(async () => { up = await backendUp(); if (up) db = await localDb(); });
afterAll(async () => { await db?.end(); await flushBackgroundWrites(2000); await pool.end(); });

const row = async (requestId: string) => {
  for (let i = 0; i < 20; i++) {
    await flushBackgroundWrites(500);
    const r = await db.query('SELECT * FROM server_errors WHERE request_id = $1', [requestId]);
    if (r.rows.length) return r.rows;
    await new Promise((x) => setTimeout(x, 100));
  }
  return [];
};

describe('Request ids and the server error log', () => {
  test('OPS-001 X-Request-Id on every response', async () => {
    if (!up) return;
    const a = await request(app).get('/api/test/bad');
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const b = await request(app).get('/api/test/bad').set('X-Request-Id', 'client-req-12345');
    expect(b.headers['x-request-id']).toBe('client-req-12345');
    const c = await request(app).get('/api/test/bad').set('X-Request-Id', '<script>alert(1)</script>');
    expect(c.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('OPS-002 thrown error: 500 with requestId; row without body, query, headers or cookies', async () => {
    if (!up) return;
    const res = await request(app).post(`/api/test/boom/team-x?token=${MARK}q`).set('Cookie', `irongate_token=${MARK}c`).set('X-Custom', `${MARK}h`)
      .send({ password: `${MARK}b`, secret: `${MARK}b2` });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error', requestId: res.headers['x-request-id'] });
    const rows = await row(res.body.requestId);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toMatchObject({ method: 'POST', status: 500, error_name: 'Error', error_message: 'Kaboom in the handler', function_name: 'api' });
    expect(r.route).toBe('/api/test/boom/team-x');
    expect(r.stack.length).toBeLessThanOrEqual(4096);
    expect(JSON.stringify(r)).not.toContain(MARK);
  });

  test('OPS-003 a handler answering 500 itself gets the requestId and its logged error', async () => {
    if (!up) return;
    const res = await request(app).get(`/api/test/inline?x=${MARK}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to do the thing');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    const rows = await row(res.body.requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route: '/api/test/inline', error_name: 'TypeError', error_message: 'inline type error', status: 500 });
    expect(JSON.stringify(rows[0])).not.toContain(MARK);
  });

  test('OPS-004 4xx: no requestId in the body, nothing recorded', async () => {
    if (!up) return;
    const res = await request(app).get('/api/test/bad');
    expect(res.body).toEqual({ error: 'Bad input' });
    await flushBackgroundWrites(500);
    expect((await db.query('SELECT 1 FROM server_errors WHERE request_id = $1', [res.headers['x-request-id']])).rows).toHaveLength(0);
  });

  test('OPS-005 job_runs: ok and failed runs', async () => {
    if (!up) return;
    const ok = await withJobRun('weekly-digest', async () => ({ n: 3 }), (r) => `${r.n} things`);
    expect(ok).toEqual({ n: 3 });
    const last = (await db.query(`SELECT * FROM job_runs WHERE job = 'weekly-digest' ORDER BY started_at DESC LIMIT 1`)).rows[0];
    expect(last).toMatchObject({ ok: true, summary: '3 things' });
    expect(last.finished_at).not.toBeNull();
    await expect(withJobRun('pulse-auto-send', async () => { throw new Error(`job broke ${MARK.slice(0, 4)}`); }, () => 'x')).rejects.toThrow('job broke');
    const failed = (await db.query(`SELECT * FROM job_runs WHERE job = 'pulse-auto-send' ORDER BY started_at DESC LIMIT 1`)).rows[0];
    expect(failed.ok).toBe(false);
    expect(failed.summary).toMatch(/^failed: job broke/);
    await flushBackgroundWrites(1000);
    const err = (await db.query(`SELECT * FROM server_errors WHERE function_name = 'pulse-auto-send' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    expect(err.error_message).toMatch(/job broke/);
  });

  test('OPS-006 db-keepalive records its run and applies the retention', async () => {
    if (!up) return;
    const company = (await db.query('SELECT id FROM companies ORDER BY created_at LIMIT 1')).rows[0].id;
    const ids: Record<string, string> = {};
    for (const [k, days] of [['err31', 31], ['err29', 29]] as const) {
      ids[k] = (await db.query(`INSERT INTO server_errors (created_at, error_message, function_name) VALUES (now() - make_interval(days => $1), $2, 'api') RETURNING id`, [days, MARK])).rows[0].id;
    }
    for (const [k, days] of [['ua91', 91], ['ua89', 89]] as const) {
      ids[k] = (await db.query(`INSERT INTO user_activity (created_at, company_id, category, route) VALUES (now() - make_interval(days => $1), $2, 'view', '/api/test') RETURNING id`, [days, company])).rows[0].id;
    }
    const res = await keepalive();
    expect(res.status).toBe(200);
    const has = async (t: string, id: string) => (await db.query(`SELECT 1 FROM ${t} WHERE id = $1`, [id])).rows.length === 1;
    expect(await has('server_errors', ids.err31)).toBe(false);
    expect(await has('server_errors', ids.err29)).toBe(true);
    expect(await has('user_activity', ids.ua91)).toBe(false);
    expect(await has('user_activity', ids.ua89)).toBe(true);
    const run = (await db.query(`SELECT * FROM job_runs WHERE job = 'db-keepalive' ORDER BY started_at DESC LIMIT 1`)).rows[0];
    expect(run.ok).toBe(true);
    expect(run.summary).toMatch(/removed \d+ errors, \d+ activity rows/);
    await db.query('DELETE FROM server_errors WHERE id = $1', [ids.err29]);
    await db.query('DELETE FROM user_activity WHERE id = $1', [ids.ua89]);
  });

  test('OPS-007 the live API sends X-Request-Id', async () => {
    if (!up) return;
    const res = await request(API_URL).get('/api/auth/me').set('X-Request-Id', 'live-check-123456');
    expect(res.headers['x-request-id']).toBe('live-check-123456');
  });
});

describe('Client IP', () => {
  test('OPS-008 the Netlify client header counts only inside the Netlify function', async () => {
    const { clientIp } = await import('../../server/lib/requestContext');
    const req = (behindNetlify: boolean) => ({ headers: { 'x-nf-client-connection-ip': '203.0.113.9' }, ip: '10.0.0.1', app: { locals: { behindNetlify } }, socket: {} }) as any;
    expect(clientIp(req(true))).toBe('203.0.113.9');
    expect(clientIp(req(false))).toBe('10.0.0.1');
  });
});
