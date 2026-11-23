import {
  authorHash, deployResult, detectCommitFormat, detectDeploymentFormat, detectIncidentFormat, isOutage, isProductionEnvironment,
  normaliseIncidentStatus, normaliseSeverity, parseCommitBody, parseDeploymentBody, parseIncidentBody, MAX_EVENTS,
} from '../../server/lib/ingest/deliveryEvents';
import { ReportError } from '../../server/lib/ingest/testReports';
import { isRawIngestPath } from '../../server/lib/ingest/body';
import {
  classifyFailedChanges, computeDeliveryDay, deliveryAffectedDays, unionLength, type DeliveryData, type DeployRow, type IncidentRow,
} from '../../server/lib/calc/delivery';

/**
 * Unit tests of v2 phase 2 (delivery and reliability): the event parsers and the mappings of GitHub,
 * GitLab, PagerDuty and Opsgenie payloads (server/lib/ingest/deliveryEvents.ts), and the calculation
 * (server/lib/calc/delivery.ts) on a hand-built set of deploys and incidents whose expected values
 * are worked out by hand in the comments. No backend needed.
 */

const err = (fn: () => unknown): string => {
  try { fn(); } catch (e) { if (e instanceof ReportError) return e.message; throw e; }
  throw new Error('expected a ReportError');
};

describe('Normalisation', () => {
  it('DPARSE-001 severities, statuses, results and production environments', () => {
    expect(['SEV1', 'sev-1', 'P1', 'critical', '1'].map(normaliseSeverity)).toEqual(['critical', 'critical', 'critical', 'critical', 'critical']);
    expect(['SEV2', 'P2', 'major', 'high'].map(normaliseSeverity)).toEqual(['high', 'high', 'high', 'high']);
    expect(['sev3', 'P3', 'moderate'].map(normaliseSeverity)).toEqual(['medium', 'medium', 'medium']);
    expect(['P4', 'minor', 'low'].map(normaliseSeverity)).toEqual(['low', 'low', 'low']);
    expect(['P5', 'info'].map(normaliseSeverity)).toEqual(['info', 'info']);
    expect(normaliseSeverity('whatever')).toBeNull();
    expect(['triggered', 'incident.acknowledged', 'closed', 'Resolved', 'reopened'].map(normaliseIncidentStatus)).toEqual(['open', 'acknowledged', 'resolved', 'resolved', 'open']);
    expect(['success', 'SUCCEEDED', 'failed', 'cancelled', 'rolled back', 'reverted', 'UNSTABLE', 'SucceededWithIssues'].map((r) => deployResult(r, 'r')))
      .toEqual(['success', 'success', 'failure', 'failure', 'rolled_back', 'rolled_back', 'success', 'success']);
    expect(err(() => deployResult('maybe', 'deployment.result'))).toMatch(/deployment.result must be success, failure or rolled_back/);
    expect(['production', 'prod', 'PRD', 'live', 'production-eu', 'prod.us'].every(isProductionEnvironment)).toBe(true);
    expect(['staging', 'preprod', 'qa', 'production2'].some(isProductionEnvironment)).toBe(false);
    expect(isOutage('critical', null)).toBe(true);
    expect(isOutage('high', false)).toBe(false);
    expect(isOutage('low', true)).toBe(true);
    expect(isOutage('medium', null)).toBe(false);
  });

  it('DPARSE-002 author hashes are salted per company and never the address; the new endpoints read their own body', () => {
    const a = authorHash('co-1', 'Dev@Example.com ');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(authorHash('co-1', 'dev@example.com')).toBe(a);
    expect(authorHash('co-2', 'dev@example.com')).not.toBe(a);
    expect(['/api/ingest/deployments', '/api/ingest/commits', '/api/ingest/incidents/'].every(isRawIngestPath)).toBe(true);
  });
});

