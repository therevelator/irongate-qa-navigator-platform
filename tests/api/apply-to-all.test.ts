import type { Client } from 'pg';
import { backendUp, get, localDb, login, post, put } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

/**
 * Parameters, company-wide "Apply to every department and team":
 *   - POST /api/admin/configs { departmentId: 'all', applyToAll: true } saves the company values
 *     and removes the department and team values of those settings;
 *   - PUT /api/targets { scopeType: 'company', applyToAll: true } ends every department and team
 *     target (history kept), allowed without target changes;
 *   - super admins only; only valid at company scope; each run is recorded in Activity;
 *   - saving company-wide (even unchanged) completes the onboarding "targets" step.
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
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, is_active, email_verified)
     SELECT 'golden-u-mgr2', 'mgr2@golden.example', password_hash, 'Mia', 'Manager', 'qa_manager', $1, 'golden-dept-b', TRUE, TRUE
       FROM users WHERE id = 'golden-u-admin' ON CONFLICT (id) DO NOTHING`,
    [GOLDEN_COMPANY]
  );
  await db.query(
    `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id)
     VALUES ('golden-ra-mgr2', $1, 'golden-u-mgr2', 'qa_manager', 'department', 'golden-dept-b') ON CONFLICT (id) DO NOTHING`,
    [GOLDEN_COMPANY]
  );
  c.admin = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  c.manager = (await login('mgr2@golden.example')).cookie;
});

afterAll(async () => {
  if (db) {
    await db.query(`DELETE FROM configs WHERE company_id = $1`, [GOLDEN_COMPANY]);
    await removeGolden(db);
    await db.end();
  }
});

describe('Apply company-wide settings and targets to every department and team', () => {
  it('APPLY-001: configs: department and team values of the saved settings are removed', async () => {
    if (!up) return;
    expect((await post('/api/admin/configs', c.admin, { departmentId: 'golden-dept-b', teamId: 'all', configs: { sla_critical_hours: '9' } })).status).toBe(200);
    expect((await post('/api/admin/configs', c.admin, { departmentId: 'golden-dept-b', teamId: 'golden-team-partial', configs: { sla_critical_hours: '7' } })).status).toBe(200);

    // A QA manager may not push company values down.
    expect((await post('/api/admin/configs', c.manager, { departmentId: 'all', teamId: 'all', configs: { sla_critical_hours: '4' }, applyToAll: true })).status).toBe(403);

    const res = await post('/api/admin/configs', c.admin, { departmentId: 'all', teamId: 'all', configs: { sla_critical_hours: '4' }, applyToAll: true });
    expect(res.status).toBe(200);
    expect(res.body.replaced).toBe(2);
    const rows = (await db.query(`SELECT department_id, team_id, config_value FROM configs WHERE company_id = $1 AND config_key = 'sla_critical_hours'`, [GOLDEN_COMPANY])).rows;
    expect(rows).toEqual([{ department_id: null, team_id: null, config_value: '4' }]);
    const audit = (await db.query(`SELECT action FROM audit_log WHERE company_id = $1 AND action = 'config.apply_all'`, [GOLDEN_COMPANY])).rows;
    expect(audit.length).toBe(1);

    // Without applyToAll, a company save leaves department values alone.
    expect((await post('/api/admin/configs', c.admin, { departmentId: 'golden-dept-b', teamId: 'all', configs: { sla_critical_hours: '9' } })).status).toBe(200);
    const plain = await post('/api/admin/configs', c.admin, { departmentId: 'all', teamId: 'all', configs: { sla_critical_hours: '5' } });
    expect(plain.body.replaced).toBe(0);
    expect((await db.query(`SELECT 1 FROM configs WHERE company_id = $1 AND department_id = 'golden-dept-b' AND config_key = 'sla_critical_hours'`, [GOLDEN_COMPANY])).rowCount).toBe(1);
  });

  it('APPLY-002: targets: department and team targets end (history kept); unchanged save allowed', async () => {
    if (!up) return;
    expect((await put('/api/targets', c.admin, { scopeType: 'department', scopeId: 'golden-dept-b', targets: { test_coverage: { good: 60, warning: 50 } } })).status).toBe(200);
    expect((await put('/api/targets', c.admin, { scopeType: 'team', scopeId: 'golden-team-partial', targets: { defect_escape_rate: { good: 8, warning: 12 } } })).status).toBe(200);
    let eff = (await get('/api/targets?scopeType=team&scopeId=golden-team-partial', c.admin)).body.metrics;
    expect(eff.find((m: any) => m.metric === 'test_coverage').effective.scope).toBe('department');

    expect((await put('/api/targets', c.manager, { scopeType: 'company', scopeId: GOLDEN_COMPANY, targets: {}, applyToAll: true })).status).toBe(403);
    expect((await put('/api/targets', c.admin, { scopeType: 'department', scopeId: 'golden-dept-b', targets: {}, applyToAll: true })).status).toBe(400);

    const res = await put('/api/targets', c.admin, { scopeType: 'company', scopeId: GOLDEN_COMPANY, targets: {}, applyToAll: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changed: [], replaced: 2 });
    eff = (await get('/api/targets?scopeType=team&scopeId=golden-team-partial', c.admin)).body.metrics;
    expect(eff.find((m: any) => m.metric === 'test_coverage').effective.scope).not.toBe('department');
    expect(eff.find((m: any) => m.metric === 'defect_escape_rate').effective.scope).not.toBe('team');
    // The ended targets stay in the history (values recorded earlier keep their target).
    const hist = (await db.query(
      `SELECT count(*)::int AS n FROM target_history WHERE company_id = $1 AND scope_type IN ('department', 'team') AND valid_to IS NOT NULL`, [GOLDEN_COMPANY]
    )).rows[0].n;
    expect(hist).toBeGreaterThanOrEqual(2);
    const open = (await db.query(
      `SELECT count(*)::int AS n FROM target_history WHERE company_id = $1 AND scope_type IN ('department', 'team') AND valid_to IS NULL`, [GOLDEN_COMPANY]
    )).rows[0].n;
    expect(open).toBe(0);
  });
});
