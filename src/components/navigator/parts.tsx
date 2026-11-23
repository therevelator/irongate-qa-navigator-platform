import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { api } from '../NotificationParts';
import { Badge, cx, type Tone } from '../ui';

/**
 * Shared pieces of the "next move" pages (Time lost, Findings, Outcomes, Data readiness): the data hook, the
 * "About this page" box every page carries, and the small charts.
 */

export type Cause = 'slow_stage' | 'flaky_rerun' | 'blocked' | 'failed_change' | 'review_wait';
export const CAUSE_COLOR: Record<Cause, string> = {
  slow_stage: 'bg-teal-700', flaky_rerun: 'bg-amber-500', blocked: 'bg-indigo-500', failed_change: 'bg-red-600', review_wait: 'bg-slate-400',
};
export interface CauseRow { key: Cause; label: string; short: string; rule: string; now: number; before: number }
export interface Week { start: string; end: string; hours: Record<Cause, number>; total: number }

export interface Finding {
  id: string; teamId: string; teamName: string; cause: Cause | null; causeLabel: string | null; title: string; summary: string;
  hours: number | null; confidence: 'high' | 'medium' | 'low'; confidenceWhy: string;
  evidence: Array<{ label: string; value: string; detail?: string }>;
  items: Array<{ kind: string; name: string; detail: string; url?: string | null }>;
  trend: number[]; since: string | null; nextStep: string; expected: string | null; formula: string | null; metricKey: string | null;
  recommendationId: string | null;
  action: { id: string; title: string; status: string; owner: string | null; dueDate: string | null } | null;
}

export function useLoad<T>(path: string): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<T>(path)); setError(null); } catch (e) { setError((e as Error).message || 'Could not load this page'); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

export const hoursText = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n * 10) / 10} h`);
export const dayText = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');

/** What the page does, what it is good for and where its numbers come from. */
export const AboutPage: React.FC<{ does: string; goodFor: string; from: string }> = ({ does, goodFor, from }) => (
  <details className="group mb-6 rounded-lg border border-dashed border-brand-300 bg-brand-50/50 px-4 py-3 text-sm dark:border-brand-900 dark:bg-brand-950/20 print:hidden" data-testid="about-page">
    <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-brand-800 dark:text-brand-300">
      <HelpCircle size={16} aria-hidden /> About this page
      <ChevronDown size={15} aria-hidden className="transition-transform group-open:rotate-180" />
    </summary>
    <dl className="mt-3 grid gap-4 sm:grid-cols-3">
      {[['What it does', does], ['What it is good for', goodFor], ['Where the numbers come from', from]].map(([t, d]) => (
        <div key={t}>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-brand-800 dark:text-brand-300">{t}</dt>
          <dd className="mt-1 text-slate-700 dark:text-slate-300">{d}</dd>
        </div>
      ))}
    </dl>
  </details>
);

export const Spark: React.FC<{ data: number[]; width?: number; height?: number; tone?: Tone; fill?: boolean }> = ({ data, width = 120, height = 32, tone = 'brand', fill = true }) => {
  if (data.length < 2) return <span className="text-xs text-slate-400">no history</span>;
  const stroke = { brand: '#0f766e', good: '#15803d', bad: '#b91c1c', warn: '#b45309', neutral: '#64748b' }[tone];
  const min = Math.min(...data);
  const span = Math.max(...data) - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * (width - 6) + 3, height - 4 - ((v - min) / span) * (height - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`From ${data[0]} to ${data[data.length - 1]} over ${data.length} weeks`} className="block max-w-full">
      {fill && <path d={`${line} L${last[0].toFixed(1)} ${height} L3 ${height} Z`} fill={stroke} opacity="0.1" />}
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={stroke} />
    </svg>
  );
};

export const CauseBar: React.FC<{ causes: CauseRow[] }> = ({ causes }) => {
  const total = causes.reduce((n, c) => n + c.now, 0);
  if (total <= 0) return <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800" />;
  return (
    <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={causes.map((c) => `${c.label}: ${hoursText(c.now)}`).join(', ')}>
      {causes.filter((c) => c.now > 0).map((c) => <span key={c.key} className={cx(CAUSE_COLOR[c.key], 'border-r-2 border-white last:border-r-0 dark:border-slate-900')} style={{ width: `${(c.now / total) * 100}%` }} title={`${c.label}: ${hoursText(c.now)} a week`} />)}
    </div>
  );
};

export const CauseTag: React.FC<{ cause: Cause | null; label: string | null }> = ({ cause, label }) =>
  cause ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
      <span className={cx('h-2 w-2 rounded-full', CAUSE_COLOR[cause])} />{label}
    </span>
  ) : <Badge>KPI</Badge>;

const STATE: Record<string, { label: string; tone: Tone }> = {
  improving: { label: 'Improving', tone: 'good' }, steady: { label: 'Steady', tone: 'neutral' }, slipping: { label: 'Slipping', tone: 'bad' }, unknown: { label: 'Cannot say yet', tone: 'warn' },
};
export const StateBadge: React.FC<{ state: string }> = ({ state }) => <Badge tone={STATE[state]?.tone ?? 'neutral'}>{STATE[state]?.label ?? state}</Badge>;

export const Meter: React.FC<{ value: number }> = ({ value }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="img" aria-label={`${value} percent`}>
    <span className={cx('block h-full rounded-full', value >= 90 ? 'bg-green-600' : value >= 60 ? 'bg-amber-500' : 'bg-red-600')} style={{ width: `${value}%` }} />
  </div>
);

export const Loading: React.FC<{ error: string | null }> = ({ error }) => (
  <p className={cx('py-16 text-center text-sm', error ? 'text-red-700 dark:text-red-400' : 'text-slate-500')} role={error ? 'alert' : 'status'}>{error ?? 'Loading…'}</p>
);

/** Open another "next move" page, optionally for one team (?nteam=). */
export function openPage(onNavigate: (view: string) => void, view: string, teamId?: string | null): void {
  onNavigate(view);
  if (teamId) window.history.replaceState(null, '', `${window.location.pathname}?nteam=${encodeURIComponent(teamId)}`);
}
export const teamFromUrl = () => new URLSearchParams(window.location.search).get('nteam');
