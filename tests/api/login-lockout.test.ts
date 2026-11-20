/**
 * Company sign-in lockout (server/lib/loginLockout.ts; users.failed_login_attempts, users.locked_until).
 *
 *   LCK-001 wrong passwords are counted; fewer than 5 do not lock; a successful sign-in resets the count
 *   LCK-002 the fifth wrong password in a row locks the account for 15 minutes; while locked, even the
 *           right password gets exactly the answer of a wrong password or an unknown e-mail, the attempt
 *           is counted (auth event "locked") and the lock is not extended
 *   LCK-003 when the lock has ended the right password works and resets the count; a wrong one locks again
 *   LCK-004 the platform operator's Clear lockout resets both columns, then the person can sign in;
 *           nothing to clear is a 409
 *   LCK-005 a password set by an admin also clears the lockout
 */
import 'dotenv/config';
import request from 'supertest';
import type { Client } from 'pg';
import { buildApp } from './helpers/inProcessApp';
import { NEW_PW, PW, backendUp, cookieFrom, localDb } from './helpers/http';
import { upsertOperator } from '../../server/lib/operator';
import { flushBackgroundWrites } from '../../server/lib/opsLog';
import { LOCKOUT_MINUTES, LOCKOUT_THRESHOLD } from '../../server/lib/loginLockout';
import { pool } from '../../src/lib/db';

const app = buildApp();
const stamp = Date.now();
const OP_PW = 'Operator-Lockout-Passw0rd!';
const opEmail = `lck-op-${stamp}@platform${stamp}.test`;
const emails: string[] = [];
let up = true;
let db: Client;
let admin = '';
let companyId = '';
let teamId = '';
let departmentId = '';
let opToken = '';
let ipSeq = 0;

// A new client address per attempt, so the per-address sign-in rate limit is not what refuses.
const signIn = (email: string, password: string) =>
  request(app).post('/api/auth/login').set('X-Forwarded-For', `203.0.113.${(++ipSeq % 250) + 1}`).send({ email, password });
const state = async (id: string) =>
  (await db.query(`SELECT failed_login_attempts AS n, locked_until, (locked_until > now()) AS locked FROM users WHERE id = $1`, [id])).rows[0];
const lastReason = async (id: string) =>
  (await db.query('SELECT failure_reason FROM auth_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [id])).rows[0]?.failure_reason;

async function newUser(tag: string): Promise<{ id: string; email: string }> {
  const email = `lck-${tag}-${stamp}@irongate.com`;
  emails.push(email);
  const res = await request(app).post('/api/admin/users').set('Cookie', admin)
    .send({ email, password: NEW_PW, firstName: 'Lock', lastName: tag, role: 'qa_engineer', teamId, departmentId });
  expect(res.status).toBe(201);
  return { id: res.body.id, email };
}
async function failTimes(email: string, n: number) {
  for (let i = 0; i < n; i++) expect((await signIn(email, `Wrong-Passw0rd-${i}`)).status).toBe(401);
}

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  admin = cookieFrom(await signIn('admin@irongate.com', PW));
  const a = (await db.query(`SELECT company_id FROM users WHERE email = 'admin@irongate.com'`)).rows[0];
  companyId = a.company_id;
  const team = (await db.query('SELECT id, department_id FROM teams WHERE company_id = $1 AND is_active = TRUE ORDER BY id LIMIT 1', [companyId])).rows[0];
  teamId = team.id;
  departmentId = team.department_id;
  await upsertOperator(opEmail, 'Lockout Operator', OP_PW);
  opToken = (await request(app).post('/api/operator/login').send({ email: opEmail, password: OP_PW })).body.token;
}, 60_000);

afterAll(async () => {
  if (db) {
    if (emails.length) await db.query('DELETE FROM users WHERE LOWER(email) = ANY($1::text[])', [emails.map((e) => e.toLowerCase())]);
    await db.query('DELETE FROM platform_operators WHERE email = $1', [opEmail]);
    await db.end();
  }
  await flushBackgroundWrites(2000);
  await pool.end();
});

