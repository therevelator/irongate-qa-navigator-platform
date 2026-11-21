/**
 * Self-serve demo sandbox (/try; server/lib/sandbox.ts, server/lib/sandboxConfig.ts, the gate in
 * server/middleware/auth.ts, POST /api/auth/sandbox in server/routes/authSandbox.ts), against an
 * in-process copy of the API with every route the tests touch, on the local database.
 *
 *   SB-001 GET /api/auth/sandbox lists the four personas (noindex, no-store); the sandbox is built
 *          with the expected organisation (2 departments, 5 teams, fictional people on the reserved domain)
 *          and a year of data in every module, forecasts and recommendations
 *   SB-002 POST /api/auth/sandbox: JSON only (415), a known persona only (400); each persona gets a
 *          session as its shared user with its role; 2-hour token and row, method sandbox, the row keeps
 *          only a keyed hash of the address; /api/auth/me carries the sandbox block
 *   SB-003 no password sign-in for a sandbox user (even with its real hash replaced by a known one), no
 *          reset e-mail, no session through issueSessionCookie (SSO / invitation / re-issue path)
 *   SB-004 every forbidden action answers 403 sandbox_read_only and changes nothing: invitations, user /
 *          role / department / team / company administration, API keys, password and session changes,
 *          user activity and its CSV, Demo Data generators, manual data, pulse sending and e-mail tests,
 *          saved views, free text on actions; operator routes answer 401; an API key of the sandbox is refused
 *   SB-005 allowed: browse (teams, team detail, history, TV mode, summary, improve), dismiss (free text
 *          replaced by a fixed reason), accept (the title is the recommendation's own), reopen, change
 *          an action's status, acknowledge an alert, read notifications; screen views are not recorded
 *   SB-006 no AI provider call for a sandbox session (rule-based answers), even with a provider key set
 *   SB-007 isolation: another company's team, users and data are out of reach
 *   SB-008 no e-mail to a sandbox address, whatever sends it
 *   SB-009 session creation limits: per address an hour (429 with Retry-After), cap on open sessions
 *          (503 sandbox_full), not ready (503 sandbox_preparing)
 *   SB-010 reset: ends every sandbox session, wipes the visitors' changes, gives the same tables
 *          (idempotent), never touches another company; a second reset while one runs is skipped
 *   SB-011 operator: GET /sandbox and POST /sandbox/reset (confirm needed; 401 without an operator
 *          session); the background function ignores a request without the right token
 */
import 'dotenv/config';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import cron from 'node-cron';
import { buildApp } from './helpers/inProcessApp';
import { pool, query, queryOne } from '../../src/lib/db';
import { flushBackgroundWrites } from '../../server/lib/opsLog';
import teamsRoutes from '../../server/routes/teams';
import metricsRoutes from '../../server/routes/metrics';
import usersRoutes from '../../server/routes/users';
import departmentsRoutes from '../../server/routes/departments';
import analyticsRoutes from '../../server/routes/analytics';
import settingsRoutes from '../../server/routes/settings';
import ingestRoutes from '../../server/routes/ingest';
import tvRoutes from '../../server/routes/tv';
import summaryRoutes from '../../server/routes/summary';
import improveRoutes from '../../server/routes/improve';
import targetsRoutes from '../../server/routes/targets';
import savedViewsRoutes from '../../server/routes/savedViews';
import pulseRoutes from '../../server/routes/pulse';
import alertsRoutes from '../../server/routes/alerts';
import notificationsRoutes from '../../server/routes/notifications';
import actionsRoutes from '../../server/routes/actions';
import ciRoutes from '../../server/routes/ci';
import { signOperatorToken, upsertOperator } from '../../server/lib/operator';
import { resetSandbox, sandboxPlan, SANDBOX_RESET_HEADER } from '../../server/lib/sandbox';
import { SANDBOX_COMPANY_ID, SANDBOX_EMAIL_DOMAIN, SANDBOX_PERSONAS, apiPathOf, sandboxVerdict } from '../../server/lib/sandboxConfig';
import { runAsSandbox } from '../../server/lib/sandboxContext';
import { isGroqConfigured } from '../../server/lib/groq';
import { sendMail, setMailerForTests, type MailMessage } from '../../server/lib/mailer';
import { issueSessionCookie } from '../../server/lib/sessions';
import { JWT_SECRET } from '../../server/middleware/auth';
import { hashApiKey } from '../../server/middleware/apiKey';
import resetBackground from '../../netlify/functions/sandbox-reset-background';

jest.setTimeout(240_000);

