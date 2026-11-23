/**
 * Request bodies of the raw ingestion endpoints: the raw body (curl --data-binary), multipart
 * uploads (curl -F report=@file) and gzip (Content-Encoding: gzip, or a gzipped file).
 *
 * Limits: MAX_UPLOAD_BYTES as received (default 20 MB; RAW_UPLOAD_MAX_MB) and
 * MAX_UNCOMPRESSED_BYTES after gunzip (default 100 MB), so a small gzip cannot expand without end.
 * On Netlify the platform's own request limit (about 6 MB) applies first: send gzip.
 */
import { gunzipSync } from 'zlib';
import type { Request } from 'express';

export class BodyError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const MAX_UPLOAD_BYTES = (Number(process.env.RAW_UPLOAD_MAX_MB) || 20) * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

/** The raw ingestion paths (the app-wide JSON / form parsers skip them; they read the body here). */
export const RAW_INGEST_PATH = /\/ingest\/(tests|coverage|pipelines|deployments|commits|incidents|issues|static-analysis|performance|test-management|pull-requests|calendar|discovery|exporter\/batch|exporter\/heartbeat|collector\/heartbeat)\/?$/;
/** File uploads (server/routes/uploads.ts): multipart bodies read here too. */
export const UPLOAD_BODY_PATH = /\/uploads\/(preview|commit)\/?$/;
export const isRawIngestPath = (path: string) => RAW_INGEST_PATH.test(path) || UPLOAD_BODY_PATH.test(path);

/** Read the whole body (or take the one serverless-http already holds), at most MAX_UPLOAD_BYTES. */
export async function readBody(req: Request, limit = MAX_UPLOAD_BYTES): Promise<Buffer> {
  const pre = (req as any).body;
  if (Buffer.isBuffer(pre)) {
    if (pre.length > limit) throw tooLarge(limit);
    return pre;
  }
  if (typeof pre === 'string') {
    const b = Buffer.from(pre);
    if (b.length > limit) throw tooLarge(limit);
    return b;
  }
  // An over-size body is read to its end (and discarded, up to 4 × the limit) before the 413 is
  // sent, so the client receives the answer instead of a broken connection.
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    let over = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        if (size > limit * 4) { done = true; reject(tooLarge(limit)); }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; if (over) reject(tooLarge(limit)); else resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

function tooLarge(limit: number) {
  return new BodyError(413, `Upload too large: at most ${Math.round(limit / 1024 / 1024)} MB per request (send the report gzipped: Content-Encoding: gzip or a .gz file)`);
}

export const isGzip = (b: Buffer) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

export function gunzipLimited(b: Buffer): Buffer {
  try {
    return gunzipSync(b, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
  } catch (e: any) {
    if (e?.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|Cannot create a Buffer larger/i.test(e?.message ?? '')) {
      throw new BodyError(413, `Report too large after decompression: at most ${MAX_UNCOMPRESSED_BYTES / 1024 / 1024} MB`);
    }
    throw new BodyError(400, 'The gzip data could not be decompressed');
  }
}

/** Decompress when the body or file is gzip (by Content-Encoding or by its magic bytes). */
export function maybeGunzip(b: Buffer, contentEncoding?: string | null): Buffer {
  const enc = (contentEncoding ?? '').toLowerCase().trim();
  if (enc && enc !== 'identity' && enc !== 'gzip' && enc !== 'x-gzip') throw new BodyError(415, `Content-Encoding "${enc}" is not supported (use gzip)`);
  return isGzip(b) ? gunzipLimited(b) : b;
}

export interface Multipart {
  fields: Record<string, string>;
  /** Every file part per field name (a field can repeat: -F report=@a.xml -F report=@b.xml). */
  files: Record<string, Array<{ filename: string; contentType: string | null; data: Buffer }>>;
}

/** Parse a buffered multipart/form-data body. */
export function parseMultipart(body: Buffer, contentType: string): Multipart {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) throw new BodyError(400, 'multipart/form-data without a boundary');
  const boundary = Buffer.from(`--${(m[1] ?? m[2]).trim()}`);
  const out: Multipart = { fields: {}, files: {} };
  let pos = body.indexOf(boundary);
  if (pos < 0) throw new BodyError(400, 'Malformed multipart body: boundary not found');
  let parts = 0;
  while (pos >= 0) {
    pos += boundary.length;
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break; // closing "--"
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;
    const headerEnd = body.indexOf('\r\n\r\n', pos);
    if (headerEnd < 0) throw new BodyError(400, 'Malformed multipart body: part headers not terminated');
    const headers = body.subarray(pos, headerEnd).toString('utf8');
    const next = body.indexOf(boundary, headerEnd + 4);
    if (next < 0) throw new BodyError(400, 'Malformed multipart body: closing boundary missing');
    let end = next;
    if (body[end - 2] === 0x0d && body[end - 1] === 0x0a) end -= 2;
    const data = body.subarray(headerEnd + 4, end);
    const disp = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headers);
    if (disp) {
      const name = /\bname="([^"]*)"/i.exec(disp[1])?.[1];
      const filename = /\bfilename="([^"]*)"/i.exec(disp[1])?.[1];
      const ct = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? null;
      if (name) {
        const key = name.replace(/\[\]$/, '');
        if (filename !== undefined) (out.files[key] ??= []).push({ filename, contentType: ct, data });
        else out.fields[key] = data.toString('utf8');
      }
    }
    if (++parts > 1000) throw new BodyError(400, 'Too many multipart parts (at most 1000)');
    pos = next;
  }
  return out;
}
