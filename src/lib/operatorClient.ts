import API_URL from '../config/api';

/**
 * Platform operator API client. The operator token lives in memory only (this module), never in
 * localStorage or a cookie: a reload or a new tab asks for the password again. Requests carry the
 * session cookie AND the operator token (X-Operator-Token); company views carry the reason the
 * operator gave for opening the company (X-Operator-Reason).
 */

let token: string | null = null;
let expiresAt: string | null = null;
const listeners = new Set<() => void>();

export const operatorSession = () => (token && expiresAt && Date.parse(expiresAt) > Date.now() ? { expiresAt } : null);
export function setOperatorSession(t: string | null, exp: string | null) {
  token = t;
  expiresAt = exp;
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

export async function opFetch<T = any>(path: string, opts: { method?: string; body?: unknown; reason?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Operator-Token'] = token;
  if (opts.reason) headers['X-Operator-Reason'] = opts.reason;
  const res = await fetch(`${API_URL}/operator${path}`, {
    method: opts.method ?? 'GET', credentials: 'include', headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && body?.code === 'operator_session_required') setOperatorSession(null, null);
  if (!res.ok) throw new OperatorError(res.status, body?.error || `Request failed (${res.status})`, body?.requestId);
  return body as T;
}

/** Is the signed-in user a platform operator? (false when the feature is off or on error) */
export async function fetchOperatorStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/operator/status`, { credentials: 'include' });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.operator === true;
  } catch {
    return false;
  }
}
