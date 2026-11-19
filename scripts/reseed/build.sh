#!/usr/bin/env bash
# Build the production reseed files (scripts/reseed/README.md):
#   1. a fresh LOCAL database with every migration of supabase/migrations (the production schema)
#   2. the standard sample company (npm run seed:demo), turned into Meridian Financial Technologies
#      (scripts/reseed/showcase.sql)
#   3. the export: <out>/000_wipe.sql and <out>/001.sql, 002.sql, … (scripts/reseed/export.mjs),
#      every users.password_hash replaced by a per-role placeholder, and <out>/operator.sql
#
# Usage: scripts/reseed/build.sh <out-dir> [YYYY-MM-DD]     (needs local Postgres, postgres/postgres)
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=${1:?out dir}
TODAY=${2:-$(date -u +%F)}
DB=irongate_reseed_build_test
ADMIN=postgres://postgres:postgres@127.0.0.1:5432/postgres
URL=postgres://postgres:postgres@127.0.0.1:5432/$DB
mkdir -p "$OUT"

psql "$ADMIN" -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
for f in $(ls supabase/migrations/*.sql | sort); do psql "$URL" -v ON_ERROR_STOP=1 -qX -f "$f" > /dev/null; done
DATABASE_URL=$URL npm run --silent seed:demo -- --today "$TODAY" > /dev/null
psql "$URL" -v ON_ERROR_STOP=1 -qX -f scripts/reseed/showcase.sql

# 000_wipe.sql: every public table except platform_operators, listed explicitly.
{
  echo "-- IronGate QA Navigator: empty every application table of the public schema."
  echo "-- Keeps: the schema (nothing is dropped), public.platform_operators (IronGate platform support"
  echo "-- accounts) and every other schema (Supabase auth, storage, migration bookkeeping)."
  echo "-- One statement; run it in the SQL console. Identity sequences restart."
  echo "TRUNCATE TABLE"
  psql "$URL" -AtX -c "SELECT string_agg('  public.' || tablename, E',\n' ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'platform_operators'"
  echo "RESTART IDENTITY CASCADE;"
} > "$OUT/000_wipe.sql"

DATABASE_URL=$URL node scripts/reseed/export.mjs --out "$OUT" > "$OUT/export-summary.json"
cp scripts/reseed/operator.sql "$OUT/operator.sql"
echo "Built $(ls "$OUT"/0*.sql | wc -l) files in $OUT (database $DB kept for checks)"
