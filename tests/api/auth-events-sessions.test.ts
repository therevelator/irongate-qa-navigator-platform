/**
 * Sign-in tracking and company suspension (server/lib/authEvents.ts, server/lib/sessions.ts,
 * migration 20261127000000):
 *
 *   AE-001  every password sign-in is an auth_events row (method, IP, parsed browser / OS / device)
 *           and a user_sessions row whose id is the token's jti (persistent or browser session)
 *   AE-002  failed sign-ins: unknown e-mail (only a keyed hash, no company), wrong password,
 *           deactivated account; the password is never stored
 *   AE-003  location from Netlify's x-nf-geo (base64 JSON) and x-country, trusted only inside the
 *           Netlify function; nothing when the headers are absent or unreadable
 *   AE-004  user agent parsing
 *   AE-005  the operator sees last sign-in, sessions now and every session with its status; Revoke
 *           ends exactly that session (401 session_ended), not the others
 *   AE-006  sign out everywhere and a password change mark the sessions revoked
 *   AE-007  last_seen_at is updated at most every 5 minutes
 *   AE-008  retention: rows older than 180 days are removed by the daily cleanup
 *   SU-001  a suspended company: sign-in refused (403 company_suspended, after the right password
 *           only), existing sessions refused (403 + X-Session-Ended), /me refused, API keys refused,
 *           invitations cannot be accepted; reactivation lets people sign in again
 *   SU-002  the scheduled jobs skip a suspended company (alerts, digest, pulse sends, sample data)
 */
import 'dotenv/config';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Client } from 'pg';
import { buildApp } from './helpers/inProcessApp';
import { NEW_PW, backendUp, cookieFrom, localDb, API_URL } from './helpers/http';
import { upsertOperator } from '../../server/lib/operator';
import { parseGeoHeaders, parseUserAgent, emailHash } from '../../server/lib/authEvents';
import { cleanupOperationalLogs, flushBackgroundWrites } from '../../server/lib/opsLog';
import { runScheduledEvaluation } from '../../server/lib/alerts';
import { runWeeklyDigest } from '../../server/lib/digest';
import { runPulseAutoSend } from '../../server/lib/pulseSend';
import { pool } from '../../src/lib/db';

const app = buildApp();
const netlifyApp = buildApp();
netlifyApp.locals.behindNetlify = true; // as netlify/functions/api.ts
const stamp = Date.now();
const OP_PW = 'Operator-Ae-Passw0rd!';
const opEmail = `ae-op-${stamp}@platform${stamp}.test`;
const adminEmail = `ae-admin-${stamp}@ae${stamp}.test`;
const userEmail = `ae-user-${stamp}@ae${stamp}.test`;
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const GEO = Buffer.from(JSON.stringify({ city: 'Cluj-Napoca', country: { code: 'RO', name: 'Romania' }, subdivision: { code: 'CJ', name: 'Cluj' }, timezone: 'Europe/Bucharest' })).toString('base64');

let up = true;
let db: Client;
let token = '';
let companyId = '';
let teamId = '';
let userId = '';
let ipSeq = 0;
const newIp = () => `198.51.100.${(++ipSeq % 250) + 1}`;

const op = (method: 'get' | 'post', path: string, body?: object) => {
  const r = request(app)[method](`/api/operator${path}`).set('X-Operator-Token', token);
  return body ? r.send(body) : r;
};
const signIn = (target: any, email: string, password = NEW_PW, extra: Record<string, string> = {}, body: object = {}) => {
  let r = target.post('/api/auth/login').set('X-Forwarded-For', newIp()).set('User-Agent', CHROME_MAC);
  for (const [k, v] of Object.entries(extra)) r = r.set(k, v);
  return r.send({ email, password, ...body });
};
const jtiOf = (cookie: string) => (jwt.decode(cookie.replace('irongate_token=', '')) as any)?.jti as string;
const lastEvent = async (where: string, params: unknown[]) => (await db.query(`SELECT * FROM auth_events WHERE ${where} ORDER BY created_at DESC LIMIT 1`, params)).rows[0];

