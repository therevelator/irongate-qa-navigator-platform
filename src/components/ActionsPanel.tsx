import React, { useCallback, useEffect, useId, useState } from 'react';
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import { Badge, Card, EmptyState, buttonClass, cx, inputClass, type Tone } from './ui';
import { api, shortDate } from './NotificationParts';
import Pagination from './Pagination';
import { useAuth } from '../contexts/AuthContext';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES as PAGE_SIZE_OPTIONS, paginate } from '../lib/pagination';
import { actionPlanViewKey, groupByStatus, parseActionPlanView, type ActionPlanViewState } from '../lib/actionPlanView';
import { MovementLine, type Movement } from './Improve';

/**
 * Team detail → "Action plan": the team's tracked actions (GET /api/actions?teamId=), with owner,
 * due date, status, the linked KPI with its baseline and current value, and the outcome computed
 * by the server at completion and 14 / 30 days later. Leads, the department's QA managers and
 * administrators create and edit actions; an action's owner can change its status.
 *
 * The list is grouped by status (Open, In progress, Done, Dropped), each group an accordion with
 * its count, paged per group (5 / 10 / 20 per page). Open and In progress start expanded, Done and
 * Dropped collapsed; the whole section can be collapsed too. The expanded state is remembered per
 * person in this browser (src/lib/actionPlanView.ts).
 */

export interface ActionDraft { title: string; description?: string; metricKey?: string | null; /** Recommendation KPI text, mapped to a metric. */ kpi?: string; origin?: 'recommendation' | 'alert' | 'manual'; alertId?: string | null }

