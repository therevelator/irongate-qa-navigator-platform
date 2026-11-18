import type express from 'express';

/**
 * The last error handler of both servers (server/index.ts and netlify/functions/api.ts). Logs the
 * detail server-side and never returns it to the client. Body-parser errors keep their meaning:
 * 400 for malformed JSON, 413 "Payload too large" when a body is over the JSON limit, 415 for an
 * unsupported charset or encoding; everything else is a 500.
 */
export function apiErrorHandler(err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) {
  console.error('Error:', err);
  const status = Number(err?.status || err?.statusCode) || 500;
  const message =
    status === 400 ? 'Bad request'
      : status === 413 ? 'Payload too large'
        : status === 415 ? 'Unsupported media type'
          : 'Internal server error';
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: message,
    ...(status === 413 ? { limit: err?.limit ?? null } : {}),
  });
}
