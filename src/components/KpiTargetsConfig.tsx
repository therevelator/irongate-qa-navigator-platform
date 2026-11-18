import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { API_URL } from '../config/api';
import { Badge, Card, CardHeader, buttonClass, cx, inputClass, type Tone } from './ui';

/**
 * KPI targets with history (Parameters page; GET/PUT /api/targets). A target set here applies
 * from now on: values recorded earlier keep being judged with the target that was valid at their
 * date. Team targets override department targets, which override company targets, which
 * override the defaults. Saving with empty fields removes this level's own target (the level
 * above applies again). Who may edit: company targets super admins; department and team targets
 * super admins and that department's QA managers (the API decides; read-only otherwise).
 */

interface Effective { good: number; warning: number; lowerIsBetter: boolean; scope: 'company' | 'department' | 'team' | 'default'; validFrom: string | null }
interface MetricRow {
  metric: string;
  key: string;
  label: string;
  unit: string;
  lowerIsBetter: boolean;
  effective: Effective;
  own: { good: number; warning: number; validFrom: string } | null;
  default: { good: number; warning: number };
}
interface HistoryRow { id: string; metric: string; good: number; warning: number; validFrom: string; validTo: string | null; changedBy: string | null }
interface TargetsResponse { scope: { type: string; id: string; name: string }; canEdit: boolean; metrics: MetricRow[]; history: HistoryRow[] }

const SCOPE_LABEL: Record<Effective['scope'], { label: string; tone: Tone }> = {
  team: { label: 'Team', tone: 'brand' },
  department: { label: 'Department', tone: 'brand' },
  company: { label: 'Company', tone: 'neutral' },
  default: { label: 'Default', tone: 'neutral' },
};

