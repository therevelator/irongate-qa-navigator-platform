/**
 * FIELD ALLOW-LIST (data minimisation): the only fields of an issue, a sprint or an incident that QE
 * Navigator keeps. Applied to every path that receives issues or incidents: the ingestion API
 * (POST /api/ingest/issues, /api/ingest/incidents), file uploads (Admin console → Upload files) and the
 * QE Navigator Exporter. Documented field by field in docs/INTEGRATION_GUIDE.md ("Field allow-list") and
 * shown in the upload preview.
 *
 * Shared with the QE Navigator Exporter (exporter/): plain data plus pure functions, no imports from the
 * server or the database. The only dependency is Node's crypto module, for the salted hash of people.
 *
 *   minimise(kind, record, options)  a copy of the record with the allowed fields only:
 *     - fields not on the list are dropped (descriptions, comments, attachments, custom free-text
 *       fields, watchers, work-log text, e-mail addresses, …: never kept, there is no option);
 *     - people (assignee, reporter, creator, responder, …) are replaced by a salted hash
 *       (<role>Hash), the same hash as commit authors (sha256 of "<salt>:<identity in lower case>",
 *       32 hex characters); without a salt they are dropped;
 *     - title is kept only when options.storeTitles is not false (the company setting
 *       "Store issue and incident titles", default on);
 *     - labels are kept only when they say where a defect was found (production, env:staging, …) or
 *       what the issue is (bug, defect, feature, story, …): the only labels the calculations read;
 *     - strings are trimmed and capped; text that a spreadsheet would run as a formula (=, +, -, @ at
 *       the start) is prefixed with an apostrophe.
 *
 * The input is the QE Navigator JSON shape of /api/ingest/issues and /api/ingest/incidents
 * (docs/INTEGRATION_GUIDE.md 4C, 3C), with any extra fields a source may carry; the output is still a
 * valid body record for those endpoints.
 */
import { createHash } from 'crypto';

export const ALLOW_LIST_VERSION = 1;

export type MinimiseKind = 'issue' | 'sprint' | 'incident';

export interface AllowedField {
  field: string;
  /** What the field is used for (shown in the preview and the documentation). */
  why: string;
  /** Kept only when the company setting "Store issue and incident titles" is on. */
  setting?: 'storeTitles';
  /** A person, stored as a salted hash only. */
  person?: boolean;
}

export const FIELD_ALLOW_LIST: Record<MinimiseKind, AllowedField[]> = {
  issue: [
    { field: 'key', why: 'identity of the issue (e.g. PAY-123), shown in the evidence lists' },
    { field: 'team', why: 'the QE Navigator team the issue belongs to' },
    { field: 'project', why: 'project key, mapped to a team in Connect your CI' },
    { field: 'type', why: 'bug / story / task / sub-task / epic: bugs feed escape rate and density; epics and sub-tasks are left out of sprint metrics' },
    { field: 'status', why: 'current status name' },
    { field: 'statusCategory', why: 'to do / in progress / done: completed work' },
    { field: 'resolution', why: 'won’t do, duplicate, cannot reproduce: not counted as completed or as a confirmed defect' },
    { field: 'transitions', why: 'status, sprint and flagged changes with their times: blocked time, commitment' },
    { field: 'createdAt', why: 'opened: the defect window, committed at sprint start' },
    { field: 'resolvedAt', why: 'completed: velocity, carryover' },
    { field: 'updatedAt', why: 'ordering of updates (an older copy never overwrites a newer one)' },
    { field: 'storyPoints', why: 'velocity, commitment, carryover' },
    { field: 'sprints', why: 'the sprints the issue has been in: velocity, commitment, carryover' },
    { field: 'environment', why: 'found in production or before release: escape rate, density' },
    { field: 'labels', why: 'only labels naming an environment (production, env:staging, …) or a type (bug, feature, …)' },
    { field: 'components', why: 'shown with the defects in the evidence lists' },
    { field: 'priority', why: 'priority name (e.g. High, P1): shown with the defects in the evidence lists' },
    { field: 'estimateHours', why: 'original estimate: sizing accuracy' },
    { field: 'timeLoggedHours', why: 'time logged: sizing accuracy' },
    { field: 'url', why: 'link back to the issue in the evidence lists' },
    { field: 'title', why: 'shown next to the key in the evidence lists', setting: 'storeTitles' },
    { field: 'assignee', why: 'stored as a salted hash only (never the name or e-mail address)', person: true },
    { field: 'reporter', why: 'stored as a salted hash only (never the name or e-mail address)', person: true },
  ],
  sprint: [
    { field: 'id', why: 'identity of the sprint' },
    { field: 'name', why: 'shown with the sprint metrics' },
    { field: 'state', why: 'future / active / closed' },
    { field: 'startedAt', why: 'sprint start: committed work' },
    { field: 'endsAt', why: 'planned end' },
    { field: 'completedAt', why: 'sprint close: the day the sprint metrics are for' },
  ],
  incident: [
    { field: 'id', why: 'identity of the incident in your tool' },
    { field: 'team', why: 'the QE Navigator team the incident belongs to' },
    { field: 'service', why: 'mapped to a team in Connect your CI; shown in the evidence lists' },
    { field: 'severity', why: 'critical / high count as an outage: MTBF, availability' },
    { field: 'status', why: 'open / acknowledged / resolved' },
    { field: 'openedAt', why: 'MTTR, MTBF, availability, incidents per deploy' },
    { field: 'acknowledgedAt', why: 'time to acknowledge' },
    { field: 'resolvedAt', why: 'MTTR, availability' },
    { field: 'at', why: 'time of this status update (ordering of updates)' },
    { field: 'updates', why: 'status changes with their times' },
    { field: 'deploymentId', why: 'the deployment that caused it: change failure rate' },
    { field: 'outage', why: 'whether the incident was an outage' },
    { field: 'category', why: 'infrastructure incidents: infrastructure failures' },
    { field: 'url', why: 'link back to the incident in the evidence lists' },
    { field: 'title', why: 'shown next to the id in the evidence lists', setting: 'storeTitles' },
    { field: 'responder', why: 'stored as a salted hash only (never the name or e-mail address)', person: true },
  ],
};

