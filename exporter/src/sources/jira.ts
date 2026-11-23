/**
 * Jira Cloud (e-mail + API token, Basic, REST v3, /search/jql with nextPageToken) and Jira Server /
 * Data Center (Personal Access Token, Bearer, REST v2, /search with startAt).
 *
 * Read: GET myself (time zone for the JQL date only), field (to find the story points, sprint,
 * flagged and found-in fields by name, as QE Navigator does; overridable), status (status → category),
 * then the issues of "(<jql>) AND updated >= <cursor> ORDER BY updated ASC" with only the fields the
 * calculations need (fields=…; descriptions, comments, attachments and other fields are not even
 * requested) and expand=changelog; a truncated changelog is read in full (Cloud: issue/{key}/changelog,
 * Server: issue/{key}?expand=changelog).
 */
import type { JiraSource, HttpSettings } from '../config';
import { requireSecret, secret, teamFor } from '../config';
import { SourceClient, SourceError, type Adapter, type Page } from './client';
import { BLOCKED, classifyEnvironment, environmentFromLabels, hours, iso, jiraSprint, normaliseType, plainText, statusCategoryOf, type Sprint } from '../normalise';
import { maskTitle, person, type PrivacyContext } from '../privacy';

export interface JiraFields { storyPoints: string | null; sprint: string | null; environment: string | null; flagged: string | null }

const SP_DEFAULTS = ['customfield_10016', 'customfield_10026', 'customfield_10028', 'customfield_10002', 'customfield_10004', 'customfield_10106'];
const SPRINT_DEFAULTS = ['customfield_10020', 'customfield_10010', 'customfield_10007', 'customfield_10104'];

/** Field ids by name and schema, like QE Navigator's auto-detection; the config wins. */
export function detectFields(list: any[], configured: JiraFields): JiraFields & { detected: string[] } {
  const detected: string[] = [];
  const find = (pred: (f: any) => boolean) => list.find((f) => f && typeof f.id === 'string' && pred(f))?.id ?? null;
  const name = (f: any) => String(f.name ?? '').trim();
  const custom = (f: any) => String(f.schema?.custom ?? '');
  const pick = (k: keyof JiraFields, auto: string | null) => {
    if (configured[k]) { detected.push(`${k}: ${configured[k]} (from the config)`); return configured[k]; }
    if (auto) detected.push(`${k}: ${auto} (found by name)`);
    return auto;
  };
  return {
    storyPoints: pick('storyPoints', find((f) => custom(f) === 'com.pyxis.greenhopper.jira:jsw-story-points') ?? find((f) => /^story ?points?( estimate)?$/i.test(name(f)))),
    sprint: pick('sprint', find((f) => custom(f) === 'com.pyxis.greenhopper.jira:gh-sprint') ?? find((f) => /^sprints?$/i.test(name(f)))),
    environment: pick('environment', find((f) => /^(found in|environment found|found in environment|detected in)$/i.test(name(f)))),
    flagged: pick('flagged', find((f) => /^flagged$/i.test(name(f)))),
    detected,
  };
}

export interface JiraMapContext {
  src: Pick<JiraSource, 'teams' | 'defaultTeam' | 'baseUrl'>;
  fields: JiraFields;
  /** lower-cased status name → Jira status category key (new / indeterminate / done). */
  statusCategories: Map<string, string>;
  privacy: PrivacyContext;
}

const CATEGORY: Record<string, 'todo' | 'in_progress' | 'done'> = { new: 'todo', indeterminate: 'in_progress', done: 'done' };

function categoryOfStatus(name: string, ctx: JiraMapContext): string {
  if (BLOCKED.test(name)) return 'blocked';
  const k = ctx.statusCategories.get(name.toLowerCase());
  return k && CATEGORY[k] ? CATEGORY[k] : statusCategoryOf(name);
}

