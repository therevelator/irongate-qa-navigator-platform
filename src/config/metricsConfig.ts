/**
 * Metrics Configuration
 * 
 * Centralized thresholds for all metrics used in the QA Dashboard.
 * Each metric defines ranges for good/warning/critical status.
 * 
 * For "lowerIsBetter" metrics (like defect density, build time):
 *   - Values <= good threshold = green
 *   - Values <= warning threshold = orange  
 *   - Values > warning threshold = red
 * 
 * For "higherIsBetter" metrics (like test coverage, happiness):
 *   - Values >= good threshold = green
 *   - Values >= warning threshold = orange
 *   - Values < warning threshold = red
 */

import { QA_SCORE_THRESHOLDS } from '../../server/lib/metricFormulas';

export interface MetricThreshold {
  good: number;
  warning: number;
  lowerIsBetter: boolean;
  unit?: string;
  description?: string;
}

export interface MetricsConfig {
  // Team KPI Metrics
  testCoverage: MetricThreshold;
  defectDensity: MetricThreshold;
  defectEscapeRate: MetricThreshold;
  automationCoverage: MetricThreshold;
  codeQualityScore: MetricThreshold;
  testFlakinessRate: MetricThreshold;
  
  // Speed & Efficiency
  avgBuildTimeMinutes: MetricThreshold;
  testExecutionTimeMinutes: MetricThreshold;
  deploymentFrequencyPerWeek: MetricThreshold;
  leadTimeDays: MetricThreshold;
  mttrHours: MetricThreshold;
  parallelTestEfficiency: MetricThreshold;
  
  // Agile & Process
  sprintVelocity: MetricThreshold;
  sprintCommitmentRate: MetricThreshold;
  sprintCarryover: MetricThreshold;
  firstTimePassRate: MetricThreshold;
  blockedTimeHours: MetricThreshold;
  
  // Reliability
  changeFailureRate: MetricThreshold;
  mtbfHours: MetricThreshold;
  systemAvailability: MetricThreshold;
  infrastructureFailures: MetricThreshold;
  
  // Combined/Calculated
  qaScore: MetricThreshold;
  technicalDebtScore: MetricThreshold;
  
  // Developer Metrics
  prMergeTimeHours: MetricThreshold;
  codeReviewTimeHours: MetricThreshold;
  focusTimeHours: MetricThreshold;
  meetingTimeHours: MetricThreshold;
  contextSwitchesPerDay: MetricThreshold;
  happinessScore: MetricThreshold;
}

