/**
 * Evidence behind the computed metrics (v2 phase 1) and the "Connect your CI" status.
 *
 *   GET /api/ci/teams/:id/evidence            flaky tests with the runs that prove them, lowest-coverage
 *                                             files, slowest tests, failing stages, last data received
 *   GET /api/ci/teams/:id/metrics/:metric     "How this was calculated": formula, values used, number of
 *                                             runs (confidence) and the source runs (?date=YYYY-MM-DD,
 *                                             default the latest day). :metric is a metric key
 *                                             (line_coverage, pass_rate, …) or a KPI column (test_coverage, …)
 *   GET /api/ci/status                        per team and kind: last data received; the QE Navigator Collectors'
 *                                             heartbeats (last seen, versions, outdated, sources) (super admins)
 *   PUT /api/ci/teams/:id/main-branch         the branch coverage and pass rate use (super admins)
 *   GET /api/ci/teams/:id/delivery            deliveries and incidents (v2 phase 2): DORA values, recent production
 *                                             deploys with commit count and lead time, failed changes with what made
 *                                             them failed, incidents with duration and linked deploy
 *   GET /api/ci/services                      service → team mappings and the services seen (super admins)
 *   PUT /api/ci/services                      map a service to a team: {service, teamId} (super admins)
 *   DELETE /api/ci/services/:service          remove a mapping (super admins)
 *   GET /api/ci/teams/:id/work                work and code quality (v2 phase 3): sprint and defect values, the
 *                                             last closed sprints (committed, completed, carried over, blocked,
 *                                             sizing), escaped defects, the most blocked and the worst-sized
 *                                             issues; the latest static-analysis reports with findings by
 *                                             severity and rule, new and fixed findings, the score history
 *
 * Evidence follows the analytics scope (the same rule as the KPI history).
 */
