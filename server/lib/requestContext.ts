import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import type express from 'express';

/**
 * Per-request context shared by both servers (server/index.ts, netlify/functions/api.ts):
 *
 *   - a request id: the incoming X-Request-Id when it is a short safe token, else a new UUID; it
 *     is echoed in the X-Request-Id response header and in every 5xx JSON body
 *     ({ error, requestId }), so a customer can quote it;
 *   - the client IP (clientIp): on Netlify the edge header x-nf-client-connection-ip (set by
 *     Netlify, a client cannot forge it), else req.ip (Express with 'trust proxy');
 *   - the route PATTERN of the matched route (e.g. /api/teams/:id/metrics), captured when the
 *     response is sent, never the raw URL or its query string.
 */

const SAFE_ID = /^[A-Za-z0-9._:-]{8,64}$/;

export interface RequestContext {
  requestId: string;
  startedAt: number;
  /** Route pattern once a route answered (null for unmatched paths). */
  route: string | null;
  /** Path parameters of the matched route. */
  params: Record<string, string>;
  /** First Error logged with console.error while this request ran (inline 500 handlers). */
  lastError?: unknown;
  /** Set once the 5xx of this request is in server_errors. */
  errorRecorded?: boolean;
}

const als = new AsyncLocalStorage<RequestContext>();
/** The context of the request whose code is running now, if any. */
export const currentContext = (): RequestContext | undefined => als.getStore();

// Most handlers answer a failure with res.status(500).json(...) after console.error(msg, error);
// keep that error (in memory, for this request only) so server_errors gets its name and stack.
let capturing = false;
export function installErrorCapture(): void {
  if (capturing) return;
  capturing = true;
  const original = console.error;
  console.error = (...args: unknown[]) => {
    try {
      const ctx = als.getStore();
      if (ctx && ctx.lastError === undefined) {
        const e = args.find((a) => a instanceof Error);
        if (e) ctx.lastError = e;
      }
    } catch { /* never break logging */ }
    return original(...args);
  };
}

type EndHook = (req: express.Request, res: express.Response, ctx: RequestContext) => void;
const endHooks: EndHook[] = [];
/** Called once per request after the response finished (fail-safe; used by the logs). */
export function onRequestEnd(hook: EndHook): void {
  endHooks.push(hook);
}

export function ctxOf(req: express.Request): RequestContext {
  const r = req as any;
  if (!r._igCtx) r._igCtx = { requestId: randomUUID(), startedAt: Date.now(), route: null, params: {} };
  return r._igCtx as RequestContext;
}

/**
 * Netlify's client address header, else Express's req.ip ('trust proxy' set by each server). The
 * Netlify header is trusted only inside the Netlify function (app.locals.behindNetlify, set in
 * netlify/functions/api.ts): there Netlify's edge sets it; anywhere else a client could send it.
 */
export function clientIp(req: express.Request): string {
  const nf = req.headers['x-nf-client-connection-ip'];
  if (req.app?.locals?.behindNetlify && typeof nf === 'string' && nf.trim()) return nf.trim().slice(0, 64);
  return String(req.ip ?? req.socket?.remoteAddress ?? '').slice(0, 64);
}

/** /api prefix normalised (the Netlify function also mounts the routes without it). */
export function routePattern(req: express.Request): string | null {
  const route = (req as any).route?.path;
  if (typeof route !== 'string') return null;
  let p = `${req.baseUrl || ''}${route === '/' && req.baseUrl ? '' : route}`;
  if (!p.startsWith('/api')) p = `/api${p}`;
  return p.length > 200 ? p.slice(0, 200) : p;
}

/** First middleware of both servers. */
export function requestContext(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ctx = ctxOf(req);
  const incoming = req.headers['x-request-id'];
  if (typeof incoming === 'string' && SAFE_ID.test(incoming)) ctx.requestId = incoming;
  res.setHeader('X-Request-Id', ctx.requestId);
  // The route pattern and params are known while a handler runs; capture them when it answers.
  const json = res.json.bind(res);
  (res as any).json = (body: any) => {
    if (res.statusCode >= 500 && body && typeof body === 'object' && !Array.isArray(body) && body.requestId === undefined) {
      body = { ...body, requestId: ctx.requestId };
    }
    return json(body);
  };
  res.on('finish', () => {
    for (const h of endHooks) {
      try { h(req, res, ctx); } catch { /* never fail */ }
    }
  });
  const end = res.end.bind(res);
  (res as any).end = (...args: any[]) => {
    if (!ctx.route) {
      ctx.route = routePattern(req);
      ctx.params = { ...(req.params ?? {}) } as Record<string, string>;
    }
    return (end as any)(...args);
  };
  als.run(ctx, () => next());
}
