/**
 * Self-serve demo sandbox (the /try page; constants and the request rules in sandboxConfig.ts).
 *
 * Build: one fictional company, SANDBOX_COMPANY_ID ("Northwind Bank — demo", e-mail domain
 *   northwind-bank.example, reserved: nothing is ever delivered there). Two departments, five Scrum teams
 *   with year-long stories (strong, improving, struggling, declining, recovering), a Product Owner, a Scrum
 *   Master and four engineers per team, a CTO (super admin) and a Head of QA (manager of both departments).
 *   The same generators as the Meridian showcase and the operator's Demo Data: the organisation is written
 *   by writeOrg (server/lib/demoGenerate.ts), then runFillExisting fills ONE YEAR of every module
 *   (KPIs, the v2 raw evidence: tests, coverage, pipelines, deployments, incidents, issues, SARIF;
 *   pulse, business impact with its financial settings, action plans with their status history) and
 *   the Scrum content layer (retro actions, alert history, ingestion log, onboarding, targets), and
 *   the forecasts and recommendations are calculated for every team. Nobody holds a password: every
 *   user's hash is a bcrypt hash of 32 random bytes that is never kept, and the password sign-in
 *   refuses the company's users anyway (server/routes/auth.ts).
 *
 * Reset (resetSandbox): the nightly scheduled function (netlify/functions/sandbox-reset.ts starts
 *   sandbox-reset-background.ts), the long-running server's cron (server/jobs/sandboxCron.ts) and the
 *   operator panel's "Reset sandbox now". It ends every sandbox session, deletes the company (every table
 *   cascades from companies, users and teams) and builds it again with today's dates, so the data always
 *   looks current and every visitor's change (accepted or dismissed recommendations, action statuses,
 *   acknowledged alerts) is gone. Idempotent: two runs give the same company. One run at a time
 *   (a session-level advisory lock; a second run returns skipped). The first run on a new database builds
 *   the company from scratch, so production needs no manual seed step.
 *
 * Sessions (startSandboxSession): POST /api/auth/sandbox { persona }. No password: the visitor is signed
 *   in as the persona's shared user for SANDBOX_SESSION_HOURS (browser-session cookie, the same cookie and
 *   session table as every sign-in, method 'sandbox'). Per client address at most
 *   SANDBOX_SESSIONS_PER_IP_HOUR new sessions an hour and at most SANDBOX_MAX_SESSIONS open sandbox
 *   sessions in all, both counted in user_sessions (so they hold across Netlify instances). The session
 *   row keeps only a keyed hash of the address (no address, location or browser), since the persona is
 *   shared by every visitor.
 */
