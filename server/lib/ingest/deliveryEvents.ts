/**
 * Delivery and reliability events (v2 phase 2): validation and normalisation of the JSON bodies of
 *
 *   POST /api/ingest/deployments   QE Navigator's JSON shape, GitHub deployment_status and GitLab
 *                                  deployment webhooks
 *   POST /api/ingest/commits       QE Navigator's JSON shape (git log), GitHub and GitLab push webhooks
 *   POST /api/ingest/incidents     QE Navigator's JSON shape, PagerDuty (v3 webhook, REST incidents
 *                                  export), Opsgenie (alert webhook, alerts export)
 *
 * Every body is an event, an array of events, or {deployments | commits | incidents | events: [...]};
 * at most MAX_EVENTS per request. Times are ISO 8601 (or epoch milliseconds). Computed values
 * (a change failure rate, an MTTR, …) are refused: QE Navigator calculates them from the events.
 * Author names and e-mail addresses are never kept: authorHash() turns them into a salted hash.
 */
import { createHash } from 'crypto';
import { ReportError } from './testReports';

export const MAX_EVENTS = 500;

export type DeliveryKind = 'deployments' | 'commits' | 'incidents';
export type DeployResult = 'success' | 'failure' | 'rolled_back';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';

export const DEPLOYMENT_FORMATS = ['json', 'github', 'gitlab'] as const;
export const COMMIT_FORMATS = ['json', 'github', 'gitlab'] as const;
export const INCIDENT_FORMATS = ['json', 'pagerduty', 'opsgenie'] as const;
export const FORMATS: Record<DeliveryKind, readonly string[]> = { deployments: DEPLOYMENT_FORMATS, commits: COMMIT_FORMATS, incidents: INCIDENT_FORMATS };

export interface CommitEvent {
  sha: string;
  authoredAt: Date | null;
  committedAt: Date | null;
  /** Salted hash of the author (or the authorHash sent); never the name or e-mail address. */
  authorHash: string | null;
  /** Raw author identity to hash (e-mail or name); dropped once hashed. */
  author?: string | null;
}

export interface DeploymentEvent {
  id: string;
  team: string | null;
  environment: string;
  production: boolean;
  service: string | null;
  commit: string;
  commits: CommitEvent[];
  commitFrom: string | null;
  startedAt: Date | null;
  finishedAt: Date;
  result: DeployResult;
  rollbackOf: string | null;
  hotfix: boolean;
  url: string | null;
}

export interface CommitBatch {
  team: string | null;
  service: string | null;
  deployment: string | null;
  branch: string | null;
  commits: CommitEvent[];
}

export interface IncidentEvent {
  id: string;
  team: string | null;
  title: string | null;
  severity: Severity | null;
  severityLabel: string | null;
  service: string | null;
  status: IncidentStatus | null;
  openedAt: Date | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  /** The time of this status update (defaults to the newest time given). */
  at: Date | null;
  deployment: string | null;
  outage: boolean | null;
  category: string | null;
  url: string | null;
  source: string;
  /** The responder as sent (e-mail, id or name) or its hash: only the salted hash reaches raw_uploads (minimiseStore.ts). */
  people?: Record<string, string | null>;
}

/** Names of computed values: refused on the raw endpoints (QE Navigator calculates them). */
const COMPUTED_KEYS = /^(deployment_?frequency(_per_week)?|deploys_?per_?week|lead_?time(_days|_hours)?|change_?failure_?rate|cfr|mttr(_hours)?|mtbf(_hours)?|mean_?time_?(to|between)_\w+|(system_)?availability|uptime(_percent)?|incidents_?per_?deploy|failure_?rate|success_?rate)$/i;

export function rejectComputed(obj: unknown, where: string): void {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const k of Object.keys(obj as object)) {
    if (COMPUTED_KEYS.test(k)) {
      throw new ReportError(`${where}${where ? '.' : ''}${k}: QE Navigator calculates this from the raw events; send the events (times, results, links) instead of a computed value`);
    }
  }
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : null;

