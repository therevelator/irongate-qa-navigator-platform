import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Building2, Search, Plus, Edit2, Trash2, Save, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Modal from './Modal';
import { confirmDelete } from '../utils/alerts';
import { Page, PageIntro, Card, EmptyState, buttonClass, inputClass, cx } from './ui';
import {
  DepartmentTeamsPanel, MoveTeamDialog,
  type CandidateTeam, type DepartmentDetail, type MoveRequest,
} from './DepartmentTeams';
import { AssignmentDialog, type AssignmentRequest, type CompanyUser } from './RoleAssignment';

interface Department {
  id: string;
  name: string;
  description: string | null;
  company_id: string;
  created_at: string;
  /** Active teams (teams.department_id). */
  team_count: number;
  inactive_team_count: number;
  /** Active users (users.department_id). */
  user_count: number;
}

import API_URL from '../config/api';

interface DepartmentsViewProps {
  /** Open a team's detail page (the same view the dashboard opens). */
  onOpenTeam?: (teamId: string) => void;
  /** Called after a team changed department, so app-wide team lists and analytics scope refresh. */
  onTeamsChanged?: () => void;
}

const OPEN_KEY = 'irongate_departments_open';
const readOpen = () => { try { return sessionStorage.getItem(OPEN_KEY); } catch { return null; } };
const writeOpen = (id: string | null) => {
  try { if (id) sessionStorage.setItem(OPEN_KEY, id); else sessionStorage.removeItem(OPEN_KEY); } catch { /* storage unavailable */ }
};

const TH = 'px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400';

