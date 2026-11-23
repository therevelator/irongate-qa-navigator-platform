/**
 * Company figures as docs/PRODUCT_GUIDE.md describes them (in-process, local database only).
 *
 *   PGCALC-001 QA score trend: against each team's latest snapshot dated 7–14 days ago (day 7 included)
 *   PGCALC-002 company KPI averages: every active team with a current value of that KPI, also a team
 *              without a current QA score
 *   PGCALC-003 Delivery (DORA): every active team with DORA inputs is classified; the confidence is
 *              "n of m" over all active teams
 *   PGCALC-004 developer aggregates: contributors by the role ASSIGNED on the team (qa_engineer /
 *              team_lead), not by the display column users.role
 *   PGCALC-005 executive briefing: every caller (super admin, manager, team lead) stores today's
 *              snapshot of their own scope and reads 30 days of that scope only; scopes never mix
 *
 * Fixture company pgc-co-<stamp>: department One (teams A, B), department Two (team C).
 *   A  today: coverage 80, escape 5, CFR 4, code quality 80, automation 60, flakiness 2, DORA Elite
 *      7 days ago: coverage 60 (a lower QA score)
 *   B  today: automation 90 and DORA inputs (Low), no coverage: no current QA score
 *   C  no snapshot
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import request from 'supertest';
import type { Client } from 'pg';
import type express from 'express';
import { localDb } from './helpers/http';

delete process.env.GROQ_API_KEY; // the briefing's rule-based path: no AI provider is called
jest.setTimeout(60_000);

const stamp = Date.now();
const CO = `pgc-co-${stamp}`;
const D1 = `pgc-d1-${stamp}`;
const D2 = `pgc-d2-${stamp}`;
const A = `pgc-a-${stamp}`;
const B = `pgc-b-${stamp}`;
const C = `pgc-c-${stamp}`;
const PW = 'Passw0rd!2024';

let db: Client;
let app: express.Express;
const cookie: Record<string, string> = {};

async function addUser(id: string, displayRole: string, grants: Array<[string, string, string]>, opts: { insights?: boolean } = {}) {
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, is_active, email_verified, developer_insights_enabled)
     VALUES ($1, $2, $3, 'Pgc', $1, $4, $5, $6, TRUE, TRUE, $7)`,
    [id, `${id}@pgc${stamp}.test`, await bcrypt.hash(PW, 4), displayRole, CO, D1, opts.insights === true]
  );
  for (const [role, type, scope] of grants) {
    await db.query(`INSERT INTO role_assignments (company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4, $5)`, [CO, id, role, type, scope]);
  }
}
async function devMetrics(team: string, dev: string, pr: number) {
  await db.query(
    `INSERT INTO developer_metrics (team_id, developer_id, pr_merge_time_avg, code_review_time_avg, focus_time_hours, meeting_time_hours, context_switches_per_day)
     VALUES ($1, $2, $3, 2, 4, 2, 4)`, [team, dev, pr]);
}

beforeAll(async () => {
  db = await localDb();
  await db.query(`INSERT INTO companies (id, name, domain, is_active) VALUES ($1, 'PG calc', $2, TRUE)`, [CO, `pgc${stamp}.test`]);
  await db.query(`INSERT INTO departments (id, company_id, name, is_active) VALUES ($1, $2, 'One', TRUE), ($3, $2, 'Two', TRUE)`, [D1, CO, D2]);
  for (const [id, dept] of [[A, D1], [B, D1], [C, D2]]) {
    await db.query(`INSERT INTO teams (id, company_id, department_id, name, is_active) VALUES ($1, $2, $3, $1, TRUE)`, [id, CO, dept]);
  }
  await db.query(
    `INSERT INTO kpi_snapshots (team_id, snapshot_date, test_coverage, defect_escape_rate, change_failure_rate, code_quality_score, automation_coverage, test_flakiness_rate,
                                deployment_frequency_per_week, lead_time_days, mttr_hours)
     VALUES ($1, CURRENT_DATE, 80, 5, 4, 80, 60, 2, 10, 0.5, 0.5),
            ($1, CURRENT_DATE - 7, 60, 5, 4, 80, 60, 2, 10, 0.5, 0.5),
            ($2, CURRENT_DATE, NULL, NULL, 40, NULL, 90, NULL, 0.1, 60, 200)`,
    [A, B]
  );

  await addUser(`pgc-admin-${stamp}`, 'super_admin', [['super_admin', 'company', CO]]);
  await addUser(`pgc-mgr-${stamp}`, 'qa_manager', [['qa_manager', 'department', D1]]);
  await addUser(`pgc-lead-${stamp}`, 'team_lead', [['team_lead', 'team', A]]);
  // Developers of A (opted in): two ordinary engineers; X is shown as a manager (highest role
  // elsewhere) but an engineer on A; Y is shown as a team lead but only a viewer on A.
  await addUser(`pgc-n1-${stamp}`, 'qa_engineer', [['qa_engineer', 'team', A]], { insights: true });
  await addUser(`pgc-n2-${stamp}`, 'qa_engineer', [['qa_engineer', 'team', A]], { insights: true });
  await addUser(`pgc-x-${stamp}`, 'qa_manager', [['qa_manager', 'department', D2], ['qa_engineer', 'team', A]], { insights: true });
  await addUser(`pgc-y-${stamp}`, 'team_lead', [['team_lead', 'team', C], ['viewer', 'team', A]], { insights: true });
  await devMetrics(A, `pgc-n1-${stamp}`, 2);
  await devMetrics(A, `pgc-n2-${stamp}`, 4);
  await devMetrics(A, `pgc-x-${stamp}`, 6);
  await devMetrics(A, `pgc-y-${stamp}`, 30);

  const { buildApp } = await import('./helpers/inProcessApp');
  const analytics = (await import('../../server/routes/analytics')).default;
  app = buildApp((a) => { a.use('/api/analytics', analytics); });
  for (const who of ['admin', 'mgr', 'lead']) {
    const res = await request(app).post('/api/auth/login').send({ email: `pgc-${who}-${stamp}@pgc${stamp}.test`, password: PW });
    if (res.status !== 200) throw new Error(`login ${who}: ${res.status} ${JSON.stringify(res.body)}`);
    const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    cookie[who] = (raw.find((x) => x.startsWith('irongate_token=')) ?? '').split(';')[0];
  }
});

afterAll(async () => {
  if (db) {
    await db.query('DELETE FROM company_kpi_snapshots WHERE company_id = $1', [CO]);
    await db.query('DELETE FROM companies WHERE id = $1', [CO]);
    await db.end();
  }
  const { flushBackgroundWrites } = await import('../../server/lib/opsLog');
  await flushBackgroundWrites(500);
  const { pool } = await import('../../src/lib/db');
  await pool.end();
});

const metrics = async () => (await import('../../server/routes/analytics')).computeCompanyMetrics(CO);

test('PGCALC-001 the trend compares with the snapshot of exactly 7 days ago', async () => {
  const m = await metrics();
  expect(m.globalQaScore).not.toBeNull();
  expect(m.globalQaScoreTrend).not.toBeNull();
  expect(m.globalQaScoreTrend).toBeGreaterThan(0); // coverage 60 -> 80
});

test('PGCALC-002 company KPI averages include a team with a current value but no QA score', async () => {
  const m = await metrics();
  // A 60 and B 90 (B has no QA score); unweighted mean 75 (the headline is weighted by team size).
  expect(m.kpiAveragesUnweighted.automationCoverage).toBe(75);
  expect(m.automationCoverage).toBeGreaterThan(60);
  expect(m.avgTestCoverage).toBe(80); // only A has coverage
});

test('PGCALC-003 Delivery: every active team with DORA inputs is classified, n of m over all active teams', async () => {
  const m: any = await metrics();
  expect(m.deliveryPerformanceBasis.levels).toEqual({ Elite: 1, High: 0, Medium: 0, Low: 1, Unknown: 1 });
  expect(m.deliveryPerformanceBasis.teamsClassified).toBe(2);
  // Elite A (100) and Low B (40), weighted by team size: strictly between the two.
  expect(m.deliveryPerformanceScore).toBeGreaterThan(40);
  expect(m.deliveryPerformanceScore).toBeLessThan(100);
  expect(m.deliveryPerformanceConfidence).toMatchObject({ inputsUsed: 2, inputsTotal: 3 });
});

test('PGCALC-004 developer aggregates: contributors by the role assigned on the team', async () => {
  const { teamDeveloperSummary } = await import('../../server/lib/developerAggregates');
  const s = await teamDeveloperSummary(CO, A);
  expect(s.privacy.suppressed).toBe(false);
  // n1 (2), n2 (4) and X (6, an engineer on A although shown as a manager); not Y (a viewer on A).
  expect(s.averages.prMergeHours).toBe(4);
});

test('PGCALC-005 executive briefing: a snapshot and 30 days of history per caller scope, never mixed', async () => {
  const brief = async (who: string) => {
    const res = await request(app).post('/api/analytics/company-insights').set('Cookie', cookie[who]).send({});
    expect({ who, status: res.status }).toEqual({ who, status: 200 });
    return res.body;
  };
  const admin = await brief('admin');
  const mgr = await brief('mgr');
  const lead = await brief('lead');
  const rows = (await db.query('SELECT scope_key, avg_test_coverage, automation_coverage FROM company_kpi_snapshots WHERE company_id = $1 ORDER BY scope_key', [CO])).rows;
  expect(rows).toHaveLength(3); // company, department One's teams (A, B), team A
  expect(rows.map((r) => r.scope_key)).toContain('company');
  for (const [who, body] of [['admin', admin], ['mgr', mgr], ['lead', lead]] as const) {
    expect({ who, n: body.history.length }).toEqual({ who, n: 1 });
  }
  expect(new Set([admin, mgr, lead].map((b) => b.history[0].scope_key)).size).toBe(3);
  expect(admin.history[0].scope_key).toBe('company');
  // The lead's scope is team A only: automation 60 (B's 90 is not in it).
  expect(Number(lead.history[0].automation_coverage)).toBe(60);
  expect(Number(mgr.history[0].automation_coverage)).toBeGreaterThan(60); // A and B
  // Opening it again the same day updates that scope's row only.
  await brief('lead');
  expect((await db.query('SELECT count(*)::int AS n FROM company_kpi_snapshots WHERE company_id = $1', [CO])).rows[0].n).toBe(3);
});
