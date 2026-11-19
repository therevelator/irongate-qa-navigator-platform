import cron from 'node-cron';
import { cleanupOperationalLogs, recordJobOutcome } from '../lib/opsLog';

/**
 * Local schedule of the operations-log retention (on Netlify netlify/functions/db-keepalive.ts
 * does the same twice a day): server_errors older than 30 days, user_activity and job_runs older
 * than 90 days are deleted. LOG_CLEANUP_CRON (default '7 3 * * *', 03:07 UTC); LOG_CLEANUP_CRON=off
 * turns it off.
 */
if (process.env.LOG_CLEANUP_CRON !== 'off' && !process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const at = process.env.LOG_CLEANUP_CRON || '7 3 * * *';
  cron.schedule(at, async () => {
    const started = new Date();
    try {
      const r = await cleanupOperationalLogs();
      await recordJobOutcome('db-keepalive', true, `cleanup: removed ${r.serverErrors} errors, ${r.userActivity} activity rows, ${r.jobRuns} job runs, ${r.authEvents} sign-in events, ${r.sessions} sessions`, started);
    } catch (e) {
      console.error('[cleanup] failed:', (e as Error)?.message ?? e);
      await recordJobOutcome('db-keepalive', false, 'cleanup failed', started);
    }
  }, { timezone: 'UTC' });
}
