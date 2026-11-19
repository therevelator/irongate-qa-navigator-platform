import type { Config } from '@netlify/functions';
import { runPulseAutoSend } from '../../server/lib/pulseSend';
import { withJobRun } from '../../server/lib/opsLog';

/**
 * Automatic wellbeing pulse e-mail (Netlify Scheduled Function, hourly; locally
 * server/jobs/pulseCron.ts): every team with automatic sending on gets the survey once at the
 * start of each period (deduplicated per team and period by the database, so extra runs send
 * nothing). Personal links are never logged.
 */
export default async () => {
  try {
    const r = await withJobRun('pulse-auto-send', () => runPulseAutoSend(), (x) => `${x.sent} of ${x.teams} teams sent, ${x.skipped} skipped`);
    console.log(`[pulse-auto-send] ${r.sent} of ${r.teams} teams sent, ${r.skipped} skipped`);
    return new Response('ok');
  } catch (e: any) {
    console.error('[pulse-auto-send] failed:', e?.message ?? e);
    return new Response('failed', { status: 500 });
  }
};

export const config: Config = { schedule: '40 * * * *' };
