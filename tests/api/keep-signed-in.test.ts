/**
 * "Keep me signed in" (FI-03, server/lib/sessions.ts):
 *   KEEP-01  unticked: the session cookie is a browser-session cookie (no Max-Age / Expires);
 *            ticked: a persistent cookie whose max age is the company's sign-in lifetime
 *   KEEP-02  either way the token never outlives the company lifetime: JWT exp = lifetime, and an
 *            older session is refused on the next request (session_expired)
 *   KEEP-03  only a real true counts ("yes", 1, missing → browser session)
 *   KEEP-04  "Sign out my other devices" and changing your own password re-issue the cookie with the
 *            same choice; sessions from before this rule (no `p` in the token) stay persistent
 *   KEEP-05  registration and accepting an invitation give a browser-session cookie
 *   KEEP-06  SSO: the start URL keeps the choice (remember=1): tests/api/sso.test.ts SSO-012
 *
 * Runs in-process (tests/api/helpers/inProcessApp.ts; same database and JWT secret as the live API).
 * Skips when no live backend is running.
 */
import 'dotenv/config';
import request, { type Response as TestResponse } from 'supertest';
import jwt from 'jsonwebtoken';
import type { Client } from 'pg';
import { buildApp } from './helpers/inProcessApp';
import { NEW_PW, backendUp, localDb, login, post as livePost } from './helpers/http';
import { JWT_SECRET } from '../../server/middleware/auth';
import { SESSION_LIFETIME_KEY, currentSessionPersistent } from '../../server/lib/sessions';
import { flushBackgroundWrites } from '../../server/lib/opsLog';
import { flushActivity } from '../../server/lib/userActivity';
import { pool } from '../../src/lib/db';

const app = buildApp();
const stamp = Date.now();
const email = `keep-${stamp}@irongate.test`;
let up = true;
let db: Client;
let userId = '';
let companyId = '';
let regCompany = '';
let ipSeq = 0;
const ip = () => `198.51.100.${(++ipSeq % 250) + 1}`;

const setCookieOf = (res: TestResponse): string => {
  const raw = res.headers['set-cookie'];
  const list: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((c) => c.startsWith('irongate_token=') && !/irongate_token=;/.test(c)) ?? '';
};
const cookiePair = (setCookie: string) => setCookie.split(';')[0];
const payloadOf = (setCookie: string) => jwt.decode(cookiePair(setCookie).slice('irongate_token='.length)) as { p?: boolean; iat: number; exp: number };
const signIn = (rememberMe?: unknown) =>
  request(app).post('/api/auth/login').set('X-Forwarded-For', ip()).send({ email, password: NEW_PW, ...(rememberMe === undefined ? {} : { rememberMe }) });

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  const admin = (await login('admin@irongate.com')).cookie;
  const teams = await request(process.env.API_URL || 'http://localhost:3000').get('/api/teams').set('Cookie', admin);
  const res = await livePost('/api/admin/users', admin, { email, password: NEW_PW, firstName: 'Keep', lastName: 'Signed', role: 'qa_engineer', teamId: teams.body.teams[0].id });
  if (res.status !== 201) throw new Error(`create: ${res.status} ${JSON.stringify(res.body)}`);
  userId = res.body.id;
  companyId = res.body.company_id;
}, 60000);

afterAll(async () => {
  if (!up) return;
  await flushActivity();
  await flushBackgroundWrites();
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
  if (regCompany) await db.query('DELETE FROM companies WHERE id = $1', [regCompany]);
  await db.end();
  await pool.end();
});

