/**
 * Demo (sample) data seed: writes the datasets from demoData.ts into the database.
 *
 * Additive and idempotent: one transaction of INSERT … ON CONFLICT DO NOTHING statements
 * (re-running adds nothing new on the same day). Existing non-demo rows are never updated
 * or deleted. clearDemoData() removes demo rows only.
 *
 *  - runDemoSeed():     the separate demo company (Northwind Payments).
 *  - runFillExisting(): existing companies' active teams that lack data get the same model,
 *                       per group of tables (a team that already has rows there is skipped).
 *
 * Used by `npm run seed:demo` (server/seeds/demoSeedCli.ts) and by
 * POST /api/analytics/seed-data (super_admin, ENABLE_SYNTHETIC_DATA=true).
 */
import type pg from 'pg';
import { isPublicEmailDomain } from '../../src/lib/emailDomains';
import { pool } from '../../src/lib/db';
import {
  buildDemoDataset, buildFillDataset, renderScript, CLEAR_STATEMENTS, ALL_TABLES, demoRowCondition, demoSummary, todayUtc,
  teamDefFor, demoDevelopersFor, TEAM_GROUPS, realDataExists, recentSnapshotSql, KPI_COLUMNS,
  DEMO_COMPANY_ID, DemoSummary, Dataset, CompanyInput, TeamCtx, Group, TeamGroup, Member, DEMO_LOGIN_EMAILS, type SampleShape,
} from './demoData';
import { sampleHealthSeries } from './demoData';
import { RAW_SAMPLE_CLEAR, SAMPLE_HEALTH_DAYS, computeSampleEvidence, rawSampleSqlForTeam } from './demoRaw';
import { WORK_SAMPLE_CLEAR, workSampleSqlForTeam } from './demoWork';
import { DEMO_ACTION_HISTORY_SQL } from './actionHistory';

export interface SeedRunResult {
  /** Demo rows added per table in this run (0 for rows that already existed). */
  inserted: Record<string, number>;
  insertedTotal: number;
  durationMs: number;
}
export type DemoSeedResult = DemoSummary & SeedRunResult;
export interface FillResult extends SeedRunResult {
  today: string;
  companies: Array<{ id: string; teams: number; teamsFilled: number }>;
}

let running: Promise<unknown> | null = null;

/** Serialise seed/clear runs inside one process (the HTTP route can be clicked twice). */
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  while (running) await running.catch(() => undefined);
  const p = fn();
  running = p;
  try { return await p; } finally { if (running === p) running = null; }
}

