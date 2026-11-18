import request, { Response } from 'supertest';

/**
 * Regression tests for the consistency review (H1, H3, M2, M5, L7): the server applies
 * one rule per action, matching what the UI offers. Runs against a live backend at
 * API_URL; skips cleanly when none is running. Creates its own test users/departments
 * and never changes the seeded accounts.
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const PW = 'demo123';

let backendAvailable = true;

function cookieFrom(res: Response): string {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const m = cookies[0]?.match(/irongate_token=([^;]+)/);
  return m ? `irongate_token=${m[1]}` : '';
}

async function login(email: string, password = PW) {
  const res = await request(API_URL).post('/api/auth/login').send({ email, password });
  return { cookie: cookieFrom(res), user: res.body.user };
}

describe('Consistency regressions', () => {
  const c: Record<string, string> = {};
  const u: Record<string, any> = {};
  let teams: any[] = [];

  beforeAll(async () => {
    try {
      const health = await request(API_URL).get('/api/auth/me').timeout(3000);
      if (!health.status) throw new Error('no backend');
    } catch {
      backendAvailable = false;
      return;
    }
    for (const [k, email] of Object.entries({
      admin: 'admin@irongate.com', manager: 'manager@irongate.com', lead: 'lead@irongate.com',
      engineer: 'engineer@irongate.com', viewer: 'viewer@irongate.com',
    })) {
      const r = await login(email);
      c[k] = r.cookie;
      u[k] = r.user;
    }
    teams = (await request(API_URL).get('/api/admin/teams').set('Cookie', c.admin)).body || [];
  });

  const skip = () => !backendAvailable;

  // H1
  it('CON-001: config reads are role-gated and never return secret values', async () => {
    if (skip()) return;
    for (const k of ['viewer', 'engineer']) {
      expect((await request(API_URL).get('/api/admin/configs').set('Cookie', c[k])).status).toBe(403);
      expect((await request(API_URL).get('/api/admin/configs/raw').set('Cookie', c[k])).status).toBe(403);
    }
    expect((await request(API_URL).get('/api/admin/configs/raw').set('Cookie', c.lead)).status).toBe(403);
    const merged = await request(API_URL).get('/api/admin/configs').set('Cookie', c.admin);
    expect(merged.status).toBe(200);
    for (const key of Object.keys(merged.body.configs)) {
      expect(key).not.toMatch(/password|token|secret|api_key/i);
    }
    const raw = await request(API_URL).get('/api/admin/configs/raw').set('Cookie', c.admin);
    for (const [key, value] of Object.entries<string>(raw.body.configs)) {
      if (/password|token|secret|api_key/i.test(key)) expect(value).toBe('__secret_set__');
    }
  });

  // H3: unchanged role is not re-checked against the hierarchy
  it('CON-002: a super_admin and a qa_manager can edit their own name (role unchanged)', async () => {
    if (skip()) return;
    for (const k of ['admin', 'manager']) {
      const me = u[k];
      const res = await request(API_URL).put(`/api/admin/users/${me.id}`).set('Cookie', c[k]).send({
        firstName: me.first_name, lastName: me.last_name, email: me.email, role: me.role,
        departmentId: me.department_id, primaryTeamId: me.primary_team_id,
      });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe(me.role);
    }
  });

  it('CON-003: nobody can change their own role', async () => {
    if (skip()) return;
    const me = u.manager;
    const res = await request(API_URL).put(`/api/admin/users/${me.id}`).set('Cookie', c.manager).send({ role: 'super_admin' });
    expect(res.status).toBe(403);
  });

  it('CON-004: a team lead cannot edit other users or teams (matches the hidden Edit buttons)', async () => {
    if (skip()) return;
    const other = teams.find((t) => t.id !== u.lead.primary_team_id);
    const resUser = await request(API_URL).put(`/api/admin/users/${u.viewer.id}`).set('Cookie', c.lead).send({ firstName: 'X' });
    expect(resUser.status).toBe(403);
    const ownTeam = await request(API_URL).put(`/api/admin/teams/${u.lead.primary_team_id}`).set('Cookie', c.lead).send({ name: 'X' });
    expect(ownTeam.status).toBe(403);
    if (other) {
      const ai = await request(API_URL).patch(`/api/teams/${other.id}/ai-toggle`).set('Cookie', c.lead).send({ enabled: true });
      expect(ai.status).toBe(403);
    }
  });

  // H3: one reset-password rule (users you can manage), independent of created_by
  it('CON-005: a qa_manager can reset the password of a department user they did not create; a team lead cannot reset a manager', async () => {
    if (skip()) return;
    const deptTeam = teams.find((t) => t.department_id === u.manager.department_id);
    if (!deptTeam) return;
    const email = `reset-${Date.now()}@irongate.test`;
    const created = await request(API_URL).post('/api/admin/users').set('Cookie', c.admin)
      .send({ email, password: 'Passw0rd!', firstName: 'Reset', lastName: 'Target', role: 'qa_engineer', teamId: deptTeam.id });
    expect(created.status).toBe(201);
    const reset = await request(API_URL).post(`/api/admin/users/${created.body.id}/reset-password`).set('Cookie', c.manager).send({ newPassword: 'NewPassw0rd!' });
    expect(reset.status).toBe(200);
    expect((await login(email, 'NewPassw0rd!')).cookie).not.toBe('');
    const leadReset = await request(API_URL).post(`/api/admin/users/${u.manager.id}/reset-password`).set('Cookie', c.lead).send({ newPassword: 'Whatever123' });
    expect(leadReset.status).toBe(403);
    await request(API_URL).delete(`/api/admin/users/${created.body.id}`).set('Cookie', c.admin);
  });

  it('CON-006: a viewer can be created without a primary team; an engineer cannot', async () => {
    if (skip()) return;
    const stamp = Date.now();
    const viewer = await request(API_URL).post('/api/admin/users').set('Cookie', c.admin)
      .send({ email: `noteam-v-${stamp}@irongate.test`, password: 'Passw0rd!', firstName: 'No', lastName: 'Team', role: 'viewer', departmentId: u.admin.department_id });
    expect(viewer.status).toBe(201);
    expect(viewer.body.primary_team_id).toBeNull();
    const eng = await request(API_URL).post('/api/admin/users').set('Cookie', c.admin)
      .send({ email: `noteam-e-${stamp}@irongate.test`, password: 'Passw0rd!', firstName: 'No', lastName: 'Team', role: 'qa_engineer', departmentId: u.admin.department_id });
    expect(eng.status).toBe(400);
    await request(API_URL).delete(`/api/admin/users/${viewer.body.id}`).set('Cookie', c.admin);
  });

  it('CON-007: a team lead can only create users on their own team', async () => {
    if (skip()) return;
    const other = teams.find((t) => t.id !== u.lead.primary_team_id);
    if (!other) return;
    const res = await request(API_URL).post('/api/admin/users').set('Cookie', c.lead)
      .send({ email: `lead-other-${Date.now()}@irongate.test`, password: 'Passw0rd!', firstName: 'A', lastName: 'B', role: 'qa_engineer', teamId: other.id });
    expect(res.status).toBe(403);
  });

  it('CON-008: a new user is in team_members for their primary team (one membership source)', async () => {
    if (skip()) return;
    const team = teams[0];
    if (!team) return;
    const before = Number(team.member_count);
    const created = await request(API_URL).post('/api/admin/users').set('Cookie', c.admin)
      .send({ email: `member-${Date.now()}@irongate.test`, password: 'Passw0rd!', firstName: 'Mem', lastName: 'Ber', role: 'qa_engineer', teamId: team.id });
    expect(created.status).toBe(201);
    expect(created.body.team_ids).toContain(team.id);
    const after = (await request(API_URL).get('/api/admin/teams').set('Cookie', c.admin)).body.find((t: any) => t.id === team.id);
    expect(Number(after.member_count)).toBe(before + 1);
    await request(API_URL).delete(`/api/admin/users/${created.body.id}`).set('Cookie', c.admin);
  });

  // M2 (updated in R2 phase 2): team detail (KPIs) is company-visible, its member list and its
  // KPI history follow the shared policy (canViewTeamMembers / analytics scope).
  it('CON-009: another team: detail (KPIs) readable, members hidden, KPI history outside the analytics scope (403)', async () => {
    if (skip()) return;
    const other = teams.find((t) => t.id !== u.lead.primary_team_id && t.id !== u.viewer.primary_team_id);
    if (!other) return;
    for (const k of ['lead', 'viewer']) {
      const detail = await request(API_URL).get(`/api/teams/${other.id}`).set('Cookie', c[k]);
      const history = await request(API_URL).get(`/api/teams/${other.id}/kpi-history?days=30`).set('Cookie', c[k]);
      expect(detail.status).toBe(200);
      expect(detail.body.team.membersHidden).toBe(true);
      expect(detail.body.team.members).toEqual([]);
      expect(history.status).toBe(403);
    }
    // In scope: the caller's own team.
    const own = await request(API_URL).get(`/api/teams/${u.lead.primary_team_id}/kpi-history?days=30`).set('Cookie', c.lead);
    expect(own.status).toBe(200);
  });

  // M5
  it('CON-010: a deleted department disappears from the lists and its name can be reused', async () => {
    if (skip()) return;
    const name = `Consistency Dept ${Date.now()}`;
    const created = await request(API_URL).post('/api/admin/departments').set('Cookie', c.admin).send({ name });
    expect(created.status).toBe(201);
    expect(created.body.id).not.toMatch(/^dept-/);
    const del = await request(API_URL).delete(`/api/admin/departments/${created.body.id}`).set('Cookie', c.admin);
    expect(del.status).toBe(200);
    for (const path of ['/api/admin/departments', '/api/admin/departments/all']) {
      const list = await request(API_URL).get(path).set('Cookie', c.admin);
      expect(list.body.map((d: any) => d.id)).not.toContain(created.body.id);
    }
    const again = await request(API_URL).post('/api/admin/departments').set('Cookie', c.admin).send({ name });
    expect(again.status).toBe(201);
    await request(API_URL).delete(`/api/admin/departments/${again.body.id}`).set('Cookie', c.admin);
  });

  // L7: AI toggle uses assertTeamWrite (manager limited to their department)
  it('CON-011: a qa_manager cannot toggle AI for a team outside their department', async () => {
    if (skip()) return;
    const outside = teams.find((t) => t.department_id !== u.manager.department_id);
    if (!outside) return;
    const res = await request(API_URL).patch(`/api/teams/${outside.id}/ai-toggle`).set('Cookie', c.manager).send({ enabled: !outside.ai_enabled });
    expect(res.status).toBe(403);
  });

  // M10 / L2: removed endpoints
  it('CON-012: removed endpoints are gone', async () => {
    if (skip()) return;
    expect((await request(API_URL).get('/api/admin/permissions').set('Cookie', c.admin)).status).toBe(404);
    expect((await request(API_URL).post('/api/metrics/sync').set('Cookie', c.admin)).status).toBe(404);
    expect((await request(API_URL).get('/api/settings/sync-status').set('Cookie', c.admin)).status).toBe(404);
  });
});
