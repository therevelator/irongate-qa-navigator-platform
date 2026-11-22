/**
 * File uploads ("Level 0": Admin console → Upload files). A company that cannot give QE Navigator a
 * token, network access or a CI step exports files from its tools and drops them on the page.
 *
 *   GET  /api/uploads/context    the teams the person may upload to, the file types, the limits, the
 *                                field allow-list and the company setting "Store issue and incident titles"
 *   POST /api/uploads/preview    multipart: files (one or more, zip and gzip accepted) + options (JSON).
 *                                Per file: detected type, records, date range, the fields that will be
 *                                stored, 3 minimised records, warnings, metrics fed, the CSV mapping.
 *                                NOTHING is written (no data, no raw upload, no ingestion log row).
 *   POST /api/uploads/commit     the same body (the files again, with the confirmed types and mappings):
 *                                stores them through the ingestion API's own handlers; per file the
 *                                records stored, unchanged and skipped (and why) and the ingestion log entries
 *   GET  /api/uploads/privacy    { storeTitles }
 *   PUT  /api/uploads/privacy    { storeTitles: boolean } (super admins); off clears the stored titles
 *
 * options: { mode: "team" | "map", teamId?, files?: { [file name]: { type?, mapping?, dateOrder?, utcOffset?, skip? } } }
 *
 * Who: canUploadFiles / canUploadToTeam (server/lib/userPolicy.ts): super admins (every team),
 * managers (teams of their departments), team leads (teams they lead). Session cookie (SameSite) and the
 * exact-origin CORS of the rest of the app; the sandbox refuses every write (sandboxGate).
 * Limits: UPLOAD_MAX_BYTES per request (default 50 MB as received), 100 MB unpacked, 20 files per
 * request, 100 once unzipped; UPLOAD_RATE_LIMIT requests per company per 10 minutes (default 60).
 * Nothing is executed and no file is kept: what is stored is the parsed rows plus the minimised copy that
 * raw_uploads keeps for the API (same retention: RAW_PAYLOAD_DAYS / RAW_RETENTION_DAYS).
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { query } from '../../src/lib/db';
import { authenticateToken, type AuthRequest } from '../middleware/auth';
import { policyActor } from '../middleware/access';
import { canChangeDataMinimisation, canUploadFiles, canUploadToTeam, canViewIngestionLog } from '../lib/userPolicy';
import { recordAudit } from '../lib/audit';
import { BodyError, parseMultipart, readBody } from '../lib/ingest/body';
import { ALWAYS_DROPPED, FIELD_ALLOW_LIST } from '../lib/ingest/fieldAllowList';
import { CSV_SPECS } from '../lib/ingest/csvImports';
import { storeTitlesOf } from '../lib/ingest/minimiseStore';
import {
  expandUpload, planFile, UPLOAD_MAX_BYTES, UPLOAD_MAX_EXPANDED, UPLOAD_MAX_FILES, UPLOAD_MAX_PARTS, UPLOAD_TYPES,
  type FileOptions, type FilePlan, type Submission, type UploadContext,
} from '../lib/ingest/upload';
import { rawIngestHandler } from './ingestRaw';
import { deliveryIngestHandler } from './ingestDelivery';
import { handleIssues, handleStaticAnalysis } from './ingestWork';
import type { IngestCaller } from '../lib/ingestionLog';
import { invokeHandler } from '../lib/ingest/invoke';

const router = express.Router();

const HANDLERS: Record<Submission['kind'], (req: any, res: any) => Promise<unknown>> = {
  tests: rawIngestHandler('tests'),
  coverage: rawIngestHandler('coverage'),
  pipelines: rawIngestHandler('pipelines'),
  deployments: deliveryIngestHandler('deployments'),
  commits: deliveryIngestHandler('commits'),
  incidents: deliveryIngestHandler('incidents'),
  issues: handleIssues,
  'static-analysis': handleStaticAnalysis,
};

/** Upload requests per company (previews and uploads together). */
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.UPLOAD_RATE_LIMIT) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => `upload-company:${req.user?.companyId ?? 'none'}`,
  message: { error: 'Upload limit reached for your company (60 previews and uploads per 10 minutes). Try again in a few minutes.' },
});

const DENIED = 'Uploading files is available to super admins, managers (teams of their departments) and team leads (teams they lead)';

