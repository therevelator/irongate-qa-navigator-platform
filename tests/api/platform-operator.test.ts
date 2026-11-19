/**
 * Platform operator panel (server/routes/operator.ts, server/lib/operator.ts), against an
 * in-process copy of the API (tests/api/helpers/inProcessApp.ts) so PLATFORM_OPERATOR_EMAILS can
 * change per test. Same local database as the live API.
 *
 *   OP-001  feature off (env unset or empty): every /api/operator route is 404
 *   OP-002  a super admin whose email is not allowlisted: 404 (status says operator: false)
 *   OP-003  step-up: wrong password refused and logged (no password stored); rate limited
 *   OP-004  a session JWT cannot act as the operator token, the operator token alone (no session)
 *           cannot either, and it is never accepted as a session
 *   OP-005  operator token expiry, Leave (revocation) and the session row expiry
 *   OP-006  allowed IPs (PLATFORM_OPERATOR_ALLOWED_IPS)
 *   OP-007  protected fields never appear in any operator response
 *   OP-008  company views write a customer audit entry, throttled per section (30 minutes),
 *           and the platform access log
 *   OP-009  repair actions: reason + confirm required, each works and is audited
 *   OP-010  overview, error search and pagination limits; invalid company ids
 */
const runRefreshDates = jest.fn();
jest.mock('../../server/seeds/demoSeed', () => ({
  runRefreshDates: (...a: unknown[]) => runRefreshDates(...a),
  teamsWithSampleData: async () => new Map(),
}));

import 'dotenv/config';
import request from 'supertest';
import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import type { Client } from 'pg';
import { buildApp } from './helpers/inProcessApp';
import { NEW_PW, backendUp, cookieFrom, localDb, get as liveGet, post as livePost, put as livePut, API_URL } from './helpers/http';
import { signOperatorToken } from '../../server/lib/operator';
import { JWT_SECRET } from '../../server/middleware/auth';
import { flushActivity } from '../../server/lib/userActivity';
import { flushBackgroundWrites } from '../../server/lib/opsLog';
import { pool } from '../../src/lib/db';

const app = buildApp();
const ENV = ['PLATFORM_OPERATOR_EMAILS', 'PLATFORM_OPERATOR_ALLOWED_IPS'];
const saved: Record<string, string | undefined> = {};
let up = true;
let db: Client;
const stamp = Date.now();
const opEmail = `op-owner-${stamp}@owner${stamp}.test`;
const op2Email = `op-second-${stamp}@second${stamp}.test`;
const custEmail = `op-customer-${stamp}@cust${stamp}.test`;
let opCookie = '';
let op2Cookie = '';
let custCookie = '';
let opUserId = '';
let companyId = '';
let teamId = '';
const markers: Record<string, string> = {};

