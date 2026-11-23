/**
 * The QE Navigator Exporter's endpoints (same API keys and rate limit as the other ingestion endpoints):
 *
 *   POST /api/ingest/exporter/batch      the JSON envelope { companyId, departmentId, teamId, source, kind, items }
 *                                        with the raw data the Exporter read (server/lib/exporterIngest.ts). The ids
 *                                        are checked against the API key before anything is read further:
 *                                          companyId must be the key's company (else 403);
 *                                          departmentId must be a department of that company;
 *                                          teamId must be an active team of that department and company;
 *                                        a missing id is 400; "another company's id" and "no such id" get the same
 *                                        answer. The items then go through the existing ingestion handlers with the
 *                                        envelope's team as the only team they may write to (no service or project
 *                                        mapping). Every item is checked first (a dry run that writes nothing); only
 *                                        when all pass are they written. JSON, gzip accepted, at most 20 MB as
 *                                        received; Idempotency-Key (a re-sent batch replays every part); ?dryRun=true
 *                                        checks everything and writes nothing at all. Logged as channel Exporter.
 *   GET  /api/ingest/exporter/context    the key's company: its id and name, its departments and their active teams
 *                                        (ids and names). Only the key's own company, ever, and only for a key with the
 *                                        scope 'exporter' (api_keys.scope); a plain ingest key gets 403.
 *   POST /api/ingest/exporter/heartbeat  the Exporter's version and its sources' status (no data); kept per API key
 *                                        for Connect your CI → Exporter status. /collector/heartbeat is the same, for
 *                                        releases before 0.3.0.
 */
import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { API_KEY_PREFIX, authenticateApiKey, ApiKeyRequest } from '../middleware/apiKey';
import { exporterVersionOf, hostLabelOf, keyPrefixOf, recordDelivery, storedCount } from '../lib/exporterDeliveries';
import { ingestLimiter } from '../middleware/rateLimit';
import { KpiValidationError, normaliseIdempotencyKey } from '../lib/kpiIngest';
import { agentClient, findReplay, logRejected, prefetchReplays, requestHash, sendReplay, type IngestCaller } from '../lib/ingestionLog';
import { BodyError, maybeGunzip, readBody, MAX_UPLOAD_BYTES } from '../lib/ingest/body';
import { invokeHandler, type IngestHandler } from '../lib/ingest/invoke';
import {
  EnvelopeError, HeartbeatError, parseEnvelope, partKey, submissionsOf, validateHeartbeat,
  type Envelope, type HandlerKind, type Submission,
} from '../lib/exporterIngest';
import { rawIngestHandler, summaryItem, text } from './ingestRaw';
import { moreIngestHandler } from './ingestMore';
import { deliveryIngestHandler } from './ingestDelivery';
import { handleIssues, handleStaticAnalysis } from './ingestWork';
import { handleKpis } from './ingest';
import { triggerCalcDrain, type CalcSink } from '../lib/calc/queue';

const router = express.Router();

export const EXPORTER_BODY_LIMIT = MAX_UPLOAD_BYTES;

const HANDLERS: Record<HandlerKind, IngestHandler> = {
  tests: rawIngestHandler('tests'),
  coverage: rawIngestHandler('coverage'),
  pipelines: rawIngestHandler('pipelines'),
  deployments: deliveryIngestHandler('deployments'),
  commits: deliveryIngestHandler('commits'),
  incidents: deliveryIngestHandler('incidents'),
  issues: handleIssues,
  'static-analysis': handleStaticAnalysis,
  // Called lazily: server/routes/ingest.ts mounts this router, so its exports are read at request time.
  kpis: (req, res) => handleKpis(req, res),
  performance: moreIngestHandler('performance'),
  'test-management': moreIngestHandler('test-management'),
  'pull-requests': moreIngestHandler('pull-requests'),
  calendar: moreIngestHandler('calendar'),
};

/** The one answer for an id that is not the caller's to write to, whether it exists elsewhere or not at all. */
export const NOT_YOURS = {
  company: 'companyId does not match this API key',
  department: 'departmentId is not a department of your company',
  team: 'teamId is not an active team of this department',
};

