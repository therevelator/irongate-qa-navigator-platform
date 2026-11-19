import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Footprints, Search } from 'lucide-react';
import { Badge, Card, EmptyState, buttonClass, cx, inputClass, type Tone } from './ui';
import { activityParams, type ActivityFilterState } from '../lib/userActivityFilters';

/**
 * The user activity table (filters, pagination). Shared by the customer screen (UserActivity,
 * super admins) and the platform operator panel; each passes its own loader.
 */

export interface ActivityEntry {
  id: string;
  created_at: string;
  user_id: string | null;
  actor_display: string | null;
  category: string;
  categoryLabel: string;
  label: string;
  method: string | null;
  route: string | null;
  screen: string | null;
  team_name: string | null;
  status: number | null;
  duration_ms: number | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
}

export interface ActivityFacets {
  users: Array<{ id: string; name: string | null; email: string }>;
  teams: Array<{ id: string; name: string }>;
  types: Array<{ value: string; label: string }>;
}

export type ActivityLoader = (params: URLSearchParams) => Promise<{ entries: ActivityEntry[]; nextBefore: string | null }>;

const tone = (e: ActivityEntry): Tone =>
  e.category === 'sign_in_failed' || (e.status ?? 0) >= 400 ? 'bad' : e.category === 'change' ? 'warn' : e.category === 'sign_in' ? 'good' : e.category === 'export' || e.category === 'ingest' ? 'brand' : 'neutral';
const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

const UserActivityList: React.FC<{
  load: ActivityLoader;
  facets: ActivityFacets | null;
  filters: ActivityFilterState;
  onFiltersChange: (f: ActivityFilterState) => void;
}> = ({ load, facets, filters, onFiltersChange }) => {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [moreFilters, setMoreFilters] = useState(false);
  const query = useMemo(() => activityParams(filters).toString(), [filters]);

  const fetchPage = useCallback(async (more: boolean, before: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams(query);
      p.set('limit', '50');
      if (more && before) p.set('before', before);
      const body = await load(p);
      setEntries((prev) => (more ? [...prev, ...body.entries] : body.entries));
      setNextBefore(body.nextBefore ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load the activity');
    } finally {
      setLoading(false);
    }
  }, [query, load]);

  useEffect(() => {
    const t = setTimeout(() => { fetchPage(false, null); }, filters.requestId ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchPage, filters.requestId]);

  const set = (k: keyof ActivityFilterState, v: string | boolean) => onFiltersChange({ ...filters, [k]: v });
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const labelCls = 'mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400';

  return (
    <>
      <Card className="mb-4" padded>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="ua-user" className={labelCls}>User</label>
            <select id="ua-user" value={filters.userId} onChange={(e) => set('userId', e.target.value)} className={cx(inputClass, 'w-full')}>
              <option value="">Everyone</option>
              {(facets?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name ? `${u.name} (${u.email})` : u.email}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ua-type" className={labelCls}>Action type</label>
            <select id="ua-type" value={filters.type} onChange={(e) => set('type', e.target.value)} className={cx(inputClass, 'w-full')} data-testid="ua-type">
              <option value="">All actions</option>
              {(facets?.types ?? []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ua-rid" className={labelCls}>Request id</label>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input id="ua-rid" value={filters.requestId} onChange={(e) => set('requestId', e.target.value)} placeholder="Paste a request id" className={cx(inputClass, 'w-full pl-8')} />
            </div>
          </div>
          <button type="button" onClick={() => setMoreFilters((v) => !v)} aria-expanded={moreFilters} aria-controls="ua-more"
            className="inline-flex items-center gap-1 justify-self-start text-sm font-medium text-brand-700 hover:text-brand-800 sm:hidden dark:text-brand-300">
            {moreFilters ? 'Fewer filters' : 'More filters'} {moreFilters ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </button>
          <div id="ua-more" className={cx('contents', !moreFilters && 'max-sm:hidden')}>
            <div>
              <label htmlFor="ua-team" className={labelCls}>Team</label>
              <select id="ua-team" value={filters.teamId} onChange={(e) => set('teamId', e.target.value)} className={cx(inputClass, 'w-full')}>
                <option value="">All teams</option>
                {(facets?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ua-from" className={labelCls}>From</label>
              <input id="ua-from" type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} className={cx(inputClass, 'w-full')} />
            </div>
            <div>
              <label htmlFor="ua-to" className={labelCls}>To</label>
              <input id="ua-to" type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} className={cx(inputClass, 'w-full')} />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={filters.errors} onChange={(e) => set('errors', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500 dark:border-slate-600" />
              Errors only
            </label>
          </div>
        </div>
      </Card>

      <Card padded={false}>
        {error ? (
          <p role="alert" className="px-5 py-6 text-sm text-red-700 dark:text-red-400">{error}</p>
        ) : !loading && entries.length === 0 ? (
          <EmptyState icon={<Footprints size={28} />} title="No activity matches" description="Sign-ins, views, changes and exports appear here within seconds." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="user-activity-list">
            {entries.map((e) => (
              <li key={e.id} className="px-4 py-3 sm:px-5" data-testid="user-activity-row">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={tone(e)}>{e.categoryLabel}</Badge>
                      {(e.status ?? 0) >= 400 && <Badge tone="bad">{e.status}</Badge>}
                      <span className="text-xs text-slate-500 dark:text-slate-400">{fmt(e.created_at)}</span>
                    </div>
                    <p className="mt-1 break-words text-sm text-slate-900 dark:text-slate-100">{e.label}</p>
                    <p className="mt-0.5 break-all text-xs text-slate-500 dark:text-slate-400">{e.actor_display ?? 'Unknown'}</p>
                  </div>
                  <button type="button" onClick={() => toggle(e.id)} aria-expanded={open.has(e.id)} aria-controls={`ua-details-${e.id}`}
                    className="inline-flex flex-shrink-0 items-center gap-1 self-start rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40 dark:text-slate-300 dark:hover:bg-slate-800">
                    Details {open.has(e.id) ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                  </button>
                </div>
                {open.has(e.id) && (
                  <dl id={`ua-details-${e.id}`} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-[8rem_1fr] dark:border-slate-800 dark:bg-slate-950/50">
                    {([
                      ['Route', e.method ? `${e.method} ${e.route ?? ''}` : e.screen ? `Screen: ${e.screen}` : '—'],
                      ['Team', e.team_name ?? '—'], ['Status', e.status ?? '—'], ['Duration', e.duration_ms != null ? `${e.duration_ms} ms` : '—'],
                      ['IP address', e.ip ?? '—'], ['Browser', e.user_agent ?? '—'], ['Request id', e.request_id ?? '—'],
                    ] as Array<[string, React.ReactNode]>).map(([k, v]) => (
                      <React.Fragment key={k}>
                        <dt className="font-medium text-slate-500 dark:text-slate-400">{k}</dt>
                        <dd className="break-all text-slate-800 dark:text-slate-200">{v}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
        {(loading || nextBefore) && (
          <div className="border-t border-slate-100 px-5 py-3 text-center dark:border-slate-800">
            {loading ? <span className="text-sm text-slate-500 dark:text-slate-400" role="status">Loading…</span>
              : <button type="button" onClick={() => fetchPage(true, nextBefore)} className={buttonClass.secondary}>Load older activity</button>}
          </div>
        )}
      </Card>
    </>
  );
};

export default UserActivityList;
