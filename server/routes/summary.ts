import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { policyActor } from '../middleware/access';
import { analyticsScopeLevelOf, analyticsTeamsInScope, canViewRevenueRollup, managedDepartmentIds } from '../lib/userPolicy';
import { canSeeAlert } from '../lib/alertPolicy';
import { teamKpiTrack, KPI_TARGET_KEYS } from '../../src/config/metricsConfig';
import { QA_SCORE_THRESHOLDS, qaStatusFromScore, toNum } from '../lib/metricFormulas';
import { evaluateLatestSnapshot, evaluateSnapshot, loadDataClock, type EvalContext } from '../lib/kpiEvaluation';
import { loadIntervals, referenceFor } from '../lib/staleness';
import { loadTargetBook } from '../lib/targets';
import { computeTeamRevenueImpact, teamFigures, type TeamRef } from '../lib/revenueImpactData';
import { REVENUE_CAVEATS, rollUpRevenue } from '../lib/revenueImpact';
import { computeCompanyMetrics } from './analytics';
import {
  movement, rankImproved, rankRisks, statusChanges, SUMMARY_TEXT, weekChange, type SummaryTeamInput,
} from '../lib/executiveSummary';

/**
 * Executive summary (src/components/ExecutiveSummary.tsx, /summary): everything the one-minute
 * phone summary shows, in ONE call.
 *
 * GET /api/summary
 *
 * Scope: the shared analytics rule (analyticsTeamsInScope → canViewTeamAnalytics): super_admin the
 * whole company, a QA manager the teams of the departments they manage, everyone else the teams
 * they are assigned to. Every number is computed over those teams only:
 *   quality       the overview's figures over the scope (computeCompanyMetrics: QA score weighted by
 *                 team size, trend vs 7–14 days ago, KPI status buckets, as of / last updated)
 *   risks         / improved / sinceLastWeek: server/lib/executiveSummary.ts
 *   money         the Business impact revenue roll-up (rollUpRevenue over the teams in scope), for
 *                 the roles that may see the roll-up (canViewRevenueRollup: super admins, managers);
 *                 null with a reason otherwise
 *   alerts        open alerts the caller may see (canSeeAlert), the same counts as GET /api/alerts,
 *                 plus those opened / resolved in the last 7 days
 * Team aggregates only: no individual data. A caller without a team in scope gets an empty summary.
 */
const router = express.Router();

const DAY_MS = 86_400_000;

