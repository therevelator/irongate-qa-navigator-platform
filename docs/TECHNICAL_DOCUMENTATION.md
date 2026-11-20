# Technical documentation

Architecture and code map of QE Navigator, for engineers who work on the code. How to run it is in the
[README](../README.md#getting-started) and [QUICK_START.md](QUICK_START.md); how to deploy it in
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
| `docs/` | Documentation; index in [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md) |

Older files in the root (`database/`, `schema_updated.sql`, `local_*.sql`, `setup-aiven.sh`,
`setup_database.sh`, `migrate-users-to-aiven.sh`, `seed_teams_with_metrics.sql`, `update_quality_cowboys.sql`)
belong to the earlier MySQL setup and are not used.

## 3. Request flow

1. The browser calls `/api/...` with the session cookie `irongate_token`. On Netlify the redirect sends it to
   the `api` function; locally Vite's app calls the API on port 3000.
2. `requestContext` assigns a request id (`X-Request-Id`), the client IP and the route pattern.
3. CORS (exact origins), JSON and form parsers (skipped for the raw ingestion routes, which read their own
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
| Alerts and actions | `alert_rules`, `alerts`, `notifications`, `notification_deliveries`, `notification_preferences`, `company_notification_settings`, `team_actions` | `20261121000000…` |
| Wellbeing pulse | `pulse_cadences`, `pulse_participation`, `pulse_responses`, `pulse_links`, `pulse_recipients`, `pulse_sends`, `pulse_settings`, `pulse_nonresponder_days` | `20261121200000…`, `20261122200000…`, `20261123300000…` |
| Views and onboarding | `saved_views`, `onboarding_state` | `20261121100000…` |
| Audit and logs | `audit_log` (Activity), `user_activity`, `server_errors`, `job_runs` | `20261119…`, `20261123…` |
| Platform | `platform_operators`, `platform_operator_sessions`, `demo_data_jobs` (`platform_access_log` exists but is no longer written) | `20261123000000…`, `20261125…`, `20261128…` |
| Analytics modules | `technical_debt`, `flaky_tests`, `test_cases`, `test_executions`, `performance_metrics`, `pipeline_stages`, `pipeline_runs`, `pipeline_execution_summary`, `pipeline_config`, `developer_metrics`, `sprint_velocity`, `business_impact_*`, `configs` | initial |

Row Level Security is enabled on every table with no policies; the app connects as the owner.

## 6. Calculations

All formulas, the calculation engine, forecasts and recommendations: [metrics_and_calculations.md](metrics_and_calculations.md).
Key rules:

- Every KPI value goes through `recordKpiValues` ([`server/lib/kpiIngest.ts`](../server/lib/kpiIngest.ts)).
- The QA score is computed by the database trigger `kpi_snapshots_qa_score` with the same rules as
  `computeQaScore` in [`server/lib/metricFormulas.ts`](../server/lib/metricFormulas.ts).
- Raw data is calculated on arrival and recalculated nightly for recent days.
- Forecasts and recommendations are refreshed per team about once a day (hourly job, with a time budget).

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
