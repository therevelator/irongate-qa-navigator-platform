/**
 * User activity log (server/lib/userActivity.ts, routes /api/activity), against the live API.
 *
 *   UA-001  only super admins of the company: QA manager, team lead, engineer and viewer get 403
 *   UA-002  a super admin of company A never sees company B's rows
 *   UA-003  a GET, a change, a failed sign-in and an API-key ingestion request each give one row
 *           with the right fields (route pattern, entity ids, status, request id, actor)
 *   UA-004  no body, query string, password or token content is ever stored
 *   UA-005  screen views: recorded for the session's user and company (never the body's), foreign
 *           teams dropped, duplicates within 10 s dropped, rate limited (60 requests a minute)
 *   UA-006  CSV export works and is itself recorded as an export; filters and pagination
 *   UA-007  not recorded: the session check, the log's own list requests, pulse answers
 */
import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, NEW_PW, backendUp, cookieFrom, del, get, localDb, login, post } from './helpers/http';

let up = true;
let db: Client;
const stamp = Date.now();
const MARK = `UAMARK${stamp}`;
const c: Record<string, string> = {};
const id: Record<string, string> = {};
let companyA = '';
let companyB = '';
let teamA = '';
let teamB = '';
let deptA = '';
const created: string[] = [];
let plaintextKey = '';

const rid = (k: string) => `ua-${k}-${stamp}`;

async function rowsFor(requestId: string, expect = 1) {
  for (let i = 0; i < 30; i++) {
    const r = await db.query('SELECT * FROM user_activity WHERE request_id = $1 ORDER BY created_at', [requestId]);
    if (r.rows.length >= expect) return r.rows;
    await new Promise((x) => setTimeout(x, 150));
  }
  return (await db.query('SELECT * FROM user_activity WHERE request_id = $1', [requestId])).rows;
}

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  const regA = await request(API_URL).post('/api/auth/register').send({
    email: `ua-admin-${stamp}@uaa${stamp}.test`, password: NEW_PW, firstName: 'Ada', lastName: 'Admin',
    companyName: `UA Company A ${stamp}`, departmentName: 'Eng', teamName: `UA Team A ${stamp}`,
  });
  c.admin = cookieFrom(regA);
  id.admin = regA.body.user.id;
  companyA = regA.body.user.company_id;
  teamA = regA.body.user.primary_team_id;
  deptA = regA.body.user.department_id;
  const regB = await request(API_URL).post('/api/auth/register').send({
    email: `ua-other-${stamp}@uab${stamp}.test`, password: NEW_PW, firstName: 'Bo', lastName: 'Other',
    companyName: `UA Company B ${stamp}`, departmentName: 'Eng', teamName: `UA Team B ${stamp}`,
  });
  c.other = cookieFrom(regB);
  companyB = regB.body.user.company_id;
  teamB = regB.body.user.primary_team_id;
  const mk = async (key: string, role: string, where: object) => {
    const email = `ua-${key}-${stamp}@uaa${stamp}.test`;
    const res = await post('/api/admin/users', c.admin, { email, password: NEW_PW, firstName: 'U', lastName: key, role, ...where });
    if (res.status !== 201) throw new Error(`create ${key}: ${res.status} ${JSON.stringify(res.body)}`);
    id[key] = res.body.id;
    created.push(res.body.id);
    c[key] = (await login(email, NEW_PW)).cookie;
    id[`${key}Email`] = email;
  };
  await mk('manager', 'qa_manager', { departmentId: deptA });
  await mk('lead', 'team_lead', { teamId: teamA });
  await mk('engineer', 'qa_engineer', { teamId: teamA });
  await mk('viewer', 'viewer', { teamId: teamA });
}, 60_000);

afterAll(async () => {
  if (!up) return;
  for (const u of created) await del(`/api/admin/users/${u}`, c.admin);
  await db?.end();
});

