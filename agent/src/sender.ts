/**
 * Delivery to the QE Navigator ingestion API (outbound HTTPS only):
 *   POST <url>/api/ingest/issues?format=json      {"issues": [...]}      ≤ 1,000 issues, ≤ 10 MB
 *   POST <url>/api/ingest/incidents?format=json   {"incidents": [...]}   ≤ 500 events, ≤ 5 MB
 * with Authorization: Bearer <QE_API_KEY>, gzip, an Idempotency-Key derived from the body (a retry
 * of the same batch is answered from QE Navigator's ingestion log, never written twice), the
 * User-Agent qe-agent/<version> (shown in the ingestion log), a client-side rate limit below the
 * API's 60 requests per minute per key, retries with jitter on 429 / 5xx / network errors.
 */
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { requestWithRetry, readCa, type HttpResponse, type RetryOptions } from './http';
import type { Config } from './config';
import { log, redact } from './log';
import { USER_AGENT } from './version';

export type Kind = 'issues' | 'incidents';

export const LIMITS: Record<Kind, { records: number; bytes: number }> = {
  // Below the API's limits (1,000 issues / 10 MB; 500 events / 5 MB), measured on the uncompressed JSON.
  issues: { records: 1000, bytes: 9 * 1024 * 1024 },
  incidents: { records: 500, bytes: 4.5 * 1024 * 1024 },
};

export interface Item { id: string; fp: string; record: Record<string, unknown> }
export interface Batch { kind: Kind; items: Item[]; json: string; idempotencyKey: string }

export const bodyOf = (kind: Kind, items: Item[]) => JSON.stringify({ [kind]: items.map((i) => i.record) });
export const idempotencyKey = (kind: Kind, json: string) => `qe-agent:${kind}:${createHash('sha256').update(json).digest('hex').slice(0, 48)}`;

export function batch(kind: Kind, items: Item[]): Batch {
  const json = bodyOf(kind, items);
  return { kind, items, json, idempotencyKey: idempotencyKey(kind, json) };
}

/** Split records into batches within the record and size limits. */
export function makeBatches(kind: Kind, items: Item[], limits = LIMITS[kind]): Batch[] {
  const out: Batch[] = [];
  let cur: Item[] = [];
  let size = 20;
  for (const it of items) {
    const n = Buffer.byteLength(JSON.stringify(it.record)) + 1;
    if (cur.length && (cur.length >= limits.records || size + n > limits.bytes)) {
      out.push(batch(kind, cur));
      cur = [];
      size = 20;
    }
    cur.push(it);
    size += n;
  }
  if (cur.length) out.push(batch(kind, cur));
  return out;
}

export class QeError extends Error {
  constructor(message: string, public status: number | null, public auth = false) { super(message); }
}

export interface PostResult { status: number; body: any; replayed: boolean }

export class QeClient {
  private last = 0;
  private ca: string | null;
  requests = 0;
  constructor(private cfg: Config, private apiKey: string | null, private retry: Partial<RetryOptions> = {}) {
    this.ca = readCa(cfg.qeNavigator.caFile ?? cfg.http.caFile);
  }

  url(kind: Kind, dryRun: boolean): string {
    return `${this.cfg.qeNavigator.url}/api/ingest/${kind}?format=json${dryRun ? '&dryRun=true' : ''}`;
  }

  /** The headers sent (the key shown as [redacted]): for the preview. */
  headers(b: Batch, dryRun: boolean, forDisplay = false): Record<string, string> {
    return {
      Authorization: `Bearer ${forDisplay ? '[redacted]' : this.apiKey ?? ''}`, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip',
      'User-Agent': USER_AGENT, ...(dryRun ? {} : { 'Idempotency-Key': b.idempotencyKey }),
    };
  }

