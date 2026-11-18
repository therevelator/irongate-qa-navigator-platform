/**
 * Wellbeing pulse survey: the ONE module that reads and writes pulse_cadences,
 * pulse_responses and pulse_participation (migration 20261121200000).
 *
 * Survey: five statements answered on a 1-5 scale (1 = strongly disagree, 5 = strongly agree)
 * plus an optional comment, once per team and period.
 *
 * Periods: a team is asked every week, two weeks, calendar month or calendar quarter
 * (server/lib/pulseRules.ts periodFor). Weekly / biweekly periods are counted in whole days from
 * the effective_from date of the cadence in force (pulse_cadences), or from DEFAULT_ANCHOR
 * (a Monday) with DEFAULT_CADENCE when the team has none. A cadence change takes effect at the
 * start of the next period, so the running period keeps its length. Sending the survey by
 * e-mail (personal single-use links) lives in server/lib/pulseSend.ts.
 *
 * Anonymity:
 *   - an answer row has no user id and no timestamp; the period is the finest time it carries;
 *   - participation (who answered for which period) is stored separately, only to refuse a
 *     second answer, and shares nothing with an answer but team and period;
 *   - each submission rewrites the whole answer set of that team and period, in random order
 *     with fresh random ids, in the transaction that records the participation, so ids, row
 *     order and transaction ids do not tell which answer came last;
 *   - results are served only for CLOSED periods (never the running one, so watching the
 *     results change after one person answers is impossible), only as aggregates, and only with
 *     at least K_ANONYMITY_MIN (3) responses; comments only with the same threshold, sorted
 *     alphabetically (not in answer order), and only to leads, managers and admins.
 *
 * Wellbeing (survey) score, 0-100 = (mean of all answers on the 1-5 scale - 1) / 4 x 100.
 * It is the wellbeing signal of the app. "Workload balance (derived)" is a different signal
 * (calculated from developer workload metrics) and is never called wellbeing.
 */
import type pg from 'pg';
import { query, transaction } from '../../src/lib/db';
import { execOn } from './assignments';
import { K_ANONYMITY_MIN, SUPPRESSED_TEXT, isSuppressed, meetsKAnonymity } from './privacy';

export * from './pulseRules';
import {
  MAX_PERIOD_DAYS, PULSE_QUESTIONS, PULSE_HISTORY_PERIODS, addDays, cadenceAt, periodFor, planCadenceChange, previousPeriod, todayUtc, wellbeingScore,
  type CadenceRow, type PulseCadence, type PulsePeriod, type PulseQuestionKey,
} from './pulseRules';

/* ------------------------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------------------------- */

export async function loadCadences(teamIds: string[]): Promise<Map<string, CadenceRow[]>> {
  const out = new Map<string, CadenceRow[]>();
  if (!teamIds.length) return out;
  const rows = await query<any[]>(
    `SELECT team_id, cadence, to_char(effective_from, 'YYYY-MM-DD') AS effective_from
       FROM pulse_cadences WHERE team_id = ANY(?::varchar[]) ORDER BY effective_from`,
    [teamIds]
  );
  for (const r of rows) {
    const list = out.get(r.team_id) ?? [];
    list.push({ cadence: r.cadence, effective_from: r.effective_from });
    out.set(r.team_id, list);
  }
  return out;
}

export interface PeriodAggregate {
  team_id: string;
  start: string;
  end: string;
  responses: number;
  /** Mean of each question (1-5). */
  means: Record<PulseQuestionKey, number>;
  /** Mean of all answers (1-5). */
  overall: number;
}

