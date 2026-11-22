import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml, YamlError } from '../src/yaml';
import { loadConfig, parseConfig, secret, ConfigError } from '../src/config';
import { configureLog, log, redact, addSecret } from '../src/log';
import { parseArgs } from '../src/cli';
import { tmpDir } from './helpers';

const here = dirname(fileURLToPath(import.meta.url));

describe('YAML subset', () => {
  test('mappings, sequences of mappings, flow collections, quotes, comments, scalars', () => {
    const v = parseYaml(`
# comment
a: 1
b: "two # not a comment"
c: 'it''s'
d: [x, "y z", 3]
e: { k: v, n: 2 }
f:
  - name: one
    teams:
      PAY: team-1   # trailing comment
  - name: two
    list:
    - p
    - q
g: true
h: ~
url: https://example.com:8443/path#frag
jql: project = "PAY" AND labels != x
`);
    assert.deepEqual(v, {
      a: 1, b: 'two # not a comment', c: "it's", d: ['x', 'y z', 3], e: { k: 'v', n: 2 },
      f: [{ name: 'one', teams: { PAY: 'team-1' } }, { name: 'two', list: ['p', 'q'] }], g: true, h: null,
      url: 'https://example.com:8443/path#frag', jql: 'project = "PAY" AND labels != x',
    });
  });
  test('refuses what it does not support, with the line', () => {
    for (const [src, re] of [['a:\n\tb: 1', /tabs/], ['a: &x 1', /anchors/], ['a: |\n  text', /block scalars/], ['a: 1\na: 2', /duplicate key "a"/], ['a: 1\n  b: 2', /indentation/], ['---\na: 1\n---\nb: 2', /one YAML document/]] as const) {
      assert.throws(() => parseYaml(src), (e: any) => e instanceof YamlError && re.test(e.message), src);
    }
  });
  test('the example config parses', () => {
    const c = loadConfig(join(here, '..', 'config.example.yaml'));
    assert.deepEqual(c.sources.map((s) => s.type), ['github', 'jira', 'linear', 'pagerduty', 'opsgenie']);
    assert.equal(c.privacy.mode, 'evidence', 'evidence is the default privacy mode');
    assert.equal(c.qeNavigator.url, 'https://app.irongate.ie');
    assert.equal(c.privacy.sendTitles, false);
  });
});

describe('Config validation', () => {
  const base = { sources: [{ type: 'jira', baseUrl: 'https://x.atlassian.net', jql: 'project = A', teams: { A: 'team-a' } }] };
  test('defaults: Cloud detected from the host, env var names, limits', () => {
    const c = parseConfig(base);
    const j = c.sources[0] as any;
    assert.equal(j.deployment, 'cloud');
    assert.equal(j.tokenEnv, 'JIRA_TOKEN');
    assert.equal(c.qeNavigator.apiKeyEnv, 'QE_API_KEY');
    assert.equal(c.qeNavigator.requestsPerMinute, 50);
    assert.equal(c.privacy.people, 'none');
    assert.equal((parseConfig({ sources: [{ ...base.sources[0], baseUrl: 'https://jira.corp.example' }] }).sources[0] as any).deployment, 'server');
  });
  test('secrets in the file are refused; unknown keys are refused; http only for localhost', () => {
    for (const bad of [{ token: 'x' }, { apiKey: 'x' }, { password: 'x' }]) {
      assert.throws(() => parseConfig({ sources: [{ ...base.sources[0], ...bad }] }), /secrets are never read from the config file/);
    }
    assert.throws(() => parseConfig({ ...base, privacy: { salt: 'x' } }), /secrets are never read/);
    assert.throws(() => parseConfig({ ...base, qeNavigator: { apiKey: 'igk_x' } }), /secrets are never read/);
    assert.throws(() => parseConfig({ ...base, sendTitle: true }), /not a known setting/);
    assert.throws(() => parseConfig({ sources: [{ ...base.sources[0], baseUrl: 'http://jira.corp' }] }), /https/);
    assert.ok(parseConfig({ sources: [{ ...base.sources[0], baseUrl: 'http://jira.corp', allowHttp: true }] }));
    assert.throws(() => parseConfig({ ...base, qeNavigator: { url: 'http://app.irongate.ie' } }), /https/);
    assert.throws(() => parseConfig({ sources: [{ ...base.sources[0], baseUrl: 'https://u:p@x.atlassian.net' }] }), /credentials/);
    assert.throws(() => parseConfig({ sources: [{ ...base.sources[0], jql: 'project = A ORDER BY created' }] }), /ORDER BY/);
    assert.throws(() => parseConfig({ sources: [{ ...base.sources[0], teams: { A: 'bad team id!' } }] }), /team id/);
    assert.throws(() => parseConfig({ sources: [] }), ConfigError);
  });
  test('secrets from VAR or VAR_FILE, redacted from logs', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'tok'), 'file-secret-value\n');
    assert.equal(secret('X_TOKEN', { X_TOKEN: ' env-secret-value ' }), 'env-secret-value');
    assert.equal(secret('X_TOKEN', { X_TOKEN_FILE: join(dir, 'tok') }), 'file-secret-value');
    assert.equal(secret('X_TOKEN', {}), null);
    const lines: string[] = [];
    configureLog({ format: 'json', sink: (l) => lines.push(l) });
    log.info('using file-secret-value and env-secret-value', { token: 'abc', url: 'https://user:pw@proxy:8080', header: 'Bearer igk_abcdefghijk' });
    const out = lines.join('\n');
    assert.ok(!out.includes('file-secret-value') && !out.includes('env-secret-value') && !out.includes('pw@') && !out.includes('igk_abcdefghijk'));
    assert.match(out, /\[redacted\]/);
    addSecret('another-secret-1234');
    assert.equal(redact('x another-secret-1234 y'), 'x [redacted] y');
    configureLog({ format: 'text', sink: (l) => process.stderr.write(l + '\n') });
  });
});

describe('Command line', () => {
  test('commands and options', () => {
    const a = parseArgs(['sync', '--since', '2026-01-01', '-c', 'x.yaml', '--source=jira', '-v']);
    assert.equal(a.command, 'sync');
    assert.equal(a.since!.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(a.config, 'x.yaml');
    assert.equal(a.source, 'jira');
    assert.ok(a.verbose);
    assert.throws(() => parseArgs(['sync', '--since', 'last week']), /--since must be a date/);
    assert.throws(() => parseArgs(['sync', '--since', '2999-01-01']), /future/);
    assert.throws(() => parseArgs(['sync', '--bogus']), /Unknown option/);
    assert.ok(parseArgs(['preview', '--offline', '--out', 'p.json']).offline);
  });
});
