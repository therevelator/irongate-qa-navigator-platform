/**
 * Platform operator panel: "Demo Data" and "Populate metrics" for one company.
 *
 *   Demo Data (createDemoOrg + a job): departments, Scrum teams and people (server/seeds/demoOrg.ts)
 *     are created at once, in one transaction, with one shared generated password (bcrypt hash only;
 *     the plain password is returned once, to the operator's modal). The company's sample-data notice
 *     is hidden. A job then fills ONE YEAR of sample data for every module of the new teams.
 *   Populate metrics (a job): one year of sample data for every team of the company that lacks data
 *     in some module, without creating anyone (a team without a team lead or engineer is skipped).
 *
 * The year of data is the sample model of the demo seed (server/seeds/demoData.ts, runFillExisting
 * in demoSeed.ts) with a year-long shape, the teams' stories (strong, struggling, improving,
 * recovering, declining), releases at sprint ends and a pulse every two weeks; then the Scrum content
 * layer (retro actions, alert history, API key and ingestion log, onboarding, targets). Every data
 * row is a sample row ('demo-' id), so the nightly refresh keeps these teams current and "Remove
 * sample data" removes it. Only this company's rows are written.
 *
 * Jobs (demo_data_jobs): on Netlify the API answers 202 and starts the background function
 * demo-data-background (15 minutes; a sync function stops after ~26 s) with a signed token (an HMAC
 * of the job id with DEMO_REFRESH_SECRET, else JWT_SECRET); elsewhere the job runs in this process.
 * The panel polls the job. Every statement is a multi-row INSERT or a server-side INSERT … SELECT:
 * 3 × 3 × 8 with a year of data is about 370 round trips and 193 000 rows (measured: ~12 s locally,
 * ~60 s at 150 ms per round trip), well within the background function's 15 minutes.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import bcrypt from 'bcrypt';
import type pg from 'pg';
import { pool, query, queryOne } from '../../src/lib/db';
import { isPublicEmailDomain } from '../../src/lib/emailDomains';
import { recordJobOutcome, scrubMessage } from './opsLog';
import { runningOnNetlify, siteBaseUrl } from './demoRefreshJob';
import {
  planOrg, sampleLogins, generateDemoPassword, demoEmailDomain, showcaseContentSql, storyFor, SIZE_LIMITS, type DemoSize, type OrgPlan,
} from '../seeds/demoOrg';
import type { SampleShape } from '../seeds/demoData';

export const DEMO_DATA_HEADER = 'x-demo-data-token';
export const DEMO_DATA_PATH = '/.netlify/functions/demo-data-background';
/** A job with no progress for this long is reported as failed (the background function stops at 15 minutes). */
export const STALE_MINUTES = 16;

/** One year of every module (the demo seed's defaults are shorter). */
export const YEAR_SHAPE: Omit<SampleShape, 'stories'> = {
  historyDays: 365, eventDays: 365, perfDays: 365, devDays: 365, pulseWeeks: 52,
  sprintReleases: true, pulseCadence: 'biweekly', pulseMailMembers: true,
};

export class DemoDataError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/* ------------------------------------------------------------------------------------------
 * Input
 * ---------------------------------------------------------------------------------------- */

export function parseDemoSize(b: any): DemoSize {
  const n = (v: unknown, [lo, hi]: readonly [number, number], label: string) => {
    const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    if (!Number.isInteger(x) || x < lo || x > hi) throw new DemoDataError(400, `${label}: a whole number from ${lo} to ${hi}.`);
    return x;
  };
  return {
    departments: n(b?.departments, SIZE_LIMITS.departments, 'Departments'),
    teamsPerDepartment: n(b?.teamsPerDepartment, SIZE_LIMITS.teamsPerDepartment, 'Teams per department'),
    membersPerTeam: n(b?.membersPerTeam, SIZE_LIMITS.membersPerTeam, 'Members per team'),
  };
}

