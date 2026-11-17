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
