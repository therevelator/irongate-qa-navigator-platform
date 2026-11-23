/**
 * Raw store writes of phase 2 (migration 20261130000000): deployments, commits and incidents, inside
 * the caller's transaction. Idempotent by event id:
 *   deployments  team + deployment id: the same event again writes nothing ("duplicate"); a changed
 *                event (e.g. the result became rolled_back) updates the row ("updated")
 *   commits      team + sha + deployment id ('' for a push): a commit already stored is a duplicate,
 *                times sent later fill the gaps
 *   incidents    team + incident id: created by the first event, updated by the next ones (status
 *                stream: acknowledged, resolved, reopened); every status change is kept in incident_updates
 * Each function returns, per event, its status and the days whose metrics depend on it.
 */
import type pg from 'pg';
import { sha256 } from './store';
import { ReportError } from './testReports';
import { authorHash, type CommitBatch, type CommitEvent, type DeploymentEvent, type IncidentEvent, type IncidentStatus } from './deliveryEvents';

export type EventStatus = 'written' | 'updated' | 'duplicate';
export interface StoredEvent { id: string; team: string; status: EventStatus; days: string[] }

const dayOf = (d: Date | string | number) => new Date(d).toISOString().slice(0, 10);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

async function insertCommits(client: pg.PoolClient, companyId: string, teamId: string, uploadId: string | null, deployment: string, branch: string | null, commits: CommitEvent[], sample = false): Promise<{ written: number; updated: number }> {
  let written = 0;
  let updated = 0;
  const seen = new Set<string>();
  const list = commits.filter((c) => (seen.has(c.sha) ? false : (seen.add(c.sha), true)));
  const CHUNK = 1000;
  for (let i = 0; i < list.length; i += CHUNK) {
    const part = list.slice(i, i + CHUNK);
    const r = await client.query(
      `INSERT INTO deployment_commits (company_id, team_id, upload_id, deployment_external_id, sha, authored_at, committed_at, author_hash, branch, is_sample)
       SELECT $1, $2, $3, $4, x.sha, x.a, x.c, x.h, $5, $6
         FROM unnest($7::text[], $8::timestamptz[], $9::timestamptz[], $10::text[]) AS x(sha, a, c, h)
       ON CONFLICT (team_id, sha, deployment_external_id) DO UPDATE
         SET authored_at = COALESCE(EXCLUDED.authored_at, deployment_commits.authored_at),
             committed_at = COALESCE(EXCLUDED.committed_at, deployment_commits.committed_at),
             author_hash = COALESCE(EXCLUDED.author_hash, deployment_commits.author_hash),
             branch = COALESCE(deployment_commits.branch, EXCLUDED.branch)
         WHERE (EXCLUDED.authored_at IS NOT NULL AND deployment_commits.authored_at IS DISTINCT FROM EXCLUDED.authored_at)
            OR (EXCLUDED.committed_at IS NOT NULL AND deployment_commits.committed_at IS DISTINCT FROM EXCLUDED.committed_at)
            OR (EXCLUDED.author_hash IS NOT NULL AND deployment_commits.author_hash IS DISTINCT FROM EXCLUDED.author_hash)
       RETURNING (xmax = 0) AS inserted`,
      [companyId, teamId, uploadId, deployment, branch, sample, part.map((c) => c.sha), part.map((c) => iso(c.authoredAt)), part.map((c) => iso(c.committedAt)),
        part.map((c) => c.authorHash ?? (c.author ? authorHash(companyId, c.author) : null))]
    );
    for (const row of r.rows) (row.inserted ? written++ : updated++);
  }
  return { written, updated };
}

