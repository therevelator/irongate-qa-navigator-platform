/**
 * Runner of the one-off privacy purge of raw_uploads.payload (scripts/privacy/rawPayloadPurge.ts does the work,
 * scripts/privacy/purge-raw-payloads.sql applies it). Prints counts only, never data.
 *
 *   DATABASE_URL=postgres://… npx tsx scripts/privacy/purge-raw-payloads.ts                 dry run: counts per kind, writes nothing
 *   DATABASE_URL=postgres://… npx tsx scripts/privacy/purge-raw-payloads.ts --apply         rewrite (local database only)
 *   DATABASE_URL=postgres://… npx tsx scripts/privacy/purge-raw-payloads.ts --apply --host=db.example.com
 *                                                                                            rewrite on that host (must match DATABASE_URL)
 *   --company=<id>  only that company's rows; --team=<id> only that team's
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import pg from 'pg';
import { purgeRawPayloads } from './rawPayloadPurge';

const SQL = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'purge-raw-payloads.sql'), 'utf8');

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const host = args.find((a) => a.startsWith('--host='))?.slice(7) ?? null;
  const companyId = args.find((a) => a.startsWith('--company='))?.slice(10) ?? null;
  const teamId = args.find((a) => a.startsWith('--team='))?.slice(7) ?? null;
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL must be set'); process.exit(2); }
  const target = new URL(url).hostname;
  const local = target === 'localhost' || target === '127.0.0.1';
  if (apply && !local && host !== target) {
    console.error(`Refusing to write to ${target}: pass --host=${target} to confirm that this is the database to purge`);
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log(`${apply ? 'Purging' : 'Dry run (nothing is written; add --apply)'}: raw_uploads payloads on ${target}${companyId ? `, company ${companyId}` : ''}${teamId ? `, team ${teamId}` : ''}`);
    const counts = await purgeRawPayloads(client, { apply, sql: SQL, companyId, teamId, log: (s) => console.log(s) });
    const total = { rows: 0, alreadyMinimised: 0, rewritten: 0, cleared: 0 };
    for (const [kind, c] of Object.entries(counts).sort()) {
      console.log(`${kind.padEnd(16)} ${String(c.rows).padStart(6)} payloads: ${c.rewritten} ${apply ? 'rewritten' : 'to rewrite'}, ${c.cleared} ${apply ? 'cleared' : 'to clear'}, ${c.alreadyMinimised} already minimised`);
      for (const k of Object.keys(total) as Array<keyof typeof total>) total[k] += c[k];
    }
    console.log(`${'total'.padEnd(16)} ${String(total.rows).padStart(6)} payloads: ${total.rewritten} ${apply ? 'rewritten' : 'to rewrite'}, ${total.cleared} ${apply ? 'cleared' : 'to clear'}, ${total.alreadyMinimised} already minimised`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error('Purge failed:', (e as Error).message); process.exit(1); });
