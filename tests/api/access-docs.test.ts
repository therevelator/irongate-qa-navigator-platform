/**
 * The documented access rules (docs/ROLE_ACCESS.md, docs/ADMIN_PANEL_GUIDE.md, docs/SECURITY_REVIEW.md),
 * through the Netlify function in-process (NETLIFY set, as on the live site) and the local database.
 *
 *   DOCACC-001 Team detail members table: software engineers and viewers get their own row only
 *              (ROLE_ACCESS "Team detail: members table"); leads, managers and super admins every member
 *   DOCACC-002 POST /api/admin/configs: a manager is refused for a team of another department and for
 *              a team without a department (ROLE_ACCESS "Parameters")
 *   DOCACC-003 Expected update frequency (company-wide values): super admins only, managers 403
 *              (ROLE_ACCESS "company-wide values stay the super admin's")
 *   DOCACC-004 Technical-debt ROI inputs: a team lead may enter them for the teams they lead, not for
 *              others; a manager only for their departments' teams (ADMIN_PANEL_GUIDE "Manual metrics")
 *   DOCACC-005 Directory: GET /api/admin/teams and /admin/departments only for people who manage
 *              users; GET /api/departments and /:id only the departments in the caller's scope
 *   DOCACC-006 Developer recommendations (GET /api/teams/:id/developer-ai-suggestions): engineers and
 *              viewers 403, leads allowed (ROLE_ACCESS "AI insights and developer recommendations")
 *   DOCACC-007 Generated business-impact sample data: super admins of a sample company only
 *   DOCACC-008 On the hosted runtime the session cookie is Secure and SameSite=Strict, and demo
 *              credentials are offered only with an explicit DEMO_MODE=true
 *   DOCACC-009 The one-time re-encryption (npm run secrets:reencrypt) makes a webhook stored with the
 *              former development constant readable with the current key
 */
import 'dotenv/config';
import { execFile } from 'child_process';
import bcrypt from 'bcrypt';
import type { Client } from 'pg';
import { NEW_PW, localDb } from './helpers/http';

// As on Netlify: NETLIFY set (production runtime), no cron jobs, a rate limit the suite stays under.
process.env.NETLIFY = 'true';
process.env.API_RATE_LIMIT_MAX = '100000';
process.env.ENABLE_SYNTHETIC_DATA = 'true';
// The hosted runtime refuses a missing or weak signing secret: give the in-process function one.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) process.env.JWT_SECRET = 'docacc-test-signing-secret-0123456789abcdef';
delete process.env.DEMO_MODE;
delete process.env.SETTINGS_ENCRYPTION_KEY; // the Slack key is then derived from JWT_SECRET (the documented default)

jest.mock('node-cron', () => ({
  __esModule: true,
  default: { schedule: () => ({ stop() {} }) },
  schedule: () => ({ stop() {} }),
}));
jest.setTimeout(120_000);

const stamp = Date.now();
const mail = (who: string, dom = 'a') => `${who}-${stamp}@docacc${dom}${stamp}.test`;

type Res = { status: number; body: any; cookie: string; setCookie: string[] };
let handler: (event: any, context: any) => Promise<any>;
let db: Client;

async function api(method: string, path: string, cookie = '', body?: object): Promise<Res> {
  const [p, q = ''] = path.split('?');
  const res = await handler({
    httpMethod: method, path: p, rawUrl: `https://example.test${path}`, rawQuery: q,
    queryStringParameters: Object.fromEntries(new URLSearchParams(q)), multiValueQueryStringParameters: {},
    headers: {
      'content-type': 'application/json', 'user-agent': 'docacc-test', 'x-nf-client-connection-ip': '203.0.113.21',
      ...(cookie ? { cookie } : {}),
    },
    multiValueHeaders: {}, body: body ? JSON.stringify(body) : null, isBase64Encoded: false,
  }, {});
  const setCookie: string[] = ([] as string[]).concat(res.multiValueHeaders?.['set-cookie'] ?? res.headers?.['set-cookie'] ?? []);
  const c = (setCookie.find((x) => x.startsWith('irongate_token=')) ?? '').split(';')[0];
  let parsed: any = null;
  try { parsed = res.body ? JSON.parse(res.body) : null; } catch { parsed = res.body; }
  return { status: res.statusCode, body: parsed, cookie: c, setCookie };
}
const login = (email: string, password = NEW_PW) => api('POST', '/api/auth/login', '', { email, password });

