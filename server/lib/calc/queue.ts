/**
 * The calculation queue (table calc_queue, migration 20261206000000): store fast in the request, calculate in the
 * background.
 *
 * Why: on Netlify the API is a synchronous function that is stopped after 10 seconds (free plan), and every database
 * round trip crosses from the functions' region to the database's (~80 ms). Recalculating the metrics of the days a
 * request touched (server/lib/calc/engine.ts recomputeTeamDays) took most of an ingestion request's time: one
 * Exporter batch of 15 pipeline runs needed ~330 round trips (~27 s) and was cut off with a 502.
 *
 * How:
 *   1. In the request, the raw records are validated and stored as before, and the affected days are recorded here
 *      instead of being recalculated: (team, from_day, to_day, kinds), in the same transaction as the records, so
 *      the work is never lost. A pending entry of the same team and kinds that overlaps or touches the new range is
 *      merged into it (one entry, the union of the days). The answer says "calculation": "queued".
 *   2. After the request committed, it starts the drain (triggerCalcDrain): on Netlify the background function
 *      calc-drain-background (15 minutes; started with a signed token, like demo-data-background), at most once
 *      while a drain of the company is running (calc_queue_kicks); elsewhere in this process, after the answer.
 *      The hourly alerts-evaluate and the twice-daily db-keepalive also start it when entries wait (safety net).
 *   3. The drain (drainCalcQueue) claims one entry at a time (FOR UPDATE SKIP LOCKED: two drains never take the
 *      same entry), cuts a long range into chunks of CHUNK_DAYS days, recalculates them with the engine and marks
 *      the entry done in the same transaction. After its work it runs what the ingestion handlers ran after a
 *      calculation (dashboard refresh event, alert evaluation and action outcomes) once per company. A failed
 *      entry is retried with a growing delay, at most MAX_ATTEMPTS times, then marked failed (job_runs and
 *      server_errors). It stops before its time budget and starts itself again when work remains.
 *
 * Mode (calcDeferred): queued on Netlify; inline (calculated in the request, as before) on the long-running server,
 * unless INGEST_CALC=queued (then the drain runs in this process after the answer). INGEST_CALC=inline forces the
 * old behaviour anywhere. Before the migration is applied the queue table is missing and everything is inline.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import type pg from 'pg';
import { pool, query } from '../../../src/lib/db';
import { notifyKpisUpdated, withTransaction } from '../kpiIngest';
import { recomputeTeamDays, type DayResult, type MetricGroup, type RecomputeOptions } from './engine';
import { runningOnNetlify, siteBaseUrl } from '../demoRefreshJob';
import { recordJobOutcome, recordServerError, scrubMessage } from '../opsLog';

export const CALC_DRAIN_HEADER = 'x-calc-drain-token';
export const CALC_DRAIN_PATH = '/.netlify/functions/calc-drain-background';
/** Days recalculated per transaction (a longer range is cut; each chunk is its own transaction). */
export const CHUNK_DAYS = Number(process.env.CALC_CHUNK_DAYS) || 14;
/** Tries per entry before it is marked failed. */
export const MAX_ATTEMPTS = 5;
/** A running entry older than this belongs to a drain that was stopped (a background function lives 15 minutes). */
export const STALE_MINUTES = 20;
/** While a drain of a company is believed to run, no other is started for it (it picks up new entries itself). */
export const KICK_HOLD_SECONDS = 15 * 60;
/** Time budget of one background run (the function is stopped at 15 minutes). */
export const BACKGROUND_BUDGET_MS = Number(process.env.CALC_DRAIN_BUDGET_MS) || 12 * 60_000;

const KINDS: readonly MetricGroup[] = ['ci', 'delivery', 'work', 'quality', 'automation'];
const DAY = 86_400_000;

/* ------------------------------------------------------------------------------------------
 * Mode
 * ---------------------------------------------------------------------------------------- */

/** Ingestion calculates in the background (queue) rather than in the request. */
export function calcDeferred(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.INGEST_CALC ?? '').trim().toLowerCase();
  if (v === 'queued') return true;
  if (v === 'inline') return false;
  return runningOnNetlify(env);
}

let tableSeen = false;
/** The queue table exists (the migration was applied); checked once per process when it does. */
export async function calcQueueReady(client: pg.PoolClient): Promise<boolean> {
  if (tableSeen) return true;
  tableSeen = !!(await client.query(`SELECT to_regclass('public.calc_queue') IS NOT NULL AND to_regclass('public.calc_queue_kicks') IS NOT NULL AS ok`)).rows[0]?.ok;
  return tableSeen;
}

