import { DEMO_REFRESH_HEADER, demoRefreshEnabled, isValidDemoRefreshToken, runNightlyDemoRefresh } from '../../server/lib/demoRefreshJob';
import { withJobRun } from '../../server/lib/opsLog';

/**
 * Nightly demo refresh, worker (Netlify Background Function: the "-background" name gives it up to
 * 15 minutes, and the caller gets 202 at once). Started by demo-refresh.ts; a request without the
 * signed token does nothing. Same work as `npm run seed:demo -- --refresh-dates`: only adds missing
 * recent sample rows, never changes or deletes a row, never touches real data. Logs counts only.
 */
export default async (req: Request) => {
  if (req.method !== 'POST' || !isValidDemoRefreshToken(req.headers.get(DEMO_REFRESH_HEADER))) {
    console.warn('[demo-refresh-background] ignored a request without a valid token');
    return;
  }
  if (!demoRefreshEnabled()) {
    console.log('[demo-refresh-background] off (DEMO_REFRESH_ENABLED=false)');
    return;
  }
  try {
    console.log(`[demo-refresh-background] done ${await withJobRun('demo-refresh-background', runNightlyDemoRefresh, (s) => s)}`);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.error(`[demo-refresh-background] failed (${err?.code ?? 'error'}): ${err?.message ?? String(e)}`);
  }
};