const ids: Record<string, string> = {};
const cookies: Record<string, string> = {};
let companyA = '';
const companyS = `demo-docacc-${stamp}`;
let teamS = '';
let loginSetCookie: string[] = [];

async function userId(email: string) {
  return (await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email])).rows[0]?.id as string;
}
async function createUser(key: string, role: string, opts: { teamId?: string; departmentId?: string }) {
  const r = await api('POST', '/api/admin/users', cookies.owner, { email: mail(key), password: NEW_PW, firstName: key, lastName: 'Doc', role, ...opts });
  if (r.status !== 201) throw new Error(`create ${key}: ${r.status} ${JSON.stringify(r.body)}`);
  ids[key] = await userId(mail(key));
}
async function createTeam(name: string, departmentId: string) {
  const r = await api('POST', '/api/admin/teams', cookies.owner, { name, departmentId });
  if (r.status !== 201 && r.status !== 200) throw new Error(`team ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  return (await db.query('SELECT id FROM teams WHERE company_id = $1 AND name = $2', [companyA, name])).rows[0].id as string;
}
async function sampleUser(key: string, role: string, grant: { scope: 'company' | 'team'; id: string }, deptS: string) {
  const hash = await bcrypt.hash(NEW_PW, 10);
  const id = (await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
     VALUES (gen_random_uuid()::text, $1, $2, $3, 'Doc', $4, $5, $6, $7, true, true) RETURNING id`,
    [mail(key, 's'), hash, key, role, companyS, deptS, teamS])).rows[0].id;
  await db.query(`INSERT INTO role_assignments (company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4, $5)`, [companyS, id, role, grant.scope, grant.id]);
  const r = await login(mail(key, 's'));
  if (r.status !== 200) throw new Error(`login ${key}: ${r.status} ${JSON.stringify(r.body)}`);
  cookies[key] = r.cookie;
}

beforeAll(async () => {
  db = await localDb(); // throws (suite fails) without the local database
  ({ handler } = await import('../../netlify/functions/api'));

  const reg = await api('POST', '/api/auth/register', '', {
    email: mail('owner'), password: NEW_PW, firstName: 'Owner', lastName: 'Doc', companyName: `Doc Access ${stamp}`, departmentName: 'D1', teamName: `T1-${stamp}`,
  });
  if (reg.status !== 201 && reg.status !== 200) throw new Error(`register: ${reg.status} ${JSON.stringify(reg.body)}`);
  cookies.owner = reg.cookie;
  companyA = reg.body.user.company_id;
  ids.D1 = reg.body.user.department_id;
  ids.T1 = reg.body.user.primary_team_id;
  ids.D2 = (await api('POST', '/api/admin/departments', cookies.owner, { name: `D2 ${stamp}` })).body.id;
  ids.T2 = await createTeam(`T2-${stamp}`, ids.D2);

  await createUser('m1', 'qa_manager', { departmentId: ids.D1 });
  await createUser('l1', 'team_lead', { teamId: ids.T1 });
  await createUser('e1', 'qa_engineer', { teamId: ids.T1 });
  await createUser('peer', 'qa_engineer', { teamId: ids.T1 });
  await createUser('v1', 'viewer', { teamId: ids.T1 });
  await createUser('l2', 'team_lead', { teamId: ids.T2 });
  for (const k of ['m1', 'l1', 'e1', 'v1']) {
    const r = await login(mail(k));
    if (r.status !== 200) throw new Error(`login ${k}: ${r.status}`);
    cookies[k] = r.cookie;
    if (k === 'e1') loginSetCookie = r.setCookie;
  }

  // Technical-debt items of T1 and T2.
  for (const k of ['T1', 'T2']) {
    ids[`debt${k}`] = (await db.query(
      `INSERT INTO technical_debt (team_id, company_id, title, severity, status) VALUES ($1, $2, $3, 'high', 'open') RETURNING id`,
      [ids[k], companyA, `Doc debt ${k} ${stamp}`])).rows[0].id;
  }

  // Sample company S ('demo-' id): a super admin and a team lead.
  await db.query(`INSERT INTO companies (id, name, domain, is_active) VALUES ($1, $2, $3, true)`, [companyS, `Doc Sample ${stamp}`, `docs${stamp}.test`]);
  const deptS = (await db.query(`INSERT INTO departments (company_id, name) VALUES ($1, 'DS') RETURNING id`, [companyS])).rows[0].id;
  teamS = (await db.query(`INSERT INTO teams (company_id, department_id, name, is_active) VALUES ($1, $2, $3, true) RETURNING id`, [companyS, deptS, `TS-${stamp}`])).rows[0].id;
  await sampleUser('sadmin', 'super_admin', { scope: 'company', id: companyS }, deptS);
  await sampleUser('slead', 'team_lead', { scope: 'team', id: teamS }, deptS);
});

