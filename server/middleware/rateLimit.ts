import rateLimit from 'express-rate-limit';
import { createHash } from 'crypto';
import { clientIp } from '../lib/requestContext';

/**
 * Rate limiters. Note: the default store is per-process in memory, so on
 * serverless (Netlify) each warm instance has its own counters — effective
 * against bursts but not a global cap. On the long-lived server (Railway) it is
 * a genuine limit. A shared store (Redis/Postgres) would make it global.
 *
 * Every limiter that counts per address uses clientIp (server/lib/requestContext.ts), not req.ip:
 * on Netlify 'trust proxy' is true, so req.ip is the leftmost X-Forwarded-For entry, which a client
 * can set to anything and so dodge the limit. clientIp uses Netlify's own client address header there.
 */
const byClientIp = (req: Parameters<typeof clientIp>[0]) => `ip:${clientIp(req)}`;

// General API ceiling to blunt scraping / abuse.
// API_RATE_LIMIT_MAX can raise it for local end-to-end test runs, which log in many times a minute.
export const apiLimiter = rateLimit({
  keyGenerator: byClientIp,
  windowMs: 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

// Tight limit on authentication to slow credential stuffing / brute force.
export const authLimiter = rateLimit({
  keyGenerator: byClientIp,
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed logins count toward the limit
  message: { error: 'Too many attempts, please try again later.' },
});

// Strict limit on LLM-backed routes, which cost money per call.
export const aiLimiter = rateLimit({
  keyGenerator: byClientIp,
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI request limit reached, please wait a moment.' },
});

// On-demand recalculation of a team's forecasts and recommendations (POST /api/improve/teams/:id/refresh).
export const improveRefreshLimiter = rateLimit({
  keyGenerator: byClientIp,
  windowMs: 60 * 1000,
  max: Number(process.env.IMPROVE_REFRESH_LIMIT) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many recalculations; try again in a minute.' },
});

// KPI ingestion (POST /api/ingest/kpis): counted per API key (the hash of the bearer
// token, never the token itself), falling back to the client IP when no key is sent.
export const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const header = req.headers['authorization'];
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    return token ? `key:${createHash('sha256').update(token).digest('hex')}` : byClientIp(req);
  },
  message: { error: 'Ingestion rate limit reached (60 requests per minute per key). Batch several teams into one request.' },
});

// Invitation acceptance and single sign-on (public): failed attempts per IP, separate from the
// password login counter so a mistyped invitation link never locks anyone out of signing in.
// Tokens are 256-bit random values, so this only blunts scanning.
export const inviteLimiter = rateLimit({
  keyGenerator: byClientIp,
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts, please try again later.' },
});

// "Forgot password?" (public): every request counts, per client address and per e-mail address
// (its sha256, never the address itself). The answer is the same whether or not the account exists,
// so a limit reached says nothing about the account either.
export const forgotPasswordIpLimiter = rateLimit({
  keyGenerator: byClientIp,
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset requests from this address. Try again in 15 minutes.' },
});

export const forgotPasswordEmailLimiter = rateLimit({
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 255) : '';
    return `email:${createHash('sha256').update(email).digest('hex')}`;
  },
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset requests for this e-mail address. Try again in an hour.' },
});

// Choosing the new password with a reset link (public): failed attempts per client address.
// Tokens are 256-bit random values, so this only blunts scanning.
export const resetPasswordLimiter = rateLimit({
  keyGenerator: byClientIp,
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});
