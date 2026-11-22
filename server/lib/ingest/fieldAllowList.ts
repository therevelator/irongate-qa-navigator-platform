/**
 * Field allow-list: the only fields of an issue or an incident that may leave the customer's network or
 * be stored by QE Navigator, and a pure minimise(kind, record) that keeps exactly those (nothing else
 * survives, nested objects included). Plain data and pure functions, no imports: the one file shared by
 * the QE Navigator server (this file, the source) and the on-premises agent (vendored into
 * agent/src/vendor/). The server applies it on every path that receives issues or incidents: the
 * ingestion API, file uploads (server/lib/ingest/allowListPolicy.ts) and what the agent sends.
 *
 * Every field below is one a calculation reads (docs/INTEGRATION_GUIDE.md 4B.4 and 4C.3, "Field
 * allow-list"), one the evidence lists show (components, environment, severityLabel), or an opt-in
 * label (title, url, *Hash) that the sender must enable explicitly; descriptions, comments, attachments,
 * free-text custom fields, labels, priority, names and e-mail addresses are not on the list and can
 * never be sent or stored.
 */
export type AllowKind = 'issue' | 'incident';

export interface FieldRule {
  /** string: trimmed, at most max characters; number: finite and 0..max; time: ISO 8601 (UTC); enum: one of values; strings: a list of strings (each at most max). */
  type: 'string' | 'number' | 'boolean' | 'time' | 'enum' | 'hash' | 'list' | 'strings';
  max?: number;
  values?: readonly string[];
  /** list: the rule set of each element (a nested allow-list). */
  of?: Record<string, FieldRule>;
  maxItems?: number;
  /** Opt-in fields: only kept when the sender enabled the named option (agent: privacy.sendTitles, …). */
  optIn?: 'titles' | 'links' | 'people';
  /** Why the field is needed: shown in the agent's preview and SECURITY.md. */
  why: string;
}

const SPRINT: Record<string, FieldRule> = {
  id: { type: 'string', max: 200, why: 'sprint identity (commitment, carryover)' },
  name: { type: 'string', max: 255, optIn: 'titles', why: 'sprint name shown on the team page' },
  state: { type: 'enum', values: ['future', 'active', 'closed'], why: 'which sprints are closed' },
  startedAt: { type: 'time', why: 'committed scope at sprint start' },
  endsAt: { type: 'time', why: 'planned sprint end' },
  completedAt: { type: 'time', why: 'velocity of the sprint closed on or before a day' },
};

const TRANSITION: Record<string, FieldRule> = {
  at: { type: 'time', why: 'when the change happened' },
  field: { type: 'enum', values: ['status', 'sprint', 'flagged'], why: 'which field changed' },
  from: { type: 'string', max: 255, why: 'previous status name or sprint ids' },
  to: { type: 'string', max: 255, why: 'new status name or sprint ids' },
  toCategory: { type: 'enum', values: ['todo', 'in_progress', 'done', 'blocked', 'on', 'off'], why: 'blocked time, completion time' },
};

const UPDATE: Record<string, FieldRule> = {
  status: { type: 'enum', values: ['open', 'acknowledged', 'resolved'], why: 'status stream (MTTR, availability)' },
  at: { type: 'time', why: 'time of the status change' },
};