describe('Company sign-in lockout', () => {
  test('LCK-001 wrong passwords are counted; a successful sign-in resets the count', async () => {
    if (!up) return;
    const u = await newUser('count');
    await failTimes(u.email, LOCKOUT_THRESHOLD - 1);
    expect(await state(u.id)).toEqual(expect.objectContaining({ n: LOCKOUT_THRESHOLD - 1, locked_until: null }));
    expect(await lastReason(u.id)).toBe('wrong_password');
    expect((await signIn(u.email, NEW_PW)).status).toBe(200);
    expect(await state(u.id)).toEqual(expect.objectContaining({ n: 0, locked_until: null }));
    // Counted "in a row": after the reset, four more do not lock either.
    await failTimes(u.email, LOCKOUT_THRESHOLD - 1);
    expect((await state(u.id)).locked_until).toBeNull();
  });

  test('LCK-002 the fifth wrong password locks for 15 minutes; locked looks like a wrong password', async () => {
    if (!up) return;
    const u = await newUser('lock');
    await failTimes(u.email, LOCKOUT_THRESHOLD);
    const locked = await state(u.id);
    expect(locked.n).toBe(LOCKOUT_THRESHOLD);
    expect(locked.locked).toBe(true);
    const minutes = (new Date(locked.locked_until).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(LOCKOUT_MINUTES - 1);
    expect(minutes).toBeLessThanOrEqual(LOCKOUT_MINUTES + 0.1);

    const right = await signIn(u.email, NEW_PW);
    const wrong = await signIn(u.email, 'Wrong-Passw0rd-x');
    const unknown = await signIn(`nobody-${stamp}@irongate.com`, NEW_PW);
    for (const r of [right, wrong, unknown]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: 'Invalid credentials' });
      expect(cookieFrom(r)).toBe('');
    }
    expect(await lastReason(u.id)).toBe('locked');
    const after = await state(u.id);
    expect(after.n).toBe(LOCKOUT_THRESHOLD + 2); // both attempts while locked were counted
    expect(new Date(after.locked_until).getTime()).toBe(new Date(locked.locked_until).getTime()); // not extended
  });

  test('LCK-003 after the lock ends the right password works; a wrong one locks again at once', async () => {
    if (!up) return;
    const u = await newUser('expire');
    await failTimes(u.email, LOCKOUT_THRESHOLD);
    await db.query(`UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1`, [u.id]);
    expect((await signIn(u.email, 'Wrong-Passw0rd-y')).status).toBe(401);
    expect((await state(u.id)).locked).toBe(true); // the count was still 5: locked again

    await db.query(`UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1`, [u.id]);
    const ok = await signIn(u.email, NEW_PW);
    expect(ok.status).toBe(200);
    expect(ok.body.user.locked).toBeUndefined();
    expect(await state(u.id)).toEqual(expect.objectContaining({ n: 0, locked_until: null }));
  });

  test('LCK-004 the platform operator\'s Clear lockout resets both columns', async () => {
    if (!up) return;
    const u = await newUser('clear');
    const clear = () => request(app).post(`/api/operator/companies/${companyId}/users/${u.id}/clear-lockout`).set('X-Operator-Token', opToken).send({});
    expect((await clear()).status).toBe(409); // nothing to clear
    await failTimes(u.email, LOCKOUT_THRESHOLD);
    const detail = await request(app).get(`/api/operator/companies/${companyId}/users/${u.id}`).set('X-Operator-Token', opToken);
    expect(detail.body.user).toEqual(expect.objectContaining({ failed_login_attempts: LOCKOUT_THRESHOLD, locked: true }));
    expect((await signIn(u.email, NEW_PW)).status).toBe(401);
    const res = await clear();
    expect(res.status).toBe(200);
    expect(await state(u.id)).toEqual(expect.objectContaining({ n: 0, locked_until: null }));
    expect((await signIn(u.email, NEW_PW)).status).toBe(200);
  });

  test('LCK-005 a password set by an admin clears the lockout', async () => {
    if (!up) return;
    const u = await newUser('admreset');
    await failTimes(u.email, LOCKOUT_THRESHOLD);
    expect((await state(u.id)).locked).toBe(true);
    expect((await request(app).post(`/api/admin/users/${u.id}/reset-password`).set('Cookie', admin).send({ newPassword: 'Admin-Set-Passw0rd' })).status).toBe(200);
    expect(await state(u.id)).toEqual(expect.objectContaining({ n: 0, locked_until: null }));
    expect((await signIn(u.email, 'Admin-Set-Passw0rd')).status).toBe(200);
  });
});