/* ------------------------------------------------------------------------------------------
 * Jobs
 * ---------------------------------------------------------------------------------------- */

export interface DemoJob {
  id: string; companyId: string; kind: 'generate' | 'populate'; status: 'queued' | 'running' | 'done' | 'failed';
  step: string | null; done: number; total: number; result: any; error: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
}

const jobOf = (r: any): DemoJob => ({
  id: r.id, companyId: r.company_id, kind: r.kind, status: r.status, step: r.step, done: r.done, total: r.total, result: r.result, error: r.error,
  createdAt: new Date(r.created_at).toISOString(), startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
  finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
});

/** Jobs that stopped reporting (a background function that was stopped) are marked failed. */
async function failStale(db: { query: (sql: string, p?: any[]) => Promise<any> }, companyId: string): Promise<void> {
  await db.query(
    `UPDATE demo_data_jobs SET status = 'failed', error = 'The job stopped without finishing (no progress for ${STALE_MINUTES} minutes). Run it again: it only adds what is missing.',
            finished_at = now(), updated_at = now()
      WHERE company_id = $1 AND status IN ('queued', 'running') AND updated_at < now() - interval '${STALE_MINUTES} minutes'`,
    [companyId],
  );
}

export async function getDemoJob(companyId: string, jobId: string): Promise<DemoJob | null> {
  await failStale(pool, companyId);
  const r = await queryOne<any>('SELECT * FROM demo_data_jobs WHERE id = ? AND company_id = ?', [jobId, companyId]);
  return r ? jobOf(r) : null;
}

export async function latestDemoJob(companyId: string): Promise<DemoJob | null> {
  await failStale(pool, companyId);
  const r = await queryOne<any>('SELECT * FROM demo_data_jobs WHERE company_id = ? ORDER BY created_at DESC LIMIT 1', [companyId]);
  return r ? jobOf(r) : null;
}

async function insertJob(client: pg.PoolClient, companyId: string, kind: 'generate' | 'populate', params: object): Promise<string> {
  await failStale(client, companyId);
  try {
    const r = await client.query(
      `INSERT INTO demo_data_jobs (company_id, kind, params, step) VALUES ($1, $2, $3, 'Waiting to start') RETURNING id`,
      [companyId, kind, JSON.stringify(params)],
    );
    return r.rows[0].id;
  } catch (e) {
    if ((e as any)?.code === '23505') throw new DemoDataError(409, 'Sample data is already being generated for this company. Wait until it has finished.');
    throw e;
  }
}

/* ------------------------------------------------------------------------------------------
 * Demo Data: the organisation (synchronous, one transaction)
 * ---------------------------------------------------------------------------------------- */

export interface CreatedOrg {
  jobId: string;
  password: string;
  domain: string;
  logins: ReturnType<typeof sampleLogins>;
  departments: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string; department: string; story: string }>;
  people: number;
}

const multiInsert = async (client: pg.PoolClient, table: string, cols: string[], rows: unknown[][]) => {
  if (!rows.length) return;
  // One statement per table: unnest over one array per column (a single round trip at any size).
  const casts = cols.map((c) => c.split('::')[1] ?? 'text');
  const names = cols.map((c) => c.split('::')[0]);
  const params = names.map((_, i) => rows.map((r) => r[i]));
  await client.query(
    `INSERT INTO ${table} (${names.join(', ')}) SELECT * FROM unnest(${casts.map((t, i) => `$${i + 1}::${t}[]`).join(', ')})`,
    params,
  );
};

