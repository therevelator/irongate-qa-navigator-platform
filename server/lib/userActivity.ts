import type express from 'express';
import { query } from '../../src/lib/db';
import { clientIp, onRequestEnd, type RequestContext } from './requestContext';
import { inBackground, onFlush } from './opsLog';

/**
 * User activity log (table user_activity): every authenticated API request (reads included),
 * sign-in, failed sign-in, API-key ingestion request and screen view, per company. Visible to the
 * company's super admins (canViewUserActivity) and to the platform operator.
 *
 * Stored per row: who (user or API key; name / email at the time), category, method, the route
 * PATTERN (never the raw URL or query string), the main entity ids taken from the path
 * parameters, status, duration, client IP, user agent (200 characters) and request id.
 * NEVER stored: request or response bodies, query strings, headers, cookies, tokens, passwords.
 *
 * Not recorded: /health, static files, OPTIONS, the session check (GET /api/auth/me), the
 * wellbeing pulse answers (their time could be matched to an anonymous answer), the
 * user activity screen's own list requests (opening it is recorded as a screen view and its CSV
 * export as an export), and platform operator requests (/api/operator: recorded in
 * platform_access_log and the company's audit_log instead).
 *
 * Writes are buffered and inserted in batches in the background (never blocking or failing a
 * request); the Netlify function drains the buffer before it returns (flushBackgroundWrites).
 */

export type ActivityCategory = 'sign_in' | 'sign_in_failed' | 'view' | 'screen' | 'change' | 'export' | 'ingest';
export const ACTIVITY_CATEGORIES: ActivityCategory[] = ['sign_in', 'sign_in_failed', 'view', 'screen', 'change', 'export', 'ingest'];

export interface ActivityRow {
  companyId: string | null;
  userId: string | null;
  apiKeyId: string | null;
  /** Failed sign-in: the typed email, only used to find the user (never stored as typed). */
  email: string | null;
  category: ActivityCategory;
  method: string | null;
  route: string | null;
  screen: string | null;
  teamId: string | null;
  entityType: string | null;
  entityId: string | null;
  status: number | null;
  durationMs: number | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  at: string;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const safeId = (v: unknown): string | null => (typeof v === 'string' && ID_RE.test(v) ? v : null);

/** Routes never recorded (see the header). Patterns, /api prefix included. */
// Answering the wellbeing pulse is never recorded: the time of an answer could be matched to the
// (anonymous) answer itself.
const SKIP_EXACT = new Set([
  '/api/auth/me', '/api/activity/screen', '/api/activity/log', '/api/activity/log/facets',
  '/api/pulse/teams/:teamId/responses', '/api/pulse/link', '/api/pulse/link/respond',
]);
const isSkipped = (route: string | null, path: string) =>
  path.startsWith('/api/operator') || path.startsWith('/operator') || path.includes('/functions/api/operator') || (route ?? '').startsWith('/api/operator') || path === '/health' || (route !== null && SKIP_EXACT.has(route));

/** Entity of a route: the first path parameter and the collection it belongs to. */
const COLLECTION_TYPE: Record<string, string> = {
  teams: 'team', users: 'user', departments: 'department', invitations: 'invitation', 'api-keys': 'api_key',
  alerts: 'alert', actions: 'action', 'saved-views': 'saved_view', audit: 'audit_entry', notifications: 'notification',
};
const PARAM_TYPE: Record<string, string> = { teamId: 'team', userId: 'user', departmentId: 'department', developerId: 'user' };

export function entityOf(route: string | null, params: Record<string, string>): { teamId: string | null; entityType: string | null; entityId: string | null } {
  let teamId = safeId(params.teamId);
  let entityType: string | null = null;
  let entityId: string | null = null;
  if (route) {
    const parts = route.split('/');
    for (let i = 1; i < parts.length; i++) {
      const m = /^:([A-Za-z]+)/.exec(parts[i]);
      if (!m) continue;
      const name = m[1];
      const value = safeId(params[name]);
      if (!value) continue;
      const type = PARAM_TYPE[name] ?? COLLECTION_TYPE[parts[i - 1]] ?? null;
      if (type === 'team' && !teamId) teamId = value;
      if (!entityId && type) { entityType = type; entityId = value; }
    }
  }
  return { teamId, entityType, entityId };
}

export function categoryOf(method: string, route: string | null): ActivityCategory {
  if (route && /(\.csv|\/export)$/.test(route)) return 'export';
  return method === 'GET' || method === 'HEAD' ? 'view' : 'change';
}

/* ------------------------------------------------------------------------------------------
 * Buffer and batch insert
 * ---------------------------------------------------------------------------------------- */

const buffer: ActivityRow[] = [];
const BATCH = 50;
const MAX_BUFFER = 2000;
let timer: ReturnType<typeof setTimeout> | null = null;

export function enqueueActivity(row: ActivityRow): void {
  if (buffer.length >= MAX_BUFFER) buffer.shift(); // never grow without bound if the database is down
  buffer.push(row);
  if (buffer.length >= BATCH) { flushActivity(); return; }
  if (!timer) {
    timer = setTimeout(() => { timer = null; flushActivity(); }, 500);
    (timer as any).unref?.();
  }
}

let inflight: Promise<unknown> = Promise.resolve();
/** Insert the buffered rows (one statement per batch). Never throws. */
export function flushActivity(): Promise<unknown> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!buffer.length) return inflight;
  const rows = buffer.splice(0, buffer.length);
  const run = async () => {
    for (let i = 0; i < rows.length; i += 200) await insertRows(rows.slice(i, i + 200));
  };
  const p = inflight.then(run, run);
  inflight = p.catch(() => undefined);
  inBackground('user_activity', () => p);
  return inflight;
}
onFlush(() => flushActivity());

