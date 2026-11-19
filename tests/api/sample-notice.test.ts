/**
 * Sample-data notices can be hidden per company (companies.settings.hideSampleDataNotice), e.g. for
 * a demo company whose data is generated:
 *   SNH-001  /api/auth/me reports hide_sample_notice false by default and true once the company hides it
 *   SNH-002  the setting of one company does not leak to another
 *   SNH-003  the sign-in answer (POST /api/auth/login) carries it too, so the app needs no reload
 */
import type { Client } from 'pg';
import { backendUp, get, localDb, login } from './helpers/http';

const SAMPLE_COMPANY_USER = 'alex.morgan@northwind.example';
const OTHER_COMPANY_USER = 'admin@irongate.com';

let db: Client;
let up = false;
let companyId: string;
let saved: unknown;

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  const r = await db.query('SELECT u.company_id, c.settings FROM users u JOIN companies c ON c.id = u.company_id WHERE u.email = $1', [SAMPLE_COMPANY_USER]);
  companyId = r.rows[0].company_id;
  saved = r.rows[0].settings;
});

afterAll(async () => {
  if (!up) return;
  await db.query('UPDATE companies SET settings = $2 WHERE id = $1', [companyId, saved]);
  await db.end();
});

const me = async (email: string) => {
  const { cookie } = await login(email);
  const r = await get('/api/auth/me', cookie);
  expect(r.status).toBe(200);
  return r.body.user;
};

describe('Hiding the sample-data notices per company', () => {
  test('SNH-001 off by default, on when the company hides them', async () => {
    if (!up) return;
    await db.query(`UPDATE companies SET settings = COALESCE(settings, '{}'::jsonb) - 'hideSampleDataNotice' WHERE id = $1`, [companyId]);
    expect((await me(SAMPLE_COMPANY_USER)).hide_sample_notice).toBe(false);
    await db.query(`UPDATE companies SET settings = COALESCE(settings, '{}'::jsonb) || '{"hideSampleDataNotice": true}'::jsonb WHERE id = $1`, [companyId]);
    expect((await me(SAMPLE_COMPANY_USER)).hide_sample_notice).toBe(true);
  });

  test('SNH-002 another company is not affected', async () => {
    if (!up) return;
    expect((await me(OTHER_COMPANY_USER)).hide_sample_notice).toBe(false);
  });

  test('SNH-003 the sign-in answer carries hide_sample_notice like /api/auth/me', async () => {
    if (!up) return;
    await db.query(`UPDATE companies SET settings = COALESCE(settings, '{}'::jsonb) || '{"hideSampleDataNotice": true}'::jsonb WHERE id = $1`, [companyId]);
    const on = await login(SAMPLE_COMPANY_USER);
    expect(on.status).toBe(200);
    expect(on.user.hide_sample_notice).toBe(true);
    expect(on.user.company_status).toBeUndefined();
    await db.query(`UPDATE companies SET settings = COALESCE(settings, '{}'::jsonb) - 'hideSampleDataNotice' WHERE id = $1`, [companyId]);
    expect((await login(SAMPLE_COMPANY_USER)).user.hide_sample_notice).toBe(false);
    expect((await login(OTHER_COMPANY_USER)).user.hide_sample_notice).toBe(false);
  });
});
