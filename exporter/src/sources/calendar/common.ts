/**
 * Calendar connectors (Google Calendar, Microsoft 365): what they send. Only free/busy is read: for each person and
 * working day, the day, the working hours, the day's offset from UTC and the busy intervals (start and end). No
 * title, attendee, location, description or organiser is requested from the calendar service, so none can be sent.
 * The person is a pseudonym (privacy.ts, matchablePerson): the e-mail address stays here. QE Navigator calculates
 * meeting time, focus time and interruptions per working day; nothing is calculated here.
 */
import type { CiRecord } from '../ci/common';

export interface Interval { start: number; end: number }

/** The offset from UTC, in minutes, of a time zone at noon UTC of a date (east of Greenwich is positive). */
export function utcOffsetMinutes(timeZone: string, day: string): number {
  const at = new Date(`${day}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
  const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'));
  return Math.round((local - at.getTime()) / 60_000);
}

/** The local date (YYYY-MM-DD) of an instant in a time zone. */
export function localDay(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/**
 * The working days to read: from the later of `since` and `lookbackDays` ago to yesterday (a day is sent once it is
 * over), Monday to Friday (or the weekdays given, 0 = Sunday).
 */
export function workingDays(since: Date, now: Date, timeZone: string, lookbackDays: number, weekdays: number[] = [1, 2, 3, 4, 5]): string[] {
  const today = localDay(timeZone, now);
  const first = localDay(timeZone, new Date(Math.max(since.getTime(), now.getTime() - lookbackDays * 86_400_000)));
  const out: string[] = [];
  for (let t = Date.parse(`${first}T00:00:00Z`); ; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (day >= today) break;
    if (weekdays.includes(new Date(t).getUTCDay())) out.push(day);
  }
  return out;
}

const hhmm = (v: string) => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };

/** The start and end (UTC instants) of a local day. */
export function dayBounds(day: string, offsetMinutes: number): Interval {
  const start = Date.parse(`${day}T00:00:00Z`) - offsetMinutes * 60_000;
  return { start, end: start + 86_400_000 };
}

export interface CalendarDayIn { person: string; day: string; workStart: string; workEnd: string; utcOffsetMinutes: number; outOfOffice?: boolean; busy: Interval[] }

/** One person's working day as it is sent: the busy intervals that touch the day, clipped to it, in time order. */
export function calendarDay(team: string, d: CalendarDayIn): CiRecord {
  const b = dayBounds(d.day, d.utcOffsetMinutes);
  const busy = d.busy.map((x) => ({ start: Math.max(x.start, b.start), end: Math.min(x.end, b.end) })).filter((x) => x.end > x.start).sort((x, y) => x.start - y.start || x.end - y.end).slice(0, 200);
  return { kind: 'calendar', team, id: `cal:${d.person.slice(0, 16)}:${d.day}`, at: b.start, item: {
    person: d.person, day: d.day, workStart: d.workStart, workEnd: d.workEnd, utcOffsetMinutes: d.utcOffsetMinutes, ...(d.outOfOffice ? { outOfOffice: true } : {}),
    busy: busy.map((x) => ({ start: new Date(x.start).toISOString(), end: new Date(x.end).toISOString() })),
  } };
}

/** True when the intervals cover at least half of the working hours of the day (an out-of-office day). */
export function coversHalfOfWork(day: string, offsetMinutes: number, workStart: string, workEnd: string, intervals: Interval[]): boolean {
  const b = dayBounds(day, offsetMinutes);
  const ws = b.start + hhmm(workStart) * 60_000;
  const we = b.start + hhmm(workEnd) * 60_000;
  let covered = 0;
  let cursor = ws;
  for (const x of [...intervals].sort((p, q) => p.start - q.start)) {
    const s = Math.max(x.start, cursor);
    const e = Math.min(x.end, we);
    if (e > s) { covered += e - s; cursor = e; }
  }
  return we > ws && covered >= (we - ws) / 2;
}