describe('User activity log', () => {
  test('UA-001 only super admins of the company may read it', async () => {
    if (!up) return;
    for (const who of ['manager', 'lead', 'engineer', 'viewer']) {
      for (const p of ['/api/activity/log', '/api/activity/log/facets', '/api/activity/log.csv']) {
        const res = await get(p, c[who]);
        expect({ who, p, status: res.status }).toEqual({ who, p, status: 403 });
      }
    }
    expect((await get('/api/activity/log', '')).status).toBe(401);
    expect((await get('/api/activity/log', c.admin)).status).toBe(200);
  });

  test('UA-003 a GET, a change, a failed sign-in and an ingestion request each give one row', async () => {
    if (!up) return;
    // GET with path params: route pattern and team id.
    const g = await get(`/api/teams/${teamA}?search=${MARK}`, c.engineer).set('X-Request-Id', rid('get'));
    expect(g.status).toBe(200);
    const [gr, ...gmore] = await rowsFor(rid('get'));
    expect(gmore).toHaveLength(0);
    expect(gr).toMatchObject({
      company_id: companyA, user_id: id.engineer, category: 'view', method: 'GET', route: '/api/teams/:id',
      team_id: teamA, entity_type: 'team', entity_id: teamA, status: 200,
    });
    expect(gr.actor_display).toContain(id.engineerEmail);
    expect(gr.duration_ms).toBeGreaterThanOrEqual(0);
    expect(gr.ip).toBeTruthy();

    // A change (department create, body with marker values).
    const ch = await post('/api/admin/departments', c.admin, { name: `UA Dept ${stamp}`, description: `${MARK} body text` }).set('X-Request-Id', rid('change'));
    expect(ch.status).toBe(201);
    const [cr] = await rowsFor(rid('change'));
    expect(cr).toMatchObject({ company_id: companyA, user_id: id.admin, category: 'change', method: 'POST', route: '/api/admin/departments', status: 201 });
    await del(`/api/admin/departments/${ch.body.id}`, c.admin);

    // Failed sign-in of a known user (the typed password is never stored).
    const fs = await request(API_URL).post('/api/auth/login').set('X-Request-Id', rid('fail')).send({ email: id.viewerEmail.toUpperCase(), password: `${MARK}-wrong` });
    expect(fs.status).toBe(401);
    const [fr] = await rowsFor(rid('fail'));
    expect(fr).toMatchObject({ company_id: companyA, user_id: id.viewer, category: 'sign_in_failed', route: '/api/auth/login', status: 401 });
    // Unknown email: nothing to attribute, nothing stored.
    const unk = await request(API_URL).post('/api/auth/login').set('X-Request-Id', rid('unknown')).send({ email: `nobody-${stamp}@nowhere.test`, password: 'x' });
    expect(unk.status).toBe(401);
    // A successful sign-in.
    const ok = await request(API_URL).post('/api/auth/login').set('X-Request-Id', rid('signin')).send({ email: id.viewerEmail, password: NEW_PW });
    expect(ok.status).toBe(200);
    const [sr] = await rowsFor(rid('signin'));
    expect(sr).toMatchObject({ company_id: companyA, user_id: id.viewer, category: 'sign_in', status: 200 });

    // API-key ingestion (invalid body: still recorded, actor = the key).
    const key = await post('/api/admin/api-keys', c.admin, { name: `UA key ${stamp}` });
    plaintextKey = key.body.plaintextKey;
    const ing = await request(API_URL).post(`/api/ingest/kpis?note=${MARK}`).set('Authorization', `Bearer ${key.body.plaintextKey}`).set('X-Request-Id', rid('ingest'))
      .send({ teamId: teamA, source: MARK, metrics: { test_coverage: 'not-a-number' } });
    expect(ing.status).toBe(400);
    const [ir] = await rowsFor(rid('ingest'));
    expect(ir).toMatchObject({ company_id: companyA, user_id: null, api_key_id: key.body.key.id, category: 'ingest', route: '/api/ingest/kpis', status: 400 });
    expect(ir.actor_display).toBe(`API key UA key ${stamp} (${key.body.key.key_prefix ?? key.body.key.keyPrefix}…)`);

    expect((await rowsFor(rid('unknown'), 0))).toHaveLength(0);
  });

  test('UA-004 no body, query, password or token content is stored', async () => {
    if (!up) return;
    const all = await db.query('SELECT * FROM user_activity WHERE company_id = $1', [companyA]);
    const text = JSON.stringify(all.rows);
    expect(all.rows.length).toBeGreaterThan(3);
    expect(text).not.toContain(MARK);
    expect(text).not.toContain(NEW_PW);
    // The key's public prefix names the actor; the key itself is never stored.
    expect(plaintextKey.length).toBeGreaterThan(20);
    expect(text).not.toContain(plaintextKey);
    expect(text).not.toContain(plaintextKey.slice(12));
    expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(text).not.toContain('?');
  });

  test('UA-002 a super admin of another company never sees these rows', async () => {
    if (!up) return;
    const mine = await get('/api/activity/log?limit=200', c.admin);
    expect(mine.body.entries.some((e: any) => e.request_id === rid('get'))).toBe(true);
    const theirs = await get('/api/activity/log?limit=200', c.other);
    expect(theirs.status).toBe(200);
    expect(theirs.body.entries.every((e: any) => !String(e.request_id).startsWith(`ua-`) || !String(e.request_id).endsWith(`${stamp}`))).toBe(true);
    expect((await get(`/api/activity/log?requestId=${rid('get')}`, c.other)).body.entries).toHaveLength(0);
    // Rows are labelled.
    const one = (await get(`/api/activity/log?requestId=${rid('get')}`, c.admin)).body.entries[0];
    expect(one.label).toBe(`Viewed team UA Team A ${stamp}`);
    expect(one.categoryLabel).toBe('View');
  });

  test('UA-005 screen views: session user and company only, foreign team dropped, deduped, rate limited', async () => {
    if (!up) return;
    const res = await post('/api/activity/screen', c.lead, {
      events: [
        { screen: 'team-pulse', teamId: teamA, companyId: companyB, userId: id.admin },
        { screen: 'team-pulse', teamId: teamA },
        { screen: 'business-impact', teamId: teamB },
        { screen: 'Bad Screen <x>' },
      ],
      companyId: companyB, userId: id.admin,
    }).set('X-Request-Id', rid('screen'));
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(2);
    const rows = await rowsFor(rid('screen'), 2);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ company_id: companyA, user_id: id.lead, category: 'screen' });
    expect(rows.map((r: any) => [r.screen, r.team_id]).sort()).toEqual([['business-impact', null], ['team-pulse', teamA]]);
    // The screen endpoint itself adds no extra row.
    expect(rows.every((r: any) => r.route === null)).toBe(true);
    // Rate limit: 60 requests a minute per user.
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await post('/api/activity/screen', c.viewer, { events: [{ screen: `s-${i}` }] })).status);
    expect(statuses.slice(0, 59).every((s) => s === 200)).toBe(true);
    expect(statuses[statuses.length - 1]).toBe(429);
    expect((await post('/api/activity/screen', '', { events: [{ screen: 'x' }] })).status).toBe(401);
  });

  test('UA-006 CSV export is recorded; filters and pagination', async () => {
    if (!up) return;
    const csv = await get('/api/activity/log.csv?type=view', c.admin).set('X-Request-Id', rid('csv'));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Request id');
    const [er] = await rowsFor(rid('csv'));
    expect(er).toMatchObject({ category: 'export', route: '/api/activity/log.csv' });
    const failed = await get('/api/activity/log?type=failed', c.admin);
    expect(failed.body.entries.length).toBeGreaterThan(0);
    expect(failed.body.entries.every((e: any) => e.category === 'sign_in_failed' || e.status >= 400)).toBe(true);
    const byUser = await get(`/api/activity/log?userId=${id.lead}`, c.admin);
    expect(byUser.body.entries.every((e: any) => e.user_id === id.lead)).toBe(true);
    const byTeam = await get(`/api/activity/log?teamId=${teamA}`, c.admin);
    expect(byTeam.body.entries.length).toBeGreaterThan(0);
    const page1 = await get('/api/activity/log?limit=2', c.admin);
    expect(page1.body.entries).toHaveLength(2);
    const page2 = await get(`/api/activity/log?limit=2&before=${page1.body.nextBefore}`, c.admin);
    expect(page2.body.entries[0].id).not.toBe(page1.body.entries[0].id);
    expect((await get('/api/activity/log?limit=99999', c.admin)).body.entries.length).toBeLessThanOrEqual(200);
  });

  test('UA-007 not recorded: session check, the log list itself, pulse answers', async () => {
    if (!up) return;
    await get('/api/auth/me', c.admin).set('X-Request-Id', rid('me'));
    await get('/api/activity/log', c.admin).set('X-Request-Id', rid('list'));
    await post(`/api/pulse/teams/${teamA}/responses`, c.engineer, { answers: {} }).set('X-Request-Id', rid('pulse'));
    await new Promise((x) => setTimeout(x, 1200));
    for (const k of ['me', 'list', 'pulse']) expect({ k, n: (await db.query('SELECT 1 FROM user_activity WHERE request_id = $1', [rid(k)])).rows.length }).toEqual({ k, n: 0 });
  });
});
