#!/usr/bin/env node
/**
 * npm run test:ui:local — run the Playwright UI suite on this computer (macOS, Linux, Windows).
 *
 *   1. checks Node 22, free ports 3000 and 5173, a Playwright Chromium
 *   2. gets a LOCAL Postgres: TEST_DATABASE_URL from .env.test, else Docker (docker-compose.test.yml,
 *      postgres:16 on port 55432); any host other than localhost is refused
 *   3. creates and prepares the test database (unless --reuse-db and it is already prepared)
 *   4. starts the API (:3000) and the web app (:5173) with an explicit test environment: the
 *      developer's .env is never read (DOTENV_CONFIG_PATH points at .env.test or an empty file), and
 *      e-mail, AI and Slack credentials are blanked so nothing leaves the machine
 *   5. runs Playwright, then stops what it started (servers, and the Docker database unless --keep-db)
 *
 * Options (after `npm run test:ui:local --`):
 *   --smoke              only tests tagged @smoke
 *   --grep <text>        only tests whose title or tags match (e.g. --grep @negative, --grep "@area:pulse")
 *   --headed             show the browser
 *   --ui                 Playwright UI mode (the servers stay up until you close it)
 *   --workers <n>        parallel workers (default 2)
 *   --reuse-db           keep an already prepared test database (faster re-runs; tests are re-runnable)
 *   --keep-db            leave the Docker database running afterwards
 *   --trace              record traces (on)
 *   any other argument is passed to `playwright test` (e.g. a file: tests/e2e/auth)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  ROOT, UsageError, bold, checkNode, dockerAvailable, fail, green, npxCommand, portInUse, readEnvFile, red, run,
  startBackground, step, stopTree, waitForUrl, warn, assertLocalDatabase,
} from './lib.mjs';
import { databaseReady, prepareDatabase, waitForPostgres } from './prepare-db.mjs';

const DOCKER_URL = 'postgres://postgres:postgres@127.0.0.1:55432/irongate_ui_test';
const COMPOSE = ['compose', '-f', 'docker-compose.test.yml'];

function parseArgs(argv) {
  const o = { smoke: false, grep: null, headed: false, ui: false, workers: null, reuseDb: false, keepDb: false, trace: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--smoke') o.smoke = true;
    else if (a === '--grep' || a === '-g') o.grep = argv[++i];
    else if (a === '--headed') o.headed = true;
    else if (a === '--ui') o.ui = true;
    else if (a === '--workers') o.workers = argv[++i];
    else if (a === '--reuse-db') o.reuseDb = true;
    else if (a === '--keep-db') o.keepDb = true;
    else if (a === '--trace') o.trace = true;
    else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]); process.exit(0); }
    else o.rest.push(a);
  }
  return o;
}

const started = { api: null, web: null, docker: false };

/** Playwright's Chromium must be installed once per machine (or PW_CHROMIUM_PATH set). */
async function checkChromium() {
  if (process.env.PW_CHROMIUM_PATH) {
    if (!fs.existsSync(process.env.PW_CHROMIUM_PATH)) fail(`PW_CHROMIUM_PATH points at ${process.env.PW_CHROMIUM_PATH}, which does not exist.`);
    return;
  }
  const { chromium } = await import('@playwright/test');
  if (!fs.existsSync(chromium.executablePath())) {
    fail('Playwright\'s Chromium is not installed. Run once: npx playwright install --with-deps chromium');
  }
}

