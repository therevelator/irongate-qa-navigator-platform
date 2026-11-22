/**
 * File uploads ("Level 0", Admin console → Upload files): the zero-access way to get data in. Someone
 * exports files from their tools and drops them on the page; this module turns each file into requests
 * of the ingestion API, which server/routes/uploads.ts runs through the very same handlers (parsers,
 * field allow-list, idempotency, dry run, raw_uploads, ingestion log, calculation engine).
 *
 *   expandUpload   multipart parts → files: gzip unpacked, zip archives opened (zip.ts limits)
 *   detectFile     the kind and format of a file, by its content (never by its name alone)
 *   planFile       one file → its preview (records, date range, stored fields, a sample of minimised
 *                  records, warnings, metrics fed) and the ingestion requests ("submissions") that store it
 *
 * Reports (tests, coverage, SARIF, pipeline runs) are sent as they are, to the chosen team. Events
 * (issues, sprints, incidents, deployments, commits) are parsed, given their team (the chosen team, or
 * mapped by service / project key), reduced to the field allow-list and sent as QE Navigator JSON in
 * chunks the API accepts (1,000 issues, 500 events).
 */
import { createHash } from 'crypto';
import { BodyError, gunzipLimited, isGzip } from './body';
import { CsvError, decodeText, parseCsv, parseOffset, type Csv, type DateOrder } from './csv';
import { CSV_FORMATS, CSV_SPECS, convertCsv, detectCsvFormat, limitsOf, type CsvFormat, type CsvMapping } from './csvImports';
import { isZip, readZip, ZipError } from './zip';
import { allowedFields, minimiseRecord, minimiseSprint, serverOptions, type AllowKind } from './allowListPolicy';
import { ReportError, detectTestFormat, parseTestReport, type TestFormat } from './testReports';
import { detectCoverageFormat, parseCoverageReport, type CoverageFormat } from './coverageReports';
import { looksLikeSarif, parseSarif } from './sarif';
import { parsePipelineBody } from './pipelineEvents';
import { detectIssueFormat, parseIssueBody, MAX_ISSUES } from './issueEvents';
import {
  authorHash, detectCommitFormat, detectDeploymentFormat, detectIncidentFormat, parseCommitBody, parseDeploymentBody, parseIncidentBody, MAX_EVENTS,
  type DeploymentEvent,
} from './deliveryEvents';
import { incidentRecord, issueRecord } from './minimiseStore';

export const UPLOAD_MAX_BYTES = (Number(process.env.UPLOAD_MAX_MB) || 50) * 1024 * 1024;
export const UPLOAD_MAX_PARTS = 20;
export const UPLOAD_MAX_FILES = 100;
export const UPLOAD_MAX_EXPANDED = 100 * 1024 * 1024;
const MAX_AGE_DAYS = 365;
const DAY = 86_400_000;

export type UploadKind = 'tests' | 'coverage' | 'static-analysis' | 'pipelines' | 'deployments' | 'commits' | 'incidents' | 'issues' | 'sprints';

export interface UploadType { value: string; kind: UploadKind; format: string; label: string }

/** Every type a file can be (the manual override of the detection). */
export const UPLOAD_TYPES: UploadType[] = [
  { value: 'tests:junit', kind: 'tests', format: 'junit', label: 'Test results: JUnit XML (also Surefire, pytest, Jest, Go)' },
  { value: 'tests:trx', kind: 'tests', format: 'trx', label: 'Test results: TRX (Visual Studio, dotnet test)' },
  { value: 'tests:cucumber', kind: 'tests', format: 'cucumber', label: 'Test results: Cucumber JSON' },
  { value: 'coverage:lcov', kind: 'coverage', format: 'lcov', label: 'Coverage: lcov' },
  { value: 'coverage:cobertura', kind: 'coverage', format: 'cobertura', label: 'Coverage: Cobertura XML' },
  { value: 'coverage:jacoco', kind: 'coverage', format: 'jacoco', label: 'Coverage: JaCoCo XML' },
  { value: 'coverage:istanbul', kind: 'coverage', format: 'istanbul', label: 'Coverage: Istanbul coverage-final.json' },
  { value: 'coverage:istanbul-summary', kind: 'coverage', format: 'istanbul-summary', label: 'Coverage: Istanbul json-summary' },
  { value: 'static-analysis:sarif', kind: 'static-analysis', format: 'sarif', label: 'Static analysis: SARIF (SonarQube, CodeQL, ESLint, Semgrep)' },
  { value: 'pipelines:json', kind: 'pipelines', format: 'json', label: 'Pipeline runs: QE Navigator JSON' },
  { value: 'deployments:json', kind: 'deployments', format: 'json', label: 'Deployments: QE Navigator JSON' },
  { value: 'deployments:github', kind: 'deployments', format: 'github', label: 'Deployments: GitHub deployment_status webhook' },
  { value: 'deployments:gitlab', kind: 'deployments', format: 'gitlab', label: 'Deployments: GitLab deployment webhook' },
  { value: 'deployments:deployments-csv', kind: 'deployments', format: 'deployments-csv', label: CSV_SPECS['deployments-csv'].label },
  { value: 'commits:json', kind: 'commits', format: 'json', label: 'Commits: QE Navigator JSON (git log)' },
  { value: 'commits:github', kind: 'commits', format: 'github', label: 'Commits: GitHub push webhook' },
  { value: 'commits:gitlab', kind: 'commits', format: 'gitlab', label: 'Commits: GitLab push webhook' },
  { value: 'incidents:json', kind: 'incidents', format: 'json', label: 'Incidents: QE Navigator JSON' },
  { value: 'incidents:pagerduty', kind: 'incidents', format: 'pagerduty', label: 'Incidents: PagerDuty JSON (REST export or webhook)' },
  { value: 'incidents:opsgenie', kind: 'incidents', format: 'opsgenie', label: 'Incidents: Opsgenie JSON (alerts export or webhook)' },
  { value: 'incidents:pagerduty-csv', kind: 'incidents', format: 'pagerduty-csv', label: CSV_SPECS['pagerduty-csv'].label },
  { value: 'incidents:opsgenie-csv', kind: 'incidents', format: 'opsgenie-csv', label: CSV_SPECS['opsgenie-csv'].label },
  { value: 'issues:jira', kind: 'issues', format: 'jira', label: 'Issues: Jira JSON (search result with changelog)' },
  { value: 'issues:linear', kind: 'issues', format: 'linear', label: 'Issues: Linear JSON (GraphQL export)' },
  { value: 'issues:json', kind: 'issues', format: 'json', label: 'Issues: QE Navigator JSON' },
  { value: 'issues:jira-csv', kind: 'issues', format: 'jira-csv', label: CSV_SPECS['jira-csv'].label },
  { value: 'issues:linear-csv', kind: 'issues', format: 'linear-csv', label: CSV_SPECS['linear-csv'].label },
  { value: 'sprints:sprints-csv', kind: 'sprints', format: 'sprints-csv', label: CSV_SPECS['sprints-csv'].label },
];
const TYPE_BY_VALUE = new Map(UPLOAD_TYPES.map((t) => [t.value, t]));
export const typeOf = (kind: string, format: string) => TYPE_BY_VALUE.get(`${kind}:${format}`) ?? null;