describe('Deployments', () => {
  const now = '2026-11-18T10:00:00Z';
  it('DPARSE-010 one event, an array, {deployments: [...]}; commit lists, ranges and defaults', () => {
    const one = parseDeploymentBody({ id: 'd-1', environment: 'production', service: 'api', commit: 'abc1234', startedAt: '2026-11-18T09:50:00Z', finishedAt: now, result: 'success' }, 'json');
    expect(one.events).toHaveLength(1);
    expect(one.events[0]).toMatchObject({ id: 'd-1', production: true, commit: 'abc1234', result: 'success', hotfix: false, rollbackOf: null });
    const list = parseDeploymentBody([{ id: 'a', environment: 'staging', commit: 'aaaa111', finishedAt: now, result: 'ok' }, { id: 'b', environment: 'prod', commitRange: 'aaaa111..bbbb222', finishedAt: now, result: 'failed', hotfix: 'true' }], 'json', { team: 't-1' });
    expect(list.events.map((e) => [e.id, e.production, e.commit, e.commitFrom, e.result, e.hotfix, e.team])).toEqual([
      ['a', false, 'aaaa111', null, 'success', false, 't-1'], ['b', true, 'bbbb222', 'aaaa111', 'failure', true, 't-1'],
    ]);
    const wrapped = parseDeploymentBody({ team: 't-9', deployments: [{ id: 'c', environment: 'production', commits: ['1111aaa', { sha: '2222bbb', authoredAt: '2026-11-17T08:00:00Z', author: 'x@y.z' }], finishedAt: now, result: 'rolled_back', rollbackOf: 'b' }] }, 'json');
    const c = wrapped.events[0];
    expect(c).toMatchObject({ team: 't-9', commit: '2222bbb', result: 'rolled_back', rollbackOf: 'b' });
    expect(c.commits.map((x) => [x.sha, x.authoredAt?.toISOString() ?? null, x.author ?? null])).toEqual([['1111aaa', null, null], ['2222bbb', '2026-11-17T08:00:00.000Z', 'x@y.z']]);
    expect(parseDeploymentBody({ id: 'r', environment: 'production', commitRange: { from: 'aaaa111', to: 'cccc333' }, finishedAt: now, result: 'success' }, 'json').events[0]).toMatchObject({ commit: 'cccc333', commitFrom: 'aaaa111' });
  });

  it('DPARSE-011 errors name the event and the field; computed values and over-size batches are refused', () => {
    expect(err(() => parseDeploymentBody({ environment: 'production', commit: 'abcd', finishedAt: now, result: 'success' }, 'json'))).toBe("deployment.id is required (the deployment's id in your tool)");
    expect(err(() => parseDeploymentBody([{ id: 'x', commit: 'abcd', finishedAt: now, result: 'success' }], 'json'))).toMatch(/^deployments\[0\]\.environment is required/);
    expect(err(() => parseDeploymentBody({ id: 'x', environment: 'production', commit: 'abcd', result: 'success' }, 'json'))).toMatch(/finishedAt is required/);
    expect(err(() => parseDeploymentBody({ id: 'x', environment: 'production', commit: 'abcd', startedAt: now, finishedAt: '2026-11-18T09:00:00Z', result: 'success' }, 'json'))).toMatch(/finishedAt is before startedAt/);
    expect(err(() => parseDeploymentBody({ id: 'x', environment: 'production', finishedAt: now, result: 'success' }, 'json'))).toMatch(/commit is required/);
    expect(err(() => parseDeploymentBody({ id: 'x', environment: 'production', commit: 'not a sha!', finishedAt: now, result: 'success' }, 'json'))).toMatch(/must be a commit sha/);
    expect(err(() => parseDeploymentBody({ id: 'x', environment: 'production', commit: 'abcd', finishedAt: 'yesterday', result: 'success' }, 'json'))).toMatch(/ISO 8601/);
    expect(err(() => parseDeploymentBody({ deploymentFrequency: 12, deployments: [] }, 'json'))).toMatch(/deploymentFrequency: QE Navigator calculates this from the raw events/);
    expect(err(() => parseDeploymentBody({ id: 'x', environment: 'production', commit: 'abcd', finishedAt: now, result: 'success', change_failure_rate: 4 }, 'json'))).toMatch(/change_failure_rate: QE Navigator calculates/);
    const many = Array.from({ length: MAX_EVENTS + 1 }, (_, i) => ({ id: `d${i}`, environment: 'production', commit: 'abcd', finishedAt: now, result: 'success' }));
    expect(err(() => parseDeploymentBody(many, 'json'))).toBe('Too many deployments in one request: at most 500 (send several requests)');
    expect(parseDeploymentBody(many.slice(0, MAX_EVENTS), 'json').events).toHaveLength(MAX_EVENTS);
  });

  it('DPARSE-012 GitHub deployment_status and GitLab deployment webhooks are mapped; unfinished states are ignored', () => {
    const gh = {
      action: 'created',
      deployment_status: { state: 'success', environment: 'production', created_at: '2026-11-18T10:00:00Z', target_url: 'https://github.com/acme/api/actions/runs/9' },
      deployment: { id: 81234, sha: '9f8e7d6c5b4a', ref: 'hotfix/INC-7', environment: 'production', created_at: '2026-11-18T09:52:00Z', payload: {}, production_environment: true },
      repository: { name: 'payments-api' },
    };
    expect(detectDeploymentFormat(gh)).toBe('github');
    expect(parseDeploymentBody(gh, 'github').events[0]).toMatchObject({ id: '81234', environment: 'production', production: true, service: 'payments-api', commit: '9f8e7d6c5b4a', result: 'success', hotfix: true, url: 'https://github.com/acme/api/actions/runs/9' });
    const pending = parseDeploymentBody({ ...gh, deployment_status: { ...gh.deployment_status, state: 'in_progress' } }, 'github');
    expect(pending.events).toHaveLength(0);
    expect(pending.ignored[0].reason).toMatch(/"in_progress" is not final/);
    const gl = { object_kind: 'deployment', status: 'failed', deployment_id: 15, environment: 'production', sha: 'a1b2c3d4e5', ref: 'main', status_changed_at: '2026-11-18 10:00:00 +0000', deployable_url: 'https://gitlab.example/acme/api/-/jobs/1', project: { name: 'lending-api' } };
    expect(detectDeploymentFormat(gl)).toBe('gitlab');
    expect(parseDeploymentBody(gl, 'gitlab').events[0]).toMatchObject({ id: '15', production: true, service: 'lending-api', result: 'failure', commit: 'a1b2c3d4e5' });
    expect(parseDeploymentBody({ ...gl, status: 'running' }, 'gitlab').events).toHaveLength(0);
  });
});

