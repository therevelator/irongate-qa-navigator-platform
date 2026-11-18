import type { Client } from 'pg';
import { hash } from 'bcrypt';
import request from 'supertest';
import { API_URL, backendUp, get, localDb, login } from './helpers/http';
import { METRICS_CONFIG } from '../../src/config/metricsConfig';

/**
 * Revenue impact API (server/routes/revenueImpact.ts, server/lib/revenueImpact.ts).
 *
 * Fixture company "rev-co": department rev-dept with teams A (6 months of the reference data set
 * x = coverage 70..75, y = revenue 102 000..107 000, one open debt item, downtime, a team target)
 * and B (only 4 months), department rev-dept-2 with team C (the same 6 months, no target, no debt).
 * Users: super admin, QA manager of rev-dept, and a team lead / QA engineer / viewer of team A.
 * Hand-computed reference (see revenue-impact-lib.test.ts): slope b = 771.4286 $/pt,
 * 95% CI [188.4966, 1354.3606], r = 0.8783101, p = 0.0213116.
 * Runs against a live backend at API_URL; skips cleanly when none is running.
 */

const CO = 'rev-co';
const DEPT = 'rev-dept';
const DEPT2 = 'rev-dept-2';
const A = 'rev-team-a';
const B = 'rev-team-b';
const C = 'rev-team-c';
const PW = 'demo123';
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
const Y = [2, 4, 5, 4, 5, 7];
const SLOPE = 771.4286;
const CI = [188.4966, 1354.3606];

let up = true;
let db: Client;
const c: Record<string, string> = {};

async function cleanup(db: Client) {
  await db.query(`DELETE FROM target_history WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM technical_debt WHERE team_id LIKE 'rev-team-%'`);
  await db.query(`DELETE FROM business_impact_quality_metrics WHERE team_id LIKE 'rev-team-%'`);
  await db.query(`DELETE FROM business_impact_business_kpis WHERE team_id LIKE 'rev-team-%'`);
  await db.query(`DELETE FROM business_impact_context WHERE team_id LIKE 'rev-team-%'`);
  await db.query(`DELETE FROM role_assignments WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM audit_log WHERE company_id = $1`, [CO]).catch(() => undefined);
  await db.query(`DELETE FROM users WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM teams WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM departments WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM companies WHERE id = $1`, [CO]);
}

async function addUser(id: string, role: string, scopeType: string, scopeId: string, dept = DEPT, primary: string | null = null) {
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
     VALUES ($1, $2, $3, 'Rev', $4, $5, $6, $7, $8, TRUE, TRUE)`,
    [id, `${id}@rev.example`, await hash(PW, 4), id, role, CO, dept, primary]
  );
  await db.query(
    `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [`rev-ra-${id}`, CO, id, role, scopeType, scopeId]
  );
}

async function addMonths(team: string, months: string[]) {
  for (const [i, m] of months.entries()) {
    await db.query(
      `INSERT INTO business_impact_quality_metrics (id, team_id, month_year, test_coverage, data_source) VALUES ($1, $2, $3, $4, 'manual')`,
      [`rev-q-${team}-${m}`, team, m, 70 + i]
    );
    await db.query(
      `INSERT INTO business_impact_business_kpis (id, team_id, month_year, monthly_revenue, churn_rate, data_source) VALUES ($1, $2, $3, $4, $5, 'manual')`,
      [`rev-k-${team}-${m}`, team, m, Y[i] * 1000 + 100000, 2 + i * 0.1]
    );
  }
}

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  await cleanup(db);
  await db.query(`INSERT INTO companies (id, name, domain, is_active) VALUES ($1, 'Revenue Fixture Co', 'rev.example', TRUE)`, [CO]);
  await db.query(`INSERT INTO departments (id, company_id, name, is_active) VALUES ($1, $2, 'Revenue', TRUE), ($3, $2, 'Other', TRUE)`, [DEPT, CO, DEPT2]);
  for (const [id, dept, name] of [[A, DEPT, 'Team A'], [B, DEPT, 'Team B'], [C, DEPT2, 'Team C']]) {
    await db.query(`INSERT INTO teams (id, company_id, department_id, name, is_active) VALUES ($1, $2, $3, $4, TRUE)`, [id, CO, dept, name]);
  }
  await addUser('rev-admin', 'super_admin', 'company', CO);
  await addUser('rev-mgr', 'qa_manager', 'department', DEPT);
  await addUser('rev-lead', 'team_lead', 'team', A, DEPT, A);
  await addUser('rev-eng', 'qa_engineer', 'team', A, DEPT, A);
  await addUser('rev-viewer', 'viewer', 'team', A, DEPT, A);
  await addMonths(A, MONTHS);
  await addMonths(B, MONTHS.slice(0, 4));
  await addMonths(C, MONTHS);
  await db.query(`INSERT INTO business_impact_context (id, team_id, month_year, downtime_minutes, major_incident_count) VALUES ('rev-x-a-05', $1, '2026-05', 50, 1), ('rev-x-a-06', $1, '2026-06', 20, 1)`, [A]);
  await db.query(
    `INSERT INTO technical_debt (id, team_id, company_id, title, severity, status, effort_hours, affected_users, support_tickets_monthly, downtime_minutes_monthly, revenue_impact_percent, sla_breaches_monthly)
     VALUES ('rev-td-1', $1, $2, 'Open item', 'high', 'open', 40, 1000, 10, 30, 2, 1),
            ('rev-td-2', $1, $2, 'Resolved item', 'low', 'resolved', 5, 9999, 999, 999, 50, 9)`,
    [A, CO]
  );
  // Team A coverage targets: an expired one, the one valid today (78) and a future one.
  await db.query(
    `INSERT INTO target_history (id, company_id, scope_type, scope_id, metric_key, good, warning, valid_from, valid_to) VALUES
       ('rev-th-1', $1, 'team', $2, 'test_coverage', 60, 50, now() - interval '400 days', now() - interval '200 days'),
       ('rev-th-2', $1, 'team', $2, 'test_coverage', 78, 70, now() - interval '200 days', now() + interval '300 days'),
       ('rev-th-3', $1, 'team', $2, 'test_coverage', 95, 90, now() + interval '300 days', NULL)`,
    [CO, A]
  );
  for (const who of ['rev-admin', 'rev-mgr', 'rev-lead', 'rev-eng', 'rev-viewer']) c[who] = (await login(`${who}@rev.example`)).cookie;
  c.foreign = (await login('alex.morgan@northwind.example')).cookie;
}, 60000);

