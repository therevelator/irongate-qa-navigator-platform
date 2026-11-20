/**
 * Raw CI data store (migration 20261129000000) and the calculation engine's scheduled parts:
 *   RAWDB-001  the nightly recalculation (recomputeRecent) writes the evidence and the KPI value
 *              (source 'computed') of a team with raw data, and writes nothing again when nothing changed;
 *   RAWDB-002  sample (is_sample) raw data refreshes its evidence but never writes KPI values;
 *   RAWDB-003  retention (cleanupRawData): payloads and per-test rows after 35 days, raw rows after
 *              13 months; the latest coverage report keeps its files.
 * Runs against DATABASE_URL (local only).
 */
import { pool } from '../../src/lib/db';
import { cleanupRawData, recomputeRecent } from '../../server/lib/calc/engine';

const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
const T = `rawdb-team-${Date.now()}`;
const S = `${T}-sample`;
const today = new Date().toISOString().slice(0, 10);

async function addRun(team: string, id: string, startedAt: string, sample = false, results: Array<[string, string]> = [['a', 'passed'], ['b', 'failed']]) {
  await pool.query(
    `INSERT INTO test_runs (id, company_id, team_id, commit_sha, branch, run_id, attempt, started_at, day, total, passed, failed, duration_ms, is_sample)
     SELECT $1::text, company_id, $2::text, 'c1', 'main', $1::text, 1, $3::timestamptz, ($3::timestamptz AT TIME ZONE 'UTC')::date, $4, $5, $6, 60000, $7 FROM teams WHERE id = $2::text`,
    [id, team, startedAt, results.length, results.filter((r) => r[1] === 'passed').length, results.filter((r) => r[1] === 'failed').length, sample]
  );
  for (const [name, status] of results) {
    await pool.query(`INSERT INTO test_results (test_run_id, team_id, test_key, suite, name, status, duration_ms) VALUES ($1, $2, md5($3::text), 's', $3::text, $4, 100)`, [id, team, name, status]);
  }
}

describe('Raw store: nightly recalculation and retention', () => {
  jest.setTimeout(60000);
  beforeAll(async () => {
    if (!local) return;
    for (const id of [T, S]) {
      await pool.query(
        `INSERT INTO teams (id, company_id, department_id, name, is_active)
         SELECT $1, company_id, id, $1, TRUE FROM departments WHERE is_active IS NOT FALSE ORDER BY id LIMIT 1`, [id]);
    }
  });
  afterAll(async () => {
    if (local) {
      await pool.query('DELETE FROM metric_values WHERE team_id = ANY($1::text[])', [[T, S]]);
      await pool.query('DELETE FROM kpi_snapshots WHERE team_id = ANY($1::text[])', [[T, S]]);
      await pool.query('DELETE FROM teams WHERE id = ANY($1::text[])', [[T, S]]);
    }
    await pool.end();
  });

  it('RAWDB-001 the nightly run computes and writes once', async () => {
    if (!local) return;
    await addRun(T, `${T}-r1`, `${today}T00:10:00Z`);
    await recomputeRecent(1);
    const ev = (await pool.query(`SELECT value::float8 AS v FROM metric_evidence WHERE team_id = $1 AND metric_key = 'pass_rate'`, [T])).rows[0];
    expect(ev.v).toBe(50);
    const mv = await pool.query(`SELECT source FROM metric_values WHERE team_id = $1 AND metric_key = 'first_time_pass_rate'`, [T]);
    expect(mv.rows.map((r) => r.source)).toEqual(['computed']);
    await recomputeRecent(1);
    const counts = (await pool.query(`SELECT metric_key, COUNT(*)::int AS n FROM metric_values WHERE team_id = $1 GROUP BY metric_key`, [T])).rows;
    expect(counts.every((r) => r.n === 1)).toBe(true);
  });

  it('RAWDB-002 sample raw data: evidence only, no KPI values', async () => {
    if (!local) return;
    await addRun(S, `${S}-r1`, `${today}T00:20:00Z`, true);
    await recomputeRecent(1);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM metric_evidence WHERE team_id = $1`, [S])).rows[0].n).toBeGreaterThan(0);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM metric_values WHERE team_id = $1`, [S])).rows[0].n).toBe(0);
  });

  it('RAWDB-003 retention: 35 days for payloads and per-test rows, 13 months for the rest', async () => {
    if (!local) return;
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const ancient = new Date(Date.now() - 400 * 86_400_000).toISOString();
    await addRun(T, `${T}-old`, old);
    await addRun(T, `${T}-ancient`, ancient);
    await pool.query(
      `INSERT INTO raw_uploads (id, company_id, team_id, kind, format, run_id, payload, received_at)
       SELECT $2::text, company_id, id, 'tests', 'junit', $2::text, '\\x1f8b'::bytea, $3::timestamptz FROM teams WHERE id = $1`, [T, `${T}-up-old`, old]);
    for (const [id, at] of [[`${T}-cov-old`, old], [`${T}-cov-new`, `${today}T00:00:00Z`]]) {
      await pool.query(
        `INSERT INTO coverage_reports (id, company_id, team_id, created_at, day, lines_found, lines_hit)
         SELECT $2, company_id, id, $3::timestamptz, ($3::timestamptz)::date, 10, 5 FROM teams WHERE id = $1`, [T, id, at]);
      await pool.query(`INSERT INTO coverage_files (report_id, team_id, path, lines_found, lines_hit) VALUES ($1, $2, 'a.ts', 10, 5)`, [id, T]);
    }
    const r = await cleanupRawData();
    expect(r.testResults).toBeGreaterThanOrEqual(2);
    expect(r.payloads).toBeGreaterThanOrEqual(1);
    const left = async (sql: string, p: any[]) => (await pool.query(sql, p)).rows[0].n;
    expect(await left(`SELECT COUNT(*)::int AS n FROM test_results WHERE test_run_id = $1`, [`${T}-old`])).toBe(0);
    expect(await left(`SELECT COUNT(*)::int AS n FROM test_runs WHERE id = $1`, [`${T}-old`])).toBe(1);
    expect(await left(`SELECT COUNT(*)::int AS n FROM test_runs WHERE id = $1`, [`${T}-ancient`])).toBe(0);
    expect(await left(`SELECT COUNT(*)::int AS n FROM test_results WHERE test_run_id = $1`, [`${T}-r1`])).toBe(2);
    expect(await left(`SELECT COUNT(*)::int AS n FROM raw_uploads WHERE id = $1 AND payload IS NULL`, [`${T}-up-old`])).toBe(1);
    expect(await left(`SELECT COUNT(*)::int AS n FROM coverage_files WHERE report_id = $1`, [`${T}-cov-old`])).toBe(0);
    expect(await left(`SELECT COUNT(*)::int AS n FROM coverage_files WHERE report_id = $1`, [`${T}-cov-new`])).toBe(1);
  });
});
