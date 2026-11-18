import { transaction } from '../../src/lib/db';
import {
  execOn, snapshotUser, sameGrants, revokeGrantsNotIn, addGrantsMissing, syncUserDisplay, lastSuperAdminGuard, grantAssignment,
  AssignmentError, type Exec, type UserSnapshot,
} from './assignments';
import {
  canEditAssignment, canGrant, canManageUser, isCompanyAdmin, managedDepartmentIds, canViewAuditEntry,
  type Grant, type PolicyActor,
} from './userPolicy';

/**
 * Change history (table audit_log): the ONE place that writes and undoes it.
 *
 * Every organisation / role / team / department / user / assignment / config change calls
 * recordAudit() (in the same transaction as the change when one is open). Entries carry the
 * departments they concern (department_ids: QA managers see their departments' entries) and
 * every entity id they touched (subject_ids).
 *
 * Undo (reversible actions only) re-applies `before` in one transaction, after checking that
 *   1. the entry is not undone already, and no newer change (not undone, not itself an undo)
 *      shares a subject with it, and
 *   2. the current state still equals the entry's `after` (nothing changed outside the history).
 * Otherwise it refuses with 409 and says which newer change is in the way. The undo writes its
 * own entry (action 'undo', undo_of = the original) and marks the original undone.
 */

export interface AuditInput {
  companyId: string;
  actorId: string | null;
  action: string;
  entityType: 'user' | 'team' | 'department' | 'assignment' | 'invitation' | 'config' | 'api_key' | 'company' | 'saved_view';
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  departmentIds?: Array<string | null | undefined>;
  subjectIds?: Array<string | null | undefined>;
  undoOf?: string | null;
}

const clean = (xs?: Array<string | null | undefined>) => [...new Set((xs ?? []).filter((x): x is string => typeof x === 'string' && x.length > 0))];

/** Record one change. Pass the transaction's exec when the change runs in one. Returns the entry id. */
export async function recordAudit(input: AuditInput, exec: Exec = execOn()): Promise<string> {
  const [row] = await exec<any>(
    `INSERT INTO audit_log (company_id, actor_id, action, entity_type, entity_id, summary, before, after, department_ids, subject_ids, undo_of)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::varchar[], ?::varchar[], ?) RETURNING id`,
    [
      input.companyId, input.actorId, input.action, input.entityType, input.entityId ?? null, input.summary.slice(0, 500),
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      clean(input.departmentIds), clean(input.subjectIds), input.undoOf ?? null,
    ]
  );
  return row.id;
}

/* ------------------------------------------------------------------------------------------
 * User changes: snapshot before / after
 * ---------------------------------------------------------------------------------------- */

export type UsersState = { users: Record<string, UserSnapshot> };

export async function snapshotUsers(exec: Exec, companyId: string, userIds: string[]): Promise<UsersState> {
  const users: Record<string, UserSnapshot> = {};
  for (const id of [...new Set(userIds)]) {
    const s = await snapshotUser(companyId, id, exec);
    if (s) users[id] = s;
  }
  return { users };
}

/** Departments a set of user snapshots concerns: their display departments and their grants' departments. */
export async function departmentsOf(exec: Exec, ...states: UsersState[]): Promise<string[]> {
  const out = new Set<string>();
  const teamIds = new Set<string>();
  for (const st of states) {
    for (const u of Object.values(st.users)) {
      if (u.department_id) out.add(u.department_id);
      for (const g of u.grants) {
        if (g.scopeType === 'department') out.add(g.scopeId);
        if (g.scopeType === 'team') teamIds.add(g.scopeId);
      }
    }
  }
  if (teamIds.size) {
    const rows = await exec<any>('SELECT department_id FROM teams WHERE id = ANY(?::text[])', [[...teamIds]]);
    for (const r of rows) if (r.department_id) out.add(r.department_id);
  }
  return [...out];
}

/**
 * Run a change to some users' assignments / profile / status in one transaction and record it
 * with before/after snapshots of those users. `fn` returns the summary and any extra user ids
 * it touched (e.g. a replaced lead).
 */
