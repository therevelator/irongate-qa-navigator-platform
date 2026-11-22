/**
 * The CI and code-quality connectors against local stand-ins of each vendor API (test/ci-fixtures.ts): what they
 * read, pagination, rate limits, artifact downloads (redirects to another host without the credentials, expired
 * and oversized artifacts), and the raw items they produce for the envelope (report files as files, without
 * messages; pipeline runs, deployments with commits).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { configureLog } from '../src/log';
import { MockServer, config, type Recorded } from './helpers';
import { storage, mockGitHub, mockGitLab, mockJenkins, mockAzure, mockSonar, SHA, zip, type StorageMock } from './ci-fixtures';
import { GitHubAdapter, appJwt } from '../src/sources/ci/github';
import { GitLabAdapter } from '../src/sources/ci/gitlab';
import { JenkinsAdapter } from '../src/sources/ci/jenkins';
import { AzureDevOpsAdapter } from '../src/sources/ci/azure';
import { SonarQubeAdapter } from '../src/sources/ci/sonarqube';
import { SourceClient, SourceError } from '../src/sources/client';
import { globMatch, parallelGroupOf } from '../src/sources/ci/common';
import type { CiAdapter, CiRecord, CiKind } from '../src/sources/ci/common';
import type { GitHubSource, GitLabSource, JenkinsSource, AzureDevOpsSource, SonarQubeSource } from '../src/config';

configureLog({ sink: () => {} });
const http = { timeoutSeconds: 10, maxRetries: 2, maxRetryWaitSeconds: 1, caFile: null };
const DAY = 86_400_000;

async function collectAll(a: CiAdapter, sinceDays = 30) {
  const records: CiRecord[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  let changedAt: string | null = null;
  for await (const p of a.collect(new Date(Date.now() - sinceDays * DAY), new Date())) {
    records.push(...p.records);
    skipped.push(...p.skipped);
    if (p.changedAt && (!changedAt || p.changedAt > changedAt)) changedAt = p.changedAt;
  }
  const of = (k: CiKind) => records.filter((r) => r.kind === k).map((r) => r.item as any);
  return { records, skipped, changedAt, of };
}

let vendor: MockServer;
let store: StorageMock;
before(async () => { store = await storage(); });
after(async () => { await store.server.stop(); });

describe('GitHub Actions', () => {
  let src: GitHubSource;
  before(async () => {
    vendor = await new MockServer().start();
    mockGitHub(vendor, store, { rateLimitOnce: true });
    src = config({ sources: [{ type: 'github', name: 'gh', apiUrl: vendor.url, repos: { 'acme/payments': 'team-pay' } }] }).sources[0] as GitHubSource;
  });
  after(async () => { await vendor.stop(); });

  test('runs (2 pages, after a secondary rate limit), jobs and steps, test / coverage / SARIF artifacts, deployments with commits', async () => {
    const r = await collectAll(new GitHubAdapter(src, http, { links: false }, { GITHUB_TOKEN: 'ghp_secret_token_value_1234' }));
    // Secondary rate limit: the first list call was a 403 with Retry-After; it was retried, and page 2 was read.
    assert.equal(vendor.count('/repos/acme/payments/actions/runs'), 3);
    assert.equal(vendor.requests.filter((q) => q.path === '/repos/acme/payments/actions/runs' && q.query.get('page') === '2').length, 1);
    const pipes = r.of('pipeline-runs');
    assert.deepEqual(pipes.map((p) => [p.id, p.attempt, p.result]), [['101', 1, 'failed'], ['101', 2, 'success'], ['102', 1, 'success'], ['103', 1, 'cancelled']]);
    const p1 = pipes[1];
    // The CI's own values; the stage kind is QE Navigator's to decide (not sent).
    assert.deepEqual(p1.stages.map((x: any) => [x.name, x.kind, x.parallelGroup ?? null, x.durationSeconds, x.result]), [
      ['build', undefined, null, 180, 'success'], ['test (1, 2)', undefined, 'test', 360, 'success'], ['test (2, 2)', undefined, 'test', 240, 'success'], ['deploy', undefined, null, 120, 'success'],
    ]);
    assert.equal(p1.url, undefined, 'links only with privacy.sendLinks');
    // Test reports: the JUnit files as files, per run and attempt, without failure messages or stack traces.
    const tr = r.of('test-report');
    assert.deepEqual(tr.map((t) => [t.run, t.attempt, t.files.length]), [['101', 1, 1], ['101', 2, 1], ['102', 1, 1]]);
    assert.ok(tr.every((t) => t.commit && /<testcase classname="checkout" name="pays with a saved card"/.test(t.files[0].content)));
    assert.match(tr[0].files[0].content, /<failure\/>/);
    assert.ok(!JSON.stringify(tr).includes('SECRET-STACK') && !JSON.stringify(tr).includes('alice@'), 'failure messages are stripped');
    const cov = r.of('coverage');
    assert.equal(cov.length, 3);
    assert.match(cov[0].files[0].content, /SF:src\/checkout\/pay\.ts/);
    const sa = r.of('sarif');
    assert.deepEqual(sa.map((x) => [x.repo, x.files.length]), [['acme/payments', 1], ['acme/payments', 1], ['acme/payments', 1]]);
    assert.equal(JSON.parse(sa[0].files[0].content).runs[0].results.length, 2);
    assert.ok(!JSON.stringify(sa).includes('SECRET-QUERY'), 'finding messages are stripped');
    // Expired and oversized artifacts are reported, not downloaded; an unrelated artifact is not touched.
    assert.ok(r.skipped.some((x) => x.id.endsWith('/test-results-old') && /expired/.test(x.reason)));
    assert.ok(r.skipped.some((x) => x.id.endsWith('/coverage-huge') && /900 MB/.test(x.reason)));
    assert.equal(vendor.requests.filter((q) => /\/artifacts\/\d+(05|06)\/zip$/.test(q.path)).length, 0);
    // Deployments: production only, finished ones; the hotfix; the rollback (a commit an earlier deployment shipped); commits from compare.
    const deps = r.of('deployments');
    assert.deepEqual(deps.map((d) => [d.id, d.result, !!d.hotfix, d.rollbackOf ?? null, d.previousCommit ?? null, (d.commits ?? []).length]), [
      ['9001', 'success', false, null, null, 1], ['9002', 'success', false, null, SHA.d0, 2], ['9003', 'success', true, null, SHA.d1, 2], ['9004', 'success', false, '9003', SHA.d2, 2], ['9005', 'failure', false, null, SHA.d1, 0],
    ]);
    assert.ok(r.skipped.some((x) => x.id === 'acme/payments deployment 9006' && /not finished/.test(x.reason)));
    assert.ok(deps.flatMap((d) => d.commits ?? []).every((x: any) => x.authoredAt !== null && Object.keys(x).join() === 'sha,authoredAt,committedAt'));
    assert.ok(!JSON.stringify(r.records).includes('alice@example.com') && !JSON.stringify(r.records).includes('SECRET-MSG') && !JSON.stringify(r.records).includes('Fix refund'));
  });

  test('artifact downloads follow the redirect to the storage host without the token; the token reaches GitHub only', async () => {
    const blobs = store.server.requests.filter((q) => q.path.startsWith('/blob/'));
    assert.ok(blobs.length >= 9, `${blobs.length} storage downloads`);
    for (const b of blobs) assert.equal(b.headers.authorization, undefined, 'no Authorization on the storage host');
    for (const q of vendor.requests) assert.equal(q.headers.authorization, 'Bearer ghp_secret_token_value_1234');
  });
});

describe('GitHub App authentication', () => {
  test('a JWT signed with the app key buys an installation token, which is then used (renewed when it expires)', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const s = await new MockServer().start();
    let jwtOk = false;
    s.on('POST', '/app/installations/77/access_tokens', (r: Recorded) => {
      const jwt = String(r.headers.authorization).replace('Bearer ', '');
      const [h, b, sig] = jwt.split('.');
      jwtOk = createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
      assert.equal(JSON.parse(Buffer.from(b, 'base64').toString()).iss, '12345');
      return { status: 201, body: { token: 'ghs_installation_token_abc', expires_at: new Date(Date.now() + 3600_000).toISOString() } };
    });
    s.on('GET', '/repos/acme/app', () => ({ body: { private: true } }));
    s.on('GET', '/repos/acme/app/actions/runs', () => ({ body: { total_count: 0, workflow_runs: [] } }));
    s.on('GET', '/repos/acme/app/environments', () => ({ body: { environments: [] } }));
    const src = config({ sources: [{ type: 'github', name: 'gh', apiUrl: s.url, auth: 'app', appId: '12345', installationId: '77', repos: { 'acme/app': 'team-a' } }] }).sources[0] as GitHubSource;
    const lines = await new GitHubAdapter(src, http, { links: false }, { GITHUB_APP_PRIVATE_KEY: pem.replace(/\n/g, '\\n') }).check();
    assert.ok(jwtOk, 'JWT verifies with the app public key');
    assert.match(lines[0], /acme\/app: private, 0 completed workflow runs/);
    assert.ok(s.requests.filter((q) => q.method === 'GET').every((q) => q.headers.authorization === 'Bearer ghs_installation_token_abc'));
    assert.equal(appJwt('1', pem).split('.').length, 3);
    await s.stop();
  });

  test('a config without appId / installationId, or a key that is not PEM, is refused', () => {
    assert.throws(() => config({ sources: [{ type: 'github', auth: 'app', repos: { 'a/b': 't' } }] }), /appId and installationId/);
    const src = config({ sources: [{ type: 'github', auth: 'app', appId: '1', installationId: '2', repos: { 'a/b': 't' } }] }).sources[0] as GitHubSource;
    assert.throws(() => new GitHubAdapter(src, http, { links: false }, { GITHUB_APP_PRIVATE_KEY: 'not a key' }), /PEM/);
    assert.throws(() => config({ sources: [{ type: 'github', repos: { 'not-a-repo': 't' } }] }), /owner\/name/);
    assert.throws(() => config({ sources: [{ type: 'github', repos: {} }] }), /at least one repo/);
    assert.throws(() => config({ sources: [{ type: 'github', repos: { 'a/b': 't' }, token: 'x' }] }), /secrets are never read/);
  });
});

describe('downloads: attacker and failure paths', () => {
  test('a redirect to a plain-http host, a download over the size cap, a missing artifact, a link to another host', async () => {
    const s = await new MockServer().start();
    s.on('GET', '/a/evil', () => ({ status: 302, headers: { location: 'http://storage.example.net/blob' } }));
    s.on('GET', '/a/big', () => ({ status: 200, body: Buffer.alloc(3 * 1024 * 1024, 1) as any }));
    s.on('GET', '/a/gone', () => ({ status: 410, body: 'gone' }));
    s.on('GET', '/a/loop', () => ({ status: 302, headers: { location: `${s.url}/a/loop` } }));
    const c = new SourceClient({ source: 't', baseUrl: s.url, headers: { Authorization: 'Bearer t0ken-value' }, caFile: null, http, authHint: '' });
    await assert.rejects(c.download('/a/evil', 1e6), /refusing a download redirect to http:\/\/storage.example.net/);
    assert.deepEqual(await c.download('/a/big', 1024 * 1024), { ok: false, reason: 'too-large', message: 'larger than 1 MB (artifacts.maxMB)' });
    assert.equal((await c.download('/a/gone', 1e6) as any).reason, 'expired');
    await assert.rejects(c.download('/a/loop', 1e6), /too many redirects/);
    await assert.rejects(c.download('https://other.example.com/x', 1e6), /refusing to send credentials to another host/);
    await assert.rejects(c.get('https://other.example.com/x'), /refusing to follow a link to another host/);
    await s.stop();
  });

  test('X-RateLimit-Remaining: 0 makes the next request wait for the reset (capped)', async () => {
    const s = await new MockServer().start();
    let n = 0;
    s.on('GET', '/x', () => ({ headers: { 'x-ratelimit-remaining': String(n++ === 0 ? 0 : 10), 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 30) }, body: {} }));
    const waits: number[] = [];
    const c = new SourceClient({ source: 't', baseUrl: s.url, headers: {}, caFile: null, http, authHint: '', retry: { sleep: async (ms) => { waits.push(ms); } } });
    await c.get('/x');
    await c.get('/x');
    assert.equal(waits.length, 1);
    assert.ok(waits[0] <= 1000, 'capped by http.maxRetryWaitSeconds');
    assert.equal(c.rateLimitWaits, 1);
    await s.stop();
  });

  test('a 403 that is not a rate limit is an auth error with the read-only hint; a rate limit that does not end is reported as such', async () => {
    const s = await new MockServer().start();
    s.on('GET', '/forbidden', () => ({ status: 403, body: { message: 'Resource not accessible by integration' } }));
    s.on('GET', '/limited', () => ({ status: 429, headers: { 'retry-after': '0' }, body: { message: 'API rate limit exceeded' } }));
    const c = new SourceClient({ source: 't', baseUrl: s.url, headers: {}, caFile: null, http, authHint: 'Use a read-only token.' });
    await assert.rejects(c.get('/forbidden'), (e: SourceError) => e.auth && /Use a read-only token/.test(e.message));
    await assert.rejects(c.get('/limited'), /still rate limited/);
    assert.equal(s.count('/limited'), 3, 'retried maxRetries times');
    await s.stop();
  });

  test('a zip bomb, a damaged archive or a file with XML entities in an artifact is refused, the rest of the run is kept', async () => {
    const { findReports } = await import('../src/sources/ci/common');
    const bomb = zip({ 'junit.xml': '<testsuite>' + ' '.repeat(5_000_000) + '</testsuite>' });
    const r = findReports([
      { artifact: 'bomb', name: 'b.zip', data: bomb, kinds: ['tests'] },
      { artifact: 'broken', name: 'x.zip', data: Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(40)]), kinds: ['tests'] },
      { artifact: 'xxe', name: 'evil.xml', data: Buffer.from('<?xml version="1.0"?><!DOCTYPE t [<!ENTITY x SYSTEM "file:///etc/passwd">]><testsuite><testcase name="&x;"/></testsuite>'), kinds: ['tests'] },
      { artifact: 'ok', name: 'lcov.info', data: Buffer.from('SF:a.ts\nLF:2\nLH:1\nend_of_record\n'), kinds: ['coverage'] },
    ]);
    assert.ok(r.skipped.some((x) => x.id === 'bomb' && /expands|zip bomb/.test(x.reason)), JSON.stringify(r.skipped));
    assert.ok(r.skipped.some((x) => x.id === 'broken'));
    assert.ok(r.skipped.some((x) => x.id.startsWith('xxe') && /entities/.test(x.reason)), 'external entities refused');
    assert.equal(r.tests.length, 0);
    assert.equal(r.coverage.length, 1);
    assert.match(r.coverage[0].content, /LF:2/);
  });

  test('glob patterns and matrix groups', () => {
    assert.ok(globMatch('*test*', 'Unit-Test-Results'));
    assert.ok(!globMatch('*coverage*', 'cov.zip'));
    assert.equal(parallelGroupOf('rspec 1/4', ['rspec 1/4', 'rspec 2/4']), 'rspec');
    assert.equal(parallelGroupOf('test (ubuntu, 18)', ['test (ubuntu, 18)']), null);
  });
});

describe('GitLab CI', () => {
  test('pipelines (X-Next-Page), jobs with retried ones, the test report API, artifacts via redirect, deployments with compare', async () => {
    const s = await new MockServer().start();
    mockGitLab(s, store);
    const src = config({ sources: [{ type: 'gitlab', name: 'gl', apiUrl: `${s.url}/api/v4`, projects: { 'acme/web': 'team-web' } }] }).sources[0] as GitLabSource;
    const a = new GitLabAdapter(src, http, { links: true }, { GITLAB_TOKEN: 'glpat-secret-value' });
    assert.match((await a.check())[0], /acme\/web \(id 42\): pipelines readable; environments: production, review\/feature/);
    const r = await collectAll(a);
    assert.ok(s.requests.some((q) => q.path === '/api/v4/projects/42/pipelines' && q.query.get('page') === '2'));
    const pipes = r.of('pipeline-runs');
    assert.deepEqual(pipes.map((p) => [p.id, p.result]), [['501', 'failed'], ['502', 'success']], 'the running pipeline is not read');
    assert.deepEqual(pipes[1].stages.filter((x: any) => x.parallelGroup).map((x: any) => [x.name, x.kind]), [['rspec 1/2', 'test'], ['rspec 2/2', 'test']]);
    assert.equal(pipes[1].url, 'https://gitlab.com/acme/web/-/pipelines/502', 'links with privacy.sendLinks');
    // GitLab's test report API (JSON) written out as a JUnit file: names, statuses, times; no output.
    const tr = r.of('test-report');
    assert.deepEqual(tr.map((t) => [t.run, t.format, (t.files[0].content.match(/<testcase /g) ?? []).length, (t.files[0].content.match(/<failure\/>/g) ?? []).length]), [['501', 'junit', 3, 1], ['502', 'junit', 3, 0]]);
    assert.match(tr[0].files[0].content, /<testsuites time="9.500">/);
    assert.ok(!JSON.stringify(tr).includes('SECRET-OUT'));
    assert.deepEqual(r.of('coverage').map((c) => [c.run, /lines-valid="4"/.test(c.files[0].content)]), [['501', true], ['502', true]]);
    assert.ok(r.skipped.some((x) => /sast-report/.test(x.id) && /expired/.test(x.reason)));
    assert.deepEqual(r.of('deployments').map((d) => [d.id, d.result, d.previousCommit ?? null, (d.commits ?? []).map((c: any) => c.sha)]), [['701', 'success', null, []], ['702', 'success', SHA.d0, [SHA.d1]], ['703', 'failure', SHA.d1, []]]);
    assert.ok(s.requests.every((q) => q.headers['private-token'] === 'glpat-secret-value'));
    assert.ok(store.server.requests.filter((q) => q.path.startsWith('/blob/gl-')).every((q) => !q.headers['private-token']));
    await s.stop();
  });
});

describe('Jenkins', () => {
  test('builds (finished only), wfapi stages, the JUnit test report, archived artifacts, deployment jobs with change sets', async () => {
    const s = await new MockServer().start();
    mockJenkins(s);
    const src = config({ sources: [{ type: 'jenkins', name: 'jk', baseUrl: s.url, user: 'qe-exporter', jobs: { 'payments/main': 'team-pay' }, deployJobs: { 'deploy-prod': 'team-pay' } }] }).sources[0] as JenkinsSource;
    const a = new JenkinsAdapter(src, http, { links: false }, { JENKINS_TOKEN: 'jenkins-api-token-1' });
    assert.match((await a.check())[0], /payments\/main: last completed build #12/);
    const r = await collectAll(a);
    assert.deepEqual(r.of('pipeline-runs').map((p) => [p.id, p.result, p.commit]), [['payments/main#10', 'cancelled', SHA.c1], ['payments/main#11', 'failed', SHA.c1], ['payments/main#12', 'success', SHA.c2]]);
    const st = r.of('pipeline-runs')[1].stages;
    assert.deepEqual(st.map((x: any) => [x.name, x.result]), [['Build', 'success'], ['Unit tests', 'failed'], ['Integration tests', 'success']]);
    assert.deepEqual(r.of('test-report').map((t) => [t.run, (t.files[0].content.match(/<testcase /g) ?? []).length, (t.files[0].content.match(/<failure\/>/g) ?? []).length]), [['payments/main#10', 2, 0], ['payments/main#11', 2, 1], ['payments/main#12', 2, 0]]);
    assert.equal(r.of('coverage').length, 3);
    assert.equal(r.of('sarif').length, 3);
    assert.equal(s.requests.filter((q) => q.path.endsWith('app.jar')).length, 0, 'other artifacts are not downloaded');
    assert.deepEqual(r.of('deployments').map((d) => [d.id, d.result, !!d.hotfix, (d.commits ?? []).map((c: any) => c.sha)]), [['deploy-prod#7', 'success', false, [SHA.d1]], ['deploy-prod#8', 'failure', true, []]]);
    const auth = 'Basic ' + Buffer.from('qe-exporter:jenkins-api-token-1').toString('base64');
    assert.ok(s.requests.every((q) => q.headers.authorization === auth && q.method === 'GET'));
    assert.ok(!JSON.stringify(r.records).includes('Frank') && !JSON.stringify(r.records).includes('SECRET-'));
    await s.stop();
  });

  test('without a user the config is refused before anything is read', () => {
    const src = config({ sources: [{ type: 'jenkins', baseUrl: 'https://jenkins.example.com', jobs: { a: 't' } }] }).sources[0] as JenkinsSource;
    assert.throws(() => new JenkinsAdapter(src, http, { links: false }, { JENKINS_TOKEN: 'x' }), /JENKINS_USER/);
    assert.throws(() => config({ sources: [{ type: 'jenkins', baseUrl: 'http://jenkins.example.com', jobs: { a: 't' } }] }), /https/);
  });
});

describe('Azure DevOps', () => {
  test('builds (continuation token), timeline jobs and tasks, test results, coverage summary, artifacts (same host only), environment deployments', async () => {
    const s = await new MockServer().start();
    mockAzure(s);
    const src = config({ sources: [{ type: 'azure-devops', name: 'ado', orgUrl: `${s.url}/acme`, project: 'Payments', pipelines: { 'payments-ci': 'team-pay' } }] }).sources[0] as AzureDevOpsSource;
    const a = new AzureDevOpsAdapter(src, http, { links: false }, { AZURE_DEVOPS_TOKEN: 'ado-pat-secret' });
    assert.deepEqual(await a.check(), ['pipeline payments-ci: definition 7', 'environments: Production, Staging']);
    const r = await collectAll(a);
    assert.ok(s.requests.some((q) => q.path.endsWith('/build/builds') && q.query.get('continuationToken') === 'page2'));
    assert.deepEqual(r.of('pipeline-runs').map((p) => [p.id, p.result]), [['301', 'failed'], ['302', 'success']]);
    assert.deepEqual(r.of('pipeline-runs')[0].stages.map((x: any) => [x.name, x.parallelGroup, x.result]), [['UnitTests 1', 'UnitTests', 'failed'], ['UnitTests 2', 'UnitTests', 'success']]);
    assert.deepEqual(r.of('test-report').map((t) => [t.run, (t.files[0].content.match(/<testcase /g) ?? []).length, (t.files[0].content.match(/<failure\/>/g) ?? []).length]), [['301', 3, 1], ['302', 3, 0]]);
    assert.deepEqual(r.of('coverage').map((c) => c.files[0].content.split('\n').filter((l: string) => /^(LF|LH|BRF):/.test(l))), [['LF:1000', 'LH:820', 'BRF:200'], ['LF:1000', 'LH:820', 'BRF:200']]);
    assert.equal(r.of('sarif').length, 2);
    assert.ok(r.skipped.some((x) => /coverage-pipeline/.test(x.id) && /another host/.test(x.reason)), 'a pipeline artifact on the artifacts host is not fetched with the PAT');
    assert.deepEqual(r.of('deployments').map((d) => [d.id, d.environment, d.commit, (d.commits ?? []).map((c: any) => c.sha)]), [['env-3-11', 'Production', SHA.d1, [SHA.d1]]]);
    assert.ok(r.skipped.some((x) => /unmapped-pipeline/.test(x.reason)));
    const auth = 'Basic ' + Buffer.from(':ado-pat-secret').toString('base64');
    assert.ok(s.requests.every((q) => q.headers.authorization === auth));
    assert.ok(!JSON.stringify(r.records).includes('grace@') && !JSON.stringify(r.records).includes('SECRET-'));
    await s.stop();
  });
});

describe('SonarQube', () => {
  test('open issues (paged) as one SARIF file with severities and lines of code; no messages or authors', async () => {
    const s = await new MockServer().start();
    mockSonar(s);
    const src = config({ sources: [{ type: 'sonarqube', name: 'sq', baseUrl: s.url, projects: { acme_payments: 'team-pay' } }] }).sources[0] as SonarQubeSource;
    const a = new SonarQubeAdapter(src, http, { SONAR_TOKEN: 'squ_secret' });
    assert.match((await a.check())[0], /quality gate ERROR/);
    const r = await collectAll(a);
    const item = r.of('sarif')[0];
    assert.deepEqual([item.repo, item.loc, item.files.length], ['acme_payments', 48000, 1]);
    const sarif = JSON.parse(item.files[0].content);
    const results = sarif.runs[0].results;
    assert.equal(sarif.runs[0].tool.driver.name, 'SonarQube');
    assert.equal(results.length, 502);
    const sev = (v: string) => results.filter((x: any) => x.properties.severity === v).length;
    assert.deepEqual([sev('blocker'), sev('high'), sev('medium'), sev('info')], [10, 1, 490, 1]);
    assert.equal(new Set(results.map((x: any) => x.partialFingerprints.primaryLocationLineHash)).size, 502);
    assert.ok(!JSON.stringify(item).includes('SECRET-SONAR') && !JSON.stringify(item).includes('heidi@'));
    assert.ok(s.requests.every((q) => q.headers.authorization === 'Bearer squ_secret'));
    await s.stop();
  });
});