async function jsonBody(req: ApiKeyRequest, size: { received: number | null; raw: number | null }): Promise<unknown> {
  let raw: Buffer;
  try { raw = await readBody(req, EXPORTER_BODY_LIMIT); } catch (e) {
    if (e instanceof BodyError && e.status === 413) throw new BodyError(413, `Body too large: at most ${EXPORTER_BODY_LIMIT / 1024 / 1024} MB per request as received (send gzip, or fewer items per batch)`);
    throw e;
  }
  // JSON, or the gzipped JSON sent as a binary type. On Netlify a gzipped body labelled as text (application/json)
  // arrives re-encoded as text and broken, so the Exporter sends gzip as application/gzip.
  const ct = String(req.headers['content-type'] ?? '');
  if (ct && !/^application\/(json|gzip|x-gzip|octet-stream)/i.test(ct)) throw new EnvelopeError(415, `Content-Type "${ct.split(';')[0]}" is not supported: send the envelope as JSON (Content-Type: application/json), or gzipped as Content-Type: application/gzip`);
  size.received = raw.length;
  const payload = maybeGunzip(raw, req.headers['content-encoding'] as string | undefined);
  size.raw = payload.length;
  if (!payload.length) throw new EnvelopeError(400, 'Empty body: send the envelope as JSON');
  try { return JSON.parse(text(payload)); } catch {
    const gz = /gzip/i.test(String(req.headers['content-encoding'] ?? ''));
    throw new EnvelopeError(400, gz && /^application\/json/i.test(ct)
      ? 'The body is not valid gzipped JSON. Send gzip with Content-Type: application/gzip (a gzipped body labelled application/json can be altered in transit)'
      : 'The body must be JSON (Content-Type: application/json)');
  }
}

/** companyId = the key's company; the department in it; the team active, in that department and company. */
async function checkIds(companyId: string, env: Envelope): Promise<void> {
  if (env.companyId !== companyId) throw new EnvelopeError(403, NOT_YOURS.company);
  const dep = await queryOne<any>('SELECT 1 AS ok FROM departments WHERE id = ? AND company_id = ?', [env.departmentId, companyId]);
  if (!dep) throw new EnvelopeError(403, NOT_YOURS.department);
  const team = await queryOne<any>('SELECT 1 AS ok FROM teams WHERE id = ? AND company_id = ? AND department_id = ? AND is_active IS NOT FALSE', [env.teamId, companyId, env.departmentId]);
  if (!team) throw new EnvelopeError(403, NOT_YOURS.team);
}

const itemLabel = (s: Submission) => (s.index === null ? 'items' : `items[${s.index}]`);

/**
 * The refused item of a list kind (pipeline-runs, deployments, commits, incidents, issues, kpis: one request for the
 * whole list): its index in the envelope's items, from the handler's answer. The kpis handler lists the refused
 * items with their index; the event handlers name it in the message ("runs[3].result …", "deployments[2] …"); else
 * the item whose id or key the message names. null when the answer names no single item.
 */
export function refusedItem(env: Envelope, body: any): { index: number; error: string } | null {
  const error = String(body?.error ?? 'refused');
  const details = Array.isArray(body?.details) ? body.details.filter((d: any) => Number.isInteger(d?.index)) : [];
  if (details.length) return { index: details[0].index, error: Array.isArray(details[0].errors) && details[0].errors.length ? details[0].errors.join('; ') : error };
  const items = env.items as any[];
  const batches = env.kind === 'commits' && items.length > 0 && items.every((x) => x && typeof x === 'object' && Array.isArray(x.commits));
  const m = /\b(runs|deployments|incidents|issues|data|batches|commits)\[(\d+)\]/.exec(error);
  if (m) {
    const n = Number(m[2]);
    // commits: a list of batches names "batches[n]" (one batch: its own "commits[j]", the batch is item 0); a list of commits "commits[n]".
    const index = env.kind === 'commits' ? (batches ? (m[1] === 'batches' ? n : items.length === 1 ? 0 : -1) : m[1] === 'commits' ? n : -1) : m[1] === 'batches' ? -1 : n;
    if (index >= 0 && index < items.length) return { index, error };
  }
  const ids = items.map((x) => (x && typeof x === 'object' ? String(x.id ?? x.key ?? x.sha ?? '') : ''));
  const named = ids.map((id, i) => ({ id, i })).filter(({ id }) => id && new RegExp(`(^|[^A-Za-z0-9_.-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_.-]|$)`).test(error));
  if (named.length === 1) return { index: named[0].i, error };
  return null;
}

/**
 * The batch's own key check (the same rule as authenticateApiKey), so that a refused key is in the operator log too:
 * with the key's prefix only, never the key.
 */