/** Never kept, whatever the source or the settings (documentation and preview). */
export const ALWAYS_DROPPED = [
  'descriptions', 'comments', 'attachments', 'custom free-text fields', 'work-log text', 'watchers and voters',
  'names and e-mail addresses of people (assignee, reporter, creator, responder: a salted hash instead)',
  'due dates', 'fix versions', 'other labels', 'alert / incident notes and details',
];

/** Source names of people, per kind, mapped to the allowed person field. */
const PERSON_ALIASES: Record<MinimiseKind, Record<string, string>> = {
  issue: {
    assignee: 'assignee', assigneeEmail: 'assignee', assignee_email: 'assignee', assignedTo: 'assignee',
    reporter: 'reporter', reporterEmail: 'reporter', reporter_email: 'reporter', creator: 'reporter', createdBy: 'reporter', author: 'reporter',
  },
  sprint: {},
  incident: {
    responder: 'responder', assignee: 'responder', assignedTo: 'responder', resolvedBy: 'responder', acknowledgedBy: 'responder', owner: 'responder',
  },
};

/** The label that marks a work item of test automation (its time logged is the time invested of automation ROI). */
export const AUTOMATION_LABEL = 'test-automation';

/** Labels the calculations read: where a defect was found, what the issue is, or that it is test-automation work. */
export function usefulLabel(label: string): boolean {
  const l = label.trim().toLowerCase();
  if (l === AUTOMATION_LABEL) return true;
  if (/^(?:env|environment|found[-_ ]?in)[:=_\- ]+.+$/.test(l)) return true;
  if (/^(prod|production|prd|live|escaped|customer[-_ ]?reported|found[-_ ]in[-_ ]prod(uction)?|staging|stage|uat|qa|dev|test|preprod|pre-prod|sit)$/.test(l)) return true;
  if (/^(bug|defect|regression|feature|story|user story|improvement|enhancement|task|chore|spike)$/.test(l) || /\bbug\b|\bdefect\b/.test(l)) return true;
  return false;
}

/** A salted hash of a person (e-mail, account id or name): the commit-author hash. */
export function hashPerson(salt: string, identity: string): string {
  return createHash('sha256').update(`${salt}:${identity.trim().toLowerCase()}`).digest('hex').slice(0, 32);
}

/** Text a spreadsheet would run as a formula is prefixed with an apostrophe (CSV injection). */
export function formulaSafe(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
}

const MAX_TEXT = 500;
const text = (v: unknown, max = MAX_TEXT): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  return s ? formulaSafe(s.slice(0, max)) : null;
};

/** Identity of a person from a string or an object ({emailAddress | email | accountId | id | name | displayName}). */
function identityOf(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of ['emailAddress', 'email', 'accountId', 'id', 'login', 'username', 'name', 'displayName', 'summary']) {
      if (typeof o[k] === 'string' && (o[k] as string).trim()) return (o[k] as string).trim();
    }
  }
  return null;
}

