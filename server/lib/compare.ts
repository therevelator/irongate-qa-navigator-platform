/**
 * Team comparison (GET /api/compare/teams, src/components/CompareTeams.tsx): 2–4 teams of the
 * caller's analytics scope side by side, team aggregates only.
 *
 * Per team and metric: the latest value, formatted as the screen shows it, the target valid at the
 * value's date (target history, server/lib/targets.ts) and the status against it, whether the value
 * is stale (it is then shown greyed and neither judged nor used for best / worst), whether it is
 * sample data, and the daily values of the window for a sparkline with the change over the window.
 * The QA score is the composite without stale inputs, with its confidence ("based on n of 4").
 *
 * Differences (per metric, from the current, non-stale values): the best and worst team, the
 * spread, and `differs` when the teams are in different status bands or the spread is at least
 * DIFFERENCE_RULE.relativeSpread of the target.
 */
import { queryOne } from '../../src/lib/db';
import { KPI_COLUMNS, type KpiColumn } from './kpiIngest';
import { evaluateLatestSnapshot, kpiHistoryFor, loadDataClock, qaConfidenceJson, type EvalContext } from './kpiEvaluation';
import { loadIntervals } from './staleness';
import { loadTargetBook, TARGET_METRICS, type TargetMetric } from './targets';
import { teamLeadNameSql, teamMemberCountSql } from './teamMembership';
import { QA_SCORE_THRESHOLDS, TECH_DEBT_OPEN_WEIGHT_SQL, techDebtScoreFromWeight, toNum } from './metricFormulas';
import { METRICS_CONFIG } from '../../src/config/metricsConfig';
import type { CsvColumn } from '../../src/lib/csv';

export const COMPARE_MIN_TEAMS = 2;
export const COMPARE_MAX_TEAMS = 4;
export const COMPARE_DAYS = { default: 30, min: 7, max: 90 } as const;
export const DIFFERENCE_RULE = { relativeSpread: 0.1 } as const;
export const DIFFERENCE_RULE_TEXT =
  `A row is highlighted when the teams are in different status bands, or when the gap between the best and the worst current value ` +
  `is at least ${DIFFERENCE_RULE.relativeSpread * 100}% of the target. Stale values are shown but not compared.`;

export type CompareStatus = 'good' | 'warning' | 'critical';

export interface CompareMetric {
  key: string;
  label: string;
  unit: string;
  group: 'Score' | 'Quality' | 'Speed' | 'Delivery' | 'Process' | 'Reliability';
  lowerIsBetter: boolean;
  decimals: number;
}

const GROUP: Record<TargetMetric, CompareMetric['group']> = {
  test_coverage: 'Quality', automation_coverage: 'Quality', test_flakiness_rate: 'Quality', defect_escape_rate: 'Quality',
  defect_density: 'Quality', code_quality_score: 'Quality',
  avg_build_time_minutes: 'Speed', test_execution_time_minutes: 'Speed', parallel_test_efficiency: 'Speed', first_time_pass_rate: 'Speed',
  deployment_frequency_per_week: 'Delivery', lead_time_days: 'Delivery', mttr_hours: 'Delivery', change_failure_rate: 'Delivery',
  sprint_commitment_rate: 'Process', sprint_carryover: 'Process', blocked_time_hours: 'Process',
  mtbf_hours: 'Reliability', system_availability: 'Reliability', infrastructure_failures: 'Reliability',
};
const GROUP_ORDER: CompareMetric['group'][] = ['Score', 'Quality', 'Speed', 'Delivery', 'Process', 'Reliability'];

function decimalsFor(col: KpiColumn): number {
  const spec = KPI_COLUMNS[col] as { integer?: boolean; unit?: string };
  if (spec.integer) return 0;
  if (col === 'defect_density') return 2;
  if (col === 'system_availability') return 2;
  return 1;
}

