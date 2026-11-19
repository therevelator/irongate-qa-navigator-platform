import type { Config } from '@netlify/functions';
import { pool } from '../../src/lib/db';
import { cleanupOperationalLogs, recordJobOutcome, recordServerError, flushBackgroundWrites } from '../../server/lib/opsLog';

/**
 * Database keep-alive (Netlify Scheduled Function, 06:00 and 18:00 UTC): one `SELECT 1`, so a
 * free-tier database that pauses when idle stays awake. Also the retention cleanup of the
 * operations logs (server_errors older than 30 days, user_activity older than 90 days, job_runs
 * older than 90 days). Logs only ok / failed, counts and the duration; never the connection
 * string or any other secret.
 */
export default async () => {
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    const removed = await cleanupOperationalLogs();
    const summary = `ok in ${Date.now() - started} ms; removed ${removed.serverErrors} errors, ${removed.userActivity} activity rows, ${removed.jobRuns} job runs, ${removed.authEvents} sign-in events, ${removed.sessions} sessions`;
    console.log(`[db-keepalive] ${summary}`);
    await recordJobOutcome('db-keepalive', true, summary, new Date(started));
    return new Response('ok');
  } catch (e: any) {
    console.error(`[db-keepalive] failed after ${Date.now() - started} ms (${e?.code ?? 'error'})`);
    await recordJobOutcome('db-keepalive', false, `failed (${e?.code ?? 'error'})`, new Date(started));
    recordServerError({ error: e, functionName: 'db-keepalive', status: 500 });
    await flushBackgroundWrites(1000);
    return new Response('failed', { status: 500 });
  }
};

export const config: Config = { schedule: '0 6,18 * * *' };
