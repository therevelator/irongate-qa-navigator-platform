import express from 'express';
import { query, queryOne, pool, transaction } from '../../src/lib/db';
import { clientIp } from '../lib/requestContext';
import {
  OPERATOR_COOKIE, OPERATOR_SESSION_MINUTES, OPERATOR_TOKEN_HEADER, checkOperatorPassword,
  endOperatorSession, ipAllowed, openOperatorSession, operatorEnabled,
  startOperatorSession, verifyOperatorToken, type OperatorRequest, type SignInResult,
} from '../lib/operator';
import { listAssignments, teamLeadNameSql, teamMemberCountSql, lastSuperAdminGuard, AssignmentError, execOn, revokeGrant, syncUserDisplay } from '../lib/assignments';
import { auditedUserChange } from '../lib/audit';
import { isSecretConfigKey } from '../lib/configResolver';
import { loadIntervals, valueInfo, referenceFor, hasSampleData } from '../lib/staleness';
import { KPI_COLUMN_NAMES } from '../lib/kpiIngest';
import { optedInDeveloperSql } from '../lib/privacy';
import { teamDeveloperSummary } from '../lib/developerAggregates';
import { loadCadences, loadPeriodAggregates, periodResult, periodFor, todayUtc } from '../lib/pulse';
import { sendStatus, sentCounts, responseRate } from '../lib/pulseSend';
import { evaluateCompany } from '../lib/alerts';
import { onboardingStatus } from '../lib/onboarding';
import { reissueInvitation, sendInvitationEmail, statusSql, EMAIL_RE } from '../lib/invitations';
import { JOB_NAMES, recordJobOutcome, withJobRun } from '../lib/opsLog';
import { demoRefreshEnabled, runningOnNetlify, startBackgroundDemoRefresh } from '../lib/demoRefreshJob';
import { DemoDataError, createDemoOrg, getDemoJob, latestDemoJob, parseDemoSize, queuePopulate, startDemoJob } from '../lib/demoGenerate';
import { mailChannel } from '../lib/mailer';
import { endUserSessions, revokeSession, SESSION_LIFETIME_KEY, SESSION_LIFETIME_CHOICES, DEFAULT_SESSION_HOURS } from '../lib/sessions';
import { filtersFromQuery, listUserActivity, userActivityFacets } from '../lib/userActivityQuery';
import { runAsPlatformSupport, PLATFORM_SUPPORT_REQUEST } from '../lib/platformContext';
import { validateName as validateViewName, SavedViewError } from '../lib/savedViews';
import { emailDomainOf, isPublicEmailDomain } from '../../src/lib/emailDomains';
import { passwordProblem } from '../../src/lib/passwordPolicy';
import { validateDisplayName } from '../lib/displayName';
import { toCsv, csvFileName, type CsvColumn } from '../../src/lib/csv';
import adminRoutes from './admin';
import targetsRoutes from './targets';
import alertsRoutes from './alerts';
import settingsRoutes from './settings';
import { ACTIVITY_CSV_COLUMNS } from './activity';

/**
 * Platform operator panel API (server/lib/operator.ts has the security design). IronGate platform
 * support: full read and write access to every company, for the product owner.
 *
 * Platform
 *   GET  /status | POST /login | GET /session | POST /session/end | POST /logout
 *   GET  /overview                  every company (status, users, sessions, sign-ins), jobs, errors, tables
 *   GET  /errors?requestId&before   server errors, platform-wide
 *   GET  /auth-events[.csv]         sign-in events of every company (and of unknown e-mails)
 *   POST /companies                 create a company (department, team, first super admin)
 *   POST /actions/demo-refresh
 *
 * Sample data of one company (server/lib/demoGenerate.ts): POST /companies/:companyId/demo-data
 *   { departments, teamsPerDepartment, membersPerTeam } (202: the people, one login per role level and
 *   the shared password, shown once; a job adds a year of data), POST /companies/:companyId/populate-metrics
 *   (202: a job fills every team that lacks data), GET /companies/:companyId/demo-data/jobs/:jobId|latest
 *
 * One company (reads): GET /companies/:companyId/{summary|organisation|users|settings|data|modules|alerts|
 *   pulse|activity|user-activity[.csv]|errors|auth-events[.csv]|views|sessions|app/:what},
 *   GET /companies/:companyId/users/:userId (detail: sign-ins, sessions, assignments, teams, activity)
 *
 * One company (writes): company settings, suspension, delete; departments, teams, users, role
 *   assignments, invitations, targets, configs, update intervals, alert rules, API keys, saved
 *   views, sessions (see the routes below). Changes that the company app also offers RUN THE
 *   COMPANY APP'S OWN HANDLER (forward()): the same validation and business rules, as a super admin
 *   of that company with no user id. Destructive actions need { confirm: true } (the panel asks
 *   in the page first); deleting a company, team or user also needs the typed name / e-mail.
 *
 * Logging: none. Every operator request runs in the platform support context
 * (server/lib/platformContext.ts): nothing is written to the company's change history (audit_log)
 * or user activity, and operator views and changes are not logged anywhere (the former
 * platform_access_log is no longer written). Operators give no reason.
 *
 * Never returned: password hashes, API key hashes (a new key is shown once, at creation), invitation,
 * reset and pulse link tokens or links, the Slack webhook, secret config values (masked).
 */
const router = express.Router();

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NOT_FOUND = { error: 'Not found' };
const intParam = (v: unknown, def: number, min: number, max: number) => Math.min(Math.max(parseInt(String(v ?? def), 10) || def, min), max);
/** Optional one-line text (reason of a suspension, billing note): trimmed, at most `max` characters, null when empty. */
/** A company / department / team / person name (server/lib/displayName.ts); OpError 400 when it breaks the rules. */
const displayName = (v: unknown, label: string): string => {
  const checked = validateDisplayName(v, label);
  if (!checked.ok) throw new OpError(400, checked.error);
  return checked.value;
};
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.replace(/[\r\n\t]+/g, ' ').trim() ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : null);

/** Feature off (no active platform operator): every route is 404. */
router.use(async (_req, res, next) => ((await operatorEnabled()) ? next() : res.status(404).json(NOT_FOUND)));

const tokenOf = (req: express.Request): string | null => {
  const h = req.headers[OPERATOR_TOKEN_HEADER];
  if (typeof h === 'string' && h) return h;
  const c = (req as any).cookies?.[OPERATOR_COOKIE];
  return typeof c === 'string' && c ? c : null;
};

const cookieOptions = (req: express.Request) => ({
  httpOnly: true,
  secure: req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
});

/** The operator session (cookie irongate_operator or X-Operator-Token) of an active operator, from an allowed network. */
async function sessionOf(req: OperatorRequest): Promise<OperatorRequest['operator'] | null> {
  const raw = tokenOf(req);
  const claims = raw ? verifyOperatorToken(raw) : null;
  if (!claims) return null;
  const open = await openOperatorSession(claims.sid, claims.sub);
  if (!open) return null;
  return { operatorId: claims.sub, email: open.email, name: open.name, sessionId: claims.sid, expiresAt: new Date(open.expires_at).toISOString() };
}

async function requireOperator(req: OperatorRequest, res: express.Response, next: express.NextFunction) {
  try {
    if (!ipAllowed(clientIp(req))) {
      return res.status(403).json({ error: 'Platform support is not available from this network.' });
    }
    const s = await sessionOf(req);
    if (!s) return res.status(401).json({ error: 'Sign in to platform support.', code: 'operator_session_required' });
    req.operator = s;
    // Everything this request runs is platform support: no company audit entry (platformContext.ts).
    runAsPlatformSupport({ operatorId: s.operatorId, email: s.email }, () => next());
  } catch (e) {
    console.error('Operator session check error:', e);
    res.status(500).json({ error: 'Failed to check the platform support session' });
  }
}

const op = [requireOperator] as const;

/* ------------------------------------------------------------------------------------------
 * Sign-in
 * ---------------------------------------------------------------------------------------- */

router.get('/status', async (req: OperatorRequest, res) => {
  try {
    if (!ipAllowed(clientIp(req))) return res.json({ signedIn: false, allowed: false });
    const s = await sessionOf(req);
    res.json(s ? { signedIn: true, allowed: true, email: s.email, name: s.name, expiresAt: s.expiresAt } : { signedIn: false, allowed: true });
  } catch {
    res.json({ signedIn: false, allowed: true });
  }
});

// Operator sign-in is never locked out or rate limited (owner's rule); PLATFORM_OPERATOR_ALLOWED_IPS
// can restrict where it is used from.
router.post('/login', async (req: OperatorRequest, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Enter your e-mail address and password.' });
    }
    if (!ipAllowed(clientIp(req))) {
      return res.status(403).json({ error: 'Platform support is not available from this network.' });
    }
    const r = await checkOperatorPassword(email, password);
    if (r.ok === false) {
      console.warn('[operator] failed sign-in');
      return res.status(401).json({ error: 'Wrong e-mail address or password.' });
    }
    const okr = r as Extract<SignInResult, { ok: true }>;
    const s = await startOperatorSession(okr.operator.id, clientIp(req));
    res.cookie(OPERATOR_COOKIE, s.token, { ...cookieOptions(req), maxAge: OPERATOR_SESSION_MINUTES * 60_000 });
    res.json({ token: s.token, expiresAt: s.expiresAt, email: okr.operator.email, name: okr.operator.name });
  } catch (e) {
    console.error('Operator sign-in error:', e);
    res.status(500).json({ error: 'Failed to sign in to platform support' });
  }
});

router.get('/session', ...op, (req: OperatorRequest, res) => {
  res.json({ email: req.operator!.email, name: req.operator!.name, expiresAt: req.operator!.expiresAt });
});

const signOut = async (req: OperatorRequest, res: express.Response) => {
  try {
    await endOperatorSession(req.operator!.sessionId);
    res.clearCookie(OPERATOR_COOKIE, cookieOptions(req));
    res.json({ ended: true });
  } catch (e) {
    console.error('Operator sign-out error:', e);
    res.status(500).json({ error: 'Failed to end the session' });
  }
};
router.post('/session/end', ...op, signOut);
router.post('/logout', ...op, signOut);

/* ------------------------------------------------------------------------------------------
 * Sessions: validity in SQL (user_sessions s, users u, companies c)
 * ---------------------------------------------------------------------------------------- */

/** The company's current sign-in lifetime in hours (allowed values only, else the default). */
const lifetimeHoursSql = (companyExpr: string) => `COALESCE((SELECT CASE WHEN cf.config_value IN (${SESSION_LIFETIME_CHOICES.map((h) => `'${h}'`).join(', ')})
    THEN cf.config_value::int END FROM configs cf WHERE cf.company_id = ${companyExpr} AND cf.config_key = '${SESSION_LIFETIME_KEY}'
     AND cf.department_id IS NULL AND cf.team_id IS NULL LIMIT 1), ${DEFAULT_SESSION_HOURS})`;

/**
 * Session status as the per-request check decides it: revoked (row revoked), ended (signed out
 * everywhere before it, user deactivated or company suspended), expired (token expiry or the
 * company's current lifetime), valid.
 */
const statusSqlOf = (s: string, u: string, c: string) => `CASE
    WHEN ${s}.revoked_at IS NOT NULL THEN 'revoked'
    WHEN ${s}.expires_at <= now() OR ${s}.issued_at <= now() - make_interval(hours => ${lifetimeHoursSql(`${s}.company_id`)}) THEN 'expired'
    WHEN NOT ${u}.is_active OR ${c}.status = 'suspended' OR (${u}.sessions_valid_after IS NOT NULL AND ${s}.issued_at < date_trunc('second', ${u}.sessions_valid_after)) THEN 'ended'
    ELSE 'valid' END`;
