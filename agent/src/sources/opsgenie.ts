/**
 * Opsgenie (API key of an API integration with Read access; US api.opsgenie.com or EU api.eu.opsgenie.com).
 *
 * Read: GET /v2/teams (team id → name, for the team mapping), then GET /v2/alerts with
 * query "updatedAt >= <cursor ms>" sorted by updatedAt ascending (offset paging; past Opsgenie's
 * 20,000 offset limit the query restarts from the last updatedAt). Times come from the alert
 * (createdAt, report.ackTime, report.closeTime). The alert message is read only with sendTitles;
 * descriptions, notes, details and responder names are not sent (the acknowledger only as a salted
 * hash with privacy.people = hash).
 */
import type { HttpSettings, OpsgenieSource } from '../config';
import { requireSecret } from '../config';
import { SourceClient, SourceError, type Adapter, type Page } from './client';
import { iso, severityOf } from '../normalise';
import { maskTitle, person, type PrivacyContext } from '../privacy';

export interface OgMapContext { src: Pick<OpsgenieSource, 'teams' | 'services' | 'categories' | 'defaultTeam'>; teamNames: Map<string, string>; privacy: PrivacyContext }

const tag = (tags: string[], name: string): string | null => {
  const t = tags.find((x) => new RegExp(`^${name}[:=]`, 'i').test(x));
  return t ? t.slice(t.search(/[:=]/) + 1).trim() || null : null;
};

/** One Opsgenie alert (list item) → QE Navigator JSON, or the reason it is skipped. */
export function mapOpsgenieAlert(a: any, ctx: OgMapContext): { id: string; record?: Record<string, unknown>; changedAt: string | null; skip?: string } {
  const id = String(a?.id ?? '?');
  const tags: string[] = Array.isArray(a?.tags) ? a.tags.filter((t: unknown) => typeof t === 'string') : [];
  const service = tag(tags, 'service') ?? (typeof a?.details?.service === 'string' ? a.details.service : null) ?? (typeof a?.entity === 'string' && a.entity ? a.entity : null);
  const ogTeams: string[] = (Array.isArray(a?.teams) ? a.teams : []).map((t: any) => t?.id).filter(Boolean);
  const team = (service && ctx.src.services[service]) || ogTeams.map((t) => ctx.src.teams[ctx.teamNames.get(t) ?? ''] ?? ctx.src.teams[t]).find(Boolean) || ctx.src.defaultTeam;
  const changedAt = iso(a?.updatedAt);
  if (!team) return { id, changedAt, skip: `alert of ${service ? `service ${service}` : `team ${ogTeams.map((t) => ctx.teamNames.get(t) ?? t).join(', ') || '?'}`} is not mapped to a team (sources[].teams / services)` };
  const openedAt = iso(a.createdAt);
  if (!openedAt) return { id, changedAt, skip: 'no creation time' };
  const created = Date.parse(openedAt);
  const ackMs = Number(a.report?.ackTime);
  const closeMs = Number(a.report?.closeTime);
  const closed = String(a.status ?? '').toLowerCase() === 'closed';
  const acknowledgedAt = Number.isFinite(ackMs) && ackMs > 0 ? new Date(created + ackMs).toISOString() : null;
  const resolvedAt = closed ? (Number.isFinite(closeMs) && closeMs > 0 ? new Date(created + closeMs).toISOString() : changedAt) : null;
  const record: Record<string, unknown> = {
    id, team, service, severity: severityOf(a.priority), status: closed ? 'resolved' : a.acknowledged ? 'acknowledged' : 'open', at: changedAt,
    openedAt, acknowledgedAt, resolvedAt,
    deploymentId: tag(tags, 'deployment') ?? tag(tags, 'deploy'),
    category: tag(tags, 'category')?.toLowerCase() ?? (service ? ctx.src.categories[service] ?? null : null),
    title: ctx.privacy.privacy.sendTitles ? maskTitle(a.message) : undefined,
    responderHash: person(ctx.privacy, typeof a.report?.acknowledgedBy === 'string' ? a.report.acknowledgedBy : null),
  };
  return { id, record, changedAt };
}