/** The metrics each kind feeds (labels as on the team page). */
const METRICS: Record<UploadKind, string[]> = {
  tests: ['Pass rate', 'First-time pass rate', 'Flaky tests', 'Test flakiness rate', 'Test execution time'],
  coverage: ['Line coverage', 'Branch coverage', 'Coverage of changed code (with a diff)', 'Defect density (lines of code)'],
  'static-analysis': ['Code quality score', 'Static-analysis findings', 'New findings', 'Fixed findings'],
  pipelines: ['Average build time', 'Pipeline success rate', 'Parallel test efficiency'],
  deployments: ['Deployment frequency', 'Lead time for changes', 'Change failure rate', 'Incidents per deploy'],
  commits: ['Lead time for changes'],
  incidents: ['Mean time to recovery', 'Mean time between failures', 'System availability', 'Change failure rate', 'Incidents per deploy', 'Infrastructure failures'],
  issues: ['Defect escape rate', 'Defect density', 'Sprint velocity', 'Sprint commitment rate', 'Sprint carryover', 'Blocked time', 'Sizing accuracy'],
  sprints: ['Sprint velocity', 'Sprint commitment rate', 'Sprint carryover (with the issues of those sprints)'],
};

/** Fields stored for the report kinds (events: the field allow-list). */
const REPORT_FIELDS: Record<string, string[]> = {
  tests: ['suite', 'test name', 'status', 'duration', 'retries', 'failure message (first line, at most 500 characters)', 'run time'],
  coverage: ['file path', 'lines found / hit', 'branches found / hit', 'report time'],
  'static-analysis': ['tool and version', 'rule id and name', 'severity', 'category', 'message', 'file path and line', 'suppressed count'],
  pipelines: ['run id', 'attempt', 'pipeline name', 'commit', 'branch', 'start and finish', 'duration', 'result', 'stages (name, kind, times, result)', 'url'],
  deployments: ['id', 'team', 'service', 'environment', 'production', 'commit', 'commit times', 'started / finished', 'result', 'rollback of', 'hotfix', 'url'],
  commits: ['sha', 'authored / committed time', 'authorHash (a salted hash, never the name or e-mail address)', 'branch', 'deployment', 'service'],
};

export interface InFile { name: string; data: Buffer; from?: string }

/** Multipart file parts → the files of the upload (gzip unpacked; zip archives opened, without nesting). */
export function expandUpload(parts: Array<{ filename: string; data: Buffer }>): { files: InFile[]; notes: Array<{ name: string; message: string }> } {
  if (parts.length > UPLOAD_MAX_PARTS) throw new BodyError(413, `Too many files: at most ${UPLOAD_MAX_PARTS} per upload (put more in a zip)`);
  const files: InFile[] = [];
  const notes: Array<{ name: string; message: string }> = [];
  let total = 0;
  const seen = new Map<string, number>();
  const unique = (n: string) => { const k = n.toLowerCase(); const c = (seen.get(k) ?? 0) + 1; seen.set(k, c); return c === 1 ? n : `${n} (${c})`; };
  for (const p of parts) {
    const base = (p.filename || 'file').replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '').slice(0, 200) || 'file';
    let data = p.data;
    if (isGzip(data)) data = gunzipLimited(data);
    if (isZip(data)) {
      let z: ReturnType<typeof readZip>;
      try { z = readZip(data, { maxTotal: UPLOAD_MAX_EXPANDED - total }); } catch (e) {
        if (e instanceof ZipError) throw new BodyError(e.status, `${base}: ${e.message}`);
        throw e;
      }
      for (const s of z.skipped) notes.push({ name: `${base}/${s.name}`, message: `Not read: ${s.reason}` });
      for (const e of z.entries) {
        total += e.data.length;
        const inner = isGzip(e.data) ? gunzipLimited(e.data) : e.data;
        files.push({ name: unique(`${base}/${e.name}`), data: inner, from: base });
      }
    } else {
      total += data.length;
      files.push({ name: unique(base), data });
    }
    if (total > UPLOAD_MAX_EXPANDED) throw new BodyError(413, `The files are larger than ${UPLOAD_MAX_EXPANDED / 1024 / 1024} MB once unpacked: upload them in parts`);
    if (files.length > UPLOAD_MAX_FILES) throw new BodyError(413, `Too many files: at most ${UPLOAD_MAX_FILES} once unpacked`);
  }
  return { files, notes };
}

