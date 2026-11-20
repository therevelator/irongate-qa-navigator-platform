import request, { Response } from 'supertest';

/**
 * Security regression tests. These encode the vulnerabilities found during the
 * security review so they cannot silently return:
 *  - tenant isolation (no cross-company read/write)
 *  - no self privilege escalation
 *  - authentication required on data routes
 *  - JWT forgery rejected
 *  - password policy enforced
 *
 * Runs against a live backend at API_URL (same as admin.test.ts). Skips cleanly
 * if the backend is not running.
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const SUPER_ADMIN = { email: 'admin@irongate.com', password: 'demo123' };
const ENGINEER = { email: 'engineer@irongate.com', password: 'demo123' };
const MANAGER = { email: 'manager@irongate.com', password: 'demo123' };
const LEAD = { email: 'lead@irongate.com', password: 'demo123' };
const VIEWER = { email: 'viewer@irongate.com', password: 'demo123' };

let backendAvailable = true;

function cookieFrom(res: Response): string | null {
  const raw = res.headers['set-cookie'];
  if (!raw) return null;
  const cookies = Array.isArray(raw) ? raw : [raw];
  const m = cookies[0]?.match(/irongate_token=([^;]+)/);
  return m ? `irongate_token=${m[1]}` : null;
}

async function login(creds: { email: string; password: string }) {
  const res = await request(API_URL).post('/api/auth/login').send(creds);
  return { cookie: cookieFrom(res), user: res.body.user, status: res.status };
}

describe('Security regressions', () => {
  let adminCookie = '';
  let engineerCookie = '';
  let engineerId = '';
  let companyATeamId = '';
  let companyAUserId = 'user-viewer';
  let attackerCookie = ''; // a super_admin in a DIFFERENT company
  let managerCookie = '';
  let leadCookie = '';
  let leadTeamId = '';
  let viewerCookie = '';
  let viewerId = '';
  let companyName = '';

  beforeAll(async () => {
    try {
      const health = await request(API_URL).get('/api/auth/me').timeout(3000);
      if (!health.status) throw new Error('no backend');
    } catch (e: any) {
      backendAvailable = false;
      console.warn('⚠️  Backend not running at', API_URL, '- security tests skipped');
      return;
    }

    const admin = await login(SUPER_ADMIN);
    adminCookie = admin.cookie || '';
    const engineer = await login(ENGINEER);
    engineerCookie = engineer.cookie || '';
    engineerId = engineer.user?.id || '';

    const manager = await login(MANAGER);
    managerCookie = manager.cookie || '';
    const lead = await login(LEAD);
    leadCookie = lead.cookie || '';
    leadTeamId = lead.user?.primary_team_id || '';
    const viewer = await login(VIEWER);
    viewerCookie = viewer.cookie || '';
    viewerId = viewer.user?.id || '';
    companyName = process.env.TEST_COMPANY_NAME || 'NovaTech'; // the seeded tenant of admin@irongate.com

    const teams = await request(API_URL).get('/api/admin/teams').set('Cookie', adminCookie);
    // A team that is neither the team lead's nor the viewer's/engineer's own team.
    const other = (teams.body || []).find((t: any) => t.id !== leadTeamId && t.id !== viewer.user?.primary_team_id && t.id !== engineer.user?.primary_team_id);
    companyATeamId = other?.id || teams.body?.[0]?.id || '';

    // Register an isolated attacker company (unique email domain per run).
    const stamp = Date.now();
    const reg = await request(API_URL).post('/api/auth/register').send({
      email: `attacker@evil${stamp}.test`, password: 'Passw0rd!2024',
      firstName: 'Eve', lastName: 'Evil',
      companyName: `EvilCorp ${stamp}`, departmentName: 'Red', teamName: 'RedTeam',
    });
    attackerCookie = cookieFrom(reg) || '';
  });

  const guard = () => (!backendAvailable ? (console.log('skip - no backend'), true) : false);

  it('SEC-001: /api/metrics/dashboard requires authentication', async () => {
    if (guard()) return;
    const res = await request(API_URL).get('/api/metrics/dashboard');
    expect(res.status).toBe(401);
  });

  it('SEC-002: a qa_engineer cannot escalate their own role', async () => {
    if (guard()) return;
    const upd = await request(API_URL).put(`/api/users/${engineerId}`).set('Cookie', engineerCookie).send({ role: 'super_admin' });
    expect(upd.status).toBe(403);
    const me = await request(API_URL).get('/api/auth/me').set('Cookie', engineerCookie);
    expect(me.body.user.role).toBe('qa_engineer');
  });

  it('SEC-003: a super_admin of another company cannot modify this company\'s user', async () => {
    if (guard()) return;
    const res = await request(API_URL).put(`/api/admin/users/${companyAUserId}`).set('Cookie', attackerCookie)
      .send({ firstName: 'Pwned', lastName: 'X', email: 'viewer@irongate.com', role: 'super_admin', departmentId: 'dept-decision-mgmt', primaryTeamId: companyATeamId });
    expect([403, 404]).toContain(res.status);
  });

  it('SEC-004: cross-company business-impact write is blocked', async () => {
    if (guard() || !companyATeamId) return;
    const res = await request(API_URL).post(`/api/analytics/business-impact-v2/${companyATeamId}/quality-metrics`)
      .set('Cookie', attackerCookie).send({ month_year: '2099-01', test_coverage: 1 });
    expect([403, 404]).toContain(res.status);
  });

  it('SEC-005: a forged JWT (wrong secret) is rejected', async () => {
    if (guard()) return;
    // A token signed with a secret the server does not use.
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ userId: 'user-admin', role: 'super_admin', companyId: 'novatech' }, 'attacker-secret');
    const res = await request(API_URL).get('/api/admin/users').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(403);
  });

  it('SEC-006: registration rejects weak passwords (short, or the rules of src/lib/passwordPolicy.ts)', async () => {
    if (guard()) return;
    const res = await request(API_URL).post('/api/auth/register').send({
      email: `weak${Date.now()}@evil${Date.now()}.test`, password: 'short',
      firstName: 'A', lastName: 'B', companyName: `C${Date.now()}`, departmentName: 'D', teamName: 'T',
    });
    expect(res.status).toBe(400);
  });

  // C1: registration must never join an existing organisation (it would grant super_admin there).
  it('SEC-007: registering with an existing organisation name is refused (409)', async () => {
    if (guard()) return;
    const res = await request(API_URL).post('/api/auth/register').send({
      email: `joiner${Date.now()}@evil.test`, password: 'Passw0rd!2024',
      firstName: 'J', lastName: 'Oiner', companyName: companyName.toUpperCase(), departmentName: 'D', teamName: 'T',
    });
    expect(res.status).toBe(409);
    expect(cookieFrom(res)).toBeNull();
  });

  // C2: /api/users no longer lists the directory or edits/deletes other people.
  it('SEC-008: /api/users does not list users or let a manager change another user\'s role', async () => {
    if (guard()) return;
    const list = await request(API_URL).get('/api/users').set('Cookie', viewerCookie);
    expect(list.status).toBe(410);
    const upd = await request(API_URL).put(`/api/users/${viewerId}`).set('Cookie', managerCookie).send({ role: 'super_admin' });
    expect(upd.status).toBe(403);
    const del = await request(API_URL).delete(`/api/users/${viewerId}`).set('Cookie', managerCookie);
    expect(del.status).toBe(410);
    const other = await request(API_URL).get(`/api/users/${engineerId}`).set('Cookie', viewerCookie);
    expect(other.status).toBe(403);
    const me = await request(API_URL).get('/api/auth/me').set('Cookie', viewerCookie);
    expect(me.body.user.role).toBe('viewer');
  });

  it('SEC-009: a user can still edit their own profile name via /api/users/:id', async () => {
    if (guard()) return;
    const me = await request(API_URL).get('/api/auth/me').set('Cookie', viewerCookie);
    const res = await request(API_URL).put(`/api/users/${viewerId}`).set('Cookie', viewerCookie)
      .send({ firstName: me.body.user.first_name });
    expect(res.status).toBe(200);
  });

  // Analytics scope (server/lib/userPolicy.ts): every role may open team-level analytics,
  // but viewer / engineer / team lead only for their own team. See analytics-scope.test.ts.
  it('SEC-010: analytics reads of another team are refused for viewer, engineer and team lead', async () => {
    if (guard() || !companyATeamId) return;
    const paths = [
      `/api/analytics/technical-debt?teamId=${companyATeamId}`,
      `/api/analytics/flaky-tests?teamId=${companyATeamId}`,
      `/api/analytics/test-executions?teamId=${companyATeamId}`,
      `/api/analytics/pipeline-stages?teamId=${companyATeamId}`,
      `/api/analytics/ddps-history?teamId=${companyATeamId}`,
      `/api/analytics/business-impact-v2/${companyATeamId}`,
    ];
    for (const p of paths) {
      for (const cookie of [viewerCookie, engineerCookie, leadCookie]) {
        const res = await request(API_URL).get(p).set('Cookie', cookie);
        expect(res.status).toBe(403);
      }
      const admin = await request(API_URL).get(p).set('Cookie', adminCookie);
      expect(admin.status).toBe(200);
    }
  });

  it('SEC-011: without a teamId analytics is never company-wide: own team, or 400 without one', async () => {
    if (guard()) return;
    // The engineer and the team lead have a team: the request is scoped to it.
    for (const cookie of [engineerCookie, leadCookie]) {
      const res = await request(API_URL).get('/api/analytics/technical-debt').set('Cookie', cookie);
      expect(res.status).toBe(200);
    }
    // A user with no team in scope (the seeded viewer's team does not exist) must choose one.
    const me = await request(API_URL).get('/api/analytics/scope').set('Cookie', viewerCookie);
    if ((me.body.teams || []).length === 0) {
      const res = await request(API_URL).get('/api/analytics/technical-debt').set('Cookie', viewerCookie);
      expect(res.status).toBe(400);
    }
  });

  // H2: authorisation uses the live user row, not the 7-day token snapshot.
  it('SEC-012: a deactivated user loses API access immediately; reactivation restores it', async () => {
    if (guard() || !companyATeamId) return;
    const email = `h2-${Date.now()}@irongate.test`;
    const created = await request(API_URL).post('/api/admin/users').set('Cookie', adminCookie).send({
      email, password: 'Passw0rd!2024', firstName: 'Token', lastName: 'Check', role: 'qa_engineer', teamId: companyATeamId,
    });
    expect(created.status).toBe(201);
    const user = await login({ email, password: 'Passw0rd!2024' });
    expect(user.status).toBe(200);
    const before = await request(API_URL).get('/api/teams').set('Cookie', user.cookie!);
    expect(before.status).toBe(200);

    const off = await request(API_URL).post(`/api/admin/users/${created.body.id}/toggle-status`).set('Cookie', adminCookie);
    expect(off.body.is_active).toBe(false);
    const after = await request(API_URL).get('/api/teams').set('Cookie', user.cookie!);
    expect(after.status).toBe(401);

    const on = await request(API_URL).post(`/api/admin/users/${created.body.id}/toggle-status`).set('Cookie', adminCookie);
    expect(on.body.is_active).toBe(true);
    const again = await request(API_URL).get('/api/teams').set('Cookie', user.cookie!);
    expect(again.status).toBe(200);
    await request(API_URL).delete(`/api/admin/users/${created.body.id}`).set('Cookie', adminCookie);
  });

  it('SEC-013: a role change applies to an existing token on the next request', async () => {
    if (guard() || !companyATeamId) return;
    const email = `h2r-${Date.now()}@irongate.test`;
    const created = await request(API_URL).post('/api/admin/users').set('Cookie', adminCookie).send({
      email, password: 'Passw0rd!2024', firstName: 'Role', lastName: 'Check', role: 'team_lead', teamId: companyATeamId,
    });
    expect(created.status).toBe(201);
    const user = await login({ email, password: 'Passw0rd!2024' });
    const asLead = await request(API_URL).get('/api/analytics/technical-debt').set('Cookie', user.cookie!);
    expect(asLead.status).toBe(200);
    const leadRows = await request(API_URL).get(`/api/analytics/developer-metrics?teamId=${companyATeamId}`).set('Cookie', user.cookie!);
    expect(leadRows.body.individualScope).toBe('team');

    const demote = await request(API_URL).put(`/api/admin/users/${created.body.id}`).set('Cookie', adminCookie).send({
      firstName: 'Role', lastName: 'Check', email, role: 'viewer',
      departmentId: created.body.department_id, primaryTeamId: companyATeamId,
    });
    expect(demote.status).toBe(200);
    // As a viewer the user keeps team-level analytics for their own team, but loses other
    // developers' individual rows (only their own row is returned).
    const asViewer = await request(API_URL).get(`/api/analytics/developer-metrics?teamId=${companyATeamId}`).set('Cookie', user.cookie!);
    expect(asViewer.status).toBe(200);
    expect(asViewer.body.individualScope).toBe('self');
    expect((asViewer.body.developers || []).every((d: any) => d.developer_id === created.body.id)).toBe(true);
    await request(API_URL).delete(`/api/admin/users/${created.body.id}`).set('Cookie', adminCookie);
  });
});
