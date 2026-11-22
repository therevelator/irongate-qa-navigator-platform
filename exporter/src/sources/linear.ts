/**
 * Linear (personal API key, read-only; GraphQL queries only, never a mutation).
 *
 * Read: the issues of the configured team keys with updatedAt >= <cursor> (cursor pagination), each with
 * its state, labels (to classify bug / environment; not sent), estimate, cycle and state / cycle history
 * (paged in full when longer than one page). Descriptions, comments and attachments are not in the query.
 */
import { credentialEntry } from '../credentials';
import type { HttpSettings, LinearSource } from '../config';
import { requireSecret, teamFor } from '../config';
import { SourceClient, SourceError, type Adapter, type Page } from './client';
import { BLOCKED, environmentFromLabels, iso, statusCategoryOf, type Sprint } from '../normalise';
import { maskTitle, person, type PrivacyContext } from '../privacy';
import type { HttpResponse } from '../http';

const CYCLE = 'id number startsAt endsAt completedAt';
const HISTORY_NODE = `createdAt fromState { name type } toState { name type } fromCycle { ${CYCLE} } toCycle { ${CYCLE} }`;

export function issuesQuery(p: PrivacyContext['privacy']): string {
  const opt = [p.sendTitles ? 'title' : '', p.sendLinks ? 'url' : '', p.people === 'hash' ? 'assignee { id }' : ''].filter(Boolean).join(' ');
  return `query Issues($first: Int!, $after: String, $filter: IssueFilter) {
  issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt, includeArchived: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id identifier createdAt updatedAt completedAt canceledAt estimate ${opt}
      team { key } parent { id } state { name type } labels(first: 50) { nodes { name } } cycle { ${CYCLE} }
      history(first: 50) { pageInfo { hasNextPage endCursor } nodes { ${HISTORY_NODE} } }
    }
  }
}`;
}

const HISTORY_QUERY = `query History($id: String!, $after: String) { issue(id: $id) { history(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${HISTORY_NODE} } } } }`;

function category(type: unknown): 'todo' | 'in_progress' | 'done' | undefined {
  const t = String(type ?? '').toLowerCase();
  if (t === 'completed' || t === 'canceled' || t === 'cancelled') return 'done';
  if (t === 'started') return 'in_progress';
  if (t === 'backlog' || t === 'unstarted' || t === 'triage') return 'todo';
  return undefined;
}

function cycle(c: any): Sprint | null {
  if (!c || !c.id) return null;
  const completedAt = iso(c.completedAt);
  const starts = iso(c.startsAt);
  const ends = iso(c.endsAt);
  const now = Date.now();
  const state = completedAt ? 'closed' : starts && Date.parse(starts) > now ? 'future' : starts && ends && Date.parse(starts) <= now && Date.parse(ends) > now ? 'active' : null;
  return { id: String(c.id), name: typeof c.number === 'number' ? `Cycle ${c.number}` : null, state, startedAt: starts, endsAt: ends, completedAt };
}

export interface LinearMapContext { src: Pick<LinearSource, 'teams' | 'defaultTeam'>; privacy: PrivacyContext }

/** One Linear issue node → QE Navigator JSON, or the reason it is skipped. */
export function mapLinearIssue(raw: any, ctx: LinearMapContext): { id: string; record?: Record<string, unknown>; changedAt: string | null; skip?: string } {
  const key = typeof raw?.identifier === 'string' ? raw.identifier : String(raw?.id ?? '?');
  const teamKey = raw?.team?.key ?? (key.includes('-') ? key.split('-')[0] : null);
  const changedAt = iso(raw?.updatedAt);
  const team = teamFor(ctx.src as LinearSource, [teamKey]);
  if (!team) return { id: key, changedAt, skip: `Linear team ${teamKey ?? '?'} is not mapped to a team (sources[].teams)` };
  const createdAt = iso(raw.createdAt);
  if (!createdAt) return { id: key, changedAt, skip: 'no created time' };
  const labels: string[] = (Array.isArray(raw.labels?.nodes) ? raw.labels.nodes : []).map((l: any) => l?.name).filter((x: unknown): x is string => typeof x === 'string');
  const lower = labels.map((l) => l.toLowerCase());
  const type = lower.some((l) => /^(bug|defect|regression)$/.test(l) || /\bbug\b/.test(l)) ? 'bug'
    : lower.some((l) => /^(feature|story|user story|improvement)$/.test(l)) ? 'story' : raw.parent ? 'subtask' : 'task';
  const stateType = String(raw.state?.type ?? '').toLowerCase();
  const status = typeof raw.state?.name === 'string' ? raw.state.name : null;
  const canceled = stateType.startsWith('cancel') || !!raw.canceledAt;
  const sprints = new Map<string, Sprint>();
  const add = (s: Sprint | null) => { if (s) sprints.set(s.id, { ...(sprints.get(s.id) ?? {}), ...s }); };
  const transitions: Array<Record<string, unknown>> = [];
  const hist: any[] = Array.isArray(raw.history?.nodes) ? raw.history.nodes : [];
  for (const h of hist) {
    const at = iso(h?.createdAt);
    if (!at) continue;
    if (h.toState?.name) {
      const to = String(h.toState.name);
      transitions.push({ at, field: 'status', from: h.fromState?.name ?? null, to, toCategory: BLOCKED.test(to) ? 'blocked' : category(h.toState.type) ?? statusCategoryOf(to) });
    }
    if (h.toCycle || h.fromCycle) {
      add(cycle(h.toCycle));
      add(cycle(h.fromCycle));
      transitions.push({ at, field: 'sprint', from: h.fromCycle?.id ?? null, to: h.toCycle?.id ?? '' });
    }
  }
  add(cycle(raw.cycle));
  transitions.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const record: Record<string, unknown> = {
    key, team, type, status, statusCategory: category(stateType) ?? statusCategoryOf(status),
    resolution: canceled ? 'Canceled' : raw.completedAt || stateType === 'completed' ? 'Done' : null,
    environment: environmentFromLabels(labels),
    storyPoints: typeof raw.estimate === 'number' ? raw.estimate : null,
    createdAt, resolvedAt: iso(raw.completedAt ?? raw.canceledAt), updatedAt: changedAt,
    sprints: Array.from(sprints.values()), transitions,
    title: ctx.privacy.privacy.sendTitles ? maskTitle(raw.title) : undefined,
    url: ctx.privacy.privacy.sendLinks && typeof raw.url === 'string' ? raw.url : undefined,
    assigneeHash: person(ctx.privacy, raw.assignee?.id ?? null),
  };
  return { id: key, record, changedAt };
}