/** Aggregates per team and period (no row-level data leaves this function). */
export async function loadPeriodAggregates(teamIds: string[], sinceDay: string, beforeDay: string): Promise<PeriodAggregate[]> {
  if (!teamIds.length) return [];
  const rows = await query<any[]>(
    `SELECT team_id, to_char(period_start, 'YYYY-MM-DD') AS start, to_char(period_end, 'YYYY-MM-DD') AS "end",
            COUNT(*)::int AS responses,
            ${PULSE_QUESTIONS.map((q) => `AVG(${q.column})::float8 AS ${q.key}`).join(', ')},
            AVG((${PULSE_QUESTIONS.map((q) => q.column).join(' + ')})::float8 / ${PULSE_QUESTIONS.length})::float8 AS overall
       FROM pulse_responses
      WHERE team_id = ANY(?::varchar[]) AND period_end > ?::date AND period_end <= ?::date
      GROUP BY team_id, period_start, period_end
      ORDER BY team_id, period_start`,
    [teamIds, sinceDay, beforeDay]
  );
  return rows.map((r: any) => ({
    team_id: r.team_id,
    start: r.start,
    end: r.end,
    responses: Number(r.responses),
    means: Object.fromEntries(PULSE_QUESTIONS.map((q) => [q.key, Number(r[q.key])])) as Record<PulseQuestionKey, number>,
    overall: Number(r.overall),
  }));
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export interface PulsePeriodResult {
  start: string;
  /** Last day of the period (inclusive). */
  lastDay: string;
  end: string;
  suppressed: boolean;
  reason: string | null;
  /** Number of responses when shown; null when suppressed (not revealed). */
  responses: number | null;
  /** Wellbeing (survey) score 0-100; null when suppressed. */
  score: number | null;
  questions: Array<{ key: PulseQuestionKey; text: string; mean: number }> | null;
}

/** One closed period's result with the k-anonymity rule applied. */
export function periodResult(agg: { start: string; end: string; responses: number; means?: Record<PulseQuestionKey, number>; overall?: number }): PulsePeriodResult {
  const ok = meetsKAnonymity(agg.responses);
  const hidden = isSuppressed(agg.responses);
  return {
    start: agg.start,
    lastDay: addDays(agg.end, -1),
    end: agg.end,
    suppressed: hidden,
    reason: hidden ? SUPPRESSED_TEXT : null,
    responses: hidden ? null : agg.responses,
    score: ok && agg.overall !== undefined ? wellbeingScore(agg.overall) : null,
    questions: ok && agg.means ? PULSE_QUESTIONS.map((q) => ({ key: q.key, text: q.text, mean: r1(agg.means![q.key]) })) : null,
  };
}

export interface TeamPulse {
  teamId: string;
  cadence: PulseCadence;
  /** A cadence change waiting for the next period (null when none). */
  pendingCadence: { cadence: PulseCadence; from: string } | null;
  currentPeriod: { start: string; end: string; lastDay: string; responded: boolean; responsesSoFar: number | null; responsesSoFarText: string };
  /** Closed periods with any response, newest last (trend), with suppression applied. */
  periods: PulsePeriodResult[];
  /** The period just before the running one (the team's current wellbeing). */
  latest: PulsePeriodResult;
  /** Comments of the latest period (only when shown and the caller may read them). */
  comments: string[] | null;
  threshold: number;
}

/** Everything the pulse page and Team detail show for one team, for one caller. */
export async function teamPulse(teamId: string, userId: string, opts: { withComments: boolean; today?: string }): Promise<TeamPulse> {
  const today = opts.today ?? todayUtc();
  const cadences = (await loadCadences([teamId])).get(teamId) ?? [];
  const current = periodFor(cadences, today);
  const prev = previousPeriod(cadences, today);
  const pending = cadences.filter((c) => c.effective_from > today).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0] ?? null;

  const since = addDays(today, -MAX_PERIOD_DAYS * (PULSE_HISTORY_PERIODS + 1));
  const aggs = (await loadPeriodAggregates([teamId], since, current.start)).filter((a) => a.end <= today);
  const periods = aggs.map(periodResult).slice(-PULSE_HISTORY_PERIODS);
  const prevAgg = aggs.find((a) => a.start === prev.start && a.end === prev.end);
  const latest = periodResult(prevAgg ?? { start: prev.start, end: prev.end, responses: 0 });

  const [{ responded }] = await query<any[]>(
    `SELECT EXISTS (SELECT 1 FROM pulse_participation WHERE team_id = ? AND user_id = ? AND period_start = ?::date) AS responded`,
    [teamId, userId, current.start]
  );
  const [{ n }] = await query<any[]>(
    `SELECT COUNT(*)::int AS n FROM pulse_responses WHERE team_id = ? AND period_start = ?::date`,
    [teamId, current.start]
  );
  const soFar = Number(n);

  let comments: string[] | null = null;
  if (opts.withComments && !latest.suppressed) {
    const rows = await query<any[]>(
      `SELECT comment FROM pulse_responses WHERE team_id = ? AND period_start = ?::date AND period_end = ?::date AND comment IS NOT NULL`,
      [teamId, prev.start, prev.end]
    );
    comments = rows.map((r: any) => String(r.comment)).sort((a, b) => a.localeCompare(b));
  }

  return {
    teamId,
    cadence: cadenceAt(cadences, today).cadence,
    pendingCadence: pending ? { cadence: pending.cadence, from: pending.effective_from } : null,
    currentPeriod: {
      start: current.start,
      end: current.end,
      lastDay: addDays(current.end, -1),
      responded: !!responded,
      responsesSoFar: meetsKAnonymity(soFar) ? soFar : null,
      responsesSoFarText: soFar === 0 ? 'No responses yet' : meetsKAnonymity(soFar) ? `${soFar} responses so far` : `Fewer than ${K_ANONYMITY_MIN} responses so far`,
    },
    periods,
    latest,
    comments,
    threshold: K_ANONYMITY_MIN,
  };
}

