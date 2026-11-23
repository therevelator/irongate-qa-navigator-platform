import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BellRing, ChevronDown, CircleDollarSign, Minus, RefreshCw, Share2, TrendingDown, TrendingUp, WifiOff,
} from 'lucide-react';
import toast from 'react-hot-toast';
import API_URL from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import ScoreVisual from './ScoreVisual';
import { LastUpdatedNote } from './LastUpdatedNote';
import { fmtMoney } from './RevenueImpact';
import { Badge, cx, type Tone } from './ui';
import { formatAsOf } from '../data/advancedFeatures';

/**
 * Executive summary (/summary): the scope's quality status readable in one minute on a phone
 * (390 px) and on a desktop. One call (GET /api/summary, server/routes/summary.ts) gives every
 * figure, for the caller's scope only (a manager: their departments; a team lead: their team).
 *
 * - Quality: the scope's QA score (Battery or Gauge, as chosen in Appearance), status, target and
 *   the change since last week; then the 3 biggest risks and the 3 most improved teams, money at
 *   risk (the Business impact roll-up, as a range, with a link to its assumptions), open alerts
 *   and what changed since last week.
 * - Works "offline-ish": the last summary is kept in this browser (per person) and shown with the
 *   time it was loaded when the network is gone; it reloads when the connection returns, when the
 *   page becomes visible again and every 5 minutes.
 * - Share: the link (/summary) opens the summary for whoever signs in, for their own scope.
 */

export interface SummaryForecast { metric: string; outlook: string | null; crossingDay: string | null; text: string; confidence: 'high' | 'medium' | 'low' | null }
export interface SummaryRiskItem {
  key: string; label: string; value: number; target: number; lowerIsBetter: boolean; unit: string;
  weekChange: number | null; trend: 'better' | 'worse' | 'same' | null;
  /** "At this rate …" from the team's forecast of this metric (v2 phase 4), when there is one. */
  forecast?: SummaryForecast | null;
}
export interface ExecutiveSummaryData {
  scope: { level: string; label: string; companyName: string | null; teamCount: number; departments: string[] };
  empty: boolean;
  generatedAt: string;
  quality: {
    score: number | null; status: 'good' | 'warning' | 'critical' | null; thresholds: { good: number; warning: number };
    weekChange: number | null; confidence: { inputsUsed: number; inputsTotal: number; confidence: 'high' | 'medium' | 'low' } | null;
    teamsWithData: number; teamCount: number; kpiStatus: { onTrack: number; atRisk: number; offTrack: number; noData: number };
    asOf: string | null; lastUpdated: string | null; dataOutdated: boolean; sampleData: boolean;
  } | null;
  risks: { top: Array<{ teamId: string; teamName: string; departmentName: string | null; qaScore: number | null; status: 'good' | 'warning' | 'critical' | null; weekChange: number | null; items: SummaryRiskItem[] }>; total: number };
  improved: { top: Array<{ teamId: string; teamName: string; departmentName: string | null; qaScore: number; prevQaScore: number; weekChange: number }>; total: number };
  /** On target now, forecast to miss within 8 weeks (soonest first). */
  upcoming?: { top: Array<{ teamId: string; teamName: string; departmentName: string | null; metric: string; label: string; crossingDay: string; text: string; confidence: 'high' | 'medium' | 'low' | null }>; total: number };
  money: null | { available: false; reason: string; assumptionsPath: string } | {
    available: true;
    stake: { monthly: number | null; monthlyLow: number | null; monthlyHigh: number | null; annual: number | null; annualLow: number | null; annualHigh: number | null };
    debt: { monthly: number | null; annual: number | null };
    teamsContributing: number; teamsLacking: number; teams: number; sampleData: boolean; caveats: string[]; assumptionsPath: string;
  };
  alerts: { open: number; acknowledged: number; critical: number; warning: number; info: number; openedThisWeek: number; resolvedThisWeek: number } | null;
  sinceLastWeek: {
    qaScoreChange: number | null;
    movement: { up: number; down: number; same: number; compared: number };
    statusChanges: Array<{ teamId: string; teamName: string; from: 'good' | 'warning' | 'critical'; to: 'good' | 'warning' | 'critical'; better: boolean }>;
    alertsOpened: number; alertsResolved: number; actionsDone: number; actionsCreated: number; actionsOverdue: number;
  } | null;
  teams: Array<{ teamId: string; teamName: string; departmentName: string | null; qaScore: number | null; status: 'good' | 'warning' | 'critical' | null; weekChange: number | null; snapshotDate: string | null }>;
  text: { risks: string; improved: string; lastWeek: string; money: string; upcoming?: string };
}

