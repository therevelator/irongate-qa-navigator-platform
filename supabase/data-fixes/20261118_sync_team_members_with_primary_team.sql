-- DATA FIX (review before applying; NOT a migration, not applied anywhere).
--
-- Team membership is now one definition: a user belongs to a team when
-- users.primary_team_id is that team OR a team_members row links them to it
-- (server/lib/teamMembership.ts). New writes keep team_members in step with the primary
-- team, but older rows were never synced (e.g. LegacyCode Warriors: 0 team_members rows,
-- 4 primary members).
--
-- This script only INSERTS the missing team_members rows. It deletes and rewrites nothing.
-- Idempotent: ON CONFLICT DO NOTHING, so it can be run more than once.

BEGIN;

-- 1. Preview: users whose primary team has no team_members row.
SELECT u.id AS user_id, u.email, u.primary_team_id, t.name AS team_name
  FROM users u
  JOIN teams t ON t.id = u.primary_team_id
 WHERE NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = u.id AND tm.team_id = u.primary_team_id)
 ORDER BY t.name, u.email;

-- 2. Insert the missing memberships.
INSERT INTO team_members (user_id, team_id, role)
SELECT u.id, u.primary_team_id, CASE WHEN u.role = 'team_lead' THEN 'lead' ELSE 'member' END
  FROM users u
  JOIN teams t ON t.id = u.primary_team_id
 WHERE NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = u.id AND tm.team_id = u.primary_team_id)
ON CONFLICT (user_id, team_id) DO NOTHING;

-- 3. Report only (no change): users whose primary_team_id points at a team that does not
--    exist (seen locally: admin@irongate.com -> team-quasars). Fix these by hand in Users.
SELECT u.id, u.email, u.primary_team_id
  FROM users u
 WHERE u.primary_team_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = u.primary_team_id);

COMMIT;
