/**
 * The records the calculations read, built from parsed reports and events exactly as the QE Navigator raw store
 * keeps them (server/lib/ingest/store.ts, deliveryStore.ts, workStore.ts): the same identities, the same merge
 * rules for a record sent again (a deployment that became rolled back, an incident's status stream, an issue's
 * growing sprint list, a sprint's dates sent later), and the same selection of rows per range of days as the
 * server's loaders. The QE Navigator Collector keeps these records in its local copy and calculates from them;
 * the cross-check test proves both paths give the same values.
 *
 * All times are epoch milliseconds (JSON-friendly). Pure: no database, no clock unless passed in.
 */
import { createHash } from 'node:crypto';
import type { ParsedTestReport } from '../parsers/testReports';
import { testKey } from '../parsers/testReports';
import type { ChangedLines, ParsedCoverage } from '../parsers/coverageReports';
import { changedCoverage } from '../parsers/coverageReports';
import type { PipelineRunEvent } from '../parsers/pipelineEvents';
import type { CommitEvent, DeploymentEvent, IncidentEvent, IncidentStatus, Severity } from '../parsers/deliveryEvents';
import type { IssueEvent, SprintRef } from '../parsers/issueEvents';
import type { ParsedAnalysis } from '../parsers/sarif';
import { severityCounts } from '../parsers/sarif';
import type { CiData, CoverageRec, PipelineRec, TestRunRec } from '../calc/ci';
import { isMainBranch } from '../calc/ci';
import type { DeliveryData } from '../calc/delivery';
import { WINDOW_DAYS } from '../calc/delivery';
import type { IssueRow, SprintRow, WorkData } from '../calc/work';
import { SPRINT_STALE_DAYS, WORK_WINDOW_DAYS } from '../calc/work';
import type { QualityData, ReportRow } from '../calc/quality';
import { REPORT_STALE_DAYS } from '../calc/quality';

const DAY = 86_400_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const t = (d: Date | null | undefined): number | null => (d ? d.getTime() : null);
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);
/** A stable id for a record from its identity (the Collector has no database to hand out ids). */
export const recordId = (...parts: Array<string | number | null | undefined>) =>
  createHash('sha256').update(parts.map((p) => String(p ?? '')).join('\u0000')).digest('hex').slice(0, 32);

// ------------------------------------------------------------------------------------------------
// Tests, coverage, pipelines
// ------------------------------------------------------------------------------------------------

export interface RunMeta { commit: string; branch: string | null; runId: string; attempt: number; startedAt: number }

/** A test run from a parsed report (as storeTestRun keeps it); its id is derived from team + commit + run + attempt. */
export function testRunRecord(team: string, rep: ParsedTestReport, m: RunMeta): TestRunRec {
  return {
    id: recordId('tests', team, m.commit, m.runId, m.attempt), commit: m.commit, runId: m.runId, attempt: m.attempt, branch: m.branch,
    day: dayOf(m.startedAt), startedAt: m.startedAt, passed: rep.counts.passed, failed: rep.counts.failed, errored: rep.counts.errored, skipped: rep.counts.skipped,
    durationMs: rep.durationMs, format: rep.format,
    cases: rep.cases.map((c) => ({ testKey: testKey(c.suite, c.name), suite: c.suite, name: c.name, status: c.status, durationMs: Math.min(c.durationMs, 2_000_000_000), retries: c.retries })),
  };
}

/** A coverage report (as storeCoverage keeps it), with the coverage of the changed lines when a diff was given. */
export function coverageRecord(team: string, cov: ParsedCoverage, m: Omit<RunMeta, 'startedAt'> & { createdAt: number }, changed: ChangedLines | null = null): CoverageRec {
  const ch = changed ? changedCoverage(cov, changed) : null;
  return {
    id: recordId('coverage', team, m.commit, m.runId, m.attempt), commit: m.commit, branch: m.branch, attempt: m.attempt, day: dayOf(m.createdAt), createdAt: m.createdAt,
    format: cov.format, linesFound: cov.totals.linesFound, linesHit: cov.totals.linesHit, branchesFound: cov.totals.branchesFound, branchesHit: cov.totals.branchesHit,
    fileCount: cov.files.length, changedLinesFound: ch ? ch.found : null, changedLinesHit: ch ? ch.hit : null,
    files: cov.files.map((f) => ({ path: f.path, linesFound: f.linesFound, linesHit: f.linesHit, branchesFound: f.branchesFound, branchesHit: f.branchesHit })),
  };
}

