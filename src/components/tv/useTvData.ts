import { useCallback, useEffect, useRef, useState } from 'react';
import API_URL from '../../config/api';
import type { HistoryPoint } from '../../data/kpiTrend';
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
    sampleData: boolean;
  } | null;
  technicalDebtScore: number | null;
  history: Record<string, HistoryPoint[]>;
  historyDays: number;
  generatedAt: string;
}

/** GET /api/teams/:id/ai-suggestions — only the parts TV mode shows. */
export interface TvRecommendations {
  source?: 'groq' | 'rule-based';
  aiEnabled?: boolean;
  actionPlan?: { priority: string; initiative: string; owner: string; timebox: string; kpi: string }[];
}

export type TvLoadState = 'loading' | 'ready' | 'forbidden' | 'signed-out' | 'error';

export const REFRESH_MS = 60_000;
const RECOMMENDATIONS_MS = 15 * 60_000;

/**
 * Loads the TV summary for one team and keeps it fresh: every 60 s, when the server
 * reports new KPIs (METRICS_UPDATED_EVENT from App's live channel) and when the tab
 * becomes visible again. A failed refresh keeps the last data on screen and flags it
 * as offline; the next tick retries.
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
      const res = await fetch(`${API_URL}/tv/teams/${encodeURIComponent(id)}`, { credentials: 'include', cache: 'no-store' });
      if (current.current !== id) return; // team changed while loading
      if (res.status === 401) { setState('signed-out'); return; }
      if (res.status === 403 || res.status === 404) { setData(null); setState('forbidden'); return; }
      if (!res.ok) throw new Error(String(res.status));
      const body: TvSummary = await res.json();
      if (current.current !== id) return;
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
    setData(null);
    setState('loading');
    setOffline(false);
    if (!teamId) return;
    load();
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
