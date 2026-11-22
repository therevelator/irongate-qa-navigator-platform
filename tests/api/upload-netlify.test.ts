/**
 * File uploads through the Netlify function (netlify/functions/api.ts, run in-process with the event
 * shape Netlify passes: a base64 multipart body), against the local database: the same routes work in
 * both deployments, and uploads are rate-limited per company.
 *
 *   UPN-001  preview and upload through the function (binary body, gzip-compressed part as the browser sends it)
 *   UPN-002  the per-company limit: requests over UPLOAD_RATE_LIMIT answer 429; another company is not affected
 */
import { gzipSync } from 'zlib';
import type { Client } from 'pg';
import { localDb } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_PASSWORD, GOLDEN_COMPANY } from './helpers/goldenFixture';

process.env.NETLIFY = process.env.NETLIFY || 'true';
process.env.UPLOAD_RATE_LIMIT = '4';

let handler: (event: any, context: any) => Promise<any>;
let db: Client;
let up = true;
let cookie = '';
let otherCookie = '';

const event = (method: string, path: string, headers: Record<string, string>, body: Buffer | string | null) => ({
  httpMethod: method, path, rawUrl: `https://example.test${path}`, rawQuery: '', queryStringParameters: {}, multiValueQueryStringParameters: {},
  headers: { 'user-agent': 'upload-netlify-test', 'x-nf-client-connection-ip': '203.0.113.9', ...headers }, multiValueHeaders: {},
  body: body === null ? null : Buffer.isBuffer(body) ? body.toString('base64') : body, isBase64Encoded: Buffer.isBuffer(body),
});

function multipart(options: object, files: Array<{ name: string; data: Buffer }>) {
  const b = `----upn${Date.now()}`;
  const parts: Buffer[] = [Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="options"\r\n\r\n${JSON.stringify(options)}\r\n`)];
  for (const f of files) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), f.data, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${b}` };
}

async function signIn(email: string, password: string): Promise<string> {
  const r = await handler(event('POST', '/api/auth/login', { 'content-type': 'application/json' }, JSON.stringify({ email, password })), {});
  const set = r.multiValueHeaders?.['set-cookie'] ?? r.headers?.['set-cookie'] ?? [];
  const list = Array.isArray(set) ? set : [set];
  const m = list.map((c: string) => /irongate_token=([^;]+)/.exec(c)).find(Boolean);
  return m ? `irongate_token=${m[1]}` : '';
}

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const sprints = () => Buffer.from(`sprint,startDate,endDate,completedDate\nNetlify Sprint,${day(10)},${day(1)},${day(1)}\n`);

beforeAll(async () => {
  try {
    db = await localDb();
    await createGolden(db);
    ({ handler } = await import('../../netlify/functions/api'));
    cookie = await signIn(GOLDEN_ADMIN_EMAIL, GOLDEN_PASSWORD);
    otherCookie = await signIn('admin@irongate.com', 'demo123');
    up = !!cookie;
  } catch (e) {
    console.warn('Database not available - Netlify upload tests skipped', e);
    up = false;
  }
});

afterAll(async () => {
  if (db) { await removeGolden(db); await db.end(); }
  const { flushBackgroundWrites } = await import('../../server/lib/opsLog');
  await flushBackgroundWrites(500);
  const { pool } = await import('../../src/lib/db');
  await pool.end().catch(() => undefined);
});

describe('Upload files through the Netlify function', () => {
  it('UPN-001 preview and upload work through the function (base64 multipart, a gzipped part)', async () => {
    if (!up) return;
    const mp = multipart({ mode: 'team', teamId: 'golden-team-empty' }, [{ name: 'sprints.csv', data: gzipSync(sprints()) }]);
    const pv = await handler(event('POST', '/api/uploads/preview', { 'content-type': mp.type, cookie }, mp.body), {});
    expect(pv.statusCode).toBe(200);
    const body = JSON.parse(pv.body);
    expect(body.files[0]).toMatchObject({ name: 'sprints.csv', status: 'ready', records: 1, type: { value: 'sprints:sprints-csv' } });
    expect((await db.query(`SELECT COUNT(*)::int AS n FROM issue_sprints WHERE company_id = $1`, [GOLDEN_COMPANY])).rows[0].n).toBe(0);
    const cm = await handler(event('POST', '/api/uploads/commit', { 'content-type': mp.type, cookie }, mp.body), {});
    expect(cm.statusCode).toBe(200);
    expect(JSON.parse(cm.body).files[0]).toMatchObject({ status: 'stored' });
    expect((await db.query(`SELECT state FROM issue_sprints WHERE company_id = $1 AND external_id = 'name:Netlify-Sprint'`, [GOLDEN_COMPANY])).rows[0]?.state).toBe('closed');
  });

  it('UPN-002 uploads are rate-limited per company (429 over the limit); another company keeps its own allowance', async () => {
    if (!up) return;
    const mp = multipart({ mode: 'team', teamId: 'golden-team-empty' }, [{ name: 'sprints.csv', data: sprints() }]);
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await handler(event('POST', '/api/uploads/preview', { 'content-type': mp.type, cookie }, mp.body), {})).statusCode);
    expect(codes).toEqual([200, 200, 429, 429]);
    const r = await handler(event('POST', '/api/uploads/preview', { 'content-type': mp.type, cookie }, mp.body), {});
    expect(JSON.parse(r.body).error).toMatch(/Upload limit reached for your company/);
    if (otherCookie) {
      const other = multipart({ mode: 'team', teamId: 'nope' }, [{ name: 'sprints.csv', data: sprints() }]);
      expect((await handler(event('POST', '/api/uploads/preview', { 'content-type': other.type, cookie: otherCookie }, other.body), {})).statusCode).toBe(403);
    }
  });
});
