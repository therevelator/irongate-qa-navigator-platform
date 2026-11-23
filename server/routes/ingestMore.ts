/**
 * Raw ingestion of the sources that fill the last typed-in modules (migration 20261209000000):
 *
 *   POST /api/ingest/performance      load-test result files (k6 summary export, JMeter statistics.json,
 *                                     Gatling stats.json) of a pipeline run → the Performance page
 *   POST /api/ingest/test-management  test cases (automated or not, manual estimate) and test executions
 *                                     (TestRail, Xray, Zephyr Scale) → automation_coverage, automation_roi
 *   POST /api/ingest/pull-requests    pull requests (opened, first review, merged; the author as a pseudonym)
 *   POST /api/ingest/calendar         free/busy intervals per person and working day (no titles, no attendees)
 *                                     → the developer metrics (server/lib/developerFromRaw.ts)
 *
 * JSON (a list, or an object with the list), gzip accepted, the team as the query parameter `team`. Same API
 * keys, rate limit and ingestion log as the other ingestion endpoints. Idempotent by the records' own keys: the
 * same record again changes nothing ("duplicate"); a changed record replaces the stored one. ?dryRun=true checks
 * the key, the team and every record and stores nothing. A field the parser does not read is refused, not ignored.
 * Nothing sent here is a calculated value: QE Navigator calculates.
 */
import express from 'express';
import type pg from 'pg';
import { authenticateApiKey, ApiKeyRequest } from '../middleware/apiKey';
import { ingestLimiter } from '../middleware/rateLimit';
import { KpiValidationError, normaliseIdempotencyKey } from '../lib/kpiIngest';
import { findReplay, runLogged, sendReplay, type IngestCaller, type LoggedOutcome } from '../lib/ingestionLog';
import { maybeGunzip, readBody } from '../lib/ingest/body';
import { sha256 } from '../lib/ingest/store';
import { calcOrQueue } from '../lib/calc/queue';
import { automationAffectedDays } from '../lib/calc/automation';
import { mergePerf, parsePerfReport, PerfReportError, type ParsedPerf } from '../lib/ingest/performanceReports';
import { optedInHashes, PERSON_HASH_RE, refreshDeveloperMetrics } from '../lib/developerFromRaw';
import { HttpError, actorOf, after, afterCommit, callerOf, checkTime, computedOut, fail, noAccess, outOfScope, summaryItem, teamOwned, text } from './ingestRaw';

const router = express.Router();

export type MoreKind = 'performance' | 'test-management' | 'pull-requests' | 'calendar' | 'discovery';

const BODY_LIMIT = 10 * 1024 * 1024;
const MAX_ITEMS: Record<MoreKind, number> = { performance: 20, 'test-management': 2000, 'pull-requests': 1000, calendar: 2000, discovery: 1 };
const LIST_KEY: Record<MoreKind, string[]> = {
  performance: ['runs', 'performance'], 'test-management': ['items', 'records'], 'pull-requests': ['pullRequests', 'pull-requests'], calendar: ['days', 'calendar'], discovery: ['reports', 'discovery'],
};

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

