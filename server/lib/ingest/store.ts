/**
 * Raw store writes (migration 20261129000000): raw_uploads plus the parsed rows of each kind.
 * All inside the caller's transaction. Idempotent by team + kind + commit + run id + attempt:
 * a second upload with the same identity writes nothing and returns the first one's id.
 */
import type pg from 'pg';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';
import { failureHash, testKey, type ParsedTestReport } from './testReports';
import type { ChangedLines, ParsedCoverage } from './coverageReports';
import { changedCoverage } from './coverageReports';
import type { PipelineRunEvent } from './pipelineEvents';

export type RawKind = 'tests' | 'coverage' | 'pipelines' | 'deployments' | 'commits' | 'incidents' | 'issues' | 'static-analysis';

/** Gzipped payloads are kept when at most this size (RAW_PAYLOAD_MAX_KB, default 512 KB); 0 keeps none. */
export const RAW_PAYLOAD_MAX_BYTES = (process.env.RAW_PAYLOAD_MAX_KB !== undefined ? Number(process.env.RAW_PAYLOAD_MAX_KB) : 512) * 1024;

export interface UploadMeta {
  companyId: string;
  teamId: string;
  kind: RawKind;
  format: string;
  commit: string;
  branch: string | null;
  runId: string;
  attempt: number;
  payload: Buffer;
  apiKeyId: string | null;
  ingestionId: string | null;
  parseMs: number;
  summary: Record<string, unknown>;
  /** The repository of a test or coverage report (a dimension of the evidence; null when not sent). */
  repo?: string | null;
  /** Lines of code sent with a coverage report (defect density and code quality denominator). */
  loc?: number | null;
}

