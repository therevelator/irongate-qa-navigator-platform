/**
 * Source-agnostic KPI ingestion: the one write path for team KPIs (kpi_snapshots).
 *
 * Manual entry (POST /api/metrics/manual) and machine ingestion (POST /api/ingest/kpis)
 * both call recordKpiValues(). It
 *   - validates column names and ranges against KPI_COLUMNS (the single whitelist),
 *   - upserts today's snapshot for the team,
 *   - when today's row is new, carries every KPI column forward from the team's most
 *     recent earlier snapshot (with that value's original provenance), so a partial
 *     update never wipes the other metrics,
 *   - records per-field provenance in kpi_snapshots.field_sources:
 *       { column: { source, recorded_at, recorded_by } }.
 * qa_score / status are never accepted as inputs: the database trigger
 * kpi_snapshots_qa_score computes them from the stored inputs.
 */
import type pg from 'pg';
import { pool, toPgPlaceholders } from '../../src/lib/db';
import { emitJobNotification } from '../eventBus';

export interface KpiColumnSpec {
  label: string;
  min: number;
  max: number;
  /** Stored in an integer column: values are rounded to the nearest whole number. */
  integer?: boolean;
  unit?: string;
}

/** Every writable KPI column of kpi_snapshots, with the range its column type can hold. */
export const KPI_COLUMNS = {
  test_coverage: { label: 'Test coverage', min: 0, max: 100, unit: '%' },
  test_flakiness_rate: { label: 'Test flakiness rate', min: 0, max: 100, unit: '%' },
  defect_density: { label: 'Defect density', min: 0, max: 999.999, unit: 'defects/KLOC' },
  defect_escape_rate: { label: 'Defect escape rate', min: 0, max: 100, unit: '%' },
  code_quality_score: { label: 'Code quality score', min: 0, max: 100, integer: true },
  avg_build_time_minutes: { label: 'Average build time', min: 0, max: 100000, integer: true, unit: 'min' },
  test_execution_time_minutes: { label: 'Test execution time', min: 0, max: 100000, integer: true, unit: 'min' },
  deployment_frequency_per_week: { label: 'Deployment frequency', min: 0, max: 9999.99, unit: '/week' },
  lead_time_days: { label: 'Lead time for changes', min: 0, max: 99.99, unit: 'days' },
  mttr_hours: { label: 'Mean time to recovery', min: 0, max: 9999.99, unit: 'h' },
  parallel_test_efficiency: { label: 'Parallel test efficiency', min: 0, max: 100, unit: '%' },
  sprint_velocity: { label: 'Sprint velocity', min: 0, max: 100000, integer: true, unit: 'points' },
  sprint_commitment_rate: { label: 'Sprint commitment rate', min: 0, max: 999.99, unit: '%' },
  sprint_carryover: { label: 'Sprint carryover', min: 0, max: 100, unit: '%' },
  first_time_pass_rate: { label: 'First-time pass rate', min: 0, max: 100, unit: '%' },
  blocked_time_hours: { label: 'Blocked time', min: 0, max: 100000, integer: true, unit: 'h' },
  automation_coverage: { label: 'Automation coverage', min: 0, max: 100, unit: '%' },
  automation_roi: { label: 'Automation ROI', min: -9999.99, max: 9999.99, unit: '%' },
  change_failure_rate: { label: 'Change failure rate', min: 0, max: 100, unit: '%' },
  mtbf_hours: { label: 'Mean time between failures', min: 0, max: 1000000, integer: true, unit: 'h' },
  // numeric(6,3) since migration 20261118000000, so 100.000 % is stored as sent.
  system_availability: { label: 'System availability', min: 0, max: 100, unit: '%' },
  infrastructure_failures: { label: 'Infrastructure failures', min: 0, max: 100000, integer: true },
  sizing_accuracy: { label: 'Sizing accuracy', min: 0, max: 99.99, unit: 'ratio' },
} as const satisfies Record<string, KpiColumnSpec>;

export type KpiColumn = keyof typeof KPI_COLUMNS;
export const KPI_COLUMN_NAMES = Object.keys(KPI_COLUMNS) as KpiColumn[];

