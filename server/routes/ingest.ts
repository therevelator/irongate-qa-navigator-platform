import express from 'express';
import { query } from '../../src/lib/db';
import { authenticateApiKey, ApiKeyRequest } from '../middleware/apiKey';
import { ingestLimiter } from '../middleware/rateLimit';
import {
  KpiValidationError,
  normaliseIdempotencyKey,
  normaliseSource,
  normaliseSourceRef,
  notifyKpisUpdated,
  parseRecordedAt,
  recordKpiValues,
  RecordResult,
  validateKpiValues,
} from '../lib/kpiIngest';
import { afterIngestionRejected, afterKpiWrite } from '../lib/alerts';
import { logRejected, requestHash, runLogged, findReplay, sendReplay, type IngestCaller, type ItemSummary } from '../lib/ingestionLog';

const router = express.Router();

const MAX_BATCH = 100;
const ITEM_FIELDS = ['teamId', 'source', 'recordedAt', 'metrics', 'idempotencyKey', 'sourceRef'];

interface Prepared {
  index: number;
  teamId: string;
  source: string;
  recordedAt: Date;
  metrics: Record<string, number>;
  idempotencyKey: string | null;
  sourceRef: string | null;
}

/**
 * POST /api/ingest/kpis — machine ingestion of team KPIs (Jenkins, Jira, SonarQube, …).
 * Auth: Authorization: Bearer igk_… (per-company key, see Admin console → API keys).
 * Body: { teamId, source, recordedAt?, metrics: { column: number, … }, idempotencyKey?, sourceRef? }
 *       or an array of those (at most 100).
 *   recordedAt  the time the values are FOR (ISO 8601; default now; up to 365 days back). A
 *               backdated value updates that day's snapshot and the later days where no newer
 *               value exists.
 *   idempotencyKey (per item)  an item already written with this key is skipped ("duplicate").
 * Header Idempotency-Key: a retry of the same request returns the stored result, writes nothing.
 * ?partial=true: write the valid items and report the others (207, status "partial"); by default
 * the batch is all or nothing (any invalid item: 400, nothing written).
 * Every request is recorded in the ingestion log (Administration → Ingestion log).
 */