/** A pipeline run attempt (as storePipelineRuns keeps it). */
export function pipelineRecord(team: string, run: PipelineRunEvent): PipelineRec {
  return {
    id: recordId('pipelines', team, run.id, run.attempt), externalId: run.id, attempt: run.attempt, name: run.name, commit: run.commit, branch: run.branch,
    day: dayOf(run.startedAt.getTime()), startedAt: run.startedAt.getTime(), finishedAt: t(run.finishedAt), durationS: run.durationS, result: run.result, url: run.url,
    stages: run.stages.map((s) => ({ name: s.name, kind: s.kind, parallelGroup: s.parallelGroup, startedAt: t(s.startedAt), finishedAt: t(s.finishedAt), durationS: s.durationS, result: s.result })),
  };
}

// ------------------------------------------------------------------------------------------------
// Deliveries and incidents
// ------------------------------------------------------------------------------------------------

export interface DeploymentRec {
  id: string; externalId: string; environment: string; production: boolean; service: string | null; commit: string; commitShas: string[]; commitFrom: string | null;
  startedAt: number | null; finishedAt: number; day: string; result: 'success' | 'failure' | 'rolled_back'; rollbackOf: string | null; hotfix: boolean; url: string | null;
}
export interface CommitRec { sha: string; deployment: string; authoredAt: number | null; committedAt: number | null; branch: string | null }
export interface IncidentRec {
  id: string; externalId: string; title: string | null; severity: Severity; service: string | null; status: IncidentStatus; openedAt: number;
  acknowledgedAt: number | null; resolvedAt: number | null; day: string; outage: boolean | null; category: string | null; deployment: string | null; url: string | null;
  updates: Array<{ status: IncidentStatus; at: number }>;
}

/** A deployment (as storeDeployments keeps it; a later event with the same id replaces it). */
export function deploymentRecord(team: string, e: DeploymentEvent): DeploymentRec {
  return {
    id: recordId('deployments', team, e.id), externalId: e.id, environment: e.environment, production: e.production, service: e.service, commit: e.commit,
    commitShas: Array.from(new Set([e.commit, ...e.commits.map((c) => c.sha)].filter(Boolean))), commitFrom: e.commitFrom,
    startedAt: t(e.startedAt), finishedAt: e.finishedAt.getTime(), day: dayOf(e.finishedAt.getTime()), result: e.result, rollbackOf: e.rollbackOf, hotfix: e.hotfix, url: e.url,
  };
}

/** Merge commits (team + sha + deployment; times sent later fill the gaps). Returns the number added or changed. */
export function mergeCommits(list: CommitRec[], deployment: string, branch: string | null, commits: CommitEvent[]): number {
  let n = 0;
  const seen = new Set<string>();
  for (const c of commits) {
    if (seen.has(c.sha)) continue;
    seen.add(c.sha);
    const prev = list.find((x) => x.sha === c.sha && x.deployment === deployment);
    if (!prev) { list.push({ sha: c.sha, deployment, authoredAt: t(c.authoredAt), committedAt: t(c.committedAt), branch }); n++; continue; }
    const a = t(c.authoredAt);
    const m = t(c.committedAt);
    if ((a !== null && prev.authoredAt !== a) || (m !== null && prev.committedAt !== m)) {
      prev.authoredAt = a ?? prev.authoredAt;
      prev.committedAt = m ?? prev.committedAt;
      n++;
    }
    prev.branch = prev.branch ?? branch;
  }
  return n;
}

export class RecordError extends Error {}

/**
 * An incident after one more event (as storeIncidents merges it): created by the first event, updated by the
 * next ones (acknowledged, resolved, reopened); `now` is the time a status update without a time counts at.
 */
