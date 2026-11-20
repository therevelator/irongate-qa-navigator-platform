import type { Client } from 'pg';
import { hash } from 'bcrypt';
import request from 'supertest';
import { API_URL, backendUp, get, localDb, login } from './helpers/http';
import { previousPeriod, todayUtc } from '../../server/lib/pulseRules';

/**
 * Executive summary API (GET /api/summary: server/routes/summary.ts, server/lib/executiveSummary.ts).
 *
 * Fixture company "sum-co": department One with teams A and B, department Two with team C. Each
 * team has a KPI snapshot today and one 10 days ago ("last week" = the latest snapshot dated 7–14
 * days ago). QA score = coverage × 0.30 + (100 − escape) × 0.25 + (100 − CFR) × 0.25 + code quality × 0.20:
 *   A  now 50 / 20 / 20 / 50 → 65 (critical), last week 64 / 15 / 20 / 50 → 70 (watch): every KPI off target
 *   B  now 90 /  2 /  4 / 92 → 94, last week 80 / 4 / 4 / 92 → 90: every KPI on target
 *   C  now 85 /  6 /  5 / 85 → 90, last week 85 / 6 / 5 / 80 → 89: defect escape 6 % > 5 %
 * Alerts: A critical open (now), B warning acknowledged (3 days ago), C warning resolved 2 days ago
 * (opened 20 days ago). Actions: A done 2 days ago, B open and overdue. One open debt item on A.
 * Users: super admin, QA manager of One, team lead of A, viewer of C, a viewer without a team.
 * Runs against a live backend at API_URL; skips cleanly when none is running.
 */

const CO = 'sum-co';
const D1 = 'sum-dept-1';
const D2 = 'sum-dept-2';
const A = 'sum-team-a';
const B = 'sum-team-b';
const C = 'sum-team-c';
const PW = 'demo123';

let up = true;
let db: Client;
const c: Record<string, string> = {};

async function cleanup(db: Client) {
  await db.query(`DELETE FROM pulse_responses WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM team_actions WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM alerts WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM technical_debt WHERE team_id LIKE 'sum-team-%'`);
  await db.query(`DELETE FROM kpi_snapshots WHERE team_id LIKE 'sum-team-%'`);
  await db.query(`DELETE FROM role_assignments WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM audit_log WHERE company_id = $1`, [CO]).catch(() => undefined);
  await db.query(`DELETE FROM user_activity WHERE company_id = $1`, [CO]).catch(() => undefined);
  await db.query(`DELETE FROM users WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM teams WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM departments WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM companies WHERE id = $1`, [CO]);
}

async function addUser(id: string, role: string, scope: [string, string] | null, dept: string | null = D1, primary: string | null = null) {
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
     VALUES ($1, $2, $3, 'Sum', $4, $5, $6, $7, $8, TRUE, TRUE)`,
    [id, `${id}@sum.example`, await hash(PW, 4), id, role, CO, dept, primary]
  );
  if (scope) {
    await db.query(
      `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [`sum-ra-${id}`, CO, id, role, scope[0], scope[1]]
    );
  }
}

