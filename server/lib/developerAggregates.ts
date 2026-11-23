/**
 * Team and company aggregates of individual developer metrics (developer_metrics), with the
 * k-anonymity rule of server/lib/privacy.ts. The ONE place these averages are calculated, used by
 * GET /api/analytics/developer-metrics (summary), GET /api/metrics/team/:teamId/all and the
 * company summary (workload balance).
 *
 * Contributors of a team: developers with a developer_metrics row recorded for the team, who are
 * assigned to it with an engineering role ON THAT TEAM (an active qa_engineer / team_lead
 * assignment; not the display column users.role), are active, opted in to
 * developer insights, and have all five inputs recorded (PR merge, review, focus, meetings,
 * context switches), the same rows the Developer productivity page scores. With fewer than 3
 * contributors every value is null and the summary says it is not shown.
 */
import { query } from '../../src/lib/db';
import { assignedOnTeamAsSql } from './assignments';
import { computeBurnoutRisk, computeDdps, burnoutRiskLabel, toNum } from './metricFormulas';
import { K_ANONYMITY_MIN, meetsKAnonymity, optedInDeveloperSql, privacyInfo, type PrivacyInfo } from './privacy';

export const DEVELOPER_AGGREGATE_ROLES = ['qa_engineer', 'team_lead'];

export const DEVELOPER_AGGREGATE_TEXT =
  'Team figures are means over the team’s developers (QA engineers and team leads assigned to the team) who opted in to developer insights ' +
  `and have all five inputs recorded. They are shown only with at least ${K_ANONYMITY_MIN} such developers.`;

export interface DeveloperAverages {
  ddps: number | null;
  prMergeHours: number | null;
  reviewHours: number | null;
  focusHours: number | null;
  meetingHours: number | null;
  contextSwitches: number | null;
  /** Workload balance (derived), mean of the stored happiness_score; NOT wellbeing. */
  workloadBalance: number | null;
}

export interface DeveloperSummary {
  privacy: PrivacyInfo;
  averages: DeveloperAverages;
  /** Developers per burnout-risk level; null when suppressed. */
  burnout: { high: number; moderate: number; low: number } | null;
  /** Burnout rule applied to the averages (company view); 'Unknown' when suppressed. */
  burnoutOfAverages: 'High' | 'Moderate' | 'Low' | 'Unknown';
  basis: string;
}

interface DevRow {
  team_id: string;
  developer_id: string;
  pr: number; review: number; focus: number; meetings: number; switches: number;
  happiness: number | null;
}

