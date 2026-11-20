/**
 * Issues (v2 phase 3): validation and normalisation of the JSON bodies of POST /api/ingest/issues.
 *
 * Accepted shapes (format detected when not given):
 *   jira     a Jira REST search result {issues: [...]} (GET /rest/api/3/search/jql?expand=changelog,names),
 *            one issue (GET /rest/api/3/issue/{key}?expand=changelog), or a Jira webhook
 *            {webhookEvent: "jira:issue_created" | "jira:issue_updated", issue, changelog}
 *   linear   a Linear GraphQL export {data: {issues: {nodes: [...]}}} (or {issues: {nodes}} / an array of
 *            nodes), or a Linear webhook {action, type: "Issue", data, updatedFrom}
 *   json     QE Navigator's own shape {issues: [...], sprints: [...]} (docs/INTEGRATION_GUIDE.md, 4C)
 *
 * Mapping to one internal shape (IssueEvent), documented in docs/INTEGRATION_GUIDE.md:
 *   key          Jira key / Linear identifier / key
 *   type         Jira issuetype (Bug, Defect → bug; Story → story; Task → task; Sub-task → subtask; Epic;
 *                Spike); Linear labels (Bug, Defect → bug; Feature, Story → story; else task); type
 *   status       Jira status with statusCategory (new → todo, indeterminate → in_progress, done → done);
 *                Linear state.type (backlog, unstarted, triage → todo; started → in_progress; completed,
 *                canceled → done); a status named Blocked / Impeded / On hold / Waiting counts as blocked
 *   environment  Jira "environment" (text or document), a custom field named by ?environmentField=, or
 *                labels (production, prod, found-in-production, env:staging, …); Linear labels; environment
 *   story points Jira story points field (?storyPointsField=, the names map or customfield_10016 /
 *                10026 / 10028 / 10002 / 10004); Linear estimate; storyPoints
 *   sprint       Jira sprint field (?sprintField=, the names map or customfield_10020 / 10010 / 10007; every
 *                sprint the issue has been in); Linear cycle; sprint / sprints
 *   estimate     Jira timeoriginalestimate (seconds); estimateHours
 *   time logged  Jira timespent (seconds); timeLoggedHours (Linear has no time tracking: missing)
 *   changes      Jira changelog (status, Sprint, Flagged); Linear history (state, cycle); transitions
 *
 * At most MAX_ISSUES per request. Computed values (a velocity, an escape rate, …) are refused.
 */
import { ReportError } from './testReports';
import { rejectComputed as rejectDeliveryComputed, time } from './deliveryEvents';

export const MAX_ISSUES = 1000;
export const ISSUE_FORMATS = ['json', 'jira', 'linear'] as const;
export type IssueFormat = (typeof ISSUE_FORMATS)[number];
export type IssueType = 'bug' | 'story' | 'task' | 'subtask' | 'epic' | 'spike' | 'other';
export type StatusCategory = 'todo' | 'in_progress' | 'done';
export type FoundIn = 'production' | 'pre_release';

export interface SprintRef {
  id: string;
  name: string | null;
  state: 'future' | 'active' | 'closed' | null;
  startedAt: Date | null;
  endsAt: Date | null;
  completedAt: Date | null;
}

export interface IssueTransition {
  field: 'status' | 'flagged' | 'sprint';
  from: string | null;
  to: string;
  /** status: todo / in_progress / done / blocked; flagged: on / off; sprint: null. */
  toCategory: string | null;
  at: Date;
}

export interface IssueEvent {
  key: string;
  team: string | null;
  /** Jira project key / Linear team key: mapped to a team like a service (Connect your CI). */
  project: string | null;
  source: IssueFormat;
  title: string | null;
  type: IssueType;
  typeLabel: string | null;
  status: string | null;
  statusCategory: StatusCategory;
  resolution: string | null;
  priority: string | null;
  environment: string | null;
  foundIn: FoundIn | null;
  storyPoints: number | null;
  estimateHours: number | null;
  timeLoggedHours: number | null;
  sprints: SprintRef[];
  labels: string[];
  components: string[];
  createdAt: Date;
  resolvedAt: Date | null;
  updatedAt: Date | null;
  url: string | null;
  transitions: IssueTransition[];
}

export interface ParsedIssues { issues: IssueEvent[]; sprints: SprintRef[]; ignored: Array<{ id: string | null; reason: string }> }

