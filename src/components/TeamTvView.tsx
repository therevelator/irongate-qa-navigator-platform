import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LastUpdatedNote } from './LastUpdatedNote';
import { Toaster, toast } from 'react-hot-toast';
import { Maximize, Minimize, Moon, Sun, LogOut, Repeat, Loader2, MonitorX } from 'lucide-react';
import { useAnalyticsScope } from '../contexts/AnalyticsScopeContext';
import { useAuth, useHideSampleNotice } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { canRequestTeamInsights } from '../../server/lib/userPolicy';
import { policyActorOf } from '../lib/policyActor';
import { generateDetailedKPIs, getThreshold, statusFor } from '../data/detailedKPIs';
import { describeChange } from '../data/kpiTrend';
import { formatAsOf } from '../data/advancedFeatures';
import { cx } from './ui';
import { basedOnText } from '../../server/lib/metricFormulas';
import { confidenceExplanation } from './MetricQuality';
import type { TargetPeriod } from '../config/metricsConfig';

const CONFIDENCE_TEXT = {
  high: 'text-green-700 dark:text-green-400',
  medium: 'text-amber-700 dark:text-amber-400',
  low: 'text-red-700 dark:text-red-400',
} as const;
import { exitTvMode, replaceTvTeam } from './tv/tvNavigation';
import { useTvSummary, useTvRecommendations, REFRESH_MS, type TvSummary, type TvRecommendations } from './tv/useTvData';
import { useTvActions } from './tv/useTvActions';
import type { TrackedAction } from './ActionsPanel';
import {
  Clock, KpiTile, ScaledBattery, STATUS_META, TrendChart, TrendText, fmtValue, shortDate, targetText, unitSuffix, useRootPx, type TvKpi,
} from './tv/TvParts';

/**
 * Team TV / meeting mode (/tv?team=<id>): one team on a large screen, readable across a room.
 *
 * - Full screen, no app chrome. The root font size follows the screen (1rem = 1/120 of a
 *   16:9 width), so the layout is identical at 1366×768, 1920×1080 and 3840×2160.
 * - Team aggregates only (GET /api/tv/teams/:id): never individual developer data.
 * - Scope: the shared analytics rule; the server answers 403 for any other team.
 * - Refreshes every 60 s and on the live "metrics updated" event; keeps the last data on
 *   screen when a refresh fails.
 * - Keys: F full screen, T theme, R auto-rotate, ← → or 1–3 panels, Esc exit.
 *   Dark by default; the TV theme is remembered separately from the app theme.
 * Optional URL parameters for a kiosk: ?team=<id>&theme=light|dark&rotate=1.
 */

type Panel = 'kpis' | 'trends' | 'focus';
const PANELS: { id: Panel; label: string }[] = [
  { id: 'kpis', label: 'Key KPIs' },
  { id: 'trends', label: 'Trends' },
  { id: 'focus', label: 'Focus areas' },
];
const ROTATE_MS = 20_000;
const CONTROLS_IDLE_MS = 4_000;
const THEME_KEY = 'irongate_tv_theme';
const ROTATE_KEY = 'irongate_tv_rotate';

/** The six team KPIs on the main panel (definitions, targets and units: src/data/detailedKPIs.ts). */
const TV_KPIS: { id: string; label: string; digits: number }[] = [
  { id: 'test-coverage', label: 'Test coverage', digits: 1 },
  { id: 'automation-coverage', label: 'Automation coverage', digits: 1 },
  { id: 'flakiness-rate', label: 'Test flakiness', digits: 1 },
  { id: 'defect-escape-rate', label: 'Defect escape rate', digits: 1 },
  { id: 'change-failure-rate', label: 'Change failure rate', digits: 1 },
  { id: 'deployment-frequency', label: 'Deployments', digits: 1 },
];

/** The four 90-day charts on the Trends panel. */
const TV_TRENDS: { key: string; historyKey: string; title: string; digits: number }[] = [
  { key: 'qaScore', historyKey: 'qa_score', title: 'QA score', digits: 0 },
  { key: 'testCoverage', historyKey: 'test_coverage', title: 'Test coverage', digits: 1 },
  { key: 'defectEscapeRate', historyKey: 'defect_escape_rate', title: 'Defect escape rate', digits: 1 },
  { key: 'testFlakinessRate', historyKey: 'test_flakiness_rate', title: 'Test flakiness', digits: 1 },
];

const readParam = (name: string) => {
  try { return new URLSearchParams(window.location.search).get(name); } catch { return null; }
};
const readStored = (key: string) => {
  try { return window.localStorage.getItem(key); } catch { return null; }
};
const store = (key: string, value: string) => {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
};

/** Root font size for the screen: 1rem = 1/120 of the width of a 16:9 frame that fits. */
const rootPxFor = (w: number, h: number) => (w < 1024 ? 10 : Math.min(64, Math.max(10, Math.min(w / 120, h / 67.5))));

