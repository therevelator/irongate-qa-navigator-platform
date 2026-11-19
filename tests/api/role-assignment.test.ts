import request, { Response } from 'supertest';

/**
 * Department managers and team leads (server/lib/roleAssignment.ts):
 *   POST /api/admin/departments/:id/managers               { userId, dryRun? }
 *   POST /api/admin/departments/:id/managers/:userId/remove { role, teamId?, dryRun? }
 *   PUT  /api/admin/teams/:id/lead                          { userId, dryRun? }
 * super_admin only; same-company, active users only; never your own role or the last
 * super_admin. Role changes apply on the user's next request (auth reads the users row).
 *
 * Runs against a live backend at API_URL; skips cleanly when none is running. Creates its own
 * departments, teams and users and deactivates them afterwards.
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
const post = (path: string, cookie: string, body: object) => request(API_URL).post(path).set('Cookie', cookie).send(body);
const put = (path: string, cookie: string, body: object) => request(API_URL).put(path).set('Cookie', cookie).send(body);

describe('Assign department managers and team leads', () => {
  const c: Record<string, string> = {};
  const u: Record<string, any> = {};
  const ids: Record<string, string> = {};
  const createdUsers: string[] = [];
  const createdTeams: string[] = [];
  let stamp = 0;
  let dept = '';        // fresh department, no manager
  let otherDept = '';   // the QA manager's department
  let team = '';        // team in dept
  let srcTeam = '';     // team in otherDept
  let foreignUser = '';

  beforeAll(async () => {
    try {
      const health = await request(API_URL).get('/api/auth/me').timeout(3000);
      if (!health.status) throw new Error('no backend');
    } catch {
      backendAvailable = false;
      console.warn('Backend not running at', API_URL, '- role assignment tests skipped');
      return;
    }
    for (const [k, email] of Object.entries({ admin: 'admin@irongate.com', manager: 'manager@irongate.com' })) {
      const r = await login(email);
      c[k] = r.cookie;
      u[k] = r.user;
    }
    otherDept = u.manager.department_id;
    stamp = Date.now();
    dept = (await post('/api/admin/departments', c.admin, { name: `Assign Dept ${stamp}` })).body.id;
    const mkTeam = async (name: string, departmentId: string) => {
      const id = (await post('/api/admin/teams', c.admin, { name: `${name} ${stamp}`, departmentId })).body.id as string;
      createdTeams.push(id);
      return id;
    };
    team = await mkTeam('Assign Team', dept);
    srcTeam = await mkTeam('Assign Source Team', otherDept);

    const mkUser = async (key: string, role: string, teamId: string) => {
      const email = `assign-${key}-${stamp}@irongate.test`;
      const res = await post('/api/admin/users', c.admin, { email, password: NEW_PW, firstName: 'Assign', lastName: key, role, teamId });
      ids[key] = res.body.id;
      createdUsers.push(res.body.id);
      c[key] = (await login(email, NEW_PW)).cookie;
    };
    await mkUser('src', 'qa_engineer', srcTeam);      // promoted to manager of dept
    await mkUser('lead', 'team_lead', team);          // the team's current (fallback) lead
    await mkUser('eng', 'qa_engineer', team);         // becomes lead
    await mkUser('eng2', 'qa_engineer', team);
    await mkUser('gone', 'qa_engineer', team);
    await request(API_URL).delete(`/api/admin/users/${ids.gone}`).set('Cookie', c.admin);

    const reg = await request(API_URL).post('/api/auth/register').send({
      email: `assign-other@other${stamp}.test`, password: NEW_PW, firstName: 'Other', lastName: 'Company',
      companyName: `Other Company ${stamp}`, departmentName: 'Ops', teamName: 'Ops Team',
    });
    foreignUser = reg.body?.user?.id || (await get('/api/auth/me', cookieFrom(reg))).body?.user?.id || '';
  });

  afterAll(async () => {
    if (!backendAvailable) return;
    for (const id of createdUsers) if (id) await request(API_URL).delete(`/api/admin/users/${id}`).set('Cookie', c.admin);
    for (const id of createdTeams) await request(API_URL).delete(`/api/admin/teams/${id}`).set('Cookie', c.admin);
    if (dept) await request(API_URL).delete(`/api/admin/departments/${dept}`).set('Cookie', c.admin);
  });

  const skip = () => !backendAvailable || !dept || !team;
  const userRow = async (id: string) => ((await get('/api/admin/users', c.admin)).body as any[]).find((x) => x.id === id);
  const detail = async () => (await get(`/api/admin/departments/${dept}/teams`, c.admin)).body;
  const scope = async (who: string) => (await get('/api/analytics/scope', c[who])).body;
  const flaky = async (who: string, teamId: string) => (await get(`/api/analytics/flaky-tests?teamId=${encodeURIComponent(teamId)}`, c[who])).status;

  it('ASSIGN-001: non-admins get 403 on every assignment endpoint', async () => {
    if (skip()) return;
    for (const who of ['manager', 'lead', 'eng']) {
      expect((await post(`/api/admin/departments/${dept}/managers`, c[who], { userId: ids.src })).status).toBe(403);
      expect((await post(`/api/admin/departments/${otherDept}/managers/${u.manager.id}/remove`, c[who], {})).status).toBe(403);
      expect((await put(`/api/admin/teams/${team}/lead`, c[who], { userId: ids.eng })).status).toBe(403);
    }
  });

  it('ASSIGN-002: a user of another company, an inactive user and your own role are rejected', async () => {
    if (skip()) return;
    expect(foreignUser).toBeTruthy();
    const foreign = await post(`/api/admin/departments/${dept}/managers`, c.admin, { userId: foreignUser });
    expect(foreign.status).toBe(400);
    expect((await put(`/api/admin/teams/${team}/lead`, c.admin, { userId: foreignUser })).status).toBe(400);
    const inactive = await post(`/api/admin/departments/${dept}/managers`, c.admin, { userId: ids.gone });
    expect(inactive.status).toBe(400);
    expect(inactive.body.error).toMatch(/inactive/i);
    const self = await post(`/api/admin/departments/${dept}/managers`, c.admin, { userId: u.admin.id });
    expect(self.status).toBe(400);
    expect(self.body.error).toMatch(/own role/i);
  });

  it('ASSIGN-003: assigning a department manager gives them the department\'s analytics scope', async () => {
    if (skip()) return;
    expect(await flaky('src', team)).toBe(403);
    const dry = await post(`/api/admin/departments/${dept}/managers`, c.admin, { userId: ids.src, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body.consequences.join(' ')).toMatch(/Software engineer to Manager/);
    expect((await userRow(ids.src)).role).toBe('qa_engineer');

    const res = await post(`/api/admin/departments/${dept}/managers`, c.admin, { userId: ids.src });
    expect(res.status).toBe(200);
    const row = await userRow(ids.src);
    expect(row).toMatchObject({ role: 'qa_manager', department_id: dept, primary_team_id: null });
    expect((await detail()).managers.map((m: any) => m.id)).toEqual([ids.src]);

    // Same session, next request: the new scope applies without signing in again.
    const s = await scope('src');
    expect(s.level).toBe('department');
    expect(s.teams.map((t: any) => t.id)).toContain(team);
    expect(s.teams.map((t: any) => t.id)).not.toContain(srcTeam);
    expect(await flaky('src', team)).toBe(200);
    expect(await flaky('src', srcTeam)).toBe(403);

    expect((await post(`/api/admin/departments/${dept}/managers`, c.admin, { userId: ids.src })).status).toBe(400);
  });

  it('ASSIGN-004: removing a manager demotes them and keeps them in the department', async () => {
    if (skip()) return;
    const path = `/api/admin/departments/${dept}/managers/${ids.src}/remove`;
    // A QA engineer needs a team; they have none in this department yet.
    expect((await post(path, c.admin, {})).status).toBe(400);
    expect((await post(path, c.admin, { role: 'super_admin', teamId: team })).status).toBe(400);
    const res = await post(path, c.admin, { teamId: team });
    expect(res.status).toBe(200);
    expect(res.body.consequences.join(' ')).toMatch(/no manager/);
    expect(await userRow(ids.src)).toMatchObject({ role: 'qa_engineer', department_id: dept, primary_team_id: team });
    expect((await detail()).managers).toEqual([]);
    const s = await scope('src');
    expect(s.level).toBe('team');
    expect(s.teams.map((t: any) => t.id)).toEqual([team]);
    expect((await post(path, c.admin, { teamId: team })).status).toBe(400); // no longer a manager
  });

  it('ASSIGN-005: assigning a team lead sets lead_id and the role; the previous lead stays as QA engineer', async () => {
    if (skip()) return;
    let d = await detail();
    expect(d.teams.find((t: any) => t.id === team).team_lead_id).toBe(ids.lead);
    const members = d.teams.find((t: any) => t.id === team).member_count;

    const res = await put(`/api/admin/teams/${team}/lead`, c.admin, { userId: ids.eng });
    expect(res.status).toBe(200);
    expect(res.body.previousLead).toMatchObject({ id: ids.lead, newRole: 'qa_engineer' });
    expect(await userRow(ids.eng)).toMatchObject({ role: 'team_lead', department_id: dept, primary_team_id: team });
    expect(await userRow(ids.lead)).toMatchObject({ role: 'qa_engineer', primary_team_id: team });

    d = await detail();
    const row = d.teams.find((t: any) => t.id === team);
    expect(row.team_lead_id).toBe(ids.eng);
    expect(row.team_lead_name).toBe('Assign eng');
    expect(row.member_count).toBe(members);
    // The dashboard / team detail list reads the same lead.
    const list = (await get(`/api/teams?departmentId=${encodeURIComponent(dept)}`, c.admin)).body.teams;
    expect(list.find((t: any) => t.id === team).teamLead).toBe('Assign eng');
  });

  it('ASSIGN-006: a lead from another department moves there; a lead who still leads another team keeps the role', async () => {
    if (skip()) return;
    // eng also leads srcTeam (another department): their primary team and department move there.
    const res = await put(`/api/admin/teams/${srcTeam}/lead`, c.admin, { userId: ids.eng });
    expect(res.status).toBe(200);
    expect(res.body.consequences.join(' ')).toMatch(/moves from/);
    expect(await userRow(ids.eng)).toMatchObject({ role: 'team_lead', department_id: otherDept, primary_team_id: srcTeam });
    expect((await detail()).teams.find((t: any) => t.id === team).team_lead_id).toBe(ids.eng);

    // Replacing eng on the first team: they still lead srcTeam, so they keep team_lead.
    const again = await put(`/api/admin/teams/${team}/lead`, c.admin, { userId: ids.eng2 });
    expect(again.status).toBe(200);
    expect(again.body.previousLead).toMatchObject({ id: ids.eng, newRole: 'team_lead' });
    expect((await userRow(ids.eng)).role).toBe('team_lead');
    expect(await userRow(ids.eng2)).toMatchObject({ role: 'team_lead', primary_team_id: team });
  });
});
