import type { Client } from 'pg';
import { hash } from 'bcrypt';
import { backendUp, get, localDb, login, post, put } from './helpers/http';
import { addDays, periodFor, previousPeriod, wellbeingScore, PULSE_QUESTIONS } from '../../server/lib/pulseRules';
import { computeDdps } from '../../server/lib/metricFormulas';
import { SUPPRESSED_TEXT, K_ANONYMITY_MIN, privacyInfo } from '../../server/lib/privacy';

/**
 * Privacy (k-anonymity) and the wellbeing pulse survey (phase 3C).
 *
 * Fixture company "priv-co", one department, two teams:
 *   team A: 3 opted-in QA engineers (a1-a3) with developer metrics; a lead and a4 (engineer)
 *           who did NOT opt in; a viewer.            -> team figures shown (3 contributors)
 *   team B: 2 opted-in engineers (b1, b2) + b3 who opted out.  -> team figures suppressed
 * Every endpoint that aggregates individual developer data is checked with 2 vs 3 contributors
 * and with an opt-out; the survey for anonymity (no user reachable from an answer, via any
 * endpoint or SQL join), duplicate prevention, cadence, the >= 3 threshold and the role policy.
 * Runs against a live backend at API_URL; skips cleanly when none is running.
 */

const CO = 'priv-co';
const DEPT = 'priv-dept';
const A = 'priv-team-a';
const B = 'priv-team-b';
const OTHER_DEPT = 'priv-dept-2';
const C = 'priv-team-c';
const PW = 'demo123';

let up = true;
let db: Client;
const c: Record<string, string> = {};
let today = '';

interface Dev { id: string; team: string; insights: boolean; role: string; focus: number; meetings: number; switches: number; pr: number; review: number; wb: number }
const DEVS: Dev[] = [
  { id: 'priv-a1', team: A, insights: true, role: 'qa_engineer', focus: 5, meetings: 1, switches: 2, pr: 3, review: 1, wb: 80 },
  { id: 'priv-a2', team: A, insights: true, role: 'qa_engineer', focus: 3.5, meetings: 2.5, switches: 5, pr: 10, review: 3, wb: 60 },
  { id: 'priv-a3', team: A, insights: true, role: 'qa_engineer', focus: 2, meetings: 5.5, switches: 11, pr: 30, review: 9, wb: 30 },
  { id: 'priv-a4', team: A, insights: false, role: 'qa_engineer', focus: 1, meetings: 7, switches: 12, pr: 50, review: 10, wb: 10 },
  { id: 'priv-lead', team: A, insights: false, role: 'team_lead', focus: 4, meetings: 3, switches: 4, pr: 6, review: 2, wb: 55 },
  { id: 'priv-b1', team: B, insights: true, role: 'qa_engineer', focus: 4, meetings: 2, switches: 3, pr: 5, review: 2, wb: 70 },
  { id: 'priv-b2', team: B, insights: true, role: 'qa_engineer', focus: 3, meetings: 3, switches: 6, pr: 12, review: 4, wb: 50 },
  { id: 'priv-b3', team: B, insights: false, role: 'qa_engineer', focus: 2, meetings: 4, switches: 8, pr: 20, review: 6, wb: 40 },
];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r2 = (v: number) => Math.round(v * 100) / 100;

async function cleanup(db: Client) {
  await db.query(`DELETE FROM pulse_participation WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM pulse_responses WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM pulse_cadences WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM developer_productivity_snapshots WHERE developer_id LIKE 'priv-%'`);
  await db.query(`DELETE FROM developer_metrics WHERE team_id LIKE 'priv-team-%'`);
  await db.query(`DELETE FROM role_assignments WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM team_members WHERE team_id LIKE 'priv-team-%'`);
  await db.query(`DELETE FROM audit_log WHERE company_id = $1`, [CO]).catch(() => undefined);
  await db.query(`DELETE FROM users WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM teams WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM departments WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM companies WHERE id = $1`, [CO]);
}

