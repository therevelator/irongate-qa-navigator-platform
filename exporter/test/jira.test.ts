import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { detectFields, jqlDate, mapJiraIssue, JiraAdapter, type JiraMapContext } from '../src/sources/jira';
import { finalRecord } from '../src/privacy';
import { fixture, MockServer, config, allStrings } from './helpers';
import type { JiraSource } from '../src/config';

const privacy = { privacy: { sendTitles: false, sendLinks: false, people: 'none' as const }, salt: null };
const statusMap = (list: any[]) => new Map(list.map((s) => [s.name.toLowerCase(), s.statusCategory.key]));

function cloudCtx(over: Partial<JiraMapContext> = {}): JiraMapContext {
  const det = detectFields(fixture('jira-fields.json'), { storyPoints: null, sprint: null, environment: null, flagged: null });
  return {
    src: { teams: { PAY: 'team-pay', WEB: 'team-web' }, defaultTeam: null, baseUrl: 'https://acme.atlassian.net' },
    fields: { storyPoints: det.storyPoints, sprint: det.sprint, environment: det.environment, flagged: det.flagged },
    statusCategories: statusMap(fixture('jira-status.json')), privacy, ...over,
  };
}

describe('Jira field detection', () => {
  test('finds story points, sprint, flagged and found-in by schema and name; the config wins', () => {
    const d = detectFields(fixture('jira-fields.json'), { storyPoints: null, sprint: null, environment: null, flagged: null });
    assert.equal(d.storyPoints, 'customfield_10016');
    assert.equal(d.sprint, 'customfield_10020');
    assert.equal(d.flagged, 'customfield_10021');
    assert.equal(d.environment, 'customfield_10060');
    const o = detectFields(fixture('jira-fields.json'), { storyPoints: 'customfield_99999', sprint: null, environment: null, flagged: null });
    assert.equal(o.storyPoints, 'customfield_99999');
    assert.match(o.detected.join('\n'), /from the config/);
    const dc = detectFields(fixture('jira-dc-fields.json'), { storyPoints: null, sprint: null, environment: null, flagged: null });
    assert.equal(dc.storyPoints, 'customfield_10004');
    assert.equal(dc.sprint, 'customfield_10007');
  });
});

describe('Jira Cloud mapper', () => {
  const page = fixture('jira-cloud-search-page1.json');
  const full = fixture('jira-cloud-changelog-PAY-101.json').values;

  test('a story with a full changelog: type, status category from the status list, points, sprint, transitions, hours', () => {
    const issue = { ...page.issues[0], changelog: { histories: full } };
    const m = mapJiraIssue(issue, cloudCtx());
    assert.equal(m.skip, undefined);
    const r = finalRecord('issue', m.record!, privacy);
    assert.deepEqual(r, {
      key: 'PAY-101', team: 'team-pay', type: 'story', status: 'Verified', statusCategory: 'done', resolution: 'Done',
      storyPoints: 5, estimateHours: 16, timeLoggedHours: 19,
      createdAt: '2026-11-03T10:00:00.000Z', resolvedAt: '2026-11-18T14:00:00.000Z', updatedAt: '2026-11-18T14:05:00.000Z',
      sprints: [{ id: '47', state: 'closed', startedAt: '2026-11-09T09:00:00.000Z', endsAt: '2026-11-20T09:00:00.000Z', completedAt: '2026-11-20T15:00:00.000Z' }],
      transitions: [
        { at: '2026-11-09T09:05:00.000Z', field: 'sprint', to: '47' },
        { at: '2026-11-10T09:00:00.000Z', field: 'status', from: 'To Do', to: 'In Progress', toCategory: 'in_progress' },
        { at: '2026-11-12T09:00:00.000Z', field: 'flagged', to: 'on', toCategory: 'on' },
        { at: '2026-11-12T15:00:00.000Z', field: 'flagged', to: 'off', toCategory: 'off' },
        { at: '2026-11-14T10:00:00.000Z', field: 'status', from: 'In Progress', to: 'Blocked', toCategory: 'blocked' },
        { at: '2026-11-15T10:00:00.000Z', field: 'status', from: 'Blocked', to: 'In Review', toCategory: 'in_progress' },
        // "Verified" is a done status in this Jira (from /status), although its name does not say so.
        { at: '2026-11-18T14:00:00.000Z', field: 'status', from: 'In Review', to: 'Verified', toCategory: 'done' },
      ],
    });
  });

  test('a bug: the free-text environment is classified to production and the text is not sent', () => {
    const m = mapJiraIssue(page.issues[1], cloudCtx());
    const r = finalRecord('issue', m.record!, privacy);
    assert.equal(r.type, 'bug');
    assert.equal(r.environment, 'production');
    assert.equal(r.statusCategory, 'todo');
    assert.ok(!JSON.stringify(r).includes('carol'));
  });

  test('a sub-task, an unmapped project (skipped with the reason), a "Found in" option field', () => {
    assert.equal(finalRecord('issue', mapJiraIssue(page.issues[2], cloudCtx()).record!, privacy).type, 'subtask');
    const skip = mapJiraIssue(page.issues[3], cloudCtx());
    assert.equal(skip.record, undefined);
    assert.match(skip.skip!, /project OPS is not mapped/);
    const web = finalRecord('issue', mapJiraIssue(fixture('jira-cloud-search-page2.json').issues[0], cloudCtx()).record!, privacy);
    assert.equal(web.environment, 'pre-release');
    assert.equal(web.resolution, "Won't Do");
    const dflt = mapJiraIssue(page.issues[3], cloudCtx({ src: { teams: {}, defaultTeam: 'team-ops', baseUrl: 'https://acme.atlassian.net' } }));
    assert.equal(dflt.record!.team, 'team-ops');
  });

  test('titles and links only when enabled; the people hash only with a salt', () => {
    const on = { privacy: { sendTitles: true, sendLinks: true, people: 'hash' as const }, salt: 'customer-held-salt-0123456789' };
    const r = finalRecord('issue', mapJiraIssue(page.issues[0], cloudCtx({ privacy: on })).record!, on);
    assert.equal(r.title, 'Refund to card fails for [email]');
    assert.equal(r.url, 'https://acme.atlassian.net/browse/PAY-101');
    assert.match(String(r.assigneeHash), /^[0-9a-f]{32}$/);
    assert.equal((r.sprints as any[])[0].name, 'PAY Sprint 47');
    const off = finalRecord('issue', mapJiraIssue(page.issues[0], cloudCtx()).record!, privacy);
    for (const k of ['title', 'url', 'assigneeHash']) assert.ok(!(k in off), k);
    assert.ok(!('name' in (off.sprints as any[])[0]));
  });
});

