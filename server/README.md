# API server

The Express 5 API of QE Navigator. It runs as a Node service (`npm run server`, or `npm run server:prod`
in production, which also serves the built app from `dist/`) and, with the same routers, as the Netlify
Function [`netlify/functions/api.ts`](../netlify/functions/api.ts).

## Run locally

```bash
cp .env.example .env    # set DATABASE_URL (PostgreSQL) and JWT_SECRET
npm run server          # http://localhost:3000, restarts on change
```

The schema is `supabase/migrations/`, applied in file-name order. See [docs/TECHNICAL_DOCUMENTATION.md](../docs/TECHNICAL_DOCUMENTATION.md#run-it-locally).

## Layout

| Path | Contents |
|---|---|
| `routes/ingestMore.ts` | Raw ingestion of load-test results, test management records, pull requests and calendar free/busy (`lib/ingest/performanceReports.ts`, `lib/calc/automation.ts`, `lib/developerFromRaw.ts`) |
| `lib/analyticsFromRaw.ts`, `lib/liveData.ts` | The Analytics modules read from the raw tables; the Live data only company setting |
| `index.ts` | App setup: request context, CORS (exact origins), body parsers (skipped for raw ingestion), rate limit, routers, `/health`, WebSocket, static files in production |
| `routes/` | One router per area, mounted under `/api/...` |
| `middleware/` | `auth.ts` (session), `apiKey.ts` (ingestion keys), `access.ts`, `rateLimit.ts`, `errorHandler.ts` |
| `lib/` | Domain logic; access rules in `lib/userPolicy.ts`; the KPI write path in `lib/kpiIngest.ts` |
| `lib/ingest/`, `lib/calc/` | Raw data parsers and the calculation engine |
| `lib/forecast/`, `lib/recommendations/` | Forecasts and recommendations |
| `jobs/` | Scheduled jobs (`node-cron`, Node service only; Netlify uses scheduled functions) |
| `seeds/` | Demo seed (`npm run seed:demo`) |
| `scripts/operatorCreate.ts` | `npm run operator:create` |
| `websocket.ts` | Live updates on `ws://<host>/ws` (Node service only) |

The database helper is [`src/lib/db.ts`](../src/lib/db.ts) (`query`, `queryOne`, `transaction`, `?`
placeholders).

## Routes and rules

- Every route: [docs/METRICS_API_INDEX.md](../docs/METRICS_API_INDEX.md).
- Who may call what: [docs/ROLE_ACCESS.md](../docs/ROLE_ACCESS.md) and `lib/userPolicy.ts`.
- Sign-in and sessions: [docs/TECHNICAL_DOCUMENTATION.md](../docs/TECHNICAL_DOCUMENTATION.md#authentication-and-authorisation-in-the-code).
- Sending data: [docs/INTEGRATION_GUIDE.md](../docs/INTEGRATION_GUIDE.md).
- Scheduled jobs and environment variables: [docs/DEPLOYMENT_GUIDE.md](../docs/DEPLOYMENT_GUIDE.md).
