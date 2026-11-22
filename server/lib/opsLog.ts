import { cleanupDeliveries } from './exporterDeliveries';
import type express from 'express';
import { query } from '../../src/lib/db';
import { ctxOf, installErrorCapture, onRequestEnd } from './requestContext';

/**
 * Operations log for remote debugging (platform operator panel):
 *   server_errors  one row per 5xx answer of the API and per failed scheduled job
 *   job_runs       one row per scheduled job run
 *
 * Fail-safe: nothing here throws or delays a response. Writes run in the background and are
 * tracked so the Netlify function can wait for them (briefly, flushBackgroundWrites) before the
 * instance is frozen. Never stored: request bodies, headers, cookies, tokens, query strings.
 */

/** Background writes in flight, with the time each started. */
const pending = new Map<Promise<unknown>, number>();

/** Run a background write; errors are logged (without detail that could hold data) and dropped. */
export function inBackground(label: string, work: () => Promise<unknown>): void {
  let p: Promise<unknown>;
  try {
    p = work().catch((e) => console.error(`[${label}] write failed (${(e as any)?.code ?? (e as Error)?.name ?? 'error'})`));
  } catch (e) {
    console.error(`[${label}] write failed (${(e as Error)?.name ?? 'error'})`);
    return;
  }
  pending.set(p, Date.now());
  p.finally(() => pending.delete(p));
}

/**
 * Wait (at most maxMs) for the background writes: the buffers are drained first (onFlush), then
 * every write started at or after `startedSince` (default: all) is awaited. Never throws.
 *
 * The Netlify function calls this before it returns (netlify/functions/api.ts): the instance is
 * frozen as soon as the handler resolves, so a write still in flight then is suspended and lost
 * when the instance is never thawed or its connection is dropped meanwhile (FI-23). It passes the
 * start of its invocation, so a write left over from an earlier invocation of a frozen instance
 * (possibly hanging on a dead connection) never holds a response for the whole cap.
 */
export async function flushBackgroundWrites(maxMs = 300, opts: { startedSince?: number } = {}): Promise<void> {
  // A response's 'finish' listeners (the request hooks that buffer the activity row) may still be
  // queued: let them run first.
  await new Promise((r) => setImmediate(r));
  const hooks = [...flushHooks].map((h) => Promise.resolve().then(h).catch(() => undefined));
  const since = opts.startedSince ?? -Infinity;
  const own = [...pending].filter(([, at]) => at >= since).map(([p]) => p);
  const all = Promise.allSettled([...hooks, ...own]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([all, new Promise((r) => { timer = setTimeout(r, maxMs); })]);
  if (timer) clearTimeout(timer);
}

const flushHooks = new Set<() => Promise<unknown> | void>();
/** Buffers (user activity) register their flush here so flushBackgroundWrites drains them. */
export function onFlush(hook: () => Promise<unknown> | void): void {
  flushHooks.add(hook);
}

const STACK_MAX = 4096;
const cut = (s: unknown, n: number) => (typeof s === 'string' ? (s.length > n ? s.slice(0, n) : s) : null);

/** Messages can quote SQL parameters or URLs: strip query strings and long tokens. */
export function scrubMessage(msg: unknown): string | null {
  if (typeof msg !== 'string') return null;
  return cut(
    msg
      .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, '$1?…')
      .replace(/\b(igk|igp|igi|igr)_[A-Za-z0-9_-]{8,}/g, '$1_…')
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]'),
    1000,
  );
}

export interface ServerErrorInput {
  requestId?: string | null;
  method?: string | null;
  route?: string | null;
  status?: number | null;
  error: unknown;
  companyId?: string | null;
  userId?: string | null;
  functionName?: string;
}

