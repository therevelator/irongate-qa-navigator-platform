/**
 * Tracked actions (table team_actions): improvement actions of a team, created from a
 * recommendation, an alert or by hand, with an owner (a user who has the team in their analytics
 * scope), a due date, a status (open, in progress, done, dropped) and optionally a linked KPI.
 *
 * Baseline and outcome are COMPUTED from the stored metric values (metric_values), never entered:
 *   baseline     the latest value of the metric when the action is created (value + the time
 *                it is for);
 *   completion   when the action is marked done: the latest value recorded after the baseline
 *                and up to the completion time;
 *   14 / 30 days the latest value recorded after the completion and up to 14 / 30 days after it,
 *                computed once that time has passed (refreshActionOutcomes, on the schedule and
 *                after every KPI write; also when the actions are read).
 * Each checkpoint is judged against the baseline in the metric's direction (judgeOutcome):
 * improved / worse when it moved by more than OUTCOME_TOLERANCE of the baseline, else unchanged;
 * no_data when no new value was recorded in that window. A computed checkpoint is kept.
 * Reopening a done action clears its completion and outcomes.
 *
 * Status history (table team_action_events): every status change (and the creation) is recorded in
 * the same transaction as the change, with who made it (the signed-in user; NULL and source
 * 'system' for an automatic change) and when (UTC). team_actions.status_changed_by / _at hold the
 * latest one. The list endpoint returns them with each action (statusChangedBy, statusChangedAt,
 * history newest first), scoped like the actions themselves; people are named, never e-mailed.
 */
import type { PoolClient } from 'pg';
import { query, queryOne, transaction } from '../../src/lib/db';
import { execOn, type Exec } from './assignments';
import { recordAudit } from './audit';
import { isTargetMetric, TARGET_METRIC_KEYS, TARGET_METRICS, type TargetMetric } from './targets';
import { METRICS_CONFIG } from '../../src/config/metricsConfig';
import { metricLabel, metricUnit } from './alerts';
import type { Movement } from './recommendations/store';

export type ActionStatus = 'open' | 'in_progress' | 'done' | 'dropped';
export const ACTION_STATUSES: ActionStatus[] = ['open', 'in_progress', 'done', 'dropped'];
export type ActionOrigin = 'manual' | 'recommendation' | 'alert';
export const ACTION_ORIGINS: ActionOrigin[] = ['manual', 'recommendation', 'alert'];
export type Outcome = 'improved' | 'unchanged' | 'worse' | 'no_data';

/** A checkpoint value within ±2 % of the baseline (at least ±0.01) counts as unchanged. */
export const OUTCOME_TOLERANCE = 0.02;
export const OUTCOME_RULE_TEXT =
  'Outcome = the stored metric value at completion, and 14 and 30 days after it, compared with the baseline (the value when the action was created). ' +
  'Improved or worse when it moved more than 2% of the baseline in the metric’s good or bad direction, otherwise unchanged; “no new data” when no value was recorded in that window.';

export const CHECKPOINT_DAYS = { d14: 14, d30: 30 } as const;

/** Metrics an action can be linked to (those with a direction and a target). */
export const ACTION_METRICS = TARGET_METRIC_KEYS;
export const lowerIsBetterOf = (m: TargetMetric) => METRICS_CONFIG[TARGET_METRICS[m]].lowerIsBetter;

/** Verdict of a checkpoint value against the baseline in the metric's direction. */
export function judgeOutcome(baseline: number, value: number, lowerIsBetter: boolean): Exclude<Outcome, 'no_data'> {
  const tolerance = Math.max(Math.abs(baseline) * OUTCOME_TOLERANCE, 0.01);
  const delta = value - baseline;
  if (Math.abs(delta) <= tolerance) return 'unchanged';
  const better = lowerIsBetter ? delta < 0 : delta > 0;
  return better ? 'improved' : 'worse';
}

