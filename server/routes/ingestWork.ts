/**
 * Raw ingestion, phase 3 (work and code quality): customers send raw issues and static-analysis
 * reports; QE Navigator calculates defect escape rate, defect density, velocity, commitment, carryover,
 * blocked time and sizing accuracy (server/lib/calc/work.ts) and the code quality score, findings by
 * severity and rule and new vs fixed findings (server/lib/calc/quality.ts). Same API keys, rate
 * limit, ingestion log, idempotency and dry run as the phase-1 and phase-2 endpoints.
 *
 *   POST /api/ingest/issues            Jira (REST search result with changelog, an issue, a webhook), Linear
 *                                      (GraphQL export, webhook) or QE Navigator JSON; JSON, gzip accepted,
 *                                      at most 10 MB and 1,000 issues. Query: team (default team of the
 *                                      issues), format, storyPointsField, sprintField, environmentField,
 *                                      dryRun=true. Each issue's team: its own "team", else the query team,
 *                                      else the team its project key (Jira project / Linear team) is mapped
 *                                      to in Connect your CI. Idempotent by issue key + change time.
 *   POST /api/ingest/static-analysis   SARIF 2.1.0 (SonarQube, CodeQL, ESLint, Semgrep, …): the file as the
 *                                      body or the multipart field "report", gzip accepted, at most 20 MB.
 *                                      Query / fields: team (required), repo, branch, commit, run, attempt,
 *                                      startedAt, loc (lines of code), dryRun. Idempotent per team + commit
 *                                      + run + attempt.
 */
import express from 'express';
import { query } from '../../src/lib/db';
import { authenticateApiKey, ApiKeyRequest } from '../middleware/apiKey';
import { ingestLimiter } from '../middleware/rateLimit';
import { KpiValidationError, normaliseIdempotencyKey } from '../lib/kpiIngest';
import { runLogged, findReplay, sendReplay, type IngestCaller, type ItemSummary } from '../lib/ingestionLog';
import { BodyError, maybeGunzip, readBody, MAX_UPLOAD_BYTES } from '../lib/ingest/body';
import { ReportError } from '../lib/ingest/testReports';
import { insertUpload, sha256 } from '../lib/ingest/store';
import { ISSUE_FORMATS, detectIssueFormat, parseIssueBody, type IssueEvent, type IssueFormat, type SprintRef } from '../lib/ingest/issueEvents';
import { looksLikeSarif, parseSarif, severityCounts, STATIC_ANALYSIS_FORMATS, type ParsedAnalysis } from '../lib/ingest/sarif';
import { storeAnalysis, storeIssues, storeSprints, type StoredIssue } from '../lib/ingest/workStore';
import { recomputeTeamDays, type DayResult } from '../lib/calc/engine';
import { workAffectedDays } from '../lib/calc/work';
import { qualityAffectedDays } from '../lib/calc/quality';
import { HttpError, after, checkTime, commonFields, computedOut, fail, readInput, summaryItem, teamOwned, text } from './ingestRaw';

const router = express.Router();

export const ISSUES_BODY_LIMIT = 10 * 1024 * 1024;
const NOT_JSON = /^(multipart\/|application\/(xml|x-ndjson|zip|gzip)|text\/(xml|html|csv))/i;

async function teamsOwned(companyId: string, teamIds: string[]): Promise<Set<string>> {
  return new Set((await query<any[]>('SELECT id FROM teams WHERE company_id = ? AND id = ANY(?::text[])', [companyId, teamIds])).map((r: any) => r.id));
}

/** The team of every issue: its own → the request's → its project key mapped like a service (Connect your CI). */
async function resolveTeams(companyId: string, issues: IssueEvent[]): Promise<Map<IssueEvent, string>> {
  const projects = Array.from(new Set(issues.filter((e) => !e.team && e.project).map((e) => e.project as string)));
  const mapped = projects.length
    ? new Map((await query<any[]>('SELECT service, team_id FROM service_teams WHERE company_id = ? AND service = ANY(?::text[])', [companyId, projects])).map((r: any) => [r.service, r.team_id]))
    : new Map<string, string>();
  const out = new Map<IssueEvent, string>();
  const missing: string[] = [];
  for (const e of issues) {
    const team = e.team ?? (e.project ? mapped.get(e.project) : undefined);
    if (team) out.set(e, team);
    else missing.push(`${e.key}: no team${e.project ? ` (project "${e.project}" is not mapped to a team)` : ''}`);
  }
  if (missing.length) {
    throw new HttpError(400, `team is required: send "team" (the team id) as a query parameter or with the issue, or map the project key to a team in Admin console → Connect your CI. ${missing.slice(0, 5).join('; ')}${missing.length > 5 ? ` (and ${missing.length - 5} more)` : ''}`);
  }
  return out;
}