function only(o: Record<string, any>, allowed: string[], at: string): void {
  const extra = Object.keys(o).filter((k) => !allowed.includes(k));
  if (extra.length) throw new HttpError(400, `${at}: unknown field(s) ${extra.slice(0, 5).join(', ')} (accepted: ${allowed.join(', ')})`);
}
function str(v: unknown, at: string, max: number, required = false): string | null {
  if (v === undefined || v === null || v === '') { if (required) throw new HttpError(400, `${at} is required`); return null; }
  if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, `${at} must be a string`);
  const s = String(v).trim();
  if (!s) { if (required) throw new HttpError(400, `${at} is required`); return null; }
  if (s.length > max) throw new HttpError(400, `${at} must be at most ${max} characters`);
  return s;
}
function time(v: unknown, at: string, required = false): Date | null {
  if (v === undefined || v === null || v === '') { if (required) throw new HttpError(400, `${at} is required (an ISO 8601 time)`); return null; }
  const d = new Date(typeof v === 'number' ? v : String(v));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${at} must be an ISO 8601 time`);
  return d;
}
function bool(v: unknown, at: string, def = false): boolean {
  if (v === undefined || v === null) return def;
  if (typeof v !== 'boolean') throw new HttpError(400, `${at} must be true or false`);
  return v;
}
function seconds(v: unknown, at: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 366 * 86_400) throw new HttpError(400, `${at} must be a number of seconds (0 or more)`);
  return Math.round(n);
}

// ---------------------------------------------------------------------------------------------
// Parsers (shape and values; nothing is stored here)
// ---------------------------------------------------------------------------------------------

interface PerfRun { runKey: string; commit: string; branch: string | null; repo: string | null; startedAt: Date; report: ParsedPerf }
function parsePerformance(items: unknown[]): PerfRun[] {
  return items.map((raw, i) => {
    const at = `items[${i}]`;
    if (!isObj(raw)) throw new HttpError(400, `${at} must be an object`);
    only(raw, ['files', 'run', 'attempt', 'commit', 'branch', 'repo', 'startedAt'], at);
    if (!Array.isArray(raw.files) || raw.files.length === 0 || raw.files.length > 20) throw new HttpError(400, `${at}.files must list 1 to 20 result files ({ name, content })`);
    const parts = raw.files.map((f: any, j: number) => {
      if (!isObj(f) || typeof f.content !== 'string' || !f.content.length) throw new HttpError(400, `${at}.files[${j}].content must be the file's text`);
      try { return parsePerfReport(f.content, `${at}.files[${j}]${typeof f.name === 'string' ? ` (${f.name.slice(0, 120)})` : ''}`); } catch (e) {
        if (e instanceof PerfReportError) throw new HttpError(415, e.message);
        throw e;
      }
    });
    const startedAt = time(raw.startedAt, `${at}.startedAt`, true) as Date;
    checkTime(startedAt);
    const attempt = raw.attempt === undefined || raw.attempt === null ? 1 : Number(raw.attempt);
    if (!Number.isInteger(attempt) || attempt < 1 || attempt > 1000) throw new HttpError(400, `${at}.attempt must be a whole number from 1`);
    return {
      runKey: `${str(raw.run, `${at}.run`, 180, true)}#${attempt}`, commit: str(raw.commit, `${at}.commit`, 80) ?? '', branch: str(raw.branch, `${at}.branch`, 255),
      repo: str(raw.repo, `${at}.repo`, 255), startedAt, report: mergePerf(parts),
    };
  });
}

interface TmCase { key: string; automated: boolean; manualEstimateS: number | null; archived: boolean; updatedAt: Date | null }
interface TmExecution { key: string; caseKey: string; automated: boolean; status: string | null; executedAt: Date; durationS: number | null }
function parseTestManagement(items: unknown[]): { cases: TmCase[]; executions: TmExecution[] } {
  const cases: TmCase[] = [];
  const executions: TmExecution[] = [];
  items.forEach((raw, i) => {
    const at = `items[${i}]`;
    if (!isObj(raw)) throw new HttpError(400, `${at} must be an object`);
    if (raw.type === 'case') {
      only(raw, ['type', 'key', 'automated', 'manualEstimateSeconds', 'archived', 'updatedAt'], at);
      if (typeof raw.automated !== 'boolean') throw new HttpError(400, `${at}.automated must be true or false (is the test case automated?)`);
      cases.push({ key: str(raw.key, `${at}.key`, 200, true) as string, automated: raw.automated, manualEstimateS: seconds(raw.manualEstimateSeconds, `${at}.manualEstimateSeconds`),
        archived: bool(raw.archived, `${at}.archived`), updatedAt: time(raw.updatedAt, `${at}.updatedAt`) });
    } else if (raw.type === 'execution') {
      only(raw, ['type', 'key', 'case', 'automated', 'status', 'executedAt', 'durationSeconds'], at);
      if (typeof raw.automated !== 'boolean') throw new HttpError(400, `${at}.automated must be true or false (was this an automated run?)`);
      const executedAt = time(raw.executedAt, `${at}.executedAt`, true) as Date;
      checkTime(executedAt);
      executions.push({ key: str(raw.key, `${at}.key`, 200, true) as string, caseKey: str(raw.case, `${at}.case`, 200, true) as string, automated: raw.automated,
        status: str(raw.status, `${at}.status`, 40), executedAt, durationS: seconds(raw.durationSeconds, `${at}.durationSeconds`) });
    } else {
      throw new HttpError(400, `${at}.type must be "case" or "execution"`);
    }
  });
  return { cases, executions };
}

