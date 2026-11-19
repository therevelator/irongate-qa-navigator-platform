import { createHash, createPublicKey, randomBytes, timingSafeEqual, type KeyObject } from 'crypto';
import jwt from 'jsonwebtoken';

/**
 * Single sign-on with Google and Microsoft (OpenID Connect, authorization code flow with
 * PKCE S256, state and nonce). A provider is enabled only when its environment variables are
 * set; otherwise it does not exist for the app (GET /api/auth/providers says so, its routes 404).
 *
 *   Google     GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   Microsoft  MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT (tenant id or domain; or "organizations")
 *   Both       APP_URL (public URL of the app; the redirect URI is APP_URL/api/auth/sso/<provider>/callback,
 *              or API_PUBLIC_URL/... when the API has its own origin, as in local development)
 *   Optional   GOOGLE_OIDC_DISCOVERY_URL / MS_OIDC_DISCOVERY_URL override the discovery document
 *              (tests use a local mock provider).
 *
 * Everything is read at call time, so configuration changes need no code change.
 * The ID token is verified here: RS256 signature against the provider's JWKS (by kid), issuer,
 * audience (client id), expiry, and the nonce of this sign-in. Only a VERIFIED email address is
 * returned (Google: email_verified; Microsoft: email_verified / xms_edov, or the email /
 * preferred_username of a single configured tenant, whose administrator owns the addresses).
 */

export type ProviderId = 'google' | 'microsoft';
export const PROVIDER_LABEL: Record<ProviderId, string> = { google: 'Google', microsoft: 'Microsoft' };
const MULTI_TENANT = ['common', 'organizations', 'consumers'];

export interface ProviderConfig {
  id: ProviderId;
  clientId: string;
  clientSecret: string;
  discoveryUrl: string;
  tenant?: string;
}

export function providerConfig(id: string, env: NodeJS.ProcessEnv = process.env): ProviderConfig | null {
  if (id === 'google') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
    return {
      id, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
      discoveryUrl: env.GOOGLE_OIDC_DISCOVERY_URL || 'https://accounts.google.com/.well-known/openid-configuration',
    };
  }
  if (id === 'microsoft') {
    if (!env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET || !env.MS_TENANT) return null;
    const tenant = env.MS_TENANT.trim();
    return {
      id, clientId: env.MS_CLIENT_ID, clientSecret: env.MS_CLIENT_SECRET, tenant,
      discoveryUrl: env.MS_OIDC_DISCOVERY_URL || `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/v2.0/.well-known/openid-configuration`,
    };
  }
  return null;
}

export function enabledProviders(env: NodeJS.ProcessEnv = process.env): ProviderId[] {
  return (['google', 'microsoft'] as ProviderId[]).filter((p) => providerConfig(p, env));
}

/** Public URL of the app (invitation links, where SSO returns to). */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.APP_URL || env.URL || env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

/** Public URL of the API origin (the SSO callback). Same origin as the app in production. */
export function apiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.API_PUBLIC_URL) return env.API_PUBLIC_URL.replace(/\/+$/, '');
  if (env.APP_URL || env.URL) return appBaseUrl(env);
  return `http://localhost:${env.PORT || 3000}`;
}

export const redirectUri = (p: ProviderId, env: NodeJS.ProcessEnv = process.env) => `${apiBaseUrl(env)}/api/auth/sso/${p}/callback`;

/* ------------------------------------------------------------------------------------------
 * Discovery and keys (cached 10 minutes)
 * ---------------------------------------------------------------------------------------- */

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
const discoveryCache = new Map<string, { at: number; doc: Discovery }>();
const jwksCache = new Map<string, { at: number; keys: any[] }>();
const TTL = 10 * 60 * 1000;

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new SsoError('provider_unavailable', `The sign-in provider did not answer (${res.status}).`);
  return res.json();
}

export async function discover(cfg: ProviderConfig): Promise<Discovery> {
  const hit = discoveryCache.get(cfg.discoveryUrl);
  if (hit && Date.now() - hit.at < TTL) return hit.doc;
  const doc = await getJson(cfg.discoveryUrl);
  for (const k of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    if (typeof doc[k] !== 'string') throw new SsoError('provider_unavailable', 'The sign-in provider configuration is incomplete.');
  }
  discoveryCache.set(cfg.discoveryUrl, { at: Date.now(), doc });
  return doc;
}

async function signingKey(jwksUri: string, kid: string | undefined): Promise<KeyObject> {
  const find = (keys: any[]) => keys.find((k) => k.kty === 'RSA' && (!kid || k.kid === kid) && (!k.use || k.use === 'sig'));
  let cached = jwksCache.get(jwksUri);
  let key = cached && Date.now() - cached.at < TTL ? find(cached.keys) : undefined;
  if (!key) {
    // Unknown kid: the provider may have rotated its keys; refetch once.
    const doc = await getJson(jwksUri);
    cached = { at: Date.now(), keys: Array.isArray(doc.keys) ? doc.keys : [] };
    jwksCache.set(jwksUri, cached);
    key = find(cached.keys);
  }
  if (!key) throw new SsoError('invalid_token', 'The sign-in token was signed with an unknown key.');
  return createPublicKey({ key, format: 'jwk' });
}

export function clearSsoCaches() { discoveryCache.clear(); jwksCache.clear(); }

/* ------------------------------------------------------------------------------------------
 * Flow
 * ---------------------------------------------------------------------------------------- */

export class SsoError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const b64url = (buf: Buffer) => buf.toString('base64url');
export const pkceChallenge = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

