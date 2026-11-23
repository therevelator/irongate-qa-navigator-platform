/**
 * Range checks for numeric fields written by the manual-entry endpoints (developer metrics,
 * technical-debt impact, business impact months and configuration), so an out-of-range or
 * non-numeric value is a clear 400 instead of a database error (500).
 *
 * A field spec gives the request key, the column it is stored in, and its range. The maximum of
 * a NUMERIC(p, s) column is below 10^(p − s); integers are 32-bit. Semantic ranges (percentages
 * 0–100, NPS −100…100) are tighter than the column where the meaning requires it.
 *
 * parseRangedFields returns, per key: undefined when the key is absent (partial updates keep
 * the stored value), null when it is explicitly null / '' (clears it), else the number.
 */

export interface RangedField {
  key: string;
  column: string;
  label: string;
  min: number;
  max: number;
  integer?: boolean;
  /** Round to a whole number before the range check (instead of refusing a fraction). */
  round?: boolean;
}

const INT_MAX = 2147483647;

export const f = (key: string, column: string, label: string, min: number, max: number, integer = false, round = false): RangedField =>
  ({ key, column, label, min, max, integer, ...(round ? { round } : {}) });

/** Largest value a NUMERIC(p, s) column accepts (rounded to its scale). */
export const numericMax = (p: number, s: number) => Number((10 ** (p - s) - 10 ** -s).toFixed(s));

export function parseRangedFields(body: Record<string, unknown> | null | undefined, fields: RangedField[]) {
  const values: Record<string, number | null | undefined> = {};
  const errors: string[] = [];
  for (const fld of fields) {
    if (!body || !(fld.key in body)) { values[fld.key] = undefined; continue; }
    const raw = body[fld.key];
    if (raw === null || raw === '') { values[fld.key] = null; continue; }
    const given = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(given)) { errors.push(`${fld.label} must be a number`); continue; }
    const n = fld.round ? Math.round(given) : given;
    if (fld.integer && !Number.isInteger(n)) { errors.push(`${fld.label} must be a whole number`); continue; }
    if (n < fld.min || n > fld.max) { errors.push(`${fld.label} must be between ${fld.min} and ${fld.max}`); continue; }
    values[fld.key] = n;
  }
  return { values, errors };
}

/** Postgres data exceptions (SQLSTATE class 22: numeric overflow, invalid number / date text) and check violations. */
export function isDataException(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  return typeof code === 'string' && (code.startsWith('22') || code === '23514');
}

export function dataExceptionMessage(e: unknown): string {
  const code = (e as { code?: string })?.code;
  if (code === '22003') return 'A value is too large for this field';
  if (code === '22P02') return 'A value is not a valid number';
  if (code === '22007' || code === '22008') return 'A date is not valid';
  return 'A value is outside the allowed range';
}

/* ------------------------------------------------------------------------------------------
 * Field sets
 * ---------------------------------------------------------------------------------------- */

/** POST /api/metrics/developer (columns numeric(10,2), context switches integer, happiness numeric(4,1) 0–100). */
export const DEVELOPER_METRIC_FIELDS: RangedField[] = [
  f('prMergeTimeAvg', 'pr_merge_time_avg', 'PR merge time (hours)', 0, 10000),
  f('codeReviewTimeAvg', 'code_review_time_avg', 'Code review time (hours)', 0, 10000),
  f('focusTimeHours', 'focus_time_hours', 'Focus time (hours per day)', 0, 24),
  f('meetingTimeHours', 'meeting_time_hours', 'Meeting time (hours per day)', 0, 24),
  // A whole number per day: an average such as 3.6 is rounded (to 4).
  f('contextSwitchesPerDay', 'context_switches_per_day', 'Context switches per day', 0, 1000, true, true),
  f('happinessScore', 'happiness_score', 'Workload balance score', 0, 100),
];

/** PUT /api/analytics/technical-debt/:id/impact. */
export const DEBT_IMPACT_FIELDS: RangedField[] = [
  f('affected_users', 'affected_users', 'Affected users', 0, INT_MAX, true),
  f('support_tickets_monthly', 'support_tickets_monthly', 'Support tickets per month', 0, INT_MAX, true),
  f('downtime_minutes_monthly', 'downtime_minutes_monthly', 'Downtime minutes per month', 0, 44640, true),
  f('revenue_impact_percent', 'revenue_impact_percent', 'Revenue impact (%)', 0, 100),
  f('sla_breaches_monthly', 'sla_breaches_monthly', 'SLA breaches per month', 0, INT_MAX, true),
  f('estimated_effort_hours', 'effort_hours', 'Estimated effort (hours)', 0, numericMax(10, 2)),
];

