import request from 'supertest';
import { API_URL, NEW_PW, backendUp, del, get, localDb, login, post, put } from './helpers/http';

/**
 * Release R2 Phase 4 fixes (docs/reports/r2-final-review.md), one test per fix:
 *   FIX-001  POST /api/metrics/developer is a partial update (omitted fields keep their value)
 *            and range-checks every value (400, never 500)
 *   FIX-002  PUT /api/analytics/technical-debt/:id/impact keeps omitted fields; ranges → 400
 *   FIX-003  business-impact month / bulk / config endpoints: out-of-range values → 400
 *   FIX-004  a body over the JSON limit → 413 { error: 'Payload too large' }
 *   FIX-005  QA managers read team detail and AI insights only for teams of their departments
 *   FIX-006  /api/metrics/dashboard and /api/metrics/analytics/{teams,history} leave stale values out
 */

let up = true;
const c: Record<string, string> = {};
const T: Record<string, string> = {};
const D: Record<string, string> = {};
const ids: Record<string, string> = {};
const created: string[] = [];
let stamp = 0;

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  stamp = Date.now();
  c.admin = (await login('admin@irongate.com')).cookie;
  for (const k of ['A', 'B']) D[k] = (await post('/api/admin/departments', c.admin, { name: `Fixes ${k} ${stamp}` })).body.id;
  T.A1 = (await post('/api/admin/teams', c.admin, { name: `Fixes A1 ${stamp}`, departmentId: D.A })).body.id;
  T.B1 = (await post('/api/admin/teams', c.admin, { name: `Fixes B1 ${stamp}`, departmentId: D.B })).body.id;
  const mk = async (key: string, role: string, where: object) => {
    const email = `fixes-${key}-${stamp}@irongate.test`;
    const r = await post('/api/admin/users', c.admin, { email, password: NEW_PW, firstName: 'Fix', lastName: key, role, ...where });
    ids[key] = r.body.id;
    created.push(r.body.id);
    c[key] = (await login(email, NEW_PW)).cookie;
  };
  await mk('manager', 'qa_manager', { departmentId: D.A });
  await mk('dev', 'qa_engineer', { teamId: T.A1 });
});

afterAll(async () => {
  if (!up) return;
  const db = await localDb();
  try {
    await db.query('DELETE FROM technical_debt WHERE team_id = ANY($1::text[])', [[T.A1, T.B1]]);
  } finally { await db.end(); }
  for (const u of created) await del(`/api/admin/users/${u}`, c.admin);
  for (const t of ['A1', 'B1']) if (T[t]) await del(`/api/admin/teams/${T[t]}`, c.admin);
  for (const d of ['A', 'B']) if (D[d]) await del(`/api/admin/departments/${D[d]}`, c.admin);
});

const skip = () => !up || !T.A1;

