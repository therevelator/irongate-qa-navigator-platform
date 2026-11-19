import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, RefreshCw, Save, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Card, CardHeader, EmptyState, Page, PageIntro, SegmentedControl, StatTile, buttonClass, cx, inputClass } from './ui';
import { api, notifyNotificationsChanged, SeverityBadge, Switch, timeAgo, NOTIFICATIONS_CHANGED_EVENT, type Severity } from './NotificationParts';

/**
 * Notifications page (/notifications): the alerts of the caller's scope (acknowledge), their own
 * inbox, and their notification preferences (channels, minimum severity, weekly digest, test digest).
 */

type Tab = 'alerts' | 'inbox' | 'preferences';
export const NOTIFICATIONS_TAB_KEY = 'irongate_notifications_tab';
export const NOTIFICATIONS_TAB_EVENT = 'irongate:notifications-tab';

interface AlertItem {
  id: string; teamId: string | null; teamName: string | null; rule: string; ruleLabel: string; metricLabel: string | null; severity: Severity;
  message: string; createdAt: string; lastSeenAt: string; acknowledgedAt: string | null; acknowledgedBy: string | null; resolvedAt: string | null; canAcknowledge: boolean;
}
interface AlertsResponse { alerts: AlertItem[]; total: number; counts: { open: number; acknowledged: number; critical: number; warning: number; info: number } }
interface NotificationItem { id: string; kind: string; severity: Severity; title: string; body: string | null; createdAt: string; readAt: string | null; alertId: string | null; alert: { status: string; canAcknowledge: boolean } | null }
interface Prefs { inApp: boolean; emailImmediate: boolean; weeklyDigest: boolean; minSeverity: Severity }

const readTab = (): Tab => {
  const fromUrl = new URLSearchParams(window.location.search).get('tab');
  let stored: string | null = null;
  try { stored = sessionStorage.getItem(NOTIFICATIONS_TAB_KEY); sessionStorage.removeItem(NOTIFICATIONS_TAB_KEY); } catch { /* storage unavailable */ }
  const t = fromUrl || stored;
  return t === 'inbox' || t === 'preferences' ? t : 'alerts';
};

const NotificationsCenter: React.FC = () => {
  const [tab, setTab] = useState<Tab>(readTab);
  useEffect(() => {
    const on = (e: Event) => { const t = (e as CustomEvent).detail; if (t === 'alerts' || t === 'inbox' || t === 'preferences') setTab(t); };
    window.addEventListener(NOTIFICATIONS_TAB_EVENT, on);
    return () => window.removeEventListener(NOTIFICATIONS_TAB_EVENT, on);
  }, []);
  return (
    <Page>
      <PageIntro
        title="Notifications"
        description="Alerts for the teams in your scope, what was sent to you, and how you want to be told."
        actions={<SegmentedControl<Tab> value={tab} onChange={setTab} options={[{ value: 'alerts', label: 'Alerts' }, { value: 'inbox', label: 'Inbox' }, { value: 'preferences', label: 'Preferences' }]} />}
      />
      {tab === 'alerts' ? <AlertsTab /> : tab === 'inbox' ? <InboxTab /> : <PreferencesTab />}
    </Page>
  );
};

/* ------------------------------------------------------------------ */

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
] as const;
type Status = typeof STATUS_OPTIONS[number]['value'];

