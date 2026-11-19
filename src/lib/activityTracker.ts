import API_URL from '../config/api';

/**
 * Screen views and client-side CSV exports for the user activity log (POST /api/activity/screen).
 * Batched (sent at most every 2 seconds, up to 10 events) and de-duplicated: the same screen and
 * team again within 10 seconds is not sent twice. The server takes the user and company from the
 * session (never from this body) and checks the team belongs to the company. Fire and forget:
 * a failure is ignored.
 */

type Event = { screen: string; teamId?: string | null; kind?: 'screen' | 'export' };

const queue: Event[] = [];
const lastSent = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;
const DEDUPE_MS = 10_000;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function flush() {
  timer = null;
  if (!queue.length) return;
  const events = queue.splice(0, 10);
  fetch(`${API_URL}/activity/screen`, {
    method: 'POST', credentials: 'include', keepalive: true,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }),
  }).catch(() => undefined);
  if (queue.length) timer = setTimeout(flush, 2000);
}

function push(e: Event) {
  const key = `${e.kind ?? 'screen'}|${e.screen}|${e.teamId ?? ''}`;
  const now = Date.now();
  if ((e.kind ?? 'screen') === 'screen' && now - (lastSent.get(key) ?? 0) < DEDUPE_MS) return;
  lastSent.set(key, now);
  queue.push(e);
  if (!timer) timer = setTimeout(flush, 2000);
}

/** The user opened a screen (a view of the app), optionally for one team. */
export function trackScreen(screen: string, teamId?: string | null) {
  const s = slug(screen);
  if (s) push({ screen: s, teamId: teamId ?? null });
}

/** The user exported a list as CSV in the browser (server-built CSVs are recorded by the server). */
export function trackExport(what: string) {
  const s = slug(what);
  if (s) push({ screen: s, kind: 'export' });
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); flush(); } });
