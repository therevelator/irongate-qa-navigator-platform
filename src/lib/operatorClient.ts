import API_URL from '../config/api';

/**
 * Platform operator API client (/operator, IronGate platform support). The operator signs in with
 * their own account (platform_operators, not a company user); the session is the httpOnly cookie
 * irongate_operator (8 hours), separate from any company session. Operators give no reason and
 * nothing they do is logged.
 */

export interface OperatorSession { email: string; name: string; expiresAt: string }

let session: OperatorSession | null = null;
const listeners = new Set<() => void>();

export const operatorSession = () => (session && Date.parse(session.expiresAt) > Date.now() ? session : null);
export function setOperatorSession(s: OperatorSession | null) {
  session = s;
  listeners.forEach((l) => l());
}
export function onOperatorSessionChange(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export class OperatorError extends Error {
  status: number;
  requestId?: string;
  constructor(status: number, message: string, requestId?: string) {
    super(message);
    this.status = status;
    this.requestId = requestId;
  }
}

export async function opFetch<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const res = await fetch(`${API_URL}/operator${path}`, {
    method: opts.method ?? 'GET', credentials: 'include', headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && body?.code === 'operator_session_required') setOperatorSession(null);
  if (!res.ok) {
    const details = Array.isArray(body?.details) ? `: ${body.details.join('; ')}` : Array.isArray(body?.errors) && body.errors.length > 1 ? `: ${body.errors.join('; ')}` : '';
    throw new OperatorError(res.status, `${body?.error || `Request failed (${res.status})`}${details}`, body?.requestId);
  }
  return body as T;
}

export type OperatorStatus = { available: false } | { available: true; allowed: boolean; session: OperatorSession | null };

/** Is platform support set up (404 when no operator exists), and is someone signed in? */
export async function fetchOperatorStatus(): Promise<OperatorStatus> {
  try {
    const res = await fetch(`${API_URL}/operator/status`, { credentials: 'include' });
    if (!res.ok) return { available: false };
    const b = await res.json();
    const s = b?.signedIn ? { email: b.email, name: b.name, expiresAt: b.expiresAt } : null;
    setOperatorSession(s);
    return { available: true, allowed: b?.allowed !== false, session: s };
  } catch {
    return { available: false };
  }
}

export async function operatorSignIn(email: string, password: string): Promise<OperatorSession> {
  const out = await opFetch<{ email: string; name: string; expiresAt: string }>('/login', { method: 'POST', body: { email, password } });
  const s = { email: out.email, name: out.name, expiresAt: out.expiresAt };
  setOperatorSession(s);
  return s;
}

export async function operatorSignOut(): Promise<void> {
  try { await opFetch('/logout', { method: 'POST' }); } catch { /* the session is dropped anyway */ }
  setOperatorSession(null);
}

/** Download a CSV export of the operator API (the browser saves the file). */
export async function opDownload(path: string, fallbackName = 'export.csv'): Promise<void> {
  const res = await fetch(`${API_URL}/operator${path}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new OperatorError(res.status, body?.error || `Export failed (${res.status})`, body?.requestId);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
