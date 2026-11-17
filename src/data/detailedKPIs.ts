import { METRICS_CONFIG } from '../config/metricsConfig';
import type { MetricsConfig } from '../config/metricsConfig';

/**
 * Per-KPI view model for the team detail page.
 *
 * Values come only from the team's latest KPI snapshot (GET /api/teams → kpiData).
 * A missing value stays `null` with status 'no-data' — nothing is generated or
 * filled in. Trends/history come from GET /api/teams/:id/kpi-history (see historyKey).
 * Thresholds come from one place: server-provided thresholds when present,
 * otherwise METRICS_CONFIG (src/config/metricsConfig.ts).
 */

export type KPIStatus = 'good' | 'warning' | 'critical' | 'neutral' | 'no-data';
export type KPIKey = keyof MetricsConfig | 'automationRoi';

const cfg = (key: KPIKey) => (METRICS_CONFIG as Partial<Record<KPIKey, MetricsConfig[keyof MetricsConfig]>>)[key];

export interface Threshold {
  good: number;
  warning: number;
  lowerIsBetter: boolean;
}

export interface DetailedKPI {
  id: string;
  key: KPIKey;
  /** metric key in the /kpi-history response */
  historyKey: string;
  name: string;
  value: number | null;
  unit: string;
  status: KPIStatus;
  lowerIsBetter: boolean;
  threshold: Threshold | null;
  category: 'quality' | 'speed' | 'agile' | 'reliability';
  description: string;
}

export type KPIData = Partial<Record<KPIKey, number | string | null>> & { snapshotDate?: string | null };

interface TeamWithKPI {
  kpiData?: KPIData;
  kpiThresholds?: Partial<Record<string, Partial<Threshold>>>;
}

/** Parse a value from the API (NUMERIC columns arrive as strings). null/''/NaN → null. */
export const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The one threshold set for a metric: server override if provided, else METRICS_CONFIG. */
export const getThreshold = (
  key: KPIKey,
  overrides?: Partial<Record<string, Partial<Threshold>>>,
): Threshold | null => {
  const base = cfg(key);
  const o = overrides?.[key];
  if (!base && !o) return null;
  const good = toNum(o?.good) ?? base?.good;
  const warning = toNum(o?.warning) ?? base?.warning;
  if (good == null || warning == null) return null;
  return { good, warning, lowerIsBetter: o?.lowerIsBetter ?? base?.lowerIsBetter ?? false };
};

export const statusFor = (value: number | null, t: Threshold | null): KPIStatus => {
  if (value === null) return 'no-data';
  if (!t) return 'neutral';
  if (t.lowerIsBetter) return value <= t.good ? 'good' : value <= t.warning ? 'warning' : 'critical';
  return value >= t.good ? 'good' : value >= t.warning ? 'warning' : 'critical';
};

type Def = {
  id: string;
  key: KPIKey;
  historyKey: string;
  name: string;
  category: DetailedKPI['category'];
  description: string;
  /** metrics with no good/bad direction (e.g. velocity) */
  noThreshold?: boolean;
};