export function time(v: unknown, field: string, required = false): Date | null {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ReportError(`${field} is required (ISO 8601)`);
    return null;
  }
  const d = new Date(typeof v === 'number' ? v : /^\d{12,14}$/.test(String(v)) ? Number(v) : String(v));
  if (Number.isNaN(d.getTime())) throw new ReportError(`${field} must be an ISO 8601 timestamp`);
  return d;
}

function bool(v: unknown, field: string): boolean | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (['true', '1', 'yes'].includes(s)) return true;
  if (['false', '0', 'no'].includes(s)) return false;
  throw new ReportError(`${field} must be true or false`);
}

const SHA_RE = /^[0-9a-zA-Z._\-/]{4,80}$/;
function sha(v: unknown, field: string, required: boolean): string | null {
  const s = str(v, 200);
  if (!s) {
    if (required) throw new ReportError(`${field} is required (the commit sha)`);
    return null;
  }
  if (!SHA_RE.test(s)) throw new ReportError(`${field} must be a commit sha (4 to 80 letters, digits, ".", "_", "-", "/")`);
  return s;
}

/** Production environments: production, prod, prd, live (also e.g. "production-eu"), or production: true. */
export const isProductionEnvironment = (env: string) => /^(prod|production|prd|live)([-_ ./].*)?$/i.test(env.trim());

const RESULT: Record<string, DeployResult> = {
  success: 'success', succeeded: 'success', successful: 'success', passed: 'success', ok: 'success', deployed: 'success', completed: 'success',
  // Jenkins UNSTABLE and Azure DevOps SucceededWithIssues / PartiallySucceeded: the deploy reached the environment.
  unstable: 'success', succeededwithissues: 'success', partiallysucceeded: 'success', partially_succeeded: 'success',
  not_built: 'failure', notbuilt: 'failure',
  failure: 'failure', failed: 'failure', error: 'failure', errored: 'failure', timed_out: 'failure', cancelled: 'failure', canceled: 'failure', aborted: 'failure',
  rolled_back: 'rolled_back', rolledback: 'rolled_back', 'rolled-back': 'rolled_back', rollback: 'rolled_back', reverted: 'rolled_back',
};

export function deployResult(v: unknown, field: string): DeployResult {
  const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/ /g, '_') : '';
  const r = RESULT[s];
  if (!r) throw new ReportError(`${field} must be success, failure or rolled_back (also: succeeded, failed, error, cancelled, reverted)`);
  return r;
}

/** SEV1 / P1 / critical → critical, SEV2 / P2 / high / major → high, SEV3 / P3 / medium → medium, SEV4 / P4 / low / minor → low, SEV5 / P5 / info → info. */
export function normaliseSeverity(v: unknown): Severity | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim().toLowerCase().replace(/[\s_-]/g, '');
  const m = /^(?:sev|severity|p|priority)?([0-5])$/.exec(s);
  if (m) return (['critical', 'critical', 'high', 'medium', 'low', 'info'] as Severity[])[Number(m[1])];
  if (['critical', 'crit', 'blocker', 'emergency', 'disaster', 'fatal'].includes(s)) return 'critical';
  if (['high', 'major', 'error', 'urgent'].includes(s)) return 'high';
  if (['medium', 'moderate', 'average', 'warning', 'normal'].includes(s)) return 'medium';
  if (['low', 'minor'].includes(s)) return 'low';
  if (['info', 'informational', 'information', 'trivial', 'none'].includes(s)) return 'info';
  return null;
}

