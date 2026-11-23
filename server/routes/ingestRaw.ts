/**
 * Raw ingestion (v2 phase 1): customers send the raw output of their tools; QE Navigator
 * calculates every metric (server/lib/calc/engine.ts). Same API keys, rate limit and ingestion log
 * as POST /api/ingest/kpis.
 *
 *   POST /api/ingest/tests      JUnit XML, TRX, Cucumber JSON
 *   POST /api/ingest/coverage   lcov, Cobertura XML, JaCoCo XML, Istanbul coverage-final.json / json-summary
 *                               (+ optional unified diff or changed-lines list: coverage of changed code)
 *   POST /api/ingest/pipelines  pipeline run events (JSON)
 *
 * Tests and coverage: multipart upload (field `report` + team, commit, branch, run, attempt,
 * format, startedAt, diff / changedLines) or the raw report as the body with the same names as
 * query parameters (curl --data-binary @report.xml "…/tests?team=…&commit=…"). gzip is accepted
 * (Content-Encoding: gzip or a gzipped file). format is detected when not given.
 * Idempotent per team + commit + run + attempt (+ kind): a repeated upload writes nothing
 * ("duplicate"). ?dryRun=true checks the key, the team and the report without storing anything.
 */
import express from 'express';
import { query } from '../../src/lib/db';
import { authenticateApiKey, ApiKeyRequest } from '../middleware/apiKey';
import { ingestLimiter } from '../middleware/rateLimit';
import { KpiValidationError, normaliseIdempotencyKey, notifyKpisUpdated } from '../lib/kpiIngest';
import { afterIngestionRejected, afterKpiWrite } from '../lib/alerts';
import { agentClient, logRejected, runLogged, findReplay, sendReplay, type IngestCaller, type ItemSummary } from '../lib/ingestionLog';
import { BodyError, maybeGunzip, parseMultipart, readBody, MAX_UPLOAD_BYTES, MAX_UNCOMPRESSED_BYTES } from '../lib/ingest/body';
import { detectTestFormat, mergeTestReports, parseTestReport, ReportError, TEST_FORMATS, type TestFormat, type ParsedTestReport } from '../lib/ingest/testReports';
import {
  COVERAGE_FORMATS, detectCoverageFormat, mergeCoverage, parseChangedLinesList, parseCoverageReport, parseUnifiedDiff,
  type ChangedLines, type CoverageFormat, type ParsedCoverage,
} from '../lib/ingest/coverageReports';
import { parsePipelineBody, type PipelineRunEvent } from '../lib/ingest/pipelineEvents';
import { insertUpload, sha256, storeCoverage, storePipelineRuns, storeTestRun, type RawKind, type UploadMeta } from '../lib/ingest/store';
import { affectedDays, refreshFlakyEvidence, type DayResult } from '../lib/calc/engine';
import { calcOrQueue, kickCalc } from '../lib/calc/queue';
import { flushBackgroundWrites } from '../lib/opsLog';
import { minimisedCoveragePayload, minimisedPipelinePayload, minimisedTestPayload } from '../lib/ingest/minimiseStore';

const router = express.Router();

const PIPELINE_BODY_LIMIT = 1024 * 1024;
const MAX_AGE_DAYS = 365;

