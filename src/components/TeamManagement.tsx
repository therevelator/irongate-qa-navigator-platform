import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Trash2, Edit2, Save, X, Building2, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';
import { confirmDelete, showCannotDeleteWarning, showSuccess } from '../utils/alerts';

interface Team {
  id: string;
  name: string;
  description: string;
  department_id: string;
  department_name?: string;
  company_id: string;
  is_active: boolean;
  created_at: string;
}

interface Department {
  id: string;
  name: string;
  company_id: string;
}

interface TeamManagementProps {
  teams?: any[];
  onBack: () => void;
  onUpdateTeams?: (teams: any[]) => void;
}

import API_URL from '../config/api';

const TeamManagement: React.FC<TeamManagementProps> = ({ onBack }) => {
  const { user } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [editingTeam, setEditingTeam] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState<Partial<Team>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [user?.id]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('irongate_token');
      if (!token) return;

      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      // Fetch departments
      const deptResponse = await fetch(`${API_URL}/admin/departments`, { headers });
      if (deptResponse.ok) {
        const deptData = await deptResponse.json();
        setDepartments(Array.isArray(deptData) ? deptData : []);
      }

      // Fetch teams
      const teamsResponse = await fetch(`${API_URL}/admin/teams`, { headers });
      if (teamsResponse.ok) {
        const teamsData = await teamsResponse.json();
        setTeams(Array.isArray(teamsData) ? teamsData : []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load teams');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (teamId: string) => {
    const team = teams.find(t => t.id === teamId);
    const result = await confirmDelete(team?.name || 'this team', 'team');
    if (!result.isConfirmed) return;

    try {
      const token = localStorage.getItem('irongate_token');
      const response = await fetch(`${API_URL}/admin/teams/${teamId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        showSuccess(`${team?.name || 'Team'} has been deactivated`);
        fetchData();
      } else {
        const error = await response.json();
        
        // Show detailed warning if team has active users
        if (error.hasActiveUsers) {
          showCannotDeleteWarning(
            'team',
            `This team has ${error.userCount} active user(s). Please reassign or deactivate all users first.`,
            error.users
          );
        } else {
          toast.error(error.error || 'Failed to delete team');
        }
      }
    } catch (error) {
      console.error('Error deleting team:', error);
      toast.error('Failed to delete team');
    }
  };

  const handleEdit = (team: Team) => {
    setEditingTeam(team.id);
    setFormData({
      name: team.name,
      description: team.description,
      department_id: team.department_id
    });
  };

  const handleSave = async () => {
    if (!editingTeam) return;

    try {
      const token = localStorage.getItem('irongate_token');
      const response = await fetch(`${API_URL}/admin/teams/${editingTeam}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description
        })
      });

      if (response.ok) {
        toast.success('Team updated successfully');
        setEditingTeam(null);
        setFormData({});
        fetchData();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to update team');
      }
    } catch (error) {
      console.error('Error updating team:', error);
      toast.error('Failed to update team');
    }
  };

  const handleAdd = async () => {
    if (!formData.name || !formData.department_id) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const token = localStorage.getItem('irongate_token');
      const response = await fetch(`${API_URL}/admin/teams`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || '',
          departmentId: formData.department_id
        })
      });

      if (response.ok) {
        toast.success('Team created successfully');
        setShowAddForm(false);
        setFormData({});
        fetchData();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to create team');
      }
    } catch (error) {
      console.error('Error creating team:', error);
      toast.error('Failed to create team');
    }
  };

  // Filter teams based on user role
  const getFilteredTeams = () => {
    if (user?.role === 'super_admin') {
      return teams; // Super admin sees all teams
    } else if (user?.role === 'manager' || user?.role === 'team_lead') {
      // Manager and Team Lead see teams from their department
      return teams.filter(team => team.department_id === user.departmentId);
    }
    return [];
  };

  // Check permissions
  const canCreate = user?.role === 'super_admin' || user?.role === 'manager';
  const canDelete = user?.role === 'super_admin' || user?.role === 'manager';
  const canEdit = user?.role === 'super_admin' || user?.role === 'manager' || user?.role === 'team_lead';

  const filteredTeams = getFilteredTeams();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading teams...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b dark:border-slate-700 sticky top-0 z-10">
        <div className="px-8 py-6">
          <button 
            onClick={onBack}
            className="flex items-center space-x-2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white mb-4 transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="font-medium">Back to Dashboard</span>
          </button>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Team Management</h1>
              <p className="text-gray-500 dark:text-slate-400 mt-1">Manage teams across departments</p>
            </div>
            
            {canCreate && (
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center space-x-2 px-6 py-3 bg-gray-900 dark:bg-slate-700 text-white rounded-md hover:bg-gray-800 dark:hover:bg-slate-600 transition-colors shadow-md"
              >
                <Plus size={20} />
                <span className="font-semibold">Add New Team</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-8 py-8">
        {/* Add Team Form */}
        {showAddForm && (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Add New Team</h2>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setFormData({});
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Team Name *</label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter team name"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Department *</label>
                <select
                  value={formData.department_id || ''}
                  onChange={(e) => setFormData({ ...formData, department_id: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="">Select department</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Description</label>
              <textarea
                value={formData.description || ''}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter team description"
                rows={3}
              />
            </div>
            
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setFormData({});
                }}
                className="px-6 py-2 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!formData.name || !formData.department_id}
                className="px-6 py-2 bg-gray-900 dark:bg-slate-700 text-white rounded-md hover:bg-gray-800 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Team
              </button>
            </div>
          </div>
        )}

        {/* Teams List */}
        {filteredTeams.length === 0 ? (
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-12 text-center">
            <Users className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-slate-600" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No teams found</h3>
            <p className="text-gray-500 dark:text-slate-400 mb-4">There are no teams to display based on your permissions.</p>
            {canCreate && (
              <button
                onClick={() => setShowAddForm(true)}
                className="inline-flex items-center space-x-2 px-4 py-2 bg-gray-900 dark:bg-slate-700 text-white rounded-md hover:bg-gray-800 dark:hover:bg-slate-600 transition-colors"
              >
                <Plus size={16} />
                <span>Create First Team</span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredTeams.map(team => (
              <div key={team.id} className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6">
                {editingTeam === team.id ? (
                  <div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Team Name</label>
                        <input
                          type="text"
                          value={formData.name || ''}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Description</label>
                        <textarea
                          value={formData.description || ''}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          rows={2}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end space-x-3 mt-4">
                      <button
                        onClick={() => {
                          setEditingTeam(null);
                          setFormData({});
                        }}
                        className="flex items-center space-x-2 px-4 py-2 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                      >
                        <X size={16} />
                        <span>Cancel</span>
                      </button>
                      <button
                        onClick={handleSave}
                        className="flex items-center space-x-2 px-4 py-2 bg-gray-900 dark:bg-slate-700 text-white rounded-md hover:bg-gray-800 dark:hover:bg-slate-600 transition-colors"
                      >
                        <Save size={16} />
                        <span>Save Changes</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-slate-800 flex items-center justify-center">
                        <Users className="w-6 h-6 text-gray-600 dark:text-slate-400" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">{team.name}</h3>
                        <div className="flex items-center space-x-2 mt-1">
                          <Building2 className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                          <p className="text-gray-500 dark:text-slate-400">{team.department_name || 'Unknown Department'}</p>
                        </div>
                        {team.description && (
                          <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">{team.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      {canEdit && (
                        <button
                          onClick={() => handleEdit(team)}
                          className="p-2 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          title="Edit team"
                        >
                          <Edit2 size={20} />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(team.id)}
                          className="p-2 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          title="Delete team"
                        >
                          <Trash2 size={20} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TeamManagement;
