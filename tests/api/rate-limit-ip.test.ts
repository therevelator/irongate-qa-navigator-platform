/**
 * Rate limits count per real client address (server/middleware/rateLimit.ts, clientIp in
 * server/lib/requestContext.ts):
 *   RLIP-001  on Netlify ('trust proxy' true), a client cannot dodge a limit by sending a different
 *             X-Forwarded-For on every request: the count follows Netlify's client address header
 *   RLIP-002  different real clients still have their own counters
 *   RLIP-003  outside Netlify the Netlify header is ignored (a client could set it there)
 */
import express from 'express';
import request from 'supertest';
import { authLimiter } from '../../server/middleware/rateLimit';

// authLimiter: 20 failed requests per 15 minutes; successful ones are not counted.
function app(behindNetlify: boolean) {
  const a = express();
  a.set('trust proxy', behindNetlify ? true : 1);
  if (behindNetlify) a.locals.behindNetlify = true;
  a.post('/login', authLimiter, (_req, res) => { res.status(401).json({ error: 'Invalid credentials' }); });
  return a;
}

describe('Rate limits use the real client address', () => {
  test('RLIP-001 a forged X-Forwarded-For does not reset the count on Netlify', async () => {
    const a = app(true);
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      const r = await request(a).post('/login')
        .set('X-Forwarded-For', `10.0.${i}.${i}, 203.0.113.7`)
        .set('X-NF-Client-Connection-IP', '203.0.113.7');
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });

  test('RLIP-002 another real client has its own counter', async () => {
    const a = app(true);
    for (let i = 0; i < 21; i++) await request(a).post('/login').set('X-NF-Client-Connection-IP', '203.0.113.8');
    const other = await request(a).post('/login').set('X-NF-Client-Connection-IP', '198.51.100.9');
    expect(other.status).toBe(401);
  });

  test('RLIP-003 outside Netlify the Netlify header cannot be used to dodge the limit', async () => {
    const a = app(false);
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await request(a).post('/login').set('X-NF-Client-Connection-IP', `192.0.2.${i}`)).status);
    }
    expect(statuses[20]).toBe(429);
  });
});