const rateLimited = (res: HttpResponse) => (res.status === 400 || res.status === 200) && /"RATELIMITED"|ratelimited/i.test(res.text().slice(0, 2000));

export class LinearAdapter implements Adapter {
  kind = 'issues' as const;
  private client: SourceClient;

  constructor(private src: LinearSource, http: HttpSettings, private privacy: PrivacyContext, env: NodeJS.ProcessEnv = process.env) {
    const key = requireSecret(src.tokenEnv, `sources.${src.name}`, env);
    this.client = new SourceClient({
      source: src.name, baseUrl: src.apiUrl, headers: { Authorization: /^lin_oauth_/.test(key) || (credentialEntry(src.tokenEnv) as any)?.type === 'oauth' ? `Bearer ${key}` : key }, caFile: src.caFile, http,
      retry: { retryable: rateLimited }, authHint: 'Use a personal API key with read access (Settings → Security & access → API keys, permission "Read").',
    });
  }

  requests() { return this.client.requests; }

  private async gql(query: string, variables: Record<string, unknown>): Promise<any> {
    const r = await this.client.postQuery('', { query, variables });
    if (Array.isArray(r?.errors) && r.errors.length) {
      const msg = r.errors.map((e: any) => e?.message).filter(Boolean).join('; ').slice(0, 300);
      const auth = r.errors.some((e: any) => /AUTHENTICATION|FORBIDDEN/i.test(String(e?.extensions?.code ?? '')));
      throw new SourceError(`${this.src.name}: Linear answered: ${msg}`, null, auth);
    }
    return r?.data;
  }

  describe(): string[] {
    return [
      `Linear GraphQL at ${this.src.apiUrl} (API key, queries only)`,
      `issues(filter: {updatedAt >= <cursor>${this.src.teamKeys.length ? `, team.key in [${this.src.teamKeys.join(', ')}]` : ''}}) with identifier, createdAt, updatedAt, completedAt, canceledAt, estimate, team.key, parent.id, state, labels, cycle, history (state and cycle changes)${this.privacy.privacy.sendTitles ? ', title' : ''}${this.privacy.privacy.sendLinks ? ', url' : ''}${this.privacy.privacy.people === 'hash' ? ', assignee.id' : ''}`,
      `teams: ${Object.entries(this.src.teams).map(([k, t]) => `${k} → ${t}`).join(', ') || '(none)'}${this.src.defaultTeam ? `; default ${this.src.defaultTeam}` : ''}`,
    ];
  }

  async check(): Promise<string[]> {
    const d = await this.gql('query { organization { urlKey } teams(first: 250) { nodes { key } } }', {});
    const keys: string[] = (d?.teams?.nodes ?? []).map((t: any) => t?.key).filter(Boolean);
    const out = [`authenticated (workspace ${d?.organization?.urlKey ?? '?'}); ${keys.length} teams readable`];
    for (const k of this.src.teamKeys) out.push(keys.includes(k) ? `team ${k}: readable${this.src.teams[k] ? ` → ${this.src.teams[k]}` : ' (not mapped: defaultTeam is used)'}` : `team ${k}: NOT readable with this key`);
    return out;
  }

  private async fullHistory(id: string, first: any): Promise<any[]> {
    const nodes = [...(first?.nodes ?? [])];
    let page = first?.pageInfo;
    while (page?.hasNextPage && page.endCursor) {
      const d = await this.gql(HISTORY_QUERY, { id, after: page.endCursor });
      const h = d?.issue?.history;
      nodes.push(...(h?.nodes ?? []));
      page = h?.pageInfo;
    }
    return nodes;
  }

  async *collect(since: Date, _until: Date): AsyncIterable<Page> {
    const filter: Record<string, unknown> = { updatedAt: { gte: since.toISOString() } };
    if (this.src.teamKeys.length) filter.team = { key: { in: this.src.teamKeys } };
    const query = issuesQuery(this.privacy.privacy);
    let after: string | null = null;
    for (let page = 0; page < 100_000; page++) {
      const d = await this.gql(query, { first: this.src.pageSize, after, filter });
      const conn = d?.issues;
      const nodes: any[] = Array.isArray(conn?.nodes) ? conn.nodes : [];
      const out: Page = { records: [], skipped: [] };
      for (const n of nodes) {
        if (n?.history?.pageInfo?.hasNextPage) n.history = { nodes: await this.fullHistory(n.id, n.history) };
        const m = mapLinearIssue(n, { src: this.src, privacy: this.privacy });
        if (m.record) out.records.push({ id: m.id, record: m.record, changedAt: m.changedAt });
        else out.skipped.push({ id: m.id, reason: m.skip! });
      }
      yield out;
      if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor || nodes.length === 0) return;
      after = conn.pageInfo.endCursor;
    }
  }
}
