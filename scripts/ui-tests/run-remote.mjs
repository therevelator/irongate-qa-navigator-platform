#!/usr/bin/env node
/**
 * npm run test:ui:remote -- --base-url https://your-site.example --i-understand-this-is-live
 *
 * Runs the read-only smoke checks (tests/e2e/readonly, tagged @readonly) against a deployed site.
 * They sign in, open pages and change nothing (no data is created or changed; a sign-in and the
 * pages opened are recorded in that company's User activity log, as for any person).
 *
 * Safety:
 *   - --i-understand-this-is-live is required;
 *   - credentials come from the environment (UI_REMOTE_EMAIL, UI_REMOTE_PASSWORD; also read from
 *     .env.test), never from the command line or the code;
 *   - only tests/e2e/readonly runs (the config switches to it with PW_REMOTE=1), and --grep or test
 *     file arguments that could select other tests are refused; one worker, no retries;
 *   - no database URL is passed to the tests (database helpers refuse to run in remote mode).
 *
 * Options: --base-url <url> (required), --i-understand-this-is-live (required), --headed,
 *          --list (only list the tests that would run; nothing is opened).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, UsageError, bold, checkNode, fail, green, npxCommand, readEnvFile, red, run, step } from './lib.mjs';

export function parseRemoteArgs(argv, env) {
  const o = { baseUrl: null, confirmed: false, headed: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base-url') o.baseUrl = argv[++i];
    else if (a.startsWith('--base-url=')) o.baseUrl = a.slice('--base-url='.length);
    else if (a === '--i-understand-this-is-live') o.confirmed = true;
    else if (a === '--headed') o.headed = true;
    else if (a === '--list') o.list = true;
    else if (a === '--grep' || a === '-g' || a.startsWith('--grep') || a === '--grep-invert' || a === '--project' || a.startsWith('--project=')) {
      fail(`${a} is not allowed in remote mode: only the read-only tests (@readonly) may run against a live site.`);
    } else fail(`Unknown option "${a}". Remote mode takes --base-url, --i-understand-this-is-live, --headed and --list only.`);
  }
  if (!o.baseUrl) fail('--base-url is required, e.g. npm run test:ui:remote -- --base-url https://irongate.example --i-understand-this-is-live');
  let u;
  try { u = new URL(o.baseUrl); } catch { fail(`--base-url is not a valid URL: ${o.baseUrl}`); }
  if (!/^https?:$/.test(u.protocol)) fail('--base-url must start with https:// (or http://).');
  if (!o.confirmed) fail('This runs against a LIVE site. Add --i-understand-this-is-live to confirm (only read-only checks run; nothing is created or changed).');
  if (!o.list && (!env.UI_REMOTE_EMAIL || !env.UI_REMOTE_PASSWORD)) {
    fail('Set UI_REMOTE_EMAIL and UI_REMOTE_PASSWORD (in the environment or in .env.test) to the account the checks sign in with. They are never passed on the command line.');
  }
  return { ...o, baseUrl: `${u.origin}${u.pathname.replace(/\/$/, '')}` };
}

async function main() {
  checkNode();
  const fileEnv = readEnvFile(path.join(ROOT, '.env.test'));
  const env = { ...fileEnv, ...process.env };
  const o = parseRemoteArgs(process.argv.slice(2), env);
  const testEnv = {
    ...process.env,
    PW_REMOTE: '1',
    PW_BASE_URL: o.baseUrl,
    PW_EXTERNAL_SERVERS: '1',
    UI_REMOTE_EMAIL: env.UI_REMOTE_EMAIL ?? '',
    UI_REMOTE_PASSWORD: env.UI_REMOTE_PASSWORD ?? '',
    PW_WORKERS: '1',
  };
  // Never hand a database to the tests in remote mode.
  delete testEnv.DATABASE_URL;
  delete testEnv.TEST_DATABASE_URL;
  delete testEnv.MAIL_CAPTURE_FILE;
  delete testEnv.CI;
  const args = ['playwright', 'test', '--project=chromium', '--grep', '@readonly', '--retries=0'];
  if (o.headed) args.push('--headed');
  if (o.list) args.push('--list');
  step(`Read-only checks against ${o.baseUrl}${o.list ? ' (list only)' : ''}`);
  const code = await run(npxCommand(), args, { env: testEnv });
  console.log(code === 0 ? green(bold('Remote smoke checks passed.')) : red(bold(`Remote smoke checks failed (exit code ${code}).`)));
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let code = 1;
  try { code = await main(); } catch (e) {
    if (e instanceof UsageError) { console.error(`${red(bold('Not running:'))} ${e.message}`); code = 2; } else { console.error(e); }
  }
  process.exit(code);
}
