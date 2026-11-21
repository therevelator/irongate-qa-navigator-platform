import type pg from 'pg';
import { query, queryOne, toPgPlaceholders } from '../../src/lib/db';
import { ROLE_RANK, ROLE_SCOPE, type Grant, type Role, type ScopeType } from './userPolicy';
import { lifetimeSettingSql } from './sessions';

/**
 * Role assignments (table role_assignments): the ONE module that reads and writes them.
 *
 * Every access decision reads a user's active assignments through this module: the auth
 * middleware loads them per request (loadAccessContext) and the pure rules in userPolicy.ts
 * decide; SQL that needs "who leads / who belongs to / who manages" uses the fragments below
 * (team lead, member count, department managers, a user's teams). Team lead single source of
 * truth: the active team_lead assignment of the team (at most one, enforced by a unique index).
 *
 * Compatibility columns kept in sync by syncUserDisplay() after every change, in the same
 * transaction:
 *   users.role             highest active role (display)
 *   users.department_id    primary department (kept when still assigned, else derived)
 *   users.primary_team_id  primary team (kept when still assigned, else a led team, else the first)
 *   team_members           one row per team assignment ('lead' for team_lead)
 *   teams.lead_id          the team's active team_lead assignment
 *   departments.manager_id one of the department's active QA managers
 */

export type Exec = <T = any>(sql: string, params?: any[]) => Promise<T[]>;
export const execOn = (client?: pg.PoolClient): Exec =>
  client
    ? (sql, params) => client.query(toPgPlaceholders(sql), params).then((r) => r.rows)
    : (sql, params) => query<any[]>(sql, params);

export class AssignmentError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface AssignmentRow {
  id: string;
  user_id: string;
  role: Role;
  scope_type: ScopeType;
  scope_id: string;
  scope_name: string | null;
  /** Department of a team-scoped assignment (the team's department); the department itself for department scope. */
  department_id: string | null;
  department_name: string | null;
  created_at: string;
  created_by: string | null;
}

const ACTIVE = 'ra.revoked_at IS NULL';

/* ------------------------------------------------------------------------------------------
 * SQL fragments (team lead, membership, managers)
 * ---------------------------------------------------------------------------------------- */

/** SQL expression: the id of team `<alias>.id`'s lead (its active team_lead assignment, active user). */
export const teamLeadIdSql = (alias = 't') => `(
  SELECT ra.user_id FROM role_assignments ra JOIN users lu ON lu.id = ra.user_id AND lu.is_active = TRUE
   WHERE ${ACTIVE} AND ra.role = 'team_lead' AND ra.scope_type = 'team' AND ra.scope_id = ${alias}.id
   LIMIT 1
)`;

/** SQL expression: the name of team `<alias>.id`'s lead (same rule as teamLeadIdSql). */
export const teamLeadNameSql = (alias = 't') => `(
  SELECT NULLIF(TRIM(COALESCE(lu.first_name, '') || ' ' || COALESCE(lu.last_name, '')), '')
    FROM role_assignments ra JOIN users lu ON lu.id = ra.user_id AND lu.is_active = TRUE
   WHERE ${ACTIVE} AND ra.role = 'team_lead' AND ra.scope_type = 'team' AND ra.scope_id = ${alias}.id
   LIMIT 1
)`;

/** SQL expression: number of active users with an active assignment on team `<alias>.id`. */
export const teamMemberCountSql = (alias = 't') => `(
  SELECT COUNT(DISTINCT ra.user_id) FROM role_assignments ra JOIN users mu ON mu.id = ra.user_id AND mu.is_active = TRUE
   WHERE ${ACTIVE} AND ra.scope_type = 'team' AND ra.scope_id = ${alias}.id
)`;

/** SQL condition: user `<userAlias>` has an active assignment on the team given by `teamExpr`. */
export const isTeamMemberSql = (userAlias: string, teamExpr: string) => `EXISTS (
  SELECT 1 FROM role_assignments ra
   WHERE ${ACTIVE} AND ra.user_id = ${userAlias}.id AND ra.scope_type = 'team' AND ra.scope_id = ${teamExpr}
)`;