export const FIELD_ALLOW_LIST: Record<AllowKind, Record<string, FieldRule>> = {
  issue: {
    key: { type: 'string', max: 200, why: 'issue identity (idempotency)' },
    team: { type: 'string', max: 36, why: 'QE Navigator team id' },
    project: { type: 'string', max: 100, why: 'project key, mapped to a team in Connect your CI' },
    type: { type: 'enum', values: ['bug', 'story', 'task', 'subtask', 'epic', 'spike', 'other'], why: 'bugs for defect metrics; epics and sub-tasks excluded from velocity' },
    status: { type: 'string', max: 100, why: 'current workflow status (blocked detection)' },
    statusCategory: { type: 'enum', values: ['todo', 'in_progress', 'done'], why: 'completed or not' },
    resolution: { type: 'string', max: 100, why: "won't do / duplicate are not completed and not confirmed defects" },
    environment: { type: 'string', max: 255, why: 'defect escape rate and density (found in production or before release); the environment name is shown with the escaped defects' },
    storyPoints: { type: 'number', max: 10000, why: 'velocity, commitment, carryover' },
    estimateHours: { type: 'number', max: 1e6, why: 'sizing accuracy' },
    timeLoggedHours: { type: 'number', max: 1e6, why: 'sizing accuracy' },
    createdAt: { type: 'time', why: 'defect window, committed scope' },
    resolvedAt: { type: 'time', why: 'completion time' },
    updatedAt: { type: 'time', why: 'change time (idempotency)' },
    sprints: { type: 'list', of: SPRINT, maxItems: 100, why: 'sprint metrics' },
    transitions: { type: 'list', of: TRANSITION, maxItems: 2000, why: 'status, sprint and flag history (blocked time, commitment)' },
    components: { type: 'strings', max: 200, maxItems: 50, why: 'components shown with the escaped defects in the evidence' },
    title: { type: 'string', max: 500, optIn: 'titles', why: 'issue title in the evidence (opt-in)' },
    url: { type: 'string', max: 1000, optIn: 'links', why: 'link back to the tracker (opt-in)' },
    assigneeHash: { type: 'hash', optIn: 'people', why: 'salted hash of the assignee, computed locally (opt-in)' },
  },
  incident: {
    id: { type: 'string', max: 200, why: 'incident identity (updates by id)' },
    team: { type: 'string', max: 36, why: 'QE Navigator team id' },
    service: { type: 'string', max: 255, why: 'MTBF per service, service → team mapping' },
    severity: { type: 'enum', values: ['critical', 'high', 'medium', 'low', 'info'], why: 'outage or not (availability)' },
    severityLabel: { type: 'string', max: 50, why: 'the tool’s own severity name (P1, SEV2, …) shown with the severity' },
    status: { type: 'enum', values: ['open', 'acknowledged', 'resolved'], why: 'current status' },
    at: { type: 'time', why: 'time of the latest status change' },
    openedAt: { type: 'time', why: 'MTTR, MTBF, availability' },
    acknowledgedAt: { type: 'time', why: 'time to acknowledge' },
    resolvedAt: { type: 'time', why: 'MTTR, availability' },
    updates: { type: 'list', of: UPDATE, maxItems: 1000, why: 'reopen / re-resolve history' },
    deploymentId: { type: 'string', max: 200, why: 'change failure rate (linked deployment)' },
    category: { type: 'string', max: 50, why: 'infrastructure failures' },
    outage: { type: 'boolean', why: 'availability (when severity is not enough)' },
    title: { type: 'string', max: 500, optIn: 'titles', why: 'incident title in the evidence (opt-in)' },
    url: { type: 'string', max: 1000, optIn: 'links', why: 'link back to the incident tool (opt-in)' },
    responderHash: { type: 'hash', optIn: 'people', why: 'salted hash of the first responder, computed locally (opt-in)' },
  },
};

export interface MinimiseOptions { titles?: boolean; links?: boolean; people?: boolean }

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function clean(rule: FieldRule, v: unknown, opts: MinimiseOptions): unknown {
  if (v === undefined || v === null) return undefined;
  switch (rule.type) {
    case 'string': {
      const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
      return s ? s.slice(0, rule.max ?? 255) : undefined;
    }
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= (rule.max ?? 1e9) ? v : undefined;
    case 'boolean':
      return typeof v === 'boolean' ? v : undefined;
    case 'time': {
      const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : null;
      if (!d || Number.isNaN(d.getTime())) return undefined;
      const s = d.toISOString();
      return ISO.test(s) ? s : undefined;
    }
    case 'enum':
      return typeof v === 'string' && (rule.values ?? []).includes(v) ? v : undefined;
    case 'hash':
      return typeof v === 'string' && /^[0-9a-f]{16,64}$/.test(v) ? v : undefined;
    case 'strings': {
      if (!Array.isArray(v)) return undefined;
      const xs = v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, rule.max ?? 255)).slice(0, rule.maxItems ?? 50);
      return xs.length ? xs : undefined;
    }
    case 'list': {
      if (!Array.isArray(v) || !rule.of) return undefined;
      const items = v.slice(0, rule.maxItems ?? 100).map((x) => pick(rule.of!, x, opts)).filter((x): x is Record<string, unknown> => !!x && Object.keys(x).length > 0);
      return items.length ? items : undefined;
    }
  }
  return undefined;
}

function pick(rules: Record<string, FieldRule>, record: unknown, opts: MinimiseOptions): Record<string, unknown> | null {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const out: Record<string, unknown> = {};
  for (const [name, rule] of Object.entries(rules)) {
    if (rule.optIn && !opts[rule.optIn]) continue;
    const v = clean(rule, (record as Record<string, unknown>)[name], opts);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

/**
 * The record with only the allowed fields (in allow-list order), each checked against its rule;
 * anything else, at any depth, is dropped. Opt-in fields need their option (default: all off).
 */
export function minimise(kind: AllowKind, record: unknown, opts: MinimiseOptions = {}): Record<string, unknown> {
  const rules = FIELD_ALLOW_LIST[kind];
  if (!rules) throw new Error(`Unknown record kind "${kind}"`);
  return pick(rules, record, opts) ?? {};
}

/** Never kept, whatever the source or the options (documentation and previews). */
export const ALWAYS_DROPPED = [
  'descriptions', 'comments', 'attachments', 'custom free-text fields', 'work-log text', 'watchers and voters', 'labels', 'priority',
  'names and e-mail addresses of people (an assignee or responder is kept only as a salted hash, when enabled)',
  'due dates', 'fix versions', 'alert and incident notes, details and tags',
];

/** The allowed field names of a kind (top level), for documentation and the preview. */
export function allowedFields(kind: AllowKind, opts: MinimiseOptions = {}): string[] {
  return Object.entries(FIELD_ALLOW_LIST[kind]).filter(([, r]) => !r.optIn || opts[r.optIn]).map(([n]) => n);
}
