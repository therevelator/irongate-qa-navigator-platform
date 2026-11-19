import type { Config } from '@netlify/functions';
import { runScheduledEvaluation } from '../../server/lib/alerts';
import { withJobRun } from '../../server/lib/opsLog';

/**
 * Hourly alert evaluation (Netlify Scheduled Function; the long-running server does the same in
 * server/jobs/alertsCron.ts): evaluates every company's alert rules, computes due action
 * outcomes (14 / 30 days after completion) and sends pending email / Slack notifications.
 */
export default async () => {
  try {
    const r = await withJobRun('alerts-evaluate', runScheduledEvaluation,
      (x) => `${x.length} companies, ${x.reduce((n, c) => n + c.opened, 0)} alerts opened`);
    const opened = r.reduce((n, c) => n + c.opened, 0);
    console.log(`[alerts-evaluate] ${r.length} companies, ${opened} alerts opened`);
    return new Response('ok');
  } catch (e: any) {
    console.error('[alerts-evaluate] failed:', e?.message ?? e);
    return new Response('failed', { status: 500 });
  }
};

export const config: Config = { schedule: '15 * * * *' };