const cut = (s: string | null, n: number) => (s && s.length > n ? s.slice(0, n) : s);

async function insertRows(rows: ActivityRow[]): Promise<void> {
  if (!rows.length) return;
  const col = <K extends keyof ActivityRow>(k: K) => rows.map((r) => r[k]);
  await query(
    `INSERT INTO user_activity (created_at, company_id, user_id, api_key_id, actor_display, category, method, route, screen,
                                team_id, entity_type, entity_id, status, duration_ms, ip, user_agent, request_id)
     SELECT v.at, COALESCE(v.company_id, k.company_id, u.company_id), u.id, v.api_key_id,
            LEFT(CASE WHEN k.id IS NOT NULL THEN 'API key ' || k.name || ' (' || k.key_prefix || '…)'
                      ELSE COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') || ' <' || u.email || '>', u.email) END, 255),
            v.category, v.method, v.route, v.screen, v.team_id, v.entity_type, v.entity_id, v.status, v.duration_ms, v.ip, v.user_agent, v.request_id
       FROM unnest(?::timestamptz[], ?::text[], ?::text[], ?::text[], ?::text[], ?::text[], ?::text[], ?::text[], ?::text[],
                   ?::text[], ?::text[], ?::text[], ?::int[], ?::int[], ?::text[], ?::text[], ?::text[])
            AS v(at, company_id, user_id, api_key_id, email, category, method, route, screen,
                 team_id, entity_type, entity_id, status, duration_ms, ip, user_agent, request_id)
       LEFT JOIN api_keys k ON k.id = v.api_key_id
       LEFT JOIN LATERAL (
         SELECT x.id, x.company_id, x.first_name, x.last_name, x.email FROM users x
          WHERE (v.user_id IS NOT NULL AND x.id = v.user_id)
             OR (v.user_id IS NULL AND v.email IS NOT NULL AND LOWER(x.email) = LOWER(v.email))
          LIMIT 1
       ) u ON TRUE
      WHERE COALESCE(v.company_id, k.company_id, u.company_id) IS NOT NULL
        AND (v.company_id IS NULL OR u.company_id IS NULL OR v.company_id = u.company_id)`,
    [
      col('at'), col('companyId'), col('userId'), col('apiKeyId'), rows.map((r) => cut(r.email, 255)), col('category'), col('method'),
      rows.map((r) => cut(r.route, 200)), rows.map((r) => cut(r.screen, 60)), col('teamId'), col('entityType'), col('entityId'),
      col('status'), col('durationMs'), rows.map((r) => cut(r.ip, 64)), rows.map((r) => cut(r.userAgent, 200)), col('requestId'),
    ],
  );
}

/* ------------------------------------------------------------------------------------------
 * Request hook (registered once; both servers install requestContext)
 * ---------------------------------------------------------------------------------------- */

/** Sign-in (any kind: password, invitation, SSO): called where the session cookie is set. */
export function noteSignIn(res: express.Response, userId: string): void {
  res.locals.activitySignIn = userId;
}

/** Failed password sign-in: the typed email (only to find the user; never stored as typed). */
export function noteFailedSignIn(res: express.Response, email: unknown): void {
  if (typeof email === 'string' && email.length <= 255) res.locals.activityFailedEmail = email.trim();
}

/** The handler recorded its own rows (screen views): skip the request itself. */
export function skipActivity(res: express.Response): void {
  res.locals.activitySkip = true;
}