const unitText = (u: string) => (!u ? '' : u === '%' || u.startsWith('/') ? u : ` ${u}`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

const KpiTargetsConfig: React.FC<{
  scopeType: 'company' | 'department' | 'team'; scopeId: string | null; scopeLabel: string;
  /** Company scope: saving also ends every department and team target, so the company targets apply everywhere. */
  applyToAll?: boolean;
}> = ({ scopeType, scopeId, scopeLabel, applyToAll = false }) => {
  const [data, setData] = useState<TargetsResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState<Record<string, { good: string; warning: string }>>({});
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const p = new URLSearchParams({ scopeType });
      if (scopeId) p.set('scopeId', scopeId);
      const res = await fetch(`${API_URL}/targets?${p}`, { credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      const json: TargetsResponse = await res.json();
      setData(json);
      setDraft(Object.fromEntries(json.metrics.map((m) => [m.metric, { good: m.own ? String(m.own.good) : '', warning: m.own ? String(m.own.warning) : '' }])));
      setState('ready');
    } catch {
      setState('error');
    }
  }, [scopeType, scopeId]);

  useEffect(() => { load(); }, [load]);

  /** Metrics whose draft differs from the stored own target: { metric: {good, warning} | null }. */
  const changes = useMemo(() => {
    const out: Record<string, { good: number; warning: number } | null> = {};
    for (const m of data?.metrics ?? []) {
      const d = draft[m.metric];
      if (!d) continue;
      const empty = d.good.trim() === '' && d.warning.trim() === '';
      if (empty) { if (m.own) out[m.metric] = null; continue; }
      const good = Number(d.good), warning = Number(d.warning);
      if (!m.own || m.own.good !== good || m.own.warning !== warning) out[m.metric] = { good, warning };
    }
    return out;
  }, [data, draft]);
  const changeCount = Object.keys(changes).length;

  /** Client-side check (the API validates again): both numbers, warning on the right side. */
  const problem = (m: MetricRow): string | null => {
    const d = draft[m.metric];
    if (!d || (d.good.trim() === '' && d.warning.trim() === '')) return null;
    if (d.good.trim() === '' || d.warning.trim() === '') return 'Enter both values, or clear both to inherit';
    const good = Number(d.good), warning = Number(d.warning);
    if (!Number.isFinite(good) || !Number.isFinite(warning)) return 'Numbers only';
    if (m.lowerIsBetter ? warning < good : warning > good) return `Watch level must be ${m.lowerIsBetter ? 'at or above' : 'at or below'} the target`;
    return null;
  };
  const invalid = (data?.metrics ?? []).some((m) => problem(m));

  const applyAll = applyToAll && scopeType === 'company';
  const save = async () => {
    if ((!changeCount && !applyAll) || invalid) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/targets`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopeType, scopeId, targets: changes, ...(applyAll ? { applyToAll: true } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.details?.join('; ') || body?.error || 'Failed to save the KPI targets');
      toast.success(applyAll
        ? `KPI targets saved and applied to every department and team${body?.replaced ? ` (${body.replaced} department/team target${body.replaced === 1 ? '' : 's'} replaced)` : ''}. Earlier values keep their old targets.`
        : `KPI targets saved (${scopeLabel}). Earlier values keep their old targets.`);
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save the KPI targets');
    } finally {
      setSaving(false);
    }
  };

  const labelOf = (metric: string) => data?.metrics.find((m) => m.metric === metric)?.label ?? metric;

  return (
    <div data-testid="kpi-targets">
    <Card>
      <CardHeader
        title="KPI targets"
        subtitle={<>Target (good) and watch levels per metric for <span className="font-medium text-slate-700 dark:text-slate-200">{scopeLabel}</span>. A change applies from now on; values recorded earlier are still judged with the target valid at their date. Empty fields inherit from the level above.</>}
        action={data?.canEdit ? (
          <button type="button" className={cx(buttonClass.primary, "whitespace-nowrap")} onClick={save} disabled={saving || (!changeCount && !applyAll) || invalid || !data?.canEdit} data-testid="kpi-targets-save">
            <Save size={15} aria-hidden /> {saving ? 'Saving…'
              : applyAll ? (changeCount ? `Save ${changeCount} change${changeCount === 1 ? '' : 's'} for all departments` : 'Save for all departments')
              : changeCount ? `Save ${changeCount} change${changeCount === 1 ? '' : 's'}` : 'No changes'}
          </button>
        ) : undefined}
      />
      {state === 'loading' ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading targets…</p>
      ) : state === 'error' || !data ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">The KPI targets could not be loaded.</p>
      ) : (
        <>
          {!data.canEdit && (
            <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              {scopeType === 'company' ? 'Company-wide targets are set by super admins.' : 'Targets of this department and its teams are set by super admins and the department’s QA managers.'} You can view them here.
            </p>
          )}
          <div className="-mx-5 overflow-x-auto sm:mx-0">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th className="px-5 py-2 font-medium sm:pl-0">Metric</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">In force now</th>
                  <th className="px-2 py-2 font-medium sm:px-3">Target<span className="hidden sm:inline"> at this level</span></th>
                  <th className="px-2 py-2 font-medium sm:px-3">Watch<span className="hidden sm:inline"> level</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.metrics.map((m) => {
                  const d = draft[m.metric] ?? { good: '', warning: '' };
                  const err = problem(m);
                  const dir = m.lowerIsBetter ? '≤' : '≥';
                  const meta = SCOPE_LABEL[m.effective.scope];
                  return (
                    <tr key={m.metric} className="align-top" data-testid={`kpi-target-${m.metric}`}>
                      <td className="px-5 py-2.5 sm:pl-0">
                        <p className="font-medium text-slate-900 dark:text-white">{m.label}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{m.lowerIsBetter ? 'Lower is better' : 'Higher is better'}{m.unit ? ` · ${m.unit.trim()}` : ''}</p>
                        <p className="mt-1 text-xs text-slate-600 sm:hidden dark:text-slate-300">Now {dir} {m.effective.good}{unitText(m.unit)} · {SCOPE_LABEL[m.effective.scope].label.toLowerCase()}</p>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 sm:table-cell">
                        <p className="tabular-nums text-slate-800 dark:text-slate-200">{dir} {m.effective.good}{unitText(m.unit)} <span className="text-xs text-slate-500 dark:text-slate-400">· watch {dir} {m.effective.warning}</span></p>
                        <p className="mt-0.5"><Badge tone={meta.tone}>{meta.label}</Badge>{m.effective.validFrom && <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">since {when(m.effective.validFrom)}</span>}</p>
                      </td>
                      <td className="px-2 py-2.5 sm:px-3">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          aria-label={`${m.label} target at this level`}
                          placeholder="Inherit"
                          value={d.good}
                          disabled={!data.canEdit}
                          onChange={(e) => setDraft((x) => ({ ...x, [m.metric]: { ...d, good: e.target.value } }))}
                          className={cx(inputClass, 'w-20 disabled:opacity-60 sm:w-28', err && 'border-red-500 dark:border-red-500')}
                        />
                      </td>
                      <td className="px-2 py-2.5 sm:px-3">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          aria-label={`${m.label} watch level at this level`}
                          placeholder="Inherit"
                          value={d.warning}
                          disabled={!data.canEdit}
                          onChange={(e) => setDraft((x) => ({ ...x, [m.metric]: { ...d, warning: e.target.value } }))}
                          className={cx(inputClass, 'w-20 disabled:opacity-60 sm:w-28', err && 'border-red-500 dark:border-red-500')}
                        />
                        {err && <p className="mt-1 text-xs text-red-700 dark:text-red-400" role="alert">{err}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
            >
              <History size={15} aria-hidden /> Target history at this level ({data.history.length})
            </button>
            {showHistory && (
              data.history.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No target has been set at this level; the level above applies.</p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-sm" data-testid="kpi-target-history">
                  {data.history.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-baseline gap-x-2 text-slate-700 dark:text-slate-300">
                      <span className="font-medium text-slate-900 dark:text-white">{labelOf(h.metric)}</span>
                      <span className="tabular-nums">target {h.good} · watch {h.warning}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {when(h.validFrom)} – {h.validTo ? when(h.validTo) : 'now'}{h.changedBy ? ` · set by ${h.changedBy}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </>
      )}
    </Card>
    </div>
  );
};

export default KpiTargetsConfig;