/** Deployments one at a time (the same deployment more than once in a request: each event sees the one before it). */
async function storeDeploymentsOneByOne(client: pg.PoolClient, companyId: string, events: DeploymentEvent[], teamOf: (e: DeploymentEvent) => string, uploadOf: (team: string) => string | null): Promise<StoredEvent[]> {
  const out: StoredEvent[] = [];
  for (const e of events) {
    const team = teamOf(e);
    const shas = Array.from(new Set([e.commit, ...e.commits.map((c) => c.sha)].filter(Boolean)));
    const hash = sha256(JSON.stringify([e.environment, e.production, e.service, e.commit, shas, e.commitFrom, iso(e.startedAt), iso(e.finishedAt), e.result, e.rollbackOf, e.hotfix, e.url]));
    const prev = (await client.query('SELECT day FROM deployments_raw WHERE team_id = $1 AND external_id = $2', [team, e.id])).rows[0];
    const r = await client.query(
      `INSERT INTO deployments_raw (company_id, team_id, upload_id, external_id, environment, is_production, service, commit_sha, commit_shas, commit_from,
                                    started_at, finished_at, day, result, rollback_of, is_hotfix, url, event_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::varchar[], $10, $11::timestamptz, $12::timestamptz, $13::date, $14, $15, $16, $17, $18)
       ON CONFLICT (team_id, external_id) DO UPDATE SET upload_id = EXCLUDED.upload_id, environment = EXCLUDED.environment, is_production = EXCLUDED.is_production,
         service = EXCLUDED.service, commit_sha = EXCLUDED.commit_sha, commit_shas = EXCLUDED.commit_shas, commit_from = EXCLUDED.commit_from,
         started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at, day = EXCLUDED.day, result = EXCLUDED.result, rollback_of = EXCLUDED.rollback_of,
         is_hotfix = EXCLUDED.is_hotfix, url = EXCLUDED.url, event_hash = EXCLUDED.event_hash, is_sample = false, updated_at = now()
       WHERE deployments_raw.event_hash IS DISTINCT FROM EXCLUDED.event_hash
       RETURNING id`,
      [companyId, team, uploadOf(team), e.id, e.environment, e.production, e.service, e.commit, shas, e.commitFrom, iso(e.startedAt), iso(e.finishedAt),
        dayOf(e.finishedAt), e.result, e.rollbackOf, e.hotfix, e.url, hash]
    );
    const commits = e.commits.length ? await insertCommits(client, companyId, team, uploadOf(team), e.id, null, e.commits) : { written: 0, updated: 0 };
    const changed = r.rows.length > 0 || commits.written + commits.updated > 0;
    const days = new Set<string>([dayOf(e.finishedAt)]);
    if (prev) days.add(typeof prev.day === 'string' ? prev.day.slice(0, 10) : dayOf(prev.day));
    out.push({ id: e.id, team, status: !changed ? 'duplicate' : prev ? 'updated' : 'written', days: changed ? Array.from(days) : [] });
  }
  return out;
}

/**
 * Deployments: insert or update by team + id. `teamOf` resolves each event's team (already checked). Multi-row: the
 * stored days in one query, every deployment in one upsert and their commits in one insert (per 2,000 commits).
 * A request that names the same deployment twice is stored one event at a time, so the second sees the first.
 */