async function handleIssues(req: ApiKeyRequest, res: express.Response) {
  const caller: IngestCaller = { companyId: req.apiKey!.companyId, channel: 'api', apiKeyId: req.apiKey!.id };
  let key: string | null = null;
  let hash: string | null = null;
  let teamId: string | null = null;
  let source: string | null = 'issues';
  try {
    try { key = normaliseIdempotencyKey(req.get('Idempotency-Key'), 'Idempotency-Key'); } catch (e) { throw new HttpError(400, (e as KpiValidationError).message); }
    const ct = String(req.headers['content-type'] ?? '');
    if (NOT_JSON.test(ct)) throw new HttpError(415, `Content-Type "${ct.split(';')[0]}" is not supported: send the issues as JSON (Content-Type: application/json)`, { supported: ['application/json'] });
    let raw: Buffer;
    try { raw = await readBody(req, ISSUES_BODY_LIMIT); } catch (e) {
      if (e instanceof BodyError && e.status === 413) throw new BodyError(413, `Body too large: at most ${ISSUES_BODY_LIMIT / 1024 / 1024} MB per request (at most 1,000 issues; send gzip or a page at a time)`);
      throw e;
    }
    const payload = maybeGunzip(raw, req.headers['content-encoding'] as string | undefined);
    if (payload.length > ISSUES_BODY_LIMIT * 4) throw new BodyError(413, `Body too large after decompression: at most ${ISSUES_BODY_LIMIT * 4 / 1024 / 1024} MB`);
    hash = sha256(payload);
    if (key) { const replay = await findReplay(caller, key); if (replay) return sendReplay(res, replay, hash); }
    if (!payload.length) throw new HttpError(400, 'Empty body: send the issues as JSON');
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query)) if (typeof v === 'string') q[k] = v;
    let body: any;
    try { body = JSON.parse(text(payload)); } catch { throw new HttpError(400, 'The body must be JSON (Content-Type: application/json)'); }
    const given = (q.format ?? '').trim().toLowerCase() || null;
    if (given && !(ISSUE_FORMATS as readonly string[]).includes(given)) throw new HttpError(415, `Unsupported issues format "${given}". Supported: ${ISSUE_FORMATS.join(', ')}`, { supported: ISSUE_FORMATS });
    const format = (given ?? detectIssueFormat(body)) as IssueFormat;
    source = `issues (${format})`;
    const defTeam = (q.team ?? q.teamId ?? '').trim() || null;
    if (defTeam) teamId = defTeam;
    let parsed: ReturnType<typeof parseIssueBody>;
    try {
      parsed = parseIssueBody(body, format, {
        team: defTeam, storyPointsField: (q.storyPointsField ?? '').trim() || null, sprintField: (q.sprintField ?? '').trim() || null, environmentField: (q.environmentField ?? '').trim() || null,
      });
    } catch (e) {
      if (e instanceof ReportError) throw new HttpError(400, e.message);
      throw e;
    }
    for (const e of parsed.issues) {
      for (const t of [e.createdAt, e.resolvedAt, e.updatedAt, ...e.transitions.map((x) => x.at)]) {
        if (t && t.getTime() > Date.now() + 5 * 60_000) throw new HttpError(400, `${e.key}: a time (${t.toISOString()}) is in the future`);
      }
    }
    if (defTeam && !(await teamOwned(caller.companyId, defTeam))) throw new HttpError(403, `Team ${defTeam} is not accessible with this API key`);
    const teamOf = await resolveTeams(caller.companyId, parsed.issues);
    const teams = Array.from(new Set([...teamOf.values(), ...(parsed.issues.length === 0 && defTeam ? [defTeam] : [])]));
    if (!teams.length && parsed.sprints.length) throw new HttpError(400, 'team is required for sprints sent without issues (query parameter team)');
    teamId = teams[0] ?? teamId;
    const owned = await teamsOwned(caller.companyId, teams);
    const foreign = teams.filter((t) => !owned.has(t));
    if (foreign.length) { teamId = null; throw new HttpError(403, `Team${foreign.length > 1 ? 's' : ''} ${foreign.join(', ')} ${foreign.length > 1 ? 'are' : 'is'} not accessible with this API key`); }
    // The sprints of each team: those its issues name (and, for one team, the sprints sent on their own).
    const sprintsOf = new Map<string, SprintRef[]>();
    for (const t of teams) {
      const named = new Set(parsed.issues.filter((e) => teamOf.get(e) === t).flatMap((e) => e.sprints.map((s) => s.id)));
      sprintsOf.set(t, parsed.sprints.filter((s) => named.has(s.id) || teams.length === 1));
    }
    const firstAt = parsed.issues[0]?.createdAt.toISOString() ?? null;

    if (q.dryRun === 'true' || q.dryRun === '1') {
      const testSource = `issues (${format}, test call)`;
      const out = await runLogged(caller, { key: null, hash, source: testSource }, async () => ({
        status: 'accepted', httpStatus: 200,
        response: {
          status: 'dry-run', kind: 'issues', format, teams, issues: parsed.issues.length, sprints: parsed.sprints.length, ignored: parsed.ignored,
          types: parsed.issues.reduce<Record<string, number>>((m, e) => ({ ...m, [e.type]: (m[e.type] ?? 0) + 1 }), {}),
          withEnvironment: parsed.issues.filter((e) => e.type === 'bug' && e.foundIn).length, withStoryPoints: parsed.issues.filter((e) => e.storyPoints !== null).length,
          message: 'Key, teams and issues are valid. Nothing was stored.',
        },
        items: (teams.length ? teams : [defTeam]).map((t) => summaryItem(t, testSource, firstAt, 'duplicate')), errors: [], teamIds: teams, valueCount: 0, source: testSource,
      }));
      if ('replay' in out) return sendReplay(res, out.replay, hash);
      return res.status(200).json(out.outcome.response);
    }

    const h = hash;
    const src = source;
    const outcome = await runLogged(caller, { key, hash, source }, async (client, ingestionId) => {
      if (!parsed.issues.length && !parsed.sprints.length) {
        return {
          status: 'accepted', httpStatus: 200, response: { status: 'ignored', kind: 'issues', format, issues: [], ignored: parsed.ignored, message: 'Nothing to record.' },
          items: [summaryItem(defTeam, src, null, 'duplicate')], errors: [], teamIds: defTeam ? [defTeam] : [], valueCount: 0, source: src,
        };
      }
      const uploads = new Map<string, { id: string; fresh: boolean }>();
      for (const t of teams) {
        const up = await insertUpload(client, {
          companyId: caller.companyId, teamId: t, kind: 'issues', format, commit: '', branch: null, runId: `issues:${h.slice(0, 32)}`, attempt: 1, payload,
          apiKeyId: caller.apiKeyId ?? null, ingestionId, parseMs: 0, summary: { issues: parsed.issues.filter((e) => teamOf.get(e) === t).length, format },
        });
        uploads.set(t, 'duplicateOf' in up ? { id: up.duplicateOf, fresh: false } : { id: up.id, fresh: true });
      }
      const uploadOf = (t: string) => uploads.get(t)?.id || null;
      const sprintDays = new Map<string, string[]>();
      let sprintChanges = 0;
      for (const t of teams) {
        const r = await storeSprints(client, caller.companyId, t, sprintsOf.get(t) ?? [], uploadOf(t));
        sprintDays.set(t, r.days);
        sprintChanges += r.changed;
      }
      const stored: StoredIssue[] = await storeIssues(client, caller.companyId, parsed.issues, (e) => teamOf.get(e)!, uploadOf);
      const computed: Array<{ team: string; days: DayResult[] }> = [];
      const items: ItemSummary[] = [];
      for (const t of teams) {
        const changed = stored.filter((s) => s.team === t && s.status !== 'duplicate');
        const days = workAffectedDays([...changed.flatMap((s) => s.days), ...(sprintDays.get(t) ?? [])]);
        const result = days.length ? await recomputeTeamDays(client, t, days, { groups: ['work'], ingestionId, actorId: `api_key:${caller.apiKeyId}` }) : [];
        computed.push({ team: t, days: result });
        const any = changed.length > 0 || (sprintDays.get(t) ?? []).length > 0;
        if (!any && uploads.get(t)?.fresh) await client.query('DELETE FROM raw_uploads WHERE id = $1', [uploads.get(t)!.id]);
        const item = summaryItem(t, src, firstAt, any ? 'written' : 'duplicate');
        item.metrics = Array.from(new Set(result.flatMap((d) => d.metrics.filter((m) => m.written).map((m) => m.kpi as string))));
        items.push(item);
      }
      const anyWritten = stored.some((s) => s.status !== 'duplicate') || sprintChanges > 0;
      // Only the last 30 days of each team are listed in the answer (the evidence keeps every day).
      const recent = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
      return {
        status: 'accepted', httpStatus: anyWritten ? 201 : 200,
        response: {
          status: anyWritten ? 'accepted' : 'duplicate', kind: 'issues', format,
          issues: stored.map((s) => ({ key: s.key, team: s.team, status: s.status })), sprints: sprintChanges,
          ...(parsed.ignored.length ? { ignored: parsed.ignored } : {}),
          computed: computed.map((c) => ({ team: c.team, days: computedOut(c.days.filter((d) => d.day >= recent)), daysRecalculated: c.days.length })).filter((c) => c.daysRecalculated),
          ...(anyWritten ? {} : { message: 'These issues were already received; nothing changed.' }),
        },
        items, errors: [], teamIds: teams, valueCount: stored.filter((s) => s.status !== 'duplicate').length, source: src,
      };
    });
    if ('replay' in outcome) return sendReplay(res, outcome.replay, hash);
    for (const item of outcome.outcome.items) if (item.teamId) await after(caller.companyId, item.teamId, [item]);
    return res.status(outcome.outcome.httpStatus).json(outcome.outcome.response);
  } catch (e) {
    return fail(res, caller, key, hash, teamId, source, e);
  }
}