afterAll(async () => {
  if (db) {
    for (const c of [companyA, companyS].filter(Boolean)) await db.query('DELETE FROM companies WHERE id = $1', [c]).catch(() => undefined);
    await db.end();
  }
  const { flushBackgroundWrites } = await import('../../server/lib/opsLog');
  await flushBackgroundWrites(500);
  const { pool } = await import('../../src/lib/db');
  await pool.end();
});

test('DOCACC-001 members table: engineers and viewers get their own row only', async () => {
  for (const k of ['e1', 'v1']) {
    const r = await api('GET', `/api/teams/${ids.T1}`, cookies[k]);
    expect(r.status).toBe(200);
    expect({ k, ids: r.body.team.members.map((m: any) => m.id) }).toEqual({ k, ids: [ids[k]] });
    expect(JSON.stringify(r.body.team.members)).not.toContain(mail('peer'));
  }
  for (const k of ['l1', 'm1', 'owner']) {
    const r = await api('GET', `/api/teams/${ids.T1}`, cookies[k]);
    expect(r.status).toBe(200);
    const got = r.body.team.members.map((m: any) => m.id);
    expect(got).toEqual(expect.arrayContaining([ids.l1, ids.e1, ids.peer, ids.v1]));
  }
  // The header facts (count, the lead's name) stay for everyone with the team in scope.
  const e = await api('GET', `/api/teams/${ids.T1}`, cookies.e1);
  expect(e.body.team.teamLeads.map((p: any) => p.name)).toEqual(['l1 Doc']);
});

test('DOCACC-002 configs: a manager may not write a team of another department, nor one without a department', async () => {
  const body = (teamId: string) => ({ teamId, configs: { sla_error_rate_percent: '3' } });
  expect((await api('POST', '/api/admin/configs', cookies.m1, body(ids.T1))).status).toBe(200);
  expect((await api('POST', '/api/admin/configs', cookies.m1, body(ids.T2))).status).toBe(403);
  expect((await api('POST', '/api/admin/configs', cookies.m1, { departmentId: ids.D2, configs: { sla_error_rate_percent: '3' } })).status).toBe(403);

  // A team without a department (the schema requires one today; legacy rows or a later schema change
  // must not open a hole): dropped NOT NULL only for this test, restored afterwards.
  const loose = `docacc-nodept-${stamp}`;
  await db.query('ALTER TABLE teams ALTER COLUMN department_id DROP NOT NULL');
  try {
    await db.query(`INSERT INTO teams (id, company_id, department_id, name, is_active) VALUES ($1, $2, NULL, $3, true)`, [loose, companyA, `No dept ${stamp}`]);
    const r = await api('POST', '/api/admin/configs', cookies.m1, body(loose));
    expect(r.status).toBe(403);
    const stored = await db.query('SELECT count(*)::int AS n FROM configs WHERE team_id = $1', [loose]);
    expect(stored.rows[0].n).toBe(0);
    expect((await api('POST', '/api/admin/configs', cookies.owner, body(loose))).status).toBe(200);
  } finally {
    await db.query('DELETE FROM configs WHERE team_id = $1', [loose]);
    await db.query('DELETE FROM teams WHERE id = $1', [loose]);
    await db.query('ALTER TABLE teams ALTER COLUMN department_id SET NOT NULL');
  }
});