describe('R2 Phase 4 fixes', () => {
  it('FIX-001: developer metrics: partial update keeps omitted fields; invalid values are 400', async () => {
    if (skip()) return;
    const full = await post('/api/metrics/developer', c.admin, {
      teamId: T.A1, developerId: ids.dev, prMergeTimeAvg: 6, codeReviewTimeAvg: 2, focusTimeHours: 4, meetingTimeHours: 2, contextSwitchesPerDay: 5, happinessScore: 70,
    });
    expect(full.status).toBe(200);
    const part = await post('/api/metrics/developer', c.admin, { teamId: T.A1, developerId: ids.dev, focusTimeHours: 5.5 });
    expect(part.status).toBe(200);
    expect(part.body.updated).toEqual(['focusTimeHours']);
    const db = await localDb();
    try {
      const { rows } = await db.query('SELECT * FROM developer_metrics WHERE team_id = $1 AND developer_id = $2', [T.A1, ids.dev]);
      expect(Number(rows[0].focus_time_hours)).toBe(5.5);
      expect(Number(rows[0].pr_merge_time_avg)).toBe(6);
      expect(Number(rows[0].context_switches_per_day)).toBe(5);
      expect(Number(rows[0].happiness_score)).toBe(70);
    } finally { await db.end(); }
    // An explicit null clears one field.
    expect((await post('/api/metrics/developer', c.admin, { teamId: T.A1, developerId: ids.dev, happinessScore: null })).status).toBe(200);
    // Ranges and types: 400 with a message, never a database error.
    for (const bad of [{ focusTimeHours: 25 }, { contextSwitchesPerDay: 2.5 }, { prMergeTimeAvg: 'abc' }, { happinessScore: 101 }, { codeReviewTimeAvg: 1e12 }]) {
      const r = await post('/api/metrics/developer', c.admin, { teamId: T.A1, developerId: ids.dev, ...bad });
      expect({ bad, status: r.status }).toEqual({ bad, status: 400 });
      expect(typeof r.body.error).toBe('string');
    }
    // Writers only (the shared team-write rule): the engineer may not, the manager of A may.
    expect((await post('/api/metrics/developer', c.dev, { teamId: T.A1, developerId: ids.dev, focusTimeHours: 3 })).status).toBe(403);
    expect((await post('/api/metrics/developer', c.manager, { teamId: T.A1, developerId: ids.dev, focusTimeHours: 3 })).status).toBe(200);
    expect((await post('/api/metrics/developer', c.manager, { teamId: T.B1, developerId: ids.dev, focusTimeHours: 3 })).status).toBe(403);
  });

  it('FIX-002: technical debt impact: omitted fields are kept; ranges are 400', async () => {
    if (skip()) return;
    const db = await localDb();
    let debtId = '';
    try {
      const company = (await db.query('SELECT company_id FROM teams WHERE id = $1', [T.A1])).rows[0].company_id;
      debtId = (await db.query(
        `INSERT INTO technical_debt (team_id, company_id, title, affected_users, support_tickets_monthly, revenue_impact_percent, effort_hours)
         VALUES ($1, $2, 'Fixes debt item', 1200, 14, 2.5, 40) RETURNING id`, [T.A1, company])).rows[0].id;
    } finally { await db.end(); }
    const r = await put(`/api/analytics/technical-debt/${debtId}/impact`, c.admin, { support_tickets_monthly: 20 });
    expect(r.status).toBe(200);
    const db2 = await localDb();
    try {
      const row = (await db2.query('SELECT * FROM technical_debt WHERE id = $1', [debtId])).rows[0];
      expect(Number(row.support_tickets_monthly)).toBe(20);
      expect(Number(row.affected_users)).toBe(1200);
      expect(Number(row.revenue_impact_percent)).toBe(2.5);
      expect(Number(row.effort_hours)).toBe(40);
    } finally { await db2.end(); }
    expect((await put(`/api/analytics/technical-debt/${debtId}/impact`, c.admin, { revenue_impact_percent: 250 })).status).toBe(400);
    expect((await put(`/api/analytics/technical-debt/${debtId}/impact`, c.admin, { affected_users: -1 })).status).toBe(400);
    expect((await put(`/api/analytics/technical-debt/${debtId}/impact`, c.admin, {})).status).toBe(400);
  });

  it('FIX-003: business impact: out-of-range values are 400, never 500', async () => {
    if (skip()) return;
    const base = `/api/analytics/business-impact-v2/${T.A1}`;
    expect((await post(`${base}/quality-metrics`, c.admin, { month_year: '2026-01', test_coverage: 1e9 })).status).toBe(400);
    expect((await post(`${base}/quality-metrics`, c.admin, { month_year: '2026-01', test_coverage: 140 })).status).toBe(400);
    expect((await post(`${base}/business-kpis`, c.admin, { month_year: '2026-01', monthly_revenue: 1e20 })).status).toBe(400);
    expect((await post(`${base}/business-kpis`, c.admin, { month_year: '2026-01', nps_score: -150 })).status).toBe(400);
    expect((await post(`${base}/context`, c.admin, { month_year: '2026-01', team_size: 2.5 })).status).toBe(400);
    const bulk = await post(`${base}/bulk-save`, c.admin, { monthlyData: [{ month_year: '2026-02', quality: { change_failure_rate: 900 } }] });
    expect(bulk.status).toBe(400);
    expect(bulk.body.error).toMatch(/2026-02/);
    const cfg = await post(`/api/metrics/business-impact-config/${T.A1}`, c.admin, {
      impactConfigs: [{ metric_name: 'coverage', quality_score: 80, revenue_impact: 1000, customer_satisfaction: 80, feature_adoption_rate: 50, correlation_strength: 5 }],
      historicalConfigs: [],
    });
    expect(cfg.status).toBe(400);
    // A valid value still saves.
    expect((await post(`${base}/quality-metrics`, c.admin, { month_year: '2026-01', test_coverage: 81.5 })).status).toBe(200);
  });

  it('FIX-004: a body over the JSON limit is 413 "Payload too large"', async () => {
    if (!up) return;
    const big = JSON.stringify({ teamId: 'x', blob: 'a'.repeat(200 * 1024) });
    const r = await request(API_URL).post('/api/metrics/manual').set('Cookie', c.admin).set('Content-Type', 'application/json').send(big);
    expect(r.status).toBe(413);
    expect(r.body.error).toBe('Payload too large');
    const bad = await request(API_URL).post('/api/metrics/manual').set('Cookie', c.admin).set('Content-Type', 'application/json').send('{"teamId":');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('Bad request');
  });

  it('FIX-005: a QA manager reads team detail and AI insights only in their departments', async () => {
    if (skip()) return;
    expect((await get(`/api/metrics/teams/${T.B1}/history`, c.manager)).status).toBe(403);
    expect((await get(`/api/metrics/teams/${T.A1}/history`, c.manager)).status).toBe(200);
    expect((await get(`/api/teams/${T.B1}/ai-suggestions`, c.manager)).status).toBe(403);
    expect((await get(`/api/teams/${T.A1}/ai-suggestions`, c.dev)).status).toBe(403);
    const ok = await get(`/api/teams/${T.A1}/ai-suggestions`, c.manager);
    expect(ok.status).not.toBe(403);
    expect(ok.status).toBeLessThan(500);
  });

  it('FIX-006: company metric reads leave stale values out', async () => {
    if (skip()) return;
    // A1: every QA input recorded 20 days ago (coverage is expected daily → stale), B1: today.
    const old = new Date(Date.now() - 20 * 86400000).toISOString();
    const inputs = { test_coverage: 91, defect_escape_rate: 3, change_failure_rate: 4, code_quality_score: 90, automation_coverage: 80 };
    expect((await post('/api/metrics/manual', c.admin, { teamId: T.A1, recordedAt: old, ...inputs })).status).toBe(200);
    expect((await post('/api/metrics/manual', c.admin, { teamId: T.B1, ...inputs, test_coverage: 70 })).status).toBe(200);
    const teams = (await get('/api/metrics/analytics/teams', c.admin)).body.teams as any[];
    const a1 = teams.find((t) => t.id === T.A1);
    const b1 = teams.find((t) => t.id === T.B1);
    expect(a1.test_coverage).toBeNull();
    expect(a1.stale_metrics).toContain('test_coverage');
    expect(a1.qa_score).toBeNull();
    expect(a1.qa_score_recorded).not.toBeNull();
    expect(b1.test_coverage).toBe(70);
    expect(b1.qa_score).not.toBeNull();
    const dash = (await get('/api/metrics/dashboard', c.admin)).body;
    expect(typeof dash.aggregate).toBe('string');
    expect((dash.topTeams as any[]).some((t) => t.id === T.A1)).toBe(false);
    const hist = (await get('/api/metrics/analytics/history?days=3', c.admin)).body;
    expect(Array.isArray(hist.history)).toBe(true);
    expect(typeof hist.staleness).toBe('string');
  });
});
