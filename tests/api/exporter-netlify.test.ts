/**
 * The QE Navigator Exporter's envelope through the Netlify function (netlify/functions/api.ts, run in-process with
 * the event shape Netlify passes), against the local database: the same router serves both deployments.
 *
 *   EXN-001  context, a gzipped (base64) batch accepted into the named team, and a foreign companyId refused (403)
 *   EXN-002  how Netlify really delivers gzip: labelled application/gzip it arrives base64 and is accepted; labelled
 *            application/json it arrives as broken text and gets a 400 that says to use application/gzip
 */
import { gzipSync } from 'zlib';
import type { Client } from 'pg';
import { localDb, login, post, backendUp } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

process.env.NETLIFY = process.env.NETLIFY || 'true';

let handler: (event: any, context: any) => Promise<any>;
let db: Client;
let up = true;
let apiKey = '';

const event = (method: string, path: string, headers: Record<string, string>, body: Buffer | string | null) => ({
  httpMethod: method, path, rawUrl: `https://example.test${path}`, rawQuery: '', queryStringParameters: {}, multiValueQueryStringParameters: {},
  headers: { 'user-agent': 'qe-exporter/0.3.0 (netlify test)', 'x-nf-client-connection-ip': '203.0.113.10', ...headers }, multiValueHeaders: {},
  body: body === null ? null : Buffer.isBuffer(body) ? body.toString('base64') : body, isBase64Encoded: Buffer.isBuffer(body),
});
const at = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running - Netlify exporter tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  const cookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  apiKey = (await post('/api/admin/api-keys', cookie, { name: 'Exporter Netlify test key' })).body.plaintextKey;
  ({ handler } = await import('../../netlify/functions/api'));
});

afterAll(async () => {
  if (db) { await removeGolden(db); await db.end(); }
  const { flushBackgroundWrites } = await import('../../server/lib/opsLog');
  await flushBackgroundWrites(500);
  const { pool } = await import('../../src/lib/db');
  await pool.end().catch(() => undefined);
});

describe('Exporter envelope through the Netlify function', () => {
  it('EXN-001 context, a gzipped batch, and a foreign companyId refused', async () => {
    if (!up) return;
    const auth = { authorization: `Bearer ${apiKey}` };
    const ctx = await handler(event('GET', '/api/ingest/exporter/context', auth, null), {});
    expect(ctx.statusCode).toBe(200);
    expect(JSON.parse(ctx.body).company.id).toBe(GOLDEN_COMPANY);
    const env = {
      companyId: GOLDEN_COMPANY, departmentId: 'golden-dept-b', teamId: 'golden-team-empty', source: 'github', kind: 'pipeline-runs',
      items: [{ id: 'exn-1', attempt: 1, name: 'ci', commit: 'eeee0001', branch: 'main', startedAt: at(1), finishedAt: at(0.99), result: 'success', stages: [] }],
    };
    const r = await handler(event('POST', '/api/ingest/exporter/batch', { ...auth, 'content-type': 'application/gzip', 'content-encoding': 'gzip' }, gzipSync(Buffer.from(JSON.stringify(env)))), {});
    expect(r.statusCode).toBe(201);
    expect(JSON.parse(r.body)).toMatchObject({ status: 'accepted', teamId: 'golden-team-empty' });
    expect((await db.query(`SELECT team_id FROM pipeline_runs_raw WHERE external_id = 'exn-1'`)).rows).toEqual([{ team_id: 'golden-team-empty' }]);
    const other = (await db.query(`SELECT id FROM companies WHERE id <> $1 LIMIT 1`, [GOLDEN_COMPANY])).rows[0].id;
    const bad = await handler(event('POST', '/api/ingest/exporter/batch', { ...auth, 'content-type': 'application/json' }, JSON.stringify({ ...env, companyId: other })), {});
    expect(bad.statusCode).toBe(403);
  });

  it('EXN-002 gzip labelled application/gzip arrives intact; labelled application/json it arrives broken and says why', async () => {
    if (!up) return;
    const auth = { authorization: `Bearer ${apiKey}` };
    const env = {
      companyId: GOLDEN_COMPANY, departmentId: 'golden-dept-b', teamId: 'golden-team-empty', source: 'github', kind: 'pipeline-runs',
      items: [{ id: 'exn-2', attempt: 1, name: 'ci', commit: 'eeee0002', branch: 'main', startedAt: at(1), finishedAt: at(0.99), result: 'success', stages: [] }],
    };
    const gz = gzipSync(Buffer.from(JSON.stringify(env)));
    const ok = await handler(event('POST', '/api/ingest/exporter/batch', { ...auth, 'content-type': 'application/gzip', 'content-encoding': 'gzip' }, gz), {});
    expect(ok.statusCode).toBe(201);
    // Netlify passes a body with a text content type as a UTF-8 string, not base64: the gzip bytes are altered.
    const textEvent = { ...event('POST', '/api/ingest/exporter/batch', { ...auth, 'content-type': 'application/json', 'content-encoding': 'gzip' }, null), body: gz.toString('utf8'), isBase64Encoded: false };
    const broken = await handler(textEvent, {});
    expect(broken.statusCode).toBe(400);
    expect(JSON.parse(broken.body).error).toMatch(/application\/gzip/);
  });
});
