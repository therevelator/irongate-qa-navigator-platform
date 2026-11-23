/**
 * The work of scripts/privacy/purge-raw-payloads.ts (the runner; this file has no side effects, so the tests import
 * it). One-off privacy purge of raw_uploads.payload: every stored copy that is still the request body as received is
 * replaced by the minimised copy new requests keep (server/lib/ingest/minimiseStore.ts), or cleared when the body
 * cannot be read again. Then scripts/privacy/purge-raw-payloads.sql applies the result in one transaction.
 *
 *   DATABASE_URL=postgres://… npx tsx scripts/privacy/purge-raw-payloads.ts                 dry run: counts per kind, writes nothing
 *   DATABASE_URL=postgres://… npx tsx scripts/privacy/purge-raw-payloads.ts --apply         rewrite (local database only)
 *   DATABASE_URL=postgres://… npx tsx scripts/privacy/purge-raw-payloads.ts --apply --host=db.example.com
 *                                                                                            rewrite on that host (must match DATABASE_URL)
 *   --company=<id>  only that company's rows; --team=<id> only that team's
 *
 * What is kept per kind is what the server keeps for a new request (the allow-list RAW_ALLOW_LIST and FIELD_ALLOW_LIST):
 * test cases without messages, coverage file totals without home-directory prefixes, pipeline runs and stages,
 * SARIF findings without messages, deployments and commits with the author as the salted hash only, and issues and
 * incidents through the field allow-list. A copy already minimised is left as it is. Prints counts only, never data.
 */
import { gunzipSync, gzipSync } from 'zlib';
import type pg from 'pg';
import { parseTestReport, type TestFormat } from '../../server/lib/ingest/testReports';
import { parseCoverageReport, type CoverageFormat } from '../../server/lib/ingest/coverageReports';
import { parsePipelineBody } from '../../server/lib/ingest/pipelineEvents';
import { parseSarif } from '../../server/lib/ingest/sarif';
import { parseCommitBody, parseDeploymentBody, parseIncidentBody } from '../../server/lib/ingest/deliveryEvents';
import { parseIssueBody, type IssueFormat } from '../../server/lib/ingest/issueEvents';
import {
  applyIncidentAllowList, applyIssueAllowList, minimisedAnalysisPayload, minimisedCommitPayload, minimisedCoveragePayload, minimisedDeploymentPayload,
  minimisedIncidentPayload, minimisedIssuePayload, minimisedPipelinePayload, minimisedTestPayload,
} from '../../server/lib/ingest/minimiseStore';
import { RAW_PAYLOAD_MAX_BYTES } from '../../server/lib/ingest/store';

export interface PurgeCounts { [kind: string]: { rows: number; alreadyMinimised: number; rewritten: number; cleared: number } }

interface Row { id: string; company_id: string; team_id: string; kind: string; format: string | null; payload: Buffer }

const text = (b: Buffer) => { const s = b.toString('utf8'); return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; };

/** Already a minimised copy (the shapes minimiseStore.ts writes). */
function isMinimised(kind: string, body: string): boolean {
  if (!body.startsWith('{"minimised":true')) return false;
  try {
    const o = JSON.parse(body);
    if (o?.minimised !== true) return false;
    if (kind === 'issues') return Array.isArray(o.issues);
    if (kind === 'incidents') return Array.isArray(o.incidents);
    return o.kind === kind;
  } catch {
    return false;
  }
}