const num = (v: any) => (v === null || v === undefined ? null : Number(v));
const iso = (v: any) => (v ? new Date(v).toISOString() : null);

/** Latest stored value of a team's metric recorded in (after, upTo]; null when none. */
export async function valueBetween(teamId: string, metric: string, after: string | null, upTo: string, exec: Exec = execOn()): Promise<{ value: number; recordedAt: string } | null> {
  const [row] = await exec<any>(
    `SELECT value, recorded_at FROM metric_values
      WHERE team_id = ? AND metric_key = ? AND superseded_by IS NULL
        AND recorded_at <= ?::timestamptz AND (?::timestamptz IS NULL OR recorded_at > ?::timestamptz)
      ORDER BY recorded_at DESC, received_at DESC LIMIT 1`,
    [teamId, metric, upTo, after, after]
  );
  return row ? { value: Number(row.value), recordedAt: new Date(row.recorded_at).toISOString() } : null;
}

export class ActionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ActionInput {
  title?: unknown;
  description?: unknown;
  ownerId?: unknown;
  dueDate?: unknown;
  status?: unknown;
  metricKey?: unknown;
  origin?: unknown;
  alertId?: unknown;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanTitle(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (s.length < 3 || s.length > 200) throw new ActionError(400, 'Title must be 3 to 200 characters');
  return s;
}
export function cleanDescription(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > 2000) throw new ActionError(400, 'Description must be text of at most 2000 characters');
  return v.trim() || null;
}
export function cleanDueDate(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new ActionError(400, 'Due date must be a date (YYYY-MM-DD)');
  return v;
}
export function cleanMetric(v: unknown): TargetMetric | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !isTargetMetric(v)) throw new ActionError(400, 'Unknown metric');
  return v;
}
export function cleanStatus(v: unknown): ActionStatus {
  if (typeof v !== 'string' || !(ACTION_STATUSES as string[]).includes(v)) throw new ActionError(400, `Status must be one of ${ACTION_STATUSES.join(', ')}`);
  return v as ActionStatus;
}

/** The completion checkpoint of an action being marked done now. */
async function completionCheckpoint(row: { team_id: string; metric_key: string | null; baseline_value: any; baseline_at: any }, completedAt: string, exec: Exec) {
  if (!row.metric_key || !isTargetMetric(row.metric_key) || row.baseline_value === null || row.baseline_value === undefined) {
    return { value: null, at: null, outcome: row.metric_key ? ('no_data' as Outcome) : null };
  }
  const v = await valueBetween(row.team_id, row.metric_key, iso(row.baseline_at), completedAt, exec);
  if (!v) return { value: null, at: null, outcome: 'no_data' as Outcome };
  return { value: v.value, at: v.recordedAt, outcome: judgeOutcome(Number(row.baseline_value), v.value, lowerIsBetterOf(row.metric_key)) as Outcome };
}

/**
 * Compute the checkpoints that are due and not yet stored (completion, 14 and 30 days after
 * completion) for done actions of a company (optionally only some teams / actions).
 * Returns the number of actions updated.
 */
