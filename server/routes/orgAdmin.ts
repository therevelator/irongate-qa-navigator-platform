import express from 'express';
import { query, queryOne, transaction } from '../../src/lib/db';
import { authenticateToken } from '../middleware/auth';
import { policyActor } from '../middleware/access';
import {
  canGrant, canInvite, canViewActivity, canViewAuditEntry, isCompanyAdmin, managedDepartmentIds, ledTeamIds, highestRole,
  ROLE_RANK, type Grant, type PolicyActor,
} from '../lib/userPolicy';
import {
  execOn, resolveGrant, grantAssignment, revokeGrant, syncUserDisplay, lastSuperAdminGuard, listAssignments,
  AssignmentError, type ScopeInfo,
} from '../lib/assignments';
import { auditedUserChange, recordAudit, undoEntry, canUndoEntry, isReversible, REVERSIBLE_ACTIONS, UndoError, type AuditEntry } from '../lib/audit';
import { newToken, sendInvitationEmail, statusSql, INVITE_TTL_HOURS, EMAIL_RE, ROLE_NAMES, reissueInvitation } from '../lib/invitations';

/**
 * Organisation administration (mounted inside /api/admin):
 *
 *   GET    /users/:id/assignments                    a user's active role assignments
 *   POST   /users/:id/assignments  { role, scopeId, replaceLead? }   add an assignment
 *   DELETE /users/:id/assignments/:assignmentId      remove an assignment
 *   GET    /audit           ?entityType&action&actorId&departmentId&from&to&q&limit&before   change history
 *   GET    /audit/facets    actions and actors for the filters
 *   POST   /audit/:id/undo  undo a reversible change
 *   GET    /invitations     ?status=open|expired|accepted|revoked|all
 *   POST   /invitations     { email, role, scopeId }
 *   POST   /invitations/:id/resend
 *   POST   /invitations/:id/revoke
 *
 * Every rule is in server/lib/userPolicy.ts (canGrant, canInvite, canViewActivity, ...);
 * assignments are written only through server/lib/assignments.ts and every change is recorded
 * in the change history (server/lib/audit.ts).
 */
const router = express.Router();