export async function auditedUserChange<T>(
  args: { companyId: string; actorId: string | null; action: string; entityType?: AuditInput['entityType']; entityId?: string | null; userIds: string[]; extraSubjects?: string[] },
  fn: (exec: Exec) => Promise<{ summary: string; result: T }>,
): Promise<{ result: T; auditId: string }> {
  return transaction(async (client) => {
    const exec = execOn(client);
    const ids = [...new Set(args.userIds)];
    const before = await snapshotUsers(exec, args.companyId, ids);
    const out = await fn(exec);
    const after = await snapshotUsers(exec, args.companyId, ids);
    const departmentIds = await departmentsOf(exec, before, after);
    const auditId = await recordAudit({
      companyId: args.companyId, actorId: args.actorId, action: args.action, entityType: args.entityType ?? 'user',
      entityId: args.entityId ?? ids[0] ?? null, summary: out.summary, before, after,
      departmentIds, subjectIds: [...ids, ...(args.extraSubjects ?? [])],
    }, exec);
    return { result: out.result, auditId };
  });
}

/* ------------------------------------------------------------------------------------------
 * Undo
 * ---------------------------------------------------------------------------------------- */

/** Actions that can be undone, and what kind of state their before/after holds. */
export const REVERSIBLE_ACTIONS: Record<string, 'users' | 'team_move' | 'department_rename'> = {
  'assignment.grant': 'users',
  'assignment.revoke': 'users',
  'user.update': 'users',
  'user.deactivate': 'users',
  'user.activate': 'users',
  'department.manager_assign': 'users',
  'department.manager_remove': 'users',
  'team.lead_change': 'users',
  'team.move': 'team_move',
  'department.rename': 'department_rename',
};

/** Newer entries of these actions never block an undo (they do not change the undone state). */
const NON_CONFLICTING = ['user.password_reset', 'user.developer_insights', 'invitation.create', 'invitation.resend', 'invitation.revoke', 'sso.link', 'user.login'];

export interface AuditEntry {
  id: string; company_id: string; actor_id: string | null; action: string; entity_type: string; entity_id: string | null;
  summary: string | null; before: any; after: any; department_ids: string[]; subject_ids: string[];
  created_at: string; undone_at: string | null; undone_by: string | null; undo_of: string | null;
}

export class UndoError extends Error {
  constructor(public status: number, message: string, public detail?: Record<string, unknown>) { super(message); }
}

const userState = (u: UserSnapshot) => ({
  role: u.role, department_id: u.department_id, primary_team_id: u.primary_team_id, is_active: u.is_active,
  email: u.email, first_name: u.first_name, last_name: u.last_name,
});

/** Is this entry an undoable kind, with the recorded state an undo needs? */
export function isReversible(entry: Pick<AuditEntry, 'action' | 'undo_of' | 'before' | 'after'>): boolean {
  const kind = REVERSIBLE_ACTIONS[entry.action];
  if (!kind || entry.undo_of) return false;
  if (kind === 'users') return !!entry.before?.users && !!entry.after?.users && Object.keys(entry.after.users).length > 0;
  return !!entry.before && !!entry.after;
}

/** Does the actor have the right to undo this entry (independent of conflicts)? */
export async function canUndoEntry(actor: PolicyActor, entry: AuditEntry, exec: Exec = execOn()): Promise<{ ok: boolean; reason?: string }> {
  const kind = REVERSIBLE_ACTIONS[entry.action];
  if (!kind || !isReversible(entry)) return { ok: false, reason: 'This change cannot be undone.' };
  if (!canViewAuditEntry(actor, entry)) return { ok: false, reason: 'This change is outside your scope.' };
  if (isCompanyAdmin(actor)) {
    if (kind === 'users' && entry.before?.users?.[actor.id]) return { ok: false, reason: 'You cannot undo a change to your own access.' };
    return { ok: true };
  }
  // QA managers: only user / assignment changes entirely within the departments they manage,
  // where every assignment that changes is one they could grant themselves.
  if (kind !== 'users' || ['department.manager_assign', 'department.manager_remove', 'team.lead_change'].includes(entry.action)) {
    return { ok: false, reason: 'Only a super admin can undo this change.' };
  }
  const mine = managedDepartmentIds(actor);
  if (!entry.department_ids.every((d) => mine.includes(d))) return { ok: false, reason: 'This change also concerns a department you do not manage.' };
  const teamIds = new Set<string>();
  for (const side of [entry.before, entry.after]) for (const u of Object.values<UserSnapshot>(side?.users ?? {})) for (const g of u.grants) if (g.scopeType === 'team') teamIds.add(g.scopeId);
  const teams = teamIds.size ? await exec<any>('SELECT id, department_id FROM teams WHERE id = ANY(?::text[])', [[...teamIds]]) : [];
  const teamOf = (id: string) => teams.find((t: any) => t.id === id) ?? null;
  for (const [uid, b] of Object.entries<UserSnapshot>(entry.before?.users ?? {})) {
    if (uid === actor.id) return { ok: false, reason: 'You cannot undo a change to your own access.' };
    const a: UserSnapshot | undefined = entry.after?.users?.[uid];
    const target = { id: uid, role: b.role, department_id: b.department_id, primary_team_id: b.primary_team_id, department_ids: entry.department_ids };
    if (entry.action === 'user.deactivate' || entry.action === 'user.activate') {
      if (!canManageUser(actor, target)) return { ok: false, reason: 'You cannot manage this user.' };
      continue;
    }
    if (!canEditAssignment(actor, target)) return { ok: false, reason: 'You cannot change this user\'s assignments.' };
    const changed = [...b.grants.filter((g) => !a?.grants.some((x) => sameGrant(x, g))), ...(a?.grants ?? []).filter((g) => !b.grants.some((x) => sameGrant(x, g)))];
    for (const g of changed) if (!canGrant(actor, g, g.scopeType === 'team' ? teamOf(g.scopeId) : null)) return { ok: false, reason: 'The change includes an assignment you cannot give.' };
  }
  return { ok: true };
}

