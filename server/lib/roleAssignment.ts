import { query, queryOne } from '../../src/lib/db';
import {
  loadGrants, grantAssignment, revokeGrant, syncUserDisplay, lastSuperAdminGuard, departmentManagers, teamsLedBy,
  AssignmentError, type Exec,
} from './assignments';
import { auditedUserChange } from './audit';
import { ROLE_RANK, type Grant } from './userPolicy';

/**
 * Assigning department QA managers and team leads (Departments page, super_admin only).
 * The ONE place for these rules, used by:
 *   POST /api/admin/departments/:id/managers               { userId, dryRun? }
 *   POST /api/admin/departments/:id/managers/:userId/remove { role, teamId?, dryRun? }
 *   PUT  /api/admin/teams/:id/lead                          { userId, dryRun? }
 *
 * All three change role ASSIGNMENTS (server/lib/assignments.ts) in one transaction, recorded in
 * the change history (undoable). Common rules: the assignee is an active user of the caller's
 * company; an admin cannot change their own role, and the last super_admin of a company cannot
 * be demoted. Authorisation reads the assignments on every request, so a change applies to the
 * user's next request without signing in again.
 *
 * Department manager: adds a qa_manager assignment on the department. Other departments the
 *   person manages stay (a manager may manage several). Their team assignments in the department
 *   stay; team assignments elsewhere end (a manager's scope is their departments), so teams they
 *   led there lose them as lead. A super admin made manager loses the super admin assignment.
 * Removing a manager: ends the qa_manager assignment of that department; the person stays in the
 *   department with the chosen role (qa_engineer by default, or viewer) on a team there. A
 *   qa_engineer needs a team in the department.
 * Team lead: the team_lead assignment of the team (one per team) goes to the user; their primary
 *   team becomes the team. Other teams they lead stay; a membership of their previous primary team
 *   ends; QA manager / super admin assignments end (they will see only their teams). The previous
 *   lead stays on the team as a qa_engineer (their role stays team_lead if they lead another team).
 */

export const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin', qa_manager: 'QA manager', team_lead: 'Team lead', qa_engineer: 'QA engineer', viewer: 'Viewer',
};
const label = (role: string) => ROLE_LABEL[role] ?? role;

/** Roles a removed manager can be given. */
export const MANAGER_REMOVAL_ROLES = ['qa_engineer', 'viewer'] as const;

interface UserRow {
  id: string; first_name: string | null; last_name: string | null; email: string; role: string;
  department_id: string | null; primary_team_id: string | null; is_active: boolean;
  department_name: string | null; team_name: string | null; team_department_id: string | null;
}

export interface PersonSummary { id: string; name: string; email: string; role: string }

export interface AssignmentPlan {
  kind: 'assign_manager' | 'remove_manager' | 'assign_lead';
  user: PersonSummary;
  /** Display role before / after (highest role). */
  role: { from: string; to: string };
  department: { from: string | null; to: string | null; fromName: string | null; toName: string | null };
  primaryTeam: { from: string | null; to: string | null; fromName: string | null; toName: string | null };
  /** Assignments that end / start for the user. */
  revokes: Grant[];
  grants: Grant[];
  /** Teams whose lead assignment ends (assign_manager). */
  clearedLeadOf: Array<{ id: string; name: string }>;
  /** assign_lead: the lead being replaced and what happens to them. */
  previousLead: (PersonSummary & { newRole: string; alsoLeads: string[] }) | null;
  /** Plain-language consequences, shown in the confirm dialog. */
  consequences: string[];
}

type Fail = { ok: false; status: number; error: string };
export type PlanResult = { ok: true; plan: AssignmentPlan; target: { id: string; teamId?: string; departmentId?: string } } | Fail;
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

const nameOf = (u: { first_name: string | null; last_name: string | null; email: string }) =>
  `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email;
const summary = (u: UserRow): PersonSummary => ({ id: u.id, name: nameOf(u), email: u.email, role: u.role });
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const highest = (gs: Grant[], fallback: string) =>
  gs.length ? gs.reduce((b, g) => ((ROLE_RANK[g.role] ?? 0) > (ROLE_RANK[b] ?? 0) ? g.role : b), gs[0].role) : fallback;
const same = (a: Grant, b: Grant) => a.role === b.role && a.scopeType === b.scopeType && a.scopeId === b.scopeId;

async function loadUser(companyId: string, userId: unknown): Promise<UserRow | null> {
  if (typeof userId !== 'string' || !userId) return null;
  return queryOne<UserRow>(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.department_id, u.primary_team_id, u.is_active,
            d.name AS department_name, t.name AS team_name, t.department_id AS team_department_id
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN teams t ON t.id = u.primary_team_id
      WHERE u.id = ? AND u.company_id = ?`,
    [userId, companyId]
  );
}