async function handleStaticAnalysis(req: ApiKeyRequest, res: express.Response) {
  const caller: IngestCaller = { companyId: req.apiKey!.companyId, channel: 'api', apiKeyId: req.apiKey!.id };
  let key: string | null = null;
  let hash: string | null = null;
  let teamId: string | null = null;
  let source: string | null = 'static-analysis';
  try {
    try { key = normaliseIdempotencyKey(req.get('Idempotency-Key'), 'Idempotency-Key'); } catch (e) { throw new HttpError(400, (e as KpiValidationError).message); }
    const input = await readInput(req, MAX_UPLOAD_BYTES);
    hash = sha256(input.payload);
    if (key) { const replay = await findReplay(caller, key); if (replay) return sendReplay(res, replay, hash); }
    if (!input.payload.length) throw new HttpError(400, 'Empty report: send the SARIF file as the body or as the multipart field "report"');
    const c = commonFields(input.fields);
    teamId = c.teamId;
    const given = (input.fields.format ?? '').trim().toLowerCase() || null;
    if (given && !(STATIC_ANALYSIS_FORMATS as readonly string[]).includes(given)) throw new HttpError(415, `Unsupported static-analysis format "${given}". Supported: sarif (SARIF 2.1.0, exported by SonarQube, CodeQL, ESLint, Semgrep and others)`, { supported: STATIC_ANALYSIS_FORMATS });
    const content = text(input.payload);
    let probe: any = null;
    try { probe = JSON.parse(content); } catch { probe = null; }
    if (!looksLikeSarif(probe)) throw new HttpError(415, 'Unrecognised static-analysis format. Supported: sarif (SARIF 2.1.0 JSON: {"version": "2.1.0", "runs": [...]})', { supported: STATIC_ANALYSIS_FORMATS });
    source = 'static-analysis (sarif)';
    if (!(await teamOwned(caller.companyId, c.teamId))) throw new HttpError(403, `Team ${c.teamId} is not accessible with this API key`);
    const t0 = Date.now();
    let reports: ParsedAnalysis[];
    try { reports = parseSarif(content); } catch (e) { if (e instanceof ReportError) throw new HttpError(400, e.message); throw e; }
    const parseMs = Date.now() - t0;
    const repo = ((input.fields.repo ?? input.fields.repository ?? '').trim() || reports[0].repo || '').slice(0, 255);
    const commit = c.commit || reports[0].commit || '';
    if (commit.length > 80) throw new HttpError(400, 'commit must be at most 80 characters');
    const branch = c.branch ?? reports[0].branch ?? null;
    const locRaw = (input.fields.loc ?? input.fields.linesOfCode ?? '').trim();
    const loc = locRaw ? Number(locRaw) : null;
    if (loc !== null && (!Number.isInteger(loc) || loc < 1 || loc > 1e9)) throw new HttpError(400, 'loc must be a whole number of lines of code (from 1)');
    const at = c.startedAt ?? reports.map((r) => r.analyzedAt).find(Boolean) ?? new Date();
    checkTime(at);
    const runId = `${c.run ?? `sha:${hash.slice(0, 16)}`}`.slice(0, 200);
    const summary = reports.map((r) => ({ tool: r.tool, findings: r.findings.length, bySeverity: severityCounts(r.findings), suppressed: r.suppressed, rules: r.rules }));
    const items = [summaryItem(c.teamId, source, at.toISOString(), 'written')];
    if (c.dryRun) {
      const testSource = 'static-analysis (sarif, test call)';
      const out = await runLogged(caller, { key: null, hash, source: testSource }, async () => ({
        status: 'accepted', httpStatus: 200,
        response: { status: 'dry-run', kind: 'static-analysis', format: 'sarif', team: c.teamId, repo, branch, commit, parseMs, reports: summary, message: 'Key, team and report are valid. Nothing was stored.' },
        items: [summaryItem(c.teamId, testSource, at.toISOString(), 'duplicate')], errors: [], teamIds: [c.teamId], valueCount: 0, source: testSource,
      }));
      if ('replay' in out) return sendReplay(res, out.replay, hash);
      return res.status(200).json(out.outcome.response);
    }
    const src = source;
    const outcome = await runLogged(caller, { key, hash, source }, async (client, ingestionId) => {
      const up = await insertUpload(client, {
        companyId: caller.companyId, teamId: c.teamId, kind: 'static-analysis', format: 'sarif', commit, branch, runId, attempt: c.attempt, payload: input.payload,
        apiKeyId: caller.apiKeyId ?? null, ingestionId, parseMs, summary: { repo, reports: summary },
      });
      if ('duplicateOf' in up) {
        items[0].status = 'duplicate';
        return {
          status: 'accepted', httpStatus: 200,
          response: { status: 'duplicate', kind: 'static-analysis', format: 'sarif', uploadId: up.duplicateOf, message: 'This report (team, commit, run, attempt) was already received; nothing was written.' },
          items, errors: [], teamIds: [c.teamId], valueCount: 0, source: src,
        };
      }
      const out: Array<Record<string, unknown>> = [];
      const days: string[] = [];
      for (const r of reports) {
        const s = await storeAnalysis(client, {
          companyId: caller.companyId, teamId: c.teamId, uploadId: up.id, repo, branch, commit, runId, attempt: c.attempt, analyzedAt: at, linesOfCode: loc ?? r.linesOfCode,
        }, r);
        days.push(s.day);
        out.push({ id: s.reportId, tool: r.tool, toolVersion: r.toolVersion, findings: r.findings.length, bySeverity: severityCounts(r.findings), suppressed: r.suppressed, rules: r.rules, newFindings: s.newFindings, fixedFindings: s.fixedFindings, duplicate: s.duplicate });
      }
      const result = await recomputeTeamDays(client, c.teamId, qualityAffectedDays(days), { groups: ['quality'], ingestionId, actorId: `api_key:${caller.apiKeyId}` });
      items[0].metrics = Array.from(new Set(result.flatMap((d) => d.metrics.filter((m) => m.written).map((m) => m.kpi as string))));
      return {
        status: 'accepted', httpStatus: 201,
        response: { status: 'accepted', kind: 'static-analysis', format: 'sarif', uploadId: up.id, repo, branch, commit, parseMs, reports: out, computed: computedOut(result) },
        items, errors: [], teamIds: [c.teamId], valueCount: reports.reduce((n, r) => n + r.findings.length, 0), source: src,
      };
    });
    if ('replay' in outcome) return sendReplay(res, outcome.replay, hash);
    await after(caller.companyId, c.teamId, outcome.outcome.items);
    return res.status(outcome.outcome.httpStatus).json(outcome.outcome.response);
  } catch (e) {
    return fail(res, caller, key, hash, teamId, source, e);
  }
}

router.post('/issues', ingestLimiter, authenticateApiKey, handleIssues);
router.post('/static-analysis', ingestLimiter, authenticateApiKey, handleStaticAnalysis);

export default router;
