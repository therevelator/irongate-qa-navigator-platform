import express from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { policyActor } from '../middleware/access';
import { recordAudit } from '../lib/audit';
import { ROLE_LABELS } from '../lib/roleLabels';
import { canInvite, canManageRoles, CAPABILITIES, editableCapabilities, LEVEL_CAPABILITIES, ROLE_SCOPE, type Role } from '../lib/userPolicy';
import { archiveRole, cleanRole, createRole, CUSTOM_BASE_ROLES, getRole, listRoles, RoleError, ROLE_TEMPLATES, updateRole } from '../lib/customRoles';

/**
 * Roles (src/components/RolesView.tsx): the access levels with their recommended permissions, the recommended
 * role templates and the company's own roles. Authenticated, company-scoped.
 *
 * GET    /api/roles        levels, permissions, templates and custom roles (with how many people hold each).
 *                          For super admins and everyone who may invite (they choose a role in the invitation).
 * POST   /api/roles        { name, description?, baseRole, added?, removed?, templateKey? }   super admins
 * PUT    /api/roles/:id    { name, description?, added?, removed? } (the base level of a role does not change)
 * DELETE /api/roles/:id    archive: its people stay on the base level
 * Every change is recorded in the change history. A change of permissions applies to everyone holding the role
 * on their next request.
 */
const router = express.Router();

const fail = (res: express.Response, e: unknown, what: string) => {
  if (e instanceof RoleError) return res.status(e.status).json({ error: e.message });
  console.error(`${what}:`, e);
  return res.status(500).json({ error: what });
};

router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    if (!canManageRoles(actor) && !canInvite(actor)) return res.status(403).json({ error: 'Only people who invite or manage others can see the roles' });
    res.json({
      canManage: canManageRoles(actor),
      capabilities: CAPABILITIES,
      levels: ['super_admin', ...CUSTOM_BASE_ROLES].map((k) => ({
        key: k, label: ROLE_LABELS[k] ?? k, scope: ROLE_SCOPE[k as Role], capabilities: LEVEL_CAPABILITIES[k] ?? [],
        editable: k === 'super_admin' ? [] : editableCapabilities(k), custom: k !== 'super_admin',
      })),
      templates: ROLE_TEMPLATES,
      roles: await listRoles(req.companyId as string),
    });
  } catch (e) { fail(res, e, 'Failed to load the roles'); }
});

router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    if (!canManageRoles(actor)) return res.status(403).json({ error: 'Only super admins can create roles' });
    const input = cleanRole(req.body);
    const role = await createRole(req.companyId as string, actor.id ?? null, input);
    await recordAudit({ companyId: req.companyId as string, actorId: actor.id ?? null, action: 'role.create', entityType: 'config', entityId: role.id,
      summary: `Created the role “${role.name}” (based on ${ROLE_LABELS[role.baseRole] ?? role.baseRole})`, after: role });
    res.status(201).json({ role });
  } catch (e) { fail(res, e, 'Failed to create the role'); }
});

router.put('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    if (!canManageRoles(actor)) return res.status(403).json({ error: 'Only super admins can change roles' });
    const before = await getRole(req.companyId as string, req.params.id);
    if (!before) return res.status(404).json({ error: 'Role not found' });
    const role = await updateRole(req.companyId as string, before.id, cleanRole(req.body, before.baseRole));
    await recordAudit({ companyId: req.companyId as string, actorId: actor.id ?? null, action: 'role.update', entityType: 'config', entityId: role.id,
      summary: `Changed the role “${role.name}”${role.people ? ` (held by ${role.people} ${role.people === 1 ? 'person' : 'people'})` : ''}`, before, after: role });
    res.json({ role });
  } catch (e) { fail(res, e, 'Failed to change the role'); }
});

router.delete('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    if (!canManageRoles(actor)) return res.status(403).json({ error: 'Only super admins can archive roles' });
    const before = await getRole(req.companyId as string, req.params.id);
    if (!before) return res.status(404).json({ error: 'Role not found' });
    await archiveRole(req.companyId as string, before.id);
    await recordAudit({ companyId: req.companyId as string, actorId: actor.id ?? null, action: 'role.archive', entityType: 'config', entityId: before.id,
      summary: `Archived the role “${before.name}”; its ${before.people} ${before.people === 1 ? 'person stays' : 'people stay'} on ${ROLE_LABELS[before.baseRole] ?? before.baseRole}`, before });
    res.json({ archived: true, people: before.people });
  } catch (e) { fail(res, e, 'Failed to archive the role'); }
});

export default router;
