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
 * computeWorkDay is pure; loadWorkData reads what a range of days depends on.
 */
import type pg from 'pg';
import type { ComputedMetric, MetricSpec } from './engine';
import { isCompleted } from '../ingest/issueEvents';

export const WORK_WINDOW_DAYS = 28;
export const SPRINT_STALE_DAYS = 42;
export const KANBAN_WINDOW_DAYS = 14;
/** On arrival, days older than this are not recalculated (a year of history stays as raw data; WORK_RECOMPUTE_DAYS). */
export const WORK_RECOMPUTE_DAYS = Number(process.env.WORK_RECOMPUTE_DAYS) || 190;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const GRACE = HOUR;

export const WORK_METRICS: Record<string, MetricSpec> = {
  escape_rate: { key: 'escape_rate', label: 'Defect escape rate', unit: '%', kpi: 'defect_escape_rate', group: 'work',
    formula: 'bugs found in production ÷ bugs with a known environment found in × 100, over the bugs opened in the 28 days ending the day (bugs resolved as won’t do, duplicate or cannot reproduce left out)' },
  defect_density: { key: 'defect_density', label: 'Defect density', unit: 'defects/KLOC', kpi: 'defect_density', group: 'work',
    formula: 'bugs found in production in the 28 days ending the day ÷ (lines of code ÷ 1,000); lines of code = lines found of the latest main-branch coverage report' },
  velocity: { key: 'velocity', label: 'Sprint velocity', unit: 'points', kpi: 'sprint_velocity', group: 'work',
    formula: 'story points of the issues completed in the latest closed sprint (done before the sprint closed; epics and sub-tasks not counted)' },
  commitment: { key: 'commitment', label: 'Sprint commitment rate', unit: '%', kpi: 'sprint_commitment_rate', group: 'work',
    formula: 'completed story points ÷ story points committed at sprint start × 100 (latest closed sprint; issues added after the start count when completed, not as committed)' },
  carryover: { key: 'carryover', label: 'Sprint carryover', unit: '%', kpi: 'sprint_carryover', group: 'work',
    formula: 'story points of the sprint’s issues not completed when it closed ÷ committed story points × 100 (latest closed sprint, at most 100)' },
  blocked_time: { key: 'blocked_time', label: 'Blocked time', unit: 'h', kpi: 'blocked_time_hours', group: 'work',
    formula: 'hours the latest closed sprint’s issues spent in a blocked status (Blocked, On hold, Waiting, Impeded) or flagged, within the sprint (14 days ending the day for a team without sprints)' },
  sizing_accuracy: { key: 'sizing_accuracy', label: 'Sizing accuracy', unit: 'ratio', kpi: 'sizing_accuracy', group: 'work',
    formula: 'time logged ÷ original estimate over the issues completed in the latest closed sprint that have both (1.0 = as estimated, above 1 = underestimated; 14 days ending the day for a team without sprints)' },
};

export interface SprintRow { id: string; externalId: string; name: string | null; startedAt: number | null; completedAt: number | null }
export interface TransitionRow { field: 'status' | 'flagged' | 'sprint'; from: string | null; to: string; toCategory: string | null; at: number }
export interface IssueRow {
  id: string; key: string; title: string | null; type: string; statusCategory: string; resolution: string | null; foundIn: string | null; environment: string | null;
  points: number | null; estimate: number | null; logged: number | null; sprintIds: string[]; openedAt: number; resolvedAt: number | null; url: string | null;
  components: string[]; transitions: TransitionRow[];
}
export interface WorkData { sprints: SprintRow[]; issues: IssueRow[]; coverage: Array<{ id: string; at: number; linesFound: number }>; hasSprints: boolean }

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const completed = (i: IssueRow) => isCompleted(i.statusCategory, i.resolution);
const sprintCounted = (i: IssueRow) => i.type !== 'epic' && i.type !== 'subtask';
export const confirmedBug = (i: IssueRow) => i.type === 'bug' && !(i.statusCategory === 'done' && !completed(i));

const listHas = (value: string | null, s: SprintRow) => !!value && value.split(',').map((x) => x.trim()).some((x) => x === s.externalId || (!!s.name && x === s.name));