export interface MinimiseOptions {
  /** The company setting "Store issue and incident titles" (default true). */
  storeTitles?: boolean;
  /** Salt of the person hash (the company id on the server). Without it, people are dropped. */
  salt?: string | null;
}

export interface Minimised<T = Record<string, unknown>> {
  record: T;
  /** Top-level fields of the input that were not kept (for the preview). */
  dropped: string[];
}

function copyValue(field: string, v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return field === 'url' ? (/^https?:\/\//i.test(v.trim()) ? v.trim().slice(0, 1000) : undefined) : text(v) ?? undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return v;
}

function minimiseSprint(raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'string' || typeof raw === 'number') return text(raw, 255) ?? undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const f of FIELD_ALLOW_LIST.sprint) {
    const v = copyValue(f.field, (raw as Record<string, unknown>)[f.field]);
    if (v !== undefined) out[f.field] = typeof v === 'string' ? v.slice(0, 255) : v;
  }
  return out;
}

function minimiseTransition(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const t = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ['field', 'from', 'to', 'toCategory', 'at', 'blocked']) {
    const v = t[k];
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? text(v, 255) : typeof v === 'number' || typeof v === 'boolean' ? v : undefined;
  }
  return out;
}

function minimiseUpdate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const u = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ['status', 'at']) if (typeof u[k] === 'string' || typeof u[k] === 'number') out[k] = typeof u[k] === 'string' ? text(u[k], 100) : u[k];
  return out;
}

/** Keep only the allowed fields of one record (pure; the input is not changed). */
export function minimise<T extends Record<string, unknown>>(kind: MinimiseKind, record: T, options: MinimiseOptions = {}): Minimised {
  const allowed = new Map(FIELD_ALLOW_LIST[kind].map((f) => [f.field, f]));
  const out: Record<string, unknown> = {};
  const dropped: string[] = [];
  const persons = PERSON_ALIASES[kind];
  for (const [k, v] of Object.entries(record ?? {})) {
    const personField = persons[k] ?? (k.endsWith('Hash') && allowed.get(k.slice(0, -4))?.person ? k.slice(0, -4) : null);
    if (personField) {
      const hashKey = `${personField}Hash`;
      if (k.endsWith('Hash') && typeof v === 'string' && /^[0-9a-f]{8,64}$/i.test(v)) out[hashKey] = v.toLowerCase();
      else {
        const id = identityOf(v);
        if (id && options.salt) out[hashKey] = hashPerson(options.salt, id);
        dropped.push(k);
      }
      continue;
    }
    const spec = allowed.get(k);
    if (!spec) { dropped.push(k); continue; }
    if (spec.setting === 'storeTitles' && options.storeTitles === false) { dropped.push(k); continue; }
    if (k === 'labels') {
      const labels = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
        .map((x) => (typeof x === 'string' ? x : (x as any)?.name)).filter((x): x is string => typeof x === 'string' && !!x.trim())
        .map((x) => x.trim().slice(0, 100)).filter(usefulLabel).slice(0, 50);
      if (labels.length) out.labels = labels.map(formulaSafe);
      continue;
    }
    if (k === 'components') {
      const c = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => text(typeof x === 'string' ? x : (x as any)?.name, 200)).filter(Boolean).slice(0, 50);
      if (c.length) out.components = c;
      continue;
    }
    if (k === 'sprints') { if (Array.isArray(v)) out.sprints = v.map(minimiseSprint).filter((x) => x !== undefined).slice(0, 100); continue; }
    if (k === 'transitions') { if (Array.isArray(v)) out.transitions = v.map(minimiseTransition).filter((x) => x !== undefined).slice(0, 5000); continue; }
    if (k === 'updates') { if (Array.isArray(v)) out.updates = v.map(minimiseUpdate).filter((x) => x !== undefined).slice(0, 1000); continue; }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      // Structured values are not on the list (a status object, an ADF document, …): their plain name only.
      const name = text((v as any).name ?? (v as any).value ?? (v as any).key, 255);
      if (name && !['title', 'url'].includes(k)) out[k] = name;
      else dropped.push(k);
      continue;
    }
    const c = copyValue(k, v);
    if (c !== undefined) out[k] = c;
  }
  return { record: out, dropped };
}

/** The fields a minimised record may carry, for the preview ("fields that will be stored"). */
export function storedFieldNames(kind: MinimiseKind, options: MinimiseOptions = {}): string[] {
  return FIELD_ALLOW_LIST[kind]
    .filter((f) => !(f.setting === 'storeTitles' && options.storeTitles === false))
    .filter((f) => !(f.person && !options.salt))
    .map((f) => (f.person ? `${f.field}Hash` : f.field));
}
