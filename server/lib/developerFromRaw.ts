/**
 * Developer metrics calculated from records, not typed in.
 *
 * Sources (sent by the QE Navigator Exporter, or the API): pull requests (pull_requests_raw: opened, first
 * review, merged) and calendar free/busy intervals per person and working day (calendar_days, calendar_busy).
 * No title, no attendee, no description is received; a person is a pseudonym:
 *
 *   personHash = sha256( lower(e-mail) + ':' + company id )
 *
 * which the Exporter computes and QE Navigator can compute for its own users. A record is kept with its
 * pseudonym only when it is that of a user of the company who enabled developer insights
 * (users.developer_insights_enabled); otherwise the pull request is kept without an author and the calendar
 * day is not kept at all.
 *
 * Per developer of a team (an opted-in, active user assigned to the team), over the DEV_WINDOW_DAYS days
 * ending today:
 *
 *   pr_merge_time_avg         mean hours from opened to merged, pull requests they opened, merged in the window
 *   code_review_time_avg      mean hours from opened to the first review by someone else, same pull requests
 *                             opened in the window that have a review
 *   meeting_time_hours        mean hours per working day in busy intervals, inside the working hours
 *                             (overlapping intervals count once)
 *   focus_time_hours          mean hours per working day in free blocks of at least FOCUS_BLOCK_MINUTES
 *                             inside the working hours
 *   context_switches_per_day  mean number of separate busy blocks per working day (each one interrupts work)
 *   happiness_score           workload balance (derived): calculateWorkloadBalance of the five values
 *
 * A working day is a day whose calendar was read and that is not out of office. A value without records is
 * empty (never 0). The current row goes to developer_metrics (source 'computed'), and a daily snapshot to
 * developer_productivity_snapshots (the DDPS history) once all five values exist.
 */
import { createHash } from 'crypto';
import type pg from 'pg';
import { calculateWorkloadBalance } from '../../src/data/advancedFeatures';
import { computeDdps } from './metricFormulas';
import { isTeamMemberSql } from './assignments';

export const DEV_WINDOW_DAYS = 30;
export const FOCUS_BLOCK_MINUTES = 120;

/** The pseudonym of a person in a company (the Exporter computes the same from the tool's e-mail address). */
export const personHash = (email: string, companyId: string): string =>
  createHash('sha256').update(`${String(email).trim().toLowerCase()}:${companyId}`).digest('hex');

export const PERSON_HASH_RE = /^[0-9a-f]{64}$/;

/** The pseudonyms QE Navigator may keep: the company's active users who enabled developer insights (hash → user id). */
export async function optedInHashes(client: pg.PoolClient, companyId: string): Promise<Map<string, string>> {
  const rows = (await client.query(
    `SELECT id, email FROM users WHERE company_id = $1 AND is_active = TRUE AND developer_insights_enabled = TRUE AND email IS NOT NULL`, [companyId])).rows;
  return new Map(rows.map((u: any) => [personHash(u.email, companyId), String(u.id)]));
}

export interface BusyInterval { start: number; end: number }
export interface DayStats { meetingMinutes: number; focusMinutes: number; busyBlocks: number }

/** One working day: the busy intervals clipped to the working hours and merged; the free blocks of the rest. */
export function dayStats(workStart: number, workEnd: number, busy: BusyInterval[], focusBlockMinutes = FOCUS_BLOCK_MINUTES): DayStats {
  const clipped = busy.map((b) => ({ start: Math.max(b.start, workStart), end: Math.min(b.end, workEnd) })).filter((b) => b.end > b.start).sort((a, b) => a.start - b.start);
  const merged: BusyInterval[] = [];
  for (const b of clipped) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  }
  const meetingMinutes = merged.reduce((n, b) => n + (b.end - b.start), 0) / 60_000;
  let focusMinutes = 0;
  let cursor = workStart;
  for (const b of [...merged, { start: workEnd, end: workEnd }]) {
    const free = (b.start - cursor) / 60_000;
    if (free >= focusBlockMinutes) focusMinutes += free;
    cursor = Math.max(cursor, b.end);
  }
  return { meetingMinutes, focusMinutes, busyBlocks: merged.length };
}