beforeAll(async () => {
  up = await backendUp();
  if (!up) return;
  db = await localDb();
  await upsertOperator(opEmail, 'AE Operator', OP_PW);
  token = (await request(app).post('/api/operator/login').send({ email: opEmail, password: OP_PW })).body.token;
  const c = await request(app).post('/api/operator/companies').set('X-Operator-Token', token).send({
    name: `AE Co ${stamp}`, admin: { email: adminEmail, mode: 'password', firstName: 'Ann', lastName: 'Admin', password: NEW_PW },
  });
  if (c.status !== 201) throw new Error(`company: ${c.status} ${JSON.stringify(c.body)}`);
  companyId = c.body.company.id;
  teamId = c.body.teamId;
  const u = await op('post', `/companies/${companyId}/users`, { email: userEmail, password: NEW_PW, firstName: 'Una', lastName: 'User', role: 'qa_engineer', teamId });
  userId = u.body.id;
}, 60_000);

afterAll(async () => {
  if (db) {
    if (companyId) await db.query('DELETE FROM companies WHERE id = $1', [companyId]);
    await db.query('DELETE FROM platform_operators WHERE email = $1', [opEmail]);
  }
  await db?.end();
  await flushBackgroundWrites(2000);
  await pool.end();
});

const skip = () => !up;

