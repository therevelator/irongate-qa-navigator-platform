import express from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { improveRefreshLimiter } from '../middleware/rateLimit';
import { assertTeamAnalytics, getOwnedTeam, policyActor } from '../middleware/access';
import { canManageActions, canOwnAction, canSeeActions, loadActor } from '../lib/alertPolicy';
import { ActionError, cleanDueDate, getActionRow } from '../lib/actions';
import { notifyActionOwner } from '../lib/notifications';
import { METHOD_TEXT, BAND_LEVEL, HORIZON_WEEKS } from '../lib/forecast/math';
import {
  acceptRecommendation, cleanDismissReason, dismissRecommendation, DISMISS_REASONS, getRecommendationRow, improveIsStale,
  listTeamRecommendations, loadTeamForecasts, RECOMMENDATION_RULE_TEXT, recommendationJson, refreshTeamImprove, reopenRecommendation,
} from '../lib/recommendations/store';

/**
 * Improve (v2 phase 4): forecasts and recommendations of a team. Authenticated, company-scoped.
 *
 * GET  /api/improve/teams/:id                     forecasts (per KPI and the QA score) and recommendations
 *                                                 (open by rank, accepted with their action and its before /
 *                                                 after, dismissed with the reason). Analytics scope (the same
 *                                                 rule as the team's KPI history). Recalculated first when due
 *                                                 (none yet, older than a day or older than the newest value).
 * POST /api/improve/teams/:id/refresh             recalculate now (writers: who may create actions)
 * POST /api/improve/recommendations/:id/accept    { ownerId?, dueDate?, title? } → a tracked action linked to the
 *                                                 recommendation and its metric (writers)
 * POST /api/improve/recommendations/:id/dismiss   { reason } (writers)
 * POST /api/improve/recommendations/:id/reopen    a dismissed one back to open (writers)
 * Writers = canManageActions: super admins, the department's QA managers, the team's leads.
 */
const router = express.Router();

function fail(res: express.Response, e: unknown, fallback: string) {
  if (e instanceof ActionError) return res.status(e.status).json({ error: e.message });
  console.error(`${fallback}:`, e);
  return res.status(500).json({ error: fallback });
}

const teamRow = (t: { id: string; company_id: string; department_id: string | null; name: string }) => ({ id: t.id, company_id: t.company_id, department_id: t.department_id, name: t.name });

async function payload(req: AuthRequest, team: { id: string; company_id: string; department_id: string | null; name: string }) {
  const actor = policyActor(req);
  const [forecasts, recommendations] = await Promise.all([loadTeamForecasts(team.id), listTeamRecommendations(team.id)]);
  const computedAt = forecasts.reduce<string | null>((m, f) => (!m || f.computedAt < m ? f.computedAt : m), null);
  return {
    teamId: team.id,
    canManage: canManageActions(actor, team),
    computedAt,
    forecasts,
    recommendations,
    dismissReasons: DISMISS_REASONS,
    text: {
      forecastMethod: METHOD_TEXT,
      forecastBand: `${BAND_LEVEL} % band`,
      horizonWeeks: HORIZON_WEEKS,
      recommendations: RECOMMENDATION_RULE_TEXT,
    },
  };
}

router.get('/teams/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await assertTeamAnalytics(req, res, req.params.id as string);
    if (!team) return;
    if (await improveIsStale(team.id)) await refreshTeamImprove(teamRow(team));
    res.json(await payload(req, team));
  } catch (e) {
    fail(res, e, 'Failed to load the forecasts and recommendations');
  }
});

router.post('/teams/:id/refresh', improveRefreshLimiter, authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await assertTeamAnalytics(req, res, req.params.id as string);
    if (!team) return;
    if (!canManageActions(policyActor(req), team)) return res.status(403).json({ error: 'Only the team’s leads, its department’s managers and administrators can recalculate' });
    const r = await refreshTeamImprove(teamRow(team));
    res.json({ ...(await payload(req, team)), refreshed: r });
  } catch (e) {
    fail(res, e, 'Failed to recalculate');
  }
});

/** The recommendation and its team, with the caller allowed to decide on it; else the HTTP error is sent. */
async function decisionTarget(req: AuthRequest, res: express.Response) {
  const companyId = req.companyId as string;
  const actor = policyActor(req);
  const rec = await getRecommendationRow(companyId, req.params.id as string);
  const team = rec ? await getOwnedTeam(req, rec.team_id) : null;
  if (!rec || !team || !canSeeActions(actor, team)) { res.status(404).json({ error: 'Recommendation not found' }); return null; }
  if (!canManageActions(actor, team)) { res.status(403).json({ error: 'Only the team’s leads, its department’s managers and administrators can act on recommendations' }); return null; }
  return { rec, team, actor, companyId };
}

router.post('/recommendations/:id/accept', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const t = await decisionTarget(req, res);
    if (!t) return;
    const body = req.body ?? {};
    let ownerId: string | null = null;
    if (body.ownerId !== undefined && body.ownerId !== null && body.ownerId !== '') {
      if (typeof body.ownerId !== 'string') throw new ActionError(400, 'ownerId must be a user id');
      const owner = await loadActor(t.companyId, body.ownerId);
      if (!owner || !canOwnAction(owner, t.team)) throw new ActionError(400, 'The owner must be an active user who has this team in their scope');
      ownerId = owner.id;
    }
    const dueDate = cleanDueDate(body.dueDate);
    const title = typeof body.title === 'string' ? body.title : null;
    const actionId = await acceptRecommendation({ companyId: t.companyId, actorId: t.actor.id, team: t.team }, t.rec, { ownerId, dueDate, title });
    const action = await getActionRow(t.companyId, actionId);
    if (ownerId) await notifyActionOwner(t.companyId, action, t.team.name, t.actor.id).catch((e) => console.error('[improve] owner notification failed:', e?.message ?? e));
    const rec = await getRecommendationRow(t.companyId, t.rec.id);
    res.status(201).json({ recommendation: recommendationJson(rec), actionId });
  } catch (e) {
    fail(res, e, 'Failed to add the recommendation to the Action plan');
  }
});

router.post('/recommendations/:id/dismiss', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const t = await decisionTarget(req, res);
    if (!t) return;
    const reason = cleanDismissReason(req.body?.reason);
    await dismissRecommendation({ companyId: t.companyId, actorId: t.actor.id, team: t.team }, t.rec, reason);
    res.json({ recommendation: recommendationJson(await getRecommendationRow(t.companyId, t.rec.id)) });
  } catch (e) {
    fail(res, e, 'Failed to dismiss the recommendation');
  }
});

router.post('/recommendations/:id/reopen', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const t = await decisionTarget(req, res);
    if (!t) return;
    await reopenRecommendation({ companyId: t.companyId, actorId: t.actor.id, team: t.team }, t.rec);
    res.json({ recommendation: recommendationJson(await getRecommendationRow(t.companyId, t.rec.id)) });
  } catch (e) {
    fail(res, e, 'Failed to reopen the recommendation');
  }
});

export default router;
