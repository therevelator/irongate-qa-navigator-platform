/**
 * Self-serve demo sandbox (the /try page): constants and pure rules shared by the server, the
 * scheduled reset and the tests. No database or other server imports here (the mailer, the session
 * code and the auth middleware import it).
 *
 * One fixed, fictional company (SANDBOX_COMPANY_ID, "Northwind Bank — demo") with four shared
 * persona users. Visitors are signed in as a persona for at most SANDBOX_SESSION_HOURS, without a
 * password; the company is rebuilt from scratch every night (server/lib/sandbox.ts).
 */

export const SANDBOX_COMPANY_ID = 'sandbox-demo';
export const SANDBOX_COMPANY_NAME = 'Northwind Bank — demo';
/** Reserved domain (RFC 2606): no address on it can ever receive e-mail. */
export const SANDBOX_EMAIL_DOMAIN = 'northwind-bank.example';
/** Id prefix of every row the sandbox build creates itself (departments, teams, users). */
export const SANDBOX_ID_PREFIX = 'sandbox-';

/** How long a sandbox sign-in lasts (JWT exp, the session row; the cookie is a browser-session cookie). */
export const SANDBOX_SESSION_HOURS = 2;

export const BOOK_DEMO_URL = 'https://irongate.ie/navigator';
export const START_PILOT_URL = 'https://irongate.ie/navigator/pilot';

export type SandboxPersonaKey = 'cto' | 'head_of_qa' | 'team_lead' | 'engineer';
export const SANDBOX_PERSONA_KEYS: SandboxPersonaKey[] = ['cto', 'head_of_qa', 'team_lead', 'engineer'];

export interface SandboxPersona {
  key: SandboxPersonaKey;
  /** The user id (fixed: the same shared user after every reset). */
  userId: string;
  label: string;
  first: string;
  last: string;
  title: string;
  /** What this persona sees, for the /try page. */
  description: string;
}

export const SANDBOX_PERSONAS: Record<SandboxPersonaKey, SandboxPersona> = {
  cto: {
    key: 'cto', userId: 'sandbox-u-cto', label: 'CTO', first: 'Alex', last: 'Morgan', title: 'Chief Technology Officer',
    description: 'The whole company: every department and team, the executive summary and business impact.',
  },
  head_of_qa: {
    key: 'head_of_qa', userId: 'sandbox-u-head-of-qa', label: 'Head of QA', first: 'Priya', last: 'Desai', title: 'Head of Quality Engineering',
    description: 'Both departments as their manager: targets, trends, alerts and the action plans of every team.',
  },
  team_lead: {
    key: 'team_lead', userId: 'sandbox-u-team-lead', label: 'Team lead', first: 'Sam', last: 'Okoye', title: 'Scrum Master, Mobile Banking',
    description: 'One team: its KPIs, forecasts, recommendations, action plan and wellbeing pulse.',
  },
  engineer: {
    key: 'engineer', userId: 'sandbox-u-engineer', label: 'Engineer', first: 'Jamie', last: 'Lindqvist', title: 'QA Automation Engineer, Mobile Banking',
    description: 'Your team read-only, your own developer metrics and the actions you own.',
  },
};

export const isSandboxPersonaKey = (v: unknown): v is SandboxPersonaKey => typeof v === 'string' && (SANDBOX_PERSONA_KEYS as string[]).includes(v);

export const isSandboxCompany = (companyId: unknown): boolean => companyId === SANDBOX_COMPANY_ID;

