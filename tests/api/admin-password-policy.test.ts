/**
 * Passwords set by someone else follow the same rules as registration, invitations and reset links
 * (src/lib/passwordPolicy.ts: 10 to 128 characters, three of lower case / upper case / number /
 * symbol, not the e-mail name).
 *
 *   APW-001 POST /api/admin/users refuses a weak password with the rule it breaks (8 characters, one
 *           character class, 129 characters, the e-mail name) and creates nothing; a strong one works
 *   APW-002 POST /api/admin/users/:id/reset-password refuses a weak password and keeps the old one
 *   APW-003 platform operator: Create company with a password refuses a weak password before anything
 *           is created; create person and reset password (forwarded to the company app) refuse it too
 */
import 'dotenv/config';
import request from 'supertest';
import type { Client } from 'pg';
import { buildApp } from './helpers/inProcessApp';
import { NEW_PW, PW, backendUp, cookieFrom, localDb } from './helpers/http';
import { upsertOperator } from '../../server/lib/operator';
import { flushBackgroundWrites } from '../../server/lib/opsLog';
import { pool } from '../../src/lib/db';

const app = buildApp();
const stamp = Date.now();
const OP_PW = 'Operator-Policy-Passw0rd!';
const opEmail = `apw-op-${stamp}@platform${stamp}.test`;
const createdEmails: string[] = [];
let up = true;
let db: Client;
let admin = '';
let teamId = '';
let departmentId = '';
let companyId = '';
let opToken = '';

const login = async (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });
const op = (method: 'post' | 'get', path: string, body?: object) => {
  const r = request(app)[method](`/api/operator${path}`).set('X-Operator-Token', opToken);
  return body ? r.send(body) : r;
};

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  admin = cookieFrom(await login('admin@irongate.com', PW));
  companyId = (await db.query(`SELECT company_id FROM users WHERE email = 'admin@irongate.com'`)).rows[0].company_id;
  const team = (await db.query('SELECT id, department_id FROM teams WHERE company_id = $1 AND is_active = TRUE ORDER BY id LIMIT 1', [companyId])).rows[0];
  teamId = team.id;
  departmentId = team.department_id;
  await upsertOperator(opEmail, 'Policy Operator', OP_PW);
  opToken = (await request(app).post('/api/operator/login').send({ email: opEmail, password: OP_PW })).body.token;
}, 60_000);

afterAll(async () => {
  if (db) {
    if (createdEmails.length) await db.query('DELETE FROM users WHERE LOWER(email) = ANY($1::text[])', [createdEmails.map((e) => e.toLowerCase())]);
    await db.query(`DELETE FROM companies WHERE name LIKE $1`, [`APW ${stamp}%`]);
    await db.query('DELETE FROM platform_operators WHERE email = $1', [opEmail]);
    await db.end();
  }
  await flushBackgroundWrites(2000);
  await pool.end();
});

const weakCases = (email: string): Array<[string, RegExp]> => [
  ['abcdefgh', /10 to 128 characters/],               // was accepted before (8+ characters)
  ['onlylowercaseletters', /three of/],
  [`Aa1!${'x'.repeat(125)}`, /10 to 128 characters/], // 129 characters
  [`${email.split('@')[0]}A1!`, /email name/],
];

describe('Passwords set by an admin or a platform operator', () => {
  test('APW-001 creating a user with a password applies the password rules', async () => {
    if (!up) return;
    const email = `apw-create-${stamp}@irongate.com`;
    createdEmails.push(email);
    for (const [password, why] of weakCases(email)) {
      const res = await request(app).post('/api/admin/users').set('Cookie', admin)
        .send({ email, password, firstName: 'Weak', lastName: 'Pw', role: 'qa_engineer', teamId, departmentId });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(why);
    }
    expect((await db.query('SELECT 1 FROM users WHERE LOWER(email) = $1', [email])).rows).toHaveLength(0);
    const ok = await request(app).post('/api/admin/users').set('Cookie', admin)
      .send({ email, password: NEW_PW, firstName: 'Strong', lastName: 'Pw', role: 'qa_engineer', teamId, departmentId });
    expect(ok.status).toBe(201);
    expect((await login(email, NEW_PW)).status).toBe(200);
  });

  test('APW-002 resetting a password applies the password rules and keeps the old one when refused', async () => {
    if (!up) return;
    const email = `apw-reset-${stamp}@irongate.com`;
    createdEmails.push(email);
    const u = await request(app).post('/api/admin/users').set('Cookie', admin)
      .send({ email, password: NEW_PW, firstName: 'Reset', lastName: 'Me', role: 'qa_engineer', teamId, departmentId });
    expect(u.status).toBe(201);
    for (const [newPassword, why] of weakCases(email)) {
      const res = await request(app).post(`/api/admin/users/${u.body.id}/reset-password`).set('Cookie', admin).send({ newPassword });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(why);
    }
    expect((await request(app).post(`/api/admin/users/${u.body.id}/reset-password`).set('Cookie', admin).send({})).status).toBe(400);
    expect((await login(email, NEW_PW)).status).toBe(200);
    const ok = await request(app).post(`/api/admin/users/${u.body.id}/reset-password`).set('Cookie', admin).send({ newPassword: 'Another-Str0ng-Pass' });
    expect(ok.status).toBe(200);
    expect((await login(email, 'Another-Str0ng-Pass')).status).toBe(200);
  });

  test('APW-003 platform operator: create company, create person and reset password refuse a weak password', async () => {
    if (!up) return;
    const name = `APW ${stamp}`;
    const adminEmail = `apw-first-${stamp}@apw${stamp}.test`;
    const weak = await op('post', '/companies', {
      name, departmentName: 'Eng', teamName: 'Alpha',
      admin: { email: adminEmail, mode: 'password', firstName: 'Ada', lastName: 'Admin', password: 'abcdefgh' },
    });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toMatch(/10 to 128 characters/);
    // Nothing was created: no company without its first person.
    expect((await db.query('SELECT 1 FROM companies WHERE name = $1', [name])).rows).toHaveLength(0);
    const missing = await op('post', '/companies', { name, admin: { email: adminEmail, mode: 'password', firstName: 'Ada', lastName: 'Admin' } });
    expect(missing.status).toBe(400);
    const ok = await op('post', '/companies', {
      name, departmentName: 'Eng', teamName: 'Alpha',
      admin: { email: adminEmail, mode: 'password', firstName: 'Ada', lastName: 'Admin', password: NEW_PW },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.admin.error).toBeUndefined();
    const base = `/companies/${ok.body.company.id}`;
    const personEmail = `apw-person-${stamp}@apw${stamp}.test`;
    const weakPerson = await op('post', `${base}/users`, { email: personEmail, password: 'Short1!', firstName: 'P', lastName: 'Q', role: 'viewer', teamId: ok.body.teamId });
    expect(weakPerson.status).toBe(400);
    expect(weakPerson.body.error).toMatch(/10 to 128 characters/);
    const person = await op('post', `${base}/users`, { email: personEmail, password: NEW_PW, firstName: 'P', lastName: 'Q', role: 'viewer', teamId: ok.body.teamId });
    expect(person.status).toBe(201);
    const weakReset = await op('post', `${base}/users/${person.body.id}/reset-password`, { newPassword: 'alllowercase', confirm: true });
    expect(weakReset.status).toBe(400);
    expect(weakReset.body.error).toMatch(/three of/);
    expect((await login(personEmail, NEW_PW)).status).toBe(200);
  });
});
