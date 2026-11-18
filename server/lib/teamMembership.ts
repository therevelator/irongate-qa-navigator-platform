/**
 * Team membership: ONE definition used for member counts, member lists and team leads.
 * A user belongs to a team when they hold an active role assignment on it (team_lead,
 * qa_engineer or viewer); the team's lead is its active team_lead assignment. Both are read
 * from role_assignments through server/lib/assignments.ts; team_members and teams.lead_id are
 * compatibility columns kept in sync there (syncUserDisplay). Only active users count.
 */
export { teamMemberCountSql, teamLeadNameSql, teamLeadIdSql, isTeamMemberSql, execOn, type Exec } from './assignments';