/** The metrics of a comparison, in display order: QA score, tech debt score, then every KPI with a target. */
export const COMPARE_METRICS: CompareMetric[] = [
  { key: 'qa_score', label: 'QA score', unit: '/100', group: 'Score', lowerIsBetter: false, decimals: 0 },
  { key: 'technical_debt_score', label: 'Technical debt score', unit: '/100', group: 'Score', lowerIsBetter: METRICS_CONFIG.technicalDebtScore.lowerIsBetter, decimals: 0 },
  ...(Object.keys(TARGET_METRICS) as TargetMetric[])
    .map((col): CompareMetric => ({
      key: col,
      label: KPI_COLUMNS[col].label,
      unit: (KPI_COLUMNS[col] as { unit?: string }).unit ?? '',
      group: GROUP[col],
      lowerIsBetter: METRICS_CONFIG[TARGET_METRICS[col]].lowerIsBetter,
      decimals: decimalsFor(col),
    }))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)),
];

const unitSuffix = (unit: string) => (!unit ? '' : unit === '%' || unit.startsWith('/') ? unit : ` ${unit}`);

/** A value as the comparison shows it ("82.4%", "3.2 days", "87"); '—' when there is none. */
export function formatMetricValue(v: number | null | undefined, m: Pick<CompareMetric, 'unit' | 'decimals' | 'key'>): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  // No "-0.0": values that round to zero are shown as 0.
  const n = (Math.abs(v) < 0.5 * 10 ** -m.decimals ? 0 : v).toFixed(m.decimals);
  return m.unit === '/100' ? n : `${n}${unitSuffix(m.unit)}`;
}

/** Target text as shown ("≥ 80%", "≤ 5 h"). */
export function formatTarget(t: { good: number; lowerIsBetter: boolean } | null, m: Pick<CompareMetric, 'unit' | 'key'>): string {
  if (!t) return '—';
  return `${t.lowerIsBetter ? '≤' : '≥'} ${t.good}${m.unit === '/100' ? '' : unitSuffix(m.unit)}`;
}

/** Status of a value against a target (good / watch = warning / off = critical). */
export function judgeAgainstTarget(v: number | null, t: { good: number; warning: number; lowerIsBetter: boolean } | null): CompareStatus | null {
  if (v === null || !t) return null;
  if (t.lowerIsBetter) return v <= t.good ? 'good' : v <= t.warning ? 'warning' : 'critical';
  return v >= t.good ? 'good' : v >= t.warning ? 'warning' : 'critical';
}

export const STATUS_LABEL: Record<CompareStatus, string> = { good: 'On target', warning: 'Watch', critical: 'Off target' };

export interface CompareCell {
  value: number | null;
  display: string;
  status: CompareStatus | null;
  target: { good: number; warning: number; lowerIsBetter: boolean; scope: string; validFrom: string | null } | null;
  targetDisplay: string;
  stale: boolean;
  staleSince: string | null;
  recordedAt: string | null;
  sample: boolean;
  /** Daily values in the window (sparkline). */
  trend: Array<{ date: string; value: number }>;
  /** Latest value minus the first value of the window; null with fewer than 2 points. */
  change: number | null;
}

export interface CompareTeam {
  id: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  leadName: string | null;
  memberCount: number;
  snapshotDate: string | null;
  /** Newest value time of the latest snapshot; dataOutdated when over a day old (FI-22). */
  lastUpdated: string | null;
  dataOutdated: boolean;
  qaScoreConfidence: ReturnType<typeof qaConfidenceJson> | null;
  sampleData: boolean;
  cells: Record<string, CompareCell>;
}

export interface CompareRowDiff {
  best: string[];
  worst: string[];
  spread: number | null;
  spreadDisplay: string;
  differs: boolean;
}

export interface Comparison {
  days: number;
  metrics: CompareMetric[];
  teams: CompareTeam[];
  differences: Record<string, CompareRowDiff>;
  differenceRule: string;
  generatedAt: string;
}

/** Raw numbers without floating-point noise (6 significant decimals). */
const round = (v: number) => Math.round(v * 1e6) / 1e6;

const emptyCell = (): CompareCell => ({
  value: null, display: '—', status: null, target: null, targetDisplay: '—', stale: false, staleSince: null, recordedAt: null, sample: false, trend: [], change: null,
});

