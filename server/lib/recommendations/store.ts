/**
 * Recommendations of a team (table recommendations) and the "Improve" refresh of a team:
 * forecasts first (server/lib/forecast/store.ts), then the rules (rules.ts) on the team's facts
 * (load.ts). One row per team, rule and subject:
 *   - a rule that fires: an open row gets the new evidence, effect, confidence and rank; an
 *     accepted or dismissed row keeps the content it had when it was decided (it is history);
 *   - a rule that no longer fires: active = false (an open row is then hidden).
 * Accept → a tracked action (team_actions, origin 'recommendation', recommendation_id, linked to
 * the metric; its baseline and outcome are computed like every action's). Dismiss → a reason.
 * Reopen → back to open (a dismissed one, or an accepted one whose action was deleted).
 */
import { query, queryOne, transaction } from '../../../src/lib/db';
import { execOn } from '../assignments';
import { recordAudit } from '../audit';
import { loadTargetBook, isTargetMetric, type TargetMetric } from '../targets';
import { loadIntervals } from '../staleness';
import { createAction, ActionError, lowerIsBetterOf, judgeOutcome } from '../actions';
import { refreshTeamForecasts, loadTeamForecasts, metricMeta, FORECAST_MAX_AGE_HOURS, type ForecastJson, type TeamRefLite } from '../forecast/store';
import { loadTeamFacts } from './load';
import { effectText, recommend, type Effect, type Recommendation } from './rules';

export const RECOMMENDATION_RULE_TEXT =
  'Rule-based and deterministic: each rule checks this team’s own numbers (KPI history, forecasts and, when CI data is sent, the tests, files and stages behind them). ' +
  'Ranked by expected effect on its metric (in watch bands of that metric) × confidence, with a bonus when the metric’s forecast worsens. ' +
  'The expected effect is a range from the team’s own history or from the evidence; it is an estimate, not a promise.';

export const DISMISS_REASONS = ['Not relevant for this team', 'Already being handled', 'The data is wrong', 'Not now (later)', 'Other'] as const;

export type TeamRow = TeamRefLite & { name: string };

export interface ImproveRefresh { forecasts: number; recommendations: number; ms: number }

/** Recalculate the forecasts and the recommendations of one team. */
export async function refreshTeamImprove(team: TeamRow, opts: { asOf?: string } = {}): Promise<ImproveRefresh> {
  const t0 = Date.now();
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const book = await loadTargetBook(team.company_id);
  const ctx = { companyId: team.company_id, intervals: await loadIntervals(team.company_id), book };
  const forecasts = await refreshTeamForecasts(team, { asOf, book, ctx });
  const facts = await loadTeamFacts(team, forecasts, book, ctx, asOf);
  const recs = recommend(facts);
  await storeRecommendations(team, recs);
  return { forecasts: forecasts.length, recommendations: recs.length, ms: Date.now() - t0 };
}

export async function storeRecommendations(team: TeamRow, recs: Recommendation[]): Promise<void> {
  await transaction(async (client) => {
    const exec = execOn(client);
    const fired = recs.map((r) => `${r.ruleKey}|${r.subjectKey}`);
    await exec(
      `UPDATE recommendations SET active = FALSE, rank = NULL, computed_at = now()
        WHERE team_id = ? AND active AND NOT ((rule_key || '|' || subject_key) = ANY(?::text[]))`,
      [team.id, fired]
    );
    let rank = 0;
    for (const r of recs) {
      rank++;
      await exec(
        `INSERT INTO recommendations (company_id, team_id, rule_key, subject_key, title, evidence, items, next_step, metric_key, effect, confidence, score, rank, active, status, computed_at)
         VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?::jsonb, ?, ?, ?, TRUE, 'open', now())
         ON CONFLICT (team_id, rule_key, subject_key) DO UPDATE SET
           active = TRUE, rank = EXCLUDED.rank, computed_at = now(),
           title = CASE WHEN recommendations.status = 'open' THEN EXCLUDED.title ELSE recommendations.title END,
           evidence = CASE WHEN recommendations.status = 'open' THEN EXCLUDED.evidence ELSE recommendations.evidence END,
           items = CASE WHEN recommendations.status = 'open' THEN EXCLUDED.items ELSE recommendations.items END,
           next_step = CASE WHEN recommendations.status = 'open' THEN EXCLUDED.next_step ELSE recommendations.next_step END,
           metric_key = CASE WHEN recommendations.status = 'open' THEN EXCLUDED.metric_key ELSE recommendations.metric_key END,
           effect = CASE WHEN recommendations.status = 'open' THEN EXCLUDED.effect ELSE recommendations.effect END,
           confidence = CASE WHEN recommendations.status = 'open' THEN EXCLUDED.confidence ELSE recommendations.confidence END,
           score = CASE WHEN recommendations.status = 'open' THEN EXCLUDED.score ELSE recommendations.score END,
           first_seen = CASE WHEN recommendations.active OR recommendations.status <> 'open' THEN recommendations.first_seen ELSE now() END`,
        [team.company_id, team.id, r.ruleKey, r.subjectKey, r.title, JSON.stringify(r.evidence), JSON.stringify(r.items), r.nextStep,
          r.metricKey, r.effect ? JSON.stringify(r.effect) : null, r.confidence, r.score, rank]
      );
    }
  });
}