describe('Commits', () => {
  it('DPARSE-020 git log JSON, an array of commits, GitHub and GitLab pushes', () => {
    const b = parseCommitBody({ deployment: 'd-1', commits: [{ sha: 'aaaa111', authoredAt: '2026-11-17T08:00:00Z', committedAt: '2026-11-17T09:00:00Z', author: 'dev@acme.example' }] }, 'json');
    expect(b[0]).toMatchObject({ deployment: 'd-1', team: null });
    expect(b[0].commits[0]).toMatchObject({ sha: 'aaaa111', author: 'dev@acme.example', authorHash: null });
    const arr = parseCommitBody([{ sha: 'bbbb222', authorHash: 'ABCDEF0123456789' }], 'json', { team: 't-1', deployment: 'd-2' });
    expect(arr[0]).toMatchObject({ team: 't-1', deployment: 'd-2' });
    expect(arr[0].commits[0].authorHash).toBe('abcdef0123456789');
    expect(err(() => parseCommitBody([{ sha: 'bbbb222', authorHash: 'not-hex' }], 'json'))).toMatch(/authorHash must be a hex hash/);
    // An empty commit list (git log PREV..SHA printed nothing) records nothing; it is not an error.
    expect(parseCommitBody({ commits: [] }, 'json')).toEqual([]);
    const push = {
      ref: 'refs/heads/main', before: '000', after: 'cccc333', pusher: { name: 'dev' }, repository: { name: 'payments-api' },
      commits: [{ id: 'cccc333', timestamp: '2026-11-17T10:00:00+01:00', author: { name: 'Dev One', email: 'one@acme.example' } }],
    };
    expect(detectCommitFormat(push)).toBe('github');
    const gp = parseCommitBody(push, 'github');
    expect(gp[0]).toMatchObject({ branch: 'main', service: 'payments-api' });
    expect(gp[0].commits[0]).toMatchObject({ sha: 'cccc333', author: 'one@acme.example' });
    expect(gp[0].commits[0].authoredAt?.toISOString()).toBe('2026-11-17T09:00:00.000Z');
    const glPush = { object_kind: 'push', ref: 'refs/heads/main', project: { name: 'lending-api' }, commits: [{ id: 'dddd444', timestamp: '2026-11-17T10:00:00Z', author: { email: 'two@acme.example' } }] };
    expect(detectCommitFormat(glPush)).toBe('gitlab');
    expect(parseCommitBody(glPush, 'gitlab')[0]).toMatchObject({ service: 'lending-api', branch: 'main' });
  });
});