export function normaliseIncidentStatus(v: unknown): IncidentStatus | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim().toLowerCase().replace(/^incident\./, '');
  if (['open', 'opened', 'triggered', 'trigger', 'new', 'create', 'created', 'firing', 'investigating', 'reopened', 'reopen', 'unacknowledged', 'unacknowledge', 'escalated'].includes(s)) return 'open';
  if (['acknowledged', 'acknowledge', 'ack', 'acked', 'identified', 'mitigating', 'monitoring', 'in_progress'].includes(s)) return 'acknowledged';
  if (['resolved', 'resolve', 'closed', 'close', 'fixed', 'mitigated', 'done', 'recovered'].includes(s)) return 'resolved';
  return null;
}

/** A salted hash of an author identity (e-mail or name), per company: never reversible to a person. */
export function authorHash(companyId: string, identity: string): string {
  return createHash('sha256').update(`${companyId}:${identity.trim().toLowerCase()}`).digest('hex').slice(0, 32);
}

function list(body: unknown, keys: string[], what: string): unknown[] {
  let items: unknown[];
  if (Array.isArray(body)) items = body;
  else if (body && typeof body === 'object') {
    const k = keys.find((x) => Array.isArray((body as any)[x]));
    items = k ? (body as any)[k] : [body];
  } else throw new ReportError(`Send a JSON ${what}, an array of them, or {"${keys[0]}": [...]}`);
  if (items.length === 0) throw new ReportError(`Send between 1 and ${MAX_EVENTS} ${what}s`);
  if (items.length > MAX_EVENTS) throw new ReportError(`Too many ${what}s in one request: at most ${MAX_EVENTS} (send several requests)`);
  return items;
}

// ---------------------------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------------------------

function commitOf(raw: any, at: string): CommitEvent {
  if (typeof raw === 'string') return { sha: sha(raw, at, true)!, authoredAt: null, committedAt: null, authorHash: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ReportError(`${at} must be a commit sha or an object`);
  rejectComputed(raw, at);
  const s = sha(raw.sha ?? raw.id ?? raw.hash, `${at}.sha`, true)!;
  const authoredAt = time(raw.authoredAt ?? raw.authored_at ?? raw.authorDate ?? raw.author?.date ?? raw.timestamp, `${at}.authoredAt`);
  const committedAt = time(raw.committedAt ?? raw.committed_at ?? raw.commitDate ?? raw.committer?.date, `${at}.committedAt`);
  const givenHash = str(raw.authorHash, 64);
  if (givenHash && !/^[0-9a-f]{8,64}$/i.test(givenHash)) throw new ReportError(`${at}.authorHash must be a hex hash (8 to 64 characters)`);
  const author = givenHash ? null : str(raw.authorEmail ?? raw.author_email ?? (typeof raw.author === 'object' ? raw.author?.email ?? raw.author?.username ?? raw.author?.name : raw.author), 320);
  return { sha: s, authoredAt: authoredAt ?? committedAt, committedAt, authorHash: givenHash ? givenHash.toLowerCase() : null, author };
}

export function detectCommitFormat(body: any): 'json' | 'github' | 'gitlab' {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (body.object_kind === 'push' || body.object_kind === 'tag_push') return 'gitlab';
    if (typeof body.ref === 'string' && Array.isArray(body.commits) && (body.repository || body.head_commit !== undefined || body.pusher)) return 'github';
  }
  return 'json';
}

