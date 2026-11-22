import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';
import { upsertOperator } from '../../server/lib/operator';
import { cleanupDeliveries } from '../../server/lib/exporterDeliveries';
import { pool } from '../../src/lib/db';

/**
 * The operator log of Exporter deliveries (exporter_deliveries, Operator → Exporter deliveries), against the live
 * API and the local database.
 *
 *   EXD-001  an accepted batch: one row with company, department, team, key name and prefix, Exporter version and
 *            host, source, kind, items, date range, sizes, records stored, and a sanitised preview (no file
 *            content, no e-mail address, no description, no credential)
 *   EXD-002  rejected batches are logged with their reason (wrong company, wrong team, missing id, bad kind); a bad
 *            key has no company and keeps the key prefix only; no row holds a full key or a secret
 *   EXD-003  only the operator reads the list, the detail and the CSV: a company admin, an API key and nobody are refused
 *   EXD-004  the company's own ingestion log shows its batches (channel Exporter); another company's admin never sees them
 *   EXD-005  retention: rows older than 30 days are deleted by the cleanup, newer rows stay
 */
const TEAM = 'golden-team-empty';
const DEPT = 'golden-dept-b';
const DAY = 86_400_000;
const at = (daysAgo: number, hhmm = '10:00') => `${new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10)}T${hhmm}:00.000Z`;
const stamp = Date.now();
const OP_PW = 'Operator-Deliveries-Passw0rd!';
const opEmail = `exd-op-${stamp}@platform${stamp}.test`;

let up = true;
let db: Client;
let apiKey = '';
let opToken = '';
let adminCookie = '';
let otherCookie = '';

