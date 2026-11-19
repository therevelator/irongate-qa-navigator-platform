/**
 * Sign out everywhere and the company's sign-in lifetime (server/lib/sessions.ts):
 *   users.sessions_valid_after   a token issued (iat) before it is refused: 401 code session_ended
 *   "Sign-in lasts" setting       a token older than the company's CURRENT lifetime: 401 session_expired
 * Set by: a reset with the e-mail link, an admin's direct reset, POST /api/admin/users/:id/sign-out-everywhere,
 * POST /api/auth/sessions/sign-out-others (this browser gets a new cookie). Setting:
 * GET|PUT /api/admin/session-settings (super admins only).
 *
 * Runs in-process (tests/api/helpers/inProcessApp.ts; same database and JWT secret as the live API).
 * "Old" sessions are signed here with an iat in the past, so a check never depends on which second
 * a test runs in. Users are set up through the live API. Skips when no live backend is running.
 */
import 'dotenv/config';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Client } from 'pg';
import { buildApp } from './helpers/inProcessApp';
import { NEW_PW, backendUp, cookieFrom, del, localDb, login, post as livePost, API_URL } from './helpers/http';
import { JWT_SECRET } from '../../server/middleware/auth';
import { setMailerForTests, type MailMessage } from '../../server/lib/mailer';
import { sessionProblem, sessionCutoff, endUserSessions, SESSION_LIFETIME_KEY } from '../../server/lib/sessions';
import { flushBackgroundWrites } from '../../server/lib/opsLog';
import { flushActivity } from '../../server/lib/userActivity';
import { pool } from '../../src/lib/db';

const app = buildApp();
const stamp = Date.now();
const email = (k: string) => `sess-${k}-${stamp}@irongate.test`;
const foreignEmail = `sess-foreign-${stamp}@other${stamp}.test`;
const STRONG = 'An0ther-Str0ng-Pass';

const outbox: MailMessage[] = [];
const captureMailer = { channel: 'smtp' as const, async send(m: MailMessage) { outbox.push(m); return { delivered: true, channel: 'smtp' as const }; } };

const nowSec = () => Math.floor(Date.now() / 1000);
/** A session token as the server issues it, with a chosen iat. */
const tokenFor = (userId: string, iat: number, ttl = 7 * 24 * 3600) => jwt.sign({ userId, iat }, JWT_SECRET, { expiresIn: ttl });
const asCookie = (token: string) => `irongate_token=${token}`;
const me = (cookie: string) => request(app).get('/api/auth/me').set('Cookie', cookie);
/** Any route behind authenticateToken. */
const authed = (cookie: string) => request(app).get('/api/admin/users').set('Cookie', cookie);
const signIn = (addr: string, password = NEW_PW) => request(app).post('/api/auth/login').send({ email: addr, password });
let ipSeq = 0;
const newIp = () => `203.0.113.${(++ipSeq % 250) + 1}`;

let up = true;
let db: Client;
const c: Record<string, string> = {};
const id: Record<string, string> = {};
const T: Record<string, string> = {};
const D: Record<string, string> = {};
const created: string[] = [];
let foreignCompany = '';
let foreignUserId = '';

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  setMailerForTests(captureMailer);
  c.admin = (await login('admin@irongate.com')).cookie;
  for (const k of ['A', 'B']) D[k] = (await livePost('/api/admin/departments', c.admin, { name: `Sess ${k} ${stamp}` })).body.id;
  for (const k of ['A', 'B']) T[k] = (await livePost('/api/admin/teams', c.admin, { name: `Sess ${k} ${stamp}`, departmentId: D[k] })).body.id;
  const mk = async (key: string, role: string, where: object) => {
    const res = await livePost('/api/admin/users', c.admin, { email: email(key), password: NEW_PW, firstName: 'Sess', lastName: key, role, ...where });
    if (res.status !== 201) throw new Error(`create ${key}: ${res.status} ${JSON.stringify(res.body)}`);
    id[key] = res.body.id;
    created.push(res.body.id);
    c[key] = (await login(email(key), NEW_PW)).cookie;
  };
  for (const k of ['link', 'adminreset', 'target', 'others', 'matrix', 'targetB']) await mk(k, 'qa_engineer', { teamId: k === 'targetB' ? T.B : T.A });
  await mk('managerA', 'qa_manager', { departmentId: D.A });
  await mk('managerB', 'qa_manager', { departmentId: D.B });
  await mk('eng', 'qa_engineer', { teamId: T.A });
  const reg = await request(API_URL).post('/api/auth/register').send({
    email: foreignEmail, password: NEW_PW, firstName: 'Other', lastName: 'Admin', companyName: `Sess Other ${stamp}`, departmentName: 'Ops', teamName: 'Ops Team',
  });
  c.foreign = cookieFrom(reg);
  foreignUserId = reg.body.user.id;
  foreignCompany = reg.body.user.company_id;
}, 120000);

