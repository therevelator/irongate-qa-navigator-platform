import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac } from 'node:crypto';
import { mapJiraIssue, detectFields } from '../src/sources/jira';
import { mapLinearIssue } from '../src/sources/linear';
import { mapPagerDutyEntries } from '../src/sources/pagerduty';
import { mapOpsgenieAlert } from '../src/sources/opsgenie';
import { finalRecord, personHash, maskTitle, PrivacyViolation } from '../src/privacy';
import { applyPolicy, SEND_POLICY } from '../src/policy';
import { FIELD_ALLOW_LIST, minimise } from '../src/vendor/fieldAllowList';
import { fixture, allStrings } from './helpers';

const here = dirname(fileURLToPath(import.meta.url));
const OFF = { privacy: { sendTitles: false, sendLinks: false, people: 'none' as const }, salt: null };
const ON = { privacy: { sendTitles: true, sendLinks: true, people: 'hash' as const }, salt: 'customer-salt-kept-on-premises' };

/** Every record of every fixture, mapped and finalised with the given privacy. */
function everything(p: typeof OFF | typeof ON) {
  const out: Record<string, unknown>[] = [];
  const statuses = new Map(fixture('jira-status.json').map((s: any) => [s.name.toLowerCase(), s.statusCategory.key]));
  const det = detectFields(fixture('jira-fields.json'), { storyPoints: null, sprint: null, environment: null, flagged: null });
  const jctx = { src: { teams: { PAY: 't1', WEB: 't2', OPS: 't3' }, defaultTeam: null, baseUrl: 'https://acme.atlassian.net' }, fields: det, statusCategories: statuses as Map<string, string>, privacy: p };
  const jira = [...fixture('jira-cloud-search-page1.json').issues, ...fixture('jira-cloud-search-page2.json').issues, ...fixture('jira-dc-search-page1.json').issues, ...fixture('jira-dc-search-page2.json').issues];
  jira[0] = { ...jira[0], changelog: { histories: fixture('jira-cloud-changelog-PAY-101.json').values } };
  for (const i of jira) out.push(finalRecord('issue', mapJiraIssue(i, { ...jctx, fields: { ...det, sprint: det.sprint } }).record!, p));
  const lin = [...fixture('linear-issues-page1.json').data.issues.nodes, ...fixture('linear-issues-page2.json').data.issues.nodes];
  for (const n of lin) out.push(finalRecord('issue', mapLinearIssue(n, { src: { teams: { ENG: 't1', DES: 't2' }, defaultTeam: null }, privacy: p }).record!, p));
  const pd = mapPagerDutyEntries(fixture('pagerduty-log-entries.json').log_entries, { src: { teams: {}, services: {}, categories: {}, defaultTeam: 't9', serviceIds: [] }, privacy: p });
  for (const r of pd.records) out.push(finalRecord('incident', r.record, p));
  for (const a of fixture('opsgenie-alerts.json').data) out.push(finalRecord('incident', mapOpsgenieAlert(a, { src: { teams: {}, services: {}, categories: {}, defaultTeam: 't9' }, teamNames: new Map(), privacy: p }).record!, p));
  return out;
}

