/**
 * Demo freshness (npm run seed:demo -- --refresh-dates, runRefreshDates in server/seeds/demoSeed.ts):
 *   REFRESH-001  it only adds rows: every non-sample row (real KPI snapshots, non-synthetic metric
 *                values, users, teams) is unchanged, and a second run on the same day adds nothing;
 *   REFRESH-002  a real team without sample rows never receives sample data or demo assignments.
 * Runs against DATABASE_URL (local only); the database is the seeded test database.
 */
import { pool } from '../../src/lib/db';
import { runRefreshDates, teamsWithSampleData } from '../../server/seeds/demoSeed';

const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
const local = ['127.0.0.1', 'localhost'].includes(url.hostname);

const FINGERPRINT = `SELECT md5(string_agg(x, ',' ORDER BY x)) AS h FROM (
  SELECT 'k' || t::text AS x FROM kpi_snapshots t WHERE id NOT LIKE 'demo-%'
  UNION ALL SELECT 'm' || t::text FROM metric_values t WHERE source <> 'synthetic'
  UNION ALL SELECT 'u' || t::text FROM users t WHERE id NOT LIKE 'demo-%'
  UNION ALL SELECT 't' || t::text FROM teams t WHERE id NOT LIKE 'demo-%') q`;

const TEAM = `refresh-test-team-${Date.now()}`;

describe('Demo data refresh (--refresh-dates)', () => {
  jest.setTimeout(180000);
  let seeded = false;

  beforeAll(async () => {
    if (!local) return;
    seeded = ((await pool.query(`SELECT COUNT(*)::int AS n FROM kpi_snapshots WHERE id LIKE 'demo-%'`)).rows[0].n) > 0;
    if (!seeded) return;
    await pool.query(
      `INSERT INTO teams (id, company_id, department_id, name, is_active)
       SELECT $1, company_id, id, 'Refresh test team', TRUE FROM departments WHERE id NOT LIKE 'demo-%' AND is_active IS NOT FALSE ORDER BY id LIMIT 1`,
      [TEAM]
    );
  });

  afterAll(async () => {
    if (local && seeded) await pool.query('DELETE FROM teams WHERE id = $1', [TEAM]);
    await pool.end();
  });

  it('REFRESH-001: adds rows only, and nothing on a second run the same day', async () => {
    if (!local || !seeded) return;
    const before = (await pool.query(FINGERPRINT)).rows[0].h;
    await runRefreshDates();
    const second = await runRefreshDates();
    expect(second.insertedTotal).toBe(0);
    expect((await pool.query(FINGERPRINT)).rows[0].h).toBe(before);
  });

  it('REFRESH-002: a team without sample data gets none', async () => {
    if (!local || !seeded) return;
    const sample = await teamsWithSampleData(pool);
    expect([...sample.values()].flat()).not.toContain(TEAM);
    await runRefreshDates();
    for (const table of ['kpi_snapshots', 'pipeline_runs', 'technical_debt', 'developer_metrics']) {
      const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE team_id = $1`, [TEAM])).rows[0].n;
      expect({ table, n }).toEqual({ table, n: 0 });
    }
    const ra = (await pool.query(`SELECT COUNT(*)::int AS n FROM role_assignments WHERE scope_id = $1`, [TEAM])).rows[0].n;
    expect(ra).toBe(0);
  });
});
