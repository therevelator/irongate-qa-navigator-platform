import rateLimit from 'express-rate-limit';

/**
 * Rate limiters. Note: the default store is per-process in memory, so on
 * serverless (Netlify) each warm instance has its own counters — effective
 * against bursts but not a global cap. On the long-lived server (Railway) it is
 * a genuine limit. A shared store (Redis/Postgres) would make it global.
 */

// General API ceiling to blunt scraping / abuse.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
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
