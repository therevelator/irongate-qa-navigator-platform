/**
 * Who may write configuration values (POST /api/admin/configs, server/routes/admin.ts):
 *
 *   CFG-001 company-level values (no department, no team): super admins only; a QA manager gets
 *           403 and nothing is stored
 *   CFG-002 a QA manager writes the departments they manage and their teams, not other departments
 *   CFG-003 the read (GET /api/admin/configs/raw) is unchanged for managers
 */
import 'dotenv/config';
import request from 'supertest';
import type { Client } from 'pg';
import { NEW_PW, backendUp, cookieFrom, localDb, API_URL } from './helpers/http';

const stamp = Date.now();
let up = true;
let db: Client;
let admin = '';
let manager = '';
let companyId = '';
let ownDept = '';
let otherDept = '';
let ownTeam = '';

const post = (cookie: string, body: object) => request(API_URL).post('/api/admin/configs').set('Cookie', cookie).send(body);
const value = async (key: string, dept: string | null, team: string | null) => (await db.query(
  `SELECT config_value FROM configs WHERE company_id = $1 AND config_key = $2 AND department_id IS NOT DISTINCT FROM $3 AND team_id IS NOT DISTINCT FROM $4`,
  [companyId, key, dept, team])).rows[0]?.config_value ?? null;

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  const reg = await request(API_URL).post('/api/auth/register').send({
    email: `cfg-owner-${stamp}@cfg${stamp}.test`, password: NEW_PW, firstName: 'Cfg', lastName: 'Owner',
    companyName: `Cfg Scope ${stamp}`, departmentName: 'Own', teamName: 'Own Team',
  });
  admin = cookieFrom(reg);
  companyId = reg.body.user.company_id;
  ownDept = reg.body.user.department_id;
  ownTeam = reg.body.user.primary_team_id;
  otherDept = (await request(API_URL).post('/api/admin/departments').set('Cookie', admin).send({ name: 'Other' })).body.id;
  const m = await request(API_URL).post('/api/admin/users').set('Cookie', admin).send({
    email: `cfg-manager-${stamp}@cfg${stamp}.test`, password: NEW_PW, firstName: 'Man', lastName: 'Ager', role: 'qa_manager', departmentId: ownDept,
  });
  if (m.status !== 201) throw new Error(`manager: ${m.status} ${JSON.stringify(m.body)}`);
  manager = cookieFrom(await request(API_URL).post('/api/auth/login').send({ email: `cfg-manager-${stamp}@cfg${stamp}.test`, password: NEW_PW }));
}, 60_000);

afterAll(async () => {
  if (db && companyId) await db.query('DELETE FROM companies WHERE id = $1', [companyId]);
  await db?.end();
});

describe('Configuration values: who writes which level', () => {
  test('CFG-001 company-level values: super admins only', async () => {
    if (!up) return;
    for (const body of [{ configs: { sla_critical_hours: '3' } }, { departmentId: 'all', teamId: 'all', configs: { sla_critical_hours: '3' } }]) {
      const r = await post(manager, body);
      expect(r.status).toBe(403);
      expect(r.body.error).toMatch(/super admin/);
    }
    expect(await value('sla_critical_hours', null, null)).toBeNull();
    expect((await post(admin, { departmentId: 'all', teamId: 'all', configs: { sla_critical_hours: '3' } })).status).toBe(200);
    expect(await value('sla_critical_hours', null, null)).toBe('3');
  });

  test('CFG-002 a manager writes their departments and teams only', async () => {
    if (!up) return;
    expect((await post(manager, { departmentId: ownDept, configs: { sla_critical_hours: '5' } })).status).toBe(200);
    expect(await value('sla_critical_hours', ownDept, null)).toBe('5');
    expect((await post(manager, { departmentId: ownDept, teamId: ownTeam, configs: { sla_critical_hours: '6' } })).status).toBe(200);
    expect(await value('sla_critical_hours', ownDept, ownTeam)).toBe('6');
    expect((await post(manager, { departmentId: otherDept, configs: { sla_critical_hours: '7' } })).status).toBe(403);
    expect(await value('sla_critical_hours', otherDept, null)).toBeNull();
  });

  test('CFG-003 managers still read the company values', async () => {
    if (!up) return;
    const r = await request(API_URL).get('/api/admin/configs/raw').set('Cookie', manager);
    expect(r.status).toBe(200);
    expect(r.body.configs.sla_critical_hours).toBe('3');
  });
});
