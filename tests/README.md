# Tests

| Folder | Runner | Command |
|---|---|---|
| `api/` | Jest; most suites call the API on http://localhost:3000, some are pure unit tests | `npm run test:api` |
| `database/` | Jest against the database in `DATABASE_URL` | `npm run test:db` |
| `e2e/` | Playwright (Chromium), every user flow per role, negative cases, accessibility, phone layouts | `npm run test:ui:local` |
| `fixtures/` | Sample reports and data used by the suites | |

`npm run test:unit` runs all Jest suites (`api/` and `database/`). `setup.ts` is the Jest setup file.

How to run the UI suite, subsets, the report and how to add a test: [docs/testing/README.md](../docs/testing/README.md).
Every flow with its tests: [docs/testing/E2E_FLOWS.md](../docs/testing/E2E_FLOWS.md). Manual versions of the UI
tests: [docs/testing/MANUAL_TEST_CASES.md](../docs/testing/MANUAL_TEST_CASES.md).

CI (`.github/workflows/ci.yml`) prepares a Postgres 16 database with `scripts/ci/prepare-db.sh`, starts the API
with `scripts/ci/start-services.sh` and runs the API and database suites and the `@smoke` UI subset;
`.github/workflows/ui-tests.yml` runs the full UI suite.

Older scenario lists that were here were removed on 23 Nov 2026 (git history: `docs/archive/tests/`).
