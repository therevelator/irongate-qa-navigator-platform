import API_URL from '../config/api';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LastUpdatedNote } from './LastUpdatedNote';
import { Toaster, toast } from 'react-hot-toast';
import { Maximize, Minimize, Palette, LogOut, Repeat, Loader2, MonitorX, Settings2, BellRing, HeartPulse, X, Link2 } from 'lucide-react';
import { useAnalyticsScope } from '../contexts/AnalyticsScopeContext';
import { useAuth, useHideSampleNotice } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { applyTheme, isDarkTheme, isThemeId, THEME_OPTIONS, tvTheme as tvThemeFor, type ThemeId } from '../lib/appearance';
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
import { useTvSummary, useTvRecommendations, prefetchTvSummary, REFRESH_MS, OFFLINE_RETRY_MS, type TvSummary, type TvRecommendations } from './tv/useTvData';
import { useTvActions } from './tv/useTvActions';
import type { TrackedAction } from './ActionsPanel';
import {
  Clock, KpiTile, ScaledBattery, STATUS_META, TrendChart, TrendText, fmtValue, shortDate, targetText, unitSuffix, useRootPx, type TvKpi,
} from './tv/TvParts';

/**
 * Team TV / wall-screen mode (/tv?team=<id>): the teams of the caller's scope on a large screen,
 * readable across a room, with no interaction needed once started.
 *
 * - Full screen, no app chrome. The root font size follows the screen (1rem = 1/120 of a
 *   16:9 width), so the layout is identical at 1366×768, 1920×1080 and 3840×2160.
 * - Team aggregates only (GET /api/tv/teams/:id): never individual developer data.
 * - Scope: the shared analytics rule, for every role; the team picker lists the teams of the
 *   caller's scope (GET /api/tv/teams) and the server answers 403 for any other team.
 * - Refreshes every 60 s and on the live "metrics updated" event; keeps the last data on
 *   screen when a refresh fails.
 * - Panels: Key KPIs (with targets), Trends (90 days), Alerts & actions, Wellbeing (the anonymous
 *   pulse, minimum group applied). Auto-rotate moves through the chosen panels every N seconds and,
 *   after the last panel, on to the next chosen team; the next team is loaded ahead.
 * - Keys: F full screen, T theme (Light, Dark, Graphite, Porcelain), R auto-rotate, S set up the
 *   screen, ← → or 1–4 panels, Esc exit. The TV theme is remembered separately from the app theme.
 * - A lost connection keeps the last data on screen, says so, retries every 15 s and reloads as
 *   soon as the browser is back online.
 * Kiosk URL parameters (the "Set up the screen" dialog builds the link):
 *   ?team=<id>&theme=light|dark|graphite|porcelain&rotate=1&interval=<seconds>
 *   &panels=kpis,trends,focus,pulse&teams=all|<id>,<id>
 * (theme=light|dark keeps the glass family of a glass app theme, as before).
 */

type Panel = 'kpis' | 'trends' | 'focus' | 'pulse';
const PANELS: { id: Panel; label: string }[] = [
  { id: 'kpis', label: 'Key KPIs' },
  { id: 'trends', label: 'Trends' },
  { id: 'focus', label: 'Alerts & actions' },
  { id: 'pulse', label: 'Wellbeing' },
];
const isPanel = (v: string): v is Panel => PANELS.some((p) => p.id === v);
export const TV_INTERVALS = [10, 15, 20, 30, 45, 60, 120, 300];
const DEFAULT_INTERVAL = 20;
const SETTINGS_KEY = 'irongate_tv_settings';
const THEME_CYCLE: ThemeId[] = ['light', 'dark', 'graphite', 'porcelain'];
const themeLabel = (t: ThemeId) => THEME_OPTIONS.find((o) => o.id === t)?.label ?? t;

/** What the screen rotates through: seconds per panel, the panels, and the teams (null: this team only). */
interface TvSettings { intervalSec: number; panels: Panel[]; teams: 'all' | string[] | null }

const clampInterval = (n: number) => (Number.isFinite(n) ? Math.min(600, Math.max(5, Math.round(n))) : DEFAULT_INTERVAL);
const parsePanels = (v: unknown): Panel[] | null => {
  const list = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim()).filter(isPanel);
  return list.length ? PANELS.map((p) => p.id).filter((id) => list.includes(id)) : null;
};
const parseTeams = (v: unknown): TvSettings['teams'] | undefined => {
  if (v === null) return null;
  if (v === 'all') return 'all';
  const list = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim()).filter(Boolean);
  return list.length ? list : undefined;
};

/** Settings: the URL (a kiosk link) wins over the ones remembered in this browser. */
function initialSettings(): TvSettings {
  let stored: any = null;
  try { stored = JSON.parse(readStored(SETTINGS_KEY) ?? 'null'); } catch { stored = null; }
  const pInterval = readParam('interval');
  const pTeams = readParam('teams');
  return {
    intervalSec: clampInterval(Number(pInterval ?? stored?.intervalSec ?? DEFAULT_INTERVAL)),
    panels: parsePanels(readParam('panels')) ?? parsePanels(stored?.panels) ?? PANELS.map((p) => p.id),
    teams: (pTeams !== null ? parseTeams(pTeams) : parseTeams(stored?.teams ?? null)) ?? null,
  };
}

