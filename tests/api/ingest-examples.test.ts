/**
 * The input examples of docs/DATA_FLOW.md (docs/examples/ingest/*.json) are accepted by the real API and feed every
 * indicator the document says they feed. Run against the live API (API_URL) and the local database.
 *
 *   IE-001  every example is accepted as a dry run, and the dry run stores nothing
 *   IE-002  every example is accepted for real (coverage first: defect density needs it); a repeat with the same
 *           Idempotency-Key is replayed; the issues envelope is sent gzipped (Content-Type: application/gzip)
 *   IE-003  every field present in the examples was stored (raw tables, or the minimised copy in raw_uploads)
 *   IE-004  after the calculation queue drained (INGEST_CALC=queued: in the API process; inline: in the request),
 *           all 30 engine metrics have evidence, the 21 KPI columns with a raw source have computed values, the
 *           kpis kind stored all 23 columns, and the QA score is set from computed inputs only
 *   IE-006  the Overview, the team page and Business impact for this real company: Pipeline health counts the runs
 *           sent (pipeline_runs_raw through the engine's evidence), Tech debt health comes from the SARIF findings,
 *           the quality side of Business impact is derived from the KPI values (source "ingested"), and none of
 *           them reads a sample-only table (the legacy pipeline_runs, generated technical debt, synthetic months)
 *   IE-007  fields: priority, repo and loc are stored and used (evidence, the repo filter, defect density's lines of
 *           code); a field the API has no use for is refused with a message, never silently ignored
 *   IE-005  completeness: every field the handlers accept (envelope and report allow-lists, the field allow-list,
 *           the KPI columns) is in the examples, and every other name the parsers read (aliases) is in the doc;
 *           the doc's indicator table names every engine metric and KPI column
 *
 * The examples are dated for 2026-11-23; the test moves every timestamp by the whole days since then, so the data
 * keeps the same shape (and stays inside the 365-day window) on any day the test runs.
 */
import fs from 'fs';
import path from 'path';
import { gzipSync, gunzipSync } from 'zlib';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';
import { FIELD_ALLOW_LIST } from '../../server/lib/ingest/fieldAllowList';
import { KPI_COLUMNS } from '../../server/lib/kpiIngest';
import { METRICS } from '../../packages/engine/src/calc/metrics';
import { authorHash } from '../../packages/engine/src/parsers/deliveryEvents';

const ROOT = path.join(__dirname, '..', '..');
const EX = path.join(ROOT, 'docs', 'examples', 'ingest');
const DOC = fs.readFileSync(path.join(ROOT, 'docs', 'DATA_FLOW.md'), 'utf8');
const DEPT = 'golden-dept-b';
const TEAM = 'golden-team-df-raw';
const KPI_TEAM = 'golden-team-df-kpis';
const ORDER = ['coverage', 'test-report', 'sarif', 'pipeline-runs', 'deployments', 'commits', 'incidents', 'issues', 'kpis'] as const;
type Kind = (typeof ORDER)[number];

const DAY = 86_400_000;
const SHIFT = Math.floor((Date.now() - Date.parse('2026-11-23T00:00:00Z')) / DAY);
const shiftDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + SHIFT * DAY).toISOString().slice(0, 10);
const TS = /\b(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})?/g;

function load(kind: Kind): any {
  const team = kind === 'kpis' ? KPI_TEAM : TEAM;
  const text = fs.readFileSync(path.join(EX, `${kind}.json`), 'utf8')
    .replace(/<companyId>/g, GOLDEN_COMPANY).replace(/<departmentId>/g, DEPT).replace(/<teamId>/g, team)
    .replace(TS, (_m, d, t, z) => `${shiftDay(d)}T${t}${z ?? ''}`);
  return JSON.parse(text);
}
const ex = Object.fromEntries(ORDER.map((k) => [k, load(k)])) as Record<Kind, any>;
const ms = (v: unknown) => (v ? new Date(v as string).getTime() : null);

let up = true;
let db: Client;
let apiKey = '';

async function send(body: unknown, opts: { dryRun?: boolean; key?: string; gzip?: boolean } = {}) {
  const json = Buffer.from(JSON.stringify(body));
  const r = await fetch(`${API_URL}/api/ingest/exporter/batch${opts.dryRun ? '?dryRun=true' : ''}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`, 'Content-Type': opts.gzip ? 'application/gzip' : 'application/json', 'User-Agent': 'qe-exporter/0.3.0 (examples test)',
      ...(opts.key ? { 'Idempotency-Key': opts.key } : {}),
    },
    body: opts.gzip ? gzipSync(json) : json,
  });
  return { status: r.status, replayed: r.headers.get('idempotent-replayed'), body: await r.json() as any };
}
const rows = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running - ingestion example tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  for (const id of [TEAM, KPI_TEAM]) {
    await db.query(`INSERT INTO teams (id, company_id, department_id, name, is_active) VALUES ($1, $2, $3, $4, true)`, [id, GOLDEN_COMPANY, DEPT, `Examples ${id.slice(-4)}`]);
  }
  const cookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  apiKey = (await post('/api/admin/api-keys', cookie, { name: 'Ingestion examples test key' })).body.plaintextKey;
}, 60_000);