export async function storeDeployments(client: pg.PoolClient, companyId: string, events: DeploymentEvent[], teamOf: (e: DeploymentEvent) => string, uploadOf: (team: string) => string | null): Promise<StoredEvent[]> {
  if (!events.length) return [];
  const keyOf = (team: string, id: string) => `${team}\u0000${id}`;
  const keys = events.map((e) => keyOf(teamOf(e), e.id));
  if (new Set(keys).size !== keys.length) return storeDeploymentsOneByOne(client, companyId, events, teamOf, uploadOf);
  const rows = events.map((e, o) => {
    const team = teamOf(e);
    const shas = Array.from(new Set([e.commit, ...e.commits.map((c) => c.sha)].filter(Boolean)));
    const hash = sha256(JSON.stringify([e.environment, e.production, e.service, e.commit, shas, e.commitFrom, iso(e.startedAt), iso(e.finishedAt), e.result, e.rollbackOf, e.hotfix, e.url]));
    return {
      o, team, upload: uploadOf(team), ext: e.id, env: e.environment, prod: e.production, service: e.service, sha: e.commit, shas, cfrom: e.commitFrom,
      st: iso(e.startedAt), fi: iso(e.finishedAt), day: dayOf(e.finishedAt), result: e.result, rb: e.rollbackOf, hotfix: e.hotfix, url: e.url, hash,
    };
  });
  const prev = new Map<string, string>((await client.query(
    `SELECT d.team_id, d.external_id, to_char(d.day, 'YYYY-MM-DD') AS day FROM deployments_raw d JOIN unnest($1::text[], $2::text[]) AS x(t, e) ON d.team_id = x.t AND d.external_id = x.e`,
    [rows.map((r) => r.team), rows.map((r) => r.ext)])).rows.map((r: any) => [keyOf(r.team_id, r.external_id), r.day]));
  const upserted = new Set<string>((await client.query(
    `INSERT INTO deployments_raw (company_id, team_id, upload_id, external_id, environment, is_production, service, commit_sha, commit_shas, commit_from,
                                  started_at, finished_at, day, result, rollback_of, is_hotfix, url, event_hash)
     SELECT $1, x.team, x.upload, x.ext, x.env, x.prod, x.service, x.sha, x.shas::varchar[], x.cfrom, x.st, x.fi, x.day, x.result, x.rb, x.hotfix, x.url, x.hash
       FROM jsonb_to_recordset($2::jsonb) AS x(o int, team text, upload text, ext text, env text, prod boolean, service text, sha text, shas text[], cfrom text,
            st timestamptz, fi timestamptz, day date, result text, rb text, hotfix boolean, url text, hash text)
      ORDER BY x.o
     ON CONFLICT (team_id, external_id) DO UPDATE SET upload_id = EXCLUDED.upload_id, environment = EXCLUDED.environment, is_production = EXCLUDED.is_production,
       service = EXCLUDED.service, commit_sha = EXCLUDED.commit_sha, commit_shas = EXCLUDED.commit_shas, commit_from = EXCLUDED.commit_from,
       started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at, day = EXCLUDED.day, result = EXCLUDED.result, rollback_of = EXCLUDED.rollback_of,
       is_hotfix = EXCLUDED.is_hotfix, url = EXCLUDED.url, event_hash = EXCLUDED.event_hash, is_sample = false, updated_at = now()
     WHERE deployments_raw.event_hash IS DISTINCT FROM EXCLUDED.event_hash
     RETURNING team_id, external_id`,
    [companyId, JSON.stringify(rows)])).rows.map((r: any) => keyOf(r.team_id, r.external_id)));
  // The commits of every deployment (each deployment's list without repeated SHAs, as insertCommits).
  const commitRows = events.flatMap((e) => {
    const team = teamOf(e);
    const seen = new Set<string>();
    return e.commits.filter((c) => (seen.has(c.sha) ? false : (seen.add(c.sha), true))).map((c) => ({
      team, upload: uploadOf(team), dep: e.id, sha: c.sha, a: iso(c.authoredAt), c: iso(c.committedAt), h: c.authorHash ?? (c.author ? authorHash(companyId, c.author) : null),
    }));
  });
  const touched = new Set<string>();
  const CHUNK = 2000;
  for (let i = 0; i < commitRows.length; i += CHUNK) {
    const r = await client.query(
      `INSERT INTO deployment_commits (company_id, team_id, upload_id, deployment_external_id, sha, authored_at, committed_at, author_hash, branch, is_sample)
       SELECT $1, x.team, x.upload, x.dep, x.sha, x.a, x.c, x.h, NULL, false
         FROM jsonb_to_recordset($2::jsonb) AS x(team text, upload text, dep text, sha text, a timestamptz, c timestamptz, h text)
       ON CONFLICT (team_id, sha, deployment_external_id) DO UPDATE
         SET authored_at = COALESCE(EXCLUDED.authored_at, deployment_commits.authored_at),
             committed_at = COALESCE(EXCLUDED.committed_at, deployment_commits.committed_at),
             author_hash = COALESCE(EXCLUDED.author_hash, deployment_commits.author_hash),
             branch = COALESCE(deployment_commits.branch, EXCLUDED.branch)
         WHERE (EXCLUDED.authored_at IS NOT NULL AND deployment_commits.authored_at IS DISTINCT FROM EXCLUDED.authored_at)
            OR (EXCLUDED.committed_at IS NOT NULL AND deployment_commits.committed_at IS DISTINCT FROM EXCLUDED.committed_at)
            OR (EXCLUDED.author_hash IS NOT NULL AND deployment_commits.author_hash IS DISTINCT FROM EXCLUDED.author_hash)
       RETURNING team_id, deployment_external_id`,
      [companyId, JSON.stringify(commitRows.slice(i, i + CHUNK))]);
    for (const x of r.rows) touched.add(keyOf(x.team_id, x.deployment_external_id));
  }
  return events.map((e, i) => {
    const k = keys[i];
    const changed = upserted.has(k) || touched.has(k);
    const days = new Set<string>([dayOf(e.finishedAt)]);
    const before = prev.get(k);
    if (before) days.add(before);
    return { id: e.id, team: teamOf(e), status: !changed ? 'duplicate' : before ? 'updated' : 'written', days: changed ? Array.from(days) : [] };
  });
}