import express from 'express';
import { pool, query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { assertTeamAnalytics, policyActor } from '../middleware/access';
import { isCompanyAdmin } from '../lib/userPolicy';
import { EVIDENCE_FOR_KPI, METRICS, groupOf } from '../lib/calc/engine';
import { classifyFailedChanges, isCountedDeploy, loadDeliveryData, type DeliveryData } from '../lib/calc/delivery';
import { isOutage } from '../lib/ingest/deliveryEvents';
import { recordAudit } from '../lib/audit';
import { loadWorkData, phase3Tables, summariseSprint, confirmedBug, WORK_WINDOW_DAYS } from '../lib/calc/work';
import { computeQualityDay, latestReports, loadQualityData, weightedOf } from '../lib/calc/quality';
import { CURRENT_ENGINE_VERSION, LATEST_COLLECTOR_VERSION, isOutdated } from '../lib/collectorIngest';

const router = express.Router();

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The phase-3 tables exist (a deploy before migration 20261201000000 shows no work or code quality data). */
async function phase3Ready(): Promise<boolean> {
  const c = await pool.connect();
  try { return await phase3Tables(c); } finally { c.release(); }
}

router.get('/teams/:id/evidence', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await assertTeamAnalytics(req, res, req.params.id as string);
    if (!team) return;
    const teamId = team.id;

    const flakyRows = await query<any[]>(
      `SELECT test_key, suite, name, commit_sha, failed_run_ids, passed_run_ids, failure_message, first_seen, last_seen
         FROM flaky_test_evidence WHERE team_id = ? AND last_seen >= now() - interval '30 days'
        ORDER BY last_seen DESC LIMIT 200`, [teamId]);
    const byTest = new Map<string, any>();
    for (const f of flakyRows) {
      const t = byTest.get(f.test_key) ?? { testKey: f.test_key, suite: f.suite, name: f.name, commits: [] as string[], failedRuns: new Set<string>(), passedRuns: new Set<string>(), failureMessage: f.failure_message, lastSeen: f.last_seen };
      t.commits.push(f.commit_sha);
      (f.failed_run_ids ?? []).forEach((x: string) => t.failedRuns.add(x));
      (f.passed_run_ids ?? []).forEach((x: string) => t.passedRuns.add(x));
      byTest.set(f.test_key, t);
    }
    const flaky = Array.from(byTest.values())
      .sort((a, b) => b.failedRuns.size - a.failedRuns.size || +new Date(b.lastSeen) - +new Date(a.lastSeen))
      .slice(0, 20);
    const runIds = Array.from(new Set(flaky.flatMap((f) => [...Array.from(f.failedRuns as Set<string>).slice(0, 5), ...Array.from(f.passedRuns as Set<string>).slice(0, 5)])));
    const runs = runIds.length
      ? await query<any[]>(`SELECT id, run_id, attempt, commit_sha, branch, started_at FROM test_runs WHERE team_id = ? AND id = ANY(?::text[])`, [teamId, runIds])
      : [];
    const runOf = new Map(runs.map((r: any) => [r.id, { id: r.id, runId: r.run_id, attempt: r.attempt, commit: r.commit_sha, branch: r.branch, startedAt: r.started_at }]));
    const flakyTests = flaky.map((f) => ({
      testKey: f.testKey, suite: f.suite, name: f.name, commits: f.commits.slice(0, 5), failureMessage: f.failureMessage, lastSeen: f.lastSeen,
      failedRunCount: f.failedRuns.size, passedRunCount: f.passedRuns.size,
      failedRuns: Array.from(f.failedRuns as Set<string>).slice(0, 5).map((id) => runOf.get(id) ?? { id }),
      passedRuns: Array.from(f.passedRuns as Set<string>).slice(0, 5).map((id) => runOf.get(id) ?? { id }),
    }));

    const report = await queryOne<any>(
      `SELECT r.id, r.commit_sha, r.branch, r.format, r.created_at, r.lines_found, r.lines_hit, r.file_count
         FROM coverage_reports r JOIN teams t ON t.id = r.team_id
        WHERE r.team_id = ?
        ORDER BY (r.branch IS NULL OR r.branch = '' OR (t.main_branch IS NULL AND r.branch IN ('main', 'master')) OR r.branch = t.main_branch) DESC, r.created_at DESC LIMIT 1`, [teamId]);
    const files = report
      ? await query<any[]>(
        `SELECT path, lines_found, lines_hit, branches_found, branches_hit FROM coverage_files
          WHERE report_id = ? AND lines_found > 0 ORDER BY lines_hit::float / lines_found, lines_found DESC LIMIT 15`, [report.id])
      : [];

    const slowest = await query<any[]>(
      `SELECT r.test_key, MAX(r.suite) AS suite, MAX(r.name) AS name, COUNT(*)::int AS runs,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY r.duration_ms)::float AS median_ms, MAX(r.duration_ms)::int AS max_ms
         FROM test_results r JOIN test_runs tr ON tr.id = r.test_run_id
        WHERE tr.team_id = ? AND tr.day >= CURRENT_DATE - 6 AND r.status <> 'skipped'
        GROUP BY r.test_key ORDER BY median_ms DESC LIMIT 15`, [teamId]);

    const stages = await query<any[]>(
      `SELECT s.name, COUNT(*)::int AS runs, COUNT(*) FILTER (WHERE s.result = 'failed')::int AS failed,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY s.duration_s)::float AS median_s,
              (array_agg(p.id ORDER BY p.started_at DESC) FILTER (WHERE s.result = 'failed'))[1:3] AS last_failed_runs,
              (array_agg(p.external_id ORDER BY p.started_at DESC) FILTER (WHERE s.result = 'failed'))[1:3] AS last_failed_external,
              (array_agg(p.url ORDER BY p.started_at DESC) FILTER (WHERE s.result = 'failed'))[1:3] AS last_failed_urls
         FROM pipeline_stage_runs s JOIN pipeline_runs_raw p ON p.id = s.pipeline_run_id
        WHERE p.team_id = ? AND p.day >= CURRENT_DATE - 29 AND s.result <> 'skipped'
        GROUP BY s.name HAVING COUNT(*) FILTER (WHERE s.result = 'failed') > 0
        ORDER BY failed DESC, runs DESC LIMIT 10`, [teamId]);

    const latest = (await query<any[]>(
      `SELECT DISTINCT ON (metric_key) metric_key, day, value::float8 AS value, unit, sample_size, confidence
         FROM metric_evidence WHERE team_id = ? ORDER BY metric_key, day DESC`, [teamId])).filter((m: any) => groupOf(m.metric_key) === 'ci');

    // Evidence mode of the QE Navigator Collector: no raw records here, the evidence panel it sent instead.
    const col = !flakyTests.length && !report && !slowest.length && !stages.length
      ? await queryOne<any>(`SELECT as_of, engine_version, collector_version, payload, received_at FROM collector_evidence WHERE team_id = ?`, [teamId]).catch(() => null)
      : null;
    const p = col?.payload ?? {};
    const arr = (v: unknown) => (Array.isArray(v) ? v : []);
    res.json({
      teamId,
      lastReceived: await lastReceived(teamId),
      collector: col ? { asOf: dayStr(col.as_of), engineVersion: col.engine_version, collectorVersion: col.collector_version, receivedAt: col.received_at } : null,
      metrics: latest.map((m: any) => ({ key: m.metric_key, label: METRICS[m.metric_key]?.label ?? m.metric_key, day: dayStr(m.day), value: m.value, unit: m.unit, sampleSize: m.sample_size, confidence: m.confidence })),
      flakyTests,
      coverage: report ? {
        reportId: report.id, commit: report.commit_sha, branch: report.branch, format: report.format, createdAt: report.created_at,
        linesFound: report.lines_found, linesHit: report.lines_hit, fileCount: report.file_count,
        lowestFiles: files.map((f: any) => ({ path: f.path, linesFound: f.lines_found, linesHit: f.lines_hit, branchesFound: f.branches_found, branchesHit: f.branches_hit, coverage: Math.round((f.lines_hit / f.lines_found) * 10000) / 100 })),
      } : null,
      slowestTests: slowest.map((s: any) => ({ testKey: s.test_key, suite: s.suite, name: s.name, runs: s.runs, medianMs: Math.round(s.median_ms), maxMs: s.max_ms })),
      failingStages: stages.map((s: any) => ({
        name: s.name, runs: s.runs, failed: s.failed, failureRate: Math.round((s.failed / s.runs) * 1000) / 10, medianSeconds: s.median_s === null ? null : Math.round(s.median_s),
        lastFailedRuns: (s.last_failed_runs ?? []).map((id: string, i: number) => ({ id, runId: s.last_failed_external?.[i] ?? null, url: s.last_failed_urls?.[i] ?? null })),
      })),
      ...(col ? {
        flakyTests: arr(p.flakyTests).map((f: any) => ({ testKey: f.name, suite: f.suite ?? null, name: f.name, commits: arr(f.commits), failureMessage: null, lastSeen: f.lastSeen ?? null, failedRunCount: f.failedRuns, passedRunCount: f.passedRuns, failedRuns: [], passedRuns: [] })),
        coverage: arr(p.lowestFiles).length ? { reportId: null, commit: null, branch: null, format: null, createdAt: col.received_at, linesFound: null, linesHit: null, fileCount: null, lowestFiles: arr(p.lowestFiles) } : null,
        slowestStages: arr(p.slowestStages),
        failingStages: arr(p.failingStages).map((x: any) => ({ ...x, lastFailedRuns: [] })),
      } : {}),
    });
  } catch (error) {
    console.error('Evidence error:', error);
    res.status(500).json({ error: 'Failed to load the evidence' });
  }
});

const dayStr = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

async function lastReceived(teamId: string, kinds: string[] = ['tests', 'coverage', 'pipelines']) {
  const rows = await query<any[]>(
    `SELECT kind, MAX(received_at) AS at, COUNT(*)::int AS n FROM raw_uploads WHERE team_id = ? AND status = 'parsed' GROUP BY kind`, [teamId]);
  // Sample (demo) raw data has no upload rows: its newest row counts (only the kinds asked for).
  const SAMPLE_TABLE: Record<string, string> = {
    tests: 'test_runs', coverage: 'coverage_reports', pipelines: 'pipeline_runs_raw', deployments: 'deployments_raw', commits: 'deployment_commits',
    incidents: 'incidents_raw', issues: 'issues', 'static-analysis': 'analysis_reports',
  };
  const parts = kinds.filter((k) => SAMPLE_TABLE[k]);
  const sample = parts.length ? await query<any[]>(
    parts.map((k) => `SELECT '${k}' AS kind, MAX(created_at) AS at FROM ${SAMPLE_TABLE[k]} WHERE team_id = ? AND is_sample`).join(' UNION ALL '), parts.map(() => teamId)) : [];
  const out: Record<string, { at: string | null; uploads: number; sample: boolean }> = {};
  for (const k of kinds) {
    const r = rows.find((x: any) => x.kind === k);
    const s = sample.find((x: any) => x.kind === k);
    const at = r?.at ?? s?.at ?? null;
    out[k] = { at, uploads: r?.n ?? 0, sample: !r?.at && !!s?.at };
  }
  return out;
}

