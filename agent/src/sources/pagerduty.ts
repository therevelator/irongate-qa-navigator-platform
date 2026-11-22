/**
 * PagerDuty (REST API key, read-only).
 *
 * Read: GET /log_entries?since=<cursor>&until=<now>&is_overview=true&include[]=incidents in windows of
 * at most 7 days (PagerDuty pages up to 10,000 entries per query; a fuller window is split). The
 * trigger / acknowledge / resolve entries give the times; the included incident gives its service,
 * priority / urgency, creation time and current status. Notes, alert bodies and responders' names
 * are not read into the output.
 */
import type { HttpSettings, PagerDutySource } from '../config';
import { requireSecret } from '../config';
import { SourceClient, type Adapter, type Page } from './client';
import { iso, severityOf } from '../normalise';
import { maskTitle, person, type PrivacyContext } from '../privacy';

const STATUS_OF_ENTRY: Record<string, 'open' | 'acknowledged' | 'resolved'> = {
  trigger_log_entry: 'open', acknowledge_log_entry: 'acknowledged', unacknowledge_log_entry: 'open', resolve_log_entry: 'resolved', reopen_log_entry: 'open',
};
const STATUS: Record<string, 'open' | 'acknowledged' | 'resolved'> = { triggered: 'open', acknowledged: 'acknowledged', resolved: 'resolved' };

export interface PdMapContext { src: Pick<PagerDutySource, 'teams' | 'services' | 'categories' | 'defaultTeam' | 'serviceIds'>; privacy: PrivacyContext }

/** The incidents named by a list of log entries (with included incidents) → QE Navigator JSON, one per incident. */
export function mapPagerDutyEntries(entries: any[], ctx: PdMapContext): Page {
  const by = new Map<string, { incident: any; entries: any[] }>();
  for (const e of entries) {
    const inc = e?.incident;
    if (!inc?.id || !STATUS_OF_ENTRY[e.type]) continue;
    const cur = by.get(inc.id) ?? { incident: inc, entries: [] };
    // Prefer the included (full) incident over a bare reference.
    if (inc.created_at && !cur.incident.created_at) cur.incident = inc;
    cur.entries.push(e);
    by.set(inc.id, cur);
  }
  const page: Page = { records: [], skipped: [] };
  for (const [id, { incident: i, entries: es }] of by) {
    const serviceName: string | null = i.service?.summary ?? i.service?.name ?? null;
    const serviceId: string | null = i.service?.id ?? null;
    if (ctx.src.serviceIds.length && !(serviceId && ctx.src.serviceIds.includes(serviceId))) continue;
    const pdTeams: string[] = (Array.isArray(i.teams) ? i.teams : []).map((t: any) => t?.summary ?? t?.name).filter(Boolean);
    const team = (serviceName && ctx.src.services[serviceName]) || (serviceId && ctx.src.services[serviceId]) || pdTeams.map((t) => ctx.src.teams[t]).find(Boolean) || ctx.src.defaultTeam;
    const sorted = es.map((e) => ({ s: STATUS_OF_ENTRY[e.type], at: iso(e.created_at), agent: e.agent })).filter((u) => u.at).sort((a, b) => a.at!.localeCompare(b.at!));
    const last = sorted[sorted.length - 1];
    if (!team) { page.skipped.push({ id, reason: `service ${serviceName ?? serviceId ?? '?'} is not mapped to a team (sources[].services)` }); continue; }
    const openedAt = iso(i.created_at) ?? sorted.find((u) => u.s === 'open')?.at ?? null;
    if (!openedAt) { page.skipped.push({ id, reason: 'no creation time' }); continue; }
    const status = STATUS[String(i.status ?? '')] ?? last?.s ?? null;
    const firstAck = sorted.find((u) => u.s === 'acknowledged');
    const lastResolve = [...sorted].reverse().find((u) => u.s === 'resolved');
    const priority = i.priority?.summary ?? i.priority?.name ?? null;
    const severity = severityOf(priority) ?? (i.urgency === 'high' ? 'high' : i.urgency === 'low' ? 'low' : null);
    const record: Record<string, unknown> = {
      id, team, service: serviceName ?? serviceId, severity, status, at: last?.at ?? null, openedAt,
      acknowledgedAt: firstAck?.at ?? null,
      resolvedAt: status === 'resolved' ? iso(i.resolved_at) ?? lastResolve?.at ?? iso(i.last_status_change_at) : null,
      updates: sorted.map((u) => ({ status: u.s, at: u.at })),
      deploymentId: i.metadata?.deployment_id ?? null,
      category: serviceName ? ctx.src.categories[serviceName] ?? null : null,
      title: ctx.privacy.privacy.sendTitles ? maskTitle(i.title ?? i.summary) : undefined,
      url: ctx.privacy.privacy.sendLinks ? i.html_url : undefined,
      responderHash: person(ctx.privacy, firstAck?.agent?.type === 'user_reference' ? firstAck.agent.id : null),
    };
    page.records.push({ id, record, changedAt: last?.at ?? null });
  }
  return page;
}

