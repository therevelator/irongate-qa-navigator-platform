// Expected update frequency per metric. Metrics are pushed (KPI ingestion API, Manual
// metrics); these intervals do not schedule anything. Team detail uses them to flag a
// metric as stale when field_sources[metric].recorded_at is older than the interval.
export const DEFAULT_METRIC_INTERVALS: Array<{ metric_key: string; interval_value: number; interval_unit: 'minutes' | 'hours' | 'days' | 'weeks' | 'months'; custom_label: string }> = [
  // Quality Metrics
  { metric_key: 'test_coverage', interval_value: 1, interval_unit: 'days', custom_label: 'Test Coverage' },
  { metric_key: 'test_flakiness_rate', interval_value: 1, interval_unit: 'days', custom_label: 'Test Flakiness Rate' },
  { metric_key: 'defect_density', interval_value: 1, interval_unit: 'weeks', custom_label: 'Defect Density' },
  { metric_key: 'defect_escape_rate', interval_value: 1, interval_unit: 'weeks', custom_label: 'Defect Escape Rate' },
  { metric_key: 'code_quality_score', interval_value: 1, interval_unit: 'days', custom_label: 'Code Quality Score' },
  
  // Speed & Efficiency
  { metric_key: 'avg_build_time_minutes', interval_value: 1, interval_unit: 'hours', custom_label: 'Avg Build Time' },
  { metric_key: 'test_execution_time_minutes', interval_value: 1, interval_unit: 'hours', custom_label: 'Test Execution Time' },
  { metric_key: 'deployment_frequency_per_week', interval_value: 1, interval_unit: 'weeks', custom_label: 'Deployment Frequency' },
  { metric_key: 'lead_time_days', interval_value: 1, interval_unit: 'days', custom_label: 'Lead Time' },
  { metric_key: 'mttr_hours', interval_value: 1, interval_unit: 'days', custom_label: 'MTTR' },
  { metric_key: 'parallel_test_efficiency', interval_value: 1, interval_unit: 'days', custom_label: 'Parallel Test Efficiency' },
  
  // Agile & Process
  { metric_key: 'sprint_velocity', interval_value: 2, interval_unit: 'weeks', custom_label: 'Sprint Velocity' },
  { metric_key: 'sprint_commitment_rate', interval_value: 2, interval_unit: 'weeks', custom_label: 'Sprint Commitment Rate' },
  { metric_key: 'sprint_carryover', interval_value: 2, interval_unit: 'weeks', custom_label: 'Sprint Carryover' },
  { metric_key: 'first_time_pass_rate', interval_value: 1, interval_unit: 'days', custom_label: 'First Time Pass Rate' },
  { metric_key: 'blocked_time_hours', interval_value: 1, interval_unit: 'days', custom_label: 'Blocked Time' },
  { metric_key: 'sizing_accuracy', interval_value: 2, interval_unit: 'weeks', custom_label: 'Sizing Accuracy' },
  
  // Automation
  { metric_key: 'automation_coverage', interval_value: 1, interval_unit: 'weeks', custom_label: 'Automation Coverage' },
  { metric_key: 'automation_roi', interval_value: 1, interval_unit: 'months', custom_label: 'Automation ROI' },
  
  // Reliability
  { metric_key: 'change_failure_rate', interval_value: 1, interval_unit: 'weeks', custom_label: 'Change Failure Rate' },
  { metric_key: 'mtbf_hours', interval_value: 1, interval_unit: 'weeks', custom_label: 'MTBF' },
  { metric_key: 'system_availability', interval_value: 1, interval_unit: 'days', custom_label: 'System Availability' },
  { metric_key: 'infrastructure_failures', interval_value: 1, interval_unit: 'weeks', custom_label: 'Infrastructure Failures' },
];