/** Same company and active (another company's user reads as not found). */
async function loadAssignee(companyId: string, userId: unknown): Promise<UserRow | Fail> {
  if (typeof userId !== 'string' || !userId) return fail(400, 'userId is required');
  const u = await loadUser(companyId, userId);
  if (!u) return fail(400, 'User not found in your company');
  if (!u.is_active) return fail(400, 'That user is inactive. Reactivate them on the Users page first.');
  return u;
}

/** Role-change guard: never your own role, never the company's last super_admin. */
export async function roleChangeError(companyId: string, actorId: string, target: { id: string; role: string }, losesSuperAdmin: boolean): Promise<string | null> {
  if (target.id === actorId) return 'You cannot change your own role';
  if (losesSuperAdmin) {
    try {
      await lastSuperAdminGuard(companyId, target.id);
    } catch (e) {
      if (e instanceof AssignmentError) return e.message;
      throw e;
    }
  }
  return null;
}

/** Teams (id → name, department) for a set of team grants. */
async function teamInfo(ids: string[]): Promise<Map<string, { name: string; department_id: string | null }>> {
  if (!ids.length) return new Map();
  const rows = await query<any[]>('SELECT id, name, department_id FROM teams WHERE id = ANY(?::text[])', [ids]);
  return new Map(rows.map((r: any) => [r.id, { name: r.name, department_id: r.department_id }]));
}

function changeLines(who: string, p: AssignmentPlan): string[] {
  const out: string[] = [];
  if (p.role.from !== p.role.to) out.push(`${who}'s role changes from ${label(p.role.from)} to ${label(p.role.to)}.`);
  if (p.revokes.some((g) => g.role === 'super_admin')) out.push(`${who} loses super admin access: other departments, admin settings and API keys.`);
  return out;
}

/* ------------------------------------------------------------------------------------------ */

export async function planAssignManager(companyId: string, actorId: string, departmentId: string, userId: unknown): Promise<PlanResult> {
  const dept = await queryOne<any>('SELECT id, name, is_active FROM departments WHERE id = ? AND company_id = ?', [departmentId, companyId]);
  if (!dept) return fail(404, 'Department not found');
  if (!dept.is_active) return fail(400, 'That department is inactive');
  const u = await loadAssignee(companyId, userId);
  if ('ok' in u) return u;
  const grants = await loadGrants(companyId, u.id);
  const add: Grant = { role: 'qa_manager', scopeType: 'department', scopeId: dept.id };
  if (grants.some((g) => same(g, add))) return fail(400, `${nameOf(u)} is already a QA manager of ${dept.name}`);

  const teams = await teamInfo(grants.filter((g) => g.scopeType === 'team').map((g) => g.scopeId));
  const revokes = grants.filter((g) => g.role === 'super_admin'
    || (g.scopeType === 'team' && teams.get(g.scopeId)?.department_id !== dept.id));
  const roleErr = await roleChangeError(companyId, actorId, u, revokes.some((g) => g.role === 'super_admin'));
  if (roleErr) return fail(400, roleErr);

  const after = [...grants.filter((g) => !revokes.some((r) => same(r, g))), add];
  const keepTeam = !!u.primary_team_id && after.some((g) => g.scopeType === 'team' && g.scopeId === u.primary_team_id);
  const otherDepts = grants.filter((g) => g.role === 'qa_manager').map((g) => g.scopeId);
  const otherDeptNames = otherDepts.length
    ? (await query<any[]>('SELECT name FROM departments WHERE id = ANY(?::text[]) ORDER BY name', [otherDepts])).map((d: any) => d.name as string)
    : [];
  const led = revokes.filter((g) => g.role === 'team_lead').map((g) => ({ id: g.scopeId, name: teams.get(g.scopeId)?.name ?? g.scopeId }));

  const plan: AssignmentPlan = {
    kind: 'assign_manager',
    user: summary(u),
    role: { from: u.role, to: highest(after, u.role) },
    department: { from: u.department_id, to: dept.id, fromName: u.department_name, toName: dept.name },
    primaryTeam: { from: u.primary_team_id, to: keepTeam ? u.primary_team_id : null, fromName: u.team_name, toName: keepTeam ? u.team_name : null },
    revokes, grants: [add],
    clearedLeadOf: led,
    previousLead: null,
    consequences: [],
  };
  const who = nameOf(u);
  const c = changeLines(who, plan);
  const scope = 'every team\'s analytics there, and can manage its teams and users';
  if (otherDeptNames.length) {
    c.push(`${who} will manage ${dept.name} as well as ${list(otherDeptNames)}: they will see ${scope}.`);
  } else if (u.department_id !== dept.id) {
    c.push(`${who} moves from ${u.department_name ?? 'no department'} to ${dept.name} and will manage it: they will see ${scope}.`);
  } else {
    c.push(`${who} will manage ${dept.name}: they will see ${scope}.`);
  }
  const leftTeams = revokes.filter((g) => g.scopeType === 'team' && g.role !== 'team_lead').map((g) => teams.get(g.scopeId)?.name ?? g.scopeId);
  if (leftTeams.length) c.push(`${who} leaves ${list(leftTeams)} (QA managers do not need a team; their scope is the department).`);
  if (keepTeam) c.push(`${who} stays a member of ${u.team_name}.`);
  if (led.length) c.push(`${list(led.map((t) => t.name))} will no longer have ${who} as team lead.`);
  plan.consequences = c;
  return { ok: true, plan, target: { id: u.id, departmentId: dept.id } };
}

