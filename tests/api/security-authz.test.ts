/**
 * Authorization: account takeover by managers / team leads, and cross-company synthetic writes.
 * Attacker-path tests: every request is the attacker's own, through the PRODUCTION entry point
 * (the Netlify function netlify/functions/api.ts, in-process through serverless-http); the exploit
 * chain also runs through the Express app (the route modules server/index.ts mounts).
 *
 * No silent skip: the suite needs the local database (DATABASE_URL, local host only) and fails
 * when it is missing. It creates its own data: in ONE real company, departments D1 and D2 with
 * two teams each, a manager per department, leads, engineers, a viewer and people with mixed
 * scopes; a SECOND real company (B); and a SAMPLE company ('demo-' id, as the demo generators
 * create them).
 *
 *   AUTHZ-001 exploit chain (manager): D1 manager adds "viewer of a D1 team" to the D2 team lead
 *             → 403; reset that lead's password → 403; the attacker's password does not sign in
 *   AUTHZ-002 exploit chain (team lead): lead of T1 adds "viewer of T1" to an engineer of T2 → 403,
 *             reset → 403, no sign-in
 *   AUTHZ-003 every account-wide action against an out-of-scope or MIXED-scope user → 403
 *             (reset password, send reset link, sign out everywhere, activate/deactivate,
 *             developer insights, edit, delete), for a manager and for a team lead
 *   AUTHZ-004 in-scope management still works (200 / 201), including deleting
 *   AUTHZ-005 adding an assignment needs the person already entirely in scope; super admins may
 *             add across scopes
 *   AUTHZ-006 PUT /api/admin/users/:id: a primary-assignment change that would revoke a grant in
 *             another department → 403, the grant stays; setPrimaryAssignment refuses without the
 *             revoke right (nothing written)
 *   AUTHZ-007 PUT /api/teams/:id: a team lead cannot rename or deactivate their team; a manager of
 *             its department can
 *   AUTHZ-008 GET /api/admin/configs and /configs/raw: department / team levels only within the
 *             reader's departments / led teams
 *   AUTHZ-009 e-mail changes: nobody but a super admin changes another person's address; a super
 *             admin's change is validated and ends that person's sessions; the self-service change
 *             is validated (format, platform operator addresses, taken) and ends the other sessions
 *   SYNTH-001 POST /api/analytics/update-daily from a real company → 403; nothing changes in any
 *             company; from a sample company → only that company changes, never company B
 *   SYNTH-002 POST /api/analytics/seed-data from a real company → 403, nothing written
 *   SYNTH-003 POST …/generate-realistic-data for a real company's team → 403
 *   SYNTH-004 the background generators (interval KPI sync, pipeline seeder, analytics seed, the
 *             15-minute mock KPI job) and the productivity snapshot seed CLI, with
 *             ENABLE_SYNTHETIC_DATA=true, never change a real company's rows
 */
import 'dotenv/config';
import { execFile } from 'child_process';
import bcrypt from 'bcrypt';
import express from 'express';
import request from 'supertest';
import type { Client } from 'pg';
import { NEW_PW, localDb } from './helpers/http';

// Production configuration of the function: no cron jobs; a rate limit that 200 requests stay under.
process.env.NETLIFY = 'true';
process.env.API_RATE_LIMIT_MAX = '100000';
process.env.ENABLE_SYNTHETIC_DATA = 'true';

// The background job modules schedule with node-cron at import: capture the callbacks instead.
const scheduled: Array<{ expr: string; fn: () => any }> = [];
jest.mock('node-cron', () => ({
  __esModule: true,
  default: { schedule: (expr: string, fn: () => any) => { scheduled.push({ expr, fn }); return { stop() {} }; } },
  schedule: (expr: string, fn: () => any) => { scheduled.push({ expr, fn }); return { stop() {} }; },
}));

jest.setTimeout(120_000);

const stamp = Date.now();
const mail = (who: string, dom = 'a') => `${who}-${stamp}@sec${dom}${stamp}.test`;

type Res = { status: number; body: any; cookie: string };
type Transport = (method: string, path: string, cookie?: string, body?: object) => Promise<Res>;

let handler: (event: any, context: any) => Promise<any>;
let expressApp: express.Express;
let db: Client;

/** Through the Netlify function (production). */
const viaNetlify: Transport = async (method, path, cookie = '', body) => {
  const [p, q = ''] = path.split('?');
  const res = await handler({
    httpMethod: method, path: p, rawUrl: `https://example.test${path}`, rawQuery: q,
    queryStringParameters: Object.fromEntries(new URLSearchParams(q)), multiValueQueryStringParameters: {},
    headers: {
      'content-type': 'application/json', 'user-agent': 'security-authz-test', 'x-nf-client-connection-ip': '203.0.113.9',
      ...(cookie ? { cookie } : {}),
    },
    multiValueHeaders: {}, body: body ? JSON.stringify(body) : null, isBase64Encoded: false,
  }, {});
  const setCookie: string[] = ([] as string[]).concat(res.multiValueHeaders?.['set-cookie'] ?? res.headers?.['set-cookie'] ?? []);
  const c = (setCookie.find((x) => x.startsWith('irongate_token=')) ?? '').split(';')[0];
  let parsed: any = null;
  try { parsed = res.body ? JSON.parse(res.body) : null; } catch { parsed = res.body; }
  return { status: res.statusCode, body: parsed, cookie: c };
};

