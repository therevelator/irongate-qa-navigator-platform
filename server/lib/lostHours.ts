/**
 * Hours lost per week by cause, per team: reads the raw records a team's 12 weeks depend on, runs the shared
 * calculation (packages/engine/src/calc/lostHours.ts) and keeps the result (lost_hours_weekly, lost_hours_state).
 *
 * The stored rows are a cache of a calculation: refreshLostHours rewrites a team's rows; lostHoursFor returns them and
 * refreshes the teams whose rows are older than LOST_HOURS_MAX_AGE_HOURS first (within a time budget; the nightly job
 * refreshes the rest). Nothing here is typed in.
 */
import type pg from 'pg';
import { pool, query } from '../../src/lib/db';
import { computeLostHours, LOST_CAUSES, LOST_WEEKS, type LostCause, type LostDetail, type LostResult, type LostWeek } from '../../packages/engine/src/calc/lostHours';
import { CHANGE_FAILURE_WINDOW_HOURS, loadDeliveryData } from './calc/delivery';
import { loadWorkData, phase3Tables } from './calc/work';

export { LOST_CAUSES, LOST_CAUSE_LABELS, LOST_WEEKS, type LostCause, type LostDetail, type LostWeek } from '../../packages/engine/src/calc/lostHours';

export const LOST_HOURS_MAX_AGE_HOURS = Number(process.env.LOST_HOURS_MAX_AGE_HOURS) || 6;
const DAY = 86_400_000;
const ms = (v: unknown) => new Date(v as string).getTime();

let tables: boolean | null = null;
/** The tables exist (a deploy before migration 20261210000000 has no hours lost). */
export async function lostHoursTables(): Promise<boolean> {
  if (tables) return true;
  tables = !!(await pool.query(`SELECT to_regclass('public.lost_hours_weekly') IS NOT NULL AND to_regclass('public.lost_hours_state') IS NOT NULL AS ok`)).rows[0]?.ok;
  return tables;
}

