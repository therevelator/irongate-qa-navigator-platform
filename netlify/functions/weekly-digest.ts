import type { Config } from '@netlify/functions';
import { runWeeklyDigest } from '../../server/lib/digest';

/**
 * Weekly digest (Netlify Scheduled Function, Mondays 07:00 UTC; locally server/jobs/alertsCron.ts):
 * evaluates the alerts, then emails each manager / lead who has the digest on (their scope) and
 * posts the company summary to Slack where enabled. A second run in the same ISO week sends
 * nothing (dedupe key per recipient and week).
 */
export default async () => {
  try {
    const r = await runWeeklyDigest();
    console.log(`[weekly-digest] ${r.queued} messages queued for ${r.companies} companies`);
    return new Response('ok');
  } catch (e: any) {
    console.error('[weekly-digest] failed:', e?.message ?? e);
    return new Response('failed', { status: 500 });
  }
};

export const config: Config = { schedule: '0 7 * * 1' };