interface Input {
  payload: Buffer;
  /** Several report files in one multipart request (e.g. one JUnit file per test class): merged into one run. */
  extra: Buffer[];
  fields: Record<string, string>;
  diff: string | null;
  changedLines: string | null;
  filename: string | null;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

export async function readInput(req: ApiKeyRequest, limit: number): Promise<Input> {
  const raw = await readBody(req, limit);
  const ct = String(req.headers['content-type'] ?? '');
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) if (typeof v === 'string') q[k] = v;
  if (/^multipart\/form-data/i.test(ct)) {
    const mp = parseMultipart(raw, ct);
    const files = mp.files.report ?? mp.files.file ?? [];
    const fields = { ...q, ...mp.fields };
    let payload: Buffer;
    if (files.length) payload = maybeGunzip(files[0].data);
    else if (typeof mp.fields.report === 'string') payload = Buffer.from(mp.fields.report);
    else throw new HttpError(400, 'Multipart upload without a "report" file (curl -F report=@results.xml)');
    let total = payload.length;
    const extra = files.slice(1).map((f) => {
      const b = maybeGunzip(f.data);
      total += b.length;
      if (total > MAX_UNCOMPRESSED_BYTES) throw new BodyError(413, `Reports too large after decompression: at most ${MAX_UNCOMPRESSED_BYTES / 1024 / 1024} MB in total`);
      return b;
    });
    const diffFile = mp.files.diff?.[0];
    const clFile = mp.files.changedLines?.[0];
    return {
      payload, extra, fields, filename: files[0]?.filename ?? null,
      diff: diffFile ? maybeGunzip(diffFile.data).toString('utf8') : mp.fields.diff ?? null,
      changedLines: clFile ? clFile.data.toString('utf8') : mp.fields.changedLines ?? null,
    };
  }
  const payload = maybeGunzip(raw, req.headers['content-encoding'] as string | undefined);
  return { payload, extra: [], fields: q, filename: null, diff: null, changedLines: null };
}

