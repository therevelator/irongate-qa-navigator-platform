import express from 'express';
import { queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { assertTeamAnalytics, getOwnedTeam, policyActor } from '../middleware/access';
import {
  ACTION_METRICS, ACTION_ORIGINS, ActionError, actionJson, cleanDescription, cleanDueDate, cleanMetric, cleanStatus, cleanTitle,
  createAction, deleteAction, getActionRow, listTeamActions, lowerIsBetterOf, OUTCOME_RULE_TEXT, updateAction, type ActionPatch,
} from '../lib/actions';
import { metricLabel, metricUnit } from '../lib/alerts';
import { canManageActions, canOwnAction, canSeeActions, canUpdateActionStatus, loadActor, loadCompanyActors } from '../lib/alertPolicy';
import { notifyActionOwner } from '../lib/notifications';

/**
 * Tracked actions (server/lib/actions.ts). Authenticated, company-scoped.
 *
 * GET    /api/actions?teamId=           the team's actions (analytics scope), with computed outcomes
 * GET    /api/actions/owners?teamId=    people who can own an action on the team (writers only)
 * POST   /api/actions                   { teamId, title, description?, ownerId?, dueDate?, metricKey?, origin?, alertId? }
 * PATCH  /api/actions/:id               writers: any field; the owner: status only
 * DELETE /api/actions/:id               writers
 * Writers = team data writers (super_admin, the department's QA managers, the team's leads).
 * The owner must have the team in their analytics scope. Baselines and outcomes are computed
 * from the stored metric values, never accepted from the client. Changes are audited.
 */
const router = express.Router();

const metricOptions = () => ACTION_METRICS.map((m) => ({ key: m, label: metricLabel(m), unit: metricUnit(m), lowerIsBetter: lowerIsBetterOf(m) }));

function fail(res: express.Response, e: unknown, fallback: string) {
  if (e instanceof ActionError) return res.status(e.status).json({ error: e.message });
  console.error(`${fallback}:`, e);
  return res.status(500).json({ error: fallback });
}

async function checkOwner(companyId: string, ownerId: unknown, team: { id: string; department_id: string | null }): Promise<string | null> {
  if (ownerId === undefined || ownerId === null || ownerId === '') return null;
  if (typeof ownerId !== 'string') throw new ActionError(400, 'ownerId must be a user id');
  const owner = await loadActor(companyId, ownerId);
  if (!owner || !canOwnAction(owner, team)) throw new ActionError(400, 'The owner must be an active user who has this team in their scope');
  return owner.id;
}

router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await assertTeamAnalytics(req, res, typeof req.query.teamId === 'string' ? req.query.teamId : null);
    if (!team) return;
    const actor = policyActor(req);
    const actions = await listTeamActions(req.companyId as string, team.id);
    res.json({
      teamId: team.id,
      canManage: canManageActions(actor, team),
      actions: actions.map((a) => ({ ...a, canUpdateStatus: canUpdateActionStatus(actor, team, { owner_id: a.owner?.id ?? null }), canEdit: canManageActions(actor, team) })),
      metrics: metricOptions(),
      outcomeRule: OUTCOME_RULE_TEXT,
    });
  } catch (e) {
    fail(res, e, 'Failed to load the actions');
  }
});

router.get('/owners', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await getOwnedTeam(req, typeof req.query.teamId === 'string' ? req.query.teamId : null);
    if (!team || !canSeeActions(policyActor(req), team)) return res.status(403).json({ error: 'Access denied. This team is outside your analytics scope.' });
    if (!canManageActions(policyActor(req), team)) return res.status(403).json({ error: 'Only the team’s leads, its department’s QA managers and administrators can assign actions' });
    const owners = (await loadCompanyActors(req.companyId as string)).filter((a) => canOwnAction(a, team))
      .map((a) => ({ id: a.id, name: a.name, email: a.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ owners });
  } catch (e) {
    fail(res, e, 'Failed to load the possible owners');
  }
});