describe('Minimisation: what never leaves the network', () => {
  test('default privacy: no description, comment, attachment, custom free text, name, e-mail, title, link or person in any record', () => {
    const recs = everything(OFF);
    assert.equal(recs.length, 8 + 4 + 3 + 3);
    const s = allStrings(recs).join('\n');
    const forbidden = [
      'SECRET', '@', 'Alice', 'Smith', 'Bob', 'Jones', 'John Doe', 'jdoe', 'Dave', 'Frank', 'Grace', 'erin', 'carol',
      'Refund to card', 'Wrong fee', 'Card payments', 'Disk full', 'Rotate certificates', // titles
      'atlassian.net', 'linear.app', 'pagerduty.com', 'internal.example.com', 'http', // links
      '+353', '555', 'Payments (', 'High', // phone numbers, project names, priorities
      'description', 'comment', 'attachment', 'customfield', 'labels', 'components', 'assignee', 'reporter', 'creator', 'owner', 'responder', 'Hash',
    ];
    for (const bad of forbidden) assert.ok(!s.includes(bad), `"${bad}" must not appear in the output`);
  });

  test('every record carries only fields of both the shared allow-list and the send policy', () => {
    for (const p of [OFF, ON]) {
      for (const r of everything(p)) {
        const kind = 'statusCategory' in r || 'key' in r ? 'issue' : 'incident';
        const shared = new Set(FIELD_ALLOW_LIST[kind].map((f) => (f.person ? `${f.field}Hash` : f.field)));
        for (const k of Object.keys(r)) {
          assert.ok(shared.has(k), `${kind}.${k} on the shared allow-list`);
          assert.ok(k in SEND_POLICY[kind], `${kind}.${k} in the send policy`);
        }
      }
    }
  });

  test('opt-in: titles (e-mails and links masked), links and people hashes appear only when enabled', () => {
    const s = allStrings(everything(ON)).join('\n');
    assert.ok(s.includes('Refund to card fails for [email]'));
    assert.ok(s.includes('https://acme.atlassian.net/browse/PAY-101'));
    assert.match(s, /\b[0-9a-f]{32}\b/);
    for (const bad of ['Alice', 'alice@', 'frank@', 'erin@', 'dave@', 'SECRET-DESCRIPTION', 'SECRET-COMMENT']) assert.ok(!s.includes(bad), bad);
  });

  test('people are an HMAC with the customer salt, never the identity, and not the server-side hash', () => {
    const h = personHash('customer-salt-kept-on-premises', ' Alice@Example.com ');
    assert.equal(h, createHmac('sha256', 'customer-salt-kept-on-premises').update('alice@example.com').digest('hex').slice(0, 32));
    assert.notEqual(h, createHash('sha256').update('alice@example.com').digest('hex').slice(0, 32));
    assert.notEqual(h, personHash('another-salt-xxxxxxxxxxxx', 'alice@example.com'));
  });

  test('a raw person or e-mail that reaches the last step is dropped or refused, never sent', () => {
    const r = finalRecord('issue', { key: 'X-1', team: 't', type: 'bug', createdAt: '2026-11-01T00:00:00Z', assignee: { emailAddress: 'a@b.com' }, reporter: 'r@b.com', description: 'x' }, ON);
    assert.deepEqual(Object.keys(r).sort(), ['createdAt', 'key', 'team', 'type']);
    assert.throws(() => finalRecord('issue', { key: 'X-2', team: 't', status: 'Waiting for bob@example.com', createdAt: '2026-11-01T00:00:00Z' }, OFF), PrivacyViolation);
    assert.equal(maskTitle('Ping me at x.y@corp.io or https://wiki/x'), 'Ping me at [email] or [link]');
  });

  test('the send policy checks types: enums, ISO times, numbers, hex hashes', () => {
    const r = applyPolicy('issue', { key: 'K-1', type: 'weird', statusCategory: 'maybe', storyPoints: -3, createdAt: 'yesterday', environment: 'Production!', assigneeHash: 'not-hex', sprints: [{ id: 's', goal: 'SECRET' }] }, { people: true });
    assert.deepEqual(r, { key: 'K-1', sprints: [{ id: 's' }] });
  });
});

describe('Shared allow-list (server/lib/ingest/fieldAllowList.ts)', () => {
  const vendored = readFileSync(join(here, '..', 'src', 'vendor', 'fieldAllowList.ts'), 'utf8');
  const server = join(here, '..', '..', 'server', 'lib', 'ingest', 'fieldAllowList.ts');

  test('the vendored copy has no import other than crypto', () => {
    const imports = [...vendored.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    assert.deepEqual(imports.filter((m) => m !== 'crypto' && m !== 'node:crypto'), []);
  });

  test('the vendored copy is byte for byte the server file (in the monorepo)', { skip: !existsSync(server) && 'not in the monorepo' }, () => {
    const text = readFileSync(server, 'utf8');
    assert.ok(vendored.endsWith(text), 'run `npm run sync-allow-list` in exporter/');
    assert.ok(vendored.includes(createHash('sha256').update(text).digest('hex')));
  });

  test('the shared minimise drops what is not on the list', () => {
    const m = minimise('issue', { key: 'A-1', description: 'SECRET', comments: ['SECRET'], assignee: 'x@y.z', title: 'T' }, { storeTitles: false, salt: null });
    assert.deepEqual(m.record, { key: 'A-1' });
  });
});
