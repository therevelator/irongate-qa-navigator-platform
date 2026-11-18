import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Save, ChevronDown, ChevronRight, Calculator, Sparkles } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import DOMPurify from 'dompurify';
import { API_URL } from '../config/api';
import { toast } from 'react-hot-toast';
import { useTheme } from '../contexts/ThemeContext';
import { useAnalyticsScope } from '../contexts/AnalyticsScopeContext';
import ExportCsvButton from './ExportCsvButton';
import { useAuth } from '../contexts/AuthContext';
import { useShowFormulas } from '../hooks/useShowFormulas';
import { FormulaSwitch } from './FormulaNote';
import { policyActorOf } from '../lib/policyActor';
import { canViewRevenueRollup, canUseFormulaMode } from '../../server/lib/userPolicy';
import {
  RevenueMoneyView, RevenueWhatIf, RevenueSensitivityTable, RevenueRollupView, RevenueLoadState, Section, useRevenueImpact,
} from './RevenueImpact';
import { Page, PageIntro, Card, CardHeader, Badge, StatTile, EmptyState, SegmentedControl, buttonClass, inputClass, cx } from './ui';

// Renders the AI response (HTML produced by the LLM). Treated as untrusted: sanitized before rendering.
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
  const safeContent = DOMPurify.sanitize(content, { USE_PROFILES: { html: true } });
  const styledContent = safeContent
    .replace(/<table>/g, '<table class="w-full border-collapse my-4 text-sm">')
    .replace(/<th>/g, '<th class="border border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-left font-semibold">')
    .replace(/<td>/g, '<td class="border border-slate-300 dark:border-slate-700 px-3 py-2">')
    .replace(/<h2>/g, '<h2 class="text-base font-semibold mt-4 mb-2 text-slate-900 dark:text-white">')
    .replace(/<h3>/g, '<h3 class="text-sm font-semibold mt-3 mb-1 text-slate-800 dark:text-slate-100">')
    .replace(/<ul>/g, '<ul class="list-disc list-inside my-2 space-y-1 ml-4">')
    .replace(/<li>/g, '<li class="leading-relaxed">')
    .replace(/<p>/g, '<p class="my-2 leading-relaxed">')
    .replace(/<strong>/g, '<strong class="font-semibold">')
    .replace(/class="positive"/g, 'class="font-medium"')
    .replace(/class="negative"/g, 'class="font-medium"');
  return <div className="ai-html-content" dangerouslySetInnerHTML={{ __html: styledContent }} />;
};

interface BusinessImpactAnalysisV2Props {
  onBack?: () => void;
  teamId?: string;
}

const QUALITY_METRICS = [
  { key: 'test_coverage', label: 'Test coverage', unit: '%', description: 'Share of code covered by automated tests' },
  { key: 'defect_density', label: 'Defect density', unit: '/KLOC', description: 'Defects per thousand lines of code' },
  { key: 'defect_escape_rate', label: 'Defect escape rate', unit: '%', description: 'Share of defects found in production' },
  { key: 'mttr_hours', label: 'MTTR', unit: 'h', description: 'Mean time to restore service' },
  { key: 'deployment_frequency', label: 'Deploy frequency', unit: '/mo', description: 'Deployments per month' },
  { key: 'lead_time_days', label: 'Lead time', unit: 'days', description: 'Commit to production' },
  { key: 'code_quality_score', label: 'Code quality', unit: '%', description: 'Code quality score (0–100)' },
  { key: 'change_failure_rate', label: 'Change failure rate', unit: '%', description: 'Share of deployments that fail' },
];

const BUSINESS_KPIS = [
  { key: 'monthly_revenue', label: 'Monthly revenue', unit: '$', description: 'Total monthly revenue' },
  { key: 'active_users', label: 'Active users', unit: '', description: 'Monthly active users' },
  { key: 'churn_rate', label: 'Churn rate', unit: '%', description: 'Customer churn' },
  { key: 'feature_adoption_rate', label: 'Feature adoption', unit: '%', description: 'Share of users using new features' },
  { key: 'nps_score', label: 'NPS', unit: '', description: 'Net Promoter Score (−100 to 100)' },
  { key: 'csat_score', label: 'CSAT', unit: '%', description: 'Customer satisfaction score' },
  { key: 'support_ticket_volume', label: 'Support tickets', unit: '', description: 'Tickets per month' },
];