export function recordServerError(input: ServerErrorInput): void {
  const err = input.error as any;
  inBackground('server_errors', () =>
    query(
      `INSERT INTO server_errors (request_id, method, route, status, error_name, error_message, stack, company_id, user_id, function_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cut(input.requestId ?? null, 64), cut(input.method ?? null, 10), cut(input.route ?? null, 300), input.status ?? null,
        cut(err?.name ?? (err === undefined ? null : typeof err), 200), scrubMessage(err?.message ?? (typeof err === 'string' ? err : null)),
        cut(scrubStack(err?.stack), STACK_MAX),
        cut(input.companyId ?? null, 36), cut(input.userId ?? null, 36), cut(input.functionName ?? 'api', 100),
      ],
    ),
  );
}

function scrubStack(stack: unknown): string | null {
  if (typeof stack !== 'string') return null;
  return stack
    .slice(0, STACK_MAX)
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, '$1?…')
    .replace(/\b(igk|igp|igi|igr)_[A-Za-z0-9_-]{8,}/g, '$1_…')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]');
}

/** The 5xx path of the shared error handler: record the error with the request's context. */
export function recordRequestError(req: express.Request, status: number, error: unknown): void {
  try {
    const ctx = ctxOf(req);
    ctx.errorRecorded = true;
    const user = (req as any).user;
    recordServerError({
      requestId: ctx.requestId, method: req.method, route: ctx.route ?? (req.originalUrl || req.url || '').split('?')[0],
      status, error, companyId: user?.companyId ?? (req as any).apiKey?.companyId ?? null, userId: user?.id ?? null, functionName: 'api',
    });
  } catch { /* never fail the response */ }
}

// 5xx answers sent by a handler itself (res.status(500).json(...)) are recorded too, with the
// error the handler logged (installErrorCapture), or a generic one.
installErrorCapture();
onRequestEnd((req, res, ctx) => {
  if (res.statusCode < 500 || ctx.errorRecorded) return;
  ctx.errorRecorded = true;
  recordRequestError(req, res.statusCode, ctx.lastError ?? Object.assign(new Error('Handler answered with an error status'), { name: 'HttpError', stack: undefined }));
});

/** Scheduled job names (Netlify functions; the long-running server's crons use the same names). */
export const JOB_NAMES = ['alerts-evaluate', 'weekly-digest', 'pulse-auto-send', 'db-keepalive', 'demo-refresh', 'demo-refresh-background', 'demo-data', 'calc-recompute', 'sandbox-reset', 'sandbox-reset-background'] as const;
export type JobName = typeof JOB_NAMES[number];

/**
 * Run a scheduled job and record it in job_runs (and server_errors when it fails). `work`
 * returns a short summary (counts only). Rethrows the job's own error after recording it.
 */
export async function withJobRun<T>(job: JobName, work: () => Promise<T>, summarise: (r: T) => string): Promise<T> {
  let runId: string | null = null;
  try {
    const rows = await query<any[]>('INSERT INTO job_runs (job) VALUES (?) RETURNING id', [job]);
    runId = rows[0]?.id ?? null;
  } catch (e) {
    console.error(`[job_runs] could not record the start of ${job} (${(e as any)?.code ?? 'error'})`);
  }
  try {
    const r = await work();
    let summary = '';
    try { summary = summarise(r).slice(0, 500); } catch { summary = 'done'; }
    if (runId) await query('UPDATE job_runs SET finished_at = now(), ok = TRUE, summary = ? WHERE id = ?', [summary, runId]).catch(() => undefined);
    return r;
  } catch (e) {
    if (runId) await query('UPDATE job_runs SET finished_at = now(), ok = FALSE, summary = ? WHERE id = ?', [`failed: ${scrubMessage((e as Error)?.message) ?? 'error'}`.slice(0, 500), runId]).catch(() => undefined);
    recordServerError({ error: e, functionName: job, status: 500 });
    await flushBackgroundWrites(1000);
    throw e;
  }
}

/** A finished job run in one write (jobs that report their outcome instead of throwing). Awaited, never throws. */
export async function recordJobOutcome(job: JobName, ok: boolean, summary: string, startedAt = new Date()): Promise<void> {
  await query('INSERT INTO job_runs (job, started_at, finished_at, ok, summary) VALUES (?, ?, now(), ?, ?)', [job, startedAt.toISOString(), ok, summary.slice(0, 500)])
    .catch((e) => console.error(`[job_runs] could not record ${job} (${(e as any)?.code ?? 'error'})`));
}

/**
 * Retention: server_errors 30 days, user_activity 90 days, job_runs 90 days, sign-in events
 * (auth_events) and sessions (user_sessions, by issue date) 180 days (daily cleanup in db-keepalive).
 */
export async function cleanupOperationalLogs(): Promise<{ serverErrors: number; userActivity: number; jobRuns: number; authEvents: number; sessions: number; exporterDeliveries: number }> {
  const se = await query<any[]>(`WITH d AS (DELETE FROM server_errors WHERE created_at < now() - interval '30 days' RETURNING 1) SELECT COUNT(*)::int AS n FROM d`);
  const ua = await query<any[]>(`WITH d AS (DELETE FROM user_activity WHERE created_at < now() - interval '90 days' RETURNING 1) SELECT COUNT(*)::int AS n FROM d`);
  const jr = await query<any[]>(`WITH d AS (DELETE FROM job_runs WHERE started_at < now() - interval '90 days' RETURNING 1) SELECT COUNT(*)::int AS n FROM d`);
  const ae = await query<any[]>(`WITH d AS (DELETE FROM auth_events WHERE created_at < now() - interval '180 days' RETURNING 1) SELECT COUNT(*)::int AS n FROM d`);
  const us = await query<any[]>(`WITH d AS (DELETE FROM user_sessions WHERE issued_at < now() - interval '180 days' RETURNING 1) SELECT COUNT(*)::int AS n FROM d`);
  // The operator log of Exporter deliveries (server/lib/exporterDeliveries.ts): 30 days.
  const ed = await cleanupDeliveries();
  return { serverErrors: se[0]?.n ?? 0, userActivity: ua[0]?.n ?? 0, jobRuns: jr[0]?.n ?? 0, authEvents: ae[0]?.n ?? 0, sessions: us[0]?.n ?? 0, exporterDeliveries: ed };
}
