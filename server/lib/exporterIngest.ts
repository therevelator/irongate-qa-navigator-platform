/**
 * The QE Navigator Exporter's JSON envelope (POST /api/ingest/exporter/batch) and heartbeat
 * (POST /api/ingest/exporter/heartbeat).
 *
 * The Exporter runs inside the customer's network, reads their tools and sends the RAW data: test report and
 * coverage files as text, SARIF, pipeline runs, deployments, commits, incidents and issues. It calculates nothing:
 * every value is calculated here, by the same parsers, raw store and calculation as the other ingestion endpoints.
 *
 * Envelope: { companyId, departmentId, teamId, source, kind, items: [...] }. This file validates the envelope's
 * shape and turns its items into the requests ("submissions") that the existing ingestion handlers take, so the
 * parsing, the field allow-list, the storage and the calculation are the ones of those handlers (no second copy).
 * The ids are checked against the API key in server/routes/ingestExporter.ts.
 */
import { createHash } from 'crypto';

export class EnvelopeError extends Error {
  constructor(public status: number, message: string, public details: string[] = []) { super(message); }
}

/** The envelope kinds and the ingestion handler each one goes through. */
export const EXPORTER_KINDS = ['test-report', 'coverage', 'pipeline-runs', 'deployments', 'commits', 'incidents', 'issues', 'sarif', 'kpis',
  'performance', 'test-management', 'pull-requests', 'calendar'] as const;
export type ExporterKind = (typeof EXPORTER_KINDS)[number];
export type HandlerKind = 'tests' | 'coverage' | 'pipelines' | 'deployments' | 'commits' | 'incidents' | 'issues' | 'static-analysis' | 'kpis'
  | 'performance' | 'test-management' | 'pull-requests' | 'calendar';
export const HANDLER_OF: Record<ExporterKind, HandlerKind> = {
  'test-report': 'tests', coverage: 'coverage', 'pipeline-runs': 'pipelines', deployments: 'deployments', commits: 'commits',
  incidents: 'incidents', issues: 'issues', sarif: 'static-analysis', kpis: 'kpis',
  performance: 'performance', 'test-management': 'test-management', 'pull-requests': 'pull-requests', calendar: 'calendar',
};

/** Items per envelope (the limits of the handler each kind goes through). */
export const MAX_ITEMS: Record<ExporterKind, number> = {
  'test-report': 50, coverage: 50, sarif: 50, 'pipeline-runs': 100, deployments: 500, commits: 500, incidents: 500, issues: 1000, kpis: 100,
  performance: 20, 'test-management': 2000, 'pull-requests': 1000, calendar: 2000,
};
export const MAX_FILES_PER_REPORT = 50;

const ENVELOPE_FIELDS = ['companyId', 'departmentId', 'teamId', 'source', 'kind', 'items'];
const REPORT_FIELDS = ['files', 'format', 'commit', 'branch', 'run', 'attempt', 'startedAt', 'diff', 'changedLines', 'repo', 'loc'];
const ID = /^[A-Za-z0-9_.:-]{1,36}$/;

