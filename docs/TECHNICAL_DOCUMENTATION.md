# Technical documentation

Architecture and code map of QE Navigator, for engineers who work on the code. How to run it is in the
[README](../README.md#getting-started) and [Run it locally](#run-it-locally); how to deploy it in
[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md); every API route in [METRICS_API_INDEX.md](METRICS_API_INDEX.md).

## 1. Stack

| Layer | Technology |
|---|---|
| Front end | React 19, TypeScript, Vite, Tailwind CSS 4, Recharts, lucide-react, react-hot-toast, SweetAlert2 |
| API | Express 5 on Node 22, TypeScript run with `tsx`, `pg` for PostgreSQL, `jsonwebtoken`, `bcrypt`, `express-rate-limit`, `node-cron`, `nodemailer` |
| Database | PostgreSQL (Supabase in production, Postgres 16 in CI) |
| Hosting | Netlify (static site, the `api` function, scheduled and background functions), or one Node service |
| Tests | Jest (API, database, unit), Playwright with axe-core (UI) |

## 2. Repository layout

| Path | Contents |
|---|---|
| `src/` | The React app. `App.tsx` (views and URL paths), `components/` (one file per screen or part; `operator/` is the platform panel; `tv/` TV mode parts), `contexts/` (auth, theme, analytics scope), `lib/` (shared client logic: access, appearance, battery scale, forecast text, pagination, password policy), `config/` (API base URL, `metricsConfig.ts` default targets), `data/` (metric catalog, chart helpers) |
| `src/lib/db.ts` | The database helper used by the server: `query`, `queryOne`, `transaction`, `?` placeholders translated to `$1, $2, …`; NUMERIC values come back as strings |
| `server/index.ts` | The Express app for the Node service: CORS, parsers, rate limit, routers, WebSocket, static files in production |
| `server/routes/` | One router per area (see METRICS_API_INDEX.md) |
| `server/middleware/` | `auth.ts` (session), `apiKey.ts` (ingestion keys), `access.ts` (permission helpers), `rateLimit.ts`, `errorHandler.ts` |
| `server/lib/` | Domain logic: `userPolicy.ts` (every access rule), `kpiIngest.ts` and `metricValues.ts` (the one KPI write path), `metricFormulas.ts`, `targets.ts`, `staleness.ts`, `alerts.ts`, `actions.ts`, `pulse*.ts`, `privacy.ts`, `sessions.ts`, `sso.ts`, `invitations.ts`, `passwordReset.ts`, `mailer.ts`, `operator.ts`, `authEvents.ts`, `userActivity.ts`, `executiveSummary.ts`, `revenueImpact.ts`, `demoGenerate.ts` |
| `server/lib/ingest/` | Raw data parsers and stores: test reports, coverage, pipelines, deployments, incidents, issues, SARIF |
| `server/lib/calc/` | Calculation engine: `engine.ts` (phase 1 and orchestration), `delivery.ts` (phase 2), `work.ts` and `quality.ts` (phase 3) |
| `server/lib/forecast/`, `server/lib/recommendations/` | Forecasts and recommendations (phase 4) |
| `server/jobs/` | `node-cron` jobs of the Node service |
| `server/seeds/` | Demo seed (`npm run seed:demo`), raw sample data, demo check |
| `server/scripts/operatorCreate.ts` | `npm run operator:create` |
| `netlify/functions/` | `api.ts` (the same routers as `server/index.ts`) and the scheduled / background functions |
| `supabase/migrations/` | The schema, applied in timestamp order |
| `scripts/ci/` | CI database preparation and service start; `scripts/ui-tests/` the local and remote UI test runners; `scripts/reseed/` the showcase reseed |
| `tests/api/`, `tests/database/`, `tests/e2e/` | Jest API and database suites, Playwright UI suite |
| `docs/` | Documentation; index in [README.md](README.md) |

Older files in the root (`database/`, `schema_updated.sql`, `local_*.sql`, `setup-aiven.sh`,
`setup_database.sh`, `migrate-users-to-aiven.sh`, `seed_teams_with_metrics.sql`, `update_quality_cowboys.sql`)
belong to the earlier MySQL setup and are not used.

## 3. Request flow

1. The browser calls `/api/...` with the session cookie `irongate_token`. On Netlify the redirect sends it to
   the `api` function; locally Vite's app calls the API on port 3000.
2. `requestContext` assigns a request id (`X-Request-Id`), the client IP and the route pattern.
3. CORS (exact origins), JSON and form parsers (skipped for the raw ingestion routes, including `server/routes/ingestMore.ts`:
   load-test results, test management, pull requests, calendars; they read their own
   body up to 20 MB, gzip allowed), the general rate limit.
4. The router's `authenticateToken` verifies the JWT, then loads the user's current row and role
   assignments in one query (`loadAccessContext`), and checks the session row in `user_sessions` and the
   company's status. Ingestion routes use `authenticateApiKey` instead.
5. The handler checks the specific permission with the shared policy (`server/lib/userPolicy.ts`, through
   `server/middleware/access.ts`) and scopes every query to the company.
6. Errors go to `apiErrorHandler`: 5xx responses return a generic message with the request id and are
   stored in `server_errors`. User activity rows are written for each request.

## 4. Access control

- Roles: `super_admin` (company), `qa_manager` (department, screen name Manager), `team_lead`,
  `qa_engineer` (screen name Software engineer), `viewer` (team). A person can hold several assignments
  (`role_assignments`).
- One policy module, [`server/lib/userPolicy.ts`](../server/lib/userPolicy.ts), with pure functions used by the
  API and by the UI ([`src/lib/viewAccess.ts`](../src/lib/viewAccess.ts) for pages and navigation,
  [`src/lib/accessSummary.ts`](../src/lib/accessSummary.ts) for the Help popover).
- The full matrix: [ROLE_ACCESS.md](ROLE_ACCESS.md).
- Platform operators: separate table, cookie (`irongate_operator`) and token audience. When an operator
  changes something a company user could also change, the operator route forwards to the company app's own
  handler as a super admin of that company without a user id (`forward()` in `server/routes/operator.ts`).
  Nothing an operator does is logged.

## 5. Data model (main tables)

Created by the migrations in `supabase/migrations/`:

| Area | Tables | Migration |
|---|---|---|
| Organisation | `companies`, `departments`, `teams`, `users`, `team_members`, `role_assignments`, `invitations`, `user_identities` (SSO) | initial, `20261119…` |
| Sessions and sign-in | `user_sessions`, `auth_events`, `password_resets` | `20261127…`, `20261123400000…` |
| KPIs | `kpi_snapshots` (one row per team and day, QA score by trigger), `metric_values` (every value with its time and source), `target_history`, `metric_update_intervals`, `company_kpi_snapshots` | initial, `20261117…`, `20261120…` |
| Ingestion | `api_keys`, `ingestion_log`, `raw_uploads` | `20261117…`, `20261120…`, `20261129…` |
| Raw CI data (phase 1) | `test_runs`, `test_results`, `coverage_reports`, `coverage_files`, `pipeline_runs_raw`, `pipeline_stage_runs`, `flaky_test_evidence`, `metric_evidence` | `20261129…` |
| Delivery (phase 2) | `deployments_raw`, `deployment_commits`, `incidents_raw`, `incident_updates`, `service_teams` | `20261130000000…` |
| Forecasts (phase 4) | `forecasts`, `recommendations` | `20261130100000…` |
| Work and quality (phase 3) | see the phase 3 migration | `20261201…` |
| Alerts and actions | `alert_rules`, `alerts`, `notifications`, `notification_deliveries`, `notification_preferences`, `company_notification_settings`, `team_actions`, `team_action_events` | `20261121000000…`, `20261202100000…` |
| Wellbeing pulse | `pulse_cadences`, `pulse_participation`, `pulse_responses`, `pulse_links`, `pulse_recipients`, `pulse_sends`, `pulse_settings`, `pulse_nonresponder_days` | `20261121200000…`, `20261122200000…`, `20261123300000…` |
| Views and onboarding | `saved_views`, `onboarding_state` | `20261121100000…` |
| Audit and logs | `audit_log` (Activity), `user_activity`, `server_errors`, `job_runs` | `20261119…`, `20261123…` |
| Platform | `platform_operators`, `platform_operator_sessions`, `demo_data_jobs` (`platform_access_log` exists but is no longer written) | `20261123000000…`, `20261125…`, `20261128…` |
| Analytics modules | `technical_debt`, `flaky_tests`, `test_cases`, `test_executions`, `performance_metrics`, `pipeline_stages`, `pipeline_runs`, `pipeline_execution_summary`, `pipeline_config`, `developer_metrics`, `sprint_velocity`, `business_impact_*`, `configs` | initial |

Row Level Security is enabled on every table with no policies; the app connects as the owner.

**Action status history** (`20261202100000_action_status_history.sql`, `server/lib/actions.ts`):

| Column | Meaning |
|---|---|
| `team_actions.status_changed_by` | user who last set the status (creation counts); FK `users`, `ON DELETE SET NULL`; NULL for a system change or unknown history |
| `team_actions.status_changed_at` | when (timestamptz, UTC); backfilled from the known history, else `completed_at` (done / dropped), else `updated_at` |
| `team_action_events` | one row per change: `id`, `company_id`, `team_id`, `action_id` (FK `team_actions`, cascade), `from_status` (NULL = created), `to_status`, `changed_by` (FK `users`, set null), `source` (`user` / `system`), `changed_at`, `note` (optional); index `(action_id, changed_at)`; RLS on, no policies |

`createAction` (also used by accepting a recommendation, in the same transaction as the decision) and `updateAction` write the
history row in the transaction that changes the action; `actorId` null means a system change (`source = 'system'`, shown as
"automatically"). `GET /api/actions?teamId=` returns `statusChangedBy {id, name}`, `statusChangedAt` and `history` (newest first)
with each action, read for the action ids of that list only (same company and team scope; names, never e-mails). The UI line and
its date format are in `src/lib/actionHistory.ts`. The migration fills the history only from `audit_log` (`action.create`,
`action.status`) for actions that have none. Sample history: `server/seeds/actionHistory.ts` (run after every demo seed / fill and
in `scripts/reseed/showcase-content.sql`).

## 6. Calculations

All formulas, the calculation engine, forecasts and recommendations: [metrics_and_calculations.md](metrics_and_calculations.md).
Key rules:

- Every KPI value goes through `recordKpiValues` ([`server/lib/kpiIngest.ts`](../server/lib/kpiIngest.ts)).
- The QA score is computed by the database trigger `kpi_snapshots_qa_score` with the same rules as
  `computeQaScore` in [`server/lib/metricFormulas.ts`](../server/lib/metricFormulas.ts).
- Raw data is calculated on arrival and recalculated nightly for recent days.
- Forecasts and recommendations are refreshed per team about once a day (hourly job, with a time budget).
- Hours lost per week (`lost_hours_weekly`, `lost_hours_state`; [`server/lib/lostHours.ts`](../server/lib/lostHours.ts)) are a stored
  calculation over the raw tables, refreshed when a Next move page asks and the rows are due, and nightly. Findings, verdicts
  and data readiness are assembled on request from stored data ([`server/lib/navigator.ts`](../server/lib/navigator.ts),
  [`server/routes/navigator.ts`](../server/routes/navigator.ts)); the Exporter's discovery report is in `exporter_discovery`.
  See [NEXT_MOVE.md](NEXT_MOVE.md), part 3.

## 7. Front end

- No router library: `src/App.tsx` maps views to paths (`/`, `/summary`, `/tv`, `/compare`,
  `/analytics/...`, `/users`, `/teams`, `/departments`, `/activity`, `/user-activity`, `/ingestion-log`,
  `/admin-panel`, `/manual-metrics`, `/metric-intervals`, `/parameters-config`, `/notifications`) and checks
  each view with `canOpenView`. `/operator` is the platform panel; `/reset-password` and the invitation page
  are signed-out screens.
- Themes: Light, Dark, Graphite, Porcelain and Match system, applied on `<html data-theme>` with the `dark`
  class for the dark-based themes ([`src/lib/appearance.ts`](../src/lib/appearance.ts),
  `src/styles/themes.css`). The choice is kept in `localStorage` and applied before the first paint by an
  inline script in `index.html`. Signed-out screens always use the classic Light theme.
- Score display: 3D battery or gauge (`ScoreVisual.tsx`, `ScoreGauge.tsx`), one colour scale
  ([`src/lib/batteryScale.ts`](../src/lib/batteryScale.ts)).
- Live updates: a WebSocket on the Node service (`server/websocket.ts`); not available on Netlify, where
  pages refresh on load and on timers. `VITE_DISABLE_WEBSOCKET` turns it off.

## 8. Tests and CI

- `npm run test:unit` (Jest), `npm run test:api` (API running on port 3000), `npm run test:db`.
- `npm run test:ui:local` runs the Playwright suite against a local test database it prepares itself. Guide:
  [testing/README.md](testing/README.md); flows and tests: [testing/E2E_FLOWS.md](testing/E2E_FLOWS.md).
- GitHub Actions: `.github/workflows/ci.yml` (typechecks, lint report, build; API and database suites on
  Postgres 16 prepared by `scripts/ci/prepare-db.sh`; the `@smoke` UI subset) on every push and pull
  request; `.github/workflows/ui-tests.yml` (the full UI suite in four shards).

---

## Run it locally

Run QE Navigator on your computer in a few minutes. For deployment see
[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

### You need

- Node.js 22 or newer
- PostgreSQL 14 or newer, local (or Docker), or a Supabase project
- `psql` to apply the schema

### Steps

1. **Install.**

   ```bash
   npm install
   cp .env.example .env
   ```

   In `.env` set `DATABASE_URL` (for example a local database `irongate_qa`) and `JWT_SECRET` (any long random
   string). Leave the other variables unset for now.

2. **Create the schema.** Apply every migration in file-name order:

   ```bash
   createdb irongate_qa
   for f in $(ls supabase/migrations/*.sql | sort); do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"; done
   ```

3. **Load demo data** (optional, local databases only):

   ```bash
   npm run seed:demo
   ```

4. **Start the API and the app** (two terminals, or `npm start` for both):

   ```bash
   npm run server    # API on http://localhost:3000
   npm run dev       # app on http://localhost:5173
   ```

5. **Sign in.** Locally the sign-in page shows the demo accounts as chips (`DEMO_MODE` is on by default in
   development). Or click **Create an account** to register your own organisation; you become its super
   admin.

### Next

- Send data: [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) and the scripts in
  [integration-examples/](integration-examples/).
- Find your way around: [USER_GUIDE.md](USER_GUIDE.md).
- Commands at a glance: [Commands, addresses and files at a glance](#commands-addresses-and-files-at-a-glance).
- Run the tests: [testing/README.md](testing/README.md).

E-mail is not sent locally unless you set `RESEND_API_KEY` or `SMTP_HOST`; invitation and reset links are
then written to the API log, and invitation links are shown in the app to copy.


---

## Commands, addresses and files at a glance

Commands, addresses and files used most often. All commands run from the repository root.

### Run

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run server` | API on http://localhost:3000 (restarts on change) |
| `npm run dev` | App on http://localhost:5173 |
| `npm start` | Both of the above |
| `npm run build` | Typecheck and build the app into `dist/` |
| `npm run server:prod` | API and the built app (production mode) |
| `npm run lint` | ESLint |

### Data

| Command | What it does |
|---|---|
| `npm run seed:demo` | Demo company (local databases only unless `--allow-remote`) |
| `npm run seed:demo -- --fill-existing` | A year of sample data for existing teams without data |
| `npm run seed:demo -- --sql out/demo-seed.sql` | The same as SQL files, for a hosted database |
| `npm run seed:demo:check` | Data coverage per company, team and module |
| `npm run seed:demo:clear` | Remove all demo rows |
| `npm run operator:create -- --email … --name "…"` | Create or update a platform operator |
| `scripts/reseed/build.sh` | Build the showcase reseed SQL ([scripts/reseed/README.md](../scripts/reseed/README.md)) |

Schema: apply `supabase/migrations/*.sql` in file-name order with `psql`.

### Test

| Command | What it does |
|---|---|
| `npx tsc --noEmit -p tsconfig.app.json` | Front-end types |
| `npx tsc --noEmit -p tsconfig.server.json` | API types |
| `npm run test:unit` | Jest (all Jest suites) |
| `npm run test:api` | API suites (API must run on :3000) |
| `npm run test:db` | Database suites |
| `npm run test:ui:local` | Full Playwright suite with its own local test database and servers |
| `npm run test:ui:local:smoke` | The `@smoke` subset |
| `npm run playwright:report` | Open the last Playwright report |

### Addresses

| Address | Page |
|---|---|
| `/` | Overview |
| `/summary` | Executive summary |
| `/tv?team=<id>` | TV mode |
| `/compare` | Compare teams |
| `/analytics/...` | Analytics modules (`flaky-tests`, `timeline`, `technical-debt`, `performance`, `pipeline`, `productivity`, `pulse`, `business-impact`, `gamification`, `reports`) |
| `/users`, `/teams`, `/departments` | Administration |
| `/admin-panel`, `/parameters-config`, `/metric-intervals`, `/manual-metrics` | Admin console, Parameters, Update frequency, Manual metrics |
| `/activity`, `/user-activity`, `/ingestion-log` | Logs |
| `/notifications` | Notifications |
| `/operator` | Platform operator panel |
| `/health` | API health check (Node service) |

### Configuration

- `.env` (from `.env.example`): at least `DATABASE_URL` and `JWT_SECRET`. All variable names:
  [DEPLOYMENT_GUIDE.md, section 4](DEPLOYMENT_GUIDE.md#4-environment-variables).
- `netlify.toml`: build, redirects, headers. `railway.json`: Node service.

### Where to look

| Question | Document |
|---|---|
| Who can do what | [ROLE_ACCESS.md](ROLE_ACCESS.md) |
| How a number is calculated | [metrics_and_calculations.md](metrics_and_calculations.md) |
| Which API route | [METRICS_API_INDEX.md](METRICS_API_INDEX.md) |
| How to send data | [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) |
| Everything about the product | [PRODUCT_GUIDE.md](PRODUCT_GUIDE.md) |
| All documents | [README.md](README.md) |


---

## Authentication and authorisation in the code

How sign-in, sessions and access control work in the code. For end users see
[USER_GUIDE.md](USER_GUIDE.md#signing-in-passwords-sessions-and-roles); for the per-role matrix see [ROLE_ACCESS.md](ROLE_ACCESS.md).

### Files

| File | Role |
|---|---|
| `server/routes/auth.ts` | Register, login, logout, `/me`, forgot / reset password, sign out other devices |
| `server/routes/authSso.ts` | Sign-in providers, Google / Microsoft SSO, invitation lookup and acceptance |
| `server/lib/sessions.ts` | Session cookie, lifetime, `user_sessions` rows, `loadAccessContext`, revocation |
| `server/middleware/auth.ts` | `authenticateToken`: verifies the token and loads the current user and assignments |
| `server/middleware/apiKey.ts` | `authenticateApiKey` for `/api/ingest/*` |
| `server/lib/userPolicy.ts` | Every access rule, as pure functions shared by API and UI |
| `server/lib/assignments.ts`, `server/lib/roleAssignment.ts` | Role assignments (grants) |
| `server/middleware/access.ts` | Permission helpers used by routes |
| `server/lib/sso.ts` | OpenID Connect (PKCE, state, nonce, ID token verification) |
| `server/lib/invitations.ts`, `server/lib/passwordReset.ts` | Invitations and reset links |
| `server/lib/authEvents.ts` | Sign-in events (`auth_events`) |
| `server/lib/operator.ts`, `server/routes/operator.ts` | Platform operator accounts and sessions |
| `src/contexts/AuthContext.tsx` | Client session state (`GET /api/auth/me`) |
| `src/lib/viewAccess.ts`, `src/lib/accessSummary.ts` | Pages and navigation; the Help popover |
| `src/lib/passwordPolicy.ts` | Password rules (client and server) |

### Sign-in methods

**Password.** `POST /api/auth/login { email, password, rememberMe }`. The e-mail is matched case-insensitively.
Unknown e-mail, inactive user and wrong password all answer `401 Invalid credentials`. A suspended company
answers `403 { code: "company_suspended" }` only after the right password. Failed attempts are rate limited
per IP (20 per 15 minutes; successful sign-ins do not count). Every attempt is recorded in `auth_events`
(an unknown e-mail only as a keyed hash).

**Registration.** `POST /api/auth/register` creates a new company, its first department and team, and the
person as super admin. A company e-mail domain may be used by one organisation only; public domains
(`src/lib/emailDomains.ts`) never block.

**Invitation.** `GET /api/auth/invitations/:token` describes the invitation; `POST /api/auth/invitations/accept
{ token, firstName, lastName, password }` creates the user with the invited role assignment. Tokens are
stored as hashes, expire after `INVITE_TTL_HOURS` (default 168), can be revoked, and resending replaces the
token.

**Single sign-on.** `GET /api/auth/providers` lists the configured methods. `GET /api/auth/sso/:provider/start`
redirects to Google or Microsoft (authorization code flow with PKCE S256, state and nonce);
`…/callback` verifies the ID token (signature against the provider's keys, issuer, audience, expiry, nonce)
and uses only a verified e-mail. It matches an existing active user (by linked identity, else by verified
e-mail) or an open invitation for that e-mail; it never creates an account otherwise. A provider exists only
when its variables are set: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; `MS_CLIENT_ID`, `MS_CLIENT_SECRET`,
`MS_TENANT`; and `APP_URL` for the redirect URI `<APP_URL>/api/auth/sso/<provider>/callback`.

**Password reset.** `POST /api/auth/forgot-password { email }` always answers the same way; when the user
exists it e-mails a link (`igr_` token, only its hash stored, valid 60 minutes, works once).
`POST /api/auth/reset-password { token, password }` sets the password, clears the lockout fields and ends
all the user's sessions. Both are rate limited.

**Password rules** (registration, invitation, reset): 10 to 128 characters, three of lower case / upper case /
number / symbol, not containing the part of the e-mail before the @.

### Sessions

- A JWT signed with `JWT_SECRET`, carrying the user id and a `jti`, in the httpOnly cookie `irongate_token`
  (`Secure` and `SameSite=Strict` in production, `Lax` in development). The same token is accepted as
  `Authorization: Bearer`.
- Lifetime: the company's "Sign-in lasts" setting, one of 1, 8, 24, 168 (default), 336 or 720 hours
  (`SESSION_LIFETIME_CHOICES`). With "Keep me signed in" the cookie persists for that time; without it the
  cookie is a browser session cookie.
- Each session is a `user_sessions` row (id = `jti`) with issue time, expiry, method, IP, country and last
  seen. `authenticateToken` reads the row in the same query as the user (`loadAccessContext`). A revoked row
  answers `401` with the header `X-Session-Ended`. `last_seen_at` is updated at most every 5 minutes.
- Revocation: sign out everywhere (admin), password change or reset, `POST /api/auth/sessions/sign-out-others`,
  a company suspension, and the operator's **Revoke** on one session.
- In production the API refuses to start without `JWT_SECRET`.

### Authorisation

1. `authenticateToken` loads the user's **current** row and active role assignments on every request. The
   token proves identity only; a deactivated user or a changed assignment takes effect on the next request.
2. Routes check permissions with the shared policy (`server/lib/userPolicy.ts`), for example
   `canViewTeamAnalytics` (the scope rule), `canManageTeam`, `canManageCompanyConfig`, `canOpenUserAdmin`.
3. Every query is limited to the caller's company.
4. The UI uses the same functions (`src/lib/viewAccess.ts`) to show only what the API allows. A page the
   person may not open redirects to the Overview with "You don't have access to …".

Roles and scope:

| Key | Screen name | Scope | Teams in scope |
|---|---|---|---|
| `super_admin` | Super admin | company | all teams of the company |
| `qa_manager` | Manager | department | the department's teams |
| `team_lead` | Team lead | team | that team |
| `qa_engineer` | Software engineer | team | that team |
| `viewer` | Viewer | team | that team |

A person may hold several assignments (`role_assignments`); access is the union. Nobody may change their own
role or manage someone of equal or higher rank.

### API keys

`authenticateApiKey` accepts `Authorization: Bearer igk_…` on `/api/ingest/*`. Keys are created by super
admins (`POST /api/admin/api-keys`), stored as a hash, shown once, and revocable. A suspended company's keys
answer `403 company_suspended`.

### Platform operators

Separate accounts (`platform_operators`), created with `npm run operator:create`. Sign-in at
`POST /api/operator/login` sets the cookie `irongate_operator` with its own token audience; 8-hour session;
lockout for 15 minutes after 5 failures; rate limited per IP; optional `PLATFORM_OPERATOR_ALLOWED_IPS`.
When an operator changes company data, the request runs the company app's handler as a super admin of that
company without a user id. Operator actions are not logged.

### Tests

`tests/api/registration.test.ts`, `password-reset.test.ts`, `sessions.test.ts`, `keep-signed-in.test.ts`,
`sso.test.ts`, `invitations.test.ts`, `auth-events-sessions.test.ts`, `platform-operator.test.ts`,
`role-matrix.test.ts`, `r2-security-matrix.test.ts`, `security.test.ts`, and the UI suites in `tests/e2e/`.