router.get('/teams/:id/metrics/:metric', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await assertTeamAnalytics(req, res, req.params.id as string);
    if (!team) return;
    const raw = String(req.params.metric);
    const key = METRICS[raw] ? raw : EVIDENCE_FOR_KPI[raw];
    if (!key) return res.status(404).json({ error: `No calculation for "${raw}"` });
    const date = typeof req.query.date === 'string' && DAY_RE.test(req.query.date) ? req.query.date : null;
    const ev = await queryOne<any>(
      `SELECT day, metric_key, value::float8 AS value, unit, formula, inputs, sources, sample_size, confidence, kpi_column, recorded_at, computed_at,
              origin, engine_version, collector_version, privacy_mode, local_evidence_url
         FROM metric_evidence WHERE team_id = ? AND metric_key = ? ${date ? 'AND day <= ?::date' : ''} ORDER BY day DESC LIMIT 1`,
      date ? [team.id, key, date] : [team.id, key]);
    if (!ev) return res.status(404).json({ error: 'This metric has not been calculated from CI data for this team yet', metric: key });
    const s = ev.sources ?? {};
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 50) : []);
    const flakyRunIds = Array.isArray(s.flakyTests) ? s.flakyTests.flatMap((f: any) => [...ids(f.failedRuns), ...ids(f.passedRuns)]) : [];
    const testRunIds = Array.from(new Set([...ids(s.testRuns), ...flakyRunIds]));
    const testRuns = testRunIds.length
      ? await query<any[]>(`SELECT id, run_id, attempt, commit_sha, branch, started_at, passed, failed, errored, skipped, duration_ms, format FROM test_runs WHERE team_id = ? AND id = ANY(?::text[]) ORDER BY started_at DESC`, [team.id, testRunIds])
      : [];
    const pipelineRuns = ids(s.pipelineRuns).length
      ? await query<any[]>(`SELECT id, external_id, attempt, name, commit_sha, branch, started_at, duration_s, result, url FROM pipeline_runs_raw WHERE team_id = ? AND id = ANY(?::text[]) ORDER BY started_at DESC`, [team.id, ids(s.pipelineRuns)])
      : [];
    const coverageReports = ids(s.coverageReports).length
      ? await query<any[]>(`SELECT id, commit_sha, branch, format, created_at, lines_found, lines_hit, branches_found, branches_hit, file_count, changed_lines_found, changed_lines_hit FROM coverage_reports WHERE team_id = ? AND id = ANY(?::text[])`, [team.id, ids(s.coverageReports)])
      : [];
    const failedDeployments: Array<{ id: string; externalId: string; reasons: Array<{ type: string; ref: string | null; at: string }> }> = Array.isArray(s.failedDeployments) ? s.failedDeployments.slice(0, 50) : [];
    const deployIds = Array.from(new Set([...ids(s.deployments), ...failedDeployments.map((f) => f.id).filter((x) => typeof x === 'string')]));
    const deployments = deployIds.length
      ? await query<any[]>(`SELECT id, external_id, service, environment, commit_sha, started_at, finished_at, result, rollback_of, is_hotfix, url FROM deployments_raw WHERE team_id = ? AND id = ANY(?::text[]) ORDER BY finished_at DESC`, [team.id, deployIds])
      : [];
    const incidents = ids(s.incidents).length
      ? await query<any[]>(`SELECT id, external_id, title, severity, service, outage, status, opened_at, resolved_at, deployment_external_id, url FROM incidents_raw WHERE team_id = ? AND id = ANY(?::text[]) ORDER BY opened_at DESC`, [team.id, ids(s.incidents)])
      : [];
    const spec = METRICS[key];
    const group = groupOf(key);
    const delivery = group === 'delivery';
    // Phase 3: the issues and static-analysis reports behind a work / quality value, with their part in it.
    const roles = new Map<string, string[]>();
    const addRole = (k: unknown, role: string) => { if (typeof k !== 'string') return; const l = roles.get(k) ?? []; if (!l.includes(role)) l.push(role); roles.set(k, l); };
    for (const k of Array.isArray(s.escaped) ? s.escaped : []) addRole(k, 'found in production');
    for (const k of Array.isArray(s.completed) ? s.completed : []) addRole(k, 'completed');
    for (const k of Array.isArray(s.carriedOver) ? s.carriedOver : []) addRole(k, 'not completed');
    for (const k of Array.isArray(s.added) ? s.added : []) addRole(k, 'added after the start');
    if (key === 'commitment') for (const k of Array.isArray(s.committed) ? s.committed : []) addRole(k, 'committed');
    for (const b of Array.isArray(s.blocked) ? s.blocked : []) addRole(b?.key, `blocked ${b?.hours} h`);
    for (const z of Array.isArray(s.sized) ? s.sized : []) addRole(z?.key, `estimate ${z?.estimateHours} h, logged ${z?.loggedHours} h`);
    if (key === 'escape_rate') for (const k of Array.isArray(s.issues) ? s.issues : []) addRole(k, 'bug');
    const issueKeys = Array.from(roles.keys()).slice(0, 80);
    const issueRows = issueKeys.length
      ? await query<any[]>(`SELECT external_id, title, issue_type, status, found_in, environment, story_points::float8 AS points, estimate_hours::float8 AS estimate, time_logged_hours::float8 AS logged, opened_at, resolved_at, url FROM issues WHERE team_id = ? AND external_id = ANY(?::text[]) ORDER BY opened_at DESC`, [team.id, issueKeys])
      : [];
    const reportRows = ids(s.analysisReports).length
      ? await query<any[]>(`SELECT id, tool, repo, branch, commit_sha, analyzed_at, lines_of_code, findings, critical, high, medium, low, info, new_findings, fixed_findings FROM analysis_reports WHERE team_id = ? AND id = ANY(?::text[]) ORDER BY analyzed_at DESC`, [team.id, ids(s.analysisReports)])
      : [];
    // Sample (demo) raw data: shown as evidence, never written to the KPI storage.
    const sampleSql = delivery
      ? `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM deployments_raw WHERE team_id = ? AND is_sample) OR EXISTS (SELECT 1 FROM incidents_raw WHERE team_id = ? AND is_sample)`
      : group === 'work' ? `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM issues WHERE team_id = ? AND is_sample) AND NOT EXISTS (SELECT 1 FROM issues WHERE team_id = ? AND NOT is_sample)`
      : group === 'quality' ? `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM analysis_reports WHERE team_id = ? AND is_sample) AND NOT EXISTS (SELECT 1 FROM analysis_reports WHERE team_id = ? AND NOT is_sample)`
      : `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM test_runs WHERE team_id = ? AND is_sample) OR EXISTS (SELECT 1 FROM coverage_reports WHERE team_id = ? AND is_sample)
          OR EXISTS (SELECT 1 FROM pipeline_runs_raw WHERE team_id = ? AND is_sample)`;
    const sample = !!(await queryOne<any>(sampleSql, group === 'ci' ? [team.id, team.id, team.id] : [team.id, team.id]));
    const reasonsOf = new Map(failedDeployments.map((f) => [f.id, f.reasons]));
    res.json({
      sample,
      teamId: team.id, metric: key, label: spec.label, kpiColumn: ev.kpi_column, day: dayStr(ev.day), value: ev.value, unit: ev.unit,
      formula: ev.formula, inputs: ev.inputs, sampleSize: ev.sample_size, confidence: ev.confidence, recordedAt: ev.recorded_at, computedAt: ev.computed_at,
      flakyTests: Array.isArray(s.flakyTests) ? s.flakyTests : undefined,
      lowestFiles: Array.isArray(s.lowestFiles) ? s.lowestFiles : undefined,
      sources: {
        testRuns: testRuns.map((r: any) => ({ id: r.id, runId: r.run_id, attempt: r.attempt, commit: r.commit_sha, branch: r.branch, startedAt: r.started_at, passed: r.passed, failed: r.failed, errors: r.errored, skipped: r.skipped, durationMs: Number(r.duration_ms), format: r.format })),
        pipelineRuns: pipelineRuns.map((p: any) => ({ id: p.id, runId: p.external_id, attempt: p.attempt, name: p.name, commit: p.commit_sha, branch: p.branch, startedAt: p.started_at, durationSeconds: p.duration_s, result: p.result, url: p.url })),
        coverageReports: coverageReports.map((c: any) => ({ id: c.id, commit: c.commit_sha, branch: c.branch, format: c.format, createdAt: c.created_at, linesFound: c.lines_found, linesHit: c.lines_hit, branchesFound: c.branches_found, branchesHit: c.branches_hit, files: c.file_count, changedLinesFound: c.changed_lines_found, changedLinesHit: c.changed_lines_hit })),
        deployments: deployments.map((d: any) => ({ id: d.id, deploymentId: d.external_id, service: d.service, environment: d.environment, commit: d.commit_sha, startedAt: d.started_at, finishedAt: d.finished_at, result: d.result, rollbackOf: d.rollback_of, hotfix: d.is_hotfix, url: d.url, failedBecause: reasonsOf.get(d.id) ?? [] })),
        incidents: incidents.map((i: any) => ({ id: i.id, incidentId: i.external_id, title: i.title, severity: i.severity, service: i.service, outage: isOutage(i.severity, i.outage), status: i.status, openedAt: i.opened_at, resolvedAt: i.resolved_at, deploymentId: i.deployment_external_id, url: i.url })),
        issues: issueRows.map((i: any) => ({ key: i.external_id, title: i.title, type: i.issue_type, status: i.status, foundIn: i.found_in, environment: i.environment, points: i.points, estimateHours: i.estimate, loggedHours: i.logged, openedAt: i.opened_at, resolvedAt: i.resolved_at, url: i.url, roles: roles.get(i.external_id) ?? [] })),
        analysisReports: reportRows.map((r: any) => ({ id: r.id, tool: r.tool, repo: r.repo, branch: r.branch, commit: r.commit_sha, analyzedAt: r.analyzed_at, linesOfCode: r.lines_of_code, findings: r.findings, critical: r.critical, high: r.high, medium: r.medium, low: r.low, info: r.info, newFindings: r.new_findings, fixedFindings: r.fixed_findings })),
      },
      sprint: s.sprint && typeof s.sprint === 'object' ? s.sprint : undefined,
      // Calculated by the customer's QE Navigator Collector: its engine version and, in evidence mode, the evidence
      // lists it sent (there are no raw records here); in metrics mode the details stay in the customer's network.
      collector: ev.origin === 'collector' ? {
        engineVersion: ev.engine_version, collectorVersion: ev.collector_version, mode: ev.privacy_mode, calculatedAt: ev.computed_at,
        localEvidenceUrl: ev.privacy_mode === 'metrics' ? ev.local_evidence_url : null,
        failedDeployments: ev.privacy_mode === 'evidence' && Array.isArray(s.failedDeployments) ? s.failedDeployments : undefined,
        escaped: ev.privacy_mode === 'evidence' && Array.isArray(s.escaped) ? s.escaped : undefined,
      } : undefined,
    });
  } catch (error) {
    console.error('Metric evidence error:', error);
    res.status(500).json({ error: 'Failed to load the calculation' });
  }
});