export function mergeIncident(team: string, prev: IncidentRec | null, e: IncidentEvent, now: number): IncidentRec {
  const at = t(e.at);
  const min = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
  const opened = min(prev?.openedAt ?? null, t(e.openedAt));
  if (opened === null) throw new RecordError(`incident ${e.id} is new: its first event needs openedAt`);
  let ack = min(prev?.acknowledgedAt ?? null, t(e.acknowledgedAt));
  let resolved = prev?.resolvedAt ?? null;
  if (e.status === 'acknowledged' && ack === null) ack = at ?? now;
  if (e.status === 'resolved') resolved = t(e.resolvedAt) ?? at ?? resolved ?? now;
  else if (e.resolvedAt) resolved = e.resolvedAt.getTime();
  else if (e.status === 'open' && resolved !== null && (at ?? now) > resolved) resolved = null;
  if (resolved !== null && resolved < opened) throw new RecordError(`incident ${e.id} would be resolved before it was opened`);
  if (ack !== null && ack < opened) ack = opened;
  const status: IncidentStatus = resolved !== null ? 'resolved' : ack !== null ? 'acknowledged' : 'open';
  const updates = [...(prev?.updates ?? [])];
  const add = (s: IncidentStatus, x: number) => { if (!updates.some((u) => u.status === s && u.at === x)) updates.push({ status: s, at: x }); };
  add('open', opened);
  if (ack !== null) add('acknowledged', ack);
  if (resolved !== null) add('resolved', resolved);
  if (e.status && at !== null) add(e.status, at);
  return {
    id: prev?.id ?? recordId('incidents', team, e.id), externalId: e.id, title: e.title ?? prev?.title ?? null, severity: e.severity ?? prev?.severity ?? 'medium',
    service: e.service ?? prev?.service ?? null, status, openedAt: opened, acknowledgedAt: ack, resolvedAt: resolved, day: dayOf(opened),
    outage: e.outage ?? prev?.outage ?? null, category: e.category ?? prev?.category ?? null, deployment: e.deployment ?? prev?.deployment ?? null,
    url: e.url ?? prev?.url ?? null, updates: updates.sort((a, b) => a.at - b.at),
  };
}

/** The deploys and incidents the days from `from` to `to` depend on (the selection of loadDeliveryData). */
export function deliveryData(deployments: DeploymentRec[], commits: CommitRec[], incidents: IncidentRec[], from: string, to: string): DeliveryData {
  const lo = dayStart(from);
  const hi = dayStart(to) + DAY;
  const prod = deployments.filter((d) => d.production);
  const deploys = prod.filter((d) => d.finishedAt >= lo - (WINDOW_DAYS + 3) * DAY && d.finishedAt < hi).sort((a, b) => a.finishedAt - b.finishedAt).map((d) => {
    const shas = new Set(d.commitShas);
    const related = commits.filter((c) => c.deployment === d.externalId || shas.has(c.sha));
    const authored = related.map((c) => c.authoredAt).filter((x): x is number => x !== null);
    const counted = new Set([...d.commitShas, ...commits.filter((c) => c.deployment === d.externalId).map((c) => c.sha)]);
    return {
      id: d.id, externalId: d.externalId, service: d.service, environment: d.environment, result: d.result, rollbackOf: d.rollbackOf, hotfix: d.hotfix,
      startedAt: d.startedAt, finishedAt: d.finishedAt, firstAuthoredAt: authored.length ? Math.min(...authored) : null, commitCount: counted.size, commit: d.commit, url: d.url,
    };
  });
  const inc = incidents.filter((i) => i.openedAt < hi && (i.openedAt >= lo - 150 * DAY || i.resolvedAt === null || i.resolvedAt >= lo - (WINDOW_DAYS + 3) * DAY))
    .sort((a, b) => a.openedAt - b.openedAt)
    .map((i) => ({
      id: i.id, externalId: i.externalId, title: i.title, service: i.service, severity: i.severity, outage: i.outage, category: i.category,
      openedAt: i.openedAt, acknowledgedAt: i.acknowledgedAt, resolvedAt: i.resolvedAt, deployment: i.deployment, url: i.url,
    }));
  const firstDeploy = prod.length ? Math.min(...prod.map((d) => d.finishedAt)) : null;
  const firstIncident = incidents.length ? Math.min(...incidents.map((i) => i.openedAt)) : null;
  return { deploys, incidents: inc, firstDeployAt: firstDeploy, firstIncidentAt: firstIncident, hasCategories: incidents.some((i) => i.category !== null) };
}

// ------------------------------------------------------------------------------------------------
// Work and code quality
// ------------------------------------------------------------------------------------------------

export interface SprintRec { id: string; externalId: string; name: string | null; state: 'future' | 'active' | 'closed'; startedAt: number | null; endsAt: number | null; completedAt: number | null }
export interface IssueRec {
  id: string; key: string; title: string | null; type: string; status: string | null; statusCategory: string; resolution: string | null; foundIn: string | null;
  environment: string | null; points: number | null; estimate: number | null; logged: number | null; sprintIds: string[]; openedAt: number; resolvedAt: number | null;
  updatedAt: number | null; url: string | null; components: string[]; hash: string;
  transitions: Array<{ field: 'status' | 'flagged' | 'sprint'; from: string | null; to: string; toCategory: string | null; at: number }>;
}

