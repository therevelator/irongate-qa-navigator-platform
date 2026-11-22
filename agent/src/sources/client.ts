/**
 * The HTTP client of one source: its base URL, its auth header (from an environment variable, held
 * in memory only), its CA bundle, the timeouts and retries of the config. Read-only by design:
 * the only methods are GET and the POST of a GraphQL *query* (Linear); nothing writes to a source.
 */
import { requestWithRetry, readCa, type HttpResponse, type RetryOptions } from '../http';
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

export class SourceClient {
  private ca: string | null;
  requests = 0;
  constructor(private o: ClientOptions) {
    this.ca = readCa(o.caFile ?? o.http.caFile);
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
    this.requests++;
    const t0 = Date.now();
    const res = await requestWithRetry(
      {
        method, url, headers: { ...this.o.headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined, timeoutMs: this.o.http.timeoutSeconds * 1000, ca: this.ca,
      },
      { maxRetries: this.o.http.maxRetries, maxWaitMs: this.o.http.maxRetryWaitSeconds * 1000, ...(this.o.retry ?? {}), ...(retry ?? {}) },
    ).catch((e: Error) => { throw new SourceError(`${this.o.source}: ${redact(e.message)}`); });
    log.debug('source request', { source: this.o.source, method, host: u.host, path: u.pathname, status: res.status, ms: Date.now() - t0 });
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

  async postQuery<T = any>(path: string, body: unknown, retry?: Partial<RetryOptions>): Promise<T> {
    return (await this.send('POST', this.url(path), body, retry)).json<T>();
  }
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
