import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mapPagerDutyEntries, PagerDutyAdapter } from '../src/sources/pagerduty';
import { mapOpsgenieAlert, OpsgenieAdapter } from '../src/sources/opsgenie';
import { finalRecord } from '../src/privacy';
import { fixture, MockServer, config, allStrings } from './helpers';
import type { OpsgenieSource, PagerDutySource } from '../src/config';

const privacy = { privacy: { sendTitles: false, sendLinks: false, people: 'none' as const }, salt: null };
const pdSrc = { teams: {}, services: { 'payments-api': 'team-pay', checkout: 'team-web' }, categories: { checkout: 'application' }, defaultTeam: null, serviceIds: [] };

describe('PagerDuty mapper', () => {
  test('log entries with included incidents → one record per incident with open / ack / resolve times', () => {
    const page = mapPagerDutyEntries(fixture('pagerduty-log-entries.json').log_entries, { src: pdSrc, privacy });
    const recs = page.records.map((r) => finalRecord('incident', r.record, privacy));
    assert.deepEqual(recs[0], {
      id: 'Q1INC0001', team: 'team-pay', service: 'payments-api', severity: 'critical', status: 'resolved', at: '2026-11-18T10:05:00.000Z',
      openedAt: '2026-11-18T09:12:00.000Z', acknowledgedAt: '2026-11-18T09:20:00.000Z', resolvedAt: '2026-11-18T10:05:00.000Z',
      updates: [{ status: 'open', at: '2026-11-18T09:12:00.000Z' }, { status: 'acknowledged', at: '2026-11-18T09:20:00.000Z' }, { status: 'resolved', at: '2026-11-18T10:05:00.000Z' }],
    });
    assert.equal(recs[1].severity, 'low', 'urgency low without a priority');
    assert.equal(recs[1].status, 'acknowledged');
    assert.equal(recs[1].category, 'application');
    assert.ok(!('resolvedAt' in recs[1]));
    assert.deepEqual(page.skipped, [{ id: 'Q1INC0003', reason: 'service unmapped-svc is not mapped to a team (sources[].services)' }]);
    const s = allStrings(recs).join('\n');
    for (const bad of ['SECRET', 'dave', 'Dave', 'pagerduty.com', 'Card payments', 'PUSER01']) assert.ok(!s.includes(bad), bad);
  });

  test('titles, links and the responder hash only when enabled', () => {
    const on = { privacy: { sendTitles: true, sendLinks: true, people: 'hash' as const }, salt: 'a-customer-salt-of-some-length' };
    const r = finalRecord('incident', mapPagerDutyEntries(fixture('pagerduty-log-entries.json').log_entries, { src: pdSrc, privacy: on }).records[0].record, on);
    assert.equal(r.title, 'Card payments failing ([email]) #1042');
    assert.equal(r.url, 'https://acme.pagerduty.com/incidents/Q1INC0001');
    assert.match(String(r.responderHash), /^[0-9a-f]{32}$/);
  });
});

describe('Opsgenie mapper', () => {
  const teamNames = new Map([['team-og-1', 'Payments']]);
  const src = { teams: { Payments: 'team-pay' }, services: { 'payments-api': 'team-pay' }, categories: {}, defaultTeam: null };
  test('closed alert: ack and close times from the report, service / category / deployment tags', () => {
    const a = fixture('opsgenie-alerts.json').data;
    const r = finalRecord('incident', mapOpsgenieAlert(a[0], { src, teamNames, privacy }).record!, privacy);
    assert.deepEqual(r, {
      id: '6f2c-0001', team: 'team-pay', service: 'payments-api', severity: 'high', status: 'resolved', at: '2026-11-17T10:15:00.000Z',
      openedAt: '2026-11-17T10:00:00.000Z', acknowledgedAt: '2026-11-17T10:02:00.000Z', resolvedAt: '2026-11-17T10:15:00.000Z',
      deploymentId: 'rel-2026-11-17.1', category: 'infrastructure',
    });
    const b = finalRecord('incident', mapOpsgenieAlert(a[1], { src, teamNames, privacy }).record!, privacy);
    assert.equal(b.team, 'team-pay', 'by Opsgenie team name');
    assert.equal(b.status, 'acknowledged');
    assert.equal(b.severity, 'medium');
    assert.match(mapOpsgenieAlert(a[2], { src, teamNames, privacy }).skip!, /not mapped/);
    const s = allStrings([r, b]).join('\n');
    for (const bad of ['SECRET', 'erin', '@', 'Disk full', 'host-1']) assert.ok(!s.includes(bad), bad);
  });
});