import { createHmac, randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type express from 'express';
import type pg from 'pg';
import { pool, query, queryOne } from '../../src/lib/db';
import { JWT_SECRET } from '../middleware/auth';
import { clientIp } from './requestContext';
import { SESSION_COOKIE, sessionCookieOptions } from './sessions';
import { recordJobOutcome, withJobRun, scrubMessage } from './opsLog';
import { YEAR_SHAPE, writeOrg } from './demoGenerate';
import { runningOnNetlify, siteBaseUrl } from './demoRefreshJob';
import { showcaseContentSql, storyKindOf, type OrgPlan, type PlannedPerson, type StoryKind } from '../seeds/demoOrg';
import { defaultTeamHealth } from '../seeds/demoData';
import {
  SANDBOX_COMPANY_ID, SANDBOX_COMPANY_NAME, SANDBOX_EMAIL_DOMAIN, SANDBOX_PERSONAS, SANDBOX_SESSION_HOURS,
  sandboxMaxSessions, sandboxSessionsPerIpHour, type SandboxPersonaKey,
} from './sandboxConfig';

/* ------------------------------------------------------------------------------------------
 * The organisation (fixed: the same company after every reset)
 * ---------------------------------------------------------------------------------------- */

const DEPT_RETAIL = 'sandbox-dept-retail';
const DEPT_PLATFORM = 'sandbox-dept-platform';

interface TeamSpec { slug: string; name: string; platform: string; description: string; dept: string; story: StoryKind; tz: string }

const TEAM_SPECS: TeamSpec[] = [
  { slug: 'mobile', name: 'Mobile Banking', platform: 'iOS & Android', description: 'The iOS and Android banking apps', dept: DEPT_RETAIL, story: 'improving', tz: 'Europe/Dublin' },
  { slug: 'online', name: 'Online Banking', platform: 'Web', description: 'Web banking, statements and secure messages', dept: DEPT_RETAIL, story: 'strong', tz: 'Europe/Dublin' },
  { slug: 'onboarding', name: 'Customer Onboarding', platform: 'Web', description: 'Account opening, identity checks and first steps', dept: DEPT_RETAIL, story: 'struggling', tz: 'Europe/Dublin' },
  { slug: 'cards', name: 'Cards & Payments', platform: 'Backend API', description: 'Card authorisations, transfers and payment schemes', dept: DEPT_PLATFORM, story: 'declining', tz: 'Europe/London' },
  { slug: 'core', name: 'Core Platform', platform: 'Infrastructure', description: 'Cloud platform, CI/CD and observability', dept: DEPT_PLATFORM, story: 'recovering', tz: 'Europe/London' },
];

/** Fictional people (five teams × a Product Owner, a Scrum Master and four engineers, minus the two team personas). */
const NAMES: Array<[string, string]> = [
  ['Nora', 'Brennan'], ['Tomás', 'Quinlan'], ['Leah', 'Achterberg'], ['Ravi', 'Menon'],
  ['Clara', 'Holloway'], ['Felix', 'Duarte'], ['Ines', 'Varga'], ['Owen', 'Castellanos'], ['Hana', 'Mori'], ['Dmitri', 'Sokol'],
  ['Grace', 'Adebayo'], ['Lukas', 'Ferrand'], ['Maya', 'Thorsen'], ['Kofi', 'Ansah'], ['Elif', 'Kaya'], ['Bruno', 'Salgado'],
  ['Saoirse', 'Kennelly'], ['Mateo', 'Ibarra'], ['Yuki', 'Hayashi'], ['Ahmed', 'Rashidi'], ['Freya', 'Lund'], ['Jonas', 'Weller'],
  ['Amara', 'Nwosu'], ['Pavel', 'Hronek'], ['Zara', 'Qureshi'], ['Hugo', 'Marchetti'], ['Ana', 'Petrescu'], ['Liam', 'Gallen'],
];

const ENGINEER_TITLES: Record<string, string[]> = {
  'iOS & Android': ['Senior Mobile Engineer (iOS)', 'Mobile Engineer (Android)', 'Backend Engineer'],
  Web: ['Senior Frontend Engineer', 'QA Automation Engineer', 'Backend Engineer', 'UX Designer'],
  'Backend API': ['Senior Backend Engineer', 'QA Automation Engineer', 'Backend Engineer', 'DevOps Engineer'],
  Infrastructure: ['Senior Platform Engineer', 'Site Reliability Engineer', 'QA Automation Engineer', 'DevOps Engineer'],
};

/** A fixed team id whose default story (the nightly sample model derives it from the id) is `story`. */
export function sandboxTeamId(slug: string, story: StoryKind): string {
  for (let i = 0; i < 10_000; i++) {
    const id = i === 0 ? `sandbox-team-${slug}` : `sandbox-team-${slug}-${i}`;
    if (storyKindOf(defaultTeamHealth(id)) === story) return id;
  }
  return `sandbox-team-${slug}`;
}

const ascii = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const emailOf = (first: string, last: string) => `${ascii(first)}.${ascii(last)}@${SANDBOX_EMAIL_DOMAIN}`;

/** The organisation plan (departments, teams, people; the CTO is added by writeSandboxOrg). */
export function sandboxPlan(): OrgPlan {
  const plan: OrgPlan = {
    departments: [
      { id: DEPT_RETAIL, name: 'Retail Banking', description: 'Mobile and online banking for personal customers', head: 'Head of Quality Engineering', tz: 'Europe/Dublin' },
      { id: DEPT_PLATFORM, name: 'Platform & Payments', description: 'Cards, payments and the shared platform', head: 'Head of Quality Engineering', tz: 'Europe/London' },
    ],
    teams: [],
    people: [],
  };
  const hq = SANDBOX_PERSONAS.head_of_qa;
  plan.people.push({
    id: hq.userId, first: hq.first, last: hq.last, email: emailOf(hq.first, hq.last), title: hq.title, kind: 'manager', role: 'qa_manager',
    departmentId: DEPT_RETAIL, teamId: null, joinedDaysAgo: 398, insights: false, tz: 'Europe/Dublin',
  });
  let n = 0;
  const next = () => NAMES[n++ % NAMES.length];
  TEAM_SPECS.forEach((t, ti) => {
    const id = sandboxTeamId(t.slug, t.story);
    plan.teams.push({ id, name: t.name, platform: t.platform, description: t.description, departmentId: t.dept, story: t.story });
    const base = { departmentId: t.dept, teamId: id, tz: t.tz };
    const person = (p: Omit<PlannedPerson, 'id' | 'email' | 'departmentId' | 'teamId' | 'tz'> & { id?: string }): PlannedPerson =>
      ({ ...base, ...p, id: p.id ?? `sandbox-u-${t.slug}-${plan.people.length}`, email: emailOf(p.first, p.last) });
    const [poFirst, poLast] = next();
    plan.people.push(person({ first: poFirst, last: poLast, title: 'Product Owner', kind: 'product_owner', role: 'viewer', joinedDaysAgo: 372 - ti, insights: false }));
    if (t.slug === 'mobile') {
      const tl = SANDBOX_PERSONAS.team_lead;
      plan.people.push(person({ id: tl.userId, first: tl.first, last: tl.last, title: 'Scrum Master', kind: 'scrum_master', role: 'team_lead', joinedDaysAgo: 366, insights: true }));
      const en = SANDBOX_PERSONAS.engineer;
      plan.people.push(person({ id: en.userId, first: en.first, last: en.last, title: 'QA Automation Engineer', kind: 'engineer', role: 'qa_engineer', joinedDaysAgo: 352, insights: true }));
    } else {
      const [smFirst, smLast] = next();
      plan.people.push(person({ first: smFirst, last: smLast, title: 'Scrum Master', kind: 'scrum_master', role: 'team_lead', joinedDaysAgo: 365 - ti, insights: true }));
    }
    const titles = ENGINEER_TITLES[t.platform] ?? ENGINEER_TITLES.Web;
    for (let i = 0; i < titles.length; i++) {
      const [first, last] = next();
      // The first two joined when the team started; the others over the year. A UX designer does not
      // share developer insights (at least three others of the team do).
      plan.people.push(person({
        first, last, title: titles[i], kind: 'engineer', role: 'qa_engineer',
        joinedDaysAgo: i < 2 ? 350 - ti * 2 - i : 40 + ((ti * 97 + i * 61) % 280), insights: titles[i] !== 'UX Designer',
      }));
    }
  });
  return plan;
}

/** Write the company and its organisation (one transaction; the company must not exist). */
async function writeSandboxOrg(client: pg.PoolClient, plan: OrgPlan): Promise<void> {
  const hash = await bcrypt.hash(randomBytes(32).toString('hex'), 10); // nobody knows this password
  const settings = { hideSampleDataNotice: true, sandbox: { state: 'building', startedAt: new Date().toISOString() } };
  await client.query(
    `INSERT INTO companies (id, name, domain, email_domain_public, is_active, status, settings, created_at, updated_at)
     VALUES ($1, $2, $3, FALSE, TRUE, 'active', $4::jsonb, now() - interval '400 days', now())`,
    [SANDBOX_COMPANY_ID, SANDBOX_COMPANY_NAME, SANDBOX_EMAIL_DOMAIN, JSON.stringify(settings)],
  );
  await writeOrg(client, SANDBOX_COMPANY_ID, plan, hash);
  // The CTO: super admin of the company.
  const cto = SANDBOX_PERSONAS.cto;
  await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, job_title, role, company_id, department_id, primary_team_id, timezone,
                        is_active, email_verified, email_verified_at, developer_insights_enabled, created_at, updated_at, last_login)
     VALUES ($1, $2, $3, $4, $5, $6, 'super_admin', $7, $8, NULL, 'Europe/Dublin', TRUE, TRUE, now() - interval '400 days', FALSE,
             now() - interval '400 days', now() - interval '400 days', now() - interval '1 day')`,
    [cto.userId, emailOf(cto.first, cto.last), hash, cto.first, cto.last, cto.title, SANDBOX_COMPANY_ID, DEPT_RETAIL],
  );
  await client.query(
    `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id, created_at) VALUES ($1, $2, $3, 'super_admin', 'company', $2, now() - interval '400 days')`,
    [randomUUID(), SANDBOX_COMPANY_ID, cto.userId],
  );
  // The Head of QA manages both departments.
  const hq = SANDBOX_PERSONAS.head_of_qa;
  await client.query(
    `INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id, created_at) VALUES ($1, $2, $3, 'qa_manager', 'department', $4, now() - interval '398 days')`,
    [randomUUID(), SANDBOX_COMPANY_ID, hq.userId, DEPT_PLATFORM],
  );
  await client.query(`UPDATE departments SET manager_id = $1 WHERE company_id = $2`, [hq.userId, SANDBOX_COMPANY_ID]);
  // Every token issued before this build is refused (the users get the same ids after a reset, and
  // their old session rows are gone with the old company).
  await client.query(`UPDATE users SET sessions_valid_after = date_trunc('second', clock_timestamp()) + interval '1 second' WHERE company_id = $1`, [SANDBOX_COMPANY_ID]);
}

/* ------------------------------------------------------------------------------------------
 * Build and reset
 * ---------------------------------------------------------------------------------------- */

export interface SandboxStatus {
  exists: boolean;
  state: 'missing' | 'building' | 'ready' | 'failed';
  readyAt: string | null;
  startedAt: string | null;
  dataUpTo: string | null;
  teams: number;
  users: number;
  openSessions: number;
  sessionsToday: number;
  lastReset: { at: string; ok: boolean | null; summary: string | null } | null;
}

export async function sandboxStatus(): Promise<SandboxStatus> {
  const c = await queryOne<any>(
    `SELECT c.settings->'sandbox' AS s,
            (SELECT count(*)::int FROM teams t WHERE t.company_id = c.id) AS teams,
            (SELECT count(*)::int FROM users u WHERE u.company_id = c.id) AS users,
            (SELECT count(*)::int FROM user_sessions s WHERE s.company_id = c.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS open_sessions,
            (SELECT count(*)::int FROM user_sessions s WHERE s.company_id = c.id AND s.issued_at >= date_trunc('day', now())) AS sessions_today
       FROM companies c WHERE c.id = ?`,
    [SANDBOX_COMPANY_ID],
  );
  const last = await queryOne<any>(
    `SELECT started_at, ok, summary FROM job_runs WHERE job IN ('sandbox-reset', 'sandbox-reset-background') ORDER BY started_at DESC LIMIT 1`,
  ).catch(() => null);
  const s = c?.s ?? {};
  const state = !c ? 'missing' : (['building', 'ready', 'failed'].includes(s.state) ? s.state : 'building');
  return {
    exists: !!c, state, readyAt: s.readyAt ?? null, startedAt: s.startedAt ?? null, dataUpTo: s.dataUpTo ?? null,
    teams: c?.teams ?? 0, users: c?.users ?? 0, openSessions: c?.open_sessions ?? 0, sessionsToday: c?.sessions_today ?? 0,
    lastReset: last ? { at: new Date(last.started_at).toISOString(), ok: last.ok, summary: last.summary } : null,
  };
}

/** Whether the sandbox is ready for visitors. */
export async function sandboxReady(): Promise<boolean> {
  const r = await queryOne<any>(`SELECT settings->'sandbox'->>'state' AS state FROM companies WHERE id = ?`, [SANDBOX_COMPANY_ID]);
  return r?.state === 'ready';
}

const setState = (fields: Record<string, unknown>) => query(
  `UPDATE companies SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{sandbox}', COALESCE(settings->'sandbox', '{}'::jsonb) || ?::jsonb), updated_at = now() WHERE id = ?`,
  [JSON.stringify(fields), SANDBOX_COMPANY_ID],
);