interface PullRequest { key: string; repo: string; author: string | null; state: 'open' | 'merged' | 'closed'; openedAt: Date; firstReviewAt: Date | null; mergedAt: Date | null; closedAt: Date | null }
function hash(v: unknown, at: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !PERSON_HASH_RE.test(v)) throw new HttpError(400, `${at} must be a person pseudonym: sha256(lower(e-mail) + ":" + company id) as 64 hex characters. Names and e-mail addresses are not accepted.`);
  return v;
}
function parsePullRequests(items: unknown[]): PullRequest[] {
  return items.map((raw, i) => {
    const at = `items[${i}]`;
    if (!isObj(raw)) throw new HttpError(400, `${at} must be an object`);
    only(raw, ['id', 'repo', 'author', 'state', 'openedAt', 'firstReviewAt', 'mergedAt', 'closedAt'], at);
    const openedAt = time(raw.openedAt, `${at}.openedAt`, true) as Date;
    checkTime(openedAt);
    const mergedAt = time(raw.mergedAt, `${at}.mergedAt`);
    const closedAt = time(raw.closedAt, `${at}.closedAt`);
    const state = raw.state === undefined || raw.state === null ? (mergedAt ? 'merged' : closedAt ? 'closed' : 'open') : String(raw.state);
    if (!['open', 'merged', 'closed'].includes(state)) throw new HttpError(400, `${at}.state must be open, merged or closed`);
    if (state === 'merged' && !mergedAt) throw new HttpError(400, `${at}.mergedAt is required for a merged pull request`);
    const firstReviewAt = time(raw.firstReviewAt, `${at}.firstReviewAt`);
    for (const [name, t] of [['firstReviewAt', firstReviewAt], ['mergedAt', mergedAt], ['closedAt', closedAt]] as const) {
      if (t && t.getTime() < openedAt.getTime()) throw new HttpError(400, `${at}.${name} is before openedAt`);
    }
    return { key: str(raw.id, `${at}.id`, 200, true) as string, repo: str(raw.repo, `${at}.repo`, 255) ?? '', author: hash(raw.author, `${at}.author`),
      state: state as PullRequest['state'], openedAt, firstReviewAt, mergedAt, closedAt };
  });
}

