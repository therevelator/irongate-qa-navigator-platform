import type pg from 'pg';
import { query, toPgPlaceholders } from '../../src/lib/db';

/** Run a "?"-placeholder statement on the pool, or on a transaction client when given. */
export type Exec = (sql: string, params?: any[]) => Promise<any>;
export const execOn = (client?: pg.PoolClient): Exec =>
  client ? (sql, params) => client.query(toPgPlaceholders(sql), params).then((r) => r.rows) : (sql, params) => query(sql, params);

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

/** SQL expression: the id of the lead teamLeadNameSql names (same lead_id-then-fallback rule). */
export const teamLeadIdSql = (alias = 't') => `COALESCE(
  (SELECT lu.id FROM users lu WHERE lu.id = ${alias}.lead_id),
  (SELECT lu.id FROM users lu
    WHERE lu.primary_team_id = ${alias}.id AND lu.role = 'team_lead' AND lu.is_active = TRUE
    ORDER BY lu.created_at ASC NULLS LAST LIMIT 1)
)`;

/** team_members.role for a user's primary-team row. */
const memberRole = (role: string) => (role === 'team_lead' ? 'lead' : 'member');

/**
 * Keep team_members in step with a change of users.primary_team_id (and of role: the
 * primary-team row is 'lead' for a team_lead, else 'member'). Pass a transaction client to
 * run inside a transaction.
 */
export async function syncPrimaryTeamMembership(
  userId: string,
  oldTeamId: string | null | undefined,
  newTeamId: string | null | undefined,
  role: string,
  client?: pg.PoolClient
): Promise<void> {
  const exec = execOn(client);
  if (oldTeamId === newTeamId) {
    // Same team: only the row's lead/member role can change (an UPDATE, so a dangling
    // primary_team_id from old data never inserts a row).
    if (newTeamId) await exec('UPDATE team_members SET role = ? WHERE user_id = ? AND team_id = ?', [memberRole(role), userId, newTeamId]);
    return;
  }
  if (oldTeamId) {
    await exec('DELETE FROM team_members WHERE user_id = ? AND team_id = ?', [userId, oldTeamId]);
  }
  if (newTeamId) {
    await exec(
      `INSERT INTO team_members (user_id, team_id, role) VALUES (?, ?, ?)
       ON CONFLICT (user_id, team_id) DO UPDATE SET role = EXCLUDED.role`,
      [userId, newTeamId, memberRole(role)]
    );
  }
}
