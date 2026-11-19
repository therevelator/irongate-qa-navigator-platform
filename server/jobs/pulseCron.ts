import cron from 'node-cron';
import { runPulseAutoSend } from '../lib/pulseSend';
import { withJobRun } from '../lib/opsLog';

/**
 * Local schedule of the automatic pulse-survey e-mail (on Netlify the Scheduled Function
 * netlify/functions/pulse-auto-send.ts does the same):
 *   PULSE_SEND_CRON (default '40 * * * *', hourly)  e-mail the survey to every team with
 *                                                   automatic sending on whose period just started
 *                                                   (once per team and period)
 * PULSE_CRON=false turns it off (e.g. a second instance; a second run would send nothing anyway).
 * Times are UTC.
 */
if (process.env.PULSE_CRON !== 'false' && !process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  const at = process.env.PULSE_SEND_CRON || '40 * * * *';
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await withJobRun('pulse-auto-send', () => runPulseAutoSend(), (x) => `${x.sent} of ${x.teams} teams sent, ${x.skipped} skipped`);
      if (r.sent) console.log(`[pulse] automatic send: ${r.sent} of ${r.teams} teams sent`);
    } catch (e) {
      console.error('[pulse] automatic send failed:', (e as Error)?.message ?? e);
    } finally {
      running = false;
    }
  };
  cron.schedule(at, run, { timezone: 'UTC' });
  setTimeout(run, 30_000).unref?.();
  console.log(`[pulse] schedule: automatic survey e-mail "${at}" (UTC)`);
}
