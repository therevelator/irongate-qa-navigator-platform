/**
 * Collection frequency. QE Navigator holds, per team and data group, how often the data should be read (set by
 * the company on its Update frequency page; 15 minutes when nothing is set). The Exporter reads that schedule
 * with its context at the start of a run and skips a source it read less than its interval ago.
 *
 * A source serves one or more teams and produces one or more data groups; its interval is the SHORTEST among
 * them, so no team waits longer than it asked. The Exporter is still started by your scheduler as before (every
 * 15 minutes is fine): a run that finds nothing due does no request to your tools.
 *
 * Not skipped: a backfill (--since), and a run with --force. When QE Navigator cannot be asked (an older server,
 * a network error) the run reads every source, as releases before 0.6.0 did.
 */
import type { SourceConfig } from './config';
import { mappedTeams } from './config';

export type DataGroup = 'ci' | 'delivery' | 'work' | 'quality' | 'automation' | 'people';
export interface Schedule { defaultMinutes: number; teams: Record<string, Partial<Record<DataGroup, number>>> }

/** The data groups a source type produces. */
export function groupsOf(src: SourceConfig): DataGroup[] {
  switch (src.type) {
    case 'github': case 'gitlab': case 'bitbucket': case 'azure-devops':
      return ['ci', 'delivery', ...((src as { pullRequests?: boolean }).pullRequests ? ['people' as const] : [])];
    case 'jenkins': case 'bitbucket-dc': return ['ci', 'delivery'];
    case 'sonarqube': return ['quality'];
    case 'jira': case 'linear': return ['work'];
    case 'pagerduty': case 'opsgenie': return ['delivery'];
    case 'testrail': case 'xray': case 'zephyr': return ['automation'];
    case 'google-calendar': case 'microsoft-365': return ['people'];
    default: return [];
  }
}

/** Minutes between two reads of a source: the shortest interval among its teams and groups. */
export function intervalOf(src: SourceConfig, schedule: Schedule): number {
  const groups = groupsOf(src);
  const teams = mappedTeams({ sources: [src] });
  if (!groups.length || !teams.length) return schedule.defaultMinutes;
  let min = Infinity;
  for (const t of teams) for (const g of groups) min = Math.min(min, schedule.teams[t]?.[g] ?? schedule.defaultMinutes);
  return Number.isFinite(min) ? min : schedule.defaultMinutes;
}

/** A run may start a little early (the scheduler's own jitter) and still count as due. */
export const EARLY_TOLERANCE_MS = 60_000;

/** Is the source due now? `lastSuccessAt` is the end of its last successful read. */
export function isDue(src: SourceConfig, schedule: Schedule | null, lastSuccessAt: string | null | undefined, now: Date): { due: boolean; minutes: number; nextAt: string | null } {
  if (!schedule) return { due: true, minutes: 0, nextAt: null };
  const minutes = intervalOf(src, schedule);
  const last = lastSuccessAt ? Date.parse(lastSuccessAt) : NaN;
  if (!Number.isFinite(last)) return { due: true, minutes, nextAt: null };
  const next = last + minutes * 60_000;
  return { due: now.getTime() + EARLY_TOLERANCE_MS >= next, minutes, nextAt: new Date(next).toISOString() };
}

/** Read the schedule from the context QE Navigator returned; null when it has none (an older server). */
export function scheduleFrom(context: unknown): Schedule | null {
  const s = (context as { schedule?: unknown } | null)?.schedule as { defaultMinutes?: unknown; teams?: unknown } | undefined;
  if (!s || typeof s !== 'object' || !Number.isFinite(Number(s.defaultMinutes)) || Number(s.defaultMinutes) <= 0) return null;
  const teams: Schedule['teams'] = {};
  if (s.teams && typeof s.teams === 'object') {
    for (const [team, groups] of Object.entries(s.teams as Record<string, unknown>)) {
      if (!groups || typeof groups !== 'object') continue;
      const out: Partial<Record<DataGroup, number>> = {};
      for (const [g, m] of Object.entries(groups as Record<string, unknown>)) if (Number.isFinite(Number(m)) && Number(m) > 0) out[g as DataGroup] = Number(m);
      teams[team] = out;
    }
  }
  return { defaultMinutes: Number(s.defaultMinutes), teams };
}
