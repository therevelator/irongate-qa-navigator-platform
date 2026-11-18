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
import { pool } from '../../src/lib/db';
import {
  buildDemoDataset, buildFillDataset, renderScript, CLEAR_STATEMENTS, ALL_TABLES, demoRowCondition, demoSummary, todayUtc,
  teamDefFor, demoDevelopersFor, GROUP_CHECK, realDataExists, KPI_COLUMNS, DEMO_INT_ID_MIN,
  DEMO_COMPANY_ID, DemoSummary, Dataset, CompanyInput, TeamCtx, Group, Member,
} from './demoData';

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

/** Run a dataset in one transaction (advisory-locked) and report the demo rows it added. */
async function apply(ds: Dataset): Promise<SeedRunResult> {
  const started = Date.now();
  const statements = renderScript(ds);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Two seeds against the same database (CLI + app) wait for each other.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('irongate-demo-seed'))");
    const before = await demoCounts(client);
    for (const s of statements) await client.query(s.sql);
    const after = await demoCounts(client);
    await client.query('COMMIT');
    const inserted: Record<string, number> = {};
    for (const t of ALL_TABLES) if (after[t] - before[t]) inserted[t] = after[t] - before[t];
    return { inserted, insertedTotal: Object.values(inserted).reduce((a, b) => a + b, 0), durationMs: Date.now() - started };
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
    return { ...demoSummary(today), ...r };
  });
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
export async function planFillExisting(db: pg.Pool | pg.PoolClient, opts: { today: string; companyIds?: string[] }): Promise<CompanyInput[]> {
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
  const members = await q<{ team_id: string; id: string; first_name: string; last_name: string; role: Member['role']; developer_insights_enabled: boolean }>(
    `SELECT DISTINCT t.id AS team_id, u.id, u.first_name, u.last_name, u.role, u.developer_insights_enabled
       FROM teams t JOIN users u ON u.primary_team_id = t.id
         OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = u.id AND tm.team_id = t.id)
      WHERE t.id = ANY($1::text[]) AND u.is_active = TRUE AND u.id NOT LIKE 'demo-%'
      ORDER BY t.id, u.id`,
    [teamIds]
  );
  const taken = new Set((await q<{ e: string }>(`SELECT lower(email) AS e FROM users WHERE id NOT LIKE 'demo-%'`)).map(r => r.e));

  const has: Partial<Record<Group, Set<string>>> = {};
  for (const group of Object.keys(GROUP_CHECK) as Array<Exclude<Group, 'base'>>) {
    const rows = await q<{ id: string }>(
      `SELECT t.id FROM teams t WHERE t.id = ANY($1::text[]) AND ${realDataExists(group, 't.id', '$2')}`,
      GROUP_CHECK[group].recent ? [teamIds, opts.today] : [teamIds]
    );
    has[group] = new Set(rows.map(r => r.id));
  }
  const devsWithSnapshots = new Set((await q<{ d: string }>(
    `SELECT DISTINCT developer_id AS d FROM developer_productivity_snapshots WHERE id < ${DEMO_INT_ID_MIN}`
  )).map(r => r.d));

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

  return companies.map(c => {
    const ctxs: TeamCtx[] = teams.filter(t => t.company_id === c.id).map(t => {
      const groups = new Set<Group>((Object.keys(GROUP_CHECK) as Group[]).filter(g => !has[g as Exclude<Group, 'base'>]!.has(t.id)));
      const existing: Member[] = members.filter(m => m.team_id === t.id).map(m => ({
        id: m.id, first: m.first_name, last: m.last_name, role: m.role, insights: !!m.developer_insights_enabled,
      }));
      const engineers = existing.filter(m => m.role === 'qa_engineer').length;
      const extra = groups.size ? demoDevelopersFor({ id: t.id, departmentId: t.department_id }, c.domain, engineers, taken) : [];
      return {
        ...teamDefFor(t), companyId: c.id, deptId: t.department_id, members: [...existing, ...extra], guarded: true,
        groups, realKpi: realKpi.get(t.id), devsWithSnapshots,
      };
    });
    const debt = realDebt.filter(d => d.company_id === c.id)
      .map(d => ({ severity: d.status === 'resolved' || d.status === 'wont_fix' ? 'low' : d.severity, created: toDay(d.created)!, resolved: d.status === 'resolved' || d.status === 'wont_fix' ? (toDay(d.resolved) ?? toDay(d.created)) : null }));
    const happiness = realHappiness.filter(h => h.company_id === c.id && has.dev!.has(h.team_id)).map(h => Number(h.h));
    return { id: c.id, isDemo: false, teams: ctxs, teamCount: ctxs.length, realDebt: debt, extraHappiness: happiness };
  });
}

/** Build the fill dataset for existing companies (reads the current state from `db`). */
export async function buildFill(db: pg.Pool | pg.PoolClient, opts: { today?: string; companyIds?: string[] } = {}) {
  const today = opts.today ?? todayUtc();
  const plan = await planFillExisting(db, { today, companyIds: opts.companyIds });
  return { today, plan, ds: buildFillDataset(plan, { today }) };
}

const planSummary = (plan: CompanyInput[]) =>
  plan.map(c => ({ id: c.id, teams: c.teams.length, teamsFilled: c.teams.filter(t => (t.groups?.size ?? 0) > 0).length }));

export function runFillExisting(opts: { today?: string; companyIds?: string[] } = {}): Promise<FillResult> {
  return exclusive(async () => {
    const { today, plan, ds } = await buildFill(pool, opts);
    const r = await apply(ds);
    return { today, companies: planSummary(plan), ...r };
  });
}

export { planSummary };

/** Delete every demo row (FK-safe order, one transaction). Returns rows affected per statement. */
export function clearDemoData(): Promise<Record<string, number>> {
  return exclusive(async () => {
    const deleted: Record<string, number> = {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('irongate-demo-seed'))");
      for (const s of CLEAR_STATEMENTS) {
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
