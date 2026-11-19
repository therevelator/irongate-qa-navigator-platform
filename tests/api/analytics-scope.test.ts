import request, { Response } from 'supertest';

/**
 * Analytics scope (department + team selector) and individual developer data.
 *
 * The rule lives in server/lib/userPolicy.ts (canViewTeamAnalytics /
 * canViewIndividualDevelopers) and is enforced by every team-scoped analytics endpoint:
 *   super_admin  any team of their company
 *   qa_manager   the teams of their department
 *   team_lead / qa_engineer / viewer  their own team
 *   other company / unknown team     403
 * Individual developer rows: super_admin / qa_manager / team_lead see the developers of an
 * in-scope team who have not opted out; qa_engineer / viewer only their own row.
 *
 * Runs against a live backend at API_URL; skips cleanly when none is running. Creates its
 * own team (in a department other than the QA manager's) and users, and removes them after.
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const PW = 'demo123';
const NEW_PW = 'Passw0rd!2024';

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

const get = (path: string, cookie: string) => request(API_URL).get(path).set('Cookie', cookie);

/** Team-scoped analytics reads (query ?teamId=). */
const QUERY_ENDPOINTS = [
  '/api/analytics/flaky-tests',
  '/api/analytics/test-executions',
  '/api/analytics/technical-debt',
  '/api/analytics/performance-metrics',
  '/api/analytics/pipeline-stages',
  '/api/analytics/pipeline-history',
  '/api/analytics/developer-metrics',
  '/api/analytics/ddps-history',
  '/api/analytics/business-impact',
];
const pathsFor = (teamId: string) => [
  ...QUERY_ENDPOINTS.map((p) => `${p}?teamId=${encodeURIComponent(teamId)}`),
  `/api/analytics/business-impact-v2/${encodeURIComponent(teamId)}`,
];
/** A short sample of the same endpoints (keeps the request count under the API rate limit). */
const samplePathsFor = (teamId: string) => [
  `/api/analytics/flaky-tests?teamId=${encodeURIComponent(teamId)}`,
  `/api/analytics/developer-metrics?teamId=${encodeURIComponent(teamId)}`,
  `/api/analytics/business-impact-v2/${encodeURIComponent(teamId)}`,
];

