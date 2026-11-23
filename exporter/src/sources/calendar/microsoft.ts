/**
 * Microsoft 365 (Exchange Online) through Microsoft Graph, free/busy only.
 *
 * Auth: an app registration of your own tenant with the APPLICATION permission Calendars.ReadBasic.All (free/busy,
 * start and end; it cannot read an event's body or attachments), signed in with its client secret:
 *   POST <loginUrl>/<tenantId>/oauth2/v2.0/token  grant_type=client_credentials, scope https://graph.microsoft.com/.default
 * Read:
 *   POST <apiUrl>/users/<a person>/calendar/getSchedule { schedules: [<e-mails>], startTime, endTime }
 *     per person: scheduleItems (status, start, end) and workingHours (start and end time of day)
 * (a POST that only queries; nothing is written to a calendar). Only the status, start and end of each item are
 * used: a subject or location Graph may include is never read into the record. busy and tentative items are busy;
 * "oof" items covering at least half the working hours make the day an out-of-office day. The time zone of the
 * config is used for the day's offset from UTC.
 */
import type { HttpSettings, Microsoft365Source } from '../../config';
import { requireSecret } from '../../config';
import { requestWithRetry, readCa } from '../../http';
import { addSecret } from '../../log';
import { SourceClient, SourceError } from '../client';
import type { CiAdapter, CiPage } from '../ci/common';
import { calendarDay, coversHalfOfWork, dayBounds, utcOffsetMinutes, workingDays, type Interval } from './common';

const utc = (v: any): number => Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(String(v?.dateTime ?? '')) ? String(v.dateTime) : `${String(v?.dateTime ?? '')}Z`);
const hhmm = (v: unknown): string | null => { const m = /^(\d\d):(\d\d)/.exec(String(v ?? '')); return m ? `${m[1]}:${m[2]}` : null; };

interface Schedule { busy: Interval[]; oof: Interval[]; workStart: string | null; workEnd: string | null }

export class Microsoft365Adapter implements CiAdapter {
  kind = 'ci' as const;
  private client: SourceClient;
  private secret: string;
  private ready = false;

  constructor(private src: Microsoft365Source, private http: HttpSettings, private person: (email: string) => string | null, env: NodeJS.ProcessEnv = process.env) {
    this.secret = requireSecret(src.tokenEnv, `sources.${src.name} (the app registration's client secret)`, env);
    this.client = new SourceClient({
      source: src.name, baseUrl: src.apiUrl, caFile: src.caFile, http, headers: {},
      authHint: 'Give the app registration the application permission Calendars.ReadBasic.All (Microsoft Graph) with admin consent, and nothing else.',
    });
  }

  requests(): number { return this.client.requests; }

  describe(): string[] {
    return [
      `Microsoft Graph at ${this.src.apiUrl} (app registration, client credentials, Calendars.ReadBasic.All), ${Object.keys(this.src.teams).length} people`,
      `per person and working day (${this.src.workStart}–${this.src.workEnd} unless the person's own working hours are given, ${this.src.timeZone}): the busy intervals (start, end); no subjects, attendees or bodies; people as pseudonyms`,
    ];
  }

