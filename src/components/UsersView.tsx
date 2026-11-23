import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Users, Search, Edit2, Key, Trash2, UserPlus, Save, UserCheck, UserX, Bot, ChevronDown, ChevronUp, GitPullRequest, Clock, Zap, TrendingUp, LayoutGrid, List, Send } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import Modal from './Modal';
import { confirmDelete, showAlert } from '../utils/alerts';
import { assessDeveloper, statusRank, type DeveloperStatus } from '../../server/lib/developerHealth';
import { Badge } from './ui';
import { METRIC_EXPLANATIONS } from './TeamDetailView';

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  job_title?: string | null;
  team_name: string;
  department_name: string;
  department_id: string;
  primary_team_id: string;
  is_active: boolean;
  developer_insights_enabled?: boolean;
  team_ids?: string[];
  department_ids?: string[];
  assignments?: AssignmentRow[];
}

interface DeveloperMetrics {
  pr_merge_time_avg: number | null;
  code_review_time_avg: number | null;
  focus_time_hours: number | null;
  meeting_time_hours: number | null;
  context_switches_per_day: number | null;
  happiness_score: number | null;
  updated_at?: string | null;
}

const toNumOrNull = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const toDevMetrics = (d: any): DeveloperMetrics => ({
  pr_merge_time_avg: toNumOrNull(d.pr_merge_time_avg),
  code_review_time_avg: toNumOrNull(d.code_review_time_avg),
  focus_time_hours: toNumOrNull(d.focus_time_hours),
  meeting_time_hours: toNumOrNull(d.meeting_time_hours),
  context_switches_per_day: toNumOrNull(d.context_switches_per_day),
  happiness_score: toNumOrNull(d.happiness_score),
  updated_at: d.updated_at ?? null,
});
/** The API returns one row per developer per team; keep the most recently updated row. */
const latestPerDeveloper = (rows: any[]): Record<string, DeveloperMetrics> => {
  const out: Record<string, DeveloperMetrics> = {};
  for (const r of rows) {
    const m = toDevMetrics(r);
    const prev = out[r.developer_id];
    if (!prev || String(m.updated_at ?? '') > String(prev.updated_at ?? '')) out[r.developer_id] = m;
  }
  return out;
};
const assess = (m: DeveloperMetrics, name = '') =>
  assessDeveloper({
    name,
    prMergeTimeHours: m.pr_merge_time_avg,
    codeReviewTimeHours: m.code_review_time_avg,
    focusTimeHours: m.focus_time_hours,
    meetingTimeHours: m.meeting_time_hours,
    contextSwitchesPerDay: m.context_switches_per_day,
    happinessScore: m.happiness_score,
  });