/** Whether the team's forecasts / recommendations are due: none yet, older than the max age, or older than the newest value. */
export async function improveIsStale(teamId: string, maxAgeHours = FORECAST_MAX_AGE_HOURS): Promise<boolean> {
  const r = await queryOne<any>(
    `SELECT (SELECT min(computed_at) FROM forecasts WHERE team_id = ?) AS fc,
            (SELECT max(received_at) FROM metric_values WHERE team_id = ?) AS newest,
            (SELECT count(*) FROM recommendations WHERE team_id = ?)::int AS recs`,
    [teamId, teamId, teamId]
  );
  if (!r?.fc) return !!r?.newest;
  const fc = new Date(r.fc).getTime();
  if (Date.now() - fc > maxAgeHours * 3_600_000) return true;
  return !!r.newest && new Date(r.newest).getTime() > fc;
}

/* ------------------------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------------------------- */

export interface Movement {
  metric: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  before: { value: number; day: string } | null;
  after: { value: number; day: string } | null;
  change: number | null;
  verdict: 'improved' | 'unchanged' | 'worse' | 'no_data';
}

/**
 * Before / after of an action's metric from the snapshot history: the team's KPI snapshot on the
 * day the action was created (or the latest before it) and its latest snapshot since then.
 */
export async function actionMovement(teamId: string, metric: string, createdAt: string): Promise<Movement | null> {
  if (!isTargetMetric(metric)) return null;
  const col = metric; // a KPI column name (validated above)
  const before = await queryOne<any>(
    `SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS day, ${col}::float8 AS v FROM kpi_snapshots
      WHERE team_id = ? AND snapshot_date <= (?::timestamptz AT TIME ZONE 'UTC')::date AND ${col} IS NOT NULL
      ORDER BY snapshot_date DESC LIMIT 1`, [teamId, createdAt]);
  const after = await queryOne<any>(
    `SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS day, ${col}::float8 AS v FROM kpi_snapshots
      WHERE team_id = ? AND snapshot_date > (?::timestamptz AT TIME ZONE 'UTC')::date AND ${col} IS NOT NULL
      ORDER BY snapshot_date DESC LIMIT 1`, [teamId, createdAt]);
  const meta = metricMeta(metric);
  const lower = lowerIsBetterOf(metric as TargetMetric);
  const b = before ? { value: Number(before.v), day: before.day } : null;
  const a = after ? { value: Number(after.v), day: after.day } : null;
  return {
    metric, label: meta.label, unit: meta.unit, lowerIsBetter: lower, before: b, after: a,
    change: a && b ? Math.round((a.value - b.value) * 1000) / 1000 : null,
    verdict: a && b ? judgeOutcome(b.value, a.value, lower) : 'no_data',
  };
}

export interface RecommendationJson {
  id: string;
  teamId: string;
  ruleKey: string;
  title: string;
  evidence: Array<{ label: string; value: string; detail?: string }>;
  items: Array<{ kind: string; name: string; detail: string }>;
  nextStep: string;
  metric: { key: string; label: string; unit: string } | null;
  effect: Effect | null;
  effectText: string | null;
  confidence: 'high' | 'medium' | 'low';
  rank: number | null;
  active: boolean;
  status: 'open' | 'accepted' | 'dismissed';
  dismissReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  firstSeen: string;
  computedAt: string;
  action: { id: string; title: string; status: string; owner: string | null; dueDate: string | null; createdAt: string; movement: Movement | null } | null;
}

