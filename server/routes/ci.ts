/**
 * Evidence behind the computed metrics (v2 phase 1) and the "Connect your CI" status.
 *
 *   GET /api/ci/teams/:id/evidence            flaky tests with the runs that prove them, lowest-coverage
 *                                             files, slowest tests, failing stages, last data received
 *   GET /api/ci/teams/:id/metrics/:metric     "How this was calculated": formula, values used, number of
 *                                             runs (confidence) and the source runs (?date=YYYY-MM-DD,
 *                                             default the latest day). :metric is a metric key
 *                                             (line_coverage, pass_rate, …) or a KPI column (test_coverage, …)
 *   GET /api/ci/status                        per team and kind: last data received (super admins)
 *   PUT /api/ci/teams/:id/main-branch         the branch coverage and pass rate use (super admins)
 *
 * Evidence follows the analytics scope (the same rule as the KPI history).
 */
import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { assertTeamAnalytics, policyActor } from '../middleware/access';
import { isCompanyAdmin } from '../lib/userPolicy';
import { EVIDENCE_FOR_KPI, METRICS } from '../lib/calc/engine';
import { recordAudit } from '../lib/audit';

const router = express.Router();

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

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

    const latest = await query<any[]>(
      `SELECT DISTINCT ON (metric_key) metric_key, day, value::float8 AS value, unit, sample_size, confidence
         FROM metric_evidence WHERE team_id = ? ORDER BY metric_key, day DESC`, [teamId]);

    res.json({
      teamId,
      lastReceived: await lastReceived(teamId),
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
    });
  } catch (error) {
    console.error('Evidence error:', error);
    res.status(500).json({ error: 'Failed to load the evidence' });
  }
});

const dayStr = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

async function lastReceived(teamId: string) {
  const rows = await query<any[]>(
    `SELECT kind, MAX(received_at) AS at, COUNT(*)::int AS n FROM raw_uploads WHERE team_id = ? AND status = 'parsed' GROUP BY kind`, [teamId]);
  // Sample (demo) raw data has no upload rows: its newest run counts.
  const sample = await query<any[]>(
    `SELECT 'tests' AS kind, MAX(created_at) AS at FROM test_runs WHERE team_id = ? AND is_sample
     UNION ALL SELECT 'coverage', MAX(created_at) FROM coverage_reports WHERE team_id = ? AND is_sample
     UNION ALL SELECT 'pipelines', MAX(created_at) FROM pipeline_runs_raw WHERE team_id = ? AND is_sample`, [teamId, teamId, teamId]);
  const out: Record<string, { at: string | null; uploads: number; sample: boolean }> = {};
  for (const k of ['tests', 'coverage', 'pipelines']) {
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
      `SELECT day, metric_key, value::float8 AS value, unit, formula, inputs, sources, sample_size, confidence, kpi_column, recorded_at, computed_at
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
    const spec = METRICS[key];
    res.json({
      teamId: team.id, metric: key, label: spec.label, kpiColumn: ev.kpi_column, day: dayStr(ev.day), value: ev.value, unit: ev.unit,
      formula: ev.formula, inputs: ev.inputs, sampleSize: ev.sample_size, confidence: ev.confidence, recordedAt: ev.recorded_at, computedAt: ev.computed_at,
      flakyTests: Array.isArray(s.flakyTests) ? s.flakyTests : undefined,
      lowestFiles: Array.isArray(s.lowestFiles) ? s.lowestFiles : undefined,
      sources: {
        testRuns: testRuns.map((r: any) => ({ id: r.id, runId: r.run_id, attempt: r.attempt, commit: r.commit_sha, branch: r.branch, startedAt: r.started_at, passed: r.passed, failed: r.failed, errors: r.errored, skipped: r.skipped, durationMs: Number(r.duration_ms), format: r.format })),
        pipelineRuns: pipelineRuns.map((p: any) => ({ id: p.id, runId: p.external_id, attempt: p.attempt, name: p.name, commit: p.commit_sha, branch: p.branch, startedAt: p.started_at, durationSeconds: p.duration_s, result: p.result, url: p.url })),
        coverageReports: coverageReports.map((c: any) => ({ id: c.id, commit: c.commit_sha, branch: c.branch, format: c.format, createdAt: c.created_at, linesFound: c.lines_found, linesHit: c.lines_hit, branchesFound: c.branches_found, branchesHit: c.branches_hit, files: c.file_count, changedLinesFound: c.changed_lines_found, changedLinesHit: c.changed_lines_hit })),
      },
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
        WHERE company_id = ? AND status = 'rejected' AND source ~ '^(tests|coverage|pipelines)' AND received_at >= now() - interval '7 days'`, [companyId]);
    const keys = await query<any[]>(`SELECT COUNT(*)::int AS n FROM api_keys WHERE company_id = ? AND revoked_at IS NULL`, [companyId]);
    res.json({
      activeKeys: keys[0]?.n ?? 0,
      rejectedLast7Days: rejected[0]?.n ?? 0,
      teams: teams.map((t: any) => {
        const of = (k: string) => {
          const u = uploads.find((x: any) => x.team_id === t.id && x.kind === k);
          return u ? { at: u.at, uploads: u.n, format: u.format } : null;
        };
        return { id: t.id, name: t.name, department: t.department_name, mainBranch: t.main_branch, tests: of('tests'), coverage: of('coverage'), pipelines: of('pipelines') };
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

export default router;
