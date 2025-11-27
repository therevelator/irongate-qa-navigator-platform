import React, { useState, useEffect, useMemo } from 'react';
import type { Team } from '../data/mockData';
import { generateDetailedKPIs } from '../data/detailedKPIs';
import API_URL from '../config/api';

// Extended Team type with kpiData from API
interface TeamWithKPI extends Team {
  kpiData?: {
    testCoverage?: number;
    testFlakinessRate?: number;
    defectDensity?: number;
    defectEscapeRate?: number;
    codeQualityScore?: number;
    avgBuildTimeMinutes?: number;
    testExecutionTimeMinutes?: number;
    deploymentFrequencyPerWeek?: number;
    leadTimeDays?: number;
    mttrHours?: number;
    parallelTestEfficiency?: number;
    sprintVelocity?: number;
    sprintCommitmentRate?: number;
    sprintCarryover?: number;
    firstTimePassRate?: number;
    blockedTimeHours?: number;
    automationCoverage?: number;
    automationRoi?: number;
    changeFailureRate?: number;
    mtbfHours?: number;
    systemAvailability?: number;
    infrastructureFailures?: number;
  };
}
import { ArrowLeft, TrendingUp, TrendingDown, Minus, Shield, Bug, Bot, BarChart3, Clock, GitPullRequest, Zap, Users } from 'lucide-react';
import { AreaChart, Area, Tooltip, ResponsiveContainer } from 'recharts';

interface TeamMember {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  avatar_url?: string;
}

interface DeveloperMetrics {
  developer_id: string;
  name: string;
  email: string;
  code_review_time_avg: number;
  pr_merge_time_avg: number;
  happiness_score: number;
  context_switches_per_day: number;
  focus_time_hours: number;
  meeting_time_hours: number;
}

interface TeamDetailViewProps {
  team: TeamWithKPI;
  onBack: () => void;
}

