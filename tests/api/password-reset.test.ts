/**
 * Forgot / reset password by e-mail (server/lib/passwordReset.ts, routes in server/routes/auth.ts and
 * server/routes/admin.ts):
 *   POST /api/auth/forgot-password { email }            always the same 200 answer; only an active user gets mail
 *   POST /api/auth/reset-password  { token, password }   single-use, 60-minute token; the app's password rules
 *   POST /api/admin/users/:id/send-reset-link            the same e-mail, permission canResetPassword
 *
 * Runs in-process (tests/api/helpers/inProcessApp.ts) so the mailer can be swapped for an outbox
 * (setMailerForTests); users are set up through the live API and the LOCAL database. Every test
 * sends from its own client address (X-Forwarded-For, 'trust proxy' 1) so the per-address limits
 * of one test do not affect the next. Skips when no live backend is running.
 */
import 'dotenv/config';
import request from 'supertest';
import { createHash } from 'crypto';
import type { Client } from 'pg';
import { buildApp } from './helpers/inProcessApp';
import { NEW_PW, backendUp, cookieFrom, del, localDb, login, post as livePost, API_URL } from './helpers/http';
import { setMailerForTests, type MailMessage } from '../../server/lib/mailer';
import { flushActivity } from '../../server/lib/userActivity';
import { flushBackgroundWrites } from '../../server/lib/opsLog';
import { activityLabel } from '../../server/lib/activityLabels';
import { pool } from '../../src/lib/db';

const app = buildApp();
const SAME = "If an account exists for that e-mail, we've sent a link.";
const STRONG = 'N3w-Str0ng-Secret';
const stamp = Date.now();
const email = (k: string) => `pwreset-${k}-${stamp}@irongate.test`;

const outbox: MailMessage[] = [];
const captureMailer = { channel: 'smtp' as const, async send(m: MailMessage) { outbox.push(m); return { delivered: true, channel: 'smtp' as const }; } };
const mailsTo = (to: string) => outbox.filter((m) => m.to === to);
const tokenIn = (text: string) => decodeURIComponent(/reset-password\?token=([A-Za-z0-9_%-]+)/.exec(text)?.[1] ?? '');
const lastToken = (to: string) => tokenIn(last(mailsTo(to).filter((m) => /Reset your/.test(m.subject)))?.text ?? '');
const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1];
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