/** One Jira issue (search result item with changelog) → QE Navigator JSON, or the reason it is skipped. */
export function mapJiraIssue(raw: any, ctx: JiraMapContext): { id: string; record?: Record<string, unknown>; changedAt: string | null; skip?: string } {
  const key = typeof raw?.key === 'string' ? raw.key : String(raw?.id ?? '?');
  const f = raw?.fields;
  if (!f || typeof f !== 'object') return { id: key, changedAt: null, skip: 'no fields in the answer' };
  const project = f.project?.key ?? (key.includes('-') ? key.split('-')[0] : null);
  const team = teamFor(ctx.src as JiraSource, [project]);
  const changedAt = iso(f.updated);
  if (!team) return { id: key, changedAt, skip: `project ${project ?? '?'} is not mapped to a team (sources[].teams)` };
  const createdAt = iso(f.created);
  if (!createdAt) return { id: key, changedAt, skip: 'no created time' };

  const status = typeof f.status?.name === 'string' ? f.status.name : null;
  const catKey = f.status?.statusCategory?.key ?? (status ? ctx.statusCategories.get(status.toLowerCase()) : undefined);
  const statusCategory = catKey && CATEGORY[catKey] ? CATEGORY[catKey] : statusCategoryOf(status);

  const labels: string[] = Array.isArray(f.labels) ? f.labels.filter((x: unknown) => typeof x === 'string') : [];
  // Environment: the configured / found-in field, else Jira's environment field, else labels. Classified here; the text is never sent.
  const envText = (ctx.fields.environment ? plainText(f[ctx.fields.environment]) : null) ?? plainText(f.environment);
  const environment = classifyEnvironment(envText) ?? environmentFromLabels(labels);

  const spField = ctx.fields.storyPoints ?? SP_DEFAULTS.find((x) => typeof f[x] === 'number') ?? null;
  const sp = spField ? f[spField] : null;
  const sprintField = ctx.fields.sprint ?? SPRINT_DEFAULTS.find((x) => f[x] !== undefined && f[x] !== null) ?? null;
  const sprintRaw = sprintField ? f[sprintField] : null;
  const sprints = (Array.isArray(sprintRaw) ? sprintRaw : sprintRaw ? [sprintRaw] : []).map(jiraSprint).filter((s): s is Sprint => !!s);

  const transitions: Array<Record<string, unknown>> = [];
  const histories: any[] = Array.isArray(raw.changelog?.histories) ? raw.changelog.histories : [];
  const flaggedId = ctx.fields.flagged;
  for (const h of histories) {
    const at = iso(h?.created);
    if (!at || !Array.isArray(h.items)) continue;
    for (const it of h.items) {
      const field = String(it?.field ?? '').toLowerCase();
      const fieldId = String(it?.fieldId ?? '');
      if (field === 'status' || fieldId === 'status') {
        const to = typeof it.toString === 'string' ? it.toString : null;
        if (to) transitions.push({ at, field: 'status', from: typeof it.fromString === 'string' ? it.fromString : null, to, toCategory: categoryOfStatus(to, ctx) });
      } else if (field === 'sprint' || (ctx.fields.sprint && fieldId === ctx.fields.sprint)) {
        // Sprint ids ("12, 13"), not the names.
        transitions.push({ at, field: 'sprint', from: typeof it.from === 'string' ? it.from : null, to: typeof it.to === 'string' ? it.to : '' });
      } else if (field === 'flagged' || (flaggedId && fieldId === flaggedId)) {
        const on = typeof it.toString === 'string' && it.toString.trim() !== '';
        transitions.push({ at, field: 'flagged', to: on ? 'on' : 'off', toCategory: on ? 'on' : 'off' });
      }
    }
  }
  transitions.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const record: Record<string, unknown> = {
    key, team, type: normaliseType(f.issuetype?.name, !!f.issuetype?.subtask), status, statusCategory,
    resolution: typeof f.resolution?.name === 'string' ? f.resolution.name : null, environment,
    priority: typeof f.priority?.name === 'string' ? f.priority.name.slice(0, 50) : null,
    storyPoints: typeof sp === 'number' ? sp : typeof sp === 'string' && sp.trim() && Number.isFinite(Number(sp)) ? Number(sp) : null,
    estimateHours: hours(f.timeoriginalestimate), timeLoggedHours: hours(f.timespent),
    createdAt, resolvedAt: iso(f.resolutiondate), updatedAt: changedAt, sprints, transitions,
    title: ctx.privacy.privacy.sendTitles ? maskTitle(f.summary) : undefined,
    url: ctx.privacy.privacy.sendLinks ? `${ctx.src.baseUrl}/browse/${encodeURIComponent(key)}` : undefined,
    assigneeHash: person(ctx.privacy, f.assignee?.accountId ?? f.assignee?.key ?? f.assignee?.name ?? null),
  };
  return { id: key, record, changedAt };
}

