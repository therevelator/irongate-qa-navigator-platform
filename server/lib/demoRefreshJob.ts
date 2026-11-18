/**
 * Nightly demo refresh (netlify/functions/demo-refresh.ts starts it, demo-refresh-background.ts
 * runs it): the same work as `npm run seed:demo -- --refresh-dates`. It adds the missing recent
 * days of sample data for the demo company and for teams that already hold sample rows, never
 * changes or deletes a row and never touches real data (runRefreshDates in server/seeds/demoSeed.ts).
 *
 * Why two functions: a Netlify scheduled function may run for 30 seconds, and the refresh takes
 * longer. The scheduled function only calls the background function (up to 15 minutes), which
 * Netlify answers with 202 straight away.
 *
 * The background function has a public URL, so the call carries a token: an HMAC of a fixed
 * label with DEMO_REFRESH_SECRET (or, if unset, JWT_SECRET). A request without the right token
 * does nothing. Nothing secret is logged.
 *
 * Settings:
 *   DEMO_REFRESH_ENABLED=false   turn the nightly refresh off (on by default)
 *   DEMO_REFRESH_SECRET          optional; signs the call (falls back to JWT_SECRET)
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const DEMO_REFRESH_HEADER = 'x-demo-refresh-token';
export const DEMO_REFRESH_PATH = '/.netlify/functions/demo-refresh-background';

export function demoRefreshEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DEMO_REFRESH_ENABLED ?? '').trim().toLowerCase() !== 'false';
}

/** The token the scheduler sends; null when no secret is configured (then nothing runs). */
export function demoRefreshToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.DEMO_REFRESH_SECRET || env.JWT_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update('irongate-demo-refresh-v1').digest('hex');
}

/** Constant-time check of a received token. */
export function isValidDemoRefreshToken(received: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = demoRefreshToken(env);
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Base URL of the deployed site (Netlify sets URL; DEPLOY_PRIME_URL on branch deploys). */
export function siteBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const u = env.URL || env.DEPLOY_PRIME_URL || env.APP_URL;
  return u ? u.replace(/\/+$/, '') : null;
}

/** Run the refresh and return a one-line summary (counts and dates only). */
export async function runNightlyDemoRefresh(): Promise<string> {
  const { runRefreshDates } = await import('../seeds/demoSeed');
  const started = Date.now();
  const r = await runRefreshDates();
  const teams = r.companies.reduce((n, c) => n + c.teamsFilled, 0);
  return `up to ${r.today}: ${r.insertedTotal} new rows `
    + `(demo company ${r.demoCompany.refreshed ? `${r.demoCompany.insertedTotal}` : 'not seeded'}, `
    + `${teams} sample teams in ${r.companies.length} companies) in ${Math.round((Date.now() - started) / 1000)} s`;
}
