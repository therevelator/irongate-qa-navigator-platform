import { QA_SCORE_THRESHOLDS, qaStatusFromScore, type QaStatus } from './metricFormulas';
import type { KpiTargetCheck } from '../../src/config/metricsConfig';

/**
 * Executive summary (GET /api/summary, src/components/ExecutiveSummary.tsx): the pure rules that
 * rank the teams of the caller's scope. The route (server/routes/summary.ts) loads the data; these
 * functions only decide, so the API tests and the unit tests can check them against the same rows.
 *
 *   risks     teams with the QA score below its target (≥ QA_SCORE_THRESHOLDS.good) or one of the
 *             four tracked KPIs off its target (the target valid at the value's date, stale values
 *             not judged), lowest QA score first; each with the items off target, their target and
 *             the change since last week.
 *   improved  teams whose QA score rose since last week, biggest rise first.
 *   since     last week = each team's latest snapshot dated 7–14 days ago (the same window as the
 *             overview's QA score trend, GET /api/analytics/company-summary globalQaScoreTrend).
 */

export const SUMMARY_TOP_N = 3;

export const SUMMARY_TEXT = {
  risks: `Teams with the QA score below ${QA_SCORE_THRESHOLDS.good} or a tracked KPI off its target, lowest QA score first.`,
  improved: 'Teams whose QA score rose most since last week.',
  lastWeek: 'Compared with each team’s latest snapshot from 7 to 14 days ago, as the overview’s trend.',
  money: 'Revenue at stake: monthly revenue associated with closing each team’s quality gaps to target (a range, from the team’s own history; an association, not a promise). Open debt: cost of delay of open technical-debt items.',
} as const;

export interface SummaryTeamInput {
  teamId: string;
  teamName: string;
  departmentName: string | null;
  /** Current QA score (stale inputs left out), null when none. */
  qaScore: number | null;
  /** QA score last week (snapshot dated 7–14 days ago), null when none. */
  prevQaScore: number | null;
  /** The four tracked KPIs judged against their targets (teamKpiTrack checks). */
  checks: KpiTargetCheck[];
  /** The same KPIs' values last week (camelCase key → value), when recorded. */
  prevValues: Partial<Record<KpiTargetCheck['key'], number | null>>;
  snapshotDate: string | null;
}

export interface SummaryRiskItem {
  key: 'qaScore' | KpiTargetCheck['key'];
  label: string;
  value: number;
  target: number;
  lowerIsBetter: boolean;
  unit: string;
  /** Change since last week in the metric's unit (null when no value last week). */
  weekChange: number | null;
  /** better / worse / same, judged by the metric's direction. */
  trend: 'better' | 'worse' | 'same' | null;
}

export interface SummaryRisk {
  teamId: string;
  teamName: string;
  departmentName: string | null;
  qaScore: number | null;
  status: QaStatus | null;
  weekChange: number | null;
  items: SummaryRiskItem[];
}

export interface SummaryImproved {
  teamId: string;
  teamName: string;
  departmentName: string | null;
  qaScore: number;
  prevQaScore: number;
  weekChange: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function weekChange(now: number | null, prev: number | null | undefined): number | null {
  return now === null || prev === null || prev === undefined ? null : r1(now - prev);
}

export function trendOf(change: number | null, lowerIsBetter: boolean): SummaryRiskItem['trend'] {
  if (change === null) return null;
  if (change === 0) return 'same';
  return (change < 0) === lowerIsBetter ? 'better' : 'worse';
}

/** The items of a team that are off target: QA score below its target, then the KPIs missed (largest gap first). */
export function offTargetItems(t: SummaryTeamInput): SummaryRiskItem[] {
  const items: SummaryRiskItem[] = [];
  if (t.qaScore !== null && t.qaScore < QA_SCORE_THRESHOLDS.good) {
    const ch = weekChange(t.qaScore, t.prevQaScore);
    items.push({ key: 'qaScore', label: 'QA score', value: r1(t.qaScore), target: QA_SCORE_THRESHOLDS.good, lowerIsBetter: false, unit: '/100', weekChange: ch, trend: trendOf(ch, false) });
  }
  const missed = t.checks.filter((c) => c.met === false && c.value !== null).sort((a, b) => (b.gap ?? 0) / (b.target || 1) - (a.gap ?? 0) / (a.target || 1));
  for (const c of missed) {
    const ch = weekChange(c.value, t.prevValues[c.key]);
    items.push({ key: c.key, label: c.label, value: r1(c.value as number), target: c.target, lowerIsBetter: c.lowerIsBetter, unit: '%', weekChange: ch, trend: trendOf(ch, c.lowerIsBetter) });
  }
  return items;
}

export function rankRisks(teams: SummaryTeamInput[], n = SUMMARY_TOP_N): { top: SummaryRisk[]; total: number } {
  const all = teams
    .map((t): SummaryRisk => ({
      teamId: t.teamId, teamName: t.teamName, departmentName: t.departmentName,
      qaScore: t.qaScore === null ? null : r1(t.qaScore), status: qaStatusFromScore(t.qaScore),
      weekChange: weekChange(t.qaScore, t.prevQaScore), items: offTargetItems(t),
    }))
    .filter((r) => r.items.length > 0)
    .sort((a, b) => (a.qaScore ?? 101) - (b.qaScore ?? 101) || b.items.length - a.items.length || a.teamName.localeCompare(b.teamName));
  return { top: all.slice(0, n), total: all.length };
}

export function rankImproved(teams: SummaryTeamInput[], n = SUMMARY_TOP_N): { top: SummaryImproved[]; total: number } {
  const all = teams
    .filter((t) => t.qaScore !== null && t.prevQaScore !== null && (weekChange(t.qaScore, t.prevQaScore) ?? 0) > 0)
    .map((t): SummaryImproved => ({
      teamId: t.teamId, teamName: t.teamName, departmentName: t.departmentName,
      qaScore: r1(t.qaScore as number), prevQaScore: r1(t.prevQaScore as number), weekChange: weekChange(t.qaScore, t.prevQaScore) as number,
    }))
    .sort((a, b) => b.weekChange - a.weekChange || a.teamName.localeCompare(b.teamName));
  return { top: all.slice(0, n), total: all.length };
}

export interface StatusChange { teamId: string; teamName: string; from: QaStatus; to: QaStatus; better: boolean }

const STATUS_RANK: Record<QaStatus, number> = { critical: 0, warning: 1, good: 2 };

/** Teams whose QA status (good / warning / critical) differs from last week. */
export function statusChanges(teams: SummaryTeamInput[]): StatusChange[] {
  const out: StatusChange[] = [];
  for (const t of teams) {
    const from = qaStatusFromScore(t.prevQaScore);
    const to = qaStatusFromScore(t.qaScore);
    if (from && to && from !== to) out.push({ teamId: t.teamId, teamName: t.teamName, from, to, better: STATUS_RANK[to] > STATUS_RANK[from] });
  }
  return out.sort((a, b) => Number(a.better) - Number(b.better) || a.teamName.localeCompare(b.teamName));
}

/** Counts of teams whose QA score rose, fell or stayed since last week (teams with both scores). */
export function movement(teams: SummaryTeamInput[]): { up: number; down: number; same: number; compared: number } {
  let up = 0, down = 0, same = 0;
  for (const t of teams) {
    const ch = weekChange(t.qaScore, t.prevQaScore);
    if (ch === null) continue;
    if (ch > 0) up++; else if (ch < 0) down++; else same++;
  }
  return { up, down, same, compared: up + down + same };
}
