import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Shield, Bug, Bot, BarChart3, Building2, Target, Calendar } from 'lucide-react';
import API_URL from '../config/api';
import type { Team } from '../data/mockData';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import TypingAnimation from './TypingAnimation';
import BatteryIndicator from './BatteryIndicator';
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
  const [showMetricsNotification, setShowMetricsNotification] = useState(false);

  // Fetch departments for admin users
  useEffect(() => {
    if (user?.role === 'super_admin' || user?.role === 'manager') {
      fetchDepartments();
    }
  }, [user?.role]);

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

      // Only show notification when we actually loaded metrics for at least one team
      if (teamsWithData.length > 0) {
        // Show green notification
        setShowMetricsNotification(true);

        // Auto-dismiss after 3 seconds
        setTimeout(() => {
          setShowMetricsNotification(false);
        }, 3000);
      }
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

  // Compute Focus for This Week based on actual team data
  const computeFocusRecommendation = () => {
    if (teamsWithMetrics.length === 0) {
      return {
        title: 'No data available',
        description: 'Add teams to see focus recommendations',
        currentValue: '-',
        targetValue: '-',
        affectedTeams: 0,
        affectedTeamNames: [] as string[],
        effort: 'N/A'
      };
    }

    // Find teams with low QA scores (needs attention)
    const lowScoreTeams = teamsWithMetrics.filter(t => t.qaScore < 75);
    const avgScore = teamsWithMetrics.reduce((sum, t) => sum + t.qaScore, 0) / teamsWithMetrics.length;

    // Analyze metrics across all teams
    let worstMetric = { name: '', avgValue: 100, teamsAffected: 0, isLowerBetter: false };
    
    // Check flakiness (lower is better)
    const teamsWithFlakiness = teamsWithMetrics.filter(t => {
      const flaky = t.metrics?.find((m: any) => m.name?.toLowerCase().includes('flak'));
      return flaky && parseFloat(String(flaky.value)) > 3;
    });
    
    // Check test coverage (higher is better)
    const teamsWithLowCoverage = teamsWithMetrics.filter(t => {
      const coverage = t.metrics?.find((m: any) => m.name?.toLowerCase().includes('coverage'));
      return coverage && parseFloat(String(coverage.value)) < 80;
    });

    // Check defect density (lower is better)
    const teamsWithHighDefects = teamsWithMetrics.filter(t => {
      const defects = t.metrics?.find((m: any) => m.name?.toLowerCase().includes('defect'));
      return defects && parseFloat(String(defects.value)) > 1;
    });

    // Determine primary focus
    if (teamsWithLowCoverage.length > 0) {
      const avgCoverage = teamsWithLowCoverage.reduce((sum, t) => {
        const cov = t.metrics?.find((m: any) => m.name?.toLowerCase().includes('coverage'));
        return sum + (cov ? parseFloat(String(cov.value)) : 0);
      }, 0) / teamsWithLowCoverage.length;
      
      return {
        title: 'Improve test coverage across teams',
        description: 'Low test coverage increases risk of undetected bugs',
        currentValue: `${Math.round(avgCoverage)}%`,
        targetValue: '80%',
        affectedTeams: teamsWithLowCoverage.length,
        affectedTeamNames: teamsWithLowCoverage.map(t => t.name),
        effort: teamsWithLowCoverage.length > 2 ? '1-2 weeks' : '3-5 days'
      };
    }

    if (teamsWithFlakiness.length > 0) {
      return {
        title: 'Reduce test flakiness in critical paths',
        description: 'Flaky tests slow down CI/CD and reduce confidence',
        currentValue: '4.5%',
        targetValue: '2%',
        affectedTeams: teamsWithFlakiness.length,
        affectedTeamNames: teamsWithFlakiness.map(t => t.name),
        effort: teamsWithFlakiness.length > 2 ? '1 week' : '2-3 days'
      };
    }

    if (teamsWithHighDefects.length > 0) {
      return {
        title: 'Reduce defect density',
        description: 'High defect density impacts customer satisfaction',
        currentValue: '>1/KLOC',
        targetValue: '<0.5/KLOC',
        affectedTeams: teamsWithHighDefects.length,
        affectedTeamNames: teamsWithHighDefects.map(t => t.name),
        effort: '1-2 weeks'
      };
    }

    if (lowScoreTeams.length > 0) {
      return {
        title: `Improve QA score for ${lowScoreTeams[0].name}`,
        description: 'Team needs attention to meet quality standards',
        currentValue: `${lowScoreTeams[0].qaScore}`,
        targetValue: '75+',
        affectedTeams: lowScoreTeams.length,
        affectedTeamNames: lowScoreTeams.map(t => t.name),
        effort: '1 week'
      };
    }

    // All teams doing well
    return {
      title: 'Maintain quality standards',
      description: 'All teams meeting targets - focus on continuous improvement',
      currentValue: `${Math.round(avgScore)}`,
      targetValue: '90+',
      affectedTeams: teamsWithMetrics.length,
      affectedTeamNames: teamsWithMetrics.map(t => t.name),
      effort: 'Ongoing'
    };
  };

  const focusRecommendation = computeFocusRecommendation();

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
    <div className={`flex flex-col h-full overflow-auto ${mainBg}`} onClick={handleDashboardClick}>
      {/* Hero Section - Theme-aware gradient */}
      <div className={`bg-gradient-to-br ${config.heroGradient} p-4 sm:p-6 relative overflow-hidden ${
        isAurora && isDark ? 'border-b border-neutral-800' : isOcean && isDark ? 'border-b border-cyan-500/20' : ''
      }`} style={{ minHeight: '150px' }}>
        <div className="relative z-10 max-w-7xl mx-auto">
          <div className="flex items-center gap-2 sm:gap-4 mb-2 sm:mb-3">
            <div className={`p-2 rounded-xl backdrop-blur-sm ${
              isAurora 
                ? isDark ? 'bg-neutral-800/50 border border-neutral-700' : 'bg-white/90 border border-neutral-200'
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
              isAurora && isDark ? 'bg-neutral-700' : isDark ? 'bg-white/20' : 'bg-gray-300'
            }`}></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className={`text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold truncate ml-0 md:ml-8 ${
                  isAurora && isDark 
                    ? 'text-white drop-shadow-[0_0_20px_rgba(16,185,129,0.6)]' 
                    : 'text-gray-900 dark:text-white'
                }`}>
                  {(user?.role === 'qa_engineer' || user?.role === 'viewer') 
                    ? `${userTeams[0]?.name || 'My Team'} Dashboard`
                    : <>
                        <span className="inline sm:hidden">Quality Engineering Intelligence</span>
                        <span className="hidden sm:inline">Quality Engineering Intelligence Platform</span>
                      </>}
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
          {/* Aurora decorations removed for minimalism */}
          {isOcean && isDark && (
            <>
              <div className="absolute top-1/3 right-1/4 w-2 h-2 bg-cyan-400 rounded-full animate-pulse opacity-60"></div>
              <div className="absolute bottom-1/4 left-1/4 w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse opacity-70" style={{ animationDelay: '0.7s' }}></div>
            </>
          )}
          {!isMinimal && (
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 sm:w-96 sm:h-96 rounded-full filter blur-3xl ${
              isAurora ? 'bg-transparent' : isOcean && isDark ? 'bg-cyan-500/10' : isDark ? 'bg-white/5' : 'bg-white/30'
            }`}></div>
          )}
        </div>
      </div>

      {/* Metrics Updated Notification */}
      {showMetricsNotification && (
        <div className="fixed top-20 right-4 z-50 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg transform transition-transform duration-500 ease-in-out animate-slide-in-right">
          <p className="font-medium">Metrics Updated</p>
        </div>
      )}


      {/* Teams Overview */}
      <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-[15px]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-4 sm:mb-6">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
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
            {/* Department Selector - Admin only */}
            {(user?.role === 'super_admin' || user?.role === 'manager') && departments.length > 0 && (
              <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg px-3 py-2 shadow-sm">
                <Building2 size={16} className="text-gray-500 dark:text-slate-400" />
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className="text-xs font-medium bg-transparent border-none outline-none text-gray-700 dark:text-slate-300 cursor-pointer pr-6"
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
              className={`team-card cursor-pointer relative overflow-hidden group h-full p-3 sm:p-4 rounded-xl border transition-all duration-200 ${
                isMinimal
                  ? isDark
                    ? 'border-gray-700 hover:border-gray-600'
                    : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                  : isDark
                    ? 'border-slate-700/50 hover:border-slate-600'
                    : 'border-gray-200/80 hover:border-gray-300 hover:shadow-md'
              }`}
              style={{ 
                animationDelay: `${index * 50}ms`,
                backgroundColor: isDark
                  ? team.qaScore >= 85 ? 'rgba(16, 185, 129, 0.18)' 
                    : team.qaScore >= 75 ? 'rgba(234, 179, 8, 0.18)' 
                    : team.qaScore >= 50 ? 'rgba(249, 115, 22, 0.18)' 
                    : 'rgba(239, 68, 68, 0.18)'
                  : team.qaScore >= 85 ? 'rgba(16, 185, 129, 0.12)' 
                    : team.qaScore >= 75 ? 'rgba(234, 179, 8, 0.12)' 
                    : team.qaScore >= 50 ? 'rgba(249, 115, 22, 0.12)' 
                    : 'rgba(239, 68, 68, 0.12)'
              }}
            >
              {/* Soft theme-aware hover overlay (not on minimal) */}
              {!isMinimal && (
                <div
                  className={`absolute inset-0 pointer-events-none rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${
                    isAurora
                      ? 'bg-neutral-500/5'
                      : 'bg-cyan-500/5'
                  }`}
                />
              )}
              
              {/* Card Layout - Adapts based on grid columns */}
              {gridColumns === 1 ? (
                /* Single Column: Horizontal Row Layout */
                <div className="relative flex flex-col md:flex-row md:items-center gap-4 lg:gap-6">
                  {/* Team Info */}
                  <div className="flex items-start md:items-center gap-4 flex-shrink-0 md:w-48 lg:w-56">
                    <div className="flex-1 min-w-0">
                      <h3 className={`text-base lg:text-lg font-bold text-gray-900 dark:text-white mb-1 transition-colors truncate ${
                        isMinimal
                          ? 'group-hover:text-gray-700 dark:group-hover:text-gray-200'
                          : themeName === 'ocean' 
                            ? 'group-hover:text-cyan-600 dark:group-hover:text-cyan-400' 
                            : 'group-hover:text-neutral-700 dark:group-hover:text-neutral-300'
                      }`}>
                        {team.name}
                      </h3>
                      <p className="text-xs lg:text-sm text-gray-500 dark:text-gray-400 truncate">{team.department || 'Unknown Department'}</p>
                    </div>
                    {/* QA Score - Mobile only in row 1 */}
                    <div className="flex-shrink-0 md:hidden">
                      <BatteryIndicator
                        percentage={team.qaScore}
                        size="sm"
                        mode="3d"
                        className="group-hover:scale-110 transition-transform duration-300"
                        animationDelay={index * 150}
                      />
                    </div>
                  </div>

                  {/* QA Score - Desktop */}
                  <div className="hidden md:block flex-shrink-0">
                    <BatteryIndicator
                      percentage={team.qaScore}
                      size="lg"
                      mode="3d"
                      className="group-hover:scale-110 transition-transform duration-300"
                      animationDelay={index * 150}
                    />
                  </div>

                  {/* Inline Metrics */}
                  <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
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

                  {/* Arrow indicator */}
                  <div className={`hidden lg:block flex-shrink-0 text-gray-400 group-hover:translate-x-1 transition-all ${
                    isMinimal
                      ? 'group-hover:text-gray-600'
                      : themeName === 'ocean' 
                        ? 'group-hover:text-cyan-600' 
                        : 'group-hover:text-neutral-700'
                  }`}>
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
                      <h3 className={`text-base font-bold text-gray-900 dark:text-white mb-1 transition-colors ${
                        isMinimal
                          ? 'group-hover:text-gray-700 dark:group-hover:text-gray-200'
                          : themeName === 'ocean' 
                            ? 'group-hover:text-cyan-600 dark:group-hover:text-cyan-400' 
                            : 'group-hover:text-neutral-700 dark:group-hover:text-neutral-300'
                      }`}>
                        {team.name}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{team.department || 'Unknown Department'}</p>
                    </div>
                    
                    {/* QA Score Circle */}
                    <div className="flex-shrink-0">
                      <BatteryIndicator
                        percentage={team.qaScore}
                        size="md"
                        mode="3d"
                        className="group-hover:scale-110 transition-transform duration-300"
                        animationDelay={index * 150}
                      />
                    </div>
                  </div>
                  
                  {/* Metrics Grid */}
                  <div className="grid grid-cols-2 gap-2 flex-1">
                    {team.metrics && team.metrics.length > 0 ? (
                      team.metrics.slice(0, 4).map((metric: any, idx: number) => (
                        <div key={idx} className="rounded-lg p-2.5 border border-gray-400 dark:border-slate-500">
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
                            <span className="text-base font-bold text-gray-900 dark:text-white">{metric.value}</span>
                            {metric.unit && <span className="text-xs text-gray-500">{metric.unit}</span>}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="col-span-2 rounded-lg p-3 text-center border border-gray-400 dark:border-slate-500">
                        <span className="text-xs text-gray-500">No metrics available</span>
                      </div>
                    )}
                  </div>
                  
                  {/* View Details Link */}
                  <div className={`mt-3 pt-3 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between text-xs font-medium ${
                    isMinimal
                      ? 'text-gray-500 group-hover:text-gray-700'
                      : themeName === 'ocean' 
                        ? 'text-cyan-600 dark:text-cyan-400' 
                        : 'text-neutral-600 dark:text-neutral-400'
                  }`}>
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

      {/* Focus & Milestones Section */}
      <div className="px-4 sm:px-6 pb-4 sm:pb-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          
          {/* Focus for This Week Banner */}
          <div className={`rounded-xl p-4 sm:p-6 border ${
            isDark 
              ? 'bg-gradient-to-br from-amber-900/30 to-orange-900/20 border-amber-700/50' 
              : 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200'
          }`}>
            <div className="flex items-start gap-3 mb-4">
              <div className={`p-2 rounded-lg ${
                isDark ? 'bg-amber-500/20' : 'bg-amber-100'
              }`}>
                <Target className={isDark ? 'text-amber-400' : 'text-amber-600'} size={20} />
              </div>
              <div>
                <h3 className={`text-base sm:text-lg font-semibold ${
                  isDark ? 'text-amber-300' : 'text-amber-800'
                }`}>Focus for This Week</h3>
                <p className={`text-xs ${isDark ? 'text-amber-400/70' : 'text-amber-600/70'}`}>
                  AI-generated priority based on business impact
                </p>
              </div>
            </div>
            
            <div className={`p-4 rounded-lg ${
              isDark ? 'bg-slate-900/50' : 'bg-white/80'
            }`}>
              <p className={`text-sm sm:text-base font-medium mb-2 ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}>
                🎯 {focusRecommendation.title}
              </p>
              <p className={`text-xs sm:text-sm ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                {focusRecommendation.description}
              </p>
              <p className={`text-xs sm:text-sm mt-2 ${isDark ? 'text-slate-400' : 'text-gray-600'}`}>
                Current: <span className="font-semibold text-red-500">{focusRecommendation.currentValue}</span> → 
                Target: <span className="font-semibold text-green-500">{focusRecommendation.targetValue}</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={`text-xs px-2 py-1 rounded-full ${
                  isDark ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-700'
                }`}>
                  High Business Impact
                </span>
                {focusRecommendation.affectedTeams > 0 && (
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    isDark ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {focusRecommendation.affectedTeams === 1 
                      ? focusRecommendation.affectedTeamNames[0]
                      : `Affects ${focusRecommendation.affectedTeams} Teams`}
                  </span>
                )}
              </div>
            </div>

            <div className={`mt-4 pt-4 border-t ${
              isDark ? 'border-amber-700/30' : 'border-amber-200'
            }`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                  Estimated effort: {focusRecommendation.effort}
                </span>
                <button className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                  isDark 
                    ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' 
                    : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                }`}>
                  View Details →
                </button>
              </div>
            </div>
          </div>

          {/* Upcoming Quality Milestones / SLAs */}
          <div className={`rounded-xl p-4 sm:p-6 border ${
            isDark 
              ? 'bg-slate-900 border-slate-800' 
              : 'bg-white border-gray-200'
          }`}>
            <div className="flex items-start gap-3 mb-4">
              <div className={`p-2 rounded-lg ${
                isDark ? 'bg-cyan-500/20' : 'bg-cyan-100'
              }`}>
                <Calendar className={isDark ? 'text-cyan-400' : 'text-cyan-600'} size={20} />
              </div>
              <div>
                <h3 className={`text-base sm:text-lg font-semibold ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}>Quality Milestones & SLAs</h3>
                <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                  Release readiness & service level targets
                </p>
              </div>
            </div>

            {/* Upcoming Releases */}
            <div className="mb-4">
              <h4 className={`text-xs font-semibold uppercase tracking-wide mb-2 ${
                isDark ? 'text-slate-500' : 'text-gray-400'
              }`}>Upcoming Releases</h4>
              <div className="space-y-2">
                <div className={`flex items-center justify-between p-3 rounded-lg ${
                  isDark ? 'bg-slate-800' : 'bg-gray-50'
                }`}>
                  <div>
                    <p className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      v2.4.0 Release
                    </p>
                    <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                      Dec 15, 2025
                    </p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400 font-medium">
                    On Track
                  </span>
                </div>
                <div className={`flex items-center justify-between p-3 rounded-lg ${
                  isDark ? 'bg-slate-800' : 'bg-gray-50'
                }`}>
                  <div>
                    <p className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      v2.5.0 Release
                    </p>
                    <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                      Jan 10, 2026
                    </p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400 font-medium">
                    At Risk
                  </span>
                </div>
              </div>
            </div>

            {/* SLA Overview */}
            <div className={`pt-4 border-t ${isDark ? 'border-slate-800' : 'border-gray-100'}`}>
              <h4 className={`text-xs font-semibold uppercase tracking-wide mb-3 ${
                isDark ? 'text-slate-500' : 'text-gray-400'
              }`}>SLA Performance</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className={`p-3 rounded-lg ${isDark ? 'bg-slate-800' : 'bg-gray-50'}`}>
                  <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                    Tickets in SLA
                  </p>
                  <p className={`text-xl font-bold ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                    94.2%
                  </p>
                  <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
                    Target: 95%
                  </p>
                </div>
                <div className={`p-3 rounded-lg ${isDark ? 'bg-slate-800' : 'bg-gray-50'}`}>
                  <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-gray-500'}`}>
                    MTTR within target
                  </p>
                  <p className={`text-xl font-bold ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`}>
                    87.5%
                  </p>
                  <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-gray-400'}`}>
                    Target: 90%
                  </p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default NewDashboard;
