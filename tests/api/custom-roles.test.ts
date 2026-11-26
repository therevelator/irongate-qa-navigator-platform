/**
 * Custom roles and invitations with several assignments (server/lib/userPolicy.ts CAPABILITIES,
 * server/lib/customRoles.ts, server/routes/roles.ts, server/routes/orgAdmin.ts). Needs the API and the database.
 *
 *   CR-00  the five access levels hold exactly the permissions they always had; a custom role adds and removes
 *   CR-01  who sees the roles: super admins and people who invite; a member does not
 *   CR-02  a role is created from a recommended template and changed; bad input and other roles are refused
 *   CR-03  the role works: a member with "Scrum Master" can create an action, without it cannot; individual
 *          developer metrics stay out of reach
 *   CR-04  changing the role's permissions applies to its people on their next request
 *   CR-05  nobody gives a permission they do not hold: a team lead cannot assign a role that adds the money view
 *   CR-06  archiving a role leaves its people on the base level
 *   CR-07  one invitation with several assignments: all are granted on acceptance; duplicates and too many refused
 */
import type { Client } from 'pg';
import { backendUp, del, get, localDb, login, post, put } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';
import {
  canSendPulseSurvey, canViewIndividualDevelopers, canViewPulseComments, canViewRevenueRollup, canWriteTeamData, capabilitiesOf,
  CAPABILITY_KEYS, LEVEL_CAPABILITIES, type PolicyActor,
} from '../../server/lib/userPolicy';

const BIG = 'golden-team-big';
const SMALL = 'golden-team-small';
const MEMBER = 'golden-u-big-2';
const STRONG = 'Str0ng-Passw0rd!-golden';
let up = true;
let db: Client;
let admin = '';
let lead = '';
let member = '';
let scrum: any;

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running - custom role tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  admin = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  lead = (await login('big-1@golden.example')).cookie;
  member = (await login('big-2@golden.example')).cookie;
}, 120_000);
afterAll(async () => {
  if (db) {
    await db.query(`DELETE FROM users WHERE company_id = $1 AND email LIKE 'cr-%@golden.example'`, [GOLDEN_COMPANY]).catch(() => undefined);
    await removeGolden(db);
    await db.end();
  }
});

const actor = (grants: PolicyActor['grants']): PolicyActor => ({ id: 'x', role: 'viewer', grants });
const team = { id: 't1', department_id: 'd1' };

describe('permissions of a level and of a custom role (pure)', () => {
  it('CR-00 the levels are unchanged; a custom role adds and removes', () => {
    expect(LEVEL_CAPABILITIES.super_admin).toEqual(CAPABILITY_KEYS);
    expect(LEVEL_CAPABILITIES.qa_manager).toEqual(CAPABILITY_KEYS);
    expect(LEVEL_CAPABILITIES.team_lead).toEqual(['view_individuals', 'view_wellbeing_comments', 'write_team_data', 'run_pulse']);
    expect(LEVEL_CAPABILITIES.qa_engineer).toEqual([]);
    expect(LEVEL_CAPABILITIES.viewer).toEqual([]);
    // A plain member: reads the team, nothing else.
    const plain = actor([{ role: 'qa_engineer', scopeType: 'team', scopeId: 't1' }]);
    expect([canWriteTeamData(plain, team), canViewIndividualDevelopers(plain, team), canSendPulseSurvey(plain, team), canViewRevenueRollup(plain)]).toEqual([false, false, false, false]);
    // The same member as Scrum Master.
    const sm = actor([{ role: 'qa_engineer', scopeType: 'team', scopeId: 't1', customRoleId: 'r', added: ['write_team_data', 'run_pulse', 'view_wellbeing_comments'], removed: [] }]);
    expect([canWriteTeamData(sm, team), canSendPulseSurvey(sm, team), canViewPulseComments(sm, team), canViewIndividualDevelopers(sm, team)]).toEqual([true, true, true, false]);
    // …and only on that team.
    expect(canWriteTeamData(sm, { id: 't2', department_id: 'd1' })).toBe(false);
    // A manager without personal data.
    const dm = actor([{ role: 'qa_manager', scopeType: 'department', scopeId: 'd1', customRoleId: 'r', added: [], removed: ['view_individuals', 'view_wellbeing_comments'] }]);
    expect([canViewIndividualDevelopers(dm, team), canViewPulseComments(dm, team), canWriteTeamData(dm, team), canViewRevenueRollup(dm)]).toEqual([false, false, true, true]);
    // A department-only permission cannot be held by a team-level role, whatever the row says.
    expect(capabilitiesOf('viewer', ['view_logs', 'view_money'], [])).toEqual(['view_money']);
    // Unknown names are ignored, never granted.
    expect(capabilitiesOf('viewer', ['manage_everything'], [])).toEqual([]);
  });
});

