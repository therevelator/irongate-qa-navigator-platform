# Security Review — IronGate QA Navigator

Date: 2026-10-20. Scope: the Express + PostgreSQL API (`server/`, `netlify/functions/api.ts`)
and the React client (`src/`). Method: full authorization/tenancy code review of every
route handler, plus dynamic exploitation against a local instance loaded with the production
data snapshot. Every finding below was **confirmed by a working exploit** and is **fixed** in
the same change set; each fix was re-tested to confirm the exploit no longer works. Automated
regression tests are in `tests/api/security.test.ts`.

The app is multi-tenant: the hard security boundary is the **company** (tenant). Within a
company there is role-based access (super_admin → qa_manager → team_lead → qa_engineer →
viewer). The dominant class of bug was **missing tenant scoping**: handlers took a `teamId` /
`userId` from the URL or body and read/wrote it without checking it belonged to the caller's
company.

## Summary

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | Critical | JWT signing-secret falls back to a hard-coded public default | Fixed |
| 2 | Critical | Privilege escalation: any user could set their own role (e.g. to super_admin) | Fixed |
| 3 | Critical | Cross-tenant user takeover via `PUT /api/admin/users/:id` | Fixed |
| 4 | High | Cross-tenant read/write of business-impact data (revenue, churn, NPS) | Fixed |
| 5 | High | Cross-tenant write of KPI & developer metrics (`/metrics/manual`, `/metrics/developer`) | Fixed |
| 6 | High | Cross-tenant metric reads by team id (several `/metrics/*`, `/teams/:id/*`) | Fixed |
| 7 | High | `GET /api/metrics/dashboard` required no authentication | Fixed |
| 8 | High | `/analytics/ddps-history` ignored its own access check | Fixed |
| 9 | Medium | Company-config writes had no role check (viewer could edit ROI/cost settings) | Fixed |
| 10 | Medium | Team create/update had no role check; unvalidated department/lead ids | Fixed |
| 11 | Medium | LLM "AI analysis" route: prompt injection + unsanitized HTML render (XSS) + cost abuse | Fixed |
| 12 | Medium | No rate limiting anywhere (brute force, LLM cost abuse) | Fixed |
| 13 | Medium | Developer-insights opt-out ignored; team_lead could read any team's developer data | Fixed |
| 14 | Low | Error responses leaked internal messages (`details: error.message`, body-parser errors) | Fixed |
| 15 | Low | Weak password policy (6 chars on reset; none on register/create) | Fixed |
| 16 | Low | CORS reflected origins by `startsWith` (prefix bypass) | Fixed |
| 17 | Info | `VITE_*` integration tokens are compiled into the public client bundle (not currently set) | Documented |

## Findings

### 1 — Hard-coded JWT fallback secret (Critical)
`server/middleware/auth.ts` and `server/routes/auth.ts` fell back to
`'your-secret-key-change-in-production'` when `JWT_SECRET`/`secrettoken` were unset. Anyone
who knows that default (it is in the public source) could forge a valid token for **any**
`userId`/`role`/`companyId` — full admin of every tenant. `metrics.ts` used
`process.env.JWT_SECRET!` with no fallback, so behaviour was also inconsistent.
**Exploit:** a token signed with the default secret was accepted as super_admin.
**Fix:** the secret is resolved once in `auth.ts`; in production the process **refuses to
start** without a real secret (fail closed) instead of using a default. All three call sites
share that one secret.

### 2 — Self privilege escalation (Critical)
`PUT /api/users/:id` built its update from the body and applied `role`, `department_id`,
`primary_team_id`, `is_active` for self-updates. A qa_engineer could `PUT /api/users/<own id>`
with `{"role":"super_admin"}` and become super_admin.
**Fix:** profile fields (name, email, phone, timezone) remain self-editable; the privileged
fields are only honoured for super_admin/qa_manager, and a non-admin who sends them is
rejected (403).

### 3 — Cross-tenant user takeover (Critical)
`PUT /api/admin/users/:id` (super_admin path) looked up and updated the target user with no
`company_id` filter. A super_admin of company B could rewrite a company A user — including
their role and email — i.e. account takeover across tenants.
**Fix:** the lookup and `UPDATE` are scoped to the caller's `company_id`, and a caller may only
assign a role they are allowed to create. The same missing `company_id` scope was fixed on the
other super_admin-path handlers in `admin.ts`: user/team toggle-status, team update, team
delete, and user delete.

### 4–6 — Cross-tenant metric access (High)
`business-impact-v2/:teamId` (GET + the quality-metrics / business-kpis / context /
calculate-correlations / bulk-save writes), `POST /metrics/manual`, `POST /metrics/developer`,
`GET/POST /metrics/business-impact-config/:teamId`, `GET /metrics/teams/:teamId[/history|/velocity]`,
`GET /metrics/team/:teamId/all`, and `GET /teams/:id/kpi-history` all used
`WHERE team_id = ?` with a team id taken straight from the request, no company check. Any
authenticated user could read or overwrite another company's QA scores, developer happiness,
and financial figures (revenue, churn, NPS).
**Fix:** a single helper (`server/middleware/access.ts`) enforces tenancy. `assertTeamRead`
(company scope; own-team for lower roles) guards reads; `assertTeamWrite` (super_admin /
qa_manager-in-department / team_lead-own-team) guards writes. `/metrics/developer` also checks
the developer belongs to the company.

### 7 — Unauthenticated dashboard (High)
`GET /api/metrics/dashboard` had no `authenticateToken` and no company filter — it reached the
database for an anonymous caller. (It also queried tables/columns that do not exist in the
current schema, so it was additionally broken — see Functional bugs.)
**Fix:** requires authentication and scopes every query to the caller's company; rewritten
against the real schema.