const CACHE_PREFIX = 'irongate_summary_cache:';
const REFRESH_MS = 5 * 60_000;
export const SUMMARY_PATH = '/summary';

const STATUS: Record<'good' | 'warning' | 'critical', { label: string; tone: Tone; dot: string }> = {
  good: { label: 'On target', tone: 'good', dot: 'bg-green-600 dark:bg-green-500' },
  warning: { label: 'Watch', tone: 'warn', dot: 'bg-amber-500 dark:bg-amber-400' },
  critical: { label: 'Off target', tone: 'bad', dot: 'bg-red-600 dark:bg-red-500' },
};

const readCache = (key: string): { data: ExecutiveSummaryData; loadedAt: string } | null => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && v.data && v.loadedAt ? v : null;
  } catch { return null; }
};
const writeCache = (key: string, data: ExecutiveSummaryData, loadedAt: string) => {
  try { window.localStorage.setItem(key, JSON.stringify({ data, loadedAt })); } catch { /* storage full or blocked: no offline copy */ }
};

const timeText = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayTimeText = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? `today at ${timeText(iso)}` : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} at ${timeText(iso)}`;
};

const num = (v: number, digits = 1) => (Number.isInteger(v) ? String(v) : v.toFixed(digits));
const unitOf = (u: string) => (u === '%' ? '%' : '');
const pts = (u: string) => (u === '%' || u === '/100' ? ' pts' : '');
const targetText = (i: Pick<SummaryRiskItem, 'target' | 'lowerIsBetter' | 'unit'>) => `Target ${i.lowerIsBetter ? '≤' : '≥'} ${num(i.target)}${unitOf(i.unit)}`;

/** "+1 pt better", "−3.2 pts worse", "no change": arrow + amount + word (never colour alone). */
export const WeekChange: React.FC<{ change: number | null; trend?: 'better' | 'worse' | 'same' | null; unit?: string; lowerIsBetter?: boolean; className?: string; testId?: string }> = ({ change, trend, unit = '/100', lowerIsBetter = false, className, testId }) => {
  if (change === null) return <span className={cx('text-slate-500 dark:text-slate-400', className)} data-testid={testId}>no value last week</span>;
  const t = trend ?? (change === 0 ? 'same' : (change < 0) === lowerIsBetter ? 'better' : 'worse');
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  const amount = Math.abs(change);
  const u = pts(unit);
  const one = amount === 1 && u === ' pts' ? ' pt' : u;
  return (
    <span
      className={cx('inline-flex items-center gap-0.5 whitespace-nowrap font-medium', t === 'better' ? 'text-green-700 dark:text-green-400' : t === 'worse' ? 'text-red-700 dark:text-red-400' : 'text-slate-600 dark:text-slate-300', className)}
      data-testid={testId}
    >
      <Icon size={15} aria-hidden className="flex-shrink-0" />
      {change === 0 ? 'no change' : <>{change > 0 ? '+' : '−'}{num(amount)}{one} {t === 'better' ? 'better' : 'worse'}</>}
    </span>
  );
};

/** In-app link: a real address (open in a new tab, copy), followed without a page load. */
const AppLink: React.FC<{ href: string; className?: string; children: React.ReactNode; testId?: string }> = ({ href, className, children, testId }) => (
  <a
    href={href}
    className={className}
    data-testid={testId}
    onClick={(e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      window.history.pushState(null, '', href);
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    }}
  >
    {children}
  </a>
);

const Section: React.FC<{ title: string; subtitle?: string; testId: string; children: React.ReactNode; icon?: React.ReactNode; count?: React.ReactNode; className?: string }> = ({ title, subtitle, testId, children, icon, count, className }) => (
  <section className={cx(className, 'rounded-xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900')} aria-labelledby={`${testId}-title`} data-testid={testId}>
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={`${testId}-title`} className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">{icon}{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {count}
    </div>
    {children}
  </section>
);

const ExecutiveSummary: React.FC = () => {
  const { user } = useAuth();
  const cacheKey = `${CACHE_PREFIX}${user?.id ?? 'anonymous'}`;
  const [cached] = useState(() => readCache(cacheKey));
  const [data, setData] = useState<ExecutiveSummaryData | null>(cached?.data ?? null);
  const [loadedAt, setLoadedAt] = useState<string | null>(cached?.loadedAt ?? null);
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const lastFetch = useRef(0);

  const load = useCallback(async () => {
    lastFetch.current = Date.now();
    setRefreshing(true);
    try {
      const res = await fetch(`${API_URL}/summary`, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw Object.assign(new Error(String(res.status)), { http: res.status });
      const body: ExecutiveSummaryData = await res.json();
      const at = new Date().toISOString();
      setData(body);
      setLoadedAt(at);
      setState('ready');
      writeCache(cacheKey, body, at);
    } catch (e: any) {
      // A server answer (5xx) is an error; no answer at all is offline. Either way the last copy stays.
      setState(e?.http ? 'error' : 'offline');
    } finally {
      setRefreshing(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - lastFetch.current > 30_000) load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', load);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', load); };
  }, [load]);

  const share = async () => {
    const url = `${window.location.origin}${SUMMARY_PATH}`;
    const title = 'QE Navigator: executive summary';
    const nav = navigator as Navigator & { share?: (d: { title: string; text?: string; url: string }) => Promise<void> };
    if (typeof nav.share === 'function' && window.matchMedia?.('(pointer: coarse)').matches) {
      try { await nav.share({ title, text: 'Quality at a glance. Sign in to see the summary for your teams.', url }); return; } catch { /* cancelled: fall back to copying */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Summary link copied. Whoever opens it signs in and sees the summary for their own teams.', { id: 'summary-share' });
    } catch {
      toast.error(`Copy this link: ${url}`, { id: 'summary-share' });
    }
  };

  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Executive summary</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white" data-testid="summary-scope">
          {data?.scope.label ?? 'Quality at a glance'}
        </h1>
        {data && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {data.scope.teamCount} {data.scope.teamCount === 1 ? 'team' : 'teams'}
            {data.scope.level === 'company' ? ' · whole company' : data.scope.level === 'department' ? ' · your departments' : ' · your teams'}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => load()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          data-testid="summary-refresh"
          aria-label="Reload the summary"
        >
          <RefreshCw size={16} aria-hidden className={cx(refreshing && 'animate-spin motion-reduce:animate-none')} /> Reload
        </button>
        <button
          type="button"
          onClick={share}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800 sm:flex-none dark:bg-brand-500 dark:text-slate-950 dark:hover:bg-brand-400"
          data-testid="summary-share"
        >
          <Share2 size={16} aria-hidden /> Share link
        </button>
      </div>
    </div>
  );

  const freshness = (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600 dark:text-slate-300" data-testid="summary-loaded" aria-live="polite">
      {state === 'offline' || state === 'error' ? (
        <span className="inline-flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
          <WifiOff size={15} aria-hidden />
          {state === 'offline' ? 'Offline' : 'Could not reload'}{loadedAt ? ` · showing the summary loaded ${dayTimeText(loadedAt)}` : ''}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cx('h-2 w-2 rounded-full', state === 'ready' ? 'bg-green-600 dark:bg-green-500' : 'bg-slate-400')} />
          {state === 'loading' && !loadedAt ? 'Loading…' : loadedAt ? `Loaded ${dayTimeText(loadedAt)}` : ''}
        </span>
      )}
      {data?.quality?.asOf && <span className="text-slate-500 dark:text-slate-400">· data as of {formatAsOf(data.quality.asOf)}</span>}
      {data?.quality && <LastUpdatedNote at={data.quality.lastUpdated} outdated={data.quality.dataOutdated} className="font-medium text-amber-700 dark:text-amber-400" />}
      {data?.quality?.sampleData && <Badge tone="neutral">Includes sample data</Badge>}
    </p>
  );

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-8 sm:py-8" data-testid="executive-summary">
      <div className="flex flex-col gap-4">
        {header}
        {freshness}
        {children}
      </div>
    </div>
  );

  if (!data) {
    return shell(
      state === 'loading' ? (
        <div className="space-y-3" aria-hidden>
          {[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-200/70 motion-reduce:animate-none dark:bg-slate-800/70" />)}
        </div>
      ) : (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="summary-unavailable">
          <p className="font-semibold">{state === 'offline' ? 'You are offline' : 'The summary could not be loaded'}</p>
          <p className="mt-1 text-sm">It reloads on its own when the connection returns. Use Reload to try now.</p>
        </div>
      ),
    );
  }

  if (data.empty || !data.quality) {
    return shell(
      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900" data-testid="summary-empty">
        <p className="text-base font-semibold text-slate-900 dark:text-white">No team to summarise</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">The summary covers the teams in your scope. You are not assigned to a team you can view; ask an administrator to add you to one.</p>
      </div>,
    );
  }

  const q = data.quality;
  const st = q.status ? STATUS[q.status] : null;
  const title = data.scope.level === 'company' ? 'Company QA score' : data.scope.teamCount === 1 ? 'Team QA score' : 'QA score of your teams';
  const money = data.money;
  const since = data.sinceLastWeek!;
  const alerts = data.alerts!;

  return shell(
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-flow-row-dense lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
      {/* Quality status */}
      <section className="h-full rounded-xl border border-slate-200 bg-white p-4 sm:p-5 lg:col-span-2 dark:border-slate-800 dark:bg-slate-900" aria-labelledby="summary-quality-title" data-testid="summary-quality">
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="flex-shrink-0">
            <ScoreVisual value={q.score} good={q.thresholds.good} warn={q.thresholds.warning} size="md" label={title} />
          </div>
          <div className="min-w-0">
            <h2 id="summary-quality-title" className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</h2>
            <p className="flex items-baseline gap-1.5">
              <span className="text-5xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-white" data-testid="summary-qa-score">{q.score ?? '—'}</span>
              {q.score !== null && <span className="text-base text-slate-500 dark:text-slate-400">/ 100</span>}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              {st && <Badge tone={st.tone} className="text-sm">{st.label}</Badge>}
              <span className="text-slate-600 dark:text-slate-300">Target ≥ {q.thresholds.good}</span>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm">
              <WeekChange change={q.weekChange} testId="summary-qa-change" /> <span className="text-slate-500 dark:text-slate-400">since last week</span>
            </p>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-200 pt-3 text-center dark:border-slate-800" data-testid="summary-kpi-status">
          {([['onTrack', 'On track', 'text-green-700 dark:text-green-400'], ['atRisk', 'At risk', 'text-amber-700 dark:text-amber-400'], ['offTrack', 'Off track', 'text-red-700 dark:text-red-400']] as const).map(([k, label, cls]) => (
            <div key={k}>
              <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
              <dd className={cx('text-2xl font-semibold tabular-nums', cls)}>{q.kpiStatus[k]}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Teams vs their KPI targets · {q.teamsWithData} of {q.teamCount} {q.teamCount === 1 ? 'team has' : 'teams have'} a current QA score{q.confidence ? ` · ${q.confidence.confidence} confidence` : ''}
        </p>
      </section>

      {/* Two headline tiles: open alerts and money at risk */}
      <div className="grid h-full grid-cols-2 gap-3 lg:grid-cols-1">
        <AppLink
          href="/notifications"
          testId="summary-alerts"
          className="flex min-h-[7rem] flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300"><BellRing size={16} aria-hidden /> Open alerts</span>
          <span className="text-4xl font-semibold tabular-nums text-slate-900 dark:text-white" data-testid="summary-alerts-open">{alerts.open + alerts.acknowledged}</span>
          <span className="text-xs text-slate-600 dark:text-slate-300">
            {alerts.critical > 0 ? <span className="font-semibold text-red-700 dark:text-red-400">{alerts.critical} critical</span> : 'None critical'}
            {alerts.acknowledged > 0 ? ` · ${alerts.acknowledged} acknowledged` : ''}
          </span>
        </AppLink>
        <a
          href="#summary-money"
          className="flex min-h-[7rem] flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
          data-testid="summary-money-tile"
          onClick={(e) => { e.preventDefault(); document.getElementById('summary-money')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300"><CircleDollarSign size={16} aria-hidden /> Money at risk</span>
          {money?.available && money.stake.monthlyLow !== null && money.stake.monthlyHigh !== null ? (
            <>
              <span className="whitespace-nowrap text-xl font-semibold tabular-nums leading-tight text-slate-900 min-[400px]:text-2xl sm:text-3xl dark:text-white" data-testid="summary-money-tile-range">{fmtMoney(money.stake.monthlyLow)}–{fmtMoney(money.stake.monthlyHigh)}</span>
              <span className="text-xs text-slate-600 dark:text-slate-300">per month, revenue at stake</span>
            </>
          ) : (
            <>
              <span className="text-2xl font-semibold text-slate-500 dark:text-slate-400">—</span>
              <span className="text-xs text-slate-600 dark:text-slate-300">{money?.available ? 'Not enough history yet' : 'Managers and admins'}</span>
            </>
          )}
        </a>
      </div>

      {/* Since last week */}
      <Section title="Since last week" subtitle={data.text.lastWeek} testId="summary-since">
        <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
          <li className="flex items-start justify-between gap-3" data-testid="summary-since-qa">
            <span>QA score</span>
            <WeekChange change={since.qaScoreChange} />
          </li>
          <li className="flex items-start justify-between gap-3" data-testid="summary-since-movement">
            <span>Teams</span>
            <span className="text-right">
              {since.movement.compared === 0 ? 'no snapshot last week' : (
                <><span className="font-semibold text-green-700 dark:text-green-400">{since.movement.up} up</span> · <span className="font-semibold text-red-700 dark:text-red-400">{since.movement.down} down</span>{since.movement.same ? ` · ${since.movement.same} same` : ''}</>
              )}
            </span>
          </li>
          {since.statusChanges.map((c) => (
            <li key={c.teamId} className="flex items-start justify-between gap-3" data-testid="summary-status-change">
              <span className="min-w-0 truncate">{c.teamName}</span>
              <span className={cx('whitespace-nowrap font-medium', c.better ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')}>
                {STATUS[c.from].label} → {STATUS[c.to].label}
              </span>
            </li>
          ))}
          <li className="flex items-start justify-between gap-3" data-testid="summary-since-alerts">
            <span>Alerts</span>
            <span className="text-right">{since.alertsOpened} opened · {since.alertsResolved} resolved</span>
          </li>
          <li className="flex items-start justify-between gap-3" data-testid="summary-since-actions">
            <span>Tracked actions</span>
            <span className="text-right">
              {since.actionsDone} done · {since.actionsCreated} new{since.actionsOverdue > 0 && <> · <span className="font-semibold text-red-700 dark:text-red-400">{since.actionsOverdue} overdue</span></>}
            </span>
          </li>
        </ul>
      </Section>

      {/* Biggest risks */}
      <Section
        className="lg:row-span-2"
        title="Biggest risks"
        subtitle={data.text.risks}
        testId="summary-risks"
        icon={<AlertTriangle size={17} className="text-red-600 dark:text-red-400" aria-hidden />}
        count={data.risks.total > data.risks.top.length ? <span className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">{data.risks.top.length} of {data.risks.total}</span> : undefined}
      >
        {data.risks.top.length === 0 ? (
          <p className="text-sm font-medium text-green-700 dark:text-green-400">Every team is on target. Nothing to flag.</p>
        ) : (
          <ol className="space-y-2.5">
            {data.risks.top.map((r, i) => <RiskCard key={r.teamId} risk={r} rank={i + 1} />)}
          </ol>
        )}
      </Section>

      {/* Coming risks: on target now, forecast to miss */}
      {data.upcoming && data.upcoming.total > 0 && (
        <Section
          title="At this rate"
          subtitle={data.text.upcoming}
          testId="summary-upcoming"
          icon={<TrendingDown size={17} className="text-amber-600 dark:text-amber-400" aria-hidden />}
          count={data.upcoming.total > data.upcoming.top.length ? <span className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">{data.upcoming.top.length} of {data.upcoming.total}</span> : undefined}
        >
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.upcoming.top.map((u) => (
              <li key={`${u.teamId}-${u.metric}`} className="py-2" data-testid="summary-upcoming-item">
                <p className="break-words font-medium leading-snug text-slate-900 dark:text-white">{u.teamName}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">{u.text}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Most improved */}
      <Section title="Most improved" subtitle={data.text.improved} testId="summary-improved" icon={<TrendingUp size={17} className="text-green-600 dark:text-green-400" aria-hidden />}>
        {data.improved.top.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">No team’s QA score rose since last week.</p>
        ) : (
          <ol className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.improved.top.map((t, i) => (
              <li key={t.teamId} className="flex min-h-12 items-center justify-between gap-3 py-2" data-testid="summary-improved-item">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-green-50 text-sm font-semibold text-green-800 dark:bg-green-950/50 dark:text-green-300" aria-hidden>{i + 1}</span>
                  <div className="min-w-0">
                    <p className="break-words font-medium leading-snug text-slate-900 dark:text-white">{t.teamName}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">QA score {t.prevQaScore} → <span className="font-semibold text-slate-700 dark:text-slate-200">{t.qaScore}</span></p>
                  </div>
                </div>
                <WeekChange change={t.weekChange} className="text-sm" />
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* Money at risk */}
      <div id="summary-money" className="scroll-mt-20">
        <Section title="Money at risk" subtitle="From Business impact, as ranges" testId="summary-money" icon={<CircleDollarSign size={17} className="text-slate-500 dark:text-slate-400" aria-hidden />}>
          {!money?.available ? (
            <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <p>{money?.reason ?? 'Not available.'}</p>
              <AppLink href={money?.assumptionsPath ?? '/analytics/business-impact'} className="inline-flex min-h-11 items-center font-medium text-brand-700 underline underline-offset-2 dark:text-brand-300">Open Business impact</AppLink>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-300">Revenue at stake from quality below target</p>
                {money.stake.monthlyLow !== null && money.stake.monthlyHigh !== null ? (
                  <>
                    <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white" data-testid="summary-money-range">
                      {fmtMoney(money.stake.monthlyLow)} to {fmtMoney(money.stake.monthlyHigh)} <span className="text-sm font-normal text-slate-500 dark:text-slate-400">/ month</span>
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Most likely {fmtMoney(money.stake.monthly)} · {fmtMoney(money.stake.annualLow)} to {fmtMoney(money.stake.annualHigh)} a year
                    </p>
                  </>
                ) : (
                  <p className="text-base font-medium text-slate-500 dark:text-slate-400">No team has enough monthly history yet</p>
                )}
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{money.teamsContributing} of {money.teams} {money.teams === 1 ? 'team' : 'teams'} with enough history</p>
              </div>
              <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
                <p className="text-sm text-slate-600 dark:text-slate-300">Cost of delay of open technical debt</p>
                <p className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white" data-testid="summary-money-debt">
                  {fmtMoney(money.debt.monthly)}{money.debt.monthly !== null && <span className="text-sm font-normal text-slate-500 dark:text-slate-400"> / month</span>}
                </p>
              </div>
              <details className="group rounded-lg bg-slate-50 px-3 text-sm dark:bg-slate-800/50">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-medium text-slate-700 dark:text-slate-200">
                  How these are estimated <ChevronDown size={16} aria-hidden className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                </summary>
                <div className="space-y-1.5 pb-3 text-slate-600 dark:text-slate-300">
                  <p>{data.text.money}</p>
                  {money.caveats.map((c) => <p key={c}>{c}</p>)}
                </div>
              </details>
              <div className="flex flex-wrap items-center gap-x-3">
                <AppLink href={money.assumptionsPath} testId="summary-money-assumptions" className="inline-flex min-h-11 items-center font-medium text-brand-700 underline underline-offset-2 dark:text-brand-300">
                  Assumptions and team figures
                </AppLink>
                {money.sampleData && <Badge tone="neutral">Includes sample data</Badge>}
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* Every team in scope, compact */}
      {data.teams.length > 1 && (
        <details className="group rounded-xl border border-slate-200 bg-white lg:col-span-3 dark:border-slate-800 dark:bg-slate-900" data-testid="summary-teams">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-base font-semibold text-slate-900 sm:px-5 dark:text-white">
            All {data.teams.length} teams <ChevronDown size={18} aria-hidden className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <ul className="divide-y divide-slate-200 border-t border-slate-200 px-4 sm:px-5 dark:divide-slate-800 dark:border-slate-800">
            {data.teams.map((t) => (
              <li key={t.teamId} className="flex min-h-12 items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden className={cx('h-2.5 w-2.5 flex-shrink-0 rounded-full', t.status ? STATUS[t.status].dot : 'bg-slate-300 dark:bg-slate-600')} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900 dark:text-white">{t.teamName}</span>
                    {t.departmentName && <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{t.departmentName}</span>}
                  </span>
                </span>
                <span className="flex flex-shrink-0 items-center gap-3 text-sm">
                  <WeekChange change={t.weekChange} />
                  <span className="w-9 text-right text-lg font-semibold tabular-nums text-slate-900 dark:text-white">{t.qaScore ?? '—'}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>,
  );
};

/** "At this rate test coverage misses its target ≥ 80% around 18 Dec" under a risk item. */
const ForecastLine: React.FC<{ f: SummaryForecast; className?: string }> = ({ f, className }) => (
  <p className={cx('mt-1 flex items-start gap-1 text-xs', f.outlook === 'will_reach' ? 'text-green-700 dark:text-green-400' : 'text-slate-600 dark:text-slate-300', className)} data-testid="summary-risk-forecast" data-outlook={f.outlook ?? undefined}>
    <TrendingDown size={13} aria-hidden className={cx('mt-px flex-shrink-0', f.outlook === 'will_reach' && 'rotate-180')} />
    <span>{f.text}</span>
  </p>
);

const RiskCard: React.FC<{ risk: ExecutiveSummaryData['risks']['top'][number]; rank: number }> = ({ risk, rank }) => {
  const [open, setOpen] = useState(false);
  const qa = risk.items.find((i) => i.key === 'qaScore');
  const kpis = risk.items.filter((i) => i.key !== 'qaScore');
  const shown = open ? kpis : kpis.slice(0, 2);
  const more = kpis.length - shown.length;
  const st = risk.status ? STATUS[risk.status] : null;
  return (
    <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-800" data-testid="summary-risk">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-red-50 text-sm font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-300" aria-hidden>{rank}</span>
          <div className="min-w-0">
            <p className="break-words font-semibold leading-snug text-slate-900 dark:text-white">{risk.teamName}</p>
            {risk.departmentName && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{risk.departmentName}</p>}
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-xl font-semibold leading-none tabular-nums text-slate-900 dark:text-white">{risk.qaScore ?? '—'}</p>
          {st && <p className={cx('mt-1 text-xs font-medium', st.tone === 'bad' ? 'text-red-700 dark:text-red-400' : st.tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400')}>QA {st.label.toLowerCase()}</p>}
        </div>
      </div>
      {qa && (
        <p className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 pl-[2.375rem] text-xs" data-testid="summary-risk-qa">
          <span className="text-slate-600 dark:text-slate-300">QA score target ≥ {num(qa.target)}</span>
          <WeekChange change={qa.weekChange} trend={qa.trend} />
        </p>
      )}
      {qa?.forecast && <ForecastLine f={qa.forecast} className="pl-[2.375rem]" />}
      {shown.length > 0 && <ul className="mt-2 space-y-1.5">
        {shown.map((i) => (
          <li key={i.key} className="rounded-md bg-slate-50 px-2.5 py-2 text-sm dark:bg-slate-800/50" data-testid="summary-risk-item">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-100">{i.label}</span>
              <span className="whitespace-nowrap font-semibold tabular-nums text-red-700 dark:text-red-400">{num(i.value)}{unitOf(i.unit)}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
              <span className="text-slate-600 dark:text-slate-300">{targetText(i)}</span>
              <WeekChange change={i.weekChange} trend={i.trend} unit={i.unit} lowerIsBetter={i.lowerIsBetter} />
            </div>
            {i.forecast && <ForecastLine f={i.forecast} />}
          </li>
        ))}
      </ul>}
      {(more > 0 || open) && kpis.length > 2 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-300"
          aria-expanded={open}
        >
          {open ? 'Show less' : `${more} more off target`}
          <ChevronDown size={15} aria-hidden className={cx('transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
        </button>
      )}
    </li>
  );
};

export default ExecutiveSummary;
