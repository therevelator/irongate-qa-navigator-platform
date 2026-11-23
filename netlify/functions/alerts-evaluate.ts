import type { Config } from '@netlify/functions';
import { runScheduledEvaluation } from '../../server/lib/alerts';
import { refreshDueTeams } from '../../server/lib/recommendations/store';
import { withJobRun } from '../../server/lib/opsLog';
import { kickPendingCalc } from '../../server/lib/calc/queue';

/**
 * Hourly alert evaluation (Netlify Scheduled Function; the long-running server does the same in
 * server/jobs/alertsCron.ts): evaluates every company's alert rules, computes due action
 * outcomes (14 / 30 days after completion) and sends pending email / Slack notifications.
 * Then, with the time left of a 25 s budget (a scheduled function may run 30 s), it recalculates
 * the forecasts and recommendations of the teams that are due (none yet, older than 20 hours or
 * older than their newest value; server/lib/recommendations/store.ts refreshDueTeams), oldest
 * first: every team is recalculated about once a day, and the first runs after the migration
 * backfill them all. First, the safety net of the calculation queue: calc-drain-background is started for every
 * company whose queued calculations wait (server/lib/calc/queue.ts; normally the ingestion request started it).
 */
export const IMPROVE_TOTAL_BUDGET_MS = 25_000;

export default async () => {
  const started = Date.now();
  const kicked = await kickPendingCalc();
  if (kicked.companies) console.log(`[alerts-evaluate] calculation queue: ${kicked.companies} companies waiting, ${kicked.started} drains started`);
  try {
    const r = await withJobRun('alerts-evaluate', async () => {
      const companies = await runScheduledEvaluation();
      const improve = await refreshDueTeams(Math.max(0, IMPROVE_TOTAL_BUDGET_MS - (Date.now() - started)));
      return { companies, improve };
    }, (x) => `${x.companies.length} companies, ${x.companies.reduce((n, c) => n + c.opened, 0)} alerts opened; forecasts and recommendations of ${x.improve.teams} teams recalculated${x.improve.skipped ? `, ${x.improve.skipped} left for the next run` : ''}`);
    const opened = r.companies.reduce((n, c) => n + c.opened, 0);
    console.log(`[alerts-evaluate] ${r.companies.length} companies, ${opened} alerts opened, ${r.improve.teams} teams' forecasts recalculated`);
    return new Response('ok');
  } catch (e: any) {
    console.error('[alerts-evaluate] failed:', e?.message ?? e);
    return new Response('failed', { status: 500 });
  }
};

export const config: Config = { schedule: '15 * * * *' };