/** Commits of deployments or pushes. A commit already stored for the same deployment is a duplicate. */
export async function storeCommitBatches(client: pg.PoolClient, companyId: string, batches: CommitBatch[], teamOf: (b: CommitBatch) => string, uploadOf: (team: string) => string | null): Promise<Array<StoredEvent & { commits: number; written: number }>> {
  const out: Array<StoredEvent & { commits: number; written: number }> = [];
  for (const b of batches) {
    const team = teamOf(b);
    const res = await insertCommits(client, companyId, team, uploadOf(team), b.deployment ?? '', b.branch, b.commits);
    let days: string[] = [];
    if (res.written + res.updated > 0) {
      const shas = b.commits.map((c) => c.sha);
      days = (await client.query(
        `SELECT DISTINCT to_char(day, 'YYYY-MM-DD') AS day FROM deployments_raw
          WHERE team_id = $1 AND is_production AND (external_id = $2 OR commit_shas && $3::varchar[])`, [team, b.deployment ?? '', shas])).rows.map((x: any) => x.day);
    }
    out.push({ id: b.deployment ?? (b.branch ? `push:${b.branch}` : 'push'), team, status: res.written ? 'written' : res.updated ? 'updated' : 'duplicate', days, commits: b.commits.length, written: res.written });
  }
  return out;
}

interface IncidentRowDb {
  id: string; title: string | null; severity: string; severity_label: string | null; service: string | null; status: string;
  opened_at: Date; acknowledged_at: Date | null; resolved_at: Date | null; outage: boolean | null; category: string | null;
  deployment_external_id: string | null; url: string | null; source: string | null;
}

const minDate = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a <= b ? a : b);
const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Incidents: created by the first event, updated by later ones (status stream). `now` is the time a status update without a time counts at. */
/**
 * Incidents: created by the first event, updated by later ones (status stream). `now` is the time a status update
 * without a time counts at. The rows of the request are read (and locked) in one query, every event is applied in
 * order in memory (so an incident sent twice in one request behaves as two requests), and the result is written
 * with one INSERT for the new incidents, one UPDATE for the changed ones and one INSERT for the status stream.
 */