const DepartmentsView: React.FC<DepartmentsViewProps> = ({ onOpenTeam, onTeamsChanged }) => {
  const { user } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<CandidateTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  const [deptForm, setDeptForm] = useState({ name: '', description: '' });
  const [openId, setOpenId] = useState<string | null>(readOpen);
  const [details, setDetails] = useState<Record<string, DepartmentDetail>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [moveRequest, setMoveRequest] = useState<MoveRequest | null>(null);
  const [assignment, setAssignment] = useState<AssignmentRequest | null>(null);
  const [users, setUsers] = useState<CompanyUser[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [deptsRes, teamsRes, usersRes] = await Promise.all([
        fetch(`${API_URL}/admin/departments/all`, { credentials: 'include' }),
        fetch(`${API_URL}/admin/teams`, { credentials: 'include' }),
        fetch(`${API_URL}/admin/users`, { credentials: 'include' }),
      ]);
      if (deptsRes.ok) setDepartments(await deptsRes.json());
      if (teamsRes.ok) setTeams(await teamsRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDetail = useCallback(async (deptId: string) => {
    try {
      const res = await fetch(`${API_URL}/admin/departments/${encodeURIComponent(deptId)}/teams`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Could not load teams (${res.status})`);
      setDetails((d) => ({ ...d, [deptId]: data }));
      setDetailErrors((m) => { const next = { ...m }; delete next[deptId]; return next; });
    } catch (e: any) {
      setDetailErrors((m) => ({ ...m, [deptId]: e?.message || 'Could not load teams' }));
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (openId) fetchDetail(openId);
  }, [openId, fetchDetail]);

  // A remembered department that no longer exists closes.
  useEffect(() => {
    if (!loading && openId && !departments.some((d) => d.id === openId)) {
      setOpenId(null);
      writeOpen(null);
    }
  }, [loading, departments, openId]);

  const toggle = (id: string) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    writeOpen(next);
  };

  const afterMove = async (fromId: string | null, toId: string) => {
    setMoveRequest(null);
    // Drop cached detail for both sides, then reload counts, lists and the open panel.
    setDetails((d) => { const next = { ...d }; if (fromId) delete next[fromId]; delete next[toId]; return next; });
    await fetchData();
    if (openId) await fetchDetail(openId);
    onTeamsChanged?.();
  };

  // After a manager or lead assignment: people may have changed department, so every cached
  // panel is stale; reload counts, users, the open panel and the app-wide team list.
  const afterAssignment = async () => {
    setAssignment(null);
    setDetails({});
    await fetchData();
    if (openId) await fetchDetail(openId);
    onTeamsChanged?.();
  };

  const filteredDepartments = departments.filter(d =>
    `${d.name} ${d.description || ''}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500 dark:text-slate-400">Loading departments...</div>
      </div>
    );
  }

  // Only super_admin can view departments
  if (user?.role !== 'super_admin') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500 dark:text-slate-400">Access denied</div>
      </div>
    );
  }

  const deptOptions = departments.map((d) => ({ id: d.id, name: d.name }));

  return (
    <Page>
      <PageIntro
        title="Departments"
        description={`${filteredDepartments.length} department${filteredDepartments.length === 1 ? '' : 's'} · open one to see its teams and reassign them`}
        actions={
          <button
            onClick={() => {
              setDeptForm({ name: '', description: '' });
              setShowCreateModal(true);
            }}
            className={buttonClass.primary}
          >
            <Plus size={16} aria-hidden="true" />
            Create department
          </button>
        }
      />

      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={16} aria-hidden="true" />
        <input
          type="search"
          aria-label="Search departments"
          placeholder="Search departments..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className={cx(inputClass, 'w-full pl-9')}
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
              <tr>
                <th scope="col" className={TH}>Department</th>
                <th scope="col" className={TH}>Description</th>
                <th scope="col" className={cx(TH, 'text-right')}>Teams</th>
                <th scope="col" className={cx(TH, 'text-right')}>Users</th>
                <th scope="col" className={TH}>Created</th>
                <th scope="col" className={cx(TH, 'text-right')}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDepartments.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState icon={<Building2 size={28} aria-hidden="true" />} title="No departments found" description={searchTerm ? 'No department matches your search.' : 'Create a department to group teams.'} />
                  </td>
                </tr>
              ) : (
                filteredDepartments.map((dept) => {
                  const open = openId === dept.id;
                  const panelId = `dept-panel-${dept.id}`;
                  return (
                    <React.Fragment key={dept.id}>
                    <tr
                      onClick={() => toggle(dept.id)}
                      className={cx(
                        'cursor-pointer border-t border-slate-200 transition-colors first:border-t-0 dark:border-slate-800',
                        open ? 'bg-slate-50 dark:bg-slate-800/50' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40',
                      )}
                    >
                      <td className="px-6 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-controls={panelId}
                          onClick={(e) => { e.stopPropagation(); toggle(dept.id); }}
                          className="-ml-1.5 inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-sm font-medium text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-white"
                        >
                          <ChevronRight size={16} aria-hidden="true" className={cx('text-slate-400 transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
                          {dept.name}
                        </button>
                      </td>
                      <td className="px-6 py-3">
                        <div className={cx('text-sm', dept.description ? 'text-slate-600 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500')}>{dept.description || 'No description'}</div>
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap text-right text-sm tabular-nums text-slate-900 dark:text-white">
                        {dept.team_count}
                        {dept.inactive_team_count > 0 && <span className="ml-1 text-xs text-slate-400 dark:text-slate-500" title={`${dept.inactive_team_count} inactive`}>+{dept.inactive_team_count} inactive</span>}
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap text-right text-sm tabular-nums text-slate-900 dark:text-white">{dept.user_count}</td>
                      <td className="px-6 py-3 whitespace-nowrap">
                        <div className="text-sm text-slate-600 dark:text-slate-400">
                          {new Date(dept.created_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => {
                              setSelectedDept(dept);
                              setDeptForm({ name: dept.name, description: dept.description || '' });
                              setShowEditModal(true);
                            }}
                            className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-slate-800 dark:hover:text-brand-300"
                            title="Edit department"
                            aria-label={`Edit ${dept.name}`}
                          >
                            <Edit2 size={16} aria-hidden="true" />
                          </button>
                          <button
                            onClick={async () => {
                              const result = await confirmDelete(
                                dept.name,
                                `department<br><small>This will affect ${dept.team_count} teams and ${dept.user_count} users</small>`
                              );
                              if (result.isConfirmed) {
                                try {
                                  const response = await fetch(`${API_URL}/admin/departments/${dept.id}`, {
                                    method: 'DELETE',
                                    credentials: 'include'
                                  });
                                  
                                  if (response.ok) {
                                    toast.success('Department deleted successfully!');
                                    fetchData();
                                  } else {
                                    const err = await response.json().catch(() => ({}));
                                    toast.error(err.error || 'Failed to delete department');
                                  }
                                } catch (error) {
                                  console.error('Error deleting department:', error);
                                  toast.error('Error deleting department');
                                }
                              }
                            }}
                            className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-slate-800 dark:hover:text-red-400"
                            title="Delete department"
                            aria-label={`Delete ${dept.name}`}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr id={panelId} className="border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40">
                        <td colSpan={6} className="p-0">
                          <DepartmentTeamsPanel
                            departmentId={dept.id}
                            departmentName={dept.name}
                            detail={details[dept.id] ?? null}
                            error={detailErrors[dept.id] ?? null}
                            departments={deptOptions}
                            onOpenTeam={onOpenTeam}
                            onRequestMove={setMoveRequest}
                            onRequestAssignment={setAssignment}
                          />
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <AssignmentDialog request={assignment} users={users} onClose={() => setAssignment(null)} onDone={afterAssignment} />

      <MoveTeamDialog
        request={moveRequest}
        departments={deptOptions}
        candidates={teams}
        onClose={() => setMoveRequest(null)}
        onMoved={(plan) => afterMove(plan.from?.id ?? null, plan.to.id)}
      />

      {/* Create Department Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create New Department" size="md">
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            const response = await fetch(`${API_URL}/admin/departments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                name: deptForm.name,
                description: deptForm.description || null
              })
            });
            
            if (response.ok) {
              setShowCreateModal(false);
              setDeptForm({ name: '', description: '' });
              toast.success('Department created successfully!');
              fetchData();
            } else {
              const errorData = await response.json();
              toast.error(`Failed to create department: ${errorData.error || 'Unknown error'}`);
            }
          } catch (error) {
            console.error('Error creating department:', error);
            toast.error('Error creating department');
          }
        }}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Department Name</label>
              <input type="text" value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} className={cx(inputClass, 'w-full')} required placeholder="Enter department name" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
              <textarea value={deptForm.description} onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })} rows={3} className={cx(inputClass.replace('h-9', 'h-auto'), 'w-full py-2')} placeholder="Brief description of the department" />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setShowCreateModal(false)} className={buttonClass.secondary}>Cancel</button>
            <button type="submit" className={buttonClass.primary}><Plus size={16} aria-hidden="true" />Create department</button>
          </div>
        </form>
      </Modal>

      {/* Edit Department Modal */}
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title={`Edit Department: ${selectedDept?.name}`} size="md">
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            const response = await fetch(`${API_URL}/admin/departments/${selectedDept?.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                name: deptForm.name,
                description: deptForm.description || null
              })
            });
            
            if (response.ok) {
              setShowEditModal(false);
              toast.success('Department updated successfully!');
              fetchData();
            } else {
              const errorData = await response.json();
              toast.error(`Failed to update department: ${errorData.error || 'Unknown error'}`);
            }
          } catch (error) {
            console.error('Error updating department:', error);
            toast.error('Error updating department');
          }
        }}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Department Name</label>
              <input type="text" value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} className={cx(inputClass, 'w-full')} required />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
              <textarea value={deptForm.description} onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })} rows={3} className={cx(inputClass.replace('h-9', 'h-auto'), 'w-full py-2')} />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setShowEditModal(false)} className={buttonClass.secondary}>Cancel</button>
            <button type="submit" className={buttonClass.primary}><Save size={16} aria-hidden="true" />Save changes</button>
          </div>
        </form>
      </Modal>
    </Page>
  );
};

export default DepartmentsView;