export const METRICS_CONFIG: MetricsConfig = {
  // ============================================
  // TEAM KPI METRICS
  // ============================================
  
  testCoverage: {
    good: 80,
    warning: 70,
    lowerIsBetter: false,
    unit: '%',
    description: 'Percentage of code covered by tests'
  },
  
  defectDensity: {
    good: 0.5,
    warning: 1.0,
    lowerIsBetter: true,
    unit: '/1k LOC',
    description: 'Defects per 1000 lines of code'
  },
  
  defectEscapeRate: {
    good: 5,
    warning: 10,
    lowerIsBetter: true,
    unit: '%',
    description: 'Percentage of defects found in production'
  },
  
  automationCoverage: {
    good: 70,
    warning: 50,
    lowerIsBetter: false,
    unit: '%',
    description: 'Percentage of tests that are automated'
  },
  
  codeQualityScore: {
    good: 80,
    warning: 60,
    lowerIsBetter: false,
    unit: '/100',
    description: 'Overall code quality score'
  },
  
  testFlakinessRate: {
    good: 2,
    warning: 5,
    lowerIsBetter: true,
    unit: '%',
    description: 'Percentage of flaky tests'
  },
  
  // ============================================
  // SPEED & EFFICIENCY
  // ============================================
  
  avgBuildTimeMinutes: {
    good: 10,
    warning: 20,
    lowerIsBetter: true,
    unit: 'min',
    description: 'Average build time'
  },
  
  testExecutionTimeMinutes: {
    good: 15,
    warning: 30,
    lowerIsBetter: true,
    unit: 'min',
    description: 'Average test execution time'
  },
  
  deploymentFrequencyPerWeek: {
    good: 5,
    warning: 2,
    lowerIsBetter: false,
    unit: '/week',
    description: 'Number of deployments per week'
  },
  
  leadTimeDays: {
    good: 3,
    warning: 7,
    lowerIsBetter: true,
    unit: 'days',
    description: 'Time from commit to production'
  },
  
  mttrHours: {
    good: 2,
    warning: 8,
    lowerIsBetter: true,
    unit: 'hours',
    description: 'Mean time to recovery'
  },
  
  parallelTestEfficiency: {
    good: 80,
    warning: 60,
    lowerIsBetter: false,
    unit: '%',
    description: 'Efficiency of parallel test execution'
  },
  
  // ============================================
  // AGILE & PROCESS
  // ============================================
  
  sprintVelocity: {
    good: 40,
    warning: 25,
    lowerIsBetter: false,
    unit: 'points',
    description: 'Story points completed per sprint'
  },
  
  sprintCommitmentRate: {
    good: 90,
    warning: 75,
    lowerIsBetter: false,
    unit: '%',
    description: 'Percentage of committed work completed'
  },
  
  sprintCarryover: {
    good: 10,
    warning: 20,
    lowerIsBetter: true,
    unit: '%',
    description: 'Percentage of work carried to next sprint'
  },
  
  firstTimePassRate: {
    good: 85,
    warning: 70,
    lowerIsBetter: false,
    unit: '%',
    description: 'Percentage of tests passing on first run'
  },
  
  blockedTimeHours: {
    good: 4,
    warning: 12,
    lowerIsBetter: true,
    unit: 'hours',
    description: 'Time spent blocked per sprint'
  },
  
  // ============================================
  // RELIABILITY
  // ============================================
  
  changeFailureRate: {
    good: 5,
    warning: 15,
    lowerIsBetter: true,
    unit: '%',
    description: 'Percentage of changes causing failures'
  },
  
  mtbfHours: {
    good: 720,
    warning: 168,
    lowerIsBetter: false,
    unit: 'hours',
    description: 'Mean time between failures'
  },
  
  systemAvailability: {
    good: 99.9,
    warning: 99,
    lowerIsBetter: false,
    unit: '%',
    description: 'System uptime percentage'
  },
  
  infrastructureFailures: {
    good: 1,
    warning: 3,
    lowerIsBetter: true,
    unit: '/month',
    description: 'Infrastructure failures per month'
  },
  
  // ============================================
  // COMBINED/CALCULATED METRICS
  // ============================================
  
  // Same thresholds as the server's QA status (metricFormulas.QA_SCORE_THRESHOLDS).
  qaScore: {
    good: QA_SCORE_THRESHOLDS.good,
    warning: QA_SCORE_THRESHOLDS.warning,
    lowerIsBetter: false,
    unit: '/100',
    description: 'Overall QA health score'
  },
  
  technicalDebtScore: {
    good: 30,
    warning: 60,
    lowerIsBetter: true,
    unit: '/100',
    description: 'Technical debt accumulation score'
  },
  
  // ============================================
  // DEVELOPER METRICS
  // ============================================
  
  prMergeTimeHours: {
    good: 4,
    warning: 24,
    lowerIsBetter: true,
    unit: 'hours',
    description: 'Average time to merge PRs'
  },
  
  codeReviewTimeHours: {
    good: 2,
    warning: 4,
    lowerIsBetter: true,
    unit: 'hours',
    description: 'Average code review turnaround'
  },
  
  focusTimeHours: {
    good: 5,
    warning: 3,
    lowerIsBetter: false,
    unit: 'hours/day',
    description: 'Daily uninterrupted focus time'
  },
  
  meetingTimeHours: {
    good: 2,
    warning: 4,
    lowerIsBetter: true,
    unit: 'hours/day',
    description: 'Daily time spent in meetings'
  },
  
  contextSwitchesPerDay: {
    good: 3,
    warning: 6,
    lowerIsBetter: true,
    unit: '/day',
    description: 'Number of context switches per day'
  },
  
  happinessScore: {
    good: 70,
    warning: 50,
    lowerIsBetter: false,
    unit: '/100',
    // happiness_score is calculateWorkloadBalance() of focus, meetings, context switches,
    // PR and review times — a derived score, not a survey of satisfaction.
    description: 'Workload balance (derived from focus, meetings, context switches, PR and review times)'
  }
};

