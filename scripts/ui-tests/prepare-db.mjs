/**
 * Create and prepare the UI test database like production (the Node twin of scripts/ci/prepare-db.sh,
 * so it also works on Windows without bash or psql):
 *   1. the initial schema migration
 *   2. the data snapshot (db_snapshots/latest_snapshot.postgres.sql)
 *   3. every later migration in timestamp order
 *   4. the demo seed and the fill of existing companies (npm run seed:demo [-- --fill-existing])
 *
 * The database is dropped and created again first. Only a local host is accepted, and only a database
 * whose name contains "test" (so a development database is never reset by accident).
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { ROOT, assertLocalDatabase, fail, npxCommand, run, step } from './lib.mjs';

const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const INITIAL = '20261020000000_initial_schema.sql';
const SNAPSHOT = path.join(ROOT, 'db_snapshots', 'latest_snapshot.postgres.sql');

function clientFor(url, database) {
  const u = new URL(url);
  return new pg.Client({
    host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''), database,
  });
}

export async function waitForPostgres(url, timeoutMs = 60000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const c = clientFor(url, 'postgres');
    try {
      await c.connect();
      await c.query('SELECT 1');
      await c.end();
      return;
    } catch (e) {
      last = e.message;
      await c.end().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  fail(`Postgres at ${new URL(url).host} is not reachable (${last}). Start it (Docker: docker compose -f docker-compose.test.yml up -d) or set TEST_DATABASE_URL in .env.test.`);
}

/** Does the database exist and hold the schema already? */
export async function databaseReady(url) {
  const { name } = assertLocalDatabase(url);
  const c = clientFor(url, name);
  try {
    await c.connect();
    const r = await c.query(`SELECT count(*)::int AS n FROM users WHERE email = 'admin@irongate.com'`);
    return r.rows[0].n > 0;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => undefined);
  }
}

export async function prepareDatabase(url, env) {
  const { name } = assertLocalDatabase(url);
  if (!/test/i.test(name)) fail(`The UI test database name must contain "test" (got "${name}"), so a development database is never reset. Use e.g. .../irongate_ui_test.`);

  step(`Creating database ${name} (dropped first if it exists)`);
  const admin = clientFor(url, 'postgres');
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name.replace(/"/g, '""')}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await admin.end();
  }

  const files = [
    path.join(MIGRATIONS, INITIAL),
    SNAPSHOT,
    ...fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f !== INITIAL).sort().map((f) => path.join(MIGRATIONS, f)),
  ];
  const c = clientFor(url, name);
  await c.connect();
  try {
    for (const f of files) {
      step(`Applying ${path.relative(ROOT, f)}`);
      try {
        await c.query(fs.readFileSync(f, 'utf8'));
      } catch (e) {
        fail(`Applying ${path.relative(ROOT, f)} failed: ${e.message}`);
      }
    }
  } finally {
    await c.end();
  }

  step('Demo seed');
  if (await run(npxCommand(), ['tsx', 'server/seeds/demoSeedCli.ts'], { env }) !== 0) fail('The demo seed failed (see above).');
  step('Demo fill of existing companies');
  if (await run(npxCommand(), ['tsx', 'server/seeds/demoSeedCli.ts', '--fill-existing'], { env }) !== 0) fail('The demo fill failed (see above).');
  step('Database ready');
}
