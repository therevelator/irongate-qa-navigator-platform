/**
 * One organisation per company e-mail domain, any number per public domain
 * (supabase/migrations/20261124000000_public_email_domains.sql):
 *   CDOM-001  two organisations with the same public domain (email_domain_public) are stored
 *   CDOM-002  a second organisation with the same company domain is refused by the unique index
 *   CDOM-003  the old unique constraint on companies.domain alone is gone; the partial index is there
 *   CDOM-004  the migration marked existing organisations with a public domain (it can run again)
 * Runs against DATABASE_URL (local only).
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { pool } from '../../src/lib/db';

const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
const local = ['127.0.0.1', 'localhost'].includes(url.hostname);

const ids: string[] = [];
const company = async (domain: string, isPublic: boolean) => {
  const id = randomUUID();
  ids.push(id);
  await pool.query(`INSERT INTO companies (id, name, domain, email_domain_public) VALUES ($1, $2, $3, $4)`, [id, `CDOM ${id}`, domain, isPublic]);
  return id;
};

describe('Organisation e-mail domains', () => {
  afterAll(async () => {
    if (local && ids.length) await pool.query('DELETE FROM companies WHERE id = ANY($1::varchar[])', [ids]);
    await pool.end();
  });

  test('CDOM-001 many organisations may share a public e-mail domain', async () => {
    if (!local) return;
    await company('gmail.com', true);
    await company('gmail.com', true);
    const r = await pool.query(`SELECT count(*)::int AS n FROM companies WHERE id = ANY($1::varchar[]) AND domain = 'gmail.com'`, [ids]);
    expect(r.rows[0].n).toBe(2);
  });

  test('CDOM-002 a company domain belongs to one organisation only', async () => {
    if (!local) return;
    const domain = `cdom-${randomUUID().slice(0, 8)}.example`;
    await company(domain, false);
    await expect(company(domain, false)).rejects.toMatchObject({ code: '23505', constraint: 'companies_domain_company_unique' });
  });

  test('CDOM-003 the unique rule is the partial index, not the old constraint', async () => {
    if (!local) return;
    const cons = await pool.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'public.companies'::regclass AND contype = 'u'`);
    expect(cons.rows.map((r) => r.conname)).not.toContain('companies_domain');
    const idx = await pool.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'companies_domain_company_unique'`);
    expect(idx.rows[0]?.indexdef).toMatch(/UNIQUE INDEX .* \(domain\) WHERE \(NOT email_domain_public\)/);
  });

  test('CDOM-004 the migration marks existing public-domain organisations and can run again', async () => {
    if (!local) return;
    const id = await company('outlook.com', false); // as stored before the migration
    const sql = readFileSync(path.join(__dirname, '../../supabase/migrations/20261124000000_public_email_domains.sql'), 'utf8')
      .split('\n').filter((l) => !/^\s*(BEGIN|COMMIT);\s*$/.test(l)).join('\n'); // as applied to Supabase
    await pool.query(sql);
    await pool.query(sql);
    const r = await pool.query('SELECT email_domain_public FROM companies WHERE id = $1', [id]);
    expect(r.rows[0].email_domain_public).toBe(true);
  });
});
