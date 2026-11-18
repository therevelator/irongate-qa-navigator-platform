import type { Client } from 'pg';
import { backendUp, get, localDb, login } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

/**
 * GET /api/teams/:id and /api/teams/:id/kpi-history with the shared policy:
 *   - the team and its KPIs: company-visible (the dashboard lists every team);
 *   - member names, emails and roles: canViewTeamMembers (super_admin, the QA manager of the
 *     team's department, people assigned to the team); others get members [] + membersHidden;
 *   - KPI history: the analytics scope (canViewTeamAnalytics), 403 outside it;
 *   - another company: 404 / 403.
 * Also: GET /api/analytics/developer-metrics without teamId degrades to an empty list for a
 * caller with no team of their own (the Users page call), instead of 400.
 * Runs against a live backend at API_URL; skips cleanly when none is running.
 */

let up = true;
let db: Client;
const c: Record<string, string> = {};

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  await createGolden(db);
  const add = async (id: string, email: string, role: string, dept: string, scopeType: string, scopeId: string, primary: string | null) => {
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
       SELECT $1, $2, password_hash, 'Fixture', $3::text, $3::text, $4, $5, $6, TRUE, TRUE FROM users WHERE id = 'golden-u-admin' ON CONFLICT (id) DO NOTHING`,
      [id, email, role, GOLDEN_COMPANY, dept, primary]
    );
    await db.query(
      `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [`golden-ra-${id}`, GOLDEN_COMPANY, id, role, scopeType, scopeId]
    );
  };
  await add('golden-u-mgr', 'mgr@golden.example', 'qa_manager', 'golden-dept-b', 'department', 'golden-dept-b', null);
  await add('golden-u-viewer', 'viewer@golden.example', 'viewer', 'golden-dept-b', 'team', 'golden-team-partial', 'golden-team-partial');
  c.admin = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  c.manager = (await login('mgr@golden.example')).cookie;
  c.lead = (await login('partial-1@golden.example')).cookie;
  c.engineer = (await login('partial-2@golden.example')).cookie;
  c.viewer = (await login('viewer@golden.example')).cookie;
  c.foreign = (await login('alex.morgan@northwind.example')).cookie;
});

afterAll(async () => {
  if (db) {
    await removeGolden(db);
    await db.end();
  }
});

const team = (id: string, who: string) => get(`/api/teams/${id}`, c[who]);
const history = (id: string, who: string) => get(`/api/teams/${id}/kpi-history?days=30`, c[who]);

describe('GET /api/teams/:id — members only for people allowed to see them', () => {
  it('TRP-001: super admin sees members (names, emails) of any team', async () => {
    if (!up) return;
    const res = await team('golden-team-small', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.team.membersHidden).toBe(false);
    expect(res.body.team.members.map((m: any) => m.email).sort()).toEqual(['small-1@golden.example', 'small-2@golden.example']);
  });

  it('TRP-002: QA manager: members of the teams of their department only; KPIs of every team', async () => {
    if (!up) return;
    const own = await team('golden-team-partial', 'manager');
    expect(own.body.team.members.length).toBeGreaterThan(0);
    const other = await team('golden-team-small', 'manager');
    expect(other.status).toBe(200);
    expect(other.body.team.qaScore).toBe(81);
    expect(other.body.team.members).toEqual([]);
    expect(other.body.team.membersHidden).toBe(true);
  });

  it('TRP-003: lead, engineer and viewer: members of their own team only', async () => {
    if (!up) return;
    for (const who of ['lead', 'engineer', 'viewer']) {
      const own = await team('golden-team-partial', who);
      expect(own.status).toBe(200);
      expect(own.body.team.membersHidden).toBe(false);
      expect(own.body.team.members.some((m: any) => m.email === 'partial-1@golden.example')).toBe(true);
      const other = await team('golden-team-big', who);
      expect(other.status).toBe(200);
      expect(other.body.team.kpiData).toBeTruthy();
      expect(other.body.team.members).toEqual([]);
      expect(JSON.stringify(other.body)).not.toContain('@golden.example');
    }
  });

  it('TRP-004: another company: 404', async () => {
    if (!up) return;
    if (!c.foreign) return;
    expect((await team('golden-team-small', 'foreign')).status).toBe(404);
  });
});

describe('GET /api/teams/:id/kpi-history — analytics scope', () => {
  it('TRP-010: in scope 200, out of scope 403, per role', async () => {
    if (!up) return;
    expect((await history('golden-team-small', 'admin')).status).toBe(200);
    expect((await history('golden-team-partial', 'manager')).status).toBe(200);
    expect((await history('golden-team-small', 'manager')).status).toBe(403);
    for (const who of ['lead', 'engineer', 'viewer']) {
      expect((await history('golden-team-partial', who)).status).toBe(200);
      expect((await history('golden-team-big', who)).status).toBe(403);
    }
    if (c.foreign) expect((await history('golden-team-small', 'foreign')).status).toBe(403);
    expect((await get('/api/teams/golden-team-small/kpi-history', '')).status).toBe(401);
  });
});

describe('GET /api/analytics/developer-metrics without a team', () => {
  it('TRP-020: a caller with no team of their own gets an empty list (200), not an error', async () => {
    if (!up) return;
    const res = await get('/api/analytics/developer-metrics', c.admin); // golden admin: company scope, no team
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ teamId: null, developers: [] });
    // With a team the normal rules apply.
    expect((await get('/api/analytics/developer-metrics?teamId=golden-team-big', c.admin)).status).toBe(200);
    expect((await get('/api/analytics/developer-metrics?teamId=golden-team-big', c.viewer)).status).toBe(403);
    // A caller with an own team still defaults to it.
    expect((await get('/api/analytics/developer-metrics', c.viewer)).body.teamId).toBe('golden-team-partial');
  });
});