describe('Incidents', () => {
  it('DPARSE-030 the JSON shape: a full record, a status update, a status stream', () => {
    const [full] = parseIncidentBody({ id: 'INC-1', title: 'Payments down', severity: 'SEV1', service: 'payments-api', openedAt: '2026-11-18T09:00:00Z', acknowledgedAt: '2026-11-18T09:05:00Z', resolvedAt: '2026-11-18T10:30:00Z', deploymentId: 'd-1', category: 'Infrastructure' }, 'json');
    expect(full).toMatchObject({ id: 'INC-1', severity: 'critical', severityLabel: 'SEV1', deployment: 'd-1', category: 'infrastructure', status: null });
    const [upd] = parseIncidentBody({ id: 'INC-1', status: 'resolved', at: '2026-11-18T10:30:00Z' }, 'json');
    expect(upd).toMatchObject({ status: 'resolved', openedAt: null });
    expect(upd.at?.toISOString()).toBe('2026-11-18T10:30:00.000Z');
    const [stream] = parseIncidentBody({ id: 'INC-2', openedAt: '2026-11-18T09:00:00Z', updates: [{ status: 'resolved', at: '2026-11-18T11:00:00Z' }, { status: 'acknowledged', at: '2026-11-18T09:10:00Z' }] }, 'json');
    expect(stream.acknowledgedAt?.toISOString()).toBe('2026-11-18T09:10:00.000Z');
    expect(stream.resolvedAt?.toISOString()).toBe('2026-11-18T11:00:00.000Z');
    expect(stream.status).toBe('resolved');
    // An update of a known incident may carry only what changed (a new incident without openedAt is refused when stored).
    expect(parseIncidentBody({ id: 'INC-3', deploymentId: 'd-9' }, 'json')[0]).toMatchObject({ openedAt: null, status: null, deployment: 'd-9' });
    expect(err(() => parseIncidentBody({ id: 'INC-3', openedAt: '2026-11-18T09:00:00Z', severity: 'bad' }, 'json'))).toMatch(/severity "bad" is not understood/);
    expect(err(() => parseIncidentBody({ id: 'INC-3', openedAt: '2026-11-18T09:00:00Z', resolvedAt: '2026-11-18T08:00:00Z' }, 'json'))).toMatch(/resolvedAt is before openedAt/);
    expect(err(() => parseIncidentBody({ mttr: 3, incidents: [] }, 'json'))).toMatch(/mttr: QE Navigator calculates/);
  });

  it('DPARSE-031 PagerDuty v3 webhooks and REST exports', () => {
    const wh = { event: { id: 'e1', event_type: 'incident.resolved', occurred_at: '2026-11-18T10:30:00Z', data: { id: 'PABC123', type: 'incident', title: 'Checkout errors', status: 'resolved', urgency: 'high', priority: { summary: 'P2' }, service: { summary: 'checkout-api' }, created_at: '2026-11-18T09:00:00Z', html_url: 'https://acme.pagerduty.com/incidents/PABC123' } } };
    expect(detectIncidentFormat(wh)).toBe('pagerduty');
    const [i] = parseIncidentBody(wh, 'pagerduty');
    expect(i).toMatchObject({ id: 'PABC123', severity: 'high', severityLabel: 'P2', service: 'checkout-api', status: 'resolved', source: 'pagerduty' });
    expect(i.resolvedAt?.toISOString()).toBe('2026-11-18T10:30:00.000Z');
    const trig = parseIncidentBody({ event: { ...wh.event, event_type: 'incident.triggered', data: { ...wh.event.data, status: 'triggered', priority: null, urgency: 'low' } } }, 'pagerduty')[0];
    expect(trig).toMatchObject({ status: 'open', severity: 'low', resolvedAt: null });
    expect(err(() => parseIncidentBody({ event: { event_type: 'incident.delegated', data: {} } }, 'pagerduty'))).toMatch(/not an incident status event/);
    const exp = { incidents: [{ id: 'P1', incident_number: 7, status: 'resolved', urgency: 'high', created_at: '2026-11-10T08:00:00Z', last_status_change_at: '2026-11-10T09:30:00Z', service: { summary: 'api' } }], limit: 100 };
    expect(detectIncidentFormat(exp)).toBe('pagerduty');
    const [e1] = parseIncidentBody(exp, 'pagerduty');
    expect(e1.resolvedAt?.toISOString()).toBe('2026-11-10T09:30:00.000Z');
    expect(e1.severity).toBe('high');
  });

  it('DPARSE-032 Opsgenie alert webhooks and exports', () => {
    const wh = { action: 'Close', alert: { alertId: 'og-1', message: 'DB latency', priority: 'P1', tags: ['service:ledger-service'], createdAt: Date.parse('2026-11-18T09:00:00Z'), updatedAt: Date.parse('2026-11-18T09:40:00Z') }, source: { name: 'x' } };
    expect(detectIncidentFormat(wh)).toBe('opsgenie');
    const [i] = parseIncidentBody(wh, 'opsgenie');
    expect(i).toMatchObject({ id: 'og-1', severity: 'critical', service: 'ledger-service', status: 'resolved', source: 'opsgenie' });
    expect(i.resolvedAt?.toISOString()).toBe('2026-11-18T09:40:00.000Z');
    const exp = { data: [{ id: 'og-2', tinyId: '12', message: 'Queue backlog', status: 'closed', acknowledged: true, priority: 'P3', entity: 'settlement-worker', createdAt: '2026-11-17T12:00:00Z', report: { ackTime: 300000, closeTime: 5400000 } }] };
    expect(detectIncidentFormat(exp)).toBe('opsgenie');
    const [e] = parseIncidentBody(exp, 'opsgenie');
    expect(e).toMatchObject({ severity: 'medium', service: 'settlement-worker', status: 'resolved' });
    expect(e.acknowledgedAt?.toISOString()).toBe('2026-11-17T12:05:00.000Z');
    expect(e.resolvedAt?.toISOString()).toBe('2026-11-17T13:30:00.000Z');
  });
});

