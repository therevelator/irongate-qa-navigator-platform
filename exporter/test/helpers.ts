/** Test helpers: fixtures, a recording mock HTTP server, date shifting, a config builder. */
import http from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseConfig, type Config } from '../src/config';

const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string): any => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));

export interface Recorded { method: string; path: string; query: URLSearchParams; headers: http.IncomingHttpHeaders; body: string; json: any }
export type Handler = (req: Recorded) => { status?: number; headers?: Record<string, string>; body?: unknown } | Promise<{ status?: number; headers?: Record<string, string>; body?: unknown }>;

export class MockServer {
  requests: Recorded[] = [];
  routes: Array<{ method: string; path: string | RegExp; handler: Handler }> = [];
  server: http.Server;
  url = '';
  constructor() {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        let buf = Buffer.concat(chunks);
        if (req.headers['content-encoding'] === 'gzip') buf = gunzipSync(buf);
        const u = new URL(req.url ?? '/', 'http://x');
        const body = buf.toString('utf8');
        let json: any = null;
        try { json = body ? JSON.parse(body) : null; } catch { json = null; }
        const rec: Recorded = { method: req.method ?? 'GET', path: u.pathname, query: u.searchParams, headers: req.headers, body, json };
        this.requests.push(rec);
        const route = this.routes.find((r) => r.method === rec.method && (typeof r.path === 'string' ? r.path === rec.path : r.path.test(rec.path)));
        if (!route) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `no mock for ${rec.method} ${rec.path}` })); return; }
        try {
          const out = await route.handler(rec);
          res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json', ...(out.headers ?? {}) });
          res.end(out.body === undefined ? '' : typeof out.body === 'string' || Buffer.isBuffer(out.body) ? out.body : JSON.stringify(out.body));
        } catch (e) {
          res.writeHead(500); res.end(String(e));
        }
      });
    });
  }
  on(method: string, path: string | RegExp, handler: Handler): this { this.routes.unshift({ method, path, handler }); return this; }
  async start(): Promise<this> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    const a = this.server.address() as { port: number };
    this.url = `http://127.0.0.1:${a.port}`;
    return this;
  }
  async stop(): Promise<void> { const done = new Promise<void>((r) => this.server.close(() => r())); this.server.closeAllConnections(); await done; }
  count(path: string | RegExp, method?: string): number {
    return this.requests.filter((r) => (!method || r.method === method) && (typeof path === 'string' ? r.path === path : path.test(r.path))).length;
  }
}

const ISO_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})$/;
/** A copy of a fixture with every timestamp moved by ms (keeps the format, Jira's +0000 included). */
export function shift<T>(v: T, ms: number): T {
  if (typeof v === 'string') {
    const m = ISO_RE.exec(v);
    if (!m) return v;
    const tz = m[2] === 'Z' ? 'Z' : m[2].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
    const d = new Date(Date.parse(m[1] + tz) + ms);
    const isoStr = d.toISOString();
    if (m[2] === 'Z') return (m[1].includes('.') ? isoStr : isoStr.replace(/\.\d{3}Z$/, 'Z')) as T;
    return (isoStr.replace('Z', '+0000')) as T;
  }
  if (Array.isArray(v)) return v.map((x) => shift(x, ms)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x, ms)])) as T;
  return v;
}

/** Fixture dates are around 2026-11-20: the shift that brings them to "a couple of days ago". */
export const SHIFT_TO_NOW = Date.now() - Date.parse('2026-11-22T00:00:00Z');

export function tmpDir(): string { return mkdtempSync(join(tmpdir(), 'qe-exporter-test-')); }

export function config(raw: Record<string, unknown>): Config {
  return parseConfig({ qeNavigator: { url: 'http://127.0.0.1:1' }, sources: [], ...raw }, 'test.yaml');
}

export const fastRetry = { sleep: async () => {}, baseMs: 1 };

/** Every string anywhere in a value (to prove what is not in it). */
export function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) { out.push(k); allStrings(x, out); } }
  return out;
}
