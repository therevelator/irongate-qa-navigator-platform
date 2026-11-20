# Deployment guide

How to deploy QE Navigator: the database on Supabase (PostgreSQL), the app and API on Netlify, or the
same code as one long-running Node service. Also: environment variables (names only), migrations,
scheduled jobs and checks after a deploy.

## Architecture

| Part | Where | Code |
|---|---|---|
| Front end (React 19, Vite, Tailwind CSS 4) | Netlify static site (`dist/`) | `src/` |
| API (Express 5) | Netlify Function `api` (all `/api/*` requests), or a Node process | `server/`, `netlify/functions/api.ts` |
| Scheduled jobs | Netlify Scheduled Functions, or `node-cron` in the Node process | `netlify/functions/*.ts`, `server/jobs/` |
| Database | PostgreSQL on Supabase | `supabase/migrations/` |
| E-mail | Resend (preferred) or SMTP | `server/lib/mailer.ts` |

`netlify/functions/api.ts` mounts the same routers as `server/index.ts`, so both deployments behave the
same. On Netlify there is no WebSocket; pages refresh on load and on their own timers.

## 1. Database (Supabase)

1. Create a Supabase project in a region close to the Netlify functions (Netlify functions run in
   `us-east-1` by default).
2. Load the schema. From a machine with `psql`, using the **session pooler** connection string (port 5432),
   apply the files of `supabase/migrations/` in file-name (timestamp) order:

   ```bash
   for f in $(ls supabase/migrations/*.sql | sort); do
     psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
   done
   ```

   Migrations are additive and idempotent; running one again does no harm. For a new empty database,
   that is all. `scripts/ci/prepare-db.sh` shows the exact order CI uses (initial schema, the data snapshot
   `db_snapshots/latest_snapshot.postgres.sql`, then the later migrations); it only runs against a local
   host.
3. The app uses the **transaction pooler** connection string (port 6543) as `DATABASE_URL`. SSL is turned on
   automatically for non-local hosts.

Row Level Security is enabled on every table with no policies; the app connects as the owner. Do not add
policies unless you start using the Supabase client libraries.

**New migrations.** Add a file `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`, written so it can run twice
(`IF NOT EXISTS`, `ON CONFLICT`). Apply it to each environment with `psql` before or together with the deploy
that needs it. CI applies every migration to a fresh database on each push, so a broken migration fails
the build.

Free Supabase projects pause after about a week without activity; `db-keepalive` runs twice a day to
prevent that, or restore the project from the Supabase dashboard.

## 2. Netlify

1. Connect the repository in Netlify. `netlify.toml` sets the build (`npm run build`, publish `dist`,
   functions in `netlify/functions`, Node 22), the `/api/*` redirect to the `api` function, the SPA fallback
   and security headers.
2. Set the environment variables (section 4) under Site configuration → Environment variables.
3. Deploy. After changing variables, trigger a new deploy.

Netlify functions on Netlify:

| Function | Schedule (UTC) | What it does |
|---|---|---|
| `api` | every `/api/*` request | the Express app |
| `alerts-evaluate` | hourly at :15 | alert evaluation, action outcomes, notifications; then forecasts and recommendations of due teams |
| `weekly-digest` | Monday 07:00 | weekly digest e-mails |
| `pulse-auto-send` | hourly at :40 | automatic wellbeing pulse e-mails per team cadence |
| `calc-recompute` | daily 03:41 | recalculates the last days of metrics from raw data |
| `db-keepalive` | 06:00 and 18:00 | keeps the database awake; retention cleanup (logs, sessions, sign-in events, raw payloads) |
| `demo-refresh` | daily 02:17 | starts `demo-refresh-background`, which adds the missing recent days of sample data (never real data) |
| `demo-data-background` | on demand | the operator's Demo Data and Populate metrics jobs (up to 15 minutes) |

## 3. Long-running Node service (alternative)

`npm run build` then `npm run server:prod` serves the API and the built app from `dist/` on `PORT`.
`railway.json` has this configuration (health check `/health`). The jobs run in-process with `node-cron`:

| Job | Variable (default) | File |
|---|---|---|
| Alerts, notifications, forecasts and recommendations | `ALERTS_EVALUATE_CRON` (`15 * * * *`) | `server/jobs/alertsCron.ts` |
| Weekly digest | `DIGEST_CRON` (`0 7 * * 1`) | `server/jobs/alertsCron.ts` |
| Pulse e-mails | `PULSE_SEND_CRON` (`40 * * * *`) | `server/jobs/pulseCron.ts` |
| Retention cleanup | `LOG_CLEANUP_CRON` (`7 3 * * *`) | `server/jobs/cleanupCron.ts` |
| Recompute from raw data | `CALC_RECOMPUTE_CRON` (`41 3 * * *`) | `server/jobs/cleanupCron.ts` |

`ALERTS_CRON=false` and `PULSE_CRON=false` turn those jobs off (for example on a second instance);
`LOG_CLEANUP_CRON=off` and `CALC_RECOMPUTE_CRON=off` likewise. The sample-data jobs
(`server/jobs/intervalSync.ts`, `analyticsSync.ts`) only write when `ENABLE_SYNTHETIC_DATA=true`.

## 4. Environment variables

