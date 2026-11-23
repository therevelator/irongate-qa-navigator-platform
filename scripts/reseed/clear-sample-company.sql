-- Remove the generated data of ONE sample company, keeping its organisation (company, departments, teams, the
-- people of showcase.sql with their passwords, role assignments, team memberships, invitations) and every
-- record of what people did (audit log, sign-ins, sessions, activity, jobs). Afterwards
-- `npm run seed:demo -- --fill-existing --company <id>` (with the showcase settings) writes the sample again.
-- Usage: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v company=mft-meridian -f clear-sample-company.sql
-- One transaction; touches no other company. Tables are found from the schema (any table with a company_id
-- or team_id column), so the file needs no change when tables are added.
BEGIN;
SET LOCAL lock_timeout = '10s';
CREATE TEMP TABLE _co ON COMMIT DROP AS SELECT :'company'::text AS id;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = (SELECT id FROM _co)) THEN RAISE EXCEPTION 'No company %', (SELECT id FROM _co); END IF;
  -- Refuse a company with real KPI data: this is for sample companies only.
  IF EXISTS (SELECT 1 FROM kpi_snapshots k JOIN teams t ON t.id = k.team_id WHERE t.company_id = (SELECT id FROM _co) AND k.id NOT LIKE 'demo-%') THEN
    RAISE EXCEPTION 'Company % has real KPI snapshots: not a sample company', (SELECT id FROM _co);
  END IF;
END $$;
CREATE TEMP TABLE _teams ON COMMIT DROP AS SELECT id FROM teams WHERE company_id = (SELECT id FROM _co);
CREATE TEMP TABLE _users ON COMMIT DROP AS SELECT id FROM users WHERE company_id = (SELECT id FROM _co);

DO $$
DECLARE
  keep text[] := ARRAY['companies', 'departments', 'teams', 'users', 'role_assignments', 'team_members', 'invitations', 'user_identities',
                       'user_sessions', 'audit_log', 'auth_events', 'user_activity', 'password_resets', 'platform_operators', 'demo_data_jobs',
                       'job_runs', 'server_errors', 'sso_connections', 'sso_links'];
  r record; pass int; pending int; failed int; n bigint;
BEGIN
  FOR pass IN 1..6 LOOP
    failed := 0;
    FOR r IN
      SELECT c.table_name, bool_or(c.column_name = 'company_id') AS co, bool_or(c.column_name = 'team_id') AS te
        FROM information_schema.columns c JOIN pg_tables t ON t.schemaname = 'public' AND t.tablename = c.table_name
       WHERE c.table_schema = 'public' AND c.column_name IN ('company_id', 'team_id') AND NOT (c.table_name = ANY (keep))
       GROUP BY c.table_name ORDER BY c.table_name
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE %s', r.table_name,
          concat_ws(' OR ', CASE WHEN r.co THEN 'company_id::text = (SELECT id FROM _co)' END, CASE WHEN r.te THEN 'team_id::text IN (SELECT id FROM _teams)' END));
      EXCEPTION WHEN foreign_key_violation THEN failed := failed + 1;
      END;
    END LOOP;
    EXIT WHEN failed = 0;
    IF pass = 6 THEN RAISE EXCEPTION 'Rows still referenced after 6 passes'; END IF;
  END LOOP;
END $$;

-- Rows keyed by person only: sample productivity snapshots of the company's people.
DELETE FROM developer_productivity_snapshots WHERE developer_id IN (SELECT id FROM _users) AND (id >= 1000000000 OR developer_id LIKE 'demo-%');
-- The sample developers the fill added (and their assignments); the people of showcase.sql stay.
DELETE FROM role_assignments WHERE id LIKE 'demo-%' AND (company_id = (SELECT id FROM _co) OR user_id IN (SELECT id FROM _users));
DELETE FROM team_members WHERE user_id IN (SELECT id FROM _users WHERE id LIKE 'demo-%');
UPDATE teams SET lead_id = NULL WHERE company_id = (SELECT id FROM _co) AND lead_id LIKE 'demo-%';
DELETE FROM users WHERE company_id = (SELECT id FROM _co) AND id LIKE 'demo-%';
COMMIT;
