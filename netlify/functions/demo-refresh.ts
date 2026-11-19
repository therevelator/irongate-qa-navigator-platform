import type { Config } from '@netlify/functions';
import { demoRefreshEnabled, startBackgroundDemoRefresh } from '../../server/lib/demoRefreshJob';
import { recordJobOutcome, recordServerError, flushBackgroundWrites } from '../../server/lib/opsLog';

/**
 * Nightly demo refresh, scheduler (Netlify Scheduled Function, 02:17 UTC). A scheduled function
 * may run for 30 seconds and the refresh takes longer, so this only starts
 * demo-refresh-background (see server/lib/demoRefreshJob.ts). Off with DEMO_REFRESH_ENABLED=false.
 * The operator panel's "Refresh sample data now" starts the same background function.
 */
export default async () => {
  const started = new Date();
  if (!demoRefreshEnabled()) {
    await recordJobOutcome('demo-refresh', true, 'off (DEMO_REFRESH_ENABLED=false)', started);
    console.log('[demo-refresh] off (DEMO_REFRESH_ENABLED=false)');
    return new Response('off');
  }
  const r = await startBackgroundDemoRefresh();
  await recordJobOutcome('demo-refresh', r.ok, r.summary, started);
  if (r.status === null && r.summary.startsWith('not started')) {
    console.error(`[demo-refresh] ${r.summary}`);
    return new Response('not configured', { status: 500 });
  }
  if (!r.ok && r.status === null) {
    console.error(`[demo-refresh] ${r.summary}`);
    recordServerError({ error: Object.assign(new Error(r.summary), { name: 'DemoRefreshStartError' }), functionName: 'demo-refresh', status: 502 });
    await flushBackgroundWrites(1000);
    return new Response('failed', { status: 502 });
  }
  console.log(`[demo-refresh] ${r.summary}`);
  return new Response('started', { status: r.ok ? 200 : 502 });
};

export const config: Config = { schedule: '17 2 * * *' };
