import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Users, Search, Edit2, Trash2, UserPlus, Save, Bot, Building2, ChevronDown, ChevronUp, UserCheck, UserX, BarChart3 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import Modal from './Modal';
import { confirmDelete, showCannotDeleteWarning, showSuccess, showAlert } from '../utils/alerts';
import API_URL from '../config/api';

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
}

interface TeamsViewProps {
  is3DMode?: boolean;
}

const TeamsView: React.FC<TeamsViewProps> = ({ is3DMode = true }) => {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', departmentId: '' });
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(new Set());
  const [teamMetrics, setTeamMetrics] = useState<Record<string, TeamMetrics>>({});

  useEffect(() => {
    fetchData();
    fetchTeamMetrics();
  }, []);

  const fetchData = async () => {
    try {
      const [teamsRes, usersRes, deptsRes] = await Promise.all([
        fetch(`${API_URL}/admin/teams`, { credentials: 'include' }),
        fetch(`${API_URL}/admin/users`, { credentials: 'include' }),
        fetch(`${API_URL}/admin/departments`, { credentials: 'include' })
      ]);

      if (teamsRes.ok) setTeams(await teamsRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
      if (deptsRes.ok) setDepartments(await deptsRes.json());
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTeamMetrics = async () => {
    try {
      const response = await fetch(`${API_URL}/metrics/analytics/teams`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        const metricsMap: Record<string, TeamMetrics> = {};
        (data.teams || []).forEach((t: any) => {
          metricsMap[t.id] = {
            qa_score: t.qa_score,
            test_coverage: t.test_coverage,
            defect_density: t.defect_density,
            automation_coverage: t.automation_coverage,
            deployment_frequency_per_week: t.deployment_frequency_per_week,
            mttr_hours: t.mttr_hours,
            change_failure_rate: t.change_failure_rate,
            sprint_velocity: t.sprint_velocity
          };
        });
        setTeamMetrics(metricsMap);
      }
    } catch (error) {
      console.error('Error fetching team metrics:', error);
    }
  };

  const getTeamUserCounts = (teamId: string) => {
    const teamUsers = users.filter(u => u.primary_team_id === teamId);
    const activeUsers = teamUsers.filter(u => u.is_active);
    return { total: teamUsers.length, active: activeUsers.length };
  };

  const getTeamUsers = (teamId: string) => users.filter(u => u.primary_team_id === teamId);

  const toggleTeamExpanded = (teamId: string) => {
    setExpandedTeamIds(prev => {
      const newSet = new Set(prev);
      newSet.has(teamId) ? newSet.delete(teamId) : newSet.add(teamId);
      return newSet;
    });
  };

  const filteredTeams = teams.filter(t =>
    `${t.name} ${t.department_name || ''} ${t.platform}`.toLowerCase().includes(searchTerm.toLowerCase())
  ).filter(t => {
    if (user?.role === 'super_admin') return true;
    if (user?.role === 'qa_manager') return t.department_id === user.departmentId;
    if (user?.role === 'team_lead') return t.id === user.primaryTeamId;
    return true;
  });

  const canManageTeam = (teamId: string) => {
    if (user?.role === 'super_admin' || user?.role === 'qa_manager') return true;
    if (user?.role === 'team_lead' && teamId === user.primaryTeamId) return true;
    return false;
  };

  const canCreateTeams = user?.role === 'super_admin' || user?.role === 'qa_manager';

  const formatMetric = (value: any, decimals: number = 0): string => {
    if (value === null || value === undefined) return '—';
    const num = Number(value);
    return isNaN(num) ? '—' : num.toFixed(decimals);
  };

  const getTeamGradient = (teamId: string) => {
    const gradients = ['from-cyan-500 to-blue-600', 'from-purple-500 to-pink-600', 'from-green-500 to-teal-600', 'from-orange-500 to-red-600', 'from-indigo-500 to-purple-600', 'from-teal-500 to-cyan-600', 'from-rose-500 to-orange-600', 'from-blue-500 to-indigo-600'];
    return gradients[parseInt(teamId.replace(/\D/g, ''), 10) % gradients.length || 0];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-slate-950">
        <div className="text-gray-500 dark:text-slate-400">Loading teams...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8" data-testid="teams-page">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-xl ${is3DMode ? 'bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/30' : 'bg-cyan-600'}`}>
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Teams</h1>
              <p className="text-sm text-gray-500 dark:text-slate-400">{filteredTeams.length} team{filteredTeams.length !== 1 ? 's' : ''}</p>
            </div>
          </div>

          {canCreateTeams && (
            <button
              onClick={() => { setEditForm({ name: '', description: '', departmentId: user?.departmentId || '' }); setShowCreateModal(true); }}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 text-white rounded-lg transition-all w-full sm:w-auto ${is3DMode
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 shadow-lg shadow-cyan-500/30'
                : 'bg-cyan-600 hover:bg-cyan-700'}`}
              data-testid="add-team-btn"
            >
              <UserPlus size={18} />
              Create Team
            </button>
          )}
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-slate-500" size={20} />
            <input
              type="text"
              placeholder="Search teams..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all"
            />
          </div>
        </div>

        {/* Teams List */}
        {filteredTeams.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-8 sm:p-12 text-center border border-gray-200 dark:border-slate-700">
            <Building2 className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 text-gray-300 dark:text-slate-600" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No teams found</h3>
            <p className="text-gray-500 dark:text-slate-400">Try adjusting your search criteria</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredTeams.map((team) => {
              const counts = getTeamUserCounts(team.id);
              const metrics = teamMetrics[team.id];
              const isExpanded = expandedTeamIds.has(team.id);

              return (
                <div
                  key={team.id}
                  data-testid="team-row"
                  data-team-id={team.id}
                  data-team-name={team.name}
                  className={`bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden transition-all ${is3DMode ? 'shadow-md hover:shadow-lg' : ''}`}
                >
                  {/* Main Row */}
                  <div className="p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      {/* Avatar + Info */}
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl flex-shrink-0 flex items-center justify-center text-white font-bold text-base sm:text-lg ${is3DMode ? `bg-gradient-to-br ${getTeamGradient(team.id)} shadow-lg` : 'bg-cyan-600'}`}>
                          {team.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-gray-900 dark:text-white truncate">{team.name}</h3>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${team.is_active
                              ? is3DMode ? 'bg-green-500/20 text-green-400' : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                              : is3DMode ? 'bg-red-500/20 text-red-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${team.is_active ? 'bg-green-500' : 'bg-red-500'}`}></span>
                              {team.is_active ? 'Active' : 'Inactive'}
                            </span>
                            {team.ai_enabled && (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${is3DMode ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'}`}>
                                <Bot size={10} /> AI
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 dark:text-slate-400 flex-wrap">
                            <span>📁 {team.department_name || 'No department'}</span>
                            {team.platform && <span className="text-xs">🛠️ {team.platform}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Stats + Actions */}
                      <div className="flex items-center gap-3 sm:gap-4 justify-between sm:justify-end">
                        {/* QA Score */}
                        {metrics?.qa_score !== null && metrics?.qa_score !== undefined && (
                          <div className="px-3 py-1 rounded-lg bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-center">
                            <p className={`text-lg sm:text-xl font-bold ${Number(metrics.qa_score) >= 80 ? 'text-green-600 dark:text-green-400' : Number(metrics.qa_score) >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                              {formatMetric(metrics.qa_score)}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-slate-400">QA</p>
                          </div>
                        )}

                        {/* User Counts */}
                        <div className="flex gap-3">
                          <div className="text-center">
                            <p className="text-lg sm:text-xl font-bold text-cyan-600 dark:text-cyan-400">{counts.active}</p>
                            <p className="text-xs text-gray-500 dark:text-slate-400">Active</p>
                          </div>
                          <div className="text-center">
                            <p className="text-lg sm:text-xl font-bold text-gray-600 dark:text-slate-300">{counts.total}</p>
                            <p className="text-xs text-gray-500 dark:text-slate-400">Total</p>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1">
                          <button onClick={() => toggleTeamExpanded(team.id)} className={`p-2 rounded-lg transition-colors ${isExpanded ? 'text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/20' : 'text-gray-400 dark:text-slate-500 hover:text-cyan-600 hover:bg-gray-100 dark:hover:bg-slate-700'}`} title={isExpanded ? 'Hide details' : 'View details'}>
                            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                          </button>
                          {canManageTeam(team.id) && (
                            <>
                              <button onClick={async () => {
                                const response = await fetch(`${API_URL}/teams/${team.id}/ai-toggle`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ enabled: !team.ai_enabled }) });
                                if (response.ok) { toast.success(`AI ${team.ai_enabled ? 'disabled' : 'enabled'}`); fetchData(); }
                              }} className={`p-2 rounded-lg transition-colors ${team.ai_enabled ? 'text-purple-500' : 'text-gray-400 hover:text-purple-500'}`} title="Toggle AI">
                                <Bot size={18} />
                              </button>
                              <button onClick={() => { setSelectedTeam(team); setEditForm({ name: team.name, description: team.description || '', departmentId: team.department_id }); setShowEditModal(true); }} className="p-2 text-gray-400 hover:text-cyan-600 rounded-lg transition-colors" title="Edit">
                                <Edit2 size={18} />
                              </button>
                            </>
                          )}
                          {canManageTeam(team.id) && (user?.role === 'super_admin' || user?.role === 'qa_manager') && (
                            <button onClick={async () => {
                              const result = await confirmDelete(team.name, 'team');
                              if (result.isConfirmed) {
                                const response = await fetch(`${API_URL}/admin/teams/${team.id}`, { method: 'DELETE', credentials: 'include' });
                                if (response.ok) { showSuccess(`${team.name} deactivated`); fetchData(); }
                                else {
                                  const error = await response.json();
                                  if (error.hasActiveUsers) showCannotDeleteWarning('team', `Team has ${error.userCount} active user(s).`, error.users);
                                  else toast.error(error.error || 'Failed to delete');
                                }
                              }
                            }} className="p-2 text-gray-400 hover:text-red-500 rounded-lg transition-colors" title="Delete">
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Section */}
                  {isExpanded && (
                    <div className="px-4 pb-4 sm:px-5 sm:pb-5 space-y-4 border-t border-gray-100 dark:border-slate-700 pt-4">
                      {/* Metrics Grid */}
                      <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                          <BarChart3 size={16} /> Team Metrics
                        </h4>
                        {metrics?.qa_score !== null ? (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                            {[
                              { label: 'QA Score', value: formatMetric(metrics?.qa_score), color: Number(metrics?.qa_score || 0) >= 80 ? 'text-green-600' : Number(metrics?.qa_score || 0) >= 60 ? 'text-amber-600' : 'text-red-600' },
                              { label: 'Coverage', value: `${formatMetric(metrics?.test_coverage)}%`, color: 'text-cyan-600' },
                              { label: 'Automation', value: `${formatMetric(metrics?.automation_coverage)}%`, color: 'text-purple-600' },
                              { label: 'Defect Density', value: formatMetric(metrics?.defect_density, 2), color: 'text-orange-600' },
                              { label: 'Deploy/Week', value: formatMetric(metrics?.deployment_frequency_per_week, 1), color: 'text-blue-600' },
                              { label: 'MTTR', value: `${formatMetric(metrics?.mttr_hours, 1)}h`, color: 'text-teal-600' },
                              { label: 'Failure Rate', value: `${formatMetric(metrics?.change_failure_rate)}%`, color: 'text-rose-600' },
                              { label: 'Velocity', value: formatMetric(metrics?.sprint_velocity), color: 'text-indigo-600' }
                            ].map((m, i) => (
                              <div key={i} className="bg-white dark:bg-slate-800 rounded-lg p-2 sm:p-3 text-center border border-gray-200 dark:border-slate-700">
                                <p className={`text-lg sm:text-xl font-bold ${m.color} dark:opacity-90`}>{m.value}</p>
                                <p className="text-xs text-gray-500 dark:text-slate-400">{m.label}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 dark:text-slate-400 italic">No metrics available</p>
                        )}
                      </div>

                      {/* Team Members */}
                      <div className="bg-gray-50 dark:bg-slate-900 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                          <Users size={16} /> Members ({counts.total})
                        </h4>
                        {getTeamUsers(team.id).length === 0 ? (
                          <p className="text-sm text-gray-500 dark:text-slate-400 italic">No members</p>
                        ) : (
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {getTeamUsers(team.id).map((m: any) => (
                              <div key={m.id} className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
                                <div className="flex items-center gap-3">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium ${is3DMode ? 'bg-gradient-to-br from-cyan-500 to-blue-600' : 'bg-cyan-600'}`}>
                                    {m.first_name?.charAt(0)}{m.last_name?.charAt(0)}
                                  </div>
                                  <div>
                                    <p className="text-sm font-medium text-gray-900 dark:text-white">{m.first_name} {m.last_name}</p>
                                    <p className="text-xs text-gray-500 dark:text-slate-400">{m.email}</p>
                                  </div>
                                </div>
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${m.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
                                  {m.is_active ? <UserCheck size={10} /> : <UserX size={10} />}
                                  {m.is_active ? 'Active' : 'Inactive'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title={`Edit: ${selectedTeam?.name}`} size="md">
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (teams.find(t => t.name.toLowerCase() === editForm.name.toLowerCase() && t.id !== selectedTeam?.id)) {
            showAlert('Name in Use', `"${editForm.name}" already exists.`, 'error'); return;
          }
          const response = await fetch(`${API_URL}/admin/teams/${selectedTeam?.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name: editForm.name, description: editForm.description || null }) });
          if (response.ok) { setShowEditModal(false); toast.success('Updated!'); fetchData(); }
          else toast.error('Update failed');
        }}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Name</label>
              <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Description</label>
              <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={3} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-gray-300">Cancel</button>
            <button type="submit" className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md"><Save size={18} /> Save</button>
          </div>
        </form>
      </Modal>

      {/* Create Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create Team" size="md">
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (teams.find(t => t.name.toLowerCase() === editForm.name.toLowerCase())) {
            showAlert('Name in Use', `"${editForm.name}" already exists.`, 'error'); return;
          }
          const response = await fetch(`${API_URL}/admin/teams`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ name: editForm.name, description: editForm.description || null, departmentId: editForm.departmentId }) });
          if (response.ok) { setShowCreateModal(false); setEditForm({ name: '', description: '', departmentId: '' }); toast.success('Created!'); fetchData(); }
          else toast.error('Create failed');
        }}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Name</label>
              <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white" required placeholder="Team name" data-testid="team-name-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Department</label>
              <select value={editForm.departmentId} onChange={(e) => setEditForm({ ...editForm, departmentId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white" required>
                <option value="">Select department</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Description</label>
              <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={3} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white" placeholder="Description" data-testid="team-description-input" />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-gray-300">Cancel</button>
            <button type="submit" className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md" data-testid="create-team-btn"><UserPlus size={18} /> Create</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default TeamsView;