router.get('/status', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!isCompanyAdmin(policyActor(req))) return res.status(403).json({ error: 'Super admin access required' });
    const companyId = req.user!.companyId;
    const teams = await query<any[]>(
      `SELECT t.id, t.name, t.main_branch, d.name AS department_name FROM teams t LEFT JOIN departments d ON d.id = t.department_id
        WHERE t.company_id = ? AND t.is_active IS NOT FALSE ORDER BY d.name NULLS LAST, t.name`, [companyId]);
    const uploads = await query<any[]>(
      `SELECT team_id, kind, MAX(received_at) AS at, COUNT(*)::int AS n,
              (array_agg(format ORDER BY received_at DESC))[1] AS format
         FROM raw_uploads WHERE company_id = ? AND status = 'parsed' GROUP BY team_id, kind`, [companyId]);
    const rejected = await query<any[]>(
      `SELECT MAX(received_at) AS at, COUNT(*)::int AS n FROM ingestion_log
        WHERE company_id = ? AND status = 'rejected' AND source ~ '^(tests|coverage|pipelines|deployments|commits|incidents|issues|static-analysis)' AND received_at >= now() - interval '7 days'`, [companyId]);
    const keys = await query<any[]>(`SELECT COUNT(*)::int AS n FROM api_keys WHERE company_id = ? AND revoked_at IS NULL`, [companyId]);
    const p3 = await phase3Ready();
    // Sample (demo) raw data has no upload rows: its newest run counts, marked as sample.
    const sample = await query<any[]>(
      `SELECT team_id, 'tests' AS kind, MAX(created_at) AS at, COUNT(*)::int AS n FROM test_runs WHERE company_id = ? AND is_sample GROUP BY team_id
       UNION ALL SELECT team_id, 'coverage', MAX(created_at), COUNT(*)::int FROM coverage_reports WHERE company_id = ? AND is_sample GROUP BY team_id
       UNION ALL SELECT team_id, 'pipelines', MAX(created_at), COUNT(*)::int FROM pipeline_runs_raw WHERE company_id = ? AND is_sample GROUP BY team_id
       UNION ALL SELECT team_id, 'deployments', MAX(created_at), COUNT(*)::int FROM deployments_raw WHERE company_id = ? AND is_sample GROUP BY team_id
       UNION ALL SELECT team_id, 'commits', MAX(created_at), COUNT(*)::int FROM deployment_commits WHERE company_id = ? AND is_sample GROUP BY team_id
       UNION ALL SELECT team_id, 'incidents', MAX(created_at), COUNT(*)::int FROM incidents_raw WHERE company_id = ? AND is_sample GROUP BY team_id
       ${p3 ? `UNION ALL SELECT team_id, 'issues', MAX(created_at), COUNT(*)::int FROM issues WHERE company_id = ? AND is_sample GROUP BY team_id
       UNION ALL SELECT team_id, 'static-analysis', MAX(created_at), COUNT(*)::int FROM analysis_reports WHERE company_id = ? AND is_sample GROUP BY team_id` : ''}`,
      [companyId, companyId, companyId, companyId, companyId, companyId, ...(p3 ? [companyId, companyId] : [])]);
    // QE Navigator Collectors of the company: their last heartbeat (versions, privacy mode, sources; no data).
    const beats = await query<any[]>(
      `SELECT h.api_key_id, k.name AS key_name, k.revoked_at, h.collector_version, h.engine_version, h.privacy_mode, h.local_evidence_url, h.sources, h.details, h.first_seen, h.last_seen, h.beats
         FROM collector_heartbeats h LEFT JOIN api_keys k ON k.id = h.api_key_id WHERE h.company_id = ? ORDER BY h.last_seen DESC LIMIT 20`, [companyId]).catch(() => [] as any[]);
    res.json({
      activeKeys: keys[0]?.n ?? 0,
      rejectedLast7Days: rejected[0]?.n ?? 0,
      collectors: beats.map((b: any) => ({
        apiKeyName: b.key_name ?? null, keyRevoked: !!b.revoked_at, version: b.collector_version, engineVersion: b.engine_version, mode: b.privacy_mode,
        localEvidenceUrl: b.local_evidence_url, sources: b.sources ?? [], details: b.details ?? {}, firstSeen: b.first_seen, lastSeen: b.last_seen, beats: b.beats,
        outdated: isOutdated(b.collector_version, b.engine_version), latestVersion: LATEST_COLLECTOR_VERSION, currentEngineVersion: CURRENT_ENGINE_VERSION,
        stale: Date.now() - new Date(b.last_seen).getTime() > 2 * 3600_000,
      })),
      teams: teams.map((t: any) => {
        const of = (k: string) => {
          const u = uploads.find((x: any) => x.team_id === t.id && x.kind === k);
          if (u) return { at: u.at, uploads: u.n, format: u.format, sample: false };
          const x = sample.find((y: any) => y.team_id === t.id && y.kind === k);
          return x ? { at: x.at, uploads: x.n, format: null, sample: true } : null;
        };
        return {
          id: t.id, name: t.name, department: t.department_name, mainBranch: t.main_branch, tests: of('tests'), coverage: of('coverage'), pipelines: of('pipelines'),
          deployments: of('deployments'), commits: of('commits'), incidents: of('incidents'), issues: of('issues'), staticAnalysis: of('static-analysis'),
        };
      }),
    });
  } catch (error) {
    console.error('CI status error:', error);
    res.status(500).json({ error: 'Failed to load the CI status' });
  }
});

