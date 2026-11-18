/**
 * Access rules: the ONE definition used by the server (every route, through
 * server/middleware/access.ts and server/lib/assignments.ts) and by the UI (which pages and
 * buttons to offer). Pure functions, no DB.
 *
 * Who may do what comes from the user's ROLE ASSIGNMENTS (table role_assignments, loaded per
 * request by server/middleware/auth.ts through server/lib/assignments.ts). A grant is a role on
 * a scope:
 *   super_admin  on the company
 *   qa_manager   on a department     (a user may manage several departments)
 *   team_lead    on a team           (a user may lead several teams; one lead per team)
 *   qa_engineer  on a team           (member)
 *   viewer       on a team           (read-only member)
 * users.role / department_id / primary_team_id are display columns (highest role, primary
 * department / team), kept in sync by the server; access never depends on them alone.
 *
 * Analytics scope (which team's analytics the actor may open): the union of the grants:
 *   company grant   every team of the company
 *   department      every team of that department
 *   team            that team
 * Individual developer rows: super_admin / qa_manager / team_lead grants covering the team
 * show every developer who has not opted out; a member grant only shows the actor's own row.
 *
 * Managing another user (activate/deactivate, delete = deactivate, reset password,
 * developer-insights toggle):
 *   super_admin  any user in the company
 *   qa_manager   users of a department they manage whose highest role is below qa_manager
 *   team_lead    users of a team they lead whose highest role is below team_lead
 * Editing another user's profile and assignments: super_admin and qa_manager (for users they
 * manage that way). Editing yourself: name and email only.
 *
 * Granting / revoking an assignment (Users page chips, invitations):
 *   super_admin  any grant in the company
 *   qa_manager   team_lead / qa_engineer / viewer on teams of a department they manage
 *   team_lead    qa_engineer / viewer on a team they lead
 *   never your own assignments.
 */

export type Role = 'super_admin' | 'qa_manager' | 'team_lead' | 'qa_engineer' | 'viewer';
export type ScopeType = 'company' | 'department' | 'team';

export const ROLES: Role[] = ['super_admin', 'qa_manager', 'team_lead', 'qa_engineer', 'viewer'];

/** The scope type each role is assigned on. */
export const ROLE_SCOPE: Record<Role, ScopeType> = {
  super_admin: 'company',
  qa_manager: 'department',
  team_lead: 'team',
  qa_engineer: 'team',
  viewer: 'team',
};

/** Higher = more access; used for the "highest role" display column. */
export const ROLE_RANK: Record<string, number> = { super_admin: 5, qa_manager: 4, team_lead: 3, qa_engineer: 2, viewer: 1 };

export const ROLE_HIERARCHY: Record<string, string[]> = {
  super_admin: ['qa_manager', 'team_lead', 'qa_engineer', 'viewer'],
  qa_manager: ['team_lead', 'qa_engineer', 'viewer'],
  team_lead: ['qa_engineer', 'viewer'],
  qa_engineer: [],
  viewer: [],
};

/** One active role assignment. scopeId is the company, department or team id. */
export interface Grant {
  role: Role | string;
  scopeType: ScopeType | string;
  scopeId: string;
}

export interface PolicyActor {
  id: string;
  /** Highest role (display column). */
  role: string;
  departmentId?: string | null;
  primaryTeamId?: string | null;
  /**
   * Active role assignments. The server always sets them. When absent (an actor built from
   * the display columns only), they are derived from role / departmentId / primaryTeamId.
   */
  grants?: Grant[];
}

export interface PolicyTarget {
  id: string;
  role: string;
  department_id?: string | null;
  primary_team_id?: string | null;
  /** Departments the target belongs to (department grants and their teams' departments). */
  department_ids?: string[] | null;
  /** Teams the target is assigned to. */
  team_ids?: string[] | null;
}

export interface ScopeTeam {
  id: string;
  department_id?: string | null;
}

/** Grants of an actor built from display columns only (one assignment, as before assignments existed). */
export function grantsFromDisplay(role: string, departmentId?: string | null, primaryTeamId?: string | null): Grant[] {
  if (role === 'super_admin') return [{ role, scopeType: 'company', scopeId: '*' }];
  if (role === 'qa_manager') return departmentId ? [{ role, scopeType: 'department', scopeId: departmentId }] : [];
  if (role === 'team_lead' || role === 'qa_engineer' || role === 'viewer') {
    return primaryTeamId ? [{ role, scopeType: 'team', scopeId: primaryTeamId }] : [];
  }
  return [];
}

