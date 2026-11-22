import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, backendUp, localDb, login, post } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL } from './helpers/goldenFixture';
import { recomputeTeamDays } from '../../server/lib/calc/engine';
import { withTransaction } from '../../server/lib/kpiIngest';
import { pool } from '../../src/lib/db';
import * as E from '../../packages/engine/src/index';
import { parseTestReport, detectTestFormat } from '../../packages/engine/src/parsers/testReports';
import { parseCoverageReport, detectCoverageFormat, parseUnifiedDiff } from '../../packages/engine/src/parsers/coverageReports';
import { parsePipelineBody } from '../../packages/engine/src/parsers/pipelineEvents';
import { parseDeploymentBody, parseIncidentBody, parseCommitBody } from '../../packages/engine/src/parsers/deliveryEvents';
import { parseIssueBody } from '../../packages/engine/src/parsers/issueEvents';
import { parseSarif } from '../../packages/engine/src/parsers/sarif';

/**
 * ENG-XCHK: the server and the QE Navigator Collector calculate with the same engine (packages/engine). The same
 * fixtures go two ways and must give identical metric values:
 *   server path   the reports and events are sent to the real ingestion API (POST /api/ingest/tests, coverage,
 *                 pipelines, deployments, commits, incidents, issues, static-analysis), stored in the raw store,
 *                 and every day is recalculated by server/lib/calc/engine.ts (recomputeTeamDays, all groups);
 *                 the result is read from metric_evidence;
 *   engine path   the same payloads are parsed by the engine's parsers, turned into records by
 *                 packages/engine/src/store/records.ts (what the Collector keeps locally) and calculated by the
 *                 engine directly (computeCiDay, computeDeliveryDay, computeWorkDay, computeQualityDay), with no
 *                 database and no server code.
 * Compared per day before today and per metric: the set of metrics, the value, the sample size (confidence), the
 * values used (inputs) and the time the value is for (recorded_at). Skips when no backend runs.
 */
const F = (name: string) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'ingest', name), 'utf8');
const TEAM = 'golden-team-empty';
const DAY = 86_400_000;
const today = new Date().toISOString().slice(0, 10);
const at = (daysAgo: number, hhmm: string) => `${new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10)}T${hhmm}:00.000Z`;
const dayAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

let up = true;
let db: Client;
let apiKey = '';

const junit = (cases: string, time = '4.750') => `<?xml version="1.0"?><testsuites><testsuite name="pytest" time="${time}">${cases}</testsuite></testsuites>`;
const FLAKY_FAIL = junit('<testcase classname="tests.test_payments" name="test_authorise_card" time="0.5"><failure message="timeout"/></testcase><testcase classname="tests.test_ledger" name="test_ledger_close" time="0.15"/>', '1.0');
const FLAKY_PASS = junit('<testcase classname="tests.test_payments" name="test_authorise_card" time="0.4"/><testcase classname="tests.test_ledger" name="test_ledger_close" time="0.2"/>', '0.9');

/** Every report sent: kind, query parameters (the run identity) and the body. */
interface Upload { kind: 'tests' | 'coverage'; params: Record<string, string>; body: string; diff?: string }
const uploads = (): Upload[] => [
  { kind: 'coverage', params: { commit: 'c1', branch: 'main', run: 'cov-1', startedAt: at(6, '09:00') }, body: F('cobertura.xml') },
  { kind: 'coverage', params: { commit: 'f1', branch: 'feature/x', run: 'cov-2', startedAt: at(6, '10:00') }, body: F('lcov.info'), diff: F('changes.diff') },
  { kind: 'coverage', params: { commit: 'c3', branch: 'main', run: 'cov-3', startedAt: at(4, '11:00') }, body: F('jacoco.xml') },
  { kind: 'coverage', params: { commit: 'c4', branch: 'main', run: 'cov-4', startedAt: at(2, '11:00') }, body: F('istanbul-final.json') },
  { kind: 'tests', params: { commit: 'c1', branch: 'main', run: 'r1', attempt: '1', startedAt: at(6, '08:00') }, body: F('junit-pytest.xml') },
  { kind: 'tests', params: { commit: 'c1', branch: 'main', run: 'r2', attempt: '1', startedAt: at(6, '08:30') }, body: FLAKY_FAIL },
  { kind: 'tests', params: { commit: 'c1', branch: 'main', run: 'r2', attempt: '2', startedAt: at(6, '08:45') }, body: FLAKY_PASS },
  { kind: 'tests', params: { commit: 'c2', branch: 'main', run: 'r3', attempt: '1', startedAt: at(5, '10:00') }, body: F('junit-jest.xml') },
  { kind: 'tests', params: { commit: 'f1', branch: 'feature/x', run: 'r4', attempt: '1', startedAt: at(5, '12:00') }, body: F('trx-dotnet.trx') },
  { kind: 'tests', params: { commit: 'c3', branch: 'main', run: 'r5', attempt: '1', startedAt: at(4, '09:00') }, body: F('cucumber.json') },
  { kind: 'tests', params: { commit: 'c3', branch: 'main', run: 'r6', attempt: '1', startedAt: at(4, '13:00') }, body: F('junit-maven-surefire.xml') },
  { kind: 'tests', params: { commit: 'c4', branch: 'main', run: 'r7', attempt: '1', startedAt: at(2, '08:00') }, body: F('junit-playwright.xml') },
];