afterAll(async () => {
  setMailerForTests(null);
  if (up) {
    for (const u of created) await del(`/api/admin/users/${u}`, c.admin);
    for (const t of Object.values(T)) await del(`/api/admin/teams/${t}`, c.admin);
    for (const d of Object.values(D)) await del(`/api/admin/departments/${d}`, c.admin);
  }
  await db?.end();
  await flushActivity();
  await flushBackgroundWrites(2000);
  await pool.end();
});

const skip = () => !up || !id.target;

describe('Session checks (unit)', () => {
  it('SES-001: valid_after truncated to the second: a token of that second is accepted, of the second before refused; lifetime', () => {
    const now = Date.parse('2026-11-19T10:00:05.700Z');
    const cutoff = sessionCutoff(now);
    expect(cutoff.toISOString()).toBe('2026-11-19T10:00:05.000Z');
    const sec = cutoff.getTime() / 1000;
    const row = { sessions_valid_after: cutoff, session_lifetime: null };
    expect(sessionProblem({ iat: sec }, row, now)).toBeNull();
    expect(sessionProblem({ iat: sec + 1 }, row, now)).toBeNull();
    expect(sessionProblem({ iat: sec - 1 }, row, now)).toMatchObject({ code: 'session_ended' });
    expect(sessionProblem({}, row, now)).toMatchObject({ code: 'session_ended' });
    // Lifetime: the current setting (default 7 days; unknown values fall back to it).
    expect(sessionProblem({ iat: sec - 2 * 3600 }, { session_lifetime: '1' }, now)).toMatchObject({ code: 'session_expired' });
    expect(sessionProblem({ iat: sec - 1800 }, { session_lifetime: '1' }, now)).toBeNull();
    expect(sessionProblem({ iat: sec - 6 * 24 * 3600 }, { session_lifetime: null }, now)).toBeNull();
    expect(sessionProblem({ iat: sec - 8 * 24 * 3600 }, { session_lifetime: 'garbage' }, now)).toMatchObject({ code: 'session_expired' });
  });
});