export function grantsOf(actor: PolicyActor): Grant[] {
  return actor.grants ?? grantsFromDisplay(actor.role, actor.departmentId, actor.primaryTeamId);
}

const hasCompany = (actor: PolicyActor) => grantsOf(actor).some((g) => g.scopeType === 'company' && g.role === 'super_admin');

/** Departments the actor manages (qa_manager grants). */
export function managedDepartmentIds(actor: PolicyActor): string[] {
  return grantsOf(actor).filter((g) => g.role === 'qa_manager' && g.scopeType === 'department').map((g) => g.scopeId);
}

/** Teams the actor leads (team_lead grants). */
export function ledTeamIds(actor: PolicyActor): string[] {
  return grantsOf(actor).filter((g) => g.role === 'team_lead' && g.scopeType === 'team').map((g) => g.scopeId);
}

/** Every team the actor is assigned to (any team-scoped role). */
export function assignedTeamIds(actor: PolicyActor): string[] {
  return grantsOf(actor).filter((g) => g.scopeType === 'team').map((g) => g.scopeId);
}

/** The roles the actor holds over this team (from company, department and team grants). */
export function rolesOnTeam(actor: PolicyActor, team: ScopeTeam): string[] {
  const out: string[] = [];
  for (const g of grantsOf(actor)) {
    if (g.scopeType === 'company') out.push(g.role);
    else if (g.scopeType === 'department' && !!team.department_id && g.scopeId === team.department_id) out.push(g.role);
    else if (g.scopeType === 'team' && g.scopeId === team.id) out.push(g.role);
  }
  return out;
}

/** Highest role among the actor's grants (falls back to the display role). */
export function highestRole(actor: PolicyActor): string {
  const gs = grantsOf(actor);
  if (!gs.length) return actor.role;
  return gs.reduce((best, g) => ((ROLE_RANK[g.role] ?? 0) > (ROLE_RANK[best] ?? 0) ? g.role : best), gs[0].role);
}

/** Does the actor hold this role anywhere? */
export function holdsRole(actor: PolicyActor, role: string): boolean {
  return grantsOf(actor).some((g) => g.role === role);
}

/** May the actor give a user this role (role hierarchy on the actor's highest role)? */
export function canAssignRole(actorRole: string, targetRole: string): boolean {
  return (ROLE_HIERARCHY[actorRole] || []).includes(targetRole);
}

/* ------------------------------------------------------------------------------------------
 * Users
 * ---------------------------------------------------------------------------------------- */

const targetDepartments = (t: PolicyTarget) => t.department_ids ?? (t.department_id ? [t.department_id] : []);
const targetTeams = (t: PolicyTarget) => t.team_ids ?? (t.primary_team_id ? [t.primary_team_id] : []);

/** Through which role (if any) may the actor manage this user? */
export function manageUserVia(actor: PolicyActor, target: PolicyTarget): 'super_admin' | 'qa_manager' | 'team_lead' | null {
  if (actor.id === target.id) return null;
  if (hasCompany(actor)) return 'super_admin';
  const depts = managedDepartmentIds(actor);
  if (depts.length && canAssignRole('qa_manager', target.role) && targetDepartments(target).some((d) => depts.includes(d))) return 'qa_manager';
  const led = ledTeamIds(actor);
  if (led.length && canAssignRole('team_lead', target.role) && targetTeams(target).some((t) => led.includes(t))) return 'team_lead';
  return null;
}

/** Activate/deactivate, delete (deactivate), reset password, developer-insights toggle. */
export function canManageUser(actor: PolicyActor, target: PolicyTarget): boolean {
  return manageUserVia(actor, target) !== null;
}

/** May the actor open the edit form for this user? (Self: name and email only.) */
export function canEditUser(actor: PolicyActor, target: PolicyTarget): boolean {
  if (actor.id === target.id) return true;
  const via = manageUserVia(actor, target);
  return via === 'super_admin' || via === 'qa_manager';
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
  return canEditAssignment(actor, target);
}

export function canCreateUsers(actorRole: string): boolean {
  return (ROLE_HIERARCHY[actorRole] || []).length > 0;
}