export interface CompanyWellbeing {
  /** Response-weighted mean of the teams' latest-period scores (0-100); null when no team qualifies. */
  value: number | null;
  /** Teams with a shown latest-period result / teams asked. */
  teamsReporting: number;
  teamsTotal: number;
  /** Teams whose latest period had responses but fewer than the threshold (left out). */
  teamsSuppressed: number;
  responses: number;
  method: string;
}

/**
 * Wellbeing (survey) over several teams (company or department): the teams' latest closed
 * period, teams below the threshold left out (so no team's suppressed result can be worked out
 * from the total), weighted by responses (= the mean over all those responses).
 */
export async function wellbeingAcrossTeams(teamIds: string[], today = todayUtc()): Promise<CompanyWellbeing> {
  const method =
    'Wellbeing (survey): mean of the anonymous pulse-survey answers of each team’s latest closed period, (mean − 1) ÷ 4 × 100, ' +
    `over teams with at least ${K_ANONYMITY_MIN} responses (teams below that are left out), weighted by responses.`;
  if (!teamIds.length) return { value: null, teamsReporting: 0, teamsTotal: 0, teamsSuppressed: 0, responses: 0, method };
  const cadences = await loadCadences(teamIds);
  const prevOf = new Map(teamIds.map((id) => [id, previousPeriod(cadences.get(id) ?? [], today)]));
  const earliest = [...prevOf.values()].reduce((m, p) => (p.start < m ? p.start : m), today);
  const aggs = await loadPeriodAggregates(teamIds, addDays(earliest, -1), today);
  let sum = 0, n = 0, reporting = 0, suppressed = 0;
  for (const id of teamIds) {
    const p = prevOf.get(id)!;
    const a = aggs.find((x) => x.team_id === id && x.start === p.start && x.end === p.end);
    if (!a) continue;
    if (!meetsKAnonymity(a.responses)) { suppressed++; continue; }
    reporting++;
    sum += a.overall * a.responses;
    n += a.responses;
  }
  return { value: n ? wellbeingScore(sum / n) : null, teamsReporting: reporting, teamsTotal: teamIds.length, teamsSuppressed: suppressed, responses: n, method };
}

/* ------------------------------------------------------------------------------------------
 * Writes
 * ---------------------------------------------------------------------------------------- */

export class PulseError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Record one answer for the running period. In one transaction (serialised per team and
 * period): the participation row (a second answer is refused with 409), then the team's answer
 * set for the period is rewritten in random order with fresh ids (demo rows keep theirs).
 */
