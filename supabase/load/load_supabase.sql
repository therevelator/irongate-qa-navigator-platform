-- IronGate QA Navigator — Supabase loader.
-- Run from the repository root:
--   psql "<SUPABASE_CONNECTION_STRING>" -f supabase/load/load_supabase.sql
-- Loads tables, then data, then indexes/foreign-keys/triggers/RLS. No superuser required.
\set ON_ERROR_STOP on
\echo '==> Creating tables...'
\i supabase/load/01_schema_tables.sql
\echo '==> Loading data (~20k rows)...'
\i db_snapshots/latest_snapshot.postgres.sql
\echo '==> Adding indexes, foreign keys, triggers, RLS...'
\i supabase/load/02_constraints.sql
\echo '==> Done.'
