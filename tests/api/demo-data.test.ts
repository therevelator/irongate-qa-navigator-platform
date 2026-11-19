/**
 * Platform operator panel: "Demo Data" and "Populate metrics" (server/lib/demoGenerate.ts,
 * server/seeds/demoOrg.ts, routes in server/routes/operator.ts), against an in-process copy of the API
 * (the job runs inline there, as on any long-running server; on Netlify it is a background function).
 *
 *   DD-001 operator-only: no token or a company session gets 401; bad sizes are 400
 *   DD-002 Demo Data: counts match the inputs (departments, teams, people), names are new, roles,
 *          job titles, role assignments, team members, primary teams, e-mails on the company domain,
 *          the shared password (bcrypt only) signs in, one login per role level, notice hidden
 *   DD-003 the job fills one year of data in every module for every new team (sample rows)
 *   DD-004 pulse: recipients and answers are team members only (the Product Owner is one)
 *   DD-005 a second run adds new departments and teams cleanly (no duplicate names, old ones untouched)
 *   DD-006 other companies are never touched
 *   DD-007 a company on a public e-mail domain gets first.last@<company-slug>.example
 *   DD-008 Populate metrics: a year of data for every team without data, nobody created; a team
 *          without a team lead or engineer is skipped; a second run only tops up
 *   DD-009 Netlify: the API starts the background function with a token signed for the job (202 at
 *          once); the function refuses a wrong token and runs the job with the right one; a failed
 *          start is 502 for Populate metrics (the job says why)
 */
import 'dotenv/config';
import request from 'supertest';
import type { Client } from 'pg';
import { buildApp } from './helpers/inProcessApp';
import { NEW_PW, backendUp, cookieFrom, localDb, post as livePost, API_URL } from './helpers/http';
import { signOperatorToken, upsertOperator } from '../../server/lib/operator';
import { flushBackgroundWrites } from '../../server/lib/opsLog';
import { pool } from '../../src/lib/db';
import { DEMO_DATA_HEADER, demoDataToken } from '../../server/lib/demoGenerate';
import backgroundFn from '../../netlify/functions/demo-data-background';

jest.setTimeout(240_000);

const app = buildApp();
const stamp = Date.now();
const OP_PW = 'Operator-Test-Passw0rd!';
const opEmail = `dd-op-${stamp}@platform${stamp}.test`;
let up = true;
let db: Client;
let token = '';
let custCookie = '';
let companyId = '';
let publicCompanyId = '';
let popCompanyId = '';
let popCookie = '';
let popTeamId = '';
const otherCompany = 'novatech';
let first: any = null;

const op = (method: 'get' | 'post', path: string, body?: object, tok = token) => {
  let r = request(app)[method](`/api/operator${path}`);
  if (tok) r = r.set('X-Operator-Token', tok);
  return body ? r.send(body) : r;
};

