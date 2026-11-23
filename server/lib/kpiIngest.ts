/**
 * Source-agnostic KPI ingestion: the one write path for team KPIs.
 *
 * Manual entry (POST /api/metrics/manual), machine ingestion (POST /api/ingest/kpis) and the
 * synthetic generators all call recordKpiValues(). It
 *   - validates column names and ranges against KPI_COLUMNS (the single whitelist),
 *   - stores each value in metric_values with recorded_at = the time the value is FOR
 *     (recordedAt; default now; backfill up to MAX_BACKFILL_DAYS),
 *   - re-derives the team's kpi_snapshots for that day and the later days (metricValues.ts):
 *     a snapshot day holds the latest value of each metric as of that day, with its
 *     provenance in kpi_snapshots.field_sources: { column: { source, recorded_at, recorded_by,
 *     carried_forward? } }, so a partial update never wipes the other metrics,
 *   - with a per-item idempotency key, never writes the same item twice.
 * qa_score / status are never accepted as inputs: the database trigger
 * kpi_snapshots_qa_score computes them from the stored inputs.
 */
import type pg from 'pg';
import { pool, toPgPlaceholders } from '../../src/lib/db';
import { emitJobNotification } from '../eventBus';
import { existingForKey, writeMetricValues } from './metricValues';

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

/** Oldest recordedAt accepted (days before now): values can be backfilled up to a year. */
export const MAX_BACKFILL_DAYS = 365;

/**
 * Parse recordedAt (ISO 8601, the time the value is for); defaults to now. Rejects times more
 * than 5 minutes in the future or more than MAX_BACKFILL_DAYS in the past.
 */
export function parseRecordedAt(value: unknown, now = Date.now()): Date {
  if (value === undefined || value === null || value === '') return new Date(now);
  const d = new Date(typeof value === 'string' || typeof value === 'number' ? value : NaN);
  if (Number.isNaN(d.getTime())) throw new KpiValidationError(['recordedAt must be an ISO 8601 timestamp']);
  if (d.getTime() > now + 5 * 60 * 1000) throw new KpiValidationError(['recordedAt cannot be in the future']);
  if (d.getTime() < now - MAX_BACKFILL_DAYS * 86_400_000) {
    throw new KpiValidationError([`recordedAt cannot be more than ${MAX_BACKFILL_DAYS} days in the past`]);
  }
  return d;
}

/** Also "/": Jenkins JOB_NAME in folders and multibranch jobs is "<project>/<branch>" (e.g. jenkins:payments/main:42). */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.:\/-]{0,199}$/;

/** Validate an idempotency key (header or per item): 1–200 characters, letters, digits, "_", "-", ".", ":", "/". */
export function normaliseIdempotencyKey(value: unknown, field = 'idempotencyKey'): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_RE.test(value.trim())) {
    throw new KpiValidationError([`${field} must be 1–200 characters: letters, digits, "_", "-", ".", ":" or "/"`]);
  }
  return value.trim();
}

/** Optional free-text reference to the source record (build id, URL): at most 500 characters. */
export function normaliseSourceRef(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 500) throw new KpiValidationError(['sourceRef must be a string of at most 500 characters']);
  return value;
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
  /** Per-item idempotency key: a second write with the same key for the team writes nothing. */
  idempotencyKey?: string | null;
  sourceRef?: string | null;
  /** ingestion_log row of the request (links the stored values to it). */
  ingestionId?: string | null;
  /** The team's company when the caller already read it (saves a round trip; the calculation engine). */
  companyId?: string;
}

export interface RecordResult {
  teamId: string;
  /** The snapshot day the values belong to (the UTC day of recordedAt). */
  snapshotDate: string;
  recordedAt: string;
  qaScore: number | null;
  status: string | null;
  updated: KpiColumn[];
  carriedForward: KpiColumn[];
  /** true when the per-item idempotency key was already used: nothing was written. */
  duplicate: boolean;
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
  const run = (client: pg.PoolClient) => recordInTransaction(client, teamId, values, source, recordedAt, options);
  const result = options.client ? await run(options.client) : await withTransaction(run);
  if (options.notify !== false && !result.duplicate) notifyKpisUpdated(result.updated, source);
  // After the write committed (alerts, server/lib/alerts.ts); batch callers (options.client) run their own after their commit.
  if (!options.client && !result.duplicate) await runKpiWrittenHooks([teamId]);
  return result;
}

/** Hooks run after a KPI write committed (registered by server/lib/alerts.ts: alert evaluation). Never throw. */
const kpiWrittenHooks: Array<(teamIds: string[]) => Promise<void>> = [];
export function onKpiWritten(hook: (teamIds: string[]) => Promise<void>): void {
  kpiWrittenHooks.push(hook);
}
async function runKpiWrittenHooks(teamIds: string[]): Promise<void> {
  for (const hook of kpiWrittenHooks) await hook(teamIds).catch((e) => console.error('[kpi] after-write hook failed:', e?.message ?? e));
}

async function recordInTransaction(
  client: pg.PoolClient,
  teamId: string,
  values: KpiValues,
  source: string,
  recordedAt: string,
  options: RecordOptions
): Promise<RecordResult> {
  // Serialise writers for this team so the derived snapshots see a consistent state.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kpi_snapshots:${teamId}`]);

  const [team] = options.companyId ? [{ company_id: options.companyId }] : await q<{ company_id: string }>(client, 'SELECT company_id FROM teams WHERE id = ?', [teamId]);
  if (!team) throw new KpiValidationError([`Unknown team ${teamId}`]);
  const updated = Object.keys(values) as KpiColumn[];
  const key = options.idempotencyKey ?? null;

  let day: string;
  let duplicate = false;
  if (key && (await existingForKey(client, teamId, key)).length > 0) {
    duplicate = true;
    const [{ d }] = await q<{ d: string }>(client, `SELECT to_char((?::timestamptz AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS d`, [recordedAt]);
    day = d;
  } else {
    ({ day } = await writeMetricValues(client, {
      teamId,
      companyId: team.company_id,
      values: values as Record<string, number>,
      recordedAt,
      source,
      actorId: options.actorId ?? null,
      idempotencyKey: key,
      sourceRef: options.sourceRef ?? null,
      ingestionId: options.ingestionId ?? null,
    }));
  }

  const [row] = await q<any>(
    client,
    `SELECT qa_score, status, field_sources FROM kpi_snapshots WHERE team_id = ? AND snapshot_date = ?::date`,
    [teamId, day]
  );
  const sources: Record<string, FieldSource> = row?.field_sources && typeof row.field_sources === 'object' ? row.field_sources : {};
  const carriedForward = KPI_COLUMN_NAMES.filter((c) => !updated.includes(c) && sources[c]?.carried_forward === true);

  return {
    teamId,
    snapshotDate: day,
    recordedAt,
    qaScore: row?.qa_score === null || row?.qa_score === undefined ? null : Number(row.qa_score),
    status: row?.status ?? null,
    updated: duplicate ? [] : updated,
    carriedForward,
    duplicate,
  };
}
