/**
 * Build (or rebuild) the demo sandbox company behind /try (server/lib/sandbox.ts): ends every sandbox
 * session, deletes the sandbox company if it exists and builds it again with today's dates (two
 * departments, five teams, a year of every module, forecasts and recommendations). The same work as
 * the nightly reset and the operator panel's "Reset sandbox now", so running this is optional: the
 * first reset (or the first visit of /try) builds the sandbox on a new database by itself.
 *
 *   DATABASE_URL=postgres://… npx tsx scripts/sandbox/build.ts                 local database
 *   DATABASE_URL=postgres://… npx tsx scripts/sandbox/build.ts --allow-remote  any other host (production)
 *   DATABASE_URL=postgres://… npx tsx scripts/sandbox/build.ts --status        only print the state
 *
 * Needs every migration of supabase/migrations applied first (no schema change is specific to the sandbox).
 * Touches only the sandbox company (id sandbox-demo); never another company's rows.
 */
import 'dotenv/config';

const has = (flag: string) => process.argv.includes(flag);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL.');
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) && !has('--allow-remote')) {
    throw new Error(`Refusing to use the non-local database host "${host}" without --allow-remote.`);
  }
  const { pool } = await import('../../src/lib/db');
  const sandbox = await import('../../server/lib/sandbox');
  try {
    if (!has('--status')) {
      console.log(`Building the demo sandbox on ${host} …`);
      const r = await sandbox.runSandboxReset();
      console.log(sandbox.summariseReset(r));
    }
    const s = await sandbox.sandboxStatus();
    console.log(`State: ${s.state}; data up to ${s.dataUpTo ?? '—'}; ${s.teams} teams, ${s.users} users; ${s.openSessions} open sessions.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