/* ------------------------------------------------------------------------------------------
 * Enqueue (in the ingestion request's transaction)
 * ---------------------------------------------------------------------------------------- */

const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Days as contiguous ranges ([from, to], inclusive), sorted. */
export function contiguousRanges(days: string[]): Array<[string, string]> {
  const list = Array.from(new Set(days.filter(isDay))).sort();
  const out: Array<[string, string]> = [];
  for (const d of list) {
    const last = out[out.length - 1];
    if (last && addDays(last[1], 1) === d) last[1] = d;
    else out.push([d, d]);
  }
  return out;
}

/** The days of a range, from the first to the last (inclusive). */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface EnqueueInput {
  companyId: string;
  teamId: string;
  days: string[];
  kinds: MetricGroup[];
  ingestionId?: string | null;
  actorId?: string | null;
}

/**
 * Record the days to recalculate (one statement): the new ranges and the pending entries of the same team and kinds
 * that overlap or touch them become one entry per island of days. Returns the number of entries written.
 */
export async function enqueueCalc(client: pg.PoolClient, e: EnqueueInput): Promise<number> {
  const ranges = contiguousRanges(e.days);
  const kinds = KINDS.filter((k) => e.kinds.includes(k));
  if (!ranges.length || !kinds.length) return 0;
  const r = await client.query(
    `WITH new_r(f, t) AS (SELECT * FROM unnest($4::date[], $5::date[])),
     hit AS (
       DELETE FROM calc_queue q
        WHERE q.team_id = $2 AND q.kinds = $3::text[] AND q.status = 'pending'
          AND EXISTS (SELECT 1 FROM new_r WHERE q.from_day <= new_r.t + 1 AND q.to_day >= new_r.f - 1)
       RETURNING q.from_day, q.to_day, q.enqueued_at),
     all_r AS (SELECT f, t, now() AS e FROM new_r UNION ALL SELECT from_day, to_day, enqueued_at FROM hit),
     brk AS (
       SELECT f, t, e, CASE WHEN f <= MAX(t) OVER (ORDER BY f, t ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) + 1 THEN 0 ELSE 1 END AS b FROM all_r),
     grp AS (SELECT f, t, e, SUM(b) OVER (ORDER BY f, t ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS g FROM brk)
     INSERT INTO calc_queue (company_id, team_id, from_day, to_day, kinds, ingestion_id, actor_id, enqueued_at)
     SELECT $1, $2, MIN(f), MAX(t), $3::text[], $6, $7, MIN(e) FROM grp GROUP BY g
     RETURNING id`,
    [e.companyId, e.teamId, kinds, ranges.map((x) => x[0]), ranges.map((x) => x[1]), e.ingestionId ?? null, e.actorId ?? null]
  );
  return r.rowCount ?? 0;
}

/**
 * The ingestion handlers' calculation step: recalculated now (inline mode, the old behaviour) or queued (the answer
 * then says calculation "queued" and the caller starts the drain after its commit: kickCalc).
 */
export async function calcOrQueue(
  client: pg.PoolClient, companyId: string, teamId: string, days: string[], opts: RecomputeOptions & { groups: MetricGroup[] },
): Promise<{ days: DayResult[]; queued: boolean }> {
  if (!days.length) return { days: [], queued: false };
  if (calcDeferred() && (await calcQueueReady(client))) {
    await enqueueCalc(client, { companyId, teamId, days, kinds: opts.groups, ingestionId: opts.ingestionId ?? null, actorId: opts.actorId ?? null });
    return { days: [], queued: true };
  }
  return { days: await recomputeTeamDays(client, teamId, days, opts), queued: false };
}

/** Where a handler that queued work reports it: the Exporter batch starts one drain for all its parts. */
export interface CalcSink { queued: boolean }

/** After a commit that queued work: tell the batch (sink), or start the drain now. Never throws. */
export async function kickCalc(companyId: string, sink?: CalcSink | null): Promise<void> {
  if (sink) { sink.queued = true; return; }
  await triggerCalcDrain(companyId).catch((e) => console.error(`[calc-queue] trigger failed: ${scrubMessage((e as Error)?.message)}`));
}

/* ------------------------------------------------------------------------------------------
 * Starting the drain
 * ---------------------------------------------------------------------------------------- */

export function calcDrainToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.DEMO_REFRESH_SECRET || env.JWT_SECRET;
  return secret ? createHmac('sha256', secret).update('irongate-calc-drain-v1').digest('hex') : null;
}

