import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Users, Search, Edit2, Key, Trash2, UserPlus, Save, UserCheck, UserX, Bot, ChevronDown, ChevronUp, GitPullRequest, Clock, Zap, TrendingUp, LayoutGrid, List } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import Modal from './Modal';
import { confirmDelete } from '../utils/alerts';
import BatteryIndicator from './BatteryIndicator';
import { METRIC_EXPLANATIONS } from './TeamDetailView';

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  team_name: string;
  department_name: string;
  department_id: string;
  primary_team_id: string;
  is_active: boolean;
  developer_insights_enabled?: boolean;
}

interface DeveloperMetrics {
  pr_merge_time_avg: number;
  code_review_time_avg: number;
  focus_time_hours: number;
  meeting_time_hours: number;
  context_switches_per_day: number;
  happiness_score: number;
}

import API_URL from '../config/api';

interface UsersViewProps {
  is3DMode?: boolean;
}

const UsersView: React.FC<UsersViewProps> = ({ is3DMode = true }) => {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [expandedUserIds, setExpandedUserIds] = useState<Set<string>>(new Set());
  const [userMetrics, setUserMetrics] = useState<Record<string, DeveloperMetrics>>({});
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [gridColumns, setGridColumns] = useState<2 | 3 | 4>(3);
  const [currentPage, setCurrentPage] = useState(1);
  const usersPerPage = gridColumns * 3; // 3 rows per page
  const [userForm, setUserForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: '',
    departmentId: '',
    primaryTeamId: '',
    password: ''
  });

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const [usersRes, teamsRes, deptsRes, rolesRes] = await Promise.all([
        fetch(`${API_URL}/admin/users`, { credentials: 'include' }),
        fetch(`${API_URL}/admin/teams`, { credentials: 'include' }),
        fetch(`${API_URL}/admin/departments`, { credentials: 'include' }),
        fetch(`${API_URL}/admin/available-roles`, { credentials: 'include' })
      ]);

      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data);
      }
      if (teamsRes.ok) {
        const data = await teamsRes.json();
        setTeams(data);
      }
      if (deptsRes.ok) {
        const data = await deptsRes.json();
        setDepartments(data);
      }
      if (rolesRes.ok) {
        const data = await rolesRes.json();
        const rolesList = data.availableRoles || [];
        setRoles(rolesList.map((r: string) => ({
          id: r,
          name: r.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        })));
      } else {
        setRoles([
          { id: 'super_admin', name: 'Super Admin' },
          { id: 'qa_manager', name: 'QA Manager' },
          { id: 'team_lead', name: 'Team Lead' },
          { id: 'qa_engineer', name: 'QA Engineer' },
          { id: 'viewer', name: 'Viewer' }
        ]);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      setRoles([
        { id: 'super_admin', name: 'Super Admin' },
        { id: 'qa_manager', name: 'QA Manager' },
        { id: 'team_lead', name: 'Team Lead' },
        { id: 'qa_engineer', name: 'QA Engineer' },
        { id: 'viewer', name: 'Viewer' }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserMetrics = async (userId: string) => {
    if (userMetrics[userId] !== undefined) return; // Already fetched (including null for no metrics)

    try {
      // Mark as loading (use empty object temporarily)
      setUserMetrics(prev => ({ ...prev, [userId]: null as any }));

      // Fetch real developer metrics from the API
      const response = await fetch(`${API_URL}/analytics/developer-metrics`, {
        credentials: 'include'
      });

      if (!response.ok) {
        console.error('Failed to fetch developer metrics');
        return;
      }

      const data = await response.json();
      const developers = data.developers || [];

      // Find the specific user in the results
      const developerMetrics = developers.find((d: any) => d.developer_id === userId);

      if (developerMetrics) {
        const metrics: DeveloperMetrics = {
          pr_merge_time_avg: Number(developerMetrics.pr_merge_time_avg) || 0,
          code_review_time_avg: Number(developerMetrics.code_review_time_avg) || 0,
          focus_time_hours: Number(developerMetrics.focus_time_hours) || 0,
          meeting_time_hours: Number(developerMetrics.meeting_time_hours) || 0,
          context_switches_per_day: Number(developerMetrics.context_switches_per_day) || 0,
          happiness_score: Number(developerMetrics.happiness_score) || 0
        };
        setUserMetrics(prev => ({ ...prev, [userId]: metrics }));
      } else {
        // User has no metrics in DB - mark as null to show "No metrics available"
        setUserMetrics(prev => ({ ...prev, [userId]: null as any }));
      }
    } catch (error) {
      console.error('Error fetching user metrics:', error);
      setUserMetrics(prev => ({ ...prev, [userId]: null as any }));
    }
  };

  const toggleUserExpanded = (userId: string, userRole: string) => {
    setExpandedUserIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
        if (userRole === 'qa_engineer') {
          fetchUserMetrics(userId);
        }
      }
      return newSet;
    });
  };

  const filteredUsers = users.filter(u =>
    `${u.first_name} ${u.last_name} ${u.email} ${u.department_name || ''} ${u.team_name || ''}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase())
  ).filter(u => {
    if (user?.role === 'team_lead') {
      return u.primary_team_id === user.primaryTeamId;
    }
    return true;
  });

  // Pagination
  const totalPages = Math.ceil(filteredUsers.length / usersPerPage);
  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * usersPerPage,
    currentPage * usersPerPage
  );

  const canManageTargetUser = (targetUser: User) => {
    if (!user) return false;
    if (user.role === 'super_admin' || user.role === 'qa_manager') return true;
    if (user.role === 'team_lead') {
      return targetUser.primary_team_id === user.primaryTeamId;
    }
    return false;
  };

  const getRoleDisplay = (role: string) => {
    const roleMap: Record<string, string> = {
      super_admin: 'Super Admin',
      qa_manager: 'Manager',
      team_lead: 'Lead',
      qa_engineer: 'Engineer',
      viewer: 'Viewer'
    };
    return roleMap[role] || role;
  };

  const getRoleColors = (role: string) => {
    const colors: Record<string, { bg: string; text: string; gradient: string }> = {
      super_admin: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300', gradient: 'from-purple-500 to-pink-500' },
      qa_manager: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', gradient: 'from-blue-500 to-cyan-500' },
      team_lead: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', gradient: 'from-amber-500 to-orange-500' },
      qa_engineer: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', gradient: 'from-green-500 to-emerald-500' },
      viewer: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300', gradient: 'from-gray-500 to-slate-500' }
    };
    return colors[role] || colors.viewer;
  };

  const canManageUsers = user?.role === 'super_admin' || user?.role === 'qa_manager' || user?.role === 'team_lead';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-slate-950">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8" data-testid="users-page">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-xl ${is3DMode ? 'bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/30' : 'bg-cyan-600'}`}>
              <Users className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
              <p className="text-sm text-gray-500 dark:text-slate-400">{filteredUsers.length} users total</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-md transition-all ${viewMode === 'grid'
                  ? 'bg-white dark:bg-slate-700 shadow text-cyan-600 dark:text-cyan-400'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
                  }`}
                title="Grid View"
              >
                <LayoutGrid size={18} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-md transition-all ${viewMode === 'list'
                  ? 'bg-white dark:bg-slate-700 shadow text-cyan-600 dark:text-cyan-400'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
                  }`}
                title="List View"
              >
                <List size={18} />
              </button>
            </div>

            {/* Grid Column Selector - only show in grid view */}
            {viewMode === 'grid' && (
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1">
                <span className="text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide px-1.5">Grid</span>
                {([2, 3, 4] as const).map((cols) => (
                  <button
                    key={cols}
                    onClick={() => { setGridColumns(cols); setCurrentPage(1); }}
                    className={`w-7 h-7 text-xs font-semibold rounded-md transition-all ${gridColumns === cols
                      ? 'bg-cyan-600 text-white shadow'
                      : 'text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700'
                      }`}
                    title={`${cols} columns`}
                  >
                    {cols}
                  </button>
                ))}
              </div>
            )}

            {canManageUsers && (
              <button
                onClick={() => {
                  setUserForm({
                    firstName: '',
                    lastName: '',
                    email: '',
                    role: '',
                    departmentId: user?.departmentId || '',
                    primaryTeamId: '',
                    password: ''
                  });
                  setShowCreateModal(true);
                }}
                className={`flex items-center gap-2 px-4 py-2.5 text-white rounded-lg transition-all ${is3DMode
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50'
                  : 'bg-cyan-600 hover:bg-cyan-700'
                  }`}
                data-testid="add-user-btn"
              >
                <UserPlus size={18} />
                <span className="hidden sm:inline">Create User</span>
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-slate-500" size={20} />
            <input
              type="text"
              placeholder="Search users by name, email, team..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-cyan-500 dark:focus:ring-cyan-600 focus:border-transparent transition-all"
            />
          </div>
        </div>

        {/* Users Grid/List */}
        {filteredUsers.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center border border-gray-200 dark:border-slate-700">
            <Users className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-slate-600" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No users found</h3>
            <p className="text-gray-500 dark:text-slate-400">Try adjusting your search criteria</p>
          </div>
        ) : (
          <>
            <div className={viewMode === 'grid'
              ? `grid gap-4 ${gridColumns === 2 ? 'grid-cols-1 sm:grid-cols-2' : gridColumns === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`
              : 'space-y-3'
            }>
              {paginatedUsers.map((u) => {
                const roleColors = getRoleColors(u.role);
                const isExpanded = expandedUserIds.has(u.id);
                const metrics = userMetrics[u.id];
                const isEngineer = u.role === 'qa_engineer';

                return (
                  <div
                    key={u.id}
                    className={`bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden transition-all ${is3DMode ? 'hover:shadow-xl hover:-translate-y-1' : 'hover:shadow-md'
                      } ${isExpanded ? 'ring-2 ring-cyan-500 dark:ring-cyan-400' : ''}`}
                    data-testid="user-card"
                  >
                    {/* User Card Header */}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {/* Avatar */}
                          <div className={`w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-lg ${is3DMode ? `bg-gradient-to-br ${roleColors.gradient} shadow-lg` : roleColors.bg.replace('100', '500').replace('900/30', '500')
                            }`}>
                            {u.first_name[0]}{u.last_name[0]}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                                {u.first_name} {u.last_name}
                              </h3>
                              {/* Status Badge - inline with name */}
                              <span className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-bold rounded-full ${u.is_active
                                ? is3DMode
                                  ? 'bg-gradient-to-r from-green-400 to-emerald-500 text-white shadow-lg shadow-green-500/40'
                                  : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                : is3DMode
                                  ? 'bg-gradient-to-r from-red-400 to-rose-500 text-white shadow-lg shadow-red-500/40'
                                  : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                }`}>
                                {u.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </div>
                            <p className={`text-sm text-gray-500 dark:text-slate-400 ${viewMode === 'grid' ? 'truncate max-w-[180px]' : ''}`} title={u.email}>
                              {u.email}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Role & Team Info */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${roleColors.bg} ${roleColors.text}`}>
                          {getRoleDisplay(u.role)}
                        </span>
                        {u.team_name && (
                          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300">
                            {u.team_name}
                          </span>
                        )}
                      </div>

                      {/* Department */}
                      {u.department_name && (
                        <p className="mt-2 text-xs text-gray-400 dark:text-slate-500 truncate">
                          📁 {u.department_name}
                        </p>
                      )}

                      {/* Action Buttons */}
                      <div className="mt-4 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          {canManageTargetUser(u) && (
                            <>
                              <button
                                onClick={() => {
                                  setSelectedUser(u);
                                  setUserForm({
                                    firstName: u.first_name,
                                    lastName: u.last_name,
                                    email: u.email,
                                    role: u.role,
                                    departmentId: u.department_id || '',
                                    primaryTeamId: u.primary_team_id || '',
                                    password: ''
                                  });
                                  setShowEditModal(true);
                                }}
                                className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
                                title="Edit"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedUser(u);
                                  setUserForm({ ...userForm, password: '' });
                                  setShowPasswordModal(true);
                                }}
                                className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
                                title="Reset Password"
                              >
                                <Key size={16} />
                              </button>
                              {u.id !== user?.id && (
                                <>
                                  <button
                                    onClick={async () => {
                                      try {
                                        const response = await fetch(`${API_URL}/admin/users/${u.id}/developer-insights-toggle`, {
                                          method: 'PATCH',
                                          headers: { 'Content-Type': 'application/json' },
                                          credentials: 'include',
                                          body: JSON.stringify({ enabled: !u.developer_insights_enabled })
                                        });
                                        if (response.ok) {
                                          toast.success(`AI insights ${u.developer_insights_enabled ? 'disabled' : 'enabled'}`);
                                          fetchUsers();
                                        } else {
                                          toast.error('Failed to toggle insights');
                                        }
                                      } catch (error) {
                                        toast.error('Error toggling insights');
                                      }
                                    }}
                                    className={`p-1.5 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 ${u.developer_insights_enabled
                                      ? 'text-purple-500 dark:text-purple-400'
                                      : 'text-gray-400 dark:text-slate-500 hover:text-purple-500'
                                      }`}
                                    title={u.developer_insights_enabled ? 'Disable AI Insights' : 'Enable AI Insights'}
                                  >
                                    <Bot size={16} />
                                  </button>
                                  <button
                                    onClick={async () => {
                                      try {
                                        const response = await fetch(`${API_URL}/admin/users/${u.id}/toggle-status`, {
                                          method: 'POST',
                                          credentials: 'include'
                                        });
                                        if (response.ok) {
                                          toast.success(`User ${u.is_active ? 'deactivated' : 'activated'}`);
                                          fetchUsers();
                                        } else {
                                          toast.error('Failed to update status');
                                        }
                                      } catch (error) {
                                        toast.error('Error updating status');
                                      }
                                    }}
                                    className={`p-1.5 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 ${u.is_active
                                      ? 'text-gray-400 dark:text-slate-500 hover:text-orange-500'
                                      : 'text-gray-400 dark:text-slate-500 hover:text-green-500'
                                      }`}
                                    title={u.is_active ? 'Deactivate' : 'Activate'}
                                  >
                                    {u.is_active ? <UserX size={16} /> : <UserCheck size={16} />}
                                  </button>
                                  {(user?.role === 'super_admin' || user?.role === 'qa_manager') && (
                                    <button
                                      onClick={async () => {
                                        const result = await confirmDelete(`${u.first_name} ${u.last_name}`, 'user');
                                        if (result.isConfirmed) {
                                          try {
                                            const response = await fetch(`${API_URL}/admin/users/${u.id}`, {
                                              method: 'DELETE',
                                              credentials: 'include'
                                            });
                                            if (response.ok) {
                                              toast.success('User deleted!');
                                              fetchUsers();
                                            } else {
                                              toast.error('Failed to delete');
                                            }
                                          } catch (error) {
                                            toast.error('Error deleting user');
                                          }
                                        }
                                      }}
                                      className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-red-500 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
                                      title="Delete"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </div>

                        {/* Expand button for engineers */}
                        {isEngineer && (
                          <button
                            onClick={() => toggleUserExpanded(u.id, u.role)}
                            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${isExpanded
                              ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300'
                              : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                              }`}
                          >
                            {isExpanded ? 'Hide' : 'Metrics'}
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded Metrics Section (Engineers only) */}
                    {isExpanded && isEngineer && (
                      <div className="border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 p-4">
                        {metrics ? (
                          <>
                            {/* Happiness Score with BatteryIndicator */}
                            <div className="flex items-center justify-center mb-4">
                              <div className="text-center">
                                <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">Happiness Score</p>
                                <BatteryIndicator
                                  percentage={metrics.happiness_score}
                                  size="md"
                                  mode={is3DMode ? '3d' : 'flat'}
                                />
                              </div>
                            </div>

                            {/* Metrics Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              <div className="bg-white dark:bg-slate-700/50 rounded-lg p-2.5 text-center border border-gray-200 dark:border-slate-600/30">
                                <GitPullRequest className="mx-auto mb-1 text-blue-400" size={14} />
                                <p className="text-[10px] text-gray-500 dark:text-gray-400">PR Time</p>
                                <p className="text-sm font-bold text-gray-900 dark:text-white">{metrics.pr_merge_time_avg}h</p>
                              </div>
                              <div className="bg-white dark:bg-slate-700/50 rounded-lg p-2.5 text-center border border-gray-200 dark:border-slate-600/30">
                                <Clock className="mx-auto mb-1 text-green-400" size={14} />
                                <p className="text-[10px] text-gray-500 dark:text-gray-400">Review</p>
                                <p className="text-sm font-bold text-gray-900 dark:text-white">{metrics.code_review_time_avg}h</p>
                              </div>
                              <div className="bg-white dark:bg-slate-700/50 rounded-lg p-2.5 text-center border border-gray-200 dark:border-slate-600/30">
                                <Zap className="mx-auto mb-1 text-orange-400" size={14} />
                                <p className="text-[10px] text-gray-500 dark:text-gray-400">Focus</p>
                                <p className="text-sm font-bold text-gray-900 dark:text-white">{metrics.focus_time_hours}h</p>
                              </div>
                              <div className="bg-white dark:bg-slate-700/50 rounded-lg p-2.5 text-center border border-gray-200 dark:border-slate-600/30">
                                <Users className="mx-auto mb-1 text-purple-400" size={14} />
                                <p className="text-[10px] text-gray-500 dark:text-gray-400">Meetings</p>
                                <p className="text-sm font-bold text-gray-900 dark:text-white">{metrics.meeting_time_hours}h</p>
                              </div>
                              <div className="bg-white dark:bg-slate-700/50 rounded-lg p-2.5 text-center border border-gray-200 dark:border-slate-600/30">
                                <TrendingUp className="mx-auto mb-1 text-red-400" size={14} />
                                <p className="text-[10px] text-gray-500 dark:text-gray-400">Ctx Switch</p>
                                <p className="text-sm font-bold text-gray-900 dark:text-white">{metrics.context_switches_per_day}</p>
                              </div>
                            </div>

                            {/* Work-Life Balance Bar */}
                            <div className="mt-4">
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Work-Life Balance</span>
                                <span className="text-xs font-bold text-gray-900 dark:text-white">
                                  {((metrics.focus_time_hours / (metrics.focus_time_hours + metrics.meeting_time_hours)) * 100).toFixed(0)}% Focus
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full transition-all ${(metrics.focus_time_hours / (metrics.focus_time_hours + metrics.meeting_time_hours)) * 100 > 70
                                    ? 'bg-green-500'
                                    : (metrics.focus_time_hours / (metrics.focus_time_hours + metrics.meeting_time_hours)) * 100 > 50
                                      ? 'bg-yellow-500'
                                      : 'bg-red-500'
                                    }`}
                                  style={{ width: `${(metrics.focus_time_hours / (metrics.focus_time_hours + metrics.meeting_time_hours)) * 100}%` }}
                                />
                              </div>
                            </div>

                            {/* Burnout Risk */}
                            <div className="mt-3 flex items-center justify-between">
                              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Burnout Risk:</span>
                              <span className={`text-xs font-bold px-2 py-1 rounded-full ${metrics.happiness_score > 80 && metrics.focus_time_hours > 4
                                ? 'bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/30'
                                : metrics.happiness_score > 70
                                  ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30'
                                  : 'bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30'
                                }`}>
                                {metrics.happiness_score > 80 && metrics.focus_time_hours > 4 ? '✅ Low' :
                                  metrics.happiness_score > 70 ? '⚠️ Moderate' : '❌ High'}
                              </span>
                            </div>
                          </>
                        ) : userMetrics[u.id] === null ? (
                          <div className="flex flex-col items-center justify-center py-6 text-center">
                            <p className="text-gray-500 dark:text-slate-400 text-sm">📊 No metrics available</p>
                            <p className="text-gray-400 dark:text-slate-500 text-xs mt-1">This engineer has no recorded metrics in the database</p>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center py-4">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-600"></div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-8 h-8 text-sm font-medium rounded-lg transition-colors ${currentPage === pageNum
                          ? 'bg-cyan-600 text-white'
                          : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
                          }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Happiness Ranking Section - Only show for managers */}
      {(user?.role === 'super_admin' || user?.role === 'qa_manager' || user?.role === 'team_lead') && Object.entries(userMetrics).filter(([, m]) => m !== null).length > 0 && (
        <div className="max-w-7xl mx-auto mt-8 mb-6">
          <div className={`bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6 ${is3DMode ? 'shadow-lg' : ''}`}>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              📊 Engineer Happiness Ranking
              <span className="text-sm font-normal text-gray-500 dark:text-slate-400">
                ({Object.entries(userMetrics).filter(([, m]) => m !== null).length} engineers with metrics)
              </span>
            </h3>
            <div className="space-y-2">
              {Object.entries(userMetrics)
                .filter(([, m]) => m !== null)
                .sort(([, a], [, b]) => (b?.happiness_score || 0) - (a?.happiness_score || 0))
                .map(([userId, metrics], index, arr) => {
                  const userInfo = users.find(u => u.id === userId);
                  if (!userInfo || !metrics) return null;

                  const isTop = index < 3;
                  const isBottom = index >= arr.length - 3 && arr.length > 3;

                  return (
                    <div
                      key={userId}
                      className={`flex items-center justify-between p-3 rounded-lg transition-all ${isTop ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' :
                        isBottom ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' :
                          'bg-gray-50 dark:bg-slate-700/50'
                        }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold ${index === 0 ? 'bg-yellow-400 text-yellow-900' :
                          index === 1 ? 'bg-gray-300 text-gray-700' :
                            index === 2 ? 'bg-amber-600 text-white' :
                              'bg-gray-200 dark:bg-slate-600 text-gray-600 dark:text-slate-300'
                          }`}>
                          {index + 1}
                        </span>
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">
                            {userInfo.first_name} {userInfo.last_name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-slate-400">{userInfo.team_name || 'No team'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xs text-gray-500 dark:text-slate-400">Focus Time</p>
                          <p className="font-medium text-gray-900 dark:text-white">{metrics.focus_time_hours}h</p>
                        </div>
                        <div className={`text-2xl font-bold ${metrics.happiness_score >= 80 ? 'text-green-600 dark:text-green-400' :
                          metrics.happiness_score >= 70 ? 'text-yellow-600 dark:text-yellow-400' :
                            'text-red-600 dark:text-red-400'
                          }`}>
                          {metrics.happiness_score}%
                          <span className="ml-1">
                            {metrics.happiness_score >= 80 ? '😊' : metrics.happiness_score >= 70 ? '🙂' : '😟'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
            {Object.keys(userMetrics).length === 0 && (
              <p className="text-center text-gray-500 dark:text-slate-400 py-4">
                Click "Metrics" on engineer cards above to load their data
              </p>
            )}
          </div>
        </div>
      )}

      {/* Create User Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create New User" size="md">
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            const response = await fetch(`${API_URL}/admin/users`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                firstName: userForm.firstName,
                lastName: userForm.lastName,
                email: userForm.email,
                password: userForm.password,
                role: userForm.role,
                departmentId: userForm.departmentId,
                teamId: userForm.primaryTeamId
              })
            });

            if (response.ok) {
              setShowCreateModal(false);
              setUserForm({ firstName: '', lastName: '', email: '', role: '', departmentId: '', primaryTeamId: '', password: '' });
              toast.success('User created successfully!');
              fetchUsers();
            } else {
              const errorData = await response.json();
              toast.error(`Failed: ${errorData.error || 'Unknown error'}`);
            }
          } catch (error) {
            toast.error('Error creating user');
          }
        }}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">First Name</label>
                <input type="text" value={userForm.firstName} onChange={(e) => setUserForm({ ...userForm, firstName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required data-testid="first-name-input" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Last Name</label>
                <input type="text" value={userForm.lastName} onChange={(e) => setUserForm({ ...userForm, lastName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required data-testid="last-name-input" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email</label>
              <input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required data-testid="email-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Password</label>
              <input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required minLength={6} data-testid="password-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Role</label>
              <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required data-testid="role-select">
                <option value="">Select a role</option>
                {roles.map(role => (<option key={role.id} value={role.id}>{role.name}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Department</label>
              <select value={userForm.departmentId} onChange={(e) => setUserForm({ ...userForm, departmentId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required data-testid="department-select">
                <option value="">Select a department</option>
                {departments.map(dept => (<option key={dept.id} value={dept.id}>{dept.name}</option>))}
              </select>
            </div>
            {/* Primary Team - only show for roles that need it */}
            {userForm.role && !['super_admin', 'qa_manager'].includes(userForm.role) && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Primary Team {userForm.role === 'qa_engineer' || userForm.role === 'team_lead' ? '' : '(Optional)'}</label>
                <select value={userForm.primaryTeamId} onChange={(e) => setUserForm({ ...userForm, primaryTeamId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" data-testid="team-select" required={userForm.role === 'qa_engineer' || userForm.role === 'team_lead'}>
                  <option value="">Select a team</option>
                  {teams.filter(t => t.department_id === userForm.departmentId).map(team => (<option key={team.id} value={team.id}>{team.name}</option>))}
                </select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
            <button type="submit" className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md transition-colors" data-testid="create-user-btn"><UserPlus size={18} />Create User</button>
          </div>
        </form>
      </Modal>

      {/* Edit User Modal */}
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title={`Edit User: ${selectedUser?.first_name} ${selectedUser?.last_name}`} size="md">
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            const response = await fetch(`${API_URL}/admin/users/${selectedUser?.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                firstName: userForm.firstName,
                lastName: userForm.lastName,
                email: userForm.email,
                role: userForm.role,
                departmentId: userForm.departmentId,
                primaryTeamId: userForm.primaryTeamId || null
              })
            });

            if (response.ok) {
              setShowEditModal(false);
              toast.success('User updated successfully!');
              fetchUsers();
            } else {
              const errorData = await response.json();
              toast.error(`Failed: ${errorData.error || 'Unknown error'}`);
            }
          } catch (error) {
            toast.error('Error updating user');
          }
        }}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">First Name</label>
                <input type="text" value={userForm.firstName} onChange={(e) => setUserForm({ ...userForm, firstName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Last Name</label>
                <input type="text" value={userForm.lastName} onChange={(e) => setUserForm({ ...userForm, lastName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email</label>
              <input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Role</label>
              {selectedUser?.role === 'super_admin' ? (
                <div className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-gray-100 dark:bg-slate-700 text-gray-900 dark:text-white">
                  <span className="flex items-center gap-2">
                    <span className="px-2 py-1 text-xs font-medium rounded bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200">Super Admin</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">(Role cannot be changed)</span>
                  </span>
                </div>
              ) : (
                <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required>
                  <option value="">Select a role</option>
                  {roles.map(role => (<option key={role.id} value={role.id}>{role.name}</option>))}
                </select>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Department</label>
              <select value={userForm.departmentId} onChange={(e) => setUserForm({ ...userForm, departmentId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required>
                <option value="">Select a department</option>
                {departments.map(dept => (<option key={dept.id} value={dept.id}>{dept.name}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Primary Team (Optional)</label>
              <select value={userForm.primaryTeamId} onChange={(e) => setUserForm({ ...userForm, primaryTeamId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500">
                <option value="">No team</option>
                {teams.filter(t => t.department_id === userForm.departmentId).map(team => (<option key={team.id} value={team.id}>{team.name}</option>))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
            <button type="submit" className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md transition-colors"><Save size={18} />Save Changes</button>
          </div>
        </form>
      </Modal>

      {/* Reset Password Modal */}
      <Modal isOpen={showPasswordModal} onClose={() => setShowPasswordModal(false)} title={`Reset Password: ${selectedUser?.first_name} ${selectedUser?.last_name}`} size="sm">
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            const response = await fetch(`${API_URL}/admin/users/${selectedUser?.id}/reset-password`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ newPassword: userForm.password })
            });

            if (response.ok) {
              setShowPasswordModal(false);
              setUserForm({ ...userForm, password: '' });
              toast.success('Password reset successfully!');
            } else {
              const errorData = await response.json();
              toast.error(`Failed: ${errorData.error || 'Unknown error'}`);
            }
          } catch (error) {
            toast.error('Error resetting password');
          }
        }}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">New Password</label>
              <input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required minLength={6} placeholder="Enter new password" />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setShowPasswordModal(false)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
            <button type="submit" className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md transition-colors"><Key size={18} />Reset Password</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default UsersView;
