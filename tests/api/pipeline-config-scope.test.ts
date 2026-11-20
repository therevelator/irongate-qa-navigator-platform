/**
 * Company-wide pipeline values belong to the super admin (docs/ROLE_ACCESS.md).
 *
 *   PCS-001 PUT /api/analytics/pipeline-config (one row per company): super admin only; a manager and
 *           a team lead get 403 and nothing changes
 *   PCS-002 PUT /api/analytics/pipeline-stages/:id of a company default stage (team_id empty): super
 *           admin only; a manager gets 403 and nothing changes
 *   PCS-003 team stages keep their rules: a manager edits a stage of a team in their department, not
 *           one of another department; a team lead cannot edit stages
 *
 * Runs against the live API (API_URL). The stages are inserted inactive (never shown) and removed after.
 */
import 'dotenv/config';
import type { Client } from 'pg';
import { PW, backendUp, localDb, login, put } from './helpers/http';

const stamp = Date.now();
let up = true;
let db: Client;
const c: Record<'admin' | 'manager' | 'lead', string> = { admin: '', manager: '', lead: '' };
let companyId = '';
let managerDept = '';
let originalConfig: any = null;
const stage: Record<'company' | 'ownDept' | 'otherDept', string> = { company: '', ownDept: '', otherDept: '' };

const duration = async (id: string) => (await db.query('SELECT avg_duration_seconds AS d FROM pipeline_stages WHERE id = $1', [id])).rows[0].d;
const config = async () => (await db.query('SELECT time_savings_percent::float AS t, cost_savings_percent::float AS s, cost_per_minute::float AS m FROM pipeline_config WHERE company_id = $1', [companyId])).rows[0] ?? null;
async function insertStage(teamId: string | null, name: string): Promise<string> {
  return (await db.query(
    `INSERT INTO pipeline_stages (company_id, team_id, name, stage_order, avg_duration_seconds, is_active) VALUES ($1, $2, $3, 99, 100, FALSE) RETURNING id`,
    [companyId, teamId, `${name} ${stamp}`],
  )).rows[0].id;
}

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  for (const who of ['admin', 'manager', 'lead'] as const) c[who] = (await login(`${who}@irongate.com`, PW)).cookie;
  companyId = (await db.query(`SELECT company_id FROM users WHERE email = 'admin@irongate.com'`)).rows[0].company_id;
  managerDept = (await db.query(
    `SELECT ra.scope_id FROM role_assignments ra JOIN users u ON u.id = ra.user_id
      WHERE u.email = 'manager@irongate.com' AND ra.role = 'qa_manager' AND ra.scope_type = 'department' AND ra.revoked_at IS NULL LIMIT 1`,
  )).rows[0].scope_id;
  const own = (await db.query('SELECT id FROM teams WHERE company_id = $1 AND department_id = $2 ORDER BY id LIMIT 1', [companyId, managerDept])).rows[0].id;
  const other = (await db.query('SELECT id FROM teams WHERE company_id = $1 AND department_id <> $2 ORDER BY id LIMIT 1', [companyId, managerDept])).rows[0].id;
  stage.company = await insertStage(null, 'PCS company default');
  stage.ownDept = await insertStage(own, 'PCS own department');
  stage.otherDept = await insertStage(other, 'PCS other department');
  originalConfig = await config();
}, 60_000);

afterAll(async () => {
  if (db) {
    await db.query('DELETE FROM pipeline_stages WHERE name LIKE $1', [`PCS % ${stamp}`]);
    if (originalConfig) {
      await db.query('UPDATE pipeline_config SET time_savings_percent = $1, cost_savings_percent = $2, cost_per_minute = $3 WHERE company_id = $4',
        [originalConfig.t, originalConfig.s, originalConfig.m, companyId]);
    } else if (companyId) {
      await db.query('DELETE FROM pipeline_config WHERE company_id = $1', [companyId]);
    }
    await db.end();
  }
});

describe('Company-wide pipeline values: super admin only', () => {
  test('PCS-001 pipeline configuration: a manager and a team lead get 403; the super admin saves it', async () => {
    if (!up) return;
    const before = await config();
    for (const who of ['manager', 'lead'] as const) {
      const res = await put('/api/analytics/pipeline-config', c[who], { time_savings_percent: 77, cost_savings_percent: 66, cost_per_minute: 9 });
      expect(res.status).toBe(403);
    }
    expect(await config()).toEqual(before);
    const ok = await put('/api/analytics/pipeline-config', c.admin, { time_savings_percent: 41, cost_savings_percent: 22, cost_per_minute: 0.75 });
    expect(ok.status).toBe(200);
    expect(await config()).toEqual({ t: 41, s: 22, m: 0.75 });
  });

  test('PCS-002 company default stage: a manager gets 403; the super admin edits it', async () => {
    if (!up) return;
    const refused = await put(`/api/analytics/pipeline-stages/${stage.company}`, c.manager, { duration: 555 });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/super admin/);
    expect(await duration(stage.company)).toBe(100);
    expect((await put(`/api/analytics/pipeline-stages/${stage.company}`, c.admin, { duration: 321 })).status).toBe(200);
    expect(await duration(stage.company)).toBe(321);
  });

  test('PCS-003 team stages keep their rules', async () => {
    if (!up) return;
    expect((await put(`/api/analytics/pipeline-stages/${stage.ownDept}`, c.manager, { duration: 222 })).status).toBe(200);
    expect(await duration(stage.ownDept)).toBe(222);
    expect((await put(`/api/analytics/pipeline-stages/${stage.otherDept}`, c.manager, { duration: 333 })).status).toBe(403);
    expect(await duration(stage.otherDept)).toBe(100);
    expect((await put(`/api/analytics/pipeline-stages/${stage.ownDept}`, c.lead, { duration: 444 })).status).toBe(403);
    expect((await put(`/api/analytics/pipeline-stages/${stage.otherDept}`, c.admin, { duration: 345 })).status).toBe(200);
  });
});