async function batchAuth(req: ApiKeyRequest, res: express.Response, next: express.NextFunction) {
  const header = req.headers['authorization'];
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  // A refusal is held until its row is written, so the log is complete when the answer arrives.
  const original = { status: res.status.bind(res), json: res.json.bind(res) };
  let status = 200;
  let held: unknown = undefined;
  (res as any).status = (n: number) => { status = n; return res; };
  (res as any).json = (body: unknown) => { held = body; return res; };
  const restore = () => { (res as any).status = original.status; (res as any).json = original.json; };
  await authenticateApiKey(req, res, () => { restore(); next(); });
  if (req.apiKey) return;
  restore();
  await recordDelivery({
    companyId: null, apiKeyPrefix: token.startsWith(API_KEY_PREFIX) ? keyPrefixOf(token) : token ? '(not igk_)' : null,
    exporterVersion: exporterVersionOf(req.get('user-agent')), hostLabel: hostLabelOf(req.get('x-exporter-host')),
    dryRun: req.query.dryRun === 'true' || req.query.dryRun === '1', result: 'rejected', reasonCode: token ? 'bad_key' : 'no_key',
    reason: token ? 'Invalid, revoked or refused API key' : 'No API key', httpStatus: status,
  });
  res.status(status).json(held ?? { error: 'Authentication failed' });
}

/** Reason codes of the operator log. */
function reasonCode(status: number, message: string): string {
  if (message === NOT_YOURS.company) return 'wrong_company';
  if (message === NOT_YOURS.department) return 'wrong_department';
  if (message === NOT_YOURS.team) return 'wrong_team';
  if (/is required/.test(message) && /^(companyId|departmentId|teamId)/.test(message)) return 'missing_id';
  if (/^kind must be/.test(message)) return 'bad_kind';
  if (status === 413) return 'too_large';
  if (status === 415) return 'unsupported_type';
  if (status === 422) return 'idempotency_conflict';
  if (status === 403) return 'forbidden';
  if (status >= 500) return 'server_error';
  return /^items/.test(message) ? 'item_refused' : 'invalid';
}