const fullName = (u: { first_name?: string | null; last_name?: string | null; email?: string }) =>
  `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email || 'user';

const errorOut = (res: any, e: any, fallback: string) => {
  if (e instanceof AssignmentError || e instanceof UndoError) return res.status(e.status).json({ error: e.message, ...(e instanceof UndoError ? e.detail ?? {} : {}) });
  console.error(fallback, e);
  return res.status(500).json({ error: fallback });
};

/** May the actor change this user's assignments at all (company, not self, lower rank unless super admin)? */
async function loadAssignable(req: any, res: any): Promise<any | null> {
  const actor = policyActor(req);
  const target = await queryOne<any>(
    'SELECT id, first_name, last_name, email, role, is_active FROM users WHERE id = ? AND company_id = ?',
    [req.params.id, req.user.companyId]
  );
  if (!target) { res.status(404).json({ error: 'User not found' }); return null; }
  if (target.id === actor.id) { res.status(403).json({ error: 'You cannot change your own assignments' }); return null; }
  if (!isCompanyAdmin(actor) && (ROLE_RANK[target.role] ?? 0) >= (ROLE_RANK[highestRole(actor)] ?? 0)) {
    res.status(403).json({ error: 'You cannot change the assignments of someone with your role or a higher one' });
    return null;
  }
  return target;
}

const scopeLabel = (g: Grant, scope: ScopeInfo) => `${ROLE_NAMES[g.role] ?? g.role} of ${scope.name}`;

/* ------------------------------------------------------------------------------------------
 * Role assignments
 * ---------------------------------------------------------------------------------------- */

router.get('/users/:id/assignments', authenticateToken, async (req: any, res) => {
  try {
    const actor = policyActor(req);
    const target = await queryOne<any>('SELECT id FROM users WHERE id = ? AND company_id = ?', [req.params.id, req.user.companyId]);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const rows = await listAssignments(req.user.companyId, [target.id]);
    // Visible: yourself, super admin, or assignments in departments / teams the actor manages or leads.
    const mine = managedDepartmentIds(actor);
    const led = ledTeamIds(actor);
    const visible = target.id === actor.id || isCompanyAdmin(actor)
      ? rows
      : rows.filter((r) => (r.department_id && mine.includes(r.department_id)) || (r.scope_type === 'team' && led.includes(r.scope_id)));
    if (target.id !== actor.id && !isCompanyAdmin(actor) && !visible.length) return res.status(403).json({ error: 'This user is outside your scope' });
    res.json({ assignments: visible });
  } catch (e) {
    errorOut(res, e, 'Failed to load assignments');
  }
});

router.post('/users/:id/assignments', authenticateToken, async (req: any, res) => {
  try {
    const actor = policyActor(req);
    const companyId = req.user.companyId;
    const target = await loadAssignable(req, res);
    if (!target) return;
    if (!target.is_active) return res.status(400).json({ error: 'That user is inactive. Reactivate them first.' });
    const { grant, scope } = await resolveGrant(companyId, req.body ?? {});
    if (!canGrant(actor, grant, scope.team)) return res.status(403).json({ error: 'You cannot give this assignment' });
    const replaceLead = req.body?.replaceLead === true;
    const prevLead = grant.role === 'team_lead'
      ? await queryOne<any>(
        `SELECT user_id FROM role_assignments WHERE scope_type = 'team' AND scope_id = ? AND role = 'team_lead' AND revoked_at IS NULL AND user_id <> ?`,
        [grant.scopeId, target.id])
      : null;
    const userIds = [target.id, ...(prevLead && replaceLead ? [prevLead.user_id] : [])];
    const { result } = await auditedUserChange(
      { companyId, actorId: actor.id, action: 'assignment.grant', userIds, extraSubjects: [grant.scopeId] },
      async (exec) => {
        const r = await grantAssignment(exec, { companyId, userId: target.id, grant, actorId: actor.id, replaceLead });
        await syncUserDisplay(exec, target.id);
        if (r.previousLeadId) await syncUserDisplay(exec, r.previousLeadId);
        const replaced = r.replaced ? ` (was ${ROLE_NAMES[r.replaced.role] ?? r.replaced.role})` : '';
        return { summary: `${fullName(target)}: added ${scopeLabel(grant, scope)}${replaced}`, result: r };
      },
    );
    if (!result.changed) return res.status(200).json({ unchanged: true, assignments: await listAssignments(companyId, [target.id]) });
    res.status(201).json({ assignments: await listAssignments(companyId, [target.id]) });
  } catch (e) {
    errorOut(res, e, 'Failed to add the assignment');
  }
});

router.delete('/users/:id/assignments/:assignmentId', authenticateToken, async (req: any, res) => {
  try {
    const actor = policyActor(req);
    const companyId = req.user.companyId;
    const target = await loadAssignable(req, res);
    if (!target) return;
    const row = await queryOne<any>(
      `SELECT ra.id, ra.role, ra.scope_type, ra.scope_id FROM role_assignments ra
        WHERE ra.id = ? AND ra.user_id = ? AND ra.company_id = ? AND ra.revoked_at IS NULL`,
      [req.params.assignmentId, target.id, companyId]
    );
    if (!row) return res.status(404).json({ error: 'Assignment not found' });
    const grant: Grant = { role: row.role, scopeType: row.scope_type, scopeId: row.scope_id };
    const team = grant.scopeType === 'team'
      ? await queryOne<any>('SELECT id, name, department_id FROM teams WHERE id = ? AND company_id = ?', [grant.scopeId, companyId])
      : null;
    if (!canGrant(actor, grant, team)) return res.status(403).json({ error: 'You cannot remove this assignment' });
    if (grant.role === 'super_admin') await lastSuperAdminGuard(companyId, target.id);
    const name = grant.scopeType === 'team' ? team?.name
      : grant.scopeType === 'department' ? (await queryOne<any>('SELECT name FROM departments WHERE id = ?', [grant.scopeId]))?.name
      : 'the company';
    await auditedUserChange(
      { companyId, actorId: actor.id, action: 'assignment.revoke', userIds: [target.id], extraSubjects: [grant.scopeId] },
      async (exec) => {
        await revokeGrant(exec, { userId: target.id, grant, actorId: actor.id });
        await syncUserDisplay(exec, target.id);
        return { summary: `${fullName(target)}: removed ${ROLE_NAMES[grant.role] ?? grant.role} of ${name ?? grant.scopeId}`, result: null };
      },
    );
    res.json({ assignments: await listAssignments(companyId, [target.id]) });
  } catch (e) {
    errorOut(res, e, 'Failed to remove the assignment');
  }
});

/* ------------------------------------------------------------------------------------------
 * Change history (Activity)
 * ---------------------------------------------------------------------------------------- */

const AUDIT_COLUMNS = `a.id, a.company_id, a.actor_id, a.action, a.entity_type, a.entity_id, a.summary, a.before, a.after,
  a.department_ids, a.subject_ids, a.created_at, a.undone_at, a.undone_by, a.undo_of,
  NULLIF(TRIM(COALESCE(au.first_name, '') || ' ' || COALESCE(au.last_name, '')), '') AS actor_name, au.email AS actor_email,
  NULLIF(TRIM(COALESCE(ub.first_name, '') || ' ' || COALESCE(ub.last_name, '')), '') AS undone_by_name`;

/** WHERE clause limiting entries to what the actor may see (super admin: all; manager: their departments). */
function scopeWhere(actor: PolicyActor, params: any[]): string {
  if (isCompanyAdmin(actor)) return '';
  params.push(managedDepartmentIds(actor));
  return ' AND a.department_ids && ?::varchar[]';
}

router.get('/audit', authenticateToken, async (req: any, res) => {
  try {
    const actor = policyActor(req);
    if (!canViewActivity(actor)) return res.status(403).json({ error: 'The change history is available to super admins and managers' });
    const q = req.query ?? {};
    const params: any[] = [req.user.companyId];
    let where = 'a.company_id = ?' + scopeWhere(actor, params);
    if (typeof q.entityType === 'string' && q.entityType) { where += ' AND a.entity_type = ?'; params.push(q.entityType); }
    if (typeof q.action === 'string' && q.action) { where += ' AND a.action = ?'; params.push(q.action); }
    if (typeof q.actorId === 'string' && q.actorId) { where += ' AND a.actor_id = ?'; params.push(q.actorId); }
    if (typeof q.departmentId === 'string' && q.departmentId) { where += ' AND ? = ANY(a.department_ids)'; params.push(q.departmentId); }
    if (typeof q.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) { where += ' AND a.created_at >= ?::date'; params.push(q.from); }
    if (typeof q.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) { where += " AND a.created_at < ?::date + interval '1 day'"; params.push(q.to); }
    if (typeof q.q === 'string' && q.q.trim()) { where += ' AND a.summary ILIKE ?'; params.push(`%${q.q.trim().replace(/[\\%_]/g, (m: string) => `\\${m}`)}%`); }
    if (q.reversible === 'true') { where += ' AND a.action = ANY(?::text[]) AND a.undone_at IS NULL'; params.push(Object.keys(REVERSIBLE_ACTIONS)); }
    if (typeof q.before === 'string' && q.before) { where += ' AND a.created_at < (SELECT created_at FROM audit_log WHERE id = ?)'; params.push(q.before); }
    const limit = Math.min(Math.max(parseInt(String(q.limit ?? '50'), 10) || 50, 1), 200);
    const rows = await query<any[]>(
      `SELECT ${AUDIT_COLUMNS} FROM audit_log a
         LEFT JOIN users au ON au.id = a.actor_id
         LEFT JOIN users ub ON ub.id = a.undone_by
        WHERE ${where}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${limit + 1}`,
      params
    );
    const page = rows.slice(0, limit);
    const entries = [];
    for (const r of page) {
      const reversible = isReversible(r);
      const undo = reversible && !r.undone_at ? await canUndoEntry(actor, r as AuditEntry) : { ok: false };
      entries.push({ ...r, reversible, canUndo: undo.ok, undoBlockedReason: reversible && !r.undone_at && !undo.ok ? (undo as any).reason ?? null : null });
    }
    res.json({ entries, nextBefore: rows.length > limit ? page[page.length - 1].id : null });
  } catch (e) {
    errorOut(res, e, 'Failed to load the change history');
  }
});

router.get('/audit/facets', authenticateToken, async (req: any, res) => {
  try {
    const actor = policyActor(req);
    if (!canViewActivity(actor)) return res.status(403).json({ error: 'The change history is available to super admins and managers' });
    const params: any[] = [req.user.companyId];
    const where = 'a.company_id = ?' + scopeWhere(actor, params);
    const actions = await query<any[]>(`SELECT a.action, COUNT(*)::int AS n FROM audit_log a WHERE ${where} GROUP BY a.action ORDER BY a.action`, params);
    const actors = await query<any[]>(
      `SELECT a.actor_id AS id, MAX(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '')) AS name, MAX(u.email) AS email
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE ${where} AND a.actor_id IS NOT NULL
        GROUP BY a.actor_id ORDER BY 2 NULLS LAST`,
      params
    );
    const deptParams: any[] = [req.user.companyId];
    const departments = isCompanyAdmin(actor)
      ? await query<any[]>('SELECT id, name FROM departments WHERE company_id = ? ORDER BY name', deptParams)
      : await query<any[]>('SELECT id, name FROM departments WHERE company_id = ? AND id = ANY(?::text[]) ORDER BY name', [req.user.companyId, managedDepartmentIds(actor)]);
    res.json({ actions, actors, departments, reversibleActions: Object.keys(REVERSIBLE_ACTIONS) });
  } catch (e) {
    errorOut(res, e, 'Failed to load the filters');
  }
});

router.post('/audit/:id/undo', authenticateToken, async (req: any, res) => {
  try {
    const actor = policyActor(req);
    if (!canViewActivity(actor)) return res.status(403).json({ error: 'The change history is available to super admins and managers' });
    const out = await undoEntry(actor, req.user.companyId, req.params.id);
    res.json(out);
  } catch (e) {
    errorOut(res, e, 'Failed to undo the change');
  }
});

/* ------------------------------------------------------------------------------------------
 * Invitations
 * ---------------------------------------------------------------------------------------- */

const INVITATION_COLUMNS = `i.id, i.email, i.role, i.scope_type, i.scope_id, i.created_at, i.expires_at, i.last_sent_at, i.send_count,
  i.accepted_at, i.accepted_user_id, i.revoked_at, ${statusSql('i')} AS status,
  CASE i.scope_type WHEN 'company' THEN c.name WHEN 'department' THEN d.name ELSE t.name END AS scope_name,
  CASE i.scope_type WHEN 'department' THEN d.id WHEN 'team' THEN t.department_id ELSE NULL END AS department_id,
  NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS invited_by_name`;
const INVITATION_FROM = `FROM invitations i
  JOIN companies c ON c.id = i.company_id
  LEFT JOIN departments d ON i.scope_type = 'department' AND d.id = i.scope_id
  LEFT JOIN teams t ON i.scope_type = 'team' AND t.id = i.scope_id
  LEFT JOIN users u ON u.id = i.invited_by`;

/** May the actor see / manage this invitation? Same rule as giving its assignment. */
function canHandleInvitation(actor: PolicyActor, inv: { role: string; scope_type: string; scope_id: string; department_id: string | null }): boolean {
  return canGrant(actor, { role: inv.role, scopeType: inv.scope_type, scopeId: inv.scope_id },
    inv.scope_type === 'team' ? { id: inv.scope_id, department_id: inv.department_id } : null);
}

router.get('/invitations', authenticateToken, async (req: any, res) => {
  try {
    const actor = policyActor(req);
    if (!canInvite(actor)) return res.status(403).json({ error: 'You cannot invite people' });
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    const rows = await query<any[]>(
      `SELECT ${INVITATION_COLUMNS} ${INVITATION_FROM} WHERE i.company_id = ? ORDER BY i.created_at DESC LIMIT 500`,
      [req.user.companyId]
    );
    res.json({ invitations: rows.filter((r) => canHandleInvitation(actor, r) && (status === 'all' || r.status === status)) });
  } catch (e) {
    errorOut(res, e, 'Failed to load invitations');
  }
});

async function loadInvitation(req: any, res: any) {
  const actor = policyActor(req);
  const inv = await queryOne<any>(`SELECT ${INVITATION_COLUMNS} ${INVITATION_FROM} WHERE i.id = ? AND i.company_id = ?`, [req.params.id, req.user.companyId]);
  if (!inv || !canHandleInvitation(actor, inv)) { res.status(404).json({ error: 'Invitation not found' }); return null; }
  return inv;
}

/** Create (or re-send) and deliver: the response carries the link only when no email was delivered. */
async function deliver(req: any, inv: { id: string; email: string; role: string; scope_name: string | null }, token: string, expiresAt: Date) {
  const company = await queryOne<any>('SELECT name FROM companies WHERE id = ?', [req.user.companyId]);
  const me = await queryOne<any>('SELECT first_name, last_name, email FROM users WHERE id = ?', [req.user.id]);
  const mail = await sendInvitationEmail({
    to: inv.email, token, companyName: company?.name ?? 'your organisation', inviterName: me ? fullName(me) : null,
    role: inv.role, scopeName: inv.scope_name, expiresAt,
  });
  return {
    delivery: { delivered: mail.delivered, channel: mail.channel, error: mail.error ?? null },
    // No silent failure: when the email was not delivered the inviter gets the link to pass on.
    link: mail.delivered ? null : mail.link,
  };
}

router.post('/invitations', authenticateToken, async (req: any, res) => {
  try {
    const actor = policyActor(req);
    const companyId = req.user.companyId;
    if (!canInvite(actor)) return res.status(403).json({ error: 'You cannot invite people' });
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 255) return res.status(400).json({ error: 'Enter a valid email address' });
    const { grant, scope } = await resolveGrant(companyId, req.body ?? {});
    if (!canGrant(actor, grant, scope.team)) return res.status(403).json({ error: 'You cannot invite someone to this role and scope' });

    const existing = await queryOne<any>('SELECT id, company_id FROM users WHERE LOWER(email) = LOWER(?)', [email]);
    if (existing) {
      return res.status(409).json({
        error: existing.company_id === companyId
          ? 'This person already has an account here. Add an assignment on the Users page instead.'
          : 'This email address is already registered.',
      });
    }
    if (grant.role === 'team_lead') {
      const lead = await queryOne<any>(`SELECT 1 FROM role_assignments WHERE scope_type = 'team' AND scope_id = ? AND role = 'team_lead' AND revoked_at IS NULL`, [grant.scopeId]);
      if (lead) return res.status(409).json({ error: `${scope.name} already has a team lead. Invite them as a software engineer, then change the lead on the Departments page.` });
    }

    const { token, hash } = newToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS() * 3600 * 1000);
    const inv = await transaction(async (client) => {
      const exec = execOn(client);
      // An expired open invitation for the same address is withdrawn; a live one blocks.
      await exec(
        `UPDATE invitations SET revoked_at = now(), revoked_by = ?
          WHERE company_id = ? AND LOWER(email) = LOWER(?) AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now()`,
        [actor.id, companyId, email]
      );
      const [open] = await exec<any>(
        `SELECT id FROM invitations WHERE company_id = ? AND LOWER(email) = LOWER(?) AND accepted_at IS NULL AND revoked_at IS NULL`,
        [companyId, email]
      );
      if (open) throw new AssignmentError(409, 'This person already has an open invitation. Resend or revoke it.');
      const [row] = await exec<any>(
        `INSERT INTO invitations (company_id, email, role, scope_type, scope_id, token_hash, invited_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [companyId, email, grant.role, grant.scopeType, grant.scopeId, hash, actor.id, expiresAt.toISOString()]
      );
      await recordAudit({
        companyId, actorId: actor.id, action: 'invitation.create', entityType: 'invitation', entityId: row.id,
        summary: `Invited ${email} as ${scopeLabel(grant, scope)}`, after: { email, grant, expiresAt },
        departmentIds: [scope.departmentId], subjectIds: [row.id],
      }, exec);
      return row;
    });
    const out = await deliver(req, { id: inv.id, email, role: grant.role, scope_name: scope.name }, token, expiresAt);
    const invitation = await queryOne<any>(`SELECT ${INVITATION_COLUMNS} ${INVITATION_FROM} WHERE i.id = ?`, [inv.id]);
    res.status(201).json({ invitation, ...out });
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'This person already has an open invitation. Resend or revoke it.' });
    errorOut(res, e, 'Failed to create the invitation');
  }
});

