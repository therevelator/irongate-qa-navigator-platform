/**
 * Raw delivery store (migration 20261130000000) and the calculation engine's scheduled parts for
 * deployments and incidents:
 *   DELDB-001  the nightly recalculation (recomputeRecent) picks up a team whose only raw data are
 *              deployments and incidents, writes the delivery evidence and the KPI values (source
 *              'computed') once, and nothing again when nothing changed;
 *   DELDB-002  sample (is_sample) deployments and incidents are left to the sample refresh, which
 *              records evidence and never writes KPI values; the sample SQL is re-runnable;
 *   DELDB-003  retention (cleanupRawData): deployments, commits and incidents (with their status
 *              updates) after 13 months; recent ones and an old incident still open are kept.
 * Runs against DATABASE_URL (local only).
 */
import { pool } from '../../src/lib/db';
import { cleanupRawData, recomputeRecent } from '../../server/lib/calc/engine';
import { computeSampleEvidence, deliverySampleSqlForTeam } from '../../server/seeds/demoRaw';

const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
const T = `deldb-team-${Date.now()}`;
const S = `${T}-sample`;
const today = new Date().toISOString().slice(0, 10);
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

async function addDeploy(team: string, id: string, finishedAt: string, extra: { result?: string; sample?: boolean } = {}) {
  await pool.query(
    `INSERT INTO deployments_raw (id, company_id, team_id, external_id, environment, is_production, service, commit_sha, commit_shas, finished_at, day, result, is_sample)
     SELECT $1::text, company_id, $2::text, $1::text, 'production', TRUE, 'svc', 'abc1234', ARRAY['abc1234']::varchar[], $3::timestamptz, ($3::timestamptz AT TIME ZONE 'UTC')::date, $4, $5 FROM teams WHERE id = $2::text`,
    [id, team, finishedAt, extra.result ?? 'success', !!extra.sample]);
}
async function addIncident(team: string, id: string, openedAt: string, resolvedAt: string | null, sample = false) {
  await pool.query(
    `INSERT INTO incidents_raw (id, company_id, team_id, external_id, severity, service, status, opened_at, resolved_at, day, is_sample)
     SELECT $1::text, company_id, $2::text, $1::text, 'critical', 'svc', CASE WHEN $4::timestamptz IS NULL THEN 'open' ELSE 'resolved' END, $3::timestamptz, $4::timestamptz,
            ($3::timestamptz AT TIME ZONE 'UTC')::date, $5 FROM teams WHERE id = $2::text`, [id, team, openedAt, resolvedAt, sample]);
  await pool.query(`INSERT INTO incident_updates (incident_id, team_id, status, at) VALUES ($1, $2, 'open', $3::timestamptz)`, [id, team, openedAt]);
}

