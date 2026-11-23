/**
 * Google Calendar (Google Workspace), free/busy only.
 *
 * Auth: a service account with domain-wide delegation, limited to the scope
 * https://www.googleapis.com/auth/calendar.freebusy (free/busy only: it cannot read an event's title, attendees or
 * description). The Exporter signs a short-lived assertion with the service account's private key (kept here), acting
 * as `subject` (a user of your domain who may see colleagues' free/busy), and exchanges it for a token:
 *   POST <tokenUrl>  grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
 * Read:
 *   POST <apiUrl>/freeBusy { timeMin, timeMax, items: [{ id: <e-mail> }] }   busy intervals per person (start, end)
 * (a POST that only queries; nothing is written to a calendar). Working hours and the time zone come from the config.
 */
import { createSign } from 'node:crypto';
import type { GoogleCalendarSource, HttpSettings } from '../../config';
import { requireSecret } from '../../config';
import { requestWithRetry, readCa } from '../../http';
import { addSecret } from '../../log';
import { SourceClient, SourceError } from '../client';
import type { CiAdapter, CiPage } from '../ci/common';
import { calendarDay, dayBounds, utcOffsetMinutes, workingDays, type Interval } from './common';

const SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** The signed assertion of a service account acting as a user (RS256, valid 10 minutes). */
export function serviceAccountJwt(o: { serviceAccount: string; subject: string; tokenUrl: string; privateKeyPem: string }, now = Date.now()): string {
  const iat = Math.floor(now / 1000) - 30;
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: o.serviceAccount, sub: o.subject, scope: SCOPE, aud: o.tokenUrl, iat, exp: iat + 600 }));
  return `${head}.${body}.${b64url(createSign('RSA-SHA256').update(`${head}.${body}`).sign(o.privateKeyPem))}`;
}

export class GoogleCalendarAdapter implements CiAdapter {
  kind = 'ci' as const;
  private client: SourceClient;
  private key: string;
  private ready = false;

  constructor(private src: GoogleCalendarSource, private http: HttpSettings, private person: (email: string) => string | null, env: NodeJS.ProcessEnv = process.env) {
    this.key = requireSecret(src.tokenEnv, `sources.${src.name} (the service account's private key, PEM)`, env).replace(/\\n/g, '\n');
    this.client = new SourceClient({
      source: src.name, baseUrl: src.apiUrl, caFile: src.caFile, http, headers: {},
      authHint: `Give the service account domain-wide delegation for the scope ${SCOPE} only (Admin console → Security → API controls → Domain-wide delegation), and make "subject" a user who may see colleagues' free/busy.`,
    });
  }

  requests(): number { return this.client.requests; }

  describe(): string[] {
    return [
      `Google Calendar free/busy at ${this.src.apiUrl} (service account ${this.src.serviceAccount.replace(/^[^@]*/, '…')}, scope calendar.freebusy only), ${Object.keys(this.src.teams).length} people`,
      `per person and working day (${this.src.workStart}–${this.src.workEnd}, ${this.src.timeZone}): the busy intervals (start, end); no titles, attendees or descriptions; people as pseudonyms`,
    ];
  }

  private async auth(): Promise<void> {
    if (this.ready) return;
    let assertion: string;
    try { assertion = serviceAccountJwt({ serviceAccount: this.src.serviceAccount, subject: this.src.subject, tokenUrl: this.src.tokenUrl, privateKeyPem: this.key }); } catch (e) {
      throw new SourceError(`${this.src.name}: the service account key could not be used (${(e as Error).message.slice(0, 80)}): put the PEM private key in ${this.src.tokenEnv}`, null, true);
    }
    const res = await requestWithRetry({
      method: 'POST', url: this.src.tokenUrl, timeoutMs: this.http.timeoutSeconds * 1000, ca: readCa(this.src.caFile ?? this.http.caFile),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    }, { maxRetries: 2 }).catch((e: Error) => { throw new SourceError(`${this.src.name}: the token request failed: ${e.message.slice(0, 120)}`); });
    let body: any = null;
    try { body = res.json(); } catch { body = null; }
    if (res.status < 200 || res.status >= 300 || !body?.access_token) {
      throw new SourceError(`${this.src.name}: Google refused the service account (HTTP ${res.status}${body?.error ? `: ${String(body.error).slice(0, 80)}` : ''}). Check the domain-wide delegation and the scope ${SCOPE}.`, res.status, true);
    }
    addSecret(String(body.access_token));
    this.client.setHeader('Authorization', `Bearer ${body.access_token}`);
    this.ready = true;
  }

  private async freeBusy(emails: string[], from: number, to: number): Promise<Map<string, Interval[] | null>> {
    const out = new Map<string, Interval[] | null>();
    for (let i = 0; i < emails.length; i += 50) {
      const chunk = emails.slice(i, i + 50);
      const r = await this.client.postQuery<any>('/freeBusy', { timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: chunk.map((id) => ({ id })) });
      for (const e of chunk) {
        const c = r?.calendars?.[e];
        // A calendar that cannot be read (not found, no access) gives errors and no busy list: it is not a day without meetings.
        out.set(e, !c || (Array.isArray(c.errors) && c.errors.length) ? null : (c.busy ?? []).map((b: any) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })).filter((b: Interval) => b.end > b.start));
      }
    }
    return out;
  }

  async check(): Promise<string[]> {
    await this.auth();
    const now = Date.now();
    const emails = Object.keys(this.src.teams);
    const r = await this.freeBusy(emails.slice(0, 50), now - 86_400_000, now);
    const ok = Array.from(r.values()).filter((v) => v !== null).length;
    return [`free/busy readable for ${ok} of ${r.size} people checked`];
  }

  async *collect(since: Date, until: Date): AsyncIterable<CiPage> {
    const page: CiPage = { records: [], skipped: [], changedAt: null };
    const days = workingDays(since, until, this.src.timeZone, this.src.lookbackDays);
    if (!days.length) { yield page; return; }
    await this.auth();
    const first = dayBounds(days[0], utcOffsetMinutes(this.src.timeZone, days[0])).start;
    const lastOffset = utcOffsetMinutes(this.src.timeZone, days[days.length - 1]);
    const last = dayBounds(days[days.length - 1], lastOffset).end;
    const busy = await this.freeBusy(Object.keys(this.src.teams), first, last);
    for (const [email, team] of Object.entries(this.src.teams)) {
      const mine = busy.get(email);
      const person = this.person(email);
      if (!person) { page.skipped.push({ id: 'calendar', reason: 'people are not sent (privacy.developerMetrics is off, or no company id)' }); break; }
      if (mine === null || mine === undefined) { page.skipped.push({ id: `calendar ${person.slice(0, 12)}`, reason: 'free/busy not readable for this person (not found, or not shared with the subject user)' }); continue; }
      for (const day of days) {
        const offset = utcOffsetMinutes(this.src.timeZone, day);
        const b = dayBounds(day, offset);
        page.records.push(calendarDay(team, { person, day, workStart: this.src.workStart, workEnd: this.src.workEnd, utcOffsetMinutes: offset, busy: mine.filter((x) => x.end > b.start && x.start < b.end) }));
      }
    }
    page.changedAt = until.toISOString();
    yield page;
  }
}