function initialTheme(appTheme: ThemeId): ThemeId {
  const p = readParam('theme');
  if (p === 'light' || p === 'dark') return tvThemeFor(appTheme, p === 'dark');
  if (isThemeId(p)) return p;
  const s = readStored(THEME_KEY);
  if (s === 'light' || s === 'dark') return tvThemeFor(appTheme, s === 'dark');
  if (isThemeId(s)) return s;
  return tvThemeFor(appTheme, true); // dark by default (Graphite with a glass app theme)
}
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
  const { theme: appTheme, scoreDisplay } = useTheme();
  const gauge = scoreDisplay === 'gauge';

  /* ---------------- screen setup: theme, root font size, title, wake lock ---------------- */

  // TV mode keeps its own theme (any of the four), remembered apart from the app theme.
  const [screenTheme, setScreenTheme] = useState<ThemeId>(() => initialTheme(appTheme));
  const isDark = isDarkTheme(screenTheme);
  const appThemeRef = useRef(appTheme);
  appThemeRef.current = appTheme;

  useLayoutEffect(() => {
    applyTheme(document.documentElement, screenTheme);
  }, [screenTheme]);
  useLayoutEffect(() => {
    const html = document.documentElement;
    const prevFont = html.style.fontSize;
    const prevTitle = document.title;
    return () => {
      html.style.fontSize = prevFont;
      applyTheme(html, appThemeRef.current); // back to the app theme
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

  // The teams TV mode may show: the teams of the caller's analytics scope (GET /api/tv/teams).
  const [tvTeams, setTvTeams] = useState<{ id: string; name: string; department_id: string | null; department_name: string | null }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/tv/teams`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { teams: [] }))
      .then((d) => { if (!cancelled) setTvTeams(d.teams ?? []); })
      .catch(() => { if (!cancelled) setTvTeams([]); });
    return () => { cancelled = true; };
  }, []);
  const [urlTeamId, setUrlTeamId] = useState<string | null>(() => readParam('team'));
  const fallbackTeamId = scope.teamId ?? (tvTeams && tvTeams.length ? tvTeams[0].id : null);
  const teamId = urlTeamId ?? fallbackTeamId;
  useEffect(() => {
    // Without ?team=, show the scope's team (else the first team in scope) and put it in the URL so the link can be shared.
    if (!urlTeamId && fallbackTeamId) { replaceTvTeam(fallbackTeamId); setUrlTeamId(fallbackTeamId); }
  }, [urlTeamId, fallbackTeamId]);

  const chooseTeam = (id: string) => {
    replaceTvTeam(id);
    setUrlTeamId(id);
    if (scope.teams.some((t) => t.id === id)) scope.setTeamId(id);
  };
  // The rotation moves on without touching the app's analytics team.
  const showTeam = useCallback((id: string) => { replaceTvTeam(id); setUrlTeamId(id); }, []);

  const { data, state, offline, updatedAt, reload } = useTvSummary(teamId);
  // Recommendations: the team's leads, its department's QA managers and admins (as GET /api/teams/:id/ai-suggestions).
  const tvTeam = scope.teams.find((t) => t.id === teamId);
  const canSeeRecommendations = !!user && !!tvTeam && canRequestTeamInsights(policyActorOf(user), { id: tvTeam.id, department_id: tvTeam.department_id ?? null }) && state === 'ready';
  const recommendations = useTvRecommendations(state === 'ready' ? teamId : null, canSeeRecommendations);
  // Tracked actions (GET /api/actions, the same scope).
  const trackedActions = useTvActions(state === 'ready' && tvTeam ? teamId : null, true);

  useEffect(() => {
    if (data?.team.name) document.title = `${data.team.name} · TV mode · QE Navigator`;
  }, [data?.team.name]);

  /* ---------------- panels, rotation ---------------- */

  const [settings, setSettings] = useState<TvSettings>(initialSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const activePanels = settings.panels.length ? settings.panels : PANELS.map((p) => p.id);
  const [panel, setPanel] = useState<Panel>(() => activePanels[0]);
  const [rotate, setRotate] = useState<boolean>(() => {
    const p = readParam('rotate');
    return p === '1' || (p !== '0' && readStored(ROTATE_KEY) === 'true');
  });
  useEffect(() => { store(ROTATE_KEY, rotate ? 'true' : 'false'); }, [rotate]);
  const intervalMs = settings.intervalSec * 1000;

  // Teams the rotation goes through (in scope only: the picker list), in the picker's order.
  const rotationTeams = useMemo(() => {
    const inScope = (tvTeams ?? []).map((t) => t.id);
    if (settings.teams === 'all') return inScope;
    if (Array.isArray(settings.teams)) return inScope.filter((id) => (settings.teams as string[]).includes(id));
    return [];
  }, [tvTeams, settings.teams]);
  const teamRotation = rotationTeams.length > 1;
  const nextTeamId = teamRotation ? rotationTeams[(rotationTeams.indexOf(teamId ?? '') + 1) % rotationTeams.length] : null;
  // A chosen team list that does not hold the team shown: start with its first team.
  useEffect(() => {
    if (rotationTeams.length && teamId && !rotationTeams.includes(teamId)) showTeam(rotationTeams[0]);
  }, [rotationTeams, teamId, showTeam]);

  const lastPanel = activePanels[activePanels.length - 1];
  useEffect(() => {
    if (!rotate || settingsOpen) return;
    const t = window.setTimeout(() => {
      const i = activePanels.indexOf(panel);
      if (i >= 0 && i < activePanels.length - 1) { setPanel(activePanels[i + 1]); return; }
      setPanel(activePanels[0]);
      if (teamRotation && nextTeamId) showTeam(nextTeamId);
    }, intervalMs);
    return () => window.clearTimeout(t);
  }, [rotate, settingsOpen, panel, teamId, intervalMs, activePanels, teamRotation, nextTeamId, showTeam]);
  // Load the next team ahead while its turn approaches (no loading screen between teams).
  useEffect(() => {
    if (rotate && teamRotation && panel === lastPanel) prefetchTvSummary(nextTeamId);
  }, [rotate, teamRotation, panel, lastPanel, nextTeamId]);
  const stepPanel = (dir: 1 | -1) =>
    setPanel((p) => PANELS[(PANELS.findIndex((x) => x.id === p) + dir + PANELS.length) % PANELS.length].id);

  const applySettings = (next: TvSettings) => {
    setSettings(next);
    store(SETTINGS_KEY, JSON.stringify(next));
    if (!next.panels.includes(panel)) setPanel(next.panels[0]);
    // The address follows, so a reload (or the copied link) keeps the set-up.
    try {
      const params = new URLSearchParams(window.location.search);
      params.set('interval', String(next.intervalSec));
      params.set('panels', next.panels.join(','));
      if (next.teams === null) params.delete('teams'); else params.set('teams', next.teams === 'all' ? 'all' : next.teams.join(','));
      window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
    } catch { /* address unchanged */ }
  };

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

  const setTheme = useCallback((t: ThemeId) => { setScreenTheme(t); store(THEME_KEY, t); }, []);
  const toggleTheme = useCallback(() => {
    setScreenTheme((t) => {
      const next = THEME_CYCLE[(THEME_CYCLE.indexOf(t) + 1) % THEME_CYCLE.length];
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
      if (settingsOpen) {
        if (key === 'Escape') { e.preventDefault(); setSettingsOpen(false); }
        return; // the set-up dialog has the keyboard
      }
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
      else if (key === 's' || key === 'S') { e.preventDefault(); setSettingsOpen(true); }
      else if (key === '1' || key === '2' || key === '3' || key === '4') { e.preventDefault(); setPanel(PANELS[Number(key) - 1].id); }
      else return;
      pokeControls();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [exit, toggleFullscreen, toggleTheme, pokeControls, settingsOpen]);

  /* ---------------- view model ---------------- */

  const model = useMemo(() => (data ? buildModel(data) : null), [data]);

  const toaster = (
    <Toaster
      position="top-center"
      toastOptions={{
        duration: 6000,
        style: {
          background: 'var(--toast-bg)',
          color: 'var(--toast-fg)',
          border: '1px solid var(--toast-border)',
          boxShadow: 'var(--toast-shadow)',
          backdropFilter: 'var(--toast-blur)',
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
      teams={tvTeams ?? scope.teams}
      teamId={teamId}
      onTeam={chooseTeam}
      panel={panel}
      onPanel={(p) => { setPanel(p); pokeControls(); }}
      rotate={rotate}
      onRotate={() => setRotate((r) => !r)}
      theme={screenTheme}
      onTheme={toggleTheme}
      onSettings={() => { setSettingsOpen(true); pokeControls(); }}
      isFullscreen={isFullscreen}
      onFullscreen={toggleFullscreen}
      onExit={exit}
    />
  );

  const shell = (children: React.ReactNode) => (
    <div
      className={cx(
        'ig-app-bg fixed inset-0 z-[60] flex flex-col bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-white',
        wide ? 'overflow-hidden' : 'overflow-y-auto',
        !controlsVisible && !settingsOpen && 'cursor-none',
      )}
      data-testid="tv-mode"
      data-theme={screenTheme}
    >
      {children}
      {controls}
      {settingsOpen && (
        <TvSettingsDialog
          settings={settings}
          teams={tvTeams ?? []}
          theme={screenTheme}
          teamId={teamId}
          rotate={rotate}
          onClose={() => setSettingsOpen(false)}
          onApply={(next, nextTheme, nextRotate) => { applySettings(next); setTheme(nextTheme); setRotate(nextRotate); setSettingsOpen(false); }}
        />
      )}
      {toaster}
    </div>
  );

  // States without a team summary: loading, outside scope, signed out, error.
  if (!teamId || state !== 'ready' || !data || !model) {
    const none = !scope.loading && tvTeams !== null && !teamId;
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
      body = `The server did not respond. TV mode keeps trying every ${Math.round(OFFLINE_RETRY_MS / 1000)} seconds and shows the team as soon as it answers.`;
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
  // Pieces of the QA hero, laid out beside the battery or around the gauge (below).
  const qaStatusPill = (
    <span className={cx('inline-flex items-center gap-[0.5em] rounded-full px-[0.9em] py-[0.25em] text-[2rem] font-semibold ring-2 ring-inset', qaMeta.pill)} data-testid="tv-status">
      <span aria-hidden className={cx('h-[0.55em] w-[0.55em] rounded-full', qaMeta.bar)} />
      {qaMeta.label}
    </span>
  );
  const qaTrend = latest?.qaScore == null
    ? <span className="text-slate-500 dark:text-slate-400">No QA score recorded</span>
    : <TrendText change={model.qaChange} unit="/100" digits={0} compact />;
  const qaTargetText = `Target ≥ ${model.qaThreshold.good} · Watch: ${model.qaThreshold.warning}–${model.qaThreshold.good}`;
  const qaConfidence = latest?.qaScoreConfidence ? (
    <p className="mt-1 text-[1.35rem] text-slate-600 dark:text-slate-300" data-testid="tv-qa-confidence" title={confidenceExplanation(latest.qaScoreConfidence)}>
      {basedOnText(latest.qaScoreConfidence).replace(/^b/, 'B')}
      {' · '}
      <span className={cx('font-semibold', CONFIDENCE_TEXT[latest.qaScoreConfidence.confidence])}>{latest.qaScoreConfidence.confidence} confidence</span>
      {latest.qaScoreConfidence.staleInputs.length > 0 && <> · {latest.qaScoreConfidence.staleInputs.length} stale</>}
    </p>
  ) : null;

  return shell(
    <main
      className={cx('flex flex-col', wide ? 'min-h-0 flex-1 gap-[2rem] px-[2.75rem] py-[2.25rem]' : 'gap-6 p-4 pb-24')}
      aria-label={`${team.name}, TV mode`}
    >
      {rotate && !settingsOpen && (
        // Time left on this panel: a thin bar along the top edge (hidden with reduced motion).
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[65] h-[0.35rem] motion-reduce:hidden" aria-hidden data-testid="tv-rotation-progress">
          <div key={`${teamId}:${panel}`} className="tv-rotation-bar h-full bg-brand-600/80 dark:bg-brand-400/80" style={{ animationDuration: `${intervalMs}ms` }} />
        </div>
      )}
      {/* Header: team identity + clock */}
      <header className={cx('flex justify-between gap-8', wide ? 'items-start' : 'flex-col')}>
        <div className="min-w-0">
          <p className="text-[1.35rem] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-400">QE Navigator · Team view</p>
          <h1 className="mt-2 truncate text-[4.5rem] font-semibold leading-[1.05] tracking-tight" data-testid="tv-team-name" title={team.name}>{team.name}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-[1.25em] gap-y-1 text-[1.75rem] text-slate-600 dark:text-slate-300">
            <span>{team.departmentName ?? 'No department'}</span>
            <span aria-hidden className="text-slate-300 dark:text-slate-600">|</span>
            <span>{team.leadName ? <>Lead: <span className="font-medium text-slate-900 dark:text-white">{team.leadName}</span></> : 'No team lead'}</span>
            <span aria-hidden className="text-slate-300 dark:text-slate-600">|</span>
            <span><span className="font-medium tabular-nums text-slate-900 dark:text-white">{team.memberCount}</span> {team.memberCount === 1 ? 'member' : 'members'}</span>
            {!team.isActive && <span className="rounded-full bg-slate-200 px-3 py-0.5 text-[1.3rem] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">Inactive team</span>}
            {teamRotation && teamId && rotationTeams.includes(teamId) && (
              <span className="rounded-full bg-slate-200 px-[0.7em] py-[0.1em] text-[1.3rem] font-semibold tabular-nums text-slate-800 dark:bg-slate-800 dark:text-slate-100" data-testid="tv-team-position">
                Team {rotationTeams.indexOf(teamId) + 1} of {rotationTeams.length}
              </span>
            )}
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
          {gauge ? (
            /* Gauge: wider than tall, so it cannot stand beside the text at the height the battery
               has. It takes the middle of the hero instead, as large as the height left by the
               title above and the status below allows (FittedGauge), centred; its own centre shows
               the score, so the big number beside the battery is not repeated. */
            <div className={cx('flex flex-col gap-[1rem]', wide ? 'min-h-0 flex-1' : '')} data-testid="tv-qa-gauge-layout">
              <div className="flex flex-wrap items-center justify-between gap-x-[1.5rem] gap-y-[0.5rem]">
                <h2 id="tv-qa-title" className="text-[1.9rem] font-medium text-slate-600 dark:text-slate-300">QA score</h2>
                {qaStatusPill}
              </div>
              <div className={cx('min-h-0', wide ? 'max-h-[30rem] flex-1' : 'h-[20rem]')}>
                <ScaledBattery value={latest?.qaScore ?? null} good={model.qaThreshold.good} warn={model.qaThreshold.warning} label={`${team.name} QA score`} />
              </div>
              <div className="text-center">
                <p className="flex flex-wrap items-center justify-center gap-x-[0.4em] text-[1.5rem]">{qaTrend}{model.qaChange && <span className="text-slate-500 dark:text-slate-400">· vs {shortDate(model.qaChange.prevDate)}</span>}</p>
                <p className="mt-1 text-[1.35rem] text-slate-500 dark:text-slate-400">{qaTargetText}</p>
                {qaConfidence}
              </div>
            </div>
          ) : (
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
              <p className="mt-4">{qaStatusPill}</p>
              <p className="mt-4 text-[1.5rem]">{qaTrend}</p>
              {model.qaChange && <p className="mt-1 text-[1.35rem] text-slate-500 dark:text-slate-400">vs {shortDate(model.qaChange.prevDate)}</p>}
              <p className="mt-1 text-[1.35rem] text-slate-500 dark:text-slate-400">{qaTargetText}</p>
              {qaConfidence}
            </div>
          </div>
          )}
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
              {panel === 'focus' && data.alerts && (
                <span className="text-[1.3rem] font-normal text-slate-600 dark:text-slate-400">{data.alerts.counts.open + data.alerts.counts.acknowledged} open {data.alerts.counts.open + data.alerts.counts.acknowledged === 1 ? 'alert' : 'alerts'}</span>
              )}
              {panel === 'kpis' && wide && model.prevDate && (
                <span className="text-[1.3rem] font-normal text-slate-600 dark:text-slate-400">change vs previous snapshot ({shortDate(model.prevDate)})</span>
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
          {panel === 'pulse' ? (
            <PulsePanel pulse={data.pulse ?? null} wide={wide} />
          ) : !latest ? (
            <div className="flex flex-1 items-center justify-center rounded-3xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
              <p className="max-w-[40rem] text-[1.8rem] text-slate-600 dark:text-slate-300">No KPI snapshot has been recorded for this team yet. Values appear here as soon as data arrives.</p>
            </div>
          ) : panel === 'kpis' ? (
            <div className={cx('grid gap-[1.25rem]', wide ? 'min-h-0 flex-1 grid-cols-3 grid-rows-2' : 'auto-rows-[22rem] grid-cols-1 sm:grid-cols-2')}>
              {model.kpis.map((k) => <KpiTile key={k.kpi.id} item={k} isDark={isDark} theme={screenTheme} />)}
            </div>
          ) : panel === 'trends' ? (
            <div className={cx('grid gap-[1.25rem]', wide ? 'min-h-0 flex-1 grid-cols-2 grid-rows-2' : 'auto-rows-[26rem] grid-cols-1')}>
              {model.trends.map((t) => (
                <TrendChart key={t.key} title={t.title} history={t.history} unit={t.unit} target={t.target} digits={t.digits} isDark={isDark} theme={screenTheme} rootPx={rootPx} current={t.current} targetPeriods={t.targetPeriods} />
              ))}
            </div>
          ) : (
            <FocusPanel model={model} recommendations={recommendations} wide={wide} tracked={trackedActions} alerts={data.alerts ?? null} />
          )}
        </section>
      </div>

      {/* Footer: freshness, sample data, keys */}
      <footer className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 text-[1.3rem] text-slate-600 dark:text-slate-300">
        <p className="inline-flex items-center gap-[0.6em]" data-testid="tv-refresh" aria-live="polite">
          <span aria-hidden className={cx('h-[0.7em] w-[0.7em] rounded-full', offline ? 'bg-amber-500' : 'bg-green-600 dark:bg-green-500')} />
          {offline
            ? <>Connection lost · showing data loaded at {updatedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '—'} · retrying every {Math.round(OFFLINE_RETRY_MS / 1000)} s</>
            : <>Live · updated {updatedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) ?? '—'} · refreshes every {Math.round(REFRESH_MS / 1000)} s{rotate ? ` · panels rotate every ${settings.intervalSec} s${teamRotation ? ` · ${rotationTeams.length} teams` : ''}` : ''}</>}
        </p>
        {user?.sandbox && (
          <p className="rounded-full bg-amber-100 px-[0.8em] py-[0.15em] font-medium text-amber-950 ring-1 ring-inset ring-amber-300" data-testid="tv-sandbox">
            Demo sandbox · sample data, resets every night
          </p>
        )}
        {latest?.sampleData && !hideSampleNotice && (
          <p className="rounded-full bg-slate-200 px-[0.8em] py-[0.15em] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200" data-testid="tv-sample-data">
            Includes sample data
          </p>
        )}
        <p className="hidden items-center gap-[0.9em] lg:inline-flex" aria-label="Keyboard shortcuts">
          {[['F', 'Full screen'], ['T', 'Theme'], ['R', 'Rotate'], ['S', 'Set up'], ['← →', 'Panels'], ['Esc', 'Exit']].map(([k, l]) => (
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

const FocusPanel: React.FC<{ model: TvModel; recommendations: TvRecommendations | null; wide: boolean; tracked?: TrackedAction[] | null; alerts: TvSummary['alerts'] | null }> = ({ model, recommendations, wide, tracked, alerts }) => {
  const openAlerts = alerts ? alerts.counts.open + alerts.counts.acknowledged : 0;
  // Tracked actions (the team's action plan) take the right column; else the recommendations.
  const trackedShown = (tracked ?? []).slice(0, 4);
  const actions = trackedShown.length ? [] : recommendations && recommendations.aiEnabled !== false ? (recommendations.actionPlan ?? []).slice(0, 3) : [];
  const shown = model.offTarget.slice(0, wide ? 5 : 8);
  return (
    <div className={cx('grid min-h-0 flex-1 gap-[1.25rem]', wide && (actions.length || trackedShown.length) ? 'grid-cols-[minmax(0,11fr)_minmax(0,9fr)]' : 'grid-cols-1')}>
      {openAlerts > 0 && alerts ? <AlertsCard alerts={alerts} wide={wide} /> : (
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
        {alerts && <p className="mt-auto pt-3 text-[1.25rem] font-medium text-green-700 dark:text-green-400" data-testid="tv-no-alerts">No open alerts</p>}
      </article>
      )}
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

const SEVERITY_META: Record<'critical' | 'warning' | 'info', { label: string; dot: string; text: string }> = {
  critical: { label: 'Critical', dot: 'bg-red-600 dark:bg-red-500', text: 'text-red-700 dark:text-red-400' },
  warning: { label: 'Warning', dot: 'bg-amber-500 dark:bg-amber-400', text: 'text-amber-700 dark:text-amber-400' },
  info: { label: 'Info', dot: 'bg-slate-400 dark:bg-slate-500', text: 'text-slate-600 dark:text-slate-300' },
};

/** The team's open alerts: count by severity and the most urgent ones (no names on a shared screen). */
const AlertsCard: React.FC<{ alerts: NonNullable<TvSummary['alerts']>; wide: boolean }> = ({ alerts, wide }) => {
  const total = alerts.counts.open + alerts.counts.acknowledged;
  const shown = alerts.items.slice(0, wide ? 3 : 6);
  return (
    <article className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900" data-testid="tv-alerts">
      <h3 className="flex items-center gap-[0.5em] text-[1.7rem] font-semibold"><BellRing className="h-[1em] w-[1em]" aria-hidden /> Open alerts</h3>
      <p className="mt-1 flex flex-wrap gap-x-[1em] text-[1.25rem] text-slate-600 dark:text-slate-300">
        <span><span className="font-semibold tabular-nums text-slate-900 dark:text-white" data-testid="tv-alerts-total">{total}</span> open</span>
        {(['critical', 'warning', 'info'] as const).filter((k) => alerts.counts[k] > 0).map((k) => (
          <span key={k} className={cx('font-semibold', SEVERITY_META[k].text)}>{alerts.counts[k]} {SEVERITY_META[k].label.toLowerCase()}</span>
        ))}
        {alerts.counts.acknowledged > 0 && <span>{alerts.counts.acknowledged} acknowledged</span>}
      </p>
      <ul className="mt-4 min-h-0 flex-1 space-y-[0.8rem] overflow-hidden">
        {shown.map((a) => {
          const m = SEVERITY_META[a.severity];
          return (
            <li key={a.id} className="flex items-start gap-4 rounded-xl border border-slate-200 p-[0.9rem] dark:border-slate-800">
              <span aria-hidden className={cx('mt-[0.45rem] h-[1rem] w-[1rem] flex-shrink-0 rounded-full', m.dot)} />
              <div className="min-w-0">
                <p className="text-[1.4rem] font-medium leading-snug">{a.message}</p>
                <p className="mt-0.5 text-[1.15rem] text-slate-600 dark:text-slate-300">
                  <span className={cx('font-semibold', m.text)}>{m.label}</span> · since {tvDay(a.createdAt)}{a.acknowledged ? ' · acknowledged' : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {total > shown.length && <p className="mt-2 text-[1.2rem] text-slate-500 dark:text-slate-400">and {total - shown.length} more on the Alerts page</p>}
    </article>
  );
};

const wellbeingBand = (score: number | null, bands: { good: number; warning: number }) =>
  score === null ? null : score >= bands.good ? { label: 'Good', cls: 'text-green-700 dark:text-green-400', bar: 'bg-green-600 dark:bg-green-500' }
    : score >= bands.warning ? { label: 'Watch', cls: 'text-amber-700 dark:text-amber-400', bar: 'bg-amber-500 dark:bg-amber-400' }
      : { label: 'Low', cls: 'text-red-700 dark:text-red-400', bar: 'bg-red-600 dark:bg-red-500' };

/** Wellbeing pulse: the latest closed period (score 0–100, the five answers), and the trend. */
const PulsePanel: React.FC<{ pulse: TvSummary['pulse'] | null; wide: boolean }> = ({ pulse, wide }) => {
  if (!pulse) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-3xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700" data-testid="tv-pulse">
        <p className="max-w-[40rem] text-[1.8rem] text-slate-600 dark:text-slate-300">The wellbeing pulse is not available for this team.</p>
      </div>
    );
  }
  const l = pulse.latest;
  const band = wellbeingBand(l.score, pulse.bands);
  const trend = pulse.periods.filter((p) => !p.suppressed && p.score !== null);
  return (
    <div className={cx('grid min-h-0 flex-1 gap-[1.25rem]', wide ? 'grid-cols-[minmax(0,9fr)_minmax(0,11fr)]' : 'grid-cols-1')} data-testid="tv-pulse">
      <article className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="flex items-center gap-[0.5em] text-[1.7rem] font-semibold"><HeartPulse className="h-[1em] w-[1em]" aria-hidden /> Latest pulse</h3>
        <p className="mt-1 text-[1.25rem] text-slate-600 dark:text-slate-300">Anonymous pulse survey · {shortDate(l.start)} – {shortDate(l.lastDay)}</p>
        {l.suppressed || l.score === null ? (
          <div className="flex flex-1 flex-col justify-center" data-testid="tv-pulse-suppressed">
            <p className="text-[2.2rem] font-semibold leading-tight">{l.suppressed ? 'Not shown' : 'No responses'}</p>
            <p className="mt-2 text-[1.4rem] text-slate-600 dark:text-slate-300">
              {l.suppressed ? `Fewer than ${pulse.minResponses} people answered, so the result stays private.` : 'Nobody answered in the last period.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col justify-center">
            <p className="flex items-baseline gap-3">
              <span className="text-[8rem] font-semibold leading-none tracking-tighter tabular-nums" data-testid="tv-pulse-score">{Math.round(l.score)}</span>
              <span className="text-[2.2rem] font-medium text-slate-500 dark:text-slate-400">/ 100</span>
            </p>
            {band && <p className={cx('mt-2 text-[2rem] font-semibold', band.cls)}>{band.label}</p>}
            <p className="mt-2 text-[1.3rem] text-slate-600 dark:text-slate-300">{l.responses} responses · results shown from {pulse.minResponses}</p>
          </div>
        )}
        <p className="mt-3 text-[1.2rem] text-slate-500 dark:text-slate-400">Running period: {pulse.currentPeriod.responsesSoFarText.toLowerCase()}</p>
      </article>
      <article className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-7 dark:border-slate-800 dark:bg-slate-900">
        {l.questions && !l.suppressed ? (
          <>
            <h3 className="text-[1.7rem] font-semibold">How the team answered</h3>
            <p className="mt-1 text-[1.25rem] text-slate-600 dark:text-slate-300">Average on a scale of 1 (strongly disagree) to 5 (strongly agree)</p>
            <ul className="mt-4 flex min-h-0 flex-1 flex-col justify-around gap-[0.6rem]">
              {l.questions.map((q) => (
                <li key={q.key}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="min-w-0 text-[1.3rem] leading-snug">{q.text}</span>
                    <span className="text-[1.7rem] font-semibold tabular-nums">{q.mean.toFixed(1)}</span>
                  </div>
                  <div className="mt-1 h-[0.7rem] rounded-full bg-slate-200 dark:bg-slate-800" aria-hidden>
                    <div className={cx('h-full rounded-full', wellbeingBand(((q.mean - 1) / 4) * 100, pulse.bands)?.bar)} style={{ width: `${((q.mean - 1) / 4) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <h3 className="text-[1.7rem] font-semibold">Trend</h3>
        )}
        {trend.length > 1 && (
          <div className={cx(l.questions && !l.suppressed ? 'mt-4 border-t border-slate-200 pt-4 dark:border-slate-800' : 'mt-4 flex-1')} data-testid="tv-pulse-trend">
            {l.questions && !l.suppressed && <p className="text-[1.25rem] font-medium text-slate-600 dark:text-slate-300">Trend, last {trend.length} periods</p>}
            <ol className="mt-2 flex h-[7rem] items-end gap-[0.6rem]" aria-label="Wellbeing score per period">
              {trend.map((p) => (
                <li key={p.start} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[1.05rem] font-semibold tabular-nums">{Math.round(p.score!)}</span>
                  <span className={cx('w-full rounded-t-md', wellbeingBand(p.score, pulse.bands)?.bar)} style={{ height: `${Math.max(6, p.score!)}%` }} aria-hidden />
                  <span className="sr-only">{shortDate(p.start)}: {Math.round(p.score!)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </article>
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
  theme: ThemeId;
  onTheme: () => void;
  onSettings: () => void;
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
      <button type="button" className={ctl(p.rotate)} aria-pressed={p.rotate} onClick={p.onRotate} title="Rotate panels and teams (R)" data-testid="tv-rotate">
        <Repeat className="h-[1.2rem] w-[1.2rem]" aria-hidden /> Auto-rotate
      </button>
      <button type="button" className={ctl()} onClick={p.onTheme} title="Next theme (T)" data-testid="tv-theme" aria-label={`Theme: ${themeLabel(p.theme)}. Switch to ${themeLabel(THEME_CYCLE[(THEME_CYCLE.indexOf(p.theme) + 1) % THEME_CYCLE.length])}`}>
        <Palette className="h-[1.2rem] w-[1.2rem]" aria-hidden /> {themeLabel(p.theme)}
      </button>
      <button type="button" className={ctl()} onClick={p.onSettings} title="Set up the screen: rotation, teams, panels (S)" data-testid="tv-settings">
        <Settings2 className="h-[1.2rem] w-[1.2rem]" aria-hidden /> Set up
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

/* ------------------------------------------------------------------ */
/* Set up the screen: rotation interval, panels, teams, theme           */
/* ------------------------------------------------------------------ */

const TvSettingsDialog: React.FC<{
  settings: TvSettings;
  teams: { id: string; name: string; department_name: string | null }[];
  theme: ThemeId;
  teamId: string | null;
  rotate: boolean;
  onClose: () => void;
  onApply: (s: TvSettings, theme: ThemeId, rotate: boolean) => void;
}> = (p) => {
  const [intervalSec, setIntervalSec] = useState(p.settings.intervalSec);
  const [panels, setPanels] = useState<Panel[]>(p.settings.panels);
  const [mode, setMode] = useState<'one' | 'all' | 'some'>(p.settings.teams === null ? 'one' : p.settings.teams === 'all' ? 'all' : 'some');
  const [chosen, setChosen] = useState<string[]>(Array.isArray(p.settings.teams) ? p.settings.teams : p.teams.map((t) => t.id));
  const [theme, setThemeChoice] = useState<ThemeId>(p.theme);
  const [rotate, setRotateChoice] = useState(p.rotate);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => { first.current?.focus(); }, []);

  const next = (): TvSettings => ({
    intervalSec,
    panels: panels.length ? panels : PANELS.map((x) => x.id),
    teams: mode === 'one' ? null : mode === 'all' ? 'all' : chosen.filter((id) => p.teams.some((t) => t.id === id)),
  });
  const invalid = panels.length === 0 || (mode === 'some' && chosen.length < 2);
  const kioskLink = () => {
    const n = next();
    const q = new URLSearchParams();
    if (p.teamId) q.set('team', mode === 'some' && n.teams && Array.isArray(n.teams) && !n.teams.includes(p.teamId) ? n.teams[0] : p.teamId);
    q.set('theme', theme);
    q.set('rotate', rotate ? '1' : '0');
    q.set('interval', String(n.intervalSec));
    q.set('panels', n.panels.join(','));
    if (n.teams) q.set('teams', n.teams === 'all' ? 'all' : n.teams.join(','));
    return `${window.location.origin}/tv?${q.toString()}`;
  };
  const copy = async () => {
    const link = kioskLink();
    try { await navigator.clipboard.writeText(link); toast.success('Screen link copied: open it on the wall screen and sign in once.', { id: 'tv-link' }); }
    catch { toast(link, { id: 'tv-link', duration: 15000 }); }
  };
  const label = 'text-[1.15rem] font-semibold text-slate-700 dark:text-slate-200';
  const check = 'h-[1.4rem] w-[1.4rem] accent-brand-700';
  const row = 'flex min-h-[2.8rem] items-center gap-3 text-[1.15rem]';
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="tv-settings-title" className="flex max-h-[calc(100vh-2rem)] w-full max-w-[56rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-white" data-testid="tv-settings-dialog">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 id="tv-settings-title" className="text-[1.6rem] font-semibold">Set up the screen</h2>
          <button type="button" onClick={p.onClose} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" aria-label="Close"><X className="h-[1.4rem] w-[1.4rem]" aria-hidden /></button>
        </div>
        <div className="grid gap-6 overflow-y-auto px-6 py-5 sm:grid-cols-2">
          <div className="space-y-5">
            <label className="block">
              <span className={label}>Show each panel for</span>
              <select ref={first} value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value))} className="mt-1 block h-[2.8rem] w-full rounded-lg border border-slate-300 bg-white px-3 text-[1.15rem] dark:border-slate-700 dark:bg-slate-900" data-testid="tv-settings-interval">
                {TV_INTERVALS.map((n) => <option key={n} value={n}>{n < 60 ? `${n} seconds` : `${n / 60} minute${n === 60 ? '' : 's'}`}</option>)}
                {!TV_INTERVALS.includes(intervalSec) && <option value={intervalSec}>{intervalSec} seconds</option>}
              </select>
            </label>
            <fieldset>
              <legend className={label}>Panels</legend>
              {PANELS.map((x) => (
                <label key={x.id} className={row}>
                  <input type="checkbox" className={check} checked={panels.includes(x.id)} data-testid={`tv-settings-panel-${x.id}`}
                    onChange={(e) => setPanels((cur) => PANELS.map((y) => y.id).filter((id) => (id === x.id ? e.target.checked : cur.includes(id))))} />
                  {x.label}
                </label>
              ))}
              {panels.length === 0 && <p className="text-[1.05rem] font-medium text-red-700 dark:text-red-400">Choose at least one panel.</p>}
            </fieldset>
            <label className={row}>
              <input type="checkbox" className={check} checked={rotate} onChange={(e) => setRotateChoice(e.target.checked)} data-testid="tv-settings-rotate" />
              Rotate automatically
            </label>
            <fieldset>
              <legend className={label}>Theme</legend>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {THEME_CYCLE.map((t) => (
                  <label key={t} className={cx('flex min-h-[2.8rem] cursor-pointer items-center gap-2 rounded-lg border px-3 text-[1.15rem]', theme === t ? 'border-brand-600 ring-1 ring-brand-600 dark:border-brand-400 dark:ring-brand-400' : 'border-slate-300 dark:border-slate-700')}>
                    <input type="radio" name="tv-theme" className={check} checked={theme === t} onChange={() => setThemeChoice(t)} />
                    {themeLabel(t)}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <fieldset className="min-w-0">
            <legend className={label}>Teams</legend>
            {(['one', 'all', 'some'] as const).map((m) => (
              <label key={m} className={row}>
                <input type="radio" name="tv-team-mode" className={check} checked={mode === m} onChange={() => setMode(m)} data-testid={`tv-settings-teams-${m}`} disabled={m !== 'one' && p.teams.length < 2} />
                {m === 'one' ? 'This team only' : m === 'all' ? `Every team in my scope (${p.teams.length})` : 'These teams:'}
              </label>
            ))}
            {mode === 'some' && (
              <div className="ml-[2.2rem] max-h-[18rem] overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                {p.teams.map((t) => (
                  <label key={t.id} className={row}>
                    <input type="checkbox" className={check} checked={chosen.includes(t.id)} onChange={(e) => setChosen((cur) => (e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id)))} />
                    <span className="min-w-0">{t.name}{t.department_name && <span className="text-slate-500 dark:text-slate-400"> · {t.department_name}</span>}</span>
                  </label>
                ))}
              </div>
            )}
            {mode === 'some' && chosen.length < 2 && <p className="mt-1 text-[1.05rem] font-medium text-red-700 dark:text-red-400">Choose at least two teams to rotate.</p>}
            <p className="mt-3 text-[1.05rem] text-slate-600 dark:text-slate-300">Only the teams in your scope are listed. With several teams, the screen shows every chosen panel of a team, then moves on to the next team.</p>
          </fieldset>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <button type="button" onClick={copy} disabled={invalid} className={cx(bigButton('secondary'), 'text-[1.15rem] disabled:opacity-50')} data-testid="tv-settings-copy">
            <Link2 className="h-[1.2rem] w-[1.2rem]" aria-hidden /> Copy screen link
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={p.onClose} className={cx(bigButton('secondary'), 'text-[1.15rem]')}>Cancel</button>
            <button type="button" disabled={invalid} onClick={() => p.onApply(next(), theme, rotate)} className={cx(bigButton('primary'), 'text-[1.15rem] disabled:opacity-50')} data-testid="tv-settings-apply">Start</button>
          </div>
        </div>
      </div>
    </div>
  );
};
