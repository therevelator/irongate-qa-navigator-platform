import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  TrendingUp, TrendingDown, Shield, AlertTriangle, CheckCircle2, 
  Activity, Bug, Zap, Bot
} from 'lucide-react';
import API_URL from '../config/api';
import { useTheme } from '../contexts/ThemeContext';
import HeroBattery from './HeroBattery';

// Typing animation messages
const messages = [
  'CI/CD: because manually deploying is how horror stories begin.',
  'Ship with confidence, not with crossed fingers.',
  'Turning chaos into predictable, measurable reliability.',
  'Driving software performance with uncompromising quality discipline.',
  'Quality without exception. Reliability without compromise.',
  'Operational certainty through engineered, repeatable precision.',
  'Because mission-critical software requires non-optional excellence.',
  'Delivering confidence at scale through disciplined engineering practices.',
  'From scattered technical signals to clear, measurable business outcomes.',
  'From disconnected logs and metrics to unified, revenue-aligned intelligence.',
  'Turning random metrics into insights you can actually explain in meetings.',
  'Transforming uncertainty into confidence—one defect at a time'
];

interface CompanySummary {
  // Core metrics from kpi_snapshots (all real DB data)
  globalQaScore: number;           // AVG(qa_score) across all teams
  globalQaScoreTrend: number;      // Change vs 7 days ago
  riskLevel: 'stable' | 'watch' | 'at-risk' | 'unknown';
  avgTestCoverage: number;         // AVG(test_coverage) across all teams
  avgDefectEscapeRate: number;     // AVG(defect_escape_rate) across all teams
  automationCoverage: number;      // AVG(automation_coverage) across all teams
  avgFlakinessRate: number;        // AVG(test_flakiness_rate) across all teams
  
  // Team rankings
  topImproving: Array<{ name: string; score: number }>;
  needsAttention: Array<{ name: string; score: number; issue: string }>;
  
  // KPI status
  kpiStatus: { onTrack: number; atRisk: number; offTrack: number };
  
  // Generated
  aiSummary: string;
  teamCount: number;
  teamsWithKpiData: number;
}

