/**
 * Outbound HTTP(S) on Node's own http / https / tls modules (no dependency): timeouts on every
 * request, an HTTPS proxy (HTTPS_PROXY / HTTP_PROXY / NO_PROXY, CONNECT tunnel), extra CA bundles
 * for self-signed or internal CAs (added to the system roots; certificate verification is never
 * turned off), gzip responses, a response size cap, and retries with exponential backoff, full
 * jitter and Retry-After for 429 / 502 / 503 / 504 and network errors.
 */
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';
import zlib from 'node:zlib';
import { readFileSync } from 'node:fs';
import { log, addSecret, redact } from './log';
import { USER_AGENT } from './version';

export interface HttpResponse { status: number; headers: http.IncomingHttpHeaders; body: Buffer; text(): string; json<T = any>(): T }

export interface RequestOptions {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
  timeoutMs?: number;
  /** Extra CA certificates (PEM), added to the system roots. */
  ca?: string | null;
  maxResponseBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export class HttpError extends Error {
  constructor(message: string, public status: number | null, public body?: string, public code?: string) { super(message); }
}

const caCache = new Map<string, string>();
/** The PEM bundle of a CA file (cached); throws with a clear message when unreadable. */
export function readCa(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!caCache.has(path)) {
    let pem: string;
    try { pem = readFileSync(path, 'utf8'); } catch (e) { throw new HttpError(`Cannot read the CA bundle ${path}: ${(e as Error).message}`, null, undefined, 'CA_FILE'); }
    if (!/-----BEGIN CERTIFICATE-----/.test(pem)) throw new HttpError(`${path} is not a PEM certificate bundle`, null, undefined, 'CA_FILE');
    caCache.set(path, pem);
  }
  return caCache.get(path)!;
}

/** Whether a host is excluded from the proxy by NO_PROXY (comma list; *, host, .domain, *.domain, host:port, IPv4 CIDR). */
export function noProxy(host: string, port: number, env: NodeJS.ProcessEnv = process.env): boolean {
  const list = (env.NO_PROXY ?? env.no_proxy ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  const ipv4 = (s: string) => { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s); return m ? m.slice(1).reduce((n, x) => n * 256 + Number(x), 0) : null; };
  const hostIp = ipv4(h);
  for (const e of list) {
    if (e === '*') return true;
    const cidr = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(e);
    if (cidr) {
      const base = ipv4(cidr[1]);
      const bits = Number(cidr[2]);
      if (hostIp !== null && base !== null && bits <= 32 && Math.floor(hostIp / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits))) return true;
      continue;
    }
    const [eh, ep] = e.startsWith('[') ? [e.slice(1, e.indexOf(']')), e.split(']:')[1]] : e.split(':');
    if (ep && Number(ep) !== port) continue;
    const d = eh.replace(/^\*?\./, '');
    if (h === d || h.endsWith('.' + d)) return true;
  }
  return false;
}

export function proxyFor(target: URL, env: NodeJS.ProcessEnv = process.env): URL | null {
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  if (noProxy(target.hostname, port, env)) return null;
  const raw = target.protocol === 'https:' ? env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy : env.HTTP_PROXY ?? env.http_proxy;
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (u.password) addSecret(decodeURIComponent(u.password));
    return u;
  } catch {
    throw new HttpError(`The proxy setting "${redact(raw)}" is not a URL`, null, undefined, 'PROXY');
  }
}

