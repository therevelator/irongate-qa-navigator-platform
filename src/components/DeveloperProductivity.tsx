import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Code, Clock, GitPullRequest, Gauge, Zap, Coffee, Calendar, TrendingUp, AlertCircle, Loader2, Brain, Users, Battery, Target, Sparkles } from 'lucide-react';
import type { DeveloperMetric } from '../data/advancedFeatures';
import { BarChart, Bar, LineChart, Line, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell } from 'recharts';
import { API_URL } from '../config/api';

interface DeveloperProductivityProps {
  onBack: () => void;
  teamId?: string;
}

type TeamSummary = {
  id: string;
  name: string;
};

type DeveloperProductivityMetric = Omit<DeveloperMetric, 'happiness_score'> & {
  team_id: string;
  team_name: string;
  email?: string;
  role?: string;
  has_metrics?: boolean;
  ddps_score: number; // Daily Developer Productivity Score (0-1)
};

type AIInsights = {
  aiEnabled: boolean;
  teamInsight?: string;
  developers?: Array<{
    name: string;
    status: 'healthy' | 'at-risk' | 'needs-attention';
    summary: string;
    strengths: string[];
    concerns: string[];
    suggestion: string;
  }>;
  message?: string;
  source?: string;
};

// Calculate DDPS (Daily Developer Productivity Score) 
// Uses absolute thresholds rather than ratios to ensure meaningful differentiation
// Focus time is the PRIMARY driver - a dev with 1h focus should never score well
const calculateDDPS = (dev: {
  pr_merge_time_avg: number;
  code_review_time_avg: number;
  focus_time_hours: number;
  meeting_time_hours: number;
  context_switches_per_day: number;
}): {
  ddps: number;
  norms: { ft: number; prt: number; rt: number; mt: number; cs: number };
  totalWorkHours: number;
  isOvertime: boolean;
  overtimeHours: number;
} => {
  // Calculate total estimated work hours per day
  const totalWorkHours = dev.focus_time_hours + dev.meeting_time_hours +
    (dev.code_review_time_avg * 0.3) +
    (dev.pr_merge_time_avg * 0.2);

  const isOvertime = totalWorkHours > 8;
  const overtimeHours = Math.max(0, totalWorkHours - 8);

  // === ABSOLUTE THRESHOLD-BASED SCORING ===

  // 1. FOCUS TIME (0-50 points) - PRIMARY DRIVER
  // 5h+ = 50pts, 4h = 40pts, 3h = 30pts, 2h = 20pts, 1h = 10pts, 0h = 0pts
  const focusScore = Math.min(dev.focus_time_hours / 5, 1) * 50;

  // 2. MEETING PENALTY (0 to -10 points)
  // 0-1h = 0 penalty, 2h = -3, 3h = -6, 4h+ = -10
  const meetingPenalty = dev.meeting_time_hours <= 1 ? 0 :
    dev.meeting_time_hours <= 2 ? -3 :
      dev.meeting_time_hours <= 3 ? -6 :
        -10;

  // 3. CONTEXT SWITCH PENALTY (0 to -15 points)
  // 0-2 = 0 penalty, 3-4 = -5, 5-6 = -10, 7+ = -15
  const contextPenalty = dev.context_switches_per_day <= 2 ? 0 :
    dev.context_switches_per_day <= 4 ? -5 :
      dev.context_switches_per_day <= 6 ? -10 :
        -15;

  // 4. PR MERGE TIME BONUS/PENALTY (-10 to +10 points)
  // < 4h = +10, 4-8h = +5, 8-24h = 0, 24-48h = -5, 48h+ = -10
  const prScore = dev.pr_merge_time_avg < 4 ? 10 :
    dev.pr_merge_time_avg < 8 ? 5 :
      dev.pr_merge_time_avg < 24 ? 0 :
        dev.pr_merge_time_avg < 48 ? -5 :
          -10;

  // 5. CODE REVIEW TIME BONUS/PENALTY (-5 to +5 points)
  // < 2h = +5, 2-4h = +2, 4-8h = 0, 8h+ = -5
  const reviewScore = dev.code_review_time_avg < 2 ? 5 :
    dev.code_review_time_avg < 4 ? 2 :
      dev.code_review_time_avg < 8 ? 0 :
        -5;

  // 6. WORK-LIFE BALANCE (0 to +10 points)
  // Based on overtime: 8h or less = 100% (+10pts)
  // Subtract 25% (2.5pts) for each hour over 8
  // 9h = 75% (+7.5pts), 10h = 50% (+5pts), 11h = 25% (+2.5pts), 12h+ = 0pts
  const workLifePercent = Math.max(0, 100 - (overtimeHours * 25));
  const balanceBonus = (workLifePercent / 100) * 10;

  // TOTAL SCORE (0-100)
  const rawScore = focusScore + meetingPenalty + contextPenalty + prScore + reviewScore + balanceBonus;
  const ddps = Math.max(0, Math.min(rawScore, 100)) / 100; // Normalize to 0-1

  // Normalized values for display (keep for backward compatibility)
  const ft_n = Math.min(dev.focus_time_hours / 8, 1);
  const prt_n = Math.min(dev.pr_merge_time_avg / 24, 1);
  const rt_n = dev.code_review_time_avg / 8;
  const mt_n = dev.meeting_time_hours / 8;
  const cs_n = Math.min(dev.context_switches_per_day / 5, 1);

  return {
    ddps: Math.round(ddps * 100) / 100,
    norms: {
      ft: Math.round(ft_n * 10000) / 10000,
      prt: Math.round(prt_n * 10000) / 10000,
      rt: Math.round(rt_n * 10000) / 10000,
      mt: Math.round(mt_n * 10000) / 10000,
      cs: Math.round(cs_n * 10000) / 10000
    },
    totalWorkHours: Math.round(totalWorkHours * 10) / 10,
    isOvertime,
    overtimeHours: Math.round(overtimeHours * 10) / 10
  };
};

// Convert DDPS (0-1) to percentage for display
const ddpsToPercent = (ddps: number) => Math.round(ddps * 100);

