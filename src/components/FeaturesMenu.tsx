import React, { useState, useEffect } from 'react';
import { ArrowLeft, BarChart3, TestTube, Zap, TrendingUp, Code, Wrench, GitBranch, DollarSign, Trophy, FileText, Grid3x3, LayoutGrid, Building2, Users } from 'lucide-react';
import { advancedFeatures } from '../data/features';
import type { FeatureModule } from '../data/features';
import API_URL from '../config/api';
import { useAuth } from '../contexts/AuthContext';

interface Department {
  id: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
  department_id?: string;
  department?: string;
}

interface FeaturesMenuProps {
  onBack: () => void;
  onSelectFeature: (featureId: string, teamId?: string) => void;
}

type GridColumns = 1 | 2 | 3 | 4 | 5;

const FeaturesMenu: React.FC<FeaturesMenuProps> = ({ onBack, onSelectFeature }) => {
  const { user } = useAuth();
  const [gridColumns, setGridColumns] = useState<GridColumns>(3);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [filteredTeams, setFilteredTeams] = useState<Team[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [initialized, setInitialized] = useState(false);

  // Fetch departments and teams
  useEffect(() => {
    fetchDepartments();
    fetchTeams();
  }, []);

  // Pre-select team lead's department and team after data is loaded
  useEffect(() => {
    if (!initialized && user?.role === 'team_lead' && teams.length > 0 && departments.length > 0) {
      // Find the team lead's team to get their department
      const userTeam = teams.find(t => t.id === user.primaryTeamId);
      if (userTeam && userTeam.department_id) {
        setSelectedDepartment(String(userTeam.department_id));
        setSelectedTeam(user.primaryTeamId || 'all');
        setInitialized(true);
      }
    }
  }, [user, teams, departments, initialized]);

  // Filter teams when department changes
  useEffect(() => {
    if (selectedDepartment === 'all') {
      setFilteredTeams(teams);
    } else {
      // Match by department_id (comparing as strings to handle type mismatches)
      const filtered = teams.filter(t => String(t.department_id) === String(selectedDepartment));
      setFilteredTeams(filtered);
    }
    // Only reset team selection when department changes manually (not on initial load)
    if (initialized && user?.role !== 'team_lead') {
      setSelectedTeam('all');
    }
  }, [selectedDepartment, teams]);

  const fetchDepartments = async () => {
    try {
      const response = await fetch(`${API_URL}/admin/departments`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        // API might return { departments: [...] } or just [...]
        const depts = Array.isArray(data) ? data : (data.departments || []);
        setDepartments(depts);
      }
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  const fetchTeams = async () => {
    try {
      const response = await fetch(`${API_URL}/teams`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        // API returns { teams: [...] }
        const teamsArray = data.teams || [];
        setTeams(teamsArray);
        setFilteredTeams(teamsArray);
      }
    } catch (error) {
      console.error('Error fetching teams:', error);
    }
  };

  const getIcon = (iconName: string) => {
    const icons: Record<string, React.ReactNode> = {
      BarChart3: <BarChart3 size={24} />,
      TestTube: <TestTube size={24} />,
      Zap: <Zap size={24} />,
      TrendingUp: <TrendingUp size={24} />,
      Code: <Code size={24} />,
      Wrench: <Wrench size={24} />,
      GitBranch: <GitBranch size={24} />,
      DollarSign: <DollarSign size={24} />,
      Trophy: <Trophy size={24} />,
      FileText: <FileText size={24} />
    };
    return icons[iconName] || <BarChart3 size={24} />;
  };

  const getCategoryColor = (category: string) => {
    return 'from-gray-700 to-gray-800 dark:from-slate-700 dark:to-slate-800';
  };

  const categories = [
    { id: 'testing', name: 'Testing & Quality', emoji: '🧪' },
    { id: 'performance', name: 'Performance & Speed', emoji: '⚡' },
    { id: 'productivity', name: 'Developer Productivity', emoji: '💻' },
    { id: 'business', name: 'Business Intelligence', emoji: '📊' }
  ];

  const getGridClass = (cols: GridColumns) => {
    const gridClasses = {
      1: 'grid-cols-1',
      2: 'grid-cols-1 md:grid-cols-2',
      3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
      4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
      5: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
    };
    return gridClasses[cols];
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b dark:border-slate-800">
        <div className="px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col gap-4">
            {/* Title Row */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics Dashboard</h1>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                  {selectedTeam !== 'all' 
                    ? `Team-specific analytics for ${filteredTeams.find(t => t.id === selectedTeam)?.name || 'selected team'}`
                    : 'Select a team to view analytics'
                  }
                </p>
              </div>
              
              {/* Grid Size Selector */}
              <div className="flex items-center gap-2 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg">
                <span className="text-xs font-medium text-gray-600 dark:text-slate-400 px-2">Grid:</span>
                {([1, 2, 3, 4, 5] as GridColumns[]).map((cols) => (
                  <button
                    key={cols}
                    onClick={() => setGridColumns(cols)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      gridColumns === cols
                        ? 'bg-cyan-600 text-white shadow-sm'
                        : 'text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700'
                    }`}
                    title={`${cols} column${cols > 1 ? 's' : ''}`}
                  >
                    {cols}
                  </button>
                ))}
              </div>
            </div>

            {/* Filters Row */}
            <div className="flex flex-wrap items-center gap-4">
              {/* Team Lead sees only their team - static label */}
              {user?.role === 'team_lead' ? (
                <div className="flex items-center gap-2 bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 rounded-lg px-4 py-2.5">
                  <Users size={18} className="text-cyan-600 dark:text-cyan-400" />
                  <span className="text-sm font-semibold">
                    Viewing: {teams.find(t => t.id === user.primaryTeamId)?.name || 'Your Team'}
                  </span>
                </div>
              ) : (
                <>
                  {/* Department Selector */}
                  <div className="flex items-center gap-2 bg-gray-100 dark:bg-slate-800 rounded-lg px-3 py-2">
                    <Building2 size={16} className="text-gray-500 dark:text-slate-400" />
                    <select
                      value={selectedDepartment}
                      onChange={(e) => setSelectedDepartment(e.target.value)}
                      className="text-sm font-medium bg-transparent border-none outline-none text-gray-700 dark:text-slate-300 cursor-pointer pr-6 min-w-[140px]"
                    >
                      <option value="all">All Departments</option>
                      {departments.map((dept) => (
                        <option key={dept.id} value={dept.id}>{dept.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Team Selector */}
                  <div className="flex items-center gap-2 bg-gray-100 dark:bg-slate-800 rounded-lg px-3 py-2">
                    <Users size={16} className="text-gray-500 dark:text-slate-400" />
                    <select
                      value={selectedTeam}
                      onChange={(e) => setSelectedTeam(e.target.value)}
                      className="text-sm font-medium bg-transparent border-none outline-none text-gray-700 dark:text-slate-300 cursor-pointer pr-6 min-w-[140px]"
                    >
                      <option value="all">All Teams</option>
                      {filteredTeams.map((team) => (
                        <option key={team.id} value={team.id}>{team.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Selected Team Indicator */}
                  {selectedTeam !== 'all' && (
                    <div className="flex items-center gap-2 bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 rounded-lg px-3 py-2 text-sm font-medium">
                      <span>Viewing: {filteredTeams.find(t => t.id === selectedTeam)?.name}</span>
                      <button 
                        onClick={() => setSelectedTeam('all')}
                        className="hover:text-cyan-900 dark:hover:text-cyan-200"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Features Grid - Only show when team is selected or for team leads */}
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        {(user?.role === 'team_lead' || selectedTeam !== 'all') ? (
          /* Team selected or team lead - show features */
          <div className={`grid ${getGridClass(gridColumns)} gap-6`}>
            {advancedFeatures
              .filter(f => f.enabled)
              .map(feature => (
                <FeatureCard 
                  key={feature.id} 
                  feature={feature} 
                  getIcon={getIcon}
                  getCategoryColor={getCategoryColor}
                  getCategoryName={(categoryId: string) => {
                    const cat = categories.find(c => c.id === categoryId);
                    return cat ? `${cat.emoji} ${cat.name}` : '';
                  }}
                  onSelect={() => onSelectFeature(feature.id, user?.role === 'team_lead' ? user.primaryTeamId : selectedTeam)}
                  gridSize={gridColumns}
                />
              ))}
          </div>
        ) : (
          /* No team selected - show prompt */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-6">
              <Users size={40} className="text-gray-400 dark:text-slate-500" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Select a Team to View Analytics
            </h3>
            <p className="text-gray-500 dark:text-slate-400 max-w-md mb-6">
              Analytics are team-specific. Please select a department and team from the dropdowns above to explore detailed metrics and insights.
            </p>
            <div className="flex items-center gap-2 text-sm text-cyan-600 dark:text-cyan-400">
              <Building2 size={16} />
              <span>{departments.length} departments</span>
              <span className="text-gray-300 dark:text-slate-600">•</span>
              <Users size={16} />
              <span>{teams.length} teams available</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface FeatureCardProps {
  feature: FeatureModule;
  getIcon: (iconName: string) => React.ReactNode;
  getCategoryColor: (category: string) => string;
  getCategoryName: (categoryId: string) => string;
  onSelect: () => void;
  gridSize: GridColumns;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ feature, getIcon, getCategoryColor, getCategoryName, onSelect, gridSize }) => {
  // Adjust card layout based on grid size
  const isCompact = gridSize >= 4;
  const isVeryCompact = gridSize === 5;
  
  return (
    <button
      onClick={onSelect}
      className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 hover:shadow-lg hover:border-cyan-500 dark:hover:border-cyan-500 transition-all duration-200 text-left group relative ${
        isVeryCompact ? 'p-4' : 'p-6'
      }`}
    >
      {/* Category Badge */}
      <div className={`absolute top-3 right-3 ${isVeryCompact ? 'text-xs' : 'text-xs'} px-2 py-1 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 font-medium`}>
        {getCategoryName(feature.category)}
      </div>
      
      <div className={`${isVeryCompact ? 'w-10 h-10' : isCompact ? 'w-12 h-12' : 'w-14 h-14'} rounded-xl bg-gradient-to-br ${getCategoryColor(feature.category)} flex items-center justify-center text-white mb-3 group-hover:scale-110 transition-transform`}>
        <div className={isVeryCompact ? 'scale-75' : isCompact ? 'scale-90' : ''}>
          {getIcon(feature.icon)}
        </div>
      </div>
      
      <h3 className={`${isVeryCompact ? 'text-sm' : 'text-base'} font-semibold text-gray-900 dark:text-white mb-2 transition-colors line-clamp-2 pr-16`}>
        {feature.name}
      </h3>
      
      <p className={`${isVeryCompact ? 'text-xs' : 'text-sm'} text-gray-600 dark:text-slate-400 leading-relaxed ${isVeryCompact ? 'line-clamp-2' : 'line-clamp-3'}`}>
        {feature.description}
      </p>
      
      <div className={`${isVeryCompact ? 'mt-2' : 'mt-4'} flex items-center text-cyan-600 dark:text-cyan-400 ${isVeryCompact ? 'text-xs' : 'text-sm'} font-medium group-hover:translate-x-1 transition-transform`}>
        <span>Explore</span>
        <svg className={`${isVeryCompact ? 'w-3 h-3' : 'w-4 h-4'} ml-1`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
};

export default FeaturesMenu;
