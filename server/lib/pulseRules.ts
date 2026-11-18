/**
 * Wellbeing pulse survey: the pure rules (questions, periods, score), shared by the API
 * (server/lib/pulse.ts) and the UI. No DB access here.
 */
import { K_ANONYMITY_MIN } from './privacy';

export type PulseCadence = 'weekly' | 'biweekly';
export const PULSE_CADENCES: PulseCadence[] = ['weekly', 'biweekly'];
export const CADENCE_DAYS: Record<PulseCadence, number> = { weekly: 7, biweekly: 14 };
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

/** The period containing `day`: [start, end) with end exclusive. */
export function periodFor(rows: CadenceRow[], day: string): PulsePeriod {
  const c = cadenceAt(rows, day);
  const len = CADENCE_DAYS[c.cadence];
  const k = Math.floor((dayNum(day) - dayNum(c.effective_from)) / len);
  const start = dayNum(c.effective_from) + k * len;
  return { start: dayStr(start), end: dayStr(start + len), cadence: c.cadence };
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

