import request from 'supertest';
import type { Client } from 'pg';
import { API_URL, backendUp, get, localDb, login, post, put } from './helpers/http';
import { createGolden, removeGolden, GOLDEN_ADMIN_EMAIL, GOLDEN_COMPANY } from './helpers/goldenFixture';

/**
 * v2 phase 3 (work and code quality) end to end against a live backend: POST /api/ingest/issues and
 * /static-analysis with the company API key (auth, tenant check, 400 / 413 / 415, idempotent
 * re-ingest, dry runs, the ingestion log, project key → team mapping), the work values calculated
 * from a hand-built Jira history (worked out in the comments) and written as KPI values with source
 * "computed", the code quality score with new and fixed findings between two SARIF reports, and the
 * evidence endpoints (GET /api/ci/teams/:id/work, How this was calculated) with the same scope as the
 * team's KPI history. Uses the golden fixture company (golden-team-empty, golden-team-small).
 * Skips when no backend runs.
 */
const TEAM = 'golden-team-empty';
const SMALL = 'golden-team-small';

let up = true;
let db: Client;
let adminCookie = '';
let apiKey = '';
let foreignTeam = '';

const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const dayAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const at = (n: number, hhmm: string) => `${dayAgo(n)}T${hhmm}:00.000+0000`;
const send = (kind: string, body: unknown, params: Record<string, string> = {}, headers: Record<string, string> = {}) => {
  let r = request(API_URL).post(`/api/ingest/${kind}?${new URLSearchParams(params)}`).set('Authorization', `Bearer ${apiKey}`).set('Content-Type', headers['Content-Type'] ?? 'application/json');
  for (const [k, v] of Object.entries(headers)) if (k !== 'Content-Type') r = r.set(k, v);
  return r.send(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const evidence = async (team: string, metric: string, day: string) =>
  (await db.query(`SELECT value::float8 AS value, sample_size, inputs, sources FROM metric_evidence WHERE team_id = $1 AND day = $2::date AND metric_key = $3`, [team, day, metric])).rows[0] ?? null;
const snapshot = async (team: string, day: string, col: string) =>
  (await db.query(`SELECT ${col}::float8 AS v, field_sources -> '${col}' ->> 'source' AS source FROM kpi_snapshots WHERE team_id = $1 AND snapshot_date = $2::date`, [team, day])).rows[0] ?? null;
const count = async (sql: string, params: any[] = []) => Number((await db.query(sql, params)).rows[0].n);

/**
 * The hand-built history (golden-team-empty), Jira format:
 *   Sprint 41: started 20 days ago 09:00, closed 9 days ago 15:00.
 *   PAY-1 story 5 pts, done 12 days ago; estimate 8 h, logged 10 h; blocked 4 h (Blocked 18 days ago 10:00 → 14:00)
 *   PAY-2 story 3 pts, done 11 days ago; estimate 4 h, logged 4 h
 *   PAY-3 story 8 pts, in Sprint 41 and Sprint 42, still in progress (carried over)
 *   PAY-4 bug, Production, 5 days ago · PAY-5 bug, Staging, 4 days ago · PAY-6 bug, Production, Won't Do (not a confirmed defect)
 *   PAY-7 bug without an environment (not counted in the escape rate)
 * Expected today: velocity 8 (PAY-1 + PAY-2); committed 16 → commitment 50 %, carryover 50 %; blocked 4 h;
 * sizing (10 + 4) ÷ (8 + 4) = 1.17; escape rate 1 of 2 = 50 %; density 1 ÷ 4 KLOC (coverage 4,000 lines) = 0.25.
 */
const sprint41 = { id: 41, name: 'Sprint 41', state: 'closed', startDate: at(20, '09:00'), endDate: at(8, '17:00'), completeDate: at(9, '15:00') };
const sprint42 = { id: 42, name: 'Sprint 42', state: 'active', startDate: at(8, '09:00'), endDate: at(-4, '17:00') };
const jiraIssue = (key: string, fields: Record<string, unknown>, histories: Array<{ created: string; items: unknown[] }> = []) => ({
  key, self: `https://acme.atlassian.net/rest/api/3/issue/${key}`,
  fields: { project: { key: 'PAY' }, summary: `Issue ${key}`, priority: { name: 'Medium' }, labels: [], components: [{ name: 'refunds' }], ...fields },
  changelog: { histories },
});
const done = (resolved: string) => ({ status: { name: 'Done', statusCategory: { key: 'done' } }, resolution: { name: 'Done' }, resolutiondate: resolved });
const jiraBody = {
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
    jiraIssue('PAY-5', { issuetype: { name: 'Bug' }, created: at(4, '09:00'), status: { name: 'Open', statusCategory: { key: 'new' } }, environment: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Staging' }] }] } }),
    jiraIssue('PAY-6', { issuetype: { name: 'Bug' }, created: at(3, '09:00'), status: { name: 'Closed', statusCategory: { key: 'done' } }, resolution: { name: "Won't Do" }, resolutiondate: at(3, '12:00'), environment: 'Production' }),
    jiraIssue('PAY-7', { issuetype: { name: 'Bug' }, created: at(2, '09:00'), status: { name: 'Open', statusCategory: { key: 'new' } } }),
  ],
};

const sarif = (secondFingerprint: string, commit: string) => JSON.stringify({
  version: '2.1.0', runs: [{
    tool: { driver: { name: 'CodeQL', semanticVersion: '2.19.0', rules: [
      { id: 'js/sql-injection', name: 'SqlInjection', properties: { 'security-severity': '8.8', tags: ['security'] } },
      { id: 'js/unused-local-variable', name: 'UnusedVariable', defaultConfiguration: { level: 'note' } },
    ] } },
    versionControlProvenance: [{ repositoryUri: 'https://github.com/golden/payments.git', revisionId: commit, branch: 'refs/heads/main' }],
    results: [
      { ruleId: 'js/sql-injection', level: 'error', message: { text: 'Query built from user input' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/db/query.ts' }, region: { startLine: 42 } } }], partialFingerprints: { primaryLocationLineHash: secondFingerprint } },
      { ruleId: 'js/unused-local-variable', message: { text: 'Unused variable x' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.ts' }, region: { startLine: 3 } } }], partialFingerprints: { primaryLocationLineHash: 'bbb:1' } },
      { ruleId: 'js/unused-local-variable', message: { text: 'Unused variable y' }, suppressions: [{ kind: 'inSource' }] },
    ],
  }],
});

beforeAll(async () => {
  up = await backendUp();
  if (!up) { console.warn('Backend not running at', API_URL, '- work ingestion tests skipped'); return; }
  db = await localDb();
  await createGolden(db);
  adminCookie = (await login(GOLDEN_ADMIN_EMAIL)).cookie;
  apiKey = (await post('/api/admin/api-keys', adminCookie, { name: 'Work ingestion test key' })).body.plaintextKey;
  foreignTeam = (await db.query(`SELECT id FROM teams WHERE company_id <> $1 LIMIT 1`, [GOLDEN_COMPANY])).rows[0]?.id ?? 'no-such-team';
  // Code size for the defect density: a main-branch coverage report of 4,000 lines (yesterday).
  await db.query(
    `INSERT INTO coverage_reports (id, company_id, team_id, format, commit_sha, branch, run_id, attempt, created_at, day, lines_found, lines_hit, file_count)
     VALUES ('wi-cov-1', $1, $2, 'lcov', 'cov1', 'main', 'r1', 1, now() - interval '1 day', CURRENT_DATE - 1, 4000, 3000, 10)`, [GOLDEN_COMPANY, TEAM]);
});

afterAll(async () => {
  if (db) {
    await db.query(`DELETE FROM service_teams WHERE company_id = $1`, [GOLDEN_COMPANY]);
    await removeGolden(db);
    await db.end();
  }
});

jest.setTimeout(60000);

describe('Issues: authentication, tenant and request errors', () => {
  it('WI-001 no key: 401; a team of another company: 403, logged as rejected; no team and no mapped project: 400', async () => {
    if (!up) return;
    expect((await request(API_URL).post(`/api/ingest/issues?team=${TEAM}`).send(jiraBody)).status).toBe(401);
    const foreign = await send('issues', jiraBody, { team: foreignTeam });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toMatch(/not accessible with this API key/);
    const log = (await db.query(`SELECT status, http_status, source FROM ingestion_log WHERE id = $1`, [foreign.body.ingestionId])).rows[0];
    expect(log).toMatchObject({ status: 'rejected', http_status: 403, source: 'issues (jira)' });
    const noTeam = await send('issues', { issues: [{ key: 'ZZ-1', type: 'bug', createdAt: at(1, '10:00') }] });
    expect(noTeam.status).toBe(400);
    expect(noTeam.body.error).toMatch(/team is required.*project "ZZ" is not mapped/);
    expect(await count(`SELECT COUNT(*) AS n FROM issues WHERE team_id = $1`, [TEAM])).toBe(0);
  });

  it('WI-002 400s name the problem (empty, not JSON, missing key, future time, computed value); 415 for XML and unknown formats; 413 over 10 MB', async () => {
    if (!up) return;
    expect((await send('issues', '', { team: TEAM })).body.error).toMatch(/Empty body/);
    expect((await send('issues', 'key=1', { team: TEAM })).body.error).toMatch(/must be JSON/);
    expect((await send('issues', { issues: [{ type: 'bug', createdAt: at(1, '10:00') }] }, { team: TEAM })).body.error).toMatch(/issues\[0\]\.key is required/);
    expect((await send('issues', { issues: [{ key: 'A-1', createdAt: new Date(Date.now() + 3 * DAY).toISOString() }] }, { team: TEAM })).body.error).toMatch(/in the future/);
    const computed = await send('issues', { issues: [{ key: 'A-1', createdAt: at(1, '10:00'), sprint_velocity: 40 }] }, { team: TEAM });
    expect(computed.status).toBe(400);
    expect(computed.body.error).toMatch(/QE Navigator calculates this/);
    const xml = await send('issues', '<issues/>', { team: TEAM }, { 'Content-Type': 'application/xml' });
    expect(xml.status).toBe(415);
    const fmt = await send('issues', { issues: [] }, { team: TEAM, format: 'trello' });
    expect(fmt.status).toBe(415);
    expect(fmt.body.supported).toEqual(['json', 'jira', 'linear']);
    const big = await send('issues', Buffer.alloc(11 * 1024 * 1024, 0x20), { team: TEAM });
    expect(big.status).toBe(413);
    expect(big.body.error).toMatch(/at most 10 MB/);
  });

  it('WI-003 dry run: the issues are read and counted, nothing is stored, the test call is logged', async () => {
    if (!up) return;
    const r = await send('issues', jiraBody, { team: TEAM, dryRun: 'true' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'dry-run', kind: 'issues', format: 'jira', issues: 7, teams: [TEAM], withEnvironment: 3, withStoryPoints: 3 });
    expect(r.body.types).toEqual({ story: 3, bug: 4 });
    expect(await count(`SELECT COUNT(*) AS n FROM issues WHERE team_id = $1`, [TEAM])).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM ingestion_log WHERE id = $1 AND source = 'issues (jira, test call)'`, [r.body.ingestionId])).toBe(1);
  });
});

describe('Issues: calculation, KPI values and idempotency (golden-team-empty)', () => {
  it('WI-010 a Jira search result: every value worked out by hand, KPI values with source computed, evidence with the issues', async () => {
    if (!up) return;
    const r = await send('issues', jiraBody, { team: TEAM });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'accepted', kind: 'issues', format: 'jira', sprints: 2 });
    expect(r.body.issues.every((i: any) => i.status === 'written')).toBe(true);
    const d = today();
    expect((await evidence(TEAM, 'velocity', d)).value).toBe(8);
    expect((await evidence(TEAM, 'commitment', d)).value).toBe(50);
    expect((await evidence(TEAM, 'carryover', d)).value).toBe(50);
    expect((await evidence(TEAM, 'blocked_time', d)).value).toBe(4);
    expect((await evidence(TEAM, 'sizing_accuracy', d)).value).toBe(1.17);
    const esc = await evidence(TEAM, 'escape_rate', d);
    expect(esc.value).toBe(50);
    expect(esc.inputs).toMatchObject({ escapedBugs: 1, bugsWithEnvironment: 2, bugsWithoutEnvironment: 1 });
    expect(esc.sources.escaped).toEqual(['PAY-4']);
    expect((await evidence(TEAM, 'defect_density', d)).value).toBe(0.25);
    for (const [col, v] of [['sprint_velocity', 8], ['sprint_commitment_rate', 50], ['sprint_carryover', 50], ['blocked_time_hours', 4], ['sizing_accuracy', 1.17], ['defect_escape_rate', 50], ['defect_density', 0.25]] as const) {
      expect(await snapshot(TEAM, d, col)).toMatchObject({ v, source: 'computed' });
    }
    // Before the sprint closed there is no sprint value; the defects of 6 days ago: only PAY-4 known yet (1 of 1).
    expect(await evidence(TEAM, 'velocity', dayAgo(10))).toBeNull();
    expect((await evidence(TEAM, 'escape_rate', dayAgo(5))).value).toBe(100);
    const issue = (await db.query(`SELECT issue_type, found_in, story_points::float8 AS sp, estimate_hours::float8 AS est, time_logged_hours::float8 AS lg, sprint_ids, url FROM issues WHERE team_id = $1 AND external_id = 'PAY-1'`, [TEAM])).rows[0];
    expect(issue).toMatchObject({ issue_type: 'story', sp: 5, est: 8, lg: 10, sprint_ids: ['41'], url: 'https://acme.atlassian.net/browse/PAY-1' });
    expect(await count(`SELECT COUNT(*) AS n FROM issue_transitions t JOIN issues i ON i.id = t.issue_id WHERE i.team_id = $1 AND i.external_id = 'PAY-1'`, [TEAM])).toBe(3);
  });

  it('WI-011 the same issues again: 200 duplicate, nothing written; an update by webhook changes the issue and adds its change once', async () => {
    if (!up) return;
    const values = await count(`SELECT COUNT(*) AS n FROM metric_values WHERE team_id = $1`, [TEAM]);
    const again = await send('issues', jiraBody, { team: TEAM });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('duplicate');
    expect(again.body.issues.every((i: any) => i.status === 'duplicate')).toBe(true);
    expect(await count(`SELECT COUNT(*) AS n FROM metric_values WHERE team_id = $1`, [TEAM])).toBe(values);
    expect(await count(`SELECT COUNT(*) AS n FROM raw_uploads WHERE team_id = $1 AND kind = 'issues'`, [TEAM])).toBe(1);
    // PAY-3 is finished today (after Sprint 41 closed): it does not change Sprint 41's velocity.
    const hook = {
      webhookEvent: 'jira:issue_updated', timestamp: Date.now() - 60_000,
      issue: jiraIssue('PAY-3', { issuetype: { name: 'Story' }, created: at(23, '10:00'), ...done(new Date(Date.now() - 60_000).toISOString()), customfield_10016: 8, customfield_10020: [sprint41, sprint42], updated: new Date(Date.now() - 60_000).toISOString() }),
      changelog: { items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }] },
    };
    const u = await send('issues', hook, { team: TEAM, format: 'jira' });
    expect(u.status).toBe(201);
    expect(u.body.issues).toEqual([{ key: 'PAY-3', team: TEAM, status: 'updated' }]);
    expect((await evidence(TEAM, 'velocity', today())).value).toBe(8);
    expect((await send('issues', hook, { team: TEAM, format: 'jira' })).body.status).toBe('duplicate');
    expect(await count(`SELECT COUNT(*) AS n FROM issue_transitions t JOIN issues i ON i.id = t.issue_id WHERE i.team_id = $1 AND i.external_id = 'PAY-3'`, [TEAM])).toBe(1);
  });

  it('WI-012 a project key mapped to a team routes issues without a team; Linear issues and JSON sprints are read', async () => {
    if (!up) return;
    expect((await put('/api/ci/services', adminCookie, { service: 'SML', teamId: SMALL })).status).toBe(200);
    const lin = await send('issues', { data: { issues: { nodes: [{
      identifier: 'SML-1', title: 'Login crash', createdAt: at(3, '10:00'), estimate: 2, state: { name: 'Todo', type: 'unstarted' }, labels: { nodes: [{ name: 'Bug' }, { name: 'env:production' }] }, team: { key: 'SML' },
    }] } } });
    expect(lin.status).toBe(201);
    expect(lin.body).toMatchObject({ format: 'linear', issues: [{ key: 'SML-1', team: SMALL, status: 'written' }] });
    expect((await evidence(SMALL, 'escape_rate', today())).value).toBe(100);
    const js = await send('issues', { sprints: [{ id: 'C1', name: 'Cycle 1', startedAt: at(16, '09:00'), completedAt: at(2, '15:00') }],
      issues: [{ key: 'SML-2', type: 'story', status: 'Done', storyPoints: 3, sprint: 'C1', createdAt: at(20, '09:00'), resolvedAt: at(5, '09:00') }] }, { team: SMALL });
    expect(js.status).toBe(201);
    expect((await evidence(SMALL, 'velocity', today())).value).toBe(3);
  });
});

describe('Static analysis (SARIF)', () => {
  it('WI-020 errors: no team 400, foreign team 403, not SARIF 415, another SARIF version 400, unknown format 415', async () => {
    if (!up) return;
    expect((await send('static-analysis', sarif('aaa:1', 'c1'), {})).status).toBe(400);
    expect((await send('static-analysis', sarif('aaa:1', 'c1'), { team: foreignTeam })).status).toBe(403);
    const notSarif = await send('static-analysis', { results: [] }, { team: TEAM });
    expect(notSarif.status).toBe(415);
    expect(notSarif.body.supported).toEqual(['sarif']);
    expect((await send('static-analysis', '<xml/>', { team: TEAM }, { 'Content-Type': 'application/xml' })).status).toBe(415);
    const v1 = await send('static-analysis', JSON.stringify({ version: '1.0.0', runs: [] }), { team: TEAM });
    expect(v1.status).toBe(400);
    expect(v1.body.error).toMatch(/send SARIF 2.1.0/);
    expect((await send('static-analysis', sarif('aaa:1', 'c1'), { team: TEAM, format: 'pmd' })).status).toBe(415);
    expect((await send('static-analysis', sarif('aaa:1', 'c1'), { team: TEAM, loc: 'many' })).status).toBe(400);
  });

  it('WI-021 two reports: findings by severity, the score from the formula, new and fixed between them; the same run again is a duplicate', async () => {
    if (!up) return;
    const dry = await send('static-analysis', sarif('aaa:1', 'c1'), { team: TEAM, dryRun: 'true' });
    expect(dry.body).toMatchObject({ status: 'dry-run', repo: 'golden/payments', branch: 'main', commit: 'c1' });
    expect(await count(`SELECT COUNT(*) AS n FROM analysis_reports WHERE team_id = $1`, [TEAM])).toBe(0);
    const r1 = await send('static-analysis', sarif('aaa:1', 'c1'), { team: TEAM, run: '1', loc: '10000', startedAt: new Date(Date.now() - 2 * DAY).toISOString() });
    expect(r1.status).toBe(201);
    expect(r1.body.reports[0]).toMatchObject({ tool: 'CodeQL', findings: 2, suppressed: 1, bySeverity: { critical: 0, high: 1, medium: 0, low: 1, info: 0 }, newFindings: null });
    // weighted 5 + 0.5 = 5.5 over 10 KLOC → 100 × e^(−0.55 ÷ 20) = 97.3 → 97
    expect((await evidence(TEAM, 'code_quality', dayAgo(2))).value).toBe(97);
    const dup = await send('static-analysis', sarif('aaa:1', 'c1'), { team: TEAM, run: '1', loc: '10000', startedAt: new Date(Date.now() - 2 * DAY).toISOString() });
    expect(dup.status).toBe(200);
    expect(dup.body.status).toBe('duplicate');
    // The second report (multipart): the SQL injection moved (new fingerprint), the unused variable stays.
    const r2 = await request(API_URL).post(`/api/ingest/static-analysis?team=${TEAM}&run=2&loc=10000`).set('Authorization', `Bearer ${apiKey}`)
      .attach('report', Buffer.from(sarif('ddd:1', 'c2')), 'codeql.sarif');
    expect(r2.status).toBe(201);
    expect(r2.body.reports[0]).toMatchObject({ newFindings: 1, fixedFindings: 1 });
    const d = today();
    expect((await evidence(TEAM, 'new_findings', d)).value).toBe(1);
    expect((await evidence(TEAM, 'fixed_findings', d)).value).toBe(1);
    expect((await evidence(TEAM, 'findings', d)).value).toBe(2);
    expect(await snapshot(TEAM, d, 'code_quality_score')).toMatchObject({ v: 97, source: 'computed' });
  });
});

describe('Evidence endpoints and access', () => {
  it('WI-030 GET /work: sprints, escaped defects, blocked and sizing issues, the latest report with rules, new and fixed findings', async () => {
    if (!up) return;
    const w = await get(`/api/ci/teams/${TEAM}/work`, adminCookie);
    expect(w.status).toBe(200);
    expect(w.body.sample).toEqual({ work: false, quality: false });
    expect(w.body.sprints[0]).toMatchObject({ id: '41', name: 'Sprint 41', committedPoints: 16, completedPoints: 8, notCompletedPoints: 8, commitment: 50, carryover: 50, blockedHours: 4, sizingAccuracy: 1.17 });
    expect(w.body.defects).toMatchObject({ windowDays: 28, bugs: 3, escaped: 1, preRelease: 1, unknown: 1 });
    expect(w.body.defects.escapedList[0]).toMatchObject({ key: 'PAY-4', components: ['refunds'] });
    expect(w.body.blocked[0]).toMatchObject({ key: 'PAY-1', hours: 4 });
    expect(w.body.sizing.map((x: any) => x.key)).toEqual(['PAY-1', 'PAY-2']);
    expect(w.body.quality.reports[0]).toMatchObject({ tool: 'CodeQL', repo: 'golden/payments', findings: 2, newFindings: 1, fixedFindings: 1 });
    expect(w.body.quality.rules[0]).toMatchObject({ ruleId: 'js/sql-injection', severity: 'high', category: 'security' });
    expect(w.body.quality.newFindings[0]).toMatchObject({ ruleId: 'js/sql-injection', path: 'src/db/query.ts' });
    expect(w.body.quality.fixedFindings[0]).toMatchObject({ ruleId: 'js/sql-injection' });
    expect(w.body.lastReceived.issues.uploads).toBeGreaterThan(0);
    expect(w.body.metrics.map((m: any) => m.key)).toEqual(expect.arrayContaining(['velocity', 'escape_rate', 'code_quality', 'new_findings']));
  });

  it('WI-031 How this was calculated: by metric key or KPI column, with the formula, the sprint and the issues or reports behind it', async () => {
    if (!up) return;
    const v = await get(`/api/ci/teams/${TEAM}/metrics/sprint_velocity`, adminCookie);
    expect(v.body).toMatchObject({ metric: 'velocity', kpiColumn: 'sprint_velocity', value: 8, sample: false });
    expect(v.body.sprint).toMatchObject({ id: '41', name: 'Sprint 41' });
    expect(v.body.sources.issues.map((i: any) => i.key).sort()).toEqual(['PAY-1', 'PAY-2']);
    const c = await get(`/api/ci/teams/${TEAM}/metrics/carryover`, adminCookie);
    expect(c.body.sources.issues.find((i: any) => i.key === 'PAY-3').roles).toEqual(['not completed']);
    const e = await get(`/api/ci/teams/${TEAM}/metrics/defect_escape_rate`, adminCookie);
    expect(e.body.formula).toMatch(/bugs found in production ÷ bugs with a known environment/);
    expect(e.body.sources.issues.find((i: any) => i.key === 'PAY-4').roles).toContain('found in production');
    const q = await get(`/api/ci/teams/${TEAM}/metrics/code_quality_score`, adminCookie);
    expect(q.body).toMatchObject({ metric: 'code_quality', value: 97 });
    expect(q.body.formula).toMatch(/e\^\(−weighted findings per 1,000 lines/);
    expect(q.body.sources.analysisReports[0]).toMatchObject({ tool: 'CodeQL', linesOfCode: 10000 });
  });

  it('WI-032 access follows the KPI history: an engineer of another team is refused; the CI status lists issues and static analysis; the ingestion log has every request', async () => {
    if (!up) return;
    const eng = (await login('small-2@golden.example')).cookie;
    expect((await get(`/api/ci/teams/${TEAM}/work`, eng)).status).toBe(403);
    expect((await get(`/api/ci/teams/${TEAM}/metrics/velocity`, eng)).status).toBe(403);
    expect((await get(`/api/ci/teams/${SMALL}/work`, eng)).status).toBe(200);
    const status = await get('/api/ci/status', adminCookie);
    const row = status.body.teams.find((t: any) => t.id === TEAM);
    expect(row.issues.uploads).toBeGreaterThan(0);
    expect(row.staticAnalysis.uploads).toBe(2);
    const rows = (await db.query(`SELECT source, status FROM ingestion_log WHERE company_id = $1 AND source ~ '^(issues|static-analysis)'`, [GOLDEN_COMPANY])).rows;
    expect(rows.some((r: any) => r.source === 'issues (jira)' && r.status === 'accepted')).toBe(true);
    expect(rows.some((r: any) => r.source === 'static-analysis (sarif)' && r.status === 'rejected')).toBe(true);
  });
});