async function hasTable(client: pg.PoolClient, name: string): Promise<boolean> {
  return !!(await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`])).rows[0]?.ok;
}

/** Read a team's records of the window and calculate. */
export async function computeTeamLostHours(client: pg.PoolClient, teamId: string, now = Date.now()): Promise<LostResult> {
  const from = new Date(now - (LOST_WEEKS * 7 + 1) * DAY).toISOString().slice(0, 10);
  const to = new Date(now).toISOString().slice(0, 10);
  const runs = (await client.query(
    `SELECT id, COALESCE(name, '') AS name, COALESCE(commit_sha, '') AS commit, started_at, COALESCE(duration_s, 0) AS duration_s, result
       FROM pipeline_runs_raw WHERE team_id = $1 AND started_at >= $2::date AND started_at < $3::date + 1`, [teamId, from, to])).rows;
  const stages = (await client.query(
    `SELECT CASE WHEN COALESCE(r.name, '') = '' THEN s.name ELSE r.name || ' › ' || s.name END AS name,
            COALESCE(s.started_at, r.started_at) AS at, s.duration_s, COALESCE(r.commit_sha, '') AS commit
       FROM pipeline_stage_runs s JOIN pipeline_runs_raw r ON r.id = s.pipeline_run_id
      WHERE s.team_id = $1 AND s.result = 'success' AND s.duration_s IS NOT NULL AND r.started_at >= $2::date AND r.started_at < $3::date + 1`, [teamId, from, to])).rows;
  const delivery = await loadDeliveryData(client, teamId, from, to);
  const work = (await phase3Tables(client)) ? await loadWorkData(client, teamId, from, to) : null;
  const pulls = (await hasTable(client, 'pull_requests_raw'))
    ? (await client.query(`SELECT opened_at, first_review_at FROM pull_requests_raw WHERE team_id = $1 AND opened_at >= $2::date - 30`, [teamId, from])).rows
    : [];
  return computeLostHours({
    now,
    runs: runs.map((r: any) => ({ id: r.id, name: r.name, commit: r.commit, at: ms(r.started_at), durationS: Number(r.duration_s), result: r.result })),
    stageRuns: stages.map((s: any) => ({ name: s.name, at: ms(s.at), durationS: Number(s.duration_s), commit: s.commit })),
    issues: work?.issues ?? [],
    deploys: delivery.deploys,
    incidents: delivery.incidents,
    pulls: pulls.map((p: any) => ({ openedAt: ms(p.opened_at), firstReviewAt: p.first_review_at ? ms(p.first_review_at) : null })),
    changeFailureWindowHours: CHANGE_FAILURE_WINDOW_HOURS,
  });
}

/** Calculate and store one team's hours lost. */
export async function refreshLostHours(teamId: string, companyId: string, now = Date.now()): Promise<LostResult> {
  const client = await pool.connect();
  try {
    const result = await computeTeamLostHours(client, teamId, now);
    await client.query('BEGIN');
    await client.query(`DELETE FROM lost_hours_weekly WHERE team_id = $1`, [teamId]);
    const rows = result.weeks.flatMap((w) => LOST_CAUSES.map((c) => ({ start: w.start, end: w.end, cause: c, hours: w.hours[c] })));
    await client.query(
      `INSERT INTO lost_hours_weekly (team_id, company_id, week_start, week_end, cause, hours)
       SELECT $1, $2, x.start, x."end", x.cause, x.hours FROM jsonb_to_recordset($3::jsonb) AS x(start date, "end" date, cause text, hours numeric)`,
      [teamId, companyId, JSON.stringify(rows)]);
    await client.query(
      `INSERT INTO lost_hours_state (team_id, company_id, detail, samples, computed_at) VALUES ($1, $2, $3::jsonb, $4::jsonb, now())
       ON CONFLICT (team_id) DO UPDATE SET detail = EXCLUDED.detail, samples = EXCLUDED.samples, computed_at = now(), company_id = EXCLUDED.company_id`,
      [teamId, companyId, JSON.stringify(result.detail), JSON.stringify(result.samples)]);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export interface TeamLostHours { teamId: string; weeks: LostWeek[]; detail: LostDetail; samples: Record<LostCause, number>; computedAt: string | null }

const EMPTY_DETAIL: LostDetail = { slow_stage: [], flaky_rerun: [], blocked: [], failed_change: [], review_wait: null };

/** The stored hours of several teams; those that are due are recalculated first, within the budget. */
export async function lostHoursFor(companyId: string, teamIds: string[], budgetMs = 6_000): Promise<Map<string, TeamLostHours>> {
  const out = new Map<string, TeamLostHours>();
  if (!teamIds.length || !(await lostHoursTables())) return out;
  const started = Date.now();
  const state = await query<any[]>(`SELECT team_id, computed_at FROM lost_hours_state WHERE team_id = ANY(?::text[])`, [teamIds]);
  const age = new Map(state.map((s: any) => [s.team_id, ms(s.computed_at)]));
  const today = new Date().toISOString().slice(0, 10);
  // Due: never calculated, older than the limit, or calculated on an earlier day (the windows end today).
  const due = teamIds.filter((id) => !age.has(id) || started - age.get(id)! > LOST_HOURS_MAX_AGE_HOURS * 3_600_000 || new Date(age.get(id)!).toISOString().slice(0, 10) !== today)
    .sort((a, b) => (age.get(a) ?? 0) - (age.get(b) ?? 0));
  for (const id of due) {
    if (Date.now() - started > budgetMs) break;
    await refreshLostHours(id, companyId).catch((e) => console.error(`[lost-hours] ${id}:`, (e as Error).message));
  }
  const weekly = await query<any[]>(
    `SELECT team_id, week_start::text AS start, week_end::text AS "end", cause, hours::float8 AS hours FROM lost_hours_weekly WHERE team_id = ANY(?::text[]) ORDER BY week_start`, [teamIds]);
  const states = await query<any[]>(`SELECT team_id, detail, samples, computed_at FROM lost_hours_state WHERE team_id = ANY(?::text[])`, [teamIds]);
  for (const s of states) {
    out.set(s.team_id, { teamId: s.team_id, weeks: [], detail: { ...EMPTY_DETAIL, ...(s.detail ?? {}) }, samples: s.samples ?? {}, computedAt: new Date(s.computed_at).toISOString() });
  }
  for (const r of weekly) {
    const t = out.get(r.team_id);
    if (!t) continue;
    let w = t.weeks.find((x) => x.start === r.start);
    if (!w) { w = { start: r.start, end: r.end, hours: { slow_stage: 0, flaky_rerun: 0, blocked: 0, failed_change: 0, review_wait: 0 }, total: 0 }; t.weeks.push(w); }
    w.hours[r.cause as LostCause] = r.hours;
  }
  for (const t of out.values()) for (const w of t.weeks) w.total = Math.round(LOST_CAUSES.reduce((n, c) => n + w.hours[c], 0) * 100) / 100;
  return out;
}

/** Nightly: the teams with pipeline runs, deploys, issues or pull requests in the window, oldest calculation first. */
export async function refreshRecentLostHours(budgetMs = 20_000): Promise<{ teams: number; skipped: number }> {
  if (!(await lostHoursTables())) return { teams: 0, skipped: 0 };
  const started = Date.now();
  const teams = (await pool.query(
    `SELECT t.id, t.company_id FROM teams t LEFT JOIN lost_hours_state s ON s.team_id = t.id
      WHERE t.is_active AND (EXISTS (SELECT 1 FROM pipeline_runs_raw p WHERE p.team_id = t.id AND p.day >= CURRENT_DATE - ${LOST_WEEKS * 7})
                          OR EXISTS (SELECT 1 FROM deployments_raw d WHERE d.team_id = t.id AND d.day >= CURRENT_DATE - ${LOST_WEEKS * 7})
                          OR EXISTS (SELECT 1 FROM issues i WHERE i.team_id = t.id AND (i.resolved_at IS NULL OR i.resolved_at >= CURRENT_DATE - ${LOST_WEEKS * 7})))
      ORDER BY s.computed_at NULLS FIRST`)).rows;
  let done = 0;
  for (const t of teams) {
    if (Date.now() - started > budgetMs) break;
    await refreshLostHours(t.id, t.company_id).catch((e) => console.error(`[lost-hours] ${t.id}:`, (e as Error).message));
    done++;
  }
  return { teams: done, skipped: teams.length - done };
}