router.post('/kpis', ingestLimiter, authenticateApiKey, async (req: ApiKeyRequest, res) => {
  const body = req.body;
  const isBatch = Array.isArray(body);
  const items: any[] = isBatch ? body : [body];
  const partialMode = req.query.partial === 'true';
  const caller: IngestCaller = { companyId: req.apiKey!.companyId, channel: 'api', apiKeyId: req.apiKey!.id };
  const hash = requestHash(body);

  let key: string | null = null;
  try {
    key = normaliseIdempotencyKey(req.get('Idempotency-Key'), 'Idempotency-Key');
  } catch (error) {
    return res.status(400).json({ error: (error as KpiValidationError).message });
  }

  // A retried request: return the stored result (nothing is written again).
  if (key) {
    const replay = await findReplay(caller, key);
    if (replay) return sendReplay(res, replay, hash);
  }

  const reject = async (httpStatus: number, response: any, summaries: ItemSummary[], errors: Array<{ index: number | null; errors: string[] }>, teamIds: string[] = []) => {
    const id = await logRejected(caller, { key, hash }, { httpStatus, response, items: summaries, errors, teamIds, source: sourcesOf(summaries) });
    await afterIngestionRejected(caller.companyId, [...teamIds, ...summaries.map((s) => s.teamId).filter((t): t is string => !!t)]);
    return res.status(httpStatus).json({ ...response, status: 'rejected', ingestionId: id });
  };

  if (items.length === 0 || items.length > MAX_BATCH) {
    return reject(400, { error: `Send between 1 and ${MAX_BATCH} items` }, [], [{ index: null, errors: [`Send between 1 and ${MAX_BATCH} items`] }]);
  }

  // 1. Validate every item before writing anything.
  const errors: Array<{ index: number; errors: string[] }> = [];
  const prepared: Prepared[] = [];
  const summaries: ItemSummary[] = items.map((item, index) => ({
    index,
    teamId: item && typeof item.teamId === 'string' ? item.teamId : null,
    source: item && typeof item.source === 'string' ? item.source.trim().toLowerCase().slice(0, 50) : null,
    recordedAt: item && typeof item.recordedAt === 'string' ? item.recordedAt.slice(0, 40) : null,
    metrics: item && item.metrics && typeof item.metrics === 'object' && !Array.isArray(item.metrics) ? Object.keys(item.metrics).slice(0, 40) : [],
    status: 'error',
  }));
  items.forEach((item, index) => {
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new KpiValidationError(['item must be an object']);
      if (typeof item.teamId !== 'string' || !item.teamId) throw new KpiValidationError(['teamId is required']);
      const source = normaliseSource(item.source);
      if (source === 'manual') throw new KpiValidationError(['source "manual" is reserved for entries made in the app']);
      const extra = Object.keys(item).filter((k) => !ITEM_FIELDS.includes(k));
      if (extra.length) throw new KpiValidationError([`Unexpected field(s): ${extra.join(', ')} (metric values go inside "metrics")`]);
      prepared.push({
        index,
        teamId: item.teamId,
        source,
        recordedAt: parseRecordedAt(item.recordedAt),
        metrics: validateKpiValues(item.metrics) as Record<string, number>,
        idempotencyKey: normaliseIdempotencyKey(item.idempotencyKey),
        sourceRef: normaliseSourceRef(item.sourceRef),
      });
    } catch (error) {
      if (error instanceof KpiValidationError) {
        errors.push({ index, errors: error.errors });
        summaries[index].errors = error.errors;
      } else throw error;
    }
  });

  try {
    // 2. Tenant check: every team must belong to the key's company.
    const teamIds = Array.from(new Set(prepared.map((p) => p.teamId)));
    const owned = new Set(
      (await query<any>('SELECT id FROM teams WHERE company_id = ? AND id = ANY(?::text[])', [caller.companyId, teamIds])).map((r: any) => r.id)
    );
    const ownedTeamIds = teamIds.filter((t) => owned.has(t));
    for (const p of prepared) {
      if (!owned.has(p.teamId)) {
        const msg = `Team ${p.teamId} is not accessible with this API key`;
        errors.push({ index: p.index, errors: [msg] });
        summaries[p.index].errors = [msg];
      }
    }
    errors.sort((a, b) => a.index - b.index);
    const writable = prepared.filter((p) => owned.has(p.teamId));

    if (!partialMode && errors.length) {
      const forbidden = errors.find((e) => e.errors.some((m) => m.includes('is not accessible')));
      if (forbidden && errors.every((e) => e.errors.some((m) => m.includes('is not accessible')))) {
        return reject(403, { error: forbidden.errors[0] }, summaries, errors, ownedTeamIds);
      }
      return reject(400, { error: 'Validation failed', details: errors }, summaries, errors, ownedTeamIds);
    }
    if (writable.length === 0) {
      return reject(400, { error: 'No item could be written', details: errors }, summaries, errors, ownedTeamIds);
    }

    // 3. Write the items atomically, with the log row.
    const outcome = await runLogged(caller, { key, hash, source: Array.from(new Set(writable.map((p) => p.source))).join(', ') }, async (client, ingestionId) => {
      const results: Array<RecordResult & { index: number }> = [];
      for (const p of writable) {
        const r = await recordKpiValues(p.teamId, p.metrics, {
          source: p.source,
          recordedAt: p.recordedAt,
          actorId: `api_key:${req.apiKey!.id}`,
          client,
          notify: false,
          idempotencyKey: p.idempotencyKey,
          sourceRef: p.sourceRef,
          ingestionId,
        });
        results.push({ ...r, index: p.index });
        Object.assign(summaries[p.index], {
          status: r.duplicate ? 'duplicate' : 'written',
          snapshotDate: r.snapshotDate,
          recordedAt: r.recordedAt,
          qaScore: r.qaScore,
          errors: undefined,
        });
      }
      const status = errors.length ? 'partial' : 'accepted';
      const plain = results.map(({ index: _i, ...r }) => r);
      const response = isBatch
        ? { status, results: plain, items: summaries, ...(errors.length ? { errors } : {}) }
        : { status, result: plain[0], items: summaries };
      return {
        status,
        httpStatus: errors.length ? 207 : 200,
        response,
        items: summaries,
        errors,
        teamIds: ownedTeamIds,
        valueCount: results.filter((r) => !r.duplicate).reduce((n, r) => n + r.updated.length, 0),
        source: sourcesOf(summaries),
      };
    });

    if ('replay' in outcome) return sendReplay(res, outcome.replay, hash);

    const written = outcome.outcome.items.filter((i) => i.status === 'written');
    if (written.length) {
      notifyKpisUpdated(Array.from(new Set(written.flatMap((i) => i.metrics))), outcome.outcome.source ?? 'api');
    }
    await afterKpiWrite(caller.companyId, ownedTeamIds);
    res.status(outcome.outcome.httpStatus).json(outcome.outcome.response);
  } catch (error) {
    if (error instanceof KpiValidationError) {
      return reject(400, { error: error.message, details: error.errors }, summaries, [{ index: null, errors: error.errors }]);
    }
    console.error('KPI ingest error:', error);
    await logRejected(caller, { key, hash }, {
      httpStatus: 500, response: { error: 'Failed to ingest metrics' }, items: summaries,
      errors: [{ index: null, errors: ['Server error; nothing was written'] }], teamIds: [], source: sourcesOf(summaries),
    });
    res.status(500).json({ error: 'Failed to ingest metrics' });
  }
});

function sourcesOf(items: ItemSummary[]): string | null {
  const s = Array.from(new Set(items.map((i) => i.source).filter((x): x is string => !!x)));
  return s.length ? s.join(', ').slice(0, 200) : null;
}

export default router;
