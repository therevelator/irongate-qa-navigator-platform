import type { Config } from '@netlify/functions';
import { sandboxResetEnabled, startSandboxReset } from '../../server/lib/sandbox';
import { recordJobOutcome } from '../../server/lib/opsLog';

/**
 * Nightly demo sandbox reset, scheduler (Netlify Scheduled Function, 02:47 UTC, after the sample data
 * refresh at 02:17). A scheduled function may run for 30 seconds and the rebuild takes longer, so this
 * only starts sandbox-reset-background (see server/lib/sandbox.ts), which ends every sandbox session,
 * deletes the sandbox company and builds it again with today's dates. Off with SANDBOX_RESET_ENABLED=false.
 * The operator panel's "Reset sandbox now" starts the same background function.
 */
export default async () => {
  if (!sandboxResetEnabled()) {
    await recordJobOutcome('sandbox-reset', true, 'off (SANDBOX_RESET_ENABLED=false)');
    console.log('[sandbox-reset] off (SANDBOX_RESET_ENABLED=false)');
    return new Response('off');
  }
  const r = await startSandboxReset({ behindNetlify: true, reason: 'nightly' });
  console[r.ok ? 'log' : 'error'](`[sandbox-reset] ${r.summary}`);
  return new Response(r.ok ? 'started' : 'failed', { status: r.ok ? 200 : 502 });
};

export const config: Config = { schedule: '47 2 * * *' };