/** Apply a plan's assignment changes for its user, then the display columns. */
async function applyUserGrants(exec: Exec, companyId: string, actorId: string, userId: string, plan: AssignmentPlan, prefs: Parameters<typeof syncUserDisplay>[2]) {
  for (const g of plan.revokes) await revokeGrant(exec, { userId, grant: g, actorId });
  for (const g of plan.grants) await grantAssignment(exec, { companyId, userId, grant: g, actorId, replaceLead: plan.kind === 'assign_lead' });
  await syncUserDisplay(exec, userId, prefs);
}

export async function applyAssignManager(companyId: string, actorId: string, plan: AssignmentPlan): Promise<void> {
  await auditedUserChange(
    { companyId, actorId, action: 'department.manager_assign', userIds: [plan.user.id], extraSubjects: [plan.department.to as string] },
    async (exec) => {
      await applyUserGrants(exec, companyId, actorId, plan.user.id, plan, { departmentId: plan.department.to, primaryTeamId: plan.primaryTeam.to });
      return { summary: `${plan.user.name} made QA manager of ${plan.department.toName}`, result: null };
    },
  );
}

/* ------------------------------------------------------------------------------------------ */

export async function planRemoveManager(
  companyId: string, actorId: string, departmentId: string, userId: string, newRole: unknown, teamId: unknown
): Promise<PlanResult> {
  const role = typeof newRole === 'string' && newRole ? newRole : 'qa_engineer';
  if (!(MANAGER_REMOVAL_ROLES as readonly string[]).includes(role)) return fail(400, 'role must be qa_engineer or viewer');
  const dept = await queryOne<any>('SELECT id, name FROM departments WHERE id = ? AND company_id = ?', [departmentId, companyId]);
  if (!dept) return fail(404, 'Department not found');
  const u = await loadUser(companyId, userId);
  if (!u) return fail(400, 'User not found in your company');
  const grants = await loadGrants(companyId, u.id);
  const mgr: Grant = { role: 'qa_manager', scopeType: 'department', scopeId: dept.id };
  if (!grants.some((g) => same(g, mgr))) return fail(400, `${nameOf(u)} is not a QA manager of ${dept.name}`);
  const roleErr = await roleChangeError(companyId, actorId, u, false);
  if (roleErr) return fail(400, roleErr);

  const teams = await teamInfo(grants.filter((g) => g.scopeType === 'team').map((g) => g.scopeId));
  let team: { id: string; name: string } | null = null;
  if (typeof teamId === 'string' && teamId) {
    team = await queryOne<any>('SELECT id, name FROM teams WHERE id = ? AND company_id = ? AND department_id = ? AND is_active = TRUE', [teamId, companyId, dept.id]);
    if (!team) return fail(400, `Choose an active team in ${dept.name}`);
  } else {
    const inDept = grants.filter((g) => g.scopeType === 'team' && teams.get(g.scopeId)?.department_id === dept.id);
    const pick = inDept.find((g) => g.scopeId === u.primary_team_id) ?? inDept[0];
    if (pick) team = { id: pick.scopeId, name: teams.get(pick.scopeId)?.name ?? '' };
  }
  if (!team && role === 'qa_engineer') return fail(400, `A QA engineer needs a team: choose a team in ${dept.name}, or make ${nameOf(u)} a viewer`);

  const existingOnTeam = team ? grants.find((g) => g.scopeType === 'team' && g.scopeId === team!.id) : undefined;
  const add: Grant[] = team && existingOnTeam?.role !== 'team_lead' && existingOnTeam?.role !== role
    ? [{ role, scopeType: 'team', scopeId: team.id }]
    : [];
  const after = [...grants.filter((g) => !same(g, mgr) && !(add.length && g.scopeType === 'team' && g.scopeId === team!.id)), ...add];

  const others = await departmentManagers(companyId, dept.id);
  const plan: AssignmentPlan = {
    kind: 'remove_manager',
    user: summary(u),
    role: { from: u.role, to: highest(after, role) },
    department: { from: u.department_id, to: dept.id, fromName: u.department_name, toName: dept.name },
    primaryTeam: { from: u.primary_team_id, to: team?.id ?? null, fromName: u.team_name, toName: team?.name ?? null },
    revokes: [mgr], grants: add,
    clearedLeadOf: [],
    previousLead: null,
    consequences: [],
  };
  const who = nameOf(u);
  const c = changeLines(who, plan);
  c.push(`${who} stays in ${dept.name} but will no longer manage it.`);
  c.push(team
    ? `${who} will see ${team.name}${role === 'viewer' ? ', read-only' : ''}${team.id !== u.primary_team_id ? ` (their new primary team)` : ''}.`
    : `${who} will have no team, so no team analytics, until a team is assigned on the Users page.`);
  if (!others.some((m) => m.id !== u.id)) c.push(`${dept.name} will have no QA manager; only super admins will manage it.`);
  plan.consequences = c;
  return { ok: true, plan, target: { id: u.id, departmentId: dept.id } };
}

