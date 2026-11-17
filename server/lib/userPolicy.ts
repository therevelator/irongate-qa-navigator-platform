/**
 * User-management rules: the ONE definition used by the server (/api/admin/users routes)
 * and by the Users / Teams pages to decide which actions to offer. Pure functions, no DB.
 *
 * Managing another user (activate/deactivate, delete = deactivate, reset password,
 * developer-insights toggle):
 *   super_admin  any user in the company
 *   qa_manager   users in their department whose role is below qa_manager
 *   team_lead    users on their primary team whose role is below team_lead
 *   others       nobody
 * Editing another user's profile, role, department or team: super_admin and qa_manager,
 *   for users they can manage. A new role must be one the actor may assign.
 * Editing yourself: name and email only (role, department and team stay as they are).
 * Resetting a password: yourself, or a user you can manage.
 * Creating users: the roles in ROLE_HIERARCHY; qa_manager only in their department;
 *   team_lead only on their own team.
 */

export const ROLE_HIERARCHY: Record<string, string[]> = {
  super_admin: ['qa_manager', 'team_lead', 'qa_engineer', 'viewer'],
  qa_manager: ['team_lead', 'qa_engineer', 'viewer'],
  team_lead: ['qa_engineer', 'viewer'],
  qa_engineer: [],
  viewer: [],
};

export interface PolicyActor {
  id: string;
  role: string;
  departmentId?: string | null;
  primaryTeamId?: string | null;
}

export interface PolicyTarget {
  id: string;
  role: string;
  department_id?: string | null;
  primary_team_id?: string | null;
}

/** May the actor give a user this role (on create, or when changing a role)? */
export function canAssignRole(actorRole: string, targetRole: string): boolean {
  return (ROLE_HIERARCHY[actorRole] || []).includes(targetRole);
}

/** Activate/deactivate, delete (deactivate), reset password, developer-insights toggle. */
export function canManageUser(actor: PolicyActor, target: PolicyTarget): boolean {
  if (actor.id === target.id) return false;
  if (actor.role === 'super_admin') return true;
  if (actor.role === 'qa_manager') {
    return !!actor.departmentId && target.department_id === actor.departmentId && canAssignRole('qa_manager', target.role);
  }
  if (actor.role === 'team_lead') {
    return !!actor.primaryTeamId && target.primary_team_id === actor.primaryTeamId && canAssignRole('team_lead', target.role);
  }
  return false;
}

/** May the actor open the edit form for this user? (Self: name and email only.) */
export function canEditUser(actor: PolicyActor, target: PolicyTarget): boolean {
  if (actor.id === target.id) return true;
  return (actor.role === 'super_admin' || actor.role === 'qa_manager') && canManageUser(actor, target);
}

/** May the actor change this user's role, department and team (not just name/email)? */
export function canEditAssignment(actor: PolicyActor, target: PolicyTarget): boolean {
  return actor.id !== target.id && canEditUser(actor, target);
}

export function canResetPassword(actor: PolicyActor, target: PolicyTarget): boolean {
  return actor.id === target.id || canManageUser(actor, target);
}

/** Delete is a soft delete (deactivation) offered to super_admin and qa_manager. */
export function canDeleteUser(actor: PolicyActor, target: PolicyTarget): boolean {
  return (actor.role === 'super_admin' || actor.role === 'qa_manager') && canManageUser(actor, target);
}

export function canCreateUsers(actorRole: string): boolean {
  return (ROLE_HIERARCHY[actorRole] || []).length > 0;
}

/** Roles that may be created without a primary team (they are not measured as a team member). */
export const TEAM_OPTIONAL_ROLES = ['viewer', 'qa_manager'];

/** Team-management rules (create / edit / delete): super_admin any team, qa_manager own department. */
export function canManageTeam(actor: PolicyActor, team: { department_id?: string | null }): boolean {
  if (actor.role === 'super_admin') return true;
  if (actor.role === 'qa_manager') return !!actor.departmentId && team.department_id === actor.departmentId;
  return false;
}

/** Team data writes (AI toggle, metrics): same rule as assertTeamWrite — plus team_lead on their own team. */
export function canWriteTeamData(actor: PolicyActor, team: { id: string; department_id?: string | null }): boolean {
  return canManageTeam(actor, team) || (actor.role === 'team_lead' && !!actor.primaryTeamId && actor.primaryTeamId === team.id);
}