/** An address of the sandbox company: never mailed (server/lib/mailer.ts). */
export const isSandboxEmail = (email: unknown): boolean =>
  typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${SANDBOX_EMAIL_DOMAIN}`);

/** The answer to an action a sandbox session may not take (403). */
export const SANDBOX_REFUSED_CODE = 'sandbox_read_only';
export const SANDBOX_REFUSED_MESSAGE = 'Not available in the demo sandbox. Book a demo to see this with your own data.';

/** Limits, from the environment (with safe defaults). */
export function sandboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.SANDBOX_ENABLED ?? '').trim().toLowerCase() !== 'false';
}
export function sandboxSessionsPerIpHour(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SANDBOX_SESSIONS_PER_IP_HOUR);
  return Number.isInteger(n) && n > 0 ? n : 20;
}
export function sandboxMaxSessions(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SANDBOX_MAX_SESSIONS);
  return Number.isInteger(n) && n > 0 ? n : 300;
}

/* ------------------------------------------------------------------------------------------
 * What a sandbox session may do (enforced in authenticateToken, server/middleware/auth.ts)
 * ---------------------------------------------------------------------------------------- */

/**
 * The API path of a request with the /api prefix, whatever the mount (server/index.ts mounts under
 * /api; the Netlify function also answers under /.netlify/functions/api and without the prefix).
 */
export function apiPathOf(originalUrl: string): string {
  let p = (originalUrl || '/').split('?')[0].split('#')[0];
  p = p.replace(/^\/\.netlify\/functions\/api(?=\/|$)/, '');
  if (!p.startsWith('/')) p = `/${p}`;
  if (!/^\/api(\/|$)/.test(p)) p = `/api${p === '/' ? '' : p}`;
  // Collapse repeated slashes and drop a trailing slash (but keep "/api").
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 4 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

const SEG = '[A-Za-z0-9_-]{1,64}';
const re = (s: string) => new RegExp(`^${s.replace(/:id/g, SEG)}$`);

/**
 * Writes a sandbox session may make (everything else that is not a read is refused). Each is wiped
 * by the nightly reset. Bodies are narrowed (sandboxBody) so no visitor can leave free text that the
 * next visitor would see.
 */
const ALLOWED_WRITES: Array<{ method: string; path: RegExp }> = [
  { method: 'POST', path: re('/api/improve/recommendations/:id/(accept|dismiss|reopen)') },
  { method: 'POST', path: re('/api/improve/teams/:id/refresh') },
  { method: 'PATCH', path: re('/api/actions/:id') },
  { method: 'POST', path: re('/api/alerts/:id/acknowledge') },
  { method: 'POST', path: re('/api/notifications/read-all') },
  { method: 'POST', path: re('/api/notifications/:id/read') },
  // Rule-based summaries (no AI provider is ever called for a sandbox session: server/lib/groq.ts).
  { method: 'POST', path: re('/api/analytics/business-impact-v2/:id/ai-analysis') },
  { method: 'POST', path: re('/api/analytics/company-insights') },
];

/**
 * Reads a sandbox session may not make: API keys, the user activity log (other visitors' requests)
 * and every CSV export of people or activity.
 */
const REFUSED_READS: RegExp[] = [
  /^\/api\/admin\/api-keys(\/|$)/,
  /^\/api\/activity\/log(\/|\.csv|$)/,
  /^\/api\/admin\/.*\.csv$/,
];

/** Screen views of a sandbox session are acknowledged and not recorded. */
const NOOP_WRITES: Array<{ method: string; path: RegExp }> = [
  { method: 'POST', path: /^\/api\/activity\/screen$/ },
];

export type SandboxVerdict = 'allow' | 'refuse' | 'noop';

/** Whether a sandbox session may make this request (method + path as apiPathOf gives it). */
export function sandboxVerdict(method: string, path: string): SandboxVerdict {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') {
    return REFUSED_READS.some((r) => r.test(path)) ? 'refuse' : 'allow';
  }
  if (NOOP_WRITES.some((w) => w.method === m && w.path.test(path))) return 'noop';
  return ALLOWED_WRITES.some((w) => w.method === m && w.path.test(path)) ? 'allow' : 'refuse';
}

export const SANDBOX_DISMISS_REASONS = ['Not relevant for this team', 'Already being handled', 'The data is wrong', 'Not now (later)', 'Other'];

/**
 * The body a sandbox write may carry (allowed writes only): free text is dropped so nothing a visitor
 * types is shown to the next one. Returns null when the body asks for something else (refused).
 */
export function sandboxBody(method: string, path: string, body: any): Record<string, unknown> | null {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (method === 'PATCH' && /^\/api\/actions\//.test(path)) {
    // Only the status of a tracked action.
    const keys = Object.keys(b);
    if (!keys.length || keys.some((k) => k !== 'status')) return null;
    return { status: b.status };
  }
  if (/\/accept$/.test(path)) {
    // The recommendation's own title; owner and due date may be chosen.
    const out: Record<string, unknown> = {};
    if (b.ownerId !== undefined) out.ownerId = b.ownerId;
    if (b.dueDate !== undefined) out.dueDate = b.dueDate;
    return out;
  }
  if (/\/dismiss$/.test(path)) {
    return { reason: SANDBOX_DISMISS_REASONS.includes(b.reason) ? b.reason : 'Other' };
  }
  return {};
}