const call = (method: 'get' | 'post', path: string, cookie = '', token = '', reason = '') => {
  let r = request(app)[method](path).set('Cookie', cookie);
  if (token) r = r.set('X-Operator-Token', token);
  if (reason) r = r.set('X-Operator-Reason', reason);
  return r;
};
async function register(email: string, company: string) {
  const res = await request(API_URL).post('/api/auth/register').send({
    email, password: NEW_PW, firstName: 'Op', lastName: company, companyName: company, departmentName: 'Ops', teamName: `${company} Team`,
  });
  if (res.status >= 300) throw new Error(`register ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return { cookie: cookieFrom(res), user: res.body.user };
}
async function stepUp(cookie: string, password = NEW_PW) {
  return call('post', '/api/operator/session', cookie).send({ password });
}
let token = '';

beforeAll(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  const op = await register(opEmail, `OpHome ${stamp}`);
  opCookie = op.cookie; opUserId = op.user.id;
  op2Cookie = (await register(op2Email, `OpHome2 ${stamp}`)).cookie;
  const cust = await register(custEmail, `OpCustomer ${stamp}`);
  custCookie = cust.cookie;
  companyId = cust.user.company_id ?? cust.user.companyId;
  teamId = (await db.query('SELECT id FROM teams WHERE company_id = $1 LIMIT 1', [companyId])).rows[0].id;
  process.env.PLATFORM_OPERATOR_EMAILS = `${opEmail.toUpperCase()}, ${op2Email}`;

  // ---- protected data of the customer company, each with a marker value
  markers.apiKey = (await livePost('/api/admin/api-keys', custCookie, { name: 'Op test key' })).body.plaintextKey;
  markers.apiKeyHash = createHash('sha256').update(markers.apiKey).digest('hex');
  markers.passwordHash = (await db.query('SELECT password_hash FROM users WHERE LOWER(email) = LOWER($1)', [custEmail])).rows[0].password_hash;
  markers.slack = `SLACKMARK${stamp}`;
  const slack = await livePut('/api/notifications/settings', custCookie, { slackWebhookUrl: `https://hooks.slack.com/services/T0/B0/${markers.slack}xyzw`, slackEnabled: false });
  if (slack.status !== 200) throw new Error(`slack: ${slack.status} ${JSON.stringify(slack.body)}`);
  markers.configSecret = `CFGSECRET${stamp}`;
  await livePost('/api/admin/configs', custCookie, { configs: { jira_api_token: markers.configSecret } });
  markers.pulseToken = randomBytes(32).toString('hex');
  markers.pulseHash = createHash('sha256').update(markers.pulseToken).digest('hex');
  await db.query(
    `INSERT INTO pulse_links (token_hash, company_id, team_id, user_id, period_start, period_end, expires_at)
     VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE + 7, now() + interval '7 days')`,
    [markers.pulseHash, companyId, teamId, cust.user.id],
  );
  markers.pulseComment = `PULSECOMMENT${stamp}`;
  await db.query(
    `INSERT INTO pulse_responses (company_id, team_id, period_start, period_end, q_workload, q_focus, q_support, q_energy, q_outlook, comment)
     VALUES ($1, $2, CURRENT_DATE - 14, CURRENT_DATE - 7, 1, 2, 3, 4, 5, $3)`,
    [companyId, teamId, markers.pulseComment],
  );
  // Developers: one opted in (row shown), one not (row never shown).
  const mkDev = async (key: string, optIn: boolean, value: number) => {
    const res = await livePost('/api/admin/users', custCookie, { email: `op-dev-${key}-${stamp}@cust${stamp}.test`, password: NEW_PW, firstName: 'Dev', lastName: key, role: 'qa_engineer', teamId });
    if (res.status !== 201) throw new Error(`dev ${key}: ${res.status} ${JSON.stringify(res.body)}`);
    await db.query('UPDATE users SET developer_insights_enabled = $1 WHERE id = $2', [optIn, res.body.id]);
    await db.query(
      `INSERT INTO developer_metrics (team_id, developer_id, pr_merge_time_avg, code_review_time_avg, focus_time_hours, meeting_time_hours, context_switches_per_day)
       VALUES ($1, $2, $3, 1, 2, 3, 4)`,
      [teamId, res.body.id, value],
    );
    return res.body.id;
  };
  markers.devOptOutValue = '987.65';
  await mkDev('out', false, 987.65);
  await mkDev('in', true, 123.45);
}, 60_000);

afterAll(async () => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await db?.end();
  await flushBackgroundWrites(2000);
  await pool.end();
});

const skip = () => !up;

