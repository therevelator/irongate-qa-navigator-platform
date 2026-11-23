/**
 * Hours lost per week, by cause (pure). One unit for five different problems, each measured from records:
 *
 *   slow_stage      pipeline stages slower than their own best week: for each stage and week,
 *                   (median duration of the week − the lowest weekly median of the stage in the window) × runs of the
 *                   week, counted when the difference is at least SLOW_STAGE_MIN_S and SLOW_STAGE_MIN_SHARE of the best
 *   flaky_rerun     pipeline runs that failed and then passed on the same commit: the duration of the failed runs
 *                   (time spent on a run whose result did not depend on the code)
 *   blocked         working hours issues spent in a blocked status or flagged
 *   failed_change   for each failed production change (rolled back, hotfixed within the window, or linked to an
 *                   incident): hours from the deploy to its fix, at most FAILED_CHANGE_CAP_H per change
 *   review_wait     working hours pull requests waited for their first review beyond the team's own best weekly median
 *
 * Weeks are LOST_WEEKS rolling 7-day windows ending at the end of the day of `now` (UTC), so the latest week is
 * always complete. Working hours = WORK_HOURS_PER_DAY for every 24 h on a weekday (Monday to Friday, UTC); weekends
 * do not count. A weekly median needs MIN_WEEK_SAMPLES records; a cause without enough records contributes nothing.
 *
 * These are measured waiting and rework hours. They are not a money figure and not an estimate of effort.
 */
import { median } from './types';
import { classifyFailedChanges, type DeployRow, type IncidentRow } from './delivery';
import { blockedHours, type IssueRow } from './work';

export type LostCause = 'slow_stage' | 'flaky_rerun' | 'blocked' | 'failed_change' | 'review_wait';
export const LOST_CAUSES: LostCause[] = ['slow_stage', 'flaky_rerun', 'blocked', 'failed_change', 'review_wait'];
export const LOST_CAUSE_LABELS: Record<LostCause, { label: string; short: string; rule: string }> = {
  slow_stage: { label: 'Slow pipeline stages', short: 'Slow stages', rule: '(median duration of the stage this week − its own best weekly median in the last 12 weeks) × runs of the week' },
  flaky_rerun: { label: 'Failed runs that passed on a rerun', short: 'Flaky reruns', rule: 'duration of every pipeline run that failed and then passed on the same commit' },
  blocked: { label: 'Blocked work', short: 'Blocked', rule: 'working hours issues spent in a blocked status or flagged (8 hours per weekday)' },
  failed_change: { label: 'Failed changes', short: 'Failed changes', rule: 'for each production deploy that was rolled back, hotfixed or linked to an incident: hours from the deploy to its fix (at most 24 per change)' },
  review_wait: { label: 'Waiting for review', short: 'Review wait', rule: 'working hours pull requests waited for a first review beyond the team’s own best weekly median in the last 12 weeks' },
};

export const LOST_WEEKS = 12;
export const MIN_WEEK_SAMPLES = 5;
export const SLOW_STAGE_MIN_S = 30;
export const SLOW_STAGE_MIN_SHARE = 0.1;
export const FAILED_CHANGE_CAP_H = 24;
export const WORK_HOURS_PER_DAY = 8;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const r2 = (n: number) => Math.round(n * 100) / 100;
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

export interface StageRunRow { name: string; at: number; durationS: number; commit: string }
export interface PipelineRunRow { id: string; name: string; commit: string; at: number; durationS: number; result: string }
export interface PullRow { openedAt: number; firstReviewAt: number | null }

export interface LostInput {
  now: number;
  /** Stage runs that succeeded (a failed stage's duration says nothing about its speed). */
  stageRuns: StageRunRow[];
  runs: PipelineRunRow[];
  issues: IssueRow[];
  deploys: DeployRow[];
  incidents: IncidentRow[];
  pulls: PullRow[];
  changeFailureWindowHours?: number;
}

export interface LostWeek { start: string; end: string; hours: Record<LostCause, number>; total: number }

export interface SlowStageDetail {
  stage: string; bestMedianS: number; medianS: number; runs: number; hours: number;
  /** First day of the unbroken run of slow weeks that reaches the latest week. */
  since: string;
  /** The first slow run of that period and the run before it: the change is between these two commits. */
  change: { day: string; fromCommit: string | null; toCommit: string | null } | null;
}
export interface LostDetail {
  slow_stage: SlowStageDetail[];
  flaky_rerun: Array<{ pipeline: string; failedRuns: number; hours: number }>;
  blocked: Array<{ key: string; title: string | null; hours: number; url: string | null }>;
  failed_change: Array<{ deploy: string; service: string | null; day: string; reason: string; hours: number | null; url: string | null }>;
  review_wait: { pulls: number; medianWaitH: number | null; bestMedianH: number | null; hours: number } | null;
}
export interface LostResult {
  weeks: LostWeek[];
  /** What the latest week's hours are made of (the biggest contributors first). */
  detail: LostDetail;
  /** Records the calculation saw in the whole window, per cause (0 = this cause cannot be measured for the team). */
  samples: Record<LostCause, number>;
}