/** Roles that may be created without a primary team (they are not measured as a team member). */
export const TEAM_OPTIONAL_ROLES = ['viewer', 'qa_manager'];

/**
 * May the actor grant (or revoke) this assignment? `team` is the team of a team-scoped grant
 * (needed for its department). Never your own assignments (checked by the caller with the
 * target user id).
 */
export function canGrant(actor: PolicyActor, grant: Grant, team?: ScopeTeam | null): boolean {
  if (ROLE_SCOPE[grant.role as Role] !== grant.scopeType) return false;
  if (hasCompany(actor)) return true;
  if (grant.scopeType !== 'team' || !team || team.id !== grant.scopeId) return false;
  if (['team_lead', 'qa_engineer', 'viewer'].includes(grant.role) && !!team.department_id && managedDepartmentIds(actor).includes(team.department_id)) return true;
  if (['qa_engineer', 'viewer'].includes(grant.role) && ledTeamIds(actor).includes(team.id)) return true;
  return false;
}

/** May the actor send invitations at all (any grant they could give)? */
export function canInvite(actor: PolicyActor): boolean {
  return hasCompany(actor) || managedDepartmentIds(actor).length > 0 || ledTeamIds(actor).length > 0;
}

/* ------------------------------------------------------------------------------------------
 * Teams and departments
 * ---------------------------------------------------------------------------------------- */

/** Team-management rules (create / edit / delete): super_admin any team, qa_manager their departments. */
export function canManageTeam(actor: PolicyActor, team: { department_id?: string | null }): boolean {
  if (hasCompany(actor)) return true;
  return !!team.department_id && managedDepartmentIds(actor).includes(team.department_id);
}

/** May the actor create / manage teams in this department? */
export function canManageDepartment(actor: PolicyActor, departmentId: string | null | undefined): boolean {
  return canManageTeam(actor, { department_id: departmentId ?? null });
}

/** Team data writes (AI toggle, metrics): canManageTeam, plus team_lead on a team they lead. */
export function canWriteTeamData(actor: PolicyActor, team: { id: string; department_id?: string | null }): boolean {
  return canManageTeam(actor, team) || ledTeamIds(actor).includes(team.id);
}

/** Company-level administration (departments, API keys, moving teams, assigning managers and leads). */
export function isCompanyAdmin(actor: PolicyActor): boolean {
  return hasCompany(actor);
}

/** Company-level config writes (Parameters, metric intervals, pipeline config): super_admin or a QA manager. */
export function canManageCompanyConfig(actor: PolicyActor): boolean {
  return hasCompany(actor) || managedDepartmentIds(actor).length > 0;
}

/**
 * Per-team detail reads (team metrics history, velocity, team metric bundles): super_admin and
 * QA managers read any team of the company (the dashboards are company-wide by design); others
 * the teams they are assigned to.
 */
export function canReadTeamDetail(actor: PolicyActor, team: ScopeTeam): boolean {
  if (hasCompany(actor) || managedDepartmentIds(actor).length > 0) return true;
  return assignedTeamIds(actor).includes(team.id);
}

/**
 * Team AI insights (rule-based / LLM recommendations): super_admin and QA managers for any team
 * of the company (as the dashboards), team leads for the teams they lead.
 */
export function canRequestTeamInsights(actor: PolicyActor, team: { id: string }): boolean {
  return hasCompany(actor) || managedDepartmentIds(actor).length > 0 || ledTeamIds(actor).includes(team.id);
}

/* ------------------------------------------------------------------------------------------
 * Analytics scope: which team's analytics a user may open. Used by the server
 * (assertTeamAnalytics, /api/analytics/*, the developer endpoints in teams.ts / metrics.ts) and
 * by the Analytics scope bar in the UI. The company (tenant) boundary is checked separately by
 * the server (a team outside the caller's company is never in scope).
 * ---------------------------------------------------------------------------------------- */

/** Every role may use the team-level Analytics modules (for the teams in their scope). */
export const ANALYTICS_ROLES = ['super_admin', 'qa_manager', 'team_lead', 'qa_engineer', 'viewer'];

/** Roles that may see other developers' individual metrics (within their scope). */
export const DEVELOPER_INSIGHT_ROLES = ['super_admin', 'qa_manager', 'team_lead'];