export interface SandboxBuildResult { today: string; teams: number; people: number; rows: number; forecasts: number; recommendations: number; durationMs: number }

/** Build the sandbox company (it must not exist). */
export async function buildSandbox(opts: { today?: string } = {}): Promise<SandboxBuildResult> {
  const started = Date.now();
  const plan = sandboxPlan();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await writeSandboxOrg(client, plan);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  try {
    const { runFillExisting } = await import('../seeds/demoSeed');
    const stories = Object.fromEntries(plan.teams.map((t) => [t.id, storyPoints(t.id, t.story)]));
    const r = await runFillExisting({
      today: opts.today, companyIds: [SANDBOX_COMPANY_ID], noNewPeople: true, counts: false,
      shape: { ...YEAR_SHAPE, stories, respectJoinDates: true },
      afterPlan: (p) => showcaseContentSql(SANDBOX_COMPANY_ID, (p[0]?.teams ?? []).filter((t) => t.groups?.has('kpi')).map((t) => t.id)),
    });
    // Forecasts and recommendations of every team (the rule-based engine; nothing calls an AI provider).
    const { refreshTeamImprove } = await import('./recommendations/store');
    let forecasts = 0;
    let recommendations = 0;
    for (const t of plan.teams) {
      const x = await refreshTeamImprove({ id: t.id, company_id: SANDBOX_COMPANY_ID, department_id: t.departmentId, name: t.name }, { asOf: r.today });
      forecasts += x.forecasts;
      recommendations += x.recommendations;
    }
    const result = {
      today: r.today, teams: plan.teams.length, people: plan.people.length + 1, rows: r.insertedTotal, forecasts, recommendations, durationMs: Date.now() - started,
    };
    await setState({ state: 'ready', readyAt: new Date().toISOString(), dataUpTo: r.today });
    return result;
  } catch (e) {
    await setState({ state: 'failed', error: scrubMessage((e as Error)?.message)?.slice(0, 300) ?? 'error' }).catch(() => undefined);
    throw e;
  }
}

