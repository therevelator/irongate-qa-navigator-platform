import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Building2, Search, Plus, Edit2, Trash2, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Modal from './Modal';
import { confirmDelete } from '../utils/alerts';

interface Department {
  id: string;
  name: string;
  description: string;
  company_id: string;
  created_at: string;
}

import API_URL from '../config/api';

const DepartmentsView: React.FC = () => {
  const { user } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  const [deptForm, setDeptForm] = useState({ name: '', description: '' });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [deptsRes, teamsRes, usersRes] = await Promise.all([
        fetch(`${API_URL}/admin/departments`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('irongate_token')}` }
        }),
        fetch(`${API_URL}/admin/teams`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('irongate_token')}` }
        }),
        fetch(`${API_URL}/admin/users`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('irongate_token')}` }
        })
      ]);

      if (deptsRes.ok) {
        const deptsData = await deptsRes.json();
        setDepartments(deptsData);
      }
      
      if (teamsRes.ok) {
        const teamsData = await teamsRes.json();
        setTeams(teamsData);
      }
      
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setUsers(usersData);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDepartmentCounts = (deptId: string) => {
    const deptTeams = teams.filter(t => t.department_id === deptId);
    const deptUsers = users.filter(u => u.department_id === deptId);
    return { teams: deptTeams.length, users: deptUsers.length };
  };

  const filteredDepartments = departments.filter(d =>
    `${d.name} ${d.description || ''}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-slate-950">
        <div className="text-gray-500 dark:text-slate-400">Loading departments...</div>
      </div>
    );
  }

  // Only super_admin can view departments
  if (user?.role !== 'super_admin') {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-slate-950">
        <div className="text-gray-500 dark:text-slate-400">Access denied</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Building2 className="w-8 h-8 text-gray-600 dark:text-slate-400" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Departments</h1>
              <p className="text-sm text-gray-500 dark:text-slate-400">{filteredDepartments.length} departments</p>
            </div>
          </div>
          
          <button
            onClick={() => {
              setDeptForm({ name: '', description: '' });
              setShowCreateModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 dark:bg-cyan-600 dark:hover:bg-cyan-700 text-white rounded-md transition-colors"
          >
            <Plus size={20} />
            Create Department
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-slate-500" size={20} />
            <input
              type="text"
              placeholder="Search departments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-gray-500 dark:focus:ring-slate-600"
            />
          </div>
        </div>

        {/* Departments Table */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider">
                  Department Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider">
                  Teams
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider">
                  Users
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 dark:text-slate-300 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-800 divide-y divide-gray-200 dark:divide-slate-700">
              {filteredDepartments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <Building2 className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                    <p className="text-gray-500 dark:text-slate-400">No departments found</p>
                  </td>
                </tr>
              ) : (
                filteredDepartments.map((dept) => {
                  const counts = getDepartmentCounts(dept.id);
                  return (
                    <tr key={dept.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-gray-900 dark:text-white">{dept.name}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-600 dark:text-slate-400">{dept.description || 'No description'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-white">{counts.teams}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-white">{counts.users}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-600 dark:text-slate-400">
                          {new Date(dept.created_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setSelectedDept(dept);
                              setDeptForm({ name: dept.name, description: dept.description || '' });
                              setShowEditModal(true);
                            }}
                            className="p-2 text-gray-400 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
                            title="Edit department"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            onClick={async () => {
                              const result = await confirmDelete(
                                dept.name,
                                `department<br><small>This will affect ${counts.teams} teams and ${counts.users} users</small>`
                              );
                              if (result.isConfirmed) {
                                try {
                                  const response = await fetch(`${API_URL}/admin/departments/${dept.id}`, {
                                    method: 'DELETE',
                                    headers: {
                                      'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`
                                    }
                                  });
                                  
                                  if (response.ok) {
                                    toast.success('Department deleted successfully!');
                                    fetchData();
                                  } else {
                                    toast.error('Failed to delete department');
                                  }
                                } catch (error) {
                                  console.error('Error deleting department:', error);
                                  toast.error('Error deleting department');
                                }
                              }
                            }}
                            className="p-2 text-gray-400 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                            title="Delete department"
                          >
                            <Trash2 size={18} />
                          </button>
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

      {/* Create Department Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create New Department" size="md">
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            const response = await fetch(`${API_URL}/admin/departments`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`
              },
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Department Name</label>
              <input type="text" value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" required placeholder="Enter department name" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Description</label>
              <textarea value={deptForm.description} onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })} rows={3} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" placeholder="Brief description of the department" />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
            <button type="submit" className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md transition-colors"><Plus size={18} />Create Department</button>
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
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`
              },
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Department Name</label>
              <input type="text" value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Description</label>
              <textarea value={deptForm.description} onChange={(e) => setDeptForm({ ...deptForm, description: e.target.value })} rows={3} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-transparent" />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">Cancel</button>
            <button type="submit" className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md transition-colors"><Save size={18} />Save Changes</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default DepartmentsView;
