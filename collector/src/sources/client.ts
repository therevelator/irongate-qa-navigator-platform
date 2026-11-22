/**
 * The HTTP client of one source: its base URL, its auth header (from an environment variable, held
 * in memory only), its CA bundle, the timeouts and retries of the config. Read-only by design:
 * the only methods are GET and the POST of a GraphQL *query* (Linear) or of a GitHub App token
 * request; nothing writes to a source.
 *
 * Rate limits: 429 / 5xx / network errors are retried with backoff and Retry-After (http.ts); a 403
 * that is a rate limit (GitHub's secondary limits: Retry-After, or X-RateLimit-Remaining: 0) is retried
 * the same way; when a response says no requests are left (X-RateLimit-Remaining / RateLimit-Remaining 0),
 * the next request waits for the reset (at most http.maxRetryWaitSeconds).
 * Downloads (artifacts) follow a redirect to another host (signed storage URLs) WITHOUT the source's
 * credentials, cap the size, and report an expired (404 / 410) or too large artifact instead of failing.
 */
import { requestWithRetry, request, readCa, retryAfterMs, sleep, HttpError, type HttpResponse, type RetryOptions } from '../http';
import type { HttpSettings } from '../config';
import { log, redact } from '../log';

export class SourceError extends Error {
  constructor(message: string, public status: number | null = null, public auth = false) { super(message); }
}

export interface ClientOptions {
  source: string;
  baseUrl: string;
  headers: Record<string, string>;
  caFile: string | null;
  http: HttpSettings;
  retry?: Partial<RetryOptions>;
  /** Hint shown with a 401 / 403 (the read-only permission the source needs). */
  authHint: string;
}

/** A 403 that is a rate limit, not a permission problem (GitHub secondary limits, exhausted primary limit). */
export const rateLimited = (res: HttpResponse) =>
  (res.status === 403 || res.status === 429) && (!!res.headers['retry-after'] || res.headers['x-ratelimit-remaining'] === '0' || /rate limit/i.test(res.text().slice(0, 500)));

export type Download = { ok: true; body: Buffer; url: string } | { ok: false; reason: 'expired' | 'too-large' | 'not-found'; message: string };

export class SourceClient {
  private ca: string | null;
  private waitUntil = 0;
  requests = 0;
  rateLimitWaits = 0;
  constructor(private o: ClientOptions) {
    this.ca = readCa(o.caFile ?? o.http.caFile);
  }

  /** Change the auth header (e.g. a renewed GitHub App installation token). */
  setHeader(name: string, value: string): void { this.o.headers[name] = value; }

  private async pace(): Promise<void> {
    const wait = this.waitUntil - Date.now();
    if (wait > 0) {
      this.rateLimitWaits++;
      log.info(`${this.o.source}: rate limit reached, waiting ${Math.ceil(wait / 1000)} s for the reset`);
      await (this.o.retry?.sleep ?? sleep)(Math.min(wait, this.o.http.maxRetryWaitSeconds * 1000));
    }
    this.waitUntil = 0;
  }

  private note(res: HttpResponse): void {
    const remaining = res.headers['x-ratelimit-remaining'] ?? res.headers['ratelimit-remaining'];
    if (remaining === '0') {
      const ms = retryAfterMs({ 'x-ratelimit-reset': (res.headers['x-ratelimit-reset'] ?? res.headers['ratelimit-reset']) as string | undefined });
      if (ms !== null) this.waitUntil = Date.now() + ms;
    }
  }

