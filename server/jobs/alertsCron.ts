import cron from 'node-cron';
import { runScheduledEvaluation } from '../lib/alerts';
import { refreshDueTeams } from '../lib/recommendations/store';
import { runWeeklyDigest } from '../lib/digest';
import { withJobRun } from '../lib/opsLog';

/**
 * Local schedule of the long-running server (on Netlify the Scheduled Functions in
 * netlify/functions/ do the same):
 *   ALERTS_EVALUATE_CRON (default '15 * * * *', hourly)  evaluate every company's alerts, compute
 *                                                        due action outcomes, send pending
 *                                                        notifications (retries included), then
 *                                                        recalculate the forecasts and recommendations
 *                                                        of the teams that are due (20 s budget)
 *   DIGEST_CRON (default '0 7 * * 1', Monday 07:00 UTC)  weekly digest
 * ALERTS_CRON=false turns both off (e.g. a second instance). Times are UTC.
 */
if (process.env.ALERTS_CRON !== 'false' && !process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const evaluateAt = process.env.ALERTS_EVALUATE_CRON || '15 * * * *';
  const digestAt = process.env.DIGEST_CRON || '0 7 * * 1';
  let running = false;
  const evaluate = async () => {
    if (running) return;
    running = true;
    try {
      const x = await withJobRun('alerts-evaluate', async () => ({ companies: await runScheduledEvaluation(), improve: await refreshDueTeams(Number(process.env.IMPROVE_REFRESH_BUDGET_MS) || 20_000) }),
        (y) => `${y.companies.length} companies, ${y.companies.reduce((n, c) => n + c.opened, 0)} alerts opened; forecasts and recommendations of ${y.improve.teams} teams recalculated${y.improve.skipped ? `, ${y.improve.skipped} left for the next run` : ''}`);
      const r = x.companies;
      const opened = r.reduce((n, c) => n + c.opened, 0);
      const resolved = r.reduce((n, c) => n + c.resolved, 0);
      console.log(`[alerts] scheduled evaluation: ${r.length} companies, ${opened} opened, ${resolved} resolved; ${x.improve.teams} teams' forecasts recalculated`);
    } catch (e) {
      console.error('[alerts] scheduled evaluation failed:', (e as Error)?.message ?? e);
    } finally {
      running = false;
    }
  };
  cron.schedule(evaluateAt, evaluate, { timezone: 'UTC' });
  cron.schedule(digestAt, async () => {
    try {
      const r = await withJobRun('weekly-digest', () => runWeeklyDigest(), (x) => `${x.queued} messages queued for ${x.companies} companies`);
      console.log(`[digest] weekly digest: ${r.queued} messages queued for ${r.companies} companies`);
    } catch (e) {
      console.error('[digest] weekly digest failed:', (e as Error)?.message ?? e);
    }
  }, { timezone: 'UTC' });
  // One evaluation shortly after start, so alerts reflect data loaded while the server was down.
  setTimeout(evaluate, 20_000).unref?.();
  console.log(`[alerts] schedule: evaluation "${evaluateAt}", weekly digest "${digestAt}" (UTC)`);
}