/** SQL expression: array of team ids user `<userAlias>` is assigned to. */
export const userTeamIdsSql = (userAlias = 'u') => `ARRAY(
  SELECT ra.scope_id FROM role_assignments ra
   WHERE ${ACTIVE} AND ra.user_id = ${userAlias}.id AND ra.scope_type = 'team'
   ORDER BY ra.created_at
)`;

/** SQL expression: array of departments user `<userAlias>` belongs to (department grants and their teams' departments). */
export const userDepartmentIdsSql = (userAlias = 'u') => `ARRAY(
  SELECT DISTINCT x.d FROM (
    SELECT ra.scope_id AS d FROM role_assignments ra
     WHERE ${ACTIVE} AND ra.user_id = ${userAlias}.id AND ra.scope_type = 'department'
    UNION
    SELECT tt.department_id FROM role_assignments ra JOIN teams tt ON tt.id = ra.scope_id
     WHERE ${ACTIVE} AND ra.user_id = ${userAlias}.id AND ra.scope_type = 'team'
  ) x WHERE x.d IS NOT NULL
)`;

/** SQL condition: user `<userAlias>` is an active QA manager of the department given by `deptExpr`. */
export const isDepartmentManagerSql = (userAlias: string, deptExpr: string) => `EXISTS (
  SELECT 1 FROM role_assignments ra
   WHERE ${ACTIVE} AND ra.user_id = ${userAlias}.id AND ra.role = 'qa_manager' AND ra.scope_type = 'department' AND ra.scope_id = ${deptExpr}
)`;

/* ------------------------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------------------------- */

export interface AccessContext {
  id: string;
  role: string;
  company_id: string;
  department_id: string | null;
  primary_team_id: string | null;
  is_active: boolean;
  grants: Grant[];
  /** Session limits (server/lib/sessions.ts). */
  sessions_valid_after: string | Date | null;
  session_lifetime: string | null;
  /** 'active' | 'suspended' (companies.status). */
  company_status: string | null;
  /** The token's user_sessions row (null without a jti or without a row). */
  session_revoked_at: string | Date | null;
  session_last_seen_at: string | Date | null;
  /** Whether the token's session row exists (a demo sandbox token needs it). */
  session_exists?: boolean;
}

/**
 * The caller's live row, company status, session row and active grants (auth middleware, every
 * request): ONE query, so the session checks add no database round trip.
 */
export async function loadAccessContext(userId: string, sessionId: string | null = null): Promise<AccessContext | null> {
  const row = await queryOne<any>(
    `SELECT u.id, u.role, u.company_id, u.department_id, u.primary_team_id, u.is_active,
            u.sessions_valid_after, ${lifetimeSettingSql('u')} AS session_lifetime,
            (SELECT c.status FROM companies c WHERE c.id = u.company_id) AS company_status,
            s.revoked_at AS session_revoked_at, s.last_seen_at AS session_last_seen_at, (s.id IS NOT NULL) AS session_exists,
            COALESCE((
              SELECT json_agg(json_build_object('role', ra.role, 'scopeType', ra.scope_type, 'scopeId', ra.scope_id) ORDER BY ra.created_at)
                FROM role_assignments ra
               WHERE ra.user_id = u.id AND ra.company_id = u.company_id AND ra.revoked_at IS NULL
            ), '[]'::json) AS grants
       FROM users u LEFT JOIN user_sessions s ON s.id = ?::text AND s.user_id = u.id
      WHERE u.id = ?`,
    [sessionId, userId]
  );
  if (!row) return null;
  return { ...row, grants: (row.grants as Grant[]) ?? [] };
}