/** The minimised copy of a stored body (as new requests keep it); null when the body cannot be read again. */
export function minimiseStored(row: Pick<Row, 'company_id' | 'team_id' | 'kind' | 'format'>, body: string, storeTitles: boolean): Buffer | null {
  const fmt = (row.format ?? '').toLowerCase();
  try {
    switch (row.kind) {
      case 'tests': return minimisedTestPayload(parseTestReport(body, fmt as TestFormat));
      case 'coverage': return minimisedCoveragePayload(parseCoverageReport(body, fmt as CoverageFormat));
      case 'static-analysis': return minimisedAnalysisPayload(parseSarif(body));
      case 'pipelines': {
        const b = JSON.parse(body);
        const list = b && typeof b === 'object' && !Array.isArray(b) && !Array.isArray(b.runs) ? (() => { const { team: _t, teamId: _ti, ...rest } = b; return rest; })() : b;
        return minimisedPipelinePayload(parsePipelineBody(list, {}));
      }
      case 'deployments': {
        const events = parseDeploymentBody(JSON.parse(body), fmt || 'json').events.filter((e) => !e.team || e.team === row.team_id);
        return minimisedDeploymentPayload(row.company_id, events);
      }
      case 'commits': {
        const batches = parseCommitBody(JSON.parse(body), fmt || 'json').filter((b) => !b.team || b.team === row.team_id);
        return minimisedCommitPayload(row.company_id, batches);
      }
      case 'incidents': {
        const events = parseIncidentBody(JSON.parse(body), fmt || 'json').filter((e) => !e.team || e.team === row.team_id);
        applyIncidentAllowList(events, storeTitles);
        return minimisedIncidentPayload(row.company_id, events, storeTitles);
      }
      case 'issues': {
        const p = parseIssueBody(JSON.parse(body), (fmt || 'json') as IssueFormat, {});
        const issues = p.issues.filter((e) => !e.team || e.team === row.team_id);
        applyIssueAllowList(issues, storeTitles);
        return minimisedIssuePayload(row.company_id, issues, p.sprints, storeTitles);
      }
      default: return null;
    }
  } catch {
    return null;
  }
}

/**
 * Rebuild every payload (of one company when given) and, with apply, write the result through PURGE_SQL in one
 * transaction (opts.sql: the text of purge-raw-payloads.sql). Returns the counts per kind.
 */
export async function purgeRawPayloads(client: pg.ClientBase, opts: { apply: boolean; sql: string; companyId?: string | null; teamId?: string | null; log?: (s: string) => void }): Promise<PurgeCounts> {
  const log = opts.log ?? (() => undefined);
  const counts: PurgeCounts = {};
  const titles = new Map<string, boolean>();
  const storeTitlesOf = async (companyId: string) => {
    if (!titles.has(companyId)) {
      const r = await client.query(`SELECT to_jsonb(c)->>'store_issue_titles' AS t FROM companies c WHERE id = $1`, [companyId]);
      titles.set(companyId, r.rows[0]?.t !== 'false');
    }
    return titles.get(companyId)!;
  };
  await client.query('BEGIN');
  try {
    await client.query('CREATE TEMP TABLE raw_payload_purge (id varchar(36) PRIMARY KEY, payload bytea) ON COMMIT DROP');
    const ids = (await client.query(
      `SELECT id FROM raw_uploads WHERE payload IS NOT NULL AND ($1::varchar IS NULL OR company_id = $1) AND ($2::varchar IS NULL OR team_id = $2) ORDER BY id`,
      [opts.companyId ?? null, opts.teamId ?? null])).rows.map((r) => r.id as string);
    const BATCH = 100;
    for (let i = 0; i < ids.length; i += BATCH) {
      const rows = (await client.query<Row>('SELECT id, company_id, team_id, kind, format, payload FROM raw_uploads WHERE id = ANY($1::varchar[]) ORDER BY id', [ids.slice(i, i + BATCH)])).rows;
      const out: Array<{ id: string; payload: Buffer | null }> = [];
      for (const row of rows) {
        const c = (counts[row.kind] ??= { rows: 0, alreadyMinimised: 0, rewritten: 0, cleared: 0 });
        c.rows++;
        let body: string | null = null;
        try { body = text(gunzipSync(row.payload)); } catch { body = null; }
        if (body !== null && isMinimised(row.kind, body)) { c.alreadyMinimised++; continue; }
        const kept = body === null ? null : minimiseStored(row, body, await storeTitlesOf(row.company_id));
        const gz = kept ? gzipSync(kept) : null;
        const payload = gz && (RAW_PAYLOAD_MAX_BYTES <= 0 || gz.length <= RAW_PAYLOAD_MAX_BYTES) ? gz : null;
        if (payload) c.rewritten++; else c.cleared++;
        out.push({ id: row.id, payload });
      }
      if (out.length) {
        await client.query('INSERT INTO raw_payload_purge (id, payload) SELECT x.id, x.p FROM unnest($1::varchar[], $2::bytea[]) AS x(id, p)', [out.map((o) => o.id), out.map((o) => o.payload)]);
      }
      log(`  ${Math.min(i + BATCH, ids.length)} of ${ids.length} payloads read`);
    }
    if (opts.apply) {
      await client.query(opts.sql);
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }
    return counts;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}