export interface IssueOptions {
  team?: string | null;
  storyPointsField?: string | null;
  sprintField?: string | null;
  environmentField?: string | null;
}

const COMPUTED = /^(velocity|sprint_?velocity|commitment(_?rate)?|sprint_?commitment(_?rate)?|carry_?over|sprint_?carry_?over|blocked_?time(_?hours)?|sizing_?accuracy|defect_?escape_?rate|escape_?rate|defect_?density|code_?quality(_?score)?)$/i;

function rejectComputed(obj: unknown, where: string): void {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const k of Object.keys(obj as object)) {
    if (COMPUTED.test(k)) throw new ReportError(`${where}${where ? '.' : ''}${k}: QE Navigator calculates this from the raw issues; send the issues (types, status changes, points, sprints) instead of a computed value`);
  }
  rejectDeliveryComputed(obj, where);
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : null;

function num(v: unknown, field: string, max = 1e7): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0 || n > max) throw new ReportError(`${field} must be a number from 0 to ${max}`);
  return n;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.:#/-]{0,199}$/;
function key(v: unknown, field: string): string {
  const s = str(v, 200);
  if (!s || !KEY_RE.test(s)) throw new ReportError(`${field} is required: the issue key (e.g. PAY-123), letters, digits, "-", "_", ".", ":", "#", "/"`);
  return s;
}

/** Plain text of a Jira field that may be a string or an Atlassian document (ADF). */
export function plainText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(plainText).filter(Boolean).join(', ') || null;
  if (typeof v === 'object') {
    const o = v as any;
    if (typeof o.value === 'string') return o.value.trim() || null; // option fields {value: "Production"}
    if (typeof o.name === 'string') return o.name.trim() || null;
    if (typeof o.text === 'string') return o.text.trim() || null;
    if (Array.isArray(o.content)) return o.content.map(plainText).filter(Boolean).join(' ').trim() || null;
  }
  return null;
}

/** Where a defect was found: production (escaped) or before release; null when unknown. */
export function classifyEnvironment(v: string | null | undefined): FoundIn | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (/\b(pre-?prod(uction)?|non-?prod(uction)?)\b/.test(s)) return 'pre_release';
  if (/\b(prod|production|prd|live|customer[- ]?(reported|found)?|escaped|found[- ]in[- ]prod(uction)?|field)\b/.test(s)) return 'production';
  if (/\b(dev|development|test|testing|qa|staging|stage|stg|uat|sit|ci|local|sandbox|review|integration|pre-?release|internal)\b/.test(s)) return 'pre_release';
  return null;
}

/** An environment from labels such as production, env:staging, found-in-production, escaped. */
function environmentFromLabels(labels: string[]): string | null {
  for (const l of labels) {
    const m = /^(?:env|environment|found[-_ ]?in)[:=_\- ]+(.+)$/i.exec(l);
    if (m && classifyEnvironment(m[1])) return m[1];
  }
  for (const l of labels) if (/^(prod|production|live|escaped|customer[-_ ]?reported|found[-_ ]in[-_ ]prod(uction)?)$/i.test(l)) return l;
  for (const l of labels) if (/^(staging|uat|qa|dev|test|preprod|pre-prod)$/i.test(l)) return l;
  return null;
}

export function normaliseType(v: string | null, subtask = false): IssueType {
  if (subtask) return 'subtask';
  const s = (v ?? '').trim().toLowerCase();
  if (!s) return 'other';
  if (/^(bug|defect|bugfix|bug report|production bug|problem)$/.test(s) || /\bbug\b|\bdefect\b/.test(s)) return 'bug';
  if (/^(story|user story|feature|improvement|enhancement)$/.test(s)) return 'story';
  if (/^(task|chore|technical task|tech task)$/.test(s)) return 'task';
  if (/^(sub-?task|sub task|subtask|child)$/.test(s)) return 'subtask';
  if (/^epic$/.test(s)) return 'epic';
  if (/^(spike|research|investigation)$/.test(s)) return 'spike';
  return 'other';
}

