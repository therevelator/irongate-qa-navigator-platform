import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, buttonClass, cx, inputClass } from '../ui';
import { opDownload, opFetch } from '../../lib/operatorClient';
import { DataTable, ErrorText, deviceText, placeText } from './OperatorBits';
import { fmtDate } from './format';

/**
 * Sign-in events (auth_events): every sign-in (password, SSO, invitation, registration, password
 * reset) and every failed sign-in, with IP, location and device. `base` is '' for the whole
 * platform or `/companies/<id>` for one company. Filters, paging and CSV export.
 */

export const METHOD_LABELS: Record<string, string> = {
  password: 'Password', registration: 'Registration', invitation: 'Invitation', reset: 'Password reset', sso_google: 'Google', sso_microsoft: 'Microsoft',
};

interface Filters { userId: string; outcome: string; method: string; ip: string; country: string; from: string; to: string; requestId: string }
const EMPTY: Filters = { userId: '', outcome: '', method: '', ip: '', country: '', from: '', to: '', requestId: '' };

const AuthEventsList: React.FC<{ base: string; users?: Array<{ id: string; name: string | null; email: string }>; fixedUserId?: string }> = ({ base, users, fixedUserId }) => {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [entries, setEntries] = useState<any[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, userId: fixedUserId ?? filters.userId })) if (v) p.set(k, v);
    return p;
  }, [filters, fixedUserId]);
  const load = useCallback((before?: string | null) => {
    const p = new URLSearchParams(qs);
    if (before) p.set('before', before);
    setLoading(true);
    opFetch<any>(`${base}/auth-events?${p.toString()}`)
      .then((b) => { setEntries((prev) => (before ? [...prev, ...b.entries] : b.entries)); setNext(b.nextBefore); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [base, qs]);
  useEffect(() => { load(); }, [load]);
  const lbl = 'mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400';
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  return (
    <div data-testid="op-auth-events">
      <form className="grid grid-cols-2 gap-2 border-b border-slate-100 px-4 py-3 sm:grid-cols-4 lg:grid-cols-8 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); setFilters(draft); }}>
        {users && !fixedUserId && (
          <div className="col-span-2"><label htmlFor="ae-user" className={lbl}>User</label>
            <select id="ae-user" value={draft.userId} onChange={set('userId')} className={cx(inputClass, 'w-full')} data-testid="ae-user">
              <option value="">Everyone</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
            </select></div>
        )}
        <div><label htmlFor="ae-outcome" className={lbl}>Outcome</label>
          <select id="ae-outcome" value={draft.outcome} onChange={set('outcome')} className={cx(inputClass, 'w-full')} data-testid="ae-outcome">
            <option value="">All</option><option value="success">Success</option><option value="failure">Failed</option>
          </select></div>
        <div><label htmlFor="ae-method" className={lbl}>Type</label>
          <select id="ae-method" value={draft.method} onChange={set('method')} className={cx(inputClass, 'w-full')} data-testid="ae-method">
            <option value="">All</option>{Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>
        <div><label htmlFor="ae-ip" className={lbl}>IP</label><input id="ae-ip" value={draft.ip} onChange={set('ip')} className={cx(inputClass, 'w-full')} data-testid="ae-ip" /></div>
        <div><label htmlFor="ae-country" className={lbl}>Country</label><input id="ae-country" value={draft.country} onChange={set('country')} className={cx(inputClass, 'w-full')} data-testid="ae-country" /></div>
        <div><label htmlFor="ae-from" className={lbl}>From</label><input id="ae-from" type="date" value={draft.from} onChange={set('from')} className={cx(inputClass, 'w-full')} /></div>
        <div><label htmlFor="ae-to" className={lbl}>To</label><input id="ae-to" type="date" value={draft.to} onChange={set('to')} className={cx(inputClass, 'w-full')} /></div>
        <div><label htmlFor="ae-rid" className={lbl}>Request id</label><input id="ae-rid" value={draft.requestId} onChange={set('requestId')} className={cx(inputClass, 'w-full')} /></div>
        <div className="col-span-2 flex items-end gap-2 sm:col-span-4 lg:col-span-8">
          <button type="submit" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} data-testid="ae-apply">Apply filters</button>
          <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} onClick={() => { setDraft(EMPTY); setFilters(EMPTY); }}>Clear</button>
          <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} data-testid="ae-csv"
            onClick={() => opDownload(`${base}/auth-events.csv?${qs.toString()}`, 'irongate-sign-in-events.csv').catch((e) => toast.error(e.message))}><Download size={13} /> CSV</button>
        </div>
      </form>
      <ErrorText error={error} />
      <DataTable testId="op-auth-events-table" rows={entries} empty={loading ? 'Loading…' : 'No sign-in events.'} columns={[
        { key: 'created_at', label: 'When', render: (r: any) => fmtDate(r.created_at) },
        ...(base ? [] : [{ key: 'company_name', label: 'Company' }]),
        { key: 'user', label: 'User', render: (r: any) => (r.user_id ? <><p>{r.user_name ?? '—'}</p><p className="break-all text-xs text-slate-500">{r.user_email}</p></> : <span className="text-xs text-slate-500">Unknown e-mail</span>) },
        { key: 'outcome', label: 'Outcome', render: (r: any) => (r.outcome === 'success' ? <Badge tone="good">Success</Badge> : <Badge tone="bad">Failed{r.failure_reason ? `: ${r.failure_reason.replace(/_/g, ' ')}` : ''}</Badge>) },
        { key: 'method', label: 'Type', render: (r: any) => METHOD_LABELS[r.method] ?? r.method },
        { key: 'ip', label: 'IP' },
        { key: 'place', label: 'Location', render: (r: any) => placeText(r) },
        { key: 'device', label: 'Device', render: (r: any) => deviceText(r) },
        { key: 'request_id', label: 'Request id', className: 'break-all text-xs' },
      ]} />
      {next && <div className="p-3 text-center"><button type="button" className={buttonClass.secondary} onClick={() => load(next)}>Load older</button></div>}
    </div>
  );
};

export default AuthEventsList;
