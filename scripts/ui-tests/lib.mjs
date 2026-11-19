/**
 * Shared helpers of the UI test runners (run-local.mjs, run-remote.mjs). Node only, no bash, so the
 * runners work on macOS, Linux and Windows.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const IS_WINDOWS = process.platform === 'win32';

const color = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = color('1');
export const red = color('31');
export const green = color('32');
export const yellow = color('33');

export const step = (msg) => console.log(`${bold('==>')} ${msg}`);
export const warn = (msg) => console.log(`${yellow('warning:')} ${msg}`);

export class UsageError extends Error {}

/** Stop with a clear message (exit code 2: a prerequisite or an option is wrong). */
export function fail(msg) {
  throw new UsageError(msg);
}

/** Node 22 or newer (package.json engines). */
export function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) fail(`Node.js 22 or newer is needed (this is ${process.versions.node}). Install it from https://nodejs.org or with nvm / fnm.`);
}

/**
 * KEY=value lines of a dotenv-style file (comments and blank lines ignored, optional quotes).
 * Used for .env.test only: the developer's .env is never read by the runners.
 */
export function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** Only a database on this machine may be used (never a hosted one). */
export function assertLocalDatabase(url) {
  let u;
  try { u = new URL(url); } catch { fail(`TEST_DATABASE_URL is not a valid URL: ${url}`); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) fail(`TEST_DATABASE_URL must be a postgres:// URL (got ${u.protocol}).`);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname)) {
    fail(`Refusing database host "${u.hostname}": the UI tests only run against a Postgres on this machine (localhost / 127.0.0.1). Never point them at the hosted database.`);
  }
  const name = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!name) fail('TEST_DATABASE_URL must name a database, e.g. postgres://postgres:postgres@127.0.0.1:5432/irongate_ui_test');
  return { url: u, name };
}

/** Is something listening on the port (IPv4 or IPv6 localhost)? */
export async function portInUse(port) {
  const tryConnect = (host) => new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(1000, () => { s.destroy(); resolve(false); });
  });
  return (await tryConnect('127.0.0.1')) || (await tryConnect('::1'));
}

/** Poll a URL until it answers 2xx/3xx, or the process exits, or the time is up. */
export async function waitForUrl(url, { timeoutMs = 120000, child, name, log } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child && child.exitCode !== null) {
      fail(`${name} stopped before it was ready (exit code ${child.exitCode}). Last lines of ${log}:\n${tail(log)}`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.status < 400) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`${name} did not answer at ${url} within ${Math.round(timeoutMs / 1000)} s. Last lines of ${log}:\n${tail(log)}`);
}

export function tail(file, lines = 40) {
  try { return fs.readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n'); } catch { return '(no log)'; }
}

/** npx / npm on every platform. */
export function npxCommand() { return IS_WINDOWS ? 'npx.cmd' : 'npx'; }

/** Run a command to completion, inheriting the terminal; resolves with its exit code. */
export function run(cmd, args, { env, cwd = ROOT, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: quiet ? 'ignore' : 'inherit', shell: IS_WINDOWS });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/** Start a long-running process in the background with its output in a log file. */
export function startBackground(cmd, args, { env, log, cwd = ROOT }) {
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const out = fs.openSync(log, 'w');
  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', out, out], detached: !IS_WINDOWS, shell: IS_WINDOWS, windowsHide: true });
  child.unref();
  return child;
}

/** Stop a background process and everything it started (npx -> tsx -> node). */
export async function stopTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (IS_WINDOWS) {
    await run('taskkill', ['/pid', String(child.pid), '/T', '/F'], { quiet: true });
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  for (let i = 0; i < 20 && child.exitCode === null; i++) await new Promise((r) => setTimeout(r, 250));
  if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }
}

/** Is the docker CLI available with a running daemon and compose v2? */
export async function dockerAvailable() {
  const ok = await new Promise((resolve) => {
    const c = spawn(IS_WINDOWS ? 'docker.exe' : 'docker', ['compose', 'version'], { stdio: 'ignore' });
    c.once('error', () => resolve(false));
    c.once('exit', (code) => resolve(code === 0));
  });
  if (!ok) return false;
  return new Promise((resolve) => {
    const c = spawn(IS_WINDOWS ? 'docker.exe' : 'docker', ['info'], { stdio: 'ignore' });
    c.once('error', () => resolve(false));
    c.once('exit', (code) => resolve(code === 0));
  });
}
