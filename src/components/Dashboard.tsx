import React, { useEffect, useState } from 'react';
import { Users, CheckCircle, AlertCircle, AlertTriangle, TrendingUp, Edit, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

import API_URL from '../config/api';

interface DashboardStats {
  totalTeams: number;
  overallPassRate: number;
  openDefects: number;
  criticalDefects: number;
}

interface TopTeam {
  id: string;
  name: string;
  platform: string;
  passRate: number;
  totalTests: number;
  department_name?: string;
}

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({
    totalTeams: 0,
    overallPassRate: 0,
    openDefects: 0,
    criticalDefects: 0
  });
  const [topTeams, setTopTeams] = useState<TopTeam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, [user]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
      // Fetch data based on user role
      const headers: HeadersInit = {
        'Content-Type': 'application/json'
      };
      
      const response = await fetch(`${API_URL}/metrics/dashboard`, { 
        headers,
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setStats(data.stats);
        setTopTeams(data.topTeams || []);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const canManageTeam = (teamId: string) => {
    if (!user) return false;
    
    // Super admin can manage everything
    if (user.role === 'super_admin') return true;
    
    // Manager can manage all teams in their department
    if (user.role === 'manager') return true;
    
    // Team lead can only manage their own team
    if (user.role === 'team_lead' && user.primaryTeamId === teamId) return true;
    
    return false;
  };

  const handleEditTeam = (teamId: string) => {
    // TODO: Implement edit team modal
    console.log('Edit team:', teamId);
  };

  const handleDeleteTeam = (teamId: string) => {
    // TODO: Implement delete team confirmation
    console.log('Delete team:', teamId);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600 dark:text-slate-400">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Welcome Header */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Welcome back, {user ? `${user.firstName} ${user.lastName}` : 'Guest'}!
              </h1>
              <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">
                Here's what's happening with {user?.role === 'team_lead' ? 'your team' : 'our QA teams'} today.
              </p>
            </div>
            {user && (
              <button className="px-4 py-2 text-sm text-blue-600 hover:text-blue-700 font-medium">
                Live Updates
              </button>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Total Teams */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-slate-400">Total Teams</div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white">{stats.totalTeams}</div>
              </div>
            </div>
          </div>

          {/* Overall Pass Rate */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-slate-400">Overall Pass Rate</div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white">{stats.overallPassRate.toFixed(1)}%</div>
              </div>
            </div>
          </div>

          {/* Open Defects */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-slate-400">Open Defects</div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white">{stats.openDefects}</div>
              </div>
            </div>
          </div>

          {/* Critical Defects */}
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-yellow-600" />
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-slate-400">Critical Defects</div>
                <div className="text-3xl font-bold text-gray-900 dark:text-white">{stats.criticalDefects}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Top Performing Teams */}
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Top Performing Teams</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">Teams with the highest pass rates in the last 30 days</p>
          </div>
          
          <div className="p-6 space-y-4">
            {topTeams.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-slate-400">
                No team data available yet
              </div>
            ) : (
              topTeams.map((team) => (
                <div 
                  key={team.id} 
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Users className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-white">{team.name}</div>
                      <div className="text-sm text-gray-600 dark:text-slate-400">
                        {team.platform} • {team.totalTests} tests
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-2xl font-bold text-gray-900 dark:text-white">{team.passRate.toFixed(1)}%</div>
                      <div className="text-sm text-gray-600 dark:text-slate-400">Pass Rate</div>
                    </div>
                    
                    {canManageTeam(team.id) && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEditTeam(team.id)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit team"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        {user?.role === 'super_admin' && (
                          <button
                            onClick={() => handleDeleteTeam(team.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete team"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