/** Create the departments, teams and people, hide the sample-data notice, and queue the data job. */
export async function createDemoOrg(companyId: string, size: DemoSize): Promise<CreatedOrg> {
  const password = generateDemoPassword();
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Two runs for the same company wait for each other (names are checked inside the lock).
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`demo-org:${companyId}`]);
    const company = (await client.query(`SELECT id, name, domain, email_domain_public FROM companies WHERE id = $1 FOR UPDATE`, [companyId])).rows[0];
    if (!company) throw new DemoDataError(404, 'Company not found');
    // A public e-mail domain (gmail.com …) is never used: first.last@<company-slug>.example instead.
    const domain = demoEmailDomain(company, (d) => company.email_domain_public === true || isPublicEmailDomain(d));
    const names = async (sql: string, p: unknown[]) => new Set<string>((await client.query(sql, p)).rows.map((r: any) => String(r.n).toLowerCase()));
    const takenDepts = await names('SELECT name AS n FROM departments WHERE company_id = $1', [companyId]);
    const takenTeams = await names('SELECT name AS n FROM teams WHERE company_id = $1', [companyId]);
    const takenEmails = await names(`SELECT lower(email) AS n FROM users WHERE lower(email) LIKE $1 UNION SELECT lower(email) FROM platform_operators WHERE lower(email) LIKE $1`, [`%@${domain}`]);
    const plan = planOrg(size, { domain, takenDepts, takenTeams, takenEmails, newId: () => randomUUID() });
    const jobId = await insertJob(client, companyId, 'generate', { size, teamIds: plan.teams.map((t) => t.id) });
    await writeOrg(client, companyId, plan, hash);
    await client.query(
      `UPDATE companies SET settings = COALESCE(settings, '{}'::jsonb) || '{"hideSampleDataNotice": true}'::jsonb, updated_at = now() WHERE id = $1`,
      [companyId],
    );
    await client.query('COMMIT');
    const deptName = new Map(plan.departments.map((d) => [d.id, d.name]));
    return {
      jobId, password, domain, logins: sampleLogins(plan),
      departments: plan.departments.map((d) => ({ id: d.id, name: d.name })),
      teams: plan.teams.map((t) => ({ id: t.id, name: t.name, department: deptName.get(t.departmentId)!, story: t.story })),
      people: plan.people.length,
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function writeOrg(client: pg.PoolClient, companyId: string, plan: OrgPlan, hash: string): Promise<void> {
  const ago = (days: number, hour = 9) => new Date(Date.now() - days * 86_400_000 - (Date.now() % 86_400_000) + hour * 3_600_000).toISOString();
  await multiInsert(client, 'departments', ['id', 'company_id', 'name', 'description', 'is_active::boolean', 'created_at::timestamptz', 'updated_at::timestamptz'],
    plan.departments.map((d) => [d.id, companyId, d.name, d.description, true, ago(400), ago(400)]));
  await multiInsert(client, 'teams',
    ['id', 'company_id', 'department_id', 'name', 'description', 'platform', 'is_active::boolean', 'ai_enabled::boolean', 'exclude_from_auto_sync::boolean', 'created_at::timestamptz', 'updated_at::timestamptz'],
    plan.teams.map((t) => [t.id, companyId, t.departmentId, t.name, t.description, t.platform, true, false, true, ago(390), ago(390)]));
  await multiInsert(client, 'users',
    ['id', 'email', 'password_hash', 'first_name', 'last_name', 'job_title', 'role', 'company_id', 'department_id', 'primary_team_id', 'timezone',
      'is_active::boolean', 'email_verified::boolean', 'email_verified_at::timestamptz', 'developer_insights_enabled::boolean', 'created_at::timestamptz', 'updated_at::timestamptz', 'last_login::timestamptz'],
    plan.people.map((p, i) => [p.id, p.email, hash, p.first, p.last, p.title, p.role, companyId, p.departmentId, p.teamId, p.tz,
      true, true, ago(p.joinedDaysAgo, 10), p.insights, ago(p.joinedDaysAgo), ago(p.joinedDaysAgo), ago(i % 6, 8 + (i % 9))]));
  await multiInsert(client, 'role_assignments', ['id', 'company_id', 'user_id', 'role', 'scope_type', 'scope_id', 'created_at::timestamptz'],
    plan.people.map((p) => [randomUUID(), companyId, p.id, p.role, p.teamId ? 'team' : 'department', p.teamId ?? p.departmentId, ago(p.joinedDaysAgo)]));
  // Team members: the people who work in the team (Product Owner, Scrum Master, developers).
  await multiInsert(client, 'team_members', ['user_id', 'team_id', 'role', 'joined_at::timestamptz'],
    plan.people.filter((p) => p.teamId).map((p) => [p.id, p.teamId, p.kind === 'scrum_master' ? 'lead' : 'member', ago(p.joinedDaysAgo)]));
  const leads = plan.people.filter((p) => p.kind === 'scrum_master');
  await client.query(`UPDATE teams t SET lead_id = v.u FROM unnest($1::text[], $2::text[]) AS v(t, u) WHERE t.id = v.t`,
    [leads.map((p) => p.teamId), leads.map((p) => p.id)]);
  const managers = plan.people.filter((p) => p.kind === 'manager');
  await client.query(`UPDATE departments d SET manager_id = v.u FROM unnest($1::text[], $2::text[]) AS v(d, u) WHERE d.id = v.d`,
    [managers.map((p) => p.departmentId), managers.map((p) => p.id)]);
}

/** Populate metrics: queue a job for every team of the company that lacks data. */
export async function queuePopulate(companyId: string): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = (await client.query('SELECT id FROM companies WHERE id = $1', [companyId])).rows[0];
    if (!c) throw new DemoDataError(404, 'Company not found');
    const jobId = await insertJob(client, companyId, 'populate', {});
    await client.query('COMMIT');
    return jobId;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------------------------------
 * Running a job
 * ---------------------------------------------------------------------------------------- */

const setJob = (id: string, fields: Record<string, unknown>) => {
  const keys = Object.keys(fields);
  return query(`UPDATE demo_data_jobs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = now() WHERE id = ?`, [...keys.map((k) => fields[k]), id]);
};

/**
 * Run a queued job (once: a second call for the same job does nothing). Never throws; the outcome is
 * in the job row and in job_runs ('demo-data').
 */
export async function runDemoJob(jobId: string): Promise<DemoJob | null> {
  const claimed = (await query<any[]>(
    `UPDATE demo_data_jobs SET status = 'running', started_at = now(), step = 'Planning', updated_at = now() WHERE id = ? AND status = 'queued' RETURNING *`,
    [jobId],
  ))[0];
  if (!claimed) return null;
  const started = new Date();
  const companyId: string = claimed.company_id;
  try {
    const { runFillExisting, teamsWithSampleData } = await import('../seeds/demoSeed');
    const generate = claimed.kind === 'generate';
    const teamIds: string[] | undefined = generate ? claimed.params?.teamIds ?? [] : undefined;
    // Teams that already hold sample rows are only topped up (to a year; nothing is duplicated).
    const hadSample = new Set((await teamsWithSampleData(pool)).get(companyId) ?? []);
    const all = (await query<any[]>('SELECT id FROM teams WHERE company_id = ? AND is_active', [companyId])).map((r: any) => r.id as string);
    const stories = Object.fromEntries((teamIds ?? all).map((id) => [id, storyFor(id)]));
    let last = 0;
    const r = await runFillExisting({
      // New people (Demo Data): developer history from the day they joined. Existing people (Populate
      // metrics) may have been added to the app only now, so their history covers the whole year.
      companyIds: [companyId], onlyTeamIds: teamIds, noNewPeople: true, shape: { ...YEAR_SHAPE, stories, respectJoinDates: generate }, counts: false,
      afterPlan: (plan) => {
        const filled = (plan[0]?.teams ?? []).filter((t) => t.groups?.has('kpi')).map((t) => t.id);
        return showcaseContentSql(companyId, filled);
      },
      onProgress: async (done, total) => {
        // At most one progress write every 2 seconds (each is a round trip), and the last one.
        if (done !== total && Date.now() - last < 2000) return;
        last = Date.now();
        await setJob(jobId, { step: 'Writing a year of data', done, total });
      },
    });
    const teams = r.plan[0]?.teams ?? [];
    const touched = teams.filter((t) => (t.groups?.size ?? 0) > 0);
    const filled = touched.filter((t) => !hadSample.has(t.id));
    const skipped = generate ? 0 : teams.filter((t) => !t.members.some((m) => m.role === 'team_lead' || m.role === 'qa_engineer')).length;
    const result = {
      teamsFilled: filled.length, teamsToppedUp: touched.length - filled.length, teamsSkippedNoPeople: skipped,
      rowsWritten: r.insertedTotal, statements: r.statements, durationMs: Date.now() - started.getTime(), today: r.today,
    };
    await setJob(jobId, { status: 'done', step: 'Done', finished_at: new Date().toISOString(), result: JSON.stringify(result) });
    await recordJobOutcome('demo-data', true, `${claimed.kind} ${companyId}: ${filled.length} teams, ${r.insertedTotal} rows, ${r.statements} statements in ${Math.round(result.durationMs / 1000)} s`, started);
  } catch (e) {
    const msg = scrubMessage((e as Error)?.message) ?? 'error';
    console.error(`[demo-data] job ${jobId} failed: ${msg}`);
    await setJob(jobId, { status: 'failed', step: 'Failed', finished_at: new Date().toISOString(), error: `Generating the data failed: ${msg}`.slice(0, 500) }).catch(() => undefined);
    await recordJobOutcome('demo-data', false, `${claimed.kind} ${companyId}: failed: ${msg}`, started);
  }
  return getDemoJob(companyId, jobId);
}

/* ------------------------------------------------------------------------------------------
 * Starting a job: background function on Netlify, this process elsewhere
 * ---------------------------------------------------------------------------------------- */

export function demoDataToken(jobId: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.DEMO_REFRESH_SECRET || env.JWT_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret).update(`irongate-demo-data-v1:${jobId}`).digest('hex');
}

