import type express from 'express';
import { ctxOf } from '../lib/requestContext';
import { recordRequestError } from '../lib/opsLog';

/**
 * The last error handler of both servers (server/index.ts and netlify/functions/api.ts). Logs the
 * detail server-side and never returns it to the client. Body-parser errors keep their meaning:
 * 400 for malformed JSON, 413 "Payload too large" when a body is over the JSON limit, 415 for an
 * unsupported charset or encoding; everything else is a 500.
 *
 * 5xx answers carry the request id ({ error, requestId }, also in the X-Request-Id header) and
 * are recorded in server_errors (server/lib/opsLog.ts: never bodies, headers or query strings).
 */
export function apiErrorHandler(err: any, req: express.Request, res: express.Response, _next: express.NextFunction) {
  console.error('Error:', err);
  const raw = Number(err?.status || err?.statusCode) || 500;
  const status = raw >= 400 && raw < 600 ? raw : 500;
  const message =
    status === 400 ? 'Bad request'
      : status === 413 ? 'Payload too large'
        : status === 415 ? 'Unsupported media type'
          : 'Internal server error';
  const requestId = ctxOf(req).requestId;
  if (status >= 500) recordRequestError(req, status, err);
  if (res.headersSent) return;
  res.status(status).json({
    error: message,
    ...(status === 413 ? { limit: err?.limit ?? null } : {}),
    ...(status >= 500 ? { requestId } : {}),
  });
}
