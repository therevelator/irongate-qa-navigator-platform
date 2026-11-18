/**
 * npm run seed:demo                      write the demo dataset to DATABASE_URL (local DB)
 * npm run seed:demo -- --sql out.sql     write idempotent SQL file(s) instead (no DB connection)
 * npm run seed:demo:clear                delete the demo rows from DATABASE_URL
 * npm run seed:demo:clear -- --sql x.sql write the removal SQL instead
 *
 * Options: --today YYYY-MM-DD (last day of history; default: today, UTC)
 *          --allow-remote     allow a DATABASE_URL host other than localhost / 127.0.0.1
 */
import 'dotenv/config';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

async function main() {
  const clear = has('--clear');
  const sqlFile = arg('--sql');
  const today = arg('--today');
  if (has('--sql') && !sqlFile) throw new Error('--sql needs a file name, e.g. --sql tmp/demo-seed.sql');

  if (sqlFile) {
    const { writeDemoSqlFiles } = await import('./demoSql');
    const files = writeDemoSqlFiles(sqlFile, { today, clear });
    console.log(`Wrote ${files.length} SQL file(s):`);
    const fs = await import('fs');
    for (const f of files) console.log(`  ${f}  (${(fs.statSync(f).size / 1024).toFixed(0)} KB)`);
    return;
  }

  const url = process.env.DATABASE_URL;
  if (url) {
    const host = new URL(url).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host) && !has('--allow-remote')) {
      throw new Error(`Refusing to write to non-local database host "${host}". Use --sql to produce SQL files, or pass --allow-remote.`);
    }
  }

  const { runDemoSeed, clearDemoData, tableCounts } = await import('./demoSeed');
  const { pool } = await import('../../src/lib/db');
  try {
    if (clear) {
      const deleted = await clearDemoData();
      // Entries like 'teams (lead_id)' are UPDATEs that clear references before the deletes.
      const total = Object.entries(deleted).filter(([t]) => !t.includes('(')).reduce((a, [, b]) => a + b, 0);
      console.log(`Removed ${total} demo rows:`);
      for (const [t, n] of Object.entries(deleted)) if (n) console.log(`  ${t.padEnd(34)} ${n}`);
    } else {
      const r = await runDemoSeed({ today });
      console.log(`Demo data for "${r.companyName}" (history up to ${r.today}): ${r.insertedTotal} new rows.`);
      console.log(`Sign in with password "${r.password}":`);
      for (const l of r.logins) console.log(`  ${l.role.padEnd(12)} ${l.email}`);
    }
    console.log('\nRow counts (all rows / demo rows):');
    for (const c of await tableCounts()) console.log(`  ${c.table.padEnd(34)} ${String(c.total).padStart(7)} ${String(c.demo).padStart(7)}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