const sessionFromOf = (s: string, u: string, c: string) => `FROM user_sessions ${s} JOIN users ${u} ON ${u}.id = ${s}.user_id JOIN companies ${c} ON ${c}.id = ${s}.company_id`;
const sessionStatusSql = statusSqlOf('s', 'u', 'c');
const SESSION_FROM = sessionFromOf('s', 'u', 'c');
/** Count of valid sessions as a correlated subquery (own aliases, so it never shadows the outer query's). */
const validSessionsSql = (where: string) => `(SELECT COUNT(*)::int ${sessionFromOf('vs', 'vu', 'vc')} WHERE ${where} AND ${statusSqlOf('vs', 'vu', 'vc')} = 'valid')`;
const SESSION_COLUMNS = `s.id, s.user_id, s.method, s.issued_at, s.expires_at, s.persistent, s.last_seen_at, s.ip, s.country, s.city, s.last_ip, s.last_country,
  s.user_agent, s.browser, s.os, s.device, s.revoked_at, s.revoked_by, s.revoke_reason, ${sessionStatusSql} AS status`;

/* ------------------------------------------------------------------------------------------
 * Platform-wide
 * ---------------------------------------------------------------------------------------- */

const MAIN_TABLES = [
  'companies', 'users', 'teams', 'departments', 'role_assignments', 'kpi_snapshots', 'metric_values', 'ingestion_log', 'audit_log',
  'alerts', 'notifications', 'notification_deliveries', 'pulse_responses', 'user_activity', 'auth_events', 'user_sessions', 'server_errors', 'job_runs',
];
/** Tables with fewer rows than this (planner estimate) are counted exactly. */
const EXACT_COUNT_BELOW = 200_000;

async function staleShare(companyId: string): Promise<{ stale: number; total: number }> {
  const intervals = await loadIntervals(companyId);
  const rows = await query<any[]>(
    `SELECT DISTINCT ON (s.team_id) s.* FROM kpi_snapshots s JOIN teams t ON t.id = s.team_id
      WHERE t.company_id = ? AND t.is_active = TRUE ORDER BY s.team_id, s.snapshot_date DESC`,
    [companyId],
  );
  let stale = 0, total = 0;
  const now = Date.now();
  for (const r of rows) {
    for (const v of Object.values(valueInfo(r, KPI_COLUMN_NAMES, intervals, now))) { total++; if (v.stale) stale++; }
  }
  return { stale, total };
}

/**
 * Row counts of the main tables: exact count(*) for tables the planner estimates below
 * EXACT_COUNT_BELOW rows (also right after a TRUNCATE and reload, when the estimate is 0 or -1),
 * the live-tuple statistic otherwise (marked approximate).
 */
async function tableCounts() {
  const stats = await query<any[]>(
    `SELECT c.relname AS table, c.reltuples::bigint AS est, COALESCE(st.n_live_tup, 0)::bigint AS live, pg_total_relation_size(c.oid)::bigint AS bytes
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace LEFT JOIN pg_stat_user_tables st ON st.relid = c.oid
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(?::text[]) ORDER BY c.relname`,
    [MAIN_TABLES],
  );
  const out = [];
  for (const r of stats) {
    const est = Math.max(Number(r.est), Number(r.live));
    if (est < EXACT_COUNT_BELOW && MAIN_TABLES.includes(r.table)) {
      const n = (await queryOne<any>(`SELECT COUNT(*)::bigint AS n FROM public.${r.table}`))?.n ?? 0;
      out.push({ table: r.table, rows: Number(n), exact: true, bytes: Number(r.bytes) });
    } else {
      out.push({ table: r.table, rows: est, exact: false, bytes: Number(r.bytes) });
    }
  }
  return out;
}

router.get('/overview', ...op, async (req: OperatorRequest, res) => {
  try {
    const limit = intParam(req.query.limit, 100, 1, 500);
    const offset = intParam(req.query.offset, 0, 0, 100_000);
    const companies = await query<any[]>(
      `SELECT c.id, c.name, c.domain, c.created_at, c.is_active, c.status, c.suspended_at, c.suspended_reason, c.suspended_until, c.billing_note,
              (SELECT COUNT(*)::int FROM users u WHERE u.company_id = c.id AND u.is_active) AS users,
              (SELECT COUNT(*)::int FROM teams t WHERE t.company_id = c.id AND t.is_active) AS teams,
              GREATEST((SELECT MAX(mv.received_at) FROM metric_values mv WHERE mv.company_id = c.id),
                       (SELECT MAX(il.received_at) FROM ingestion_log il WHERE il.company_id = c.id)) AS last_data_at,
              (SELECT COUNT(*)::int FROM alerts a WHERE a.company_id = c.id AND a.resolved_at IS NULL) AS open_alerts,
              (SELECT COUNT(*)::int FROM server_errors e WHERE e.company_id = c.id AND e.created_at > now() - interval '24 hours') AS errors_24h,
              GREATEST((SELECT MAX(ua.created_at) FROM user_activity ua WHERE ua.company_id = c.id),
                       (SELECT MAX(u.last_login) FROM users u WHERE u.company_id = c.id)) AS last_activity_at,
              ${validSessionsSql('vs.company_id = c.id')} AS active_sessions,
              (SELECT COUNT(*)::int FROM auth_events ae WHERE ae.company_id = c.id AND ae.outcome = 'success' AND ae.created_at > now() - interval '7 days') AS sign_ins_7d,
              (SELECT COUNT(*)::int FROM auth_events ae WHERE ae.company_id = c.id AND ae.outcome = 'failure' AND ae.created_at > now() - interval '7 days') AS failed_7d,
              (SELECT COALESCE(array_agg(DISTINCT ae.country ORDER BY ae.country), '{}') FROM auth_events ae
                WHERE ae.company_id = c.id AND ae.country IS NOT NULL AND ae.created_at > now() - interval '30 days') AS countries
         FROM companies c ORDER BY c.name, c.id LIMIT ${limit} OFFSET ${offset}`,
    );
    const total = (await queryOne<any>('SELECT COUNT(*)::int AS n FROM companies'))?.n ?? 0;
    const { DEMO_COMPANY_ID } = await import('../seeds/demoData');
    const { teamsWithSampleData } = await import('../seeds/demoSeed');
    const sample = await teamsWithSampleData(pool);
    for (const c of companies) {
      const s = await staleShare(c.id);
      c.stale_pct = s.total ? Math.round((s.stale / s.total) * 100) : null;
      c.metric_values_current = s.total;
      c.demo = c.id === DEMO_COMPANY_ID;
      c.sample_teams = sample.get(c.id)?.length ?? 0;
    }
    const jobs = await query<any[]>(
      `SELECT DISTINCT ON (job) job, started_at, finished_at, ok, summary FROM job_runs WHERE job = ANY(?::text[]) ORDER BY job, started_at DESC`,
      [[...JOB_NAMES]],
    );
    const lastOk = await query<any[]>(
      `SELECT job, MAX(started_at) AS last_ok_at FROM job_runs WHERE ok = TRUE AND job = ANY(?::text[]) GROUP BY job`, [[...JOB_NAMES]],
    );
    const jobRunsTotal = (await queryOne<any>('SELECT COUNT(*)::int AS n FROM job_runs'))?.n ?? 0;
    const errors24h = (await queryOne<any>(`SELECT COUNT(*)::int AS n FROM server_errors WHERE created_at > now() - interval '24 hours'`))?.n ?? 0;
    const dbSize = (await queryOne<any>('SELECT pg_database_size(current_database())::bigint AS bytes'))?.bytes ?? null;
    const signIns = await queryOne<any>(
      `SELECT COUNT(*) FILTER (WHERE outcome = 'success')::int AS ok, COUNT(*) FILTER (WHERE outcome = 'failure')::int AS failed
         FROM auth_events WHERE created_at > now() - interval '7 days'`,
    );
    const activeSessions = (await queryOne<any>(`SELECT COUNT(*)::int AS n ${SESSION_FROM} WHERE ${sessionStatusSql} = 'valid'`))?.n ?? 0;
    res.json({
      companies, total, limit, offset,
      platform: {
        jobs: JOB_NAMES.map((j) => ({ job: j, last: jobs.find((r: any) => r.job === j) ?? null, lastOkAt: lastOk.find((r: any) => r.job === j)?.last_ok_at ?? null })),
        jobRunsTotal, errors24h, dbSizeBytes: Number(dbSize), tables: await tableCounts(),
        signIns7d: signIns?.ok ?? 0, failedSignIns7d: signIns?.failed ?? 0, activeSessions,
        suspended: companies.filter((c: any) => c.status === 'suspended').length,
      },
    });
  } catch (e) {
    console.error('Operator overview error:', e);
    res.status(500).json({ error: 'Failed to load the overview' });
  }
});

const ERROR_COLUMNS = `e.id, e.created_at, e.request_id, e.method, e.route, e.status, e.error_name, e.error_message, e.stack,
  e.company_id, c.name AS company_name, e.user_id, e.function_name`;

async function listErrors(where: string, params: any[], before: unknown, limit: number) {
  let w = where;
  if (typeof before === 'string' && ID.test(before)) { w += ' AND (e.created_at, e.id) < (SELECT created_at, id FROM server_errors WHERE id = ?)'; params.push(before); }
  const rows = await query<any[]>(
    `SELECT ${ERROR_COLUMNS} FROM server_errors e LEFT JOIN companies c ON c.id = e.company_id WHERE ${w} ORDER BY e.created_at DESC, e.id DESC LIMIT ${limit + 1}`,
    params,
  );
  const page = rows.slice(0, limit);
  return { errors: page, nextBefore: rows.length > limit ? page[page.length - 1].id : null };
}

const requestIdOf = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9._:-]{4,64}$/.test(v.trim()) ? v.trim() : null);

router.get('/errors', ...op, async (req: OperatorRequest, res) => {
  try {
    const limit = intParam(req.query.limit, 50, 1, 200);
    const params: any[] = [];
    let where = 'TRUE';
    const rid = requestIdOf(req.query.requestId);
    if (req.query.requestId !== undefined && !rid) return res.status(400).json({ error: 'Enter a valid request id' });
    if (rid) { where += ' AND e.request_id = ?'; params.push(rid); }
    if (typeof req.query.job === 'string' && ID.test(req.query.job)) { where += ' AND e.function_name = ?'; params.push(req.query.job); }
    const out = await listErrors(where, params, req.query.before, limit);
    // A request id may also be in the user activity of a company (what the request was).
    const activity = rid
      ? await query<any[]>(`SELECT a.company_id, c.name AS company_name, a.created_at, a.category, a.method, a.route, a.status, a.actor_display
                              FROM user_activity a JOIN companies c ON c.id = a.company_id WHERE a.request_id = ? LIMIT 5`, [rid])
      : [];
    res.json({ ...out, activity });
  } catch (e) {
    console.error('Operator errors error:', e);
    res.status(500).json({ error: 'Failed to load the errors' });
  }
});

/* ------------------------------------------------------------------------------------------
 * Sign-in events (auth_events): one company, or platform-wide
 * ---------------------------------------------------------------------------------------- */

interface AuthEventFilters { companyId: string | null; userId?: string | null; outcome?: string | null; method?: string | null; ip?: string | null; country?: string | null; from?: string | null; to?: string | null; requestId?: string | null; before?: string | null }

