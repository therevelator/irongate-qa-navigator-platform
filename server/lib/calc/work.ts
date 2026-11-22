/**
 * Calculation engine, phase 3: work (docs/V2_PLAN.md, "Calculation rules (phase 3)").
 *
 * From issues / issue_transitions / issue_sprints (and the code size of the latest coverage report)
 * it computes, per team and UTC day D, "as of" the end of D:
 *
 *   Defects, over the WINDOW_DAYS (28) days ending D (bugs opened in the window; bugs resolved as won't
 *   do, duplicate, cannot reproduce, … are not confirmed defects and are left out):
 *     escape_rate     → defect_escape_rate     bugs found in production ÷ bugs with a known environment × 100
 *     defect_density  → defect_density         bugs found in production ÷ (lines of code ÷ 1,000); lines of
 *                                              code = lines found of the latest main-branch coverage report
 *   Sprints: the latest sprint closed on or before D (closed at most SPRINT_STALE_DAYS days before):
 *     velocity        → sprint_velocity        story points of the issues completed in the sprint
 *     commitment      → sprint_commitment_rate completed points ÷ points committed at sprint start × 100
 *     carryover       → sprint_carryover       points of the sprint's issues not completed ÷ committed × 100
 *     blocked_time    → blocked_time_hours     hours the sprint's issues spent blocked (a Blocked / On hold /
 *                                              Waiting status, or flagged) within the sprint
 *     sizing_accuracy → sizing_accuracy        time logged ÷ original estimate over the completed issues
 *                                              with both
 *   A team without sprints (Kanban): blocked time and sizing accuracy over the 14 days ending D.
 *
 * Completed = a done status, not resolved as won't do / duplicate / … ; an issue completed in a sprint is
 * in that sprint and resolved before the sprint closed (and not in a later sprint that started first).
 * Committed = in the sprint when it started (Jira's Sprint changes when sent; otherwise created before the
 * start). Epics and sub-tasks are not counted in the sprint metrics.
 *
 * The calculation is the shared engine's (packages/engine/src/calc/work.ts); this file reads what a range of days depends on (loadWorkData).
 */
import type pg from 'pg';
import type { ComputedMetric } from './engine';
import {
  computeWorkDay, workAffectedDays as affectedWith, DEFAULT_WORK_RECOMPUTE_DAYS, SPRINT_STALE_DAYS, WORK_WINDOW_DAYS,
  type TransitionRow, type WorkData,
} from '../../../packages/engine/src/calc/work';

export {
  WORK_WINDOW_DAYS, SPRINT_STALE_DAYS, KANBAN_WINDOW_DAYS, WORK_METRICS, completed, confirmedBug, inSprintAt, completedIn, blockedHours,
  summariseSprint, computeWorkDay, type SprintRow, type TransitionRow, type IssueRow, type WorkData, type SprintSummary,
} from '../../../packages/engine/src/calc/work';

/** On arrival, days older than this are not recalculated (a year of history stays as raw data; WORK_RECOMPUTE_DAYS). */
export const WORK_RECOMPUTE_DAYS = Number(process.env.WORK_RECOMPUTE_DAYS) || DEFAULT_WORK_RECOMPUTE_DAYS;

/** The days whose work values depend on changes of the given days (the server's recompute limit). */
export const workAffectedDays = (eventDays: string[], today = new Date().toISOString().slice(0, 10), limitDays = WORK_RECOMPUTE_DAYS): string[] =>
  affectedWith(eventDays, today, limitDays);

let tablesSeen = false;
/** The phase-3 tables exist (migration 20261201000000; a deploy before the migration calculates nothing for phase 3). */
export async function phase3Tables(client: pg.PoolClient): Promise<boolean> {
  if (tablesSeen) return true;
  tablesSeen = !!(await client.query(`SELECT to_regclass('public.issues') IS NOT NULL AND to_regclass('public.analysis_reports') IS NOT NULL AS ok`)).rows[0]?.ok;
  return tablesSeen;
}