export async function submitPulseResponse(args: {
  companyId: string; teamId: string; userId: string;
  answers: Record<PulseQuestionKey, number>; comment: string | null; today?: string;
}): Promise<PulsePeriod> {
  const today = args.today ?? todayUtc();
  const cadences = (await loadCadences([args.teamId])).get(args.teamId) ?? [];
  const period = periodFor(cadences, today);
  await transaction(async (client: pg.PoolClient) => {
    const exec = execOn(client);
    await exec(`SELECT pg_advisory_xact_lock(hashtext(?))`, [`pulse:${args.teamId}:${period.start}`]);
    const ins = await exec(
      `INSERT INTO pulse_participation (company_id, team_id, user_id, period_start) VALUES (?, ?, ?, ?::date)
       ON CONFLICT DO NOTHING RETURNING team_id`,
      [args.companyId, args.teamId, args.userId, period.start]
    );
    if (!ins.length) throw new PulseError(409, 'You have already answered the survey for this period.');
    const cols = PULSE_QUESTIONS.map((q) => q.column);
    await exec(
      `WITH old AS (
         DELETE FROM pulse_responses WHERE team_id = ? AND period_start = ?::date
         RETURNING id, company_id, team_id, period_start, period_end, ${cols.join(', ')}, comment
       ), all_rows AS (
         SELECT id, company_id, team_id, period_start, period_end, ${cols.join(', ')}, comment FROM old
         UNION ALL
         SELECT NULL, ?, ?, ?::date, ?::date, ${cols.map(() => '?::smallint').join(', ')}, ?::text
       )
       INSERT INTO pulse_responses (id, company_id, team_id, period_start, period_end, ${cols.join(', ')}, comment)
       SELECT CASE WHEN id LIKE 'demo-%' THEN id ELSE gen_random_uuid()::text END,
              company_id, team_id, period_start, period_end, ${cols.join(', ')}, comment
         FROM all_rows ORDER BY random()`,
      [
        args.teamId, period.start,
        args.companyId, args.teamId, period.start, period.end,
        ...PULSE_QUESTIONS.map((q) => args.answers[q.key]),
        args.comment,
      ]
    );
    // Personal survey links of this person for this period stop working (single use).
    await exec(`UPDATE pulse_links SET used = TRUE WHERE team_id = ? AND user_id = ? AND period_start = ?::date AND NOT used`,
      [args.teamId, args.userId, period.start]);
  });
  return period;
}

/**
 * Change a team's cadence from the start of the next period (a change already waiting is
 * replaced). Asking for the cadence in force cancels a waiting change. Returns the cadence in
 * force and the change now waiting (null when none).
 */
export async function setPulseCadence(args: { companyId: string; teamId: string; cadence: PulseCadence; actorId: string; today?: string }):
  Promise<{ current: PulseCadence; pending: { cadence: PulseCadence; from: string } | null; previousPending: { cadence: PulseCadence; from: string } | null }> {
  const today = args.today ?? todayUtc();
  const cadences = (await loadCadences([args.teamId])).get(args.teamId) ?? [];
  const plan = planCadenceChange(cadences, today, args.cadence);
  const waiting = cadences.find((c) => c.effective_from > today) ?? null;
  await transaction(async (client: pg.PoolClient) => {
    const exec = execOn(client);
    await exec(`DELETE FROM pulse_cadences WHERE team_id = ? AND effective_from > ?::date`, [args.teamId, today]);
    if (plan.insert) {
      await exec(
        `INSERT INTO pulse_cadences (company_id, team_id, cadence, effective_from, created_by) VALUES (?, ?, ?, ?::date, ?)`,
        [args.companyId, args.teamId, plan.insert.cadence, plan.insert.effective_from, args.actorId]
      );
    }
  });
  return {
    current: plan.current,
    pending: plan.insert ? { cadence: plan.insert.cadence, from: plan.insert.effective_from } : null,
    previousPending: waiting ? { cadence: waiting.cadence, from: waiting.effective_from } : null,
  };
}