const daysSince = (day: string | null | undefined) => {
  if (!day) return null;
  const t = Date.parse(`${String(day).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((todayUtc - t) / 86_400_000));
};

const TeamTvView: React.FC = () => {
  const scope = useAnalyticsScope();
  const { user } = useAuth();
  const hideSampleNotice = useHideSampleNotice();
  const { isDark: appDark } = useTheme();

  /* ---------------- screen setup: theme, root font size, title, wake lock ---------------- */

  const [tvTheme, setTvTheme] = useState<'dark' | 'light'>(() => {
    const p = readParam('theme');
    if (p === 'light' || p === 'dark') return p;
    return readStored(THEME_KEY) === 'light' ? 'light' : 'dark';
  });
  const isDark = tvTheme === 'dark';
  const appDarkRef = useRef(appDark);
  appDarkRef.current = appDark;

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);
  useLayoutEffect(() => {
    const html = document.documentElement;
    const prevFont = html.style.fontSize;
    const prevTitle = document.title;
    return () => {
      html.style.fontSize = prevFont;
      html.classList.toggle('dark', appDarkRef.current); // back to the app theme
      document.title = prevTitle;
    };
  }, []);

  const [wide, setWide] = useState(() => window.innerWidth >= 1024);
  useLayoutEffect(() => {
    const apply = () => {
      document.documentElement.style.fontSize = `${rootPxFor(window.innerWidth, window.innerHeight)}px`;
      setWide(window.innerWidth >= 1024);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);
  const rootPx = useRootPx();

  // Keep the screen awake while TV mode is open (where the browser supports it).
  useEffect(() => {
    let lock: any = null;
    let released = false;
    const request = async () => {
      try {
        const wl = (navigator as any).wakeLock;
        if (wl && document.visibilityState === 'visible') lock = await wl.request('screen');
        if (released) lock?.release?.();
      } catch { /* not allowed or unsupported: the screen may dim */ }
    };
    request();
    const onVisible = () => { if (document.visibilityState === 'visible') request(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { released = true; document.removeEventListener('visibilitychange', onVisible); lock?.release?.().catch?.(() => undefined); };
  }, []);

  /* ---------------- team ---------------- */

  const [urlTeamId, setUrlTeamId] = useState<string | null>(() => readParam('team'));
  const teamId = urlTeamId ?? scope.teamId;
  useEffect(() => {
    // Without ?team=, show the scope's team and put it in the URL so the link can be shared.
    if (!urlTeamId && scope.teamId) { replaceTvTeam(scope.teamId); setUrlTeamId(scope.teamId); }
  }, [urlTeamId, scope.teamId]);

  const chooseTeam = (id: string) => {
    replaceTvTeam(id);
    setUrlTeamId(id);
    scope.setTeamId(id);
  };

  const { data, state, offline, updatedAt } = useTvSummary(teamId);
  // Recommendations: the team's leads, its department's QA managers and admins (as GET /api/teams/:id/ai-suggestions).
  const tvTeam = scope.teams.find((t) => t.id === teamId);
  const canSeeRecommendations = !!user && !!tvTeam && canRequestTeamInsights(policyActorOf(user), { id: tvTeam.id, department_id: tvTeam.department_id ?? null }) && state === 'ready';
  const recommendations = useTvRecommendations(state === 'ready' ? teamId : null, canSeeRecommendations);
  const trackedActions = useTvActions(state === 'ready' ? teamId : null, true);

  useEffect(() => {
    if (data?.team.name) document.title = `${data.team.name} · TV mode · IronGate`;
  }, [data?.team.name]);

  /* ---------------- panels, rotation ---------------- */

  const [panel, setPanel] = useState<Panel>('kpis');
  const [rotate, setRotate] = useState<boolean>(() => readParam('rotate') === '1' || readStored(ROTATE_KEY) === 'true');
  useEffect(() => { store(ROTATE_KEY, rotate ? 'true' : 'false'); }, [rotate]);
  useEffect(() => {
    if (!rotate) return;
    const t = window.setTimeout(() => {
      setPanel((p) => PANELS[(PANELS.findIndex((x) => x.id === p) + 1) % PANELS.length].id);
    }, ROTATE_MS);
    return () => window.clearTimeout(t);
  }, [rotate, panel]);
  const stepPanel = (dir: 1 | -1) =>
    setPanel((p) => PANELS[(PANELS.findIndex((x) => x.id === p) + dir + PANELS.length) % PANELS.length].id);

  /* ---------------- controls visibility, cursor ---------------- */

  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsRef = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<number | undefined>(undefined);
  const pokeControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (controlsRef.current?.contains(document.activeElement)) return; // keep while in use
      setControlsVisible(false);
    }, CONTROLS_IDLE_MS);
  }, []);
  useEffect(() => {
    pokeControls();
    window.addEventListener('mousemove', pokeControls);
    window.addEventListener('touchstart', pokeControls);
    return () => {
      window.removeEventListener('mousemove', pokeControls);
      window.removeEventListener('touchstart', pokeControls);
      window.clearTimeout(idleTimer.current);
    };
  }, [pokeControls]);

  /* ---------------- fullscreen ---------------- */

  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);
  const fsExitedAt = useRef(0);
  useEffect(() => {
    const onChange = () => {
      const fs = !!document.fullscreenElement;
      if (!fs) fsExitedAt.current = Date.now();
      setIsFullscreen(fs);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* already left */ }
      return;
    }
    const el = document.documentElement;
    if (!document.fullscreenEnabled || typeof el.requestFullscreen !== 'function') {
      toast.error('Full screen is not available in this browser. Use the browser’s own full-screen command (F11 on most keyboards).', { id: 'tv-fullscreen' });
      return;
    }
    try {
      await el.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      toast.error('The browser did not allow full screen. Press F11 (or use the browser menu) to go full screen.', { id: 'tv-fullscreen' });
    }
  }, []);

  const exit = useCallback(async () => {
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* ignore */ }
    }
    exitTvMode();
  }, []);

  const toggleTheme = useCallback(() => {
    setTvTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      store(THEME_KEY, next);
      return next;
    });
  }, []);

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const key = e.key;
      if (key === 'Escape') {
        // Esc while (or just after) leaving full screen only leaves full screen.
        if (document.fullscreenElement || Date.now() - fsExitedAt.current < 600) return;
        e.preventDefault();
        exit();
        return;
      }
      if (typing) return;
      if (key === 'f' || key === 'F') { e.preventDefault(); toggleFullscreen(); }
      else if (key === 't' || key === 'T') { e.preventDefault(); toggleTheme(); }
      else if (key === 'r' || key === 'R') { e.preventDefault(); setRotate((r) => !r); }
      else if (key === 'ArrowRight') { e.preventDefault(); stepPanel(1); }
      else if (key === 'ArrowLeft') { e.preventDefault(); stepPanel(-1); }
      else if (key === '1' || key === '2' || key === '3') { e.preventDefault(); setPanel(PANELS[Number(key) - 1].id); }
      else return;
      pokeControls();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [exit, toggleFullscreen, toggleTheme, pokeControls]);

  /* ---------------- view model ---------------- */

  const model = useMemo(() => (data ? buildModel(data) : null), [data]);

  const toaster = (
    <Toaster
      position="top-center"
      toastOptions={{
        duration: 6000,
        style: {
          background: isDark ? '#1e293b' : '#ffffff',
          color: isDark ? '#e2e8f0' : '#0f172a',
          border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`,
          fontSize: '1.4rem',
          maxWidth: '50rem',
          padding: '0.9rem 1.2rem',
        },
      }}
    />
  );

  const controls = (
    <TvControls
      refEl={controlsRef}
      visible={controlsVisible}
      onFocusInside={pokeControls}
      teams={scope.teams}
      teamId={teamId}
      onTeam={chooseTeam}
      panel={panel}
      onPanel={(p) => { setPanel(p); pokeControls(); }}
      rotate={rotate}
      onRotate={() => setRotate((r) => !r)}
      isDark={isDark}
      onTheme={toggleTheme}
      isFullscreen={isFullscreen}
      onFullscreen={toggleFullscreen}
      onExit={exit}
    />
  );

  const shell = (children: React.ReactNode) => (
    <div
      className={cx(
        'fixed inset-0 z-[60] flex flex-col bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-white',
        wide ? 'overflow-hidden' : 'overflow-y-auto',
        !controlsVisible && 'cursor-none',
      )}
      data-testid="tv-mode"
      data-theme={tvTheme}
    >
      {children}
      {controls}
      {toaster}
    </div>
  );

  // States without a team summary: loading, outside scope, signed out, error.
  if (!teamId || state !== 'ready' || !data || !model) {
    const none = !scope.loading && !teamId;
    let title = 'Loading team…';
    let body: React.ReactNode = null;
    let icon: React.ReactNode = <Loader2 className="h-16 w-16 animate-spin text-slate-400 motion-reduce:animate-none" aria-hidden />;
    if (none) {
      title = 'No team to show';
      body = 'TV mode shows one team at a time. You are not assigned to a team you can view. Ask an administrator to add you to a team.';
      icon = <MonitorX className="h-16 w-16 text-slate-400" aria-hidden />;
    } else if (state === 'forbidden') {
      title = 'This team is not available to you';
      body = 'TV mode can show the teams in your scope only: your own team for team leads, engineers and viewers; the teams of your department for managers.';
      icon = <MonitorX className="h-16 w-16 text-slate-400" aria-hidden />;
    } else if (state === 'signed-out') {
      title = 'Your session has ended';
      body = 'Sign in again to continue showing this team.';
      icon = <MonitorX className="h-16 w-16 text-slate-400" aria-hidden />;
    } else if (state === 'error') {
      title = 'Could not load the team';
      body = 'The server did not respond. TV mode retries every minute.';
      icon = <MonitorX className="h-16 w-16 text-slate-400" aria-hidden />;
    }
    const canShowOwn = state === 'forbidden' && scope.teamId && scope.teamId !== teamId;
    return shell(
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center" aria-live="polite" data-testid={`tv-state-${none ? 'none' : state}`}>
        {icon}
        <h1 className="text-[3rem] font-semibold tracking-tight">{title}</h1>
        {body && <p className="max-w-[60rem] text-[1.6rem] text-slate-600 dark:text-slate-300">{body}</p>}
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          {canShowOwn && (
            <button type="button" onClick={() => chooseTeam(scope.teamId!)} className={bigButton('primary')}>
              Show {scope.team?.name ?? 'my team'}
            </button>
          )}
          {state === 'signed-out' && (
            <button type="button" onClick={() => window.location.reload()} className={bigButton('primary')}>Sign in</button>
          )}
          {!scope.loading && <button type="button" onClick={exit} className={bigButton('secondary')}>Exit TV mode</button>}
        </div>
      </main>,
    );
  }

  const { team, latest } = data;
  const qaMeta = STATUS_META[model.qaStatus];
  const age = daysSince(latest?.snapshotDate);

  return shell(
    <main
      className={cx('flex flex-col', wide ? 'min-h-0 flex-1 gap-[2rem] px-[2.75rem] py-[2.25rem]' : 'gap-6 p-4 pb-24')}
      aria-label={`${team.name}, TV mode`}
    >
      {/* Header: team identity + clock */}
      <header className={cx('flex justify-between gap-8', wide ? 'items-start' : 'flex-col')}>
        <div className="min-w-0">
          <p className="text-[1.35rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">IronGate QE Navigator · Team view</p>
          <h1 className="mt-2 truncate text-[4.5rem] font-semibold leading-[1.05] tracking-tight" data-testid="tv-team-name" title={team.name}>{team.name}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-[1.25em] gap-y-1 text-[1.75rem] text-slate-600 dark:text-slate-300">
            <span>{team.departmentName ?? 'No department'}</span>
            <span aria-hidden className="text-slate-300 dark:text-slate-600">|</span>
            <span>{team.leadName ? <>Lead: <span className="font-medium text-slate-900 dark:text-white">{team.leadName}</span></> : 'No team lead'}</span>
            <span aria-hidden className="text-slate-300 dark:text-slate-600">|</span>
            <span><span className="font-medium tabular-nums text-slate-900 dark:text-white">{team.memberCount}</span> {team.memberCount === 1 ? 'member' : 'members'}</span>
            {!team.isActive && <span className="rounded-full bg-slate-200 px-3 py-0.5 text-[1.3rem] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">Inactive team</span>}
          </p>
        </div>
        <Clock />
      </header>

      <div className={cx(wide ? 'grid min-h-0 flex-1 grid-cols-[minmax(0,37fr)_minmax(0,63fr)] gap-[2rem]' : 'flex flex-col gap-6')}>
        {/* Hero: the QA battery */}
        <section
          className="flex min-h-0 flex-col rounded-3xl border border-slate-200 bg-white p-[2.5rem] dark:border-slate-800 dark:bg-slate-900"
          aria-labelledby="tv-qa-title"
          data-testid="tv-hero"
        >
          <div className={cx('flex items-center gap-[2.5rem]', wide ? 'min-h-0 flex-1' : 'h-[24rem]')}>
            <div className={cx('min-h-0 self-stretch', wide ? 'max-h-[30rem] flex-[0_0_auto]' : '')}>
              <ScaledBattery value={latest?.qaScore ?? null} good={model.qaThreshold.good} warn={model.qaThreshold.warning} label={`${team.name} QA score`} />
            </div>
            <div className="min-w-0">
              <h2 id="tv-qa-title" className="text-[1.9rem] font-medium text-slate-600 dark:text-slate-300">QA score</h2>
              <p className="flex items-baseline gap-3 whitespace-nowrap">
                <span className={cx('text-[9.5rem] font-semibold leading-[0.95] tracking-tighter tabular-nums', latest?.qaScore == null ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-white')} data-testid="tv-qa-score">
                  {latest?.qaScore == null ? '—' : Math.round(latest.qaScore)}
                </span>
                {latest?.qaScore != null && <span className="text-[2.5rem] font-medium text-slate-500 dark:text-slate-400">/ 100</span>}
              </p>
              <p className="mt-4">
                <span className={cx('inline-flex items-center gap-[0.5em] rounded-full px-[0.9em] py-[0.25em] text-[2rem] font-semibold ring-2 ring-inset', qaMeta.pill)} data-testid="tv-status">
                  <span aria-hidden className={cx('h-[0.55em] w-[0.55em] rounded-full', qaMeta.bar)} />
                  {qaMeta.label}
                </span>
              </p>
              <p className="mt-4 text-[1.5rem]">
                {latest?.qaScore == null ? (
                  <span className="text-slate-500 dark:text-slate-400">No QA score recorded</span>
                ) : (
                  <TrendText change={model.qaChange} unit="/100" digits={0} compact />
                )}
              </p>
              {model.qaChange && <p className="mt-1 text-[1.35rem] text-slate-500 dark:text-slate-400">vs {shortDate(model.qaChange.prevDate)}</p>}
              <p className="mt-1 text-[1.35rem] text-slate-500 dark:text-slate-400">
                Target ≥ {model.qaThreshold.good} · watch ≥ {model.qaThreshold.warning}
              </p>
              {latest?.qaScoreConfidence && (
                <p className="mt-1 text-[1.35rem] text-slate-600 dark:text-slate-300" data-testid="tv-qa-confidence" title={confidenceExplanation(latest.qaScoreConfidence)}>
                  {basedOnText(latest.qaScoreConfidence).replace(/^b/, 'B')}
                  {' · '}
                  <span className={cx('font-semibold', CONFIDENCE_TEXT[latest.qaScoreConfidence.confidence])}>{latest.qaScoreConfidence.confidence} confidence</span>
                  {latest.qaScoreConfidence.staleInputs.length > 0 && <> · {latest.qaScoreConfidence.staleInputs.length} stale</>}
                </p>
              )}
            </div>
          </div>
          <div className="mt-[1.5rem] grid grid-cols-2 gap-4 border-t border-slate-200 pt-[1.5rem] text-[1.4rem] dark:border-slate-800">
            <div>
              <p className="text-slate-500 dark:text-slate-400">KPIs on target</p>
              <p className="mt-1 text-[2.4rem] font-semibold tabular-nums leading-tight" data-testid="tv-on-target">
                {model.tracked ? <>{model.onTarget}<span className="text-[1.5rem] font-medium text-slate-500 dark:text-slate-400"> of {model.tracked}</span></> : '—'}
              </p>
            </div>
            <div>
              <p className="text-slate-500 dark:text-slate-400">Data as of</p>
              <p className="mt-1 text-[2.4rem] font-semibold leading-tight" data-testid="tv-as-of">{formatAsOf(latest?.snapshotDate) ?? '—'}</p>
              <LastUpdatedNote at={latest?.lastUpdated} outdated={latest?.dataOutdated} className="mt-1 block font-medium text-amber-700 dark:text-amber-400" />
              {age != null && age > 7 && (
                <p className="mt-1 font-medium text-amber-700 dark:text-amber-400">No new snapshot for {age} days</p>
              )}
            </div>
          </div>
        </section>

        {/* Rotating panel */}
        <section className={cx('flex flex-col', wide && 'min-h-0')} aria-labelledby="tv-panel-title" data-testid={`tv-panel-${panel}`}>
          <div className="mb-[1.25rem] flex items-center justify-between gap-6">
            <h2 id="tv-panel-title" className="flex items-baseline gap-[0.6em] text-[2rem] font-semibold tracking-tight">
              {panel === 'trends' ? `Trends · last ${data.historyDays} days` : PANELS.find((p) => p.id === panel)!.label}
              {panel === 'kpis' && wide && model.prevDate && (
                <span className="text-[1.3rem] font-normal text-slate-500 dark:text-slate-400">change vs previous snapshot ({shortDate(model.prevDate)})</span>
              )}
            </h2>
            <ol className="flex items-center gap-[0.6rem]" aria-label="Panels">
              {PANELS.map((p, i) => (
                <li key={p.id}>
                  <span className={cx('block h-[0.7rem] rounded-full transition-all motion-reduce:transition-none', p.id === panel ? 'w-[2.6rem] bg-slate-900 dark:bg-white' : 'w-[0.7rem] bg-slate-300 dark:bg-slate-700')} />
                  <span className="sr-only">{`${i + 1}. ${p.label}${p.id === panel ? ' (showing)' : ''}`}</span>
                </li>
              ))}
            </ol>
          </div>
          {!latest ? (
            <div className="flex flex-1 items-center justify-center rounded-3xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
              <p className="max-w-[40rem] text-[1.8rem] text-slate-600 dark:text-slate-300">No KPI snapshot has been recorded for this team yet. Values appear here as soon as data arrives.</p>
            </div>
          ) : panel === 'kpis' ? (
            <div className={cx('grid gap-[1.25rem]', wide ? 'min-h-0 flex-1 grid-cols-3 grid-rows-2' : 'auto-rows-[22rem] grid-cols-1 sm:grid-cols-2')}>
              {model.kpis.map((k) => <KpiTile key={k.kpi.id} item={k} isDark={isDark} />)}
            </div>
          ) : panel === 'trends' ? (
            <div className={cx('grid gap-[1.25rem]', wide ? 'min-h-0 flex-1 grid-cols-2 grid-rows-2' : 'auto-rows-[26rem] grid-cols-1')}>
              {model.trends.map((t) => (
                <TrendChart key={t.key} title={t.title} history={t.history} unit={t.unit} target={t.target} digits={t.digits} isDark={isDark} rootPx={rootPx} current={t.current} targetPeriods={t.targetPeriods} />
              ))}
            </div>
          ) : (
            <FocusPanel model={model} recommendations={recommendations} wide={wide} tracked={trackedActions} />
          )}
        </section>
      </div>

      {/* Footer: freshness, sample data, keys */}
      <footer className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 text-[1.3rem] text-slate-600 dark:text-slate-300">
        <p className="inline-flex items-center gap-[0.6em]" data-testid="tv-refresh" aria-live="polite">
          <span aria-hidden className={cx('h-[0.7em] w-[0.7em] rounded-full', offline ? 'bg-amber-500' : 'bg-green-600 dark:bg-green-500')} />
          {offline
            ? <>Connection lost · showing data loaded at {updatedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '—'} · retrying every minute</>
            : <>Live · updated {updatedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) ?? '—'} · refreshes every {Math.round(REFRESH_MS / 1000)} s{rotate ? ' · panels rotate every 20 s' : ''}</>}
        </p>
        {latest?.sampleData && !hideSampleNotice && (
          <p className="rounded-full bg-slate-200 px-[0.8em] py-[0.15em] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200" data-testid="tv-sample-data">
            Includes sample data
          </p>
        )}
        <p className="hidden items-center gap-[0.9em] lg:inline-flex" aria-label="Keyboard shortcuts">
          {[['F', 'Full screen'], ['T', 'Theme'], ['R', 'Rotate'], ['← →', 'Panels'], ['Esc', 'Exit']].map(([k, l]) => (
            <span key={k} className="inline-flex items-center gap-[0.35em]">
              <kbd className="rounded-md border border-slate-300 bg-white px-[0.45em] py-[0.05em] font-sans text-[0.95em] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">{k}</kbd>
              {l}
            </span>
          ))}
        </p>
      </footer>
    </main>,
  );
};