export const text = (b: Buffer) => {
  const s = b.toString('utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
};

export interface Common { teamId: string; commit: string; branch: string | null; run: string | null; attempt: number; startedAt: Date | null; dryRun: boolean }

export function commonFields(f: Record<string, string>): Common {
  const teamId = (f.team ?? f.teamId ?? '').trim();
  if (!teamId) throw new HttpError(400, 'team is required (the team id, from Admin console → Connect your CI)');
  const commit = (f.commit ?? f.sha ?? '').trim();
  if (commit.length > 80) throw new HttpError(400, 'commit must be at most 80 characters');
  const branch = (f.branch ?? '').trim().replace(/^refs\/heads\//, '') || null;
  if (branch && branch.length > 255) throw new HttpError(400, 'branch must be at most 255 characters');
  const run = (f.run ?? f.runId ?? '').trim() || null;
  if (run && run.length > 200) throw new HttpError(400, 'run must be at most 200 characters');
  const attempt = f.attempt === undefined || f.attempt === '' ? 1 : Number(f.attempt);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 1000) throw new HttpError(400, 'attempt must be a whole number from 1 (the rerun number of the CI run)');
  let startedAt: Date | null = null;
  if (f.startedAt) {
    startedAt = new Date(f.startedAt);
    if (Number.isNaN(startedAt.getTime())) throw new HttpError(400, 'startedAt must be an ISO 8601 timestamp');
  }
  return { teamId, commit, branch, run, attempt, startedAt, dryRun: f.dryRun === 'true' || f.dryRun === '1' };
}

export function checkTime(at: Date): void {
  const now = Date.now();
  if (at.getTime() > now + 5 * 60_000) throw new HttpError(400, 'The run time (startedAt or the report timestamp) is in the future');
  if (at.getTime() < now - MAX_AGE_DAYS * 86_400_000) throw new HttpError(400, `The run time is more than ${MAX_AGE_DAYS} days in the past`);
}

export async function teamOwned(companyId: string, teamId: string, caller?: IngestCaller): Promise<boolean> {
  if (caller?.verifiedTeams?.has(teamId) && caller.companyId === companyId) return true;
  const rows = await query<any[]>('SELECT 1 FROM teams WHERE id = ? AND company_id = ?', [teamId, companyId]);
  return rows.length > 0;
}

export function summaryItem(teamId: string | null, source: string | null, recordedAt: string | null, status: ItemSummary['status'], errors?: string[]): ItemSummary {
  return { index: 0, teamId, source, recordedAt, metrics: [], status, ...(errors ? { errors } : {}) };
}

/** The caller of an ingestion request: the API key (routes below) or, for file uploads, the person (server/routes/uploads.ts). */
export function callerOf(req: ApiKeyRequest): IngestCaller {
  const given = (req as any).ingestCaller as IngestCaller | undefined;
  return given ?? { companyId: req.apiKey!.companyId, channel: 'api', apiKeyId: req.apiKey!.id, client: agentClient(req.get('user-agent')) };
}

/** The actor recorded on computed values: the API key, or the person who uploaded the files. */
export const actorOf = (c: IngestCaller) => (c.apiKeyId ? `api_key:${c.apiKeyId}` : c.actorId ?? null);

/** Teams outside the caller's upload scope (none for an API key: the key's company is the scope). */
export const outOfScope = (c: IngestCaller, teamIds: string[]) => (c.teamScope ? teamIds.filter((t) => !c.teamScope!.has(t)) : []);

/** The 403 message for teams the caller may not write to. */
export function noAccess(c: IngestCaller, teamIds: string[]): string {
  const list = teamIds.join(', ');
  const many = teamIds.length > 1;
  return c.channel === 'upload'
    ? `Team${many ? 's' : ''} ${list} ${many ? 'are' : 'is'} not one of the teams you may upload to`
    : `Team${many ? 's' : ''} ${list} ${many ? 'are' : 'is'} not accessible with this API key`;
}

export const computedOut = (days: DayResult[]) => days.filter((d) => d.metrics.length).map((d) => ({ day: d.day, metrics: d.metrics }));

/** Shared request handling: auth done; reads, validates, logs, stores, computes. */
export function rawIngestHandler(kind: RawKind) {
  return async (req: ApiKeyRequest, res: express.Response) => {
    const caller = callerOf(req);
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
      const input = kind === 'pipelines'
        ? { payload: maybeGunzip(await readBody(req, PIPELINE_BODY_LIMIT), req.headers['content-encoding'] as string | undefined), extra: [] as Buffer[], fields: Object.fromEntries(Object.entries(req.query).filter(([, v]) => typeof v === 'string')) as Record<string, string>, diff: null, changedLines: null, filename: null }
        : await readInput(req, MAX_UPLOAD_BYTES);
      hash = sha256(input.extra.length ? Buffer.concat([input.payload, ...input.extra]) : input.payload);
      if (key) {
        const replay = await findReplay(caller, key);
        if (replay) return sendReplay(res, replay, hash);
      }
      if (!input.payload.length) throw new HttpError(400, kind === 'pipelines' ? 'Empty body: send the pipeline run as JSON' : 'Empty report: send the file as the body or as the multipart field "report"');

      if (kind === 'pipelines') return await handlePipelines(req, res, caller, key, hash, input.payload, input.fields, (t, s) => { teamId = t; source = s; });

      const c = commonFields(input.fields);
      teamId = c.teamId;
      const content = text(input.payload);
      const supported: readonly string[] = kind === 'tests' ? TEST_FORMATS : COVERAGE_FORMATS;
      let format = (input.fields.format ?? '').trim().toLowerCase() || null;
      if (format === 'json-summary' || format === 'coverage-summary') format = 'istanbul-summary';
      if (format === 'coverage-final' || format === 'istanbul-final') format = 'istanbul';
      if (format === 'xunit' || format === 'surefire') format = 'junit';
      if (format && !supported.includes(format)) {
        throw new HttpError(415, `Unsupported ${kind === 'tests' ? 'test report' : 'coverage'} format "${format}". Supported: ${supported.join(', ')}`, { supported });
      }
      format = format ?? (kind === 'tests' ? detectTestFormat(content) : detectCoverageFormat(content));
      if (!format) {
        throw new HttpError(415, `Unrecognised ${kind === 'tests' ? 'test report' : 'coverage report'} format. Supported: ${supported.join(', ')} (set format= to choose one)`, { supported });
      }
      source = `${kind} (${format})`;
      if (!(await teamOwned(caller.companyId, c.teamId, caller)) || outOfScope(caller, [c.teamId]).length) throw new HttpError(403, noAccess(caller, [c.teamId]));

      const t0 = Date.now();
      let parsedTests: ParsedTestReport | null = null;
      let parsedCov: ParsedCoverage | null = null;
      let changed: ChangedLines | null = null;
      try {
        if (kind === 'tests') {
          parsedTests = parseTestReport(content, format as TestFormat);
          for (const b of input.extra) parsedTests = mergeTestReports(parsedTests, parseTestReport(text(b), format as TestFormat));
        } else {
          parsedCov = parseCoverageReport(content, format as CoverageFormat);
          for (const b of input.extra) parsedCov = mergeCoverage(parsedCov, parseCoverageReport(text(b), format as CoverageFormat));
          if (input.diff) changed = parseUnifiedDiff(input.diff);
          else if (input.changedLines) changed = parseChangedLinesList(input.changedLines);
        }
      } catch (e) {
        if (e instanceof ReportError) throw new HttpError(400, e.message);
        throw e;
      }
      const parseMs = Date.now() - t0;
      if (parsedTests && parsedTests.cases.length === 0) throw new HttpError(400, 'The report has no test cases');
      if (parsedCov && parsedCov.files.length === 0 && parsedCov.totals.linesFound === 0) throw new HttpError(400, 'The coverage report has no files');

      // The run time: startedAt, else the report's own timestamp (JUnit / TRX start, Cobertura timestamp, JaCoCo
      // session start), else the time received.
      const at = c.startedAt ?? parsedTests?.startedAt ?? parsedCov?.startedAt ?? new Date();
      checkTime(at);
      const runId = c.run ?? `sha:${hash.slice(0, 16)}`;
      const summary = parsedTests
        ? { counts: parsedTests.counts, durationMs: parsedTests.durationMs }
        : { totals: parsedCov!.totals, files: parsedCov!.files.length, changedLines: changed ? Array.from(changed.values()).reduce((n, s) => n + s.size, 0) : null };
      const items = [summaryItem(c.teamId, source, at.toISOString(), 'written')];

      if (c.dryRun) {
        const testSource = `${kind} (${format}, test call)`;
        const response = { status: 'dry-run', kind, format, team: c.teamId, parseMs, ...summary, message: 'Key, team and report are valid. Nothing was stored.' };
        if (caller.preview) return res.status(200).json(response);
        const out = await runLogged(caller, { key: null, hash, source: testSource }, async () => ({
          status: 'accepted', httpStatus: 200,
          response,
          items: [summaryItem(c.teamId, testSource, at.toISOString(), 'duplicate')], errors: [], teamIds: [c.teamId], valueCount: 0, source: testSource,
        }));
        if ('replay' in out) return sendReplay(res, out.replay, hash);
        return res.status(200).json(out.outcome.response);
      }

      const outcome = await runLogged(caller, { key, hash, source }, async (client, ingestionId) => {
        const meta: UploadMeta = {
          companyId: caller.companyId, teamId: c.teamId, kind, format: format!, commit: c.commit, branch: c.branch, runId, attempt: c.attempt,
          // Kept: the minimised parsed report (no failure messages, output, properties, host or user names).
          payload: input.payload, kept: parsedTests ? minimisedTestPayload(parsedTests) : minimisedCoveragePayload(parsedCov!), apiKeyId: caller.apiKeyId ?? null, ingestionId, parseMs, summary,
        };
        const up = await insertUpload(client, meta);
        if ('duplicateOf' in up) {
          items[0].status = 'duplicate';
          return {
            status: 'accepted', httpStatus: 200,
            response: { status: 'duplicate', kind, format, uploadId: up.duplicateOf, message: 'This run (team, commit, run, attempt) was already received; nothing was written.' },
            items, errors: [], teamIds: [c.teamId], valueCount: 0, source,
          };
        }
        let calc: { days: DayResult[]; queued: boolean };
        let extra: Record<string, unknown>;
        let valueCount: number;
        if (parsedTests) {
          const { runId: testRunId, day } = await storeTestRun(client, meta, up.id, parsedTests, at);
          await refreshFlakyEvidence(client, c.teamId, [c.commit]);
          calc = await calcOrQueue(client, caller.companyId, c.teamId, affectedDays('tests', day), { groups: ['ci'], ingestionId, actorId: actorOf(caller) });
          extra = { testRunId, counts: parsedTests.counts, durationMs: parsedTests.durationMs };
          valueCount = parsedTests.cases.length;
        } else {
          const r = await storeCoverage(client, meta, up.id, parsedCov!, at, changed);
          calc = await calcOrQueue(client, caller.companyId, c.teamId, affectedDays('coverage', r.day), { groups: ['ci'], ingestionId, actorId: actorOf(caller) });
          extra = { coverageReportId: r.reportId, totals: parsedCov!.totals, files: parsedCov!.files.length, changedLines: r.changed };
          valueCount = parsedCov!.files.length;
        }
        const days = calc.days;
        items[0].metrics = Array.from(new Set(days.flatMap((d) => d.metrics.filter((m) => m.written).map((m) => m.kpi as string))));
        return {
          status: 'accepted', httpStatus: 201,
          response: { status: 'accepted', kind, format, uploadId: up.id, parseMs, ...extra, computed: computedOut(days), ...(calc.queued ? { calculation: 'queued' } : {}) },
          items, errors: [], teamIds: [c.teamId], valueCount, source,
        };
      });
      if ('replay' in outcome) return sendReplay(res, outcome.replay, hash);
      await afterCommit(caller, outcome.outcome);
      await after(caller.companyId, c.teamId, outcome.outcome.items);
      return res.status(outcome.outcome.httpStatus).json(outcome.outcome.response);
    } catch (e) {
      return fail(res, caller, key, hash, teamId, source, e);
    }
  };
}