const ms = (v: any): number | null => (v === null || v === undefined ? null : new Date(v).getTime());

/** Read the sprints, issues (with their changes) and coverage sizes that the days from `from` to `to` depend on. */
export async function loadWorkData(client: pg.PoolClient, teamId: string, from: string, to: string): Promise<WorkData> {
  const sprints = (await client.query(
    `SELECT id, external_id, name, started_at, completed_at FROM issue_sprints WHERE team_id = $1 ORDER BY started_at NULLS LAST`, [teamId])).rows;
  const issues = (await client.query(
    `SELECT id, external_id, title, issue_type, status_category, resolution, found_in, environment, story_points::float8 AS points, estimate_hours::float8 AS estimate,
            time_logged_hours::float8 AS logged, sprint_ids, opened_at, resolved_at, url, components
       FROM issues
      WHERE team_id = $1 AND opened_at < $3::date + 1
        AND (resolved_at IS NULL OR resolved_at >= $2::date - ${SPRINT_STALE_DAYS + 30} OR opened_at >= $2::date - ${WORK_WINDOW_DAYS + 3})`, [teamId, from, to])).rows;
  const ids = issues.map((i: any) => i.id);
  const trans = ids.length
    ? (await client.query(`SELECT issue_id, field, from_value, to_value, to_category, at FROM issue_transitions WHERE issue_id = ANY($1::text[]) ORDER BY at`, [ids])).rows
    : [];
  const tBy = new Map<string, TransitionRow[]>();
  for (const t of trans) { const l = tBy.get(t.issue_id) ?? []; l.push({ field: t.field, from: t.from_value, to: t.to_value, toCategory: t.to_category, at: ms(t.at)! }); tBy.set(t.issue_id, l); }
  const coverage = (await client.query(
    `SELECT r.id, r.created_at, r.lines_found FROM coverage_reports r JOIN teams t ON t.id = r.team_id
      WHERE r.team_id = $1 AND r.created_at < $2::date + 1 AND r.lines_found > 0
        AND (r.branch IS NULL OR r.branch = '' OR (t.main_branch IS NULL AND r.branch IN ('main', 'master')) OR r.branch = t.main_branch)
      ORDER BY r.created_at`, [teamId, to])).rows;
  return {
    sprints: sprints.map((s: any) => ({ id: s.id, externalId: s.external_id, name: s.name, startedAt: ms(s.started_at), completedAt: ms(s.completed_at) })),
    issues: issues.map((i: any) => ({
      id: i.id, key: i.external_id, title: i.title, type: i.issue_type, statusCategory: i.status_category, resolution: i.resolution, foundIn: i.found_in, environment: i.environment,
      points: i.points, estimate: i.estimate, logged: i.logged, sprintIds: i.sprint_ids ?? [], openedAt: ms(i.opened_at)!, resolvedAt: ms(i.resolved_at), url: i.url,
      components: i.components ?? [], transitions: tBy.get(i.id) ?? [],
    })),
    coverage: coverage.map((c: any) => ({ id: c.id, at: ms(c.created_at)!, linesFound: Number(c.lines_found) })),
    hasSprints: sprints.length > 0,
  };
}

/** Work metrics of several days of a team (one read for all of them). */
export async function computeWorkDays(client: pg.PoolClient, teamId: string, days: string[], now = Date.now()): Promise<Map<string, ComputedMetric[]>> {
  const out = new Map<string, ComputedMetric[]>();
  if (!days.length) return out;
  if (!(await phase3Tables(client))) return out;
  const has = (await client.query('SELECT EXISTS (SELECT 1 FROM issues WHERE team_id = $1) OR EXISTS (SELECT 1 FROM issue_sprints WHERE team_id = $1) AS x', [teamId])).rows[0]?.x;
  if (!has) return out;
  const sorted = [...days].sort();
  const data = await loadWorkData(client, teamId, sorted[0], sorted[sorted.length - 1]);
  for (const d of sorted) out.set(d, computeWorkDay(d, data, now));
  return out;
}