type Status = 'open' | 'in_progress' | 'done' | 'dropped';
type Outcome = 'improved' | 'unchanged' | 'worse' | 'no_data' | 'pending';
interface MetricOption { key: string; label: string; unit: string; lowerIsBetter: boolean }
export interface TrackedAction {
  id: string; title: string; description: string | null; origin: string; owner: { id: string; name: string } | null; dueDate: string | null; overdue: boolean;
  status: Status; metric: MetricOption | null; baseline: { value: number; at: string | null } | null; current: { value: number; at: string } | null;
  createdBy: string | null; createdAt: string; completedAt: string | null; canUpdateStatus: boolean; canEdit: boolean;
  recommendation?: { id: string; title: string } | null; movement?: Movement | null;
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

const ActionsPanel: React.FC<{
  teamId: string; teamName: string; draft?: ActionDraft | null; onDraftUsed?: () => void;
  /** Changing it reloads the list (e.g. after a recommendation became an action). */
  reloadKey?: number;
  /** After a status change or a delete (the Recommendations section shows the action's status). */
  onChanged?: () => void;
}> = ({ teamId, teamName, draft, onDraftUsed, reloadKey, onChanged }) => {
  const [data, setData] = useState<ActionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ action: TrackedAction | null; draft: ActionDraft | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { user } = useAuth();
  const viewKey = actionPlanViewKey(user?.id);
  const [view, setView] = useState<ActionPlanViewState>(() => readView(viewKey));
  useEffect(() => { setView(readView(viewKey)); }, [viewKey]);
  const updateView = (next: ActionPlanViewState) => {
    setView(next);
    try { localStorage.setItem(viewKey, JSON.stringify(next)); } catch { /* storage unavailable: kept for this page only */ }
  };
  const [pages, setPages] = useState<Record<Status, { page: number; size: number }>>({
    open: { page: 1, size: DEFAULT_PAGE_SIZE }, in_progress: { page: 1, size: DEFAULT_PAGE_SIZE }, done: { page: 1, size: DEFAULT_PAGE_SIZE }, dropped: { page: 1, size: DEFAULT_PAGE_SIZE },
  });
  const sectionId = useId();

  const load = useCallback(async () => {
    try { setData(await api<ActionsResponse>(`/actions?teamId=${encodeURIComponent(teamId)}`)); setError(null); }
    catch (e: any) { setError(e.status === 403 ? null : e.message); if (e.status === 403) setData(null); }
  }, [teamId]);
  useEffect(() => { load(); }, [load, reloadKey]);

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
      if (a.recommendation) onChanged?.();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };
  const remove = async (a: TrackedAction) => {
    if (!window.confirm(`Delete the action "${a.title}"? This cannot be undone.`)) return;
    setBusy(a.id);
    try { await api(`/actions/${a.id}`, { method: 'DELETE' }); toast.success('Action deleted'); await load(); if (a.recommendation) onChanged?.(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  if (!data && !error) return null;
  const actions = data?.actions ?? [];
  const groups = groupByStatus(actions);

  const renderItem = (a: TrackedAction) => (
    <li key={a.id} className="py-3" data-testid="action-item">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-slate-900 dark:text-white">{a.title}</p>
            <Badge tone={STATUS_META[a.status].tone}>{STATUS_META[a.status].label}</Badge>
            {a.overdue && <Badge tone="bad">Overdue</Badge>}
            {a.origin === 'recommendation' && <span className="text-xs text-slate-500 dark:text-slate-400" data-testid="action-from-recommendation">{a.recommendation ? 'from the recommendation above' : 'from a recommendation'}</span>}
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
          {a.movement && <MovementLine m={a.movement} testId="action-movement" />}
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
              {(Object.keys(STATUS_META) as Status[]).map((st) => <option key={st} value={st}>{STATUS_META[st].label}</option>)}
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
  );

  return (
    <Card>
      <div data-testid="action-plan">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              <button
                type="button"
                className="-ml-1 inline-flex items-center gap-1.5 rounded px-1 text-left hover:text-slate-700 dark:hover:text-slate-200"
                aria-expanded={view.section}
                aria-controls={`${sectionId}-body`}
                onClick={() => updateView({ ...view, section: !view.section })}
                data-testid="action-plan-toggle"
              >
                <ChevronDown size={16} aria-hidden className={cx('flex-shrink-0 transition-transform motion-reduce:transition-none', !view.section && '-rotate-90')} />
                Action plan
                {actions.length > 0 && <span className="font-normal text-slate-500 dark:text-slate-400">({actions.length})</span>}
              </button>
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Tracked actions of this team. Baselines and outcomes are computed from the stored metric values, not entered.</p>
          </div>
          {data?.canManage && (
            <button type="button" onClick={() => setEditing({ action: null, draft: null })} className={cx(buttonClass.primary, 'whitespace-nowrap')} data-testid="action-new"><Plus size={15} aria-hidden /> New action</button>
          )}
        </div>
        <div id={`${sectionId}-body`} hidden={!view.section} data-testid="action-plan-body">
          {error ? <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            : actions.length === 0 ? (
              <EmptyState title="No actions yet" description={data?.canManage ? 'Create one, or use “Add to Action plan” on a recommendation above.' : 'Actions created by the team lead or a manager appear here.'} />
            ) : (
              <div className="space-y-2" data-testid="action-list">
                {groups.map(({ status, items }) => {
                  const expanded = view.groups[status];
                  const pg = pages[status];
                  const slice = paginate(items, pg.page, pg.size);
                  const bodyId = `${sectionId}-${status}`;
                  const label = STATUS_META[status].label;
                  return (
                    <section key={status} className="rounded-md border border-slate-200 dark:border-slate-800" data-testid={`action-group-${status}`} data-count={items.length}>
                      <h4 className="text-sm">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800/60"
                          aria-expanded={expanded}
                          aria-controls={bodyId}
                          onClick={() => updateView({ ...view, groups: { ...view.groups, [status]: !expanded } })}
                          data-testid={`action-group-toggle-${status}`}
                        >
                          <ChevronDown size={15} aria-hidden className={cx('flex-shrink-0 text-slate-500 transition-transform motion-reduce:transition-none dark:text-slate-400', !expanded && '-rotate-90')} />
                          <span>{label} ({items.length})</span>
                        </button>
                      </h4>
                      <div id={bodyId} hidden={!expanded} className="border-t border-slate-100 px-3 dark:border-slate-800">
                        {items.length === 0 ? (
                          <p className="py-3 text-xs text-slate-500 dark:text-slate-400">No {label.toLowerCase()} actions.</p>
                        ) : (
                          <>
                            <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid={`action-group-list-${status}`}>
                              {slice.items.map(renderItem)}
                            </ul>
                            {items.length > Math.min(...PAGE_SIZE_OPTIONS) && (
                              <Pagination
                                slice={slice}
                                pageSize={pg.size}
                                onPage={(page) => setPages((p) => ({ ...p, [status]: { ...p[status], page } }))}
                                onPageSize={(size) => setPages((p) => ({ ...p, [status]: { page: 1, size } }))}
                                label={`${label} actions`}
                                testId={`action-pager-${status}`}
                                className="border-t border-slate-100 py-2.5 dark:border-slate-800"
                              />
                            )}
                          </>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          {data?.outcomeRule && (
            <p className="mt-3 max-w-3xl border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">{data.outcomeRule}</p>
          )}
        </div>
      </div>
      {editing && data && (
        <ActionDialog teamId={teamId} teamName={teamName} metrics={data.metrics} action={editing.action} draft={editing.draft} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </Card>
  );
};

function readView(key: string): ActionPlanViewState {
  try { return parseActionPlanView(localStorage.getItem(key)); } catch { return parseActionPlanView(null); }
}

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