/** After the commit of a request whose calculation was queued: start the drain (or tell the Exporter batch). */
export async function afterCommit(caller: IngestCaller, outcome: { response: any }) {
  if (outcome.response?.calculation === 'queued') await kickCalc(caller.companyId, caller.calcSink);
}

export async function after(companyId: string, teamId: string, items: ItemSummary[]) {
  const cols = Array.from(new Set(items.flatMap((i) => i.metrics)));
  if (cols.length) {
    notifyKpisUpdated(cols, 'computed');
    await afterKpiWrite(companyId, [teamId]);
  }
}

export async function fail(res: express.Response, caller: IngestCaller, key: string | null, hash: string | null, teamId: string | null, source: string | null, e: unknown) {
  const status = e instanceof HttpError || e instanceof BodyError ? e.status : e instanceof ReportError ? 400 : 500;
  const message = status === 500 ? 'Failed to ingest the upload; nothing was written' : (e as Error).message;
  if (status === 500) console.error('Raw ingest error:', e);
  const extra = e instanceof HttpError ? e.extra : {};
  const ownedTeam = teamId && status !== 403 ? teamId : null;
  // An upload preview writes nothing, not even the rejection.
  if (caller.preview) return res.status(status).json({ error: message, ...extra, status: 'rejected', ingestionId: null });
  const id = await logRejected(caller, { key, hash }, {
    httpStatus: status, response: { error: message, ...extra }, items: [summaryItem(teamId, source, null, 'error', [message])],
    errors: [{ index: null, errors: [message] }], teamIds: ownedTeam && (await teamOwned(caller.companyId, ownedTeam).catch(() => false)) ? [ownedTeam] : [], source,
  });
  if (ownedTeam) await afterIngestionRejected(caller.companyId, [ownedTeam]);
  if (status === 500) await flushBackgroundWrites(500).catch(() => undefined);
  return res.status(status).json({ error: message, ...extra, status: 'rejected', ingestionId: id });
}