async function teamsOf(req: AuthRequest) {
  const actor = policyActor(req);
  const rows = await query<any[]>(`SELECT t.id, t.name, t.department_id, t.is_active, d.name AS department FROM teams t LEFT JOIN departments d ON d.id = t.department_id
                                    WHERE t.company_id = ? ORDER BY t.name`, [req.user!.companyId]);
  const companyTeams = new Map<string, string>(rows.map((r: any) => [r.id, r.name]));
  const allowed = rows.filter((r: any) => r.is_active !== false && canUploadToTeam(actor, r));
  return { actor, companyTeams, allowed };
}

router.get('/context', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    if (!canUploadFiles(actor)) return res.status(403).json({ error: DENIED });
    const { allowed } = await teamsOf(req);
    const services = await query<any[]>('SELECT COUNT(*)::int AS n FROM service_teams WHERE company_id = ?', [req.user!.companyId]).catch(() => [{ n: 0 }]);
    res.json({
      teams: allowed.map((t: any) => ({ id: t.id, name: t.name, department: t.department ?? null })),
      types: UPLOAD_TYPES,
      csvFormats: Object.values(CSV_SPECS).map((s) => ({ format: s.format, kind: s.kind, label: s.label, columns: s.targets.map((t) => ({ key: t.key, label: t.label, required: !!t.required })) })),
      limits: { maxBytes: UPLOAD_MAX_BYTES, maxExpandedBytes: UPLOAD_MAX_EXPANDED, maxFilesPerRequest: UPLOAD_MAX_PARTS, maxFilesUnpacked: UPLOAD_MAX_FILES, issuesPerRequest: 1000, eventsPerRequest: 500 },
      allowList: FIELD_ALLOW_LIST, alwaysDropped: ALWAYS_DROPPED,
      storeTitles: await storeTitlesOf(req.user!.companyId),
      canChangePrivacy: canChangeDataMinimisation(actor),
      canViewLog: canViewIngestionLog(actor),
      serviceMappings: services[0]?.n ?? 0,
    });
  } catch (e) {
    console.error('Upload context error:', e);
    res.status(500).json({ error: 'Failed to load the upload settings' });
  }
});

interface Parsed { files: Array<{ filename: string; data: Buffer }>; options: { mode: 'team' | 'map'; teamId: string | null; files: Record<string, FileOptions> } }

