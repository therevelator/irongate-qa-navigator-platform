import { useEffect, useState } from 'react';
import API_URL from '../../config/api';
import { METRICS_UPDATED_EVENT } from './tvNavigation';
import type { TrackedAction } from '../ActionsPanel';

/**
 * The team's tracked actions for the TV Focus panel (GET /api/actions?teamId=, the same
 * analytics scope as the TV summary): open / in progress first (overdue, then by due date), then
 * actions done in the last 30 days with their computed outcome. Refreshed every 60 s and when
 * the server reports new KPIs. Owners are not shown on TV (no individual data on a shared screen).
 */
const REFRESH_MS = 60_000;

export function useTvActions(teamId: string | null, enabled: boolean): TrackedAction[] | null {
  const [actions, setActions] = useState<TrackedAction[] | null>(null);
  useEffect(() => {
    setActions(null);
    if (!teamId || !enabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/actions?teamId=${encodeURIComponent(teamId)}`, { credentials: 'include' });
        if (!res.ok) { if (!cancelled && res.status === 403) setActions(null); return; }
        const body = await res.json();
        if (cancelled) return;
        const cutoff = Date.now() - 30 * 86_400_000;
        const list: TrackedAction[] = (body.actions ?? []).filter((a: TrackedAction) =>
          a.status === 'open' || a.status === 'in_progress' || (a.status === 'done' && !!a.completedAt && Date.parse(a.completedAt) >= cutoff));
        list.sort((a, b) => rank(a) - rank(b) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
        setActions(list);
      } catch { /* keep what is shown */ }
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    window.addEventListener(METRICS_UPDATED_EVENT, load);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener(METRICS_UPDATED_EVENT, load); };
  }, [teamId, enabled]);
  return actions;
}

const rank = (a: TrackedAction) => (a.overdue ? 0 : a.status === 'in_progress' ? 1 : a.status === 'open' ? 2 : 3);