router.put('/teams/:id/main-branch', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!isCompanyAdmin(policyActor(req))) return res.status(403).json({ error: 'Super admin access required' });
    const v = req.body?.mainBranch;
    const branch = typeof v === 'string' ? v.trim().replace(/^refs\/heads\//, '') : v === null ? '' : undefined;
    if (branch === undefined || branch.length > 255 || /\s/.test(branch)) return res.status(400).json({ error: 'mainBranch must be a branch name without spaces (at most 255 characters), or empty for main / master' });
    const row = await queryOne<any>('UPDATE teams SET main_branch = ? WHERE id = ? AND company_id = ? RETURNING id, name, main_branch', [branch || null, req.params.id, req.user!.companyId]);
    if (!row) return res.status(404).json({ error: 'Team not found' });
    await recordAudit({
      companyId: req.user!.companyId, actorId: req.user!.id, action: 'team.main_branch', entityType: 'team', entityId: row.id,
      summary: `Main branch of ${row.name} set to ${row.main_branch ?? 'main / master'}`, after: { mainBranch: row.main_branch }, subjectIds: [row.id],
    });
    res.json({ id: row.id, mainBranch: row.main_branch });
  } catch (error) {
    console.error('Main branch error:', error);
    res.status(500).json({ error: 'Failed to save the main branch' });
  }
});