/** Computed by the database; never accepted from a writer. */
const COMPUTED_FIELDS = new Set(['qa_score', 'status', 'qaScore']);

export type KpiValues = Partial<Record<KpiColumn, number>>;

export interface FieldSource {
  source: string;
  recorded_at: string;
  recorded_by?: string | null;
  /** True on fields copied from an earlier snapshot when today's row was created. */
  carried_forward?: boolean;
}

export class KpiValidationError extends Error {
  status = 400;
  errors: string[];
  constructor(errors: string[]) {
    super(errors.join('; '));
    this.errors = errors;
  }
}

/**
 * Validate a {column: value} object against KPI_COLUMNS. null / undefined / '' mean
 * "not provided" and are skipped (they never clear a stored value). Returns the
 * cleaned values; throws KpiValidationError listing every problem.
 */
export function validateKpiValues(input: unknown): KpiValues {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new KpiValidationError(['metrics must be an object of {column: number}']);
  }
  const errors: string[] = [];
  const out: KpiValues = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (COMPUTED_FIELDS.has(key)) {
      errors.push(`${key} is computed from the inputs and cannot be supplied`);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(KPI_COLUMNS, key)) {
      errors.push(`Unknown metric "${key}"`);
      continue;
    }
    if (raw === null || raw === undefined || raw === '') continue;
    const spec: KpiColumnSpec = KPI_COLUMNS[key as KpiColumn];
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
    if (!Number.isFinite(n)) {
      errors.push(`${key} must be a number`);
      continue;
    }
    const value = spec.integer ? Math.round(n) : n;
    if (value < spec.min || value > spec.max) {
      errors.push(`${key} must be between ${spec.min} and ${spec.max}${spec.unit ? ` (${spec.unit})` : ''}`);
      continue;
    }
    out[key as KpiColumn] = value;
  }
  if (errors.length) throw new KpiValidationError(errors);
  if (Object.keys(out).length === 0) throw new KpiValidationError(['No metric values provided']);
  return out;
}

const SOURCE_RE = /^[a-z0-9][a-z0-9_.-]{0,49}$/;

/** Normalise and validate a source label (e.g. 'jenkins', 'jira', 'sonarqube'). */
export function normaliseSource(source: unknown): string {
  const s = typeof source === 'string' ? source.trim().toLowerCase() : '';
  if (!SOURCE_RE.test(s)) {
    throw new KpiValidationError(['source must be 1–50 characters: letters, digits, "_", "-" or "."']);
  }
  return s;
}

/** Parse recordedAt (ISO 8601); defaults to now; rejects times more than 5 minutes in the future. */
export function parseRecordedAt(value: unknown): Date {
  if (value === undefined || value === null || value === '') return new Date();
  const d = new Date(typeof value === 'string' || typeof value === 'number' ? value : NaN);
  if (Number.isNaN(d.getTime())) throw new KpiValidationError(['recordedAt must be an ISO 8601 timestamp']);
  if (d.getTime() > Date.now() + 5 * 60 * 1000) throw new KpiValidationError(['recordedAt cannot be in the future']);
  return d;
}

export interface RecordOptions {
  source: string;
  recordedAt?: Date;
  /** User id (manual entry) or 'api_key:<id>' (ingestion). */
  actorId?: string | null;
  /** Run inside an existing transaction (batch ingestion). */
  client?: pg.PoolClient;
  /** Emit the dashboard refresh event after the write (default true; batch callers emit once). */
  notify?: boolean;
}

export interface RecordResult {
  teamId: string;
  snapshotDate: string;
  qaScore: number | null;
  status: string | null;
  updated: KpiColumn[];
  carriedForward: KpiColumn[];
}

