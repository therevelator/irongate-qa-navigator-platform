import { useCallback, useEffect, useRef, useState } from 'react';
import API_URL from '../../config/api';
import type { HistoryPoint } from '../../data/kpiTrend';
import type { TargetPeriod } from '../../config/metricsConfig';
import { METRICS_UPDATED_EVENT } from './tvNavigation';

/** GET /api/tv/teams/:id (server/routes/tv.ts): team aggregates only, no individual data. */
export interface TvSummary {
  team: { id: string; name: string; isActive: boolean; departmentName: string | null; leadName: string | null; memberCount: number };
  latest: {
    snapshotDate: string;
    qaScore: number | null;
    status: 'good' | 'warning' | 'critical' | 'no-data';
    kpiData: Record<string, number | null>;
    lastRecordedAt: string | null;
    /** Newest value time; dataOutdated when over a day old (latest values shown as of then). */
    lastUpdated?: string | null;
    dataOutdated?: boolean;
    sampleData: boolean;
    /** What the QA score is based on (stale and missing inputs left out). */
    qaScoreConfidence?: { value: number | null; inputsUsed: number; inputsTotal: number; confidence: 'high' | 'medium' | 'low'; staleInputs: string[]; missingInputs: string[] };
    /** camelCase KPI key -> staleness of its latest value. */
    kpiStaleness?: Record<string, { recordedAt: string | null; stale: boolean; staleSince: string | null; source: string | null }>;
    /** camelCase KPI key -> target valid at the value's date (target history). */
    kpiThresholds?: Record<string, { good: number; warning: number; lowerIsBetter: boolean }>;
  } | null;
  technicalDebtScore: number | null;
  /** The team's open alerts (unresolved): counts and the most urgent ones (no names). */
  alerts?: {
    counts: { open: number; acknowledged: number; critical: number; warning: number; info: number };
    items: { id: string; rule: string; ruleLabel: string; metricLabel: string | null; severity: 'critical' | 'warning' | 'info'; message: string; createdAt: string; acknowledged: boolean }[];
  };
  /** Wellbeing pulse: latest closed period and trend; suppressed below the minimum number of responses. */
  pulse?: {
    cadence: string;
    latest: TvPulsePeriod & { questions: { key: string; text: string; mean: number }[] | null };
    periods: TvPulsePeriod[];
    currentPeriod: { start: string; lastDay: string; responsesSoFarText: string };
    minResponses: number;
    bands: { good: number; warning: number };
  };
  history: Record<string, HistoryPoint[]>;
  historyDays: number;
  /** Target periods per KPI column in the history window (each day judged with its own target). */
  targets?: Record<string, TargetPeriod[]>;
  generatedAt: string;
}

export interface TvPulsePeriod { start: string; lastDay: string; suppressed: boolean; responses: number | null; score: number | null }

/** GET /api/teams/:id/ai-suggestions — only the parts TV mode shows. */
export interface TvRecommendations {
  source?: 'groq' | 'rule-based';
  aiEnabled?: boolean;
  actionPlan?: { priority: string; initiative: string; owner: string; timebox: string; kpi: string }[];
}

export type TvLoadState = 'loading' | 'ready' | 'forbidden' | 'signed-out' | 'error';

export const REFRESH_MS = 60_000;
/** While the connection is lost, retry this often (and at once when the browser says it is back online). */
export const OFFLINE_RETRY_MS = 15_000;
const RECOMMENDATIONS_MS = 15 * 60_000;

/**
 * Summaries already loaded, per team: rotating between teams shows the next team at once (and
 * refreshes it in the background) instead of a loading screen. Kept for this page only.
 */
const cache = new Map<string, { data: TvSummary; at: number }>();

async function fetchSummary(id: string): Promise<Response> {
  return fetch(`${API_URL}/tv/teams/${encodeURIComponent(id)}`, { credentials: 'include', cache: 'no-store' });
}

