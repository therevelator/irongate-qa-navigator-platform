/**
 * The setup page (qe-exporter setup) and where credentials live: loopback only, the one-time token, the Host and
 * Origin checks, secrets kept in a 0600 file in a 0700 folder and never echoed, logged, previewed or put in the
 * diagnostics bundle; the context from QE Navigator; saving a source with its mapping and departments.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runSetup, bindAllowed } from '../src/setup';
import { configureLog } from '../src/log';
import { loadConfig } from '../src/config';
import { runPreview } from '../src/run';
import { diagnostics } from '../src/diagnose';
import { MockServer, tmpDir } from './helpers';

const lines: string[] = [];
configureLog({ sink: (l) => lines.push(l), verbose: true });

const API_KEY = 'igk_setup_test_key_0123456789abcdefghijklmnopqrstuv';
const GH_TOKEN = 'github_pat_setup_secret_value_987654321';

/** A raw request (to set Host / Origin / Cookie headers freely). */
function req(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string; json: any }> {
  return new Promise((ok, fail) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': String(data.length) } : {}), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json: any = null; try { json = JSON.parse(text); } catch { /* html */ } ok({ status: res.statusCode ?? 0, headers: res.headers, text, json }); });
    });
    r.on('error', fail);
    if (data) r.write(data);
    r.end();
  });
}