async function addUser(id: string, role: string, opts: { insights?: boolean; scopeType?: string; scopeId?: string; dept?: string; primary?: string | null } = {}) {
  const pw = await hash(PW, 4);
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified, developer_insights_enabled)
     VALUES ($1, $2, $3, 'Priv', $4, $5, $6, $7, $8, TRUE, TRUE, $9)`,
    [id, `${id}@priv.example`, pw, id, role, CO, opts.dept ?? DEPT, opts.primary ?? null, opts.insights ?? false]
  );
  if (opts.scopeType) {
    await db.query(
      `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [`priv-ra-${id}`, CO, id, role, opts.scopeType, opts.scopeId]
    );
  }
}

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  await cleanup(db);
  today = (await db.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;
  await db.query(`INSERT INTO companies (id, name, domain, is_active) VALUES ($1, 'Privacy Fixture Co', 'priv.example', TRUE)`, [CO]);
  await db.query(`INSERT INTO departments (id, company_id, name, is_active) VALUES ($1, $2, 'Privacy', TRUE), ($3, $2, 'Other', TRUE)`, [DEPT, CO, OTHER_DEPT]);
  for (const [id, dept, name] of [[A, DEPT, 'Team A'], [B, DEPT, 'Team B'], [C, OTHER_DEPT, 'Team C']]) {
    await db.query(
      `INSERT INTO teams (id, company_id, department_id, name, is_active, ai_enabled, exclude_from_auto_sync) VALUES ($1, $2, $3, $4, TRUE, TRUE, TRUE)`,
      [id, CO, dept, name]
    );
  }
  await addUser('priv-admin', 'super_admin', { scopeType: 'company', scopeId: CO });
  await addUser('priv-mgr', 'qa_manager', { scopeType: 'department', scopeId: DEPT });
  await addUser('priv-mgr2', 'qa_manager', { scopeType: 'department', scopeId: OTHER_DEPT, dept: OTHER_DEPT });
  await addUser('priv-viewer', 'viewer', { scopeType: 'team', scopeId: A, primary: A });
  for (const d of DEVS) {
    await addUser(d.id, d.role, { insights: d.insights, scopeType: 'team', scopeId: d.team, primary: d.team });
    await db.query(
      `INSERT INTO developer_metrics (id, team_id, developer_id, pr_merge_time_avg, code_review_time_avg, focus_time_hours, meeting_time_hours, context_switches_per_day, happiness_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [`dm-${d.id}`, d.team, d.id, d.pr, d.review, d.focus, d.meetings, d.switches, d.wb]
    );
    for (let t = 1; t <= 3; t++) {
      await db.query(
        `INSERT INTO developer_productivity_snapshots (developer_id, snapshot_date, focus_time_hours, pr_merge_time_avg, code_review_time_avg, meeting_time_hours, context_switches_per_day)
         VALUES ($1, $2::date - $3::int, $4, $5, $6, $7, $8)`,
        [d.id, today, t, d.focus, d.pr, d.review, d.meetings, d.switches]
      );
    }
  }
  for (const who of ['priv-admin', 'priv-mgr', 'priv-mgr2', 'priv-viewer', 'priv-lead', 'priv-a1', 'priv-a2', 'priv-a3', 'priv-a4', 'priv-b1', 'priv-b2', 'priv-b3']) {
    c[who] = (await login(`${who}@priv.example`)).cookie;
  }
  c.foreign = (await login('alex.morgan@northwind.example')).cookie;
}, 60000);

afterAll(async () => {
  if (db) {
    await cleanup(db);
    await db.end();
  }
});

const optedIn = (team: string) => DEVS.filter((d) => d.team === team && d.insights);

describe('Privacy helper (server/lib/privacy.ts)', () => {
  it('PRIV-000: 1-2 contributors suppressed without revealing the count; 0 is "no data"; 3 shown', () => {
    expect(K_ANONYMITY_MIN).toBe(3);
    expect(privacyInfo(2)).toEqual({ suppressed: true, contributors: null, reason: SUPPRESSED_TEXT, minContributors: 3 });
    expect(privacyInfo(1).suppressed).toBe(true);
    expect(privacyInfo(0)).toMatchObject({ suppressed: false, contributors: 0 });
    expect(privacyInfo(3)).toMatchObject({ suppressed: false, contributors: 3, reason: null });
    expect(SUPPRESSED_TEXT).toBe('Not shown: fewer than 3 contributors');
  });
});

describe('k-anonymity of developer aggregates (2 vs 3 contributors, opt-out)', () => {
  it('PRIV-001: developer-metrics summary: team A (3 opted in) shown with the exact means; opted-out people left out', async () => {
    if (!up) return;
    const res = await get(`/api/analytics/developer-metrics?teamId=${A}`, c['priv-admin']);
    expect(res.status).toBe(200);
    const s = res.body.summary;
    expect(s.privacy).toEqual({ suppressed: false, contributors: 3, reason: null, minContributors: 3 });
    const ds = optedIn(A);
    expect(s.averages.focusHours).toBe(r2(mean(ds.map((d) => d.focus))));
    expect(s.averages.meetingHours).toBe(r2(mean(ds.map((d) => d.meetings))));
    expect(s.averages.prMergeHours).toBe(r2(mean(ds.map((d) => d.pr))));
    expect(s.averages.workloadBalance).toBe(Math.round(mean(ds.map((d) => d.wb)) * 10) / 10);
    const ddps = mean(ds.map((d) => computeDdps({ focus_time_hours: d.focus, meeting_time_hours: d.meetings, context_switches_per_day: d.switches, pr_merge_time_avg: d.pr, code_review_time_avg: d.review }).score!));
    expect(s.averages.ddps).toBe(Math.round(ddps * 10) / 10);
    expect(s.burnout).toEqual({ high: 1, moderate: 1, low: 1 });
    // Individual rows: opted-in people only (the opted-out a4 and lead are not listed to the admin).
    expect(res.body.developers.map((d: any) => d.developer_id).sort()).toEqual(['priv-a1', 'priv-a2', 'priv-a3']);
  });

  it('PRIV-002: team B (2 opted in + 1 opted out): every aggregate withheld, count not revealed', async () => {
    if (!up) return;
    const res = await get(`/api/analytics/developer-metrics?teamId=${B}`, c['priv-admin']);
    expect(res.status).toBe(200);
    const s = res.body.summary;
    expect(s.privacy).toEqual({ suppressed: true, contributors: null, reason: SUPPRESSED_TEXT, minContributors: 3 });
    expect(Object.values(s.averages).every((v) => v === null)).toBe(true);
    expect(s.burnout).toBeNull();
    expect(JSON.stringify(s)).not.toMatch(/"contributors":2/);
    // Individual rows of opted-in developers stay visible to the admin (existing rule).
    expect(res.body.developers.map((d: any) => d.developer_id).sort()).toEqual(['priv-b1', 'priv-b2']);
  });

  it('PRIV-003: opting out drops team A below 3 and suppresses it; opting back in shows it again', async () => {
    if (!up) return;
    await db.query(`UPDATE users SET developer_insights_enabled = FALSE WHERE id = 'priv-a3'`);
    try {
      const res = await get(`/api/analytics/developer-metrics?teamId=${A}`, c['priv-admin']);
      expect(res.body.summary.privacy.suppressed).toBe(true);
      expect(res.body.summary.averages.focusHours).toBeNull();
      const all = await get(`/api/metrics/team/${A}/all`, c['priv-admin']);
      expect(all.body.primaryMetrics.find((m: any) => m.id === 'avg_focus_time').value).toBeNull();
      const company = await get('/api/analytics/company-summary', c['priv-admin']);
      expect(company.body.workloadBalanceIndex).toBeNull();
      expect(company.body.workloadBalanceBasis.suppressed).toBe(false); // 0 qualifying teams = no data
      expect(company.body.workloadBalanceBasis.teamsSuppressed).toBe(2);
    } finally {
      await db.query(`UPDATE users SET developer_insights_enabled = TRUE WHERE id = 'priv-a3'`);
    }
    const again = await get(`/api/analytics/developer-metrics?teamId=${A}`, c['priv-admin']);
    expect(again.body.summary.privacy.contributors).toBe(3);
  });

  it('PRIV-004: GET /api/metrics/team/:id/all: developer averages and burnout only for team A', async () => {
    if (!up) return;
    const a = await get(`/api/metrics/team/${A}/all`, c['priv-admin']);
    expect(a.status).toBe(200);
    const pick = (body: any, id: string) => [...body.primaryMetrics, ...body.compositeMetrics].find((m: any) => m.id === id);
    expect(pick(a.body, 'avg_focus_time').value).toBe(r2(mean(optedIn(A).map((d) => d.focus))));
    expect(pick(a.body, 'avg_focus_time').privacy.suppressed).toBe(false);
    expect(pick(a.body, 'avg_developer_happiness').value).not.toBeNull();
    expect(pick(a.body, 'team_burnout_risk').value).not.toBe('Unknown');
    const b = await get(`/api/metrics/team/${B}/all`, c['priv-admin']);
    for (const id of ['avg_pr_merge_time', 'avg_code_review_time', 'avg_focus_time', 'avg_meeting_time', 'avg_context_switches']) {
      expect(pick(b.body, id).value).toBeNull();
      expect(pick(b.body, id).privacy).toMatchObject({ suppressed: true, reason: SUPPRESSED_TEXT });
    }
    expect(pick(b.body, 'avg_developer_happiness').value).toBeNull();
    expect(pick(b.body, 'team_burnout_risk').value).toBe('Unknown');
    expect(pick(b.body, 'avg_developer_happiness').components.developer_count).toBeNull();
  });

  it('PRIV-005: DDPS history: team statistics and daily points need 3 opted-in developers; one developer\'s own history stays individual', async () => {
    if (!up) return;
    const a = await get(`/api/analytics/ddps-history?teamId=${A}&range=7d`, c['priv-admin']);
    expect(a.status).toBe(200);
    expect(a.body.mode).toBe('team');
    expect(a.body.aggregatePrivacy).toMatchObject({ suppressed: false, contributors: 3 });
    expect(a.body.stats.average).not.toBeNull();
    expect(a.body.chartData.length).toBe(3);
    expect(a.body.chartData.every((p: any) => p.developers === 3 && p.ddps !== null)).toBe(true);
    const b = await get(`/api/analytics/ddps-history?teamId=${B}&range=7d`, c['priv-admin']);
    expect(b.body.mode).toBe('team');
    expect(b.body.aggregatePrivacy.suppressed).toBe(true);
    expect(b.body.stats).toMatchObject({ average: null, min: null, max: null, trend: null });
    expect(b.body.executiveSummary).toBeNull();
    expect(b.body.chartData.every((p: any) => p.ddps === null && p.developers === null && p.suppressed === true)).toBe(true);
    // One developer (a lead may see that person's rows): individual data, not an aggregate.
    const one = await get(`/api/analytics/ddps-history?teamId=${B}&range=7d&developerId=priv-b1`, c['priv-admin']);
    expect(one.body.mode).toBe('developer');
    expect(one.body.stats.average).not.toBeNull();
    // An engineer's own history is individual (their own data).
    const own = await get(`/api/analytics/ddps-history?teamId=${B}&range=7d`, c['priv-b1']);
    expect(own.body.mode).toBe('developer');
    expect(new Set(own.body.snapshots.map((s: any) => s.developer_id))).toEqual(new Set(['priv-b1']));
  });

  it('PRIV-006: developer recommendations: the team summary (status counts) only with 3 opted-in developers', async () => {
    if (!up) return;
    const a = await get(`/api/teams/${A}/developer-ai-suggestions`, c['priv-admin']);
    expect(a.status).toBe(200);
    expect(a.body.teamSummaryPrivacy).toMatchObject({ suppressed: false, contributors: 3 });
    expect(a.body.teamInsight).toMatch(/of 3 developers/);
    const b = await get(`/api/teams/${B}/developer-ai-suggestions`, c['priv-admin']);
    expect(b.body.teamSummaryPrivacy.suppressed).toBe(true);
    expect(b.body.teamInsight).toBe('Team summary not shown: fewer than 3 contributors.');
    // An engineer sees only their own recommendation and no team summary.
    const own = await get(`/api/teams/${A}/developer-ai-suggestions`, c['priv-a1']);
    expect(own.body.developers.map((d: any) => d.developerId)).toEqual(['priv-a1']);
    expect(own.body.teamInsight).toBeNull();
  });

  it('PRIV-007: company summary: workload balance only from teams that reach 3 (team B left out); it is not wellbeing', async () => {
    if (!up) return;
    const res = await get('/api/analytics/company-summary', c['priv-admin']);
    expect(res.status).toBe(200);
    const w = res.body.workloadBalanceBasis;
    expect(w).toMatchObject({ suppressed: false, contributors: 3, teamsIncluded: 1, teamsSuppressed: 1 });
    expect(w.avgFocusHours).toBe(Math.round(mean(optedIn(A).map((d) => d.focus)) * 10) / 10);
    expect(res.body.workloadBalanceIndex).toBe(Math.round(mean(optedIn(A).map((d) => d.wb))));
    expect(w.method).toMatch(/not wellbeing/);
    expect(res.body.engineeringHealthBasis.weights).toEqual({ deliveryPerformance: 0.35, pipelineHealth: 0.25, techDebtStatus: 0.2, wellbeingSurvey: 0.2 });
    expect(res.body.engineeringHealthBasis.weights.workloadBalance).toBeUndefined();
  });

  it('PRIV-008: role rules still apply: engineer and viewer get no one else\'s rows; another company gets 403', async () => {
    if (!up) return;
    const eng = await get(`/api/analytics/developer-metrics?teamId=${A}`, c['priv-a2']);
    expect(eng.status).toBe(200);
    expect(eng.body.individualScope).toBe('self');
    expect(eng.body.developers.map((d: any) => d.developer_id)).toEqual(['priv-a2']);
    expect(eng.body.summary.privacy.contributors).toBe(3); // team figure, k-anonymous
    const viewer = await get(`/api/analytics/developer-metrics?teamId=${A}`, c['priv-viewer']);
    expect(viewer.body.developers).toEqual([]);
    const notOptedIn = await get(`/api/analytics/developer-metrics?teamId=${A}`, c['priv-a4']);
    expect(notOptedIn.body.developers.map((d: any) => d.developer_id)).toEqual(['priv-a4']); // own row always
    const otherDept = await get(`/api/analytics/developer-metrics?teamId=${A}`, c['priv-mgr2']);
    expect(otherDept.status).toBe(403);
    const foreign = await get(`/api/analytics/developer-metrics?teamId=${A}`, c.foreign);
    expect(foreign.status).toBe(403);
    expect((await get(`/api/analytics/ddps-history?teamId=${A}`, c.foreign)).status).toBe(403);
  });
});

/* ------------------------------------------------------------------------------------------ */

const answers = (v: number) => Object.fromEntries(PULSE_QUESTIONS.map((q) => [q.key, v]));

describe('Pulse survey: access and answering', () => {
  it('PULSE-001: GET for members and managers in scope; 403 for another department and another company', async () => {
    if (!up) return;
    const res = await get(`/api/pulse/teams/${A}`, c['priv-a1']);
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(5);
    expect(res.body.scale).toMatchObject({ min: 1, max: 5 });
    expect(res.body.canRespond).toBe(true);
    expect(res.body.canSetCadence).toBe(false);
    expect(res.body.canViewComments).toBe(false);
    const p = periodFor([], today);
    expect(res.body.currentPeriod).toMatchObject({ start: p.start, end: p.end, responded: false });
    for (const who of ['priv-viewer', 'priv-lead']) expect((await get(`/api/pulse/teams/${A}`, c[who])).body.canRespond).toBe(true);
    const admin = await get(`/api/pulse/teams/${A}`, c['priv-admin']);
    expect(admin.body).toMatchObject({ canRespond: false, canSetCadence: true, canViewComments: true });
    expect((await get(`/api/pulse/teams/${A}`, c['priv-mgr'])).body.canSetCadence).toBe(true);
    expect((await get(`/api/pulse/teams/${A}`, c['priv-mgr2'])).status).toBe(403);
    expect((await get(`/api/pulse/teams/${A}`, c.foreign)).status).toBe(403);
    expect((await get(`/api/pulse/teams/${A}`, '')).status).toBe(401);
    expect((await get(`/api/pulse/teams/does-not-exist`, c['priv-admin'])).status).toBe(403);
  });

  it('PULSE-002: only team members may answer; invalid answers are refused', async () => {
    if (!up) return;
    expect((await post(`/api/pulse/teams/${A}/responses`, c['priv-admin'], { answers: answers(3) })).status).toBe(403);
    expect((await post(`/api/pulse/teams/${A}/responses`, c['priv-mgr'], { answers: answers(3) })).status).toBe(403);
    expect((await post(`/api/pulse/teams/${A}/responses`, c['priv-b1'], { answers: answers(3) })).status).toBe(403);
    expect((await post(`/api/pulse/teams/${A}/responses`, c.foreign, { answers: answers(3) })).status).toBe(403);
    expect((await post(`/api/pulse/teams/${A}/responses`, '', { answers: answers(3) })).status).toBe(401);
    const bad = [
      { answers: { ...answers(3), focus: undefined } },
      { answers: answers(0) },
      { answers: answers(6) },
      { answers: { ...answers(3), energy: 2.5 } },
      { answers: answers(3), comment: 'x'.repeat(501) },
      { answers: answers(3), comment: 42 },
    ];
    for (const body of bad) expect((await post(`/api/pulse/teams/${A}/responses`, c['priv-a1'], body)).status).toBe(400);
    const n = (await db.query(`SELECT count(*)::int AS n FROM pulse_responses WHERE team_id = $1`, [A])).rows[0].n;
    expect(n).toBe(0);
  });

  it('PULSE-003: one answer per person and period (duplicates refused with 409)', async () => {
    if (!up) return;
    const first = await post(`/api/pulse/teams/${A}/responses`, c['priv-a1'], { answers: answers(4), comment: 'Good sprint' });
    expect(first.status).toBe(201);
    expect(first.body.period).toEqual({ start: periodFor([], today).start, end: periodFor([], today).end });
    const again = await post(`/api/pulse/teams/${A}/responses`, c['priv-a1'], { answers: answers(2) });
    expect(again.status).toBe(409);
    const st = await get(`/api/pulse/teams/${A}`, c['priv-a1']);
    expect(st.body.currentPeriod.responded).toBe(true);
    expect((await get(`/api/pulse/teams/${A}`, c['priv-a2'])).body.currentPeriod.responded).toBe(false);
    // A person on another team answers that team's survey independently.
    expect((await post(`/api/pulse/teams/${B}/responses`, c['priv-b1'], { answers: answers(3) })).status).toBe(201);
    const counts = (await db.query(`SELECT team_id, count(*)::int AS n FROM pulse_responses WHERE company_id = $1 GROUP BY team_id ORDER BY team_id`, [CO])).rows;
    expect(counts).toEqual([{ team_id: A, n: 1 }, { team_id: B, n: 1 }]);
  });

  it('PULSE-004: answers cannot be linked to a person: no user or time column, no shared key, rewritten on every answer', async () => {
    if (!up) return;
    const cols = async (t: string) => (await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [t]
    )).rows.map((r: any) => r.column_name);
    expect(await cols('pulse_responses')).toEqual(['id', 'company_id', 'team_id', 'period_start', 'period_end', 'q_workload', 'q_focus', 'q_support', 'q_energy', 'q_outlook', 'comment']);
    expect(await cols('pulse_participation')).toEqual(['company_id', 'team_id', 'user_id', 'period_start']);
    // No foreign key between the two tables, and no column of the answers refers to users.
    const fks = (await db.query(
      `SELECT conrelid::regclass::text AS t, confrelid::regclass::text AS ref FROM pg_constraint
        WHERE contype = 'f' AND conrelid IN ('pulse_responses'::regclass, 'pulse_participation'::regclass)`
    )).rows;
    expect(fks.filter((f: any) => f.t === 'pulse_responses').map((f: any) => f.ref).sort()).toEqual(['companies', 'teams']);
    expect(fks.some((f: any) => f.ref === 'pulse_responses' || f.ref === 'pulse_participation')).toBe(false);

    const ids = async () => (await db.query(`SELECT id FROM pulse_responses WHERE team_id = $1`, [A])).rows.map((r: any) => r.id).sort();
    const before = await ids();
    expect((await post(`/api/pulse/teams/${A}/responses`, c['priv-a2'], { answers: answers(2) })).status).toBe(201);
    expect((await post(`/api/pulse/teams/${A}/responses`, c['priv-viewer'], { answers: answers(5) })).status).toBe(201);
    const after = await ids();
    expect(after).toHaveLength(3);
    // Every answer got a fresh id (the earlier ids are gone), so an id seen before does not follow the person.
    expect(after.filter((id: string) => before.includes(id))).toEqual([]);
    // All answers of the period were written by the last submission: one transaction id for all of them.
    const xmins = (await db.query(`SELECT count(DISTINCT xmin::text)::int AS n FROM pulse_responses WHERE team_id = $1`, [A])).rows[0].n;
    expect(xmins).toBe(1);
    // The only join available (team + period) relates every participant to every answer of the period.
    const join = (await db.query(
      `SELECT p.user_id, count(r.id)::int AS n FROM pulse_participation p JOIN pulse_responses r
         ON r.team_id = p.team_id AND r.period_start = p.period_start WHERE p.team_id = $1 GROUP BY p.user_id`, [A]
    )).rows;
    expect(join).toHaveLength(3);
    expect(join.every((r: any) => r.n === 3)).toBe(true);
  });

  it('PULSE-005: no endpoint returns single answers, respondents or the running period', async () => {
    if (!up) return;
    for (const who of ['priv-admin', 'priv-mgr', 'priv-lead', 'priv-a1']) {
      const res = await get(`/api/pulse/teams/${A}`, c[who]);
      const text = JSON.stringify(res.body);
      for (const uid of ['priv-a1', 'priv-a2', 'priv-viewer']) expect(text).not.toContain(uid);
      expect(text).not.toContain('Good sprint'); // running-period comment
      expect(res.body.periods.some((p: any) => p.start === res.body.currentPeriod.start)).toBe(false);
      expect(res.body.latest.start).not.toBe(res.body.currentPeriod.start);
      // Running period: only "fewer than 3 so far" / a count from 3, never values.
      expect(res.body.currentPeriod.responsesSoFar).toBe(3);
    }
    const audit = (await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action LIKE 'pulse%'`, [CO])).rows[0].n;
    expect(audit).toBe(0);
  });
});

