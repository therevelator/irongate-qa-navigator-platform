import { query } from '../../src/lib/db';

/**
 * Team membership: ONE definition used for member counts and member lists.
 * A user belongs to a team when users.primary_team_id is that team OR a team_members row
 * links them to it (secondary teams). Only active users count.
 * When a user's primary team changes, syncPrimaryTeamMembership keeps team_members in step,
 * so both sources agree.
 */

/** SQL expression: number of active members of team `<alias>.id`. */
export const teamMemberCountSql = (alias = 't') => `(
  SELECT COUNT(*) FROM users mu
   WHERE mu.is_active = TRUE
     AND (mu.primary_team_id = ${alias}.id
          OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = mu.id AND tm.team_id = ${alias}.id))
)`;

/**
 * SQL expression: the team lead's name. teams.lead_id when set; otherwise the active
 * team_lead whose primary team this is (earliest created), so teams without lead_id still
 * show their lead.
 */
export const teamLeadNameSql = (alias = 't') => `COALESCE(
  (SELECT NULLIF(TRIM(lu.first_name || ' ' || lu.last_name), '') FROM users lu WHERE lu.id = ${alias}.lead_id),
  (SELECT NULLIF(TRIM(lu.first_name || ' ' || lu.last_name), '') FROM users lu
    WHERE lu.primary_team_id = ${alias}.id AND lu.role = 'team_lead' AND lu.is_active = TRUE
    ORDER BY lu.created_at ASC NULLS LAST LIMIT 1)
)`;

/** Keep team_members in step with a change of users.primary_team_id. */
export async function syncPrimaryTeamMembership(
  userId: string,
  oldTeamId: string | null | undefined,
  newTeamId: string | null | undefined,
  role: string
): Promise<void> {
  if (oldTeamId === newTeamId) return;
  if (oldTeamId) {
    await query('DELETE FROM team_members WHERE user_id = ? AND team_id = ?', [userId, oldTeamId]);
  }
  if (newTeamId) {
    await query(
      `INSERT INTO team_members (user_id, team_id, role) VALUES (?, ?, ?)
       ON CONFLICT (user_id, team_id) DO NOTHING`,
      [userId, newTeamId, role === 'team_lead' ? 'lead' : 'member']
    );
  }
}
