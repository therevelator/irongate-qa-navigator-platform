/**
 * Platform operator writes (server/routes/operator.ts): full create / read / update / delete in any
 * company, through the company app's own handlers where the app has them (forward()).
 *
 *   OPC-001 only an operator: no session, a company session, or a company super admin's cookie get
 *           401 on every write route
 *   OPC-002 nothing is logged: no company audit_log entry, no platform_access_log row, no reason asked
 *   OPC-003 companies: create (with a first super admin by password or invitation), edit (name,
 *           domain, hideSampleDataNotice), sign-in lifetime, delete with the typed name
 *   OPC-004 departments and teams: create, edit, move, set lead, archive / restore, delete for good
 *   OPC-005 people: create with a password (also as super admin), edit, role, assignments, reset
 *           password, reset link, deactivate / reactivate, delete with the typed e-mail; the
 *           company app's rules still apply (validation errors pass through)
 *   OPC-006 invitations (create, revoke; the link is never returned), API keys (shown once, then
 *           prefix only; revoke), targets, configs, update intervals, alert rules, saved views
 *   OPC-007 destructive actions need { confirm: true }
 */
import 'dotenv/config';
import request from 'supertest';
import type { Client } from 'pg';
import { buildApp } from './helpers/inProcessApp';
import { NEW_PW, backendUp, cookieFrom, localDb, API_URL } from './helpers/http';
import { upsertOperator } from '../../server/lib/operator';
import { flushBackgroundWrites } from '../../server/lib/opsLog';
import { pool } from '../../src/lib/db';

const app = buildApp();
const stamp = Date.now();
const OP_PW = 'Operator-Crud-Passw0rd!';
const opEmail = `opc-owner-${stamp}@platform${stamp}.test`;
let up = true;
let db: Client;
let token = '';
let companyId = '';
let companyName = '';
let adminCookie = '';
let deptId = '';
let teamId = '';

const op = (method: 'get' | 'post' | 'put' | 'delete', path: string, body?: object) => {
  const r = request(app)[method](`/api/operator${path}`).set('X-Operator-Token', token);
  return body ? r.send(body) : r;
};
const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0].count);

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  await upsertOperator(opEmail, 'Crud Operator', OP_PW);
  const s = await request(app).post('/api/operator/login').send({ email: opEmail, password: OP_PW });
  token = s.body.token;
}, 60_000);

afterAll(async () => {
  if (db) {
    if (companyId) await db.query('DELETE FROM companies WHERE id = $1', [companyId]);
    await db.query('DELETE FROM platform_operators WHERE email = $1', [opEmail]);
  }
  await db?.end();
  await flushBackgroundWrites(2000);
  await pool.end();
});

const skip = () => !up;