/** Through the Express route modules, mounted as server/index.ts mounts them. */
const viaExpress: Transport = async (method, path, cookie = '', body) => {
  let r = (request(expressApp) as any)[method.toLowerCase()](path).set('Cookie', cookie);
  if (body) r = r.send(body);
  const res = await r;
  const raw = res.headers['set-cookie'];
  const list: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const c = (list.find((x) => x.startsWith('irongate_token=')) ?? '').split(';')[0];
  return { status: res.status, body: res.body, cookie: c };
};

const api: Transport = (...a) => viaNetlify(...a);
const login = async (email: string, password = NEW_PW, t: Transport = api) => (await t('POST', '/api/auth/login', '', { email, password }));

// ---- fixture ------------------------------------------------------------------------------
const ids: Record<string, string> = {};
const cookies: Record<string, string> = {};
let companyA = '';
let companyB = '';
const companyS = `demo-secauthz-${stamp}`;
let teamS = '';

async function userId(email: string) {
  return (await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email])).rows[0]?.id as string;
}
async function createUser(owner: string, key: string, role: string, opts: { teamId?: string; departmentId?: string }) {
  const r = await api('POST', '/api/admin/users', owner, {
    email: mail(key), password: NEW_PW, firstName: key, lastName: 'Sec', role, ...opts,
  });
  if (r.status !== 201) throw new Error(`create ${key}: ${r.status} ${JSON.stringify(r.body)}`);
  ids[key] = await userId(mail(key));
}
async function addAssignment(owner: string, key: string, role: string, scopeId: string) {
  const r = await api('POST', `/api/admin/users/${ids[key]}/assignments`, owner, { role, scopeId });
  if (r.status !== 201) throw new Error(`assign ${key}: ${r.status} ${JSON.stringify(r.body)}`);
}
async function createTeam(owner: string, name: string, departmentId: string) {
  const r = await api('POST', '/api/admin/teams', owner, { name, departmentId });
  if (r.status !== 201 && r.status !== 200) throw new Error(`team ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  return (await db.query('SELECT id FROM teams WHERE company_id = $1 AND name = $2', [companyA, name])).rows[0].id as string;
}
const activeGrants = async (key: string) => (await db.query(
  'SELECT role, scope_type, scope_id FROM role_assignments WHERE user_id = $1 AND revoked_at IS NULL ORDER BY role, scope_id', [ids[key]])).rows;

/** Count and hash of every row of these companies in every table that carries company_id or team_id. */
let tables: { companyTables: string[]; teamTables: string[] } | null = null;
const NOISE = new Set(['user_activity', 'auth_events', 'server_errors', 'platform_access_log', 'user_sessions', 'users']);
async function fingerprint(where: { ids?: string[]; nonSample?: true }): Promise<Record<string, string>> {
  if (!tables) {
    const base = `FROM information_schema.columns c JOIN information_schema.tables t
                    ON t.table_name = c.table_name AND t.table_schema = c.table_schema AND t.table_type = 'BASE TABLE'
                 WHERE c.table_schema = 'public'`;
    const ct = (await db.query(`SELECT DISTINCT c.table_name AS n ${base} AND c.column_name = 'company_id'`)).rows.map((r) => r.n);
    const tt = (await db.query(`SELECT DISTINCT c.table_name AS n ${base} AND c.column_name = 'team_id'`)).rows.map((r) => r.n).filter((n) => !ct.includes(n));
    tables = { companyTables: ct.filter((n) => !NOISE.has(n)), teamTables: tt };
  }
  const companyCond = where.nonSample ? `company_id NOT LIKE 'demo-%'` : `company_id = ANY($1::text[])`;
  const params = where.nonSample ? [] : [where.ids];
  const out: Record<string, string> = {};
  const one = async (label: string, sql: string) => {
    const r = (await db.query(sql, params)).rows[0];
    out[label] = `${r.n}:${r.h}`;
  };
  for (const n of tables.companyTables) {
    await one(n, `SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM public."${n}" t WHERE t.${companyCond}`);
  }
  for (const n of tables.teamTables) {
    await one(n, `SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM public."${n}" t
                   WHERE t.team_id IN (SELECT id FROM teams WHERE ${companyCond})`);
  }
  await one('developer_productivity_snapshots', `SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h
      FROM developer_productivity_snapshots t WHERE t.developer_id IN (SELECT id FROM users WHERE ${companyCond})`);
  return out;
}
const changedTables = (a: Record<string, string>, b: Record<string, string>) => Object.keys(a).filter((k) => a[k] !== b[k]);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  db = await localDb(); // throws (suite fails) without the local database: no silent skip
  ({ handler } = await import('../../netlify/functions/api'));
  const { buildApp } = await import('./helpers/inProcessApp');
  const teams = (await import('../../server/routes/teams')).default;
  const users = (await import('../../server/routes/users')).default;
  const analytics = (await import('../../server/routes/analytics')).default;
  expressApp = buildApp((app) => {
    app.use('/api/teams', teams);
    app.use('/api/users', users);
    app.use('/api/analytics', analytics);
  });

  // Company A (real): D1 (registration department) with T1, T1b; D2 with T2, T2b.
  const reg = await api('POST', '/api/auth/register', '', {
    email: mail('owner'), password: NEW_PW, firstName: 'Owner', lastName: 'A', companyName: `Sec Authz A ${stamp}`, departmentName: 'D1', teamName: `T1-${stamp}`,
  });
  if (reg.status !== 201 && reg.status !== 200) throw new Error(`register A: ${reg.status} ${JSON.stringify(reg.body)}`);
  const owner = reg.cookie;
  cookies.owner = owner;
  companyA = reg.body.user.company_id;
  ids.owner = reg.body.user.id;
  ids.D1 = reg.body.user.department_id;
  ids.T1 = reg.body.user.primary_team_id;
  const d2 = await api('POST', '/api/admin/departments', owner, { name: 'D2' });
  ids.D2 = d2.body.id;
  ids.T1b = await createTeam(owner, `T1b-${stamp}`, ids.D1);
  ids.T2 = await createTeam(owner, `T2-${stamp}`, ids.D2);
  ids.T2b = await createTeam(owner, `T2b-${stamp}`, ids.D2);

  await createUser(owner, 'm1', 'qa_manager', { departmentId: ids.D1 });
  await createUser(owner, 'm2', 'qa_manager', { departmentId: ids.D2 });
  await createUser(owner, 'l1', 'team_lead', { teamId: ids.T1 });
  await createUser(owner, 'l1b', 'team_lead', { teamId: ids.T1b });
  await createUser(owner, 'l2', 'team_lead', { teamId: ids.T2 });
  await createUser(owner, 'e1', 'qa_engineer', { teamId: ids.T1 });
  await createUser(owner, 'e1del', 'qa_engineer', { teamId: ids.T1 });
  await createUser(owner, 'e1mail', 'qa_engineer', { teamId: ids.T1 });
  await createUser(owner, 'e1b', 'qa_engineer', { teamId: ids.T1b });
  await createUser(owner, 'e2', 'qa_engineer', { teamId: ids.T2 });
  await createUser(owner, 'v1', 'viewer', { teamId: ids.T1 });
  // Mixed scope: engineer of T1 (D1) and viewer of T2 (D2).
  await createUser(owner, 'mixed', 'qa_engineer', { teamId: ids.T1 });
  await addAssignment(owner, 'mixed', 'viewer', ids.T2);
  // Mixed scope with a stale primary on T2 (setPrimaryAssignment would revoke the T2 grant).
  await createUser(owner, 'mixed2', 'qa_engineer', { teamId: ids.T2 });
  await addAssignment(owner, 'mixed2', 'qa_engineer', ids.T1);
  // A self-service e-mail user.
  await createUser(owner, 'self', 'qa_engineer', { teamId: ids.T1 });

  for (const k of ['m1', 'm2', 'l1', 'l2', 'e1', 'self']) {
    const r = await login(mail(k));
    if (r.status !== 200) throw new Error(`login ${k}: ${r.status}`);
    cookies[k] = r.cookie;
  }

  // Company B (real), with rows a generator would change.
  const regB = await api('POST', '/api/auth/register', '', {
    email: mail('ownerb', 'b'), password: NEW_PW, firstName: 'Owner', lastName: 'B', companyName: `Sec Authz B ${stamp}`, departmentName: 'DB', teamName: `TB-${stamp}`,
  });
  if (regB.status !== 201 && regB.status !== 200) throw new Error(`register B: ${regB.status}`);
  companyB = regB.body.user.company_id;
  ids.ownerB = regB.body.user.id;
  ids.TB = regB.body.user.primary_team_id;
  await db.query(
    `INSERT INTO pipeline_stages (company_id, team_id, name, stage_order, avg_duration_seconds, success_rate, cpu_usage, memory_usage, bottleneck_score)
     VALUES ($1, NULL, 'Build', 1, 120, 95, 40, 40, 10), ($1, $2, 'Test', 2, 300, 90, 50, 50, 20)`, [companyB, ids.TB]);
  await db.query(`INSERT INTO developer_productivity_snapshots (developer_id, snapshot_date, focus_time_hours, ddps_score) VALUES ($1, CURRENT_DATE - 1, 5, 0.5)`, [ids.ownerB]);
  await db.query(
    `INSERT INTO pipeline_stages (company_id, team_id, name, stage_order, avg_duration_seconds, success_rate, cpu_usage, memory_usage, bottleneck_score)
     VALUES ($1, NULL, 'Build', 1, 120, 95, 40, 40, 10)`, [companyA]);

  // Sample company S ('demo-' id, as the demo generators create them), with its super admin.
  const hash = await bcrypt.hash(NEW_PW, 10);
  await db.query(`INSERT INTO companies (id, name, domain, is_active) VALUES ($1, $2, $3, true)`, [companyS, `Sec Sample ${stamp}`, `secs${stamp}.test`]);
  const deptS = (await db.query(`INSERT INTO departments (company_id, name) VALUES ($1, 'DS') RETURNING id`, [companyS])).rows[0].id;
  teamS = (await db.query(`INSERT INTO teams (company_id, department_id, name, is_active) VALUES ($1, $2, $3, true) RETURNING id`, [companyS, deptS, `TS-${stamp}`])).rows[0].id;
  const sAdmin = (await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
     VALUES (gen_random_uuid()::text, $1, $2, 'Sample', 'Admin', 'super_admin', $3, $4, $5, true, true) RETURNING id`,
    [mail('sadmin', 's'), hash, companyS, deptS, teamS])).rows[0].id;
  await db.query(`INSERT INTO role_assignments (company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, 'super_admin', 'company', $1)`, [companyS, sAdmin]);
  await db.query(`INSERT INTO role_assignments (company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, 'qa_engineer', 'team', $3)`, [companyS, sAdmin, teamS]);
  const sl = await login(mail('sadmin', 's'));
  if (sl.status !== 200) throw new Error(`login sample admin: ${sl.status} ${JSON.stringify(sl.body)}`);
  cookies.sadmin = sl.cookie;
});