router.get('/teams/:id/delivery', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await assertTeamAnalytics(req, res, req.params.id as string);
    if (!team) return;
    const teamId = team.id;
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
    const client = await pool.connect();
    let data: DeliveryData;
    try { data = await loadDeliveryData(client, teamId, from, today); } finally { client.release(); }
    const now = Date.now();
    const since = Date.parse(`${from}T00:00:00Z`);
    const failures = classifyFailedChanges(data.deploys, data.incidents, now);
    const byExt = new Map<string, (typeof data.deploys)[number]>(data.deploys.map((d) => [d.externalId, d] as const));
    const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
    const reasons = (id: string) => (failures.get(id) ?? []).map((r) => ({ type: r.type, ref: r.ref, at: iso(r.at) }));
    const recent = data.deploys.filter((d) => d.finishedAt >= since).sort((a, b) => b.finishedAt - a.finishedAt);
    const deploy = (d: (typeof recent)[number]) => ({
      id: d.id, deploymentId: d.externalId, service: d.service, environment: d.environment, commit: d.commit, startedAt: iso(d.startedAt), finishedAt: iso(d.finishedAt),
      result: d.result, hotfix: d.hotfix, rollbackOf: d.rollbackOf, counted: isCountedDeploy(d), commitCount: d.commitCount,
      leadTimeHours: d.firstAuthoredAt !== null && d.firstAuthoredAt <= d.finishedAt ? Math.round(((d.finishedAt - d.firstAuthoredAt) / 3_600_000) * 10) / 10 : null,
      url: d.url, failedBecause: reasons(d.id),
    });
    const incidents = data.incidents.filter((i) => i.openedAt >= since || i.resolvedAt === null || i.resolvedAt >= since).sort((a, b) => b.openedAt - a.openedAt).slice(0, 25).map((i) => ({
      id: i.id, incidentId: i.externalId, title: i.title, severity: i.severity, service: i.service, outage: isOutage(i.severity, i.outage), category: i.category,
      status: i.resolvedAt !== null ? 'resolved' : i.acknowledgedAt !== null ? 'acknowledged' : 'open', openedAt: iso(i.openedAt), acknowledgedAt: iso(i.acknowledgedAt), resolvedAt: iso(i.resolvedAt),
      durationHours: Math.round((((i.resolvedAt ?? now) - i.openedAt) / 3_600_000) * 10) / 10,
      deployment: i.deployment ? { deploymentId: i.deployment, id: byExt.get(i.deployment)?.id ?? null, finishedAt: iso(byExt.get(i.deployment)?.finishedAt ?? null), service: byExt.get(i.deployment)?.service ?? null } : null,
      url: i.url,
    }));
    const latest = (await query<any[]>(
      `SELECT DISTINCT ON (metric_key) metric_key, day, value::float8 AS value, unit, sample_size, confidence
         FROM metric_evidence WHERE team_id = ? ORDER BY metric_key, day DESC`, [teamId])).filter((m: any) => groupOf(m.metric_key) === 'delivery');
    const sample = await queryOne<any>(
      `SELECT EXISTS (SELECT 1 FROM deployments_raw WHERE team_id = ? AND is_sample) OR EXISTS (SELECT 1 FROM incidents_raw WHERE team_id = ? AND is_sample) AS s`, [teamId, teamId]);
    res.json({
      teamId,
      sample: !!sample?.s,
      lastReceived: await lastReceived(teamId, ['deployments', 'commits', 'incidents']),
      metrics: latest.map((m: any) => ({ key: m.metric_key, label: METRICS[m.metric_key]?.label ?? m.metric_key, day: dayStr(m.day), value: m.value, unit: m.unit, sampleSize: m.sample_size, confidence: m.confidence })),
      deployments: recent.filter(isCountedDeploy).slice(0, 60).map(deploy),
      notCounted: recent.filter((d) => !isCountedDeploy(d)).slice(0, 10).map(deploy),
      failedChanges: recent.filter((d) => failures.has(d.id)).slice(0, 20).map(deploy),
      incidents,
      totals: {
        productionDeploys: recent.filter(isCountedDeploy).length, failedChanges: recent.filter((d) => failures.has(d.id)).length,
        incidents: data.incidents.filter((i) => i.openedAt >= since).length, openIncidents: data.incidents.filter((i) => i.resolvedAt === null).length, days: 30,
      },
    });
  } catch (error) {
    console.error('Delivery evidence error:', error);
    res.status(500).json({ error: 'Failed to load deliveries and incidents' });
  }
});

