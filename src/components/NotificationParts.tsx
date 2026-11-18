import React from 'react';
import { API_URL } from '../config/api';
import { Badge, cx, type Tone } from './ui';

/** Shared pieces of the alerts / notifications / actions screens. */

export type Severity = 'info' | 'warning' | 'critical';

export const SEVERITY_META: Record<Severity, { label: string; tone: Tone; dot: string }> = {
  critical: { label: 'Critical', tone: 'bad', dot: 'bg-red-600 dark:bg-red-500' },
  warning: { label: 'Warning', tone: 'warn', dot: 'bg-amber-500' },
  info: { label: 'Info', tone: 'neutral', dot: 'bg-slate-400 dark:bg-slate-500' },
};

export const SeverityBadge: React.FC<{ severity: Severity }> = ({ severity }) => (
  <Badge tone={SEVERITY_META[severity]?.tone ?? 'neutral'}>{SEVERITY_META[severity]?.label ?? severity}</Badge>
);

/** Fire an authenticated JSON request; throws an Error with the API's message on failure. */
export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error || `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

/** "5 min ago", "3 h ago", "2 days ago", else a date. */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} day${Math.round(s / 86400) === 1 ? '' : 's'} ago`;
  return shortDate(iso);
}

export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', ...(iso.length === 10 ? { timeZone: 'UTC' } : {}) }) : '—';

/** Switch (role="switch") with a visible label. */
export const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; description?: React.ReactNode; disabled?: boolean; testId?: string }> = ({ checked, onChange, label, description, disabled, testId }) => {
  const id = React.useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p id={`${id}-l`} className={cx('text-sm font-medium text-slate-900 dark:text-white', disabled && 'opacity-60')}>{label}</p>
        {description && <p id={`${id}-d`} className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        data-testid={testId}
        className={cx(
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-brand-700 dark:bg-brand-500' : 'bg-slate-300 dark:bg-slate-600',
        )}
      >
        <span className={cx('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
      </button>
    </div>
  );
};

/** Event other screens fire when notifications or alerts changed (the bell reloads its count). */
export const NOTIFICATIONS_CHANGED_EVENT = 'irongate:notifications-changed';
export const notifyNotificationsChanged = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