export function recommendationJson(r: any): RecommendationJson {
  const effect: Effect | null = r.effect ?? null;
  const meta = r.metric_key ? metricMeta(r.metric_key) : null;
  return {
    id: r.id, teamId: r.team_id, ruleKey: r.rule_key, title: r.title,
    evidence: Array.isArray(r.evidence) ? r.evidence : [], items: Array.isArray(r.items) ? r.items : [], nextStep: r.next_step,
    metric: meta ? { key: r.metric_key, label: meta.label, unit: meta.unit } : null,
    effect, effectText: effect ? effectText(effect) : null,
    confidence: r.confidence, rank: r.rank === null || r.rank === undefined ? null : Number(r.rank), active: !!r.active,
    status: r.status, dismissReason: r.dismiss_reason ?? null, decidedBy: r.decided_by_name ?? null,
    decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
    firstSeen: new Date(r.first_seen).toISOString(), computedAt: new Date(r.computed_at).toISOString(),
    action: null,
  };
}

const REC_SELECT = `
  SELECT r.*, NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS decided_by_name,
         a.id AS a_id, a.title AS a_title, a.status AS a_status, a.due_date AS a_due, a.created_at AS a_created, a.metric_key AS a_metric,
         NULLIF(TRIM(COALESCE(o.first_name, '') || ' ' || COALESCE(o.last_name, '')), '') AS a_owner
    FROM recommendations r
    LEFT JOIN users u ON u.id = r.decided_by
    LEFT JOIN team_actions a ON a.id = r.action_id
    LEFT JOIN users o ON o.id = a.owner_id`;

/** The recommendations of a team to show: open and active ones by rank, then accepted, then dismissed. */
export async function listTeamRecommendations(teamId: string): Promise<{ open: RecommendationJson[]; accepted: RecommendationJson[]; dismissed: RecommendationJson[] }> {
  const rows = await query<any[]>(`${REC_SELECT} WHERE r.team_id = ? AND (r.active OR r.status <> 'open') ORDER BY r.rank NULLS LAST, r.score DESC, r.decided_at DESC`, [teamId]);
  const out = { open: [] as RecommendationJson[], accepted: [] as RecommendationJson[], dismissed: [] as RecommendationJson[] };
  for (const r of rows) {
    const j = recommendationJson(r);
    if (r.a_id) {
      j.action = {
        id: r.a_id, title: r.a_title, status: r.a_status, owner: r.a_owner ?? null,
        dueDate: r.a_due ? String(r.a_due).slice(0, 10) : null, createdAt: new Date(r.a_created).toISOString(),
        movement: r.a_metric ? await actionMovement(teamId, r.a_metric, new Date(r.a_created).toISOString()) : null,
      };
    }
    out[j.status].push(j);
  }
  out.accepted.sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));
  out.dismissed.sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));
  return out;
}

export async function getRecommendationRow(companyId: string, id: string): Promise<any | null> {
  return queryOne<any>(`${REC_SELECT} WHERE r.company_id = ? AND r.id = ?`, [companyId, id]);
}

export { loadTeamForecasts, type ForecastJson };

/* ------------------------------------------------------------------------------------------
 * Decisions (audited)
 * ---------------------------------------------------------------------------------------- */

interface DecisionContext { companyId: string; actorId: string; team: { id: string; name: string; department_id: string | null } }

/** Accept: create the tracked action (linked to the recommendation and its metric). Returns the action id. */
export async function acceptRecommendation(ctx: DecisionContext, rec: any, input: { ownerId: string | null; dueDate: string | null; title?: string | null }): Promise<string> {
  if (rec.status === 'accepted' && rec.action_id) throw new ActionError(409, 'This recommendation is already in the Action plan');
  if (rec.status === 'open' && !rec.active) throw new ActionError(409, 'This recommendation no longer applies (the data changed); reload the page');
  const effect: Effect | null = rec.effect ?? null;
  const description = [
    `Next step: ${rec.next_step}`,
    effect ? `Expected effect: ${effectText(effect)} (based on ${effect.basis}).` : null,
    'From a recommendation (Team detail → Recommendations).',
  ].filter(Boolean).join('\n').slice(0, 2000);
  const title = (input.title && input.title.trim().length >= 3 ? input.title.trim() : rec.title).replace(/\s+/g, ' ').slice(0, 200);
  const metricKey = rec.metric_key && isTargetMetric(rec.metric_key) ? (rec.metric_key as TargetMetric) : null;
  // One transaction: the action (with its "created" history row) and the decision.
  return transaction(async (client) => {
    const exec = execOn(client);
    const actionId = await createAction(ctx, { title, description, ownerId: input.ownerId, dueDate: input.dueDate, metricKey, origin: 'recommendation', alertId: null, recommendationId: rec.id }, client);
    await exec(`UPDATE recommendations SET status = 'accepted', action_id = ?, dismiss_reason = NULL, decided_by = ?, decided_at = now() WHERE id = ?`, [actionId, ctx.actorId || null, rec.id]);
    await recordAudit({
      companyId: ctx.companyId, actorId: ctx.actorId, action: 'recommendation.accept', entityType: 'recommendation', entityId: rec.id,
      summary: `Added the recommendation "${rec.title}" to the Action plan of team ${ctx.team.name}`, before: { status: rec.status }, after: { status: 'accepted', action_id: actionId },
      departmentIds: [ctx.team.department_id], subjectIds: [rec.id, ctx.team.id, actionId],
    }, exec);
    return actionId;
  });
}

