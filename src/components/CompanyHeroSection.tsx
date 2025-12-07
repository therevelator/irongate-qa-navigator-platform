import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  TrendingUp, TrendingDown, Shield, AlertTriangle, CheckCircle2, 
  Activity, Bug, Zap, Bot, Heart, GitMerge, FileWarning, Gauge, X, Loader2
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
  
  // New Executive Metrics
  engineeringHealthScore: number;
  deliveryPerformanceScore: number;
  developerWellnessIndex: number;
  techDebtStatusScore: number;
  pipelineHealthScore: number;
  techDebtResolutionRate: number;
  
  // Generated
  aiSummary: string;
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

  const [showInsights, setShowInsights] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsData, setInsightsData] = useState<any>(null);

  const fetchInsights = async () => {
    if (insightsData) return;
    try {
      setInsightsLoading(true);
      const response = await fetch(`${API_URL}/analytics/company-insights`, {
        method: 'POST',
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setInsightsData(data);
      }
    } catch (error) {
      console.error('Error fetching insights:', error);
    } finally {
      setInsightsLoading(false);
    }
  };

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

  const MetricCard = ({ label, value, sublabel, icon: Icon, colorClass }: any) => (
    <div className={`p-3 rounded-xl ${isDark ? 'bg-slate-900/60' : 'bg-white'} border ${isDark ? 'border-slate-700' : 'border-gray-200'} flex flex-col justify-between h-full hover:shadow-md transition-shadow`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={colorClass} />
        <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wide">{label}</span>
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900 dark:text-white leading-none mb-1">{value}</p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">{sublabel}</p>
      </div>
    </div>
  );

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
          <div className="flex flex-col xl:flex-row items-stretch gap-6">
            
            {/* Left Group: Battery + Branding */}
            <div className="flex flex-col sm:flex-row items-center sm:items-stretch gap-6 flex-shrink-0 xl:w-1/3">
              {/* Vertical Battery (Global QA Score) */}
              <div className="flex-shrink-0 flex flex-col items-center justify-center min-w-[100px]">
                <HeroBattery percentage={summary.globalQaScore} size="lg" showLabel={true} />
                <div className="mt-2 text-center">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Global QA Score</span>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    {getRiskBadge(summary.riskLevel)}
                  </div>
                </div>
              </div>

              {/* IronGate Branding + Typing Animation */}
              <div className="flex-1 min-w-0 flex flex-col justify-center text-center sm:text-left">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-800 dark:text-slate-100 leading-tight mb-2">
                  IronGate QE Navigator
                </h1>
                <div className="relative h-10 sm:h-8 overflow-hidden mb-2">
                  <div
                    ref={containerRef}
                    className={`whitespace-normal sm:whitespace-nowrap text-xs sm:text-sm text-gray-600 dark:text-gray-300 font-mono transition-all duration-500 ease-in-out ${
                      slideOut ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'
                    }`}
                  >
                    {displayedText}
                    <span className="animate-pulse">|</span>
                  </div>
                </div>
                
                {/* AI Summary - Compact */}
                <button 
                  onClick={() => { setShowInsights(true); fetchInsights(); }}
                  className="flex items-center justify-center sm:justify-start gap-1.5 text-[10px] text-purple-600 dark:text-purple-400 mt-1 hover:text-purple-700 dark:hover:text-purple-300 transition-colors cursor-pointer w-full sm:w-auto font-medium"
                >
                  <Bot size={12} className="flex-shrink-0" />
                  <span className="truncate text-left">Generate AI Executive Analysis</span>
                </button>
              </div>
            </div>

            {/* Right Group: 5 Executive Metrics Grid */}
            <div className="flex-1 border-t xl:border-t-0 xl:border-l border-gray-200 dark:border-slate-800 pt-4 xl:pt-0 xl:pl-6">
              <div className="h-full flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-3">
                  <Activity size={14} className="text-blue-500" />
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Executive Engineering Metrics</h3>
                </div>
                
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                  {/* 1. Engineering Health Score (Primary) */}
                  <MetricCard 
                    label="Health Score" 
                    value={summary.engineeringHealthScore} 
                    sublabel="Engineering Health"
                    icon={Activity}
                    colorClass="text-blue-500"
                  />

                  {/* 2. Delivery Performance (DORA) */}
                  <MetricCard 
                    label="Delivery (DORA)" 
                    value={summary.deliveryPerformanceScore} 
                    sublabel="Deployment Perf"
                    icon={Zap}
                    colorClass="text-amber-500"
                  />

                  {/* 3. Developer Wellness */}
                  <MetricCard 
                    label="Dev Wellness" 
                    value={summary.developerWellnessIndex} 
                    sublabel="Sustainability Index"
                    icon={Heart}
                    colorClass="text-pink-500"
                  />

                  {/* 4. Technical Debt Status */}
                  <MetricCard 
                    label="Tech Debt Status" 
                    value={summary.techDebtStatusScore} 
                    sublabel="Risk Status"
                    icon={FileWarning}
                    colorClass="text-orange-500"
                  />

                  {/* 5. Pipeline Health */}
                  <MetricCard 
                    label="Pipeline Health" 
                    value={summary.pipelineHealthScore} 
                    sublabel="CI/CD Stability"
                    icon={GitMerge}
                    colorClass="text-green-500"
                  />
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
      {/* AI Insights Overlay */}
      {showInsights && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className={`w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl shadow-2xl border ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200'} flex flex-col`}>
            
            {/* Header */}
            <div className={`flex items-center justify-between p-5 border-b ${isDark ? 'border-slate-800' : 'border-gray-100'} sticky top-0 ${isDark ? 'bg-slate-900' : 'bg-white'} z-10`}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                  <Bot size={24} className="text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Executive Engineering Insights</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">AI-driven analysis of company-wide metrics</p>
                </div>
              </div>
              <button 
                onClick={() => setShowInsights(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-gray-400 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {insightsLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 size={40} className="text-purple-500 animate-spin mb-4" />
                  <p className="text-gray-500 dark:text-gray-400">Analyzing engineering data...</p>
                </div>
              ) : insightsData ? (
                <>
                  {/* AI Analysis Text */}
                  <div className={`p-5 rounded-xl ${isDark ? 'bg-slate-800/50' : 'bg-gray-50'} border ${isDark ? 'border-slate-700' : 'border-gray-200'}`}>
                    <div className="prose dark:prose-invert max-w-none">
                      <div className="whitespace-pre-wrap text-sm sm:text-base leading-relaxed text-gray-700 dark:text-gray-300">
                        {insightsData.analysis}
                      </div>
                    </div>
                    {/* Disclaimer */}
                    <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mt-4 pt-3 border-t border-gray-200 dark:border-slate-700">
                      <Bot size={12} className="text-gray-400" />
                      <span>Analysis generated by AI. Please verify critical metrics independently.</span>
                    </div>
                  </div>

                  {/* Trend History Visualization (Simple) */}
                  {insightsData.history && insightsData.history.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 uppercase tracking-wider flex items-center gap-2">
                        <Activity size={14} className="text-blue-500" />
                        30-Day Health Trend
                      </h3>
                      <div className="h-32 w-full flex items-end gap-1">
                        {insightsData.history.map((point: any, i: number) => {
                          const height = `${Math.max(10, point.engineering_health_score)}%`;
                          return (
                            <div key={i} className="flex-1 flex flex-col justify-end group relative">
                              <div 
                                style={{ height }} 
                                className={`w-full rounded-t-sm opacity-80 hover:opacity-100 transition-all ${
                                  point.engineering_health_score >= 80 ? 'bg-green-500' : 
                                  point.engineering_health_score >= 60 ? 'bg-blue-500' : 'bg-amber-500'
                                }`}
                              />
                              {/* Tooltip */}
                              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-20 whitespace-nowrap bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg">
                                {new Date(point.snapshot_date).toLocaleDateString()} : {point.engineering_health_score}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <p>Failed to load insights. Please try again.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompanyHeroSection;