async function register(email: string, company: string) {
  const res = await request(API_URL).post('/api/auth/register').send({
    email, password: NEW_PW, firstName: 'Owner', lastName: 'Person', companyName: company, departmentName: 'Founders', teamName: `${company} Core`,
  });
  if (res.status >= 300) throw new Error(`register ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return { cookie: cookieFrom(res), user: res.body.user, companyId: res.body.user.company_id ?? res.body.user.companyId };
}

async function waitJob(company: string, jobId: string): Promise<any> {
  for (let i = 0; i < 400; i++) {
    const r = await op('get', `/companies/${company}/demo-data/jobs/${jobId}`);
    expect(r.status).toBe(200);
    if (r.body.job.status === 'done' || r.body.job.status === 'failed') return r.body.job;
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error('job did not finish');
}

const otherCounts = async () => (await db.query(
  `SELECT (SELECT count(*) FROM departments WHERE company_id = $1)::int AS d, (SELECT count(*) FROM teams WHERE company_id = $1)::int AS t,
          (SELECT count(*) FROM users WHERE company_id = $1)::int AS u,
          (SELECT count(*) FROM kpi_snapshots k JOIN teams t ON t.id = k.team_id WHERE t.company_id = $1)::int AS k,
          (SELECT count(*) FROM pulse_responses WHERE company_id = $1)::int AS p,
          (SELECT count(*) FROM team_actions WHERE company_id = $1)::int AS a,
          (SELECT count(*) FROM alerts WHERE company_id = $1)::int AS al,
          (SELECT count(*) FROM ingestion_log WHERE company_id = $1)::int AS i,
          (SELECT settings::text FROM companies WHERE id = $1) AS s`, [otherCompany])).rows[0];
let otherBefore: any = null;

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  const opId = (await upsertOperator(opEmail, 'Demo Operator', OP_PW)).id;
  const signIn = await request(app).post('/api/operator/login').send({ email: opEmail, password: OP_PW });
  token = signIn.body.token ?? signOperatorToken(opId, 'none');
  const cust = await register(`dd-owner-${stamp}@acme${stamp}.test`, `DD Acme ${stamp}`);
  custCookie = cust.cookie; companyId = cust.companyId;
  publicCompanyId = (await register(`dd.owner.${stamp}@gmail.com`, `DD Gmail Co ${stamp}`)).companyId;
  const pop = await register(`dd-pop-${stamp}@pop${stamp}.test`, `DD Populate ${stamp}`);
  popCompanyId = pop.companyId; popCookie = pop.cookie;
  popTeamId = (await db.query('SELECT id FROM teams WHERE company_id = $1 LIMIT 1', [popCompanyId])).rows[0].id;
  otherBefore = await otherCounts();
}, 120_000);

afterAll(async () => {
  if (db) await db.query('DELETE FROM platform_operators WHERE email = $1', [opEmail]);
  await db?.end();
  await flushBackgroundWrites(2000);
  await pool.end();
});

const skip = () => !up;

describe('Demo Data and Populate metrics (operator panel)', () => {
  test('DD-001 operator-only; sizes are validated', async () => {
    if (skip()) return;
    const size = { departments: 1, teamsPerDepartment: 1, membersPerTeam: 3 };
    expect((await op('post', `/companies/${companyId}/demo-data`, size, '')).status).toBe(401);
    expect((await request(app).post(`/api/operator/companies/${companyId}/demo-data`).set('Cookie', custCookie).send(size)).status).toBe(401);
    expect((await op('post', `/companies/${companyId}/populate-metrics`, {}, '')).status).toBe(401);
    expect((await op('get', `/companies/${companyId}/demo-data/jobs/latest`, undefined, '')).status).toBe(401);
    for (const bad of [{ ...size, departments: 0 }, { ...size, departments: 11 }, { ...size, teamsPerDepartment: 9 }, { ...size, membersPerTeam: 2 }, { ...size, membersPerTeam: 13 }, { ...size, membersPerTeam: 3.5 }, {}]) {
      expect((await op('post', `/companies/${companyId}/demo-data`, bad)).status).toBe(400);
    }
    expect((await db.query('SELECT count(*)::int AS n FROM departments WHERE company_id = $1', [companyId])).rows[0].n).toBe(1);
  });

  test('DD-002 Demo Data creates the organisation: counts, roles, titles, assignments, e-mails, password', async () => {
    if (skip()) return;
    const r = await op('post', `/companies/${companyId}/demo-data`, { departments: 2, teamsPerDepartment: 2, membersPerTeam: 4 });
    expect(r.status).toBe(202);
    first = r.body;
    expect(r.body.mode).toBe('inline');
    expect(r.body.departments).toHaveLength(2);
    expect(r.body.teams).toHaveLength(4);
    expect(r.body.people).toBe(2 * (1 + 2 * 4));
    expect(r.body.domain).toBe(`acme${stamp}.test`);
    expect(typeof r.body.password).toBe('string');
    expect(r.body.password.length).toBeGreaterThanOrEqual(20);
    expect(r.body.logins.map((l: any) => l.label)).toEqual(['Manager', 'Team lead', 'Software engineer', 'Viewer']);

    const deptIds = r.body.departments.map((d: any) => d.id);
    const teamIds = r.body.teams.map((t: any) => t.id);
    const people = (await db.query(
      `SELECT u.id, u.email, u.role, u.job_title, u.department_id, u.primary_team_id, u.password_hash, u.first_name, u.last_name, u.created_at
         FROM users u WHERE u.company_id = $1 AND u.department_id = ANY($2::text[])`, [companyId, deptIds])).rows;
    expect(people).toHaveLength(18);
    // Never the plain password; one bcrypt hash for everyone.
    expect(new Set(people.map((p: any) => p.password_hash)).size).toBe(1);
    expect(people[0].password_hash).toMatch(/^\$2[aby]\$/);
    expect(people.every((p: any) => p.email.endsWith(`@acme${stamp}.test`) && /^[a-z]+\.[a-z]+\d*@/.test(p.email))).toBe(true);
    expect(people.every((p: any) => p.first_name && p.last_name && p.job_title)).toBe(true);
    expect(people.filter((p: any) => p.role === 'qa_manager')).toHaveLength(2);
    expect(people.filter((p: any) => p.role === 'qa_manager').every((p: any) => /^Head of /.test(p.job_title) && !p.primary_team_id)).toBe(true);
    expect(people.filter((p: any) => p.role === 'viewer').every((p: any) => p.job_title === 'Product Owner')).toBe(true);
    expect(people.filter((p: any) => p.role === 'team_lead').every((p: any) => p.job_title === 'Scrum Master')).toBe(true);
    const devs = people.filter((p: any) => p.role === 'qa_engineer');
    expect(devs).toHaveLength(4 * 2);
    expect(devs.every((p: any) => /Engineer|Designer|Scientist/.test(p.job_title))).toBe(true);
    // Join dates spread over the last ~13 months.
    const ages = people.map((p: any) => (Date.now() - new Date(p.created_at).getTime()) / 86_400_000);
    expect(Math.max(...ages)).toBeGreaterThan(360);
    expect(Math.max(...ages)).toBeLessThan(410);
    for (const t of teamIds) {
      const inTeam = people.filter((p: any) => p.primary_team_id === t);
      expect(inTeam.map((p: any) => p.role).sort()).toEqual(['qa_engineer', 'qa_engineer', 'team_lead', 'viewer']);
      const ra = (await db.query(`SELECT user_id, role FROM role_assignments WHERE scope_type = 'team' AND scope_id = $1 AND revoked_at IS NULL`, [t])).rows;
      expect(ra).toHaveLength(4);
      const tm = (await db.query('SELECT user_id, role FROM team_members WHERE team_id = $1', [t])).rows;
      expect(tm).toHaveLength(4);
      expect(tm.filter((x: any) => x.role === 'lead')).toHaveLength(1);
      expect((await db.query('SELECT lead_id FROM teams WHERE id = $1', [t])).rows[0].lead_id).toBe(inTeam.find((p: any) => p.role === 'team_lead').id);
    }
    const mgrRa = (await db.query(`SELECT count(*)::int AS n FROM role_assignments WHERE scope_type = 'department' AND scope_id = ANY($1::text[]) AND role = 'qa_manager'`, [deptIds])).rows[0].n;
    expect(mgrRa).toBe(2);
    // The company's sample-data notice is hidden.
    expect((await db.query('SELECT settings FROM companies WHERE id = $1', [companyId])).rows[0].settings.hideSampleDataNotice).toBe(true);
    // The shared password signs in, for every role level.
    for (const l of r.body.logins) {
      const res = await request(API_URL).post('/api/auth/login').send({ email: l.email, password: r.body.password });
      expect({ email: l.email, status: res.status }).toEqual({ email: l.email, status: 200 });
    }
    const job = await waitJob(companyId, r.body.jobId);
    expect(job.error).toBeNull();
    expect(job.status).toBe('done');
    expect(job.result.teamsFilled).toBe(4);
    expect(job.result.rowsWritten).toBeGreaterThan(10_000);
    // The job never carries the password.
    expect(JSON.stringify((await db.query('SELECT * FROM demo_data_jobs WHERE id = $1', [r.body.jobId])).rows[0])).not.toContain(r.body.password);
    expect((await op('get', `/companies/${companyId}/demo-data/jobs/latest`)).body.job.id).toBe(r.body.jobId);
  });

  test('DD-003 one year of data in every module for every new team', async () => {
    if (skip()) return;
    expect(first).toBeTruthy();
    for (const t of first.teams) {
      const c = (await db.query(
        `SELECT (SELECT min(snapshot_date) FROM kpi_snapshots WHERE team_id = $1) <= current_date - 360 AS year_kpi,
                (SELECT count(*) FROM kpi_snapshots WHERE team_id = $1)::int AS kpi,
                (SELECT count(*) FROM metric_values WHERE team_id = $1)::int AS metric_values,
                (SELECT count(*) FROM pipeline_runs WHERE team_id = $1)::int AS pipelines,
                (SELECT count(*) FROM pipeline_runs WHERE team_id = $1 AND started_at < now() - interval '300 days')::int AS old_pipelines,
                (SELECT count(*) FROM test_execution_runs WHERE team_id = $1)::int AS test_runs,
                (SELECT count(*) FROM flaky_tests WHERE team_id = $1)::int AS flaky,
                (SELECT count(*) FROM technical_debt WHERE team_id = $1)::int AS debt,
                (SELECT count(*) FROM performance_metrics WHERE team_id = $1)::int AS perf,
                (SELECT count(*) FROM developer_productivity_snapshots s JOIN users u ON u.id = s.developer_id WHERE u.primary_team_id = $1)::int AS devprod,
                (SELECT count(*) FROM sprint_velocity WHERE team_id = $1)::int AS sprints,
                (SELECT count(*) FROM pulse_responses WHERE team_id = $1)::int AS pulse,
                (SELECT count(*) FROM pulse_responses WHERE team_id = $1 AND comment IS NOT NULL)::int AS pulse_comments,
                (SELECT count(*) FROM pulse_sends WHERE team_id = $1)::int AS pulse_sends,
                (SELECT count(*) FROM team_actions WHERE team_id = $1)::int AS actions,
                (SELECT count(*) FROM alerts WHERE team_id = $1)::int AS alerts,
                (SELECT count(*) FROM business_impact_history WHERE team_id = $1)::int AS business,
                (SELECT count(*) FROM team_analytics WHERE team_id = $1)::int AS analytics,
                (SELECT count(*) FROM ingestion_log WHERE $1 = ANY(team_ids))::int AS ingestion`, [t.id])).rows[0];
      expect({ team: t.name, year: c.year_kpi }).toEqual({ team: t.name, year: true });
      for (const k of ['kpi', 'metric_values', 'pipelines', 'old_pipelines', 'test_runs', 'flaky', 'debt', 'perf', 'devprod', 'sprints', 'pulse', 'pulse_comments', 'pulse_sends', 'actions', 'alerts', 'business', 'analytics', 'ingestion']) {
        expect({ team: t.name, k, ok: c[k] > 0 }).toEqual({ team: t.name, k, ok: true });
      }
      expect(c.kpi).toBeGreaterThanOrEqual(360);
      expect(c.sprints).toBeGreaterThanOrEqual(24);
    }
    const co = (await db.query(
      `SELECT (SELECT count(*) FROM company_kpi_snapshots WHERE company_id = $1)::int AS company_snapshots,
              (SELECT count(*) FROM api_keys WHERE company_id = $1)::int AS keys,
              (SELECT completed_at IS NOT NULL FROM onboarding_state WHERE company_id = $1) AS onboarded`, [companyId])).rows[0];
    expect(co.company_snapshots).toBeGreaterThanOrEqual(300);
    expect(co.keys).toBeGreaterThanOrEqual(1);
    expect(co.onboarded).toBe(true);
  });

  test('DD-004 pulse: recipients are the team members only', async () => {
    if (skip()) return;
    const t = first.teams[0].id;
    const recipients = (await db.query('SELECT DISTINCT user_id FROM pulse_recipients WHERE team_id = $1', [t])).rows.map((x: any) => x.user_id).sort();
    const members = (await db.query('SELECT user_id FROM team_members WHERE team_id = $1', [t])).rows.map((x: any) => x.user_id).sort();
    expect(recipients).toEqual(members);
    // Answers per period never exceed the members.
    const maxPer = (await db.query('SELECT max(n)::int AS m FROM (SELECT count(*) AS n FROM pulse_responses WHERE team_id = $1 GROUP BY period_start) x', [t])).rows[0].m;
    expect(maxPer).toBeLessThanOrEqual(members.length);
    // Every two weeks over the year.
    const periods = (await db.query('SELECT count(DISTINCT period_start)::int AS n FROM pulse_sends WHERE team_id = $1', [t])).rows[0].n;
    expect(periods).toBeGreaterThanOrEqual(24);
  });

  test('DD-005 a second run adds new departments and teams cleanly', async () => {
    if (skip()) return;
    const before = (await db.query('SELECT id, name, updated_at FROM teams WHERE company_id = $1 ORDER BY id', [companyId])).rows;
    const kpiBefore = (await db.query('SELECT count(*)::int AS n FROM kpi_snapshots WHERE team_id = ANY($1::text[])', [first.teams.map((t: any) => t.id)])).rows[0].n;
    const r = await op('post', `/companies/${companyId}/demo-data`, { departments: 1, teamsPerDepartment: 2, membersPerTeam: 3 });
    expect(r.status).toBe(202);
    expect(r.body.password).not.toBe(first.password);
    const job = await waitJob(companyId, r.body.jobId);
    expect(job.status).toBe('done');
    expect(job.result.teamsFilled).toBe(2);
    const depts = (await db.query('SELECT lower(name) AS n FROM departments WHERE company_id = $1', [companyId])).rows.map((x: any) => x.n);
    expect(depts).toHaveLength(4);
    expect(new Set(depts).size).toBe(4);
    const teams = (await db.query('SELECT lower(name) AS n FROM teams WHERE company_id = $1', [companyId])).rows.map((x: any) => x.n);
    expect(teams).toHaveLength(before.length + 2);
    expect(new Set(teams).size).toBe(teams.length);
    const emails = (await db.query('SELECT lower(email) AS e FROM users WHERE company_id = $1', [companyId])).rows.map((x: any) => x.e);
    expect(new Set(emails).size).toBe(emails.length);
    // The first run's teams keep their data and the old teams were not changed.
    expect((await db.query('SELECT count(*)::int AS n FROM kpi_snapshots WHERE team_id = ANY($1::text[])', [first.teams.map((t: any) => t.id)])).rows[0].n).toBe(kpiBefore);
    const after = (await db.query('SELECT id, name, updated_at FROM teams WHERE id = ANY($1::text[]) ORDER BY id', [before.map((t: any) => t.id)])).rows;
    expect(after).toEqual(before);
  });

  test('DD-006 other companies are never touched', async () => {
    if (skip()) return;
    expect(await otherCounts()).toEqual(otherBefore);
  });

  test('DD-007 public e-mail domain: first.last@<company-slug>.example', async () => {
    if (skip()) return;
    expect((await db.query('SELECT email_domain_public FROM companies WHERE id = $1', [publicCompanyId])).rows[0].email_domain_public).toBe(true);
    const r = await op('post', `/companies/${publicCompanyId}/demo-data`, { departments: 1, teamsPerDepartment: 1, membersPerTeam: 3 });
    expect(r.status).toBe(202);
    expect(r.body.domain).toBe(`dd-gmail-co-${stamp}.example`);
    const emails = (await db.query('SELECT email FROM users WHERE company_id = $1 AND department_id = $2', [publicCompanyId, r.body.departments[0].id])).rows.map((x: any) => x.email);
    expect(emails).toHaveLength(4);
    expect(emails.every((e: string) => e.endsWith(`@dd-gmail-co-${stamp}.example`) && !e.includes('gmail.com'))).toBe(true);
    expect((await waitJob(publicCompanyId, r.body.jobId)).status).toBe('done');
  });

  test('DD-008 Populate metrics fills teams without data and creates nobody', async () => {
    if (skip()) return;
    // The company's only team has nobody to attribute work to: skipped.
    const r0 = await op('post', `/companies/${popCompanyId}/populate-metrics`, {});
    expect(r0.status).toBe(202);
    const j0 = await waitJob(popCompanyId, r0.body.jobId);
    expect(j0.status).toBe('done');
    expect(j0.result.teamsFilled).toBe(0);
    expect(j0.result.teamsSkippedNoPeople).toBe(1);
    // With a team lead and two engineers, the team is filled.
    for (const [i, role] of (['team_lead', 'qa_engineer', 'qa_engineer'] as const).entries()) {
      const res = await livePost('/api/admin/users', popCookie, { email: `dd-pop-${i}-${stamp}@pop${stamp}.test`, password: NEW_PW, firstName: 'Pop', lastName: `Person${i}`, role, teamId: popTeamId });
      expect(res.status).toBe(201);
    }
    const usersBefore = (await db.query('SELECT count(*)::int AS n FROM users WHERE company_id = $1', [popCompanyId])).rows[0].n;
    const r = await op('post', `/companies/${popCompanyId}/populate-metrics`, {});
    expect(r.status).toBe(202);
    // One job at a time per company.
    const again = await op('post', `/companies/${popCompanyId}/populate-metrics`, {});
    expect([409, 202]).toContain(again.status);
    if (again.status === 409) expect(again.body.error).toMatch(/already/);
    const j = await waitJob(popCompanyId, r.body.jobId);
    expect(j.status).toBe('done');
    expect(j.result.teamsFilled).toBe(1);
    expect((await db.query('SELECT count(*)::int AS n FROM users WHERE company_id = $1', [popCompanyId])).rows[0].n).toBe(usersBefore);
    const c = (await db.query(
      `SELECT (SELECT count(*) FROM kpi_snapshots WHERE team_id = $1)::int AS kpi, (SELECT count(*) FROM pipeline_runs WHERE team_id = $1)::int AS pipes,
              (SELECT count(*) FROM pulse_responses WHERE team_id = $1)::int AS pulse, (SELECT count(*) FROM sprint_velocity WHERE team_id = $1)::int AS sprints`, [popTeamId])).rows[0];
    expect(c.kpi).toBeGreaterThanOrEqual(360);
    expect(c.pipes).toBeGreaterThan(0);
    expect(c.pulse).toBeGreaterThan(0);
    expect(c.sprints).toBeGreaterThanOrEqual(24);
    if (again.status === 202) await waitJob(popCompanyId, again.body.jobId);
    // A second Populate metrics only tops up: nothing new for that team.
    const r2 = await op('post', `/companies/${popCompanyId}/populate-metrics`, {});
    expect(r2.status).toBe(202);
    const j2 = await waitJob(popCompanyId, r2.body.jobId);
    expect(j2.status).toBe('done');
    expect(j2.result.teamsFilled).toBe(0);
    expect(j2.result.teamsToppedUp).toBe(1);
    expect((await db.query('SELECT count(*)::int AS n FROM kpi_snapshots WHERE team_id = $1', [popTeamId])).rows[0].n).toBe(c.kpi);
  });

  test('DD-009 Netlify: background function with a signed token; a failed start is reported', async () => {
    if (skip()) return;
    const saved = { NETLIFY: process.env.NETLIFY, URL: process.env.URL };
    const realFetch = global.fetch;
    const calls: Array<{ url: string; init: any }> = [];
    process.env.NETLIFY = 'true';
    process.env.URL = 'https://irongate.example';
    try {
      (global as any).fetch = jest.fn(async (url: string, init: any) => { calls.push({ url, init }); return { ok: true, status: 202 } as any; });
      const r = await op('post', `/companies/${popCompanyId}/populate-metrics`, {});
      expect(r.status).toBe(202);
      expect(r.body.mode).toBe('background');
      expect(r.body.job.status).toBe('queued');
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://irongate.example/.netlify/functions/demo-data-background');
      expect(calls[0].init.headers[DEMO_DATA_HEADER]).toBe(demoDataToken(r.body.jobId));
      // A wrong token does nothing; the right one runs the job.
      const req = (tok: string) => new Request('https://irongate.example/.netlify/functions/demo-data-background', {
        method: 'POST', headers: { [DEMO_DATA_HEADER]: tok, 'content-type': 'application/json' }, body: JSON.stringify({ jobId: r.body.jobId }),
      });
      await backgroundFn(req('0'.repeat(64)));
      expect((await op('get', `/companies/${popCompanyId}/demo-data/jobs/${r.body.jobId}`)).body.job.status).toBe('queued');
      await backgroundFn(req(calls[0].init.headers[DEMO_DATA_HEADER]));
      expect((await op('get', `/companies/${popCompanyId}/demo-data/jobs/${r.body.jobId}`)).body.job.status).toBe('done');
      // The function cannot start: 502 with the reason in the job.
      (global as any).fetch = jest.fn(async () => ({ ok: false, status: 500 }) as any);
      const bad = await op('post', `/companies/${popCompanyId}/populate-metrics`, {});
      expect(bad.status).toBe(502);
      expect(bad.body.job.status).toBe('failed');
      expect(bad.body.error).toMatch(/could not be started/);
    } finally {
      global.fetch = realFetch;
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
});
