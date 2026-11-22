import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Inbox, RefreshCw } from 'lucide-react';
import API_URL from '../config/api';
import ExportCsvButton from './ExportCsvButton';
import { Badge, Card, CardHeader, EmptyState, Page, PageIntro, buttonClass, cx, inputClass, type Tone } from './ui';

/**
 * Ingestion log: every KPI write (ingestion API and Manual metrics) with its status, items and
 * errors, newest first, plus when each source last sent data. super_admin sees the company; a
 * QA manager the requests that touched teams of the departments they manage
 * (GET /api/ingestion-log, server/routes/ingestionLog.ts).
 */

interface Item {
  index: number;
  teamId: string | null;
  source: string | null;
  recordedAt: string | null;
  snapshotDate?: string | null;
  metrics: string[];
  status: 'written' | 'duplicate' | 'error';
  errors?: string[];
  qaScore?: number | null;
}

interface Entry {
  id: string;
  channel: 'api' | 'manual' | 'upload';
  source: string | null;
  /** File uploads: the file this request came from (Admin console → Upload files). */
  upload?: { file: string; type: string | null; batch: string; part: number; parts: number } | null;
  received_at: string;
  status: 'accepted' | 'partial' | 'rejected';
  idempotency_key: string | null;
  http_status: number | null;
  item_count: number;
  value_count: number;
  items: Item[];
  errors: Array<{ index: number | null; errors: string[] }>;
  api_key_name: string | null;
  api_key_prefix: string | null;
  actor_name: string | null;
  teams: Array<{ id: string; name: string }>;
}

interface Source {
  source: string;
  last_received_at: string;
  last_accepted_at: string | null;
  last_status: Entry['status'];
  accepted_7d: number;
  partial_7d: number;
  rejected_7d: number;
  values_7d: number;
}

const STATUS: Record<Entry['status'], { label: string; tone: Tone }> = {
  accepted: { label: 'Accepted', tone: 'good' },
  partial: { label: 'Partial', tone: 'warn' },
  rejected: { label: 'Rejected', tone: 'bad' },
};
const ITEM_STATUS: Record<Item['status'], { label: string; tone: Tone }> = {
  written: { label: 'Written', tone: 'good' },
  duplicate: { label: 'Duplicate (skipped)', tone: 'neutral' },
  error: { label: 'Error', tone: 'bad' },
};

const when = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const ago = (iso: string | null | undefined) => {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
};

