/**
 * Collection frequency: how often the QE Navigator Exporter reads each kind of data for a team.
 *
 * A team that releases once a month does not need its pipelines read every 15 minutes. Per team and data group
 * an interval is stored (collection_schedules); without one the default applies (DEFAULT_INTERVAL_MINUTES, what the
 * Exporter does when nothing is set). The setup form is pre-filled with a recommendation chosen from the team's
 * release cadence (RECOMMENDED); every value can be changed, then and later.
 *
 * The Exporter reads the schedule with its context at the start of each run and skips a source that was read
 * less than its interval ago (exporter/src/schedule.ts). The server uses the same schedule so that a value is not
 * called stale just because the team chose to collect it less often (server/lib/staleness.ts, intervalsForTeam).
 */
import { query } from '../../src/lib/db';

export type DataGroup = 'ci' | 'delivery' | 'work' | 'quality' | 'automation' | 'people';
export type ReleaseCadence = 'continuous' | 'weekly' | 'biweekly' | 'monthly';

export const DEFAULT_INTERVAL_MINUTES = 15;
export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 43_200; // 30 days

export const DATA_GROUPS: Array<{ key: DataGroup; label: string; reads: string; feeds: string }> = [
  { key: 'ci', label: 'Pipelines, tests and coverage', reads: 'pipeline runs with stages, test reports, coverage and load-test files', feeds: 'build time, flaky tests, coverage, pipeline health, hours lost to slow stages and reruns' },
  { key: 'delivery', label: 'Deployments and incidents', reads: 'production deployments with their commits, incidents from the on-call tool', feeds: 'deployment frequency, lead time, change failure rate, time to restore, availability' },
  { key: 'work', label: 'Issues and sprints', reads: 'issues with their status history, sprints', feeds: 'defect escape rate, sprint commitment, blocked time, sizing accuracy' },
  { key: 'quality', label: 'Static analysis', reads: 'the latest analysis and its open findings', feeds: 'code quality score, technical debt' },
  { key: 'automation', label: 'Test management', reads: 'test cases and executions', feeds: 'automation coverage, automation ROI' },
  { key: 'people', label: 'Pull requests and calendars', reads: 'pull request times; free/busy only, for people who enabled developer insights', feeds: 'review wait, developer metrics' },
];
export const GROUP_KEYS = DATA_GROUPS.map((g) => g.key);

export const CADENCES: Array<{ key: ReleaseCadence; label: string; hint: string }> = [
  { key: 'continuous', label: 'Daily or continuous', hint: 'Several releases a week' },
  { key: 'weekly', label: 'Weekly', hint: 'About one release a week' },
  { key: 'biweekly', label: 'Every two weeks', hint: 'One release per sprint' },
  { key: 'monthly', label: 'Monthly or less often', hint: 'One release a month, or fewer' },
];

const H = 60;
const D = 24 * H;
/**
 * Recommended interval (minutes) per release cadence. The reasoning: read a kind of data about as often as it
 * can change what someone does. Incidents are never read less often than hourly: an outage matters the same day
 * whatever the release rhythm. Slow-moving sources (static analysis, test management) are read daily at most.
 */
export const RECOMMENDED: Record<ReleaseCadence, Record<DataGroup, number>> = {
  continuous: { ci: 15, delivery: 15, work: H, quality: D, automation: D, people: 4 * H },
  weekly: { ci: H, delivery: H, work: 4 * H, quality: D, automation: D, people: D },
  biweekly: { ci: 4 * H, delivery: H, work: 12 * H, quality: D, automation: D, people: D },
  monthly: { ci: D, delivery: H, work: D, quality: 7 * D, automation: 7 * D, people: D },
};

export const isCadence = (v: unknown): v is ReleaseCadence => typeof v === 'string' && CADENCES.some((c) => c.key === v);
export const isGroup = (v: unknown): v is DataGroup => typeof v === 'string' && (GROUP_KEYS as string[]).includes(v);

export class ScheduleError extends Error {}

/** Validate a set of intervals sent by the form: known groups, whole minutes within the limits. */
export function cleanIntervals(raw: unknown): Partial<Record<DataGroup, number>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ScheduleError('intervals must be an object of data group → minutes');
  const out: Partial<Record<DataGroup, number>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isGroup(k)) throw new ScheduleError(`Unknown data group "${k}" (known: ${GROUP_KEYS.join(', ')})`);
    if (!Number.isInteger(v) || (v as number) < MIN_INTERVAL_MINUTES || (v as number) > MAX_INTERVAL_MINUTES) {
      throw new ScheduleError(`${k}: the interval must be a whole number of minutes between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES}`);
    }
    out[k] = v as number;
  }
  return out;
}

export type TeamSchedule = Record<DataGroup, number>;
export const defaultSchedule = (): TeamSchedule => Object.fromEntries(GROUP_KEYS.map((g) => [g, DEFAULT_INTERVAL_MINUTES])) as TeamSchedule;

let table: boolean | null = null;
async function hasTable(): Promise<boolean> {
  if (table) return true;
  const r = await query<any[]>(`SELECT to_regclass('public.collection_schedules') IS NOT NULL AS ok`);
  table = !!r[0]?.ok;
  return table;
}

/** The stored intervals of a company's teams (only what was set; a missing group is the default). */
export async function loadSchedules(companyId: string): Promise<Map<string, Partial<TeamSchedule>>> {
  const out = new Map<string, Partial<TeamSchedule>>();
  if (!(await hasTable())) return out;
  const rows = await query<any[]>('SELECT team_id, data_group, interval_minutes FROM collection_schedules WHERE company_id = ?', [companyId]);
  for (const r of rows) {
    const t = out.get(r.team_id) ?? {};
    t[r.data_group as DataGroup] = Number(r.interval_minutes);
    out.set(r.team_id, t);
  }
  return out;
}

export const effectiveSchedule = (stored: Partial<TeamSchedule> | undefined): TeamSchedule => ({ ...defaultSchedule(), ...(stored ?? {}) });

/** Store a team's cadence and intervals (replaces what was stored for the groups given). */
export async function saveTeamSchedule(companyId: string, teamId: string, actorId: string | null, cadence: ReleaseCadence | null | undefined, intervals: Partial<TeamSchedule>): Promise<void> {
  if (cadence !== undefined) await query('UPDATE teams SET release_cadence = ? WHERE id = ? AND company_id = ?', [cadence, teamId, companyId]);
  for (const [group, minutes] of Object.entries(intervals)) {
    await query(
      `INSERT INTO collection_schedules (team_id, data_group, company_id, interval_minutes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, now())
       ON CONFLICT (team_id, data_group) DO UPDATE SET interval_minutes = EXCLUDED.interval_minutes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [teamId, group, companyId, minutes, actorId]);
  }
}

/** "every 15 minutes", "every 4 hours", "once a day", "once a week". */
export function intervalText(minutes: number): string {
  if (minutes % D === 0) { const d = minutes / D; return d === 1 ? 'once a day' : d === 7 ? 'once a week' : `every ${d} days`; }
  if (minutes % H === 0) { const h = minutes / H; return h === 1 ? 'every hour' : `every ${h} hours`; }
  return `every ${minutes} minutes`;
}
