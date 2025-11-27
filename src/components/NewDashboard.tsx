import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Shield, Bug, Bot, BarChart3, Sparkles } from 'lucide-react';
import type { Team } from '../data/mockData';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import TypingAnimation from './TypingAnimation';

interface NewDashboardProps {
  teams: Team[];
  onTeamClick?: (team: Team) => void;
}

const NewDashboard: React.FC<NewDashboardProps> = ({ teams, onTeamClick }) => {
  const { user } = useAuth();
  const { themeName, isDark } = useTheme();
  const [filter, setFilter] = useState<'all' | 'high' | 'needs-attention'>('all');
  
  // Theme detection
  const isOcean = themeName === 'ocean';
  const isAurora = themeName === 'aurora';
  const isMinimal = themeName === 'minimal';
  
  // Theme-specific configurations
  const themeConfig = {
    ocean: {
      heroGradient: isDark 
        ? 'from-slate-950 via-cyan-950/40 to-slate-900' 
        : 'from-sky-50 via-cyan-50 to-blue-50',
      blob1: isDark ? 'bg-cyan-500/30' : 'bg-cyan-300/50',
      blob2: isDark ? 'bg-blue-500/30' : 'bg-blue-300/50',
      accentColor: isDark ? 'text-cyan-400' : 'text-cyan-600',
      btnActive: 'filter-btn-active',
    },
    aurora: {
      heroGradient: isDark 
        ? 'from-emerald-950 via-teal-950/40 to-slate-950' 
        : 'from-emerald-50 via-teal-50 to-green-50',
      blob1: isDark ? 'bg-emerald-500/25' : 'bg-emerald-300/40',
      blob2: isDark ? 'bg-teal-500/25' : 'bg-teal-300/40',
      accentColor: isDark ? 'text-emerald-400' : 'text-emerald-600',
      btnActive: 'filter-btn-active',
    },
    minimal: {
      heroGradient: isDark ? 'from-gray-900 to-gray-900' : 'from-gray-50 to-gray-50',
      blob1: 'bg-transparent',
      blob2: 'bg-transparent',
      accentColor: isDark ? 'text-gray-300' : 'text-gray-700',
      btnActive: isDark ? 'bg-gray-700' : 'bg-gray-800',
    }
  };
  
  const config = themeConfig[themeName] || themeConfig.ocean;

  // Filter teams based on user role
  // QA Engineers and Viewers only see their own team
  const userTeams = (user?.role === 'qa_engineer' || user?.role === 'viewer')
    ? teams.filter(team => team.id === user?.primaryTeamId)
    : teams;

  // Filter teams
  const filteredTeams = userTeams.filter(team => {
    if (filter === 'all') return true;
    if (filter === 'high') return team.qaScore >= 85;
    if (filter === 'needs-attention') return team.qaScore < 75;
    return true;
  });

  // Main background based on theme
  const mainBg = isAurora
    ? isDark 
      ? 'bg-gradient-to-b from-slate-950 to-emerald-950'
      : 'bg-gradient-to-b from-emerald-50 to-teal-100'
    : isOcean
      ? isDark
        ? 'bg-gradient-to-b from-slate-950 to-cyan-950'
        : 'bg-gradient-to-b from-sky-50 to-cyan-50'
      : 'bg-gray-50 dark:bg-slate-950';

  return (
    <div className={`flex flex-col h-full overflow-auto ${mainBg}`}>
      {/* Hero Section - Theme-aware gradient */}
      <div className={`bg-gradient-to-br ${config.heroGradient} p-4 sm:p-6 relative overflow-hidden ${
        isAurora && isDark ? 'border-b border-emerald-500/25' : isOcean && isDark ? 'border-b border-cyan-500/20' : ''
      }`} style={{ minHeight: '150px' }}>
        <div className="relative z-10 max-w-7xl mx-auto">
          <div className="flex items-center gap-2 sm:gap-4 mb-2 sm:mb-3">
            <div className={`p-2 rounded-xl backdrop-blur-sm ${
              isAurora 
                ? isDark ? 'bg-emerald-500/15 border border-emerald-500/40' : 'bg-white/85 border border-emerald-200'
                : isDark ? 'bg-white/10' : 'bg-white/70'
            }`}>
              <img 
                src="/irongate-logo.png" 
                alt="IronGate QA Navigator" 
                className="h-8 sm:h-10 md:h-12 w-auto object-contain"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            </div>
            <div className={`h-8 sm:h-10 md:h-12 w-px ${
              isAurora && isDark ? 'bg-emerald-400/40' : isDark ? 'bg-white/20' : 'bg-gray-300'
            }`}></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className={`text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold truncate ${
                  isAurora && isDark 
                    ? 'text-white drop-shadow-[0_0_20px_rgba(16,185,129,0.6)]' 
                    : 'text-gray-900 dark:text-white'
                }`}>
                  {(user?.role === 'qa_engineer' || user?.role === 'viewer') 
                    ? `${userTeams[0]?.name || 'My Team'} Dashboard`
                    : 'Quality Engineering Dashboard'}
                </h1>
              </div>
            </div>
          </div>
          <TypingAnimation className="max-w-4xl" />
        </div>
        {/* Animated background elements - Theme-aware */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {!isMinimal && (
            <>
              <div className={`absolute -top-4 -right-4 w-32 h-32 sm:w-48 sm:h-48 ${config.blob1} rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-xl opacity-40 animate-float`}></div>
              <div className={`absolute -bottom-4 -left-4 w-32 h-32 sm:w-48 sm:h-48 ${config.blob2} rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-xl opacity-40 animate-float`} style={{ animationDelay: '2s' }}></div>
            </>
          )}
          {isAurora && isDark && (
            <>
              <div className="absolute top-1/4 right-1/4 w-2 h-2 bg-emerald-400 rounded-full animate-pulse opacity-70"></div>
              <div className="absolute bottom-1/3 left-1/3 w-1 h-1 bg-teal-300 rounded-full animate-pulse opacity-80" style={{ animationDelay: '0.5s' }}></div>
              <div className="absolute top-1/2 right-1/3 w-1.5 h-1.5 bg-lime-300 rounded-full animate-pulse opacity-75" style={{ animationDelay: '1s' }}></div>
            </>
          )}
          {isOcean && isDark && (
            <>
              <div className="absolute top-1/3 right-1/4 w-2 h-2 bg-cyan-400 rounded-full animate-pulse opacity-60"></div>
              <div className="absolute bottom-1/4 left-1/4 w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse opacity-70" style={{ animationDelay: '0.7s' }}></div>
            </>
          )}
          {!isMinimal && (
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 sm:w-96 sm:h-96 rounded-full filter blur-3xl ${
              isAurora && isDark ? 'bg-emerald-500/15' : isOcean && isDark ? 'bg-cyan-500/10' : isDark ? 'bg-white/5' : 'bg-white/30'
            }`}></div>
          )}
        </div>
      </div>


      {/* Teams Overview */}
      <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-[15px]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6 gap-4">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
            {(user?.role === 'qa_engineer' || user?.role === 'viewer') 
              ? 'My Team Performance'
              : 'Team Performance'}
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-200 ${
                filter === 'all'
                  ? `${config.btnActive} text-white shadow-lg scale-105`
                  : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              All Teams
            </button>
            <button
              onClick={() => setFilter('high')}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-200 ${
                filter === 'high'
                  ? `${config.btnActive} text-white shadow-lg scale-105`
                  : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              High Performing
            </button>
            <button
              onClick={() => setFilter('needs-attention')}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-200 ${
                filter === 'needs-attention'
                  ? `${config.btnActive} text-white shadow-lg scale-105`
                  : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700'
              }`}
            >
              Needs Attention
            </button>
          </div>
        </div>

        {/* Teams as Rows - Theme-specific card styles */}
        <div className="space-y-3">
          {filteredTeams.map((team, index) => (
            <div
              key={team.id}
              onClick={() => onTeamClick?.(team)}
              className={`team-card p-3 sm:p-4 cursor-pointer relative overflow-hidden group ${
                isMinimal
                  ? isDark
                    ? 'bg-gray-800 border border-gray-700 rounded-xl hover:border-gray-600 transition-all duration-200'
                    : 'bg-white border border-gray-200 rounded-xl hover:border-gray-300 hover:shadow-md transition-all duration-200'
                  : ''
              }`}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {/* Soft theme-aware hover overlay (not on minimal) */}
              {!isMinimal && (
                <div
                  className={`absolute inset-0 pointer-events-none rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${
                    isAurora
                      ? 'bg-emerald-500/5'
                      : 'bg-cyan-500/5'
                  }`}
                />
              )}
              
              {/* Mobile Layout (< 768px) */}
              <div className="relative md:hidden">
                <div className="flex items-start justify-between mb-3">
                  {/* Team Info */}
                  <div className="flex-1 min-w-0 pr-3">
                    <h3 className={`text-base font-bold text-gray-900 dark:text-white mb-1 transition-colors truncate ${
                      isMinimal
                        ? 'group-hover:text-gray-700 dark:group-hover:text-gray-200'
                        : themeName === 'ocean' 
                          ? 'group-hover:text-cyan-600 dark:group-hover:text-cyan-400' 
                          : 'group-hover:text-emerald-600 dark:group-hover:text-emerald-400'
                    }`}>
                      {team.name}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{team.department || 'Unknown Department'}</p>
                  </div>
                  
                  {/* QA Score Circle - Smaller on mobile */}
                  <div className="flex-shrink-0">
                    <div className="relative w-16 h-16 group-hover:scale-110 transition-transform duration-300">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle cx="32" cy="32" r="28" stroke="#e5e7eb" strokeWidth="5" fill="transparent" className="dark:stroke-slate-700" />
                        <circle
                          cx="32" cy="32" r="28"
                          stroke={team.qaScore >= 85 ? '#10b981' : team.qaScore >= 75 ? '#eab308' : team.qaScore >= 50 ? '#f97316' : '#ef4444'}
                          strokeWidth="5" fill="transparent"
                          strokeDasharray={2 * Math.PI * 28}
                          strokeDashoffset={2 * Math.PI * 28 - (team.qaScore / 100) * 2 * Math.PI * 28}
                          strokeLinecap="round" className="transition-all duration-1000"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg font-bold text-gray-900 dark:text-white">{team.qaScore}</span>
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">Score</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Metrics Grid - 2 columns on mobile */}
                <div className="grid grid-cols-2 gap-3">
                  {team.metrics && team.metrics.length > 0 ? (
                    team.metrics.slice(0, 4).map((metric: any, idx: number) => (
                      <div key={idx} className="bg-gray-50 dark:bg-slate-800 rounded-lg p-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className={`p-1 rounded ${
                            idx === 0 ? 'bg-green-100 dark:bg-green-900' :
                            idx === 1 ? 'bg-amber-100 dark:bg-amber-900' :
                            idx === 2 ? 'bg-purple-100 dark:bg-purple-900' :
                            'bg-blue-100 dark:bg-blue-900'
                          }`}>
                            {idx === 0 ? <Shield className="text-green-600 dark:text-green-300" size={12} /> :
                             idx === 1 ? <Bug className="text-amber-600 dark:text-amber-300" size={12} /> :
                             idx === 2 ? <Bot className="text-purple-600 dark:text-purple-300" size={12} /> :
                             <BarChart3 className="text-blue-600 dark:text-blue-300" size={12} />}
                          </div>
                          <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{metric.name}</span>
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-lg font-bold text-gray-900 dark:text-white">{metric.value}</span>
                          {metric.unit && <span className="text-xs text-gray-500">{metric.unit}</span>}
                        </div>
                      </div>
                    ))
                  ) : (
                    <>
                      <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-2">
                        <span className="text-xs text-gray-500">No metrics</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Desktop/Tablet Layout (>= 768px) */}
              <div className="relative hidden md:flex items-center gap-4 lg:gap-6">
                {/* Team Info */}
                <div className="flex-shrink-0 w-32 lg:w-48">
                  <h3 className={`text-base lg:text-lg font-bold text-gray-900 dark:text-white mb-1 transition-colors truncate ${
                    isMinimal
                      ? 'group-hover:text-gray-700 dark:group-hover:text-gray-200'
                      : themeName === 'ocean' 
                        ? 'group-hover:text-cyan-600 dark:group-hover:text-cyan-400' 
                        : 'group-hover:text-emerald-600 dark:group-hover:text-emerald-400'
                  }`}>
                    {team.name}
                  </h3>
                  <p className="text-xs lg:text-sm text-gray-500 dark:text-gray-400 truncate">{team.department || 'Unknown Department'}</p>
                </div>

                {/* QA Score with animated circle */}
                <div className="flex-shrink-0">
                  <div className="relative w-16 h-16 lg:w-20 lg:h-20 group-hover:scale-110 transition-transform duration-300">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle cx="50%" cy="50%" r="28" stroke="#e5e7eb" strokeWidth="6" fill="transparent" className="dark:stroke-slate-700" />
                      <circle
                        cx="50%" cy="50%" r="28"
                        stroke={team.qaScore >= 85 ? '#10b981' : team.qaScore >= 75 ? '#eab308' : team.qaScore >= 50 ? '#f97316' : '#ef4444'}
                        strokeWidth="6" fill="transparent"
                        strokeDasharray={2 * Math.PI * 28}
                        strokeDashoffset={2 * Math.PI * 28 - (team.qaScore / 100) * 2 * Math.PI * 28}
                        strokeLinecap="round" className="transition-all duration-1000"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-white">{team.qaScore}</span>
                      <span className="text-[10px] lg:text-xs text-gray-500 dark:text-gray-400">Score</span>
                    </div>
                  </div>
                </div>

                {/* Inline Metrics */}
                <div className="flex-1 grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
                  {team.metrics && team.metrics.length > 0 ? (
                    team.metrics.slice(0, 4).map((metric: any, idx: number) => (
                      <div key={idx} className="group/metric hover:scale-105 transition-transform">
                        <div className="flex items-center gap-1.5 lg:gap-2 mb-1">
                          <div className={`p-1 lg:p-1.5 rounded ${
                            idx === 0 ? 'bg-green-100 dark:bg-green-900' :
                            idx === 1 ? 'bg-amber-100 dark:bg-amber-900' :
                            idx === 2 ? 'bg-purple-100 dark:bg-purple-900' :
                            'bg-blue-100 dark:bg-blue-900'
                          }`}>
                            {idx === 0 ? <Shield className="text-green-600 dark:text-green-300" size={12} /> :
                             idx === 1 ? <Bug className="text-amber-600 dark:text-amber-300" size={12} /> :
                             idx === 2 ? <Bot className="text-purple-600 dark:text-purple-300" size={12} /> :
                             <BarChart3 className="text-blue-600 dark:text-blue-300" size={12} />}
                          </div>
                          <span className="text-[10px] lg:text-xs text-gray-500 dark:text-gray-400 truncate">{metric.name}</span>
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-lg lg:text-2xl font-bold text-gray-900 dark:text-white">{metric.value}</span>
                          {metric.unit && <span className="text-xs lg:text-sm text-gray-500">{metric.unit}</span>}
                          {metric.trend === 'up' && <TrendingUp size={12} className="text-green-600 ml-1 hidden lg:block" />}
                          {metric.trend === 'down' && <TrendingDown size={12} className="text-green-600 ml-1 hidden lg:block" />}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-4 text-center text-gray-500">No metrics available</div>
                  )}
                </div>

                {/* Arrow indicator - Hidden on tablet, shown on desktop - Theme-aware */}
                <div className={`hidden lg:block flex-shrink-0 text-gray-400 group-hover:translate-x-1 transition-all ${
                  isMinimal
                    ? 'group-hover:text-gray-600'
                    : themeName === 'ocean' 
                      ? 'group-hover:text-cyan-600' 
                      : 'group-hover:text-emerald-600'
                }`}>
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
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
