/**
 * Alerts: rules (per company, with department and team overrides) and the ONE evaluator.
 *
 * Rules (RULE_DEFS):
 *   threshold_breach   a KPI's current value is at warning or critical against the target valid
 *                      at the value's date (server/lib/targets.ts; status as on Team detail,
 *                      statusFor in src/data/detailedKPIs.ts). Stale values are not judged.
 *                      One alert per team and metric; severity = the status.
 *   metric_stale       one or more KPIs are older than their expected update interval
 *                      (server/lib/staleness.ts). One alert per team (severity info).
 *   score_drop         the QA score (stale inputs left out, as everywhere) fell by at least
 *                      `points` within `days` days. Severity warning, critical at twice the drop.
 *   ingestion_failure  at least `count` rejected or partial ingestion requests (ingestion_log)
 *                      in the last `hours` hours, per team named in the requests, or at company
 *                      level for requests naming no team. Severity warning.
 * A rule's settings come from the team's own row, else its department's, else the company's,
 * else the defaults below (alert_rules).
 *
 * evaluateCompany() runs after every KPI write (ingestion API, Manual metrics, the synthetic
 * generators: afterKpiWrite) and on a schedule (server/jobs/alertsCron.ts,
 * netlify/functions/alerts-evaluate.ts). It keeps exactly one OPEN alert per condition
 * (dedupe_key rule|team|metric): a new condition opens an alert, a still-true one is refreshed
 * (severity, message, last_seen_at), a condition that is gone resolves its alert. New and
 * escalated alerts are handed to the notifier (server/lib/notifications.ts).
 */
import type pg from 'pg';
import { pool, query, toPgPlaceholders } from '../../src/lib/db';
import { KPI_COLUMNS, KPI_COLUMN_NAMES, onKpiWritten } from './kpiIngest';
import { evaluateSnapshot, KPI_CAMEL, type EvalContext } from './kpiEvaluation';
import { loadIntervals, referenceFor, referenceForRow } from './staleness';
import { loadTargetBook, TARGET_METRIC_KEYS, TARGET_METRICS, type TargetMetric } from './targets';
import { statusFor } from '../../src/data/detailedKPIs';

export type AlertRule = 'threshold_breach' | 'metric_stale' | 'score_drop' | 'ingestion_failure';
export type Severity = 'info' | 'warning' | 'critical';
export const SEVERITIES: Severity[] = ['info', 'warning', 'critical'];
export const SEVERITY_RANK: Record<Severity, number> = { info: 1, warning: 2, critical: 3 };
export const isSeverity = (s: unknown): s is Severity => typeof s === 'string' && (SEVERITIES as string[]).includes(s);
export const atLeast = (s: Severity, min: Severity) => SEVERITY_RANK[s] >= SEVERITY_RANK[min];

export interface ParamSpec {
  key: string;
  label: string;
  type: 'number' | 'severity';
  min?: number;
  max?: number;
  unit?: string;
}

export interface RuleDef {
  rule: AlertRule;
  label: string;
  description: string;
  defaults: { enabled: boolean; params: Record<string, number | string> };
  params: ParamSpec[];
}

export const RULE_DEFS: Record<AlertRule, RuleDef> = {
  threshold_breach: {
    rule: 'threshold_breach',
    label: 'KPI off target',
    description: 'A KPI’s current value is at watch (warning) or off target (critical) against the target valid at its date. Stale values are not judged.',
    defaults: { enabled: true, params: { minSeverity: 'warning' } },
    params: [{ key: 'minSeverity', label: 'Alert from', type: 'severity' }],
  },
  metric_stale: {
    rule: 'metric_stale',
    label: 'Metric stale',
    description: 'A KPI has not been updated within its expected update interval (Administration → Update frequency).',
    defaults: { enabled: true, params: {} },
    params: [],
  },
  score_drop: {
    rule: 'score_drop',
    label: 'QA score drop',
    description: 'The QA score fell by at least the given points within the given days (critical at twice the drop).',
    defaults: { enabled: true, params: { points: 10, days: 7 } },
    params: [
      { key: 'points', label: 'Drop of at least', type: 'number', min: 1, max: 100, unit: 'points' },
      { key: 'days', label: 'Within', type: 'number', min: 1, max: 60, unit: 'days' },
    ],
  },
  ingestion_failure: {
    rule: 'ingestion_failure',
    label: 'Ingestion failures',
    description: 'Rejected or partially rejected requests to the KPI ingestion API (Administration → Ingestion log).',
    defaults: { enabled: true, params: { count: 1, hours: 24 } },
    params: [
      { key: 'count', label: 'At least', type: 'number', min: 1, max: 1000, unit: 'failed requests' },
      { key: 'hours', label: 'In the last', type: 'number', min: 1, max: 720, unit: 'hours' },
    ],
  },
};
export const ALERT_RULES = Object.keys(RULE_DEFS) as AlertRule[];
export const isAlertRule = (r: unknown): r is AlertRule => typeof r === 'string' && (ALERT_RULES as string[]).includes(r);