const BLOCKED = /\b(blocked|impeded|impediment|on[ -]hold|waiting( for| on)?|parked)\b/i;
export function statusCategoryOf(status: string | null, hint?: string | null): StatusCategory {
  const h = (hint ?? '').toLowerCase();
  if (['done', 'completed', 'complete', 'canceled', 'cancelled', 'closed', 'resolved'].includes(h)) return 'done';
  if (['indeterminate', 'in_progress', 'in progress', 'started', 'inprogress'].includes(h)) return 'in_progress';
  if (['new', 'todo', 'to do', 'to_do', 'backlog', 'unstarted', 'triage', 'open'].includes(h)) return 'todo';
  const s = (status ?? '').toLowerCase();
  if (/\b(done|closed|resolved|complete(d)?|released|shipped|cancel+ed|won'?t (do|fix)|rejected|duplicate)\b/.test(s)) return 'done';
  if (/\b(to ?do|backlog|open|new|selected|ready|triage|planned|unstarted)\b/.test(s)) return 'todo';
  return s ? 'in_progress' : 'todo';
}
/** The transition category of a status: blocked when its name says so, else its category. */
export const transitionCategory = (status: string, hint?: string | null): string => (BLOCKED.test(status) ? 'blocked' : statusCategoryOf(status, hint));

/** Resolutions that mean the work was not done: never counted as completed, nor as a confirmed defect. */
export const NOT_DONE_RESOLUTION = /\b(won'?t (do|fix)|cancel+ed|duplicate|invalid|not a (bug|defect)|cannot reproduce|can'?t reproduce|incomplete|obsolete|declined|rejected|works as (designed|intended))\b/i;

function sprintState(v: unknown): SprintRef['state'] {
  const s = String(v ?? '').toLowerCase();
  if (s === 'closed' || s === 'completed' || s === 'complete') return 'closed';
  if (s === 'active' || s === 'started' || s === 'current') return 'active';
  if (s === 'future' || s === 'planned' || s === 'upcoming') return 'future';
  return null;
}

function sprintOf(raw: any, at: string): SprintRef | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const s = String(raw);
    // Legacy Jira string: "com.atlassian.greenhopper.service.sprint.Sprint@1a2b[id=12,rapidViewId=3,state=CLOSED,name=Sprint 4,startDate=…,endDate=…,completeDate=…]"
    const m = /\[(.*)\]\s*$/.exec(s);
    if (m) {
      const kv: Record<string, string> = {};
      for (const part of m[1].split(/,(?=[a-zA-Z]+=)/)) { const i = part.indexOf('='); if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1); }
      const nul = (x?: string) => (x && x !== '<null>' ? x : null);
      return { id: key(kv.id, `${at}.id`), name: str(kv.name, 255), state: sprintState(kv.state), startedAt: time(nul(kv.startDate), `${at}.startDate`), endsAt: time(nul(kv.endDate), `${at}.endDate`), completedAt: time(nul(kv.completeDate), `${at}.completeDate`) };
    }
    return { id: key(s, at), name: null, state: null, startedAt: null, endsAt: null, completedAt: null };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ReportError(`${at} must be a sprint id or an object`);
  const id = key(raw.id ?? raw.key ?? raw.name ?? (raw.number !== undefined ? `cycle-${raw.number}` : undefined), `${at}.id`);
  const completedAt = time(raw.completedAt ?? raw.completeDate ?? raw.completed_at, `${at}.completedAt`);
  const startedAt = time(raw.startedAt ?? raw.startDate ?? raw.startsAt ?? raw.start ?? raw.started_at, `${at}.startedAt`);
  const endsAt = time(raw.endsAt ?? raw.endDate ?? raw.end ?? raw.ends_at, `${at}.endsAt`);
  const name = str(raw.name, 255) ?? (raw.number !== undefined ? `Cycle ${raw.number}` : null);
  let state = sprintState(raw.state);
  if (!state && completedAt) state = 'closed';
  return { id, name, state, startedAt, endsAt, completedAt };
}

const dedupeSprints = (xs: Array<SprintRef | null>): SprintRef[] => {
  const by = new Map<string, SprintRef>();
  for (const s of xs) {
    if (!s) continue;
    const p = by.get(s.id);
    by.set(s.id, p ? { id: s.id, name: s.name ?? p.name, state: s.state ?? p.state, startedAt: s.startedAt ?? p.startedAt, endsAt: s.endsAt ?? p.endsAt, completedAt: s.completedAt ?? p.completedAt } : s);
  }
  return Array.from(by.values()).sort((a, b) => (a.startedAt?.getTime() ?? Infinity) - (b.startedAt?.getTime() ?? Infinity));
};

const labelsOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v : Array.isArray((v as any)?.nodes) ? (v as any).nodes : [])
    .map((x: any) => (typeof x === 'string' ? x : x?.name))
    .filter((x: unknown): x is string => typeof x === 'string' && !!x.trim())
    .map((x: string) => x.trim().slice(0, 100))
    .slice(0, 50);