/** Business impact: monthly quality metrics (business_impact_quality_metrics). */
export const BI_QUALITY_RANGES: RangedField[] = [
  f('test_coverage', 'test_coverage', 'Test coverage (%)', 0, 100),
  f('defect_density', 'defect_density', 'Defect density', 0, numericMax(8, 4)),
  f('defect_escape_rate', 'defect_escape_rate', 'Defect escape rate (%)', 0, 100),
  f('mttr_hours', 'mttr_hours', 'MTTR (hours)', 0, numericMax(8, 2)),
  f('deployment_frequency', 'deployment_frequency', 'Deployments per month', 0, numericMax(8, 2)),
  f('lead_time_days', 'lead_time_days', 'Lead time (days)', 0, numericMax(8, 2)),
  f('code_quality_score', 'code_quality_score', 'Code quality score', 0, 100),
  f('change_failure_rate', 'change_failure_rate', 'Change failure rate (%)', 0, 100),
];

/** Business impact: monthly business KPIs (business_impact_business_kpis). */
export const BI_KPI_RANGES: RangedField[] = [
  f('monthly_revenue', 'monthly_revenue', 'Monthly revenue', 0, numericMax(15, 2)),
  f('active_users', 'active_users', 'Active users', 0, INT_MAX, true),
  f('churn_rate', 'churn_rate', 'Churn rate (%)', 0, 100),
  f('feature_adoption_rate', 'feature_adoption_rate', 'Feature adoption (%)', 0, 100),
  f('new_customers', 'new_customers', 'New customers', 0, INT_MAX, true),
  f('customer_lifetime_value', 'customer_lifetime_value', 'Customer lifetime value', 0, numericMax(12, 2)),
  f('nps_score', 'nps_score', 'NPS', -100, 100),
  f('csat_score', 'csat_score', 'CSAT', 0, 100),
  f('support_ticket_volume', 'support_ticket_volume', 'Support tickets', 0, INT_MAX, true),
  f('avg_resolution_time_hours', 'avg_resolution_time_hours', 'Average resolution time (hours)', 0, numericMax(8, 2)),
];

/** Business impact: monthly context (business_impact_context). */
export const BI_CONTEXT_RANGES: RangedField[] = [
  f('team_size', 'team_size', 'Team size', 0, 100000, true),
  f('sprint_length_days', 'sprint_length_days', 'Sprint length (days)', 1, 366, true),
  f('working_days', 'working_days', 'Working days', 0, 31, true),
  f('feature_release_count', 'feature_release_count', 'Feature releases', 0, INT_MAX, true),
  f('bug_fix_count', 'bug_fix_count', 'Bug fixes', 0, INT_MAX, true),
  f('tech_debt_items_resolved', 'tech_debt_items_resolved', 'Tech debt items resolved', 0, INT_MAX, true),
  f('user_growth_rate', 'user_growth_rate', 'User growth (%)', -100, numericMax(5, 2)),
  f('total_user_base', 'total_user_base', 'Total user base', 0, INT_MAX, true),
  f('marketing_spend', 'marketing_spend', 'Marketing spend', 0, numericMax(12, 2)),
  f('major_incident_count', 'major_incident_count', 'Major incidents', 0, INT_MAX, true),
  f('downtime_minutes', 'downtime_minutes', 'Downtime (minutes)', 0, 44640, true),
];

/** Business impact configuration rows (business_impact_config / business_impact_history). */
export const BI_CONFIG_FIELDS: RangedField[] = [
  f('quality_score', 'quality_score', 'Quality score', 0, 100),
  f('revenue_impact', 'revenue_impact', 'Revenue impact', -numericMax(12, 2), numericMax(12, 2)),
  f('customer_satisfaction', 'customer_satisfaction', 'Customer satisfaction', 0, 100),
  f('feature_adoption_rate', 'feature_adoption_rate', 'Feature adoption (%)', 0, 100),
  f('correlation_strength', 'correlation_strength', 'Correlation strength', -1, 1),
  f('churn_rate', 'churn_rate', 'Churn rate (%)', 0, 100),
];

/** Validate each month of a bulk save (quality / kpis / context sections). Returns the first errors with the month. */
export function bulkMonthErrors(months: unknown[]): string[] {
  const out: string[] = [];
  for (const m of months as any[]) {
    const label = typeof m?.month_year === 'string' ? m.month_year : 'a month';
    for (const [section, fields] of [['quality', BI_QUALITY_RANGES], ['kpis', BI_KPI_RANGES], ['context', BI_CONTEXT_RANGES]] as const) {
      if (m?.[section] && typeof m[section] === 'object') {
        for (const e of parseRangedFields(m[section], fields).errors) out.push(`${label}: ${e}`);
      }
    }
    if (out.length >= 20) break;
  }
  return out;
}
