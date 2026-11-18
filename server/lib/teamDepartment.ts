import { query, queryOne, transaction } from '../../src/lib/db';
import { departmentManagers, execOn, syncUserDisplay } from './assignments';
import { recordAudit } from './audit';

/**
 * Moving a team to another department: the ONE definition of what moves with it, used by
 * PUT /api/admin/teams/:id/department (preview and move) and shown in the Departments page
 * confirm dialog.
 *
 * Everything that decides a team's department reads teams.department_id: analytics scope
 * (userPolicy.canViewTeamAnalytics via access.getOwnedTeam: QA managers of a department see its
 * teams through their department assignment), team management (canManageTeam),
 * KPI dashboards and their department filters, and config inheritance (configResolver). Two
 * other columns carry a department and are kept in step here, in the same transaction:
 *   users.department_id    members whose primary team is this team and who were in the old
 *                          department follow it. super_admin and qa_manager keep their
 *                          department (it defines what they administer, not where they work),
 *                          and so does anyone whose primary team is elsewhere.
 *   configs.department_id  team-level config rows (team_id set) also store the department;
 *                          they follow so the Parameters page finds them under the new one.
 * Role assignments do not move: QA managers of the old department lose the team (their scope is
 * their department, so a membership they had of the team ends), the new department's managers
 * gain it, and the team's lead and members keep their team assignments. Recorded and undoable.
 */

/** Roles whose department never changes because a team moved. */
export const ROLES_KEEPING_DEPARTMENT = ['super_admin', 'qa_manager'];

/** Users whose department follows the team: placeholders for company, team, old department. */
const followersWhere = (company: string, team: string, oldDept: string) =>
  `company_id = ${company} AND primary_team_id = ${team} AND department_id = ${oldDept}
   AND role NOT IN (${ROLES_KEEPING_DEPARTMENT.map((r) => `'${r}'`).join(', ')})`;

export interface DepartmentRef { id: string; name: string }
export interface PersonRef { id: string; name: string; email: string; role?: string; is_active?: boolean }

export interface TeamMovePlan {
  team: { id: string; name: string; is_active: boolean };
  from: DepartmentRef | null;
  to: DepartmentRef;
  /** Users whose department follows the team. */
  followers: PersonRef[];
  /** Active QA managers of the old department: they lose the team (their assignments stay). */
  managersLosing: PersonRef[];
  /** Active QA managers of the new department: they gain the team. */
  managersGaining: PersonRef[];
}

export type PlanResult =
  | { ok: true; plan: TeamMovePlan }
  | { ok: false; status: number; error: string };

const person = (r: any): PersonRef => ({
  id: r.id,
  name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || r.email,
  email: r.email,
  role: r.role,
  is_active: r.is_active,
});

/** Active QA managers of a department (role assignments, server/lib/assignments.ts). */
async function activeManagers(companyId: string, departmentId: string | null): Promise<PersonRef[]> {
  return (await departmentManagers(companyId, departmentId)).map(person);
}

/** Validate a move and describe what it changes. Does not write. */
export async function planTeamDepartmentMove(companyId: string, teamId: string, toDepartmentId: unknown): Promise<PlanResult> {
  if (typeof toDepartmentId !== 'string' || !toDepartmentId.trim()) {
    return { ok: false, status: 400, error: 'departmentId is required' };
  }
  const team = await queryOne<any>(
    'SELECT id, name, department_id, is_active FROM teams WHERE id = ? AND company_id = ?',
    [teamId, companyId]
  );
  if (!team) return { ok: false, status: 404, error: 'Team not found' };

  // Another company's department reads as "not found" so ids of other tenants are not confirmed.
  const to = await queryOne<any>(
    'SELECT id, name, is_active FROM departments WHERE id = ? AND company_id = ?',
    [toDepartmentId, companyId]
  );
  if (!to) return { ok: false, status: 400, error: 'Department not found in your company' };
  if (!to.is_active) return { ok: false, status: 400, error: 'That department is inactive. Teams can only move to an active department.' };
  if (to.id === team.department_id) return { ok: false, status: 400, error: 'The team is already in this department' };

  const clash = await queryOne<any>(
    'SELECT id FROM teams WHERE company_id = ? AND department_id = ? AND LOWER(name) = LOWER(?) AND id <> ?',
    [companyId, to.id, team.name, team.id]
  );
  if (clash) return { ok: false, status: 409, error: `${to.name} already has a team called "${team.name}"` };

  const from = team.department_id
    ? await queryOne<any>('SELECT id, name FROM departments WHERE id = ? AND company_id = ?', [team.department_id, companyId])
    : null;

  const followers = team.department_id
    ? (await query<any[]>(
        `SELECT id, first_name, last_name, email, role, is_active FROM users WHERE ${followersWhere('?', '?', '?')}
          ORDER BY is_active DESC, first_name, last_name`,
        [companyId, team.id, team.department_id]
      )).map(person)
    : [];

  return {
    ok: true,
    plan: {
      team: { id: team.id, name: team.name, is_active: !!team.is_active },
      from: from ? { id: from.id, name: from.name } : null,
      to: { id: to.id, name: to.name },
      followers,
      managersLosing: await activeManagers(companyId, team.department_id),
      managersGaining: await activeManagers(companyId, to.id),
    },
  };
}