export interface RuleSetting {
  enabled: boolean;
  params: Record<string, number | string>;
  /** Where the setting comes from. */
  scope: 'team' | 'department' | 'company' | 'default';
}

/** Validate and normalise a rule's params (unknown keys dropped, defaults filled in). Throws a message on invalid input. */
export function normaliseParams(rule: AlertRule, raw: unknown): Record<string, number | string> {
  const def = RULE_DEFS[rule];
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, number | string> = {};
  for (const p of def.params) {
    const v = src[p.key];
    if (v === undefined || v === null || v === '') { out[p.key] = def.defaults.params[p.key]; continue; }
    if (p.type === 'severity') {
      if (!isSeverity(v) || v === 'info') throw new Error(`${p.label}: choose warning or critical`);
      out[p.key] = v;
    } else {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < (p.min ?? -Infinity) || n > (p.max ?? Infinity)) {
        throw new Error(`${p.label} must be a whole number from ${p.min} to ${p.max}`);
      }
      out[p.key] = n;
    }
  }
  return out;
}

/** All alert_rules rows of a company, resolved per team (team > department > company > default). */
export class RuleBook {
  private rows = new Map<string, { enabled: boolean; params: Record<string, number | string> }>();
  constructor(rows: Array<{ scope_type: string; scope_id: string; rule: string; enabled: boolean; params: any }>) {
    for (const r of rows) {
      if (!isAlertRule(r.rule)) continue;
      let params: Record<string, number | string>;
      try { params = normaliseParams(r.rule, r.params); } catch { params = { ...RULE_DEFS[r.rule].defaults.params }; }
      this.rows.set(`${r.scope_type}|${r.scope_id}|${r.rule}`, { enabled: !!r.enabled, params });
    }
  }
  own(scopeType: string, scopeId: string, rule: AlertRule) {
    return this.rows.get(`${scopeType}|${scopeId}|${rule}`) ?? null;
  }
  /** The setting a team (or, with only a department / company, that level) gets. */
  resolve(rule: AlertRule, ref: { companyId: string; departmentId?: string | null; teamId?: string | null }): RuleSetting {
    const chain: Array<[RuleSetting['scope'], string | null | undefined]> = [['team', ref.teamId], ['department', ref.departmentId], ['company', ref.companyId]];
    for (const [scope, id] of chain) {
      if (!id) continue;
      const r = this.own(scope, id, rule);
      if (r) return { ...r, scope };
    }
    const d = RULE_DEFS[rule].defaults;
    return { enabled: d.enabled, params: { ...d.params }, scope: 'default' };
  }
}

export async function loadRuleBook(companyId: string): Promise<RuleBook> {
  const rows = await query<any[]>('SELECT scope_type, scope_id, rule, enabled, params FROM alert_rules WHERE company_id = ?', [companyId]);
  return new RuleBook(rows);
}

/* ------------------------------------------------------------------------------------------
 * Conditions
 * ---------------------------------------------------------------------------------------- */

export interface Condition {
  teamId: string | null;
  rule: AlertRule;
  metricKey: string | null;
  severity: Severity;
  message: string;
  details: Record<string, unknown>;
}

export const dedupeKey = (c: Pick<Condition, 'rule' | 'teamId' | 'metricKey'>) => `${c.rule}|${c.teamId ?? '-'}|${c.metricKey ?? '-'}`;

