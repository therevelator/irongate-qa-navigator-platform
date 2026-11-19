import request, { Response } from 'supertest';

/**
 * Team TV mode (GET /api/tv/teams/:id) and the dashboard "Teams vs KPI targets" breakdown
 * (company-summary kpiStatusTeams).
 *
 * TV scope (canViewTeamTv): every role may show ANY team of their own company (the wall screen
 * is for everyone; the one exception to the analytics scope). Another company's team or an
 * unknown id: 403. The payload is team aggregates only. GET /api/tv/teams lists the company's
 * teams for the picker.
 *
 * Runs against a live backend at API_URL; skips cleanly when none is running.
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
async function login(email: string) {
  const res = await request(API_URL).post('/api/auth/login').send({ email, password: PW });
  return { cookie: cookieFrom(res), user: res.body.user };
}
const get = (path: string, cookie: string) => request(API_URL).get(path).set('Cookie', cookie);
const tv = (teamId: string, cookie: string) => get(`/api/tv/teams/${encodeURIComponent(teamId)}`, cookie);

describe('Team TV mode API', () => {
  const c: Record<string, string> = {};
  const u: Record<string, any> = {};
  let adminTeams: any[] = [];
  let foreignTeamId = '';

  beforeAll(async () => {
    try {
      const health = await request(API_URL).get('/api/auth/me').timeout(3000);
      if (!health.status) throw new Error('no backend');
    } catch {
      backendAvailable = false;
      console.warn('Backend not running at', API_URL, '- TV mode tests skipped');
      return;
    }
    for (const [k, email] of Object.entries({
      admin: 'admin@irongate.com', manager: 'manager@irongate.com', lead: 'lead@irongate.com',
      engineer: 'engineer@irongate.com', viewer: 'viewer@irongate.com', foreign: 'alex.morgan@northwind.example',
    })) {
      const r = await login(email);
      c[k] = r.cookie;
      u[k] = r.user;
    }
    adminTeams = (await get('/api/analytics/scope', c.admin)).body.teams || [];
    const foreignScope = c.foreign ? (await get('/api/analytics/scope', c.foreign)).body : null;
    foreignTeamId = foreignScope?.teams?.[0]?.id || '';
  });

  const ownTeam = (k: string) => u[k]?.primary_team_id || u[k]?.primaryTeamId || '';
  const otherTeam = (k: string) => adminTeams.find((t) => t.id !== ownTeam(k))?.id;

  it('requires a session', async () => {
    if (!backendAvailable) return;
    const res = await request(API_URL).get(`/api/tv/teams/${encodeURIComponent(adminTeams[0].id)}`);
    expect(res.status).toBe(401);
  });

  it('super_admin can open any team of the company; payload has team aggregates only', async () => {
    if (!backendAvailable) return;
    const res = await tv(adminTeams[0].id, c.admin);
    expect(res.status).toBe(200);
    expect(res.body.team).toEqual(expect.objectContaining({ id: adminTeams[0].id, name: expect.any(String), memberCount: expect.any(Number) }));
    expect(res.body.history).toBeDefined();
    // No individual data: no member list, no e-mail addresses anywhere in the payload.
    expect(res.body.team.members).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it.each(['lead', 'engineer', 'viewer', 'manager'])('%s can open any team of the company, still without individual data', async (k) => {
    if (!backendAvailable) return;
    for (const t of adminTeams.slice(0, 6)) {
      const res = await tv(t.id, c[k]);
      expect([t.id, res.status]).toEqual([t.id, 200]);
      expect(res.body.team.members).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    }
  });

  it('the team picker lists every active team of the caller\'s company, for every role', async () => {
    if (!backendAvailable) return;
    const all = ((await get('/api/tv/teams', c.admin)).body.teams || []).map((t: any) => t.id).sort();
    expect(all.length).toBeGreaterThan(0);
    for (const k of ['viewer', 'engineer']) {
      expect(((await get('/api/tv/teams', c[k])).body.teams || []).map((t: any) => t.id).sort()).toEqual(all);
    }
    if (foreignTeamId) expect(all).not.toContain(foreignTeamId);
    expect((await get('/api/tv/teams', '')).status).toBe(401);
  });

  it('another company\'s team and an unknown id get the same 403', async () => {
    if (!backendAvailable) return;
    if (foreignTeamId) expect((await tv(foreignTeamId, c.admin)).status).toBe(403);
    expect((await tv('no-such-team', c.admin)).status).toBe(403);
  });
});

describe('Company summary: Teams vs KPI targets breakdown', () => {
  it('counts equal the per-team list lengths (one rule)', async () => {
    if (!backendAvailable) return;
    const { cookie } = await login('admin@irongate.com');
    const res = await get('/api/analytics/company-summary', cookie);
    expect(res.status).toBe(200);
    const { kpiStatus, kpiStatusTeams } = res.body;
    expect(Array.isArray(kpiStatusTeams)).toBe(true);
    const count = (b: string) => kpiStatusTeams.filter((t: any) => t.bucket === b).length;
    expect(count('onTrack')).toBe(kpiStatus.onTrack);
    expect(count('atRisk')).toBe(kpiStatus.atRisk);
    expect(count('offTrack')).toBe(kpiStatus.offTrack);
    expect(count('noData')).toBe(kpiStatus.noData);
    for (const t of kpiStatusTeams) {
      const recorded = t.checks.filter((x: any) => x.met !== null);
      expect(t.recorded).toBe(recorded.length);
      expect(t.met).toBe(recorded.filter((x: any) => x.met).length);
      const share = t.recorded ? t.met / t.recorded : 0;
      const expected = t.recorded < 2 ? 'noData' : share >= 0.75 ? 'onTrack' : share >= 0.5 ? 'atRisk' : 'offTrack';
      expect(t.bucket).toBe(expected);
    }
  });
});