test('DOCACC-003 expected update frequency: company-wide values, super admins only', async () => {
  const one = { interval_value: 3, interval_unit: 'days' };
  expect((await api('PUT', '/api/settings/metric-intervals/test_coverage', cookies.m1, one)).status).toBe(403);
  expect((await api('PUT', '/api/settings/metric-intervals', cookies.m1, { intervals: [{ metric_key: 'test_coverage', ...one }] })).status).toBe(403);
  expect((await api('DELETE', '/api/settings/metric-intervals/test_coverage', cookies.m1)).status).toBe(403);
  expect((await api('PUT', '/api/settings/metric-intervals/test_coverage', cookies.l1, one)).status).toBe(403);
  const n = await db.query('SELECT count(*)::int AS n FROM metric_update_intervals WHERE company_id = $1', [companyA]);
  expect(n.rows[0].n).toBe(0);
  // Managers still read them; the super admin changes them.
  expect((await api('GET', '/api/settings/metric-intervals', cookies.m1)).status).toBe(200);
  expect((await api('PUT', '/api/settings/metric-intervals/test_coverage', cookies.owner, one)).status).toBe(200);
  expect((await api('DELETE', '/api/settings/metric-intervals/test_coverage', cookies.owner)).status).toBe(200);
});

test('DOCACC-004 technical-debt ROI inputs: the lead of the team, the manager of its department', async () => {
  const body = { affected_users: 120, support_tickets_monthly: 4 };
  const r1 = await api('PUT', `/api/analytics/technical-debt/${ids.debtT1}/impact`, cookies.l1, body);
  expect(r1.status).toBe(200);
  const row = (await db.query('SELECT affected_users, manually_edited FROM technical_debt WHERE id = $1', [ids.debtT1])).rows[0];
  expect(row).toEqual({ affected_users: 120, manually_edited: true });
  expect((await api('PUT', `/api/analytics/technical-debt/${ids.debtT2}/impact`, cookies.l1, body)).status).toBe(403);
  expect((await api('PUT', `/api/analytics/technical-debt/${ids.debtT2}/impact`, cookies.m1, body)).status).toBe(403);
  expect((await api('PUT', `/api/analytics/technical-debt/${ids.debtT1}/impact`, cookies.m1, { affected_users: 130 })).status).toBe(200);
  expect((await api('PUT', `/api/analytics/technical-debt/${ids.debtT1}/impact`, cookies.e1, body)).status).toBe(403);
  const t2 = (await db.query('SELECT affected_users FROM technical_debt WHERE id = $1', [ids.debtT2])).rows[0];
  expect(t2.affected_users).toBe(0);
});

test('DOCACC-005 directory: people who manage users; departments: the caller\'s scope only', async () => {
  for (const k of ['e1', 'v1']) {
    expect({ k, s: (await api('GET', '/api/admin/teams', cookies[k])).status }).toEqual({ k, s: 403 });
    expect({ k, s: (await api('GET', '/api/admin/departments', cookies[k])).status }).toEqual({ k, s: 403 });
  }
  for (const k of ['l1', 'm1', 'owner']) {
    const r = await api('GET', '/api/admin/teams', cookies[k]);
    expect({ k, s: r.status }).toEqual({ k, s: 200 });
    expect(r.body.map((t: any) => t.id)).toEqual(expect.arrayContaining([ids.T1, ids.T2]));
    expect({ k, s: (await api('GET', '/api/admin/departments', cookies[k])).status }).toEqual({ k, s: 200 });
  }
  const deptIds = async (k: string) => ((await api('GET', '/api/departments', cookies[k])).body.departments as any[]).map((d) => d.id).sort();
  expect(await deptIds('e1')).toEqual([ids.D1]);
  expect(await deptIds('m1')).toEqual([ids.D1]);
  expect(await deptIds('owner')).toEqual([ids.D1, ids.D2].sort());
  expect((await api('GET', `/api/departments/${ids.D2}`, cookies.e1)).status).toBe(403);
  expect((await api('GET', `/api/departments/${ids.D2}`, cookies.m1)).status).toBe(403);
  const own = await api('GET', `/api/departments/${ids.D1}`, cookies.e1);
  expect(own.status).toBe(200);
  expect(own.body.department.teams.map((t: any) => t.id)).toEqual([ids.T1]);
  expect((await api('GET', `/api/departments/${ids.D2}`, cookies.owner)).status).toBe(200);
});

