/** Every metric the engine calculates, with its unit, KPI column and formula. */
import type { MetricGroup, MetricSpec } from './types';
import { CI_METRICS } from './ci';
import { deliveryMetrics, DEFAULT_CHANGE_FAILURE_WINDOW_HOURS } from './delivery';
import { WORK_METRICS } from './work';
import { QUALITY_METRICS } from './quality';

export interface MetricOptions { changeFailureWindowHours?: number }

/** Phase 1 (CI), phase 2 (delivery and reliability), phase 3 (work; code quality). */
export const buildMetrics = (o: MetricOptions = {}): Record<string, MetricSpec> => ({
  ...CI_METRICS, ...deliveryMetrics(o.changeFailureWindowHours ?? DEFAULT_CHANGE_FAILURE_WINDOW_HOURS), ...WORK_METRICS, ...QUALITY_METRICS,
});

export const METRICS: Record<string, MetricSpec> = buildMetrics();
export const groupOf = (key: string): MetricGroup => METRICS[key]?.group ?? 'ci';

/** The metric key behind a KPI column (for "How this was calculated"). */
export const EVIDENCE_FOR_KPI: Partial<Record<string, string>> = Object.fromEntries(
  Object.values(METRICS).filter((m) => m.kpi).map((m) => [m.kpi as string, m.key])
);