router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const body = req.body ?? {};
    const team = await getOwnedTeam(req, typeof body.teamId === 'string' ? body.teamId : null);
    const actor = policyActor(req);
    if (!team || !canSeeActions(actor, team)) return res.status(403).json({ error: 'Access denied. This team is outside your analytics scope.' });
    if (!canManageActions(actor, team)) return res.status(403).json({ error: 'Only the team’s leads, its department’s QA managers and administrators can create actions' });
    const companyId = req.companyId as string;
    const origin = body.origin === undefined || body.origin === null || body.origin === '' ? 'manual' : body.origin;
    if (!(ACTION_ORIGINS as string[]).includes(origin)) return res.status(400).json({ error: `origin must be one of ${ACTION_ORIGINS.join(', ')}` });
    let alertId: string | null = null;
    if (body.alertId) {
      const a = await queryOne<any>('SELECT id FROM alerts WHERE id = ? AND company_id = ? AND team_id = ?', [body.alertId, companyId, team.id]);
      if (!a) return res.status(400).json({ error: 'The alert does not belong to this team' });
      alertId = a.id;
    }
    const input = {
      title: cleanTitle(body.title),
      description: cleanDescription(body.description),
      ownerId: await checkOwner(companyId, body.ownerId, team),
      dueDate: cleanDueDate(body.dueDate),
      metricKey: cleanMetric(body.metricKey),
      origin,
      alertId,
    };
    const id = await createAction({ companyId, actorId: actor.id, team }, input);
    const row = await getActionRow(companyId, id);
    await notifyActionOwner(companyId, row, team.name, actor.id).catch((e) => console.error('[actions] owner notification failed:', e?.message ?? e));
    res.status(201).json({ action: { ...actionJson(row), canUpdateStatus: true, canEdit: true } });
  } catch (e) {
    fail(res, e, 'Failed to create the action');
  }
});

router.patch('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const companyId = req.companyId as string;
    const actor = policyActor(req);
    const row = await getActionRow(companyId, req.params.id as string);
    const team = row ? await getOwnedTeam(req, row.team_id) : null;
    if (!row || !team || !canSeeActions(actor, team)) return res.status(404).json({ error: 'Action not found' });
    const body = req.body ?? {};
    const writer = canManageActions(actor, team);
    const fields = Object.keys(body).filter((k) => ['title', 'description', 'ownerId', 'dueDate', 'status', 'metricKey'].includes(k));
    if (!fields.length) return res.status(400).json({ error: 'Nothing to change' });
    if (!writer) {
      if (!canUpdateActionStatus(actor, team, row)) return res.status(403).json({ error: 'Only the team’s leads, its department’s QA managers, administrators and the action’s owner can change it' });
      if (fields.some((f) => f !== 'status')) return res.status(403).json({ error: 'As the owner you can change the status of this action' });
    }
    const patch: ActionPatch = {};
    if ('title' in body) patch.title = cleanTitle(body.title);
    if ('description' in body) patch.description = cleanDescription(body.description);
    if ('ownerId' in body) patch.ownerId = await checkOwner(companyId, body.ownerId, team);
    if ('dueDate' in body) patch.dueDate = cleanDueDate(body.dueDate);
    if ('status' in body) patch.status = cleanStatus(body.status);
    if ('metricKey' in body) patch.metricKey = cleanMetric(body.metricKey);
    const { changed } = await updateAction({ companyId, actorId: actor.id, team }, row.id, patch);
    const after = await getActionRow(companyId, row.id);
    if (changed.includes('owner_id')) await notifyActionOwner(companyId, after, team.name, actor.id).catch((e) => console.error('[actions] owner notification failed:', e?.message ?? e));
    res.json({ action: { ...actionJson(after), canUpdateStatus: canUpdateActionStatus(actor, team, after), canEdit: writer }, changed });
  } catch (e) {
    fail(res, e, 'Failed to update the action');
  }
});

router.delete('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const companyId = req.companyId as string;
    const actor = policyActor(req);
    const row = await getActionRow(companyId, req.params.id as string);
    const team = row ? await getOwnedTeam(req, row.team_id) : null;
    if (!row || !team || !canSeeActions(actor, team)) return res.status(404).json({ error: 'Action not found' });
    if (!canManageActions(actor, team)) return res.status(403).json({ error: 'Only the team’s leads, its department’s QA managers and administrators can delete actions' });
    await deleteAction({ companyId, actorId: actor.id, team }, row.id);
    res.json({ ok: true });
  } catch (e) {
    fail(res, e, 'Failed to delete the action');
  }
});

export default router;