/* ------------------------------------------------------------------ */
/* View model                                                          */
/* ------------------------------------------------------------------ */

interface TvModel {
  qaStatus: ReturnType<typeof statusFor>;
  qaThreshold: { good: number; warning: number };
  qaChange: ReturnType<typeof describeChange>;
  kpis: TvKpi[];
  trends: { key: string; title: string; history: { date: string; value: number }[]; unit: string; target: number | null; digits: number; current: React.ReactNode; targetPeriods?: TargetPeriod[] }[];
  offTarget: { name: string; value: string; unit: string; target: string | null; status: 'warning' | 'critical' }[];
  onTarget: number;
  tracked: number;
  /** previous snapshot date the KPI tiles compare with (most common one) */
  prevDate: string | null;
}

const mostCommon = (xs: (string | null)[]) => {
  const counts = new Map<string, number>();
  for (const x of xs) if (x) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: string | null = null;
  for (const [k, n] of counts) if (best == null || n > (counts.get(best) ?? 0)) best = k;
  return best;
};

function buildModel(data: TvSummary): TvModel {
  const latest = data.latest;
  // Judged with the targets valid at the values' dates (target history); stale values are shown, not judged.
  const all = generateDetailedKPIs({ kpiData: latest?.kpiData ?? {}, kpiThresholds: latest?.kpiThresholds });
  const staleOf = (key: string) => {
    const s = latest?.kpiStaleness?.[key];
    return s?.stale ? { staleSince: s.staleSince, recordedAt: s.recordedAt } : null;
  };
  const qaT = getThreshold('qaScore')!;
  const qaStatus = statusFor(latest?.qaScore ?? null, qaT);
  const hist = (k: string) => data.history[k] ?? [];

  const kpis: TvKpi[] = TV_KPIS.map((d) => {
    const kpi = all.find((k) => k.id === d.id)!;
    const history = hist(kpi.historyKey);
    return { kpi, label: d.label, digits: d.digits, history, change: describeChange(history, kpi.lowerIsBetter, !!kpi.threshold), stale: kpi.value == null ? null : staleOf(kpi.key) };
  });

  const trends = TV_TRENDS.map((t) => {
    if (t.key === 'qaScore') {
      return { key: t.key, title: t.title, history: hist(t.historyKey), unit: '', target: qaT.good, digits: 0, current: latest?.qaScore == null ? '—' : Math.round(latest.qaScore) };
    }
    const kpi = all.find((k) => k.historyKey === t.historyKey)!;
    return {
      key: t.key, title: t.title, history: hist(t.historyKey), unit: kpi.unit, target: kpi.threshold?.good ?? null, digits: t.digits,
      targetPeriods: data.targets?.[t.historyKey],
      current: kpi.value == null ? '—' : `${fmtValue(kpi.value, t.digits)}${unitSuffix(kpi.unit)}`,
    };
  });

  const withTarget = all.filter((k) => k.threshold && k.value != null && !staleOf(k.key));
  const offTarget = withTarget
    .filter((k) => k.status === 'warning' || k.status === 'critical')
    .sort((a, b) => Number(b.status === 'critical') - Number(a.status === 'critical'))
    .map((k) => ({
      name: k.name,
      value: fmtValue(k.value, k.key === 'defectDensity' ? 2 : 1),
      unit: unitSuffix(k.unit).trim(),
      target: targetText(k),
      status: k.status as 'warning' | 'critical',
    }));

  return {
    qaStatus,
    qaThreshold: { good: qaT.good, warning: qaT.warning },
    qaChange: describeChange(hist('qa_score'), false, true),
    kpis,
    trends,
    offTarget,
    onTarget: withTarget.filter((k) => k.status === 'good').length,
    tracked: withTarget.length,
    prevDate: mostCommon(kpis.map((k) => k.change?.prevDate ?? null)),
  };
}

