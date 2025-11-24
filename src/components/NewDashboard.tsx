import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Shield, Bug, Bot, BarChart3 } from 'lucide-react';
import type { Team } from '../data/mockData';
import { useAuth } from '../contexts/AuthContext';

interface NewDashboardProps {
  teams: Team[];
  onTeamClick?: (team: Team) => void;
}

const NewDashboard: React.FC<NewDashboardProps> = ({ teams, onTeamClick }) => {
  const { user } = useAuth();
  const [filter, setFilter] = useState<'all' | 'high' | 'needs-attention'>('all');

  // Filter teams based on user role
  // QA Engineers and Viewers only see their own team
  const userTeams = (user?.role === 'qa_engineer' || user?.role === 'viewer')
    ? teams.filter(team => team.id === user?.primaryTeamId)
    : teams;

  // Calculate overall metrics based on visible teams
  const avgQualityScore = userTeams.length > 0 
    ? (userTeams.reduce((acc, t) => acc + t.qaScore, 0) / userTeams.length).toFixed(1)
    : '0.0';

  const testCoverage = '94.7';
  const defectDensity = '0.23';
  const automationRate = '76.4';

  // Filter teams
  const filteredTeams = userTeams.filter(team => {
    if (filter === 'all') return true;
    if (filter === 'high') return team.qaScore >= 85;
    if (filter === 'needs-attention') return team.qaScore < 75;
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-slate-950 overflow-auto">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-slate-800 dark:to-slate-700 p-6 sm:p-8 md:p-10 relative overflow-hidden min-h-[200px] sm:min-h-[240px]">
        <div className="relative z-10 max-w-7xl mx-auto">
          <div className="flex items-center gap-4 mb-4">
            <img 
              src="/irongate-logo.png" 
              alt="IronGate QA Navigator" 
              className="h-12 sm:h-16 w-auto object-contain"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <div className="h-12 sm:h-16 w-px bg-gray-300 dark:bg-gray-600"></div>
            <div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-white">
                {(user?.role === 'qa_engineer' || user?.role === 'viewer') 
                  ? `${userTeams[0]?.name || 'My Team'} Dashboard`
                  : 'Quality Assurance Dashboard'}
              </h1>
            </div>
          </div>
          <p className="text-sm sm:text-base lg:text-lg text-gray-600 dark:text-gray-300 max-w-4xl">
            Monitor, analyze, and optimize your quality assurance processes with real-time insights and comprehensive metrics.
          </p>
        </div>
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-4 -right-4 w-48 h-48 sm:w-72 sm:h-72 bg-blue-200 dark:bg-blue-900 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-xl opacity-30 animate-pulse"></div>
          <div className="absolute -bottom-4 -left-4 w-48 h-48 sm:w-72 sm:h-72 bg-cyan-200 dark:bg-cyan-900 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-xl opacity-30 animate-pulse" style={{ animationDelay: '1s' }}></div>
        </div>
      </div>

      {/* Key Metrics Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 p-4 sm:p-6">
        {/* Overall Quality Score */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-slate-800 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className="p-2 sm:p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <BarChart3 className="text-blue-600 dark:text-blue-300" size={20} />
            </div>
            <span className="text-xs sm:text-sm text-green-600 flex items-center">
              <TrendingUp size={14} className="mr-1" />
              +5.2%
            </span>
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-1">{avgQualityScore}%</h3>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Overall Quality Score</p>
        </div>

        {/* Test Coverage */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-slate-800 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className="p-2 sm:p-3 bg-green-100 dark:bg-green-900 rounded-lg">
              <Shield className="text-green-600 dark:text-green-300" size={20} />
            </div>
            <span className="text-xs sm:text-sm text-green-600 flex items-center">
              <TrendingUp size={14} className="mr-1" />
              +2.1%
            </span>
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-1">{testCoverage}%</h3>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Test Coverage</p>
        </div>

        {/* Defect Density */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-slate-800 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className="p-2 sm:p-3 bg-amber-100 dark:bg-amber-900 rounded-lg">
              <Bug className="text-amber-600 dark:text-amber-300" size={20} />
            </div>
            <span className="text-xs sm:text-sm text-red-600 flex items-center">
              <TrendingDown size={14} className="mr-1" />
              -12%
            </span>
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-1">{defectDensity}</h3>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Defect Density</p>
        </div>

        {/* Automation Rate */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-slate-800 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <div className="p-2 sm:p-3 bg-purple-100 dark:bg-purple-900 rounded-lg">
              <Bot className="text-purple-600 dark:text-purple-300" size={20} />
            </div>
            <span className="text-xs sm:text-sm text-green-600 flex items-center">
              <TrendingUp size={14} className="mr-1" />
              +8.3%
            </span>
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-1">{automationRate}%</h3>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Automation Rate</p>
        </div>
      </div>

      {/* Teams Overview */}
      <div className="px-4 sm:px-6 pb-4 sm:pb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6 gap-4">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
            {(user?.role === 'qa_engineer' || user?.role === 'viewer') 
              ? 'My Team Performance'
              : 'Team Performance'}
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              All Teams
            </button>
            <button
              onClick={() => setFilter('high')}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-colors ${
                filter === 'high'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              High Performing
            </button>
            <button
              onClick={() => setFilter('needs-attention')}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-colors ${
                filter === 'needs-attention'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              Needs Attention
            </button>
          </div>
        </div>

        {/* Teams Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filteredTeams.map(team => (
            <div
              key={team.id}
              onClick={() => onTeamClick?.(team)}
              className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-6 border border-gray-200 dark:border-slate-800 hover:shadow-xl transition-all cursor-pointer relative overflow-hidden group active:scale-95"
            >
              {/* Colored top border */}
              <div className={`absolute top-0 left-0 right-0 h-1 ${
                team.qaScore >= 85 ? 'bg-gradient-to-r from-green-500 to-emerald-500' :
                team.qaScore >= 75 ? 'bg-gradient-to-r from-yellow-500 to-amber-500' :
                'bg-gradient-to-r from-red-500 to-rose-500'
              }`}></div>

              {/* Team Header */}
              <div className="flex items-start justify-between mb-3 sm:mb-4">
                <div className="flex-1 min-w-0 pr-2">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-1 truncate">{team.name}</h3>
                  <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate">{team.department || 'Unknown Department'}</p>
                </div>
                <div className="flex-shrink-0">
                  {/* Circular QA Score */}
                  <div className="relative w-16 h-16">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle
                        cx="32"
                        cy="32"
                        r="28"
                        stroke="#e5e7eb"
                        strokeWidth="6"
                        fill="transparent"
                        className="dark:stroke-slate-700"
                      />
                      <circle
                        cx="32"
                        cy="32"
                        r="28"
                        stroke={
                          team.qaScore >= 75 ? '#10b981' :
                          team.qaScore >= 50 ? '#eab308' :
                          team.qaScore >= 30 ? '#f97316' :
                          '#ef4444'
                        }
                        strokeWidth="6"
                        fill="transparent"
                        strokeDasharray={2 * Math.PI * 28}
                        strokeDashoffset={2 * Math.PI * 28 - (team.qaScore / 100) * 2 * Math.PI * 28}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-lg font-bold text-gray-900 dark:text-white">{team.qaScore}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Metrics */}
              <div className="space-y-1.5 sm:space-y-2">
                {team.metrics.slice(0, 3).map(metric => (
                  <div key={metric.id} className="flex items-center justify-between text-xs sm:text-sm">
                    <span className="text-gray-600 dark:text-gray-400 truncate pr-2">{metric.name}</span>
                    <div className="flex items-center space-x-1.5 sm:space-x-2 flex-shrink-0">
                      <span className="font-medium text-gray-900 dark:text-white">
                        {typeof metric.value === 'number' ? metric.value.toFixed(1) : metric.value}
                        {metric.unit || ''}
                      </span>
                      {metric.trend === 'up' && (
                        <TrendingUp size={12} className="text-green-600" />
                      )}
                      {metric.trend === 'down' && (
                        <TrendingDown size={12} className="text-red-600" />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Hover effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/0 to-blue-500/0 group-hover:from-cyan-500/5 group-hover:to-blue-500/5 transition-all pointer-events-none"></div>
            </div>
          ))}
        </div>

        {filteredTeams.length === 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-8 sm:p-12 text-center">
            <div className="text-gray-400 dark:text-slate-500 mb-4">
              <svg className="w-12 h-12 sm:w-16 sm:h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">No Teams Found</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400">No teams match the selected filter.</p>
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div className="px-4 sm:px-6 pb-4 sm:pb-6">
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">Recent Activity</h3>
            <button className="text-xs sm:text-sm text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300">
              View All
            </button>
          </div>
          <div className="space-y-3 sm:space-y-4">
            <div className="flex items-center space-x-3 sm:space-x-4 p-3 sm:p-4 bg-gray-50 dark:bg-slate-800 rounded-lg">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center flex-shrink-0">
                <Shield className="text-green-600 dark:text-green-300" size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate">Test suite passed for Payment Module</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Frontend Team • 2 minutes ago</p>
              </div>
              <span className="text-xs text-green-600 bg-green-100 dark:bg-green-900 dark:text-green-300 px-2 py-1 rounded-full flex-shrink-0 hidden sm:inline">Success</span>
            </div>
            
            <div className="flex items-center space-x-3 sm:space-x-4 p-3 sm:p-4 bg-gray-50 dark:bg-slate-800 rounded-lg">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0">
                <BarChart3 className="text-blue-600 dark:text-blue-300" size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate">New deployment to staging environment</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">DevOps Team • 15 minutes ago</p>
              </div>
              <span className="text-xs text-blue-600 bg-blue-100 dark:bg-blue-900 dark:text-blue-300 px-2 py-1 rounded-full flex-shrink-0 hidden sm:inline">Deployment</span>
            </div>
            
            <div className="flex items-center space-x-3 sm:space-x-4 p-3 sm:p-4 bg-gray-50 dark:bg-slate-800 rounded-lg">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-amber-100 dark:bg-amber-900 rounded-full flex items-center justify-center flex-shrink-0">
                <Bug className="text-amber-600 dark:text-amber-300" size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate">Critical bug detected in user authentication</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Backend Team • 1 hour ago</p>
              </div>
              <span className="text-xs text-amber-600 bg-amber-100 dark:bg-amber-900 dark:text-amber-300 px-2 py-1 rounded-full flex-shrink-0 hidden sm:inline">Critical</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewDashboard;