/** Was the issue in sprint S at time t? Its Sprint changes when sent; otherwise created before t (and S is one of its sprints). */
export function inSprintAt(i: IssueRow, s: SprintRow, t: number): boolean {
  const ch = i.transitions.filter((x) => x.field === 'sprint').sort((a, b) => a.at - b.at);
  if (!ch.length) return i.openedAt <= t;
  const before = ch.filter((x) => x.at <= t);
  if (before.length) return listHas(before[before.length - 1].to, s);
  return listHas(ch[0].from, s);
}

/** Completed in sprint S: in S, resolved before S closed, and not in a later sprint of its own that started before it was resolved. */
export function completedIn(i: IssueRow, s: SprintRow, byId: Map<string, SprintRow>): boolean {
  if (!completed(i) || i.resolvedAt === null || s.completedAt === null) return false;
  if (i.resolvedAt > s.completedAt + GRACE) return false;
  if (s.startedAt !== null && i.resolvedAt < s.startedAt - 14 * DAY) return false;
  return !i.sprintIds.some((x) => {
    const o = byId.get(x);
    return o && o.id !== s.id && o.startedAt !== null && s.startedAt !== null && o.startedAt > s.startedAt && o.startedAt < i.resolvedAt!;
  });
}

/** Blocked intervals of an issue (blocked status or flagged), unioned, clipped to [from, to]. */
export function blockedHours(i: IssueRow, from: number, to: number): number {
  const iv: Array<[number, number]> = [];
  const st = i.transitions.filter((x) => x.field === 'status').sort((a, b) => a.at - b.at);
  st.forEach((x, k) => { if (x.toCategory === 'blocked') iv.push([x.at, st[k + 1]?.at ?? (i.resolvedAt ?? to)]); });
  const fl = i.transitions.filter((x) => x.field === 'flagged').sort((a, b) => a.at - b.at);
  let on: number | null = null;
  for (const x of fl) {
    if (x.to === 'on' && on === null) on = x.at;
    else if (x.to === 'off' && on !== null) { iv.push([on, x.at]); on = null; }
  }
  if (on !== null) iv.push([on, i.resolvedAt ?? to]);
  const xs = iv.map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const x of xs) {
    if (!cur || x[0] > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [x[0], x[1]]; } else cur[1] = Math.max(cur[1], x[1]);
  }
  if (cur) total += cur[1] - cur[0];
  return total / HOUR;
}

export interface SprintSummary {
  sprint: SprintRow;
  issues: IssueRow[];
  committed: IssueRow[];
  added: IssueRow[];
  done: IssueRow[];
  notDone: IssueRow[];
  committedPoints: number;
  completedPoints: number;
  notDonePoints: number;
  blocked: Array<{ issue: IssueRow; hours: number }>;
  sized: IssueRow[];
}

/** The figures of one closed sprint (as of `asOf` for blocked time still running). Pure. */
export function summariseSprint(s: SprintRow, data: WorkData, asOf: number): SprintSummary {
  const byId = new Map(data.sprints.map((x) => [x.externalId, x]));
  const issues = data.issues.filter((i) => sprintCounted(i) && i.sprintIds.includes(s.externalId));
  const start = (s.startedAt ?? s.completedAt!) + GRACE;
  const committed = issues.filter((i) => inSprintAt(i, s, start));
  const added = issues.filter((i) => !committed.includes(i));
  const done = issues.filter((i) => completedIn(i, s, byId));
  const notDone = issues.filter((i) => !done.includes(i));
  const pts = (xs: IssueRow[]) => sum(xs.map((i) => i.points ?? 0));
  const end = Math.min(s.completedAt ?? asOf, asOf);
  const blocked = issues.map((issue) => ({ issue, hours: blockedHours(issue, s.startedAt ?? end, end) })).filter((b) => b.hours > 0).sort((a, b) => b.hours - a.hours);
  return {
    sprint: s, issues, committed, added, done, notDone, committedPoints: pts(committed), completedPoints: pts(done), notDonePoints: pts(notDone), blocked,
    sized: done.filter((i) => (i.estimate ?? 0) > 0 && (i.logged ?? 0) > 0),
  };
}

