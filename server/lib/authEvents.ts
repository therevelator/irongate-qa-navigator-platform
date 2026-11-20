import { createHmac } from 'crypto';
import type express from 'express';
import { query } from '../../src/lib/db';
import { clientIp, ctxOf } from './requestContext';

/**
 * Sign-in events (table auth_events, migration 20261127000000) and the request facts shared with
 * the sessions table (user_sessions): client IP, location and the parsed user agent.
 *
 *   Location: Netlify's edge sets x-nf-geo (base64 JSON: city, country {code, name}, subdivision
 *             {code, name}, ...) and x-country (ISO code). They are trusted only inside the Netlify
 *             function (app.locals.behindNetlify), like the client IP; locally nothing is stored.
 *   Browser:  a small built-in parser (browser + major version, OS, device type); the raw user
 *             agent is kept too (300 characters).
 *   E-mail:   a failed sign-in of an e-mail that belongs to nobody stores only a keyed hash of the
 *             lower-cased e-mail (HMAC-SHA256 with a key derived from JWT_SECRET), never the e-mail.
 *
 * Methods: password, registration, invitation, sso_google, sso_microsoft, reset (password changed
 * with an e-mail link). Outcomes: success, failure (failure_reason: unknown_email, wrong_password,
 * inactive, locked, company_suspended, no_account, ...). Retention 180 days (cleanupOperationalLogs).
 */

export interface Geo { country: string | null; countryCode: string | null; region: string | null; city: string | null }
export interface DeviceInfo { browser: string | null; os: string | null; device: string | null }

const cut = (v: unknown, n: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

/** Location from Netlify's headers (pure; see geoOf for when they are trusted). Null when absent or unreadable. */
export function parseGeoHeaders(headers: Record<string, unknown>): Geo | null {
  const raw = headers['x-nf-geo'];
  let geo: Geo | null = null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      const j = JSON.parse(text);
      if (j && typeof j === 'object') {
        const country = j.country && typeof j.country === 'object' ? j.country : {};
        const sub = j.subdivision && typeof j.subdivision === 'object' ? j.subdivision : {};
        geo = {
          country: cut(country.name, 80) ?? cut(country.code, 80), countryCode: cut(country.code, 8),
          region: cut(sub.name, 120) ?? cut(sub.code, 120), city: cut(j.city, 120),
        };
      }
    } catch { /* unreadable header: ignored */ }
  }
  const xc = cut(headers['x-country'], 8);
  if (!geo && xc) geo = { country: xc.toUpperCase(), countryCode: xc.toUpperCase(), region: null, city: null };
  if (geo && !geo.country && xc) geo = { ...geo, country: xc.toUpperCase(), countryCode: xc.toUpperCase() };
  if (geo && !geo.country && !geo.city && !geo.region) return null;
  return geo;
}

/** Location of the request: only behind Netlify (elsewhere a client could send the headers). */
export function geoOf(req: express.Request | undefined): Geo | null {
  if (!req || !req.app?.locals?.behindNetlify) return null;
  return parseGeoHeaders(req.headers as Record<string, unknown>);
}

const major = (ua: string, re: RegExp): string => {
  const m = re.exec(ua);
  return m ? ` ${m[1]}` : '';
};

/** Browser, OS and device type of a user agent string. */
export function parseUserAgent(uaRaw: unknown): DeviceInfo {
  const ua = typeof uaRaw === 'string' ? uaRaw : '';
  if (!ua) return { browser: null, os: null, device: null };
  const bot = /bot|crawler|spider|curl\/|wget|python-|python\/|node-fetch|axios|postman|okhttp|go-http|java\//i.test(ua);
  let browser: string;
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = `Edge${major(ua, /Edg(?:e|A|iOS)?\/(\d+)/)}`;
  else if (/OPR\/|Opera/.test(ua)) browser = `Opera${major(ua, /OPR\/(\d+)/)}`;
  else if (/SamsungBrowser\//.test(ua)) browser = `Samsung Internet${major(ua, /SamsungBrowser\/(\d+)/)}`;
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = `Firefox${major(ua, /(?:Firefox|FxiOS)\/(\d+)/)}`;
  else if (/CriOS\/|Chrome\//.test(ua)) browser = `${/HeadlessChrome/.test(ua) ? 'Headless Chrome' : 'Chrome'}${major(ua, /(?:CriOS|Chrome)\/(\d+)/)}`;
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = `Safari${major(ua, /Version\/(\d+)/)}`;
  else if (/curl\//i.test(ua)) browser = 'curl';
  else browser = bot ? 'Script or bot' : 'Other';
  let os: string | null;
  if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  else os = null;
  let device: string;
  if (bot) device = 'bot';
  else if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) device = 'tablet';
  else if (/Mobi|iPhone|iPod/.test(ua)) device = 'mobile';
  else device = 'desktop';
  return { browser, os, device };
}

const hashKey = () => createHmac('sha256', process.env.JWT_SECRET || process.env.secrettoken || 'dev-only-insecure-secret-change-me')
  .update('irongate-auth-event-email-v1').digest();

/** Keyed hash of an e-mail address (lower-cased, trimmed). */
export function emailHash(email: unknown): string | null {
  if (typeof email !== 'string' || !email.trim()) return null;
  return createHmac('sha256', hashKey()).update(email.trim().toLowerCase()).digest('hex');
}

/** IP, location and device of a request (for auth_events and user_sessions). */
export function requestFacts(req: express.Request | undefined) {
  const ua = req?.headers?.['user-agent'];
  return {
    ip: req ? clientIp(req) || null : null,
    geo: geoOf(req),
    userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null,
    device: parseUserAgent(ua),
    requestId: req ? ctxOf(req).requestId : null,
  };
}

export type AuthMethod = 'password' | 'registration' | 'invitation' | 'reset' | 'sso_google' | 'sso_microsoft' | string;

export interface AuthEventInput {
  outcome: 'success' | 'failure';
  method: AuthMethod;
  userId?: string | null;
  companyId?: string | null;
  /** Typed e-mail of a failed sign-in: stored as a keyed hash only. */
  email?: string | null;
  failureReason?: string | null;
  sessionId?: string | null;
}

/** Record one sign-in event. Never throws (a log write never breaks a sign-in). */
export async function recordAuthEvent(req: express.Request | undefined, e: AuthEventInput): Promise<void> {
  const f = requestFacts(req);
  try {
    await query(
      `INSERT INTO auth_events (company_id, user_id, email_hash, outcome, method, failure_reason, session_id, ip, country, country_code, region, city,
                                user_agent, browser, os, device, request_id)
       SELECT COALESCE(?::text, u.company_id), u.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM (SELECT ?::text AS id) x LEFT JOIN users u ON u.id = x.id`,
      [
        e.companyId ?? null, e.userId ? null : emailHash(e.email), e.outcome, String(e.method).slice(0, 32), e.failureReason?.slice(0, 40) ?? null,
        e.sessionId ?? null, f.ip, f.geo?.country ?? null, f.geo?.countryCode ?? null, f.geo?.region ?? null, f.geo?.city ?? null,
        f.userAgent, f.device.browser, f.device.os, f.device.device, f.requestId, e.userId ?? null,
      ],
    );
  } catch (err) {
    console.error(`[auth-events] write failed (${(err as any)?.code ?? 'error'})`);
  }
}