/** Active grants of a user (company-checked). */
export async function loadGrants(companyId: string, userId: string, exec: Exec = execOn()): Promise<Grant[]> {
  const rows = await exec<any>(
    `SELECT role, scope_type, scope_id FROM role_assignments
      WHERE company_id = ? AND user_id = ? AND revoked_at IS NULL ORDER BY created_at`,
    [companyId, userId]
  );
  return rows.map((r) => ({ role: r.role, scopeType: r.scope_type, scopeId: r.scope_id }));
}

/** Active assignments with scope names, for the given users (null = everyone in the company). */
export async function listAssignments(companyId: string, userIds: string[] | null, exec: Exec = execOn()): Promise<AssignmentRow[]> {
  return exec<AssignmentRow>(
    `SELECT ra.id, ra.user_id, ra.role, ra.scope_type, ra.scope_id, ra.created_at, ra.created_by,
            CASE ra.scope_type WHEN 'company' THEN c.name WHEN 'department' THEN d.name ELSE t.name END AS scope_name,
            CASE ra.scope_type WHEN 'department' THEN d.id WHEN 'team' THEN t.department_id ELSE NULL END AS department_id,
            CASE ra.scope_type WHEN 'department' THEN d.name WHEN 'team' THEN td.name ELSE NULL END AS department_name
       FROM role_assignments ra
       LEFT JOIN companies c ON ra.scope_type = 'company' AND c.id = ra.scope_id
       LEFT JOIN departments d ON ra.scope_type = 'department' AND d.id = ra.scope_id
       LEFT JOIN teams t ON ra.scope_type = 'team' AND t.id = ra.scope_id
       LEFT JOIN departments td ON td.id = t.department_id
      WHERE ra.company_id = ? AND ra.revoked_at IS NULL
        AND (?::text[] IS NULL OR ra.user_id = ANY(?::text[]))
      ORDER BY ra.user_id, CASE ra.role WHEN 'super_admin' THEN 0 WHEN 'qa_manager' THEN 1 WHEN 'team_lead' THEN 2 WHEN 'qa_engineer' THEN 3 ELSE 4 END, scope_name`,
    [companyId, userIds, userIds]
  );
}

/** A user's state for the audit log: display columns, active flag and grants. */
export interface UserSnapshot {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  department_id: string | null;
  primary_team_id: string | null;
  is_active: boolean;
  grants: Grant[];
}

export async function snapshotUser(companyId: string, userId: string, exec: Exec = execOn()): Promise<UserSnapshot | null> {
  const [u] = await exec<any>(
    `SELECT id, first_name, last_name, email, role, department_id, primary_team_id, is_active FROM users WHERE id = ? AND company_id = ?`,
    [userId, companyId]
  );
  if (!u) return null;
  return {
    id: u.id,
    name: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email,
    first_name: u.first_name ?? '',
    last_name: u.last_name ?? '',
    email: u.email,
    role: u.role,
    department_id: u.department_id,
    primary_team_id: u.primary_team_id,
    is_active: !!u.is_active,
    grants: sortGrants(await loadGrants(companyId, userId, exec)),
  };
}

const grantKey = (g: Grant) => `${g.role}|${g.scopeType}|${g.scopeId}`;
export const sortGrants = (gs: Grant[]) => [...gs].sort((a, b) => grantKey(a).localeCompare(grantKey(b)));
export const sameGrants = (a: Grant[], b: Grant[]) =>
  a.length === b.length && sortGrants(a).every((g, i) => grantKey(g) === grantKey(sortGrants(b)[i]));

/* ------------------------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------------------------- */

export interface ScopeInfo {
  scopeType: ScopeType;
  scopeId: string;
  name: string;
  /** Team: its department; department: itself. */
  departmentId: string | null;
  team: { id: string; department_id: string | null } | null;
}