// ---------------------------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------------------------

export interface Detected { kind: UploadKind; format: string; label: string; alternatives: string[] }

const det = (kind: UploadKind, format: string, alternatives: string[] = []): Detected => ({ kind, format, label: typeOf(kind, format)?.label ?? `${kind} (${format})`, alternatives });

function looksCucumber(body: unknown): boolean {
  return Array.isArray(body) && body.length > 0 && body.every((f: any) => f && typeof f === 'object' && (Array.isArray(f.elements) || ('keyword' in f && 'uri' in f)));
}

function firstOf(body: any): any {
  if (Array.isArray(body)) return body[0];
  return null;
}

/** The kind of a QE Navigator JSON body by its keys (the documented shapes). */
function nativeJsonKind(body: any): UploadKind | null {
  if (!body || typeof body !== 'object') return null;
  if (!Array.isArray(body)) {
    if (Array.isArray(body.issues) || (Array.isArray(body.sprints) && !body.deployments)) return 'issues';
    if (Array.isArray(body.incidents)) return 'incidents';
    if (Array.isArray(body.deployments)) return 'deployments';
    if (Array.isArray(body.runs)) return 'pipelines';
    if (Array.isArray(body.commits) || Array.isArray(body.batches)) return 'commits';
  }
  const x = Array.isArray(body) ? firstOf(body) : body;
  if (!x || typeof x !== 'object') return null;
  if ((x.key || x.id) && (x.status || x.type || x.issueType) && (x.createdAt || x.created)) return 'issues';
  if (x.environment && (x.finishedAt || x.finished_at || x.deployedAt)) return 'deployments';
  if (x.id && (x.severity || x.openedAt || x.opened_at) && !x.environment) return 'incidents';
  if (x.sha && !x.result) return 'commits';
  if (x.id && x.result && (x.startedAt || x.started_at)) return 'pipelines';
  return null;
}

/** Detect a file by its content. Returns null when nothing fits (the preview asks for a type). */
export function detectFile(text: string): Detected | null {
  const t = text.slice(0, 4096).trimStart();
  if (!t) return null;
  if (t.startsWith('<')) {
    const tf = detectTestFormat(text);
    if (tf) return det('tests', tf);
    const cf = detectCoverageFormat(text);
    if (cf) return det('coverage', cf);
    return null;
  }
  if (t.startsWith('{') || t.startsWith('[')) {
    let body: any;
    try { body = JSON.parse(text); } catch { return null; }
    if (looksLikeSarif(body)) return det('static-analysis', 'sarif');
    const cf = !Array.isArray(body) ? detectCoverageFormat(text) : null;
    if (cf) return det('coverage', cf);
    if (looksCucumber(body)) return det('tests', 'cucumber');
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const inc = detectIncidentFormat(body);
      if (inc !== 'json') return det('incidents', inc);
      const dep = detectDeploymentFormat(body);
      if (dep !== 'json') return det('deployments', dep);
      const com = detectCommitFormat(body);
      if (com !== 'json') return det('commits', com);
    }
    const iss = detectIssueFormat(body);
    if (iss !== 'json') return det('issues', iss);
    const k = nativeJsonKind(body);
    if (k) return det(k, 'json');
    return null;
  }
  const cf = detectCoverageFormat(text);
  if (cf === 'lcov') return det('coverage', 'lcov');
  let csv: Csv;
  try { csv = parseCsv(text.slice(0, 256 * 1024).replace(/[^\n\r]*$/, '') || text.slice(0, 256 * 1024)); } catch { return null; }
  const d = detectCsvFormat(csv.headers);
  if (!d) return null;
  const kind = CSV_SPECS[d.format].kind;
  return det(kind === 'sprints' ? 'sprints' : kind, d.format, d.alternatives.map((f) => `${CSV_SPECS[f].kind}:${f}`));
}

// ---------------------------------------------------------------------------------------------
// Planning a file
// ---------------------------------------------------------------------------------------------

export interface FileOptions {
  /** The manual override: "kind:format" (UPLOAD_TYPES). */
  type?: string | null;
  mapping?: CsvMapping | null;
  dateOrder?: 'auto' | DateOrder | null;
  /** Zone of times without one: "+01:00", "-05:00", "UTC" (default UTC). */
  utcOffset?: string | null;
  /** Leave this file out of the upload. */
  skip?: boolean;
}