describe('Calculation (hand-checked)', () => {
  const T = (s: string) => Date.parse(s);
  const dep = (id: string, finished: string, o: Partial<DeployRow> = {}): DeployRow => ({
    id, externalId: id, service: 'api', environment: 'production', result: 'success', rollbackOf: null, hotfix: false, startedAt: null,
    finishedAt: T(finished), firstAuthoredAt: null, commitCount: 1, commit: `${id}sha`, url: null, ...o,
  });
  const inc = (id: string, opened: string, resolved: string | null, o: Partial<IncidentRow> = {}): IncidentRow => ({
    id, externalId: id, title: null, service: 'api', severity: 'medium', outage: null, category: null, openedAt: T(opened), acknowledgedAt: null,
    resolvedAt: resolved ? T(resolved) : null, deployment: null, url: null, ...o,
  });
  // Day 2026-11-10; the 28-day window is 14 Oct – 10 Nov; the team's first deploy (d8) is older, so the period is 28 days = 4 weeks.
  const deploys: DeployRow[] = [
    dep('d8', '2026-10-01T10:00:00Z'),
    dep('d1', '2026-11-01T10:00:00Z', { firstAuthoredAt: T('2026-10-31T10:00:00Z') }), // lead 1 day; rolled back by d7
    dep('d2', '2026-11-03T10:00:00Z', { firstAuthoredAt: T('2026-11-01T10:00:00Z') }), // lead 2 days
    dep('d3', '2026-11-05T10:00:00Z', { result: 'rolled_back', firstAuthoredAt: T('2026-11-05T04:00:00Z') }), // lead 0.25 day; failed (rolled back)
    dep('d4', '2026-11-07T10:00:00Z', { firstAuthoredAt: T('2026-11-06T10:00:00Z') }), // lead 1 day; failed (hotfix d5 10 h later)
    dep('d5', '2026-11-07T20:00:00Z', { hotfix: true, firstAuthoredAt: T('2026-11-07T18:00:00Z') }), // lead 2 h
    dep('d6', '2026-11-08T12:00:00Z', { result: 'failure' }), // did not complete: not counted
    dep('d7', '2026-11-09T09:00:00Z', { rollbackOf: 'd1' }), // a rollback deploy: not counted
    dep('d9', '2026-11-10T08:00:00Z', { service: 'web' }), // no commit times; incident i3 linked only on 11 Nov
  ];
  const incidents: IncidentRow[] = [
    inc('i4', '2026-09-30T00:00:00Z', '2026-09-30T02:00:00Z'), // before the window: the previous start for the MTBF
    inc('i0', '2026-10-20T00:00:00Z', '2026-10-20T01:00:00Z', { category: 'application' }), // 1 h
    inc('i1', '2026-11-02T00:00:00Z', '2026-11-02T03:00:00Z', { severity: 'critical', category: 'infrastructure' }), // 3 h, an outage
    inc('i2', '2026-11-06T12:00:00Z', '2026-11-06T13:00:00Z', { severity: 'low' }), // 1 h
    inc('i3', '2026-11-11T09:00:00Z', null, { severity: 'high', deployment: 'd9', service: 'web' }), // after the day: unknown as of 10 Nov
  ];
  const data: DeliveryData = { deploys, incidents, firstDeployAt: T('2026-10-01T10:00:00Z'), firstIncidentAt: T('2026-09-30T00:00:00Z'), hasCategories: true };

  it('DCALC-001 failed changes as of a moment: rolled back, rollback deploy, hotfix within 72 h of the same service, linked incident', () => {
    const asOf = T('2026-11-10T23:59:59.999Z');
    const f = classifyFailedChanges(deploys, incidents, asOf);
    expect(Array.from(f.keys()).sort()).toEqual(['d1', 'd3', 'd4']);
    expect(f.get('d1')!.map((r) => [r.type, r.ref])).toEqual([['rollback', 'd7']]);
    expect(f.get('d3')!.map((r) => r.type)).toEqual(['rolled_back']);
    expect(f.get('d4')!.map((r) => [r.type, r.ref])).toEqual([['hotfix', 'd5']]);
    // A day later the linked incident i3 is known: d9 is a failed change too.
    expect(classifyFailedChanges(deploys, incidents, T('2026-11-11T23:59:59Z')).get('d9')!.map((r) => r.type)).toEqual(['incident']);
    // Before d7 existed, d1 was not yet a failed change.
    expect(classifyFailedChanges(deploys, incidents, T('2026-11-08T00:00:00Z')).has('d1')).toBe(false);
    // A hotfix more than 72 h later, or of another service, does not blame the deploy before it.
    const late = [dep('x1', '2026-11-01T10:00:00Z'), dep('x2', '2026-11-04T11:00:00Z', { hotfix: true }), dep('y1', '2026-11-05T10:00:00Z'), dep('y2', '2026-11-05T12:00:00Z', { hotfix: true, service: 'web' })];
    expect(classifyFailedChanges(late, [], T('2026-11-10T00:00:00Z')).size).toBe(0);
  });

  it('DCALC-002 the DORA values of one day', () => {
    const out = Object.fromEntries(computeDeliveryDay('2026-11-10', data, T('2026-11-20T00:00:00Z')).map((m) => [m.key, m]));
    // Counted: d1, d2, d3, d4, d5, d9 = 6 production deploys in 4 weeks → 1.5 per week.
    expect(out.deployment_frequency.value).toBe(1.5);
    expect(out.deployment_frequency.inputs).toMatchObject({ productionDeploys: 6, periodDays: 28, notCompleted: 1, rollbackDeploys: 1 });
    // Lead times 1, 2, 0.25, 1, 0.0833 days (d9 has none) → median 1 day.
    expect(out.lead_time.value).toBe(1);
    expect(out.lead_time.inputs).toMatchObject({ deploysWithCommits: 5, deploysWithoutCommitTimes: 1 });
    // d1, d3, d4 failed of 6 → 50 %.
    expect(out.change_failure_rate.value).toBe(50);
    expect(out.change_failure_rate.inputs).toMatchObject({ failedChanges: 3, productionDeploys: 6, rolledBack: 2, followedByHotfix: 1, linkedIncident: 0 });
    // Resolved in the window: i0 1 h, i1 3 h, i2 1 h → median 1 h.
    expect(out.mttr.value).toBe(1);
    // Outage: i1, 3 h of 28 × 24 = 672 h → 99.554 %.
    expect(out.availability.value).toBe(99.554);
    expect(out.availability.inputs).toMatchObject({ outageHours: 3, periodHours: 672, outages: 1 });
    // Starts of api incidents: 30 Sep → 20 Oct (480 h) → 2 Nov (312 h) → 6 Nov 12:00 (108 h): mean 300 h.
    expect(out.mtbf.value).toBe(300);
    // 3 incidents opened in the period ÷ 6 deploys.
    expect(out.incidents_per_deploy.value).toBe(0.5);
    expect(out.infrastructure_failures.value).toBe(1);
    expect(out.deployment_frequency.recordedAt).toBe('2026-11-10T08:00:00.000Z');
    // A day later: i3 is linked to d9 (4 of 6 failed), and the open outage i3 counts until the end of the day.
    const next = Object.fromEntries(computeDeliveryDay('2026-11-11', data, T('2026-11-20T00:00:00Z')).map((m) => [m.key, m]));
    expect(next.change_failure_rate.value).toBe(66.67);
    expect(next.availability.inputs).toMatchObject({ outageHours: 18, openOutages: 1 });
  });

  it('DCALC-003 a new team: the period starts at its first deploy (at least 7 days); no incident data → no reliability values', () => {
    const fresh: DeliveryData = { deploys: [dep('n1', '2026-11-09T10:00:00Z'), dep('n2', '2026-11-10T10:00:00Z')], incidents: [], firstDeployAt: T('2026-11-09T10:00:00Z'), firstIncidentAt: null, hasCategories: false };
    const out = Object.fromEntries(computeDeliveryDay('2026-11-10', fresh, T('2026-11-20T00:00:00Z')).map((m) => [m.key, m]));
    expect(out.deployment_frequency.value).toBe(2);
    expect(out.deployment_frequency.inputs).toMatchObject({ periodDays: 7 });
    expect(out.change_failure_rate.value).toBe(0);
    expect(out.lead_time).toBeUndefined();
    expect(out.mttr).toBeUndefined();
    expect(out.availability).toBeUndefined();
    expect(computeDeliveryDay('2026-11-08', fresh, T('2026-11-20T00:00:00Z'))).toEqual([]);
  });

  it('DCALC-004 helpers: overlapping outages count once; affected days run 28 days on, up to today', () => {
    expect(unionLength([[0, 10], [5, 15], [20, 25]], 0, 100)).toBe(20);
    expect(unionLength([[0, 10]], 5, 8)).toBe(3);
    const days = deliveryAffectedDays(['2026-11-01', '2026-11-03'], '2026-11-10');
    expect(days[0]).toBe('2026-11-01');
    expect(days[days.length - 1]).toBe('2026-11-10');
    expect(days).toHaveLength(10);
    expect(deliveryAffectedDays(['2026-09-01'], '2026-11-10')).toHaveLength(28);
    expect(deliveryAffectedDays(['2026-12-01'], '2026-11-10')).toEqual([]);
  });
});