function finish(e: Omit<IssueEvent, 'foundIn' | 'statusCategory'> & { statusCategory?: StatusCategory; categoryHint?: string | null }): IssueEvent {
  const environment = e.environment ?? environmentFromLabels(e.labels);
  let resolvedAt = e.resolvedAt;
  const statusCategory = e.statusCategory ?? statusCategoryOf(e.status, e.categoryHint);
  const transitions = e.transitions.filter((t) => t.at.getTime() >= e.createdAt.getTime() - 60_000).sort((a, b) => a.at.getTime() - b.at.getTime());
  if (statusCategory === 'done' && !resolvedAt) {
    const lastDone = [...transitions].reverse().find((t) => t.field === 'status' && t.toCategory === 'done');
    resolvedAt = lastDone?.at ?? e.updatedAt ?? null;
  }
  if (statusCategory !== 'done') resolvedAt = null;
  const { categoryHint: _h, ...rest } = e as any;
  return { ...rest, environment: environment ? environment.slice(0, 255) : null, foundIn: classifyEnvironment(environment), statusCategory, resolvedAt, transitions };
}

// ---------------------------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------------------------

export function detectIssueFormat(body: any): IssueFormat {
  if (!body || typeof body !== 'object') return 'json';
  if (typeof body.webhookEvent === 'string' && /^jira:/.test(body.webhookEvent)) return 'jira';
  const first = Array.isArray(body) ? body[0] : Array.isArray(body.issues) ? body.issues[0] : body.issue ?? body;
  if (first && typeof first === 'object' && first.fields && typeof first.fields === 'object') return 'jira';
  if (body.data?.issues?.nodes || body.issues?.nodes || (body.type === 'Issue' && body.data && body.action)) return 'linear';
  if (first && typeof first === 'object' && typeof first.identifier === 'string' && (first.state || first.team || first.cycle !== undefined)) return 'linear';
  return 'json';
}

// ---------------------------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------------------------

const SP_FIELDS = ['customfield_10016', 'customfield_10026', 'customfield_10028', 'customfield_10002', 'customfield_10004', 'customfield_10106'];
const SPRINT_FIELDS = ['customfield_10020', 'customfield_10010', 'customfield_10007', 'customfield_10104'];

function fieldByName(names: Record<string, string> | undefined, re: RegExp): string | null {
  if (!names) return null;
  for (const [id, n] of Object.entries(names)) if (typeof n === 'string' && re.test(n.trim())) return id;
  return null;
}

