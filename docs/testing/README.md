# UI tests (Playwright)

The UI suite drives the real app in Chromium: the React app on `http://localhost:5173`, the Express
API on `http://localhost:3000`, a Postgres database prepared like production (schema, snapshot,
migrations, demo seed). It covers every user flow, for every role that can do it, and the negative
cases around them. The list of flows and which test covers each one is
[E2E_FLOWS.md](E2E_FLOWS.md).

Every automated test also exists as a manual test case with step-by-step directions:
[MANUAL_TEST_CASES.xlsx](MANUAL_TEST_CASES.xlsx) (columns for the actual result, status, tester and date,
and a summary sheet) and the same cases as [MANUAL_TEST_CASES.md](MANUAL_TEST_CASES.md). What each role may see and do (the expected results of the
role tests) is [docs/ROLE_ACCESS.md](../ROLE_ACCESS.md).

- [Run it on your computer](#run-it-on-your-computer)
- [Run a subset](#run-a-subset)
- [Run the read-only checks against a deployed site](#run-the-read-only-checks-against-a-deployed-site)
- [In GitHub Actions](#in-github-actions)
- [Read the report](#read-the-report)
- [Add a test](#add-a-test)
- [Conventions](#conventions)

## Run it on your computer

Works on macOS, Linux and Windows (the runner is Node, not bash).

**Once per machine**

1. Node.js 22 or newer, and `npm ci` in the repository.
2. Playwright's Chromium: `npx playwright install --with-deps chromium`
   (on Windows and macOS `npx playwright install chromium` is enough).
3. A Postgres the tests may use, one of:
   - **Docker** (Docker Desktop or the Docker engine with compose v2): nothing else to do. The runner
     starts `postgres:16` from [`docker-compose.test.yml`](../../docker-compose.test.yml) on port
     **55432** (in memory) and stops it at the end.
   - **A Postgres you already run locally**: copy `.env.test.example` to `.env.test` and set
     `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/irongate_ui_test`. The host must be
     `localhost` / `127.0.0.1` and the database name must contain `test`: the runner drops and creates
     that database on every run.

**Every time**

```bash
npm run test:ui:local            # everything (about 5 minutes with 2 workers)
npm run test:ui:local:smoke      # the @smoke subset (about 1 minute)
npm run test:ui:local:headed     # watch it in a browser window (one worker)
npm run test:ui:local:ui         # Playwright UI mode: pick, run and debug tests interactively
npm run test:ui:local:report     # open the HTML report of the last run
```

What `npm run test:ui:local` does (`scripts/ui-tests/run-local.mjs`):

1. checks Node 22, Playwright's Chromium and that ports **3000** and **5173** are free (stop
   `npm start` / `npm run dev` first; it says so if they are busy);
2. gets the database (`TEST_DATABASE_URL`, else Docker) and refuses any host that is not this machine,
   so the hosted Supabase database can never be touched;
3. creates and prepares the test database (`scripts/ui-tests/prepare-db.mjs`, the Node twin of
   `scripts/ci/prepare-db.sh`);
4. starts the API and the web app with an explicit test environment. **Your `.env` is never read**
   (the servers get `DOTENV_CONFIG_PATH=.env.test` or an empty file), and `RESEND_API_KEY`,
   `SMTP_HOST` and `GROQ_API_KEY` are blanked, so no real e-mail, AI or Slack call leaves the machine.
   E-mails are written to `logs/ui-tests/mail.jsonl` so tests can follow their links;
5. runs Playwright and then stops the servers (and the Docker database).

Options, after `--`: `--grep <text>`, `--workers <n>`, `--reuse-db` (skip preparing an already prepared
database: faster re-runs), `--keep-db` (leave the Docker database running), `--trace` (record traces),
and any Playwright argument such as a folder: `npm run test:ui:local -- tests/e2e/pulse`.
Server logs: `logs/ui-tests/`.

If something goes wrong: the message says what to do (Node version, Chromium missing, port busy, no
database, non-local host). A test that failed keeps a screenshot (and with `--trace` a trace) in the
report.

## Run a subset

Every test carries tags in its title, so `--grep` selects them (locally after `--`, in CI with the
workflow input):

| Tag | What |
|---|---|
| `@smoke` | The main flows, about 40 tests. Gate on every push (ci.yml). |
| `@negative` | Refusals, validation, bad tokens, server errors, offline, double submits, markup in input. |
| `@a11y` | axe-core accessibility checks of the main pages. |
| `@readonly` | Checks that change nothing and work with any account (the only ones run against a live site). |
| `@role:admin`, `@role:manager`, `@role:lead`, `@role:engineer`, `@role:viewer` | Tests for that role. |
| `@area:auth`, `@area:navigation`, `@area:dashboard`, `@area:team`, `@area:tv`, `@area:analytics`, `@area:compare`, `@area:saved-views`, `@area:business-impact`, `@area:parameters`, `@area:targets`, `@area:alerts`, `@area:actions`, `@area:slack`, `@area:pulse`, `@area:org`, `@area:activity`, `@area:onboarding`, `@area:admin`, `@area:metrics`, `@area:demo-data`, `@area:operator`, `@area:ux`, `@area:resilience`, `@area:privacy`, `@area:ai` | One part of the product. |

Examples: `npm run test:ui:local -- --grep "@area:pulse"`, `--grep "@negative.*@role:viewer"`,
`--grep "AUTH-0"` (test ids are in the titles too).

## Run the read-only checks against a deployed site

```bash
UI_REMOTE_EMAIL=you@company.com UI_REMOTE_PASSWORD='...' \
  npm run test:ui:remote -- --base-url https://your-site.netlify.app --i-understand-this-is-live
```

(or put `UI_REMOTE_EMAIL` / `UI_REMOTE_PASSWORD` in `.env.test`). Only `tests/e2e/readonly` runs: sign-in
screen, sign in, open every page in the navigation, unknown addresses, theme switch, phone width.
Nothing is created or changed (the sign-in and the pages opened are recorded in that company's User
activity log, as for any person). Without `--i-understand-this-is-live` or the credentials it refuses to
start, and `--grep` or file arguments are refused. `--list` shows what would run without opening anything.

## In GitHub Actions

- **UI tests** ([`.github/workflows/ui-tests.yml`](../../.github/workflows/ui-tests.yml)): the full
  suite on pushes to `main` (and `claude/**` branches), pull requests, nightly at 03:17 UTC, and by hand
  (Actions → UI tests → Run workflow) with a subset: `all`, `smoke`, `negative`, `a11y` or `grep` plus a
  grep string. Four shards with three workers each; one retry in CI (a test that needed it shows as
  *flaky* in the report). Target wall time under 20 minutes (about 8 to 10 today).
- **CI** ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)), job *End-to-end smoke*: the
  `@smoke` subset on every push, next to the typecheck, build, API and database tests.

Both prepare the database with `scripts/ci/prepare-db.sh` and start the services with
`scripts/ci/start-services.sh` through `.github/actions/setup-test-env`.

## Read the report

- CI: the run's **ui-tests-report** artifact is one merged HTML report of all shards (download, unzip,
  open `index.html`, or `npx playwright show-report <folder>`). For failures there is also
  **ui-failures-shard-N** with traces, screenshots, videos and the API / web / mail logs.
  Open a trace with `npx playwright show-trace trace.zip` or at <https://trace.playwright.dev>.
- Locally: `npm run test:ui:local:report`.
- Annotations in the report: *known a11y issue* (accessibility problems already tracked in
  E2E_FLOWS.md) and *fail* (a test marked `test.fail()` because of a recorded issue: it passes while the
  issue exists and turns red once the issue is fixed, so the mark can be removed).

## Add a test

1. Find the flow in [E2E_FLOWS.md](E2E_FLOWS.md); add a row if it is new.
2. Put the test in the area folder (`tests/e2e/<area>/…spec.ts`). Import from the support folder:

   ```ts
   import { test, expect, TAG } from '../support/fixtures';

   test('PUL-20 a lead does X', { tag: [TAG.role('lead'), TAG.negative] }, async ({ signInAs, page, app }) => {
     await signInAs('lead', '/analytics/pulse');   // signed in through the API, page opened
     await app.go('nav-compare', 'Compare teams'); // navigation page object
   });
   ```
3. Data: never depend on what another test leaves behind.
   - Company-wide changes: use the `freshCompany` fixture (a new organisation, removed afterwards).
   - Team data in the demo company: `createFixtureTeam()` / `createFixtureUser()` from
     `support/data.ts`, removed in `afterAll`.
   - Names: `uid()` from `support/ids.ts`.
   - Read-only checks may use the demo data (`DEMO` in `support/roles.ts`).
4. Give it an id (`AREA-nn`) in the title, tags, and update E2E_FLOWS.md.

## Conventions

- **Selectors**: roles and labels first (`getByRole`, `getByLabel`), then `data-testid`; add a
  `data-testid` to a component only when there is no stable accessible name.
- **No sleeps**: web-first assertions (`expect(locator).toBeVisible()`, `expect.poll`). The only waits
  are the one-second gaps the session rules need ("a session of the same second stays valid").
- **No fixed dates**: dates come from the app or the database (`CURRENT_DATE`), never from the test.
- **Stubbed outside services**: Google / Microsoft SSO, Groq (executive briefing), sample-data seeding
  and server failures use `page.route`; Slack uses a local receiver (`NOTIFY_SLACK_ALLOW_LOCAL`); e-mail
  is read from `MAIL_CAPTURE_FILE`. Nothing real is called.
- **Limits**: the API allows 20 failed sign-ins and 5 forgot-password requests per address per
  15 minutes. Tests that need failures use their own client address (`useOwnClientAddress`), so the
  suite can run again straight away. The platform-support step-up locks after 5 wrong passwords: avoid
  wrong passwords there.
- **Parallel and repeatable**: the suite runs with several workers, in any order, and again on the same
  database. Files that share state between their tests use `test.describe.configure({ mode: 'serial' })`
  or `'default'` (in order).
- **Found a bug?** Small and clear: fix it with a test. Larger: record it under "Found issues" in
  E2E_FLOWS.md and mark the test `test.fail(true, 'Found issue FI-nn …')`; never skip a test silently.