const IngestionLog: React.FC = () => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  // ?entry=<id> (a link from Upload files' results) opens that entry.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try { const id = new URLSearchParams(window.location.search).get('entry'); return id ? { [id]: true } : {}; } catch { return {}; }
  });
  const [filters, setFilters] = useState({ status: '', channel: '', source: '', from: '', to: '' });

  const query = useCallback((before?: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    if (before) p.set('before', before);
    p.set('limit', '50');
    return p.toString();
  }, [filters]);

  const load = useCallback(async (before?: string) => {
    if (!before) setState('loading');
    try {
      const [res, src] = await Promise.all([
        fetch(`${API_URL}/ingestion-log?${query(before)}`, { credentials: 'include' }),
        before ? Promise.resolve(null) : fetch(`${API_URL}/ingestion-log/sources`, { credentials: 'include' }),
      ]);
      if (res.status === 403) { setState('forbidden'); return; }
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setEntries((prev) => (before ? [...prev, ...data.entries] : data.entries));
      setNext(data.nextBefore ?? null);
      if (src?.ok) setSources((await src.json()).sources ?? []);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const anyFilter = Object.values(filters).some(Boolean);

  if (state === 'forbidden') {
    return (
      <Page>
        <PageIntro title="Ingestion log" />
        <Card><EmptyState title="Not available for your role" description="The ingestion log is available to super admins and managers." icon={<Inbox size={28} />} /></Card>
      </Page>
    );
  }

  return (
    <Page>
      <div data-testid="ingestion-log">
        <PageIntro
          title="Ingestion log"
          description="Every KPI write from the ingestion API and Manual metrics: what arrived, what was written, what was rejected and why. Retried requests with the same Idempotency-Key are answered from here without writing twice."
          actions={
            <>
            <ExportCsvButton
              what="Ingestion log"
              rows={entries}
              columns={[
                { header: 'Received', value: (e) => when(e.received_at), raw: (e) => e.received_at },
                { header: 'Channel', value: (e) => (e.channel === 'api' ? 'API' : e.channel === 'upload' ? 'Upload' : 'Manual') },
                { header: 'File', value: (e) => e.upload?.file ?? '' },
                { header: 'Source', value: (e) => e.source ?? '' },
                { header: 'Sent by', value: (e) => e.api_key_name ? `API key ${e.api_key_name}${e.api_key_prefix ? ` (${e.api_key_prefix}…)` : ''}` : e.actor_name ?? '' },
                { header: 'Status', value: (e) => STATUS[e.status]?.label ?? e.status },
                { header: 'HTTP status', value: (e) => e.http_status },
                { header: 'Items', value: (e) => e.item_count },
                { header: 'Values', value: (e) => e.value_count },
                { header: 'Teams', value: (e) => e.teams.map((t) => t.name).join('; ') },
                { header: 'Errors', value: (e) => e.errors.flatMap((x) => x.errors.map((m) => (x.index === null ? m : `item ${x.index + 1}: ${m}`))).join('; ') },
                { header: 'Idempotency key', value: (e) => e.idempotency_key ?? '' },
              ]}
            />
            <button type="button" className={buttonClass.secondary} onClick={() => load()}>
              <RefreshCw size={15} aria-hidden /> Refresh
            </button>
            </>
          }
        />

        {/* Per-source last received */}
        <Card padded={false} className="mb-6">
          <div className="px-5 pt-5">
            <CardHeader title="Sources" subtitle="When each source last sent data, and its requests in the last 7 days." />
          </div>
          {sources.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-slate-500 dark:text-slate-400">{state === 'loading' ? 'Loading…' : 'No data has been received yet.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm" data-testid="ingestion-sources">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                    <th className="px-5 py-2 font-medium">Source</th>
                    <th className="px-5 py-2 font-medium">Last received</th>
                    <th className="px-5 py-2 font-medium">Last result</th>
                    <th className="px-5 py-2 text-right font-medium">Accepted (7 d)</th>
                    <th className="px-5 py-2 text-right font-medium">Partial (7 d)</th>
                    <th className="px-5 py-2 text-right font-medium">Rejected (7 d)</th>
                    <th className="px-5 py-2 text-right font-medium">Values (7 d)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sources.map((s) => (
                    <tr key={s.source}>
                      <td className="px-5 py-2 font-medium text-slate-900 dark:text-white">{s.source}</td>
                      <td className="whitespace-nowrap px-5 py-2 text-slate-700 dark:text-slate-300">{when(s.last_received_at)} <span className="text-xs text-slate-500 dark:text-slate-400">· {ago(s.last_received_at)}</span></td>
                      <td className="px-5 py-2"><Badge tone={STATUS[s.last_status].tone}>{STATUS[s.last_status].label}</Badge></td>
                      <td className="px-5 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{s.accepted_7d}</td>
                      <td className="px-5 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{s.partial_7d}</td>
                      <td className={cx('px-5 py-2 text-right tabular-nums', s.rejected_7d ? 'font-semibold text-red-700 dark:text-red-400' : 'text-slate-700 dark:text-slate-300')}>{s.rejected_7d}</td>
                      <td className="px-5 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{s.values_7d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Filters */}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end" role="group" aria-label="Filters">
          <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
            Status
            <select className={inputClass} value={filters.status} onChange={set('status')}>
              <option value="">All</option>
              <option value="accepted">Accepted</option>
              <option value="partial">Partial</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
            Channel
            <select className={inputClass} value={filters.channel} onChange={set('channel')}>
              <option value="">All</option>
              <option value="api">Ingestion API</option>
              <option value="manual">Manual metrics</option>
              <option value="upload">File uploads</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
            Source
            <select className={inputClass} value={filters.source} onChange={set('source')}>
              <option value="">All</option>
              {sources.map((s) => <option key={s.source} value={s.source}>{s.source}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
            From
            <input type="date" className={inputClass} value={filters.from} onChange={set('from')} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
            To
            <input type="date" className={inputClass} value={filters.to} onChange={set('to')} />
          </label>
          {anyFilter && (
            <button type="button" className={cx(buttonClass.secondary, 'col-span-2 sm:col-span-1')} onClick={() => setFilters({ status: '', channel: '', source: '', from: '', to: '' })}>
              Clear filters
            </button>
          )}
        </div>

        {/* Entries */}
        {state === 'error' ? (
          <Card><EmptyState title="The ingestion log could not be loaded" description="Try again in a moment." /></Card>
        ) : state === 'loading' ? (
          <Card><p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p></Card>
        ) : entries.length === 0 ? (
          <Card><EmptyState title={anyFilter ? 'No requests match' : 'No requests yet'} description={anyFilter ? 'Change or clear the filters.' : 'Requests appear here when data arrives through the ingestion API or Manual metrics.'} icon={<Inbox size={28} />} /></Card>
        ) : (
          <ul className="space-y-2" data-testid="ingestion-entries">
            {entries.map((e) => {
              const st = STATUS[e.status];
              const isOpen = !!open[e.id];
              const caller = e.channel === 'upload'
                ? `${e.actor_name ?? 'Someone'} uploaded ${e.upload?.file ? `“${e.upload.file}”${e.upload.parts > 1 ? ` (part ${e.upload.part} of ${e.upload.parts})` : ''}` : 'a file'}`
                : e.channel === 'manual' ? (e.actor_name ? `${e.actor_name} (Manual metrics)` : 'Manual metrics') : e.api_key_name ? `API key ${e.api_key_name}${e.api_key_prefix ? ` (${e.api_key_prefix}…)` : ''}` : 'API key (deleted)';
              const errorCount = e.errors?.length ?? 0;
              return (
                <li key={e.id} className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" data-testid="ingestion-entry" data-entry-id={e.id}>
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}
                    aria-expanded={isOpen}
                    className="flex w-full flex-col gap-2 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between focus-visible:outline-2 focus-visible:outline-brand-500"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <span className="text-sm font-medium text-slate-900 dark:text-white">{e.source ?? 'unknown source'}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{when(e.received_at)}</span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400">
                        {caller}
                        {e.teams.length > 0 && <> · {e.teams.map((t) => t.name).join(', ')}</>}
                      </span>
                    </span>
                    <span className="flex flex-shrink-0 items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
                      <span className="tabular-nums">{e.item_count} {e.item_count === 1 ? 'item' : 'items'} · {e.value_count} {e.value_count === 1 ? 'value' : 'values'} written</span>
                      {errorCount > 0 && <span className="font-medium text-red-700 dark:text-red-400">{errorCount} {errorCount === 1 ? 'error' : 'errors'}</span>}
                      {isOpen ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
                      <dl className="mb-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                        <div><dt className="inline text-slate-500 dark:text-slate-400">HTTP status </dt><dd className="inline font-medium tabular-nums text-slate-800 dark:text-slate-200">{e.http_status ?? '—'}</dd></div>
                        <div><dt className="inline text-slate-500 dark:text-slate-400">Idempotency-Key </dt><dd className="inline break-all font-mono text-slate-800 dark:text-slate-200">{e.idempotency_key ?? '—'}</dd></div>
                        <div><dt className="inline text-slate-500 dark:text-slate-400">Request id </dt><dd className="inline break-all font-mono text-slate-800 dark:text-slate-200">{e.id}</dd></div>
                      </dl>
                      {e.items.length === 0 ? (
                        errorCount > 0 ? (
                          <ul className="space-y-1">
                            {e.errors.flatMap((er) => er.errors).map((m, i) => <li key={i} className="text-red-700 dark:text-red-400">{m}</li>)}
                          </ul>
                        ) : <p className="text-slate-500 dark:text-slate-400">No items.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-xs">
                            <thead>
                              <tr className="text-left text-slate-500 dark:text-slate-400">
                                <th className="py-1 pr-4 font-medium">#</th>
                                <th className="py-1 pr-4 font-medium">Team</th>
                                <th className="py-1 pr-4 font-medium">Values for</th>
                                <th className="py-1 pr-4 font-medium">Metrics</th>
                                <th className="py-1 pr-4 font-medium">Result</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                              {e.items.map((it) => (
                                <tr key={it.index} className="align-top">
                                  <td className="py-1.5 pr-4 tabular-nums text-slate-500 dark:text-slate-400">{it.index + 1}</td>
                                  <td className="py-1.5 pr-4 text-slate-800 dark:text-slate-200">{e.teams.find((t) => t.id === it.teamId)?.name ?? it.teamId ?? '—'}</td>
                                  <td className="whitespace-nowrap py-1.5 pr-4 text-slate-700 dark:text-slate-300">{it.recordedAt ? when(it.recordedAt) : 'now'}</td>
                                  <td className="py-1.5 pr-4 font-mono text-slate-700 dark:text-slate-300">{it.metrics.join(', ') || '—'}</td>
                                  <td className="py-1.5 pr-4">
                                    <Badge tone={ITEM_STATUS[it.status].tone}>{ITEM_STATUS[it.status].label}</Badge>
                                    {it.errors?.map((m, i) => <p key={i} className="mt-1 text-red-700 dark:text-red-400">{m}</p>)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {next && state === 'ready' && (
          <div className="mt-4 flex justify-center">
            <button type="button" className={buttonClass.secondary} onClick={() => load(next)}>Load older requests</button>
          </div>
        )}
      </div>
    </Page>
  );
};

export default IngestionLog;