export interface DeveloperValues {
  prMergeTimeAvg: number | null; codeReviewTimeAvg: number | null; focusTimeHours: number | null; meetingTimeHours: number | null;
  contextSwitchesPerDay: number | null; workloadBalance: number | null; pullRequests: number; reviewedPullRequests: number; workingDays: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const mean = (v: number[]): number | null => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/** The values of one developer from their records (pure). */
export function developerValues(
  prs: Array<{ openedAt: number; firstReviewAt: number | null; mergedAt: number | null }>,
  days: Array<{ workStart: number; workEnd: number; outOfOffice: boolean; busy: BusyInterval[] }>,
  windowStart: number,
): DeveloperValues {
  const merged = prs.filter((p) => p.mergedAt !== null && p.mergedAt >= windowStart && p.mergedAt >= p.openedAt);
  const reviewed = prs.filter((p) => p.firstReviewAt !== null && p.openedAt >= windowStart && p.firstReviewAt >= p.openedAt);
  const prMerge = mean(merged.map((p) => ((p.mergedAt as number) - p.openedAt) / 3_600_000));
  const review = mean(reviewed.map((p) => ((p.firstReviewAt as number) - p.openedAt) / 3_600_000));
  const working = days.filter((d) => !d.outOfOffice && d.workEnd > d.workStart).map((d) => dayStats(d.workStart, d.workEnd, d.busy));
  const meeting = mean(working.map((s) => s.meetingMinutes / 60));
  const focus = mean(working.map((s) => s.focusMinutes / 60));
  const switches = mean(working.map((s) => s.busyBlocks));
  const v: DeveloperValues = {
    prMergeTimeAvg: prMerge === null ? null : r2(prMerge), codeReviewTimeAvg: review === null ? null : r2(review),
    focusTimeHours: focus === null ? null : r2(focus), meetingTimeHours: meeting === null ? null : r2(meeting),
    contextSwitchesPerDay: switches === null ? null : Math.round(switches), workloadBalance: null,
    pullRequests: merged.length, reviewedPullRequests: reviewed.length, workingDays: working.length,
  };
  if (v.prMergeTimeAvg !== null && v.codeReviewTimeAvg !== null && v.focusTimeHours !== null && v.meetingTimeHours !== null && v.contextSwitchesPerDay !== null) {
    v.workloadBalance = Math.round(calculateWorkloadBalance({
      pr_merge_time_avg: v.prMergeTimeAvg, code_review_time_avg: v.codeReviewTimeAvg, focus_time_hours: v.focusTimeHours,
      meeting_time_hours: v.meetingTimeHours, context_switches_per_day: v.contextSwitchesPerDay,
    } as any) * 10) / 10;
  }
  return v;
}

let ready: boolean | null = null;
export async function developerRawTables(client: pg.PoolClient): Promise<boolean> {
  if (ready) return true;
  ready = !!(await client.query(`SELECT to_regclass('public.pull_requests_raw') IS NOT NULL AND to_regclass('public.calendar_days') IS NOT NULL AS ok`)).rows[0]?.ok;
  return ready;
}

/**
 * Recalculate the developer metrics of a team from its records: one developer_metrics row (source 'computed')
 * per opted-in member who has records, and today's snapshot. A member without any record keeps their row as it is.
 * Returns the number of developers written.
 */
export async function refreshDeveloperMetrics(client: pg.PoolClient, teamId: string, now = Date.now()): Promise<{ developers: number; snapshots: number }> {
  if (!(await developerRawTables(client))) return { developers: 0, snapshots: 0 };
  const team = (await client.query('SELECT company_id FROM teams WHERE id = $1', [teamId])).rows[0];
  if (!team) return { developers: 0, snapshots: 0 };
  const members = (await client.query(
    `SELECT u.id, u.email FROM users u
      WHERE u.company_id = $1 AND u.is_active = TRUE AND u.developer_insights_enabled = TRUE AND u.email IS NOT NULL AND ${isTeamMemberSql('u', '$2')}`,
    [team.company_id, teamId])).rows;
  if (!members.length) return { developers: 0, snapshots: 0 };
  const byHash = new Map<string, string>(members.map((u: any) => [personHash(u.email, team.company_id), String(u.id)]));
  const hashes = Array.from(byHash.keys());
  const windowStart = now - DEV_WINDOW_DAYS * 86_400_000;
  // A person's pull requests count wherever they opened them in the company (a developer has one set of values per team row).
  const prs = (await client.query(
    `SELECT author_hash, opened_at, first_review_at, merged_at FROM pull_requests_raw
      WHERE company_id = $1 AND author_hash = ANY($2::text[]) AND (opened_at >= $3 OR merged_at >= $3)`,
    [team.company_id, hashes, new Date(windowStart)])).rows;
  const days = (await client.query(
    `SELECT d.person_hash, d.day, d.work_start_min, d.work_end_min, d.utc_offset_min, d.out_of_office,
            COALESCE((SELECT json_agg(json_build_array(b.start_at, b.end_at)) FROM calendar_busy b WHERE b.team_id = d.team_id AND b.person_hash = d.person_hash AND b.day = d.day), '[]'::json) AS busy
       FROM calendar_days d
      WHERE d.company_id = $1 AND d.person_hash = ANY($2::text[]) AND d.day >= $3::date`,
    [team.company_id, hashes, new Date(windowStart).toISOString().slice(0, 10)])).rows;
  let developers = 0;
  let snapshots = 0;
  const today = new Date(now).toISOString().slice(0, 10);
  for (const [hash, userId] of byHash) {
    const mine = prs.filter((p: any) => p.author_hash === hash).map((p: any) => ({
      openedAt: new Date(p.opened_at).getTime(), firstReviewAt: p.first_review_at ? new Date(p.first_review_at).getTime() : null, mergedAt: p.merged_at ? new Date(p.merged_at).getTime() : null,
    }));
    // One calendar day per person and date (the same day may arrive under two of their teams).
    const seen = new Set<string>();
    const cal = days.filter((d: any) => d.person_hash === hash).filter((d: any) => { const k = String(d.day); if (seen.has(k)) return false; seen.add(k); return true; }).map((d: any) => {
      const dayIso = typeof d.day === 'string' ? d.day.slice(0, 10) : new Date(d.day).toISOString().slice(0, 10);
      const midnight = Date.parse(`${dayIso}T00:00:00Z`) - Number(d.utc_offset_min) * 60_000;
      return {
        workStart: midnight + Number(d.work_start_min) * 60_000, workEnd: midnight + Number(d.work_end_min) * 60_000, outOfOffice: !!d.out_of_office,
        busy: (d.busy as any[]).map((b) => ({ start: new Date(b[0]).getTime(), end: new Date(b[1]).getTime() })),
      };
    });
    if (!mine.length && !cal.length) continue;
    const v = developerValues(mine, cal, windowStart);
    await client.query(
      `INSERT INTO developer_metrics (team_id, developer_id, pr_merge_time_avg, code_review_time_avg, focus_time_hours, meeting_time_hours, context_switches_per_day, happiness_score, source, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'computed', now())
       ON CONFLICT (team_id, developer_id) DO UPDATE SET pr_merge_time_avg = EXCLUDED.pr_merge_time_avg, code_review_time_avg = EXCLUDED.code_review_time_avg,
         focus_time_hours = EXCLUDED.focus_time_hours, meeting_time_hours = EXCLUDED.meeting_time_hours, context_switches_per_day = EXCLUDED.context_switches_per_day,
         happiness_score = EXCLUDED.happiness_score, source = 'computed', computed_at = now()`,
      [teamId, userId, v.prMergeTimeAvg, v.codeReviewTimeAvg, v.focusTimeHours, v.meetingTimeHours, v.contextSwitchesPerDay, v.workloadBalance]);
    developers += 1;
    const ddps = computeDdps({
      focus_time_hours: v.focusTimeHours, meeting_time_hours: v.meetingTimeHours, context_switches_per_day: v.contextSwitchesPerDay,
      pr_merge_time_avg: v.prMergeTimeAvg, code_review_time_avg: v.codeReviewTimeAvg,
    } as any);
    if (ddps.score !== null) {
      const cap = (x: number, max: number) => Math.min(Math.max(x, 0), max);
      await client.query(
        `INSERT INTO developer_productivity_snapshots (developer_id, snapshot_date, focus_time_hours, pr_merge_time_avg, code_review_time_avg, meeting_time_hours, context_switches_per_day,
                                                      focus_time_norm, pr_time_norm, review_time_norm, meeting_time_norm, context_switches_norm, ddps_score)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (developer_id, snapshot_date) DO UPDATE SET focus_time_hours = EXCLUDED.focus_time_hours, pr_merge_time_avg = EXCLUDED.pr_merge_time_avg,
           code_review_time_avg = EXCLUDED.code_review_time_avg, meeting_time_hours = EXCLUDED.meeting_time_hours, context_switches_per_day = EXCLUDED.context_switches_per_day,
           focus_time_norm = EXCLUDED.focus_time_norm, pr_time_norm = EXCLUDED.pr_time_norm, review_time_norm = EXCLUDED.review_time_norm,
           meeting_time_norm = EXCLUDED.meeting_time_norm, context_switches_norm = EXCLUDED.context_switches_norm, ddps_score = EXCLUDED.ddps_score`,
        [userId, today, cap(v.focusTimeHours as number, 999.99), cap(v.prMergeTimeAvg as number, 999.99), cap(v.codeReviewTimeAvg as number, 999.99), cap(v.meetingTimeHours as number, 999.99),
          v.contextSwitchesPerDay, r4(cap((v.focusTimeHours as number) / 8, 1)), r4(cap((v.prMergeTimeAvg as number) / 24, 1)), r4(cap((v.codeReviewTimeAvg as number) / 8, 1)),
          r4(cap((v.meetingTimeHours as number) / 8, 1)), r4(cap((v.contextSwitchesPerDay as number) / 10, 1)), r4(ddps.score / 100)]);
      snapshots += 1;
    }
  }
  return { developers, snapshots };
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Nightly: the developer metrics of every team with pull requests or calendar days in the window are recalculated
 * (the 30-day window moves on, and each day gets its snapshot). One transaction per team; stops at `budgetMs`.
 */
export async function refreshRecentDeveloperMetrics(pool: pg.Pool, budgetMs = 10_000): Promise<{ teams: number; developers: number }> {
  const started = Date.now();
  const probe = await pool.connect();
  let teams: string[] = [];
  try {
    if (!(await developerRawTables(probe))) return { teams: 0, developers: 0 };
    teams = (await probe.query(
      `SELECT team_id FROM pull_requests_raw WHERE author_hash IS NOT NULL AND (opened_at >= now() - interval '${DEV_WINDOW_DAYS} days' OR merged_at >= now() - interval '${DEV_WINDOW_DAYS} days')
       UNION SELECT team_id FROM calendar_days WHERE day >= CURRENT_DATE - ${DEV_WINDOW_DAYS}`)).rows.map((r: any) => r.team_id);
  } finally { probe.release(); }
  let done = 0;
  let developers = 0;
  for (const teamId of teams) {
    if (Date.now() - started > budgetMs) break;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      developers += (await refreshDeveloperMetrics(client, teamId)).developers;
      await client.query('COMMIT');
      done += 1;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[developer-metrics] refresh failed for team', teamId, (e as Error).message);
    } finally { client.release(); }
  }
  return { teams: done, developers };
}

/**
 * A pseudonym is kept only while it is that of an active user who enabled developer insights. When someone turns
 * developer insights off (or leaves), their pull requests lose the author and their calendar days are deleted.
 */
export async function forgetOptedOutPeople(pool: pg.Pool): Promise<{ authorsCleared: number; calendarDaysForgotten: number }> {
  const client = await pool.connect();
  try {
    if (!(await developerRawTables(client))) return { authorsCleared: 0, calendarDaysForgotten: 0 };
    const companies = (await client.query(
      `SELECT DISTINCT company_id FROM pull_requests_raw WHERE author_hash IS NOT NULL UNION SELECT DISTINCT company_id FROM calendar_days`)).rows.map((r: any) => r.company_id as string);
    let authorsCleared = 0;
    let calendarDaysForgotten = 0;
    for (const companyId of companies) {
      const keep = Array.from((await optedInHashes(client, companyId)).keys());
      authorsCleared += (await client.query(`UPDATE pull_requests_raw SET author_hash = NULL WHERE company_id = $1 AND author_hash IS NOT NULL AND NOT (author_hash = ANY($2::text[]))`, [companyId, keep])).rowCount ?? 0;
      calendarDaysForgotten += (await client.query(`DELETE FROM calendar_days WHERE company_id = $1 AND NOT (person_hash = ANY($2::text[]))`, [companyId, keep])).rowCount ?? 0;
    }
    return { authorsCleared, calendarDaysForgotten };
  } finally { client.release(); }
}