/** Build the comparison of teams (already checked to be in the caller's scope and company). */
export async function buildComparison(companyId: string, teamIds: string[], days: number): Promise<Comparison> {
  const ctx: EvalContext = { companyId, intervals: await loadIntervals(companyId), book: await loadTargetBook(companyId) };
  ctx.dataClock = await loadDataClock(companyId, ctx.intervals);
  const now = Date.now();
  const teams: CompareTeam[] = [];

  for (const id of teamIds) {
    const t = await queryOne<any>(
      `SELECT t.id, t.name, t.department_id, d.name AS department_name,
              ${teamLeadNameSql('t')} AS lead_name, ${teamMemberCountSql('t')} AS member_count
         FROM teams t LEFT JOIN departments d ON d.id = t.department_id
        WHERE t.id = ? AND t.company_id = ?`,
      [id, companyId]
    );
    if (!t) continue;
    const ref = { id: String(t.id), department_id: t.department_id ? String(t.department_id) : null };
    const snapshot = await queryOne<any>(`SELECT * FROM kpi_snapshots WHERE team_id = ? ORDER BY snapshot_date DESC LIMIT 1`, [ref.id]);
    const debt = await queryOne<any>(`SELECT ${TECH_DEBT_OPEN_WEIGHT_SQL} AS open_weight FROM technical_debt WHERE team_id = ?`, [ref.id]);
    const hist = await kpiHistoryFor(companyId, ref, days);

    const cells: Record<string, CompareCell> = {};
    const ev = snapshot ? evaluateLatestSnapshot(snapshot, ref, ctx, now) : null;
    for (const m of COMPARE_METRICS) {
      const cell = emptyCell();
      if (m.key === 'qa_score') {
        cell.value = ev?.qa.value ?? null;
        cell.target = { good: QA_SCORE_THRESHOLDS.good, warning: QA_SCORE_THRESHOLDS.warning, lowerIsBetter: false, scope: 'default', validFrom: null };
        cell.trend = hist.history.qa_score ?? [];
      } else if (m.key === 'technical_debt_score') {
        // Same value as Team detail and TV (0 = no open debt).
        cell.value = techDebtScoreFromWeight(debt?.open_weight);
        const c = METRICS_CONFIG.technicalDebtScore;
        cell.target = { good: c.good, warning: c.warning, lowerIsBetter: c.lowerIsBetter, scope: 'default', validFrom: null };
      } else {
        const col = m.key as TargetMetric;
        const info = ev?.values[col];
        cell.value = snapshot ? toNum(snapshot[col]) : null;
        const th = ev?.thresholds[TARGET_METRICS[col]];
        cell.target = th ? { good: th.good, warning: th.warning, lowerIsBetter: th.lowerIsBetter, scope: th.scope, validFrom: th.validFrom } : null;
        cell.stale = !!info?.stale;
        cell.staleSince = info?.staleSince ?? null;
        cell.recordedAt = info?.recordedAt ?? null;
        cell.sample = info?.source === 'synthetic';
        cell.trend = hist.history[col] ?? [];
      }
      cell.display = formatMetricValue(cell.value, m);
      cell.targetDisplay = formatTarget(cell.target, m);
      cell.status = cell.stale ? null : judgeAgainstTarget(cell.value, cell.target);
      cell.change = cell.trend.length >= 2 ? round(cell.trend[cell.trend.length - 1].value - cell.trend[0].value) : null;
      cells[m.key] = cell;
    }

    teams.push({
      id: ref.id,
      name: t.name,
      departmentId: ref.department_id,
      departmentName: t.department_name ?? null,
      leadName: t.lead_name ?? null,
      memberCount: Number(t.member_count) || 0,
      snapshotDate: snapshot ? String(snapshot.snapshot_date).slice(0, 10) : null,
      lastUpdated: ev?.lastUpdated ?? null,
      dataOutdated: ev?.outdated ?? false,
      qaScoreConfidence: ev ? qaConfidenceJson(ev.qa) : null,
      sampleData: !!ev?.sampleData,
      cells,
    });
  }

  const differences: Record<string, CompareRowDiff> = {};
  for (const m of COMPARE_METRICS) {
    const vals = teams
      .map((t) => ({ id: t.id, c: t.cells[m.key] }))
      .filter((x) => x.c.value !== null && !x.c.stale) as Array<{ id: string; c: CompareCell & { value: number } }>;
    if (vals.length < 2) {
      differences[m.key] = { best: [], worst: [], spread: null, spreadDisplay: '—', differs: false };
      continue;
    }
    const nums = vals.map((v) => v.c.value);
    const max = Math.max(...nums), min = Math.min(...nums);
    const bestV = m.lowerIsBetter ? min : max, worstV = m.lowerIsBetter ? max : min;
    const spread = round(max - min);
    const statuses = new Set(vals.map((v) => v.c.status).filter(Boolean));
    const scale = Math.max(Math.abs(vals[0].c.target?.good ?? 0), Math.abs(max), 1);
    differences[m.key] = {
      best: spread > 0 ? vals.filter((v) => v.c.value === bestV).map((v) => v.id) : [],
      worst: spread > 0 ? vals.filter((v) => v.c.value === worstV).map((v) => v.id) : [],
      spread,
      spreadDisplay: formatMetricValue(spread, m),
      differs: statuses.size > 1 || spread / scale >= DIFFERENCE_RULE.relativeSpread,
    };
  }

  return { days, metrics: COMPARE_METRICS, teams, differences, differenceRule: DIFFERENCE_RULE_TEXT, generatedAt: new Date(now).toISOString() };
}

