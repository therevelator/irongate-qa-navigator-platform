import React, { useEffect, useMemo, useState } from 'react';
import { LastUpdatedNote } from './LastUpdatedNote';
import {
  Search, ArrowUp, ArrowDown, Sparkles, X, Loader2, TrendingUp, TrendingDown, Minus,
  LayoutGrid, Rows3, ChevronRight, CalendarDays, Users,
} from 'lucide-react';
import API_URL from '../config/api';
import type { Team } from '../data/mockData';
import { KPI_TARGETS, METRICS_CONFIG, getMetricStatus, type MetricsConfig } from '../config/metricsConfig';
import { canRequestExecutiveBriefing } from '../../server/lib/userPolicy';
import { policyActorOf } from '../lib/policyActor';
import { COMPOSITE_INDEX_BANDS, QA_SCORE_THRESHOLDS, qaStatusFromScore } from '../../server/lib/metricFormulas';
import { WELLBEING_BANDS } from '../../server/lib/pulseRules';
import { useAuth } from '../contexts/AuthContext';
import { Page, PageIntro, Card, Badge, SegmentedControl, EmptyState, buttonClass, inputClass, cx, type Tone } from './ui';
import ScoreVisual from './ScoreVisual';
import { batteryBand, topLightRgb } from '../lib/batteryScale';
import KpiStatusModal, { type KpiStatusTeam, type KpiTab } from './KpiStatusModal';
import { openTvMode } from './tv/tvNavigation';
import { ConfidenceNote, type ConfidenceInfo } from './MetricQuality';
import SampleDataBanner from './SampleDataBanner';
import OnboardingChecklist from './OnboardingChecklist';
import SavedViewsMenu from './SavedViewsMenu';
import ExportCsvButton from './ExportCsvButton';
import type { CsvColumn } from '../lib/csv';
import { statusWithTarget, targetLabel } from '../lib/targetText';

interface NewDashboardProps {
  teams: Team[];
  /** Why the team list could not be loaded (shown instead of "No teams match"). */
  teamsError?: string | null;
  onTeamClick?: (team: Team) => void;
  // Accepted for compatibility with App; the dashboard keeps its own grid/list and columns choice.
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
  /** Per-team breakdown behind kpiStatus (same rule: teamKpiTrack). */
  kpiStatusTeams?: KpiStatusTeam[];
  aiSummary?: string;
  teamCount: number;
  teamsWithKpiData: number;
  asOf?: string | null;
  oldestSnapshotDate?: string | null;
  /** Newest value of any active team; dataOutdated when over a day old (latest data shown as of then). */
  lastUpdated?: string | null;
  dataOutdated?: boolean;
  engineeringHealthBasis?: { weights: Record<string, number>; included: string[]; missing: string[] };
  deliveryPerformanceBasis?: { method: string; teamsClassified: number };
  /** Wellbeing (survey): teams with a shown latest-period result (k-anonymous, server/lib/pulse.ts). */
  developerWellnessBasis?: { method: string; teamsReporting: number; teamsTotal: number; teamsSuppressed: number; responses: number; minResponses: number };
  pipelineHealthBasis?: { definition: string; successfulRuns: number; totalRuns: number; windowDays: number };
  techDebtBasis?: { openItems: number; totalItems: number };
  /** Teams with a current QA score of the active teams (composite confidence). */
  globalQaScoreConfidence?: ConfidenceInfo;
  /** Distribution of the current team QA scores; the headline is the team-size weighted mean. */
  globalQaScoreDistribution?: { weightedMean: number | null; unweightedMean: number | null; median: number | null; p25: number | null; min: number | null; count: number; weighting: string };
  engineeringHealthConfidence?: ConfidenceInfo;
  deliveryPerformanceConfidence?: ConfidenceInfo;
  companyKpiTargets?: { coverage: number; automation: number; flakiness: number; escapeRate: number };
  sampleData?: boolean;
  /** Which teams the summary covers: the whole company (super admins) or the caller's analytics scope. */
  scope?: { level: string; teamCount: number; companyTeamCount: number; companyWide: boolean };
}

type Filter = 'all' | 'high' | 'attention';

