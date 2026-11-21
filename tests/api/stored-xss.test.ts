/**
 * Stored XSS through names: the attacker's path is to save an HTML payload as a name (their own
 * first / last name, or a team / department / company name) that other people's browsers later
 * render (confirmation dialogs, toasts, 409 dependency lists). Every write path for a name refuses
 * markup with 400 and stores nothing (server/lib/displayName.ts); names from an identity provider
 * are normalised instead. See SECURITY.md "Input handling".
 *
 *   XSSAPI-001 PUT /api/users/:id (own profile): first / last name with markup, control characters
 *              or over 100 characters → 400, nothing stored; a real name is trimmed and saved
 *   XSSAPI-002 POST /api/admin/users: first / last name with markup → 400, no user created
 *   XSSAPI-003 PUT /api/admin/users/:id: first / last name and job title with markup → 400, unchanged
 *   XSSAPI-004 teams: create (POST /api/admin/teams, POST /api/teams) and rename (PUT /api/admin/teams/:id,
 *              PUT /api/teams/:id) with markup → 400, nothing stored
 *   XSSAPI-005 departments: create and rename with markup → 400, nothing stored
 *   XSSAPI-006 POST /api/auth/register: any of the five names with markup → 400, no organisation created
 *   XSSAPI-007 POST /api/auth/invitations/accept: names with markup → 400, the invitation stays open
 *   XSSAPI-008 SSO provisioning (acceptInvitation with an identity): a provider name with markup and
 *              control characters is normalised, not stored as markup
 *   XSSAPI-009 platform operator: company create / rename, first department / team and first person
 *              names with markup → 400, no company created
 *
 * Runs against a live backend at API_URL plus an in-process copy (registration and operator routes,
 * so the per-IP sign-in limiter of the live API is not used up). FAILS (does not skip) when no
 * backend is running: an attack test that silently skips proves nothing.
 */
import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, NEW_PW, backendUp, del, get, localDb, login, post, put } from './helpers/http';
import { buildApp } from './helpers/inProcessApp';
import { upsertOperator } from '../../server/lib/operator';
import { acceptInvitation } from '../../server/lib/invitations';
import { flushBackgroundWrites } from '../../server/lib/opsLog';
import { pool } from '../../src/lib/db';

const PAYLOAD = '<img src=x onerror="window.__xss=1">';
const SCRIPT = '<script>window.__xss=1</script>';
const stamp = Date.now();
const app = buildApp();
const OP_PW = 'Xss-Operator-Passw0rd!';
const opEmail = `xss-op-${stamp}@platform${stamp}.test`;

let db: Client;
let admin = { cookie: '', id: '', departmentId: '' };
let engineer = { cookie: '', id: '', first: '', last: '' };
let teamId = '';
let deptId = '';
let opToken = '';
const usersToDelete: string[] = [];

