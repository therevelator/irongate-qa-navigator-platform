# IronGate QE Navigator

[![CI](https://github.com/therevelator/irongate-qa-navigator-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/therevelator/irongate-qa-navigator-platform/actions/workflows/ci.yml)

Quality-engineering metrics for engineering organisations: team KPIs, a company dashboard,
analytics modules and user / team administration.

Every number shown comes from the database. Missing data is shown as "—" or "No data
recorded", never as an invented value. Sample-data generators exist for demos but are off
unless the API is started with `ENABLE_SYNTHETIC_DATA=true`.

## Stack

- Frontend: React 19, TypeScript, Vite, Tailwind CSS 4, Recharts (`src/`)
- API: Express 5 on Node, PostgreSQL via `pg` (`server/`; DB helper `src/lib/db.ts`)
- Deployment: a single Node service (Railway, `npm run server:prod` serves `dist/`) or
  Netlify (static site + `netlify/functions/api.ts`; no cron jobs or WebSocket there)
- Schema: `supabase/migrations/` (apply in timestamp order)

## Getting started

```bash
npm install
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
npm run server                # API on http://localhost:3000
npm run dev                   # app on http://localhost:5173
```

Registering creates a **new** organisation and makes you its super admin. People join an
existing organisation only by invitation (Users page → **Invite**), see
[Organisation, roles and access](#organisation-roles-and-access).

## Sample (demo) data

One command fills every table with a fictional, internally consistent company for demos:
**Northwind Payments (Sample data)**: 4 departments, 10 teams, 57 users in all roles, about
120 days of daily KPI history up to today (some teams strong, some struggling, slowly
trending), plus developer productivity, CI/CD pipeline runs, test cases, executions and flaky
tests, performance metrics, technical debt with financial impact, 12 months of business-impact
data and company KPI snapshots. KPI values are marked `field_sources.<column>.source =
'synthetic'`. Business-impact rows have `data_source = 'synthetic'`. Organisation data
includes the role assignments (one QA manager, Sofia Lindqvist, manages two departments; some
engineers belong to two teams), a short change history (the department rename can be undone)
and sample invitations (pending, expired, accepted, revoked; their links never work).

```bash
npm run seed:demo                              # demo company -> DATABASE_URL (local hosts only)
npm run seed:demo -- --fill-existing           # also fill existing companies' teams that lack data
npm run seed:demo:clear                        # remove all demo rows again (both modes)
npm run seed:demo -- --sql out/demo-seed.sql   # demo company as SQL files (no DB connection)
npm run seed:demo -- --fill-existing --sql out/demo-fill.sql   # fill as SQL (reads the local DB to plan)
npm run seed:demo:clear -- --sql out/demo-clear.sql
npm run seed:demo:check                        # coverage: every active team x analytics module, in its window
```

**Fill existing companies** (`--fill-existing`, optional `--company <id>`, repeatable): every
active team of every non-demo company gets the same model wherever the analytics pages would
otherwise be empty. Data is grouped, and a group is skipped only when the team already has real
rows *in the window the page shows*:

| Group | Counts as present when the team has real… |
|---|---|
| KPI snapshots | a snapshot in the last 30 days (then the team keeps its real KPI history) |
| Test executions, daily test totals, performance | rows in the last 7 days |
| Pipeline | runs and daily summaries in the last 7 days |
| Team analytics | a week ending in the last 14 days |
| Sprints | a sprint ending in the last 60 days |
| Business impact | at least 6 of the last 12 months |
| Test cases, flaky tests, tech debt, metric update times | any rows (a team with real test cases but no flaky tests gets demo flaky test cases) |

Developers are handled one by one. Every developer of an active team whose latest real
productivity snapshot is older than 30 days gets 180 days of snapshots, and every developer
without a `developer_metrics` row for the team gets one. A team with fewer than 3 QA engineers,
or fewer than 2 developers who share developer insights, gets demo developer users (password
`demo123`). Each company also gets company KPI snapshots. Every added row has a `demo-` id; the
integer-keyed snapshot tables use ids of 1,000,000,000 or more. `seed:demo:clear` removes them.
In the SQL output, each group is wrapped in a `DO` block that checks again, when it runs, that
the team exists and still lacks that data. That makes it safe to apply on a copy of the
database that differs from the one it was planned on.

`npm run seed:demo:check [-- --company <id>]` prints, per company and team, which modules have
data in their windows. It covers KPI, developer metrics, DDPS (30 days and 6 months), test cases,
flaky tests, test executions (7 days), pipeline history (14 days), runs (30 days) and stages,
performance (7, 30 and 90 days), tech debt, business impact, sprints, team analytics and metric
update times. It exits with code 1 below 100 %.

Seeded flaky tests have no stored root cause, so the API reports their pattern guidance as
unverified.

- **Sign in**: password `demo123` for every demo user. For example, `alex.morgan@northwind.example`
  (super admin), `priya.raman@…` (QA manager), `olivia.bennett@…` (team lead),
  `mia.thompson@…` (QA engineer) and `hannah.brooks@…` (viewer).
- **Additive and idempotent**: every row has an id starting with `demo-`, or belongs to the
  demo company or its users (for tables with integer or composite keys). Every insert is
  `ON CONFLICT DO NOTHING`, and the values come from a seeded PRNG, so a second run on the
  same day adds nothing. A run on a later day only adds the new days. Other companies and
  their existing rows are never changed. `seed:demo:clear` deletes only demo rows, in
  foreign-key order.
- **SQL mode**: `--sql` writes one transaction per file, split into numbered parts of up to
  ~1.4 MB (`demo-seed-01.sql`, `demo-seed-02.sql`, …). Apply the seed parts in order after
  the migrations, then the fill parts. Use `--today YYYY-MM-DD` to fix the last day of history.
- **In the app**: a super admin can choose **Administration → Admin console → Sample data → Load sample data**
  (`POST /api/analytics/seed-data`). This runs the same seed for the demo company and fills the
  admin's own company. It is only available when the API
  runs with `ENABLE_SYNTHETIC_DATA=true`. Otherwise the button is disabled and the endpoint
  returns 409. The background random generators enabled by that flag skip the demo company.
- The CLI refuses a non-local `DATABASE_URL` unless you pass `--allow-remote`. For a hosted
  database, prefer the SQL files.

## Where metrics come from

- **KPI ingestion API** (below): the supported way to feed metrics from CI, issue trackers,
  code analysis and other tools. There are no built-in Jenkins / Jira / SonarQube connectors.
- **Manual metrics** page: the same server path, for values entered by hand.
- **Expected update frequency** (Administration): how often each metric should receive a
  value. It schedules nothing; Team detail marks a metric as stale when its last recorded
  value (`field_sources.recorded_at`) is older than the interval.

## Definitions

One definition per metric, shared by server and UI:

- QA score, technical-debt score, DDPS, burnout risk: `server/lib/metricFormulas.ts`
- KPI thresholds and dashboard targets: `src/config/metricsConfig.ts` (`METRICS_CONFIG`,
  `KPI_TARGETS`, `teamAttentionIssues`, `teamKpiTrack`); QA score bands come from `QA_SCORE_THRESHOLDS`
- Developer health rules: `server/lib/developerHealth.ts`. "Workload balance (derived)"
  (`developer_metrics.happiness_score`) is calculated from focus, meetings, context switches,
  PR and review times; it is not a survey score and is not counted twice.
- Config inheritance (team, then department, then company): `server/lib/configResolver.ts`
- Team membership (primary team or `team_members`): `server/lib/teamMembership.ts`
- Who may do what: `server/lib/userPolicy.ts` (see [ROLE_PERMISSIONS.md](ROLE_PERMISSIONS.md))

## Dashboard

- **Cards per row (1, 2 or 3)**: next to Grid / List in the Team performance section (grid
  view only). Remembered in the browser. Phones always show 1 column, tablets at most 2.
- **Teams vs KPI targets**: the on track / at risk / off track counts in Company status open
  a breakdown (per team: QA score, as-of date, the targets not met with their gap, the ones
  met collapsed). Rule (`teamKpiTrack`): of the four KPI targets recorded for the team
  (coverage, automation, flakiness, escape rate), on track = at least 75% met, at risk = 50%
  to 75%, off track = under 50%; fewer than two recorded = not classified. The counts and
  the list both come from `GET /api/analytics/company-summary` (`kpiStatus`,
  `kpiStatusTeams`), computed by the same function.

## Organisation, roles and access

Migration: `supabase/migrations/20261119000000_org_roles_audit_invitations.sql` (backfills
everything from the existing data; nothing is dropped).

**Role assignments.** Access comes from `role_assignments`: a role on a scope, and a person may
have several.

| Role | Assigned on | Sees / may |
|---|---|---|
| super_admin | the company | everything in the company |
| qa_manager | a department (one or more) | the teams of those departments; manages their teams and users |
| team_lead | a team (one or more; one lead per team) | those teams, other developers' rows there, team data writes |
| qa_engineer / viewer | a team (one or more) | those teams; individual developer data only their own |

- Every access decision reads the assignments through `server/lib/assignments.ts` (loaded per
  request by the auth middleware) and the rules in `server/lib/userPolicy.ts`; the UI uses the
  same rules. A change applies on the person's next request, without signing in again.
- The team lead is the team's `team_lead` assignment (single source of truth).
  `users.role` (highest role), `department_id`, `primary_team_id`, `teams.lead_id`,
  `departments.manager_id` and `team_members` are kept in step for compatibility.
- **Users page:** each person shows assignment chips (role · team / department); **Add** and the
  chip's **×** give or remove an assignment (super admin: any; QA manager: team roles in their
  departments; team lead: engineers / viewers of their teams; never your own, never someone of
  your rank or above). The edit form still sets the primary assignment.
- **Departments page:** "Assign QA manager" adds a department (other departments stay);
  "Change lead" replaces the team's lead, who stays on the team as a QA engineer. Moving a team
  to another department moves its members' departments; QA managers stay in theirs and lose the
  team.

**Change history (Activity page).** Every organisation, role, assignment, team, department,
user and settings change is recorded in `audit_log` with who, when, what (before / after; secrets
masked) and the departments it concerns. Super admins see the whole company, QA managers the
changes of their departments, with filters. **Undo** exists for assignment and role changes,
manager / lead changes, team moves, department renames and user deactivation. An undo restores
the previous state in one transaction and is itself recorded; it is refused, with the reason,
when a newer change touches the same people / team / department, or when the state was changed
outside the history. QA managers may undo user changes inside their departments, not their own.

**Invitations.** Users page → **Invite**: email, role and team / department (within the same
rules as assignments). The person opens `APP_URL/accept-invite?token=…`, sets name and password
(10+ characters, three of lower / upper / digit / symbol, not containing the email name; or uses
SSO) and gets exactly that assignment. Tokens are 256-bit random, stored only as SHA-256, single
use, expire after 7 days (`INVITE_TTL_HOURS`) and can be revoked; **Resend** issues a new link and
the old one stops working. With SMTP configured the email is sent; otherwise the API returns the
link and the dialog shows it to copy (nothing fails silently). "Add with password" remains for
demos and scripted setups.

**Single sign-on (Google, Microsoft).** Off unless configured; the login page asks
`GET /api/auth/providers` and shows only the configured buttons. OpenID Connect with state,
nonce and PKCE (S256); the ID token's signature (provider JWKS), issuer, audience and expiry are
checked. A sign-in matches an existing **active** user by linked identity or verified email, or
an **open invitation** for that verified email; anyone else is refused (no account is created).
It sets the same session cookie as the password login.

Setup: register a web application with the provider and add the redirect URI
`<APP_URL>/api/auth/sso/google/callback` (Google Cloud console → APIs & Services → Credentials →
OAuth client ID) or `<APP_URL>/api/auth/sso/microsoft/callback` (Microsoft Entra → App
registrations; accounts in your organisation; add a client secret; optional claim `email`). Then set:

| Variable | Purpose |
|---|---|
| `APP_URL` | public URL of the app, e.g. `https://qe.example.com` (invitation links, SSO redirect URI and return); on Netlify defaults to `URL` |
| `API_PUBLIC_URL` | only when the API has its own origin (local development: `http://localhost:3000`, the default) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | enable Google sign-in |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` | enable Microsoft sign-in; `MS_TENANT` = your tenant id or domain (a single tenant is recommended: its addresses are trusted; with `organizations` only verified email claims are accepted) |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | send invitation emails (without `SMTP_HOST` links are shown to copy) |
| `INVITE_TTL_HOURS` | invitation lifetime, default 168 |
| `DEMO_MODE` | `true` shows the demo account chips on the login page; default on locally, off in production / on Netlify |

Endpoints: `GET|POST /api/admin/users/:id/assignments`, `DELETE /api/admin/users/:id/assignments/:assignmentId`,
`GET /api/admin/audit`, `GET /api/admin/audit/facets`, `POST /api/admin/audit/:id/undo`,
`GET|POST /api/admin/invitations`, `POST /api/admin/invitations/:id/resend|revoke`,
`GET /api/auth/providers`, `GET /api/auth/sso/:provider/start|callback`,
`GET /api/auth/invitations/:token`, `POST /api/auth/invitations/accept`.

## Team TV mode

A full-screen view of ONE team for a meeting-room screen or a team wall: `/tv?team=<id>`.
Open it with **Open TV mode** on Team detail or in the Analytics scope bar.

- Shows the team name, department, lead and member count, the QA score battery with its
  status and change since the previous snapshot, six key KPIs (value, target, status, change,
  90-day sparkline), "data as of", a clock, and two more panels: 90-day trends with target
  lines, and focus areas (KPIs off target, plus recommended actions for team leads and up).
  Team aggregates only: no member list and no individual developer data.
- Scope: the analytics rule. Admins any team, QA managers the teams of their department,
  team leads / engineers / viewers their own team. `GET /api/tv/teams/:id` answers 403 for
  any other team (also another company's team or an unknown id).
- Refreshes every 60 s, on the live "metrics updated" event and when the tab becomes
  visible; a failed refresh keeps the last data on screen and says so.
- Keys: **F** full screen (if the browser refuses, a message suggests F11), **T** light/dark
  (dark by default, remembered separately from the app theme), **R** auto-rotate the panels
  every 20 s, **← →** or **1–3** panels, **Esc** exit. The controls bar appears on mouse
  move and hides after 4 s, with the cursor.
- Kiosk URL options: `?team=<id>&theme=light|dark&rotate=1`. The layout scales with the
  screen (1366×768 up to 3840×2160) and keeps the screen awake where the browser allows it.

## KPI ingestion API

External systems (CI, issue tracker, code analysis) push team KPIs to `POST /api/ingest/kpis`.
Manual entry in the app uses the same server path (`server/lib/kpiIngest.ts`), so both behave identically:

- **Auth:** `Authorization: Bearer igk_…`. A super admin creates keys in **Admin console → API keys**. The key is shown once; only its SHA-256 hash is stored. A key belongs to one company and can write any team in it. Revoked keys get `401`; a team from another company gets `403`.
- **Body:** `{ "teamId", "source", "recordedAt"?, "metrics": { column: number } }`, or an array of up to 100 such items. The whole array is validated first and then written in one transaction (all or nothing).
  - `source` is a label such as `jenkins`, `jira` or `sonarqube` (`manual` is reserved for the app).
  - `recordedAt` is an ISO 8601 timestamp that defaults to now and cannot be in the future.
  - `metrics` keys are `kpi_snapshots` columns from the whitelist in `KPI_COLUMNS` (`server/lib/kpiIngest.ts`), for example `test_coverage`, `defect_escape_rate`, `change_failure_rate`, `code_quality_score`, `deployment_frequency_per_week`, `lead_time_days` or `mttr_hours`. Values are range-checked, and integer columns are rounded to whole numbers. `null` means "not provided" and does not clear a stored value.
- **Behaviour:** values go into the team's snapshot for today. If today's snapshot is new, every other KPI is carried forward from the team's previous snapshot, so a partial update never wipes the other metrics.
- **Provenance:** each field's `{source, recorded_at}` is stored in `kpi_snapshots.field_sources`. Carried-forward fields keep their original source and date. The team page shows this as "source · as of date".
- **QA score:** `qa_score` and `status` cannot be supplied. A database trigger computes them from the stored inputs using the same rules as `computeQaScore` in `server/lib/metricFormulas.ts`.
- **Rate limit:** 60 requests per minute per key. Open dashboards refresh automatically after each write.

```bash
curl -X POST https://<host>/api/ingest/kpis \
  -H "Authorization: Bearer $IRONGATE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "teamId": "<team id>",
        "source": "sonarqube",
        "recordedAt": "2026-11-17T08:00:00Z",
        "metrics": { "code_quality_score": 82, "test_coverage": 78.4 }
      }'
# → {"result":{"teamId":"…","snapshotDate":"2026-11-17","qaScore":<0–100 or null>,"status":"good|warning|critical|null",
#     "updated":["code_quality_score","test_coverage"],"carriedForward":["defect_escape_rate", …]}}
```


## Tests

```bash
npx tsc --noEmit -p tsconfig.app.json      # frontend types
npx tsc --noEmit -p tsconfig.server.json   # API types
npm run test:api                           # API tests (need the API running on :3000)
npm run test:e2e                           # Playwright role tests (need API + app running)
```

**CI** (`.github/workflows/ci.yml`, GitHub Actions tab) runs on every push to any branch, on
every pull request and on demand, in three jobs:

- `quality`: both typechecks, ESLint (report only: counts go to the job summary), `npm run build`;
- `api-and-db`: a Postgres 16 service prepared like production by `scripts/ci/prepare-db.sh`
  (initial schema, snapshot, later migrations in timestamp order, `seed:demo`,
  `seed:demo -- --fill-existing`), the API started by `scripts/ci/start-services.sh`, then the
  jest API and database suites;
- `e2e`: the same database and API plus the Vite app, then all Playwright specs (HTML report
  uploaded as an artifact).

The same scripts work locally against an empty local database:
`DATABASE_URL=postgres://…@127.0.0.1:5432/irongate_ci scripts/ci/prepare-db.sh`.

## Licence

Proprietary software of IronGate Software LTD. All rights reserved. See [LICENSE](LICENSE).