export function isValidCalcDrainToken(received: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = calcDrainToken(env);
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Drains running in this process (long-running server), per company; a new request during one makes it run again. */
const localDrains = new Map<string, { again: boolean; done: Promise<void> }>();

function startLocalDrain(companyId: string): void {
  const cur = localDrains.get(companyId);
  if (cur) { cur.again = true; return; }
  const st = { again: false, done: Promise.resolve() };
  localDrains.set(companyId, st);
  st.done = (async () => {
    await new Promise((r) => setImmediate(r)); // after the answer
    do {
      st.again = false;
      await runCalcDrain({ companyId, mode: 'inline' }).catch((e) => console.error(`[calc-queue] drain failed: ${scrubMessage((e as Error)?.message)}`));
    } while (st.again);
  })().finally(() => localDrains.delete(companyId));
}

/** Wait for this process's drains (tests, shutdown). */
export async function waitForLocalDrains(): Promise<void> {
  while (localDrains.size) await Promise.all([...localDrains.values()].map((s) => s.done));
}

export interface TriggerResult { mode: 'background' | 'inline'; started: boolean; reason: string }

/**
 * Start a drain for the company. On Netlify: the background function, unless one was started for the company and has
 * not reported idle (calc_queue_kicks; `force` skips that check: a drain restarting itself). Elsewhere: in this
 * process, after the current answer. Never throws.
 */
export async function triggerCalcDrain(companyId: string, opts: { force?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<TriggerResult> {
  const env = opts.env ?? process.env;
  if (!runningOnNetlify(env)) {
    startLocalDrain(companyId);
    return { mode: 'inline', started: true, reason: 'in this process' };
  }
  try {
    const kicked = await query<any[]>(
      `INSERT INTO calc_queue_kicks (company_id, kicked_at) VALUES (?, now())
       ON CONFLICT (company_id) DO UPDATE SET kicked_at = now() WHERE ${opts.force ? 'TRUE' : 'calc_queue_kicks.kicked_at < now() - make_interval(secs => ?)'}
       RETURNING company_id`, opts.force ? [companyId] : [companyId, KICK_HOLD_SECONDS]);
    if (!kicked.length) return { mode: 'background', started: false, reason: 'a drain is already running' };
  } catch (e) {
    console.error(`[calc-queue] kick not recorded (${(e as any)?.code ?? 'error'})`);
  }
  const unkick = () => query(`UPDATE calc_queue_kicks SET kicked_at = '-infinity' WHERE company_id = ?`, [companyId]).catch(() => undefined);
  const token = calcDrainToken(env);
  const base = siteBaseUrl(env);
  if (!token || !base) {
    const reason = !token ? 'no DEMO_REFRESH_SECRET or JWT_SECRET' : 'site URL unknown';
    await unkick();
    await recordJobOutcome('calc-queue', false, `not started: ${reason}`);
    return { mode: 'background', started: false, reason };
  }
  try {
    const res = await fetch(`${base}${CALC_DRAIN_PATH}`, {
      method: 'POST', headers: { [CALC_DRAIN_HEADER]: token, 'content-type': 'application/json' }, body: JSON.stringify({ companyId }), signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      await unkick();
      await recordJobOutcome('calc-queue', false, `not started: status ${res.status}`);
      return { mode: 'background', started: false, reason: `status ${res.status}` };
    }
    return { mode: 'background', started: true, reason: `status ${res.status}` };
  } catch (e) {
    const err = e as { code?: string; name?: string };
    await unkick();
    await recordJobOutcome('calc-queue', false, `not started: ${err?.code ?? err?.name ?? 'error'}`);
    return { mode: 'background', started: false, reason: err?.code ?? err?.name ?? 'error' };
  }
}

/**
 * Safety net of the scheduled functions: start a drain for every company with entries that wait (or that a stopped
 * drain left running). Never throws.
 */
export async function kickPendingCalc(env: NodeJS.ProcessEnv = process.env): Promise<{ companies: number; started: number }> {
  try {
    const rows = await query<any[]>(
      `SELECT DISTINCT company_id FROM calc_queue
        WHERE (status = 'pending' AND not_before <= now()) OR (status = 'running' AND started_at < now() - make_interval(mins => ?))`, [STALE_MINUTES]);
    let started = 0;
    for (const r of rows) if ((await triggerCalcDrain(r.company_id, { env })).started) started++;
    return { companies: rows.length, started };
  } catch (e) {
    if ((e as any)?.code !== '42P01') console.error(`[calc-queue] safety net failed (${(e as any)?.code ?? 'error'})`);
    return { companies: 0, started: 0 };
  }
}

/* ------------------------------------------------------------------------------------------
 * The drain
 * ---------------------------------------------------------------------------------------- */

export interface QueueEntry {
  id: string;
  company_id: string;
  team_id: string;
  from_day: string;
  to_day: string;
  kinds: MetricGroup[];
  attempts: number;
  ingestion_id: string | null;
  actor_id: string | null;
}

export interface DrainOptions {
  /** Only this company's entries (the background function is started per company). */
  companyId?: string | null;
  /** Stop claiming entries after this long (ms). */
  budgetMs?: number;
  chunkDays?: number;
  maxAttempts?: number;
  /** Delay before the n-th retry: retryDelayMs × 2^(n-1). */
  retryDelayMs?: number;
  /** Wait for a retry that is due within this long (ms) instead of stopping (within the budget). */
  waitForRetriesMs?: number;
  /** The calculation (tests inject a failing or slow one). */
  recompute?: typeof recomputeTeamDays;
}

export interface DrainResult {
  processed: number;
  days: number;
  values: number;
  retried: number;
  failed: number;
  /** Entries still waiting when the drain stopped (budget reached). */
  remaining: number;
  teams: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function claim(companyId: string | null, chunkDays: number): Promise<QueueEntry | null> {
  const rows = (await pool.query(
    `WITH c AS (
       SELECT id FROM calc_queue
        WHERE ($1::text IS NULL OR company_id = $1)
          AND ((status = 'pending' AND not_before <= now()) OR (status = 'running' AND started_at < now() - make_interval(mins => $2)))
        ORDER BY enqueued_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
     UPDATE calc_queue q SET status = 'running', attempts = q.attempts + 1, started_at = now(), updated_at = now()
       FROM c WHERE q.id = c.id
     RETURNING q.id, q.company_id, q.team_id, to_char(q.from_day, 'YYYY-MM-DD') AS from_day, to_char(q.to_day, 'YYYY-MM-DD') AS to_day, q.kinds, q.attempts,
               q.ingestion_id, q.actor_id`, [companyId, STALE_MINUTES])).rows;
  const e = rows[0] as QueueEntry | undefined;
  if (!e) return null;
  // A long range: this run takes the first chunk, the rest waits as a new entry (same place in the queue).
  const cut = addDays(e.from_day, chunkDays);
  if (cut <= e.to_day) {
    await pool.query(
      `WITH rest AS (
         INSERT INTO calc_queue (company_id, team_id, from_day, to_day, kinds, ingestion_id, actor_id, enqueued_at)
         SELECT company_id, team_id, $2::date, to_day, kinds, ingestion_id, actor_id, enqueued_at FROM calc_queue WHERE id = $1)
       UPDATE calc_queue SET to_day = $2::date - 1 WHERE id = $1`, [e.id, cut]);
    e.to_day = addDays(cut, -1);
  }
  return e;
}

async function waiting(companyId: string | null): Promise<{ claimable: number; nextRetryInMs: number | null }> {
  const r = (await pool.query(
    `SELECT COUNT(*) FILTER (WHERE (status = 'pending' AND not_before <= now()) OR (status = 'running' AND started_at < now() - make_interval(mins => $2)))::int AS claimable,
            (EXTRACT(EPOCH FROM MIN(not_before) FILTER (WHERE status = 'pending' AND not_before > now()) - now()) * 1000)::float8 AS next_ms
       FROM calc_queue WHERE ($1::text IS NULL OR company_id = $1) AND status IN ('pending', 'running')`, [companyId, STALE_MINUTES])).rows[0];
  return { claimable: r?.claimable ?? 0, nextRetryInMs: r?.next_ms === null || r?.next_ms === undefined ? null : Math.max(0, Number(r.next_ms)) };
}

/** The company's drain reports idle: the next ingestion starts a new one (see triggerCalcDrain). */
async function markIdle(companyId: string | null): Promise<void> {
  if (!companyId) return;
  await pool.query(`UPDATE calc_queue_kicks SET kicked_at = '-infinity' WHERE company_id = $1`, [companyId]).catch(() => undefined);
}
async function markBusy(companyId: string | null): Promise<void> {
  if (!companyId) return;
  await pool.query(`INSERT INTO calc_queue_kicks (company_id, kicked_at) VALUES ($1, now()) ON CONFLICT (company_id) DO UPDATE SET kicked_at = now()`, [companyId]).catch(() => undefined);
}

/**
 * Recalculate queued entries until the queue is empty or the budget is spent. Safe with several drains at once (each
 * entry is claimed by one drain). Returns counts only.
 */
export async function drainCalcQueue(o: DrainOptions = {}): Promise<DrainResult> {
  const started = Date.now();
  const companyId = o.companyId ?? null;
  const budget = o.budgetMs ?? BACKGROUND_BUDGET_MS;
  const chunkDays = Math.max(1, o.chunkDays ?? CHUNK_DAYS);
  const maxAttempts = o.maxAttempts ?? MAX_ATTEMPTS;
  const retryDelay = o.retryDelayMs ?? 30_000;
  const waitFor = o.waitForRetriesMs ?? 3 * 60_000;
  const recompute = o.recompute ?? recomputeTeamDays;
  const out: DrainResult = { processed: 0, days: 0, values: 0, retried: 0, failed: 0, remaining: 0, teams: 0 };
  // What the ingestion handlers did after a calculation, once per company at the end: KPI columns written, per team.
  const written = new Map<string, Map<string, Set<string>>>();
  const teams = new Set<string>();
  let idleMarked = false;
  await markBusy(companyId);
  try {
    for (;;) {
      if (Date.now() - started > budget) break;
      const e = await claim(companyId, chunkDays);
      if (!e) {
        if (!idleMarked) {
          // Mark idle first, then look once more: an entry committed after this look is kicked by its request.
          await markIdle(companyId);
          idleMarked = true;
          continue;
        }
        const w = await waiting(companyId);
        if (w.claimable) { idleMarked = false; await markBusy(companyId); continue; }
        if (w.nextRetryInMs !== null && w.nextRetryInMs <= waitFor && Date.now() - started + w.nextRetryInMs < budget) {
          await markBusy(companyId);
          idleMarked = false;
          await sleep(w.nextRetryInMs + 50);
          continue;
        }
        break;
      }
      if (idleMarked) { idleMarked = false; await markBusy(companyId); }
      teams.add(e.team_id);
      if (e.attempts > maxAttempts) {
        // A drain stopped while it held this entry, too many times.
        await pool.query(`UPDATE calc_queue SET status = 'failed', finished_at = now(), updated_at = now(), last_error = COALESCE(last_error, 'stopped while calculating') WHERE id = $1`, [e.id]);
        out.failed++;
        continue;
      }
      const days = daysOf(e.from_day, e.to_day);
      try {
        const result = await withTransaction(async (client) => {
          const r = await recompute(client, e.team_id, days, { groups: e.kinds, ingestionId: e.ingestion_id, actorId: e.actor_id });
          await client.query(`UPDATE calc_queue SET status = 'done', finished_at = now(), updated_at = now(), last_error = NULL WHERE id = $1`, [e.id]);
          return r;
        });
        out.processed++;
        out.days += days.length;
        const cols = result.flatMap((d) => d.metrics.filter((m) => m.written && m.kpi).map((m) => m.kpi as string));
        out.values += cols.length;
        if (cols.length) {
          const byTeam = written.get(e.company_id) ?? new Map<string, Set<string>>();
          const set = byTeam.get(e.team_id) ?? new Set<string>();
          for (const c of cols) set.add(c);
          byTeam.set(e.team_id, set);
          written.set(e.company_id, byTeam);
        }
      } catch (err) {
        const final = e.attempts >= maxAttempts;
        const message = (scrubMessage((err as Error)?.message) ?? 'error').slice(0, 500);
        await pool.query(
          `UPDATE calc_queue SET status = $2::text, last_error = $3, updated_at = now(), not_before = now() + make_interval(secs => $4::float8),
                  finished_at = CASE WHEN $2::text = 'failed' THEN now() ELSE NULL END
            WHERE id = $1`, [e.id, final ? 'failed' : 'pending', message, final ? 0 : (retryDelay * 2 ** (e.attempts - 1)) / 1000])
          // Not recorded: the entry stays 'running' and is taken again once stale (STALE_MINUTES).
          .catch((u) => console.error(`[calc-queue] could not record the failure of entry ${e.id} (${(u as any)?.code ?? 'error'})`));
        if (final) {
          out.failed++;
          recordServerError({ error: err, functionName: 'calc-queue', status: 500 });
        } else out.retried++;
        console.error(`[calc-queue] entry ${e.id} failed (attempt ${e.attempts} of ${maxAttempts}): ${message}`);
      }
    }
  } finally {
    for (const [company, byTeam] of written) {
      notifyKpisUpdated(Array.from(new Set([...byTeam.values()].flatMap((s) => [...s]))), 'computed');
      const { afterKpiWrite } = await import('../alerts');
      await afterKpiWrite(company, [...byTeam.keys()]);
    }
  }
  out.teams = teams.size;
  out.remaining = (await waiting(companyId).catch(() => ({ claimable: 0 }))).claimable;
  if (out.remaining && idleMarked) await markBusy(companyId);
  return out;
}

export const summariseDrain = (r: DrainResult) =>
  `${r.processed} entries (${r.days} team-days, ${r.teams} teams), ${r.values} values written${r.retried ? `, ${r.retried} to retry` : ''}${r.failed ? `, ${r.failed} failed` : ''}${r.remaining ? `, ${r.remaining} left for the next run` : ''}`;

/**
 * One drain run as a job (job_runs 'calc-queue'): the background function and the in-process drain. When work remains
 * after the budget, the drain starts itself again (`restart`).
 */
export async function runCalcDrain(o: { companyId: string | null; mode: 'background' | 'inline'; budgetMs?: number; env?: NodeJS.ProcessEnv; recompute?: DrainOptions['recompute'] }): Promise<DrainResult> {
  const startedAt = new Date();
  let r: DrainResult;
  try {
    r = await drainCalcQueue({ companyId: o.companyId, budgetMs: o.budgetMs ?? (o.mode === 'background' ? BACKGROUND_BUDGET_MS : 5 * 60_000), recompute: o.recompute });
  } catch (e) {
    await recordJobOutcome('calc-queue', false, `failed: ${scrubMessage((e as Error)?.message) ?? 'error'}`, startedAt);
    recordServerError({ error: e, functionName: 'calc-queue', status: 500 });
    throw e;
  }
  if (r.processed || r.failed || r.retried) await recordJobOutcome('calc-queue', r.failed === 0, summariseDrain(r), startedAt);
  if (r.remaining && o.companyId) {
    if (o.mode === 'background') await triggerCalcDrain(o.companyId, { force: true, env: o.env });
    else startLocalDrainLater(o.companyId);
  }
  return r;
}

/** In-process: the running drain loops again (startLocalDrain's `again`). */
function startLocalDrainLater(companyId: string): void {
  const cur = localDrains.get(companyId);
  if (cur) cur.again = true;
  else startLocalDrain(companyId);
}

/* ------------------------------------------------------------------------------------------
 * Status (Connect your CI, ingestion log) and retention
 * ---------------------------------------------------------------------------------------- */

export interface TeamCalcStatus { pending: boolean; from: string | null; to: string | null; since: string | null; failed: number }

/** Per team of the company: calculation pending (queued or running) and recent failures. Empty when the table is missing. */
export async function calcStatusByTeam(companyId: string): Promise<Map<string, TeamCalcStatus>> {
  const rows = await query<any[]>(
    `SELECT team_id,
            COUNT(*) FILTER (WHERE status IN ('pending', 'running'))::int AS pending,
            to_char(MIN(from_day) FILTER (WHERE status IN ('pending', 'running')), 'YYYY-MM-DD') AS from_day,
            to_char(MAX(to_day) FILTER (WHERE status IN ('pending', 'running')), 'YYYY-MM-DD') AS to_day,
            MIN(enqueued_at) FILTER (WHERE status IN ('pending', 'running')) AS since,
            COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '7 days')::int AS failed
       FROM calc_queue WHERE company_id = ? AND (status IN ('pending', 'running') OR (status = 'failed' AND updated_at > now() - interval '7 days'))
      GROUP BY team_id`, [companyId]).catch(() => [] as any[]);
  return new Map(rows.map((r: any) => [r.team_id, {
    pending: r.pending > 0, from: r.from_day ?? null, to: r.to_day ?? null, since: r.since ? new Date(r.since).toISOString() : null, failed: r.failed,
  }]));
}

/** Retention (db-keepalive): done entries after 7 days, failed ones after 30. */
export async function cleanupCalcQueue(): Promise<number> {
  try {
    const r = await pool.query(`DELETE FROM calc_queue WHERE (status = 'done' AND updated_at < now() - interval '7 days') OR (status = 'failed' AND updated_at < now() - interval '30 days')`);
    return r.rowCount ?? 0;
  } catch (e) {
    if ((e as any)?.code !== '42P01') throw e;
    return 0;
  }
}