let ipSeq = 0;
/** A fresh client address per call site group. */
const newIp = () => `198.51.${100 + Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
const forgot = (addr: string, ip: string) => request(app).post('/api/auth/forgot-password').set('X-Forwarded-For', ip).send({ email: addr });
const reset = (token: string, password: string, ip: string) => request(app).post('/api/auth/reset-password').set('X-Forwarded-For', ip).send({ token, password });
const signIn = (addr: string, password: string) => request(app).post('/api/auth/login').set('X-Forwarded-For', newIp()).send({ email: addr, password });

let up = true;
let db: Client;
const c: Record<string, string> = {};
const id: Record<string, string> = {};
const T: Record<string, string> = {};
const D: Record<string, string> = {};
const created: string[] = [];

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  setMailerForTests(captureMailer);
  c.admin = (await login('admin@irongate.com')).cookie;
  for (const k of ['A', 'B']) D[k] = (await livePost('/api/admin/departments', c.admin, { name: `PwReset ${k} ${stamp}` })).body.id;
  for (const k of ['A', 'B']) T[k] = (await livePost('/api/admin/teams', c.admin, { name: `PwReset ${k} ${stamp}`, departmentId: D[k] })).body.id;
  const mk = async (key: string, role: string, where: object) => {
    const res = await livePost('/api/admin/users', c.admin, { email: email(key), password: NEW_PW, firstName: 'Reset', lastName: key, role, ...where });
    if (res.status !== 201) throw new Error(`create ${key}: ${res.status} ${JSON.stringify(res.body)}`);
    id[key] = res.body.id;
    created.push(res.body.id);
    c[key] = (await login(email(key), NEW_PW)).cookie;
  };
  for (const k of ['self1', 'self2', 'self3', 'self4', 'self5', 'self6', 'inactive', 'audit', 'target', 'targetB']) {
    await mk(k, 'qa_engineer', { teamId: k === 'targetB' ? T.B : T.A });
  }
  await mk('managerA', 'qa_manager', { departmentId: D.A });
  await mk('managerB', 'qa_manager', { departmentId: D.B });
  await mk('eng', 'qa_engineer', { teamId: T.A });
  await db.query('UPDATE users SET is_active = FALSE WHERE id = $1', [id.inactive]);
  const reg = await request(API_URL).post('/api/auth/register').send({
    email: `pwreset-foreign-${stamp}@other${stamp}.test`, password: NEW_PW, firstName: 'Other', lastName: 'Company',
    companyName: `PwReset Other ${stamp}`, departmentName: 'Ops', teamName: 'Ops Team',
  });
  c.foreign = cookieFrom(reg);
}, 120000);

afterAll(async () => {
  setMailerForTests(null);
  if (up) {
    for (const u of created) await del(`/api/admin/users/${u}`, c.admin);
    for (const t of Object.values(T)) await del(`/api/admin/teams/${t}`, c.admin);
    for (const d of Object.values(D)) await del(`/api/admin/departments/${d}`, c.admin);
  }
  await db?.end();
  await flushBackgroundWrites(2000);
  await pool.end();
});

const skip = () => !up || !id.target;

describe('Forgot password', () => {
  it('PWR-001: unknown, inactive and active e-mails get the identical answer (and similar time); only the active user gets mail', async () => {
    if (skip()) return;
    const before = outbox.length;
    const answers: Array<{ status: number; body: unknown; ms: number }> = [];
    for (const addr of [`nobody-${stamp}@irongate.test`, email('inactive'), email('self1'), email('self1').toUpperCase()]) {
      const t0 = Date.now();
      const r = await forgot(addr, newIp());
      answers.push({ status: r.status, body: r.body, ms: Date.now() - t0 });
    }
    for (const a of answers) {
      expect(a.status).toBe(200);
      expect(a.body).toEqual({ message: SAME });
      expect(a.ms).toBeGreaterThanOrEqual(850);
    }
    const sent = outbox.slice(before);
    expect(sent.map((m) => m.to)).toEqual([email('self1'), email('self1')]);
    expect(sent[0].subject).toBe('Reset your QE Navigator password');
    expect(sent[0].text).toMatch(/\/reset-password\?token=igr_/);
    expect(sent[0].text).toMatch(/expires in 60 minutes/);
    expect(sent[0].text).toMatch(/If you did not ask for this, ignore this e-mail/);
    expect(sent[0].html).toMatch(/href="http[^"]+\/reset-password\?token=igr_/);
    // Malformed input gets the same answer too.
    for (const bad of [undefined, '', 'not-an-email', 42]) {
      const r = await request(app).post('/api/auth/forgot-password').set('X-Forwarded-For', newIp()).send({ email: bad });
      expect({ bad, status: r.status, body: r.body }).toEqual({ bad, status: 200, body: { message: SAME } });
    }
    expect((await db.query('SELECT COUNT(*)::int AS n FROM password_resets WHERE user_id = $1', [id.inactive])).rows[0].n).toBe(0);
  });

  it('PWR-002: only the sha256 of the token is stored, with a 60-minute expiry; the raw token is nowhere in the database', async () => {
    if (skip()) return;
    await forgot(email('self2'), newIp());
    const token = lastToken(email('self2'));
    expect(token).toMatch(/^igr_[A-Za-z0-9_-]{43}$/);
    const rows = (await db.query(
      `SELECT *, EXTRACT(EPOCH FROM (expires_at - created_at))::int AS ttl FROM password_resets WHERE user_id = $1`, [id.self2])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(sha(token));
    expect(rows[0].ttl).toBe(3600);
    expect(rows[0]).toMatchObject({ used_at: null, revoked_at: null, requested_by: null });
    expect(rows[0].ip).toMatch(/^198\.51\./);
    expect(JSON.stringify(rows)).not.toContain(token);
    const user = (await db.query('SELECT * FROM users WHERE id = $1', [id.self2])).rows[0];
    expect(user.password_reset_token).toBeNull();
    expect(JSON.stringify(user)).not.toContain(token);
    const audit = (await db.query('SELECT * FROM audit_log WHERE entity_id = $1', [id.self2])).rows;
    expect(JSON.stringify(audit)).not.toContain(token);
  });
});

describe('Reset password', () => {
  it('PWR-003: the link works once; the new password works, the old one does not; the lockout is cleared; a notice is e-mailed', async () => {
    if (skip()) return;
    await db.query(`UPDATE users SET failed_login_attempts = 4, locked_until = now() + interval '1 hour' WHERE id = $1`, [id.self3]);
    await forgot(email('self3'), newIp());
    const token = lastToken(email('self3'));
    const ip = newIp();
    const ok = await reset(token, STRONG, ip);
    expect(ok.status).toBe(200);
    expect(ok.body.message).toMatch(/Sign in with your new password/);
    expect(cookieFrom(ok)).toBe(''); // never signed in by a reset
    const again = await reset(token, `${STRONG}2`, ip);
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('used');
    expect((await signIn(email('self3'), NEW_PW)).status).toBe(401);
    expect((await signIn(email('self3'), STRONG)).status).toBe(200);
    const u = (await db.query('SELECT failed_login_attempts, locked_until, password_hash FROM users WHERE id = $1', [id.self3])).rows[0];
    expect(u).toMatchObject({ failed_login_attempts: 0, locked_until: null });
    expect(u.password_hash).toMatch(/^\$2[aby]\$10\$/); // bcrypt, same cost as elsewhere
    const notice = last(mailsTo(email('self3')))!;
    expect(notice.subject).toBe('Your QE Navigator password was changed');
    expect(notice.text).toMatch(/If this was not you, contact your administrator/);
    expect(notice.text).not.toMatch(/token=/);
    const row = (await db.query('SELECT used_at FROM password_resets WHERE token_hash = $1', [sha(token)])).rows[0];
    expect(row.used_at).not.toBeNull();
  });

  it('PWR-004: an expired link is refused and changes nothing', async () => {
    if (skip()) return;
    await forgot(email('self4'), newIp());
    const token = lastToken(email('self4'));
    await db.query(`UPDATE password_resets SET created_at = now() - interval '61 minutes', expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [sha(token)]);
    const r = await reset(token, STRONG, newIp());
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'expired' });
    expect(r.body.error).toMatch(/expired/);
    expect((await signIn(email('self4'), NEW_PW)).status).toBe(200);
    // Unknown and malformed tokens.
    for (const t of ['igr_doesnotexist', 'nonsense', '']) {
      const x = await reset(t, STRONG, newIp());
      expect({ t, status: x.status, code: x.body.code }).toEqual({ t, status: 400, code: 'invalid' });
    }
  });

  it('PWR-005: a second request closes the first link; the second one works', async () => {
    if (skip()) return;
    await forgot(email('self5'), newIp());
    const first = lastToken(email('self5'));
    await forgot(email('self5'), newIp());
    const second = lastToken(email('self5'));
    expect(second).not.toBe(first);
    const old = await reset(first, STRONG, newIp());
    expect(old.status).toBe(400);
    expect(old.body.code).toBe('used');
    expect(old.body.error).toMatch(/newer reset link/);
    expect((await reset(second, STRONG, newIp())).status).toBe(200);
    const rows = (await db.query<{ used_at: Date | null; revoked_at: Date | null }>('SELECT used_at, revoked_at FROM password_resets WHERE user_id = $1 ORDER BY created_at', [id.self5])).rows;
    expect(rows.map((r) => [r.used_at !== null, r.revoked_at !== null])).toEqual([[false, true], [true, false]]);
  });

  it('PWR-006: the password rules apply; a refused password does not use up the link', async () => {
    if (skip()) return;
    await forgot(email('self6'), newIp());
    const token = lastToken(email('self6'));
    const ip = newIp();
    for (const weak of ['Sh0rt!', 'alllowercaseletters', `Pwreset-self6-${stamp}X1`]) {
      const r = await reset(token, weak, ip);
      expect({ weak, status: r.status, code: r.body.code }).toEqual({ weak, status: 400, code: 'password' });
    }
    expect((await reset(token, STRONG, ip)).status).toBe(200);
  });
});

