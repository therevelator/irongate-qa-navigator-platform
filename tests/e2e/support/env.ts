/**
 * Where the suite runs. Local and CI: the Vite app on :5173 and the API on :3000 against a LOCAL
 * test database. Remote (npm run test:ui:remote): a deployed site, read-only tests only
 * (PW_REMOTE=1 is set by scripts/ui-tests/run-remote.mjs, which also enforces --grep @readonly).
 */
export const REMOTE = process.env.PW_REMOTE === '1';
export const APP_URL = (process.env.PW_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
/** The app calls http://localhost:3000/api when served from localhost, else /api on its own origin (src/config/api.ts). */
export const API_URL = (process.env.PW_API_URL || (REMOTE ? `${APP_URL}/api` : 'http://localhost:3000/api')).replace(/\/$/, '');
/** Glob that matches every API request of the app, for page.route(). */
export const API_GLOB = REMOTE ? `${APP_URL}/api/**` : 'http://localhost:3000/api/**';

/** Fail loudly when a data-changing helper is used against a deployed site. */
export function assertLocal(what: string): void {
  if (REMOTE) throw new Error(`${what} is not allowed in remote (live site) mode: only @readonly tests may run there.`);
}
