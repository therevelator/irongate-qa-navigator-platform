/**
 * KPI target history (table target_history): good / warning thresholds with validity periods,
 * set per company, department or team (Administration → Parameters → KPI targets).
 *
 * targetAt(team, metric, instant): the team's own target valid at that instant, else its
 * department's, else the company's, else the code default (METRICS_CONFIG). Every judgement of a
 * value uses the target valid at the value's date (judgeInstant: the end of that UTC day), so a
 * changed target never re-judges history. Direction (lower / higher is better) never changes and
 * comes from METRICS_CONFIG.
 */
import type pg from 'pg';
import { query } from '../../src/lib/db';
import { METRICS_CONFIG, KPI_TARGETS, KPI_TARGET_KEYS, judgeInstant, type MetricsConfig, type TargetPeriod } from '../../src/config/metricsConfig';

export type TargetScope = 'company' | 'department' | 'team';

/** KPI columns that have a target, with their METRICS_CONFIG key. */
export const TARGET_METRICS = {
  test_coverage: 'testCoverage',
  defect_density: 'defectDensity',
  defect_escape_rate: 'defectEscapeRate',
  automation_coverage: 'automationCoverage',
  code_quality_score: 'codeQualityScore',
  test_flakiness_rate: 'testFlakinessRate',
  avg_build_time_minutes: 'avgBuildTimeMinutes',
  test_execution_time_minutes: 'testExecutionTimeMinutes',
  deployment_frequency_per_week: 'deploymentFrequencyPerWeek',
  lead_time_days: 'leadTimeDays',
  mttr_hours: 'mttrHours',
  parallel_test_efficiency: 'parallelTestEfficiency',
  sprint_commitment_rate: 'sprintCommitmentRate',
  sprint_carryover: 'sprintCarryover',
  first_time_pass_rate: 'firstTimePassRate',
  blocked_time_hours: 'blockedTimeHours',
  change_failure_rate: 'changeFailureRate',
  mtbf_hours: 'mtbfHours',
  system_availability: 'systemAvailability',
  infrastructure_failures: 'infrastructureFailures',
} as const satisfies Record<string, keyof MetricsConfig>;

export type TargetMetric = keyof typeof TARGET_METRICS;
export const TARGET_METRIC_KEYS = Object.keys(TARGET_METRICS) as TargetMetric[];
export const isTargetMetric = (k: string): k is TargetMetric => Object.prototype.hasOwnProperty.call(TARGET_METRICS, k);

export interface ResolvedTarget {
  good: number;
  warning: number;
  lowerIsBetter: boolean;
  scope: TargetPeriod['scope'];
  validFrom: string | null;
}

interface Row {
  scope_type: TargetScope;
  scope_id: string;
  metric_key: string;
  good: number;
  warning: number;
  from: number;
  to: number | null;
}

export interface TeamRef {
  id: string;
  department_id?: string | null;
}

export function defaultTarget(metric: TargetMetric): ResolvedTarget {
  const c = METRICS_CONFIG[TARGET_METRICS[metric]];
  return { good: c.good, warning: c.warning, lowerIsBetter: c.lowerIsBetter, scope: 'default', validFrom: null };
}

/** All target rows of a company, indexed for lookups. */
export class TargetBook {
  private byKey = new Map<string, Row[]>();

  constructor(rows: Row[]) {
    for (const r of rows) {
      const k = `${r.scope_type}|${r.scope_id}|${r.metric_key}`;
      const list = this.byKey.get(k) ?? [];
      list.push(r);
      this.byKey.set(k, list);
    }
    for (const list of this.byKey.values()) list.sort((a, b) => a.from - b.from);
  }