/** Load a team ahead of showing it (the next team of the rotation); failures are ignored. */
export async function prefetchTvSummary(id: string | null | undefined): Promise<void> {
  if (!id) return;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < REFRESH_MS / 2) return;
  try {
    const res = await fetchSummary(id);
    if (res.ok) cache.set(id, { data: await res.json(), at: Date.now() });
  } catch { /* shown (and retried) when the team comes up */ }
}

/**
 * Loads the TV summary for one team and keeps it fresh: every 60 s, when the server
 * reports new KPIs (METRICS_UPDATED_EVENT from App's live channel) and when the tab
 * becomes visible again. A failed refresh keeps the last data on screen and flags it
 * as offline and retries every OFFLINE_RETRY_MS (and on the browser's "online" event) until the
 * connection is back.
 */
export function useTvSummary(teamId: string | null) {
  const [data, setData] = useState<TvSummary | null>(null);
  const [state, setState] = useState<TvLoadState>('loading');
  const [offline, setOffline] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [fetchCount, setFetchCount] = useState(0);
  const lastFetch = useRef(0);
  const current = useRef<string | null>(teamId);
  current.current = teamId;

  const load = useCallback(async () => {
    const id = current.current;
    if (!id) return;
    lastFetch.current = Date.now();
    try {
      const res = await fetchSummary(id);
      if (current.current !== id) return; // team changed while loading
      if (res.status === 401) { setState('signed-out'); return; }
      if (res.status === 403 || res.status === 404) { setData(null); setState('forbidden'); return; }
      if (!res.ok) throw new Error(String(res.status));
      const body: TvSummary = await res.json();
      if (current.current !== id) return;
      cache.set(id, { data: body, at: Date.now() });
      setData(body);
      setState('ready');
      setOffline(false);
      setUpdatedAt(new Date());
      setFetchCount((n) => n + 1);
    } catch {
      if (current.current !== id) return;
      setOffline(true);
      setState((s) => (s === 'loading' ? 'error' : s));
    }
  }, []);

  useEffect(() => {
    const hit = teamId ? cache.get(teamId) : undefined;
    setData(hit?.data ?? null);
    setState(hit ? 'ready' : 'loading');
    if (!teamId) return;
    if (!hit || Date.now() - hit.at > 5_000) load();
    const timer = window.setInterval(load, REFRESH_MS);
    let debounce: number | undefined;
    const onMetrics = () => { window.clearTimeout(debounce); debounce = window.setTimeout(load, 800); };
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - lastFetch.current > 5_000) load(); };
    window.addEventListener(METRICS_UPDATED_EVENT, onMetrics);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', load);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(debounce);
      window.removeEventListener(METRICS_UPDATED_EVENT, onMetrics);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', load);
    };
  }, [teamId, load]);

  // Connection lost: retry sooner than the normal refresh, until a load succeeds.
  useEffect(() => {
    if (!offline || !teamId) return;
    const t = window.setInterval(load, OFFLINE_RETRY_MS);
    return () => window.clearInterval(t);
  }, [offline, teamId, load]);

  return { data, state, offline, updatedAt, fetchCount, reload: load };
}

/**
 * Team recommendations (rule-based or AI) for roles the API allows (team lead and up);
 * refreshed every 15 minutes, since the endpoint may call a paid model.
 */
export function useTvRecommendations(teamId: string | null, enabled: boolean) {
  const [data, setData] = useState<TvRecommendations | null>(null);
  useEffect(() => {
    setData(null);
    if (!teamId || !enabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/teams/${encodeURIComponent(teamId)}/ai-suggestions`, { credentials: 'include' });
        if (!res.ok) { if (!cancelled && res.status !== 429) setData(null); return; }
        const body = await res.json();
        if (!cancelled) setData(body);
      } catch { /* keep what is shown */ }
    };
    load();
    const timer = window.setInterval(load, RECOMMENDATIONS_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [teamId, enabled]);
  return data;
}
