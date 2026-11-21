import { SANDBOX_RESET_HEADER, isValidSandboxResetToken, runSandboxReset, sandboxResetEnabled, summariseReset } from '../../server/lib/sandbox';

/**
 * Demo sandbox reset, worker (Netlify Background Function: the "-background" name gives it up to 15
 * minutes, and the caller gets 202 at once). Started by sandbox-reset.ts (nightly), by the operator
 * panel's "Reset sandbox now" and by the first visit of /try on a database without the sandbox, with a
 * signed token; a request without the right token does nothing. One run at a time (advisory lock); a
 * second run while one is going is skipped. Outcome in job_runs (sandbox-reset-background). Logs counts only.
 */
export default async (req: Request) => {
  if (req.method !== 'POST' || !isValidSandboxResetToken(req.headers.get(SANDBOX_RESET_HEADER))) {
    console.warn('[sandbox-reset-background] ignored a request without a valid token');
    return;
  }
  if (!sandboxResetEnabled()) {
    console.log('[sandbox-reset-background] off (SANDBOX_RESET_ENABLED=false)');
    return;
  }
  try {
    console.log(`[sandbox-reset-background] ${summariseReset(await runSandboxReset('sandbox-reset-background'))}`);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.error(`[sandbox-reset-background] failed (${err?.code ?? 'error'}): ${err?.message ?? String(e)}`);
  }
};
