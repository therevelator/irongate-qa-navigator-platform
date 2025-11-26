import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Users, Search, Edit2, Trash2, UserPlus, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Modal from './Modal';
import { confirmDelete, showCannotDeleteWarning, showSuccess } from '../utils/alerts';

interface Team {
  id: string;
  name: string;
  platform: string;
  description: string;
  department_name: string;
  department_id: string;
  is_active: boolean;
}

import API_URL from '../config/api';

const TeamsView: React.FC = () => {
  const { user } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [editForm, setEditForm] = useState({ name: '', description: '', departmentId: '' });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [teamsRes, usersRes, deptsRes] = await Promise.all([
        fetch(`${API_URL}/admin/teams`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('irongate_token')}` }
        }),
        fetch(`${API_URL}/admin/users`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('irongate_token')}` }
        }),
        fetch(`${API_URL}/admin/departments`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('irongate_token')}` }
        })
      ]);

      if (teamsRes.ok) {
        const teamsData = await teamsRes.json();
        setTeams(teamsData);
      }
      
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setUsers(usersData);
      }
      
      if (deptsRes.ok) {
        const deptsData = await deptsRes.json();
        setDepartments(deptsData);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTeamUserCounts = (teamId: string) => {
    const teamUsers = users.filter(u => u.primary_team_id === teamId);
    const activeUsers = teamUsers.filter(u => u.is_active);
    return { total: teamUsers.length, active: activeUsers.length };
  };

  const filteredTeams = teams.filter(t =>
    `${t.name} ${t.department_name || ''} ${t.platform}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase())
  );

  const canManageTeams = user?.role === 'super_admin' || user?.role === 'manager';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-slate-950">
        <div className="text-gray-500 dark:text-slate-400">Loading teams...</div>
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
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Teams</h1>
              <p className="text-sm text-gray-500 dark:text-slate-400">{filteredTeams.length} teams</p>
            </div>
          </div>
          
          {canManageTeams && (
            <button 
              onClick={() => {
                setEditForm({ name: '', description: '', departmentId: user?.departmentId || '' });
                setShowCreateModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 dark:bg-cyan-600 dark:hover:bg-cyan-700 text-white rounded-md transition-colors"
            >
              <UserPlus size={20} />
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
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-gray-500 dark:focus:ring-slate-600"
            />
          </div>
        </div>

        {/* Teams Table */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider">
                  Team Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider">
                  Department
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider">
                  Platform
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider">
                  Active Users
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider">
                  Total Users
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
              {filteredTeams.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <Users className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                    <p className="text-gray-500 dark:text-slate-400">No teams found</p>
                  </td>
                </tr>
              ) : (
                filteredTeams.map((team) => {
                  const counts = getTeamUserCounts(team.id);
                  return (
                    <tr key={team.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-gray-900 dark:text-white">{team.name}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600 dark:text-slate-400">{team.department_name || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600 dark:text-slate-400">{team.platform}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-white">{counts.active}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-white">{counts.total}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-3 py-1 text-xs font-medium rounded-md bg-gray-700 dark:bg-slate-600 text-white">
                          {team.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setSelectedTeam(team);
                              setEditForm({
                                name: team.name,
                                description: team.description || '',
                                departmentId: team.department_id
                              });
                              setShowEditModal(true);
                            }}
                            className="p-2 text-gray-400 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
                            title="Edit team"
                          >
                            <Edit2 size={18} />
                          </button>
                          {canManageTeams && (
                            <button
                              onClick={async () => {
                                const result = await confirmDelete(team.name, 'team');
                                if (result.isConfirmed) {
                                  try {
                                    const response = await fetch(`${API_URL}/admin/teams/${team.id}`, {
                                      method: 'DELETE',
                                      headers: {
                                        'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`
                                      }
                                    });
                                    
                                    if (response.ok) {
                                      showSuccess(`${team.name} has been deactivated`);
                                      fetchData(); // Refresh the list
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
                                    toast.error('Error deleting team');
                                  }
                                }
                              }}
                              className="p-2 text-gray-400 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                              title="Delete team"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Team Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title={`Edit Team: ${selectedTeam?.name}`}
        size="md"
      >
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            const response = await fetch(`${API_URL}/admin/teams/${selectedTeam?.id}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`
              },
              body: JSON.stringify({
                name: editForm.name,
                description: editForm.description || null
              })
            });
            
            if (response.ok) {
              setShowEditModal(false);
              toast.success('Team updated successfully!');
              fetchData(); // Refresh the list
            } else {
              const errorData = await response.json();
              console.error('Update error:', errorData);
              toast.error(`Failed to update team: ${errorData.error || 'Unknown error'}`);
            }
          } catch (error) {
            console.error('Error updating team:', error);
            toast.error('Error updating team');
          }
        }}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Team Name
              </label>
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Description
              </label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
              />
            </div>
          </div>
          
          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={() => setShowEditModal(false)}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md transition-colors"
            >
              <Save size={18} />
              Save Changes
            </button>
          </div>
        </form>
      </Modal>

      {/* Create Team Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Team"
        size="md"
      >
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            const response = await fetch(`${API_URL}/admin/teams`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`
              },
              body: JSON.stringify({
                name: editForm.name,
                description: editForm.description || null,
                departmentId: editForm.departmentId
              })
            });
            
            if (response.ok) {
              setShowCreateModal(false);
              setEditForm({ name: '', description: '', departmentId: '' });
              toast.success('Team created successfully!');
              fetchData(); // Refresh the list
            } else {
              const errorData = await response.json();
              toast.error(`Failed to create team: ${errorData.error || 'Unknown error'}`);
            }
          } catch (error) {
            console.error('Error creating team:', error);
            toast.error('Error creating team');
          }
        }}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Team Name
              </label>
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                required
                placeholder="Enter team name"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Department
              </label>
              <select
                value={editForm.departmentId}
                onChange={(e) => setEditForm({ ...editForm, departmentId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                required
              >
                <option value="">Select a department</option>
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Description
              </label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                placeholder="Brief description of the team"
              />
            </div>
          </div>
          
          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md transition-colors"
            >
              <UserPlus size={18} />
              Create Team
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default TeamsView;
