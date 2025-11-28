import React, { useState, useEffect, useMemo } from 'react';
import type { Team } from '../data/mockData';
import { generateDetailedKPIs } from '../data/detailedKPIs';
import API_URL from '../config/api';
import { getMetricTextColor, getMetricStatus, METRICS_CONFIG } from '../config/metricsConfig';

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

interface TeamAISuggestions {
  teamId: string;
  teamName: string;
  qaScore: number;
  aiEnabled: boolean;
  source?: 'groq' | 'rule-based';
  message?: string;
  strongpoints: string[];
  areasOfImprovement: string[];
  actionPlan: {
    priority: string;
    initiative: string;
    owner: string;
    timebox: string;
    kpi: string;
  }[];
}

interface DeveloperAISuggestion {
  name: string;
  status: 'healthy' | 'at-risk' | 'needs-attention';
  summary: string;
  strengths: string[];
  concerns: string[];
  suggestion: string;
}

interface DeveloperAISuggestions {
  teamId: string;
  aiEnabled: boolean;
  source?: 'groq' | 'rule-based';
  developers: DeveloperAISuggestion[];
  teamInsight: string;
  metrics: {
    name: string;
    prMergeTimeHours: number;
    codeReviewTimeHours: number;
    focusTimeHours: number;
    meetingTimeHours: number;
    contextSwitchesPerDay: number;
    happinessScore: number;
  }[];
  message?: string;
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
  const [aiSuggestions, setAISuggestions] = useState<TeamAISuggestions | null>(null);
  const [aiLoading, setAILoading] = useState(false);
  const [aiError, setAIError] = useState<string | null>(null);
  const [devAISuggestions, setDevAISuggestions] = useState<DeveloperAISuggestions | null>(null);
  const [devAILoading, setDevAILoading] = useState(false);

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