describe('Pulse survey: results with at least 3 responses', () => {
  const prev = () => previousPeriod([], today);
  const insertClosed = async (team: string, start: string, end: string, values: number[], comments: Array<string | null> = []) => {
    for (const [i, v] of values.entries()) {
      await db.query(
        `INSERT INTO pulse_responses (company_id, team_id, period_start, period_end, q_workload, q_focus, q_support, q_energy, q_outlook, comment)
         VALUES ($1, $2, $3, $4, $5, $5, $5, $5, $5, $6)`,
        [CO, team, start, end, v, comments[i] ?? null]
      );
    }
  };

  it('PULSE-006: a closed period with 2 responses is suppressed (no score, no count, no comments)', async () => {
    if (!up) return;
    await insertClosed(B, prev().start, prev().end, [5, 1], ['Only two of us']);
    const res = await get(`/api/pulse/teams/${B}`, c['priv-admin']);
    expect(res.status).toBe(200);
    expect(res.body.latest).toMatchObject({ start: prev().start, suppressed: true, responses: null, score: null, questions: null, reason: SUPPRESSED_TEXT });
    expect(res.body.comments).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('Only two of us');
  });

  it('PULSE-007: with 3 responses the period shows the score, the question means and sorted comments (leads, managers, admins only)', async () => {
    if (!up) return;
    await insertClosed(A, prev().start, prev().end, [5, 4, 2], ['Zebra crossing', null, 'Apples']);
    // An older closed period with 2 responses: a gap in the trend.
    const older = periodFor([], addDays(prev().start, -1));
    await insertClosed(A, older.start, older.end, [3, 3]);
    const res = await get(`/api/pulse/teams/${A}`, c['priv-lead']);
    const expected = wellbeingScore(mean([5, 4, 2]));
    expect(res.body.latest).toMatchObject({ start: prev().start, suppressed: false, responses: 3, score: expected });
    expect(res.body.latest.questions.map((q: any) => q.mean)).toEqual([3.7, 3.7, 3.7, 3.7, 3.7]);
    expect(res.body.comments).toEqual(['Apples', 'Zebra crossing']);
    expect(res.body.periods.map((p: any) => [p.start, p.suppressed])).toEqual([[older.start, true], [prev().start, false]]);
    expect((await get(`/api/pulse/teams/${A}`, c['priv-mgr'])).body.comments).toEqual(['Apples', 'Zebra crossing']);
    // Members (engineer, viewer) see the aggregate but not the comments.
    for (const who of ['priv-a1', 'priv-viewer']) {
      const m = await get(`/api/pulse/teams/${A}`, c[who]);
      expect(m.body.latest.score).toBe(expected);
      expect(m.body.comments).toBeNull();
    }
  });

  it('PULSE-008: company wellbeing (survey) uses teams with 3+ responses only and feeds engineering health', async () => {
    if (!up) return;
    const res = await get('/api/analytics/company-summary', c['priv-admin']);
    expect(res.body.developerWellnessIndex).toBe(Math.round(wellbeingScore(mean([5, 4, 2]))!));
    expect(res.body.developerWellnessBasis).toMatchObject({ teamsReporting: 1, teamsTotal: 3, teamsSuppressed: 1, responses: 3, minResponses: 3 });
    expect(res.body.engineeringHealthBasis.included).toContain('wellbeingSurvey');
    const team = await get(`/api/metrics/team/${A}/all`, c['priv-admin']);
    expect(team.body.compositeMetrics.find((m: any) => m.id === 'wellbeing_survey').value).toBe(wellbeingScore(mean([5, 4, 2])));
    const teamB = await get(`/api/metrics/team/${B}/all`, c['priv-admin']);
    const wb = teamB.body.compositeMetrics.find((m: any) => m.id === 'wellbeing_survey');
    expect(wb.value).toBeNull();
    expect(wb.privacy.suppressed).toBe(true);
  });

  it('PULSE-009: without any survey result engineering health leaves wellbeing out (not replaced) and says so', async () => {
    if (!up) return;
    await db.query(`DELETE FROM pulse_responses WHERE company_id = $1 AND period_start < $2::date`, [CO, periodFor([], today).start]);
    const res = await get('/api/analytics/company-summary', c['priv-admin']);
    expect(res.body.developerWellnessIndex).toBeNull();
    expect(res.body.engineeringHealthBasis.missing).toContain('wellbeingSurvey');
    expect(res.body.engineeringHealthConfidence.inputsTotal).toBe(4);
    expect(res.body.engineeringHealthConfidence.inputsUsed).toBe(res.body.engineeringHealthBasis.included.length);
    expect(res.body.engineeringHealthBasis.included).not.toContain('workloadBalance');
  });
});

