/**
 * How one KPI snapshot row is read everywhere a team's KPIs are shown or judged
 * (GET /api/teams, team detail, KPI history, TV, company summary):
 *
 *   - per value: recorded_at, source, stale / stale since (server/lib/staleness.ts);
 *   - QA score with stale inputs left out, with its confidence ("based on n of 4 inputs";
 *     qaScoreComposite in metricFormulas.ts — the stored kpi_snapshots.qa_score is the score of
 *     every input the snapshot holds, computed by the database trigger);
 *   - targets valid at each value's date (server/lib/targets.ts);
 *   - whether any value is sample data (source 'synthetic').
 */
import { KPI_COLUMN_NAMES } from './kpiIngest';
import { qaScoreComposite, type QaScoreComposite } from './metricFormulas';
import { query } from '../../src/lib/db';
import { hasSampleData, loadIntervals, referenceFor, valueInfo, type IntervalMap, type ValueInfo } from './staleness';
import { loadTargetBook, TARGET_METRICS, TARGET_METRIC_KEYS, type TargetBook, type TargetMetric, type TeamRef } from './targets';
import { KPI_TARGET_KEYS, KPI_TARGETS, type KpiTargetCheck } from '../../src/config/metricsConfig';

/** kpi_snapshots column → camelCase key used by the UI (GET /api/teams kpiData). */
export const KPI_CAMEL: Record<string, string> = {
  test_coverage: 'testCoverage',
  test_flakiness_rate: 'testFlakinessRate',
  defect_density: 'defectDensity',
  defect_escape_rate: 'defectEscapeRate',
  code_quality_score: 'codeQualityScore',
  avg_build_time_minutes: 'avgBuildTimeMinutes',
  test_execution_time_minutes: 'testExecutionTimeMinutes',
  deployment_frequency_per_week: 'deploymentFrequencyPerWeek',
  lead_time_days: 'leadTimeDays',
  mttr_hours: 'mttrHours',
  parallel_test_efficiency: 'parallelTestEfficiency',
  sprint_velocity: 'sprintVelocity',
  sprint_commitment_rate: 'sprintCommitmentRate',
  sprint_carryover: 'sprintCarryover',
  first_time_pass_rate: 'firstTimePassRate',
  blocked_time_hours: 'blockedTimeHours',
  automation_coverage: 'automationCoverage',
  automation_roi: 'automationRoi',
  change_failure_rate: 'changeFailureRate',
  mtbf_hours: 'mtbfHours',
  system_availability: 'systemAvailability',
  infrastructure_failures: 'infrastructureFailures',
  sizing_accuracy: 'sizingAccuracy',
};

export interface EvalContext {
  companyId: string;
  intervals: IntervalMap;
  book: TargetBook;
  now?: number;
}

export interface SnapshotEvaluation {
  qa: QaScoreComposite;
  /** Per column (snake_case) that holds a value. */
  values: Record<string, ValueInfo>;
  /** camelCase KPI key → staleness, for the UI (kpiData keys). */
  staleness: Record<string, { recordedAt: string | null; stale: boolean; staleSince: string | null; source: string | null }>;
  /** camelCase key → threshold valid at the value's date (default: today). */
  thresholds: ReturnType<TargetBook['thresholdsFor']>;
  /** teamKpiTrack / teamAttentionIssues options (targets at the values' dates, stale KPIs). */
  judge: { targets: Record<keyof typeof KPI_TARGETS, number>; stale: Set<KpiTargetCheck['key']> };
  sampleData: boolean;
}

const dayOfIso = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);

/**
 * Evaluate a snapshot row. `reference` is the time staleness is measured at: now for the
 * current snapshot, referenceFor(day) for a past day.
 */