/** A sprint after one more reference (as storeSprints merges it: values sent later fill what was missing). */
export function mergeSprint(team: string, prev: SprintRec | null, s: SprintRef, now: number): SprintRec {
  const state = s.state ?? (s.completedAt ? 'closed' : s.startedAt && s.startedAt.getTime() <= now ? 'active' : 'future');
  const unknown = !s.state && !s.startedAt && !s.endsAt && !s.completedAt;
  if (!prev) return { id: recordId('sprints', team, s.id), externalId: s.id, name: s.name, state, startedAt: t(s.startedAt), endsAt: t(s.endsAt), completedAt: t(s.completedAt) };
  return {
    ...prev, name: s.name ?? prev.name,
    state: unknown || (prev.state === 'closed' && !s.completedAt) ? prev.state : state,
    startedAt: t(s.startedAt) ?? prev.startedAt, endsAt: t(s.endsAt) ?? prev.endsAt, completedAt: t(s.completedAt) ?? prev.completedAt,
  };
}

/** An issue after one more event (as storeIssues merges it): an older event is ignored, the sprint list only grows, changes are kept once. */
export function mergeIssue(team: string, prev: IssueRec | null, e: IssueEvent): IssueRec {
  const sprintIds = e.sprints.map((s) => s.id);
  const hash = createHash('sha256').update(JSON.stringify([e.title, e.type, e.typeLabel, e.status, e.statusCategory, e.resolution, e.priority, e.environment, e.storyPoints,
    e.estimateHours, e.timeLoggedHours, sprintIds, e.labels, e.components, e.createdAt.toISOString(), e.resolvedAt?.toISOString() ?? null, e.url])).digest('hex');
  const older = !!prev && prev.updatedAt !== null && e.updatedAt !== null && e.updatedAt.getTime() < prev.updatedAt;
  let rec: IssueRec;
  if (prev && (prev.hash === hash || older)) rec = { ...prev, transitions: [...prev.transitions] };
  else {
    rec = {
      id: prev?.id ?? recordId('issues', team, e.key), key: e.key, title: e.title, type: e.type, status: e.status, statusCategory: e.statusCategory, resolution: e.resolution,
      foundIn: e.foundIn, environment: e.environment, points: e.storyPoints, estimate: e.estimateHours, logged: e.timeLoggedHours,
      sprintIds: prev ? Array.from(new Set([...prev.sprintIds, ...sprintIds])) : sprintIds, openedAt: e.createdAt.getTime(), resolvedAt: t(e.resolvedAt),
      updatedAt: t(e.updatedAt) ?? prev?.updatedAt ?? null, url: e.url ?? prev?.url ?? null, components: e.components, hash,
      transitions: prev ? [...prev.transitions] : [],
    };
  }
  for (const x of e.transitions) {
    const to = x.to.slice(0, 255);
    if (!rec.transitions.some((y) => y.field === x.field && y.at === x.at.getTime() && y.to === to)) rec.transitions.push({ field: x.field, from: x.from, to, toCategory: x.toCategory, at: x.at.getTime() });
  }
  rec.transitions.sort((a, b) => a.at - b.at);
  return rec;
}

/** The sprints, issues and coverage sizes the days from `from` to `to` depend on (the selection of loadWorkData). */
export function workData(sprints: SprintRec[], issues: IssueRec[], coverage: CoverageRec[], mainBranch: string | null, from: string, to: string): WorkData {
  const lo = dayStart(from);
  const hi = dayStart(to) + DAY;
  const sp: SprintRow[] = [...sprints].sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity)).map((s) => ({ id: s.id, externalId: s.externalId, name: s.name, startedAt: s.startedAt, completedAt: s.completedAt }));
  const is: IssueRow[] = issues
    .filter((i) => i.openedAt < hi && (i.resolvedAt === null || i.resolvedAt >= lo - (SPRINT_STALE_DAYS + 30) * DAY || i.openedAt >= lo - (WORK_WINDOW_DAYS + 3) * DAY))
    .map((i) => ({
      id: i.id, key: i.key, title: i.title, type: i.type, statusCategory: i.statusCategory, resolution: i.resolution, foundIn: i.foundIn, environment: i.environment,
      points: i.points, estimate: i.estimate, logged: i.logged, sprintIds: i.sprintIds, openedAt: i.openedAt, resolvedAt: i.resolvedAt, url: i.url, components: i.components,
      transitions: i.transitions.map((x) => ({ field: x.field, from: x.from, to: x.to, toCategory: x.toCategory, at: x.at })),
    }));
  return { sprints: sp, issues: is, coverage: coverageSizes(coverage, mainBranch, hi), hasSprints: sprints.length > 0 };
}