router.post('/exporter/batch', ingestLimiter, batchAuth, async (req: ApiKeyRequest, res) => {
  const base: IngestCaller = { companyId: req.apiKey!.companyId, channel: 'exporter', apiKeyId: req.apiKey!.id, client: agentClient(req.get('user-agent')) };
  const dryRun = req.query.dryRun === 'true' || req.query.dryRun === '1';
  let key: string | null = null;
  let hash: string | null = null;
  let env: Envelope | null = null;
  let raw: unknown = null;
  let idsOk = false;
  const size = { received: null as number | null, raw: null as number | null };
  const prefix = await queryOne<any>('SELECT key_prefix AS prefix FROM api_keys WHERE id = ?', [req.apiKey!.id]).catch(() => null);
  const delivery = (result: 'accepted' | 'duplicate' | 'partial' | 'rejected', httpStatus: number, extra: { reasonCode?: string; reason?: string; recordsStored?: number } = {}) => {
    const claimed = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return recordDelivery({
      companyId: base.companyId, departmentId: idsOk ? env!.departmentId : null, teamId: idsOk ? env!.teamId : null,
      claimed: { companyId: claimed.companyId, departmentId: claimed.departmentId, teamId: claimed.teamId },
      apiKeyId: req.apiKey!.id, apiKeyName: req.apiKey!.name, apiKeyPrefix: prefix?.prefix ?? null,
      exporterVersion: exporterVersionOf(req.get('user-agent')), hostLabel: hostLabelOf(req.get('x-exporter-host')),
      source: env?.source ?? (typeof claimed.source === 'string' ? claimed.source : null), kind: env?.kind ?? (typeof claimed.kind === 'string' ? claimed.kind : null),
      items: env?.items ?? (Array.isArray(claimed.items) ? claimed.items : null), bytesReceived: size.received, bytesRaw: size.raw,
      idempotencyKey: key, dryRun, result, httpStatus, ...extra,
    });
  };
  const reject = async (status: number, message: string, extra: Record<string, unknown> = {}) => {
    const response = { error: message, ...extra };
    // A dry run writes nothing in the company's data or ingestion log, not even its rejection (the operator log keeps it).
    const id = dryRun ? null : await logRejected(base, { key, hash }, {
      httpStatus: status, response, items: [summaryItem(idsOk ? env!.teamId : null, env ? `exporter ${env.kind}` : 'exporter', null, 'error', [message])],
      errors: [{ index: null, errors: [message] }], teamIds: idsOk ? [env!.teamId] : [], source: env ? `exporter ${env.kind}` : 'exporter',
    });
    await delivery('rejected', status, { reasonCode: reasonCode(status, message), reason: message });
    return res.status(status).json({ ...response, status: 'rejected', ingestionId: id });
  };
  try {
    try { key = normaliseIdempotencyKey(req.get('Idempotency-Key'), 'Idempotency-Key'); } catch (e) { throw new EnvelopeError(400, (e as KpiValidationError).message); }
    raw = await jsonBody(req, size);
    hash = requestHash(raw);
    env = parseEnvelope(raw);
    await checkIds(base.companyId, env);
    idsOk = true;
    const subs = submissionsOf(env);
    // The parts report a queued calculation here; the batch then starts one drain (server/lib/calc/queue.ts).
    const sink: CalcSink = { queued: false };
    // The team was checked above (active, in the department, of the key's company); a re-sent batch's parts are read
    // in one query. Neither is read again by the handlers (each read is a round trip, ~80 ms in production).
    const replayCache = key && !dryRun ? await prefetchReplays(base, subs.map((_s, i) => partKey(key!, i))) : null;
    const caller: IngestCaller = { ...base, teamScope: new Set([env.teamId]), calcSink: sink, verifiedTeams: new Map([[env.teamId, env.departmentId]]), replayCache };
    const ids = { companyId: env.companyId, departmentId: env.departmentId, teamId: env.teamId, source: env.source, kind: env.kind };

    // 1. Every part checked by its handler first (a dry run that writes nothing, not even a log row).
    const checks: Array<{ index: number | null; result: any }> = [];
    for (const [i, s] of subs.entries()) {
      // A re-sent batch: its parts are answered from the log, so they are not checked again.
      if (key && !dryRun && (await findReplay(caller, partKey(key, i)))) { checks.push({ index: s.index, result: null }); continue; }
      const r = await invokeHandler(HANDLERS[s.handler], { caller: { ...caller, preview: true }, body: s.body, contentType: s.contentType, query: { ...s.query, dryRun: 'true' } });
      if (r.status >= 400) {
        const { status: _s, ingestionId: _i, ...detail } = r.body ?? {};
        // A list kind is one request: the refused item is found in the handler's answer, so the error names it too.
        const one = s.index === null ? refusedItem(env, r.body) : null;
        if (one) return await reject(r.status, `items[${one.index}]: ${one.error}`, { ...ids, item: one.index, detail });
        return await reject(r.status, `${itemLabel(s)}: ${r.body?.error ?? 'refused'}`, { ...ids, item: s.index, detail });
      }
      checks.push({ index: s.index, result: r.body });
    }
    if (dryRun) {
      await delivery('accepted', 200, { reasonCode: 'dry_run' });
      return res.status(200).json({ status: 'dry-run', ...ids, items: checks, message: 'Key, ids and items are valid. Nothing was stored.' });
    }

    // 2. Written part by part through the same handlers (each in its own transaction with its log row, channel Exporter).
    const items: Array<{ index: number | null; status: 'written' | 'duplicate' | 'rejected'; httpStatus: number; replayed: boolean; result: any }> = [];
    for (const [i, s] of subs.entries()) {
      const r = await invokeHandler(HANDLERS[s.handler], { caller, body: s.body, contentType: s.contentType, query: s.query, idempotencyKey: key ? partKey(key, i) : null });
      const st = r.status >= 400 ? 'rejected' : r.body?.status === 'duplicate' || r.body?.status === 'ignored' ? 'duplicate' : 'written';
      items.push({ index: s.index, status: st, httpStatus: r.status, replayed: r.replayed, result: r.body });
    }
    const failed = items.filter((x) => x.status === 'rejected').length;
    const written = items.filter((x) => x.status === 'written').length;
    const status = failed ? (failed === items.length ? 'rejected' : 'partial') : written ? 'accepted' : 'duplicate';
    if (items.length && items.every((x) => x.replayed)) res.set('Idempotent-Replayed', 'true');
    const http = failed ? (failed === items.length ? Math.max(...items.map((x) => x.httpStatus)) : 207) : written ? 201 : 200;
    const stored = items.filter((x) => x.status === 'written' && !x.replayed).reduce((n, x) => n + storedCount(x.result), 0);
    const firstError = items.find((x) => x.status === 'rejected')?.result?.error;
    // The metrics: calculated in the background when the parts queued them (Netlify), else already calculated.
    const queued = items.some((x) => x.result?.calculation === 'queued');
    if (sink.queued) await triggerCalcDrain(base.companyId).catch(() => undefined);
    const calculation = queued || sink.queued ? 'queued' : written ? 'done' : 'none';
    await delivery(status, http, { recordsStored: stored, ...(failed ? { reasonCode: 'item_refused', reason: String(firstError ?? 'refused') } : status === 'duplicate' ? { reasonCode: 'duplicate' } : {}) });
    return res.status(http).json({ status, ...ids, written, duplicate: items.filter((x) => x.status === 'duplicate').length, rejected: failed, recordsStored: stored, calculation, items });
  } catch (e) {
    if (e instanceof EnvelopeError || e instanceof BodyError) {
      return reject(e.status, e.message, e instanceof EnvelopeError && e.details.length ? { details: e.details } : {});
    }
    console.error('Exporter batch error:', e);
    return reject(500, 'Failed to ingest the batch');
  }
});