export function evaluateSnapshot(row: Record<string, any>, team: TeamRef, ctx: EvalContext, reference: number): SnapshotEvaluation {
  const now = ctx.now ?? Date.now();
  const values = valueInfo(row, KPI_COLUMN_NAMES, ctx.intervals, reference);
  const stale = Object.keys(values).filter((c) => values[c].stale);
  const qa = qaScoreComposite(row, stale);
  const staleness: SnapshotEvaluation['staleness'] = {};
  for (const [c, v] of Object.entries(values)) {
    staleness[KPI_CAMEL[c] ?? c] = { recordedAt: v.recordedAt, stale: v.stale, staleSince: v.staleSince, source: v.source };
  }
  const dayOf = (m: TargetMetric) => dayOfIso(values[m]?.recordedAt) ?? (row.snapshot_date ? String(row.snapshot_date).slice(0, 10) : null);
  const thresholds = ctx.book.thresholdsFor(team, ctx.companyId, dayOf, now);
  const targets = ctx.book.kpiTargetsFor(team, ctx.companyId, dayOf, now);
  const staleKeys = new Set<KpiTargetCheck['key']>();
  for (const key of Object.values(KPI_TARGET_KEYS)) {
    const col = Object.entries(KPI_CAMEL).find(([, k]) => k === key)?.[0];
    if (col && values[col]?.stale) staleKeys.add(key);
  }
  return { qa, values, staleness, thresholds, judge: { targets, stale: staleKeys }, sampleData: hasSampleData(row.field_sources) };
}

/** JSON-friendly QA confidence block (the API's qaScoreConfidence). */
export function qaConfidenceJson(qa: QaScoreComposite) {
  return {
    value: qa.value,
    inputsUsed: qa.inputsUsed,
    inputsTotal: qa.inputsTotal,
    confidence: qa.confidence,
    staleInputs: qa.staleInputs,
    missingInputs: qa.missingInputs,
  };
}

/** The metric-keyed KPI history of a team (also used by GET /api/tv/teams/:id). */
export async function kpiHistoryFor(companyId: string, team: { id: string; department_id: string | null }, numDays: number) {
  const history = await query<any>(
    `SELECT snapshot_date, field_sources, ${KPI_COLUMN_NAMES.join(', ')}, qa_score
       FROM kpi_snapshots
      WHERE team_id = ? AND snapshot_date >= CURRENT_DATE - CAST(? AS INTEGER)
      ORDER BY snapshot_date ASC`,
    [team.id, numDays]
  );
  const ctx: EvalContext = { companyId, intervals: await loadIntervals(companyId), book: await loadTargetBook(companyId) };
  const now = Date.now();

  // Transform to metric-keyed format for easy frontend consumption
  const metricHistory: Record<string, { date: string; value: number }[]> = {};
  const metricKeys = [
    'test_coverage', 'test_flakiness_rate', 'defect_density', 'defect_escape_rate',
    'code_quality_score', 'avg_build_time_minutes', 'test_execution_time_minutes',
    'deployment_frequency_per_week', 'lead_time_days', 'mttr_hours',
    'parallel_test_efficiency', 'sprint_velocity', 'sprint_commitment_rate',
    'sprint_carryover', 'first_time_pass_rate', 'blocked_time_hours',
    'automation_coverage', 'automation_roi', 'change_failure_rate',
    'mtbf_hours', 'system_availability', 'infrastructure_failures', 'qa_score'
  ];

  for (const key of metricKeys) {
    metricHistory[key] = [];
  }
  const qaConfidence: Array<{ date: string; inputsUsed: number; inputsTotal: number; confidence: string; staleInputs: string[] }> = [];

  for (const row of history) {
    const date = String(row.snapshot_date); // DATE → 'YYYY-MM-DD' (db.ts type parser)
    for (const key of metricKeys) {
      if (key === 'qa_score') continue;
      if (row[key] !== null && row[key] !== undefined) {
        metricHistory[key].push({ date, value: Number(row[key]) });
      }
    }
    // What was current on that day: staleness measured at the end of the day.
    const ev = evaluateSnapshot(row, team, ctx, referenceFor(date, now));
    if (ev.qa.value !== null) metricHistory.qa_score.push({ date, value: ev.qa.value });
    qaConfidence.push({ date, inputsUsed: ev.qa.inputsUsed, inputsTotal: ev.qa.inputsTotal, confidence: ev.qa.confidence, staleInputs: ev.qa.staleInputs });
  }

  const fromMs = Date.parse(`${history.length ? String(history[0].snapshot_date) : new Date(now).toISOString().slice(0, 10)}T00:00:00Z`);
  const targets: Record<string, ReturnType<typeof ctx.book.periods>> = {};
  for (const m of TARGET_METRIC_KEYS) targets[m] = ctx.book.periods(team, companyId, m, fromMs, now);

  return { history: metricHistory, days: numDays, count: history.length, qaConfidence, targets };
}

export { TARGET_METRICS };
