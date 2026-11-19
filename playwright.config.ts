import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration of the UI (end-to-end) suite. How to run it: docs/testing/README.md.
 *
 *  - Local:  npm run test:ui:local   (scripts/ui-tests/run-local.mjs prepares a test database and
 *            starts the API and the web app, then runs this config with PW_EXTERNAL_SERVERS=1)
 *  - CI:     .github/workflows/ui-tests.yml (sharded, blob reports merged into one HTML report)
 *            and the @smoke gate in .github/workflows/ci.yml
 *  - Remote: npm run test:ui:remote -- --base-url https://... --i-understand-this-is-live
 *            (PW_REMOTE=1: only tests tagged @readonly run, see below)
 *
 * Environment: PW_BASE_URL (default http://localhost:5173), PW_WORKERS, PW_TRACE (on, off,
 * retain-on-failure), PW_CHROMIUM_PATH (an already-installed Chromium).
 */
const CI = !!process.env.CI;
const REMOTE = process.env.PW_REMOTE === '1';
const baseURL = process.env.PW_BASE_URL || 'http://localhost:5173';
const workers = process.env.PW_WORKERS ? (/%$/.test(process.env.PW_WORKERS) ? process.env.PW_WORKERS : Number(process.env.PW_WORKERS)) : 2;
const trace = (process.env.PW_TRACE as 'on' | 'off' | 'retain-on-failure' | undefined) ?? (CI ? 'retain-on-failure' : 'off');

const chromiumLaunch = {
  // Optional: point at an already-installed Chromium (e.g. PW_CHROMIUM_PATH=/opt/pw-browsers/...).
  executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  args: [
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--no-sandbox',
    '--disable-setuid-sandbox',
  ],
};

export default defineConfig({
  // Remote mode: only the read-only checks exist for Playwright (a second guard besides the grep below).
  testDir: REMOTE ? './tests/e2e/readonly' : './tests/e2e',
  tsconfig: './tsconfig.playwright.json',

  /* Maximum time one test can run */
  timeout: 60 * 1000,
  expect: { timeout: 10 * 1000 },

  /* Every test is independent (own entities, or restores what it changes); files that share state run serially. */
  fullyParallel: true,
  forbidOnly: CI,
  /* One retry in CI only: a test that needs it is reported as flaky in the HTML report. */
  retries: CI ? 1 : 0,
  workers,

  /* A deployed site: only non-mutating tests (scripts/ui-tests/run-remote.mjs passes --grep @readonly too). */
  grep: REMOTE ? /@readonly/ : undefined,

  reporter: CI
    ? [['blob'], ['list'], ['github']]
    : [['html', { open: 'never' }], ['list'], ['json', { outputFile: 'test-results/results.json' }]],

  use: {
    baseURL,
    actionTimeout: 15 * 1000,
    navigationTimeout: 30 * 1000,
    trace,
    screenshot: 'only-on-failure',
    video: CI ? 'retain-on-failure' : 'off',
  },

  projects: [
    // Installed Google Chrome (npm run test:e2e:all and friends pass --project explicitly).
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', launchOptions: { ...chromiumLaunch, executablePath: undefined } },
    },
    // Playwright's Chromium: CI, npm run test:ui:local and every documented command.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: chromiumLaunch },
    },
  ],

  /* Start the app for a plain `npx playwright test` on a developer machine (uses .env). CI, the
     local runner and remote mode start or point at the servers themselves. */
  webServer: CI || REMOTE || process.env.PW_EXTERNAL_SERVERS === '1'
    ? undefined
    : {
      command: 'npm start',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 180 * 1000,
    },
});
