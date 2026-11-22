/**
 * The field allow-list (fieldAllowList.ts, shared with the agent) as the server applies it to records it
 * builds itself: file uploads (CSV rows, vendor JSON) and the copy of API requests kept in raw_uploads.
 *
 *   prepare*      bring a QE Navigator JSON record into the allow-list's value domain first: the issue
 *                 type and incident severity / status normalised to their enums, the environment taken
 *                 from labels when the record has none (labels themselves are not kept), people turned
 *                 into a salted hash (assignee → assigneeHash, responder → responderHash; the same hash as
 *                 commit authors), text that a spreadsheet would run as a formula prefixed with "'";
 *   minimiseRecord  prepare + minimise, with the list of the record's fields that were dropped (preview);
 *   SERVER_OPTIONS  titles per the company setting "Store issue and incident titles", links and people
 *                 hashes on (a hash is all that is ever kept of a person).
 */
import { createHash } from 'crypto';
import { ALWAYS_DROPPED, FIELD_ALLOW_LIST, allowedFields, minimise, type AllowKind, type MinimiseOptions } from './fieldAllowList';
import { classifyEnvironment, normaliseType } from './issueEvents';
import { normaliseIncidentStatus, normaliseSeverity } from './deliveryEvents';

export { ALWAYS_DROPPED, FIELD_ALLOW_LIST, allowedFields, minimise };
export type { AllowKind };

export const serverOptions = (storeTitles: boolean): MinimiseOptions => ({ titles: storeTitles, links: true, people: true });

/** A salted hash of a person (e-mail, account id or name): the commit-author hash (deliveryEvents.authorHash). */
export function hashPerson(salt: string, identity: string): string {
  return createHash('sha256').update(`${salt}:${identity.trim().toLowerCase()}`).digest('hex').slice(0, 32);
}

/** Text a spreadsheet would run as a formula (=, +, -, @, tab, CR first) is prefixed with an apostrophe (CSV injection). */
export function formulaSafe(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
}

const HASH = /^[0-9a-f]{16,64}$/i;

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

function personHash(salt: string, rec: Record<string, unknown>, hashKey: string, sources: string[]): string | undefined {
  const given = rec[hashKey];
  if (typeof given === 'string' && HASH.test(given)) return given.toLowerCase();
  for (const s of sources) { const id = identityOf(rec[s]); if (id) return hashPerson(salt, id); }
  return undefined;
}

/** Environment words in labels (production, env:staging, found-in-production, …), as the issue parsers read them. */
function environmentFromLabels(labels: unknown): string | null {
  const ls = (Array.isArray(labels) ? labels : typeof labels === 'string' ? labels.split(',') : [])
    .map((x) => (typeof x === 'string' ? x : (x as any)?.name)).filter((x): x is string => typeof x === 'string').map((x) => x.trim());
  for (const l of ls) { const m = /^(?:env|environment|found[-_ ]?in)[:=_\- ]+(.+)$/i.exec(l); if (m && classifyEnvironment(m[1])) return m[1]; }
  for (const l of ls) if (/^(prod|production|live|escaped|customer[-_ ]?reported|found[-_ ]in[-_ ]prod(uction)?)$/i.test(l)) return l;
  for (const l of ls) if (/^(staging|uat|qa|dev|test|preprod|pre-prod)$/i.test(l)) return l;
  return null;
}

const safeText = (v: unknown) => (typeof v === 'string' ? formulaSafe(v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()) : v);

export function prepareIssue(rec: Record<string, unknown>, salt: string): Record<string, unknown> {
  const typeRaw = typeof rec.type === 'string' ? rec.type : typeof rec.issueType === 'string' ? (rec.issueType as string) : null;
  const type = typeRaw && ['bug', 'story', 'task', 'subtask', 'epic', 'spike', 'other'].includes(typeRaw) ? typeRaw : normaliseType(typeRaw);
  const environment = (typeof rec.environment === 'string' && rec.environment.trim() ? rec.environment : null) ?? environmentFromLabels(rec.labels);
  const components = Array.isArray(rec.components) ? (rec.components as unknown[]).map((c) => (typeof c === 'string' ? c : (c as any)?.name)).filter((c) => typeof c === 'string').map(safeText) : undefined;
  return {
    ...rec, type, environment: environment ? safeText(environment) : null, components,
    title: safeText(rec.title ?? rec.summary), status: safeText(rec.status), resolution: safeText(rec.resolution),
    sprints: Array.isArray(rec.sprints) ? (rec.sprints as any[]).map((s) => (s && typeof s === 'object' ? { ...s, name: safeText(s.name) } : s)) : rec.sprints,
    transitions: Array.isArray(rec.transitions) ? (rec.transitions as any[]).map((t) => (t && typeof t === 'object' ? { ...t, from: safeText(t.from), to: safeText(t.to) } : t)) : rec.transitions,
    assigneeHash: personHash(salt, rec, 'assigneeHash', ['assignee', 'assigneeEmail', 'assignedTo']),
  };
}

export function prepareIncident(rec: Record<string, unknown>, salt: string): Record<string, unknown> {
  const label = typeof rec.severityLabel === 'string' ? rec.severityLabel : typeof rec.severity === 'string' ? (rec.severity as string) : null;
  const severity = normaliseSeverity(rec.severity ?? rec.severityLabel);
  return {
    ...rec, severity: severity ?? undefined, severityLabel: label && label !== severity ? safeText(label) : undefined,
    status: normaliseIncidentStatus(rec.status) ?? undefined, title: safeText(rec.title ?? rec.summary ?? rec.message), service: safeText(rec.service),
    category: typeof rec.category === 'string' ? rec.category.toLowerCase() : rec.category, deploymentId: rec.deploymentId ?? rec.deployment,
    responderHash: personHash(salt, rec, 'responderHash', ['responder', 'assignee', 'owner', 'assignedTo']),
  };
}

/** A sprint on its own (sprints template): kept as the issue's sprint list element is. */
export function minimiseSprint(rec: Record<string, unknown>, storeTitles: boolean): Record<string, unknown> | null {
  const out = minimise('issue', { sprints: [{ ...rec, name: safeText(rec.name) }] }, { titles: storeTitles });
  return ((out.sprints as Array<Record<string, unknown>> | undefined) ?? [])[0] ?? null;
}

const PEOPLE = new Set(['assignee', 'assigneeEmail', 'assignedTo', 'responder', 'owner', 'reporter', 'creator', 'createdBy']);
const RENAMED = new Set(['deployment', 'summary', 'message', 'issueType']);

/** prepare + minimise, with the input fields that were not kept (for the preview). */
export function minimiseRecord(kind: AllowKind, rec: Record<string, unknown>, opts: { salt: string; storeTitles: boolean }): { record: Record<string, unknown>; dropped: string[] } {
  const prepared = kind === 'issue' ? prepareIssue(rec, opts.salt) : prepareIncident(rec, opts.salt);
  const record = minimise(kind, prepared, serverOptions(opts.storeTitles));
  const rules = FIELD_ALLOW_LIST[kind];
  const dropped: string[] = [];
  for (const k of Object.keys(rec)) {
    const v = rec[k];
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || k in record || RENAMED.has(k)) continue;
    if (k in rules && !(rules[k].optIn === 'titles' && !opts.storeTitles)) continue;
    dropped.push(PEOPLE.has(k) && (record.assigneeHash || record.responderHash) && ['assignee', 'assigneeEmail', 'assignedTo', 'responder', 'owner'].includes(k) ? `${k} (stored as a salted hash only)` : k);
  }
  return { record, dropped };
}
