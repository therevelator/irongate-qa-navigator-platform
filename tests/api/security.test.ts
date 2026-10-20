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

  beforeAll(async () => {
    try {
      const health = await request(API_URL).get('/api/auth/me').timeout(3000);
      if (health.status === 0 || health.error) throw new Error('no backend');
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

    const teams = await request(API_URL).get('/api/admin/teams').set('Cookie', adminCookie);
    companyATeamId = teams.body?.[0]?.id || '';

    // Register an isolated attacker company (unique email domain per run).
    const stamp = Date.now();
    const reg = await request(API_URL).post('/api/auth/register').send({
      email: `attacker@evil${stamp}.test`, password: 'Passw0rd!',
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

  it('SEC-006: registration rejects passwords shorter than 8 characters', async () => {
    if (guard()) return;
    const res = await request(API_URL).post('/api/auth/register').send({
      email: `weak${Date.now()}@evil${Date.now()}.test`, password: 'short',
      firstName: 'A', lastName: 'B', companyName: `C${Date.now()}`, departmentName: 'D', teamName: 'T',
    });
    expect(res.status).toBe(400);
  });
});
