/**
 * Platform operator panel (server/routes/operator.ts, server/lib/operator.ts), against an
 * in-process copy of the API (tests/api/helpers/inProcessApp.ts) so PLATFORM_OPERATOR_ALLOWED_IPS
 * can change per test. Same local database as the live API. Operators are rows of
 * platform_operators (never company users), created here with upsertOperator.
 *
 *   OP-001  feature off (no active operator): every /api/operator route is 404
 *   OP-002  company accounts are never operators: a company session or a company user's password
 *           gets nothing; an operator's e-mail cannot register, be added or invited as a company
 *           user, and a company user's e-mail cannot become an operator
 *   OP-003  sign-in: wrong password refused (nothing logged, no password stored); success: an 8-hour
 *           session in the httpOnly cookie irongate_operator (and the token in the answer)
 *   OP-003b lockout after 5 failed sign-ins in a row (15 minutes, even with the right password)
 *   OP-004  a company session JWT cannot act as the operator token, and the operator token is
 *           never accepted as a company session
 *   OP-005  operator token expiry, Sign out (revocation), the session row expiry, a deactivated operator
 *   OP-006  allowed IPs (PLATFORM_OPERATOR_ALLOWED_IPS)
 *   OP-007  full visibility of customer data (every developer row, single pulse answers and
 *           comments, who answered, user details) but never a secret: password / API key / token
 *           hashes, link tokens, the Slack webhook, integration credentials ("set" / "not set")
 *   OP-008  nothing an operator does is logged: no customer audit entry, no user activity row,
 *           no platform access log row; no reason is asked for
 *   OP-009  repair actions: no reason; destructive ones need confirm; each works
 *   OP-010  overview, error search and pagination limits; invalid company ids
 *   OP-011  "Refresh sample data now" on Netlify: starts the background function with the signed
 *           token, answers 202 "started" at once, records job_runs and the platform access log;
 *           a failed start is 502 and recorded as failed; off (DEMO_REFRESH_ENABLED=false) is 409
 *   OP-012  the modules section returns every analytics module's stored rows for a team
 *   OP-013  operator sign-in is not rate limited (owner's rule)
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
import { signOperatorToken, upsertOperator } from '../../server/lib/operator';
import { JWT_SECRET } from '../../server/middleware/auth';
import { flushActivity } from '../../server/lib/userActivity';
import { flushBackgroundWrites } from '../../server/lib/opsLog';
import { pool } from '../../src/lib/db';

const app = buildApp();
const ENV = ['PLATFORM_OPERATOR_ALLOWED_IPS'];
const saved: Record<string, string | undefined> = {};
let up = true;
let db: Client;
const stamp = Date.now();
const OP_PW = 'Operator-Test-Passw0rd!';
const opEmail = `op-owner-${stamp}@platform${stamp}.test`;
const op2Email = `op-second-${stamp}@platform${stamp}.test`;
const op3Email = `op-third-${stamp}@platform${stamp}.test`;
const otherEmail = `op-other-${stamp}@other${stamp}.test`;
const custEmail = `op-customer-${stamp}@cust${stamp}.test`;
let opId = '';
let op2Id = '';
let otherCookie = '';
let otherUserId = '';
let custCookie = '';
let companyId = '';
let teamId = '';
const markers: Record<string, string> = {};
/** Kept for the calls below: company cookies are ignored by /api/operator (operators are not company users). */
let opCookie = '';

