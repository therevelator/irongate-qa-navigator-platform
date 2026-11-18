/**
 * metric_values: the stored KPI values (one row per team, metric and time the value is for).
 * kpi_snapshots is derived from it per day by the database function refresh_kpi_snapshots
 * (migration 20261120000000): snapshot(team, day).<metric> = the latest non-superseded value
 * recorded before the end of that day (UTC), by recorded_at then received_at.
 *
 * writeMetricValues() is the only writer (called by recordKpiValues in kpiIngest.ts, for the
 * ingestion API, Manual metrics and the synthetic generators). It
 *   - stores one row per metric, recorded_at = the time the value is for (backfill allowed),
 *   - marks an earlier value for the same team, metric and recorded_at as superseded (a
 *     correction), and
 *   - refreshes that day's snapshot and every later snapshot day of the team for the written
 *     metrics. A later value (newer recorded_at) keeps winning on its days, so a backdated value
 *     never overwrites a newer one.
 */
import type pg from 'pg';
import { randomUUID } from 'crypto';
import { toPgPlaceholders } from '../../src/lib/db';

export interface MetricValueInput {
  teamId: string;
  companyId: string;
  values: Record<string, number>;
  recordedAt: string;
  source: string;
  actorId: string | null;
  idempotencyKey?: string | null;
  sourceRef?: string | null;
  ingestionId?: string | null;
}

export async function q<T = any>(client: pg.PoolClient, sql: string, params: any[] = []): Promise<T[]> {
  const r = await client.query(toPgPlaceholders(sql), params);
  return r.rows as T[];
}

/** Metrics already written for this team with this per-item idempotency key. */
export async function existingForKey(client: pg.PoolClient, teamId: string, key: string): Promise<string[]> {
  const rows = await q<{ metric_key: string }>(client, 'SELECT metric_key FROM metric_values WHERE team_id = ? AND idempotency_key = ?', [teamId, key]);
  return rows.map((r) => r.metric_key);
}

/** Insert the values and refresh the derived snapshots. Caller holds the team lock. Returns the snapshot day. */
export async function writeMetricValues(client: pg.PoolClient, input: MetricValueInput): Promise<{ day: string; valueIds: string[] }> {
  const metrics = Object.keys(input.values);
  const valueIds: string[] = [];
  for (const metric of metrics) {
    const id = randomUUID();
    await q(
      client,
      `INSERT INTO metric_values (id, company_id, team_id, metric_key, value, recorded_at, source, source_ref, idempotency_key, actor_id, ingestion_id)
       VALUES (?, ?, ?, ?, ?, ?::timestamptz, ?, ?, ?, ?, ?)`,
      [id, input.companyId, input.teamId, metric, input.values[metric], input.recordedAt, input.source, input.sourceRef ?? null,
        input.idempotencyKey ?? null, input.actorId, input.ingestionId ?? null]
    );
    // A second value for the same moment is a correction of the first.
    await q(
      client,
      `UPDATE metric_values SET superseded_by = ?
        WHERE team_id = ? AND metric_key = ? AND recorded_at = ?::timestamptz AND superseded_by IS NULL AND id <> ?`,
      [id, input.teamId, metric, input.recordedAt, id]
    );
    valueIds.push(id);
  }
  const [{ day }] = await q<{ day: string }>(
    client,
    `SELECT to_char((?::timestamptz AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day`,
    [input.recordedAt]
  );
  await q(client, 'SELECT public.refresh_kpi_snapshots(?, ?::date, ?::text[])', [input.teamId, day, metrics]);
  return { day, valueIds };
}
