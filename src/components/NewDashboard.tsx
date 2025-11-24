import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Shield, Bug, Bot, BarChart3 } from 'lucide-react';
import type { Team } from '../data/mockData';

interface NewDashboardProps {
  teams: Team[];
  onTeamClick?: (team: Team) => void;
}

const NewDashboard: React.FC<NewDashboardProps> = ({ teams, onTeamClick }) => {
  const [filter, setFilter] = useState<'all' | 'high' | 'needs-attention'>('all');

  // Calculate overall metrics
  const avgQualityScore = teams.length > 0 
    ? (teams.reduce((acc, t) => acc + t.qaScore, 0) / teams.length).toFixed(1)
    : '0.0';

  const testCoverage = '94.7';
  const defectDensity = '0.23';
  const automationRate = '76.4';

  // Filter teams
  const filteredTeams = teams.filter(team => {
    if (filter === 'all') return true;
    if (filter === 'high') return team.qaScore >= 85;
    if (filter === 'needs-attention') return team.qaScore < 75;
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-slate-950">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-slate-800 dark:to-slate-700 p-8 relative overflow-hidden">
        <div className="relative z-10">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Quality Assurance Dashboard
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 mb-6">
            Monitor, analyze, and optimize your quality assurance processes with real-time insights and comprehensive metrics.
          </p>
        </div>
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-4 -right-4 w-72 h-72 bg-blue-200 dark:bg-blue-900 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-xl opacity-30 animate-pulse"></div>
          <div className="absolute -bottom-4 -left-4 w-72 h-72 bg-cyan-200 dark:bg-cyan-900 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-xl opacity-30 animate-pulse" style={{ animationDelay: '1s' }}></div>
        </div>
      </div>

      {/* Key Metrics Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 p-6">
        {/* Overall Quality Score */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-gray-200 dark:border-slate-800 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <BarChart3 className="text-blue-600 dark:text-blue-300" size={24} />
            </div>
            <span className="text-sm text-green-600 flex items-center">
              <TrendingUp size={16} className="mr-1" />
              +5.2%
            </span>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{avgQualityScore}%</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Overall Quality Score</p>
        </div>

        {/* Test Coverage */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-gray-200 dark:border-slate-800 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg">
              <Shield className="text-green-600 dark:text-green-300" size={24} />
            </div>
            <span className="text-sm text-green-600 flex items-center">
              <TrendingUp size={16} className="mr-1" />
              +2.1%
            </span>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{testCoverage}%</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Test Coverage</p>
        </div>

        {/* Defect Density */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-gray-200 dark:border-slate-800 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-amber-100 dark:bg-amber-900 rounded-lg">
              <Bug className="text-amber-600 dark:text-amber-300" size={24} />
            </div>
            <span className="text-sm text-red-600 flex items-center">
              <TrendingDown size={16} className="mr-1" />
              -12%
            </span>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{defectDensity}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Defect Density</p>
        </div>

        {/* Automation Rate */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-gray-200 dark:border-slate-800 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-lg">
              <Bot className="text-purple-600 dark:text-purple-300" size={24} />
            </div>
            <span className="text-sm text-green-600 flex items-center">
              <TrendingUp size={16} className="mr-1" />
              +8.3%
            </span>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{automationRate}%</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Automation Rate</p>
        </div>
      </div>

      {/* Teams Overview */}
      <div className="px-6 pb-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Team Performance</h2>
          <div className="flex space-x-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              All Teams
            </button>
            <button
              onClick={() => setFilter('high')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                filter === 'high'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              High Performing
            </button>
            <button
              onClick={() => setFilter('needs-attention')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTeams.map(team => (
            <div
              key={team.id}
              onClick={() => onTeamClick?.(team)}
              className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-gray-200 dark:border-slate-800 hover:shadow-xl transition-all cursor-pointer relative overflow-hidden group"
            >
              {/* Colored top border */}
              <div className={`absolute top-0 left-0 right-0 h-1 ${
                team.qaScore >= 85 ? 'bg-gradient-to-r from-green-500 to-emerald-500' :
                team.qaScore >= 75 ? 'bg-gradient-to-r from-yellow-500 to-amber-500' :
                'bg-gradient-to-r from-red-500 to-rose-500'
              }`}></div>

              {/* Team Header */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">{team.name}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{team.department || 'Unknown Department'}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{team.qaScore}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">QA Score</div>
                </div>
              </div>

              {/* Metrics */}
              <div className="space-y-2">
                {team.metrics.slice(0, 3).map(metric => (
                  <div key={metric.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{metric.name}</span>
                    <div className="flex items-center space-x-2">
                      <span className="font-medium text-gray-900 dark:text-white">
                        {typeof metric.value === 'number' ? metric.value.toFixed(1) : metric.value}
                        {metric.unit || ''}
                      </span>
                      {metric.trend === 'up' && (
                        <TrendingUp size={14} className="text-green-600" />
                      )}
                      {metric.trend === 'down' && (
                        <TrendingDown size={14} className="text-red-600" />
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
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-12 text-center">
            <div className="text-gray-400 dark:text-slate-500 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Teams Found</h3>
            <p className="text-gray-500 dark:text-slate-400">No teams match the selected filter.</p>
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div className="px-6 pb-6">
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-gray-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Activity</h3>
            <button className="text-sm text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300">
              View All
            </button>
          </div>
          <div className="space-y-4">
            <div className="flex items-center space-x-4 p-4 bg-gray-50 dark:bg-slate-800 rounded-lg">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                <Shield className="text-green-600 dark:text-green-300" size={20} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white">Test suite passed for Payment Module</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Frontend Team • 2 minutes ago</p>
              </div>
              <span className="text-xs text-green-600 bg-green-100 dark:bg-green-900 dark:text-green-300 px-2 py-1 rounded-full">Success</span>
            </div>
            
            <div className="flex items-center space-x-4 p-4 bg-gray-50 dark:bg-slate-800 rounded-lg">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                <BarChart3 className="text-blue-600 dark:text-blue-300" size={20} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white">New deployment to staging environment</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">DevOps Team • 15 minutes ago</p>
              </div>
              <span className="text-xs text-blue-600 bg-blue-100 dark:bg-blue-900 dark:text-blue-300 px-2 py-1 rounded-full">Deployment</span>
            </div>
            
            <div className="flex items-center space-x-4 p-4 bg-gray-50 dark:bg-slate-800 rounded-lg">
              <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900 rounded-full flex items-center justify-center">
                <Bug className="text-amber-600 dark:text-amber-300" size={20} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white">Critical bug detected in user authentication</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Backend Team • 1 hour ago</p>
              </div>
              <span className="text-xs text-amber-600 bg-amber-100 dark:bg-amber-900 dark:text-amber-300 px-2 py-1 rounded-full">Critical</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewDashboard;
