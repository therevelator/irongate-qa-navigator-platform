import express from 'express';
import rateLimit from 'express-rate-limit';
import { clientIp } from '../lib/requestContext';
import { SandboxError, buildIfMissing, sandboxReady, startSandboxSession } from '../lib/sandbox';
import {
  BOOK_DEMO_URL, START_PILOT_URL, SANDBOX_COMPANY_NAME, SANDBOX_PERSONAS, SANDBOX_PERSONA_KEYS, SANDBOX_SESSION_HOURS,
  isSandboxPersonaKey, sandboxEnabled, sandboxSessionsPerIpHour,
} from '../lib/sandboxConfig';

/**
 * Demo sandbox sign-in (public, mounted inside /api/auth; server/lib/sandbox.ts has the design):
 *
 *   GET  /sandbox             { enabled, ready, company, sessionHours, personas[] } for the /try page
 *   POST /sandbox { persona } sign in as that persona of the sandbox company (no password): 201 with the
 *                             session cookie; 429 sandbox_rate_limited (per address an hour), 503
 *                             sandbox_preparing (not built yet or being reset) or sandbox_full (too many
 *                             open sandbox sessions), 404 when the sandbox is off (SANDBOX_ENABLED=false).
 *
 * The POST must be JSON (Content-Type: application/json), so a cross-site form cannot start a session
 * (a cross-origin JSON request needs a CORS preflight, which only the app's own origins pass). Both
 * answers carry X-Robots-Tag: noindex and Cache-Control: no-store.
 */
const router = express.Router();

// First line (per warm instance); the real limit counts the session rows (startSandboxSession).
const sandboxLimiter = rateLimit({
  keyGenerator: (req) => `ip:${clientIp(req)}`,
  windowMs: 60 * 60 * 1000,
  max: () => Math.max(60, sandboxSessionsPerIpHour() * 2),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many demo sessions from this address. Try again later.', code: 'sandbox_rate_limited' },
});

const headers = (res: express.Response) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
};

router.get('/sandbox', async (req, res) => {
  headers(res);
  if (!sandboxEnabled()) return void res.status(404).json({ enabled: false });
  try {
    const ready = await sandboxReady();
    if (!ready) void buildIfMissing({ behindNetlify: !!req.app?.locals?.behindNetlify });
    res.json({
      enabled: true, ready, company: SANDBOX_COMPANY_NAME, sessionHours: SANDBOX_SESSION_HOURS,
      bookDemoUrl: BOOK_DEMO_URL, startPilotUrl: START_PILOT_URL,
      personas: SANDBOX_PERSONA_KEYS.map((k) => {
        const p = SANDBOX_PERSONAS[k];
        return { key: p.key, label: p.label, name: `${p.first} ${p.last}`, title: p.title, description: p.description };
      }),
    });
  } catch (e) {
    console.error('Sandbox status error:', (e as any)?.code ?? (e as Error)?.name ?? 'error');
    res.status(500).json({ error: 'The demo could not be loaded. Try again in a moment.' });
  }
});

router.post('/sandbox', sandboxLimiter, async (req, res) => {
  headers(res);
  if (!sandboxEnabled()) return void res.status(404).json({ error: 'The demo sandbox is not available.' });
  if (!req.is('application/json')) return void res.status(415).json({ error: 'Send the request as JSON.' });
  const persona = req.body?.persona ?? 'cto';
  if (!isSandboxPersonaKey(persona)) return void res.status(400).json({ error: `persona: one of ${SANDBOX_PERSONA_KEYS.join(', ')}.` });
  try {
    const s = await startSandboxSession(req, res, persona);
    res.status(201).json({ persona, expiresAt: s.expiresAt, redirect: '/' });
  } catch (e) {
    if (e instanceof SandboxError) {
      if (e.retryAfter) res.set('Retry-After', String(e.retryAfter));
      return void res.status(e.status).json({ error: e.message, code: e.code });
    }
    console.error('Sandbox session error:', (e as any)?.code ?? (e as Error)?.name ?? 'error');
    res.status(500).json({ error: 'The demo could not be started. Try again in a moment.' });
  }
});

export default router;