const unitText = (u?: string) => (!u ? '' : u === '%' || u.startsWith('/') ? u : ` ${u}`);
const fmtNum = (v: number) => (Math.abs(v) >= 100 ? String(Math.round(v * 10) / 10) : String(Math.round(v * 100) / 100));
export const metricLabel = (col: string) => (KPI_COLUMNS as Record<string, { label: string; unit?: string }>)[col]?.label ?? (col === 'qa_score' ? 'QA score' : col);
export const metricUnit = (col: string) => (KPI_COLUMNS as Record<string, { label: string; unit?: string }>)[col]?.unit ?? '';

/**
 * The threshold_breach condition of one KPI value against its target (status as on Team detail:
 * statusFor), or null when it is on target or below the rule's minimum severity. Pure: also used
 * by the demo seed, so sample alerts read exactly like evaluated ones.
 */
export function thresholdCondition(
  teamId: string, m: TargetMetric, value: number, t: { good: number; warning: number; lowerIsBetter: boolean; scope?: string },
  min: Severity = 'warning', recordedAt: string | null = null,
): Condition | null {
  const status = statusFor(value, t);
  if (status !== 'warning' && status !== 'critical') return null;
  if (!atLeast(status, min)) return null;
  const u = unitText(metricUnit(m));
  const cmp = t.lowerIsBetter ? '≤' : '≥';
  return {
    teamId, rule: 'threshold_breach', metricKey: m, severity: status,
    message: `${metricLabel(m)} is ${status === 'critical' ? 'off target' : 'at watch level'}: ${fmtNum(value)}${u} (target ${cmp} ${t.good}${u}, watch ${cmp} ${t.warning}${u})`,
    details: { value, recordedAt, good: t.good, warning: t.warning, lowerIsBetter: t.lowerIsBetter, targetScope: t.scope ?? null },
  };
}

interface TeamRow { id: string; name: string; department_id: string | null }

/** The team's QA score composite on the latest snapshot on or before `day` (within `toleranceDays`), or null. */
export async function qaScoreOn(team: TeamRow, ctx: EvalContext, day: string, toleranceDays = 3): Promise<{ value: number | null; day: string } | null> {
  const rows = await query<any[]>(
    `SELECT * FROM kpi_snapshots WHERE team_id = ? AND snapshot_date <= ?::date AND snapshot_date >= ?::date - CAST(? AS INTEGER)
      ORDER BY snapshot_date DESC LIMIT 1`,
    [team.id, day, day, toleranceDays]
  );
  if (!rows.length) return null;
  const d = String(rows[0].snapshot_date).slice(0, 10);
  const ev = evaluateSnapshot(rows[0], team, ctx, referenceForRow(rows[0], d, ctx.now ?? Date.now()));
  return { value: ev.qa.value, day: d };
}