export interface UploadContext {
  companyId: string;
  mode: 'team' | 'map';
  teamId: string | null;
  /** Teams of the company (id → name). */
  companyTeams: Map<string, string>;
  /** Teams the person may upload to (id → name). */
  allowedTeams: Map<string, string>;
  /** Service / project key → team id (Connect your CI). */
  serviceTeams: Map<string, string>;
  storeTitles: boolean;
  now?: number;
}

export interface Submission {
  kind: Exclude<UploadKind, 'sprints'>;
  body: Buffer;
  contentType: string;
  query: Record<string, string>;
  count: number;
}

export interface Skip { reason: string; count: number; rows?: number[] }

export interface CsvPreview {
  delimiter: string;
  rows: number;
  headers: string[];
  mapping: CsvMapping;
  targets: Array<{ key: string; label: string; required: boolean; type: string }>;
  dateOrder: DateOrder;
  dateOrderAmbiguous: boolean;
  unusedColumns: string[];
}

export interface FilePlan {
  name: string;
  size: number;
  sha256: string;
  detected: Detected | null;
  type: UploadType | null;
  status: 'ready' | 'error' | 'skipped';
  error?: string;
  errorStatus?: number;
  records: number;
  skipped: Skip[];
  dateRange: { from: string; to: string } | null;
  fields: string[];
  dropped: string[];
  sample: Array<Record<string, unknown>>;
  warnings: string[];
  limits: string[];
  metrics: string[];
  teams: Array<{ id: string; name: string; records: number }>;
  /** Keys / ids of the records (for the duplicate check against what is stored). */
  ids?: { table: 'issues' | 'incidents_raw' | 'deployments_raw' | 'issue_sprints'; values: Array<{ team: string; id: string }> };
  /** The exact report already received (tests, coverage, SARIF): its raw_uploads identity. */
  reportIdentity?: { kind: string; team: string; runId: string };
  duplicates?: { count: number; message: string } | null;
  csv?: CsvPreview;
  submissions: Submission[];
}

class PlanError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function addSkip(skips: Skip[], reason: string, row?: number) {
  const s = skips.find((x) => x.reason === reason);
  if (s) { s.count++; if (row !== undefined && (s.rows?.length ?? 0) < 10) (s.rows ??= []).push(row); }
  else skips.push({ reason, count: 1, ...(row !== undefined ? { rows: [row] } : {}) });
}

function range(dates: Array<string | null | undefined>): { from: string; to: string } | null {
  const xs = dates.filter((d): d is string => !!d).sort();
  return xs.length ? { from: xs[0], to: xs[xs.length - 1] } : null;
}

const clean = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)));

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const json = (v: unknown) => Buffer.from(JSON.stringify(v));

/** The team of an event record: the chosen team, or (map) its own team, else its service / project key mapped in Connect your CI. */
function teamFor(ctx: UploadContext, rec: Record<string, unknown>, keyField: 'project' | 'service'): { team: string | null; reason?: string } {
  if (ctx.mode === 'team') return { team: ctx.teamId };
  const own = typeof rec.team === 'string' && rec.team ? rec.team : null;
  if (own) return ctx.companyTeams.has(own) ? { team: own } : { team: null, reason: 'its team is not a team of this company' };
  const key = typeof rec[keyField] === 'string' ? (rec[keyField] as string) : null;
  if (key && ctx.serviceTeams.has(key)) return { team: ctx.serviceTeams.get(key)! };
  return { team: null, reason: key ? `${keyField === 'project' ? 'project key' : 'service'} "${key.slice(0, 60)}" is not mapped to a team (Connect your CI)` : `no team and no ${keyField === 'project' ? 'project key' : 'service'} to map` };
}

function teamSummary(ctx: UploadContext, teams: string[]): FilePlan['teams'] {
  const counts = new Map<string, number>();
  for (const t of teams) counts.set(t, (counts.get(t) ?? 0) + 1);
  return Array.from(counts.entries()).map(([id, records]) => ({ id, name: ctx.companyTeams.get(id) ?? id, records }));
}

function checkScope(ctx: UploadContext, teams: string[]): void {
  const outside = Array.from(new Set(teams)).filter((t) => !ctx.allowedTeams.has(t));
  if (outside.length) {
    throw new PlanError(403, `Records of this file belong to ${outside.length > 1 ? 'teams' : 'team'} ${outside.map((t) => ctx.companyTeams.get(t) ?? t).join(', ')}, which you may not upload to`);
  }
}

/** Times out of range for the delivery events (the API refuses them): in the future or more than a year back. */
function outOfRange(ts: Array<string | null | undefined>, now: number, pastLimit: boolean): string | null {
  for (const t of ts) {
    if (!t) continue;
    const v = Date.parse(t);
    if (v > now + 5 * 60_000) return 'a date is in the future';
    if (pastLimit && v < now - MAX_AGE_DAYS * DAY) return `older than ${MAX_AGE_DAYS} days (the API keeps a year)`;
  }
  return null;
}

function tryParse(text: string, what: string): any {
  try { return JSON.parse(text); } catch { throw new PlanError(400, `The ${what} is not valid JSON`); }
}

