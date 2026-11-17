import React, { useEffect, useMemo, useState } from 'react';
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Sparkles, X, Loader2 } from 'lucide-react';
import API_URL from '../config/api';
import type { Team } from '../data/mockData';
import { KPI_TARGETS, teamAttentionIssues } from '../config/metricsConfig';
import { QA_SCORE_THRESHOLDS } from '../../server/lib/metricFormulas';
import { useAuth } from '../contexts/AuthContext';
import {
  Page, PageIntro, Card, CardHeader, StatTile, Badge, ProgressBar, SegmentedControl, EmptyState,
  buttonClass, inputClass, scoreTone, cx, type Tone,
} from './ui';

interface NewDashboardProps {
  teams: Team[];
  onTeamClick?: (team: Team) => void;
  // Accepted for compatibility with App; the table layout replaces grid/3D modes.
  gridColumns?: 1 | 2 | 3;
  is3DMode?: boolean;
}

interface CompanySummary {
  globalQaScore: number | null;
  asOf?: string | null;
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
  topImproving: { name: string; score: number }[];
  needsAttention: { name: string; score: number; issue: string }[];
  kpiStatus: { onTrack: number; atRisk: number; offTrack: number };
  aiSummary?: string;
  teamCount: number;
  teamsWithKpiData: number;
}

