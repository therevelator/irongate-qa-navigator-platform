/**
 * The scope of an API key (supabase/migrations/20261208100000_api_key_scope.sql):
 *   KSCOPE-001  keys that exist when the migration runs become 'exporter' (they could read the Exporter's context
 *               before, so an Exporter set up with one keeps working); keys created afterwards default to 'ingest';
 *               the migration can run again; any other scope is refused by the check constraint
 * Runs against DATABASE_URL (local only), inside a transaction that is rolled back.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { pool } from '../../src/lib/db';

const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
const SQL = readFileSync(path.join(__dirname, '../../supabase/migrations/20261208100000_api_key_scope.sql'), 'utf8')
  .split('\n').filter((l) => !/^\s*(BEGIN|COMMIT);\s*$/.test(l)).join('\n'); // as applied to Supabase

afterAll(async () => { await pool.end(); });

test('KSCOPE-001 existing keys become exporter keys, new keys default to ingest', async () => {
  if (!local) return;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('ALTER TABLE api_keys DROP COLUMN IF EXISTS scope');
    const company = (await c.query('SELECT id FROM companies ORDER BY id LIMIT 1')).rows[0].id;
    const add = async (name: string) => (await c.query(
      `INSERT INTO api_keys (company_id, name, key_prefix, key_hash) VALUES ($1, $2::text, 'igk_test', md5($2::text || random()::text)) RETURNING id`, [company, name])).rows[0].id;
    const before = await add('kscope existing key');
    await c.query(SQL);
    await c.query(SQL);
    const after = await add('kscope new key');
    const scope = async (id: string) => (await c.query('SELECT scope FROM api_keys WHERE id = $1', [id])).rows[0].scope;
    expect(await scope(before)).toBe('exporter');
    expect(await scope(after)).toBe('ingest');
    await expect(c.query(`UPDATE api_keys SET scope = 'admin' WHERE id = $1`, [after])).rejects.toThrow(/api_keys_scope_check/);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
});
