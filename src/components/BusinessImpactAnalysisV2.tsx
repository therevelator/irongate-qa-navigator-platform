import React, { useState, useEffect, useCallback } from 'react';
import { 
  ArrowLeft, DollarSign, TrendingUp, Users, Target, AlertCircle, BarChart3, 
  Loader2, Save, RefreshCw, CheckCircle, XCircle, ChevronDown, ChevronRight,
  Database, Calculator, Calendar, Info, Plus, Trash2, Download, Sun, Moon
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, 
  Legend, ScatterChart, Scatter, ZAxis, Cell, BarChart, Bar
} from 'recharts';
import { API_URL } from '../config/api';
import { toast } from 'react-hot-toast';
import { useTheme } from '../contexts/ThemeContext';

// Simple markdown renderer component
const MarkdownRenderer: React.FC<{ content: string; isDark: boolean }> = ({ content, isDark }) => {
  // Add styling classes for the HTML content
  const styledContent = content
    .replace(/<table>/g, `<table class="w-full border-collapse my-4 text-sm">`)
    .replace(/<th>/g, `<th class="border ${isDark ? 'border-slate-600 bg-slate-800' : 'border-slate-300 bg-slate-100'} px-3 py-2 text-left font-semibold">`)
    .replace(/<td>/g, `<td class="border ${isDark ? 'border-slate-600' : 'border-slate-300'} px-3 py-2">`)
    .replace(/<h2>/g, `<h2 class="text-lg font-bold mt-4 mb-2 ${isDark ? 'text-slate-100' : 'text-slate-900'}">`)
    .replace(/<h3>/g, `<h3 class="text-base font-semibold mt-3 mb-1 ${isDark ? 'text-slate-200' : 'text-slate-800'}">`)
    .replace(/<ul>/g, `<ul class="list-disc list-inside my-2 space-y-1 ml-4">`)
    .replace(/<li>/g, `<li class="leading-relaxed">`)
    .replace(/<p>/g, `<p class="my-2 leading-relaxed">`)
    .replace(/<strong>/g, `<strong class="font-semibold">`)
    .replace(/class="positive"/g, `class="text-emerald-500 font-medium"`)
    .replace(/class="negative"/g, `class="text-red-500 font-medium"`);

  return (
    <div 
      className="ai-html-content"
      dangerouslySetInnerHTML={{ __html: styledContent }}
    />
  );
};

interface BusinessImpactAnalysisV2Props {
  onBack: () => void;
  teamId?: string;
}

// Quality metrics fields
const QUALITY_METRICS = [
  { key: 'test_coverage', label: 'Test Coverage', unit: '%', description: 'Code coverage percentage' },
  { key: 'defect_density', label: 'Defect Density', unit: '/KLOC', description: 'Bugs per thousand lines of code' },
  { key: 'defect_escape_rate', label: 'Defect Escape Rate', unit: '%', description: 'Bugs found in production' },
  { key: 'mttr_hours', label: 'MTTR', unit: 'hrs', description: 'Mean time to restore service' },
  { key: 'deployment_frequency', label: 'Deploy Frequency', unit: '/mo', description: 'Deployments per month' },
  { key: 'lead_time_days', label: 'Lead Time', unit: 'days', description: 'Commit to production time' },
  { key: 'code_quality_score', label: 'Code Quality', unit: '%', description: 'Overall code quality score' },
  { key: 'change_failure_rate', label: 'Change Failure Rate', unit: '%', description: 'Failed deployment percentage' },
];

// Business KPI fields
const BUSINESS_KPIS = [
  { key: 'monthly_revenue', label: 'Monthly Revenue', unit: '$', description: 'Total monthly revenue' },
  { key: 'active_users', label: 'Active Users', unit: '', description: 'Monthly active users' },
  { key: 'churn_rate', label: 'Churn Rate', unit: '%', description: 'Customer churn percentage' },
  { key: 'feature_adoption_rate', label: 'Feature Adoption', unit: '%', description: 'New feature usage rate' },
  { key: 'nps_score', label: 'NPS Score', unit: '', description: 'Net Promoter Score (-100 to 100)' },
  { key: 'csat_score', label: 'CSAT Score', unit: '%', description: 'Customer satisfaction score' },
  { key: 'support_ticket_volume', label: 'Support Tickets', unit: '', description: 'Monthly ticket count' },
];

// Context fields
const CONTEXT_FIELDS = [
  { key: 'team_size', label: 'Team Size', unit: '', description: 'Number of team members' },
  { key: 'feature_release_count', label: 'Features Released', unit: '', description: 'Features shipped' },
  { key: 'total_user_base', label: 'Total Users', unit: '', description: 'Total registered users' },
  { key: 'user_growth_rate', label: 'User Growth', unit: '%', description: 'Month-over-month growth' },
  { key: 'downtime_minutes', label: 'Downtime', unit: 'min', description: 'Total service downtime' },
  { key: 'is_holiday_season', label: 'Holiday Season', unit: '', description: 'Seasonal flag' },
];

interface MonthlyData {
  month_year: string;
  quality: Record<string, number | null>;
  kpis: Record<string, number | null>;
  context: Record<string, number | boolean | null>;
}

interface Correlation {
  quality_metric: string;
  business_kpi: string;
  pearson_correlation: number;
  p_value: number;
  sample_size: number;
  correlation_strength: string;
  is_significant: boolean;
}

interface DataSummary {
  monthsWithQualityData: number;
  monthsWithKpiData: number;
  monthsWithPairedData: number;
  isCorrelationReady: boolean;
  earliestMonth: string | null;
  latestMonth: string | null;
}

