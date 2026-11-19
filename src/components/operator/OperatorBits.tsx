import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import Modal from '../Modal';
import { Badge, buttonClass, cx, inputClass } from '../ui';
import { opFetch } from '../../lib/operatorClient';

/** Small building blocks of the platform operator panel. */

export interface Column<T> { key: string; label: string; render?: (row: T) => React.ReactNode; className?: string }

/** A compact table; scrolls inside its card on narrow screens (the page itself never scrolls sideways). */
export function DataTable<T extends Record<string, any>>({ rows, columns, empty = 'Nothing here.', testId, rowKey, rowTestId }: {
  rows: T[]; columns: Column<T>[]; empty?: string; testId?: string; rowKey?: (r: T, i: number) => string; rowTestId?: (r: T) => string;
}) {
  if (!rows.length) return <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400" data-testid={testId ? `${testId}-empty` : undefined}>{empty}</p>;
  return (
    <div className="max-w-full overflow-x-auto" data-testid={testId}>
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950/40 dark:text-slate-400">
          <tr>{columns.map((c) => <th key={c.key} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : (r.id ?? i)} className="align-top text-slate-800 dark:text-slate-200" data-testid={rowTestId?.(r)}>
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

export const Section: React.FC<{ title: string; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; testId?: string }> = ({ title, subtitle, action, children, testId }) => (
  <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" data-testid={testId}>
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

export const SmallButton: React.FC<{ onClick: () => void; children: React.ReactNode; testId?: string; danger?: boolean; disabled?: boolean; title?: string }> = ({ onClick, children, testId, danger, disabled, title }) => (
  <button type="button" onClick={onClick} disabled={disabled} title={title}
    className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs', danger && 'text-red-700 dark:text-red-300')} data-testid={testId}>{children}</button>
);

/* ------------------------------------------------------------------------------------------
 * Actions: a request to the operator API. Destructive ones are confirmed in the page first
 * (a checkbox, or the typed name for a delete); the others run at once.
 * ---------------------------------------------------------------------------------------- */

export interface OpAction {
  title: string;
  description: string;
  path: string;
  method?: 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, unknown>;
  /** Asks for confirmation in the page and sends { confirm: true }. */
  destructive?: boolean;
  /** The text to type to confirm (a delete), sent as `typedField`. */
  typeToConfirm?: string;
  typedField?: string;
  confirmLabel?: string;
  /** Toast after success (default "<title>: done"). */
  doneMessage?: (result: any) => string;
}

export async function runAction(action: OpAction, typed?: string): Promise<any> {
  const body: Record<string, unknown> = { ...(action.body ?? {}) };
  if (action.destructive) body.confirm = true;
  if (action.typeToConfirm && action.typedField) body[action.typedField] = typed ?? '';
  const out = await opFetch(action.path, { method: action.method ?? 'POST', body });
  toast.success(action.doneMessage?.(out) ?? `${action.title}: done`);
  return out;
}

/** The in-page confirmation of a destructive action. */
export const ConfirmDialog: React.FC<{ action: OpAction | null; onClose: () => void; onDone?: (result: any) => void }> = ({ action, onClose, onDone }) => {
  const [sure, setSure] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setSure(false); setTyped(''); setError(null); }, [action]);
  const run = async () => {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      const out = await runAction(action, typed.trim());
      onDone?.(out);
      onClose();
    } catch (e: any) {
      setError(`${e.message}${e.requestId ? ` (request id ${e.requestId})` : ''}`);
    } finally {
      setBusy(false);
    }
  };
  const valid = action?.typeToConfirm ? typed.trim() === action.typeToConfirm : sure;
  return (
    <Modal isOpen={!!action} onClose={onClose} title={action?.title ?? ''} size="sm">
      {action && (
        <div className="space-y-4" data-testid="op-confirm-dialog">
          <p className="text-sm text-slate-700 dark:text-slate-200">{action.description}</p>
          {action.typeToConfirm ? (
            <div>
              <label htmlFor="op-typed" className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Type <strong>{action.typeToConfirm}</strong> to confirm</label>
              <input id="op-typed" value={typed} onChange={(e) => setTyped(e.target.value)} className={cx(inputClass, 'w-full')} data-testid="op-confirm-typed" autoComplete="off" />
            </div>
          ) : (
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600" data-testid="op-confirm-check" />
              I want to do this now
            </label>
          )}
          <ErrorText error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
            <button type="button" className={cx(buttonClass.primary, action.typeToConfirm && 'bg-red-600 hover:bg-red-700')} disabled={!valid || busy} onClick={run} data-testid="op-confirm-run">
              {busy ? 'Working…' : action.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};

/** Run an action: destructive ones open the confirmation, the others run at once. */
export function useOpActions(onDone?: (result: any) => void) {
  const [pending, setPending] = useState<OpAction | null>(null);
  const run = async (a: OpAction) => {
    if (a.destructive) { setPending(a); return; }
    try {
      const out = await runAction(a);
      onDone?.(out);
    } catch (e: any) {
      toast.error(`${e.message}${e.requestId ? ` (request id ${e.requestId})` : ''}`);
    }
  };
  const dialog = <ConfirmDialog action={pending} onClose={() => setPending(null)} onDone={onDone} />;
  return { run, dialog };
}

/* ------------------------------------------------------------------------------------------
 * Forms
 * ---------------------------------------------------------------------------------------- */

export interface Field {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  help?: string;
  /** Only shown when this returns true for the current values. */
  when?: (v: Record<string, any>) => boolean;
}

export interface FormSpec {
  title: string;
  description?: string;
  fields: Field[];
  initial?: Record<string, any>;
  submitLabel?: string;
  /** A destructive change: the form also asks for the "I want to do this now" tick. */
  destructive?: boolean;
  submit: (values: Record<string, any>) => Promise<any>;
  doneMessage?: (result: any) => string;
  /** Shown instead of closing (e.g. an API key that is shown once). */
  showResult?: (result: any) => React.ReactNode | null;
}

export const FormDialog: React.FC<{ spec: FormSpec | null; onClose: () => void; onDone?: (result: any) => void }> = ({ spec, onClose, onDone }) => {
  const [values, setValues] = useState<Record<string, any>>({});
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<React.ReactNode | null>(null);
  useEffect(() => { setValues({ ...(spec?.initial ?? {}) }); setSure(false); setError(null); setResult(null); }, [spec]);
  if (!spec) return <Modal isOpen={false} onClose={onClose} title="">{null}</Modal>;
  const shown = spec.fields.filter((f) => !f.when || f.when(values));
  const missing = shown.some((f) => f.required && (values[f.name] === undefined || values[f.name] === null || String(values[f.name]).trim() === ''));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const clean: Record<string, any> = {};
      for (const f of shown) {
        const v = values[f.name];
        if (f.type === 'checkbox') clean[f.name] = !!v;
        else if (f.type === 'number') { if (v !== undefined && v !== '') clean[f.name] = Number(v); }
        else if (v !== undefined && String(v).trim() !== '') clean[f.name] = typeof v === 'string' ? v.trim() : v;
      }
      const out = await spec.submit(clean);
      toast.success(spec.doneMessage?.(out) ?? `${spec.title}: saved`);
      onDone?.(out);
      const extra = spec.showResult?.(out) ?? null;
      if (extra) setResult(extra); else onClose();
    } catch (err: any) {
      setError(`${err.message}${err.requestId ? ` (request id ${err.requestId})` : ''}`);
    } finally {
      setBusy(false);
    }
  };
  const lbl = 'mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400';
  return (
    <Modal isOpen onClose={onClose} title={spec.title} size="md">
      {result ? (
        <div className="space-y-4" data-testid="op-form-result">
          {result}
          <div className="flex justify-end"><button type="button" className={buttonClass.primary} onClick={onClose}>Done</button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3" data-testid="op-form">
          {spec.description && <p className="text-sm text-slate-700 dark:text-slate-200">{spec.description}</p>}
          {shown.map((f) => {
            const id = `op-f-${f.name}`;
            const set = (v: any) => setValues((p) => ({ ...p, [f.name]: v }));
            if (f.type === 'checkbox') {
              return (
                <label key={f.name} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input id={id} type="checkbox" checked={!!values[f.name]} onChange={(e) => set(e.target.checked)} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600" data-testid={id} />
                  {f.label}
                </label>
              );
            }
            return (
              <div key={f.name}>
                <label htmlFor={id} className={lbl}>{f.label}{f.required ? ' *' : ''}</label>
                {f.type === 'select' ? (
                  <select id={id} value={values[f.name] ?? ''} onChange={(e) => set(e.target.value)} className={cx(inputClass, 'w-full')} data-testid={id}>
                    <option value="">Choose…</option>
                    {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea id={id} value={values[f.name] ?? ''} onChange={(e) => set(e.target.value)} rows={3} className={cx(inputClass, 'h-auto w-full py-2')} data-testid={id} />
                ) : (
                  <input id={id} type={f.type ?? 'text'} value={values[f.name] ?? ''} onChange={(e) => set(e.target.value)} className={cx(inputClass, 'w-full')} data-testid={id}
                    autoComplete={f.type === 'password' ? 'new-password' : 'off'} step={f.type === 'number' ? 'any' : undefined} />
                )}
                {f.help && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{f.help}</p>}
              </div>
            );
          })}
          {spec.destructive && (
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="h-4 w-4 rounded border-slate-300 dark:border-slate-600" data-testid="op-confirm-check" />
              I want to do this now
            </label>
          )}
          <ErrorText error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={buttonClass.primary} disabled={missing || busy || (spec.destructive && !sure)} data-testid="op-form-submit">
              {busy ? 'Saving…' : spec.submitLabel ?? 'Save'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};

/** Status of a session as the server decides it. */
export const SessionBadge: React.FC<{ status: string }> = ({ status }) => (
  <Badge tone={status === 'valid' ? 'good' : status === 'revoked' ? 'bad' : 'neutral'}>{status === 'valid' ? 'Valid' : status === 'revoked' ? 'Revoked' : status === 'ended' ? 'Ended' : 'Expired'}</Badge>
);

export const CompanyStatusBadge: React.FC<{ status: string | null | undefined }> = ({ status }) =>
  status === 'suspended' ? <Badge tone="bad">Suspended</Badge> : <Badge tone="good">Active</Badge>;

/** "Chrome 120 · macOS · desktop" */
export const deviceText = (r: { browser?: string | null; os?: string | null; device?: string | null }) =>
  [r.browser, r.os, r.device].filter(Boolean).join(' · ') || '—';
/** "Bucharest, Romania" */
export const placeText = (r: { city?: string | null; region?: string | null; country?: string | null }) =>
  [r.city, r.country].filter(Boolean).join(', ') || '—';
