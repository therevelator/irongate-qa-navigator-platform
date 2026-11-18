#!/usr/bin/env bash
# Prepare a fresh local Postgres database exactly like production, for CI and local test runs.
#
#   1. the initial schema migration (supabase/migrations/20261020000000_initial_schema.sql)
#   2. the data snapshot (db_snapshots/latest_snapshot.postgres.sql) — it was taken against
#      the initial schema, so it is loaded before any later migration
#   3. every later migration in supabase/migrations/, in timestamp (file name) order; they
#      are idempotent and backfill the snapshot rows (QA scores, role assignments, ...)
#   4. the demo seed (npm run seed:demo) and the fill of existing companies
#      (npm run seed:demo -- --fill-existing)
#
# Usage: DATABASE_URL=postgres://user:pass@127.0.0.1:5432/db scripts/ci/prepare-db.sh
# Refuses any host other than localhost / 127.0.0.1. The database must exist and be empty.
set -euo pipefail

cd "$(dirname "$0")/../.."

: "${DATABASE_URL:?DATABASE_URL must be set}"

host=$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$DATABASE_URL")
case "$host" in
  localhost|127.0.0.1) ;;
  *) echo "Refusing to prepare non-local database host '$host'" >&2; exit 1 ;;
esac

echo "==> Waiting for Postgres at $host"
for i in $(seq 1 60); do
  if pg_isready -d "$DATABASE_URL" -q; then break; fi
  if [ "$i" -eq 60 ]; then echo "Postgres did not become ready" >&2; exit 1; fi
  sleep 2
done

run_sql() {
  echo "==> Applying $1"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -X -f "$1" > /dev/null
}

initial=supabase/migrations/20261020000000_initial_schema.sql
run_sql "$initial"
run_sql db_snapshots/latest_snapshot.postgres.sql

for f in $(ls supabase/migrations/*.sql | sort); do
  [ "$f" = "$initial" ] && continue
  run_sql "$f"
done

echo "==> Demo seed"
npm run --silent seed:demo
echo "==> Demo fill of existing companies"
npm run --silent seed:demo -- --fill-existing

echo "==> Database ready"
psql "$DATABASE_URL" -X -A -t -c "SELECT 'companies=' || count(*) FROM companies UNION ALL SELECT 'users=' || count(*) FROM users UNION ALL SELECT 'teams=' || count(*) FROM teams"