/** How far the user's analytics scope reaches; decides which selectors are editable. */
export type AnalyticsScopeLevel = 'company' | 'department' | 'team' | 'none';

/** Level from a role alone (display role). Prefer analyticsScopeLevelOf(actor). */
export function analyticsScopeLevel(role?: string | null): AnalyticsScopeLevel {
  if (role === 'super_admin') return 'company';
  if (role === 'qa_manager') return 'department';
  if (role === 'team_lead' || role === 'qa_engineer' || role === 'viewer') return 'team';
  return 'none';
}

/** Level from the actor's grants: the widest scope they hold. */
export function analyticsScopeLevelOf(actor: PolicyActor): AnalyticsScopeLevel {
  const gs = grantsOf(actor);
  if (gs.some((g) => g.scopeType === 'company')) return 'company';
  if (gs.some((g) => g.scopeType === 'department')) return 'department';
  if (gs.some((g) => g.scopeType === 'team')) return 'team';
  return 'none';
}

/** May the actor open analytics for this team (team in the actor's company)? */
export function canViewTeamAnalytics(actor: PolicyActor, team: ScopeTeam): boolean {
  return rolesOnTeam(actor, team).length > 0;
}

/** The teams (of the actor's company) whose analytics the actor may open. */
export function analyticsTeamsInScope<T extends ScopeTeam>(actor: PolicyActor, teams: T[]): T[] {
  return teams.filter((t) => canViewTeamAnalytics(actor, t));
}

/** Default team for the modules: the actor's primary team when in scope, else a led team, else the first in scope. */
export function defaultAnalyticsTeamId(actor: PolicyActor, teamsInScope: ScopeTeam[]): string | null {
  if (actor.primaryTeamId && teamsInScope.some((t) => t.id === actor.primaryTeamId)) return actor.primaryTeamId;
  const led = ledTeamIds(actor).find((id) => teamsInScope.some((t) => t.id === id));
  if (led) return led;
  return teamsInScope[0]?.id ?? null;
}

/**
 * May the actor see the people of a team (member names, emails, roles on GET /api/teams/:id)?
 * The team's analytics scope: super_admin any team of the company, a QA manager the teams of the
 * departments they manage, anyone assigned to the team. Team KPIs stay company-visible.
 */
export function canViewTeamMembers(actor: PolicyActor, team: ScopeTeam): boolean {
  return canViewTeamAnalytics(actor, team);
}