const addDaysIso = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Every condition that holds for one team now (KPI rules), with the rules as resolved for it. */
async function teamConditions(team: TeamRow, companyId: string, latest: any | null, ctx: EvalContext, book: RuleBook): Promise<Condition[]> {
  const out: Condition[] = [];
  if (!latest) return out;
  const now = ctx.now ?? Date.now();
  const ref = { companyId, departmentId: team.department_id, teamId: team.id };
  const ev = evaluateSnapshot(latest, team, ctx, referenceForRow(latest, null, now));

  const threshold = book.resolve('threshold_breach', ref);
  if (threshold.enabled) {
    const min = (threshold.params.minSeverity as Severity) || 'warning';
    for (const m of TARGET_METRIC_KEYS) {
      const info = ev.values[m];
      if (!info || info.stale) continue;
      const value = Number(latest[m]);
      if (!Number.isFinite(value)) continue;
      const c = thresholdCondition(team.id, m, value, ev.thresholds[TARGET_METRICS[m]], min, info.recordedAt);
      if (c) out.push(c);
    }
  }

  const stale = book.resolve('metric_stale', ref);
  if (stale.enabled) {
    const list = KPI_COLUMN_NAMES.filter((c) => ev.values[c]?.stale).map((c) => ({ metric: c, label: metricLabel(c), staleSince: ev.values[c].staleSince, recordedAt: ev.values[c].recordedAt }));
    if (list.length) {
      const names = list.slice(0, 4).map((s) => s.label).join(', ') + (list.length > 4 ? ` and ${list.length - 4} more` : '');
      out.push({
        teamId: team.id, rule: 'metric_stale', metricKey: null, severity: 'info',
        message: `${list.length} ${list.length === 1 ? 'metric is' : 'metrics are'} stale: ${names}`,
        details: { metrics: list },
      });
    }
  }

  const drop = book.resolve('score_drop', ref);
  if (drop.enabled && ev.qa.value !== null) {
    const days = Number(drop.params.days) || 7;
    const points = Number(drop.params.points) || 10;
    const day = String(latest.snapshot_date).slice(0, 10);
    const before = await qaScoreOn(team, ctx, addDaysIso(day, -days));
    if (before && before.value !== null) {
      const delta = ev.qa.value - before.value;
      if (-delta >= points) {
        out.push({
          teamId: team.id, rule: 'score_drop', metricKey: 'qa_score', severity: -delta >= points * 2 ? 'critical' : 'warning',
          message: `QA score fell ${fmtNum(-delta)} points in ${days} days (${fmtNum(before.value)} on ${before.day} → ${fmtNum(ev.qa.value)} on ${day})`,
          details: { from: before.value, fromDay: before.day, to: ev.qa.value, toDay: day, delta, points, days, inputsUsed: ev.qa.inputsUsed, inputsTotal: ev.qa.inputsTotal },
        });
      }
    }
  }
  return out;
}

