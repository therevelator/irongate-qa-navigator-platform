/**
 * The sources that fill the last typed-in modules, against local stand-ins of each vendor API built from their
 * documented responses: load-test result files among CI artifacts, pull requests (GitHub, GitLab, Bitbucket Cloud,
 * Azure DevOps), test management (TestRail, Xray Cloud, Zephyr Scale) and calendars (Google Calendar, Microsoft 365).
 * Each test checks what is read, what is sent, and what is not in it (no titles, names or e-mail addresses).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, createVerify } from 'node:crypto';
import { configureLog } from '../src/log';
import { MockServer, config, allStrings } from './helpers';
import { GitHubAdapter } from '../src/sources/ci/github';
import { GitLabAdapter } from '../src/sources/ci/gitlab';
import { BitbucketAdapter } from '../src/sources/ci/bitbucket';
import { AzureDevOpsAdapter } from '../src/sources/ci/azure';
import { JenkinsAdapter } from '../src/sources/ci/jenkins';
import { TestRailAdapter } from '../src/sources/tm/testrail';
import { XrayAdapter } from '../src/sources/tm/xray';
import { ZephyrAdapter } from '../src/sources/tm/zephyr';
import { spanSeconds } from '../src/sources/tm/common';
import { GoogleCalendarAdapter } from '../src/sources/calendar/google';
import { Microsoft365Adapter } from '../src/sources/calendar/microsoft';
import { utcOffsetMinutes, workingDays } from '../src/sources/calendar/common';
import { minimisePerformance, sniff, type CiAdapter, type CiRecord, type CiKind, type CiOptions } from '../src/sources/ci/common';
import { matchablePerson, finalRecord } from '../src/privacy';
import { mapJiraIssue } from '../src/sources/jira';
import type { SourceConfig } from '../src/config';

configureLog({ sink: () => {} });
const http = { timeoutSeconds: 10, maxRetries: 2, maxRetryWaitSeconds: 1, caFile: null };
const DAY = 86_400_000;
const COMPANY = 'TH6PD7J19747';
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const person = (email: string | null | undefined) => matchablePerson(email, COMPANY);
const withPeople: CiOptions = { links: false, person };
const hash = (email: string) => createHash('sha256').update(`${email}:${COMPANY}`).digest('hex');
const src = <T extends SourceConfig>(raw: Record<string, unknown>) => config({ sources: [raw] }).sources[0] as T;

async function collect(a: CiAdapter, sinceDays = 10) {
  const records: CiRecord[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for await (const p of a.collect(new Date(Date.now() - sinceDays * DAY), new Date())) { records.push(...p.records); skipped.push(...p.skipped); }
  return { records, skipped, of: (k: CiKind) => records.filter((r) => r.kind === k).map((r) => r.item as any) };
}
const noPeople = (records: CiRecord[]) => {
  const all = allStrings(records.map((r) => r.item)).join('\n');
  assert.doesNotMatch(all, /@example\.com|Grace|Hopper|SECRET/, 'no e-mail address, name or text leaves');
};

describe('The pseudonym of a person', () => {
  test('sha256(lower(e-mail) + ":" + company id); nothing without a company id or an address', () => {
    assert.equal(matchablePerson('Grace.Hopper@Example.com', COMPANY), hash('grace.hopper@example.com'));
    assert.equal(matchablePerson('grace', COMPANY), null);
    assert.equal(matchablePerson('grace@example.com', null), null);
  });
});

describe('Load-test results among CI artifacts', () => {
  const K6 = JSON.stringify({ root_group: { name: 'SECRET-GROUP' }, options: { tags: { owner: 'grace@example.com' } }, metrics: {
    http_req_duration: { avg: 180, med: 150.5, 'p(95)': 410.25, 'p(99)': 980, thresholds: { 'p(95)<500': { ok: true } } }, http_reqs: { count: 12000, rate: 100 }, http_req_failed: { value: 0.015, passes: 180, fails: 11820 },
    checks: { passes: 10, fails: 0 },
  } });

  test('a k6 summary, a JMeter statistics.json and a Gatling stats.json are recognised by content and reduced to the numbers per request', () => {
    assert.equal(sniff('summary.json', K6), 'performance');
    assert.deepEqual(JSON.parse(minimisePerformance(K6)), { metrics: { http_req_duration: { avg: 180, med: 150.5, 'p(95)': 410.25, 'p(99)': 980 }, http_reqs: { count: 12000, rate: 100 }, http_req_failed: { value: 0.015, passes: 180, fails: 11820 } } });
    const jm = JSON.stringify({ 'GET /orders?token=SECRET': { transaction: 'GET /orders?token=SECRET', sampleCount: 600, errorCount: 6, errorPct: 1, medianResTime: 120, pct2ResTime: 260, pct3ResTime: 480, throughput: 10, receivedKBytesPerSec: 9 } });
    assert.equal(sniff('statistics.json', jm), 'performance');
    assert.deepEqual(JSON.parse(minimisePerformance(jm)), { 'GET /orders': { transaction: 'GET /orders', sampleCount: 600, errorCount: 6, errorPct: 1, medianResTime: 120, pct2ResTime: 260, pct3ResTime: 480, throughput: 10 } });
    const gat = JSON.stringify({ type: 'GROUP', name: 'All Requests', stats: { name: 'All Requests', numberOfRequests: { total: 100, ok: 98, ko: 2 }, percentiles1: { total: 90 }, percentiles3: { total: 300 }, percentiles4: { total: 700 }, meanNumberOfRequestsPerSecond: { total: 5 } },
      contents: { 'req-1': { type: 'REQUEST', name: 'login', stats: { name: 'login', numberOfRequests: { total: 40, ok: 40, ko: 0 }, percentiles1: { total: 80 }, percentiles3: { total: 200 }, percentiles4: { total: 400 }, meanNumberOfRequestsPerSecond: { total: 2 } } } } });
    assert.equal(sniff('stats.json', gat), 'performance');
    assert.equal(JSON.parse(minimisePerformance(gat)).contents['req-1'].stats.percentiles3.total, 200);
    assert.equal(sniff('package.json', '{"name":"x","metrics":{}}'), null);
  });

  test('Jenkins: an archived k6 summary becomes a performance item of the build', async () => {
    const s = await new MockServer().start();
    const t0 = Date.now() - DAY;
    s.on('GET', '/job/app/api/json', () => ({ body: { builds: [{ number: 5, result: 'SUCCESS', building: false, timestamp: t0, duration: 600_000, actions: [{ lastBuiltRevision: { SHA1: 'a'.repeat(40), branch: [{ name: 'origin/main' }] } }],
      artifacts: [{ fileName: 'k6-summary.json', relativePath: 'perf/k6-summary.json' }], changeSets: [] }] } }));
    s.on('GET', '/job/app/5/artifact/perf/k6-summary.json', () => ({ headers: { 'Content-Type': 'application/json' }, body: K6 }));
    const a = new JenkinsAdapter(src({ type: 'jenkins', name: 'jk', baseUrl: s.url, user: 'qe', jobs: { app: 'team-pay' } }), http, { links: false }, { JENKINS_TOKEN: 't' });
    const r = await collect(a);
    const perf = r.of('performance');
    assert.equal(perf.length, 1);
    assert.deepEqual([perf[0].run, perf[0].attempt, perf[0].branch, perf[0].repo, perf[0].files.length], ['app#5', 1, 'main', 'app', 1]);
    assert.ok(!perf[0].files[0].content.includes('SECRET') && !perf[0].files[0].content.includes('@example.com'));
    await s.stop();
  });
});

describe('Pull requests', () => {
  test('GitHub: opened, first review by someone else, merged; the author as a pseudonym only with developer metrics on', async () => {
    const s = await new MockServer().start();
    s.on('GET', '/repos/acme/web/actions/runs', () => ({ body: { workflow_runs: [] } }));
    s.on('GET', '/repos/acme/web/deployments', () => ({ body: [] }));
    s.on('GET', '/repos/acme/web/pulls', () => ({ body: [
      { number: 12, state: 'closed', title: 'SECRET title', created_at: ago(5), updated_at: ago(3), merged_at: ago(3), closed_at: ago(3), user: { login: 'grace' }, head: { ref: 'SECRET-branch' } },
      { number: 13, state: 'open', title: 'x', created_at: ago(1), updated_at: ago(1), merged_at: null, closed_at: null, user: { login: 'grace' } },
      { number: 3, state: 'closed', created_at: ago(90), updated_at: ago(60), merged_at: ago(60), closed_at: ago(60), user: { login: 'old' } },
    ] }));
    s.on('GET', /^\/repos\/acme\/web\/pulls\/(\d+)\/reviews$/, (r) => ({ body: r.path.includes('/12/') ? [
      { user: { login: 'grace' }, submitted_at: ago(4.9), body: 'self note' }, { user: { login: 'linus' }, submitted_at: ago(4), state: 'APPROVED', body: 'SECRET review' }, { user: { login: 'ada' }, submitted_at: ago(3.5) },
    ] : [] }));
    s.on('GET', /^\/repos\/acme\/web\/pulls\/(\d+)\/commits$/, () => ({ body: [{ sha: 'c1', commit: { author: { name: 'Grace Hopper', email: 'Grace.Hopper@example.com' }, message: 'SECRET message' } }] }));
    const cfgSrc = src<any>({ type: 'github', name: 'gh', apiUrl: s.url, repos: { 'acme/web': 'team-web' }, pullRequests: true });
    const on = await collect(new GitHubAdapter(cfgSrc, http, withPeople, { GITHUB_TOKEN: 't' }));
    const prs = on.of('pull-requests');
    assert.deepEqual(prs.map((p) => [p.id, p.state, p.author]), [['12', 'merged', hash('grace.hopper@example.com')], ['13', 'open', hash('grace.hopper@example.com')]]);
    assert.ok(Math.abs(Date.parse(prs[0].firstReviewAt) - (Date.now() - 4 * DAY)) < 5000, 'the first review by someone other than the author');
    assert.deepEqual(Object.keys(prs[0]).sort(), ['author', 'closedAt', 'firstReviewAt', 'id', 'mergedAt', 'openedAt', 'repo', 'state']);
    noPeople(on.records);
    // Without developer metrics: no author, and the commits (the e-mail address) are not even read.
    const before = s.requests.filter((q) => q.path.endsWith('/commits')).length;
    const off = await collect(new GitHubAdapter(cfgSrc, http, { links: false }, { GITHUB_TOKEN: 't' }));
    assert.ok(off.of('pull-requests').every((p) => p.author === undefined));
    assert.equal(s.requests.filter((q) => q.path.endsWith('/commits')).length, before);
    // Not asked for: not read.
    const plain = await collect(new GitHubAdapter(src({ type: 'github', name: 'gh2', apiUrl: s.url, repos: { 'acme/web': 'team-web' } }), http, withPeople, { GITHUB_TOKEN: 't' }));
    assert.equal(plain.of('pull-requests').length, 0);
    await s.stop();
  });

  test('GitLab: merge requests with the first note or approval by someone else', async () => {
    const s = await new MockServer().start();
    s.on('GET', '/projects/acme%2Fapi', () => ({ body: { id: 7, path_with_namespace: 'acme/api' } }));
    s.on('GET', '/projects/7/pipelines', () => ({ body: [] }));
    s.on('GET', '/projects/7/deployments', () => ({ body: [] }));
    s.on('GET', '/projects/7/merge_requests', () => ({ body: [{ iid: 4, state: 'merged', title: 'SECRET', created_at: ago(6), updated_at: ago(2), merged_at: ago(2), closed_at: null, author: { username: 'grace' } }] }));
    s.on('GET', '/projects/7/merge_requests/4/notes', () => ({ body: [
      { system: true, body: 'added 1 commit', author: { username: 'linus' }, created_at: ago(5.9) }, { system: false, body: 'me', author: { username: 'grace' }, created_at: ago(5.8) },
      { system: true, body: 'approved this merge request', author: { username: 'linus' }, created_at: ago(5) }, { system: false, body: 'SECRET comment', author: { username: 'ada' }, created_at: ago(4) },
    ] }));
    s.on('GET', '/projects/7/merge_requests/4/commits', () => ({ body: [{ id: 'c1', author_email: 'grace.hopper@example.com', author_name: 'Grace Hopper', title: 'SECRET' }] }));
    const a = new GitLabAdapter(src({ type: 'gitlab', name: 'gl', apiUrl: s.url, projects: { 'acme/api': 'team-api' }, pullRequests: true }), http, withPeople, { GITLAB_TOKEN: 't' });
    const r = await collect(a);
    const [mr] = r.of('pull-requests');
    assert.deepEqual([mr.id, mr.repo, mr.state, mr.author], ['4', 'acme/api', 'merged', hash('grace.hopper@example.com')]);
    assert.ok(Math.abs(Date.parse(mr.firstReviewAt) - (Date.now() - 5 * DAY)) < 5000, 'the approval, not the "added 1 commit" system note');
    noPeople(r.records);
    await s.stop();
  });

  test('Bitbucket Cloud: the merge time and the first review come from the activity', async () => {
    const s = await new MockServer().start();
    s.on('GET', '/repositories/acme/shop/pipelines', () => ({ body: { values: [] } }));
    s.on('GET', '/repositories/acme/shop/pipelines/', () => ({ body: { values: [] } }));
    s.on('GET', '/repositories/acme/shop/environments', () => ({ body: { values: [] } }));
    s.on('GET', '/repositories/acme/shop/environments/', () => ({ body: { values: [] } }));
    s.on('GET', '/repositories/acme/shop/deployments', () => ({ body: { values: [] } }));
    s.on('GET', '/repositories/acme/shop/deployments/', () => ({ body: { values: [] } }));
    s.on('GET', '/repositories/acme/shop/pullrequests', () => ({ body: { values: [{ id: 9, state: 'MERGED', title: 'SECRET', created_on: ago(4), updated_on: ago(1), author: { uuid: '{u-grace}', display_name: 'Grace Hopper' } }] } }));
    s.on('GET', '/repositories/acme/shop/pullrequests/9/activity', () => ({ body: { values: [
      { update: { state: 'MERGED', date: ago(1.5) } }, { approval: { date: ago(3), user: { uuid: '{u-linus}' } } }, { comment: { created_on: ago(3.5), user: { uuid: '{u-grace}' }, content: { raw: 'SECRET' } } },
      { update: { state: 'OPEN', date: ago(4) } },
    ] } }));
    s.on('GET', '/repositories/acme/shop/pullrequests/9/commits', () => ({ body: { values: [{ hash: 'c1', author: { raw: 'Grace Hopper <grace.hopper@example.com>' }, message: 'SECRET' }] } }));
    const a = new BitbucketAdapter(src({ type: 'bitbucket', name: 'bb', apiUrl: s.url, username: 'qe', repos: { 'acme/shop': 'team-shop' }, pullRequests: true }), http, withPeople, { BITBUCKET_APP_PASSWORD: 't' });
    const r = await collect(a);
    const [pr] = r.of('pull-requests');
    assert.deepEqual([pr.id, pr.state, pr.author], ['9', 'merged', hash('grace.hopper@example.com')]);
    assert.ok(Math.abs(Date.parse(pr.mergedAt) - (Date.now() - 1.5 * DAY)) < 5000);
    assert.ok(Math.abs(Date.parse(pr.firstReviewAt) - (Date.now() - 3 * DAY)) < 5000);
    noPeople(r.records);
    await s.stop();
  });

  test('Azure DevOps: the team of the repository; the first comment or vote by someone else from the threads', async () => {
    const s = await new MockServer().start();
    const p = '/acme/Payments/_apis';
    s.on('GET', `${p}/build/definitions`, () => ({ body: { value: [{ id: 7, name: 'payments-ci' }] } }));
    s.on('GET', `${p}/build/builds`, () => ({ body: { value: [] } }));
    s.on('GET', `${p}/distributedtask/environments`, () => ({ body: { value: [] } }));
    s.on('GET', `${p}/git/pullrequests`, () => ({ body: { value: [
      { pullRequestId: 31, status: 'completed', title: 'SECRET', creationDate: ago(3), closedDate: ago(1), createdBy: { id: 'u1', uniqueName: 'grace.hopper@example.com', displayName: 'Grace Hopper' }, repository: { id: 'r1', name: 'payments' } },
      { pullRequestId: 32, status: 'active', creationDate: ago(2), createdBy: { id: 'u1', uniqueName: 'grace.hopper@example.com' }, repository: { id: 'r2', name: 'unmapped' } },
    ] } }));
    s.on('GET', `${p}/git/repositories/r1/pullRequests/31/threads`, () => ({ body: { value: [
      { comments: [{ author: { id: 'u1' }, publishedDate: ago(2.9), commentType: 'text', content: 'SECRET' }] },
      { properties: { CodeReviewThreadType: { $value: 'VoteUpdate' } }, comments: [{ author: { id: 'u2' }, publishedDate: ago(2), commentType: 'system' }] },
      { comments: [{ author: { id: 'u3' }, publishedDate: ago(2.5), commentType: 'system', content: 'policy status' }] },
    ] } }));
    const a = new AzureDevOpsAdapter(src({ type: 'azure-devops', name: 'ado', orgUrl: `${s.url}/acme`, project: 'Payments', pipelines: { 'payments-ci': 'team-pay', payments: 'team-pay' }, pullRequests: true }), http, withPeople, { AZURE_DEVOPS_TOKEN: 't' });
    const r = await collect(a);
    const prs = r.of('pull-requests');
    assert.deepEqual(prs.map((x) => [x.id, x.repo, x.state, x.author]), [['31', 'payments', 'merged', hash('grace.hopper@example.com')]]);
    assert.ok(Math.abs(Date.parse(prs[0].firstReviewAt) - (Date.now() - 2 * DAY)) < 5000, 'the vote, not the author\'s own comment or a policy note');
    assert.ok(r.skipped.some((x) => /unmapped/.test(x.reason)));
    noPeople(r.records);
    await s.stop();
  });
});

describe('Test management', () => {
  test('time spans: TestRail estimates and elapsed times', () => {
    assert.deepEqual([spanSeconds('30m'), spanSeconds('1h 30m'), spanSeconds('1d'), spanSeconds('45s'), spanSeconds(''), spanSeconds(null), spanSeconds('soon')], [1800, 5400, 28800, 45, null, null, null]);
  });

  test('TestRail: cases (automated by the field or the type), results as executions of their case', async () => {
    const s = await new MockServer().start();
    const call = (r: any) => String([...r.query.keys()][0] ?? '');
    s.on('GET', '/index.php', (r) => {
      const c = call(r);
      if (c === '/api/v2/get_case_types') return { body: [{ id: 1, name: 'Other' }, { id: 3, name: 'Automated' }] };
      if (c === '/api/v2/get_project/5') return { body: { id: 5, suite_mode: 1, is_completed: false } };
      if (c === '/api/v2/get_suites/5') return { body: [{ id: 50, name: 'Master' }] };
      if (c === '/api/v2/get_cases/5') {
        assert.equal(r.query.get('suite_id'), '50');
        return { body: { offset: 0, limit: 250, size: 4, _links: { next: null }, cases: [
          { id: 1, title: 'SECRET case', type_id: 1, custom_automation_type: 2, estimate: '30m', updated_on: 1_760_000_000, created_by: 9 },
          { id: 2, title: 'x', type_id: 3, custom_automation_type: 0, estimate: null, updated_on: 1_760_000_000 },
          { id: 3, title: 'x', type_id: 1, custom_automation_type: 0, estimate: '1h', updated_on: 1_760_000_000 },
          { id: 4, title: 'x', type_id: 1, custom_automation_type: null, is_deleted: 1, updated_on: 1_760_000_000 },
        ] } };
      }
      if (c === '/api/v2/get_runs/5') return { body: { runs: [{ id: 70, name: 'SECRET run' }], _links: { next: null } } };
      if (c === '/api/v2/get_tests/70') return { body: { tests: [{ id: 700, case_id: 1 }, { id: 701, case_id: 3 }], _links: { next: null } } };
      if (c === '/api/v2/get_results_for_run/70') return { body: { results: [
        { id: 9001, test_id: 700, status_id: 1, created_on: Math.floor((Date.now() - DAY) / 1000), elapsed: '1m 5s', comment: 'SECRET comment', created_by: 9 },
        { id: 9002, test_id: 701, status_id: 5, created_on: Math.floor((Date.now() - DAY) / 1000), elapsed: null },
        { id: 9003, test_id: 701, status_id: null, created_on: Math.floor((Date.now() - DAY) / 1000), comment: 'just a note' },
        { id: 9004, test_id: 700, status_id: 1, created_on: Math.floor((Date.now() - 40 * DAY) / 1000) },
      ], _links: { next: null } } };
      return { status: 404, body: { error: `no stand-in for ${c}` } };
    });
    const a = new TestRailAdapter(src({ type: 'testrail', name: 'tr', baseUrl: s.url, user: 'qe@example.org', projects: { 5: 'team-pay' } }), http, { TESTRAIL_API_KEY: 'k' });
    assert.match((await a.check())[0], /project 5: active/);
    const r = await collect(a);
    const items = r.of('test-management');
    assert.deepEqual(items.filter((x) => x.type === 'case').map((x) => [x.key, x.automated, x.manualEstimateSeconds ?? null, x.archived ?? false]),
      [['C1', true, 1800, false], ['C2', true, null, false], ['C3', false, 3600, false], ['C4', false, null, true]]);
    assert.deepEqual(items.filter((x) => x.type === 'execution').map((x) => [x.key, x.case, x.automated, x.status, x.durationSeconds ?? null]),
      [['R9001', 'C1', true, 'passed', 65], ['R9002', 'C3', false, 'failed', null]]);
    assert.equal(s.requests[0].headers.authorization, 'Basic ' + Buffer.from('qe@example.org:k').toString('base64'));
    assert.ok(s.requests.every((q) => q.method === 'GET'));
    noPeople(r.records);
    await s.stop();
  });

  test('Xray Cloud: the token, tests by type, test runs', async () => {
    const s = await new MockServer().start();
    s.on('POST', '/authenticate', (r) => { assert.deepEqual(r.json, { client_id: 'cid', client_secret: 'csecret' }); return { body: JSON.stringify('xray-token') }; });
    s.on('POST', '/graphql', (r) => {
      assert.equal(r.headers.authorization, 'Bearer xray-token');
      assert.doesNotMatch(String(r.json.query), /mutation/i);
      if (/getTestExecutions/.test(r.json.query)) return { body: { data: { getTestExecutions: { total: 1, results: [{ issueId: '900', testRuns: { results: [
        { id: 'run-1', status: { name: 'PASSED' }, startedOn: ago(1.01), finishedOn: ago(1), test: { issueId: '10', jira: { key: 'PAY-10' } } },
        { id: 'run-2', status: { name: 'FAILED' }, startedOn: ago(2), finishedOn: ago(2), test: { issueId: '11', jira: { key: 'PAY-11' } } },
      ] } }] } } } };
      return { body: { data: { getTests: { total: 2, results: [
        { issueId: '10', testType: { name: 'Generic' }, jira: { key: 'PAY-10', timeoriginalestimate: 1200, updated: ago(3), summary: 'SECRET' } },
        { issueId: '11', testType: { name: 'Manual' }, jira: { key: 'PAY-11', timeoriginalestimate: null } },
      ] } } } };
    });
    const a = new XrayAdapter(src({ type: 'xray', name: 'xr', apiUrl: s.url, clientId: 'cid', projects: { PAY: 'team-pay' } }), http, { XRAY_CLIENT_SECRET: 'csecret' });
    const r = await collect(a);
    const items = r.of('test-management');
    assert.deepEqual(items.filter((x) => x.type === 'case').map((x) => [x.key, x.automated, x.manualEstimateSeconds ?? null]), [['PAY-10', true, 1200], ['PAY-11', false, null]]);
    const ex = items.filter((x) => x.type === 'execution');
    assert.deepEqual(ex.map((x) => [x.key, x.case, x.automated, x.status]), [['run-1', 'PAY-10', true, 'passed'], ['run-2', 'PAY-11', false, 'failed']]);
    assert.ok(Math.abs(ex[0].durationSeconds - 864) <= 1, '0.01 day');
    noPeople(r.records);
    await s.stop();
  });

  test('Zephyr Scale: cases automated by a custom field or a label; executions carry their own automated flag', async () => {
    const s = await new MockServer().start();
    s.on('GET', '/testcases', () => ({ body: { total: 3, isLast: true, values: [
      { key: 'PAY-T1', name: 'SECRET', estimatedTime: 600_000, customFields: { Automated: true }, labels: [] },
      { key: 'PAY-T2', name: 'x', estimatedTime: null, customFields: {}, labels: ['Automation'] },
      { key: 'PAY-T3', name: 'x', customFields: { Automated: 'No' }, labels: ['smoke'] },
    ] } }));
    s.on('GET', '/statuses', () => ({ body: { values: [{ id: 1, name: 'Pass' }, { id: 2, name: 'Fail' }] } }));
    s.on('GET', '/testexecutions', (r) => {
      assert.match(String(r.query.get('actualEndDateAfter')), /^\d{4}-\d\d-\d\dT/);
      return { body: { isLast: true, values: [
        { id: 1, key: 'PAY-E1', testCase: { self: 'https://api.example/v2/testcases/PAY-T1/versions/2' }, testExecutionStatus: { id: 1 }, actualEndDate: ago(1), executionTime: 42_000, automated: true, executedById: 'SECRET-user' },
        { id: 2, key: 'PAY-E2', testCase: { self: 'https://api.example/v2/testcases/PAY-T3/versions/1' }, testExecutionStatus: { id: 2 }, actualEndDate: ago(2), executionTime: 300_000, automated: false, comment: 'SECRET' },
      ] } };
    });
    const a = new ZephyrAdapter(src({ type: 'zephyr', name: 'zs', apiUrl: s.url, projects: { PAY: 'team-pay' } }), http, { ZEPHYR_TOKEN: 'zt' });
    const r = await collect(a);
    const items = r.of('test-management');
    assert.deepEqual(items.filter((x) => x.type === 'case').map((x) => [x.key, x.automated, x.manualEstimateSeconds ?? null]), [['PAY-T1', true, 600], ['PAY-T2', true, null], ['PAY-T3', false, null]]);
    assert.deepEqual(items.filter((x) => x.type === 'execution').map((x) => [x.key, x.case, x.automated, x.status, x.durationSeconds]), [['PAY-E1', 'PAY-T1', true, 'pass', 42], ['PAY-E2', 'PAY-T3', false, 'fail', 300]]);
    assert.ok(s.requests.every((q) => q.headers.authorization === 'Bearer zt' && q.method === 'GET'));
    noPeople(r.records);
    await s.stop();
  });

  test('Jira: an issue with one of the labels you name is sent as test-automation work; your labels are not sent', () => {
    const raw = { key: 'QA-7', fields: { project: { key: 'QA' }, issuetype: { name: 'Task' }, status: { name: 'Done', statusCategory: { key: 'done' } }, created: ago(9), updated: ago(1), resolutiondate: ago(1), timespent: 7200, labels: ['QA-Automation', 'internal-codename'] }, changelog: { histories: [] } };
    const ctx = (automationLabels: string[]) => ({ src: { teams: { QA: 'team-qa' }, defaultTeam: null, baseUrl: 'https://jira.example.org', automationLabels }, fields: { storyPoints: null, sprint: null, environment: null, flagged: null },
      statusCategories: new Map<string, string>(), privacy: { privacy: { sendTitles: false, sendLinks: false, people: 'none' as const }, salt: null } });
    const on = finalRecord('issue', mapJiraIssue(raw, ctx(['qa-automation'])).record!, ctx([]).privacy);
    assert.deepEqual(on.labels, ['test-automation']);
    assert.equal(on.timeLoggedHours, 2);
    assert.ok(!JSON.stringify(on).includes('codename') && !JSON.stringify(on).includes('QA-Automation'));
    assert.equal(finalRecord('issue', mapJiraIssue(raw, ctx([])).record!, ctx([]).privacy).labels, undefined);
  });
});

describe('Calendars (free/busy only)', () => {
  test('working days and offsets from UTC', () => {
    assert.equal(utcOffsetMinutes('UTC', '2026-07-01'), 0);
    assert.equal(utcOffsetMinutes('Europe/Dublin', '2026-07-01'), 60);
    assert.equal(utcOffsetMinutes('Europe/Dublin', '2026-12-01'), 0);
    assert.equal(utcOffsetMinutes('America/New_York', '2026-12-01'), -300);
    // Wednesday 18 Nov 2026 12:00 UTC: the 7 days before, Monday to Friday, up to yesterday.
    const now = new Date('2026-11-18T12:00:00Z');
    assert.deepEqual(workingDays(new Date(now.getTime() - 7 * DAY), now, 'UTC', 35), ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17']);
    assert.deepEqual(workingDays(new Date(0), now, 'UTC', 2), ['2026-11-16', '2026-11-17']);
  });

  test('Google Calendar: a signed service account assertion with the free/busy scope; busy intervals per person and day', async () => {
    const s = await new MockServer().start();
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    s.on('POST', '/token', (r) => {
      const form = new URLSearchParams(r.body);
      assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const [h, b, sig] = String(form.get('assertion')).split('.');
      assert.ok(createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(sig, 'base64url')));
      const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
      assert.deepEqual([claims.iss, claims.sub, claims.scope], ['qe@proj.iam.gserviceaccount.com', 'admin@example.com', 'https://www.googleapis.com/auth/calendar.freebusy']);
      return { body: { access_token: 'g-token', expires_in: 3600 } };
    });
    const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    s.on('POST', '/freeBusy', (r) => {
      assert.equal(r.headers.authorization, 'Bearer g-token');
      assert.deepEqual(Object.keys(r.json).sort(), ['items', 'timeMax', 'timeMin']);
      return { body: { calendars: {
        'grace.hopper@example.com': { busy: [{ start: `${yesterday}T10:00:00Z`, end: `${yesterday}T11:00:00Z` }, { start: `${yesterday}T13:00:00Z`, end: `${yesterday}T13:30:00Z` }] },
        'gone@example.com': { errors: [{ domain: 'global', reason: 'notFound' }], busy: [] },
      } } };
    });
    const cfg = src<any>({ type: 'google-calendar', name: 'gcal', apiUrl: s.url, tokenUrl: `${s.url}/token`, serviceAccount: 'qe@proj.iam.gserviceaccount.com', subject: 'admin@example.com',
      people: { 'grace.hopper@example.com': 'team-pay', 'gone@example.com': 'team-pay' }, lookbackDays: 3 });
    const a = new GoogleCalendarAdapter(cfg, http, (e) => person(e), { GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: pem });
    const r = await collect(a, 3);
    const days = r.of('calendar');
    assert.ok(days.length >= 1 && days.every((d) => d.person === hash('grace.hopper@example.com')));
    const y = days.find((d) => d.day === yesterday);
    if (y) {
      assert.deepEqual([y.workStart, y.workEnd, y.utcOffsetMinutes, y.busy.length], ['09:00', '17:00', 0, 2]);
      assert.deepEqual(Object.keys(y.busy[0]).sort(), ['end', 'start']);
    }
    assert.ok(r.skipped.some((x) => /not readable/.test(x.reason)), 'a calendar that cannot be read is not a day without meetings');
    noPeople(r.records);
    // Developer metrics off: nothing is sent.
    const off = await collect(new GoogleCalendarAdapter(cfg, http, () => null, { GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: pem }), 3);
    assert.equal(off.of('calendar').length, 0);
    await s.stop();
  });

  test('Microsoft 365: client credentials; busy and tentative are busy, an out-of-office day is marked, the person\'s working hours are used', async () => {
    const s = await new MockServer().start();
    s.on('POST', '/tenant-1/oauth2/v2.0/token', (r) => {
      const form = new URLSearchParams(r.body);
      assert.deepEqual([form.get('grant_type'), form.get('client_id'), form.get('client_secret'), form.get('scope')], ['client_credentials', 'app-1', 'ms-secret', 'https://graph.microsoft.com/.default']);
      return { body: { access_token: 'ms-token' } };
    });
    const days = workingDays(new Date(Date.now() - 6 * DAY), new Date(), 'UTC', 6);
    const [d1, d2] = [days[days.length - 1], days[days.length - 2]];
    s.on('POST', /^\/users\/[^/]+\/calendar\/getSchedule$/, (r) => {
      assert.equal(r.headers.authorization, 'Bearer ms-token');
      return { body: { value: [{ scheduleId: 'Grace.Hopper@example.com', workingHours: { startTime: '08:00:00.0000000', endTime: '16:00:00.0000000', daysOfWeek: ['monday'], timeZone: { name: 'GMT Standard Time' } }, scheduleItems: [
        { status: 'busy', subject: 'SECRET subject', location: 'SECRET room', start: { dateTime: `${d1}T09:00:00.0000000`, timeZone: 'UTC' }, end: { dateTime: `${d1}T10:00:00.0000000`, timeZone: 'UTC' } },
        { status: 'tentative', start: { dateTime: `${d1}T14:00:00.0000000`, timeZone: 'UTC' }, end: { dateTime: `${d1}T14:30:00.0000000`, timeZone: 'UTC' } },
        { status: 'free', start: { dateTime: `${d1}T11:00:00.0000000`, timeZone: 'UTC' }, end: { dateTime: `${d1}T12:00:00.0000000`, timeZone: 'UTC' } },
        { status: 'oof', start: { dateTime: `${d2}T00:00:00.0000000`, timeZone: 'UTC' }, end: { dateTime: `${d2}T23:59:00.0000000`, timeZone: 'UTC' } },
      ] }] } };
    });
    const cfg = src<any>({ type: 'microsoft-365', name: 'm365', apiUrl: s.url, loginUrl: s.url, tenantId: 'tenant-1', clientId: 'app-1', people: { 'grace.hopper@example.com': 'team-pay' }, lookbackDays: 6 });
    const r = await collect(new Microsoft365Adapter(cfg, http, (e) => person(e), { MS365_CLIENT_SECRET: 'ms-secret' }), 6);
    const by = Object.fromEntries(r.of('calendar').map((d) => [d.day, d]));
    assert.deepEqual([by[d1].workStart, by[d1].workEnd, by[d1].busy.length, by[d1].outOfOffice ?? false], ['08:00', '16:00', 2, false]);
    assert.equal(by[d1].busy[0].start, `${d1}T09:00:00.000Z`);
    assert.equal(by[d2].outOfOffice, true);
    noPeople(r.records);
    await s.stop();
  });
});

describe('Configuration of the new sources', () => {
  test('defaults, and what is refused', () => {
    const c = config({ privacy: { developerMetrics: true }, sources: [
      { type: 'github', repos: { 'a/b': 't' }, pullRequests: true },
      { type: 'jira', baseUrl: 'https://x.atlassian.net', jql: 'project = QA', teams: { QA: 't' }, automationLabels: ['Automation'] },
      { type: 'testrail', baseUrl: 'https://x.testrail.io', projects: { 5: 't' } },
      { type: 'zephyr', projects: { PAY: 't' } },
    ] });
    assert.equal(c.privacy.developerMetrics, true);
    assert.deepEqual((c.sources[0] as any).artifacts.performance, ['*perf*', '*load*', '*k6*', '*jmeter*', '*gatling*']);
    assert.deepEqual((c.sources[1] as any).automationLabels, ['automation']);
    assert.equal((c.sources[2] as any).automatedField, 'custom_automation_type');
    assert.equal(config({ sources: [{ type: 'github', repos: { 'a/b': 't' } }] }).privacy.developerMetrics, false);
    assert.throws(() => config({ sources: [{ type: 'testrail', baseUrl: 'https://x.testrail.io', projects: { PAY: 't' } }] }), /TestRail project id/);
    assert.throws(() => config({ sources: [{ type: 'google-calendar', serviceAccount: 'a', subject: 'b', people: { grace: 't' } }] }), /e-mail address/);
    assert.throws(() => config({ sources: [{ type: 'microsoft-365', tenantId: 't', clientId: 'c', people: { 'a@b.co': 't' }, timeZone: 'Mars/Olympus' }] }), /IANA time zone/);
    assert.throws(() => config({ sources: [{ type: 'microsoft-365', tenantId: 't', clientId: 'c', people: { 'a@b.co': 't' }, clientSecret: 'x' }] }), /not a known setting|secrets are never read/);
  });
});