interface CalendarDay { person: string; day: string; workStart: number; workEnd: number; utcOffset: number; outOfOffice: boolean; busy: Array<{ start: Date; end: Date }> }
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
function minutes(v: unknown, at: string, def: number): number {
  if (v === undefined || v === null || v === '') return def;
  const m = HHMM.exec(String(v));
  if (!m) throw new HttpError(400, `${at} must be a time of day as HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}
function parseCalendar(items: unknown[]): CalendarDay[] {
  return items.map((raw, i) => {
    const at = `items[${i}]`;
    if (!isObj(raw)) throw new HttpError(400, `${at} must be an object`);
    only(raw, ['person', 'day', 'workStart', 'workEnd', 'utcOffsetMinutes', 'outOfOffice', 'busy'], at);
    const person = hash(raw.person, `${at}.person`);
    if (!person) throw new HttpError(400, `${at}.person is required (a person pseudonym)`);
    if (typeof raw.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day) || Number.isNaN(Date.parse(`${raw.day}T00:00:00Z`))) throw new HttpError(400, `${at}.day must be a date as YYYY-MM-DD`);
    checkTime(new Date(`${raw.day}T00:00:00Z`));
    const workStart = minutes(raw.workStart, `${at}.workStart`, 9 * 60);
    const workEnd = minutes(raw.workEnd, `${at}.workEnd`, 17 * 60);
    if (workEnd <= workStart) throw new HttpError(400, `${at}.workEnd must be after workStart`);
    const utcOffset = raw.utcOffsetMinutes === undefined || raw.utcOffsetMinutes === null ? 0 : Number(raw.utcOffsetMinutes);
    if (!Number.isInteger(utcOffset) || Math.abs(utcOffset) > 14 * 60) throw new HttpError(400, `${at}.utcOffsetMinutes must be the day's offset from UTC in minutes (−840 to 840)`);
    if (raw.busy !== undefined && !Array.isArray(raw.busy)) throw new HttpError(400, `${at}.busy must be a list of { start, end }`);
    const list: unknown[] = raw.busy ?? [];
    if (list.length > 200) throw new HttpError(400, `${at}.busy lists at most 200 intervals`);
    const busy = list.map((b, j) => {
      if (!isObj(b)) throw new HttpError(400, `${at}.busy[${j}] must be an object`);
      only(b, ['start', 'end'], `${at}.busy[${j}]`);
      const start = time(b.start, `${at}.busy[${j}].start`, true) as Date;
      const end = time(b.end, `${at}.busy[${j}].end`, true) as Date;
      if (end.getTime() <= start.getTime()) throw new HttpError(400, `${at}.busy[${j}].end must be after start`);
      return { start, end };
    });
    return { person, day: raw.day, workStart, workEnd, utcOffset, outOfOffice: bool(raw.outOfOffice, `${at}.outOfOffice`), busy };
  });
}

// ---------------------------------------------------------------------------------------------
// Stores (each returns how many records changed)
// ---------------------------------------------------------------------------------------------

async function storePerformance(client: pg.PoolClient, companyId: string, teamId: string, runs: PerfRun[]) {
  const out: Array<{ run: string; tool: string; endpoints: number; status: 'written' | 'duplicate' }> = [];
  for (const r of runs) {
    const ins = await client.query(
      `INSERT INTO performance_runs (company_id, team_id, tool, run_key, commit_sha, branch, repo, started_at, day)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date) ON CONFLICT (team_id, run_key) DO NOTHING RETURNING id`,
      [companyId, teamId, r.report.tool, r.runKey, r.commit, r.branch, r.repo, r.startedAt, dayOf(r.startedAt)]);
    if (!ins.rows[0]) { out.push({ run: r.runKey, tool: r.report.tool, endpoints: r.report.rows.length, status: 'duplicate' }); continue; }
    await client.query(
      `INSERT INTO performance_results (run_id, team_id, endpoint, requests, errors, p50_ms, p95_ms, p99_ms, throughput_per_minute, error_rate)
       SELECT $1, $2, x.endpoint, x.requests, x.errors, x.p50, x.p95, x.p99, x."throughputPerMinute", x."errorRate"
         FROM jsonb_to_recordset($3::jsonb) AS x(endpoint text, requests int, errors int, p50 numeric, p95 numeric, p99 numeric, "throughputPerMinute" numeric, "errorRate" numeric)`,
      [ins.rows[0].id, teamId, JSON.stringify(r.report.rows)]);
    out.push({ run: r.runKey, tool: r.report.tool, endpoints: r.report.rows.length, status: 'written' });
  }
  return out;
}