/** The story of a team as health per days ago (the sample model interpolates), ending at its default health today. */
function storyPoints(teamId: string, story: StoryKind): Array<[number, number]> {
  const h = defaultTeamHealth(teamId);
  const c = (v: number) => Math.round(Math.min(0.96, Math.max(0.1, v)) * 1000) / 1000;
  const pts: Record<StoryKind, Array<[number, number]>> = {
    strong: [[0, h], [90, h + 0.01], [180, h - 0.02], [270, h], [365, h - 0.03]],
    improving: [[0, h], [60, h - 0.08], [150, h - 0.2], [250, h - 0.3], [365, h - 0.32]],
    recovering: [[0, h], [50, h - 0.05], [110, h - 0.18], [170, h - 0.26], [220, h - 0.2], [290, h - 0.04], [365, h]],
    declining: [[0, h], [45, h + 0.04], [100, h + 0.17], [150, h + 0.28], [365, h + 0.32]],
    struggling: [[0, h], [120, h + 0.05], [240, h + 0.02], [365, h + 0.08]],
  };
  return pts[story].map(([d, v]) => [d, d === 0 ? h : c(v)] as [number, number]);
}

export interface SandboxResetResult extends Partial<SandboxBuildResult> { skipped?: boolean; reason?: string; sessionsEnded: number; existed: boolean }