const app = buildApp((a) => {
  a.use('/api/teams', teamsRoutes);
  a.use('/api/metrics', metricsRoutes);
  a.use('/api/users', usersRoutes);
  a.use('/api/departments', departmentsRoutes);
  a.use('/api/analytics', analyticsRoutes);
  a.use('/api/settings', settingsRoutes);
  a.use('/api/ingest', ingestRoutes);
  a.use('/api/tv', tvRoutes);
  a.use('/api/summary', summaryRoutes);
  a.use('/api/improve', improveRoutes);
  a.use('/api/targets', targetsRoutes);
  a.use('/api/saved-views', savedViewsRoutes);
  a.use('/api/pulse', pulseRoutes);
  a.use('/api/alerts', alertsRoutes);
  a.use('/api/notifications', notificationsRoutes);
  a.use('/api/actions', actionsRoutes);
  a.use('/api/ci', ciRoutes);
});

const stamp = Date.now();
const OP_PW = 'Operator-Test-Passw0rd!';
const opEmail = `sb-op-${stamp}@platform${stamp}.test`;
let opToken = '';
let otherCompany = '';
let otherTeam = '';
let otherUser = '';
const cookies: Record<string, string> = {};
const S = SANDBOX_COMPANY_ID;

const cookieOf = (res: request.Response): string => {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const m = list.map((c: string) => c.match(/irongate_token=([^;]+)/)).find(Boolean);
  return m ? `irongate_token=${m[1]}` : '';
};
const startSession = (persona: string) => request(app).post('/api/auth/sandbox').set('Content-Type', 'application/json').send({ persona });
const as = (who: string) => ({
  get: (p: string) => request(app).get(p).set('Cookie', cookies[who]),
  post: (p: string, b: object = {}) => request(app).post(p).set('Cookie', cookies[who]).send(b),
  put: (p: string, b: object = {}) => request(app).put(p).set('Cookie', cookies[who]).send(b),
  patch: (p: string, b: object = {}) => request(app).patch(p).set('Cookie', cookies[who]).send(b),
  del: (p: string) => request(app).delete(p).set('Cookie', cookies[who]),
});
const one = async (sql: string, params: unknown[] = []) => (await queryOne<any>(sql, params));
const teamIds = () => sandboxPlan().teams.map((t) => t.id);
const clearSessions = () => query('DELETE FROM user_sessions WHERE company_id = ?', [S]);

/** Row counts of every public table (the whole database: a reset must not change anything else). */
async function allCounts(): Promise<Record<string, number>> {
  const tables = (await query<any[]>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).map((r: any) => r.tablename as string);
  const out: Record<string, number> = {};
  for (const t of tables) {
    if (['job_runs', 'server_errors', 'user_activity', 'auth_events', 'platform_operators', 'platform_operator_sessions', 'user_sessions'].includes(t)) continue;
    out[t] = Number((await one(`SELECT count(*)::int AS n FROM "${t}"`)).n);
  }
  return out;
}
const otherCompanyCounts = async () => one(
  `SELECT (SELECT count(*) FROM users WHERE company_id <> $1)::int AS u, (SELECT count(*) FROM teams WHERE company_id <> $1)::int AS t,
          (SELECT count(*) FROM kpi_snapshots k JOIN teams t ON t.id = k.team_id WHERE t.company_id <> $1)::int AS k,
          (SELECT count(*) FROM team_actions WHERE company_id <> $1)::int AS a,
          (SELECT count(*) FROM recommendations WHERE company_id <> $1)::int AS r`, [S]);

beforeAll(async () => {
  process.env.SANDBOX_SESSIONS_PER_IP_HOUR = '1000';
  delete process.env.SANDBOX_MAX_SESSIONS;
  await resetSandbox();
  const opId = (await upsertOperator(opEmail, 'Sandbox Operator', OP_PW)).id;
  const signIn = await request(app).post('/api/operator/login').send({ email: opEmail, password: OP_PW });
  opToken = signIn.body.token ?? signOperatorToken(opId, 'none');
  const other = await one(`SELECT t.id, t.company_id FROM teams t WHERE t.company_id <> $1 AND t.is_active ORDER BY t.id LIMIT 1`, [S]);
  otherTeam = other.id; otherCompany = other.company_id;
  otherUser = (await one(`SELECT id FROM users WHERE company_id = $1 LIMIT 1`, [otherCompany])).id;
}, 120_000);

