import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import API_URL from '../config/api';
import { useAuth } from './AuthContext';
import {
  canViewIndividualDevelopers,
  canWriteTeamData,
  type AnalyticsScopeLevel,
  type PolicyActor,
} from '../../server/lib/userPolicy';

/**
 * Analytics scope: the department + team every Analytics module shows.
 *
 * The list of selectable teams comes from GET /api/analytics/scope, which applies the shared
 * rule in server/lib/userPolicy.ts (super_admin: any team of the company; qa_manager: the
 * teams of their department; team_lead / qa_engineer / viewer: their own team). The server
 * enforces the same rule on every analytics endpoint, so this context only decides what to
 * offer and remember.
 *
 * The selection persists across modules (one provider for the app), is kept in the URL
 * (?team=<id>) on Analytics pages, and the last choice is stored in localStorage. There is
 * always exactly one team when anything is in scope: no "all teams" option.
 */

export interface AnalyticsScopeTeam {
  id: string;
  name: string;
  department_id: string | null;
  department_name: string | null;
}

export interface AnalyticsScopeDepartment {
  id: string;
  name: string;
}

interface AnalyticsScopeValue {
  loading: boolean;
  error: string | null;
  level: AnalyticsScopeLevel;
  departments: AnalyticsScopeDepartment[];
  teams: AnalyticsScopeTeam[];
  /** Teams of the selected department (what the Team select offers). */
  teamsInDepartment: AnalyticsScopeTeam[];
  departmentId: string | null;
  teamId: string | null;
  team: AnalyticsScopeTeam | null;
  /** Department selector editable (super_admin only). */
  canChangeDepartment: boolean;
  /** Team selector editable (super_admin, qa_manager). */
  canChangeTeam: boolean;
  /** May the user see other developers' individual rows for the selected team? */
  canViewIndividuals: boolean;
  /** May the user change the selected team's data (business impact entry etc.)? */
  canWriteTeam: boolean;
  setDepartmentId: (departmentId: string) => void;
  setTeamId: (teamId: string) => void;
  reload: () => void;
}

const AnalyticsScopeContext = createContext<AnalyticsScopeValue | undefined>(undefined);

export const URL_TEAM_PARAM = 'team';
const storageKey = (userId: string) => `irongate.analytics.team.${userId}`;

function readStoredTeam(userId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

function storeTeam(userId: string, teamId: string) {
  try {
    window.localStorage.setItem(storageKey(userId), teamId);
  } catch {
    /* storage unavailable (private mode, blocked): the selection still lives in the URL */
  }
}

function readUrlTeam(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(URL_TEAM_PARAM) || params.get('teamId'); // teamId: links made before ?team=
  } catch {
    return null;
  }
}

/** Write ?team= into the current URL on Analytics pages (replaceState: no extra history entry). */
function writeUrlTeam(teamId: string) {
  if (!window.location.pathname.startsWith('/analytics')) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get(URL_TEAM_PARAM) === teamId && !params.has('teamId')) return;
  params.delete('teamId');
  params.set(URL_TEAM_PARAM, teamId);
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
}

export const AnalyticsScopeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<AnalyticsScopeLevel>('none');
  const [departments, setDepartments] = useState<AnalyticsScopeDepartment[]>([]);
  const [teams, setTeams] = useState<AnalyticsScopeTeam[]>([]);
  const [teamId, setTeamIdState] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!user?.id) {
      setTeams([]);
      setDepartments([]);
      setTeamIdState(null);
      setLevel('none');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API_URL}/analytics/scope`, { credentials: 'include' });
        if (!res.ok) throw new Error(res.status === 403 ? 'Analytics is not available for your role.' : `Could not load your analytics scope (${res.status}).`);
        const data = await res.json();
        if (cancelled) return;
        const list: AnalyticsScopeTeam[] = data.teams || [];
        setLevel(data.level || 'none');
        setDepartments(data.departments || []);
        setTeams(list);
        const inScope = (id: string | null) => (id && list.some((t) => t.id === id) ? id : null);
        const fromUrl = inScope(readUrlTeam());
        // A link with ?team= counts as a choice: remember it like a selection.
        if (fromUrl) storeTeam(user.id, fromUrl);
        const chosen = fromUrl ?? inScope(readStoredTeam(user.id)) ?? (data.defaultTeamId as string | null) ?? null;
        setTeamIdState(chosen);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Could not load your analytics scope.');
          setTeams([]);
          setDepartments([]);
          setTeamIdState(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, user?.role, user?.departmentId, user?.primaryTeamId, nonce]);

  // Keep the URL in step with the selection; follow back/forward to a link with another team.
  useEffect(() => {
    if (teamId) writeUrlTeam(teamId);
  });
  useEffect(() => {
    const onPop = () => {
      const fromUrl = readUrlTeam();
      if (fromUrl && teams.some((t) => t.id === fromUrl)) setTeamIdState(fromUrl);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [teams]);

  const setTeamId = useCallback((id: string) => {
    if (!teams.some((t) => t.id === id)) return;
    setTeamIdState(id);
    if (user?.id) storeTeam(user.id, id);
    writeUrlTeam(id);
  }, [teams, user?.id]);

  const team = useMemo(() => teams.find((t) => t.id === teamId) ?? null, [teams, teamId]);
  const departmentId = team?.department_id ?? null;
  const teamsInDepartment = useMemo(
    () => teams.filter((t) => (t.department_id ?? null) === departmentId),
    [teams, departmentId],
  );

  const setDepartmentId = useCallback((deptId: string) => {
    const inDept = teams.filter((t) => t.department_id === deptId);
    if (!inDept.length) return;
    const preferred = inDept.find((t) => t.id === user?.primaryTeamId) ?? inDept[0];
    setTeamId(preferred.id);
  }, [teams, user?.primaryTeamId, setTeamId]);

  const actor: PolicyActor | null = user
    ? { id: String(user.id), role: user.role, departmentId: user.departmentId ?? null, primaryTeamId: user.primaryTeamId ?? null }
    : null;
  const policyTeam = team ? { id: team.id, department_id: team.department_id } : null;

  const value: AnalyticsScopeValue = {
    loading,
    error,
    level,
    departments,
    teams,
    teamsInDepartment,
    departmentId,
    teamId: team ? team.id : null,
    team,
    canChangeDepartment: level === 'company' && departments.length > 1,
    canChangeTeam: (level === 'company' || level === 'department') && teams.length > 1,
    canViewIndividuals: !!(actor && policyTeam && canViewIndividualDevelopers(actor, policyTeam)),
    canWriteTeam: !!(actor && policyTeam && canWriteTeamData(actor, policyTeam)),
    setDepartmentId,
    setTeamId,
    reload: () => setNonce((n) => n + 1),
  };

  return <AnalyticsScopeContext.Provider value={value}>{children}</AnalyticsScopeContext.Provider>;
};

export function useAnalyticsScope(): AnalyticsScopeValue {
  const ctx = useContext(AnalyticsScopeContext);
  if (!ctx) throw new Error('useAnalyticsScope must be used within an AnalyticsScopeProvider');
  return ctx;
}