afterAll(async () => {
  if (db) {
    await db.query(`DELETE FROM calc_queue_kicks WHERE company_id = $1`, [GOLDEN_COMPANY]).catch(() => undefined);
    await removeGolden(db);
    await db.end();
  }
});

describe('docs/examples/ingest: the input JSON of every kind', () => {
  it('IE-001 every example is accepted as a dry run, and nothing is stored', async () => {
    if (!up) return;
    for (const kind of ORDER) {
      const r = await send(ex[kind], { dryRun: true });
      expect({ kind, status: r.status, body: r.body.status }).toEqual({ kind, status: 200, body: 'dry-run' });
      for (const it of r.body.items) expect(it.result.status).toBe('dry-run');
    }
    const stored = await rows(`SELECT COUNT(*)::int AS n FROM raw_uploads WHERE team_id = ANY($1::text[])`, [[TEAM, KPI_TEAM]]);
    expect(stored[0].n).toBe(0);
    expect((await rows(`SELECT COUNT(*)::int AS n FROM metric_values WHERE team_id = ANY($1::text[])`, [[TEAM, KPI_TEAM]]))[0].n).toBe(0);
  }, 120_000);

  it('IE-002 every example is accepted for real; a retry with the same key is replayed; gzip is accepted', async () => {
    if (!up) return;
    for (const kind of ORDER) {
      const r = await send(ex[kind], { key: `examples-${kind}-${SHIFT}`, gzip: kind === 'issues' });
      expect({ kind, status: r.status, body: r.body.status, rejected: r.body.rejected }).toEqual({ kind, status: 201, body: 'accepted', rejected: 0 });
      for (const it of r.body.items) expect({ kind, item: it.index, status: it.status }).toEqual({ kind, item: it.index, status: 'written' });
    }
    const again = await send(ex.coverage, { key: `examples-coverage-${SHIFT}` });
    expect(again.status).toBe(201);
    expect(again.replayed).toBe('true');
    expect(again.body.recordsStored).toBe(0);
  }, 180_000);

  it('IE-003 every field present in the examples was stored', async () => {
    if (!up) return;
    // test-report
    const runs = await rows(`SELECT run_id, attempt, commit_sha, branch, format, started_at, total, passed, failed, errored, skipped, repo FROM test_runs WHERE team_id = $1`, [TEAM]);
    expect(runs).toHaveLength(ex['test-report'].items.length);
    for (const it of ex['test-report'].items) {
      const r = runs.find((x: any) => x.run_id === it.run && x.attempt === it.attempt)!;
      expect(r).toBeTruthy();
      expect([r.commit_sha, r.branch, r.format, ms(r.started_at), r.repo]).toEqual([it.commit, it.branch, it.format, ms(it.startedAt), it.repo]);
    }
    const results = await rows(`SELECT r.name, r.status, r.retries FROM test_results r JOIN test_runs t ON t.id = r.test_run_id WHERE t.team_id = $1 AND t.attempt = 1 AND t.run_id = '8812345678'`, [TEAM]);
    expect(results.find((x: any) => x.name === 'refundsPartialAmount')?.status).toBe('failed');
    expect(results.find((x: any) => x.name === 'loadsAddressBook')?.status).toBe('error');
    expect(results.find((x: any) => x.name === 'legacyGatewayFallback')?.status).toBe('skipped');
    expect(results.find((x: any) => x.name === 'appliesVoucher')?.retries).toBe(1);
    const uploads = await rows(`SELECT kind, COUNT(*)::int AS n FROM raw_uploads WHERE team_id = $1 GROUP BY kind`, [TEAM]);
    expect(Object.fromEntries(uploads.map((u: any) => [u.kind, u.n]))).toMatchObject({ tests: 4, coverage: 5, 'static-analysis': 2, pipelines: 1, deployments: 1, commits: 1, incidents: 1, issues: 1 });

    // coverage (diff and changedLines both give changed-line figures)
    const cov = await rows(`SELECT run_id, attempt, commit_sha, branch, format, created_at, lines_found, branches_found, file_count, changed_lines_found, repo, lines_of_code FROM coverage_reports WHERE team_id = $1`, [TEAM]);
    expect(cov).toHaveLength(ex.coverage.items.length);
    for (const it of ex.coverage.items) {
      const r = cov.find((x: any) => x.run_id === it.run)!;
      expect([r.attempt, r.commit_sha, r.branch, r.format, ms(r.created_at), r.repo, r.lines_of_code]).toEqual([it.attempt, it.commit, it.branch, it.format, ms(it.startedAt), it.repo, it.loc ?? null]);
      expect(Number(r.lines_found)).toBeGreaterThan(0);
      expect(r.changed_lines_found === null).toBe(!(it.diff || it.changedLines));
    }
    expect((await rows(`SELECT path FROM coverage_files WHERE team_id = $1`, [TEAM])).map((f: any) => f.path)).toEqual(expect.arrayContaining(['src/payments/refund.ts', 'src/payments/charge.ts', 'com/acme/payments/Ledger.java']));

    // sarif
    const reps = await rows(`SELECT run_id, attempt, commit_sha, branch, repo, lines_of_code, analyzed_at, tool, tool_version, findings, suppressed, new_findings, fixed_findings FROM analysis_reports WHERE team_id = $1 ORDER BY analyzed_at`, [TEAM]);
    expect(reps).toHaveLength(2);
    ex.sarif.items.forEach((it: any, i: number) => {
      const r = reps[i];
      expect([r.run_id, r.attempt, r.commit_sha, r.branch, r.repo, r.lines_of_code, ms(r.analyzed_at), r.tool, r.tool_version, r.findings, r.suppressed])
        .toEqual([it.run, it.attempt, it.commit, it.branch, it.repo, it.loc, ms(it.startedAt), 'SonarQube', '10.6.0', 3, 1]);
    });
    expect([reps[1].new_findings, reps[1].fixed_findings]).toEqual([1, 1]);
    expect((await rows(`SELECT DISTINCT rule_id FROM analysis_findings WHERE team_id = $1`, [TEAM])).length).toBe(4);

    // pipeline-runs
    const pipes = await rows(`SELECT id, external_id, attempt, name, commit_sha, branch, started_at, finished_at, duration_s, result, url FROM pipeline_runs_raw WHERE team_id = $1`, [TEAM]);
    const stages = await rows(`SELECT pipeline_run_id, name, kind, parallel_group, started_at, finished_at, duration_s, result FROM pipeline_stage_runs WHERE team_id = $1`, [TEAM]);
    const pr = (v: string) => ({ failure: 'failed', success: 'success', cancelled: 'cancelled', skipped: 'skipped' } as any)[v];
    for (const it of ex['pipeline-runs'].items) {
      const r = pipes.find((x: any) => x.external_id === it.id && x.attempt === it.attempt)!;
      expect([r.name, r.commit_sha, r.branch, ms(r.started_at), ms(r.finished_at), r.duration_s, r.result, r.url])
        .toEqual([it.name, it.commit, it.branch, ms(it.startedAt), ms(it.finishedAt), it.durationSeconds, pr(it.result), it.url]);
      for (const s of it.stages) {
        const st = stages.find((x: any) => x.pipeline_run_id === r.id && x.name === s.name)!;
        expect([st.kind, st.parallel_group, ms(st.started_at), ms(st.finished_at), st.duration_s, st.result])
          .toEqual([s.kind, s.parallelGroup ?? null, ms(s.startedAt), ms(s.finishedAt), s.durationSeconds ?? null, pr(s.result)]);
      }
    }

    // deployments (+ their commits)
    const deps = await rows(`SELECT external_id, environment, is_production, service, commit_sha, commit_shas, commit_from, started_at, finished_at, result, rollback_of, is_hotfix, url FROM deployments_raw WHERE team_id = $1`, [TEAM]);
    expect(deps).toHaveLength(ex.deployments.items.length);
    for (const it of ex.deployments.items) {
      const r = deps.find((x: any) => x.external_id === it.id)!;
      const [from, to] = it.commitRange ? it.commitRange.split('..') : [it.previousCommit ?? null, null];
      expect([r.environment, r.service, r.commit_sha, r.commit_from, ms(r.started_at), ms(r.finished_at), r.result, r.rollback_of, r.is_hotfix, r.url])
        .toEqual([it.environment, it.service, it.commit ?? to, from, ms(it.startedAt), ms(it.finishedAt), it.result, it.rollbackOf ?? null, !!it.hotfix, it.url]);
      expect(r.is_production).toBe(it.production ?? /^(prod|production|prd|live)/.test(it.environment));
      for (const c of it.commits ?? []) expect(r.commit_shas).toContain(typeof c === 'string' ? c : c.sha);
    }
    const dc = await rows(`SELECT deployment_external_id, sha, authored_at, committed_at, author_hash, branch FROM deployment_commits WHERE team_id = $1`, [TEAM]);
    const commitChecks: Array<[string, any, string | null]> = [
      ...ex.deployments.items.flatMap((d: any) => (d.commits ?? []).filter((c: any) => typeof c === 'object').map((c: any) => [d.id, c, null] as [string, any, null])),
      ...ex.commits.items.flatMap((b: any) => b.commits.map((c: any) => [b.deployment ?? '', c, b.branch] as [string, any, string])),
    ];
    for (const [depId, c, branch] of commitChecks) {
      const r = dc.find((x: any) => x.deployment_external_id === depId && x.sha === c.sha)!;
      expect(r).toBeTruthy();
      expect([ms(r.authored_at), ms(r.committed_at), r.author_hash]).toEqual([ms(c.authoredAt), ms(c.committedAt), c.authorHash ?? authorHash(GOLDEN_COMPANY, c.authorEmail)]);
      if (branch) expect(r.branch).toBe(branch);
    }

    // incidents (+ status stream; responder only as a hash in the minimised copy)
    const inc = await rows(`SELECT id, external_id, title, severity, severity_label, service, status, opened_at, acknowledged_at, resolved_at, outage, category, deployment_external_id, url FROM incidents_raw WHERE team_id = $1`, [TEAM]);
    const sev = (v: string) => ({ SEV2: 'high', critical: 'critical', low: 'low' } as any)[v];
    for (const it of ex.incidents.items) {
      const r = inc.find((x: any) => x.external_id === it.id)!;
      expect([r.title, r.severity, r.severity_label, r.service, r.status, ms(r.opened_at), ms(r.acknowledged_at), ms(r.resolved_at), r.outage, r.category, r.deployment_external_id, r.url])
        .toEqual([it.title, sev(it.severity), it.severity, it.service, it.status, ms(it.openedAt), ms(it.acknowledgedAt), ms(it.resolvedAt ?? null), it.outage, it.category, it.deploymentId ?? null, it.url]);
      const ups = await rows(`SELECT status, at FROM incident_updates WHERE incident_id = $1`, [r.id]);
      for (const u of it.updates ?? []) expect(ups.some((x: any) => x.status === u.status && ms(x.at) === ms(u.at))).toBe(true);
    }
    const incPayload = JSON.parse(gunzipSync((await rows(`SELECT payload FROM raw_uploads WHERE team_id = $1 AND kind = 'incidents'`, [TEAM]))[0].payload).toString());
    expect(incPayload.minimised).toBe(true);
    const p2041 = incPayload.incidents.find((x: any) => x.id === 'INC-2041');
    expect(p2041.responderHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(incPayload)).not.toContain('acme.example');
    expect(incPayload.incidents.find((x: any) => x.id === 'INC-2047').responderHash).toBe(ex.incidents.items[1].responderHash);
    expect(p2041.at).toBeTruthy();

    // issues (+ sprints, transitions; project, team and people in the minimised copy)
    const iss = await rows(`SELECT id, external_id, title, issue_type, type_label, status, status_category, resolution, environment, found_in, story_points, estimate_hours, time_logged_hours,
                                   sprint_ids, labels, components, opened_at, resolved_at, source_updated_at, url, priority FROM issues WHERE team_id = $1`, [TEAM]);
    expect(iss).toHaveLength(ex.issues.items.length);
    const num = (v: any) => (v === null || v === undefined ? null : Number(v));
    for (const it of ex.issues.items) {
      const r = iss.find((x: any) => x.external_id === it.key)!;
      const sprintIds = (it.sprints ?? []).map((s: any) => (typeof s === 'string' ? s : s.id));
      expect([r.title, r.type_label, r.status, r.status_category, r.resolution ?? null, r.environment, num(r.story_points), num(r.estimate_hours), num(r.time_logged_hours),
        r.labels, r.components, ms(r.opened_at), ms(r.resolved_at), ms(r.source_updated_at), r.url, r.priority])
        .toEqual([it.title, it.type, it.status, it.statusCategory, it.resolution ?? null, it.environment ?? (it.labels?.includes('env:staging') ? 'staging' : null), it.storyPoints ?? null, it.estimateHours ?? null,
          it.timeLoggedHours ?? null, it.labels ?? [], it.components ?? [], ms(it.createdAt), ms(it.resolvedAt ?? null), ms(it.updatedAt), it.url, it.priority]);
      expect([...r.sprint_ids].sort()).toEqual([...sprintIds].sort());
      const tr = await rows(`SELECT field, to_value, to_category, at FROM issue_transitions WHERE issue_id = $1`, [r.id]);
      expect(tr.length).toBe((it.transitions?.length ?? 0) + 2 * (it.blocked?.length ?? 0));
    }
    expect(iss.find((x: any) => x.external_id === 'PAY-103').found_in).toBe('production');
    const spr = await rows(`SELECT external_id, name, state, started_at, ends_at, completed_at FROM issue_sprints WHERE team_id = $1 ORDER BY external_id`, [TEAM]);
    const s46 = ex.issues.items[0].sprints[0];
    const s47 = ex.issues.items[1].sprints[1];
    expect(spr.map((s: any) => [s.external_id, s.name, s.state, ms(s.started_at), ms(s.ends_at), ms(s.completed_at)]))
      .toEqual([[s46.id, s46.name, s46.state, ms(s46.startedAt), ms(s46.endsAt), ms(s46.completedAt)], [s47.id, s47.name, s47.state, ms(s47.startedAt), ms(s47.endsAt), null]]);
    const issPayload = JSON.parse(gunzipSync((await rows(`SELECT payload FROM raw_uploads WHERE team_id = $1 AND kind = 'issues'`, [TEAM]))[0].payload).toString());
    const p101 = issPayload.issues.find((x: any) => x.key === 'PAY-101');
    expect([p101.project, p101.team, p101.priority]).toEqual(['PAY', TEAM, ex.issues.items[0].priority]);
    expect(p101.assigneeHash).toMatch(/^[0-9a-f]{32}$/);
    expect(p101.reporterHash).toMatch(/^[0-9a-f]{32}$/);
    expect(issPayload.issues.find((x: any) => x.key === 'PAY-102').assigneeHash).toBe(ex.issues.items[1].assigneeHash);
    expect(JSON.stringify(issPayload)).not.toContain('acme.example');

    // kpis
    const it = ex.kpis.items[0];
    const mv = await rows(`SELECT metric_key, value::float8 AS value, source, source_ref, idempotency_key, recorded_at FROM metric_values WHERE team_id = $1`, [KPI_TEAM]);
    expect(mv).toHaveLength(Object.keys(KPI_COLUMNS).length);
    for (const [k, v] of Object.entries(it.metrics)) {
      const r = mv.find((x: any) => x.metric_key === k)!;
      expect([r.value, r.source, r.source_ref, r.idempotency_key, ms(r.recorded_at)]).toEqual([v, `exporter.${ex.kpis.source}`, it.sourceRef, it.idempotencyKey, ms(it.recordedAt)]);
    }
  }, 120_000);

  it('IE-004 after the queue drained, every indicator fed by these inputs has a value', async () => {
    if (!up) return;
    const until = Date.now() + 240_000;
    for (;;) {
      const [q] = await rows(`SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'running'))::int AS waiting, COUNT(*) FILTER (WHERE status = 'failed')::int AS failed FROM calc_queue WHERE team_id = $1`, [TEAM]);
      expect(q.failed).toBe(0);
      if (q.waiting === 0) break;
      if (Date.now() > until) throw new Error(`calc_queue still has ${q.waiting} entries for ${TEAM}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    const evidence = new Set((await rows(`SELECT DISTINCT metric_key FROM metric_evidence WHERE team_id = $1`, [TEAM])).map((r: any) => r.metric_key));
    expect(Object.keys(METRICS).filter((k) => !evidence.has(k))).toEqual([]);
    expect(Object.keys(METRICS)).toHaveLength(30);
    const computed = new Set((await rows(`SELECT DISTINCT metric_key FROM metric_values WHERE team_id = $1 AND source = 'computed'`, [TEAM])).map((r: any) => r.metric_key));
    const fromRaw = Object.values(METRICS).map((m) => m.kpi).filter((k): k is string => !!k);
    expect(fromRaw).toHaveLength(21);
    expect(fromRaw.filter((k) => !computed.has(k))).toEqual([]);
    // No raw source: automation coverage and ROI, from the kpis kind only.
    expect(Object.keys(KPI_COLUMNS).filter((k) => !fromRaw.includes(k)).sort()).toEqual(['automation_coverage', 'automation_roi']);
    // The QA score from computed inputs only (the day of the jacoco report, SARIF report 1, the deploys and bugs).
    const [snap] = await rows(`SELECT qa_score, status, field_sources FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date = $2::date`, [TEAM, shiftDay('2026-11-18')]);
    expect(snap.qa_score).not.toBeNull();
    for (const c of ['test_coverage', 'defect_escape_rate', 'change_failure_rate', 'code_quality_score']) expect(snap.field_sources[c]?.source).toBe('computed');
    const [k] = await rows(`SELECT qa_score FROM kpi_snapshots WHERE team_id = $1 ORDER BY snapshot_date DESC LIMIT 1`, [KPI_TEAM]);
    expect(k.qa_score).not.toBeNull();
  }, 300_000);
});


describe('the indicators of a real company fed by the examples (no sample-only table, no form)', () => {
  let cookie = '';
  beforeAll(async () => { if (up) cookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie; });

  it('IE-006a Pipeline health counts the runs that were sent, through the engine (not the legacy pipeline_runs table)', async () => {
    if (!up) return;
    const s = (await get('/api/analytics/company-summary', cookie)).body;
    // What was sent in the last 30 days (every attempt is a run; cancelled runs are left out), for the active teams.
    const [sent] = await rows(
      `SELECT COUNT(*) FILTER (WHERE p.result = 'success')::int AS ok, COUNT(*) FILTER (WHERE p.result IN ('success', 'failed'))::int AS done
         FROM pipeline_runs_raw p JOIN teams t ON t.id = p.team_id WHERE t.company_id = $1 AND t.is_active AND p.day >= CURRENT_DATE - 29`, [GOLDEN_COMPANY]);
    expect(sent.done).toBeGreaterThan(0);
    expect([s.pipelineHealthBasis.successfulRuns, s.pipelineHealthBasis.totalRuns]).toEqual([sent.ok, sent.done]);
    expect(s.pipelineHealthScore).toBe(Math.round((sent.ok / sent.done) * 1000) / 10);
    expect((await rows(`SELECT COUNT(*)::int AS n FROM pipeline_runs WHERE company_id = $1`, [GOLDEN_COMPANY]))[0].n).toBe(0);
    // The build time beside it is the engine's build_time, over the same runs.
    expect(s.pipelineHealthBasis.avgBuildTimeMinutes).not.toBeNull();
  });

  it('IE-006b Tech debt health comes from the SARIF findings (one item per repository, tool and severity)', async () => {
    if (!up) return;
    const all = await rows(`SELECT title, severity, status, source, impact_score, effort_hours FROM technical_debt WHERE team_id = $1 ORDER BY severity`, [TEAM]);
    for (const d of all) expect(d.source).toBe('static-analysis');
    // A severity whose findings are gone in the latest report is resolved; the others are open.
    const debt = all.filter((d: any) => d.status === 'open');
    expect(debt.length).toBeGreaterThan(0);
    // The latest report of acme/payments-api: its findings below info, by severity.
    const [latest] = await rows(`SELECT id FROM analysis_reports WHERE team_id = $1 ORDER BY analyzed_at DESC LIMIT 1`, [TEAM]);
    const bySev = await rows(`SELECT severity, COUNT(*)::int AS n FROM analysis_findings WHERE report_id = $1 AND severity <> 'info' GROUP BY severity`, [latest.id]);
    expect(debt.map((d: any) => [d.severity, d.impact_score]).sort()).toEqual(bySev.map((b: any) => [b.severity, b.n]).sort());
    const s = (await get('/api/analytics/company-summary', cookie)).body;
    expect(s.techDebtStatusScore).not.toBeNull();
    expect(s.techDebtBasis.openItems).toBeGreaterThanOrEqual(debt.length);
  });

  it('IE-006c the quality side of Business impact fills itself from the KPI values (source "ingested")', async () => {
    if (!up) return;
    const months = await rows(`SELECT month_year, test_coverage, defect_escape_rate, change_failure_rate, mttr_hours, code_quality_score, deployment_frequency, lead_time_days, defect_density,
                                      data_source, value_sources FROM business_impact_quality_metrics WHERE team_id = $1 ORDER BY month_year`, [TEAM]);
    expect(months.length).toBeGreaterThan(0);
    const last = months[months.length - 1];
    expect(last.data_source).toBe('ingested');
    for (const c of ['test_coverage', 'defect_escape_rate', 'change_failure_rate', 'mttr_hours', 'code_quality_score', 'deployment_frequency', 'lead_time_days', 'defect_density']) {
      const any = months.find((m: any) => m[c] !== null);
      expect({ c, value: any ? 'set' : null, source: any?.value_sources[c] }).toEqual({ c, value: 'set', source: 'ingested' });
    }
    // The monthly value is the mean of the days' values of that month (deployment frequency per month = per week × 52 / 12).
    const [cov] = await rows(
      `SELECT round(avg(value), 2)::float8 AS v FROM (SELECT DISTINCT ON ((recorded_at AT TIME ZONE 'UTC')::date) value FROM metric_values
         WHERE team_id = $1 AND metric_key = 'test_coverage' AND superseded_by IS NULL AND to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM') = $2
         ORDER BY (recorded_at AT TIME ZONE 'UTC')::date, recorded_at DESC, received_at DESC) d`, [TEAM, last.month_year]);
    if (cov.v !== null) expect(Number(last.test_coverage)).toBe(cov.v);
    const api = (await get(`/api/analytics/business-impact-v2/${TEAM}`, cookie)).body;
    expect(JSON.stringify(api)).toContain(last.month_year);
  });

  it('IE-006d a typed-in monthly value is never overwritten by an ingested one, and its source is recorded', async () => {
    if (!up) return;
    const [m] = await rows(`SELECT month_year FROM business_impact_quality_metrics WHERE team_id = $1 ORDER BY month_year DESC LIMIT 1`, [TEAM]);
    const r = await post(`/api/analytics/business-impact-v2/${TEAM}/quality-metrics`, cookie, { month_year: m.month_year, test_coverage: 12.5 });
    expect(r.status).toBe(200);
    // A new KPI value of that month re-derives the month: the typed-in coverage stays, the other values follow the data.
    await db.query(`SELECT public.refresh_business_quality_month($1, $2)`, [TEAM, m.month_year]);
    const [after] = await rows(`SELECT test_coverage::float8 AS c, data_source, value_sources FROM business_impact_quality_metrics WHERE team_id = $1 AND month_year = $2`, [TEAM, m.month_year]);
    expect([after.c, after.value_sources.test_coverage, after.data_source]).toEqual([12.5, 'manual', 'mixed']);
    expect(Object.entries(after.value_sources).filter(([k]) => k !== 'test_coverage').every(([, v]) => v === 'ingested')).toBe(true);
  });

  it('IE-007a priority, repo and loc are stored and used', async () => {
    if (!up) return;
    // priority: in the issue evidence of escape rate.
    const esc = (await get(`/api/ci/teams/${TEAM}/metrics/escape_rate`, cookie)).body;
    const p103 = esc.sources.issues.find((i: any) => i.key === 'PAY-103');
    expect(p103.priority).toBe(ex.issues.items.find((i: any) => i.key === 'PAY-103').priority);
    // repo: a dimension of the CI evidence, with a filter.
    const all = (await get(`/api/ci/teams/${TEAM}/evidence`, cookie)).body;
    expect(all.repos).toEqual(['acme/payments-core', 'acme/payments-web']);
    const core = (await get(`/api/ci/teams/${TEAM}/evidence?repo=acme/payments-core`, cookie)).body;
    expect(core.coverage.repo).toBe('acme/payments-core');
    expect(core.coverage.linesOfCode).toBe(61250);
    // loc: defect density divides by the loc of the latest main-branch coverage report (lcov, 42,800 lines of code).
    const dd = (await get(`/api/ci/teams/${TEAM}/metrics/defect_density`, cookie)).body;
    expect(dd.inputs.linesOfCode).toBe(42800);
    expect(dd.value).toBe(Math.round((dd.inputs.escapedBugs / 42.8) * 1000) / 1000);
  });

  it('IE-007b a field QE Navigator has no use for is refused with a message, never ignored', async () => {
    if (!up) return;
    const tr = JSON.parse(JSON.stringify(ex['test-report']));
    tr.items = [{ ...tr.items[0], loc: 1000 }];
    let r = await send(tr, { dryRun: true });
    expect([r.status, r.body.error]).toEqual([400, expect.stringContaining('loc is not accepted on a test-report item')]);
    const pr = JSON.parse(JSON.stringify(ex['pipeline-runs']));
    pr.items = [{ ...pr.items[0], triggeredBy: 'someone' }];
    r = await send(pr, { dryRun: true });
    expect([r.status, r.body.error]).toEqual([400, expect.stringContaining('unknown field(s) triggeredBy')]);
    const st = JSON.parse(JSON.stringify(ex['pipeline-runs']));
    st.items = [{ ...st.items[0], stages: [{ ...st.items[0].stages[0], runner: 'x' }] }];
    r = await send(st, { dryRun: true });
    expect([r.status, r.body.error]).toEqual([400, expect.stringContaining('unknown field(s) runner')]);
    for (const kind of ['deployments', 'incidents', 'issues', 'commits'] as const) {
      const e = JSON.parse(JSON.stringify(ex[kind]));
      e.items = [{ ...e.items[0], description: 'free text' }];
      r = await send(e, { dryRun: true });
      expect({ kind, status: r.status, error: r.body.error }).toEqual({ kind, status: 400, error: expect.stringContaining('unknown field(s) description') });
    }
    // The direct endpoints too.
    const junit = ex['test-report'].items[0].files[0].content;
    const direct = await fetch(`${API_URL}/api/ingest/tests?team=${TEAM}&dryRun=true&buildNumber=7`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/xml' }, body: junit });
    expect([direct.status, (await direct.json() as any).error]).toEqual([400, expect.stringContaining('Unknown field(s): buildNumber')]);
    const loc = await fetch(`${API_URL}/api/ingest/tests?team=${TEAM}&dryRun=true&loc=100`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/xml' }, body: junit });
    expect([loc.status, (await loc.json() as any).error]).toEqual([400, expect.stringContaining('loc is not accepted on a test report')]);
  });
});

describe('completeness: the examples and the doc cover every accepted field', () => {
  const src = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  /** The body of a function (from its declaration to the first line that is a lone "}"). */
  const fn = (text: string, decl: string) => { const i = text.indexOf(decl); expect(i).toBeGreaterThanOrEqual(0); return text.slice(i, text.indexOf('\n}\n', i)); };
  const METHODS = new Set(['includes', 'split', 'trim', 'slice', 'map', 'filter', 'length', 'toLowerCase', 'replace']);
  const props = (body: string, obj: string) => new Set(Array.from(body.matchAll(new RegExp(`\\b${obj.replace('?', '\\?')}\\??\\.(\\w+)`, 'g'))).map((m) => m[1]).filter((n) => !METHODS.has(n)));
  const arr = (text: string, re: RegExp) => JSON.parse((text.match(re)![1]).replace(/'/g, '"').replace(/,\s*$/, '')) as string[];
  const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); if (k !== 'content') keysOf(x, out); }
    return out;
  };
  const raw = Object.fromEntries(ORDER.map((k) => [k, JSON.parse(fs.readFileSync(path.join(EX, `${k}.json`), 'utf8'))])) as Record<Kind, any>;
  const used = (k: Kind) => keysOf(raw[k].items);
  const inDoc = (name: string) => new RegExp('`[^`\\n]*\\b' + name + '\\b[^`\\n]*`').test(DOC);

  it('IE-005a the allow-listed fields are all in the examples', () => {
    const exporter = src('server/lib/exporterIngest.ts');
    const envelope = arr(exporter, /const ENVELOPE_FIELDS = (\[[^\]]*\])/);
    const report = arr(exporter, /const REPORT_FIELDS = (\[[^\]]*\])/);
    const kpiItem = arr(exporter, /filter\(\(k\) => !(\[[^\]]*\])\.includes\(k\)\)/);
    for (const k of ORDER) expect(Object.keys(raw[k]).sort()).toEqual([...envelope].sort());
    const reportUnion = new Set([...used('test-report'), ...used('coverage'), ...used('sarif')]);
    expect(report.filter((f) => !reportUnion.has(f))).toEqual([]);
    expect(kpiItem.filter((f) => !used('kpis').has(f))).toEqual([]);
    expect(Object.keys(KPI_COLUMNS).filter((c) => !(c in raw.kpis.items[0].metrics))).toEqual([]);
    const people = (f: { field: string; person?: boolean }) => (f.person ? [f.field, `${f.field}Hash`] : [f.field]);
    expect(FIELD_ALLOW_LIST.issue.filter((f) => !people(f).some((n) => used('issues').has(n))).map((f) => f.field)).toEqual([]);
    expect(FIELD_ALLOW_LIST.sprint.filter((f) => !used('issues').has(f.field)).map((f) => f.field)).toEqual([]);
    expect(FIELD_ALLOW_LIST.incident.filter((f) => !people(f).some((n) => used('incidents').has(n))).map((f) => f.field)).toEqual([]);
  });

  it('IE-005b every other name the parsers read is in the examples or documented as an alias', () => {
    const pipe = src('packages/engine/src/parsers/pipelineEvents.ts');
    const deliv = src('packages/engine/src/parsers/deliveryEvents.ts');
    const issue = src('packages/engine/src/parsers/issueEvents.ts');
    const run = fn(pipe, 'export function normaliseRun(');
    const dep = fn(deliv, 'export function normaliseDeployment(');
    const commit = fn(deliv, 'function commitOf(');
    const batch = fn(deliv, 'export function parseCommitBody(').split('QE Navigator shape')[1];
    const incident = fn(deliv, 'export function normaliseIncident(');
    const responder = fn(deliv, 'function responderOf(');
    const json = fn(issue, 'function jsonIssue(');
    const sprint = fn(issue, 'function sprintOf(');
    const read: Array<[Kind, Set<string>]> = [
      ['pipeline-runs', new Set([...props(run, 'raw'), ...props(run, 's')])],
      ['deployments', new Set([...props(dep, 'raw'), ...props(dep, 'range'), ...props(commit, 'raw')])],
      ['commits', new Set([...props(batch, 'x'), ...props(commit, 'raw')])],
      ['incidents', new Set([...props(incident, 'raw'), ...props(incident, 'u?'), ...props(responder, 'raw'), ...props(responder, 'v')])],
      ['issues', new Set([...props(json, 'raw'), ...props(json, 't'), ...props(json, 'b?'), ...props(sprint, 'raw')])],
    ];
    const missing: string[] = [];
    for (const [kind, names] of read) {
      expect(names.size).toBeGreaterThan(3);
      for (const n of names) if (!used(kind).has(n) && !inDoc(n)) missing.push(`${kind}: ${n}`);
    }
    expect(missing).toEqual([]);
  });

  it('IE-005c the doc names every engine metric and every KPI column', () => {
    expect(Object.keys(METRICS).filter((k) => !DOC.includes(`\`${k}\``))).toEqual([]);
    expect(Object.keys(KPI_COLUMNS).filter((k) => !DOC.includes(`\`${k}\``))).toEqual([]);
  });
});
