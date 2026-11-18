# IronGate QE Navigator

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
existing organisation only when one of its admins creates their account (Users page).

## Sample (demo) data

One command fills every table with a fictional, internally consistent company for demos:
**Northwind Payments (Sample data)**: 4 departments, 10 teams, 57 users in all roles, about
120 days of daily KPI history up to today (some teams strong, some struggling, slowly
trending), plus developer productivity, CI/CD pipeline runs, test cases, executions and flaky
tests, performance metrics, technical debt with financial impact, 12 months of business-impact
data and company KPI snapshots. KPI values are marked `field_sources.<column>.source =
'synthetic'`. Business-impact rows have `data_source = 'synthetic'`.

```bash
npm run seed:demo                              # demo company -> DATABASE_URL (local hosts only)
npm run seed:demo -- --fill-existing           # also fill existing companies' teams that lack data
npm run seed:demo:clear                        # remove all demo rows again (both modes)
npm run seed:demo -- --sql out/demo-seed.sql   # demo company as SQL files (no DB connection)
npm run seed:demo -- --fill-existing --sql out/demo-fill.sql   # fill as SQL (reads the local DB to plan)
npm run seed:demo:clear -- --sql out/demo-clear.sql
```

**Fill existing companies** (`--fill-existing`, optional `--company <id>`): every active team
of every non-demo company gets the same model wherever it has no real data yet. The data is
grouped: KPI snapshots, sprints, metric update times, developer metrics, test cases,
suite runs, daily test totals, pipeline, performance, technical debt, business impact and
weekly analytics. A group is skipped for a team that already has real rows there (for time
series, rows from the last 30 days; so a team with a recent KPI snapshot keeps its real KPI
history). A team with fewer than 3 QA engineers gets demo developer users (password `demo123`).
Each company also gets company KPI snapshots. All of these rows have `demo-` ids; the
integer-keyed snapshot tables use ids of 1,000,000,000 or more. `seed:demo:clear` removes them.
In the SQL output, each group is wrapped in a `DO` block that checks again, when it runs, that
the team exists and still lacks that data. That makes it safe to apply on a copy of the
database that differs from the one it was planned on.

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
  `KPI_TARGETS`, `teamAttentionIssues`); QA score bands come from `QA_SCORE_THRESHOLDS`
- Developer health rules: `server/lib/developerHealth.ts`. "Workload balance (derived)"
  (`developer_metrics.happiness_score`) is calculated from focus, meetings, context switches,
  PR and review times; it is not a survey score and is not counted twice.
- Config inheritance (team, then department, then company): `server/lib/configResolver.ts`
- Team membership (primary team or `team_members`): `server/lib/teamMembership.ts`
- Who may do what: `server/lib/userPolicy.ts` (see [ROLE_PERMISSIONS.md](ROLE_PERMISSIONS.md))

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

## Licence

Proprietary software of IronGate Software LTD. All rights reserved. See [LICENSE](LICENSE).