/** May the actor see other developers' individual metrics for this team? */
export function canViewIndividualDevelopers(actor: PolicyActor, team: ScopeTeam): boolean {
  return rolesOnTeam(actor, team).some((r) => DEVELOPER_INSIGHT_ROLES.includes(r));
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

/* ------------------------------------------------------------------------------------------
 * Change history (audit log)
 * ---------------------------------------------------------------------------------------- */

/** Who may open the Activity page: super_admin (whole company) and QA managers (their departments). */
export function canViewActivity(actor: PolicyActor): boolean {
  return hasCompany(actor) || managedDepartmentIds(actor).length > 0;
}

/** May the actor see this audit entry? super_admin: all; QA manager: entries of a department they manage. */
export function canViewAuditEntry(actor: PolicyActor, entry: { department_ids?: string[] | null }): boolean {
  if (hasCompany(actor)) return true;
  const mine = managedDepartmentIds(actor);
  return (entry.department_ids ?? []).some((d) => mine.includes(d));
}

/* ------------------------------------------------------------------------------------------
 * Ingestion log and KPI targets
 * ---------------------------------------------------------------------------------------- */

/** Who may open the Ingestion log: super_admin (whole company) and QA managers (entries of their departments). */
export function canViewIngestionLog(actor: PolicyActor): boolean {
  return hasCompany(actor) || managedDepartmentIds(actor).length > 0;
}

/** May the actor see this ingestion log entry? super_admin: all; QA manager: entries touching a team of their departments. */
export function canViewIngestionEntry(actor: PolicyActor, entry: { department_ids?: string[] | null }): boolean {
  if (hasCompany(actor)) return true;
  const mine = managedDepartmentIds(actor);
  return (entry.department_ids ?? []).some((d) => mine.includes(d));
}

/**
 * May the actor set KPI targets at this scope? Company: super_admin. Department: super_admin or
 * a QA manager of it. Team: super_admin or the QA manager of the team's department (as other
 * company configuration; team leads do not set their own targets).
 */
export function canSetTargets(actor: PolicyActor, scope: { type: 'company' | 'department' | 'team'; departmentId?: string | null }): boolean {
  if (hasCompany(actor)) return true;
  if (scope.type === 'company') return false;
  return !!scope.departmentId && managedDepartmentIds(actor).includes(scope.departmentId);
}

/* ------------------------------------------------------------------------------------------
 * Team comparison, saved views, onboarding (Phase 3B)
 * ---------------------------------------------------------------------------------------- */

/** May the actor compare these teams side by side? Every team must be in their analytics scope. */
export function canCompareTeams(actor: PolicyActor, teams: ScopeTeam[]): boolean {
  return teams.length > 0 && teams.every((t) => canViewTeamAnalytics(actor, t));
}

/* ------------------------------------------------------------------------------------------
 * Revenue impact roll-up
 * ---------------------------------------------------------------------------------------- */

/**
 * May the actor see the revenue impact roll-up (sum of team figures)? Super admins (company) and
 * QA managers (their departments); the teams summed are those of analyticsTeamsInScope.
 */
export function canViewRevenueRollup(actor: PolicyActor): boolean {
  const level = analyticsScopeLevelOf(actor);
  return level === 'company' || level === 'department';
}

export interface SavedViewRef {
  owner_id: string;
  shared: boolean;
}

/** Saved views: your own, and the ones shared with the company (the server checks the company). */
export function canSeeSavedView(actor: PolicyActor, view: SavedViewRef): boolean {
  return view.owner_id === actor.id || view.shared;
}

/** Rename or overwrite a saved view: its owner only (a shared view is read-only for everyone else). */
export function canEditSavedView(actor: PolicyActor, view: SavedViewRef): boolean {
  return view.owner_id === actor.id;
}

/** Delete: the owner, or a company administrator for a view shared with the company. */
export function canDeleteSavedView(actor: PolicyActor, view: SavedViewRef): boolean {
  return view.owner_id === actor.id || (view.shared && hasCompany(actor));
}

/** Share a view with the company: a company administrator, for their own views. */
export function canShareSavedView(actor: PolicyActor, view: SavedViewRef): boolean {
  return hasCompany(actor) && view.owner_id === actor.id;
}

/** Stop sharing a view: a company administrator (any shared view of the company). */
export function canUnshareSavedView(actor: PolicyActor, view: SavedViewRef): boolean {
  return hasCompany(actor) && view.shared;
}

/** The onboarding checklist of a new organisation: company administrators. */
export function canViewOnboarding(actor: PolicyActor): boolean {
  return hasCompany(actor);
}

/* ------------------------------------------------------------------------------------------
 * Wellbeing pulse survey (server/lib/pulse.ts, routes /api/pulse)
 * ---------------------------------------------------------------------------------------- */

/** May the actor answer the team's pulse survey? Anyone assigned to the team (any team-scoped role). */
export function canTakePulseSurvey(actor: PolicyActor, team: ScopeTeam): boolean {
  return assignedTeamIds(actor).includes(team.id);
}

/** May the actor see the team's survey results (aggregates only, never single answers)? The team's analytics scope. */
export function canViewPulseResults(actor: PolicyActor, team: ScopeTeam): boolean {
  return canViewTeamAnalytics(actor, team);
}

/** May the actor read the free-text comments (shown with the aggregate only)? Leads, managers and admins of the team. */
export function canViewPulseComments(actor: PolicyActor, team: ScopeTeam): boolean {
  return canViewIndividualDevelopers(actor, team);
}

/**
 * May the actor set how often the team is asked (every week / two weeks / month / three months)
 * and whether it is e-mailed automatically? Managers decide: the QA managers of the team's
 * department and super_admin. Team leads do not (they can still send the survey).
 */
export function canSetPulseCadence(actor: PolicyActor, team: { id: string; department_id?: string | null }): boolean {
  return canManageTeam(actor, team);
}

/**
 * May the actor e-mail the survey (and reminders) to the team's members? Whoever may see the
 * team's results and is its lead, a QA manager of its department or super_admin.
 */
export function canSendPulseSurvey(actor: PolicyActor, team: ScopeTeam): boolean {
  return canViewPulseResults(actor, team) && canWriteTeamData(actor, team);
}
