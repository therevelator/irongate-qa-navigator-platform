/**
 * Wellbeing pulse survey: the pure rules (questions, periods, score), shared by the API
 * (server/lib/pulse.ts) and the UI. No DB access here.
 */
import { K_ANONYMITY_MIN } from './privacy';

/**
 * How often a team is asked: every week or two weeks (whole days counted from the cadence's
 * start), every calendar month or every calendar quarter (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec).
 */
export type PulseCadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
export const PULSE_CADENCES: PulseCadence[] = ['weekly', 'biweekly', 'monthly', 'quarterly'];
/** Fixed-length cadences (days). Monthly and quarterly follow the calendar. */
export const CADENCE_DAYS: Record<'weekly' | 'biweekly', number> = { weekly: 7, biweekly: 14 };
/** Labels (UI and e-mails). */
export const CADENCE_LABELS: Record<PulseCadence, string> = {
  weekly: 'Every week', biweekly: 'Every two weeks', monthly: 'Every month', quarterly: 'Every three months',
};
/** Calendar months per period of a calendar cadence. */
const CALENDAR_MONTHS: Partial<Record<PulseCadence, number>> = { monthly: 1, quarterly: 3 };
/** A first calendar period shorter than this (days) runs on to the end of the following month / quarter. */
export const MIN_FIRST_PERIOD_DAYS = 7;
/** Longest period (days, a quarter) — for history windows. */
export const MAX_PERIOD_DAYS = 92;
export const DEFAULT_CADENCE: PulseCadence = 'biweekly';
/** Monday; periods of teams without a cadence row are counted from here. */
export const DEFAULT_ANCHOR = '2026-01-05';
/** Longest comment accepted (characters). */
export const PULSE_COMMENT_MAX = 500;
/** How many closed periods the results include (trend). */
export const PULSE_HISTORY_PERIODS = 12;

export const PULSE_QUESTIONS = [
  { key: 'workload', column: 'q_workload', text: 'My workload over this period was manageable.' },
  { key: 'focus', column: 'q_focus', text: 'I had enough uninterrupted time for focused work.' },
  { key: 'support', column: 'q_support', text: 'I felt supported by my team when I needed help.' },
  { key: 'energy', column: 'q_energy', text: 'I usually ended the day with energy left.' },
  { key: 'outlook', column: 'q_outlook', text: 'I feel positive about the coming weeks in this team.' },
] as const;
export type PulseQuestionKey = (typeof PULSE_QUESTIONS)[number]['key'];
export const PULSE_SCALE = { min: 1, max: 5, minLabel: 'Strongly disagree', maxLabel: 'Strongly agree' } as const;

/** Bands of the 0-100 wellbeing score: on target >= good, watch >= warning, below that low. */
export const WELLBEING_BANDS = { good: 70, warning: 50 } as const;

export const WELLBEING_FORMULA =
  'Wellbeing (survey), 0–100 = (mean of all answers on the 1–5 scale − 1) ÷ 4 × 100, over the anonymous pulse-survey ' +
  `responses of one closed period. Shown only with at least ${K_ANONYMITY_MIN} responses; the running period is never shown.`;

/* ------------------------------------------------------------------------------------------
 * Periods (pure)
 * ---------------------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;
const dayNum = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
const dayStr = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => dayStr(dayNum(d) + n);
export const todayUtc = () => new Date().toISOString().slice(0, 10);

export interface CadenceRow { cadence: PulseCadence; effective_from: string }
export interface PulsePeriod { start: string; end: string; cadence: PulseCadence }

/** The cadence row in force on `day` (latest effective_from <= day), else the default. */
export function cadenceAt(rows: CadenceRow[], day: string): CadenceRow {
  let best: CadenceRow | null = null;
  for (const r of rows) {
    if (r.effective_from <= day && (!best || r.effective_from > best.effective_from)) best = r;
  }
  return best ?? { cadence: DEFAULT_CADENCE, effective_from: DEFAULT_ANCHOR };
}

export const isCalendarCadence = (c: PulseCadence) => CALENDAR_MONTHS[c] !== undefined;

/** First day of the calendar month / quarter (months = 1 / 3) containing `day`. */
export function calendarUnitStart(day: string, months: number): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1;
  const um = m - (m % months);
  return `${y}-${String(um + 1).padStart(2, '0')}-01`;
}