describe('Sign out everywhere', () => {
  it('SES-002: a token issued before sessions_valid_after is refused (401, message, header, cookie cleared), one from that second on is accepted', async () => {
    if (skip()) return;
    const old = asCookie(tokenFor(id.target, nowSec() - 30));
    expect((await me(old)).status).toBe(200);
    const cutoff = await endUserSessions(id.target);
    const sec = cutoff.getTime() / 1000;
    const r = await me(old);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'Your session has ended. Please sign in again.', code: 'session_ended' });
    expect(r.headers['x-session-ended']).toBe('session_ended');
    expect(String(r.headers['set-cookie'])).toMatch(/irongate_token=;/);
    const a = await authed(old);
    expect(a.status).toBe(401);
    expect(a.body.code).toBe('session_ended');
    // Same-second edge.
    expect((await me(asCookie(tokenFor(id.target, sec)))).status).toBe(200);
    expect((await me(asCookie(tokenFor(id.target, sec - 1)))).status).toBe(401);
    // A new sign-in works.
    const fresh = await signIn(email('target'));
    expect(fresh.status).toBe(200);
    expect((await me(cookieFrom(fresh))).status).toBe(200);
  });

  it('SES-003: a reset with the e-mail link ends the existing sessions; signing in with the new password works', async () => {
    if (skip()) return;
    const old = asCookie(tokenFor(id.link, nowSec() - 30));
    expect((await me(old)).status).toBe(200);
    await request(app).post('/api/auth/forgot-password').set('X-Forwarded-For', newIp()).send({ email: email('link') });
    const mail = outbox.filter((m) => m.to === email('link') && /Reset your/.test(m.subject)).pop()!;
    const token = decodeURIComponent(/token=([A-Za-z0-9_%-]+)/.exec(mail.text)![1]);
    expect((await request(app).post('/api/auth/reset-password').set('X-Forwarded-For', newIp()).send({ token, password: STRONG })).status).toBe(200);
    expect((await me(old)).body.code).toBe('session_ended');
    const fresh = await signIn(email('link'), STRONG);
    expect(fresh.status).toBe(200);
    expect((await me(cookieFrom(fresh))).status).toBe(200);
  });

  it('SES-004: an admin direct reset ends the user\'s sessions; changing your own password keeps this browser signed in', async () => {
    if (skip()) return;
    const old = asCookie(tokenFor(id.adminreset, nowSec() - 30));
    const r = await request(app).post(`/api/admin/users/${id.adminreset}/reset-password`).set('Cookie', c.admin).send({ newPassword: STRONG });
    expect(r.status).toBe(200);
    expect((await me(old)).body.code).toBe('session_ended');
    expect((await signIn(email('adminreset'), STRONG)).status).toBe(200);
    // Own password: the request's response carries a new cookie that works; an older one of the same user does not.
    const mine = asCookie(tokenFor(id.eng, nowSec() - 30));
    const otherDevice = asCookie(tokenFor(id.eng, nowSec() - 60));
    const own = await request(app).post(`/api/admin/users/${id.eng}/reset-password`).set('Cookie', mine).send({ newPassword: STRONG });
    expect(own.status).toBe(200);
    const renewed = cookieFrom(own);
    expect(renewed).not.toBe('');
    expect((await me(renewed)).status).toBe(200);
    expect((await me(otherDevice)).status).toBe(401);
    c.eng = renewed; // the sign-in made by setup is older: it ended too
  });

  it('SES-005: "Sign out my other devices" keeps the current session (new cookie) and ends the others', async () => {
    if (skip()) return;
    const current = asCookie(tokenFor(id.others, nowSec() - 20));
    const other = asCookie(tokenFor(id.others, nowSec() - 40));
    const r = await request(app).post('/api/auth/sessions/sign-out-others').set('Cookie', current);
    expect(r.status).toBe(200);
    const renewed = cookieFrom(r);
    expect(renewed).not.toBe('');
    expect((await me(renewed)).status).toBe(200);
    expect((await authed(renewed)).status).not.toBe(401);
    expect((await me(other)).body.code).toBe('session_ended');
    expect((await me(current)).body.code).toBe('session_ended'); // replaced by the new cookie
    expect((await request(app).post('/api/auth/sessions/sign-out-others')).status).toBe(401);
    const audit = (await db.query(`SELECT summary FROM audit_log WHERE action = 'user.sessions_end' AND entity_id = $1`, [id.others])).rows;
    expect(audit[0].summary).toMatch(/signed out of all other devices/);
  });

  it('SES-006: admin "Sign out everywhere": super admin and the department manager may; others 403; another company 404; operator sessions end', async () => {
    if (skip()) return;
    const send = (who: string, target: string) => request(app).post(`/api/admin/users/${target}/sign-out-everywhere`).set('Cookie', c[who]);
    for (const who of ['admin', 'managerA']) {
      const old = asCookie(tokenFor(id.matrix, nowSec() - 30));
      const sid = `sess-op-${who}-${stamp}`;
      await db.query(`INSERT INTO platform_operator_sessions (id, user_id, expires_at, ip) VALUES ($1, $2, now() + interval '30 minutes', '127.0.0.1')`, [sid, id.matrix]);
      const r = await send(who, id.matrix);
      expect({ who, status: r.status }).toEqual({ who, status: 200 });
      expect(cookieFrom(r)).toBe(''); // the admin's own session is not touched
      expect((await me(old)).body.code).toBe('session_ended');
      expect((await db.query('SELECT ended_at FROM platform_operator_sessions WHERE id = $1', [sid])).rows[0].ended_at).not.toBeNull();
    }
    expect((await me(c.admin)).status).toBe(200);
    for (const who of ['managerB', 'eng']) expect({ who, status: (await send(who, id.matrix)).status }).toEqual({ who, status: 403 });
    expect((await send('managerA', id.targetB)).status).toBe(403);
    expect((await send('managerB', id.targetB)).status).toBe(200);
    expect((await send('foreign', id.matrix)).status).toBe(404);
    expect((await request(app).post(`/api/admin/users/${id.matrix}/sign-out-everywhere`)).status).toBe(401);
    const audit = (await db.query(`SELECT summary FROM audit_log WHERE action = 'user.sessions_end' AND entity_id = $1 ORDER BY created_at`, [id.matrix])).rows;
    expect(audit[0].summary).toBe('Signed Sess matrix out everywhere');
  });
});

