import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Shield, Bug, Bot, BarChart3, Sparkles, Building2, Database } from 'lucide-react';
import API_URL from '../config/api';
import type { Team } from '../data/mockData';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import TypingAnimation from './TypingAnimation';
import { toast } from 'react-hot-toast';

type GridColumns = 1 | 2 | 3;

interface Department {
  id: string;
  name: string;
}

interface NewDashboardProps {
  teams: Team[];
  onTeamClick?: (team: Team) => void;
  gridColumns?: GridColumns;
}

const NewDashboard: React.FC<NewDashboardProps> = ({ teams, onTeamClick, gridColumns = 1 }) => {
  const { user } = useAuth();
  const { themeName, isDark } = useTheme();
  const [filter, setFilter] = useState<'all' | 'high' | 'needs-attention'>('all');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [teamsWithMetrics, setTeamsWithMetrics] = useState<Team[]>(teams);
  const [recentActivity, setRecentActivity] = useState<any[]>([
    {
      id: '1',
      type: 'data-seeding',
      icon: Database,
      title: 'Business Impact Data Seeded',
      description: 'Realistic correlation data generated for Alpha Team',
      team: 'Alpha Team',
      timestamp: new Date().toISOString(),
      status: 'success'
    },
    {
      id: '2',
      type: 'system',
      icon: Sparkles,
      title: 'AI Analysis Available',
      description: 'Statistical insights ready for business impact analysis',
      team: 'All Teams',
      timestamp: new Date(Date.now() - 300000).toISOString(),
      status: 'info'
    }
  ]);
  const [showMetricsNotification, setShowMetricsNotification] = useState(false);

  // Fetch departments for admin users
  useEffect(() => {
    if (user?.role === 'super_admin' || user?.role === 'manager') {
      fetchDepartments();
    }
  }, [user?.role]);

  // Add recent activity
  const addRecentActivity = (activity: any) => {
    setRecentActivity(prev => [activity, ...prev.slice(0, 9)]); // Keep only 10 most recent
  };

  // Fetch real metrics for all teams
  useEffect(() => {
    fetchTeamsWithMetrics();
  }, [teams]);

  const fetchTeamsWithMetrics = async () => {
    try {
      const token = localStorage.getItem('irongate_token');
      if (!token) return;

      // Fetch metrics for each team
      const teamsWithData = await Promise.all(
        teams.map(async (team) => {
          try {
            const response = await fetch(`${API_URL}/teams/${team.id}`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.ok) {
              const data = await response.json();
              const teamData = data.team || {};
              
              // Map KPI data to metrics for display
              const metrics = [
                {
                  id: 'coverage',
                  name: 'Test Coverage',
                  value: teamData.kpiData?.testCoverage ? Math.round(teamData.kpiData.testCoverage) : 0,
                  unit: '%',
                  change: 0,
                  trend: 'up' as const,
                  status: ((teamData.kpiData?.testCoverage || 0) >= 80 ? 'good' : 'warning') as 'good' | 'warning' | 'critical',
                  history: []
                },
                {
                  id: 'flakiness',
                  name: 'Flakiness',
                  value: teamData.kpiData?.testFlakinessRate != null ? Number(teamData.kpiData.testFlakinessRate).toFixed(1) : '0',
                  unit: '%',
                  change: 0,
                  trend: 'down' as const,
                  status: (Number(teamData.kpiData?.testFlakinessRate || 0) <= 2 ? 'good' : 'warning') as 'good' | 'warning' | 'critical',
                  history: []
                },
                {
                  id: 'defect-density',
                  name: 'Defect Density',
                  value: teamData.kpiData?.defectDensity != null ? Number(teamData.kpiData.defectDensity).toFixed(2) : '0',
                  unit: '/1k',
                  change: 0,
                  trend: 'down' as const,
                  status: (Number(teamData.kpiData?.defectDensity || 0) <= 0.5 ? 'good' : 'warning') as 'good' | 'warning' | 'critical',
                  history: []
                },
                {
                  id: 'automation',
                  name: 'Automation',
                  value: teamData.kpiData?.automationCoverage ? Math.round(teamData.kpiData.automationCoverage) : 0,
                  unit: '%',
                  change: 0,
                  trend: 'up' as const,
                  status: ((teamData.kpiData?.automationCoverage || 0) >= 70 ? 'good' : 'warning') as 'good' | 'warning' | 'critical',
                  history: []
                }
              ];

              return {
                ...team,
                qaScore: teamData.qaScore || team.qaScore,
                metrics: metrics.filter(m => m.value !== 0 || teamData.kpiData)
              };
            }
          } catch (error) {
            console.error(`Error fetching metrics for team ${team.id}:`, error);
          }
          return team;
        })
      );

      setTeamsWithMetrics(teamsWithData);
      
      // Show green notification
      setShowMetricsNotification(true);
      
      // Auto-dismiss after 3 seconds
      setTimeout(() => {
        setShowMetricsNotification(false);
      }, 3000);
      
      // Add to recent activity
      addRecentActivity({
        id: Date.now().toString(),
        type: 'data-update',
        icon: TrendingUp,
        title: 'Team Metrics Updated',
        description: `Loaded latest quality and business metrics for ${teamsWithData.length} teams`,
        team: 'All Teams',
        timestamp: new Date().toISOString(),
        status: 'success'
      });
    } catch (error) {
      console.error('Error fetching teams with metrics:', error);
      setTeamsWithMetrics(teams);
    }
  };

  const fetchDepartments = async () => {
    try {
      const token = localStorage.getItem('irongate_token');
      const response = await fetch(`${API_URL}/admin/departments`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setDepartments(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };
  
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
        ? 'from-neutral-950 via-neutral-900 to-neutral-950' 
        : 'from-white via-neutral-50 to-white',
      blob1: 'bg-transparent',
      blob2: 'bg-transparent',
      accentColor: isDark ? 'text-neutral-300' : 'text-neutral-700',
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
    ? teamsWithMetrics.filter(team => team.id === user?.primaryTeamId)
    : teamsWithMetrics;

  // Filter teams by department (for admins) and performance filter
  const filteredTeams = userTeams.filter(team => {
    // Department filter (admin only)
    if (selectedDepartment !== 'all' && team.department !== selectedDepartment) {
      return false;
    }
    // Performance filter
    if (filter === 'all') return true;
    if (filter === 'high') return team.qaScore >= 85;
    if (filter === 'needs-attention') return team.qaScore < 75;
    return true;
  });

  const gridClassMap: Record<GridColumns, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
  };

  // Main background based on theme
  const mainBg = isAurora
    ? isDark 
      ? 'bg-neutral-950'
      : 'bg-neutral-50'
    : isOcean
      ? isDark
        ? 'bg-gradient-to-b from-slate-950 to-cyan-950'
        : 'bg-gradient-to-b from-sky-50 to-cyan-50'
      : 'bg-gray-50 dark:bg-slate-950';

  // Handle click to dismiss notification
  const handleDashboardClick = () => {
    if (showMetricsNotification) {
      setShowMetricsNotification(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-auto" onClick={handleDashboardClick}>
      {/* Hero Section - Glassmorphism */}
      <div className="glass-panel p-4 sm:p-6 relative overflow-hidden" style={{ minHeight: '150px' }}>
        <div className="relative z-10 max-w-7xl mx-auto">
          <div className="flex items-center gap-2 sm:gap-4 mb-2 sm:mb-3">
            <div className="p-2 rounded-xl glass-panel">
              <img 
                src="/irongate-logo.png" 
                alt="IronGate QA Navigator" 
                className="h-8 sm:h-10 md:h-12 w-auto object-contain brightness-0 invert"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            </div>
            <div className="h-8 sm:h-10 md:h-12 w-px bg-white/20"></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold truncate ml-0 md:ml-8 glass-text">
                  {(user?.role === 'qa_engineer' || user?.role === 'viewer') 
                    ? `${userTeams[0]?.name || 'My Team'} Dashboard`
                    : 'Quality Engineering Intelligence Platform'}
                </h1>
              </div>
            </div>
          </div>
          <TypingAnimation className="max-w-4xl" />
        </div>
        {/* Animated background elements - Glassmorphism style */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-4 -right-4 w-32 h-32 sm:w-48 sm:h-48 bg-white/10 rounded-full filter blur-3xl animate-float"></div>
          <div className="absolute -bottom-4 -left-4 w-32 h-32 sm:w-48 sm:h-48 bg-white/5 rounded-full filter blur-3xl animate-float" style={{ animationDelay: '2s' }}></div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 sm:w-96 sm:h-96 bg-white/5 rounded-full filter blur-3xl"></div>
        </div>
      </div>

      {/* Metrics Updated Notification */}
      {showMetricsNotification && (
        <div className="fixed top-20 right-4 z-50 glass-panel glass-text px-6 py-3 rounded-lg shadow-lg transform transition-transform duration-500 ease-in-out animate-slide-in-right border border-green-500/30">
          <p className="font-medium">Metrics Updated</p>
        </div>
      )}


      {/* Teams Overview */}
      <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-[15px]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-4 sm:mb-6">
          <h2 className="text-xl sm:text-2xl font-bold glass-text">
            {(user?.role === 'qa_engineer' || user?.role === 'viewer') 
              ? 'My Team Performance'
              : 'Team Performance'}
          </h2>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-200 ${
                  filter === 'all'
                    ? 'glass-btn-primary text-white shadow-lg scale-105'
                    : 'glass-btn glass-text-secondary hover:bg-white/25'
                }`}
              >
                All Teams
              </button>
              <button
                onClick={() => setFilter('high')}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-200 ${
                  filter === 'high'
                    ? 'glass-btn-primary text-white shadow-lg scale-105'
                    : 'glass-btn glass-text-secondary hover:bg-white/25'
                }`}
              >
                High Performing
              </button>
              <button
                onClick={() => setFilter('needs-attention')}
                className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-200 ${
                  filter === 'needs-attention'
                    ? 'glass-btn-primary text-white shadow-lg scale-105'
                    : 'glass-btn glass-text-secondary hover:bg-white/25'
                }`}
              >
                Needs Attention
              </button>
            </div>
            {/* Department Selector - Admin only */}
            {(user?.role === 'super_admin' || user?.role === 'manager') && departments.length > 0 && (
              <div className="flex items-center gap-2 glass-panel rounded-lg px-3 py-2">
                <Building2 size={16} className="glass-text-secondary" />
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className="text-xs font-medium bg-transparent border-none outline-none glass-text cursor-pointer pr-6"
                >
                  <option value="all">All Departments</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.name}>{dept.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Teams as Rows - Theme-specific card styles */}
        <div className={`grid ${gridClassMap[gridColumns]} gap-3`}>
          {filteredTeams.map((team, index) => (
            <div
              key={team.id}
              onClick={() => onTeamClick?.(team)}
              className="glass-card glass-card-3d cursor-pointer relative overflow-hidden group h-full p-3 sm:p-4 animate-fadeIn"
              style={{ 
                animationDelay: `${index * 50}ms`,
                background: team.qaScore >= 85 
                  ? 'rgba(16, 185, 129, 0.80)' 
                  : team.qaScore >= 75 
                    ? 'rgba(234, 179, 8, 0.80)' 
                    : team.qaScore >= 50 
                      ? 'rgba(249, 115, 22, 0.80)' 
                      : 'rgba(239, 68, 68, 0.80)'
              }}
            >
              {/* Glassmorphism hover overlay */}
              <div className="absolute inset-0 pointer-events-none rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white/10" />
              
              {/* Card Layout - Adapts based on grid columns */}
              {gridColumns === 1 ? (
                /* Single Column: Horizontal Row Layout */
                <div className="relative flex flex-col md:flex-row md:items-center gap-4 lg:gap-6">
                  {/* Team Info */}
                  <div className="flex items-start md:items-center gap-4 flex-shrink-0 md:w-48 lg:w-56">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base lg:text-lg font-bold glass-text mb-1 transition-colors truncate group-hover:text-white">
                        {team.name}
                      </h3>
                      <p className="text-xs lg:text-sm glass-text-secondary truncate">{team.department || 'Unknown Department'}</p>
                    </div>
                    {/* QA Score - Mobile only in row 1 */}
                    <div className="flex-shrink-0 md:hidden">
                      <div className="relative w-14 h-14 group-hover:scale-110 transition-transform duration-300">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle cx="28" cy="28" r="24" stroke="rgba(255,255,255,0.2)" strokeWidth="4" fill="transparent" />
                          <circle
                            cx="28" cy="28" r="24"
                            stroke={team.qaScore >= 85 ? '#34d399' : team.qaScore >= 75 ? '#fcd34d' : team.qaScore >= 50 ? '#fb923c' : '#f87171'}
                            strokeWidth="4" fill="transparent"
                            strokeDasharray={2 * Math.PI * 24}
                            strokeDashoffset={2 * Math.PI * 24 - (team.qaScore / 100) * 2 * Math.PI * 24}
                            strokeLinecap="round" className="transition-all duration-1000"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-lg font-bold glass-text">{team.qaScore}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* QA Score - Desktop */}
                  <div className="hidden md:block flex-shrink-0">
                    <div className="relative w-16 h-16 lg:w-20 lg:h-20 group-hover:scale-110 transition-transform duration-300">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle cx="50%" cy="50%" r="28" stroke="rgba(255,255,255,0.2)" strokeWidth="6" fill="transparent" />
                        <circle
                          cx="50%" cy="50%" r="28"
                          stroke={team.qaScore >= 85 ? '#34d399' : team.qaScore >= 75 ? '#fcd34d' : team.qaScore >= 50 ? '#fb923c' : '#f87171'}
                          strokeWidth="6" fill="transparent"
                          strokeDasharray={2 * Math.PI * 28}
                          strokeDashoffset={2 * Math.PI * 28 - (team.qaScore / 100) * 2 * Math.PI * 28}
                          strokeLinecap="round" className="transition-all duration-1000"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-xl lg:text-2xl font-bold glass-text">{team.qaScore}</span>
                        <span className="text-[10px] lg:text-xs glass-text-secondary">Score</span>
                      </div>
                    </div>
                  </div>

                  {/* Inline Metrics */}
                  <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
                    {team.metrics && team.metrics.length > 0 ? (
                      team.metrics.slice(0, 4).map((metric: any, idx: number) => (
                        <div key={idx} className="group/metric hover:scale-105 transition-transform">
                          <div className="flex items-center gap-1.5 lg:gap-2 mb-1">
                            <div className={`p-1 lg:p-1.5 rounded ${
                              idx === 0 ? 'bg-green-500/20' :
                              idx === 1 ? 'bg-amber-500/20' :
                              idx === 2 ? 'bg-purple-500/20' :
                              'bg-blue-500/20'
                            }`}>
                              {idx === 0 ? <Shield className="text-green-400" size={12} /> :
                               idx === 1 ? <Bug className="text-amber-400" size={12} /> :
                               idx === 2 ? <Bot className="text-purple-400" size={12} /> :
                               <BarChart3 className="text-blue-400" size={12} />}
                            </div>
                            <span className="text-[10px] lg:text-xs glass-text-secondary truncate">{metric.name}</span>
                          </div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-lg lg:text-2xl font-bold glass-text">{metric.value}</span>
                            {metric.unit && <span className="text-xs lg:text-sm glass-text-muted">{metric.unit}</span>}
                            {metric.trend === 'up' && <TrendingUp size={12} className="text-green-400 ml-1 hidden lg:block" />}
                            {metric.trend === 'down' && <TrendingDown size={12} className="text-red-400 ml-1 hidden lg:block" />}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="col-span-4 text-center glass-text-secondary">No metrics available</div>
                    )}
                  </div>

                  {/* Arrow indicator */}
                  <div className="hidden lg:block flex-shrink-0 glass-text-secondary group-hover:translate-x-1 group-hover:text-white transition-all">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              ) : (
                /* Multi-Column: Card Layout */
                <div className="relative flex flex-col h-full">
                  {/* Header: Team Name + Score */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0 pr-3">
                      <h3 className="text-base font-bold glass-text mb-1 transition-colors group-hover:text-white">
                        {team.name}
                      </h3>
                      <p className="text-xs glass-text-secondary">{team.department || 'Unknown Department'}</p>
                    </div>
                    
                    {/* QA Score Circle */}
                    <div className="flex-shrink-0">
                      <div className="relative w-14 h-14 group-hover:scale-110 transition-transform duration-300">
                        <svg className="w-full h-full transform -rotate-90">
                          <circle cx="28" cy="28" r="24" stroke="rgba(255,255,255,0.2)" strokeWidth="4" fill="transparent" />
                          <circle
                            cx="28" cy="28" r="24"
                            stroke={team.qaScore >= 85 ? '#34d399' : team.qaScore >= 75 ? '#fcd34d' : team.qaScore >= 50 ? '#fb923c' : '#f87171'}
                            strokeWidth="4" fill="transparent"
                            strokeDasharray={2 * Math.PI * 24}
                            strokeDashoffset={2 * Math.PI * 24 - (team.qaScore / 100) * 2 * Math.PI * 24}
                            strokeLinecap="round" className="transition-all duration-1000"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-lg font-bold glass-text">{team.qaScore}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Metrics Grid */}
                  <div className="grid grid-cols-2 gap-2 flex-1">
                    {team.metrics && team.metrics.length > 0 ? (
                      team.metrics.slice(0, 4).map((metric: any, idx: number) => (
                        <div key={idx} className="glass-panel rounded-lg p-2.5">
                          <div className="flex items-center gap-1.5 mb-1">
                            <div className={`p-1 rounded ${
                              idx === 0 ? 'bg-green-500/20' :
                              idx === 1 ? 'bg-amber-500/20' :
                              idx === 2 ? 'bg-purple-500/20' :
                              'bg-blue-500/20'
                            }`}>
                              {idx === 0 ? <Shield className="text-green-400" size={12} /> :
                               idx === 1 ? <Bug className="text-amber-400" size={12} /> :
                               idx === 2 ? <Bot className="text-purple-400" size={12} /> :
                               <BarChart3 className="text-blue-400" size={12} />}
                            </div>
                            <span className="text-[10px] glass-text-secondary truncate">{metric.name}</span>
                          </div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-base font-bold glass-text">{metric.value}</span>
                            {metric.unit && <span className="text-xs glass-text-muted">{metric.unit}</span>}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="col-span-2 glass-panel rounded-lg p-3 text-center">
                        <span className="text-xs glass-text-secondary">No metrics available</span>
                      </div>
                    )}
                  </div>
                  
                  {/* View Details Link */}
                  <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between text-xs font-medium glass-text-secondary group-hover:text-white">
                    <span>View Details</span>
                    <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {filteredTeams.length === 0 && (
          <div className="glass-card p-8 sm:p-12 text-center">
            <div className="glass-text-muted mb-4">
              <svg className="w-12 h-12 sm:w-16 sm:h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-base sm:text-lg font-semibold glass-text mb-2">No Teams Found</h3>
            <p className="text-sm glass-text-secondary">No teams match the selected filter.</p>
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div className="px-4 sm:px-6 pb-4 sm:pb-6">
        <div className="glass-card p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base sm:text-lg font-semibold glass-text">Recent Activity</h3>
            <button className="text-xs sm:text-sm glass-text-secondary hover:text-white transition-colors">
              View All
            </button>
          </div>
          <div className="space-y-3 sm:space-y-4">
            {recentActivity.map((activity) => {
              const IconComponent = activity.icon;
              const getStatusColor = (status: string) => {
                switch (status) {
                  case 'success': return 'text-green-400';
                  case 'error': return 'text-red-400';
                  case 'warning': return 'text-amber-400';
                  case 'info': return 'text-blue-400';
                  default: return 'glass-text-muted';
                };
              };
              
              return (
                <div 
                  key={activity.id} 
                  className="flex items-center space-x-3 sm:space-x-4 p-3 sm:p-4 rounded-lg glass-panel"
                >
                  <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                    activity.status === 'success' ? 'bg-green-500/20' :
                    activity.status === 'error' ? 'bg-red-500/20' :
                    activity.status === 'warning' ? 'bg-amber-500/20' :
                    'bg-blue-500/20'
                  }`}>
                    <IconComponent className={getStatusColor(activity.status)} size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm font-medium glass-text truncate">
                      {activity.title}
                    </p>
                    <p className="text-xs glass-text-secondary truncate">
                      {activity.description}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs glass-text-muted">{activity.team}</span>
                      <span className="text-xs glass-text-muted">•</span>
                      <span className="text-xs glass-text-muted">
                        {new Date(activity.timestamp).toLocaleTimeString([], { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </span>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full flex-shrink-0 capitalize ${
                    activity.status === 'success' ? 'bg-green-500/20 text-green-300' :
                    activity.status === 'error' ? 'bg-red-500/20 text-red-300' :
                    activity.status === 'warning' ? 'bg-amber-500/20 text-amber-300' :
                    'bg-blue-500/20 text-blue-300'
                  }`}>
                    {activity.status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NewDashboard;
