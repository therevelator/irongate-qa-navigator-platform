import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, buttonClass, cx, inputClass } from '../ui';
import { opDownload, opFetch } from '../../lib/operatorClient';
import { DataTable, ErrorText } from './OperatorBits';
import { fmtDate } from './format';

/**
 * Exporter deliveries (exporter_deliveries): every batch a QE Navigator Exporter sent to
 * POST /api/ingest/exporter/batch, accepted or rejected (a bad key too, with the key prefix only), with the
 * company, department and team, the key, the Exporter's version and host, the kind, the item count, the date range
 * of the records, the size, the result and the records stored. A row opens its detail with the sanitised preview
 * (the first 20 items after the field allow-list). Filters, paging and CSV export. Rows are kept 13 months;
 * the preview is cleared after 30 days.
 */

interface Filters { companyId: string; teamId: string; result: string; from: string; to: string }
const EMPTY: Filters = { companyId: '', teamId: '', result: '', from: '', to: '' };
const TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = { accepted: 'good', duplicate: 'neutral', partial: 'warn', rejected: 'bad' };
const kb = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n < 1024 ? `${n} B` : `${Math.round(n / 102.4) / 10} KB`);

const ExporterDeliveries: React.FC = () => {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [entries, setEntries] = useState<any[]>([]);
  const [companies, setCompanies] = useState<Array<{ id: string; name: string | null }>>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any | null>(null);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return p;
  }, [filters]);
  const load = useCallback((before?: string | null) => {
    const p = new URLSearchParams(qs);
    if (before) p.set('before', before);
    setLoading(true);
    opFetch<any>(`/exporter-deliveries?${p.toString()}`)
      .then((b) => { setEntries((prev) => (before ? [...prev, ...b.entries] : b.entries)); setMore(!!b.more); setCompanies(b.companies ?? []); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [qs]);
  useEffect(() => { load(); }, [load]);
  const open = (id: string) => opFetch<any>(`/exporter-deliveries/${encodeURIComponent(id)}`).then(setDetail).catch((e) => toast.error(e.message));
  const lbl = 'mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400';
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  return (
    <div data-testid="op-exporter-deliveries">
      <form className="grid grid-cols-2 gap-2 border-b border-slate-100 px-4 py-3 sm:grid-cols-5 dark:border-slate-800" onSubmit={(e) => { e.preventDefault(); setFilters(draft); }}>
        <div><label htmlFor="ed-company" className={lbl}>Company</label>
          <select id="ed-company" value={draft.companyId} onChange={set('companyId')} className={cx(inputClass, 'w-full')} data-testid="ed-company">
            <option value="">All</option><option value="none">No company (bad key)</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name ?? c.id}</option>)}
          </select></div>
        <div><label htmlFor="ed-team" className={lbl}>Team id</label><input id="ed-team" value={draft.teamId} onChange={set('teamId')} className={cx(inputClass, 'w-full')} data-testid="ed-team" /></div>
        <div><label htmlFor="ed-result" className={lbl}>Result</label>
          <select id="ed-result" value={draft.result} onChange={set('result')} className={cx(inputClass, 'w-full')} data-testid="ed-result">
            <option value="">All</option><option value="accepted">Accepted</option><option value="duplicate">Duplicate</option><option value="partial">Partial</option><option value="rejected">Rejected</option>
          </select></div>
        <div><label htmlFor="ed-from" className={lbl}>From</label><input id="ed-from" type="date" value={draft.from} onChange={set('from')} className={cx(inputClass, 'w-full')} /></div>
        <div><label htmlFor="ed-to" className={lbl}>To</label><input id="ed-to" type="date" value={draft.to} onChange={set('to')} className={cx(inputClass, 'w-full')} /></div>
        <div className="col-span-2 flex items-end gap-2 sm:col-span-5">
          <button type="submit" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} data-testid="ed-apply">Apply filters</button>
          <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} onClick={() => { setDraft(EMPTY); setFilters(EMPTY); }}>Clear</button>
          <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} data-testid="ed-csv"
            onClick={() => opDownload(`/exporter-deliveries.csv?${qs.toString()}`, 'irongate-exporter-deliveries.csv').catch((e) => toast.error(e.message))}><Download size={13} /> CSV</button>
        </div>
      </form>
      <ErrorText error={error} />
      <DataTable testId="op-exporter-deliveries-table" rows={entries} empty={loading ? 'Loading…' : 'No Exporter deliveries.'} rowTestId={() => 'op-exporter-delivery'} columns={[
        { key: 'received_at', label: 'When', render: (r: any) => <button type="button" className="text-left text-brand-700 hover:underline dark:text-brand-300" onClick={() => open(r.id)} data-testid="ed-open">{fmtDate(r.received_at)}</button> },
        { key: 'company', label: 'Company / team', render: (r: any) => <><p>{r.company_name ?? (r.company_id ? r.company_id : <span className="text-slate-500">no company</span>)}</p><p className="text-xs text-slate-500">{[r.department_name, r.team_name].filter(Boolean).join(' · ') || (r.claimed_team_id ? `claimed ${r.claimed_team_id}` : '')}</p></> },
        { key: 'key', label: 'API key', render: (r: any) => <span className="text-xs">{r.api_key_name ?? '—'}{r.api_key_prefix ? <span className="block font-mono text-slate-500">{r.api_key_prefix}…</span> : null}</span> },
        { key: 'source', label: 'Source / kind', render: (r: any) => <span className="text-xs">{r.source ?? '—'} · {r.kind ?? '—'}</span> },
        { key: 'item_count', label: 'Items', className: 'tabular-nums' },
        { key: 'range', label: 'Records', render: (r: any) => <span className="text-xs">{r.records_from ? `${String(r.records_from).slice(0, 10)} → ${String(r.records_to).slice(0, 10)}` : '—'}</span> },
        { key: 'bytes', label: 'Size', render: (r: any) => <span className="text-xs">{kb(r.bytes_raw)}{r.bytes_received !== null && r.bytes_received !== r.bytes_raw ? ` (${kb(r.bytes_received)} gzip)` : ''}</span> },
        { key: 'result', label: 'Result', render: (r: any) => <><Badge tone={TONE[r.result] ?? 'neutral'}>{r.result}{r.dry_run ? ' (dry run)' : ''}</Badge>{r.reason_code && r.reason_code !== 'dry_run' ? <span className="block text-xs text-slate-500">{r.reason_code.replace(/_/g, ' ')}</span> : null}</> },
        { key: 'records_stored', label: 'Stored', className: 'tabular-nums' },
        { key: 'exporter', label: 'Exporter', render: (r: any) => <span className="text-xs">{r.exporter_version ?? '—'}{r.host_label ? <span className="block text-slate-500">{r.host_label}</span> : null}</span> },
      ]} />
      {more && entries.length > 0 && <div className="p-3 text-center"><button type="button" className={buttonClass.secondary} onClick={() => load(entries[entries.length - 1].received_at)}>Load older</button></div>}
      {detail && (
        <div className="border-t border-slate-200 p-4 text-sm dark:border-slate-800" data-testid="ed-detail">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="font-semibold">Delivery {detail.id}</h4>
            <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} onClick={() => setDetail(null)}>Close</button>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            {([
              ['Received', fmtDate(detail.received_at)], ['Result', `${detail.result}${detail.dry_run ? ' (dry run)' : ''}, HTTP ${detail.http_status}`],
              ['Reason', [detail.reason_code, detail.reason].filter(Boolean).join(': ') || '—'], ['Company', `${detail.company_name ?? '—'} (${detail.company_id ?? 'none'})`],
              ['Department', `${detail.department_name ?? '—'} (${detail.department_id ?? '—'})`], ['Team', `${detail.team_name ?? '—'} (${detail.team_id ?? '—'})`],
              ['Claimed ids (when they differ)', [detail.claimed_company_id, detail.claimed_department_id, detail.claimed_team_id].filter(Boolean).join(' / ') || '—'],
              ['API key', `${detail.api_key_name ?? '—'} ${detail.api_key_prefix ? `(${detail.api_key_prefix}…)` : ''}`], ['Exporter', `${detail.exporter_version ?? '—'} on ${detail.host_label ?? '—'}`],
              ['Source / kind', `${detail.source ?? '—'} / ${detail.kind ?? '—'}`], ['Items', String(detail.item_count)], ['Records stored', String(detail.records_stored)],
              ['Records from / to', detail.records_from ? `${fmtDate(detail.records_from)} → ${fmtDate(detail.records_to)}` : '—'],
              ['Size', `${kb(detail.bytes_raw)} uncompressed, ${kb(detail.bytes_received)} received`], ['Idempotency key', detail.idempotency_key ?? '—'],
            ] as Array<[string, string]>).map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-slate-100 py-1 dark:border-slate-800"><dt className="text-slate-500">{k}</dt><dd className="break-all text-right">{v}</dd></div>)}
          </dl>
          <h5 className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Sanitised preview{detail.preview ? ` (${detail.preview.shown} of ${detail.preview.total} items)` : ''}</h5>
          <pre className="max-h-96 overflow-auto rounded-md bg-slate-50 p-3 text-xs dark:bg-slate-900" data-testid="ed-preview">{detail.preview ? JSON.stringify(detail.preview.items, null, 2) : Date.now() - new Date(detail.received_at).getTime() > 30 * 86_400_000 ? 'Cleared after 30 days.' : 'No items.'}</pre>
        </div>
      )}
    </div>
  );
};

export default ExporterDeliveries;
