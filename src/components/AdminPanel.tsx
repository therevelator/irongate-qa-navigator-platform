import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Shield, X, ArrowLeft, Building2, Edit2, Trash2, ChevronDown, ChevronRight, Key } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import toast, { Toaster } from 'react-hot-toast';

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  team_name: string;
  department_name: string;
  primary_team_id: string;
  is_active: boolean;
  created_at: string;
}

interface Team {
  id: string;
  name: string;
  platform: string;
  description?: string;
  is_active?: boolean;
  created_at?: string;
  department_id?: string;
}

interface Department {
  id: string;
  name: string;
  description: string;
  company_id: string;
  created_at: string;
}

const API_URL = 'http://localhost:3000/api';

interface AdminPanelProps {
  onBack?: () => void;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ onBack }) => {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [availableRoles, setAvailableRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [showCreateDepartment, setShowCreateDepartment] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null);
  const [showEditUser, setShowEditUser] = useState(false);
  const [showEditDepartment, setShowEditDepartment] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteDepartmentConfirm, setShowDeleteDepartmentConfirm] = useState(false);
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const [expandedDepartments, setExpandedDepartments] = useState<Set<string>>(new Set());
  const [editUserData, setEditUserData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: ''
  });

  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: '',
    teamId: ''
  });

  const [newTeam, setNewTeam] = useState({
    name: '',
    description: '',
    departmentId: ''
  });

  const [newDepartment, setNewDepartment] = useState({
    name: '',
    description: ''
  });

  const [resetPasswordData, setResetPasswordData] = useState({
    newPassword: '',
    confirmPassword: ''
  });

  const token = localStorage.getItem('irongate_token');

  useEffect(() => {
    if (token) {
      fetchData();
    }
  }, [token]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch users
      const usersRes = await fetch(`${API_URL}/admin/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setUsers(Array.isArray(usersData) ? usersData : []);
      } else {
        console.error('Failed to fetch users:', await usersRes.text());
        setUsers([]);
      }

      // Fetch teams
      const teamsRes = await fetch(`${API_URL}/teams`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (teamsRes.ok) {
        const teamsData = await teamsRes.json();
        // Handle both array and {teams: array} response formats
        const teamsList = Array.isArray(teamsData) ? teamsData : (teamsData.teams || []);
        console.log('Fetched teams:', teamsList);
        setTeams(teamsList);
      } else {
        console.error('Failed to fetch teams:', await teamsRes.text());
        setTeams([]);
      }

      // Fetch available roles
      const rolesRes = await fetch(`${API_URL}/admin/available-roles`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (rolesRes.ok) {
        const rolesData = await rolesRes.json();
        setAvailableRoles(rolesData.availableRoles || []);
      } else {
        console.error('Failed to fetch roles:', await rolesRes.text());
        setAvailableRoles([]);
      }

      // Fetch departments (Super Admin only)
      if (user?.role === 'super_admin') {
        const deptsRes = await fetch(`${API_URL}/admin/departments/all`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (deptsRes.ok) {
          const deptsData = await deptsRes.json();
          setDepartments(Array.isArray(deptsData) ? deptsData : []);
        } else {
          console.error('Failed to fetch departments:', await deptsRes.text());
          setDepartments([]);
        }
      }

    } catch (error) {
      console.error('Error fetching data:', error);
      setUsers([]);
      setTeams([]);
      setAvailableRoles([]);
      setDepartments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      // Get department from selected team
      const selectedTeamObj = teams.find(t => t.id === newUser.teamId);
      const departmentId = selectedTeamObj?.department_id || user?.departmentId;
      
      const response = await fetch(`${API_URL}/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...newUser,
          departmentId
        })
      });

      if (response.ok) {
        toast.success('User created successfully!');
        setShowCreateUser(false);
        setNewUser({ email: '', password: '', firstName: '', lastName: '', role: '', teamId: '' });
        await fetchData(); // Wait for data to refresh
        // If we're viewing a team, the users list will be updated automatically
      } else {
        const error = await response.json();
        toast.error(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error('Failed to create user');
    }
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const response = await fetch(`${API_URL}/admin/teams`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newTeam)
      });

      if (response.ok) {
        toast.success('Team created successfully!');
        setShowCreateTeam(false);
        setNewTeam({ name: '', description: '', departmentId: '' });
        fetchData();
      } else {
        const error = await response.json();
        toast.error(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error creating team:', error);
      toast.error('Failed to create team');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (resetPasswordData.newPassword !== resetPasswordData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (resetPasswordData.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/admin/users/${selectedUser?.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ newPassword: resetPasswordData.newPassword })
      });

      if (response.ok) {
        toast.success('Password reset successfully!');
        setShowResetPassword(false);
        setSelectedUser(null);
        setResetPasswordData({ newPassword: '', confirmPassword: '' });
      } else {
        const error = await response.json();
        toast.error(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error resetting password:', error);
      toast.error('Failed to reset password');
    }
  };

  // Department handlers
  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newDepartment.name.trim()) {
      toast.error('Department name is required');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/admin/departments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newDepartment)
      });

      if (response.ok) {
        toast.success('Department created successfully!');
        setShowCreateDepartment(false);
        setNewDepartment({ name: '', description: '' });
        fetchData();
      } else {
        const error = await response.json();
        toast.error(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error creating department:', error);
      toast.error('Failed to create department');
    }
  };

  const handleEditDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedDepartment) return;

    try {
      const response = await fetch(`${API_URL}/admin/departments/${selectedDepartment.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newDepartment)
      });

      if (response.ok) {
        toast.success('Department updated successfully!');
        setShowEditDepartment(false);
        setSelectedDepartment(null);
        setNewDepartment({ name: '', description: '' });
        fetchData();
      } else {
        const error = await response.json();
        toast.error(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error updating department:', error);
      toast.error('Failed to update department');
    }
  };

  const handleDeleteDepartment = async () => {
    if (!selectedDepartment) return;

    try {
      const response = await fetch(`${API_URL}/admin/departments/${selectedDepartment.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        toast.success('Department deleted successfully!');
        setShowDeleteDepartmentConfirm(false);
        setSelectedDepartment(null);
        fetchData();
      } else {
        const error = await response.json();
        toast.error(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error deleting department:', error);
      toast.error('Failed to delete department');
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const response = await fetch(`${API_URL}/users/${selectedUser?.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(editUserData)
      });

      if (response.ok) {
        toast.success('User updated successfully!');
        setShowEditUser(false);
        setSelectedUser(null);
        fetchData();
      } else {
        const error = await response.json();
        toast.error(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error updating user:', error);
      toast.error('Failed to update user');
    }
  };

  const handleDeleteUser = async () => {
    try {
      const response = await fetch(`${API_URL}/admin/users/${selectedUser?.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        toast.success('User deleted successfully!');
        setShowDeleteConfirm(false);
        setSelectedUser(null);
        setSelectedTeam(null);
        fetchData();
      } else {
        const error = await response.json();
        toast.error(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      toast.error('Failed to delete user');
    }
  };

  const getRoleBadgeColor = (role: string) => {
    const colors: Record<string, string> = {
      super_admin: 'bg-purple-100 text-purple-800',
      qa_manager: 'bg-blue-100 text-blue-800',
      team_lead: 'bg-green-100 text-green-800',
      qa_engineer: 'bg-yellow-100 text-yellow-800',
      viewer: 'bg-gray-100 text-gray-800'
    };
    return colors[role] || 'bg-gray-100 text-gray-800';
  };

  const canCreateTeam = user?.role === 'qa_manager' || user?.role === 'super_admin';

  const toggleDepartment = (deptId: string) => {
    const newExpanded = new Set(expandedDepartments);
    if (newExpanded.has(deptId)) {
      newExpanded.delete(deptId);
    } else {
      newExpanded.add(deptId);
    }
    setExpandedDepartments(newExpanded);
  };

  const toggleTeam = (teamId: string) => {
    const newExpanded = new Set(expandedTeams);
    if (newExpanded.has(teamId)) {
      newExpanded.delete(teamId);
    } else {
      newExpanded.add(teamId);
    }
    setExpandedTeams(newExpanded);
  };

  const getTeamsByDepartment = (deptId: string) => {
    return teams.filter(t => t.department_id === deptId);
  };

  const getUsersByTeam = (teamId: string) => {
    return users.filter(u => u.primary_team_id === teamId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <>
      <Toaster position="top-right" />
      {/* Team Detail View */}
      {selectedTeam ? (
        <div className="min-h-screen bg-gray-50 p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Back Button */}
            <button
              onClick={() => setSelectedTeam(null)}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Teams
            </button>

            {/* Team Header */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{selectedTeam.name}</h1>
                  <p className="text-sm text-gray-600 mt-1">{selectedTeam.description || 'No description'}</p>
                  <div className="flex gap-2 mt-2">
                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                      {selectedTeam.platform}
                    </span>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${selectedTeam.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {selectedTeam.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600">{teamUsers.length}</div>
                  <div className="text-sm text-gray-600">Team Members</div>
                </div>
              </div>
            </div>

            {/* Team Members Table */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Team Members</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {teamUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                          No team members found
                        </td>
                      </tr>
                    ) : (
                      teamUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="font-medium text-gray-900">{u.first_name} {u.last_name}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{u.email}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${getRoleBadgeColor(u.role)}`}>
                              {u.role.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                              {u.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                            <button
                              onClick={() => {
                                setSelectedUser(u);
                                setEditUserData({
                                  firstName: u.first_name,
                                  lastName: u.last_name,
                                  email: u.email,
                                  role: u.role
                                });
                                setShowEditUser(true);
                              }}
                              className="text-blue-600 hover:text-blue-800 font-medium"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                setSelectedUser(u);
                                setShowResetPassword(true);
                              }}
                              className="text-green-600 hover:text-green-800 font-medium"
                            >
                              Reset Password
                            </button>
                            {u.id !== user?.id && (
                              <button
                                onClick={() => {
                                  setSelectedUser(u);
                                  setShowDeleteConfirm(true);
                                }}
                                className="text-red-600 hover:text-red-800 font-medium"
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Main Admin Panel View */
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Back Button */}
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Dashboard
          </button>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Admin Control Panel</h1>
              <p className="text-sm text-gray-600">Manage users and teams</p>
            </div>
          </div>
        <div className="flex gap-3">
          {availableRoles.length > 0 && (
            <button
              onClick={() => setShowCreateUser(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <UserPlus className="w-5 h-5" />
              Create User
            </button>
          )}
          {canCreateTeam && (
            <button
              onClick={() => setShowCreateTeam(true)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              <Users className="w-5 h-5" />
              Create Team
            </button>
          )}
          {user?.role === 'super_admin' && (
            <button
              onClick={() => setShowCreateDepartment(true)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
            >
              <Building2 className="w-5 h-5" />
              Create Department
            </button>
          )}
        </div>
      </div>

      {/* Hierarchical View: Departments → Teams → Users */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Organization Structure</h2>
          <p className="text-sm text-gray-600 mt-1">Departments → Teams → Users</p>
        </div>
        <div className="divide-y divide-gray-200">
          {departments.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Building2 className="w-16 h-16 mx-auto mb-3 text-gray-300" />
              <p className="text-lg font-medium">No departments yet</p>
              <p className="text-sm mt-1">Create a department to get started</p>
            </div>
          ) : (
            departments.map((dept) => {
              const deptTeams = getTeamsByDepartment(dept.id);
              const isDeptExpanded = expandedDepartments.has(dept.id);
              
              return (
                <div key={dept.id} className="transition-all">
                  {/* Department Header */}
                  <div
                    onClick={() => toggleDepartment(dept.id)}
                    className="px-6 py-4 hover:bg-purple-50 cursor-pointer flex items-center justify-between bg-gradient-to-r from-purple-50/50 to-transparent"
                  >
                    <div className="flex items-center gap-4 flex-1">
                      <div className="flex items-center gap-2">
                        {isDeptExpanded ? (
                          <ChevronDown className="w-6 h-6 text-purple-600" />
                        ) : (
                          <ChevronRight className="w-6 h-6 text-purple-600" />
                        )}
                        <Building2 className="w-6 h-6 text-purple-600" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-bold text-gray-900 text-lg">{dept.name}</h3>
                        <p className="text-sm text-gray-600 mt-0.5">{dept.description || 'No description'}</p>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <span className="font-medium">{deptTeams.length} {deptTeams.length === 1 ? 'Team' : 'Teams'}</span>
                        <span className="text-gray-400">•</span>
                        <span>{new Date(dept.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Department Teams - Expandable */}
                  {isDeptExpanded && (
                    <div className="bg-gray-50/50 border-l-4 border-purple-200">
                      {deptTeams.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 ml-12">
                          <Users className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                          <p>No teams in this department yet</p>
                        </div>
                      ) : (
                        deptTeams.map((team) => {
                          const teamUsers = getUsersByTeam(team.id);
                          const isTeamExpanded = expandedTeams.has(team.id);
                          
                          return (
                            <div key={team.id} className="border-b border-gray-200 last:border-b-0">
                              {/* Team Header */}
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleTeam(team.id);
                                }}
                                className="px-6 py-3 ml-8 hover:bg-blue-50 cursor-pointer flex items-center justify-between"
                              >
                                <div className="flex items-center gap-3 flex-1">
                                  <div className="flex items-center gap-2">
                                    {isTeamExpanded ? (
                                      <ChevronDown className="w-5 h-5 text-blue-600" />
                                    ) : (
                                      <ChevronRight className="w-5 h-5 text-blue-600" />
                                    )}
                                    <Users className="w-5 h-5 text-blue-600" />
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <h4 className="font-semibold text-gray-900">{team.name}</h4>
                                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${team.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        {team.is_active ? 'Active' : 'Inactive'}
                                      </span>
                                    </div>
                                    <p className="text-xs text-gray-600 mt-0.5">{team.description || 'No description'}</p>
                                  </div>
                                  <div className="flex items-center gap-3 text-sm text-gray-600">
                                    <span className="font-medium">{teamUsers.length} {teamUsers.length === 1 ? 'User' : 'Users'}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Team Users - Expandable */}
                              {isTeamExpanded && (
                                <div className="bg-white px-6 py-3 ml-16">
                                  {teamUsers.length === 0 ? (
                                    <div className="text-center py-6 text-gray-500">
                                      <Users className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                                      <p className="text-sm">No users in this team yet</p>
                                    </div>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full">
                                        <thead className="bg-gray-50">
                                          <tr>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                                          </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-100">
                                          {teamUsers.map((u) => (
                                            <tr key={u.id} className="hover:bg-gray-50">
                                              <td className="px-3 py-2 whitespace-nowrap">
                                                <div className="font-medium text-gray-900 text-sm">{u.first_name} {u.last_name}</div>
                                              </td>
                                              <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-600">{u.email}</td>
                                              <td className="px-3 py-2 whitespace-nowrap">
                                                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getRoleBadgeColor(u.role)}`}>
                                                  {u.role.replace('_', ' ')}
                                                </span>
                                              </td>
                                              <td className="px-3 py-2 whitespace-nowrap">
                                                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                  {u.is_active ? 'Active' : 'Inactive'}
                                                </span>
                                              </td>
                                              <td className="px-3 py-2 whitespace-nowrap text-sm">
                                                <div className="flex gap-1">
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setSelectedUser(u);
                                                      setEditUserData({
                                                        firstName: u.first_name,
                                                        lastName: u.last_name,
                                                        email: u.email,
                                                        role: u.role
                                                      });
                                                      setShowEditUser(true);
                                                    }}
                                                    className="p-1 text-blue-600 hover:bg-blue-100 rounded"
                                                    title="Edit User"
                                                  >
                                                    <Edit2 className="w-4 h-4" />
                                                  </button>
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setSelectedUser(u);
                                                      setShowResetPassword(true);
                                                    }}
                                                    className="p-1 text-green-600 hover:bg-green-100 rounded"
                                                    title="Reset Password"
                                                  >
                                                    <Key className="w-4 h-4" />
                                                  </button>
                                                  {u.id !== user?.id && (
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedUser(u);
                                                        setShowDeleteConfirm(true);
                                                      }}
                                                      className="p-1 text-red-600 hover:bg-red-100 rounded"
                                                      title="Delete User"
                                                    >
                                                      <Trash2 className="w-4 h-4" />
                                                    </button>
                                                  )}
                                                </div>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Create New User</h3>
              <button onClick={() => setShowCreateUser(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  data-testid="create-user-email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  data-testid="create-user-password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                  <input
                    type="text"
                    required
                    data-testid="create-user-firstname"
                    value={newUser.firstName}
                    onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                  <input
                    type="text"
                    required
                    data-testid="create-user-lastname"
                    value={newUser.lastName}
                    onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  required
                  data-testid="create-user-role"
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select role...</option>
                  {availableRoles.map((role) => (
                    <option key={role} value={role}>{role.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Team {teams.length > 0 && <span className="text-gray-500 font-normal">({teams.length} available)</span>}
                </label>
                <select
                  required
                  data-testid="create-user-team"
                  value={newUser.teamId}
                  onChange={(e) => setNewUser({ ...newUser, teamId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  disabled={teams.length === 0}
                >
                  <option value="">
                    {teams.length === 0 ? 'No teams available - create a team first' : 'Select team...'}
                  </option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name} ({team.platform})
                    </option>
                  ))}
                </select>
                {teams.length === 0 && (
                  <p className="mt-1 text-sm text-red-600">
                    Please create a team first before adding users.
                  </p>
                )}
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Create User
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateUser(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Team Modal */}
      {showCreateTeam && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Create New Team</h3>
              <button onClick={() => setShowCreateTeam(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateTeam} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Team Name</label>
                <input
                  type="text"
                  required
                  name="name"
                  data-testid="create-team-name"
                  value={newTeam.name}
                  onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  name="description"
                  data-testid="create-team-description"
                  value={newTeam.description}
                  onChange={(e) => setNewTeam({ ...newTeam, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {user?.role === 'super_admin' && departments.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Department {departments.length > 0 && <span className="text-gray-500 font-normal">({departments.length} available)</span>}
                  </label>
                  <select
                    required
                    name="departmentId"
                    data-testid="create-team-department"
                    value={newTeam.departmentId}
                    onChange={(e) => setNewTeam({ ...newTeam, departmentId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select department...</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  Create Team
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateTeam(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetPassword && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Reset Password</h3>
              <button onClick={() => setShowResetPassword(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Resetting password for: <strong>{selectedUser.first_name} {selectedUser.last_name}</strong> ({selectedUser.email})
            </p>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  data-testid="reset-password-new"
                  value={resetPasswordData.newPassword}
                  onChange={(e) => setResetPasswordData({ ...resetPasswordData, newPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  data-testid="reset-password-confirm"
                  value={resetPasswordData.confirmPassword}
                  onChange={(e) => setResetPasswordData({ ...resetPasswordData, confirmPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Reset Password
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetPassword(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      </div>
    </div>
      )}

      {/* Modals - Always rendered for both views */}
      {/* Reset Password Modal */}
      {showResetPassword && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Reset Password</h3>
              <button onClick={() => setShowResetPassword(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Resetting password for: <strong>{selectedUser.first_name} {selectedUser.last_name}</strong> ({selectedUser.email})
            </p>
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  data-testid="reset-password-new"
                  value={resetPasswordData.newPassword}
                  onChange={(e) => setResetPasswordData({ ...resetPasswordData, newPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  data-testid="reset-password-confirm"
                  value={resetPasswordData.confirmPassword}
                  onChange={(e) => setResetPasswordData({ ...resetPasswordData, confirmPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Reset Password
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetPassword(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditUser && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">Edit User</h3>
                <p className="text-sm text-gray-500 mt-1">Editing: {selectedUser.email}</p>
              </div>
              <button onClick={() => setShowEditUser(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleEditUser} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                  <input
                    type="text"
                    required
                    data-testid="edit-user-firstname"
                    value={editUserData.firstName}
                    onChange={(e) => setEditUserData({ ...editUserData, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                  <input
                    type="text"
                    required
                    data-testid="edit-user-lastname"
                    value={editUserData.lastName}
                    onChange={(e) => setEditUserData({ ...editUserData, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  data-testid="edit-user-email"
                  value={editUserData.email}
                  onChange={(e) => setEditUserData({ ...editUserData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  required
                  data-testid="edit-user-role"
                  value={editUserData.role}
                  onChange={(e) => setEditUserData({ ...editUserData, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  {availableRoles.map((role) => (
                    <option key={role} value={role}>{role.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Update User
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditUser(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {showDeleteConfirm && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-red-600">Delete User</h3>
              <button onClick={() => setShowDeleteConfirm(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-gray-700 mb-6">
              Are you sure you want to delete <strong>{selectedUser.first_name} {selectedUser.last_name}</strong> ({selectedUser.email})? 
              This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDeleteUser}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Delete User
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Department Modal */}
      {(showCreateDepartment || showEditDepartment) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">
                {showEditDepartment ? 'Edit Department' : 'Create New Department'}
              </h3>
              <button 
                onClick={() => {
                  setShowCreateDepartment(false);
                  setShowEditDepartment(false);
                  setSelectedDepartment(null);
                  setNewDepartment({ name: '', description: '' });
                }} 
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={showEditDepartment ? handleEditDepartment : handleCreateDepartment} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Department Name *
                </label>
                <input
                  type="text"
                  value={newDepartment.name}
                  onChange={(e) => setNewDepartment({ ...newDepartment, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="e.g., Engineering, Quality Assurance"
                  required
                  data-testid="dept-name-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={newDepartment.description}
                  onChange={(e) => setNewDepartment({ ...newDepartment, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="Brief description of the department"
                  rows={3}
                  data-testid="dept-description-input"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateDepartment(false);
                    setShowEditDepartment(false);
                    setSelectedDepartment(null);
                    setNewDepartment({ name: '', description: '' });
                  }}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                  data-testid="save-dept-button"
                >
                  {showEditDepartment ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Department Confirmation */}
      {showDeleteDepartmentConfirm && selectedDepartment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Delete Department?</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{selectedDepartment.name}</strong>? 
              This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDeleteDepartment}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                data-testid="confirm-delete-dept"
              >
                Delete Department
              </button>
              <button
                onClick={() => {
                  setShowDeleteDepartmentConfirm(false);
                  setSelectedDepartment(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AdminPanel;