afterAll(async () => {
  if (db) {
    await cleanup(db);
    await db.end();
  }
});

describe('Revenue impact: one team', () => {
  it('REV-001: sensitivity = the hand-computed OLS slope with n, r, R², p and the 95% interval', async () => {
    if (!up) return;
    const res = await get(`/api/revenue-impact/teams/${A}`, c['rev-admin']);
    expect(res.status).toBe(200);
    const s = res.body.sensitivities.find((x: any) => x.metric === 'test_coverage');
    expect(s).toMatchObject({ status: 'fitted', n: 6, significant: true, firstMonth: '2026-01', lastMonth: '2026-06' });
    expect(s.slope).toBeCloseTo(SLOPE, 3);
    expect(s.ciLow).toBeCloseTo(CI[0], 3);
    expect(s.ciHigh).toBeCloseTo(CI[1], 3);
    expect(s.r).toBeCloseTo(0.8783101, 6);
    expect(s.r2).toBeCloseTo(0.7714286, 6);
    expect(s.pValue).toBeCloseTo(0.0213116, 6);
    expect(res.body.sensitivities).toHaveLength(8);
    expect(res.body.months).toMatchObject({ paired: 6, source: 'measured', excludedOtherSource: 0 });
    expect(res.body.sampleData).toBe(false);
    expect(res.body.method.minimumPairedMonths).toBe(6);
    expect(res.body.method.formulas.sensitivity).toMatch(/ordinary least-squares/);
  });

  it('REV-002: revenue at stake uses the target valid today (78, not the expired 60 or the future 95)', async () => {
    if (!up) return;
    const { body } = await get(`/api/revenue-impact/teams/${A}`, c['rev-admin']);
    const row = body.stake.rows.find((r: any) => r.metric === 'test_coverage');
    expect(row.target).toMatchObject({ good: 78, scope: 'team', lowerIsBetter: false });
    expect(row.current).toEqual({ value: 75, month: '2026-06' });
    expect(row.gap).toBe(3);
    expect(body.stake.metricsIncluded).toBe(1);
    expect(body.stake.monthly).toBeCloseTo(SLOPE * 3, 2);
    expect(body.stake.monthlyLow).toBeCloseTo(CI[0] * 3, 2);
    expect(body.stake.monthlyHigh).toBeCloseTo(CI[1] * 3, 2);
    expect(body.stake.annual).toBeCloseTo(SLOPE * 3 * 12, 1);
    // metrics with no data: not counted, reason says how many months are missing
    const mttr = body.stake.rows.find((r: any) => r.metric === 'mttr_hours');
    expect(mttr.included).toBe(false);
    expect(mttr.reason).toMatch(/needs 6 \(6 more\)/);
  });

  it('REV-003: debt, incident and churn figures from the ROI parameters (built-in defaults flagged)', async () => {
    if (!up) return;
    const { body } = await get(`/api/revenue-impact/teams/${A}`, c['rev-admin']);
    // 10×25 + 30×100 + 1000×50×2% + 1×1000; the resolved item is left out
    expect(body.debt).toMatchObject({ openItems: 1, itemsWithImpact: 1, monthly: 5250, annual: 63000 });
    expect(body.debt.components).toEqual({ revenueLoss: 1000, support: 250, downtime: 3000, sla: 1000 });
    expect(body.debt.parameters.every((p: any) => p.isDefault)).toBe(true);
    expect(body.incidents).toMatchObject({ month: '2026-06', monthly: 2000, annual: 24000 });
    expect(body.churn.month).toBe('2026-06');
    expect(body.churn.monthly).toBeCloseTo(0.025 * 107000, 6);
  });

  it('REV-004: fewer than 6 paired months → no slope and no revenue at stake, with the months missing', async () => {
    if (!up) return;
    const { status, body } = await get(`/api/revenue-impact/teams/${B}`, c['rev-admin']);
    expect(status).toBe(200);
    const s = body.sensitivities.find((x: any) => x.metric === 'test_coverage');
    expect(s).toMatchObject({ status: 'insufficient_data', n: 4, monthsMissing: 2, slope: null, significant: false });
    expect(body.stake.monthly).toBeNull();
    expect(body.stake.reason).toMatch(/at least 6 months/);
    expect(body.debt.monthly).toBeNull();
    expect(body.debt.reason).toBe('No open technical-debt items.');
    expect(body.incidents.monthly).toBeNull();
  });

  it('REV-005: team C uses the default coverage target (no team / department / company target)', async () => {
    if (!up) return;
    const { body } = await get(`/api/revenue-impact/teams/${C}`, c['rev-admin']);
    const row = body.stake.rows.find((r: any) => r.metric === 'test_coverage');
    expect(row.target).toMatchObject({ good: METRICS_CONFIG.testCoverage.good, scope: 'default' });
    expect(body.stake.monthly).toBeCloseTo(SLOPE * (METRICS_CONFIG.testCoverage.good - 75), 2);
  });
});