const LOCK_KEY = 'irongate-sandbox-reset';

/**
 * Restore the sandbox to its baseline: end every sandbox session, delete the company (everything
 * cascades) and build it again with today's dates. One run at a time across every process (advisory
 * lock held for the run); a run that finds the lock taken returns { skipped: true }.
 */
export async function resetSandbox(opts: { today?: string } = {}): Promise<SandboxResetResult> {
  const lock = await pool.connect();
  let locked = false;
  try {
    locked = (await lock.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [LOCK_KEY])).rows[0]?.ok === true;
    if (!locked) return { skipped: true, reason: 'A reset is already running.', sessionsEnded: 0, existed: true };
    const ended = await query<any[]>(
      `UPDATE user_sessions SET revoked_at = now(), revoked_by = 'sandbox reset', revoke_reason = 'Nightly sandbox reset'
        WHERE company_id = ? AND revoked_at IS NULL RETURNING id`,
      [SANDBOX_COMPANY_ID],
    );
    const del = await query<any[]>('DELETE FROM companies WHERE id = ? RETURNING id', [SANDBOX_COMPANY_ID]);
    const built = await buildSandbox(opts);
    return { ...built, sessionsEnded: ended.length, existed: del.length > 0 };
  } finally {
    if (locked) await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => undefined);
    lock.release();
  }
}