/** coverage, escape, CFR, code quality, automation, flakiness */
async function snapshot(team: string, daysAgo: number, v: [number, number, number, number, number, number]) {
  await db.query(
    `INSERT INTO kpi_snapshots (team_id, snapshot_date, test_coverage, defect_escape_rate, change_failure_rate, code_quality_score, automation_coverage, test_flakiness_rate)
     VALUES ($1, CURRENT_DATE - $2::int, $3, $4, $5, $6, $7, $8)`,
    [team, daysAgo, ...v]
  );
}

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  await cleanup(db);
  await db.query(`INSERT INTO companies (id, name, domain, is_active) VALUES ($1, 'Summary Fixture Co', 'sum.example', TRUE)`, [CO]);
  await db.query(`INSERT INTO departments (id, company_id, name, is_active) VALUES ($1, $2, 'Dept One', TRUE), ($3, $2, 'Dept Two', TRUE)`, [D1, CO, D2]);
  for (const [id, dept, name] of [[A, D1, 'Team A'], [B, D1, 'Team B'], [C, D2, 'Team C']]) {
    await db.query(`INSERT INTO teams (id, company_id, department_id, name, is_active) VALUES ($1, $2, $3, $4, TRUE)`, [id, CO, dept, name]);
  }
  await snapshot(A, 0, [50, 20, 20, 50, 50, 8]);
  await snapshot(A, 10, [64, 15, 20, 50, 55, 7]);
  await snapshot(B, 0, [90, 2, 4, 92, 80, 1]);
  await snapshot(B, 10, [80, 4, 4, 92, 78, 1]);
  await snapshot(C, 0, [85, 6, 5, 85, 75, 1.5]);
  await snapshot(C, 10, [85, 6, 5, 80, 75, 1.5]);
  await db.query(
    `INSERT INTO alerts (id, company_id, team_id, rule, metric_key, severity, message, dedupe_key, created_at, last_seen_at, acknowledged_at, resolved_at) VALUES
       ('sum-al-a', $1, $2, 'threshold_breach', 'test_coverage', 'critical', 'Coverage below target', 'sum-a', now(), now(), NULL, NULL),
       ('sum-al-b', $1, $3, 'threshold_breach', 'test_coverage', 'warning', 'Coverage near target', 'sum-b', now() - interval '3 days', now(), now() - interval '1 day', NULL),
       ('sum-al-c', $1, $4, 'threshold_breach', 'defect_escape_rate', 'warning', 'Escape rate above target', 'sum-c', now() - interval '20 days', now(), NULL, now() - interval '2 days')`,
    [CO, A, B, C]
  );
  await db.query(
    `INSERT INTO team_actions (id, company_id, team_id, title, status, due_date, completed_at) VALUES
       ('sum-act-a', $1, $2, 'Raise coverage', 'done', CURRENT_DATE + 5, now() - interval '2 days'),
       ('sum-act-b', $1, $3, 'Fix flaky suite', 'open', CURRENT_DATE - 1, NULL)`,
    [CO, A, B]
  );
  await db.query(
    `INSERT INTO technical_debt (id, team_id, company_id, title, severity, status, effort_hours, affected_users, support_tickets_monthly, downtime_minutes_monthly, revenue_impact_percent, sla_breaches_monthly)
     VALUES ('sum-td-1', $1, $2, 'Open item', 'high', 'open', 40, 1000, 10, 30, 2, 1)`,
    [A, CO]
  );
  // Wellbeing pulse of the latest closed period (default cadence): C 3 answers (shown), B 2 (hidden).
  const prev = previousPeriod([], todayUtc());
  for (const [team, values] of [[C, [4, 5, 3]], [B, [2, 2]]] as const) {
    for (const v of values) {
      await db.query(
        `INSERT INTO pulse_responses (company_id, team_id, period_start, period_end, q_workload, q_focus, q_support, q_energy, q_outlook, comment)
         VALUES ($1, $2, $3, $4, $5, $5, $5, $5, $5, 'tv must not show this comment')`,
        [CO, team, prev.start, prev.end, v]
      );
    }
  }
  await addUser('sum-admin', 'super_admin', ['company', CO]);
  await addUser('sum-mgr', 'qa_manager', ['department', D1]);
  await addUser('sum-lead', 'team_lead', ['team', A], D1, A);
  await addUser('sum-viewer', 'viewer', ['team', C], D2, C);
  await addUser('sum-none', 'viewer', null, D2, null);
  for (const who of ['sum-admin', 'sum-mgr', 'sum-lead', 'sum-viewer', 'sum-none']) c[who] = (await login(`${who}@sum.example`)).cookie;
  c.foreign = (await login('alex.morgan@northwind.example')).cookie;
}, 60000);

afterAll(async () => {
  if (db) {
    await cleanup(db);
    await db.end();
  }
});

const summary = async (who: string) => {
  const res = await get('/api/summary', c[who]);
  expect(res.status).toBe(200);
  return res.body;
};
const ids = (list: Array<{ teamId: string }>) => list.map((x) => x.teamId);

