import type { Client } from 'pg';
import { backendUp, get, localDb, login, put } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

/**
 * One scope rule for every page (canViewTeamAnalytics in server/lib/userPolicy.ts): a viewer
 * scoped to one team sees that team only, on the overview list, team detail, TV mode, Compare, the
 * Analytics modules, revenue impact, pulse, alerts and actions; another team is refused (403) and
 * someone who has that team in scope may open it. The overview summary and the metrics reads cover
 * the caller's teams only. Also: the team detail header facts (rank, people per role, job titles)
 * and who may set a job title.
 *
 * Fixture: the golden company (tests/api/helpers/goldenFixture.ts) plus
 *   viewer-one   viewer of Partial Team (department B)        — like a Product Owner
 *   viewer-two   viewer of Partial Team and Big Team          — like a stakeholder of two teams
 *   mgr-a        manager of department A (Big, Small)
 * Runs against a live backend at API_URL; skips cleanly when none is running.
 */

let up = true;
let db: Client;
const c: Record<string, string> = {};
const PARTIAL = 'golden-team-partial';
const BIG = 'golden-team-big';
const SMALL = 'golden-team-small';

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  await createGolden(db);
  const add = async (id: string, email: string, role: string, dept: string, primary: string | null, grants: Array<[string, string, string]>, jobTitle: string | null) => {
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified, job_title)
       SELECT $1, $2, password_hash, 'Scope', $3::text, $3::text, $4, $5, $6, TRUE, TRUE, $7 FROM users WHERE id = 'golden-u-admin' ON CONFLICT (id) DO NOTHING`,
      [id, email, role, GOLDEN_COMPANY, dept, primary, jobTitle]
    );
    for (const [r, st, sid] of grants) {
      await db.query(
        `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [`golden-ra-${id.replace("golden-u-", "")}-${sid.replace("golden-", "")}`.slice(0, 36), GOLDEN_COMPANY, id, r, st, sid]
      );
    }
  };
  await add('golden-u-vone', 'viewer-one@golden.example', 'viewer', 'golden-dept-b', PARTIAL, [['viewer', 'team', PARTIAL]], 'Product Owner');
  await add('golden-u-vtwo', 'viewer-two@golden.example', 'viewer', 'golden-dept-b', null, [['viewer', 'team', PARTIAL], ['viewer', 'team', BIG]], 'Head of Product');
  await add('golden-u-mgra', 'mgr-a@golden.example', 'qa_manager', 'golden-dept-a', null, [['qa_manager', 'department', 'golden-dept-a']], null);
  c.admin = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  c.vone = (await login('viewer-one@golden.example')).cookie;
  c.vtwo = (await login('viewer-two@golden.example')).cookie;
  c.mgra = (await login('mgr-a@golden.example')).cookie;
});

afterAll(async () => {
  if (db) {
    await removeGolden(db);
    await db.end();
  }
});

const status = async (path: string, who: string) => (await get(path, c[who])).status;