router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const companyId = req.companyId as string;
    const actor = policyActor(req);
    const level = analyticsScopeLevelOf(actor);
    const rows = await query<any[]>(
      `SELECT t.id, t.name, t.department_id, d.name AS department_name
         FROM teams t LEFT JOIN departments d ON d.id = t.department_id
        WHERE t.company_id = ? AND t.is_active = TRUE
        ORDER BY d.name NULLS LAST, t.name`,
      [companyId]
    );
    const teams: TeamRef[] = analyticsTeamsInScope(actor, rows.map((r: any): TeamRef => ({
      id: String(r.id), name: r.name, department_id: r.department_id ? String(r.department_id) : null, department_name: r.department_name ?? null,
    })));
    const teamIds = teams.map((t) => t.id);
    const company = await queryOne<any>('SELECT name FROM companies WHERE id = ?', [companyId]);

    // Scope label: the company, the departments managed, or the teams.
    const departments = [...new Set(teams.map((t) => t.department_name).filter((d): d is string => !!d))];
    let scopeLabel: string = company?.name ?? 'Your company';
    if (level === 'department') {
      const managed = new Set(managedDepartmentIds(actor));
      const names = [...new Set(teams.filter((t) => t.department_id && managed.has(t.department_id)).map((t) => t.department_name).filter(Boolean))] as string[];
      scopeLabel = names.length ? names.join(', ') : departments.join(', ') || scopeLabel;
    } else if (level !== 'company') {
      scopeLabel = teams.length === 1 ? teams[0].name : `${teams.length} teams`;
    }

    const scope = { level, label: scopeLabel, companyName: company?.name ?? null, teamCount: teams.length, departments };
    const generatedAt = new Date().toISOString();
    if (!teams.length) {
      return res.json({ scope, empty: true, generatedAt, quality: null, risks: { top: [], total: 0 }, improved: { top: [], total: 0 }, money: null, alerts: null, sinceLastWeek: null, teams: [], text: SUMMARY_TEXT });
    }

    // 1. Quality: the overview's own figures over the scope (one definition).
    const metrics = await computeCompanyMetrics(companyId, level === 'company' ? null : teamIds);

    // 2. Per team: QA score and the tracked KPIs now (latest snapshot) and last week (latest
    //    snapshot dated 7–14 days ago, judged as of its day).
    const ctx: EvalContext = { companyId, intervals: await loadIntervals(companyId), book: await loadTargetBook(companyId) };
    ctx.dataClock = await loadDataClock(companyId, ctx.intervals);
    const now = Date.now();
    const latestRows = await query<any[]>(
      `SELECT DISTINCT ON (ks.team_id) ks.*, to_char(ks.snapshot_date, 'YYYY-MM-DD') AS snapshot_day
         FROM kpi_snapshots ks WHERE ks.team_id = ANY(?::text[])
        ORDER BY ks.team_id, ks.snapshot_date DESC, ks.created_at DESC`,
      [teamIds]
    );
    const prevRows = await query<any[]>(
      `SELECT DISTINCT ON (ks.team_id) ks.*, to_char(ks.snapshot_date, 'YYYY-MM-DD') AS snapshot_day
         FROM kpi_snapshots ks
        WHERE ks.team_id = ANY(?::text[]) AND ks.snapshot_date >= CURRENT_DATE - 14 AND ks.snapshot_date < CURRENT_DATE - 7
        ORDER BY ks.team_id, ks.snapshot_date DESC`,
      [teamIds]
    );
    const latestOf = new Map(latestRows.map((r: any) => [String(r.team_id), r]));
    const prevOf = new Map(prevRows.map((r: any) => [String(r.team_id), r]));
    const inputs: SummaryTeamInput[] = teams.map((t) => {
      const ref = { id: t.id, department_id: t.department_id };
      const row = latestOf.get(t.id);
      const ev = row ? evaluateLatestSnapshot(row, ref, ctx, now) : null;
      const values = (r: any, e: { values: Record<string, { stale: boolean }> } | null, col: string) =>
        r && e && !e.values[col]?.stale ? toNum(r[col]) : null;
      const track = teamKpiTrack({
        testCoverage: row ? toNum(row.test_coverage) : null,
        testFlakinessRate: row ? toNum(row.test_flakiness_rate) : null,
        defectEscapeRate: row ? toNum(row.defect_escape_rate) : null,
        automationCoverage: row ? toNum(row.automation_coverage) : null,
      }, ev?.judge);
      const prev = prevOf.get(t.id);
      const pev = prev ? evaluateSnapshot(prev, ref, ctx, referenceFor(prev.snapshot_day, now)) : null;
      const colOf: Record<string, string> = { testCoverage: 'test_coverage', automationCoverage: 'automation_coverage', testFlakinessRate: 'test_flakiness_rate', defectEscapeRate: 'defect_escape_rate' };
      const prevValues: SummaryTeamInput['prevValues'] = {};
      for (const key of Object.values(KPI_TARGET_KEYS)) prevValues[key] = values(prev, pev, colOf[key]);
      return {
        teamId: t.id, teamName: t.name, departmentName: t.department_name ?? null,
        qaScore: ev?.qa.value ?? null, prevQaScore: pev?.qa.value ?? null,
        checks: track.checks, prevValues, snapshotDate: row?.snapshot_day ?? null,
      };
    });

    // 3. Alerts the caller may see (team alerts of the scope; company-level ones for super admins).
    const alertRows = await query<any[]>(
      `SELECT a.id, a.team_id, a.severity, a.acknowledged_at, a.resolved_at, a.created_at, t.department_id
         FROM alerts a LEFT JOIN teams t ON t.id = a.team_id
        WHERE a.company_id = ? AND (a.resolved_at IS NULL OR a.resolved_at >= NOW() - INTERVAL '7 days' OR a.created_at >= NOW() - INTERVAL '7 days')`,
      [companyId]
    );
    // The same rule and counts as the Alerts page (GET /api/alerts).
    const visibleAlerts = alertRows.filter((a: any) => canSeeAlert(actor, a));
    const weekAgo = now - 7 * DAY_MS;
    const alerts = { open: 0, acknowledged: 0, critical: 0, warning: 0, info: 0, openedThisWeek: 0, resolvedThisWeek: 0 };
    for (const a of visibleAlerts) {
      if (!a.resolved_at) {
        if (a.acknowledged_at) alerts.acknowledged++; else alerts.open++;
        alerts[a.severity as 'critical' | 'warning' | 'info']++;
      }
      if (Date.parse(a.created_at) >= weekAgo) alerts.openedThisWeek++;
      if (a.resolved_at && Date.parse(a.resolved_at) >= weekAgo) alerts.resolvedThisWeek++;
    }

    // 4. Tracked actions completed / started in the last 7 days.
    const actionRow = await queryOne<any>(
      `SELECT COUNT(*) FILTER (WHERE status = 'done' AND completed_at >= NOW() - INTERVAL '7 days') AS done,
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS created,
              COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND due_date < CURRENT_DATE) AS overdue
         FROM team_actions WHERE company_id = ? AND team_id = ANY(?::text[])`,
      [companyId, teamIds]
    );

    // 5. Money at risk: the Business impact roll-up over the scope (super admins and managers).
    let money: any = null;
    if (canViewRevenueRollup(actor)) {
      const figures = await Promise.all(teams.map(async (t) => teamFigures(await computeTeamRevenueImpact(companyId, t, ctx.book, now), t)));
      const roll = rollUpRevenue(figures);
      money = {
        available: true,
        stake: { monthly: roll.stake.monthly, monthlyLow: roll.stake.monthlyLow, monthlyHigh: roll.stake.monthlyHigh, annual: roll.stake.annual, annualLow: roll.stake.annualLow, annualHigh: roll.stake.annualHigh },
        debt: { monthly: roll.debt.monthly, annual: roll.debt.annual },
        teamsContributing: roll.stake.contributing.length,
        teamsLacking: roll.stake.lacking.length,
        teams: roll.teams,
        sampleData: figures.some((f) => f.sampleData),
        caveats: REVENUE_CAVEATS,
        assumptionsPath: '/analytics/business-impact?tab=all-teams',
      };
    } else {
      money = { available: false, reason: 'Money at risk adds up the Business impact figures of several teams; it is shown to super admins and managers. Open Business impact for your team’s figures.', assumptionsPath: '/analytics/business-impact' };
    }

    const risks = rankRisks(inputs);
    const improved = rankImproved(inputs);
    const qaScore = metrics.globalQaScore;
    res.json({
      scope,
      empty: false,
      generatedAt,
      quality: {
        score: qaScore,
        status: qaStatusFromScore(qaScore),
        thresholds: { good: QA_SCORE_THRESHOLDS.good, warning: QA_SCORE_THRESHOLDS.warning },
        weekChange: metrics.globalQaScoreTrend,
        confidence: metrics.globalQaScoreConfidence,
        teamsWithData: metrics.teamsWithKpiData,
        teamCount: metrics.teamCount,
        kpiStatus: metrics.kpiStatus,
        asOf: metrics.asOf,
        lastUpdated: metrics.lastUpdated,
        dataOutdated: metrics.dataOutdated,
        sampleData: metrics.sampleData,
      },
      risks,
      improved,
      money,
      alerts,
      sinceLastWeek: {
        qaScoreChange: metrics.globalQaScoreTrend,
        movement: movement(inputs),
        statusChanges: statusChanges(inputs),
        alertsOpened: alerts.openedThisWeek,
        alertsResolved: alerts.resolvedThisWeek,
        actionsDone: Number(actionRow?.done) || 0,
        actionsCreated: Number(actionRow?.created) || 0,
        actionsOverdue: Number(actionRow?.overdue) || 0,
      },
      teams: inputs
        .map((t) => ({ teamId: t.teamId, teamName: t.teamName, departmentName: t.departmentName, qaScore: t.qaScore === null ? null : Math.round(t.qaScore * 10) / 10, status: qaStatusFromScore(t.qaScore), weekChange: weekChange(t.qaScore, t.prevQaScore), snapshotDate: t.snapshotDate }))
        .sort((a, b) => (a.qaScore ?? 101) - (b.qaScore ?? 101) || a.teamName.localeCompare(b.teamName)),
      text: SUMMARY_TEXT,
    });
  } catch (error) {
    console.error('Executive summary error:', error);
    res.status(500).json({ error: 'Failed to load the summary' });
  }
});

export default router;