/** Pipeline runs: the GitHub fixture moved to six days ago, a rerun (failed, then passed), a cancelled run, overlapping test stages. */
const pipelineBody = () => {
  const gh = JSON.parse(F('pipeline-github.json'));
  const shiftTo = (s: string, daysAgo: number) => at(daysAgo, s.slice(11, 16));
  const g6 = { ...gh, startedAt: shiftTo(gh.startedAt, 6), finishedAt: shiftTo(gh.finishedAt, 6), stages: gh.stages.map((s: any) => ({ ...s, startedAt: shiftTo(s.startedAt, 6), finishedAt: shiftTo(s.finishedAt, 6) })) };
  return [
    g6,
    { id: 'p-2', attempt: 1, commit: 'c2', branch: 'main', startedAt: at(5, '10:00'), finishedAt: at(5, '10:20'), result: 'failed', stages: [
      { name: 'test-a', kind: 'test', startedAt: at(5, '10:01'), finishedAt: at(5, '10:10'), result: 'failed' },
      { name: 'test-b', kind: 'test', startedAt: at(5, '10:02'), finishedAt: at(5, '10:06'), result: 'success' }] },
    { id: 'p-2', attempt: 2, commit: 'c2', branch: 'main', startedAt: at(5, '11:00'), finishedAt: at(5, '11:15'), result: 'success' },
    { id: 'p-3', attempt: 1, commit: 'c3', branch: 'main', startedAt: at(4, '09:00'), finishedAt: at(4, '09:02'), result: 'cancelled' },
    { id: 'p-4', attempt: 1, commit: 'c3', branch: 'main', startedAt: at(4, '14:00'), finishedAt: at(4, '14:25'), result: 'success' },
  ];
};

const deployments = () => ([
  { id: 'D-1', environment: 'production', service: 'checkout', commit: 'd1aaa1', startedAt: at(7, '09:50'), finishedAt: at(7, '10:00'), result: 'success',
    commits: [{ sha: 'd1aaa1', authoredAt: at(9, '08:00') }, { sha: 'd1aaa0', authoredAt: at(10, '08:00') }] },
  { id: 'D-2', environment: 'production', service: 'checkout', commit: 'd2aaa1', finishedAt: at(6, '10:00'), result: 'rolled_back', commits: [{ sha: 'd2aaa1', authoredAt: at(7, '12:00') }] },
  { id: 'D-3', environment: 'production', service: 'checkout', commit: 'd3aaa1', finishedAt: at(5, '10:00'), result: 'success' },
  { id: 'D-4', environment: 'production', service: 'checkout', commit: 'd4aaa1', finishedAt: at(5, '20:00'), result: 'success', hotfix: true },
  { id: 'D-5', environment: 'staging', service: 'checkout', commit: 'd5aaa1', finishedAt: at(4, '10:00'), result: 'success' },
  { id: 'D-6', environment: 'production', service: 'search', commit: 'd6aaa1', finishedAt: at(3, '10:00'), result: 'failure' },
  { id: 'D-7', environment: 'production', service: 'search', commit: 'd7aaa1', finishedAt: at(2, '10:00'), result: 'success' },
]);
const commitBatch = () => ({ deployment: 'D-3', commits: [{ sha: 'd3aaa1', authoredAt: at(6, '15:00') }, { sha: 'd3aaa0', authoredAt: at(8, '15:00') }] });
const incidents = () => ([
  { id: 'I-1', service: 'checkout', severity: 'critical', status: 'resolved', openedAt: at(6, '11:00'), acknowledgedAt: at(6, '11:10'), resolvedAt: at(6, '12:30'), deployment: 'D-2', category: 'application' },
  { id: 'I-2', service: 'checkout', severity: 'medium', status: 'resolved', openedAt: at(4, '08:00'), resolvedAt: at(4, '09:00'), category: 'infrastructure' },
  { id: 'I-3', service: 'search', severity: 'high', status: 'resolved', openedAt: at(3, '10:30'), resolvedAt: at(3, '11:00'), deployment: 'D-6' },
]);