describe('Jira Data Center mapper', () => {
  test('legacy sprint strings, "Story Points", Defect → bug, environment label and text', () => {
    const p = fixture('jira-dc-search-page1.json');
    const ctx: JiraMapContext = {
      src: { teams: { OPS: 'team-ops' }, defaultTeam: null, baseUrl: 'https://jira.internal.example.com' },
      fields: { storyPoints: 'customfield_10004', sprint: 'customfield_10007', environment: null, flagged: null },
      statusCategories: statusMap(fixture('jira-dc-status.json')), privacy,
    };
    const a = finalRecord('issue', mapJiraIssue(p.issues[0], ctx).record!, privacy);
    assert.deepEqual(a.sprints, [{ id: '12', state: 'closed', startedAt: '2026-10-26T09:00:00.000Z', endsAt: '2026-11-06T09:00:00.000Z', completedAt: '2026-11-06T16:00:00.000Z' }]);
    assert.equal(a.storyPoints, 3);
    assert.equal(a.statusCategory, 'done');
    assert.equal((a.transitions as any[]).length, 2);
    const b = finalRecord('issue', mapJiraIssue(p.issues[1], ctx).record!, privacy);
    assert.equal(b.type, 'bug');
    assert.equal(b.environment, 'production');
    assert.ok(!allStrings(b).some((s) => /555|eu-west/.test(s)));
  });
});

test('JQL dates are written in the Jira user time zone', () => {
  const d = new Date('2026-11-20T23:30:00Z');
  assert.equal(jqlDate(d, 'UTC'), '2026/11/20 23:30');
  assert.equal(jqlDate(d, 'Europe/Dublin'), '2026/11/20 23:30');
  assert.equal(jqlDate(d, 'America/New_York'), '2026/11/20 18:30');
  assert.equal(jqlDate(d, 'Asia/Tokyo'), '2026/11/21 08:30');
});

