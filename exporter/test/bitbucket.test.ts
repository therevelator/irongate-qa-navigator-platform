/**
 * Bitbucket Cloud and Bitbucket Data Center against local stand-ins built from Atlassian's documented responses
 * (Bitbucket Cloud REST API 2.0: paginated { pagelen, size, page, next, values }; Pipelines, steps, test reports,
 * environments, deployments, commits. Bitbucket Data Center REST 1.0: { size, limit, start, isLastPage,
 * nextPageStart, values }; commits, builds, deployments): pagination, rate limits (429 with Retry-After), auth
 * failures, and the items they produce.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { configureLog } from '../src/log';
import { MockServer, config } from './helpers';
import { BitbucketAdapter, durationMs } from '../src/sources/ci/bitbucket';
import { BitbucketDcAdapter } from '../src/sources/ci/bitbucketDc';
import { SourceError } from '../src/sources/client';
import type { CiAdapter, CiKind, CiRecord } from '../src/sources/ci/common';
import type { BitbucketSource, BitbucketDcSource } from '../src/config';

configureLog({ sink: () => {} });
const http = { timeoutSeconds: 10, maxRetries: 2, maxRetryWaitSeconds: 1, caFile: null };
const DAY = 86_400_000;
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
/** Bitbucket ids are {uuid}s: they appear URL-encoded in paths. */
const enc = encodeURIComponent;
const SHA = { a: 'a'.repeat(40), b: 'b'.repeat(40), c: 'c'.repeat(40), d: 'd'.repeat(40) };

