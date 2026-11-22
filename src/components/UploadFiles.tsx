import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, Info, ShieldCheck, Trash2, UploadCloud, XCircle } from 'lucide-react';
import API_URL from '../config/api';
import { Badge, Card, CardHeader, Page, PageIntro, buttonClass, cx, inputClass, type Tone } from './ui';

/**
 * Upload files ("Level 0"): for a company that cannot give QE Navigator a token, network access or a CI
 * step. Someone exports files from their tools, drops them here, checks the PREVIEW (nothing is stored
 * until Upload: detected type, records, date range, the exact fields that will be stored, 3 minimised
 * records, warnings, metrics fed, the CSV column mapping) and uploads. The files go through the same
 * ingestion pipeline as the API (server/routes/uploads.ts). Super admins, managers (their departments'
 * teams) and team leads (teams they lead).
 */

interface Team { id: string; name: string; department: string | null }
interface UploadType { value: string; kind: string; format: string; label: string }
interface AllowedField { field: string; why: string; setting?: 'storeTitles'; person?: boolean }
interface Context {
  teams: Team[];
  types: UploadType[];
  limits: { maxBytes: number; maxExpandedBytes: number; maxFilesPerRequest: number };
  allowList: Record<'issue' | 'sprint' | 'incident', AllowedField[]>;
  alwaysDropped: string[];
  storeTitles: boolean;
  canChangePrivacy: boolean;
  canViewLog: boolean;
  serviceMappings: number;
}
interface CsvInfo {
  delimiter: string; rows: number; headers: string[]; mapping: Record<string, string | null>;
  targets: Array<{ key: string; label: string; required: boolean; type: string }>; dateOrder: 'dmy' | 'mdy' | 'ymd'; dateOrderAmbiguous: boolean; unusedColumns: string[];
}
interface Preview {
  name: string; size: number; status: 'ready' | 'error' | 'skipped'; error?: string; errorStatus?: number;
  detected: { kind: string; format: string; label: string } | null; type: UploadType | null;
  records: number; skipped: Array<{ reason: string; count: number; rows?: number[] }>; dateRange: { from: string; to: string } | null;
  fields: string[]; dropped: string[]; sample: Array<Record<string, unknown>>; warnings: string[]; limits: string[]; metrics: string[];
  teams: Array<{ id: string; name: string; records: number }>; duplicates?: { count: number; message: string } | null; csv?: CsvInfo; requests: number;
}
interface Result {
  name: string; type: string | null; status: 'stored' | 'unchanged' | 'partial' | 'rejected' | 'skipped'; error: string | null;
  stored: number; updated: number; unchanged: number; skippedRows: Preview['skipped']; ingestionIds: string[]; metrics: string[];
  teams: Preview['teams'];
}
interface FileOpt { type?: string | null; mapping?: Record<string, string | null> | null; dateOrder?: string | null; utcOffset?: string | null; skip?: boolean }

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** gzip a file in the browser (smaller requests; the server unpacks with its limits). Zip and gzip files are sent as they are. */
async function packed(f: File): Promise<Blob> {
  const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
  const compressed = (head[0] === 0x1f && head[1] === 0x8b) || (head[0] === 0x50 && head[1] === 0x4b);
  const CS = (window as any).CompressionStream;
  if (compressed || !CS || f.size < 64 * 1024) return f;
  try { return await new Response(f.stream().pipeThrough(new CS('gzip'))).blob(); } catch { return f; }
}

const STATUS: Record<Result['status'], { label: string; tone: Tone }> = {
  stored: { label: 'Stored', tone: 'good' },
  unchanged: { label: 'Already received', tone: 'neutral' },
  partial: { label: 'Partly stored', tone: 'warn' },
  rejected: { label: 'Refused', tone: 'bad' },
  skipped: { label: 'Left out', tone: 'neutral' },
};

