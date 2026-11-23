import { CALC_DRAIN_HEADER, isValidCalcDrainToken, runCalcDrain, summariseDrain } from '../../server/lib/calc/queue';
import { flushBackgroundWrites } from '../../server/lib/opsLog';

/**
 * The calculation queue's worker (Netlify Background Function: the "-background" name gives it up to 15 minutes, and
 * the caller gets 202 at once). Started with a signed token by an ingestion request that queued work (an Exporter
 * batch, a CI upload), by itself when work remains after its budget, and by the hourly alerts-evaluate / twice-daily
 * db-keepalive when entries wait (server/lib/calc/queue.ts). A request without the right token does nothing.
 * Recalculates the company's queued team-days in chunks for about 12 minutes (CALC_DRAIN_BUDGET_MS), marks them done,
 * then runs the alert evaluation for the teams whose values changed. Outcome in job_runs (calc-queue). Logs counts only.
 */
export default async (req: Request) => {
  let companyId: string | null = null;
  try {
    const body: any = await req.json().catch(() => ({}));
    companyId = typeof body?.companyId === 'string' && body.companyId ? body.companyId.slice(0, 36) : null;
  } catch { /* no body */ }
  if (req.method !== 'POST' || !isValidCalcDrainToken(req.headers.get(CALC_DRAIN_HEADER))) {
    console.warn('[calc-drain-background] ignored a request without a valid token');
    return;
  }
  try {
    const r = await runCalcDrain({ companyId, mode: 'background' });
    console.log(`[calc-drain-background] ${summariseDrain(r)}`);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.error(`[calc-drain-background] failed (${err?.code ?? 'error'})`);
  } finally {
    await flushBackgroundWrites(2000);
  }
};