/** p provider, s state, n nonce, v PKCE verifier, i invitation token, r "Keep me signed in". */
export interface SsoState { p: ProviderId; s: string; n: string; v: string; i?: string | null; r?: boolean }

/** Start: state, nonce and PKCE verifier (kept in a signed, short-lived cookie) and the provider URL. */
export async function beginSignIn(cfg: ProviderConfig, secret: string, inviteToken?: string | null, remember = false): Promise<{ url: string; stateCookie: string }> {
  const doc = await discover(cfg);
  const state: SsoState = { p: cfg.id, s: b64url(randomBytes(32)), n: b64url(randomBytes(32)), v: b64url(randomBytes(48)), i: inviteToken || null, r: remember === true };
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', redirectUri(cfg.id));
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state.s);
  url.searchParams.set('nonce', state.n);
  url.searchParams.set('code_challenge', pkceChallenge(state.v));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');
  const stateCookie = jwt.sign(state, secret, { expiresIn: '10m', audience: 'irongate-sso' });
  return { url: url.toString(), stateCookie };
}

/** Read and check the state cookie against the returned state (constant-time). */
export function checkState(provider: string, cookie: string | undefined, returnedState: unknown, secret: string): SsoState {
  if (!cookie) throw new SsoError('state_missing', 'The sign-in session expired or was started in another browser. Please try again.');
  let st: SsoState;
  try {
    st = jwt.verify(cookie, secret, { audience: 'irongate-sso' }) as SsoState;
  } catch {
    throw new SsoError('state_invalid', 'The sign-in session expired. Please try again.');
  }
  const a = Buffer.from(String(returnedState ?? ''));
  const b = Buffer.from(st.s);
  if (st.p !== provider || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new SsoError('state_mismatch', 'The sign-in response did not match this browser session. Please try again.');
  }
  return st;
}

export interface VerifiedIdentity { provider: ProviderId; subject: string; email: string; name: string | null; givenName: string | null; familyName: string | null }

/** Exchange the code (with the PKCE verifier) and verify the ID token. */
export async function completeSignIn(cfg: ProviderConfig, code: unknown, st: SsoState): Promise<VerifiedIdentity> {
  if (typeof code !== 'string' || !code) throw new SsoError('no_code', 'The sign-in provider returned no authorisation code.');
  const doc = await discover(cfg);
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri(cfg.id),
    client_id: cfg.clientId, client_secret: cfg.clientSecret, code_verifier: st.v,
  });
  const res = await fetch(doc.token_endpoint, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body,
    signal: AbortSignal.timeout(10_000),
  });
  const tokens: any = await res.json().catch(() => ({}));
  if (!res.ok || typeof tokens.id_token !== 'string') throw new SsoError('token_exchange_failed', 'The sign-in provider refused the sign-in.');
  const claims = await verifyIdToken(cfg, doc, tokens.id_token, st.n);
  return identityFrom(cfg, claims);
}

export async function verifyIdToken(cfg: ProviderConfig, doc: Discovery, idToken: string, nonce: string): Promise<any> {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded === 'string' || decoded.header.alg !== 'RS256') throw new SsoError('invalid_token', 'The sign-in token is not valid.');
  const key = await signingKey(doc.jwks_uri, decoded.header.kid);
  let claims: any;
  try {
    claims = jwt.verify(idToken, key, { algorithms: ['RS256'], audience: cfg.clientId, clockTolerance: 60 });
  } catch {
    throw new SsoError('invalid_token', 'The sign-in token is not valid (signature, audience or expiry).');
  }
  // Issuer: exact, except the Microsoft multi-tenant documents that carry a {tenantid} template.
  const expectedIss = doc.issuer.includes('{tenantid}') ? doc.issuer.replace('{tenantid}', String(claims.tid ?? '')) : doc.issuer;
  const issuers = cfg.id === 'google' ? [expectedIss, 'accounts.google.com', 'https://accounts.google.com'] : [expectedIss];
  if (!issuers.includes(claims.iss)) throw new SsoError('invalid_token', 'The sign-in token comes from an unexpected issuer.');
  const n = Buffer.from(String(claims.nonce ?? ''));
  const m = Buffer.from(nonce);
  if (n.length !== m.length || !timingSafeEqual(n, m)) throw new SsoError('nonce_mismatch', 'The sign-in token was not issued for this sign-in. Please try again.');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new SsoError('invalid_token', 'The sign-in token has no subject.');
  return claims;
}

function identityFrom(cfg: ProviderConfig, claims: any): VerifiedIdentity {
  let email: string | null = null;
  if (cfg.id === 'google') {
    if (claims.email && claims.email_verified === true) email = String(claims.email);
  } else {
    const singleTenant = !!cfg.tenant && !MULTI_TENANT.includes(cfg.tenant.toLowerCase());
    if (claims.email && (claims.email_verified === true || claims.xms_edov === true || claims.xms_edov === 'true' || singleTenant)) email = String(claims.email);
    else if (singleTenant && typeof claims.preferred_username === 'string' && claims.preferred_username.includes('@')) email = claims.preferred_username;
  }
  if (!email) throw new SsoError('email_unverified', `Your ${PROVIDER_LABEL[cfg.id]} account has no verified email address, so it cannot be matched to an IronGate account.`);
  return {
    provider: cfg.id, subject: claims.sub, email: email.trim().toLowerCase(),
    name: claims.name ?? null, givenName: claims.given_name ?? null, familyName: claims.family_name ?? null,
  };
}
