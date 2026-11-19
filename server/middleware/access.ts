import { Response } from 'express';
import { queryOne } from '../../src/lib/db';
import { AuthRequest } from './auth';
import { canViewTeamAnalytics, canReadTeamDetail, canWriteTeamData, canWriteSomeTeamData, canManageTeam, canManageCompanyConfig, type PolicyActor } from '../lib/userPolicy';

/**
 * Tenant / team access helpers.
 *
 * The hard security boundary is the company (tenant). Every handler that takes a
 * teamId from the URL, query, or body must confirm the team belongs to the
 * caller's company before reading or writing its data. These helpers centralise
 * that check so a single place enforces it.
 */

export interface OwnedTeam {
  id: string;
  company_id: string;
  department_id: string | null;
  name: string;
  lead_id: string | null;
  is_active: boolean;
}

/** Returns the team row only if it belongs to the caller's company, else null. */
export async function getOwnedTeam(req: AuthRequest, teamId?: string | null): Promise<OwnedTeam | null> {
  if (!teamId || typeof teamId !== 'string') return null;
  return queryOne<OwnedTeam>(
    'SELECT id, company_id, department_id, name, lead_id, is_active FROM teams WHERE id = ? AND company_id = ?',
    [teamId, req.companyId]
  );
}

/**
 * Enforce READ access to a team's per-team detail data. Company scope is mandatory. Beyond
 * that the shared rule canReadTeamDetail (server/lib/userPolicy.ts): super_admin and QA
 * managers read any team in their company (the dashboards are company-wide by design);
 * everyone else the teams they are assigned to.
 * Writes the HTTP error and returns null when access is denied.
 */
export async function assertTeamRead(req: AuthRequest, res: Response, teamId?: string | null): Promise<OwnedTeam | null> {
  const team = await getOwnedTeam(req, teamId);
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return null;
  }
  if (canReadTeamDetail(policyActor(req), team)) return team;
  res.status(403).json({ error: 'Access denied for this team' });
  return null;
}

/**
 * Enforce WRITE access to a team's data (canWriteTeamData): super_admin (any team in company),
 * QA managers (teams of the departments they manage), team leads (the teams they lead).
 * qa_engineer and viewer may never write team data.
 * Writes the HTTP error and returns null when access is denied.
 */
export async function assertTeamWrite(req: AuthRequest, res: Response, teamId?: string | null): Promise<OwnedTeam | null> {
  // Someone who may write no team's data is refused before the team (or anything else) is looked up.
  if (!assertSomeTeamWrite(req, res)) return null;
  const team = await getOwnedTeam(req, teamId);
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return null;
  }
  const actor = policyActor(req);
  if (canWriteTeamData(actor, team)) return team;
  if (canManageCompanyConfig(actor) && !canManageTeam(actor, team)) {
    res.status(403).json({ error: 'Can only manage teams in your department' });
    return null;
  }
  res.status(403).json({ error: 'Insufficient permissions for this team' });
  return null;
}

/** The caller as a PolicyActor (live assignments and display columns from authenticateToken). */
export function policyActor(req: AuthRequest): PolicyActor {
  return {
    // IronGate platform support acting in a company (server/lib/platformContext.ts) has no user
    // id: null, so actor ids written to the database (created_by, ...) stay empty, not ''.
    id: req.user ? (req.user.id as string) : '',
    role: req.user?.role ?? '',
    departmentId: req.user?.departmentId ?? null,
    primaryTeamId: req.user?.primaryTeamId ?? null,
    grants: req.user?.grants ?? [],
  };
}

/**
 * Enforce ANALYTICS access to one team (the shared rule canViewTeamAnalytics in
 * server/lib/userPolicy.ts): super_admin any team of their company, a QA manager the teams
 * of the departments they manage, team_lead / qa_engineer / viewer the teams they are
 * assigned to.
 * A team of another company, an unknown id and an out-of-scope team all get the same
 * 403, so the response does not reveal whether a team exists elsewhere.
 * Writes the HTTP error and returns null when access is denied.
 */
export async function assertTeamAnalytics(req: AuthRequest, res: Response, teamId?: string | null): Promise<OwnedTeam | null> {
  const team = await getOwnedTeam(req, teamId);
  if (!team || !canViewTeamAnalytics(policyActor(req), team)) {
    res.status(403).json({ error: 'Access denied. This team is outside your analytics scope.' });
    return null;
  }
  return team;
}

/**
 * True if the caller may perform company-level write/config operations (super_admin, or a QA
 * manager of any department). Takes the request (assignments); a role string is accepted for
 * older call sites and checked against the caller's highest role.
 */
export function canManageCompanyData(reqOrRole?: AuthRequest | string): boolean {
  if (typeof reqOrRole === 'object' && reqOrRole) return canManageCompanyConfig(policyActor(reqOrRole));
  return reqOrRole === 'super_admin' || reqOrRole === 'qa_manager';
}

/**
 * Permission gate that runs before a team-data write looks at its body (FI-15): the caller must be
 * allowed to write the data of at least one team (canWriteSomeTeamData), else 403. Answers and
 * returns false when refused.
 */
export function assertSomeTeamWrite(req: AuthRequest, res: Response): boolean {
  if (canWriteSomeTeamData(policyActor(req))) return true;
  res.status(403).json({ error: 'Insufficient permissions for this team' });
  return false;
}