describe('Executive summary: scope', () => {
  it('SUM-001: needs a session', async () => {
    if (!up) return;
    expect((await request(API_URL).get('/api/summary')).status).toBe(401);
  });

  it('SUM-002: super admin: the whole company, labelled with the company name', async () => {
    if (!up) return;
    const s = await summary('sum-admin');
    expect(s.scope).toMatchObject({ level: 'company', label: 'Summary Fixture Co', teamCount: 3 });
    expect(ids(s.teams).sort()).toEqual([A, B, C]);
  });

  it('SUM-003: QA manager: the teams of the department they manage only', async () => {
    if (!up) return;
    const s = await summary('sum-mgr');
    expect(s.scope).toMatchObject({ level: 'department', label: 'Dept One', teamCount: 2 });
    expect(ids(s.teams).sort()).toEqual([A, B]);
    expect(JSON.stringify(s)).not.toContain(C);
  });

  it('SUM-004: team lead and viewer: their own team only; no money roll-up for them', async () => {
    if (!up) return;
    const lead = await summary('sum-lead');
    expect(lead.scope).toMatchObject({ level: 'team', label: 'Team A', teamCount: 1 });
    expect(ids(lead.teams)).toEqual([A]);
    expect(lead.money).toMatchObject({ available: false });
    const viewer = await summary('sum-viewer');
    expect(ids(viewer.teams)).toEqual([C]);
    expect(JSON.stringify(viewer)).not.toMatch(/sum-team-[ab]/);
  });

  it('SUM-005: no team in scope: an empty summary (200), no figures', async () => {
    if (!up) return;
    const s = await summary('sum-none');
    expect(s).toMatchObject({ empty: true, quality: null, money: null, alerts: null, teams: [] });
  });

  it('SUM-006: another company never sees these teams; no e-mail addresses in the payload', async () => {
    if (!up) return;
    const res = await get('/api/summary', c.foreign);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('sum-team-');
    expect(JSON.stringify(await summary('sum-admin'))).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});

describe('Executive summary: numbers', () => {
  it('SUM-010: team QA scores now and last week, from the snapshots (hand-computed)', async () => {
    if (!up) return;
    const s = await summary('sum-admin');
    const byId = Object.fromEntries(s.teams.map((t: any) => [t.teamId, t]));
    expect(byId[A]).toMatchObject({ qaScore: 65, status: 'critical', weekChange: -5 });
    expect(byId[B]).toMatchObject({ qaScore: 94, status: 'good', weekChange: 4 });
    expect(byId[C]).toMatchObject({ qaScore: 90, status: 'good', weekChange: 1 });
  });

  it('SUM-011: the team figures equal TV mode / Team detail (GET /api/tv/teams/:id)', async () => {
    if (!up) return;
    const s = await summary('sum-admin');
    for (const t of s.teams) {
      const tv = await get(`/api/tv/teams/${t.teamId}`, c['sum-admin']);
      expect(tv.body.latest.qaScore).toBe(t.qaScore);
    }
  });

  it('SUM-012: the scope QA score and its weekly change equal the overview (company-summary) for the same person', async () => {
    if (!up) return;
    for (const who of ['sum-admin', 'sum-mgr', 'sum-lead']) {
      const s = await summary(who);
      const o = (await get('/api/analytics/company-summary', c[who])).body;
      expect(s.quality.score).toBe(o.globalQaScore);
      expect(s.quality.weekChange).toBe(o.globalQaScoreTrend);
      expect(s.quality.kpiStatus).toEqual(o.kpiStatus);
      expect(s.quality.teamCount).toBe(o.teamCount);
    }
    const mgr = await summary('sum-mgr');
    expect(mgr.quality.score).toBe(Math.round((65 + 94) / 2));
  });

  it('SUM-013: biggest risks: off-target teams, lowest QA score first, each item with its target and weekly trend', async () => {
    if (!up) return;
    const s = await summary('sum-admin');
    expect(ids(s.risks.top)).toEqual([A, C]);
    expect(s.risks.total).toBe(2);
    const a = s.risks.top[0];
    expect(a.items[0]).toMatchObject({ key: 'qaScore', value: 65, target: 85, weekChange: -5, trend: 'worse' });
    expect(a.items.map((i: any) => i.key).sort()).toEqual(['automationCoverage', 'defectEscapeRate', 'qaScore', 'testCoverage', 'testFlakinessRate']);
    expect(a.items.find((i: any) => i.key === 'testCoverage')).toMatchObject({ value: 50, target: 80, lowerIsBetter: false, weekChange: -14, trend: 'worse' });
    expect(a.items.find((i: any) => i.key === 'defectEscapeRate')).toMatchObject({ value: 20, target: 5, lowerIsBetter: true, weekChange: 5, trend: 'worse' });
    expect(s.risks.top[1].items).toEqual([expect.objectContaining({ key: 'defectEscapeRate', value: 6, target: 5, weekChange: 0, trend: 'same' })]);
  });

  it('SUM-014: most improved: QA score rises since last week, biggest first', async () => {
    if (!up) return;
    const s = await summary('sum-admin');
    expect(s.improved.top).toEqual([
      expect.objectContaining({ teamId: B, qaScore: 94, prevQaScore: 90, weekChange: 4 }),
      expect.objectContaining({ teamId: C, qaScore: 90, prevQaScore: 89, weekChange: 1 }),
    ]);
    expect((await summary('sum-lead')).improved.top).toEqual([]);
  });

  it('SUM-015: open alerts: the Alerts page counts for the same person, plus opened / resolved this week', async () => {
    if (!up) return;
    const s = await summary('sum-admin');
    const page = (await get('/api/alerts?status=open', c['sum-admin'])).body.counts;
    expect(s.alerts).toMatchObject({ open: page.open, acknowledged: page.acknowledged, critical: page.critical, warning: page.warning });
    expect(s.alerts).toMatchObject({ open: 1, acknowledged: 1, critical: 1, warning: 1, openedThisWeek: 2, resolvedThisWeek: 1 });
    expect((await summary('sum-mgr')).alerts).toMatchObject({ open: 1, acknowledged: 1, resolvedThisWeek: 0 });
    expect((await summary('sum-viewer')).alerts).toMatchObject({ open: 0, acknowledged: 0, resolvedThisWeek: 1 });
  });

  it('SUM-016: since last week: movement, status changes and tracked actions', async () => {
    if (!up) return;
    const s = await summary('sum-admin');
    expect(s.sinceLastWeek.movement).toEqual({ up: 2, down: 1, same: 0, compared: 3 });
    expect(s.sinceLastWeek.statusChanges).toEqual([expect.objectContaining({ teamId: A, from: 'warning', to: 'critical', better: false })]);
    expect(s.sinceLastWeek).toMatchObject({ actionsDone: 1, actionsOverdue: 1, actionsCreated: 2, alertsOpened: 2, alertsResolved: 1 });
  });

  it('SUM-017: money at risk is the Business impact roll-up over the same teams', async () => {
    if (!up) return;
    for (const who of ['sum-admin', 'sum-mgr']) {
      const s = await summary(who);
      const roll = (await get('/api/revenue-impact/rollup', c[who])).body.rollup;
      expect(s.money.available).toBe(true);
      expect(s.money.teams).toBe(roll.teams);
      expect(s.money.stake.monthly).toBe(roll.stake.monthly);
      expect(s.money.stake.monthlyLow).toBe(roll.stake.monthlyLow);
      expect(s.money.stake.monthlyHigh).toBe(roll.stake.monthlyHigh);
      expect(s.money.debt.monthly).toBe(roll.debt.monthly);
      expect(s.money.debt.monthly).toBeGreaterThan(0);
      expect(s.money.assumptionsPath).toMatch(/business-impact/);
    }
  });
});

describe('TV mode payload: alerts and wellbeing pulse', () => {
  const tv = (team: string, who = 'sum-admin') => get(`/api/tv/teams/${team}`, c[who]);

  it('TVP-001: open alerts of the team (count by severity, most urgent first), no names', async () => {
    if (!up) return;
    const a = (await tv(A)).body.alerts;
    expect(a.counts).toEqual({ open: 1, acknowledged: 0, critical: 1, warning: 0, info: 0 });
    expect(a.items).toEqual([expect.objectContaining({ severity: 'critical', message: 'Coverage below target', metricLabel: 'Test coverage', acknowledged: false })]);
    expect((await tv(B)).body.alerts.counts).toMatchObject({ open: 0, acknowledged: 1 });
    expect((await tv(C)).body.alerts.counts).toMatchObject({ open: 0, acknowledged: 0 }); // resolved alerts are not shown
  });

  it('TVP-002: wellbeing pulse: the latest closed period, shown from 3 responses; never comments', async () => {
    if (!up) return;
    const pc = (await tv(C, 'sum-viewer')).body.pulse;
    expect(pc.latest).toMatchObject({ suppressed: false, responses: 3, score: 75 });
    expect(pc.latest.questions).toHaveLength(5);
    expect(pc.minResponses).toBe(3);
    const pb = (await tv(B)).body.pulse;
    expect(pb.latest).toMatchObject({ suppressed: true, responses: null, score: null, questions: null });
    expect(JSON.stringify((await tv(C)).body)).not.toContain('tv must not show this comment');
  });

  it('TVP-003: a team outside the scope is refused (403), with its alerts and pulse', async () => {
    if (!up) return;
    expect((await tv(A, 'sum-viewer')).status).toBe(403);
    expect((await tv(C, 'sum-mgr')).status).toBe(403);
  });
});
