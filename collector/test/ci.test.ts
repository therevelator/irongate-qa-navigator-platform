/**
 * The CI and code-quality connectors against local stand-ins of each vendor API (test/ci-fixtures.ts): what they
 * read, pagination, rate limits, artifact downloads (redirects to another host without the credentials, expired
 * and oversized artifacts), and the records they produce for the engine.
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
import type { CiAdapter, CiRecord } from '../src/sources/ci/common';
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
  const of = <K extends CiRecord['kind']>(k: K) => records.filter((r): r is Extract<CiRecord, { kind: K }> => r.kind === k);
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
    const pipes = r.of('pipeline').map((p) => p.rec);
    assert.deepEqual(pipes.map((p) => [p.externalId, p.attempt, p.result]), [['101', 1, 'failed'], ['101', 2, 'success'], ['102', 1, 'success'], ['103', 1, 'cancelled']]);
    const p1 = pipes[1];
    assert.deepEqual(p1.stages!.map((s) => [s.name, s.kind, s.parallelGroup, s.durationS, s.result]), [
      ['build', 'build', null, 180, 'success'], ['test (1, 2)', 'test', 'test', 360, 'success'], ['test (2, 2)', 'test', 'test', 240, 'success'], ['deploy', 'deploy', null, 120, 'success'],
    ]);
    assert.equal(p1.steps!.find((s) => s.name === 'npm ci')!.durationS, 120);
    assert.equal(p1.url, null, 'links only with privacy.sendLinks');
    // Test runs: attempt 1 failed the checkout test, attempt 2 passed it (same commit).
    const tr = r.of('testRun').map((t) => t.rec);
    assert.deepEqual(tr.map((t) => [t.runId, t.attempt, t.passed, t.failed, t.skipped]), [['101', 1, 2, 1, 1], ['101', 2, 3, 0, 1], ['102', 1, 3, 0, 1]]);
    assert.ok(tr.every((t) => t.commit && t.cases!.length === 4));
    assert.ok(!JSON.stringify(tr).includes('SECRET-STACK') && !JSON.stringify(tr).includes('alice@'), 'failure messages are not kept');
    const cov = r.of('coverage').map((c) => c.rec);
    assert.equal(cov.length, 3);
    assert.deepEqual([cov[0].linesFound, cov[0].linesHit, cov[0].files!.map((f) => f.path)], [9, 6, ['src/checkout/pay.ts', 'src/cart/cart.ts']]);
    const sa = r.of('analysis').map((a) => a.rec);
    assert.deepEqual(sa.map((a) => [a.tool, a.repo, a.findings, a.high, a.low]), [['CodeQL', 'acme/payments', 2, 1, 1], ['CodeQL', 'acme/payments', 2, 1, 1], ['CodeQL', 'acme/payments', 2, 1, 1]]);
    assert.ok(!JSON.stringify(sa).includes('SECRET-QUERY'), 'finding messages are not kept');
    // Expired and oversized artifacts are reported, not downloaded; an unrelated artifact is not touched.
    assert.ok(r.skipped.some((s) => s.id.endsWith('/test-results-old') && /expired/.test(s.reason)));
    assert.ok(r.skipped.some((s) => s.id.endsWith('/coverage-huge') && /900 MB/.test(s.reason)));
    assert.equal(vendor.requests.filter((q) => /\/artifacts\/\d+(05|06)\/zip$/.test(q.path)).length, 0);
    // Deployments: production only, finished ones; the hotfix; the rollback (a commit an earlier deployment shipped); commits from compare.
    const deps = r.of('deployment').map((d) => d.rec);
    assert.deepEqual(deps.map((d) => [d.externalId, d.result, d.hotfix, d.rollbackOf, d.commitFrom]), [
      ['9001', 'success', false, null, null], ['9002', 'success', false, null, SHA.d0], ['9003', 'success', true, null, SHA.d1], ['9004', 'success', false, '9003', SHA.d2], ['9005', 'failure', false, null, SHA.d1],
    ]);
    assert.ok(r.skipped.some((s) => s.id === 'acme/payments deployment 9006' && /not finished/.test(s.reason)));
    const commits = r.of('commits');
    assert.deepEqual(commits.map((c) => [c.deployment, c.commits.length]), [['9001', 1], ['9002', 2], ['9003', 2], ['9004', 2]]);
    assert.ok(commits.every((c) => c.commits.every((x) => x.authoredAt !== null)));
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

  test('a zip bomb or a damaged archive in an artifact is refused, the rest of the run is kept', async () => {
    const { parseArtifacts } = await import('../src/sources/ci/common');
    const bomb = zip({ 'junit.xml': '<testsuite>' + ' '.repeat(5_000_000) + '</testsuite>' });
    const r = parseArtifacts([
      { artifact: 'bomb', name: 'b.zip', data: bomb, kinds: ['tests'] },
      { artifact: 'broken', name: 'x.zip', data: Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(40)]), kinds: ['tests'] },
      { artifact: 'xxe', name: 'evil.xml', data: Buffer.from('<?xml version="1.0"?><!DOCTYPE t [<!ENTITY x SYSTEM "file:///etc/passwd">]><testsuite><testcase name="&x;"/></testsuite>'), kinds: ['tests'] },
      { artifact: 'ok', name: 'lcov.info', data: Buffer.from('SF:a.ts\nLF:2\nLH:1\nend_of_record\n'), kinds: ['coverage'] },
    ]);
    assert.ok(r.skipped.some((s) => s.id === 'bomb' && /expands|zip bomb/.test(s.reason)), JSON.stringify(r.skipped));
    assert.ok(r.skipped.some((s) => s.id === 'broken'));
    assert.ok(r.skipped.some((s) => s.id.startsWith('xxe')), 'external entities refused');
    assert.equal(r.tests, null);
    assert.equal(r.coverage?.totals.linesFound, 2);
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
    const pipes = r.of('pipeline').map((p) => p.rec);
    assert.deepEqual(pipes.map((p) => [p.externalId, p.result]), [['501', 'failed'], ['502', 'success']], 'the running pipeline is not read');
    assert.deepEqual(pipes[1].stages!.filter((x) => x.parallelGroup).map((x) => x.name), ['rspec 1/2', 'rspec 2/2']);
    assert.equal(pipes[1].url, 'https://gitlab.com/acme/web/-/pipelines/502', 'links with privacy.sendLinks');
    const tr = r.of('testRun').map((t) => t.rec);
    assert.deepEqual(tr.map((t) => [t.runId, t.passed, t.failed, t.skipped, t.durationMs]), [['501', 1, 1, 1, 9500], ['502', 2, 0, 1, 9500]]);
    assert.ok(!JSON.stringify(tr).includes('SECRET-OUT'));
    assert.deepEqual(r.of('coverage').map((c) => [c.rec.runId, c.rec.linesFound, c.rec.linesHit]), [['501', 4, 3], ['502', 4, 3]]);
    assert.ok(r.skipped.some((x) => /sast-report/.test(x.id) && /expired/.test(x.reason)));
    assert.deepEqual(r.of('deployment').map((d) => [d.rec.externalId, d.rec.result, d.rec.commitFrom]), [['701', 'success', null], ['702', 'success', SHA.d0], ['703', 'failure', SHA.d1]]);
    assert.deepEqual(r.of('commits').map((c) => [c.deployment, c.commits[0].sha]), [['702', SHA.d1]]);
    assert.ok(s.requests.every((q) => q.headers['private-token'] === 'glpat-secret-value'));
    assert.ok(store.server.requests.filter((q) => q.path.startsWith('/blob/gl-')).every((q) => !q.headers['private-token']));
    await s.stop();
  });
});

describe('Jenkins', () => {
  test('builds (finished only), wfapi stages, the JUnit test report, archived artifacts, deployment jobs with change sets', async () => {
    const s = await new MockServer().start();
    mockJenkins(s);
    const src = config({ sources: [{ type: 'jenkins', name: 'jk', baseUrl: s.url, user: 'qe-collector', jobs: { 'payments/main': 'team-pay' }, deployJobs: { 'deploy-prod': 'team-pay' } }] }).sources[0] as JenkinsSource;
    const a = new JenkinsAdapter(src, http, { links: false }, { JENKINS_TOKEN: 'jenkins-api-token-1' });
    assert.match((await a.check())[0], /payments\/main: last completed build #12/);
    const r = await collectAll(a);
    assert.deepEqual(r.of('pipeline').map((p) => [p.rec.externalId, p.rec.result, p.rec.commit]), [['payments/main#10', 'cancelled', SHA.c1], ['payments/main#11', 'failed', SHA.c1], ['payments/main#12', 'success', SHA.c2]]);
    const st = r.of('pipeline')[1].rec.stages!;
    assert.deepEqual(st.map((x) => [x.name, x.kind, x.result]), [['Build', 'build', 'success'], ['Unit tests', 'test', 'failed'], ['Integration tests', 'test', 'success']]);
    assert.deepEqual(r.of('testRun').map((t) => [t.rec.runId, t.rec.passed, t.rec.failed]), [['payments/main#10', 2, 0], ['payments/main#11', 1, 1], ['payments/main#12', 2, 0]]);
    assert.equal(r.of('coverage').length, 3);
    assert.equal(r.of('analysis')[0].rec.tool, 'CodeQL');
    assert.equal(s.requests.filter((q) => q.path.endsWith('app.jar')).length, 0, 'other artifacts are not downloaded');
    assert.deepEqual(r.of('deployment').map((d) => [d.rec.externalId, d.rec.result, d.rec.hotfix]), [['deploy-prod#7', 'success', false], ['deploy-prod#8', 'failure', true]]);
    assert.deepEqual(r.of('commits').map((c) => c.commits.map((x) => x.sha)), [[SHA.d1]]);
    const auth = 'Basic ' + Buffer.from('qe-collector:jenkins-api-token-1').toString('base64');
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
    assert.deepEqual(r.of('pipeline').map((p) => [p.rec.externalId, p.rec.result]), [['301', 'failed'], ['302', 'success']]);
    assert.deepEqual(r.of('pipeline')[0].rec.stages!.map((x) => [x.name, x.parallelGroup, x.result]), [['UnitTests 1', 'UnitTests', 'failed'], ['UnitTests 2', 'UnitTests', 'success']]);
    assert.equal(r.of('pipeline')[0].rec.steps![0].name, 'dotnet test');
    assert.deepEqual(r.of('testRun').map((t) => [t.rec.runId, t.rec.passed, t.rec.failed, t.rec.skipped]), [['301', 1, 1, 1], ['302', 2, 0, 1]]);
    assert.deepEqual(r.of('coverage').map((c) => [c.rec.linesFound, c.rec.linesHit, c.rec.branchesFound]), [[1000, 820, 200], [1000, 820, 200]]);
    assert.equal(r.of('analysis').length, 2);
    assert.ok(r.skipped.some((x) => /coverage-pipeline/.test(x.id) && /another host/.test(x.reason)), 'a pipeline artifact on the artifacts host is not fetched with the PAT');
    assert.deepEqual(r.of('deployment').map((d) => [d.rec.externalId, d.rec.environment, d.rec.commit]), [['env-3-11', 'Production', SHA.d1]]);
    assert.ok(r.skipped.some((x) => /unmapped-pipeline/.test(x.reason)));
    assert.deepEqual(r.of('commits').map((c) => c.commits[0].sha), [SHA.d1]);
    const auth = 'Basic ' + Buffer.from(':ado-pat-secret').toString('base64');
    assert.ok(s.requests.every((q) => q.headers.authorization === auth));
    assert.ok(!JSON.stringify(r.records).includes('grace@') && !JSON.stringify(r.records).includes('SECRET-'));
    await s.stop();
  });
});

describe('SonarQube', () => {
  test('open issues (paged) as findings with severities, lines of code, quality gate; no messages or authors', async () => {
    const s = await new MockServer().start();
    mockSonar(s);
    const src = config({ sources: [{ type: 'sonarqube', name: 'sq', baseUrl: s.url, projects: { acme_payments: 'team-pay' } }] }).sources[0] as SonarQubeSource;
    const a = new SonarQubeAdapter(src, http, { SONAR_TOKEN: 'squ_secret' });
    assert.match((await a.check())[0], /quality gate ERROR/);
    const r = await collectAll(a);
    const rec = r.of('analysis')[0].rec;
    assert.deepEqual([rec.tool, rec.findings, rec.critical, rec.high, rec.medium, rec.info, rec.linesOfCode, rec.qualityGate], ['SonarQube', 502, 10, 1, 490, 1, 48000, 'ERROR']);
    assert.equal(new Set(rec.fingerprints).size, 502);
    assert.ok(!JSON.stringify(rec).includes('SECRET-SONAR') && !JSON.stringify(rec).includes('heidi@'));
    assert.ok(s.requests.every((q) => q.headers.authorization === 'Bearer squ_secret'));
    await s.stop();
  });
});
