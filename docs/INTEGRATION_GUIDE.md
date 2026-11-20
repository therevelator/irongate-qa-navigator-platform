# IronGate QE Navigator: Developer Integration Guide

For developers at client companies who connect their tools (CI, issue tracker, code analysis, test management,
incident management, finance / BI) to IronGate QE Navigator so that every screen of the platform is filled
with real data.

> **Source of truth.** Every path, field, unit, range, rule and status code in this guide was checked against
> the code (commit `25e471b`, 2026-11-18) and, where marked "verified", exercised against a local instance
> (section 12). If this guide and the code ever disagree, the code wins: the files are named next to each rule.
> The business-impact / revenue-impact endpoints are being actively developed; see section 11.

---

## Contents

1. [Overview: what data each screen needs](#1-overview-what-data-each-screen-needs)
2. [Before you start: base URL, team ids, environments](#2-before-you-start-base-url-team-ids-environments)
3. [Authentication](#3-authentication)
4. [The KPI ingestion API (reference)](#4-the-kpi-ingestion-api-reference)
   - 4A. [Raw ingestion: tests, coverage, pipelines (v2)](#4a-raw-ingestion-tests-coverage-pipelines-v2)
5. [All other data: how it can be sent today](#5-all-other-data-how-it-can-be-sent-today)
6. [Code: curl, Node.js, Python, retries, batching, backfill](#6-code-curl-nodejs-python-retries-batching-backfill)
7. [Recipes per source system](#7-recipes-per-source-system)
8. [CI examples: GitHub Actions, Jenkins, GitLab CI](#8-ci-examples-github-actions-jenkins-gitlab-ci) (8.4: raw reports per CI tool, also Azure DevOps)
9. ["Populate everything" checklist and end-to-end script](#9-populate-everything-checklist-and-end-to-end-script)
10. [Verifying and troubleshooting](#10-verifying-and-troubleshooting)
11. [Security and data protection](#11-security-and-data-protection)
12. [Gaps: not yet available via API](#12-gaps-not-yet-available-via-api)
13. [Endpoints in flux](#13-endpoints-in-flux)
14. [Appendix: example files and verification log](#14-appendix-example-files-and-verification-log)

---

## 1. Overview: what data each screen needs

IronGate has **one external write API**: `POST /api/ingest/kpis`, authenticated with a company API key. It
accepts the **23 team KPIs** (section 4.3). Everything computed from those KPIs (QA score, DORA level, targets,
staleness, alerts, company aggregates, rankings, TV mode, PDF report, CSV export) fills itself once the KPIs
arrive. Everything else is entered in the app, written by internal (browser-session) endpoints, comes from the
pulse survey, or **has no write path at all yet** (section 12).

There are **no built-in connectors**: IronGate never pulls from Jira, Jenkins and so on. You run a small job or a CI
step that reads your tools and pushes to IronGate.

Legend for "How to send it": **API** = `POST /api/ingest/kpis` with an API key (supported, versioned behaviour,
logged); **UI** = entered by a person in the app; **Session** = an internal endpoint the web app uses, callable
by a script that logs in as a user (section 3.6, caveats apply); **None** = no write path, only sample data.

| Screen (path) | Data it needs | How to send it | Typical source systems |
|---|---|---|---|
| **Overview / dashboard** (`/`) | Team KPIs (QA score inputs: test coverage, defect escape rate, change failure rate, code quality; automation coverage; flakiness); the four DORA KPIs; pipeline runs (pipeline health); technical debt items (tech debt health); pulse survey answers (wellbeing); developer metrics (workload balance) | KPIs: **API**. Pipeline runs: **None**. Debt items: **None** (impact fields: UI / Session). Pulse: people answer in the app. Developer metrics: **UI / Session** | SonarQube, JaCoCo / Istanbul, Jira, TestRail / Xray, GitHub / GitLab / Jenkins / Argo CD, PagerDuty / Opsgenie |
| **Teams, Team detail** (`/teams`) | All 23 KPIs with provenance and staleness; QA score; DORA level; technical debt score; developer summary | KPIs: **API**; developer metrics: **UI / Session**; debt: see above | as above |
| **Team TV mode** (`/tv`), **Compare teams** (`/compare`), **Team rankings**, **Reports** (PDF), **CSV export**, **Saved views** | Team KPIs (the PDF uses 14 of them), QA score | **API** | as above |
| **Notifications / alerts** (`/notifications`) | Derived: KPI off target, metric stale, QA score drop, ingestion failures | Nothing to send: evaluated after every KPI write and hourly | — |
| **Analytics → Flaky tests** (`/analytics/flaky-tests`) | Flaky tests (`flaky_tests`) and per-test execution history (`test_executions`) | **None** | JUnit XML across reruns, Jenkins / GitHub Actions, a flaky-test detector |
| **Analytics → Test execution** (`/analytics/timeline`) | Suite runs (`test_execution_runs`) | **None** | CI test reports, TestRail / Xray runs |
| **Analytics → Technical debt** (`/analytics/technical-debt`) | Debt items (`technical_debt`); per-item ROI inputs; financial settings | Items: **None**. ROI inputs and effort: **UI** (Manual metrics → Technical Debt ROI Impact) / **Session**. Financial settings: **UI** (Parameters) / **Session** | SonarQube issues / technical debt, Jira issues labelled as debt, finance |
| **Analytics → Performance** (`/analytics/performance`) | Daily p50 / p95 / p99, throughput, error rate per endpoint (`performance_metrics`); SLA thresholds | Measurements: **None**. Thresholds: **UI** (Parameters → Performance SLA) / **Session** | k6, JMeter, Gatling, Datadog / New Relic APM |
| **Analytics → CI/CD pipeline** (`/analytics/pipeline`) | Pipeline stages (`pipeline_stages`), stage execution history (`pipeline_execution_summary`), cost settings | Stages: edit existing only, **UI / Session**; history: **None**; cost settings: **UI / Session** | Jenkins / GitHub Actions / GitLab stage timings |
| **Analytics → Developer productivity** (`/analytics/productivity`) | Current developer metrics (`developer_metrics`); DDPS history (`developer_productivity_snapshots`); opt-in flags | Current metrics: **UI / Session**. History: **None**. Opt-in: **UI** (Users page) | GitHub / GitLab PR timings, Google Calendar / Microsoft 365, issue tracker |
| **Analytics → Wellbeing pulse** (`/analytics/pulse`) | Anonymous survey answers | People answer in the app; deliberately **no import** | — |
| **Analytics → Business impact** (`/analytics/business-impact`: Money, What-if, Details, All teams) | Monthly quality metrics, monthly business KPIs, monthly context (downtime, incidents), open debt items, financial settings, KPI targets | Monthly data: **UI** (the page) / **Session**. Debt and settings: see above | Finance / BI (revenue), Amplitude / Mixpanel (active users, adoption), CRM / billing (churn), survey tools (NPS, CSAT), Zendesk / ServiceNow (tickets), PagerDuty / Opsgenie (downtime) |
| **Administration → Ingestion log** (`/ingestion-log`) | Every KPI write request | Automatic | — |

Configuration that changes how data is judged (not data itself): KPI targets, update frequency (staleness),
financial and SLA settings, pipeline cost settings, alert rules (section 5.9).

---

## 2. Before you start: base URL, team ids, environments

**Base URL.** All endpoints are under `https://<your-instance>/api`. Examples use `IRONGATE_URL`, which **includes**
`/api`, e.g. `IRONGATE_URL=https://qe.example.com/api`. (On the Netlify deployment the same routes also answer without
the `/api` prefix; use `/api` everywhere.) The health check is `GET https://<your-instance>/health` (no `/api`).

**Team ids.** Every KPI belongs to one team, identified by its id (a string such as `team-1795033040840-eenlsowsl`;
demo teams look like `demo-team-checkout`). The API key cannot list teams. Get the ids once and keep them in your job's
configuration:

- In the app (super admins): Team detail → switch on **Show formulas & data sources** → click any metric: the information dialog
  shows a ready-made ingestion example containing that team's id.
- With a signed-in session (section 3.6): `GET /api/teams` → `{ "teams": [ { "id", "name", "department", "department_id", … } ] }`
  (the teams the user may see).

**Environments.** Use a test company (or a test instance) for development. The demo company ("Northwind Payments
(Sample data)") created by `npm run seed:demo` is a convenient sandbox; values carry the source `synthetic` and
screens show "Includes sample data". Do not point a development job at production teams: there is no delete endpoint
for KPI values (a wrong value can only be corrected, section 4.5).

**One value per team, not per repository.** KPIs are team-level. If a team owns several repositories or pipelines,
aggregate first (e.g. coverage of the main service, or a lines-weighted mean) and send one value.

---

## 3. Authentication

### 3.1 API keys (for the ingestion API)

| | |
|---|---|
| Who can create, list and revoke | **Super admins only** (`isCompanyAdmin`; others get `403 Super admin access required`). Code: `server/routes/admin.ts`. |
| Where in the UI | **Admin console** (`/admin-panel`) → **API keys**: enter a name (1–100 characters, e.g. `jenkins-prod`), **Create**. |
| What you get | The key, shown **once**: `igk_` followed by 43 base64url characters (32 random bytes). Only its SHA-256 hash and the first 12 characters (`keyPrefix`, e.g. `igk_quheNIvs`) are stored. A lost key cannot be recovered: create a new one. |
| Scope | One company. The key can write KPIs for **any team of that company** and nothing else: it cannot read data, cannot call any other endpoint, and cannot write another company's teams (`403`). |
| Expiry | None. Keys are valid until revoked. The list shows **last used** (updated on every authenticated request), creator and revocation time. |
| Audit | Creation and revocation are recorded in the Activity history (`api_key.create`, `api_key.revoke`). Each ingestion log entry names the key (name and prefix) that sent it. |

The same actions as API calls (session-authenticated super admin; useful for automation of key rotation):

```http
GET  /api/admin/api-keys                       → { "keys": [ { id, name, keyPrefix, createdAt, createdBy, lastUsedAt, revokedAt } ] }
POST /api/admin/api-keys        { "name": "jenkins-prod" }
                                               → 201 { "key": { … }, "plaintextKey": "igk_…" }
POST /api/admin/api-keys/:id/revoke            → { "key": { …, "revokedAt": "…" } }   (404 if not in your company)
```

### 3.2 Sending the key

```http
Authorization: Bearer igk_<43 characters>
Content-Type: application/json
```

- Missing header or a token not starting with `igk_` → `401 {"error":"API key required (Authorization: Bearer igk_…)"}`.
- Unknown or revoked key → `401 {"error":"Invalid or revoked API key"}`.
- A session token (JWT) is not accepted by the ingestion endpoint, and an API key is not accepted by any other endpoint.

### 3.3 Rotation and revocation

1. Create a new key (name it with a date or version, e.g. `jenkins-prod-2026-11`).
2. Update the secret in your CI / job secret store and redeploy the jobs.
3. Watch **last used** of the new key appear and the old key's stop moving (or check the ingestion log: each entry shows
   the key).
4. Revoke the old key. Revocation is immediate: the next request with it gets `401`. It cannot be undone (create a new
   key instead).

Rotate at least yearly, when someone with access to the secret leaves, and immediately if a key may have leaked (it
appeared in a log, a repository, a ticket or a chat). Prefer **one key per integration** (Jenkins, Jira job, SonarQube
job, …): you can then revoke one without touching the others, the per-key rate limit is not shared, and the ingestion log
tells you which integration sent what.

### 3.4 Rate limits and size limits

| Limit | Value | Response when exceeded |
|---|---|---|
| Ingestion requests per API key | **60 per minute** (counted per key hash; without a key, per client IP) | `429 {"error":"Ingestion rate limit reached (60 requests per minute per key). Batch several teams into one request."}` with `Retry-After` and `RateLimit-*` headers |
| All `/api` requests per client IP | 300 per minute (`API_RATE_LIMIT_MAX` on the server) | `429 {"error":"Too many requests, please slow down."}` |
| Failed logins (session auth) | 20 per 15 minutes per IP | `429` |
| Items per request | 1 to 100 | `400 Send between 1 and 100 items` |
| Request body | 100 kB of JSON (Express default). 100 items with all 23 metrics and a short `sourceRef` are about 75 kB. | `413` (body `{"error":"Payload too large"}`) |

Every ingestion response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` (seconds). On the serverless
(Netlify) deployment the counters are per warm instance, so treat the limits as the ceiling, not a guarantee. Stay well below
them by **batching** (many teams and days in one request, section 6.5).

### 3.5 Transport

- Always use **HTTPS**. TLS is terminated by the hosting platform (Netlify, Railway or your proxy); the API itself does not
  redirect HTTP to HTTPS, so make sure your `IRONGATE_URL` starts with `https://`.
- Call the API **server to server** only. Never put an API key in browser code, a mobile app or a public repository.
  (Browser calls from other origins are not allowed by CORS anyway.)

### Role values

Role values in API payloads and responses stay **`super_admin`, `qa_manager`, `team_lead`, `qa_engineer`,
`viewer`**. The app shows them as Super admin, **Manager** (`qa_manager`), Team lead, **Software
engineer** (`qa_engineer`) and Viewer. Only the names on screen changed; send and expect the keys.

### 3.6 Session authentication (internal endpoints only)

The endpoints in section 5 that are marked **Session** authenticate a **user**, not an API key:

```bash
# 1. Log in (email + password; SSO-only accounts cannot do this)
curl -sS -c cookies.txt -X POST "$IRONGATE_URL/auth/login" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$IRONGATE_USER\",\"password\":\"$IRONGATE_PASSWORD\"}"
# 2. Call an endpoint with the session cookie (httpOnly cookie irongate_token; valid as long as the company's
#    "Sign-in lasts" setting, default 7 days) ...
curl -sS -b cookies.txt "$IRONGATE_URL/teams"
# ... or with the same token as a bearer header
curl -sS -H "Authorization: Bearer $SESSION_JWT" "$IRONGATE_URL/teams"
```

Caveats, read them before you automate anything this way:

- These endpoints are **what the web app calls**. They are not a public, versioned API and may change with any release.
- They run with the **permissions of that user** (role and scope, section 5 names the roles). Use a dedicated account with the
  smallest role that works (usually a manager of the department, or a team lead for one team), a long random password from
  your secret store, and nothing else on it.
- Writes through them are **not** recorded in the ingestion log and are **not** idempotent. Developer metrics, debt impact and
  business impact values are range-checked: an out-of-range or non-numeric value is `400` with the field named (since R2 Phase 4).
- `POST /api/auth/logout` only clears the cookie. To end every session of the account, use "Sign out everywhere" (Users) or
  reset its password; deactivating the user also stops it at once (the server reloads the user on every request).
- A session older than the company's "Sign-in lasts" setting (Parameters, default 7 days) is refused. Either case answers
  `401 {"error": …, "code": "session_ended" | "session_expired"}`: sign in again.
- A forgotten password of that account is reset by e-mail: `POST /auth/forgot-password {"email": …}` (always `200`, the same
  message whether or not the account exists) e-mails a link valid for 60 minutes; `POST /auth/reset-password {"token", "password"}`
  sets the new password. A reset ends every session already issued for the account.
- Invalid or expired session token: `403 {"error":"Invalid or expired token"}`; none: `401 {"error":"Access token required"}`.

---

## 4. The KPI ingestion API (reference)

Code: `server/routes/ingest.ts` (endpoint), `server/lib/kpiIngest.ts` (validation and write path),
`server/lib/ingestionLog.ts` (idempotency and log), `server/lib/metricValues.ts` (storage),
migration `supabase/migrations/20261120000000_metric_values_targets_ingestion_log.sql`.

### 4.1 Endpoint

```
POST /api/ingest/kpis[?partial=true]
Authorization: Bearer igk_…
Content-Type: application/json
Idempotency-Key: <optional, 1–200 chars: letters, digits, _ - . :>
```

Body: **one item** (object) or **an array of 1–100 items**.

```json
{
  "teamId": "team-1795033040840-eenlsowsl",
  "source": "sonarqube",
  "recordedAt": "2026-11-18T06:00:00Z",
  "metrics": { "test_coverage": 78.4, "code_quality_score": 82 },
  "idempotencyKey": "sonar:pay-service:analysis-AY8x2",
  "sourceRef": "https://sonar.example.com/dashboard?id=pay-service"
}
```

### 4.2 Item fields

| Field | Required | Type and rules | Notes |
|---|---|---|---|
| `teamId` | yes | non-empty string; the team must belong to the key's company | Unknown id and another company's team are answered the same way: `Team <id> is not accessible with this API key` (403). |
| `source` | yes | 1–50 characters after trimming and lower-casing; must match `^[a-z0-9][a-z0-9_.-]{0,49}$` | Your system's name: `jenkins`, `github-actions`, `gitlab-ci`, `jira`, `sonarqube`, `testrail`, `pagerduty`, `dora-job`… Shown as provenance on Team detail ("source · as of date") and grouped in the ingestion log. **`manual` is reserved** (Manual metrics in the app). Avoid `synthetic`: it marks sample data and makes the UI show "Includes sample data". |
| `metrics` | yes | object `{ <metric key>: number }`, at least one non-empty value | Keys from section 4.3. Numbers or numeric strings (`"78.4"`). `null`, absent or `""` = "not provided": skipped, **never clears** a stored value. |
| `recordedAt` | no | ISO 8601 timestamp (with `Z` or an offset) | The time the values are **for** (the measurement time), not the sending time. Default: now. At most 5 minutes in the future; at most **365 days** in the past. |
| `idempotencyKey` | no | 1–200 characters: letters, digits, `_ - . :`; must start with a letter or digit | Per item: if any value was ever stored for this **team** with this key, the item is skipped and reported as `duplicate` (section 4.6). |
| `sourceRef` | no | string, at most 500 characters | Free text pointing to the origin: build URL, job id, JQL. Stored with each value. |

Any other field on an item is refused: `Unexpected field(s): test_coverage (metric values go inside "metrics")`.
`qa_score`, `qaScore` and `status` are refused inside `metrics`: they are **computed** by the database from the inputs.

### 4.3 Metric keys

All 23 writable KPIs (`KPI_COLUMNS` in `server/lib/kpiIngest.ts`). **Range** is what the API accepts (inclusive);
**integer** columns are rounded to the nearest whole number *before* the range check (e.g. `8.6` is stored as `9`).
**Default target / watch** come from `METRICS_CONFIG` (`src/config/metricsConfig.ts`) and can be overridden per company,
department or team (section 5.9). **Expected interval** is the default of **Administration → Update frequency**
(`DEFAULT_METRIC_INTERVALS`, `server/lib/metricIntervals.ts`; a month = 30 days): a value older than its interval is
**stale** (greyed, "Stale since …", not judged against its target, left out of the QA score and company aggregates).
**Send each metric at least as often as its interval**, or change the interval for your company.

#### Quality and testing

| Key | Meaning and formula (computed at the source) | Unit | Accepted range | Better | Default target / watch | Expected interval |
|---|---|---|---|---|---|---|
| `test_coverage` | covered executable lines ÷ executable lines × 100 | % | 0–100 | higher | ≥ 80 / ≥ 70 | 1 day |
| `test_flakiness_rate` | flaky test runs ÷ all test runs × 100 (flaky = failed and passed on the same commit) | % | 0–100 | lower | ≤ 2 / ≤ 5 | 1 day |
| `defect_density` | confirmed bugs in the period ÷ (lines of code ÷ 1,000) | defects / KLOC | 0–999.999 | lower | ≤ 0.5 / ≤ 1.0 | 1 week |
| `defect_escape_rate` | bugs found in production ÷ all bugs found × 100 | % | 0–100 | lower | ≤ 5 / ≤ 10 | 1 week |
| `code_quality_score` | e.g. SonarQube ratings: Maintainability × 0.40 + Reliability × 0.35 + Security × 0.25, A=100 … E=20 | score | 0–100, **integer** | higher | ≥ 80 / ≥ 60 | 1 day |
| `automation_coverage` | automated test cases ÷ all test cases × 100 | % | 0–100 | higher | ≥ 70 / ≥ 50 | 1 week |
| `automation_roi` | (time saved − time invested) ÷ time invested × 100 | % | −9,999.99 to 9,999.99 | none (no target, no colour) | — | 1 month |

#### Speed and efficiency

| Key | Meaning and formula | Unit | Accepted range | Better | Default target / watch | Expected interval |
|---|---|---|---|---|---|---|
| `avg_build_time_minutes` | sum of build durations ÷ number of builds (send a rolling mean, not one build) | minutes | 0–100,000, **integer** | lower | ≤ 10 / ≤ 20 | **1 hour** |
| `test_execution_time_minutes` | duration of the full automated suite | minutes | 0–100,000, **integer** | lower | ≤ 15 / ≤ 30 | **1 hour** |
| `deployment_frequency_per_week` | successful production deployments ÷ weeks in the period | per week | 0–9,999.99 | higher | ≥ 5 / ≥ 2 | 1 week |
| `lead_time_days` | mean(production deploy time − commit time) over changes deployed | days | 0–99.99 | lower | ≤ 3 / ≤ 7 | 1 day |
| `mttr_hours` | Σ(recovery time − incident start) ÷ incidents | hours | 0–9,999.99 | lower | ≤ 2 / ≤ 8 | 1 day |
| `parallel_test_efficiency` | (sequential time ÷ parallel wall-clock time) ÷ workers × 100 | % | 0–100 | higher | ≥ 80 / ≥ 60 | 1 day |

#### Agile and process

| Key | Meaning and formula | Unit | Accepted range | Better | Default target / watch | Expected interval |
|---|---|---|---|---|---|---|
| `sprint_velocity` | story points of issues Done at sprint close | points | 0–100,000, **integer** | none (compare with the team's own history) | — | 2 weeks |
| `sprint_commitment_rate` | completed points ÷ points committed at sprint start × 100 (can exceed 100) | % | 0–999.99 | higher | ≥ 90 / ≥ 75 | 2 weeks |
| `sprint_carryover` | points not completed at close ÷ committed points × 100 | % | 0–100 | lower | ≤ 10 / ≤ 20 | 2 weeks |
| `first_time_pass_rate` | stories with 0 QA rejections ÷ stories tested × 100 | % | 0–100 | higher | ≥ 85 / ≥ 70 | 1 day |
| `blocked_time_hours` | Σ(unblocked − blocked) over the sprint's tickets | hours | 0–100,000, **integer** | lower | ≤ 4 / ≤ 12 | 1 day |
| `sizing_accuracy` | actual effort ÷ estimated effort (1.0 = perfect) | ratio | 0–99.99 | closer to 1.0 (no stored target; Team detail colours ±0.15 / ±0.3) | — | 2 weeks |

#### Reliability and stability

| Key | Meaning and formula | Unit | Accepted range | Better | Default target / watch | Expected interval |
|---|---|---|---|---|---|---|
| `change_failure_rate` | deployments that caused a failure ÷ all deployments × 100 | % | 0–100 | lower | ≤ 5 / ≤ 15 | 1 week |
| `mtbf_hours` | operational hours ÷ failures | hours | 0–1,000,000, **integer** | higher | ≥ 720 / ≥ 168 | 1 week |
| `system_availability` | (total time − downtime) ÷ total time × 100 (3 decimals stored, 100.000 allowed) | % | 0–100 | higher | ≥ 99.9 / ≥ 99 | 1 day |
| `infrastructure_failures` | test / pipeline failures caused by infrastructure in the period | count | 0–100,000, **integer** | lower | ≤ 1 / ≤ 3 | 1 week |

**What the KPIs feed** (so you know which ones matter most):

- **QA score** (0–100, needs `test_coverage` plus at least one more of the four):
  coverage × 0.30 + (100 − escape rate) × 0.25 + (100 − change failure rate) × 0.25 + code quality × 0.20, renormalised over the
  inputs present. Good ≥ 85, warning ≥ 70.
- **DORA level** (Elite / High / Medium / Low; "Unknown" unless **all four** of `deployment_frequency_per_week`, `lead_time_days`,
  `change_failure_rate`, `mttr_hours` are recorded; on the dashboard they must also be current, i.e. not stale) → **Delivery performance** on the dashboard → 35 % of **Engineering health**.
- Company averages on the dashboard: coverage, escape rate, automation coverage, flakiness (weighted by team size, current values only).
- Team detail, TV, Compare, Rankings, PDF report (14 KPIs), alerts (*KPI off target*, *Metric stale*, *QA score drop*).

### 4.4 How values are stored: recordedAt, backfill, carry-forward

Every accepted value becomes one row in `metric_values` (team, metric, value, `recorded_at` = your `recordedAt`, `received_at`,
source, actor `api_key:<key id>`, idempotency key, `sourceRef`, ingestion log id). The daily view `kpi_snapshots` is then
re-derived: **a snapshot day holds, for each metric, the latest non-superseded value recorded before the end of that UTC day.**

Consequences you should design for:

- **Partial updates are normal.** Send only the metrics a system knows (SonarQube sends coverage and code quality, Jira sends defect
  metrics …). The other metrics stay as they are; on later days they are *carried forward* (their provenance keeps the original
  `recorded_at`, so staleness still works).
- **Backfilling** (up to 365 days): send items with past `recordedAt`. The value updates that day's snapshot and every later day on
  which no newer value exists; a newer value always keeps winning on its own days, so a backfill never overwrites current data. A day
  that had no snapshot gets one; days in between that you did not send do **not** get one.
- **The snapshot day is the UTC date** of `recordedAt`. A value "for Monday" in Asia sent as `2026-11-16T01:00:00+09:00` lands on
  Sunday 2026-11-15 (UTC). For daily values use a fixed UTC time, e.g. `YYYY-MM-DDT23:59:00Z` (end of that day) for past days.
- **Staleness is measured from `recordedAt`**, not from when you sent it. Backfilled old values are stale for "today" (correct) but
  current for their own days in history charts.

### 4.5 Corrections

There is no delete. To correct a value, send the **same team, metric and exact same `recordedAt`** again with the right value: the
earlier row is marked *superseded* and the snapshots are recomputed. (Do not reuse the per-item `idempotencyKey` of the wrong item:
that would make the correction a skipped duplicate; use a new key or none.) A value with a *different* `recordedAt` is not a
correction but a new measurement; the latest one per day wins.

*Verified:* sending `avg_build_time_minutes: 12` and then `13` for `2026-11-15T12:00:00Z` left one current row (13) and one
superseded row (12); the 2026-11-15 snapshot showed 13.

### 4.6 Idempotency: two mechanisms

| | `Idempotency-Key` **header** (per request) | `idempotencyKey` **field** (per item) |
|---|---|---|
| Purpose | Make **retries** of the same HTTP request safe | Never store the same **logical measurement** twice, across requests |
| Scope | Your company + the API key that sent it; no expiry | The team; no expiry; any metric |
| Same key, same body | Stored response returned with header `Idempotent-Replayed: true`, nothing written (also for partial / 207 results) | Item skipped, reported `status: "duplicate"`, `result.duplicate: true`, `updated: []` |
| Same key, different body | `422 {"error":"This Idempotency-Key was already used with a different request"}` | **Still skipped** as duplicate, even if values differ |
| Rejected request (400/403/500) | Does **not** bind the key: fix the request and retry with the same key | Nothing is stored, so the key is not used |
| Concurrent duplicates | The second waits for the first and replays it | Serialised per team |

Recommended:

- Always send an `Idempotency-Key` header and **reuse it on every retry of that request**. A good key is a hash of the canonical body
  (the examples in section 6 do this) or `<source>:<job>:<run id>`. Because the key never expires, **include `recordedAt` in the body**
  when the key is derived from the body; otherwise tomorrow's identical-looking request would be replayed instead of written.
  "Same body" means byte-identical JSON after parsing (`JSON.stringify` of the received body), so serialise deterministically.
- Use the per-item `idempotencyKey` when your source has a natural unique id for the measurement (CI run id + attempt, SonarQube
  analysis id, `jira:sprint:4711`). Do not use it for values you may need to correct later.

### 4.7 Batches and partial mode

- **Default: all or nothing.** All items are validated first; if any item is invalid (or names a team the key cannot write), nothing is
  written and you get `400` (or `403` when *every* error is a team-access error). Valid items are written in **one transaction**.
- **`?partial=true`:** valid items are written, invalid ones are reported. HTTP **207** with `"status": "partial"` when some items
  failed; **200** `"accepted"` when none did; **400** `"No item could be written"` when all failed.
- Items are processed in order; several items for the same team and day are fine (each becomes its own value).

### 4.8 Response

Single item (`200`):

```json
{
  "status": "accepted",
  "result": {
    "teamId": "team-1795033040840-eenlsowsl",
    "snapshotDate": "2026-11-18",
    "recordedAt": "2026-11-18T20:17:27.911Z",
    "qaScore": 80,
    "status": "warning",
    "updated": ["code_quality_score", "test_coverage"],
    "carriedForward": [],
    "duplicate": false
  },
  "items": [
    { "index": 0, "teamId": "team-1795033040840-eenlsowsl", "source": "sonarqube", "recordedAt": "2026-11-18T20:17:27.911Z",
      "metrics": ["code_quality_score", "test_coverage"], "status": "written", "snapshotDate": "2026-11-18", "qaScore": 80 }
  ],
  "ingestionId": "19f16691-63b6-44d7-8a14-d7cc24e521f8"
}
```

Array body: `results` (one per **written or duplicate** item, in order) instead of `result`, plus `items` (one per **sent** item,
`status` `written` / `duplicate` / `error` with `errors`) and, in partial mode, `errors: [{ index, errors: [...] }]`.

| Field | Meaning |
|---|---|
| `status` | `accepted` (all items written or duplicates), `partial` (207), `rejected` (4xx/5xx, nothing written) |
| `ingestionId` | Id of the ingestion log entry; quote it when asking for support |
| `result.snapshotDate` | UTC day the values were stored for |
| `result.qaScore`, `result.status` | QA score and its band (`good` / `warning` / `critical`) of that day's snapshot after the write; `null` while too few inputs exist (section 4.3) |
| `result.updated` | Metrics written by this item (empty for a duplicate) |
| `result.carriedForward` | Metrics on that snapshot that come from an earlier day |
| `result.duplicate` | `true` when the per-item `idempotencyKey` was already used for the team |

### 4.9 Errors and status codes

All errors are JSON `{ "error": "…", … }`. Validation errors list **every** problem of every item.

| HTTP | When | Example body | Retry? |
|---|---|---|---|
| 200 | All items written or duplicates | see 4.8 | — |
| 207 | `?partial=true` and some items rejected | `{"status":"partial","results":[…],"items":[…],"errors":[{"index":1,"errors":["test_coverage must be between 0 and 100 (%)"]}],"ingestionId":"…"}` | Fix and resend only the failed items |
| 400 | Validation (any item, default mode) | `{"error":"Validation failed","details":[{"index":0,"errors":["test_coverage must be between 0 and 100 (%)","qa_score is computed from the inputs and cannot be supplied","Unknown metric \"foo\"","lead_time_days must be a number"]}],"status":"rejected","ingestionId":"…"}` | No: fix the data |
| 400 | Item-level messages you may see | `teamId is required` · `item must be an object` · `metrics must be an object of {column: number}` · `No metric values provided` · `source must be 1–50 characters: letters, digits, "_", "-" or "."` · `source "manual" is reserved for entries made in the app` · `Unexpected field(s): …` · `recordedAt must be an ISO 8601 timestamp` · `recordedAt cannot be in the future` · `recordedAt cannot be more than 365 days in the past` · `idempotencyKey must be 1–200 characters: …` · `sourceRef must be a string of at most 500 characters` · `<key> must be between <min> and <max> (<unit>)` | No |
| 400 | Empty or too large batch | `{"error":"Send between 1 and 100 items","status":"rejected","ingestionId":"…"}` | No: split |
| 400 | Partial mode, every item invalid | `{"error":"No item could be written","details":[…],"status":"rejected","ingestionId":"…"}` | No |
| 400 | Bad `Idempotency-Key` header (not logged) | `{"error":"Idempotency-Key must be 1–200 characters: letters, digits, \"_\", \"-\", \".\" or \":\""}` | No |
| 400 | Body is not valid JSON | `{"error":"Bad request"}` | No |
| 401 | No / malformed / unknown / revoked key | `{"error":"API key required (Authorization: Bearer igk_…)"}`, `{"error":"Invalid or revoked API key"}` | No: fix the secret |
| 403 | Team unknown or of another company (all errors are of this kind) | `{"error":"Team no-such-team is not accessible with this API key","status":"rejected","ingestionId":"…"}` | No: fix the team id |
| 413 | Body over 100 kB | `{"error":"Payload too large"}` | No: send smaller batches |
| 422 | `Idempotency-Key` reused with a different body | `{"error":"This Idempotency-Key was already used with a different request"}` | No: new key for a new request |
| 429 | Rate limit | `{"error":"Ingestion rate limit reached (60 requests per minute per key). …"}` + `Retry-After` | Yes, after `Retry-After` seconds |
| 500 | Server error; nothing was written (logged as rejected) | `{"error":"Failed to ingest metrics","requestId":"…"}` or `{"error":"Authentication failed","requestId":"…"}` | Yes, with backoff and the same `Idempotency-Key` |
| 502 / 503 / 504 | Hosting platform / network | (not JSON) | Yes, with backoff and the same key |

**Request ids.** Every API response carries an `X-Request-Id` header. Send your own (8 to 64
characters: letters, digits, `.`, `_`, `:`, `-`) to match our logs to yours; otherwise the server
makes one. Every 5xx JSON body also contains it: `{"error":"…","requestId":"…"}`. Quote the request
id when you report a problem: support can find the error by it. Request bodies, query strings and
headers are never stored with it.

### 4.10 The ingestion log

Every ingestion request (accepted, partial or rejected; except malformed JSON, a malformed `Idempotency-Key` header, auth failures,
rate-limited requests and 422 key conflicts, which are refused before logging) and every Manual metrics save is recorded in `ingestion_log` with its
per-item summary, errors and the response returned.

- **UI:** **Administration → Ingestion log** (`/ingestion-log`). Super admins see the whole company; managers see entries that
  touched teams of their departments. Filters: status, channel (API / Manual metrics), source, team, date. Each entry shows who sent
  it (API key name and prefix, or the person), the teams, item and value counts, errors and the full response. The **per-source
  overview** shows *last received*, *last accepted*, the last status and 7-day counts: this is where you notice an integration that
  stopped sending.
- **API (session):** `GET /api/ingestion-log?status=&channel=api|manual&source=&teamId=&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=≤200&before=<id>`
  → `{ entries: [...], nextBefore }`; `GET /api/ingestion-log/sources`; `GET /api/ingestion-log/:id` (with `response`).
- **Alerts:** the *Ingestion failures* alert rule raises an alert for rejected or partial requests in the last hours, per team named in
  them (Parameters → Alert rules), so the team lead and manager are notified when an integration breaks.

---

## 4A. Raw ingestion: tests, coverage, pipelines (v2)

Send the **raw output your tools already produce**; QE Navigator calculates every metric itself (docs/V2_PLAN.md,
"Calculation rules (phase 1)"). You never send a computed percentage. Same API keys, the same rate limit (60 requests per
minute per key) and the same ingestion log as `POST /api/ingest/kpis`, which stays available.

| Endpoint | Accepts | Calculates (per team and UTC day) |
|---|---|---|
| `POST /api/ingest/tests` | JUnit XML (pytest, Jest `jest-junit`, Maven Surefire / Failsafe, Gradle, Playwright, Cypress / mocha, nested `<testsuites>`, `<properties>`, skipped / error / failure, Surefire `flakyFailure` / `rerunFailure`), TRX (`dotnet test --logger trx`, VSTest), Cucumber JSON | pass rate, first-time pass rate, flaky tests and flakiness rate, test execution time, slowest tests |
| `POST /api/ingest/coverage` | lcov (`lcov.info`), Cobertura XML, JaCoCo XML, Istanbul `coverage-final.json` and `coverage-summary.json` (json-summary); optional unified diff or changed-lines list | line and branch coverage, per-file coverage, coverage of changed code |
| `POST /api/ingest/pipelines` | pipeline run events (JSON) with stages | average build time, pipeline success rate, first-time pass rate, parallel test efficiency, failing stages |

The team id is on Admin console → **Connect your CI** (with copy-paste steps for GitHub Actions, GitLab CI, Jenkins and
Azure DevOps, a "send a test call" check and the last data received per team).

### 4A.1 Sending a report (tests and coverage)

Two ways, the same parameters:

```bash
# 1. The report as the body, parameters in the query (gzip recommended)
gzip -c target/surefire-reports/TEST-com.bank.LoanServiceTest.xml | curl -sS --fail-with-body \
  -X POST "$IRONGATE_URL/api/ingest/tests?team=$TEAM&commit=$SHA&branch=main&run=$RUN_ID&attempt=1" \
  -H "Authorization: Bearer $IRONGATE_API_KEY" -H "Content-Encoding: gzip" --data-binary @-

# 2. Multipart upload: one or several report files (one JUnit file per class is one run), plus a diff for changed code
curl -sS --fail-with-body -X POST "$IRONGATE_URL/api/ingest/coverage" -H "Authorization: Bearer $IRONGATE_API_KEY" \
  -F team=$TEAM -F commit=$SHA -F branch=main -F run=$RUN_ID \
  -F report=@coverage/lcov.info -F diff=@<(git diff origin/main...HEAD)
```

| Parameter | Required | Meaning |
|---|---|---|
| `team` (or `teamId`) | yes | The team id. A team of another company: `403`. |
| `commit` | recommended | The commit sha (≤ 80 characters). Flaky tests are found per commit. |
| `branch` | recommended | `refs/heads/` is removed. Coverage and pass rate use the team's **main branch** (set on Connect your CI; empty = `main` or `master`); a run without a branch counts as main. |
| `run` | recommended | The CI run id (≤ 200 characters). Without it, the sha256 of the file is used. |
| `attempt` | no (1) | The rerun number of the CI run (GitHub `GITHUB_RUN_ATTEMPT`, Azure `System.JobAttempt`). A failed attempt 1 and a passed attempt 2 of the same test on the same commit make it flaky. |
| `format` | no | Detected from the content. Tests: `junit`, `trx`, `cucumber`; coverage: `lcov`, `cobertura`, `jacoco`, `istanbul`, `istanbul-summary`. Anything else: `415` with the supported list. |
| `startedAt` | no | ISO 8601 time of the run; default the report's own timestamp, else now. Not in the future, at most 365 days back (late files are fine: the affected days are recalculated). |
| `dryRun=true` | no | Checks the key, the team and the report; stores nothing (the "send a test call" button). |
| `diff` (multipart file or field) | no, coverage | A unified diff (`git diff`); coverage of the added / changed lines is calculated. Coverage paths may be absolute (CI workspace); they are matched to the diff's relative paths by suffix. |
| `changedLines` (multipart field) | no, coverage | Instead of a diff: `{"src/a.ts": [12, 13, "20-24"]}`. |

**Idempotency.** One upload per team, kind, commit, run and attempt: sending it again answers `200 {"status":"duplicate"}`
and writes nothing, so a CI step can be retried safely. An `Idempotency-Key` header works as for `/kpis` (a retry gets the
stored answer with `Idempotent-Replayed: true`).

**Response** (`201`): the upload id, the counts, how long parsing took, and the values calculated for every affected day:

```json
{
  "status": "accepted", "kind": "tests", "format": "junit", "uploadId": "…", "parseMs": 2, "testRunId": "…",
  "counts": { "total": 5, "passed": 2, "failed": 1, "errored": 1, "skipped": 1 }, "durationMs": 3250,
  "computed": [{ "day": "2026-11-18", "metrics": [
    { "key": "pass_rate", "value": 50, "sampleSize": 1, "confidence": "low", "kpi": null, "written": false },
    { "key": "first_time_pass_rate", "value": 0, "sampleSize": 1, "confidence": "low", "kpi": "first_time_pass_rate", "written": true } ] }],
  "ingestionId": "…"
}
```

`kpi` names the team KPI the value is written to (source `computed`, so dashboards, alerts, targets and the QA score use it);
`written` is false when the value did not change. Values without a KPI column (pass rate, branch coverage, coverage of
changed code, flaky test count, pipeline success rate) are shown on the team page under **Evidence from CI**.

### 4A.2 Pipeline runs

```bash
curl -sS --fail-with-body -X POST "$IRONGATE_URL/api/ingest/pipelines?team=$TEAM" \
  -H "Authorization: Bearer $IRONGATE_API_KEY" -H "Content-Type: application/json" -d '{
  "id": "6612345678", "attempt": 1, "name": "CI", "commit": "a1b2c3d4", "branch": "main",
  "startedAt": "2026-11-18T08:00:00Z", "finishedAt": "2026-11-18T08:12:00Z", "result": "success",
  "url": "https://github.com/acme/payments/actions/runs/6612345678",
  "stages": [
    { "name": "build", "startedAt": "2026-11-18T08:00:00Z", "finishedAt": "2026-11-18T08:03:00Z", "result": "success" },
    { "name": "unit tests (shard 1/2)", "parallelGroup": "unit", "durationSeconds": 360, "result": "success" },
    { "name": "unit tests (shard 2/2)", "parallelGroup": "unit", "durationSeconds": 240, "result": "success" }
  ] }'
```

The body is one run, an array of runs, or `{"team": "…", "runs": [ … ]}` (1–100 runs, at most 1 MB). Required per run:
`id`, `startedAt`, `result`. `result` accepts the names of every CI tool: `success` / `succeeded` / `passed`;
`failure` / `failed` / `unstable` / `timed_out` / `partiallySucceeded` (failed); `cancelled` / `canceled` / `aborted` /
`skipped` (cancelled, not counted). `durationSeconds` defaults to `finishedAt − startedAt`. Stages: `name`, `result`
(also `skipped`), optional `kind` (`build`, `test`, `deploy`, `other`; guessed from the name), `parallelGroup`, times or
`durationSeconds`. A run already stored (team, `id`, `attempt`) is a duplicate. Send each run once, when it has finished.

### 4A.3 Calculation rules

| Metric (KPI column) | Formula | Based on |
|---|---|---|
| Line coverage (`test_coverage`) | lines hit ÷ lines found × 100 | the latest report of the day's latest main-branch commit |
| Branch coverage | branches hit ÷ branches found × 100 | same report |
| Coverage of changed code | changed coverable lines hit ÷ changed coverable lines × 100 | the day's latest report sent with a diff |
| Pass rate | passed ÷ (passed + failed + errors) × 100; skipped counted separately | the day's main-branch test runs |
| First-time pass rate (`first_time_pass_rate`) | runs whose first attempt passed ÷ runs × 100 | pipeline runs (first attempt per run id); test runs when no pipeline data |
| Flaky tests, flakiness rate (`test_flakiness_rate`) | tests that both failed and passed on the same commit within 7 days (or failed then passed in a rerun inside one run) ÷ distinct tests run × 100 | the 7 days up to the day |
| Test execution time (`test_execution_time_minutes`) | median total test duration per run | the day's test runs (all branches) |
| Average build time (`avg_build_time_minutes`) | median pipeline duration | the day's pipeline runs, cancelled excluded |
| Pipeline success rate | successful ÷ (successful + failed) × 100 | the day's pipeline runs |
| Parallel test efficiency (`parallel_test_efficiency`) | Σ shard durations ÷ (shards × longest shard) × 100, median over runs | stages with the same `parallelGroup`, or overlapping `test` stages |

Each value carries the number of runs it is based on: **high** confidence from 10 runs, **medium** 3–9, **low** 1–2. Every
value opens to its formula, the values used and the source runs ("How this was calculated"; `GET
/api/ci/teams/:id/metrics/:metric`). A late file recalculates the days it affects (for tests, up to 6 days later, the
flaky window); a nightly job (`calc-recompute`, 03:41 UTC) recalculates the last 8 days of every team.

### 4A.4 Errors

| Status | When |
|---|---|
| `400` | The problem is named: `team is required`, `attempt must be a whole number from 1`, `The run time … is in the future`, `Empty report …`, `Invalid XML: Unterminated start tag`, `XML entity declarations are not allowed`, `The report has no test cases`, `runs[0].result must be one of …`, `The body must be JSON` |
| `401` / `403` | Missing, unknown or revoked key / a team of another company or a suspended organisation |
| `413` | More than 20 MB received (`RAW_UPLOAD_MAX_MB`), or more than 100 MB after gzip; send gzip |
| `415` | Unknown or undetectable format (the answer lists the supported ones), or a `Content-Encoding` other than gzip |
| `429` | 60 requests per minute per key |

Every request, accepted or rejected, is in the **ingestion log** (source `tests (junit)`, `coverage (lcov)`, `pipelines`;
test calls `tests (junit, test call)`).

### 4A.5 Size limits, hosting and storage

- **Per request**: 20 MB as received, 100 MB after decompression (a gzip bomb stops there). gzip a report: JUnit and lcov
  compress 20 to 100 times (a 20 MB JUnit file with 174,000 test cases is 0.6 MB gzipped).
- **Netlify**: a synchronous function receives at most about **6 MB** of request body (the platform limit, before the
  20 MB of the API) and runs at most 10 s by default (26 s when configured). Send gzip and it fits: measured parse times
  (Node 22): JUnit 20 MB / 174,260 cases **0.28 s**, lcov 20 MB / 11,983 files **0.73 s**, Cobertura 20 MB / 4,854 classes
  **0.53 s**; storing 5,000 test results takes about 0.1 s. Background functions are not needed for reports of this size;
  very large suites can be sent as several uploads (one per shard, with `run` = the shard's job id).
- **Storage** (Supabase size): the gzipped file is kept for 35 days when at most 512 KB (`RAW_PAYLOAD_MAX_KB`, `0` keeps
  none; `RAW_PAYLOAD_DAYS`); per-test results and per-file coverage for 35 days (the latest coverage report of each team
  keeps its files); runs, reports, pipeline runs, flaky-test and metric evidence for **13 months**. Cleaned up twice a day
  by `db-keepalive`.
- **Safe XML**: entity declarations are refused (no external entities, no entity expansion), a DTD is never fetched,
  nesting depth and attribute counts are limited.

## 5. All other data: how it can be sent today

None of the following goes through the ingestion API. Each subsection says plainly what is possible.

### 5.1 Developer metrics (Developer productivity, Team detail, workload balance on the dashboard)

**Stored in** `developer_metrics`: **one current row per developer and team** (no history).

| Field (request) | Column | Unit | Notes |
|---|---|---|---|
| `teamId`, `developerId` | `team_id`, `developer_id` | — | Required. The developer must be a user of the same company. |
| `prMergeTimeAvg` | `pr_merge_time_avg` | hours (PR opened → merged) | target ≤ 4 / watch ≤ 24 |
| `codeReviewTimeAvg` | `code_review_time_avg` | hours (review requested → first review) | ≤ 2 / ≤ 4 |
| `focusTimeHours` | `focus_time_hours` | hours per day | ≥ 5 / ≥ 3 |
| `meetingTimeHours` | `meeting_time_hours` | hours per day | ≤ 2 / ≤ 4 |
| `contextSwitchesPerDay` | `context_switches_per_day` | per day, whole number (rounded) | ≤ 3 / ≤ 6 |
| `happinessScore` | `happiness_score` | 0–100 (validated) | Historical name: it is **workload balance (derived)**, not happiness. The app computes it in the browser (`calculateWorkloadBalance`, `src/data/advancedFeatures.ts`); a script must compute and send it (see `session_upload.py`). |

How to send:

- **UI:** **Administration → Manual metrics → Developer Productivity Metrics** (super admin, manager, team lead for their team).
- **Session:** `POST /api/metrics/developer` (roles super admin, manager, team lead; team must be writable by the caller) →
  `200 {"message":"Developer metrics saved successfully","teamId":…,"developerId":…}`; `400 Invalid developer ID`;
  `400 Workload balance score must be between 0 and 100`, and the same for every input (PR merge and review time 0–10,000 hours, focus and
  meeting time 0–24 hours a day, context switches a whole number 0–1,000). **Partial update: only the fields you send change; an omitted
  field keeps its stored value, `null` clears it** (the response lists `updated`). The derived score is not computed by the server: send it
  when you send its inputs. Example: `docs/integration-examples/session_upload.py developer`.
- **API key: not possible.**

To appear in team figures a developer must be an **active software engineer or team lead assigned to the team**, have
**developer insights enabled** (`users.developer_insights_enabled`, **off by default**; switched on the Users page by someone who
can manage that user) and have **all five inputs** recorded; team averages are shown only with **at least 3** such developers
(k-anonymity, section 11). The **DDPS history** chart reads `developer_productivity_snapshots`, which nothing but sample data
writes (section 12).

### 5.2 Business impact monthly data (Business impact: Money, What-if, Details, All teams)

**Stored in** three tables, one row per team and month (`month_year` = `YYYY-MM`):

| Table | Fields (all optional numbers unless noted) |
|---|---|
| `business_impact_quality_metrics` | `test_coverage` (%), `defect_density` (per KLOC), `defect_escape_rate` (%), `mttr_hours`, `deployment_frequency` (**deployments per month**, unlike the weekly KPI), `lead_time_days`, `code_quality_score`, `change_failure_rate` (%) |
| `business_impact_business_kpis` | `monthly_revenue` (currency, numeric(15,2)), `active_users` (integer), `churn_rate` (%), `feature_adoption_rate` (%), `nps_score`, `csat_score`, `support_ticket_volume` (integer); single-month endpoint also: `new_customers`, `customer_lifetime_value`, `avg_resolution_time_hours` |
| `business_impact_context` | `team_size`, `feature_release_count`, `user_growth_rate`, `total_user_base`, `is_holiday_season` (boolean), `downtime_minutes`; single-month endpoint also: `sprint_length_days`, `working_days`, `bug_fix_count`, `tech_debt_items_resolved`, `marketing_spend`, `major_incident_count`, `notes` (text) |

What uses them: correlations (Pearson r, BH-FDR, needs **≥ 6 paired months**), revenue per metric (OLS slope, ≥ 6 paired months),
"where the money is going" (latest month's `downtime_minutes`, `support_ticket_volume`, `churn_rate` × `monthly_revenue`),
What-if and All teams. Send **at least 6, ideally 12+ months** of both quality metrics and business KPIs for a team. The monthly
quality metrics are **not** derived from the KPI history automatically: send them as monthly values (e.g. the month's mean or
month-end KPI value).

How to send:

- **UI:** the **Business impact** page (enter monthly quality metrics, business KPIs and context; "save").
- **Session** (`server/routes/analytics.ts`; caller must be allowed to write the team: `assertTeamWrite`, i.e. super admin, the
  department's manager or the team's lead):
  - `POST /api/analytics/business-impact-v2/:teamId/bulk-save` `{ "monthlyData": [ { "month_year": "2026-10", "quality": {…}, "kpis": {…}, "context": {…} } ] }`
    → `{"success":true,"monthsSaved":n,"dataSource":"manual"}`. Months with a malformed `month_year` are silently skipped (check `monthsSaved`).
  - `POST …/:teamId/quality-metrics`, `…/business-kpis`, `…/context` — one month each, body `{ "month_year": "YYYY-MM", <fields> }`;
    `400 Invalid month_year format. Use YYYY-MM`.
  - Upsert per team and month; **an empty field keeps the stored value** (COALESCE). Values are range-checked (percentages 0–100, NPS
    −100…100, counts whole and non-negative): an invalid one gives `400` naming the field (and, for bulk-save, the month); nothing is saved.
  - Do **not** send `data_source: "synthetic"`: it is refused (`409`) unless sample data is enabled, and marks rows as sample data.
  - `GET /api/analytics/business-impact-v2/:teamId` shows what is stored and `summary.monthsWithPairedData`.
  - Example: `docs/integration-examples/session_upload.py business`.
- **API key: not possible.**

### 5.3 Technical debt items and ROI parameters (Technical debt page, tech debt score/health, revenue impact)

**Stored in** `technical_debt`: title, description, `severity` (`critical` / `high` / `medium` / `low`), `category`
(`code_quality`, `testing`, `documentation`, `infrastructure`, `security`, `performance`), `status` (`open`, `in_progress`,
`resolved`, `wont_fix`), `effort_hours`, `source` (e.g. "SonarQube"), `file_path`, `line_number`, `assigned_to`, and the ROI inputs
`affected_users`, `support_tickets_monthly`, `downtime_minutes_monthly`, `revenue_impact_percent`, `sla_breaches_monthly`.

- **Creating items, changing severity, status, title or category: not possible** (no endpoint, no screen). Debt items exist only from
  sample data today. This blocks the technical debt score, tech debt health (20 % of engineering health) and the debt part of revenue
  impact for real companies (section 12).
- **ROI inputs and effort of an existing item:** **UI** Administration → Manual metrics → *Technical Debt ROI Impact*;
  **Session** `PUT /api/analytics/technical-debt/:id/impact` (super admin or manager of the item's department) with
  `{ affected_users, support_tickets_monthly, downtime_minutes_monthly, revenue_impact_percent, sla_breaches_monthly, estimated_effort_hours }`.
  **Partial update: only the fields you send change** (an omitted one keeps its value, `null` clears it); ranges are checked (`400`), an
  empty body is `400 Nothing to update`. Item ids come from `GET /api/analytics/technical-debt?teamId=`.
- **Cost rates** (developer hourly rate, support ticket cost, revenue per user per month, downtime cost per minute, SLA breach penalty):
  section 5.9.

### 5.4 CI/CD pipeline: stages, runs, execution history (CI/CD pipeline page, pipeline health)

| Table | Shown in | Write path |
|---|---|---|
| `pipeline_stages` (name, order, `avg_duration_seconds`, `success_rate` %, `cpu_usage` %, `memory_usage` %, `cost_per_run`) | Stage flow and bottleneck score | **Edit existing stages only**: UI Manual metrics → *CI/CD pipeline stages*; Session `PUT /api/analytics/pipeline-stages/:id` `{ duration (seconds), success_rate, cpu_usage, memory_usage, cost_per_run }` (super admin or manager; omitted fields are kept; writes a `pipeline_stage_history` row). **No way to create a stage.** A team without stages shows the company-level stages. |
| `pipeline_runs` (status success/failed/running/cancelled, duration, commit, branch, times) | **Pipeline health** gauge (dashboard; 25 % of engineering health) | **None** |
| `pipeline_execution_summary` (per stage and day: runs, successes, failures, durations, cost) | "Stage executions over 14 days" | **None** |
| `pipeline_config` (time / cost savings %, cost per minute) | Savings estimates on the pipeline page | UI Manual metrics; Session `PUT /api/analytics/pipeline-config` (super admin / manager) |

What you *can* send for CI today: the KPIs `avg_build_time_minutes`, `test_execution_time_minutes`, `parallel_test_efficiency`,
`infrastructure_failures`, `test_flakiness_rate` (API).

### 5.5 Test executions and flaky tests (Test execution, Flaky tests)

`test_execution_runs`, `test_cases`, `test_executions` and `flaky_tests` have **no write path** (an ingestion endpoint for flaky-test
results exists only as a commented-out sketch in `server/routes/analytics.ts`). Send the team-level KPIs instead:
`test_flakiness_rate`, `test_execution_time_minutes`, `automation_coverage`, `first_time_pass_rate` (API).

### 5.6 Performance tests (Performance page)

`performance_metrics` (per team, day and endpoint: `response_time_p50_ms`, `_p95_ms`, `_p99_ms`, `throughput_per_minute`,
`error_rate` %) has **no write path**. The SLA thresholds used to flag breaches can be set: Parameters → Performance SLA
(`sla_response_time_ms`, default 500; `sla_error_rate_percent`, default 1), section 5.9.

### 5.7 Incidents

There is **no incidents table**. Incident data enters IronGate only as numbers you compute upstream:
`mttr_hours`, `change_failure_rate`, `mtbf_hours`, `system_availability` (KPIs, API; section 7.3) and, for business impact, the
monthly `downtime_minutes` and `major_incident_count` (context, Session).

### 5.8 Wellbeing pulse

Answers can only be given by team members in the app (Analytics → Wellbeing pulse). This is deliberate: there is **no import**, and
answers are stored without user id or time. Integration work here is limited to telling people the survey exists.

### 5.9 Configuration that changes how data is judged

| Setting | UI | Session endpoint | Who |
|---|---|---|---|
| KPI targets (good / warning) per company, department, team, with history | Parameters → KPI targets | `PUT /api/targets` `{ "scopeType": "company"\|"department"\|"team", "scopeId", "targets": { "<metric key>": { "good", "warning" } \| null } }` | company: super admin; department / team: super admin or the department's manager |
| Update frequency (staleness) per metric | Administration → Update frequency (`/metric-intervals`) | `PUT /api/settings/metric-intervals/:metricKey` `{ "interval_value": ≥1, "interval_unit": "minutes"\|"hours"\|"days"\|"weeks"\|"months" }` | super admin, manager |
| Financial and ROI settings: `developer_hourly_rate` (default 75), `support_ticket_cost` (25), `revenue_per_user_monthly` (50), `downtime_cost_per_minute` (100), `sla_breach_penalty` (1000) | Parameters → Financial and ROI settings | `POST /api/admin/configs` `{ "teamId"?, "departmentId"?, "configs": { "<key>": "<value>" } }` (team overrides department overrides company; empty value deletes) | super admin, manager (own departments) |
| Performance SLA: `sla_response_time_ms`, `sla_error_rate_percent` | Parameters → Performance SLA | same as above | same |
| Pipeline cost settings | Manual metrics | `PUT /api/analytics/pipeline-config` | super admin, manager |
| Alert rules | Parameters → Alert rules | `PUT /api/alerts/rules` | as KPI targets |

Unconfigured financial values use built-in defaults and are labelled "(default)" on screen: set real rates before you show money
figures to anyone.

### 5.10 Tables you can ignore

`team_pipeline_metrics`, `team_test_executions`, `team_analytics`, `business_metrics`, `business_impact_metrics`,
`metric_last_updated` are filled only by the sample-data generators and are not served to any screen. `sprint_velocity` (sprint
history table) is served by `GET /api/metrics/teams/:teamId/velocity` but no current screen calls it and nothing writes it; the
`sprint_velocity` **KPI** is what the app shows. `business_impact_config` / `business_impact_history` (Manual metrics → business impact
configuration, `POST /api/metrics/business-impact-config/:teamId`) are a legacy model not used by the Business impact page.

---

## 6. Code: curl, Node.js, Python, retries, batching, backfill

All examples read `IRONGATE_URL` (ending in `/api`) and `IRONGATE_API_KEY` from the environment. Runnable files are in
[`docs/integration-examples/`](integration-examples/) (index in section 14).

### 6.1 curl

```bash
export IRONGATE_URL=https://qe.example.com/api
export IRONGATE_API_KEY=igk_...          # from your secret store; never echo it

curl -sS -X POST "$IRONGATE_URL/ingest/kpis" \
  -H @<(printf 'Authorization: Bearer %s\n' "$IRONGATE_API_KEY") \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: sonar:pay-service:2026-11-18T06:00:00Z" \
  --retry 5 --retry-delay 2 \
  -d '{
        "teamId": "team-1795033040840-eenlsowsl",
        "source": "sonarqube",
        "recordedAt": "2026-11-18T06:00:00Z",
        "sourceRef": "pay-service analysis 2026-11-18",
        "metrics": { "code_quality_score": 82, "test_coverage": 78.4 }
      }'
```

`-H @<(…)` (curl ≥ 7.55, bash) keeps the key out of the process list; `-H "Authorization: Bearer $IRONGATE_API_KEY"` also works.
`--retry` retries timeouts, 408, 429 and 5xx and honours `Retry-After`; it never retries 4xx validation errors. Never use `curl -v`
or `set -x` in CI around this call: both print the `Authorization` header.

### 6.2 Node.js (TypeScript, built-in fetch, Node 18+)

Minimal:

```ts
const res = await fetch(`${process.env.IRONGATE_URL}/ingest/kpis`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.IRONGATE_API_KEY}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': `jenkins:${process.env.JOB_NAME}:${process.env.BUILD_NUMBER}`,
  },
  body: JSON.stringify({
    teamId: 'team-1795033040840-eenlsowsl',
    source: 'jenkins',
    recordedAt: new Date().toISOString(),
    metrics: { avg_build_time_minutes: 9, test_execution_time_minutes: 14 },
  }),
});
const data = await res.json();
if (!res.ok && res.status !== 207) throw new Error(`IronGate ${res.status}: ${JSON.stringify(data)}`);
```

With types, retries and a body-hash idempotency key: [`send-all-kpis.ts`](integration-examples/send-all-kpis.ts) exports
`ingest(body, { partial })`:

```ts
import { ingest } from './send-all-kpis';
const { httpStatus, replayed, data } = await ingest(items, { partial: true });  // items: KpiItem | KpiItem[]
```

### 6.3 Python (requests)

Minimal:

```python
import os, time, requests

recorded_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())   # build the body once; reuse it on retries
r = requests.post(
    f"{os.environ['IRONGATE_URL']}/ingest/kpis",
    headers={"Authorization": f"Bearer {os.environ['IRONGATE_API_KEY']}",
             "Idempotency-Key": f"jira:PAY:defects:{recorded_at}"},
    json={"teamId": "team-1795033040840-eenlsowsl", "source": "jira", "recordedAt": recorded_at,
          "metrics": {"defect_escape_rate": 8.1, "defect_density": 0.2}},
    timeout=60,
)
if r.status_code not in (200, 207):
    raise SystemExit(f"IronGate {r.status_code}: {r.text}")
print(r.json()["result"])
```

With retries, batching and a body-hash key: [`irongate_ingest.py`](integration-examples/irongate_ingest.py):

```python
from irongate_ingest import IronGateClient, summarise
client = IronGateClient()                      # IRONGATE_URL, IRONGATE_API_KEY
summarise(client.send(items, partial=True))    # any number of items, 100 per request
```

### 6.4 Retry with backoff and Idempotency-Key

The pattern both helpers implement:

```text
key = sha256(canonical JSON body)            # computed ONCE per request, reused on every attempt
for attempt in 1..6:
    send with header Idempotency-Key: key
    200 / 207            -> done (header Idempotent-Replayed: true = an earlier attempt already succeeded)
    429                  -> sleep Retry-After seconds, retry
    500 / 502 / 503 / 504 or network error
                         -> sleep 1, 2, 4, 8 … s (max 60) + up to 25 % random jitter, retry
    400 / 401 / 403 / 413 / 422
                         -> stop and report: retrying cannot fix these
```

Why this is safe: a request that failed with 5xx wrote nothing (one transaction) and did not bind the key; a request that succeeded but
whose response was lost is answered from the log on the retry. *Verified:* after exhausting the rate limit, `IronGateClient` waited the
43 s announced by `Retry-After` and then wrote the item.

### 6.5 Batching multiple teams (and the rate limit)

One request can carry up to 100 items for **any teams of the company** and any days. A nightly job for 40 teams × 3 metric groups
should send 1–2 requests, not 120.

```python
items = []
for team_id, project in TEAMS.items():          # e.g. {"team-…": "PAY", "team-…": "LEDGER"}
    m = jira_defect_metrics(project)            # your function
    if m:
        items.append({"teamId": team_id, "source": "jira", "recordedAt": now_iso, "metrics": m,
                      "sourceRef": f"project {project}"})
summarise(IronGateClient().send(items, partial=True))   # partial: one bad team does not block the rest
```

Use `?partial=true` for multi-team batches and check each item's `status`; use the default all-or-nothing mode when the values of a
batch only make sense together.

### 6.6 Backfilling history

- Up to **365 days** back; one item per team and day, `recordedAt` at a fixed UTC time (e.g. `T23:59:00Z`).
- Oldest first or in any order: a newer value always wins on its own days.
- Expect about 50 ms per item on a small instance (each backdated item re-derives the later snapshot days): 400 items took ~19 s in 4
  requests. Use a client timeout of 60–120 s and stay under 60 requests per minute.
- Re-running a backfill is safe when the bodies are identical (replayed); changed values for the same `recordedAt` are corrections.

Example: [`backfill_csv.py`](integration-examples/backfill_csv.py) turns a `team_id,date,metric,value` CSV into batches of 100:

```bash
python3 backfill_csv.py history.csv --source bi-export
# 398 items (796 values) in 4 request(s)
# rejected: team=team-… at=2026-11-10T23:59:00Z ['test_coverage must be between 0 and 100 (%)']
# done: 397 items written or already present, 1 rejected
```

---

## 7. Recipes per source system

The IronGate side of every recipe below was run against a local instance; the calls to the external systems (SonarQube, Jira, Jenkins,
GitHub, GitLab) were run only against mocks or not at all, and are marked so. Check field names (story points, "found in") against your
own Jira configuration.

### 7.1 Test coverage from a coverage report (any CI)

[`ci_report_to_irongate.py`](integration-examples/ci_report_to_irongate.py) reads Istanbul `coverage-summary.json` (`total.lines.pct`),
Cobertura XML (`line-rate` × 100), JaCoCo XML (report-level `LINE` counter: covered ÷ (covered + missed) × 100) or LCOV (Σ LH ÷ Σ LF × 100),
plus JUnit XML suite times, and sends `test_coverage`, `test_execution_time_minutes` and `avg_build_time_minutes`:

```bash
python3 ci_report_to_irongate.py --team "$IRONGATE_TEAM_ID" --source github-actions \
  --coverage coverage/coverage-summary.json --junit "reports/**/*.xml" --build-seconds 412 \
  --ref "$BUILD_URL" --run-id "$RUN_ID-$ATTEMPT"
```

Send coverage from the **main branch** build only (feature branches would make the team value jump). `--run-id` becomes the per-item
`idempotencyKey`, so a re-run of the same CI job does not store the value twice.

### 7.2 Build and test durations

`avg_build_time_minutes` is a **mean** over builds and its expected interval is **1 hour**. Either send each main-branch build's
duration (the latest value is shown, so it behaves like a moving sample) or, better, a rolling mean from the CI API every hour:

| CI | Rolling mean of the last 20 successful builds (not executed here) |
|---|---|
| Jenkins | `GET $JENKINS_URL/job/<job>/api/json?tree=builds[result,duration]{0,20}` → mean of `duration` (ms) where `result == "SUCCESS"`, ÷ 60,000 |
| GitHub Actions | `GET /repos/<owner>/<repo>/actions/workflows/<file>/runs?branch=main&status=success&per_page=20` → mean of (`updated_at` − `run_started_at`) |
| GitLab | `GET /api/v4/projects/<id>/pipelines?ref=main&status=success&per_page=20`, then `GET …/pipelines/<pid>` → mean of `duration` (seconds) |

`test_execution_time_minutes`: the suite's duration (sum of JUnit `<testsuite time>` for a sequential run, wall-clock for a parallel one).
`parallel_test_efficiency` = (Σ shard durations ÷ wall-clock duration) ÷ number of shards × 100.

### 7.3 DORA and reliability from deployment and incident events

[`dora_to_irongate.py`](integration-examples/dora_to_irongate.py) reads deployments and incidents
([`sample-dora-events.json`](integration-examples/sample-dora-events.json)) and computes, over a trailing window (default 28 days)
ending at the "as of" time:

```text
deployment_frequency_per_week = successful production deployments in window ÷ (window days ÷ 7)
lead_time_days                = mean over every commit shipped by those deployments of (deployedAt − committedAt), in days
change_failure_rate           = deployments in window that caused a failure ÷ deployments in window × 100
                                (caused a failure = flagged on the deployment, or named by an incident's causedByDeployment)
mttr_hours                    = mean (resolvedAt − startedAt) of incidents resolved in window, in hours
mtbf_hours                    = window hours ÷ incidents started in window          (integer; not sent when there were none)
system_availability           = (window minutes − outage minutes inside window) ÷ window minutes × 100   (3 decimals)
```

Worked example from the sample file (team "Checkout", window 2026-10-21 → 2026-11-18): production deployments 101, 102, 103, 104, 107
(105 was staging, 106 failed) = 5 → **1.25 per week**; deploy 103 caused INC-881 → CFR **1 ÷ 5 = 20 %**; incidents resolved: INC-881
(75 min) and INC-893 (30 min) → MTTR **0.88 h**; 2 incidents in 672 h → MTBF **336 h**; outage INC-881 75 min of 40,320 → availability
**99.814 %**. A metric without input (no deployments, no resolved incidents) is left out, **never sent as 0**: a 0 is a real value and
would, for example, make a team "Elite" on MTTR.

The script sends all teams found in the file in one request, and with `--backfill-days N` one value per past day (at 23:59 UTC):

```bash
python3 dora_to_irongate.py events.json --backfill-days 30     # 2 teams × 31 days = 62 items, 1 request
```

Sources: deployments from GitHub Deployments (`GET /repos/<o>/<r>/deployments?environment=production` + statuses), Argo CD sync history,
the Jenkins / GitLab deploy job; commit times from the deployed commit range (`git log <previous deploy sha>..<deploy sha> --format=%cI`);
incidents from PagerDuty (`GET /incidents?since=&until=`, `created_at`, `resolved_at` from the log entries) or Opsgenie
(`GET /v2/alerts` / incident API). Tag incidents with the deployment that caused them (a field or a label) to get a real change failure rate.

### 7.4 Defect metrics from Jira (JQL)

[`jira_to_irongate.py`](integration-examples/jira_to_irongate.py) (run against a mock of the Jira API only):

```text
all_bugs  = count( issuetype = Bug AND project = "PAY" AND created >= -30d )
prod_bugs = count( … AND labels = production )         # adapt: Environment field, "Found in" custom field
defect_escape_rate = prod_bugs ÷ all_bugs × 100         (only when all_bugs > 0)
defect_density     = all_bugs ÷ (ncloc ÷ 1000)           (ncloc from SonarQube)
```

Counting: Jira Cloud `POST /rest/api/3/search/approximate-count {"jql": "…"}` → `{"count": n}`; Jira Server / Data Center
`GET /rest/api/2/search?jql=…&maxResults=0` → `{"total": n}`.

```bash
python3 jira_to_irongate.py --team "$TEAM" --project PAY --days 30 --ncloc 182000
# bugs in 30d: 37, found in production: 3   ->  defect_escape_rate 8.11, defect_density 0.203
```

Agile KPIs from Jira (formulas; not shipped as a script): for each closed sprint (`GET /rest/agile/1.0/board/<id>/sprint?state=closed`) and
its issues (`GET /rest/agile/1.0/sprint/<id>/issue?fields=status,<story points field>`):
`sprint_velocity` = Σ points of issues Done at close; `sprint_commitment_rate` = completed ÷ committed-at-start × 100 (committed at start
needs the issue changelog or the sprint report); `sprint_carryover` = not completed ÷ committed × 100; `sizing_accuracy` = Σ `timespent` ÷
Σ `timeoriginalestimate` of resolved issues; `first_time_pass_rate` = stories never moved back from the QA status ÷ stories tested × 100
(changelog); `blocked_time_hours` = Σ time with the Flagged / Blocked status (changelog). Send them with `recordedAt` = the sprint end and a
per-item `idempotencyKey` such as `jira:sprint:<sprint id>`.

### 7.5 Code quality and coverage from SonarQube

[`sonarqube_to_irongate.py`](integration-examples/sonarqube_to_irongate.py) (run against a mock of the SonarQube API only):

```text
GET $SONAR_URL/api/measures/component?component=<key>&metricKeys=coverage,ncloc,sqale_rating,reliability_rating,security_rating
    Authorization: Bearer <sonar token>
test_coverage      = coverage
code_quality_score = round( score(sqale_rating) × 0.40 + score(reliability_rating) × 0.35 + score(security_rating) × 0.25 )
                     score: 1.0 (A) = 100, 2.0 (B) = 80, 3.0 (C) = 60, 4.0 (D) = 40, 5.0 (E) = 20
                     e.g. A / C / B -> 100×0.40 + 60×0.35 + 80×0.25 = 81
```

This is the same calculator as Manual metrics → Code quality score. Run it after each main-branch analysis or daily (expected interval 1 day).

### 7.6 Test management, flakiness, automation

- `automation_coverage` (weekly): TestRail `GET index.php?/api/v2/get_cases/<project>` → cases whose automation field says automated ÷ all
  active cases × 100; Xray / Zephyr: the equivalent test type field.
- `test_flakiness_rate` (daily): over the last 7 days of main-branch runs, runs of a test that failed on a commit on which the same test also
  passed (a re-run or retry) ÷ all test runs × 100. With pytest-rerunfailures / Maven Surefire `rerunFailingTestsCount` / Jest retries, count
  tests reported "flaky".
- `automation_roi` (monthly): (manual execution time the automated runs replaced − time spent building and maintaining automation) ÷ that
  time spent × 100.
- `infrastructure_failures` (weekly): failed CI runs classified as infrastructure (runner lost, network, quota) in the last 30 days.

### 7.7 Business data (finance / BI, product analytics)

Monthly revenue, active users, churn, adoption, NPS, CSAT and ticket volume go into the business-impact tables (section 5.2) through the
Business impact page or `session_upload.py business`. Keep them **team-level** (the revenue of the product area the team owns) and
**aggregated** (no customer-level data).

---

## 8. CI examples: GitHub Actions, Jenkins, GitLab CI

The scripts are referenced from a `tools/irongate/` folder of your repository (copy
`irongate_ingest.py` and the scripts you need from `docs/integration-examples/`). Store the API key as a **secret** and the team id and URL
as plain variables. These pipeline definitions were not run in the real CI systems; the commands they call were run locally.

### 8.1 GitHub Actions (step in the main-branch workflow)

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Record start time
        run: echo "BUILD_START=$(date +%s)" >> "$GITHUB_ENV"
      - uses: actions/checkout@v4
      # ... build and test, producing coverage/coverage-summary.json and reports/junit/*.xml ...
      - name: Send coverage and timings to IronGate
        if: github.ref == 'refs/heads/main' && success()
        env:
          IRONGATE_URL: ${{ vars.IRONGATE_URL }}            # https://qe.example.com/api
          IRONGATE_API_KEY: ${{ secrets.IRONGATE_API_KEY }}  # masked in logs by GitHub
        run: |
          pip install --quiet requests
          python3 tools/irongate/ci_report_to_irongate.py \
            --team "${{ vars.IRONGATE_TEAM_ID }}" --source github-actions \
            --coverage coverage/coverage-summary.json \
            --junit "reports/junit/*.xml" \
            --build-seconds "$(( $(date +%s) - BUILD_START ))" \
            --ref "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" \
            --run-id "${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
```

Daily DORA job (deployments and incidents exported by an earlier step to `events.json`):

```yaml
on:
  schedule: [{ cron: "17 5 * * *" }]
jobs:
  dora:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # ... export deployments (GitHub API) and incidents (PagerDuty API) to events.json ...
      - run: pip install --quiet requests && python3 tools/irongate/dora_to_irongate.py events.json
        env:
          IRONGATE_URL: ${{ vars.IRONGATE_URL }}
          IRONGATE_API_KEY: ${{ secrets.IRONGATE_API_KEY }}
```

### 8.2 Jenkinsfile stage

```groovy
pipeline {
  agent any
  environment {
    IRONGATE_URL     = 'https://qe.example.com/api'
    IRONGATE_TEAM_ID = 'team-1795033040840-eenlsowsl'
  }
  stages {
    // ... build and test stages producing target/site/jacoco/jacoco.xml and target/surefire-reports/*.xml ...
    stage('Report to IronGate') {
      when { branch 'main' }
      steps {
        script { env.BUILD_SECONDS = ((long) (currentBuild.duration / 1000)).toString() }
        withCredentials([string(credentialsId: 'irongate-api-key', variable: 'IRONGATE_API_KEY')]) {
          // Single quotes: the shell expands the secret, Groovy never interpolates it into the script.
          sh '''
            python3 tools/irongate/ci_report_to_irongate.py \
              --team "$IRONGATE_TEAM_ID" --source jenkins \
              --coverage target/site/jacoco/jacoco.xml \
              --junit "target/surefire-reports/*.xml" \
              --build-seconds "$BUILD_SECONDS" \
              --ref "$BUILD_URL" --run-id "$JOB_NAME-$BUILD_NUMBER"
          '''
        }
      }
    }
  }
}
```

### 8.3 GitLab CI job

```yaml
irongate:
  stage: .post
  image: python:3.12-slim
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  needs:
    - job: test
      artifacts: true
  variables:
    IRONGATE_URL: https://qe.example.com/api
    # IRONGATE_API_KEY and IRONGATE_TEAM_ID: Settings → CI/CD → Variables (key: masked + protected)
  script:
    - pip install --quiet requests
    - >
      python3 tools/irongate/ci_report_to_irongate.py
      --team "$IRONGATE_TEAM_ID" --source gitlab-ci
      --coverage coverage/cobertura-coverage.xml
      --junit "reports/junit*.xml"
      --build-seconds "$(( $(date +%s) - $(date -d "$CI_PIPELINE_CREATED_AT" +%s) ))"
      --ref "$CI_PIPELINE_URL" --run-id "$CI_PIPELINE_ID"
```

---

### 8.4 Raw reports (v2) per CI tool

The recommended set-up for v2: send the raw reports and the pipeline run (section 4A); QE Navigator calculates the
metrics. Admin console → **Connect your CI** shows these steps with your endpoint and team id filled in. Store the API key
as a secret named `QE_NAVIGATOR_API_KEY`; `$IRONGATE_URL` is your QE Navigator address and `$TEAM` the team id.

**GitHub Actions** (steps at the end of the test job):

```yaml
      - name: Send test and coverage reports to QE Navigator
        if: always()
        env:
          QE_NAVIGATOR_API_KEY: ${{ secrets.QE_NAVIGATOR_API_KEY }}
        run: |
          COMMON="team=$TEAM&commit=${GITHUB_SHA}&branch=${GITHUB_REF_NAME}&run=${GITHUB_RUN_ID}&attempt=${GITHUB_RUN_ATTEMPT}"
          gzip -c test-results/junit.xml | curl -sS --fail-with-body -X POST "$IRONGATE_URL/api/ingest/tests?$COMMON" \
            -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Encoding: gzip" --data-binary @-
          gzip -c coverage/lcov.info | curl -sS --fail-with-body -X POST "$IRONGATE_URL/api/ingest/coverage?$COMMON" \
            -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Encoding: gzip" --data-binary @-
      - name: Send the pipeline run to QE Navigator
        if: always()
        env:
          QE_NAVIGATOR_API_KEY: ${{ secrets.QE_NAVIGATOR_API_KEY }}
          GH_TOKEN: ${{ github.token }}
        run: |
          STARTED=$(gh api repos/${{ github.repository }}/actions/runs/${{ github.run_id }} --jq .run_started_at)
          curl -sS --fail-with-body -X POST "$IRONGATE_URL/api/ingest/pipelines?team=$TEAM" \
            -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json" \
            -d "{\"id\":\"${GITHUB_RUN_ID}\",\"attempt\":${GITHUB_RUN_ATTEMPT},\"commit\":\"${GITHUB_SHA}\",\"branch\":\"${GITHUB_REF_NAME}\",\"startedAt\":\"$STARTED\",\"finishedAt\":\"$(date -u +%FT%TZ)\",\"result\":\"${{ job.status }}\"}"
```

**GitLab CI**:

```yaml
test:
  stage: test
  script: [npm test]          # writes junit.xml and coverage/lcov.info
  after_script:
    - gzip -c junit.xml | curl -sS --fail-with-body -X POST "$IRONGATE_URL/api/ingest/tests?team=$TEAM&commit=$CI_COMMIT_SHA&branch=$CI_COMMIT_REF_NAME&run=$CI_JOB_ID" -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Encoding: gzip" --data-binary @-
    - gzip -c coverage/lcov.info | curl -sS --fail-with-body -X POST "$IRONGATE_URL/api/ingest/coverage?team=$TEAM&commit=$CI_COMMIT_SHA&branch=$CI_COMMIT_REF_NAME&run=$CI_JOB_ID" -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Encoding: gzip" --data-binary @-
qe-navigator-pipeline-passed:
  stage: .post
  when: on_success
  script:
    - curl -sS --fail-with-body -X POST "$IRONGATE_URL/api/ingest/pipelines?team=$TEAM" -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json" -d "{\"id\":\"$CI_PIPELINE_ID\",\"commit\":\"$CI_COMMIT_SHA\",\"branch\":\"$CI_COMMIT_REF_NAME\",\"startedAt\":\"$CI_PIPELINE_CREATED_AT\",\"finishedAt\":\"$(date -u +%FT%TZ)\",\"result\":\"success\",\"url\":\"$CI_PIPELINE_URL\"}"
qe-navigator-pipeline-failed:
  stage: .post
  when: on_failure
  script:
    - curl … the same, with \"result\":\"failed\"
```

**Jenkins** (declarative `post`; the key as a Secret text credential `qe-navigator-api-key`):

```groovy
post {
  always {
    withCredentials([string(credentialsId: 'qe-navigator-api-key', variable: 'QE_NAVIGATOR_API_KEY')]) {
      sh '''
        # Every Surefire file (one per test class) in one upload: one run.
        curl -sS --fail-with-body -X POST "$IRONGATE_URL/api/ingest/tests" -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" \
          -F team=$TEAM -F commit=$GIT_COMMIT -F branch=$BRANCH_NAME -F run=$BUILD_NUMBER \
          $(for f in target/surefire-reports/TEST-*.xml; do printf -- '-F report=@%s ' "$f"; done)
        gzip -c target/site/jacoco/jacoco.xml | curl -sS --fail-with-body -X POST "$IRONGATE_URL/api/ingest/coverage?team=$TEAM&commit=$GIT_COMMIT&branch=$BRANCH_NAME&run=$BUILD_NUMBER" \
          -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Encoding: gzip" --data-binary @-
      '''
      script {
        def started = new Date(currentBuild.startTimeInMillis).format("yyyy-MM-dd'T'HH:mm:ss'Z'", TimeZone.getTimeZone('UTC'))
        writeFile file: 'qe-pipeline.json', text: groovy.json.JsonOutput.toJson([id: env.BUILD_TAG, commit: env.GIT_COMMIT,
          branch: env.BRANCH_NAME, startedAt: started, durationSeconds: (currentBuild.duration / 1000) as long,
          result: currentBuild.currentResult, url: env.BUILD_URL])
      }
      sh 'curl -sS --fail-with-body -X POST "$IRONGATE_URL/api/ingest/pipelines?team=$TEAM" -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Type: application/json" --data-binary @qe-pipeline.json'
    }
  }
}
```

**Azure DevOps** (the key as a secret pipeline variable):

```yaml
- script: |
    COMMON="team=$TEAM&commit=$(Build.SourceVersion)&branch=$(Build.SourceBranchName)&run=$(Build.BuildId)&attempt=$(System.JobAttempt)"
    gzip -c $(Agent.TempDirectory)/TestResults/*.trx | curl -sS --fail-with-body -X POST "$IRONGATE_URL/api/ingest/tests?$COMMON" \
      -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Encoding: gzip" --data-binary @-
    gzip -c coverage/cobertura-coverage.xml | curl -sS --fail-with-body -X POST "$IRONGATE_URL/api/ingest/coverage?$COMMON" \
      -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" -H "Content-Encoding: gzip" --data-binary @-
    curl -sS --fail-with-body -X POST "$IRONGATE_URL/api/ingest/pipelines?team=$TEAM" -H "Authorization: Bearer $QE_NAVIGATOR_API_KEY" \
      -H "Content-Type: application/json" -d "{\"id\":\"$(Build.BuildId)\",\"attempt\":$(System.JobAttempt),\"commit\":\"$(Build.SourceVersion)\",\"startedAt\":\"$(System.PipelineStartTime)\",\"finishedAt\":\"$(date -u +%FT%TZ)\",\"result\":\"$(Agent.JobStatus)\"}"
  displayName: Send results to QE Navigator
  condition: always()
  env:
    QE_NAVIGATOR_API_KEY: $(QE_NAVIGATOR_API_KEY)
```

These pipeline definitions were not run in the real CI systems; each `curl` call they make was run against a local API
(tests/api/raw-ingestion.test.ts covers the same requests).

## 9. "Populate everything" checklist and end-to-end script

### 9.1 Checklist

Setup (once):

- [ ] Super admin creates **one API key per integration** (Admin console → API keys) and stores each in a secret store.
- [ ] Collect the **team ids** (section 2) and map each to its repositories, Jira projects, SonarQube projects, services, on-call schedules.
- [ ] Set **KPI targets** (Parameters → KPI targets) and **financial settings** (Parameters → Financial and ROI settings) and **Performance SLA**.
- [ ] Review **Update frequency** (Administration → Update frequency) against how often each job will really send.
- [ ] Enable **developer insights** for the developers who agreed to it (Users page), if you will record developer metrics.

Team KPIs via the API (per team; see the interval column of section 4.3):

- [ ] `test_coverage`, `code_quality_score` — SonarQube / coverage report, daily (7.1, 7.5)
- [ ] `avg_build_time_minutes`, `test_execution_time_minutes` — CI, **hourly** (7.2)
- [ ] `parallel_test_efficiency`, `test_flakiness_rate` — CI, daily (7.2, 7.6)
- [ ] `defect_density`, `defect_escape_rate` — Jira (+ SonarQube `ncloc`), weekly (7.4)
- [ ] `automation_coverage` weekly, `automation_roi` monthly — test management (7.6)
- [ ] `deployment_frequency_per_week` weekly, `lead_time_days` daily, `change_failure_rate` weekly, `mttr_hours` daily — deploy + incident
      events (7.3). All four are needed for a DORA level.
- [ ] `mtbf_hours` weekly, `system_availability` daily, `infrastructure_failures` weekly — incidents / monitoring / CI (7.3, 7.6)
- [ ] `sprint_velocity`, `sprint_commitment_rate`, `sprint_carryover`, `sizing_accuracy` — Jira, every sprint (2 weeks) (7.4)
- [ ] `first_time_pass_rate`, `blocked_time_hours` — Jira, daily (7.4)
- [ ] Optional: backfill up to 365 days of history (6.6) so trends, QA-score trend and history charts are filled from day one.

Other data (not via the API key):

- [ ] Developer metrics — Manual metrics, or `session_upload.py developer` (5.1)
- [ ] Business impact: ≥ 6 (better 12) months of monthly quality metrics, business KPIs and context per team — Business impact page or
      `session_upload.py business` (5.2)
- [ ] Technical debt ROI inputs of existing items — Manual metrics or `session_upload.py debt-impact` (5.3)
- [ ] Pipeline stage figures of existing stages, pipeline cost settings — Manual metrics (5.4)
- [ ] Pulse survey — ask the team members to answer (5.8)
- [ ] Accept that these stay empty for now: pipeline runs (pipeline health), stage execution history, test execution, flaky tests,
      performance, creating debt items, DDPS history (section 12)

Monitoring:

- [ ] Each integration appears in Ingestion log → sources with a recent *last accepted* time
- [ ] The *Ingestion failures* and *Metric stale* alert rules are on (Parameters → Alert rules)

### 9.2 Minimal end-to-end example

One valid value for **every** KPI for one team, in three equivalent versions:

```bash
cd docs/integration-examples
export IRONGATE_URL=https://qe.example.com/api IRONGATE_API_KEY=igk_...
./send-all-kpis.sh <team id>                  # curl
python3 send_all_kpis.py <team id>            # Python + requests
npx tsx send-all-kpis.ts <team id>            # Node 18+ / TypeScript
```

Expected (verified on a fresh team):

```text
HTTP 200
… "updated": [ …23 keys… ], "qaScore": 89, "status": "good" …
snapshot 2026-11-18: 23 of 23 KPIs written, QA score 89 (good)
```

Then open the team in the app: every KPI card on Team detail is filled, sourced "smoke-test", not stale; the QA score shows "based on 4 of 4
inputs"; the DORA level is computed (Elite / High / …); the entry is in the ingestion log. Remove nothing afterwards (there is no delete):
run it against a test team, or overwrite the values with real ones (the latest value wins).

---

## 10. Verifying and troubleshooting

### 10.1 Did it arrive?

1. **The response.** `status: "accepted"`, each item `written` (or `duplicate`), `result.updated` lists your metrics, `snapshotDate` is the
   day you expect. Log the `ingestionId` (not the key).
2. **Ingestion log** (Administration → Ingestion log): the entry with that id, its items and errors; the sources overview shows your source's
   *last received / last accepted*.
3. **Team detail:** each KPI shows "source · as of date"; a greyed value labelled **"Stale since …"** is older than its expected interval
   (send more often or change Update frequency). With **Show formulas & data sources** on (super admins) the metric dialog shows the provenance (`source`, `recorded_at`, recorded by
   `api_key:<id>`, carried forward or not).
4. **Confidence "n of m".** Composites say what they are based on: the QA score "based on n of 4 inputs" (stale or missing inputs are not
   used), Delivery (DORA) "based on n of m teams", Engineering health "n of 4 components". A low n tells you which data is missing.
5. **By API (session):** `GET /api/teams/:id` returns `kpiData`, `kpiFieldSources` (provenance per column), `kpiStaleness`
   (`stale`, `staleSince`, `recordedAt`, `source` per KPI) and `qaScoreConfidence` (`inputsUsed`, `inputsTotal`, `staleInputs`,
   `missingInputs`); `GET /api/teams/:id/kpi-history?days=90`; `GET /api/analytics/company-summary` (company figures with confidence and
   `sampleData`).
6. **"Includes sample data"** on a screen means at least one value shown has the source `synthetic` (sample data), not yours.

### 10.2 Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 API key required` | Header missing, not `Bearer`, or the token lost its `igk_` prefix (e.g. secret stored with quotes or a newline) | Check the secret's exact value; header `Authorization: Bearer igk_…` |
| `401 Invalid or revoked API key` | Typo, revoked key, key of another instance | Admin console → API keys: check prefix and revocation; create a new key |
| `403 Team … is not accessible with this API key` | Team id wrong, deleted, or of another company (keys are per company) | Re-read the team id (section 2); use the key of that company |
| `400 Unknown metric "…"` | Wrong key (camelCase `testCoverage`, `qa_score`, `deployment_frequency`) | Use the snake_case keys of section 4.3 |
| `400 Unexpected field(s): …` | Metric sent at the top level of the item | Put values inside `"metrics": { … }` |
| `400 … must be between 0 and 100 (%)` | Fraction sent instead of percent (0.78 is fine but means 0.78 %), or > 100 | Send percentages 0–100: `78.4`, not `0.784` — and check the opposite mistake |
| `400 recordedAt cannot be in the future` | Clock skew > 5 min, or local time sent with a `Z` | Use UTC with `Z`, NTP on the runner |
| `400 recordedAt cannot be more than 365 days in the past` | Backfill too old | Only the last 365 days can be sent |
| `400 source "manual" is reserved …` | `source: "manual"` | Use your system's name |
| `413` | Body over 100 kB | Fewer items per request, shorter `sourceRef` |
| `422 This Idempotency-Key was already used …` | A static or reused header key for a different body | One key per logical request (body hash or run id) |
| `429` | Over 60 requests / minute for the key | Batch (≤ 100 items per request); honour `Retry-After` |
| `200` but `status: "duplicate"`, `updated: []` | Per-item `idempotencyKey` already used for the team (e.g. constant key, or re-run of the same CI run with new values) | Make the key unique per measurement; for corrections omit it (4.5) |
| `200`, header `Idempotent-Replayed: true`, but the value did not change | Same header key and identical body as an earlier request (e.g. body without `recordedAt`, key = body hash) | Include `recordedAt`; derive the key per run |
| Value written but Team detail shows an older value | You backdated it: a newer value exists for the days after | Expected; check `recordedAt` |
| KPI shows "Stale since …" | Not sent within its expected interval (build time and test time: 1 hour) | Schedule more often, or change Administration → Update frequency |
| QA score empty | `test_coverage` missing or stale, or fewer than 2 of the 4 inputs current | Send coverage daily plus escape rate / CFR / code quality |
| DORA level "Unknown" | One of the four DORA KPIs missing (dashboard: or stale) | Send all four (7.3), each within its interval |
| Value on the wrong day | `recordedAt` in a time zone whose date differs from UTC | Use UTC times (section 4.4) |
| Business impact "needs k more months" / no correlations | Fewer than 6 paired months of quality metrics and business KPIs | Send more months (5.2) |
| Developer tiles say "Not shown: fewer than 3 contributors" | Fewer than 3 opted-in developers with all five inputs assigned to the team | Expected privacy rule (section 11) |
| Session endpoint `400` naming a field | A value outside its range or not a number | Check units and ranges (5.1–5.3) |

---

## 11. Security and data protection

**API keys and secrets**

- Store keys in your CI / vault secret store; inject them as environment variables; never commit them, never put them in a URL, ticket,
  chat or browser code.
- Never log them: no `curl -v`, no `set -x` around the call, no printing of request headers; mask the variable in CI (GitHub secrets and
  GitLab masked variables are masked automatically, Jenkins `withCredentials` too). The example clients never print the key.
- IronGate stores only the SHA-256 hash; the rate limiter counts by hash; the server's request log records only method and path; the
  ingestion log records the key id, name and prefix, never the key.
- One key per integration, least privilege for session accounts (3.6), rotation (3.3), HTTPS only (3.5).

**No personal data in KPI payloads**

- KPIs are **team aggregates**. Do not put names, e-mail addresses, user ids, customer data or ticket contents in `source`, `sourceRef` or
  idempotency keys: they are stored with every value and shown in the ingestion log to admins and managers. Use build URLs, job ids, project
  keys, JQL text without people's names.
- Do not encode individuals as teams (a "team" of one person turns team KPIs into individual performance data).

**Developer-level data** (`developer_metrics`)

- It is personal data about named employees. Agree its use with your works council / data protection officer before collecting it, and
  record only the five workload inputs; no keystrokes, screen time or message content.
- Visibility (`canViewDeveloperRow`, `server/lib/userPolicy.ts`): software engineers and viewers see only their own row; team leads, managers
  and super admins see people in their scope **who enabled developer insights** (`developer_insights_enabled`, off by default). The scores are
  meant to show where the environment gets in the way, not to rank people (no ranking of individuals exists in the app).

**k-anonymity**

- Any aggregate of individual data (team developer averages, DDPS, workload balance, burnout counts, DDPS history points, pulse results and
  comments) is shown only with **at least 3 contributors** (`K_ANONYMITY_MIN = 3`, `server/lib/privacy.ts`); otherwise the API returns no
  value and `privacy: { suppressed: true, … }` without revealing how many there were. Company totals use only teams that reach 3 themselves.
  Do not try to work around it (e.g. by creating tiny teams or one-person teams).
- The pulse survey cannot be imported by design: answers are stored without user id or time.

**Business data**

- Send revenue and customer figures as monthly **team-level aggregates**; no customer names or ids. Revenue figures are visible to everyone
  who can open the team's analytics (team members included); make sure that is acceptable before you send real revenue.

---

## 12. Gaps: not yet available via API

Data the app displays but that **cannot be sent with an API key today**:

| Data (table) | Screens affected | What exists today |
|---|---|---|
| Pipeline runs (`pipeline_runs`) | Dashboard **Pipeline health** gauge (25 % of engineering health) | Nothing (sample data only). Engineering health is computed without it ("n of 4 components"). |
| Stage execution history (`pipeline_execution_summary`) | CI/CD pipeline: stage executions over 14 days | Nothing (sample data only) |
| Pipeline stages: creating stages (`pipeline_stages`) | CI/CD pipeline: stage flow, bottleneck score | Edit existing stages only (UI / Session) |
| Test execution runs (`test_execution_runs`) | Test execution timeline | Nothing |
| Test cases and executions (`test_cases`, `test_executions`) | Flaky tests: run history | Nothing |
| Flaky tests (`flaky_tests`) | Flaky tests | Nothing (a commented-out ingest sketch in `server/routes/analytics.ts`) |
| Performance test results (`performance_metrics`) | Performance | Nothing; SLA thresholds are configurable |
| Technical debt items: create, severity, status (`technical_debt`) | Technical debt page, tech debt score (Team detail), tech debt health (dashboard, 20 % of engineering health), revenue impact debt figures | Edit ROI inputs and effort of existing items only (UI / Session) |
| DDPS history (`developer_productivity_snapshots`) | Developer productivity: DDPS history chart | Nothing (sample data only); `POST /api/metrics/developer` keeps only the current row |
| Developer metrics (`developer_metrics`) | Developer productivity, Team detail, workload balance | UI / Session only (5.1) |
| Business impact monthly data (`business_impact_*`) | Business impact (all tabs) | UI / Session only (5.2) |
| Incidents (no table) | — | Only as computed KPIs and monthly downtime (5.7) |
| Pulse survey answers | Wellbeing pulse, wellbeing on the dashboard | By people in the app only (by design) |
| Reading data with an API key | — | Keys are write-only; reading needs a user session |
| Department- or company-level KPIs | — | KPIs are per team; company figures are always derived |
| Deleting a KPI value | — | Corrections only (4.5) |

Practical consequence for a real (non-demo) company today: team KPIs, QA score, DORA, targets, alerts, TV, compare, rankings, reports and
the ingestion log can be fully populated by integrations; developer productivity and business impact can be populated by people or by
session scripts; pipeline health, stage history, test execution, flaky tests, performance, debt items and DDPS history stay empty (empty
states, never invented values) until write paths exist.

---

## 13. Endpoints in flux

- **Business impact / revenue impact** (`/api/analytics/business-impact-v2/*`, `/api/revenue-impact/*`, `server/lib/revenueImpact.ts`,
  `server/lib/revenueImpactData.ts`, `server/lib/financialConfig.ts`, `server/lib/metricFormulas.ts`) is under active development: the revenue
  impact routes were added on 2026-11-18 and their response shapes, formulas and money summaries are still changing. This guide documents
  the **write** endpoints and the stored fields, which were unchanged by that work (it moved the statistics and ROI helpers into shared
  libraries). Do not build a client on the *response* shapes of `GET /api/revenue-impact/*` or `GET /api/analytics/business-impact-v2/:teamId`
  yet.
- All **Session** endpoints (section 5) are internal and may change with any release.
- `POST /api/ingest/kpis` is the stable integration surface. Adding a metric would add a key to `KPI_COLUMNS`; existing keys and the
  request format are what this guide describes.

---

## 14. Appendix: example files and verification log

### 14.1 Example files (`docs/integration-examples/`)

| File | What it does | Needs |
|---|---|---|
| [`send-all-kpis.sh`](integration-examples/send-all-kpis.sh) | One value for all 23 KPIs for a team (curl) | bash, curl ≥ 7.55 |
| [`send_all_kpis.py`](integration-examples/send_all_kpis.py) | Same, Python | Python 3.8+, `requests` |
| [`send-all-kpis.ts`](integration-examples/send-all-kpis.ts) | Same, TypeScript; exports `ingest()` with retries and typed items | Node 18+, `npx tsx` |
| [`irongate_ingest.py`](integration-examples/irongate_ingest.py) | Reusable client: body-hash Idempotency-Key, backoff on 429 / 5xx / network, 100-item chunks | `requests` |
| [`ci_report_to_irongate.py`](integration-examples/ci_report_to_irongate.py) | Coverage (Istanbul, Cobertura, JaCoCo, LCOV), JUnit time, build time from a CI job | `irongate_ingest.py` |
| [`dora_to_irongate.py`](integration-examples/dora_to_irongate.py) + [`sample-dora-events.json`](integration-examples/sample-dora-events.json) | DORA + MTBF + availability from events, several teams, backfill | `irongate_ingest.py` |
| [`jira_to_irongate.py`](integration-examples/jira_to_irongate.py) | Defect escape rate and density from JQL counts | `irongate_ingest.py`, Jira token |
| [`sonarqube_to_irongate.py`](integration-examples/sonarqube_to_irongate.py) | Coverage and code quality score from SonarQube measures | `irongate_ingest.py`, Sonar token |
| [`backfill_csv.py`](integration-examples/backfill_csv.py) + [`sample-history.csv`](integration-examples/sample-history.csv) | History from a CSV, batched, partial mode | `irongate_ingest.py` |
| [`session_upload.py`](integration-examples/session_upload.py) | Developer metrics, business-impact months, debt ROI inputs through the internal session endpoints | `requests`, a user account |

### 14.2 What was executed (local instance, 2026-11-18)

Against a fresh database prepared with `scripts/ci/prepare-db.sh` and the API started with `npx tsx server/index.ts`; API key created
through `POST /api/admin/api-keys` as the seeded super admin; new empty teams created for the tests.

| Check | Result |
|---|---|
| `send-all-kpis.sh`, `send_all_kpis.py`, `send-all-kpis.ts` (and `tsc --strict` on the TS file) | Passed: 23 of 23 KPIs written, QA score 89 (good) |
| Minimal curl, Node.js and Python snippets of sections 6.1–6.3 | Passed (200, values written) |
| Single item, `Idempotency-Key` replay, same key + different body | 200; replay 200 with `Idempotent-Replayed: true`; 422 |
| Error cases of section 4.9 (no key, bad key, validation, `manual`, extra field, future, > 365 days, bad date, foreign team, empty metrics, empty batch, bad JSON, bad source, bad header key, partial 207, partial all-bad, 61 requests → 429, 120 kB body → 413, revoked key → 401, non-admin key creation → 403) | Responses as documented |
| Backfill, per-item duplicate, correction with same `recordedAt`, integer rounding (8.6 → 9, 14.4 → 14) | As documented (sections 4.4–4.6) |
| `irongate_ingest.py` retry after 429 | Waited `Retry-After` (43 s), then written |
| `dora_to_irongate.py --backfill-days 30` (2 teams, 62 items, 1 request) and re-run | Written; re-run replayed |
| `backfill_csv.py` (398 items, 4 requests, 1 bad row) and re-run | 397 written, 1 rejected and reported; re-run replayed |
| `ci_report_to_irongate.py` with Istanbul, Cobertura, JaCoCo, LCOV, JUnit samples; same `--run-id` twice | Values 81.2 / 77.34 / 85.0 / 83.33; second send `duplicate` |
| `sonarqube_to_irongate.py`, `jira_to_irongate.py` against local mocks of the SonarQube / Jira APIs | IronGate side written; the external APIs themselves were **not** called |
| `session_upload.py developer / business / debt-impact` | Saved; business impact showed 11 paired months and correlations; developer rows replaced as documented |
| Session endpoints `PUT /api/analytics/pipeline-stages/:id`, `PUT /api/analytics/pipeline-config`, `POST /api/admin/configs`, `PUT /api/targets` | 200 as documented |
| CI definitions (GitHub Actions, Jenkinsfile, GitLab CI), Jenkins / GitHub / GitLab / PagerDuty API calls | **Not executed** (no such systems available); syntax reviewed only |