afterAll(async () => {
  // The analytics routes schedule their daily job on import: stop it so Jest can exit.
  for (const task of cron.getTasks().values()) await task.stop();
  setMailerForTests(null);
  await query('DELETE FROM platform_operators WHERE email = ?', [opEmail]).catch(() => undefined);
  await clearSessions();
  await flushBackgroundWrites(2000);
  await pool.end();
});

describe('Demo sandbox', () => {
  test('SB-001 the /try data and the built organisation', async () => {
    const r = await request(app).get('/api/auth/sandbox');
    expect(r.status).toBe(200);
    expect(r.headers['x-robots-tag']).toMatch(/noindex/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.ready).toBe(true);
    expect(r.body.personas.map((p: any) => p.key)).toEqual(['cto', 'head_of_qa', 'team_lead', 'engineer']);
    expect(r.body.personas.map((p: any) => p.label)).toEqual(['CTO', 'Head of QA', 'Team lead', 'Engineer']);
    expect(r.body.bookDemoUrl).toBe('https://irongate.ie/navigator');
    expect(r.body.startPilotUrl).toBe('https://irongate.ie/navigator/pilot');

    const c = await one(`SELECT name, domain, settings FROM companies WHERE id = $1`, [S]);
    expect(c.name).toBe('Northwind Bank — demo');
    expect(c.domain).toBe(SANDBOX_EMAIL_DOMAIN);
    expect(c.settings.sandbox.state).toBe('ready');
    expect(Number((await one(`SELECT count(*) AS n FROM departments WHERE company_id = $1`, [S])).n)).toBe(2);
    expect(Number((await one(`SELECT count(*) AS n FROM teams WHERE company_id = $1`, [S])).n)).toBe(5);
    // Every person is on the reserved domain; never a Meridian or other company address.
    const badEmail = await one(`SELECT count(*)::int AS n FROM users WHERE company_id = $1 AND email NOT LIKE $2`, [S, `%@${SANDBOX_EMAIL_DOMAIN}`]);
    expect(badEmail.n).toBe(0);
    const roles = await query<any[]>(`SELECT role, scope_type, count(*)::int AS n FROM role_assignments WHERE company_id = ? AND revoked_at IS NULL GROUP BY 1, 2 ORDER BY 1, 2`, [S]);
    expect(roles).toEqual(expect.arrayContaining([
      { role: 'super_admin', scope_type: 'company', n: 1 }, { role: 'qa_manager', scope_type: 'department', n: 2 },
      { role: 'team_lead', scope_type: 'team', n: 5 }, { role: 'viewer', scope_type: 'team', n: 5 },
    ]));
    // A year of every module, v2 raw evidence, forecasts, recommendations, action plans with history, business impact, financial settings.
    const T = teamIds();
    const has = async (sql: string) => Number((await one(sql, [T])).n);
    expect(await has(`SELECT count(DISTINCT team_id) AS n FROM kpi_snapshots WHERE team_id = ANY($1::text[]) AND snapshot_date <= current_date - 360`)).toBe(5);
    // Recommendations: every team but possibly the strongest one (nothing to recommend there).
    expect(await has(`SELECT count(DISTINCT team_id) AS n FROM recommendations WHERE team_id = ANY($1::text[])`)).toBeGreaterThanOrEqual(4);
    for (const table of ['test_runs', 'coverage_reports', 'pipeline_runs_raw', 'deployments_raw', 'incidents_raw', 'issues', 'analysis_reports', 'forecasts',
      'team_actions', 'business_impact_quality_metrics', 'business_impact_business_kpis', 'pulse_responses', 'alerts']) {
      expect([table, await has(`SELECT count(DISTINCT team_id) AS n FROM ${table} WHERE team_id = ANY($1::text[])`)]).toEqual([table, 5]);
    }
    expect(await has(`SELECT count(*) AS n FROM team_action_events e JOIN team_actions a ON a.id = e.action_id WHERE a.team_id = ANY($1::text[])`)).toBeGreaterThan(0);
    expect(Number((await one(`SELECT count(*) AS n FROM configs WHERE company_id = $1 AND config_key IN ('developer_hourly_rate', 'support_ticket_cost', 'sla_breach_penalty')`, [S])).n)).toBeGreaterThanOrEqual(1);
  });

  test('SB-002 a session per persona: shared user, role, two hours, hashed address only', async () => {
    expect((await request(app).post('/api/auth/sandbox').type('form').send({ persona: 'cto' })).status).toBe(415);
    expect((await startSession('admin')).status).toBe(400);
    const expected: Record<string, string> = { cto: 'super_admin', head_of_qa: 'qa_manager', team_lead: 'team_lead', engineer: 'qa_engineer' };
    for (const key of Object.keys(expected)) {
      const r = await startSession(key);
      expect(r.status).toBe(201);
      expect(r.headers['x-robots-tag']).toMatch(/noindex/);
      cookies[key] = cookieOf(r);
      expect(cookies[key]).toBeTruthy();
      // A browser-session cookie (no Max-Age / Expires).
      const raw = ([] as string[]).concat(r.headers['set-cookie'] as any).find((c) => c.startsWith('irongate_token='))!;
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).not.toMatch(/Max-Age|Expires/i);
      const me = await as(key).get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.user.id).toBe(SANDBOX_PERSONAS[key as keyof typeof SANDBOX_PERSONAS].userId);
      expect(me.body.user.role).toBe(expected[key]);
      expect(me.body.user.company_id).toBe(S);
      expect(me.body.user.sandbox.persona).toBe(key);
      expect(me.body.user.sandbox.bookDemoUrl).toBe('https://irongate.ie/navigator');
      const token = cookies[key].split('=')[1];
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      expect(decoded.exp - decoded.iat).toBe(2 * 3600);
      const row = await one(`SELECT method, ip, last_ip, country, city, user_agent, browser, expires_at - issued_at AS life FROM user_sessions WHERE id = $1`, [decoded.jti]);
      expect(row.method).toBe('sandbox');
      expect(row.ip).toMatch(/^sbx:[0-9a-f]{56}$/);
      expect(row.last_ip).toBe(row.ip);
      expect([row.country, row.city, row.user_agent, row.browser]).toEqual([null, null, null, null]);
      expect(row.life.hours).toBe(2);
    }
    // Head of QA manages both departments: every team of the company is in scope.
    expect((await as('head_of_qa').get('/api/teams')).body.teams).toHaveLength(5);
    expect((await as('engineer').get('/api/teams')).body.teams).toHaveLength(1);
  });

  test('SB-003 no password, reset, SSO or invitation sign-in for a sandbox user', async () => {
    const cto = SANDBOX_PERSONAS.cto;
    const email = (await one('SELECT email FROM users WHERE id = $1', [cto.userId])).email;
    const original = (await one('SELECT password_hash FROM users WHERE id = $1', [cto.userId])).password_hash;
    // Even when the hash matches a known password, the sign-in is refused.
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash('Known-Passw0rd!', 4), cto.userId]);
    const r = await request(app).post('/api/auth/login').send({ email, password: 'Known-Passw0rd!' });
    expect(r.status).toBe(401);
    expect(cookieOf(r)).toBe('');
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [original, cto.userId]);
    const ev = await one(`SELECT failure_reason FROM auth_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [cto.userId]);
    expect(ev.failure_reason).toBe('sandbox_account');
    // Forgot password: the same answer as always, and no reset row.
    const before = Number((await one('SELECT count(*) AS n FROM password_resets WHERE user_id = $1', [cto.userId])).n);
    expect((await request(app).post('/api/auth/forgot-password').send({ email })).status).toBe(200);
    expect(Number((await one('SELECT count(*) AS n FROM password_resets WHERE user_id = $1', [cto.userId])).n)).toBe(before);
    // The shared path of SSO, invitation and re-issued cookies refuses a sandbox user.
    const fakeRes: any = { req: undefined, cookie: jest.fn() };
    await expect(issueSessionCookie(fakeRes, cto.userId, JWT_SECRET, { method: 'sso_google' })).rejects.toThrow(/Sandbox/);
    expect(fakeRes.cookie).not.toHaveBeenCalled();
  });

  test('SB-004 every forbidden action is refused on the server and changes nothing', async () => {
    const T = teamIds();
    const team = T[0];
    const someUser = (await one(`SELECT id FROM users WHERE company_id = $1 AND role = 'qa_engineer' AND id <> $2 LIMIT 1`, [S, SANDBOX_PERSONAS.engineer.userId])).id;
    const dept = (await one(`SELECT id FROM departments WHERE company_id = $1 LIMIT 1`, [S])).id;
    const action = (await one(`SELECT id FROM team_actions WHERE company_id = $1 LIMIT 1`, [S])).id;
    const before = { users: Number((await one('SELECT count(*) AS n FROM users WHERE company_id = $1', [S])).n), counts: await allCounts() };
    const refused: Array<[string, () => request.Test]> = [
      // e-mails and invitations
      ['invite', () => as('cto').post('/api/admin/invitations', { email: `x${stamp}@example.com`, role: 'viewer', scopeId: team })],
      ['send reset link', () => as('cto').post(`/api/admin/users/${someUser}/send-reset-link`)],
      ['pulse send', () => as('cto').post(`/api/pulse/teams/${team}/send`)],
      ['pulse remind', () => as('cto').post(`/api/pulse/teams/${team}/remind`)],
      ['digest test', () => as('cto').post('/api/notifications/digest/test')],
      ['slack test', () => as('cto').post('/api/notifications/settings/slack-test')],
      // user / role / company / department administration
      ['create user', () => as('cto').post('/api/admin/users', { email: `y${stamp}@${SANDBOX_EMAIL_DOMAIN}`, password: 'Passw0rd!2024', firstName: 'A', lastName: 'B', role: 'viewer', teamId: team })],
      ['edit user', () => as('cto').put(`/api/admin/users/${someUser}`, { firstName: 'Changed' })],
      ['toggle user', () => as('cto').post(`/api/admin/users/${someUser}/toggle-status`)],
      ['delete user', () => as('cto').del(`/api/admin/users/${someUser}`)],
      ['give assignment', () => as('cto').post(`/api/admin/users/${someUser}/assignments`, { role: 'super_admin', scopeType: 'company' })],
      ['create department', () => as('cto').post('/api/admin/departments', { name: 'Hacked' })],
      ['edit department', () => as('cto').put(`/api/admin/departments/${dept}`, { name: 'Hacked' })],
      ['delete department', () => as('cto').del(`/api/admin/departments/${dept}`)],
      ['create team', () => as('cto').post('/api/admin/teams', { name: 'Hacked', departmentId: dept })],
      ['edit team', () => as('cto').put(`/api/admin/teams/${team}`, { name: 'Hacked' })],
      ['delete team', () => as('cto').del(`/api/admin/teams/${team}`)],
      ['session settings', () => as('cto').put('/api/admin/session-settings', { hours: 720 })],
      ['company config', () => as('cto').post('/api/admin/configs', { key: 'x', value: '1' })],
      ['targets', () => as('cto').put('/api/targets', { scopeType: 'company', targets: [] })],
      ['alert rules', () => as('cto').put('/api/alerts/rules', { scopeType: 'company', rules: [] })],
      ['metric intervals', () => as('cto').put('/api/settings/metric-intervals', {})],
      ['undo change', () => as('cto').post('/api/admin/audit/x/undo')],
      // API keys
      ['list API keys', () => as('cto').get('/api/admin/api-keys')],
      ['create API key', () => as('cto').post('/api/admin/api-keys', { name: 'k' })],
      // SSO / password / sessions
      ['own profile and password', () => as('cto').put(`/api/users/${SANDBOX_PERSONAS.cto.userId}`, { password: 'Passw0rd!2024', currentPassword: 'x' })],
      ['reset password of a user', () => as('cto').post(`/api/admin/users/${someUser}/reset-password`, { password: 'Passw0rd!2024' })],
      ['sign out others', () => as('cto').post('/api/auth/sessions/sign-out-others')],
      ['sign out everywhere', () => as('cto').post(`/api/admin/users/${someUser}/sign-out-everywhere`)],
      // exports of personal data
      ['user activity', () => as('cto').get('/api/activity/log')],
      ['user activity CSV', () => as('cto').get('/api/activity/log.csv')],
      // Demo Data / Populate generators and data entry
      ['seed data', () => as('cto').post('/api/analytics/seed-data')],
      ['generate business data', () => as('cto').post(`/api/analytics/business-impact-v2/${team}/generate-realistic-data`)],
      ['manual metrics', () => as('cto').post('/api/metrics/manual', { teamId: team, metrics: { test_coverage: 1 } })],
      ['team create (teams route)', () => as('cto').post('/api/teams', { name: 'Hacked' })],
      ['saved view', () => as('cto').post('/api/saved-views', { name: 'Defaced', state: {} })],
      ['pulse answer', () => as('engineer').post(`/api/pulse/teams/${team}/responses`, { answers: {} })],
      // free text that the next visitor would see
      ['new action', () => as('cto').post('/api/actions', { teamId: team, title: 'Visit evil.example' })],
      ['action title', () => as('cto').patch(`/api/actions/${action}`, { title: 'Visit evil.example' })],
      ['action status and title', () => as('cto').patch(`/api/actions/${action}`, { status: 'done', title: 'Defaced' })],
      ['delete action', () => as('cto').del(`/api/actions/${action}`)],
    ];
    for (const [label, call] of refused) {
      const r = await call();
      expect([label, r.status, r.body?.code]).toEqual([label, 403, 'sandbox_read_only']);
    }
    // Operator routes: a sandbox session is not an operator session.
    expect((await as('cto').get('/api/operator/overview')).status).toBe(401);
    expect((await as('cto').post(`/api/operator/companies/${S}/demo-data`, { departments: 1, teamsPerDepartment: 1, membersPerTeam: 3 })).status).toBe(401);
    expect((await as('cto').post('/api/operator/sandbox/reset', { confirm: true })).status).toBe(401);
    // An API key of the sandbox company (whoever knew it) is refused.
    const key = `igk_sandboxtest${stamp}`;
    await query(`INSERT INTO api_keys (id, company_id, name, key_prefix, key_hash) VALUES (?, ?, 'test', 'igk_test', ?)`, [`sb-key-${stamp}`, S, hashApiKey(key)]);
    const ing = await request(app).post('/api/ingest/kpis').set('Authorization', `Bearer ${key}`).send({ teamId: team, metrics: { test_coverage: 50 } });
    expect([ing.status, ing.body.code]).toEqual([403, 'sandbox_read_only']);
    await query('DELETE FROM api_keys WHERE id = ?', [`sb-key-${stamp}`]);
    // Nothing changed.
    expect(Number((await one('SELECT count(*) AS n FROM users WHERE company_id = $1', [S])).n)).toBe(before.users);
    expect(await allCounts()).toEqual(before.counts);
  });

  test('SB-005 browsing and the few allowed changes work; free text is replaced', async () => {
    const T = teamIds();
    const mobile = T[0];
    for (const p of ['/api/teams', `/api/teams/${mobile}`, `/api/teams/${mobile}/kpi-history`, '/api/tv/teams', '/api/summary', `/api/improve/teams/${mobile}`,
      `/api/ci/teams/${mobile}/evidence`, `/api/ci/teams/${mobile}/delivery`, `/api/ci/teams/${mobile}/work`, '/api/notifications', '/api/admin/users', '/api/departments']) {
      const r = await as('cto').get(p);
      expect([p, r.status]).toEqual([p, 200]);
    }
    expect((await as('team_lead').get(`/api/teams/${mobile}`)).status).toBe(200);

    const recs = await query<any[]>(`SELECT id, title FROM recommendations WHERE company_id = ? AND team_id = ? AND status = 'open' ORDER BY rank LIMIT 2`, [S, mobile]);
    expect(recs.length).toBe(2);
    const dismissed = await as('team_lead').post(`/api/improve/recommendations/${recs[0].id}/dismiss`, { reason: 'Visit evil.example for a prize' });
    expect(dismissed.status).toBe(200);
    expect((await one('SELECT status, dismiss_reason FROM recommendations WHERE id = $1', [recs[0].id]))).toEqual({ status: 'dismissed', dismiss_reason: 'Other' });
    expect((await as('team_lead').post(`/api/improve/recommendations/${recs[0].id}/reopen`)).status).toBe(200);
    const accepted = await as('team_lead').post(`/api/improve/recommendations/${recs[1].id}/accept`, { title: 'Defaced title' });
    expect(accepted.status).toBe(201);
    const act = await one('SELECT title, status FROM team_actions WHERE id = $1', [accepted.body.actionId]);
    expect(act.title).not.toMatch(/Defaced/);
    // Change the status of an action (team lead), and the engineer of one they own.
    const status = await as('team_lead').patch(`/api/actions/${accepted.body.actionId}`, { status: 'in_progress' });
    expect(status.status).toBe(200);
    expect((await one('SELECT status FROM team_actions WHERE id = $1', [accepted.body.actionId])).status).toBe('in_progress');
    const alert = await one(`SELECT id FROM alerts WHERE company_id = $1 AND team_id = $2 AND resolved_at IS NULL AND acknowledged_at IS NULL LIMIT 1`, [S, mobile]);
    if (alert) expect((await as('team_lead').post(`/api/alerts/${alert.id}/acknowledge`)).status).toBe(200);
    expect((await as('cto').post('/api/notifications/read-all')).status).toBe(200);
    // Screen views are acknowledged and not recorded (nothing of a sandbox session goes to user activity).
    const ua = Number((await one('SELECT count(*) AS n FROM user_activity WHERE company_id = $1', [S])).n);
    expect((await as('cto').post('/api/activity/screen', { events: [{ screen: 'dashboard' }] })).status).toBe(204);
    await flushBackgroundWrites(2000);
    expect(Number((await one('SELECT count(*) AS n FROM user_activity WHERE company_id = $1', [S])).n)).toBe(ua);
  });

  test('SB-006 no AI provider call in a sandbox session', async () => {
    const saved = process.env.GROQ_API_KEY;
    const realFetch = global.fetch;
    const calls: string[] = [];
    process.env.GROQ_API_KEY = 'gsk_test_key_that_is_long_enough';
    global.fetch = (async (input: any, init?: any) => {
      calls.push(String(input));
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      expect(isGroqConfigured()).toBe(true);
      expect(runAsSandbox(S, () => isGroqConfigured())).toBe(false);
      const team = teamIds()[0];
      const ai = await as('cto').post(`/api/analytics/business-impact-v2/${team}/ai-analysis`);
      expect(ai.status).toBe(200);
      expect(ai.body.source).toBe('rules');
      const sug = await as('cto').get(`/api/teams/${team}/ai-suggestions`);
      expect(sug.status).toBe(200);
      expect(calls.filter((u) => u.includes('groq'))).toEqual([]);
    } finally {
      global.fetch = realFetch;
      if (saved === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = saved;
    }
  });

  test('SB-007 isolation from every other company', async () => {
    const teams = (await as('cto').get('/api/teams')).body.teams.map((t: any) => t.id).sort();
    expect(teams).toEqual(teamIds().sort());
    for (const p of [`/api/teams/${otherTeam}`, `/api/teams/${otherTeam}/kpi-history`, `/api/improve/teams/${otherTeam}`, `/api/ci/teams/${otherTeam}/evidence`, `/api/tv/teams/${otherTeam}`]) {
      const r = await as('cto').get(p);
      expect([p, r.status < 300]).toEqual([p, false]);
    }
    expect((await as('cto').get(`/api/admin/users/${otherUser}/assignments`)).status).toBeGreaterThanOrEqual(400);
    const users = (await as('cto').get('/api/admin/users')).body;
    const list = Array.isArray(users) ? users : users.users ?? [];
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((u: any) => (u.company_id ?? u.companyId ?? S) === S)).toBe(true);
    expect(JSON.stringify(list)).not.toContain(otherCompany);
  });

  test('SB-008 no e-mail to a sandbox address, whatever sends it', async () => {
    const sent: MailMessage[] = [];
    setMailerForTests({ channel: 'smtp', send: async (m) => { sent.push(m); return { delivered: true, channel: 'smtp' }; } });
    try {
      const r = await sendMail({ to: `alex.morgan@${SANDBOX_EMAIL_DOMAIN}`, subject: 'x', text: 'x' });
      expect(r.delivered).toBe(false);
      expect(sent).toHaveLength(0);
      await sendMail({ to: 'someone@example.com', subject: 'x', text: 'x' });
      expect(sent).toHaveLength(1);
    } finally {
      setMailerForTests(null);
    }
  });

  test('SB-009 session limits: per address, open sessions, not ready', async () => {
    await clearSessions();
    process.env.SANDBOX_SESSIONS_PER_IP_HOUR = '3';
    try {
      for (let i = 0; i < 3; i++) expect((await startSession('cto')).status).toBe(201);
      const limited = await startSession('engineer');
      expect([limited.status, limited.body.code]).toEqual([429, 'sandbox_rate_limited']);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(cookieOf(limited)).toBe('');
    } finally {
      process.env.SANDBOX_SESSIONS_PER_IP_HOUR = '1000';
    }
    process.env.SANDBOX_MAX_SESSIONS = '3';
    try {
      const full = await startSession('cto');
      expect([full.status, full.body.code]).toEqual([503, 'sandbox_full']);
    } finally {
      delete process.env.SANDBOX_MAX_SESSIONS;
    }
    await query(`UPDATE companies SET settings = jsonb_set(settings, '{sandbox,state}', '"building"') WHERE id = ?`, [S]);
    try {
      const busy = await startSession('cto');
      expect([busy.status, busy.body.code]).toEqual([503, 'sandbox_preparing']);
      expect((await request(app).get('/api/auth/sandbox')).body.ready).toBe(false);
    } finally {
      await query(`UPDATE companies SET settings = jsonb_set(settings, '{sandbox,state}', '"ready"') WHERE id = ?`, [S]);
    }
    await clearSessions();
  });

  test('SB-010 the reset ends sessions, wipes changes, is idempotent and touches nothing else', async () => {
    const s = await startSession('team_lead');
    const cookie = cookieOf(s);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
    const mobile = teamIds()[0];
    const rec = await one(`SELECT id FROM recommendations WHERE company_id = $1 AND team_id = $2 AND status = 'open' ORDER BY rank LIMIT 1`, [S, mobile]);
    await request(app).post(`/api/improve/recommendations/${rec.id}/dismiss`).set('Cookie', cookie).send({ reason: 'Other' });
    expect(Number((await one(`SELECT count(*) AS n FROM recommendations WHERE company_id = $1 AND status <> 'open'`, [S])).n)).toBeGreaterThan(0);

    const others = await otherCompanyCounts();
    const r1 = await resetSandbox();
    expect(r1.skipped).toBeUndefined();
    expect(r1.sessionsEnded).toBeGreaterThanOrEqual(1);
    const after1 = await allCounts();
    // The visitor's session is gone and every change with it.
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBeGreaterThanOrEqual(401);
    expect(Number((await one(`SELECT count(*) AS n FROM recommendations WHERE company_id = $1 AND status <> 'open'`, [S])).n)).toBe(0);
    // Idempotent: a second reset gives the same tables.
    const r2 = await resetSandbox();
    expect(r2.existed).toBe(true);
    expect(await allCounts()).toEqual(after1);
    expect(await otherCompanyCounts()).toEqual(others);
    // Dates are current: the last KPI day is today.
    const last = await one(`SELECT max(snapshot_date)::text AS d FROM kpi_snapshots WHERE team_id = ANY($1::text[])`, [teamIds()]);
    expect(last.d).toBe(new Date().toISOString().slice(0, 10));
    // A second reset while one is running is skipped (the advisory lock).
    const [a, b] = await Promise.all([resetSandbox(), new Promise((res) => setTimeout(res, 150)).then(() => resetSandbox())]);
    expect([a.skipped ?? false, b.skipped ?? false].sort()).toEqual([false, true]);
  });

  test('SB-011 operator: status, Reset sandbox now, background function token', async () => {
    const op = (m: 'get' | 'post', p: string, body?: object, tok = opToken) => {
      let r = request(app)[m](`/api/operator${p}`);
      if (tok) r = r.set('X-Operator-Token', tok);
      return body ? r.send(body) : r;
    };
    expect((await op('get', '/sandbox', undefined, '')).status).toBe(401);
    const st = await op('get', '/sandbox');
    expect(st.status).toBe(200);
    expect(st.body.sandbox).toMatchObject({ companyId: S, state: 'ready', teams: 5 });
    const overview = await op('get', '/overview');
    expect(overview.body.companies.some((c: any) => c.id === S)).toBe(true);
    expect((await op('post', '/sandbox/reset', {})).status).toBe(400);
    const done = await op('post', '/sandbox/reset', { confirm: true });
    expect(done.status).toBe(200);
    expect(done.body.mode).toBe('direct');
    expect(done.body.result.teams).toBe(5);
    expect(done.body.sandbox.state).toBe('ready');
    // The background function does nothing without the right token.
    const runsBefore = Number((await one(`SELECT count(*) AS n FROM job_runs WHERE job = 'sandbox-reset-background'`)).n);
    await resetBackground(new Request('http://localhost/.netlify/functions/sandbox-reset-background', { method: 'POST', headers: { [SANDBOX_RESET_HEADER]: 'wrong' } }));
    expect(Number((await one(`SELECT count(*) AS n FROM job_runs WHERE job = 'sandbox-reset-background'`)).n)).toBe(runsBefore);
  });

  test('SB-012 the request rules (pure)', () => {
    expect(apiPathOf('/.netlify/functions/api/teams?x=1')).toBe('/api/teams');
    expect(apiPathOf('/teams/abc/')).toBe('/api/teams/abc');
    expect(apiPathOf('/api//admin/api-keys')).toBe('/api/admin/api-keys');
    expect(sandboxVerdict('GET', '/api/teams')).toBe('allow');
    expect(sandboxVerdict('GET', '/api/admin/api-keys')).toBe('refuse');
    expect(sandboxVerdict('GET', '/api/activity/log.csv')).toBe('refuse');
    expect(sandboxVerdict('POST', '/api/improve/recommendations/abc/accept')).toBe('allow');
    expect(sandboxVerdict('POST', '/api/improve/recommendations/abc/accept/x')).toBe('refuse');
    expect(sandboxVerdict('PATCH', '/api/actions/abc')).toBe('allow');
    expect(sandboxVerdict('DELETE', '/api/actions/abc')).toBe('refuse');
    expect(sandboxVerdict('POST', '/api/activity/screen')).toBe('noop');
    expect(sandboxVerdict('PUT', '/api/users/abc')).toBe('refuse');
  });
});
