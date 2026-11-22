/**
 * Ingestion log + idempotency (table ingestion_log, migration 20261120000000).
 *
 * Every KPI write request (POST /api/ingest/kpis, POST /api/metrics/manual) is recorded once:
 * status 'accepted' (every item written or already written), 'partial' (some items rejected,
 * the others written) or 'rejected' (nothing written), with a per-item summary, the errors and
 * the response that was returned.
 *
 * Idempotency-Key header: the first request with a key (per company and caller: API key or user)
 * stores its result; a retry with the same key and the same body returns that stored result
 * (header Idempotent-Replayed: true) without writing again; the same key with a different body
 * is refused (422). Two concurrent requests with the same key serialise on the unique index: the
 * second waits for the first and then replays its result. Rejected requests are not bound to the
 * key, so a corrected retry is processed.
 */
import { createHash } from 'crypto';
import type pg from 'pg';
import type { Response } from 'express';
import { query, queryOne, toPgPlaceholders } from '../../src/lib/db';
import { withTransaction } from './kpiIngest';

export type IngestStatus = 'accepted' | 'partial' | 'rejected';

export interface IngestCaller {
  companyId: string;
  /** api: an API key; manual: Manual metrics; upload: Admin console → Upload files (a signed-in person). */
  channel: 'api' | 'manual' | 'upload';
  apiKeyId?: string | null;
  actorId?: string | null;
  /** Upload preview: a dry run that writes nothing at all (not even an ingestion log row). */
  preview?: boolean;
  /** Upload: the teams the person may write to; any other team is refused (403). */
  teamScope?: ReadonlySet<string> | null;
}

export interface ItemSummary {
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

export interface LoggedOutcome {
  status: IngestStatus;
  httpStatus: number;
  response: any;
  items: ItemSummary[];
  errors: Array<{ index: number | null; errors: string[] }>;
  teamIds: string[];
  valueCount: number;
  source: string | null;
}

/** sha256 of the request body (JSON), to tell a retry from a different request with the same key. */
export function requestHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

const callerKey = (c: IngestCaller) => c.apiKeyId ?? c.actorId ?? '';

export interface Replay {
  httpStatus: number;
  response: any;
  requestHash: string | null;
}

/** The stored result of an earlier request with this key (not rejected), if any. */
export async function findReplay(caller: IngestCaller, key: string): Promise<Replay | null> {
  const row = await queryOne<any>(
    `SELECT http_status, response, request_hash FROM ingestion_log
      WHERE company_id = ? AND COALESCE(api_key_id, actor_id, '') = ? AND idempotency_key = ? AND status <> 'rejected'
      ORDER BY received_at DESC LIMIT 1`,
    [caller.companyId, callerKey(caller), key]
  );
  return row ? { httpStatus: Number(row.http_status) || 200, response: row.response, requestHash: row.request_hash ?? null } : null;
}

async function departmentsOf(teamIds: string[], companyId: string, client?: pg.PoolClient): Promise<string[]> {
  if (!teamIds.length) return [];
  const sql = 'SELECT DISTINCT department_id FROM teams WHERE company_id = ? AND id = ANY(?::text[]) AND department_id IS NOT NULL';
  const rows = client ? (await client.query(toPgPlaceholders(sql), [companyId, teamIds])).rows : await query<any>(sql, [companyId, teamIds]);
  return rows.map((r: any) => r.department_id);
}

const KEY_LIMIT = (s: string | null) => (s ? s.slice(0, 200) : null);

/** Record a request that wrote nothing (validation, scope or server error). */
export async function logRejected(
  caller: IngestCaller,
  meta: { key: string | null; hash: string | null },
  outcome: Omit<LoggedOutcome, 'status' | 'valueCount'>
): Promise<string | null> {
  try {
    const departmentIds = await departmentsOf(outcome.teamIds, caller.companyId);
    const row = await queryOne<any>(
      `INSERT INTO ingestion_log (company_id, api_key_id, actor_id, channel, source, status, items, errors, idempotency_key, request_hash,
                                  http_status, response, team_ids, department_ids, item_count, value_count)
       VALUES (?, ?, ?, ?, ?, 'rejected', ?::jsonb, ?::jsonb, ?, ?, ?, ?::jsonb, ?::varchar[], ?::varchar[], ?, 0) RETURNING id`,
      [caller.companyId, caller.apiKeyId ?? null, caller.actorId ?? null, caller.channel, outcome.source, JSON.stringify(outcome.items),
        JSON.stringify(outcome.errors), KEY_LIMIT(meta.key), meta.hash, outcome.httpStatus, JSON.stringify(outcome.response),
        outcome.teamIds, departmentIds, outcome.items.length]
    );
    return row?.id ?? null;
  } catch (e) {
    console.error('ingestion_log write failed:', e);
    return null;
  }
}

export class ReplayInstead extends Error {}

/**
 * Run a write inside one transaction with its log row. `write` receives the client and the
 * ingestion id (stored on every metric_values row) and returns the outcome. When another request
 * already stored a result for the same key, returns { replay } instead (nothing written).
 */
export async function runLogged(
  caller: IngestCaller,
  meta: { key: string | null; hash: string | null; source: string | null },
  write: (client: pg.PoolClient, ingestionId: string) => Promise<LoggedOutcome>
): Promise<{ outcome: LoggedOutcome; ingestionId: string } | { replay: Replay }> {
  try {
    return await withTransaction(async (client) => {
      const ins = await client.query(
        toPgPlaceholders(
          `INSERT INTO ingestion_log (company_id, api_key_id, actor_id, channel, source, status, idempotency_key, request_hash, http_status)
           VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?, 0)
           ON CONFLICT DO NOTHING RETURNING id`
        ),
        [caller.companyId, caller.apiKeyId ?? null, caller.actorId ?? null, caller.channel, meta.source, KEY_LIMIT(meta.key), meta.hash]
      );
      if (!ins.rows.length) throw new ReplayInstead();
      const ingestionId: string = ins.rows[0].id;
      const outcome = await write(client, ingestionId);
      const departmentIds = await departmentsOf(outcome.teamIds, caller.companyId, client);
      await client.query(
        toPgPlaceholders(
          `UPDATE ingestion_log SET status = ?, source = ?, items = ?::jsonb, errors = ?::jsonb, http_status = ?, response = ?::jsonb,
                  team_ids = ?::varchar[], department_ids = ?::varchar[], item_count = ?, value_count = ?
            WHERE id = ?`
        ),
        [outcome.status, outcome.source, JSON.stringify(outcome.items), JSON.stringify(outcome.errors), outcome.httpStatus,
          JSON.stringify({ ...outcome.response, ingestionId }), outcome.teamIds, departmentIds, outcome.items.length, outcome.valueCount, ingestionId]
      );
      return { outcome: { ...outcome, response: { ...outcome.response, ingestionId } }, ingestionId };
    });
  } catch (e) {
    if (e instanceof ReplayInstead && meta.key) {
      const replay = await findReplay(caller, meta.key);
      if (replay) return { replay };
    }
    throw e;
  }
}

/** Send a stored result again (header Idempotent-Replayed: true); the same key with a different body is refused (422). */
export function sendReplay(res: Response, replay: Replay, hash: string) {
  if (replay.requestHash && replay.requestHash !== hash) {
    return res.status(422).json({ error: 'This Idempotency-Key was already used with a different request' });
  }
  res.set('Idempotent-Replayed', 'true');
  return res.status(replay.httpStatus).json(replay.response);
}
