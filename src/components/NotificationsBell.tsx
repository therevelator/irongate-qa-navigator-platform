import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Bell, CheckCheck, Settings } from 'lucide-react';
import toast from 'react-hot-toast';
import { buttonClass, cx } from './ui';
import { api, NOTIFICATIONS_CHANGED_EVENT, notifyNotificationsChanged, SEVERITY_META, timeAgo, type Severity } from './NotificationParts';
import { METRICS_UPDATED_EVENT } from './tv/tvNavigation';

/**
 * Top-bar bell: unread count of the caller's notifications (GET /api/notifications/unread-count,
 * every 60 s, on focus and after KPI updates), a panel with the latest ones, mark read,
 * acknowledge an alert (when the caller may), and links to the Notifications page.
 */

interface NotificationItem {
  id: string;
  kind: 'alert' | 'action';
  severity: Severity;
  title: string;
  body: string | null;
  createdAt: string;
  readAt: string | null;
  alertId: string | null;
  alert: { status: 'open' | 'acknowledged' | 'resolved'; canAcknowledge: boolean } | null;
}

const POLL_MS = 60_000;

const NotificationsBell: React.FC<{ onOpenAll: (tab?: 'alerts' | 'inbox' | 'preferences') => void }> = ({ onOpenAll }) => {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const loadCount = useCallback(async () => {
    try {
      const r = await api<{ unreadCount: number }>('/notifications/unread-count');
      setUnread(r.unreadCount);
    } catch { /* keep the last count */ }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const r = await api<{ notifications: NotificationItem[]; unreadCount: number }>('/notifications?limit=8');
      setItems(r.notifications);
      setUnread(r.unreadCount);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Notifications could not be loaded');
    }
  }, []);

  useEffect(() => {
    loadCount();
    const t = window.setInterval(loadCount, POLL_MS);
    const onFocus = () => loadCount();
    const onChanged = () => { loadCount(); if (open) loadItems(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    window.addEventListener(METRICS_UPDATED_EVENT, onChanged);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
      window.removeEventListener(METRICS_UPDATED_EVENT, onChanged);
    };
  }, [loadCount, loadItems, open]);

  useEffect(() => { if (open) loadItems(); }, [open, loadItems]);

  // Close on Escape (focus back to the bell) and on a click outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); } };
    const onClick = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);

  const markRead = async (n: NotificationItem) => {
    if (n.readAt) return;
    try {
      const r = await api<{ unreadCount: number }>(`/notifications/${n.id}/read`, { method: 'POST' });
      setUnread(r.unreadCount);
      setItems((xs) => xs?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? null);
    } catch (e: any) { toast.error(e.message); }
  };

  const markAll = async () => {
    try {
      await api('/notifications/read-all', { method: 'POST' });
      setUnread(0);
      setItems((xs) => xs?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? null);
      notifyNotificationsChanged();
    } catch (e: any) { toast.error(e.message); }
  };

  const acknowledge = async (n: NotificationItem) => {
    if (!n.alertId) return;
    setBusy(n.id);
    try {
      await api(`/alerts/${n.alertId}/acknowledge`, { method: 'POST' });
      toast.success('Alert acknowledged');
      await loadItems();
      notifyNotificationsChanged();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  const shown = unread > 99 ? '99+' : String(unread);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="notifications-bell"
        className="relative h-9 w-9 flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800"
      >
        <Bell size={16} aria-hidden />
        {unread > 0 && (
          <span data-testid="notifications-unread" className="absolute -right-1.5 -top-1.5 min-w-[1.15rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-[1.15rem] text-white ring-2 ring-white dark:bg-red-700 dark:ring-slate-900">
            {shown}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          data-testid="notifications-panel"
          className="fixed inset-x-4 top-16 z-50 flex max-h-[calc(100vh-5rem)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[26rem]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Notifications{unread ? <span className="ml-1.5 font-normal text-slate-500 dark:text-slate-400">· {unread} unread</span> : null}</p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={markAll} disabled={!unread} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800" data-testid="notifications-read-all">
                <CheckCheck size={14} aria-hidden /> Mark all read
              </button>
              <button type="button" onClick={() => { setOpen(false); onOpenAll('preferences'); }} aria-label="Notification preferences" title="Notification preferences" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
                <Settings size={15} aria-hidden />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {error ? (
              <p className="px-4 py-6 text-sm text-red-700 dark:text-red-400">{error}</p>
            ) : items === null ? (
              <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-medium text-slate-900 dark:text-white">No notifications</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Alerts for your teams and actions assigned to you appear here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="notifications-list">
                {items.map((n) => (
                  <li key={n.id} className={cx('px-4 py-3', !n.readAt && 'bg-brand-50/50 dark:bg-slate-800/40')} data-testid="notification-item">
                    <div className="flex items-start gap-3">
                      <span aria-hidden className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', SEVERITY_META[n.severity]?.dot)} />
                      <button type="button" onClick={() => markRead(n)} className="min-w-0 flex-1 text-left" aria-label={`${n.title}${n.readAt ? '' : ', unread. Mark as read'}`}>
                        <p className={cx('text-sm text-slate-900 dark:text-white', !n.readAt && 'font-semibold')}>{n.title}</p>
                        {n.body && <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{n.body}</p>}
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                          {SEVERITY_META[n.severity]?.label} · {timeAgo(n.createdAt)}
                          {n.alert?.status === 'resolved' ? ' · resolved' : n.alert?.status === 'acknowledged' ? ' · acknowledged' : ''}
                        </p>
                      </button>
                      {n.alert?.canAcknowledge && (
                        <button type="button" onClick={() => acknowledge(n)} disabled={busy === n.id} className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800" data-testid="notification-ack">
                          {busy === n.id ? '…' : 'Acknowledge'}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
            <button type="button" onClick={() => { setOpen(false); onOpenAll('alerts'); }} className={cx(buttonClass.secondary, 'flex-1')} data-testid="notifications-view-alerts">All alerts</button>
            <button type="button" onClick={() => { setOpen(false); onOpenAll('inbox'); }} className={cx(buttonClass.secondary, 'flex-1')}>All notifications</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationsBell;