describe('Sign-in lifetime (company setting)', () => {
  const getS = (cookie: string) => request(app).get('/api/admin/session-settings').set('Cookie', cookie);
  const putS = (cookie: string, body: unknown) => request(app).put('/api/admin/session-settings').set('Cookie', cookie).send(body as object);

  it('SES-007: only a super admin reads and changes it, for their own company; values are checked', async () => {
    if (skip()) return;
    const mine = await getS(c.admin);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ choices: [1, 8, 24, 168, 336, 720], defaultHours: 168 });
    for (const who of ['managerA', 'eng']) {
      expect({ who, get: (await getS(c[who])).status, put: (await putS(c[who], { lifetimeHours: 1 })).status }).toEqual({ who, get: 403, put: 403 });
    }
    for (const bad of [2, '8', null, 1000, 0, -1, 7.5, undefined]) {
      expect({ bad, status: (await putS(c.foreign, { lifetimeHours: bad })).status }).toEqual({ bad, status: 400 });
    }
    // The foreign super admin changes THEIR company only.
    const before = (await getS(c.admin)).body.lifetimeHours;
    expect((await putS(c.foreign, { lifetimeHours: 336 })).status).toBe(200);
    expect((await getS(c.foreign)).body.lifetimeHours).toBe(336);
    expect((await getS(c.admin)).body.lifetimeHours).toBe(before);
    // The generic settings endpoint refuses the key (a QA manager may use that one).
    const generic = await request(app).post('/api/admin/configs').set('Cookie', c.managerA).send({ configs: { [SESSION_LIFETIME_KEY]: '720' } });
    expect(generic.status).toBe(400);
    expect((await request(app).post('/api/admin/configs').set('Cookie', c.foreign).send({ configs: { [SESSION_LIFETIME_KEY]: '1' } })).status).toBe(400);
    const audit = (await db.query(`SELECT summary, before, after FROM audit_log WHERE company_id = $1 AND action = 'config.session_lifetime'`, [foreignCompany])).rows;
    expect(audit[0]).toMatchObject({ summary: 'Sign-in lasts: 7 days → 14 days', before: { lifetimeHours: 168 }, after: { lifetimeHours: 336 } });
  });

  it('SES-008: the current setting applies at once: older sessions are refused, younger accepted; changing it back revives them', async () => {
    if (skip()) return;
    const twoHours = asCookie(tokenFor(foreignUserId, nowSec() - 2 * 3600));
    const halfHour = asCookie(tokenFor(foreignUserId, nowSec() - 1800));
    expect((await me(twoHours)).status).toBe(200);
    const admin = asCookie(tokenFor(foreignUserId, nowSec() - 60));
    expect((await putS(admin, { lifetimeHours: 1 })).status).toBe(200);
    const expired = await me(twoHours);
    expect(expired.status).toBe(401);
    expect(expired.body).toEqual({ error: 'Your sign-in has expired. Please sign in again.', code: 'session_expired' });
    expect(expired.headers['x-session-ended']).toBe('session_expired');
    expect((await authed(twoHours)).status).toBe(401);
    expect((await me(halfHour)).status).toBe(200);
    expect((await putS(admin, { lifetimeHours: 8 })).status).toBe(200);
    expect((await me(twoHours)).status).toBe(200);
  });

  it('SES-009: at sign-in the JWT exp and the cookie max age follow the setting', async () => {
    if (skip()) return;
    const admin = asCookie(tokenFor(foreignUserId, nowSec() - 60));
    for (const hours of [1, 24, 720]) {
      expect((await putS(admin, { lifetimeHours: hours })).status).toBe(200);
      const r = await signIn(foreignEmail);
      expect(r.status).toBe(200);
      const setCookie = String(r.headers['set-cookie']);
      expect(setCookie).toMatch(new RegExp(`Max-Age=${hours * 3600}[;,]|Max-Age=${hours * 3600}$`));
      const decoded = jwt.decode(cookieFrom(r).replace('irongate_token=', '')) as { iat: number; exp: number };
      expect(decoded.exp - decoded.iat).toBe(hours * 3600);
    }
    // IronGate (no setting): the default 7 days.
    const r = await signIn(email('eng'), STRONG);
    const decoded = jwt.decode(cookieFrom(r).replace('irongate_token=', '')) as { iat: number; exp: number };
    expect(decoded.exp - decoded.iat).toBe(7 * 24 * 3600);
    // An expired JWT (exp) gives the same clear answer.
    const gone = jwt.sign({ userId: id.eng, iat: nowSec() - 7200 }, JWT_SECRET, { expiresIn: 3600 });
    const g = await me(asCookie(gone));
    expect(g.status).toBe(401);
    expect(g.body.code).toBe('session_expired');
    expect((await authed(asCookie(gone))).body.code).toBe('session_expired');
  });
});