export function baseRow(req: express.Request, ctx: RequestContext, status: number | null): Omit<ActivityRow, 'companyId' | 'userId' | 'apiKeyId' | 'email' | 'category'> {
  const ua = req.headers['user-agent'];
  return {
    method: req.method, route: ctx.route, screen: null, teamId: null, entityType: null, entityId: null,
    status, durationMs: Math.max(0, Math.min(2_147_483_647, Date.now() - ctx.startedAt)),
    ip: clientIp(req) || null, userAgent: typeof ua === 'string' ? ua.slice(0, 200) : null, requestId: ctx.requestId,
    at: new Date().toISOString(),
  };
}

export function activityRowFor(req: express.Request, res: express.Response, ctx: RequestContext): ActivityRow | null {
  if (req.method === 'OPTIONS' || res.locals.activitySkip) return null;
  const path = (req.originalUrl || req.url || '').split('?')[0];
  if (!path.startsWith('/api') && !(process.env.NETLIFY && ctx.route)) return null;
  if (isSkipped(ctx.route, path)) return null;
  const base = baseRow(req, ctx, res.statusCode);
  const ent = entityOf(ctx.route, ctx.params);
  const user = (req as any).user as { id: string; companyId: string } | undefined;
  const apiKey = (req as any).apiKey as { id: string; companyId: string } | undefined;
  const common = { ...base, ...ent, route: ctx.route ?? 'unmatched' };
  if (typeof res.locals.activitySignIn === 'string') {
    return { ...common, companyId: null, userId: res.locals.activitySignIn, apiKeyId: null, email: null, category: 'sign_in' };
  }
  if (typeof res.locals.activityFailedEmail === 'string') {
    return { ...common, companyId: null, userId: null, apiKeyId: null, email: res.locals.activityFailedEmail, category: 'sign_in_failed' };
  }
  if (apiKey?.companyId) {
    return { ...common, companyId: apiKey.companyId, userId: null, apiKeyId: apiKey.id, email: null, category: 'ingest' };
  }
  if (user?.id && user.companyId) {
    return { ...common, companyId: user.companyId, userId: user.id, apiKeyId: null, email: null, category: categoryOf(req.method, ctx.route) };
  }
  return null; // not authenticated: nothing to attribute
}

onRequestEnd((req, res, ctx) => {
  const row = activityRowFor(req, res, ctx);
  if (row) enqueueActivity(row);
});

/* ------------------------------------------------------------------------------------------
 * Screen views (POST /api/activity/screen)
 * ---------------------------------------------------------------------------------------- */

export const SCREEN_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const recentScreens = new Map<string, number>();
const SCREEN_DEDUPE_MS = 10_000;

/** Record screen views of the signed-in user (company and user from the session, never the body). */
export async function recordScreenViews(req: express.Request, ctx: RequestContext, events: unknown): Promise<number> {
  const user = (req as any).user as { id: string; companyId: string };
  const list = Array.isArray(events) ? events.slice(0, 10) : [];
  const wanted: Array<{ screen: string; teamId: string | null; kind: 'screen' | 'export' }> = [];
  for (const e of list) {
    const screen = typeof e?.screen === 'string' ? e.screen : '';
    if (!SCREEN_RE.test(screen)) continue;
    wanted.push({ screen, teamId: safeId(e?.teamId), kind: e?.kind === 'export' ? 'export' : 'screen' });
  }
  // A team must belong to the caller's company (otherwise it is left out, the view still counts).
  const teamIds = [...new Set(wanted.map((w) => w.teamId).filter((t): t is string => !!t))];
  const own = teamIds.length
    ? new Set((await query<any[]>('SELECT id FROM teams WHERE company_id = ? AND id = ANY(?::text[])', [user.companyId, teamIds])).map((r: any) => r.id))
    : new Set<string>();
  const now = Date.now();
  if (recentScreens.size > 5000) for (const [k, t] of recentScreens) if (now - t > SCREEN_DEDUPE_MS) recentScreens.delete(k);
  let n = 0;
  for (const w of wanted) {
    const teamId = w.teamId && own.has(w.teamId) ? w.teamId : null;
    const key = `${user.id}|${w.kind}|${w.screen}|${teamId ?? ''}`;
    const last = recentScreens.get(key);
    if (w.kind === 'screen' && last && now - last < SCREEN_DEDUPE_MS) continue;
    recentScreens.set(key, now);
    enqueueActivity({
      ...baseRow(req, ctx, 200), route: null, screen: w.screen, method: null,
      companyId: user.companyId, userId: user.id, apiKeyId: null, email: null, category: w.kind,
      teamId, entityType: teamId ? 'team' : null, entityId: teamId,
    });
    n++;
  }
  return n;
}