/** "yyyy/MM/dd HH:mm" in the Jira user's time zone (JQL dates are read in that zone). */
export function jqlDate(d: Date, timeZone: string | null): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '00';
  return `${p('year')}/${p('month')}/${p('day')} ${p('hour')}:${p('minute')}`;
}

export class JiraAdapter implements Adapter {
  kind = 'issues' as const;
  private client: SourceClient;
  private v: '2' | '3';
  private fields: JiraFields | null = null;
  private statusCategories = new Map<string, string>();
  private timeZone: string | null = null;
  private findings: string[] = [];

  constructor(private src: JiraSource, http: HttpSettings, private privacy: PrivacyContext, env: NodeJS.ProcessEnv = process.env) {
    const token = requireSecret(src.tokenEnv, `sources.${src.name}`, env);
    let auth: string;
    if (src.deployment === 'cloud') {
      const email = src.email ?? secret(src.emailEnv, env);
      if (!email) throw new SourceError(`sources.${src.name}: Jira Cloud needs the e-mail of the API token's account (email: in the config or ${src.emailEnv})`);
      auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
    } else {
      auth = `Bearer ${token}`;
    }
    this.v = src.deployment === 'cloud' ? '3' : '2';
    this.client = new SourceClient({
      source: src.name, baseUrl: src.baseUrl, headers: { Authorization: auth }, caFile: src.caFile, http,
      authHint: 'The account needs "Browse projects" on the projects of the JQL (read-only; no other permission is used).',
    });
  }

  requests() { return this.client.requests; }

  private fieldList(): string[] {
    const f = this.fields!;
    const list = ['issuetype', 'status', 'resolution', 'resolutiondate', 'created', 'updated', 'project', 'labels', 'environment', 'timeoriginalestimate', 'timespent', 'priority'];
    for (const x of [f.storyPoints, f.sprint, f.environment, f.flagged]) if (x) list.push(x);
    if (!f.storyPoints) list.push(...SP_DEFAULTS);
    if (!f.sprint) list.push(...SPRINT_DEFAULTS);
    if (this.privacy.privacy.sendTitles) list.push('summary');
    if (this.privacy.privacy.people === 'hash') list.push('assignee');
    return Array.from(new Set(list));
  }

  describe(): string[] {
    const api = `/rest/api/${this.v}`;
    return [
      `Jira ${this.src.deployment === 'cloud' ? 'Cloud' : 'Server / Data Center'} at ${this.src.baseUrl} (${this.src.deployment === 'cloud' ? 'e-mail + API token' : 'Personal Access Token'})`,
      `GET ${api}/myself (time zone only), ${api}/field, ${api}/status`,
      `GET ${api}/${this.src.deployment === 'cloud' ? 'search/jql' : 'search'} jql=(${this.src.jql}) AND updated >= <cursor> ORDER BY updated ASC, expand=changelog`,
      `fields: ${this.fields ? this.fieldList().join(', ') : 'issuetype, status, resolution, resolutiondate, created, updated, project, labels, environment, timeoriginalestimate, timespent, priority, <story points>, <sprint>, <found in>, <flagged>' + (this.privacy.privacy.sendTitles ? ', summary' : '') + (this.privacy.privacy.people === 'hash' ? ', assignee' : '')}`,
      `teams: ${Object.entries(this.src.teams).map(([k, t]) => `${k} → ${t}`).join(', ') || '(none)'}${this.src.defaultTeam ? `; default ${this.src.defaultTeam}` : ''}`,
    ];
  }

  private async init(): Promise<void> {
    if (this.fields) return;
    const api = `/rest/api/${this.v}`;
    const me = await this.client.get(`${api}/myself`);
    this.timeZone = typeof me?.timeZone === 'string' ? me.timeZone : null;
    const fieldList = await this.client.get<any[]>(`${api}/field`);
    const det = detectFields(Array.isArray(fieldList) ? fieldList : [], this.src.fields);
    this.fields = { storyPoints: det.storyPoints, sprint: det.sprint, environment: det.environment, flagged: det.flagged };
    this.findings = det.detected;
    const statuses = await this.client.get<any[]>(`${api}/status`);
    for (const s of Array.isArray(statuses) ? statuses : []) {
      if (typeof s?.name === 'string' && s.statusCategory?.key && !this.statusCategories.has(s.name.toLowerCase())) this.statusCategories.set(s.name.toLowerCase(), s.statusCategory.key);
    }
  }