afterAll(async () => {
  if (db) {
    for (const c of [companyA, companyB, companyS].filter(Boolean)) {
      await db.query(`DELETE FROM developer_productivity_snapshots WHERE developer_id IN (SELECT id FROM users WHERE company_id = $1)`, [c]).catch(() => undefined);
      await db.query('DELETE FROM companies WHERE id = $1', [c]).catch(() => undefined);
    }
    await db.query(`DELETE FROM platform_operators WHERE email = $1`, [mail('operator', 'op')]).catch(() => undefined);
    await db.end();
  }
  const { flushBackgroundWrites } = await import('../../server/lib/opsLog');
  await flushBackgroundWrites(500);
  const { pool } = await import('../../src/lib/db');
  await pool.end();
});

// ---- account takeover ----------------------------------------------------------------------

describe.each([['Netlify function', () => viaNetlify], ['Express app', () => viaExpress]])('Exploit chain (%s)', (_label, transport) => {
  test('AUTHZ-001 manager of D1 cannot take over the D2 team lead through a manufactured overlap', async () => {
    const t = transport();
    const before = await activeGrants('l2');
    const add = await t('POST', `/api/admin/users/${ids.l2}/assignments`, cookies.m1, { role: 'viewer', scopeId: ids.T1 });
    expect(add.status).toBe(403);
    expect(await activeGrants('l2')).toEqual(before); // no viewer seat on T1
    const reset = await t('POST', `/api/admin/users/${ids.l2}/reset-password`, cookies.m1, { newPassword: 'Takeover!2024x' });
    expect(reset.status).toBe(403);
    const assignmentRow = (await db.query(`SELECT id FROM role_assignments WHERE user_id = $1 AND scope_id = $2 AND revoked_at IS NULL`, [ids.l2, ids.T1])).rows[0];
    expect(assignmentRow).toBeUndefined(); // nothing for the attacker to DELETE afterwards
    expect((await login(mail('l2'), 'Takeover!2024x', t)).status).toBe(401);
    expect((await login(mail('l2'), NEW_PW, t)).status).toBe(200);
  });

  test('AUTHZ-002 team lead of T1 cannot take over an engineer of T2', async () => {
    const t = transport();
    const before = await activeGrants('e2');
    const add = await t('POST', `/api/admin/users/${ids.e2}/assignments`, cookies.l1, { role: 'viewer', scopeId: ids.T1 });
    expect(add.status).toBe(403);
    expect(await activeGrants('e2')).toEqual(before);
    expect((await t('POST', `/api/admin/users/${ids.e2}/reset-password`, cookies.l1, { newPassword: 'Takeover!2024y' })).status).toBe(403);
    expect((await login(mail('e2'), 'Takeover!2024y', t)).status).toBe(401);
  });

  test('AUTHZ-003a account-wide actions on a mixed-scope user are refused (manager and lead)', async () => {
    const t = transport();
    for (const actor of ['m1', 'l1']) {
      expect((await t('POST', `/api/admin/users/${ids.mixed}/reset-password`, cookies[actor], { newPassword: 'Takeover!2024z' })).status).toBe(403);
      expect((await t('POST', `/api/admin/users/${ids.mixed}/sign-out-everywhere`, cookies[actor])).status).toBe(403);
    }
    expect((await login(mail('mixed'), 'Takeover!2024z', t)).status).toBe(401);
  });
});