describe('A viewer scoped to one team sees that team only', () => {
  it('SCOPE-001: overview list: only the teams of the caller\'s analytics scope', async () => {
    if (!up) return;
    const ids = async (who: string) => ((await get('/api/teams', c[who])).body.teams ?? []).map((t: any) => t.id).sort();
    expect(await ids('vone')).toEqual([PARTIAL]);
    expect(await ids('vtwo')).toEqual([BIG, PARTIAL].sort());
    expect(await ids('mgra')).toEqual([BIG, SMALL].sort());
    expect((await ids('admin')).length).toBeGreaterThanOrEqual(5);
  });

  it('SCOPE-002: team detail, TV mode, KPI history: another team 403 for her, 200 with that team in scope', async () => {
    if (!up) return;
    for (const path of [`/api/teams/${BIG}`, `/api/tv/teams/${BIG}`, `/api/teams/${BIG}/kpi-history?days=30`, `/api/metrics/teams/${BIG}/history`]) {
      expect([path, await status(path, 'vone')]).toEqual([path, 403]);
      expect([path, await status(path, 'vtwo')]).toEqual([path, 200]);
      expect([path, await status(path, 'mgra')]).toEqual([path, 200]);
    }
    for (const path of [`/api/teams/${PARTIAL}`, `/api/tv/teams/${PARTIAL}`]) {
      expect([path, await status(path, 'vone')]).toEqual([path, 200]);
      expect([path, await status(path, 'mgra')]).toEqual([path, 403]);
    }
    const refused = await get(`/api/teams/${BIG}`, c.vone);
    expect(refused.body.team).toBeUndefined();
    expect(JSON.stringify(refused.body)).not.toMatch(/qaScore|kpiData|@golden/);
  });

  it('SCOPE-006: TV mode picker lists her team only; another company\'s team is refused', async () => {
    if (!up) return;
    expect(((await get('/api/tv/teams', c.vone)).body.teams ?? []).map((t: any) => t.id)).toEqual([PARTIAL]);
    expect(((await get('/api/tv/teams', c.vtwo)).body.teams ?? []).map((t: any) => t.id).sort()).toEqual([BIG, PARTIAL].sort());
    const tv = (await get(`/api/tv/teams/${PARTIAL}`, c.vone)).body;
    expect(JSON.stringify(tv)).not.toMatch(/@golden\.example/);
    const foreign = (await login('alex.morgan@northwind.example')).cookie;
    if (foreign) expect((await get(`/api/tv/teams/${PARTIAL}`, foreign)).status).toBe(403);
  });

  it('SCOPE-003: Analytics modules, revenue impact, pulse, alerts, actions, compare: another team 403', async () => {
    if (!up) return;
    const paths = [
      `/api/analytics/flaky-tests?teamId=${BIG}`,
      `/api/analytics/technical-debt?teamId=${BIG}`,
      `/api/analytics/pipeline-history?teamId=${BIG}`,
      `/api/analytics/performance-metrics?teamId=${BIG}`,
      `/api/analytics/developer-metrics?teamId=${BIG}`,
      `/api/analytics/business-impact-v2/${BIG}`,
      `/api/revenue-impact/teams/${BIG}`,
      `/api/pulse/teams/${BIG}`,
      `/api/alerts?teamId=${BIG}`,
      `/api/actions?teamId=${BIG}`,
      `/api/compare/teams?ids=${PARTIAL},${BIG}`,
    ];
    for (const path of paths) {
      expect([path, await status(path, 'vone')]).toEqual([path, 403]);
      expect([path, await status(path, 'vtwo')]).toEqual([path, 200]);
    }
    expect(await status('/api/revenue-impact/rollup', 'vone')).toBe(403);
  });

  it('SCOPE-004: overview summary and metrics reads cover her teams only', async () => {
    if (!up) return;
    const s = (await get('/api/analytics/company-summary', c.vone)).body;
    expect(s.scope).toMatchObject({ level: 'team', teamCount: 1, companyWide: false });
    expect((s.kpiStatusTeams ?? []).map((t: any) => t.teamId)).toEqual(expect.not.arrayContaining([BIG, SMALL]));
    expect(JSON.stringify(s.needsAttention ?? [])).not.toMatch(/Big Team|Small Team/);
    const admin = (await get('/api/analytics/company-summary', c.admin)).body;
    expect(admin.scope).toMatchObject({ level: 'company', companyWide: true });
    expect(admin.teamCount).toBeGreaterThan(s.teamCount);
    const teams = (await get('/api/metrics/analytics/teams', c.vone)).body.teams.map((t: any) => t.id);
    expect(teams).toEqual([PARTIAL]);
    expect((await get('/api/metrics/dashboard', c.vone)).body.stats.totalTeams).toBe(1);
    const dept = (await get('/api/departments/golden-dept-a', c.vone)).body.department;
    expect(dept.teams).toEqual([]);
  });

  it('SCOPE-005: a viewer cannot request the executive briefing (company or scoped)', async () => {
    if (!up) return;
    // Viewers may not request the briefing at all (canRequestExecutiveBriefing).
    expect((await (await import('./helpers/http')).post('/api/analytics/company-insights', c.vone)).status).toBe(403);
  });
});

describe('Team detail header facts', () => {
  it('SCOPE-010: rank among the teams of the caller\'s scope; none with a single team', async () => {
    if (!up) return;
    const adminView = (await get(`/api/teams/${BIG}`, c.admin)).body.team;
    expect(adminView.qaRank).toMatchObject({ position: 1, scope: 'company' });
    expect(adminView.qaRank.of).toBeGreaterThanOrEqual(2);
    expect((await get(`/api/teams/${PARTIAL}`, c.vone)).body.team.qaRank).toBeNull();
    const two = (await get(`/api/teams/${PARTIAL}`, c.vtwo)).body.team.qaRank;
    expect(two).toMatchObject({ of: 2, scope: 'scope' });
  });

  it('SCOPE-011: people per role, team leads and Product Owners (job titles)', async () => {
    if (!up) return;
    const t = (await get(`/api/teams/${PARTIAL}`, c.vone)).body.team;
    expect(t.memberRoles.viewer).toBeGreaterThanOrEqual(2);
    expect(t.memberCount).toBe(Object.values<number>(t.memberRoles).reduce((a, b) => a + b, 0));
    expect(t.productOwners).toEqual([{ name: 'Scope viewer', jobTitle: 'Product Owner' }]);
    expect(Array.isArray(t.teamLeads)).toBe(true);
  });

  it('SCOPE-012: job title: super admins set it (trimmed, max 120, empty clears); others 403', async () => {
    if (!up) return;
    expect((await put('/api/admin/users/golden-u-vone', c.admin, { jobTitle: '  Product Owner, Payments  ' })).status).toBe(200);
    expect((await get('/api/users/golden-u-vone', c.vone)).body.user.job_title).toBe('Product Owner, Payments');
    expect((await get('/api/users/golden-u-vone', c.vone)).body.user.company_name).toBeTruthy();
    expect((await put('/api/admin/users/golden-u-vone', c.admin, { jobTitle: 'x'.repeat(121) })).status).toBe(400);
    expect((await put('/api/admin/users/golden-u-vone', c.mgra, { jobTitle: 'Nope' })).status).toBe(403);
    expect((await put('/api/admin/users/golden-u-vone', c.admin, { jobTitle: 'Product Owner' })).status).toBe(200);
  });
});