describe('Sign-in events and sessions', () => {
  test('AE-001 a sign-in records an event and a session (jti), persistent or not', async () => {
    if (skip()) return;
    const res = await signIn(request(app), userEmail);
    expect(res.status).toBe(200);
    const cookie = cookieFrom(res);
    const jti = jtiOf(cookie);
    expect(jti).toMatch(/^[0-9a-f-]{36}$/);
    const ev = await lastEvent('user_id = $1', [userId]);
    expect(ev).toEqual(expect.objectContaining({
      company_id: companyId, outcome: 'success', method: 'password', session_id: jti, browser: 'Chrome 131', os: 'macOS', device: 'desktop', email_hash: null,
    }));
    expect(ev.ip).toMatch(/^198\.51\.100\./);
    const s = (await db.query('SELECT * FROM user_sessions WHERE id = $1', [jti])).rows[0];
    expect(s).toEqual(expect.objectContaining({ user_id: userId, company_id: companyId, persistent: false, method: 'password', revoked_at: null, browser: 'Chrome 131' }));
    // Expires by the company lifetime (default 7 days).
    expect(Math.round((new Date(s.expires_at).getTime() - new Date(s.issued_at).getTime()) / 3600_000)).toBe(168);
    const kept = await signIn(request(app), userEmail, NEW_PW, {}, { rememberMe: true });
    expect((await db.query('SELECT persistent FROM user_sessions WHERE id = $1', [jtiOf(cookieFrom(kept))])).rows[0].persistent).toBe(true);
    // The session works.
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
  });

  test('AE-002 failed sign-ins: unknown e-mail (hash only), wrong password, deactivated', async () => {
    if (skip()) return;
    const unknown = `nobody-${stamp}@nowhere${stamp}.test`;
    expect((await signIn(request(app), unknown, 'Secret-MARK-1')).status).toBe(401);
    const u = await lastEvent('email_hash = $1', [emailHash(unknown)]);
    expect(u).toEqual(expect.objectContaining({ outcome: 'failure', failure_reason: 'unknown_email', company_id: null, user_id: null }));
    expect(await signIn(request(app), userEmail, 'Secret-MARK-2').then((r: any) => r.status)).toBe(401);
    expect(await lastEvent('user_id = $1', [userId])).toEqual(expect.objectContaining({ outcome: 'failure', failure_reason: 'wrong_password', company_id: companyId }));
    const dump = JSON.stringify((await db.query(`SELECT * FROM auth_events WHERE created_at > now() - interval '5 minutes'`)).rows);
    expect(dump).not.toMatch(/Secret-MARK|nobody-/);
    await db.query('UPDATE users SET is_active = FALSE WHERE id = $1', [userId]);
    expect((await signIn(request(app), userEmail)).status).toBe(401);
    expect((await lastEvent('user_id = $1', [userId])).failure_reason).toBe('inactive');
    await db.query('UPDATE users SET is_active = TRUE WHERE id = $1', [userId]);
    // The operator sees them, filtered.
    const list = await op('get', `/companies/${companyId}/auth-events?outcome=failure&userId=${userId}`);
    expect(list.status).toBe(200);
    expect(list.body.entries.map((e: any) => e.failure_reason)).toEqual(expect.arrayContaining(['wrong_password', 'inactive']));
    expect(list.body.entries.every((e: any) => e.outcome === 'failure' && e.user_id === userId)).toBe(true);
    const platform = await op('get', '/auth-events?outcome=failure');
    expect(platform.body.entries.some((e: any) => e.unknown_email && e.company_id === null)).toBe(true);
    const csv = await op('get', `/companies/${companyId}/auth-events.csv?outcome=failure`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toMatch(/Failure reason/);
    expect(csv.text).toMatch(/wrong_password/);
  });

  test('AE-003 location from x-nf-geo / x-country only behind Netlify', async () => {
    if (skip()) return;
    await signIn(request(netlifyApp), userEmail, NEW_PW, { 'x-nf-geo': GEO, 'x-nf-client-connection-ip': '203.0.113.9' });
    const geo = await lastEvent('user_id = $1', [userId]);
    expect(geo).toEqual(expect.objectContaining({ country: 'Romania', country_code: 'RO', region: 'Cluj', city: 'Cluj-Napoca', ip: '203.0.113.9' }));
    expect((await db.query('SELECT country, city FROM user_sessions WHERE id = $1', [geo.session_id])).rows[0]).toEqual({ country: 'Romania', city: 'Cluj-Napoca' });
    await signIn(request(netlifyApp), userEmail, NEW_PW, { 'x-country': 'de' });
    expect(await lastEvent('user_id = $1', [userId])).toEqual(expect.objectContaining({ country: 'DE', country_code: 'DE', city: null }));
    // Outside the Netlify function the headers are not trusted (a client could send them); absent = nothing.
    await signIn(request(app), userEmail, NEW_PW, { 'x-nf-geo': GEO, 'x-country': 'FR' });
    expect(await lastEvent('user_id = $1', [userId])).toEqual(expect.objectContaining({ country: null, city: null, region: null }));
    await signIn(request(netlifyApp), userEmail);
    expect((await lastEvent('user_id = $1', [userId])).country).toBeNull();
    // Unit: unreadable headers give nothing.
    expect(parseGeoHeaders({})).toBeNull();
    expect(parseGeoHeaders({ 'x-nf-geo': '%%%not-base64%%%' })).toBeNull();
    expect(parseGeoHeaders({ 'x-nf-geo': Buffer.from('{}').toString('base64') })).toBeNull();
    expect(parseGeoHeaders({ 'x-nf-geo': Buffer.from('{}').toString('base64'), 'x-country': 'US' })).toEqual({ country: 'US', countryCode: 'US', region: null, city: null });
    expect(parseGeoHeaders({ 'x-nf-geo': GEO })).toEqual({ country: 'Romania', countryCode: 'RO', region: 'Cluj', city: 'Cluj-Napoca' });
  });

  test('AE-004 user agent parsing', () => {
    expect(parseUserAgent(CHROME_MAC)).toEqual({ browser: 'Chrome 131', os: 'macOS', device: 'desktop' });
    expect(parseUserAgent(SAFARI_IPHONE)).toEqual({ browser: 'Safari 17', os: 'iOS', device: 'mobile' });
    expect(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0')).toEqual({ browser: 'Edge 120', os: 'Windows', device: 'desktop' });
    expect(parseUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0')).toEqual({ browser: 'Firefox 128', os: 'Linux', device: 'desktop' });
    expect(parseUserAgent('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36')).toEqual({ browser: 'Chrome 126', os: 'Android', device: 'tablet' });
    expect(parseUserAgent('curl/8.5.0')).toEqual({ browser: 'curl', os: null, device: 'bot' });
    expect(parseUserAgent(undefined)).toEqual({ browser: null, os: null, device: null });
  });

  test('AE-005 the operator sees sessions and revokes exactly one', async () => {
    if (skip()) return;
    const a = cookieFrom(await signIn(request(app), userEmail));
    const b = cookieFrom(await signIn(request(app), userEmail));
    const users = await op('get', `/companies/${companyId}/users`);
    const row = users.body.users.find((u: any) => u.id === userId);
    expect(row.active_sessions).toBeGreaterThanOrEqual(2);
    expect(row).toEqual(expect.objectContaining({ last_sign_in_at: expect.any(String), last_sign_in_browser: expect.any(String), last_sign_in_ip: expect.any(String) }));
    const detail = await op('get', `/companies/${companyId}/users/${userId}`);
    expect(detail.status).toBe(200);
    const sa = detail.body.sessions.find((s: any) => s.id === jtiOf(a));
    expect(sa.status).toBe('valid');
    expect(detail.body.signIns.length).toBeGreaterThan(0);
    expect(detail.body.assignments.length).toBeGreaterThan(0);
    expect(detail.body.teams.map((t: any) => t.id)).toContain(teamId);
    expect(JSON.stringify(detail.body)).not.toMatch(/password_hash|token_hash/);

    expect((await op('post', `/companies/${companyId}/sessions/${jtiOf(a)}/revoke`, {})).status).toBe(400); // confirm
    expect((await op('post', `/companies/${companyId}/sessions/${jtiOf(a)}/revoke`, { confirm: true })).status).toBe(200);
    const refused = await request(app).get('/api/admin/users').set('Cookie', a);
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe('session_ended');
    expect(refused.headers['x-session-ended']).toBe('session_ended');
    expect((await request(app).get('/api/auth/me').set('Cookie', a)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', b)).status).toBe(200); // the other session stays
    expect((await op('post', `/companies/${companyId}/sessions/${jtiOf(a)}/revoke`, { confirm: true })).status).toBe(409);
    const after = await op('get', `/companies/${companyId}/users/${userId}`);
    expect(after.body.sessions.find((s: any) => s.id === jtiOf(a))).toEqual(expect.objectContaining({ status: 'revoked', revoked_by: 'IronGate platform support' }));
    // A session of another company through this company: 404.
    const foreign = (await db.query('SELECT id FROM user_sessions WHERE company_id <> $1 LIMIT 1', [companyId])).rows[0];
    if (foreign) expect((await op('post', `/companies/${companyId}/sessions/${foreign.id}/revoke`, { confirm: true })).status).toBe(404);
    // Company-wide list (valid only).
    const list = await op('get', `/companies/${companyId}/sessions?status=valid`);
    expect(list.body.sessions.every((s: any) => s.status === 'valid')).toBe(true);
    expect(list.body.sessions.some((s: any) => s.id === jtiOf(b))).toBe(true);
  });

  test('AE-006 sign out everywhere and a password change mark the sessions revoked', async () => {
    if (skip()) return;
    const a = cookieFrom(await signIn(request(app), userEmail));
    expect((await op('post', `/companies/${companyId}/users/${userId}/sign-out-everywhere`, { confirm: true })).status).toBe(200);
    expect((await db.query('SELECT revoked_at, revoked_by FROM user_sessions WHERE id = $1', [jtiOf(a)])).rows[0]).toEqual({ revoked_at: expect.any(Date), revoked_by: 'IronGate platform support' });
    expect(Number((await db.query('SELECT COUNT(*) FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL', [userId])).rows[0].count)).toBe(0);
    // The person's own "sign out my other devices": the others revoked, this browser's new session valid.
    const b = cookieFrom(await signIn(request(app), userEmail));
    const c = cookieFrom(await signIn(request(app), userEmail));
    const out = await request(app).post('/api/auth/sessions/sign-out-others').set('Cookie', c);
    expect(out.status).toBe(200);
    const fresh = cookieFrom(out);
    expect((await db.query('SELECT revoked_at FROM user_sessions WHERE id = $1', [jtiOf(b)])).rows[0].revoked_at).not.toBeNull();
    expect((await db.query('SELECT revoked_at, method FROM user_sessions WHERE id = $1', [jtiOf(fresh)])).rows[0]).toEqual({ revoked_at: null, method: 'reissue' });
    expect((await request(app).get('/api/auth/me').set('Cookie', fresh)).status).toBe(200);
  });

  test('AE-007 last seen is updated at most every 5 minutes', async () => {
    if (skip()) return;
    const a = cookieFrom(await signIn(request(app), userEmail));
    const id = jtiOf(a);
    await db.query(`UPDATE user_sessions SET last_seen_at = now() - interval '10 minutes' WHERE id = $1`, [id]);
    await request(app).get('/api/admin/users').set('Cookie', a).set('X-Forwarded-For', '192.0.2.44');
    await flushBackgroundWrites(2000);
    const r1 = (await db.query('SELECT last_seen_at, last_ip FROM user_sessions WHERE id = $1', [id])).rows[0];
    expect(Date.now() - new Date(r1.last_seen_at).getTime()).toBeLessThan(60_000);
    expect(r1.last_ip).toBe('192.0.2.44');
    await db.query(`UPDATE user_sessions SET last_seen_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    const before = (await db.query('SELECT last_seen_at FROM user_sessions WHERE id = $1', [id])).rows[0].last_seen_at;
    await request(app).get('/api/admin/users').set('Cookie', a);
    await flushBackgroundWrites(2000);
    expect((await db.query('SELECT last_seen_at FROM user_sessions WHERE id = $1', [id])).rows[0].last_seen_at).toEqual(before);
  });

  test('AE-008 retention: sign-in events and sessions older than 180 days are removed', async () => {
    if (skip()) return;
    const ev = (await db.query(`INSERT INTO auth_events (company_id, user_id, outcome, method, created_at) VALUES ($1, $2, 'success', 'password', now() - interval '181 days') RETURNING id`, [companyId, userId])).rows[0].id;
    const keep = (await db.query(`INSERT INTO auth_events (company_id, user_id, outcome, method, created_at) VALUES ($1, $2, 'success', 'password', now() - interval '179 days') RETURNING id`, [companyId, userId])).rows[0].id;
    const sid = `00000000-0000-4000-8000-${String(stamp).slice(-12).padStart(12, '0')}`;
    await db.query(`INSERT INTO user_sessions (id, user_id, company_id, issued_at, expires_at) VALUES ($1, $2, $3, now() - interval '200 days', now() - interval '193 days')`, [sid, userId, companyId]);
    const r = await cleanupOperationalLogs();
    expect(r.authEvents).toBeGreaterThanOrEqual(1);
    expect(r.sessions).toBeGreaterThanOrEqual(1);
    expect((await db.query('SELECT id FROM auth_events WHERE id = ANY($1::text[])', [[ev, keep]])).rows.map((x: any) => x.id)).toEqual([keep]);
    expect((await db.query('SELECT 1 FROM user_sessions WHERE id = $1', [sid])).rows).toHaveLength(0);
  });
});

describe('Company suspension', () => {
  test('SU-001 suspended: no sign-in, sessions and API keys refused; reactivation restores sign-in', async () => {
    if (skip()) return;
    const session = cookieFrom(await signIn(request(app), userEmail));
    const key = (await op('post', `/companies/${companyId}/api-keys`, { name: 'Suspension key' })).body.plaintextKey;
    const inv = await op('post', `/companies/${companyId}/invitations`, { email: `ae-inv-${stamp}@ae${stamp}.test`, role: 'viewer', scopeId: teamId });
    expect(inv.status).toBe(201);
    const invRow = (await db.query('SELECT id FROM invitations WHERE id = $1', [inv.body.invitation.id])).rows[0];
    expect(invRow).toBeTruthy();

    expect((await op('post', `/companies/${companyId}/suspend`, { reason: 'Invoice 7 unpaid', confirm: true })).status).toBe(200);
    const co = (await db.query('SELECT status, suspended_reason, suspended_at, suspended_by FROM companies WHERE id = $1', [companyId])).rows[0];
    expect(co).toEqual(expect.objectContaining({ status: 'suspended', suspended_reason: 'Invoice 7 unpaid', suspended_at: expect.any(Date), suspended_by: expect.any(String) }));
    expect((await op('post', `/companies/${companyId}/suspend`, { reason: 'again', confirm: true })).status).toBe(409);

    // Sign-in: the right password gets the suspension message; a wrong one still the usual 401.
    const refused = await signIn(request(app), userEmail);
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ error: "Your organisation's access is suspended. Contact your administrator.", code: 'company_suspended' });
    expect(cookieFrom(refused)).toBe('');
    expect((await signIn(request(app), userEmail, 'wrong-Passw0rd')).status).toBe(401);
    expect((await lastEvent('user_id = $1', [userId])).failure_reason).toBe('wrong_password');
    const evs = (await db.query(`SELECT failure_reason FROM auth_events WHERE user_id = $1 AND created_at > now() - interval '1 minute'`, [userId])).rows.map((r: any) => r.failure_reason);
    expect(evs).toContain('company_suspended');

    // The existing session: refused on its next request, with the header the app reacts to.
    const r = await request(app).get('/api/admin/users').set('Cookie', session);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('company_suspended');
    expect(r.headers['x-session-ended']).toBe('company_suspended');
    const me = await request(app).get('/api/auth/me').set('Cookie', session);
    expect(me.status).toBe(403);
    expect(me.body.code).toBe('company_suspended');
    // Its session rows show as revoked.
    expect(Number((await db.query('SELECT COUNT(*) FROM user_sessions WHERE company_id = $1 AND revoked_at IS NULL', [companyId])).rows[0].count)).toBe(0);

    // API keys (ingestion through the live API).
    const ing = await request(API_URL).post('/api/ingest/kpis').set('Authorization', `Bearer ${key}`).send({ teamId, metrics: {} });
    expect(ing.status).toBe(403);
    expect(ing.body.code).toBe('company_suspended');

    // Platform overview badge data.
    const ov = await op('get', '/overview?limit=500');
    expect(ov.body.companies.find((c: any) => c.id === companyId)).toEqual(expect.objectContaining({ status: 'suspended', suspended_reason: 'Invoice 7 unpaid' }));

    // Reactivate (destructive confirmation).
    expect((await op('post', `/companies/${companyId}/reactivate`, {})).status).toBe(400);
    expect((await op('post', `/companies/${companyId}/reactivate`, { confirm: true })).status).toBe(200);
    expect((await signIn(request(app), userEmail)).status).toBe(200);
    // Sessions ended by the suspension stay ended.
    expect((await request(app).get('/api/auth/me').set('Cookie', session)).status).toBe(401);
    expect((await op('post', `/companies/${companyId}/reactivate`, { confirm: true })).status).toBe(409);
  });

  test('SU-001b invitations of a suspended company cannot be accepted', async () => {
    if (skip()) return;
    const { acceptInvitation } = await import('../../server/lib/invitations');
    const inv = await op('post', `/companies/${companyId}/invitations`, { email: `ae-inv2-${stamp}@ae${stamp}.test`, role: 'viewer', scopeId: teamId });
    expect(inv.status).toBe(201);
    await db.query(`UPDATE companies SET status = 'suspended' WHERE id = $1`, [companyId]);
    try {
      await expect(acceptInvitation({ invitationId: inv.body.invitation.id, firstName: 'In', lastName: 'Vitee', password: NEW_PW })).rejects.toMatchObject({ status: 403, code: 'company_suspended' });
      expect((await db.query('SELECT accepted_at FROM invitations WHERE id = $1', [inv.body.invitation.id])).rows[0].accepted_at).toBeNull();
    } finally {
      await db.query(`UPDATE companies SET status = 'active' WHERE id = $1`, [companyId]);
    }
  });

  test('SU-002 scheduled jobs skip a suspended company', async () => {
    if (skip()) return;
    await db.query(`INSERT INTO pulse_settings (team_id, company_id, auto_send) VALUES ($1, $2, TRUE) ON CONFLICT (team_id) DO UPDATE SET auto_send = TRUE`, [teamId, companyId]);
    await db.query(`INSERT INTO kpi_snapshots (id, team_id, snapshot_date) VALUES ($1, $2, CURRENT_DATE - 400) ON CONFLICT DO NOTHING`, [`demo-ae-${stamp}`, teamId]);
    const { teamsWithSampleData } = await import('../../server/seeds/demoSeed');
    expect((await teamsWithSampleData(pool, { skipSuspended: true })).get(companyId)).toEqual([teamId]);
    expect((await runPulseAutoSend(undefined, { teamIds: [teamId] })).teams).toBe(1);
    await db.query(`UPDATE companies SET status = 'suspended' WHERE id = $1`, [companyId]);
    try {
      expect((await runScheduledEvaluation()).some((r) => r.companyId === companyId)).toBe(false);
      expect((await runWeeklyDigest(Date.now(), { companyIds: [companyId] })).companies).toBe(0);
      expect((await runPulseAutoSend(undefined, { teamIds: [teamId] })).teams).toBe(0);
      expect((await teamsWithSampleData(pool, { skipSuspended: true })).get(companyId)).toBeUndefined();
      expect((await teamsWithSampleData(pool)).get(companyId)).toEqual([teamId]); // the overview still counts it
    } finally {
      await db.query(`UPDATE companies SET status = 'active' WHERE id = $1`, [companyId]);
      await db.query('DELETE FROM kpi_snapshots WHERE id = $1', [`demo-ae-${stamp}`]);
    }
    expect((await runWeeklyDigest(Date.now(), { companyIds: [companyId] })).companies).toBe(1);
  }, 120_000);
});
