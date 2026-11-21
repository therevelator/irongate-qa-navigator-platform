/**
 * The name rules (server/lib/displayName.ts) against the data we ship: every user, team, department
 * and company name in the prepared database (the snapshot from scripts/reseed and the demo seed,
 * npm run seed:demo) must pass validateDisplayName, so editing a seeded record never fails on its
 * existing name. Rows created in the last day are left out (other suites create and delete their
 * own records, some with markup on purpose to test the front end).
 *
 *   DND-001 every seeded name passes validateDisplayName
 *
 * Needs the local test database (DATABASE_URL); skips when it cannot be reached.
 */
import type { Client } from 'pg';
import { localDb } from './helpers/http';
import { validateDisplayName } from '../../server/lib/displayName';

describe('Seeded names follow the display-name rules', () => {
  let db: Client | null = null;
  beforeAll(async () => {
    try { db = await localDb(); } catch { db = null; console.warn('⚠️  No local database - DND-001 skipped'); }
  });
  afterAll(async () => { await db?.end(); });

  test('DND-001 every seeded user, team, department and company name passes validateDisplayName', async () => {
    if (!db) return;
    const old = "created_at < now() - interval '1 day'";
    const rows = (await db.query(
      `SELECT 'user first' AS kind, id, first_name AS name FROM users WHERE ${old}
       UNION ALL SELECT 'user last', id, last_name FROM users WHERE ${old}
       UNION ALL SELECT 'team', id, name FROM teams WHERE ${old}
       UNION ALL SELECT 'department', id, name FROM departments WHERE ${old}
       UNION ALL SELECT 'company', id, name FROM companies WHERE ${old}`,
    )).rows as Array<{ kind: string; id: string; name: string | null }>;
    expect(rows.length).toBeGreaterThan(100);
    const bad = rows.filter((r) => r.name !== null && !validateDisplayName(r.name).ok);
    expect(bad).toEqual([]);
  });
});
