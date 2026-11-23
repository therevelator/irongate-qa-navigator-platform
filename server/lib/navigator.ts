/**
 * The "next move" pages (routes/navigator.ts): company status in hours lost per week, findings, outcomes of the
 * tracked actions and data readiness. Everything is assembled from what is already calculated and stored:
 *
 *   hours lost      server/lib/lostHours.ts (raw records → hours per week and cause)
 *   findings        a) each cause with hours in the latest week, built from the records behind it (FINDING_MIN_HOURS);
 *                   b) the team's open and accepted recommendations (server/lib/recommendations). A recommendation
 *                      whose rule is about one of the causes (RULE_CAUSE) takes that cause's hours and replaces a).
 *   outcomes        the tracked actions (server/lib/actions.ts) with a verdict read from their stored checkpoints
 *                   (verdictOf): the metric decides, nobody ticks "verified".
 *   readiness       which raw sources a team sends (rows in the last READINESS_DAYS days), what each missing one
 *                   blocks and how to connect it, plus what the Exporter reported on its last run (exporter_discovery).
 *
 * Pure functions here; the route does the reads.
 */
import { LOST_CAUSES, LOST_CAUSE_LABELS, type LostCause, type LostDetail, type LostWeek } from '../../packages/engine/src/calc/lostHours';
import type { ActionJson } from './actions';
import { effectText } from './recommendations/rules';

export const FINDING_MIN_HOURS = 0.5;
export const READINESS_DAYS = 30;

/** The recommendation rules that describe the same problem as a cause of lost hours. */
export const RULE_CAUSE: Record<string, LostCause> = {
  flaky_tests: 'flaky_rerun', build_time_regression: 'slow_stage', slow_tests: 'slow_stage',
  change_failure: 'failed_change', mttr_rising: 'failed_change', wellbeing_blocked: 'blocked',
};

/** The KPI a tracked action for a cause is measured by (a metric with a target), null when none fits. */
export const CAUSE_METRIC: Record<LostCause, string | null> = {
  slow_stage: 'avg_build_time_minutes', flaky_rerun: 'test_flakiness_rate', blocked: 'blocked_time_hours', failed_change: 'change_failure_rate', review_wait: null,
};

export type TeamState = 'improving' | 'steady' | 'slipping' | 'unknown';