  private async throttle(): Promise<void> {
    const gap = 60_000 / this.cfg.qeNavigator.requestsPerMinute;
    const wait = this.last + gap - Date.now();
    if (wait > 0) await (this.retry.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(wait);
    this.last = Date.now();
  }

  async post(b: Batch, dryRun: boolean): Promise<PostResult> {
    if (!this.apiKey) throw new QeError('QE Navigator API key missing', null, true);
    await this.throttle();
    this.requests++;
    const url = this.url(b.kind, dryRun);
    const t0 = Date.now();
    let res: HttpResponse;
    try {
      res = await requestWithRetry(
        { method: 'POST', url, headers: this.headers(b, dryRun), body: gzipSync(Buffer.from(b.json)), timeoutMs: this.cfg.qeNavigator.timeoutSeconds * 1000, ca: this.ca },
        { maxRetries: this.cfg.http.maxRetries, maxWaitMs: this.cfg.http.maxRetryWaitSeconds * 1000, ...this.retry },
      );
    } catch (e) {
      throw new QeError(`QE Navigator could not be reached (${redact((e as Error).message)})`, null);
    }
    let body: any = null;
    try { body = res.json(); } catch { body = { error: res.text().slice(0, 300) }; }
    log.debug('QE Navigator answered', { kind: b.kind, dryRun, records: b.items.length, status: res.status, ms: Date.now() - t0, replayed: res.headers['idempotent-replayed'] === 'true' });
    if (res.status === 401 || res.status === 403) {
      throw new QeError(`QE Navigator refused the request (HTTP ${res.status}): ${body?.error ?? 'no detail'}${res.status === 401 ? ' (check QE_API_KEY: Admin console → API keys)' : ''}`, res.status, true);
    }
    return { status: res.status, body, replayed: res.headers['idempotent-replayed'] === 'true' };
  }
}

export interface DeliveryOutcome {
  delivered: Item[];
  rejected: Array<{ item: Item; error: string }>;
  written: number;
  duplicate: number;
  requests: number;
}

/**
 * Send one batch; a 413 splits it, a 400 is bisected (within a request budget) so that one bad
 * record does not hold back the others. Throws QeError when delivery has to stop.
 */
export async function deliver(client: QeClient, b: Batch, budget: { extraRequests: number }, onDelivered: (items: Item[]) => void): Promise<DeliveryOutcome> {
  const out: DeliveryOutcome = { delivered: [], rejected: [], written: 0, duplicate: 0, requests: 0 };
  const run = async (x: Batch): Promise<void> => {
    out.requests++;
    const r = await client.post(x, false);
    if (r.status === 200 || r.status === 201) {
      const list: any[] = Array.isArray(r.body?.[x.kind === 'issues' ? 'issues' : 'events']) ? r.body[x.kind === 'issues' ? 'issues' : 'events'] : [];
      // A replayed answer (same Idempotency-Key, e.g. after a lost state file): nothing was written this time.
      if (r.replayed) out.duplicate += x.items.length;
      else for (const s of list) { if (s?.status === 'duplicate') out.duplicate++; else out.written++; }
      out.delivered.push(...x.items);
      onDelivered(x.items);
      return;
    }
    const msg = String(r.body?.error ?? `HTTP ${r.status}`);
    if ((r.status === 413 || r.status === 400) && x.items.length > 1 && (r.status === 413 || budget.extraRequests >= 2)) {
      if (r.status === 400) budget.extraRequests -= 2;
      const half = Math.ceil(x.items.length / 2);
      log.warn(r.status === 413 ? 'batch too large, splitting' : 'batch refused, isolating the record(s) at fault', { kind: x.kind, records: x.items.length, error: msg.slice(0, 200) });
      await run(batch(x.kind, x.items.slice(0, half)));
      await run(batch(x.kind, x.items.slice(half)));
      return;
    }
    if (r.status === 400 && x.items.length === 1) {
      out.rejected.push({ item: x.items[0], error: msg });
      log.warn('record refused by QE Navigator', { id: x.items[0].id, error: msg.slice(0, 300) });
      return;
    }
    throw new QeError(`QE Navigator refused a batch of ${x.items.length} ${x.kind} (HTTP ${r.status}): ${msg.slice(0, 300)}`, r.status);
  };
  await run(b);
  return out;
}
