import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Save, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, Card, CardHeader, buttonClass, cx, inputClass, type Tone } from './ui';
import { api, Switch, type Severity } from './NotificationParts';

/**
 * Parameters → "Alerts and notifications" (GET/PUT /api/alerts/rules, /api/notifications/settings):
 *   - alert rules for the selected scope (team > department > company > defaults), with their
 *     parameters; who may edit follows KPI targets (the API decides; read-only otherwise);
 *   - company Slack incoming webhook (super_admin): write-only, shown masked; on/off, minimum
 *     severity, weekly summary; "Send test message";
 *   - "Send test digest" (to yourself) and "Evaluate now" (super_admin).
 */

interface ParamSpec { key: string; label: string; type: 'number' | 'severity'; min?: number; max?: number; unit?: string }
interface RuleRow {
  rule: string; label: string; description: string; params: ParamSpec[];
  own: { enabled: boolean; params: Record<string, number | string> } | null;
  effective: { enabled: boolean; params: Record<string, number | string>; scope: 'team' | 'department' | 'company' | 'default' };
}
interface RulesResponse { scope: { type: string; id: string; name: string }; canEdit: boolean; rules: RuleRow[] }
interface Settings { slackConfigured: boolean; slackHint: string | null; slackUnreadable: boolean; slackEnabled: boolean; slackMinSeverity: Severity; slackDigest: boolean; updatedAt: string | null; updatedBy: string | null }

const SCOPE_META: Record<RuleRow['effective']['scope'], { label: string; tone: Tone }> = {
  team: { label: 'Team', tone: 'brand' }, department: { label: 'Department', tone: 'brand' }, company: { label: 'Company', tone: 'neutral' }, default: { label: 'Default', tone: 'neutral' },
};

type Draft = Record<string, { enabled: boolean; params: Record<string, string>; inherit: boolean }>;

const toDraft = (rules: RuleRow[], scopeType: string): Draft => Object.fromEntries(rules.map((r) => {
  const src = r.own ?? r.effective;
  // The company level has nothing to inherit from but the defaults: it is edited directly.
  return [r.rule, { enabled: src.enabled, params: Object.fromEntries(Object.entries(src.params).map(([k, v]) => [k, String(v)])), inherit: scopeType === 'company' ? false : !r.own }];
}));

