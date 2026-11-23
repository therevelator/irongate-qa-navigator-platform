/** Types shared by the metric calculations. */

export type MetricGroup = 'ci' | 'delivery' | 'work' | 'quality' | 'automation';
export const ALL_GROUPS: MetricGroup[] = ['ci', 'delivery', 'work', 'quality', 'automation'];

export interface MetricSpec {
  key: string;
  label: string;
  unit: string;
  /** The KPI column the value is written to (dashboards, alerts, targets, QA score), or null when the value is evidence only. */
  kpi: string | null;
  formula: string;
  /** 'ci' (phase 1: tests, coverage, pipelines; default), 'delivery' (phase 2: deployments, incidents), 'work' (phase 3: issues), 'quality' (phase 3: static analysis) or 'automation' (test management: cases and executions). */
  group?: MetricGroup;
}

export interface ComputedMetric {
  key: string;
  value: number;
  /** The values the result was calculated from (counts, medians, windows). */
  inputs: Record<string, unknown>;
  /** The source records and the evidence lists (flaky tests, lowest-coverage files, failed deploys, escaped issue keys, …). */
  sources: Record<string, unknown>;
  sampleSize: number;
  /** The latest source time the value is based on (recorded_at of the KPI value). */
  recordedAt: string;
}

export type Confidence = 'high' | 'medium' | 'low';
export const confidenceFor = (n: number): Confidence => (n >= 10 ? 'high' : n >= 3 ? 'medium' : 'low');

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