describe('Keep me signed in', () => {
  test('KEEP-01 unticked: a browser-session cookie; ticked: a persistent cookie for the company lifetime', async () => {
    if (!up) return;
    const session = setCookieOf(await signIn(false));
    expect(session).toMatch(/^irongate_token=/);
    expect(session).not.toMatch(/Max-Age|Expires/i);
    expect(session).toMatch(/HttpOnly/i);
    expect(payloadOf(session).p).toBe(false);

    const persistent = setCookieOf(await signIn(true));
    const maxAge = Number(/Max-Age=(\d+)/i.exec(persistent)?.[1]);
    expect(maxAge).toBe(168 * 3600); // the default company lifetime (7 days)
    expect(persistent).toMatch(/Expires=/i);
    expect(payloadOf(persistent).p).toBe(true);
  });

  test('KEEP-02 neither cookie outlives the company lifetime', async () => {
    if (!up) return;
    for (const keep of [false, true]) {
      const p = payloadOf(setCookieOf(await signIn(keep)));
      expect(p.exp - p.iat).toBe(168 * 3600);
    }
    // A browser-session cookie kept open longer than the lifetime is refused on the next request.
    const old = jwt.sign({ userId, p: false, iat: Math.floor(Date.now() / 1000) - 169 * 3600 }, JWT_SECRET, { expiresIn: 400 * 3600 });
    const me = await request(app).get('/api/auth/me').set('Cookie', `irongate_token=${old}`);
    expect(me.status).toBe(401);
    expect(me.body.code).toBe('session_expired');
    // A shorter company lifetime applies to both kinds at once and sets the persistent max age.
    await db.query(
      `INSERT INTO configs (id, company_id, department_id, team_id, config_key, config_value) VALUES (gen_random_uuid(), $1, NULL, NULL, $2, '8')`,
      [companyId, SESSION_LIFETIME_KEY]);
    try {
      const persistent = setCookieOf(await signIn(true));
      expect(Number(/Max-Age=(\d+)/i.exec(persistent)?.[1])).toBe(8 * 3600);
      const session = setCookieOf(await signIn(false));
      expect(session).not.toMatch(/Max-Age|Expires/i);
      const p = payloadOf(session);
      expect(p.exp - p.iat).toBe(8 * 3600);
      const nineHours = jwt.sign({ userId, p: false, iat: Math.floor(Date.now() / 1000) - 9 * 3600 }, JWT_SECRET, { expiresIn: 400 * 3600 });
      expect((await request(app).get('/api/auth/me').set('Cookie', `irongate_token=${nineHours}`)).body.code).toBe('session_expired');
    } finally {
      await db.query('DELETE FROM configs WHERE company_id = $1 AND config_key = $2 AND department_id IS NULL AND team_id IS NULL', [companyId, SESSION_LIFETIME_KEY]);
    }
  });

  test('KEEP-03 only a real true keeps you signed in', async () => {
    if (!up) return;
    for (const v of [undefined, 'yes', 1, null, {}]) {
      expect(setCookieOf(await signIn(v))).not.toMatch(/Max-Age/i);
    }
    expect(setCookieOf(await signIn('true'))).toMatch(/Max-Age/i);
  });

  test('KEEP-04 re-issued cookies keep the choice; sessions from before the rule stay persistent', async () => {
    if (!up) return;
    for (const keep of [false, true]) {
      const pair = cookiePair(setCookieOf(await signIn(keep)));
      await new Promise((r) => setTimeout(r, 1100)); // a new second: the re-issued token is valid after the cut-off
      const res = await request(app).post('/api/auth/sessions/sign-out-others').set('Cookie', pair);
      expect(res.status).toBe(200);
      const again = setCookieOf(res);
      expect(/Max-Age/i.test(again)).toBe(keep);
      expect(payloadOf(again).p).toBe(keep);
      const own = await request(app).post(`/api/admin/users/${userId}/reset-password`).set('Cookie', cookiePair(again)).send({ newPassword: NEW_PW });
      expect(own.status).toBe(200);
      expect(/Max-Age/i.test(setCookieOf(own))).toBe(keep);
    }
    const legacy = jwt.sign({ userId }, JWT_SECRET, { expiresIn: 3600 });
    expect(currentSessionPersistent({ cookies: { irongate_token: legacy } } as any)).toBe(true);
    expect(currentSessionPersistent({ cookies: {} } as any)).toBe(false);
  });

  test('KEEP-05 registration gives a browser-session cookie', async () => {
    if (!up) return;
    const res = await request(app).post('/api/auth/register').set('X-Forwarded-For', ip()).send({
      email: `keep-reg-${stamp}@keep${stamp}.test`, password: NEW_PW, firstName: 'Keep', lastName: 'Reg',
      companyName: `Keep Reg ${stamp}`, departmentName: 'Ops', teamName: 'Ops Team',
    });
    expect(res.status).toBe(201);
    regCompany = res.body.user.company_id;
    const cookie = setCookieOf(res);
    expect(cookie).toMatch(/^irongate_token=/);
    expect(cookie).not.toMatch(/Max-Age|Expires/i);
  });
  // KEEP-06 (single sign-on keeps the choice through the provider round trip): tests/api/sso.test.ts SSO-012.

});