### 8 — Access result ignored (High)
`GET /analytics/ddps-history` computed `{ allowed }` from `getTeamIdForRole` but never checked
it, so a team_lead requesting another team fell through to an unfiltered query over the whole
company's per-developer productivity data.
**Fix:** `allowed` is enforced (403) and the requested team is company-scoped.

### 9–10 — Missing role checks on writes (Medium)
`PUT /analytics/pipeline-config`, `PUT /analytics/pipeline-stages/:id`,
`PUT /analytics/technical-debt/:id/impact` were company-scoped but had no role check — a viewer
could change company-wide ROI/cost settings. `POST /api/teams` and `PUT /api/teams/:id` had no
role check and did not validate that the supplied `departmentId`/`leadId` belonged to the
company.
**Fix:** write role checks added (`canManageCompanyData`); team create/update validate the
department and lead against the caller's company and apply team-write scoping.

### 11 — LLM route: prompt injection, XSS, cost abuse (Medium)
`POST /analytics/business-impact-v2/:teamId/ai-analysis` took a `correlations` array from the
request body and interpolated attacker-controlled strings straight into the Groq prompt, with
no team scope, role check, or size cap. The model's HTML response was then rendered on the
client with `dangerouslySetInnerHTML` **without sanitization** (`BusinessImpactAnalysisV2.tsx`),
so injected markup could execute.
**Fix:** the route now scopes to the owned team, rebuilds the correlation matrix **from the
database** (never the body), caps it at 50 rows, and strips metric labels to a safe charset
before they reach the model. The client sanitizes the HTML with DOMPurify before rendering.
`src/utils/notifications.ts` was also changed to insert messages via `textContent` rather than
`innerHTML`.

### 12 — No rate limiting (Medium)
There was no throttling on login (credential stuffing) or on the paid LLM routes (cost abuse).
**Fix:** `express-rate-limit` added (`server/middleware/rateLimit.ts`): a general API ceiling,
a strict auth limiter (failed logins only), and a strict limiter on AI routes, wired into both
the Railway server and the Netlify function. Note: the store is per-process/in-memory, so on
serverless it limits per warm instance rather than globally — a shared store (Redis/Postgres)
would make it a hard global cap. `trust proxy` is set so the limiter keys on the real client IP.

### 13 — Developer-insights opt-out ignored (Medium)
`GET /teams/:id/developer-ai-suggestions` claimed to return data "only for users with
developer_insights_enabled" but never filtered on it, and a team_lead could request any team.
**Fix:** the query filters `developer_insights_enabled = true`, and team_lead is limited to
their own team (also applied to `/teams/:id/ai-suggestions`).

### 14 — Error message leakage (Low)
Several handlers returned `details: error.message`, and both global error handlers returned
`err.message`, exposing internal/SQL detail to clients.
**Fix:** details are logged server-side only; clients get a generic message.

### 15 — Password policy (Low)
Reset required only 6 characters; register and admin-create enforced no length.
**Fix:** a minimum of 8 characters on register, admin-create, and reset.

### 16 — CORS prefix match (Low)
`server/index.ts` allowed an origin if it `startsWith` an allowed value, so
`http://localhost:5173.evil.com` matched `http://localhost:5173`.
**Fix:** exact-match comparison. (The auth cookie is `SameSite=strict` in production, which
already blocks cross-site credentialed use; this is defense in depth.)

### 17 — Client-bundled integration tokens (Info / not changed)
`.env.example` documents `VITE_JENKINS_TOKEN`, `VITE_GITHUB_TOKEN`, `VITE_SONAR_TOKEN`, etc.
Any `VITE_*` value is compiled into the **public** JavaScript bundle and is readable by anyone.
The current production bundle contains only placeholders (these are not set), so nothing is
leaked today, but **if these are ever set they become public**. Recommendation: move any real
third-party integration through the backend and drop the `VITE_` prefix. Left as-is because it
needs a product decision about how those integrations should work; no secret is exposed now.

## What was NOT vulnerable
- **SQL injection:** every query uses bound `?` parameters; the few `${…}` fragments in SQL are
  fixed constants, not user input.
- **Tenant-scoped routes that were already correct:** most read routes in `analytics.ts`
  (`/test-executions`, `/test-cases`, `/flaky-tests`, `/performance-metrics`, `/technical-debt`,
  `/pipeline-history`, `/company-summary`), the `settings.ts` routes, and the `departments.ts`
  routes already filtered by company.

## Functional bugs fixed alongside
These were pre-existing crashes (HTTP 500), unrelated to the MySQL→Postgres move:
1. `teams.platform` column was referenced but never existed → added the column; team
   create/update now work.
2. `GET /metrics/dashboard` queried a non-existent `defects` table and wrong `test_executions`
   columns → rewritten against the real schema.
3. `GET /metrics/developer/:id` and `/history` used `user_id`/`recorded_date` (real columns are
   `developer_id`/`created_at`) → fixed.
4. `POST /metrics/business-impact-config/:teamId` used `require('crypto')` under ESM (crashes)
   → uses an `import`.
5. The `'manager'` role string was checked in 9 places, but the role is `qa_manager`; this
   silently locked qa_managers out of settings, configs, manual metrics, and AI features →
   corrected to `qa_manager`.

## Verification
- `tests/api/security.test.ts` — 6 regression tests (tenant isolation, self-escalation, unauth
  dashboard, JWT forgery, password policy), all passing.
- Existing `tests/database` (8) and `tests/api/admin` (18) suites still pass.
- Manual exploit script: every confirmed exploit returns 401/403/404 after the fix; legitimate
  role operations (qa_manager managing their department, team_lead writing their own team,
  users editing their own profile, admins managing their own company) still succeed.