/** The item fields of each event kind: the names its parser reads, with their aliases (docs/DATA_FLOW.md 4.4–4.8). */
type EventKind = 'pipeline-runs' | 'deployments' | 'commits' | 'incidents' | 'issues';
const ITEM_FIELDS: Record<EventKind, string[]> = {
  'pipeline-runs': ['id', 'runId', 'run', 'attempt', 'name', 'workflow', 'pipeline', 'commit', 'sha', 'branch', 'ref', 'startedAt', 'start', 'finishedAt', 'end',
    'durationSeconds', 'duration', 'result', 'status', 'conclusion', 'url', 'stages', 'jobs'],
  deployments: ['id', 'deploymentId', 'deployment_id', 'team', 'teamId', 'environment', 'env', 'production', 'isProduction', 'service', 'application', 'app',
    'commit', 'sha', 'headCommit', 'previousCommit', 'previous_commit', 'commitRange', 'commit_range', 'commits', 'startedAt', 'started_at', 'start',
    'finishedAt', 'finished_at', 'end', 'deployedAt', 'result', 'status', 'conclusion', 'rollbackOf', 'rollback_of', 'rollbackOfDeploymentId', 'hotfix', 'isHotfix', 'url'],
  commits: ['deployment', 'deploymentId', 'deployment_id', 'team', 'teamId', 'service', 'branch', 'ref', 'commits',
    // a single commit as an item
    'sha', 'id', 'hash', 'authoredAt', 'authored_at', 'authorDate', 'author', 'timestamp', 'committedAt', 'committed_at', 'commitDate', 'committer', 'authorHash', 'authorEmail', 'author_email'],
  incidents: ['id', 'incidentId', 'incident_id', 'team', 'teamId', 'title', 'summary', 'name', 'severity', 'priority', 'sev', 'service', 'serviceName', 'status', 'state',
    'openedAt', 'opened_at', 'createdAt', 'created_at', 'startedAt', 'started_at', 'acknowledgedAt', 'acknowledged_at', 'resolvedAt', 'resolved_at', 'closedAt', 'closed_at',
    'at', 'updatedAt', 'updated_at', 'occurredAt', 'updates', 'statusUpdates', 'deploymentId', 'deployment_id', 'deployment', 'linkedDeployment', 'outage', 'isOutage',
    'category', 'kind', 'type', 'url', 'html_url', 'responder', 'responderHash', 'assignee', 'owner'],
  issues: ['key', 'id', 'team', 'teamId', 'project', 'title', 'summary', 'type', 'issueType', 'status', 'statusCategory', 'resolution', 'priority', 'environment', 'foundIn',
    'storyPoints', 'story_points', 'points', 'estimateHours', 'estimateSeconds', 'timeLoggedHours', 'timeSpentHours', 'timeSpentSeconds', 'sprints', 'sprint', 'labels',
    'components', 'createdAt', 'created', 'resolvedAt', 'resolved', 'updatedAt', 'updated', 'url', 'transitions', 'blocked', 'assignee', 'reporter', 'assigneeHash', 'reporterHash'],
};
const STAGE_FIELDS = ['name', 'kind', 'parallelGroup', 'group', 'startedAt', 'start', 'finishedAt', 'end', 'durationSeconds', 'duration', 'result', 'status', 'conclusion'];
const SOURCE = /^[a-z0-9][a-z0-9_-]{0,49}$/;

export interface Envelope { companyId: string; departmentId: string; teamId: string; source: string; kind: ExporterKind; items: unknown[] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Shape check of the envelope (not the ids against the key: the route does that). Missing ids: 400. */
export function parseEnvelope(body: unknown): Envelope {
  if (!isObj(body)) throw new EnvelopeError(400, 'The body must be a JSON object: { companyId, departmentId, teamId, source, kind, items }');
  const extra = Object.keys(body).filter((k) => !ENVELOPE_FIELDS.includes(k));
  if (extra.length) throw new EnvelopeError(400, `Unexpected field(s): ${extra.slice(0, 5).join(', ')} (allowed: ${ENVELOPE_FIELDS.join(', ')})`);
  for (const f of ['companyId', 'departmentId', 'teamId'] as const) {
    const v = body[f];
    if (v === undefined || v === null || v === '') throw new EnvelopeError(400, `${f} is required (the ids are on Admin console → Connect your CI, and GET /api/ingest/exporter/context)`);
    if (typeof v !== 'string' || !ID.test(v)) throw new EnvelopeError(400, `${f} must be an id (letters, digits, "_", "-", ".", ":"; at most 36 characters)`);
  }
  if (typeof body.source !== 'string' || !SOURCE.test(body.source)) throw new EnvelopeError(400, 'source is required: the name of the Exporter source (lowercase letters, digits, "-" or "_", at most 50)');
  if (typeof body.kind !== 'string' || !(EXPORTER_KINDS as readonly string[]).includes(body.kind)) {
    throw new EnvelopeError(400, `kind must be one of ${EXPORTER_KINDS.join(', ')}`);
  }
  const kind = body.kind as ExporterKind;
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_ITEMS[kind]) {
    throw new EnvelopeError(400, `items must list 1 to ${MAX_ITEMS[kind]} ${kind} items`);
  }
  return { companyId: body.companyId as string, departmentId: body.departmentId as string, teamId: body.teamId as string, source: body.source, kind, items: body.items };
}