  private rowAt(scope: TargetScope, scopeId: string | null | undefined, metric: string, t: number): Row | null {
    if (!scopeId) return null;
    const list = this.byKey.get(`${scope}|${scopeId}|${metric}`);
    if (!list) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r.from <= t && (r.to === null || t < r.to)) return r;
    }
    return null;
  }

  /** The target of a metric for a team at an instant (ms). */
  at(team: TeamRef, companyId: string, metric: TargetMetric, t: number): ResolvedTarget {
    const dir = METRICS_CONFIG[TARGET_METRICS[metric]].lowerIsBetter;
    for (const [scope, id] of [['team', team.id], ['department', team.department_id], ['company', companyId]] as const) {
      const r = this.rowAt(scope, id, metric, t);
      if (r) return { good: r.good, warning: r.warning, lowerIsBetter: dir, scope, validFrom: new Date(r.from).toISOString() };
    }
    return defaultTarget(metric);
  }

  /** The target of a metric for a team on a day ('YYYY-MM-DD'), judged at the end of that day. */
  onDay(team: TeamRef, companyId: string, metric: TargetMetric, day: string, now = Date.now()): ResolvedTarget {
    return this.at(team, companyId, metric, Math.min(judgeInstant(day), now));
  }

  /**
   * The team's effective target periods of a metric overlapping [fromMs, toMs]: consecutive
   * segments with the same target are merged. 'default' periods cover times with no stored row.
   */
  periods(team: TeamRef, companyId: string, metric: TargetMetric, fromMs: number, toMs: number): TargetPeriod[] {
    const bounds = new Set<number>([fromMs]);
    for (const [scope, id] of [['team', team.id], ['department', team.department_id], ['company', companyId]] as const) {
      if (!id) continue;
      for (const r of this.byKey.get(`${scope}|${id}|${metric}`) ?? []) {
        if (r.from > fromMs && r.from <= toMs) bounds.add(r.from);
        if (r.to !== null && r.to > fromMs && r.to <= toMs) bounds.add(r.to);
      }
    }
    const starts = [...bounds].sort((a, b) => a - b);
    const out: TargetPeriod[] = [];
    starts.forEach((s, i) => {
      const t = this.at(team, companyId, metric, s);
      const end = i + 1 < starts.length ? starts[i + 1] : null;
      const prev = out[out.length - 1];
      if (prev && prev.good === t.good && prev.warning === t.warning && prev.scope === t.scope) {
        prev.validTo = end === null ? null : new Date(end).toISOString();
        return;
      }
      out.push({ validFrom: new Date(s).toISOString(), validTo: end === null ? null : new Date(end).toISOString(), good: t.good, warning: t.warning, scope: t.scope });
    });
    // The first segment starts at the window start: open it to the past so any earlier day finds it.
    if (out.length) out[0].validFrom = new Date(Math.min(fromMs, Date.parse(out[0].validFrom))).toISOString();
    return out;
  }

  /** Thresholds of every target metric (camelCase keys, as GET /api/teams kpiThresholds), each judged at its value's day. */
  thresholdsFor(team: TeamRef, companyId: string, dayOf: (metric: TargetMetric) => string | null, now = Date.now()) {
    const out: Record<string, { good: number; warning: number; lowerIsBetter: boolean; scope: string; validFrom: string | null }> = {};
    for (const m of TARGET_METRIC_KEYS) {
      const day = dayOf(m);
      const t = day ? this.onDay(team, companyId, m, day, now) : this.at(team, companyId, m, now);
      out[TARGET_METRICS[m]] = t;
    }
    return out;
  }

  /** KPI_TARGETS-shaped targets (coverage, automation, flakiness, escapeRate) for teamKpiTrack / teamAttentionIssues. */
  kpiTargetsFor(team: TeamRef, companyId: string, dayOf: (metric: TargetMetric) => string | null, now = Date.now()) {
    const col: Record<keyof typeof KPI_TARGETS, TargetMetric> = {
      coverage: 'test_coverage', automation: 'automation_coverage', flakiness: 'test_flakiness_rate', escapeRate: 'defect_escape_rate',
    };
    const out = {} as Record<keyof typeof KPI_TARGETS, number>;
    for (const k of Object.keys(KPI_TARGET_KEYS) as Array<keyof typeof KPI_TARGETS>) {
      const day = dayOf(col[k]);
      out[k] = (day ? this.onDay(team, companyId, col[k], day, now) : this.at(team, companyId, col[k], now)).good;
    }
    return out;
  }
}

export async function loadTargetBook(companyId: string, client?: pg.PoolClient): Promise<TargetBook> {
  const sql = `SELECT scope_type, scope_id, metric_key, good, warning, valid_from, valid_to
                 FROM target_history WHERE company_id = $1`;
  const rows = client ? (await client.query(sql, [companyId])).rows : await query<any>(sql.replace('$1', '?'), [companyId]);
  return new TargetBook(
    rows.map((r: any) => ({
      scope_type: r.scope_type,
      scope_id: r.scope_id,
      metric_key: r.metric_key,
      good: Number(r.good),
      warning: Number(r.warning),
      from: new Date(r.valid_from).getTime(),
      to: r.valid_to ? new Date(r.valid_to).getTime() : null,
    }))
  );
}