export const summariseReset = (r: SandboxResetResult): string => r.skipped
  ? `skipped: ${r.reason}`
  : `${r.existed ? 'rebuilt' : 'built'} up to ${r.today}: ${r.teams} teams, ${r.people} people, ${r.rows} rows, ${r.forecasts} forecasts, `
    + `${r.recommendations} recommendations, ${r.sessionsEnded} sessions ended, ${Math.round((r.durationMs ?? 0) / 1000)} s`;

/** The reset as a recorded job (job_runs). */
export function runSandboxReset(job: 'sandbox-reset' | 'sandbox-reset-background' = 'sandbox-reset'): Promise<SandboxResetResult> {
  return withJobRun(job, () => resetSandbox(), summariseReset);
}

/* ------------------------------------------------------------------------------------------
 * Background function (Netlify): the reset takes longer than a scheduled or API function may run
 * ---------------------------------------------------------------------------------------- */

export const SANDBOX_RESET_HEADER = 'x-sandbox-reset-token';
export const SANDBOX_RESET_PATH = '/.netlify/functions/sandbox-reset-background';

export function sandboxResetEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.SANDBOX_RESET_ENABLED ?? '').trim().toLowerCase() !== 'false';
}

/** Token of the call to the background function: an HMAC of a fixed label (DEMO_REFRESH_SECRET, else JWT_SECRET). */
export function sandboxResetToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.DEMO_REFRESH_SECRET || env.JWT_SECRET;
  return secret ? createHmac('sha256', secret).update('irongate-sandbox-reset-v1').digest('hex') : null;
}