describe('custom roles over the API', () => {
  it('CR-01 who sees the roles', async () => {
    if (!up) return;
    expect((await get('/api/roles')).status).toBe(401);
    expect((await get('/api/roles', member)).status).toBe(403);
    const asLead = await get('/api/roles', lead);
    expect(asLead.status).toBe(200);
    expect(asLead.body.canManage).toBe(false);
    const res = await get('/api/roles', admin);
    expect(res.body.canManage).toBe(true);
    expect(res.body.levels.map((l: any) => l.key)).toEqual(['super_admin', 'qa_manager', 'team_lead', 'qa_engineer', 'viewer']);
    expect(res.body.capabilities.map((c: any) => c.key)).toEqual(CAPABILITY_KEYS);
    expect(res.body.templates.map((t: any) => t.key)).toEqual(['scrum_master', 'product_owner', 'qa_lead', 'devops_engineer', 'engineering_manager', 'delivery_manager', 'executive_sponsor']);
    expect(res.body.roles).toEqual([]);
  });

  it('CR-02 create from a template, change, refusals', async () => {
    if (!up) return;
    const tpl = (await get('/api/roles', admin)).body.templates.find((t: any) => t.key === 'scrum_master');
    expect((await post('/api/roles', lead, { name: 'Scrum Master', baseRole: tpl.baseRole, added: tpl.added })).status).toBe(403);
    const made = await post('/api/roles', admin, { name: 'Scrum Master', description: tpl.description, baseRole: tpl.baseRole, added: tpl.added, removed: tpl.removed, templateKey: tpl.key });
    expect(made.status).toBe(201);
    scrum = made.body.role;
    expect(scrum).toMatchObject({ name: 'Scrum Master', baseRole: 'qa_engineer', people: 0, capabilities: ['view_wellbeing_comments', 'write_team_data', 'run_pulse'] });
    expect((await post('/api/roles', admin, { name: 'scrum master', baseRole: 'viewer' })).status).toBe(409);
    for (const bad of [{ name: 'X', baseRole: 'viewer' }, { name: 'Boss', baseRole: 'super_admin' }, { name: 'Odd', baseRole: 'viewer', added: ['manage_everything'] }, { name: 'Logs', baseRole: 'viewer', added: ['view_logs'] }]) {
      expect((await post('/api/roles', admin, bad)).status).toBe(400);
    }
    const audit = await db.query(`SELECT summary FROM audit_log WHERE company_id = $1 AND action = 'role.create' ORDER BY created_at DESC LIMIT 1`, [GOLDEN_COMPANY]);
    expect(audit.rows[0].summary).toContain('Scrum Master');
  });

  it('CR-03 the role works on the team it is given on', async () => {
    if (!up) return;
    const action = { teamId: BIG, title: 'Agree the definition of done' };
    expect((await post('/api/actions', member, action)).status).toBe(403);
    const given = await post(`/api/admin/users/${MEMBER}/assignments`, admin, { customRoleId: scrum.id, scopeId: BIG });
    expect(given.status).toBe(201);
    expect(given.body.assignments.find((a: any) => a.scope_id === BIG)).toMatchObject({ role: 'qa_engineer', custom_role_id: scrum.id, custom_role_name: 'Scrum Master' });
    // Signed in again: the assignment carries the role's permissions for the interface.
    member = (await login('big-2@golden.example')).cookie;
    const me = (await get('/api/auth/me', member)).body.user;
    expect(me.assignments.find((a: any) => a.scopeId === BIG)).toMatchObject({ role: 'qa_engineer', customRoleName: 'Scrum Master', added: expect.arrayContaining(['write_team_data', 'run_pulse']) });
    expect((await post('/api/actions', member, action)).status).toBe(201);
    // Another team is still out of reach, and so are the people-management pages of a lead.
    expect((await post('/api/actions', member, { teamId: SMALL, title: 'Not mine' })).status).toBe(403);
    expect((await get('/api/roles', member)).status).toBe(403);
    expect((await get('/api/roles', admin)).body.roles[0].people).toBe(1);
  });

  it('CR-04 a change of permissions applies at once', async () => {
    if (!up) return;
    const changed = await put(`/api/roles/${scrum.id}`, admin, { name: 'Scrum Master', added: ['run_pulse'] });
    expect(changed.status).toBe(200);
    expect(changed.body.role.capabilities).toEqual(['run_pulse']);
    expect((await post('/api/actions', member, { teamId: BIG, title: 'No longer allowed' })).status).toBe(403);
    expect((await put(`/api/roles/${scrum.id}`, admin, { name: 'Scrum Master', added: ['write_team_data', 'run_pulse', 'view_wellbeing_comments'] })).body.role.capabilities).toHaveLength(3);
    expect((await post('/api/actions', member, { teamId: BIG, title: 'Allowed again' })).status).toBe(201);
    expect((await put(`/api/roles/${scrum.id}`, lead, { name: 'Mine now' })).status).toBe(403);
  });

  it('CR-05 nobody gives a permission they do not hold', async () => {
    if (!up) return;
    const po = (await post('/api/roles', admin, { name: 'Product Owner', baseRole: 'viewer', added: ['view_money'] })).body.role;
    // The lead of Big Team has no money view: the role is refused from them, accepted from the super admin.
    const asLead = await post('/api/admin/users/golden-u-big-3/assignments', lead, { customRoleId: po.id, scopeId: BIG });
    expect(asLead.status).toBe(403);
    // A role whose additions the lead does hold (Scrum Master ⊂ team lead) can be given by the lead.
    expect((await post('/api/admin/users/golden-u-big-3/assignments', lead, { customRoleId: scrum.id, scopeId: BIG })).status).toBe(201);
    expect((await post('/api/admin/users/golden-u-big-4/assignments', admin, { customRoleId: po.id, scopeId: BIG })).status).toBe(201);
  });

  it('CR-06 archiving leaves the people on the base level', async () => {
    if (!up) return;
    const gone = await del(`/api/roles/${scrum.id}`, admin);
    expect(gone.body).toEqual({ archived: true, people: 2 });
    expect((await get('/api/roles', admin)).body.roles.map((r: any) => r.name)).toEqual(['Product Owner']);
    expect((await post('/api/actions', member, { teamId: BIG, title: 'After the role went' })).status).toBe(403);
    const me = (await get('/api/auth/me', member)).body.user;
    expect(me.assignments.find((a: any) => a.scopeId === BIG)).toMatchObject({ role: 'qa_engineer', customRoleId: null });
    expect((await post(`/api/admin/users/${MEMBER}/assignments`, admin, { customRoleId: scrum.id, scopeId: SMALL })).status).toBe(400);
  });

  it('CR-07 one invitation, several assignments', async () => {
    if (!up) return;
    const sm = (await post('/api/roles', admin, { name: 'Scrum Master', baseRole: 'qa_engineer', added: ['write_team_data', 'run_pulse'] })).body.role;
    const email = `cr-${Date.now()}@golden.example`;
    const base = { email, customRoleId: sm.id, scopeId: BIG };
    expect((await post('/api/admin/invitations', admin, { ...base, extraGrants: [{ customRoleId: sm.id, scopeId: BIG }] })).status).toBe(400);
    expect((await post('/api/admin/invitations', admin, { ...base, extraGrants: Array.from({ length: 21 }, () => ({ role: 'viewer', scopeId: SMALL })) })).status).toBe(400);
    // A lead cannot use the invitation to reach a team they do not lead.
    expect((await post('/api/admin/invitations', lead, { email, role: 'qa_engineer', scopeId: BIG, extraGrants: [{ role: 'viewer', scopeId: 'golden-team-stale' }] })).status).toBe(403);
    const inv = await post('/api/admin/invitations', admin, { ...base, extraGrants: [{ customRoleId: sm.id, scopeId: SMALL }, { role: 'viewer', scopeId: 'golden-team-stale' }] });
    expect(inv.status).toBe(201);
    expect(inv.body.invitation).toMatchObject({ role: 'qa_engineer', custom_role_name: 'Scrum Master' });
    expect(inv.body.invitation.extra_grants).toHaveLength(2);
    const token = new URL(inv.body.link).searchParams.get('token')!;
    const accepted = await post('/api/auth/invitations/accept', '', { token, firstName: 'Sam', lastName: 'Scrum', password: STRONG });
    expect(accepted.status).toBe(201);
    const rows = await db.query(
      `SELECT ra.scope_id, ra.role, cr.name FROM role_assignments ra LEFT JOIN custom_roles cr ON cr.id = ra.custom_role_id
        WHERE ra.user_id = (SELECT id FROM users WHERE email = $1) AND ra.revoked_at IS NULL ORDER BY ra.scope_id`, [email]);
    expect(rows.rows).toEqual([
      { scope_id: BIG, role: 'qa_engineer', name: 'Scrum Master' },
      { scope_id: SMALL, role: 'qa_engineer', name: 'Scrum Master' },
      { scope_id: 'golden-team-stale', role: 'viewer', name: null },
    ]);
  });
});