async function collectAll(a: CiAdapter) {
  const records: CiRecord[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for await (const p of a.collect(new Date(Date.now() - 30 * DAY), new Date())) { records.push(...p.records); skipped.push(...p.skipped); }
  const of = (k: CiKind) => records.filter((r) => r.kind === k).map((r) => r.item as any);
  return { records, skipped, of };
}

/** Bitbucket Cloud: two pages of pipelines (the "next" link), steps, a step test report, environments, deployments, commits. */
function mockCloud(s: MockServer, opts: { rateLimitOnce?: boolean } = {}) {
  const repo = '/repositories/acme/payments';
  let limited = !opts.rateLimitOnce;
  const pipeline = (n: number, result: string, hoursAgo: number, sha: string) => ({
    type: 'pipeline', uuid: `{p-${n}}`, build_number: n, created_on: ago(hoursAgo), completed_on: ago(hoursAgo - 0.2), duration_in_seconds: 720,
    state: { name: 'COMPLETED', type: 'pipeline_state_completed', result: { name: result, type: 'pipeline_state_completed_result' } },
    target: { type: 'pipeline_ref_target', ref_type: 'branch', ref_name: 'main', commit: { type: 'commit', hash: sha }, selector: { type: 'default' } },
    creator: { display_name: 'Alice Smith', uuid: '{u-1}' }, links: { html: { href: `https://bitbucket.org/acme/payments/pipelines/results/${n}` } },
  });
  s.on('GET', repo, () => ({ body: { type: 'repository', full_name: 'acme/payments', is_private: true } }));
  s.on('GET', `${repo}/pipelines/`, (r) => {
    if (!limited) { limited = true; return { status: 429, headers: { 'retry-after': '0' }, body: { type: 'error', error: { message: 'Rate limit for this resource has been exceeded' } } }; }
    if (r.query.get('pagelen') === '1') return { body: { pagelen: 1, size: 3, page: 1, values: [pipeline(12, 'SUCCESSFUL', 2, SHA.c)] } };
    if (r.query.get('page') === '2') return { body: { pagelen: 100, size: 4, page: 2, values: [pipeline(10, 'FAILED', 30, SHA.a), { ...pipeline(9, 'SUCCESSFUL', 24 * 40, SHA.a) }] } };
    return { body: { pagelen: 100, size: 4, page: 1, next: `${s.url}${repo}/pipelines/?page=2&pagelen=100&sort=-created_on`, values: [pipeline(12, 'SUCCESSFUL', 2, SHA.c), { ...pipeline(11, 'SUCCESSFUL', 10, SHA.b), state: { name: 'IN_PROGRESS' } }] } };
  });
  for (const n of [10, 12]) {
    s.on('GET', `${repo}/pipelines/${enc(`{p-${n}}`)}/steps/`, () => ({ body: { pagelen: 100, values: [
      { uuid: `{s-${n}-1}`, name: 'Build', started_on: ago(3), completed_on: ago(2.95), duration_in_seconds: 180, state: { name: 'COMPLETED', result: { name: 'SUCCESSFUL' } }, script_commands: [{ command: 'echo SECRET-SCRIPT' }] },
      { uuid: `{s-${n}-2}`, name: 'Unit tests', started_on: ago(2.95), completed_on: ago(2.8), duration_in_seconds: 540, state: { name: 'COMPLETED', result: { name: n === 10 ? 'FAILED' : 'SUCCESSFUL' } } },
    ] } }));
    s.on('GET', `${repo}/pipelines/${enc(`{p-${n}}`)}/steps/${enc(`{s-${n}-1}`)}/test_reports/test_cases`, () => ({ status: 404, body: { type: 'error', error: { message: 'Not found' } } }));
    s.on('GET', `${repo}/pipelines/${enc(`{p-${n}}`)}/steps/${enc(`{s-${n}-2}`)}/test_reports/test_cases`, (r) => r.query.get('page') === '2'
      ? { body: { pagelen: 1, page: 2, values: [{ name: 'refunds partially', fully_qualified_name: 'com.acme.RefundTest.refunds partially', status: 'SKIPPED', duration: 'PT0S' }] } }
      : { body: { pagelen: 2, page: 1, next: `${s.url}${repo}/pipelines/${enc(`{p-${n}}`)}/steps/${enc(`{s-${n}-2}`)}/test_reports/test_cases?page=2`, values: [
        { name: 'pays with card', fully_qualified_name: 'com.acme.PayTest.pays with card', status: n === 10 ? 'FAILED' : 'PASSED', duration: 'PT1.5S', test_case_reasons: [{ message: 'SECRET-REASON alice@example.com' }] },
        { name: 'declines', fully_qualified_name: 'com.acme.PayTest.declines', status: 'PASSED', duration: 'PT0.25S' },
      ] } });
  }
  s.on('GET', `${repo}/environments/`, () => ({ body: { pagelen: 100, values: [
    { uuid: '{e-prod}', name: 'Production', environment_type: { name: 'Production', rank: 2 } },
    { uuid: '{e-stg}', name: 'Staging', environment_type: { name: 'Staging', rank: 1 } },
  ] } }));
  const dep = (id: string, env: string, status: string, hoursAgo: number, sha: string, name = 'release') => ({
    type: 'deployment', uuid: `{${id}}`, environment: { uuid: env }, state: { name: 'COMPLETED', status: { name: status }, started_on: ago(hoursAgo + 0.1), completed_on: ago(hoursAgo) },
    release: { name, commit: { hash: sha } }, deployable: { commit: { hash: sha } },
  });
  s.on('GET', `${repo}/deployments/`, () => ({ body: { pagelen: 100, values: [
    dep('d-4', '{e-prod}', 'FAILED', 1, SHA.d), dep('d-3', '{e-prod}', 'SUCCESSFUL', 5, SHA.c, 'hotfix-1.2.1'), dep('d-stg', '{e-stg}', 'SUCCESSFUL', 6, SHA.c), dep('d-2', '{e-prod}', 'SUCCESSFUL', 20, SHA.b), dep('d-1', '{e-prod}', 'SUCCESSFUL', 50, SHA.a),
  ] } }));
  s.on('GET', new RegExp(`^${repo}/commits/[a-f]{40}$`), (r) => {
    const to = r.path.split('/').pop()!;
    const list = to === SHA.a ? [SHA.a] : to === SHA.b ? [SHA.b] : [SHA.c, 'e'.repeat(40)];
    return { body: { pagelen: 100, values: list.map((h, i) => ({ type: 'commit', hash: h, date: ago(60 - i), message: 'Fix SECRET-MSG', author: { raw: 'Alice <alice@example.com>' } })) } };
  });
}

describe('Bitbucket Cloud', () => {
  test('pipelines (next links, after a 429), steps with timings, test reports (paged) as a JUnit file, deployments with commits', async () => {
    const s = await new MockServer().start();
    mockCloud(s, { rateLimitOnce: true });
    const src = config({ sources: [{ type: 'bitbucket', name: 'bb', apiUrl: s.url, username: 'qe-exporter', repos: { 'acme/payments': 'team-pay' } }] }).sources[0] as BitbucketSource;
    const a = new BitbucketAdapter(src, http, { links: false }, { BITBUCKET_APP_PASSWORD: 'app-password-secret-1' });
    assert.match((await a.check())[0], /acme\/payments: private, 3 pipelines; environments: Production, Staging/);
    const r = await collectAll(a);
    assert.ok(s.requests.some((q) => q.path.endsWith('/pipelines/') && q.query.get('page') === '2'), 'the next page was read');
    assert.equal(s.requests.filter((q) => q.path.endsWith('/pipelines/')).length, 4, 'the 429 (on the first request) was retried; then two pages');
    const runs = r.of('pipeline-runs');
    assert.deepEqual(runs.map((p) => [p.id, p.attempt, p.result, p.commit, p.branch]), [['12', 1, 'success', SHA.c, 'main'], ['10', 1, 'failed', SHA.a, 'main']], 'in progress and older than the window are not read');
    assert.deepEqual(runs[1].stages.map((x: any) => [x.name, x.durationSeconds, x.result]), [['Build', 180, 'success'], ['Unit tests', 540, 'failed']]);
    assert.equal(runs[0].durationSeconds, 720);
    const tr = r.of('test-report');
    assert.deepEqual(tr.map((t) => [t.run, t.format, (t.files[0].content.match(/<testcase /g) ?? []).length, (t.files[0].content.match(/<failure\/>/g) ?? []).length]), [['12', 'junit', 3, 0], ['10', 'junit', 3, 1]]);
    assert.match(tr[0].files[0].content, /<testsuite name="com.acme.PayTest" tests="2">/);
    assert.match(tr[0].files[0].content, /name="pays with card" time="1.500"/);
    const deps = r.of('deployments');
    assert.deepEqual(deps.map((d) => [d.id, d.environment, d.result, !!d.hotfix, d.rollbackOf ?? null, d.previousCommit ?? null, (d.commits ?? []).length]), [
      ['d-1', 'Production', 'success', false, null, null, 1], ['d-2', 'Production', 'success', false, null, SHA.a, 1], ['d-3', 'Production', 'success', true, null, SHA.b, 2], ['d-4', 'Production', 'failure', false, null, SHA.c, 0],
    ], 'production only (Staging is left out)');
    const text = JSON.stringify(r.records);
    for (const bad of ['SECRET', 'alice', 'Alice']) assert.ok(!text.includes(bad), bad);
    const auth = 'Basic ' + Buffer.from('qe-exporter:app-password-secret-1').toString('base64');
    assert.ok(s.requests.every((q) => q.headers.authorization === auth && q.method === 'GET'));
    await s.stop();
  });

  test('an OAuth token is sent as Bearer; a 401 is an auth error with the read-only hint; no username: refused before reading', async () => {
    const s = await new MockServer().start();
    s.on('GET', '/repositories/acme/payments', (r) => (r.headers.authorization === 'Bearer oauth-access-token-1' ? { body: { is_private: false } } : { status: 401, body: { type: 'error', error: { message: 'Access token expired.' } } }));
    s.on('GET', '/repositories/acme/payments/pipelines/', () => ({ body: { size: 0, values: [] } }));
    s.on('GET', '/repositories/acme/payments/environments/', () => ({ body: { values: [] } }));
    const oauth = config({ sources: [{ type: 'bitbucket', name: 'bb', apiUrl: s.url, auth: 'oauth', repos: { 'acme/payments': 'team-pay' } }] }).sources[0] as BitbucketSource;
    assert.match((await new BitbucketAdapter(oauth, http, { links: false }, { BITBUCKET_APP_PASSWORD: 'oauth-access-token-1' }).check())[0], /public, 0 pipelines/);
    const bad = new BitbucketAdapter(oauth, http, { links: false }, { BITBUCKET_APP_PASSWORD: 'expired' });
    await assert.rejects(bad.check(), (e: SourceError) => e.auth && e.status === 401 && /Repositories: Read/.test(e.message));
    const noUser = config({ sources: [{ type: 'bitbucket', name: 'bb', apiUrl: s.url, repos: { 'acme/payments': 'team-pay' } }] }).sources[0] as BitbucketSource;
    assert.throws(() => new BitbucketAdapter(noUser, http, { links: false }, { BITBUCKET_APP_PASSWORD: 'x' }), /BITBUCKET_USERNAME/);
    assert.throws(() => config({ sources: [{ type: 'bitbucket', repos: { 'not-a-repo': 't' } }] }), /workspace\/repo/);
    assert.equal(s.requests.filter((q) => q.headers.authorization === 'Bearer expired').length, 1, 'an auth failure is not retried');
    await s.stop();
  });

  test('a "next" link to another host is refused (the credentials stay with Bitbucket)', async () => {
    const s = await new MockServer().start();
    s.on('GET', '/repositories/acme/payments/pipelines/', () => ({ body: { values: [{ uuid: '{p}', created_on: ago(1), state: { name: 'IN_PROGRESS' } }], next: 'https://evil.example.com/steal?page=2' } }));
    const src = config({ sources: [{ type: 'bitbucket', name: 'bb', apiUrl: s.url, username: 'u', repos: { 'acme/payments': 'team-pay' } }] }).sources[0] as BitbucketSource;
    await assert.rejects(collectAll(new BitbucketAdapter(src, http, { links: false }, { BITBUCKET_APP_PASSWORD: 'p' })), /refusing to follow a link to another host/);
    await s.stop();
  });

  test('ISO 8601 durations of the test report API', () => {
    assert.equal(durationMs('PT1.5S'), 1500);
    assert.equal(durationMs('PT2M3S'), 123_000);
    assert.equal(durationMs('P1DT1H'), 90_000_000);
    assert.equal(durationMs(2.5), 2500);
    assert.equal(durationMs('nonsense'), 0);
  });
});

describe('Bitbucket Data Center', () => {
  test('commits (isLastPage / nextPageStart), the builds reported on them as pipeline runs, production deployments with the commits shipped', async () => {
    const s = await new MockServer().start();
    const repo = '/rest/api/1.0/projects/PAY/repos/payments';
    const commit = (id: string, h: number) => ({ id, displayId: id.slice(0, 11), author: { name: 'alice', emailAddress: 'alice@example.com' }, authorTimestamp: Date.now() - h * 3600_000, committerTimestamp: Date.now() - h * 3600_000 + 60_000, message: 'SECRET-MSG' });
    s.on('GET', repo, () => ({ body: { slug: 'payments', name: 'payments', public: false } }));
    s.on('GET', `${repo}/commits`, (r) => {
      if (r.query.get('limit') === '1') return { body: { size: 1, limit: 1, isLastPage: false, start: 0, nextPageStart: 1, values: [commit(SHA.d, 1)] } };
      return r.query.get('start') === '2'
        ? { body: { size: 2, limit: 100, isLastPage: true, start: 2, values: [commit(SHA.b, 30), commit(SHA.a, 60)] } }
        : { body: { size: 2, limit: 100, isLastPage: false, start: 0, nextPageStart: 2, values: [commit(SHA.d, 1), commit(SHA.c, 10)] } };
    });
    s.on('GET', new RegExp(`^${repo}/commits/[a-f]{40}/builds$`), (r) => {
      const sha = r.path.split('/').at(-2)!;
      return { body: { size: 1, limit: 100, isLastPage: true, start: 0, values: sha === SHA.b ? [] : [{ key: 'PAY-CI', name: 'Payments CI', state: sha === SHA.c ? 'FAILED' : 'SUCCESSFUL', url: 'https://bamboo.example.com/PAY-CI-7', createdDate: Date.now() - 3 * 3600_000, updatedDate: Date.now() - 2.9 * 3600_000, duration: 360_000, ref: 'refs/heads/main', testResults: { successful: 10, failed: 1, skipped: 0 } }] } };
    });
    s.on('GET', new RegExp(`^${repo}/commits/[a-f]{40}/deployments$`), (r) => {
      const sha = r.path.split('/').at(-2)!;
      const d = (seq: number, state: string, envType: string, h: number) => ({ key: 'payments-deploy', displayName: 'Deploy', deploymentSequenceNumber: seq, environment: { key: envType.toLowerCase(), displayName: envType === 'PRODUCTION' ? 'Production' : 'Staging', type: envType }, state, lastUpdated: Date.now() - h * 3600_000 });
      const values = sha === SHA.a ? [d(1, 'SUCCESSFUL', 'PRODUCTION', 59)] : sha === SHA.c ? [d(2, 'SUCCESSFUL', 'PRODUCTION', 9), d(3, 'SUCCESSFUL', 'STAGING', 9.5)] : sha === SHA.d ? [d(4, 'FAILED', 'PRODUCTION', 0.5)] : [];
      return { body: { size: values.length, limit: 100, isLastPage: true, start: 0, values } };
    });
    const src = config({ sources: [{ type: 'bitbucket-dc', name: 'bbdc', baseUrl: s.url, repos: { 'PAY/payments': 'team-pay' } }] }).sources[0] as BitbucketDcSource;
    const a = new BitbucketDcAdapter(src, http, { links: false }, { BITBUCKET_TOKEN: 'dc-http-token-secret' });
    assert.match((await a.check())[0], /PAY\/payments: private repository payments; latest commit dddddddddddd/);
    const r = await collectAll(a);
    assert.ok(s.requests.some((q) => q.path === `${repo}/commits` && q.query.get('start') === '2'), 'the second page was read');
    assert.deepEqual(r.of('pipeline-runs').map((p) => [p.id, p.result, p.commit, p.branch, p.durationSeconds]), [
      [`PAY-CI@${SHA.a.slice(0, 12)}`, 'success', SHA.a, 'main', 360], [`PAY-CI@${SHA.c.slice(0, 12)}`, 'failed', SHA.c, 'main', 360], [`PAY-CI@${SHA.d.slice(0, 12)}`, 'success', SHA.d, 'main', 360],
    ]);
    assert.deepEqual(r.of('deployments').map((d) => [d.id, d.result, d.previousCommit ?? null, (d.commits ?? []).map((c: any) => c.sha)]), [
      ['payments-deploy#1', 'success', null, [SHA.a]], ['payments-deploy#2', 'success', SHA.a, [SHA.b, SHA.c]], ['payments-deploy#4', 'failure', SHA.c, []],
    ], 'production only; the commits since the previous successful deployment');
    assert.equal(r.of('test-report').length, 0, 'Data Center keeps counts only: no report is invented');
    assert.ok(!JSON.stringify(r.records).includes('SECRET') && !JSON.stringify(r.records).includes('alice'));
    assert.ok(s.requests.every((q) => q.headers.authorization === 'Bearer dc-http-token-secret'));
    await s.stop();
  });

  test('a 401 / 403 is an auth error; http:// only with allowHttp', async () => {
    const s = await new MockServer().start();
    s.on('GET', '/rest/api/1.0/projects/PAY/repos/payments', () => ({ status: 401, body: { errors: [{ message: 'Authentication failed. Please check your credentials and try again.' }] } }));
    const src = config({ sources: [{ type: 'bitbucket-dc', name: 'bbdc', baseUrl: s.url, repos: { 'PAY/payments': 'team-pay' } }] }).sources[0] as BitbucketDcSource;
    await assert.rejects(new BitbucketDcAdapter(src, http, { links: false }, { BITBUCKET_TOKEN: 'bad' }).check(), (e: SourceError) => e.auth && /HTTP access token/.test(e.message));
    assert.throws(() => config({ sources: [{ type: 'bitbucket-dc', baseUrl: 'http://bitbucket.corp.example', repos: { 'PAY/payments': 't' } }] }), /https/);
    assert.doesNotThrow(() => config({ sources: [{ type: 'bitbucket-dc', baseUrl: 'http://bitbucket.corp.example', allowHttp: true, repos: { 'PAY/payments': 't' } }] }));
    await s.stop();
  });
});
