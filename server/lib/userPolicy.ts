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

/* ------------------------------------------------------------------------------------------
 * Analytics scope: the ONE definition of which team's analytics a user may open, used by
 * the server (server/middleware/access.ts assertTeamAnalytics, /api/analytics/*, the
 * developer endpoints in teams.ts / metrics.ts) and by the Analytics scope bar in the UI
 * (src/contexts/AnalyticsScopeContext.tsx). Pure functions; the company (tenant) boundary is
 * checked separately by the server (a team outside the caller's company is never in scope).
 *
 *   super_admin  any department and team in their company
 *   qa_manager   their own department and every team in it
 *   team_lead    their own (primary) team
 *   qa_engineer  their own (primary) team
 *   viewer       their own (primary) team
 *
 * Every analytics module shows exactly one team. Individual developer rows (developer
 * metrics, DDPS snapshots, developer recommendations, the team members' metrics):
 *   super_admin / qa_manager / team_lead  every developer of an in-scope team who has not
 *                                         opted out (developer_insights_enabled), plus themselves
 *   qa_engineer / viewer                  only their own row
 * Team aggregates are available to everyone for an in-scope team.
 * ---------------------------------------------------------------------------------------- */

export interface ScopeTeam {
  id: string;
  department_id?: string | null;
}

/** Every role may use the team-level Analytics modules (for the teams in their scope). */
export const ANALYTICS_ROLES = ['super_admin', 'qa_manager', 'team_lead', 'qa_engineer', 'viewer'];

/** Roles that may see other developers' individual metrics (within their scope). */
export const DEVELOPER_INSIGHT_ROLES = ['super_admin', 'qa_manager', 'team_lead'];

/** How far the user's analytics scope reaches; decides which selectors are editable. */
export type AnalyticsScopeLevel = 'company' | 'department' | 'team' | 'none';

export function analyticsScopeLevel(role?: string | null): AnalyticsScopeLevel {
  if (role === 'super_admin') return 'company';
  if (role === 'qa_manager') return 'department';
  if (role === 'team_lead' || role === 'qa_engineer' || role === 'viewer') return 'team';
  return 'none';
}

/** May the actor open analytics for this team (team in the actor's company)? */
export function canViewTeamAnalytics(actor: PolicyActor, team: ScopeTeam): boolean {
  switch (analyticsScopeLevel(actor.role)) {
    case 'company':
      return true;
    case 'department':
      return !!actor.departmentId && team.department_id === actor.departmentId;
    case 'team':
      return !!actor.primaryTeamId && actor.primaryTeamId === team.id;
    default:
      return false;
  }
}

/** The teams (of the actor's company) whose analytics the actor may open. */
export function analyticsTeamsInScope<T extends ScopeTeam>(actor: PolicyActor, teams: T[]): T[] {
  return teams.filter((t) => canViewTeamAnalytics(actor, t));
}

/** Default team for the modules: the actor's primary team when in scope, else the first in scope. */
export function defaultAnalyticsTeamId(actor: PolicyActor, teamsInScope: ScopeTeam[]): string | null {
  if (actor.primaryTeamId && teamsInScope.some((t) => t.id === actor.primaryTeamId)) return actor.primaryTeamId;
  return teamsInScope[0]?.id ?? null;
}

/** May the actor see other developers' individual metrics for this team? */
export function canViewIndividualDevelopers(actor: PolicyActor, team: ScopeTeam): boolean {
  return DEVELOPER_INSIGHT_ROLES.includes(actor.role) && canViewTeamAnalytics(actor, team);
}

/**
 * May the actor see this developer's individual row for this team? Their own row always
 * (when the team is in scope); someone else's only with canViewIndividualDevelopers and
 * when that person has not opted out of developer insights.
 */
export function canViewDeveloperRow(
  actor: PolicyActor,
  team: ScopeTeam,
  developer: { id: string; developer_insights_enabled?: boolean | null },
): boolean {
  if (!canViewTeamAnalytics(actor, team)) return false;
  if (developer.id === actor.id) return true;
  return canViewIndividualDevelopers(actor, team) && developer.developer_insights_enabled !== false;
}