const keys = (xs: IssueRow[], n = 50) => xs.slice(0, n).map((i) => i.key);

/** The work metrics of one day (UTC), as of the end of the day (or now, for today). Pure. */
export function computeWorkDay(day: string, data: WorkData, now = Date.now()): ComputedMetric[] {
  const dayStart = Date.parse(`${day}T00:00:00Z`);
  const asOf = Math.min(dayStart + DAY - 1, now);
  if (asOf < dayStart) return [];
  const out: ComputedMetric[] = [];
  const push = (m: Omit<ComputedMetric, 'recordedAt'>, at: number) => out.push({ ...m, recordedAt: new Date(Math.max(dayStart, Math.min(at, asOf))).toISOString() });

  // --- Defects --------------------------------------------------------------------------------
  const wStart = dayStart - (WORK_WINDOW_DAYS - 1) * DAY;
  const bugs = data.issues.filter((i) => confirmedBug(i) && i.openedAt >= wStart && i.openedAt <= asOf).sort((a, b) => a.openedAt - b.openedAt);
  const known = bugs.filter((i) => i.foundIn);
  if (known.length) {
    const escaped = known.filter((i) => i.foundIn === 'production');
    const lastAt = known[known.length - 1].openedAt;
    push({
      key: 'escape_rate', value: r2((escaped.length / known.length) * 100),
      inputs: { escapedBugs: escaped.length, bugsWithEnvironment: known.length, bugsWithoutEnvironment: bugs.length - known.length, windowDays: WORK_WINDOW_DAYS },
      sources: { escaped: keys([...escaped].reverse()), issues: keys([...known].reverse()) }, sampleSize: known.length,
    }, lastAt);
    const cov = [...data.coverage].filter((c) => c.at <= asOf && c.linesFound > 0).pop();
    if (cov) {
      push({
        key: 'defect_density', value: r3(escaped.length / (cov.linesFound / 1000)),
        inputs: { escapedBugs: escaped.length, linesOfCode: cov.linesFound, kloc: r3(cov.linesFound / 1000), windowDays: WORK_WINDOW_DAYS },
        sources: { escaped: keys(escaped), coverageReports: [cov.id] }, sampleSize: known.length,
      }, Math.max(lastAt, cov.at));
    }
  }

  // --- Sprints --------------------------------------------------------------------------------
  const closed = data.sprints.filter((s) => s.completedAt !== null && s.completedAt <= asOf && s.completedAt >= dayStart - (SPRINT_STALE_DAYS - 1) * DAY)
    .sort((a, b) => a.completedAt! - b.completedAt!);
  const s = closed[closed.length - 1];
  if (s) {
    const x = summariseSprint(s, data, asOf);
    const sprintSrc = { sprint: { id: s.externalId, name: s.name, startedAt: s.startedAt === null ? null : new Date(s.startedAt).toISOString(), completedAt: new Date(s.completedAt!).toISOString() } };
    const n = x.issues.length;
    const at = s.completedAt!;
    if (n) {
      push({ key: 'velocity', value: r2(x.completedPoints), inputs: { completedPoints: x.completedPoints, completedIssues: x.done.length, unestimatedCompleted: x.done.filter((i) => i.points === null).length, sprint: s.name ?? s.externalId },
        sources: { ...sprintSrc, completed: keys(x.done) }, sampleSize: n }, at);
      if (x.committedPoints > 0) {
        push({ key: 'commitment', value: r2((x.completedPoints / x.committedPoints) * 100), inputs: { completedPoints: x.completedPoints, committedPoints: x.committedPoints, committedIssues: x.committed.length, addedIssues: x.added.length, addedPoints: sum(x.added.map((i) => i.points ?? 0)), sprint: s.name ?? s.externalId },
          sources: { ...sprintSrc, committed: keys(x.committed), added: keys(x.added), completed: keys(x.done) }, sampleSize: n }, at);
        push({ key: 'carryover', value: r2(Math.min(100, (x.notDonePoints / x.committedPoints) * 100)), inputs: { notCompletedPoints: x.notDonePoints, notCompletedIssues: x.notDone.length, committedPoints: x.committedPoints, sprint: s.name ?? s.externalId },
          sources: { ...sprintSrc, carriedOver: keys(x.notDone) }, sampleSize: n }, at);
      }
      const hours = sum(x.blocked.map((b) => b.hours));
      push({ key: 'blocked_time', value: r2(hours), inputs: { blockedHours: r2(hours), blockedIssues: x.blocked.length, sprintIssues: n, sprint: s.name ?? s.externalId },
        sources: { ...sprintSrc, blocked: x.blocked.slice(0, 25).map((b) => ({ key: b.issue.key, hours: r2(b.hours) })) }, sampleSize: n }, at);
    }
    if (x.sized.length) {
      const est = sum(x.sized.map((i) => i.estimate!));
      const log = sum(x.sized.map((i) => i.logged!));
      push({ key: 'sizing_accuracy', value: r2(log / est), inputs: { timeLoggedHours: r2(log), estimateHours: r2(est), issues: x.sized.length, sprint: s.name ?? s.externalId },
        sources: { ...sprintSrc, sized: x.sized.slice(0, 25).map((i) => ({ key: i.key, estimateHours: i.estimate, loggedHours: i.logged })) }, sampleSize: x.sized.length }, at);
    }
  } else if (!data.hasSprints) {
    const kStart = dayStart - (KANBAN_WINDOW_DAYS - 1) * DAY;
    const resolved = data.issues.filter((i) => sprintCounted(i) && completed(i) && i.resolvedAt !== null && i.resolvedAt >= kStart && i.resolvedAt <= asOf);
    const sized = resolved.filter((i) => (i.estimate ?? 0) > 0 && (i.logged ?? 0) > 0);
    if (sized.length) {
      const est = sum(sized.map((i) => i.estimate!));
      const log = sum(sized.map((i) => i.logged!));
      push({ key: 'sizing_accuracy', value: r2(log / est), inputs: { timeLoggedHours: r2(log), estimateHours: r2(est), issues: sized.length, windowDays: KANBAN_WINDOW_DAYS },
        sources: { sized: sized.slice(0, 25).map((i) => ({ key: i.key, estimateHours: i.estimate, loggedHours: i.logged })) }, sampleSize: sized.length }, Math.max(...sized.map((i) => i.resolvedAt!)));
    }
    const active = data.issues.filter((i) => sprintCounted(i) && i.openedAt <= asOf && (i.resolvedAt === null || i.resolvedAt >= kStart));
    if (active.some((i) => i.transitions.some((t) => t.field === 'status' || t.field === 'flagged'))) {
      const blocked = active.map((issue) => ({ issue, hours: blockedHours(issue, kStart, asOf) })).filter((b) => b.hours > 0).sort((a, b) => b.hours - a.hours);
      const hours = sum(blocked.map((b) => b.hours));
      push({ key: 'blocked_time', value: r2(hours), inputs: { blockedHours: r2(hours), blockedIssues: blocked.length, activeIssues: active.length, windowDays: KANBAN_WINDOW_DAYS },
        sources: { blocked: blocked.slice(0, 25).map((b) => ({ key: b.issue.key, hours: r2(b.hours) })) }, sampleSize: active.length }, asOf);
    }
  }
  return out;
}

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

/** The days whose work values depend on changes of the given days: each day and the SPRINT_STALE_DAYS − 1 after it, within WORK_RECOMPUTE_DAYS, up to today. */
export function workAffectedDays(eventDays: string[], today = new Date().toISOString().slice(0, 10), limitDays = WORK_RECOMPUTE_DAYS): string[] {
  const floor = new Date(Date.parse(`${today}T00:00:00Z`) - (limitDays - 1) * DAY).toISOString().slice(0, 10);
  const valid = eventDays.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today).sort();
  const set = new Set<string>();
  for (const d of valid) {
    const start = Date.parse(`${d}T00:00:00Z`);
    for (let i = 0; i < SPRINT_STALE_DAYS; i++) {
      const x = new Date(start + i * DAY).toISOString().slice(0, 10);
      if (x > today) break;
      if (x >= floor) set.add(x);
    }
  }
  return Array.from(set).sort();
}