const sameGrant = (a: Grant, b: Grant) => a.role === b.role && a.scopeType === b.scopeType && a.scopeId === b.scopeId;

/** The newest change after `entry` that blocks undoing it, if any. */
export async function blockingChange(exec: Exec, entry: AuditEntry): Promise<AuditEntry | null> {
  if (!entry.subject_ids?.length) return null;
  const [row] = await exec<AuditEntry>(
    `SELECT a.*, NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS actor_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.company_id = ? AND a.id <> ? AND a.created_at > ? AND a.undone_at IS NULL AND a.undo_of IS NULL
        AND a.subject_ids && ?::varchar[] AND NOT (a.action = ANY(?::text[]))
      ORDER BY a.created_at DESC LIMIT 1`,
    [entry.company_id, entry.id, entry.created_at, entry.subject_ids, NON_CONFLICTING]
  );
  return row ?? null;
}

/** Undo an entry. Throws UndoError (403 / 404 / 409) when it cannot be undone. Returns the undo entry id. */
export async function undoEntry(actor: PolicyActor, companyId: string, entryId: string): Promise<{ undoId: string; summary: string }> {
  return transaction(async (client) => {
    const exec = execOn(client);
    const [entry] = await exec<AuditEntry>('SELECT * FROM audit_log WHERE id = ? AND company_id = ? FOR UPDATE', [entryId, companyId]);
    if (!entry || !canViewAuditEntry(actor, entry)) throw new UndoError(404, 'Change not found');
    if (entry.undone_at) throw new UndoError(409, 'This change has already been undone.');
    const allowed = await canUndoEntry(actor, entry, exec);
    if (!allowed.ok) throw new UndoError(403, allowed.reason ?? 'You cannot undo this change.');

    const newer = await blockingChange(exec, entry);
    if (newer) {
      const who = (newer as any).actor_name ? ` by ${(newer as any).actor_name}` : '';
      throw new UndoError(409,
        `A newer change touches the same ${entry.entity_type === 'department' ? 'department' : entry.entity_type === 'team' && entry.action === 'team.move' ? 'team' : 'people'}: "${newer.summary}"${who} on ${new Date(newer.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC. Undo that change first.`,
        { blockingId: newer.id });
    }

    const kind = REVERSIBLE_ACTIONS[entry.action];
    if (kind === 'users') await undoUsers(exec, companyId, actor.id, entry);
    else if (kind === 'team_move') await undoTeamMove(exec, companyId, entry);
    else await undoDepartmentRename(exec, companyId, entry);

    await exec('UPDATE audit_log SET undone_at = now(), undone_by = ? WHERE id = ?', [actor.id, entry.id]);
    const summary = `Undid: ${entry.summary ?? entry.action}`;
    const undoId = await recordAudit({
      companyId, actorId: actor.id, action: 'undo', entityType: entry.entity_type as AuditInput['entityType'], entityId: entry.entity_id,
      summary, before: entry.after, after: entry.before, departmentIds: entry.department_ids, subjectIds: entry.subject_ids, undoOf: entry.id,
    }, exec);
    return { undoId, summary };
  });
}

const stateMismatch = () => new UndoError(409, 'The current state no longer matches this change (it was changed since, outside this history). Nothing was undone.');