/** One request to an existing ingestion handler. */
export interface Submission { handler: HandlerKind; index: number | null; body: Buffer; contentType: string; query: Record<string, string> }

const str = (v: unknown, field: string, max: number): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' && typeof v !== 'number') throw new EnvelopeError(400, `${field} must be a string`);
  const s = String(v);
  if (s.length > max) throw new EnvelopeError(400, `${field} must be at most ${max} characters`);
  return s;
};

function multipart(files: Array<{ name: string; content: string }>, fields: Record<string, string>): { body: Buffer; type: string } {
  const b = `----qe-exporter-${createHash('sha256').update(files.map((f) => f.name).join('|')).digest('hex').slice(0, 24)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of files) {
    parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="report"; filename="${f.name.replace(/["\r\n]/g, '_')}"\r\nContent-Type: application/octet-stream\r\n\r\n`), Buffer.from(f.content, 'utf8'), Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${b}` };
}

/**
 * The submissions of an envelope. Report kinds: one per item (one CI run's report files, merged into one run by the
 * handler). Event kinds: one for the whole list. The team is always the envelope's (query parameter team); no
 * service or project-key mapping is used.
 */
export function submissionsOf(env: Envelope): Submission[] {
  const handler = HANDLER_OF[env.kind];
  const team = env.teamId;
  if (env.kind === 'test-report' || env.kind === 'coverage' || env.kind === 'sarif') {
    return env.items.map((raw, index) => {
      const at = `items[${index}]`;
      if (!isObj(raw)) throw new EnvelopeError(400, `${at} must be an object`);
      const extra = Object.keys(raw).filter((k) => !REPORT_FIELDS.includes(k));
      if (extra.length) throw new EnvelopeError(400, `${at}: unexpected field(s) ${extra.slice(0, 5).join(', ')} (allowed: ${REPORT_FIELDS.join(', ')}; the team comes from the envelope)`);
      if (!Array.isArray(raw.files) || raw.files.length === 0 || raw.files.length > MAX_FILES_PER_REPORT) throw new EnvelopeError(400, `${at}.files must list 1 to ${MAX_FILES_PER_REPORT} files ({ name, content })`);
      if (env.kind === 'sarif' && raw.files.length !== 1) throw new EnvelopeError(400, `${at}.files: a sarif item holds exactly one SARIF file`);
      const files = raw.files.map((f, i) => {
        if (!isObj(f) || typeof f.content !== 'string' || !f.content.length) throw new EnvelopeError(400, `${at}.files[${i}].content must be the file's text`);
        return { name: str(f.name, `${at}.files[${i}].name`, 255) ?? `report-${i + 1}`, content: f.content };
      });
      const query: Record<string, string> = { team };
      for (const [k, max] of [['format', 40], ['commit', 80], ['branch', 255], ['run', 200], ['attempt', 10], ['startedAt', 40], ['repo', 255], ['loc', 12]] as const) {
        const v = str(raw[k], `${at}.${k}`, max);
        if (v !== undefined) query[k] = v;
      }
      // repo: every report kind (a dimension of the evidence). loc: coverage and sarif (lines of code, the denominator of
      // defect density and the code quality score); a test report has no use for it, so it is refused, not ignored.
      if (env.kind === 'test-report' && query.loc !== undefined) throw new EnvelopeError(400, `${at}.loc is not accepted on a test-report item: send the lines of code with the coverage (or sarif) item`);
      if (env.kind === 'sarif') return { handler, index, body: Buffer.from(files[0].content, 'utf8'), contentType: 'application/json', query };
      const fields: Record<string, string> = {};
      if (env.kind === 'coverage') {
        const diff = str(raw.diff, `${at}.diff`, 20 * 1024 * 1024);
        const changed = str(raw.changedLines, `${at}.changedLines`, 20 * 1024 * 1024);
        if (diff) fields.diff = diff;
        else if (changed) fields.changedLines = changed;
      } else if (raw.diff !== undefined || raw.changedLines !== undefined) throw new EnvelopeError(400, `${at}: diff and changedLines are for coverage items`);
      const mp = multipart(files, fields);
      return { handler, index, body: mp.body, contentType: mp.type, query };
    });
  }
  // KPI values that have no raw source (automation coverage, automation ROI, …): POST /api/ingest/kpis items, with
  // the envelope's team and the source "exporter.<source>"; a team inside an item is refused.
  if (env.kind === 'kpis') {
    const list = env.items.map((raw, i) => {
      if (!isObj(raw)) throw new EnvelopeError(400, `items[${i}] must be an object`);
      const extra = Object.keys(raw).filter((k) => !['recordedAt', 'metrics', 'idempotencyKey', 'sourceRef'].includes(k));
      if (extra.length) throw new EnvelopeError(400, `items[${i}]: unexpected field(s) ${extra.slice(0, 5).join(', ')} (allowed: recordedAt, metrics, idempotencyKey, sourceRef; the team comes from the envelope)`);
      return { ...raw, teamId: team, source: `exporter.${env.source}` };
    });
    return [{ handler, index: null, body: Buffer.from(JSON.stringify(list), 'utf8'), contentType: 'application/json', query: {} }];
  }
  // Load-test results, test management records, pull requests and calendar days (server/routes/ingestMore.ts): the items go
  // to the handler as one list; it checks every field of every item (an unknown field is refused there).
  if (env.kind === 'performance' || env.kind === 'test-management' || env.kind === 'pull-requests' || env.kind === 'calendar') {
    env.items.forEach((raw, i) => { if (!isObj(raw)) throw new EnvelopeError(400, `items[${i}] must be an object`); });
    return [{ handler, index: null, body: Buffer.from(JSON.stringify(env.items), 'utf8'), contentType: 'application/json', query: { team, source: env.source } }];
  }
  // Event kinds: the items go to the handler as one list, in its QE Navigator JSON format. No field is silently
  // ignored: a field the parser does not read (or an alias of one) is refused.
  for (const [i, raw] of env.items.entries()) {
    if (!isObj(raw)) throw new EnvelopeError(400, `items[${i}] must be an object`);
    const allowed = ITEM_FIELDS[env.kind as EventKind];
    const extra = Object.keys(raw).filter((k) => !allowed.includes(k));
    if (extra.length) throw new EnvelopeError(400, `items[${i}]: unknown field(s) ${extra.slice(0, 5).join(', ')}: not stored or used by QE Navigator, so not accepted (docs/DATA_FLOW.md, section 4)`);
    if (env.kind === 'pipeline-runs') {
      for (const [j, st] of (Array.isArray(raw.stages) ? raw.stages : Array.isArray(raw.jobs) ? raw.jobs : []).entries()) {
        const bad = isObj(st) ? Object.keys(st).filter((k) => !STAGE_FIELDS.includes(k)) : [];
        if (bad.length) throw new EnvelopeError(400, `items[${i}].stages[${j}]: unknown field(s) ${bad.slice(0, 5).join(', ')} (accepted: ${STAGE_FIELDS.join(', ')})`);
      }
    }
  }
  const listKey = env.kind === 'pipeline-runs' ? 'runs' : env.kind;
  // commits: the items are commit batches ({ deployment?, branch?, commits: [...] }) or commits; sent as the list itself.
  const body = Buffer.from(JSON.stringify(env.kind === 'commits' ? env.items : { [listKey]: env.items }), 'utf8');
  const query: Record<string, string> = { team, format: 'json' };
  if (env.kind === 'pipeline-runs') delete query.format;
  return [{ handler, index: null, body, contentType: 'application/json', query }];
}