test('DOCACC-006 developer recommendations: engineers and viewers 403, the lead allowed', async () => {
  for (const k of ['e1', 'v1']) {
    const r = await api('GET', `/api/teams/${ids.T1}/developer-ai-suggestions`, cookies[k]);
    expect({ k, s: r.status }).toEqual({ k, s: 403 });
  }
  expect((await api('GET', `/api/teams/${ids.T1}/developer-ai-suggestions`, cookies.l1)).status).toBe(200);
  expect((await api('GET', `/api/teams/${ids.T1}/developer-ai-suggestions`, cookies.m1)).status).toBe(200);
});

test('DOCACC-007 generated business-impact sample data: super admins only', async () => {
  const path = `/api/analytics/business-impact-v2/${teamS}/generate-realistic-data`;
  expect((await api('POST', path, cookies.slead)).status).toBe(403);
  expect((await api('POST', path, cookies.sadmin)).status).toBe(200);
});

test('DOCACC-008 hosted runtime: Secure, SameSite=Strict session cookie; demo credentials only with DEMO_MODE=true', async () => {
  const c = loginSetCookie.find((x) => x.startsWith('irongate_token='));
  expect(c).toBeDefined();
  expect(c).toMatch(/;\s*Secure/i);
  expect(c).toMatch(/;\s*HttpOnly/i);
  expect(c).toMatch(/;\s*SameSite=Strict/i);
  const prev = process.env.DEMO_MODE;
  try {
    for (const v of [undefined, '1', 'yes']) {
      if (v === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = v;
      const r = await api('GET', '/api/auth/providers');
      expect({ v, demo: r.body.demoMode, pw: r.body.demoPassword }).toEqual({ v, demo: false, pw: undefined });
    }
    process.env.DEMO_MODE = 'true';
    expect((await api('GET', '/api/auth/providers')).body.demoMode).toBe(true);
  } finally {
    if (prev === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = prev;
  }
});

test('DOCACC-009 the one-time re-encryption makes a webhook stored with the former constant readable', async () => {
  const { encryptSecret, decryptSecret, settingsKeyFrom } = await import('../../server/lib/notifications');
  const { DEV_ONLY_SECRET } = await import('../../server/lib/runtimeEnv');
  const hook = `https://hooks.slack.com/services/T000/B000/${stamp}`;
  const legacy = encryptSecret(hook, settingsKeyFrom(DEV_ONLY_SECRET));
  await db.query(
    `INSERT INTO company_notification_settings (company_id, slack_webhook_enc, slack_webhook_hint) VALUES ($1, $2, 'hint')
     ON CONFLICT (company_id) DO UPDATE SET slack_webhook_enc = EXCLUDED.slack_webhook_enc`, [companyA, legacy]);
  expect(decryptSecret(legacy)).toBeNull(); // the current key (JWT_SECRET) cannot read it
  const run = (args: string[]) => new Promise<string>((resolve, reject) => {
    execFile('npx', ['tsx', 'server/scripts/reencryptSecrets.ts', ...args], {
      cwd: `${__dirname}/../..`, env: { ...process.env, SETTINGS_ENCRYPTION_KEY: '' }, timeout: 90_000,
    }, (err, stdout, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(stdout)));
  });
  expect(await run([])).toMatch(new RegExp(`${companyA}: encrypted with the former development constant: would be re-encrypted`));
  const still = (await db.query('SELECT slack_webhook_enc FROM company_notification_settings WHERE company_id = $1', [companyA])).rows[0].slack_webhook_enc;
  expect(still).toBe(legacy); // dry run: unchanged
  expect(await run(['--apply'])).toMatch(new RegExp(`${companyA}: encrypted with the former development constant: re-encrypted`));
  const after = (await db.query('SELECT slack_webhook_enc FROM company_notification_settings WHERE company_id = $1', [companyA])).rows[0].slack_webhook_enc;
  expect(decryptSecret(after)).toBe(hook);
});
