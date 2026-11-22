/**
 * OAuth with the customer's OWN OAuth app (client id and secret they register with the vendor and enter on the
 * setup page; the redirect goes to the local setup page, http://127.0.0.1:<port>/oauth/callback). QE Navigator has
 * no OAuth app, never sees the client secret or the tokens, and is never in the redirect.
 *
 * Vendors with an OAuth authorization-code flow for a self-registered app: GitHub (OAuth app; for read-only
 * access a GitHub App or a fine-grained token is better, because GitHub's OAuth scopes for private repositories
 * include write), GitLab (application, scope read_api), Bitbucket Cloud (OAuth consumer with read permissions on
 * repositories, pipelines and account) and Linear (OAuth application, scope read). The others take a token or a
 * service account (Jira, Jenkins, Azure DevOps, SonarQube, PagerDuty, Opsgenie, Bitbucket Data Center).
 *
 * Tokens are kept in the credentials file (credentials.ts, 0600) and refreshed before a run when they expire.
 */
import { randomBytes, createHash } from 'node:crypto';
import { requestWithRetry, readCa } from './http';
import type { Config, SourceConfig } from './config';
import { credentialEntry, setCredential, type OAuthCredential } from './credentials';
import { addSecret, log } from './log';

export interface OAuthProvider { id: string; label: string; authorizeUrl: string; tokenUrl: string; scope: string | null; basicAuth: boolean; pkce: boolean; note: string }

/** The OAuth endpoints of a source (by its type and, for self-hosted ones, its URL), or null when the vendor has none for a self-registered app. */
export function providerFor(src: Pick<SourceConfig, 'type'> & { apiUrl?: string }): OAuthProvider | null {
  switch (src.type) {
    case 'github': {
      const api = src.apiUrl ?? 'https://api.github.com';
      const web = api === 'https://api.github.com' ? 'https://github.com' : api.replace(/\/api\/v3\/?$/, '');
      return { id: 'github', label: 'GitHub OAuth app', authorizeUrl: `${web}/login/oauth/authorize`, tokenUrl: `${web}/login/oauth/access_token`, scope: 'repo read:org', basicAuth: false, pkce: false,
        note: 'GitHub OAuth apps can only read private repositories with the repo scope, which also allows writing: prefer a GitHub App or a fine-grained token for read-only access.' };
    }
    case 'gitlab': {
      const web = (src.apiUrl ?? 'https://gitlab.com/api/v4').replace(/\/api\/v4\/?$/, '');
      return { id: 'gitlab', label: 'GitLab application', authorizeUrl: `${web}/oauth/authorize`, tokenUrl: `${web}/oauth/token`, scope: 'read_api', basicAuth: false, pkce: true, note: 'Scope read_api (read-only).' };
    }
    case 'bitbucket':
      return { id: 'bitbucket', label: 'Bitbucket OAuth consumer', authorizeUrl: 'https://bitbucket.org/site/oauth2/authorize', tokenUrl: 'https://bitbucket.org/site/oauth2/access_token', scope: null, basicAuth: true, pkce: false,
        note: 'Give the consumer the read permissions Account, Repositories and Pipelines (the scopes are set on the consumer).' };
    case 'linear':
      return { id: 'linear', label: 'Linear OAuth application', authorizeUrl: 'https://linear.app/oauth/authorize', tokenUrl: 'https://api.linear.app/oauth/token', scope: 'read', basicAuth: false, pkce: false, note: 'Scope read.' };
    default:
      return null;
  }
}

export interface PendingAuth { state: string; verifier: string | null; provider: OAuthProvider; clientId: string; clientSecret: string; redirectUri: string; credential: string }

