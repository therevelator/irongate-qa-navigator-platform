import React, { useEffect, useMemo, useState } from 'react';
import {
  Search, ArrowUp, ArrowDown, Sparkles, X, Loader2, TrendingUp, TrendingDown, Minus,
  LayoutGrid, Rows3, ChevronRight, CalendarDays, Users,
} from 'lucide-react';
import API_URL from '../config/api';
import type { Team } from '../data/mockData';
import { KPI_TARGETS, METRICS_CONFIG, getMetricStatus, teamAttentionIssues, type MetricsConfig } from '../config/metricsConfig';
import { QA_SCORE_THRESHOLDS, qaStatusFromScore } from '../../server/lib/metricFormulas';
import { useAuth } from '../contexts/AuthContext';
import { Page, PageIntro, Card, Badge, SegmentedControl, EmptyState, buttonClass, inputClass, cx, type Tone } from './ui';
import HeroBattery from './HeroBattery';

interface NewDashboardProps {
  teams: Team[];
  onTeamClick?: (team: Team) => void;
  // Accepted for compatibility with App; the dashboard keeps its own grid/list choice.
  gridColumns?: 1 | 2 | 3;
  is3DMode?: boolean;
}

/** GET /api/analytics/company-summary (server/routes/analytics.ts computeCompanyMetrics). */
interface CompanySummary {
  globalQaScore: number | null;
  globalQaScoreTrend: number | null;
  riskLevel: 'stable' | 'watch' | 'at-risk' | 'unknown';
  engineeringHealthScore: number | null;
  deliveryPerformanceScore: number | null;
  developerWellnessIndex: number | null;
  techDebtStatusScore: number | null;
  pipelineHealthScore: number | null;
  avgTestCoverage: number | null;
  avgDefectEscapeRate: number | null;
  automationCoverage: number | null;
  avgFlakinessRate: number | null;
  needsAttention: { name: string; score: number; issue: string }[];
  kpiStatus: { onTrack: number; atRisk: number; offTrack: number; noData?: number };
  aiSummary?: string;
  teamCount: number;
  teamsWithKpiData: number;
  asOf?: string | null;
  oldestSnapshotDate?: string | null;
  engineeringHealthBasis?: { weights: Record<string, number>; included: string[]; missing: string[] };
  deliveryPerformanceBasis?: { method: string; teamsClassified: number };
  developerWellnessBasis?: { method: string; developers: number };
  pipelineHealthBasis?: { definition: string; successfulRuns: number; totalRuns: number; windowDays: number };
  techDebtBasis?: { openItems: number; totalItems: number };
}