  async check(): Promise<string[]> {
    await this.init();
    const out = [`authenticated; JQL dates in time zone ${this.timeZone ?? 'UTC'}`, ...this.findings];
    if (!this.fields!.storyPoints) out.push('storyPoints: not found by name; customfield_10016 / 10026 / 10028 / 10002 / 10004 are tried per issue (set fields.storyPoints to be sure)');
    if (!this.fields!.sprint) out.push('sprint: not found by name; customfield_10020 / 10010 / 10007 are tried (set fields.sprint)');
    out.push(`${this.statusCategories.size} statuses with their categories`);
    const jql = `(${this.src.jql})`;
    if (this.v === '3') {
      const r = await this.client.postQuery(`/rest/api/3/search/approximate-count`, { jql }).catch(() => null);
      if (r && typeof r.count === 'number') out.push(`JQL matches about ${r.count} issues in total`);
    } else {
      const r = await this.client.get(`/rest/api/2/search`, { jql, maxResults: 0 });
      if (typeof r?.total === 'number') out.push(`JQL matches ${r.total} issues in total`);
    }
    return out;
  }

  private async fullChangelog(key: string): Promise<any[]> {
    if (this.v === '3') {
      const out: any[] = [];
      for (let startAt = 0; ;) {
        const r = await this.client.get(`/rest/api/3/issue/${encodeURIComponent(key)}/changelog`, { startAt, maxResults: 100 });
        const values: any[] = Array.isArray(r?.values) ? r.values : [];
        out.push(...values);
        startAt += values.length;
        if (r?.isLast === true || values.length === 0 || (typeof r?.total === 'number' && startAt >= r.total)) break;
      }
      return out;
    }
    const r = await this.client.get(`/rest/api/2/issue/${encodeURIComponent(key)}`, { expand: 'changelog', fields: 'created' });
    return Array.isArray(r?.changelog?.histories) ? r.changelog.histories : [];
  }

  async *collect(since: Date, _until: Date): AsyncIterable<Page> {
    await this.init();
    const jql = `(${this.src.jql}) AND updated >= "${jqlDate(since, this.timeZone)}" ORDER BY updated ASC, key ASC`;
    const fields = this.fieldList().join(',');
    const ctx: JiraMapContext = { src: this.src, fields: this.fields!, statusCategories: this.statusCategories, privacy: this.privacy };
    let token: string | undefined;
    let startAt = 0;
    for (let page = 0; page < 100_000; page++) {
      const r = this.v === '3'
        ? await this.client.get('/rest/api/3/search/jql', { jql, fields, expand: 'changelog', maxResults: this.src.pageSize, nextPageToken: token })
        : await this.client.get('/rest/api/2/search', { jql, fields, expand: 'changelog', maxResults: this.src.pageSize, startAt });
      const issues: any[] = Array.isArray(r?.issues) ? r.issues : [];
      const out: Page = { records: [], skipped: [] };
      for (const issue of issues) {
        const cl = issue.changelog;
        if (cl && Array.isArray(cl.histories) && typeof cl.total === 'number' && cl.total > cl.histories.length) {
          issue.changelog = { histories: await this.fullChangelog(issue.key) };
        }
        const m = mapJiraIssue(issue, ctx);
        if (m.record) out.records.push({ id: m.id, record: m.record, changedAt: m.changedAt });
        else out.skipped.push({ id: m.id, reason: m.skip! });
      }
      yield out;
      if (this.v === '3') {
        token = typeof r?.nextPageToken === 'string' && r.nextPageToken ? r.nextPageToken : undefined;
        if (!token || r?.isLast === true || issues.length === 0) return;
      } else {
        startAt += issues.length;
        if (issues.length === 0 || (typeof r?.total === 'number' && startAt >= r.total)) return;
      }
    }
  }
}