const AlertSettings: React.FC<{ scopeType: 'company' | 'department' | 'team'; scopeId: string | null; scopeLabel: string }> = ({ scopeType, scopeId, scopeLabel }) => {
  const [data, setData] = useState<RulesResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const p = new URLSearchParams({ scopeType });
      if (scopeId) p.set('scopeId', scopeId);
      const r = await api<RulesResponse>(`/alerts/rules?${p}`);
      setData(r);
      setDraft(toDraft(r.rules, scopeType));
      setState('ready');
    } catch (e: any) {
      setState(e.status === 403 ? 'forbidden' : 'error');
    }
  }, [scopeType, scopeId]);
  useEffect(() => { load(); }, [load]);

  /** Changes vs what is stored at this scope: { rule: {enabled, params} | null (inherit) }. */
  const changes = useMemo(() => {
    const out: Record<string, { enabled: boolean; params: Record<string, number | string> } | null> = {};
    for (const r of data?.rules ?? []) {
      const d = draft[r.rule];
      if (!d) continue;
      if (d.inherit) { if (r.own) out[r.rule] = null; continue; }
      const params: Record<string, number | string> = {};
      for (const p of r.params) params[p.key] = p.type === 'number' ? Number(d.params[p.key]) : d.params[p.key];
      const base = r.own ?? (scopeType === 'company' ? r.effective : null);
      const same = !!base && base.enabled === d.enabled && r.params.every((p) => String(base.params[p.key]) === String(params[p.key]));
      if (!same) out[r.rule] = { enabled: d.enabled, params };
    }
    return out;
  }, [data, draft, scopeType]);
  const problem = (r: RuleRow): string | null => {
    const d = draft[r.rule];
    if (!d || d.inherit) return null;
    for (const p of r.params) {
      if (p.type !== 'number') continue;
      const n = Number(d.params[p.key]);
      if (d.params[p.key]?.trim() === '' || !Number.isInteger(n) || n < (p.min ?? -Infinity) || n > (p.max ?? Infinity)) return `${p.label}: a whole number from ${p.min} to ${p.max}`;
    }
    return null;
  };
  const invalid = (data?.rules ?? []).some((r) => problem(r));
  const count = Object.keys(changes).length;

  const save = async () => {
    setSaving(true);
    try {
      const r = await api<RulesResponse>('/alerts/rules', { method: 'PUT', json: { scopeType, scopeId, rules: changes } });
      setData(r);
      setDraft(toDraft(r.rules, scopeType));
      toast.success(`Alert rules saved (${scopeLabel})`);
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };

  if (state === 'forbidden') return null;
  const setRule = (rule: string, patch: Partial<Draft[string]>) => setDraft((d) => ({ ...d, [rule]: { ...d[rule], ...patch } }));

  return (
    <div className="space-y-4" data-testid="alert-settings">
      <Card>
        <CardHeader
          title="Alert rules"
          subtitle={<>When an alert opens for a team, for <span className="font-medium text-slate-700 dark:text-slate-200">{scopeLabel}</span>. Rules are checked after every KPI update and every hour. Team settings override department settings, which override company settings.</>}
          action={data?.canEdit ? (
            <button type="button" onClick={save} disabled={saving || !count || invalid} className={cx(buttonClass.primary, 'whitespace-nowrap')} data-testid="alert-rules-save">
              <Save size={15} aria-hidden /> {saving ? 'Saving…' : count ? `Save ${count} change${count === 1 ? '' : 's'}` : 'No changes'}
            </button>
          ) : undefined}
        />
        {state === 'loading' ? <p className="text-sm text-slate-500 dark:text-slate-400">Loading alert rules…</p>
          : state === 'error' || !data ? <p className="text-sm text-slate-500 dark:text-slate-400">The alert rules could not be loaded.</p>
          : (
            <>
              {!data.canEdit && (
                <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  {scopeType === 'company' ? 'Company alert rules are set by super admins.' : 'Alert rules of this department and its teams are set by super admins and the department’s QA managers.'} You can view them here.
                </p>
              )}
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.rules.map((r) => {
                  const d = draft[r.rule];
                  if (!d) return null;
                  const meta = SCOPE_META[r.effective.scope];
                  const err = problem(r);
                  const disabled = !data.canEdit || d.inherit;
                  return (
                    <li key={r.rule} className="py-3" data-testid={`alert-rule-${r.rule}`}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 sm:max-w-md">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-slate-900 dark:text-white">{r.label}</p>
                            <Badge tone={meta.tone}>{r.own ? 'Set here' : `From ${meta.label.toLowerCase()}`}</Badge>
                            {!r.effective.enabled && <Badge tone="neutral">Off</Badge>}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{r.description}</p>
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                          {scopeType !== 'company' && data.canEdit && (
                            <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                              <input type="checkbox" checked={d.inherit} onChange={(e) => setRule(r.rule, { inherit: e.target.checked, ...(e.target.checked ? {} : { enabled: r.effective.enabled, params: Object.fromEntries(Object.entries(r.effective.params).map(([k, v]) => [k, String(v)])) }) })} className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500 dark:border-slate-600" />
                              Inherit
                            </label>
                          )}
                          {r.params.map((p) => (
                            <label key={p.key} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                              {p.label}
                              {p.type === 'severity' ? (
                                <select value={d.params[p.key] ?? 'warning'} disabled={disabled} onChange={(e) => setRule(r.rule, { params: { ...d.params, [p.key]: e.target.value } })} className={cx(inputClass, 'mt-1 block w-32 disabled:opacity-60')}>
                                  <option value="warning">Watch level</option>
                                  <option value="critical">Off target only</option>
                                </select>
                              ) : (
                                <span className="mt-1 flex items-center gap-1.5">
                                  <input type="number" inputMode="numeric" min={p.min} max={p.max} step={1} value={d.params[p.key] ?? ''} disabled={disabled} onChange={(e) => setRule(r.rule, { params: { ...d.params, [p.key]: e.target.value } })} className={cx(inputClass, 'w-20 disabled:opacity-60', err && 'border-red-500 dark:border-red-500')} aria-label={`${r.label}: ${p.label}`} />
                                  <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{p.unit}</span>
                                </span>
                              )}
                            </label>
                          ))}
                          <div className="min-w-[4.5rem]">
                            <button
                              type="button" role="switch" aria-checked={d.enabled} aria-label={`${r.label} ${d.enabled ? 'on' : 'off'}`} disabled={disabled}
                              onClick={() => setRule(r.rule, { enabled: !d.enabled })} data-testid={`alert-rule-${r.rule}-toggle`}
                              className={cx('relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50', d.enabled ? 'bg-brand-700 dark:bg-brand-500' : 'bg-slate-300 dark:bg-slate-600')}
                            >
                              <span className={cx('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', d.enabled ? 'translate-x-4' : 'translate-x-0.5')} />
                            </button>
                            <span className="ml-2 text-xs text-slate-600 dark:text-slate-300">{d.enabled ? 'On' : 'Off'}</span>
                          </div>
                        </div>
                      </div>
                      {err && <p className="mt-1 text-xs text-red-700 dark:text-red-400" role="alert">{err}</p>}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
      </Card>
      {scopeType === 'company' && <NotificationChannels />}
    </div>
  );
};

/** Company Slack webhook, test digest and manual evaluation (super_admin; hidden for others). */
const NotificationChannels: React.FC = () => {
  const [s, setS] = useState<Settings | null>(null);
  const [smtp, setSmtp] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [url, setUrl] = useState('');
  const [form, setForm] = useState({ slackEnabled: false, slackMinSeverity: 'critical' as Severity, slackDigest: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (r: { settings: Settings; smtpConfigured: boolean }) => {
    setS(r.settings); setSmtp(r.smtpConfigured);
    setForm({ slackEnabled: r.settings.slackEnabled, slackMinSeverity: r.settings.slackMinSeverity, slackDigest: r.settings.slackDigest });
  };
  useEffect(() => {
    api<{ settings: Settings; smtpConfigured: boolean }>('/notifications/settings').then(apply).catch((e) => { if (e.status === 403) setForbidden(true); });
  }, []);
  if (forbidden || !s) return null;

  const dirty = url.trim() !== '' || form.slackEnabled !== s.slackEnabled || form.slackMinSeverity !== s.slackMinSeverity || form.slackDigest !== s.slackDigest;
  const save = async (extra: Record<string, unknown> = {}, label = 'Slack settings saved') => {
    setBusy('save'); setNote(null);
    try {
      const body: Record<string, unknown> = { ...form, ...extra };
      if (url.trim() && !('slackWebhookUrl' in extra)) body.slackWebhookUrl = url.trim();
      apply(await api('/notifications/settings', { method: 'PUT', json: body }));
      setUrl('');
      toast.success(label);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };
  const run = async (key: string, path: string) => {
    setBusy(key); setNote(null);
    try {
      const r = await api<any>(path, { method: 'POST' });
      if (key === 'evaluate') setNote({ ok: true, text: `Evaluated ${r.teams} teams: ${r.opened} opened, ${r.resolved} resolved, ${r.refreshed} still open.` });
      else setNote({ ok: !!r.delivered, text: r.message });
    } catch (e: any) { setNote({ ok: false, text: e.message }); } finally { setBusy(null); }
  };

  return (
    <Card>
      <CardHeader title="Notification channels" subtitle="Company-wide. Each person chooses in-app and email notifications on their Notifications page." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div data-testid="slack-settings">
          <p className="text-sm font-medium text-slate-900 dark:text-white">Slack</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Posts alerts to one channel through an incoming webhook. The webhook URL is stored encrypted and never shown again.</p>
          <label htmlFor="slack-webhook" className="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300">Incoming webhook URL</label>
          <input
            id="slack-webhook" type="password" autoComplete="off" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder={s.slackConfigured ? `Configured: ${s.slackHint ?? 'hidden'} (enter a new one to replace)` : 'https://hooks.slack.com/services/…'}
            className={cx(inputClass, 'mt-1 w-full')} data-testid="slack-webhook-input"
          />
          {s.slackUnreadable && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">The stored webhook cannot be read (the server’s encryption key changed). Enter it again.</p>}
          <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
            <Switch checked={form.slackEnabled} onChange={(v) => setForm({ ...form, slackEnabled: v })} label="Post alerts to Slack" testId="slack-enabled" />
            <div className="flex items-center justify-between gap-4 py-2">
              <label htmlFor="slack-min" className="text-sm font-medium text-slate-900 dark:text-white">From severity</label>
              <select id="slack-min" value={form.slackMinSeverity} onChange={(e) => setForm({ ...form, slackMinSeverity: e.target.value as Severity })} className={cx(inputClass, 'w-36')}>
                <option value="warning">Warning</option><option value="critical">Critical</option><option value="info">All (incl. info)</option>
              </select>
            </div>
            <Switch checked={form.slackDigest} onChange={(v) => setForm({ ...form, slackDigest: v })} label="Weekly summary" description="Counts of open alerts and actions, Mondays." />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => save()} disabled={!dirty || busy !== null} className={buttonClass.primary} data-testid="slack-save"><Save size={14} aria-hidden /> {busy === 'save' ? 'Saving…' : 'Save Slack settings'}</button>
            <button type="button" onClick={() => run('slack', '/notifications/settings/slack-test')} disabled={!s.slackConfigured || busy !== null} className={buttonClass.secondary}><Send size={14} aria-hidden /> Send test message</button>
            {s.slackConfigured && (
              <button type="button" onClick={() => save({ slackWebhookUrl: null, slackEnabled: false }, 'Slack webhook removed')} disabled={busy !== null} className={buttonClass.secondary}><Trash2 size={14} aria-hidden /> Remove webhook</button>
            )}
          </div>
          {s.updatedAt && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Last changed {new Date(s.updatedAt).toLocaleString()}{s.updatedBy ? ` by ${s.updatedBy}` : ''}.</p>}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">Email and the weekly digest</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {smtp ? 'Email is sent through the SMTP server configured on this server.' : 'SMTP is not configured on this server (SMTP_HOST): emails are written to the server log instead of being sent.'}
            {' '}The weekly digest goes out on Mondays at 07:00 UTC to administrators, QA managers and team leads who have it on.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => run('digest', '/notifications/digest/test')} disabled={busy !== null} className={buttonClass.secondary} data-testid="admin-send-test-digest"><Send size={14} aria-hidden /> {busy === 'digest' ? 'Sending…' : 'Send test digest to me'}</button>
            <button type="button" onClick={() => run('evaluate', '/alerts/evaluate')} disabled={busy !== null} className={buttonClass.secondary} data-testid="alerts-evaluate"><Play size={14} aria-hidden /> {busy === 'evaluate' ? 'Evaluating…' : 'Evaluate alerts now'}</button>
          </div>
          {note && <p role="status" className={cx('mt-3 text-sm', note.ok ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400')}>{note.text}</p>}
        </div>
      </div>
    </Card>
  );
};

export default AlertSettings;
