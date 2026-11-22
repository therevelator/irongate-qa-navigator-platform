/**
 * The QE Navigator Collector's endpoints (same API keys, rate limit and ingestion log as the other ingestion
 * endpoints; server/lib/collectorIngest.ts has the rules):
 *
 *   POST /api/ingest/collector/metrics     values calculated in the customer's network (privacy modes evidence and
 *                                          metrics), per team and day, with the engine version and, in evidence mode,
 *                                          the allowed evidence lists. JSON (gzip accepted), at most 5 MB, Idempotency-Key.
 *                                          ?dryRun=true validates the key, the teams and the body and stores nothing.
 *   POST /api/ingest/collector/heartbeat   versions, privacy mode, sources with their last success and error counts (no
 *                                          data); kept per API key for Connect your CI → Collector status. Not logged in
 *                                          the ingestion log (it carries no data).
 */
import express from 'express';
import { query } from '../../src/lib/db';
import { authenticateApiKey, ApiKeyRequest } from '../middleware/apiKey';
import { ingestLimiter } from '../middleware/rateLimit';
import { KpiValidationError, normaliseIdempotencyKey, notifyKpisUpdated } from '../lib/kpiIngest';
import { afterKpiWrite } from '../lib/alerts';
import { findReplay, requestHash, runLogged, sendReplay, type IngestCaller, type ItemSummary } from '../lib/ingestionLog';
import { BodyError, maybeGunzip, readBody } from '../lib/ingest/body';
import { HttpError, callerOf, actorOf, fail, noAccess, text } from './ingestRaw';
import { CollectorValidationError, storeCollectorValues, validateCollectorBody, validateHeartbeat, type CollectorBody } from '../lib/collectorIngest';

const router = express.Router();
export const COLLECTOR_BODY_LIMIT = 5 * 1024 * 1024;

async function jsonBody(req: ApiKeyRequest, limit: number): Promise<unknown> {
  let raw: Buffer;
  try { raw = await readBody(req, limit); } catch (e) {
    if (e instanceof BodyError && e.status === 413) throw new BodyError(413, `Body too large: at most ${limit / 1024 / 1024} MB per request (send fewer days per request)`);
    throw e;
  }
  const payload = maybeGunzip(raw, req.headers['content-encoding'] as string | undefined);
  try { return JSON.parse(text(payload)); } catch { throw new HttpError(400, 'The body must be JSON (Content-Type: application/json)'); }
}

router.post('/collector/metrics', ingestLimiter, authenticateApiKey, async (req: ApiKeyRequest, res) => {
  const caller: IngestCaller = callerOf(req);
  let key: string | null = null;
  let hash: string | null = null;
  let teamId: string | null = null;
  const source = 'collector values';
  try {
    try { key = normaliseIdempotencyKey(req.get('Idempotency-Key'), 'Idempotency-Key'); } catch (e) { throw new HttpError(400, (e as KpiValidationError).message); }
    const body = await jsonBody(req, COLLECTOR_BODY_LIMIT);
    hash = requestHash(body);
    if (key && !(req.query.dryRun === 'true')) {
      const replay = await findReplay(caller, key);
      if (replay) return sendReplay(res, replay, hash);
    }
    let parsed: CollectorBody;
    try { parsed = validateCollectorBody(body); } catch (e) {
      if (e instanceof CollectorValidationError) throw new HttpError(400, `Invalid Collector values: ${e.errors[0]}`, { details: e.errors });
      throw e;
    }
    const ids: string[] = Array.from(new Set<string>(parsed.teams.map((t) => t.teamId)));
    teamId = ids[0] ?? null;
    const owned = new Set<string>((await query<any[]>('SELECT id FROM teams WHERE company_id = ? AND id = ANY(?::text[])', [caller.companyId, ids])).map((r: any) => String(r.id)));
    const foreign = ids.filter((t) => !owned.has(t));
    if (foreign.length) { teamId = null; throw new HttpError(403, noAccess(caller, foreign)); }
    const values = parsed.teams.reduce((n, t) => n + t.days.reduce((m, d) => m + d.metrics.length, 0), 0);
    const src = `${source} (${parsed.mode}, engine ${parsed.engineVersion})`;
    if (req.query.dryRun === 'true' || req.query.dryRun === '1') {
      return res.status(200).json({ status: 'dry-run', kind: 'collector values', mode: parsed.mode, engineVersion: parsed.engineVersion, teams: ids, values, message: 'Key, teams and values are valid. Nothing was stored.' });
    }
    const outcome = await runLogged(caller, { key, hash, source: src }, async (client, ingestionId) => {
      const r = await storeCollectorValues(client, caller.companyId, parsed, { actorId: actorOf(caller), ingestionId, apiKeyId: caller.apiKeyId ?? null });
      const items: ItemSummary[] = ids.map((t, i) => ({ index: i, teamId: t, source: src, recordedAt: null, metrics: r.kpis[t] ?? [], status: r.changed ? 'written' : 'duplicate' }));
      return {
        status: 'accepted', httpStatus: r.changed ? 201 : 200,
        response: { status: r.changed ? 'accepted' : 'duplicate', kind: 'collector values', mode: parsed.mode, engineVersion: parsed.engineVersion, teams: ids.length, values: r.values, changed: r.changed, kpis: r.kpis },
        items, errors: [], teamIds: ids, valueCount: r.changed, source: src,
      };
    });
    if ('replay' in outcome) return sendReplay(res, outcome.replay, hash);
    const cols = Array.from(new Set(Object.values(outcome.outcome.response.kpis as Record<string, string[]>).flat()));
    if (cols.length) {
      notifyKpisUpdated(cols, 'collector');
      await afterKpiWrite(caller.companyId, Object.keys(outcome.outcome.response.kpis));
    }
    return res.status(outcome.outcome.httpStatus).json(outcome.outcome.response);
  } catch (e) {
    return fail(res, caller, key, hash, teamId, source, e);
  }
});

router.post('/collector/heartbeat', ingestLimiter, authenticateApiKey, async (req: ApiKeyRequest, res) => {
  try {
    const hb = validateHeartbeat(await jsonBody(req, 256 * 1024));
    await query(
      `INSERT INTO collector_heartbeats (company_id, api_key_id, collector_version, engine_version, privacy_mode, local_evidence_url, sources, details, first_seen, last_seen, beats)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, now(), now(), 1)
       ON CONFLICT (company_id, api_key_id) DO UPDATE SET collector_version = EXCLUDED.collector_version, engine_version = EXCLUDED.engine_version,
         privacy_mode = EXCLUDED.privacy_mode, local_evidence_url = EXCLUDED.local_evidence_url, sources = EXCLUDED.sources, details = EXCLUDED.details,
         last_seen = now(), beats = collector_heartbeats.beats + 1`,
      [req.apiKey!.companyId, req.apiKey!.id, hb.version, hb.engineVersion, hb.mode, hb.localEvidenceUrl, JSON.stringify(hb.sources), JSON.stringify(hb.details)]);
    return res.status(200).json({ status: 'ok', receivedAt: new Date().toISOString() });
  } catch (e) {
    if (e instanceof CollectorValidationError) return res.status(400).json({ error: `Invalid heartbeat: ${e.errors[0]}`, details: e.errors });
    if (e instanceof HttpError || e instanceof BodyError) return res.status(e.status).json({ error: e.message });
    console.error('Collector heartbeat error:', e);
    return res.status(500).json({ error: 'Failed to record the heartbeat' });
  }
});

export default router;