async function undoUsers(exec: Exec, companyId: string, actorId: string, entry: AuditEntry): Promise<void> {
  const before: Record<string, UserSnapshot> = entry.before?.users ?? {};
  const after: Record<string, UserSnapshot> = entry.after?.users ?? {};
  // 1. Current state must equal `after` for every user.
  for (const [uid, a] of Object.entries(after)) {
    const now = await snapshotUser(companyId, uid, exec);
    if (!now || !sameGrants(now.grants, a.grants) || JSON.stringify(userState(now)) !== JSON.stringify(userState(a))) throw stateMismatch();
  }
  // 2. Never leave the company without an active super admin.
  for (const [uid, a] of Object.entries(after)) {
    const b = before[uid];
    const losesAdmin = a.grants.some((g) => g.role === 'super_admin') && !(b?.grants ?? []).some((g) => g.role === 'super_admin');
    const deactivates = a.is_active && b && !b.is_active;
    if (losesAdmin || (deactivates && a.grants.some((g) => g.role === 'super_admin'))) await lastSuperAdminGuard(companyId, uid, exec);
  }
  // 3. Revoke for everyone first, then grant (a lead handed between two users never collides).
  for (const [uid, b] of Object.entries(before)) await revokeGrantsNotIn(exec, uid, b.grants, actorId);
  try {
    for (const [uid, b] of Object.entries(before)) await addGrantsMissing(exec, companyId, uid, b.grants, actorId);
  } catch (e) {
    if (e instanceof AssignmentError) throw new UndoError(409, `Cannot restore the previous assignments: ${e.message}`);
    throw e;
  }
  for (const [uid, b] of Object.entries(before)) {
    await exec(
      'UPDATE users SET is_active = ?, email = ?, first_name = ?, last_name = ?, updated_at = NOW() WHERE id = ? AND company_id = ?',
      [b.is_active, b.email, b.first_name, b.last_name, uid, companyId]
    );
    await syncUserDisplay(exec, uid, { primaryTeamId: b.primary_team_id, departmentId: b.department_id, fallbackRole: b.role });
  }
}

async function undoTeamMove(exec: Exec, companyId: string, entry: AuditEntry): Promise<void> {
  const teamId = entry.entity_id as string;
  const from: string = entry.before?.departmentId;
  const to: string = entry.after?.departmentId;
  const moved: string[] = entry.after?.movedUserIds ?? [];
  const [team] = await exec<any>('SELECT id, name, department_id FROM teams WHERE id = ? AND company_id = ? FOR UPDATE', [teamId, companyId]);
  if (!team || team.department_id !== to) throw stateMismatch();
  const [dept] = await exec<any>('SELECT id, is_active FROM departments WHERE id = ? AND company_id = ?', [from, companyId]);
  if (!dept || !dept.is_active) throw new UndoError(409, 'The original department no longer exists or is inactive.');
  const [clash] = await exec<any>('SELECT id FROM teams WHERE company_id = ? AND department_id = ? AND LOWER(name) = LOWER(?) AND id <> ?', [companyId, from, team.name, teamId]);
  if (clash) throw new UndoError(409, `The original department already has a team called "${team.name}".`);
  await exec('UPDATE teams SET department_id = ?, updated_at = NOW() WHERE id = ?', [from, teamId]);
  if (moved.length) {
    await exec('UPDATE users SET department_id = ?, updated_at = NOW() WHERE company_id = ? AND id = ANY(?::text[]) AND department_id = ?', [from, companyId, moved, to]);
  }
  await exec('UPDATE configs SET department_id = ?, updated_at = NOW() WHERE company_id = ? AND team_id = ?', [from, companyId, teamId]);
  // Memberships the move ended (QA managers of the old department) come back.
  for (const m of (entry.after?.revokedMemberships ?? []) as Array<{ userId: string; role: string }>) {
    await grantAssignment(exec, { companyId, userId: m.userId, grant: { role: m.role, scopeType: 'team', scopeId: teamId }, actorId: null });
    await syncUserDisplay(exec, m.userId, { primaryTeamId: teamId });
  }
}

async function undoDepartmentRename(exec: Exec, companyId: string, entry: AuditEntry): Promise<void> {
  const [d] = await exec<any>('SELECT id, name, description FROM departments WHERE id = ? AND company_id = ? FOR UPDATE', [entry.entity_id, companyId]);
  if (!d || d.name !== entry.after?.name || (d.description ?? null) !== (entry.after?.description ?? null)) throw stateMismatch();
  const [clash] = await exec<any>('SELECT id FROM departments WHERE company_id = ? AND LOWER(name) = LOWER(?) AND id <> ? AND is_active = TRUE', [companyId, entry.before?.name, d.id]);
  if (clash) throw new UndoError(409, `Another department is already called "${entry.before?.name}".`);
  await exec('UPDATE departments SET name = ?, description = ?, updated_at = NOW() WHERE id = ?', [entry.before?.name, entry.before?.description ?? null, d.id]);
}