export async function refreshActionOutcomes(companyId: string, opts: { teamIds?: string[]; actionIds?: string[]; now?: number } = {}): Promise<number> {
  const now = opts.now ?? Date.now();
  const rows = await query<any>(
    `SELECT * FROM team_actions
      WHERE company_id = ? AND status = 'done' AND completed_at IS NOT NULL AND metric_key IS NOT NULL
        AND (completion_outcome IS NULL OR d14_outcome IS NULL OR d30_outcome IS NULL)
        AND (?::text[] IS NULL OR team_id = ANY(?::text[])) AND (?::text[] IS NULL OR id = ANY(?::text[]))`,
    [companyId, opts.teamIds ?? null, opts.teamIds ?? null, opts.actionIds ?? null, opts.actionIds ?? null]
  );
  let updated = 0;
  const exec = execOn();
  for (const r of rows) {
    const completedAt = new Date(r.completed_at).toISOString();
    const set: Record<string, any> = {};
    if (!r.completion_outcome) {
      const c = await completionCheckpoint(r, completedAt, exec);
      Object.assign(set, { completion_value: c.value, completion_value_at: c.at, completion_outcome: c.outcome });
    }
    for (const [k, days] of Object.entries(CHECKPOINT_DAYS)) {
      if (r[`${k}_outcome`]) continue;
      const at = Date.parse(completedAt) + days * 86_400_000;
      if (at > now) continue;
      if (r.baseline_value === null || !isTargetMetric(r.metric_key)) {
        Object.assign(set, { [`${k}_outcome`]: 'no_data' });
        continue;
      }
      const v = await valueBetween(r.team_id, r.metric_key, completedAt, new Date(at).toISOString(), exec);
      Object.assign(set, v
        ? { [`${k}_value`]: v.value, [`${k}_value_at`]: v.recordedAt, [`${k}_outcome`]: judgeOutcome(Number(r.baseline_value), v.value, lowerIsBetterOf(r.metric_key)) }
        : { [`${k}_outcome`]: 'no_data' });
    }
    const keys = Object.keys(set);
    if (!keys.length) continue;
    await query(
      // Only while it is still the same completion (not reopened / completed again meanwhile).
      `UPDATE team_actions SET ${keys.map((k) => `${k} = ?`).join(', ')}
        WHERE id = ? AND status = 'done' AND abs(extract(epoch FROM completed_at - ?::timestamptz)) < 0.001`,
      [...keys.map((k) => set[k]), r.id, completedAt]
    );
    updated++;
  }
  return updated;
}

/* ------------------------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------------------------- */

const fullName = (alias: string) => `NULLIF(TRIM(COALESCE(${alias}.first_name, '') || ' ' || COALESCE(${alias}.last_name, '')), '')`;

const ACTION_SELECT = `
  SELECT a.*, t.name AS team_name, t.department_id, rec.title AS recommendation_title,
         ${fullName('sc')} AS status_changed_by_name,
         NULLIF(TRIM(COALESCE(o.first_name, '') || ' ' || COALESCE(o.last_name, '')), '') AS owner_name, o.email AS owner_email,
         NULLIF(TRIM(COALESCE(cb.first_name, '') || ' ' || COALESCE(cb.last_name, '')), '') AS created_by_name,
         (SELECT json_build_object('value', mv.value, 'recordedAt', mv.recorded_at) FROM metric_values mv
           WHERE mv.team_id = a.team_id AND mv.metric_key = a.metric_key AND mv.superseded_by IS NULL
           ORDER BY mv.recorded_at DESC, mv.received_at DESC LIMIT 1) AS current_value
    FROM team_actions a
    JOIN teams t ON t.id = a.team_id
    LEFT JOIN recommendations rec ON rec.id = a.recommendation_id
    LEFT JOIN users o ON o.id = a.owner_id
    LEFT JOIN users cb ON cb.id = a.created_by
    LEFT JOIN users sc ON sc.id = a.status_changed_by`;

/** A person as shown next to a status change: id and name only (never the e-mail). */
export interface PersonRef { id: string; name: string }
const UNNAMED = 'Unnamed user';

/** One status change of an action (from null = created). */
export interface ActionEventJson {
  id: string;
  fromStatus: ActionStatus | null;
  toStatus: ActionStatus;
  /** The person who made the change; null for an automatic change or when that user was deleted. */
  changedBy: PersonRef | null;
  /** True for a change made by the system (no person). */
  automatic: boolean;
  changedAt: string;
  note: string | null;
}