/** The message of a plain ingest key on the context endpoint. */
export const CONTEXT_SCOPE_REQUIRED = 'This API key can only send data: reading the company, its departments and teams needs a key with the scope "QE Navigator Exporter" (Admin console → API keys)';

/** The key's scope (api_keys.scope); 'exporter' where the column does not exist yet (every key could read the context before it). */
async function keyScope(apiKeyId: string): Promise<'ingest' | 'exporter'> {
  const r = await queryOne<any>(`SELECT to_jsonb(k)->>'scope' AS scope FROM api_keys k WHERE id = ?`, [apiKeyId]);
  return r?.scope === 'ingest' ? 'ingest' : 'exporter';
}

router.get('/exporter/context', ingestLimiter, authenticateApiKey, async (req: ApiKeyRequest, res) => {
  try {
    // API keys are write-only; only an Exporter key may read the company's departments and teams (the Exporter's check and setup).
    if ((await keyScope(req.apiKey!.id)) !== 'exporter') return res.status(403).json({ error: CONTEXT_SCOPE_REQUIRED, code: 'exporter_scope_required' });
    const companyId = req.apiKey!.companyId;
    const company = await queryOne<any>('SELECT id, name FROM companies WHERE id = ?', [companyId]);
    const deps = await query<any[]>('SELECT id, name FROM departments WHERE company_id = ? ORDER BY name, id', [companyId]);
    const teams = await query<any[]>('SELECT id, name, department_id FROM teams WHERE company_id = ? AND is_active IS NOT FALSE ORDER BY name, id', [companyId]);
    res.json({
      company: { id: company?.id ?? companyId, name: company?.name ?? null },
      apiKey: { name: req.apiKey!.name },
      departments: deps.map((d: any) => ({ id: d.id, name: d.name, teams: teams.filter((t: any) => t.department_id === d.id).map((t: any) => ({ id: t.id, name: t.name })) })),
    });
  } catch (e) {
    console.error('Exporter context error:', e);
    res.status(500).json({ error: 'Failed to load the context' });
  }
});

async function heartbeat(req: ApiKeyRequest, res: express.Response) {
  try {
    let raw: Buffer;
    raw = await readBody(req, 256 * 1024);
    let body: unknown;
    try { body = JSON.parse(text(maybeGunzip(raw, req.headers['content-encoding'] as string | undefined))); } catch (e) {
      if (e instanceof BodyError) throw e;
      return res.status(400).json({ error: 'The body must be JSON' });
    }
    const hb = validateHeartbeat(body);
    await query(
      `INSERT INTO exporter_heartbeats (company_id, api_key_id, exporter_version, sources, details, first_seen, last_seen, beats)
       VALUES (?, ?, ?, ?::jsonb, ?::jsonb, now(), now(), 1)
       ON CONFLICT (company_id, api_key_id) DO UPDATE SET exporter_version = EXCLUDED.exporter_version, sources = EXCLUDED.sources,
         details = EXCLUDED.details, last_seen = now(), beats = exporter_heartbeats.beats + 1`,
      [req.apiKey!.companyId, req.apiKey!.id, hb.version, JSON.stringify(hb.sources), JSON.stringify(hb.details)]);
    return res.status(200).json({ status: 'ok', receivedAt: new Date().toISOString() });
  } catch (e) {
    if (e instanceof HeartbeatError) return res.status(400).json({ error: `Invalid heartbeat: ${e.errors[0]}`, details: e.errors });
    if (e instanceof BodyError) return res.status(e.status).json({ error: e.message });
    console.error('Exporter heartbeat error:', e);
    return res.status(500).json({ error: 'Failed to record the heartbeat' });
  }
}

router.post('/exporter/heartbeat', ingestLimiter, authenticateApiKey, heartbeat);
router.post('/collector/heartbeat', ingestLimiter, authenticateApiKey, heartbeat);

export default router;
