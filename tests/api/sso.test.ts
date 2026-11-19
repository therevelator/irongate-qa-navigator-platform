import { API_URL, NEW_PW, backendUp, cookieFrom, del, get as liveGet, localDb, login, post as livePost } from './helpers/http';
import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'http';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createHash, generateKeyPairSync, type KeyObject } from 'crypto';
import authRoutes from '../../server/routes/auth';
import { demoModeEnabled } from '../../server/routes/authSso';
import { clearSsoCaches } from '../../server/lib/sso';
import { pool } from '../../src/lib/db';

/**
 * Single sign-on (Google / Microsoft OpenID Connect) against MOCKED providers: a local OIDC
 * server (discovery, JWKS, token endpoint that enforces PKCE and single-use codes) and an
 * in-process copy of the auth routes configured through the environment variables.
 *   - state, nonce and PKCE (S256) are created and checked;
 *   - the ID token is verified (signature, issuer, audience, expiry);
 *   - only a verified email matches an existing active user or an open invitation; nobody else
 *     gets an account; the session cookie is the same as the password login.
 * The live API (no SSO variables) must not offer SSO at all.
 */

type Claims = Record<string, unknown>;
interface PendingCode { nonce: string; challenge: string; clientId: string; redirectUri: string; claims: Claims; key?: KeyObject; tokenNonce?: string }

const CLIENT = { google: { id: 'google-client-test', secret: 'google-secret-test' }, microsoft: { id: 'ms-client-test', secret: 'ms-secret-test' } };
const TENANT_ID = '11111111-2222-3333-4444-555555555555';

