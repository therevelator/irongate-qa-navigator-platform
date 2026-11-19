/**
 * Background log writes in the Netlify function (netlify/functions/api.ts, server/lib/opsLog.ts,
 * server/lib/userActivity.ts) — FI-23. The handler is run in-process (serverless-http, the same
 * event shape Netlify passes) against the local database.
 *
 *   NBW-001  the user_activity rows of a sign-in and a data request exist as soon as the handler
 *            has resolved, also when the insert takes longer than the old 300 ms wait (a database
 *            in another region; the instance is frozen as soon as the handler resolves)
 *   NBW-002  a write left over from an earlier invocation that never completes (its connection
 *            dropped while the instance was frozen) neither blocks this request's rows nor holds
 *            the answer for the whole wait
 *   NBW-003  a 5xx answer's server_errors row exists as soon as the handler has resolved
 */
import type { Client } from 'pg';
import { localDb } from './helpers/http';

process.env.NETLIFY = process.env.NETLIFY || 'true'; // as on Netlify: no cron jobs, small pool

let handler: (event: any, context: any) => Promise<any>;
let pool: any;
let db: Client;
let up = true;
const stamp = Date.now();
let cookie = '';

const event = (method: string, path: string, requestId: string, body?: object) => ({
  httpMethod: method,
  path,
  rawUrl: `https://example.test${path}`,
  rawQuery: '',
  queryStringParameters: {},
  multiValueQueryStringParameters: {},
  headers: {
    'content-type': 'application/json',
    'user-agent': 'netlify-background-writes-test',
    'x-nf-client-connection-ip': '203.0.113.7',
    'x-request-id': requestId,
    ...(cookie ? { cookie } : {}),
  },
  multiValueHeaders: {},
  body: body ? JSON.stringify(body) : null,
  isBase64Encoded: false,
});

const rowsNow = async (requestId: string) =>
  (await db.query('SELECT category, route, status FROM user_activity WHERE request_id = $1', [requestId])).rows;

/** Make the user_activity insert slow (or never finish) for the next `times` calls. */
function slowActivityInsert(mode: { delayMs?: number; hang?: boolean }, times = 1) {
  const original = pool.query.bind(pool);
  let left = times;
  const spy = jest.spyOn(pool, 'query').mockImplementation(((text: any, values: any) => {
    if (left > 0 && typeof text === 'string' && text.includes('INSERT INTO user_activity')) {
      left--;
      if (mode.hang) return new Promise(() => undefined);
      return new Promise((r) => setTimeout(r, mode.delayMs ?? 0)).then(() => original(text, values));
    }
    return original(text, values);
  }) as any);
  return spy;
}

beforeAll(async () => {
  try {
    db = await localDb();
  } catch {
    up = false;
    return;
  }
  ({ handler } = await import('../../netlify/functions/api'));
  ({ pool } = await import('../../src/lib/db'));
  const res = await handler(event('POST', '/api/auth/login', `nbw-login0-${stamp}`, { email: 'lead@irongate.com', password: 'demo123' }), {});
  const setCookie: string[] = ([] as string[]).concat(res.multiValueHeaders?.['set-cookie'] ?? res.headers?.['set-cookie'] ?? []);
  cookie = (setCookie.find((c) => c.startsWith('irongate_token=')) ?? '').split(';')[0];
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await db?.end();
  if (pool) {
    const { flushBackgroundWrites } = await import('../../server/lib/opsLog');
    await flushBackgroundWrites(500);
    await pool.end();
  }
});

describe('Netlify function: background writes are done before it returns (FI-23)', () => {
  test('NBW-001 sign-in and data request rows exist right after the handler resolves, with a slow insert', async () => {
    if (!up) return;
    expect(cookie).toMatch(/^irongate_token=/);

    slowActivityInsert({ delayMs: 700 });
    const signIn = `nbw-signin-${stamp}`;
    cookie = '';
    const res = await handler(event('POST', '/api/auth/login', signIn, { email: 'lead@irongate.com', password: 'demo123' }), {});
    expect(res.statusCode).toBe(200);
    const setCookie: string[] = ([] as string[]).concat(res.multiValueHeaders?.['set-cookie'] ?? res.headers?.['set-cookie'] ?? []);
    cookie = (setCookie.find((c) => c.startsWith('irongate_token=')) ?? '').split(';')[0];
    expect(await rowsNow(signIn)).toEqual([expect.objectContaining({ category: 'sign_in', route: '/api/auth/login', status: 200 })]);

    jest.restoreAllMocks();
    slowActivityInsert({ delayMs: 700 });
    const view = `nbw-teams-${stamp}`;
    const res2 = await handler(event('GET', '/api/teams', view), {});
    expect(res2.statusCode).toBe(200);
    expect(await rowsNow(view)).toEqual([expect.objectContaining({ category: 'view', route: '/api/teams', status: 200 })]);
  });

  test('NBW-002 a never-finishing earlier write blocks neither the next rows nor the answer', async () => {
    if (!up) return;
    slowActivityInsert({ hang: true });
    const first = `nbw-hang-${stamp}`;
    await handler(event('GET', '/api/notifications/unread-count', first), {}); // its insert never completes

    jest.restoreAllMocks();
    const next = `nbw-after-${stamp}`;
    const t0 = Date.now();
    const res = await handler(event('GET', '/api/analytics/scope', next), {});
    const took = Date.now() - t0;
    expect(res.statusCode).toBe(200);
    expect(await rowsNow(next)).toEqual([expect.objectContaining({ category: 'view', route: '/api/analytics/scope' })]);
    expect(took).toBeLessThan(2000);
  });

  test('NBW-003 a 5xx answer is in server_errors right after the handler resolves', async () => {
    if (!up) return;
    const original = pool.query.bind(pool);
    let failed = false;
    jest.spyOn(pool, 'query').mockImplementation(((text: any, values: any) => {
      if (!failed && typeof text === 'string' && /FROM notifications/i.test(text)) {
        failed = true;
        return Promise.reject(Object.assign(new Error('connection terminated unexpectedly'), { code: '57P01' }));
      }
      if (typeof text === 'string' && text.includes('INSERT INTO server_errors')) {
        return new Promise((r) => setTimeout(r, 700)).then(() => original(text, values));
      }
      return original(text, values);
    }) as any);
    const rid = `nbw-error-${stamp}`;
    const res = await handler(event('GET', '/api/notifications/unread-count', rid), {});
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    const rows = (await db.query('SELECT status, function_name FROM server_errors WHERE request_id = $1', [rid])).rows;
    expect(rows).toEqual([expect.objectContaining({ status: res.statusCode, function_name: 'api' })]);
  });
});