const CONTEXT_FIELDS = [
  { key: 'team_size', label: 'Team size' },
  { key: 'feature_release_count', label: 'Features released' },
  { key: 'total_user_base', label: 'Total users' },
  { key: 'user_growth_rate', label: 'User growth (%)' },
  { key: 'downtime_minutes', label: 'Downtime (min)' },
  { key: 'is_holiday_season', label: 'Holiday season' },
];

const LABELS: Record<string, string> = Object.fromEntries([...QUALITY_METRICS, ...BUSINESS_KPIS].map(m => [m.key, m.label]));
const labelOf = (k: string) => LABELS[k] ?? k.replace(/_/g, ' ');

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
  p_value: number | null;
  q_value?: number | null;
  p_adjusted?: number | null;
  sample_size: number;
  correlation_strength: string;
  is_significant: boolean;
  start_month?: string | null;
  end_month?: string | null;
  calculated_at?: string | null;
}

interface DataSummary {
  monthsWithQualityData: number;
  monthsWithKpiData: number;
  monthsWithPairedData: number;
  isCorrelationReady: boolean;
  correlationsTested?: number;
  pairsSkippedZeroVariance?: number;
  earliestMonth: string | null;
  latestMonth: string | null;
}

interface CorrelationMethod {
  coefficient?: string;
  test?: string;
  multipleComparison?: string;
  significance?: string;
  minimumPairedMonths?: number;
  caveat?: string;
}

