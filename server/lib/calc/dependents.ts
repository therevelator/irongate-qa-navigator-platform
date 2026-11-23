/**
 * Order independence of the calculation: the days a new record changes, beyond the days its own kind affects.
 *
 * Each ingestion kind recalculates the days its records affect (affectedDays, deliveryAffectedDays, workAffectedDays,
 * qualityAffectedDays). Some values also depend on records of another kind, or on team-wide facts that a record can
 * change, so a record that arrives AFTER the records it combines with must also recalculate the days already
 * calculated from those. Without that, the result depends on the order the data arrived in until the nightly
 * recalculation (last 8 days only). The cases (docs/DATA_FLOW.md, "Order of arrival"):
 *
 *   coverage → work, quality   defect density divides by the lines of code of the latest main-branch coverage report
 *                              as of each day; the code quality score falls back to them when a SARIF report has no
 *                              loc. A coverage report recalculates the work and quality days calculated from its
 *                              day on.
 *   delivery → delivery        availability, MTBF, incidents per deploy and deployment frequency look back past the
 *                              28-day window (an outage still open, the previous incident of the service, the first
 *                              deploy or incident of the team; a later deployment makes a 0 frequency appear, a
 *                              linked incident fails an earlier change). Every deployment, commit or incident also
 *                              recalculates the delivery days calculated from its first day on.
 *   work → work                Kanban blocked time counts every issue still active; the first sprint of a team
 *                              switches it from Kanban to sprint metrics on every day. Issues recalculate the work
 *                              days calculated from their first day on (all of them when the team's first sprint
 *                              arrives).
 *   sarif → quality            a report re-links the next report of its series (new and fixed findings).
 *   first incident category    infrastructure failures are calculated only once the team's incidents carry a
 *                              category: the first one recalculates every delivery day already calculated.
 *
 * "Days calculated" are the days that have evidence (metric_evidence) of the group: a day without evidence has no
 * data the new record could combine with. Days still waiting in the calculation queue are calculated later, from the
 * data as it is then, so they need nothing more.
 */
import type pg from 'pg';
import { METRICS, groupOf, type MetricGroup } from './engine';

const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
export const daysBack = (n: number) => new Date(Date.now() - (n - 1) * DAY).toISOString().slice(0, 10);

/** The days from `fromDay` (not before `floorDay`) to today that have evidence of the given groups. */
export async function evidenceDaysFrom(client: pg.PoolClient, teamId: string, groups: MetricGroup[], fromDay: string | null, floorDay?: string): Promise<string[]> {
  if (!fromDay) return [];
  const from = floorDay && floorDay > fromDay ? floorDay : fromDay;
  const keys = Object.keys(METRICS).filter((k) => groups.includes(groupOf(k)));
  const r = await client.query(
    `SELECT DISTINCT to_char(day, 'YYYY-MM-DD') AS day FROM metric_evidence
      WHERE team_id = $1 AND metric_key = ANY($2::text[]) AND day >= $3::date AND day <= $4::date ORDER BY 1`, [teamId, keys, from, today()]);
  return r.rows.map((x: any) => x.day);
}

/** The first of the days (or null). */
export const firstDay = (days: string[]): string | null => (days.length ? [...days].sort()[0] : null);

/** The work and quality days a new coverage report changes: none for a report off the main branch. */
export async function coverageDependentDays(client: pg.PoolClient, teamId: string, reportId: string, day: string, workFloor: string): Promise<{ work: string[]; quality: string[] }> {
  const main = (await client.query(
    `SELECT (r.branch IS NULL OR r.branch = '' OR (t.main_branch IS NULL AND r.branch IN ('main', 'master')) OR r.branch = t.main_branch) AS main
       FROM coverage_reports r JOIN teams t ON t.id = r.team_id WHERE r.id = $1`, [reportId])).rows[0]?.main;
  if (!main) return { work: [], quality: [] };
  return { work: await evidenceDaysFrom(client, teamId, ['work'], day, workFloor), quality: await evidenceDaysFrom(client, teamId, ['quality'], day) };
}

/** A team-wide fact before a write (to see whether the write changed it). */
export async function teamFact(client: pg.PoolClient, teamId: string, fact: 'sprints' | 'incidentCategories'): Promise<boolean> {
  const sql = fact === 'sprints'
    ? 'SELECT EXISTS (SELECT 1 FROM issue_sprints WHERE team_id = $1) AS x'
    : 'SELECT EXISTS (SELECT 1 FROM incidents_raw WHERE team_id = $1 AND category IS NOT NULL) AS x';
  return !!(await client.query(sql, [teamId])).rows[0]?.x;
}
