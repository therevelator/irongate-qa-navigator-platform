/**
 * The field allow-list (fieldAllowList.ts) on the server's write paths for issues and incidents:
 * POST /api/ingest/issues, POST /api/ingest/incidents and file uploads (they call the same handlers).
 *
 *   applyIssueAllowList / applyIncidentAllowList  the parsed events keep only allowed values before
 *     they are stored: titles dropped when the company setting "Store issue and incident titles" is off,
 *     priority dropped, labels reduced to the ones the calculations read;
 *   minimisedIssuePayload / minimisedIncidentPayload  the copy kept in raw_uploads.payload is the
 *     minimised JSON of the parsed events (never the body as received, which may hold descriptions,
 *     comments and e-mail addresses);
 *   storeTitlesOf  the company setting (companies.store_issue_titles, migration 20261203000000;
 *     true when the column does not exist yet).
 *
 * Every other kind is kept the same way (RAW_ALLOW_LIST below): the copy in raw_uploads.payload is built from the
 * parsed data with an allow-list of fields, never the body as received. Dropped on every kind: names, e-mail
 * addresses, commit messages, test failure messages and output, test properties (host names, user names),
 * SARIF result messages, and every field the parser does not read. Commit authors are kept as the salted hash
 * only (authorHash, the same as deployment_commits.author_hash); home-directory prefixes of file paths
 * (/home/<user>/, /Users/<user>/, C:/Users/<user>/) are replaced by "~/".
 */
import { query } from '../../../src/lib/db';
import { minimiseRecord, minimiseSprint, usefulLabel } from './allowListPolicy';
import type { IssueEvent, SprintRef } from './issueEvents';
import { authorHash, type CommitBatch, type CommitEvent, type DeploymentEvent, type IncidentEvent } from './deliveryEvents';
import type { ParsedTestReport } from './testReports';
import { failureHash } from './testReports';
import type { ParsedCoverage } from './coverageReports';
import type { PipelineRunEvent } from './pipelineEvents';
import type { ParsedAnalysis } from './sarif';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function storeTitlesOf(companyId: string): Promise<boolean> {
  try {
    const r = await query<any[]>('SELECT store_issue_titles FROM companies WHERE id = ?', [companyId]);
    return r[0]?.store_issue_titles !== false;
  } catch {
    return true;
  }
}

/** The parsed issues keep only allowed values before they are stored (fieldAllowList.ts): no priority, only the labels the calculations read, titles per the setting. */
export function applyIssueAllowList(events: IssueEvent[], storeTitles: boolean): void {
  for (const e of events) {
    if (!storeTitles) e.title = null;
    e.priority = null;
    e.labels = e.labels.filter(usefulLabel);
  }
}

export function applyIncidentAllowList(events: IncidentEvent[], storeTitles: boolean): void {
  for (const e of events) {
    if (!storeTitles) e.title = null;
  }
}

const sprintRecord = (s: SprintRef) => ({ id: s.id, name: s.name, state: s.state, startedAt: iso(s.startedAt), endsAt: iso(s.endsAt), completedAt: iso(s.completedAt) });

/** An issue event as a QE Navigator JSON record (the body shape of /api/ingest/issues, format json). */
export function issueRecord(e: IssueEvent): Record<string, unknown> {
  const people = (e.people ?? {}) as Record<string, string | null>;
  return {
    key: e.key, team: e.team, project: e.project, title: e.title, type: e.typeLabel ?? e.type, status: e.status, statusCategory: e.statusCategory,
    resolution: e.resolution, environment: e.environment, storyPoints: e.storyPoints, estimateHours: e.estimateHours, timeLoggedHours: e.timeLoggedHours,
    sprints: e.sprints.map(sprintRecord), labels: e.labels, components: e.components, createdAt: iso(e.createdAt), resolvedAt: iso(e.resolvedAt),
    updatedAt: iso(e.updatedAt), url: e.url,
    transitions: e.transitions.map((t) => ({ field: t.field, from: t.from, to: t.to, toCategory: t.toCategory, at: iso(t.at) })),
    ...people,
  };
}

