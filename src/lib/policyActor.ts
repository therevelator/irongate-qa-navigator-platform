import type { User } from '../types/auth';
import { canGrant, type PolicyActor } from '../../server/lib/userPolicy';

/**
 * The signed-in user as a policy actor for the shared rules in server/lib/userPolicy.ts, with
 * their role assignments (from /api/auth/me), so the UI offers exactly what the server allows
 * (a QA manager of two departments, a lead of two teams, ...).
 */
export function policyActorOf(user: User | null | undefined): PolicyActor {
  return {
    id: user?.id ? String(user.id) : '',
    role: user?.role ?? '',
    departmentId: user?.departmentId ?? null,
    primaryTeamId: user?.primaryTeamId ?? null,
    grants: user?.assignments?.map((a) => ({ role: a.role, scopeType: a.scopeType, scopeId: a.scopeId, customRoleId: a.customRoleId ?? null, customRoleName: a.customRoleName ?? null, added: a.added ?? null, removed: a.removed ?? null })),
    liveDataOnly: !!user?.liveDataOnly,
  };
}

/** Role display names: the one map in server/lib/roleLabels.ts (keys stay qa_manager / qa_engineer). */
export { ROLE_LABELS, ROLE_LABELS_PLURAL, roleLabel } from '../../server/lib/roleLabels';
import { ROLE_LABELS } from '../../server/lib/roleLabels';

export interface GrantScopeOption { scopeType: 'company' | 'department' | 'team'; id: string; name: string; departmentName?: string | null; leadName?: string | null }
export interface GrantRoleOption { role: string; label: string; scopes: GrantScopeOption[] }

/**
 * The assignments the actor may give (shared rule canGrant), grouped by role, for the
 * invitation and "add assignment" dialogs. Teams carry department_id (and the current lead name).
 */
export function grantableOptions(
  actor: PolicyActor,
  companyId: string,
  companyName: string,
  departments: Array<{ id: string; name: string }>,
  teams: Array<{ id: string; name: string; department_id: string | null; department_name?: string | null; team_lead_name?: string | null }>,
): GrantRoleOption[] {
  const out: GrantRoleOption[] = [];
  const add = (role: string, scopes: GrantScopeOption[]) => { if (scopes.length) out.push({ role, label: ROLE_LABELS[role] ?? role, scopes }); };
  add('super_admin', canGrant(actor, { role: 'super_admin', scopeType: 'company', scopeId: companyId }) ? [{ scopeType: 'company', id: companyId, name: companyName }] : []);
  add('qa_manager', departments.filter((d) => canGrant(actor, { role: 'qa_manager', scopeType: 'department', scopeId: d.id })).map((d) => ({ scopeType: 'department' as const, id: d.id, name: d.name })));
  for (const role of ['team_lead', 'qa_engineer', 'viewer']) {
    add(role, teams
      .filter((t) => canGrant(actor, { role, scopeType: 'team', scopeId: t.id }, { id: t.id, department_id: t.department_id }))
      .map((t) => ({ scopeType: 'team' as const, id: t.id, name: t.name, departmentName: t.department_name ?? null, leadName: t.team_lead_name ?? null })));
  }
  return out;
}