function jiraIssue(raw: any, at: string, opts: IssueOptions, names: Record<string, string> | undefined, webhook?: { changelog?: any; timestamp?: unknown }): IssueEvent {
  if (!raw || typeof raw !== 'object' || !raw.fields || typeof raw.fields !== 'object') throw new ReportError(`${at}: a Jira issue needs "key" and "fields"`);
  const f = raw.fields;
  rejectComputed(f, `${at}.fields`);
  const k = key(raw.key, `${at}.key`);
  const typeLabel = str(f.issuetype?.name, 100);
  const status = str(f.status?.name, 100);
  const spField = opts.storyPointsField || fieldByName(names, /^story ?points?( estimate)?$/i) || SP_FIELDS.find((x) => typeof f[x] === 'number') || null;
  const spRaw = spField ? f[spField] : f.story_points ?? f.storyPoints;
  const sprintField = opts.sprintField || fieldByName(names, /^sprints?$/i) || SPRINT_FIELDS.find((x) => f[x] !== undefined && f[x] !== null)
    || Object.keys(f).find((x) => /^customfield_/.test(x) && Array.isArray(f[x]) && f[x].length > 0 && typeof f[x][0] === 'object' && f[x][0] && 'state' in f[x][0] && ('startDate' in f[x][0] || 'boardId' in f[x][0]))
    || null;
  const sprintRaw = sprintField ? f[sprintField] : null;
  const sprints = dedupeSprints((Array.isArray(sprintRaw) ? sprintRaw : sprintRaw ? [sprintRaw] : []).map((s: any, i: number) => sprintOf(s, `${at}.fields.${sprintField}[${i}]`)));
  const labels = labelsOf(f.labels);
  const envField = opts.environmentField || fieldByName(names, /^(found in|environment found|found in environment|detected in)$/i);
  const environment = plainText(envField ? f[envField] : null) ?? plainText(f.environment);
  const secs = (v: unknown, field: string) => { const n = num(v, field, 1e9); return n === null ? null : Math.round((n / 3600) * 100) / 100; };
  const estimate = secs(f.timeoriginalestimate ?? f.timetracking?.originalEstimateSeconds ?? f.aggregatetimeoriginalestimate, `${at}.fields.timeoriginalestimate`);
  const logged = secs(f.timespent ?? f.timetracking?.timeSpentSeconds ?? f.aggregatetimespent, `${at}.fields.timespent`);
  const transitions: IssueTransition[] = [];
  const histories: Array<{ created: unknown; items: any[] }> = Array.isArray(raw.changelog?.histories) ? raw.changelog.histories : [];
  if (webhook?.changelog && Array.isArray(webhook.changelog.items)) histories.push({ created: webhook.timestamp ?? f.updated, items: webhook.changelog.items });
  histories.forEach((h, hi) => {
    const when = time(h.created, `${at}.changelog.histories[${hi}].created`);
    if (!when || !Array.isArray(h.items)) return;
    for (const it of h.items) {
      const field = String(it?.field ?? it?.fieldId ?? '').toLowerCase();
      if (field === 'status') {
        const to = str(it.toString ?? it.to, 255);
        if (to) transitions.push({ field: 'status', from: str(it.fromString ?? it.from, 255), to, toCategory: transitionCategory(to, to === status ? f.status?.statusCategory?.key : null), at: when });
      } else if (field === 'sprint') {
        transitions.push({ field: 'sprint', from: str(it.from ?? it.fromString, 255), to: str(it.to ?? it.toString, 255) ?? '', toCategory: null, at: when });
      } else if (field === 'flagged') {
        const on = !!str(it.toString ?? it.to, 255);
        transitions.push({ field: 'flagged', from: str(it.fromString, 255), to: on ? 'on' : 'off', toCategory: on ? 'on' : 'off', at: when });
      }
    }
  });
  const self = str(raw.self, 1000);
  const url = self && /^https?:\/\//.test(self) ? self.replace(/\/rest\/api\/\d+\/issue\/.*$/, `/browse/${k}`) : null;
  return finish({
    key: k, team: str(raw.team, 36), project: str(f.project?.key, 100) ?? (k.includes('-') ? k.split('-')[0] : null), source: 'jira',
    title: str(f.summary, 500), type: normaliseType(typeLabel, !!f.issuetype?.subtask), typeLabel, status, categoryHint: f.status?.statusCategory?.key ?? null,
    resolution: str(f.resolution?.name ?? (typeof f.resolution === 'string' ? f.resolution : null), 100), priority: str(f.priority?.name, 50),
    environment, storyPoints: num(spRaw, `${at}.fields.${spField ?? 'story points'}`, 10000), estimateHours: estimate, timeLoggedHours: logged,
    sprints, labels, components: labelsOf(f.components).map((x) => x.slice(0, 200)), createdAt: time(f.created, `${at}.fields.created`, true)!,
    resolvedAt: time(f.resolutiondate, `${at}.fields.resolutiondate`), updatedAt: time(f.updated, `${at}.fields.updated`), url, transitions,
  });
}

function parseJira(body: any, opts: IssueOptions): ParsedIssues {
  const ignored: ParsedIssues['ignored'] = [];
  if (typeof body?.webhookEvent === 'string') {
    if (/deleted$/.test(body.webhookEvent)) return { issues: [], sprints: [], ignored: [{ id: str(body.issue?.key, 200), reason: `${body.webhookEvent}: deleted issues are not removed from the calculation` }] };
    if (!body.issue) throw new ReportError('A Jira webhook needs "issue"');
    const e = jiraIssue(body.issue, 'issue', opts, undefined, { changelog: body.changelog, timestamp: body.timestamp });
    return { issues: [e], sprints: [], ignored };
  }
  const items: any[] = Array.isArray(body) ? body : Array.isArray(body?.issues) ? body.issues : body?.fields ? [body] : [];
  if (!items.length) throw new ReportError('Send a Jira search result {"issues": [...]}, an issue, or a Jira webhook');
  if (items.length > MAX_ISSUES) throw new ReportError(`Too many issues in one request: at most ${MAX_ISSUES} (send several requests, e.g. one per page of the search)`);
  return { issues: items.map((x, i) => jiraIssue(x, `issues[${i}]`, opts, body?.names)), sprints: [], ignored };
}