/** Ingestion-failure conditions for the given teams (and, with includeCompany, the company level). */
async function ingestionConditions(companyId: string, teams: TeamRow[], book: RuleBook, includeCompany: boolean, now: number): Promise<Condition[]> {
  const out: Condition[] = [];
  const settings = teams.map((t) => ({ team: t, s: book.resolve('ingestion_failure', { companyId, departmentId: t.department_id, teamId: t.id }) }));
  const company = book.resolve('ingestion_failure', { companyId });
  const maxHours = Math.max(Number(company.params.hours) || 24, ...settings.map((x) => Number(x.s.params.hours) || 24));
  const rows = await query<any[]>(
    `SELECT id, status, received_at, team_ids, items, source FROM ingestion_log
      WHERE company_id = ? AND channel = 'api' AND status IN ('rejected', 'partial') AND received_at >= to_timestamp(?::double precision / 1000) - (CAST(? AS INTEGER) * INTERVAL '1 hour')
      ORDER BY received_at DESC`,
    [companyId, now, maxHours]
  );
  // Teams a request concerns: those it wrote to (team_ids) and those its items named (a request
  // rejected by validation wrote nothing). Only this company's teams count.
  const companyTeams = new Set((await query<any[]>('SELECT id FROM teams WHERE company_id = ?', [companyId])).map((t: any) => t.id));
  const teamsOf = (r: any): string[] => [...new Set([
    ...(r.team_ids ?? []),
    ...(Array.isArray(r.items) ? r.items.map((i: any) => (i && typeof i.teamId === 'string' ? i.teamId : null)) : []),
  ].filter((t): t is string => !!t && companyTeams.has(t)))];
  const describe = (list: any[], hours: number) => {
    const rejected = list.filter((r) => r.status === 'rejected').length;
    const partial = list.length - rejected;
    const parts = [rejected ? `${rejected} rejected` : '', partial ? `${partial} partially rejected` : ''].filter(Boolean).join(' and ');
    return `${parts} ingestion ${list.length === 1 ? 'request' : 'requests'} in the last ${hours} h`;
  };
  for (const { team, s } of settings) {
    if (!s.enabled) continue;
    const hours = Number(s.params.hours) || 24;
    const since = now - hours * 3_600_000;
    const list = rows.filter((r) => teamsOf(r).includes(team.id) && new Date(r.received_at).getTime() >= since);
    if (list.length >= (Number(s.params.count) || 1)) {
      out.push({
        teamId: team.id, rule: 'ingestion_failure', metricKey: null, severity: 'warning', message: describe(list, hours),
        details: { count: list.length, hours, latestAt: new Date(list[0].received_at).toISOString(), ingestionIds: list.slice(0, 10).map((r) => r.id) },
      });
    }
  }
  if (includeCompany && company.enabled) {
    const hours = Number(company.params.hours) || 24;
    const since = now - hours * 3_600_000;
    const list = rows.filter((r) => !teamsOf(r).length && new Date(r.received_at).getTime() >= since);
    if (list.length >= (Number(company.params.count) || 1)) {
      out.push({
        teamId: null, rule: 'ingestion_failure', metricKey: null, severity: 'warning', message: `${describe(list, hours)} that named no team of this company`,
        details: { count: list.length, hours, latestAt: new Date(list[0].received_at).toISOString(), ingestionIds: list.slice(0, 10).map((r) => r.id) },
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------
 * Evaluation + reconciliation
 * ---------------------------------------------------------------------------------------- */

export interface AlertRow {
  id: string;
  company_id: string;
  team_id: string | null;
  rule: AlertRule;
  metric_key: string | null;
  severity: Severity;
  message: string;
  details: any;
  dedupe_key: string;
  created_at: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
}

export interface EvaluationResult {
  companyId: string;
  teams: number;
  opened: AlertRow[];
  escalated: AlertRow[];
  refreshed: number;
  resolved: number;
}

async function q<T = any>(client: pg.PoolClient, sql: string, params: any[] = []): Promise<T[]> {
  return (await client.query(toPgPlaceholders(sql), params)).rows as T[];
}

/**
 * Evaluate the rules for a company (all active teams, or only `teamIds`) and reconcile the open
 * alerts. Company-level conditions (ingestion failures naming no team) are evaluated on a full
 * run and whenever `includeCompany` is set.
 */
export async function evaluateCompany(companyId: string, opts: { teamIds?: string[]; includeCompany?: boolean; now?: number; notify?: boolean } = {}): Promise<EvaluationResult> {
  const now = opts.now ?? Date.now();
  const full = !opts.teamIds;
  const teams = await query<TeamRow[]>(
    `SELECT id, name, department_id FROM teams WHERE company_id = ? AND is_active = TRUE AND (?::text[] IS NULL OR id = ANY(?::text[])) ORDER BY id`,
    [companyId, opts.teamIds ?? null, opts.teamIds ?? null]
  );
  const book = await loadRuleBook(companyId);
  const ctx: EvalContext = { companyId, intervals: await loadIntervals(companyId), book: await loadTargetBook(companyId), now };
  const latest = teams.length
    ? await query<any[]>(`SELECT DISTINCT ON (team_id) * FROM kpi_snapshots WHERE team_id = ANY(?::text[]) ORDER BY team_id, snapshot_date DESC`, [teams.map((t) => t.id)])
    : [];
  const latestBy = new Map(latest.map((r: any) => [r.team_id, r]));
  const conditions: Condition[] = [];
  for (const t of teams) conditions.push(...(await teamConditions(t, companyId, latestBy.get(t.id) ?? null, ctx, book)));
  const includeCompany = full || !!opts.includeCompany;
  conditions.push(...(await ingestionConditions(companyId, teams, book, includeCompany, now)));

  const result = await reconcile(companyId, teams.map((t) => t.id), includeCompany, conditions, now);
  if (opts.notify !== false && (result.opened.length || result.escalated.length)) {
    const { notifyAlerts } = await import('./notifications');
    await notifyAlerts(companyId, [...result.opened.map((a) => ({ alert: a, reason: 'new' as const })), ...result.escalated.map((a) => ({ alert: a, reason: 'escalated' as const }))]);
  }
  return { ...result, teams: teams.length };
}

async function reconcile(companyId: string, teamIds: string[], includeCompany: boolean, conditions: Condition[], now: number): Promise<Omit<EvaluationResult, 'teams'>> {
  const client = await pool.connect();
  const nowIso = new Date(now).toISOString();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`alerts:${companyId}`]);
    const open = await q<AlertRow>(
      client,
      `SELECT * FROM alerts WHERE company_id = ? AND resolved_at IS NULL AND (team_id = ANY(?::text[]) OR (? AND team_id IS NULL))`,
      [companyId, teamIds, includeCompany]
    );
    const openBy = new Map(open.map((a) => [a.dedupe_key, a]));
    const seen = new Set<string>();
    const opened: AlertRow[] = [];
    const escalated: AlertRow[] = [];
    let refreshed = 0;
    for (const c of conditions) {
      const key = dedupeKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = openBy.get(key);
      if (existing) {
        const [row] = await q<AlertRow>(
          client,
          `UPDATE alerts SET severity = ?, message = ?, details = ?::jsonb, last_seen_at = ?::timestamptz WHERE id = ? RETURNING *`,
          [c.severity, c.message, JSON.stringify(c.details), nowIso, existing.id]
        );
        refreshed++;
        if (SEVERITY_RANK[c.severity] > SEVERITY_RANK[existing.severity]) escalated.push(row);
        continue;
      }
      const rows = await q<AlertRow>(
        client,
        `INSERT INTO alerts (company_id, team_id, rule, metric_key, severity, message, details, dedupe_key, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?::timestamptz, ?::timestamptz)
         ON CONFLICT (company_id, dedupe_key) WHERE resolved_at IS NULL DO NOTHING RETURNING *`,
        [companyId, c.teamId, c.rule, c.metricKey, c.severity, c.message, JSON.stringify(c.details), key, nowIso, nowIso]
      );
      if (rows.length) opened.push(rows[0]);
    }
    const gone = open.filter((a) => !seen.has(a.dedupe_key)).map((a) => a.id);
    if (gone.length) await q(client, 'UPDATE alerts SET resolved_at = ?::timestamptz WHERE id = ANY(?::text[])', [nowIso, gone]);
    await client.query('COMMIT');
    return { companyId, opened, escalated, refreshed, resolved: gone.length };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Hook of the KPI write path (after the write committed): evaluate the written teams, then
 * process due notifications. Never throws: a failure is logged and the write stands.
 */
export async function afterKpiWrite(companyId: string | null | undefined, teamIds: string[]): Promise<void> {
  try {
    if (!companyId) {
      const row = teamIds.length ? (await query<any[]>('SELECT company_id FROM teams WHERE id = ?', [teamIds[0]]))[0] : null;
      companyId = row?.company_id;
      if (!companyId) return;
    }
    await evaluateCompany(companyId, { teamIds: [...new Set(teamIds)], includeCompany: true });
    const { refreshActionOutcomes } = await import('./actions');
    await refreshActionOutcomes(companyId, { teamIds });
  } catch (e) {
    console.error('[alerts] evaluation after a KPI write failed:', (e as Error)?.message ?? e);
  }
}

// Every KPI write that commits on its own (synthetic generators, single writes) evaluates its team.
onKpiWritten((teamIds) => afterKpiWrite(null, teamIds));

/** Hook of a rejected ingestion request: only the ingestion-failure rule can change. */
export async function afterIngestionRejected(companyId: string, teamIds: string[]): Promise<void> {
  try {
    await evaluateCompany(companyId, { teamIds: [...new Set(teamIds)], includeCompany: true });
  } catch (e) {
    console.error('[alerts] evaluation after a rejected ingestion failed:', (e as Error)?.message ?? e);
  }
}

/** Scheduled run: every active company — evaluate, refresh action outcomes, send pending notifications. */
export async function runScheduledEvaluation(): Promise<Array<{ companyId: string; opened: number; resolved: number }>> {
  const companies = await query<any[]>("SELECT id FROM companies WHERE is_active IS NOT FALSE AND status <> 'suspended' ORDER BY id");
  const out: Array<{ companyId: string; opened: number; resolved: number }> = [];
  const { refreshActionOutcomes } = await import('./actions');
  for (const c of companies) {
    try {
      const r = await evaluateCompany(c.id);
      await refreshActionOutcomes(c.id);
      out.push({ companyId: c.id, opened: r.opened.length, resolved: r.resolved });
    } catch (e) {
      console.error(`[alerts] scheduled evaluation failed for a company:`, (e as Error)?.message ?? e);
    }
  }
  const { processDeliveries } = await import('./notifications');
  await processDeliveries({ budgetMs: 20_000 });
  return out;
}

export { KPI_CAMEL };
export type { TargetMetric };
