import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import { Badge, Card, CardHeader, EmptyState, buttonClass, cx, inputClass, type Tone } from './ui';
import { api, shortDate } from './NotificationParts';

/**
 * Team detail → "Action plan": the team's tracked actions (GET /api/actions?teamId=), with owner,
 * due date, status, the linked KPI with its baseline and current value, and the outcome computed
 * by the server at completion and 14 / 30 days later. Leads, the department's QA managers and
 * administrators create and edit actions; an action's owner can change its status.
 */

export interface ActionDraft { title: string; description?: string; metricKey?: string | null; /** Recommendation KPI text, mapped to a metric. */ kpi?: string; origin?: 'recommendation' | 'alert' | 'manual'; alertId?: string | null }

type Status = 'open' | 'in_progress' | 'done' | 'dropped';
type Outcome = 'improved' | 'unchanged' | 'worse' | 'no_data' | 'pending';
interface MetricOption { key: string; label: string; unit: string; lowerIsBetter: boolean }
export interface TrackedAction {
  id: string; title: string; description: string | null; origin: string; owner: { id: string; name: string } | null; dueDate: string | null; overdue: boolean;
  status: Status; metric: MetricOption | null; baseline: { value: number; at: string | null } | null; current: { value: number; at: string } | null;
  createdBy: string | null; createdAt: string; completedAt: string | null; canUpdateStatus: boolean; canEdit: boolean;
  outcomes: Array<{ checkpoint: 'completion' | 'd14' | 'd30'; label: string; dueAt: string | null; value: number | null; valueAt: string | null; outcome: Outcome }>;
}
interface ActionsResponse { canManage: boolean; actions: TrackedAction[]; metrics: MetricOption[]; outcomeRule: string }

export const STATUS_META: Record<Status, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'brand' },
  done: { label: 'Done', tone: 'good' },
  dropped: { label: 'Dropped', tone: 'neutral' },
};
export const OUTCOME_META: Record<Outcome, { label: string; tone: Tone }> = {
  improved: { label: 'Improved', tone: 'good' },
  unchanged: { label: 'Unchanged', tone: 'neutral' },
  worse: { label: 'Worse', tone: 'bad' },
  no_data: { label: 'No new data', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'neutral' },
};

const unitText = (u: string) => (!u ? '' : u === '%' || u.startsWith('/') ? u : ` ${u}`);
export const fmtValue = (v: number | null | undefined, m: MetricOption | null) => (v === null || v === undefined ? '—' : `${Math.abs(v) >= 100 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100}${m ? unitText(m.unit) : ''}`);