// Get DDPS status text and color
const getDDPSStatus = (ddps: number) => {
  if (ddps >= 0.8) return { status: 'Exceptional', color: 'text-green-600', bg: 'bg-green-50', emoji: '🚀' };
  if (ddps >= 0.6) return { status: 'High', color: 'text-green-600', bg: 'bg-green-50', emoji: '⚡' };
  if (ddps >= 0.4) return { status: 'Healthy', color: 'text-yellow-600', bg: 'bg-yellow-50', emoji: '✅' };
  if (ddps >= 0.2) return { status: 'Low', color: 'text-orange-600', bg: 'bg-orange-50', emoji: '⚠️' };
  return { status: 'Fragmented', color: 'text-red-600', bg: 'bg-red-50', emoji: '🔧' };
};

const DeveloperProductivity: React.FC<DeveloperProductivityProps> = ({ onBack, teamId }) => {
  const [expandedDeveloper, setExpandedDeveloper] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'efficiency' | 'pr_time' | 'review_time'>('efficiency');
  const [developers, setDevelopers] = useState<DeveloperProductivityMetric[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>(teamId || 'all');
  const [selectedDeveloperId, setSelectedDeveloperId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [aiInsights, setAiInsights] = useState<AIInsights | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [teamAiEnabled, setTeamAiEnabled] = useState(false);

  const fetchTeamDevelopers = async (
    team: TeamSummary
  ): Promise<DeveloperProductivityMetric[]> => {
    try {
      // Fetch team members and real developer metrics from DB
      const [teamResponse, metricsResponse] = await Promise.all([
        fetch(`${API_URL}/teams/${team.id}`, { credentials: 'include' }),
        fetch(`${API_URL}/analytics/developer-metrics?teamId=${team.id}`, { credentials: 'include' })
      ]);

      let members: any[] = [];
      if (teamResponse.ok) {
        const teamData = await teamResponse.json();
        members = teamData.team?.members || [];
      }

      // Build lookup of metrics by developer_id from the real DB endpoint
      const metricsLookup: Record<string, any> = {};
      if (metricsResponse.ok) {
        const metricsData = await metricsResponse.json();
        (metricsData.developers || []).forEach((metric: any) => {
          if (metric.developer_id) {
            metricsLookup[metric.developer_id] = metric;
          }
        });
      }

      // Map team members to productivity metrics
      const memberDevelopers: DeveloperProductivityMetric[] = members.map((member: any) => {
        const fullName = [member.first_name, member.last_name].filter(Boolean).join(' ').trim() || member.email;
        const metric = metricsLookup[member.id]; // Match by developer_id
        const hasMetrics = !!metric;

        const devMetrics = {
          code_review_time_avg: hasMetrics ? Number(metric.code_review_time_avg) || 0 : 0,
          pr_merge_time_avg: hasMetrics ? Number(metric.pr_merge_time_avg) || 0 : 0,
          context_switches_per_day: hasMetrics ? Number(metric.context_switches_per_day) || 0 : 0,
          focus_time_hours: hasMetrics ? Number(metric.focus_time_hours) || 0 : 0,
          meeting_time_hours: hasMetrics ? Number(metric.meeting_time_hours) || 0 : 0
        };

        return {
          developer_id: member.id,
          name: fullName,
          email: member.email,
          role: member.role,
          has_metrics: hasMetrics,
          team_id: team.id,
          team_name: team.name,
          ...devMetrics,
          ddps_score: hasMetrics ? calculateDDPS(devMetrics).ddps : 0 // Calculated from actual metrics
        };
      });

      return memberDevelopers;
    } catch (error) {
      console.error(`Error fetching developers for team ${team.name}`, error);
      return [];
    }
  };

  useEffect(() => {
    const fetchAllDevelopers = async () => {
      try {
        setLoading(true);
        const teamsResponse = await fetch(`${API_URL}/teams`, { credentials: 'include' });

        if (!teamsResponse.ok) {
          throw new Error('Failed to fetch teams');
        }

        const data = await teamsResponse.json();
        const teamSummaries: TeamSummary[] = (data.teams || []).map((team: any) => ({
          id: team.id,
          name: team.name || 'Unnamed Team'
        }));

        setTeams(teamSummaries);

        if (!teamSummaries.length) {
          setDevelopers([]);
          return;
        }

        const developerResults = await Promise.all(
          teamSummaries.map(team => fetchTeamDevelopers(team))
        );

        setDevelopers(developerResults.flat());
      } catch (error) {
        console.error('Error fetching developer productivity data:', error);
        setDevelopers([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAllDevelopers();
  }, []);

  useEffect(() => {
    setSelectedTeam(teamId || 'all');
  }, [teamId]);

  useEffect(() => {
    setSelectedDeveloperId('all');
  }, [selectedTeam]);

  // Filter developers: only engineers/team_leads with actual DB metrics
  const filteredDevelopers = useMemo(() => {
    let result = developers;

    // Only include engineers and team_leads (exclude managers, admins, viewers)
    result = result.filter(dev =>
      dev.has_metrics &&
      (!dev.role || dev.role === 'engineer' || dev.role === 'qa_engineer' || dev.role === 'team_lead')
    );

    if (selectedTeam !== 'all') {
      result = result.filter(dev => dev.team_id === selectedTeam);
    }
    if (selectedDeveloperId !== 'all') {
      result = result.filter(dev => dev.developer_id === selectedDeveloperId);
    }
    return result;
  }, [developers, selectedTeam, selectedDeveloperId]);

  const developersForDropdown = useMemo(() => {
    const base = selectedTeam === 'all'
      ? developers.filter(dev =>
        dev.has_metrics &&
        (!dev.role || dev.role === 'engineer' || dev.role === 'qa_engineer' || dev.role === 'team_lead')
      )
      : developers.filter(dev =>
        dev.team_id === selectedTeam &&
        dev.has_metrics &&
        (!dev.role || dev.role === 'engineer' || dev.role === 'qa_engineer' || dev.role === 'team_lead')
      );
    const map = new Map<string, DeveloperProductivityMetric>();
    base.forEach(dev => {
      if (!map.has(dev.developer_id)) {
        map.set(dev.developer_id, dev);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [developers, selectedTeam]);

  const developerCount = filteredDevelopers.length;

  // Calculate team averages
  const avgReviewTime = developerCount
    ? filteredDevelopers.reduce((acc, d) => acc + d.code_review_time_avg, 0) / developerCount
    : 0;
  const avgPRTime = developerCount
    ? filteredDevelopers.reduce((acc, d) => acc + d.pr_merge_time_avg, 0) / developerCount
    : 0;
  const avgEfficiency = developerCount
    ? filteredDevelopers.reduce((acc, d) => acc + d.ddps_score, 0) / developerCount
    : 0;
  const avgFocusTime = developerCount
    ? filteredDevelopers.reduce((acc, d) => acc + d.focus_time_hours, 0) / developerCount
    : 0;
  const avgMeetingTime = developerCount
    ? filteredDevelopers.reduce((acc, d) => acc + d.meeting_time_hours, 0) / developerCount
    : 0;

  const formatAvg = (value: number, decimals = 1) => (developerCount ? value.toFixed(decimals) : '--');
  const avgReviewTimeDisplay = formatAvg(avgReviewTime);
  const avgPRTimeDisplay = formatAvg(avgPRTime);
  const avgEfficiencyDisplay = developerCount ? Math.round(avgEfficiency * 100).toString() : '--'; // Convert 0-1 to 0-100
  const avgFocusTimeDisplay = formatAvg(avgFocusTime);
  const avgMeetingTimeDisplay = formatAvg(avgMeetingTime);

  // Sort developers
  const sortedDevelopers = [...filteredDevelopers].sort((a, b) => {
    if (sortBy === 'efficiency') return b.ddps_score - a.ddps_score;
    if (sortBy === 'pr_time') return a.pr_merge_time_avg - b.pr_merge_time_avg;
    return a.code_review_time_avg - b.code_review_time_avg;
  });

  // Prepare data for team overview chart
  const teamOverviewData = filteredDevelopers.map(d => ({
    name: d.name.split(' ')[0],
    efficiency: d.ddps_score,
    focusTime: d.focus_time_hours,
    prTime: d.pr_merge_time_avg / 10, // Scale down for visibility
    reviewTime: d.code_review_time_avg / 10
  }));

  // Prepare radar chart data for team balance - FIXED: multiply avgEfficiency by 100 for 0-100 scale
  const teamBalanceData = [
    { metric: 'Efficiency', value: Math.round(avgEfficiency * 100), fullMark: 100 },
    { metric: 'Focus Time', value: Math.min(avgFocusTime * 12.5, 100), fullMark: 100 },
    { metric: 'PR Speed', value: Math.max(0, 100 - (avgPRTime / 2)), fullMark: 100 },
    { metric: 'Review Speed', value: Math.max(0, 100 - (avgReviewTime / 2)), fullMark: 100 },
    { metric: 'Work-Life', value: Math.max(0, (8 - avgMeetingTime) * 12.5), fullMark: 100 }
  ];

  // Additional derived metrics
  const avgContextSwitches = developerCount
    ? filteredDevelopers.reduce((acc, d) => acc + d.context_switches_per_day, 0) / developerCount
    : 0;

  // Collaboration Score: Based on code review responsiveness and PR turnaround
  const collaborationScore = developerCount
    ? Math.max(0, Math.min(100, 100 - (avgReviewTime * 2) - (avgPRTime * 0.5)))
    : 0;

  // Burnout Risk Index: High meetings + high context switches + low focus = higher risk
  const burnoutRiskScore = developerCount
    ? Math.min(100, (avgMeetingTime * 10) + (avgContextSwitches * 8) + ((8 - avgFocusTime) * 5))
    : 0;
  const burnoutRiskLevel = burnoutRiskScore < 30 ? 'Low' : burnoutRiskScore < 60 ? 'Moderate' : 'High';
  const burnoutRiskColor = burnoutRiskScore < 30 ? 'text-green-600' : burnoutRiskScore < 60 ? 'text-yellow-600' : 'text-red-600';

  // Deep Work Ratio: Focus time as percentage of available work time (8h - meetings)
  const deepWorkRatio = developerCount && (8 - avgMeetingTime) > 0
    ? (avgFocusTime / (8 - avgMeetingTime)) * 100
    : 0;

  // Velocity Index: Combination of PR speed and review speed
  const velocityIndex = developerCount
    ? Math.max(0, 100 - (avgPRTime + avgReviewTime) * 2)
    : 0;

  // Fetch AI insights when team changes
  useEffect(() => {
    const fetchAiInsights = async () => {
      if (selectedTeam === 'all' || !selectedTeam) {
        setAiInsights(null);
        setTeamAiEnabled(false);
        return;
      }

      setAiLoading(true);
      try {
        const response = await fetch(`${API_URL}/teams/${selectedTeam}/developer-ai-suggestions`, {
          credentials: 'include'
        });

        if (response.ok) {
          const data = await response.json();
          setAiInsights(data);
          setTeamAiEnabled(data.aiEnabled ?? false);
        } else {
          setAiInsights(null);
          setTeamAiEnabled(false);
        }
      } catch (error) {
        console.error('Error fetching AI insights:', error);
        setAiInsights(null);
        setTeamAiEnabled(false);
      } finally {
        setAiLoading(false);
      }
    };

    fetchAiInsights();
  }, [selectedTeam]);

  // Historical trend data (mock)
  const trendData = Array.from({ length: 12 }, (_, i) => ({
    month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i],
    happiness: 7 + Math.random() * 2,
    focusTime: 5 + Math.random() * 2,
    prTime: 20 + Math.random() * 10
  }));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b dark:border-slate-800 sticky top-0 z-10">
        <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <button
            onClick={onBack}
            className="flex items-center space-x-2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white mb-4 transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="font-medium">Back to Features</span>
          </button>

          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white flex items-center">
                <Code className="mr-2 sm:mr-3 text-purple-500" size={24} />
                Developer Productivity Metrics
              </h1>
              <p className="text-gray-500 mt-1 dark:text-slate-400 text-sm sm:text-base">Track team efficiency, happiness, and work-life balance</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
              <div className="text-center bg-gray-50 dark:bg-slate-800 rounded-lg p-2 sm:p-3">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Avg DDPS</p>
                <div className="text-lg sm:text-xl lg:text-3xl font-bold text-purple-600 dark:text-purple-400">{avgEfficiencyDisplay}/100</div>
              </div>
              <div className="text-center bg-gray-50 dark:bg-slate-800 rounded-lg p-2 sm:p-3">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Avg PR Time</p>
                <div className="text-lg sm:text-xl lg:text-3xl font-bold text-blue-600 dark:text-blue-400">{avgPRTimeDisplay}h</div>
              </div>
              <div className="text-center bg-gray-50 dark:bg-slate-800 rounded-lg p-2 sm:p-3">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Avg Review</p>
                <div className="text-lg sm:text-xl lg:text-3xl font-bold text-green-600 dark:text-green-400">{avgReviewTimeDisplay}h</div>
              </div>
              <div className="text-center bg-gray-50 dark:bg-slate-800 rounded-lg p-2 sm:p-3">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Focus Time</p>
                <div className="text-lg sm:text-xl lg:text-3xl font-bold text-orange-600 dark:text-orange-400">{avgFocusTimeDisplay}h/day</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sort Controls */}
      <div className="px-4 sm:px-6 lg:px-8 py-4 bg-white dark:bg-slate-900 border-b dark:border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">Sort by:</span>
            <button
              onClick={() => setSortBy('efficiency')}
              className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${sortBy === 'efficiency'
                ? 'bg-purple-600 text-white shadow-md'
                : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
                }`}
            >
              ⚡ Efficiency
            </button>
            <button
              onClick={() => setSortBy('pr_time')}
              className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${sortBy === 'pr_time'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
                }`}
            >
              ⚡ PR Time
            </button>
            <button
              onClick={() => setSortBy('review_time')}
              className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${sortBy === 'review_time'
                ? 'bg-green-600 text-white shadow-md'
                : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
                }`}
            >
              👀 Review
            </button>
          </div>

          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 px-4 py-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <Gauge className="text-green-500" size={20} />
              <span className="text-sm font-medium text-green-700 dark:text-green-400">Team Health: Good</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 sm:px-6 lg:px-8 py-4 bg-white dark:bg-slate-900 border-b dark:border-slate-800">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Developer</label>
            <select
              value={selectedDeveloperId}
              onChange={(e) => setSelectedDeveloperId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 dark:focus:ring-purple-400"
            >
              <option value="all">All Developers{selectedTeam !== 'all' ? ' in Team' : ''}</option>
              {developersForDropdown.map(dev => (
                <option key={dev.developer_id} value={dev.developer_id}>{dev.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col justify-center bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 px-4 py-3 text-sm text-gray-600 dark:text-slate-300">
            <span className="font-semibold text-gray-900 dark:text-white">Showing</span>
            <span>{developerCount} developer{developerCount === 1 ? '' : 's'}{selectedTeam !== 'all' && ` • ${teams.find(t => t.id === selectedTeam)?.name || 'Team'}`}</span>
          </div>
        </div>
      </div>

      {/* Key Insights */}
      <div className="px-4 sm:px-6 lg:px-8 py-6 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-slate-800 dark:to-slate-800 border-b dark:border-slate-700">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          <InsightCard
            icon={<Gauge className="text-purple-500" size={24} />}
            title={avgEfficiency >= 0.6 ? "High Team DDPS" : avgEfficiency >= 0.4 ? "Moderate Team DDPS" : "Team DDPS Needs Attention"}
            description={avgEfficiency >= 0.6
              ? `Average DDPS of ${avgEfficiencyDisplay}/100 indicates strong team productivity`
              : avgEfficiency >= 0.4
                ? `Average DDPS of ${avgEfficiencyDisplay}/100 - room for improvement`
                : `Average DDPS of ${avgEfficiencyDisplay}/100 - action needed to improve productivity`
            }
            status={avgEfficiency >= 0.6 ? "positive" : avgEfficiency >= 0.4 ? "warning" : "negative"}
          />
          <InsightCard
            icon={<Zap className="text-blue-500" size={24} />}
            title={avgPRTime < 24 ? "Efficient PR Process" : avgPRTime < 48 ? "Moderate PR Time" : "Slow PR Process"}
            description={avgPRTime < 24
              ? `${avgPRTimeDisplay}h average PR merge time is within industry best practices`
              : avgPRTime < 48
                ? `${avgPRTimeDisplay}h average PR merge time - could be improved`
                : `${avgPRTimeDisplay}h average PR merge time is too slow - review process needs attention`
            }
            status={avgPRTime < 24 ? "positive" : avgPRTime < 48 ? "warning" : "negative"}
          />
          <InsightCard
            icon={<Coffee className="text-orange-500" size={24} />}
            title={avgFocusTime >= 4 ? "Good Focus Time" : avgFocusTime >= 2 ? "Moderate Focus Time" : "Low Focus Time"}
            description={avgFocusTime >= 4
              ? `${avgFocusTimeDisplay}h daily focus time allows for deep work and productivity`
              : avgFocusTime >= 2
                ? `${avgFocusTimeDisplay}h daily focus time - more uninterrupted time needed`
                : `${avgFocusTimeDisplay}h daily focus time is too low - reduce interruptions`
            }
            status={avgFocusTime >= 4 ? "positive" : avgFocusTime >= 2 ? "warning" : "negative"}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* DDPS Formula Explanation */}
        <details open className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 sm:p-6 mb-8 group">
          <summary className="flex items-center justify-between cursor-pointer list-none">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white flex items-center">
              <Gauge className="mr-2 text-purple-500" size={24} />
              DDPS Score Formula & Calculation
            </h2>
            <span className="text-gray-500 dark:text-gray-400 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <div className="mt-4 space-y-4">
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
              The <strong>Daily Developer Productivity Score (DDPS)</strong> measures developer efficiency using absolute thresholds
              rather than ratios, ensuring meaningful differentiation between productivity levels.
            </p>

            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 sm:p-4 border border-purple-200 dark:border-purple-700">
              <h3 className="font-semibold text-purple-900 dark:text-purple-100 mb-2 text-sm sm:text-base">📐 Formula</h3>
              <code className="text-xs sm:text-sm text-purple-800 dark:text-purple-200 block break-words">
                DDPS = Focus Score + Meeting Penalty + Context Penalty + PR Bonus + Review Bonus + Balance Bonus
              </code>
              <p className="text-xs text-purple-600 dark:text-purple-400 mt-2">Range: 0-100 points (displayed as percentage)</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-100 dark:bg-slate-800">
                    <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-300 border-b dark:border-slate-700">Component</th>
                    <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-300 border-b dark:border-slate-700">Range</th>
                    <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-300 border-b dark:border-slate-700">Calculation</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600 dark:text-gray-400">
                  <tr className="border-b dark:border-slate-700">
                    <td className="p-3 font-medium text-green-700 dark:text-green-400">🎯 Focus Time</td>
                    <td className="p-3">0 to +50 pts</td>
                    <td className="p-3">5h+ = 50, 4h = 40, 3h = 30, 2h = 20, 1h = 10</td>
                  </tr>
                  <tr className="border-b dark:border-slate-700">
                    <td className="p-3 font-medium text-red-700 dark:text-red-400">📅 Meeting Penalty</td>
                    <td className="p-3">-10 to 0 pts</td>
                    <td className="p-3">0-1h = 0, 2h = -3, 3h = -6, 4h+ = -10</td>
                  </tr>
                  <tr className="border-b dark:border-slate-700">
                    <td className="p-3 font-medium text-orange-700 dark:text-orange-400">⚡ Context Switch Penalty</td>
                    <td className="p-3">-15 to 0 pts</td>
                    <td className="p-3">0-2/day = 0, 3-4 = -5, 5-6 = -10, 7+ = -15</td>
                  </tr>
                  <tr className="border-b dark:border-slate-700">
                    <td className="p-3 font-medium text-blue-700 dark:text-blue-400">🔀 PR Merge Speed</td>
                    <td className="p-3">-10 to +10 pts</td>
                    <td className="p-3">&lt;4h = +10, 4-8h = +5, 8-24h = 0, 24-48h = -5, 48h+ = -10</td>
                  </tr>
                  <tr className="border-b dark:border-slate-700">
                    <td className="p-3 font-medium text-indigo-700 dark:text-indigo-400">👀 Review Speed</td>
                    <td className="p-3">-5 to +5 pts</td>
                    <td className="p-3">&lt;2h = +5, 2-4h = +2, 4-8h = 0, 8h+ = -5</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium text-purple-700 dark:text-purple-400">⚖️ Work-Life Balance</td>
                    <td className="p-3">0 to +10 pts</td>
                    <td className="p-3">≤8h = +10, 9h = +7.5, 10h = +5, 11h = +2.5, 12h+ = 0 (−25%/overtime hour)</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mt-4">
              <div className="bg-green-50 dark:bg-green-900/20 rounded p-3 text-center">
                <div className="text-2xl font-bold text-green-600">80-100</div>
                <div className="text-xs text-green-700 dark:text-green-400">🚀 Exceptional</div>
              </div>
              <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded p-3 text-center">
                <div className="text-2xl font-bold text-yellow-600">60-79</div>
                <div className="text-xs text-yellow-700 dark:text-yellow-400">⚡ High</div>
              </div>
              <div className="bg-orange-50 dark:bg-orange-900/20 rounded p-3 text-center">
                <div className="text-2xl font-bold text-orange-600">40-59</div>
                <div className="text-xs text-orange-700 dark:text-orange-400">✅ Healthy</div>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded p-3 text-center">
                <div className="text-2xl font-bold text-red-600">0-39</div>
                <div className="text-xs text-red-700 dark:text-red-400">⚠️ Needs Work</div>
              </div>
            </div>
          </div>
        </details>

        {/* Team Balance Radar */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 mb-8">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 sm:p-6">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-4">Team Balance Overview</h2>
            <div className="h-64 sm:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={teamBalanceData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="metric" />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} />
                  <Radar name="Team Score" dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.6} />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-400 mt-4 text-center">
              Balanced teams perform better. All metrics should be above 70 for optimal productivity.
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 sm:p-6">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-4">Team Comparison</h2>
            <div className="h-64 sm:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamOverviewData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1f2937', color: '#fff', borderRadius: '8px' }}
                  />
                  <Legend />
                  <Bar dataKey="happiness" fill="#8b5cf6" name="Happiness" />
                  <Bar dataKey="focusTime" fill="#3b82f6" name="Focus Time" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Historical Trends */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 sm:p-6 mb-8">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-4">12-Month Trends</h2>
          <div className="h-64 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis yAxisId="left" label={{ value: 'Score / Hours', angle: -90, position: 'insideLeft' }} />
                <YAxis yAxisId="right" orientation="right" label={{ value: 'PR Time (hours)', angle: 90, position: 'insideRight' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', color: '#fff', borderRadius: '8px' }}
                />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="happiness" stroke="#8b5cf6" strokeWidth={3} name="Happiness Score" />
                <Line yAxisId="left" type="monotone" dataKey="focusTime" stroke="#10b981" strokeWidth={3} name="Focus Time (h)" />
                <Line yAxisId="right" type="monotone" dataKey="prTime" stroke="#3b82f6" strokeWidth={3} name="PR Merge Time (h)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Derived Productivity Metrics */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 sm:p-6 mb-8">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <Target className="mr-2 text-indigo-500" size={24} />
            Derived Productivity Metrics
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {/* Collaboration Score */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-5 border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-between mb-3">
                <Users className="text-blue-600" size={24} />
                <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-200 rounded-full">Teamwork</span>
              </div>
              <div className="text-3xl font-bold text-blue-900 dark:text-blue-100">{Math.round(collaborationScore)}</div>
              <div className="text-sm text-blue-700 dark:text-blue-300 font-medium">Collaboration Score</div>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
                {collaborationScore >= 70 ? '✅ Excellent team collaboration' :
                  collaborationScore >= 50 ? '⚠️ Good but could improve' :
                    '❌ Review and PR processes need attention'}
              </p>
            </div>

            {/* Burnout Risk */}
            <div className={`bg-gradient-to-br ${burnoutRiskScore < 30 ? 'from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-200 dark:border-green-800' : burnoutRiskScore < 60 ? 'from-yellow-50 to-amber-50 dark:from-yellow-900/20 dark:to-amber-900/20 border-yellow-200 dark:border-yellow-800' : 'from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/20 border-red-200 dark:border-red-800'} rounded-xl p-5 border`}>
              <div className="flex items-center justify-between mb-3">
                <Battery className={burnoutRiskColor} size={24} />
                <span className={`text-xs px-2 py-1 rounded-full ${burnoutRiskScore < 30 ? 'bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-200' : burnoutRiskScore < 60 ? 'bg-yellow-100 dark:bg-yellow-800 text-yellow-700 dark:text-yellow-200' : 'bg-red-100 dark:bg-red-800 text-red-700 dark:text-red-200'}`}>{burnoutRiskLevel}</span>
              </div>
              <div className={`text-3xl font-bold ${burnoutRiskColor}`}>{Math.round(burnoutRiskScore)}%</div>
              <div className={`text-sm font-medium ${burnoutRiskColor}`}>Burnout Risk Index</div>
              <p className={`text-xs mt-2 ${burnoutRiskScore < 30 ? 'text-green-600 dark:text-green-400' : burnoutRiskScore < 60 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
                {burnoutRiskScore < 30 ? '✅ Team has healthy workload balance' :
                  burnoutRiskScore < 60 ? '⚠️ Monitor meeting load & context switches' :
                    '🚨 High risk - reduce meetings & interruptions'}
              </p>
            </div>

            {/* Deep Work Ratio */}
            <div className="bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20 rounded-xl p-5 border border-purple-200 dark:border-purple-800">
              <div className="flex items-center justify-between mb-3">
                <Brain className="text-purple-600" size={24} />
                <span className="text-xs px-2 py-1 bg-purple-100 dark:bg-purple-800 text-purple-700 dark:text-purple-200 rounded-full">Focus</span>
              </div>
              <div className="text-3xl font-bold text-purple-900 dark:text-purple-100">{Math.round(deepWorkRatio)}%</div>
              <div className="text-sm text-purple-700 dark:text-purple-300 font-medium">Deep Work Ratio</div>
              <p className="text-xs text-purple-600 dark:text-purple-400 mt-2">
                {deepWorkRatio >= 70 ? '✅ Excellent focus time utilization' :
                  deepWorkRatio >= 50 ? '⚠️ Reasonable but can be optimized' :
                    '❌ Too much fragmented time'}
              </p>
            </div>

            {/* Velocity Index */}
            <div className="bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 rounded-xl p-5 border border-orange-200 dark:border-orange-800">
              <div className="flex items-center justify-between mb-3">
                <Zap className="text-orange-600" size={24} />
                <span className="text-xs px-2 py-1 bg-orange-100 dark:bg-orange-800 text-orange-700 dark:text-orange-200 rounded-full">Speed</span>
              </div>
              <div className="text-3xl font-bold text-orange-900 dark:text-orange-100">{Math.round(velocityIndex)}</div>
              <div className="text-sm text-orange-700 dark:text-orange-300 font-medium">Velocity Index</div>
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                {velocityIndex >= 70 ? '✅ Fast code review & PR cycle' :
                  velocityIndex >= 50 ? '⚠️ Moderate pace - optimize workflows' :
                    '❌ Slow cycle times affecting delivery'}
              </p>
            </div>
          </div>
        </div>

        {/* AI-Powered Insights Section */}
        {selectedTeam !== 'all' && (
          <div className="bg-gradient-to-r from-indigo-50 via-purple-50 to-pink-50 dark:from-indigo-900/20 dark:via-purple-900/20 dark:to-pink-900/20 rounded-xl shadow-sm border border-indigo-200 dark:border-indigo-800 p-4 sm:p-6 mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
              <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white flex items-center">
                <Sparkles className="mr-2 text-indigo-500" size={24} />
                AI-Powered Team Insights
              </h2>
              {!teamAiEnabled && (
                <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center">
                  <AlertCircle size={16} className="mr-1" />
                  AI insights disabled for this team
                </span>
              )}
            </div>
            {/* Powered by indicator */}
            <p className="text-sm text-indigo-600 dark:text-indigo-400 mb-4">
              Powered by: {aiLoading ? '...' : !teamAiEnabled ? 'Disabled' : aiInsights?.source === 'groq' ? '🤖 AI' : '📊 Rule-based'}
            </p>

            {aiLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="animate-spin text-indigo-500 mr-2" size={24} />
                <span className="text-gray-600 dark:text-gray-400">Loading AI insights...</span>
              </div>
            ) : !teamAiEnabled ? (
              <div className="bg-white/60 dark:bg-slate-800/60 rounded-lg p-6 text-center">
                <Brain className="mx-auto text-gray-400 mb-3" size={48} />
                <p className="text-gray-600 dark:text-gray-400 mb-2">AI insights are not enabled for this team.</p>
                <p className="text-sm text-gray-500 dark:text-gray-500">Enable AI in Admin Panel → Teams to get personalized developer insights.</p>
              </div>
            ) : aiInsights?.developers && aiInsights.developers.length > 0 ? (
              <div className="space-y-4">
                {aiInsights.teamInsight && (
                  <div className="bg-white/80 dark:bg-slate-800/80 rounded-lg p-4 border border-indigo-100 dark:border-indigo-700">
                    <p className="text-indigo-900 dark:text-indigo-100 font-medium">
                      💡 {aiInsights.teamInsight}
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {aiInsights.developers.map((dev, idx) => (
                    <div key={idx} className={`bg-white/80 dark:bg-slate-800/80 rounded-lg p-4 border ${dev.status === 'healthy' ? 'border-green-200 dark:border-green-700' :
                      dev.status === 'at-risk' ? 'border-red-200 dark:border-red-700' :
                        'border-yellow-200 dark:border-yellow-700'
                      }`}>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-gray-900 dark:text-white">{dev.name}</h4>
                        <span className={`text-xs px-2 py-1 rounded-full ${dev.status === 'healthy' ? 'bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-200' :
                          dev.status === 'at-risk' ? 'bg-red-100 dark:bg-red-800 text-red-700 dark:text-red-200' :
                            'bg-yellow-100 dark:bg-yellow-800 text-yellow-700 dark:text-yellow-200'
                          }`}>
                          {dev.status === 'healthy' ? '✅ Healthy' : dev.status === 'at-risk' ? '🚨 At Risk' : '⚠️ Attention'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{dev.summary}</p>
                      {dev.strengths && dev.strengths.length > 0 && (
                        <div className="mb-2">
                          <span className="text-xs font-medium text-green-700 dark:text-green-400">Strengths:</span>
                          <ul className="text-xs text-gray-600 dark:text-gray-400 ml-2">
                            {dev.strengths.slice(0, 2).map((s, i) => <li key={i}>• {s}</li>)}
                          </ul>
                        </div>
                      )}
                      {dev.concerns && dev.concerns.length > 0 && (
                        <div className="mb-2">
                          <span className="text-xs font-medium text-orange-700 dark:text-orange-400">Concerns:</span>
                          <ul className="text-xs text-gray-600 dark:text-gray-400 ml-2">
                            {dev.concerns.slice(0, 2).map((c, i) => <li key={i}>• {c}</li>)}
                          </ul>
                        </div>
                      )}
                      {dev.suggestion && (
                        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                          <span className="text-xs font-medium text-indigo-700 dark:text-indigo-400">💡 Suggestion:</span>
                          <p className="text-xs text-gray-700 dark:text-gray-300">{dev.suggestion}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white/60 dark:bg-slate-800/60 rounded-lg p-6 text-center">
                <p className="text-gray-600 dark:text-gray-400">
                  {aiInsights?.message || 'No developer insights available yet.'}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Developer Cards */}
        <div className="space-y-4">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">Individual Developer Metrics</h2>
          {(() => {
            // Filter to only show engineers/team_leads with actual metrics
            const engineersWithMetrics = sortedDevelopers.filter(dev =>
              dev.has_metrics &&
              (!dev.role || dev.role === 'engineer' || dev.role === 'qa_engineer' || dev.role === 'team_lead')
            );

            if (engineersWithMetrics.length === 0) {
              return (
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-8 text-center">
                  <p className="text-gray-500 dark:text-slate-400">No metrics available for engineers in this selection.</p>
                </div>
              );
            }

            return engineersWithMetrics.map(dev => (
              <DeveloperCard
                key={dev.developer_id}
                developer={dev}
                isSelected={expandedDeveloper === dev.developer_id}
                onSelect={() => setExpandedDeveloper(expandedDeveloper === dev.developer_id ? null : dev.developer_id)}
              />
            ));
          })()}
        </div>
      </div>
    </div>
  );
};

interface InsightCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: 'positive' | 'warning' | 'negative';
}

const InsightCard: React.FC<InsightCardProps> = ({ icon, title, description, status }) => {
  const statusColors = {
    positive: 'bg-green-100 dark:bg-green-900/20 border-green-200 dark:border-green-700',
    warning: 'bg-yellow-100 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700',
    negative: 'bg-red-100 dark:bg-red-900/20 border-red-200 dark:border-red-700'
  };

  return (
    <div className={`bg-white dark:bg-slate-900 rounded-lg p-4 border ${statusColors[status]}`}>
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0">{icon}</div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-1">{title}</h3>
          <p className="text-sm text-gray-600 dark:text-slate-400">{description}</p>
        </div>
      </div>
    </div>
  );
};

interface DeveloperCardProps {
  developer: DeveloperProductivityMetric;
  isSelected: boolean;
  onSelect: () => void;
}

const DeveloperCard: React.FC<DeveloperCardProps> = ({ developer, isSelected, onSelect }) => {
  // Calculate DDPS with overtime info
  const ddpsData = calculateDDPS({
    pr_merge_time_avg: developer.pr_merge_time_avg,
    code_review_time_avg: developer.code_review_time_avg,
    focus_time_hours: developer.focus_time_hours,
    meeting_time_hours: developer.meeting_time_hours,
    context_switches_per_day: developer.context_switches_per_day
  });

  // Convert DDPS (0-1) to percentage (0-100) for display
  const ddpsPercent = Math.round(ddpsData.ddps * 100);

  const getEfficiencyColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    if (score >= 40) return 'text-orange-600';
    return 'text-red-600';
  };

  const getEfficiencyEmoji = (score: number) => {
    if (score >= 80) return '🚀';
    if (score >= 60) return '⚡';
    if (score >= 40) return '✅';
    if (score >= 20) return '⚠️';
    return '🔧';
  };

  const workLifeBalance = ((developer.focus_time_hours / (developer.focus_time_hours + developer.meeting_time_hours)) * 100).toFixed(0);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center space-x-3 sm:space-x-4">
            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-lg sm:text-2xl font-bold flex-shrink-0">
              {developer.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">{developer.name}</h3>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400 truncate">ID: {developer.developer_id}</p>
            </div>
          </div>

          <div className="text-left sm:text-right flex-shrink-0">
            <div className={`text-2xl sm:text-4xl font-bold ${getEfficiencyColor(ddpsPercent)}`}>
              {getEfficiencyEmoji(ddpsPercent)} {ddpsPercent}/100
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400">DDPS Score</div>
            {/* Overtime Warning */}
            {ddpsData.isOvertime && (
              <div className="mt-2 flex items-center sm:justify-end">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-700">
                  ⚠️ ~{ddpsData.totalWorkHours}h/day (+{ddpsData.overtimeHours}h overtime)
                </span>
              </div>
            )}
            {/* Healthy work hours indicator */}
            {!ddpsData.isOvertime && ddpsData.totalWorkHours >= 6 && (
              <div className="mt-2 flex items-center sm:justify-end">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">
                  ✅ ~{ddpsData.totalWorkHours}h/day
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-4 mb-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
            <div className="flex items-center text-blue-600 mb-1">
              <GitPullRequest size={14} className="mr-1" />
              <span className="text-xs font-semibold">PR Time</span>
            </div>
            <div className="text-lg font-bold text-blue-900 dark:text-blue-200">{developer.pr_merge_time_avg.toFixed(1)}h</div>
          </div>

          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
            <div className="flex items-center text-green-600 mb-1">
              <Code size={14} className="mr-1" />
              <span className="text-xs font-semibold">Review Time</span>
            </div>
            <div className="text-lg font-bold text-green-900 dark:text-green-200">{developer.code_review_time_avg.toFixed(1)}h</div>
          </div>

          <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
            <div className="flex items-center text-orange-600 dark:text-orange-400 mb-1">
              <Coffee size={14} className="mr-1" />
              <span className="text-xs font-semibold">Focus Time</span>
            </div>
            <div className="text-lg font-bold text-orange-900 dark:text-orange-200">{developer.focus_time_hours.toFixed(1)}h</div>
          </div>

          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
            <div className="flex items-center text-purple-600 dark:text-purple-400 mb-1">
              <Calendar size={14} className="mr-1" />
              <span className="text-xs font-semibold">Meetings</span>
            </div>
            <div className="text-lg font-bold text-purple-900 dark:text-purple-200">{developer.meeting_time_hours.toFixed(1)}h</div>
          </div>

          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
            <div className="flex items-center text-red-600 mb-1">
              <Zap size={14} className="mr-1" />
              <span className="text-xs font-semibold">Context Sw.</span>
            </div>
            <div className="text-lg font-bold text-red-900 dark:text-red-200">{developer.context_switches_per_day}</div>
          </div>
        </div>

        {/* Work-Life Balance Bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-700 dark:text-slate-300 dark:text-slate-300">Work-Life Balance</span>
            <span className="text-sm font-bold text-gray-900 dark:text-white">{workLifeBalance}% Focus Time</span>
          </div>
          <div className="w-full h-3 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-blue-500"
              style={{ width: `${workLifeBalance}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1 dark:text-slate-400">
            <span>Focus: {developer.focus_time_hours}h</span>
            <span>Meetings: {developer.meeting_time_hours}h</span>
          </div>
        </div>

        <button
          onClick={onSelect}
          className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
        >
          {isSelected ? '▼ Hide Insights' : '▶ Show Detailed Insights'}
        </button>

        {isSelected && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700 space-y-4">
            {/* Productivity Analysis */}
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3 flex items-center">
                <TrendingUp size={16} className="mr-2" />
                Productivity Analysis
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-blue-800 dark:text-blue-200">
                <div>
                  <p className="font-medium mb-1">PR Efficiency:</p>
                  <p>
                    {developer.pr_merge_time_avg < 24 ? '✅ Excellent - Fast turnaround' :
                      developer.pr_merge_time_avg < 48 ? '⚠️ Good - Room for improvement' :
                        '❌ Slow - Review process bottleneck'}
                  </p>
                </div>
                <div>
                  <p className="font-medium mb-1">Review Speed:</p>
                  <p>
                    {developer.code_review_time_avg < 4 ? '✅ Fast - Responsive reviewer' :
                      developer.code_review_time_avg < 8 ? '⚠️ Moderate - Acceptable pace' :
                        '❌ Slow - May block team progress'}
                  </p>
                </div>
                <div>
                  <p className="font-medium mb-1">Focus Quality:</p>
                  <p>
                    {developer.focus_time_hours > 5 ? '✅ High - Deep work enabled' :
                      developer.focus_time_hours > 3 ? '⚠️ Moderate - Could improve' :
                        '❌ Low - Too many interruptions'}
                  </p>
                </div>
                <div>
                  <p className="font-medium mb-1">Context Switching:</p>
                  <p>
                    {developer.context_switches_per_day < 5 ? '✅ Low - Good focus' :
                      developer.context_switches_per_day < 10 ? '⚠️ Moderate - Manageable' :
                        '❌ High - Productivity impact'}
                  </p>
                </div>
              </div>
            </div>

            {/* Recommendations */}
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-green-900 dark:text-green-100 mb-3">💡 Personalized Recommendations</h4>
              <ul className="text-sm text-green-800 dark:text-green-200 space-y-2">
                {developer.ddps_score < 0.4 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Review workflow and identify efficiency bottlenecks</span>
                  </li>
                )}
                {developer.pr_merge_time_avg > 36 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Streamline PR review process - consider smaller, more frequent PRs</span>
                  </li>
                )}
                {developer.focus_time_hours < 4 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Block calendar for focus time - aim for 4+ hours of uninterrupted work</span>
                  </li>
                )}
                {developer.context_switches_per_day > 8 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Reduce context switching - batch similar tasks and limit interruptions</span>
                  </li>
                )}
                {developer.meeting_time_hours > 4 && (
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Optimize meeting schedule - decline non-essential meetings</span>
                  </li>
                )}
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Maintain efficiency through regular process improvements</span>
                </li>
              </ul>
            </div>

            {/* Wellness Check */}
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-purple-900 dark:text-purple-100 mb-3 flex items-center">
                <AlertCircle size={16} className="mr-2" />
                Wellness & Balance Check
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-purple-700 dark:text-purple-300 mb-1">Work-Life Balance:</p>
                  <p className="text-lg font-bold text-purple-900 dark:text-purple-200">
                    {parseInt(workLifeBalance) > 70 ? '✅ Healthy' : parseInt(workLifeBalance) > 50 ? '⚠️ Fair' : '❌ Concerning'}
                  </p>
                  <p className="text-xs text-purple-600 dark:text-purple-400">{workLifeBalance}% productive time</p>
                </div>
                <div>
                  <p className="text-xs text-purple-700 dark:text-purple-300 mb-1">Burnout Risk:</p>
                  <p className="text-lg font-bold text-purple-900 dark:text-purple-200">
                    {developer.ddps_score > 0.5 && developer.focus_time_hours > 4 ? '✅ Low' :
                      developer.ddps_score > 0.3 ? '⚠️ Moderate' : '❌ High'}
                  </p>
                  <p className="text-xs text-purple-600 dark:text-purple-400">Based on DDPS & workload</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeveloperProductivity;