type Filter = 'all' | 'high' | 'attention';
type SortKey = 'qa' | 'name' | 'department' | 'coverage' | 'flakiness' | 'escapeRate' | 'automation' | 'deploys';
type ViewMode = 'grid' | 'list';
type Status = 'good' | 'warning' | 'critical' | 'none';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmt = (v: number | null, digits = 0, suffix = '') =>
  v == null ? '—' : `${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;

/** 'YYYY-MM-DD' (or ISO timestamp) → '7 Dec 2025', read as a calendar date. */
const fmtDate = (d: string | null | undefined) => {
  if (!d) return null;
  const day = String(d).slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const QA_GOOD = QA_SCORE_THRESHOLDS.good;
const QA_WARN = QA_SCORE_THRESHOLDS.warning;
// Composite 0–100 indices use the platform's standard score bands (ui.scoreTone defaults).
const INDEX_GOOD = 80;
const INDEX_WARN = 60;

const RISK: Record<CompanySummary['riskLevel'], { label: string; tone: Tone }> = {
  stable: { label: 'Stable', tone: 'good' },
  watch: { label: 'Watch', tone: 'warn' },
  'at-risk': { label: 'At risk', tone: 'bad' },
  unknown: { label: 'Insufficient data', tone: 'neutral' },
};

const STATUS_META: Record<Status, { label: string; tone: Tone; accent: string; tint: string; dot: string }> = {
  good: {
    label: 'Good', tone: 'good',
    accent: 'bg-green-600 dark:bg-green-500',
    tint: 'bg-green-50/80 dark:bg-green-950/30',
    dot: 'bg-green-600 dark:bg-green-500',
  },
  warning: {
    label: 'Warning', tone: 'warn',
    accent: 'bg-amber-500 dark:bg-amber-400',
    tint: 'bg-amber-50/80 dark:bg-amber-950/30',
    dot: 'bg-amber-500 dark:bg-amber-400',
  },
  critical: {
    label: 'Critical', tone: 'bad',
    accent: 'bg-red-600 dark:bg-red-500',
    tint: 'bg-red-50/80 dark:bg-red-950/30',
    dot: 'bg-red-600 dark:bg-red-500',
  },
  none: {
    label: 'No data', tone: 'neutral',
    accent: 'bg-slate-300 dark:bg-slate-700',
    tint: 'bg-slate-50 dark:bg-slate-800/40',
    dot: 'bg-slate-300 dark:bg-slate-600',
  },
};

const HEALTH_PART_LABEL: Record<string, string> = {
  deliveryPerformance: 'delivery',
  pipelineHealth: 'pipeline',
  techDebtStatus: 'debt',
  workloadBalance: 'workload',
};

interface Row {
  team: Team;
  name: string;
  department: string;
  qa: number | null;
  status: Status;
  coverage: number | null;
  flakiness: number | null;
  escapeRate: number | null;
  automation: number | null;
  deploys: number | null;
  members: number | null;
  snapshotDate: string | null;
  attention: boolean;
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'qa', label: 'QA score' },
  { value: 'name', label: 'Team name' },
  { value: 'department', label: 'Department' },
  { value: 'coverage', label: 'Test coverage' },
  { value: 'automation', label: 'Automation' },
  { value: 'flakiness', label: 'Flakiness' },
  { value: 'escapeRate', label: 'Escape rate' },
  { value: 'deploys', label: 'Deploys / week' },
];

const VIEW_KEY = 'irongate_dashboard_view';
const readView = (): ViewMode => {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
};

const NewDashboard: React.FC<NewDashboardProps> = ({ teams, onTeamClick }) => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<CompanySummary | null>(null);
  const [summaryState, setSummaryState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'qa', dir: 'desc' });
  const [view, setView] = useState<ViewMode>(readView);
  const [briefingOpen, setBriefingOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* storage unavailable */ }
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/analytics/company-summary`, { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) { setSummary(data); setSummaryState('ready'); }
      } catch {
        if (!cancelled) setSummaryState('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // /api/teams already returns each team's latest KPI snapshot — no per-team requests needed.
  const rows: Row[] = useMemo(() => teams.map((t: any) => {
    const k = t.kpiData || {};
    const qa = num(t.qaScore);
    const coverage = num(k.testCoverage);
    const flakiness = num(k.testFlakinessRate);
    const escapeRate = num(k.defectEscapeRate);
    const automation = num(k.automationCoverage);
    return {
      team: t,
      name: t.name,
      department: t.department || '—',
      qa,
      status: (qaStatusFromScore(qa) ?? 'none') as Status,
      coverage,
      flakiness,
      escapeRate,
      automation,
      deploys: num(k.deploymentFrequencyPerWeek),
      members: num(t.memberCount),
      snapshotDate: t.snapshotDate ?? null,
      // Same rule as the server's "needs attention" list (teamAttentionIssues).
      attention: qa != null && teamAttentionIssues({ qaScore: qa, testCoverage: coverage, testFlakinessRate: flakiness, defectEscapeRate: escapeRate, automationCoverage: automation }).length > 0,
    };
  }), [teams]);

  const departments = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department).filter((d) => d && d !== '—'))).sort(),
    [rows],
  );

  const inDepartment = useMemo(
    () => rows.filter((r) => department === 'all' || r.department === department),
    [rows, department],
  );

  const counts = useMemo(() => ({
    all: inDepartment.length,
    high: inDepartment.filter((r) => r.qa != null && r.qa >= QA_GOOD).length,
    attention: inDepartment.filter((r) => r.attention).length,
  }), [inDepartment]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = inDepartment.filter((r) => {
      if (filter === 'high' && !(r.qa != null && r.qa >= QA_GOOD)) return false;
      if (filter === 'attention' && !r.attention) return false;
      return !q || r.name.toLowerCase().includes(q) || r.department.toLowerCase().includes(q);
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key] as any, bv = b[sort.key] as any;
      if (av == null && bv == null) return a.name.localeCompare(b.name);
      if (av == null) return 1; // missing data always last
      if (bv == null) return -1;
      const c = (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * dir;
      return c !== 0 ? c : a.name.localeCompare(b.name);
    });
  }, [inDepartment, search, filter, sort]);

  const canBrief = user?.role === 'super_admin' || user?.role === 'qa_manager' || user?.role === 'team_lead';
  const hour = new Date().getHours();
  const greeting = `Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}${user?.firstName ? `, ${user.firstName}` : ''}`;

  return (
    <Page>
      <div data-testid="dashboard">
        <PageIntro
          title={greeting}
          description="Company quality status and the latest KPI snapshot of every team."
          actions={canBrief && (
            <button className={buttonClass.secondary} onClick={() => setBriefingOpen(true)}>
              <Sparkles size={15} /> Executive briefing
            </button>
          )}
        />

        <CompanyHero summary={summary} state={summaryState} />

        {/* Team overview */}
        <section className="mt-10" aria-labelledby="team-overview-title">
          <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 id="team-overview-title" className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">Team performance</h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Latest KPI snapshot per team. Colour shows QA status: green ≥ {QA_GOOD}, amber ≥ {QA_WARN}, red below; grey has no data.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="max-w-full overflow-x-auto">
                <SegmentedControl<Filter>
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: `All ${counts.all}` },
                    { value: 'high', label: `High performing ${counts.high}` },
                    { value: 'attention', label: `Needs attention ${counts.attention}` },
                  ]}
                />
              </div>
            </div>
          </div>

          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative sm:w-64">
              <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search teams"
                aria-label="Search teams"
                className={cx(inputClass, 'w-full pl-8')}
              />
            </div>
            {departments.length > 1 && (
              <select value={department} onChange={(e) => setDepartment(e.target.value)} className={cx(inputClass, 'pr-8')} aria-label="Department">
                <option value="all">All departments</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <div className="flex items-center gap-2">
              <select
                value={sort.key}
                onChange={(e) => {
                  const key = e.target.value as SortKey;
                  setSort({ key, dir: key === 'name' || key === 'department' || key === 'flakiness' || key === 'escapeRate' ? 'asc' : 'desc' });
                }}
                className={cx(inputClass, 'flex-1 pr-8 sm:flex-none')}
                aria-label="Sort teams by"
              >
                {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
              </select>
              <button
                type="button"
                onClick={() => setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))}
                className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                aria-label={sort.dir === 'asc' ? 'Sorted ascending; switch to descending' : 'Sorted descending; switch to ascending'}
                title={sort.dir === 'asc' ? 'Ascending' : 'Descending'}
              >
                {sort.dir === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
              </button>
            </div>
            <div className="self-start sm:self-auto sm:ml-auto inline-flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900" role="group" aria-label="Layout">
              {([
                { v: 'grid' as const, label: 'Grid', Icon: LayoutGrid },
                { v: 'list' as const, label: 'List', Icon: Rows3 },
              ]).map(({ v, label, Icon }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors',
                    view === v
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                  )}
                >
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <Card><EmptyState title="No teams match" description="Adjust the filters or search term." /></Card>
          ) : (
            <div className={view === 'grid' ? 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3' : 'flex flex-col gap-3'}>
              {visible.map((r) => (
                <TeamCard
                  key={r.team.id}
                  row={r}
                  layout={view}
                  primary={r.team.id === user?.primaryTeamId}
                  onOpen={() => onTeamClick?.(r.team)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {briefingOpen && <BriefingDrawer onClose={() => setBriefingOpen(false)} />}
    </Page>
  );
};

/* ------------------------------------------------------------------ */
/* Company status hero                                                 */
/* ------------------------------------------------------------------ */

const toneFor = (v: number | null, good: number, warn: number): Status =>
  v == null ? 'none' : v >= good ? 'good' : v >= warn ? 'warning' : 'critical';

const VALUE_TEXT: Record<Status, string> = {
  good: 'text-green-700 dark:text-green-400',
  warning: 'text-amber-700 dark:text-amber-400',
  critical: 'text-red-700 dark:text-red-400',
  none: 'text-slate-400 dark:text-slate-500',
};

const CompanyHero: React.FC<{ summary: CompanySummary | null; state: 'loading' | 'ready' | 'error' }> = ({ summary, state }) => {
  if (state === 'error') {
    return (
      <Card>
        <EmptyState title="Company summary unavailable" description="The organisation-wide metrics could not be loaded. Team data below is unaffected." />
      </Card>
    );
  }

  const s = summary;
  const qa = num(s?.globalQaScore);
  const trend = num(s?.globalQaScoreTrend);
  const risk = s ? RISK[s.riskLevel] ?? RISK.unknown : null;
  const asOf = fmtDate(s?.asOf);
  const oldest = fmtDate(s?.oldestSnapshotDate);
  const missingHealth = s?.engineeringHealthBasis?.missing ?? [];
  const pipe = s?.pipelineHealthBasis;
  const debt = s?.techDebtBasis;
  const happiness = METRICS_CONFIG.happinessScore;

  const gauges: { label: string; value: number | null; good: number; warn: number; caption: string; title: string }[] = [
    {
      label: 'Engineering health',
      value: num(s?.engineeringHealthScore),
      good: INDEX_GOOD, warn: INDEX_WARN,
      caption: s?.engineeringHealthScore == null
        ? 'No component has data'
        : missingHealth.length
          ? `Excludes ${missingHealth.map((m) => HEALTH_PART_LABEL[m] ?? m).join(', ')} (no data)`
          : 'Delivery, pipeline, debt, workload',
      title: 'Weighted mean: delivery 35%, pipeline 25%, debt 20%, workload balance 20%. Components without data are excluded.',
    },
    {
      label: 'Delivery (DORA)',
      value: num(s?.deliveryPerformanceScore),
      good: INDEX_GOOD, warn: INDEX_WARN,
      caption: s?.deliveryPerformanceBasis
        ? s.deliveryPerformanceBasis.teamsClassified > 0
          ? `${s.deliveryPerformanceBasis.teamsClassified} team${s.deliveryPerformanceBasis.teamsClassified === 1 ? '' : 's'} with all 4 DORA inputs`
          : 'No team has all 4 DORA inputs'
        : '',
      title: s?.deliveryPerformanceBasis?.method ?? '',
    },
    {
      label: 'Workload balance',
      value: num(s?.developerWellnessIndex),
      good: happiness.good, warn: happiness.warning,
      caption: s?.developerWellnessBasis
        ? s.developerWellnessBasis.developers > 0
          ? `Derived · ${s.developerWellnessBasis.developers} developer${s.developerWellnessBasis.developers === 1 ? '' : 's'}`
          : 'No developer metrics recorded'
        : '',
      title: s?.developerWellnessBasis?.method ?? '',
    },
    {
      label: 'Tech debt health',
      value: num(s?.techDebtStatusScore),
      good: INDEX_GOOD, warn: INDEX_WARN,
      caption: debt ? (debt.totalItems > 0 ? `${debt.openItems} open of ${debt.totalItems} items` : 'No debt items tracked') : '',
      title: '100 = no open debt; reduced by the severity weight of open items per active team.',
    },
    {
      label: 'Pipeline health',
      value: num(s?.pipelineHealthScore),
      good: INDEX_GOOD, warn: INDEX_WARN,
      caption: pipe ? (pipe.totalRuns > 0 ? `${pipe.successfulRuns} of ${pipe.totalRuns} runs passed, ${pipe.windowDays} days` : `No completed runs in ${pipe.windowDays} days`) : '',
      title: pipe?.definition ?? '',
    },
  ];

  const qaStatus = toneFor(qa, QA_GOOD, QA_WARN);
  const kpi = s?.kpiStatus;

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Company status</h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays size={13} className="text-slate-400" />
            {state === 'loading' ? 'Loading…' : asOf ? <>Data as of <span className="font-medium text-slate-700 dark:text-slate-200">{asOf}</span></> : 'No KPI snapshots recorded'}
          </span>
          {oldest && asOf && oldest !== asOf && <span>Oldest team snapshot {oldest}</span>}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
        {/* Global QA score */}
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:border-r lg:border-slate-200 lg:dark:border-slate-800">
          <div className="flex items-center gap-6">
            <HeroBattery value={qa} good={QA_GOOD} warn={QA_WARN} label="Global QA score" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Global QA score</p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className={cx('text-5xl font-semibold tracking-tight tabular-nums', qa == null ? VALUE_TEXT.none : 'text-slate-900 dark:text-white')}>
                  {qa == null ? '—' : Math.round(qa)}
                </span>
                {qa != null && <span className="text-base text-slate-500 dark:text-slate-400">/ 100</span>}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {risk && <Badge tone={risk.tone}>{risk.label}</Badge>}
                {s && (
                  trend == null ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">No trend data</span>
                  ) : (
                    <span className={cx('inline-flex items-center gap-1 text-xs font-medium', trend > 0 ? 'text-green-700 dark:text-green-400' : trend < 0 ? 'text-red-700 dark:text-red-400' : 'text-slate-600 dark:text-slate-300')}>
                      {trend > 0 ? <TrendingUp size={14} /> : trend < 0 ? <TrendingDown size={14} /> : <Minus size={14} />}
                      {trend > 0 ? '+' : ''}{trend} pts vs 7–14 days ago
                    </span>
                  )
                )}
              </div>
              {s && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Mean of {s.teamsWithKpiData} of {s.teamCount} active teams with a QA score
                </p>
              )}
            </div>
          </div>
          {s?.aiSummary && (
            <p className={cx('rounded-md border px-3.5 py-3 text-sm leading-relaxed',
              qaStatus === 'none'
                ? 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300'
                : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300')}
            >
              {s.aiSummary}
            </p>
          )}
        </div>

        {/* Executive gauges */}
        <div className="p-5 sm:p-6 border-t border-slate-200 dark:border-slate-800 lg:border-t-0">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Executive engineering metrics</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {gauges.map((g) => {
              const st = toneFor(g.value, g.good, g.warn);
              return (
                <div key={g.label} className="flex flex-col items-start gap-3 rounded-md border border-slate-200 p-3.5 dark:border-slate-800" title={g.title || undefined}>
                  <HeroBattery value={g.value} good={g.good} warn={g.warn} size="sm" label={g.label} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{g.label}</p>
                    <p className="mt-1 flex items-baseline gap-1">
                      <span className={cx('text-2xl font-semibold tabular-nums tracking-tight', g.value == null ? VALUE_TEXT.none : 'text-slate-900 dark:text-white')}>
                        {g.value == null ? '—' : Math.round(g.value)}
                      </span>
                      {g.value != null && <span className="text-xs text-slate-500 dark:text-slate-400">/ 100</span>}
                      {g.value != null && <span className={cx('ml-1 h-1.5 w-1.5 self-center rounded-full', STATUS_META[st].dot)} aria-hidden="true" />}
                    </p>
                    {g.caption && <p className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">{g.caption}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Company averages + KPI status */}
      <div className="grid grid-cols-2 gap-px border-t border-slate-200 bg-slate-200 dark:border-slate-800 dark:bg-slate-800 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'Avg test coverage', v: num(s?.avgTestCoverage), target: KPI_TARGETS.coverage, higher: true },
          { label: 'Avg automation', v: num(s?.automationCoverage), target: KPI_TARGETS.automation, higher: true },
          { label: 'Avg flakiness', v: num(s?.avgFlakinessRate), target: KPI_TARGETS.flakiness, higher: false },
          { label: 'Avg escape rate', v: num(s?.avgDefectEscapeRate), target: KPI_TARGETS.escapeRate, higher: false },
        ].map((m) => {
          const ok = m.v == null ? null : m.higher ? m.v >= m.target : m.v <= m.target;
          return (
            <div key={m.label} className="bg-white px-5 py-3.5 dark:bg-slate-900 sm:px-6">
              <p className="text-xs text-slate-500 dark:text-slate-400">{m.label}</p>
              <p className="mt-1 flex items-center gap-2">
                <span className={cx('text-base font-semibold tabular-nums', m.v == null ? VALUE_TEXT.none : 'text-slate-900 dark:text-white')}>{fmt(m.v, 1, '%')}</span>
                <span className={cx('h-1.5 w-1.5 rounded-full', ok == null ? 'bg-slate-300 dark:bg-slate-600' : ok ? 'bg-green-600 dark:bg-green-500' : 'bg-amber-500 dark:bg-amber-400')} aria-hidden="true" />
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Target {m.higher ? '≥' : '≤'} {m.target}%{ok != null && <span className={ok ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}> · {ok ? 'met' : 'not met'}</span>}</p>
            </div>
          );
        })}
        <div className="col-span-2 bg-white px-5 py-3.5 dark:bg-slate-900 sm:col-span-1 sm:px-6">
          <p className="text-xs text-slate-500 dark:text-slate-400">Teams vs KPI targets</p>
          {kpi && kpi.onTrack + kpi.atRisk + kpi.offTrack > 0 ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {[
                { l: 'on track', v: kpi.onTrack, c: 'bg-green-600 dark:bg-green-500' },
                { l: 'at risk', v: kpi.atRisk, c: 'bg-amber-500 dark:bg-amber-400' },
                { l: 'off track', v: kpi.offTrack, c: 'bg-red-600 dark:bg-red-500' },
              ].map((k) => (
                <span key={k.l} className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className={cx('h-1.5 w-1.5 rounded-full', k.c)} aria-hidden="true" />
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{k.v}</span> {k.l}
                </span>
              ))}
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">{state === 'loading' ? '—' : 'No KPI data yet'}</p>
          )}
        </div>
      </div>
    </Card>
  );
};

/* ------------------------------------------------------------------ */
/* Team card                                                           */
/* ------------------------------------------------------------------ */

const KPI_FIELDS: { key: 'coverage' | 'automation' | 'flakiness' | 'escapeRate' | 'deploys'; label: string; metric: keyof MetricsConfig; digits: number; suffix: string }[] = [
  { key: 'coverage', label: 'Coverage', metric: 'testCoverage', digits: 1, suffix: '%' },
  { key: 'automation', label: 'Automation', metric: 'automationCoverage', digits: 1, suffix: '%' },
  { key: 'flakiness', label: 'Flakiness', metric: 'testFlakinessRate', digits: 1, suffix: '%' },
  { key: 'escapeRate', label: 'Escape rate', metric: 'defectEscapeRate', digits: 1, suffix: '%' },
  { key: 'deploys', label: 'Deploys / wk', metric: 'deploymentFrequencyPerWeek', digits: 1, suffix: '' },
];

const METRIC_DOT: Record<'good' | 'warning' | 'critical', string> = {
  good: STATUS_META.good.dot,
  warning: STATUS_META.warning.dot,
  critical: STATUS_META.critical.dot,
};

const TeamCard: React.FC<{ row: Row; layout: ViewMode; primary: boolean; onOpen: () => void }> = ({ row: r, layout, primary, onOpen }) => {
  const meta = STATUS_META[r.status];
  const asOf = fmtDate(r.snapshotDate);
  const isList = layout === 'list';

  const kpis = (
    <dl className={cx('grid gap-x-4 gap-y-3', isList ? 'grid-cols-3 sm:grid-cols-5 lg:flex-1' : 'grid-cols-3 xl:grid-cols-5')}>
      {KPI_FIELDS.map((f) => {
        const v = r[f.key];
        const st = v == null ? null : getMetricStatus(v, f.metric);
        return (
          <div key={f.key} className="min-w-0">
            <dt className="truncate text-xs text-slate-500 dark:text-slate-400">{f.label}</dt>
            <dd className="mt-0.5 flex items-center gap-1.5">
              <span className={cx('text-sm font-semibold tabular-nums', v == null ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white')}>
                {fmt(v, f.digits, f.suffix)}
              </span>
              {st && <span className={cx('h-1.5 w-1.5 flex-shrink-0 rounded-full', METRIC_DOT[st])} title={`${st === 'good' ? 'On target' : st === 'warning' ? 'Below target' : 'Critical'}`} aria-hidden="true" />}
            </dd>
          </div>
        );
      })}
    </dl>
  );

  return (
    <article
      data-testid="team-card"
      data-primary-team={primary ? 'true' : undefined}
      data-status={r.status}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      aria-label={`${r.name}, QA score ${r.qa == null ? 'no data' : Math.round(r.qa)}, ${meta.label}. Open team detail`}
      className={cx(
        'group relative flex cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition-[box-shadow,border-color] duration-150',
        'hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        isList ? 'flex-row' : 'flex-col',
      )}
    >
      {/* Status accent */}
      <span aria-hidden="true" className={cx('flex-shrink-0', meta.accent, isList ? 'w-1' : 'h-1 w-full')} />

      <div className={cx('flex min-w-0 flex-1', isList ? 'flex-col lg:flex-row lg:items-center' : 'flex-col')}>
        {/* Header: tinted by status */}
        <header className={cx('flex items-start justify-between gap-3 px-4 py-3', meta.tint, isList && 'lg:w-72 lg:flex-shrink-0 lg:self-stretch lg:items-center')}>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white" data-testid="team-name" title={r.name}>{r.name}</h3>
            <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-400">
              {r.department}{primary && <span className="ml-1.5 font-medium text-brand-700 dark:text-brand-300">· Your team</span>}
            </p>
          </div>
          <Badge tone={meta.tone} className="flex-shrink-0">{meta.label}</Badge>
        </header>

        <div className={cx('flex flex-1 gap-4 px-4 py-4', isList ? 'flex-col sm:flex-row sm:items-center' : 'flex-col')}>
          {/* QA score gauge + team size */}
          <div className={cx('flex items-center justify-between gap-3', isList && 'sm:w-48 sm:flex-shrink-0 sm:flex-col sm:items-start sm:justify-center sm:gap-2')}>
            <div className="flex items-center gap-3">
              <HeroBattery value={r.qa} good={QA_GOOD} warn={QA_WARN} size="xs" label={`${r.name} QA score`} />
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">QA score</p>
                <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
                  {r.qa == null ? '—' : Math.round(r.qa)}
                  {r.qa != null && <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">/ 100</span>}
                </p>
              </div>
            </div>
            <p className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Users size={13} className="text-slate-400" aria-hidden="true" />
              <span><span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{r.members == null ? '—' : r.members}</span> {r.members === 1 ? 'member' : 'members'}</span>
            </p>
          </div>
          {kpis}
        </div>

        {/* Footer */}
        <footer className={cx(
          'flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400',
          isList && 'lg:w-48 lg:flex-shrink-0 lg:self-stretch lg:border-l lg:border-t-0',
        )}>
          <span className="inline-flex items-center gap-1.5 truncate">
            <CalendarDays size={13} className="flex-shrink-0 text-slate-400" aria-hidden="true" />
            {asOf ? <>As of {asOf}</> : 'No snapshot recorded'}
          </span>
          <ChevronRight size={16} className="flex-shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-600 dark:group-hover:text-slate-200" aria-hidden="true" />
        </footer>
      </div>
    </article>
  );
};

/** AI-generated executive briefing, clearly labelled as such. */
const BriefingDrawer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [analysis, setAnalysis] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/analytics/company-insights`, { method: 'POST', credentials: 'include' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setAnalysis(String(data.analysis || ''));
        setState('ready');
      } catch {
        setState('error');
      }
    })();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const renderLine = (line: string, i: number) => {
    const t = line.trim();
    if (!t) return null;
    const clean = t.replace(/\*\*/g, '');
    if (t.startsWith('#') || (t.startsWith('**') && t.endsWith('**'))) {
      return <h4 key={i} className="mt-5 first:mt-0 mb-1.5 text-sm font-semibold text-slate-900 dark:text-white">{clean.replace(/^#+\s*/, '')}</h4>;
    }
    if (/^(\d+\.|[-•])\s/.test(t)) {
      return <li key={i} className="ml-4 list-disc text-sm text-slate-700 dark:text-slate-300 mb-1">{clean.replace(/^(\d+\.|[-•])\s*/, '')}</li>;
    }
    return <p key={i} className="text-sm text-slate-700 dark:text-slate-300 mb-2 leading-relaxed">{clean}</p>;
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Executive briefing">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="relative w-full max-w-xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-6 h-16 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Executive briefing</h2>
            <p className="text-xs text-slate-500">Generated from organisation-wide metrics</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {state === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Preparing briefing…</div>
          )}
          {state === 'error' && <p className="text-sm text-slate-500">The briefing could not be generated right now. Please try again later.</p>}
          {state === 'ready' && <div>{analysis.split('\n').map(renderLine)}</div>}
        </div>
        <p className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500">
          AI-generated summary. Verify figures against the underlying metrics before sharing externally.
        </p>
      </aside>
    </div>
  );
};

export default NewDashboard;