function authFiltersOf(q: any, companyId: string | null): AuthEventFilters {
  const s = (v: unknown, re: RegExp) => (typeof v === 'string' && re.test(v.trim()) ? v.trim() : null);
  return {
    companyId, userId: s(q.userId, ID), outcome: s(q.outcome, /^(success|failure)$/), method: s(q.method, /^[a-z_]{2,32}$/),
    ip: s(q.ip, /^[0-9A-Fa-f:.]{2,64}$/), country: s(q.country, /^[\p{L} .'-]{2,80}$/u), from: s(q.from, DAY), to: s(q.to, DAY),
    requestId: requestIdOf(q.requestId), before: s(q.before, ID),
  };
}

async function listAuthEvents(f: AuthEventFilters, limit: number) {
  const params: any[] = [];
  let where = 'TRUE';
  if (f.companyId) { where += ' AND e.company_id = ?'; params.push(f.companyId); }
  if (f.userId) { where += ' AND e.user_id = ?'; params.push(f.userId); }
  if (f.outcome) { where += ' AND e.outcome = ?'; params.push(f.outcome); }
  if (f.method) { where += ' AND e.method = ?'; params.push(f.method); }
  if (f.ip) { where += ' AND e.ip = ?'; params.push(f.ip); }
  if (f.country) { where += ' AND (e.country = ? OR e.country_code = ?)'; params.push(f.country, f.country); }
  if (f.from) { where += ' AND e.created_at >= ?::date'; params.push(f.from); }
  if (f.to) { where += " AND e.created_at < ?::date + interval '1 day'"; params.push(f.to); }
  if (f.requestId) { where += ' AND e.request_id = ?'; params.push(f.requestId); }
  if (f.before) { where += ' AND (e.created_at, e.id) < (SELECT created_at, id FROM auth_events WHERE id = ?)'; params.push(f.before); }
  const rows = await query<any[]>(
    `SELECT e.id, e.created_at, e.company_id, co.name AS company_name, e.user_id, ${fullNameSql('u')} AS user_name, u.email AS user_email,
            (e.email_hash IS NOT NULL) AS unknown_email, e.outcome, e.method, e.failure_reason, e.session_id, e.ip, e.country, e.country_code,
            e.region, e.city, e.browser, e.os, e.device, e.user_agent, e.request_id
       FROM auth_events e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN companies co ON co.id = e.company_id
      WHERE ${where} ORDER BY e.created_at DESC, e.id DESC LIMIT ${limit + 1}`,
    params,
  );
  const page = rows.slice(0, limit);
  return { entries: page, nextBefore: rows.length > limit ? page[page.length - 1].id : null };
}

type AuthRow = Awaited<ReturnType<typeof listAuthEvents>>['entries'][number];
const AUTH_CSV_COLUMNS: CsvColumn<AuthRow>[] = [
  { header: 'Time (UTC)', value: (r) => new Date(r.created_at).toISOString() },
  { header: 'Company', value: (r) => r.company_name },
  { header: 'User', value: (r) => r.user_name ?? r.user_email ?? (r.unknown_email ? 'Unknown e-mail' : '') },
  { header: 'E-mail', value: (r) => r.user_email },
  { header: 'Outcome', value: (r) => r.outcome },
  { header: 'Method', value: (r) => r.method },
  { header: 'Failure reason', value: (r) => r.failure_reason },
  { header: 'IP', value: (r) => r.ip },
  { header: 'Country', value: (r) => r.country },
  { header: 'Region', value: (r) => r.region },
  { header: 'City', value: (r) => r.city },
  { header: 'Browser', value: (r) => r.browser },
  { header: 'OS', value: (r) => r.os },
  { header: 'Device', value: (r) => r.device },
  { header: 'User agent', value: (r) => r.user_agent },
  { header: 'Session', value: (r) => r.session_id },
  { header: 'Request id', value: (r) => r.request_id },
];

function sendCsv(res: express.Response, what: string, body: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${csvFileName(what)}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send('﻿' + body);
}

router.get('/auth-events', ...op, async (req: OperatorRequest, res) => {
  try {
    res.json(await listAuthEvents(authFiltersOf(req.query, null), intParam(req.query.limit, 50, 1, 200)));
  } catch (e) {
    console.error('Operator sign-in events error:', e);
    res.status(500).json({ error: 'Failed to load the sign-in events' });
  }
});

router.get('/auth-events.csv', ...op, async (req: OperatorRequest, res) => {
  try {
    const { entries } = await listAuthEvents({ ...authFiltersOf(req.query, null), before: null }, 10_000);
    sendCsv(res, 'sign-in-events', toCsv(AUTH_CSV_COLUMNS, entries));
  } catch (e) {
    console.error('Operator sign-in events CSV error:', e);
    res.status(500).json({ error: 'Failed to export the sign-in events' });
  }
});

/* ------------------------------------------------------------------------------------------
 * One company (views)
 * ---------------------------------------------------------------------------------------- */

const COMPANY_COLUMNS = `id, name, domain, created_at, is_active, settings, email_domain_public, status, suspended_reason, suspended_at,
  suspended_by, (SELECT o.name FROM platform_operators o WHERE o.id = companies.suspended_by) AS suspended_by_name, suspended_until, billing_note`;

async function loadCompany(req: OperatorRequest, res: express.Response): Promise<any | null> {
  const id = req.params.companyId;
  if (typeof id !== 'string' || !ID.test(id)) { res.status(400).json({ error: 'Invalid company id' }); return null; }
  const c = await queryOne<any>(`SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = ?`, [id]);
  if (!c) { res.status(404).json({ error: 'Company not found' }); return null; }
  return c;
}

/** A company view: a valid company (nothing about the view is logged). */
function view(_section: string, handler: (req: OperatorRequest, res: express.Response, company: any) => Promise<void>) {
  return async (req: OperatorRequest, res: express.Response) => {
    try {
      const company = await loadCompany(req, res);
      if (!company) return;
      await handler(req, res, company);
    } catch (e) {
      console.error(`Operator ${_section} error:`, e);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to load this section' });
    }
  };
}

const fullNameSql = (a: string) => `NULLIF(TRIM(COALESCE(${a}.first_name, '') || ' ' || COALESCE(${a}.last_name, '')), '')`;

router.get('/companies/:companyId/summary', ...op, view('overview', async (_req, res, company) => {
  const [counts] = await query<any[]>(
    `SELECT (SELECT COUNT(*)::int FROM users WHERE company_id = ?) AS users,
            (SELECT COUNT(*)::int FROM users WHERE company_id = ? AND is_active) AS active_users,
            (SELECT COUNT(*)::int FROM departments WHERE company_id = ?) AS departments,
            (SELECT COUNT(*)::int FROM teams WHERE company_id = ?) AS teams,
            (SELECT COUNT(*)::int FROM alerts WHERE company_id = ? AND resolved_at IS NULL) AS open_alerts,
            (SELECT COUNT(*)::int FROM server_errors WHERE company_id = ? AND created_at > now() - interval '24 hours') AS errors_24h,
            (SELECT COUNT(*)::int ${SESSION_FROM} WHERE s.company_id = ? AND ${sessionStatusSql} = 'valid') AS active_sessions,
            (SELECT COUNT(*)::int FROM auth_events WHERE company_id = ? AND outcome = 'success' AND created_at > now() - interval '7 days') AS sign_ins_7d,
            (SELECT COUNT(*)::int FROM auth_events WHERE company_id = ? AND outcome = 'failure' AND created_at > now() - interval '7 days') AS failed_7d`,
    Array(9).fill(company.id),
  );
  const onboarding = await onboardingStatus(company.id).catch(() => null);
  const onboardingRow = await queryOne<any>('SELECT dismissed_at, completed_at, updated_at FROM onboarding_state WHERE company_id = ?', [company.id]);
  const lifetime = await queryOne<any>(`SELECT ${lifetimeHoursSql('?')} AS h`, [company.id]);
  res.json({
    company: { ...company, hideSampleDataNotice: !!company.settings?.hideSampleDataNotice, sessionLifetimeHours: Number(lifetime?.h ?? DEFAULT_SESSION_HOURS) },
    counts, onboarding, onboardingState: onboardingRow ?? null, sessionLifetimeChoices: SESSION_LIFETIME_CHOICES,
  });
}));

router.get('/companies/:companyId/organisation', ...op, view('organisation', async (_req, res, company) => {
  const departments = await query<any[]>(
    'SELECT id, name, description, is_active, created_at FROM departments WHERE company_id = ? ORDER BY name LIMIT 1000', [company.id],
  );
  const teams = await query<any[]>(
    `SELECT t.id, t.name, t.description, t.department_id, t.is_active, t.platform, t.created_at, t.ai_enabled,
            ${teamLeadNameSql('t')} AS lead_name, ${teamMemberCountSql('t')} AS member_count
       FROM teams t WHERE t.company_id = ? ORDER BY t.name LIMIT 2000`,
    [company.id],
  );
  const assignments = await listAssignments(company.id, null);
  const users = await query<any[]>(
    `SELECT u.id, ${fullNameSql('u')} AS name, u.email, u.is_active FROM users u WHERE u.company_id = ? ORDER BY 2 NULLS LAST LIMIT 5000`, [company.id],
  );
  res.json({ departments, teams, assignments, users });
}));

router.get('/companies/:companyId/users', ...op, view('users', async (_req, res, company) => {
  const users = await query<any[]>(
    `SELECT u.id, ${fullNameSql('u')} AS name, u.email, u.job_title, u.role, u.is_active, u.last_login, u.created_at,
            u.failed_login_attempts, u.locked_until, (u.locked_until IS NOT NULL AND u.locked_until > now()) AS locked,
            u.developer_insights_enabled, u.email_verified, u.email_verified_at, u.first_name, u.last_name, u.phone, u.timezone,
            u.department_id, d.name AS department_name, u.primary_team_id, t.name AS primary_team_name, u.updated_at, u.sessions_valid_after,
            (u.password_hash IS NOT NULL) AS password_set,
            EXISTS (SELECT 1 FROM user_identities ui WHERE ui.user_id = u.id) AS sso_linked,
            ls.created_at AS last_sign_in_at, ls.ip AS last_sign_in_ip, ls.country AS last_sign_in_country, ls.city AS last_sign_in_city,
            ls.browser AS last_sign_in_browser, ls.os AS last_sign_in_os, ls.device AS last_sign_in_device, ls.method AS last_sign_in_method,
            (SELECT COUNT(*)::int FROM auth_events f WHERE f.user_id = u.id AND f.outcome = 'failure' AND f.created_at > now() - interval '7 days') AS failed_7d,
            ${validSessionsSql('vs.user_id = u.id')} AS active_sessions,
            (SELECT MAX(s.last_seen_at) FROM user_sessions s WHERE s.user_id = u.id) AS last_seen_at
       FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN teams t ON t.id = u.primary_team_id
       LEFT JOIN LATERAL (
         SELECT e.created_at, e.ip, e.country, e.city, e.browser, e.os, e.device, e.method FROM auth_events e
          WHERE e.user_id = u.id AND e.outcome = 'success' AND e.method <> 'reset' ORDER BY e.created_at DESC LIMIT 1
       ) ls ON TRUE
      WHERE u.company_id = ? ORDER BY 2 NULLS LAST, u.email LIMIT 5000`,
    [company.id],
  );
  const assignments = await listAssignments(company.id, null);
  const invitations = await query<any[]>(
    `SELECT i.id, i.email, i.role, i.scope_type, i.scope_id, i.created_at, i.expires_at, i.last_sent_at, i.send_count,
            i.accepted_at, i.revoked_at, ${statusSql('i')} AS status, ${fullNameSql('ib')} AS invited_by_name, ib.email AS invited_by_email
       FROM invitations i LEFT JOIN users ib ON ib.id = i.invited_by WHERE i.company_id = ? ORDER BY i.created_at DESC LIMIT 500`,
    [company.id],
  );
  const apiKeys = await query<any[]>(
    'SELECT id, name, key_prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE company_id = ? ORDER BY created_at DESC LIMIT 200', [company.id],
  );
  res.json({ users, assignments, invitations, apiKeys });
}));

router.get('/companies/:companyId/settings', ...op, view('settings', async (_req, res, company) => {
  const configs = await query<any[]>(
    `SELECT c.id, c.config_key, c.config_value, c.department_id, c.team_id, c.updated_at, d.name AS department_name, t.name AS team_name
       FROM configs c LEFT JOIN departments d ON d.id = c.department_id LEFT JOIN teams t ON t.id = c.team_id
      WHERE c.company_id = ? ORDER BY c.config_key, c.department_id NULLS FIRST, c.team_id NULLS FIRST LIMIT 5000`,
    [company.id],
  );
  const masked = configs.map((c: any) => ({
    ...c, scope: c.team_id ? 'team' : c.department_id ? 'department' : 'company',
    // Credentials (API tokens, passwords of integrations) are never returned: only whether one is set.
    config_value: isSecretConfigKey(c.config_key) ? (c.config_value ? 'set' : 'not set') : c.config_value, secret: isSecretConfigKey(c.config_key),
  }));
  const targets = await query<any[]>(
    `SELECT id, scope_type, scope_id, metric_key, good, warning, valid_from, valid_to, changed_by, created_at
       FROM target_history WHERE company_id = ? ORDER BY metric_key, scope_type, valid_from DESC LIMIT 5000`,
    [company.id],
  );
  const intervals = await query<any[]>('SELECT metric_key, interval_value, interval_unit FROM metric_update_intervals WHERE company_id = ? ORDER BY metric_key', [company.id]);
  const savedViews = await query<any[]>(
    `SELECT v.id, v.kind, v.module, v.name, v.shared, v.created_at, v.updated_at, ${fullNameSql('u')} AS owner_name
       FROM saved_views v LEFT JOIN users u ON u.id = v.owner_id WHERE v.company_id = ? ORDER BY v.updated_at DESC LIMIT 500`,
    [company.id],
  );
  const notify = await queryOne<any>(
    'SELECT slack_enabled, slack_min_severity, slack_digest, slack_webhook_hint, (slack_webhook_enc IS NOT NULL) AS slack_configured, updated_at FROM company_notification_settings WHERE company_id = ?',
    [company.id],
  );
  // E-mail channel of this server (Resend / SMTP / log): which one, never its settings.
  res.json({ configs: masked, targets, intervals, savedViews, notificationSettings: notify ?? null, emailChannel: mailChannel() });
}));

router.get('/companies/:companyId/data', ...op, view('data', async (req, res, company) => {
  const teams = await query<any[]>('SELECT id, name, department_id, is_active FROM teams WHERE company_id = ? ORDER BY name LIMIT 2000', [company.id]);
  const teamId = typeof req.query.teamId === 'string' && teams.some((t: any) => t.id === req.query.teamId) ? req.query.teamId : teams[0]?.id ?? null;
  const to = typeof req.query.to === 'string' && DAY.test(req.query.to) ? req.query.to : todayUtc();
  const from = typeof req.query.from === 'string' && DAY.test(req.query.from) ? req.query.from : new Date(Date.parse(`${to}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  const limit = intParam(req.query.limit, 200, 1, 1000);
  const ingestion = await query<any[]>(
    `SELECT id, received_at, channel, source, status, http_status, item_count, value_count, team_ids, errors, api_key_id, actor_id
       FROM ingestion_log WHERE company_id = ? AND received_at >= ?::date AND received_at < ?::date + interval '1 day'
      ORDER BY received_at DESC LIMIT ${limit}`,
    [company.id, from, to],
  );
  if (!teamId) return void res.json({ teams, teamId: null, from, to, snapshots: [], metricValues: [], ingestion, developers: null });
  const intervals = await loadIntervals(company.id);
  const snaps = await query<any[]>(
    `SELECT * FROM kpi_snapshots WHERE team_id = ? AND snapshot_date BETWEEN ?::date AND ?::date ORDER BY snapshot_date DESC LIMIT ${limit}`,
    [teamId, from, to],
  );
  const now = Date.now();
  const snapshots = snaps.map((s: any) => {
    const info = valueInfo(s, KPI_COLUMN_NAMES, intervals, referenceFor(s.snapshot_date, now));
    return {
      snapshot_date: s.snapshot_date, qa_score: s.qa_score, status: s.status, manually_edited: s.manually_edited, sample: hasSampleData(s.field_sources),
      values: Object.fromEntries(Object.entries(info).map(([k, v]) => [k, { value: s[k], ...v }])),
      staleCount: Object.values(info).filter((v) => v.stale).length, valueCount: Object.keys(info).length,
    };
  });
  const metricValues = await query<any[]>(
    `SELECT id, metric_key, value, recorded_at, received_at, source, source_ref, superseded_by, ingestion_id, actor_id
       FROM metric_values WHERE team_id = ? AND company_id = ? AND recorded_at >= ?::date AND recorded_at < ?::date + interval '1 day'
      ORDER BY recorded_at DESC, metric_key LIMIT ${limit}`,
    [teamId, company.id, from, to],
  );
  // Developer metrics: the team figures and every person's row (support access the company agreed
  // to; opted_in says whether the person shares them inside the company).
  const developers = {
    summary: await teamDeveloperSummary(company.id, teamId),
    rows: await query<any[]>(
      `SELECT dm.developer_id, ${fullNameSql('u')} AS name, u.email, (${optedInDeveloperSql('u')}) AS opted_in, dm.pr_merge_time_avg, dm.code_review_time_avg,
              dm.focus_time_hours, dm.meeting_time_hours, dm.context_switches_per_day, dm.happiness_score, dm.updated_at
         FROM developer_metrics dm JOIN users u ON u.id = dm.developer_id AND u.company_id = ?
        WHERE dm.team_id = ? ORDER BY 2 LIMIT 500`,
      [company.id, teamId],
    ),
  };
  res.json({ teams, teamId, from, to, snapshots, metricValues, ingestion, developers });
}));

router.get('/companies/:companyId/alerts', ...op, view('alerts', async (_req, res, company) => {
  const rules = await query<any[]>('SELECT id, scope_type, scope_id, rule, enabled, params, updated_at FROM alert_rules WHERE company_id = ? ORDER BY rule LIMIT 1000', [company.id]);
  const alerts = await query<any[]>(
    `SELECT a.id, a.team_id, t.name AS team_name, a.rule, a.metric_key, a.severity, a.message, a.created_at, a.last_seen_at, a.acknowledged_at, a.resolved_at
       FROM alerts a LEFT JOIN teams t ON t.id = a.team_id WHERE a.company_id = ? ORDER BY a.resolved_at IS NULL DESC, a.created_at DESC LIMIT 300`,
    [company.id],
  );
  const notifications = await query<any[]>(
    `SELECT n.id, n.kind, n.severity, n.title, n.created_at, n.read_at, ${fullNameSql('u')} AS user_name
       FROM notifications n LEFT JOIN users u ON u.id = n.user_id WHERE n.company_id = ? ORDER BY n.created_at DESC LIMIT 200`,
    [company.id],
  );
  const deliveries = await query<any[]>(
    `SELECT id, channel, kind, status, error, attempts, created_at, last_attempt_at, sent_at,
            CASE WHEN channel = 'email' THEN recipient ELSE NULL END AS recipient
       FROM notification_deliveries WHERE company_id = ? ORDER BY created_at DESC LIMIT 200`,
    [company.id],
  );
  const actions = await query<any[]>(
    `SELECT a.id, a.team_id, t.name AS team_name, a.title, a.status, a.origin, a.metric_key, a.due_date, a.created_at, a.completed_at,
            a.completion_outcome, a.d14_outcome, a.d30_outcome, ${fullNameSql('u')} AS owner_name
       FROM team_actions a LEFT JOIN teams t ON t.id = a.team_id LEFT JOIN users u ON u.id = a.owner_id
      WHERE a.company_id = ? ORDER BY a.created_at DESC LIMIT 300`,
    [company.id],
  );
  res.json({ rules, alerts, notifications, deliveries, actions });
}));

router.get('/companies/:companyId/pulse', ...op, view('pulse', async (_req, res, company) => {
  const teams = await query<any[]>('SELECT id, name, department_id FROM teams WHERE company_id = ? AND is_active = TRUE ORDER BY name LIMIT 500', [company.id]);
  const today = todayUtc();
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  const cadences = await loadCadences(teams.map((t: any) => t.id));
  const aggs = await loadPeriodAggregates(teams.map((t: any) => t.id), since, today);
  const out = [];
  for (const t of teams) {
    const status = await sendStatus(t, today);
    const mine = aggs.filter((a) => a.team_id === t.id);
    const sent = await sentCounts(t.id, mine.map((a) => a.start));
    const periods = mine.map((a) => {
      const r = periodResult(a);
      return { start: r.start, end: r.end, suppressed: r.suppressed, responses: r.responses, score: r.score, responseRate: responseRate(r.responses, sent.get(a.start)) };
    });
    // Support access: every single answer with its comment, and who answered in each period. The
    // database never links an answer to the person (anonymous by design), so that link cannot be shown.
    const answers = await query<any[]>(
      `SELECT period_start, period_end, q_workload, q_focus, q_support, q_energy, q_outlook, comment
         FROM pulse_responses WHERE team_id = ? AND period_start >= ?::date ORDER BY period_start DESC LIMIT 1000`,
      [t.id, since],
    );
    const participants = await query<any[]>(
      `SELECT p.period_start, ${fullNameSql('u')} AS name, u.email FROM pulse_participation p JOIN users u ON u.id = p.user_id
        WHERE p.team_id = ? AND p.period_start >= ?::date ORDER BY p.period_start DESC, 2 LIMIT 2000`,
      [t.id, since],
    );
    out.push({
      team: t, cadence: periodFor(cadences.get(t.id) ?? [], today), cadences: cadences.get(t.id) ?? [],
      autoSend: status.autoSend, members: status.members, sentThisPeriod: status.sent, lastSentAt: status.lastSentAt,
      emailConfigured: status.emailConfigured, sendLog: status.log, periods, answers, participants,
    });
  }
  res.json({ teams: out });
}));

// Every analytics module's stored data for one team (or the company), newest first, so support sees
// what the company's screens are computed from.
const MODULE_TABLES: Array<{ key: string; label: string; table: string; order: string; scope: 'team' | 'company' }> = [
  { key: 'test_runs', label: 'Test execution runs', table: 'test_execution_runs', order: 'start_time', scope: 'team' },
  { key: 'test_executions', label: 'Team test executions (daily)', table: 'team_test_executions', order: 'execution_date', scope: 'team' },
  { key: 'flaky_tests', label: 'Flaky tests', table: 'flaky_tests', order: 'last_flaky_at', scope: 'team' },
  { key: 'technical_debt', label: 'Technical debt', table: 'technical_debt', order: 'created_at', scope: 'team' },
  { key: 'pipeline_runs', label: 'Pipeline runs', table: 'pipeline_runs', order: 'started_at', scope: 'team' },
  { key: 'pipeline_metrics', label: 'Pipeline metrics (daily)', table: 'team_pipeline_metrics', order: 'recorded_date', scope: 'team' },
  { key: 'performance', label: 'Performance metrics', table: 'performance_metrics', order: 'recorded_date', scope: 'team' },
  { key: 'sprints', label: 'Sprint velocity', table: 'sprint_velocity', order: 'end_date', scope: 'team' },
  { key: 'team_analytics', label: 'Team analytics periods', table: 'team_analytics', order: 'period_end', scope: 'team' },
  { key: 'ddps', label: 'Developer productivity snapshots', table: 'developer_productivity_snapshots', order: 'snapshot_date', scope: 'team' },
  { key: 'business_metrics', label: 'Business metrics', table: 'business_metrics', order: 'metric_date', scope: 'team' },
  { key: 'business_impact', label: 'Business impact metrics', table: 'business_impact_metrics', order: 'recorded_date', scope: 'team' },
  { key: 'company_snapshots', label: 'Company KPI snapshots', table: 'company_kpi_snapshots', order: 'snapshot_date', scope: 'company' },
];

router.get('/companies/:companyId/modules', ...op, view('modules', async (req, res, company) => {
  const teams = await query<any[]>('SELECT id, name FROM teams WHERE company_id = ? ORDER BY name LIMIT 2000', [company.id]);
  const teamId = typeof req.query.teamId === 'string' && teams.some((t: any) => t.id === req.query.teamId) ? req.query.teamId : teams[0]?.id ?? null;
  const limit = intParam(req.query.limit, 50, 1, 500);
  const modules: Array<{ key: string; label: string; total: number; rows: any[] }> = [];
  for (const m of MODULE_TABLES) {
    const exists = await queryOne<any>(
      `SELECT array_agg(column_name::text) AS cols FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?`, [m.table],
    );
    const cols: string[] = exists?.cols ?? [];
    if (!cols.length) continue;
    let where: string; let params: any[];
    if (m.scope === 'team' && !cols.includes('team_id') && cols.includes('developer_id')) {
      // Per-developer rows: the team's members.
      if (!teamId) { modules.push({ key: m.key, label: m.label, total: 0, rows: [] }); continue; }
      where = `developer_id IN (SELECT user_id FROM role_assignments WHERE scope_type = 'team' AND scope_id = ? AND revoked_at IS NULL)`; params = [teamId];
    } else if (m.scope === 'company' || !cols.includes('team_id')) {
      if (!cols.includes('company_id')) continue;
      where = 'company_id = ?'; params = [company.id];
    } else {
      if (!teamId) { modules.push({ key: m.key, label: m.label, total: 0, rows: [] }); continue; }
      where = 'team_id = ?'; params = [teamId];
    }
    const order = cols.includes(m.order) ? `${m.order} DESC NULLS LAST` : '1';
    const total = (await queryOne<any>(`SELECT COUNT(*)::int AS n FROM ${m.table} WHERE ${where}`, params))?.n ?? 0;
    const rows = await query<any[]>(`SELECT * FROM ${m.table} WHERE ${where} ORDER BY ${order} LIMIT ${limit}`, params);
    modules.push({ key: m.key, label: m.label, total, rows });
  }
  res.json({ teams, teamId, modules });
}));

router.get('/companies/:companyId/activity', ...op, view('activity', async (req, res, company) => {
  const limit = intParam(req.query.limit, 50, 1, 200);
  const params: any[] = [company.id];
  let where = 'a.company_id = ?';
  if (typeof req.query.before === 'string' && ID.test(req.query.before)) {
    where += ' AND (a.created_at, a.id) < (SELECT created_at, id FROM audit_log WHERE id = ?)'; params.push(req.query.before);
  }
  const rows = await query<any[]>(
    `SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.summary, a.undone_at, a.undo_of,
            ${fullNameSql('u')} AS actor_name, u.email AS actor_email
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit + 1}`,
    params,
  );
  const page = rows.slice(0, limit);
  res.json({ entries: page, nextBefore: rows.length > limit ? page[page.length - 1].id : null });
}));

router.get('/companies/:companyId/user-activity', ...op, view('user_activity', async (req, res, company) => {
  const limit = intParam(req.query.limit, 50, 1, 200);
  const out = await listUserActivity(company.id, filtersFromQuery(req.query), limit);
  const facets = req.query.facets === 'true' ? await userActivityFacets(company.id) : undefined;
  res.json({ ...out, facets });
}));

router.get('/companies/:companyId/errors', ...op, view('errors', async (req, res, company) => {
  const limit = intParam(req.query.limit, 50, 1, 200);
  const params: any[] = [company.id];
  let where = 'e.company_id = ?';
  const rid = requestIdOf(req.query.requestId);
  if (rid) { where += ' AND e.request_id = ?'; params.push(rid); }
  res.json(await listErrors(where, params, req.query.before, limit));
}));

router.get('/companies/:companyId/user-activity.csv', ...op, view('user_activity', async (req, res, company) => {
  const { entries } = await listUserActivity(company.id, { ...filtersFromQuery(req.query), before: null }, 10_000);
  sendCsv(res, `user-activity-${company.name}`, toCsv(ACTIVITY_CSV_COLUMNS, entries));
}));

router.get('/companies/:companyId/auth-events', ...op, view('auth_events', async (req, res, company) => {
  res.json(await listAuthEvents(authFiltersOf(req.query, company.id), intParam(req.query.limit, 50, 1, 200)));
}));

router.get('/companies/:companyId/auth-events.csv', ...op, view('auth_events', async (req, res, company) => {
  const { entries } = await listAuthEvents({ ...authFiltersOf(req.query, company.id), before: null }, 10_000);
  sendCsv(res, `sign-in-events-${company.name}`, toCsv(AUTH_CSV_COLUMNS, entries));
}));

// Every session of the company (newest first), with its status as the per-request check decides it.
router.get('/companies/:companyId/sessions', ...op, view('sessions', async (req, res, company) => {
  const onlyValid = req.query.status === 'valid';
  const rows = await query<any[]>(
    `SELECT ${SESSION_COLUMNS}, ${fullNameSql('u')} AS user_name, u.email AS user_email ${SESSION_FROM}
      WHERE s.company_id = ? ${onlyValid ? `AND ${sessionStatusSql} = 'valid'` : ''} ORDER BY s.issued_at DESC LIMIT ${intParam(req.query.limit, 200, 1, 1000)}`,
    [company.id],
  );
  res.json({ sessions: rows });
}));

// Who last looked at each team and department (user_activity: API reads and screens), and who looks most.
router.get('/companies/:companyId/views', ...op, view('views', async (req, res, company) => {
  const days = intParam(req.query.days, 30, 1, 90);
  const teams = await query<any[]>(
    `SELECT t.id, t.name, t.department_id, t.is_active, lv.created_at AS last_view_at, lv.actor_display AS last_viewer, lv.user_id AS last_viewer_id,
            lv.route AS last_route, lv.screen AS last_screen,
            (SELECT COUNT(*)::int FROM user_activity a WHERE a.company_id = t.company_id AND a.team_id = t.id AND a.category IN ('view', 'screen')
                AND a.created_at > now() - make_interval(days => ?)) AS views,
            (SELECT COALESCE(json_agg(x ORDER BY x.n DESC), '[]'::json) FROM (
               SELECT a.user_id, MAX(a.actor_display) AS who, COUNT(*)::int AS n FROM user_activity a
                WHERE a.company_id = t.company_id AND a.team_id = t.id AND a.category IN ('view', 'screen') AND a.user_id IS NOT NULL
                  AND a.created_at > now() - make_interval(days => ?)
                GROUP BY a.user_id ORDER BY 3 DESC LIMIT 3) x) AS top_viewers
       FROM teams t
       LEFT JOIN LATERAL (
         SELECT a.created_at, a.actor_display, a.user_id, a.route, a.screen FROM user_activity a
          WHERE a.company_id = t.company_id AND a.team_id = t.id AND a.category IN ('view', 'screen') ORDER BY a.created_at DESC LIMIT 1
       ) lv ON TRUE
      WHERE t.company_id = ? ORDER BY t.name LIMIT 2000`,
    [days, days, company.id],
  );
  const departments = await query<any[]>(
    `SELECT d.id, d.name, d.is_active, lv.created_at AS last_view_at, lv.actor_display AS last_viewer, lv.user_id AS last_viewer_id, lv.route AS last_route, lv.screen AS last_screen,
            (SELECT COUNT(*)::int FROM user_activity a WHERE a.company_id = d.company_id AND a.category IN ('view', 'screen')
                AND a.created_at > now() - make_interval(days => ?)
                AND ((a.entity_type = 'department' AND a.entity_id = d.id) OR a.team_id IN (SELECT id FROM teams WHERE department_id = d.id))) AS views,
            (SELECT COALESCE(json_agg(x ORDER BY x.n DESC), '[]'::json) FROM (
               SELECT a.user_id, MAX(a.actor_display) AS who, COUNT(*)::int AS n FROM user_activity a
                WHERE a.company_id = d.company_id AND a.category IN ('view', 'screen') AND a.user_id IS NOT NULL AND a.created_at > now() - make_interval(days => ?)
                  AND ((a.entity_type = 'department' AND a.entity_id = d.id) OR a.team_id IN (SELECT id FROM teams WHERE department_id = d.id))
                GROUP BY a.user_id ORDER BY 3 DESC LIMIT 3) x) AS top_viewers
       FROM departments d
       LEFT JOIN LATERAL (
         SELECT a.created_at, a.actor_display, a.user_id, a.route, a.screen FROM user_activity a
          WHERE a.company_id = d.company_id AND a.category IN ('view', 'screen')
            AND ((a.entity_type = 'department' AND a.entity_id = d.id) OR a.team_id IN (SELECT id FROM teams WHERE department_id = d.id))
          ORDER BY a.created_at DESC LIMIT 1
       ) lv ON TRUE
      WHERE d.company_id = ? ORDER BY d.name LIMIT 1000`,
    [days, days, company.id],
  );
  const viewers = await query<any[]>(
    `SELECT a.user_id, MAX(a.actor_display) AS who, COUNT(*)::int AS views, MAX(a.created_at) AS last_at,
            COUNT(DISTINCT a.team_id)::int AS teams
       FROM user_activity a WHERE a.company_id = ? AND a.category IN ('view', 'screen') AND a.user_id IS NOT NULL AND a.created_at > now() - make_interval(days => ?)
      GROUP BY a.user_id ORDER BY 3 DESC LIMIT 20`,
    [company.id, days],
  );
  res.json({ days, teams, departments, viewers });
}));

// One person: profile, assignments, teams, sign-ins, sessions, recent activity.
router.get('/companies/:companyId/users/:userId', ...op, view('user_detail', async (req, res, company) => {
  const id = req.params.userId;
  if (typeof id !== 'string' || !ID.test(id)) return void res.status(400).json({ error: 'Invalid user id' });
  const user = await queryOne<any>(
    `SELECT u.id, ${fullNameSql('u')} AS name, u.first_name, u.last_name, u.email, u.job_title, u.role, u.is_active, u.last_login, u.created_at, u.updated_at,
            u.failed_login_attempts, u.locked_until, (u.locked_until IS NOT NULL AND u.locked_until > now()) AS locked, u.developer_insights_enabled, u.email_verified, u.phone, u.timezone,
            u.department_id, d.name AS department_name, u.primary_team_id, t.name AS primary_team_name, u.sessions_valid_after,
            (u.password_hash IS NOT NULL) AS password_set,
            (SELECT COALESCE(json_agg(json_build_object('provider', ui.provider, 'lastLoginAt', ui.last_login_at)), '[]'::json) FROM user_identities ui WHERE ui.user_id = u.id) AS sso
       FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN teams t ON t.id = u.primary_team_id
      WHERE u.id = ? AND u.company_id = ?`,
    [id, company.id],
  );
  if (!user) return void res.status(404).json({ error: 'User not found' });
  const assignments = await listAssignments(company.id, [user.id]);
  const teams = await query<any[]>(
    `SELECT DISTINCT t.id, t.name, t.is_active, ra.role FROM role_assignments ra JOIN teams t ON t.id = ra.scope_id
      WHERE ra.user_id = ? AND ra.scope_type = 'team' AND ra.revoked_at IS NULL ORDER BY t.name`,
    [user.id],
  );
  const sessions = await query<any[]>(`SELECT ${SESSION_COLUMNS} ${SESSION_FROM} WHERE s.user_id = ? ORDER BY s.issued_at DESC LIMIT 200`, [user.id]);
  const signIns = await listAuthEvents({ companyId: company.id, userId: user.id }, 200);
  const activity = await listUserActivity(company.id, { userId: user.id }, 100);
  res.json({ user, assignments, teams, sessions, signIns: signIns.entries, activity: activity.entries });
}));

/* ------------------------------------------------------------------------------------------
 * Writes: the company app's own handlers (forward), and the operator-only changes
 * ---------------------------------------------------------------------------------------- */

class OpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}

/**
 * Run one route of a company app router (admin, targets, alerts, settings) for platform support:
 * the same handler, validation and business rules as in the company app, as a super admin of the
 * company with no user id (authenticateToken, PLATFORM_SUPPORT_REQUEST). Resolves with the
 * handler's status and JSON body; nothing is sent to the operator's client by the handler itself.
 */
function forward(req: OperatorRequest, target: express.Router, method: string, url: string, body: unknown, companyId: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const inner: any = Object.create(req);
    inner.method = method;
    inner.url = url;
    inner.originalUrl = url;
    inner.baseUrl = '';
    inner.body = body ?? {};
    inner.params = {};
    inner.cookies = {};
    inner[PLATFORM_SUPPORT_REQUEST] = { companyId };
    let done = false;
    const finish = (status: number, b: any) => { if (!done) { done = true; resolve({ status, body: b }); } };
    const headers: Record<string, unknown> = {};
    const out: any = {
      statusCode: 200, locals: {}, headersSent: false, req: inner,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.headersSent = true; finish(this.statusCode, b); return this; },
      send(b: any) { this.headersSent = true; finish(this.statusCode, b); return this; },
      sendStatus(c: number) { this.statusCode = c; return this.send(undefined); },
      end() { return this.send(undefined); },
      setHeader(k: string, v: unknown) { headers[k.toLowerCase()] = v; return this; },
      set(k: string, v: unknown) { headers[String(k).toLowerCase()] = v; return this; },
      header(k: string, v: unknown) { headers[String(k).toLowerCase()] = v; return this; },
      getHeader(k: string) { return headers[k.toLowerCase()]; },
      cookie() { return this; }, clearCookie() { return this; }, on() { return this; }, once() { return this; },
    };
    try {
      (target as any)(inner, out, (err?: unknown) => (err ? reject(err) : finish(404, { error: 'Not found' })));
    } catch (e) {
      reject(e);
    }
  });
}

/** Never hand a secret to the operator: invitation links / tokens from the company handlers. */
function scrub(body: any): any {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { link: _l, token: _t, resetLink: _r, ...rest } = body;
  return rest;
}

interface WriteOpts {
  /** Destructive: needs { confirm: true } (the panel asks in the page first). */
  destructive?: boolean;
}

/** An operator write: valid company, confirmation for destructive ones, errors as JSON. */
function write(handler: (req: OperatorRequest, res: express.Response, company: any, body: any) => Promise<void>, opts: WriteOpts = {}) {
  return async (req: OperatorRequest, res: express.Response) => {
    try {
      const company = await loadCompany(req, res);
      if (!company) return;
      const { confirm, ...body } = req.body ?? {};
      if (opts.destructive && confirm !== true) return void res.status(400).json({ error: 'Confirm this action (confirm: true).' });
      await handler(req, res, company, body);
    } catch (e) {
      if (e instanceof OpError) return void res.status(e.status).json({ error: e.message, ...(e.extra ?? {}) });
      if (e instanceof AssignmentError || e instanceof SavedViewError) return void res.status(e.status).json({ error: e.message });
      console.error('Operator write error:', e);
      if (!res.headersSent) res.status(500).json({ error: 'The change failed' });
    }
  };
}

/** A write that runs the company app's handler (see forward). `path` builds the inner URL. */
function fwd(target: express.Router, method: string, path: (req: OperatorRequest) => string, opts: WriteOpts = {}) {
  return write(async (req, res, company, body) => {
    const r = await forward(req, target, method, path(req), body, company.id);
    res.status(r.status).json(scrub(r.body) ?? {});
  }, opts);
}

/** A read through the company app's handler (targets, alert rules, update intervals, raw configs). */
function fwdRead(target: express.Router, path: (req: OperatorRequest) => string) {
  return view('app', async (req, res, company) => {
    const qs = new URLSearchParams(Object.entries(req.query).filter(([, v]) => typeof v === 'string') as Array<[string, string]>).toString();
    const r = await forward(req, target, 'GET', `${path(req)}${qs ? `?${qs}` : ''}`, undefined, company.id);
    res.status(r.status).json(scrub(r.body) ?? {});
  });
}

const enc = (v: unknown) => encodeURIComponent(String(v ?? ''));
const P = (name: string) => (req: OperatorRequest) => enc(req.params[name]);

// Reads the editors need (the same answers as in the company app).
router.get('/companies/:companyId/app/targets', ...op, fwdRead(targetsRoutes, () => '/'));
router.get('/companies/:companyId/app/alert-rules', ...op, fwdRead(alertsRoutes, () => '/rules'));
router.get('/companies/:companyId/app/metric-intervals', ...op, fwdRead(settingsRoutes, () => '/metric-intervals'));
router.get('/companies/:companyId/app/configs', ...op, fwdRead(adminRoutes, () => '/configs/raw'));

/* ---- Company ---------------------------------------------------------------------------- */

/** A 12-character company id (8 letters / digits + 4 digits), as registration makes them. */
function newCompanyId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  return id + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

const DOMAIN_RE = /^(?=.{3,255}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

async function checkDomain(domain: string, exceptId: string | null): Promise<{ domain: string; isPublic: boolean }> {
  const d = domain.trim().toLowerCase();
  if (!DOMAIN_RE.test(d)) throw new OpError(400, 'Enter a valid e-mail domain (for example example.com).');
  const isPublic = isPublicEmailDomain(d);
  if (!isPublic) {
    const taken = await queryOne<any>('SELECT id FROM companies WHERE LOWER(domain) = ? AND email_domain_public = FALSE AND id <> COALESCE(?::text, \'\')', [d, exceptId]);
    if (taken) throw new OpError(409, `An organisation already uses the e-mail domain ${d}.`);
  }
  return { domain: d, isPublic };
}

/**
 * Create a company: the organisation, its first department and team, and (optional) its first super
 * admin, with a password or by invitation. The user and the invitation go through the company app's
 * own handlers (POST /api/admin/users, /invitations, /users/:id/assignments).
 */
/** Roles the first person of a new company may get (Create company). */
const FIRST_PERSON_ROLES = ['super_admin', 'qa_manager', 'team_lead', 'qa_engineer', 'viewer'];

router.post('/companies', ...op, async (req: OperatorRequest, res) => {
  try {
    const b = req.body ?? {};
    if (!text(b.name, 255)) return void res.status(400).json({ error: 'Enter the company name.' });
    const name = displayName(b.name, 'Company name');
    if (await queryOne<any>('SELECT 1 FROM companies WHERE LOWER(name) = LOWER(?)', [name])) return void res.status(409).json({ error: 'An organisation with this name already exists.' });
    const admin = b.admin && typeof b.admin === 'object' ? b.admin : null;
    const adminEmail = admin ? text(admin.email, 255)?.toLowerCase() ?? '' : '';
    if (admin && !EMAIL_RE.test(adminEmail)) return void res.status(400).json({ error: 'Enter a valid e-mail address for the first person.' });
    // The first person's role (default super admin): manager of the first department, or team lead /
    // software engineer / viewer of the first team.
    const firstRole: string = admin?.role ?? 'super_admin';
    if (admin && !FIRST_PERSON_ROLES.includes(firstRole)) return void res.status(400).json({ error: `Role: one of ${FIRST_PERSON_ROLES.join(', ')}.` });
    // A password for the first person follows the company's password rules (src/lib/passwordPolicy.ts);
    // checked before anything is created, so a weak password does not leave a company without its admin.
    if (admin && admin.mode !== 'invite') {
      displayName(admin.firstName, 'First name');
      displayName(admin.lastName, 'Last name');
      const weak = typeof admin.password === 'string' ? passwordProblem(admin.password, adminEmail) : 'Enter a password for the first person.';
      if (weak) return void res.status(400).json({ error: weak });
    }
    const { domain, isPublic } = await checkDomain(text(b.domain, 255) ?? (adminEmail ? emailDomainOf(adminEmail) : ''), null);
    const departmentName = text(b.departmentName, 255) ? displayName(b.departmentName, 'Department name') : 'General';
    const teamName = text(b.teamName, 255) ? displayName(b.teamName, 'Team name') : 'Team 1';
    const companyId = newCompanyId();
    const departmentId = (await queryOne<any>('SELECT gen_random_uuid()::text AS id'))!.id;
    const teamId = `team-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    await transaction(async (client) => {
      const exec = execOn(client);
      await exec('INSERT INTO companies (id, name, domain, email_domain_public, is_active, status) VALUES (?, ?, ?, ?, TRUE, \'active\')', [companyId, name, domain, isPublic]);
      await exec('INSERT INTO departments (id, company_id, name, is_active) VALUES (?, ?, ?, TRUE)', [departmentId, companyId, departmentName]);
      await exec("INSERT INTO teams (id, company_id, department_id, name, description, is_active) VALUES (?, ?, ?, ?, '', TRUE)", [teamId, companyId, departmentId, teamName]);
    });
    let adminResult: any = null;
    if (admin) {
      const scopeId = firstRole === 'super_admin' ? companyId : firstRole === 'qa_manager' ? departmentId : teamId;
      if (admin.mode === 'invite') {
        const r = await forward(req, adminRoutes, 'POST', '/invitations', { email: adminEmail, role: firstRole, scopeId }, companyId);
        adminResult = { mode: 'invite', role: firstRole, status: r.status, ...scrub(r.body) };
      } else if (firstRole !== 'super_admin') {
        const r = await forward(req, adminRoutes, 'POST', '/users', {
          email: adminEmail, password: admin.password, firstName: admin.firstName, lastName: admin.lastName, role: firstRole,
          ...(firstRole === 'qa_manager' ? { departmentId } : { teamId, departmentId }),
        }, companyId);
        adminResult = { mode: 'password', role: firstRole, status: r.status, userId: r.body?.id, error: r.status < 300 ? undefined : r.body?.error };
      } else {
        const r = await forward(req, adminRoutes, 'POST', '/users', {
          email: adminEmail, password: admin.password, firstName: admin.firstName, lastName: admin.lastName, role: 'qa_engineer', teamId, departmentId,
        }, companyId);
        if (r.status < 300 && r.body?.id) {
          const g = await forward(req, adminRoutes, 'POST', `/users/${enc(r.body.id)}/assignments`, { role: 'super_admin', scopeType: 'company' }, companyId);
          adminResult = { mode: 'password', role: firstRole, status: g.status < 300 ? 201 : g.status, userId: r.body.id, error: g.status < 300 ? undefined : g.body?.error };
        } else adminResult = { mode: 'password', status: r.status, error: r.body?.error };
      }
    }
    const company = await queryOne<any>(`SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = ?`, [companyId]);
    res.status(201).json({ company, departmentId, teamId, admin: adminResult });
  } catch (e) {
    if (e instanceof OpError) return void res.status(e.status).json({ error: e.message });
    if ((e as any)?.code === '23505') return void res.status(409).json({ error: 'An organisation with this domain already exists.' });
    console.error('Operator create company error:', e);
    res.status(500).json({ error: 'Failed to create the company' });
  }
});

// Name, e-mail domain and the sample-data notice setting (companies.settings.hideSampleDataNotice).
router.put('/companies/:companyId', ...op, write(async (_req, res, company, b) => {
  if (b.name !== undefined && !text(b.name, 255)) throw new OpError(400, 'Enter the company name.');
  const name = b.name === undefined ? company.name : displayName(b.name, 'Company name');
  if (name.toLowerCase() !== String(company.name).toLowerCase()
    && await queryOne<any>('SELECT 1 FROM companies WHERE LOWER(name) = LOWER(?) AND id <> ?', [name, company.id])) {
    throw new OpError(409, 'An organisation with this name already exists.');
  }
  const d = b.domain === undefined ? { domain: company.domain, isPublic: company.email_domain_public } : await checkDomain(String(b.domain), company.id);
  const settings = { ...(company.settings ?? {}) };
  if (b.hideSampleDataNotice !== undefined) {
    if (typeof b.hideSampleDataNotice !== 'boolean') throw new OpError(400, 'hideSampleDataNotice must be true or false.');
    settings.hideSampleDataNotice = b.hideSampleDataNotice;
  }
  await query('UPDATE companies SET name = ?, domain = ?, email_domain_public = ?, settings = ?::jsonb, updated_at = now() WHERE id = ?',
    [name, d.domain, d.isPublic, JSON.stringify(settings), company.id]);
  const updated = await queryOne<any>(`SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = ?`, [company.id]);
  res.json({ company: { ...updated, hideSampleDataNotice: !!updated.settings?.hideSampleDataNotice } });
}));

// "Sign-in lasts": the company app's own endpoint.
router.put('/companies/:companyId/session-settings', ...op, fwd(adminRoutes, 'PUT', () => '/session-settings'));

/**
 * Suspend (e.g. until an invoice is paid): users cannot sign in, every session and API key is
 * refused (403 company_suspended), the scheduled jobs skip the company. Its open sessions are
 * also marked revoked. Reactivating lets everyone sign in again (old sessions stay ended).
 */
router.post('/companies/:companyId/suspend', ...op, write(async (req, res, company, b) => {
  if (company.status === 'suspended') throw new OpError(409, 'This company is already suspended.');
  const reason = text(b.reason, 500);
  if (!reason) throw new OpError(400, 'Say why the company is suspended (shown to IronGate operators only).');
  let until: string | null = null;
  if (b.suspendedUntil) {
    const t = Date.parse(String(b.suspendedUntil));
    if (!Number.isFinite(t)) throw new OpError(400, 'Enter a valid date for "suspended until".');
    until = new Date(t).toISOString();
  }
  await transaction(async (client) => {
    const exec = execOn(client);
    await exec(`UPDATE companies SET status = 'suspended', suspended_reason = ?, suspended_at = now(), suspended_by = ?, suspended_until = ?, billing_note = ?, updated_at = now() WHERE id = ?`,
      [reason, req.operator!.operatorId, until, text(b.billingNote, 1000), company.id]);
    await exec(`UPDATE user_sessions SET revoked_at = now(), revoked_by = 'IronGate platform support', revoke_reason = 'Organisation suspended'
                 WHERE company_id = ? AND revoked_at IS NULL`, [company.id]);
  });
  res.json({ company: await queryOne<any>(`SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = ?`, [company.id]) });
}, { destructive: true }));

router.post('/companies/:companyId/reactivate', ...op, write(async (_req, res, company) => {
  if (company.status !== 'suspended') throw new OpError(409, 'This company is not suspended.');
  await query(`UPDATE companies SET status = 'active', suspended_reason = NULL, suspended_at = NULL, suspended_by = NULL, suspended_until = NULL, updated_at = now() WHERE id = ?`, [company.id]);
  res.json({ company: await queryOne<any>(`SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = ?`, [company.id]) });
}, { destructive: true }));

// Delete the company and ALL its data (every table cascades). The exact name must be typed.
router.delete('/companies/:companyId', ...op, write(async (_req, res, company, b) => {
  if (typeof b.confirmName !== 'string' || b.confirmName.trim() !== company.name) throw new OpError(400, `Type the company name (${company.name}) to delete it.`);
  await query('DELETE FROM companies WHERE id = ?', [company.id]);
  res.json({ deleted: true, id: company.id });
}, { destructive: true }));

/* ---- Departments and teams (company app handlers) ---------------------------------------- */

router.post('/companies/:companyId/departments', ...op, fwd(adminRoutes, 'POST', () => '/departments'));
router.put('/companies/:companyId/departments/:id', ...op, fwd(adminRoutes, 'PUT', (r) => `/departments/${P('id')(r)}`));
router.delete('/companies/:companyId/departments/:id', ...op, fwd(adminRoutes, 'DELETE', (r) => `/departments/${P('id')(r)}`, { destructive: true }));
router.post('/companies/:companyId/departments/:id/managers', ...op, fwd(adminRoutes, 'POST', (r) => `/departments/${P('id')(r)}/managers`));
router.post('/companies/:companyId/departments/:id/managers/:userId/remove', ...op,
  fwd(adminRoutes, 'POST', (r) => `/departments/${P('id')(r)}/managers/${P('userId')(r)}/remove`, { destructive: true }));

router.post('/companies/:companyId/teams', ...op, fwd(adminRoutes, 'POST', () => '/teams'));
router.put('/companies/:companyId/teams/:id', ...op, fwd(adminRoutes, 'PUT', (r) => `/teams/${P('id')(r)}`));
router.put('/companies/:companyId/teams/:id/department', ...op, fwd(adminRoutes, 'PUT', (r) => `/teams/${P('id')(r)}/department`));
router.put('/companies/:companyId/teams/:id/lead', ...op, fwd(adminRoutes, 'PUT', (r) => `/teams/${P('id')(r)}/lead`));

// Archive / restore: the company app's team status toggle, only when the team is in the expected state.
for (const kind of ['archive', 'restore'] as const) {
  router.post(`/companies/:companyId/teams/:id/${kind}`, ...op, write(async (req, res, company) => {
    const team = await queryOne<any>('SELECT id, is_active FROM teams WHERE id = ? AND company_id = ?', [req.params.id, company.id]);
    if (!team) throw new OpError(404, 'Team not found');
    if (team.is_active !== (kind === 'archive')) throw new OpError(409, kind === 'archive' ? 'This team is already archived.' : 'This team is active.');
    const r = await forward(req, adminRoutes, 'POST', `/teams/${enc(team.id)}/toggle-status`, {}, company.id);
    res.status(r.status).json(r.body ?? {});
  }, { destructive: kind === 'archive' }));
}

// Delete a team for good (its data goes with it; its members keep their accounts). Type the team name.
router.delete('/companies/:companyId/teams/:id', ...op, write(async (req, res, company, b) => {
  const team = await queryOne<any>('SELECT id, name FROM teams WHERE id = ? AND company_id = ?', [req.params.id, company.id]);
  if (!team) throw new OpError(404, 'Team not found');
  if (typeof b.confirmName !== 'string' || b.confirmName.trim() !== team.name) throw new OpError(400, `Type the team name (${team.name}) to delete it.`);
  await transaction(async (client) => {
    const exec = execOn(client);
    const grants = await exec<any>(`SELECT user_id, role FROM role_assignments WHERE scope_type = 'team' AND scope_id = ? AND revoked_at IS NULL`, [team.id]);
    for (const g of grants) await revokeGrant(exec, { userId: g.user_id, grant: { role: g.role, scopeType: 'team', scopeId: team.id }, actorId: null });
    await exec(`UPDATE invitations SET revoked_at = now() WHERE company_id = ? AND scope_type = 'team' AND scope_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`, [company.id, team.id]);
    await exec('UPDATE users SET primary_team_id = NULL WHERE primary_team_id = ?', [team.id]);
    await exec('DELETE FROM teams WHERE id = ? AND company_id = ?', [team.id, company.id]);
    for (const uid of [...new Set(grants.map((g: any) => g.user_id as string))]) await syncUserDisplay(exec, uid);
  });
  res.json({ deleted: true, id: team.id });
}, { destructive: true }));

/* ---- People ------------------------------------------------------------------------------ */

// Create with a password (the company app's handler). role super_admin: created as a team member, then
// given the company super admin assignment (the company app's assignment handler), as an admin would.
router.post('/companies/:companyId/users', ...op, write(async (req, res, company, b) => {
  const superAdmin = b.role === 'super_admin';
  const r = await forward(req, adminRoutes, 'POST', '/users', superAdmin ? { ...b, role: 'qa_engineer' } : b, company.id);
  if (r.status >= 300 || !superAdmin) return void res.status(r.status).json(scrub(r.body) ?? {});
  const g = await forward(req, adminRoutes, 'POST', `/users/${enc(r.body.id)}/assignments`, { role: 'super_admin', scopeType: 'company' }, company.id);
  res.status(g.status < 300 ? 201 : g.status).json(g.status < 300 ? { ...r.body, assignments: g.body?.assignments } : g.body);
}));
router.put('/companies/:companyId/users/:userId', ...op, fwd(adminRoutes, 'PUT', (r) => `/users/${P('userId')(r)}`));
router.post('/companies/:companyId/users/:userId/assignments', ...op, fwd(adminRoutes, 'POST', (r) => `/users/${P('userId')(r)}/assignments`));
router.delete('/companies/:companyId/users/:userId/assignments/:assignmentId', ...op,
  fwd(adminRoutes, 'DELETE', (r) => `/users/${P('userId')(r)}/assignments/${P('assignmentId')(r)}`, { destructive: true }));
router.post('/companies/:companyId/users/:userId/reset-password', ...op, fwd(adminRoutes, 'POST', (r) => `/users/${P('userId')(r)}/reset-password`, { destructive: true }));
router.post('/companies/:companyId/users/:userId/send-reset-link', ...op, fwd(adminRoutes, 'POST', (r) => `/users/${P('userId')(r)}/send-reset-link`));

// Delete a person for good (their sessions, assignments, notifications and own saved views go too).
router.delete('/companies/:companyId/users/:userId', ...op, write(async (req, res, company, b) => {
  const u = await queryOne<any>('SELECT id, email, role FROM users WHERE id = ? AND company_id = ?', [req.params.userId, company.id]);
  if (!u) throw new OpError(404, 'User not found');
  if (typeof b.confirmEmail !== 'string' || b.confirmEmail.trim().toLowerCase() !== String(u.email).toLowerCase()) {
    throw new OpError(400, `Type the e-mail address (${u.email}) to delete this person.`);
  }
  const superAdmin = await queryOne<any>(`SELECT 1 FROM role_assignments WHERE user_id = ? AND role = 'super_admin' AND revoked_at IS NULL`, [u.id]);
  if (superAdmin) await lastSuperAdminGuard(company.id, u.id);
  await transaction(async (client) => {
    const exec = execOn(client);
    const led = await exec<any>(`SELECT scope_id FROM role_assignments WHERE user_id = ? AND role = 'team_lead' AND revoked_at IS NULL`, [u.id]);
    await exec('DELETE FROM users WHERE id = ? AND company_id = ?', [u.id, company.id]);
    for (const l of led) await exec('UPDATE teams SET lead_id = NULL WHERE id = ? AND lead_id = ?', [l.scope_id, u.id]);
  });
  res.json({ deleted: true, id: u.id });
}, { destructive: true }));

/* ---- Invitations, API keys, settings (company app handlers) ------------------------------- */

router.post('/companies/:companyId/invitations', ...op, fwd(adminRoutes, 'POST', () => '/invitations'));
router.post('/companies/:companyId/invitations/:id/revoke', ...op, fwd(adminRoutes, 'POST', (r) => `/invitations/${P('id')(r)}/revoke`, { destructive: true }));
// A new key is shown ONCE (plaintextKey), as in the company app; afterwards only its prefix.
router.post('/companies/:companyId/api-keys', ...op, fwd(adminRoutes, 'POST', () => '/api-keys'));
router.post('/companies/:companyId/api-keys/:id/revoke', ...op, fwd(adminRoutes, 'POST', (r) => `/api-keys/${P('id')(r)}/revoke`, { destructive: true }));
router.put('/companies/:companyId/targets', ...op, fwd(targetsRoutes, 'PUT', () => '/'));
router.post('/companies/:companyId/configs', ...op, fwd(adminRoutes, 'POST', () => '/configs'));
router.put('/companies/:companyId/metric-intervals/:metricKey', ...op, fwd(settingsRoutes, 'PUT', (r) => `/metric-intervals/${P('metricKey')(r)}`));
router.delete('/companies/:companyId/metric-intervals/:metricKey', ...op, fwd(settingsRoutes, 'DELETE', (r) => `/metric-intervals/${P('metricKey')(r)}`, { destructive: true }));
router.put('/companies/:companyId/alert-rules', ...op, fwd(alertsRoutes, 'PUT', () => '/rules'));

/* ---- Saved views (owned by a person: changed here directly, with the company app's name rule) ---- */

router.put('/companies/:companyId/saved-views/:id', ...op, write(async (req, res, company, b) => {
  const v = await queryOne<any>('SELECT id, name, shared FROM saved_views WHERE id = ? AND company_id = ?', [req.params.id, company.id]);
  if (!v) throw new OpError(404, 'View not found');
  const name = b.name === undefined ? v.name : validateViewName(b.name);
  if (b.shared !== undefined && typeof b.shared !== 'boolean') throw new OpError(400, 'shared must be true or false');
  const shared = b.shared === undefined ? v.shared : b.shared;
  try {
    await query(`UPDATE saved_views SET name = ?, shared = ?, shared_at = CASE WHEN ? AND NOT shared THEN now() WHEN NOT ? THEN NULL ELSE shared_at END,
                 shared_by = CASE WHEN NOT ? THEN NULL ELSE shared_by END, updated_at = now() WHERE id = ?`, [name, shared, shared, shared, shared, v.id]);
  } catch (e: any) {
    if (e?.code === '23505') throw new OpError(409, 'The owner already has a view with this name');
    throw e;
  }
  res.json({ view: await queryOne<any>('SELECT id, kind, module, name, shared, updated_at FROM saved_views WHERE id = ?', [v.id]) });
}));

router.delete('/companies/:companyId/saved-views/:id', ...op, write(async (req, res, company) => {
  const r = await query<any[]>('DELETE FROM saved_views WHERE id = ? AND company_id = ? RETURNING id', [req.params.id, company.id]);
  if (!r.length) throw new OpError(404, 'View not found');
  res.json({ deleted: true });
}, { destructive: true }));

/* ---- Sessions ---------------------------------------------------------------------------- */

router.post('/companies/:companyId/sessions/:sessionId/revoke', ...op, write(async (req, res, company) => {
  const s = await queryOne<any>('SELECT id FROM user_sessions WHERE id = ? AND company_id = ?', [req.params.sessionId, company.id]);
  if (!s) throw new OpError(404, 'Session not found');
  if (!(await revokeSession(s.id, 'IronGate platform support', 'Revoked by platform support'))) throw new OpError(409, 'This session was already revoked.');
  res.json({ revoked: true, id: s.id });
}, { destructive: true }));

/* ------------------------------------------------------------------------------------------
 * Repairs
 * ---------------------------------------------------------------------------------------- */

// "Refresh sample data now". On Netlify the refresh takes longer than the API function may run,
// so it starts the background function (as the nightly scheduler does) and answers "started"; the
// result is in Scheduled jobs (demo-refresh-background). Elsewhere it runs here and now.
router.post('/actions/demo-refresh', ...op, async (req: OperatorRequest, res) => {
  try {
    if (!demoRefreshEnabled()) return void res.status(409).json({ error: 'The sample data refresh is off (DEMO_REFRESH_ENABLED=false).' });
    if (req.app?.locals?.behindNetlify || runningOnNetlify()) {
      const started = new Date();
      const r = await startBackgroundDemoRefresh();
      await recordJobOutcome('demo-refresh', r.ok, `${r.summary} (manual, platform support)`, started);
      if (!r.ok) return void res.status(502).json({ error: `The sample data refresh could not be started: ${r.summary}.` });
      return void res.status(202).json({ started: true, mode: 'background' });
    }
    const { runRefreshDates } = await import('../seeds/demoSeed');
    const r = await withJobRun('demo-refresh', () => runRefreshDates(), (x) => `${x.insertedTotal} new rows (manual, platform support)`);
    res.json({ started: true, mode: 'direct', result: r });
  } catch (e) {
    console.error('Operator demo refresh error:', e);
    res.status(500).json({ error: 'The action failed' });
  }
});

/* ---- Sample data: "Demo Data" and "Populate metrics" (server/lib/demoGenerate.ts) ---------- */

/** Errors of the sample-data routes as JSON (DemoDataError carries its status). */
const demo = (handler: Parameters<typeof write>[0]) => write(async (req, res, company, body) => {
  try {
    await handler(req, res, company, body);
  } catch (e) {
    if (e instanceof DemoDataError) return void res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// Demo Data: departments, Scrum teams and people now (one transaction), then a year of sample data for
// the new teams in a job (background function on Netlify). The shared password is in this answer only,
// so it is 202 even when the job could not be started (the job then says why; Populate metrics retries).
router.post('/companies/:companyId/demo-data', ...op, demo(async (req, res, company, b) => {
  const size = parseDemoSize(b);
  const org = await createDemoOrg(company.id, size);
  const started = await startDemoJob(org.jobId, { behindNetlify: !!req.app?.locals?.behindNetlify });
  res.status(202).json({ ...org, mode: started.mode, job: await getDemoJob(company.id, org.jobId) });
}));

// Populate metrics: a year of sample data for every team of the company that lacks data (nobody is created).
router.post('/companies/:companyId/populate-metrics', ...op, demo(async (req, res, company) => {
  const jobId = await queuePopulate(company.id);
  const started = await startDemoJob(jobId, { behindNetlify: !!req.app?.locals?.behindNetlify });
  const job = await getDemoJob(company.id, jobId);
  if (!started.ok) return void res.status(502).json({ error: job?.error ?? 'The background job could not be started.', jobId, job });
  res.status(202).json({ jobId, mode: started.mode, job });
}));

router.get('/companies/:companyId/demo-data/jobs/latest', ...op, view('demo_data', async (_req, res, company) => {
  res.json({ job: await latestDemoJob(company.id) });
}));

router.get('/companies/:companyId/demo-data/jobs/:jobId', ...op, view('demo_data', async (req, res, company) => {
  const job = typeof req.params.jobId === 'string' && ID.test(req.params.jobId) ? await getDemoJob(company.id, req.params.jobId) : null;
  if (!job) return void res.status(404).json(NOT_FOUND);
  res.json({ job });
}));

router.post('/companies/:companyId/actions/recompute-snapshots', ...op, write(async (_req, res, company, b) => {
  const teamId = typeof b.teamId === 'string' && b.teamId ? b.teamId : null;
  const from = typeof b.from === 'string' && DAY.test(b.from) ? b.from : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const teams = await query<any[]>(
    'SELECT id, name FROM teams WHERE company_id = ? AND is_active = TRUE AND (?::text IS NULL OR id = ?) ORDER BY id', [company.id, teamId, teamId],
  );
  if (teamId && !teams.length) throw new OpError(404, 'Team not found in this company');
  const done: Array<{ teamId: string; from: string | null; days: number }> = [];
  for (const t of teams) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kpi_snapshots:${t.id}`]);
      // Start at the first EXISTING snapshot on or after `from`, so no new (empty) day is created.
      const first = (await client.query(`SELECT to_char(MIN(snapshot_date), 'YYYY-MM-DD') AS d FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date >= $2::date`, [t.id, from])).rows[0]?.d ?? null;
      let days = 0;
      if (first) {
        await client.query('SELECT public.refresh_kpi_snapshots($1, $2::date, $3::text[])', [t.id, first, KPI_COLUMN_NAMES]);
        days = (await client.query('SELECT COUNT(*)::int AS n FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date >= $2::date', [t.id, first])).rows[0].n;
      }
      await client.query('COMMIT');
      done.push({ teamId: t.id, from: first, days });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
  res.json({ teams: done });
}));

router.post('/companies/:companyId/actions/evaluate-alerts', ...op, write(async (_req, res, company) => {
  const r = await evaluateCompany(company.id);
  res.json({ teams: r.teams, opened: r.opened.length, resolved: r.resolved, refreshed: r.refreshed });
}));

router.post('/companies/:companyId/invitations/:id/resend', ...op, write(async (req, res, company) => {
  const inv = await queryOne<any>(
    `SELECT i.id, i.email, i.role, ${statusSql('i')} AS status,
            CASE i.scope_type WHEN 'company' THEN c.name WHEN 'department' THEN d.name ELSE t.name END AS scope_name,
            CASE i.scope_type WHEN 'department' THEN d.id WHEN 'team' THEN t.department_id ELSE NULL END AS department_id
       FROM invitations i JOIN companies c ON c.id = i.company_id
       LEFT JOIN departments d ON i.scope_type = 'department' AND d.id = i.scope_id
       LEFT JOIN teams t ON i.scope_type = 'team' AND t.id = i.scope_id
      WHERE i.id = ? AND i.company_id = ?`,
    [req.params.id, company.id],
  );
  if (!inv) throw new OpError(404, 'Invitation not found');
  if (inv.status === 'accepted' || inv.status === 'revoked') throw new OpError(409, `This invitation was ${inv.status}.`);
  const issued = await reissueInvitation({ companyId: company.id, invitation: inv, actorId: null, summary: `Re-sent the invitation to ${inv.email}` });
  if (!issued) throw new OpError(409, 'This invitation was used or revoked meanwhile.');
  const mail = await sendInvitationEmail({
    to: inv.email, token: issued.token, companyName: company.name, inviterName: null, role: inv.role, scopeName: inv.scope_name, expiresAt: issued.expiresAt,
  });
  // Never the link or token: only whether the e-mail went out.
  res.json({ delivered: mail.delivered, channel: mail.channel, error: mail.error ?? null, expiresAt: issued.expiresAt });
}));

async function loadCompanyUser(req: OperatorRequest, companyId: string) {
  const id = req.params.userId;
  if (typeof id !== 'string' || !ID.test(id)) throw new OpError(400, 'Invalid user id');
  const u = await queryOne<any>(
    `SELECT id, email, ${fullNameSql('users')} AS name, role, is_active, failed_login_attempts, locked_until FROM users WHERE id = ? AND company_id = ?`,
    [id, companyId],
  );
  if (!u) throw new OpError(404, 'User not found');
  return u;
}

for (const kind of ['deactivate', 'reactivate'] as const) {
  router.post(`/companies/:companyId/users/:userId/${kind}`, ...op, write(async (req, res, company) => {
    const u = await loadCompanyUser(req, company.id);
    const active = kind === 'reactivate';
    if (u.is_active === active) throw new OpError(409, `This user is already ${active ? 'active' : 'inactive'}.`);
    if (!active && u.role === 'super_admin') await lastSuperAdminGuard(company.id, u.id);
    await auditedUserChange(
      { companyId: company.id, actorId: null, action: active ? 'user.activate' : 'user.deactivate', userIds: [u.id] },
      async (exec) => {
        await exec('UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ? AND company_id = ?', [active, u.id, company.id]);
        return { summary: `${active ? 'Reactivated' : 'Deactivated'} ${u.name ?? u.email}`, result: null };
      },
    );
    res.json({ userId: u.id, is_active: active });
  }, { destructive: kind === 'deactivate' }));
}

router.post('/companies/:companyId/users/:userId/clear-lockout', ...op, write(async (req, res, company) => {
  const u = await loadCompanyUser(req, company.id);
  if (!(Number(u.failed_login_attempts) > 0) && !u.locked_until) throw new OpError(409, 'This account has no lockout to clear.');
  await query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = ? AND company_id = ?', [u.id, company.id]);
  res.json({ userId: u.id, cleared: true });
}));

// Sign the user out everywhere: every session ends (and shows as revoked by platform support).
router.post('/companies/:companyId/users/:userId/sign-out-everywhere', ...op, write(async (req, res, company) => {
  const u = await loadCompanyUser(req, company.id);
  await endUserSessions(u.id, undefined, { by: 'IronGate platform support', reason: 'Signed out everywhere by platform support' });
  res.json({ userId: u.id, signedOut: true });
}, { destructive: true }));

export default router;
