import request, { Response } from 'supertest';

/**
 * Moving a team to another department: PUT /api/admin/teams/:id/department { departmentId, dryRun? }
 * (server/lib/teamDepartment.ts).
 *
 *   super_admin only (qa_manager 403); the target must be an active department of the same
 *   company (another company's or an inactive department: 400). In one transaction the team
 *   moves, members whose primary team it is and who were in the old department follow it
 *   (super_admin / qa_manager keep theirs), and analytics scope follows teams.department_id:
 *   the old department's QA manager loses the team, the new department's manager gains it.
 *
 * Runs against a live backend at API_URL; skips cleanly when none is running. Creates its own
 * departments, team and users in the QA manager's company and removes them afterwards.
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
const move = (teamId: string, cookie: string, body: Record<string, unknown>) =>
  request(API_URL).put(`/api/admin/teams/${encodeURIComponent(teamId)}/department`).set('Cookie', cookie).send(body);

describe('Move a team to another department', () => {
  const c: Record<string, string> = {};
  const u: Record<string, any> = {};
  const createdUsers: string[] = [];
  let stamp = 0;
  let oldDept = '';          // the QA manager's department (where the test team starts)
  let newDept = '';          // a fresh active department
  let inactiveDept = '';     // a fresh department, then deleted (inactive)
  let foreignDept = '';      // a department of another company
  let teamId = '';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    try {
      const health = await request(API_URL).get('/api/auth/me').timeout(3000);
      if (!health.status) throw new Error('no backend');
    } catch {
      backendAvailable = false;
      console.warn('Backend not running at', API_URL, '- team move tests skipped');
      return;
    }
    for (const [k, email] of Object.entries({ admin: 'admin@irongate.com', manager: 'manager@irongate.com' })) {
      const r = await login(email);
      c[k] = r.cookie;
      u[k] = r.user;
    }
    oldDept = u.manager.department_id;
    stamp = Date.now();

    const mkDept = async (name: string) =>
      (await request(API_URL).post('/api/admin/departments').set('Cookie', c.admin).send({ name })).body.id as string;
    newDept = await mkDept(`Move Target ${stamp}`);
    inactiveDept = await mkDept(`Move Inactive ${stamp}`);
    await request(API_URL).delete(`/api/admin/departments/${inactiveDept}`).set('Cookie', c.admin);

    const team = await request(API_URL).post('/api/admin/teams').set('Cookie', c.admin)
      .send({ name: `Move Test Team ${stamp}`, departmentId: oldDept });
    teamId = team.body?.id || '';

    const mkUser = async (key: string, role: string, extra: Record<string, unknown>) => {
      const email = `move-${key}-${stamp}@irongate.test`;
      const res = await request(API_URL).post('/api/admin/users').set('Cookie', c.admin).send({
        email, password: NEW_PW, firstName: 'Move', lastName: key, role, ...extra,
      });
      createdUsers.push(res.body.id);
      ids[key] = res.body.id;
      if (role === 'qa_manager') {
        const r = await login(email, NEW_PW);
        c[key] = r.cookie;
      }
    };
    await mkUser('lead', 'team_lead', { teamId });
    await mkUser('engineer', 'qa_engineer', { teamId });
    // A QA manager whose primary team is the moving team: keeps their department.
    await mkUser('oldmgr', 'qa_manager', { teamId });
    // The new department's QA manager.
    await mkUser('newmgr', 'qa_manager', { departmentId: newDept });

    const reg = await request(API_URL).post('/api/auth/register').send({
      email: `move-other@other${stamp}.test`, password: NEW_PW, firstName: 'Other', lastName: 'Company',
      companyName: `Other Company ${stamp}`, departmentName: 'Ops', teamName: 'Ops Team',
    });
    const foreignCookie = cookieFrom(reg);
    foreignDept = reg.body?.user?.department_id
      || (await get('/api/admin/departments', foreignCookie)).body?.[0]?.id || '';
  });

  afterAll(async () => {
    if (!backendAvailable) return;
    for (const id of createdUsers) if (id) await request(API_URL).delete(`/api/admin/users/${id}`).set('Cookie', c.admin);
    if (teamId) await request(API_URL).delete(`/api/admin/teams/${teamId}`).set('Cookie', c.admin);
    if (newDept) await request(API_URL).delete(`/api/admin/departments/${newDept}`).set('Cookie', c.admin);
  });

  const skip = () => !backendAvailable || !teamId || !newDept;
  const userDept = async (id: string) => {
    const users = (await get('/api/admin/users', c.admin)).body as any[];
    return users.find((x) => x.id === id)?.department_id;
  };
  const sees = async (who: string) => {
    const res = await get(`/api/analytics/flaky-tests?teamId=${encodeURIComponent(teamId)}`, c[who]);
    const scope = (await get('/api/analytics/scope', c[who])).body;
    return { status: res.status, inScope: (scope.teams || []).some((t: any) => t.id === teamId) };
  };

  it('MOVE-001: a qa_manager cannot move teams (403)', async () => {
    if (skip()) return;
    const res = await move(teamId, c.manager, { departmentId: newDept });
    expect(res.status).toBe(403);
  });

  it('MOVE-002: another company\'s department is rejected', async () => {
    if (skip()) return;
    expect(foreignDept).toBeTruthy();
    const res = await move(teamId, c.admin, { departmentId: foreignDept });
    expect([400, 403]).toContain(res.status);
  });

  it('MOVE-003: an inactive department is rejected (400)', async () => {
    if (skip()) return;
    const res = await move(teamId, c.admin, { departmentId: inactiveDept });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inactive/i);
    expect((await move(teamId, c.admin, {})).status).toBe(400);
    expect((await move(teamId, c.admin, { departmentId: oldDept })).status).toBe(400);
    expect((await move('no-such-team', c.admin, { departmentId: newDept })).status).toBe(404);
  });

  it('MOVE-004: before the move, the old department\'s manager has the team and the new one does not', async () => {
    if (skip()) return;
    expect(await sees('manager')).toEqual({ status: 200, inScope: true });
    expect(await sees('newmgr')).toEqual({ status: 403, inScope: false });
  });

  it('MOVE-005: dry run returns the plan without changing anything', async () => {
    if (skip()) return;
    const res = await move(teamId, c.admin, { departmentId: newDept, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.from.id).toBe(oldDept);
    expect(res.body.to.id).toBe(newDept);
    const followers = res.body.followers.map((p: any) => p.id).sort();
    expect(followers).toEqual([ids.engineer, ids.lead].sort());
    expect(res.body.managersLosing.map((p: any) => p.id)).toEqual(expect.arrayContaining([u.manager.id]));
    expect(res.body.managersGaining.map((p: any) => p.id)).toEqual([ids.newmgr]);
    expect(await userDept(ids.lead)).toBe(oldDept);
  });

  it('MOVE-006: the move succeeds and member departments follow; managers and admins keep theirs', async () => {
    if (skip()) return;
    const before = (await get('/api/admin/departments/all', c.admin)).body as any[];
    const count = (list: any[], id: string) => list.find((d) => d.id === id);

    const res = await move(teamId, c.admin, { departmentId: newDept });
    expect(res.status).toBe(200);
    expect(res.body.movedUserIds.sort()).toEqual([ids.engineer, ids.lead].sort());

    const detail = (await get(`/api/admin/departments/${newDept}/teams`, c.admin)).body;
    expect(detail.teams.map((t: any) => t.id)).toContain(teamId);
    expect(detail.managers.map((m: any) => m.id)).toEqual([ids.newmgr]);
    const oldDetail = (await get(`/api/admin/departments/${oldDept}/teams`, c.admin)).body;
    expect(oldDetail.teams.map((t: any) => t.id)).not.toContain(teamId);

    expect(await userDept(ids.lead)).toBe(newDept);
    expect(await userDept(ids.engineer)).toBe(newDept);
    expect(await userDept(ids.oldmgr)).toBe(oldDept);
    expect(await userDept(u.admin.id)).toBe(u.admin.department_id);

    // Department list counts follow teams.department_id / users.department_id.
    const after = (await get('/api/admin/departments/all', c.admin)).body as any[];
    expect(count(after, newDept).team_count).toBe(count(before, newDept).team_count + 1);
    expect(count(after, newDept).user_count).toBe(count(before, newDept).user_count + 2);
    expect(count(after, oldDept).team_count).toBe(count(before, oldDept).team_count - 1);
    expect(count(after, oldDept).user_count).toBe(count(before, oldDept).user_count - 2);

    // The dashboard list and its department filter read teams.department_id.
    const filtered = (await get(`/api/teams?departmentId=${encodeURIComponent(newDept)}`, c.admin)).body;
    expect((filtered.teams || []).map((t: any) => t.id)).toContain(teamId);
  });

  it('MOVE-007: analytics scope follows: the old manager loses the team, the new manager gains it', async () => {
    if (skip()) return;
    expect(await sees('manager')).toEqual({ status: 403, inScope: false });
    expect(await sees('newmgr')).toEqual({ status: 200, inScope: true });
    // The manager whose primary team moved also loses it (department scope, not primary team).
    expect(await sees('oldmgr')).toEqual({ status: 403, inScope: false });
  });

  it('MOVE-008: moving back restores the original state', async () => {
    if (skip()) return;
    const res = await move(teamId, c.admin, { departmentId: oldDept });
    expect(res.status).toBe(200);
    expect(await userDept(ids.lead)).toBe(oldDept);
    expect(await sees('manager')).toEqual({ status: 200, inScope: true });
    expect(await sees('newmgr')).toEqual({ status: 403, inScope: false });
  });
});