async function storeTestManagement(client: pg.PoolClient, companyId: string, teamId: string, source: string, d: { cases: TmCase[]; executions: TmExecution[] }) {
  let cases = 0;
  let executions = 0;
  if (d.cases.length) {
    cases = (await client.query(
      `INSERT INTO tm_cases (company_id, team_id, source, case_key, automated, manual_estimate_s, archived, updated_at)
       SELECT $1, $2, $3, x.key, x.automated, x."manualEstimateS", x.archived, x."updatedAt"
         FROM jsonb_to_recordset($4::jsonb) AS x(key text, automated boolean, "manualEstimateS" int, archived boolean, "updatedAt" timestamptz)
       ON CONFLICT (team_id, source, case_key) DO UPDATE SET automated = EXCLUDED.automated, manual_estimate_s = EXCLUDED.manual_estimate_s,
         archived = EXCLUDED.archived, updated_at = EXCLUDED.updated_at
        WHERE (tm_cases.automated, tm_cases.manual_estimate_s, tm_cases.archived) IS DISTINCT FROM (EXCLUDED.automated, EXCLUDED.manual_estimate_s, EXCLUDED.archived)
       RETURNING 1`, [companyId, teamId, source, JSON.stringify(dedupe(d.cases))])).rowCount ?? 0;
  }
  if (d.executions.length) {
    executions = (await client.query(
      `INSERT INTO tm_executions (company_id, team_id, source, execution_key, case_key, automated, status, executed_at, day, duration_s)
       SELECT $1, $2, $3, x.key, x."caseKey", x.automated, x.status, x."executedAt", (x."executedAt" AT TIME ZONE 'UTC')::date, x."durationS"
         FROM jsonb_to_recordset($4::jsonb) AS x(key text, "caseKey" text, automated boolean, status text, "executedAt" timestamptz, "durationS" int)
       ON CONFLICT (team_id, source, execution_key) DO UPDATE SET case_key = EXCLUDED.case_key, automated = EXCLUDED.automated, status = EXCLUDED.status,
         executed_at = EXCLUDED.executed_at, day = EXCLUDED.day, duration_s = EXCLUDED.duration_s
        WHERE (tm_executions.case_key, tm_executions.automated, tm_executions.status, tm_executions.executed_at, tm_executions.duration_s)
              IS DISTINCT FROM (EXCLUDED.case_key, EXCLUDED.automated, EXCLUDED.status, EXCLUDED.executed_at, EXCLUDED.duration_s)
       RETURNING 1`, [companyId, teamId, source, JSON.stringify(dedupe(d.executions))])).rowCount ?? 0;
  }
  return { cases, executions };
}

/** The last record of each key (one statement may not touch a row twice). */
function dedupe<T extends { key: string }>(list: T[]): T[] {
  return Array.from(new Map(list.map((x) => [x.key, x])).values());
}

async function storePullRequests(client: pg.PoolClient, companyId: string, teamId: string, source: string, prs: PullRequest[], optedIn: Map<string, string>) {
  // The author is kept only as the pseudonym of a user who enabled developer insights.
  const rows = dedupe(prs.map((p) => ({ ...p, key: JSON.stringify([p.repo, p.key]), prKey: p.key, author: p.author && optedIn.has(p.author) ? p.author : null })));
  const changed = (await client.query(
    `INSERT INTO pull_requests_raw (company_id, team_id, source, repo, pr_key, author_hash, state, opened_at, first_review_at, merged_at, closed_at)
     SELECT $1, $2, $3, x.repo, x."prKey", x.author, x.state, x."openedAt", x."firstReviewAt", x."mergedAt", x."closedAt"
       FROM jsonb_to_recordset($4::jsonb) AS x(repo text, "prKey" text, author text, state text, "openedAt" timestamptz, "firstReviewAt" timestamptz, "mergedAt" timestamptz, "closedAt" timestamptz)
     ON CONFLICT (team_id, source, repo, pr_key) DO UPDATE SET author_hash = EXCLUDED.author_hash, state = EXCLUDED.state, opened_at = EXCLUDED.opened_at,
       first_review_at = EXCLUDED.first_review_at, merged_at = EXCLUDED.merged_at, closed_at = EXCLUDED.closed_at
      WHERE (pull_requests_raw.author_hash, pull_requests_raw.state, pull_requests_raw.opened_at, pull_requests_raw.first_review_at, pull_requests_raw.merged_at, pull_requests_raw.closed_at)
            IS DISTINCT FROM (EXCLUDED.author_hash, EXCLUDED.state, EXCLUDED.opened_at, EXCLUDED.first_review_at, EXCLUDED.merged_at, EXCLUDED.closed_at)
     RETURNING 1`, [companyId, teamId, source, JSON.stringify(rows)])).rowCount ?? 0;
  return { changed, withAuthor: rows.filter((r) => r.author).length };
}