/** Split a vendor body into bodies of at most n items, keeping its other keys (Jira "names", …). */
function splitBody(body: any, n: number): any[] {
  if (Array.isArray(body)) return chunk(body, n);
  if (!body || typeof body !== 'object') return [body];
  const paths: Array<[(b: any) => any[] | undefined, (b: any, xs: any[]) => any]> = [
    [(b) => b.issues?.nodes, (b, xs) => ({ ...b, issues: { ...b.issues, nodes: xs } })],
    [(b) => b.data?.issues?.nodes, (b, xs) => ({ ...b, data: { ...b.data, issues: { ...b.data.issues, nodes: xs } } })],
    [(b) => (Array.isArray(b.issues) ? b.issues : undefined), (b, xs) => ({ ...b, issues: xs })],
    [(b) => (Array.isArray(b.incidents) ? b.incidents : undefined), (b, xs) => ({ ...b, incidents: xs })],
    [(b) => (Array.isArray(b.messages) ? b.messages : undefined), (b, xs) => ({ ...b, messages: xs })],
    [(b) => (Array.isArray(b.data) ? b.data : undefined), (b, xs) => ({ ...b, data: xs })],
    [(b) => (Array.isArray(b.deployments) ? b.deployments : undefined), (b, xs) => ({ ...b, deployments: xs })],
  ];
  for (const [get, set] of paths) {
    const xs = get(body);
    if (Array.isArray(xs) && xs.length > n) return chunk(xs, n).map((c) => set(body, c));
  }
  return [body];
}

function deploymentRecord(e: DeploymentEvent): Record<string, unknown> {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return clean({
    id: e.id, team: e.team, service: e.service, environment: e.environment, production: e.production, commit: e.commit,
    commits: e.commits.map((c) => clean({ sha: c.sha, authoredAt: iso(c.authoredAt), committedAt: iso(c.committedAt), authorHash: c.authorHash })),
    commitRange: e.commitFrom ? { from: e.commitFrom, to: e.commit } : null, startedAt: iso(e.startedAt), finishedAt: iso(e.finishedAt),
    result: e.result, rollbackOf: e.rollbackOf, hotfix: e.hotfix, url: e.url,
  });
}

/** One file → its preview and the requests that store it. Never writes anything. */
export function planFile(file: InFile, opts: FileOptions, ctx: UploadContext): FilePlan {
  const now = ctx.now ?? Date.now();
  const text = decodeText(file.data);
  const detected = detectFile(text);
  const override = opts.type ? TYPE_BY_VALUE.get(opts.type) ?? null : null;
  const type = override ?? (detected ? typeOf(detected.kind, detected.format) : null);
  const plan: FilePlan = {
    name: file.name, size: file.data.length, sha256: sha(file.data), detected, type, status: 'ready', records: 0, skipped: [], dateRange: null,
    fields: [], dropped: [], sample: [], warnings: [], limits: [], metrics: [], teams: [], submissions: [],
  };
  if (opts.type && !override) { plan.status = 'error'; plan.error = `Unknown file type "${String(opts.type).slice(0, 60)}"`; plan.errorStatus = 400; return plan; }
  if (opts.skip) { plan.status = 'skipped'; return plan; }
  if (!type) {
    plan.status = 'error';
    plan.errorStatus = 415;
    plan.error = 'The type of this file was not recognised. Choose it in "File type", or check that it is one of the supported exports.';
    return plan;
  }
  if (detected && override && `${detected.kind}:${detected.format}` !== override.value) plan.warnings.push(`Detected as “${detected.label}”; read as “${override.label}” (your choice).`);
  plan.metrics = METRICS[type.kind];
  plan.limits = limitsOf(type.format);
  try {
    if (['tests', 'coverage', 'static-analysis', 'pipelines'].includes(type.kind)) planReport(plan, file, text, type, ctx, now);
    else planEvents(plan, file, text, type, opts, ctx, now);
  } catch (e) {
    plan.status = 'error';
    if (e instanceof PlanError) { plan.error = e.message; plan.errorStatus = e.status; }
    else if (e instanceof ReportError || e instanceof CsvError) { plan.error = e.message; plan.errorStatus = 400; }
    else if (e instanceof BodyError) { plan.error = e.message; plan.errorStatus = e.status; }
    else throw e;
    plan.submissions = [];
  }
  if (plan.status === 'ready' && plan.records === 0) { plan.status = 'error'; plan.errorStatus = 400; plan.error = plan.error ?? 'Nothing in this file can be stored (every row was skipped).'; }
  return plan;
}

function requireTeam(ctx: UploadContext, what: string): string {
  if (ctx.mode !== 'team' || !ctx.teamId) throw new PlanError(400, `${what} carries no team: choose the team it belongs to ("Upload to a team"), not "map by service / project key"`);
  return ctx.teamId;
}