const AlertsTab: React.FC = () => {
  const [status, setStatus] = useState<Status>('open');
  const [team, setTeam] = useState('');
  const [severity, setSeverity] = useState<'' | Severity>('');
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<AlertsResponse>(`/alerts?status=${status}&limit=300`));
    } catch (e: any) { setError(e.message); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const teams = useMemo(() => [...new Set((data?.alerts ?? []).map((a) => a.teamName ?? 'Company'))].sort(), [data]);
  const rows = (data?.alerts ?? []).filter((a) => (!team || (a.teamName ?? 'Company') === team) && (!severity || a.severity === severity));

  const ack = async (a: AlertItem) => {
    setBusy(a.id);
    try {
      await api(`/alerts/${a.id}/acknowledge`, { method: 'POST' });
      toast.success('Alert acknowledged');
      notifyNotificationsChanged();
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4" data-testid="alerts-tab">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Open alerts" value={data ? data.counts.open : '—'} caption="Not yet acknowledged" />
        <StatTile label="Critical" value={data ? data.counts.critical : '—'} tone={data?.counts.critical ? 'bad' : 'neutral'} caption="Open or acknowledged" />
        <StatTile label="Warning" value={data ? data.counts.warning : '—'} tone={data?.counts.warning ? 'warn' : 'neutral'} caption="Open or acknowledged" />
        <StatTile label="Acknowledged" value={data ? data.counts.acknowledged : '—'} caption="Still unresolved" />
      </div>
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 dark:border-slate-800 lg:flex-row lg:items-end lg:justify-between">
          <div className="overflow-x-auto"><SegmentedControl<Status> value={status} onChange={setStatus} options={STATUS_OPTIONS.map((o) => ({ ...o }))} /></div>
          <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Team
              <select value={team} onChange={(e) => setTeam(e.target.value)} className={cx(inputClass, 'mt-1 block w-full sm:w-48')} data-testid="alerts-team-filter">
                <option value="">All teams</option>
                {teams.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">Severity
              <select value={severity} onChange={(e) => setSeverity(e.target.value as '' | Severity)} className={cx(inputClass, 'mt-1 block w-full sm:w-36')}>
                <option value="">All</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option>
              </select>
            </label>
            <button type="button" onClick={load} className={cx(buttonClass.secondary, 'col-span-2 sm:col-span-1')} aria-label="Refresh alerts"><RefreshCw size={14} aria-hidden /> Refresh</button>
          </div>
        </div>
        {error ? (
          <p className="p-5 text-sm text-red-700 dark:text-red-400">{error}</p>
        ) : !data ? (
          <p className="p-5 text-sm text-slate-500 dark:text-slate-400">Loading alerts…</p>
        ) : rows.length === 0 ? (
          <EmptyState title={status === 'open' ? 'No open alerts' : 'No alerts'} description="Alerts are evaluated after every KPI update and every hour, with the rules set under Administration → Parameters." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="alerts-list">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between" data-testid="alert-row">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={a.severity} />
                    <span className="text-sm font-medium text-slate-900 dark:text-white">{a.teamName ?? 'Company'}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{a.ruleLabel}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{a.message}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Opened {timeAgo(a.createdAt)}
                    {a.resolvedAt ? ` · resolved ${timeAgo(a.resolvedAt)}` : ` · last checked ${timeAgo(a.lastSeenAt)}`}
                    {a.acknowledgedAt ? ` · acknowledged${a.acknowledgedBy ? ` by ${a.acknowledgedBy}` : ''} ${timeAgo(a.acknowledgedAt)}` : ''}
                  </p>
                </div>
                <div className="shrink-0">
                  {a.canAcknowledge ? (
                    <button type="button" onClick={() => ack(a)} disabled={busy === a.id} className={buttonClass.secondary} data-testid="alert-ack">{busy === a.id ? 'Acknowledging…' : 'Acknowledge'}</button>
                  ) : a.resolvedAt ? <Badge tone="good">Resolved</Badge> : a.acknowledgedAt ? <Badge tone="neutral">Acknowledged</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && data.total > data.alerts.length && <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">Showing the newest {data.alerts.length} of {data.total}.</p>}
      </Card>
    </div>
  );
};

/* ------------------------------------------------------------------ */

const InboxTab: React.FC = () => {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await api<{ notifications: NotificationItem[]; unreadCount: number }>(`/notifications?limit=100${onlyUnread ? '&unread=true' : ''}`);
      setItems(r.notifications); setUnread(r.unreadCount); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [onlyUnread]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, load);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, load);
  }, [load]);
  const read = async (n: NotificationItem) => {
    if (n.readAt) return;
    try { await api(`/notifications/${n.id}/read`, { method: 'POST' }); notifyNotificationsChanged(); await load(); } catch (e: any) { toast.error(e.message); }
  };
  const readAll = async () => {
    try { await api('/notifications/read-all', { method: 'POST' }); notifyNotificationsChanged(); await load(); } catch (e: any) { toast.error(e.message); }
  };
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
        <p className="text-sm text-slate-600 dark:text-slate-300">{unread} unread</p>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500 dark:border-slate-600" /> Unread only
          </label>
          <button type="button" onClick={readAll} disabled={!unread} className={buttonClass.secondary}>Mark all read</button>
        </div>
      </div>
      {error ? <p className="p-5 text-sm text-red-700 dark:text-red-400">{error}</p>
        : !items ? <p className="p-5 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        : items.length === 0 ? <EmptyState title="Nothing here" description="Alerts for your teams and actions assigned to you appear here." />
        : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="inbox-list">
            {items.map((n) => (
              <li key={n.id} className={cx('px-4 py-3', !n.readAt && 'bg-brand-50/50 dark:bg-slate-800/40')}>
                <button type="button" onClick={() => read(n)} className="w-full text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={n.severity} />
                    <span className={cx('text-sm text-slate-900 dark:text-white', !n.readAt && 'font-semibold')}>{n.title}</span>
                    {!n.readAt && <span className="text-xs text-brand-700 dark:text-brand-300">Unread</span>}
                  </div>
                  {n.body && <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{n.body}</p>}
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{timeAgo(n.createdAt)}{n.alert ? ` · alert ${n.alert.status}` : ''}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
};

/* ------------------------------------------------------------------ */

const PreferencesTab: React.FC = () => {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saved, setSaved] = useState<Prefs | null>(null);
  const [digestAvailable, setDigestAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ preferences: Prefs; digestAvailable: boolean }>('/notifications/preferences')
      .then((r) => { setPrefs(r.preferences); setSaved(r.preferences); setDigestAvailable(r.digestAvailable); })
      .catch((e) => setError(e.message));
  }, []);

  const dirty = !!prefs && !!saved && JSON.stringify(prefs) !== JSON.stringify(saved);
  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const r = await api<{ preferences: Prefs }>('/notifications/preferences', { method: 'PUT', json: prefs });
      setPrefs(r.preferences); setSaved(r.preferences);
      toast.success('Notification preferences saved');
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };
  const sendTest = async () => {
    setSending(true); setTestResult(null);
    try {
      const r = await api<{ delivered: boolean; message: string }>('/notifications/digest/test', { method: 'POST' });
      setTestResult({ ok: r.delivered, message: r.message });
    } catch (e: any) { setTestResult({ ok: false, message: e.message }); } finally { setSending(false); }
  };

  if (error) return <Card><p className="text-sm text-red-700 dark:text-red-400">{error}</p></Card>;
  if (!prefs) return <Card><p className="text-sm text-slate-500 dark:text-slate-400">Loading preferences…</p></Card>;
  const set = (p: Partial<Prefs>) => setPrefs({ ...prefs, ...p });
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="notification-prefs">
      <Card>
        <CardHeader
          title="How you are told about alerts"
          subtitle="Alerts of the teams in your scope. With a company-wide role you are told about critical team alerts only; all alerts are on the Alerts tab."
          action={<button type="button" onClick={save} disabled={!dirty || saving} className={cx(buttonClass.primary, 'whitespace-nowrap')} data-testid="prefs-save"><Save size={15} aria-hidden /> {saving ? 'Saving…' : 'Save'}</button>}
        />
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <Switch checked={prefs.inApp} onChange={(v) => set({ inApp: v })} label="In the app (bell)" description="A notification in the top bar for each new or escalated alert." testId="pref-in-app" />
          <Switch checked={prefs.emailImmediate} onChange={(v) => set({ emailImmediate: v })} label="Email for each alert" description="An email as soon as an alert opens or escalates." testId="pref-email" />
          <div className="flex items-start justify-between gap-4 py-3">
            <div>
              <label htmlFor="pref-min-severity" className="text-sm font-medium text-slate-900 dark:text-white">Tell me about</label>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Alerts below this level are only listed on the Alerts tab and in the digest.</p>
            </div>
            <select id="pref-min-severity" value={prefs.minSeverity} onChange={(e) => set({ minSeverity: e.target.value as Severity })} className={cx(inputClass, 'w-44 shrink-0 sm:w-52')} data-testid="pref-min-severity">
              <option value="info">All, incl. stale metrics</option>
              <option value="warning">Warning and critical</option>
              <option value="critical">Critical only</option>
            </select>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Weekly digest" subtitle="Mondays 07:00 UTC, by email: QA score changes of your teams, alerts, stale metrics and actions due." />
        {digestAvailable ? (
          <>
            <Switch checked={prefs.weeklyDigest} onChange={(v) => set({ weeklyDigest: v })} label="Send me the weekly digest" description="Covers the teams in your scope." testId="pref-digest" />
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button type="button" onClick={sendTest} disabled={sending} className={buttonClass.secondary} data-testid="send-test-digest"><Send size={14} aria-hidden /> {sending ? 'Sending…' : 'Send me a test digest'}</button>
              {testResult && <p role="status" className={cx('text-sm', testResult.ok ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400')}>{testResult.message}</p>}
            </div>
          </>
        ) : (
          <p className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            <Mail size={15} className="mt-0.5 shrink-0" aria-hidden /> The weekly digest is sent to super admins, managers and team leads.
          </p>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Changes apply from the next alert and the next digest.</p>
      </Card>
    </div>
  );
};

export default NotificationsCenter;