/** Normalise and validate a grant for this company (scope exists and is active). */
export async function resolveGrant(companyId: string, input: { role?: unknown; scopeType?: unknown; scopeId?: unknown }, exec: Exec = execOn()): Promise<{ grant: Grant; scope: ScopeInfo }> {
  const role = typeof input.role === 'string' ? (input.role as Role) : null;
  if (!role || !(role in ROLE_SCOPE)) throw new AssignmentError(400, 'role must be one of super_admin, qa_manager, team_lead, qa_engineer, viewer');
  const scopeType = ROLE_SCOPE[role];
  if (input.scopeType !== undefined && input.scopeType !== scopeType) {
    throw new AssignmentError(400, `${role} is assigned on a ${scopeType}`);
  }
  if (scopeType === 'company') {
    const [c] = await exec<any>('SELECT id, name FROM companies WHERE id = ?', [companyId]);
    return { grant: { role, scopeType, scopeId: companyId }, scope: { scopeType, scopeId: companyId, name: c?.name ?? 'Company', departmentId: null, team: null } };
  }
  const scopeId = typeof input.scopeId === 'string' ? input.scopeId : '';
  if (!scopeId) throw new AssignmentError(400, scopeType === 'team' ? 'Choose a team' : 'Choose a department');
  if (scopeType === 'department') {
    const [d] = await exec<any>('SELECT id, name, is_active FROM departments WHERE id = ? AND company_id = ?', [scopeId, companyId]);
    if (!d) throw new AssignmentError(400, 'Department not found in your company');
    if (!d.is_active) throw new AssignmentError(400, 'That department is inactive');
    return { grant: { role, scopeType, scopeId }, scope: { scopeType, scopeId, name: d.name, departmentId: d.id, team: null } };
  }
  const [t] = await exec<any>('SELECT id, name, department_id, is_active FROM teams WHERE id = ? AND company_id = ?', [scopeId, companyId]);
  if (!t) throw new AssignmentError(400, 'Team not found in your company');
  if (!t.is_active) throw new AssignmentError(400, 'That team is inactive');
  return {
    grant: { role, scopeType, scopeId },
    scope: { scopeType, scopeId, name: t.name, departmentId: t.department_id, team: { id: t.id, department_id: t.department_id } },
  };
}

/** Role-change guard: never your own assignments, never remove the company's last super_admin. */
export async function lastSuperAdminGuard(companyId: string, userId: string, exec: Exec = execOn()): Promise<void> {
  const [row] = await exec<any>(
    `SELECT COUNT(DISTINCT ra.user_id)::int AS n FROM role_assignments ra JOIN users u ON u.id = ra.user_id AND u.is_active = TRUE
      WHERE ra.company_id = ? AND ra.role = 'super_admin' AND ra.revoked_at IS NULL AND ra.user_id <> ?`,
    [companyId, userId]
  );
  if ((row?.n ?? 0) < 1) throw new AssignmentError(400, 'This is the last super admin of the company and cannot be demoted');
}

/* ------------------------------------------------------------------------------------------
 * Writes (always inside a transaction: pass the client's exec)
 * ---------------------------------------------------------------------------------------- */

export interface GrantResult {
  id: string;
  /** The user's previous assignment on the same scope that this one replaced. */
  replaced: Grant | null;
  /** grant of team_lead with replaceLead: the lead that was replaced (now a member of the team). */
  previousLeadId: string | null;
  changed: boolean;
}

/**
 * Give a user an assignment. An active assignment of the same user on the same scope with a
 * different role is replaced (one assignment per scope). A team already led by someone else:
 * 409, unless replaceLead, in which case the previous lead stays on the team as a qa_engineer.
 */
