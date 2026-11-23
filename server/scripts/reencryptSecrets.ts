/**
 * npm run secrets:reencrypt -- [--apply] [--allow-remote]
 *
 * One-time re-encryption of the stored Slack webhooks (company_notification_settings.slack_webhook_enc)
 * with the current key (SETTINGS_ENCRYPTION_KEY, else JWT_SECRET: server/lib/runtimeEnv.ts).
 *
 * A webhook stored while the server ran without a signing secret was encrypted with the former
 * public development constant; a webhook stored before a key rotation, with the old key. Each row
 * that the current key cannot read is tried with the development constant and, when given, with the
 * old key in OLD_SETTINGS_KEY (the former SETTINGS_ENCRYPTION_KEY or JWT_SECRET value, from the
 * environment, never the command line). A row read that way is encrypted again with the current key.
 *
 * Without --apply nothing is written (a dry run that prints what would change; never the webhook).
 * Uses DATABASE_URL (or the DB_* settings). Only localhost / 127.0.0.1 unless --allow-remote.
 */
import 'dotenv/config';
import { DEV_ONLY_SECRET, settingsKeyMaterial } from '../lib/runtimeEnv';

async function main() {
  const apply = process.argv.includes('--apply');
  const url = process.env.DATABASE_URL;
  const host = url ? new URL(url).hostname : (process.env.DB_HOST || 'localhost');
  if (!['localhost', '127.0.0.1'].includes(host) && !process.argv.includes('--allow-remote')) {
    console.error(`Refusing database host ${host} (add --allow-remote to use it).`);
    process.exit(2);
  }
  const current = settingsKeyMaterial(); // throws in production without a real key
  const { query } = await import('../../src/lib/db');
  const { decryptSecret, encryptSecret, settingsKeyFrom } = await import('../lib/notifications');
  const currentKey = settingsKeyFrom(current);
  const candidates: Array<{ label: string; material: string }> = [{ label: 'the former development constant', material: DEV_ONLY_SECRET }];
  if (process.env.OLD_SETTINGS_KEY) candidates.push({ label: 'OLD_SETTINGS_KEY', material: process.env.OLD_SETTINGS_KEY });

  const rows = await query<any>('SELECT company_id, slack_webhook_enc FROM company_notification_settings WHERE slack_webhook_enc IS NOT NULL');
  let ok = 0, fixed = 0, unreadable = 0;
  for (const r of rows) {
    if (decryptSecret(r.slack_webhook_enc, currentKey) !== null) { ok++; continue; }
    const hit = candidates.map((c) => ({ c, plain: decryptSecret(r.slack_webhook_enc, settingsKeyFrom(c.material)) })).find((x) => x.plain !== null);
    if (!hit) { unreadable++; console.log(`${r.company_id}: unreadable with every key (an administrator enters the webhook again)`); continue; }
    fixed++;
    console.log(`${r.company_id}: encrypted with ${hit.c.label}${apply ? ': re-encrypted with the current key' : ': would be re-encrypted (dry run)'}`);
    if (apply) {
      await query('UPDATE company_notification_settings SET slack_webhook_enc = ? WHERE company_id = ?', [encryptSecret(hit.plain as string, currentKey), r.company_id]);
    }
  }
  console.log(`${rows.length} stored webhook(s): ${ok} already on the current key, ${fixed} ${apply ? 're-encrypted' : 'to re-encrypt'}, ${unreadable} unreadable.`);
  process.exit(0);
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