router.post('/invitations/:id/resend', authenticateToken, async (req: any, res) => {
  try {
    const inv = await loadInvitation(req, res);
    if (!inv) return;
    if (inv.status === 'accepted' || inv.status === 'revoked') return res.status(409).json({ error: `This invitation was ${inv.status}; create a new one instead.` });
    // The old link stops working: its token hash is replaced (server/lib/invitations.ts).
    const issued = await reissueInvitation({ companyId: req.user.companyId, invitation: inv, actorId: req.user.id });
    if (!issued) return res.status(409).json({ error: 'This invitation was used or revoked meanwhile.' });
    const { token, expiresAt } = issued;
    const out = await deliver(req, inv, token, expiresAt);
    const invitation = await queryOne<any>(`SELECT ${INVITATION_COLUMNS} ${INVITATION_FROM} WHERE i.id = ?`, [inv.id]);
    res.json({ invitation, ...out });
  } catch (e) {
    errorOut(res, e, 'Failed to resend the invitation');
  }
});

router.post('/invitations/:id/revoke', authenticateToken, async (req: any, res) => {
  try {
    const inv = await loadInvitation(req, res);
    if (!inv) return;
    if (inv.status === 'accepted') return res.status(409).json({ error: 'This invitation was already accepted; deactivate the user instead.' });
    const updated = await queryOne<any>(
      `UPDATE invitations SET revoked_at = COALESCE(revoked_at, now()), revoked_by = COALESCE(revoked_by, ?) WHERE id = ? AND accepted_at IS NULL RETURNING id`,
      [req.user.id, inv.id]
    );
    if (!updated) return res.status(409).json({ error: 'This invitation was accepted meanwhile.' });
    if (inv.status !== 'revoked') {
      await recordAudit({
        companyId: req.user.companyId, actorId: req.user.id, action: 'invitation.revoke', entityType: 'invitation', entityId: inv.id,
        summary: `Revoked the invitation to ${inv.email}`, departmentIds: [inv.department_id], subjectIds: [inv.id],
      });
    }
    const invitation = await queryOne<any>(`SELECT ${INVITATION_COLUMNS} ${INVITATION_FROM} WHERE i.id = ?`, [inv.id]);
    res.json({ invitation });
  } catch (e) {
    errorOut(res, e, 'Failed to revoke the invitation');
  }
});

export default router;