describe('Analytics scope by role', () => {
  const c: Record<string, string> = {};
  const u: Record<string, any> = {};
  const created: string[] = [];
  let stamp = 0;
  let testTeamId = '';        // new team in a department other than the QA manager's
  let managerTeamId = '';     // a team in the QA manager's department
  let leadTeamId = '';
  let foreignTeamId = '';     // a team of another company
  let peerId = '';            // opted-in developer on the test team

  beforeAll(async () => {
    try {
      // Any HTTP answer (401 without a session) means the backend is up.
      const health = await request(API_URL).get('/api/auth/me').timeout(3000);
      if (!health.status) throw new Error('no backend');
    } catch {
      backendAvailable = false;
      console.warn('Backend not running at', API_URL, '- analytics scope tests skipped');
      return;
    }
    for (const [k, email] of Object.entries({
      admin: 'admin@irongate.com', manager: 'manager@irongate.com', lead: 'lead@irongate.com',
    })) {
      const r = await login(email);
      c[k] = r.cookie;
      u[k] = r.user;
    }
    leadTeamId = u.lead.primary_team_id;

    const adminScope = (await get('/api/analytics/scope', c.admin)).body;
    const managerDept = u.manager.department_id;
    managerTeamId = (adminScope.teams || []).find((t: any) => t.department_id === managerDept)?.id || '';
    const depts = (await get('/api/admin/departments', c.admin)).body;
    const deptList: any[] = Array.isArray(depts) ? depts : depts.departments || [];
    const otherDept = deptList.find((d: any) => d.id !== managerDept);

    stamp = Date.now();
    const team = await request(API_URL).post('/api/admin/teams').set('Cookie', c.admin)
      .send({ name: `Scope Test Team ${stamp}`, departmentId: otherDept?.id });
    testTeamId = team.body?.id || '';

    const mk = async (key: string, role: string) => {
      const email = `scope-${key}-${stamp}@irongate.test`;
      const res = await request(API_URL).post('/api/admin/users').set('Cookie', c.admin).send({
        email, password: NEW_PW, firstName: 'Scope', lastName: key, role, teamId: testTeamId,
      });
      created.push(res.body.id);
      const r = await login(email, NEW_PW);
      c[key] = r.cookie;
      u[key] = r.user;
      await request(API_URL).post('/api/metrics/developer').set('Cookie', c.admin).send({
        teamId: testTeamId, developerId: res.body.id,
        prMergeTimeAvg: 6, codeReviewTimeAvg: 2, focusTimeHours: 4, meetingTimeHours: 2, contextSwitchesPerDay: 4,
      });
      return res.body.id as string;
    };
    await mk('engineer', 'qa_engineer');
    await mk('viewer', 'viewer');
    peerId = await mk('peer', 'qa_engineer');
    await request(API_URL).patch(`/api/admin/users/${peerId}/developer-insights-toggle`).set('Cookie', c.admin).send({ enabled: true });

    const reg = await request(API_URL).post('/api/auth/register').send({
      email: `scope-attacker@other${stamp}.test`, password: NEW_PW, firstName: 'Other', lastName: 'Company',
      companyName: `Other Company ${stamp}`, departmentName: 'Ops', teamName: 'Ops Team',
    });
    c.foreign = cookieFrom(reg);
    foreignTeamId = (await get('/api/analytics/scope', c.foreign)).body?.teams?.[0]?.id || '';
  });

  afterAll(async () => {
    if (!backendAvailable) return;
    for (const id of created) await request(API_URL).delete(`/api/admin/users/${id}`).set('Cookie', c.admin);
    if (testTeamId) await request(API_URL).delete(`/api/admin/teams/${testTeamId}`).set('Cookie', c.admin);
  });

  const skip = () => !backendAvailable || !testTeamId;

  it('SCOPE-001: /analytics/scope lists exactly the teams each role may open', async () => {
    if (skip()) return;
    const admin = (await get('/api/analytics/scope', c.admin)).body;
    expect(admin.level).toBe('company');
    expect(admin.teams.map((t: any) => t.id)).toEqual(expect.arrayContaining([testTeamId, leadTeamId]));

    const manager = (await get('/api/analytics/scope', c.manager)).body;
    expect(manager.level).toBe('department');
    expect(manager.teams.length).toBeGreaterThan(0);
    expect(manager.teams.every((t: any) => t.department_id === u.manager.department_id)).toBe(true);
    expect(manager.teams.map((t: any) => t.id)).not.toContain(testTeamId);

    const lead = (await get('/api/analytics/scope', c.lead)).body;
    expect(lead.level).toBe('team');
    expect(lead.teams.map((t: any) => t.id)).toEqual([leadTeamId]);
    expect(lead.defaultTeamId).toBe(leadTeamId);

    for (const k of ['engineer', 'viewer']) {
      const s = (await get('/api/analytics/scope', c[k])).body;
      expect(s.level).toBe('team');
      expect(s.teams.map((t: any) => t.id)).toEqual([testTeamId]);
      expect(s.defaultTeamId).toBe(testTeamId);
    }
  });

  it('SCOPE-002: an in-scope team gives 200 for every role', async () => {
    if (skip()) return;
    const cases: Array<[string, string]> = [
      ['admin', testTeamId],
      ['lead', leadTeamId],
      ['engineer', testTeamId], ['viewer', testTeamId],
    ];
    if (managerTeamId) cases.push(['manager', managerTeamId]);
    for (const [who, teamId] of cases) {
      for (const p of pathsFor(teamId)) {
        const res = await get(p, c[who]);
        if (res.status !== 200) throw new Error(`${who} ${p} -> ${res.status}`);
      }
    }
  });

  it('SCOPE-003: another department, another team and another company give 403', async () => {
    if (skip()) return;
    // [who, team, why, every endpoint or a sample]
    const cases: Array<[string, string, string, boolean]> = [
      ['manager', testTeamId, 'other department', true],
      ['lead', testTeamId, 'other team', true],
      ['engineer', leadTeamId, 'other team', true],
      ['viewer', leadTeamId, 'other team', true],
      ['foreign', testTeamId, 'other company', true],
      ['admin', 'does-not-exist', 'unknown team', false],
    ];
    if (foreignTeamId) {
      for (const who of ['admin', 'manager', 'lead', 'engineer', 'viewer']) cases.push([who, foreignTeamId, 'other company', false]);
    }
    for (const [who, teamId, why, all] of cases) {
      for (const p of all ? pathsFor(teamId) : samplePathsFor(teamId)) {
        const res = await get(p, c[who]);
        if (res.status !== 403) throw new Error(`${who} ${p} (${why}) -> ${res.status}`);
      }
    }
  });

  it('SCOPE-004: without a teamId a request defaults to the caller\'s own team', async () => {
    if (skip()) return;
    const eng = await get('/api/analytics/developer-metrics', c.engineer);
    expect(eng.status).toBe(200);
    expect(eng.body.teamId).toBe(testTeamId);
    const lead = await get('/api/analytics/technical-debt', c.lead);
    expect(lead.status).toBe(200);
  });

  it('SCOPE-005: a qa_engineer or viewer gets only their own developer row', async () => {
    if (skip()) return;
    for (const k of ['engineer', 'viewer']) {
      const res = await get(`/api/analytics/developer-metrics?teamId=${testTeamId}`, c[k]);
      expect(res.status).toBe(200);
      expect(res.body.individualScope).toBe('self');
      expect(res.body.developers.map((d: any) => d.developer_id)).toEqual([u[k].id]);

      const ddps = await get(`/api/analytics/ddps-history?teamId=${testTeamId}&range=6m&developerId=${peerId}`, c[k]);
      expect(ddps.status).toBe(200);
      expect((ddps.body.snapshots || []).every((s: any) => s.developer_id === u[k].id)).toBe(true);

      expect((await get(`/api/metrics/developer/${peerId}`, c[k])).status).toBe(403);
      expect((await get(`/api/metrics/developer/${peerId}/history`, c[k])).status).toBe(403);
      expect((await get(`/api/metrics/developer/${u[k].id}`, c[k])).status).toBe(200);
    }

    // The same team seen by an admin: the opted-in peer, but nobody who opted out.
    const admin = await get(`/api/analytics/developer-metrics?teamId=${testTeamId}`, c.admin);
    expect(admin.body.individualScope).toBe('team');
    const ids = admin.body.developers.map((d: any) => d.developer_id);
    expect(ids).toContain(peerId);
    expect(ids).not.toContain(u.engineer.id);
    expect((await get(`/api/metrics/developer/${peerId}`, c.admin)).status).toBe(200);
    // A qa_manager cannot read individual rows outside their department.
    expect((await get(`/api/metrics/developer/${peerId}`, c.manager)).status).toBe(403);
  });

  it('SCOPE-006: developer recommendations return only the engineer\'s own row', async () => {
    if (skip()) return;
    const res = await get(`/api/teams/${testTeamId}/developer-ai-suggestions`, c.engineer);
    if (res.status === 429) return; // AI rate limit (10/min) reached by other suites
    expect(res.status).toBe(200);
    expect((res.body.developers || []).every((d: any) => d.developerId === u.engineer.id)).toBe(true);
    expect((res.body.metrics || []).every((m: any) => m.developerId === u.engineer.id)).toBe(true);
    const other = await get(`/api/teams/${leadTeamId}/developer-ai-suggestions`, c.engineer);
    if (other.status !== 429) expect(other.status).toBe(403);
  });
});