router.get('/teams/:id/work', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const team = await assertTeamAnalytics(req, res, req.params.id as string);
    if (!team) return;
    const teamId = team.id;
    if (!(await phase3Ready())) {
      return res.json({
        teamId, sample: { work: false, quality: false }, lastReceived: { issues: { at: null, uploads: 0, sample: false }, 'static-analysis': { at: null, uploads: 0, sample: false } }, metrics: [],
        sprints: [], blocked: [], sizing: [], carriedOver: [], defects: { windowDays: WORK_WINDOW_DAYS, bugs: 0, escaped: 0, preRelease: 0, unknown: 0, escapedList: [], byComponent: [] },
        quality: { reports: [], rules: [], newFindings: [], fixedFindings: [], history: [] },
      });
    }
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const from = new Date(now - 120 * 86_400_000).toISOString().slice(0, 10);
    const client = await pool.connect();
    let work: Awaited<ReturnType<typeof loadWorkData>>;
    let quality: Awaited<ReturnType<typeof loadQualityData>>;
    try {
      work = await loadWorkData(client, teamId, from, today);
      quality = await loadQualityData(client, teamId, new Date(now - 180 * 86_400_000).toISOString().slice(0, 10), today);
    } finally { client.release(); }
    const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const issueOut = (i: (typeof work.issues)[number]) => ({ key: i.key, title: i.title, type: i.type, url: i.url, points: i.points, openedAt: iso(i.openedAt), resolvedAt: iso(i.resolvedAt), environment: i.environment, foundIn: i.foundIn, components: i.components });

    // Sprints: the last 6 closed (newest first).
    const byId = new Map(work.sprints.map((x) => [x.externalId, x]));
    const closed = work.sprints.filter((x) => x.completedAt !== null && x.completedAt <= now).sort((a, b) => b.completedAt! - a.completedAt!).slice(0, 6);
    const sprints = closed.map((sp) => {
      const x = summariseSprint(sp, work, now);
      const est = x.sized.reduce((n, i) => n + (i.estimate ?? 0), 0);
      const log = x.sized.reduce((n, i) => n + (i.logged ?? 0), 0);
      return {
        id: sp.externalId, name: sp.name, startedAt: iso(sp.startedAt), completedAt: iso(sp.completedAt),
        issues: x.issues.length, committedPoints: x.committedPoints, completedPoints: x.completedPoints, notCompletedPoints: x.notDonePoints,
        addedIssues: x.added.length, commitment: x.committedPoints > 0 ? r1((x.completedPoints / x.committedPoints) * 100) : null,
        carryover: x.committedPoints > 0 ? r1(Math.min(100, (x.notDonePoints / x.committedPoints) * 100)) : null,
        blockedHours: r1(x.blocked.reduce((n, b) => n + b.hours, 0)), sizingAccuracy: est > 0 ? Math.round((log / est) * 100) / 100 : null,
      };
    });
    const latest = closed[0] ? summariseSprint(closed[0], work, now) : null;
    const blocked = latest ? latest.blocked.slice(0, 8).map((b) => ({ ...issueOut(b.issue), hours: r1(b.hours), sprint: latest.sprint.name ?? latest.sprint.externalId })) : [];
    const sizing = latest ? latest.sized.map((i) => ({ ...issueOut(i), estimateHours: i.estimate, loggedHours: i.logged, ratio: Math.round((i.logged! / i.estimate!) * 100) / 100 }))
      .sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio))).slice(0, 8) : [];
    const carried = latest ? latest.notDone.slice(0, 10).map((i) => ({ ...issueOut(i), inLaterSprint: i.sprintIds.some((x) => { const o = byId.get(x); return !!o && o.startedAt !== null && latest.sprint.startedAt !== null && o.startedAt > latest.sprint.startedAt; }) })) : [];

    // Defects of the last 28 days.
    const wStart = Date.parse(`${today}T00:00:00Z`) - (WORK_WINDOW_DAYS - 1) * 86_400_000;
    const bugs = work.issues.filter((i) => confirmedBug(i) && i.openedAt >= wStart && i.openedAt <= now).sort((a, b) => b.openedAt - a.openedAt);
    const escaped = bugs.filter((i) => i.foundIn === 'production');
    const byComponent = new Map<string, number>();
    for (const b of escaped) for (const c of b.components.length ? b.components : ['(no component)']) byComponent.set(c, (byComponent.get(c) ?? 0) + 1);

    // Code quality: the latest main-branch report of each repository and tool, and its findings.
    const reports = latestReports(quality, now);
    const ids = reports.map((r) => r.id);
    const rules = ids.length ? await query<any[]>(
      `SELECT rule_id, MAX(rule_name) AS rule_name, COUNT(*)::int AS n, MAX(category) AS category,
              (array_agg(severity ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END))[1] AS severity,
              COUNT(*) FILTER (WHERE is_new)::int AS new_count, (array_agg(path ORDER BY line NULLS LAST))[1:3] AS paths
         FROM analysis_findings WHERE report_id = ANY(?::text[]) GROUP BY rule_id
        ORDER BY MIN(CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END), COUNT(*) DESC LIMIT 12`, [ids]) : [];
    const newFindings = ids.length ? await query<any[]>(
      `SELECT f.rule_id, f.rule_name, f.severity, f.message, f.path, f.line, r.repo, r.tool FROM analysis_findings f JOIN analysis_reports r ON r.id = f.report_id
        WHERE f.report_id = ANY(?::text[]) AND f.is_new
        ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, f.path LIMIT 15`, [ids]) : [];
    const prevIds = (await query<any[]>(`SELECT previous_report_id FROM analysis_reports WHERE id = ANY(?::text[]) AND previous_report_id IS NOT NULL`, [ids.length ? ids : ['']])).map((x: any) => x.previous_report_id);
    const fixedFindings = prevIds.length ? await query<any[]>(
      `SELECT p.rule_id, p.rule_name, p.severity, p.message, p.path, p.line, pr.repo, pr.tool FROM analysis_findings p JOIN analysis_reports pr ON pr.id = p.report_id
        JOIN analysis_reports cur ON cur.previous_report_id = p.report_id AND cur.id = ANY(?::text[])
        WHERE NOT EXISTS (SELECT 1 FROM analysis_findings f WHERE f.report_id = cur.id AND f.fingerprint = p.fingerprint)
        ORDER BY CASE p.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, p.path LIMIT 15`, [ids]) : [];
    // Score history: the formula on each day with a main-branch report (last 180 days), from the stored reports.
    const reportDays = Array.from(new Set(quality.reports.filter((r) => r.main).map((r) => new Date(r.analyzedAt).toISOString().slice(0, 10)))).sort();
    const history = reportDays.map((day) => ({ day, value: computeQualityDay(day, quality, now).find((m) => m.key === 'code_quality')?.value ?? null }))
      .filter((h): h is { day: string; value: number } => h.value !== null);
    const metrics = (await query<any[]>(
      `SELECT DISTINCT ON (metric_key) metric_key, day, value::float8 AS value, unit, sample_size, confidence
         FROM metric_evidence WHERE team_id = ? ORDER BY metric_key, day DESC`, [teamId])).filter((m: any) => ['work', 'quality'].includes(groupOf(m.metric_key)));
    const sample = await queryOne<any>(
      `SELECT EXISTS (SELECT 1 FROM issues WHERE team_id = ? AND is_sample) AND NOT EXISTS (SELECT 1 FROM issues WHERE team_id = ? AND NOT is_sample) AS w,
              EXISTS (SELECT 1 FROM analysis_reports WHERE team_id = ? AND is_sample) AND NOT EXISTS (SELECT 1 FROM analysis_reports WHERE team_id = ? AND NOT is_sample) AS q`, [teamId, teamId, teamId, teamId]);
    const finding = (f: any) => ({ ruleId: f.rule_id, ruleName: f.rule_name, severity: f.severity, message: f.message, path: f.path, line: f.line, repo: f.repo, tool: f.tool });
    res.json({
      teamId,
      sample: { work: !!sample?.w, quality: !!sample?.q },
      lastReceived: await lastReceived(teamId, ['issues', 'static-analysis']),
      metrics: metrics.map((m: any) => ({ key: m.metric_key, label: METRICS[m.metric_key]?.label ?? m.metric_key, group: groupOf(m.metric_key), day: dayStr(m.day), value: m.value, unit: m.unit, sampleSize: m.sample_size, confidence: m.confidence })),
      sprints, blocked, sizing, carriedOver: carried,
      defects: {
        windowDays: WORK_WINDOW_DAYS, bugs: bugs.length, escaped: escaped.length, preRelease: bugs.filter((b) => b.foundIn === 'pre_release').length, unknown: bugs.filter((b) => !b.foundIn).length,
        escapedList: escaped.slice(0, 15).map(issueOut),
        byComponent: Array.from(byComponent.entries()).map(([component, n]) => ({ component, escaped: n })).sort((a, b) => b.escaped - a.escaped).slice(0, 6),
      },
      quality: {
        reports: reports.map((r) => ({ id: r.id, tool: r.tool, repo: r.repo, branch: r.branch, commit: r.commit, analyzedAt: iso(r.analyzedAt), linesOfCode: r.linesOfCode, findings: r.findings,
          bySeverity: { critical: r.critical, high: r.high, medium: r.medium, low: r.low, info: r.info }, weighted: weightedOf(r), newFindings: r.newFindings, fixedFindings: r.fixedFindings })),
        rules: rules.map((x: any) => ({ ruleId: x.rule_id, ruleName: x.rule_name, findings: x.n, newFindings: x.new_count, severity: x.severity, category: x.category, paths: (x.paths ?? []).filter(Boolean) })),
        newFindings: newFindings.map(finding), fixedFindings: fixedFindings.map(finding),
        history,
      },
    });
  } catch (error) {
    console.error('Work evidence error:', error);
    res.status(500).json({ error: 'Failed to load work and code quality' });
  }
});