const coverageSizes = (coverage: CoverageRec[], mainBranch: string | null, hi: number) =>
  coverage.filter((c) => c.createdAt < hi && c.linesFound > 0 && isMainBranch(c.branch, mainBranch)).sort((a, b) => a.createdAt - b.createdAt).map((c) => ({ id: c.id, at: c.createdAt, linesFound: c.linesFound }));

export interface AnalysisRec {
  id: string; tool: string; repo: string; branch: string | null; commit: string; runId: string; attempt: number; analyzedAt: number; day: string; linesOfCode: number | null;
  findings: number; critical: number; high: number; medium: number; low: number; info: number;
  /** The findings' fingerprints (new / fixed against the previous report of the series). */
  fingerprints: string[];
  /** Per finding: rule and severity, and the path when the privacy mode keeps it (local evidence page). */
  rules: Array<{ ruleId: string; severity: string; path: string | null }>;
}

/** A static-analysis report (as storeAnalysis keeps it); the id is derived from team + tool + repo + commit + run + attempt. */
export function analysisRecord(team: string, a: ParsedAnalysis, m: { repo: string; branch: string | null; commit: string; runId: string; attempt: number; analyzedAt: number; linesOfCode: number | null }): AnalysisRec {
  const c = severityCounts(a.findings);
  return {
    id: recordId('static-analysis', team, a.tool, m.repo, m.commit, m.runId, m.attempt), tool: a.tool, repo: m.repo, branch: m.branch, commit: m.commit, runId: m.runId, attempt: m.attempt,
    analyzedAt: m.analyzedAt, day: dayOf(m.analyzedAt), linesOfCode: m.linesOfCode, findings: a.findings.length, critical: c.critical, high: c.high, medium: c.medium, low: c.low, info: c.info,
    fingerprints: Array.from(new Set(a.findings.map((f) => f.fingerprint))), rules: a.findings.slice(0, 5000).map((f) => ({ ruleId: f.ruleId, severity: f.severity, path: f.path })),
  };
}

/** The reports and coverage sizes the days from `from` to `to` depend on (the selection of loadQualityData), with new / fixed findings per series. */
export function qualityData(analyses: AnalysisRec[], coverage: CoverageRec[], mainBranch: string | null, from: string, to: string): QualityData {
  const lo = dayStart(from);
  const hi = dayStart(to) + DAY;
  const series = new Map<string, AnalysisRec[]>();
  for (const a of analyses) {
    const k = `${a.repo}\u0000${a.tool}\u0000${a.branch ?? ''}`;
    const l = series.get(k) ?? [];
    l.push(a);
    series.set(k, l);
  }
  const linked = new Map<string, { newFindings: number; fixedFindings: number }>();
  for (const l of series.values()) {
    l.sort((a, b) => a.analyzedAt - b.analyzedAt);
    for (let i = 1; i < l.length; i++) {
      const prev = new Set(l[i - 1].fingerprints);
      const cur = new Set(l[i].fingerprints);
      linked.set(l[i].id, { newFindings: l[i].fingerprints.filter((f) => !prev.has(f)).length, fixedFindings: l[i - 1].fingerprints.filter((f) => !cur.has(f)).length });
    }
  }
  const reports: ReportRow[] = analyses.filter((a) => a.analyzedAt >= lo - (REPORT_STALE_DAYS + 1) * DAY && a.analyzedAt < hi).sort((a, b) => a.analyzedAt - b.analyzedAt).map((a) => ({
    id: a.id, tool: a.tool, repo: a.repo, branch: a.branch, commit: a.commit, analyzedAt: a.analyzedAt, linesOfCode: a.linesOfCode, findings: a.findings,
    critical: a.critical, high: a.high, medium: a.medium, low: a.low, info: a.info, newFindings: linked.get(a.id)?.newFindings ?? null, fixedFindings: linked.get(a.id)?.fixedFindings ?? null,
    main: isMainBranch(a.branch, mainBranch),
  }));
  return { reports, coverage: coverageSizes(coverage, mainBranch, hi) };
}

/** The CI records the days from `from` to `to` depend on (flaky tests look back 6 more days; the evidence 29). */
export function ciData(testRuns: TestRunRec[], coverage: CoverageRec[], pipelines: PipelineRec[], mainBranch: string | null, from: string, to: string, lookbackDays = 6): CiData {
  const lo = new Date(dayStart(from) - lookbackDays * DAY).toISOString().slice(0, 10);
  const inRange = (d: string) => d >= lo && d <= to;
  return { mainBranch, testRuns: testRuns.filter((r) => inRange(r.day)), coverage: coverage.filter((c) => inRange(c.day)), pipelines: pipelines.filter((p) => inRange(p.day)) };
}