export function isValidSandboxResetToken(received: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = sandboxResetToken(env);
  if (!expected || !received || received.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return diff === 0;
}

/** Start the reset: the background function on Netlify (202 at once), else in this process. Never throws. */
export async function startSandboxReset(opts: { behindNetlify?: boolean; reason?: string } = {}): Promise<{ ok: boolean; mode: 'background' | 'inline'; summary: string }> {
  if (opts.behindNetlify || runningOnNetlify()) {
    const started = new Date();
    const token = sandboxResetToken();
    const base = siteBaseUrl();
    if (!token || !base) {
      const summary = `not started: ${!token ? 'no DEMO_REFRESH_SECRET or JWT_SECRET' : 'site URL unknown'}`;
      await recordJobOutcome('sandbox-reset', false, `${summary}${opts.reason ? ` (${opts.reason})` : ''}`, started);
      return { ok: false, mode: 'background', summary };
    }
    try {
      const res = await fetch(`${base}${SANDBOX_RESET_PATH}`, { method: 'POST', headers: { [SANDBOX_RESET_HEADER]: token } });
      const summary = `background reset requested (${res.status})`;
      await recordJobOutcome('sandbox-reset', res.ok, `${summary}${opts.reason ? ` (${opts.reason})` : ''}`, started);
      return { ok: res.ok, mode: 'background', summary };
    } catch (e) {
      const err = e as { code?: string; name?: string };
      const summary = `could not start the background reset (${err?.code ?? err?.name ?? 'error'})`;
      await recordJobOutcome('sandbox-reset', false, summary, started);
      return { ok: false, mode: 'background', summary };
    }
  }
  void runSandboxReset().catch((e) => console.error(`[sandbox] reset failed: ${scrubMessage((e as Error)?.message)}`));
  return { ok: true, mode: 'inline', summary: 'reset started in this process' };
}

let lastAutoBuild = 0;
/**
 * The sandbox does not exist yet (a new database): start the first build, at most once every 20
 * minutes per process and only when no reset ran in the last 20 minutes. Never throws.
 */
export async function buildIfMissing(opts: { behindNetlify?: boolean } = {}): Promise<boolean> {
  try {
    if (!sandboxResetEnabled() || Date.now() - lastAutoBuild < 20 * 60_000) return false;
    const exists = await queryOne<any>('SELECT 1 AS x FROM companies WHERE id = ?', [SANDBOX_COMPANY_ID]);
    if (exists) return false;
    const recent = await queryOne<any>(
      `SELECT 1 AS x FROM job_runs WHERE job IN ('sandbox-reset', 'sandbox-reset-background') AND started_at > now() - interval '20 minutes' LIMIT 1`,
    );
    if (recent) return false;
    lastAutoBuild = Date.now();
    await startSandboxReset({ behindNetlify: opts.behindNetlify, reason: 'first build' });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------------------------
 * Sessions
 * ---------------------------------------------------------------------------------------- */

export class SandboxError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
}

/** A keyed hash of the client address (the only trace of the visitor in the session row). */
export function addressKey(req: express.Request): string {
  const ip = clientIp(req) || 'unknown';
  return `sbx:${createHmac('sha256', `${JWT_SECRET}:sandbox-address`).update(ip).digest('hex').slice(0, 56)}`;
}

/**
 * Sign the visitor in as a persona (POST /api/auth/sandbox). Checks, in order: the sandbox is ready,
 * the per-address hourly limit, the cap on open sandbox sessions. Sets the session cookie.
 */
export async function startSandboxSession(req: express.Request, res: express.Response, persona: SandboxPersonaKey): Promise<{ userId: string; expiresAt: string }> {
  if (!(await sandboxReady())) {
    void buildIfMissing({ behindNetlify: !!req.app?.locals?.behindNetlify });
    throw new SandboxError(503, 'sandbox_preparing', 'The demo is being prepared. Try again in a few minutes.', 120);
  }
  const key = addressKey(req);
  const perHour = sandboxSessionsPerIpHour();
  const recent = await queryOne<any>(
    `SELECT count(*)::int AS n, min(issued_at) AS first FROM user_sessions
      WHERE company_id = ? AND method = 'sandbox' AND ip = ? AND issued_at > now() - interval '1 hour'`,
    [SANDBOX_COMPANY_ID, key],
  );
  if ((recent?.n ?? 0) >= perHour) {
    const wait = recent?.first ? Math.max(60, Math.ceil((new Date(recent.first).getTime() + 3600_000 - Date.now()) / 1000)) : 3600;
    throw new SandboxError(429, 'sandbox_rate_limited', 'Too many demo sessions from this address. Try again later.', wait);
  }
  const open = await queryOne<any>(
    `SELECT count(*)::int AS n FROM user_sessions WHERE company_id = ? AND revoked_at IS NULL AND expires_at > now()`,
    [SANDBOX_COMPANY_ID],
  );
  if ((open?.n ?? 0) >= sandboxMaxSessions()) {
    throw new SandboxError(503, 'sandbox_full', 'The demo is busy right now. Try again in a few minutes.', 300);
  }
  const userId = SANDBOX_PERSONAS[persona].userId;
  const sessionId = randomUUID();
  const rows = await query<any[]>(
    `INSERT INTO user_sessions (id, user_id, company_id, method, issued_at, expires_at, persistent, last_seen_at, ip, last_ip)
     SELECT ?, u.id, u.company_id, 'sandbox', now(), now() + make_interval(hours => ?), FALSE, now(), ?, ?
       FROM users u WHERE u.id = ? AND u.company_id = ? AND u.is_active
     RETURNING expires_at`,
    [sessionId, SANDBOX_SESSION_HOURS, key, key, userId, SANDBOX_COMPANY_ID],
  );
  if (!rows.length) throw new SandboxError(503, 'sandbox_preparing', 'The demo is being prepared. Try again in a few minutes.', 120);
  const token = jwt.sign({ userId, p: false, sbx: 1 }, JWT_SECRET, { expiresIn: SANDBOX_SESSION_HOURS * 3600, jwtid: sessionId });
  // A browser-session cookie (gone when the browser closes); the token and its row end after two hours.
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  return { userId, expiresAt: new Date(rows[0].expires_at).toISOString() };
}