/** Status history of the given actions (of one company), newest first per action. */
export async function actionHistories(companyId: string, actionIds: string[], exec: Exec = execOn()): Promise<Map<string, ActionEventJson[]>> {
  const out = new Map<string, ActionEventJson[]>();
  if (!actionIds.length) return out;
  const rows = await exec<any>(
    `SELECT e.id, e.action_id, e.from_status, e.to_status, e.changed_by, e.source, e.changed_at, e.note, ${fullName('u')} AS changed_by_name
       FROM team_action_events e LEFT JOIN users u ON u.id = e.changed_by
      WHERE e.company_id = ? AND e.action_id = ANY(?::text[])
      ORDER BY e.action_id, e.changed_at DESC, (e.from_status IS NULL), e.id`,
    [companyId, actionIds]
  );
  for (const r of rows) {
    const list = out.get(r.action_id) ?? [];
    list.push({
      id: r.id, fromStatus: r.from_status ?? null, toStatus: r.to_status,
      changedBy: r.changed_by ? { id: r.changed_by, name: r.changed_by_name ?? UNNAMED } : null,
      automatic: r.source === 'system', changedAt: new Date(r.changed_at).toISOString(), note: r.note ?? null,
    });
    out.set(r.action_id, list);
  }
  return out;
}

/**
 * Record a status change (or the creation: from = null) of an action, in the caller's transaction.
 * actorId null / empty = an automatic change by the system.
 */
export async function recordStatusEvent(exec: Exec, e: { companyId: string; teamId: string; actionId: string; from: ActionStatus | null; to: ActionStatus; actorId: string | null; at: string; note?: string | null }): Promise<void> {
  await exec(
    `INSERT INTO team_action_events (company_id, team_id, action_id, from_status, to_status, changed_by, source, changed_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?::timestamptz, ?)`,
    [e.companyId, e.teamId, e.actionId, e.from, e.to, e.actorId || null, e.actorId ? 'user' : 'system', e.at, e.note ?? null]
  );
}

