import express from 'express';
import { queryOne } from '../../src/lib/db';
import { authenticateApiKey, ApiKeyRequest } from '../middleware/apiKey';
import { ingestLimiter } from '../middleware/rateLimit';
import {
  KpiValidationError,
  normaliseSource,
  notifyKpisUpdated,
  parseRecordedAt,
  recordKpiValues,
  RecordResult,
  validateKpiValues,
  withTransaction,
} from '../lib/kpiIngest';

const router = express.Router();

const MAX_BATCH = 100;

/**
 * POST /api/ingest/kpis — machine ingestion of team KPIs (Jenkins, Jira, SonarQube, …).
 * Auth: Authorization: Bearer igk_… (per-company key, see Admin console → API keys).
 * Body: { teamId, source, recordedAt?, metrics: { column: number, … } } or an array of those.
 * All items are validated first; the batch is written in one transaction (all or nothing).
 */
router.post('/kpis', ingestLimiter, authenticateApiKey, async (req: ApiKeyRequest, res) => {
  const body = req.body;
  const items: any[] = Array.isArray(body) ? body : [body];
  if (items.length === 0 || items.length > MAX_BATCH) {
    return res.status(400).json({ error: `Send between 1 and ${MAX_BATCH} items` });
  }

  // 1. Validate every item before writing anything.
  const errors: Array<{ index: number; errors: string[] }> = [];
  const prepared: Array<{ teamId: string; source: string; recordedAt: Date; metrics: Record<string, number> }> = [];
  items.forEach((item, index) => {
    try {
      if (!item || typeof item !== 'object') throw new KpiValidationError(['item must be an object']);
      if (typeof item.teamId !== 'string' || !item.teamId) throw new KpiValidationError(['teamId is required']);
      const source = normaliseSource(item.source);
      if (source === 'manual') throw new KpiValidationError(['source "manual" is reserved for entries made in the app']);
      const extra = Object.keys(item).filter((k) => !['teamId', 'source', 'recordedAt', 'metrics'].includes(k));
      if (extra.length) throw new KpiValidationError([`Unexpected field(s): ${extra.join(', ')} (metric values go inside "metrics")`]);
      prepared.push({
        teamId: item.teamId,
        source,
        recordedAt: parseRecordedAt(item.recordedAt),
        metrics: validateKpiValues(item.metrics),
      });
    } catch (error) {
      if (error instanceof KpiValidationError) errors.push({ index, errors: error.errors });
      else throw error;
    }
  });
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  try {
    // 2. Tenant check: every team must belong to the key's company.
    for (const p of prepared) {
      const team = await queryOne<any>('SELECT id FROM teams WHERE id = ? AND company_id = ?', [p.teamId, req.apiKey!.companyId]);
      if (!team) {
        return res.status(403).json({ error: `Team ${p.teamId} is not accessible with this API key` });
      }
    }

    // 3. Write all items atomically.
    const results: RecordResult[] = await withTransaction(async (client) => {
      const out: RecordResult[] = [];
      for (const p of prepared) {
        out.push(await recordKpiValues(p.teamId, p.metrics, {
          source: p.source,
          recordedAt: p.recordedAt,
          actorId: `api_key:${req.apiKey!.id}`,
          client,
          notify: false,
        }));
      }
      return out;
    });

    notifyKpisUpdated(
      Array.from(new Set(results.flatMap((r) => r.updated))),
      Array.from(new Set(prepared.map((p) => p.source))).join(', ')
    );

    res.json({ results: Array.isArray(body) ? results : undefined, result: Array.isArray(body) ? undefined : results[0] });
  } catch (error) {
    if (error instanceof KpiValidationError) {
      return res.status(400).json({ error: error.message, details: error.errors });
    }
    console.error('KPI ingest error:', error);
    res.status(500).json({ error: 'Failed to ingest metrics' });
  }
});

export default router;