// ---------------------------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------------------------

function linearCategory(type: unknown): StatusCategory | undefined {
  const t = String(type ?? '').toLowerCase();
  if (t === 'completed' || t === 'canceled' || t === 'cancelled') return 'done';
  if (t === 'started') return 'in_progress';
  if (t === 'backlog' || t === 'unstarted' || t === 'triage') return 'todo';
  return undefined;
}

function linearIssue(raw: any, at: string, webhook?: { updatedFrom?: any; createdAt?: unknown }): IssueEvent {
  if (!raw || typeof raw !== 'object') throw new ReportError(`${at} must be a Linear issue`);
  rejectComputed(raw, at);
  const k = key(raw.identifier ?? raw.key ?? raw.id, `${at}.identifier`);
  const labels = labelsOf(raw.labels);
  const lower = labels.map((l) => l.toLowerCase());
  const type: IssueType = lower.some((l) => /^(bug|defect|regression)$/.test(l) || /\bbug\b/.test(l)) ? 'bug'
    : lower.some((l) => /^(feature|story|user story|improvement)$/.test(l)) ? 'story' : raw.parent || raw.parentId ? 'subtask' : 'task';
  const stateType = raw.state?.type;
  const canceled = String(stateType ?? '').toLowerCase().startsWith('cancel') || !!raw.canceledAt;
  const cycles: Array<SprintRef | null> = [];
  const transitions: IssueTransition[] = [];
  const hist: any[] = Array.isArray(raw.history?.nodes) ? raw.history.nodes : Array.isArray(raw.history) ? raw.history : [];
  hist.forEach((h, i) => {
    const when = time(h.createdAt, `${at}.history[${i}].createdAt`);
    if (!when) return;
    if (h.toState?.name) transitions.push({ field: 'status', from: str(h.fromState?.name, 255), to: str(h.toState.name, 255)!, toCategory: BLOCKED.test(h.toState.name) ? 'blocked' : linearCategory(h.toState.type) ?? statusCategoryOf(h.toState.name), at: when });
    if (h.toCycle || h.fromCycle || h.toCycleId !== undefined) {
      const to = h.toCycle ? sprintOf(h.toCycle, `${at}.history[${i}].toCycle`) : null;
      if (to) cycles.push(to);
      if (h.fromCycle) cycles.push(sprintOf(h.fromCycle, `${at}.history[${i}].fromCycle`));
      transitions.push({ field: 'sprint', from: h.fromCycle?.id ?? h.fromCycleId ?? null, to: to?.id ?? h.toCycleId ?? '', toCategory: null, at: when });
    }
  });
  if (raw.cycle) cycles.push(sprintOf(raw.cycle, `${at}.cycle`));
  else if (raw.cycleId) cycles.push({ id: key(raw.cycleId, `${at}.cycleId`), name: null, state: null, startedAt: null, endsAt: null, completedAt: null });
  if (webhook?.updatedFrom && 'stateId' in webhook.updatedFrom && raw.state?.name) {
    const when = time(raw.updatedAt ?? webhook.createdAt, `${at}.updatedAt`);
    if (when) transitions.push({ field: 'status', from: null, to: str(raw.state.name, 255)!, toCategory: BLOCKED.test(raw.state.name) ? 'blocked' : linearCategory(raw.state.type) ?? statusCategoryOf(raw.state.name), at: when });
  }
  const env = labels.find((l) => /^(?:env|environment|found[-_ ]?in)[:=_\- ]+/i.test(l));
  return finish({
    key: k, team: typeof raw.qeTeam === 'string' ? raw.qeTeam : null, project: str(raw.team?.key, 100) ?? (k.includes('-') ? k.split('-')[0] : null), source: 'linear',
    title: str(raw.title, 500), type, typeLabel: labels.find((l) => /bug|defect|feature|story|improvement/i.test(l)) ?? null,
    status: str(raw.state?.name, 100), statusCategory: linearCategory(stateType), categoryHint: null,
    resolution: canceled ? 'Canceled' : raw.completedAt || String(stateType ?? '').toLowerCase() === 'completed' ? 'Done' : null,
    priority: str(raw.priorityLabel ?? (typeof raw.priority === 'number' ? ['No priority', 'Urgent', 'High', 'Medium', 'Low'][raw.priority] : raw.priority), 50),
    environment: env ? env.replace(/^(?:env|environment|found[-_ ]?in)[:=_\- ]+/i, '') : null,
    storyPoints: num(raw.estimate, `${at}.estimate`, 10000), estimateHours: null, timeLoggedHours: null,
    sprints: dedupeSprints(cycles), labels, components: raw.project?.name ? [String(raw.project.name).slice(0, 200)] : [],
    createdAt: time(raw.createdAt, `${at}.createdAt`, true)!, resolvedAt: time(raw.completedAt ?? raw.canceledAt, `${at}.completedAt`),
    updatedAt: time(raw.updatedAt, `${at}.updatedAt`), url: typeof raw.url === 'string' && /^https?:\/\//.test(raw.url) ? raw.url.slice(0, 1000) : null, transitions,
  });
}