describe('Revenue impact: money summary', () => {
  it('REV-006: where the money goes, what fixing gains (ranked, with fix cost and payback) and where to start', async () => {
    if (!up) return;
    const { body } = await get(`/api/revenue-impact/teams/${A}`, c['rev-viewer']);
    const going = Object.fromEntries(body.summary.goingNow.map((l: any) => [l.key, l]));
    expect(going.quality_gaps.monthly).toBeCloseTo(SLOPE * 3, 2);
    expect(going.debt.monthly).toBe(5250);
    expect(going.downtime.monthly).toBe(2000);
    expect(going.support).toMatchObject({ monthly: null, reason: 'No support ticket volume recorded.' });
    expect(going.churn.monthly).toBeCloseTo(2675, 6);
    // 20 min of downtime in June is within 99.9 % (43.2 min allowed): no downtime gain
    expect(body.summary.gains.map((g: any) => g.id)).toEqual(['debt:rev-td-1', 'quality:test_coverage']);
    expect(body.summary.gains[0]).toMatchObject({ monthly: 5250, annual: 63000, fixCost: 3000, paybackMonths: 3000 / 5250, confidence: 'estimate', usesDefaults: true });
    expect(body.summary.gains[1].monthly).toBeCloseTo(SLOPE * 3, 2);
    expect(body.summary.gains[1].confidence).toBe('some'); // p = 0.021
    expect(body.summary.priorities).toEqual({ byGain: ['debt:rev-td-1', 'quality:test_coverage'], byReturn: ['debt:rev-td-1'] });
  });
});

describe('Revenue impact: what-if', () => {
  it('REV-010: projected change = slope × change with the interval and ×12', async () => {
    if (!up) return;
    const res = await get(`/api/revenue-impact/teams/${A}/what-if?metric=test_coverage&change=2`, c['rev-lead']);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.monthly).toBeCloseTo(SLOPE * 2, 2);
    expect(res.body.monthlyLow).toBeCloseTo(CI[0] * 2, 2);
    expect(res.body.monthlyHigh).toBeCloseTo(CI[1] * 2, 2);
    expect(res.body.annual).toBeCloseTo(SLOPE * 24, 1);
    expect(res.body.projectedValue).toBe(77);
    expect(res.body.extrapolation).toBe(true);
  });

  it('REV-011: disabled without a significant slope; 400 for an unknown metric or a missing change', async () => {
    if (!up) return;
    const b = await get(`/api/revenue-impact/teams/${B}/what-if?metric=test_coverage&change=2`, c['rev-admin']);
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ enabled: false, monthly: null });
    expect(b.body.reason).toMatch(/needs 6/);
    expect((await get(`/api/revenue-impact/teams/${A}/what-if?metric=revenue&change=2`, c['rev-admin'])).status).toBe(400);
    expect((await get(`/api/revenue-impact/teams/${A}/what-if?metric=test_coverage`, c['rev-admin'])).status).toBe(400);
    expect((await get(`/api/revenue-impact/teams/${A}/what-if?metric=test_coverage&change=abc`, c['rev-admin'])).status).toBe(400);
  });
});