async function storeCalendar(client: pg.PoolClient, companyId: string, teamId: string, days: CalendarDay[], optedIn: Map<string, string>) {
  // A day of someone who did not enable developer insights is not kept at all.
  const kept = Array.from(new Map(days.filter((d) => optedIn.has(d.person)).map((d) => [`${d.person}|${d.day}`, d])).values());
  let changed = 0;
  for (const d of kept) {
    const busy = JSON.stringify(d.busy.map((b) => [b.start.toISOString(), b.end.toISOString()]).sort());
    const prev = (await client.query(
      `SELECT d.work_start_min, d.work_end_min, d.utc_offset_min, d.out_of_office,
              COALESCE((SELECT json_agg(json_build_array(to_char(b.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(b.end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY b.start_at, b.end_at)
                          FROM calendar_busy b WHERE b.team_id = d.team_id AND b.person_hash = d.person_hash AND b.day = d.day), '[]'::json) AS busy
         FROM calendar_days d WHERE d.team_id = $1 AND d.person_hash = $2 AND d.day = $3::date`, [teamId, d.person, d.day])).rows[0];
    if (prev && prev.work_start_min === d.workStart && prev.work_end_min === d.workEnd && prev.utc_offset_min === d.utcOffset && prev.out_of_office === d.outOfOffice && JSON.stringify(prev.busy) === busy) continue;
    await client.query(
      `INSERT INTO calendar_days (company_id, team_id, person_hash, day, work_start_min, work_end_min, utc_offset_min, out_of_office, received_at)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, now())
       ON CONFLICT (team_id, person_hash, day) DO UPDATE SET work_start_min = EXCLUDED.work_start_min, work_end_min = EXCLUDED.work_end_min,
         utc_offset_min = EXCLUDED.utc_offset_min, out_of_office = EXCLUDED.out_of_office, received_at = now()`,
      [companyId, teamId, d.person, d.day, d.workStart, d.workEnd, d.utcOffset, d.outOfOffice]);
    await client.query('DELETE FROM calendar_busy WHERE team_id = $1 AND person_hash = $2 AND day = $3::date', [teamId, d.person, d.day]);
    if (d.busy.length) {
      await client.query(
        `INSERT INTO calendar_busy (team_id, person_hash, day, start_at, end_at)
         SELECT $1, $2, $3::date, (x->>0)::timestamptz, (x->>1)::timestamptz FROM jsonb_array_elements($4::jsonb) AS x`, [teamId, d.person, d.day, busy]);
    }
    changed += 1;
  }
  return { changed, kept: kept.length, notOptedIn: days.length - days.filter((d) => optedIn.has(d.person)).length };
}

// ---------------------------------------------------------------------------------------------
// Discovery: what the Exporter found in a tool on its last run (no records of the customer, only counts and names
// of jobs / projects it could not map). One report per team and source; the latest replaces the one before.
// ---------------------------------------------------------------------------------------------

const DISCOVERY_COUNTS = ['pipelineRuns', 'testReports', 'coverageReports', 'sarifReports', 'deployments', 'commits', 'pullRequests', 'performanceRuns', 'issues', 'incidents'];

export interface Discovery { from: string | null; to: string | null; counts: Record<string, number>; runsWithoutTests: number | null; runsWithoutCoverage: number | null; unmapped: string[]; notes: string[] }