/** The first of the month `n` months after the first-of-month `first`. */
export function addMonths(first: string, n: number): string {
  const y = Number(first.slice(0, 4));
  const m = Number(first.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
}

/** The first calendar boundary (month / quarter start) strictly after `day`. */
export function nextCalendarBoundary(day: string, months: number): string {
  return addMonths(calendarUnitStart(day, months), months);
}

/**
 * The period containing `day`: [start, end) with end exclusive.
 *   weekly / biweekly: blocks of 7 / 14 days counted from the cadence row's effective_from;
 *   monthly / quarterly: calendar months / quarters. When the row starts inside a month or
 *   quarter (a change takes effect when the running period ends), the first period runs from
 *   effective_from to the end of that month / quarter, or, if that leaves fewer than
 *   MIN_FIRST_PERIOD_DAYS days, to the end of the following one.
 * A period never starts before its row's effective_from.
 */
export function periodFor(rows: CadenceRow[], day: string): PulsePeriod {
  const c = cadenceAt(rows, day);
  const months = CALENDAR_MONTHS[c.cadence];
  if (months !== undefined) {
    const from = c.effective_from;
    let firstEnd = nextCalendarBoundary(from, months);
    if (dayNum(firstEnd) - dayNum(from) < MIN_FIRST_PERIOD_DAYS) firstEnd = addMonths(firstEnd, months);
    if (day < firstEnd) return { start: from, end: firstEnd, cadence: c.cadence };
    const start = calendarUnitStart(day, months);
    return { start, end: addMonths(start, months), cadence: c.cadence };
  }
  const len = CADENCE_DAYS[c.cadence as 'weekly' | 'biweekly'];
  const k = Math.floor((dayNum(day) - dayNum(c.effective_from)) / len);
  const start = dayNum(c.effective_from) + k * len;
  return { start: dayStr(start), end: dayStr(start + len), cadence: c.cadence };
}

/** Length of a period in days. */
export const periodDays = (p: { start: string; end: string }) => dayNum(p.end) - dayNum(p.start);

/**
 * What a cadence change does (pure): the change takes effect when the running period ends, so
 * the running period keeps its length. Asking for the cadence in force cancels a waiting change.
 * Returns the row to write (null = none; any waiting row is always replaced).
 */
export function planCadenceChange(rows: CadenceRow[], today: string, cadence: PulseCadence):
  { current: PulseCadence; insert: CadenceRow | null } {
  const now = cadenceAt(rows, today);
  if (cadence === now.cadence) return { current: now.cadence, insert: null };
  return { current: now.cadence, insert: { cadence, effective_from: periodFor(rows, today).end } };
}

/** The period after the one containing `day` (with the rows known now, waiting changes included). */
export function nextPeriod(rows: CadenceRow[], day: string): PulsePeriod {
  return periodFor(rows, periodFor(rows, day).end);
}

/** The period before the one containing `day`. */
export function previousPeriod(rows: CadenceRow[], day: string): PulsePeriod {
  return periodFor(rows, addDays(periodFor(rows, day).start, -1));
}

/** Score 0-100 from the mean answer on the 1-5 scale. */
export const wellbeingScore = (meanAnswer: number | null): number | null =>
  meanAnswer === null || !Number.isFinite(meanAnswer) ? null : Math.round(((meanAnswer - 1) / 4) * 1000) / 10;

/** Validate a submission body. Returns the answers or an error message. */
export function parseAnswers(body: any): { answers: Record<PulseQuestionKey, number>; comment: string | null } | { error: string } {
  const src = body?.answers && typeof body.answers === 'object' ? body.answers : {};
  const answers = {} as Record<PulseQuestionKey, number>;
  for (const q of PULSE_QUESTIONS) {
    const v = Number(src[q.key]);
    if (!Number.isInteger(v) || v < PULSE_SCALE.min || v > PULSE_SCALE.max) {
      return { error: `Answer every question with a whole number from ${PULSE_SCALE.min} to ${PULSE_SCALE.max} (missing or invalid: ${q.key}).` };
    }
    answers[q.key] = v;
  }
  let comment: string | null = null;
  if (body?.comment != null && body.comment !== '') {
    if (typeof body.comment !== 'string') return { error: 'The comment must be text.' };
    const text = body.comment.replace(/\s+/g, ' ').trim();
    if (text.length > PULSE_COMMENT_MAX) return { error: `The comment can be at most ${PULSE_COMMENT_MAX} characters.` };
    comment = text || null;
  }
  return { answers, comment };
}


/* ------------------------------------------------------------------------------------------
 * Non-response warning, reminders and escalation (pure)
 * ---------------------------------------------------------------------------------------- */

export type EscalateTo = 'team_lead' | 'department_managers' | 'both';
export const ESCALATE_TO: EscalateTo[] = ['team_lead', 'department_managers', 'both'];
export const ESCALATE_TO_LABELS: Record<EscalateTo, string> = {
  team_lead: 'The team lead', department_managers: 'The department managers', both: 'The team lead and the department managers',
};

export interface ReminderSettings {
  /** Days after the survey went out before a member who has not answered sees an in-app warning. */
  warningAfterDays: number;
  /** Automatic reminder e-mails to members who have not answered. */
  reminderEmails: boolean;
  reminderEveryDays: number;
  /** Days after the survey went out before the names of members who have not answered are sent on. */
  escalateAfterDays: number;
  escalateTo: EscalateTo;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  warningAfterDays: 2, reminderEmails: true, reminderEveryDays: 3, escalateAfterDays: 5, escalateTo: 'both',
};

export const REMINDER_LIMITS = {
  warningAfterDays: { min: 0, max: 30 },
  reminderEveryDays: { min: 1, max: 30 },
  escalateAfterDays: { min: 1, max: 60 },
} as const;

/** Validate a settings change (missing fields keep the current value). */
export function validateReminderSettings(input: any, current: ReminderSettings): { settings: ReminderSettings } | { error: string } {
  const out: ReminderSettings = { ...current };
  for (const k of ['warningAfterDays', 'reminderEveryDays', 'escalateAfterDays'] as const) {
    if (input?.[k] === undefined) continue;
    const v = input[k];
    const { min, max } = REMINDER_LIMITS[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return { error: `${k} must be a whole number from ${min} to ${max}` };
    out[k] = v;
  }
  if (input?.reminderEmails !== undefined) {
    if (typeof input.reminderEmails !== 'boolean') return { error: 'reminderEmails must be true or false' };
    out.reminderEmails = input.reminderEmails;
  }
  if (input?.escalateTo !== undefined) {
    if (!ESCALATE_TO.includes(input.escalateTo)) return { error: `escalateTo must be one of: ${ESCALATE_TO.join(', ')}` };
    out.escalateTo = input.escalateTo;
  }
  if (out.warningAfterDays >= out.escalateAfterDays) return { error: 'The warning must come before the escalation (fewer days).' };
  return { settings: out };
}

export interface EffectiveReminderSettings {
  warningAfterDays: number;
  reminderEveryDays: number;
  escalateAfterDays: number;
  /** True when a value was shortened to fit the period. */
  shortened: boolean;
}

/**
 * The values that apply in a period with `daysAvailable` days from the day the survey went out to
 * the period's end (exclusive): the escalation always lands before the period ends, and the
 * warning before the escalation. A weekly period (7 days) with the defaults keeps 2 / 3 / 5; a
 * setting of 10 days becomes 6.
 */
export function effectiveReminderSettings(s: ReminderSettings, daysAvailable: number): EffectiveReminderSettings {
  const lastDay = Math.max(0, daysAvailable - 1);
  const escalateAfterDays = Math.min(s.escalateAfterDays, lastDay);
  const warningAfterDays = Math.max(0, Math.min(s.warningAfterDays, escalateAfterDays - 1));
  const reminderEveryDays = Math.max(1, Math.min(s.reminderEveryDays, Math.max(1, lastDay)));
  return {
    warningAfterDays, reminderEveryDays, escalateAfterDays,
    shortened: escalateAfterDays !== s.escalateAfterDays || warningAfterDays !== s.warningAfterDays || reminderEveryDays !== s.reminderEveryDays,
  };
}

/** Whole days from `from` to `to` (YYYY-MM-DD). */
export const daysBetween = (from: string, to: string) => dayNum(to) - dayNum(from);