function planReport(plan: FilePlan, file: InFile, text: string, type: UploadType, ctx: UploadContext, now: number) {
  const what = type.kind === 'tests' ? 'A test report' : type.kind === 'coverage' ? 'A coverage report' : type.kind === 'static-analysis' ? 'A SARIF report' : 'A pipeline run file';
  const team = requireTeam(ctx, what);
  checkScope(ctx, [team]);
  plan.teams = [{ id: team, name: ctx.companyTeams.get(team) ?? team, records: 0 }];
  plan.fields = REPORT_FIELDS[type.kind];
  if (type.kind === 'tests') {
    const r = parseTestReport(text, type.format as TestFormat);
    plan.records = r.cases.length;
    if (!r.cases.length) throw new PlanError(400, 'The report has no test cases');
    const at = r.startedAt ?? new Date(now);
    plan.dateRange = { from: at.toISOString(), to: at.toISOString() };
    if (!r.startedAt) plan.warnings.push('The report carries no run time: it is recorded at the time of the upload.');
    plan.sample = r.cases.slice(0, 3).map((c) => clean({ suite: c.suite, name: c.name, status: c.status, durationMs: c.durationMs, failureMessage: c.message ? c.message.split('\n')[0].slice(0, 120) : null }));
    plan.warnings.push(`${r.counts.passed} passed, ${r.counts.failed} failed, ${r.counts.errored} errors, ${r.counts.skipped} skipped.`);
  } else if (type.kind === 'coverage') {
    const r = parseCoverageReport(text, type.format as CoverageFormat);
    plan.records = r.files.length || (r.totals.linesFound ? 1 : 0);
    if (!plan.records) throw new PlanError(400, 'The coverage report has no files');
    plan.dateRange = { from: new Date(now).toISOString(), to: new Date(now).toISOString() };
    plan.warnings.push('A coverage file carries no time: it is recorded at the time of the upload.');
    plan.sample = r.files.slice(0, 3).map((f) => ({ path: f.path, linesFound: f.linesFound, linesHit: f.linesHit, branchesFound: f.branchesFound, branchesHit: f.branchesHit }));
  } else if (type.kind === 'static-analysis') {
    const reps = parseSarif(text);
    const findings = reps.flatMap((r) => r.findings);
    plan.records = Math.max(findings.length, reps.length);
    const at = reps.map((r) => r.analyzedAt).find(Boolean) ?? new Date(now);
    plan.dateRange = { from: at.toISOString(), to: at.toISOString() };
    plan.sample = findings.slice(0, 3).map((f) => clean({ ruleId: f.ruleId, severity: f.severity, path: f.path, line: f.line, message: f.message?.slice(0, 120) }));
    plan.warnings.push(`${reps.map((r) => r.tool).join(', ')}: ${findings.length} finding${findings.length === 1 ? '' : 's'}.`);
  } else {
    const runs = parsePipelineBody(tryParse(text, 'pipeline file'));
    plan.records = runs.length;
    plan.dateRange = range(runs.map((r) => r.startedAt.toISOString()));
    plan.sample = runs.slice(0, 3).map((r) => clean({ id: r.id, attempt: r.attempt, result: r.result, branch: r.branch, startedAt: r.startedAt.toISOString(), durationS: r.durationS, stages: r.stages.length }));
    plan.submissions.push({ kind: 'pipelines', body: file.data, contentType: 'application/json', query: { team }, count: runs.length });
    plan.teams[0].records = runs.length;
    return;
  }
  plan.teams[0].records = plan.records;
  plan.reportIdentity = { kind: type.kind, team, runId: `sha:${sha(file.data).slice(0, 16)}` };
  plan.submissions.push({ kind: type.kind as Submission['kind'], body: file.data, contentType: 'application/octet-stream', query: { team, format: type.format }, count: plan.records });
}

function offsetOf(opts: FileOptions): number {
  if (!opts.utcOffset) return 0;
  const o = parseOffset(opts.utcOffset);
  if (o === null) throw new PlanError(400, `Time zone "${String(opts.utcOffset).slice(0, 20)}" is not understood: use an offset such as +01:00 or UTC`);
  return o;
}

