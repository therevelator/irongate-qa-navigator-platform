import request, { Response } from 'supertest';

/**
 * Role matrix: the access every role has across the main endpoints, captured as a regression
 * test. It was written against the access model before explicit role assignments
 * (role_assignments) existed and must keep passing on the assignment model.
 *
 * Fixture (created here, removed afterwards), all in the admin's company:
 *   department A: teams A1 (lead, engineer, viewer, opted-in peer) and A2; QA manager of A
 *   department B: team B1 (engineer B)
 *   another company: one team (foreign)
 *
 * MATRIX-009.. extend it to several assignments per user (role_assignments): a manager of two
 * departments sees both, a lead of two teams sees both, and revoking an assignment removes the
 * access on the very next request.
 *
 * Runs against a live backend at API_URL; skips cleanly when none is running.
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const PW = 'demo123';
const NEW_PW = 'Passw0rd!2024';

let backendAvailable = true;

function cookieFrom(res: Response): string {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const m = cookies.map((c) => c.match(/irongate_token=([^;]+)/)).find(Boolean);
  return m ? `irongate_token=${m[1]}` : '';
}
async function login(email: string, password = PW) {
  const res = await request(API_URL).post('/api/auth/login').send({ email, password });
  return { cookie: cookieFrom(res), user: res.body.user };
}
const get = (path: string, cookie: string) => request(API_URL).get(path).set('Cookie', cookie);
const post = (path: string, cookie: string, body: object = {}) => request(API_URL).post(path).set('Cookie', cookie).send(body);
const put = (path: string, cookie: string, body: object = {}) => request(API_URL).put(path).set('Cookie', cookie).send(body);
const patch = (path: string, cookie: string, body: object = {}) => request(API_URL).patch(path).set('Cookie', cookie).send(body);
const del = (path: string, cookie: string) => request(API_URL).delete(path).set('Cookie', cookie);

export const ROLES = ['admin', 'manager', 'lead', 'engineer', 'viewer'] as const;
type Who = typeof ROLES[number] | 'engineerB' | 'foreign';

describe('Role matrix (regression)', () => {
  const c: Record<string, string> = {};
  const id: Record<string, string> = {};
  const T: Record<string, string> = {};
  const D: Record<string, string> = {};
  const createdUsers: string[] = [];
  let stamp = 0;

  beforeAll(async () => {
    try {
      const health = await request(API_URL).get('/api/auth/me').timeout(3000);
      if (!health.status) throw new Error('no backend');
    } catch {
      backendAvailable = false;
      console.warn('Backend not running at', API_URL, '- role matrix tests skipped');
      return;
    }
    c.admin = (await login('admin@irongate.com')).cookie;
    stamp = Date.now();
    for (const k of ['A', 'B']) {
      const r = await post('/api/admin/departments', c.admin, { name: `Matrix ${k} ${stamp}` });
      D[k] = r.body.id;
    }
    for (const [k, dept] of [['A1', 'A'], ['A2', 'A'], ['B1', 'B']] as const) {
      const r = await post('/api/admin/teams', c.admin, { name: `Matrix ${k} ${stamp}`, departmentId: D[dept] });
      T[k] = r.body.id;
    }
    const mk = async (key: string, role: string, where: { teamId?: string; departmentId?: string }) => {
      const email = `matrix-${key.toLowerCase()}-${stamp}@irongate.test`;
      const res = await post('/api/admin/users', c.admin, { email, password: NEW_PW, firstName: 'Matrix', lastName: key, role, ...where });
      if (res.status !== 201) throw new Error(`create ${key}: ${res.status} ${JSON.stringify(res.body)}`);
      id[key] = res.body.id;
      createdUsers.push(res.body.id);
      c[key] = (await login(email, NEW_PW)).cookie;
    };
    await mk('manager', 'qa_manager', { departmentId: D.A });
    await mk('lead', 'team_lead', { teamId: T.A1 });
    await mk('engineer', 'qa_engineer', { teamId: T.A1 });
    await mk('viewer', 'viewer', { teamId: T.A1 });
    await mk('peer', 'qa_engineer', { teamId: T.A1 });
    await mk('engineerB', 'qa_engineer', { teamId: T.B1 });
    await patch(`/api/admin/users/${id.peer}/developer-insights-toggle`, c.admin, { enabled: true });
    for (const k of ['peer', 'engineer']) {
      await post('/api/metrics/developer', c.admin, {
        teamId: T.A1, developerId: id[k], prMergeTimeAvg: 6, codeReviewTimeAvg: 2, focusTimeHours: 4, meetingTimeHours: 2, contextSwitchesPerDay: 4,
      });
    }
    const reg = await post('/api/auth/register', '', {
      email: `matrix-foreign-${stamp}@other${stamp}.test`, password: NEW_PW, firstName: 'Other', lastName: 'Company',
      companyName: `Other Company ${stamp}`, departmentName: 'Ops', teamName: 'Ops Team',
    });
    c.foreign = cookieFrom(reg);
    T.F = (await get('/api/analytics/scope', c.foreign)).body?.teams?.[0]?.id || '';
  });

  afterAll(async () => {
    if (!backendAvailable) return;
    for (const u of createdUsers) await request(API_URL).delete(`/api/admin/users/${u}`).set('Cookie', c.admin);
    for (const t of ['A1', 'A2', 'B1']) if (T[t]) await request(API_URL).delete(`/api/admin/teams/${T[t]}`).set('Cookie', c.admin);
    for (const d of ['A', 'B']) if (D[d]) await request(API_URL).delete(`/api/admin/departments/${D[d]}`).set('Cookie', c.admin);
  });

  const skip = () => !backendAvailable || !T.A1 || !T.F;

  /** Run a [who, team] -> expected-status table and report every mismatch at once. */
  async function expectMatrix(label: string, call: (who: Who, team: string) => Promise<Response>, table: Record<string, Record<string, number>>) {
    const errors: string[] = [];
    for (const [who, row] of Object.entries(table)) {
      for (const [team, expected] of Object.entries(row)) {
        const res = await call(who as Who, T[team]);
        if (res.status !== expected) errors.push(`${label}: ${who} on ${team} -> ${res.status}, expected ${expected} ${JSON.stringify(res.body).slice(0, 120)}`);
      }
    }
    expect(errors).toEqual([]);
  }

  it('MATRIX-001: /analytics/scope lists exactly the teams in each role\'s scope', async () => {
    if (skip()) return;
    const fixture = new Set([T.A1, T.A2, T.B1]);
    const expected: Record<string, { level: string; teams: string[] }> = {
      admin: { level: 'company', teams: [T.A1, T.A2, T.B1] },
      manager: { level: 'department', teams: [T.A1, T.A2] },
      lead: { level: 'team', teams: [T.A1] },
      engineer: { level: 'team', teams: [T.A1] },
      viewer: { level: 'team', teams: [T.A1] },
      engineerB: { level: 'team', teams: [T.B1] },
    };
    for (const [who, exp] of Object.entries(expected)) {
      const res = await get('/api/analytics/scope', c[who]);
      expect(res.status).toBe(200);
      expect({ who, level: res.body.level }).toEqual({ who, level: exp.level });
      const ids = (res.body.teams as any[]).map((t) => t.id).filter((t) => fixture.has(t)).sort();
      expect({ who, ids }).toEqual({ who, ids: [...exp.teams].sort() });
      expect((res.body.teams as any[]).some((t) => t.id === T.F)).toBe(false);
    }
  });

  it('MATRIX-002: team analytics endpoints follow the scope (200 in scope, 403 otherwise)', async () => {
    if (skip()) return;
    const table = {
      admin: { A1: 200, A2: 200, B1: 200, F: 403 },
      manager: { A1: 200, A2: 200, B1: 403, F: 403 },
      lead: { A1: 200, A2: 403, B1: 403, F: 403 },
      engineer: { A1: 200, A2: 403, B1: 403, F: 403 },
      viewer: { A1: 200, A2: 403, B1: 403, F: 403 },
      foreign: { A1: 403 },
    };
    await expectMatrix('flaky-tests', (w, t) => get(`/api/analytics/flaky-tests?teamId=${t}`, c[w]), table);
    await expectMatrix('business-impact-v2', (w, t) => get(`/api/analytics/business-impact-v2/${t}`, c[w]), table);
  });

  it('MATRIX-003: developer metrics: privileged roles see the opted-in peer, others only themselves', async () => {
    if (skip()) return;
    for (const who of ['admin', 'manager', 'lead']) {
      const res = await get(`/api/analytics/developer-metrics?teamId=${T.A1}`, c[who]);
      expect({ who, status: res.status, scope: res.body.individualScope }).toEqual({ who, status: 200, scope: 'team' });
      expect(res.body.developers.map((d: any) => d.developer_id)).toContain(id.peer);
      expect((await get(`/api/metrics/developer/${id.peer}`, c[who])).status).toBe(200);
    }
    for (const who of ['engineer', 'viewer']) {
      const res = await get(`/api/analytics/developer-metrics?teamId=${T.A1}`, c[who]);
      expect({ who, status: res.status, scope: res.body.individualScope }).toEqual({ who, status: 200, scope: 'self' });
      expect(res.body.developers.every((d: any) => d.developer_id === id[who])).toBe(true);
      expect((await get(`/api/metrics/developer/${id.peer}`, c[who])).status).toBe(403);
    }
    // engineer B (other department) never sees A1's individuals
    expect((await get(`/api/metrics/developer/${id.peer}`, c.engineerB)).status).toBe(403);
  });

  // R2 Phase 4: per-team metric reads follow the analytics scope (a QA manager: their departments
  // only); before, QA managers could read any team here (docs/reports/r2-final-review.md, H-1).
  it('MATRIX-004: team detail and per-team metric reads follow the analytics scope', async () => {
    if (skip()) return;
    await expectMatrix('GET /teams/:id', (w, t) => get(`/api/teams/${t}`, c[w]), {
      admin: { A1: 200, A2: 200, B1: 200, F: 404 },
      manager: { A1: 200, A2: 200, B1: 403, F: 404 },
      lead: { A1: 200, A2: 403, B1: 403, F: 404 },
      engineer: { A1: 200, A2: 403, B1: 403, F: 404 },
      viewer: { A1: 200, A2: 403, B1: 403, F: 404 },
    });
    await expectMatrix('GET /metrics/teams/:id/history', (w, t) => get(`/api/metrics/teams/${t}/history`, c[w]), {
      admin: { A1: 200, A2: 200, B1: 200, F: 404 },
      manager: { A1: 200, A2: 200, B1: 403, F: 404 },
      lead: { A1: 200, A2: 403, B1: 403, F: 404 },
      engineer: { A1: 200, A2: 403, B1: 403, F: 404 },
      viewer: { A1: 200, A2: 403, B1: 403, F: 404 },
    });
  });

  it('MATRIX-005: team data writes: admin any, manager own department, lead own team', async () => {
    if (skip()) return;
    await expectMatrix('PATCH /teams/:id/ai-toggle', (w, t) => patch(`/api/teams/${t}/ai-toggle`, c[w], { enabled: false }), {
      admin: { A1: 200, A2: 200, B1: 200, F: 404 },
      manager: { A1: 200, A2: 200, B1: 403, F: 404 },
      lead: { A1: 200, A2: 403, B1: 403 },
      engineer: { A1: 403, A2: 403 },
      viewer: { A1: 403 },
    });
    await expectMatrix('PUT /admin/teams/:id', (w, t) => put(`/api/admin/teams/${t}`, c[w], { name: `Matrix ${Object.keys(T).find((k) => T[k] === t)} ${stamp}`, description: 'matrix' }), {
      admin: { A1: 200, A2: 200, B1: 200, F: 404 },
      manager: { A1: 200, A2: 200, B1: 403 },
      lead: { A1: 403 },
      engineer: { A1: 403 },
      viewer: { A1: 403 },
    });
    await expectMatrix('GET /admin/configs', (w, t) => get(`/api/admin/configs?teamId=${t}`, c[w]), {
      admin: { A1: 200 }, manager: { A1: 200 }, lead: { A1: 200, B1: 403 }, engineer: { A1: 403 }, viewer: { A1: 403 },
    });
  });

  it('MATRIX-006: organisation administration is super_admin only', async () => {
    if (skip()) return;
    const calls: Array<[string, (w: Who) => Promise<Response>]> = [
      ['GET /admin/departments/all', (w) => get('/api/admin/departments/all', c[w])],
      ['GET /admin/departments/:id/teams', (w) => get(`/api/admin/departments/${D.A}/teams`, c[w])],
      ['GET /admin/api-keys', (w) => get('/api/admin/api-keys', c[w])],
      ['PUT /admin/teams/:id/department (dry run)', (w) => put(`/api/admin/teams/${T.A2}/department`, c[w], { departmentId: D.B, dryRun: true })],
      ['POST /admin/departments/:id/managers (dry run)', (w) => post(`/api/admin/departments/${D.B}/managers`, c[w], { userId: id.engineerB, dryRun: true })],
      ['PUT /admin/teams/:id/lead (dry run)', (w) => put(`/api/admin/teams/${T.A2}/lead`, c[w], { userId: id.engineer, dryRun: true })],
    ];
    const errors: string[] = [];
    for (const [label, call] of calls) {
      for (const who of ROLES) {
        const status = (await call(who)).status;
        const expected = who === 'admin' ? 200 : 403;
        if (status !== expected) errors.push(`${label}: ${who} -> ${status}, expected ${expected}`);
      }
    }
    expect(errors).toEqual([]);
    for (const who of ROLES) {
      const status = (await get('/api/admin/configs/raw', c[who])).status;
      expect({ who, status }).toEqual({ who, status: ['admin', 'manager'].includes(who) ? 200 : 403 });
    }
  });

  it('MATRIX-007: user directory and user management follow department / team scope', async () => {
    if (skip()) return;
    const fixtureUsers = ['manager', 'lead', 'engineer', 'viewer', 'peer', 'engineerB'];
    const visible = async (who: string) => {
      const res = await get('/api/admin/users', c[who]);
      expect(res.status).toBe(200);
      const ids = new Set((res.body as any[]).map((u) => u.id));
      return fixtureUsers.filter((k) => ids.has(id[k])).sort();
    };
    expect(await visible('admin')).toEqual([...fixtureUsers].sort());
    expect(await visible('manager')).toEqual(['engineer', 'lead', 'manager', 'peer', 'viewer']);
    expect(await visible('lead')).toEqual(['engineer', 'lead', 'peer', 'viewer']);
    expect(await visible('engineer')).toEqual(['engineer']);
    expect(await visible('viewer')).toEqual(['viewer']);

    const errors: string[] = [];
    const check = async (label: string, who: string, res: Response, expected: number) => {
      if (res.status !== expected) errors.push(`${label}: ${who} -> ${res.status}, expected ${expected}`);
    };
    for (const [who, exp] of Object.entries({ admin: 200, manager: 200, lead: 403, engineer: 200, viewer: 403 })) {
      await check('PUT /admin/users/engineer', who, await put(`/api/admin/users/${id.engineer}`, c[who], { firstName: 'Matrix' }), exp);
    }
    await check('PUT /admin/users/engineerB', 'manager', await put(`/api/admin/users/${id.engineerB}`, c.manager, { firstName: 'Matrix' }), 403);
    for (const [who, exp] of Object.entries({ admin: 200, manager: 200, lead: 200, viewer: 403 })) {
      await check('reset-password engineer', who, await post(`/api/admin/users/${id.engineer}/reset-password`, c[who], { newPassword: NEW_PW }), exp);
    }
    await check('reset-password engineerB', 'lead', await post(`/api/admin/users/${id.engineerB}/reset-password`, c.lead, { newPassword: NEW_PW }), 403);
    await check('reset-password engineerB', 'manager', await post(`/api/admin/users/${id.engineerB}/reset-password`, c.manager, { newPassword: NEW_PW }), 403);
    // A password reset ends the person's sessions (server/lib/sessions.ts): the engineer signs in again.
    c.engineer = (await login(`matrix-engineer-${stamp}@irongate.test`, NEW_PW)).cookie;
    // A manager cannot manage another manager or a super admin.
    await check('developer-insights manager->self', 'manager', await patch(`/api/admin/users/${id.manager}/developer-insights-toggle`, c.manager, { enabled: false }), 403);
    // Creating users: a lead only on their own team; a manager only in their department.
    await check('create user on B1 by lead', 'lead', await post('/api/admin/users', c.lead, {
      email: `matrix-x-${stamp}@irongate.test`, password: NEW_PW, firstName: 'X', lastName: 'Y', role: 'qa_engineer', teamId: T.B1,
    }), 403);
    await check('create user on B1 by manager', 'manager', await post('/api/admin/users', c.manager, {
      email: `matrix-y-${stamp}@irongate.test`, password: NEW_PW, firstName: 'X', lastName: 'Y', role: 'qa_engineer', teamId: T.B1,
    }), 403);
    await check('create qa_manager by manager', 'manager', await post('/api/admin/users', c.manager, {
      email: `matrix-z-${stamp}@irongate.test`, password: NEW_PW, firstName: 'X', lastName: 'Y', role: 'qa_manager', departmentId: D.A,
    }), 403);
    expect(errors).toEqual([]);
  });

  it('MATRIX-008: another company never reaches this company\'s data', async () => {
    if (skip()) return;
    expect((await get(`/api/teams/${T.A1}`, c.foreign)).status).toBe(404);
    expect((await get(`/api/metrics/teams/${T.A1}`, c.foreign)).status).toBe(404);
    expect((await patch(`/api/teams/${T.A1}/ai-toggle`, c.foreign, { enabled: true })).status).toBe(404);
    const users = (await get('/api/admin/users', c.foreign)).body as any[];
    expect(users.some((u) => u.id === id.engineer)).toBe(false);
  });

  /* ---------------------------------------------------------------------------------------
   * Several assignments per user
   * ------------------------------------------------------------------------------------- */

  const scopeIds = async (who: string) => new Set(((await get('/api/analytics/scope', c[who])).body.teams as any[]).map((t) => t.id));
  const grant = (who: string, userKey: string, body: object) => post(`/api/admin/users/${id[userKey]}/assignments`, c[who], body);
  const assignmentId = async (userKey: string, role: string, scopeId: string) =>
    ((await get(`/api/admin/users/${id[userKey]}/assignments`, c.admin)).body.assignments as any[])
      .find((a) => a.role === role && a.scope_id === scopeId)?.id as string | undefined;

  it('MATRIX-009: a QA manager of two departments sees and manages both; revoking one removes it on the next request', async () => {
    if (skip()) return;
    const add = await grant('admin', 'manager', { role: 'qa_manager', scopeId: D.B });
    expect(add.status).toBe(201);
    const ids = await scopeIds('manager');
    expect([T.A1, T.A2, T.B1].every((t) => ids.has(t))).toBe(true);
    expect((await get('/api/analytics/scope', c.manager)).body.departments.map((d: any) => d.id)).toEqual(expect.arrayContaining([D.A, D.B]));
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.B1}`, c.manager)).status).toBe(200);
    expect((await patch(`/api/teams/${T.B1}/ai-toggle`, c.manager, { enabled: false })).status).toBe(200);
    expect((await put(`/api/admin/users/${id.engineerB}`, c.manager, { firstName: 'Matrix' })).status).toBe(200);
    const users = ((await get('/api/admin/users', c.manager)).body as any[]).map((u) => u.id);
    expect(users).toEqual(expect.arrayContaining([id.engineerB, id.engineer]));
    expect((await get(`/api/metrics/developer/${id.peer}`, c.manager)).status).toBe(200);

    const aid = await assignmentId('manager', 'qa_manager', D.B);
    expect(aid).toBeTruthy();
    expect((await del(`/api/admin/users/${id.manager}/assignments/${aid}`, c.admin)).status).toBe(200);
    // Same session, next request: department B is gone, department A stays.
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.B1}`, c.manager)).status).toBe(403);
    expect((await patch(`/api/teams/${T.B1}/ai-toggle`, c.manager, { enabled: false })).status).toBe(403);
    expect((await put(`/api/admin/users/${id.engineerB}`, c.manager, { firstName: 'Matrix' })).status).toBe(403);
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.A2}`, c.manager)).status).toBe(200);
    const after = await scopeIds('manager');
    expect(after.has(T.B1)).toBe(false);
    expect(after.has(T.A1)).toBe(true);
  });

  it('MATRIX-010: a team lead of two teams sees and writes both; revoking one removes it on the next request', async () => {
    if (skip()) return;
    // The lead of A1 also leads A2 (A2 has no lead).
    const add = await grant('admin', 'lead', { role: 'team_lead', scopeId: T.A2 });
    expect(add.status).toBe(201);
    const ids = await scopeIds('lead');
    expect(ids.has(T.A1) && ids.has(T.A2) && !ids.has(T.B1)).toBe(true);
    const scope = (await get('/api/analytics/scope', c.lead)).body;
    expect(scope.level).toBe('team');
    for (const t of [T.A1, T.A2]) {
      expect((await get(`/api/analytics/flaky-tests?teamId=${t}`, c.lead)).status).toBe(200);
      expect((await patch(`/api/teams/${t}/ai-toggle`, c.lead, { enabled: false })).status).toBe(200);
      expect((await get(`/api/analytics/developer-metrics?teamId=${t}`, c.lead)).body.individualScope).toBe('team');
    }
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.B1}`, c.lead)).status).toBe(403);
    // The team lists show the lead on both teams (one source: the team_lead assignment).
    const detail = (await get(`/api/admin/departments/${D.A}/teams`, c.admin)).body.teams as any[];
    expect(detail.filter((t) => [T.A1, T.A2].includes(t.id)).map((t) => t.team_lead_id)).toEqual([id.lead, id.lead]);

    const aid = await assignmentId('lead', 'team_lead', T.A2);
    expect((await del(`/api/admin/users/${id.lead}/assignments/${aid}`, c.admin)).status).toBe(200);
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.A2}`, c.lead)).status).toBe(403);
    expect((await patch(`/api/teams/${T.A2}/ai-toggle`, c.lead, { enabled: false })).status).toBe(403);
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.A1}`, c.lead)).status).toBe(200);
    const after = (await get(`/api/admin/departments/${D.A}/teams`, c.admin)).body.teams as any[];
    expect(after.find((t) => t.id === T.A2).team_lead_id).toBeNull();
  });

  it('MATRIX-011: a member of two teams sees both teams, but only their own developer row', async () => {
    if (skip()) return;
    expect((await grant('admin', 'engineer', { role: 'qa_engineer', scopeId: T.B1 })).status).toBe(201);
    const ids = await scopeIds('engineer');
    expect(ids.has(T.A1) && ids.has(T.B1)).toBe(true);
    const dev = await get(`/api/analytics/developer-metrics?teamId=${T.B1}`, c.engineer);
    expect(dev.status).toBe(200);
    expect(dev.body.individualScope).toBe('self');
    expect((await patch(`/api/teams/${T.B1}/ai-toggle`, c.engineer, { enabled: false })).status).toBe(403);
    const aid = await assignmentId('engineer', 'qa_engineer', T.B1);
    expect((await del(`/api/admin/users/${id.engineer}/assignments/${aid}`, c.admin)).status).toBe(200);
    expect((await get(`/api/analytics/flaky-tests?teamId=${T.B1}`, c.engineer)).status).toBe(403);
  });

  it('MATRIX-012: assignment endpoints: who may give and remove what', async () => {
    if (skip()) return;
    const errors: string[] = [];
    const expectStatus = async (label: string, res: Promise<Response>, expected: number) => {
      const r = await res;
      if (r.status !== expected) errors.push(`${label} -> ${r.status} (${JSON.stringify(r.body).slice(0, 100)}), expected ${expected}`);
    };
    // Not authenticated
    await expectStatus('anonymous', request(API_URL).post(`/api/admin/users/${id.viewer}/assignments`).send({ role: 'viewer', scopeId: T.A2 }), 401);
    // Engineers and viewers give nothing
    await expectStatus('engineer -> viewer on A1', grant('engineer', 'viewer', { role: 'viewer', scopeId: T.A1 }), 403);
    await expectStatus('viewer -> peer on A1', grant('viewer', 'peer', { role: 'qa_engineer', scopeId: T.A2 }), 403);
    // A lead: members of their own team only, never a lead or another team
    await expectStatus('lead -> viewer on B1', grant('lead', 'viewer', { role: 'viewer', scopeId: T.B1 }), 403);
    await expectStatus('lead -> team_lead on A1', grant('lead', 'peer', { role: 'team_lead', scopeId: T.A1 }), 403);
    await expectStatus('lead -> peer member of A1 as viewer', grant('lead', 'peer', { role: 'viewer', scopeId: T.A1 }), 201);
    await expectStatus('lead -> peer back to qa_engineer', grant('lead', 'peer', { role: 'qa_engineer', scopeId: T.A1 }), 201);
    // A manager: team roles in their department; never a manager or super admin, never outside
    await expectStatus('manager -> qa_manager of A', grant('manager', 'engineer', { role: 'qa_manager', scopeId: D.A }), 403);
    await expectStatus('manager -> super_admin', grant('manager', 'engineer', { role: 'super_admin' }), 403);
    await expectStatus('manager -> member of B1', grant('manager', 'engineer', { role: 'qa_engineer', scopeId: T.B1 }), 403);
    await expectStatus('manager -> viewer member of A2', grant('manager', 'viewer', { role: 'viewer', scopeId: T.A2 }), 201);
    // Nobody changes their own assignments; nobody changes someone of their rank or above
    await expectStatus('manager -> self', grant('manager', 'manager', { role: 'qa_engineer', scopeId: T.A2 }), 403);
    await expectStatus('lead -> manager', grant('lead', 'manager', { role: 'viewer', scopeId: T.A1 }), 403);
    // One lead per team: a second lead is refused unless the lead is replaced
    await expectStatus('admin -> second lead of A1', grant('admin', 'engineer', { role: 'team_lead', scopeId: T.A1 }), 409);
    // Other company, unknown scope, inactive company scope
    await expectStatus('foreign -> our user', post(`/api/admin/users/${id.viewer}/assignments`, c.foreign, { role: 'viewer', scopeId: T.F }), 404);
    await expectStatus('admin -> foreign team', grant('admin', 'viewer', { role: 'viewer', scopeId: T.F }), 400);
    await expectStatus('admin -> bad role', grant('admin', 'viewer', { role: 'owner', scopeId: T.A1 }), 400);
    // Removing: the same rules
    const viewerA2 = await assignmentId('viewer', 'viewer', T.A2);
    await expectStatus('lead removes viewer on A2', del(`/api/admin/users/${id.viewer}/assignments/${viewerA2}`, c.lead), 403);
    await expectStatus('engineer removes viewer on A2', del(`/api/admin/users/${id.viewer}/assignments/${viewerA2}`, c.engineer), 403);
    await expectStatus('manager removes viewer on A2', del(`/api/admin/users/${id.viewer}/assignments/${viewerA2}`, c.manager), 200);
    await expectStatus('remove twice', del(`/api/admin/users/${id.viewer}/assignments/${viewerA2}`, c.manager), 404);
    expect(errors).toEqual([]);
  });

  it('MATRIX-013: replacing a team lead keeps the previous lead on the team as a member', async () => {
    if (skip()) return;
    const res = await grant('admin', 'engineer', { role: 'team_lead', scopeId: T.A1, replaceLead: true });
    expect(res.status).toBe(201);
    const detail = (await get(`/api/admin/departments/${D.A}/teams`, c.admin)).body.teams as any[];
    expect(detail.find((t) => t.id === T.A1).team_lead_id).toBe(id.engineer);
    const leadRow = ((await get('/api/admin/users', c.admin)).body as any[]).find((u) => u.id === id.lead);
    expect(leadRow.role).toBe('qa_engineer');
    expect(leadRow.assignments.map((a: any) => `${a.role}:${a.scope_id}`)).toEqual([`qa_engineer:${T.A1}`]);
    // The former lead lost lead rights on the next request; the new lead has them.
    expect((await patch(`/api/teams/${T.A1}/ai-toggle`, c.lead, { enabled: false })).status).toBe(403);
    expect((await get(`/api/analytics/developer-metrics?teamId=${T.A1}`, c.lead)).body.individualScope).toBe('self');
    expect((await patch(`/api/teams/${T.A1}/ai-toggle`, c.engineer, { enabled: false })).status).toBe(200);
    // Put it back (replace again).
    expect((await grant('admin', 'lead', { role: 'team_lead', scopeId: T.A1, replaceLead: true })).status).toBe(201);
    expect((await patch(`/api/teams/${T.A1}/ai-toggle`, c.lead, { enabled: false })).status).toBe(200);
  });
});