describe('Pulse survey: cadence', () => {
  it('PULSE-010: lead, manager and admin may set the cadence; it starts with the next period; others get 403', async () => {
    if (!up) return;
    const cur = periodFor([], today);
    expect((await put(`/api/pulse/teams/${A}/cadence`, c['priv-a1'], { cadence: 'weekly' })).status).toBe(403);
    expect((await put(`/api/pulse/teams/${A}/cadence`, c['priv-viewer'], { cadence: 'weekly' })).status).toBe(403);
    expect((await put(`/api/pulse/teams/${A}/cadence`, c['priv-mgr2'], { cadence: 'weekly' })).status).toBe(403);
    expect((await put(`/api/pulse/teams/${A}/cadence`, c.foreign, { cadence: 'weekly' })).status).toBe(403);
    expect((await put(`/api/pulse/teams/${A}/cadence`, c['priv-lead'], { cadence: 'daily' })).status).toBe(400);

    const res = await put(`/api/pulse/teams/${A}/cadence`, c['priv-lead'], { cadence: 'weekly' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cadence: 'biweekly', pendingCadence: { cadence: 'weekly', from: cur.end } });
    const st = await get(`/api/pulse/teams/${A}`, c['priv-lead']);
    expect(st.body.cadence).toBe('biweekly');
    expect(st.body.pendingCadence).toEqual({ cadence: 'weekly', from: cur.end });
    expect(st.body.currentPeriod).toMatchObject({ start: cur.start, end: cur.end });
    // Periods after the change are weekly, counted from the change.
    expect(periodFor([{ cadence: 'weekly', effective_from: cur.end }], addDays(cur.end, 8))).toMatchObject({ start: addDays(cur.end, 7), end: addDays(cur.end, 14) });
    // Back to the cadence in force: the waiting change is cancelled.
    const back = await put(`/api/pulse/teams/${A}/cadence`, c['priv-mgr'], { cadence: 'biweekly' });
    expect(back.body).toMatchObject({ cadence: 'biweekly', pendingCadence: null });
    expect((await put(`/api/pulse/teams/${A}/cadence`, c['priv-admin'], { cadence: 'weekly' })).status).toBe(200);
    const audit = (await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'team.pulse_cadence'`, [CO])).rows[0].n;
    expect(audit).toBe(3);
  });

  it('PULSE-011: period arithmetic (default biweekly from Monday 2026-01-05; weekly counted from its start)', () => {
    expect(periodFor([], '2026-01-05')).toEqual({ start: '2026-01-05', end: '2026-01-19', cadence: 'biweekly' });
    expect(periodFor([], '2026-01-18')).toMatchObject({ start: '2026-01-05' });
    expect(periodFor([], '2026-01-19')).toMatchObject({ start: '2026-01-19', end: '2026-02-02' });
    expect(periodFor([], '2026-01-04')).toMatchObject({ start: '2025-12-22', end: '2026-01-05' });
    const rows = [{ cadence: 'weekly' as const, effective_from: '2026-02-02' }];
    expect(periodFor(rows, '2026-02-01')).toMatchObject({ start: '2026-01-19', cadence: 'biweekly' });
    expect(periodFor(rows, '2026-02-10')).toEqual({ start: '2026-02-09', end: '2026-02-16', cadence: 'weekly' });
    expect(previousPeriod(rows, '2026-02-03')).toMatchObject({ start: '2026-01-19', end: '2026-02-02' });
  });
});
