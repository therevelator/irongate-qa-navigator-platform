import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { query, queryOne, pool } from '../../src/lib/db';
import { authenticateToken, JWT_SECRET } from '../middleware/auth';
import { clientIp } from '../lib/requestContext';
import {
  OPERATOR_COOKIE, OPERATOR_REASON_HEADER, OPERATOR_SESSION_MINUTES, OPERATOR_TOKEN_HEADER, checkOperatorPassword, cleanReason,
  endOperatorSession, ipAllowed, logPlatformAccess, openOperatorSession, operatorEnabled, recordCompanyAction, recordCompanyView,
  startOperatorSession, verifyOperatorToken, type OperatorRequest, type SignInResult,
} from '../lib/operator';
import { listAssignments, teamLeadNameSql, teamMemberCountSql, lastSuperAdminGuard, AssignmentError } from '../lib/assignments';
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
import { reissueInvitation, sendInvitationEmail, statusSql } from '../lib/invitations';
import { JOB_NAMES, recordJobOutcome, withJobRun } from '../lib/opsLog';
import { demoRefreshEnabled, runningOnNetlify, startBackgroundDemoRefresh } from '../lib/demoRefreshJob';
import { mailChannel } from '../lib/mailer';
import { endUserSessions, sessionProblem, sessionRowOf } from '../lib/sessions';
import { filtersFromQuery, listUserActivity, userActivityFacets } from '../lib/userActivityQuery';

/**
 * Platform operator panel API (server/lib/operator.ts has the security design):
 *
 *   GET  /api/operator/status                    { operator: boolean } (harmless for anyone)
 *   POST /api/operator/session  { password }     step-up: a 30-minute operator token
 *   GET  /api/operator/session                   the open session (expiry)
 *   POST /api/operator/session/end               "Leave": ends the operator token
 *   GET  /api/operator/overview                  every company with health; job runs, errors, DB size
 *   GET  /api/operator/errors?requestId&before   server errors, platform-wide
 *   GET  /api/operator/access-log                the platform-level operator access log
 *   GET  /api/operator/companies/:companyId/{summary|organisation|users|settings|data|alerts|pulse|activity|user-activity|errors}
 *        (header X-Operator-Reason required; each view is recorded, see recordCompanyView)
 *   POST /api/operator/actions/demo-refresh                                   { reason }
 *   POST /api/operator/companies/:companyId/actions/recompute-snapshots       { reason, teamId?, from? }
 *   POST /api/operator/companies/:companyId/actions/evaluate-alerts           { reason }
 *   POST /api/operator/companies/:companyId/invitations/:id/resend            { reason }
 *   POST /api/operator/companies/:companyId/users/:userId/deactivate|reactivate|clear-lockout|sign-out-everywhere { reason }
 *
 * Every route needs the session (authenticateToken) AND an allowlisted email (re-checked each
 * request); every route except status and the step-up also needs the operator token.
 * Protected data is never selected: password hashes, API key hashes, Slack webhooks and secret
 * config values (masked), invitation and pulse link tokens, single pulse answers and comments,
 * developer metrics of people who have not opted in.
 */
const router = express.Router();

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NOT_FOUND = { error: 'Not found' };
const intParam = (v: unknown, def: number, min: number, max: number) => Math.min(Math.max(parseInt(String(v ?? def), 10) || def, min), max);

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
      await logPlatformAccess(req, { action: 'access.refused', detail: { why: 'ip_not_allowed' } });
      return res.status(403).json({ error: 'Platform support is not available from this network.' });
    }
    const s = await sessionOf(req);
    if (!s) return res.status(401).json({ error: 'Sign in to platform support.', code: 'operator_session_required' });
    req.operator = s;
    next();
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

// 10 failed sign-ins per IP per 15 minutes (per instance); the account itself locks after 5 in a row.
const signInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.OPERATOR_SIGN_IN_MAX) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req: any) => `opsign:${clientIp(req)}`,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

