import type { Client } from 'pg';
import { hash } from 'bcrypt';
import { backendUp, get, localDb, login, post } from './helpers/http';

/**
 * Improve API (v2 phase 4: server/routes/improve.ts, server/lib/forecast, server/lib/recommendations):
 * forecasts and recommendations of a team, scoped like the team's KPI history; accept → a tracked
 * action linked to the recommendation and its metric; dismiss with a reason; reopen; the action's
 * before / after from the snapshot history; the executive summary's "at this rate".
 *
 * Fixture company "imp-co": department One with teams A (declining for 20 weeks, Lending-like, with
 * flaky-test evidence from CI) and B (3 weeks of history only), department Two with team C (on
 * target but coverage falling towards its target). Users: super admin, QA manager of One, team lead
 * of A, engineer of A, team lead of B, viewer of C.
 * Runs against a live backend at API_URL; skips cleanly when none is running.
 */

const CO = 'imp-co';
const D1 = 'imp-dept-1';
const D2 = 'imp-dept-2';
const A = 'imp-team-a';
const B = 'imp-team-b';
const C = 'imp-team-c';
const PW = 'demo123';

let up = true;
let db: Client;
const c: Record<string, string> = {};

async function cleanup(db: Client) {
  await db.query(`DELETE FROM recommendations WHERE company_id = $1`, [CO]).catch(() => undefined);
  await db.query(`DELETE FROM forecasts WHERE company_id = $1`, [CO]).catch(() => undefined);
  await db.query(`DELETE FROM notifications WHERE company_id = $1`, [CO]).catch(() => undefined);
  await db.query(`DELETE FROM team_actions WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM flaky_test_evidence WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM metric_values WHERE company_id = $1`, [CO]);
  await db.query(`DELETE FROM kpi_snapshots WHERE team_id LIKE 'imp-team-%'`);
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
     VALUES ($1, $2, $3, 'Imp', $4, $5, $6, $7, $8, TRUE, TRUE)`,
    [id, `${id}@imp.example`, await hash(PW, 4), id, role, CO, dept, primary]
  );
  if (scope) {
    await db.query(`INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4, $5, $6)`, [`imp-ra-${id}`, CO, id, role, scope[0], scope[1]]);
  }
}

type Series = Record<string, (w: number) => number>;
/** One value per week (w weeks ago, recorded at 08:00 UTC) in metric_values and the same day's snapshot. */
async function history(team: string, weeks: number, series: Series) {
  for (let w = weeks - 1; w >= 0; w--) {
    const cols = Object.keys(series);
    const vals = cols.map((k) => Math.round(series[k](w) * 100) / 100);
    for (let i = 0; i < cols.length; i++) {
      await db.query(
        `INSERT INTO metric_values (company_id, team_id, metric_key, value, recorded_at, source)
         VALUES ($1, $2, $3, $4, (CURRENT_DATE - $5::int)::timestamp + interval '8 hours', 'api')`,
        [CO, team, cols[i], vals[i], w * 7]
      );
    }
    await db.query(
      `INSERT INTO kpi_snapshots (team_id, snapshot_date, ${cols.join(', ')}) VALUES ($1, CURRENT_DATE - $2::int, ${cols.map((_, i) => `$${i + 3}`).join(', ')})`,
      [team, w * 7, ...vals.map((v, i) => (cols[i] === 'code_quality_score' || cols[i] === 'blocked_time_hours' ? Math.round(v) : v))]
    );
  }
}

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  await cleanup(db);
  await db.query(`INSERT INTO companies (id, name, domain, is_active) VALUES ($1, 'Improve Fixture Co', 'imp.example', TRUE)`, [CO]);
  await db.query(`INSERT INTO departments (id, company_id, name, is_active) VALUES ($1, $2, 'Dept One', TRUE), ($3, $2, 'Dept Two', TRUE)`, [D1, CO, D2]);
  for (const [id, dept, name] of [[A, D1, 'Lending A'], [B, D1, 'Young B'], [C, D2, 'Steady C']]) {
    await db.query(`INSERT INTO teams (id, company_id, department_id, name, is_active) VALUES ($1, $2, $3, $4, TRUE)`, [id, CO, dept, name]);
  }
  // A: 20 weeks, declining (Lending-like). Today: coverage 56, escape 21, flakiness 6, CFR 25, code quality 60.
  await history(A, 20, {
    test_coverage: (w) => 56 + w * 0.8,
    defect_escape_rate: (w) => 21 - w * 0.4,
    test_flakiness_rate: (w) => 6 - w * 0.12,
    change_failure_rate: (w) => 25 - w * 0.5,
    code_quality_score: (w) => 60 + w,
  });
  // B: 3 weeks only.
  await history(B, 3, { test_coverage: () => 90, defect_escape_rate: () => 3 });
  // C: on target, coverage falling 0.6 a week to 84 today (target 80): below 80 from day 47.
  await history(C, 14, { test_coverage: (w) => 84 + w * 0.6, defect_escape_rate: () => 3, change_failure_rate: () => 4, code_quality_score: () => 88 });
  // CI evidence for A: two flaky tests (failed and passed on the same commit).
  await db.query(
    `INSERT INTO flaky_test_evidence (company_id, team_id, test_key, suite, name, commit_sha, failed_run_ids, passed_run_ids, first_seen, last_seen) VALUES
       ($1, $2, 'k1', 'src/offers/offers.test.ts', 'refunds a rate quote', 'c1', ARRAY['r1','r2','r3'], ARRAY['r4'], now() - interval '5 days', now() - interval '1 day'),
       ($1, $2, 'k2', 'src/credit/credit.test.ts', 'exports a loan offer', 'c2', ARRAY['r5'], ARRAY['r6'], now() - interval '4 days', now() - interval '2 days')`,
    [CO, A]
  );
  await addUser('imp-admin', 'super_admin', ['company', CO]);
  await addUser('imp-mgr', 'qa_manager', ['department', D1]);
  await addUser('imp-lead', 'team_lead', ['team', A], D1, A);
  await addUser('imp-eng', 'qa_engineer', ['team', A], D1, A);
  await addUser('imp-lead-b', 'team_lead', ['team', B], D1, B);
  await addUser('imp-viewer', 'viewer', ['team', C], D2, C);
  for (const who of ['imp-admin', 'imp-mgr', 'imp-lead', 'imp-eng', 'imp-lead-b', 'imp-viewer']) c[who] = (await login(`${who}@imp.example`)).cookie;
}, 90000);

afterAll(async () => {
  if (db) {
    await cleanup(db);
    await db.end();
  }
});

const improve = async (who: string, team = A) => {
  const res = await get(`/api/improve/teams/${team}`, c[who]);
  expect(res.status).toBe(200);
  return res.body;
};

describe('Improve: forecasts', () => {
  test('IMP-API-01 the first read calculates and stores the forecasts of every metric with history and the QA score', async () => {
    if (!up) return;
    const body = await improve('imp-lead');
    const metrics = body.forecasts.map((f: any) => f.metric).sort();
    expect(metrics).toEqual(['change_failure_rate', 'code_quality_score', 'defect_escape_rate', 'qa_score', 'test_coverage', 'test_flakiness_rate']);
    const cov = body.forecasts.find((f: any) => f.metric === 'test_coverage');
    expect(cov).toMatchObject({ status: 'ok', trend: 'worsening', outlook: 'stays_off', pointsUsed: 20, lastValue: 56, confidence: 'high', unit: '%' });
    expect(cov.slopePerWeek).toBeCloseTo(-0.8, 6);
    expect(cov.projection).toHaveLength(8);
    expect(cov.projection[7].value).toBeCloseTo(56 - 0.8 * 8, 4);
    expect(cov.targetNow).toEqual({ kind: 'min', good: 80, warning: 70 });
    expect(cov.text).toMatch(/^Stays off target ≥ 80%: about 49\.6% by \d+ \w+$/);
    const stored = await db.query(`SELECT count(*)::int AS n FROM forecasts WHERE team_id = $1`, [A]);
    expect(stored.rows[0].n).toBe(6);
    expect(body.text.forecastMethod).toMatch(/Theil–Sen/);
  });

  test('IMP-API-02 a target crossing: on target now and falling → misses the target with its day; too little history → not enough data with the reason', async () => {
    if (!up) return;
    const cBody = await improve('imp-viewer', C);
    const cov = cBody.forecasts.find((f: any) => f.metric === 'test_coverage');
    expect(cov.outlook).toBe('will_miss');
    // 84 − 0.6·d/7 < 80 from d = 47 (no spread: the band's edges give the same day).
    const day47 = new Date(Date.parse(`${cov.asOf}T00:00:00Z`) + 47 * 86_400_000).toISOString().slice(0, 10);
    expect(cov.crossing).toEqual({ day: day47, earliest: day47, latest: day47 });
    expect(cov.text).toMatch(/^Misses target ≥ 80% around \d+ \w+$/);
    const bBody = await improve('imp-lead-b', B);
    const b = bBody.forecasts.find((f: any) => f.metric === 'test_coverage');
    expect(b).toMatchObject({ status: 'insufficient', pointsUsed: 3, projection: [] });
    expect(b.reason).toBe('Values in 3 of the last 26 weeks; a forecast needs at least 6 weeks with values.');
    expect(b.text).toBe(`Not enough data: ${b.reason}`);
  });
});

describe('Improve: recommendations', () => {
  test('IMP-API-03 ranked recommendations with evidence, next step, expected effect and confidence; the flaky tests are named', async () => {
    if (!up) return;
    const body = await improve('imp-lead');
    expect(body.canManage).toBe(true);
    const open = body.recommendations.open;
    expect(open.length).toBeGreaterThanOrEqual(3);
    expect(open.length).toBeLessThanOrEqual(6);
    expect(open.map((r: any) => r.rank)).toEqual(open.map((_: any, i: number) => i + 1));
    const rules = open.map((r: any) => r.ruleKey);
    expect(rules).toEqual(expect.arrayContaining(['flaky_tests', 'coverage_gap']));
    const flaky = open.find((r: any) => r.ruleKey === 'flaky_tests');
    expect(flaky.title).toBe('Fix the 2 flaky tests: they failed 4 runs in the last 14 days');
    expect(flaky.items.map((i: any) => i.name)).toEqual(['src/offers/offers.test.ts › refunds a rate quote', 'src/credit/credit.test.ts › exports a loan offer']);
    expect(flaky.metric).toEqual({ key: 'test_flakiness_rate', label: 'Test flakiness rate', unit: '%' });
    expect(flaky.effectText).toMatch(/^Test flakiness rate −[\d.]+ to −[\d.]+ points \(to [\d.]+%–[\d.]+%\) in 2–4 weeks$/);
    expect(['high', 'medium']).toContain(flaky.confidence);
    const cov = open.find((r: any) => r.ruleKey === 'coverage_gap');
    expect(cov.evidence[0]).toEqual({ label: 'Test coverage', value: '56%', detail: 'target ≥ 80%' });
    expect(cov.nextStep).toMatch(/merge check/);
    expect(body.recommendations.accepted).toEqual([]);
  });

  test('IMP-API-04 scope: like the team’s KPI history; deciding = who may create actions', async () => {
    if (!up) return;
    expect((await get(`/api/improve/teams/${A}`, c['imp-mgr'])).status).toBe(200);
    expect((await get(`/api/improve/teams/${A}`, c['imp-admin'])).status).toBe(200);
    expect((await get(`/api/improve/teams/${A}`, c['imp-lead-b'])).status).toBe(403);
    expect((await get(`/api/improve/teams/${A}`, c['imp-viewer'])).status).toBe(403);
    expect((await get(`/api/improve/teams/${C}`, c['imp-mgr'])).status).toBe(403);
    expect((await get(`/api/improve/teams/${A}`, '')).status).toBe(401);
    const eng = await improve('imp-eng');
    expect(eng.canManage).toBe(false);
    const id = eng.recommendations.open[0].id;
    expect((await post(`/api/improve/recommendations/${id}/accept`, c['imp-eng'])).status).toBe(403);
    expect((await post(`/api/improve/recommendations/${id}/dismiss`, c['imp-eng'], { reason: 'Not now' })).status).toBe(403);
    expect((await post(`/api/improve/teams/${A}/refresh`, c['imp-eng'])).status).toBe(403);
    // Outside the scope: as if it did not exist.
    expect((await post(`/api/improve/recommendations/${id}/accept`, c['imp-lead-b'])).status).toBe(404);
    expect((await post(`/api/improve/recommendations/${id}/dismiss`, c['imp-viewer'], { reason: 'x y z' })).status).toBe(404);
  });

  test('IMP-API-05 accept → a tracked action linked to the recommendation and its metric, with its baseline; not twice', async () => {
    if (!up) return;
    const body = await improve('imp-lead');
    const rec = body.recommendations.open.find((r: any) => r.ruleKey === 'coverage_gap');
    const res = await post(`/api/improve/recommendations/${rec.id}/accept`, c['imp-lead'], { dueDate: '2027-01-15', ownerId: 'imp-eng' });
    expect(res.status).toBe(201);
    expect(res.body.recommendation).toMatchObject({ id: rec.id, status: 'accepted' });
    const row = (await db.query(`SELECT * FROM team_actions WHERE id = $1`, [res.body.actionId])).rows[0];
    expect(row).toMatchObject({ team_id: A, origin: 'recommendation', recommendation_id: rec.id, metric_key: 'test_coverage', status: 'open', owner_id: 'imp-eng', created_by: 'imp-lead' });
    expect(Number(row.baseline_value)).toBe(56);
    expect(row.title).toBe(rec.title);
    expect(row.description).toMatch(/^Next step: /);
    expect(row.description).toMatch(/Expected effect: Test coverage \+/);
    expect((await post(`/api/improve/recommendations/${rec.id}/accept`, c['imp-lead'])).status).toBe(409);
    expect((await post(`/api/improve/recommendations/${rec.id}/dismiss`, c['imp-lead'], { reason: 'Changed my mind' })).status).toBe(409);
    // The Action plan shows it with its recommendation and the before / after.
    const actions = (await get(`/api/actions?teamId=${A}`, c['imp-lead'])).body.actions;
    const a = actions.find((x: any) => x.id === res.body.actionId);
    expect(a.recommendation).toEqual({ id: rec.id, title: rec.title });
    expect(a.movement).toMatchObject({ metric: 'test_coverage', before: { value: 56 }, after: null, verdict: 'no_data' });
    // The Recommendations list shows it as accepted, with the action.
    const after = await improve('imp-lead');
    const acc = after.recommendations.accepted.find((r: any) => r.id === rec.id);
    expect(acc.action).toMatchObject({ id: res.body.actionId, status: 'open', owner: 'Imp imp-eng', dueDate: '2027-01-15' });
    expect(after.recommendations.open.find((r: any) => r.id === rec.id)).toBeUndefined();
    const audit = await db.query(`SELECT action FROM audit_log WHERE company_id = $1 AND entity_id = $2`, [CO, rec.id]);
    expect(audit.rows.map((r: any) => r.action)).toContain('recommendation.accept');
  });

  test('IMP-API-06 before / after from the snapshot history, with the date range', async () => {
    if (!up) return;
    const actionId = (await db.query(`SELECT id FROM team_actions WHERE team_id = $1 AND origin = 'recommendation'`, [A])).rows[0].id;
    // The action was created 14 days ago (coverage then 57.6, two weeks of history later); today's snapshot is 56.
    await db.query(`UPDATE team_actions SET created_at = now() - interval '14 days' WHERE id = $1`, [actionId]);
    let a = (await get(`/api/actions?teamId=${A}`, c['imp-lead'])).body.actions.find((x: any) => x.id === actionId);
    expect(a.movement).toMatchObject({ before: { value: 57.6 }, after: { value: 56 }, verdict: 'worse' });
    expect(a.movement.change).toBeCloseTo(-1.6, 6);
    expect(a.movement.before.day < a.movement.after.day).toBe(true);
    // A better value recorded today: improved.
    await db.query(`UPDATE kpi_snapshots SET test_coverage = 63 WHERE team_id = $1 AND snapshot_date = CURRENT_DATE`, [A]);
    a = (await get(`/api/actions?teamId=${A}`, c['imp-lead'])).body.actions.find((x: any) => x.id === actionId);
    expect(a.movement).toMatchObject({ before: { value: 57.6 }, after: { value: 63 }, verdict: 'improved' });
    const rec = (await improve('imp-lead')).recommendations.accepted[0];
    expect(rec.action.movement).toMatchObject({ verdict: 'improved', after: { value: 63 } });
    await db.query(`UPDATE kpi_snapshots SET test_coverage = 56 WHERE team_id = $1 AND snapshot_date = CURRENT_DATE`, [A]);
  });

  test('IMP-API-07 dismiss needs a reason; the reason and who are kept; reopen brings it back', async () => {
    if (!up) return;
    const body = await improve('imp-mgr');
    const rec = body.recommendations.open[0];
    expect((await post(`/api/improve/recommendations/${rec.id}/dismiss`, c['imp-mgr'], {})).status).toBe(400);
    expect((await post(`/api/improve/recommendations/${rec.id}/dismiss`, c['imp-mgr'], { reason: 'x' })).status).toBe(400);
    const res = await post(`/api/improve/recommendations/${rec.id}/dismiss`, c['imp-mgr'], { reason: 'Already being handled: platform team owns it' });
    expect(res.status).toBe(200);
    expect(res.body.recommendation).toMatchObject({ status: 'dismissed', dismissReason: 'Already being handled: platform team owns it', decidedBy: 'Imp imp-mgr' });
    // A recalculation keeps it dismissed (the decision is kept), and it is listed with the reason.
    expect((await post(`/api/improve/teams/${A}/refresh`, c['imp-lead'])).status).toBe(200);
    const after = await improve('imp-lead');
    expect(after.recommendations.dismissed.map((r: any) => r.id)).toContain(rec.id);
    expect(after.recommendations.open.map((r: any) => r.id)).not.toContain(rec.id);
    const re = await post(`/api/improve/recommendations/${rec.id}/reopen`, c['imp-lead']);
    expect(re.status).toBe(200);
    expect(re.body.recommendation).toMatchObject({ status: 'open', dismissReason: null });
    expect((await post(`/api/improve/recommendations/${rec.id}/reopen`, c['imp-lead'])).status).toBe(409);
    const audit = await db.query(`SELECT action FROM audit_log WHERE company_id = $1 AND entity_id = $2 ORDER BY created_at`, [CO, rec.id]);
    expect(audit.rows.map((r: any) => r.action)).toEqual(['recommendation.dismiss', 'recommendation.reopen']);
  });

  test('IMP-API-08 on target but forecast to miss → a recommendation before it happens; a rule that no longer fires hides its open one', async () => {
    if (!up) return;
    const cBody = await improve('imp-viewer', C);
    expect(cBody.canManage).toBe(false);
    expect(cBody.recommendations.open.map((r: any) => r.ruleKey)).toEqual(['coverage_gap']);
    expect(cBody.recommendations.open[0].title).toMatch(/^Test coverage \(84% now\) misses ≥ 80% around \d+ \w+ at this rate$/);
    expect(cBody.recommendations.open[0].evidence.find((e: any) => e.label === 'Forecast').value).toMatch(/^misses ≥ 80% around \d+ \w+$/);
    // Without A's flaky evidence and flakiness values the flaky-tests rule no longer fires: inactive.
    await db.query(`DELETE FROM flaky_test_evidence WHERE team_id = $1`, [A]);
    await db.query(`DELETE FROM metric_values WHERE team_id = $1 AND metric_key = 'test_flakiness_rate'`, [A]);
    const r = await post(`/api/improve/teams/${A}/refresh`, c['imp-admin']);
    expect(r.status).toBe(200);
    expect(r.body.recommendations.open.map((x: any) => x.ruleKey)).not.toContain('flaky_tests');
    const row = (await db.query(`SELECT active, status FROM recommendations WHERE team_id = $1 AND rule_key = 'flaky_tests'`, [A])).rows[0];
    expect(row).toEqual({ active: false, status: 'open' });
  });
});

describe('Improve: executive summary', () => {
  test('IMP-API-09 risks carry "at this rate …"; upcoming lists KPIs on target now but forecast to miss', async () => {
    if (!up) return;
    const res = await get('/api/summary', c['imp-admin']);
    expect(res.status).toBe(200);
    const riskA = res.body.risks.top.find((r: any) => r.teamId === A);
    const cov = riskA.items.find((i: any) => i.key === 'testCoverage');
    expect(cov.forecast).toMatchObject({ metric: 'test_coverage', outlook: 'stays_off' });
    expect(cov.forecast.text).toMatch(/^At this rate test coverage stays off target: about [\d.]+% by \d+ \w+ \(target ≥ 80%\)$/);
    const up1 = res.body.upcoming.top.find((u: any) => u.teamId === C && u.metric === 'test_coverage');
    expect(up1.text).toMatch(/^At this rate test coverage misses its target ≥ 80% around \d+ \w+$/);
    // A QA manager of department One does not see team C's upcoming risk.
    const mgr = await get('/api/summary', c['imp-mgr']);
    expect(mgr.body.upcoming.top.map((u: any) => u.teamId)).not.toContain(C);
  });
});
