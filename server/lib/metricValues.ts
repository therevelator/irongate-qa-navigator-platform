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
import { isSampleCompanyId } from './sampleCompany';
import { isSandboxCompany } from './sandboxConfig';

/** The KPI columns the monthly quality side of Business impact is derived from (business_impact_quality_metrics). */
export const BUSINESS_QUALITY_KPIS = new Set(['test_coverage', 'defect_density', 'defect_escape_rate', 'mttr_hours', 'deployment_frequency_per_week',
  'lead_time_days', 'code_quality_score', 'change_failure_rate']);

let businessQualitySeen = false;
/** The derivation function exists (a deploy before the migration writes the KPI values without it). */
async function businessQualityReady(client: pg.PoolClient): Promise<boolean> {
  if (businessQualitySeen) return true;
  businessQualitySeen = !!(await client.query(`SELECT to_regprocedure('public.refresh_business_quality_month(text, text)') IS NOT NULL AS ok`)).rows[0]?.ok;
  return businessQualitySeen;
}

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
  const valueIds = metrics.map(() => randomUUID());
  // One INSERT for every value, then one UPDATE: a second value for the same moment is a correction of the first.
  // Values are sent as text, as a single-row insert sends them, so the stored numbers are identical.
  await q(
    client,
    `INSERT INTO metric_values (id, company_id, team_id, metric_key, value, recorded_at, source, source_ref, idempotency_key, actor_id, ingestion_id)
     SELECT x.id, ?, ?, x.metric, x.value::numeric, ?::timestamptz, ?, ?, ?, ?, ?
       FROM unnest(?::text[], ?::text[], ?::text[]) WITH ORDINALITY AS x(id, metric, value, o)
      ORDER BY x.o`,
    [input.companyId, input.teamId, input.recordedAt, input.source, input.sourceRef ?? null, input.idempotencyKey ?? null, input.actorId, input.ingestionId ?? null,
      valueIds, metrics, metrics.map((m) => (input.values[m] === null || input.values[m] === undefined ? null : String(input.values[m])))]
  );
  await q(
    client,
    `UPDATE metric_values mv SET superseded_by = x.id
       FROM unnest(?::text[], ?::text[]) AS x(id, metric)
      WHERE mv.team_id = ? AND mv.metric_key = x.metric AND mv.recorded_at = ?::timestamptz AND mv.superseded_by IS NULL AND mv.id <> x.id`,
    [valueIds, metrics, input.teamId, input.recordedAt]
  );
  // The UTC day of recordedAt, as (recordedAt AT TIME ZONE 'UTC')::date.
  const day = new Date(input.recordedAt).toISOString().slice(0, 10);
  await q(client, 'SELECT public.refresh_kpi_snapshots(?, ?::date, ?::text[])', [input.teamId, day, metrics]);
  // The month's quality side of Business impact follows the KPI values (migration 20261207000000; sample data never).
  if (input.source.toLowerCase() !== 'synthetic' && !isSampleCompanyId(input.companyId) && !isSandboxCompany(input.companyId) && metrics.some((m) => BUSINESS_QUALITY_KPIS.has(m)) && (await businessQualityReady(client))) {
    await q(client, 'SELECT public.refresh_business_quality_month(?, ?)', [input.teamId, day.slice(0, 7)]);
  }
  return { day, valueIds };
}