async function readUpload(req: AuthRequest): Promise<Parsed> {
  const ct = String(req.headers['content-type'] ?? '');
  if (!/^multipart\/form-data/i.test(ct)) throw new BodyError(415, 'Send the files as multipart/form-data (field "files")');
  const raw = await readBody(req, UPLOAD_MAX_BYTES + 1024 * 1024);
  const mp = parseMultipart(raw, ct);
  const files = mp.files.files ?? mp.files.file ?? [];
  if (!files.length) throw new BodyError(400, 'No file: add one or more files (field "files")');
  const received = files.reduce((n, f) => n + f.data.length, 0);
  if (received > UPLOAD_MAX_BYTES) throw new BodyError(413, `The files are larger than ${UPLOAD_MAX_BYTES / 1024 / 1024} MB in total: upload them in parts`);
  let options: any = {};
  if (mp.fields.options) {
    try { options = JSON.parse(mp.fields.options); } catch { throw new BodyError(400, 'options must be JSON'); }
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new BodyError(400, 'options must be a JSON object');
  const mode = options.mode === 'map' ? 'map' : 'team';
  const teamId = typeof options.teamId === 'string' && options.teamId.trim() ? options.teamId.trim().slice(0, 64) : null;
  if (mode === 'team' && !teamId) throw new BodyError(400, 'Choose the team the files belong to (or "map by service / project key")');
  const fileOpts: Record<string, FileOptions> = {};
  if (options.files && typeof options.files === 'object' && !Array.isArray(options.files)) {
    for (const [name, o] of Object.entries(options.files as Record<string, any>).slice(0, 200)) {
      if (!o || typeof o !== 'object') continue;
      const mapping: Record<string, string | null> = {};
      if (o.mapping && typeof o.mapping === 'object' && !Array.isArray(o.mapping)) {
        for (const [k, v] of Object.entries(o.mapping).slice(0, 100)) if (typeof k === 'string' && (v === null || typeof v === 'string')) mapping[k.slice(0, 60)] = v === null ? null : String(v).slice(0, 300);
      }
      fileOpts[name] = {
        type: typeof o.type === 'string' ? o.type.slice(0, 60) : null,
        mapping: Object.keys(mapping).length ? mapping : null,
        dateOrder: ['dmy', 'mdy', 'ymd', 'auto'].includes(o.dateOrder) ? o.dateOrder : null,
        utcOffset: typeof o.utcOffset === 'string' ? o.utcOffset.slice(0, 20) : null,
        skip: o.skip === true,
      };
    }
  }
  return { files, options: { mode, teamId, files: fileOpts } };
}

async function contextFor(req: AuthRequest, opts: Parsed['options']): Promise<{ ctx: UploadContext; caller: IngestCaller }> {
  const { companyTeams, allowed } = await teamsOf(req);
  const allowedTeams = new Map<string, string>(allowed.map((t: any) => [t.id, t.name]));
  if (opts.mode === 'team' && (!opts.teamId || !allowedTeams.has(opts.teamId))) {
    throw new BodyError(403, opts.teamId && companyTeams.has(opts.teamId) ? `You may not upload to team ${companyTeams.get(opts.teamId)}` : 'Team not found');
  }
  const services = await query<any[]>('SELECT service, team_id FROM service_teams WHERE company_id = ?', [req.user!.companyId]).catch(() => []);
  const ctx: UploadContext = {
    companyId: req.user!.companyId, mode: opts.mode, teamId: opts.teamId, companyTeams, allowedTeams,
    serviceTeams: new Map(services.map((s: any) => [s.service, s.team_id])), storeTitles: await storeTitlesOf(req.user!.companyId),
  };
  const caller: IngestCaller = { companyId: req.user!.companyId, channel: 'upload', actorId: req.user!.id ?? null, teamScope: new Set(allowedTeams.keys()) };
  return { ctx, caller };
}

/** Run one ingestion request through the API's own handler (same parsing, checks, storage, log). */
async function submit(sub: Submission, caller: IngestCaller, dryRun: boolean): Promise<{ status: number; body: any }> {
  const r = await invokeHandler(HANDLERS[sub.kind], { caller, body: sub.body, contentType: sub.contentType, query: { ...sub.query, ...(dryRun ? { dryRun: 'true' } : {}) } });
  return { status: r.status, body: r.body };
}

/** Plans of every file, with the API's dry run on each request and the duplicate check. Writes nothing. */
async function planAll(req: AuthRequest, parsed: Parsed) {
  const { ctx, caller } = await contextFor(req, parsed.options);
  const { files, notes } = expandUpload(parsed.files);
  const plans: FilePlan[] = [];
  const hashes = new Map<string, string>();
  for (const f of files) {
    const plan = planFile(f, parsed.options.files[f.name] ?? {}, ctx);
    const twin = hashes.get(plan.sha256);
    if (twin && plan.status === 'ready') {
      plan.status = 'skipped';
      plan.warnings.unshift(`The same file as “${twin}”: left out.`);
      plan.submissions = [];
    } else hashes.set(plan.sha256, f.name);
    plans.push(plan);
  }
  // The API's own checks (team, times, formats) on every request, as a dry run that writes nothing.
  const previewCaller = { ...caller, preview: true };
  for (const p of plans) {
    if (p.status !== 'ready') continue;
    for (const s of p.submissions) {
      const r = await submit(s, previewCaller, true);
      if (r.status >= 400) { p.status = 'error'; p.errorStatus = r.status; p.error = r.body?.error ?? 'The file was refused'; p.submissions = []; break; }
    }
  }
  await duplicates(ctx, plans);
  return { ctx, caller, plans, notes };
}

async function duplicates(ctx: UploadContext, plans: FilePlan[]) {
  for (const p of plans) {
    if (p.status !== 'ready') continue;
    if (p.reportIdentity) {
      const r = await query<any[]>(`SELECT received_at FROM raw_uploads WHERE company_id = ? AND team_id = ? AND kind = ? AND commit_sha = '' AND run_id = ? AND attempt = 1 AND status = 'parsed' LIMIT 1`,
        [ctx.companyId, p.reportIdentity.team, p.reportIdentity.kind, p.reportIdentity.runId]);
      p.duplicates = r.length ? { count: p.records, message: `This exact file was already uploaded (${new Date(r[0].received_at).toISOString().slice(0, 16).replace('T', ' ')} UTC): nothing new will be stored.` } : null;
      if (r.length) p.warnings.unshift(p.duplicates!.message);
    } else if (p.ids && p.ids.values.length) {
      const teams = Array.from(new Set(p.ids.values.map((v) => v.team).filter((t) => !t.startsWith('__'))));
      const ids = Array.from(new Set(p.ids.values.map((v) => v.id)));
      if (!teams.length) continue;
      const r = await query<any[]>(`SELECT team_id, external_id FROM ${p.ids.table} WHERE team_id = ANY(?::text[]) AND external_id = ANY(?::text[])`, [teams, ids]).catch(() => []);
      const have = new Set(r.map((x: any) => `${x.team_id}|${x.external_id}`));
      const n = p.ids.values.filter((v) => have.has(`${v.team}|${v.id}`)).length;
      const what = p.ids.table === 'issues' ? 'issue' : p.ids.table === 'incidents_raw' ? 'incident' : p.ids.table === 'issue_sprints' ? 'sprint' : 'deployment';
      p.duplicates = n ? { count: n, message: `${n} of these ${what}s ${n === 1 ? 'is' : 'are'} already stored: ${n === 1 ? 'it is' : 'they are'} updated where they changed, otherwise left as they are.` } : null;
      if (n) p.warnings.unshift(p.duplicates!.message);
    }
  }
}

const previewOut = (p: FilePlan) => {
  const { submissions, ids: _ids, reportIdentity: _r, sha256: _s, ...rest } = p;
  return { ...rest, requests: submissions.length };
};

function failure(res: express.Response, e: unknown, what: string) {
  if (e instanceof BodyError) return res.status(e.status).json({ error: e.message });
  console.error(`Upload ${what} error:`, e);
  return res.status(500).json({ error: `The ${what} failed; nothing was stored` });
}

router.post('/preview', authenticateToken, uploadLimiter, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    if (!canUploadFiles(actor)) return res.status(403).json({ error: DENIED });
    const parsed = await readUpload(req);
    const { plans, notes } = await planAll(req, parsed);
    res.json({ files: plans.map(previewOut), notes, message: 'Preview only: nothing was stored. Check the files, then choose Upload.' });
  } catch (e) {
    return failure(res, e, 'preview');
  }
});

