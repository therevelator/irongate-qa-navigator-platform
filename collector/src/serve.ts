/**
 * qe-collector serve: the local evidence page. In metrics mode no names leave your network, so QE Navigator's
 * "How this was calculated" links here (privacy.localEvidenceUrl) for the drill-down: per team the values and
 * the evidence behind them (flaky tests, lowest-coverage files, slowest and failing stages, failed deployments,
 * escaped issues), calculated from the local copy with the same engine.
 *
 * Read-only (GET and HEAD only), no external assets, no scripts (Content-Security-Policy default-src 'none'),
 * no cookies. Binds to serve.host (default 127.0.0.1); a wildcard address (0.0.0.0, ::) is refused unless basic
 * auth is set (QE_SERVE_USER and QE_SERVE_PASSWORD, compared in constant time).
 */
import http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import type { Config } from './config';
import { ConfigError, secret } from './config';
import { log } from './log';
import { LocalStore } from './store';
import { calculate, teamEvidence, dayOf, ENGINE_VERSION, METRICS } from './calc';
import { VERSION } from './version';

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fmt = (v: number, unit: string) => `${Math.round(v * 100) / 100}${unit === '%' ? ' %' : ` ${unit}`}`;

const CSS = `body{font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;margin:0;color:#0f172a;background:#f8fafc}
header{background:#0f172a;color:#fff;padding:14px 24px}header a{color:#fff;text-decoration:none}main{padding:20px 24px;max-width:1200px}
h1{font-size:18px;margin:0}h2{font-size:15px;margin:24px 0 8px}table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e2e8f0}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top}th{background:#f1f5f9;font-weight:600}
.n{text-align:right;font-variant-numeric:tabular-nums}.muted{color:#64748b}.card{background:#fff;border:1px solid #e2e8f0;padding:12px 16px;margin:8px 0}
code{font-family:ui-monospace,Menlo,monospace;font-size:12px}a{color:#1d4ed8}`;