describe('Revenue impact: scope per role', () => {
  it('REV-020: every role reads the teams of its analytics scope and gets 403 outside it', async () => {
    if (!up) return;
    const cases: Array<[string, string, number]> = [
      ['rev-admin', A, 200], ['rev-admin', B, 200], ['rev-admin', C, 200],
      ['rev-mgr', A, 200], ['rev-mgr', B, 200], ['rev-mgr', C, 403],
      ['rev-lead', A, 200], ['rev-lead', B, 403], ['rev-lead', C, 403],
      ['rev-eng', A, 200], ['rev-eng', B, 403],
      ['rev-viewer', A, 200], ['rev-viewer', C, 403],
      ['foreign', A, 403], ['rev-admin', 'demo-team-checkout', 403], ['rev-admin', 'no-such-team', 403],
    ];
    for (const [who, team, status] of cases) {
      const res = await get(`/api/revenue-impact/teams/${team}`, c[who]);
      expect(`${who} ${team} ${res.status}`).toBe(`${who} ${team} ${status}`);
      const wi = await get(`/api/revenue-impact/teams/${team}/what-if?metric=test_coverage&change=1`, c[who]);
      expect(`${who} ${team} what-if ${wi.status}`).toBe(`${who} ${team} what-if ${status}`);
    }
  });

  it('REV-021: unauthenticated requests get 401', async () => {
    if (!up) return;
    expect((await request(API_URL).get(`/api/revenue-impact/teams/${A}`)).status).toBe(401);
    expect((await request(API_URL).get('/api/revenue-impact/rollup')).status).toBe(401);
  });
});

describe('Revenue impact: roll-up', () => {
  it('REV-030: super admin: the sum over the company, with contributing and lacking teams', async () => {
    if (!up) return;
    const res = await get('/api/revenue-impact/rollup', c['rev-admin']);
    expect(res.status).toBe(200);
    const r = res.body.rollup;
    expect(r.teams).toBe(3);
    const expected = SLOPE * 3 + SLOPE * (METRICS_CONFIG.testCoverage.good - 75);
    expect(r.stake.monthly).toBeCloseTo(expected, 2);
    expect(r.stake.annual).toBeCloseTo(expected * 12, 1);
    expect(r.stake.monthlyLow).toBeCloseTo(CI[0] * 3 + CI[0] * (METRICS_CONFIG.testCoverage.good - 75), 2);
    expect(r.stake.contributing.sort()).toEqual([A, C]);
    expect(r.stake.lacking).toHaveLength(1);
    expect(r.stake.lacking[0]).toMatchObject({ teamId: B, teamName: 'Team B' });
    expect(r.debt).toMatchObject({ monthly: 5250, annual: 63000, contributing: [A] });
    expect(r.debt.lacking.map((t: any) => t.teamId).sort()).toEqual([B, C]);
    // The team list is the one the sums were made from.
    const sum = res.body.teams.filter((t: any) => t.stake.monthly !== null).reduce((a: number, t: any) => a + t.stake.monthly, 0);
    expect(sum).toBeCloseTo(r.stake.monthly, 6);
  });

  it('REV-031: department filter; a QA manager sums only the teams of their departments', async () => {
    if (!up) return;
    const d2 = await get(`/api/revenue-impact/rollup?departmentId=${DEPT2}`, c['rev-admin']);
    expect(d2.status).toBe(200);
    expect(d2.body.teams.map((t: any) => t.teamId)).toEqual([C]);
    const mgr = await get('/api/revenue-impact/rollup', c['rev-mgr']);
    expect(mgr.status).toBe(200);
    expect(mgr.body.teams.map((t: any) => t.teamId).sort()).toEqual([A, B]);
    expect(mgr.body.rollup.stake.monthly).toBeCloseTo(SLOPE * 3, 2);
    expect((await get(`/api/revenue-impact/rollup?departmentId=${DEPT2}`, c['rev-mgr'])).status).toBe(403);
    expect((await get('/api/revenue-impact/rollup?departmentId=demo-dept-platform', c['rev-admin'])).status).toBe(403);
  });

  it('REV-032: team lead, QA engineer and viewer get 403; another company sees only its own teams', async () => {
    if (!up) return;
    for (const who of ['rev-lead', 'rev-eng', 'rev-viewer']) {
      expect(`${who} ${(await get('/api/revenue-impact/rollup', c[who])).status}`).toBe(`${who} 403`);
    }
    const foreign = await get('/api/revenue-impact/rollup', c.foreign);
    expect(foreign.status).toBe(200);
    expect(foreign.body.teams.some((t: any) => String(t.teamId).startsWith('rev-team-'))).toBe(false);
  });
});
