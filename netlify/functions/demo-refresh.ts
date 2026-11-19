import type { Config } from '@netlify/functions';
import { DEMO_REFRESH_HEADER, DEMO_REFRESH_PATH, demoRefreshEnabled, demoRefreshToken, siteBaseUrl } from '../../server/lib/demoRefreshJob';
import { recordJobOutcome, recordServerError, flushBackgroundWrites } from '../../server/lib/opsLog';

/**
 * Nightly demo refresh, scheduler (Netlify Scheduled Function, 02:17 UTC). A scheduled function
 * may run for 30 seconds and the refresh takes longer, so this only starts
 * demo-refresh-background (see server/lib/demoRefreshJob.ts). Off with DEMO_REFRESH_ENABLED=false.
 */
export default async () => {
  const started = new Date();
  if (!demoRefreshEnabled()) {
    await recordJobOutcome('demo-refresh', true, 'off (DEMO_REFRESH_ENABLED=false)', started);
    console.log('[demo-refresh] off (DEMO_REFRESH_ENABLED=false)');
    return new Response('off');
  }
  const token = demoRefreshToken();
  const base = siteBaseUrl();
  if (!token || !base) {
    const why = !token ? 'no DEMO_REFRESH_SECRET or JWT_SECRET' : 'site URL unknown';
    console.error(`[demo-refresh] not started: ${why}`);
    await recordJobOutcome('demo-refresh', false, `not started: ${why}`, started);
    return new Response('not configured', { status: 500 });
  }
  try {
    const res = await fetch(`${base}${DEMO_REFRESH_PATH}`, { method: 'POST', headers: { [DEMO_REFRESH_HEADER]: token } });
    console.log(`[demo-refresh] background job requested (${res.status})`);
    await recordJobOutcome('demo-refresh', res.ok, `background job requested (${res.status})`, started);
    return new Response('started', { status: res.ok ? 200 : 502 });
  } catch (e) {
    const err = e as { code?: string; name?: string };
    console.error(`[demo-refresh] could not start the background job (${err?.code ?? err?.name ?? 'error'})`);
    await recordJobOutcome('demo-refresh', false, `could not start the background job (${err?.code ?? err?.name ?? 'error'})`, started);
    recordServerError({ error: e, functionName: 'demo-refresh', status: 502 });
    await flushBackgroundWrites(1000);
    return new Response('failed', { status: 502 });
  }
};

export const config: Config = { schedule: '17 2 * * *' };
