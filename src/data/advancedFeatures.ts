// Shared data models for the analytics features, plus the single shared definitions
// of the developer-level derived metrics (DDPS, burnout risk, workload balance).
// No mock or random data generators live here: every displayed value must come from the API.
import { computeBurnoutRisk, computeDdps } from '../../server/lib/metricFormulas';
import type { BurnoutRiskLevel } from '../../server/lib/metricFormulas';

export interface TestCase {
  id: string;
  name: string;
  requirement_id: string;
  status: 'active' | 'obsolete' | 'redundant';
  last_executed: string;
  pass_rate: number;
  execution_count: number;
  avg_duration: number;
  effectiveness_score: number;
  tags: string[];
}

export interface FlakyTest {
  id: string;
  test_name: string;
  flakiness_score: number;
  failure_pattern: 'timing' | 'environment' | 'data' | 'network' | 'unknown';
  occurrences: number;
  first_detected: string;
  last_occurrence: string;
  suggested_fix: string;
  root_cause: string;
  history: { date: string; passed: boolean }[];
}

export interface PipelineStage {
  id: string;
  name: string;
  duration: number;
  success_rate: number;
  resource_usage: {
    cpu: number;
    memory: number;
    cost: number;
  };
  bottleneck_score: number;
}

export interface PerformanceMetric {
  id: string;
  endpoint: string;
  response_time_p50: number;
  response_time_p95: number;
  response_time_p99: number;
  throughput: number;
  error_rate: number;
  timestamp: string;
}

export interface DeveloperMetric {
  developer_id: string;
  name: string;
  code_review_time_avg: number;
  pr_merge_time_avg: number;
  happiness_score: number;
  context_switches_per_day: number;
  focus_time_hours: number;
  meeting_time_hours: number;
}

export interface TechnicalDebt {
  id: string;
  title: string;
  description: string;
  category: 'code_quality' | 'architecture' | 'testing' | 'documentation' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  estimated_effort_hours: number;
  cost_of_delay: number;
  priority_score: number;
  created_date: string;
  status: 'open' | 'in_progress' | 'resolved';
  // Impact metrics for ROI calculation
  affected_users?: number;
  support_tickets_monthly?: number;
  downtime_minutes_monthly?: number;
  revenue_impact_percent?: number;
  sla_breaches_monthly?: number;
  // Calculated ROI fields (from backend)
  investment_cost?: number;
  monthly_cost_of_delay?: number;
  annual_savings?: number;
  roi_percentage?: number;
  payback_months?: number;
}

export interface BusinessImpact {
  metric_name: string;
  quality_score: number;
  revenue_impact: number;
  customer_satisfaction: number;
  feature_adoption_rate: number;
  correlation_strength: number;
}

export interface TestExecution {
  id: string;
  test_suite: string;
  start_time: string;
  end_time: string;
  duration: number;
  status: 'running' | 'passed' | 'failed' | 'blocked';
  assigned_to: string;
  dependencies: string[];
}


// ---------------------------------------------------------------------------
// Developer metric definitions (one definition per metric, shared by
// TeamDetailView, DeveloperProductivity and ManualMetricsInput).
// ---------------------------------------------------------------------------

export interface DeveloperInputs {
  pr_merge_time_avg: number;       // hours from PR open to merge (elapsed, not effort)
  code_review_time_avg: number;    // hours per review
  focus_time_hours: number;        // hours/day
  meeting_time_hours: number;      // hours/day
  context_switches_per_day: number;
}

// The DDPS definition lives in server/lib/metricFormulas.ts (shared with the API).
export { DDPS_FORMULA, DDPS_RAW_MAX as DDPS_MAX_RAW, QA_SCORE_FORMULA } from '../../server/lib/metricFormulas';

/**
 * Daily Developer Productivity Score, 0–100 — thin wrapper over the shared computeDdps().
 * Scheduled hours = focus + meetings (PR merge / review times are elapsed time, not effort).
 */
export const calculateDDPS = (d: DeveloperInputs) => {
  const r = computeDdps(d);
  const scheduled = r.scheduledHours ?? d.focus_time_hours + d.meeting_time_hours;
  const overtime = Math.max(0, scheduled - 8);
  return {
    score: r.score ?? 0,
    hasScore: r.score != null,
    estimatedHours: Math.round(scheduled * 10) / 10,
    overtimeHours: Math.round(overtime * 10) / 10,
    isOvertime: scheduled > 8,
  };
};