/** One CSV row per team and metric (long format): values as shown plus the raw numbers. */
export interface CompareCsvRow {
  team: CompareTeam;
  metric: CompareMetric;
  cell: CompareCell;
  diff: CompareRowDiff;
}

export function comparisonCsvRows(c: Comparison): CompareCsvRow[] {
  const out: CompareCsvRow[] = [];
  for (const m of c.metrics) for (const t of c.teams) out.push({ team: t, metric: m, cell: t.cells[m.key], diff: c.differences[m.key] });
  return out;
}

export function comparisonCsvColumns(days: number): CsvColumn<CompareCsvRow>[] {
  return [
    { header: 'Team', value: (r) => r.team.name },
    { header: 'Department', value: (r) => r.team.departmentName ?? '' },
    { header: 'Group', value: (r) => r.metric.group },
    { header: 'Metric', value: (r) => r.metric.label },
    { header: 'Value', value: (r) => r.cell.display, raw: (r) => r.cell.value },
    { header: 'Unit', value: (r) => r.metric.unit },
    { header: 'Target', value: (r) => r.cell.targetDisplay, raw: (r) => r.cell.target?.good ?? null },
    { header: 'Watch level (raw)', value: (r) => r.cell.target?.warning ?? null },
    { header: 'Target set at', value: (r) => (r.cell.target ? r.cell.target.scope : '') },
    { header: 'Status', value: (r) => (r.cell.stale ? 'Stale (not judged)' : r.cell.status ? STATUS_LABEL[r.cell.status] : 'No data') },
    { header: 'Stale since', value: (r) => r.cell.staleSince ?? '' },
    { header: 'Recorded at', value: (r) => r.cell.recordedAt ?? '' },
    { header: 'Sample data', value: (r) => (r.cell.sample ? 'yes' : 'no') },
    {
      header: `Change over ${days} days`,
      value: (r) => (r.cell.change === null ? '—' : `${r.cell.change > 0 ? '+' : ''}${formatMetricValue(r.cell.change, r.metric)}`),
      raw: (r) => r.cell.change,
    },
    { header: 'Best in comparison', value: (r) => (r.diff.best.includes(r.team.id) ? 'yes' : 'no') },
    { header: 'Highlighted difference', value: (r) => (r.diff.differs ? 'yes' : 'no') },
    {
      header: 'QA score basis',
      value: (r) => (r.metric.key === 'qa_score' && r.team.qaScoreConfidence
        ? `${r.team.qaScoreConfidence.inputsUsed} of ${r.team.qaScoreConfidence.inputsTotal} inputs (${r.team.qaScoreConfidence.confidence} confidence)`
        : ''),
    },
    { header: 'Snapshot date', value: (r) => r.team.snapshotDate ?? '' },
  ];
}