describe('Single sign-on (mocked OIDC providers)', () => {
  let up = true;
  let mock: http.Server;
  let base = '';
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rogue = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const codes = new Map<string, PendingCode>();
  const tokenRequests: Array<Record<string, string>> = [];
  const savedEnv = { ...process.env };
  const app = express();
  let stamp = 0;
  let adminCookie = '';
  const created: string[] = [];
  const emails: Record<string, string> = {};

  beforeAll(async () => {
    up = await backendUp();
    if (!up) return;
    // ---- mock provider
    const jwk: any = keys.publicKey.export({ format: 'jwk' });
    Object.assign(jwk, { kid: 'k1', use: 'sig', alg: 'RS256' });
    const mockApp = express();
    mockApp.use(express.urlencoded({ extended: false }));
    const discovery = (issuer: string) => ({ issuer, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks` });
    mockApp.get('/google/.well-known/openid-configuration', (_q, r) => r.json(discovery('https://accounts.google.com')));
    mockApp.get('/ms/.well-known/openid-configuration', (_q, r) => r.json(discovery('https://login.microsoftonline.com/{tenantid}/v2.0')));
    mockApp.get('/jwks', (_q, r) => r.json({ keys: [jwk] }));
    mockApp.post('/token', (q, r) => {
      tokenRequests.push(q.body);
      const pending = codes.get(q.body.code);
      codes.delete(q.body.code); // single use
      const pkceOk = pending && createHash('sha256').update(String(q.body.code_verifier ?? '')).digest('base64url') === pending.challenge;
      const clientOk = pending && q.body.client_id === pending.clientId
        && q.body.client_secret === (pending.clientId === CLIENT.google.id ? CLIENT.google.secret : CLIENT.microsoft.secret);
      if (!pending || !pkceOk || !clientOk || q.body.redirect_uri !== pending.redirectUri || q.body.grant_type !== 'authorization_code') {
        return r.status(400).json({ error: 'invalid_grant' });
      }
      const now = Math.floor(Date.now() / 1000);
      const idToken = jwt.sign(
        { aud: pending.clientId, iat: now, exp: now + 300, nonce: pending.tokenNonce ?? pending.nonce, ...pending.claims },
        pending.key ?? keys.privateKey, { algorithm: 'RS256', keyid: 'k1' },
      );
      r.json({ access_token: 'at', token_type: 'Bearer', id_token: idToken });
    });
    mock = http.createServer(mockApp);
    await new Promise<void>((res) => mock.listen(0, '127.0.0.1', () => res()));
    base = `http://127.0.0.1:${(mock.address() as any).port}`;

    // ---- configuration (read at call time by server/lib/sso.ts)
    Object.assign(process.env, {
      GOOGLE_CLIENT_ID: CLIENT.google.id, GOOGLE_CLIENT_SECRET: CLIENT.google.secret,
      GOOGLE_OIDC_DISCOVERY_URL: `${base}/google/.well-known/openid-configuration`,
      MS_CLIENT_ID: CLIENT.microsoft.id, MS_CLIENT_SECRET: CLIENT.microsoft.secret, MS_TENANT: 'contoso.example',
      MS_OIDC_DISCOVERY_URL: `${base}/ms/.well-known/openid-configuration`,
      APP_URL: 'http://app.test', API_PUBLIC_URL: 'http://api.test',
    });
    clearSsoCaches();
    app.use(cookieParser());
    app.use(express.json());
    app.use('/api/auth', authRoutes);

    // ---- people (created through the live API)
    adminCookie = (await login('admin@irongate.com')).cookie;
    stamp = Date.now();
    const team = (await liveGet('/api/analytics/scope', adminCookie)).body.teams[0];
    const mkUser = async (key: string) => {
      emails[key] = `sso-${key}-${stamp}@irongate.test`;
      const res = await livePost('/api/admin/users', adminCookie, { email: emails[key], password: NEW_PW, firstName: 'Sso', lastName: key, role: 'qa_engineer', teamId: team.id });
      created.push(res.body.id);
      return res.body.id as string;
    };
    await mkUser('known');
    await mkUser('ms');
    const inactive = await mkUser('inactive');
    await del(`/api/admin/users/${inactive}`, adminCookie);
    emails.invited = `sso-invited-${stamp}@irongate.test`;
    const inv = await livePost('/api/admin/invitations', adminCookie, { email: emails.invited, role: 'viewer', scopeId: team.id });
    emails.invitedTeam = team.id;
    emails.invitationId = inv.body.invitation.id;
    emails.inviteToken = new URL(inv.body.link).searchParams.get('token') as string;
  });

  afterAll(async () => {
    process.env = savedEnv;
    clearSsoCaches();
    if (mock) await new Promise((r) => mock.close(r));
    if (!up) return;
    for (const u of created) await del(`/api/admin/users/${u}`, adminCookie);
    const db = await localDb();
    try {
      const rows = (await db.query('SELECT id FROM users WHERE email LIKE $1', [`sso-%-${stamp}@irongate.test`])).rows;
      for (const r of rows) await del(`/api/admin/users/${r.id}`, adminCookie);
      await db.query(`UPDATE invitations SET revoked_at = now() WHERE email LIKE $1 AND accepted_at IS NULL AND revoked_at IS NULL`, [`sso-%-${stamp}@irongate.test`]);
    } finally {
      await db.end();
    }
    await pool.end(); // the in-process routes' connection pool
  });

  const skip = () => !up || !base;

  /** Start a sign-in: returns the provider URL params and the state cookie. */
  async function start(provider: 'google' | 'microsoft', query = '') {
    const res = await request(app).get(`/api/auth/sso/${provider}/start${query}`);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    const cookie = cookieHeader(res, 'irongate_sso');
    return { res, loc, cookie, params: Object.fromEntries(loc.searchParams.entries()) };
  }
  function cookieHeader(res: request.Response, name: string): string {
    const raw = res.headers['set-cookie'] as unknown as string[] | string | undefined;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const hit = list.find((c) => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`));
    return hit ? hit.split(';')[0] : '';
  }
  /** The provider "signs the person in": registers a code for this authorization request. */
  function issueCode(p: Record<string, string>, claims: Claims, extra: Partial<PendingCode> = {}) {
    const code = `code-${Math.random().toString(36).slice(2)}`;
    codes.set(code, { nonce: p.nonce, challenge: p.code_challenge, clientId: p.client_id, redirectUri: p.redirect_uri, claims, ...extra });
    return code;
  }
  const googleClaims = (email: string, more: Claims = {}): Claims => ({ iss: 'https://accounts.google.com', sub: `g-${email}`, email, email_verified: true, given_name: 'Sso', family_name: 'Person', ...more });
  async function callback(provider: 'google' | 'microsoft', state: string, code: string, cookie: string) {
    const res = await request(app).get(`/api/auth/sso/${provider}/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`).set('Cookie', cookie);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    return { res, loc, error: loc.searchParams.get('sso_error'), session: cookieHeader(res, 'irongate_token') };
  }
  const userCount = async (email: string) => {
    const db = await localDb();
    try { return (await db.query('SELECT COUNT(*)::int AS n FROM users WHERE LOWER(email) = LOWER($1)', [email])).rows[0].n as number; } finally { await db.end(); }
  };

  it('SSO-001: not configured on the live API: no buttons, no routes', async () => {
    if (!up) return;
    const providers = await liveGet('/api/auth/providers');
    expect(providers.status).toBe(200);
    expect(providers.body.sso).toEqual([]);
    expect(providers.body.password).toBe(true);
    expect((await liveGet('/api/auth/sso/google/start')).status).toBe(404);
    expect((await liveGet('/api/auth/sso/microsoft/callback?code=x&state=y')).status).toBe(404);
    expect(API_URL).toBeTruthy();
  });

  it('SSO-002: configured: both providers are offered; an unknown provider is not', async () => {
    if (skip()) return;
    const res = await request(app).get('/api/auth/providers');
    expect(res.body.sso.map((p: any) => p.id)).toEqual(['google', 'microsoft']);
    expect((await request(app).get('/api/auth/sso/github/start')).status).toBe(404);
  });

  it('SSO-003: start sends state, nonce and an S256 PKCE challenge, and keeps them in a short-lived HttpOnly cookie', async () => {
    if (skip()) return;
    const { params, res, loc } = await start('google');
    expect(`${loc.origin}${loc.pathname}`).toBe(`${base}/authorize`);
    expect(params).toMatchObject({ response_type: 'code', client_id: CLIENT.google.id, code_challenge_method: 'S256', redirect_uri: 'http://api.test/api/auth/sso/google/callback' });
    expect(params.scope.split(' ')).toEqual(expect.arrayContaining(['openid', 'email']));
    expect(params.state.length).toBeGreaterThanOrEqual(43);
    expect(params.nonce.length).toBeGreaterThanOrEqual(43);
    expect(params.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const raw = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('irongate_sso='))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Max-Age=600/);
    // The verifier is not in the URL (only its hash is).
    expect(res.headers.location).not.toMatch(/code_verifier/);
  });

  it('SSO-004: an existing active user signs in with the same session cookie as a password login', async () => {
    if (skip()) return;
    const { params, cookie } = await start('google');
    const code = issueCode(params, googleClaims(emails.known));
    const out = await callback('google', params.state, code, cookie);
    expect(out.error).toBeNull();
    expect(out.loc.toString()).toBe('http://app.test/');
    expect(out.session).toMatch(/^irongate_token=/);
    // The token endpoint got the PKCE verifier matching the challenge (the mock enforces it).
    const tr = tokenRequests[tokenRequests.length - 1];
    expect(createHash('sha256').update(tr.code_verifier).digest('base64url')).toBe(params.code_challenge);
    // The session works on the live API (same cookie, same secret).
    const me = await liveGet('/api/auth/me', out.session);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(emails.known);
    // The identity is linked; the state cookie is cleared.
    const db = await localDb();
    try {
      expect((await db.query('SELECT COUNT(*)::int AS n FROM user_identities WHERE provider = $1 AND subject = $2', ['google', `g-${emails.known}`])).rows[0].n).toBe(1);
    } finally {
      await db.end();
    }
    expect((out.res.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith('irongate_sso=;'))).toBe(true);
  });

  it('SSO-005: state is checked: a mismatch or a missing state cookie gives no session', async () => {
    if (skip()) return;
    const a = await start('google');
    const code = issueCode(a.params, googleClaims(emails.known));
    const wrong = await callback('google', 'forged-state', code, a.cookie);
    expect(wrong.error).toBe('state_mismatch');
    expect(wrong.session).toBe('');
    const b = await start('google');
    const code2 = issueCode(b.params, googleClaims(emails.known));
    const noCookie = await callback('google', b.params.state, code2, '');
    expect(noCookie.error).toBe('state_missing');
    expect(noCookie.session).toBe('');
    // A state cookie from the other provider does not fit either.
    const c = await start('microsoft');
    const crossed = await callback('google', c.params.state, issueCode(c.params, googleClaims(emails.known)), c.cookie);
    expect(crossed.error).toBe('state_mismatch');
  });

  it('SSO-006: nonce and PKCE are enforced', async () => {
    if (skip()) return;
    const a = await start('google');
    const badNonce = await callback('google', a.params.state, issueCode(a.params, googleClaims(emails.known), { tokenNonce: 'replayed-nonce' }), a.cookie);
    expect(badNonce.error).toBe('nonce_mismatch');
    expect(badNonce.session).toBe('');
    // A code bound to another challenge (another browser's sign-in) is refused by the provider.
    const b = await start('google');
    const stolen = issueCode({ ...b.params, code_challenge: 'A'.repeat(43) }, googleClaims(emails.known));
    const out = await callback('google', b.params.state, stolen, b.cookie);
    expect(out.error).toBe('token_exchange_failed');
    expect(out.session).toBe('');
  });

  it('SSO-007: the ID token is verified (signature, audience, issuer, expiry)', async () => {
    if (skip()) return;
    const cases: Array<[string, Claims, Partial<PendingCode>]> = [
      ['forged signature', googleClaims(emails.known), { key: rogue.privateKey }],
      ['wrong audience', googleClaims(emails.known, { aud: 'someone-else' }), {}],
      ['wrong issuer', googleClaims(emails.known, { iss: 'https://evil.example' }), {}],
      ['expired', googleClaims(emails.known, { exp: Math.floor(Date.now() / 1000) - 3600, iat: Math.floor(Date.now() / 1000) - 7200 }), {}],
    ];
    for (const [why, claims, extra] of cases) {
      const s = await start('google');
      const out = await callback('google', s.params.state, issueCode(s.params, claims, extra), s.cookie);
      expect({ why, error: out.error, session: out.session }).toEqual({ why, error: 'invalid_token', session: '' });
    }
  });

  it('SSO-008: only a verified email counts, and unknown people never get an account', async () => {
    if (skip()) return;
    const a = await start('google');
    const unverified = await callback('google', a.params.state, issueCode(a.params, googleClaims(emails.known, { email_verified: false, sub: `g-unverified-${stamp}` })), a.cookie);
    expect(unverified.error).toBe('email_unverified');
    const stranger = `sso-stranger-${stamp}@irongate.test`;
    const b = await start('google');
    const unknown = await callback('google', b.params.state, issueCode(b.params, googleClaims(stranger)), b.cookie);
    expect(unknown.error).toBe('no_account');
    expect(unknown.loc.searchParams.get('sso_message')).toContain(stranger);
    expect(unknown.session).toBe('');
    expect(await userCount(stranger)).toBe(0);
    // A deactivated user is refused.
    const c = await start('google');
    const inactive = await callback('google', c.params.state, issueCode(c.params, googleClaims(emails.inactive)), c.cookie);
    expect(inactive.error).toBe('account_inactive');
    expect(inactive.session).toBe('');
  });

  it('SSO-009: an open invitation for the verified email creates the account with exactly that assignment', async () => {
    if (skip()) return;
    // A link for this invitation used by someone with another email: refused, nothing created.
    const wrong = await start('google', `?invite=${encodeURIComponent(emails.inviteToken)}`);
    const otherEmail = `sso-other-${stamp}@irongate.test`;
    const mismatch = await callback('google', wrong.params.state, issueCode(wrong.params, googleClaims(otherEmail)), wrong.cookie);
    expect(mismatch.error).toBe('no_account');
    expect(mismatch.loc.pathname).toBe('/accept-invite');
    expect(await userCount(otherEmail)).toBe(0);

    const s = await start('google', `?invite=${encodeURIComponent(emails.inviteToken)}`);
    const out = await callback('google', s.params.state, issueCode(s.params, googleClaims(emails.invited, { sub: `g-invited-${stamp}` })), s.cookie);
    expect(out.error).toBeNull();
    expect(out.session).toMatch(/^irongate_token=/);
    const me = (await liveGet('/api/auth/me', out.session)).body.user;
    expect(me).toMatchObject({ email: emails.invited, role: 'viewer', first_name: 'Sso', last_name: 'Person' });
    expect(me.assignments.map((a: any) => `${a.role}:${a.scopeId}`)).toEqual([`viewer:${emails.invitedTeam}`]);
    created.push(me.id);
    // Used: the same invitation link no longer works.
    expect((await liveGet(`/api/auth/invitations/${encodeURIComponent(emails.inviteToken)}`)).status).toBe(410);
  });

  it('SSO-010: Microsoft (single tenant): tenant issuer template and preferred_username are handled', async () => {
    if (skip()) return;
    const s = await start('microsoft');
    expect(s.params.redirect_uri).toBe('http://api.test/api/auth/sso/microsoft/callback');
    const claims = { iss: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`, tid: TENANT_ID, sub: `ms-${stamp}`, preferred_username: emails.ms, name: 'Sso ms' };
    const out = await callback('microsoft', s.params.state, issueCode(s.params, claims), s.cookie);
    expect(out.error).toBeNull();
    expect((await liveGet('/api/auth/me', out.session)).body.user.email).toBe(emails.ms);
    // A token whose issuer names another tenant is refused.
    const t = await start('microsoft');
    const other = await callback('microsoft', t.params.state, issueCode(t.params, { ...claims, iss: 'https://login.microsoftonline.com/99999999-0000-0000-0000-000000000000/v2.0' }), t.cookie);
    expect(other.error).toBe('invalid_token');
  });

  it('SSO-012: "Keep me signed in" (remember=1 on the start URL) gives a persistent cookie; without it a browser-session cookie', async () => {
    if (skip()) return;
    for (const [query, persistent] of [['', false], ['?remember=1', true]] as const) {
      const { params, cookie } = await start('google', query);
      const out = await callback('google', params.state, issueCode(params, googleClaims(emails.known)), cookie);
      expect(out.error).toBeNull();
      const raw = (out.res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('irongate_token=') && !c.startsWith('irongate_token=;'))!;
      expect(/Max-Age=/i.test(raw)).toBe(persistent);
      expect((await liveGet('/api/auth/me', out.session)).status).toBe(200);
    }
  });

  it('SSO-011: DEMO_MODE decides whether the demo accounts are offered', async () => {
    if (!up) return;
    expect(demoModeEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(demoModeEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(demoModeEnabled({ NETLIFY: 'true' })).toBe(false);
    expect(demoModeEnabled({ NODE_ENV: 'production', DEMO_MODE: 'true' })).toBe(true);
    expect(demoModeEnabled({ DEMO_MODE: 'false' })).toBe(false);
    const prev = process.env.DEMO_MODE;
    process.env.DEMO_MODE = 'false';
    const off = await request(app).get('/api/auth/providers');
    expect(off.body.demoMode).toBe(false);
    expect(off.body.demoAccounts).toBeUndefined();
    expect(JSON.stringify(off.body)).not.toContain('demo123');
    process.env.DEMO_MODE = 'true';
    const on = await request(app).get('/api/auth/providers');
    expect(on.body.demoAccounts.map((a: any) => a.email)).toContain('admin@irongate.com');
    if (prev === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = prev;
    expect(cookieFrom).toBeDefined();
  });
});