describe('Account-wide actions', () => {
  const actions = (id: string) => [
    ['reset password', 'POST', `/api/admin/users/${id}/reset-password`, { newPassword: 'Takeover!2024q' }],
    ['send reset link', 'POST', `/api/admin/users/${id}/send-reset-link`, undefined],
    ['sign out everywhere', 'POST', `/api/admin/users/${id}/sign-out-everywhere`, undefined],
    ['activate / deactivate', 'POST', `/api/admin/users/${id}/toggle-status`, undefined],
    ['developer insights', 'PATCH', `/api/admin/users/${id}/developer-insights-toggle`, { enabled: true }],
    ['edit profile', 'PUT', `/api/admin/users/${id}`, { firstName: 'Pwned' }],
    ['change e-mail', 'PUT', `/api/admin/users/${id}`, { email: mail(`pwn-${id.slice(0, 6)}`, 'x') }],
    ['delete', 'DELETE', `/api/admin/users/${id}`, undefined],
  ] as const;

  test.each([
    ['m1', 'l2', 'manager → lead of another department'],
    ['m1', 'mixed', 'manager → engineer of D1 who is also viewer in D2'],
    ['m1', 'mixed2', 'manager → engineer of D1 and D2'],
    ['m1', 'e2', 'manager → engineer of another department'],
    ['l1', 'mixed', 'lead → engineer of T1 who is also viewer of T2'],
    ['l1', 'e1b', 'lead → engineer of another team of the same department'],
    ['l1', 'e2', 'lead → engineer of another department'],
    ['m2', 'mixed', 'manager of D2 → viewer of T2 who is also engineer in D1'],
  ])('AUTHZ-003 %s on %s is refused (%s)', async (actor, target) => {
    const snap = async () => (await db.query(
      `SELECT email, first_name, password_hash, is_active, developer_insights_enabled, sessions_valid_after FROM users WHERE id = $1`, [ids[target]])).rows[0];
    const before = await snap();
    for (const [name, method, path, body] of actions(ids[target])) {
      const r = await api(method, path, cookies[actor], body as any);
      if (r.status !== 403) throw new Error(`${actor} → ${target}: ${name} answered ${r.status} ${JSON.stringify(r.body)}`);
    }
    expect(await snap()).toEqual(before);
  });

  test('AUTHZ-004 in-scope management still works', async () => {
    // Manager of D1 → engineer of T1 (entirely in D1).
    expect((await api('POST', `/api/admin/users/${ids.e1}/reset-password`, cookies.m1, { newPassword: 'Inscope!2024a' })).status).toBe(200);
    expect((await login(mail('e1'), 'Inscope!2024a')).status).toBe(200);
    expect((await api('POST', `/api/admin/users/${ids.e1}/send-reset-link`, cookies.m1)).status).toBe(200);
    expect((await api('POST', `/api/admin/users/${ids.e1}/sign-out-everywhere`, cookies.m1)).status).toBe(200);
    expect((await api('PATCH', `/api/admin/users/${ids.e1}/developer-insights-toggle`, cookies.m1, { enabled: true })).status).toBe(200);
    expect((await api('POST', `/api/admin/users/${ids.e1}/toggle-status`, cookies.m1)).status).toBe(200);
    expect((await api('POST', `/api/admin/users/${ids.e1}/toggle-status`, cookies.m1)).status).toBe(200);
    // The edit form sends the unchanged e-mail with the other fields: accepted.
    expect((await api('PUT', `/api/admin/users/${ids.e1}`, cookies.m1, { firstName: 'Edited', lastName: 'Sec', email: mail('e1') })).status).toBe(200);
    // Primary assignment change within D1 (T1 → T1b).
    const move = await api('PUT', `/api/admin/users/${ids.e1}`, cookies.m1, { role: 'qa_engineer', departmentId: ids.D1, primaryTeamId: ids.T1b });
    expect(move.status).toBe(200);
    expect((await activeGrants('e1')).map((g) => g.scope_id)).toEqual([ids.T1b]);
    // Team lead of T1 → viewer of T1.
    expect((await api('POST', `/api/admin/users/${ids.v1}/reset-password`, cookies.l1, { newPassword: 'Inscope!2024b' })).status).toBe(200);
    expect((await api('POST', `/api/admin/users/${ids.v1}/toggle-status`, cookies.l1)).status).toBe(200);
    expect((await api('POST', `/api/admin/users/${ids.v1}/toggle-status`, cookies.l1)).status).toBe(200);
    // Delete (= deactivate) by the manager.
    const del = await api('DELETE', `/api/admin/users/${ids.e1del}`, cookies.m1);
    expect(del.status).toBe(200);
    expect((await db.query('SELECT is_active FROM users WHERE id = $1', [ids.e1del])).rows[0].is_active).toBe(false);
    // Super admin: anyone, also mixed scopes.
    expect((await api('POST', `/api/admin/users/${ids.mixed}/reset-password`, cookies.owner, { newPassword: 'Owner!2024c' })).status).toBe(200);
  });

  test('AUTHZ-005 adding assignments: only to people already entirely in scope; super admins across scopes', async () => {
    // In scope: the manager of D1 adds "viewer of T1" (D1) to an engineer of T1b (D1).
    expect((await api('POST', `/api/admin/users/${ids.e1b}/assignments`, cookies.m1, { role: 'viewer', scopeId: ids.T1 })).status).toBe(201);
    // Now e1b is on T1b and T1 (both D1): still entirely the manager's.
    expect((await api('POST', `/api/admin/users/${ids.e1b}/reset-password`, cookies.m1, { newPassword: 'Inscope!2024d' })).status).toBe(200);
    // Cross-scope: the D2 manager may not pull e1b (D1) into D2, nor the lead of T1 pull an engineer of T1b.
    expect((await api('POST', `/api/admin/users/${ids.e1b}/assignments`, cookies.m2, { role: 'viewer', scopeId: ids.T2 })).status).toBe(403);
    expect((await api('POST', `/api/admin/users/${ids.mixed}/assignments`, cookies.m1, { role: 'viewer', scopeId: ids.T1b })).status).toBe(403);
    // Super admin: allowed across departments.
    const sa = await api('POST', `/api/admin/users/${ids.l2}/assignments`, cookies.owner, { role: 'viewer', scopeId: ids.T1 });
    expect(sa.status).toBe(201);
    const row = (await db.query(`SELECT id FROM role_assignments WHERE user_id = $1 AND scope_id = $2 AND revoked_at IS NULL`, [ids.l2, ids.T1])).rows[0];
    // ... after which the manager of D1 still cannot reset the lead (mixed scope now) ...
    expect((await api('POST', `/api/admin/users/${ids.l2}/reset-password`, cookies.m1, { newPassword: 'Takeover!2024w' })).status).toBe(403);
    expect((await api('DELETE', `/api/admin/users/${ids.l2}/assignments/${row.id}`, cookies.owner)).status).toBe(200);
  });

  test('AUTHZ-006 a primary-assignment change may not revoke a grant in another department', async () => {
    const before = await activeGrants('mixed2');
    const r = await api('PUT', `/api/admin/users/${ids.mixed2}`, cookies.m1, { role: 'qa_engineer', departmentId: ids.D1, primaryTeamId: ids.T1 });
    expect(r.status).toBe(403);
    expect(await activeGrants('mixed2')).toEqual(before);
    expect(before.some((g) => g.scope_id === ids.T2)).toBe(true);

    // The library itself: without the revoke right nothing is written.
    const { setPrimaryAssignment, execOn, AssignmentError } = await import('../../server/lib/assignments');
    const { canGrant } = await import('../../server/lib/userPolicy');
    const m1Actor = { id: ids.m1, role: 'qa_manager', grants: [{ role: 'qa_manager', scopeType: 'department', scopeId: ids.D1 }] };
    const teamDept: Record<string, string> = { [ids.T1]: ids.D1, [ids.T2]: ids.D2 };
    let err: any = null;
    try {
      // (cast: the test also compiles against the code before the fix, where mayRevoke did not exist)
      await (setPrimaryAssignment as any)(execOn(), {
        companyId: companyA, userId: ids.mixed2, actorId: ids.m1,
        from: { role: 'qa_engineer', departmentId: ids.D2, teamId: ids.T2 },
        to: { role: 'qa_engineer', departmentId: ids.D1, teamId: ids.T1 },
        mayRevoke: (g: any) => canGrant(m1Actor, g, g.scopeType === 'team' ? { id: g.scopeId, department_id: teamDept[g.scopeId] } : null),
      });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AssignmentError);
    expect(err.status).toBe(403);
    expect(await activeGrants('mixed2')).toEqual(before);
  });

  test('AUTHZ-007 PUT /api/teams/:id: a team lead cannot rename or deactivate their team; the manager can', async () => {
    const name = async () => (await db.query('SELECT name, is_active FROM teams WHERE id = $1', [ids.T1])).rows[0];
    const before = await name();
    expect((await api('PUT', `/api/teams/${ids.T1}`, cookies.l1, { name: 'Renamed by lead' })).status).toBe(403);
    expect((await api('PUT', `/api/teams/${ids.T1}`, cookies.l1, { isActive: false })).status).toBe(403);
    expect(await name()).toEqual(before);
    // Other team data stays the lead's (description).
    expect((await api('PUT', `/api/teams/${ids.T1}`, cookies.l1, { description: 'Lead notes' })).status).toBe(200);
    // Sending the unchanged name is not a rename.
    expect((await api('PUT', `/api/teams/${ids.T1}`, cookies.l1, { name: before.name, description: 'Lead notes 2' })).status).toBe(200);
    // Manager of D1: allowed; manager of D2: not their team.
    expect((await api('PUT', `/api/teams/${ids.T1}`, cookies.m2, { name: 'Renamed by D2' })).status).toBe(403);
    const ok = await api('PUT', `/api/teams/${ids.T1}`, cookies.m1, { name: `${before.name}-m` });
    expect(ok.status).toBe(200);
    expect((await name()).name).toBe(`${before.name}-m`);
    expect((await api('PUT', `/api/teams/${ids.T1}`, cookies.m1, { name: before.name })).status).toBe(200);
  });

  test('AUTHZ-008 configs: department and team levels only within the reader\'s scope', async () => {
    expect((await api('POST', '/api/admin/configs', cookies.owner, { departmentId: ids.D2, configs: { sla_critical_hours: '9' } })).status).toBe(200);
    expect((await api('POST', '/api/admin/configs', cookies.owner, { departmentId: ids.D2, teamId: ids.T2, configs: { sla_critical_hours: '8' } })).status).toBe(200);
    for (const path of ['/api/admin/configs', '/api/admin/configs/raw']) {
      const d2 = await api('GET', `${path}?departmentId=${ids.D2}`, cookies.m1);
      expect(d2.status).toBe(403);
      expect(JSON.stringify(d2.body)).not.toContain('"9"');
      expect((await api('GET', `${path}?teamId=${ids.T2}`, cookies.m1)).status).toBe(403);
      expect((await api('GET', `${path}?departmentId=${ids.D1}`, cookies.m1)).status).toBe(200);
      expect((await api('GET', `${path}?teamId=${ids.T1}`, cookies.m1)).status).toBe(200);
      expect((await api('GET', path, cookies.m1)).status).toBe(200); // company level
      expect((await api('GET', `${path}?departmentId=${ids.D2}`, cookies.m2)).status).toBe(200);
      expect((await api('GET', `${path}?departmentId=${ids.D2}`, cookies.owner)).status).toBe(200);
    }
    const raw = await api('GET', `/api/admin/configs/raw?departmentId=${ids.D2}`, cookies.owner);
    expect(raw.body.configs.sla_critical_hours).toBe('9');
    // Team lead: their team only (merged view).
    expect((await api('GET', `/api/admin/configs?teamId=${ids.T1}`, cookies.l1)).status).toBe(200);
    expect((await api('GET', `/api/admin/configs?teamId=${ids.T2}`, cookies.l1)).status).toBe(403);
    expect((await api('GET', `/api/admin/configs?departmentId=${ids.D2}`, cookies.l1)).status).toBe(403);
  });

  test('AUTHZ-009a e-mail: only a super admin changes another person\'s address, validated, and that ends their sessions', async () => {
    const target = ids.e1mail;
    const victimSession = (await login(mail('e1mail'))).cookie;
    // Manager of D1 (target entirely in scope) and team lead of T1: refused.
    expect((await api('PUT', `/api/admin/users/${target}`, cookies.m1, { email: mail('takeover-m', 'x') })).status).toBe(403);
    expect((await api('PUT', `/api/admin/users/${target}`, cookies.l1, { email: mail('takeover-l', 'x') })).status).toBe(403);
    expect((await db.query('SELECT email FROM users WHERE id = $1', [target])).rows[0].email.toLowerCase()).toBe(mail('e1mail').toLowerCase());
    // Super admin: validated.
    expect((await api('PUT', `/api/admin/users/${target}`, cookies.owner, { email: 'not-an-address' })).status).toBe(400);
    await db.query(`INSERT INTO platform_operators (email, name, password_hash) VALUES ($1, 'Op', 'x') ON CONFLICT DO NOTHING`, [mail('operator', 'op')]);
    expect((await api('PUT', `/api/admin/users/${target}`, cookies.owner, { email: mail('operator', 'op') })).status).toBe(409);
    expect((await api('PUT', `/api/admin/users/${target}`, cookies.owner, { email: mail('l2') })).status).toBe(400); // taken
    const ok = await api('PUT', `/api/admin/users/${target}`, cookies.owner, { email: mail('e1mail-new') });
    expect(ok.status).toBe(200);
    expect((await api('GET', '/api/auth/me', victimSession)).status).toBe(401); // their sessions ended
    expect((await login(mail('e1mail-new'))).status).toBe(200);
  });

  test('AUTHZ-009b self-service e-mail change: validated; other sessions end, this one continues', async () => {
    const other = (await login(mail('self'))).cookie;
    const me = cookies.self;
    expect((await api('PUT', `/api/users/${ids.self}`, me, { email: 'not-an-address' })).status).toBe(400);
    expect((await api('PUT', `/api/users/${ids.self}`, me, { email: mail('operator', 'op') })).status).toBe(409);
    expect((await api('PUT', `/api/users/${ids.self}`, me, { email: mail('l2') })).status).toBe(400);
    expect((await api('GET', '/api/auth/me', other)).status).toBe(200); // nothing changed yet
    const ok = await api('PUT', `/api/users/${ids.self}`, me, { email: mail('self-new') });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe(mail('self-new').toLowerCase());
    expect(ok.cookie).toMatch(/^irongate_token=/);
    expect((await api('GET', '/api/auth/me', other)).status).toBe(401);
    expect((await api('GET', '/api/auth/me', ok.cookie)).status).toBe(200);
    // Own row on the Users page (admin route): the same rules.
    expect((await api('PUT', `/api/admin/users/${ids.self}`, ok.cookie, { email: 'nope' })).status).toBe(400);
    // Someone else's address through the self route: never.
    expect((await api('PUT', `/api/users/${ids.e2}`, ok.cookie, { email: mail('x-e2', 'x') })).status).toBe(403);
  });
});

