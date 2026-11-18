/**
 * Loads a team's stored inputs and computes its revenue impact with the formulas of
 * server/lib/revenueImpact.ts. Callers check access first (analytics scope, userPolicy).
 */
import { query } from '../../src/lib/db';
import { getFinancialConfig } from './financialConfig';
import { loadTargetBook, isTargetMetric, type TargetBook } from './targets';
import {
  REVENUE_QUALITY_METRICS, allRevenueSensitivities, fitWindow, metricOverlap, latestValues, revenueAtStake, debtRevenueAtRisk,
  incidentDowntimeCost, churnRevenueLoss, financialParams, supportTicketCost, buildMoneySummary,
  type MonthlyRow, type TargetToday, type RevenueSensitivity, type RevenueAtStake, type DebtAtRisk,
  type SimpleMonthlyFigure, type CurrentValue, type MoneySummary, type FinancialParamUsed, type TeamRevenueFigures,
} from './revenueImpact';

export interface TeamRef { id: string; name: string; department_id: string | null; department_name?: string | null }

export interface TeamRevenueImpact {
  teamId: string;
  teamName: string;
  /** any input row from generated sample data (data_source / source 'synthetic') */
  sampleData: boolean;
  months: { paired: number; withRevenue: number; first: string | null; last: string | null; source: 'measured' | 'sample' | null; excludedOtherSource: number };
  sensitivities: RevenueSensitivity[];
  current: Record<string, CurrentValue | null>;
  targets: Record<string, TargetToday | null>;
  stake: RevenueAtStake;
  debt: DebtAtRisk;
  incidents: SimpleMonthlyFigure;
  churn: SimpleMonthlyFigure;
  support: SimpleMonthlyFigure;
  availabilityTarget: TargetToday | null;
  summary: MoneySummary;
  financialParameters: FinancialParamUsed[];
  latestRevenue: { month: string; value: number } | null;
}

const isSynthetic = (r: Record<string, unknown>) =>
  String(r.data_source ?? r.source ?? '').toLowerCase() === 'synthetic';

export async function computeTeamRevenueImpact(companyId: string, team: TeamRef, book?: TargetBook, now = Date.now()): Promise<TeamRevenueImpact> {
  const [quality, kpis, context, debtItems, fin, targetBook] = await Promise.all([
    query<MonthlyRow[]>('SELECT * FROM business_impact_quality_metrics WHERE team_id = ? ORDER BY month_year ASC', [team.id]),
    query<MonthlyRow[]>('SELECT * FROM business_impact_business_kpis WHERE team_id = ? ORDER BY month_year ASC', [team.id]),
    query<MonthlyRow[]>('SELECT month_year, downtime_minutes, major_incident_count FROM business_impact_context WHERE team_id = ? ORDER BY month_year ASC', [team.id]),
    query<any[]>(
      `SELECT id, title, status, effort_hours AS estimated_effort_hours, affected_users, support_tickets_monthly, downtime_minutes_monthly,
              revenue_impact_percent, sla_breaches_monthly, source
         FROM technical_debt WHERE company_id = ? AND team_id = ?`,
      [companyId, team.id]
    ),
    getFinancialConfig(companyId, team.id),
    book ? Promise.resolve(book) : loadTargetBook(companyId),
  ]);

  const window = fitWindow(quality, kpis);
  const sensitivities = allRevenueSensitivities(quality, kpis, window.months);
  const current = latestValues(quality, window.months);
  const targets: Record<string, TargetToday | null> = {};
  for (const m of REVENUE_QUALITY_METRICS) {
    if (!m.targetKey || !isTargetMetric(m.targetKey)) { targets[m.key] = null; continue; }
    const t = targetBook.at({ id: team.id, department_id: team.department_id }, companyId, m.targetKey, now);
    targets[m.key] = { good: t.good, lowerIsBetter: t.lowerIsBetter, scope: t.scope, validFrom: t.validFrom };
  }

  const pairedMonths = window.months;
  const withRevenue = kpis.filter(k => k.monthly_revenue !== null && k.monthly_revenue !== undefined);
  const latestRev = [...withRevenue].sort((a, b) => b.month_year.localeCompare(a.month_year))[0];

  const usedDebt = debtItems.filter(d => !['resolved', 'wont_fix'].includes(String(d.status)));
  const av = targetBook.at({ id: team.id, department_id: team.department_id }, companyId, 'system_availability', now);
  const availabilityTarget: TargetToday = { good: av.good, lowerIsBetter: av.lowerIsBetter, scope: av.scope, validFrom: av.validFrom };
  const stake = revenueAtStake(sensitivities, current, targets, (a, b) => metricOverlap(quality, a, b, window.months));
  const debt = debtRevenueAtRisk(debtItems, fin.config, fin.defaultsUsed);
  const incidents = incidentDowntimeCost(context, fin.config, fin.defaultsUsed);
  const churn = churnRevenueLoss(kpis);
  const support = supportTicketCost(kpis, fin.config, fin.defaultsUsed);
  const summary = buildMoneySummary({
    sensitivities, stake, debt, debtItems: debtItems.map((d: any) => ({ ...d, id: String(d.id), title: String(d.title ?? 'Debt item') })),
    incidents, support, churn, availabilityTarget: availabilityTarget.good, config: fin.config, defaultsUsed: fin.defaultsUsed,
  });
  return {
    teamId: team.id,
    teamName: team.name,
    sampleData: window.source === 'sample' || usedDebt.some(isSynthetic),
    months: {
      paired: pairedMonths.length, withRevenue: withRevenue.length, first: pairedMonths[0] ?? null, last: pairedMonths[pairedMonths.length - 1] ?? null,
      source: window.source, excludedOtherSource: window.excludedMonths,
    },
    sensitivities,
    current,
    targets,
    stake,
    debt,
    incidents,
    churn,
    support,
    availabilityTarget,
    summary,
    financialParameters: financialParams(fin.config, fin.defaultsUsed, ['developer_hourly_rate', 'support_ticket_cost', 'downtime_cost_per_minute', 'revenue_per_user_monthly', 'sla_breach_penalty']),
    latestRevenue: latestRev ? { month: latestRev.month_year, value: Number(latestRev.monthly_revenue) } : null,
  };
}

export function teamFigures(r: TeamRevenueImpact, team: TeamRef): TeamRevenueFigures {
  return {
    teamId: r.teamId,
    teamName: r.teamName,
    departmentId: team.department_id,
    departmentName: team.department_name ?? null,
    stake: { monthly: r.stake.monthly, monthlyLow: r.stake.monthlyLow, monthlyHigh: r.stake.monthlyHigh, reason: r.stake.reason, metricsIncluded: r.stake.metricsIncluded },
    debt: { monthly: r.debt.monthly, reason: r.debt.reason },
    sampleData: r.sampleData,
  };
}
