/**
 * Navigation into and out of Team TV mode (/tv?team=<id>).
 *
 * App.tsx maps /tv to the 'tv' view and re-reads the location on popstate, so entering TV
 * mode is a pushState plus a popstate event: any component can open it without callbacks
 * (Team detail, the analytics scope bar). The history entry is marked so Exit can return
 * to the page TV mode was opened from.
 */

export const TV_PATH = '/tv';
const FROM_APP = 'irongateTvFromApp';

export function tvUrl(teamId?: string | null): string {
  return teamId ? `${TV_PATH}?team=${encodeURIComponent(teamId)}` : TV_PATH;
}

export function openTvMode(teamId?: string | null): void {
  window.history.pushState({ [FROM_APP]: true }, '', tvUrl(teamId));
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
}

/** Leave TV mode: back to the page it was opened from, else to the overview. */
export function exitTvMode(): void {
  if (window.history.state && window.history.state[FROM_APP]) {
    window.history.back();
    return;
  }
  window.history.pushState(null, '', '/');
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
}

/** Change the team shown, keeping the history entry (and its "opened from the app" mark). */
export function replaceTvTeam(teamId: string): void {
  const params = new URLSearchParams(window.location.search);
  params.set('team', teamId);
  window.history.replaceState(window.history.state, '', `${TV_PATH}?${params.toString()}`);
}

/** Fired by App when the server reports new team KPIs (WebSocket JOB_NOTIFICATION, source 'metrics'). */
export const METRICS_UPDATED_EVENT = 'irongate:metrics-updated';