const METRIC_LABELS: Record<string, string> = {
  line_coverage: 'Line coverage', branch_coverage: 'Branch coverage', changed_code_coverage: 'Coverage of changed code', pass_rate: 'Pass rate',
  first_time_pass_rate: 'First-time pass rate', flaky_tests: 'Flaky tests', test_flakiness_rate: 'Test flakiness rate', test_execution_time: 'Test execution time',
  build_time: 'Average build time', pipeline_success_rate: 'Pipeline success rate', parallel_test_efficiency: 'Parallel test efficiency',
  deployment_frequency: 'Deployment frequency', lead_time: 'Lead time for changes', change_failure_rate: 'Change failure rate', mttr: 'Mean time to recovery',
  mtbf: 'Mean time between failures', availability: 'System availability', incidents_per_deploy: 'Incidents per deploy', infrastructure_failures: 'Infrastructure failures',
  code_quality: 'Code quality score', findings: 'Static-analysis findings', new_findings: 'New findings', fixed_findings: 'Fixed findings',
  escape_rate: 'Defect escape rate', defect_density: 'Defect density', velocity: 'Sprint velocity', commitment: 'Sprint commitment rate', carryover: 'Sprint carryover',
  blocked_time: 'Blocked time', sizing_accuracy: 'Sizing accuracy',
};

function metricsOf(body: any): string[] {
  const out = new Set<string>();
  const days = (xs: any[]) => { for (const d of xs ?? []) for (const m of d?.metrics ?? []) if (m?.key) out.add(METRIC_LABELS[m.key] ?? m.key); };
  const c = body?.computed;
  if (Array.isArray(c)) for (const x of c) { if (Array.isArray(x?.days)) days(x.days); else days([x]); }
  return Array.from(out);
}

/** Counts of one handler answer: stored (new), updated, unchanged (already received). */
function countsOf(sub: Submission, r: { status: number; body: any }) {
  const b = r.body ?? {};
  const out = { stored: 0, updated: 0, unchanged: 0 };
  if (r.status >= 400) return out;
  // Sprints sent on their own: the answer counts the sprints changed, and lists no issue.
  if (sub.kind === 'issues' && typeof b.sprints === 'number' && Array.isArray(b.issues) && b.issues.length === 0) {
    out.updated = b.sprints; out.unchanged = Math.max(0, sub.count - b.sprints); return out;
  }
  const list: any[] | null = Array.isArray(b.issues) ? b.issues : Array.isArray(b.events) ? b.events : Array.isArray(b.runs) ? b.runs : null;
  if (list) {
    for (const x of list) { if (x.status === 'written') out.stored++; else if (x.status === 'updated') out.updated++; else out.unchanged++; }
    return out;
  }
  if (typeof b.sprints === 'number' && sub.kind === 'issues') { out.updated += b.sprints; out.unchanged += Math.max(0, sub.count - b.sprints); return out; }
  if (b.status === 'duplicate' || b.status === 'ignored') out.unchanged = sub.count; else out.stored = sub.count;
  return out;
}