describe('Platform operator', () => {
  test('OP-001 off when PLATFORM_OPERATOR_EMAILS is unset or empty', async () => {
    if (skip()) return;
    const was = process.env.PLATFORM_OPERATOR_EMAILS;
    for (const v of [undefined, '', ' , ']) {
      if (v === undefined) delete process.env.PLATFORM_OPERATOR_EMAILS; else process.env.PLATFORM_OPERATOR_EMAILS = v;
      for (const [m, p] of [['get', '/api/operator/status'], ['post', '/api/operator/session'], ['get', '/api/operator/overview'], ['get', `/api/operator/companies/${companyId}/users`]] as const) {
        const res = await call(m, p, opCookie);
        expect(res.status).toBe(404);
      }
    }
    process.env.PLATFORM_OPERATOR_EMAILS = was;
  });

  test('OP-002 a super admin who is not allowlisted is refused (404); status says false', async () => {
    if (skip()) return;
    expect((await call('get', '/api/operator/status', custCookie)).body).toEqual({ operator: false });
    expect((await call('get', '/api/operator/status', '')).body).toEqual({ operator: false });
    expect((await call('get', '/api/operator/status', opCookie)).body).toEqual({ operator: true });
    expect((await stepUp(custCookie)).status).toBe(404);
    expect((await call('get', '/api/operator/overview', custCookie)).status).toBe(404);
    expect((await call('get', '/api/operator/overview', '')).status).toBe(401);
  });

  test('OP-003 step-up: wrong password refused and logged without the password; then success', async () => {
    if (skip()) return;
    const bad = await stepUp(opCookie, 'Wrong-password-MARK');
    expect(bad.status).toBe(401);
    expect(bad.body.token).toBeUndefined();
    const log = await db.query(`SELECT * FROM platform_access_log WHERE operator_user_id = $1 AND action = 'step_up.failed'`, [opUserId]);
    expect(log.rows.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(log.rows)).not.toContain('Wrong-password-MARK');
    const ok = await stepUp(opCookie);
    expect(ok.status).toBe(200);
    expect(typeof ok.body.token).toBe('string');
    expect(Date.parse(ok.body.expiresAt) - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(Date.parse(ok.body.expiresAt) - Date.now()).toBeLessThanOrEqual(30 * 60_000 + 5000);
    token = ok.body.token;
    expect((await call('get', '/api/operator/session', opCookie, token)).status).toBe(200);
  });

  test('OP-003b step-up is rate limited (5 failures per 15 minutes per user)', async () => {
    if (skip()) return;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await stepUp(op2Cookie, `nope-${i}`)).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
    // Even the right password is refused while limited.
    expect((await stepUp(op2Cookie)).status).toBe(429);
  });

  test('OP-004 session JWT and operator token are not interchangeable; both are needed', async () => {
    if (skip()) return;
    const sessionJwt = opCookie.replace('irongate_token=', '');
    // Session only, or the session JWT in place of the operator token.
    expect((await call('get', '/api/operator/overview', opCookie)).status).toBe(401);
    expect((await call('get', '/api/operator/overview', opCookie, sessionJwt)).status).toBe(401);
    // A token signed with JWT_SECRET carrying the operator claims is still refused (different key).
    const forged = jwt.sign({ typ: 'platform_operator', sid: 'x' }, JWT_SECRET, { subject: opUserId, audience: 'irongate-platform-operator', issuer: 'irongate', expiresIn: 600 });
    expect((await call('get', '/api/operator/overview', opCookie, forged)).status).toBe(401);
    // Operator token alone, without the session.
    expect((await call('get', '/api/operator/overview', '', token)).status).toBe(401);
    // Operator token as a session (cookie or bearer) never works on normal routes.
    expect((await request(API_URL).get('/api/teams').set('Cookie', `irongate_token=${token}`)).status).toBe(403);
    expect((await request(API_URL).get('/api/teams').set('Authorization', `Bearer ${token}`)).status).toBe(403);
    // Another operator's session cannot use my token.
    expect((await call('get', '/api/operator/overview', op2Cookie, token)).status).toBe(401);
    expect((await call('get', '/api/operator/overview', opCookie, token)).status).toBe(200);
  });

  test('OP-005 expiry and Leave end the operator token', async () => {
    if (skip()) return;
    const s = await stepUp(opCookie);
    const sid = (jwt.decode(s.body.token) as any).sid;
    const expired = signOperatorToken(opUserId, sid, -1);
    expect((await call('get', '/api/operator/overview', opCookie, expired)).status).toBe(401);
    // The session row expired (e.g. after 30 minutes): refused although the JWT is still valid.
    await db.query(`UPDATE platform_operator_sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [sid]);
    expect((await call('get', '/api/operator/overview', opCookie, s.body.token)).status).toBe(401);
    // Leave.
    const s2 = await stepUp(opCookie);
    expect((await call('post', '/api/operator/session/end', opCookie, s2.body.token)).status).toBe(200);
    const after = await call('get', '/api/operator/overview', opCookie, s2.body.token);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('operator_session_required');
    // Removed from the allowlist: refused at once, even with a live token.
    const was = process.env.PLATFORM_OPERATOR_EMAILS;
    process.env.PLATFORM_OPERATOR_EMAILS = op2Email;
    expect((await call('get', '/api/operator/overview', opCookie, token)).status).toBe(404);
    process.env.PLATFORM_OPERATOR_EMAILS = was;
  });

  test('OP-006 PLATFORM_OPERATOR_ALLOWED_IPS refuses other client addresses', async () => {
    if (skip()) return;
    process.env.PLATFORM_OPERATOR_ALLOWED_IPS = '203.0.113.7';
    expect((await call('get', '/api/operator/overview', opCookie, token)).status).toBe(403);
    expect((await call('get', '/api/operator/status', opCookie)).body.operator).toBe(false);
    process.env.PLATFORM_OPERATOR_ALLOWED_IPS = '127.0.0.1, ::1';
    expect((await call('get', '/api/operator/overview', opCookie, token)).status).toBe(200);
    delete process.env.PLATFORM_OPERATOR_ALLOWED_IPS;
  });

  test('OP-007 protected fields never appear in operator responses', async () => {
    if (skip()) return;
    const sections = ['summary', 'organisation', 'users', 'settings', `data?teamId=${teamId}`, 'alerts', 'pulse', 'activity', 'user-activity?facets=true', 'errors'];
    const bodies: string[] = [];
    for (const s of sections) {
      const res = await call('get', `/api/operator/companies/${companyId}/${s}`, opCookie, token, 'protected field check');
      expect(res.status).toBe(200);
      bodies.push(JSON.stringify(res.body));
    }
    bodies.push(JSON.stringify((await call('get', '/api/operator/overview', opCookie, token)).body));
    const all = bodies.join('\n');
    for (const [k, v] of Object.entries(markers)) {
      if (k === 'devOptOutValue') continue;
      expect({ k, found: all.includes(v) }).toEqual({ k, found: false });
    }
    expect(all).not.toMatch(/password_hash|key_hash|token_hash|slack_webhook_enc/);
    expect(all).not.toContain('q_workload');
    // Developer metrics: the opted-in row is shown, the other one never.
    const data = JSON.parse(bodies[4]);
    const values = data.developers.optedInRows.map((r: any) => Number(r.pr_merge_time_avg));
    expect(values).toContain(123.45);
    expect(values).not.toContain(987.65);
    expect(bodies[4]).not.toContain(markers.devOptOutValue);
    // Secret config values are masked, the key is listed.
    const settings = JSON.parse(bodies[3]);
    const secret = settings.configs.find((c: any) => c.config_key === 'jira_api_token');
    expect(secret?.config_value).toBe('********');
    // Invitations / API keys: no token or hash fields at all.
    const users = JSON.parse(bodies[2]);
    expect(Object.keys(users.apiKeys[0]).sort()).toEqual(['created_at', 'id', 'key_prefix', 'last_used_at', 'name', 'revoked_at']);
  });

  test('OP-008 company views are recorded for the customer (throttled) and platform-wide', async () => {
    if (skip()) return;
    await db.query(`DELETE FROM audit_log WHERE company_id = $1 AND action = 'platform_support.view' AND after->>'section' = 'alerts'`, [companyId]);
    expect((await call('get', `/api/operator/companies/${companyId}/alerts`, opCookie, token)).status).toBe(400); // reason required
    for (let i = 0; i < 3; i++) {
      expect((await call('get', `/api/operator/companies/${companyId}/alerts`, opCookie, token, 'Ticket 42: alerts missing')).status).toBe(200);
    }
    const audit = await db.query(`SELECT * FROM audit_log WHERE company_id = $1 AND action = 'platform_support.view' AND after->>'section' = 'alerts'`, [companyId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].entity_type).toBe('company');
    expect(audit.rows[0].actor_id).toBeNull();
    expect(audit.rows[0].summary).toBe('Platform support viewed alerts and actions. Reason: Ticket 42: alerts missing');
    // The customer's super admin sees it in the Activity log.
    const seen = await liveGet('/api/admin/audit?action=platform_support.view', custCookie);
    expect(seen.status).toBe(200);
    expect(seen.body.entries.some((e: any) => e.summary.includes('Ticket 42'))).toBe(true);
    // Older than 30 minutes: a new entry.
    await db.query(`UPDATE audit_log SET created_at = now() - interval '31 minutes' WHERE id = $1`, [audit.rows[0].id]);
    await call('get', `/api/operator/companies/${companyId}/alerts`, opCookie, token, 'Ticket 42: alerts missing');
    expect((await db.query(`SELECT 1 FROM audit_log WHERE company_id = $1 AND action = 'platform_support.view' AND after->>'section' = 'alerts'`, [companyId])).rows).toHaveLength(2);
    // Platform log: every view.
    const plat = await db.query(`SELECT * FROM platform_access_log WHERE company_id = $1 AND action = 'view' AND section = 'alerts'`, [companyId]);
    expect(plat.rows.length).toBeGreaterThanOrEqual(4);
    expect(plat.rows[0].operator_email.toLowerCase()).toBe(opEmail);
    // Operator requests are not in the customer's user activity log.
    await flushActivity();
    const ua = await db.query(`SELECT 1 FROM user_activity WHERE route LIKE '/api/operator%'`);
    expect(ua.rows).toHaveLength(0);
  });

  test('OP-009 repair actions need a reason and a confirm, work, and are audited', async () => {
    if (skip()) return;
    const post = (p: string, body: object) => call('post', `/api/operator${p}`, opCookie, token).send(body);
    const base = `/companies/${companyId}`;
    expect((await post(`${base}/actions/evaluate-alerts`, { confirm: true })).status).toBe(400);
    expect((await post(`${base}/actions/evaluate-alerts`, { reason: 'Check alerts' })).status).toBe(400);
    const actionsBefore = Number((await db.query(`SELECT COUNT(*) FROM audit_log WHERE company_id = $1 AND action = 'platform_support.action'`, [companyId])).rows[0].count);

    const ev = await post(`${base}/actions/evaluate-alerts`, { reason: 'Check alerts', confirm: true });
    expect(ev.status).toBe(200);
    expect(typeof ev.body.opened).toBe('number');

    const rc = await post(`${base}/actions/recompute-snapshots`, { reason: 'Snapshots looked wrong', confirm: true, teamId });
    expect(rc.status).toBe(200);
    expect(rc.body.teams[0].teamId).toBe(teamId);
    expect((await post(`${base}/actions/recompute-snapshots`, { reason: 'x team', confirm: true, teamId: 'not-a-team' })).status).toBe(404);

    const inv = await livePost('/api/admin/invitations', custCookie, { email: `op-invitee-${stamp}@cust${stamp}.test`, role: 'qa_engineer', scopeId: teamId });
    expect(inv.status).toBe(201);
    const hashBefore = (await db.query('SELECT token_hash FROM invitations WHERE id = $1', [inv.body.invitation.id])).rows[0].token_hash;
    const rs = await post(`${base}/invitations/${inv.body.invitation.id}/resend`, { reason: 'Invitee lost the e-mail', confirm: true });
    expect(rs.status).toBe(200);
    expect(JSON.stringify(rs.body)).not.toMatch(/igi_|token|accept-invite/);
    expect((await db.query('SELECT token_hash FROM invitations WHERE id = $1', [inv.body.invitation.id])).rows[0].token_hash).not.toBe(hashBefore);

    const u = await livePost('/api/admin/users', custCookie, { email: `op-target-${stamp}@cust${stamp}.test`, password: NEW_PW, firstName: 'Tar', lastName: 'Get', role: 'viewer', teamId });
    expect(u.status).toBe(201);
    expect((await post(`${base}/users/${u.body.id}/deactivate`, { reason: 'Customer asked', confirm: true })).status).toBe(200);
    expect((await db.query('SELECT is_active FROM users WHERE id = $1', [u.body.id])).rows[0].is_active).toBe(false);
    expect((await post(`${base}/users/${u.body.id}/deactivate`, { reason: 'Customer asked', confirm: true })).status).toBe(409);
    expect((await post(`${base}/users/${u.body.id}/reactivate`, { reason: 'Customer asked again', confirm: true })).status).toBe(200);
    expect((await db.query('SELECT is_active FROM users WHERE id = $1', [u.body.id])).rows[0].is_active).toBe(true);
    const deact = await db.query(`SELECT * FROM audit_log WHERE company_id = $1 AND action = 'user.deactivate' AND entity_id = $2`, [companyId, u.body.id]);
    expect(deact.rows[0].summary).toMatch(/^Platform support deactivated/);

    expect((await post(`${base}/users/${u.body.id}/clear-lockout`, { reason: 'Locked out', confirm: true })).status).toBe(409);
    await db.query(`UPDATE users SET failed_login_attempts = 4, locked_until = now() + interval '1 hour' WHERE id = $1`, [u.body.id]);
    expect((await post(`${base}/users/${u.body.id}/clear-lockout`, { reason: 'Locked out', confirm: true })).status).toBe(200);
    expect((await db.query('SELECT failed_login_attempts, locked_until FROM users WHERE id = $1', [u.body.id])).rows[0]).toEqual({ failed_login_attempts: 0, locked_until: null });
    // Sign out everywhere: the user's sessions (issued before now) and platform support sessions end.
    const oldSession = jwt.sign({ userId: u.body.id, iat: Math.floor(Date.now() / 1000) - 5 }, JWT_SECRET, { expiresIn: 3600 });
    expect((await request(app).get('/api/auth/me').set('Cookie', `irongate_token=${oldSession}`)).status).toBe(200);
    const opSid = `op-sid-${stamp}`;
    await db.query(`INSERT INTO platform_operator_sessions (id, user_id, expires_at, ip) VALUES ($1, $2, now() + interval '30 minutes', '127.0.0.1')`, [opSid, u.body.id]);
    expect((await post(`${base}/users/${u.body.id}/sign-out-everywhere`, { reason: 'Lost laptop', confirm: true })).status).toBe(200);
    const ended = await request(app).get('/api/auth/me').set('Cookie', `irongate_token=${oldSession}`);
    expect(ended.status).toBe(401);
    expect(ended.body.code).toBe('session_ended');
    expect((await db.query('SELECT ended_at FROM platform_operator_sessions WHERE id = $1', [opSid])).rows[0].ended_at).not.toBeNull();
    const signOutAudit = await db.query(`SELECT summary FROM audit_log WHERE company_id = $1 AND action = 'platform_support.action' AND summary LIKE '%out everywhere%'`, [companyId]);
    expect(signOutAudit.rows[0].summary).toMatch(/^Platform support: Signed Tar Get out everywhere\. Reason: Lost laptop/);
    // Another company's user through this company: 404.
    expect((await post(`${base}/users/${opUserId}/deactivate`, { reason: 'wrong company', confirm: true })).status).toBe(404);
    expect((await post(`${base}/users/${opUserId}/sign-out-everywhere`, { reason: 'wrong company', confirm: true })).status).toBe(404);

    runRefreshDates.mockResolvedValueOnce({ today: '2026-11-19', demoCompany: { refreshed: true, insertedTotal: 3 }, companies: [{ id: companyId, teams: 1, teamsFilled: 1 }], insertedTotal: 3 });
    const dr = await post('/actions/demo-refresh', { reason: 'Demo data is a day behind', confirm: true });
    expect(dr.status).toBe(200);
    expect(runRefreshDates).toHaveBeenCalledTimes(1);
    const job = await db.query(`SELECT * FROM job_runs WHERE job = 'demo-refresh' ORDER BY started_at DESC LIMIT 1`);
    expect(job.rows[0].ok).toBe(true);

    const actions = await db.query(`SELECT summary FROM audit_log WHERE company_id = $1 AND action = 'platform_support.action' ORDER BY created_at`, [companyId]);
    expect(actions.rows.length - actionsBefore).toBe(8); // evaluate, recompute, resend, deactivate, reactivate, clear lockout, sign out everywhere, demo refresh
    expect(actions.rows.map((r: any) => r.summary).join('\n')).toMatch(/Reason: Customer asked again/);
    const plat = await db.query(`SELECT 1 FROM platform_access_log WHERE action = 'action' AND company_id IS NULL AND section = 'demo_refresh'`);
    expect(plat.rows.length).toBeGreaterThanOrEqual(1);
  });

  test('OP-010 overview, errors, limits and invalid ids', async () => {
    if (skip()) return;
    const ov = await call('get', '/api/operator/overview?limit=2', opCookie, token);
    expect(ov.status).toBe(200);
    expect(ov.body.companies.length).toBeLessThanOrEqual(2);
    expect(ov.body.platform.jobs.map((j: any) => j.job)).toEqual(['alerts-evaluate', 'weekly-digest', 'pulse-auto-send', 'db-keepalive', 'demo-refresh', 'demo-refresh-background']);
    expect(typeof ov.body.platform.dbSizeBytes).toBe('number');
    const big = await call('get', '/api/operator/overview?limit=100000', opCookie, token);
    expect(big.body.limit).toBe(500);
    expect((await call('get', "/api/operator/companies/x'%20OR%201=1/users", opCookie, token, 'probe')).status).toBe(400);
    expect((await call('get', '/api/operator/companies/no-such-company/users', opCookie, token, 'probe')).status).toBe(404);
    expect((await call('get', '/api/operator/errors?requestId=%3Cscript%3E', opCookie, token)).status).toBe(400);
    expect((await call('get', '/api/operator/errors?limit=9999', opCookie, token)).status).toBe(200);
    expect((await call('get', '/api/operator/access-log', opCookie, token)).body.entries.length).toBeLessThanOrEqual(50);
  });
});