export function parseDiscovery(items: unknown[]): Discovery {
  const raw = items[0];
  if (!isObj(raw)) throw new HttpError(400, 'items[0] must be an object');
  only(raw, ['from', 'to', 'counts', 'runsWithoutTests', 'runsWithoutCoverage', 'unmapped', 'notes'], 'items[0]');
  const whole = (v: unknown, at: string): number | null => {
    if (v === null || v === undefined) return null;
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 1e7) throw new HttpError(400, `${at} must be a whole number`);
    return v as number;
  };
  const counts: Record<string, number> = {};
  if (raw.counts !== undefined) {
    if (!isObj(raw.counts)) throw new HttpError(400, 'items[0].counts must be an object');
    only(raw.counts, DISCOVERY_COUNTS, 'items[0].counts');
    for (const k of Object.keys(raw.counts)) counts[k] = whole(raw.counts[k], `items[0].counts.${k}`) ?? 0;
  }
  const list = (v: unknown, at: string, max: number): string[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > max) throw new HttpError(400, `${at} must be a list of at most ${max} names`);
    return v.map((x, i) => str(x, `${at}[${i}]`, 200, true) as string);
  };
  const from = time(raw.from, 'items[0].from');
  const to = time(raw.to, 'items[0].to');
  return {
    from: from ? from.toISOString() : null, to: to ? to.toISOString() : null, counts,
    runsWithoutTests: whole(raw.runsWithoutTests, 'items[0].runsWithoutTests'), runsWithoutCoverage: whole(raw.runsWithoutCoverage, 'items[0].runsWithoutCoverage'),
    unmapped: list(raw.unmapped, 'items[0].unmapped', 50), notes: list(raw.notes, 'items[0].notes', 20),
  };
}

async function storeDiscovery(client: pg.PoolClient, companyId: string, teamId: string, source: string, d: Discovery, version: string | null): Promise<void> {
  await client.query(
    `INSERT INTO exporter_discovery (team_id, source, company_id, exporter_version, reported_at, report) VALUES ($1, $2, $3, $4, now(), $5::jsonb)
     ON CONFLICT (team_id, source) DO UPDATE SET report = EXCLUDED.report, reported_at = now(), exporter_version = EXCLUDED.exporter_version, company_id = EXCLUDED.company_id`,
    [teamId, source, companyId, version, JSON.stringify(d)]);
}

// ---------------------------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------------------------

const SOURCE_RE = /^[a-z0-9][a-z0-9_.-]{0,49}$/;

