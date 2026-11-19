/**
 * User activity batch writes (server/lib/userActivity.ts):
 *   UAB-001  a buffered row for an organisation that was deleted in the meantime is dropped on its
 *            own; the other rows of the same batch are still stored (before, the foreign key error
 *            lost the whole batch).
 * Runs against DATABASE_URL (local only).
 */
import { randomUUID } from 'crypto';
import { pool } from '../../src/lib/db';
import { enqueueActivity, flushActivity, type ActivityRow } from '../../server/lib/userActivity';

const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
const local = ['127.0.0.1', 'localhost'].includes(url.hostname);

const company = randomUUID();
const gone = randomUUID();
const requestId = `uab-${randomUUID()}`;

const row = (companyId: string, screen: string): ActivityRow => ({
  companyId, userId: null, apiKeyId: null, email: null, category: 'view', method: 'GET', route: '/api/test',
  screen, teamId: null, entityType: null, entityId: null, status: 200, durationMs: 1, ip: '127.0.0.1',
  userAgent: 'jest', requestId, at: new Date().toISOString(),
});

describe('User activity batch writes', () => {
  beforeAll(async () => {
    if (!local) return;
    await pool.query(`INSERT INTO companies (id, name, domain) VALUES ($1, 'UAB test', $2)`, [company, `${company}.example`]);
  });

  afterAll(async () => {
    if (local) await pool.query('DELETE FROM companies WHERE id = $1', [company]);
    await pool.end();
  });

  test('UAB-001 a row for a deleted organisation does not lose the rest of the batch', async () => {
    if (!local) return;
    enqueueActivity(row(company, 'before'));
    enqueueActivity(row(gone, 'orphan'));
    enqueueActivity(row(company, 'after'));
    await flushActivity();
    const r = await pool.query('SELECT company_id, screen FROM user_activity WHERE request_id = $1 ORDER BY screen', [requestId]);
    expect(r.rows).toEqual([{ company_id: company, screen: 'after' }, { company_id: company, screen: 'before' }]);
  });
});