router.post('/commit', authenticateToken, uploadLimiter, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    if (!canUploadFiles(actor)) return res.status(403).json({ error: DENIED });
    const parsed = await readUpload(req);
    const { caller, plans, notes } = await planAll(req, parsed);
    const batch = randomUUID();
    const results = [];
    for (const p of plans) {
      const base = { name: p.name, type: p.type?.label ?? null, kind: p.type?.kind ?? null, skippedRows: p.skipped, warnings: p.warnings, teams: p.teams };
      if (p.status !== 'ready') {
        results.push({ ...base, status: p.status === 'skipped' ? 'skipped' : 'rejected', error: p.error ?? null, stored: 0, updated: 0, unchanged: 0, ingestionIds: [], metrics: [] });
        continue;
      }
      const ingestionIds: string[] = [];
      const totals = { stored: 0, updated: 0, unchanged: 0 };
      const metrics = new Set<string>();
      let error: string | null = null;
      for (const [i, s] of p.submissions.entries()) {
        const r = await submit(s, caller, false);
        const id = r.body?.ingestionId ?? null;
        if (id) {
          ingestionIds.push(id);
          // The ingestion log entry names the file it came from (Administration → Ingestion log).
          await query(`UPDATE ingestion_log SET response = COALESCE(response, '{}'::jsonb) || ?::jsonb WHERE id = ? AND company_id = ?`,
            [JSON.stringify({ upload: { batch, file: p.name, type: p.type?.label ?? null, part: i + 1, parts: p.submissions.length } }), id, caller.companyId]).catch(() => undefined);
        }
        if (r.status >= 400) { error = r.body?.error ?? 'Refused'; break; }
        const c = countsOf(s, r);
        totals.stored += c.stored; totals.updated += c.updated; totals.unchanged += c.unchanged;
        for (const m of metricsOf(r.body)) metrics.add(m);
      }
      const status = error ? (totals.stored + totals.updated > 0 ? 'partial' : 'rejected') : totals.stored + totals.updated > 0 ? 'stored' : 'unchanged';
      results.push({ ...base, status, error, ...totals, ingestionIds, metrics: Array.from(metrics) });
    }
    res.status(200).json({ batch, files: results, notes });
  } catch (e) {
    return failure(res, e, 'upload');
  }
});

router.get('/privacy', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!canUploadFiles(policyActor(req)) && !canChangeDataMinimisation(policyActor(req))) return res.status(403).json({ error: DENIED });
    res.json({ storeTitles: await storeTitlesOf(req.user!.companyId) });
  } catch (e) {
    console.error('Upload privacy error:', e);
    res.status(500).json({ error: 'Failed to load the setting' });
  }
});

router.put('/privacy', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const actor = policyActor(req);
    if (!canChangeDataMinimisation(actor)) return res.status(403).json({ error: 'Only a super admin may change what is stored' });
    const v = req.body?.storeTitles;
    if (typeof v !== 'boolean') return res.status(400).json({ error: 'storeTitles must be true or false' });
    const companyId = req.user!.companyId;
    const before = await storeTitlesOf(companyId);
    await query('UPDATE companies SET store_issue_titles = ? WHERE id = ?', [v, companyId]);
    let cleared = { issues: 0, incidents: 0, payloads: 0 };
    if (!v) {
      // Off: titles are dropped everywhere, the stored ones too (the evidence lists show the key only).
      const a = await query<any[]>('UPDATE issues SET title = NULL WHERE company_id = ? AND title IS NOT NULL RETURNING 1', [companyId]);
      const b = await query<any[]>('UPDATE incidents_raw SET title = NULL WHERE company_id = ? AND title IS NOT NULL RETURNING 1', [companyId]);
      const c = await query<any[]>(`UPDATE raw_uploads SET payload = NULL WHERE company_id = ? AND kind IN ('issues', 'incidents') AND payload IS NOT NULL RETURNING 1`, [companyId]);
      cleared = { issues: a.length, incidents: b.length, payloads: c.length };
    }
    if (before !== v) {
      await recordAudit({
        companyId, actorId: req.user!.id, action: 'company.data_minimisation', entityType: 'company', entityId: companyId,
        summary: v ? 'Store issue and incident titles: on' : `Store issue and incident titles: off (${cleared.issues} issue and ${cleared.incidents} incident titles cleared)`,
        before: { storeTitles: before }, after: { storeTitles: v },
      }).catch(() => undefined);
    }
    res.json({ storeTitles: v, cleared });
  } catch (e) {
    console.error('Upload privacy error:', e);
    res.status(500).json({ error: 'Failed to save the setting' });
  }
});

export default router;
