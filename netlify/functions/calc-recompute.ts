import type { Config } from '@netlify/functions';
import { recomputeRecent } from '../../server/lib/calc/engine';
import { withJobRun } from '../../server/lib/opsLog';

/**
 * Nightly recalculation of the metrics computed from raw CI data (Netlify Scheduled Function,
 * 03:41 UTC; the long-running server does the same in server/jobs/cleanupCron.ts): the last 8 days
 * of every team with raw test, coverage or pipeline data are recalculated (late files, the 7-day
 * flaky window moving on). Values that did not change are not written again. Teams with sample raw
 * data only are refreshed by demo-refresh instead; the run stops after 25 s (CALC_RECOMPUTE_BUDGET_MS).
 */
export default async () => {
  try {
    const r = await withJobRun('calc-recompute', () => recomputeRecent(8), (x) => `${x.teams} teams, ${x.values} values written${x.skipped ? `, ${x.skipped} left for the next run` : ''}`);
    console.log(`[calc-recompute] ${r.teams} teams, ${r.values} values written`);
    return new Response('ok');
  } catch (e: any) {
    console.error('[calc-recompute] failed:', e?.message ?? e);
    return new Response('failed', { status: 500 });
  }
};

export const config: Config = { schedule: '41 3 * * *' };