describe('Incident adapters against mock APIs', () => {
  let pd: MockServer;
  let og: MockServer;
  before(async () => {
    pd = await new MockServer().start();
    pd.on('GET', '/log_entries', (r) => {
      const since = Date.parse(r.query.get('since')!);
      // The old incident resolves in the window that contains 2026-11-18T08:00Z.
      const until = Date.parse(r.query.get('until')!);
      const t = Date.parse('2026-11-18T08:00:00Z');
      const out = fixture('pagerduty-log-entries.json');
      out.log_entries = out.log_entries.filter((e: any) => Date.parse(e.created_at) >= since && Date.parse(e.created_at) < until);
      if (t >= since && t < until) out.log_entries.push(...fixture('pagerduty-old-resolve.json').log_entries);
      return { body: out };
    })
      .on('GET', '/incidents/Q1INC0000/log_entries', () => ({ body: fixture('pagerduty-incident-log-Q1INC0000.json') }))
      .on('GET', '/services', () => ({ body: fixture('pagerduty-services.json') }));
    og = await new MockServer().start();
    og.on('GET', '/v2/teams', () => ({ body: fixture('opsgenie-teams.json') }))
      .on('GET', '/v2/alerts', (r) => ({ body: r.query.get('limit') === '1' ? { data: [] } : fixture('opsgenie-alerts.json') }));
  });
  after(async () => { await pd.stop(); await og.stop(); });

  test('PagerDuty: read-only token header, 7-day windows, include[]=incidents, the full log of an incident opened before the window', async () => {
    const cfg = config({ sources: [{ type: 'pagerduty', name: 'pd', apiUrl: pd.url, services: pdSrc.services }] });
    const a = new PagerDutyAdapter(cfg.sources[0] as PagerDutySource, cfg.http, privacy, { PAGERDUTY_TOKEN: 'u+pdtoken123' });
    const recs = [];
    for await (const p of a.collect(new Date('2026-11-10T00:00:00Z'), new Date('2026-11-21T00:00:00Z'))) recs.push(...p.records);
    const byId = Object.fromEntries(recs.map((r) => [r.id, finalRecord('incident', r.record, privacy)]));
    assert.deepEqual(Object.keys(byId).sort(), ['Q1INC0000', 'Q1INC0001', 'Q1INC0002']);
    assert.equal(byId.Q1INC0000.openedAt, '2026-10-01T08:00:00.000Z');
    assert.equal(byId.Q1INC0000.acknowledgedAt, '2026-10-01T08:30:00.000Z', 'from the incident\'s own log');
    assert.equal(byId.Q1INC0000.severity, 'medium');
    const logs = pd.requests.filter((r) => r.path === '/log_entries');
    assert.equal(logs.length, 2, 'two windows of at most 7 days');
    assert.deepEqual(logs[0].query.getAll('include[]'), ['incidents']);
    assert.equal(logs[0].headers.authorization, 'Token token=u+pdtoken123');
    assert.equal(logs[0].headers.accept, 'application/vnd.pagerduty+json;version=2');
    assert.ok(pd.requests.every((r) => r.method === 'GET'));
    assert.match((await a.check()).join('\n'), /service payments-api: readable → team-pay/);
  });

  test('Opsgenie: GenieKey header, updatedAt query in epoch ms, sorted ascending; EU endpoint by region', async () => {
    const cfg = config({ sources: [{ type: 'opsgenie', name: 'og', apiUrl: og.url, teams: { Payments: 'team-pay' } }] });
    const a = new OpsgenieAdapter(cfg.sources[0] as OpsgenieSource, cfg.http, privacy, { OPSGENIE_API_KEY: 'og-key-123' });
    const recs = [];
    const since = new Date('2026-11-01T00:00:00Z');
    for await (const p of a.collect(since, new Date('2026-11-21T00:00:00Z'))) recs.push(...p.records);
    assert.deepEqual(recs.map((r) => r.id), ['6f2c-0001', '6f2c-0002']);
    const q = og.requests.find((r) => r.path === '/v2/alerts')!;
    assert.equal(q.query.get('query'), `updatedAt >= ${since.getTime()} AND updatedAt <= ${Date.parse('2026-11-21T00:00:00Z')}`);
    assert.equal(q.query.get('sort'), 'updatedAt');
    assert.equal(q.query.get('order'), 'asc');
    assert.equal(q.headers.authorization, 'GenieKey og-key-123');
    const eu = config({ sources: [{ type: 'opsgenie', name: 'og', region: 'eu' }] });
    assert.equal((eu.sources[0] as OpsgenieSource).apiUrl, 'https://api.eu.opsgenie.com');
    assert.equal((config({ sources: [{ type: 'opsgenie' }] }).sources[0] as OpsgenieSource).apiUrl, 'https://api.opsgenie.com');
  });
});