const BusinessImpactAnalysisV2: React.FC<BusinessImpactAnalysisV2Props> = ({ onBack, teamId: propTeamId }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'data-entry' | 'correlations'>('overview');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  
  // Use global theme context
  const { isDark, toggleMode } = useTheme();
  
  // Team selection - use prop if available, otherwise load teams
  const [teams, setTeams] = useState<any[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(propTeamId || '');
  const [useTeamSelector, setUseTeamSelector] = useState<boolean>(!propTeamId);
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [correlations, setCorrelations] = useState<Correlation[]>([]);
  const [dataSummary, setDataSummary] = useState<DataSummary | null>(null);
  
  // Expanded sections
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  
  // Generate last 12 months
  const getLast12Months = useCallback(() => {
    const months: string[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
  }, []);

  // Fetch teams only if we need to show team selector
  useEffect(() => {
    if (!useTeamSelector) return;
    
    const fetchTeams = async () => {
      try {
        const response = await fetch(`${API_URL}/teams`, {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          // Handle both { teams: [...] } and plain array responses
          const loadedTeams = Array.isArray(data) ? data : (data.teams || []);
          console.log('[BIA] Teams loaded:', loadedTeams.length);
          setTeams(loadedTeams);
          if (loadedTeams.length > 0 && !selectedTeamId) {
            console.log('[BIA] Auto-selecting first team:', loadedTeams[0].id);
            setSelectedTeamId(loadedTeams[0].id);
          } else if (loadedTeams.length === 0) {
            // No teams available, stop loading
            setLoading(false);
          }
        } else {
          console.error('[BIA] Failed to fetch teams:', response.status);
          setLoading(false);
        }
      } catch (error) {
        console.error('Error fetching teams:', error);
        setLoading(false);
      }
    };
    fetchTeams();
  }, [useTeamSelector]);

  // Fetch correlation data when team changes - now using real database data
  useEffect(() => {
    if (!selectedTeamId) return;
    
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch real data from database
        const response = await fetch(`${API_URL}/analytics/business-impact-v2/${selectedTeamId}`, {
          credentials: 'include'
        });
        
        if (response.ok) {
          const data = await response.json();
          
          // Merge quality metrics, KPIs, and context into monthly data
          const months = getLast12Months();
          const mergedData: MonthlyData[] = months.map(month => {
            const quality = data.qualityMetrics?.find((q: any) => q.month_year === month) || {};
            const kpis = data.businessKpis?.find((k: any) => k.month_year === month) || {};
            const context = data.contextData?.find((c: any) => c.month_year === month) || {};
            
            return {
              month_year: month,
              quality: {
                test_coverage: quality.test_coverage ?? null,
                defect_density: quality.defect_density ?? null,
                defect_escape_rate: quality.defect_escape_rate ?? null,
                mttr_hours: quality.mttr_hours ?? null,
                deployment_frequency: quality.deployment_frequency ?? null,
                lead_time_days: quality.lead_time_days ?? null,
                code_quality_score: quality.code_quality_score ?? null,
                change_failure_rate: quality.change_failure_rate ?? null,
              },
              kpis: {
                monthly_revenue: kpis.monthly_revenue ?? null,
                active_users: kpis.active_users ?? null,
                churn_rate: kpis.churn_rate ?? null,
                feature_adoption_rate: kpis.feature_adoption_rate ?? null,
                nps_score: kpis.nps_score ?? null,
                csat_score: kpis.csat_score ?? null,
                support_ticket_volume: kpis.support_ticket_volume ?? null,
              },
              context: {
                team_size: context.team_size ?? null,
                feature_release_count: context.feature_release_count ?? null,
                total_user_base: context.total_user_base ?? null,
                user_growth_rate: context.user_growth_rate ?? null,
                downtime_minutes: context.downtime_minutes ?? null,
                is_holiday_season: context.is_holiday_season ?? false,
              }
            };
          });
          
          setMonthlyData(mergedData);
          setCorrelations(data.correlations || []);
          setDataSummary(data.summary || null);
          
          // Show seeding notification if data was just generated
          if (data.dataGenerated) {
            toast.success(data.message || 'Data seeded successfully!', {
              duration: 4000,
              icon: '🌱'
            });
          } else {
            toast.success('Loaded real data from database!');
          }
        } else if (response.status === 404) {
          // No data found, offer to generate realistic data
          toast.success('No historical data found. Use the data entry tab to add business impact data.');
          
          // Initialize with empty data
          const months = getLast12Months();
          setMonthlyData(months.map(month => ({
            month_year: month,
            quality: {},
            kpis: {},
            context: {}
          })));
        } else {
          const error = await response.json();
          toast.error(error.error || 'Failed to load data');
          
          // Fallback to empty data
          const months = getLast12Months();
          setMonthlyData(months.map(month => ({
            month_year: month,
            quality: {},
            kpis: {},
            context: {}
          })));
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        toast.error('Failed to load correlation data');
        
        // Fallback to empty data
        const months = getLast12Months();
        setMonthlyData(months.map(month => ({
          month_year: month,
          quality: {},
          kpis: {},
          context: {}
        })));
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [selectedTeamId, getLast12Months]);

  // Update a metric value
  const updateMetric = (monthYear: string, category: 'quality' | 'kpis' | 'context', key: string, value: string) => {
    setMonthlyData(prev => prev.map(m => {
      if (m.month_year !== monthYear) return m;
      const numValue = value === '' ? null : (key === 'is_holiday_season' ? value === 'true' : parseFloat(value));
      return {
        ...m,
        [category]: {
          ...m[category],
          [key]: numValue
        }
      };
    }));
  };

  // Save all data
  const saveData = async () => {
    if (!selectedTeamId) {
      toast.error('Please select a team first');
      return;
    }

    setSaving(true);
    try {
      // Filter to only months with data
      const dataToSave = monthlyData.filter(m => 
        Object.values(m.quality).some(v => v !== null) ||
        Object.values(m.kpis).some(v => v !== null) ||
        Object.values(m.context).some(v => v !== null && v !== false)
      );

      const response = await fetch(`${API_URL}/analytics/business-impact-v2/${selectedTeamId}/bulk-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ monthlyData: dataToSave })
      });

      if (response.ok) {
        const result = await response.json();
        toast.success(`Saved data for ${result.monthsSaved} months`);
      } else {
        toast.error('Failed to save data');
      }
    } catch (error) {
      console.error('Error saving:', error);
      toast.error('Failed to save data');
    } finally {
      setSaving(false);
    }
  };

  // Regenerate realistic demo data for the selected team
  const regenerateData = async () => {
    if (!selectedTeamId) {
      toast.error('Please select a team first');
      return;
    }

    setSeeding(true);
    try {
      const response = await fetch(`${API_URL}/analytics/business-impact-v2/${selectedTeamId}/generate-realistic-data`, {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();

        const months = getLast12Months();
        const mergedData: MonthlyData[] = months.map(month => {
          const quality = data.qualityMetrics?.find((q: any) => q.month_year === month) || {};
          const kpis = data.businessKpis?.find((k: any) => k.month_year === month) || {};
          const context = data.contextData?.find((c: any) => c.month_year === month) || {};

          return {
            month_year: month,
            quality: {
              test_coverage: quality.test_coverage ?? null,
              defect_density: quality.defect_density ?? null,
              defect_escape_rate: quality.defect_escape_rate ?? null,
              mttr_hours: quality.mttr_hours ?? null,
              deployment_frequency: quality.deployment_frequency ?? null,
              lead_time_days: quality.lead_time_days ?? null,
              code_quality_score: quality.code_quality_score ?? null,
              change_failure_rate: quality.change_failure_rate ?? null,
            },
            kpis: {
              monthly_revenue: kpis.monthly_revenue ?? null,
              active_users: kpis.active_users ?? null,
              churn_rate: kpis.churn_rate ?? null,
              feature_adoption_rate: kpis.feature_adoption_rate ?? null,
              nps_score: kpis.nps_score ?? null,
              csat_score: kpis.csat_score ?? null,
              support_ticket_volume: kpis.support_ticket_volume ?? null,
            },
            context: {
              team_size: context.team_size ?? null,
              feature_release_count: context.feature_release_count ?? null,
              total_user_base: context.total_user_base ?? null,
              user_growth_rate: context.user_growth_rate ?? null,
              downtime_minutes: context.downtime_minutes ?? null,
              is_holiday_season: !!context.is_holiday_season,
            }
          };
        });

        setMonthlyData(mergedData);
        setCorrelations(data.correlations || []);
        setDataSummary(data.summary || null);

        toast.success(data.message || 'Realistic data generated successfully!', {
          duration: 4000,
          icon: '🌱'
        });
      } else {
        const error = await response.json().catch(() => null);
        toast.error(error?.error || 'Failed to regenerate data');
      }
    } catch (error) {
      console.error('Error regenerating data:', error);
      toast.error('Failed to regenerate data');
    } finally {
      setSeeding(false);
    }
  };

  // Calculate correlations
  const calculateCorrelations = async () => {
    if (!selectedTeamId) {
      toast.error('Please select a team first');
      return;
    }

    setCalculating(true);
    try {
      const response = await fetch(`${API_URL}/analytics/business-impact-v2/${selectedTeamId}/calculate-correlations`, {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        const result = await response.json();
        setCorrelations(result.topCorrelations || []);
        toast.success(`Calculated ${result.correlationsCalculated} correlations from ${result.pairedMonths} months of data`);
        
        // Update summary
        setDataSummary(prev => prev ? {
          ...prev,
          monthsWithPairedData: result.pairedMonths,
          isCorrelationReady: true
        } : null);
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to calculate correlations');
      }
    } catch (error) {
      console.error('Error calculating:', error);
      toast.error('Failed to calculate correlations');
    } finally {
      setCalculating(false);
    }
  };

  // Analyze correlations with AI (via backend)
  const analyzeCorrelationsWithAI = async () => {
    console.log('🎯 analyzeCorrelationsWithAI function called');
    console.log('📊 Correlations available:', correlations.length);

    if (correlations.length === 0) {
      console.log('❌ No correlations to analyze');
      toast.error('No correlations to analyze. Generate data first.');
      return;
    }

    if (!selectedTeamId) {
      toast.error('Please select a team first');
      return;
    }

    console.log('🚀 Starting AI analysis via backend...');
    setAiAnalyzing(true);
    try {
      const response = await fetch(`${API_URL}/analytics/business-impact-v2/${selectedTeamId}/ai-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ correlations })
      });

      console.log('📡 Backend response:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('✅ AI analysis received');
        
        // Add AI disclaimer to the response
        const aiWithDisclaimer = `⚠️ **AI-Generated Content** - This analysis was generated by AI. Please verify all information and check for potential inaccuracies before making business decisions.

---

${data.analysis}`;
        
        setAiAnalysis(aiWithDisclaimer);
        toast.success('AI analysis completed!');
      } else {
        const error = await response.json();
        console.error('❌ Backend error:', error);
        toast.error(error.error || 'Failed to analyze correlations');
      }
    } catch (error) {
      console.error('❌ Error in AI analysis:', error);
      toast.error('Failed to analyze correlations');
    } finally {
      setAiAnalyzing(false);
    }
  };

  // Toggle month expansion
  const toggleMonth = (month: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  };
  
  // Format month for display
  const formatMonth = (monthYear: string) => {
    const [year, month] = monthYear.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[parseInt(month) - 1]} ${year}`;
  };

  // Get correlation color
  const getCorrelationColor = (r: number) => {
    const absR = Math.abs(r);
    if (absR >= 0.7) return r > 0 ? 'text-green-500' : 'text-red-500';
    if (absR >= 0.5) return r > 0 ? 'text-blue-500' : 'text-orange-500';
    if (absR >= 0.3) return 'text-yellow-500';
    return 'text-gray-400';
  };

  // Get correlation background
  const getCorrelationBg = (r: number) => {
    const absR = Math.abs(r);
    if (absR >= 0.7) return r > 0 ? 'bg-green-500/20' : 'bg-red-500/20';
    if (absR >= 0.5) return r > 0 ? 'bg-blue-500/20' : 'bg-orange-500/20';
    if (absR >= 0.3) return 'bg-yellow-500/20';
    return 'bg-gray-500/10';
  };

  // Prepare chart data - filter out null values for cleaner chart
  const chartData = monthlyData.map(m => {
    const dataPoint = {
      month: formatMonth(m.month_year),
      ...Object.fromEntries(
        Object.entries(m.quality).filter(([_, value]) => value !== null)
      ),
      ...Object.fromEntries(
        Object.entries(m.kpis).filter(([_, value]) => value !== null)
      )
    };
    return dataPoint;
  }).filter(point => Object.keys(point).length > 1); // Ensure at least month + one data point

  // Data completeness check
  const getDataCompleteness = () => {
    const qualityFields = QUALITY_METRICS.map(m => m.key);
    const kpiFields = BUSINESS_KPIS.map(k => k.key);
    
    let qualityComplete = 0;
    let kpiComplete = 0;
    let paired = 0;
    
    monthlyData.forEach(m => {
      const hasQuality = qualityFields.some(f => m.quality[f] !== null);
      const hasKpi = kpiFields.some(f => m.kpis[f] !== null);
      if (hasQuality) qualityComplete++;
      if (hasKpi) kpiComplete++;
      if (hasQuality && hasKpi) paired++;
    });
    
    return { qualityComplete, kpiComplete, paired };
  };

  const completeness = getDataCompleteness();

  // Debug: Show loading info instead of spinner
  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        isDark 
          ? 'bg-slate-950 text-slate-100' 
          : 'bg-slate-50 text-slate-900'
      }`}>
        <div className="text-center">
          <Loader2 className={`w-8 h-8 animate-spin mx-auto mb-4 ${
            isDark ? 'text-cyan-400' : 'text-cyan-600'
          }`} />
          <p className="mb-2">Loading Business Impact Analysis...</p>
          <p className={`text-sm ${
            isDark ? 'text-slate-400' : 'text-slate-600'
          }`}>Fetching teams and data...</p>
          <p className={`text-xs mt-4 ${
            isDark ? 'text-slate-500' : 'text-slate-600'
          }`}>Selected Team: {selectedTeamId || 'None'}</p>
          <p className={`text-xs ${
            isDark ? 'text-slate-500' : 'text-slate-600'
          }`}>Teams Loaded: {teams.length}</p>
          <p className={`text-xs ${
            isDark ? 'text-slate-500' : 'text-slate-600'
          }`}>Monthly Data: {monthlyData.length} months</p>
          <p className={`text-xs ${
            isDark ? 'text-slate-500' : 'text-slate-600'
          }`}>Team Selector: {useTeamSelector ? 'Enabled' : 'Disabled (using prop)'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-colors duration-300 ${
      isDark 
        ? 'bg-slate-950 text-slate-100' 
        : 'bg-slate-50 text-slate-900'
    }`}>
      {/* Header */}
      <div className={`border-b transition-colors duration-300 ${
        isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
      } sticky top-0 z-10 shadow-sm`}>
        <div className="px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <button 
              onClick={onBack}
              className={`flex items-center space-x-2 transition-colors hover:text-blue-500 ${
                isDark ? 'text-slate-400' : 'text-slate-600'
              } mb-4 sm:mb-0`}
            >
              <ArrowLeft size={20} />
              <span className="font-medium">Back to Features</span>
            </button>
            
            {/* Theme Toggle */}
            <div className="flex items-center gap-4">
              <button
                onClick={toggleMode}
                className={`p-2 rounded-lg transition-colors ${
                  isDark 
                    ? 'hover:bg-slate-800 text-slate-400 hover:text-slate-200' 
                    : 'hover:bg-slate-100 text-slate-600 hover:text-slate-800'
                }`}
                title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
              >
                {isDark ? <Sun size={20} /> : <Moon size={20} />}
              </button>

              {/* Team Selector - only show when no teamId prop provided */}
              {useTeamSelector && (
                <select
                  value={selectedTeamId}
                  onChange={(e) => setSelectedTeamId(e.target.value)}
                  className={`px-3 py-2 rounded-lg transition-colors border ${
                    isDark
                      ? 'bg-slate-800 border-slate-700 text-slate-200 focus:border-blue-500'
                      : 'bg-white border-slate-300 text-slate-900 focus:border-blue-500'
                  } focus:outline-none focus:ring-2 focus:ring-blue-500/20`}
                >
                  <option value="">Select Team</option>
                  {teams.map(team => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Main Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold flex items-center">
                <DollarSign className={`mr-3 ${
                  isDark ? 'text-green-500' : 'text-green-600'
                }`} size={28} />
                Business Impact Correlation
              </h1>
              <p className={`mt-1 text-sm sm:text-base ${
                isDark ? 'text-slate-400' : 'text-slate-600'
              }`}>
                Statistical analysis of quality metrics vs business outcomes
              </p>
            </div>
          </div>

          {/* Tabs - Responsive */}
          <div className="flex flex-wrap gap-2 sm:gap-4 mt-6">
            {[
              { id: 'overview', label: 'Overview', icon: BarChart3 },
              { id: 'data-entry', label: 'Data Entry', icon: Database },
              { id: 'correlations', label: 'Correlations', icon: Calculator },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition-all text-sm sm:text-base ${
                  activeTab === tab.id 
                    ? 'bg-blue-600 text-white shadow-lg' 
                    : isDark
                      ? 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                      : 'bg-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-300'
                }`}
              >
                <tab.icon size={18} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Data Requirements Banner */}
      <div className={`px-4 sm:px-6 lg:px-8 py-4 transition-colors duration-300 ${
        isDark ? 'bg-slate-900/50 border-slate-800' : 'bg-slate-100/50 border-slate-200'
      } border-b`}>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
          <div className="flex items-center gap-2">
            {completeness.paired >= 6 ? (
              <CheckCircle className="text-green-500" size={20} />
            ) : (
              <XCircle className="text-red-500" size={20} />
            )}
            <span className="text-sm">
              <span className="font-medium">{completeness.paired}/12</span> months paired data
              <span className={`ml-1 ${
                isDark ? 'text-slate-500' : 'text-slate-600'
              }`}>(min 6 required)</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Database size={16} className={isDark ? 'text-blue-400' : 'text-blue-600'} />
            <span className="text-sm">
              <span className="font-medium">{completeness.qualityComplete}</span> quality,{' '}
              <span className="font-medium">{completeness.kpiComplete}</span> KPI months
            </span>
          </div>
          {dataSummary?.earliestMonth && (
            <div className="flex items-center gap-2">
              <Calendar size={16} className={isDark ? 'text-purple-400' : 'text-purple-600'} />
              <span className="text-sm">
                {formatMonth(dataSummary.earliestMonth)} - {formatMonth(dataSummary.latestMonth!)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-4 sm:space-y-6">
            {/* Summary Cards - Responsive Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className={`rounded-xl p-4 border transition-colors duration-300 ${
                isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
              }`}>
                <div className={`text-sm mb-1 ${
                  isDark ? 'text-slate-400' : 'text-slate-600'
                }`}>Strongest Correlation</div>
                <div className="text-2xl font-bold text-green-500">
                  {correlations.length > 0 ? Number(correlations[0].pearson_correlation).toFixed(3) : 'N/A'}
                </div>
                <div className={`text-xs mt-1 ${
                  isDark ? 'text-slate-500' : 'text-slate-600'
                }`}>
                  {correlations.length > 0 ? `${correlations[0].quality_metric.replace(/_/g, ' ')} → ${correlations[0].business_kpi.replace(/_/g, ' ')}` : 'No data'}
                </div>
              </div>
              <div className={`rounded-xl p-4 border transition-colors duration-300 ${
                isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
              }`}>
                <div className={`text-sm mb-1 ${
                  isDark ? 'text-slate-400' : 'text-slate-600'
                }`}>Significant Correlations</div>
                <div className="text-2xl font-bold text-blue-500">
                  {correlations.filter(c => c.is_significant).length}
                </div>
                <div className={`text-xs mt-1 ${
                  isDark ? 'text-slate-500' : 'text-slate-600'
                }`}>p-value &lt; 0.05</div>
              </div>
              <div className={`rounded-xl p-4 border transition-colors duration-300 ${
                isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
              }`}>
                <div className={`text-sm mb-1 ${
                  isDark ? 'text-slate-400' : 'text-slate-600'
                }`}>Data Points</div>
                <div className="text-2xl font-bold text-purple-500">
                  {completeness.paired * (QUALITY_METRICS.length + BUSINESS_KPIS.length)}
                </div>
                <div className={`text-xs mt-1 ${
                  isDark ? 'text-slate-500' : 'text-slate-600'
                }`}>Across {completeness.paired} months</div>
              </div>
              <div className={`rounded-xl p-4 border transition-colors duration-300 ${
                isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
              }`}>
                <div className={`text-sm mb-1 ${
                  isDark ? 'text-slate-400' : 'text-slate-600'
                }`}>Correlation Ready</div>
                <div className={`text-2xl font-bold ${
                  completeness.paired >= 6 ? 'text-green-500' : 'text-red-500'
                }`}>
                  {completeness.paired >= 6 ? 'Yes' : 'No'}
                </div>
                <div className={`text-xs mt-1 ${
                  isDark ? 'text-slate-500' : 'text-slate-600'
                }`}>
                  {completeness.paired >= 6 ? 'Ready to calculate' : `Need ${6 - completeness.paired} more months`}
                </div>
              </div>
            </div>

            {/* AI Analysis Button */}
            {correlations.length > 0 && (
              <div className="flex justify-center">
                <button
                  onClick={analyzeCorrelationsWithAI}
                  disabled={aiAnalyzing}
                  className={`flex items-center gap-2 px-6 py-3 rounded-lg transition-all disabled:opacity-50 ${
                    isDark
                      ? 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 hover:border-slate-600'
                      : 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 hover:border-slate-400'
                  }`}
                >
                  {aiAnalyzing ? <Loader2 className="animate-spin" size={20} /> : <BarChart3 size={20} />}
                  {aiAnalyzing ? 'Analyzing...' : 'Analyze with AI'}
                </button>
              </div>
            )}

            {/* AI Analysis Results */}
            {aiAnalysis && (
              <div className={`rounded-xl p-4 sm:p-6 border transition-colors duration-300 ${
                isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
              }`}>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <BarChart3 className={isDark ? 'text-purple-400' : 'text-purple-600'} size={20} />
                  AI Business Impact Analysis
                </h3>
                
                {/* AI Response - Formatted */}
                <div className={`text-sm leading-relaxed ${
                  isDark ? 'text-slate-300' : 'text-slate-700'
                }`}>
                  <MarkdownRenderer content={aiAnalysis} isDark={isDark} />
                </div>
              </div>
            )}

            {/* Empty State - Show when no data */}
            {completeness.paired === 0 && (
              <div className={`rounded-xl p-6 sm:p-8 border transition-colors duration-300 text-center ${
                isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
              }`}>
                <Database size={48} className={`mx-auto mb-4 ${
                  isDark ? 'text-slate-600' : 'text-slate-400'
                }`} />
                <h3 className="text-xl font-semibold mb-2">No Historical Data Found</h3>
                <p className={`mb-6 max-w-md mx-auto ${
                  isDark ? 'text-slate-400' : 'text-slate-600'
                }`}>
                  No business impact data exists for this team in the database.
                  The system will automatically load real data when available.
                </p>
                <div className="flex gap-4 justify-center">
                  <div className={`text-sm ${
                    isDark ? 'text-slate-500' : 'text-slate-600'
                  }`}>
                    Select a team above to load correlation data
                  </div>
                </div>
              </div>
            )}

            {/* Time Series Chart */}
            {monthlyData.length > 0 ? (
              <div className={`rounded-xl p-4 sm:p-6 border transition-colors duration-300 ${
                isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
              }`}>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp className={isDark ? 'text-cyan-400' : 'text-cyan-600'} size={20} />
                  Quality Metrics vs Business KPIs Over Time
                </h3>
                <div className="mb-2 text-sm text-gray-500">
                  Data points: {chartData.length}, Months loaded: {monthlyData.length}
                </div>
                <div className="h-64 sm:h-80">
                  {(() => {
                    try {
                      return (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#e2e8f0'} />
                            <XAxis dataKey="month" stroke={isDark ? '#94a3b8' : '#64748b'} />
                            <YAxis yAxisId="left" stroke={isDark ? '#94a3b8' : '#64748b'} />
                            <YAxis yAxisId="right" orientation="right" stroke={isDark ? '#94a3b8' : '#64748b'} />
                            <Tooltip 
                              contentStyle={{
                                backgroundColor: isDark ? '#1e293b' : '#ffffff',
                                border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
                                borderRadius: '8px'
                              }}
                            />
                            <Legend />
                            <Line yAxisId="left" type="monotone" dataKey="test_coverage" stroke="#3b82f6" name="Test Coverage %" dot={false} />
                            <Line yAxisId="left" type="monotone" dataKey="nps_score" stroke="#8b5cf6" name="NPS Score" dot={false} />
                            <Line yAxisId="right" type="monotone" dataKey="churn_rate" stroke="#ef4444" name="Churn Rate %" dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      );
                    } catch (error) {
                      console.error('Chart rendering error:', error);
                      return (
                        <div className="flex items-center justify-center h-full">
                          <div className="text-center">
                            <p className={isDark ? 'text-slate-400' : 'text-slate-600'}>Chart rendering error</p>
                            <p className="text-xs text-red-500 mt-1">Check console for details</p>
                          </div>
                        </div>
                      );
                    }
                  })()}
                </div>
              </div>
            ) : (
              <div className={`rounded-xl p-4 sm:p-6 border transition-colors duration-300 ${
                isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
              }`}>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp className={isDark ? 'text-cyan-400' : 'text-cyan-600'} size={20} />
                  Quality Metrics vs Business KPIs Over Time
                </h3>
                <div className="text-center py-8">
                  <p className={isDark ? 'text-slate-400' : 'text-slate-600'}>Loading chart data...</p>
                </div>
              </div>
            )}

            {/* Parameter Explanations */}
            <div className={`rounded-xl p-4 sm:p-6 border transition-colors duration-300 ${
              isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
            }`}>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Info className={isDark ? 'text-blue-400' : 'text-blue-600'} size={20} />
                Chart Parameters Explained
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className={`p-3 rounded-lg border transition-colors ${
                  isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                    <span className="font-medium text-blue-500">Test Coverage %</span>
                  </div>
                  <p className={`text-sm ${
                    isDark ? 'text-slate-400' : 'text-slate-600'
                  }`}>
                    Percentage of code covered by automated tests. Higher coverage indicates better quality assurance and fewer production defects.
                  </p>
                </div>

                <div className={`p-3 rounded-lg border transition-colors ${
                  isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                    <span className="font-medium text-purple-500">NPS Score</span>
                  </div>
                  <p className={`text-sm ${
                    isDark ? 'text-slate-400' : 'text-slate-600'
                  }`}>
                    Net Promoter Score measures customer loyalty and satisfaction. Ranges from -100 (all detractors) to +100 (all promoters).
                  </p>
                </div>

                <div className={`p-3 rounded-lg border transition-colors ${
                  isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                    <span className="font-medium text-red-500">Churn Rate %</span>
                  </div>
                  <p className={`text-sm ${
                    isDark ? 'text-slate-400' : 'text-slate-600'
                  }`}>
                    Percentage of customers who stop using the service. Lower rates indicate better customer retention and product-market fit.
                  </p>
                </div>
              </div>
              <div className={`mt-4 p-3 rounded-lg border transition-colors ${
                isDark ? 'border-amber-600 bg-amber-900/20' : 'border-amber-200 bg-amber-50'
              }`}>
                <div className="flex items-start gap-2">
                  <Info className={`mt-0.5 flex-shrink-0 ${
                    isDark ? 'text-amber-400' : 'text-amber-600'
                  }`} size={16} />
                  <div>
                    <p className={`text-sm font-medium mb-1 ${
                      isDark ? 'text-amber-300' : 'text-amber-800'
                    }`}>
                      Correlation Analysis
                    </p>
                    <p className={`text-sm ${
                      isDark ? 'text-slate-400' : 'text-slate-600'
                    }`}>
                      This chart shows how quality metrics (test coverage) correlate with business outcomes (NPS, churn rate).
                      Strong correlations help identify which quality improvements drive the most business impact.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Top Correlations */}
            {correlations.length > 0 && (
              <div className={`rounded-xl p-6 border transition-colors duration-300 ${
                isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
              }`}>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Calculator className={isDark ? 'text-green-400' : 'text-green-600'} size={20} />
                  Top Correlations (Realistic Data)
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {correlations.slice(0, 10).map((c, i) => (
                    <div 
                      key={i} 
                      className={`p-3 rounded-lg ${getCorrelationBg(c.pearson_correlation)} flex items-center justify-between transition-colors`}
                    >
                      <div>
                        <div className="text-sm font-medium">
                          {c.quality_metric.replace(/_/g, ' ')} → {c.business_kpi.replace(/_/g, ' ')}
                        </div>
                        <div className={`text-xs ${
                          isDark ? 'text-slate-400' : 'text-slate-600'
                        }`}>
                          {c.sample_size} data points • {c.correlation_strength}
                          {c.is_significant && <span className="ml-1 text-green-400">• significant</span>}
                        </div>
                      </div>
                      <div className={`text-xl font-bold ${getCorrelationColor(c.pearson_correlation)}`}>
                        {c.pearson_correlation > 0 ? '+' : ''}{Number(c.pearson_correlation).toFixed(3)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Metric Explanations */}
            <div className={`rounded-xl p-4 sm:p-6 border transition-colors duration-300 ${
              isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
            }`}>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Info className={isDark ? 'text-cyan-400' : 'text-cyan-600'} size={20} />
                Quality Metrics & Business KPIs Explained
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Quality Metrics */}
                <div>
                  <h4 className="text-sm font-semibold mb-3 text-blue-500">Quality Metrics (X Variables)</h4>
                  <div className="space-y-3">
                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">Test Coverage %</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Percentage of code covered by automated tests. Higher coverage indicates better quality assurance and fewer production defects.
                      </div>
                    </div>

                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">Defect Density</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Number of bugs per thousand lines of code (KLOC). Lower density indicates higher code quality and fewer defects.
                      </div>
                    </div>

                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">Defect Escape Rate %</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Percentage of bugs that reach production undetected. Lower rates indicate better testing effectiveness.
                      </div>
                    </div>

                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">MTTR (Mean Time to Restore)</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Average time in hours to restore service after an incident. Lower MTTR indicates better operational efficiency.
                      </div>
                    </div>

                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">Deployment Frequency</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Number of deployments per month. Higher frequency indicates better DevOps practices and faster delivery.
                      </div>
                    </div>

                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">Lead Time</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Time in days from code commit to production deployment. Shorter lead times indicate better engineering efficiency.
                      </div>
                    </div>

                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">Code Quality Score</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Overall code quality assessment (0-100). Higher scores indicate better maintainability and fewer technical issues.
                      </div>
                    </div>

                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">Change Failure Rate %</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Percentage of deployments that fail or require immediate fixes. Lower rates indicate more reliable deployments.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Business KPIs */}
                <div>
                  <h4 className="text-sm font-semibold mb-3 text-green-500">Business KPIs (Y Variables)</h4>
                  <div className="space-y-3">
                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">Monthly Revenue</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Total revenue generated per month in dollars. Primary measure of business growth and financial performance.
                      </div>
                    </div>

                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">Active Users</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Number of monthly active users. Indicates product adoption and user engagement levels.
                      </div>
                    </div>

                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">Churn Rate %</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Percentage of customers who stop using the service. Lower rates indicate better customer retention.
                      </div>
                    </div>

                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">Feature Adoption Rate %</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Percentage of users who adopt new features. Higher rates indicate better product-market fit.
                      </div>
                    </div>

                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">NPS Score</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Net Promoter Score (-100 to +100). Measures customer loyalty and likelihood to recommend.
                      </div>
                    </div>

                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">CSAT Score %</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Customer Satisfaction Score (0-100%). Measures customer happiness with recent interactions.
                      </div>
                    </div>

                    <div className={`p-3 rounded-lg border transition-colors ${
                      isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="font-medium text-sm mb-1">Support Ticket Volume</div>
                      <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Number of customer support tickets per month. Lower volumes indicate better product quality.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className={`mt-4 p-3 rounded-lg border transition-colors ${
                isDark ? 'border-amber-600 bg-amber-900/20' : 'border-amber-200 bg-amber-50'
              }`}>
                <div className="flex items-start gap-2">
                  <Info className={`mt-0.5 flex-shrink-0 ${
                    isDark ? 'text-amber-400' : 'text-amber-600'
                  }`} size={16} />
                  <div>
                    <p className={`text-sm font-medium mb-1 ${
                      isDark ? 'text-amber-300' : 'text-amber-800'
                    }`}>
                      Understanding Correlations
                    </p>
                    <p className={`text-sm ${
                      isDark ? 'text-slate-400' : 'text-slate-600'
                    }`}>
                      Strong positive correlations (red +1.000) indicate quality improvements strongly drive business outcomes.
                      Strong negative correlations (red -1.000) show quality issues severely impact business results.
                      Realistic correlations typically range from 0.3 to 0.8 in software development.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'data-entry' && (
          <div className="space-y-4">
            {/* Action Buttons */}
            <div className="flex justify-between items-center">
              <div className={`flex items-center gap-2 ${
                isDark ? 'text-slate-400' : 'text-slate-600'
              }`}>
                <Info size={16} />
                <span className="text-sm">Data is generated automatically on page load with realistic correlations</span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={saveData}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                  Save Current Data
                </button>
                <button
                  onClick={regenerateData}
                  disabled={seeding}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {seeding ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                  Regenerate Data
                </button>
              </div>
            </div>

            {/* Monthly Data Entry */}
            {monthlyData.map((month, idx) => {
              const isExpanded = expandedMonths.has(month.month_year);
              const hasQuality = Object.values(month.quality).some(v => v !== null);
              const hasKpis = Object.values(month.kpis).some(v => v !== null);
              
              return (
                <div key={month.month_year} className={`rounded-xl border overflow-hidden transition-colors duration-300 ${
                  isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
                }`}>
                  {/* Month Header */}
                  <button
                    onClick={() => toggleMonth(month.month_year)}
                    className={`w-full px-6 py-4 flex items-center justify-between transition-colors ${
                      isDark ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-lg font-medium">{formatMonth(month.month_year)}</span>
                      <div className="flex gap-2">
                        {hasQuality && (
                          <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded">Quality ✓</span>
                        )}
                        {hasKpis && (
                          <span className="px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">KPIs ✓</span>
                        )}
                        {hasQuality && hasKpis && (
                          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded">Paired</span>
                        )}
                      </div>
                    </div>
                    {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                  </button>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="px-6 pb-6 space-y-6">
                      {/* Quality Metrics */}
                      <div>
                        <h4 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${
                          isDark ? 'text-blue-400' : 'text-blue-600'
                        }`}>
                          <BarChart3 size={16} />
                          Quality Metrics (X Variables)
                        </h4>
                        <div className="grid grid-cols-4 gap-3">
                          {QUALITY_METRICS.map(metric => (
                            <div key={metric.key}>
                              <label className={`block text-xs mb-1 ${
                                isDark ? 'text-slate-400' : 'text-slate-600'
                              }`}>
                                {metric.label} {metric.unit && <span className="text-slate-500">({metric.unit})</span>}
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={month.quality[metric.key] ?? ''}
                                onChange={(e) => updateMetric(month.month_year, 'quality', metric.key, e.target.value)}
                                placeholder={metric.description}
                                className={`w-full rounded px-3 py-2 text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                                  isDark
                                    ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500'
                                    : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-500'
                                }`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Business KPIs */}
                      <div>
                        <h4 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${
                          isDark ? 'text-green-400' : 'text-green-600'
                        }`}>
                          <DollarSign size={16} />
                          Business KPIs (Y Variables)
                        </h4>
                        <div className="grid grid-cols-4 gap-3">
                          {BUSINESS_KPIS.map(kpi => (
                            <div key={kpi.key}>
                              <label className={`block text-xs mb-1 ${
                                isDark ? 'text-slate-400' : 'text-slate-600'
                              }`}>
                                {kpi.label} {kpi.unit && <span className="text-slate-500">({kpi.unit})</span>}
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={month.kpis[kpi.key] ?? ''}
                                onChange={(e) => updateMetric(month.month_year, 'kpis', kpi.key, e.target.value)}
                                placeholder={kpi.description}
                                className={`w-full rounded px-3 py-2 text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-green-500/20 ${
                                  isDark
                                    ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-green-500'
                                    : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-green-500'
                                }`}
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Context/Normalization */}
                      <div>
                        <h4 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${
                          isDark ? 'text-purple-400' : 'text-purple-600'
                        }`}>
                          <Target size={16} />
                          Context / Normalization (Optional)
                        </h4>
                        <div className="grid grid-cols-6 gap-3">
                          {CONTEXT_FIELDS.map(field => (
                            <div key={field.key}>
                              <label className={`block text-xs mb-1 ${
                                isDark ? 'text-slate-400' : 'text-slate-600'
                              }`}>
                                {field.label}
                              </label>
                              {field.key === 'is_holiday_season' ? (
                                <select
                                  value={month.context[field.key] ? 'true' : 'false'}
                                  onChange={(e) => updateMetric(month.month_year, 'context', field.key, e.target.value)}
                                  className={`w-full rounded px-3 py-2 text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/20 ${
                                    isDark
                                      ? 'bg-slate-800 border-slate-700 text-white focus:border-purple-500'
                                      : 'bg-white border-slate-300 text-slate-900 focus:border-purple-500'
                                  }`}
                                >
                                  <option value="false">No</option>
                                  <option value="true">Yes</option>
                                </select>
                              ) : (
                                <input
                                  type="number"
                                  step="0.01"
                                  value={month.context[field.key] as number ?? ''}
                                  onChange={(e) => updateMetric(month.month_year, 'context', field.key, e.target.value)}
                                  placeholder={field.description}
                                  className={`w-full rounded px-3 py-2 text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/20 ${
                                    isDark
                                      ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:border-purple-500'
                                      : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-purple-500'
                                  }`}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Correlations Tab */}
        {activeTab === 'correlations' && (
          <div className="space-y-4 sm:space-y-6">
            {/* Correlation Matrix */}
            <div className={`rounded-xl p-4 sm:p-6 border transition-colors duration-300 ${
              isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
            }`}>
              <h3 className="text-lg font-semibold mb-4">Correlation Matrix</h3>
              
              {correlations.length === 0 ? (
                <div className={`text-center py-8 sm:py-12 ${
                  isDark ? 'text-slate-400' : 'text-slate-600'
                }`}>
                  <Calculator size={48} className="mx-auto mb-4 opacity-50" />
                  <p>No correlations calculated yet.</p>
                  <p className="text-sm mt-2">Enter at least 6 months of paired data and click "Calculate Correlations"</p>
                </div>
              ) : (
                <div className="overflow-x-auto -mx-4 sm:-mx-6">
                  <div className="inline-block min-w-full align-middle px-4 sm:px-6">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className={`border-b ${
                          isDark ? 'border-slate-700' : 'border-slate-300'
                        }`}>
                          <th className="text-left py-3 px-3 font-medium">Quality Metric</th>
                          <th className="text-left py-3 px-3 font-medium">Business KPI</th>
                          <th className="text-center py-3 px-3 font-medium">Correlation (r)</th>
                          <th className="text-center py-3 px-3 font-medium">p-value</th>
                          <th className="text-center py-3 px-3 font-medium">Strength</th>
                          <th className="text-center py-3 px-3 font-medium">Samples</th>
                          <th className="text-center py-3 px-3 font-medium">Significant</th>
                        </tr>
                      </thead>
                      <tbody>
                        {correlations.map((c, i) => (
                          <tr key={i} className={`border-b transition-colors ${
                            isDark 
                              ? 'border-slate-800 hover:bg-slate-800/50' 
                              : 'border-slate-200 hover:bg-slate-50'
                          }`}>
                            <td className="py-3 px-3 font-medium">{c.quality_metric.replace(/_/g, ' ')}</td>
                            <td className="py-3 px-3">{c.business_kpi.replace(/_/g, ' ')}</td>
                            <td className={`py-3 px-3 text-center font-bold ${getCorrelationColor(c.pearson_correlation)}`}>
                              {c.pearson_correlation > 0 ? '+' : ''}{Number(c.pearson_correlation).toFixed(3)}
                            </td>
                            <td className={`py-3 px-3 text-center ${
                              isDark ? 'text-slate-400' : 'text-slate-600'
                            }`}>
                              {Number(c.p_value) < 0.001 ? '<0.001' : Number(c.p_value).toFixed(4)}
                            </td>
                            <td className="py-3 px-3 text-center">
                              <span className={`px-2 py-0.5 rounded text-xs ${
                                c.correlation_strength === 'strong' ? 'bg-green-500/20 text-green-400' :
                                c.correlation_strength === 'moderate' ? 'bg-blue-500/20 text-blue-400' :
                                c.correlation_strength === 'weak' ? 'bg-yellow-500/20 text-yellow-400' :
                                'bg-slate-500/20 text-slate-400'
                              }`}>
                                {c.correlation_strength}
                              </span>
                            </td>
                            <td className={`py-3 px-3 text-center ${
                              isDark ? 'text-slate-400' : 'text-slate-600'
                            }`}>{c.sample_size}</td>
                            <td className="py-3 px-3 text-center">
                              {c.is_significant ? (
                                <CheckCircle className="inline text-green-500" size={16} />
                              ) : (
                                <XCircle className="inline text-slate-500" size={16} />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* AI Analysis Button */}
            {correlations.length > 0 && (
              <div className="flex justify-center">
                <button
                  onClick={analyzeCorrelationsWithAI}
                  disabled={aiAnalyzing}
                  className={`flex items-center gap-2 px-6 py-3 rounded-lg transition-all disabled:opacity-50 ${
                    isDark
                      ? 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700 hover:border-slate-600'
                      : 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 hover:border-slate-400'
                  }`}
                >
                  {aiAnalyzing ? <Loader2 className="animate-spin" size={20} /> : <BarChart3 size={20} />}
                  {aiAnalyzing ? 'Analyzing...' : 'Analyze with AI'}
                </button>
              </div>
            )}

            {/* AI Analysis Results */}
            {aiAnalysis && (
              <div className={`rounded-xl p-4 sm:p-6 border transition-colors duration-300 ${
                isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
              }`}>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <BarChart3 className={isDark ? 'text-purple-400' : 'text-purple-600'} size={20} />
                  AI Business Impact Analysis
                </h3>
                
                {/* AI Response - Formatted */}
                <div className={`text-sm leading-relaxed ${
                  isDark ? 'text-slate-300' : 'text-slate-700'
                }`}>
                  <MarkdownRenderer content={aiAnalysis} isDark={isDark} />
                </div>
              </div>
            )}

            {/* Interpretation Guide */}
            <div className={`rounded-xl p-4 sm:p-6 border transition-colors duration-300 ${
              isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'
            }`}>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Info className={isDark ? 'text-cyan-400' : 'text-cyan-600'} size={20} />
                Interpretation Guide
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
                <div>
                  <h4 className="font-medium mb-2">Correlation Strength</h4>
                  <ul className={`space-y-1 ${
                    isDark ? 'text-slate-400' : 'text-slate-600'
                  }`}>
                    <li><span className="text-green-400">|r| ≥ 0.7</span> — Strong correlation</li>
                    <li><span className="text-blue-400">0.5 ≤ |r| &lt; 0.7</span> — Moderate correlation</li>
                    <li><span className="text-yellow-400">0.3 ≤ |r| &lt; 0.5</span> — Weak correlation</li>
                    <li><span className="text-slate-400">|r| &lt; 0.3</span> — No meaningful correlation</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Statistical Significance</h4>
                  <ul className={`space-y-1 ${
                    isDark ? 'text-slate-400' : 'text-slate-600'
                  }`}>
                    <li><span className="text-green-400">p &lt; 0.05</span> — Statistically significant</li>
                    <li><span className="text-slate-400">p ≥ 0.05</span> — Not significant (may be due to chance)</li>
                    <li className="mt-2">
                      <span className="text-cyan-400">Note:</span> Correlation ≠ Causation. Strong correlations suggest
                      relationships but don't prove one metric causes changes in another.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BusinessImpactAnalysisV2;