describe('setup page', () => {
  let dir: string;
  let qe: MockServer;
  let vendor: MockServer;
  let port = 0;
  let url = '';
  let close: () => void = () => {};
  let done: Promise<number>;
  let cookie = '';
  const printed: string[] = [];

  before(async () => {
    dir = tmpDir();
    qe = await new MockServer().start();
    qe.on('GET', '/api/ingest/exporter/context', (r) => {
      if (r.headers.authorization !== `Bearer ${API_KEY}`) return { status: 401, body: { error: 'Invalid or revoked API key' } };
      return { body: { company: { id: 'comp-9', name: 'Exporter Test Co' }, departments: [{ id: 'dep-pe', name: 'Platform Engineering', teams: [{ id: 'team-pay', name: 'Payments API' }, { id: 'team-mob', name: 'Mobile App' }] }, { id: 'dep-da', name: 'Data & Analytics', teams: [{ id: 'team-data', name: 'Data Pipeline' }] }] } };
    });
    vendor = await new MockServer().start();
    vendor.on('GET', '/repos/acme/pay', (r) => (r.headers.authorization === `Bearer ${GH_TOKEN}` ? { body: { private: true } } : { status: 401, body: { message: 'Bad credentials' } }));
    vendor.on('GET', '/repos/acme/pay/actions/runs', () => ({ body: { total_count: 3, workflow_runs: [] } }));
    vendor.on('GET', '/repos/acme/pay/environments', () => ({ body: { environments: [{ name: 'production' }] } }));
    await new Promise<void>((ready) => {
      done = runSetup({ configPath: join(dir, 'qe-exporter.json'), port: 0, env: {}, print: (l) => printed.push(l), onReady: (i) => { port = i.port; url = i.url; close = i.close; ready(); } });
    });
  });
  after(async () => { close(); await done; await qe.stop(); await vendor.stop(); });

  test('only loopback addresses may be used; 0.0.0.0 only inside a container when allowed', async () => {
    assert.ok(bindAllowed('127.0.0.1') && bindAllowed('::1') && bindAllowed('localhost'));
    for (const h of ['0.0.0.0', '192.168.1.10', '10.0.0.5', '::', 'example.com']) assert.equal(bindAllowed(h, {}), false, h);
    assert.equal(bindAllowed('0.0.0.0', { QE_EXPORTER_SETUP_IN_CONTAINER: '1' }), true);
    await assert.rejects(runSetup({ configPath: join(dir, 'x.json'), host: '0.0.0.0', port: 0, env: {} }), /loopback address only/);
    await assert.rejects(runSetup({ configPath: join(dir, 'x.json'), host: '192.168.1.10', port: 0, env: {} }), /loopback address only/);
  });

  test('the terminal shows a one-time link; without it every page and API is refused; a wrong token is refused', async () => {
    assert.match(printed.join('\n'), /http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]{20,}/);
    assert.equal((await req(port, 'GET', '/')).status, 401);
    assert.equal((await req(port, 'GET', '/api/state')).status, 401);
    assert.equal((await req(port, 'POST', '/api/key', {}, { apiKey: API_KEY })).status, 401);
    assert.equal((await req(port, 'GET', '/?token=wrong-token-value-000000000000')).status, 403);
    assert.equal((await req(port, 'GET', '/api/state', { Cookie: 'qe_setup=made-up-session-id-0000000000' })).status, 401);
  });

  test('a request for another Host name is refused (DNS rebinding), even with the token', async () => {
    const token = new URL(url).searchParams.get('token')!;
    const r = await req(port, 'GET', `/?token=${token}`, { Host: `evil.example.com:${port}` });
    assert.equal(r.status, 421);
  });

  test('the token works once and becomes an HttpOnly, SameSite=Strict session cookie', async () => {
    const path = new URL(url).pathname + new URL(url).search;
    const r = await req(port, 'GET', path);
    assert.equal(r.status, 303);
    const set = String(r.headers['set-cookie']);
    assert.match(set, /HttpOnly/);
    assert.match(set, /SameSite=Strict/);
    cookie = /qe_setup=[^;]+/.exec(set)![0];
    assert.equal((await req(port, 'GET', path)).status, 403, 'the link does not work a second time');
    const page = await req(port, 'GET', '/', { Cookie: cookie });
    assert.equal(page.status, 200);
    assert.match(page.text, /QE Navigator Exporter setup/);
    assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/);
  });

  test('a write from another origin is refused', async () => {
    const r = await req(port, 'POST', '/api/key', { Cookie: cookie, Origin: 'https://evil.example.com' }, { apiKey: API_KEY });
    assert.equal(r.status, 403);
  });

  test('the API key loads the company, departments and teams; secrets go to a 0600 file in a 0700 folder and are never echoed', async () => {
    const bad = await req(port, 'POST', '/api/key', { Cookie: cookie }, { apiKey: 'not-a-key', url: qe.url });
    assert.equal(bad.status, 400);
    const r = await req(port, 'POST', '/api/key', { Cookie: cookie }, { apiKey: API_KEY, url: qe.url });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.context.company.id, 'comp-9');
    assert.equal(r.json.companyId, 'comp-9');
    assert.equal(r.json.apiKeySet, true);
    assert.ok(!r.text.includes(API_KEY), 'the key is not echoed');

    const s = await req(port, 'POST', '/api/source', { Cookie: cookie }, {
      type: 'github', name: 'github', settings: { apiUrl: vendor.url, auth: 'token', environments: ['production'] }, secrets: { GITHUB_TOKEN: GH_TOKEN }, mapping: { 'acme/pay': 'team-pay' },
    });
    assert.equal(s.status, 200, s.text);
    assert.ok(!s.text.includes(GH_TOKEN));
    assert.deepEqual(s.json.state.sources[0].secrets.map((x: any) => [x.env, x.set]), [['GITHUB_TOKEN', true]]);

    const cfgText = readFileSync(join(dir, 'qe-exporter.json'), 'utf8');
    assert.ok(!cfgText.includes(GH_TOKEN) && !cfgText.includes(API_KEY), 'no secret in the config file');
    const cfgJson = JSON.parse(cfgText);
    assert.equal(cfgJson.qeNavigator.companyId, 'comp-9');
    assert.deepEqual(cfgJson.teams, { 'team-pay': 'dep-pe' }, 'the department of the mapped team, from the context');
    const credFile = join(dir, 'qe-exporter-credentials', 'credentials.json');
    assert.equal(statSync(credFile).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'qe-exporter-credentials')).mode & 0o777, 0o700);
    const creds = JSON.parse(readFileSync(credFile, 'utf8'));
    assert.equal(creds.values.GITHUB_TOKEN, GH_TOKEN);
    assert.equal(creds.values.QE_API_KEY, API_KEY);
  });

  test('test connection uses the stored token and answers without it', async () => {
    const r = await req(port, 'POST', '/api/test', { Cookie: cookie }, { name: 'github' });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true, r.text);
    assert.match(r.json.lines[0], /acme\/pay: private, 3 completed workflow runs; environments: production/);
    assert.ok(!r.text.includes(GH_TOKEN));
  });

  test('a secret typed as a setting is refused (secrets never go into the config)', async () => {
    const r = await req(port, 'POST', '/api/source', { Cookie: cookie }, { type: 'gitlab', name: 'gitlab', settings: { token: 'glpat-xyz' }, mapping: { 'g/p': 'team-mob' } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /secrets are never read from the config file/);
  });

  test('the saved config works for preview and diagnose; credentials appear in none of logs, preview or the bundle', async () => {
    vendor.on('GET', '/repos/acme/pay/deployments', () => ({ body: [] }));
    const cfg = loadConfig(join(dir, 'qe-exporter.json'));
    let out = '';
    await runPreview(cfg, { env: {}, out: (t) => { out += t; } });
    const report = JSON.parse(out);
    assert.equal(report.companyId, 'comp-9');
    const bundle = JSON.stringify(diagnostics(cfg, {}));
    assert.match(bundle, /"variable":"GITHUB_TOKEN","set":true,"from":"credentials file"/);
    for (const where of [out, bundle, lines.join('\n'), printed.join('\n')]) {
      assert.ok(!where.includes(GH_TOKEN), 'no tool token');
      assert.ok(!where.includes(API_KEY), 'no API key');
    }
    assert.ok(existsSync(cfg.credentialsPath));
  });
});