          // Fetch real developer metrics from database
          const metricsResponse = await fetch(`${API_URL}/teams/${team.id}/developer-ai-suggestions`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });

          let dbMetrics: Record<string, any> = {};
          if (metricsResponse.ok) {
            const metricsData = await metricsResponse.json();
            // Build lookup by developer name
            if (metricsData.metrics && Array.isArray(metricsData.metrics)) {
              metricsData.metrics.forEach((m: any) => {
                dbMetrics[m.name] = m;
              });
            }
          }

          // Map members to metrics (use DB values if available, otherwise generate defaults)
          const metricsDataFinal = members.map((member: TeamMember) => {
            const fullName = `${member.first_name} ${member.last_name}`;
            const dbData = dbMetrics[fullName];
            
            // If we have DB data, use it; otherwise generate placeholder values
            if (dbData) {
              return {
                developer_id: member.id,
                name: fullName,
                email: member.email,
                code_review_time_avg: dbData.codeReviewTimeHours,
                pr_merge_time_avg: dbData.prMergeTimeHours,
                happiness_score: dbData.happinessScore,
                context_switches_per_day: dbData.contextSwitchesPerDay,
                focus_time_hours: dbData.focusTimeHours,
                meeting_time_hours: dbData.meetingTimeHours
              };
            }
            
            // No DB data - generate placeholder metrics
            return {
              developer_id: member.id,
              name: fullName,
              email: member.email,
              code_review_time_avg: Number((Math.random() * 4 + 1).toFixed(1)),
              pr_merge_time_avg: Number((Math.random() * 24 + 2).toFixed(1)),
              happiness_score: Math.floor(Math.random() * 30) + 70,
              context_switches_per_day: Math.floor(Math.random() * 10) + 3,
              focus_time_hours: Number((Math.random() * 4 + 2).toFixed(1)),
              meeting_time_hours: Number((Math.random() * 3 + 1).toFixed(1))
            };
          });

          console.log('Developer metrics from DB:', metricsDataFinal);
          setDevelopers(metricsDataFinal);
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
  
  useEffect(() => {
    const fetchAISuggestions = async () => {
      try {
        setAILoading(true);
        setAIError(null);
        const token = localStorage.getItem('irongate_token');
        if (!token) {
          setAILoading(false);
          return;
        }

        const response = await fetch(`${API_URL}/teams/${team.id}/ai-suggestions`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          setAIError(errorData.error || 'Failed to load AI insights');
          setAILoading(false);
          return;
        }

        const data = await response.json();
        setAISuggestions(data as TeamAISuggestions);
      } catch (error) {
        setAIError('Failed to load AI insights');
      } finally {
        setAILoading(false);
      }
    };

    fetchAISuggestions();
  }, [team.id]);

  // Fetch developer AI suggestions
  useEffect(() => {
    const fetchDevAISuggestions = async () => {
      try {
        setDevAILoading(true);
        const token = localStorage.getItem('irongate_token');
        if (!token) {
          setDevAILoading(false);
          return;
        }

        const response = await fetch(`${API_URL}/teams/${team.id}/developer-ai-suggestions`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setDevAISuggestions(data as DeveloperAISuggestions);
        }
      } catch (error) {
        console.error('Error fetching developer AI suggestions:', error);
      } finally {
        setDevAILoading(false);
      }
    };

    fetchDevAISuggestions();
  }, [team.id]);
  
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
                    <div className={`text-3xl font-bold ${getMetricTextColor(team.technicalDebtScore, 'technicalDebtScore')}`}>
                      {team.technicalDebtScore}
                    </div>
                    <span className="text-sm text-gray-500 dark:text-slate-400">{METRICS_CONFIG.technicalDebtScore.unit}</span>
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
      
      <div className="px-4 sm:px-6 lg:px-8 pb-10">
        <div className="max-w-6xl mx-auto">
          {/* Metrics Overview Section */}
          {team.kpiData && (
            <div className="mb-8">
              <div className="mb-4 flex items-center gap-2">
                <BarChart3 className="text-cyan-500" size={24} />
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Metrics Overview</h2>
              </div>
              <p className="text-sm text-slate-400 mb-4">
                These are the key metrics used to generate AI recommendations. Understanding your current state helps validate the suggestions below.
              </p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Test Coverage */}
                <div className={`rounded-lg border p-3 ${
                  testCoverage >= 80 ? 'border-emerald-500/40 bg-emerald-500/10' :
                  testCoverage >= 60 ? 'border-amber-500/40 bg-amber-500/10' :
                  'border-red-500/40 bg-red-500/10'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-400 uppercase">Test Coverage</span>
                    <span className={`text-lg font-bold ${
                      testCoverage >= 80 ? 'text-emerald-400' : testCoverage >= 60 ? 'text-amber-400' : 'text-red-400'
                    }`}>{testCoverage.toFixed(1)}%</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {testCoverage >= 80 ? 'Excellent coverage reduces production bugs' :
                     testCoverage >= 60 ? 'Moderate coverage — aim for 80%+ for stability' :
                     'Low coverage increases risk of undetected bugs'}
                  </p>
                </div>

                {/* Defect Density */}
                <div className={`rounded-lg border p-3 ${
                  defectDensity <= 0.5 ? 'border-emerald-500/40 bg-emerald-500/10' :
                  defectDensity <= 1.0 ? 'border-amber-500/40 bg-amber-500/10' :
                  'border-red-500/40 bg-red-500/10'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-400 uppercase">Defect Density</span>
                    <span className={`text-lg font-bold ${
                      defectDensity <= 0.5 ? 'text-emerald-400' : defectDensity <= 1.0 ? 'text-amber-400' : 'text-red-400'
                    }`}>{defectDensity.toFixed(2)}</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {defectDensity <= 0.5 ? 'Low defect rate indicates quality code' :
                     defectDensity <= 1.0 ? 'Moderate — review testing practices' :
                     'High defect rate needs immediate attention'}
                  </p>
                </div>

                {/* Automation Coverage */}
                <div className={`rounded-lg border p-3 ${
                  automationCoverage >= 70 ? 'border-emerald-500/40 bg-emerald-500/10' :
                  automationCoverage >= 50 ? 'border-amber-500/40 bg-amber-500/10' :
                  'border-red-500/40 bg-red-500/10'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-400 uppercase">Automation</span>
                    <span className={`text-lg font-bold ${
                      automationCoverage >= 70 ? 'text-emerald-400' : automationCoverage >= 50 ? 'text-amber-400' : 'text-red-400'
                    }`}>{automationCoverage.toFixed(1)}%</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {automationCoverage >= 70 ? 'Strong automation enables fast releases' :
                     automationCoverage >= 50 ? 'Moderate — automate critical paths first' :
                     'Low automation slows delivery and increases risk'}
                  </p>
                </div>

                {/* Lead Time */}
                {kpi.leadTimeDays !== undefined && (
                  <div className={`rounded-lg border p-3 ${
                    Number(kpi.leadTimeDays) <= 3 ? 'border-emerald-500/40 bg-emerald-500/10' :
                    Number(kpi.leadTimeDays) <= 7 ? 'border-amber-500/40 bg-amber-500/10' :
                    'border-red-500/40 bg-red-500/10'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-400 uppercase">Lead Time</span>
                      <span className={`text-lg font-bold ${
                        Number(kpi.leadTimeDays) <= 3 ? 'text-emerald-400' : Number(kpi.leadTimeDays) <= 7 ? 'text-amber-400' : 'text-red-400'
                      }`}>{Number(kpi.leadTimeDays).toFixed(1)}d</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {Number(kpi.leadTimeDays) <= 3 ? 'Fast delivery from commit to production' :
                       Number(kpi.leadTimeDays) <= 7 ? 'Moderate — look for bottlenecks' :
                       'Slow pipeline needs optimization'}
                    </p>
                  </div>
                )}

                {/* MTTR */}
                {kpi.mttrHours !== undefined && (
                  <div className={`rounded-lg border p-3 ${
                    Number(kpi.mttrHours) <= 1 ? 'border-emerald-500/40 bg-emerald-500/10' :
                    Number(kpi.mttrHours) <= 4 ? 'border-amber-500/40 bg-amber-500/10' :
                    'border-red-500/40 bg-red-500/10'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-400 uppercase">MTTR</span>
                      <span className={`text-lg font-bold ${
                        Number(kpi.mttrHours) <= 1 ? 'text-emerald-400' : Number(kpi.mttrHours) <= 4 ? 'text-amber-400' : 'text-red-400'
                      }`}>{Number(kpi.mttrHours).toFixed(1)}h</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {Number(kpi.mttrHours) <= 1 ? 'Quick recovery minimizes user impact' :
                       Number(kpi.mttrHours) <= 4 ? 'Acceptable — improve incident response' :
                       'Slow recovery hurts reliability'}
                    </p>
                  </div>
                )}

                {/* Sprint Commitment */}
                {kpi.sprintCommitmentRate !== undefined && (
                  <div className={`rounded-lg border p-3 ${
                    Number(kpi.sprintCommitmentRate) >= 90 ? 'border-emerald-500/40 bg-emerald-500/10' :
                    Number(kpi.sprintCommitmentRate) >= 75 ? 'border-amber-500/40 bg-amber-500/10' :
                    'border-red-500/40 bg-red-500/10'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-400 uppercase">Sprint Commit</span>
                      <span className={`text-lg font-bold ${
                        Number(kpi.sprintCommitmentRate) >= 90 ? 'text-emerald-400' : Number(kpi.sprintCommitmentRate) >= 75 ? 'text-amber-400' : 'text-red-400'
                      }`}>{Number(kpi.sprintCommitmentRate).toFixed(0)}%</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {Number(kpi.sprintCommitmentRate) >= 90 ? 'Team delivers on commitments reliably' :
                       Number(kpi.sprintCommitmentRate) >= 75 ? 'Moderate — refine estimation practices' :
                       'Low commitment rate affects planning'}
                    </p>
                  </div>
                )}

                {/* Change Failure Rate */}
                {kpi.changeFailureRate !== undefined && (
                  <div className={`rounded-lg border p-3 ${
                    Number(kpi.changeFailureRate) <= 5 ? 'border-emerald-500/40 bg-emerald-500/10' :
                    Number(kpi.changeFailureRate) <= 15 ? 'border-amber-500/40 bg-amber-500/10' :
                    'border-red-500/40 bg-red-500/10'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-400 uppercase">Change Failure</span>
                      <span className={`text-lg font-bold ${
                        Number(kpi.changeFailureRate) <= 5 ? 'text-emerald-400' : Number(kpi.changeFailureRate) <= 15 ? 'text-amber-400' : 'text-red-400'
                      }`}>{Number(kpi.changeFailureRate).toFixed(1)}%</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {Number(kpi.changeFailureRate) <= 5 ? 'Low failure rate shows mature CI/CD' :
                       Number(kpi.changeFailureRate) <= 15 ? 'Moderate — improve pre-deploy testing' :
                       'High failure rate needs process review'}
                    </p>
                  </div>
                )}

                {/* Build Time */}
                {kpi.avgBuildTimeMinutes !== undefined && (
                  <div className={`rounded-lg border p-3 ${
                    Number(kpi.avgBuildTimeMinutes) <= 10 ? 'border-emerald-500/40 bg-emerald-500/10' :
                    Number(kpi.avgBuildTimeMinutes) <= 20 ? 'border-amber-500/40 bg-amber-500/10' :
                    'border-red-500/40 bg-red-500/10'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-400 uppercase">Build Time</span>
                      <span className={`text-lg font-bold ${
                        Number(kpi.avgBuildTimeMinutes) <= 10 ? 'text-emerald-400' : Number(kpi.avgBuildTimeMinutes) <= 20 ? 'text-amber-400' : 'text-red-400'
                      }`}>{Number(kpi.avgBuildTimeMinutes).toFixed(0)}m</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {Number(kpi.avgBuildTimeMinutes) <= 10 ? 'Fast builds keep developers productive' :
                       Number(kpi.avgBuildTimeMinutes) <= 20 ? 'Moderate — consider caching/parallelization' :
                       'Slow builds hurt developer flow'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI Insights Header */}
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Bot className="text-purple-500" size={24} />
              AI Insights
            </h2>
            {aiLoading && (
              <span className="text-sm text-gray-500 dark:text-slate-400">Generating recommendations...</span>
            )}
          </div>

          {aiError && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {aiError}
            </div>
          )}

          {!aiLoading && !aiError && !aiSuggestions && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">
              No AI insights available yet for this team. Make sure metrics are recorded.
            </div>
          )}

          {/* AI Disabled Message */}
          {aiSuggestions && !aiSuggestions.aiEnabled && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
              <span className="font-medium">AI suggestions are disabled for this team.</span>
              <span className="ml-1 text-amber-400/80">Enable AI in admin settings to get personalized recommendations.</span>
            </div>
          )}

          {/* AI Enabled - Show Suggestions */}
          {aiSuggestions && aiSuggestions.aiEnabled && (
            <>
              {/* Source indicator and disclaimer */}
              {aiSuggestions.source && (
                <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0">
                  <div className="text-xs text-slate-500">
                    Powered by: <span className="text-purple-400">{aiSuggestions.source === 'groq' ? 'AI' : 'Rule-based analysis'}</span>
                  </div>
                  {aiSuggestions.source === 'groq' && (
                    <div className="text-[10px] text-slate-500 italic">
                      ⚠️ Generated by AI. May contain inaccuracies — please verify before acting.
                    </div>
                  )}
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-emerald-400 uppercase tracking-wide">Strongpoints</h3>
                  <ul className="space-y-2 text-sm text-slate-200">
                    {aiSuggestions.strongpoints.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="mt-0.5 text-emerald-400">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                    {aiSuggestions.strongpoints.length === 0 && (
                      <li className="text-slate-500 italic">No strongpoints identified</li>
                    )}
                  </ul>
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wide">Areas of Improvement</h3>
                  <ul className="space-y-2 text-sm text-slate-200">
                    {aiSuggestions.areasOfImprovement.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="mt-0.5 text-amber-400">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                    {aiSuggestions.areasOfImprovement.length === 0 && (
                      <li className="text-slate-500 italic">No areas of improvement identified</li>
                    )}
                  </ul>
                </div>

                <div className="md:col-span-2 lg:col-span-1 space-y-3">
                  <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wide">Action Plan</h3>
                  <div className="space-y-3">
                    {aiSuggestions.actionPlan.map((item, idx) => (
                      <div key={idx} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-semibold uppercase tracking-wide ${
                            item.priority === 'Urgent' ? 'text-red-400' : 
                            item.priority === 'Moderate' ? 'text-amber-400' : 'text-slate-300'
                          }`}>
                            {item.priority}
                          </span>
                          <span className="text-[11px] text-slate-400">{item.timebox}</span>
                        </div>
                        <div className="text-sm font-medium text-slate-100 mb-1">{item.initiative}</div>
                        <div className="text-xs text-slate-400 mb-1">Owner: {item.owner}</div>
                        <div className="text-xs text-emerald-300">KPI: {item.kpi}</div>
                      </div>
                    ))}
                    {aiSuggestions.actionPlan.length === 0 && (
                      <div className="text-slate-500 italic text-sm">No action items</div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Developer AI Insights Section */}
      <div className="px-4 sm:px-6 lg:px-8 pb-10">
        <div className="max-w-6xl mx-auto">
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Users className="text-indigo-500" size={24} />
              Developer Insights
            </h2>
            {devAILoading && (
              <span className="text-sm text-gray-500 dark:text-slate-400">Analyzing developer metrics...</span>
            )}
          </div>

          {/* Team Insight Summary */}
          {devAISuggestions && devAISuggestions.aiEnabled && devAISuggestions.teamInsight && (
            <div className="mb-4 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-3">
              <p className="text-sm text-indigo-300">{devAISuggestions.teamInsight}</p>
              {devAISuggestions.source && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">
                    Powered by: <span className="text-purple-400">{devAISuggestions.source === 'groq' ? 'AI' : 'Rule-based analysis'}</span>
                  </span>
                  {devAISuggestions.source === 'groq' && (
                    <span className="text-[10px] text-slate-500 italic">
                      ⚠️ Generated by AI. May contain inaccuracies.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Raw Developer Metrics Table */}
          {devAISuggestions?.metrics && devAISuggestions.metrics.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">Saved Developer Metrics</h3>
                <span className="text-xs text-slate-500">
                  Showing {devAISuggestions.metrics.length} developer{devAISuggestions.metrics.length > 1 ? 's' : ''}
                </span>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/40">
                <table className="min-w-full text-xs sm:text-sm text-left">
                  <thead className="bg-slate-900/60 text-slate-400 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-3 font-medium">Developer</th>
                      <th className="px-4 py-3 font-medium">PR Time (h)</th>
                      <th className="px-4 py-3 font-medium">Review (h)</th>
                      <th className="px-4 py-3 font-medium">Focus (h/day)</th>
                      <th className="px-4 py-3 font-medium">Meetings (h/day)</th>
                      <th className="px-4 py-3 font-medium">Context Switches</th>
                      <th className="px-4 py-3 font-medium">Happiness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devAISuggestions.metrics.map((metric) => (
                      <tr key={metric.name} className="border-t border-slate-800/70">
                        <td className="px-4 py-3 text-slate-200 font-medium">{metric.name}</td>
                        <td className="px-4 py-3 text-slate-300">{metric.prMergeTimeHours.toFixed(1)}</td>
                        <td className="px-4 py-3 text-slate-300">{metric.codeReviewTimeHours.toFixed(1)}</td>
                        <td className="px-4 py-3 text-slate-300">{metric.focusTimeHours.toFixed(1)}</td>
                        <td className="px-4 py-3 text-slate-300">{metric.meetingTimeHours.toFixed(1)}</td>
                        <td className="px-4 py-3 text-slate-300">{metric.contextSwitchesPerDay}</td>
                        <td className="px-4 py-3 text-slate-300">{metric.happinessScore.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* No data message */}
          {!devAILoading && devAISuggestions && devAISuggestions.developers.length === 0 && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">
              {devAISuggestions.message || 'No developer metrics available. Add developer metrics in the Manual Metrics Input section.'}
            </div>
          )}

          {/* Developer Cards */}
          {devAISuggestions && devAISuggestions.aiEnabled && devAISuggestions.developers.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {devAISuggestions.developers.map((dev, idx) => {
                const metrics = devAISuggestions.metrics?.find(m => m.name === dev.name);
                return (
                  <div 
                    key={idx} 
                    className={`rounded-lg border p-4 ${
                      dev.status === 'healthy' ? 'border-emerald-500/40 bg-emerald-500/5' :
                      dev.status === 'at-risk' ? 'border-amber-500/40 bg-amber-500/5' :
                      'border-red-500/40 bg-red-500/5'
                    }`}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-slate-100">{dev.name}</h4>
                      <span className={`text-[10px] font-medium uppercase px-2 py-0.5 rounded-full ${
                        dev.status === 'healthy' ? 'bg-emerald-500/20 text-emerald-400' :
                        dev.status === 'at-risk' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {dev.status.replace('-', ' ')}
                      </span>
                    </div>

                    {/* Metrics Row */}
                    {metrics && (
                      <div className="grid grid-cols-5 gap-1 mb-3 text-center">
                        <div className="bg-slate-800/50 rounded p-1.5">
                          <div className="text-[10px] text-slate-500 uppercase">PR</div>
                          <div className={`text-xs font-bold ${getMetricTextColor(metrics.prMergeTimeHours, 'prMergeTimeHours')}`}>
                            {metrics.prMergeTimeHours.toFixed(1)}h
                          </div>
                        </div>
                        <div className="bg-slate-800/50 rounded p-1.5">
                          <div className="text-[10px] text-slate-500 uppercase">Review</div>
                          <div className={`text-xs font-bold ${getMetricTextColor(metrics.codeReviewTimeHours, 'codeReviewTimeHours')}`}>
                            {metrics.codeReviewTimeHours.toFixed(1)}h
                          </div>
                        </div>
                        <div className="bg-slate-800/50 rounded p-1.5">
                          <div className="text-[10px] text-slate-500 uppercase">Focus</div>
                          <div className={`text-xs font-bold ${getMetricTextColor(metrics.focusTimeHours, 'focusTimeHours')}`}>
                            {metrics.focusTimeHours.toFixed(1)}h
                          </div>
                        </div>
                        <div className="bg-slate-800/50 rounded p-1.5">
                          <div className="text-[10px] text-slate-500 uppercase">Mtgs</div>
                          <div className={`text-xs font-bold ${getMetricTextColor(metrics.meetingTimeHours, 'meetingTimeHours')}`}>
                            {metrics.meetingTimeHours.toFixed(1)}h
                          </div>
                        </div>
                        <div className="bg-slate-800/50 rounded p-1.5">
                          <div className="text-[10px] text-slate-500 uppercase">Ctx</div>
                          <div className={`text-xs font-bold ${getMetricTextColor(metrics.contextSwitchesPerDay, 'contextSwitchesPerDay')}`}>
                            {metrics.contextSwitchesPerDay}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Summary */}
                    <p className="text-xs text-slate-400 mb-2">{dev.summary}</p>

                    {/* Strengths */}
                    {dev.strengths.length > 0 && (
                      <div className="mb-2">
                        <div className="text-[10px] text-emerald-400 uppercase font-medium mb-1">Strengths</div>
                        <div className="flex flex-wrap gap-1">
                          {dev.strengths.map((s, i) => (
                            <span key={i} className="text-[10px] bg-emerald-500/10 text-emerald-300 px-1.5 py-0.5 rounded">
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Concerns */}
                    {dev.concerns.length > 0 && (
                      <div className="mb-2">
                        <div className="text-[10px] text-amber-400 uppercase font-medium mb-1">Concerns</div>
                        <div className="flex flex-wrap gap-1">
                          {dev.concerns.map((c, i) => (
                            <span key={i} className="text-[10px] bg-amber-500/10 text-amber-300 px-1.5 py-0.5 rounded">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Suggestion */}
                    <div className="mt-3 pt-2 border-t border-slate-700">
                      <div className="text-[10px] text-cyan-400 uppercase font-medium mb-1">Recommendation</div>
                      <p className="text-xs text-slate-300">{dev.suggestion}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeamDetailView;