export function isValidDemoDataToken(jobId: string, received: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = demoDataToken(jobId, env);
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Start the job: the background function on Netlify (it answers 202 at once), else in this process.
 * Never throws: a start that fails marks the job failed (with a clear error) and returns ok false.
 */
export async function startDemoJob(jobId: string, opts: { behindNetlify?: boolean } = {}): Promise<{ mode: 'background' | 'inline'; ok: boolean }> {
  if (opts.behindNetlify || runningOnNetlify()) {
    const fail = async (why: string) => {
      console.error(`[demo-data] job ${jobId}: ${why}`);
      await setJob(jobId, { status: 'failed', step: 'Failed', finished_at: new Date().toISOString(), error: `The background job could not be started (${why}). Run it again.` })
        .catch(() => undefined);
      await recordJobOutcome('demo-data', false, `job ${jobId}: not started (${why})`, new Date());
      return { mode: 'background' as const, ok: false };
    };
    const token = demoDataToken(jobId);
    const base = siteBaseUrl();
    if (!token || !base) return fail(!token ? 'no DEMO_REFRESH_SECRET or JWT_SECRET' : 'site URL unknown');
    try {
      const res = await fetch(`${base}${DEMO_DATA_PATH}`, { method: 'POST', headers: { [DEMO_DATA_HEADER]: token, 'content-type': 'application/json' }, body: JSON.stringify({ jobId }) });
      if (!res.ok) return fail(`status ${res.status}`);
    } catch (e) {
      const err = e as { code?: string; name?: string };
      return fail(err?.code ?? err?.name ?? 'error');
    }
    return { mode: 'background', ok: true };
  }
  void runDemoJob(jobId).catch((e) => console.error(`[demo-data] job ${jobId}: ${(e as Error)?.message}`));
  return { mode: 'inline', ok: true };
}
