import rateLimit from 'express-rate-limit';
import { createHash } from 'crypto';

/**
 * Rate limiters. Note: the default store is per-process in memory, so on
 * serverless (Netlify) each warm instance has its own counters — effective
 * against bursts but not a global cap. On the long-lived server (Railway) it is
 * a genuine limit. A shared store (Redis/Postgres) would make it global.
 */

// General API ceiling to blunt scraping / abuse.
// API_RATE_LIMIT_MAX can raise it for local end-to-end test runs, which log in many times a minute.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

// Tight limit on authentication to slow credential stuffing / brute force.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed logins count toward the limit
  message: { error: 'Too many attempts, please try again later.' },
});

// Strict limit on LLM-backed routes, which cost money per call.
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI request limit reached, please wait a moment.' },
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
    return token ? `key:${createHash('sha256').update(token).digest('hex')}` : `ip:${req.ip}`;
  },
  message: { error: 'Ingestion rate limit reached (60 requests per minute per key). Batch several teams into one request.' },
});

// Invitation acceptance and single sign-on (public): failed attempts per IP, separate from the
// password login counter so a mistyped invitation link never locks anyone out of signing in.
// Tokens are 256-bit random values, so this only blunts scanning.
export const inviteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts, please try again later.' },
});
