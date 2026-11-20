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

/** Deployments: insert or update by team + id. `teamOf` resolves each event's team (already checked). */
export async function storeDeployments(client: pg.PoolClient, companyId: string, events: DeploymentEvent[], teamOf: (e: DeploymentEvent) => string, uploadOf: (team: string) => string | null): Promise<StoredEvent[]> {
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
export async function storeIncidents(client: pg.PoolClient, companyId: string, events: IncidentEvent[], teamOf: (e: IncidentEvent) => string, uploadOf: (team: string) => string | null, now = new Date()): Promise<StoredEvent[]> {
  const out: StoredEvent[] = [];
  for (const [i, e] of events.entries()) {
    const team = teamOf(e);
    const prev = (await client.query<IncidentRowDb>(
      `SELECT id, title, severity, severity_label, service, status, opened_at, acknowledged_at, resolved_at, outage, category, deployment_external_id, url, source
         FROM incidents_raw WHERE team_id = $1 AND external_id = $2 FOR UPDATE`, [team, e.id])).rows[0];
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
    const next = {
      title: e.title ?? prev?.title ?? null, severity: e.severity ?? prev?.severity ?? 'medium', severity_label: e.severityLabel ?? prev?.severity_label ?? null,
      service: e.service ?? prev?.service ?? null, outage: e.outage ?? prev?.outage ?? null, category: e.category ?? prev?.category ?? null,
      deployment: e.deployment ?? prev?.deployment_external_id ?? null, url: e.url ?? prev?.url ?? null, source: prev?.source ?? e.source,
    };
    let id: string;
    let changed = false;
    if (!prev) {
      id = (await client.query(
        `INSERT INTO incidents_raw (company_id, team_id, upload_id, external_id, title, severity, severity_label, service, status, opened_at, acknowledged_at, resolved_at,
                                    day, outage, category, deployment_external_id, source, url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::date, $14, $15, $16, $17, $18) RETURNING id`,
        [companyId, team, uploadOf(team), e.id, next.title, next.severity, next.severity_label, next.service, status, opened, ack, resolved, dayOf(opened),
          next.outage, next.category, next.deployment, next.source, next.url])).rows[0].id;
      changed = true;
    } else {
      id = prev.id;
      changed = !same(prev.opened_at, opened) || !same(prev.acknowledged_at, ack) || !same(prev.resolved_at, resolved) || prev.status !== status
        || prev.title !== next.title || prev.severity !== next.severity || prev.severity_label !== next.severity_label || prev.service !== next.service
        || prev.outage !== next.outage || prev.category !== next.category || prev.deployment_external_id !== next.deployment || prev.url !== next.url;
      if (changed) {
        await client.query(
          `UPDATE incidents_raw SET upload_id = $2, title = $3, severity = $4, severity_label = $5, service = $6, status = $7, opened_at = $8, acknowledged_at = $9,
                  resolved_at = $10, day = $11::date, outage = $12, category = $13, deployment_external_id = $14, url = $15, is_sample = false, updated_at = now()
            WHERE id = $1`,
          [id, uploadOf(team), next.title, next.severity, next.severity_label, next.service, status, opened, ack, resolved, dayOf(opened), next.outage, next.category,
            next.deployment, next.url]);
      }
    }
    // The status stream: every known status time (the event's own update, and the times of a full record).
    const updates: Array<[IncidentStatus, Date]> = [['open', opened]];
    if (ack) updates.push(['acknowledged', ack]);
    if (resolved) updates.push(['resolved', resolved]);
    if (e.status && at) updates.push([e.status, at]);
    const u = await client.query(
      `INSERT INTO incident_updates (incident_id, team_id, status, at, severity, upload_id)
       SELECT $1, $2, x.s, x.t, $3, $4 FROM unnest($5::text[], $6::timestamptz[]) AS x(s, t)
       ON CONFLICT (incident_id, status, at) DO NOTHING`,
      [id, team, next.severity, uploadOf(team), updates.map((x) => x[0]), updates.map((x) => x[1].toISOString())]);
    const days = new Set<string>();
    if (changed) {
      for (const d of [opened, ack, resolved, prev?.opened_at ?? null, prev?.resolved_at ?? null]) if (d) days.add(dayOf(d));
      // A newly linked deployment changes the change failure rate from the incident's day on (already in the set).
    }
    out.push({ id: e.id, team, status: !changed && !(u.rowCount ?? 0) ? 'duplicate' : prev ? 'updated' : 'written', days: Array.from(days) });
  }
  return out;
}
