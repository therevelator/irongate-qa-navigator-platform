import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mapLinearIssue, LinearAdapter, issuesQuery } from '../src/sources/linear';
import { finalRecord } from '../src/privacy';
import { fixture, MockServer, config, allStrings } from './helpers';
import type { LinearSource } from '../src/config';

const privacy = { privacy: { sendTitles: false, sendLinks: false, people: 'none' as const }, salt: null };
const ctx = { src: { teams: { ENG: 'team-eng' }, defaultTeam: null }, privacy };

describe('Linear mapper', () => {
  const nodes = [...fixture('linear-issues-page1.json').data.issues.nodes, ...fixture('linear-issues-page2.json').data.issues.nodes];

  test('a completed feature in a closed cycle: story, done, points, cycle, history', () => {
    const r = finalRecord('issue', mapLinearIssue(nodes[0], ctx).record!, privacy);
    assert.equal(r.key, 'ENG-1');
    assert.equal(r.type, 'story');
    assert.equal(r.statusCategory, 'done');
    assert.equal(r.resolution, 'Done');
    assert.equal(r.storyPoints, 3);
    assert.equal(r.resolvedAt, '2026-11-14T15:00:00.000Z');
    assert.deepEqual(r.sprints, [{ id: 'c7a1e7b2-0000-4000-8000-000000000007', state: 'closed', startedAt: '2026-11-02T00:00:00.000Z', endsAt: '2026-11-16T00:00:00.000Z', completedAt: '2026-11-16T01:00:00.000Z' }]);
    assert.deepEqual(r.transitions, [
      { at: '2026-11-03T09:00:00.000Z', field: 'status', to: 'Backlog', toCategory: 'todo' },
      { at: '2026-11-03T09:05:00.000Z', field: 'sprint', to: 'c7a1e7b2-0000-4000-8000-000000000007' },
    ]);
  });

  test('a production bug that is blocked; a canceled sub-issue; an unmapped team', () => {
    const b = finalRecord('issue', mapLinearIssue(nodes[1], ctx).record!, privacy);
    assert.equal(b.type, 'bug');
    assert.equal(b.environment, 'production');
    assert.equal((b.transitions as any[])[1].toCategory, 'blocked');
    const c = finalRecord('issue', mapLinearIssue(nodes[2], ctx).record!, privacy);
    assert.equal(c.type, 'subtask');
    assert.equal(c.resolution, 'Canceled');
    assert.equal(c.statusCategory, 'done');
    const u = mapLinearIssue(nodes[3], ctx);
    assert.match(u.skip!, /Linear team DES is not mapped/);
  });

  test('nothing personal or free text in the output: titles, descriptions, comments, labels, e-mails', () => {
    const out = nodes.slice(0, 3).map((n) => finalRecord('issue', mapLinearIssue(n, ctx).record!, privacy));
    const s = allStrings(out).join('\n');
    for (const bad of ['SECRET', 'frank', 'Frank', 'Grace', '@', 'linear.app', 'Engineering']) assert.ok(!s.includes(bad), bad);
  });

  test('the GraphQL query asks for titles, urls and assignees only when enabled', () => {
    assert.ok(!/\btitle\b|\burl\b|assignee/.test(issuesQuery(privacy.privacy)));
    assert.ok(!/description|comments|attachments/.test(issuesQuery({ sendTitles: true, sendLinks: true, people: 'hash' })));
    assert.match(issuesQuery({ sendTitles: true, sendLinks: true, people: 'hash' }), /title url assignee \{ id \}/);
  });
});

describe('Linear adapter against a mock GraphQL API', () => {
  let s: MockServer;
  let calls = 0;
  before(async () => {
    s = await new MockServer().start();
    s.on('POST', '/graphql', (r) => {
      const q: string = r.json.query;
      if (q.includes('organization')) return { body: fixture('linear-teams.json') };
      if (q.startsWith('query History')) return { body: fixture('linear-history-ENG-1.json') };
      calls++;
      // The first page is rate limited once (Linear answers 400 with code RATELIMITED).
      if (calls === 1) return { status: 400, headers: { 'Retry-After': '0' }, body: { errors: [{ message: 'Rate limit exceeded', extensions: { code: 'RATELIMITED' } }] } };
      return { body: r.json.variables.after === 'cursor-1' ? fixture('linear-issues-page2.json') : fixture('linear-issues-page1.json') };
    });
  });
  after(() => s.stop());

  test('filters by updatedAt and team keys, pages by cursor, reads a long history in full, retries RATELIMITED', async () => {
    const cfg = config({ sources: [{ type: 'linear', name: 'linear', apiUrl: `${s.url}/graphql`, teams: { ENG: 'team-eng' } }], http: { maxRetries: 2, maxRetryWaitSeconds: 1 } });
    const a = new LinearAdapter(cfg.sources[0] as LinearSource, cfg.http, privacy, { LINEAR_API_KEY: 'lin_api_test123' });
    const recs = [];
    for await (const p of a.collect(new Date('2026-11-01T00:00:00Z'), new Date())) recs.push(...p.records);
    assert.deepEqual(recs.map((r) => r.id), ['ENG-1', 'ENG-2', 'ENG-3']);
    assert.equal((recs[0].record.transitions as any[]).length, 4, 'first page of history + the rest');
    const issueCalls = s.requests.filter((r) => r.json?.query?.startsWith('query Issues'));
    assert.deepEqual(issueCalls[1].json.variables.filter, { updatedAt: { gte: '2026-11-01T00:00:00.000Z' }, team: { key: { in: ['ENG'] } } });
    assert.equal(issueCalls[1].headers.authorization, 'lin_api_test123');
    assert.ok(s.requests.every((r) => !/mutation/i.test(r.json?.query ?? '')));
    const check = await a.check();
    assert.match(check.join('\n'), /team ENG: readable → team-eng/);
  });
});