describe('Jira adapter against a mock Jira', () => {
  let cloud: MockServer;
  let dc: MockServer;
  before(async () => {
    cloud = await new MockServer().start();
    let page = 0;
    cloud.on('GET', '/rest/api/3/myself', () => ({ body: fixture('jira-myself.json') }))
      .on('GET', '/rest/api/3/field', () => ({ body: fixture('jira-fields.json') }))
      .on('GET', '/rest/api/3/status', () => ({ body: fixture('jira-status.json') }))
      .on('POST', '/rest/api/3/search/approximate-count', () => ({ body: { count: 5 } }))
      .on('GET', '/rest/api/3/search/jql', (r) => {
        page++;
        // The first call is rate limited once (Retry-After), then served.
        if (page === 1) return { status: 429, headers: { 'Retry-After': '0' }, body: { errorMessages: ['Rate limit exceeded'] } };
        return { body: r.query.get('nextPageToken') === 'CAEaAggD' ? fixture('jira-cloud-search-page2.json') : fixture('jira-cloud-search-page1.json') };
      })
      .on('GET', '/rest/api/3/issue/PAY-101/changelog', () => ({ body: fixture('jira-cloud-changelog-PAY-101.json') }));
    dc = await new MockServer().start();
    dc.on('GET', '/rest/api/2/myself', () => ({ body: fixture('jira-dc-myself.json') }))
      .on('GET', '/rest/api/2/field', () => ({ body: fixture('jira-dc-fields.json') }))
      .on('GET', '/rest/api/2/status', () => ({ body: fixture('jira-dc-status.json') }))
      .on('GET', '/rest/api/2/search', (r) => ({ body: r.query.get('maxResults') === '0' ? { total: 3, issues: [] } : r.query.get('startAt') === '2' ? fixture('jira-dc-search-page2.json') : fixture('jira-dc-search-page1.json') }));
  });
  after(async () => { await cloud.stop(); await dc.stop(); });

  test('Cloud: Basic auth, JQL with the cursor in the user time zone, fields limited, nextPageToken paging, 429 retried, truncated changelog read in full', async () => {
    const cfg = config({ sources: [{ type: 'jira', name: 'jira', baseUrl: cloud.url, deployment: 'cloud', email: 'svc@example.com', jql: 'project in (PAY, WEB)', teams: { PAY: 'team-pay', WEB: 'team-web' } }], http: { maxRetries: 3, maxRetryWaitSeconds: 1 } });
    const a = new JiraAdapter(cfg.sources[0] as JiraSource, cfg.http, privacy, { JIRA_TOKEN: 'jira-token-abc' });
    const pages = [];
    for await (const p of a.collect(new Date('2026-11-01T12:00:00Z'), new Date())) pages.push(p);
    const recs = pages.flatMap((p) => p.records);
    assert.deepEqual(recs.map((r) => r.id), ['PAY-101', 'PAY-102', 'PAY-103', 'WEB-9']);
    assert.deepEqual(pages.flatMap((p) => p.skipped).map((s) => s.id), ['OPS-7']);
    assert.equal(((recs[0].record.transitions) as any[]).length, 7, 'full changelog');
    const searches = cloud.requests.filter((r) => r.path === '/rest/api/3/search/jql');
    assert.equal(searches.length, 3, 'one 429 + two pages');
    const q = searches[1].query;
    assert.equal(q.get('jql'), '(project in (PAY, WEB)) AND updated >= "2026/11/01 12:00" ORDER BY updated ASC, key ASC');
    assert.equal(q.get('expand'), 'changelog');
    const fields = q.get('fields')!.split(',');
    for (const f of ['description', 'comment', 'attachment', 'summary', 'assignee', 'reporter', 'customfield_10050', '*all']) assert.ok(!fields.includes(f), `${f} must not be requested`);
    for (const f of ['issuetype', 'status', 'created', 'updated', 'customfield_10016', 'customfield_10020', 'customfield_10021', 'customfield_10060']) assert.ok(fields.includes(f), f);
    assert.equal(searches[1].headers.authorization, 'Basic ' + Buffer.from('svc@example.com:jira-token-abc').toString('base64'));
    assert.match(String(searches[1].headers['user-agent']), /^qe-exporter\/\d+\.\d+\.\d+/);
    assert.equal(cloud.count('/rest/api/3/issue/PAY-101/changelog'), 1);
    assert.ok(cloud.requests.every((r) => r.method === 'GET' || r.path.endsWith('approximate-count')), 'read-only');
    const checks = await a.check();
    assert.ok(checks.some((c) => /about 5 issues/.test(c)));
  });

  test('Data Center: Bearer PAT, REST v2, startAt paging', async () => {
    const cfg = config({ sources: [{ type: 'jira', name: 'jira-dc', baseUrl: dc.url, auth: 'bearer', jql: 'project = OPS', teams: { OPS: 'team-ops' } }] });
    const a = new JiraAdapter(cfg.sources[0] as JiraSource, cfg.http, privacy, { JIRA_TOKEN: 'pat-xyz-123' });
    const recs = [];
    for await (const p of a.collect(new Date('2026-10-01T00:00:00Z'), new Date())) recs.push(...p.records);
    assert.deepEqual(recs.map((r) => r.id), ['OPS-1', 'OPS-2', 'OPS-3']);
    const searches = dc.requests.filter((r) => r.path === '/rest/api/2/search');
    assert.deepEqual(searches.map((s) => s.query.get('startAt')), ['0', '2']);
    assert.equal(searches[0].headers.authorization, 'Bearer pat-xyz-123');
    // America/New_York user: 00:00Z is 20:00 the day before.
    assert.match(searches[0].query.get('jql')!, /updated >= "2026\/09\/30 20:00"/);
  });

  test('401 is an auth error naming the permission needed', async () => {
    const s = await new MockServer().start();
    s.on('GET', '/rest/api/3/myself', () => ({ status: 401, body: { errorMessages: ['Unauthorized'] } }));
    const cfg = config({ sources: [{ type: 'jira', name: 'j', baseUrl: s.url, deployment: 'cloud', email: 'a@b.c', jql: 'project = X', teams: { X: 't' } }] });
    const a = new JiraAdapter(cfg.sources[0] as JiraSource, cfg.http, privacy, { JIRA_TOKEN: 'bad-token' });
    await assert.rejects(a.check(), (e: any) => e.auth === true && /Browse projects/.test(e.message) && !e.message.includes('bad-token'));
    await s.stop();
  });
});