/**
 * KPI targets used by the dashboard (company summary "on track", "needs attention",
 * quality indicators) and anywhere else a single pass/fail target is shown.
 * The target is the metric's "good" threshold, so the dashboard, Team detail colours and
 * team suggestions agree on what "on target" means.
 */
export const KPI_TARGETS = {
  coverage: METRICS_CONFIG.testCoverage.good,          // test_coverage >= target (%)
  automation: METRICS_CONFIG.automationCoverage.good,  // automation_coverage >= target (%)
  flakiness: METRICS_CONFIG.testFlakinessRate.good,    // test_flakiness_rate <= target (%)
  escapeRate: METRICS_CONFIG.defectEscapeRate.good,    // defect_escape_rate <= target (%)
} as const;

export interface TeamKpiValues {
  qaScore: number | null;
  testCoverage: number | null;
  testFlakinessRate: number | null;
  defectEscapeRate: number | null;
  automationCoverage: number | null;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * One definition of "needs attention", used by the company summary card and the dashboard
 * table filter: QA score below the warning threshold, or any recorded KPI off its target.
 * Returns the reasons; an empty list means the team does not need attention.
 */
export function teamAttentionIssues(t: TeamKpiValues): string[] {
  const issues: string[] = [];
  if (t.qaScore !== null && t.qaScore < QA_SCORE_THRESHOLDS.warning) {
    issues.push(`QA score ${Math.round(t.qaScore)} (critical, <${QA_SCORE_THRESHOLDS.warning})`);
  }
  if (t.testCoverage !== null && t.testCoverage < KPI_TARGETS.coverage) issues.push(`Test coverage ${r1(t.testCoverage)}% (target ≥${KPI_TARGETS.coverage}%)`);
  if (t.testFlakinessRate !== null && t.testFlakinessRate > KPI_TARGETS.flakiness) issues.push(`Flakiness ${r1(t.testFlakinessRate)}% (target ≤${KPI_TARGETS.flakiness}%)`);
  if (t.defectEscapeRate !== null && t.defectEscapeRate > KPI_TARGETS.escapeRate) issues.push(`Defect escape rate ${r1(t.defectEscapeRate)}% (target ≤${KPI_TARGETS.escapeRate}%)`);
  if (t.automationCoverage !== null && t.automationCoverage < KPI_TARGETS.automation) issues.push(`Automation ${r1(t.automationCoverage)}% (target ≥${KPI_TARGETS.automation}%)`);
  return issues;
}

/** Company status "Teams vs KPI targets" bucket of one team. */
export type KpiTrackBucket = 'onTrack' | 'atRisk' | 'offTrack' | 'noData';

export interface KpiTargetCheck {
  key: 'testCoverage' | 'testFlakinessRate' | 'defectEscapeRate' | 'automationCoverage';
  label: string;
  value: number | null;
  target: number;
  lowerIsBetter: boolean;
  /** null when the KPI is not recorded */
  met: boolean | null;
  /** distance to the target in the KPI's unit (positive = short of it), null when met or not recorded */
  gap: number | null;
}

/** Shares of KPI targets met that make a team "on track" / "at risk"; below = "off track". */
export const KPI_TRACK_RULE = { onTrack: 0.75, atRisk: 0.5, minRecorded: 2 } as const;

export const KPI_TRACK_RULE_TEXT =
  `Based on 4 KPI targets (coverage ≥ ${KPI_TARGETS.coverage}%, automation ≥ ${KPI_TARGETS.automation}%, flakiness ≤ ${KPI_TARGETS.flakiness}%, escape rate ≤ ${KPI_TARGETS.escapeRate}%) ` +
  `among those recorded: on track = at least ${KPI_TRACK_RULE.onTrack * 100}% met, at risk = ${KPI_TRACK_RULE.atRisk * 100}% to ${KPI_TRACK_RULE.onTrack * 100}%, off track = under ${KPI_TRACK_RULE.atRisk * 100}%. ` +
  `Teams with fewer than ${KPI_TRACK_RULE.minRecorded} recorded are not classified.`;

/**
 * ONE definition of a team's "Teams vs KPI targets" bucket (company summary counts and the
 * dashboard's breakdown modal): the share of recorded KPI targets met.
 */
export function teamKpiTrack(t: Omit<TeamKpiValues, 'qaScore'>): { bucket: KpiTrackBucket; checks: KpiTargetCheck[]; met: number; recorded: number } {
  const mk = (key: KpiTargetCheck['key'], label: string, value: number | null, target: number, lowerIsBetter: boolean): KpiTargetCheck => {
    const met = value === null ? null : lowerIsBetter ? value <= target : value >= target;
    return { key, label, value, target, lowerIsBetter, met, gap: value === null || met ? null : Math.abs(value - target) };
  };
  const checks = [
    mk('testCoverage', 'Test coverage', t.testCoverage, KPI_TARGETS.coverage, false),
    mk('automationCoverage', 'Automation coverage', t.automationCoverage, KPI_TARGETS.automation, false),
    mk('testFlakinessRate', 'Test flakiness', t.testFlakinessRate, KPI_TARGETS.flakiness, true),
    mk('defectEscapeRate', 'Defect escape rate', t.defectEscapeRate, KPI_TARGETS.escapeRate, true),
  ];
  const recordedChecks = checks.filter((c) => c.met !== null);
  const met = recordedChecks.filter((c) => c.met).length;
  const recorded = recordedChecks.length;
  if (recorded < KPI_TRACK_RULE.minRecorded) return { bucket: 'noData', checks, met, recorded };
  const share = met / recorded;
  const bucket: KpiTrackBucket = share >= KPI_TRACK_RULE.onTrack ? 'onTrack' : share >= KPI_TRACK_RULE.atRisk ? 'atRisk' : 'offTrack';
  return { bucket, checks, met, recorded };
}

/** Short target text for a metric, e.g. "≥ 80%" or "≤ 4 hours". */
export function metricTargetText(metricKey: keyof MetricsConfig): string {
  const c = METRICS_CONFIG[metricKey];
  const unit = c.unit ? (c.unit.startsWith('%') || c.unit.startsWith('/') ? c.unit : ` ${c.unit}`) : '';
  return `${c.lowerIsBetter ? '≤' : '≥'} ${c.good}${unit}`;
}

/**
 * Get the status color class for a metric value
 * @param value - The metric value
 * @param metricKey - The key of the metric in METRICS_CONFIG
 * @returns Tailwind color class (text-emerald-*, text-amber-*, text-red-*)
 */
export function getMetricStatus(value: number, metricKey: keyof MetricsConfig): 'good' | 'warning' | 'critical' {
  const config = METRICS_CONFIG[metricKey];
  if (!config) return 'warning';
  
  if (config.lowerIsBetter) {
    if (value <= config.good) return 'good';
    if (value <= config.warning) return 'warning';
    return 'critical';
  } else {
    if (value >= config.good) return 'good';
    if (value >= config.warning) return 'warning';
    return 'critical';
  }
}

/**
 * Get Tailwind text color class based on metric status
 */
export function getMetricTextColor(value: number, metricKey: keyof MetricsConfig, darkMode = true): string {
  const status = getMetricStatus(value, metricKey);
  if (darkMode) {
    return status === 'good' ? 'text-emerald-400' : 
           status === 'warning' ? 'text-amber-400' : 'text-red-400';
  }
  return status === 'good' ? 'text-green-600' : 
         status === 'warning' ? 'text-amber-600' : 'text-red-600';
}

/**
 * Get Tailwind background color class based on metric status
 */
export function getMetricBgColor(value: number, metricKey: keyof MetricsConfig): string {
  const status = getMetricStatus(value, metricKey);
  return status === 'good' ? 'bg-emerald-500/20' : 
         status === 'warning' ? 'bg-amber-500/20' : 'bg-red-500/20';
}

/**
 * Get status label
 */
export function getMetricStatusLabel(value: number, metricKey: keyof MetricsConfig): string {
  const status = getMetricStatus(value, metricKey);
  return status === 'good' ? 'Good' : 
         status === 'warning' ? 'Needs Attention' : 'Critical';
}

export default METRICS_CONFIG;
