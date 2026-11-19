/** Filters of the user activity list (src/components/UserActivityList.tsx) as query parameters. */

export const emptyActivityFilters = { userId: '', from: '', to: '', type: '', teamId: '', errors: false, requestId: '' };
export type ActivityFilterState = typeof emptyActivityFilters;

export function activityParams(f: ActivityFilterState): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (k === 'errors') { if (v) p.set('errors', 'true'); } else if (v) p.set(k, String(v).trim());
  }
  return p;
}