const CompanyHeroSection: React.FC = () => {
  const { isDark } = useTheme();
  const [summary, setSummary] = useState<CompanySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Typing animation state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const [slideOut, setSlideOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const TYPE_SPEED = 50;
  const PAUSE_AFTER_COMPLETE = 30 * 60 * 1000; // 30 minutes

  // Typing animation effect
  useEffect(() => {
    if (isTyping) {
      const timer = setTimeout(() => {
        const nextChar = messages[currentIndex][displayedText.length];
        setDisplayedText(prev => prev + nextChar);
        if (displayedText.length + 1 === messages[currentIndex].length) {
          setIsTyping(false);
        }
      }, TYPE_SPEED);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => {
        setSlideOut(true);
      }, PAUSE_AFTER_COMPLETE);
      return () => clearTimeout(timer);
    }
  }, [displayedText, isTyping, currentIndex]);

  // Reset after slide-out
  useEffect(() => {
    if (slideOut) {
      const timer = setTimeout(() => {
        setCurrentIndex(prev => (prev + 1) % messages.length);
        setDisplayedText('');
        setIsTyping(true);
        setSlideOut(false);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [slideOut]);

  const fetchSummary = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/analytics/company-summary`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setSummary(data);
        setError(null);
      } else {
        setError('Failed to load company summary');
      }
    } catch (err) {
      console.error('Error fetching company summary:', err);
      setError('Failed to load company summary');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getRiskBadge = (level: string) => {
    switch (level) {
      case 'stable':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle2 size={12} /> Stable
          </span>
        );
      case 'watch':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            <AlertTriangle size={12} /> Watch
          </span>
        );
      case 'at-risk':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
            <AlertTriangle size={12} /> At Risk
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            Unknown
          </span>
        );
    }
  };

  // Mini sparkline component
  const Sparkline: React.FC<{ data: number[]; color?: string }> = ({ data, color = '#10b981' }) => {
    if (!data || data.length === 0) return null;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const width = 80;
    const height = 24;
    const points = data.map((val, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * height;
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg width={width} height={height} className="inline-block">
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  if (loading) {
    return (
      <div className="px-4 sm:px-6 py-4">
        <div className="animate-pulse bg-gray-200 dark:bg-slate-800 rounded-xl h-48" />
      </div>
    );
  }

  if (error || !summary) {
    return null; // Silently fail - hero is optional
  }

  return (
    <div className="px-4 sm:px-6 py-4">
      <div className={`rounded-xl border ${
        isDark 
          ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border-slate-700/50' 
          : 'bg-gradient-to-br from-slate-100 via-white to-slate-100 border-gray-200'
      } shadow-lg overflow-hidden`}>
        
        {/* Main Hero Content */}
        <div className="p-4 sm:p-5">
          <div className="flex flex-col lg:flex-row items-stretch gap-4">
            
            {/* Left: Vertical Battery (Global QA Score) */}
            <div className="flex-shrink-0 flex flex-col items-center justify-center">
              <HeroBattery percentage={summary.globalQaScore} size="lg" showLabel={true} />
              <div className="mt-2 text-center">
                <span className="text-xs text-gray-500 dark:text-gray-400">Global QA Score</span>
                <div className="flex items-center justify-center gap-1 mt-1">
                  {getRiskBadge(summary.riskLevel)}
                </div>
              </div>
            </div>

            {/* Center: IronGate Branding + Typing Animation */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-800 dark:text-slate-100 leading-tight mb-1">
                IronGate QE Navigator
              </h1>
              <div className="relative h-6 overflow-hidden mb-2">
                <div
                  ref={containerRef}
                  className={`whitespace-nowrap text-xs sm:text-sm text-gray-600 dark:text-gray-300 font-mono transition-all duration-500 ease-in-out ${
                    slideOut ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'
                  }`}
                >
                  {displayedText}
                  <span className="animate-pulse">|</span>
                </div>
              </div>
              
              {/* AI Summary - Compact */}
              <div className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400">
                <Bot size={12} className="text-purple-500 flex-shrink-0" />
                <span className="truncate">{summary.aiSummary}</span>
              </div>
            </div>

            {/* KPI Tiles - All from real kpi_snapshots data */}
            <div className="flex-1 max-w-xl w-full">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {/* Test Coverage - AVG(test_coverage) */}
                <div className={`p-3 sm:p-4 rounded-xl ${isDark ? 'bg-slate-900/60' : 'bg-white'} border ${isDark ? 'border-slate-700' : 'border-gray-200'} flex flex-col justify-between`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <Shield size={16} className="text-green-500" />
                      <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">Coverage</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">{summary.avgTestCoverage}%</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Avg test coverage</p>
                  </div>
                </div>

                {/* Escape Rate - AVG(defect_escape_rate) */}
                <div className={`p-3 sm:p-4 rounded-xl ${isDark ? 'bg-slate-900/60' : 'bg-white'} border ${isDark ? 'border-slate-700' : 'border-gray-200'} flex flex-col justify-between`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <Bug size={16} className="text-red-500" />
                      <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">Escape Rate</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">{summary.avgDefectEscapeRate}%</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Defects reaching prod</p>
                  </div>
                </div>

                {/* Automation - AVG(automation_coverage) */}
                <div className={`p-3 sm:p-4 rounded-xl ${isDark ? 'bg-slate-900/60' : 'bg-white'} border ${isDark ? 'border-slate-700' : 'border-gray-200'} flex flex-col justify-between`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <Zap size={16} className="text-amber-500" />
                      <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">Automation</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">{summary.automationCoverage}%</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Automated coverage</p>
                  </div>
                </div>

                {/* Flakiness - AVG(test_flakiness_rate) */}
                <div className={`p-3 sm:p-4 rounded-xl ${isDark ? 'bg-slate-900/60' : 'bg-white'} border ${isDark ? 'border-slate-700' : 'border-gray-200'} flex flex-col justify-between`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <Activity size={16} className="text-purple-500" />
                      <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">Flakiness</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white leading-tight">{summary.avgFlakinessRate}%</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Unstable tests</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Top Performing Teams */}
            <div className={`flex-shrink-0 p-2.5 rounded-lg ${isDark ? 'bg-slate-800/50' : 'bg-white'} border ${isDark ? 'border-slate-700' : 'border-gray-200'} min-w-[140px]`}>
              <div className="flex items-center gap-1 mb-2">
                <TrendingUp size={12} className="text-green-500" />
                <span className="text-[10px] font-medium text-gray-700 dark:text-gray-300">Top Performing</span>
              </div>
              <div className="space-y-1">
                {summary.topImproving.slice(0, 3).map((team, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="text-gray-600 dark:text-gray-400 truncate max-w-[90px]">{team.name}</span>
                    <span className="font-semibold text-green-600 dark:text-green-400">{team.score}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Needs Attention Teams */}
            <div className={`flex-shrink-0 p-2.5 rounded-lg ${isDark ? 'bg-slate-800/50' : 'bg-white'} border ${isDark ? 'border-slate-700' : 'border-gray-200'} min-w-[140px]`}>
              <div className="flex items-center gap-1 mb-2">
                <AlertTriangle size={12} className="text-amber-500" />
                <span className="text-[10px] font-medium text-gray-700 dark:text-gray-300">Needs Attention</span>
              </div>
              <div className="space-y-1">
                {summary.needsAttention.slice(0, 3).map((team, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="text-gray-600 dark:text-gray-400 truncate max-w-[70px]">{team.name}</span>
                    <span className="text-amber-600 dark:text-amber-400">{team.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyHeroSection;