  url(path: string, query?: Record<string, string | number | boolean | string[] | undefined | null>): string {
    const u = new URL(/^https?:\/\//.test(path) ? path : this.o.baseUrl.replace(/\/+$/, '') + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) for (const x of v) u.searchParams.append(k, x);
      else u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  private async send(method: 'GET' | 'POST', url: string, body?: unknown, retry?: Partial<RetryOptions>): Promise<HttpResponse> {
    const u = new URL(url);
    const base = new URL(this.o.baseUrl);
    // Never send the source's credentials to another host (e.g. a "next" link pointing elsewhere).
    if (u.origin !== base.origin) throw new SourceError(`${this.o.source}: refusing to follow a link to another host (${u.host})`);
    await this.pace();
    this.requests++;
    const t0 = Date.now();
    const res = await requestWithRetry(
      {
        method, url, headers: { ...this.o.headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined, timeoutMs: this.o.http.timeoutSeconds * 1000, ca: this.ca,
      },
      { maxRetries: this.o.http.maxRetries, maxWaitMs: this.o.http.maxRetryWaitSeconds * 1000, retryable: rateLimited, ...(this.o.retry ?? {}), ...(retry ?? {}) },
    ).catch((e: Error) => { throw new SourceError(`${this.o.source}: ${redact(e.message)}`); });
    this.note(res);
    log.debug('source request', { source: this.o.source, method, host: u.host, path: u.pathname, status: res.status, ms: Date.now() - t0 });
    if (rateLimited(res)) throw new SourceError(`${this.o.source}: still rate limited by ${u.host} after ${this.o.http.maxRetries} retries; the next run continues from the cursor`, res.status);
    if (res.status === 401 || res.status === 403) {
      throw new SourceError(`${this.o.source}: HTTP ${res.status} from ${u.host}${u.pathname}. ${this.o.authHint}`, res.status, true);
    }
    if (res.status < 200 || res.status >= 300) {
      const snippet = redact(res.text().replace(/\s+/g, ' ').slice(0, 300));
      throw new SourceError(`${this.o.source}: HTTP ${res.status} from ${u.host}${u.pathname}${snippet ? `: ${snippet}` : ''}`, res.status);
    }
    return res;
  }

  async get<T = any>(path: string, query?: Record<string, string | number | boolean | string[] | undefined | null>): Promise<T> {
    return (await this.send('GET', this.url(path, query))).json<T>();
  }

  /** GET with the response headers (pagination: Link, X-Next-Page, x-ms-continuationtoken). */
  async getResponse(path: string, query?: Record<string, string | number | boolean | string[] | undefined | null>): Promise<HttpResponse> {
    return this.send('GET', this.url(path, query));
  }

  /** GET that answers null for a 404 (an optional resource: a build without a test report). */
  async getOptional<T = any>(path: string, query?: Record<string, string | number | boolean | string[] | undefined | null>): Promise<T | null> {
    try { return await this.get<T>(path, query); } catch (e) { if (e instanceof SourceError && e.status === 404) return null; throw e; }
  }

  /**
   * Download a file (an artifact) of at most maxBytes. The source's credentials go only to its own host: a
   * redirect to another host (a signed storage URL) is followed without them, https only. An expired or
   * missing artifact (404 / 410) and one larger than maxBytes are reported, not thrown.
   */
  async download(pathOrUrl: string, maxBytes: number): Promise<Download> {
    let url = this.url(pathOrUrl);
    const base = new URL(this.o.baseUrl);
    if (new URL(url).origin !== base.origin) throw new SourceError(`${this.o.source}: refusing to send credentials to another host (${new URL(url).host})`);
    for (let hop = 0; hop < 4; hop++) {
      const u = new URL(url);
      const own = u.origin === base.origin;
      await this.pace();
      this.requests++;
      let res: HttpResponse;
      try {
        res = own
          ? await requestWithRetry({ method: 'GET', url, headers: { ...this.o.headers, Accept: '*/*' }, timeoutMs: this.o.http.timeoutSeconds * 1000 * 4, ca: this.ca, maxResponseBytes: maxBytes },
            { maxRetries: this.o.http.maxRetries, maxWaitMs: this.o.http.maxRetryWaitSeconds * 1000, retryable: rateLimited, ...(this.o.retry ?? {}) })
          : await request({ method: 'GET', url, headers: { Accept: '*/*' }, timeoutMs: this.o.http.timeoutSeconds * 1000 * 4, ca: this.ca, maxResponseBytes: maxBytes });
      } catch (e) {
        if (e instanceof HttpError && e.code === 'TOO_LARGE') return { ok: false, reason: 'too-large', message: `larger than ${Math.round(maxBytes / 1024 / 1024)} MB (artifacts.maxMB)` };
        throw new SourceError(`${this.o.source}: download from ${u.host}: ${redact((e as Error).message)}`);
      }
      if (own) this.note(res);
      if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
        const next = new URL(String(res.headers.location), url);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(next.hostname);
        if (next.protocol !== 'https:' && !(next.protocol === 'http:' && local)) throw new SourceError(`${this.o.source}: refusing a download redirect to ${next.protocol}//${next.host} (https only)`);
        url = next.toString();
        continue;
      }
      if (res.status === 404 || res.status === 410) return { ok: false, reason: res.status === 410 ? 'expired' : 'not-found', message: `HTTP ${res.status} (expired or deleted)` };
      if (own && (res.status === 401 || res.status === 403)) throw new SourceError(`${this.o.source}: HTTP ${res.status} downloading from ${u.host}${u.pathname}. ${this.o.authHint}`, res.status, true);
      if (res.status < 200 || res.status >= 300) throw new SourceError(`${this.o.source}: HTTP ${res.status} downloading from ${u.host}${u.pathname}`, res.status);
      return { ok: true, body: res.body, url: own ? url : `${u.origin}${u.pathname}` };
    }
    throw new SourceError(`${this.o.source}: too many redirects downloading ${pathOrUrl}`);
  }

  async postQuery<T = any>(path: string, body: unknown, retry?: Partial<RetryOptions>): Promise<T> {
    return (await this.send('POST', this.url(path), body, retry)).json<T>();
  }
}

/** The URL of the rel="next" page in a Link header (GitHub, GitLab), or null. */
export function nextLink(h: Record<string, unknown>): string | null {
  const link = String(h.link ?? '');
  for (const part of link.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part);
    if (m) return m[1];
  }
  return null;
}

/** One page of mapped records (before the allow-list), with the records skipped and why. */
export interface Page {
  records: Array<{ id: string; record: Record<string, unknown>; changedAt: string | null }>;
  skipped: Array<{ id: string; reason: string }>;
}

export interface Adapter {
  kind: 'issues' | 'incidents';
  /** What the source will read (endpoints, query, fields), for check / preview. No secret. */
  describe(): string[];
  /** Verify auth and scope; returns readable findings (field ids found, teams matched, …). */
  check(): Promise<string[]>;
  /** The records changed in [since, until), page by page. */
  collect(since: Date, until: Date): AsyncIterable<Page>;
  /** Requests made so far (for the run summary). */
  requests(): number;
}