describe('Rate limits', () => {
  it('PWR-007: forgot-password: 5 requests per 15 minutes per address, 3 per hour per e-mail address', async () => {
    if (skip()) return;
    const ip = newIp();
    const byIp: number[] = [];
    for (let i = 0; i < 6; i++) byIp.push((await forgot(`nobody-ip-${i}-${stamp}@irongate.test`, ip)).status);
    expect(byIp).toEqual([200, 200, 200, 200, 200, 429]);
    const addr = `nobody-mail-${stamp}@irongate.test`;
    const byMail: number[] = [];
    for (let i = 0; i < 4; i++) byMail.push((await forgot(i === 3 ? addr.toUpperCase() : addr, newIp())).status);
    expect(byMail).toEqual([200, 200, 200, 429]);
  });

  it('PWR-008: reset-password: 10 failed attempts per 15 minutes per address', async () => {
    if (skip()) return;
    const ip = newIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await reset(`igr_guess${i}`, STRONG, ip)).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('Administrator sends the reset link', () => {
  const send = (who: string, target: string) => request(app).post(`/api/admin/users/${target}/send-reset-link`).set('Cookie', c[who]).set('X-Forwarded-For', newIp());

  it('PWR-009: super admin and the manager of the department may; others get 403, another company 404', async () => {
    if (skip()) return;
    for (const who of ['admin', 'managerA']) {
      const before = mailsTo(email('target')).length;
      const r = await send(who, id.target);
      expect({ who, status: r.status }).toEqual({ who, status: 200 });
      expect(r.body).toMatchObject({ delivered: true, channel: 'smtp' });
      expect(JSON.stringify(r.body)).not.toMatch(/igr_|token/);
      const mail = mailsTo(email('target'));
      expect(mail.length).toBe(before + 1);
      expect(last(mail)!.text).toMatch(/sent you a link to choose a new password/);
    }
    // The latest link works.
    expect((await reset(lastToken(email('target')), STRONG, newIp())).status).toBe(200);
    const row = (await db.query('SELECT requested_by FROM password_resets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [id.target])).rows[0];
    expect(row.requested_by).toBe(id.managerA);
    for (const who of ['managerB', 'eng']) {
      expect({ who, status: (await send(who, id.target)).status }).toEqual({ who, status: 403 });
    }
    expect((await send('managerA', id.targetB)).status).toBe(403);
    expect((await send('managerB', id.targetB)).status).toBe(200);
    expect((await send('foreign', id.target)).status).toBe(404);
    expect((await request(app).post(`/api/admin/users/${id.target}/send-reset-link`)).status).toBe(401);
    expect((await send('admin', id.inactive)).status).toBe(409);
    expect(mailsTo(email('inactive'))).toHaveLength(0);
  });
});

describe('Audit and user activity', () => {
  it('PWR-010: the change history and the user activity log record the requests with readable labels and never the token', async () => {
    if (skip()) return;
    await forgot(email('audit'), newIp());
    const token = lastToken(email('audit'));
    expect((await reset(token, STRONG, newIp())).status).toBe(200);
    await flushActivity();
    await flushBackgroundWrites(2000);
    const audit = (await db.query<{ action: string; summary: string }>(`SELECT action, summary, before, after FROM audit_log WHERE entity_id = $1 ORDER BY created_at`, [id.audit])).rows;
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['user.password_reset_request', 'user.password_reset_email']));
    expect(audit.find((a) => a.action === 'user.password_reset_request')?.summary).toMatch(/Password reset requested by Reset audit/);
    expect(audit.find((a) => a.action === 'user.password_reset_email')?.summary).toMatch(/Password changed via e-mail link/);
    const tokenFree = (rows: unknown) => {
      const text = JSON.stringify(rows);
      expect(text).not.toContain(token);
      expect(text).not.toContain(sha(token));
      expect(text).not.toMatch(/igr_|token=/);
    };
    tokenFree(audit);
    type ActivityRow = { route: string; category: string; status: number; method: string };
    let activity: ActivityRow[] = [];
    for (let i = 0; i < 20 && activity.length < 2; i++) {
      activity = (await db.query<ActivityRow>(`SELECT * FROM user_activity WHERE user_id = $1 AND route LIKE '/api/auth/%password' ORDER BY created_at`, [id.audit])).rows;
      if (activity.length < 2) await new Promise((r) => setTimeout(r, 250));
    }
    expect(activity.map((a) => [a.route, a.category, a.status])).toEqual([
      ['/api/auth/forgot-password', 'change', 200],
      ['/api/auth/reset-password', 'change', 200],
    ]);
    expect(activity.map((a) => activityLabel(a))).toEqual(['Asked for a password reset link', 'Changed the password with a reset link (or tried to)']);
    tokenFree(activity);
    // An unknown e-mail leaves no user activity at all (nobody to attribute it to).
    const rid = `pwr010-${stamp}`;
    await request(app).post('/api/auth/forgot-password').set('X-Forwarded-For', newIp()).set('X-Request-Id', rid).send({ email: `nobody-act-${stamp}@irongate.test` });
    await flushActivity();
    expect((await db.query('SELECT 1 FROM user_activity WHERE request_id = $1', [rid])).rows).toHaveLength(0);
  });
});