/** Commits body → one or more batches (a batch: the commits of one deployment or push). */
export function parseCommitBody(body: unknown, format: string, defaults: { team?: string | null; deployment?: string | null; service?: string | null } = {}): CommitBatch[] {
  rejectComputed(body, '');
  if (format === 'github' || format === 'gitlab') {
    const b = body as any;
    const commits = Array.isArray(b.commits) ? b.commits : [];
    if (!commits.length) throw new ReportError('The push has no commits');
    if (commits.length > MAX_EVENTS) throw new ReportError(`Too many commits in one request: at most ${MAX_EVENTS}`);
    return [{
      team: defaults.team ?? null, deployment: defaults.deployment ?? null,
      service: defaults.service ?? str(b.repository?.name ?? b.project?.name ?? b.project?.path, 255),
      branch: str(b.ref, 255)?.replace(/^refs\/(heads|tags)\//, '') ?? null,
      commits: commits.map((c: any, i: number) => commitOf(c, `commits[${i}]`)),
    }];
  }
  // QE Navigator shape: {deployment?, team?, service?, branch?, commits: [...]}, an array of such batches, or an array of commits.
  const b = body as any;
  const batches: any[] = Array.isArray(b)
    ? (b.length && b.every((x: any) => x && typeof x === 'object' && Array.isArray(x.commits)) ? b : [{ commits: b }])
    : Array.isArray(b?.batches) ? b.batches : [b];
  let total = 0;
  const out = batches.map((x: any, bi: number): CommitBatch => {
    const at = batches.length > 1 ? `batches[${bi}]` : '';
    if (!x || typeof x !== 'object') throw new ReportError(`${at || 'body'} must be an object`);
    rejectComputed(x, at);
    const items = list(x.commits ?? (x.sha ? [x] : undefined), ['commits'], 'commit');
    total += items.length;
    if (total > MAX_EVENTS) throw new ReportError(`Too many commits in one request: at most ${MAX_EVENTS} (send several requests with the same deployment)`);
    return {
      team: str(x.team ?? x.teamId, 36) ?? defaults.team ?? null,
      deployment: str(x.deployment ?? x.deploymentId ?? x.deployment_id, 200) ?? defaults.deployment ?? null,
      service: str(x.service, 255) ?? defaults.service ?? null,
      branch: str(x.branch ?? x.ref, 255)?.replace(/^refs\/heads\//, '') ?? null,
      commits: items.map((c, i) => commitOf(c, `${at ? `${at}.` : ''}commits[${i}]`)),
    };
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Deployments
// ---------------------------------------------------------------------------------------------

export function detectDeploymentFormat(body: any): 'json' | 'github' | 'gitlab' {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (body.deployment_status && body.deployment) return 'github';
    if (body.object_kind === 'deployment') return 'gitlab';
  }
  return 'json';
}

const GITHUB_FINAL: Record<string, DeployResult> = { success: 'success', failure: 'failure', error: 'failure' };
const GITLAB_FINAL: Record<string, DeployResult> = { success: 'success', failed: 'failure', canceled: 'failure' };

export interface ParsedDeployments { events: DeploymentEvent[]; ignored: Array<{ id: string | null; reason: string }> }

export function normaliseDeployment(raw: any, at: string, defaults: { team?: string | null; service?: string | null; environment?: string | null }): DeploymentEvent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ReportError(`${at} must be an object`);
  rejectComputed(raw, at);
  const f = (x: string) => `${at}.${x}`;
  const id = str(raw.id ?? raw.deploymentId ?? raw.deployment_id, 200);
  if (!id) throw new ReportError(`${f('id')} is required (the deployment's id in your tool)`);
  const environment = str(raw.environment ?? raw.env ?? defaults.environment, 100);
  if (!environment) throw new ReportError(`${f('environment')} is required (e.g. production, staging)`);
  const prodFlag = bool(raw.production ?? raw.isProduction, f('production'));
  const startedAt = time(raw.startedAt ?? raw.started_at ?? raw.start, f('startedAt'));
  const finishedAt = time(raw.finishedAt ?? raw.finished_at ?? raw.end ?? raw.deployedAt, f('finishedAt'), true)!;
  if (startedAt && finishedAt.getTime() < startedAt.getTime()) throw new ReportError(`${f('finishedAt')} is before startedAt`);
  const result = deployResult(raw.result ?? raw.status ?? raw.conclusion, f('result'));
  const commitsRaw = raw.commits ?? [];
  if (!Array.isArray(commitsRaw)) throw new ReportError(`${f('commits')} must be an array of shas or commit objects`);
  if (commitsRaw.length > 5000) throw new ReportError(`${f('commits')}: at most 5000 commits per deployment`);
  const commits = commitsRaw.map((c: any, i: number) => commitOf(c, `${f('commits')}[${i}]`));
  const range = raw.commitRange ?? raw.commit_range;
  let commitFrom: string | null = null;
  let head = sha(raw.commit ?? raw.sha ?? raw.headCommit, f('commit'), false);
  if (range !== undefined && range !== null) {
    if (typeof range === 'string' && range.includes('..')) {
      const [a, b] = range.split(/\.{2,3}/);
      commitFrom = sha(a, `${f('commitRange')} (from)`, true);
      head = head ?? sha(b, `${f('commitRange')} (to)`, true);
    } else if (typeof range === 'object') {
      commitFrom = sha(range.from ?? range.base, `${f('commitRange')}.from`, true);
      head = head ?? sha(range.to ?? range.head, `${f('commitRange')}.to`, true);
    } else throw new ReportError(`${f('commitRange')} must be "from..to" or {"from": …, "to": …}`);
  }
  commitFrom = commitFrom ?? sha(raw.previousCommit ?? raw.previous_commit, f('previousCommit'), false);
  if (!head && !commits.length) throw new ReportError(`${f('commit')} is required (the deployed commit sha, or a commits list)`);
  return {
    id, team: str(raw.team ?? raw.teamId, 36) ?? defaults.team ?? null, environment,
    production: prodFlag ?? isProductionEnvironment(environment),
    service: str(raw.service ?? raw.application ?? raw.app, 255) ?? defaults.service ?? null,
    commit: head ?? commits[commits.length - 1].sha, commits, commitFrom, startedAt, finishedAt, result,
    rollbackOf: str(raw.rollbackOf ?? raw.rollback_of ?? raw.rollbackOfDeploymentId, 200),
    hotfix: bool(raw.hotfix ?? raw.isHotfix, f('hotfix')) ?? false,
    url: str(raw.url, 1000),
  };
}

export function parseDeploymentBody(body: unknown, format: string, defaults: { team?: string | null; service?: string | null; environment?: string | null } = {}): ParsedDeployments {
  rejectComputed(body, '');
  const b = body as any;
  if (format === 'github') {
    const ds = b.deployment_status ?? {};
    const d = b.deployment ?? {};
    const state = String(ds.state ?? '').toLowerCase();
    const id = str(d.id, 200);
    if (!GITHUB_FINAL[state]) return { events: [], ignored: [{ id, reason: `deployment status "${state || 'unknown'}" is not final (success, failure or error are recorded)` }] };
    const payload = typeof d.payload === 'object' && d.payload ? d.payload : {};
    return {
      events: [normaliseDeployment({
        id, environment: ds.environment ?? d.environment, commit: d.sha, startedAt: d.created_at, finishedAt: ds.created_at ?? ds.updated_at,
        result: GITHUB_FINAL[state], url: ds.target_url ?? ds.log_url ?? null, service: payload.service ?? b.repository?.name,
        hotfix: payload.hotfix ?? (/^hotfix\//i.test(String(d.ref ?? '')) || undefined), rollbackOf: payload.rollbackOf, production: d.production_environment,
        team: payload.team,
      }, 'deployment', defaults)],
      ignored: [],
    };
  }
  if (format === 'gitlab') {
    const status = String(b.status ?? '').toLowerCase();
    const id = str(b.deployment_id ?? b.deployable_id, 200);
    if (!GITLAB_FINAL[status]) return { events: [], ignored: [{ id, reason: `deployment status "${status || 'unknown'}" is not final (success, failed or canceled are recorded)` }] };
    return {
      events: [normaliseDeployment({
        id, environment: b.environment, commit: b.short_sha && !b.sha ? b.short_sha : b.sha, finishedAt: b.status_changed_at, result: GITLAB_FINAL[status],
        url: b.deployable_url ?? null, service: b.project?.name ?? b.project?.path_with_namespace,
        hotfix: /^hotfix\//i.test(String(b.ref ?? '')) || undefined,
      }, 'deployment', defaults)],
      ignored: [],
    };
  }
  const items = list(b, ['deployments', 'events'], 'deployment');
  const shared = Array.isArray(b) ? {} : b;
  const d2 = { ...defaults, team: str(shared.team ?? shared.teamId, 36) ?? defaults.team ?? null };
  return { events: items.map((x, i) => normaliseDeployment(x, items.length > 1 || Array.isArray(b) || Array.isArray(b?.deployments) ? `deployments[${i}]` : 'deployment', d2)), ignored: [] };
}

// ---------------------------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------------------------

export function detectIncidentFormat(body: any): 'json' | 'pagerduty' | 'opsgenie' {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    if (body.event && typeof body.event === 'object' && /^incident\./.test(String(body.event.event_type ?? ''))) return 'pagerduty';
    if (Array.isArray(body.incidents) && body.incidents.some((i: any) => i && (i.incident_number !== undefined || i.type === 'incident' || i.urgency !== undefined))) return 'pagerduty';
    if (Array.isArray(body.messages) && body.messages.some((m: any) => m?.incident)) return 'pagerduty';
    if (body.alert && typeof body.alert === 'object' && (body.action !== undefined || body.alert.alertId !== undefined)) return 'opsgenie';
    if (Array.isArray(body.data) && body.data.some((a: any) => a && a.tinyId !== undefined)) return 'opsgenie';
  }
  return 'json';
}

export function normaliseIncident(raw: any, at: string, defaults: { team?: string | null; service?: string | null; source?: string }): IncidentEvent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ReportError(`${at} must be an object`);
  rejectComputed(raw, at);
  const f = (x: string) => `${at}.${x}`;
  const id = str(raw.id ?? raw.incidentId ?? raw.incident_id, 200);
  if (!id) throw new ReportError(`${f('id')} is required (the incident's id in your tool)`);
  const severityLabel = str(raw.severity ?? raw.priority ?? raw.sev, 50);
  const severity = normaliseSeverity(severityLabel);
  if (severityLabel && !severity) throw new ReportError(`${f('severity')} "${severityLabel}" is not understood: use critical, high, medium, low, info (or SEV1–SEV5, P1–P5)`);
  const status = normaliseIncidentStatus(raw.status ?? raw.state);
  if ((raw.status ?? raw.state) && !status) throw new ReportError(`${f('status')} must be open, acknowledged or resolved (also: triggered, closed, …)`);
  const openedAt = time(raw.openedAt ?? raw.opened_at ?? raw.createdAt ?? raw.created_at ?? raw.startedAt ?? raw.started_at, f('openedAt'));
  const acknowledgedAt = time(raw.acknowledgedAt ?? raw.acknowledged_at, f('acknowledgedAt'));
  const resolvedAt = time(raw.resolvedAt ?? raw.resolved_at ?? raw.closedAt ?? raw.closed_at, f('resolvedAt'));
  const updAt = time(raw.at ?? raw.updatedAt ?? raw.updated_at ?? raw.occurredAt, f('at'));
  if (openedAt && resolvedAt && resolvedAt.getTime() < openedAt.getTime()) throw new ReportError(`${f('resolvedAt')} is before openedAt`);
  if (openedAt && acknowledgedAt && acknowledgedAt.getTime() < openedAt.getTime()) throw new ReportError(`${f('acknowledgedAt')} is before openedAt`);
  const updates = raw.updates ?? raw.statusUpdates;
  let ack = acknowledgedAt;
  let res = resolvedAt;
  let st = status;
  let last = updAt;
  if (updates !== undefined) {
    if (!Array.isArray(updates)) throw new ReportError(`${f('updates')} must be an array of {status, at}`);
    if (updates.length > 1000) throw new ReportError(`${f('updates')}: at most 1000 status updates`);
    const sorted = updates.map((u: any, i: number) => {
      const s = normaliseIncidentStatus(u?.status);
      if (!s) throw new ReportError(`${f('updates')}[${i}].status must be open, acknowledged or resolved`);
      return { s, t: time(u?.at ?? u?.time, `${f('updates')}[${i}].at`, true)! };
    }).sort((a: any, b: any) => a.t.getTime() - b.t.getTime());
    for (const u of sorted) {
      if (u.s === 'acknowledged' && !ack) ack = u.t;
      if (u.s === 'resolved') res = u.t;
      if (u.s === 'open' && res && u.t > res) res = null;
      st = u.s;
      last = u.t;
    }
    if (status) st = status;
  }
  // openedAt may be left out by an update of a known incident (checked when it is stored).
  return {
    id, team: str(raw.team ?? raw.teamId, 36) ?? defaults.team ?? null, title: str(raw.title ?? raw.summary ?? raw.name, 500),
    severity, severityLabel, service: str(raw.service ?? raw.serviceName, 255) ?? defaults.service ?? null,
    status: st, openedAt, acknowledgedAt: ack, resolvedAt: res, at: last,
    deployment: str(raw.deploymentId ?? raw.deployment_id ?? raw.deployment ?? raw.linkedDeployment, 200),
    outage: bool(raw.outage ?? raw.isOutage, f('outage')), category: str(raw.category ?? raw.kind ?? raw.type, 50)?.toLowerCase() ?? null,
    url: str(raw.url ?? raw.html_url, 1000), source: defaults.source ?? 'json',
    people: responderOf(raw),
  };
}

function responderOf(raw: any): Record<string, string | null> | undefined {
  const h = typeof raw.responderHash === 'string' && /^[0-9a-f]{8,64}$/i.test(raw.responderHash) ? raw.responderHash.toLowerCase() : null;
  if (h) return { responderHash: h };
  const v = raw.responder ?? raw.assignee ?? raw.owner;
  const id = typeof v === 'string' ? v.trim() : v && typeof v === 'object' ? (v.email ?? v.emailAddress ?? v.id ?? v.summary ?? v.name ?? null) : null;
  return typeof id === 'string' && id.trim() ? { responder: id.trim().slice(0, 320) } : undefined;
}

const PD_EVENT: Record<string, IncidentStatus> = {
  'incident.triggered': 'open', 'incident.reopened': 'open', 'incident.unacknowledged': 'open', 'incident.escalated': 'open',
  'incident.acknowledged': 'acknowledged', 'incident.resolved': 'resolved',
};

function pdIncident(i: any, at: string, defaults: { team?: string | null; service?: string | null }, event?: { type: string; occurredAt: unknown }) {
  const st = event ? PD_EVENT[event.type] ?? normaliseIncidentStatus(i.status) : normaliseIncidentStatus(i.status);
  const occurred = event?.occurredAt ?? i.last_status_change_at ?? null;
  const resolved = i.resolved_at ?? (st === 'resolved' ? occurred : null);
  const acked = Array.isArray(i.acknowledgements) && i.acknowledgements[0]?.at ? i.acknowledgements[0].at : st === 'acknowledged' ? occurred : null;
  const priority = i.priority?.summary ?? i.priority?.name ?? null;
  return normaliseIncident({
    id: i.id, title: i.title ?? i.summary, severity: priority ?? (i.urgency === 'high' ? 'high' : i.urgency === 'low' ? 'low' : null),
    service: i.service?.summary ?? i.service?.name, status: st, openedAt: i.created_at, acknowledgedAt: acked, resolvedAt: resolved,
    at: occurred, url: i.html_url, deploymentId: i.custom_fields?.deployment_id ?? i.metadata?.deployment_id,
    responder: i.assignments?.[0]?.assignee ?? i.last_status_change_by ?? null,
  }, at, { ...defaults, source: 'pagerduty' });
}

const OG_ACTION: Record<string, IncidentStatus> = { create: 'open', acknowledge: 'acknowledged', unacknowledge: 'open', close: 'resolved', escalate: 'open' };

function ogService(a: any, fallback: string | null | undefined): string | null {
  const tag = Array.isArray(a.tags) ? a.tags.find((t: unknown) => typeof t === 'string' && /^service[:=]/i.test(t)) : null;
  return str(a.details?.service ?? (tag ? String(tag).split(/[:=]/)[1] : null) ?? a.entity, 255) ?? fallback ?? null;
}

export function parseIncidentBody(body: unknown, format: string, defaults: { team?: string | null; service?: string | null } = {}): IncidentEvent[] {
  rejectComputed(body, '');
  const b = body as any;
  if (format === 'pagerduty') {
    if (b?.event && typeof b.event === 'object') {
      const e = b.event;
      if (!PD_EVENT[e.event_type] && e.event_type !== 'incident.priority_updated' && e.event_type !== 'incident.annotated') {
        throw new ReportError(`PagerDuty event "${e.event_type}" is not an incident status event (triggered, acknowledged, resolved, reopened)`);
      }
      return [pdIncident(e.data ?? {}, 'event.data', defaults, { type: e.event_type, occurredAt: e.occurred_at })];
    }
    const items = list(Array.isArray(b?.messages) ? b.messages.map((m: any) => m.incident) : b?.incidents, ['incidents'], 'incident');
    return items.map((i, n) => pdIncident(i, `incidents[${n}]`, defaults));
  }
  if (format === 'opsgenie') {
    if (b?.alert && typeof b.alert === 'object') {
      const a = b.alert;
      const action = String(b.action ?? '').toLowerCase();
      const st = OG_ACTION[action] ?? normaliseIncidentStatus(a.status);
      const occurred = a.updatedAt ?? Date.now();
      return [normaliseIncident({
        id: a.alertId ?? a.id, title: a.message, severity: a.priority, service: ogService(a, defaults.service), status: st,
        openedAt: a.createdAt, acknowledgedAt: st === 'acknowledged' ? occurred : null, resolvedAt: st === 'resolved' ? occurred : null, at: occurred,
        deploymentId: a.details?.deploymentId ?? a.details?.deployment_id,
      }, 'alert', { ...defaults, source: 'opsgenie' })];
    }
    const items = list(b?.data, ['data'], 'alert');
    return items.map((a: any, n) => {
      const created = a?.createdAt ? new Date(a.createdAt).getTime() : NaN;
      const ack = a?.report?.ackTime ? created + Number(a.report.ackTime) : null;
      const close = a?.report?.closeTime ? created + Number(a.report.closeTime) : null;
      return normaliseIncident({
        id: a?.id, title: a?.message, severity: a?.priority, service: ogService(a ?? {}, defaults.service),
        status: a?.status === 'closed' ? 'resolved' : a?.acknowledged ? 'acknowledged' : 'open',
        openedAt: a?.createdAt, acknowledgedAt: ack, resolvedAt: close ?? (a?.status === 'closed' ? a?.updatedAt : null),
      }, `data[${n}]`, { ...defaults, source: 'opsgenie' });
    });
  }
  const items = list(b, ['incidents', 'events'], 'incident');
  const shared = Array.isArray(b) ? {} : b;
  const d2 = { ...defaults, team: str(shared.team ?? shared.teamId, 36) ?? defaults.team ?? null, source: 'json' };
  return items.map((x, i) => normaliseIncident(x, items.length > 1 || Array.isArray(b) || Array.isArray(b?.incidents) ? `incidents[${i}]` : 'incident', d2));
}

/** Severity critical or high counts as an outage unless the event says otherwise. */
export const isOutage = (severity: Severity | null | undefined, outage: boolean | null | undefined) =>
  outage ?? (severity === 'critical' || severity === 'high');