/** An incident event as a QE Navigator JSON record (the body shape of /api/ingest/incidents, format json). */
export function incidentRecord(e: IncidentEvent): Record<string, unknown> {
  const people = (e.people ?? {}) as Record<string, string | null>;
  return {
    id: e.id, team: e.team, title: e.title, severity: e.severityLabel ?? e.severity, service: e.service, status: e.status,
    openedAt: iso(e.openedAt), acknowledgedAt: iso(e.acknowledgedAt), resolvedAt: iso(e.resolvedAt), at: iso(e.at), deploymentId: e.deployment,
    outage: e.outage, category: e.category, url: e.url, ...people,
  };
}

/** What raw_uploads keeps of an issues request: the minimised records, never the body as received. */
export function minimisedIssuePayload(companyId: string, issues: IssueEvent[], sprints: SprintRef[], storeTitles: boolean): Buffer {
  const out = issues.map((e) => minimiseRecord('issue', issueRecord(e), { storeTitles, salt: companyId }).record);
  return Buffer.from(JSON.stringify({ minimised: true, issues: out, sprints: sprints.map((s) => minimiseSprint(sprintRecord(s))).filter(Boolean) }));
}

export function minimisedIncidentPayload(companyId: string, incidents: IncidentEvent[], storeTitles: boolean): Buffer {
  return Buffer.from(JSON.stringify({ minimised: true, incidents: incidents.map((e) => minimiseRecord('incident', incidentRecord(e), { storeTitles, salt: companyId }).record) }));
}

/**
 * The fields kept in raw_uploads.payload for the kinds without a FIELD_ALLOW_LIST entry (issues and incidents use
 * fieldAllowList.ts). Anything not listed here is dropped.
 */
export const RAW_ALLOW_LIST = {
  testReport: ['format', 'startedAt', 'durationMs', 'counts', 'cases'],
  testCase: ['suite', 'name', 'status', 'durationMs', 'retries', 'failureHash'],
  coverage: ['format', 'startedAt', 'totals', 'files', 'changedLines'],
  coverageFile: ['path', 'linesFound', 'linesHit', 'branchesFound', 'branchesHit'],
  pipelineRun: ['id', 'attempt', 'name', 'commit', 'branch', 'startedAt', 'finishedAt', 'durationS', 'result', 'url', 'stages'],
  pipelineStage: ['name', 'kind', 'parallelGroup', 'startedAt', 'finishedAt', 'durationS', 'result'],
  analysis: ['tool', 'toolVersion', 'repo', 'branch', 'commit', 'analyzedAt', 'linesOfCode', 'suppressed', 'rules', 'findings'],
  finding: ['fingerprint', 'ruleId', 'ruleName', 'severity', 'level', 'category', 'path', 'line'],
  deployment: ['id', 'team', 'environment', 'production', 'service', 'commit', 'commitFrom', 'startedAt', 'finishedAt', 'result', 'rollbackOf', 'hotfix', 'url', 'commits'],
  commitBatch: ['team', 'service', 'deployment', 'branch', 'commits'],
  commit: ['sha', 'authoredAt', 'committedAt', 'authorHash'],
} as const;

/** A path without the home-directory prefix (/home/<user>/, /Users/<user>/, C:/Users/<user>/) that names the person who ran the build. */
export function redactPath(p: string | null | undefined): string | null {
  if (!p) return p ?? null;
  // The leading separator is optional: the SARIF parser drops "file:///" (file:///home/jdoe/a.js → home/jdoe/a.js).
  return p.replace(/^(file:\/\/)?(\/?[A-Za-z]:)?[\\/]?(home|Users|users)[\\/][^\\/]+[\\/]/, '$1~/');
}