const UploadFiles: React.FC = () => {
  const [ctx, setCtx] = useState<Context | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [mode, setMode] = useState<'team' | 'map'>('team');
  const [teamId, setTeamId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [opts, setOpts] = useState<Record<string, FileOpt>>({});
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [notes, setNotes] = useState<Array<{ name: string; message: string }>>([]);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'upload' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [drag, setDrag] = useState(false);
  const [privacyMsg, setPrivacyMsg] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/uploads/context`, { credentials: 'include' });
      if (r.status === 403) { setState('forbidden'); return; }
      if (!r.ok) throw new Error(String(r.status));
      const c: Context = await r.json();
      setCtx(c);
      setTeamId((t) => t || (c.teams.length === 1 ? c.teams[0].id : ''));
      setState('ready');
    } catch { setState('error'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const total = files.reduce((n, f) => n + f.size, 0);
  const tooBig = !!ctx && total > ctx.limits.maxBytes;

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) if (!next.some((x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified)) next.push(f);
    setFiles(next);
    setPreviews(null);
    setResults(null);
    setError(null);
  };
  const removeFile = (i: number) => { setFiles(files.filter((_, k) => k !== i)); setPreviews(null); setResults(null); };

  const body = async () => {
    const fd = new FormData();
    fd.append('options', JSON.stringify({ mode, teamId: mode === 'team' ? teamId : null, files: opts }));
    for (const f of files) fd.append('files', await packed(f), f.name);
    return fd;
  };

  const run = async (what: 'preview' | 'upload') => {
    setBusy(what);
    setError(null);
    if (what === 'preview') setResults(null);
    try {
      const r = await fetch(`${API_URL}/uploads/${what === 'preview' ? 'preview' : 'commit'}`, { method: 'POST', credentials: 'include', body: await body() });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { setError(b.error || (r.status === 413 ? 'The files are too large' : 'The request failed')); return; }
      setNotes(b.notes ?? []);
      if (what === 'preview') { setPreviews(b.files); setStale(false); } else setResults(b.files);
    } catch {
      setError('The server could not be reached. Nothing was stored.');
    } finally {
      setBusy(null);
    }
  };

  const setOpt = (name: string, patch: FileOpt) => { setOpts((o) => ({ ...o, [name]: { ...o[name], ...patch } })); setStale(true); };

  const ready = previews?.filter((p) => p.status === 'ready' && !opts[p.name]?.skip) ?? [];
  const canPreview = files.length > 0 && !tooBig && (mode === 'map' || !!teamId) && !busy;
  const typesByKind = useMemo(() => {
    const m = new Map<string, UploadType[]>();
    for (const t of ctx?.types ?? []) m.set(t.kind, [...(m.get(t.kind) ?? []), t]);
    return Array.from(m.entries());
  }, [ctx]);

  const savePrivacy = async (storeTitles: boolean) => {
    if (!storeTitles && !window.confirm('Stop storing issue and incident titles? The titles already stored are deleted and the evidence lists show the key only. This cannot be undone.')) return;
    const r = await fetch(`${API_URL}/uploads/privacy`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeTitles }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { setPrivacyMsg(b.error || 'Failed to save'); return; }
    setCtx((c) => (c ? { ...c, storeTitles: b.storeTitles } : c));
    setPrivacyMsg(storeTitles ? 'Titles are stored from now on.' : `Titles are no longer stored; ${b.cleared?.issues ?? 0} issue and ${b.cleared?.incidents ?? 0} incident titles were deleted.`);
    if (previews) setStale(true);
  };

  if (state === 'forbidden') {
    return <Page><PageIntro title="Upload files" /><Card><p className="text-sm text-slate-600 dark:text-slate-300">Uploading files is available to super admins, managers and team leads.</p></Card></Page>;
  }
  if (state !== 'ready' || !ctx) {
    return <Page><PageIntro title="Upload files" /><Card><p className="text-sm text-slate-600 dark:text-slate-300">{state === 'error' ? 'The upload settings could not be loaded. Try again in a moment.' : 'Loading…'}</p></Card></Page>;
  }

  return (
    <Page>
      <div data-testid="upload-files">
        <PageIntro
          title="Upload files"
          description="No API key, network access or CI step needed: export files from your tools and drop them here. You check a preview first; nothing is stored until you choose Upload."
        />

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader title="1. Where the data goes" />
              <fieldset className="space-y-3" data-testid="upload-target">
                <legend className="sr-only">Where the data goes</legend>
                <label className="flex items-start gap-2 text-sm text-slate-800 dark:text-slate-200">
                  <input type="radio" name="upload-mode" className="mt-1" checked={mode === 'team'} onChange={() => { setMode('team'); setStale(true); }} />
                  <span>Upload to a team</span>
                </label>
                {mode === 'team' && (
                  <div className="pl-6">
                    <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
                      Team
                      <select className={cx(inputClass, 'max-w-sm')} value={teamId} onChange={(e) => { setTeamId(e.target.value); setStale(true); }} data-testid="upload-team">
                        <option value="">Choose a team…</option>
                        {ctx.teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.department ? ` (${t.department})` : ''}</option>)}
                      </select>
                    </label>
                  </div>
                )}
                <label className="flex items-start gap-2 text-sm text-slate-800 dark:text-slate-200">
                  <input type="radio" name="upload-mode" className="mt-1" checked={mode === 'map'} onChange={() => { setMode('map'); setStale(true); }} data-testid="upload-mode-map" />
                  <span>
                    Map by service / project key
                    <span className="block text-xs text-slate-600 dark:text-slate-400">
                      Each issue, incident or deployment goes to the team its Jira or Linear project key or its service is mapped to in Connect your CI
                      ({ctx.serviceMappings} mapping{ctx.serviceMappings === 1 ? '' : 's'}). Rows without a mapped key are left out and listed in the preview.
                      Test, coverage and SARIF reports need a team.
                    </span>
                  </span>
                </label>
              </fieldset>
            </Card>

            <Card>
              <CardHeader title="2. Files" subtitle={`Up to ${mb(ctx.limits.maxBytes)} in total, ${ctx.limits.maxFilesPerRequest} files or a zip archive.`} />
              <div
                role="button"
                tabIndex={0}
                aria-label="Add files: drop them here or press Enter to choose"
                data-testid="upload-drop"
                onClick={() => input.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
                className={cx('flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center focus-visible:outline-2 focus-visible:outline-brand-500',
                  drag ? 'border-brand-600 bg-brand-50 dark:bg-brand-950/30' : 'border-slate-300 dark:border-slate-700')}
              >
                <UploadCloud size={28} aria-hidden className="mb-2 text-slate-500 dark:text-slate-400" />
                <span className="text-sm font-medium text-slate-900 dark:text-white">Drop files here, or choose files</span>
                <span className="mt-1 text-xs text-slate-600 dark:text-slate-400">JUnit, TRX, Cucumber, lcov, Cobertura, JaCoCo, Istanbul, SARIF, JSON exports, Jira / Linear / PagerDuty / Opsgenie CSV, zip</span>
              </div>
              <input ref={input} type="file" multiple className="sr-only" aria-label="Choose files" data-testid="upload-input" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              {files.length > 0 && (
                <ul className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800" data-testid="upload-file-list">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2"><FileUp size={15} aria-hidden className="flex-shrink-0 text-slate-500" /><span className="truncate text-slate-900 dark:text-white">{f.name}</span></span>
                      <span className="flex flex-shrink-0 items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
                        {mb(f.size)}
                        <button type="button" className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={`Remove ${f.name}`} onClick={() => removeFile(i)}><Trash2 size={14} aria-hidden /></button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {tooBig && <p className="mt-3 text-sm text-red-700 dark:text-red-400" role="alert">The files are {mb(total)} in total: at most {mb(ctx.limits.maxBytes)}. Upload them in parts.</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" className={buttonClass.primary} disabled={!canPreview} onClick={() => run('preview')} data-testid="upload-preview-btn">
                  {busy === 'preview' ? 'Checking…' : previews ? 'Preview again' : 'Preview'}
                </button>
                {mode === 'team' && !teamId && files.length > 0 && <span className="text-xs text-slate-600 dark:text-slate-400">Choose a team first.</span>}
              </div>
              {error && <p className="mt-3 text-sm text-red-700 dark:text-red-400" role="alert" data-testid="upload-error">{error}</p>}
            </Card>

            {previews && (
              <section aria-labelledby="upload-preview-title" data-testid="upload-preview">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 id="upload-preview-title" className="text-sm font-semibold text-slate-900 dark:text-white">3. Preview</h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400">Nothing has been stored yet. Check every file, then choose Upload.</p>
                  </div>
                  <button type="button" className={buttonClass.primary} disabled={!!busy || stale || ready.length === 0} onClick={() => run('upload')} data-testid="upload-commit-btn">
                    {busy === 'upload' ? 'Uploading…' : `Upload ${ready.length} file${ready.length === 1 ? '' : 's'}`}
                  </button>
                </div>
                {stale && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" role="status" data-testid="upload-stale">You changed a setting: choose Preview again before uploading.</p>}
                {notes.length > 0 && <ul className="mb-3 text-xs text-slate-600 dark:text-slate-400">{notes.map((n, i) => <li key={i}>{n.name}: {n.message}</li>)}</ul>}
                <div className="space-y-4">
                  {previews.map((p) => <FilePreview key={p.name} p={p} opt={opts[p.name] ?? {}} types={typesByKind} onChange={(patch) => setOpt(p.name, patch)} />)}
                </div>
              </section>
            )}

            {results && (
              <Card>
                <CardHeader title="4. Result" subtitle="Metrics are recalculated as for data sent through the API." />
                <ul className="space-y-3" data-testid="upload-results">
                  {results.map((r) => (
                    <li key={r.name} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800" data-testid="upload-result">
                      <div className="flex flex-wrap items-center gap-2">
                        {r.status === 'stored' ? <CheckCircle2 size={16} aria-hidden className="text-green-700 dark:text-green-400" /> : r.status === 'rejected' ? <XCircle size={16} aria-hidden className="text-red-700 dark:text-red-400" /> : <Info size={16} aria-hidden className="text-slate-500" />}
                        <span className="font-medium text-slate-900 dark:text-white">{r.name}</span>
                        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                      </div>
                      <p className="mt-1 text-slate-700 dark:text-slate-300" data-testid="upload-result-counts">
                        {r.stored} new, {r.updated} updated, {r.unchanged} already stored{r.skippedRows.length ? `, ${r.skippedRows.reduce((n, s) => n + s.count, 0)} rows left out` : ''}
                        {r.teams.length ? ` · ${r.teams.map((t) => t.name).join(', ')}` : ''}
                      </p>
                      {r.error && <p className="mt-1 text-red-700 dark:text-red-400">{r.error}</p>}
                      {r.skippedRows.length > 0 && (
                        <ul className="mt-1 list-disc pl-5 text-xs text-slate-600 dark:text-slate-400">
                          {r.skippedRows.map((s, i) => <li key={i}>{s.count} × {s.reason}{s.rows?.length ? ` (row${s.rows.length > 1 ? 's' : ''} ${s.rows.join(', ')}${s.count > s.rows.length ? ', …' : ''})` : ''}</li>)}
                        </ul>
                      )}
                      {r.metrics.length > 0 && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Recalculated: {r.metrics.join(', ')}</p>}
                      {r.ingestionIds.length > 0 && (
                        ctx.canViewLog
                          ? <p className="mt-1 text-xs"><a className="text-brand-700 underline dark:text-brand-300" href={`/ingestion-log?entry=${encodeURIComponent(r.ingestionIds[0])}`} data-testid="upload-result-log">Open in the ingestion log</a>{r.ingestionIds.length > 1 ? ` (${r.ingestionIds.length} requests)` : ''}</p>
                          : <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Ingestion log entry {r.ingestionIds[0]}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader title="What is stored" subtitle="The field allow-list, on every path: uploads, the API and the on-premises agent." />
              <div className="space-y-3 text-xs text-slate-700 dark:text-slate-300" data-testid="upload-allow-list">
                {(['issue', 'incident'] as const).map((k) => (
                  <details key={k}>
                    <summary className="cursor-pointer text-sm font-medium text-slate-900 dark:text-white">{k === 'issue' ? 'Issues' : 'Incidents'}: {ctx.allowList[k].filter((f) => !(f.setting === 'storeTitles' && !ctx.storeTitles)).length} fields</summary>
                    <ul className="mt-2 space-y-1">
                      {ctx.allowList[k].filter((f) => !(f.setting === 'storeTitles' && !ctx.storeTitles)).map((f) => (
                        <li key={f.field}><code className="font-mono text-slate-900 dark:text-slate-100">{f.person ? `${f.field}Hash` : f.field}</code>: {f.why}</li>
                      ))}
                    </ul>
                  </details>
                ))}
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">Never stored</p>
                  <p>{ctx.alwaysDropped.join(', ')}.</p>
                </div>
              </div>
              <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                <label className="flex items-start gap-2 text-sm text-slate-800 dark:text-slate-200">
                  <input type="checkbox" className="mt-1" checked={ctx.storeTitles} disabled={!ctx.canChangePrivacy} onChange={(e) => savePrivacy(e.target.checked)} data-testid="upload-store-titles" />
                  <span>
                    Store issue and incident titles
                    <span className="block text-xs text-slate-600 dark:text-slate-400">
                      Titles are shown next to the key in the evidence lists. Off: titles are dropped everywhere and the lists show the key only.
                      {!ctx.canChangePrivacy && ' A super admin can change this.'}
                    </span>
                  </span>
                </label>
                {privacyMsg && <p className="mt-2 text-xs text-slate-700 dark:text-slate-300" role="status" data-testid="upload-privacy-msg">{privacyMsg}</p>}
              </div>
            </Card>
            <Card>
              <CardHeader title="Templates" subtitle="For data with no export of its own." />
              <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                <li><a className="text-brand-700 underline dark:text-brand-300" download="deployments-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent('id,service,environment,commit,commitAuthoredAt,startedAt,finishedAt,result,rollbackOf,hotfix,url\nrel-1.4.0,checkout-api,production,3f2a9c1,2026-11-01T15:00:00Z,2026-11-02T09:00:00Z,2026-11-02T09:12:00Z,success,,false,\n')}`}>Deployments CSV</a>: one row per deployment.</li>
                <li><a className="text-brand-700 underline dark:text-brand-300" download="sprints-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent('sprint,startDate,endDate,completedDate\nSprint 41,2026-11-02,2026-11-15,2026-11-15\n')}`}>Sprints CSV</a>: the dates of the sprints a Jira CSV names.</li>
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </Page>
  );
};