/**
 * The two filters split the teams that have a QA score by the team's QA score target (the "Target ≥ …"
 * shown on its card: its kpiThresholds.qaScore, else QA_SCORE_THRESHOLDS.good, 85):
 *  - High performing: QA score at or above the target.
 *  - Needs attention: QA score below the target.
 * A single KPI off its own target (e.g. flakiness 2.5% against ≤ 2%) does not move a team into "Needs
 * attention": it is shown on the team's card in amber. Teams with no QA score are in neither filter.
 */
const qaTargetOf = (thresholds: { qaScore?: { good: number } } | null | undefined) =>
  thresholds?.qaScore?.good ?? QA_SCORE_THRESHOLDS.good;
const isHighPerforming = (r: { qa: number | null; thresholds: { qaScore?: { good: number } } | null }) =>
  r.qa != null && r.qa >= qaTargetOf(r.thresholds);
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
// Composite 0–100 indices: the shared bands (COMPOSITE_INDEX_BANDS in server/lib/metricFormulas.ts).
const INDEX_GOOD = COMPOSITE_INDEX_BANDS.good;
const INDEX_WARN = COMPOSITE_INDEX_BANDS.warning;

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
  wellbeingSurvey: 'wellbeing survey',
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
  /** What the QA score is based on (stale / missing inputs left out). */
  confidence: ConfidenceInfo | null;
  /** KPI key -> staleness of its latest value (GET /api/teams kpiStaleness). */
  staleness: Record<string, { stale: boolean; staleSince: string | null; recordedAt: string | null }>;
  /** KPI key -> target valid at the value's date (target history). */
  thresholds: Record<string, { good: number; warning: number; lowerIsBetter: boolean }> | null;
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

/** Grid density: 1, 2 or 3 cards per row (grid view only), remembered per browser. */
type Columns = 1 | 2 | 3;
const COLUMNS_KEY = 'irongate_dashboard_columns';
const readColumns = (): Columns => {
  try {
    const v = Number(localStorage.getItem(COLUMNS_KEY));
    return v === 1 || v === 2 ? v : 3;
  } catch { return 3; }
};
// Responsive caps: always 1 column on phones, at most 2 on tablets (md), the choice from xl.
const GRID_CLASS: Record<Columns, string> = {
  1: 'grid grid-cols-1 gap-4',
  2: 'grid grid-cols-1 gap-4 md:grid-cols-2',
  3: 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3',
};

