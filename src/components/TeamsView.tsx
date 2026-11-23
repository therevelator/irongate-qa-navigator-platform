import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Users, Search, Edit2, Trash2, Plus, Bot, Building2, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Modal from './Modal';
import { confirmDeactivateTeam, showCannotDeleteWarning, showSuccess, showAlert } from '../utils/alerts';
import API_URL from '../config/api';
import { Page, PageIntro, Card, Badge, EmptyState, buttonClass, inputClass, scoreTone, toneText, cx } from './ui';
import { QA_SCORE_THRESHOLDS } from '../../server/lib/metricFormulas';
import { canManageTeam, canWriteTeamData, canManageCompanyConfig, ledTeamIds, type PolicyActor } from '../../server/lib/userPolicy';
import { policyActorOf } from '../lib/policyActor';
import { ROLE_LABELS } from '../lib/policyActor';
import ExportCsvButton from './ExportCsvButton';
import { loadErrorMessage, NETWORK_ERROR } from '../lib/loadError';

interface TeamMetrics {
  qa_score: number | null;
  test_coverage: number | null;
  defect_density: number | null;
  automation_coverage: number | null;
  deployment_frequency_per_week: number | null;
  mttr_hours: number | null;
  change_failure_rate: number | null;
  sprint_velocity: number | null;
}

interface Team {
  id: string;
  name: string;
  platform: string;
  description: string;
  department_name: string;
  department_id: string;
  is_active: boolean;
  ai_enabled?: boolean;
  /** Active members: primary team or team_members (server/lib/teamMembership). */
  member_count?: number | string | null;
  team_lead_name?: string | null;
}

interface TeamUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  is_active: boolean;
  primary_team_id: string | null;
  team_ids?: string[] | null;
}

interface TeamsViewProps {
  is3DMode?: boolean;
}

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmt = (v: unknown, digits = 0, suffix = ''): string => {
  const n = toNum(v);
  return n === null ? '—' : `${n.toFixed(digits)}${suffix}`;
};

const ROLE_LABEL = ROLE_LABELS;

