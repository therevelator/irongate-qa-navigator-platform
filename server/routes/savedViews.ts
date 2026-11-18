import express from 'express';
import { query, queryOne, transaction } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { getOwnedTeam, policyActor } from '../middleware/access';
import {
  canCompareTeams, canDeleteSavedView, canEditSavedView, canSeeSavedView, canShareSavedView, canUnshareSavedView,
  type PolicyActor,
} from '../lib/userPolicy';
import { recordAudit } from '../lib/audit';
import { execOn } from '../lib/assignments';
import {
  MAX_VIEWS_PER_KIND, SavedViewError, validateKind, validateModule, validateName, validateState, type SavedViewKind,
} from '../lib/savedViews';

/**
 * Saved views (server/lib/savedViews.ts, src/components/SavedViewsMenu.tsx).
 *
 * GET    /api/saved-views?kind=dashboard|analytics|compare[&module=]  your views + views shared with the company
 * POST   /api/saved-views              { name, kind, module?, state }   create (yours)
 * PUT    /api/saved-views/:id          { name?, state? }                rename / overwrite (owner only)
 * POST   /api/saved-views/:id/share    { shared: boolean }              share with the company (super_admin, own
 *                                                                        views) / stop sharing (super_admin)
 * DELETE /api/saved-views/:id                                           owner, or super_admin for a shared view
 *
 * Every view is scoped to the caller's company. Team ids in a view must be in the caller's
 * analytics scope when it is saved. Sharing, unsharing and deleting a shared view are recorded
 * in the change history (server/lib/audit.ts).
 */

const router = express.Router();

interface ViewRow {
  id: string;
  company_id: string;
  owner_id: string;
  kind: SavedViewKind;
  module: string | null;
  name: string;
  state: Record<string, unknown>;
  shared: boolean;
  shared_at: string | null;
  created_at: string;
  updated_at: string;
  owner_first: string | null;
  owner_last: string | null;
}

const SELECT = `SELECT v.id, v.company_id, v.owner_id, v.kind, v.module, v.name, v.state, v.shared, v.shared_at, v.created_at, v.updated_at,
                       u.first_name AS owner_first, u.last_name AS owner_last
                  FROM saved_views v JOIN users u ON u.id = v.owner_id`;

function toJson(actor: PolicyActor, r: ViewRow) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    module: r.module,
    state: r.state,
    shared: r.shared,
    sharedAt: r.shared_at,
    owner: { id: r.owner_id, name: [r.owner_first, r.owner_last].filter(Boolean).join(' ') || 'Unknown' },
    isOwner: r.owner_id === actor.id,
    canEdit: canEditSavedView(actor, r),
    canDelete: canDeleteSavedView(actor, r),
    canShare: !r.shared && canShareSavedView(actor, r),
    canUnshare: canUnshareSavedView(actor, r),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** A view of the caller's company that the caller may see, else null (same 404 either way). */
async function loadVisible(req: AuthRequest, viewId: string): Promise<ViewRow | null> {
  const r = await queryOne<ViewRow>(`${SELECT} WHERE v.id = ? AND v.company_id = ?`, [viewId, req.companyId]);
  return r && canSeeSavedView(policyActor(req), r) ? r : null;
}

/** Every team id of the state must be a team of the company in the caller's analytics scope. */
async function assertTeamsInScope(req: AuthRequest, teamIds: string[]) {
  if (!teamIds.length) return;
  const teams = [];
  for (const id of teamIds) {
    const t = await getOwnedTeam(req, id);
    if (!t) throw new SavedViewError(403, 'The view refers to a team outside your analytics scope');
    teams.push(t);
  }
  if (!canCompareTeams(policyActor(req), teams)) throw new SavedViewError(403, 'The view refers to a team outside your analytics scope');
}

function fail(res: express.Response, error: unknown, what: string) {
  if (error instanceof SavedViewError) return res.status(error.status).json({ error: error.message });
  if ((error as any)?.code === '23505') return res.status(409).json({ error: 'You already have a view with this name' });
  console.error(`Saved views ${what} error:`, error);
  return res.status(500).json({ error: `Failed to ${what} the view` });
}

router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const kind = validateKind(req.query.kind);
    const params: unknown[] = [req.companyId, kind, req.user!.id];
    let moduleSql = '';
    if (kind === 'analytics' && typeof req.query.module === 'string' && req.query.module) {
      moduleSql = ' AND v.module = ?';
      params.push(validateModule(kind, req.query.module));
    }
    const rows = await query<ViewRow[]>(
      `${SELECT} WHERE v.company_id = ? AND v.kind = ? AND (v.owner_id = ? OR v.shared)${moduleSql}
        ORDER BY (v.owner_id = ?) DESC, lower(v.name)`,
      [...params, req.user!.id]
    );
    const actor = policyActor(req);
    res.json({ views: rows.filter((r) => canSeeSavedView(actor, r)).map((r) => toJson(actor, r)) });
  } catch (error) {
    fail(res, error, 'list');
  }
});