const FilePreview: React.FC<{ p: Preview; opt: FileOpt; types: Array<[string, UploadType[]]>; onChange: (patch: FileOpt) => void }> = ({ p, opt, types, onChange }) => {
  const id = useMemo(() => `pv-${p.name.replace(/[^A-Za-z0-9]/g, '-')}`, [p.name]);
  const tone: Tone = p.status === 'ready' ? 'good' : p.status === 'error' ? 'bad' : 'neutral';
  const sampleKeys = Array.from(new Set(p.sample.flatMap((r) => Object.keys(r)))).slice(0, 30);
  const show = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <Card className="overflow-hidden">
      <div data-testid="upload-preview-file" data-file={p.name}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="break-all text-sm font-semibold text-slate-900 dark:text-white">{p.name}</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400">{mb(p.size)}{p.detected ? ` · detected: ${p.detected.label}` : ' · type not recognised'}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={tone}>{p.status === 'ready' ? 'Ready' : p.status === 'error' ? 'Cannot be stored' : 'Left out'}</Badge>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300" htmlFor={`${id}-type`}>
            File type
            <select id={`${id}-type`} className={cx(inputClass, 'max-w-xs')} value={opt.type ?? p.type?.value ?? ''} onChange={(e) => onChange({ type: e.target.value || null, mapping: null })} data-testid="upload-type">
              {!p.type && <option value="">Choose…</option>}
              {types.map(([kind, ts]) => (
                <optgroup key={kind} label={kind}>
                  {ts.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={!opt.skip} onChange={(e) => onChange({ skip: !e.target.checked })} /> Include this file
          </label>
        </div>

        {p.status === 'error' && <p className="mt-3 flex items-start gap-2 text-sm text-red-700 dark:text-red-400" role="alert" data-testid="upload-file-error"><XCircle size={16} aria-hidden className="mt-0.5 flex-shrink-0" />{p.error}</p>}

        {p.status !== 'skipped' && (p.records > 0 || p.csv) && (
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
            <div><dt className="text-slate-600 dark:text-slate-400">Records</dt><dd className="text-sm font-semibold tabular-nums text-slate-900 dark:text-white" data-testid="upload-records">{p.records.toLocaleString()}</dd></div>
            <div><dt className="text-slate-600 dark:text-slate-400">Dates</dt><dd className="text-slate-900 dark:text-white">{p.dateRange ? `${day(p.dateRange.from)} – ${day(p.dateRange.to)}` : '—'}</dd></div>
            <div><dt className="text-slate-600 dark:text-slate-400">Team</dt><dd className="text-slate-900 dark:text-white">{p.teams.map((t) => `${t.name}${p.teams.length > 1 ? ` (${t.records})` : ''}`).join(', ') || '—'}</dd></div>
            <div><dt className="text-slate-600 dark:text-slate-400">Feeds</dt><dd className="text-slate-900 dark:text-white">{p.metrics.slice(0, 4).join(', ')}{p.metrics.length > 4 ? ` +${p.metrics.length - 4}` : ''}</dd></div>
          </dl>
        )}

        {p.csv && (
          <details className="mt-4" open={p.status === 'error' || p.csv.dateOrderAmbiguous} data-testid="upload-mapping">
            <summary className="cursor-pointer text-sm font-medium text-slate-900 dark:text-white">Column mapping ({p.csv.rows} rows, separator “{p.csv.delimiter === '\t' ? 'tab' : p.csv.delimiter}”)</summary>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Detected from the header row. Change a column if your export names it differently, then choose Preview again.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {p.csv.targets.map((t) => (
                <label key={t.key} className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
                  <span>{t.label}{t.required ? ' (required)' : ''}</span>
                  <select className={inputClass} value={(opt.mapping && t.key in opt.mapping ? opt.mapping[t.key] : p.csv!.mapping[t.key]) ?? ''} data-testid={`upload-map-${t.key}`}
                    onChange={(e) => onChange({ mapping: { ...(opt.mapping ?? p.csv!.mapping), [t.key]: e.target.value || null } })}>
                    <option value="">Not in this file</option>
                    {Array.from(new Set(p.csv!.headers)).filter(Boolean).map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
              <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
                Date order (for dates such as 03/04/2026)
                <select className={inputClass} value={opt.dateOrder ?? p.csv.dateOrder} onChange={(e) => onChange({ dateOrder: e.target.value })} data-testid="upload-date-order">
                  <option value="dmy">Day / month / year</option>
                  <option value="mdy">Month / day / year</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-300">
                Time zone of times without one
                <input className={inputClass} value={opt.utcOffset ?? ''} placeholder="UTC, or e.g. +01:00" onChange={(e) => onChange({ utcOffset: e.target.value || null })} data-testid="upload-utc-offset" />
              </label>
            </div>
          </details>
        )}

        {p.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-amber-800 dark:text-amber-300" data-testid="upload-warnings">
            {p.warnings.map((w, i) => <li key={i} className="flex items-start gap-1.5"><AlertTriangle size={13} aria-hidden className="mt-0.5 flex-shrink-0" />{w}</li>)}
          </ul>
        )}
        {p.skipped.length > 0 && (
          <div className="mt-3 text-xs text-slate-700 dark:text-slate-300" data-testid="upload-skipped">
            <p className="font-medium">Left out</p>
            <ul className="list-disc pl-5">
              {p.skipped.map((s, i) => <li key={i}>{s.count} × {s.reason}{s.rows?.length ? ` (row${s.rows.length > 1 ? 's' : ''} ${s.rows.join(', ')}${s.count > s.rows.length ? ', …' : ''})` : ''}</li>)}
            </ul>
          </div>
        )}
        {p.limits.length > 0 && (
          <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:bg-slate-800/60 dark:text-slate-300" data-testid="upload-limits">
            <p className="flex items-center gap-1.5 font-medium"><Info size={13} aria-hidden /> What this export cannot carry</p>
            <ul className="mt-1 list-disc pl-5">{p.limits.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </div>
        )}

        {p.fields.length > 0 && (
          <div className="mt-4" data-testid="upload-fields">
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-900 dark:text-white"><ShieldCheck size={14} aria-hidden /> Fields that will be stored</p>
            <p className="mt-1 flex flex-wrap gap-1">{p.fields.map((f) => <code key={f} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-800 dark:bg-slate-800 dark:text-slate-200">{f}</code>)}</p>
            {p.dropped.length > 0 && <p className="mt-2 text-xs text-slate-600 dark:text-slate-400" data-testid="upload-dropped">Not stored: {p.dropped.join(', ')}</p>}
          </div>
        )}

        {p.sample.length > 0 && (
          <div className="mt-4" data-testid="upload-sample">
            <p className="text-xs font-medium text-slate-900 dark:text-white">Sample: the first {p.sample.length} record{p.sample.length === 1 ? '' : 's'} exactly as {p.sample.length === 1 ? 'it' : 'they'} will be stored</p>
            <div className="mt-1 max-w-full overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800" tabIndex={0} role="region" aria-label={`Sample records of ${p.name}`}>
              <table className="min-w-full text-[11px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-slate-600 dark:bg-slate-800/50 dark:text-slate-400">{sampleKeys.map((k) => <th key={k} scope="col" className="whitespace-nowrap px-2 py-1 font-medium">{k}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {p.sample.map((r, i) => (
                    <tr key={i}>{sampleKeys.map((k) => <td key={k} className="max-w-[16rem] truncate whitespace-nowrap px-2 py-1 font-mono text-slate-800 dark:text-slate-200" title={show(r[k])}>{show(r[k])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

export default UploadFiles;

/** Admin console card next to Connect your CI: the way in for a company that cannot connect its tools. */
export const UploadFilesCard: React.FC = () => {
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    window.history.pushState(null, '', '/upload-files');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  return (
    <div className="mt-6" data-testid="upload-files-card">
      <Card>
        <CardHeader
          title="Upload files"
          subtitle="No API key, network access or CI step: export files from your tools (test reports, coverage, SARIF, Jira / Linear / PagerDuty / Opsgenie exports, CSV) and upload them. A preview shows exactly what will be stored first."
          action={<a href="/upload-files" onClick={open} className={buttonClass.secondary} data-testid="upload-files-open"><FileUp size={15} aria-hidden /> Upload files</a>}
        />
      </Card>
    </div>
  );
};