async function cleanup(keepDb) {
  await stopTree(started.web);
  await stopTree(started.api);
  started.web = started.api = null;
  if (started.docker && !keepDb) {
    step('Stopping the Docker test database');
    await run(process.platform === 'win32' ? 'docker.exe' : 'docker', [...COMPOSE, 'down', '-v'], { quiet: true });
    started.docker = false;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  checkNode();

  await checkChromium();
  const testEnv = readEnvFile(path.join(ROOT, '.env.test'));
  // Not under test-results/: Playwright empties that folder when a run starts, which would delete
  // the server logs and the captured e-mails the tests read.
  const logDir = path.join(ROOT, 'logs', 'ui-tests');
  fs.mkdirSync(logDir, { recursive: true });

  step('Checking ports 3000 (API) and 5173 (web app)');
  for (const [port, what] of [[3000, 'API'], [5173, 'web app']]) {
    if (await portInUse(port)) {
      fail(`Port ${port} (${what}) is already in use. Stop whatever runs there (for example \`npm start\` or \`npm run dev\`) and try again; the UI tests start their own servers against the test database.`);
    }
  }

  // Database: TEST_DATABASE_URL (from .env.test or the shell), else Docker.
  let dbUrl = testEnv.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL || '';
  if (dbUrl) {
    assertLocalDatabase(dbUrl);
    step(`Using the local Postgres from TEST_DATABASE_URL (${new URL(dbUrl).host})`);
  } else if (await dockerAvailable()) {
    step('Starting Postgres 16 in Docker (docker-compose.test.yml, port 55432)');
    if (await run(process.platform === 'win32' ? 'docker.exe' : 'docker', [...COMPOSE, 'up', '-d', '--wait']) !== 0) {
      fail('docker compose could not start the test database (see above).');
    }
    started.docker = true;
    dbUrl = DOCKER_URL;
  } else {
    fail('No test database: Docker is not available and TEST_DATABASE_URL is not set.\n'
      + '  Either start Docker Desktop (the runner then uses docker-compose.test.yml), or\n'
      + '  copy .env.test.example to .env.test and set TEST_DATABASE_URL to a local Postgres, e.g.\n'
      + '  TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/irongate_ui_test');
  }
  await waitForPostgres(dbUrl);

  // An empty dotenv file for the servers when there is no .env.test: the developer's .env is never read.
  const dotenvPath = fs.existsSync(path.join(ROOT, '.env.test')) ? path.join(ROOT, '.env.test') : path.join(os.tmpdir(), 'irongate-ui-tests.empty.env');
  if (!fs.existsSync(dotenvPath)) fs.writeFileSync(dotenvPath, '');
  const mailFile = path.join(logDir, 'mail.jsonl');
  fs.writeFileSync(mailFile, '');
  const u = new URL(dbUrl);
  const serverEnv = {
    ...process.env,
    DOTENV_CONFIG_PATH: dotenvPath,
    NODE_ENV: 'development',
    DATABASE_URL: dbUrl,
    DB_HOST: u.hostname, DB_PORT: u.port || '5432', DB_USER: decodeURIComponent(u.username), DB_PASSWORD: decodeURIComponent(u.password), DB_NAME: u.pathname.slice(1),
    JWT_SECRET: testEnv.TEST_JWT_SECRET || `ui-tests-${randomBytes(16).toString('hex')}`,
    PORT: '3000',
    API_RATE_LIMIT_MAX: '10000',
    NOTIFY_SLACK_ALLOW_LOCAL: 'true',
    MAIL_CAPTURE_FILE: mailFile,
    DEMO_MODE: 'true',
    // Nothing leaves the machine: no real e-mail, AI or Slack.
    RESEND_API_KEY: '', SMTP_HOST: '', GROQ_API_KEY: '', NETLIFY: '',
    ALERTS_CRON: 'false',
  };

  if (opts.reuseDb && await databaseReady(dbUrl)) step('Reusing the prepared test database (--reuse-db)');
  else await prepareDatabase(dbUrl, serverEnv);

  step('Starting the API on http://localhost:3000');
  started.api = startBackground(npxCommand(), ['tsx', 'server/index.ts'], { env: serverEnv, log: path.join(logDir, 'api.log') });
  await waitForUrl('http://localhost:3000/health', { child: started.api, name: 'The API', log: path.join(logDir, 'api.log') });

  step('Starting the web app on http://localhost:5173');
  started.web = startBackground(npxCommand(), ['vite', '--port', '5173', '--strictPort'], { env: serverEnv, log: path.join(logDir, 'web.log') });
  await waitForUrl('http://localhost:5173/', { child: started.web, name: 'The web app', log: path.join(logDir, 'web.log') });

  const args = ['playwright', 'test', '--project=chromium'];
  if (opts.smoke) args.push('--grep', '@smoke');
  if (opts.grep) args.push('--grep', opts.grep);
  if (opts.headed) args.push('--headed');
  if (opts.ui) args.push('--ui');
  args.push(...opts.rest);
  const testEnvVars = {
    ...process.env,
    PW_EXTERNAL_SERVERS: '1',
    DATABASE_URL: dbUrl,
    MAIL_CAPTURE_FILE: mailFile,
    DOTENV_CONFIG_PATH: dotenvPath,
    ...(opts.workers ? { PW_WORKERS: String(opts.workers) } : {}),
    ...(opts.trace ? { PW_TRACE: 'on' } : {}),
  };
  delete testEnvVars.CI;
  step(`Running: npx ${args.join(' ')}`);
  const code = await run(npxCommand(), args, { env: testEnvVars });
  if (code === 0) console.log(green(bold('UI tests passed.')));
  else console.log(red(bold(`UI tests failed (exit code ${code}).`)) + ' Open the report with: npm run test:ui:local:report');
  console.log(`Server logs: ${path.relative(ROOT, logDir)}`);
  return code;
}

let exitCode = 1;
const keepDb = process.argv.includes('--keep-db');
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { warn(`${sig}: stopping the servers`); await cleanup(keepDb); process.exit(130); });
}
try {
  exitCode = await main();
} catch (e) {
  if (e instanceof UsageError) { console.error(`${red(bold('Cannot run the UI tests:'))} ${e.message}`); exitCode = 2; }
  else { console.error(e); exitCode = 1; }
} finally {
  await cleanup(keepDb);
}
process.exit(exitCode);