const MAX_OFFSET = 20_000;

export class OpsgenieAdapter implements Adapter {
  kind = 'incidents' as const;
  private client: SourceClient;
  private teamNames: Map<string, string> | null = null;
  private teamNote = '';

  constructor(private src: OpsgenieSource, http: HttpSettings, private privacy: PrivacyContext, env: NodeJS.ProcessEnv = process.env) {
    const key = requireSecret(src.tokenEnv, `sources.${src.name}`, env);
    this.client = new SourceClient({
      source: src.name, baseUrl: src.apiUrl, headers: { Authorization: `GenieKey ${key}` }, caFile: src.caFile, http,
      authHint: `Use the key of an API integration with "Read" access only (Settings → Integrations → API); EU accounts need region: eu (${src.region === 'eu' ? 'set' : 'currently us'}).`,
    });
  }

  requests() { return this.client.requests; }

  describe(): string[] {
    return [
      `Opsgenie REST API at ${this.src.apiUrl} (API key, read access)`,
      `GET /v2/teams; GET /v2/alerts?query=updatedAt>=<cursor>${this.src.query ? ` AND (${this.src.query})` : ''}&sort=updatedAt&order=asc`,
      `teams: ${Object.entries(this.src.teams).map(([k, t]) => `${k} → ${t}`).join(', ') || '(none)'}; services (tag service:<name>): ${Object.entries(this.src.services).map(([k, t]) => `${k} → ${t}`).join(', ') || '(none)'}${this.src.defaultTeam ? `; default ${this.src.defaultTeam}` : ''}`,
    ];
  }

  private async teams(): Promise<Map<string, string>> {
    if (this.teamNames) return this.teamNames;
    this.teamNames = new Map();
    try {
      const r = await this.client.get('/v2/teams');
      for (const t of r?.data ?? []) if (t?.id && t?.name) this.teamNames.set(t.id, t.name);
      this.teamNote = `${this.teamNames.size} teams readable`;
    } catch (e) {
      if (!(e instanceof SourceError) || !e.auth) throw e;
      this.teamNote = 'the key cannot list teams (map teams by Opsgenie team id instead of name, or use services)';
    }
    return this.teamNames;
  }

  async check(): Promise<string[]> {
    const names = await this.teams();
    await this.client.get('/v2/alerts', { limit: 1 });
    const out = [`authenticated; alerts readable; ${this.teamNote}`];
    const known = new Set([...names.values(), ...names.keys()]);
    for (const t of Object.keys(this.src.teams)) out.push(known.has(t) ? `team ${t}: found → ${this.src.teams[t]}` : `team ${t}: NOT found among the readable teams`);
    return out;
  }

  async *collect(since: Date, until: Date): AsyncIterable<Page> {
    const teamNames = await this.teams();
    let from = since.getTime();
    const extra = this.src.query ? ` AND (${this.src.query})` : '';
    for (let round = 0; round < 1000; round++) {
      let lastUpdated = from;
      let full = false;
      for (let offset = 0; offset + 100 <= MAX_OFFSET; offset += 100) {
        const r = await this.client.get('/v2/alerts', { query: `updatedAt >= ${from} AND updatedAt <= ${until.getTime()}${extra}`, sort: 'updatedAt', order: 'asc', limit: 100, offset });
        const data: any[] = Array.isArray(r?.data) ? r.data : [];
        const page: Page = { records: [], skipped: [] };
        for (const a of data) {
          const m = mapOpsgenieAlert(a, { src: this.src, teamNames, privacy: this.privacy });
          if (m.record) page.records.push({ id: m.id, record: m.record, changedAt: m.changedAt });
          else page.skipped.push({ id: m.id, reason: m.skip! });
          const u = Date.parse(a?.updatedAt ?? '');
          if (Number.isFinite(u) && u > lastUpdated) lastUpdated = u;
        }
        yield page;
        if (data.length < 100) return;
        full = offset + 200 > MAX_OFFSET;
      }
      if (!full || lastUpdated <= from) return;
      from = lastUpdated;
    }
  }
}