async function send(body: unknown, opts: { auth?: string; query?: string; host?: string } = {}) {
  const r = await fetch(`${API_URL}/api/ingest/exporter/batch${opts.query ?? ''}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${opts.auth ?? apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'qe-exporter/0.3.0 (test)', 'X-Exporter-Host': opts.host ?? 'build-box-1' },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const envelope = (kind: string, items: unknown[], ids: Record<string, string> = {}) => ({ companyId: GOLDEN_COMPANY, departmentId: DEPT, teamId: TEAM, source: 'fake-vendors', kind, items, ...ids });
const latest = async () => (await db.query(`SELECT * FROM exporter_deliveries ORDER BY received_at DESC LIMIT 1`)).rows[0];
const op = (path: string) => request(API_URL).get(`/api/operator${path}`).set('X-Operator-Token', opToken);

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running - Exporter deliveries tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  adminCookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  otherCookie = (await login('admin@irongate.com')).cookie;
  apiKey = (await post('/api/admin/api-keys', adminCookie, { name: 'Deliveries test key' })).body.plaintextKey;
  await upsertOperator(opEmail, 'Deliveries Operator', OP_PW);
  const s = await request(API_URL).post('/api/operator/login').send({ email: opEmail, password: OP_PW });
  opToken = s.body.token;
});

afterAll(async () => {
  if (db) {
    await db.query(`DELETE FROM platform_operators WHERE email = $1`, [opEmail]).catch(() => undefined);
    await removeGolden(db);
    await db.end();
  }
  await pool.end().catch(() => undefined);
});

describe('Exporter deliveries (operator log)', () => {
  it('EXD-001 an accepted batch is one row with its summary and a sanitised preview', async () => {
    if (!up) return;
    const issues = Array.from({ length: 25 }, (_, i) => ({
      key: `EXD-${i + 1}`, type: 'bug', status: 'Done', statusCategory: 'done', createdAt: at(10 - (i % 5)), resolvedAt: at(2),
      description: 'customer secret text', assignee: 'someone@example.com', title: 'Login fails for jane@example.com',
    }));
    const r = await send(envelope('issues', issues));
    expect(r.status).toBe(201);
    const row = await latest();
    expect(row).toMatchObject({
      company_id: GOLDEN_COMPANY, department_id: DEPT, team_id: TEAM, api_key_name: 'Deliveries test key', api_key_prefix: apiKey.slice(0, 12),
      exporter_version: '0.3.0', host_label: 'build-box-1', source: 'fake-vendors', kind: 'issues', item_count: 25, dry_run: false, result: 'accepted', http_status: 201,
      records_stored: 25,
    });
    expect(new Date(row.records_from).toISOString().slice(0, 10)).toBe(at(10).slice(0, 10));
    expect(new Date(row.records_to).toISOString().slice(0, 10)).toBe(at(2).slice(0, 10));
    expect(row.bytes_raw).toBeGreaterThan(1000);
    expect(row.preview.shown).toBe(20);
    expect(row.preview.total).toBe(25);
    const text = JSON.stringify(row.preview);
    expect(text).not.toMatch(/customer secret text|someone@example|jane@example|Login fails/);
    expect(row.preview.items[0]).toMatchObject({ key: 'EXD-1', type: 'bug' });

    const report = await send(envelope('test-report', [{ commit: 'aaaa1111', run: 'exd-run', startedAt: at(1), files: [{ name: 'junit.xml', content: '<testsuite name="s"><testcase classname="A" name="t1"><failure message="password=hunter2">stack</failure></testcase></testsuite>' }] }]));
    expect(report.status).toBe(201);
    const r2 = await latest();
    expect(r2.kind).toBe('test-report');
    expect(r2.records_stored).toBe(1);
    expect(JSON.stringify(r2.preview)).not.toMatch(/hunter2|stack/);
    expect(r2.preview.items[0].files[0]).toMatchObject({ name: 'junit.xml' });
  });

  it('EXD-002 rejected batches are logged with their reason; a bad key keeps its prefix only', async () => {
    if (!up) return;
    const otherCompany = (await db.query(`SELECT id FROM companies WHERE id <> $1 ORDER BY id LIMIT 1`, [GOLDEN_COMPANY])).rows[0].id;
    const cases: Array<[Record<string, string>, string, string, number]> = [
      [{ companyId: otherCompany }, 'issues', 'wrong_company', 403],
      [{ teamId: 'golden-team-small' }, 'issues', 'wrong_team', 403],
      [{ departmentId: 'no-such-dept' }, 'issues', 'wrong_department', 403],
      [{}, 'metrics', 'bad_kind', 400],
    ];
    for (const [ids, kind, code, status] of cases) {
      const r = await send(envelope(kind, [{ key: 'EXD-R1', type: 'bug', status: 'Open', createdAt: at(1) }], ids));
      expect(r.status).toBe(status);
      const row = await latest();
      expect(row).toMatchObject({ company_id: GOLDEN_COMPANY, result: 'rejected', reason_code: code, http_status: status });
      if (code === 'wrong_company') expect(row.claimed_company_id).toBe(otherCompany);
      if (code === 'wrong_team') expect(row.claimed_team_id).toBe('golden-team-small');
    }
    const missing: any = envelope('issues', [{}]);
    delete missing.teamId;
    expect((await send(missing)).status).toBe(400);
    expect((await latest()).reason_code).toBe('missing_id');

    const badKey = `igk_${'Z'.repeat(43)}`;
    const r = await send(envelope('issues', [{ key: 'X-1' }]), { auth: badKey });
    expect(r.status).toBe(401);
    const row = await latest();
    expect(row).toMatchObject({ company_id: null, api_key_prefix: badKey.slice(0, 12), result: 'rejected', reason_code: 'bad_key', http_status: 401 });
    // No row anywhere holds a full key.
    const all = JSON.stringify((await db.query(`SELECT * FROM exporter_deliveries`)).rows);
    expect(all).not.toContain(badKey);
    expect(all).not.toContain(apiKey);
  });

  it('EXD-003 only the operator reads the list, the detail and the CSV', async () => {
    if (!up) return;
    const list = await op(`/exporter-deliveries?companyId=${GOLDEN_COMPANY}&teamId=${TEAM}&result=accepted`);
    expect(list.status).toBe(200);
    expect(list.body.entries.length).toBeGreaterThanOrEqual(2);
    expect(list.body.entries.every((e: any) => e.company_id === GOLDEN_COMPANY && e.team_id === TEAM && e.result === 'accepted')).toBe(true);
    const rejected = await op('/exporter-deliveries?companyId=none');
    expect(rejected.body.entries.every((e: any) => e.company_id === null)).toBe(true);
    const detail = await op(`/exporter-deliveries/${list.body.entries[0].id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.preview).toBeTruthy();
    const csv = await op(`/exporter-deliveries.csv?companyId=${GOLDEN_COMPANY}`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Records stored');
    expect(csv.text).not.toContain(apiKey);
    // A company admin's session, an API key and no credential get nothing.
    for (const r of [
      await request(API_URL).get('/api/operator/exporter-deliveries').set('Cookie', adminCookie),
      await request(API_URL).get('/api/operator/exporter-deliveries').set('Authorization', `Bearer ${apiKey}`),
      await request(API_URL).get('/api/operator/exporter-deliveries'),
      await request(API_URL).get(`/api/operator/exporter-deliveries/${list.body.entries[0].id}`).set('Cookie', adminCookie),
      await request(API_URL).get('/api/operator/exporter-deliveries.csv').set('Cookie', adminCookie),
    ]) {
      expect([401, 403, 404]).toContain(r.status);
      expect(JSON.stringify(r.body)).not.toContain(GOLDEN_COMPANY);
    }
  });

  it('EXD-004 the company sees its batches in its own ingestion log; another company does not', async () => {
    if (!up) return;
    const mine = await get('/api/ingestion-log?channel=exporter', adminCookie);
    expect(mine.status).toBe(200);
    const entries = mine.body.entries ?? mine.body;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e: any) => e.channel === 'exporter')).toBe(true);
    const theirs = await get('/api/ingestion-log?channel=exporter', otherCookie);
    expect(theirs.status).toBe(200);
    const ids = new Set(entries.map((e: any) => e.id));
    expect((theirs.body.entries ?? theirs.body).some((e: any) => ids.has(e.id))).toBe(false);
  });

  it('EXD-005 rows older than 30 days are removed by the cleanup', async () => {
    if (!up) return;
    const old = (await db.query(`INSERT INTO exporter_deliveries (received_at, company_id, result, http_status) VALUES (now() - interval '31 days', $1, 'accepted', 201) RETURNING id`, [GOLDEN_COMPANY])).rows[0].id;
    const recent = (await db.query(`INSERT INTO exporter_deliveries (received_at, company_id, result, http_status) VALUES (now() - interval '29 days', $1, 'accepted', 201) RETURNING id`, [GOLDEN_COMPANY])).rows[0].id;
    expect(await cleanupDeliveries()).toBeGreaterThanOrEqual(1);
    expect((await db.query(`SELECT id FROM exporter_deliveries WHERE id = ANY($1::text[])`, [[old, recent]])).rows.map((r: any) => r.id)).toEqual([recent]);
  });
});