const sprint41 = { id: 41, name: 'Sprint 41', state: 'closed', startDate: at(20, '09:00'), endDate: at(8, '17:00'), completeDate: at(9, '15:00') };
const sprint42 = { id: 42, name: 'Sprint 42', state: 'active', startDate: at(8, '09:00'), endDate: at(-4, '17:00') };
const jiraIssue = (key: string, fields: Record<string, unknown>, histories: Array<{ created: string; items: unknown[] }> = []) => ({
  key, fields: { project: { key: 'PAY' }, summary: `Issue ${key}`, labels: [], components: [], ...fields }, changelog: { histories },
});
const done = (resolved: string) => ({ status: { name: 'Done', statusCategory: { key: 'done' } }, resolution: { name: 'Done' }, resolutiondate: resolved });
const issuesBody = () => ({
  names: { customfield_10016: 'Story point estimate', customfield_10020: 'Sprint' },
  issues: [
    jiraIssue('PAY-1', { issuetype: { name: 'Story' }, created: at(25, '10:00'), ...done(at(12, '16:00')), customfield_10016: 5, timeoriginalestimate: 28800, timespent: 36000, customfield_10020: [sprint41] }, [
      { created: at(19, '10:00'), items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }] },
      { created: at(18, '10:00'), items: [{ field: 'status', fromString: 'In Progress', toString: 'Blocked' }] },
      { created: at(18, '14:00'), items: [{ field: 'status', fromString: 'Blocked', toString: 'In Progress' }] },
    ]),
    jiraIssue('PAY-2', { issuetype: { name: 'Story' }, created: at(24, '10:00'), ...done(at(11, '12:00')), customfield_10016: 3, timeoriginalestimate: 14400, timespent: 14400, customfield_10020: [sprint41] }),
    jiraIssue('PAY-3', { issuetype: { name: 'Story' }, created: at(23, '10:00'), status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, customfield_10016: 8, customfield_10020: [sprint41, sprint42] }),
    jiraIssue('PAY-4', { issuetype: { name: 'Bug' }, created: at(5, '09:00'), status: { name: 'Open', statusCategory: { key: 'new' } }, environment: 'Production' }),
    jiraIssue('PAY-5', { issuetype: { name: 'Bug' }, created: at(4, '09:00'), status: { name: 'Open', statusCategory: { key: 'new' } }, environment: 'Staging' }),
    jiraIssue('PAY-6', { issuetype: { name: 'Bug' }, created: at(3, '09:00'), status: { name: 'Closed', statusCategory: { key: 'done' } }, resolution: { name: "Won't Do" }, resolutiondate: at(3, '12:00'), environment: 'Production' }),
  ],
});

