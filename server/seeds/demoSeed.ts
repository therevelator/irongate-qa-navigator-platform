/**
 * Demo (sample) data seed: writes the dataset from demoData.ts into the database.
 *
 * Additive and idempotent: one transaction of INSERT … ON CONFLICT DO NOTHING statements
 * (re-running adds nothing new on the same day). Existing non-demo rows are never read
 * for writing, updated or deleted. clearDemoData() removes the demo company's rows only.
 *
 * Used by `npm run seed:demo` (server/seeds/demoSeedCli.ts) and by
 * POST /api/analytics/seed-data (super_admin, ENABLE_SYNTHETIC_DATA=true).
 */
import { pool } from '../../src/lib/db';
import {
  buildDemoDataset, renderStatements, CLEAR_STATEMENTS, ALL_TABLES, demoRowCondition, demoSummary, todayUtc,
  DEMO_COMPANY_ID, DemoSummary,
} from './demoData';

export interface DemoSeedResult extends DemoSummary {
  /** Rows actually inserted per table in this run (0 for rows that already existed). */
  inserted: Record<string, number>;
  insertedTotal: number;
  /** Rows the dataset contains per table. */
  planned: Record<string, number>;
  durationMs: number;
}

let running: Promise<unknown> | null = null;

/** Serialise seed/clear runs inside one process (the HTTP route can be clicked twice). */
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  while (running) await running.catch(() => undefined);
  const p = fn();
  running = p;
  try { return await p; } finally { if (running === p) running = null; }
}

export function runDemoSeed(opts: { today?: string; log?: (msg: string) => void } = {}): Promise<DemoSeedResult> {
  return exclusive(async () => {
    const started = Date.now();
    const today = opts.today ?? todayUtc();
    const log = opts.log ?? (() => undefined);
    const ds = buildDemoDataset({ today });
    const statements = renderStatements(ds);
    const planned: Record<string, number> = {};
    for (const t of ds.tables()) planned[t] = ds.count(t);
    const inserted: Record<string, number> = {};

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Two seeds against the same database (CLI + app) wait for each other.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('irongate-demo-seed'))");
      for (const s of statements) {
        const r = await client.query(s.sql);
        if (s.rows > 0) inserted[s.table] = (inserted[s.table] ?? 0) + (r.rowCount ?? 0);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    const insertedTotal = Object.values(inserted).reduce((a, b) => a + b, 0);
    log(`Demo seed: ${insertedTotal} new rows in ${Object.keys(planned).length} tables (${Date.now() - started} ms).`);
    return { ...demoSummary(today), inserted, insertedTotal, planned, durationMs: Date.now() - started };
  });
}

/** Delete every demo row (FK-safe order, one transaction). Returns rows deleted per table. */
export function clearDemoData(): Promise<Record<string, number>> {
  return exclusive(async () => {
    const deleted: Record<string, number> = {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('irongate-demo-seed'))");
      for (const s of CLEAR_STATEMENTS) {
        const r = await client.query(s.sql);
        deleted[s.table] = r.rowCount ?? 0;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    return deleted;
  });
}

/** Per-table row counts: all rows, and demo rows. */
export async function tableCounts(): Promise<Array<{ table: string; total: number; demo: number }>> {
  const out: Array<{ table: string; total: number; demo: number }> = [];
  for (const table of ALL_TABLES) {
    const r = await pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ${demoRowCondition(table)})::int AS demo FROM ${table}`);
    out.push({ table, total: r.rows[0].total, demo: r.rows[0].demo });
  }
  return out;
}

/** Whether the demo company exists (for the admin panel). */
export async function isDemoSeeded(): Promise<boolean> {
  const r = await pool.query('SELECT 1 FROM companies WHERE id = $1', [DEMO_COMPANY_ID]);
  return (r.rowCount ?? 0) > 0;
}