export async function grantAssignment(
  exec: Exec,
  args: { companyId: string; userId: string; grant: Grant; actorId: string | null; replaceLead?: boolean },
): Promise<GrantResult> {
  const { companyId, userId, grant, actorId } = args;
  const [existing] = await exec<any>(
    `SELECT id, role FROM role_assignments WHERE user_id = ? AND scope_type = ? AND scope_id = ? AND revoked_at IS NULL FOR UPDATE`,
    [userId, grant.scopeType, grant.scopeId]
  );
  if (existing && existing.role === grant.role) return { id: existing.id, replaced: null, previousLeadId: null, changed: false };

  let previousLeadId: string | null = null;
  if (grant.role === 'team_lead') {
    const [lead] = await exec<any>(
      `SELECT ra.id, ra.user_id, u.first_name, u.last_name, u.email FROM role_assignments ra JOIN users u ON u.id = ra.user_id
        WHERE ra.scope_type = 'team' AND ra.scope_id = ? AND ra.role = 'team_lead' AND ra.revoked_at IS NULL AND ra.user_id <> ?
        FOR UPDATE OF ra`,
      [grant.scopeId, userId]
    );
    if (lead) {
      if (!args.replaceLead) {
        const who = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || lead.email;
        throw new AssignmentError(409, `This team already has a lead (${who}). Change the lead on the Departments page, or remove ${who}'s lead assignment first.`);
      }
      previousLeadId = lead.user_id;
      await exec(`UPDATE role_assignments SET revoked_at = now(), revoked_by = ? WHERE id = ?`, [actorId, lead.id]);
      await exec(
        `INSERT INTO role_assignments (company_id, user_id, role, scope_type, scope_id, created_by) VALUES (?, ?, 'qa_engineer', 'team', ?, ?)`,
        [companyId, lead.user_id, grant.scopeId, actorId]
      );
    }
  }
  if (existing) await exec(`UPDATE role_assignments SET revoked_at = now(), revoked_by = ? WHERE id = ?`, [actorId, existing.id]);
  const [row] = await exec<any>(
    `INSERT INTO role_assignments (company_id, user_id, role, scope_type, scope_id, created_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [companyId, userId, grant.role, grant.scopeType, grant.scopeId, actorId]
  );
  return {
    id: row.id,
    replaced: existing ? { role: existing.role, scopeType: grant.scopeType, scopeId: grant.scopeId } : null,
    previousLeadId,
    changed: true,
  };
}

/** Revoke a user's active assignment on a scope (role must match when given). Returns whether one was revoked. */
export async function revokeGrant(exec: Exec, args: { userId: string; grant: Grant; actorId: string | null }): Promise<boolean> {
  const rows = await exec(
    `UPDATE role_assignments SET revoked_at = now(), revoked_by = ?
      WHERE user_id = ? AND scope_type = ? AND scope_id = ? AND role = ? AND revoked_at IS NULL RETURNING id`,
    [args.actorId, args.userId, args.grant.scopeType, args.grant.scopeId, args.grant.role]
  );
  return rows.length > 0;
}

/**
 * Make a user's active grants exactly `desired` (undo). Revokes first, then grants, so a lead
 * handed back and forth between users never collides when callers revoke for every user first.
 */
export async function revokeGrantsNotIn(exec: Exec, userId: string, desired: Grant[], actorId: string | null): Promise<void> {
  const current = await exec<any>(`SELECT id, role, scope_type, scope_id FROM role_assignments WHERE user_id = ? AND revoked_at IS NULL`, [userId]);
  const want = new Set(desired.map(grantKey));
  for (const r of current) {
    if (!want.has(grantKey({ role: r.role, scopeType: r.scope_type, scopeId: r.scope_id }))) {
      await exec(`UPDATE role_assignments SET revoked_at = now(), revoked_by = ? WHERE id = ?`, [actorId, r.id]);
    }
  }
}
export async function addGrantsMissing(exec: Exec, companyId: string, userId: string, desired: Grant[], actorId: string | null): Promise<void> {
  for (const g of desired) await grantAssignment(exec, { companyId, userId, grant: g, actorId });
}

/** The grants that one (role, department, primary team) triple stands for (user create / edit form). */
export function grantsForPrimary(companyId: string, role: string, departmentId: string | null, teamId: string | null): Grant[] {
  const out: Grant[] = [];
  if (role === 'super_admin') out.push({ role, scopeType: 'company', scopeId: companyId });
  else if (role === 'qa_manager' && departmentId) out.push({ role, scopeType: 'department', scopeId: departmentId });
  if (teamId) {
    if (role === 'team_lead' || role === 'qa_engineer' || role === 'viewer') out.push({ role, scopeType: 'team', scopeId: teamId });
    else out.push({ role: 'qa_engineer', scopeType: 'team', scopeId: teamId }); // membership of an admin / manager
  }
  return out;
}

/**
 * Change a user's PRIMARY assignment (the Users edit form's role / department / team): the
 * grants of the old triple that the new triple does not contain are revoked, the new ones
 * granted. Other (secondary) assignments stay.
 */
export async function setPrimaryAssignment(
  exec: Exec,
  args: {
    companyId: string; userId: string; actorId: string | null;
    from: { role: string; departmentId: string | null; teamId: string | null };
    to: { role: string; departmentId: string | null; teamId: string | null };
  },
): Promise<void> {
  const { companyId, userId, actorId, from, to } = args;
  const before = grantsForPrimary(companyId, from.role, from.departmentId, from.teamId);
  const after = grantsForPrimary(companyId, to.role, to.departmentId, to.teamId);
  const afterKeys = new Set(after.map(grantKey));
  for (const g of before) if (!afterKeys.has(grantKey(g))) await revokeGrant(exec, { userId, grant: g, actorId });
  for (const g of after) await grantAssignment(exec, { companyId, userId, grant: g, actorId });
  await syncUserDisplay(exec, userId, { primaryTeamId: to.teamId, departmentId: to.departmentId, fallbackRole: to.role });
}

/* ------------------------------------------------------------------------------------------
 * Display / compatibility columns
 * ---------------------------------------------------------------------------------------- */

export interface DisplayPrefs {
  /** Preferred primary team (used when the user is assigned to it; null = prefer none). */
  primaryTeamId?: string | null;
  /** Preferred department (used when the user belongs to it, or has no department otherwise). */
  departmentId?: string | null;
  /** users.role when the user has no active assignment left. */
  fallbackRole?: string;
}

/** Recompute the display columns of a user and the compatibility columns, from their active grants. */
export async function syncUserDisplay(exec: Exec, userId: string, prefs: DisplayPrefs = {}): Promise<void> {
  const [u] = await exec<any>('SELECT id, role, company_id, department_id, primary_team_id FROM users WHERE id = ? FOR UPDATE', [userId]);
  if (!u) return;
  const grants = await exec<any>(
    `SELECT ra.role, ra.scope_type, ra.scope_id, ra.created_at, t.department_id AS team_department_id
       FROM role_assignments ra LEFT JOIN teams t ON ra.scope_type = 'team' AND t.id = ra.scope_id
      WHERE ra.user_id = ? AND ra.revoked_at IS NULL
      ORDER BY ra.created_at`,
    [userId]
  );
  const role = grants.length
    ? grants.reduce((best: string, g: any) => ((ROLE_RANK[g.role] ?? 0) > (ROLE_RANK[best] ?? 0) ? g.role : best), grants[0].role)
    : prefs.fallbackRole ?? u.role;
  const teamGrants = grants.filter((g: any) => g.scope_type === 'team');
  const teamIds: string[] = teamGrants.map((g: any) => g.scope_id);
  const leadIds: string[] = teamGrants.filter((g: any) => g.role === 'team_lead').map((g: any) => g.scope_id);
  const managed: string[] = grants.filter((g: any) => g.scope_type === 'department').map((g: any) => g.scope_id);

  let primary: string | null;
  if (prefs.primaryTeamId !== undefined && (prefs.primaryTeamId === null || teamIds.includes(prefs.primaryTeamId))) {
    primary = prefs.primaryTeamId ?? (role === 'super_admin' || role === 'qa_manager' ? null : (leadIds[0] ?? teamIds[0] ?? null));
  } else if (u.primary_team_id && teamIds.includes(u.primary_team_id)) primary = u.primary_team_id;
  else primary = leadIds[0] ?? teamIds[0] ?? null;

  const deptSet = new Set<string>([...managed, ...teamGrants.map((g: any) => g.team_department_id).filter(Boolean)]);
  const primaryDept = primary ? teamGrants.find((g: any) => g.scope_id === primary)?.team_department_id ?? null : null;
  // users.department_id is NOT NULL: keep the current value when nothing better applies.
  let department: string = u.department_id;
  if (prefs.departmentId && (deptSet.has(prefs.departmentId) || deptSet.size === 0)) department = prefs.departmentId;
  else if (u.department_id && deptSet.has(u.department_id)) department = u.department_id;
  else if (primaryDept) department = primaryDept;
  else if (managed[0]) department = managed[0];

  if (role !== u.role || department !== u.department_id || primary !== u.primary_team_id) {
    await exec('UPDATE users SET role = ?, department_id = ?, primary_team_id = ?, updated_at = NOW() WHERE id = ?', [role, department, primary, userId]);
  }

  // team_members: one row per team assignment.
  for (const g of teamGrants) {
    await exec(
      `INSERT INTO team_members (user_id, team_id, role) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM teams WHERE id = ?)
       ON CONFLICT (user_id, team_id) DO UPDATE SET role = CASE
         WHEN EXCLUDED.role = 'lead' THEN 'lead'
         WHEN team_members.role = 'lead' THEN 'member'
         ELSE team_members.role END`,
      [userId, g.scope_id, g.role === 'team_lead' ? 'lead' : 'member', g.scope_id]
    );
  }
  await exec(`DELETE FROM team_members WHERE user_id = ? AND NOT (team_id = ANY(?::text[]))`, [userId, teamIds]);

  // teams.lead_id follows the team_lead assignments.
  if (leadIds.length) {
    await exec(`UPDATE teams SET lead_id = ?, updated_at = NOW() WHERE id = ANY(?::text[]) AND lead_id IS DISTINCT FROM ?`, [userId, leadIds, userId]);
  }
  await exec(
    `UPDATE teams t SET lead_id = (
        SELECT ra.user_id FROM role_assignments ra
         WHERE ra.scope_type = 'team' AND ra.scope_id = t.id AND ra.role = 'team_lead' AND ra.revoked_at IS NULL LIMIT 1
      ), updated_at = NOW()
      WHERE t.lead_id = ? AND NOT (t.id = ANY(?::text[]))`,
    [userId, leadIds]
  );

  // departments.manager_id: one of the department's active QA managers.
  if (managed.length) {
    await exec(
      `UPDATE departments d SET manager_id = ?, updated_at = NOW()
        WHERE d.id = ANY(?::text[]) AND (d.manager_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM role_assignments ra WHERE ra.user_id = d.manager_id AND ra.role = 'qa_manager'
             AND ra.scope_type = 'department' AND ra.scope_id = d.id AND ra.revoked_at IS NULL))`,
      [userId, managed]
    );
  }
  await exec(
    `UPDATE departments d SET manager_id = (
        SELECT ra.user_id FROM role_assignments ra
         WHERE ra.scope_type = 'department' AND ra.scope_id = d.id AND ra.role = 'qa_manager' AND ra.revoked_at IS NULL
         ORDER BY ra.created_at LIMIT 1
      ), updated_at = NOW()
      WHERE d.manager_id = ? AND NOT (d.id = ANY(?::text[]))`,
    [userId, managed]
  );
}

/** Active QA managers of a department (people), from the assignments. */
export async function departmentManagers(companyId: string, departmentId: string | null, exec: Exec = execOn()): Promise<Array<{ id: string; first_name: string | null; last_name: string | null; email: string; role: string; is_active: boolean; primary_team_id: string | null }>> {
  if (!departmentId) return [];
  return exec(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.is_active, u.primary_team_id
       FROM users u
      WHERE u.company_id = ? AND u.is_active = TRUE AND ${isDepartmentManagerSql('u', '?')}
      ORDER BY u.first_name, u.last_name`,
    [companyId, departmentId]
  );
}

