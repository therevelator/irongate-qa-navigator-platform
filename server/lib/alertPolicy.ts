/**
 * Who may do what with alerts, notifications, the digest and tracked actions. Every rule is
 * composed from the shared policy helpers (server/lib/userPolicy.ts) over the caller's live
 * role assignments (server/lib/assignments.ts); there are no role checks of their own.
 *
 *   alerts of a team        see: the team's analytics scope (canViewTeamAnalytics)
 *                           acknowledge: team data writers (canWriteTeamData: super_admin, the
 *                           department's QA managers, the team's leads)
 *   company-level alerts    (no team: ingestion failures naming no team) super_admin only
 *   alert rules             read: company config managers (super_admin, QA managers); change:
 *                           canSetTargets (company: super_admin; department / team: super_admin
 *                           or that department's QA manager), as KPI targets
 *   Slack / evaluation      super_admin (company administration)
 *   weekly digest           users holding a super_admin, qa_manager or team_lead assignment
 *                           (DEVELOPER_INSIGHT_ROLES), for the teams in their analytics scope
 *   tracked actions         see: analytics scope; create / edit / delete: team data writers;
 *                           the owner may change the status of their own action; an owner must
 *                           have the team in their analytics scope
 *   notifications, prefs    the caller's own only
 */
import { listAssignments, execOn, type Exec } from './assignments';
import {
  assignedTeamIds, managedDepartmentIds, canManageCompanyConfig, canSetTargets, canViewTeamAnalytics, canWriteTeamData, isCompanyAdmin, capAnywhere, DEVELOPER_INSIGHT_ROLES, grantsOf,
  type Grant, type PolicyActor, type ScopeTeam,
} from './userPolicy';

export const canSeeTeamAlerts = (actor: PolicyActor, team: ScopeTeam) => canViewTeamAnalytics(actor, team);
export const canAcknowledgeTeamAlert = (actor: PolicyActor, team: ScopeTeam) => canWriteTeamData(actor, team);
export const canSeeCompanyAlerts = (actor: PolicyActor) => isCompanyAdmin(actor);

/** May the actor see this alert (team alert: analytics scope; company-level alert: super_admin)? */
export function canSeeAlert(actor: PolicyActor, alert: { team_id: string | null; department_id?: string | null }): boolean {
  if (!alert.team_id) return canSeeCompanyAlerts(actor);
  return canSeeTeamAlerts(actor, { id: alert.team_id, department_id: alert.department_id ?? null });
}

export function canAcknowledgeAlert(actor: PolicyActor, alert: { team_id: string | null; department_id?: string | null }): boolean {
  if (!alert.team_id) return canSeeCompanyAlerts(actor);
  return canAcknowledgeTeamAlert(actor, { id: alert.team_id, department_id: alert.department_id ?? null });
}

/**
 * Is the team the actor's own (assigned to it, or QA manager of its department)? Pushed
 * notifications of a team alert go to these people at the severity they chose; users who see the
 * team only through a company-wide role (super_admin) are notified of critical team alerts only
 * (they see every alert on the Alerts page and in the digest).
 */
export function isOwnTeam(actor: PolicyActor, team: ScopeTeam): boolean {
  return assignedTeamIds(actor).includes(team.id) || (!!team.department_id && managedDepartmentIds(actor).includes(team.department_id));
}

export const canReadAlertRules = (actor: PolicyActor) => canManageCompanyConfig(actor);
export const canEditAlertRules = (actor: PolicyActor, scope: { type: 'company' | 'department' | 'team'; departmentId?: string | null }) =>
  canSetTargets(actor, scope);

export const canManageNotificationSettings = (actor: PolicyActor) => isCompanyAdmin(actor);
export const canRunEvaluation = (actor: PolicyActor) => isCompanyAdmin(actor);

/** Digest recipients: anyone holding a super_admin, QA manager or team lead assignment. */
export const canReceiveDigest = (actor: PolicyActor) => capAnywhere(actor, 'view_individuals');

export const canSeeActions = (actor: PolicyActor, team: ScopeTeam) => canViewTeamAnalytics(actor, team);
export const canManageActions = (actor: PolicyActor, team: ScopeTeam) => canWriteTeamData(actor, team);
/** May the actor change the status of this action (writers, or its owner while the team is in their scope)? */
export const canUpdateActionStatus = (actor: PolicyActor, team: ScopeTeam, action: { owner_id: string | null }) =>
  canManageActions(actor, team) || (!!action.owner_id && action.owner_id === actor.id && canViewTeamAnalytics(actor, team));
/** An action's owner must have the team in their analytics scope. */
export const canOwnAction = (owner: PolicyActor, team: ScopeTeam) => canViewTeamAnalytics(owner, team);

export interface CompanyActor extends PolicyActor {
  email: string;
  name: string;
}

/** Every active user of a company with their live grants (recipient selection). */
export async function loadCompanyActors(companyId: string, exec: Exec = execOn()): Promise<CompanyActor[]> {
  const users = await exec<any>(
    `SELECT id, email, role, department_id, primary_team_id,
            NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '') AS name
       FROM users WHERE company_id = ? AND is_active = TRUE ORDER BY id`,
    [companyId]
  );
  const rows = await listAssignments(companyId, null, exec);
  const grants = new Map<string, Grant[]>();
  for (const r of rows) {
    const list = grants.get(r.user_id) ?? [];
    list.push({ role: r.role, scopeType: r.scope_type, scopeId: r.scope_id });
    grants.set(r.user_id, list);
  }
  return users.map((u: any) => ({
    id: u.id, email: u.email, name: u.name ?? u.email, role: u.role, departmentId: u.department_id, primaryTeamId: u.primary_team_id,
    grants: grants.get(u.id) ?? [],
  }));
}

/** One user of a company as a PolicyActor (owner checks), or null when not an active user of it. */
export async function loadActor(companyId: string, userId: string, exec: Exec = execOn()): Promise<CompanyActor | null> {
  const u = (await exec<any>(
    `SELECT id, email, role, department_id, primary_team_id,
            NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '') AS name
       FROM users WHERE id = ? AND company_id = ? AND is_active = TRUE`,
    [userId, companyId]
  ))[0];
  if (!u) return null;
  const rows = await listAssignments(companyId, [userId], exec);
  return {
    id: u.id, email: u.email, name: u.name ?? u.email, role: u.role, departmentId: u.department_id, primaryTeamId: u.primary_team_id,
    grants: rows.map((r) => ({ role: r.role, scopeType: r.scope_type, scopeId: r.scope_id })),
  };
}
