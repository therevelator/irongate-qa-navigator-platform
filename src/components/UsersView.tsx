import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Users, Search, Edit2, Key, Trash2, UserPlus, Save, UserCheck, UserX } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Modal from './Modal';
import { confirmDelete } from '../utils/alerts';

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
}

import API_URL from '../config/api';

const UsersView: React.FC = () => {
  const { user } = useAuth();
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
        fetch(`${API_URL}/admin/users`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('irongate_token')}` }
        }),
        fetch(`${API_URL}/admin/teams`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('irongate_token')}` }
        }),
        fetch(`${API_URL}/admin/departments`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('irongate_token')}` }
        }),
        fetch(`${API_URL}/admin/available-roles`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('irongate_token')}` }
        })
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
        // API returns { availableRoles: [...] }
        const rolesList = data.availableRoles || [];
        setRoles(rolesList.map((r: string) => ({ 
          id: r, 
          name: r.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        })));
      } else {
        // Fallback roles if API fails
        setRoles([
          { id: 'super_admin', name: 'Super Admin' },
          { id: 'manager', name: 'Manager' },
          { id: 'team_lead', name: 'Team Lead' },
          { id: 'qa_engineer', name: 'QA Engineer' },
          { id: 'viewer', name: 'Viewer' }
        ]);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      // Fallback roles on error
      setRoles([
        { id: 'super_admin', name: 'Super Admin' },
        { id: 'manager', name: 'Manager' },
        { id: 'team_lead', name: 'Team Lead' },
        { id: 'qa_engineer', name: 'QA Engineer' },
        { id: 'viewer', name: 'Viewer' }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = users.filter(u =>
    `${u.first_name} ${u.last_name} ${u.email} ${u.department_name || ''} ${u.team_name || ''}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase())
  );

  const getRoleDisplay = (role: string) => {
    const roleMap: Record<string, string> = {
      super_admin: 'Super Admin',
      manager: 'Manager',
      team_lead: 'Lead',
      qa_engineer: 'Engineer',
      viewer: 'Viewer'
    };
    return roleMap[role] || role;
  };

  const canManageUsers = user?.role === 'super_admin' || user?.role === 'manager' || user?.role === 'team_lead';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-slate-950">
        <div className="text-gray-500 dark:text-slate-400">Loading users...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Users className="w-8 h-8 text-gray-600 dark:text-slate-400" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
              <p className="text-sm text-gray-500 dark:text-slate-400">{filteredUsers.length} users</p>
            </div>
          </div>
          
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
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 dark:bg-cyan-600 dark:hover:bg-cyan-700 text-white rounded-md transition-colors"
            >
              <UserPlus size={20} />
              Create User
            </button>
          )}
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-slate-500" size={20} />
            <input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-gray-500 dark:focus:ring-slate-600"
            />
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider w-[180px]">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider w-[220px]">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider w-[120px]">
                  Role
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider w-[160px]">
                  Department
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider w-[160px]">
                  Team
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider w-[100px]">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider w-[140px]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <Users className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                    <p className="text-gray-500 dark:text-slate-400">No users found</p>
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium text-sm text-gray-900 dark:text-white">
                        {u.first_name} {u.last_name}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-600 dark:text-slate-400">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs font-medium rounded-md bg-gray-700 dark:bg-slate-600 text-white">
                        {getRoleDisplay(u.role)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-600 dark:text-slate-400">{u.department_name || '-'}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-600 dark:text-slate-400">{u.team_name || '-'}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-md ${
                        u.is_active 
                          ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' 
                          : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                      }`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1">
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
                          className="p-1.5 text-gray-400 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors rounded hover:bg-gray-100 dark:hover:bg-slate-700"
                          title="Edit user"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => {
                            setSelectedUser(u);
                            setUserForm({ ...userForm, password: '' });
                            setShowPasswordModal(true);
                          }}
                          className="p-1.5 text-gray-400 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors rounded hover:bg-gray-100 dark:hover:bg-slate-700"
                          title="Reset password"
                        >
                          <Key size={16} />
                        </button>
                        {canManageUsers && u.id !== user?.id && (
                          <>
                            <button
                              onClick={async () => {
                                try {
                                  const response = await fetch(`${API_URL}/admin/users/${u.id}/toggle-status`, {
                                    method: 'POST',
                                    headers: {
                                      'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`
                                    }
                                  });
                                  
                                  if (response.ok) {
                                    toast.success(`User ${u.is_active ? 'deactivated' : 'activated'} successfully!`);
                                    fetchUsers();
                                  } else {
                                    toast.error('Failed to update user status');
                                  }
                                } catch (error) {
                                  console.error('Error toggling user status:', error);
                                  toast.error('Error updating user status');
                                }
                              }}
                              className={`p-1.5 transition-colors rounded hover:bg-gray-100 dark:hover:bg-slate-700 ${
                                u.is_active
                                  ? 'text-gray-400 dark:text-slate-400 hover:text-orange-500 dark:hover:text-orange-400'
                                  : 'text-gray-400 dark:text-slate-400 hover:text-green-500 dark:hover:text-green-400'
                              }`}
                              title={u.is_active ? 'Deactivate user' : 'Activate user'}
                            >
                              {u.is_active ? <UserX size={16} /> : <UserCheck size={16} />}
                            </button>
                            <button
                              onClick={async () => {
                                const result = await confirmDelete(`${u.first_name} ${u.last_name}`, 'user');
                                if (result.isConfirmed) {
                                  try {
                                    const response = await fetch(`${API_URL}/admin/users/${u.id}`, {
                                      method: 'DELETE',
                                      headers: {
                                        'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`
                                      }
                                    });
                                    
                                    if (response.ok) {
                                      toast.success('User deleted successfully!');
                                      fetchUsers();
                                    } else {
                                      toast.error('Failed to delete user');
                                    }
                                  } catch (error) {
                                    console.error('Error deleting user:', error);
                                    toast.error('Error deleting user');
                                  }
                                }
                              }}
                              className="p-1.5 text-gray-400 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded hover:bg-gray-100 dark:hover:bg-slate-700"
                              title="Delete user"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create New User" size="md">
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            const response = await fetch(`${API_URL}/admin/users`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`
              },
              body: JSON.stringify({
                firstName: userForm.firstName,
                lastName: userForm.lastName,
                email: userForm.email,
                password: userForm.password,
                role: userForm.role,
                departmentId: userForm.departmentId,
                primaryTeamId: userForm.primaryTeamId || null
              })
            });
            
            if (response.ok) {
              setShowCreateModal(false);
              setUserForm({ firstName: '', lastName: '', email: '', role: '', departmentId: '', primaryTeamId: '', password: '' });
              toast.success('User created successfully!');
              fetchUsers();
            } else {
              const errorData = await response.json();
              toast.error(`Failed to create user: ${errorData.error || 'Unknown error'}`);
            }
          } catch (error) {
            console.error('Error creating user:', error);
            toast.error('Error creating user');
          }
        }}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">First Name</label>
                <input type="text" value={userForm.firstName} onChange={(e) => setUserForm({ ...userForm, firstName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Last Name</label>
                <input type="text" value={userForm.lastName} onChange={(e) => setUserForm({ ...userForm, lastName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" required />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email</label>
              <input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Password</label>
              <input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" required minLength={6} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Role</label>
              <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" required>
                <option value="">Select a role</option>
                {roles.map(role => (<option key={role.id} value={role.id}>{role.name}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Department</label>
              <select value={userForm.departmentId} onChange={(e) => setUserForm({ ...userForm, departmentId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" required>
                <option value="">Select a department</option>
                {departments.map(dept => (<option key={dept.id} value={dept.id}>{dept.name}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Primary Team (Optional)</label>
              <select value={userForm.primaryTeamId} onChange={(e) => setUserForm({ ...userForm, primaryTeamId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent">
                <option value="">No team</option>
                {teams.filter(t => t.department_id === userForm.departmentId).map(team => (<option key={team.id} value={team.id}>{team.name}</option>))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
            <button type="submit" className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md transition-colors"><UserPlus size={18} />Create User</button>
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
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`
              },
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
              toast.error(`Failed to update user: ${errorData.error || 'Unknown error'}`);
            }
          } catch (error) {
            console.error('Error updating user:', error);
            toast.error('Error updating user');
          }
        }}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">First Name</label>
                <input type="text" value={userForm.firstName} onChange={(e) => setUserForm({ ...userForm, firstName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Last Name</label>
                <input type="text" value={userForm.lastName} onChange={(e) => setUserForm({ ...userForm, lastName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" required />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email</label>
              <input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Role</label>
              {selectedUser?.role === 'super_admin' ? (
                <div className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-gray-100 dark:bg-slate-700 text-gray-900 dark:text-white">
                  <span className="flex items-center gap-2">
                    <span className="px-2 py-1 text-xs font-medium rounded bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200">
                      Super Admin
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">(Role cannot be changed)</span>
                  </span>
                </div>
              ) : (
                <select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" required>
                  <option value="">Select a role</option>
                  {roles.map(role => (<option key={role.id} value={role.id}>{role.name}</option>))}
                </select>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Department</label>
              <select value={userForm.departmentId} onChange={(e) => setUserForm({ ...userForm, departmentId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" required>
                <option value="">Select a department</option>
                {departments.map(dept => (<option key={dept.id} value={dept.id}>{dept.name}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Primary Team (Optional)</label>
              <select value={userForm.primaryTeamId} onChange={(e) => setUserForm({ ...userForm, primaryTeamId: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent">
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
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`
              },
              body: JSON.stringify({ newPassword: userForm.password })
            });
            
            if (response.ok) {
              setShowPasswordModal(false);
              setUserForm({ ...userForm, password: '' });
              toast.success('Password reset successfully!');
            } else {
              const errorData = await response.json();
              toast.error(`Failed to reset password: ${errorData.error || 'Unknown error'}`);
            }
          } catch (error) {
            console.error('Error resetting password:', error);
            toast.error('Error resetting password');
          }
        }}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">New Password</label>
              <input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" required minLength={6} placeholder="Enter new password" />
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
