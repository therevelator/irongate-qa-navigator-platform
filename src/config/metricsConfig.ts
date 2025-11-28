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
  
  qaScore: {
    good: 85,
    warning: 70,
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
    description: 'Developer satisfaction score'
  }
};

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
