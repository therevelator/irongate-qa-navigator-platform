/**
 * The credentials file the setup page writes: the secrets that are not in the environment, keyed by the same
 * variable names the config uses (QE_API_KEY, GITHUB_TOKEN, BITBUCKET_APP_PASSWORD, …).
 *
 *   - the folder is created 0700 and the file written 0600 (atomically: a temporary file, then a rename);
 *   - a value is a string, or an OAuth credential of the customer's OWN OAuth app ({ type: "oauth", provider,
 *     clientId, clientSecret, accessToken, refreshToken, expiresAt, tokenUrl });
 *   - every value is registered for redaction as it is loaded: no log line, preview or diagnostics bundle shows it;
 *   - nothing here is ever sent to QE Navigator (the QE Navigator key is sent only as the Authorization header).
 * An environment variable always wins over the file (secret() in config.ts).
 */
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { addSecret } from './log';

export interface OAuthCredential {
  type: 'oauth';
  provider: string;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string | null;
  /** ISO time the access token expires (null: does not expire). */
  expiresAt: string | null;
  tokenUrl: string;
}
export type Credential = string | OAuthCredential;

let loaded: { path: string; values: Record<string, Credential> } | null = null;

const register = (c: Credential) => {
  if (typeof c === 'string') addSecret(c);
  else { addSecret(c.accessToken); addSecret(c.refreshToken); addSecret(c.clientSecret); }
};

export class CredentialsError extends Error {}

/** Read the credentials file (absent: no credentials). A file readable by others is refused. */
export function loadCredentials(path: string): Record<string, Credential> {
  const abs = resolve(path);
  if (!existsSync(abs)) { loaded = { path: abs, values: {} }; return {}; }
  if (process.platform !== 'win32') {
    const mode = statSync(abs).mode & 0o777;
    if (mode & 0o077) throw new CredentialsError(`${abs} is readable by other users (mode ${mode.toString(8)}): run chmod 600 on it`);
  }
  let raw: any;
  try { raw = JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { throw new CredentialsError(`${abs} is not valid JSON: ${(e as Error).message}`); }
  const values: Record<string, Credential> = {};
  for (const [k, v] of Object.entries(raw?.values ?? {})) {
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(k)) continue;
    if (typeof v === 'string' && v) values[k] = v;
    else if (v && typeof v === 'object' && (v as any).type === 'oauth' && typeof (v as any).accessToken === 'string') values[k] = v as OAuthCredential;
  }
  for (const v of Object.values(values)) register(v);
  loaded = { path: abs, values };
  return values;
}

/** The value of a credential as a header needs it (OAuth: the access token), or null. */
export function credentialValue(name: string): string | null {
  const v = loaded?.values[name];
  if (!v) return null;
  return typeof v === 'string' ? v : v.accessToken;
}

export function credentialEntry(name: string): Credential | null {
  return loaded?.values[name] ?? null;
}

/** Names of the credentials kept (never their values). */
export function credentialNames(): string[] {
  return Object.keys(loaded?.values ?? {});
}

/** Write the credentials file: folder 0700, file 0600, atomically. */
export function saveCredentials(path: string, values: Record<string, Credential>): void {
  const abs = resolve(path);
  const dir = dirname(abs);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* not the owner: left as it is */ }
  const tmp = `${abs}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, JSON.stringify({ version: 1, note: 'QE Navigator Exporter credentials: keep this file private (0600). Never sent to QE Navigator.', values }, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  chmodSync(tmp, 0o600);
  renameSync(tmp, abs);
  for (const v of Object.values(values)) register(v);
  loaded = { path: abs, values: { ...values } };
}

/** Set (or remove, with null) one credential and write the file. */
export function setCredential(path: string, name: string, value: Credential | null): void {
  const current = loaded && loaded.path === resolve(path) ? { ...loaded.values } : existsSync(resolve(path)) ? loadCredentials(path) : {};
  if (value === null) delete current[name];
  else current[name] = value;
  saveCredentials(path, current);
}