const SERVICE_RE = /^[^\s\u0000-\u001f][^\u0000-\u001f]{0,254}$/;

router.get('/services', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!isCompanyAdmin(policyActor(req))) return res.status(403).json({ error: 'Super admin access required' });
    const companyId = req.user!.companyId;
    const mappings = await query<any[]>(
      `SELECT m.service, m.team_id, t.name AS team_name, m.updated_at FROM service_teams m JOIN teams t ON t.id = m.team_id WHERE m.company_id = ? ORDER BY m.service`, [companyId]);
    const seen = await query<any[]>(
      `SELECT service, team_id, MAX(at) AS last_at, SUM(n)::int AS events FROM (
         SELECT service, team_id, MAX(finished_at) AS at, COUNT(*) AS n FROM deployments_raw WHERE company_id = ? AND service IS NOT NULL GROUP BY service, team_id
         UNION ALL SELECT service, team_id, MAX(opened_at), COUNT(*) FROM incidents_raw WHERE company_id = ? AND service IS NOT NULL GROUP BY service, team_id) x
        GROUP BY service, team_id ORDER BY service LIMIT 500`, [companyId, companyId]);
    res.json({
      mappings: mappings.map((m: any) => ({ service: m.service, teamId: m.team_id, teamName: m.team_name, updatedAt: m.updated_at })),
      seen: seen.map((x: any) => ({ service: x.service, teamId: x.team_id, lastAt: x.last_at, events: x.events })),
    });
  } catch (error) {
    console.error('Service mappings error:', error);
    res.status(500).json({ error: 'Failed to load the service mappings' });
  }
});

router.put('/services', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!isCompanyAdmin(policyActor(req))) return res.status(403).json({ error: 'Super admin access required' });
    const service = typeof req.body?.service === 'string' ? req.body.service.trim() : '';
    const teamId = typeof req.body?.teamId === 'string' ? req.body.teamId.trim() : '';
    if (!SERVICE_RE.test(service)) return res.status(400).json({ error: 'service must be the service name the events carry (1 to 255 characters)' });
    if (!teamId) return res.status(400).json({ error: 'teamId is required' });
    const companyId = req.user!.companyId;
    const team = await queryOne<any>('SELECT id, name FROM teams WHERE id = ? AND company_id = ?', [teamId, companyId]);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const before = await queryOne<any>('SELECT team_id FROM service_teams WHERE company_id = ? AND service = ?', [companyId, service]);
    await query(
      `INSERT INTO service_teams (company_id, service, team_id, updated_by, updated_at) VALUES (?, ?, ?, ?, now())
       ON CONFLICT (company_id, service) DO UPDATE SET team_id = EXCLUDED.team_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [companyId, service, team.id, req.user!.id]);
    await recordAudit({
      companyId, actorId: req.user!.id, action: 'ci.service_team', entityType: 'team', entityId: team.id,
      summary: `Service ${service} mapped to ${team.name}`, before: before ? { teamId: before.team_id } : null, after: { service, teamId: team.id }, subjectIds: [team.id],
    });
    res.json({ service, teamId: team.id, teamName: team.name });
  } catch (error) {
    console.error('Service mapping error:', error);
    res.status(500).json({ error: 'Failed to save the service mapping' });
  }
});

router.delete('/services/:service', authenticateToken, async (req: AuthRequest, res) => {
  try {
    if (!isCompanyAdmin(policyActor(req))) return res.status(403).json({ error: 'Super admin access required' });
    const companyId = req.user!.companyId;
    const service = String(req.params.service);
    const row = await queryOne<any>('DELETE FROM service_teams WHERE company_id = ? AND service = ? RETURNING team_id', [companyId, service]);
    if (!row) return res.status(404).json({ error: 'No mapping for this service' });
    await recordAudit({
      companyId, actorId: req.user!.id, action: 'ci.service_team', entityType: 'team', entityId: row.team_id,
      summary: `Mapping of service ${service} removed`, before: { service, teamId: row.team_id }, after: null, subjectIds: [row.team_id],
    });
    res.json({ service, removed: true });
  } catch (error) {
    console.error('Service mapping error:', error);
    res.status(500).json({ error: 'Failed to remove the service mapping' });
  }
});

export default router;
