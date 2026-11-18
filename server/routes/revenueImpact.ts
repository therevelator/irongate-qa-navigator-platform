import express from 'express';
import { query } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { assertTeamAnalytics, policyActor } from '../middleware/access';
import { analyticsTeamsInScope, canViewRevenueRollup } from '../lib/userPolicy';
import { loadTargetBook } from '../lib/targets';
import { computeTeamRevenueImpact, teamFigures, type TeamRef } from '../lib/revenueImpactData';
import {
  REVENUE_QUALITY_METRICS, REVENUE_MIN_PAIRED_MONTHS, REVENUE_ALPHA, REVENUE_CONFIDENCE, MONTHS_PER_YEAR,
  REVENUE_SENSITIVITY_FORMULA, REVENUE_AT_STAKE_FORMULA, REVENUE_AT_RISK_DEBT_FORMULA, INCIDENT_COST_FORMULA,
  CHURN_REVENUE_FORMULA, WHAT_IF_FORMULA, SUPPORT_COST_FORMULA, DOWNTIME_GAP_FORMULA, CONFIDENCE_TEXT, REVENUE_ROLLUP_FORMULA, REVENUE_CAVEATS, rollUpRevenue, whatIf,
} from '../lib/revenueImpact';

/**
 * Revenue impact (server/lib/revenueImpact.ts; Delivery → Business impact → Revenue impact).
 *
 * GET /api/revenue-impact/teams/:teamId                          one team's analysis
 * GET /api/revenue-impact/teams/:teamId/what-if?metric=&change=  projected revenue change for a metric change
 * GET /api/revenue-impact/rollup[?departmentId=]                 sum of the team figures in scope
 *
 * Scope: a team must be in the caller's analytics scope (assertTeamAnalytics → canViewTeamAnalytics,
 * server/lib/userPolicy.ts); 403 otherwise, also for unknown ids and other companies' teams. The
 * roll-up is for super admins (company) and QA managers (their departments) (canViewRevenueRollup)
 * and sums only the teams of analyticsTeamsInScope. Team aggregates only, no individual data.
 */

const router = express.Router();

const METHOD = {
  minimumPairedMonths: REVENUE_MIN_PAIRED_MONTHS,
  alpha: REVENUE_ALPHA,
  confidence: REVENUE_CONFIDENCE,
  monthsPerYear: MONTHS_PER_YEAR,
  multipleComparison: 'none (exploratory)',
  formulas: {
    sensitivity: REVENUE_SENSITIVITY_FORMULA,
    revenueAtStake: REVENUE_AT_STAKE_FORMULA,
    debtAtRisk: REVENUE_AT_RISK_DEBT_FORMULA,
    incidents: INCIDENT_COST_FORMULA,
    churn: CHURN_REVENUE_FORMULA,
    whatIf: WHAT_IF_FORMULA,
    rollup: REVENUE_ROLLUP_FORMULA,
    support: SUPPORT_COST_FORMULA,
    downtimeGap: DOWNTIME_GAP_FORMULA,
  },
  confidenceTags: CONFIDENCE_TEXT,
  caveats: REVENUE_CAVEATS,
  metrics: REVENUE_QUALITY_METRICS,
};

async function teamRef(companyId: string, teamId: string): Promise<TeamRef | null> {
  const rows = await query<any>(
    `SELECT t.id, t.name, t.department_id, d.name AS department_name
       FROM teams t LEFT JOIN departments d ON d.id = t.department_id
      WHERE t.id = ? AND t.company_id = ?`,
    [teamId, companyId]
  );
  return rows[0] ? { id: String(rows[0].id), name: rows[0].name, department_id: rows[0].department_id ?? null, department_name: rows[0].department_name ?? null } : null;
}

router.get('/teams/:teamId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await assertTeamAnalytics(req, res, String(req.params.teamId));
    if (!team) return;
    const ref = await teamRef(req.companyId as string, team.id);
    const result = await computeTeamRevenueImpact(req.companyId as string, ref as TeamRef);
    res.json({ ...result, departmentName: ref?.department_name ?? null, method: METHOD, calculatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Revenue impact error:', error);
    res.status(500).json({ error: 'Failed to calculate the revenue impact' });
  }
});

router.get('/teams/:teamId/what-if', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await assertTeamAnalytics(req, res, String(req.params.teamId));
    if (!team) return;
    const metric = typeof req.query.metric === 'string' ? req.query.metric : '';
    if (!REVENUE_QUALITY_METRICS.some(m => m.key === metric)) {
      return res.status(400).json({ error: `metric must be one of ${REVENUE_QUALITY_METRICS.map(m => m.key).join(', ')}` });
    }
    const change = Number(req.query.change);
    if (req.query.change === undefined || req.query.change === '' || !Number.isFinite(change)) {
      return res.status(400).json({ error: 'change must be a number (the change in the metric, in its unit)' });
    }
    const ref = await teamRef(req.companyId as string, team.id);
    const result = await computeTeamRevenueImpact(req.companyId as string, ref as TeamRef);
    const s = result.sensitivities.find(x => x.metric === metric)!;
    res.json({ teamId: team.id, sensitivity: s, current: result.current[metric], ...whatIf(s, change, result.current[metric]), formula: WHAT_IF_FORMULA });
  } catch (error) {
    console.error('Revenue what-if error:', error);
    res.status(500).json({ error: 'Failed to calculate the projection' });
  }
});

router.get('/rollup', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    if (!canViewRevenueRollup(actor)) {
      return res.status(403).json({ error: 'The revenue roll-up is available to super admins and QA managers.' });
    }
    const departmentId = typeof req.query.departmentId === 'string' && req.query.departmentId && req.query.departmentId !== 'all' ? req.query.departmentId : null;
    const rows = await query<any>(
      `SELECT t.id, t.name, t.department_id, d.name AS department_name
         FROM teams t LEFT JOIN departments d ON d.id = t.department_id
        WHERE t.company_id = ? AND t.is_active = TRUE
        ORDER BY d.name NULLS LAST, t.name`,
      [req.companyId]
    );
    let teams = analyticsTeamsInScope<TeamRef>(actor, rows.map((r: any): TeamRef => ({
      id: String(r.id), name: r.name, department_id: r.department_id ? String(r.department_id) : null, department_name: r.department_name ?? null,
    })));
    if (departmentId) {
      teams = teams.filter(t => t.department_id === departmentId);
      if (!teams.length) return res.status(403).json({ error: 'Access denied. This department is outside your analytics scope.' });
    }
    const book = await loadTargetBook(req.companyId as string);
    const figures = [];
    for (const t of teams) figures.push(teamFigures(await computeTeamRevenueImpact(req.companyId as string, t, book), t));
    res.json({
      scope: departmentId ? 'department' : 'all-in-scope',
      departmentId,
      rollup: rollUpRevenue(figures),
      teams: figures,
      sampleData: figures.some(f => f.sampleData),
      method: METHOD,
      calculatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Revenue roll-up error:', error);
    res.status(500).json({ error: 'Failed to calculate the revenue roll-up' });
  }
});

export default router;
