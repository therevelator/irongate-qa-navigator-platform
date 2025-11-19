import React, { useState } from 'react';
import { ArrowLeft, Plus, Trash2, Edit2, Save, X } from 'lucide-react';
import type { Team } from '../data/mockData';

interface TeamManagementProps {
  teams: Team[];
  onBack: () => void;
  onUpdateTeams: (teams: Team[]) => void;
}

const TeamManagement: React.FC<TeamManagementProps> = ({ teams, onBack, onUpdateTeams }) => {
  const [editingTeam, setEditingTeam] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState<Partial<Team>>({});

  const handleDelete = (teamId: string) => {
    if (confirm('Are you sure you want to remove this team?')) {
      onUpdateTeams(teams.filter(t => t.id !== teamId));
    }
  };

  const handleEdit = (team: Team) => {
    setEditingTeam(team.id);
    setFormData(team);
  };

  const handleSave = () => {
    if (editingTeam) {
      onUpdateTeams(teams.map(t => t.id === editingTeam ? { ...t, ...formData } as Team : t));
      setEditingTeam(null);
      setFormData({});
    }
  };

  const handleAdd = () => {
    if (formData.name && formData.department) {
      const newTeam: Team = {
        id: `team-${Date.now()}`,
        name: formData.name,
        department: formData.department,
        qaScore: formData.qaScore || 75,
        status: (formData.qaScore || 75) > 90 ? 'good' : (formData.qaScore || 75) > 75 ? 'warning' : 'critical',
        velocity: [],
        metrics: [],
      };
      onUpdateTeams([...teams, newTeam]);
      setShowAddForm(false);
      setFormData({});
    }
  };

  const departments = ['e-commerce', 'platform', 'fintech', 'mobile', 'backend'];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="px-8 py-6">
          <button 
            onClick={onBack}
            className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="font-medium">Back to Dashboard</span>
          </button>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Team Management</h1>
              <p className="text-gray-500 mt-1">Add, edit, or remove teams from your dashboard</p>
            </div>
            
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-md"
            >
              <Plus size={20} />
              <span className="font-semibold">Add New Team</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-8 py-8">
        {/* Add Team Form */}
        {showAddForm && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">Add New Team</h2>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setFormData({});
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Team Name *</label>
                <input
                  type="text"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., Checkout Service"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Department *</label>
                <select
                  value={formData.department || ''}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select Department</option>
                  {departments.map(dept => (
                    <option key={dept} value={dept}>{dept.charAt(0).toUpperCase() + dept.slice(1)}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">QA Score (0-100)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={formData.qaScore || 75}
                  onChange={(e) => setFormData({ ...formData, qaScore: parseInt(e.target.value) })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              
            </div>
            
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setFormData({});
                }}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!formData.name || !formData.department}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Team
              </button>
            </div>
          </div>
        )}

        {/* Teams List */}
        <div className="space-y-4">
          {teams.map(team => (
            <div key={team.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              {editingTeam === team.id ? (
                // Edit Mode
                <div>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Team Name</label>
                      <input
                        type="text"
                        value={formData.name || ''}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Department</label>
                      <select
                        value={formData.department || ''}
                        onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      >
                        {departments.map(dept => (
                          <option key={dept} value={dept}>{dept.charAt(0).toUpperCase() + dept.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">QA Score</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={formData.qaScore || 0}
                        onChange={(e) => setFormData({ ...formData, qaScore: parseInt(e.target.value) })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  
                  <div className="flex justify-end space-x-3">
                    <button
                      onClick={() => {
                        setEditingTeam(null);
                        setFormData({});
                      }}
                      className="flex items-center space-x-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <X size={16} />
                      <span>Cancel</span>
                    </button>
                    <button
                      onClick={handleSave}
                      className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <Save size={16} />
                      <span>Save Changes</span>
                    </button>
                  </div>
                </div>
              ) : (
                // View Mode
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-6">
                    <div className={`w-16 h-16 rounded-lg flex items-center justify-center text-2xl ${
                      team.qaScore >= 90 ? 'bg-green-100' :
                      team.qaScore >= 75 ? 'bg-blue-100' :
                      team.qaScore >= 60 ? 'bg-yellow-100' : 'bg-red-100'
                    }`}>
                      {team.qaScore >= 90 ? '🏆' :
                       team.qaScore >= 75 ? '✨' :
                       team.qaScore >= 60 ? '⚠️' : '🔴'}
                    </div>
                    
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">{team.name}</h3>
                      <p className="text-sm text-gray-500 capitalize">{team.department}</p>
                    </div>
                    
                    <div className="flex items-center space-x-6 ml-8">
                      <div>
                        <p className="text-xs text-gray-500">QA Score</p>
                        <p className="text-2xl font-bold text-gray-900">{team.qaScore}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Status</p>
                        <p className={`text-lg font-semibold ${
                          team.status === 'good' ? 'text-green-600' :
                          team.status === 'warning' ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {team.status.charAt(0).toUpperCase() + team.status.slice(1)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Metrics</p>
                        <p className="text-lg font-semibold text-gray-700">{team.metrics.length} KPIs</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => handleEdit(team)}
                      className="flex items-center space-x-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <Edit2 size={16} />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => handleDelete(team.id)}
                      className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                    >
                      <Trash2 size={16} />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {teams.length === 0 && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📊</div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">No Teams Yet</h3>
            <p className="text-gray-500 mb-6">Add your first team to get started with QA tracking</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={20} />
              <span>Add Your First Team</span>
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-8 py-6 mt-8">
        <div className="flex items-center justify-between text-sm text-gray-600">
          <div className="flex items-center space-x-2">
            <img src="/irongate-logo.png" alt="IronGate" className="w-6 h-6 rounded" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            <span className="font-semibold">IronGate Software LTD</span>
          </div>
          <div className="flex items-center space-x-6">
            <span>© {new Date().getFullYear()} IronGate Software LTD. All rights reserved.</span>
            <span className="text-gray-400">|</span>
            <span className="text-gray-500">QA Navigator Platform v1.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default TeamManagement;