describe('Delivery store: nightly recalculation, sample data and retention', () => {
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

  it('DELDB-001 the nightly run computes the delivery values of a team with deployments and incidents only, and writes them once', async () => {
    if (!local) return;
    await addDeploy(T, `${T}-d1`, ago(20));
    await addDeploy(T, `${T}-d2`, ago(10), { result: 'rolled_back' });
    await addIncident(T, `${T}-i1`, ago(3), new Date(Date.now() - 3 * 86_400_000 + 3_600_000).toISOString());
    const r = await recomputeRecent(1);
    expect(r.teams).toBeGreaterThanOrEqual(1);
    const ev = Object.fromEntries((await pool.query(`SELECT metric_key, value::float8 AS v FROM metric_evidence WHERE team_id = $1 AND day = $2::date`, [T, today])).rows.map((x) => [x.metric_key, x.v]));
    expect(ev.change_failure_rate).toBe(50);
    expect(ev.mttr).toBe(1);
    expect(ev.deployment_frequency).toBeGreaterThan(0);
    const mv = await pool.query(`SELECT DISTINCT source FROM metric_values WHERE team_id = $1 AND metric_key = 'change_failure_rate'`, [T]);
    expect(mv.rows.map((x) => x.source)).toEqual(['computed']);
    const before = (await pool.query(`SELECT COUNT(*)::int AS n FROM metric_values WHERE team_id = $1`, [T])).rows[0].n;
    await recomputeRecent(1);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM metric_values WHERE team_id = $1`, [T])).rows[0].n).toBe(before);
  });

  it('DELDB-002 sample deployments and incidents: not in the nightly run; the sample refresh records evidence only; the SQL is re-runnable', async () => {
    if (!local) return;
    const team = (await pool.query(`SELECT id, company_id FROM teams WHERE id = $1`, [S])).rows[0];
    const sql = deliverySampleSqlForTeam({ id: S, companyId: team.company_id, name: 'Payments sample', health: Array(35).fill(0.5) });
    for (const st of sql) await pool.query(st);
    const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM deployments_raw WHERE team_id = $1 AND is_sample`, [S])).rows[0].n;
    expect(n).toBeGreaterThan(5);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM deployment_commits WHERE team_id = $1 AND is_sample`, [S])).rows[0].n).toBeGreaterThanOrEqual(n);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM incidents_raw WHERE team_id = $1 AND is_sample`, [S])).rows[0].n).toBeGreaterThan(0);
    let added = 0;
    for (const st of sql) added += (await pool.query(st)).rowCount ?? 0;
    expect(added).toBe(0);
    await recomputeRecent(1);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM metric_evidence WHERE team_id = $1`, [S])).rows[0].n).toBe(0);
    const client = await pool.connect();
    try { await computeSampleEvidence(client, [S], 1); } finally { client.release(); }
    const keys = (await pool.query(`SELECT metric_key FROM metric_evidence WHERE team_id = $1`, [S])).rows.map((x) => x.metric_key);
    expect(keys).toEqual(expect.arrayContaining(['deployment_frequency', 'change_failure_rate', 'availability']));
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM metric_values WHERE team_id = $1`, [S])).rows[0].n).toBe(0);
  });

  it('DELDB-003 retention: deployments, commits and incidents (with their updates) after 13 months; an incident still open is kept', async () => {
    if (!local) return;
    await addDeploy(T, `${T}-ancient`, ago(400));
    await pool.query(
      `INSERT INTO deployment_commits (company_id, team_id, deployment_external_id, sha, authored_at, created_at)
       SELECT company_id, id, $2, 'old1234', $3::timestamptz, $3::timestamptz FROM teams WHERE id = $1`, [T, `${T}-ancient`, ago(400)]);
    await pool.query(
      `INSERT INTO deployment_commits (company_id, team_id, deployment_external_id, sha, authored_at)
       SELECT company_id, id, $2, 'new1234', $3::timestamptz FROM teams WHERE id = $1`, [T, `${T}-d1`, ago(400)]);
    await addIncident(T, `${T}-i-ancient`, ago(400), ago(399));
    await addIncident(T, `${T}-i-open`, ago(400), null);
    const r = await cleanupRawData();
    expect(r.deployments).toBeGreaterThanOrEqual(1);
    expect(r.deploymentCommits).toBeGreaterThanOrEqual(1);
    expect(r.incidents).toBeGreaterThanOrEqual(1);
    const left = async (sql: string, p: any[]) => (await pool.query(sql, p)).rows[0].n;
    expect(await left(`SELECT COUNT(*)::int AS n FROM deployments_raw WHERE id = $1`, [`${T}-ancient`])).toBe(0);
    expect(await left(`SELECT COUNT(*)::int AS n FROM deployments_raw WHERE id = $1`, [`${T}-d1`])).toBe(1);
    expect(await left(`SELECT COUNT(*)::int AS n FROM deployment_commits WHERE team_id = $1 AND sha = 'old1234'`, [T])).toBe(0);
    // A commit authored long ago but received recently stays (lead time of a recent deploy).
    expect(await left(`SELECT COUNT(*)::int AS n FROM deployment_commits WHERE team_id = $1 AND sha = 'new1234'`, [T])).toBe(1);
    expect(await left(`SELECT COUNT(*)::int AS n FROM incidents_raw WHERE id = $1`, [`${T}-i-ancient`])).toBe(0);
    expect(await left(`SELECT COUNT(*)::int AS n FROM incident_updates WHERE incident_id = $1`, [`${T}-i-ancient`])).toBe(0);
    expect(await left(`SELECT COUNT(*)::int AS n FROM incidents_raw WHERE id = $1`, [`${T}-i-open`])).toBe(1);
    expect(await left(`SELECT COUNT(*)::int AS n FROM incidents_raw WHERE id = $1`, [`${T}-i1`])).toBe(1);
  });
});
