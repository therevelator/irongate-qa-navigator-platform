import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { request, requestWithRetry, retryAfterMs, noProxy, proxyFor, HttpError } from '../src/http';
import { MockServer, tmpDir } from './helpers';

describe('Retries and backoff', () => {
  let s: MockServer;
  let n = 0;
  before(async () => {
    s = await new MockServer().start();
    s.on('GET', '/flaky', () => (++n <= 2 ? { status: 503 } : { body: { ok: true } }))
      .on('GET', '/limited', () => ({ status: 429, headers: { 'Retry-After': '7' } }))
      .on('GET', '/bad', () => ({ status: 400, body: { error: 'no' } }))
      .on('GET', '/slow', async () => { await new Promise((r) => setTimeout(r, 400)); return { body: {} }; });
  });
  after(() => s.stop());

  test('5xx retried with exponential backoff and jitter until success', async () => {
    const waits: number[] = [];
    const r = await requestWithRetry({ url: `${s.url}/flaky` }, { maxRetries: 5, baseMs: 1000, sleep: async (ms) => { waits.push(ms); }, random: () => 0.5 });
    assert.equal(r.status, 200);
    assert.deepEqual(waits, [600, 1100]);
  });

  test('429 waits for Retry-After (capped), gives up after maxRetries and returns the last answer', async () => {
    const waits: number[] = [];
    const r = await requestWithRetry({ url: `${s.url}/limited` }, { maxRetries: 2, maxWaitMs: 5000, sleep: async (ms) => { waits.push(ms); }, random: () => 0 });
    assert.equal(r.status, 429);
    assert.deepEqual(waits, [5000, 5000]);
  });

  test('4xx other than 408 / 429 is not retried', async () => {
    const before = s.count('/bad');
    assert.equal((await requestWithRetry({ url: `${s.url}/bad` }, { sleep: async () => {} })).status, 400);
    assert.equal(s.count('/bad') - before, 1);
  });

  test('timeouts on every request', async () => {
    await assert.rejects(request({ url: `${s.url}/slow`, timeoutMs: 100 }), (e: any) => e instanceof HttpError && e.code === 'ETIMEDOUT');
  });

  test('Retry-After as seconds or a date; RateLimit-Reset', () => {
    const now = Date.parse('2026-11-20T10:00:00Z');
    assert.equal(retryAfterMs({ 'retry-after': '3' }, now), 3000);
    assert.equal(retryAfterMs({ 'retry-after': 'Fri, 20 Nov 2026 10:00:10 GMT' }, now), 10_000);
    assert.equal(retryAfterMs({ 'ratelimit-reset': '12' }, now), 12_000);
    assert.equal(retryAfterMs({ 'x-ratelimit-reset': String(now / 1000 + 5) }, now), 5000);
    assert.equal(retryAfterMs({}, now), null);
  });
});

describe('Proxy settings', () => {
  test('NO_PROXY: *, exact host, domain suffix, host:port', () => {
    const env = { NO_PROXY: 'localhost,.corp.example,jira.internal:8443' };
    assert.ok(noProxy('localhost', 443, env));
    assert.ok(noProxy('a.corp.example', 443, env));
    assert.ok(noProxy('corp.example', 443, env));
    assert.ok(noProxy('jira.internal', 8443, env));
    assert.ok(!noProxy('jira.internal', 443, env));
    assert.ok(!noProxy('app.irongate.ie', 443, env));
    assert.ok(noProxy('anything', 1, { NO_PROXY: '*' }));
    assert.ok(noProxy('10.1.2.3', 443, { NO_PROXY: '10.0.0.0/8' }));
    assert.ok(!noProxy('11.1.2.3', 443, { NO_PROXY: '10.0.0.0/8' }));
    assert.ok(noProxy('api.svc.cluster.local', 443, { NO_PROXY: '*.svc.cluster.local' }));
    assert.equal(proxyFor(new URL('https://app.irongate.ie'), { HTTPS_PROXY: 'http://proxy:3128' })!.host, 'proxy:3128');
    assert.equal(proxyFor(new URL('https://a.corp.example'), { HTTPS_PROXY: 'http://proxy:3128', NO_PROXY: '.corp.example' }), null);
    assert.equal(proxyFor(new URL('https://x'), {}), null);
  });
});

const hasOpenssl = (() => { try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

describe('TLS with a private CA through an HTTPS proxy (CONNECT)', { skip: !hasOpenssl && 'openssl not available' }, () => {
  let dir: string;
  let tlsServer: https.Server;
  let proxy: http.Server;
  let tlsPort = 0;
  let proxyPort = 0;
  const tunnels: string[] = [];
  const proxyAuth: string[] = [];
  const sockets = new Set<net.Socket>();
  before(async () => {
    dir = tmpDir();
    const o = (args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
    o(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=Test Private CA']);
    o(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'srv.key', '-out', 'srv.csr', '-subj', '/CN=localhost']);
    const ext = join(dir, 'ext.cnf');
    writeFileSync(ext, 'subjectAltName=DNS:localhost\n');
    o(['x509', '-req', '-in', 'srv.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'srv.pem', '-days', '2', '-extfile', ext]);
    tlsServer = https.createServer({ key: readFileSync(join(dir, 'srv.key')), cert: readFileSync(join(dir, 'srv.pem')) }, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"tls":true}'); });
    await new Promise<void>((r) => tlsServer.listen(0, '127.0.0.1', () => r()));
    tlsPort = (tlsServer.address() as net.AddressInfo).port;
    proxy = http.createServer();
    proxy.on('connect', (req, client, head) => {
      sockets.add(client as net.Socket);
      tunnels.push(String(req.url));
      proxyAuth.push(String(req.headers['proxy-authorization'] ?? ''));
      const [, port] = String(req.url).split(':');
      const up = net.connect(Number(port), '127.0.0.1', () => {
        sockets.add(up); client.write('HTTP/1.1 200 Connection established\r\n\r\n'); up.write(head); up.pipe(client); client.pipe(up); });
      up.on('error', () => client.destroy());
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()));
    proxyPort = (proxy.address() as net.AddressInfo).port;
  });
  after(async () => { for (const so of sockets) so.destroy(); tlsServer.closeAllConnections(); tlsServer.close(); proxy.closeAllConnections(); proxy.close(); });

  test('without the CA bundle the certificate is refused (verification is never turned off)', async () => {
    await assert.rejects(request({ url: `https://localhost:${tlsPort}/`, env: {} }), /certificate|self.signed|unable to verify/i);
  });

  test('with the CA bundle: direct, and through HTTPS_PROXY with proxy credentials (redacted)', async () => {
    const ca = readFileSync(join(dir, 'ca.pem'), 'utf8');
    const direct = await request({ url: `https://localhost:${tlsPort}/`, ca, env: {} });
    assert.deepEqual(direct.json(), { tls: true });
    const via = await request({ url: `https://localhost:${tlsPort}/x`, ca, env: { HTTPS_PROXY: `http://agent:proxy-pass@127.0.0.1:${proxyPort}` } });
    assert.deepEqual(via.json(), { tls: true });
    assert.deepEqual(tunnels, [`localhost:${tlsPort}`]);
    assert.equal(proxyAuth[0], 'Basic ' + Buffer.from('agent:proxy-pass').toString('base64'));
    const skipped = await request({ url: `https://localhost:${tlsPort}/y`, ca, env: { HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: 'localhost' } });
    assert.equal(skipped.status, 200);
    assert.equal(tunnels.length, 1, 'NO_PROXY bypasses the proxy');
  });
});