const proxyAuth = (p: URL) => (p.username ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`).toString('base64') } : {});

/** A TLS socket to target through an HTTP CONNECT tunnel of the proxy. */
function tunnel(proxy: URL, target: URL, ca: string | null, timeoutMs: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const port = Number(target.port || 443);
    const mod = proxy.protocol === 'https:' ? https : http;
    const req = mod.request({
      host: proxy.hostname, port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)), method: 'CONNECT', path: `${target.hostname}:${port}`,
      headers: { Host: `${target.hostname}:${port}`, ...proxyAuth(proxy) }, timeout: timeoutMs,
    });
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new HttpError(`The proxy refused the tunnel to ${target.hostname}:${port} (HTTP ${res.statusCode})`, null, undefined, 'PROXY'));
        return;
      }
      const s = tls.connect({ socket, servername: net.isIP(target.hostname) ? undefined : target.hostname, ...(ca ? { ca: [...tls.rootCertificates, ca] } : {}), minVersion: 'TLSv1.2' });
      s.once('secureConnect', () => resolve(s));
      s.once('error', reject);
    });
    req.once('timeout', () => req.destroy(new HttpError(`Timed out connecting to the proxy ${proxy.hostname}`, null, undefined, 'ETIMEDOUT')));
    req.once('error', reject);
    req.end();
  });
}

/** One request, no retries. Throws HttpError on network errors and timeouts (status null). */
export async function request(o: RequestOptions): Promise<HttpResponse> {
  const target = new URL(o.url);
  const timeoutMs = o.timeoutMs ?? 30_000;
  const maxBytes = o.maxResponseBytes ?? 64 * 1024 * 1024;
  const body = o.body === undefined ? undefined : Buffer.isBuffer(o.body) ? o.body : Buffer.from(o.body);
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Encoding': 'gzip', ...(o.headers ?? {}) };
  if (body) headers['Content-Length'] = String(body.length);
  const proxy = proxyFor(target, o.env);
  const isHttps = target.protocol === 'https:';
  let socket: tls.TLSSocket | undefined;
  if (proxy && isHttps) socket = await tunnel(proxy, target, o.ca ?? null, timeoutMs);

  return new Promise<HttpResponse>((resolve, reject) => {
    const opts: https.RequestOptions = {
      method: o.method ?? 'GET', timeout: timeoutMs,
      ...(proxy && !isHttps
        ? { host: proxy.hostname, port: Number(proxy.port || 80), path: target.href, headers: { ...headers, Host: target.host, ...proxyAuth(proxy) } }
        : { host: target.hostname, port: Number(target.port || (isHttps ? 443 : 80)), path: target.pathname + target.search, headers }),
      ...(isHttps ? { servername: net.isIP(target.hostname) ? undefined : target.hostname, minVersion: 'TLSv1.2' as const, ...(o.ca ? { ca: [...tls.rootCertificates, o.ca] } : {}) } : {}),
      ...(socket ? { createConnection: () => socket, agent: false } : { agent: false }),
    };
    const req = (isHttps ? https : http).request(opts, (res) => {
      const chunks: Buffer[] = [];
      let n = 0;
      const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
      const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : res;
      stream.on('data', (c: Buffer) => {
        n += c.length;
        if (n > maxBytes) { req.destroy(new HttpError(`Response from ${target.host} larger than ${maxBytes} bytes`, res.statusCode ?? null, undefined, 'TOO_LARGE')); return; }
        chunks.push(c);
      });
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode ?? 0, headers: res.headers, body: buf,
          text: () => buf.toString('utf8'),
          json: () => {
            try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(`${target.host} answered HTTP ${res.statusCode} with a body that is not JSON`, res.statusCode ?? null, buf.toString('utf8').slice(0, 300), 'NOT_JSON'); }
          },
        });
      });
      stream.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new HttpError(`Timed out after ${Math.round(timeoutMs / 1000)} s: ${o.method ?? 'GET'} ${target.host}${target.pathname}`, null, undefined, 'ETIMEDOUT')));
    req.on('error', (e: NodeJS.ErrnoException) => reject(e instanceof HttpError ? e : new HttpError(`${o.method ?? 'GET'} ${target.host}${target.pathname}: ${e.message}`, null, undefined, e.code)));
    if (body) req.write(body);
    req.end();
  });
}

export interface RetryOptions {
  maxRetries?: number;
  /** Cap on one wait (Retry-After included), ms. */
  maxWaitMs?: number;
  baseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Extra retry decision for 200/400 bodies that mean "rate limited" (e.g. Linear's RATELIMITED). */
  retryable?: (res: HttpResponse) => boolean;
  random?: () => number;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The wait a 429 / 503 asks for: Retry-After (seconds or a date), else RateLimit-Reset / X-RateLimit-Reset. */
export function retryAfterMs(h: http.IncomingHttpHeaders, now = Date.now()): number | null {
  const ra = h['retry-after'];
  if (typeof ra === 'string' && ra.trim()) {
    if (/^\d+(\.\d+)?$/.test(ra.trim())) return Math.round(Number(ra) * 1000);
    const t = Date.parse(ra);
    if (!Number.isNaN(t)) return Math.max(0, t - now);
  }
  for (const k of ['ratelimit-reset', 'x-ratelimit-reset']) {
    const v = h[k];
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
      const n = Number(v);
      // Epoch seconds (or ms) when large, else seconds to wait.
      if (n > 1e12) return Math.max(0, n - now);
      if (n > 1e9) return Math.max(0, n * 1000 - now);
      return n * 1000;
    }
  }
  return null;
}

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNABORTED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_SOCKET']);

/** request() with retries; returns the last response (also a non-2xx one) or throws the last network error. */
export async function requestWithRetry(o: RequestOptions, r: RetryOptions = {}): Promise<HttpResponse> {
  const max = r.maxRetries ?? 5;
  const base = r.baseMs ?? 1000;
  const cap = r.maxWaitMs ?? 120_000;
  const wait = r.sleep ?? sleep;
  const rnd = r.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    let res: HttpResponse | null = null;
    let err: unknown = null;
    try {
      res = await request(o);
    } catch (e) {
      err = e;
    }
    const retry = res ? RETRY_STATUS.has(res.status) || (r.retryable?.(res) ?? false) : err instanceof HttpError && (err.code === undefined || RETRY_CODES.has(err.code));
    if (!retry || attempt >= max) {
      if (err) throw err;
      return res!;
    }
    const asked = res ? retryAfterMs(res.headers) : null;
    const backoff = Math.min(cap, base * 2 ** attempt);
    const ms = Math.min(cap, asked !== null ? asked + Math.floor(rnd() * 250) : Math.floor(rnd() * backoff) + 100);
    const u = new URL(o.url);
    log.debug('retrying', { host: u.host, path: u.pathname, attempt: attempt + 1, status: res?.status ?? null, error: err ? (err as Error).message : undefined, waitMs: ms });
    await wait(ms);
  }
}