const WINDOW_MS = 7 * 86_400_000;
const MAX_OFFSET = 9_900;

export class PagerDutyAdapter implements Adapter {
  kind = 'incidents' as const;
  private client: SourceClient;

  constructor(private src: PagerDutySource, http: HttpSettings, private privacy: PrivacyContext, env: NodeJS.ProcessEnv = process.env) {
    const token = requireSecret(src.tokenEnv, `sources.${src.name}`, env);
    this.client = new SourceClient({
      source: src.name, baseUrl: src.apiUrl, headers: { Authorization: `Token token=${token}`, Accept: 'application/vnd.pagerduty+json;version=2' }, caFile: src.caFile, http,
      authHint: 'Use a read-only REST API key (Integrations → API Access Keys → "Read-only API Key") or a user token of a user who can see the services.',
    });
  }

  requests() { return this.client.requests; }

  describe(): string[] {
    return [
      `PagerDuty REST API at ${this.src.apiUrl} (read-only API key)`,
      'GET /log_entries?since=<cursor>&until=<now>&is_overview=true&include[]=incidents (trigger, acknowledge, resolve entries and their incidents); GET /incidents/{id}/log_entries for incidents opened before the window',
      `services: ${Object.entries(this.src.services).map(([k, t]) => `${k} → ${t}`).join(', ') || '(none)'}; teams: ${Object.entries(this.src.teams).map(([k, t]) => `${k} → ${t}`).join(', ') || '(none)'}${this.src.defaultTeam ? `; default ${this.src.defaultTeam}` : ''}`,
    ];
  }

  async check(): Promise<string[]> {
    const out: string[] = [];
    const names: string[] = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const r = await this.client.get('/services', { limit: 100, offset });
      for (const s of r?.services ?? []) names.push(`${s.summary ?? s.name} (${s.id})`);
      if (!r?.more) break;
    }
    out.push(`authenticated; ${names.length} services readable`);
    for (const s of Object.keys(this.src.services)) out.push(names.some((n) => n.startsWith(`${s} (`) || n.endsWith(`(${s})`)) ? `service ${s}: readable → ${this.src.services[s]}` : `service ${s}: NOT found among the readable services`);
    const unmapped = names.filter((n) => !Object.keys(this.src.services).some((s) => n.startsWith(`${s} (`) || n.endsWith(`(${s})`)));
    if (unmapped.length && !this.src.defaultTeam) out.push(`not mapped (their incidents are skipped): ${unmapped.slice(0, 20).join(', ')}${unmapped.length > 20 ? ', …' : ''}`);
    return out;
  }

  /** The log entries of [since, until), split in halves while a query would pass PagerDuty's offset limit. */
  private async window(since: Date, until: Date, into: any[]): Promise<void> {
    const entries: any[] = [];
    for (let offset = 0; ; offset += 100) {
      if (offset > MAX_OFFSET && until.getTime() - since.getTime() > 3600_000) {
        const mid = new Date(since.getTime() + Math.floor((until.getTime() - since.getTime()) / 2));
        await this.window(since, mid, into);
        await this.window(mid, until, into);
        return;
      }
      const r = await this.client.get('/log_entries', {
        since: since.toISOString(), until: until.toISOString(), is_overview: true, 'include[]': ['incidents'], limit: 100, offset, time_zone: 'UTC',
      });
      const list: any[] = Array.isArray(r?.log_entries) ? r.log_entries : [];
      entries.push(...list);
      if (!r?.more || list.length === 0) break;
    }
    into.push(...entries);
  }

  async *collect(since: Date, until: Date): AsyncIterable<Page> {
    // All windows first: an incident whose entries span two windows becomes one record.
    const entries: any[] = [];
    for (let t = since.getTime(); t < until.getTime(); t += WINDOW_MS) {
      await this.window(new Date(t), new Date(Math.min(until.getTime(), t + WINDOW_MS)), entries);
    }
    // An incident opened before the window: read its own log, so every record is complete (and the
    // same on a re-run, which then sends nothing).
    const older = new Map<string, any>();
    for (const e of entries) {
      const i = e?.incident;
      if (i?.id && i.created_at && Date.parse(i.created_at) < since.getTime() && !older.has(i.id)) older.set(i.id, i);
    }
    const all = entries.filter((e) => !older.has(e?.incident?.id));
    for (const [id, incident] of older) {
      for (let offset = 0; offset <= MAX_OFFSET; offset += 100) {
        const r = await this.client.get(`/incidents/${encodeURIComponent(id)}/log_entries`, { is_overview: true, limit: 100, offset, time_zone: 'UTC' });
        const list: any[] = Array.isArray(r?.log_entries) ? r.log_entries : [];
        for (const e of list) all.push({ ...e, incident });
        if (!r?.more || list.length === 0) break;
      }
    }
    const seen = new Set<string>();
    const unique = all.filter((e) => (e?.id ? (seen.has(e.id) ? false : (seen.add(e.id), true)) : true));
    yield mapPagerDutyEntries(unique, { src: this.src, privacy: this.privacy });
  }
}