export interface ActionJson {
  id: string;
  teamId: string;
  teamName: string;
  title: string;
  description: string | null;
  origin: ActionOrigin;
  alertId: string | null;
  /** The recommendation it was created from (Team detail → Recommendations), if any. */
  recommendation: { id: string; title: string } | null;
  /**
   * Whether the metric moved since the action was created, from the snapshot history: the team's
   * KPI snapshot on the creation day (or the latest before) and its latest snapshot since
   * (listTeamActions; null elsewhere or without a linked metric).
   */
  movement?: Movement | null;
  owner: { id: string; name: string } | null;
  dueDate: string | null;
  overdue: boolean;
  status: ActionStatus;
  metric: { key: string; label: string; unit: string; lowerIsBetter: boolean } | null;
  baseline: { value: number; at: string | null } | null;
  current: { value: number; at: string } | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Who last set the status (creation counts); null for an automatic change or when unknown. */
  statusChangedBy: PersonRef | null;
  /** When the status was last set (UTC); null when unknown. */
  statusChangedAt: string | null;
  /** The status history, newest first (listTeamActions; empty elsewhere and for old rows). */
  history: ActionEventJson[];
  outcomes: Array<{ checkpoint: 'completion' | 'd14' | 'd30'; label: string; dueAt: string | null; value: number | null; valueAt: string | null; outcome: Outcome | 'pending' }>;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function actionJson(r: any, now = Date.now()): ActionJson {
  const m = r.metric_key && isTargetMetric(r.metric_key) ? r.metric_key : null;
  const completedAt = iso(r.completed_at);
  const due = r.due_date ? String(r.due_date).slice(0, 10) : null;
  const checkpoint = (k: 'completion' | 'd14' | 'd30', label: string) => {
    const dueAt = !completedAt ? null : k === 'completion' ? completedAt : new Date(Date.parse(completedAt) + CHECKPOINT_DAYS[k] * 86_400_000).toISOString();
    const prefix = k === 'completion' ? 'completion' : k;
    const outcome = r[`${prefix}_outcome`] as Outcome | null;
    return { checkpoint: k, label, dueAt, value: num(r[`${prefix}_value`]), valueAt: iso(r[`${prefix}_value_at`]), outcome: outcome ?? ('pending' as const) };
  };
  const cur = r.current_value && typeof r.current_value === 'object' ? r.current_value : null;
  return {
    id: r.id,
    teamId: r.team_id,
    teamName: r.team_name,
    title: r.title,
    description: r.description ?? null,
    origin: r.origin,
    alertId: r.alert_id ?? null,
    recommendation: r.recommendation_id ? { id: r.recommendation_id, title: r.recommendation_title ?? 'Recommendation' } : null,
    owner: r.owner_id ? { id: r.owner_id, name: r.owner_name ?? r.owner_email ?? 'Unknown' } : null,
    dueDate: due,
    overdue: !!due && (r.status === 'open' || r.status === 'in_progress') && due < todayIso(),
    status: r.status,
    metric: m ? { key: m, label: metricLabel(m), unit: metricUnit(m), lowerIsBetter: lowerIsBetterOf(m) } : null,
    baseline: r.baseline_value === null || r.baseline_value === undefined ? null : { value: Number(r.baseline_value), at: iso(r.baseline_at) },
    current: cur && cur.value !== null && cur.value !== undefined ? { value: Number(cur.value), at: new Date(cur.recordedAt).toISOString() } : null,
    createdBy: r.created_by_name ?? null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    completedAt,
    statusChangedBy: r.status_changed_by ? { id: r.status_changed_by, name: r.status_changed_by_name ?? UNNAMED } : null,
    statusChangedAt: iso(r.status_changed_at),
    history: [],
    outcomes: r.status === 'done' && m ? [checkpoint('completion', 'At completion'), checkpoint('d14', 'After 14 days'), checkpoint('d30', 'After 30 days')] : [],
  };
}

/** Actions of a team (newest first, open ones before closed ones); due outcomes are computed first. */
export async function listTeamActions(companyId: string, teamId: string): Promise<ActionJson[]> {
  await refreshActionOutcomes(companyId, { teamIds: [teamId] });
  const rows = await query<any>(
    `${ACTION_SELECT} WHERE a.company_id = ? AND a.team_id = ?
      ORDER BY CASE a.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 WHEN 'done' THEN 2 ELSE 3 END, a.due_date NULLS LAST, a.created_at DESC
      LIMIT 200`,
    [companyId, teamId]
  );
  const out: ActionJson[] = rows.map((r: any) => actionJson(r));
  const histories = await actionHistories(companyId, out.map((a) => a.id));
  for (const a of out) a.history = histories.get(a.id) ?? [];
  const { actionMovement } = await import('./recommendations/store');
  for (const a of out) a.movement = a.metric ? await actionMovement(teamId, a.metric.key, a.createdAt) : null;
  return out;
}

/** Actions of several teams (digest): open / in progress, and done in the last `doneDays` days. */
export async function actionsForTeams(companyId: string, teamIds: string[], doneDays = 45): Promise<ActionJson[]> {
  if (!teamIds.length) return [];
  await refreshActionOutcomes(companyId, { teamIds });
  const rows = await query<any>(
    `${ACTION_SELECT} WHERE a.company_id = ? AND a.team_id = ANY(?::text[])
        AND (a.status IN ('open', 'in_progress') OR (a.status = 'done' AND a.completed_at >= NOW() - (CAST(? AS INTEGER) * INTERVAL '1 day')))
      ORDER BY a.due_date NULLS LAST, a.created_at DESC LIMIT 500`,
    [companyId, teamIds, doneDays]
  );
  return rows.map((r: any) => actionJson(r));
}

export async function getActionRow(companyId: string, id: string): Promise<any | null> {
  return queryOne<any>(`${ACTION_SELECT} WHERE a.company_id = ? AND a.id = ?`, [companyId, id]);
}

/* ------------------------------------------------------------------------------------------
 * Writes (audited)
 * ---------------------------------------------------------------------------------------- */

const auditState = (r: any) => r && ({
  title: r.title, description: r.description ?? null, owner_id: r.owner_id ?? null, due_date: r.due_date ? String(r.due_date).slice(0, 10) : null,
  status: r.status, metric_key: r.metric_key ?? null, baseline_value: num(r.baseline_value), completed_at: iso(r.completed_at),
});

/** actorId: the signed-in user; null / empty for a change made by the system (recorded as automatic). */
export interface ActionContext { companyId: string; actorId: string | null; team: { id: string; name: string; department_id: string | null } }

export interface NewAction { title: string; description: string | null; ownerId: string | null; dueDate: string | null; metricKey: TargetMetric | null; origin: ActionOrigin; alertId: string | null; recommendationId?: string | null }

/**
 * Create an action (status open) with its "created" history row. Runs in its own transaction, or in
 * the caller's when `client` is given (accepting a recommendation creates the action and records the
 * decision in one transaction).
 */
export async function createAction(ctx: ActionContext, input: NewAction, client?: PoolClient): Promise<string> {
  if (!client) return transaction((c) => createAction(ctx, input, c));
  {
    const exec = execOn(client);
    const nowIso = new Date().toISOString();
    const actorId = ctx.actorId || null;
    const baseline = input.metricKey ? await valueBetween(ctx.team.id, input.metricKey, null, nowIso, exec) : null;
    const [row] = await exec<any>(
      `INSERT INTO team_actions (company_id, team_id, title, description, origin, alert_id, recommendation_id, owner_id, due_date, status, metric_key, baseline_value, baseline_at,
                                 created_by, created_at, updated_at, status_changed_by, status_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::date, 'open', ?, ?, ?::timestamptz, ?, ?::timestamptz, ?::timestamptz, ?, ?::timestamptz) RETURNING *`,
      [ctx.companyId, ctx.team.id, input.title, input.description, input.origin, input.alertId, input.recommendationId ?? null, input.ownerId, input.dueDate,
        input.metricKey, baseline?.value ?? null, baseline?.recordedAt ?? null, actorId, nowIso, nowIso, actorId, nowIso]
    );
    await recordStatusEvent(exec, { companyId: ctx.companyId, teamId: ctx.team.id, actionId: row.id, from: null, to: 'open', actorId, at: nowIso });
    await recordAudit({
      companyId: ctx.companyId, actorId: ctx.actorId, action: 'action.create', entityType: 'action', entityId: row.id,
      summary: `Created action "${input.title}" for team ${ctx.team.name}`, before: null, after: auditState(row),
      departmentIds: [ctx.team.department_id], subjectIds: [row.id, ctx.team.id, input.ownerId],
    }, exec);
    return row.id as string;
  }
}

export interface ActionPatch { title?: string; description?: string | null; ownerId?: string | null; dueDate?: string | null; status?: ActionStatus; metricKey?: TargetMetric | null }

export async function updateAction(ctx: ActionContext, id: string, patch: ActionPatch): Promise<{ changed: string[] }> {
  return transaction(async (client) => {
    const exec = execOn(client);
    const [before] = await exec<any>('SELECT * FROM team_actions WHERE id = ? AND company_id = ? FOR UPDATE', [id, ctx.companyId]);
    if (!before) throw new ActionError(404, 'Action not found');
    const set: Record<string, any> = {};
    if (patch.title !== undefined && patch.title !== before.title) set.title = patch.title;
    if (patch.description !== undefined && patch.description !== (before.description ?? null)) set.description = patch.description;
    if (patch.ownerId !== undefined && patch.ownerId !== (before.owner_id ?? null)) set.owner_id = patch.ownerId;
    const beforeDue = before.due_date ? String(before.due_date).slice(0, 10) : null;
    if (patch.dueDate !== undefined && patch.dueDate !== beforeDue) set.due_date = patch.dueDate;
    const nowIso = new Date().toISOString();
    if (patch.metricKey !== undefined && patch.metricKey !== (before.metric_key ?? null)) {
      // A different metric gets its own baseline (the latest value now).
      const b = patch.metricKey ? await valueBetween(before.team_id, patch.metricKey, null, nowIso, exec) : null;
      Object.assign(set, { metric_key: patch.metricKey, baseline_value: b?.value ?? null, baseline_at: b?.recordedAt ?? null });
    }
    const clearOutcomes = { completed_at: null, completion_value: null, completion_value_at: null, completion_outcome: null, d14_value: null, d14_value_at: null, d14_outcome: null, d30_value: null, d30_value_at: null, d30_outcome: null };
    const metricChanged = 'metric_key' in set;
    if (patch.status !== undefined && patch.status !== before.status) {
      set.status = patch.status;
      Object.assign(set, { status_changed_by: ctx.actorId || null, status_changed_at: nowIso });
      if (patch.status === 'done') {
        const c = await completionCheckpoint({ ...before, ...set }, nowIso, exec);
        Object.assign(set, clearOutcomes, { completed_at: nowIso, completion_value: c.value, completion_value_at: c.at, completion_outcome: c.outcome });
      } else if (before.status === 'done') {
        Object.assign(set, clearOutcomes);
      }
    } else if (metricChanged && before.status === 'done') {
      // The outcome of a done action follows its (new) metric.
      const c = await completionCheckpoint({ ...before, ...set }, new Date(before.completed_at).toISOString(), exec);
      Object.assign(set, { ...clearOutcomes, completed_at: new Date(before.completed_at).toISOString(), completion_value: c.value, completion_value_at: c.at, completion_outcome: c.outcome });
    }
    const keys = Object.keys(set);
    if (!keys.length) return { changed: [] };
    const [after] = await exec<any>(
      `UPDATE team_actions SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ?::timestamptz WHERE id = ? RETURNING *`,
      [...keys.map((k) => set[k]), nowIso, id]
    );
    if (set.status) {
      await recordStatusEvent(exec, { companyId: ctx.companyId, teamId: before.team_id, actionId: id, from: before.status, to: set.status, actorId: ctx.actorId || null, at: nowIso });
    }
    const changed = keys.filter((k) => !k.startsWith('completion_') && !k.startsWith('d14_') && !k.startsWith('d30_') && !k.startsWith('status_changed_') && k !== 'baseline_at' && k !== 'completed_at');
    await recordAudit({
      companyId: ctx.companyId, actorId: ctx.actorId, action: patch.status && patch.status !== before.status ? 'action.status' : 'action.update', entityType: 'action', entityId: id,
      summary: `Updated action "${after.title}" (team ${ctx.team.name}): ${changed.join(', ')}${set.status ? ` → ${set.status}` : ''}`,
      before: auditState(before), after: auditState(after),
      departmentIds: [ctx.team.department_id], subjectIds: [id, ctx.team.id, before.owner_id, after.owner_id],
    }, exec);
    return { changed };
  });
}

export async function deleteAction(ctx: ActionContext, id: string): Promise<void> {
  await transaction(async (client) => {
    const exec = execOn(client);
    const [before] = await exec<any>('SELECT * FROM team_actions WHERE id = ? AND company_id = ? FOR UPDATE', [id, ctx.companyId]);
    if (!before) throw new ActionError(404, 'Action not found');
    await exec('DELETE FROM team_actions WHERE id = ?', [id]);
    await recordAudit({
      companyId: ctx.companyId, actorId: ctx.actorId, action: 'action.delete', entityType: 'action', entityId: id,
      summary: `Deleted action "${before.title}" (team ${ctx.team.name})`, before: auditState(before), after: null,
      departmentIds: [ctx.team.department_id], subjectIds: [id, ctx.team.id, before.owner_id],
    }, exec);
  });
}

export { ACTION_METRICS as ACTION_METRIC_KEYS, metricLabel };