router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const kind = validateKind(req.body?.kind);
    const name = validateName(req.body?.name);
    const module = validateModule(kind, req.body?.module);
    const { state, teamIds } = validateState(kind, req.body?.state);
    await assertTeamsInScope(req, teamIds);
    const count = await queryOne<{ n: string }>(`SELECT COUNT(*) AS n FROM saved_views WHERE owner_id = ? AND kind = ?`, [req.user!.id, kind]);
    if (Number(count?.n) >= MAX_VIEWS_PER_KIND) throw new SavedViewError(400, `You can keep at most ${MAX_VIEWS_PER_KIND} views of this kind`);
    const row = await queryOne<{ id: string }>(
      `INSERT INTO saved_views (company_id, owner_id, kind, module, name, state) VALUES (?, ?, ?, ?, ?, ?::jsonb) RETURNING id`,
      [req.companyId, req.user!.id, kind, module, name, JSON.stringify(state)]
    );
    const created = await loadVisible(req, row!.id);
    res.status(201).json({ view: toJson(policyActor(req), created!) });
  } catch (error) {
    fail(res, error, 'save');
  }
});

router.put('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const view = await loadVisible(req, String(req.params.id));
    if (!view) return res.status(404).json({ error: 'View not found' });
    if (!canEditSavedView(policyActor(req), view)) return res.status(403).json({ error: 'Only the owner can change this view' });
    const name = req.body?.name === undefined ? view.name : validateName(req.body.name);
    let state = view.state;
    if (req.body?.state !== undefined) {
      const v = validateState(view.kind, req.body.state);
      await assertTeamsInScope(req, v.teamIds);
      state = v.state;
    }
    await query(`UPDATE saved_views SET name = ?, state = ?::jsonb, updated_at = now() WHERE id = ?`, [name, JSON.stringify(state), view.id]);
    res.json({ view: toJson(policyActor(req), (await loadVisible(req, view.id))!) });
  } catch (error) {
    fail(res, error, 'update');
  }
});

router.post('/:id/share', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const view = await loadVisible(req, String(req.params.id));
    if (!view) return res.status(404).json({ error: 'View not found' });
    if (typeof req.body?.shared !== 'boolean') return res.status(400).json({ error: 'shared must be true or false' });
    const actor = policyActor(req);
    const shared = req.body.shared as boolean;
    if (shared === view.shared) return res.json({ view: toJson(actor, view) });
    const allowed = shared ? canShareSavedView(actor, view) : canUnshareSavedView(actor, view);
    if (!allowed) return res.status(403).json({ error: shared ? 'Only an administrator can share their views with the company' : 'Only an administrator can stop sharing a view' });
    await transaction(async (client) => {
      const exec = execOn(client);
      await exec(
        `UPDATE saved_views SET shared = ?, shared_by = ?, shared_at = ?, updated_at = now() WHERE id = ?`,
        [shared, shared ? actor.id : null, shared ? new Date().toISOString() : null, view.id]
      );
      await recordAudit({
        companyId: req.companyId as string, actorId: actor.id, action: shared ? 'saved_view.share' : 'saved_view.unshare',
        entityType: 'saved_view', entityId: view.id,
        summary: `${shared ? 'Shared' : 'Stopped sharing'} the ${view.kind} view "${view.name}" with the company`,
        before: { shared: view.shared }, after: { shared }, subjectIds: [view.id, view.owner_id],
      }, exec);
    });
    res.json({ view: toJson(actor, (await loadVisible(req, view.id))!) });
  } catch (error) {
    fail(res, error, 'share');
  }
});

router.delete('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const view = await loadVisible(req, String(req.params.id));
    if (!view) return res.status(404).json({ error: 'View not found' });
    const actor = policyActor(req);
    if (!canDeleteSavedView(actor, view)) return res.status(403).json({ error: 'Only the owner can delete this view' });
    await transaction(async (client) => {
      const exec = execOn(client);
      await exec(`DELETE FROM saved_views WHERE id = ?`, [view.id]);
      if (view.shared) {
        await recordAudit({
          companyId: req.companyId as string, actorId: actor.id, action: 'saved_view.delete', entityType: 'saved_view', entityId: view.id,
          summary: `Deleted the shared ${view.kind} view "${view.name}"`,
          before: { name: view.name, kind: view.kind, module: view.module, state: view.state, ownerId: view.owner_id, shared: true },
          subjectIds: [view.id, view.owner_id],
        }, exec);
      }
    });
    res.json({ ok: true });
  } catch (error) {
    fail(res, error, 'delete');
  }
});

export default router;
