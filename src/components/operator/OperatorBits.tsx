import React, { useState } from 'react';
import toast from 'react-hot-toast';
import Modal from '../Modal';
import { Badge, buttonClass, cx, inputClass } from '../ui';
import { opFetch } from '../../lib/operatorClient';

/** Small building blocks of the platform operator panel. */

export interface Column<T> { key: string; label: string; render?: (row: T) => React.ReactNode; className?: string }

/** A compact table; scrolls inside its card on narrow screens (the page itself never scrolls sideways). */
export function DataTable<T extends Record<string, any>>({ rows, columns, empty = 'Nothing here.', testId, rowKey }: {
  rows: T[]; columns: Column<T>[]; empty?: string; testId?: string; rowKey?: (r: T, i: number) => string;
}) {
  if (!rows.length) return <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">{empty}</p>;
  return (
    <div className="max-w-full overflow-x-auto" data-testid={testId}>
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950/40 dark:text-slate-400">
          <tr>{columns.map((c) => <th key={c.key} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : (r.id ?? i)} className="align-top text-slate-800 dark:text-slate-200">
              {columns.map((c) => (
                <td key={c.key} className={cx('px-3 py-2', c.className)}>{c.render ? c.render(r) : r[c.key] == null || r[c.key] === '' ? '—' : String(r[c.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Section: React.FC<{ title: string; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }> = ({ title, subtitle, action, children }) => (
  <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
    <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
    {children}
  </section>
);

export const OkBadge: React.FC<{ ok: boolean | null | undefined; yes?: string; no?: string }> = ({ ok, yes = 'OK', no = 'Failed' }) =>
  ok == null ? <Badge>Running</Badge> : ok ? <Badge tone="good">{yes}</Badge> : <Badge tone="bad">{no}</Badge>;

export const ErrorText: React.FC<{ error: string | null }> = ({ error }) =>
  error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null;

export interface RepairAction {
  title: string;
  description: string;
  path: string;
  body?: Record<string, unknown>;
  confirmLabel?: string;
}

/** Confirm + reason dialog for a repair action (POST with { reason, confirm: true }). */
export const ActionDialog: React.FC<{ action: RepairAction | null; onClose: () => void; onDone?: (result: any) => void }> = ({ action, onClose, onDone }) => {
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setReason(''); setSure(false); setError(null); onClose(); };
  const run = async () => {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      const out = await opFetch(action.path, { method: 'POST', body: { ...(action.body ?? {}), reason: reason.trim(), confirm: true } });
      toast.success(`${action.title}: done`);
      onDone?.(out);
      close();
    } catch (e: any) {
      setError(`${e.message}${e.requestId ? ` (request id ${e.requestId})` : ''}`);
    } finally {
      setBusy(false);
    }
  };
  const valid = reason.trim().length >= 3 && sure;
  return (
    <Modal isOpen={!!action} onClose={close} title={action?.title ?? ''} size="sm">
      {action && (
        <div className="space-y-4">
          <p className="text-sm text-slate-700 dark:text-slate-200">{action.description}</p>
          <div>
            <label htmlFor="op-reason" className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Reason (shown in the company's Activity log)</label>
            <textarea id="op-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3}
              className={cx(inputClass, 'h-auto w-full py-2')} data-testid="op-action-reason" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600" data-testid="op-action-confirm-check" />
            I want to do this now
          </label>
          <ErrorText error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={buttonClass.secondary} onClick={close}>Cancel</button>
            <button type="button" className={buttonClass.primary} disabled={!valid || busy} onClick={run} data-testid="op-action-run">
              {busy ? 'Working…' : action.confirmLabel ?? 'Run'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};