function parseLinear(body: any): ParsedIssues {
  if (body && body.type === 'Issue' && body.data && typeof body.action === 'string') {
    if (body.action === 'remove') return { issues: [], sprints: [], ignored: [{ id: str(body.data.identifier, 200), reason: 'remove: deleted issues are not removed from the calculation' }] };
    return { issues: [linearIssue(body.data, 'data', { updatedFrom: body.updatedFrom, createdAt: body.createdAt })], sprints: [], ignored: [] };
  }
  if (body && typeof body.type === 'string' && body.action && body.type !== 'Issue') return { issues: [], sprints: [], ignored: [{ id: null, reason: `Linear webhook of type ${body.type}: only Issue events are read` }] };
  const nodes: any[] = Array.isArray(body) ? body : body?.data?.issues?.nodes ?? body?.issues?.nodes ?? (Array.isArray(body?.issues) ? body.issues : body?.identifier ? [body] : []);
  if (!nodes.length) throw new ReportError('Send a Linear export {"data": {"issues": {"nodes": [...]}}}, an array of issues, or a Linear webhook');
  if (nodes.length > MAX_ISSUES) throw new ReportError(`Too many issues in one request: at most ${MAX_ISSUES}`);
  return { issues: nodes.map((n, i) => linearIssue(n, `issues[${i}]`)), sprints: [], ignored: [] };
}

// ---------------------------------------------------------------------------------------------
// QE Navigator JSON
// ---------------------------------------------------------------------------------------------