/**
 * Apply a planned move in one transaction. The team update is guarded on the department the
 * plan saw, so a concurrent move makes this one fail instead of moving members twice.
 * Returns the ids of the users whose department followed the team.
 */
export async function applyTeamDepartmentMove(companyId: string, plan: TeamMovePlan, actorId: string | null = null): Promise<string[] | null> {
  return transaction(async (client) => {
    const fromId = plan.from?.id ?? null;
    const moved = await client.query(
      `UPDATE teams SET department_id = $1, updated_at = NOW()
        WHERE id = $2 AND company_id = $3 AND department_id IS NOT DISTINCT FROM $4`,
      [plan.to.id, plan.team.id, companyId, fromId]
    );
    if (moved.rowCount !== 1) throw Object.assign(new Error('Team changed department meanwhile'), { status: 409 });

    let userIds: string[] = [];
    if (fromId) {
      const users = await client.query(
        `UPDATE users SET department_id = $1, updated_at = NOW()
          WHERE ${followersWhere('$2', '$3', '$4')}
          RETURNING id`,
        [plan.to.id, companyId, plan.team.id, fromId]
      );
      userIds = users.rows.map((r: any) => r.id);
    }

    await client.query(
      'UPDATE configs SET department_id = $1, updated_at = NOW() WHERE company_id = $2 AND team_id = $3',
      [plan.to.id, companyId, plan.team.id]
    );
    // QA managers of the old department who were members of the team stay in their department
    // (their scope is the department): their membership of the moved team ends, as when a
    // manager is assigned (server/lib/roleAssignment.ts). Managers of the new department keep it.
    const exec = execOn(client);
    const ended = await exec<any>(
      `UPDATE role_assignments ra SET revoked_at = now(), revoked_by = ?
        WHERE ra.scope_type = 'team' AND ra.scope_id = ? AND ra.revoked_at IS NULL AND ra.role <> 'team_lead'
          AND EXISTS (SELECT 1 FROM role_assignments m WHERE m.user_id = ra.user_id AND m.role = 'qa_manager'
                       AND m.scope_type = 'department' AND m.scope_id = ? AND m.revoked_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM role_assignments m WHERE m.user_id = ra.user_id AND m.role = 'qa_manager'
                       AND m.scope_type = 'department' AND m.scope_id = ? AND m.revoked_at IS NULL)
        RETURNING ra.user_id, ra.role`,
      [actorId, plan.team.id, fromId, plan.to.id]
    );
    for (const r of ended) await syncUserDisplay(exec, r.user_id);
    const revokedMemberships = ended.map((r: any) => ({ userId: r.user_id, role: r.role }));

    // Change history (undoable): the team, the users whose department followed it.
    await recordAudit({
      companyId, actorId, action: 'team.move', entityType: 'team', entityId: plan.team.id,
      summary: `Moved ${plan.team.name} from ${plan.from?.name ?? 'no department'} to ${plan.to.name}`,
      before: { departmentId: fromId, departmentName: plan.from?.name ?? null },
      after: { departmentId: plan.to.id, departmentName: plan.to.name, movedUserIds: userIds, revokedMemberships },
      departmentIds: [fromId, plan.to.id], subjectIds: [plan.team.id, ...userIds, ...revokedMemberships.map((m: any) => m.userId)],
    }, exec);
    return userIds;
  });
}
