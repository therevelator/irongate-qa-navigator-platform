/**
 * Raw ingestion, phase 2 (delivery and reliability): customers send raw deployment, commit and
 * incident events; QE Navigator calculates deployment frequency, lead time for changes, change
 * failure rate, MTTR, MTBF, availability and incidents per deploy (server/lib/calc/delivery.ts).
 * Same API keys, rate limit, ingestion log, idempotency and dry run as the phase-1 endpoints.
 *
 *   POST /api/ingest/deployments   deploy events (QE Navigator JSON; GitHub deployment_status and GitLab
 *                                  deployment webhooks are mapped)
 *   POST /api/ingest/commits       the commits of a deployment or a push (JSON from git log; GitHub and
 *                                  GitLab push webhooks are mapped); authors are stored as a hash only
 *   POST /api/ingest/incidents     incidents, created and updated by id (QE Navigator JSON; PagerDuty v3
 *                                  webhooks and REST exports, Opsgenie alert webhooks and exports are mapped)
 *
 * Body: one event, an array, or {deployments | commits | incidents: [...]}, at most 500 events,
 * JSON (gzip accepted), at most 5 MB. Query: team (default team of the events), service, format
 * (detected when not given), dryRun=true. Each event's team: its own "team", else the query / body
 * team, else the team its service is mapped to in Connect your CI (commits: also the team of the
 * deployment they name). Computed values (a change failure rate, an MTTR, …) are refused (400).
 */
import express from 'express';
import { query } from '../../src/lib/db';
import { authenticateApiKey, ApiKeyRequest } from '../middleware/apiKey';
import { ingestLimiter } from '../middleware/rateLimit';
import { KpiValidationError, normaliseIdempotencyKey } from '../lib/kpiIngest';
import { runLogged, findReplay, sendReplay, type IngestCaller, type ItemSummary } from '../lib/ingestionLog';
import { BodyError, maybeGunzip, readBody } from '../lib/ingest/body';
import { ReportError } from '../lib/ingest/testReports';
import { insertUpload, sha256 } from '../lib/ingest/store';
import {
  FORMATS, detectCommitFormat, detectDeploymentFormat, detectIncidentFormat, parseCommitBody, parseDeploymentBody, parseIncidentBody,
  type CommitBatch, type DeliveryKind, type DeploymentEvent, type IncidentEvent,
} from '../lib/ingest/deliveryEvents';
import { storeCommitBatches, storeDeployments, storeIncidents, type StoredEvent } from '../lib/ingest/deliveryStore';
import type { DayResult } from '../lib/calc/engine';
import { calcOrQueue } from '../lib/calc/queue';
import { deliveryAffectedDays } from '../lib/calc/delivery';
import { daysBack, evidenceDaysFrom, firstDay, teamFact } from '../lib/calc/dependents';
import { HttpError, actorOf, after, afterCommit, callerOf, computedOut, fail, noAccess, outOfScope, summaryItem, text } from './ingestRaw';
import { applyIncidentAllowList, minimisedIncidentPayload, storeTitlesOf } from '../lib/ingest/minimiseStore';

const router = express.Router();

export const DELIVERY_BODY_LIMIT = 5 * 1024 * 1024;
const NOT_JSON = /^(multipart\/|application\/(xml|x-ndjson|zip|gzip)|text\/(xml|html|csv))/i;

type AnyEvent = DeploymentEvent | IncidentEvent | CommitBatch;

/** The team of every event (own team → request team → service mapping → commits: the deployment's team). */
async function resolveTeams(companyId: string, kind: DeliveryKind, events: AnyEvent[]): Promise<Map<AnyEvent, string>> {
  const services = Array.from(new Set(events.filter((e) => !e.team && e.service).map((e) => e.service as string)));
  const mapped = services.length
    ? new Map((await query<any[]>('SELECT service, team_id FROM service_teams WHERE company_id = ? AND service = ANY(?::text[])', [companyId, services])).map((r: any) => [r.service, r.team_id]))
    : new Map<string, string>();
  const deployIds = kind === 'commits' ? Array.from(new Set((events as CommitBatch[]).filter((b) => !b.team && b.deployment && !(b.service && mapped.has(b.service))).map((b) => b.deployment as string))) : [];
  const byDeploy = new Map<string, string[]>();
  if (deployIds.length) {
    for (const r of await query<any[]>('SELECT external_id, array_agg(DISTINCT team_id) AS teams FROM deployments_raw WHERE company_id = ? AND external_id = ANY(?::text[]) GROUP BY external_id', [companyId, deployIds])) byDeploy.set(r.external_id, r.teams);
  }
  const out = new Map<AnyEvent, string>();
  const missing: string[] = [];
  events.forEach((e, i) => {
    let team = e.team ?? (e.service ? mapped.get(e.service) : undefined);
    if (!team && kind === 'commits' && (e as CommitBatch).deployment) {
      const ts = byDeploy.get((e as CommitBatch).deployment!);
      if (ts?.length === 1) team = ts[0];
    }
    if (team) out.set(e, team);
    else {
      const label = kind === 'commits' ? `commits${events.length > 1 ? `[batch ${i}]` : ''}` : `${kind}[${i}] (${(e as any).id})`;
      missing.push(`${label}: no team${e.service ? ` (service "${e.service}" is not mapped to a team)` : ''}`);
    }
  });
  if (missing.length) {
    throw new HttpError(400, `team is required: send "team" (the team id) with the event or as a query parameter, or map the service to a team in Admin console → Connect your CI. ${missing.slice(0, 5).join('; ')}${missing.length > 5 ? ` (and ${missing.length - 5} more)` : ''}`);
  }
  return out;
}