const STATUS_META: Record<DeveloperStatus, { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  healthy: { label: 'Healthy', tone: 'good' },
  'needs-attention': { label: 'Needs attention', tone: 'warn' },
  'at-risk': { label: 'At risk', tone: 'bad' },
};
const fmtH = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}h`);

import API_URL from '../config/api';
import { canEditUser, canEditAssignment, canManageUser, canDeleteUser, canResetPassword, canAssignRole, canCreateUsers, canInvite, canSetJobTitle, canChangeUserEmail, highestRole, TEAM_OPTIONAL_ROLES, type PolicyActor } from '../../server/lib/userPolicy';
import { policyActorOf, grantableOptions } from '../lib/policyActor';
import { InviteDialog, InvitationsPanel } from './InviteDialog';
import { AssignmentChips, type AssignmentRow } from './AssignmentChips';
import { buttonClass } from './ui';
import ExportCsvButton from './ExportCsvButton';
import { ROLE_LABELS } from '../lib/policyActor';
import { loadErrorMessage, NETWORK_ERROR } from '../lib/loadError';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_RULES_TEXT } from '../lib/passwordPolicy';

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [sendingResetLink, setSendingResetLink] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [expandedUserIds, setExpandedUserIds] = useState<Set<string>>(new Set());
  const [userMetrics, setUserMetrics] = useState<Record<string, DeveloperMetrics>>({});
  const [usersWithMetricsIds, setUsersWithMetricsIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [gridColumns, setGridColumns] = useState<2 | 3 | 4>(3);
  const [currentPage, setCurrentPage] = useState(1);
  const [showOnlyWithMetrics, setShowOnlyWithMetrics] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [invitationsKey, setInvitationsKey] = useState(0);
  const usersPerPage = gridColumns * 3; // 3 rows per page
  const [userForm, setUserForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: '',
    departmentId: '',
    primaryTeamId: '',
    password: '',
    jobTitle: ''
  });

  useEffect(() => {
    fetchUsers();
    fetchAllUsersWithMetrics(); // Pre-load list of users with metrics for filtering
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
        setLoadError(null);
      } else {
        setLoadError(await loadErrorMessage(usersRes, 'the users'));
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
          name: ROLE_LABELS[r] ?? r
        })));
      } else {
        setRoles([
          { id: 'super_admin', name: ROLE_LABELS.super_admin },
          { id: 'qa_manager', name: ROLE_LABELS.qa_manager },
          { id: 'team_lead', name: ROLE_LABELS.team_lead },
          { id: 'qa_engineer', name: ROLE_LABELS.qa_engineer },
          { id: 'viewer', name: ROLE_LABELS.viewer }
        ]);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      setLoadError(NETWORK_ERROR('the users'));
      setRoles([
        { id: 'super_admin', name: ROLE_LABELS.super_admin },
        { id: 'qa_manager', name: ROLE_LABELS.qa_manager },
        { id: 'team_lead', name: ROLE_LABELS.team_lead },
        { id: 'qa_engineer', name: ROLE_LABELS.qa_engineer },
        { id: 'viewer', name: ROLE_LABELS.viewer }
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

      const latest = latestPerDeveloper(developers.filter((d: any) => d.developer_id === userId));
      if (latest[userId]) {
        setUserMetrics(prev => ({ ...prev, [userId]: latest[userId] }));
      } else {
        // User has no metrics in DB - mark as null to show "No metrics available"
        setUserMetrics(prev => ({ ...prev, [userId]: null as any }));
      }
    } catch (error) {
      console.error('Error fetching user metrics:', error);
      setUserMetrics(prev => ({ ...prev, [userId]: null as any }));
    }
  };

  // Fetch list of all users who have metrics (for filtering AND for ranking)
  const fetchAllUsersWithMetrics = async () => {
    try {
      const response = await fetch(`${API_URL}/analytics/developer-metrics`, {
        credentials: 'include'
      });

      if (!response.ok) {
        console.log('fetchAllUsersWithMetrics: Response not ok', response.status);
        return;
      }

      const data = await response.json();
      const developers = data.developers || [];
      console.log('fetchAllUsersWithMetrics: Got developers:', developers.length, developers);

      // Create a set of user IDs that have metrics
      const idsWithMetrics = new Set<string>(developers.map((d: any) => d.developer_id));
      setUsersWithMetricsIds(idsWithMetrics);

      const metricsMap = latestPerDeveloper(developers);
      setUserMetrics(prev => ({ ...prev, ...metricsMap }));
    } catch (error) {
      console.error('Error fetching users with metrics:', error);
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
    // Filter by metrics if checkbox is checked
    if (showOnlyWithMetrics) {
      return usersWithMetricsIds.has(u.id);
    }
    return true;
  });

  // Pagination
  const totalPages = Math.ceil(filteredUsers.length / usersPerPage);
  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * usersPerPage,
    currentPage * usersPerPage
  );

  // One set of rules with the server (server/lib/userPolicy): only offer what will succeed.
  // The actor carries the signed-in user's role assignments (a manager of two departments, ...).
  const actor: PolicyActor = policyActorOf(user);
  const asTarget = (u: User) => ({
    id: u.id, role: u.role, department_id: u.department_id ?? null, primary_team_id: u.primary_team_id ?? null,
    department_ids: u.department_ids ?? null, team_ids: u.team_ids ?? null,
    // Every active assignment: account-wide actions need the person entirely within your scope.
    assignments: u.assignments ? u.assignments.map((a) => ({ role: a.role, scope_type: a.scope_type, scope_id: a.scope_id, department_id: a.department_id })) : null,
  });
  // Assignments the signed-in user may give (shared rule canGrant), for chips and invitations.
  const grantOptions = useMemo(
    () => grantableOptions(policyActorOf(user), user?.companyId ?? '', 'Organisation', departments, teams),
    [user, departments, teams],
  );
  const mayInvite = !!user && canInvite(actor) && grantOptions.length > 0;
  const canEditTarget = (u: User) => !!user && canEditUser(actor, asTarget(u));
  const canManageTarget = (u: User) => !!user && canManageUser(actor, asTarget(u));
  const canDeleteTarget = (u: User) => !!user && canDeleteUser(actor, asTarget(u));
  const canEditTargetAssignment = (u: User | null) => !!user && !!u && canEditAssignment(actor, asTarget(u));

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

  const canChangePassword = (targetUser: User) => !!user && canResetPassword(actor, asTarget(targetUser));

  const getRoleColors = (role: string) => {
    // avatar: solid colours with white initials at 4.5:1 or more (WCAG AA) in both themes.
    const colors: Record<string, { bg: string; text: string; gradient: string; avatar: string }> = {
      super_admin: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300', gradient: 'from-purple-700 to-pink-700', avatar: 'bg-purple-700' },
      qa_manager: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', gradient: 'from-blue-700 to-cyan-700', avatar: 'bg-blue-700' },
      team_lead: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', gradient: 'from-amber-700 to-orange-700', avatar: 'bg-amber-700' },
      qa_engineer: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', gradient: 'from-green-700 to-emerald-700', avatar: 'bg-green-700' },
      viewer: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300', gradient: 'from-gray-600 to-slate-700', avatar: 'bg-gray-600' }
    };
    return colors[role] || colors.viewer;
  };

  const canManageUsers = !!user && canCreateUsers(highestRole(actor));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-slate-950">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-600"></div>
      </div>
    );
  }

  return (
    <div className="ig-page min-h-screen bg-gray-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8" data-testid="users-page">
      <div className="max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-md ${'bg-brand-50 text-brand-700 dark:bg-slate-800 dark:text-brand-300'}`}>
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">Users</h1>
              <p className="text-sm text-gray-500 dark:text-slate-400">{filteredUsers.length} users total</p>
            </div>
          </div>

          {/* Wraps on phones (the buttons are wider than a 390 px screen together). */}
          <div className="flex max-w-full flex-wrap items-center gap-3">
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
                <span className="text-[10px] font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wide px-1.5">Grid</span>
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

            {/* The listed people as shown (search and filters applied); no individual developer metrics. */}
            <ExportCsvButton
              what="Users"
              rows={filteredUsers}
              columns={[
                { header: 'First name', value: (u) => u.first_name },
                { header: 'Last name', value: (u) => u.last_name },
                { header: 'Email', value: (u) => u.email },
                { header: 'Role', value: (u) => ROLE_LABELS[u.role] ?? u.role },
                { header: 'Department', value: (u) => u.department_name ?? '' },
                { header: 'Team', value: (u) => u.team_name ?? '' },
                { header: 'Assignments', value: (u) => (u.assignments ?? []).map((a) => `${ROLE_LABELS[a.role] ?? a.role}: ${a.scope_name ?? a.scope_id}`).join('; ') },
                { header: 'Active', value: (u) => (u.is_active ? 'yes' : 'no') },
              ]}
            />
            {mayInvite && (
              <button type="button" onClick={() => setShowInvite(true)} className={buttonClass.primary} data-testid="invite-user-btn">
                <Send size={16} aria-hidden="true" />
                <span>Invite</span>
              </button>
            )}
            {canManageUsers && (
              <button
                type="button"
                title="Creates the account with a password you choose (for demos and scripted setups). Prefer Invite."
                onClick={() => {
                  setUserForm({
                    firstName: '',
                    lastName: '',
                    email: '',
                    role: '',
                    departmentId: user?.departmentId || '',
                    primaryTeamId: '',
                    password: '', jobTitle: ''
                  });
                  setShowCreateModal(true);
                }}
                className={buttonClass.secondary}
                data-testid="add-user-btn"
              >
                <UserPlus size={16} aria-hidden="true" />
                <span className="hidden sm:inline">Add with password</span>
                <span className="rounded bg-slate-100 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">Demo</span>
              </button>
            )}
          </div>
        </div>

        {mayInvite && <InvitationsPanel reloadKey={invitationsKey} />}

        {/* Search */}
        <div className="mb-6 flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-slate-400" size={20} />
            <input
              type="text"
              placeholder="Search users by name, email, team..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-cyan-500 dark:focus:ring-cyan-600 focus:border-transparent transition-all"
            />
          </div>
          {/* Show only users with metrics checkbox */}
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOnlyWithMetrics}
              onChange={(e) => { setShowOnlyWithMetrics(e.target.checked); setCurrentPage(1); }}
              className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-cyan-600 focus:ring-cyan-500 bg-white dark:bg-slate-800"
            />
            Show only users with metrics
          </label>
        </div>

        {/* Users Grid/List */}
        {loadError && (
          <div role="alert" data-testid="load-error" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {loadError}
          </div>
        )}
        {loadError ? null : filteredUsers.length === 0 ? (
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
                      <span data-testid="user-ai-status" className="sr-only">{u.developer_insights_enabled ? 'Developer insights on' : 'Developer insights off'}</span>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {/* Avatar */}
                          <div className={`w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-lg ${is3DMode ? `bg-gradient-to-br ${roleColors.gradient} shadow-lg` : roleColors.avatar
                            }`}>
                            {u.first_name[0]}{u.last_name[0]}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                                {u.first_name} {u.last_name}
                              </h3>
                              {/* Status Badge - inline with name */}
                              <span data-testid="user-status" className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-bold rounded-full ${u.is_active
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

                      {/* Role assignments (role on an organisation / department / team) */}
                      <div className="mt-3">
                        <span className="sr-only" data-testid="user-role">{getRoleDisplay(u.role)}</span>
                        {u.team_name && <span data-testid="user-team" className="sr-only">{u.team_name}</span>}
                        <AssignmentChips actor={actor} user={u} teams={teams} options={grantOptions} onChanged={fetchUsers} />
                      </div>

                      {/* Department */}
                      {u.department_name && (
                        <p className="mt-2 text-xs text-gray-500 dark:text-slate-400 truncate">
                          {u.department_name}
                        </p>
                      )}

                      {/* Action Buttons */}
                      <div className="mt-4 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          {canEditTarget(u) && (
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
                                    password: '',
                                    jobTitle: u.job_title || ''
                                  });
                                  setShowEditModal(true);
                                }}
                                className="p-1.5 text-gray-500 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
                                data-testid="edit-btn"
                                title="Edit"
                              >
                                <Edit2 size={16} />
                              </button>
                            </>
                          )}
                          {/* Password button - visible based on canChangePassword */}
                          {canChangePassword(u) && (
                            <button
                              onClick={() => {
                                setSelectedUser(u);
                                setUserForm({ ...userForm, password: '' });
                                setShowPasswordModal(true);
                              }}
                              className="p-1.5 text-gray-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
                              title={u.id === user?.id ? 'Change My Password' : 'Reset Password'}
                            >
                              <Key size={16} />
                            </button>
                          )}
                          {canManageTarget(u) && (
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
                                      toast.success(`Developer insights ${u.developer_insights_enabled ? 'disabled' : 'enabled'}`);
                                      fetchUsers();
                                    } else {
                                      toast.error('Could not change developer insights');
                                    }
                                  } catch (error) {
                                    toast.error('Could not change developer insights: the server could not be reached.');
                                  }
                                }}
                                className={`p-1.5 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 ${u.developer_insights_enabled
                                  ? 'text-purple-500 dark:text-purple-400'
                                  : 'text-gray-500 dark:text-slate-400 hover:text-purple-500'
                                  }`}
                                title={u.developer_insights_enabled ? 'Disable developer insights' : 'Enable developer insights'}
                                aria-label={u.developer_insights_enabled ? 'Disable developer insights' : 'Enable developer insights'}
                                aria-pressed={!!u.developer_insights_enabled}
                                data-testid="user-ai-toggle"
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
                                  ? 'text-gray-500 dark:text-slate-400 hover:text-orange-500'
                                  : 'text-gray-500 dark:text-slate-400 hover:text-green-500'
                                  }`}
                                title={u.is_active ? 'Deactivate' : 'Activate'}
                                data-testid="user-status-toggle"
                              >
                                {u.is_active ? <UserX size={16} /> : <UserCheck size={16} />}
                              </button>
                              {canDeleteTarget(u) && (
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
                                  className="p-1.5 text-gray-500 dark:text-slate-400 hover:text-red-500 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
                                  data-testid="delete-btn"
                                  title="Delete"
                                >
                                  <Trash2 size={16} />
                                </button>
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
                            {(() => {
                              const a = assess(metrics, `${u.first_name} ${u.last_name}`);
                              const meta = STATUS_META[a.status];
                              return (
                                <div className="mb-4 space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Status</span>
                                    <Badge tone={meta.tone}>{meta.label}</Badge>
                                  </div>
                                  <p className="text-xs text-slate-600 dark:text-slate-300">{a.summary}</p>
                                  {a.status !== 'healthy' && a.suggestion && (
                                    <p className="text-xs text-slate-500 dark:text-slate-400"><span className="font-medium text-slate-700 dark:text-slate-200">Suggested action: </span>{a.suggestion}</p>
                                  )}
                                </div>
                              );
                            })()}

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              <div className="bg-white dark:bg-slate-900 rounded-md p-2.5 text-center border border-slate-200 dark:border-slate-700">
                                <Users className="mx-auto mb-1 text-slate-400" size={14} />
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">Workload balance (derived)</p>
                                <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{metrics.happiness_score == null ? '—' : `${Math.round(metrics.happiness_score)} / 100`}</p>
                              </div>
                              <div className="bg-white dark:bg-slate-900 rounded-md p-2.5 text-center border border-slate-200 dark:border-slate-700">
                                <GitPullRequest className="mx-auto mb-1 text-slate-400" size={14} />
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">PR merge time</p>
                                <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{fmtH(metrics.pr_merge_time_avg)}</p>
                              </div>
                              <div className="bg-white dark:bg-slate-900 rounded-md p-2.5 text-center border border-slate-200 dark:border-slate-700">
                                <Clock className="mx-auto mb-1 text-slate-400" size={14} />
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">Review time</p>
                                <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{fmtH(metrics.code_review_time_avg)}</p>
                              </div>
                              <div className="bg-white dark:bg-slate-900 rounded-md p-2.5 text-center border border-slate-200 dark:border-slate-700">
                                <Zap className="mx-auto mb-1 text-slate-400" size={14} />
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">Focus / day</p>
                                <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{fmtH(metrics.focus_time_hours)}</p>
                              </div>
                              <div className="bg-white dark:bg-slate-900 rounded-md p-2.5 text-center border border-slate-200 dark:border-slate-700">
                                <Users className="mx-auto mb-1 text-slate-400" size={14} />
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">Meetings / day</p>
                                <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{fmtH(metrics.meeting_time_hours)}</p>
                              </div>
                              <div className="bg-white dark:bg-slate-900 rounded-md p-2.5 text-center border border-slate-200 dark:border-slate-700">
                                <TrendingUp className="mx-auto mb-1 text-slate-400" size={14} />
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">Context switches</p>
                                <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white">{metrics.context_switches_per_day == null ? '—' : Math.round(metrics.context_switches_per_day)}</p>
                              </div>
                            </div>
                            {metrics.updated_at && (
                              <p className="mt-3 text-[11px] text-slate-400">Last updated {new Date(metrics.updated_at).toLocaleDateString()}</p>
                            )}
                          </>
                        ) : userMetrics[u.id] === null ? (
                          <div className="flex flex-col items-center justify-center py-6 text-center">
                            <p className="text-slate-500 dark:text-slate-400 text-sm">No metrics recorded</p>
                            <p className="text-gray-500 dark:text-slate-400 text-xs mt-1">This engineer has no recorded metrics in the database</p>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center py-4">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-600"></div>
                          </div>
                        )}
                      </div>
                    )
                    }
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

      {/* Engineer workload overview - managers only. Ordered by status (most at risk first), not a leaderboard. */}
      {
        (user?.role === 'super_admin' || user?.role === 'qa_manager' || user?.role === 'team_lead') && Object.values(userMetrics).some(Boolean) && (
          <div className="max-w-[1400px] mx-auto mt-8 mb-6">
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Engineer workload overview</h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Engineers who opted in to developer insights, most at risk first. Workload balance is a derived score (0–100) from focus, meeting, context-switch, PR and review times; it is not a survey result.
                </p>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {Object.entries(userMetrics)
                  .filter(([id, m]) => m && users.some(u => u.id === id))
                  .map(([id, m]) => {
                    const info = users.find(u => u.id === id)!;
                    return { id, m: m!, info, a: assess(m!, `${info.first_name} ${info.last_name}`) };
                  })
                  .sort((x, y) => statusRank(y.a.status) - statusRank(x.a.status) || (x.m.happiness_score ?? 101) - (y.m.happiness_score ?? 101))
                  .map(({ id, m, info, a }) => (
                    <div key={id} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{info.first_name} {info.last_name}</p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{info.team_name || 'No team'} · {a.summary}</p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-4">
                        <div className="text-right">
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">Focus / day</p>
                          <p className="text-sm font-medium tabular-nums text-slate-900 dark:text-white">{fmtH(m.focus_time_hours)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] text-slate-500 dark:text-slate-400" title="Derived from focus, meetings, context switches, PR and review times">Workload balance</p>
                          <p className="text-sm font-medium tabular-nums text-slate-900 dark:text-white">{m.happiness_score == null ? '—' : Math.round(m.happiness_score)}</p>
                        </div>
                        <Badge tone={STATUS_META[a.status].tone}>{STATUS_META[a.status].label}</Badge>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )
      }

      <InviteDialog isOpen={showInvite} onClose={() => setShowInvite(false)} options={grantOptions} onSent={() => setInvitationsKey((k) => k + 1)} />

      {/* Create User Modal (with a password: demos and scripted setups; Invite is the normal way) */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Add a user with a password" subtitle="For demos and scripted setups. To add a real person, use Invite: they choose their own password." size="md">
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
                departmentId: userForm.departmentId || undefined,
                teamId: userForm.primaryTeamId || undefined
              })
            });

            if (response.ok) {
              setShowCreateModal(false);
              setUserForm({ firstName: '', lastName: '', email: '', role: '', departmentId: '', primaryTeamId: '', password: '', jobTitle: '' });
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
                <label htmlFor="create-user-first-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">First Name</label>
                <input id="create-user-first-name" type="text" value={userForm.firstName} onChange={(e) => setUserForm({ ...userForm, firstName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required data-testid="first-name-input" />
              </div>
              <div>
                <label htmlFor="create-user-last-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Last Name</label>
                <input id="create-user-last-name" type="text" value={userForm.lastName} onChange={(e) => setUserForm({ ...userForm, lastName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required data-testid="last-name-input" />
              </div>
            </div>
            <div>
              <label htmlFor="create-user-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email</label>
              <input id="create-user-email" type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required data-testid="email-input" />
            </div>
            <div>
              <label htmlFor="create-user-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Password</label>
              <input id="create-user-password" type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} data-testid="password-input" aria-describedby="create-user-password-rules" />
              <p id="create-user-password-rules" className="mt-1 text-xs text-gray-500 dark:text-slate-400">{PASSWORD_RULES_TEXT}</p>
            </div>
            <div>
              <label htmlFor="create-user-role" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Role</label>
              <select id="create-user-role" value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required data-testid="role-select">
                <option value="">Select a role</option>
                {roles.map(role => (<option key={role.id} value={role.id}>{role.name}</option>))}
              </select>
            </div>
            <div>
              <label htmlFor="create-user-department" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Department</label>
              <select id="create-user-department" value={userForm.departmentId} onChange={(e) => setUserForm({ ...userForm, departmentId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required disabled={user?.role !== 'super_admin'} title={user?.role !== 'super_admin' ? 'New users are added to your department' : undefined} data-testid="department-select">
                <option value="">Select a department</option>
                {departments.map(dept => (<option key={dept.id} value={dept.id}>{dept.name}</option>))}
              </select>
            </div>
            {/* Primary team: required unless the role is team-optional (same list as the server: TEAM_OPTIONAL_ROLES).
                A team lead always adds people to their own team. */}
            {userForm.role && user?.role !== 'team_lead' && (
              <div>
                <label htmlFor="create-user-primary-team" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Primary Team {TEAM_OPTIONAL_ROLES.includes(userForm.role) ? '(Optional)' : ''}
                </label>
                <select id="create-user-primary-team"
                  value={userForm.primaryTeamId}
                  onChange={(e) => setUserForm({ ...userForm, primaryTeamId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500"
                  data-testid="team-select"
                  required={!TEAM_OPTIONAL_ROLES.includes(userForm.role)}
                >
                  <option value="">{TEAM_OPTIONAL_ROLES.includes(userForm.role) ? 'No team' : 'Select a team'}</option>
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

          // Check if email is already in use by another user
          const emailInUse = users.find(u =>
            u.email.toLowerCase() === userForm.email.toLowerCase() &&
            u.id !== selectedUser?.id
          );

          if (emailInUse) {
            showAlert(
              'Email Already in Use',
              `The email ${userForm.email} is already assigned to another user. Please use a different email address.`,
              'error'
            );
            return;
          }

          try {
            const response = await fetch(`${API_URL}/admin/users/${selectedUser?.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              // Role / department / team are only sent when the caller may change them (not for
              // self-edits); unchanged values are accepted by the server either way.
              body: JSON.stringify({ ...(canSetJobTitle(actor) ? { jobTitle: userForm.jobTitle } : {}), ...(canEditTargetAssignment(selectedUser) ? {
                firstName: userForm.firstName,
                lastName: userForm.lastName,
                email: userForm.email,
                role: userForm.role,
                departmentId: userForm.departmentId,
                primaryTeamId: userForm.primaryTeamId || null
              } : {
                firstName: userForm.firstName,
                lastName: userForm.lastName,
                email: userForm.email
              }) })
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
                <label htmlFor="edit-user-first-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">First Name</label>
                <input id="edit-user-first-name" type="text" value={userForm.firstName} onChange={(e) => setUserForm({ ...userForm, firstName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required />
              </div>
              <div>
                <label htmlFor="edit-user-last-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Last Name</label>
                <input id="edit-user-last-name" type="text" value={userForm.lastName} onChange={(e) => setUserForm({ ...userForm, lastName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required />
              </div>
            </div>
            {canSetJobTitle(actor) && (
              <div>
                <label htmlFor="edit-user-job-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Job title <span className="font-normal text-gray-500 dark:text-slate-400">(optional, shown in the top bar)</span></label>
                <input id="edit-user-job-title" type="text" maxLength={120} value={userForm.jobTitle} onChange={(e) => setUserForm({ ...userForm, jobTitle: e.target.value })} placeholder="e.g. Product Owner" className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" data-testid="edit-user-job-title" />
              </div>
            )}
            <div>
              <label htmlFor="edit-user-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email</label>
              {/* Another person's e-mail: super admins only (server: canChangeUserEmail); yourself: always. */}
              <input id="edit-user-email" type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} readOnly={!!selectedUser && selectedUser.id !== user?.id && !canChangeUserEmail(actor, asTarget(selectedUser))} aria-describedby={!!selectedUser && selectedUser.id !== user?.id && !canChangeUserEmail(actor, asTarget(selectedUser)) ? 'edit-user-email-note' : undefined} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 read-only:opacity-70" required />
              {!!selectedUser && selectedUser.id !== user?.id && !canChangeUserEmail(actor, asTarget(selectedUser)) && (
                <p id="edit-user-email-note" className="mt-1 text-xs text-gray-500 dark:text-slate-400">Only a super admin can change another person's e-mail address.</p>
              )}
            </div>
            <div>
              <label htmlFor="edit-user-role" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Role</label>
              {/* Roles the caller may assign (server: canAssignRole); the current role is kept as an option. */}
              {canEditTargetAssignment(selectedUser) && selectedUser && canAssignRole(highestRole(actor), selectedUser.role) ? (
                <select id="edit-user-role" value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500">
                  {roles.map(role => (<option key={role.id} value={role.id}>{role.name}</option>))}
                </select>
              ) : (
                <div className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-gray-100 dark:bg-slate-700 text-gray-900 dark:text-white">
                  <span className="flex items-center gap-2">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${selectedUser?.role === 'super_admin' ? 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200' :
                      selectedUser?.role === 'qa_manager' ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200' :
                        selectedUser?.role === 'team_lead' ? 'bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200' :
                          'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                      }`}>{getRoleDisplay(selectedUser?.role || '')}</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {selectedUser?.id === user?.id ? '(You cannot change your own role)' : '(You cannot change this role)'}
                    </span>
                  </span>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="edit-user-department" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Department</label>
              {/* Only super_admin can move a user to another department */}
              {user?.role === 'super_admin' && canEditTargetAssignment(selectedUser) ? (
                <select id="edit-user-department" value={userForm.departmentId} onChange={(e) => setUserForm({ ...userForm, departmentId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required>
                  <option value="">Select a department</option>
                  {departments.map(dept => (<option key={dept.id} value={dept.id}>{dept.name}</option>))}
                </select>
              ) : (
                <div className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-gray-100 dark:bg-slate-700 text-gray-900 dark:text-white">
                  <span className="flex items-center gap-2">
                    <span className="text-sm">{departments.find(d => d.id === userForm.departmentId)?.name || 'No department'}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{selectedUser?.id === user?.id ? '(You cannot change your own department)' : '(Only Super Admin can change)'}</span>
                  </span>
                </div>
              )}
            </div>
            {canEditTargetAssignment(selectedUser) && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Role, department and team set the primary assignment. Further assignments (another team, a second department) are added with the chips on the user card.
              </p>
            )}
            {/* Primary team (not editable for yourself; optional for TEAM_OPTIONAL_ROLES) */}
            {userForm.role && canEditTargetAssignment(selectedUser) && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Primary Team {TEAM_OPTIONAL_ROLES.includes(userForm.role) ? '(Optional)' : ''}
                </label>
                <select
                  value={userForm.primaryTeamId}
                  onChange={(e) => setUserForm({ ...userForm, primaryTeamId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500"
                  required={!TEAM_OPTIONAL_ROLES.includes(userForm.role)}
                >
                  <option value="">{TEAM_OPTIONAL_ROLES.includes(userForm.role) ? 'No team' : 'Select a team'}</option>
                  {teams.filter(t => t.department_id === userForm.departmentId).map(team => (<option key={team.id} value={team.id}>{team.name}</option>))}
                </select>
              </div>
            )}
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
            <div className="rounded-md border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 p-3" data-testid="send-reset-link-box">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Recommended: e-mail {selectedUser?.id === user?.id ? 'yourself' : 'them'} a link to choose a new password. It works once and expires in 60 minutes.
              </p>
              <button
                type="button" disabled={sendingResetLink} data-testid="send-reset-link-btn"
                onClick={async () => {
                  if (!selectedUser) return;
                  setSendingResetLink(true);
                  try {
                    const response = await fetch(`${API_URL}/admin/users/${selectedUser.id}/send-reset-link`, { method: 'POST', credentials: 'include' });
                    const body = await response.json().catch(() => ({}));
                    if (response.ok && body.delivered) {
                      toast.success(body.message || 'Reset link sent');
                      setShowPasswordModal(false);
                    } else if (response.ok) {
                      toast.error(body.message || 'The e-mail could not be sent.');
                    } else {
                      toast.error(`Failed: ${body.error || 'Unknown error'}`);
                    }
                  } catch {
                    toast.error('Error sending the reset link');
                  } finally {
                    setSendingResetLink(false);
                  }
                }}
                className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 border border-cyan-600 text-cyan-700 dark:text-cyan-300 dark:border-cyan-500 rounded-md text-sm hover:bg-cyan-50 dark:hover:bg-slate-700 disabled:opacity-60 transition-colors"
              >
                <Send size={14} />{sendingResetLink ? 'Sending…' : 'Send reset link'}
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 dark:border-slate-700 p-3">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {selectedUser?.id === user?.id ? 'Sign out on all your other devices.' : 'Sign them out on every device and browser.'}
              </p>
              <button
                type="button" data-testid="sign-out-everywhere-btn"
                onClick={async () => {
                  if (!selectedUser) return;
                  try {
                    const response = await fetch(`${API_URL}/admin/users/${selectedUser.id}/sign-out-everywhere`, { method: 'POST', credentials: 'include' });
                    const body = await response.json().catch(() => ({}));
                    if (response.ok) toast.success(body.message || 'Signed out everywhere');
                    else toast.error(`Failed: ${body.error || 'Unknown error'}`);
                  } catch {
                    toast.error('Error signing the user out');
                  }
                }}
                className="shrink-0 px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
              >
                Sign out everywhere
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400">Or set a new password yourself and tell them (this also signs them out everywhere):</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">New Password</label>
              <input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} placeholder="Enter new password" aria-describedby="reset-password-rules" data-testid="reset-password-input" />
              <p id="reset-password-rules" className="mt-1 text-xs text-gray-500 dark:text-slate-400">{PASSWORD_RULES_TEXT}</p>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setShowPasswordModal(false)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
            <button type="submit" className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md transition-colors"><Key size={18} />Reset Password</button>
          </div>
        </form>
      </Modal>
    </div >
  );
};

export default UsersView;