/** Recommendation KPI text ("Test coverage (currently 61.0%)", "MTTR") → metric key. */
const KPI_ALIASES: Record<string, string> = { mttr: 'mttr_hours', 'lead time': 'lead_time_days', 'average build time': 'avg_build_time_minutes', 'build time': 'avg_build_time_minutes', 'test flakiness': 'test_flakiness_rate' };
export function metricKeyFromKpi(kpi: string | undefined | null, metrics: MetricOption[]): string | null {
  if (!kpi) return null;
  const name = kpi.replace(/\s*\(.*$/, '').trim().toLowerCase();
  const direct = metrics.find((m) => m.label.toLowerCase() === name);
  if (direct) return direct.key;
  if (KPI_ALIASES[name] && metrics.some((m) => m.key === KPI_ALIASES[name])) return KPI_ALIASES[name];
  return metrics.find((m) => m.label.toLowerCase().startsWith(name) || name.startsWith(m.label.toLowerCase()))?.key ?? null;
}

const ActionsPanel: React.FC<{ teamId: string; teamName: string; draft?: ActionDraft | null; onDraftUsed?: () => void }> = ({ teamId, teamName, draft, onDraftUsed }) => {
  const [data, setData] = useState<ActionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ action: TrackedAction | null; draft: ActionDraft | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api<ActionsResponse>(`/actions?teamId=${encodeURIComponent(teamId)}`)); setError(null); }
    catch (e: any) { setError(e.status === 403 ? null : e.message); if (e.status === 403) setData(null); }
  }, [teamId]);
  useEffect(() => { load(); }, [load]);

  // "Create action" on a recommendation opens the form pre-filled.
  useEffect(() => {
    if (draft && data?.canManage) {
      setEditing({ action: null, draft: { ...draft, metricKey: draft.metricKey ?? metricKeyFromKpi(draft.kpi, data.metrics) } });
      onDraftUsed?.();
    }
  }, [draft, data?.canManage, data?.metrics, onDraftUsed]);

  const setStatus = async (a: TrackedAction, status: Status) => {
    setBusy(a.id);
    try {
      await api(`/actions/${a.id}`, { method: 'PATCH', json: { status } });
      toast.success(status === 'done' ? 'Marked done; the outcome is computed from the stored values' : `Status: ${STATUS_META[status].label}`);
      await load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };
  const remove = async (a: TrackedAction) => {
    if (!window.confirm(`Delete the action "${a.title}"? This cannot be undone.`)) return;
    setBusy(a.id);
    try { await api(`/actions/${a.id}`, { method: 'DELETE' }); toast.success('Action deleted'); await load(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  if (!data && !error) return null;
  const actions = data?.actions ?? [];
  const active = actions.filter((a) => a.status === 'open' || a.status === 'in_progress' || a.status === 'done');
  const closed = actions.filter((a) => a.status === 'dropped');
  const list = showClosed ? actions : active;

  return (
    <Card>
      <div data-testid="action-plan">
        <CardHeader
          title="Action plan"
          subtitle="Tracked actions of this team. Baselines and outcomes are computed from the stored metric values, not entered."
          action={data?.canManage ? (
            <button type="button" onClick={() => setEditing({ action: null, draft: null })} className={cx(buttonClass.primary, 'whitespace-nowrap')} data-testid="action-new"><Plus size={15} aria-hidden /> New action</button>
          ) : undefined}
        />
        {error ? <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          : list.length === 0 ? (
            <EmptyState title="No actions yet" description={data?.canManage ? 'Create one, or use “Create action” on a recommendation below.' : 'Actions created by the team lead or QA manager appear here.'} />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="action-list">
              {list.map((a) => (
                <li key={a.id} className="py-3" data-testid="action-item">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{a.title}</p>
                        <Badge tone={STATUS_META[a.status].tone}>{STATUS_META[a.status].label}</Badge>
                        {a.overdue && <Badge tone="bad">Overdue</Badge>}
                        {a.origin === 'recommendation' && <span className="text-xs text-slate-500 dark:text-slate-400">from a recommendation</span>}
                        {a.origin === 'alert' && <span className="text-xs text-slate-500 dark:text-slate-400">from an alert</span>}
                      </div>
                      {a.description && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{a.description}</p>}
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Owner: {a.owner?.name ?? 'unassigned'} · Due {a.dueDate ? shortDate(a.dueDate) : '—'}
                        {a.completedAt ? ` · done ${shortDate(a.completedAt)}` : ''}
                      </p>
                      {a.metric && (
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300" data-testid="action-metric">
                          <span className="font-medium">{a.metric.label}</span> ({a.metric.lowerIsBetter ? 'lower is better' : 'higher is better'}): baseline {fmtValue(a.baseline?.value, a.metric)}
                          {a.baseline?.at ? ` (${shortDate(a.baseline.at)})` : a.baseline ? '' : ' (no value recorded when created)'}
                          {' → '}now {fmtValue(a.current?.value, a.metric)}{a.current ? ` (${shortDate(a.current.at)})` : ''}
                        </p>
                      )}
                      {a.outcomes.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2" data-testid="action-outcomes">
                          {a.outcomes.map((o) => (
                            <span key={o.checkpoint} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
                              {o.label}: <Badge tone={OUTCOME_META[o.outcome].tone}>{OUTCOME_META[o.outcome].label}</Badge>
                              {o.value !== null ? <span className="tabular-nums">{fmtValue(o.value, a.metric)}</span> : o.outcome === 'pending' && o.dueAt ? <span>on {shortDate(o.dueAt)}</span> : null}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {a.canUpdateStatus && (
                        <label className="sr-only" htmlFor={`status-${a.id}`}>Status of {a.title}</label>
                      )}
                      {a.canUpdateStatus && (
                        <select id={`status-${a.id}`} value={a.status} disabled={busy === a.id} onChange={(e) => setStatus(a, e.target.value as Status)} className={cx(inputClass, 'w-36')} data-testid="action-status">
                          {(Object.keys(STATUS_META) as Status[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                        </select>
                      )}
                      {a.canEdit && (
                        <>
                          <button type="button" onClick={() => setEditing({ action: a, draft: null })} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" aria-label={`Edit ${a.title}`} title="Edit"><Pencil size={15} aria-hidden /></button>
                          <button type="button" onClick={() => remove(a)} disabled={busy === a.id} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-700 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300" aria-label={`Delete ${a.title}`} title="Delete"><Trash2 size={15} aria-hidden /></button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-3xl">{data?.outcomeRule}</p>
          {closed.length > 0 && (
            <button type="button" onClick={() => setShowClosed((v) => !v)} className="shrink-0 font-medium text-brand-700 hover:underline dark:text-brand-300">
              {showClosed ? 'Hide dropped actions' : `Show ${closed.length} dropped`}
            </button>
          )}
        </div>
      </div>
      {editing && data && (
        <ActionDialog teamId={teamId} teamName={teamName} metrics={data.metrics} action={editing.action} draft={editing.draft} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </Card>
  );
};

const ActionDialog: React.FC<{ teamId: string; teamName: string; metrics: MetricOption[]; action: TrackedAction | null; draft: ActionDraft | null; onClose: () => void; onSaved: () => void }> = ({ teamId, teamName, metrics, action, draft, onClose, onSaved }) => {
  const [owners, setOwners] = useState<Array<{ id: string; name: string; email: string }> | null>(null);
  const [form, setForm] = useState({
    title: action?.title ?? draft?.title ?? '',
    description: action?.description ?? draft?.description ?? '',
    ownerId: action?.owner?.id ?? '',
    dueDate: action?.dueDate ?? '',
    metricKey: action?.metric?.key ?? draft?.metricKey ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ owners: Array<{ id: string; name: string; email: string }> }>(`/actions/owners?teamId=${encodeURIComponent(teamId)}`).then((r) => setOwners(r.owners)).catch(() => setOwners([]));
  }, [teamId]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const body = { title: form.title, description: form.description || null, ownerId: form.ownerId || null, dueDate: form.dueDate || null, metricKey: form.metricKey || null };
      if (action) await api(`/actions/${action.id}`, { method: 'PATCH', json: body });
      else await api('/actions', { method: 'POST', json: { ...body, teamId, origin: draft?.origin ?? 'manual', alertId: draft?.alertId ?? null } });
      toast.success(action ? 'Action updated' : 'Action created');
      onSaved();
    } catch (err: any) { setError(err.message); } finally { setSaving(false); }
  };
  const metric = metrics.find((m) => m.key === form.metricKey) ?? null;
  return (
    <Modal isOpen onClose={onClose} title={action ? 'Edit action' : 'New action'} subtitle={teamName} size="prose">
      <form onSubmit={submit} className="space-y-4" data-testid="action-form">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Title
          <input data-autofocus required minLength={3} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={cx(inputClass, 'mt-1 w-full')} data-testid="action-title" />
        </label>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Description <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
          <textarea maxLength={2000} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={cx(inputClass, 'mt-1 h-auto w-full py-2')} />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Owner
            <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })} className={cx(inputClass, 'mt-1 w-full')} data-testid="action-owner">
              <option value="">Unassigned</option>
              {(owners ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">People who have this team in their scope.</span>
          </label>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Due date
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={cx(inputClass, 'mt-1 w-full')} data-testid="action-due" />
          </label>
        </div>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Linked KPI
          <select value={form.metricKey} onChange={(e) => setForm({ ...form, metricKey: e.target.value })} className={cx(inputClass, 'mt-1 w-full')} data-testid="action-metric-select">
            <option value="">None (no outcome is measured)</option>
            {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">
            {metric ? `The baseline is the latest stored ${metric.label.toLowerCase()} value when the action is saved; the outcome compares later values with it (${metric.lowerIsBetter ? 'lower' : 'higher'} is better).` : 'Link a KPI to measure whether the action worked.'}
          </span>
        </label>
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          <button type="button" onClick={onClose} className={buttonClass.secondary}>Cancel</button>
          <button type="submit" disabled={saving} className={buttonClass.primary} data-testid="action-save">{saving ? 'Saving…' : action ? 'Save changes' : 'Create action'}</button>
        </div>
      </form>
    </Modal>
  );
};

export default ActionsPanel;