export function moreIngestHandler(kind: MoreKind) {
  return async (req: ApiKeyRequest, res: express.Response) => {
    const caller: IngestCaller = callerOf(req);
    let key: string | null = null;
    let hashOf: string | null = null;
    let teamId: string | null = null;
    try {
      try { key = normaliseIdempotencyKey(req.get('Idempotency-Key'), 'Idempotency-Key'); } catch (e) { throw new HttpError(400, (e as KpiValidationError).message); }
      const payload = maybeGunzip(await readBody(req, BODY_LIMIT), req.headers['content-encoding'] as string | undefined);
      hashOf = sha256(payload);
      if (key) {
        const replay = await findReplay(caller, key);
        if (replay) return sendReplay(res, replay, hashOf);
      }
      if (!payload.length) throw new HttpError(400, 'Empty body: send the records as JSON');
      let body: any;
      try { body = JSON.parse(text(payload)); } catch { throw new HttpError(400, 'The body must be JSON (Content-Type: application/json)'); }
      const q = req.query as Record<string, any>;
      teamId = String(q.team ?? q.teamId ?? '').trim() || null;
      if (!teamId) throw new HttpError(400, 'team is required (query parameter)');
      const source = String(q.source ?? kind).trim().toLowerCase();
      if (!SOURCE_RE.test(source)) throw new HttpError(400, 'source must be a short name (lowercase letters, digits, "_", "-", ".")');
      const items: unknown = Array.isArray(body) ? body : isObj(body) ? LIST_KEY[kind].map((k) => body[k]).find(Array.isArray) ?? [body] : null;
      if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS[kind]) throw new HttpError(400, `Send 1 to ${MAX_ITEMS[kind]} ${kind} records`);

      const parsed = kind === 'discovery' ? parseDiscovery(items) : kind === 'performance' ? parsePerformance(items) : kind === 'test-management' ? parseTestManagement(items)
        : kind === 'pull-requests' ? parsePullRequests(items) : parseCalendar(items);
      if (!(await teamOwned(caller.companyId, teamId, caller)) || outOfScope(caller, [teamId]).length) throw new HttpError(403, noAccess(caller, [teamId]));
      if (q.dryRun === 'true' || q.dryRun === '1') {
        return res.status(200).json({ status: 'dry-run', kind, team: teamId, records: items.length, message: 'Key, team and records are valid. Nothing was stored.' });
      }

      const team = teamId;
      const summary = [summaryItem(team, source, new Date().toISOString(), 'written')];
      const outcome = await runLogged(caller, { key, hash: hashOf, source }, async (client, ingestionId): Promise<LoggedOutcome> => {
        let changed = 0;
        let response: Record<string, unknown> = {};
        if (kind === 'discovery') {
          const version = /qe-exporter\/([0-9][0-9A-Za-z.+-]*)/.exec(String(req.get('User-Agent') ?? ''))?.[1] ?? null;
          await storeDiscovery(client, caller.companyId, team, source, parsed as Discovery, version);
          changed = 1;
          response = { report: 'stored' };
        } else if (kind === 'performance') {
          const runs = await storePerformance(client, caller.companyId, team, parsed as PerfRun[]);
          changed = runs.filter((r) => r.status === 'written').length;
          response = { runs };
        } else if (kind === 'test-management') {
          const d = parsed as { cases: TmCase[]; executions: TmExecution[] };
          const n = await storeTestManagement(client, caller.companyId, team, source, d);
          changed = n.cases + n.executions;
          response = { cases: { received: d.cases.length, changed: n.cases }, executions: { received: d.executions.length, changed: n.executions } };
          if (changed) {
            const days = automationAffectedDays([dayOf(new Date()), ...d.executions.map((e) => dayOf(e.executedAt))]);
            const calc = await calcOrQueue(client, caller.companyId, team, days, { groups: ['automation'], ingestionId, actorId: actorOf(caller) });
            summary[0].metrics = Array.from(new Set(calc.days.flatMap((x) => x.metrics.filter((m) => m.written).map((m) => m.kpi as string))));
            response.computed = computedOut(calc.days).slice(-1);
            if (calc.queued) response.calculation = 'queued';
          }
        } else {
          const optedIn = await optedInHashes(client, caller.companyId);
          if (kind === 'pull-requests') {
            const n = await storePullRequests(client, caller.companyId, team, source, parsed as PullRequest[], optedIn);
            changed = n.changed;
            response = { pullRequests: { received: (parsed as PullRequest[]).length, changed: n.changed, withAuthor: n.withAuthor } };
          } else {
            const n = await storeCalendar(client, caller.companyId, team, parsed as CalendarDay[], optedIn);
            changed = n.changed;
            response = { days: { received: (parsed as CalendarDay[]).length, kept: n.kept, changed: n.changed, notOptedIn: n.notOptedIn } };
          }
          if (changed) response.developers = await refreshDeveloperMetrics(client, team);
        }
        if (!changed) summary[0].status = 'duplicate';
        return {
          status: 'accepted', httpStatus: changed ? 201 : 200, response: { status: changed ? 'accepted' : 'duplicate', kind, team, ...response },
          items: summary, errors: [], teamIds: [team], valueCount: changed, source,
        };
      });
      if ('replay' in outcome) return sendReplay(res, outcome.replay, hashOf);
      await afterCommit(caller, outcome.outcome);
      await after(caller.companyId, team, outcome.outcome.items);
      return res.status(outcome.outcome.httpStatus).json(outcome.outcome.response);
    } catch (e) {
      return fail(res, caller, key, hashOf, teamId, kind, e);
    }
  };
}

router.post('/performance', ingestLimiter, authenticateApiKey, moreIngestHandler('performance'));
router.post('/test-management', ingestLimiter, authenticateApiKey, moreIngestHandler('test-management'));
router.post('/pull-requests', ingestLimiter, authenticateApiKey, moreIngestHandler('pull-requests'));
router.post('/calendar', ingestLimiter, authenticateApiKey, moreIngestHandler('calendar'));
router.post('/discovery', ingestLimiter, authenticateApiKey, moreIngestHandler('discovery'));

export default router;