export async function storeIncidents(client: pg.PoolClient, companyId: string, events: IncidentEvent[], teamOf: (e: IncidentEvent) => string, uploadOf: (team: string) => string | null, now = new Date()): Promise<StoredEvent[]> {
  if (!events.length) return [];
  const keyOf = (team: string, id: string) => `${team}\u0000${id}`;
  const wanted = Array.from(new Map(events.map((e) => [keyOf(teamOf(e), e.id), [teamOf(e), e.id] as const])).values());
  const found = (await client.query<IncidentRowDb & { team_id: string; external_id: string }>(
    `SELECT i.id, i.team_id, i.external_id, i.title, i.severity, i.severity_label, i.service, i.status, i.opened_at, i.acknowledged_at, i.resolved_at, i.outage, i.category,
            i.deployment_external_id, i.url, i.source
       FROM incidents_raw i JOIN unnest($1::text[], $2::text[]) AS x(t, e) ON i.team_id = x.t AND i.external_id = x.e
      ORDER BY i.id FOR UPDATE OF i`, [wanted.map((w) => w[0]), wanted.map((w) => w[1])])).rows;
  interface State { id: string | null; team: string; ext: string; row: IncidentRowDb; fresh: boolean; dirty: boolean }
  const state = new Map<string, State>(found.map((r) => [keyOf(r.team_id, r.external_id), { id: r.id, team: r.team_id, ext: r.external_id, row: r, fresh: false, dirty: false }]));
  const results: Array<{ team: string; key: string; prev: boolean; changed: boolean; days: string[]; updates: Array<[IncidentStatus, Date, string]> }> = [];
  for (const [i, e] of events.entries()) {
    const team = teamOf(e);
    const key = keyOf(team, e.id);
    const st = state.get(key);
    const prev = st?.row;
    const at = e.at ?? null;
    const opened = minDate(prev?.opened_at ?? null, e.openedAt);
    if (!opened) throw new ReportError(`incidents[${i}].openedAt is required: incident ${e.id} is new (send openedAt with its first event)`);
    let ack = minDate(prev?.acknowledged_at ?? null, e.acknowledgedAt);
    let resolved = prev?.resolved_at ?? null;
    if (e.status === 'acknowledged' && !ack) ack = at ?? now;
    if (e.status === 'resolved') resolved = e.resolvedAt ?? at ?? resolved ?? now;
    else if (e.resolvedAt) resolved = e.resolvedAt;
    else if (e.status === 'open' && resolved && (at ?? now) > resolved) resolved = null; // reopened
    if (resolved && resolved < opened) throw new ReportError(`incidents[${i}]: incident ${e.id} would be resolved before it was opened`);
    if (ack && ack < opened) ack = opened;
    const status: IncidentStatus = resolved ? 'resolved' : ack ? 'acknowledged' : 'open';
    const next: IncidentRowDb = {
      id: st?.id ?? '', title: e.title ?? prev?.title ?? null, severity: e.severity ?? prev?.severity ?? 'medium', severity_label: e.severityLabel ?? prev?.severity_label ?? null,
      service: e.service ?? prev?.service ?? null, status, opened_at: opened, acknowledged_at: ack, resolved_at: resolved, outage: e.outage ?? prev?.outage ?? null,
      category: e.category ?? prev?.category ?? null, deployment_external_id: e.deployment ?? prev?.deployment_external_id ?? null, url: e.url ?? prev?.url ?? null, source: prev?.source ?? e.source,
    };
    const changed = !prev || !same(prev.opened_at, opened) || !same(prev.acknowledged_at, ack) || !same(prev.resolved_at, resolved) || prev.status !== status
      || prev.title !== next.title || prev.severity !== next.severity || prev.severity_label !== next.severity_label || prev.service !== next.service
      || prev.outage !== next.outage || prev.category !== next.category || prev.deployment_external_id !== next.deployment_external_id || prev.url !== next.url;
    if (!st) state.set(key, { id: null, team, ext: e.id, row: next, fresh: true, dirty: true });
    else if (changed) { st.row = next; st.dirty = true; }
    // The status stream: every known status time (the event's own update, and the times of a full record).
    const updates: Array<[IncidentStatus, Date, string]> = [['open', opened, next.severity]];
    if (ack) updates.push(['acknowledged', ack, next.severity]);
    if (resolved) updates.push(['resolved', resolved, next.severity]);
    if (e.status && at) updates.push([e.status, at, next.severity]);
    const days = new Set<string>();
    if (changed) for (const d of [opened, ack, resolved, prev?.opened_at ?? null, prev?.resolved_at ?? null]) if (d) days.add(dayOf(d));
    results.push({ team, key, prev: !!prev, changed, days: Array.from(days), updates });
  }
  const all = Array.from(state.values());
  const created = all.filter((s) => s.fresh);
  if (created.length) {
    const ids = await client.query(
      `INSERT INTO incidents_raw (company_id, team_id, upload_id, external_id, title, severity, severity_label, service, status, opened_at, acknowledged_at, resolved_at,
                                  day, outage, category, deployment_external_id, source, url)
       SELECT $1, x.team, x.upload, x.ext, x.title, x.severity, x.label, x.service, x.status, x.opened, x.ack, x.resolved, x.day, x.outage, x.category, x.dep, x.source, x.url
         FROM jsonb_to_recordset($2::jsonb) AS x(o int, team text, upload text, ext text, title text, severity text, label text, service text, status text, opened timestamptz,
              ack timestamptz, resolved timestamptz, day date, outage boolean, category text, dep text, source text, url text)
        ORDER BY x.o
       RETURNING id, team_id, external_id`,
      [companyId, JSON.stringify(created.map((s, o) => ({
        o, team: s.team, upload: uploadOf(s.team), ext: s.ext, title: s.row.title, severity: s.row.severity, label: s.row.severity_label, service: s.row.service, status: s.row.status,
        opened: iso(s.row.opened_at), ack: iso(s.row.acknowledged_at), resolved: iso(s.row.resolved_at), day: dayOf(s.row.opened_at), outage: s.row.outage, category: s.row.category,
        dep: s.row.deployment_external_id, source: s.row.source, url: s.row.url,
      })))]);
    for (const r of ids.rows) state.get(keyOf(r.team_id, r.external_id))!.id = r.id;
  }
  const changedRows = all.filter((s) => !s.fresh && s.dirty);
  if (changedRows.length) {
    await client.query(
      `UPDATE incidents_raw i SET upload_id = x.upload, title = x.title, severity = x.severity, severity_label = x.label, service = x.service, status = x.status, opened_at = x.opened,
              acknowledged_at = x.ack, resolved_at = x.resolved, day = x.day, outage = x.outage, category = x.category, deployment_external_id = x.dep, url = x.url,
              is_sample = false, updated_at = now()
         FROM jsonb_to_recordset($1::jsonb) AS x(id text, upload text, title text, severity text, label text, service text, status text, opened timestamptz, ack timestamptz,
              resolved timestamptz, day date, outage boolean, category text, dep text, url text)
        WHERE i.id = x.id`,
      [JSON.stringify(changedRows.map((s) => ({
        id: s.id, upload: uploadOf(s.team), title: s.row.title, severity: s.row.severity, label: s.row.severity_label, service: s.row.service, status: s.row.status,
        opened: iso(s.row.opened_at), ack: iso(s.row.acknowledged_at), resolved: iso(s.row.resolved_at), day: dayOf(s.row.opened_at), outage: s.row.outage, category: s.row.category,
        dep: s.row.deployment_external_id, url: s.row.url,
      })))]);
  }
  // One INSERT for the status stream of every event; a status time already stored (or sent earlier in this request) is not new.
  const tuple = (incident: string, status: string, at: Date | string) => `${incident}|${status}|${new Date(at).toISOString()}`;
  const rows = results.flatMap((r, i) => r.updates.map(([status, at, severity]) => ({ i, incident: state.get(r.key)!.id!, team: r.team, status, at: at.toISOString(), severity })));
  const firstOf = new Map<string, number>();
  for (const x of rows) if (!firstOf.has(tuple(x.incident, x.status, x.at))) firstOf.set(tuple(x.incident, x.status, x.at), x.i);
  const fresh = new Set<number>();
  if (rows.length) {
    const u = await client.query(
      `INSERT INTO incident_updates (incident_id, team_id, status, at, severity, upload_id)
       SELECT x.incident, x.team, x.status, x.at, x.severity, x.upload
         FROM jsonb_to_recordset($1::jsonb) AS x(o int, incident text, team text, status text, at timestamptz, severity text, upload text)
        ORDER BY x.o
       ON CONFLICT (incident_id, status, at) DO NOTHING RETURNING incident_id, status, at`,
      [JSON.stringify(rows.map((x, o) => ({ o, incident: x.incident, team: x.team, status: x.status, at: x.at, severity: x.severity, upload: uploadOf(x.team) })))]);
    for (const r of u.rows) { const i = firstOf.get(tuple(r.incident_id, r.status, r.at)); if (i !== undefined) fresh.add(i); }
  }
  return results.map((r, i) => ({
    id: events[i].id, team: r.team, status: !r.changed && !fresh.has(i) ? 'duplicate' : r.prev ? 'updated' : 'written', days: r.days,
  }));
}
