/**
 * Rollbacks recognised from the deployment records themselves (Jenkins deployment jobs, Azure DevOps environment
 * deployments), sharded Jenkins stages as one parallel group, and SonarQube's coverage totals sent as a coverage
 * report (coverage: true), against local stand-ins of each vendor API.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { configureLog } from '../src/log';
import { MockServer, config } from './helpers';
import { mockSonar } from './ci-fixtures';
import { JenkinsAdapter } from '../src/sources/ci/jenkins';
import { AzureDevOpsAdapter } from '../src/sources/ci/azure';
import { SonarQubeAdapter } from '../src/sources/ci/sonarqube';
import { rollbackTracker } from '../src/sources/ci/common';
import type { CiAdapter, CiRecord, CiKind } from '../src/sources/ci/common';
import type { JenkinsSource, AzureDevOpsSource, SonarQubeSource } from '../src/config';

configureLog({ sink: () => {} });
const http = { timeoutSeconds: 10, maxRetries: 2, maxRetryWaitSeconds: 1, caFile: null };
const DAY = 86_400_000;
const ago = (days: number) => Date.now() - days * DAY;
const sha = (c: string) => c.repeat(40);

async function collect(a: CiAdapter, sinceDays: number) {
  const records: CiRecord[] = [];
  for await (const p of a.collect(new Date(ago(sinceDays)), new Date())) records.push(...p.records);
  return (k: CiKind) => records.filter((r) => r.kind === k).map((r) => r.item as any);
}

describe('rollbackTracker', () => {
  test('a redeploy of an earlier shipped version rolls the previous deployment back; a repeat, a failure or a new version does not', () => {
    const t = rollbackTracker();
    assert.equal(t('svc', '1', 'a', true), null);
    assert.equal(t('svc', '2', 'b', true), null);
    assert.equal(t('svc', '3', 'b', true), null, 'the same version again is a redeploy, not a rollback');
    assert.equal(t('svc', '4', 'a', false), null, 'a deployment that failed rolls nothing back');
    assert.equal(t('svc', '5', 'a', true), '3');
    assert.equal(t('svc', '6', 'c', true), null);
    assert.equal(t('other', '7', 'a', true), null, 'each service and environment on its own');
    assert.equal(t('svc', '8', '', true), null, 'no version, no conclusion');
  });
});

describe('Jenkins', () => {
  test('a deployment build of an earlier deployed commit is the rollback of the previous one, also when that one is before the window', async () => {
    const s = await new MockServer().start();
    const b = (n: number, result: string, daysAgo: number, commit: string) => ({
      number: n, result, building: false, timestamp: ago(daysAgo), duration: 60_000,
      actions: [{ lastBuiltRevision: { SHA1: commit, branch: [{ name: 'origin/main' }] } }], changeSets: [],
    });
    s.on('GET', '/job/deploy-prod/api/json', () => ({ body: { builds: [
      b(4, 'SUCCESS', 1, sha('a')), b(3, 'FAILURE', 2, sha('c')), b(2, 'SUCCESS', 9, sha('b')), b(1, 'SUCCESS', 12, sha('a')),
    ] } }));
    s.on('GET', '/job/app/api/json', () => ({ body: { builds: [] } }));
    const src = config({ sources: [{ type: 'jenkins', name: 'jk', baseUrl: s.url, user: 'qe-exporter', jobs: { app: 'team-pay' }, deployJobs: { 'deploy-prod': 'team-pay' } }] }).sources[0] as JenkinsSource;
    const of = await collect(new JenkinsAdapter(src, http, { links: false }, { JENKINS_TOKEN: 't' }), 5);
    // Builds 1 and 2 are before the 5-day window: not sent again, but read to see what build 4 rolls back.
    assert.deepEqual(of('deployments').map((d) => [d.id, d.result, d.rollbackOf ?? null]), [['deploy-prod#3', 'failure', null], ['deploy-prod#4', 'success', 'deploy-prod#2']]);
    await s.stop();
  });

  test('sharded stages are one parallel group', async () => {
    const s = await new MockServer().start();
    const t0 = ago(1);
    s.on('GET', '/job/app/api/json', () => ({ body: { builds: [{ number: 1, result: 'SUCCESS', building: false, timestamp: t0, duration: 600_000, actions: [{ lastBuiltRevision: { SHA1: sha('a'), branch: [{ name: 'origin/main' }] } }], artifacts: [], changeSets: [] }] } }));
    s.on('GET', '/job/app/1/wfapi/describe', () => ({ body: { stages: [
      { name: 'Build', status: 'SUCCESS', startTimeMillis: t0, durationMillis: 60_000 },
      { name: 'e2e 1/2', status: 'SUCCESS', startTimeMillis: t0 + 60_000, durationMillis: 240_000 },
      { name: 'e2e 2/2', status: 'SUCCESS', startTimeMillis: t0 + 60_000, durationMillis: 180_000 },
    ] } }));
    const src = config({ sources: [{ type: 'jenkins', name: 'jk', baseUrl: s.url, user: 'qe-exporter', jobs: { app: 'team-pay' } }] }).sources[0] as JenkinsSource;
    const of = await collect(new JenkinsAdapter(src, http, { links: false }, { JENKINS_TOKEN: 't' }), 5);
    assert.deepEqual(of('pipeline-runs')[0].stages.map((x: any) => [x.name, x.parallelGroup ?? null]), [['Build', null], ['e2e 1/2', 'e2e'], ['e2e 2/2', 'e2e']]);
    await s.stop();
  });
});

describe('Azure DevOps', () => {
  test('an environment deployment of an earlier deployed build is the rollback of the previous one', async () => {
    const s = await new MockServer().start();
    const p = '/acme/Payments/_apis';
    const iso = (d: number) => new Date(ago(d)).toISOString();
    s.on('GET', `${p}/build/definitions`, () => ({ body: { count: 1, value: [{ id: 7, name: 'payments-ci' }] } }));
    s.on('GET', `${p}/build/builds`, () => ({ body: { count: 0, value: [] } }));
    s.on('GET', `${p}/distributedtask/environments`, () => ({ body: { count: 1, value: [{ id: 3, name: 'Production' }] } }));
    const rec = (id: number, build: number, daysAgo: number, result = 'succeeded') => ({ id, environmentId: 3, definition: { id: 7, name: 'payments-ci' }, owner: { id: build }, result, startTime: iso(daysAgo), finishTime: iso(daysAgo) });
    // Newest first, as the API lists them. Record 21 (build 500) is before the 5-day window.
    s.on('GET', `${p}/distributedtask/environments/3/environmentdeploymentrecords`, () => ({ body: { count: 3, value: [rec(23, 500, 1), rec(22, 501, 3), rec(21, 500, 20)] } }));
    s.on('GET', new RegExp(`^${p}/build/builds/(\\d+)$`), (r) => ({ body: { id: Number(r.path.split('/').pop()), sourceVersion: sha('d'), sourceBranch: 'refs/heads/main' } }));
    s.on('GET', new RegExp(`^${p}/build/builds/(\\d+)/changes$`), () => ({ body: { count: 0, value: [] } }));
    const src = config({ sources: [{ type: 'azure-devops', name: 'ado', orgUrl: `${s.url}/acme`, project: 'Payments', pipelines: { 'payments-ci': 'team-pay' } }] }).sources[0] as AzureDevOpsSource;
    const of = await collect(new AzureDevOpsAdapter(src, http, { links: false }, { AZURE_DEVOPS_TOKEN: 'pat' }), 5);
    assert.deepEqual(of('deployments').map((d) => [d.id, d.rollbackOf ?? null]), [['env-3-22', null], ['env-3-23', 'env-3-22']]);
    await s.stop();
  });
});

describe('SonarQube coverage', () => {
  test('coverage: true sends the totals of the latest analysis as a coverage report; without it, none', async () => {
    const s = await new MockServer().start();
    mockSonar(s);
    s.on('GET', '/api/measures/component', (r) => {
      assert.match(String(r.query.get('metricKeys')), /^ncloc(,lines_to_cover,uncovered_lines,conditions_to_cover,uncovered_conditions)?$/);
      return { body: { component: { key: 'acme_payments', measures: [
        { metric: 'ncloc', value: '48000' }, { metric: 'lines_to_cover', value: '20000' }, { metric: 'uncovered_lines', value: '4400' },
        { metric: 'conditions_to_cover', value: '3000' }, { metric: 'uncovered_conditions', value: '900' },
      ] } } };
    });
    const make = (coverage: boolean) => new SonarQubeAdapter(
      config({ sources: [{ type: 'sonarqube', name: 'sq', baseUrl: s.url, projects: { acme_payments: 'team-pay' }, ...(coverage ? { coverage: true } : {}) }] }).sources[0] as SonarQubeSource, http, { SONAR_TOKEN: 'squ_secret' });
    const on = await collect(make(true), 30);
    assert.equal(on('sarif').length, 1);
    const cov = on('coverage');
    assert.equal(cov.length, 1);
    assert.deepEqual([cov[0].repo, cov[0].loc, cov[0].format], ['acme_payments', 48000, 'lcov']);
    assert.deepEqual(cov[0].files[0].content.split('\n').filter((l: string) => /^(LF|LH|BRF|BRH):/.test(l)), ['LF:20000', 'LH:15600', 'BRF:3000', 'BRH:2100']);
    const off = await collect(make(false), 30);
    assert.equal(off('coverage').length, 0);
    await s.stop();
  });

  test('the setup page value yes / no is accepted for coverage', () => {
    const src = (v: unknown) => (config({ sources: [{ type: 'sonarqube', name: 'sq', baseUrl: 'https://sonar.example.com', projects: { a: 't' }, coverage: v }] }).sources[0] as SonarQubeSource).coverage;
    assert.deepEqual([src('yes'), src('no'), src(true), src(undefined)], [true, false, true, false]);
    assert.throws(() => src('maybe'), /coverage must be true or false/);
  });
});
