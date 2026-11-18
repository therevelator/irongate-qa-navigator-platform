import type { Client } from 'pg';
import { backendUp, get, localDb, login, put } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

/**
 * KPI target history (GET/PUT /api/targets, table target_history) and its use:
 *   - a change closes the current row and opens a new one; nothing is rewritten;
 *   - team > department > company > default inheritance;
 *   - current values are judged with the target valid at their date (kpiThresholds,
 *     kpiTargets, company kpiStatusTeams); history gets the target periods so each day is
 *     judged with its own target;
 *   - policy: company targets super_admin only; department/team targets super_admin or that
 *     department's QA manager; team leads, engineers and viewers never; other companies 404.
 * Runs against a live backend at API_URL; skips cleanly when none is running.
 */

let up = true;
let db: Client;
const c: Record<string, string> = {};

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  await createGolden(db);
  // A QA manager of department B (teams Stale, Partial, Empty).
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, is_active, email_verified)
     SELECT 'golden-u-mgr', 'mgr@golden.example', password_hash, 'Morgan', 'Manager', 'qa_manager', $1, 'golden-dept-b', TRUE, TRUE
       FROM users WHERE id = 'golden-u-admin' ON CONFLICT (id) DO NOTHING`,
    [GOLDEN_COMPANY]
  );
  await db.query(
    `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id)
     VALUES ('golden-ra-mgr', $1, 'golden-u-mgr', 'qa_manager', 'department', 'golden-dept-b') ON CONFLICT (id) DO NOTHING`,
    [GOLDEN_COMPANY]
  );
  c.admin = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  c.manager = (await login('mgr@golden.example')).cookie;
  c.lead = (await login('partial-1@golden.example')).cookie; // team lead of Partial Team (dept B)
  c.engineer = (await login('partial-2@golden.example')).cookie;
  c.foreign = (await login('alex.morgan@northwind.example')).cookie;
});

afterAll(async () => {
  if (db) {
    await removeGolden(db);
    await db.end();
  }
});

describe('KPI targets with history', () => {
  it('TGT-001: GET returns the effective target per metric (defaults when nothing is stored) to any member of the company', async () => {
    if (!up) return;
    const res = await get('/api/targets?scopeType=team&scopeId=golden-team-partial', c.engineer);
    expect(res.status).toBe(200);
    expect(res.body.canEdit).toBe(false);
    const cov = res.body.metrics.find((m: any) => m.metric === 'test_coverage');
    expect(cov).toMatchObject({ key: 'testCoverage', lowerIsBetter: false, own: null, effective: { good: 80, warning: 70, scope: 'default' } });
    expect((await get('/api/targets?scopeType=team&scopeId=golden-team-partial', c.foreign)).status).toBe(404);
    expect((await get('/api/targets', '')).status).toBe(401);
  });

  it('TGT-002: policy — company scope super admin only; department/team scope super admin or that department\'s QA manager', async () => {
    if (!up) return;
    const body = (scopeType: string, scopeId: string | undefined) => ({ scopeType, scopeId, targets: { test_flakiness_rate: { good: 1.5, warning: 4 } } });
    expect((await put('/api/targets', c.manager, body('company', undefined))).status).toBe(403);
    expect((await put('/api/targets', c.manager, body('department', 'golden-dept-a'))).status).toBe(403);
    expect((await put('/api/targets', c.manager, body('team', 'golden-team-small'))).status).toBe(403); // dept A
    expect((await put('/api/targets', c.lead, body('team', 'golden-team-partial'))).status).toBe(403);
    expect((await put('/api/targets', c.engineer, body('team', 'golden-team-partial'))).status).toBe(403);
    expect((await put('/api/targets', c.foreign, body('team', 'golden-team-partial'))).status).toBe(404);
    expect((await put('/api/targets', '', body('team', 'golden-team-partial'))).status).toBe(401);
    expect((await put('/api/targets', c.manager, body('department', 'golden-dept-b'))).status).toBe(200);
    expect((await put('/api/targets', c.manager, body('team', 'golden-team-partial'))).status).toBe(200);
    expect((await put('/api/targets', c.admin, body('company', undefined))).status).toBe(200);
  });

  it('TGT-003: validation — unknown metric, non-numbers, out of range, warning on the wrong side', async () => {
    if (!up) return;
    const bad = async (targets: any) => (await put('/api/targets', c.admin, { scopeType: 'company', targets })).status;
    expect(await bad({ nope: { good: 1, warning: 2 } })).toBe(400);
    expect(await bad({ test_coverage: { good: 'x', warning: 70 } })).toBe(400);
    expect(await bad({ test_coverage: { good: 120, warning: 70 } })).toBe(400);
    expect(await bad({ test_coverage: { good: 80, warning: 90 } })).toBe(400); // higher is better: warning must be <= target
    expect(await bad({ defect_escape_rate: { good: 5, warning: 3 } })).toBe(400); // lower is better: warning must be >= target
    expect(await bad({})).toBe(400);
  });

  it('TGT-004: a change closes the current row and opens a new one; history and the change history record it', async () => {
    if (!up) return;
    const first = await put('/api/targets', c.admin, { scopeType: 'company', targets: { test_coverage: { good: 85, warning: 75 } } });
    expect(first.body.changed).toEqual(['test_coverage']);
    // Same values again: nothing changes.
    expect((await put('/api/targets', c.admin, { scopeType: 'company', targets: { test_coverage: { good: 85, warning: 75 } } })).body.changed).toEqual([]);
    const second = await put('/api/targets', c.admin, { scopeType: 'company', targets: { test_coverage: { good: 90, warning: 80 } } });
    expect(second.body.changed).toEqual(['test_coverage']);
    const { rows } = await db.query(
      `SELECT good::float8 AS good, valid_from, valid_to FROM target_history WHERE company_id = $1 AND scope_type = 'company' AND metric_key = 'test_coverage' ORDER BY valid_from`,
      [GOLDEN_COMPANY]
    );
    expect(rows.map((r) => r.good)).toEqual([85, 90]);
    expect(rows[0].valid_to).not.toBeNull();
    expect(new Date(rows[0].valid_to).getTime()).toBe(new Date(rows[1].valid_from).getTime());
    expect(rows[1].valid_to).toBeNull();
    const view = await get('/api/targets?scopeType=company', c.admin);
    expect(view.body.metrics.find((m: any) => m.metric === 'test_coverage').own).toMatchObject({ good: 90, warning: 80 });
    expect(view.body.history.filter((h: any) => h.metric === 'test_coverage').length).toBe(2);
    const audit = await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'targets.update'`, [GOLDEN_COMPANY]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('TGT-005: inheritance team > department > company > default, and removing an own target falls back to the parent', async () => {
    if (!up) return;
    await put('/api/targets', c.admin, { scopeType: 'department', scopeId: 'golden-dept-b', targets: { automation_coverage: { good: 60, warning: 40 } } });
    const eff = async (team: string) =>
      (await get(`/api/targets?scopeType=team&scopeId=${team}`, c.admin)).body.metrics.find((m: any) => m.metric === 'automation_coverage').effective;
    expect(await eff('golden-team-partial')).toMatchObject({ good: 60, scope: 'department' });
    expect(await eff('golden-team-small')).toMatchObject({ good: 70, scope: 'default' });
    await put('/api/targets', c.manager, { scopeType: 'team', scopeId: 'golden-team-partial', targets: { automation_coverage: { good: 75, warning: 55 } } });
    expect(await eff('golden-team-partial')).toMatchObject({ good: 75, scope: 'team' });
    await put('/api/targets', c.manager, { scopeType: 'team', scopeId: 'golden-team-partial', targets: { automation_coverage: null } });
    expect(await eff('golden-team-partial')).toMatchObject({ good: 60, scope: 'department' });
  });

  it('TGT-006: current values are judged with the target valid at their date; history days with the target of that day', async () => {
    if (!up) return;
    // Set while today's values exist: they are judged with it (company coverage 90 since TGT-004).
    const teams = (await get('/api/teams', c.admin)).body.teams;
    const big = teams.find((t: any) => t.id === 'golden-team-big');
    expect(big.kpiThresholds.testCoverage).toMatchObject({ good: 90, warning: 80, scope: 'company' });
    expect(big.kpiTargets.coverage).toBe(90);
    // Big Team's coverage today is 88: under the new 90 % target, so not met.
    const summary = (await get('/api/analytics/company-summary', c.admin)).body;
    const bigTrack = summary.kpiStatusTeams.find((t: any) => t.teamId === 'golden-team-big');
    expect(bigTrack.checks.find((ch: any) => ch.key === 'testCoverage')).toMatchObject({ value: 88, target: 90, met: false });
    // Backdate the company target rows (as if set 10 days ago) and check history periods.
    await db.query(
      `UPDATE target_history SET valid_from = valid_from - interval '10 days', valid_to = valid_to - interval '10 days'
        WHERE company_id = $1 AND scope_type = 'company' AND metric_key = 'test_coverage' AND valid_to IS NOT NULL`,
      [GOLDEN_COMPANY]
    );
    await db.query(
      `UPDATE target_history SET valid_from = valid_from - interval '10 days'
        WHERE company_id = $1 AND scope_type = 'company' AND metric_key = 'test_coverage' AND valid_to IS NULL`,
      [GOLDEN_COMPANY]
    );
    const hist = (await get('/api/teams/golden-team-big/kpi-history?days=30', c.admin)).body;
    const periods = hist.targets.test_coverage;
    expect(periods.map((p: any) => [p.good, p.scope])).toEqual([[80, 'default'], [85, 'company'], [90, 'company']]);
    expect(periods[periods.length - 1].validTo).toBeNull();
    // The same periods reach the TV payload.
    const tv = (await get('/api/tv/teams/golden-team-big', c.admin)).body;
    expect(tv.targets.test_coverage.map((p: any) => p.good)).toEqual([80, 85, 90]);
  });
});