async function demoCounts(client: pg.PoolClient): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ALL_TABLES) {
    const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE ${demoRowCondition(t)}`);
    out[t] = r.rows[0].n;
  }
  return out;
}

export interface ApplyOptions {
  /**
   * false: skip the before/after count of demo rows in every table (two queries per table, slow on a
   * large or remote database); `inserted` then holds the rows this transaction inserted per table
   * (pg_stat_xact_user_tables, one query).
   */
  counts?: boolean;
  /** Called after each statement (statements done, total): progress of a long run. */
  onProgress?: (done: number, total: number) => void | Promise<void>;
  /** SQL run in the same transaction after the dataset (e.g. the showcase content layer). */
  after?: string[];
}

/** Run a dataset in one transaction (advisory-locked) and report the demo rows it added. */
async function apply(ds: Dataset, opts: ApplyOptions = {}): Promise<SeedRunResult & { statements: number }> {
  const started = Date.now();
  // Last: the status history of sample actions that have none yet (server/seeds/actionHistory.ts).
  const statements = [...renderScript(ds).map(r => r.sql), ...(opts.after ?? []), DEMO_ACTION_HISTORY_SQL];
  const counts = opts.counts !== false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Two seeds against the same database (CLI + app) wait for each other.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('irongate-demo-seed'))");
    const before = counts ? await demoCounts(client) : null;
    for (const [i, sql] of statements.entries()) {
      await client.query(sql);
      await opts.onProgress?.(i + 1, statements.length);
    }
    const inserted: Record<string, number> = {};
    if (!counts) {
      // The rows this transaction really inserted (guards and ON CONFLICT DO NOTHING skip some).
      for (const r of (await client.query(`SELECT relname, n_tup_ins::bigint AS n FROM pg_stat_xact_user_tables WHERE n_tup_ins > 0`)).rows) {
        inserted[r.relname] = Number(r.n);
      }
    }
    const after = counts ? await demoCounts(client) : null;
    await client.query('COMMIT');
    if (before && after) for (const t of ALL_TABLES) { if (after[t] - before[t]) inserted[t] = after[t] - before[t]; }
    return { inserted, insertedTotal: Object.values(inserted).reduce((a, b) => a + b, 0), durationMs: Date.now() - started, statements: statements.length };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export function runDemoSeed(opts: { today?: string } = {}): Promise<DemoSeedResult> {
  return exclusive(async () => {
    const today = opts.today ?? todayUtc();
    const r = await apply(buildDemoDataset({ today }));
    const raw = await addRawSampleData((await pool.query(`SELECT id FROM teams WHERE company_id = $1 AND is_active IS NOT FALSE`, [DEMO_COMPANY_ID])).rows.map((x) => x.id));
    return { ...demoSummary(today), ...r, insertedTotal: r.insertedTotal + raw };
  });
}

/**
 * Sample raw CI data (v2: test runs, coverage reports, pipeline runs, deployments with commits,
 * incidents; server/seeds/demoRaw.ts) for
 * teams with sample data, the last RAW_SAMPLE_DAYS days (only the missing days are added), and the
 * evidence calculated from it (never KPI values). A team with real raw data gets none. Returns the
 * rows added. Off with SAMPLE_RAW_DATA=false.
 */
export async function addRawSampleData(teamIds: string[], stories?: Record<string, Array<[number, number]>>): Promise<number> {
  if (process.env.SAMPLE_RAW_DATA === 'false' || !teamIds.length) return 0;
  const teams = (await pool.query(`SELECT id, company_id, name, platform FROM teams WHERE id = ANY($1::text[]) AND is_active IS NOT FALSE ORDER BY id`, [teamIds])).rows;
  const client = await pool.connect();
  let added = 0;
  try {
    for (const t of teams) {
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`raw-sample:${t.id}`]);
        const sql = rawSampleSqlForTeam({ id: t.id, companyId: t.company_id, name: t.name, health: sampleHealthSeries(t, SAMPLE_HEALTH_DAYS, stories) });
        for (const st of sql) added += (await client.query(st)).rowCount ?? 0;
        // v2 phase 3: a year of issues and static-analysis reports derived from the team's KPI history (server/seeds/demoWork.ts).
        for (const st of workSampleSqlForTeam({ id: t.id, companyId: t.company_id, name: t.name })) await client.query(st);
        await computeSampleEvidence(client, [t.id]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      }
    }
  } finally {
    client.release();
  }
  return added;
}

// ============================================================================
// Fill existing companies: read the current state (non-demo rows only) and plan
// ============================================================================

const toDay = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/**
 * Plan the fill for existing (non-demo) companies. Decisions use non-demo rows only, so a
 * second run produces the same plan (and the same deterministic ids). The rendered SQL
 * re-checks each decision at apply time.
 */
/**
 * Tables whose demo rows mark a team of an existing company as a sample-data team (one that
 * --fill-existing filled before). --refresh-dates only adds rows for such teams.
 */
const SAMPLE_MARKER_TABLES = [
  'kpi_snapshots', 'pipeline_runs', 'test_cases', 'flaky_tests', 'technical_debt', 'performance_metrics',
  'business_impact_quality_metrics', 'developer_metrics', 'sprint_velocity', 'team_analytics',
] as const;

/** Active non-demo teams that already hold demo (sample) rows, per company. */
export async function teamsWithSampleData(db: pg.Pool | pg.PoolClient, opts: { skipSuspended?: boolean } = {}): Promise<Map<string, string[]>> {
  const union = SAMPLE_MARKER_TABLES.map((t) => `SELECT team_id FROM ${t} WHERE id LIKE 'demo-%'`).join(' UNION ');
  // skipSuspended: the scheduled refresh leaves suspended organisations (companies.status) alone, and the
  // demo sandbox too (it is rebuilt with today's dates every night: server/lib/sandbox.ts).
  const suspended = opts.skipSuspended
    ? `AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = t.company_id AND c.status = 'suspended') AND t.company_id <> 'sandbox-demo'` : '';
  const rows = (await db.query(
    `SELECT t.company_id, t.id FROM teams t
      WHERE t.is_active = TRUE AND t.id NOT LIKE 'demo-%' AND t.id IN (${union}) ${suspended}
      ORDER BY t.company_id, t.id`
  )).rows as Array<{ company_id: string; id: string }>;
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.company_id, [...(out.get(r.company_id) ?? []), r.id]);
  return out;
}

/**
 * The e-mail domain of the sample developers added to an existing company: the company's own domain,
 * except for a public e-mail domain (gmail.com, …), where addresses such as first.last@gmail.com
 * could belong to real people (and single sign-on matches an account by its verified address). There
 * they get an address on a reserved domain that can never receive e-mail.
 */
export function sampleEmailDomain(c: { id: string; domain: string | null }): string {
  const domain = (c.domain ?? '').trim().toLowerCase();
  if (domain && !isPublicEmailDomain(domain)) return domain;
  return `sample-${c.id.toLowerCase().replace(/[^a-z0-9-]/g, '-')}.invalid`;
}

export async function planFillExisting(
  db: pg.Pool | pg.PoolClient,
  opts: { today: string; companyIds?: string[]; onlyTeamIds?: string[]; noNewPeople?: boolean },
): Promise<CompanyInput[]> {
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[];
  const companies = await q<{ id: string; domain: string }>(
    `SELECT id, domain FROM companies WHERE id NOT LIKE 'demo-%' AND is_active IS NOT FALSE
       AND ($1::text[] IS NULL OR id = ANY($1::text[])) ORDER BY id`,
    [opts.companyIds?.length ? opts.companyIds : null]
  );
  if (!companies.length) return [];
  const companyIds = companies.map(c => c.id);
  const teams = await q<{ id: string; name: string; platform: string | null; description: string | null; department_id: string; company_id: string }>(
    `SELECT id, name, platform, description, department_id, company_id FROM teams
      WHERE is_active = TRUE AND id NOT LIKE 'demo-%' AND company_id = ANY($1::text[]) ORDER BY company_id, id`,
    [companyIds]
  );
  const teamIds = teams.map(t => t.id);
  const members = await q<{ team_id: string; id: string; first_name: string; last_name: string; role: Member['role']; developer_insights_enabled: boolean; since: string; pulse: boolean }>(
    `SELECT DISTINCT t.id AS team_id, u.id, u.first_name, u.last_name, u.role, u.developer_insights_enabled, to_char(u.created_at, 'YYYY-MM-DD') AS since,
            (u.role <> 'viewer' OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = u.id AND tm.team_id = t.id)) AS pulse
       FROM teams t JOIN users u ON u.primary_team_id = t.id
         OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = u.id AND tm.team_id = t.id)
      WHERE t.id = ANY($1::text[]) AND u.is_active = TRUE AND u.id NOT LIKE 'demo-%'
      ORDER BY t.id, u.id`,
    [teamIds]
  );
  // email -> user id, for every user (demo developers keep their own email on a re-run).
  const taken = new Map((await q<{ e: string; id: string }>(`SELECT lower(email) AS e, id FROM users`)).map(r => [r.e, r.id] as [string, string]));

  const has: Partial<Record<TeamGroup, Set<string>>> = {};
  for (const group of TEAM_GROUPS) {
    const rows = await q<{ id: string }>(
      `SELECT t.id FROM teams t WHERE t.id = ANY($1::text[]) AND $2::date IS NOT NULL AND ${realDataExists(group, 't.id', '$2')}`,
      [teamIds, opts.today]
    );
    has[group] = new Set(rows.map(r => r.id));
  }
  // Developers with a recent real productivity snapshot, and existing (team, developer) metrics.
  const devsWithSnapshots = new Set((await q<{ d: string }>(
    `SELECT u.id AS d FROM users u WHERE u.id NOT LIKE 'demo-%' AND ${recentSnapshotSql('u.id', '$1')}`, [opts.today]
  )).map(r => r.d));
  const metricPairs = await q<{ team_id: string; developer_id: string }>(
    `SELECT team_id, developer_id FROM developer_metrics WHERE team_id = ANY($1::text[]) AND id NOT LIKE 'demo-%'`, [teamIds]
  );

  // Real KPI rows of teams that keep their KPI history (company snapshots use them).
  const keepKpi = teamIds.filter(id => has.kpi!.has(id));
  const realKpi = new Map<string, Map<string, Record<string, number | null>>>();
  if (keepKpi.length) {
    const rows = await q<Record<string, string | null> & { team_id: string; d: string }>(
      `SELECT team_id, to_char(snapshot_date, 'YYYY-MM-DD') AS d, ${KPI_COLUMNS.join(', ')} FROM kpi_snapshots
        WHERE team_id = ANY($1::text[]) AND id NOT LIKE 'demo-%' AND snapshot_date >= $2::date - 400 ORDER BY snapshot_date`,
      [keepKpi, opts.today]
    );
    for (const r of rows) {
      const m = realKpi.get(r.team_id) ?? new Map();
      const row: Record<string, number | null> = {};
      for (const c of KPI_COLUMNS) row[c] = r[c] == null ? null : Number(r[c]);
      m.set(r.d, row);
      realKpi.set(r.team_id, m);
    }
  }
  const realDebt = await q<{ company_id: string; severity: string; status: string; created: string; resolved: string | null }>(
    `SELECT t.company_id, td.severity, td.status, to_char(td.created_at, 'YYYY-MM-DD') AS created, to_char(td.resolved_at, 'YYYY-MM-DD') AS resolved
       FROM technical_debt td JOIN teams t ON t.id = td.team_id
      WHERE t.company_id = ANY($1::text[]) AND t.is_active = TRUE AND td.id NOT LIKE 'demo-%'`,
    [companyIds]
  );
  const realHappiness = await q<{ company_id: string; team_id: string; h: string }>(
    `SELECT t.company_id, dm.team_id, dm.happiness_score AS h FROM developer_metrics dm JOIN teams t ON t.id = dm.team_id
      WHERE t.company_id = ANY($1::text[]) AND t.is_active = TRUE AND dm.id NOT LIKE 'demo-%' AND dm.happiness_score IS NOT NULL`,
    [companyIds]
  );

  // Demo logins with no team (no active team assignment and no existing primary team): each gets
  // a demo assignment on the largest active team of their department (else of the company).
  const teamless = await q<{ id: string; company_id: string; role: string; department_id: string | null }>(
    `SELECT u.id, u.company_id, u.role, u.department_id FROM users u
      WHERE lower(u.email) = ANY($1::text[]) AND u.is_active AND u.company_id = ANY($2::text[]) AND u.id NOT LIKE 'demo-%'
        AND NOT EXISTS (SELECT 1 FROM role_assignments ra JOIN teams t ON t.id = ra.scope_id AND t.is_active
                         WHERE ra.user_id = u.id AND ra.scope_type = 'team' AND ra.revoked_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = u.primary_team_id AND t.is_active)
      ORDER BY u.id`,
    [DEMO_LOGIN_EMAILS, companyIds]
  );
  const teamSize = new Map((await q<{ id: string; n: number; has_lead: boolean }>(
    `SELECT t.id, (SELECT count(*)::int FROM role_assignments ra WHERE ra.scope_type = 'team' AND ra.scope_id = t.id AND ra.revoked_at IS NULL) AS n,
            EXISTS (SELECT 1 FROM role_assignments ra WHERE ra.scope_type = 'team' AND ra.scope_id = t.id AND ra.role = 'team_lead' AND ra.revoked_at IS NULL) AS has_lead
       FROM teams t WHERE t.id = ANY($1::text[])`, [teamIds]
  )).map(r => [r.id, r] as [string, { id: string; n: number; has_lead: boolean }]));
  const pickTeam = (companyId: string, departmentId: string | null) => {
    const pool = teams.filter(t => t.company_id === companyId);
    const inDept = pool.filter(t => t.department_id === departmentId);
    const list = (inDept.length ? inDept : pool).slice().sort((a, b) =>
      (teamSize.get(b.id)?.n ?? 0) - (teamSize.get(a.id)?.n ?? 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return list[0] ?? null;
  };
  const loginRole = (role: string, teamId: string) =>
    role === 'viewer' || role === 'qa_engineer' ? role
      : role === 'team_lead' ? (teamSize.get(teamId)?.has_lead ? 'qa_engineer' : 'team_lead')
      : 'viewer'; // super_admin / qa_manager keep their wider role; the team assignment gives them a home team

  return companies.map(c => {
    const teamlessLogins = teamless.filter(u => u.company_id === c.id).flatMap(u => {
      const t = pickTeam(c.id, u.department_id);
      return t ? [{ userId: u.id, teamId: t.id, role: loginRole(u.role, t.id) }] : [];
    });
    const ctxs: TeamCtx[] = teams.filter(t => t.company_id === c.id).map(t => {
      const groups = new Set<Group>(TEAM_GROUPS.filter(g => !has[g]!.has(t.id)));
      const existing: Member[] = members.filter(m => m.team_id === t.id).map(m => ({
        id: m.id, first: m.first_name, last: m.last_name, role: m.role, insights: !!m.developer_insights_enabled, since: m.since ?? undefined, pulse: m.pulse,
      }));
      const isDev = (m: Member) => m.role === 'qa_engineer' || m.role === 'team_lead';
      const engineers = existing.filter(m => m.role === 'qa_engineer').length;
      const sharing = existing.filter(m => isDev(m) && m.insights).length;
      // noNewPeople ("Populate metrics", "Demo Data"): only the team's own people.
      const extra = opts.noNewPeople ? [] : demoDevelopersFor({ id: t.id, departmentId: t.department_id }, sampleEmailDomain(c), engineers, taken, sharing);
      const all = [...existing, ...extra];
      const devsWithMetrics = new Set(metricPairs.filter(p => p.team_id === t.id).map(p => p.developer_id));
      if (all.some(m => isDev(m) && (!devsWithSnapshots.has(m.id) || !devsWithMetrics.has(m.id)))) groups.add('dev');
      // A team without a team lead or software engineer has nobody to attribute runs, tests and
      // sprints to: with noNewPeople it gets no sample data.
      if (opts.noNewPeople && !all.some(isDev)) groups.clear();
      return {
        ...teamDefFor(t), companyId: c.id, deptId: t.department_id, members: all, guarded: true,
        groups, realKpi: realKpi.get(t.id), devsWithSnapshots, devsWithMetrics,
      };
    });
    if (opts.onlyTeamIds) {
      // --refresh-dates: only teams that already hold sample data get new rows; no new demo
      // developers or assignments anywhere else.
      const only = new Set(opts.onlyTeamIds);
      for (const t of ctxs) if (!only.has(t.id)) { t.groups = new Set(); t.members = t.members.filter(m => !m.id.startsWith('demo-')); }
    }
    const debt = realDebt.filter(d => d.company_id === c.id)
      .map(d => ({ severity: d.status === 'resolved' || d.status === 'wont_fix' ? 'low' : d.severity, created: toDay(d.created)!, resolved: d.status === 'resolved' || d.status === 'wont_fix' ? (toDay(d.resolved) ?? toDay(d.created)) : null }));
    const devTeams = new Set(ctxs.filter(t => t.groups?.has('dev')).map(t => t.id));
    const happiness = realHappiness.filter(h => h.company_id === c.id && !devTeams.has(h.team_id)).map(h => Number(h.h));
    return { id: c.id, isDemo: false, teams: ctxs, teamCount: ctxs.length, realDebt: debt, extraHappiness: happiness, teamlessLogins: opts.onlyTeamIds ? [] : teamlessLogins };
  });
}

export interface FillOptions {
  today?: string; companyIds?: string[]; onlyTeamIds?: string[];
  /** Never add sample developers to a team (only its own people). */
  noNewPeople?: boolean;
  /** History lengths, stories, releases, pulse (demoData.ts SampleShape). */
  shape?: SampleShape;
}

/** Build the fill dataset for existing companies (reads the current state from `db`). */
export async function buildFill(db: pg.Pool | pg.PoolClient, opts: FillOptions = {}) {
  const today = opts.today ?? todayUtc();
  const plan = await planFillExisting(db, { today, companyIds: opts.companyIds, onlyTeamIds: opts.onlyTeamIds, noNewPeople: opts.noNewPeople });
  return { today, plan, ds: buildFillDataset(plan, { today, shape: opts.shape }) };
}

const planSummary = (plan: CompanyInput[]) =>
  plan.map(c => ({ id: c.id, teams: c.teams.length, teamsFilled: c.teams.filter(t => (t.groups?.size ?? 0) > 0).length }));

export function runFillExisting(opts: FillOptions & ApplyOptions & { afterPlan?: (plan: CompanyInput[]) => string[] } = {}): Promise<FillResult & { plan: CompanyInput[]; statements: number }> {
  return exclusive(async () => {
    const { today, plan, ds } = await buildFill(pool, opts);
    const r = await apply(ds, { counts: opts.counts, onProgress: opts.onProgress, after: opts.afterPlan?.(plan) ?? opts.after });
    // Sample raw CI data for the teams that hold sample data now (filled teams of these companies).
    const sample = await teamsWithSampleData(pool);
    const only = opts.onlyTeamIds ? new Set(opts.onlyTeamIds) : null;
    const teamIds = plan.flatMap((c) => sample.get(c.id) ?? []).filter((id) => !only || only.has(id));
    const raw = await addRawSampleData(teamIds, opts.shape?.stories);
    return { today, companies: planSummary(plan), plan, ...r, insertedTotal: r.insertedTotal + raw };
  });
}

export { planSummary };

export interface RefreshResult {
  today: string;
  demoCompany: { refreshed: boolean; insertedTotal: number };
  companies: Array<{ id: string; teams: number; teamsFilled: number }>;
  insertedTotal: number;
}

/**
 * --refresh-dates: keep hosted demo data current. Adds the missing recent days of sample data
 * (history up to `today`) for the demo company, if it exists, and for the teams of existing
 * companies that already hold sample (demo-) rows. Never changes or deletes a row, never adds
 * sample data to a team without any, and leaves every group with real data alone (as
 * --fill-existing). Idempotent: a second run on the same day adds nothing.
 */
export async function runRefreshDates(opts: { today?: string } = {}): Promise<RefreshResult> {
  const today = opts.today ?? todayUtc();
  // A suspended organisation (companies.status) is skipped, the demo company included.
  const demoSuspended = (await pool.query(`SELECT 1 FROM companies WHERE id = $1 AND status = 'suspended'`, [DEMO_COMPANY_ID])).rowCount;
  const demo = !demoSuspended && (await isDemoSeeded()) ? await runDemoSeed({ today }) : null;
  const sample = await teamsWithSampleData(pool, { skipSuspended: true });
  const companyIds = [...sample.keys()];
  const fill = companyIds.length
    ? await runFillExisting({ today, companyIds, onlyTeamIds: [...sample.values()].flat() })
    : null;
  return {
    today,
    demoCompany: { refreshed: !!demo, insertedTotal: demo?.insertedTotal ?? 0 },
    companies: fill?.companies ?? [],
    insertedTotal: (demo?.insertedTotal ?? 0) + (fill?.insertedTotal ?? 0),
  };
}

/** Delete every demo row (FK-safe order, one transaction). Returns rows affected per statement. */
export function clearDemoData(): Promise<Record<string, number>> {
  return exclusive(async () => {
    const deleted: Record<string, number> = {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('irongate-demo-seed'))");
      for (const s of [...WORK_SAMPLE_CLEAR, ...RAW_SAMPLE_CLEAR, ...CLEAR_STATEMENTS]) {
        const r = await client.query(s.sql);
        deleted[s.table] = r.rowCount ?? 0;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    return deleted;
  });
}

/** Per-table row counts: all rows, and demo rows. */
export async function tableCounts(): Promise<Array<{ table: string; total: number; demo: number }>> {
  const out: Array<{ table: string; total: number; demo: number }> = [];
  for (const table of ALL_TABLES) {
    const r = await pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ${demoRowCondition(table)})::int AS demo FROM ${table}`);
    out.push({ table, total: r.rows[0].total, demo: r.rows[0].demo });
  }
  return out;
}

/** Whether the demo company exists (for the admin panel). */
export async function isDemoSeeded(): Promise<boolean> {
  const r = await pool.query('SELECT 1 FROM companies WHERE id = $1', [DEMO_COMPANY_ID]);
  return (r.rowCount ?? 0) > 0;
}

/** Active teams of a company that still lack data in at least one group (admin panel). */
export async function teamsLackingData(companyId: string): Promise<{ teams: number; lacking: number }> {
  const plan = await planFillExisting(pool, { today: todayUtc(), companyIds: [companyId] });
  const c = plan[0];
  return { teams: c?.teams.length ?? 0, lacking: c ? c.teams.filter(t => (t.groups?.size ?? 0) > 0).length : 0 };
}
