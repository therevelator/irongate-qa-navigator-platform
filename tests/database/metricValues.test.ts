/**
 * Metric storage (migration 20261120000000_metric_values_targets_ingestion_log.sql):
 *   MV-001  every kpi_snapshots cell equals the value derived from metric_values as of its day
 *           (the latest non-superseded value recorded before the end of that day), so the
 *           migration's backfill, the seed and the write path keep snapshots derived;
 *   MV-002  the default targets in the database (default_kpi_targets) equal METRICS_CONFIG;
 *   MV-003  refresh_kpi_snapshots creates a missing day, fills only from stored values and never
 *           wipes a cell (inside a rolled-back transaction).
 * Runs against DATABASE_URL from .env (local only).
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { METRICS_CONFIG } from '../../src/config/metricsConfig';
import { TARGET_METRICS } from '../../server/lib/targets';

dotenv.config();

function localConfig() {
  const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`Refusing non-local database host ${url.hostname}`);
  return {
    host: url.hostname, port: parseInt(url.port || '5432', 10), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: url.pathname.slice(1),
  };
}

const COLS = [
  'test_coverage', 'test_flakiness_rate', 'defect_density', 'defect_escape_rate', 'code_quality_score',
  'avg_build_time_minutes', 'test_execution_time_minutes', 'deployment_frequency_per_week', 'lead_time_days',
  'mttr_hours', 'parallel_test_efficiency', 'sprint_velocity', 'sprint_commitment_rate', 'sprint_carryover',
  'first_time_pass_rate', 'blocked_time_hours', 'automation_coverage', 'automation_roi', 'change_failure_rate',
  'mtbf_hours', 'system_availability', 'infrastructure_failures', 'sizing_accuracy',
];

describe('Metric values and derived snapshots', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client(localConfig());
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  it('MV-001: every stored snapshot value equals the value derived from metric_values as of its day', async () => {
    const { rows } = await client.query(`
      WITH cells AS (
        SELECT ks.team_id, ks.snapshot_date, v.metric_key, v.value
          FROM kpi_snapshots ks
          CROSS JOIN LATERAL (VALUES ${COLS.map((c) => `('${c}', ks.${c}::numeric)`).join(', ')}) AS v(metric_key, value)
         WHERE v.value IS NOT NULL
      )
      SELECT c.team_id, c.snapshot_date::text AS d, c.metric_key, c.value::text AS stored,
             (SELECT mv.value FROM metric_values mv
               WHERE mv.team_id = c.team_id AND mv.metric_key = c.metric_key AND mv.superseded_by IS NULL
                 AND mv.recorded_at < (c.snapshot_date + 1)::timestamp AT TIME ZONE 'UTC'
               ORDER BY mv.recorded_at DESC, mv.received_at DESC, mv.id DESC LIMIT 1)::text AS derived
        FROM cells c`);
    const drift = rows.filter((r: any) => r.derived === null || Number(r.derived) !== Number(r.stored));
    expect(drift.slice(0, 10)).toEqual([]);
  });

  it('MV-002: default_kpi_targets() equals METRICS_CONFIG for every target metric', async () => {
    const { rows } = await client.query('SELECT metric_key, good::float8 AS good, warning::float8 AS warning FROM public.default_kpi_targets() ORDER BY 1');
    const expected = Object.entries(TARGET_METRICS)
      .map(([col, key]) => ({ metric_key: col, good: METRICS_CONFIG[key].good, warning: METRICS_CONFIG[key].warning }))
      .sort((a, b) => a.metric_key.localeCompare(b.metric_key));
    expect(rows).toEqual(expected);
    // The migration file holds the same list (the function is defined there).
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261120000000_metric_values_targets_ingestion_log.sql'), 'utf8');
    for (const e of expected) expect(sql).toContain(`('${e.metric_key}', `);
  });

  it('MV-003: refresh_kpi_snapshots creates a missing day, derives it from stored values and never wipes a cell', async () => {
    const { rows: teams } = await client.query(
      `SELECT ks.team_id FROM kpi_snapshots ks GROUP BY ks.team_id HAVING count(*) > 3 LIMIT 1`
    );
    if (!teams.length) return;
    const team = teams[0].team_id;
    await client.query('BEGIN');
    try {
      const { rows: [{ company_id }] } = await client.query('SELECT company_id FROM teams WHERE id = $1', [team]);
      // A value on a day before any snapshot of the team.
      const { rows: [{ d }] } = await client.query(`SELECT (min(snapshot_date) - 400)::text AS d FROM kpi_snapshots WHERE team_id = $1`, [team]);
      await client.query(
        `INSERT INTO metric_values (company_id, team_id, metric_key, value, recorded_at, source)
         VALUES ($1, $2, 'test_coverage', 42.5, ($3::date + time '10:00') AT TIME ZONE 'UTC', 'db-test')`,
        [company_id, team, d]
      );
      await client.query(`SELECT public.refresh_kpi_snapshots($1, $2::date, ARRAY['test_coverage'])`, [team, d]);
      const { rows: [row] } = await client.query(
        `SELECT test_coverage::float8 AS cov, defect_escape_rate, field_sources -> 'test_coverage' AS fs, qa_score FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date = $2::date`,
        [team, d]
      );
      expect(row.cov).toBe(42.5);
      expect(row.defect_escape_rate).toBeNull(); // nothing stored as of that day: not invented
      expect(row.fs).toMatchObject({ source: 'db-test', recorded_at: `${d}T10:00:00.000Z` });
      expect(row.qa_score).toBeNull(); // coverage alone is not enough for a QA score
      // A later cell with no stored value behind it is kept, not wiped.
      const { rows: [latest] } = await client.query(`SELECT snapshot_date::text AS d FROM kpi_snapshots WHERE team_id = $1 ORDER BY snapshot_date DESC LIMIT 1`, [team]);
      await client.query(`UPDATE kpi_snapshots SET mtbf_hours = 123 WHERE team_id = $1 AND snapshot_date = $2::date`, [team, latest.d]);
      await client.query(`DELETE FROM metric_values WHERE team_id = $1 AND metric_key = 'mtbf_hours'`, [team]);
      await client.query(`SELECT public.refresh_kpi_snapshots($1, $2::date, ARRAY['mtbf_hours'])`, [team, d]);
      const { rows: [kept] } = await client.query(`SELECT mtbf_hours FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date = $2::date`, [team, latest.d]);
      expect(kept.mtbf_hours).toBe(123);
      await expect(client.query(`SELECT public.refresh_kpi_snapshots($1, $2::date, ARRAY['not_a_metric'])`, [team, d])).rejects.toThrow(/unknown metric/);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