async function handlePipelines(
  req: ApiKeyRequest, res: express.Response, caller: IngestCaller, key: string | null, hash: string, payload: Buffer,
  q: Record<string, string>, note: (teamId: string | null, source: string) => void,
) {
  let body: any;
  try { body = JSON.parse(text(payload)); } catch { throw new HttpError(400, 'The body must be JSON (Content-Type: application/json)'); }
  const teamId = String(q.team ?? q.teamId ?? body?.team ?? body?.teamId ?? '').trim();
  note(teamId || null, 'pipelines');
  if (!teamId) throw new HttpError(400, 'team is required (query parameter or "team" in the body)');
  let runs: PipelineRunEvent[];
  try {
    const list = body && typeof body === 'object' && !Array.isArray(body) && !Array.isArray(body.runs) ? (() => { const { team: _t, teamId: _ti, ...rest } = body; return rest; })() : body;
    runs = parsePipelineBody(list, { commit: q.commit, branch: q.branch ?? null });
  } catch (e) {
    if (e instanceof ReportError) throw new HttpError(400, e.message);
    throw e;
  }
  for (const r of runs) checkTime(r.startedAt);
  if (!(await teamOwned(caller.companyId, teamId, caller)) || outOfScope(caller, [teamId]).length) throw new HttpError(403, noAccess(caller, [teamId]));
  const dryRun = q.dryRun === 'true' || q.dryRun === '1';
  const source = 'pipelines';
  if (dryRun) {
    return res.status(200).json({ status: 'dry-run', kind: 'pipelines', team: teamId, runs: runs.length, message: 'Key, team and events are valid. Nothing was stored.' });
  }
  const items = [summaryItem(teamId, source, runs[0].startedAt.toISOString(), 'written')];
  const outcome = await runLogged(caller, { key, hash, source }, async (client, ingestionId) => {
    const single = runs.length === 1;
    const up = await insertUpload(client, {
      companyId: caller.companyId, teamId, kind: 'pipelines', format: 'json', commit: single ? runs[0].commit : '', branch: single ? runs[0].branch : null,
      runId: single ? runs[0].id : `batch:${hash.slice(0, 16)}`, attempt: single ? runs[0].attempt : 1, payload, kept: minimisedPipelinePayload(runs), apiKeyId: caller.apiKeyId ?? null,
      ingestionId, parseMs: 0, summary: { runs: runs.length },
    });
    if ('duplicateOf' in up) {
      items[0].status = 'duplicate';
      return { status: 'accepted', httpStatus: 200, response: { status: 'duplicate', kind: 'pipelines', uploadId: up.duplicateOf, message: 'These pipeline runs were already received; nothing was written.' }, items, errors: [], teamIds: [teamId], valueCount: 0, source };
    }
    const stored = await storePipelineRuns(client, caller.companyId, teamId, up.id, runs);
    const fresh = stored.filter((s) => !s.duplicate);
    const calc = await calcOrQueue(client, caller.companyId, teamId, Array.from(new Set(fresh.map((s) => s.day))), { groups: ['ci'], ingestionId, actorId: actorOf(caller) });
    const days = calc.days;
    if (!fresh.length) {
      // Every run was already stored: keep no upload row for this request.
      items[0].status = 'duplicate';
      await client.query('DELETE FROM raw_uploads WHERE id = $1', [up.id]);
    }
    items[0].metrics = Array.from(new Set(days.flatMap((d) => d.metrics.filter((m) => m.written).map((m) => m.kpi as string))));
    return {
      status: 'accepted', httpStatus: fresh.length ? 201 : 200,
      response: { status: fresh.length ? 'accepted' : 'duplicate', kind: 'pipelines', uploadId: up.id, runs: stored.map((s) => ({ id: s.id, runId: s.externalId, attempt: s.attempt, status: s.duplicate ? 'duplicate' : 'written' })), computed: computedOut(days), ...(calc.queued ? { calculation: 'queued' } : {}) },
      items, errors: [], teamIds: [teamId], valueCount: fresh.length, source,
    };
  });
  if ('replay' in outcome) return sendReplay(res, outcome.replay, hash);
  await afterCommit(caller, outcome.outcome);
  await after(caller.companyId, teamId, outcome.outcome.items);
  return res.status(outcome.outcome.httpStatus).json(outcome.outcome.response);
}

router.post('/tests', ingestLimiter, authenticateApiKey, rawIngestHandler('tests'));
router.post('/coverage', ingestLimiter, authenticateApiKey, rawIngestHandler('coverage'));
router.post('/pipelines', ingestLimiter, authenticateApiKey, rawIngestHandler('pipelines'));

export default router;
