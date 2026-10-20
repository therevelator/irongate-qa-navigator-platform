# Moving the database to Supabase (PostgreSQL)

The backend used MySQL (Aiven). It now talks to PostgreSQL through `pg`, so it runs on Supabase.
Everything the app needs is in the repo:

| File | What it is |
|------|------------|
| `supabase/migrations/20261020000000_initial_schema.sql` | All 38 tables, keys, indexes, `updated_at` triggers, RLS lock-down |
| `db_snapshots/latest_snapshot.postgres.sql` | Data from `db_snapshots/latest_snapshot.sql`, converted to Postgres (a plain Git file, not LFS) |
| `scripts/mysql-to-postgres.ts` | The converter that produced both files (only needed again for a newer MySQL dump) |

## 1. Create the Supabase project

1. https://supabase.com/dashboard → **New project**. Pick a region close to your Netlify functions
   (Netlify functions run in `us-east-1` by default, so choose **East US (N. Virginia)** unless you changed it).
2. Save the database password.

## 2. Load the schema and data

In Supabase → **Connect** (top bar), copy the **Session pooler** connection string (port `5432`), then:

```bash
export SUPABASE_DB_URL='postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261020000000_initial_schema.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f db_snapshots/latest_snapshot.postgres.sql
```

The data file runs in one transaction with `session_replication_role = replica`, the same as
`FOREIGN_KEY_CHECKS=0` in the MySQL dump. A few existing users point at a team or department that
no longer exists, as they did in MySQL, and they load as they are.

No `psql` installed? Use `brew install libpq` or `apt install postgresql-client`. The schema file can also be
pasted into the Supabase **SQL editor**, but the 2.9 MB data file is too big for the editor. Load it with `psql`.

## 3. Point the app at Supabase

Use the **Transaction pooler** string (port `6543`) for the app. It suits serverless functions, which open many short-lived connections:

```
postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

* **Netlify**: Site configuration → Environment variables → set `DATABASE_URL` to the string above
  (replace the old `mysql://…` value), then **Deploys → Trigger deploy → Clear cache and deploy site**.
  Keep `JWT_SECRET` and `GROQ_API_KEY` as they are.
* **Railway** (if used): set the same `DATABASE_URL` on the service.
* **Local dev**: put it in `.env`. A local Postgres works too: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/irongate_qa`.

SSL is turned on automatically for non-local hosts. `DB_POOL_MAX` (default `3` on Netlify, `10` elsewhere)
caps connections per function or server instance.

## 4. Check it

```bash
DATABASE_URL='<transaction pooler url>' node test-connection.js   # should list 38 tables
# Hits the database: expect 401 "Invalid credentials". A 500 means the function can't reach the DB.
curl -X POST https://<your-site>.netlify.app/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"nobody@example.com","password":"x"}'
```

Then log in on the site with an existing account.

## Notes

* **Row Level Security** is enabled on every table with no policies. The app connects directly as the
  `postgres` owner, which bypasses RLS. Supabase's public Data API (anon/authenticated keys) therefore
  cannot read anything, including password hashes. Don't add policies unless you start using `supabase-js`.
* **Free-tier pausing**: Supabase pauses free projects after about a week without activity. If the site
  "goes down" the same way again, restore the project from the Supabase dashboard (or use a paid plan).
* **Behaviour differences handled in code** (`src/lib/db.ts` and the queries):
  * `?` placeholders are still used in queries and are translated to `$1, $2, …`.
  * Booleans (`is_active`, `ai_enabled`, …) are real Postgres booleans and come back as `true/false` instead of `1/0`.
  * `COUNT(*)` and integer `SUM()` come back as numbers. `DECIMAL` columns still come back as strings, as with mysql2.
  * A fractional value written to an INTEGER column is rounded the way MySQL did it, instead of being rejected.
  * Email lookups and team/department name checks stay case-insensitive (MySQL's `_ci` collation),
    and a `lower(email)` unique index keeps emails unique regardless of case.
  * `ON DUPLICATE KEY UPDATE` became `ON CONFLICT … DO UPDATE`; `CURDATE()`/`DATE_SUB` became `CURRENT_DATE`/intervals;
    MySQL `ENUM`s became `text` + `CHECK` constraints.
* The older MySQL-only SQL files (`database/`, `schema_updated.sql`, `local_*.sql`, `setup-aiven.sh`, …) are
  no longer used. `supabase/migrations/` is now the schema source of truth.

## Regenerating from a newer MySQL dump

```bash
# restore the dump into any MySQL 8 server, then:
MYSQL_URL='mysql://user:pass@127.0.0.1:3306/irongate_qa' npx tsx scripts/mysql-to-postgres.ts
```