const keep = <T extends Record<string, unknown>>(o: T, fields: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(fields.filter((f) => o[f] !== undefined).map((f) => [f, o[f]]));

const json = (o: unknown) => Buffer.from(JSON.stringify(o));

export function minimisedTestPayload(rep: ParsedTestReport): Buffer {
  return json({
    minimised: true, kind: 'tests',
    ...keep({
      format: rep.format, startedAt: iso(rep.startedAt), durationMs: rep.durationMs, counts: rep.counts,
      cases: rep.cases.map((c) => keep({ suite: c.suite, name: c.name, status: c.status, durationMs: c.durationMs, retries: c.retries, failureHash: failureHash(c.message) }, RAW_ALLOW_LIST.testCase)),
    }, RAW_ALLOW_LIST.testReport),
  });
}

export function minimisedCoveragePayload(cov: ParsedCoverage, changedLines: { found: number; hit: number } | null = null): Buffer {
  return json({
    minimised: true, kind: 'coverage',
    ...keep({
      format: cov.format, startedAt: iso(cov.startedAt ?? null), totals: cov.totals, changedLines: changedLines ?? undefined,
      files: cov.files.map((f) => keep({ path: redactPath(f.path), linesFound: f.linesFound, linesHit: f.linesHit, branchesFound: f.branchesFound, branchesHit: f.branchesHit }, RAW_ALLOW_LIST.coverageFile)),
    }, RAW_ALLOW_LIST.coverage),
  });
}

export function minimisedPipelinePayload(runs: PipelineRunEvent[]): Buffer {
  return json({
    minimised: true, kind: 'pipelines',
    runs: runs.map((r) => keep({
      id: r.id, attempt: r.attempt, name: r.name, commit: r.commit, branch: r.branch, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt),
      durationS: r.durationS, result: r.result, url: r.url,
      stages: r.stages.map((s) => keep({ name: s.name, kind: s.kind, parallelGroup: s.parallelGroup, startedAt: iso(s.startedAt), finishedAt: iso(s.finishedAt), durationS: s.durationS, result: s.result }, RAW_ALLOW_LIST.pipelineStage)),
    }, RAW_ALLOW_LIST.pipelineRun)),
  });
}

export function minimisedAnalysisPayload(reports: ParsedAnalysis[]): Buffer {
  return json({
    minimised: true, kind: 'static-analysis',
    reports: reports.map((r) => keep({
      tool: r.tool, toolVersion: r.toolVersion, repo: r.repo, branch: r.branch, commit: r.commit, analyzedAt: iso(r.analyzedAt), linesOfCode: r.linesOfCode,
      suppressed: r.suppressed, rules: r.rules,
      findings: r.findings.map((f) => keep({ fingerprint: f.fingerprint, ruleId: f.ruleId, ruleName: f.ruleName, severity: f.severity, level: f.level, category: f.category, path: redactPath(f.path), line: f.line }, RAW_ALLOW_LIST.finding)),
    }, RAW_ALLOW_LIST.analysis)),
  });
}

/** A commit as kept: its sha, times and the salted hash of its author (never the name, e-mail or message). */
function commitRecord(companyId: string, c: CommitEvent): Record<string, unknown> {
  return keep({ sha: c.sha, authoredAt: iso(c.authoredAt), committedAt: iso(c.committedAt), authorHash: c.authorHash ?? (c.author ? authorHash(companyId, c.author) : null) }, RAW_ALLOW_LIST.commit);
}

export function minimisedDeploymentPayload(companyId: string, events: DeploymentEvent[]): Buffer {
  return json({
    minimised: true, kind: 'deployments',
    deployments: events.map((e) => keep({
      id: e.id, team: e.team, environment: e.environment, production: e.production, service: e.service, commit: e.commit, commitFrom: e.commitFrom,
      startedAt: iso(e.startedAt), finishedAt: iso(e.finishedAt), result: e.result, rollbackOf: e.rollbackOf, hotfix: e.hotfix, url: e.url,
      commits: e.commits.map((c) => commitRecord(companyId, c)),
    }, RAW_ALLOW_LIST.deployment)),
  });
}

export function minimisedCommitPayload(companyId: string, batches: CommitBatch[]): Buffer {
  return json({
    minimised: true, kind: 'commits',
    batches: batches.map((b) => keep({ team: b.team, service: b.service, deployment: b.deployment, branch: b.branch, commits: b.commits.map((c) => commitRecord(companyId, c)) }, RAW_ALLOW_LIST.commitBatch)),
  });
}