Names only. Never commit values. `.env.example` is the local template; `.env` is git-ignored. Anything
prefixed `VITE_` ends up in the browser bundle.

**Required**

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Supabase transaction pooler). `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` are an alternative |
| `JWT_SECRET` | Signs session tokens; the API will not start in production without it |

**Recommended in production**

| Variable | Purpose |
|---|---|
| `APP_URL` | Public URL used in e-mail links, SSO redirects and Slack messages (on Netlify defaults to `URL`) |
| `RESEND_API_KEY`, `MAIL_FROM` | E-mail through Resend; `MAIL_FROM` on a domain verified in Resend |
| `SETTINGS_ENCRYPTION_KEY` | Encrypts the Slack webhook (else derived from `JWT_SECRET`) |
| `FRONTEND_URL` | Allowed browser origin when the app and API are on different origins |

**Optional**

| Variable | Purpose |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | E-mail through SMTP when Resend is not set. Without either, e-mails are only logged and links are shown to copy |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in (redirect `<APP_URL>/api/auth/sso/google/callback`) |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` | Microsoft sign-in (redirect `<APP_URL>/api/auth/sso/microsoft/callback`) |
| `GOOGLE_OIDC_DISCOVERY_URL`, `MS_OIDC_DISCOVERY_URL` | Override the OpenID discovery documents (tests) |
| `API_PUBLIC_URL` | Only when the API has its own origin (local development) |
| `GROQ_API_KEY` | Enables the written texts of the executive briefing, team and developer suggestions and the business-impact summary; without it the rule-based versions are used |
| `INVITE_TTL_HOURS` | Invitation lifetime (default 168) |
| `DB_POOL_MAX` | Connections per instance (default 10, or 3 on Netlify) |
| `PORT` | API port of the Node service (default 3000) |
| `API_RATE_LIMIT_MAX` | General API rate limit per minute and client (default 300) |
| `IMPROVE_REFRESH_LIMIT`, `IMPROVE_REFRESH_BUDGET_MS` | Recalculate rate limit; time budget of the forecast refresh per run |
| `CALC_RECOMPUTE_BUDGET_MS` | Time budget of the nightly recompute |
| `CHANGE_FAILURE_WINDOW_HOURS` | Hotfix window that marks a deploy as a failed change (default 72) |
| `WORK_RECOMPUTE_DAYS` | Days of issue history recalculated on arrival (default 190) |
| `RAW_UPLOAD_MAX_MB`, `RAW_PAYLOAD_MAX_KB`, `RAW_PAYLOAD_DAYS` | Raw upload size limit (20 MB), largest gzipped payload kept (512 KB), days payloads are kept (35) |
| `PLATFORM_OPERATOR_ALLOWED_IPS` | Client IPs allowed to use `/operator` (comma-separated) |
| `OPERATOR_SIGN_IN_MAX` | Operator sign-in attempts per IP per window (default 10) |
| `OPERATOR_PASSWORD` | Read by `npm run operator:create` when `--password` is not given; not used by the running app |
| `ENABLE_SYNTHETIC_DATA` | `true` enables the sample-data generators; off by default |
| `DEMO_MODE` | `true` shows demo account chips on the sign-in page; on by default locally only |
| `DEMO_REFRESH_ENABLED`, `DEMO_REFRESH_SECRET` | Nightly sample-data refresh on Netlify; the secret signs the background call (else `JWT_SECRET`) |
| `SAMPLE_RAW_DATA`, `SAMPLE_PULSE_WEEKS`, `SAMPLE_TEAM_STORIES`, `SAMPLE_SPRINT_RELEASES` | Sample data generation options |
| `ALERTS_CRON`, `ALERTS_EVALUATE_CRON`, `DIGEST_CRON`, `PULSE_CRON`, `PULSE_SEND_CRON`, `LOG_CLEANUP_CRON`, `CALC_RECOMPUTE_CRON` | Node service schedules (section 3) |
| `VITE_DISABLE_WEBSOCKET` | Front end: turn the live-update socket off |
| `MAIL_CAPTURE_FILE`, `NOTIFY_SLACK_ALLOW_LOCAL`, `TEST_DATABASE_URL` | Tests only |

The Slack webhook is entered in the app (Parameters → Notification channels), not in the environment.

## 5. First platform operator

On a machine that can reach the database:

```bash
DATABASE_URL=<transaction pooler URL> npm run operator:create -- --email <address> --name "<name>" --allow-remote
```

The password is asked for (or read from `OPERATOR_PASSWORD`). Then sign in at `/operator`.

## 6. Checks after a deploy

```bash
curl -s -X POST https://<site>/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"nobody@example.com","password":"x"}'
# expect 401 "Invalid credentials": the function reached the database. A 500 means it could not.
```

Then sign in, open the Overview and a team, and check the operator panel's scheduled jobs list after the
first hourly run.

## 7. Sample data on a hosted database

`npm run seed:demo` writes only to a local database unless `--allow-remote` is given. For a hosted demo,
prefer SQL files
(`npm run seed:demo -- --sql out/demo-seed.sql`) or use `scripts/reseed/` (one showcase company; see
[scripts/reseed/README.md](../scripts/reseed/README.md)), and load them with `psql`.