/** DDPS bands on the 0–100 scale, highest first (lower bound inclusive). */
export const DDPS_BANDS: ReadonlyArray<{ min: number; label: string; tone: 'good' | 'warn' | 'bad' }> = [
  { min: 80, label: 'Exceptional', tone: 'good' },
  { min: 60, label: 'High', tone: 'good' },
  { min: 40, label: 'Moderate', tone: 'warn' },
  { min: -Infinity, label: 'Low', tone: 'bad' },
];

/** DDPS band labels on the 0–100 scale. */
export const ddpsBand = (score: number | null | undefined): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } => {
  if (score == null || Number.isNaN(score)) return { label: 'No data', tone: 'neutral' };
  const band = DDPS_BANDS.find((b) => score >= b.min) ?? DDPS_BANDS[DDPS_BANDS.length - 1];
  return { label: band.label, tone: band.tone };
};

export type BurnoutRisk = BurnoutRiskLevel;

// The burnout-risk rule lives in server/lib/metricFormulas.ts (shared with the API).
export { BURNOUT_DEFINITION } from '../../server/lib/metricFormulas';

/** Burnout risk from workload inputs only — thin wrapper over the shared computeBurnoutRisk(). */
export const calculateBurnoutRisk = (d: Pick<DeveloperInputs, 'focus_time_hours' | 'meeting_time_hours' | 'context_switches_per_day'>): BurnoutRisk =>
  // Inputs are finite numbers here, so the shared rule always returns a level.
  computeBurnoutRisk(d) ?? 'low';

export const burnoutTone = (r: BurnoutRisk): 'good' | 'warn' | 'bad' => (r === 'low' ? 'good' : r === 'moderate' ? 'warn' : 'bad');

export const WORKLOAD_BALANCE_FORMULA =
  '40% × focus ÷ (focus + meetings) + 30% × (10 − context switches) ÷ 10 + 15% × (4 − meeting h) ÷ 4 + 7.5% × (24 − PR h) ÷ 24 + 7.5% × (8 − review h) ÷ 8, each term floored at 0, scaled to 0–100';

/**
 * Workload balance score (0–100), derived from the workload inputs — not a survey.
 * This is the value stored in developer_metrics.happiness_score.
 */
export const calculateWorkloadBalance = (d: DeveloperInputs): number => {
  const tracked = d.focus_time_hours + d.meeting_time_hours;
  const focusRatio = tracked > 0 ? d.focus_time_hours / tracked : 0;
  const focusScore = Math.min(focusRatio * 100, 100) * 0.4;
  const contextScore = Math.max(0, ((10 - d.context_switches_per_day) / 10) * 100) * 0.3;
  const meetingScore = Math.max(0, ((4 - d.meeting_time_hours) / 4) * 100) * 0.15;
  const prScore = Math.max(0, ((24 - d.pr_merge_time_avg) / 24) * 100) * 0.075;
  const reviewScore = Math.max(0, ((8 - d.code_review_time_avg) / 8) * 100) * 0.075;
  return Math.min(100, Math.max(0, focusScore + contextScore + meetingScore + prScore + reviewScore));
};

/** Developer recommendation status, as produced by the server (healthy < needs-attention < at-risk). */
export const developerStatusMeta = (status: unknown): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } => {
  if (status === 'healthy') return { label: 'Healthy', tone: 'good' };
  if (status === 'needs-attention') return { label: 'Needs attention', tone: 'warn' };
  if (status === 'at-risk') return { label: 'At risk', tone: 'bad' };
  return { label: typeof status === 'string' && status ? status.replace(/-/g, ' ') : 'Unrated', tone: 'neutral' };
};

/** Theme-aware colours for recharts (axis, grid, tooltip, series). */
export const chartTheme = (isDark: boolean) => ({
  axis: isDark ? '#94a3b8' : '#64748b',       // slate-400 / slate-500
  grid: isDark ? '#1e293b' : '#e2e8f0',       // slate-800 / slate-200
  series: isDark ? '#7aa2d6' : '#2d5b94',     // brand-400 / brand-600 (approx.)
  series2: isDark ? '#cbd5e1' : '#475569',    // slate-300 / slate-600
  tooltip: {
    contentStyle: {
      backgroundColor: isDark ? '#0f172a' : '#ffffff',
      border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
      borderRadius: 6,
      color: isDark ? '#f1f5f9' : '#0f172a',
      fontSize: 12,
    },
    labelStyle: { color: isDark ? '#94a3b8' : '#64748b' },
    itemStyle: { color: isDark ? '#f1f5f9' : '#0f172a' },
  },
});

/** "17 Nov 2026" style date, or null when the input is missing/invalid. */
export const formatAsOf = (d: string | null | undefined): string | null => {
  if (!d) return null;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