export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Insert the raw_uploads row; null when an upload with the same identity already exists. */
export async function insertUpload(client: pg.PoolClient, m: UploadMeta): Promise<{ id: string } | { duplicateOf: string }> {
  let stored: Buffer | null = null;
  if (RAW_PAYLOAD_MAX_BYTES > 0) {
    const gz = gzipSync(m.payload);
    if (gz.length <= RAW_PAYLOAD_MAX_BYTES) stored = gz;
  }
  const r = await client.query(
    `INSERT INTO raw_uploads (company_id, team_id, kind, format, commit_sha, branch, run_id, attempt, size_bytes, stored_bytes, sha256, payload,
                              status, summary, parse_ms, ingestion_id, api_key_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'parsed', $13::jsonb, $14, $15, $16)
     ON CONFLICT (team_id, kind, commit_sha, run_id, attempt) WHERE status = 'parsed' DO NOTHING RETURNING id`,
    [m.companyId, m.teamId, m.kind, m.format, m.commit, m.branch, m.runId, m.attempt, m.payload.length, stored?.length ?? null,
      sha256(m.payload), stored, JSON.stringify(m.summary), m.parseMs, m.ingestionId, m.apiKeyId]
  );
  if (r.rows.length) return { id: r.rows[0].id };
  const ex = await client.query(
    `SELECT id FROM raw_uploads WHERE team_id = $1 AND kind = $2 AND commit_sha = $3 AND run_id = $4 AND attempt = $5 AND status = 'parsed'`,
    [m.teamId, m.kind, m.commit, m.runId, m.attempt]
  );
  return { duplicateOf: ex.rows[0]?.id ?? '' };
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export async function storeTestRun(client: pg.PoolClient, m: UploadMeta, uploadId: string, rep: ParsedTestReport, at: Date, opts: { id?: string; sample?: boolean } = {}): Promise<{ runId: string; day: string }> {
  const id = opts.id;
  const r = await client.query(
    `INSERT INTO test_runs (${id ? 'id, ' : ''}company_id, team_id, upload_id, format, commit_sha, branch, run_id, attempt, started_at, day,
                            total, passed, failed, errored, skipped, duration_ms, tests_duration_ms, is_sample, repo)
     VALUES (${id ? '$18, ' : ''}$1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::date, $11, $12, $13, $14, $15, $16, $17, ${id ? '$19, $20' : '$18, $19'}) RETURNING id`,
    [m.companyId, m.teamId, uploadId, rep.format, m.commit, m.branch, m.runId, m.attempt, at.toISOString(), dayOf(at),
      rep.counts.total, rep.counts.passed, rep.counts.failed, rep.counts.errored, rep.counts.skipped, rep.durationMs, rep.testsDurationMs,
      ...(id ? [id] : []), !!opts.sample, m.repo ?? null]
  );
  const runId: string = r.rows[0].id;
  await insertTestResults(client, runId, m.teamId, rep);
  return { runId, day: dayOf(at) };
}

export async function insertTestResults(client: pg.PoolClient, runId: string, teamId: string, rep: ParsedTestReport): Promise<void> {
  const CHUNK = 5000;
  for (let i = 0; i < rep.cases.length; i += CHUNK) {
    const part = rep.cases.slice(i, i + CHUNK);
    await client.query(
      `INSERT INTO test_results (test_run_id, team_id, test_key, suite, name, status, duration_ms, retries, failure_hash, failure_message)
       SELECT $1, $2, x.k, x.s, x.n, x.st, x.d, x.r, x.fh, x.fm
         FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::int[], $9::text[], $10::text[]) AS x(k, s, n, st, d, r, fh, fm)`,
      [runId, teamId, part.map((c) => testKey(c.suite, c.name)), part.map((c) => c.suite), part.map((c) => c.name), part.map((c) => c.status),
        part.map((c) => Math.min(c.durationMs, 2_000_000_000)), part.map((c) => c.retries), part.map((c) => failureHash(c.message)), part.map((c) => c.message)]
    );
  }
}

export async function storeCoverage(client: pg.PoolClient, m: UploadMeta, uploadId: string, cov: ParsedCoverage, at: Date, changed: ChangedLines | null, opts: { id?: string; sample?: boolean } = {}): Promise<{ reportId: string; day: string; changed: { found: number; hit: number } | null }> {
  const ch = changed ? changedCoverage(cov, changed) : null;
  const r = await client.query(
    `INSERT INTO coverage_reports (${opts.id ? 'id, ' : ''}company_id, team_id, upload_id, format, commit_sha, branch, run_id, attempt, created_at, day,
                                   lines_found, lines_hit, branches_found, branches_hit, file_count, changed_lines_found, changed_lines_hit, is_sample, repo, lines_of_code)
     VALUES (${opts.id ? '$21, ' : ''}$1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::date, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING id`,
    [m.companyId, m.teamId, uploadId, cov.format, m.commit, m.branch, m.runId, m.attempt, at.toISOString(), dayOf(at),
      cov.totals.linesFound, cov.totals.linesHit, cov.totals.branchesFound, cov.totals.branchesHit, cov.files.length,
      ch ? ch.found : null, ch ? ch.hit : null, !!opts.sample, m.repo ?? null, m.loc ?? null, ...(opts.id ? [opts.id] : [])]
  );
  const reportId: string = r.rows[0].id;
  const CHUNK = 5000;
  for (let i = 0; i < cov.files.length; i += CHUNK) {
    const part = cov.files.slice(i, i + CHUNK);
    await client.query(
      `INSERT INTO coverage_files (report_id, team_id, path, lines_found, lines_hit, branches_found, branches_hit, changed_found, changed_hit)
       SELECT $1, $2, x.p, x.lf, x.lh, x.bf, x.bh, x.cf, x.chh
         FROM unnest($3::text[], $4::int[], $5::int[], $6::int[], $7::int[], $8::int[], $9::int[]) AS x(p, lf, lh, bf, bh, cf, chh)`,
      [reportId, m.teamId, part.map((f) => f.path), part.map((f) => f.linesFound), part.map((f) => f.linesHit), part.map((f) => f.branchesFound),
        part.map((f) => f.branchesHit), part.map((f) => ch?.perFile.get(f.path)?.found ?? null), part.map((f) => ch?.perFile.get(f.path)?.hit ?? null)]
    );
  }
  return { reportId, day: dayOf(at), changed: ch ? { found: ch.found, hit: ch.hit } : null };
}

/**
 * Insert pipeline runs; a run (team, id, attempt) already stored is skipped. Returns every run with its status.
 * Multi-row: one INSERT for the runs, one SELECT for the ids of the runs already stored (only when there are any)
 * and one INSERT for the stages of the new runs, whatever the number of runs (each round trip costs ~80 ms in
 * production, where the functions and the database are in different regions).
 */
export async function storePipelineRuns(client: pg.PoolClient, companyId: string, teamId: string, uploadId: string | null, runs: PipelineRunEvent[], opts: { idPrefix?: string; sample?: boolean } = {}): Promise<Array<{ id: string; externalId: string; attempt: number; day: string; duplicate: boolean }>> {
  if (!runs.length) return [];
  // The same run twice in one request: the first one is stored, the next ones are duplicates of it.
  const keyOf = (r: PipelineRunEvent) => `${r.id}\u0000${r.attempt}`;
  const first = new Map<string, number>();
  runs.forEach((r, i) => { if (!first.has(keyOf(r))) first.set(keyOf(r), i); });
  const fresh = runs.map((r, i) => ({ r, i })).filter(({ r, i }) => first.get(keyOf(r)) === i);
  const col = <T>(f: (r: PipelineRunEvent, i: number) => T) => fresh.map(({ r, i }) => f(r, i));
  const ins = await client.query(
    `INSERT INTO pipeline_runs_raw (${opts.idPrefix ? 'id, ' : ''}company_id, team_id, upload_id, external_id, attempt, name, commit_sha, branch, started_at, finished_at, duration_s, result, url, day, is_sample)
     SELECT ${opts.idPrefix ? 'x.id, ' : ''}$1, $2, $3, x.ext, x.att, x.nm, x.sha, x.br, x.st, x.fi, x.dur, x.res, x.url, x.day, $4
       FROM unnest($5::text[], $6::int[], $7::text[], $8::text[], $9::text[], $10::timestamptz[], $11::timestamptz[], $12::int[], $13::text[], $14::text[], $15::date[], $16::text[])
            AS x(ext, att, nm, sha, br, st, fi, dur, res, url, day, id)
     ON CONFLICT (team_id, external_id, attempt) DO NOTHING RETURNING id, external_id, attempt`,
    [companyId, teamId, uploadId, !!opts.sample, col((r) => r.id), col((r) => r.attempt), col((r) => r.name), col((r) => r.commit), col((r) => r.branch),
      col((r) => r.startedAt.toISOString()), col((r) => r.finishedAt?.toISOString() ?? null), col((r) => r.durationS), col((r) => r.result), col((r) => r.url),
      col((r) => dayOf(r.startedAt)), col((_r, i) => (opts.idPrefix ? `${opts.idPrefix}-${i}` : null))]
  );
  const inserted = new Map<string, string>(ins.rows.map((x: any) => [`${x.external_id}\u0000${x.attempt}`, x.id as string]));
  const existing = new Map<string, string>();
  const missing = fresh.filter(({ r }) => !inserted.has(keyOf(r)));
  if (missing.length) {
    const ex = await client.query(
      `SELECT p.id, p.external_id, p.attempt FROM pipeline_runs_raw p JOIN unnest($2::text[], $3::int[]) AS x(ext, att) ON p.external_id = x.ext AND p.attempt = x.att
        WHERE p.team_id = $1`, [teamId, missing.map(({ r }) => r.id), missing.map(({ r }) => r.attempt)]);
    for (const x of ex.rows) existing.set(`${x.external_id}\u0000${x.attempt}`, x.id);
  }
  const stages = fresh.filter(({ r }) => inserted.has(keyOf(r))).flatMap(({ r }) => r.stages.map((s) => ({ run: inserted.get(keyOf(r))!, s })));
  if (stages.length) {
    await client.query(
      `INSERT INTO pipeline_stage_runs (pipeline_run_id, team_id, name, kind, parallel_group, started_at, finished_at, duration_s, result)
       SELECT x.run, $1, x.n, x.k, x.g, x.st, x.fi, x.d, x.r
         FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::timestamptz[], $7::timestamptz[], $8::int[], $9::text[]) WITH ORDINALITY AS x(run, n, k, g, st, fi, d, r, o)
        ORDER BY x.o`,
      [teamId, stages.map((x) => x.run), stages.map((x) => x.s.name), stages.map((x) => x.s.kind), stages.map((x) => x.s.parallelGroup),
        stages.map((x) => x.s.startedAt?.toISOString() ?? null), stages.map((x) => x.s.finishedAt?.toISOString() ?? null), stages.map((x) => x.s.durationS), stages.map((x) => x.s.result)]
    );
  }
  return runs.map((r, i) => {
    const k = keyOf(r);
    const own = first.get(k) === i ? inserted.get(k) : undefined;
    return own
      ? { id: own, externalId: r.id, attempt: r.attempt, day: dayOf(r.startedAt), duplicate: false }
      : { id: inserted.get(k) ?? existing.get(k) ?? '', externalId: r.id, attempt: r.attempt, day: dayOf(r.startedAt), duplicate: true };
  });
}
