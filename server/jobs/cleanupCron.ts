import cron from 'node-cron';
import { cleanupOperationalLogs, recordJobOutcome, withJobRun } from '../lib/opsLog';
import { cleanupRawData, recomputeRecent } from '../lib/calc/engine';

/**
 * Local schedule of the operations-log retention (on Netlify netlify/functions/db-keepalive.ts
 * does the same twice a day): server_errors older than 30 days, user_activity and job_runs older
 * than 90 days are deleted; the raw CI data store is trimmed too (cleanupRawData). LOG_CLEANUP_CRON (default '7 3 * * *', 03:07 UTC); LOG_CLEANUP_CRON=off
 * turns it off.
 */
if (process.env.LOG_CLEANUP_CRON !== 'off' && !process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const at = process.env.LOG_CLEANUP_CRON || '7 3 * * *';
  cron.schedule(at, async () => {
    const started = new Date();
    try {
      const r = await cleanupOperationalLogs();
      await cleanupRawData();
      await recordJobOutcome('db-keepalive', true, `cleanup: removed ${r.serverErrors} errors, ${r.userActivity} activity rows, ${r.jobRuns} job runs, ${r.authEvents} sign-in events, ${r.sessions} sessions`, started);
    } catch (e) {
      console.error('[cleanup] failed:', (e as Error)?.message ?? e);
      await recordJobOutcome('db-keepalive', false, 'cleanup failed', started);
    }
  }, { timezone: 'UTC' });
}

/** Nightly recalculation of the metrics computed from raw CI data (Netlify: netlify/functions/calc-recompute.ts). CALC_RECOMPUTE_CRON (default '41 3 * * *'); off turns it off. */
if (process.env.CALC_RECOMPUTE_CRON !== 'off' && !process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  cron.schedule(process.env.CALC_RECOMPUTE_CRON || '41 3 * * *', async () => {
    await withJobRun('calc-recompute', () => recomputeRecent(8), (x) => `${x.teams} teams, ${x.values} values written${x.skipped ? `, ${x.skipped} left for the next run` : ''}`).catch(() => undefined);
  }, { timezone: 'UTC' });
}