/* ------------------------------------------------------------------ */
/* Focus panel: KPIs off target + current action plan                  */
/* ------------------------------------------------------------------ */

const FocusPanel: React.FC<{ model: TvModel; recommendations: TvRecommendations | null; wide: boolean; tracked?: TrackedAction[] | null }> = ({ model, recommendations, wide, tracked }) => {
  // Tracked actions (the team's action plan) take the right column; else the recommendations.
  const trackedShown = (tracked ?? []).slice(0, 4);
  const actions = trackedShown.length ? [] : recommendations && recommendations.aiEnabled !== false ? (recommendations.actionPlan ?? []).slice(0, 3) : [];
  const shown = model.offTarget.slice(0, wide ? 5 : 8);
  return (
    <div className={cx('grid min-h-0 flex-1 gap-[1.25rem]', wide && (actions.length || trackedShown.length) ? 'grid-cols-[minmax(0,11fr)_minmax(0,9fr)]' : 'grid-cols-1')}>
      <article className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900" data-testid="tv-off-target">
        <h3 className="text-[1.7rem] font-semibold">KPIs off target</h3>
        <p className="mt-1 text-[1.25rem] text-slate-600 dark:text-slate-300">
          {model.offTarget.length ? `${model.offTarget.length} of ${model.tracked} tracked KPIs, most urgent first` : `All ${model.tracked} tracked KPIs are on target`}
        </p>
        {model.offTarget.length === 0 ? (
          <p className="mt-8 text-[2.2rem] font-semibold text-green-700 dark:text-green-400">Every tracked KPI is on target. Keep it up.</p>
        ) : (
          <ul className="mt-4 min-h-0 flex-1 divide-y divide-slate-200 overflow-hidden dark:divide-slate-800">
            {shown.map((o) => {
              const meta = STATUS_META[o.status];
              return (
                <li key={o.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 py-[0.75rem]">
                  <div className="flex min-w-0 items-center gap-4">
                    <span aria-hidden className={cx('h-[1.1rem] w-[1.1rem] flex-shrink-0 rounded-full', meta.bar)} />
                    <div className="min-w-0">
                      <p className="truncate pb-[0.05em] text-[1.55rem] font-medium leading-snug" title={o.name}>{o.name}</p>
                      <p className="whitespace-nowrap text-[1.15rem] text-slate-600 dark:text-slate-300">{o.target}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="whitespace-nowrap text-[1.8rem] font-semibold leading-tight tabular-nums">
                      {o.value}{o.unit && <span className="ml-1 text-[1.15rem] font-medium text-slate-500 dark:text-slate-400">{o.unit}</span>}
                    </p>
                    <p className={cx('text-[1.15rem] font-semibold', meta.text)}>{meta.label}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {model.offTarget.length > shown.length && (
          <p className="mt-2 text-[1.2rem] text-slate-500 dark:text-slate-400">and {model.offTarget.length - shown.length} more on the Team detail page</p>
        )}
      </article>
      {trackedShown.length > 0 && <TrackedActionsCard actions={trackedShown} total={(tracked ?? []).length} />}
      {actions.length > 0 && (
        <article className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900" data-testid="tv-actions">
          <h3 className="text-[1.7rem] font-semibold">Recommended actions</h3>
          <p className="mt-1 text-[1.25rem] text-slate-600 dark:text-slate-300">
            {recommendations?.source === 'groq' ? 'AI-generated from the team’s KPIs; verify before acting' : 'Rule-based, from the KPIs off target'}
          </p>
          <ol className="mt-4 min-h-0 flex-1 space-y-[1rem] overflow-hidden">
            {actions.map((a, i) => (
              <li key={i} className="rounded-xl border border-slate-200 p-[1rem] dark:border-slate-800">
                <div className="flex items-center justify-between gap-4 text-[1.2rem]">
                  <span className={cx('font-semibold', a.priority === 'Urgent' ? 'text-red-700 dark:text-red-400' : a.priority === 'Moderate' ? 'text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300')}>{a.priority}</span>
                  <span className="text-slate-600 dark:text-slate-300">{[a.owner, a.timebox].filter(Boolean).join(' · ')}</span>
                </div>
                <p className="mt-1 text-[1.45rem] font-medium leading-snug">{a.initiative}</p>
              </li>
            ))}
          </ol>
        </article>
      )}
    </div>
  );
};

const TV_ACTION_STATUS: Record<TrackedAction['status'], string> = { open: 'Open', in_progress: 'In progress', done: 'Done', dropped: 'Dropped' };
const TV_OUTCOME: Record<string, { label: string; cls: string }> = {
  improved: { label: 'Improved', cls: 'text-green-700 dark:text-green-400' },
  worse: { label: 'Worse', cls: 'text-red-700 dark:text-red-400' },
  unchanged: { label: 'Unchanged', cls: 'text-slate-600 dark:text-slate-300' },
  no_data: { label: 'No new data', cls: 'text-slate-600 dark:text-slate-300' },
  pending: { label: 'Outcome pending', cls: 'text-slate-600 dark:text-slate-300' },
};
const tvDay = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.length === 10 ? { timeZone: 'UTC' } : {}) });

/** The team's tracked actions (no owner names on TV): status, due date, linked KPI, computed outcome. */
const TrackedActionsCard: React.FC<{ actions: TrackedAction[]; total: number }> = ({ actions, total }) => (
  <article className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900" data-testid="tv-tracked-actions">
    <h3 className="text-[1.7rem] font-semibold">Action plan</h3>
    <p className="mt-1 text-[1.25rem] text-slate-600 dark:text-slate-300">
      {total > actions.length ? `${actions.length} of ${total} tracked actions` : `${total} tracked ${total === 1 ? 'action' : 'actions'}`}; outcomes computed from the stored values
    </p>
    <ol className="mt-4 min-h-0 flex-1 space-y-[1rem] overflow-hidden">
      {actions.map((a) => {
        const done = a.status === 'done';
        const latest = done ? [...a.outcomes].reverse().find((o) => o.outcome !== 'pending') ?? a.outcomes[0] : null;
        const outcome = latest ? TV_OUTCOME[latest.outcome] : null;
        return (
          <li key={a.id} className="rounded-xl border border-slate-200 p-[1rem] dark:border-slate-800">
            <div className="flex items-center justify-between gap-4 text-[1.2rem]">
              <span className={cx('font-semibold', a.overdue ? 'text-red-700 dark:text-red-400' : done ? 'text-green-700 dark:text-green-400' : a.status === 'in_progress' ? 'text-brand-700 dark:text-brand-300' : 'text-slate-600 dark:text-slate-300')}>
                {a.overdue ? 'Overdue' : TV_ACTION_STATUS[a.status]}
              </span>
              <span className="text-slate-600 dark:text-slate-300">{done && a.completedAt ? `Done ${tvDay(a.completedAt)}` : a.dueDate ? `Due ${tvDay(a.dueDate)}` : 'No due date'}</span>
            </div>
            <p className="mt-1 text-[1.45rem] font-medium leading-snug">{a.title}</p>
            {a.metric && (
              <p className="mt-1 text-[1.15rem] text-slate-600 dark:text-slate-300">
                {a.metric.label}{done && outcome && latest ? <>: <span className={cx('font-semibold', outcome.cls)}>{outcome.label}</span> ({latest.label.toLowerCase()})</> : ''}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  </article>
);

/* ------------------------------------------------------------------ */
/* Controls (appear on mouse move / key press, hide after 4 s)          */
/* ------------------------------------------------------------------ */

const bigButton = (kind: 'primary' | 'secondary') => cx(
  'inline-flex items-center justify-center gap-2 rounded-xl px-[1.2em] py-[0.55em] text-[1.4rem] font-medium transition-colors',
  kind === 'primary'
    ? 'bg-brand-700 text-white hover:bg-brand-800 dark:bg-brand-500 dark:hover:bg-brand-400 dark:text-slate-950'
    : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
);

const ctl = (active = false) => cx(
  'inline-flex h-[2.6rem] items-center gap-[0.45em] rounded-lg px-[0.8em] text-[1.05rem] font-medium transition-colors whitespace-nowrap',
  active
    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800',
);

const TvControls: React.FC<{
  refEl: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
  onFocusInside: () => void;
  teams: { id: string; name: string; department_name: string | null }[];
  teamId: string | null;
  onTeam: (id: string) => void;
  panel: Panel;
  onPanel: (p: Panel) => void;
  rotate: boolean;
  onRotate: () => void;
  isDark: boolean;
  onTheme: () => void;
  isFullscreen: boolean;
  onFullscreen: () => void;
  onExit: () => void;
}> = (p) => {
  const groups = useMemo(() => {
    const m = new Map<string, typeof p.teams>();
    for (const t of p.teams) {
      const k = t.department_name ?? 'No department';
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [p.teams]);
  const inList = p.teams.some((t) => t.id === p.teamId);
  return (
    <div
      ref={p.refEl}
      role="toolbar"
      aria-label="TV mode controls"
      onFocus={p.onFocusInside}
      onMouseMove={p.onFocusInside}
      data-testid="tv-controls"
      data-visible={p.visible ? 'true' : 'false'}
      className={cx(
        'fixed inset-x-0 bottom-[1.25rem] z-[70] mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-[0.4rem] rounded-2xl border border-slate-200 bg-white/95 p-[0.4rem] shadow-lg backdrop-blur',
        'dark:border-slate-700 dark:bg-slate-900/95',
        'transition-opacity duration-300 motion-reduce:transition-none',
        p.visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      {p.teams.length > 1 && (
        <label className="inline-flex items-center gap-2 pl-2 text-[1.05rem] text-slate-600 dark:text-slate-300">
          Team
          <select
            value={inList ? p.teamId ?? '' : ''}
            onChange={(e) => p.onTeam(e.target.value)}
            className="h-[2.6rem] max-w-[18rem] rounded-lg border border-slate-300 bg-white px-[0.6em] text-[1.05rem] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            data-testid="tv-team-select"
          >
            {!inList && <option value="" disabled>Choose a team</option>}
            {groups.map(([dept, list]) => (
              <optgroup key={dept} label={dept}>
                {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      <span className="mx-1 h-[1.8rem] w-px bg-slate-200 dark:bg-slate-700" aria-hidden />
      {PANELS.map((x, i) => (
        <button key={x.id} type="button" className={ctl(p.panel === x.id)} aria-pressed={p.panel === x.id} onClick={() => p.onPanel(x.id)} title={`${x.label} (${i + 1})`}>
          {x.label}
        </button>
      ))}
      <span className="mx-1 h-[1.8rem] w-px bg-slate-200 dark:bg-slate-700" aria-hidden />
      <button type="button" className={ctl(p.rotate)} aria-pressed={p.rotate} onClick={p.onRotate} title="Rotate panels every 20 seconds (R)" data-testid="tv-rotate">
        <Repeat className="h-[1.2rem] w-[1.2rem]" aria-hidden /> Auto-rotate
      </button>
      <button type="button" className={ctl()} onClick={p.onTheme} title="Switch theme (T)" data-testid="tv-theme">
        {p.isDark ? <Sun className="h-[1.2rem] w-[1.2rem]" aria-hidden /> : <Moon className="h-[1.2rem] w-[1.2rem]" aria-hidden />}
        {p.isDark ? 'Light' : 'Dark'}
      </button>
      <button type="button" className={ctl(p.isFullscreen)} aria-pressed={p.isFullscreen} onClick={p.onFullscreen} title="Full screen (F)" data-testid="tv-fullscreen">
        {p.isFullscreen ? <Minimize className="h-[1.2rem] w-[1.2rem]" aria-hidden /> : <Maximize className="h-[1.2rem] w-[1.2rem]" aria-hidden />}
        Full screen
      </button>
      <button type="button" className={ctl()} onClick={p.onExit} title="Exit TV mode (Esc)" data-testid="tv-exit">
        <LogOut className="h-[1.2rem] w-[1.2rem]" aria-hidden /> Exit
      </button>
    </div>
  );
};

export default TeamTvView;
