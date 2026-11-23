/**
 * Delivery to QE Navigator (outbound HTTPS only), as JSON envelopes:
 *
 *   POST <url>/api/ingest/exporter/batch   { companyId, departmentId, teamId, source, kind, items: [...] }
 *   GET  <url>/api/ingest/exporter/context the key's company, its departments and teams (check, setup page)
 *   POST <url>/api/ingest/exporter/heartbeat
 *
 * with Authorization: Bearer <QE_API_KEY> (a key the company admin created in QE Navigator), gzip, an
 * Idempotency-Key derived from the body (a retried batch is answered from QE Navigator's log, never written twice),
 * the User-Agent qe-exporter/<version> and X-Exporter-Host (a short name of this machine), a client-side rate limit
 * below the API's 60 requests per minute per key, retries with jitter on 429 / 5xx / network errors. QE Navigator
 * checks the three ids against the key: a batch for an id that is not the key's company, department or team is
 * refused with 403 and nothing is written.
 */
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { requestWithRetry, readCa, type HttpResponse, type RetryOptions } from './http';
import type { Config } from './config';
import { log, redact } from './log';
import { USER_AGENT } from './version';

export type EnvelopeKind = 'test-report' | 'coverage' | 'pipeline-runs' | 'deployments' | 'commits' | 'incidents' | 'issues' | 'sarif' | 'kpis';

export interface Envelope { companyId: string; departmentId: string; teamId: string; source: string; kind: EnvelopeKind; items: Array<Record<string, unknown>> }

/**
 * Items and uncompressed bytes per envelope, below what QE Navigator takes for each kind, and small enough that one
 * request makes QE Navigator recalculate only a few weeks (items are sent oldest first): a long backfill becomes many
 * short requests rather than a few long ones. QE Navigator stores each report file of a batch in its own transaction
 * (about 9 database round trips each) and may answer within 10 seconds only (a hosted plan's limit), so file kinds
 * (test reports, coverage, SARIF) and KPI value sets go a few per envelope; event kinds are stored with multi-row
 * statements and are not limited by that (earlier releases sent up to 25 files and 100 KPI sets per envelope).
 */
export const LIMITS: Record<EnvelopeKind, { items: number; bytes: number }> = {
  'test-report': { items: 5, bytes: 15 * 1024 * 1024 },
  coverage: { items: 5, bytes: 15 * 1024 * 1024 },
  sarif: { items: 5, bytes: 15 * 1024 * 1024 },
  'pipeline-runs': { items: 100, bytes: 900 * 1024 },
  deployments: { items: 100, bytes: 4.5 * 1024 * 1024 },
  commits: { items: 200, bytes: 4.5 * 1024 * 1024 },
  incidents: { items: 50, bytes: 4.5 * 1024 * 1024 },
  issues: { items: 25, bytes: 9 * 1024 * 1024 },
  kpis: { items: 10, bytes: 1024 * 1024 },
};

export interface Part { id: string; fp: string; item: Record<string, unknown> }
export interface Batch { envelope: Envelope; parts: Part[]; json: string; idempotencyKey: string }

export const keyOf = (json: string) => `qe-exporter:${createHash('sha256').update(json).digest('hex').slice(0, 48)}`;

export function batch(base: Omit<Envelope, 'items'>, parts: Part[]): Batch {
  const envelope: Envelope = { ...base, items: parts.map((p) => p.item) };
  const json = JSON.stringify(envelope);
  return { envelope, parts, json, idempotencyKey: keyOf(json) };
}

/** Split the parts of one team and kind into envelopes within the item and size limits. */
export function makeBatches(base: Omit<Envelope, 'items'>, parts: Part[], limits = LIMITS[base.kind]): Batch[] {
  const out: Batch[] = [];
  let cur: Part[] = [];
  let size = 300;
  for (const p of parts) {
    const n = Buffer.byteLength(JSON.stringify(p.item)) + 1;
    if (cur.length && (cur.length >= limits.items || size + n > limits.bytes)) { out.push(batch(base, cur)); cur = []; size = 300; }
    cur.push(p);
    size += n;
  }
  if (cur.length) out.push(batch(base, cur));
  return out;
}