/** The active lead of a team (user id), from the assignments (active users only). */
export async function teamLeadOf(teamId: string, exec: Exec = execOn()): Promise<string | null> {
  const [row] = await exec<any>(
    `SELECT ra.user_id FROM role_assignments ra JOIN users u ON u.id = ra.user_id AND u.is_active = TRUE
      WHERE ra.scope_type = 'team' AND ra.scope_id = ? AND ra.role = 'team_lead' AND ra.revoked_at IS NULL LIMIT 1`,
    [teamId]
  );
  return row?.user_id ?? null;
}

/** Teams a user leads (ids and names), from the assignments. */
export async function teamsLedBy(companyId: string, userId: string, exec: Exec = execOn()): Promise<Array<{ id: string; name: string }>> {
  return exec(
    `SELECT t.id, t.name FROM role_assignments ra JOIN teams t ON t.id = ra.scope_id
      WHERE ra.company_id = ? AND ra.user_id = ? AND ra.role = 'team_lead' AND ra.scope_type = 'team' AND ra.revoked_at IS NULL
      ORDER BY t.name`,
    [companyId, userId]
  );
}

/** Active team members (users with an active assignment on the team). */
export async function teamMembers(teamId: string, exec: Exec = execOn()): Promise<any[]> {
  return exec(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.avatar_url, u.developer_insights_enabled, u.job_title,
            CASE ra.role WHEN 'team_lead' THEN 'lead' ELSE COALESCE(tm.role, 'member') END AS team_role,
            ra.role AS assignment_role,
            COALESCE(tm.joined_at, ra.created_at) AS joined_at
       FROM role_assignments ra
       JOIN users u ON u.id = ra.user_id AND u.is_active = TRUE
       LEFT JOIN team_members tm ON tm.user_id = u.id AND tm.team_id = ra.scope_id
      WHERE ra.scope_type = 'team' AND ra.scope_id = ? AND ra.revoked_at IS NULL
      ORDER BY u.first_name, u.last_name`,
    [teamId]
  );
}

/**
 * The people who WORK in a team (wellbeing pulse recipients): an active user with an active team
 * assignment who is a member of the team: a team lead or software engineer of the team, or a viewer
 * listed in team_members (e.g. the Product Owner). Stakeholders who only have read access to the
 * team (a viewer assignment without a team_members row: a Head of Product, a Finance Controller, an
 * external auditor) are not members: they are never sent the survey, cannot answer it, get no
 * reminder or pending-survey banner and are not counted in its response rate.
 */
export const PULSE_MEMBER_SQL = (userSql: string, teamSql: string) =>
  `EXISTS (SELECT 1 FROM role_assignments pra JOIN users pu ON pu.id = pra.user_id AND pu.is_active = TRUE
           WHERE pra.user_id = ${userSql} AND pra.scope_type = 'team' AND pra.scope_id = ${teamSql} AND pra.revoked_at IS NULL
             AND (pra.role <> 'viewer' OR EXISTS (SELECT 1 FROM team_members ptm WHERE ptm.user_id = pra.user_id AND ptm.team_id = pra.scope_id)))`;

/** Active members of a team who take its pulse survey (see PULSE_MEMBER_SQL). */
export async function pulseMembers(teamId: string, exec: Exec = execOn()): Promise<any[]> {
  return exec(
    `SELECT DISTINCT ON (u.first_name, u.last_name, u.id) u.id, u.email, u.first_name, u.last_name
       FROM role_assignments ra
       JOIN users u ON u.id = ra.user_id AND u.is_active = TRUE
      WHERE ra.scope_type = 'team' AND ra.scope_id = ? AND ra.revoked_at IS NULL
        AND (ra.role <> 'viewer' OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = u.id AND tm.team_id = ra.scope_id))
      ORDER BY u.first_name, u.last_name, u.id`,
    [teamId]
  );
}

/** Does this user take the team's pulse survey (a member, not only a stakeholder with read access)? */
export async function isPulseMember(teamId: string, userId: string): Promise<boolean> {
  const r = await query<any[]>(`SELECT ${PULSE_MEMBER_SQL('?', '?')} AS ok`, [userId, teamId]);
  return !!r[0]?.ok;
}

export { ROLE_SCOPE };