function page(title: string, body: string, root = './'): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><header><h1><a href="${root}">QE Navigator Collector</a> · local evidence</h1><div class="muted">qe-collector ${esc(VERSION)} · engine ${esc(ENGINE_VERSION)} · read-only, from the local copy in your network</div></header><main>${body}</main></body></html>`;
}

function table(head: string[], rows: string[][], empty: string): string {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.join('')}</tr>`).join('')}</tbody></table>`;
}
const td = (v: unknown, cls = '') => `<td${cls ? ` class="${cls}"` : ''}>${esc(v)}</td>`;

export interface Served { url: string; close: () => Promise<void>; server: http.Server }

/** Start the page; resolves when it listens. */
export async function startServer(cfg: Config, env: NodeJS.ProcessEnv = process.env, opts: { port?: number } = {}): Promise<Served> {
  const user = secret(cfg.serve.userEnv, env);
  const password = secret(cfg.serve.passwordEnv, env);
  if ((user && !password) || (!user && password)) throw new ConfigError(`set both ${cfg.serve.userEnv} and ${cfg.serve.passwordEnv} for basic auth, or neither`);
  const auth = user && password ? { user, password } : null;
  const host = cfg.serve.host;
  if (['0.0.0.0', '::', '[::]', ''].includes(host) && !auth) {
    throw new ConfigError(`serve.host ${host || '(all interfaces)'} listens on every interface: set basic auth (${cfg.serve.userEnv}, ${cfg.serve.passwordEnv}) or bind to 127.0.0.1 or an internal address`);
  }
  const digest = (s: string) => createHash('sha256').update(s).digest();
  const expected = auth ? digest(`${auth.user}:${auth.password}`) : null;

  let cache: { at: number; store: LocalStore } | null = null;
  const storeNow = () => {
    if (!cache || Date.now() - cache.at > 60_000) {
      const s = new LocalStore(cfg.store.dir, cfg.store.retentionDays, cfg.store.detailDays, { memoryOnly: true });
      s.load();
      cache = { at: Date.now(), store: s };
    }
    return cache.store;
  };

  const server = http.createServer((req, res) => {
    const send = (status: number, body: string, type = 'text/html; charset=utf-8', extra: Record<string, string> = {}) => {
      res.writeHead(status, {
        'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'", ...extra,
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Read-only', 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' });
      if (expected) {
        const m = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(String(req.headers.authorization ?? ''));
        const given = m ? digest(Buffer.from(m[1], 'base64').toString('utf8')) : digest(`\u0000${Math.random()}`);
        if (!m || !timingSafeEqual(given, expected)) return send(401, page('Sign in', '<p>Sign in with the user and password of this page.</p>'), 'text/html; charset=utf-8', { 'WWW-Authenticate': 'Basic realm="QE Navigator Collector", charset="UTF-8"' });
      }
      const u = new URL(req.url ?? '/', 'http://local');
      if (u.pathname === '/healthz') return send(200, 'ok', 'text/plain; charset=utf-8');
      const store = storeNow();
      const allowed = new Set([...cfg.sources.flatMap((s) => [...Object.values(s.teams), ...('services' in s ? Object.values(s.services) : []), ...('deployJobs' in s ? Object.values(s.deployJobs) : []), ...(s.defaultTeam ? [s.defaultTeam] : [])])]);
      const teams = store.teams().filter((t) => allowed.has(t));
      const today = dayOf(Date.now());
      if (u.pathname === '/' || u.pathname === '') {
        const rows = teams.map((t) => {
          const m = calculate(store.records(t), [today], cfg.mainBranches[t] ?? null)[0].metrics;
          return [`<td><a href="team/${encodeURIComponent(t)}">${esc(t)}</a></td>`, td(m.length, 'n'), td(m.slice(0, 4).map((x) => `${METRICS[x.key]?.label ?? x.key}: ${fmt(x.value, METRICS[x.key]?.unit ?? '')}`).join(' · '))];
        });
        return send(200, page('Local evidence', `<p>Values as of ${esc(today)} (UTC), calculated here from ${store.count()} records. QE Navigator received ${cfg.privacy.mode === 'metrics' ? 'only the values and counts' : cfg.privacy.mode === 'evidence' ? 'the values and the allowed evidence lists' : 'the minimised raw records'}.</p>${table(['Team', 'Values', 'Some of them'], rows, 'No data in the local copy yet: run qe-collector sync.')}`));
      }
      const tm = /^\/team\/([^/]+)$/.exec(u.pathname);
      if (tm) {
        const team = decodeURIComponent(tm[1]);
        if (!teams.includes(team)) return send(404, page('Not found', '<p>No such team in the local copy.</p>', '../'));
        const recs = store.records(team);
        const main = cfg.mainBranches[team] ?? null;
        const metrics = calculate(recs, [today], main)[0].metrics;
        const ev = teamEvidence(recs, today, main);
        const src = (k: string) => metrics.find((m) => m.key === k)?.sources as Record<string, any> | undefined;
        const failed = (src('change_failure_rate')?.failedDeployments ?? []) as Array<{ externalId: string; reasons: Array<{ type: string; ref: string | null; at: string }> }>;
        const escaped = (src('escape_rate')?.escaped ?? []) as string[];
        const body = [
          `<p class="muted">Team <code>${esc(team)}</code>, as of ${esc(today)} (UTC).</p>`,
          '<h2>Values</h2>',
          table(['Metric', 'Value', 'Based on', 'Formula'], metrics.map((m) => [td(METRICS[m.key]?.label ?? m.key), td(fmt(m.value, METRICS[m.key]?.unit ?? ''), 'n'), td(m.sampleSize, 'n'), td(METRICS[m.key]?.formula ?? '', 'muted')]), 'No values for today.'),
          '<h2>Flaky tests (30 days)</h2>',
          table(['Test', 'Suite', 'Failed runs', 'Passed runs', 'Last seen'], ev.flakyTests.map((f) => [td(f.name), td(f.suite, 'muted'), td(f.failedRuns, 'n'), td(f.passedRuns, 'n'), td(f.lastSeen.slice(0, 16).replace('T', ' '))]), 'No flaky tests.'),
          '<h2>Lowest-coverage files (latest report)</h2>',
          table(['File', 'Lines hit / found', 'Coverage'], ev.lowestFiles.map((f) => [`<td><code>${esc(f.path)}</code></td>`, td(`${f.linesHit} / ${f.linesFound}`, 'n'), td(`${f.coverage} %`, 'n')]), 'No coverage report with files.'),
          '<h2>Slowest stages (30 days)</h2>',
          table(['Stage', 'Runs', 'Median', 'Longest', 'Slowest steps'], ev.slowestStages.map((s) => [td(s.name), td(s.runs, 'n'), td(`${s.medianSeconds} s`, 'n'), td(`${s.maxSeconds} s`, 'n'), td(s.slowestSteps.map((x) => `${x.name} (${x.medianSeconds} s)`).join(', '), 'muted')]), 'No pipeline stages.'),
          '<h2>Failing stages (30 days)</h2>',
          table(['Stage', 'Runs', 'Failed', 'Failure rate', 'Last failed runs'], ev.failingStages.map((s) => [td(s.name), td(s.runs, 'n'), td(s.failed, 'n'), td(`${s.failureRate} %`, 'n'), td(s.lastFailedRuns.map((r) => r.runId).join(', '), 'muted')]), 'No failing stages.'),
          '<h2>Failed deployments (28 days)</h2>',
          table(['Deployment', 'Why it failed'], failed.map((d) => [td(d.externalId), td(d.reasons.map((r) => `${r.type}${r.ref ? ` ${r.ref}` : ''} (${String(r.at).slice(0, 16).replace('T', ' ')})`).join('; '))]), 'No failed changes.'),
          '<h2>Escaped defects (28 days)</h2>',
          escaped.length ? `<div class="card">${escaped.map((k) => `<code>${esc(k)}</code>`).join(' · ')}</div>` : '<p class="muted">No bugs found in production.</p>',
        ].join('\n');
        return send(200, page(`Team ${team}`, body, '../'));
      }
      return send(404, page('Not found', '<p>Not found.</p>'));
    } catch (e) {
      log.error(`evidence page: ${(e as Error).message}`);
      return send(500, page('Error', '<p>The page could not be built; see the Collector log.</p>'));
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  const port = opts.port ?? cfg.serve.port;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host.replace(/^\[|\]$/g, ''), () => resolve()); });
  const a = server.address() as { address: string; port: number };
  const url = `http://${a.address.includes(':') ? `[${a.address}]` : a.address}:${a.port}/`;
  return { url, server, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

export async function runServe(cfg: Config, o: { env?: NodeJS.ProcessEnv } = {}): Promise<number> {
  const s = await startServer(cfg, o.env ?? process.env);
  log.info(`local evidence page on ${s.url} (read-only${secret(cfg.serve.userEnv, o.env ?? process.env) ? ', basic auth' : ''}); stop with Ctrl+C`);
  await new Promise<void>((resolve) => {
    const stop = () => { s.close().then(resolve); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}
