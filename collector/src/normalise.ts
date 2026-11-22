/**
 * Normalisation shared by the source mappers. The rules are the same as QE Navigator's own parsers
 * (server/lib/ingest/issueEvents.ts and deliveryEvents.ts), applied here so that only the normalised
 * value leaves the network: e.g. an issue's "environment" (often free text in Jira) is reduced to
 * production / pre-release before sending, and the text itself is never sent.
 */
export type IssueType = 'bug' | 'story' | 'task' | 'subtask' | 'epic' | 'spike' | 'other';
export type StatusCategory = 'todo' | 'in_progress' | 'done';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export function normaliseType(v: string | null | undefined, subtask = false): IssueType {
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

export const BLOCKED = /\b(blocked|impeded|impediment|on[ -]hold|waiting( for| on)?|parked)\b/i;

export function statusCategoryOf(status: string | null | undefined, hint?: string | null): StatusCategory {
  const h = (hint ?? '').toLowerCase();
  if (['done', 'completed', 'complete', 'canceled', 'cancelled', 'closed', 'resolved'].includes(h)) return 'done';
  if (['indeterminate', 'in_progress', 'in progress', 'started', 'inprogress'].includes(h)) return 'in_progress';
  if (['new', 'todo', 'to do', 'to_do', 'backlog', 'unstarted', 'triage', 'open'].includes(h)) return 'todo';
  const s = (status ?? '').toLowerCase();
  if (/\b(done|closed|resolved|complete(d)?|released|shipped|cancel+ed|won'?t (do|fix)|rejected|duplicate)\b/.test(s)) return 'done';
  if (/\b(to ?do|backlog|open|new|selected|ready|triage|planned|unstarted)\b/.test(s)) return 'todo';
  return s ? 'in_progress' : 'todo';
}

/** The category of a status a transition went to: blocked when its name says so, else its category. */
export const transitionCategory = (status: string, hint?: string | null): string => (BLOCKED.test(status) ? 'blocked' : statusCategoryOf(status, hint));

/** production or pre-release; null when the text says neither (the text itself is never sent). */
export function classifyEnvironment(v: string | null | undefined): 'production' | 'pre-release' | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (/\b(pre-?prod(uction)?|non-?prod(uction)?)\b/.test(s)) return 'pre-release';
  if (/\b(prod|production|prd|live|customer[- ]?(reported|found)?|escaped|found[- ]in[- ]prod(uction)?|field)\b/.test(s)) return 'production';
  if (/\b(dev|development|test|testing|qa|staging|stage|stg|uat|sit|ci|local|sandbox|review|integration|pre-?release|internal)\b/.test(s)) return 'pre-release';
  return null;
}

/** An environment from labels such as production, env:staging, found-in-production, escaped. */
export function environmentFromLabels(labels: string[]): 'production' | 'pre-release' | null {
  for (const l of labels) {
    const m = /^(?:env|environment|found[-_ ]?in)[:=_\- ]+(.+)$/i.exec(l);
    if (m && classifyEnvironment(m[1])) return classifyEnvironment(m[1]);
  }
  for (const l of labels) if (/^(prod|production|live|escaped|customer[-_ ]?reported|found[-_ ]in[-_ ]prod(uction)?)$/i.test(l)) return 'production';
  for (const l of labels) if (/^(staging|uat|qa|dev|test|preprod|pre-prod)$/i.test(l)) return 'pre-release';
  return null;
}

/** Plain text of a Jira value that may be a string, an option ({value}), or an Atlassian document. Used only to classify, never sent. */
export function plainText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(plainText).filter(Boolean).join(', ') || null;
  if (typeof v === 'object') {
    const o = v as any;
    if (typeof o.value === 'string') return o.value.trim() || null;
    if (typeof o.name === 'string') return o.name.trim() || null;
    if (typeof o.text === 'string') return o.text.trim() || null;
    if (Array.isArray(o.content)) return o.content.map(plainText).filter(Boolean).join(' ').trim() || null;
  }
  return null;
}

/** ISO 8601 UTC of a vendor timestamp (Jira's "2026-11-03T10:00:00.000+0000", epoch ms, ISO); null when unparseable. */
export function iso(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  let d: Date;
  if (typeof v === 'number') d = new Date(v);
  else {
    const s = String(v).trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    d = new Date(/^\d{12,14}$/.test(s) ? Number(s) : s);
  }
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function severityOf(v: unknown): Severity | null {
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

export const hours = (seconds: unknown): number | null => (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? Math.round((seconds / 3600) * 100) / 100 : null);

export type SprintState = 'future' | 'active' | 'closed' | null;
export function sprintState(v: unknown): SprintState {
  const s = String(v ?? '').toLowerCase();
  if (s === 'closed' || s === 'completed' || s === 'complete') return 'closed';
  if (s === 'active' || s === 'started' || s === 'current') return 'active';
  if (s === 'future' || s === 'planned' || s === 'upcoming') return 'future';
  return null;
}

export interface Sprint { id: string; name?: string | null; state: SprintState; startedAt: string | null; endsAt: string | null; completedAt: string | null }

/** A Jira sprint value: an object ({id, name, state, startDate, endDate, completeDate}) or the legacy Server string. */
export function jiraSprint(raw: unknown): Sprint | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const s = String(raw);
    const m = /\[(.*)\]\s*$/.exec(s);
    if (!m) return /^[A-Za-z0-9_.:-]{1,200}$/.test(s) ? { id: s, name: null, state: null, startedAt: null, endsAt: null, completedAt: null } : null;
    const kv: Record<string, string> = {};
    for (const part of m[1].split(/,(?=[a-zA-Z]+=)/)) { const i = part.indexOf('='); if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1); }
    const nul = (x?: string) => (x && x !== '<null>' ? x : null);
    if (!kv.id) return null;
    return { id: kv.id, name: nul(kv.name), state: sprintState(kv.state), startedAt: iso(nul(kv.startDate)), endsAt: iso(nul(kv.endDate)), completedAt: iso(nul(kv.completeDate)) };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as any;
  if (o.id === undefined || o.id === null) return null;
  const completedAt = iso(o.completeDate ?? o.completedAt);
  let state = sprintState(o.state);
  if (!state && completedAt) state = 'closed';
  return { id: String(o.id), name: typeof o.name === 'string' ? o.name : null, state, startedAt: iso(o.startDate ?? o.startedAt), endsAt: iso(o.endDate ?? o.endsAt), completedAt };
}
