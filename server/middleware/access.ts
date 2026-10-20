import { Response } from 'express';
import { queryOne } from '../../src/lib/db';
import { AuthRequest } from './auth';

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
 * Enforce READ access to a team's data. Company scope is mandatory. Beyond that,
 * super_admin and qa_manager may read any team in their company (the dashboards
 * are company-wide by design); team_lead / qa_engineer / viewer are limited to
 * their own primary team for per-team detail reads.
 * Writes the HTTP error and returns null when access is denied.
 */
export async function assertTeamRead(req: AuthRequest, res: Response, teamId?: string | null): Promise<OwnedTeam | null> {
  const team = await getOwnedTeam(req, teamId);
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return null;
  }
  const role = req.userRole;
  if (role === 'super_admin' || role === 'qa_manager') return team;
  if (req.user?.primaryTeamId && req.user.primaryTeamId === team.id) return team;
  res.status(403).json({ error: 'Access denied for this team' });
  return null;
}

/**
 * Enforce WRITE access to a team's data: super_admin (any team in company),
 * qa_manager (teams in their department), team_lead (their own team only).
 * qa_engineer and viewer may never write team data.
 * Writes the HTTP error and returns null when access is denied.
 */
export async function assertTeamWrite(req: AuthRequest, res: Response, teamId?: string | null): Promise<OwnedTeam | null> {
  const team = await getOwnedTeam(req, teamId);
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return null;
  }
  const role = req.userRole;
  if (role === 'super_admin') return team;
  if (role === 'qa_manager') {
    if (team.department_id && team.department_id === req.user?.departmentId) return team;
    res.status(403).json({ error: 'Can only manage teams in your department' });
    return null;
  }
  if (role === 'team_lead' && req.user?.primaryTeamId === team.id) return team;
  res.status(403).json({ error: 'Insufficient permissions for this team' });
  return null;
}

/** True if the role may perform company-level write/config operations. */
export function canManageCompanyData(role?: string): boolean {
  return role === 'super_admin' || role === 'qa_manager';
}