const r1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const dur = (s: number) => (s >= 90 ? `${r1(s / 60)} min` : `${Math.round(s)} s`);
const short = (sha: string | null) => (sha ? sha.slice(0, 7) : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Direction of a team's lost hours: the mean of the last four weeks against the mean of the first four of the
 * window. Slipping / improving when it moved by at least 15 % and one hour; unknown without any record.
 */
export function teamState(weeks: LostWeek[], samples: Partial<Record<LostCause, number>> | undefined): TeamState {
  if (weeks.length < 8 || !samples || !LOST_CAUSES.some((c) => (samples[c] ?? 0) > 0)) return 'unknown';
  const before = mean(weeks.slice(0, 4).map((w) => w.total));
  const now = mean(weeks.slice(-4).map((w) => w.total));
  const delta = now - before;
  if (Math.abs(delta) < 1 || Math.abs(delta) < Math.max(before, now) * 0.15) return 'steady';
  return delta > 0 ? 'slipping' : 'improving';
}

export interface FindingJson {
  id: string;
  teamId: string;
  teamName: string;
  cause: LostCause | null;
  causeLabel: string | null;
  title: string;
  summary: string;
  /** Hours a week this costs now (the latest week); null when the finding is not about a measured cause. */
  hours: number | null;
  confidence: 'high' | 'medium' | 'low';
  confidenceWhy: string;
  evidence: Array<{ label: string; value: string; detail?: string }>;
  items: Array<{ kind: string; name: string; detail: string; url?: string | null }>;
  /** Hours of the cause in each of the 12 weeks (oldest first); empty without a cause. */
  trend: number[];
  since: string | null;
  nextStep: string;
  expected: string | null;
  formula: string | null;
  metricKey: string | null;
  recommendationId: string | null;
  action: { id: string; title: string; status: string; owner: string | null; dueDate: string | null } | null;
}

function confidenceOf(n: number): { confidence: 'high' | 'medium' | 'low'; why: string } {
  const c = n >= 30 ? 'high' : n >= 10 ? 'medium' : 'low';
  return { confidence: c, why: `${plural(n, 'record')} in the last 12 weeks.` };
}

/** A finding for one cause of one team, written from the records behind the latest week's hours. Null below the minimum. */
export function causeFinding(team: { id: string; name: string }, cause: LostCause, weeks: LostWeek[], detail: LostDetail, samples: Partial<Record<LostCause, number>>): FindingJson | null {
  const last = weeks[weeks.length - 1];
  const hours = last ? last.hours[cause] : 0;
  if (!last || hours < FINDING_MIN_HOURS) return null;
  const c = confidenceOf(samples[cause] ?? 0);
  const base = {
    id: `lost:${team.id}:${cause}`, teamId: team.id, teamName: team.name, cause, causeLabel: LOST_CAUSE_LABELS[cause].label, hours: r1(hours),
    confidence: c.confidence, confidenceWhy: c.why, trend: weeks.map((w) => w.hours[cause]), formula: LOST_CAUSE_LABELS[cause].rule,
    metricKey: CAUSE_METRIC[cause], recommendationId: null, action: null, expected: null as string | null, since: null as string | null,
  };
  const week = `the week ${last.start} to ${last.end}`;
  if (cause === 'slow_stage') {
    const top = detail.slow_stage[0];
    if (!top) return null;
    const range = top.change && (top.change.fromCommit || top.change.toCommit) ? `${short(top.change.fromCommit) ?? 'the previous run'} … ${short(top.change.toCommit) ?? 'the first slow run'}` : null;
    return {
      ...base, since: top.change?.day ?? top.since,
      title: detail.slow_stage.length === 1 ? `Stage “${top.stage}” is ${dur(top.medianS - top.bestMedianS)} slower than its best week` : `${detail.slow_stage.length} pipeline stages are slower than their best week`,
      summary: `“${top.stage}” took ${dur(top.medianS)} (median) in ${week}; in its best week of the last 12 it took ${dur(top.bestMedianS)}. It ran ${top.runs} times, so the team waited ${r1(top.hours)} hours more.`,
      evidence: [
        { label: 'Slowest against its own best', value: top.stage, detail: `${dur(top.bestMedianS)} → ${dur(top.medianS)}, ${top.runs} runs` },
        ...(top.change ? [{ label: 'Slow since', value: top.change.day, detail: range ? `between commits ${range}` : undefined }] : []),
      ],
      items: detail.slow_stage.slice(0, 8).map((s) => ({ kind: 'stage', name: s.stage, detail: `${dur(s.bestMedianS)} → ${dur(s.medianS)} · ${s.runs} runs · ${r1(s.hours)} h` })),
      nextStep: range ? `Look at what changed between commits ${range} (${top.change!.day}), then split, cache or parallelise “${top.stage}”.` : `Look at what changed in “${top.stage}” around ${top.since}, then split, cache or parallelise it.`,
      expected: `Up to ${r1(hours)} hours a week back when the stages return to their best week.`,
    };
  }
  if (cause === 'flaky_rerun') {
    const runs = detail.flaky_rerun.reduce((n, p) => n + p.failedRuns, 0);
    return {
      ...base,
      title: `${plural(runs, 'pipeline run')} failed and then passed on the same commit`,
      summary: `In ${week}, ${plural(runs, 'run')} failed and a rerun of the same commit passed: the result did not depend on the code. Those runs took ${r1(hours)} hours.`,
      evidence: [{ label: 'Failed runs that passed on a rerun', value: String(runs), detail: `${r1(hours)} h of pipeline time` }],
      items: detail.flaky_rerun.slice(0, 8).map((p) => ({ kind: 'stage', name: p.pipeline || 'Pipeline', detail: `${plural(p.failedRuns, 'failed run')} · ${r1(p.hours)} h` })),
      nextStep: 'Open Flaky test intelligence for the tests behind these runs; quarantine them so they stop blocking merges, then fix the most frequent first.',
      expected: `Up to ${r1(hours)} hours a week of pipeline time back.`,
    };
  }
  if (cause === 'blocked') {
    const top = detail.blocked[0];
    return {
      ...base,
      title: `${plural(detail.blocked.length, 'issue')} waited blocked for ${r1(hours)} working hours`,
      summary: `In ${week}, ${plural(detail.blocked.length, 'issue')} spent ${r1(hours)} working hours in a blocked status or flagged${top ? `; ${top.key} alone waited ${r1(top.hours)} hours` : ''}.`,
      evidence: [{ label: 'Blocked working hours', value: `${r1(hours)} h`, detail: plural(detail.blocked.length, 'issue') }],
      items: detail.blocked.slice(0, 8).map((i) => ({ kind: 'issue', name: i.key, detail: `${i.title ? `${i.title} · ` : ''}${r1(i.hours)} h`, url: i.url })),
      nextStep: top ? `Unblock ${top.key} first, then agree a fixed daily slot with whoever these issues wait for.` : 'Agree a fixed daily slot with whoever these issues wait for.',
      expected: null,
    };
  }
  if (cause === 'failed_change') {
    const byService = new Map<string, number>();
    for (const f of detail.failed_change) byService.set(f.service ?? 'unnamed service', (byService.get(f.service ?? 'unnamed service') ?? 0) + 1);
    const [service, count] = [...byService].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    const n = detail.failed_change.length;
    return {
      ...base,
      title: `${plural(n, 'production deploy')} had to be fixed`,
      summary: `In ${week}, ${plural(n, 'production deploy')} ${n === 1 ? 'was' : 'were'} rolled back, hotfixed or linked to an incident. From deploy to fix took ${r1(hours)} hours in total${service && n > 1 ? `; ${count} of them were deploys of ${service}` : ''}.`,
      evidence: [{ label: 'Failed changes', value: String(n), detail: `${r1(hours)} h from deploy to fix` }],
      items: detail.failed_change.slice(0, 8).map((f) => ({ kind: 'deploy', name: f.deploy, detail: `${f.service ?? 'service not named'} · ${f.day} · ${f.reason}${f.hours === null ? '' : ` · ${r1(f.hours)} h to fix`}`, url: f.url })),
      nextStep: service ? `Add a smoke check after each deploy of ${service}, before traffic is switched; deploy it in smaller releases.` : 'Add a smoke check after each production deploy, before traffic is switched.',
      expected: null,
    };
  }
  const rw = detail.review_wait;
  if (!rw || rw.medianWaitH === null || rw.bestMedianH === null) return null;
  return {
    ...base,
    title: `Pull requests wait ${r1(rw.medianWaitH)} working hours for a first review`,
    summary: `In ${week}, ${plural(rw.pulls, 'pull request')} got a first review after ${r1(rw.medianWaitH)} working hours (median). In the team's best week of the last 12 it was ${r1(rw.bestMedianH)} hours. The difference adds up to ${r1(hours)} hours.`,
    evidence: [{ label: 'First review, median', value: `${r1(rw.medianWaitH)} h`, detail: `best week ${r1(rw.bestMedianH)} h · ${plural(rw.pulls, 'pull request')}` }],
    items: [],
    nextStep: 'Name one reviewer on duty each day, and keep pull requests small enough to review in one sitting.',
    expected: `Up to ${r1(hours)} hours a week back at the team's own best level.`,
  };
}

/** A stored recommendation as a finding; `hours` when its rule is about a measured cause. */
export function recommendationFinding(r: any, teamName: string, weeks: LostWeek[], samples: Partial<Record<LostCause, number>>): FindingJson {
  const cause = RULE_CAUSE[r.rule_key] ?? null;
  const last = weeks[weeks.length - 1];
  const hours = cause && last ? last.hours[cause] : 0;
  const evidence: FindingJson['evidence'] = Array.isArray(r.evidence) ? r.evidence : [];
  const effect = r.effect && typeof r.effect === 'object' ? r.effect : null;
  return {
    id: `rec:${r.id}`, teamId: r.team_id, teamName, cause, causeLabel: cause ? LOST_CAUSE_LABELS[cause].label : null,
    title: r.title, summary: evidence.slice(0, 2).map((e) => `${e.label}: ${e.value}${e.detail ? ` (${e.detail})` : ''}`).join('. '),
    hours: cause && hours >= FINDING_MIN_HOURS ? r1(hours) : null,
    confidence: r.confidence, confidenceWhy: cause ? confidenceOf(samples[cause] ?? 0).why : 'From the team’s KPI history.',
    evidence, items: Array.isArray(r.items) ? r.items : [], trend: cause ? weeks.map((w) => w.hours[cause]) : [], since: null,
    nextStep: r.next_step, expected: effect ? effectText(effect) : null, formula: cause ? LOST_CAUSE_LABELS[cause].rule : null,
    metricKey: r.metric_key ?? null, recommendationId: r.id,
    action: r.a_id ? { id: r.a_id, title: r.a_title, status: r.a_status, owner: r.a_owner ?? null, dueDate: r.a_due ? String(r.a_due).slice(0, 10) : null } : null,
  };
}

/** The findings of one team, the costliest first; a recommendation about a cause replaces the cause's own finding. */
export function teamFindings(team: { id: string; name: string }, weeks: LostWeek[], detail: LostDetail, samples: Partial<Record<LostCause, number>>, recommendations: any[]): FindingJson[] {
  const recs = recommendations.map((r) => recommendationFinding(r, team.name, weeks, samples));
  const taken = new Set<LostCause>();
  for (const f of recs) {
    if (!f.cause) continue;
    // Only the best-ranked recommendation of a cause carries its hours.
    if (taken.has(f.cause)) { f.hours = null; continue; }
    taken.add(f.cause);
    const own = causeFinding(team, f.cause, weeks, detail, samples);
    if (own) { f.since = own.since; f.items = f.items.length ? f.items : own.items; f.evidence = [...f.evidence, ...own.evidence]; }
  }
  const own = LOST_CAUSES.filter((c) => !taken.has(c)).map((c) => causeFinding(team, c, weeks, detail, samples)).filter((f): f is FindingJson => !!f);
  return [...recs, ...own].sort((a, b) => (b.hours ?? -1) - (a.hours ?? -1));
}

export type Verdict = 'owned' | 'waiting' | 'verified' | 'not_held';

/**
 * Where a tracked action stands: owned (open or in progress), then, once done, waiting for the verdict until its
 * 14-day checkpoint has a value; verified when the latest decided checkpoint (30 days, else 14) improved on the
 * baseline; not held when it is unchanged or worse. An action without a linked metric stays "waiting": no metric,
 * no verdict.
 */
export function verdictOf(a: Pick<ActionJson, 'status' | 'outcomes'>): Verdict | null {
  if (a.status === 'open' || a.status === 'in_progress') return 'owned';
  if (a.status !== 'done') return null;
  const decided = ['d30', 'd14'].map((k) => a.outcomes.find((o) => o.checkpoint === k)).find((o) => o && (o.outcome === 'improved' || o.outcome === 'unchanged' || o.outcome === 'worse'));
  if (!decided) return 'waiting';
  return decided.outcome === 'improved' ? 'verified' : 'not_held';
}

export type SourceKey = 'pipelines' | 'tests' | 'coverage' | 'deployments' | 'incidents' | 'issues' | 'pull_requests' | 'performance' | 'test_management';
export type SourceState = 'ok' | 'stale' | 'missing';

export const SOURCES: Array<{ key: SourceKey; label: string; required: boolean; blocks: string[]; fix: string; effort: string }> = [
  { key: 'pipelines', label: 'CI runs', required: true, blocks: ['Build time', 'Pipeline health', 'Hours lost: slow stages, flaky reruns'],
    fix: 'Add the CI tool as a source of the QE Navigator Exporter and map its jobs or pipelines to the team on the Exporter’s setup page.', effort: 'About 15 minutes' },
  { key: 'tests', label: 'Test reports', required: true, blocks: ['Flaky tests', 'First-time pass rate', 'Test execution time', 'Slowest tests'],
    fix: 'Keep the JUnit (or TRX, Cucumber) report the test step already writes as a pipeline artifact; the Exporter reads it from there.', effort: '1 line in the pipeline file' },
  { key: 'coverage', label: 'Coverage', required: true, blocks: ['Test coverage', 'Coverage of changed code', 'QA score', 'Defect density'],
    fix: 'Keep the coverage file (lcov, Cobertura, JaCoCo) as a pipeline artifact, or connect SonarQube for the totals.', effort: '1 line in the pipeline file' },
  { key: 'deployments', label: 'Deployments', required: true, blocks: ['Deployment frequency', 'Lead time', 'Change failure rate', 'Hours lost: failed changes'],
    fix: 'Map the job or environment that deploys to production to the team on the Exporter’s setup page.', effort: 'A few minutes' },
  { key: 'incidents', label: 'Incidents', required: true, blocks: ['Time to restore', 'Availability', 'Time between failures'],
    fix: 'Connect the on-call tool (PagerDuty, Opsgenie) with a read-only key and name the team’s services.', effort: 'About 10 minutes' },
  { key: 'issues', label: 'Issues', required: true, blocks: ['Defect escape rate', 'Sprint commitment', 'Blocked time', 'Hours lost: blocked work'],
    fix: 'Connect Jira or Azure Boards with a read-only key and name the team’s projects.', effort: 'About 10 minutes' },
  { key: 'pull_requests', label: 'Pull requests', required: false, blocks: ['Hours lost: waiting for review', 'Developer metrics: merge and review time'],
    fix: 'Turn on pull requests for the source-control source of the Exporter.', effort: '1 line in the Exporter configuration' },
  { key: 'performance', label: 'Load tests', required: false, blocks: ['Performance: response time, error rate'],
    fix: 'Save the result file of the load test (k6 summary, JMeter .jtl, Gatling stats) as a pipeline artifact.', effort: '1–2 lines in the pipeline file' },
  { key: 'test_management', label: 'Test management', required: false, blocks: ['Automation coverage', 'Automation ROI'],
    fix: 'Connect TestRail, Xray Cloud or Zephyr Scale with a read-only key.', effort: 'About 10 minutes' },
];

export interface DiscoveryReport {
  source: string; reportedAt: string; exporterVersion: string | null;
  counts: Record<string, number>; runsWithoutTests: number | null; runsWithoutCoverage: number | null; unmapped: string[]; notes: string[];
}

/** Share of the required sources that send data (per cent). */
export function readinessPercent(cells: Record<SourceKey, SourceState>): number {
  const required = SOURCES.filter((s) => s.required);
  return Math.round((required.filter((s) => cells[s.key] === 'ok').length / required.length) * 100);
}

/** What the Exporter saw that explains a gap, as sentences (from its discovery report). */
export function discoveryHints(key: SourceKey, reports: DiscoveryReport[]): string[] {
  const out: string[] = [];
  for (const r of reports) {
    const runs = r.counts.pipelineRuns ?? 0;
    if (key === 'tests' && runs > 0 && r.runsWithoutTests !== null && r.runsWithoutTests > 0) out.push(`${r.source}: ${r.runsWithoutTests} of ${runs} pipeline runs kept no test report.`);
    if (key === 'coverage' && runs > 0 && r.runsWithoutCoverage !== null && r.runsWithoutCoverage > 0) out.push(`${r.source}: ${r.runsWithoutCoverage} of ${runs} pipeline runs kept no coverage file.`);
    if ((key === 'pipelines' || key === 'deployments') && r.unmapped.length) out.push(`${r.source}: not mapped to any team: ${r.unmapped.slice(0, 5).join(', ')}${r.unmapped.length > 5 ? ` and ${r.unmapped.length - 5} more` : ''}.`);
  }
  return out;
}