export async function applyRemoveManager(companyId: string, actorId: string, plan: AssignmentPlan): Promise<void> {
  await auditedUserChange(
    { companyId, actorId, action: 'department.manager_remove', userIds: [plan.user.id], extraSubjects: [plan.department.to as string] },
    async (exec) => {
      await applyUserGrants(exec, companyId, actorId, plan.user.id, plan, {
        primaryTeamId: plan.primaryTeam.to, departmentId: plan.department.to, fallbackRole: plan.role.to,
      });
      return { summary: `${plan.user.name} is no longer QA manager of ${plan.department.toName}`, result: null };
    },
  );
}

/* ------------------------------------------------------------------------------------------ */

export async function planAssignLead(companyId: string, actorId: string, teamId: string, userId: unknown): Promise<PlanResult> {
  const team = await queryOne<any>(
    `SELECT t.id, t.name, t.department_id, t.is_active, d.name AS department_name
       FROM teams t LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.id = ? AND t.company_id = ?`,
    [teamId, companyId]
  );
  if (!team) return fail(404, 'Team not found');
  if (!team.is_active) return fail(400, 'That team is inactive');
  if (!team.department_id) return fail(400, 'The team has no department');
  const u = await loadAssignee(companyId, userId);
  if ('ok' in u) return u;
  const grants = await loadGrants(companyId, u.id);
  const lead: Grant = { role: 'team_lead', scopeType: 'team', scopeId: team.id };
  if (grants.some((g) => same(g, lead))) return fail(400, `${nameOf(u)} already leads ${team.name}`);

  // The new lead: keeps other teams they lead and other memberships, leaves the membership of
  // their previous primary team (unless they lead it), and ends manager / admin assignments.
  const revokes = grants.filter((g) => g.role === 'super_admin' || g.role === 'qa_manager'
    || (g.scopeType === 'team' && g.scopeId === u.primary_team_id && g.scopeId !== team.id && g.role !== 'team_lead'));
  const roleErr = await roleChangeError(companyId, actorId, u, revokes.some((g) => g.role === 'super_admin'));
  if (roleErr) return fail(400, roleErr);

  // The lead today: the team's active team_lead assignment (any user, so an inactive lead is replaced too).
  const prevRow = await queryOne<{ user_id: string }>(
    `SELECT user_id FROM role_assignments WHERE scope_type = 'team' AND scope_id = ? AND role = 'team_lead' AND revoked_at IS NULL AND user_id <> ?`,
    [team.id, u.id]
  );
  const prev = prevRow ? await loadUser(companyId, prevRow.user_id) : null;
  let previousLead: AssignmentPlan['previousLead'] = null;
  if (prev) {
    const prevGrants = await loadGrants(companyId, prev.id);
    const prevAfter = [...prevGrants.filter((g) => !same(g, lead)), { role: 'qa_engineer', scopeType: 'team', scopeId: team.id }];
    const alsoLeads = (await teamsLedBy(companyId, prev.id)).filter((t) => t.id !== team.id).map((t) => t.name);
    previousLead = { ...summary(prev), newRole: highest(prevAfter, prev.role), alsoLeads };
  }
  const alsoLeads = (await teamsLedBy(companyId, u.id)).filter((t) => t.id !== team.id).map((t) => t.name);
  const after = [...grants.filter((g) => !revokes.some((r) => same(r, g)) && !(g.scopeType === 'team' && g.scopeId === team.id)), lead];

  const plan: AssignmentPlan = {
    kind: 'assign_lead',
    user: summary(u),
    role: { from: u.role, to: highest(after, 'team_lead') },
    department: { from: u.department_id, to: team.department_id, fromName: u.department_name, toName: team.department_name },
    primaryTeam: { from: u.primary_team_id, to: team.id, fromName: u.team_name, toName: team.name },
    revokes, grants: [lead],
    clearedLeadOf: [],
    previousLead,
    consequences: [],
  };
  const who = nameOf(u);
  const c = changeLines(who, plan);
  c.push(`${who} becomes team lead of ${team.name}${u.primary_team_id === team.id ? '' : ` and ${team.name} becomes their primary team`}.`);
  if (grants.some((g) => g.role === 'qa_manager')) c.push(`${who} stops managing ${u.department_name ?? 'their department'} and will see only the teams they belong to.`);
  if (u.department_id !== team.department_id) c.push(`${who} moves from ${u.department_name ?? 'no department'} to ${team.department_name}.`);
  if (revokes.some((g) => g.scopeType === 'team')) c.push(`${who} leaves ${u.team_name ?? 'their current team'}.`);
  if (alsoLeads.length) c.push(`${who} keeps leading ${list(alsoLeads)} as well.`);
  if (previousLead && prev) {
    const p = nameOf(prev);
    if (previousLead.newRole !== prev.role) {
      c.push(`${p}, the current lead, stays on ${team.name} as ${label(previousLead.newRole)} (role changes from ${label(prev.role)}).`);
    } else if (previousLead.alsoLeads.length) {
      c.push(`${p}, the current lead, stays on ${team.name} and keeps the team lead role because they also lead ${list(previousLead.alsoLeads)}.`);
    } else {
      c.push(`${p} is no longer lead of ${team.name} and keeps the ${label(prev.role)} role.`);
    }
  } else {
    c.push(`${team.name} has no lead today, so nobody else changes.`);
  }
  plan.consequences = c;
  return { ok: true, plan, target: { id: u.id, teamId: team.id } };
}

export async function applyAssignLead(companyId: string, actorId: string, plan: AssignmentPlan): Promise<void> {
  const teamId = plan.primaryTeam.to as string;
  const users = [plan.user.id, ...(plan.previousLead ? [plan.previousLead.id] : [])];
  await auditedUserChange(
    { companyId, actorId, action: 'team.lead_change', entityType: 'team', entityId: teamId, userIds: users, extraSubjects: [teamId] },
    async (exec) => {
      await applyUserGrants(exec, companyId, actorId, plan.user.id, plan, { primaryTeamId: teamId, departmentId: plan.department.to });
      if (plan.previousLead) await syncUserDisplay(exec, plan.previousLead.id);
      return { summary: `${plan.user.name} made team lead of ${plan.primaryTeam.toName}${plan.previousLead ? ` (replacing ${plan.previousLead.name})` : ''}`, result: null };
    },
  );
}