const eventTimes = (kind: DeliveryKind, e: AnyEvent): Date[] => {
  if (kind === 'deployments') { const d = e as DeploymentEvent; return [d.finishedAt, d.startedAt, ...d.commits.map((c) => c.authoredAt)].filter((x): x is Date => !!x); }
  if (kind === 'incidents') { const d = e as IncidentEvent; return [d.openedAt, d.acknowledgedAt, d.resolvedAt, d.at].filter((x): x is Date => !!x); }
  return (e as CommitBatch).commits.flatMap((c) => [c.authoredAt, c.committedAt]).filter((x): x is Date => !!x);
};

export function deliveryIngestHandler(kind: DeliveryKind) {
  return async (req: ApiKeyRequest, res: express.Response) => {
    const caller: IngestCaller = callerOf(req);
    let key: string | null = null;
    let hash: string | null = null;
    let teamId: string | null = null;
    let source: string | null = kind;
    try {
      try {
        key = normaliseIdempotencyKey(req.get('Idempotency-Key'), 'Idempotency-Key');
      } catch (e) {
        throw new HttpError(400, (e as KpiValidationError).message);
      }
      const ct = String(req.headers['content-type'] ?? '');
      if (NOT_JSON.test(ct)) throw new HttpError(415, `Content-Type "${ct.split(';')[0]}" is not supported: send the events as JSON (Content-Type: application/json)`, { supported: ['application/json'] });
      let raw: Buffer;
      try {
        raw = await readBody(req, DELIVERY_BODY_LIMIT);
      } catch (e) {
        if (e instanceof BodyError && e.status === 413) throw new BodyError(413, `Body too large: at most ${DELIVERY_BODY_LIMIT / 1024 / 1024} MB per request (at most 500 events; send gzip or split the batch)`);
        throw e;
      }
      const payload = maybeGunzip(raw, req.headers['content-encoding'] as string | undefined);
      if (payload.length > DELIVERY_BODY_LIMIT * 4) throw new BodyError(413, `Body too large after decompression: at most ${DELIVERY_BODY_LIMIT * 4 / 1024 / 1024} MB`);
      hash = sha256(payload);
      if (key) {
        const replay = await findReplay(caller, key);
        if (replay) return sendReplay(res, replay, hash);
      }
      if (!payload.length) throw new HttpError(400, `Empty body: send the ${kind === 'commits' ? 'commits' : kind} as JSON`);
      const q: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query)) if (typeof v === 'string') q[k] = v;
      let body: any;
      try { body = JSON.parse(text(payload)); } catch { throw new HttpError(400, 'The body must be JSON (Content-Type: application/json)'); }
      const supported = FORMATS[kind];
      const given = (q.format ?? '').trim().toLowerCase() || null;
      if (given && !supported.includes(given)) throw new HttpError(415, `Unsupported ${kind} format "${given}". Supported: ${supported.join(', ')}`, { supported });
      const format = given ?? (kind === 'deployments' ? detectDeploymentFormat(body) : kind === 'commits' ? detectCommitFormat(body) : detectIncidentFormat(body));
      source = `${kind} (${format})`;
      const defaults = { team: (q.team ?? q.teamId ?? '').trim() || null, service: (q.service ?? '').trim() || null };
      if (defaults.team) teamId = defaults.team;
      let events: AnyEvent[];
      let ignored: Array<{ id: string | null; reason: string }> = [];
      try {
        if (kind === 'deployments') {
          const p = parseDeploymentBody(body, format, { ...defaults, environment: (q.environment ?? '').trim() || null });
          events = p.events;
          ignored = p.ignored;
        } else if (kind === 'commits') {
          events = parseCommitBody(body, format, { ...defaults, deployment: (q.deployment ?? '').trim() || null });
        } else {
          events = parseIncidentBody(body, format, defaults);
        }
      } catch (e) {
        if (e instanceof ReportError) throw new HttpError(400, e.message);
        throw e;
      }
      for (const e of events) for (const t of eventTimes(kind, e)) checkEventTime(t);
      // Field allow-list (server/lib/ingest/fieldAllowList.ts): only allowed incident fields are stored.
      const storeTitles = kind === 'incidents' ? await storeTitlesOf(caller.companyId) : true;
      if (kind === 'incidents') applyIncidentAllowList(events as IncidentEvent[], storeTitles);
      if (defaults.team && (!(await teamsOwned(caller.companyId, [defaults.team])) || outOfScope(caller, [defaults.team]).length)) throw new HttpError(403, noAccess(caller, [defaults.team]));
      const teamOf = await resolveTeams(caller.companyId, kind, events);
      const teams = Array.from(new Set(teamOf.values()));
      teamId = teams[0] ?? teamId;
      if (teams.length && !(await teamsOwned(caller.companyId, teams))) {
        const owned = new Set((await query<any[]>('SELECT id FROM teams WHERE company_id = ? AND id = ANY(?::text[])', [caller.companyId, teams])).map((r: any) => r.id));
        const foreign = teams.filter((t) => !owned.has(t));
        teamId = null;
        throw new HttpError(403, noAccess(caller, foreign));
      }
      const outside = outOfScope(caller, teams);
      if (outside.length) { teamId = null; throw new HttpError(403, noAccess(caller, outside)); }
      const count = kind === 'commits' ? (events as CommitBatch[]).reduce((n, b) => n + b.commits.length, 0) : events.length;
      const firstAt = events.length ? eventTimes(kind, events[0])[0]?.toISOString() ?? null : null;

      if (q.dryRun === 'true' || q.dryRun === '1') {
        const testSource = `${kind} (${format}, test call)`;
        const response = { status: 'dry-run', kind, format, teams, events: count, ignored, message: 'Key, teams and events are valid. Nothing was stored.' };
        if (caller.preview) return res.status(200).json(response);
        const out = await runLogged(caller, { key: null, hash, source: testSource }, async () => ({
          status: 'accepted', httpStatus: 200,
          response,
          items: (teams.length ? teams : [defaults.team]).map((t) => summaryItem(t, testSource, firstAt, 'duplicate')), errors: [], teamIds: teams, valueCount: 0, source: testSource,
        }));
        if ('replay' in out) return sendReplay(res, out.replay, hash);
        return res.status(200).json(out.outcome.response);
      }

      const h = hash;
      const outcome = await runLogged(caller, { key, hash, source }, async (client, ingestionId) => {
        if (!events.length) {
          return {
            status: 'accepted', httpStatus: 200, response: { status: 'ignored', kind, format, events: [], ignored, message: 'Nothing to record: the event is not a finished deployment.' },
            items: [summaryItem(defaults.team, source, null, 'duplicate')], errors: [], teamIds: defaults.team ? [defaults.team] : [], valueCount: 0, source,
          };
        }
        // One raw_uploads row per team of the request (the identity of the request: its body hash).
        // Incidents: the copy kept is the minimised events of the team, never the body as received.
        const uploads = new Map<string, { id: string; fresh: boolean }>();
        for (const t of teams) {
          const kept = kind === 'incidents' ? minimisedIncidentPayload(caller.companyId, (events as IncidentEvent[]).filter((e) => teamOf.get(e) === t), storeTitles) : payload;
          const up = await insertUpload(client, {
            companyId: caller.companyId, teamId: t, kind, format, commit: '', branch: null, runId: `${kind}:${h.slice(0, 32)}`, attempt: 1, payload: kept,
            apiKeyId: caller.apiKeyId ?? null, ingestionId, parseMs: 0, summary: { events: count, format },
          });
          uploads.set(t, 'duplicateOf' in up ? { id: up.duplicateOf, fresh: false } : { id: up.id, fresh: true });
        }
        const uploadOf = (t: string) => uploads.get(t)?.id || null;
        const tOf = (e: AnyEvent) => teamOf.get(e)!;
        // Whether each team's incidents carried a category before this request (infrastructure failures start then).
        const hadCategories = new Map<string, boolean>();
        if (kind === 'incidents') for (const t of teams) hadCategories.set(t, await teamFact(client, t, 'incidentCategories'));
        let stored: Array<StoredEvent & { commits?: number }>;
        if (kind === 'deployments') stored = await storeDeployments(client, caller.companyId, events as DeploymentEvent[], tOf, uploadOf);
        else if (kind === 'commits') stored = await storeCommitBatches(client, caller.companyId, events as CommitBatch[], tOf, uploadOf);
        else stored = await storeIncidents(client, caller.companyId, events as IncidentEvent[], tOf, uploadOf);

        const computed: Array<{ team: string; days: DayResult[] }> = [];
        const items: ItemSummary[] = [];
        let queued = false;
        for (const t of teams) {
          const mine = stored.filter((s) => s.team === t);
          const changed = mine.filter((s) => s.status !== 'duplicate');
          const eventDays = Array.from(new Set(changed.flatMap((s) => s.days)));
          // Order independence (server/lib/calc/dependents.ts): the delivery days already calculated from the first
          // event day on; every one of them when the team's first incident category arrived.
          const flipped = kind === 'incidents' && changed.length > 0 && hadCategories.get(t) === false && (await teamFact(client, t, 'incidentCategories'));
          const days = Array.from(new Set([
            ...deliveryAffectedDays(eventDays),
            ...(changed.length ? await evidenceDaysFrom(client, t, ['delivery'], flipped ? daysBack(366) : firstDay(eventDays)) : []),
          ])).sort();
          const calc = await calcOrQueue(client, caller.companyId, t, days, { groups: ['delivery'], ingestionId, actorId: actorOf(caller) });
          queued ||= calc.queued;
          const result = calc.days;
          computed.push({ team: t, days: result });
          if (!changed.length && uploads.get(t)?.fresh) await client.query('DELETE FROM raw_uploads WHERE id = $1', [uploads.get(t)!.id]);
          const item = summaryItem(t, source, firstAt, changed.length ? 'written' : 'duplicate');
          item.metrics = Array.from(new Set(result.flatMap((d) => d.metrics.filter((m) => m.written).map((m) => m.kpi as string))));
          items.push(item);
        }
        const anyWritten = stored.some((s) => s.status !== 'duplicate');
        return {
          status: 'accepted', httpStatus: anyWritten ? 201 : 200,
          response: {
            status: anyWritten ? 'accepted' : 'duplicate', kind, format,
            events: stored.map((s) => ({ id: s.id, team: s.team, status: s.status, ...(s.commits !== undefined ? { commits: s.commits } : {}) })),
            ...(ignored.length ? { ignored } : {}),
            computed: computed.map((c) => ({ team: c.team, days: computedOut(c.days) })).filter((c) => c.days.length),
            ...(queued ? { calculation: 'queued' } : {}),
            ...(anyWritten ? {} : { message: 'These events were already received; nothing changed.' }),
          },
          items, errors: [], teamIds: teams, valueCount: stored.filter((s) => s.status !== 'duplicate').length, source,
        };
      });
      if ('replay' in outcome) return sendReplay(res, outcome.replay, hash);
      await afterCommit(caller, outcome.outcome);
      for (const item of outcome.outcome.items) if (item.teamId) await after(caller.companyId, item.teamId, [item]);
      return res.status(outcome.outcome.httpStatus).json(outcome.outcome.response);
    } catch (e) {
      return fail(res, caller, key, hash, teamId, source, e);
    }
  };
}

const MAX_AGE_DAYS = 365;
function checkEventTime(t: Date): void {
  if (t.getTime() > Date.now() + 5 * 60_000) throw new HttpError(400, `An event time (${t.toISOString()}) is in the future`);
  if (t.getTime() < Date.now() - MAX_AGE_DAYS * 86_400_000) throw new HttpError(400, `An event time (${t.toISOString()}) is more than ${MAX_AGE_DAYS} days in the past`);
}

async function teamsOwned(companyId: string, teamIds: string[]): Promise<boolean> {
  const rows = await query<any[]>('SELECT COUNT(*)::int AS n FROM teams WHERE company_id = ? AND id = ANY(?::text[])', [companyId, teamIds]);
  return rows[0]?.n === teamIds.length;
}

router.post('/deployments', ingestLimiter, authenticateApiKey, deliveryIngestHandler('deployments'));
router.post('/commits', ingestLimiter, authenticateApiKey, deliveryIngestHandler('commits'));
router.post('/incidents', ingestLimiter, authenticateApiKey, deliveryIngestHandler('incidents'));

export default router;