/** The vendor's authorization URL for the customer's app, and what the callback needs to finish. */
export function startAuthorization(provider: OAuthProvider, clientId: string, clientSecret: string, redirectUri: string, credential: string): { url: string; pending: PendingAuth } {
  const state = randomBytes(24).toString('base64url');
  const verifier = provider.pkce ? randomBytes(48).toString('base64url') : null;
  const u = new URL(provider.authorizeUrl);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  if (provider.scope) u.searchParams.set('scope', provider.scope);
  if (verifier) { u.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url')); u.searchParams.set('code_challenge_method', 'S256'); }
  addSecret(clientSecret);
  return { url: u.toString(), pending: { state, verifier, provider, clientId, clientSecret, redirectUri, credential } };
}

async function tokenRequest(provider: OAuthProvider, clientId: string, clientSecret: string, params: Record<string, string>, caFile: string | null): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: string | null }> {
  const form = new URLSearchParams({ ...params, ...(provider.basicAuth ? {} : { client_id: clientId, client_secret: clientSecret }) });
  const res = await requestWithRetry({
    method: 'POST', url: provider.tokenUrl, body: form.toString(), timeoutMs: 30_000, ca: readCa(caFile),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...(provider.basicAuth ? { Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64') } : {}) },
  }, { maxRetries: 2 });
  let body: any = null;
  try { body = res.json(); } catch { body = null; }
  if (res.status < 200 || res.status >= 300 || !body?.access_token) {
    throw new Error(`the token request to ${new URL(provider.tokenUrl).host} failed (HTTP ${res.status}${body?.error ? `: ${String(body.error).slice(0, 100)}` : ''})`);
  }
  addSecret(body.access_token);
  addSecret(body.refresh_token);
  const expiresIn = Number(body.expires_in);
  return { accessToken: String(body.access_token), refreshToken: body.refresh_token ? String(body.refresh_token) : null, expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null };
}

/** Exchange the code of the callback for tokens, and keep them in the credentials file. */
export async function finishAuthorization(p: PendingAuth, code: string, credentialsPath: string, caFile: string | null = null): Promise<OAuthCredential> {
  const t = await tokenRequest(p.provider, p.clientId, p.clientSecret, { grant_type: 'authorization_code', code, redirect_uri: p.redirectUri, ...(p.verifier ? { code_verifier: p.verifier } : {}) }, caFile);
  const cred: OAuthCredential = { type: 'oauth', provider: p.provider.id, clientId: p.clientId, clientSecret: p.clientSecret, tokenUrl: p.provider.tokenUrl, ...t };
  setCredential(credentialsPath, p.credential, cred);
  return cred;
}

/** Refresh every OAuth credential of the config's sources that expires within 5 minutes (persist: write the new tokens). */
export async function refreshOAuth(cfg: Config, env: NodeJS.ProcessEnv = process.env, o: { persist?: boolean } = {}): Promise<number> {
  let n = 0;
  for (const src of cfg.sources.filter((s) => s.enabled)) {
    if (env[src.tokenEnv]) continue;
    const c = credentialEntry(src.tokenEnv);
    if (!c || typeof c === 'string' || !c.expiresAt || Date.parse(c.expiresAt) - Date.now() > 5 * 60_000) continue;
    if (!c.refreshToken) throw new Error(`${src.name}: the OAuth token expired and there is no refresh token: connect it again on the setup page`);
    const provider = { id: c.provider, label: c.provider, authorizeUrl: '', tokenUrl: c.tokenUrl, scope: null, basicAuth: c.provider === 'bitbucket', pkce: false, note: '' };
    const t = await tokenRequest(provider, c.clientId, c.clientSecret, { grant_type: 'refresh_token', refresh_token: c.refreshToken }, cfg.http.caFile);
    const next: OAuthCredential = { ...c, accessToken: t.accessToken, refreshToken: t.refreshToken ?? c.refreshToken, expiresAt: t.expiresAt };
    if (o.persist !== false) setCredential(cfg.credentialsPath, src.tokenEnv, next);
    log.info(`${src.name}: OAuth token refreshed`);
    n++;
  }
  return n;
}