// ---- synthetic data never crosses into a real company -----------------------------------------

describe('Synthetic data: sample companies only, never another company', () => {
  test('SYNTH-001 update-daily: a real company is refused and nothing changes anywhere; a sample company changes only itself', async () => {
    const b0 = await fingerprint({ ids: [companyB] });
    const a0 = await fingerprint({ ids: [companyA] });
    const r = await api('POST', '/api/analytics/update-daily', cookies.owner);
    expect(r.status).toBe(403);
    // Give a (wrongly) started background run time to write.
    for (let i = 0; i < 10 && !changedTables(b0, await fingerprint({ ids: [companyB] })).length; i++) await wait(1000);
    expect(changedTables(b0, await fingerprint({ ids: [companyB] }))).toEqual([]);
    expect(changedTables(a0, await fingerprint({ ids: [companyA] }))).toEqual([]);

    // Sample company: allowed, writes its own rows only.
    const s0 = await fingerprint({ ids: [companyS] });
    const rs = await api('POST', '/api/analytics/update-daily', cookies.sadmin);
    expect(rs.status).toBe(200);
    for (let i = 0; i < 20 && !changedTables(s0, await fingerprint({ ids: [companyS] })).length; i++) await wait(500);
    expect(changedTables(s0, await fingerprint({ ids: [companyS] })).length).toBeGreaterThan(0);
    await wait(1500); // the background run finishes
    expect(changedTables(b0, await fingerprint({ ids: [companyB] }))).toEqual([]);
    expect(changedTables(a0, await fingerprint({ ids: [companyA] }))).toEqual([]);
  });

  test('SYNTH-002 seed-data: refused in a real company, nothing written', async () => {
    const a0 = await fingerprint({ ids: [companyA] });
    const b0 = await fingerprint({ ids: [companyB] });
    const r = await api('POST', '/api/analytics/seed-data', cookies.owner);
    expect(r.status).toBe(403);
    expect(changedTables(a0, await fingerprint({ ids: [companyA] }))).toEqual([]);
    expect(changedTables(b0, await fingerprint({ ids: [companyB] }))).toEqual([]);
    const st = await api('GET', '/api/analytics/seed-data/status', cookies.owner);
    expect(st.status).toBe(200);
    expect(st.body.enabled).toBe(false);
  });

  test('SYNTH-003 generate-realistic-data: refused for a real company\'s team, allowed in a sample company', async () => {
    expect((await api('POST', `/api/analytics/business-impact-v2/${ids.T1}/generate-realistic-data`, cookies.owner)).status).toBe(403);
    expect((await api('POST', `/api/analytics/business-impact-v2/${teamS}/generate-realistic-data`, cookies.sadmin)).status).toBe(200);
  });

  test('SYNTH-004 background generators and the snapshot seed never change a real company', async () => {
    // Keep the shared demo company's fixed dataset out of this run (it is a sample company too).
    const demoActive = (await db.query(`SELECT id, is_active FROM companies WHERE id LIKE 'demo-%' AND id <> $1`, [companyS])).rows;
    await db.query(`UPDATE companies SET is_active = false WHERE id LIKE 'demo-%' AND id <> $1`, [companyS]);
    try {
      const real0 = await fingerprint({ nonSample: true });
      const interval = await import('../../server/jobs/intervalSync');
      const analyticsJob = await import('../../server/jobs/analyticsSync');
      await import('../../server/jobs/syncMetrics');
      await interval.runPipelineSeederForAllCompanies();
      await interval.runIntervalSync();
      await analyticsJob.seedAllAnalyticsData();
      for (const s of scheduled) await s.fn(); // every captured schedule (the 15-minute mock KPI job included)
      // A real company id handed to a writer directly is refused.
      await expect((analyticsJob.updateDailyAnalytics as any)(companyB)).rejects.toThrow(/not a sample company/);
      await expect(analyticsJob.seedPipelineStages(companyB)).rejects.toThrow(/not a sample company/);
      const { seedPipelineStages } = await import('../../server/seeders/pipelineSeeder');
      await expect(seedPipelineStages(companyB)).rejects.toThrow(/not a sample company/);
      // The snapshot seed CLI (deleted every company's snapshots before).
      await new Promise<void>((resolve, reject) => execFile('npx', ['tsx', 'server/seeds/seedProductivitySnapshots.ts'], {
        cwd: `${__dirname}/../..`, env: { ...process.env, ENABLE_SYNTHETIC_DATA: 'true', NETLIFY: 'true' }, timeout: 90_000,
      }, (e, _o, stderr) => (e ? reject(new Error(`${e.message}\n${stderr}`)) : resolve())));
      expect(changedTables(real0, await fingerprint({ nonSample: true }))).toEqual([]);
    } finally {
      for (const c of demoActive) await db.query('UPDATE companies SET is_active = $2 WHERE id = $1', [c.id, c.is_active]);
    }
  });
});
