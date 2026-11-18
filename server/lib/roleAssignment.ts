import { query, queryOne, transaction } from '../../src/lib/db';
import { execOn, syncPrimaryTeamMembership } from './teamMembership';

/**
 * Assigning department QA managers and team leads (Departments page, super_admin only).
 * The ONE place for these rules, used by:
 *   POST /api/admin/departments/:id/managers               { userId, dryRun? }
 *   POST /api/admin/departments/:id/managers/:userId/remove { role, teamId?, dryRun? }
 *   PUT  /api/admin/teams/:id/lead                          { userId, dryRun? }
 *
 * Common rules: the assignee is an active user of the caller's company; an admin cannot
 * change their own role, and the last super_admin of a company cannot be demoted. Each
 * assignment runs in one transaction. Authorisation reads role, department and primary team
 * from the users row on every request (middleware/auth.ts), so a change applies to the user's
 * next request without signing in again.
 *
 * Department manager: role qa_manager, department_id = the department. The primary team is
 *   kept when it is a team of that department, otherwise cleared (a manager's scope is the
 *   whole department). Teams the person led (teams.lead_id) lose them as lead.
 * Removing a manager: the person stays in the department with the chosen role (qa_engineer by
 *   default, or viewer). A qa_engineer needs a primary team in the department.
 * Team lead: teams.lead_id = the user, who becomes team_lead with primary_team_id = the team
 *   and department_id = the team's department (team_members kept in step). The previous lead
 *   stays on the team: demoted to qa_engineer, unless they still lead another team, in which
 *   case they keep the team_lead role.
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
  role: { from: string; to: string };
  department: { from: string | null; to: string | null; fromName: string | null; toName: string | null };
  primaryTeam: { from: string | null; to: string | null; fromName: string | null; toName: string | null };
  /** Teams whose lead_id is cleared (assign_manager). */
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
const firstName = (u: UserRow) => nameOf(u);
const summary = (u: UserRow): PersonSummary => ({ id: u.id, name: nameOf(u), email: u.email, role: u.role });
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

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
export async function roleChangeError(companyId: string, actorId: string, target: { id: string; role: string }, newRole: string): Promise<string | null> {
  if (target.role === newRole) return null;
  if (target.id === actorId) return 'You cannot change your own role';
  if (target.role === 'super_admin') {
    const row = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM users WHERE company_id = ? AND role = 'super_admin' AND is_active = TRUE`,
      [companyId]
    );
    if ((row?.n ?? 0) <= 1) return 'This is the last super admin of the company and cannot be demoted';
  }
  return null;
}

/** Shared consequence lines for a change of role / department / primary team. */
function changeLines(u: UserRow, p: AssignmentPlan): string[] {
  const out: string[] = [];
  const who = firstName(u);
  if (p.role.from !== p.role.to) out.push(`${who}'s role changes from ${label(p.role.from)} to ${label(p.role.to)}.`);
  if (p.role.from === 'super_admin') out.push(`${who} loses super admin access: other departments, admin settings and API keys.`);
  return out;
}

/* ------------------------------------------------------------------------------------------ */

export async function planAssignManager(companyId: string, actorId: string, departmentId: string, userId: unknown): Promise<PlanResult> {
  const dept = await queryOne<any>('SELECT id, name, is_active FROM departments WHERE id = ? AND company_id = ?', [departmentId, companyId]);
  if (!dept) return fail(404, 'Department not found');
  if (!dept.is_active) return fail(400, 'That department is inactive');
  const u = await loadAssignee(companyId, userId);
  if ('ok' in u) return u;
  if (u.role === 'qa_manager' && u.department_id === dept.id) return fail(400, `${nameOf(u)} is already a QA manager of ${dept.name}`);
  const roleErr = await roleChangeError(companyId, actorId, u, 'qa_manager');
  if (roleErr) return fail(400, roleErr);

  const keepTeam = !!u.primary_team_id && u.team_department_id === dept.id;
  const led = await query<any[]>('SELECT id, name FROM teams WHERE company_id = ? AND lead_id = ? ORDER BY name', [companyId, u.id]);

  const plan: AssignmentPlan = {
    kind: 'assign_manager',
    user: summary(u),
    role: { from: u.role, to: 'qa_manager' },
    department: { from: u.department_id, to: dept.id, fromName: u.department_name, toName: dept.name },
    primaryTeam: { from: u.primary_team_id, to: keepTeam ? u.primary_team_id : null, fromName: u.team_name, toName: keepTeam ? u.team_name : null },
    clearedLeadOf: led.map((t: any) => ({ id: t.id, name: t.name })),
    previousLead: null,
    consequences: [],
  };
  const who = firstName(u);
  const c = changeLines(u, plan);
  const scope = 'every team\'s analytics there, and can manage its teams and users';
  if (u.role === 'qa_manager' && u.department_id && u.department_id !== dept.id) {
    c.push(`${who} will lose access to ${u.department_name ?? 'their current department'} and manage ${dept.name}: they will see ${scope}.`);
  } else if (u.department_id !== dept.id) {
    c.push(`${who} moves from ${u.department_name ?? 'no department'} to ${dept.name} and will manage it: they will see ${scope}.`);
  } else {
    c.push(`${who} will manage ${dept.name}: they will see ${scope}.`);
  }
  if (u.primary_team_id && !keepTeam) c.push(`${who} leaves ${u.team_name ?? 'their current team'} (QA managers do not need a team; their scope is the department).`);
  if (keepTeam) c.push(`${who} stays a member of ${u.team_name}.`);
  if (led.length) c.push(`${list(led.map((t: any) => t.name))} will no longer have ${who} as team lead.`);
  plan.consequences = c;
  return { ok: true, plan, target: { id: u.id, departmentId: dept.id } };
}

export async function applyAssignManager(companyId: string, plan: AssignmentPlan): Promise<void> {
  await transaction(async (client) => {
    const exec = execOn(client);
    await exec(
      `UPDATE users SET role = 'qa_manager', department_id = ?, primary_team_id = ?, updated_at = NOW()
        WHERE id = ? AND company_id = ?`,
      [plan.department.to, plan.primaryTeam.to, plan.user.id, companyId]
    );
    await exec('UPDATE teams SET lead_id = NULL, updated_at = NOW() WHERE company_id = ? AND lead_id = ?', [companyId, plan.user.id]);
    await syncPrimaryTeamMembership(plan.user.id, plan.primaryTeam.from, plan.primaryTeam.to, 'qa_manager', client);
  });
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
  if (u.role !== 'qa_manager' || u.department_id !== dept.id) return fail(400, `${nameOf(u)} is not a QA manager of ${dept.name}`);
  const roleErr = await roleChangeError(companyId, actorId, u, role);
  if (roleErr) return fail(400, roleErr);

  let team: { id: string; name: string } | null = null;
  if (typeof teamId === 'string' && teamId) {
    team = await queryOne<any>('SELECT id, name FROM teams WHERE id = ? AND company_id = ? AND department_id = ? AND is_active = TRUE', [teamId, companyId, dept.id]);
    if (!team) return fail(400, `Choose an active team in ${dept.name}`);
  } else if (u.primary_team_id && u.team_department_id === dept.id) {
    team = { id: u.primary_team_id, name: u.team_name ?? '' };
  }
  if (!team && role === 'qa_engineer') return fail(400, `A QA engineer needs a team: choose a team in ${dept.name}, or make ${firstName(u)} a viewer`);

  const others = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM users WHERE company_id = ? AND department_id = ? AND role = 'qa_manager' AND is_active = TRUE AND id <> ?`,
    [companyId, dept.id, u.id]
  );
  const plan: AssignmentPlan = {
    kind: 'remove_manager',
    user: summary(u),
    role: { from: 'qa_manager', to: role },
    department: { from: dept.id, to: dept.id, fromName: dept.name, toName: dept.name },
    primaryTeam: { from: u.primary_team_id, to: team?.id ?? null, fromName: u.team_name, toName: team?.name ?? null },
    clearedLeadOf: [],
    previousLead: null,
    consequences: [],
  };
  const who = firstName(u);
  const c = changeLines(u, plan);
  c.push(`${who} stays in ${dept.name} but will no longer manage it.`);
  c.push(team
    ? `${who} will see only ${team.name}${role === 'viewer' ? ', read-only' : ''}${team.id !== u.primary_team_id ? ` (their new primary team)` : ''}.`
    : `${who} will have no team, so no team analytics, until a team is assigned on the Users page.`);
  if ((others?.n ?? 0) === 0) c.push(`${dept.name} will have no QA manager; only super admins will manage it.`);
  plan.consequences = c;
  return { ok: true, plan, target: { id: u.id, departmentId: dept.id } };
}

export async function applyRemoveManager(companyId: string, plan: AssignmentPlan): Promise<void> {
  await transaction(async (client) => {
    await execOn(client)(
      `UPDATE users SET role = ?, primary_team_id = ?, updated_at = NOW() WHERE id = ? AND company_id = ? AND role = 'qa_manager'`,
      [plan.role.to, plan.primaryTeam.to, plan.user.id, companyId]
    );
    await syncPrimaryTeamMembership(plan.user.id, plan.primaryTeam.from, plan.primaryTeam.to, plan.role.to, client);
  });
}

/* ------------------------------------------------------------------------------------------ */

export async function planAssignLead(companyId: string, actorId: string, teamId: string, userId: unknown): Promise<PlanResult> {
  const team = await queryOne<any>(
    `SELECT t.id, t.name, t.department_id, t.is_active, t.lead_id, d.name AS department_name
       FROM teams t LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.id = ? AND t.company_id = ?`,
    [teamId, companyId]
  );
  if (!team) return fail(404, 'Team not found');
  if (!team.is_active) return fail(400, 'That team is inactive');
  if (!team.department_id) return fail(400, 'The team has no department');
  const u = await loadAssignee(companyId, userId);
  if ('ok' in u) return u;
  if (team.lead_id === u.id && u.role === 'team_lead' && u.primary_team_id === team.id) return fail(400, `${nameOf(u)} already leads ${team.name}`);
  const roleErr = await roleChangeError(companyId, actorId, u, 'team_lead');
  if (roleErr) return fail(400, roleErr);

  // The lead shown today: teams.lead_id, else the earliest active team_lead on the team (teamLeadNameSql).
  let prev: UserRow | null = team.lead_id ? await loadUser(companyId, team.lead_id) : null;
  if (!prev) {
    const row = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE company_id = ? AND primary_team_id = ? AND role = 'team_lead' AND is_active = TRUE
        ORDER BY created_at ASC NULLS LAST LIMIT 1`,
      [companyId, team.id]
    );
    prev = row ? await loadUser(companyId, row.id) : null;
  }
  if (prev?.id === u.id) prev = null;

  let previousLead: AssignmentPlan['previousLead'] = null;
  if (prev) {
    const other = await query<any[]>('SELECT name FROM teams WHERE company_id = ? AND lead_id = ? AND id <> ? ORDER BY name', [companyId, prev.id, team.id]);
    const alsoLeads = other.map((t: any) => t.name as string);
    const newRole = prev.role === 'team_lead' && alsoLeads.length === 0 ? 'qa_engineer' : prev.role;
    previousLead = { ...summary(prev), newRole, alsoLeads };
  }
  const alsoLeads = (await query<any[]>('SELECT name FROM teams WHERE company_id = ? AND lead_id = ? AND id <> ? ORDER BY name', [companyId, u.id, team.id]))
    .map((t: any) => t.name as string);

  const plan: AssignmentPlan = {
    kind: 'assign_lead',
    user: summary(u),
    role: { from: u.role, to: 'team_lead' },
    department: { from: u.department_id, to: team.department_id, fromName: u.department_name, toName: team.department_name },
    primaryTeam: { from: u.primary_team_id, to: team.id, fromName: u.team_name, toName: team.name },
    clearedLeadOf: [],
    previousLead,
    consequences: [],
  };
  const who = firstName(u);
  const c = changeLines(u, plan);
  c.push(`${who} becomes team lead of ${team.name}${u.primary_team_id === team.id ? '' : ` and ${team.name} becomes their primary team`}.`);
  if (u.role === 'qa_manager') c.push(`${who} stops managing ${u.department_name ?? 'their department'} and will see only ${team.name}.`);
  if (u.department_id !== team.department_id) c.push(`${who} moves from ${u.department_name ?? 'no department'} to ${team.department_name}.`);
  if (u.primary_team_id && u.primary_team_id !== team.id && !alsoLeads.includes(u.team_name ?? '')) c.push(`${who} leaves ${u.team_name ?? 'their current team'}.`);
  if (alsoLeads.length) c.push(`${who} keeps leading ${list(alsoLeads)} as well.`);
  if (previousLead && prev) {
    const p = firstName(prev);
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

export async function applyAssignLead(companyId: string, plan: AssignmentPlan): Promise<void> {
  const teamId = plan.primaryTeam.to as string;
  await transaction(async (client) => {
    const exec = execOn(client);
    const prev = plan.previousLead;
    if (prev) {
      if (prev.newRole !== prev.role) {
        await exec(`UPDATE users SET role = ?, updated_at = NOW() WHERE id = ? AND company_id = ?`, [prev.newRole, prev.id, companyId]);
      }
      await exec(`UPDATE team_members SET role = 'member' WHERE user_id = ? AND team_id = ?`, [prev.id, teamId]);
    }
    await exec(
      `UPDATE users SET role = 'team_lead', department_id = ?, primary_team_id = ?, updated_at = NOW() WHERE id = ? AND company_id = ?`,
      [plan.department.to, teamId, plan.user.id, companyId]
    );
    await exec('UPDATE teams SET lead_id = ?, updated_at = NOW() WHERE id = ? AND company_id = ?', [plan.user.id, teamId, companyId]);
    await syncPrimaryTeamMembership(plan.user.id, plan.primaryTeam.from, teamId, 'team_lead', client);
    // A lead is a member of every team they lead (they may still lead their previous team).
    await exec(
      `INSERT INTO team_members (user_id, team_id, role)
       SELECT ?, t.id, 'lead' FROM teams t WHERE t.company_id = ? AND t.lead_id = ?
       ON CONFLICT (user_id, team_id) DO UPDATE SET role = 'lead'`,
      [plan.user.id, companyId, plan.user.id]
    );
  });
}