/** The Idempotency-Key of one submission, derived from the batch's key (a re-sent batch replays every part). */
export const partKey = (key: string, part: number) => `exb:${createHash('sha256').update(key).digest('hex').slice(0, 40)}:${part}`;

// ---------------------------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------------------------

export class HeartbeatError extends Error {
  constructor(public errors: string[]) { super(errors[0] ?? 'Invalid heartbeat'); }
}

export interface HeartbeatBody { exporter: string; version: string; sources: Array<Record<string, unknown>>; details: Record<string, unknown> }

const SEMVER = /^\d{1,4}\.\d{1,5}\.\d{1,6}$/;
/** qe-exporter/<version>; qe-collector/<version> from releases before 0.3.0. */
const CLIENT = /^(qe-exporter|qe-collector)\/(\d{1,4}\.\d{1,5}\.\d{1,6}[0-9A-Za-z.+-]{0,20})$/;
export const SOURCE_TYPES = ['jira', 'linear', 'pagerduty', 'opsgenie', 'github', 'gitlab', 'jenkins', 'azure-devops', 'sonarqube', 'bitbucket', 'bitbucket-dc',
  'testrail', 'xray', 'zephyr', 'google-calendar', 'microsoft-365', 'kpis'];

/** Validate a heartbeat: the version, the sources with their status (no data). Fields of releases before 0.3.0 are accepted and ignored. */
export function validateHeartbeat(body: unknown): HeartbeatBody {
  const errors: string[] = [];
  if (!isObj(body)) throw new HeartbeatError(['The body must be a JSON object']);
  const b = body;
  const legacy = ['collector', 'engineVersion', 'mode', 'localEvidenceUrl', 'store'];
  const allowed = ['exporter', 'version', 'node', 'platform', 'sources', 'teams', ...legacy];
  for (const k of Object.keys(b)) if (!allowed.includes(k)) errors.push(`${k} is not an allowed field`);
  const client = b.exporter ?? b.collector;
  if (typeof client !== 'string' || !CLIENT.test(client)) errors.push('exporter must be "qe-exporter/<version>"');
  if (typeof b.version !== 'string' || !SEMVER.test(b.version)) errors.push('version must be a version such as 0.3.0');
  const sources: Array<Record<string, unknown>> = [];
  if (!Array.isArray(b.sources) || b.sources.length > 100) errors.push('sources must be a list of at most 100');
  else b.sources.forEach((s, i) => {
    if (!isObj(s)) { errors.push(`sources[${i}] must be an object`); return; }
    for (const k of Object.keys(s)) if (!['name', 'type', 'lastSuccessAt', 'errors', 'lastErrorAt', 'lastErrorKind'].includes(k)) errors.push(`sources[${i}].${k} is not an allowed field`);
    if (typeof s.name !== 'string' || !SOURCE.test(s.name)) errors.push(`sources[${i}].name must be a source name`);
    if (!SOURCE_TYPES.includes(String(s.type))) errors.push(`sources[${i}].type must be one of ${SOURCE_TYPES.join(', ')}`);
    const time = (v: unknown, f: string) => { if (v === null || v === undefined) return null; if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) { errors.push(`sources[${i}].${f} must be an ISO time`); return null; } return new Date(v).toISOString(); };
    const n = Number(s.errors ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > 1e6) errors.push(`sources[${i}].errors must be a whole number`);
    const kind = s.lastErrorKind === null || s.lastErrorKind === undefined ? null : String(s.lastErrorKind);
    if (kind !== null && !/^(auth|network|http \d{3}|qe-navigator|config|internal)$/.test(kind)) errors.push(`sources[${i}].lastErrorKind is not a known kind`);
    sources.push({ name: s.name, type: s.type, lastSuccessAt: time(s.lastSuccessAt, 'lastSuccessAt'), errors: n, lastErrorAt: time(s.lastErrorAt, 'lastErrorAt'), lastErrorKind: kind });
  });
  const details = { node: typeof b.node === 'string' ? b.node.slice(0, 20) : null, platform: typeof b.platform === 'string' ? b.platform.slice(0, 20) : null, teams: Number(b.teams) || 0 };
  if (errors.length) throw new HeartbeatError(errors.slice(0, 50));
  return { exporter: client as string, version: b.version as string, sources, details };
}

/** The latest Exporter release this server knows (an older Exporter is shown as outdated). */
export const LATEST_EXPORTER_VERSION = '0.4.0';
const cmp = (a: string, b: string) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };
export const isOutdated = (version: string) => cmp(version, LATEST_EXPORTER_VERSION) < 0;