/** Working hours between two instants: 8 hours for every 24 h on a weekday (UTC). */
export function workingHours(from: number, to: number): number {
  if (to <= from) return 0;
  let ms = 0;
  for (let d = Math.floor(from / DAY) * DAY; d < to; d += DAY) {
    const wd = new Date(d).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    ms += Math.max(0, Math.min(to, d + DAY) - Math.max(from, d));
  }
  return (ms / HOUR) * (WORK_HOURS_PER_DAY / 24);
}

/** The LOST_WEEKS windows, oldest first: [start, end) in ms. */
export function lostWindows(now: number): Array<{ from: number; to: number }> {
  const end = Math.floor(now / DAY) * DAY + DAY;
  return Array.from({ length: LOST_WEEKS }, (_, i) => ({ from: end - (LOST_WEEKS - i) * 7 * DAY, to: end - (LOST_WEEKS - i - 1) * 7 * DAY }));
}

export function computeLostHours(input: LostInput): LostResult {
  const windows = lostWindows(input.now);
  const first = windows[0].from;
  const last = LOST_WEEKS - 1;
  const weekOf = (t: number) => (t < first || t >= windows[last].to ? -1 : Math.floor((t - first) / (7 * DAY)));
  const hours = windows.map(() => ({ slow_stage: 0, flaky_rerun: 0, blocked: 0, failed_change: 0, review_wait: 0 } as Record<LostCause, number>));
  const detail: LostDetail = { slow_stage: [], flaky_rerun: [], blocked: [], failed_change: [], review_wait: null };
  const samples: Record<LostCause, number> = { slow_stage: 0, flaky_rerun: 0, blocked: 0, failed_change: 0, review_wait: 0 };

  // Slow stages
  const byStage = new Map<string, StageRunRow[]>();
  for (const s of input.stageRuns) {
    if (weekOf(s.at) < 0 || !(s.durationS >= 0)) continue;
    samples.slow_stage++;
    (byStage.get(s.name) ?? byStage.set(s.name, []).get(s.name)!).push(s);
  }
  for (const [name, rows] of byStage) {
    const perWeek = windows.map(() => [] as number[]);
    for (const s of rows) perWeek[weekOf(s.at)].push(s.durationS);
    const medians = perWeek.map((xs) => (xs.length >= MIN_WEEK_SAMPLES ? median(xs) : null));
    const known = medians.filter((m): m is number => m !== null);
    if (known.length < 2) continue;
    const best = Math.min(...known);
    const slow = medians.map((m) => m !== null && m - best >= SLOW_STAGE_MIN_S && m - best >= best * SLOW_STAGE_MIN_SHARE);
    medians.forEach((m, w) => { if (slow[w]) hours[w].slow_stage += ((m! - best) * perWeek[w].length) / 3600; });
    if (!slow[last]) continue;
    let sinceWeek = last;
    while (sinceWeek > 0 && (slow[sinceWeek - 1] || medians[sinceWeek - 1] === null)) sinceWeek--;
    while (!slow[sinceWeek]) sinceWeek++;
    const threshold = best + (medians[last]! - best) / 2;
    const ordered = [...rows].sort((a, b) => a.at - b.at);
    const at = ordered.findIndex((s) => s.at >= windows[sinceWeek].from && s.durationS >= threshold);
    detail.slow_stage.push({
      stage: name, bestMedianS: Math.round(best), medianS: Math.round(medians[last]!), runs: perWeek[last].length,
      hours: r2(((medians[last]! - best) * perWeek[last].length) / 3600), since: dayOf(windows[sinceWeek].from),
      change: at < 0 ? null : { day: dayOf(ordered[at].at), fromCommit: (at > 0 && ordered[at - 1].commit) || null, toCommit: ordered[at].commit || null },
    });
  }
  detail.slow_stage.sort((a, b) => b.hours - a.hours);

  // Failed runs that passed on a rerun of the same commit
  const byCommit = new Map<string, PipelineRunRow[]>();
  for (const r of input.runs) {
    if (!r.commit) continue;
    const k = `${r.name}\u0001${r.commit}`;
    (byCommit.get(k) ?? byCommit.set(k, []).get(k)!).push(r);
  }
  const flakyByPipeline = new Map<string, { failedRuns: number; hours: number }>();
  for (const group of byCommit.values()) {
    const passedAt = Math.max(...group.filter((r) => r.result === 'success').map((r) => r.at), -Infinity);
    for (const r of group) {
      const w = weekOf(r.at);
      if (w >= 0) samples.flaky_rerun++;
      if (w < 0 || r.result !== 'failed' || !(r.at < passedAt) || !(r.durationS > 0)) continue;
      hours[w].flaky_rerun += r.durationS / 3600;
      if (w === last) {
        const p = flakyByPipeline.get(r.name) ?? flakyByPipeline.set(r.name, { failedRuns: 0, hours: 0 }).get(r.name)!;
        p.failedRuns++; p.hours += r.durationS / 3600;
      }
    }
  }
  detail.flaky_rerun = [...flakyByPipeline].map(([pipeline, v]) => ({ pipeline, failedRuns: v.failedRuns, hours: r2(v.hours) })).sort((a, b) => b.hours - a.hours);

  // Blocked work
  for (const i of input.issues) {
    samples.blocked++;
    if (!i.transitions.some((t) => t.toCategory === 'blocked' || t.field === 'flagged')) continue;
    windows.forEach((win, w) => {
      let h = 0;
      for (let d = win.from; d < win.to; d += DAY) {
        const wd = new Date(d).getUTCDay();
        if (wd === 0 || wd === 6 || d >= input.now) continue;
        h += blockedHours(i, d, Math.min(d + DAY, input.now)) * (WORK_HOURS_PER_DAY / 24);
      }
      hours[w].blocked += h;
      if (w === last && h > 0) detail.blocked.push({ key: i.key, title: i.title, hours: r2(h), url: i.url });
    });
  }
  detail.blocked.sort((a, b) => b.hours - a.hours);

  // Failed changes
  const failures = classifyFailedChanges(input.deploys, input.incidents, input.now, input.changeFailureWindowHours);
  samples.failed_change = input.deploys.filter((d) => weekOf(d.finishedAt) >= 0).length;
  for (const d of input.deploys) {
    const reasons = failures.get(d.id);
    const w = weekOf(d.finishedAt);
    if (!reasons || w < 0) continue;
    const fixes = reasons.map((r) => (r.type === 'incident' ? input.incidents.find((x) => x.externalId === r.ref || x.deployment === d.externalId)?.resolvedAt ?? null : r.at))
      .filter((t): t is number => t !== null && t > d.finishedAt);
    const h = fixes.length ? Math.min(FAILED_CHANGE_CAP_H, (Math.min(...fixes) - d.finishedAt) / HOUR) : null;
    if (h !== null) hours[w].failed_change += h;
    if (w === last) detail.failed_change.push({ deploy: d.externalId, service: d.service, day: dayOf(d.finishedAt), reason: reasons.map((r) => r.type).join(', '), hours: h === null ? null : r2(h), url: d.url });
  }

  // Waiting for review
  const reviewed = input.pulls.filter((p) => p.firstReviewAt !== null && p.firstReviewAt > p.openedAt && weekOf(p.firstReviewAt) >= 0)
    .map((p) => ({ w: weekOf(p.firstReviewAt!), wait: workingHours(p.openedAt, p.firstReviewAt!) }));
  samples.review_wait = reviewed.length;
  const waits = windows.map((_, w) => reviewed.filter((p) => p.w === w).map((p) => p.wait));
  const waitMedians = waits.map((xs) => (xs.length >= MIN_WEEK_SAMPLES ? median(xs) : null));
  const knownWaits = waitMedians.filter((m): m is number => m !== null);
  if (knownWaits.length >= 2) {
    const best = Math.min(...knownWaits);
    waits.forEach((xs, w) => { hours[w].review_wait = xs.reduce((n, x) => n + Math.max(0, x - best), 0); });
    detail.review_wait = { pulls: waits[last].length, medianWaitH: waitMedians[last] === null ? null : r2(waitMedians[last]!), bestMedianH: r2(best), hours: r2(hours[last].review_wait) };
  }

  const weeks = windows.map((win, w) => {
    const h = Object.fromEntries(LOST_CAUSES.map((c) => [c, r2(hours[w][c])])) as Record<LostCause, number>;
    return { start: dayOf(win.from), end: dayOf(win.to - DAY), hours: h, total: r2(LOST_CAUSES.reduce((n, c) => n + h[c], 0)) };
  });
  return { weeks, detail, samples };
}