async function q<T = any>(client: pg.PoolClient, sql: string, params: any[] = []): Promise<T[]> {
  const r = await client.query(toPgPlaceholders(sql), params);
  return r.rows as T[];
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Tell open dashboards that team KPIs changed (WebSocket JOB_NOTIFICATION, source 'metrics'). */
export function notifyKpisUpdated(columns: string[], source: string) {
  emitJobNotification({
    source: 'metrics',
    frequency: 'on-demand',
    message: `Team metrics updated (${source})`,
    updatedMetrics: columns,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Record KPI values for a team (caller has already checked the team belongs to the
 * caller's company). Values are validated here as well, so every path is covered.
 */
export async function recordKpiValues(teamId: string, rawValues: unknown, options: RecordOptions): Promise<RecordResult> {
  const values = validateKpiValues(rawValues);
  const source = normaliseSource(options.source);
  const recordedAt = (options.recordedAt ?? new Date()).toISOString();
  const run = (client: pg.PoolClient) => recordInTransaction(client, teamId, values, source, recordedAt, options.actorId ?? null);
  const result = options.client ? await run(options.client) : await withTransaction(run);
  if (options.notify !== false) notifyKpisUpdated(result.updated, source);
  return result;
}

async function recordInTransaction(
  client: pg.PoolClient,
  teamId: string,
  values: KpiValues,
  source: string,
  recordedAt: string,
  actorId: string | null
): Promise<RecordResult> {
  // Serialise writers for this team so carry-forward and the upsert see a consistent state.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kpi_snapshots:${teamId}`]);

  const cols = KPI_COLUMN_NAMES;
  let carriedForward: KpiColumn[] = [];

  const [today] = await q(client, 'SELECT id FROM kpi_snapshots WHERE team_id = ? AND snapshot_date = CURRENT_DATE', [teamId]);
  if (!today) {
    const [prev] = await q<any>(
      client,
      `SELECT ${cols.join(', ')}, field_sources, to_char(snapshot_date, 'YYYY-MM-DD') AS snapshot_day
         FROM kpi_snapshots
        WHERE team_id = ? AND snapshot_date < CURRENT_DATE
        ORDER BY snapshot_date DESC
        LIMIT 1`,
      [teamId]
    );
    const carried: Record<string, unknown> = {};
    const carriedSources: Record<string, FieldSource> = {};
    if (prev) {
      const prevSources: Record<string, FieldSource> = prev.field_sources && typeof prev.field_sources === 'object' ? prev.field_sources : {};
      for (const c of cols) {
        if (prev[c] === null || prev[c] === undefined) continue;
        carried[c] = prev[c];
        carriedForward.push(c);
        // Keep the value's original provenance so staleness stays visible.
        carriedSources[c] = prevSources[c]
          ? { ...prevSources[c], carried_forward: true }
          : { source: 'unknown', recorded_at: prev.snapshot_day, recorded_by: null, carried_forward: true };
      }
    }
    const insertCols = Object.keys(carried);
    await q(
      client,
      `INSERT INTO kpi_snapshots (team_id, snapshot_date, field_sources${insertCols.map((c) => `, ${c}`).join('')})
       VALUES (?, CURRENT_DATE, ?::jsonb${insertCols.map(() => ', ?').join('')})
       ON CONFLICT (team_id, snapshot_date) DO NOTHING`,
      [teamId, JSON.stringify(carriedSources), ...insertCols.map((c) => carried[c])]
    );
  }

  const updated = Object.keys(values) as KpiColumn[];
  carriedForward = carriedForward.filter((c) => !updated.includes(c));
  const newSources: Record<string, FieldSource> = {};
  for (const c of updated) newSources[c] = { source, recorded_at: recordedAt, recorded_by: actorId };

  const [row] = await q<any>(
    client,
    `UPDATE kpi_snapshots
        SET ${updated.map((c) => `${c} = ?`).join(', ')},
            field_sources = COALESCE(field_sources, '{}'::jsonb) || ?::jsonb,
            manually_edited = COALESCE(manually_edited, FALSE) OR ?
      WHERE team_id = ? AND snapshot_date = CURRENT_DATE
      RETURNING qa_score, status, to_char(snapshot_date, 'YYYY-MM-DD') AS snapshot_day`,
    [...updated.map((c) => values[c]), JSON.stringify(newSources), source === 'manual', teamId]
  );

  return {
    teamId,
    snapshotDate: row.snapshot_day,
    qaScore: row.qa_score === null || row.qa_score === undefined ? null : Number(row.qa_score),
    status: row.status ?? null,
    updated,
    carriedForward,
  };
}
