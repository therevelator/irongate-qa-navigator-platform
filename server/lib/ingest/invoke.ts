/**
 * Run one ingestion request through an existing ingestion handler in-process (same parsing, checks, storage,
 * calculation and ingestion log as a request over HTTP). Used by file uploads (server/routes/uploads.ts) and the
 * Exporter's JSON envelope (server/routes/ingestExporter.ts), so neither has a second copy of the ingestion logic.
 * The caller (who is writing, to which teams) is given explicitly; the body is a Buffer the handler reads with the
 * same size limits as over HTTP.
 */
import type { IngestCaller } from '../ingestionLog';

export type IngestHandler = (req: any, res: any) => Promise<unknown>;

export interface InvokeRequest {
  caller: IngestCaller;
  body: Buffer;
  contentType: string;
  query: Record<string, string>;
  idempotencyKey?: string | null;
}

export async function invokeHandler(handler: IngestHandler, r: InvokeRequest): Promise<{ status: number; body: any; replayed: boolean }> {
  const headers: Record<string, string> = { 'content-type': r.contentType };
  if (r.idempotencyKey) headers['idempotency-key'] = r.idempotencyKey;
  const req: any = {
    ingestCaller: r.caller, apiKey: { companyId: r.caller.companyId, id: r.caller.apiKeyId ?? null },
    headers, query: { ...r.query }, body: r.body,
    get: (name: string) => headers[String(name).toLowerCase()],
    on: () => req,
  };
  let status = 200;
  let body: any = null;
  let replayed = false;
  const res: any = {
    status(n: number) { status = n; return res; },
    json(o: unknown) { body = o; return res; },
    set(name: string, value: string) { if (/^idempotent-replayed$/i.test(name) && value === 'true') replayed = true; return res; },
    setHeader() { return res; },
  };
  await handler(req, res);
  return { status, body, replayed };
}