export function cleanDismissReason(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (s.length < 3 || s.length > 500) throw new ActionError(400, 'Give a reason of 3 to 500 characters');
  return s;
}

export async function dismissRecommendation(ctx: DecisionContext, rec: any, reason: string): Promise<void> {
  if (rec.status === 'accepted' && rec.action_id) throw new ActionError(409, 'This recommendation is in the Action plan; drop or delete the action instead');
  await transaction(async (client) => {
    const exec = execOn(client);
    await exec(`UPDATE recommendations SET status = 'dismissed', dismiss_reason = ?, decided_by = ?, decided_at = now() WHERE id = ?`, [reason, ctx.actorId || null, rec.id]);
    await recordAudit({
      companyId: ctx.companyId, actorId: ctx.actorId, action: 'recommendation.dismiss', entityType: 'recommendation', entityId: rec.id,
      summary: `Dismissed the recommendation "${rec.title}" for team ${ctx.team.name}: ${reason}`, before: { status: rec.status }, after: { status: 'dismissed', reason },
      departmentIds: [ctx.team.department_id], subjectIds: [rec.id, ctx.team.id],
    }, exec);
  });
}

export async function reopenRecommendation(ctx: DecisionContext, rec: any): Promise<void> {
  if (rec.status === 'open') throw new ActionError(409, 'This recommendation is already open');
  if (rec.status === 'accepted' && rec.action_id) throw new ActionError(409, 'This recommendation is in the Action plan; delete the action to reopen it');
  await transaction(async (client) => {
    const exec = execOn(client);
    await exec(`UPDATE recommendations SET status = 'open', action_id = NULL, dismiss_reason = NULL, decided_by = ?, decided_at = now() WHERE id = ?`, [ctx.actorId || null, rec.id]);
    await recordAudit({
      companyId: ctx.companyId, actorId: ctx.actorId, action: 'recommendation.reopen', entityType: 'recommendation', entityId: rec.id,
      summary: `Reopened the recommendation "${rec.title}" for team ${ctx.team.name}`, before: { status: rec.status, reason: rec.dismiss_reason ?? null }, after: { status: 'open' },
      departmentIds: [ctx.team.department_id], subjectIds: [rec.id, ctx.team.id],
    }, exec);
  });
}

/* ------------------------------------------------------------------------------------------
 * Scheduled refresh (hourly job; within a time budget)
 * ---------------------------------------------------------------------------------------- */

/**
 * Refresh the teams whose forecasts are due (none yet, older than FORECAST_MAX_AGE_HOURS, or older
 * than their newest value), oldest first, until the budget is spent. Active teams with at least one
 * stored value only. The first runs after the migration backfill every team this way.
 */
export async function refreshDueTeams(budgetMs = Number(process.env.IMPROVE_REFRESH_BUDGET_MS) || 8_000): Promise<{ teams: number; skipped: number; failed: number }> {
  const started = Date.now();
  const due = await query<any[]>(
    `SELECT t.id, t.company_id, t.department_id, t.name
       FROM teams t JOIN companies c ON c.id = t.company_id
       LEFT JOIN LATERAL (SELECT min(computed_at) AS fc FROM forecasts f WHERE f.team_id = t.id) f ON TRUE
       LEFT JOIN LATERAL (SELECT max(received_at) AS newest FROM metric_values mv WHERE mv.team_id = t.id) mv ON TRUE
      WHERE t.is_active AND COALESCE(c.status, 'active') <> 'suspended' AND mv.newest IS NOT NULL
        AND (f.fc IS NULL OR f.fc < now() - make_interval(hours => ?) OR mv.newest > f.fc)
      ORDER BY f.fc NULLS FIRST, t.id`,
    [FORECAST_MAX_AGE_HOURS]
  );
  let teams = 0, failed = 0;
  for (const t of due) {
    if (Date.now() - started > budgetMs) break;
    try {
      await refreshTeamImprove({ id: String(t.id), company_id: String(t.company_id), department_id: t.department_id ? String(t.department_id) : null, name: t.name });
      teams++;
    } catch (e: any) {
      failed++;
      console.error(`[improve] team ${t.id} failed:`, e?.message ?? e);
    }
  }
  return { teams, skipped: due.length - teams - failed, failed };
}
