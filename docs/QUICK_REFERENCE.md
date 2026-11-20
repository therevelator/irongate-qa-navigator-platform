# Quick reference

Commands, addresses and files used most often. All commands run from the repository root.

## Run

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run server` | API on http://localhost:3000 (restarts on change) |
| `npm run dev` | App on http://localhost:5173 |
| `npm start` | Both of the above |
| `npm run build` | Typecheck and build the app into `dist/` |
| `npm run server:prod` | API and the built app (production mode) |
| `npm run lint` | ESLint |

## Data

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

## Test

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

## Addresses

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

## Configuration

- `.env` (from `.env.example`): at least `DATABASE_URL` and `JWT_SECRET`. All variable names:
  [DEPLOYMENT_GUIDE.md, section 4](DEPLOYMENT_GUIDE.md#4-environment-variables).
- `netlify.toml`: build, redirects, headers. `railway.json`: Node service.

## Where to look

| Question | Document |
|---|---|
| Who can do what | [ROLE_ACCESS.md](ROLE_ACCESS.md) |
| How a number is calculated | [metrics_and_calculations.md](metrics_and_calculations.md) |
| Which API route | [METRICS_API_INDEX.md](METRICS_API_INDEX.md) |
| How to send data | [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) |
| Everything about the product | [PRODUCT_GUIDE.md](PRODUCT_GUIDE.md) |
| All documents | [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md) |