const sarif = (fp: string, commit: string) => JSON.stringify({
  version: '2.1.0', runs: [{
    tool: { driver: { name: 'CodeQL', semanticVersion: '2.19.0', rules: [
      { id: 'js/sql-injection', name: 'SqlInjection', properties: { 'security-severity': '8.8' } },
      { id: 'js/unused-local-variable', name: 'UnusedVariable', defaultConfiguration: { level: 'note' } }] } },
    versionControlProvenance: [{ repositoryUri: 'https://github.com/golden/payments.git', revisionId: commit, branch: 'refs/heads/main' }],
    results: [
      { ruleId: 'js/sql-injection', level: 'error', message: { text: 'Query built from user input' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/db/query.ts' }, region: { startLine: 42 } } }], partialFingerprints: { primaryLocationLineHash: fp } },
      { ruleId: 'js/unused-local-variable', message: { text: 'Unused variable x' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.ts' }, region: { startLine: 3 } } }], partialFingerprints: { primaryLocationLineHash: 'bbb:1' } },
    ],
  }],
});
const analyses = () => [
  { params: { commit: 's1', branch: 'main', run: 'sa-1', startedAt: at(5, '12:00'), loc: '12000' }, body: sarif('aaa:1', 's1') },
  { params: { commit: 's2', branch: 'main', run: 'sa-2', startedAt: at(3, '12:00'), loc: '12000' }, body: sarif('ccc:1', 's2') },
];

const send = (kind: string, params: Record<string, string>, body: string, ct = 'application/octet-stream') =>
  request(API_URL).post(`/api/ingest/${kind}?${new URLSearchParams({ team: TEAM, ...params })}`).set('Authorization', `Bearer ${apiKey}`).set('Content-Type', ct).send(body);

/** The engine path: parse, build the Collector's records, calculate one day. */
function engineDays(days: string[]): Map<string, E.ComputedMetric[]> {
  const testRuns: E.TestRunRec[] = [];
  const coverage: E.CoverageRec[] = [];
  for (const u of uploads()) {
    const m = { commit: u.params.commit, branch: u.params.branch, runId: u.params.run, attempt: Number(u.params.attempt ?? 1), startedAt: Date.parse(u.params.startedAt) };
    if (u.kind === 'tests') testRuns.push(E.testRunRecord(TEAM, parseTestReport(u.body, detectTestFormat(u.body)!), m));
    else coverage.push(E.coverageRecord(TEAM, parseCoverageReport(u.body, detectCoverageFormat(u.body)!), { ...m, createdAt: m.startedAt }, u.diff ? parseUnifiedDiff(u.diff) : null));
  }
  const pipelines = parsePipelineBody(pipelineBody()).map((r) => E.pipelineRecord(TEAM, r));
  const deps = parseDeploymentBody(deployments(), 'json', { team: TEAM }).events.map((e) => E.deploymentRecord(TEAM, e));
  const commits: E.CommitRec[] = [];
  for (const e of parseDeploymentBody(deployments(), 'json', { team: TEAM }).events) if (e.commits.length) E.mergeCommits(commits, e.id, null, e.commits);
  for (const b of parseCommitBody(commitBatch(), 'json', { team: TEAM })) E.mergeCommits(commits, b.deployment ?? '', b.branch, b.commits);
  const incs = new Map<string, E.IncidentRec>();
  for (const e of parseIncidentBody(incidents(), 'json', { team: TEAM })) incs.set(e.id, E.mergeIncident(TEAM, incs.get(e.id) ?? null, e, Date.now()));
  const parsedIssues = parseIssueBody(issuesBody(), 'jira', { team: TEAM });
  const sprints = new Map<string, E.SprintRec>();
  for (const s of parsedIssues.sprints) sprints.set(s.id, E.mergeSprint(TEAM, sprints.get(s.id) ?? null, s, Date.now()));
  const issues = new Map<string, E.IssueRec>();
  for (const e of parsedIssues.issues) issues.set(e.key, E.mergeIssue(TEAM, issues.get(e.key) ?? null, e));
  const reports: E.AnalysisRec[] = [];
  for (const a of analyses()) for (const r of parseSarif(a.body)) {
    reports.push(E.analysisRecord(TEAM, r, { repo: E.sarif.repoName('https://github.com/golden/payments.git') ?? 'golden/payments', branch: a.params.branch, commit: a.params.commit, runId: a.params.run, attempt: 1, analyzedAt: Date.parse(a.params.startedAt), linesOfCode: Number(a.params.loc) }));
  }
  const out = new Map<string, E.ComputedMetric[]>();
  for (const d of days) {
    out.set(d, [
      ...E.computeCiDay(d, E.ciData(testRuns, coverage, pipelines, null, d, d)),
      ...E.computeDeliveryDay(d, E.deliveryData(deps, commits, Array.from(incs.values()), d, d)),
      ...E.computeWorkDay(d, E.workData(Array.from(sprints.values()), Array.from(issues.values()), coverage, null, d, d)),
      ...E.computeQualityDay(d, E.qualityData(reports, coverage, null, d, d)),
    ]);
  }
  return out;
}

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running at', API_URL, '- engine cross-check skipped'); return; }
  db = await localDb();
  await createGolden(db);
  const cookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  apiKey = (await post('/api/admin/api-keys', cookie, { name: 'Engine cross-check key' })).body.plaintextKey;
  for (const u of uploads()) {
    let req = request(API_URL).post(`/api/ingest/${u.kind}?${new URLSearchParams({ team: TEAM, ...u.params })}`).set('Authorization', `Bearer ${apiKey}`);
    const r = u.diff ? await req.attach('report', Buffer.from(u.body), 'report').attach('diff', Buffer.from(u.diff), 'changes.diff') : await req.set('Content-Type', 'application/octet-stream').send(u.body);
    if (r.status !== 201) throw new Error(`${u.kind} ${u.params.run}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  }
  for (const [kind, body] of [['pipelines', pipelineBody()], ['deployments', deployments()], ['commits', commitBatch()], ['incidents', incidents()], ['issues', issuesBody()]] as const) {
    const r = await send(kind, {}, JSON.stringify(body), 'application/json');
    if (r.status >= 300) throw new Error(`${kind}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  }
  for (const a of analyses()) {
    const r = await send('static-analysis', a.params, a.body, 'application/json');
    if (r.status !== 201) throw new Error(`static-analysis: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  }
}, 120_000);

afterAll(async () => {
  if (db) { await removeGolden(db); await db.end(); }
  await pool.end();
});

describe('Shared engine: the server path and the engine directly give the same values', () => {
  it('ENG-XCHK-001 every metric of every day before today: same set, value, sample size, inputs and time', async () => {
    if (!up) return;
    const days: string[] = [];
    for (let i = 40; i >= 1; i--) days.push(dayAgo(i));
    // Server path: recalculate every day of every group (as the nightly run does), then read metric_evidence.
    await withTransaction((c) => recomputeTeamDays(c, TEAM, days, { writeKpis: false }));
    const rows = (await db.query(
      `SELECT day::text AS day, metric_key, value::float8 AS value, sample_size, inputs, recorded_at FROM metric_evidence WHERE team_id = $1 AND day < $2::date ORDER BY day, metric_key`, [TEAM, today])).rows;
    // Both sides sorted here with one comparator: the SQL ORDER BY follows the database collation
    // (en_US in CI puts changed_code_coverage before change_failure_rate, C the other way round).
    const byDayKey = (a: { day: string; key: string }, b: { day: string; key: string }) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const server = rows.map((r: any) => ({ day: r.day, key: r.metric_key, value: r.value, sampleSize: r.sample_size, inputs: r.inputs, recordedAt: new Date(r.recorded_at).toISOString() }))
      .sort(byDayKey);
    const engine = Array.from(engineDays(days).entries()).flatMap(([day, ms]) => ms.map((m) => ({ day, key: m.key, value: Math.round(m.value * 10000) / 10000, sampleSize: m.sampleSize, inputs: JSON.parse(JSON.stringify(m.inputs)), recordedAt: m.recordedAt })))
      .sort(byDayKey);
    // Every group is covered, on several days.
    const keys = new Set(server.map((s) => s.key));
    for (const k of ['line_coverage', 'branch_coverage', 'changed_code_coverage', 'pass_rate', 'first_time_pass_rate', 'flaky_tests', 'test_flakiness_rate', 'test_execution_time',
      'build_time', 'pipeline_success_rate', 'parallel_test_efficiency', 'deployment_frequency', 'lead_time', 'change_failure_rate', 'mttr', 'mtbf', 'availability',
      'incidents_per_deploy', 'infrastructure_failures', 'escape_rate', 'defect_density', 'velocity', 'commitment', 'carryover', 'blocked_time', 'sizing_accuracy',
      'code_quality', 'findings', 'new_findings', 'fixed_findings']) expect([k, keys.has(k)]).toEqual([k, true]);
    expect(server.length).toBeGreaterThan(100);
    expect(engine).toEqual(server);
  }, 120_000);

  it('ENG-XCHK-002 the engine version is recorded and the server re-exports it', async () => {
    const srv = await import('../../server/lib/calc/engine');
    expect(srv.ENGINE_VERSION).toBe(E.ENGINE_VERSION);
    expect(E.ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