const count = async (sql: string, params: unknown[]) => Number((await db.query(sql, params)).rows[0].n);
const markupNames = async (table: 'users' | 'teams' | 'departments' | 'companies') => {
  const col = table === 'users' ? "first_name || ' ' || last_name" : 'name';
  return count(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} LIKE '%<img src=x onerror%' OR ${col} LIKE '%<script>window.__xss%'`, []);
};

beforeAll(async () => {
  if (!(await backendUp())) throw new Error(`No backend at ${API_URL}: start the API (scripts/ci/start-services.sh) before running the stored-XSS suite`);
  db = await localDb();
  const a = await login('admin@irongate.com');
  admin = { cookie: a.cookie, id: a.user.id, departmentId: a.user.department_id };
  const e = await login('engineer@irongate.com');
  engineer = { cookie: e.cookie, id: e.user.id, first: e.user.first_name ?? e.user.firstName, last: e.user.last_name ?? e.user.lastName };
  const row = (await db.query('SELECT first_name, last_name FROM users WHERE id = $1', [engineer.id])).rows[0];
  engineer.first = row.first_name; engineer.last = row.last_name;

  const d = await post('/api/admin/departments', admin.cookie, { name: `XSS Dept ${stamp}` });
  expect(d.status).toBe(201);
  deptId = d.body.id;
  const t = await post('/api/admin/teams', admin.cookie, { name: `XSS Team ${stamp}`, departmentId: deptId });
  expect(t.status).toBe(201);
  teamId = t.body.id;

  await upsertOperator(opEmail, 'XSS Operator', OP_PW);
  opToken = (await request(app).post('/api/operator/login').send({ email: opEmail, password: OP_PW })).body.token;
}, 60_000);

afterAll(async () => {
  if (db) {
    // Put the engineer's name back whatever happened, and remove anything a vulnerable build stored.
    await db.query('UPDATE users SET first_name = $2, last_name = $3 WHERE id = $1', [engineer.id, engineer.first, engineer.last]).catch(() => undefined);
    if (usersToDelete.length) await db.query('DELETE FROM users WHERE id = ANY($1)', [usersToDelete]).catch(() => undefined);
    await db.query(`DELETE FROM users WHERE email LIKE $1`, [`xss-%-${stamp}@%`]).catch(() => undefined);
    await db.query(`DELETE FROM companies WHERE name LIKE '%<img src=x onerror%' OR name LIKE $1`, [`%XSS Org ${stamp}%`]).catch(() => undefined);
    await db.query('DELETE FROM platform_operators WHERE email = $1', [opEmail]).catch(() => undefined);
  }
  if (admin.cookie) {
    if (teamId) await del(`/api/admin/teams/${teamId}`, admin.cookie);
    if (deptId) await del(`/api/admin/departments/${deptId}`, admin.cookie);
    // A vulnerable build may have created teams / departments with the payload: deactivate them.
    if (db) {
      await db.query(`UPDATE teams SET is_active = FALSE WHERE name LIKE '%<img src=x onerror%' OR name LIKE '%<script>window.__xss%'`).catch(() => undefined);
      await db.query(`UPDATE departments SET is_active = FALSE WHERE name LIKE '%<img src=x onerror%' OR name LIKE '%<script>window.__xss%'`).catch(() => undefined);
    }
  }
  await db?.end();
  await flushBackgroundWrites(2000);
  await pool.end();
});

describe('Stored XSS: every write path for a name refuses markup', () => {
  test('XSSAPI-001 PUT /api/users/:id refuses markup, control characters and over-long names in the own profile', async () => {
    const path = `/api/users/${engineer.id}`;
    for (const body of [{ firstName: PAYLOAD }, { lastName: PAYLOAD }, { firstName: SCRIPT, lastName: 'X' }, { firstName: 'Ada\u0007' }, { lastName: 'Line\nBreak' }, { firstName: 'a'.repeat(101) }, { firstName: '   ' }]) {
      const res = await put(path, engineer.cookie, body);
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
      expect(typeof res.body.error).toBe('string');
    }
    expect((await put(path, engineer.cookie, { firstName: PAYLOAD })).body.error).toBe('First name cannot contain < or >');
    const row = (await db.query('SELECT first_name, last_name FROM users WHERE id = $1', [engineer.id])).rows[0];
    expect(row).toEqual({ first_name: engineer.first, last_name: engineer.last });

    // A real name with an apostrophe, a hyphen and an accent is saved (trimmed).
    const ok = await put(path, engineer.cookie, { firstName: "  Zoë O'Brien-Smith  " });
    expect(ok.status).toBe(200);
    expect(ok.body.user.first_name).toBe("Zoë O'Brien-Smith");
    expect((await put(path, engineer.cookie, { firstName: engineer.first })).status).toBe(200);
  });

  test('XSSAPI-002 POST /api/admin/users refuses markup in a new user\'s name and creates nobody', async () => {
    for (const [k, names] of [['f', { firstName: PAYLOAD, lastName: 'Person' }], ['l', { firstName: 'Pat', lastName: SCRIPT }]] as const) {
      const email = `xss-${k}-${stamp}@irongate.test`;
      const res = await post('/api/admin/users', admin.cookie, { email, password: NEW_PW, role: 'qa_engineer', teamId, departmentId: deptId, ...names });
      if (res.status < 300 && res.body?.id) usersToDelete.push(res.body.id);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/(First|Last) name cannot contain < or >/);
      expect(await count('SELECT count(*)::int AS n FROM users WHERE email = $1', [email])).toBe(0);
    }
  });

  test('XSSAPI-003 PUT /api/admin/users/:id refuses markup in names and the job title and keeps the stored values', async () => {
    const path = `/api/admin/users/${engineer.id}`;
    for (const body of [{ firstName: PAYLOAD }, { lastName: PAYLOAD }, { jobTitle: PAYLOAD }]) {
      const res = await put(path, admin.cookie, body);
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
    }
    const row = (await db.query('SELECT first_name, last_name, job_title FROM users WHERE id = $1', [engineer.id])).rows[0];
    expect([row.first_name, row.last_name]).toEqual([engineer.first, engineer.last]);
    expect(String(row.job_title ?? '')).not.toContain('<');
  });

  test('XSSAPI-004 team create and rename refuse markup on both team APIs', async () => {
    const before = await markupNames('teams');
    const results = [
      await post('/api/admin/teams', admin.cookie, { name: PAYLOAD, departmentId: deptId }),
      await post('/api/teams', admin.cookie, { name: `T ${SCRIPT}`, departmentId: deptId }),
      await put(`/api/admin/teams/${teamId}`, admin.cookie, { name: PAYLOAD, description: '' }),
      await put(`/api/teams/${teamId}`, admin.cookie, { name: `T ${SCRIPT}` }),
    ];
    expect(results.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    for (const r of results) expect(r.body.error).toBe('Team name cannot contain < or >');
    expect(await markupNames('teams')).toBe(before);
    expect((await db.query('SELECT name FROM teams WHERE id = $1', [teamId])).rows[0].name).toBe(`XSS Team ${stamp}`);
  });

  test('XSSAPI-005 department create and rename refuse markup', async () => {
    const before = await markupNames('departments');
    const results = [
      await post('/api/admin/departments', admin.cookie, { name: PAYLOAD }),
      await put(`/api/admin/departments/${deptId}`, admin.cookie, { name: `D ${SCRIPT}` }),
    ];
    expect(results.map((r) => r.status)).toEqual([400, 400]);
    for (const r of results) expect(r.body.error).toBe('Department name cannot contain < or >');
    expect(await markupNames('departments')).toBe(before);
    expect((await db.query('SELECT name FROM departments WHERE id = $1', [deptId])).rows[0].name).toBe(`XSS Dept ${stamp}`);
  });

  test('XSSAPI-006 registration refuses markup in any of the five names and creates no organisation', async () => {
    const base = { password: NEW_PW, firstName: 'Ada', lastName: 'Lovelace', companyName: `XSS Org ${stamp}`, departmentName: 'Engineering', teamName: 'Core' };
    for (const field of ['firstName', 'lastName', 'companyName', 'departmentName', 'teamName'] as const) {
      const email = `xss-reg-${field.toLowerCase()}-${stamp}@xssreg${stamp}${field.toLowerCase()}.test`;
      const value = field === 'companyName' ? `XSS Org ${stamp} ${PAYLOAD}` : PAYLOAD;
      const res = await request(app).post('/api/auth/register').send({ ...base, email, [field]: value });
      expect({ field, status: res.status }).toEqual({ field, status: 400 });
      expect(res.body.error).toMatch(/cannot contain < or >/);
      expect(await count('SELECT count(*)::int AS n FROM users WHERE email = $1', [email])).toBe(0);
    }
    expect(await count('SELECT count(*)::int AS n FROM companies WHERE name LIKE $1', [`XSS Org ${stamp}%`])).toBe(0);
  });

  test('XSSAPI-007 accepting an invitation refuses markup in the names; the invitation stays usable', async () => {
    const email = `xss-inv-${stamp}@irongate.test`;
    const inv = await post('/api/admin/invitations', admin.cookie, { email, role: 'qa_engineer', scopeId: teamId });
    expect(inv.status).toBe(201);
    const token = new URL(inv.body.link).searchParams.get('token') as string;
    for (const names of [{ firstName: PAYLOAD, lastName: 'Person' }, { firstName: 'Pat', lastName: SCRIPT }]) {
      const res = await post('/api/auth/invitations/accept', '', { token, password: NEW_PW, ...names });
      const created = (await db.query('SELECT id FROM users WHERE email = $1', [email])).rows[0];
      if (created) usersToDelete.push(created.id);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/(First|Last) name cannot contain < or >/);
      expect(created).toBeUndefined();
    }
    expect((await get(`/api/auth/invitations/${encodeURIComponent(token)}`)).body.status).toBe('open');
    await post(`/api/admin/invitations/${inv.body.invitation.id}/revoke`, admin.cookie);
  });

  test('XSSAPI-008 SSO provisioning normalises a provider name with markup and control characters', async () => {
    const email = `xss-sso-${stamp}@irongate.test`;
    const inv = await post('/api/admin/invitations', admin.cookie, { email, role: 'qa_engineer', scopeId: teamId });
    expect(inv.status).toBe(201);
    const { userId } = await acceptInvitation({
      invitationId: inv.body.invitation.id, firstName: `${PAYLOAD}Sam\u0007`, lastName: 'Lee\n<b>x</b>', password: null,
      sso: { provider: 'google', subject: `xss-sub-${stamp}` }, verifiedEmail: email,
    });
    usersToDelete.push(userId);
    const row = (await db.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId])).rows[0];
    // eslint-disable-next-line no-control-regex
    expect(row.first_name).not.toMatch(/[<>\u0000-\u001f]/);
    // eslint-disable-next-line no-control-regex
    expect(row.last_name).not.toMatch(/[<>\u0000-\u001f]/);
    expect(row.first_name).toBe('img src=x onerror="window.__xss=1"Sam');
    expect(row.last_name).toBe('Lee bx/b');
    await db.query('DELETE FROM user_identities WHERE user_id = $1', [userId]);
  });

  test('XSSAPI-009 platform operator: markup in company, department, team or first-person names → 400, nothing created', async () => {
    const op = (method: 'post' | 'put', path: string, body: object) => request(app)[method](`/api/operator${path}`).set('X-Operator-Token', opToken).send(body);
    expect(opToken).toBeTruthy();
    const domain = (k: string) => `xssop${k}${stamp}.test`;
    const cases: Array<[string, object]> = [
      ['company', { name: `XSS Org ${stamp} ${PAYLOAD}`, domain: domain('a') }],
      ['department', { name: `XSS Org ${stamp} B`, domain: domain('b'), departmentName: PAYLOAD }],
      ['team', { name: `XSS Org ${stamp} C`, domain: domain('c'), teamName: SCRIPT }],
      ['person', { name: `XSS Org ${stamp} D`, domain: domain('d'), admin: { email: `boss@${domain('d')}`, mode: 'password', firstName: PAYLOAD, lastName: 'Boss', password: NEW_PW } }],
    ];
    for (const [what, body] of cases) {
      const res = await op('post', '/companies', body);
      expect({ what, status: res.status }).toEqual({ what, status: 400 });
      expect(res.body.error).toMatch(/cannot contain < or >/);
    }
    expect(await count('SELECT count(*)::int AS n FROM companies WHERE name LIKE $1', [`XSS Org ${stamp}%`])).toBe(0);

    // Rename an existing company to markup: refused, the name is kept.
    const ok = await op('post', '/companies', { name: `XSS Org ${stamp} OK`, domain: domain('ok') });
    expect(ok.status).toBe(201);
    const ren = await op('put', `/companies/${ok.body.company.id}`, { name: PAYLOAD });
    expect(ren.status).toBe(400);
    expect((await db.query('SELECT name FROM companies WHERE id = $1', [ok.body.company.id])).rows[0].name).toBe(`XSS Org ${stamp} OK`);
  });
});