  private async auth(): Promise<void> {
    if (this.ready) return;
    const res = await requestWithRetry({
      method: 'POST', url: `${this.src.loginUrl}/${encodeURIComponent(this.src.tenantId)}/oauth2/v2.0/token`, timeoutMs: this.http.timeoutSeconds * 1000, ca: readCa(this.src.caFile ?? this.http.caFile),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.src.clientId, client_secret: this.secret, scope: 'https://graph.microsoft.com/.default' }).toString(),
    }, { maxRetries: 2 }).catch((e: Error) => { throw new SourceError(`${this.src.name}: the token request failed: ${e.message.slice(0, 120)}`); });
    let body: any = null;
    try { body = res.json(); } catch { body = null; }
    if (res.status < 200 || res.status >= 300 || !body?.access_token) {
      throw new SourceError(`${this.src.name}: Microsoft refused the app registration (HTTP ${res.status}${body?.error ? `: ${String(body.error).slice(0, 80)}` : ''}). Check the tenant id, the client id and the secret.`, res.status, true);
    }
    addSecret(String(body.access_token));
    this.client.setHeader('Authorization', `Bearer ${body.access_token}`);
    this.ready = true;
  }

  private async schedules(emails: string[], from: number, to: number): Promise<Map<string, Schedule | null>> {
    const out = new Map<string, Schedule | null>();
    const t = (ms: number) => ({ dateTime: new Date(ms).toISOString().replace(/\.\d{3}Z$/, ''), timeZone: 'UTC' });
    for (let i = 0; i < emails.length; i += 20) {
      const chunk = emails.slice(i, i + 20);
      const r = await this.client.postQuery<any>(`/users/${encodeURIComponent(chunk[0])}/calendar/getSchedule`, { schedules: chunk, startTime: t(from), endTime: t(to), availabilityViewInterval: 30 });
      const byId = new Map<string, any>((r?.value ?? []).map((s: any) => [String(s.scheduleId ?? '').toLowerCase(), s]));
      for (const e of chunk) {
        const s = byId.get(e.toLowerCase());
        if (!s || s.error) { out.set(e, null); continue; }
        const items: any[] = s.scheduleItems ?? [];
        const span = (x: any): Interval => ({ start: utc(x.start), end: utc(x.end) });
        const valid = (x: Interval) => !Number.isNaN(x.start) && !Number.isNaN(x.end) && x.end > x.start;
        out.set(e, {
          busy: items.filter((x) => x.status === 'busy' || x.status === 'tentative').map(span).filter(valid),
          oof: items.filter((x) => x.status === 'oof').map(span).filter(valid),
          workStart: hhmm(s.workingHours?.startTime), workEnd: hhmm(s.workingHours?.endTime),
        });
      }
    }
    return out;
  }

  async check(): Promise<string[]> {
    await this.auth();
    const now = Date.now();
    const r = await this.schedules(Object.keys(this.src.teams).slice(0, 20), now - 86_400_000, now);
    return [`free/busy readable for ${Array.from(r.values()).filter((v) => v !== null).length} of ${r.size} people checked`];
  }

  async *collect(since: Date, until: Date): AsyncIterable<CiPage> {
    const page: CiPage = { records: [], skipped: [], changedAt: null };
    const days = workingDays(since, until, this.src.timeZone, this.src.lookbackDays);
    if (!days.length) { yield page; return; }
    await this.auth();
    const first = dayBounds(days[0], utcOffsetMinutes(this.src.timeZone, days[0])).start;
    const last = dayBounds(days[days.length - 1], utcOffsetMinutes(this.src.timeZone, days[days.length - 1])).end;
    const all = await this.schedules(Object.keys(this.src.teams), first, last);
    for (const [email, team] of Object.entries(this.src.teams)) {
      const s = all.get(email);
      const person = this.person(email);
      if (!person) { page.skipped.push({ id: 'calendar', reason: 'people are not sent (privacy.developerMetrics is off, or no company id)' }); break; }
      if (!s) { page.skipped.push({ id: `calendar ${person.slice(0, 12)}`, reason: 'free/busy not readable for this person (unknown mailbox, or no permission)' }); continue; }
      const workStart = s.workStart && s.workEnd && s.workEnd > s.workStart ? s.workStart : this.src.workStart;
      const workEnd = s.workStart && s.workEnd && s.workEnd > s.workStart ? s.workEnd : this.src.workEnd;
      for (const day of days) {
        const offset = utcOffsetMinutes(this.src.timeZone, day);
        const b = dayBounds(day, offset);
        const within = (x: Interval) => x.end > b.start && x.start < b.end;
        page.records.push(calendarDay(team, {
          person, day, workStart, workEnd, utcOffsetMinutes: offset, outOfOffice: coversHalfOfWork(day, offset, workStart, workEnd, s.oof.filter(within)), busy: s.busy.filter(within),
        }));
      }
    }
    page.changedAt = until.toISOString();
    yield page;
  }
}