const call = (method: 'get' | 'post', path: string, cookie = '', token = '') => {
  let r = request(app)[method](path).set('Cookie', cookie);
  if (token) r = r.set('X-Operator-Token', token);
  return r;
};
async function register(email: string, company: string) {
  const res = await request(API_URL).post('/api/auth/register').send({
    email, password: NEW_PW, firstName: 'Op', lastName: company, companyName: company, departmentName: 'Ops', teamName: `${company} Team`,
  });
  if (res.status >= 300) throw new Error(`register ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return { cookie: cookieFrom(res), user: res.body.user };
}
const signIn = (email: string, password = OP_PW) => request(app).post('/api/operator/login').send({ email, password });
let token = '';

beforeAll(async () => {
  for (const k of ENV) saved[k] = process.env[k];
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  opId = (await upsertOperator(opEmail, 'Owner Operator', OP_PW)).id;
  op2Id = (await upsertOperator(op2Email, 'Second Operator', OP_PW)).id;
  await upsertOperator(op3Email, 'Third Operator', OP_PW);
  const other = await register(otherEmail, `OpOther ${stamp}`);
  otherCookie = other.cookie; otherUserId = other.user.id;
  opCookie = otherCookie;
  const cust = await register(custEmail, `OpCustomer ${stamp}`);
  custCookie = cust.cookie;
  companyId = cust.user.company_id ?? cust.user.companyId;
  teamId = (await db.query('SELECT id FROM teams WHERE company_id = $1 LIMIT 1', [companyId])).rows[0].id;

  // ---- data of the customer company, each with a marker value
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
  // Customer data that support now sees in full.
  markers.pulseComment = `PULSECOMMENT${stamp}`;
  await db.query(
    `INSERT INTO pulse_responses (company_id, team_id, period_start, period_end, q_workload, q_focus, q_support, q_energy, q_outlook, comment)
     VALUES ($1, $2, CURRENT_DATE - 14, CURRENT_DATE - 7, 1, 2, 3, 4, 5, $3)`,
    [companyId, teamId, markers.pulseComment],
  );
  await db.query(
    `INSERT INTO pulse_participation (company_id, team_id, user_id, period_start) VALUES ($1, $2, $3, CURRENT_DATE - 14) ON CONFLICT DO NOTHING`,
    [companyId, teamId, cust.user.id],
  );
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
  await mkDev('out', false, 987.65);
  await mkDev('in', true, 123.45);
}, 60_000);

afterAll(async () => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  if (db) await db.query('DELETE FROM platform_operators WHERE email = ANY($1::text[])', [[opEmail, op2Email, op3Email]]);
  await db?.end();
  await flushBackgroundWrites(2000);
  await pool.end();
});

const skip = () => !up;

describe('Platform operator', () => {
  test('OP-001 off when no active operator exists', async () => {
    if (skip()) return;
    const active = (await db.query('UPDATE platform_operators SET is_active = FALSE WHERE is_active RETURNING id')).rows.map((r: any) => r.id);
    try {
      for (const [m, p] of [['get', '/api/operator/status'], ['post', '/api/operator/login'], ['get', '/api/operator/overview'], ['get', `/api/operator/companies/${companyId}/users`]] as const) {
        expect({ p, status: (await call(m, p)).status }).toEqual({ p, status: 404 });
      }
    } finally {
      await db.query('UPDATE platform_operators SET is_active = TRUE WHERE id = ANY($1::text[])', [active]);
    }
  });

  test('OP-002 company accounts are never operators, and the other way round', async () => {
    if (skip()) return;
    expect((await call('get', '/api/operator/status', custCookie)).body).toEqual({ signedIn: false, allowed: true });
    expect((await call('get', '/api/operator/overview', custCookie)).status).toBe(401);
    // A company user's own password does not open platform support.
    expect((await signIn(custEmail, NEW_PW)).status).toBe(401);
    // An operator's e-mail cannot become a company account.
    const reg = await request(API_URL).post('/api/auth/register').send({
      email: opEmail, password: NEW_PW, firstName: 'X', lastName: 'Y', companyName: `OpClash ${stamp}`, departmentName: 'D', teamName: 'T',
    });
    expect(reg.status).toBe(409);
    expect((await livePost('/api/admin/users', custCookie, { email: opEmail.toUpperCase(), password: NEW_PW, firstName: 'X', lastName: 'Y', role: 'viewer', teamId })).status).toBe(409);
    expect((await livePost('/api/admin/invitations', custCookie, { email: opEmail, role: 'qa_engineer', scopeId: teamId })).status).toBe(409);
    // A company user's e-mail cannot become an operator (the script and the database refuse it).
    await expect(upsertOperator(custEmail, 'Clash', OP_PW)).rejects.toThrow(/company user/);
    await expect(db.query(`INSERT INTO platform_operators (email, name, password_hash) VALUES ($1, 'Clash', 'x')`, [custEmail.toUpperCase()])).rejects.toThrow(/company user/);
    await expect(db.query(`UPDATE users SET email = $1 WHERE LOWER(email) = LOWER($2)`, [opEmail, custEmail])).rejects.toThrow(/cannot be used/);
  });

  test('OP-003 sign-in: wrong password refused, nothing logged; then an 8-hour session', async () => {
    if (skip()) return;
    const logBefore = Number((await db.query('SELECT COUNT(*) FROM platform_access_log')).rows[0].count);
    const bad = await signIn(opEmail, 'Wrong-password-MARK');
    expect(bad.status).toBe(401);
    expect(bad.body.token).toBeUndefined();
    expect(Number((await db.query('SELECT COUNT(*) FROM platform_access_log')).rows[0].count)).toBe(logBefore);
    const ok = await signIn(opEmail.toUpperCase());
    expect(ok.status).toBe(200);
    expect(typeof ok.body.token).toBe('string');
    expect(ok.body).toEqual(expect.objectContaining({ email: opEmail, name: 'Owner Operator' }));
    expect(Date.parse(ok.body.expiresAt) - Date.now()).toBeGreaterThan(8 * 3600_000 - 60_000);
    expect(Date.parse(ok.body.expiresAt) - Date.now()).toBeLessThanOrEqual(8 * 3600_000 + 5000);
    const cookie = ([] as string[]).concat(ok.headers['set-cookie'] ?? []).find((c) => c.startsWith('irongate_operator='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    token = ok.body.token;
    // The cookie alone is the session (the web page uses it).
    const viaCookie = await request(app).get('/api/operator/session').set('Cookie', cookie.split(';')[0]);
    expect(viaCookie.status).toBe(200);
    expect(viaCookie.body.email).toBe(opEmail);
    expect((await request(app).get('/api/operator/status').set('Cookie', cookie.split(';')[0])).body).toEqual(expect.objectContaining({ signedIn: true, email: opEmail }));
    expect((await db.query('SELECT last_login, failed_login_attempts FROM platform_operators WHERE id = $1', [opId])).rows[0]).toEqual(expect.objectContaining({ failed_login_attempts: 0, last_login: expect.any(Date) }));
  });

  test('OP-003b an operator is never locked out: many wrong passwords, then the right one signs in', async () => {
    if (skip()) return;
    await db.query("UPDATE platform_operators SET locked_until = now() + interval '1 hour' WHERE id = $1", [op2Id]);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await signIn(op2Email, `nope-${i}`)).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 401]);
    expect((await signIn(op2Email)).status).toBe(200);
    const row = (await db.query('SELECT locked_until, failed_login_attempts FROM platform_operators WHERE id = $1', [op2Id])).rows[0];
    expect(row).toEqual(expect.objectContaining({ locked_until: null, failed_login_attempts: 0 }));
  });

  test('OP-004 company session JWT and operator token are not interchangeable', async () => {
    if (skip()) return;
    const sessionJwt = custCookie.replace('irongate_token=', '');
    expect((await call('get', '/api/operator/overview', custCookie, sessionJwt)).status).toBe(401);
    expect((await request(app).get('/api/operator/overview').set('Cookie', `irongate_operator=${sessionJwt}`)).status).toBe(401);
    // A token signed with JWT_SECRET carrying the operator claims is still refused (different key).
    const forged = jwt.sign({ typ: 'platform_operator', sid: 'x' }, JWT_SECRET, { subject: opId, audience: 'irongate-platform-operator', issuer: 'irongate', expiresIn: 600 });
    expect((await call('get', '/api/operator/overview', '', forged)).status).toBe(401);
    // The operator token as a company session never works on normal routes.
    expect([401, 403]).toContain((await request(API_URL).get('/api/teams').set('Cookie', `irongate_token=${token}`)).status);
    expect([401, 403]).toContain((await request(API_URL).get('/api/teams').set('Authorization', `Bearer ${token}`)).status);
    // Another operator's id with my session: refused.
    const sid = (jwt.decode(token) as any).sid;
    expect((await call('get', '/api/operator/overview', '', signOperatorToken(op2Id, sid))).status).toBe(401);
    expect((await call('get', '/api/operator/overview', '', token)).status).toBe(200);
  });

  test('OP-005 expiry, Sign out and deactivation end the operator session', async () => {
    if (skip()) return;
    const s = await signIn(opEmail);
    const sid = (jwt.decode(s.body.token) as any).sid;
    expect((await call('get', '/api/operator/overview', '', signOperatorToken(opId, sid, -1))).status).toBe(401);
    // The session row expired: refused although the JWT is still valid.
    await db.query(`UPDATE platform_operator_sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [sid]);
    expect((await call('get', '/api/operator/overview', '', s.body.token)).status).toBe(401);
    // Sign out.
    const s2 = await signIn(opEmail);
    const out = await call('post', '/api/operator/logout', '', s2.body.token);
    expect(out.status).toBe(200);
    expect(([] as string[]).concat(out.headers['set-cookie'] ?? []).some((c) => /^irongate_operator=;/.test(c))).toBe(true);
    const after = await call('get', '/api/operator/overview', '', s2.body.token);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('operator_session_required');
    // A deactivated operator: refused at once, even with a live token, and cannot sign in.
    const s3 = await signIn(op3Email);
    await db.query('UPDATE platform_operators SET is_active = FALSE WHERE email = $1', [op3Email]);
    expect((await call('get', '/api/operator/overview', '', s3.body.token)).status).toBe(401);
    expect((await signIn(op3Email)).status).toBe(401);
    await db.query('UPDATE platform_operators SET is_active = TRUE WHERE email = $1', [op3Email]);
  });

  test('OP-006 PLATFORM_OPERATOR_ALLOWED_IPS refuses other client addresses', async () => {
    if (skip()) return;
    try {
      process.env.PLATFORM_OPERATOR_ALLOWED_IPS = '203.0.113.7';
      expect((await call('get', '/api/operator/overview', '', token)).status).toBe(403);
      expect((await call('get', '/api/operator/status', '', token)).body).toEqual({ signedIn: false, allowed: false });
      expect((await signIn(opEmail)).status).toBe(403);
      process.env.PLATFORM_OPERATOR_ALLOWED_IPS = '127.0.0.1, ::1';
      expect((await call('get', '/api/operator/overview', '', token)).status).toBe(200);
    } finally {
      delete process.env.PLATFORM_OPERATOR_ALLOWED_IPS;
    }
  });

  test('OP-007 every customer value is visible; secrets never are', async () => {
    if (skip()) return;
    const sections = ['summary', 'organisation', 'users', 'settings', `data?teamId=${teamId}`, 'alerts', 'pulse', 'activity', 'user-activity?facets=true', 'errors', `modules?teamId=${teamId}`];
    const bodies: string[] = [];
    for (const s of sections) {
      const res = await call('get', `/api/operator/companies/${companyId}/${s}`, '', token);
      expect({ s, status: res.status }).toEqual({ s, status: 200 });
      bodies.push(JSON.stringify(res.body));
    }
    bodies.push(JSON.stringify((await call('get', '/api/operator/overview', '', token)).body));
    const all = bodies.join('\n');
    for (const k of ['apiKey', 'apiKeyHash', 'passwordHash', 'slack', 'configSecret', 'pulseToken', 'pulseHash']) {
      expect({ k, found: all.includes(markers[k]) }).toEqual({ k, found: false });
    }
    expect(all).not.toMatch(/password_hash|key_hash|token_hash|slack_webhook_enc|password_reset_token/);
    // Developer metrics: every person's row, with whether they opted in.
    const data = JSON.parse(bodies[4]);
    const rows = data.developers.rows.map((r: any) => ({ v: Number(r.pr_merge_time_avg), optedIn: r.opted_in }));
    expect(rows).toEqual(expect.arrayContaining([{ v: 123.45, optedIn: true }, { v: 987.65, optedIn: false }]));
    // Pulse: single answers with comments, and who answered.
    const pulse = JSON.parse(bodies[6]).teams.find((t: any) => t.team.id === teamId);
    expect(pulse.answers).toEqual(expect.arrayContaining([expect.objectContaining({ q_workload: 1, q_outlook: 5, comment: markers.pulseComment })]));
    expect(pulse.participants.map((p: any) => p.email.toLowerCase())).toContain(custEmail);
    // Integration credentials: only whether one is set.
    const settings = JSON.parse(bodies[3]);
    expect(settings.configs.find((c: any) => c.config_key === 'jira_api_token')?.config_value).toBe('set');
    expect(settings.notificationSettings.slack_configured).toBe(true);
    // Users: details, but no hash or token field.
    const users = JSON.parse(bodies[2]);
    expect(users.users.find((u: any) => u.email.toLowerCase() === custEmail)).toEqual(expect.objectContaining({ password_set: true, department_name: expect.any(String) }));
    expect(Object.keys(users.apiKeys[0]).sort()).toEqual(['created_at', 'id', 'key_prefix', 'last_used_at', 'name', 'revoked_at']);
  });

  test('OP-008 operator views and changes are not logged anywhere, and need no reason', async () => {
    if (skip()) return;
    const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0].count);
    const auditBefore = await count('SELECT COUNT(*) FROM audit_log WHERE company_id = $1', [companyId]);
    const platBefore = await count('SELECT COUNT(*) FROM platform_access_log');
    for (const s of ['summary', 'users', 'alerts', 'settings', 'sessions', 'auth-events', 'views']) {
      expect({ s, status: (await call('get', `/api/operator/companies/${companyId}/${s}`, '', token)).status }).toEqual({ s, status: 200 });
    }
    // A change made by platform support: in the company's data, not in its history.
    const dep = await call('post', `/api/operator/companies/${companyId}/departments`, '', token).send({ name: `Op dept ${stamp}` });
    expect(dep.status).toBe(201);
    expect(await count('SELECT COUNT(*) FROM audit_log WHERE company_id = $1', [companyId])).toBe(auditBefore);
    expect(await count(`SELECT COUNT(*) FROM audit_log WHERE action LIKE 'platform_support.%'`)).toBe(0);
    expect(await count('SELECT COUNT(*) FROM platform_access_log')).toBe(platBefore);
    // The customer's Activity log shows nothing of it.
    const seen = await liveGet('/api/admin/audit', custCookie);
    expect(seen.status).toBe(200);
    expect(JSON.stringify(seen.body)).not.toMatch(/Platform support|Op dept/);
    // Operator requests are not in the customer's user activity log.
    await flushActivity();
    const ua = await db.query(`SELECT 1 FROM user_activity WHERE route LIKE '/api/operator%'`);
    expect(ua.rows).toHaveLength(0);
    // The former access log route is gone.
    expect((await call('get', '/api/operator/access-log', '', token)).status).toBe(404);
  });

  test('OP-009 repair actions need no reason, destructive ones a confirm, and each works', async () => {
    if (skip()) return;
    const post = (p: string, body: object) => call('post', `/api/operator${p}`, opCookie, token).send(body);
    const base = `/companies/${companyId}`;
    const auditBefore = Number((await db.query('SELECT COUNT(*) FROM audit_log WHERE company_id = $1', [companyId])).rows[0].count);

    const ev = await post(`${base}/actions/evaluate-alerts`, {});
    expect(ev.status).toBe(200);
    expect(typeof ev.body.opened).toBe('number');

    const rc = await post(`${base}/actions/recompute-snapshots`, { teamId });
    expect(rc.status).toBe(200);
    expect(rc.body.teams[0].teamId).toBe(teamId);
    expect((await post(`${base}/actions/recompute-snapshots`, { teamId: 'not-a-team' })).status).toBe(404);

    const inv = await livePost('/api/admin/invitations', custCookie, { email: `op-invitee-${stamp}@cust${stamp}.test`, role: 'qa_engineer', scopeId: teamId });
    expect(inv.status).toBe(201);
    const hashBefore = (await db.query('SELECT token_hash FROM invitations WHERE id = $1', [inv.body.invitation.id])).rows[0].token_hash;
    const rs = await post(`${base}/invitations/${inv.body.invitation.id}/resend`, {});
    expect(rs.status).toBe(200);
    expect(JSON.stringify(rs.body)).not.toMatch(/igi_|token|accept-invite/);
    expect((await db.query('SELECT token_hash FROM invitations WHERE id = $1', [inv.body.invitation.id])).rows[0].token_hash).not.toBe(hashBefore);

    const u = await livePost('/api/admin/users', custCookie, { email: `op-target-${stamp}@cust${stamp}.test`, password: NEW_PW, firstName: 'Tar', lastName: 'Get', role: 'viewer', teamId });
    expect(u.status).toBe(201);
    expect((await post(`${base}/users/${u.body.id}/deactivate`, {})).status).toBe(400); // destructive: confirm needed
    expect((await post(`${base}/users/${u.body.id}/deactivate`, { confirm: true })).status).toBe(200);
    expect((await db.query('SELECT is_active FROM users WHERE id = $1', [u.body.id])).rows[0].is_active).toBe(false);
    expect((await post(`${base}/users/${u.body.id}/deactivate`, { confirm: true })).status).toBe(409);
    expect((await post(`${base}/users/${u.body.id}/reactivate`, {})).status).toBe(200);
    expect((await db.query('SELECT is_active FROM users WHERE id = $1', [u.body.id])).rows[0].is_active).toBe(true);

    expect((await post(`${base}/users/${u.body.id}/clear-lockout`, {})).status).toBe(409);
    await db.query(`UPDATE users SET failed_login_attempts = 4, locked_until = now() + interval '1 hour' WHERE id = $1`, [u.body.id]);
    expect((await post(`${base}/users/${u.body.id}/clear-lockout`, {})).status).toBe(200);
    expect((await db.query('SELECT failed_login_attempts, locked_until FROM users WHERE id = $1', [u.body.id])).rows[0]).toEqual({ failed_login_attempts: 0, locked_until: null });
    // Sign out everywhere: the user's sessions (issued before now) and platform support sessions end.
    const oldSession = jwt.sign({ userId: u.body.id, iat: Math.floor(Date.now() / 1000) - 5 }, JWT_SECRET, { expiresIn: 3600 });
    expect((await request(app).get('/api/auth/me').set('Cookie', `irongate_token=${oldSession}`)).status).toBe(200);
    const opSid = `op-sid-${stamp}`;
    await db.query(`INSERT INTO platform_operator_sessions (id, user_id, expires_at, ip) VALUES ($1, $2, now() + interval '30 minutes', '127.0.0.1')`, [opSid, u.body.id]);
    expect((await post(`${base}/users/${u.body.id}/sign-out-everywhere`, {})).status).toBe(400);
    expect((await post(`${base}/users/${u.body.id}/sign-out-everywhere`, { confirm: true })).status).toBe(200);
    const ended = await request(app).get('/api/auth/me').set('Cookie', `irongate_token=${oldSession}`);
    expect(ended.status).toBe(401);
    expect(ended.body.code).toBe('session_ended');
    expect((await db.query('SELECT ended_at FROM platform_operator_sessions WHERE id = $1', [opSid])).rows[0].ended_at).not.toBeNull();
    // Another company's user through this company: 404.
    expect((await post(`${base}/users/${otherUserId}/deactivate`, { confirm: true })).status).toBe(404);
    expect((await post(`${base}/users/${otherUserId}/sign-out-everywhere`, { confirm: true })).status).toBe(404);

    runRefreshDates.mockResolvedValueOnce({ today: '2026-11-19', demoCompany: { refreshed: true, insertedTotal: 3 }, companies: [{ id: companyId, teams: 1, teamsFilled: 1 }], insertedTotal: 3 });
    const dr = await post('/actions/demo-refresh', {});
    expect(dr.status).toBe(200);
    expect(runRefreshDates).toHaveBeenCalledTimes(1);
    const job = await db.query(`SELECT * FROM job_runs WHERE job = 'demo-refresh' ORDER BY started_at DESC LIMIT 1`);
    expect(job.rows[0].ok).toBe(true);

    // None of it is in the customer's history (the invitation and the user above were made by its admin).
    expect(Number((await db.query('SELECT COUNT(*) FROM audit_log WHERE company_id = $1', [companyId])).rows[0].count)).toBe(auditBefore + 2); // invitation.create, user.create by the customer
  });

  test('OP-010 overview, errors, limits and invalid ids', async () => {
    if (skip()) return;
    const ov = await call('get', '/api/operator/overview?limit=2', opCookie, token);
    expect(ov.status).toBe(200);
    expect(ov.body.companies.length).toBeLessThanOrEqual(2);
    expect(ov.body.platform.jobs.map((j: any) => j.job)).toEqual(['alerts-evaluate', 'weekly-digest', 'pulse-auto-send', 'db-keepalive', 'demo-refresh', 'demo-refresh-background', 'demo-data', 'calc-recompute']);
    expect(typeof ov.body.platform.dbSizeBytes).toBe('number');
    const big = await call('get', '/api/operator/overview?limit=100000', opCookie, token);
    expect(big.body.limit).toBe(500);
    expect((await call('get', "/api/operator/companies/x'%20OR%201=1/users", opCookie, token)).status).toBe(400);
    expect((await call('get', '/api/operator/companies/no-such-company/users', opCookie, token)).status).toBe(404);
    expect((await call('get', '/api/operator/errors?requestId=%3Cscript%3E', opCookie, token)).status).toBe(400);
    expect((await call('get', '/api/operator/errors?limit=9999', opCookie, token)).status).toBe(200);
  });

  test('OP-011 Refresh sample data now on Netlify starts the background function and reports started', async () => {
    if (skip()) return;
    const keys = ['URL', 'DEMO_REFRESH_SECRET', 'DEMO_REFRESH_ENABLED'];
    const env: Record<string, string | undefined> = {};
    for (const k of keys) env[k] = process.env[k];
    const realFetch = global.fetch;
    const netlifyApp = buildApp();
    netlifyApp.locals.behindNetlify = true; // as netlify/functions/api.ts
    const fresh = (await signIn(opEmail)).body.token as string;
    const run = (body: object) => request(netlifyApp).post('/api/operator/actions/demo-refresh').set('Cookie', opCookie).set('X-Operator-Token', fresh).send(body);
    try {
      process.env.URL = 'https://demo.example.test/';
      process.env.DEMO_REFRESH_SECRET = 'op-refresh-test-secret';
      delete process.env.DEMO_REFRESH_ENABLED;
      const { demoRefreshToken, DEMO_REFRESH_HEADER, DEMO_REFRESH_PATH } = await import('../../server/lib/demoRefreshJob');
      const fetchMock = jest.fn(async (_url: unknown, _init?: any) => new Response(null, { status: 202 }));
      global.fetch = fetchMock as any;
      runRefreshDates.mockClear();

      // The operator session is required.
      expect((await request(netlifyApp).post('/api/operator/actions/demo-refresh').set('Cookie', opCookie).send({})).status).toBe(401); // no operator token
      expect(fetchMock).not.toHaveBeenCalled();

      const t0 = Date.now();
      const res = await run({});
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ started: true, mode: 'background' });
      expect(runRefreshDates).not.toHaveBeenCalled(); // not run inside the API function
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`https://demo.example.test${DEMO_REFRESH_PATH}`);
      expect(init.method).toBe('POST');
      expect(init.headers[DEMO_REFRESH_HEADER]).toBe(demoRefreshToken());
      const job = await db.query(`SELECT ok, summary, started_at FROM job_runs WHERE job = 'demo-refresh' ORDER BY started_at DESC LIMIT 1`);
      expect(job.rows[0]).toEqual(expect.objectContaining({ ok: true, summary: 'background job requested (202) (manual, platform support)' }));
      expect(new Date(job.rows[0].started_at).getTime()).toBeGreaterThanOrEqual(t0 - 1000);

      // The background function cannot be reached: 502, recorded as a failed run.
      fetchMock.mockRejectedValueOnce(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
      const failed = await run({});
      expect(failed.status).toBe(502);
      expect(failed.body.error).toMatch(/could not be started/);
      const failedJob = await db.query(`SELECT ok, summary FROM job_runs WHERE job = 'demo-refresh' ORDER BY started_at DESC LIMIT 1`);
      expect(failedJob.rows[0]).toEqual({ ok: false, summary: 'could not start the background job (ENOTFOUND) (manual, platform support)' });

      // Turned off: nothing starts.
      process.env.DEMO_REFRESH_ENABLED = 'false';
      fetchMock.mockClear();
      expect((await run({})).status).toBe(409);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = realFetch;
      for (const k of keys) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
    }
  });

  test('OP-012 the modules section returns the stored rows of every analytics module for a team', async () => {
    if (skip()) return;
    await db.query(
      `INSERT INTO technical_debt (id, team_id, title, description, category, severity, status) VALUES ($1, $2, 'Op debt item', 'd', 'code_quality', 'high', 'open')`,
      [`op-debt-${stamp}`, teamId],
    ).catch(() => undefined);
    const res = await call('get', `/api/operator/companies/${companyId}/modules?teamId=${teamId}`, '', token);
    expect(res.status).toBe(200);
    expect(res.body.teamId).toBe(teamId);
    const keys = res.body.modules.map((m: any) => m.key);
    expect(keys).toEqual(expect.arrayContaining(['test_runs', 'flaky_tests', 'technical_debt', 'pipeline_runs', 'performance', 'ddps', 'company_snapshots']));
    for (const m of res.body.modules) expect(m.rows.length).toBeLessThanOrEqual(50);
    // A team of another company is not accepted: the company's first team is used instead.
    const foreign = (await db.query('SELECT id FROM teams WHERE company_id <> $1 LIMIT 1', [companyId])).rows[0]?.id;
    if (foreign) expect((await call('get', `/api/operator/companies/${companyId}/modules?teamId=${foreign}`, '', token)).body.teamId).not.toBe(foreign);
  });

  test('OP-013 operator sign-in is not rate limited: many failed attempts from one IP, then the right password works', async () => {
    if (skip()) return;
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await signIn(`nobody-${i}-${stamp}@nowhere.test`, 'x')).status);
    expect(statuses.every((st) => st === 401)).toBe(true);
    expect((await signIn(opEmail)).status).toBe(200);
  });
});