const TeamsView: React.FC<TeamsViewProps> = () => {
  const { user } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', departmentId: '' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [teamMetrics, setTeamMetrics] = useState<Record<string, TeamMetrics>>({});

  const actor: PolicyActor = policyActorOf(user);

  const fetchData = async () => {
    try {
      const [teamsRes, usersRes, deptsRes] = await Promise.all([
        fetch(`${API_URL}/admin/teams`, { credentials: 'include' }),
        fetch(`${API_URL}/admin/users`, { credentials: 'include' }),
        fetch(`${API_URL}/admin/departments`, { credentials: 'include' }),
      ]);
      if (teamsRes.ok) { setTeams(await teamsRes.json()); setLoadError(null); }
      else setLoadError(await loadErrorMessage(teamsRes, 'the teams'));
      if (usersRes.ok) setUsers(await usersRes.json());
      if (deptsRes.ok) setDepartments(await deptsRes.json());
    } catch (error) {
      console.error('Error fetching data:', error);
      setLoadError(NETWORK_ERROR('the teams'));
    } finally {
      setLoading(false);
    }
  };

  const fetchTeamMetrics = async () => {
    try {
      const response = await fetch(`${API_URL}/metrics/analytics/teams`, { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      const map: Record<string, TeamMetrics> = {};
      (data.teams || []).forEach((t: any) => {
        map[t.id] = {
          qa_score: toNum(t.qa_score),
          test_coverage: toNum(t.test_coverage),
          defect_density: toNum(t.defect_density),
          automation_coverage: toNum(t.automation_coverage),
          deployment_frequency_per_week: toNum(t.deployment_frequency_per_week),
          mttr_hours: toNum(t.mttr_hours),
          change_failure_rate: toNum(t.change_failure_rate),
          sprint_velocity: toNum(t.sprint_velocity),
        };
      });
      setTeamMetrics(map);
    } catch (error) {
      console.error('Error fetching team metrics:', error);
    }
  };

  useEffect(() => { fetchData(); fetchTeamMetrics(); }, []);

  // Members: same definition as the server's member_count (an assignment on the team).
  const membersOf = (teamId: string) =>
    users.filter(u => u.is_active !== false && (u.team_ids || []).includes(teamId));

  const filteredTeams = useMemo(() => teams
    .filter(t => `${t.name} ${t.department_name || ''} ${t.platform || ''}`.toLowerCase().includes(searchTerm.toLowerCase()))
    // The teams the user can manage or write (their role assignments); engineers and viewers see all.
    .filter(t => canWriteTeamData(actor, t) || (!canManageCompanyConfig(actor) && !ledTeamIds(actor).length)),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- actor is derived from user
  [teams, searchTerm, user]);

  const canCreateTeams = canManageCompanyConfig(actor);

  const toggleAi = async (team: Team) => {
    const response = await fetch(`${API_URL}/teams/${team.id}/ai-toggle`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ enabled: !team.ai_enabled }),
    });
    if (response.ok) { toast.success(`AI suggestions ${team.ai_enabled ? 'turned off' : 'turned on'}`); fetchData(); }
    else toast.error((await response.json().catch(() => ({}))).error || 'Could not change AI suggestions');
  };

  const deleteTeam = async (team: Team) => {
    const result = await confirmDeactivateTeam(team.name);
    if (!result.isConfirmed) return;
    const response = await fetch(`${API_URL}/admin/teams/${team.id}`, { method: 'DELETE', credentials: 'include' });
    if (response.ok) { showSuccess(`${team.name} deactivated`); fetchData(); return; }
    const error = await response.json().catch(() => ({}));
    if (error.hasActiveUsers) showCannotDeleteWarning('team', `Team has ${error.userCount} active user(s).`, error.users);
    else toast.error(error.error || 'Failed to delete');
  };

  if (loading) {
    return <Page><p className="text-sm text-slate-500 dark:text-slate-400">Loading teams…</p></Page>;
  }

  return (
    <Page>
      <div data-testid="teams-page">
        <PageIntro
          title="Teams"
          description={`${filteredTeams.length} team${filteredTeams.length !== 1 ? 's' : ''} · QA score colours: ≥${QA_SCORE_THRESHOLDS.good} good, ${QA_SCORE_THRESHOLDS.warning}–${QA_SCORE_THRESHOLDS.good - 1} watch, <${QA_SCORE_THRESHOLDS.warning} critical`}
          actions={<>
            <ExportCsvButton
              what="Teams"
              rows={filteredTeams}
              columns={[
                { header: 'Team', value: (t) => t.name },
                { header: 'Department', value: (t) => t.department_name || '' },
                { header: 'Lead', value: (t) => t.team_lead_name ?? '' },
                { header: 'Members', value: (t) => toNum(t.member_count) },
                { header: 'Platform', value: (t) => t.platform || '' },
                { header: 'QA score', value: (t) => fmt(teamMetrics[t.id]?.qa_score), raw: (t) => toNum(teamMetrics[t.id]?.qa_score) },
                { header: 'Coverage', value: (t) => fmt(teamMetrics[t.id]?.test_coverage, 1, '%'), raw: (t) => toNum(teamMetrics[t.id]?.test_coverage) },
                { header: 'Automation', value: (t) => fmt(teamMetrics[t.id]?.automation_coverage, 1, '%'), raw: (t) => toNum(teamMetrics[t.id]?.automation_coverage) },
                { header: 'Defects / KLOC', value: (t) => fmt(teamMetrics[t.id]?.defect_density, 2), raw: (t) => toNum(teamMetrics[t.id]?.defect_density) },
                { header: 'Deploys / week', value: (t) => fmt(teamMetrics[t.id]?.deployment_frequency_per_week, 1), raw: (t) => toNum(teamMetrics[t.id]?.deployment_frequency_per_week) },
                { header: 'MTTR', value: (t) => fmt(teamMetrics[t.id]?.mttr_hours, 1, ' h'), raw: (t) => toNum(teamMetrics[t.id]?.mttr_hours) },
                { header: 'Change failure', value: (t) => fmt(teamMetrics[t.id]?.change_failure_rate, 1, '%'), raw: (t) => toNum(teamMetrics[t.id]?.change_failure_rate) },
                { header: 'Velocity', value: (t) => fmt(teamMetrics[t.id]?.sprint_velocity), raw: (t) => toNum(teamMetrics[t.id]?.sprint_velocity) },
                { header: 'Active', value: (t) => (t.is_active ? 'yes' : 'no') },
              ]}
            />
            {canCreateTeams && (
            <button
              onClick={() => { setEditForm({ name: '', description: '', departmentId: user?.departmentId || '' }); setShowCreateModal(true); }}
              className={buttonClass.primary}
              data-testid="add-team-btn"
            >
              <Plus size={15} /> Create team
            </button>
            )}
          </>}
        />

        <div className="relative mb-4">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search teams"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={cx(inputClass, 'w-full pl-8 sm:w-72')}
          />
        </div>

{loadError && (
          <div role="alert" data-testid="load-error" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {loadError}
          </div>
        )}
        {loadError ? null : filteredTeams.length === 0 ? (
          <Card><EmptyState icon={<Building2 size={28} />} title="No teams found" description="Adjust the search term." /></Card>
        ) : (
          <div className="space-y-3">
            {filteredTeams.map(team => {
              const metrics = teamMetrics[team.id];
              const members = membersOf(team.id);
              const memberCount = toNum(team.member_count) ?? members.filter(m => m.is_active).length;
              const isExpanded = expanded.has(team.id);
              const qaTone = scoreTone(metrics?.qa_score ?? null, QA_SCORE_THRESHOLDS.good, QA_SCORE_THRESHOLDS.warning);
              const manage = canManageTeam(actor, team);
              const writeData = canWriteTeamData(actor, team);

              return (
                <Card key={team.id} padded={false}>
                  <div data-testid="team-row" data-team-id={team.id} data-team-name={team.name} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-brand-50 text-sm font-semibold text-brand-800 dark:bg-slate-800 dark:text-brand-200">
                        {team.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{team.name}</h3>
                          <Badge tone={team.is_active ? 'good' : 'neutral'}>{team.is_active ? 'Active' : 'Inactive'}</Badge>
                          {team.ai_enabled && <Badge tone="brand"><Bot size={11} /> AI suggestions</Badge>}
                          <span data-testid="team-ai-status" className="sr-only">{team.ai_enabled ? 'AI suggestions on' : 'AI suggestions off'}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {team.department_name || 'No department'}
                          {team.team_lead_name ? ` · Lead: ${team.team_lead_name}` : ''}
                          {team.platform ? ` · ${team.platform}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      <div className="text-right">
                        <p className={cx('text-lg font-semibold tabular-nums', metrics?.qa_score != null ? toneText(qaTone) : 'text-slate-400')}>{fmt(metrics?.qa_score)}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">QA score</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">{memberCount}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Active members</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(team.id) ? n.delete(team.id) : n.add(team.id); return n; })}
                          className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                          title={isExpanded ? 'Hide details' : 'Show details'}
                          aria-label={isExpanded ? 'Hide details' : 'Show details'}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                        {writeData && (
                          <button onClick={() => toggleAi(team)} className={cx('rounded-md p-2 hover:bg-slate-100 dark:hover:bg-slate-800', team.ai_enabled ? 'text-brand-700 dark:text-brand-300' : 'text-slate-400')} title={team.ai_enabled ? 'Turn AI suggestions off' : 'Turn AI suggestions on'} aria-label="Toggle AI suggestions" data-testid="team-ai-toggle">
                            <Bot size={16} />
                          </button>
                        )}
                        {manage && (
                          <>
                            <button
                              onClick={() => { setSelectedTeam(team); setEditForm({ name: team.name, description: team.description || '', departmentId: team.department_id }); setShowEditModal(true); }}
                              className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                              title="Edit" aria-label="Edit team" data-testid="edit-team-btn"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button onClick={() => deleteTeam(team)} className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-400" title="Delete" aria-label="Delete team" data-testid="delete-team-btn">
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="grid grid-cols-1 gap-4 border-t border-slate-100 p-4 dark:border-slate-800 sm:p-5 lg:grid-cols-2">
                      <div>
                        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Latest KPI snapshot</h4>
                        {metrics ? (
                          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {[
                              { label: 'Coverage', value: fmt(metrics.test_coverage, 1, '%') },
                              { label: 'Automation', value: fmt(metrics.automation_coverage, 1, '%') },
                              { label: 'Defects / KLOC', value: fmt(metrics.defect_density, 2) },
                              { label: 'Deploys / week', value: fmt(metrics.deployment_frequency_per_week, 1) },
                              { label: 'MTTR', value: fmt(metrics.mttr_hours, 1, ' h') },
                              { label: 'Change failure', value: fmt(metrics.change_failure_rate, 1, '%') },
                              { label: 'Velocity', value: fmt(metrics.sprint_velocity) },
                            ].map(m => (
                              <div key={m.label} className="rounded-md border border-slate-200 p-2.5 dark:border-slate-800">
                                <dt className="text-xs text-slate-500 dark:text-slate-400">{m.label}</dt>
                                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{m.value}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          <p className="text-sm text-slate-500 dark:text-slate-400">No metrics recorded</p>
                        )}
                      </div>
                      <div>
                        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          <Users size={13} /> Members you can see ({members.length})
                        </h4>
                        {members.length === 0 ? (
                          <p className="text-sm text-slate-500 dark:text-slate-400">No members visible to you</p>
                        ) : (
                          <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                            {members.map(m => (
                              <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{m.first_name} {m.last_name}</p>
                                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{m.email} · {ROLE_LABEL[m.role] ?? m.role}{m.primary_team_id !== team.id ? ' · secondary team' : ''}</p>
                                </div>
                                <Badge tone={m.is_active ? 'good' : 'neutral'}>{m.is_active ? 'Active' : 'Inactive'}</Badge>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title={`Edit: ${selectedTeam?.name}`} size="md">
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (teams.find(t => t.name.toLowerCase() === editForm.name.toLowerCase() && t.id !== selectedTeam?.id)) {
            showAlert('Name in use', `"${editForm.name}" already exists.`, 'error'); return;
          }
          const response = await fetch(`${API_URL}/admin/teams/${selectedTeam?.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name: editForm.name, description: editForm.description || null }) });
          if (response.ok) { setShowEditModal(false); toast.success('Team updated'); fetchData(); }
          else toast.error((await response.json().catch(() => ({}))).error || 'Update failed');
        }}>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Name</span>
              <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={cx(inputClass, 'w-full')} required />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Description</span>
              <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={3} className={cx(inputClass, 'h-auto w-full py-2')} />
            </label>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={() => setShowEditModal(false)} className={buttonClass.secondary}>Cancel</button>
            <button type="submit" className={buttonClass.primary}>Save</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create team" size="md">
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (teams.find(t => t.name.toLowerCase() === editForm.name.toLowerCase())) {
            showAlert('Name in use', `"${editForm.name}" already exists.`, 'error'); return;
          }
          const response = await fetch(`${API_URL}/admin/teams`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name: editForm.name, description: editForm.description || null, departmentId: editForm.departmentId }) });
          if (response.ok) { setShowCreateModal(false); setEditForm({ name: '', description: '', departmentId: '' }); toast.success('Team created'); fetchData(); }
          else toast.error((await response.json().catch(() => ({}))).error || 'Create failed');
        }}>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Name</span>
              <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={cx(inputClass, 'w-full')} required placeholder="Team name" data-testid="team-name-input" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Department</span>
              <select
                value={editForm.departmentId}
                onChange={(e) => setEditForm({ ...editForm, departmentId: e.target.value })}
                className={cx(inputClass, 'w-full pr-8')}
                required
                disabled={user?.role !== 'super_admin'}
                title={user?.role !== 'super_admin' ? 'Teams are created in your department' : undefined}
              >
                <option value="">Select department</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Description</span>
              <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={3} className={cx(inputClass, 'h-auto w-full py-2')} placeholder="Description" data-testid="team-description-input" />
            </label>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={() => setShowCreateModal(false)} className={buttonClass.secondary}>Cancel</button>
            <button type="submit" className={buttonClass.primary} data-testid="create-team-btn"><Plus size={15} /> Create</button>
          </div>
        </form>
      </Modal>
    </Page>
  );
};

export default TeamsView;