export class QeError extends Error {
  constructor(message: string, public status: number | null, public auth = false) { super(message); }
}

export interface PostResult { status: number; body: any; replayed: boolean }

export interface ExporterContext { company: { id: string; name: string | null }; apiKey?: { name: string }; departments: Array<{ id: string; name: string; teams: Array<{ id: string; name: string }> }> }

export class QeClient {
  private last = 0;
  private ca: string | null;
  readonly host: string;
  requests = 0;
  constructor(private cfg: Pick<Config, 'qeNavigator' | 'http' | 'hostLabel'>, private apiKey: string | null, private retry: Partial<RetryOptions> = {}) {
    this.ca = readCa(cfg.qeNavigator.caFile ?? cfg.http.caFile);
    this.host = (cfg.hostLabel ?? hostname()).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100) || 'exporter';
  }

  /** The URL of an endpoint (for the preview). */
  endpoint(path: string, query: Record<string, string> = {}): string {
    const q = new URLSearchParams(query).toString();
    return `${this.cfg.qeNavigator.url}${path}${q ? `?${q}` : ''}`;
  }

  /** The headers of a batch as the preview shows them (the key as [redacted]). */
  displayHeaders(b: Batch, dryRun: boolean): Record<string, string> {
    return {
      Authorization: 'Bearer [redacted]', 'Content-Type': 'application/gzip', 'Content-Encoding': 'gzip', 'User-Agent': USER_AGENT, 'X-Exporter-Host': this.host,
      ...(dryRun ? {} : { 'Idempotency-Key': b.idempotencyKey }),
    };
  }

  private async throttle(): Promise<void> {
    const gap = 60_000 / this.cfg.qeNavigator.requestsPerMinute;
    const wait = this.last + gap - Date.now();
    if (wait > 0) await (this.retry.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(wait);
    this.last = Date.now();
  }

  private async request(method: 'GET' | 'POST', path: string, query: Record<string, string>, body: string | null, idempotencyKey: string | null): Promise<PostResult> {
    if (!this.apiKey) throw new QeError('QE Navigator API key missing', null, true);
    await this.throttle();
    this.requests++;
    const url = this.endpoint(path, query);
    const t0 = Date.now();
    let res: HttpResponse;
    try {
      res = await requestWithRetry(
        {
          method, url, ...(body !== null ? { body: gzipSync(Buffer.from(body)) } : {}), timeoutMs: this.cfg.qeNavigator.timeoutSeconds * 1000, ca: this.ca,
          headers: {
            Authorization: `Bearer ${this.apiKey}`, 'User-Agent': USER_AGENT, 'X-Exporter-Host': this.host,
            ...(body !== null ? { 'Content-Type': 'application/gzip', 'Content-Encoding': 'gzip' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
        },
        { maxRetries: this.cfg.http.maxRetries, maxWaitMs: this.cfg.http.maxRetryWaitSeconds * 1000, ...this.retry },
      );
    } catch (e) {
      throw new QeError(`QE Navigator could not be reached (${redact((e as Error).message)})`, null);
    }
    let parsed: any = null;
    try { parsed = res.json(); } catch { parsed = { error: res.text().slice(0, 300) }; }
    log.debug('QE Navigator answered', { path, status: res.status, ms: Date.now() - t0, replayed: res.headers['idempotent-replayed'] === 'true' });
    if (res.status === 401) throw new QeError(`QE Navigator refused the API key (HTTP 401): ${parsed?.error ?? 'no detail'} (check QE_API_KEY: Admin console → API keys)`, 401, true);
    return { status: res.status, body: parsed, replayed: res.headers['idempotent-replayed'] === 'true' };
  }

  /** POST one envelope (dryRun: QE Navigator checks everything and writes nothing). */
  async post(b: Batch, dryRun: boolean): Promise<PostResult> {
    return this.request('POST', '/api/ingest/exporter/batch', dryRun ? { dryRun: 'true' } : {}, b.json, dryRun ? null : b.idempotencyKey);
  }

  async heartbeat(body: Record<string, unknown>): Promise<PostResult> {
    return this.request('POST', '/api/ingest/exporter/heartbeat', {}, JSON.stringify(body), null);
  }

  /** The key's company, its departments and active teams. */
  async context(): Promise<ExporterContext> {
    const r = await this.request('GET', '/api/ingest/exporter/context', {}, null, null);
    if (r.status !== 200) throw new QeError(`QE Navigator did not return the context (HTTP ${r.status}): ${r.body?.error ?? ''}`, r.status, r.status === 403);
    return r.body as ExporterContext;
  }
}

export interface DeliveryOutcome { delivered: Part[]; rejected: Array<{ part: Part; error: string }>; written: number; duplicate: number; requests: number }

/**
 * Send one envelope; a 413 splits it, a 400 / 415 is bisected (within a request budget) so that one bad item does
 * not hold back the others. A 403 (an id that is not the key's) stops delivery: the mapping must be fixed.
 */
export async function deliver(client: QeClient, b: Batch, budget: { extraRequests: number }, onDelivered: (parts: Part[]) => void): Promise<DeliveryOutcome> {
  const out: DeliveryOutcome = { delivered: [], rejected: [], written: 0, duplicate: 0, requests: 0 };
  const base = { companyId: b.envelope.companyId, departmentId: b.envelope.departmentId, teamId: b.envelope.teamId, source: b.envelope.source, kind: b.envelope.kind };
  const run = async (x: Batch): Promise<void> => {
    out.requests++;
    const r = await client.post(x, false);
    if (r.status === 200 || r.status === 201 || r.status === 207) {
      if (r.replayed) out.duplicate += x.parts.length;
      else { out.written += Number(r.body?.written ?? 0); out.duplicate += Number(r.body?.duplicate ?? 0); }
      // A report kind answers per item; an item the server refused while the others were written is not marked delivered.
      const refusedIdx = new Set<number>((r.body?.items ?? []).filter((i: any) => i?.status === 'rejected' && typeof i.index === 'number').map((i: any) => i.index));
      const ok = x.parts.filter((_, i) => !refusedIdx.has(i));
      for (const i of refusedIdx) if (x.parts[i]) out.rejected.push({ part: x.parts[i], error: String(r.body?.items?.find((it: any) => it.index === i)?.result?.error ?? 'refused') });
      out.delivered.push(...ok);
      onDelivered(ok);
      return;
    }
    const msg = String(r.body?.error ?? `HTTP ${r.status}`);
    if (r.status === 403) throw new QeError(`QE Navigator refused the batch for team ${x.envelope.teamId} (HTTP 403): ${msg}. Check qeNavigator.companyId, the team's department in "teams" and the source mapping.`, 403, true);
    if ((r.status === 413 || r.status === 400 || r.status === 415) && x.parts.length > 1 && (r.status === 413 || budget.extraRequests >= 2)) {
      if (r.status !== 413) budget.extraRequests -= 2;
      const half = Math.ceil(x.parts.length / 2);
      log.warn(r.status === 413 ? 'batch too large, splitting' : 'batch refused, isolating the item(s) at fault', { kind: x.envelope.kind, items: x.parts.length, error: msg.slice(0, 200) });
      await run(batch(base, x.parts.slice(0, half)));
      await run(batch(base, x.parts.slice(half)));
      return;
    }
    if ((r.status === 400 || r.status === 415 || r.status === 413) && x.parts.length === 1) {
      out.rejected.push({ part: x.parts[0], error: msg });
      log.warn('item refused by QE Navigator', { id: x.parts[0].id.slice(0, 120), error: msg.slice(0, 300) });
      return;
    }
    throw new QeError(`QE Navigator refused a batch of ${x.parts.length} ${x.envelope.kind} items (HTTP ${r.status}): ${msg.slice(0, 300)}`, r.status);
  };
  await run(b);
  return out;
}