const MIN_PAIRED_MONTHS = 6;
const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const qOf = (c: Correlation): number | null => num(c.q_value ?? c.p_adjusted ?? null);
const fmtP = (p: number | null) => (p == null ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3));
const fmtR = (r: number) => `${r > 0 ? '+' : ''}${Number(r).toFixed(3)}`;
const formatMonth = (monthYear: string) => {
  const [year, month] = monthYear.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(month, 10) - 1] ?? month} ${year}`;
};

/** Months to show: every month with stored data, plus the last 12 calendar months for data entry. */
const buildMonthList = (dataMonths: string[]) => {
  const set = new Set(dataMonths);
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return Array.from(set).sort();
};

const toMonthly = (data: any): MonthlyData[] => {
  const dataMonths = [
    ...(data?.qualityMetrics ?? []).map((q: any) => q.month_year),
    ...(data?.businessKpis ?? []).map((k: any) => k.month_year),
    ...(data?.contextData ?? []).map((c: any) => c.month_year),
  ].filter(Boolean);
  return buildMonthList(dataMonths).map(month => {
    const quality = data?.qualityMetrics?.find((q: any) => q.month_year === month) || {};
    const kpis = data?.businessKpis?.find((k: any) => k.month_year === month) || {};
    const context = data?.contextData?.find((c: any) => c.month_year === month) || {};
    return {
      month_year: month,
      quality: Object.fromEntries(QUALITY_METRICS.map(m => [m.key, num(quality[m.key])])),
      kpis: Object.fromEntries(BUSINESS_KPIS.map(k => [k.key, num(kpis[k.key])])),
      context: {
        team_size: num(context.team_size),
        feature_release_count: num(context.feature_release_count),
        total_user_base: num(context.total_user_base),
        user_growth_rate: num(context.user_growth_rate),
        downtime_minutes: num(context.downtime_minutes),
        is_holiday_season: context.is_holiday_season ?? false,
      },
    };
  });
};

type Tab = 'money' | 'what-if' | 'details' | 'all-teams' | 'data-entry';

const BusinessImpactAnalysisV2: React.FC<BusinessImpactAnalysisV2Props> = ({ teamId: propTeamId }) => {
  // Data entry and recalculation are team writes (canWriteTeamData, server/lib/userPolicy.ts):
  // hidden for roles that can only read the team's analytics.
  const scope = useAnalyticsScope();
  const canWrite = scope.canWriteTeam;
  const { isDark } = useTheme();
  const { user } = useAuth();
  // "Show formulas & data sources" (super admin demo aid, same preference as Team detail).
  const [showFormulasPref, setShowFormulas] = useShowFormulas();
  const canShowFormulas = !!user && canUseFormulaMode(policyActorOf(user));
  const showFormulas = canShowFormulas && showFormulasPref;
  // Company / department roll-up: super admins and QA managers (canViewRevenueRollup).
  const canRollup = !!user && canViewRevenueRollup(policyActorOf(user));
  const [activeTab, setActiveTab] = useState<Tab>('money');
  const tabOptions: { value: Tab; label: string }[] = [
    { value: 'money', label: 'Money' },
    { value: 'what-if', label: 'What-if' },
    { value: 'details', label: 'Details' },
    ...(canRollup ? [{ value: 'all-teams' as Tab, label: 'All teams' }] : []),
    ...(canWrite ? [{ value: 'data-entry' as Tab, label: 'Data entry' }] : []),
  ];
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string>('');

  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>(propTeamId || '');
  const useTeamSelector = !propTeamId;
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [correlations, setCorrelations] = useState<Correlation[]>([]);
  const [dataSummary, setDataSummary] = useState<DataSummary | null>(null);
  const [method, setMethod] = useState<CorrelationMethod | null>(null);
  const [lastStoredAt, setLastStoredAt] = useState<string | null>(null);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  useEffect(() => { if (propTeamId) setSelectedTeamId(propTeamId); }, [propTeamId]);

  useEffect(() => {
    if (!useTeamSelector) return;
    (async () => {
      try {
        const response = await fetch(`${API_URL}/teams`, { credentials: 'include' });
        if (response.ok) {
          const data = await response.json();
          const loadedTeams = Array.isArray(data) ? data : (data.teams || []);
          setTeams(loadedTeams);
          if (loadedTeams.length > 0) setSelectedTeamId(prev => prev || loadedTeams[0].id);
          else setLoading(false);
        } else {
          setLoading(false);
        }
      } catch (error) {
        console.error('Error fetching teams:', error);
        setLoading(false);
      }
    })();
  }, [useTeamSelector]);

  const fetchData = useCallback(async (teamId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/analytics/business-impact-v2/${teamId}`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setMonthlyData(toMonthly(data));
        setCorrelations(data.correlations || []);
        setDataSummary(data.summary || null);
        setMethod(data.correlationMethod || null);
        setLastStoredAt(data.dataStatus?.last_validated_at ?? null);
      } else {
        const err = await response.json().catch(() => null);
        if (response.status !== 404) toast.error(err?.error || 'Failed to load data');
        setMonthlyData(toMonthly(null));
        setCorrelations([]);
        setDataSummary(null);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load business impact data');
      setMonthlyData(toMonthly(null));
      setCorrelations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedTeamId) return;
    setAiAnalysis('');
    fetchData(selectedTeamId);
  }, [selectedTeamId, fetchData]);

  const revenue = useRevenueImpact(selectedTeamId || null, reloadKey);

  const updateMetric = (monthYear: string, category: 'quality' | 'kpis' | 'context', key: string, value: string) => {
    setMonthlyData(prev => prev.map(m => {
      if (m.month_year !== monthYear) return m;
      const parsed = value === '' ? null : (key === 'is_holiday_season' ? value === 'true' : parseFloat(value));
      return { ...m, [category]: { ...m[category], [key]: parsed } };
    }));
  };

  const saveData = async () => {
    if (!selectedTeamId) { toast.error('Please select a team first'); return; }
    setSaving(true);
    try {
      const dataToSave = monthlyData.filter(m =>
        Object.values(m.quality).some(v => v !== null) ||
        Object.values(m.kpis).some(v => v !== null) ||
        Object.values(m.context).some(v => v !== null && v !== false));
      const response = await fetch(`${API_URL}/analytics/business-impact-v2/${selectedTeamId}/bulk-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ monthlyData: dataToSave }),
      });
      if (response.ok) {
        const result = await response.json();
        toast.success(`Saved data for ${result.monthsSaved} months`);
        await fetchData(selectedTeamId);
        setReloadKey(k => k + 1);
      } else {
        const err = await response.json().catch(() => null);
        toast.error(err?.error || 'Failed to save data');
      }
    } catch (error) {
      console.error('Error saving:', error);
      toast.error('Failed to save data');
    } finally {
      setSaving(false);
    }
  };

  const calculateCorrelations = async () => {
    if (!selectedTeamId) { toast.error('Please select a team first'); return; }
    setCalculating(true);
    try {
      const response = await fetch(`${API_URL}/analytics/business-impact-v2/${selectedTeamId}/calculate-correlations`, {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        const result = await response.json();
        toast.success(`Calculated ${result.correlationsCalculated} correlations from ${result.pairedMonths} paired months`);
        await fetchData(selectedTeamId);
      } else {
        const err = await response.json().catch(() => null);
        toast.error(err?.error || 'Failed to calculate correlations');
      }
    } catch (error) {
      console.error('Error calculating:', error);
      toast.error('Failed to calculate correlations');
    } finally {
      setCalculating(false);
    }
  };

  const analyzeCorrelationsWithAI = async () => {
    if (correlations.length === 0 || !selectedTeamId) return;
    setAiAnalyzing(true);
    try {
      const response = await fetch(`${API_URL}/analytics/business-impact-v2/${selectedTeamId}/ai-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (response.ok) {
        const data = await response.json();
        setAiAnalysis(data.analysis || '');
      } else {
        const err = await response.json().catch(() => null);
        toast.error(err?.error || 'Failed to analyze correlations');
      }
    } catch (error) {
      console.error('Error in AI analysis:', error);
      toast.error('Failed to analyze correlations');
    } finally {
      setAiAnalyzing(false);
    }
  };

  const toggleMonth = (month: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month); else next.add(month);
      return next;
    });
  };

  const sortedCorrelations = useMemo(
    () => [...correlations].sort((a, b) => Math.abs(Number(b.pearson_correlation)) - Math.abs(Number(a.pearson_correlation))),
    [correlations],
  );
  const significantCount = correlations.filter(c => c.is_significant).length;
  const hasQ = correlations.some(c => qOf(c) != null);
  const strongest = sortedCorrelations[0] ?? null;
  const calculatedAt = correlations.find(c => c.calculated_at)?.calculated_at ?? null;
  const paired = dataSummary?.monthsWithPairedData ?? 0;
  const tested = dataSummary?.correlationsTested ?? correlations.length;
  const sampleRange = (() => {
    const ns = correlations.map(c => c.sample_size).filter(n => n != null);
    if (!ns.length) return null;
    const lo = Math.min(...ns), hi = Math.max(...ns);
    return lo === hi ? `n = ${lo}` : `n = ${lo}–${hi}`;
  })();

  const chartData = monthlyData
    .filter(m => m.quality.test_coverage != null || m.kpis.nps_score != null || m.kpis.churn_rate != null)
    .map(m => ({
      month: formatMonth(m.month_year),
      test_coverage: m.quality.test_coverage,
      nps_score: m.kpis.nps_score,
      churn_rate: m.kpis.churn_rate,
    }));

  const c = {
    grid: isDark ? '#1e293b' : '#e2e8f0',
    axis: isDark ? '#94a3b8' : '#64748b',
    s1: isDark ? '#79a4dc' : '#3567a5',
    s2: isDark ? '#cbd5e1' : '#475569',
    s3: isDark ? '#fbbf24' : '#b45309',
    tooltip: {
      backgroundColor: isDark ? '#0f172a' : '#ffffff',
      border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
      borderRadius: 6,
      color: isDark ? '#f1f5f9' : '#0f172a',
      fontSize: 12,
    },
  };

  const calcButton = (
    <button onClick={calculateCorrelations} disabled={calculating || !selectedTeamId} className={cx(buttonClass.secondary, 'disabled:opacity-50')}>
      {calculating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
      Calculate correlations
    </button>
  );

  const calculatedNote = calculatedAt
    ? `Calculated ${new Date(calculatedAt).toLocaleString()} from the stored monthly data${lastStoredAt ? `; last saved run ${new Date(lastStoredAt).toLocaleString()}` : ''}.`
    : 'Not yet calculated.';

  return (
    <Page>
      <PageIntro
        title="Business impact"
        description="Where quality costs money today, what fixing it is worth, and where to start. Figures come from the team's own data; quality links are associations, not causes."
        actions={
          <>
            {canShowFormulas && <FormulaSwitch checked={showFormulasPref} onChange={setShowFormulas} />}
            {useTeamSelector && (
              <select aria-label="Team" value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)} className={inputClass}>
                <option value="">Select team</option>
                {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            )}
            {/* Phones: a select (five tabs do not fit 390px without scrolling sideways); wider: the segmented control. */}
            <select
              aria-label="Business impact view"
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value as Tab)}
              className={cx(inputClass, 'sm:hidden')}
            >
              {tabOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div className="hidden sm:block">
              <SegmentedControl value={activeTab} onChange={setActiveTab} options={tabOptions} />
            </div>
          </>
        }
      />

      {loading ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading business impact data…
          </div>
        </Card>
      ) : !selectedTeamId ? (
        <Card><EmptyState title="No team selected" description="Select a team to view its business impact data." /></Card>
      ) : (
        <>
          {activeTab === 'money' && (revenue.data ? <RevenueMoneyView data={revenue.data} showFormulas={showFormulas} /> : <RevenueLoadState loading={revenue.loading} error={revenue.error} />)}
          {activeTab === 'what-if' && (revenue.data ? <RevenueWhatIf data={revenue.data} showFormulas={showFormulas} /> : <RevenueLoadState loading={revenue.loading} error={revenue.error} />)}
          {activeTab === 'all-teams' && canRollup && <RevenueRollupView departments={scope.departments} showFormulas={showFormulas} />}

          {(activeTab === 'details' || activeTab === 'data-entry') && (
          <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              <span className="font-medium text-slate-900 dark:text-white">{paired}</span> months with both quality and KPI data (minimum {method?.minimumPairedMonths ?? MIN_PAIRED_MONTHS})
            </span>
            <span>
              <span className="font-medium text-slate-900 dark:text-white">{dataSummary?.monthsWithQualityData ?? 0}</span> quality months,{' '}
              <span className="font-medium text-slate-900 dark:text-white">{dataSummary?.monthsWithKpiData ?? 0}</span> KPI months
            </span>
            {dataSummary?.earliestMonth && dataSummary?.latestMonth && (
              <span>Data range {formatMonth(dataSummary.earliestMonth)} – {formatMonth(dataSummary.latestMonth)}</span>
            )}
          </div>
          )}

          {activeTab === 'details' && (
            <div className="space-y-3" data-testid="business-details">
              <Section title="How sure are we? Revenue per metric" subtitle="$ per month associated with each quality metric, with the range, months used and the statistics" testId="details-sensitivity">
                {revenue.data ? <RevenueSensitivityTable data={revenue.data} /> : <RevenueLoadState loading={revenue.loading} error={revenue.error} />}
              </Section>
              <Section title="Monthly trends" subtitle="Test coverage, NPS and churn by month">
                <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile
                  label="Strongest correlation"
                  value={strongest ? fmtR(Number(strongest.pearson_correlation)) : '—'}
                  caption={strongest ? `${labelOf(strongest.quality_metric)} and ${labelOf(strongest.business_kpi)}${strongest.is_significant ? '' : ' (not significant)'}` : 'No correlations calculated'}
                />
                <StatTile
                  label="Significant pairs"
                  value={correlations.length ? `${significantCount} of ${tested}` : '—'}
                  caption={hasQ ? 'q < 0.05 after Benjamini–Hochberg correction' : 'p < 0.05, uncorrected (exploratory)'}
                />
                <StatTile label="Paired months" value={paired} caption={sampleRange ? `Per-pair sample sizes ${sampleRange}` : undefined} />
                <StatTile
                  label="Ready to calculate"
                  value={paired >= (method?.minimumPairedMonths ?? MIN_PAIRED_MONTHS) ? 'Yes' : 'No'}
                  tone={paired >= (method?.minimumPairedMonths ?? MIN_PAIRED_MONTHS) ? 'good' : 'neutral'}
                  caption={paired >= (method?.minimumPairedMonths ?? MIN_PAIRED_MONTHS) ? undefined : `Needs ${(method?.minimumPairedMonths ?? MIN_PAIRED_MONTHS) - paired} more paired months`}
                />
              </div>

              <Card>
                <CardHeader title="Test coverage, NPS and churn by month" subtitle="Stored monthly values; gaps mean no value was recorded" />
                {chartData.length === 0 ? (
                  <EmptyState title="No monthly data recorded" description="Enter monthly quality metrics and business KPIs in the Data entry tab." />
                ) : (
                  <div className="h-64 sm:h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: c.axis }} stroke={c.grid} />
                        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: c.axis }} stroke={c.grid} />
                        <YAxis yAxisId="right" orientation="right" unit="%" tick={{ fontSize: 11, fill: c.axis }} stroke={c.grid} />
                        <Tooltip contentStyle={c.tooltip} labelStyle={{ color: c.tooltip.color }} />
                        <Legend wrapperStyle={{ fontSize: 12, color: c.axis }} />
                        <Line yAxisId="left" type="linear" dataKey="test_coverage" stroke={c.s1} name="Test coverage %" dot={false} isAnimationActive={false} />
                        <Line yAxisId="left" type="linear" dataKey="nps_score" stroke={c.s2} name="NPS" dot={false} isAnimationActive={false} />
                        <Line yAxisId="right" type="linear" dataKey="churn_rate" stroke={c.s3} name="Churn rate %" dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>

                </div>
              </Section>
              <Section title="Correlations between quality and business KPIs" subtitle="Strongest pairs, the full matrix, an optional AI summary and how to read them">
                <div className="space-y-6">
              <Card>
                <CardHeader title="Strongest correlations" subtitle={calculatedNote} action={canWrite ? calcButton : undefined} />
                {sortedCorrelations.length === 0 ? (
                  <EmptyState
                    title="No correlations calculated"
                    description={`Correlations need at least ${method?.minimumPairedMonths ?? MIN_PAIRED_MONTHS} months with both a quality metric and a business KPI recorded.`}
                  />
                ) : (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {sortedCorrelations.slice(0, 10).map(cr => (
                      <CorrelationTile key={`${cr.quality_metric}:${cr.business_kpi}`} c={cr} />
                    ))}
                  </div>
                )}
              </Card>

              <Card padded={false}>
                <div className="px-5 pt-5">
                  <CardHeader
                    title="Correlation matrix"
                    subtitle={`${calculatedNote} Exploratory: ${tested} pairs tested${sampleRange ? `, ${sampleRange} months each` : ''}.`}
                    action={
                      <div className="flex flex-wrap items-center gap-2">
                        <ExportCsvButton
                          what="Business impact correlations"
                          compact
                          rows={sortedCorrelations}
                          columns={[
                            { header: 'Quality metric', value: (cr) => labelOf(cr.quality_metric) },
                            { header: 'Business KPI', value: (cr) => labelOf(cr.business_kpi) },
                            { header: 'r', value: (cr) => fmtR(Number(cr.pearson_correlation)), raw: (cr) => Number(cr.pearson_correlation) },
                            { header: 'p', value: (cr) => fmtP(num(cr.p_value)), raw: (cr) => num(cr.p_value) },
                            { header: 'q (BH-FDR)', value: (cr) => fmtP(qOf(cr)), raw: (cr) => qOf(cr) },
                            { header: 'Strength', value: (cr) => cr.correlation_strength },
                            { header: 'n', value: (cr) => cr.sample_size },
                            { header: 'Significant', value: (cr) => (cr.is_significant ? 'yes' : 'no') },
                          ]}
                        />
                        {canWrite ? calcButton : null}
                      </div>
                    }
                  />
                </div>
                {sortedCorrelations.length === 0 ? (
                  <EmptyState
                    title="No correlations calculated"
                    description={`Enter at least ${method?.minimumPairedMonths ?? MIN_PAIRED_MONTHS} months of paired data, save, then calculate.`}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-y border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                          <th className="px-5 py-2 text-left font-medium">Quality metric</th>
                          <th className="px-3 py-2 text-left font-medium">Business KPI</th>
                          <th className="px-3 py-2 text-right font-medium">r</th>
                          <th className="px-3 py-2 text-right font-medium">p</th>
                          {hasQ && <th className="px-3 py-2 text-right font-medium">q (BH-FDR)</th>}
                          <th className="px-3 py-2 text-left font-medium">Strength</th>
                          <th className="px-3 py-2 text-right font-medium">n</th>
                          <th className="px-5 py-2 text-left font-medium">Significant</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {sortedCorrelations.map(cr => (
                          <tr key={`${cr.quality_metric}:${cr.business_kpi}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="px-5 py-2 text-slate-900 dark:text-white">{labelOf(cr.quality_metric)}</td>
                            <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{labelOf(cr.business_kpi)}</td>
                            <td className={cx('px-3 py-2 text-right tabular-nums', cr.is_significant ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400')}>
                              {fmtR(Number(cr.pearson_correlation))}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmtP(num(cr.p_value))}</td>
                            {hasQ && <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{fmtP(qOf(cr))}</td>}
                            <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{cr.correlation_strength}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">{cr.sample_size}</td>
                            <td className="px-5 py-2">{cr.is_significant ? <Badge tone="brand">Yes</Badge> : <span className="text-xs text-slate-400 dark:text-slate-500">No</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {correlations.length > 0 && (
                <AiPanel analyzing={aiAnalyzing} analysis={aiAnalysis} onAnalyze={analyzeCorrelationsWithAI} />
              )}

              <Card>
                <CardHeader title="How to read these results" />
                <div className="grid grid-cols-1 gap-6 text-sm text-slate-600 md:grid-cols-2 dark:text-slate-300">
                  <div className="space-y-3">
                    <p>
                      <span className="font-medium text-slate-900 dark:text-white">Pearson r</span> (−1 to +1) measures how closely two monthly series move together in a straight line.
                      A positive r means they tend to rise and fall together; a negative r means one tends to rise when the other falls.
                      Whether that is good depends on the metrics: for example, a positive r between lead time and support tickets means both rise together.
                    </p>
                    <p className="font-mono text-xs text-slate-500 dark:text-slate-400">r = Σ[(xᵢ − x̄)(yᵢ − ȳ)] / √[Σ(xᵢ − x̄)² · Σ(yᵢ − ȳ)²]</p>
                    <p>
                      <span className="font-medium text-slate-900 dark:text-white">Strength labels</span> use |r|: 0.7 and above strong, 0.5–0.7 moderate, 0.3–0.5 weak, below 0.3 none.
                      They describe the size of r only and say nothing about whether it is reliable.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <p>
                      <span className="font-medium text-slate-900 dark:text-white">p-value:</span> the probability of seeing a correlation at least this strong if, in fact, the two metrics were unrelated.
                      It is not the probability that the relationship is real.
                      {method?.test ? ` Test used: ${method.test}.` : ''}
                    </p>
                    <p>
                      <span className="font-medium text-slate-900 dark:text-white">q-value:</span>{' '}
                      {hasQ
                        ? `the p-value adjusted for testing ${tested} pairs at once (${method?.multipleComparison ?? 'Benjamini–Hochberg false discovery rate'}). A pair is marked significant when ${method?.significance ?? 'q < 0.05'}.`
                        : 'not provided for these results; significance is based on uncorrected p-values, so with many pairs tested some will appear significant by chance.'}
                    </p>
                    <p className="text-amber-700 dark:text-amber-400">
                      {method?.caveat ?? 'Correlation does not show causation.'} With only {sampleRange ?? 'a few'} months of data, results are exploratory.
                    </p>
                  </div>
                </div>
              </Card>
                </div>
              </Section>
              <Section title="Metric definitions">
                <MetricGlossary bare />
              </Section>
            </div>
          )}

          {activeTab === 'data-entry' && canWrite && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Enter values recorded for each month. Leave a field empty if it was not measured; correlations are recalculated from the saved data.
                </p>
                <button onClick={saveData} disabled={saving} className={cx(buttonClass.primary, 'disabled:opacity-50')}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </button>
              </div>

              {monthlyData.map(month => {
                const isExpanded = expandedMonths.has(month.month_year);
                const hasQuality = Object.values(month.quality).some(v => v !== null);
                const hasKpis = Object.values(month.kpis).some(v => v !== null);
                return (
                  <Card key={month.month_year} padded={false}>
                    <button
                      onClick={() => toggleMonth(month.month_year)}
                      className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-slate-900 dark:text-white">{formatMonth(month.month_year)}</span>
                        {hasQuality && <Badge>Quality</Badge>}
                        {hasKpis && <Badge>KPIs</Badge>}
                        {hasQuality && hasKpis && <Badge tone="brand">Paired</Badge>}
                      </div>
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                    </button>
                    {isExpanded && (
                      <div className="space-y-5 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
                        <FieldGroup title="Quality metrics">
                          {QUALITY_METRICS.map(metric => (
                            <NumberField key={metric.key} label={metric.label} unit={metric.unit} placeholder={metric.description}
                              value={month.quality[metric.key]} onChange={(v) => updateMetric(month.month_year, 'quality', metric.key, v)} />
                          ))}
                        </FieldGroup>
                        <FieldGroup title="Business KPIs">
                          {BUSINESS_KPIS.map(kpi => (
                            <NumberField key={kpi.key} label={kpi.label} unit={kpi.unit} placeholder={kpi.description}
                              value={month.kpis[kpi.key]} onChange={(v) => updateMetric(month.month_year, 'kpis', kpi.key, v)} />
                          ))}
                        </FieldGroup>
                        <FieldGroup title="Context (optional)">
                          {CONTEXT_FIELDS.map(field => field.key === 'is_holiday_season' ? (
                            <label key={field.key} className="block">
                              <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">{field.label}</span>
                              <select
                                value={month.context[field.key] ? 'true' : 'false'}
                                onChange={(e) => updateMetric(month.month_year, 'context', field.key, e.target.value)}
                                className={cx(inputClass, 'w-full')}
                              >
                                <option value="false">No</option>
                                <option value="true">Yes</option>
                              </select>
                            </label>
                          ) : (
                            <NumberField key={field.key} label={field.label}
                              value={month.context[field.key] as number | null} onChange={(v) => updateMetric(month.month_year, 'context', field.key, v)} />
                          ))}
                        </FieldGroup>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

        </>
      )}
    </Page>
  );
};

const CorrelationTile: React.FC<{ c: Correlation }> = ({ c }) => {
  const q = qOf(c);
  return (
    <div className={cx(
      'flex items-center justify-between gap-3 rounded-md border px-3 py-2',
      c.is_significant ? 'border-brand-200 bg-brand-50/50 dark:border-brand-900 dark:bg-brand-950/30' : 'border-slate-200 dark:border-slate-800',
    )}>
      <div className="min-w-0">
        <p className="truncate text-sm text-slate-900 dark:text-white">{labelOf(c.quality_metric)} and {labelOf(c.business_kpi)}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          n = {c.sample_size} · p {fmtP(num(c.p_value))}{q != null ? ` · q ${fmtP(q)}` : ''} · {c.is_significant ? 'significant' : 'not significant'}
        </p>
      </div>
      <span className={cx('text-base tabular-nums', c.is_significant ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400')}>
        {fmtR(Number(c.pearson_correlation))}
      </span>
    </div>
  );
};

const AiPanel: React.FC<{ analyzing: boolean; analysis: string; onAnalyze: () => void }> = ({ analyzing, analysis, onAnalyze }) => (
  <Card>
    <CardHeader
      title="AI summary"
      subtitle="Generated by an AI model from the stored correlations. Verify before relying on it; it may overstate relationships."
      action={
        <button onClick={onAnalyze} disabled={analyzing} className={cx(buttonClass.secondary, 'disabled:opacity-50')}>
          {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {analyzing ? 'Analyzing…' : 'Generate summary'}
        </button>
      }
    />
    {analysis ? (
      <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        <MarkdownRenderer content={analysis} />
      </div>
    ) : (
      <p className="text-sm text-slate-500 dark:text-slate-400">No summary generated yet.</p>
    )}
  </Card>
);

const FieldGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h4>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
  </div>
);

const NumberField: React.FC<{ label: string; unit?: string; placeholder?: string; value: number | null; onChange: (v: string) => void }> = ({ label, unit, placeholder, value, onChange }) => (
  <label className="block">
    <span className="mb-1 block text-xs text-slate-500 dark:text-slate-400">{label}{unit ? ` (${unit})` : ''}</span>
    <input type="number" step="0.01" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cx(inputClass, 'w-full')} />
  </label>
);

const MetricGlossary: React.FC<{ bare?: boolean }> = ({ bare }) => (
  <Card className={bare ? 'border-0 !p-0 shadow-none' : undefined}>
    {!bare && <CardHeader title="Metric definitions" />}
    <div className="grid grid-cols-1 gap-6 text-sm md:grid-cols-2">
      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Quality metrics</h4>
        <dl className="space-y-1.5">
          {QUALITY_METRICS.map(m => (
            <div key={m.key} className="flex gap-2">
              <dt className="w-40 flex-shrink-0 text-slate-900 dark:text-white">{m.label}</dt>
              <dd className="text-slate-500 dark:text-slate-400">{m.description}{m.unit ? ` (${m.unit})` : ''}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Business KPIs</h4>
        <dl className="space-y-1.5">
          {BUSINESS_KPIS.map(m => (
            <div key={m.key} className="flex gap-2">
              <dt className="w-40 flex-shrink-0 text-slate-900 dark:text-white">{m.label}</dt>
              <dd className="text-slate-500 dark:text-slate-400">{m.description}{m.unit ? ` (${m.unit})` : ''}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
    <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
      Every quality metric is paired with every business KPI for the months where both were recorded. A correlation shows that two series moved together over these months; it does not show that one caused the other, and series that share a trend over time can correlate without any link.
    </p>
  </Card>
);

export default BusinessImpactAnalysisV2;