type Filter = 'all' | 'high' | 'attention';
type SortKey = 'name' | 'department' | 'qa' | 'coverage' | 'flakiness' | 'defects' | 'automation' | 'deploys';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmt = (v: number | null, digits = 0, suffix = '') =>
  v == null ? '—' : `${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;

const RISK: Record<CompanySummary['riskLevel'], { label: string; tone: Tone }> = {
  stable: { label: 'Stable', tone: 'good' },
  watch: { label: 'Watch', tone: 'warn' },
  'at-risk': { label: 'At risk', tone: 'bad' },
  unknown: { label: 'Insufficient data', tone: 'neutral' },
};

interface Row {
  team: Team;
  name: string;
  department: string;
  qa: number | null;
  coverage: number | null;
  flakiness: number | null;
  defects: number | null;
  automation: number | null;
  escapeRate: number | null;
  deploys: number | null;
}

const QA_GOOD = QA_SCORE_THRESHOLDS.good;
const QA_WARN = QA_SCORE_THRESHOLDS.warning;

const NewDashboard: React.FC<NewDashboardProps> = ({ teams, onTeamClick }) => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<CompanySummary | null>(null);
  const [summaryState, setSummaryState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'qa', dir: 'desc' });
  const [briefingOpen, setBriefingOpen] = useState(false);

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
    return {
      team: t,
      name: t.name,
      department: t.department || '—',
      qa: num(t.qaScore),
      coverage: num(k.testCoverage),
      flakiness: num(k.testFlakinessRate),
      defects: num(k.defectDensity),
      automation: num(k.automationCoverage),
      escapeRate: num(k.defectEscapeRate),
      deploys: num(k.deploymentFrequencyPerWeek),
    };
  }), [teams]);

  const departments = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department).filter((d) => d && d !== '—'))).sort(),
    [rows],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (department !== 'all' && r.department !== department) return false;
      if (filter === 'high' && !(r.qa != null && r.qa >= QA_GOOD)) return false;
      // Same rule as the "Needs attention" card (server company-summary uses teamAttentionIssues too).
      if (filter === 'attention' && !(r.qa != null && teamAttentionIssues({ qaScore: r.qa, testCoverage: r.coverage, testFlakinessRate: r.flakiness, defectEscapeRate: r.escapeRate, automationCoverage: r.automation }).length > 0)) return false;
      return !q || r.name.toLowerCase().includes(q);
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sort.key] as any, bv = b[sort.key] as any;
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // missing data always last
      if (bv == null) return -1;
      return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * dir;
    });
  }, [rows, search, department, filter, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'department' ? 'asc' : 'desc' }));

  const SortHeader: React.FC<{ k: SortKey; label: string; align?: 'left' | 'right' }> = ({ k, label, align = 'right' }) => {
    const active = sort.key === k;
    const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th className={cx('px-3 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap', align === 'right' ? 'text-right' : 'text-left')}>
        <button onClick={() => toggleSort(k)} className={cx('inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white', active && 'text-slate-900 dark:text-white')}>
          {label}
          <Icon size={12} className={active ? '' : 'opacity-40'} />
        </button>
      </th>
    );
  };

  const kpi = summary?.kpiStatus;
  const kpiTotal = kpi ? kpi.onTrack + kpi.atRisk + kpi.offTrack : 0;
  const risk = summary ? RISK[summary.riskLevel] ?? RISK.unknown : RISK.unknown;
  const canBrief = user?.role === 'super_admin' || user?.role === 'qa_manager' || user?.role === 'team_lead';

  return (
    <Page>
      <div data-testid="dashboard">
        <PageIntro
          title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${user?.firstName ?? ''}`.trim()}
          description={
            summary
              ? `Engineering quality across ${summary.teamCount} teams · ${summary.teamsWithKpiData} reporting KPI data${summary.asOf ? ` · latest data ${new Date(summary.asOf).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`
              : 'Engineering quality across your organisation'
          }
          actions={canBrief && (
            <button className={buttonClass.secondary} onClick={() => setBriefingOpen(true)}>
              <Sparkles size={15} /> Executive briefing
            </button>
          )}
        />

        {/* Executive KPIs */}
        {summaryState === 'error' ? (
          <Card className="mb-6"><EmptyState title="Company summary unavailable" description="The organisation-wide metrics could not be loaded. Team data below is unaffected." /></Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
            <div className="col-span-2 md:col-span-1 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Global QA score</p>
                {summary && <Badge tone={risk.tone}>{risk.label}</Badge>}
              </div>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white tabular-nums">
                {summary?.globalQaScore != null ? Math.round(summary.globalQaScore) : '—'}
                <span className="ml-1 text-sm font-normal text-slate-500">/ 100</span>
              </p>
              {summary?.globalQaScore != null && <ProgressBar value={summary.globalQaScore} tone={scoreTone(summary.globalQaScore, QA_GOOD, QA_WARN)} className="mt-3" />}
            </div>
            {[
              { label: 'Engineering health', v: summary?.engineeringHealthScore, caption: 'Composite quality index' },
              { label: 'Delivery (DORA)', v: summary?.deliveryPerformanceScore, caption: 'Deploy frequency, lead time, CFR, MTTR' },
              { label: 'Workload balance (derived)', v: summary?.developerWellnessIndex, caption: 'From focus, meetings, context switches, PR and review times' },
              { label: 'Debt health', v: summary?.techDebtStatusScore, caption: '100 = no open debt items' },
              { label: 'Pipeline health', v: summary?.pipelineHealthScore, caption: 'Successful pipeline runs, 30 days' },
            ].map((t) => {
              const v = num(t.v);
              return (
                <StatTile
                  key={t.label}
                  label={t.label}
                  value={v == null ? '—' : Math.round(v)}
                  unit={v == null ? undefined : '/ 100'}
                  progress={v ?? undefined}
                  tone={scoreTone(v)}
                  caption={<span className="text-slate-500 dark:text-slate-400">{t.caption}</span>}
                />
              );
            })}
          </div>
        )}

        {/* Indicators, status, attention */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader title="Quality indicators" subtitle="Average of each team's latest snapshot" />
            <dl className="space-y-3.5">
              {[
                // One set of targets (KPI_TARGETS in metricsConfig), shared with the server's KPI status
                { label: 'Test coverage', v: summary?.avgTestCoverage, target: KPI_TARGETS.coverage, higherBetter: true },
                { label: 'Automation coverage', v: summary?.automationCoverage, target: KPI_TARGETS.automation, higherBetter: true },
                { label: 'Test flakiness', v: summary?.avgFlakinessRate, target: KPI_TARGETS.flakiness, higherBetter: false },
                { label: 'Defect escape rate', v: summary?.avgDefectEscapeRate, target: KPI_TARGETS.escapeRate, higherBetter: false },
              ].map((m) => {
                const v = num(m.v);
                const ok = v == null ? null : m.higherBetter ? v >= m.target : v <= m.target;
                return (
                  <div key={m.label} className="flex items-center justify-between gap-3 text-sm">
                    <dt className="text-slate-600 dark:text-slate-300">{m.label}</dt>
                    <dd className="flex items-center gap-2">
                      <span className="font-medium tabular-nums text-slate-900 dark:text-white">{fmt(v, 1, '%')}</span>
                      <span className="text-xs text-slate-400 w-20 text-right whitespace-nowrap">target {m.higherBetter ? '≥' : '≤'} {m.target}%</span>
                      <span className={cx('h-2 w-2 rounded-full', ok == null ? 'bg-slate-300' : ok ? 'bg-green-600' : 'bg-amber-500')} />
                    </dd>
                  </div>
                );
              })}
            </dl>
          </Card>

          <Card>
            <CardHeader title="KPI status" subtitle="Teams against their quality targets" />
            {kpi && kpiTotal > 0 ? (
              <>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="bg-green-600" style={{ width: `${(kpi.onTrack / kpiTotal) * 100}%` }} />
                  <div className="bg-amber-500" style={{ width: `${(kpi.atRisk / kpiTotal) * 100}%` }} />
                  <div className="bg-red-600" style={{ width: `${(kpi.offTrack / kpiTotal) * 100}%` }} />
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3">
                  {[
                    { l: 'On track', v: kpi.onTrack, c: 'bg-green-600' },
                    { l: 'At risk', v: kpi.atRisk, c: 'bg-amber-500' },
                    { l: 'Off track', v: kpi.offTrack, c: 'bg-red-600' },
                  ].map((s) => (
                    <div key={s.l}>
                      <dt className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><span className={cx('h-2 w-2 rounded-full', s.c)} />{s.l}</dt>
                      <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900 dark:text-white">{s.v}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <p className="text-sm text-slate-500">No KPI data yet.</p>
            )}
            {summary?.aiSummary && (
              <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">{summary.aiSummary}</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Needs attention" subtitle={`QA score below ${QA_WARN} or a KPI off target`} />
            {summary?.needsAttention?.length ? (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800 -my-2">
                {summary.needsAttention.map((t) => (
                  <li key={t.name} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{t.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{t.issue}</p>
                    </div>
                    <span className={cx('text-sm font-semibold tabular-nums', scoreTone(t.score, QA_GOOD, QA_WARN) === 'bad' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400')}>{t.score}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No teams flagged.</p>
            )}
          </Card>
        </div>

        {/* Teams table */}
        <Card padded={false}>
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Team performance</h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Latest KPI snapshot per team · select a team for detail</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SegmentedControl<Filter>
                value={filter}
                onChange={setFilter}
                options={[{ value: 'all', label: 'All' }, { value: 'high', label: 'High performing' }, { value: 'attention', label: 'Needs attention' }]}
              />
              {departments.length > 1 && (
                <select value={department} onChange={(e) => setDepartment(e.target.value)} className={cx(inputClass, 'pr-8')} aria-label="Department">
                  <option value="all">All departments</option>
                  {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              <div className="relative">
                <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search teams" className={cx(inputClass, 'pl-8 w-full sm:w-56')} />
              </div>
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState title="No teams match" description="Adjust the filters or search term." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <SortHeader k="name" label="Team" align="left" />
                    <SortHeader k="department" label="Department" align="left" />
                    <SortHeader k="qa" label="QA score" align="left" />
                    <SortHeader k="coverage" label="Coverage" />
                    <SortHeader k="flakiness" label="Flakiness" />
                    <SortHeader k="defects" label="Defects / KLOC" />
                    <SortHeader k="automation" label="Automation" />
                    <SortHeader k="deploys" label="Deploys / wk" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visible.map((r) => {
                    const tone = scoreTone(r.qa, QA_GOOD, QA_WARN);
                    return (
                      <tr
                        key={r.team.id}
                        data-testid="team-card"
                        onClick={() => onTeamClick?.(r.team)}
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <td className="px-3 py-3 font-medium text-slate-900 dark:text-white whitespace-nowrap max-w-[18rem] truncate">{r.name}</td>
                        <td className="px-3 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">{r.department}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5 min-w-[7.5rem]">
                            <span className="w-8 tabular-nums font-semibold text-slate-900 dark:text-white">{fmt(r.qa)}</span>
                            <ProgressBar value={r.qa ?? 0} tone={tone} className="w-16" />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmt(r.coverage, 1, '%')}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmt(r.flakiness, 1, '%')}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmt(r.defects, 2)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmt(r.automation, 1, '%')}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmt(r.deploys, 1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {briefingOpen && <BriefingDrawer onClose={() => setBriefingOpen(false)} />}
    </Page>
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
    <div className="fixed inset-0 z-50 flex justify-end">
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