const TeamDetailView: React.FC<TeamDetailViewProps> = ({ team, onBack }) => {
  // Use useMemo to prevent regenerating KPIs on every render
  const detailedKPIs = useMemo(() => generateDetailedKPIs(team), [team]);
  
  // Get real values from kpiData or use defaults
  const kpi = team.kpiData || {};
  const testCoverage = Number(kpi.testCoverage) || 0;
  const defectDensity = Number(kpi.defectDensity) || 0;
  const automationCoverage = Number(kpi.automationCoverage) || 0;
  const [developers, setDevelopers] = useState<DeveloperMetrics[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch team members from database
  useEffect(() => {
    const fetchTeamMembers = async () => {
      try {
        const token = localStorage.getItem('irongate_token');
        if (!token) {
          console.error('No auth token found');
          setLoading(false);
          return;
        }

        console.log(`Fetching members for team: ${team.id} (${team.name})`);
        const response = await fetch(`${API_URL}/teams/${team.id}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        console.log('Response status:', response.status);

        if (response.ok) {
          const data = await response.json();
          console.log('Team data received:', data);
          
          const members = data.team?.members || [];
          console.log(`Found ${members.length} members:`, members);

          if (members.length === 0) {
            console.warn(`⚠️ No members found for team ${team.id} (${team.name}). Check team_members table.`);
          }

          // Generate fake metrics for each team member
          const metricsData = members.map((member: TeamMember) => ({
            developer_id: member.id,
            name: `${member.first_name} ${member.last_name}`,
            email: member.email,
            code_review_time_avg: Number((Math.random() * 4 + 1).toFixed(1)),
            pr_merge_time_avg: Number((Math.random() * 24 + 2).toFixed(1)),
            happiness_score: Math.floor(Math.random() * 30) + 70,
            context_switches_per_day: Math.floor(Math.random() * 10) + 3,
            focus_time_hours: Number((Math.random() * 4 + 2).toFixed(1)),
            meeting_time_hours: Number((Math.random() * 3 + 1).toFixed(1))
          }));

          console.log('Generated metrics for members:', metricsData);
          setDevelopers(metricsData);
        } else {
          const errorData = await response.json();
          console.error('Failed to fetch team:', response.status, errorData);
        }
      } catch (error) {
        console.error('Error fetching team members:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTeamMembers();
  }, [team.id, team.name]);
  
  const categories = [
    { id: 'quality', name: 'Quality & Testing', color: 'blue' },
    { id: 'speed', name: 'Speed & Efficiency', color: 'purple' },
    { id: 'agile', name: 'Agile & Process', color: 'green' },
    { id: 'reliability', name: 'Reliability & Stability', color: 'orange' }
  ];

  const getKPIsByCategory = (category: string) => {
    return detailedKPIs.filter(kpi => kpi.category === category);
  };

  const scoreColor = team.status === 'good' ? '#10b981' : team.status === 'warning' ? '#f59e0b' : '#ef4444';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b dark:border-slate-800 sticky top-0 z-10">
        <div className="px-8 py-6">
          <button 
            onClick={onBack}
            className="flex items-center space-x-2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white mb-4 transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="font-medium">Back to Teams</span>
          </button>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{team.name}</h1>
              <p className="text-gray-500 dark:text-slate-400 mt-1">{team.department} • Detailed Quality Metrics</p>
            </div>
            
            <div className="flex items-center space-x-8">
              {/* Technical Debt Score */}
              {team.technicalDebtScore !== undefined && (
                <div className="text-right">
                  <p className="text-sm text-gray-500 dark:text-slate-400">Technical Debt</p>
                  <div className="flex items-baseline space-x-1">
                    <div className={`text-3xl font-bold ${
                      team.technicalDebtScore < 30 ? 'text-green-600 dark:text-green-400' :
                      team.technicalDebtScore < 60 ? 'text-yellow-600 dark:text-yellow-400' :
                      'text-red-600 dark:text-red-400'
                    }`}>
                      {team.technicalDebtScore}
                    </div>
                    <span className="text-sm text-gray-500 dark:text-slate-400">/100</span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Lower is better</p>
                </div>
              )}
              
              {/* Task Sizing Accuracy */}
              {team.taskSizingAccuracy !== undefined && (
                <div className="text-right">
                  <p className="text-sm text-gray-500 dark:text-slate-400">Sizing Accuracy</p>
                  <div className="flex items-baseline space-x-1">
                    <div className={`text-3xl font-bold ${
                      Math.abs(team.taskSizingAccuracy - 1.0) < 0.15 ? 'text-green-600 dark:text-green-400' :
                      Math.abs(team.taskSizingAccuracy - 1.0) < 0.3 ? 'text-yellow-600 dark:text-yellow-400' :
                      'text-red-600 dark:text-red-400'
                    }`}>
                      {team.taskSizingAccuracy.toFixed(2)}
                    </div>
                    <span className="text-sm text-gray-500 dark:text-slate-400">x</span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                    {team.taskSizingAccuracy < 0.85 ? 'Overestimated' : 
                     team.taskSizingAccuracy > 1.15 ? 'Underestimated' : 
                     'Well estimated'}
                  </p>
                </div>
              )}
              
              {/* QA Score */}
              <div className="text-right">
                <p className="text-sm text-gray-500 dark:text-slate-400">Team QA Score</p>
                <div className="text-4xl font-bold text-gray-900 dark:text-white">{team.qaScore}/100</div>
              </div>
              <div className="relative w-20 h-20">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="40" cy="40" r="35" stroke="#e5e7eb" strokeWidth="6" fill="transparent" className="dark:stroke-slate-700" />
                  <circle 
                    cx="40" 
                    cy="40" 
                    r="35" 
                    stroke={scoreColor} 
                    strokeWidth="6" 
                    fill="transparent"
                    strokeDasharray={2 * Math.PI * 35}
                    strokeDashoffset={2 * Math.PI * 35 - (team.qaScore / 100) * 2 * Math.PI * 35}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-xl font-bold text-gray-900 dark:text-white">
                  {team.qaScore}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className="px-8 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Overall Quality Score */}
          <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-gray-200 dark:border-slate-800 hover:shadow-lg transition-all hover:scale-105 animate-fadeIn">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <BarChart3 className="text-blue-600 dark:text-blue-300" size={24} />
              </div>
              <span className="text-sm text-green-600 flex items-center">
                <TrendingUp size={16} className="mr-1" />
                +5.2%
              </span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{team.qaScore}%</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">Overall Quality Score</p>
          </div>

          {/* Test Coverage */}
          <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-gray-200 dark:border-slate-800 hover:shadow-lg transition-all hover:scale-105 animate-fadeIn" style={{ animationDelay: '100ms' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg">
                <Shield className="text-green-600 dark:text-green-300" size={24} />
              </div>
              <span className={`text-sm flex items-center ${testCoverage >= 80 ? 'text-green-600' : testCoverage >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                {testCoverage >= 80 ? <TrendingUp size={16} className="mr-1" /> : <TrendingDown size={16} className="mr-1" />}
                {testCoverage >= 80 ? 'Good' : testCoverage >= 70 ? 'Warning' : 'Low'}
              </span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{testCoverage.toFixed(1)}%</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">Test Coverage</p>
          </div>

          {/* Defect Density */}
          <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-gray-200 dark:border-slate-800 hover:shadow-lg transition-all hover:scale-105 animate-fadeIn" style={{ animationDelay: '200ms' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-amber-100 dark:bg-amber-900 rounded-lg">
                <Bug className="text-amber-600 dark:text-amber-300" size={24} />
              </div>
              <span className={`text-sm flex items-center ${defectDensity <= 0.5 ? 'text-green-600' : defectDensity <= 1.0 ? 'text-amber-600' : 'text-red-600'}`}>
                {defectDensity <= 0.5 ? <TrendingDown size={16} className="mr-1" /> : <TrendingUp size={16} className="mr-1" />}
                {defectDensity <= 0.5 ? 'Good' : defectDensity <= 1.0 ? 'Warning' : 'High'}
              </span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{defectDensity.toFixed(2)}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">Defect Density</p>
          </div>

          {/* Automation Rate */}
          <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-gray-200 dark:border-slate-800 hover:shadow-lg transition-all hover:scale-105 animate-fadeIn" style={{ animationDelay: '300ms' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-lg">
                <Bot className="text-purple-600 dark:text-purple-300" size={24} />
              </div>
              <span className={`text-sm flex items-center ${automationCoverage >= 70 ? 'text-green-600' : automationCoverage >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                {automationCoverage >= 70 ? <TrendingUp size={16} className="mr-1" /> : <TrendingDown size={16} className="mr-1" />}
                {automationCoverage >= 70 ? 'Good' : automationCoverage >= 50 ? 'Warning' : 'Low'}
              </span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{automationCoverage.toFixed(1)}%</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">Automation Rate</p>
          </div>
        </div>
      </div>

      {/* Developer Productivity Section */}
      <div className="px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
            <Users className="mr-3 text-purple-600" size={28} />
            Team Members
          </h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {loading ? 'Loading...' : `${developers.length} ${developers.length === 1 ? 'developer' : 'developers'}`}
          </span>
        </div>
        
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
          </div>
        ) : developers.length === 0 ? (
          <div className="bg-gray-50 dark:bg-slate-800 rounded-xl p-8 text-center">
            <Users className="mx-auto mb-4 text-gray-400" size={48} />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Team Members</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">This team doesn't have any members assigned yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {developers.map((developer) => {
            const workLifeBalance = ((developer.focus_time_hours / (developer.focus_time_hours + developer.meeting_time_hours)) * 100).toFixed(0);
            const happinessEmoji = developer.happiness_score >= 85 ? '😊' : developer.happiness_score >= 70 ? '🙂' : '😐';
            
            return (
              <div key={developer.developer_id} className="bg-gradient-to-br from-slate-800 to-slate-900 dark:from-slate-900 dark:to-black rounded-xl border border-slate-700 dark:border-slate-800 p-5 hover:shadow-xl transition-all">
                {/* Developer Header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-xl shadow-lg">
                      {developer.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-lg">{developer.name}</h3>
                      <p className="text-xs text-gray-400">Developer ID: {developer.developer_id}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-2">
                      <span className="text-3xl">{happinessEmoji}</span>
                      <span className="text-4xl font-bold text-green-400">{developer.happiness_score}</span>
                    </div>
                    <p className="text-xs text-gray-400">Happiness Score</p>
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-5 gap-3 mb-5">
                  {/* PR Time */}
                  <div className="bg-slate-700/50 dark:bg-slate-950/50 rounded-lg p-3 text-center border border-slate-600/30">
                    <GitPullRequest className="mx-auto mb-2 text-blue-400" size={16} />
                    <p className="text-xs text-gray-400 mb-1">PR Time</p>
                    <p className="text-xl font-bold text-white">{developer.pr_merge_time_avg.toFixed(1)}h</p>
                  </div>

                  {/* Review Time */}
                  <div className="bg-slate-700/50 dark:bg-slate-950/50 rounded-lg p-3 text-center border border-slate-600/30">
                    <Clock className="mx-auto mb-2 text-green-400" size={16} />
                    <p className="text-xs text-gray-400 mb-1">Review Time</p>
                    <p className="text-xl font-bold text-white">{developer.code_review_time_avg.toFixed(1)}h</p>
                  </div>

                  {/* Focus Time */}
                  <div className="bg-slate-700/50 dark:bg-slate-950/50 rounded-lg p-3 text-center border border-slate-600/30">
                    <Zap className="mx-auto mb-2 text-orange-400" size={16} />
                    <p className="text-xs text-gray-400 mb-1">Focus Time</p>
                    <p className="text-xl font-bold text-white">{developer.focus_time_hours.toFixed(1)}h</p>
                  </div>

                  {/* Meetings */}
                  <div className="bg-slate-700/50 dark:bg-slate-950/50 rounded-lg p-3 text-center border border-slate-600/30">
                    <Users className="mx-auto mb-2 text-purple-400" size={16} />
                    <p className="text-xs text-gray-400 mb-1">Meetings</p>
                    <p className="text-xl font-bold text-white">{developer.meeting_time_hours.toFixed(1)}h</p>
                  </div>

                  {/* Context Sw. */}
                  <div className="bg-slate-700/50 dark:bg-slate-950/50 rounded-lg p-3 text-center border border-slate-600/30">
                    <TrendingUp className="mx-auto mb-2 text-red-400" size={16} />
                    <p className="text-xs text-gray-400 mb-1">Context Sw.</p>
                    <p className="text-xl font-bold text-white">{developer.context_switches_per_day}</p>
                  </div>
                </div>

                {/* Work-Life Balance Bar */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-300">Work-Life Balance</span>
                    <span className="text-sm font-bold text-white">{workLifeBalance}% Focus Time</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-3">
                    <div 
                      className={`h-3 rounded-full transition-all ${
                        parseInt(workLifeBalance) > 70 ? 'bg-green-500' : 
                        parseInt(workLifeBalance) > 50 ? 'bg-yellow-500' : 
                        'bg-red-500'
                      }`}
                      style={{ width: `${workLifeBalance}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 mt-2">
                    <span>Focus: {developer.focus_time_hours.toFixed(1)}h</span>
                    <span>Meetings: {developer.meeting_time_hours.toFixed(1)}h</span>
                  </div>
                </div>

                {/* Burnout Risk Indicator */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-700">
                  <span className="text-sm font-medium text-gray-300">Burnout Risk:</span>
                  <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${
                    developer.happiness_score > 80 && developer.focus_time_hours > 4 
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                    developer.happiness_score > 70 
                      ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 
                      'bg-red-500/20 text-red-400 border border-red-500/30'
                  }`}>
                    {developer.happiness_score > 80 && developer.focus_time_hours > 4 ? '✅ Low' :
                     developer.happiness_score > 70 ? '⚠️ Moderate' : '❌ High'}
                  </span>
                </div>
              </div>
            );
          })}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-8 py-8">
        {categories.map(category => {
          const kpis = getKPIsByCategory(category.id);
          return (
            <div key={category.id} className="mb-12">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 flex items-center">
                <span className={`w-1 h-8 bg-${category.color}-500 rounded-full mr-3`}></span>
                {category.name}
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {kpis.map(kpi => (
                  <div key={kpi.id} className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-6 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex-1">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{kpi.name}</h3>
                        <p className="text-xs text-gray-500 dark:text-slate-400">{kpi.description}</p>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ml-2 flex-shrink-0 ${
                        kpi.status === 'good' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 
                        kpi.status === 'warning' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' : 
                        'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                      }`}>
                        {kpi.status}
                      </span>
                    </div>

                    <div className="mb-4">
                      <div className="text-3xl font-bold text-gray-900 dark:text-white">
                        {kpi.value}
                        <span className="text-lg font-normal text-gray-400 dark:text-slate-500 ml-1">{kpi.unit}</span>
                      </div>
                      <div className={`flex items-center text-sm font-medium mt-1 ${
                        kpi.change > 0 ? 'text-green-600 dark:text-green-400' : kpi.change < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-slate-400'
                      }`}>
                        {kpi.change > 0 ? <TrendingUp size={16} className="mr-1"/> : 
                         kpi.change < 0 ? <TrendingDown size={16} className="mr-1"/> : 
                         <Minus size={16} className="mr-1"/>}
                        {Math.abs(kpi.change)}% vs last period
                      </div>
                    </div>

                    <div className="h-24">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={kpi.history}>
                          <defs>
                            <linearGradient id={`gradient-${kpi.id}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={scoreColor} stopOpacity={0.2}/>
                              <stop offset="95%" stopColor={scoreColor} stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: '#1f2937', 
                              color: '#fff', 
                              borderRadius: '8px', 
                              border: 'none',
                              fontSize: '12px'
                            }}
                            labelStyle={{ color: '#9ca3af' }}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="value" 
                            stroke={scoreColor} 
                            fill={`url(#gradient-${kpi.id})`}
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TeamDetailView;
