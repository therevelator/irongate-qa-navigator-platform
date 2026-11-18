/**
 * npm run seed:demo                                    demo company -> DATABASE_URL (local DB)
 * npm run seed:demo -- --fill-existing                 fill existing companies' teams that lack data
 * npm run seed:demo -- --sql out/demo-seed.sql         demo company as SQL files (no DB connection)
 * npm run seed:demo -- --fill-existing --sql out/demo-fill.sql
 *                                                      fill as SQL files (reads the local DB to plan, writes nothing)
 * npm run seed:demo -- --refresh-dates                 keep demo data current: add the missing recent days
 *                                                      for the demo company and for teams that already hold
 *                                                      sample rows (never touches real data; idempotent)
 * npm run seed:demo:clear                              delete all demo rows (both modes)
 * npm run seed:demo:clear -- --sql out/demo-clear.sql  the removal as SQL
 *
 * Options: --today YYYY-MM-DD   last day of history (default: today, UTC)
 *          --company <id>       with --fill-existing: only this company (repeatable)
 *          --allow-remote       allow a DATABASE_URL host other than localhost / 127.0.0.1
 */
import 'dotenv/config';
import fs from 'fs';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const args = (name: string) => process.argv.flatMap((a, i) => (a === name && process.argv[i + 1] ? [process.argv[i + 1]] : []));
const has = (name: string) => process.argv.includes(name);

function assertLocalDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) && !has('--allow-remote')) {
    throw new Error(`Refusing to use non-local database host "${host}". Use --sql to produce SQL files, or pass --allow-remote.`);
  }
}

function printFiles(files: string[]) {
  console.log(`Wrote ${files.length} SQL file(s):`);
  for (const f of files) console.log(`  ${f}  (${(fs.statSync(f).size / 1024).toFixed(0)} KB)`);
}

async function main() {
  const clear = has('--clear');
  const fill = has('--fill-existing');
  const refresh = has('--refresh-dates');
  if (refresh && (clear || fill || has('--sql'))) throw new Error('--refresh-dates cannot be combined with --clear, --fill-existing or --sql');
  const sqlFile = arg('--sql');
  const today = arg('--today');
  const companyIds = args('--company');
  if (has('--sql') && !sqlFile) throw new Error('--sql needs a file name, e.g. --sql tmp/demo-seed.sql');

  if (sqlFile && !fill) {
    const { writeDemoSqlFiles } = await import('./demoSql');
    printFiles(writeDemoSqlFiles(sqlFile, { today, clear }));
    return;
  }

  assertLocalDb();
  const seed = await import('./demoSeed');
  const { pool } = await import('../../src/lib/db');
  try {
    if (sqlFile) {
      // Fill as SQL: plan from the local database (read only), write files.
      const { writeDatasetSql } = await import('./demoSql');
      const { plan, ds } = await seed.buildFill(pool, { today, companyIds });
      for (const c of seed.planSummary(plan)) console.log(`  ${c.id}: ${c.teamsFilled} of ${c.teams} active teams get sample data`);
      printFiles(writeDatasetSql(sqlFile, ds, 'fill'));
      return;
    }
    if (refresh) {
      const r = await seed.runRefreshDates({ today });
      console.log(r.demoCompany.refreshed
        ? `Demo company: ${r.demoCompany.insertedTotal} new rows (history up to ${r.today}).`
        : 'Demo company: not seeded (nothing to refresh; run npm run seed:demo first).');
      for (const c of r.companies) console.log(`  ${c.id}: ${c.teamsFilled} of ${c.teams} active teams hold sample data and were refreshed`);
      console.log(`Refreshed sample data up to ${r.today}: ${r.insertedTotal} new rows.`);
      return;
    }
    if (clear) {
      const deleted = await seed.clearDemoData();
      // Entries like 'teams (lead_id)' are UPDATEs that clear references before the deletes.
      const total = Object.entries(deleted).filter(([t]) => !t.includes('(')).reduce((a, [, b]) => a + b, 0);
      console.log(`Removed ${total} demo rows:`);
      for (const [t, n] of Object.entries(deleted)) if (n) console.log(`  ${t.padEnd(34)} ${n}`);
    } else if (fill) {
      const r = await seed.runFillExisting({ today, companyIds });
      for (const c of r.companies) console.log(`  ${c.id}: ${c.teamsFilled} of ${c.teams} active teams get sample data`);
      console.log(`Filled existing companies (history up to ${r.today}): ${r.insertedTotal} new rows.`);
    } else {
      const r = await seed.runDemoSeed({ today });
      console.log(`Demo data for "${r.companyName}" (history up to ${r.today}): ${r.insertedTotal} new rows.`);
      console.log(`Sign in with password "${r.password}":`);
      for (const l of r.logins) console.log(`  ${l.role.padEnd(12)} ${l.email}`);
    }
    console.log('\nRow counts (all rows / demo rows):');
    for (const c of await seed.tableCounts()) console.log(`  ${c.table.padEnd(34)} ${String(c.total).padStart(7)} ${String(c.demo).padStart(7)}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