/** Contributing rows (see the header) of the given teams. */
async function contributingRows(companyId: string, teamIds: string[]): Promise<DevRow[]> {
  if (!teamIds.length) return [];
  const rows = await query<any[]>(
    `SELECT dm.team_id, dm.developer_id, dm.pr_merge_time_avg, dm.code_review_time_avg, dm.focus_time_hours,
            dm.meeting_time_hours, dm.context_switches_per_day, dm.happiness_score
       FROM developer_metrics dm
       JOIN users u ON u.id = dm.developer_id
       JOIN teams t ON t.id = dm.team_id
      WHERE t.company_id = ? AND u.company_id = ? AND dm.team_id = ANY(?::varchar[])
        AND ${optedInDeveloperSql('u')}
        AND ${assignedOnTeamAsSql('u', 'dm.team_id', '?::text[]')}
        AND dm.pr_merge_time_avg IS NOT NULL AND dm.code_review_time_avg IS NOT NULL AND dm.focus_time_hours IS NOT NULL
        AND dm.meeting_time_hours IS NOT NULL AND dm.context_switches_per_day IS NOT NULL`,
    [companyId, companyId, teamIds, DEVELOPER_AGGREGATE_ROLES]
  );
  return rows.map((r: any) => ({
    team_id: r.team_id,
    developer_id: r.developer_id,
    pr: Number(r.pr_merge_time_avg), review: Number(r.code_review_time_avg), focus: Number(r.focus_time_hours),
    meetings: Number(r.meeting_time_hours), switches: Number(r.context_switches_per_day),
    happiness: toNum(r.happiness_score),
  }));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r = (v: number | null, dp = 1) => (v === null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

/** Summary over one developer per entry (already averaged per developer). */
function summarise(devs: DevRow[], basis: string): DeveloperSummary {
  const privacy = privacyInfo(devs.length);
  if (!meetsKAnonymity(devs.length)) {
    return {
      privacy, basis, burnout: null, burnoutOfAverages: 'Unknown',
      averages: { ddps: null, prMergeHours: null, reviewHours: null, focusHours: null, meetingHours: null, contextSwitches: null, workloadBalance: null },
    };
  }
  const burnout = { high: 0, moderate: 0, low: 0 };
  const scores: number[] = [];
  for (const d of devs) {
    const level = computeBurnoutRisk({ focus_time_hours: d.focus, meeting_time_hours: d.meetings, context_switches_per_day: d.switches });
    if (level) burnout[level]++;
    const s = computeDdps({ focus_time_hours: d.focus, meeting_time_hours: d.meetings, context_switches_per_day: d.switches, pr_merge_time_avg: d.pr, code_review_time_avg: d.review }).score;
    if (s !== null) scores.push(s);
  }
  const averages: DeveloperAverages = {
    ddps: r(mean(scores)),
    prMergeHours: r(mean(devs.map((d) => d.pr)), 2),
    reviewHours: r(mean(devs.map((d) => d.review)), 2),
    focusHours: r(mean(devs.map((d) => d.focus)), 2),
    meetingHours: r(mean(devs.map((d) => d.meetings)), 2),
    contextSwitches: r(mean(devs.map((d) => d.switches))),
    workloadBalance: r(mean(devs.map((d) => d.happiness).filter((h): h is number => h !== null))),
  };
  const burnoutOfAverages = burnoutRiskLabel(computeBurnoutRisk({
    focus_time_hours: averages.focusHours, meeting_time_hours: averages.meetingHours, context_switches_per_day: averages.contextSwitches,
  }));
  return { privacy, averages, burnout, burnoutOfAverages, basis };
}

/** Aggregates of one team's developer metrics (k-anonymous). */
export async function teamDeveloperSummary(companyId: string, teamId: string): Promise<DeveloperSummary> {
  return summarise(await contributingRows(companyId, [teamId]), DEVELOPER_AGGREGATE_TEXT);
}

/**
 * Aggregates over several teams (company): only teams that reach the threshold themselves
 * contribute, so the total never reveals a suppressed team. A developer on several qualifying
 * teams counts once (their rows averaged first).
 */
export async function multiTeamDeveloperSummary(companyId: string, teamIds: string[]): Promise<DeveloperSummary & { teamsIncluded: number; teamsSuppressed: number }> {
  const rows = await contributingRows(companyId, teamIds);
  const byTeam = new Map<string, DevRow[]>();
  for (const row of rows) byTeam.set(row.team_id, [...(byTeam.get(row.team_id) ?? []), row]);
  const qualifying = [...byTeam.entries()].filter(([, list]) => meetsKAnonymity(list.length));
  const perDev = new Map<string, DevRow[]>();
  for (const [, list] of qualifying) for (const row of list) perDev.set(row.developer_id, [...(perDev.get(row.developer_id) ?? []), row]);
  const devs: DevRow[] = [...perDev.entries()].map(([id, list]) => {
    const hs = list.map((x) => x.happiness).filter((h): h is number => h !== null);
    return {
      team_id: '*', developer_id: id,
      pr: mean(list.map((x) => x.pr))!, review: mean(list.map((x) => x.review))!, focus: mean(list.map((x) => x.focus))!,
      meetings: mean(list.map((x) => x.meetings))!, switches: mean(list.map((x) => x.switches))!,
      happiness: hs.length ? mean(hs) : null,
    };
  });
  const basis =
    'Company figures: developers of teams that reach the threshold themselves (teams below it are left out, so their figures cannot be worked out), ' +
    `each developer counted once. ${DEVELOPER_AGGREGATE_TEXT}`;
  return { ...summarise(devs, basis), teamsIncluded: qualifying.length, teamsSuppressed: byTeam.size - qualifying.length };
}