router.post('/login', signInLimiter, async (req: OperatorRequest, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Enter your e-mail address and password.' });
    }
    if (!ipAllowed(clientIp(req))) {
      await logPlatformAccess(req, { action: 'sign_in.refused', email: email.slice(0, 255), detail: { why: 'ip_not_allowed' } });
      return res.status(403).json({ error: 'Platform support is not available from this network.' });
    }
    const r = await checkOperatorPassword(email, password);
    if (r.ok === false) {
      const f = r as Extract<SignInResult, { ok: false }>;
      await logPlatformAccess(req, { action: 'sign_in.failed', email: f.operator?.email ?? null, userId: f.operator?.id ?? null, detail: { why: f.why } });
      console.warn('[operator] failed sign-in');
      if (f.why === 'locked') return res.status(423).json({ error: 'Too many failed attempts. This account is locked for 15 minutes.' });
      return res.status(401).json({ error: 'Wrong e-mail address or password.' });
    }
    const okr = r as Extract<SignInResult, { ok: true }>;
    const s = await startOperatorSession(okr.operator.id, clientIp(req));
    await logPlatformAccess(req, { action: 'sign_in.ok', email: okr.operator.email, userId: okr.operator.id, detail: { sessionId: s.sessionId } });
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
    await logPlatformAccess(req, { action: 'session.end' });
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
 * Platform-wide
 * ---------------------------------------------------------------------------------------- */

const MAIN_TABLES = [
  'companies', 'users', 'teams', 'departments', 'role_assignments', 'kpi_snapshots', 'metric_values', 'ingestion_log', 'audit_log',
  'alerts', 'notifications', 'notification_deliveries', 'pulse_responses', 'user_activity', 'server_errors', 'job_runs',
];

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

router.get('/overview', ...op, async (req: OperatorRequest, res) => {
  try {
    const limit = intParam(req.query.limit, 100, 1, 500);
    const offset = intParam(req.query.offset, 0, 0, 100_000);
    const companies = await query<any[]>(
      `SELECT c.id, c.name, c.domain, c.created_at, c.is_active,
              (SELECT COUNT(*)::int FROM users u WHERE u.company_id = c.id AND u.is_active) AS users,
              (SELECT COUNT(*)::int FROM teams t WHERE t.company_id = c.id AND t.is_active) AS teams,
              GREATEST((SELECT MAX(mv.received_at) FROM metric_values mv WHERE mv.company_id = c.id),
                       (SELECT MAX(il.received_at) FROM ingestion_log il WHERE il.company_id = c.id)) AS last_data_at,
              (SELECT COUNT(*)::int FROM alerts a WHERE a.company_id = c.id AND a.resolved_at IS NULL) AS open_alerts,
              (SELECT COUNT(*)::int FROM server_errors e WHERE e.company_id = c.id AND e.created_at > now() - interval '24 hours') AS errors_24h,
              GREATEST((SELECT MAX(ua.created_at) FROM user_activity ua WHERE ua.company_id = c.id),
                       (SELECT MAX(u.last_login) FROM users u WHERE u.company_id = c.id)) AS last_activity_at
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
    const errors24h = (await queryOne<any>(`SELECT COUNT(*)::int AS n FROM server_errors WHERE created_at > now() - interval '24 hours'`))?.n ?? 0;
    const dbSize = (await queryOne<any>('SELECT pg_database_size(current_database())::bigint AS bytes'))?.bytes ?? null;
    const counts = await query<any[]>(
      `SELECT c.relname AS table, c.reltuples::bigint AS approx_rows, pg_total_relation_size(c.oid)::bigint AS bytes
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(?::text[]) ORDER BY c.relname`,
      [MAIN_TABLES],
    );
    res.json({
      companies, total, limit, offset,
      platform: {
        jobs: JOB_NAMES.map((j) => ({ job: j, last: jobs.find((r: any) => r.job === j) ?? null, lastOkAt: lastOk.find((r: any) => r.job === j)?.last_ok_at ?? null })),
        errors24h, dbSizeBytes: Number(dbSize), tables: counts.map((r: any) => ({ ...r, approx_rows: Math.max(0, Number(r.approx_rows)), bytes: Number(r.bytes) })),
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
    if (rid) await logPlatformAccess(req, { action: 'view', section: 'error_search', detail: { requestId: rid } });
    res.json({ ...out, activity });
  } catch (e) {
    console.error('Operator errors error:', e);
    res.status(500).json({ error: 'Failed to load the errors' });
  }
});

router.get('/access-log', ...op, async (req: OperatorRequest, res) => {
  try {
    const limit = intParam(req.query.limit, 50, 1, 200);
    const params: any[] = [];
    let where = 'TRUE';
    if (typeof req.query.before === 'string' && ID.test(req.query.before)) {
      where += ' AND (l.created_at, l.id) < (SELECT created_at, id FROM platform_access_log WHERE id = ?)'; params.push(req.query.before);
    }
    const rows = await query<any[]>(
      `SELECT l.id, l.created_at, l.operator_email, l.action, l.company_id, c.name AS company_name, l.section, l.reason, l.ip, l.request_id
         FROM platform_access_log l LEFT JOIN companies c ON c.id = l.company_id WHERE ${where} ORDER BY l.created_at DESC, l.id DESC LIMIT ${limit + 1}`,
      params,
    );
    const page = rows.slice(0, limit);
    res.json({ entries: page, nextBefore: rows.length > limit ? page[page.length - 1].id : null });
  } catch (e) {
    console.error('Operator access log error:', e);
    res.status(500).json({ error: 'Failed to load the access log' });
  }
});

/* ------------------------------------------------------------------------------------------
 * One company (views)
 * ---------------------------------------------------------------------------------------- */

async function loadCompany(req: OperatorRequest, res: express.Response): Promise<any | null> {
  const id = req.params.companyId;
  if (typeof id !== 'string' || !ID.test(id)) { res.status(400).json({ error: 'Invalid company id' }); return null; }
  const c = await queryOne<any>('SELECT id, name, domain, created_at, is_active FROM companies WHERE id = ?', [id]);
  if (!c) { res.status(404).json({ error: 'Company not found' }); return null; }
  return c;
}

/** A company view: valid company, reason header, recorded (platform log + throttled company audit entry). */
function view(section: string, handler: (req: OperatorRequest, res: express.Response, company: any) => Promise<void>) {
  return async (req: OperatorRequest, res: express.Response) => {
    try {
      const company = await loadCompany(req, res);
      if (!company) return;
      const reason = cleanReason(req.headers[OPERATOR_REASON_HEADER]);
      if (!reason) return res.status(400).json({ error: 'Give a reason for opening this company (3 to 300 characters).' });
      await recordCompanyView(req, company.id, section, reason);
      await handler(req, res, company);
    } catch (e) {
      console.error(`Operator ${section} error:`, e);
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
            (SELECT COUNT(*)::int FROM server_errors WHERE company_id = ? AND created_at > now() - interval '24 hours') AS errors_24h`,
    [company.id, company.id, company.id, company.id, company.id, company.id],
  );
  const onboarding = await onboardingStatus(company.id).catch(() => null);
  const onboardingRow = await queryOne<any>('SELECT dismissed_at, completed_at, updated_at FROM onboarding_state WHERE company_id = ?', [company.id]);
  res.json({ company, counts, onboarding, onboardingState: onboardingRow ?? null });
}));

router.get('/companies/:companyId/organisation', ...op, view('organisation', async (_req, res, company) => {
  const departments = await query<any[]>(
    'SELECT id, name, description, is_active, created_at FROM departments WHERE company_id = ? ORDER BY name LIMIT 1000', [company.id],
  );
  const teams = await query<any[]>(
    `SELECT t.id, t.name, t.department_id, t.is_active, t.platform, t.created_at, t.ai_enabled,
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
    `SELECT u.id, ${fullNameSql('u')} AS name, u.email, u.role, u.is_active, u.last_login, u.created_at,
            u.failed_login_attempts, u.locked_until, (u.locked_until IS NOT NULL AND u.locked_until > now()) AS locked,
            u.developer_insights_enabled, u.email_verified, u.email_verified_at, u.first_name, u.last_name, u.phone, u.timezone,
            u.department_id, d.name AS department_name, u.primary_team_id, t.name AS primary_team_name, u.updated_at, u.sessions_valid_after,
            (u.password_hash IS NOT NULL) AS password_set,
            EXISTS (SELECT 1 FROM user_identities ui WHERE ui.user_id = u.id) AS sso_linked
       FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN teams t ON t.id = u.primary_team_id
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
  res.json({ users, assignments, invitations, apiKeys, lockoutNote: 'Sign-in does not lock accounts today; the lockout columns are shown in case one was set.' });
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

/* ------------------------------------------------------------------------------------------
 * Repair actions (reversible or harmless, confirmed in the UI, reason required, audited)
 * ---------------------------------------------------------------------------------------- */

function action(handler: (req: OperatorRequest, res: express.Response, company: any | null, reason: string) => Promise<void>, withCompany = true) {
  return async (req: OperatorRequest, res: express.Response) => {
    try {
      const company = withCompany ? await loadCompany(req, res) : null;
      if (withCompany && !company) return;
      const reason = cleanReason(req.body?.reason);
      if (!reason) return res.status(400).json({ error: 'Give a reason (3 to 300 characters).' });
      if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirm the action (confirm: true).' });
      await handler(req, res, company, reason);
    } catch (e) {
      if (e instanceof AssignmentError) return void res.status(e.status).json({ error: e.message });
      console.error('Operator action error:', e);
      if (!res.headersSent) res.status(500).json({ error: 'The action failed' });
    }
  };
}

// "Refresh sample data now". On Netlify the refresh takes longer than the API function may run,
// so it starts the background function (as the nightly scheduler does) and answers "started"; the
// result is in Scheduled jobs (demo-refresh-background). Elsewhere it runs here and now.
router.post('/actions/demo-refresh', ...op, action(async (req, res, _c, reason) => {
  if (!demoRefreshEnabled()) return void res.status(409).json({ error: 'The sample data refresh is off (DEMO_REFRESH_ENABLED=false).' });
  if (req.app?.locals?.behindNetlify || runningOnNetlify()) {
    const started = new Date();
    const r = await startBackgroundDemoRefresh();
    await recordJobOutcome('demo-refresh', r.ok, `${r.summary} (manual, platform support)`, started);
    if (!r.ok) return void res.status(502).json({ error: `The sample data refresh could not be started: ${r.summary}.` });
    await recordCompanyAction(req, null, 'demo_refresh', 'Started the sample data refresh', reason);
    return void res.status(202).json({ started: true, mode: 'background' });
  }
  const { runRefreshDates } = await import('../seeds/demoSeed');
  const r = await withJobRun('demo-refresh', () => runRefreshDates(), (x) => `${x.insertedTotal} new rows (manual, platform support)`);
  await recordCompanyAction(req, null, 'demo_refresh', 'Re-ran the demo data refresh', reason, { insertedTotal: r.insertedTotal });
  // Companies whose sample data was refreshed see it in their Activity log.
  for (const c of r.companies.filter((x) => x.teamsFilled > 0)) {
    await recordCompanyAction(req, c.id, 'demo_refresh', `Refreshed the sample data of ${c.teamsFilled} team(s)`, reason);
  }
  res.json({ started: true, mode: 'direct', result: r });
}, false));

router.post('/companies/:companyId/actions/recompute-snapshots', ...op, action(async (req, res, company, reason) => {
  const teamId = typeof req.body?.teamId === 'string' && req.body.teamId ? req.body.teamId : null;
  const from = typeof req.body?.from === 'string' && DAY.test(req.body.from) ? req.body.from : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const teams = await query<any[]>(
    'SELECT id, name FROM teams WHERE company_id = ? AND is_active = TRUE AND (?::text IS NULL OR id = ?) ORDER BY id', [company.id, teamId, teamId],
  );
  if (teamId && !teams.length) return void res.status(404).json({ error: 'Team not found in this company' });
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
  const scope = teamId ? `team ${teams[0].name}` : `${teams.length} team(s)`;
  await recordCompanyAction(req, company.id, 'recompute_snapshots', `Recomputed the KPI snapshots of ${scope} from ${from}`, reason, { teamId, from });
  res.json({ teams: done });
}));

router.post('/companies/:companyId/actions/evaluate-alerts', ...op, action(async (req, res, company, reason) => {
  const r = await evaluateCompany(company.id);
  await recordCompanyAction(req, company.id, 'evaluate_alerts', `Re-ran the alert evaluation (${r.opened.length} opened, ${r.resolved} resolved)`, reason);
  res.json({ teams: r.teams, opened: r.opened.length, resolved: r.resolved, refreshed: r.refreshed });
}));

router.post('/companies/:companyId/invitations/:id/resend', ...op, action(async (req, res, company, reason) => {
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
  if (!inv) return void res.status(404).json({ error: 'Invitation not found' });
  if (inv.status === 'accepted' || inv.status === 'revoked') return void res.status(409).json({ error: `This invitation was ${inv.status}.` });
  const issued = await reissueInvitation({
    companyId: company.id, invitation: inv, actorId: null,
    summary: `Platform support re-sent the invitation to ${inv.email} (new link; the previous one no longer works)`,
  });
  if (!issued) return void res.status(409).json({ error: 'This invitation was used or revoked meanwhile.' });
  const mail = await sendInvitationEmail({
    to: inv.email, token: issued.token, companyName: company.name, inviterName: null, role: inv.role, scopeName: inv.scope_name, expiresAt: issued.expiresAt,
  });
  await recordCompanyAction(req, company.id, 'invitation_resend', `Re-sent the invitation to ${inv.email}`, reason, { delivered: mail.delivered });
  // Never the link or token: only whether the e-mail went out.
  res.json({ delivered: mail.delivered, channel: mail.channel, error: mail.error ?? null, expiresAt: issued.expiresAt });
}));

async function loadCompanyUser(req: OperatorRequest, res: express.Response, companyId: string) {
  const id = req.params.userId;
  if (typeof id !== 'string' || !ID.test(id)) { res.status(400).json({ error: 'Invalid user id' }); return null; }
  const u = await queryOne<any>(
    `SELECT id, email, ${fullNameSql('users')} AS name, role, is_active, failed_login_attempts, locked_until FROM users WHERE id = ? AND company_id = ?`,
    [id, companyId],
  );
  if (!u) { res.status(404).json({ error: 'User not found' }); return null; }
  return u;
}

for (const kind of ['deactivate', 'reactivate'] as const) {
  router.post(`/companies/:companyId/users/:userId/${kind}`, ...op, action(async (req, res, company, reason) => {
    const u = await loadCompanyUser(req, res, company.id);
    if (!u) return;
    const active = kind === 'reactivate';
    if (u.is_active === active) return void res.status(409).json({ error: `This user is already ${active ? 'active' : 'inactive'}.` });
    if (!active && u.role === 'super_admin') await lastSuperAdminGuard(company.id, u.id);
    const who = u.name ?? u.email;
    // The usual reversible user change (a super admin of the company can undo it in the Activity log).
    await auditedUserChange(
      { companyId: company.id, actorId: null, action: active ? 'user.activate' : 'user.deactivate', userIds: [u.id] },
      async (exec) => {
        await exec('UPDATE users SET is_active = ?, updated_at = NOW() WHERE id = ? AND company_id = ?', [active, u.id, company.id]);
        return { summary: `Platform support ${active ? 'reactivated' : 'deactivated'} ${who}`, result: null };
      },
    );
    await recordCompanyAction(req, company.id, `user_${kind}`, `${active ? 'Reactivated' : 'Deactivated'} the account of ${who}`, reason, { userId: u.id });
    res.json({ userId: u.id, is_active: active });
  }));
}

router.post('/companies/:companyId/users/:userId/clear-lockout', ...op, action(async (req, res, company, reason) => {
  const u = await loadCompanyUser(req, res, company.id);
  if (!u) return;
  if (!(Number(u.failed_login_attempts) > 0) && !u.locked_until) return void res.status(409).json({ error: 'This account has no lockout to clear.' });
  await query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = ? AND company_id = ?', [u.id, company.id]);
  await recordCompanyAction(req, company.id, 'clear_lockout', `Cleared the sign-in lockout of ${u.name ?? u.email}`, reason,
    { userId: u.id, before: { failedAttempts: u.failed_login_attempts, lockedUntil: u.locked_until } });
  res.json({ userId: u.id, cleared: true });
}));

// Sign the user out everywhere (all sessions and platform support sessions end). Recorded in the
// platform log and the company's Activity log, like the other repair actions.
router.post('/companies/:companyId/users/:userId/sign-out-everywhere', ...op, action(async (req, res, company, reason) => {
  const u = await loadCompanyUser(req, res, company.id);
  if (!u) return;
  await endUserSessions(u.id);
  await recordCompanyAction(req, company.id, 'sign_out_everywhere', `Signed ${u.name ?? u.email} out everywhere`, reason, { userId: u.id });
  res.json({ userId: u.id, signedOut: true });
}));

export default router;