function jsonIssue(raw: any, at: string, sprintsById: Map<string, SprintRef>): IssueEvent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ReportError(`${at} must be an issue object`);
  rejectComputed(raw, at);
  const k = key(raw.key ?? raw.id, `${at}.key`);
  const typeLabel = str(raw.type ?? raw.issueType, 100);
  const status = str(raw.status, 100);
  const sprintList = [...(Array.isArray(raw.sprints) ? raw.sprints : []), ...(raw.sprint ? [raw.sprint] : [])];
  const sprints = dedupeSprints(sprintList.map((s: any, i: number) => {
    const ref = sprintOf(s, `${at}.sprints[${i}]`);
    return ref ? { ...(sprintsById.get(ref.id) ?? {}), ...Object.fromEntries(Object.entries(ref).filter(([, v]) => v !== null)) } as SprintRef : null;
  }));
  const transitions: IssueTransition[] = [];
  (Array.isArray(raw.transitions) ? raw.transitions : []).forEach((t: any, i: number) => {
    const w = `${at}.transitions[${i}]`;
    if (!t || typeof t !== 'object') throw new ReportError(`${w} must be an object {at, from, to}`);
    const when = time(t.at ?? t.time ?? t.created, `${w}.at`, true)!;
    const field = String(t.field ?? 'status').toLowerCase();
    if (field === 'flagged' || field === 'blocked') {
      const on = t.to === true || t.to === 'on' || t.to === 'true' || t.blocked === true;
      transitions.push({ field: 'flagged', from: null, to: on ? 'on' : 'off', toCategory: on ? 'on' : 'off', at: when });
    } else if (field === 'sprint') {
      transitions.push({ field: 'sprint', from: str(t.from, 255), to: str(t.to, 255) ?? '', toCategory: null, at: when });
    } else {
      const to = str(t.to ?? t.status, 255);
      if (!to) throw new ReportError(`${w}.to is required (the new status)`);
      transitions.push({ field: 'status', from: str(t.from, 255), to, toCategory: t.toCategory ? String(t.toCategory) : transitionCategory(to), at: when });
    }
  });
  (Array.isArray(raw.blocked) ? raw.blocked : []).forEach((b: any, i: number) => {
    const from = time(b?.from ?? b?.start, `${at}.blocked[${i}].from`, true)!;
    transitions.push({ field: 'flagged', from: null, to: 'on', toCategory: 'on', at: from });
    const to = time(b?.to ?? b?.end, `${at}.blocked[${i}].to`);
    if (to) transitions.push({ field: 'flagged', from: null, to: 'off', toCategory: 'off', at: to });
  });
  const labels = labelsOf(raw.labels);
  const hours = (h: unknown, s: unknown, field: string) => { const a = num(h, field, 1e6); if (a !== null) return a; const b = num(s, field.replace('Hours', 'Seconds'), 1e9); return b === null ? null : Math.round((b / 3600) * 100) / 100; };
  return finish({
    key: k, team: str(raw.team ?? raw.teamId, 36), project: str(raw.project, 100) ?? (k.includes('-') ? k.split('-')[0] : null), source: 'json',
    title: str(raw.title ?? raw.summary, 500), type: normaliseType(typeLabel), typeLabel, status, categoryHint: str(raw.statusCategory, 30),
    resolution: str(raw.resolution, 100), priority: str(raw.priority, 50), environment: str(raw.environment ?? raw.foundIn, 255),
    storyPoints: num(raw.storyPoints ?? raw.story_points ?? raw.points, `${at}.storyPoints`, 10000),
    estimateHours: hours(raw.estimateHours, raw.estimateSeconds, `${at}.estimateHours`), timeLoggedHours: hours(raw.timeLoggedHours ?? raw.timeSpentHours, raw.timeSpentSeconds, `${at}.timeLoggedHours`),
    sprints, labels, components: labelsOf(raw.components).map((x) => x.slice(0, 200)),
    createdAt: time(raw.createdAt ?? raw.created, `${at}.createdAt`, true)!, resolvedAt: time(raw.resolvedAt ?? raw.resolved, `${at}.resolvedAt`),
    updatedAt: time(raw.updatedAt ?? raw.updated, `${at}.updatedAt`), url: typeof raw.url === 'string' && /^https?:\/\//.test(raw.url) ? raw.url.slice(0, 1000) : null, transitions,
  });
}

function parseJson(body: any, opts: IssueOptions): ParsedIssues {
  const sprintsList: SprintRef[] = (Array.isArray(body?.sprints) ? body.sprints : []).map((s: any, i: number) => sprintOf(s, `sprints[${i}]`)).filter(Boolean) as SprintRef[];
  const byId = new Map(sprintsList.map((s) => [s.id, s]));
  const items: any[] = Array.isArray(body) ? body : Array.isArray(body?.issues) ? body.issues : body && typeof body === 'object' && (body.key || body.id) ? [body] : [];
  if (!items.length && !sprintsList.length) throw new ReportError('Send {"issues": [...]} (and optionally "sprints": [...]), an array of issues, or one issue');
  if (items.length > MAX_ISSUES) throw new ReportError(`Too many issues in one request: at most ${MAX_ISSUES} (send several requests)`);
  if (body && typeof body === 'object' && !Array.isArray(body)) rejectComputed(body, '');
  const issues = items.map((x, i) => jsonIssue(x, `issues[${i}]`, byId));
  void opts;
  return { issues, sprints: sprintsList, ignored: [] };
}

/** Parse a body of the given format; the team of each issue: its own, else the request's. */
export function parseIssueBody(body: unknown, format: IssueFormat, opts: IssueOptions = {}): ParsedIssues {
  const p = format === 'jira' ? parseJira(body, opts) : format === 'linear' ? parseLinear(body) : parseJson(body, opts);
  for (const e of p.issues) if (!e.team && opts.team) e.team = opts.team;
  // Sprints named by issues and listed on their own: one list (closed sprints carry their completion time).
  const all = dedupeSprints([...p.sprints, ...p.issues.flatMap((e) => e.sprints)]);
  const seen = new Set<string>();
  for (const e of p.issues) if (seen.has(e.key)) throw new ReportError(`Issue ${e.key} appears more than once in the request`); else seen.add(e.key);
  return { ...p, sprints: all };
}

/** Completed: in a done status and not resolved as won't do, duplicate, cannot reproduce, … */
export const isCompleted = (statusCategory: string, resolution: string | null) => statusCategory === 'done' && !(resolution && NOT_DONE_RESOLUTION.test(resolution));