function planEvents(plan: FilePlan, file: InFile, text: string, type: UploadType, opts: FileOptions, ctx: UploadContext, now: number) {
  const salt = ctx.companyId;
  const isCsv = (CSV_FORMATS as readonly string[]).includes(type.format);
  // 1. Records in the QE Navigator JSON shape, with their row (CSV) or position.
  let recs: Array<{ rec: Record<string, unknown>; row?: number }> = [];
  if (isCsv) {
    const csv = parseCsv(text);
    if (csv.ragged) plan.warnings.push(`${csv.ragged} row${csv.ragged === 1 ? ' has' : 's have'} a different number of columns than the header (read as far as they go).`);
    const conv = convertCsv(csv, type.format as CsvFormat, { mapping: opts.mapping ?? null, dateOrder: opts.dateOrder ?? 'auto', utcOffsetMinutes: offsetOf(opts), now });
    const spec = CSV_SPECS[type.format as CsvFormat];
    plan.csv = {
      delimiter: csv.delimiter, rows: csv.rows.length, headers: csv.headers, mapping: conv.mapping,
      targets: spec.targets.map((t) => ({ key: t.key, label: t.label, required: !!t.required, type: t.type })),
      dateOrder: conv.dateOrder, dateOrderAmbiguous: conv.dateOrderAmbiguous, unusedColumns: conv.unusedColumns,
    };
    plan.dropped = conv.unusedColumns.map((c) => `column “${c}”`);
    if (conv.missingColumns.length) plan.warnings.push(`Mapped column${conv.missingColumns.length > 1 ? 's' : ''} not in the file: ${conv.missingColumns.join(', ')}`);
    if (conv.dateOrderAmbiguous) plan.warnings.push('Dates such as 03/04/2026 could be day/month or month/day: read as day/month. Change “Date order” if that is wrong.');
    if (conv.errors.length === 1 && conv.errors[0].row === 1) throw new PlanError(400, `${conv.errors[0].reason}. Choose the columns in the mapping below.`);
    for (const e of conv.errors) addSkip(plan.skipped, e.reason.replace(/"[^"]*"/, '…'), e.row);
    recs = conv.records.map((rec, i) => ({ rec, row: conv.rows[i] }));
    if (type.format === 'jira-csv' && conv.mapping.sprint && !conv.mapping.storyPoints) plan.warnings.push('No story points column was found: velocity, commitment and carryover count 0 points. Map the story points column if your export has one.');
  } else {
    const body = tryParse(text, 'file');
    const parts = splitBody(body, type.kind === 'issues' ? MAX_ISSUES : MAX_EVENTS);
    for (const part of parts) {
      if (type.kind === 'issues') {
        const p = parseIssueBody(part, type.format as any, {});
        for (const ig of p.ignored) addSkip(plan.skipped, ig.reason);
        recs.push(...p.issues.map((e) => ({ rec: issueRecord(e) })));
        // Sprints sent on their own (QE Navigator JSON): kept with the issues.
        const named = new Set(p.issues.flatMap((e) => e.sprints.map((s) => s.id)));
        for (const s of p.sprints.filter((x) => !named.has(x.id))) recs.push({ rec: { __sprint: true, id: s.id, name: s.name, state: s.state, startedAt: s.startedAt?.toISOString() ?? null, endsAt: s.endsAt?.toISOString() ?? null, completedAt: s.completedAt?.toISOString() ?? null } });
      } else if (type.kind === 'incidents') {
        recs.push(...parseIncidentBody(part, type.format, {}).map((e) => ({ rec: incidentRecord(e) })));
      } else if (type.kind === 'deployments') {
        const p = parseDeploymentBody(part, type.format, {});
        for (const ig of p.ignored) addSkip(plan.skipped, ig.reason);
        recs.push(...p.events.map((e) => ({ rec: deploymentRecord(e) })));
      } else if (type.kind === 'commits') {
        const batches = parseCommitBody(part, type.format, {});
        recs.push(...batches.map((b) => ({
          rec: clean({
            team: b.team, service: b.service, deployment: b.deployment, branch: b.branch,
            commits: b.commits.map((c) => clean({ sha: c.sha, authoredAt: c.authoredAt?.toISOString() ?? null, committedAt: c.committedAt?.toISOString() ?? null, authorHash: c.authorHash ?? (c.author ? authorHash(salt, c.author) : null) })),
          }),
        })));
      }
    }
  }

  // 2. Team, date range, the allow-list, and a check of each record by the API's own parser.
  const kindOfMin: AllowKind | null = type.kind === 'issues' ? 'issue' : type.kind === 'incidents' ? 'incident' : null;
  const keyField = type.kind === 'issues' ? 'project' : 'service';
  const kept: Array<{ rec: Record<string, unknown>; team: string; row?: number }> = [];
  const sprintsOnly: Array<Record<string, unknown>> = [];
  const seen = new Map<string, number>();
  const allDropped = new Set<string>(plan.dropped);
  for (const { rec, row } of recs) {
    if (rec.__sprint) { const { __sprint: _x, ...s } = rec; const m = minimiseSprint(s, ctx.storeTitles); if (m) sprintsOnly.push(m); continue; }
    let team: string | null;
    if (type.kind === 'sprints') team = requireTeam(ctx, 'A sprints file');
    else if (type.kind === 'commits' && ctx.mode === 'map' && !rec.team && !(typeof rec.service === 'string' && ctx.serviceTeams.has(rec.service as string)) && rec.deployment) team = '__by_deployment__';
    else {
      const t = teamFor(ctx, rec, keyField as any);
      if (!t.team) { addSkip(plan.skipped, `No team: ${t.reason}`, row); continue; }
      team = t.team;
    }
    const times = type.kind === 'issues' ? [rec.createdAt, rec.resolvedAt, rec.updatedAt] as string[]
      : type.kind === 'incidents' ? [rec.openedAt, rec.acknowledgedAt, rec.resolvedAt, rec.at] as string[]
        : type.kind === 'deployments' ? [rec.finishedAt, rec.startedAt, ...((rec.commits as any[]) ?? []).map((c) => c.authoredAt)] as string[]
          : type.kind === 'commits' ? ((rec.commits as any[]) ?? []).flatMap((c) => [c.authoredAt, c.committedAt]) as string[]
            : [rec.startedAt, rec.completedAt] as string[];
    const bad = outOfRange(times, now, type.kind === 'deployments' || type.kind === 'incidents' || type.kind === 'commits');
    if (bad) { addSkip(plan.skipped, `Date out of range: ${bad}`, row); continue; }
    let out: Record<string, unknown>;
    if (kindOfMin) {
      const m = minimiseRecord(kindOfMin, rec, { storeTitles: ctx.storeTitles, salt });
      for (const d of m.dropped) if (!['team', '__sprint'].includes(d)) allDropped.add(d);
      out = m.record;
    } else if (type.kind === 'sprints') {
      out = minimiseSprint(rec, ctx.storeTitles) ?? {};
    } else out = clean(rec);
    if (team !== '__by_deployment__') out.team = team;
    // The API's parser on this one record: a record it would refuse is skipped, with the reason.
    try {
      if (type.kind === 'issues') parseIssueBody({ issues: [out] }, 'json', {});
      else if (type.kind === 'sprints') parseIssueBody({ sprints: [out] }, 'json', {});
      else if (type.kind === 'incidents') parseIncidentBody({ incidents: [out] }, 'json', {});
      else if (type.kind === 'deployments') parseDeploymentBody({ deployments: [out] }, 'json', {});
      else parseCommitBody(out, 'json', {});
    } catch (e) {
      if (e instanceof ReportError) { addSkip(plan.skipped, `Not valid: ${e.message.replace(/^(issues|incidents|deployments|sprints)\[0\]\.?/, '')}`, row); continue; }
      throw e;
    }
    const id = String(type.kind === 'issues' ? out.key : out.id ?? '');
    if (id && type.kind !== 'commits') {
      const k = `${team}|${id}`;
      if (seen.has(k)) {
        kept.splice(seen.get(k)!, 1, { rec: out, team: team!, row });
        addSkip(plan.skipped, 'Appears more than once in the file (the last row is kept)', row);
        continue;
      }
      seen.set(k, kept.length);
    }
    kept.push({ rec: out, team: team!, row });
  }
  const realTeams = kept.map((k) => k.team).filter((t) => t !== '__by_deployment__');
  checkScope(ctx, realTeams);
  plan.records = kept.length + sprintsOnly.length;
  plan.teams = teamSummary(ctx, realTeams);
  if (kept.some((k) => k.team === '__by_deployment__')) plan.warnings.push('Some commit batches carry no team or service: they go to the team of the deployment they name (it must have been uploaded first).');
  plan.dropped = Array.from(allDropped);
  plan.fields = type.kind === 'sprints' ? ['id', ...(ctx.storeTitles ? ['name'] : []), 'state', 'startedAt', 'endsAt', 'completedAt'] : kindOfMin ? allowedFields(kindOfMin, serverOptions(ctx.storeTitles)) : REPORT_FIELDS[type.kind];
  if (kindOfMin && !ctx.storeTitles) plan.warnings.push('Titles are not stored (company setting “Store issue and incident titles” is off): the evidence lists show the key only.');
  plan.sample = [...kept.slice(0, 3).map((k) => k.rec), ...(kept.length < 3 ? sprintsOnly.slice(0, 3 - kept.length) : [])];
  const firstTime = (r: Record<string, unknown>) => (r.createdAt ?? r.openedAt ?? r.finishedAt ?? r.startedAt ?? (r.commits as any[])?.[0]?.authoredAt ?? null) as string | null;
  plan.dateRange = range([...kept.map((k) => firstTime(k.rec)), ...sprintsOnly.map((s) => (s.startedAt as string) ?? null)]);
  if (type.kind === 'issues' || type.kind === 'incidents' || type.kind === 'deployments' || type.kind === 'sprints') {
    const table = type.kind === 'issues' ? 'issues' : type.kind === 'incidents' ? 'incidents_raw' : type.kind === 'deployments' ? 'deployments_raw' : 'issue_sprints';
    plan.ids = { table, values: kept.map((k) => ({ team: k.team, id: String(type.kind === 'issues' ? k.rec.key : k.rec.id) })) };
  }
  if (type.kind === 'issues') {
    const bugs = kept.filter((k) => /bug|defect/i.test(String(k.rec.type ?? '')));
    const withEnv = bugs.filter((k) => k.rec.environment || (k.rec.labels as string[] | undefined)?.length);
    if (bugs.length && !withEnv.length) plan.warnings.push('No bug says where it was found (environment, found-in or a label such as production): escape rate and density cannot be calculated from this file.');
    const sprintsNoDates = new Set(kept.flatMap((k) => ((k.rec.sprints as any[]) ?? []).filter((s) => !s.completedAt && !s.startedAt).map((s) => s.name ?? s.id)));
    if (sprintsNoDates.size) plan.warnings.push(`${sprintsNoDates.size} sprint${sprintsNoDates.size > 1 ? 's have' : ' has'} no dates in this file (${Array.from(sprintsNoDates).slice(0, 5).join(', ')}${sprintsNoDates.size > 5 ? ', …' : ''}): their velocity, commitment and carryover are calculated once their dates are known (sprints CSV template).`);
  }
  // 3. The requests: QE Navigator JSON, in chunks the API accepts.
  if (type.kind === 'sprints') {
    plan.submissions.push({ kind: 'issues', body: json({ sprints: kept.map((k) => { const { team: _t, ...s } = k.rec; return s; }) }), contentType: 'application/json', query: { format: 'json', team: ctx.teamId! }, count: kept.length });
  } else if (type.kind === 'commits') {
    for (const k of kept) plan.submissions.push({ kind: 'commits', body: json(k.rec), contentType: 'application/json', query: { format: 'json' }, count: (k.rec.commits as unknown[]).length });
  } else {
    const size = type.kind === 'issues' ? MAX_ISSUES : MAX_EVENTS;
    const key = type.kind as 'issues' | 'incidents' | 'deployments';
    for (const part of chunk(kept.map((k) => k.rec), size)) plan.submissions.push({ kind: key, body: json({ [key]: part }), contentType: 'application/json', query: { format: 'json' }, count: part.length });
    if (sprintsOnly.length) {
      if (ctx.mode !== 'team' || !ctx.teamId) plan.warnings.push(`${sprintsOnly.length} sprint${sprintsOnly.length > 1 ? 's' : ''} listed without issues are not stored in “map by key” mode (choose a team).`);
      else plan.submissions.push({ kind: 'issues', body: json({ sprints: sprintsOnly }), contentType: 'application/json', query: { format: 'json', team: ctx.teamId }, count: sprintsOnly.length });
    }
  }
}
