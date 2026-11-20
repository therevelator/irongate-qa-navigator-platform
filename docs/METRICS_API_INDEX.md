# Metrics and API index

Where to find each metric's definition and every API route, by area. Routes are mounted in
[`server/index.ts`](../server/index.ts); on Netlify the same Express app runs in
[`netlify/functions/api.ts`](../netlify/functions/api.ts) behind the `/api/*` redirect in `netlify.toml`.

## Metric definitions

| Topic | Document |
|---|---|
| Every formula, with the code that computes it | [metrics_and_calculations.md](metrics_and_calculations.md) |
| Every metric: meaning, target, update interval, production source | [PRODUCT_GUIDE.md, section 3](PRODUCT_GUIDE.md#3-the-metrics) |
| Units, ranges and keys accepted by the ingestion APIs | [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) |
| CI/CD pipeline page and pipeline metrics | [CI_CD_PIPELINE_METRICS.md](CI_CD_PIPELINE_METRICS.md) |
| Flaky tests | [flaky_test_intelligence.md](flaky_test_intelligence.md) |
| Business impact correlations and revenue impact | [business_impact_correlation.md](business_impact_correlation.md) |

Code that defines metrics: `KPI_COLUMNS` in [`server/lib/kpiIngest.ts`](../server/lib/kpiIngest.ts) (writable
KPI columns), `METRICS_CONFIG` in [`src/config/metricsConfig.ts`](../src/config/metricsConfig.ts) (default
targets), [`server/lib/metricFormulas.ts`](../server/lib/metricFormulas.ts) (shared formulas),
[`src/data/metricCatalog.ts`](../src/data/metricCatalog.ts) (labels and descriptions),
[`server/lib/calc/`](../server/lib/calc/) (calculation engine).

## Authentication

- **Ingestion routes** (`/api/ingest/*`) take an API key: `Authorization: Bearer igk_…`. Keys are created by a
  super admin in the Admin console (API keys) and are stored only as a hash.
- **All other routes** take the session: the httpOnly cookie `irongate_token`, or the same token as a
  bearer header. Access follows the caller's role assignments ([ROLE_ACCESS.md](ROLE_ACCESS.md)).
- **Platform operator routes** (`/api/operator/*`) take the operator session cookie `irongate_operator`.

## Routes

### Ingestion (API key)

| Route | Purpose |
|---|---|
| `POST /api/ingest/tests` | Test reports: JUnit XML, TRX, Cucumber JSON; v2 phase 1 |
| `POST /api/ingest/coverage` | Coverage reports: LCOV, Cobertura, JaCoCo, Istanbul (final and summary); v2 phase 1 |
| `POST /api/ingest/pipelines` | Pipeline runs with stages; v2 phase 1 |
| `POST /api/ingest/deployments` | Deployments; v2 phase 2 |
| `POST /api/ingest/commits` | Commits of a deploy (lead time); v2 phase 2 |
| `POST /api/ingest/incidents` | Incidents (MTTR, MTBF, availability); v2 phase 2 |
| `POST /api/ingest/issues` | Issues from Jira, Linear or JSON; v2 phase 3 |
| `POST /api/ingest/static-analysis` | SARIF 2.1.0 reports; v2 phase 3 |
| `POST /api/ingest/kpis` | Finished KPI values, for metrics with no raw source yet |

### Raw data evidence and CI setup (`server/routes/ci.ts`)

| Route | Purpose |
|---|---|
| `GET /api/ci/teams/:id/evidence` | Flaky tests with the runs that prove them, lowest-coverage files, slow stages |
| `GET /api/ci/teams/:id/metrics/:metric` | How this was calculated: formula, inputs, source records |
| `GET /api/ci/teams/:id/delivery` | Deliveries and incidents behind the DORA metrics |
| `GET /api/ci/teams/:id/work` | Work and code quality evidence |
| `GET /api/ci/status` | Connect your CI: last data received per team and kind |
| `PUT /api/ci/teams/:id/main-branch` | Set a team's main branch |
| `GET`, `PUT /api/ci/services`, `DELETE /api/ci/services/:service` | Service (or project key) → team mapping |

### Forecasts and recommendations (`server/routes/improve.ts`)

| Route | Purpose |
|---|---|
| `GET /api/improve/teams/:id` | Forecasts and recommendations of a team |
| `POST /api/improve/teams/:id/refresh` | Recalculate now (rate limited) |
| `POST /api/improve/recommendations/:id/accept` | Add to Action plan |
| `POST /api/improve/recommendations/:id/dismiss` | Dismiss with a reason |
| `POST /api/improve/recommendations/:id/reopen` | Reopen a dismissed recommendation |

### Summary and TV mode

| Route | Purpose |
|---|---|
| `GET /api/summary` | Executive summary of the caller's scope |
| `GET /api/tv/teams`, `GET /api/tv/teams/:id` | TV mode team picker and team view |

### Teams, metrics and analytics

| Route | Purpose |
|---|---|
| `GET /api/teams`, `GET /api/teams/:id`, `GET /api/teams/:id/kpi-history` | Teams in scope, team detail, KPI history |
| `GET /api/teams/:id/ai-suggestions`, `…/developer-ai-suggestions` | Team and developer suggestions (rule-based fallback, language model when configured) |
| `POST /api/teams`, `PUT /api/teams/:id`, `PATCH /api/teams/:id/ai-toggle` | Create and edit teams |
| `GET /api/metrics/teams/:teamId`, `…/history`, `…/velocity`, `GET /api/metrics/dashboard` | KPI reads |
| `POST /api/metrics/manual`, `POST /api/metrics/developer` | Manual metrics (session, not API key) |
| `GET /api/analytics/company-summary` | Overview summary of the caller's scope |
| `POST /api/analytics/company-insights` | Executive briefing (needs `GROQ_API_KEY`) |
| `GET /api/analytics/scope` | Teams the caller may pick in Analytics |
| `GET /api/analytics/flaky-tests`, `/test-executions`, `/performance-metrics`, `/developer-metrics`, `/technical-debt` | Analytics modules |
| `GET`, `PUT /api/analytics/pipeline-config`, `GET /api/analytics/pipeline-history`, `GET /api/analytics/pipeline-stages`, `PUT /api/analytics/pipeline-stages/:id` | CI/CD pipeline page |
| `GET /api/analytics/business-impact-v2/:teamId` and its `POST` sub-routes | Business impact data and correlations |
| `GET /api/revenue-impact/teams/:teamId`, `…/what-if`, `GET /api/revenue-impact/rollup` | Revenue impact |
| `GET /api/compare/teams`, `GET /api/compare/teams.csv` | Compare teams |
| `GET`, `PUT /api/targets` | KPI targets with history |

### Alerts, notifications, actions, pulse

| Route | Purpose |
|---|---|
| `GET /api/alerts`, `POST /api/alerts/:id/acknowledge`, `GET`, `PUT /api/alerts/rules`, `POST /api/alerts/evaluate` | Alerts and alert rules |
| `GET /api/notifications`, `…/unread-count`, `…/preferences`, `…/settings`, `…/digest/preview` | Notifications, Slack and weekly digest settings |
| `GET`, `POST /api/actions`, `PATCH`, `DELETE /api/actions/:id`, `GET /api/actions/owners` | Tracked actions (Action plan) |
| `GET /api/pulse/pending`, `GET /api/pulse/teams/:teamId`, `POST …/responses`, `…/send`, `…/remind`, `PUT …/cadence`, `…/auto-send`, `…/settings` | Wellbeing pulse |

### Organisation and administration

| Route | Purpose |
|---|---|
| `/api/admin/users`, `/api/admin/teams`, `/api/admin/departments` | Users, teams, departments (create, edit, delete) |
| `/api/admin/users/:id/assignments` | Role assignments |
| `/api/admin/invitations` | Invitations (create, resend, revoke) |
| `/api/admin/audit`, `POST /api/admin/audit/:id/undo` | Change history (Activity) and undo |
| `/api/admin/api-keys` | API keys (create, revoke) |
| `/api/admin/configs`, `GET`, `PUT /api/admin/session-settings` | Parameters and sign-in length |
| `/api/settings/metric-intervals` | Expected update frequency |
| `GET /api/ingestion-log`, `…/sources`, `…/:id` | Ingestion log |
| `GET /api/activity/log`, `…/log.csv`, `POST /api/activity/screen` | User activity log |
| `/api/saved-views`, `/api/onboarding` | Saved views and the onboarding checklist |
| `GET /api/users/:id`, `PUT /api/users/:id` | Own profile |

### Sign-in

| Route | Purpose |
|---|---|
| `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | Registration and sessions |
| `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` | Password reset by e-mail |
| `POST /api/auth/sessions/sign-out-others` | Sign out other devices |
| `GET /api/auth/providers`, `GET /api/auth/sso/:provider/start`, `…/callback` | Single sign-on (Google, Microsoft) |
| `GET /api/auth/invitations/:token`, `POST /api/auth/invitations/accept` | Accept an invitation |

### Platform operator (`server/routes/operator.ts`)

Sign-in (`/api/operator/login`, `/session`, `/logout`), overview, errors, sign-in events, and per company
(`/api/operator/companies/:companyId/…`): summary, organisation, users and a person's page, sessions,
sign-ins, last views, settings, data, modules, alerts, pulse, the company's change history and user
activity, errors; create, edit, suspend, reactivate and delete companies; everything the company app
offers, through its own handlers; demo data and Populate metrics. Details: [ADMIN_PANEL_GUIDE.md](ADMIN_PANEL_GUIDE.md).

### Health

`GET /health`: status of the API (no authentication).