const NewDashboard: React.FC<NewDashboardProps> = ({ teams, teamsError, onTeamClick }) => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<CompanySummary | null>(null);
  const [summaryState, setSummaryState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'qa', dir: 'desc' });
  const [view, setView] = useState<ViewMode>(readView);
  const [columns, setColumns] = useState<Columns>(readColumns);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [kpiModal, setKpiModal] = useState<KpiTab | null>(null);

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* storage unavailable */ }
  }, [view]);

  useEffect(() => {
    try { localStorage.setItem(COLUMNS_KEY, String(columns)); } catch { /* storage unavailable */ }
  }, [columns]);

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
      attention: qa != null && qa < qaTargetOf(t.kpiThresholds),
      confidence: t.qaScoreConfidence ?? null,
      staleness: t.kpiStaleness ?? {},
      thresholds: t.kpiThresholds ?? null,
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
    high: inDepartment.filter(isHighPerforming).length,
    attention: inDepartment.filter((r) => r.attention).length,
  }), [inDepartment]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = inDepartment.filter((r) => {
      if (filter === 'high' && !isHighPerforming(r)) return false;
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

  // Saved views (SavedViewsMenu): the dashboard's choices, and applying a saved set of them.
  const viewState = useMemo(() => ({ filter, search, department, sort, view, columns }), [filter, search, department, sort, view, columns]);
  const applyView = (s: Record<string, any>) => {
    setFilter((['all', 'high', 'attention'] as Filter[]).includes(s.filter) ? s.filter : 'all');
    setSearch(typeof s.search === 'string' ? s.search : '');
    setDepartment(typeof s.department === 'string' ? s.department : 'all');
    if (s.sort && typeof s.sort.key === 'string') setSort({ key: s.sort.key as SortKey, dir: s.sort.dir === 'asc' ? 'asc' : 'desc' });
    if (s.view === 'grid' || s.view === 'list') setView(s.view);
    if ([1, 2, 3].includes(s.columns)) setColumns(s.columns as Columns);
  };

  // CSV export of the listed teams (filters and sort as shown): values as shown plus raw numbers.
  const csvColumns: CsvColumn<Row>[] = [
    { header: 'Team', value: (r) => r.name },
    { header: 'Department', value: (r) => r.department },
    { header: 'QA score', value: (r) => (r.qa == null ? '—' : String(Math.round(r.qa))), raw: (r) => r.qa },
    { header: 'Status', value: (r) => STATUS_META[r.status].label },
    { header: 'QA score basis', value: (r) => (r.confidence ? `${r.confidence.inputsUsed} of ${r.confidence.inputsTotal} inputs (${r.confidence.confidence} confidence)` : '') },
    ...KPI_FIELDS.map((f): CsvColumn<Row> => ({
      header: f.label,
      value: (r) => fmt(r[f.key], f.digits, f.suffix),
      raw: (r) => r[f.key],
    })),
    { header: 'Stale KPIs', value: (r) => KPI_FIELDS.filter((f) => r.staleness[f.metric]?.stale).map((f) => f.label).join('; ') },
    { header: 'Needs attention', value: (r) => (r.attention ? 'yes' : 'no') },
    { header: 'High performing', value: (r) => (isHighPerforming(r) ? 'yes' : 'no') },
    { header: 'Members', value: (r) => r.members },
    { header: 'Snapshot date', value: (r) => r.snapshotDate ?? '' },
  ];

  const canBrief = !!user && canRequestExecutiveBriefing(policyActorOf(user)); // as POST /api/analytics/company-insights
  const hour = new Date().getHours();
  const greeting = `Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}${user?.firstName ? `, ${user.firstName}` : ''}`;

  return (
    <Page>
      <div data-testid="dashboard">
        <PageIntro
          title={greeting}
          description={summary?.scope && !summary.scope.companyWide
            ? `Quality status and the latest KPI snapshot of ${summary.scope.teamCount === 1 ? 'your team' : `the ${summary.scope.teamCount} teams you can see`}.`
            : 'Company quality status and the latest KPI snapshot of every team.'}
          actions={canBrief && (
            <button className={buttonClass.secondary} onClick={() => setBriefingOpen(true)}>
              <Sparkles size={15} /> Executive briefing
            </button>
          )}
        />

        <SampleDataBanner show={!!summary?.sampleData || teams.some((t: any) => t.sampleData)} />

        <OnboardingChecklist />

        <CompanyHero summary={summary} state={summaryState} onOpenKpiStatus={setKpiModal} />

        {/* Team overview */}
        <section className="mt-10" aria-labelledby="team-overview-title">
          <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 id="team-overview-title" className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">Team performance</h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Latest KPI snapshot per team. Colour shows QA status: green ≥ {QA_GOOD}, amber ≥ {QA_WARN}, red below; grey has no data. High performing = QA at or above the team's QA target (≥ {QA_GOOD} unless set otherwise); Needs attention = QA below it. A KPI off its own target shows in amber on the card.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 xl:shrink-0">
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
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto sm:ml-auto">
            <SavedViewsMenu kind="dashboard" state={viewState} onApply={applyView} />
            <ExportCsvButton what="Team performance" columns={csvColumns} rows={visible} testId="dashboard-export" compact />
            {view === 'grid' && (
              <div
                className="hidden md:inline-flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900"
                role="group"
                aria-label="Cards per row"
                data-testid="grid-columns"
              >
                {([1, 2, 3] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setColumns(n)}
                    aria-pressed={columns === n}
                    aria-label={`${n} ${n === 1 ? 'card' : 'cards'} per row`}
                    title={n === 3 ? '3 per row (2 on tablets)' : n === 2 ? '2 per row' : '1 per row'}
                    data-testid={`grid-columns-${n}`}
                    className={cx(
                      'inline-flex h-8 w-8 items-center justify-center rounded text-sm font-medium tabular-nums transition-colors',
                      columns === n
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900" role="group" aria-label="Layout">
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
          </div>

          {teamsError ? (
            <div role="alert" data-testid="load-error" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {teamsError}
            </div>
          ) : visible.length === 0 ? (
            <Card><EmptyState title="No teams match" description="Adjust the filters or search term." /></Card>
          ) : (
            <div className={view === 'grid' ? GRID_CLASS[columns] : 'flex flex-col gap-3'} data-columns={view === 'grid' ? columns : undefined}>
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
      <KpiStatusModal
        isOpen={kpiModal !== null}
        onClose={() => setKpiModal(null)}
        initialTab={kpiModal ?? 'offTrack'}
        teams={summary?.kpiStatusTeams ?? []}
        onOpenTeam={(id) => {
          setKpiModal(null);
          const t = teams.find((x) => x.id === id);
          if (t) onTeamClick?.(t);
        }}
        onOpenTv={(id) => { setKpiModal(null); openTvMode(id); }}
        canOpenTv={() => true /* every listed team is in the caller's analytics scope (TV mode's rule) */}
      />
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
  none: 'text-slate-500 dark:text-slate-400',
};

const CompanyHero: React.FC<{ summary: CompanySummary | null; state: 'loading' | 'ready' | 'error'; onOpenKpiStatus: (tab: KpiTab) => void }> = ({ summary, state, onOpenKpiStatus }) => {
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
  const dist = s?.globalQaScoreDistribution;
  // The company-level targets in force today (target history), else the defaults.
  const companyTargets = s?.companyKpiTargets ?? KPI_TARGETS;

  const gauges: { label: string; value: number | null; good: number; warn: number; caption: string; title: string; confidence?: ConfidenceInfo; noun?: string }[] = [
    {
      label: 'Engineering health',
      value: num(s?.engineeringHealthScore),
      good: INDEX_GOOD, warn: INDEX_WARN,
      caption: s?.engineeringHealthScore == null
        ? 'No component has data'
        : missingHealth.length
          ? `Excludes ${missingHealth.map((m) => HEALTH_PART_LABEL[m] ?? m).join(', ')} (no data)`
          : 'Delivery, pipeline, debt, wellbeing survey',
      title: 'Weighted mean: delivery 35%, pipeline 25%, debt 20%, wellbeing (survey) 20%. Components without data are excluded, not replaced. Workload balance (derived) is not part of it.',
      confidence: s?.engineeringHealthConfidence, noun: 'components',
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
      confidence: s?.deliveryPerformanceConfidence, noun: 'teams',
    },
    {
      label: 'Wellbeing (survey)',
      value: num(s?.developerWellnessIndex),
      good: WELLBEING_BANDS.good, warn: WELLBEING_BANDS.warning,
      caption: s?.developerWellnessBasis
        ? s.developerWellnessBasis.teamsReporting > 0
          ? `${s.developerWellnessBasis.teamsReporting} of ${s.developerWellnessBasis.teamsTotal} teams · ${s.developerWellnessBasis.responses} responses`
          : s.developerWellnessBasis.teamsSuppressed > 0
            ? `Not shown: fewer than ${s.developerWellnessBasis.minResponses} responses per team`
            : 'No survey results yet'
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
  // Scoped callers (everyone but super admins) see the teams of their analytics scope only.
  const scoped = !!s?.scope && !s.scope.companyWide;
  const qaTitle = !scoped ? 'Global QA score' : s?.scope?.teamCount === 1 ? 'QA score' : 'QA score of your teams';

  // Top light (src/styles/top-light.css): the hero battery's band colour, none without a score.
  const topLight = topLightRgb(qa);

  return (
    <Card
      padded={false}
      className={cx('overflow-hidden', topLight && 'top-light')}
      style={topLight ? ({ '--tl': topLight } as React.CSSProperties) : undefined}
      data-testid="company-hero"
      data-top-light={topLight ? batteryBand(qa)!.key : 'none'}
    >
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white" data-testid="hero-title">{scoped ? (s?.scope?.teamCount === 1 ? 'Your team' : 'Your teams') : 'Company status'}</h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays size={13} className="text-slate-400" />
            {state === 'loading' ? 'Loading…' : asOf ? <>Data as of <span className="font-medium text-slate-700 dark:text-slate-200">{asOf}</span></> : 'No KPI snapshots recorded'}
          </span>
          {oldest && asOf && oldest !== asOf && <span>Oldest team snapshot {oldest}</span>}
          {state !== 'loading' && <LastUpdatedNote at={s?.lastUpdated} outdated={s?.dataOutdated} className="font-medium text-amber-700 dark:text-amber-400" />}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
        {/* Global QA score */}
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:border-r lg:border-slate-200 lg:dark:border-slate-800">
          <div className="flex items-center gap-6">
            <ScoreVisual value={qa} good={QA_GOOD} warn={QA_WARN} label={qaTitle} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400" data-testid="hero-qa-title">{qaTitle}</p>
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className={cx('text-5xl font-semibold tracking-tight tabular-nums', qa == null ? VALUE_TEXT.none : 'text-slate-900 dark:text-white')}>
                  {qa == null ? '—' : Math.round(qa)}
                </span>
                {qa != null && <span className="text-base text-slate-500 dark:text-slate-400">/ 100</span>}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {risk && <Badge tone={risk.tone}>{risk.label}</Badge>}
                {qa != null && <span className="text-xs text-slate-600 dark:text-slate-300" data-testid="global-qa-target">{statusWithTarget({ good: QA_GOOD, warning: QA_WARN, lowerIsBetter: false }, '/100', qaStatus === 'none' ? null : qaStatus)?.replace(/^On target · |^Off target · /, '')}</span>}
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
                <div className="mt-2 space-y-1">
                  <ConfidenceNote c={s.globalQaScoreConfidence} noun="teams" testId="global-qa-confidence" />
                  {dist && dist.count > 0 && (
                    <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="global-qa-distribution" title={dist.weighting}>
                      Weighted by team size · median <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{fmt(dist.median, 0)}</span>
                      {' · '}weakest 25% at or below <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{fmt(dist.p25, 0)}</span>
                      {' · '}lowest <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{fmt(dist.min, 0)}</span>
                    </p>
                  )}
                </div>
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
                  <ScoreVisual value={g.value} good={g.good} warn={g.warn} size="sm" label={g.label} />
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
                    {g.value != null && <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400" data-testid="gauge-target">{st === 'warning' ? `Watch: ${g.warn}–${g.good} · ` : ''}Target ≥ {g.good}</p>}
                    {g.confidence && g.value != null && <ConfidenceNote c={g.confidence} noun={g.noun} compact className="mt-1" testId={`confidence-${g.label}`} />}
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
          { label: 'Avg test coverage', v: num(s?.avgTestCoverage), target: companyTargets.coverage, higher: true },
          { label: 'Avg automation', v: num(s?.automationCoverage), target: companyTargets.automation, higher: true },
          { label: 'Avg flakiness', v: num(s?.avgFlakinessRate), target: companyTargets.flakiness, higher: false },
          { label: 'Avg escape rate', v: num(s?.avgDefectEscapeRate), target: companyTargets.escapeRate, higher: false },
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
          {kpi && kpi.onTrack + kpi.atRisk + kpi.offTrack > 0 ? (
            <button
              type="button"
              onClick={() => onOpenKpiStatus(kpi.offTrack > 0 ? 'offTrack' : kpi.atRisk > 0 ? 'atRisk' : 'onTrack')}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 hover:underline dark:text-slate-400 dark:hover:text-white"
              data-testid="kpi-status-open"
            >
              Teams vs KPI targets <ChevronRight size={12} aria-hidden="true" />
            </button>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">Teams vs KPI targets</p>
          )}
          {kpi && kpi.onTrack + kpi.atRisk + kpi.offTrack > 0 ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
              {([
                { l: 'on track', tab: 'onTrack', v: kpi.onTrack, c: 'bg-green-600 dark:bg-green-500' },
                { l: 'at risk', tab: 'atRisk', v: kpi.atRisk, c: 'bg-amber-500 dark:bg-amber-400' },
                { l: 'off track', tab: 'offTrack', v: kpi.offTrack, c: 'bg-red-600 dark:bg-red-500' },
              ] as const).map((k) => (
                <button
                  key={k.l}
                  type="button"
                  onClick={() => onOpenKpiStatus(k.tab)}
                  aria-label={`${k.v} teams ${k.l}: show details`}
                  data-testid={`kpi-status-${k.tab}`}
                  className="-mx-0.5 inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <span className={cx('h-1.5 w-1.5 rounded-full', k.c)} aria-hidden="true" />
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{k.v}</span> {k.l}
                </button>
              ))}
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{state === 'loading' ? '—' : 'No KPI data yet'}</p>
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

/** Status of a value against a target (good / warning thresholds); null without a target. */
const statusAgainst = (v: number, t?: { good: number; warning: number; lowerIsBetter: boolean } | null): 'good' | 'warning' | 'critical' | null => {
  if (!t) return null;
  if (t.lowerIsBetter) return v <= t.good ? 'good' : v <= t.warning ? 'warning' : 'critical';
  return v >= t.good ? 'good' : v >= t.warning ? 'warning' : 'critical';
};

const TeamCard: React.FC<{ row: Row; layout: ViewMode; primary: boolean; onOpen: () => void }> = ({ row: r, layout, primary, onOpen }) => {
  const staleCount = Object.values(r.staleness).filter((x) => x.stale).length;
  const meta = STATUS_META[r.status];
  const asOf = fmtDate(r.snapshotDate);
  const isList = layout === 'list';

  const kpis = (
    <dl className={cx('grid gap-x-4 gap-y-3', isList ? 'grid-cols-3 sm:grid-cols-5 lg:flex-1' : 'grid-cols-3 xl:grid-cols-5')}>
      {KPI_FIELDS.map((f) => {
        const v = r[f.key];
        const stale = r.staleness[f.metric]?.stale ? r.staleness[f.metric] : null;
        // Judged with the target valid at the value's date; a stale value is shown, not judged.
        const judged = v == null || stale ? null : statusAgainst(v, r.thresholds?.[f.metric]) ?? getMetricStatus(v, f.metric);
        const st = judged === 'none' ? null : judged;
        // The target valid at the value's date (else the default), shown under the value.
        const t = r.thresholds?.[f.metric] ?? (METRICS_CONFIG[f.metric] as { good: number; warning: number; lowerIsBetter: boolean } | undefined) ?? null;
        const unit = f.suffix === '%' ? '%' : '';
        const short = t ? `${t.lowerIsBetter ? '≤' : '≥'} ${t.good}${unit}` : null;
        return (
          <div key={f.key} className="min-w-0">
            <dt className="truncate text-xs text-slate-500 dark:text-slate-400">{f.label}</dt>
            <dd className="mt-0.5 flex items-center gap-1.5">
              <span
                className={cx('text-sm font-semibold tabular-nums', v == null || stale ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white')}
                title={stale ? `Stale since ${stale.staleSince ? fmtDate(stale.staleSince) : '—'}: not judged` : undefined}
                data-stale={stale ? 'true' : undefined}
              >
                {fmt(v, f.digits, f.suffix)}
              </span>
              {st && <span className={cx('h-1.5 w-1.5 flex-shrink-0 rounded-full', METRIC_DOT[st])} title={statusWithTarget(t, unit, st) ?? undefined} aria-hidden="true" />}
              {stale && <span className="sr-only">(stale)</span>}
              {st && <span className="sr-only">{statusWithTarget(t, unit, st)}</span>}
            </dd>
            {short && (
              <dd className={cx('truncate text-[11px] leading-tight', st === 'critical' ? 'text-red-700 dark:text-red-400' : st === 'warning' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400')} title={targetLabel(t, unit) ?? undefined} data-testid="team-card-target" aria-hidden="true">
                Target {short}
              </dd>
            )}
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
        'group relative flex cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition-[box-shadow,border-color] duration-150',
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
              <ScoreVisual value={r.qa} good={QA_GOOD} warn={QA_WARN} size="xs" label={`${r.name} QA score`} />
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">QA score</p>
                <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white" data-testid="team-card-qa">
                  {r.qa == null ? '—' : Math.round(r.qa)}
                  {r.qa != null && <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">/ 100</span>}
                </p>
                {r.qa != null && <p className="text-[11px] leading-tight text-slate-500 dark:text-slate-400" data-testid="team-card-qa-target">{targetLabel(r.thresholds?.qaScore ?? { good: QA_GOOD, warning: QA_WARN, lowerIsBetter: false }, '/100')}</p>}
                <ConfidenceNote c={r.confidence} compact testId="team-card-confidence" />
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
            {staleCount > 0 && <span className="ml-1 font-medium text-amber-700 dark:text-amber-400">· {staleCount} stale</span>}
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