describe('Platform operator: changes in any company', () => {
  test('OPC-003 create a company with a first super admin (password), then edit it', async () => {
    if (skip()) return;
    companyName = `OpCrud ${stamp}`;
    const adminEmail = `opc-admin-${stamp}@opcrud${stamp}.test`;
    const res = await op('post', '/companies', {
      name: companyName, departmentName: 'Engineering', teamName: 'Alpha',
      admin: { email: adminEmail, mode: 'password', firstName: 'Ada', lastName: 'Admin', password: NEW_PW },
    });
    expect(res.status).toBe(201);
    companyId = res.body.company.id;
    deptId = res.body.departmentId;
    teamId = res.body.teamId;
    expect(res.body.company).toEqual(expect.objectContaining({ name: companyName, domain: `opcrud${stamp}.test`, status: 'active' }));
    expect(res.body.admin).toEqual(expect.objectContaining({ mode: 'password', status: 201 }));
    // The first super admin can sign in to the company app.
    const login = await request(API_URL).post('/api/auth/login').send({ email: adminEmail, password: NEW_PW });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('super_admin');
    adminCookie = cookieFrom(login);
    // Duplicate name and domain are refused.
    expect((await op('post', '/companies', { name: companyName })).status).toBe(409);
    expect((await op('post', '/companies', { name: `Other ${stamp}`, domain: `opcrud${stamp}.test` })).status).toBe(409);
    expect((await op('post', '/companies', { name: '' })).status).toBe(400);

    const ed = await op('put', `/companies/${companyId}`, { name: `${companyName} Ltd`, hideSampleDataNotice: true });
    expect(ed.status).toBe(200);
    expect(ed.body.company).toEqual(expect.objectContaining({ name: `${companyName} Ltd`, hideSampleDataNotice: true }));
    companyName = `${companyName} Ltd`;
    expect((await op('put', `/companies/${companyId}`, { hideSampleDataNotice: 'yes' })).status).toBe(400);
    expect((await op('put', `/companies/${companyId}`, { domain: 'not a domain' })).status).toBe(400);
    // The company app sees it (the /me answer carries the setting).
    expect((await request(API_URL).get('/api/auth/me').set('Cookie', adminCookie)).body.user.hide_sample_notice).toBe(true);

    // Sign-in lifetime: the company app's own endpoint and rules.
    expect((await op('put', `/companies/${companyId}/session-settings`, { lifetimeHours: 24 })).body).toEqual(expect.objectContaining({ lifetimeHours: 24 }));
    expect((await op('put', `/companies/${companyId}/session-settings`, { lifetimeHours: 5 })).status).toBe(400);
    expect((await op('get', `/companies/${companyId}/summary`)).body.company.sessionLifetimeHours).toBe(24);
  });

  test('OPC-003b create with an invitation for the first super admin (link never returned)', async () => {
    if (skip()) return;
    const res = await op('post', '/companies', { name: `OpCrud Invite ${stamp}`, domain: `opcinv${stamp}.test`, admin: { email: `boss-${stamp}@opcinv${stamp}.test`, mode: 'invite' } });
    expect(res.status).toBe(201);
    expect(res.body.admin).toEqual(expect.objectContaining({ mode: 'invite', status: 201 }));
    expect(JSON.stringify(res.body)).not.toMatch(/igi_|accept-invite|"link"|"token"/);
    const inv = await db.query(`SELECT role, scope_type FROM invitations WHERE company_id = $1`, [res.body.company.id]);
    expect(inv.rows).toEqual([{ role: 'super_admin', scope_type: 'company' }]);
    await db.query('DELETE FROM companies WHERE id = $1', [res.body.company.id]);
  });

  test('OPC-001 every write needs an operator session (company accounts get 401)', async () => {
    if (skip()) return;
    const routes: Array<['post' | 'put' | 'delete', string]> = [
      ['post', '/companies'], ['put', `/companies/${companyId}`], ['post', `/companies/${companyId}/suspend`], ['delete', `/companies/${companyId}`],
      ['post', `/companies/${companyId}/departments`], ['post', `/companies/${companyId}/teams`], ['delete', `/companies/${companyId}/teams/${teamId}`],
      ['post', `/companies/${companyId}/users`], ['post', `/companies/${companyId}/invitations`], ['post', `/companies/${companyId}/api-keys`],
      ['put', `/companies/${companyId}/targets`], ['post', `/companies/${companyId}/configs`], ['put', `/companies/${companyId}/alert-rules`],
      ['post', `/companies/${companyId}/sessions/x/revoke`],
    ];
    for (const [m, p] of routes) {
      expect({ p, none: (await request(app)[m](`/api/operator${p}`).send({ confirm: true })).status }).toEqual({ p, none: 401 });
      expect({ p, company: (await request(app)[m](`/api/operator${p}`).set('Cookie', adminCookie).send({ confirm: true })).status }).toEqual({ p, company: 401 });
    }
    // The internal "platform support" request flag cannot be set by a client: a company route
    // with no session is still refused.
    expect((await request(app).get('/api/admin/users').set('X-Platform-Support', 'true')).status).toBe(401);
  });

  test('OPC-004 departments and teams', async () => {
    if (skip()) return;
    const base = `/companies/${companyId}`;
    const d = await op('post', `${base}/departments`, { name: 'Quality' });
    expect(d.status).toBe(201);
    expect((await op('post', `${base}/departments`, { name: 'Quality' })).status).toBe(400); // the company app's duplicate rule
    expect((await op('put', `${base}/departments/${d.body.id}`, { name: 'Quality Engineering' })).body.name).toBe('Quality Engineering');
    const t = await op('post', `${base}/teams`, { name: 'Beta', departmentId: deptId });
    expect(t.status).toBe(201);
    expect((await op('post', `${base}/teams`, { name: 'Beta', departmentId: deptId })).status).toBe(409);
    expect((await op('put', `${base}/teams/${t.body.id}`, { name: 'Beta 2', description: 'x' })).body.name).toBe('Beta 2');
    const mv = await op('put', `${base}/teams/${t.body.id}/department`, { departmentId: d.body.id });
    expect(mv.status).toBe(200);
    expect((await db.query('SELECT department_id FROM teams WHERE id = $1', [t.body.id])).rows[0].department_id).toBe(d.body.id);
    // Archive (destructive: confirm) and restore.
    expect((await op('post', `${base}/teams/${t.body.id}/archive`, {})).status).toBe(400);
    expect((await op('post', `${base}/teams/${t.body.id}/archive`, { confirm: true })).status).toBe(200);
    expect((await db.query('SELECT is_active FROM teams WHERE id = $1', [t.body.id])).rows[0].is_active).toBe(false);
    expect((await op('post', `${base}/teams/${t.body.id}/archive`, { confirm: true })).status).toBe(409);
    expect((await op('post', `${base}/teams/${t.body.id}/restore`, {})).status).toBe(200);
    // Team lead (the company app's rule set).
    const lead = await op('post', `${base}/users`, { email: `opc-lead-${stamp}@opcrud${stamp}.test`, password: NEW_PW, firstName: 'Lea', lastName: 'D', role: 'qa_engineer', teamId: t.body.id });
    expect(lead.status).toBe(201);
    expect((await op('put', `${base}/teams/${t.body.id}/lead`, { userId: lead.body.id })).status).toBe(200);
    // Department delete: the company app refuses while it has active teams.
    expect((await op('delete', `${base}/departments/${d.body.id}`, { confirm: true })).status).toBe(400);
    // Delete for good: the typed name is required; the members keep their accounts.
    expect((await op('delete', `${base}/teams/${t.body.id}`, { confirm: true, confirmName: 'wrong' })).status).toBe(400);
    expect((await op('delete', `${base}/teams/${t.body.id}`, { confirmName: 'Beta 2' })).status).toBe(400);
    expect((await op('delete', `${base}/teams/${t.body.id}`, { confirm: true, confirmName: 'Beta 2' })).status).toBe(200);
    expect((await db.query('SELECT 1 FROM teams WHERE id = $1', [t.body.id])).rows).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM users WHERE id = $1', [lead.body.id])).rows).toHaveLength(1);
    expect(await count(`SELECT COUNT(*) FROM role_assignments WHERE scope_id = $1 AND revoked_at IS NULL`, [t.body.id])).toBe(0);
    // Its people moved with the team: the company app still refuses to delete it.
    expect((await op('delete', `${base}/departments/${d.body.id}`, { confirm: true })).body.error).toMatch(/active users/);
  });

  test('OPC-005 people: create, edit, assignments, password, deactivate, delete', async () => {
    if (skip()) return;
    const base = `/companies/${companyId}`;
    const email = `opc-person-${stamp}@opcrud${stamp}.test`;
    expect((await op('post', `${base}/users`, { email, password: 'short', firstName: 'P', lastName: 'Q', role: 'viewer', teamId })).status).toBe(400); // the app's rule
    const u = await op('post', `${base}/users`, { email, password: NEW_PW, firstName: 'Per', lastName: 'Son', role: 'viewer', teamId });
    expect(u.status).toBe(201);
    const sa = await op('post', `${base}/users`, { email: `opc-sa-${stamp}@opcrud${stamp}.test`, password: NEW_PW, firstName: 'Su', lastName: 'Per', role: 'super_admin', teamId });
    expect(sa.status).toBe(201);
    expect((await db.query('SELECT role FROM users WHERE id = $1', [sa.body.id])).rows[0].role).toBe('super_admin');
    const ed = await op('put', `${base}/users/${u.body.id}`, { firstName: 'Pers', role: 'qa_engineer', departmentId: deptId, primaryTeamId: teamId });
    expect(ed.status).toBe(200);
    expect(ed.body).toEqual(expect.objectContaining({ first_name: 'Pers', role: 'qa_engineer' }));
    // Assignments: add a manager of the department, remove it again.
    const add = await op('post', `${base}/users/${u.body.id}/assignments`, { role: 'qa_manager', scopeId: deptId });
    expect(add.status).toBe(201);
    const mgr = add.body.assignments.find((a: any) => a.role === 'qa_manager');
    expect((await op('delete', `${base}/users/${u.body.id}/assignments/${mgr.id}`, {})).status).toBe(400);
    expect((await op('delete', `${base}/users/${u.body.id}/assignments/${mgr.id}`, { confirm: true })).status).toBe(200);
    // Password set by the operator: the old sessions end, the new password works.
    const before = await request(API_URL).post('/api/auth/login').send({ email, password: NEW_PW });
    const oldCookie = cookieFrom(before);
    expect((await op('post', `${base}/users/${u.body.id}/reset-password`, { newPassword: 'Brand-New-Passw0rd', confirm: true })).status).toBe(200);
    expect((await request(API_URL).get('/api/auth/me').set('Cookie', oldCookie)).status).toBe(401);
    expect((await request(API_URL).post('/api/auth/login').send({ email, password: 'Brand-New-Passw0rd' })).status).toBe(200);
    const link = await op('post', `${base}/users/${u.body.id}/send-reset-link`, {});
    expect(link.status).toBe(200);
    expect(JSON.stringify(link.body)).not.toMatch(/token=|reset-password\?|"link"/);
    // Delete for good with the typed e-mail. The last super admin cannot be deleted.
    expect((await op('delete', `${base}/users/${u.body.id}`, { confirm: true, confirmEmail: 'x@y.z' })).status).toBe(400);
    expect((await op('delete', `${base}/users/${u.body.id}`, { confirm: true, confirmEmail: email.toUpperCase() })).status).toBe(200);
    expect((await db.query('SELECT 1 FROM users WHERE id = $1', [u.body.id])).rows).toHaveLength(0);
    const admins = (await db.query(`SELECT u.id, u.email FROM users u JOIN role_assignments ra ON ra.user_id = u.id AND ra.role = 'super_admin' AND ra.revoked_at IS NULL WHERE u.company_id = $1`, [companyId])).rows;
    expect(admins.length).toBe(2);
    expect((await op('delete', `${base}/users/${admins[0].id}`, { confirm: true, confirmEmail: admins[0].email })).status).toBe(200);
    const last = await op('delete', `${base}/users/${admins[1].id}`, { confirm: true, confirmEmail: admins[1].email });
    expect(last.status).toBe(400);
    expect(last.body.error).toMatch(/super admin/i);
    expect((await db.query('SELECT 1 FROM users WHERE id = $1', [admins[1].id])).rows).toHaveLength(1);
    // A user of another company through this company: 404.
    const foreign = (await db.query('SELECT id FROM users WHERE company_id <> $1 LIMIT 1', [companyId])).rows[0].id;
    expect((await op('put', `${base}/users/${foreign}`, { firstName: 'X' })).status).toBe(404);
    expect((await op('delete', `${base}/users/${foreign}`, { confirm: true, confirmEmail: 'x' })).status).toBe(404);
  });

  test('OPC-006 invitations, API keys, targets, configs, intervals, alert rules, saved views', async () => {
    if (skip()) return;
    const base = `/companies/${companyId}`;
    const inv = await op('post', `${base}/invitations`, { email: `opc-inv-${stamp}@opcrud${stamp}.test`, role: 'qa_engineer', scopeId: teamId });
    expect(inv.status).toBe(201);
    expect(inv.body.link).toBeUndefined();
    expect(JSON.stringify(inv.body)).not.toMatch(/igi_/);
    expect((await op('post', `${base}/invitations/${inv.body.invitation.id}/revoke`, { confirm: true })).body.invitation.status).toBe('revoked');

    const key = await op('post', `${base}/api-keys`, { name: 'Ops key' });
    expect(key.status).toBe(201);
    expect(key.body.plaintextKey).toMatch(/^igk_/);
    const users = await op('get', `${base}/users`);
    expect(JSON.stringify(users.body)).not.toContain(key.body.plaintextKey);
    expect(users.body.apiKeys[0].key_prefix).toBe(key.body.key.keyPrefix);
    expect((await op('post', `${base}/api-keys/${key.body.key.id}/revoke`, { confirm: true })).status).toBe(200);

    const tg = await op('put', `${base}/targets`, { scopeType: 'company', scopeId: companyId, targets: { test_coverage: { good: 85, warning: 70 } } });
    expect(tg.status).toBe(200);
    expect((await op('put', `${base}/targets`, { scopeType: 'company', scopeId: companyId, targets: { test_coverage: { good: 50, warning: 90 } } })).status).toBe(400);
    const tr = await op('get', `${base}/app/targets?scopeType=company`);
    expect(tr.body.metrics.find((m: any) => m.metric === 'test_coverage').own).toEqual(expect.objectContaining({ good: 85, warning: 70 }));

    expect((await op('post', `${base}/configs`, { configs: { sla_response_time_ms: '450' } })).status).toBe(200);
    expect((await db.query(`SELECT config_value FROM configs WHERE company_id = $1 AND config_key = 'sla_response_time_ms' AND team_id IS NULL AND department_id IS NULL`, [companyId])).rows[0].config_value).toBe('450');
    expect((await op('post', `${base}/configs`, { configs: { session_lifetime_hours: '1' } })).status).toBe(400);

    const iv = await op('get', `${base}/app/metric-intervals`);
    const key0 = iv.body.intervals[0].metric_key;
    expect((await op('put', `${base}/metric-intervals/${key0}`, { interval_value: 3, interval_unit: 'days' })).status).toBe(200);
    expect((await op('put', `${base}/metric-intervals/${key0}`, { interval_value: 0, interval_unit: 'days' })).status).toBe(400);
    expect((await op('delete', `${base}/metric-intervals/${key0}`, { confirm: true })).status).toBe(200);

    const rules = await op('get', `${base}/app/alert-rules?scopeType=company`);
    expect(rules.status).toBe(200);
    const r0 = rules.body.rules[0];
    expect((await op('put', `${base}/alert-rules`, { scopeType: 'company', scopeId: companyId, rules: { [r0.rule]: { enabled: !r0.effective.enabled, params: r0.effective.params } } })).status).toBe(200);
    expect((await db.query('SELECT enabled FROM alert_rules WHERE company_id = $1 AND rule = $2', [companyId, r0.rule])).rows[0].enabled).toBe(!r0.effective.enabled);

    const owner = (await db.query(`SELECT id FROM users WHERE company_id = $1 AND is_active LIMIT 1`, [companyId])).rows[0].id;
    const view = (await db.query(`INSERT INTO saved_views (company_id, owner_id, kind, name, state) VALUES ($1, $2, 'dashboard', 'Ops view', '{}'::jsonb) RETURNING id`, [companyId, owner])).rows[0].id;
    expect((await op('put', `${base}/saved-views/${view}`, { name: 'Renamed view', shared: true })).body.view).toEqual(expect.objectContaining({ name: 'Renamed view', shared: true }));
    expect((await op('put', `${base}/saved-views/${view}`, { name: '' })).status).toBe(400);
    expect((await op('delete', `${base}/saved-views/${view}`, {})).status).toBe(400);
    expect((await op('delete', `${base}/saved-views/${view}`, { confirm: true })).status).toBe(200);
  });

  test('OPC-002 none of the above is in the company history or any access log', async () => {
    if (skip()) return;
    expect(await count('SELECT COUNT(*) FROM audit_log WHERE company_id = $1', [companyId])).toBe(0);
    expect(await count(`SELECT COUNT(*) FROM platform_access_log WHERE created_at > now() - interval '10 minutes'`)).toBe(0);
  });

  test('OPC-007 delete the company: confirm and the exact name', async () => {
    if (skip()) return;
    expect((await op('delete', `/companies/${companyId}`, { confirmName: companyName })).status).toBe(400);
    expect((await op('delete', `/companies/${companyId}`, { confirm: true, confirmName: companyName.toLowerCase() })).status).toBe(400);
    expect((await op('delete', `/companies/${companyId}`, { confirm: true, confirmName: companyName })).status).toBe(200);
    expect(await count('SELECT COUNT(*) FROM companies WHERE id = $1', [companyId])).toBe(0);
    expect(await count('SELECT COUNT(*) FROM users WHERE company_id = $1', [companyId])).toBe(0);
    expect((await op('get', `/companies/${companyId}/summary`)).status).toBe(404);
    companyId = '';
  });
});