const DEFS: Def[] = [
  // Quality & testing
  { id: 'test-coverage', key: 'testCoverage', historyKey: 'test_coverage', name: 'Test coverage', category: 'quality', description: 'Share of code executed by automated tests' },
  { id: 'flakiness-rate', key: 'testFlakinessRate', historyKey: 'test_flakiness_rate', name: 'Test flakiness rate', category: 'quality', description: 'Tests that fail intermittently without code changes' },
  { id: 'defect-density', key: 'defectDensity', historyKey: 'defect_density', name: 'Defect density', category: 'quality', description: 'Defects per thousand lines of code' },
  { id: 'defect-escape-rate', key: 'defectEscapeRate', historyKey: 'defect_escape_rate', name: 'Defect escape rate', category: 'quality', description: 'Bugs found in production vs. caught in testing' },
  { id: 'code-quality-score', key: 'codeQualityScore', historyKey: 'code_quality_score', name: 'Code quality score', category: 'quality', description: 'Static analysis score' },

  // Speed & efficiency
  { id: 'build-time', key: 'avgBuildTimeMinutes', historyKey: 'avg_build_time_minutes', name: 'Avg build time', category: 'speed', description: 'Average time to complete a CI build' },
  { id: 'test-execution-time', key: 'testExecutionTimeMinutes', historyKey: 'test_execution_time_minutes', name: 'Test execution time', category: 'speed', description: 'Time to run the automated test suite' },
  { id: 'deployment-frequency', key: 'deploymentFrequencyPerWeek', historyKey: 'deployment_frequency_per_week', name: 'Deployment frequency', category: 'speed', description: 'Production deployments per week' },
  { id: 'lead-time', key: 'leadTimeDays', historyKey: 'lead_time_days', name: 'Lead time for changes', category: 'speed', description: 'Average time from commit to production' },
  { id: 'mttr', key: 'mttrHours', historyKey: 'mttr_hours', name: 'Mean time to recovery', category: 'speed', description: 'Average time to restore service after a failure' },
  { id: 'parallel-efficiency', key: 'parallelTestEfficiency', historyKey: 'parallel_test_efficiency', name: 'Parallel test efficiency', category: 'speed', description: 'Efficiency of parallel test execution' },

  // Agile & process
  { id: 'sprint-velocity', key: 'sprintVelocity', historyKey: 'sprint_velocity', name: 'Sprint velocity', category: 'agile', description: 'Story points completed per sprint (compare with the team’s own history)', noThreshold: true },
  { id: 'sprint-commitment', key: 'sprintCommitmentRate', historyKey: 'sprint_commitment_rate', name: 'Sprint commitment rate', category: 'agile', description: 'Share of committed work completed' },
  { id: 'sprint-carryover', key: 'sprintCarryover', historyKey: 'sprint_carryover', name: 'Sprint carryover', category: 'agile', description: 'Committed work moved to the next sprint' },
  { id: 'first-time-pass', key: 'firstTimePassRate', historyKey: 'first_time_pass_rate', name: 'First-time pass rate', category: 'agile', description: 'Stories passing QA on the first attempt' },
  { id: 'blocked-time', key: 'blockedTimeHours', historyKey: 'blocked_time_hours', name: 'Blocked time', category: 'agile', description: 'Hours tickets spent blocked' },
  { id: 'automation-coverage', key: 'automationCoverage', historyKey: 'automation_coverage', name: 'Test automation coverage', category: 'agile', description: 'Share of test cases that are automated' },
  { id: 'automation-roi', key: 'automationRoi', historyKey: 'automation_roi', name: 'Automation ROI', category: 'agile', description: 'Return on investment for test automation', noThreshold: true },

  // Reliability
  { id: 'change-failure-rate', key: 'changeFailureRate', historyKey: 'change_failure_rate', name: 'Change failure rate', category: 'reliability', description: 'Deployments causing failures or rollbacks' },
  { id: 'mtbf', key: 'mtbfHours', historyKey: 'mtbf_hours', name: 'Mean time between failures', category: 'reliability', description: 'Average time between production failures' },
  { id: 'availability', key: 'systemAvailability', historyKey: 'system_availability', name: 'System availability', category: 'reliability', description: 'Uptime percentage' },
  { id: 'infra-failures', key: 'infrastructureFailures', historyKey: 'infrastructure_failures', name: 'Infrastructure failures', category: 'reliability', description: 'Test failures caused by infrastructure' },
];

const UNIT_OVERRIDES: Partial<Record<KPIKey, string>> = { automationRoi: '%', sprintVelocity: 'pts', infrastructureFailures: '' };

export const generateDetailedKPIs = (team: TeamWithKPI): DetailedKPI[] => {
  const kpi: KPIData = team.kpiData || {};
  return DEFS.map((d) => {
    const value = toNum(kpi[d.key]);
    const threshold = d.noThreshold ? null : getThreshold(d.key, team.kpiThresholds);
    return {
      id: d.id,
      key: d.key,
      historyKey: d.historyKey,
      name: d.name,
      value,
      unit: UNIT_OVERRIDES[d.key] ?? cfg(d.key)?.unit ?? '',
      status: statusFor(value, threshold),
      lowerIsBetter: threshold?.lowerIsBetter ?? cfg(d.key)?.lowerIsBetter ?? false,
      threshold,
      category: d.category,
      description: d.description,
    };
  });
};
