/**
 * qe-exporter setup: a local web page to set the Exporter up without editing files.
 *
 * Security:
 *   - it listens on a loopback address only (127.0.0.1, ::1 or localhost); any other address is refused. Inside a
 *     container (where the page must listen on the container's own interface to be published) 0.0.0.0 is accepted
 *     only with QE_EXPORTER_SETUP_IN_CONTAINER=1, and the port must then be published to 127.0.0.1 on the host
 *     (docker run -p 127.0.0.1:8788:8788 …; the compose file does that);
 *   - it is protected by a one-time token printed in the terminal: the first visit with ?token=… exchanges it for a
 *     session cookie (HttpOnly, SameSite=Strict) and the token stops working; without the token or the cookie every
 *     page and API answers 401 (a wrong token 403). Requests with a Host header other than the loopback address and
 *     port, and writes from another Origin, are refused (DNS rebinding, cross-site requests);
 *   - secrets typed on the page go to the credentials file only (0600 in a 0700 folder, credentials.ts); they are
 *     never logged, never echoed back to the page (it shows "set") and never sent to QE Navigator (the API key is
 *     used only as the Authorization header of requests to QE Navigator).
 *
 * What it does: enter the QE Navigator API key (the page loads the key's company, departments and teams), connect
 * each tool (token, app password, service account, or OAuth with the customer's own OAuth app), test the connection,
 * map each repository / project / pipeline / service to a department and team, and save the config file (JSON, also
 * valid YAML: the file stays editable by hand) next to the credentials file.
 */
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ConfigError, DEFAULT_TOKEN_ENV, MAP_KEY, SOURCE_TYPES, parseConfig, secret, type Config, type SourceType } from './config';
import { credentialEntry, credentialNames, loadCredentials, setCredential } from './credentials';
import { log, redact } from './log';
import { parseYaml } from './yaml';
import { QeClient, type ExporterContext } from './sender';
import { adapterFor } from './run';
import { finishAuthorization, providerFor, startAuthorization, type PendingAuth } from './oauth';
import { VERSION } from './version';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export interface SetupOptions {
  configPath: string; host?: string | null; port?: number | null; env?: NodeJS.ProcessEnv; print?: (line: string) => void; token?: string;
  /** Called once the page listens (tests): its URL with the token, and a function that stops it. */
  onReady?: (info: { url: string; port: number; close: () => void }) => void;
}

/** Is this a loopback address the setup page may listen on (0.0.0.0 only inside a container, when allowed)? */
export function bindAllowed(host: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (LOOPBACK.has(host)) return true;
  return host === '0.0.0.0' && env.QE_EXPORTER_SETUP_IN_CONTAINER === '1';
}

/** The setup secrets a source type needs, by its auth: [env var, label]. */
export function secretsOf(type: SourceType, auth: string | null): Array<{ env: string; label: string; multiline?: boolean }> {
  const d = DEFAULT_TOKEN_ENV[type];
  switch (type) {
    case 'github': return auth === 'app' ? [{ env: 'GITHUB_APP_PRIVATE_KEY', label: 'GitHub App private key (PEM)', multiline: true }] : auth === 'oauth' ? [] : [{ env: d, label: 'Fine-grained token (Actions, Contents, Deployments, Metadata: read)' }];
    case 'gitlab': return auth === 'oauth' ? [] : [{ env: d, label: 'Access token (scope read_api)' }];
    case 'bitbucket': return auth === 'oauth' ? [] : [{ env: 'BITBUCKET_USERNAME', label: 'Bitbucket username' }, { env: d, label: 'App password (Account, Repositories, Pipelines: Read)' }];
    case 'bitbucket-dc': return [{ env: d, label: 'HTTP access token (Read)' }];
    case 'jenkins': return [{ env: 'JENKINS_USER', label: 'Jenkins user' }, { env: d, label: 'API token of that user' }];
    case 'azure-devops': return [{ env: d, label: 'Personal access token (Build, Test Management, Code, Environment: Read)' }];
    case 'sonarqube': return [{ env: d, label: 'User token (Browse)' }];
    case 'jira': return auth === 'bearer' ? [{ env: d, label: 'Personal access token (Server / Data Center)' }] : [{ env: 'JIRA_EMAIL', label: 'Atlassian account e-mail (service account)' }, { env: d, label: 'API token' }];
    case 'linear': return auth === 'oauth' ? [] : [{ env: d, label: 'Personal API key (read)' }];
    case 'pagerduty': return [{ env: d, label: 'Read-only REST API key' }];
    case 'opsgenie': return [{ env: d, label: 'API key (Read access only)' }];
    default: return [];
  }
}

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Read the config file as plain data (or a minimal one when there is none yet). */
function readRaw(path: string): Record<string, any> {
  if (!existsSync(path)) return { qeNavigator: { url: process.env.QE_NAVIGATOR_URL || 'https://app.irongate.ie' }, teams: {}, state: { path: join(dirname(resolve(path)), 'qe-exporter-state.json') }, sources: [] };
  const text = readFileSync(path, 'utf8');
  return /\.json$/i.test(path) || /^\s*[{[]/.test(text) ? JSON.parse(text) : (parseYaml(text) as Record<string, any>);
}

/** The draft as a validated config (sources may be empty while setting up). */
function validate(raw: Record<string, any>, path: string): Config {
  const withSource = raw.sources?.length ? raw : { ...raw, sources: [{ type: 'kpis', name: 'placeholder', path: '/dev/null', defaultTeam: 'placeholder' }] };
  const cfg = parseConfig(withSource, path);
  if (process.env.QE_NAVIGATOR_URL) cfg.qeNavigator.url = process.env.QE_NAVIGATOR_URL.replace(/\/+$/, '');
  return cfg;
}

export async function runSetup(o: SetupOptions): Promise<number> {
  const env = o.env ?? process.env;
  const print = o.print ?? ((l: string) => process.stdout.write(l + '\n'));
  const host = o.host ?? (env.QE_EXPORTER_SETUP_IN_CONTAINER === '1' ? '0.0.0.0' : '127.0.0.1');
  if (!bindAllowed(host, env)) throw new ConfigError(`The setup page listens on a loopback address only (127.0.0.1, ::1 or localhost), not ${host}`);
  const port = o.port ?? 8788;
  const configPath = resolve(o.configPath);
  let raw = readRaw(configPath);
  const credentialsPath = () => validate(raw, configPath).credentialsPath;
  loadCredentials(credentialsPath());
  const token = o.token ?? randomBytes(24).toString('base64url');
  let tokenUsed = false;
  const sessions = new Set<string>();
  const pending = new Map<string, PendingAuth>();
  let context: ExporterContext | null = null;
  const publicHost = host === '0.0.0.0' || host === '::1' ? (host === '::1' ? '[::1]' : '127.0.0.1') : host;
  const allowedHosts = new Set<string>();
  let redirectUri = '';
  let livePort = port;

  const qe = () => {
    const cfg = validate(raw, configPath);
    return new QeClient(cfg, secret(cfg.qeNavigator.apiKeyEnv, env));
  };
  const save = () => {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n', { mode: 0o600 });
  };
  const stateOf = () => {
    const cfg = validate(raw, configPath);
    const names = new Set(credentialNames());
    return {
      version: VERSION, configPath, credentialsPath: cfg.credentialsPath, url: cfg.qeNavigator.url, companyId: cfg.qeNavigator.companyId, teams: cfg.teams,
      apiKeySet: names.has(cfg.qeNavigator.apiKeyEnv) || !!env[cfg.qeNavigator.apiKeyEnv], context, fakeVendors: !!env.QE_EXPORTER_FAKE_VENDORS,
      types: SOURCE_TYPES.filter((t) => t !== 'kpis').map((t) => ({ type: t, mapKey: MAP_KEY[t] ?? 'teams', oauth: !!providerFor({ type: t }) })),
      sources: (raw.sources ?? []).map((s: any) => {
        const auth = s.auth ?? null;
        const tokenEnv = s.tokenEnv ?? DEFAULT_TOKEN_ENV[s.type as SourceType];
        const secrets = secretsOf(s.type, auth).map((x) => ({ ...x, env: x.env === DEFAULT_TOKEN_ENV[s.type as SourceType] ? tokenEnv : x.env, set: names.has(x.env === DEFAULT_TOKEN_ENV[s.type as SourceType] ? tokenEnv : x.env) || !!env[x.env] }));
        const oauthEntry = credentialEntry(tokenEnv);
        return { ...s, secrets, oauthConnected: !!oauthEntry && typeof oauthEntry === 'object', oauthProvider: providerFor({ type: s.type, apiUrl: s.apiUrl }) };
      }),
    };
  };

  const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer', ...headers,
    });
    res.end(text);
  };
  const readJson = (req: http.IncomingMessage): Promise<any> => new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => { n += c.length; if (n > 256 * 1024) { fail(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { fail(new Error('The body must be JSON')); } });
    req.on('error', fail);
  });
  const sessionOf = (req: http.IncomingMessage) => /(?:^|;\s*)qe_setup=([A-Za-z0-9_-]{20,})/.exec(String(req.headers.cookie ?? ''))?.[1] ?? null;

  const upsertSource = (body: any) => {
    const type = String(body?.type ?? '') as SourceType;
    if (!SOURCE_TYPES.includes(type)) throw new ConfigError('Choose a tool');
    const name = String(body?.name || type).toLowerCase();
    const settings = body?.settings && typeof body.settings === 'object' ? body.settings : {};
    const mapKey = MAP_KEY[type] ?? 'teams';
    const entry: Record<string, unknown> = { ...settings, type, name };
    if (name !== type && !settings.tokenEnv) entry.tokenEnv = `${DEFAULT_TOKEN_ENV[type]}_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`.slice(0, 64);
    if (body?.mapping && typeof body.mapping === 'object') entry[mapKey] = body.mapping;
    const next = { ...raw, sources: [...(raw.sources ?? []).filter((s: any) => s.name !== name), entry] };
    validate(next, configPath); // refuses unknown settings, secrets in the config, bad URLs and team ids
    // Secrets go to the credentials file only (never into the config).
    const tokenEnv = String(entry.tokenEnv ?? DEFAULT_TOKEN_ENV[type]);
    for (const s of secretsOf(type, (entry.auth as string) ?? null)) {
      const envName = s.env === DEFAULT_TOKEN_ENV[type] ? tokenEnv : s.env;
      const v = body?.secrets?.[s.env] ?? body?.secrets?.[envName];
      if (typeof v === 'string' && v.trim()) setCredential(credentialsPath(), envName, v.trim());
    }
    raw = next;
    // The department of every team the mappings use, from the key's context.
    raw.teams = { ...(raw.teams ?? {}) };
    if (context) for (const t of [...Object.values(entry[mapKey] ?? {}), ...Object.values((entry.services as Record<string, string>) ?? {})] as string[]) {
      const dep = context.departments.find((d) => d.teams.some((x) => x.id === t));
      if (dep) raw.teams[t] = dep.id;
    }
    save();
    return name;
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const u = new URL(req.url ?? '/', `http://${publicHost}:${livePort}`);
    if (!allowedHosts.has(String(req.headers.host ?? ''))) return send(res, 421, { error: 'Open the setup page at http://127.0.0.1:' + livePort });
    // Sign-in: the one-time token becomes a session cookie.
    if (req.method === 'GET' && u.pathname === '/' && u.searchParams.has('token')) {
      const given = u.searchParams.get('token') ?? '';
      if (tokenUsed || !safeEq(given, token)) return send(res, 403, page('<p>This link is not valid (wrong token, or it was already used). Restart <code>qe-exporter setup</code> for a new one.</p>'));
      tokenUsed = true;
      const sid = randomBytes(24).toString('base64url');
      sessions.add(sid);
      return send(res, 303, '', { Location: '/', 'Set-Cookie': `qe_setup=${sid}; HttpOnly; SameSite=Strict; Path=/` });
    }
    const sid = sessionOf(req);
    if (!sid || !sessions.has(sid)) {
      return u.pathname.startsWith('/api/') ? send(res, 401, { error: 'Open the link with the token printed in the terminal' }) : send(res, 401, page('<p>Open the link printed in the terminal where <code>qe-exporter setup</code> runs (it carries a one-time token).</p>'));
    }
    if (req.method !== 'GET') {
      const origin = String(req.headers.origin ?? '');
      if (origin && !allowedHosts.has(origin.replace(/^http:\/\//, ''))) return send(res, 403, { error: 'Cross-origin request refused' });
    }
    try {
      if (req.method === 'GET' && u.pathname === '/') return send(res, 200, page(APP));
      if (req.method === 'GET' && u.pathname === '/api/state') return send(res, 200, stateOf());
      if (req.method === 'POST' && u.pathname === '/api/key') {
        const b = await readJson(req);
        if (typeof b.url === 'string' && b.url.trim()) { raw.qeNavigator = { ...(raw.qeNavigator ?? {}), url: b.url.trim() }; validate(raw, configPath); }
        const cfg = validate(raw, configPath);
        if (typeof b.apiKey === 'string' && b.apiKey.trim()) {
          if (!b.apiKey.trim().startsWith('igk_')) return send(res, 400, { error: 'A QE Navigator API key starts with igk_ (Admin console → API keys)' });
          setCredential(cfg.credentialsPath, cfg.qeNavigator.apiKeyEnv, b.apiKey.trim());
        }
        context = await qe().context();
        raw.qeNavigator = { ...(raw.qeNavigator ?? {}), companyId: context.company.id };
        save();
        return send(res, 200, stateOf());
      }
      if (req.method === 'POST' && u.pathname === '/api/source') {
        const name = upsertSource(await readJson(req));
        return send(res, 200, { ok: true, name, state: stateOf() });
      }
      if (req.method === 'POST' && u.pathname === '/api/demo') {
        // Test only: every source, pointing at the fake vendors (QE_EXPORTER_FAKE_VENDORS), with fake credentials.
        const fv = env.QE_EXPORTER_FAKE_VENDORS;
        if (!fv) return send(res, 404, { error: 'Not available' });
        if (!context) return send(res, 400, { error: 'Save the API key first: the fake sources are mapped to your teams' });
        for (const body of demoSources(fv, context, env.QE_EXPORTER_FAKE_KPIS ?? '/shared/kpis.json')) upsertSource(body);
        raw.backfillDays = 180;
        save();
        return send(res, 200, stateOf());
      }
      if (req.method === 'POST' && u.pathname === '/api/source/delete') {
        const b = await readJson(req);
        raw.sources = (raw.sources ?? []).filter((s: any) => s.name !== b.name);
        save();
        return send(res, 200, stateOf());
      }
      if (req.method === 'POST' && u.pathname === '/api/test') {
        const b = await readJson(req);
        const cfg = validate(raw, configPath);
        const src = cfg.sources.find((s) => s.name === b.name);
        if (!src) return send(res, 404, { error: 'No such source' });
        try {
          const a = adapterFor(src, cfg, { privacy: cfg.privacy, salt: null }, env);
          return send(res, 200, { ok: true, lines: (await a.check()).map(redact) });
        } catch (e) {
          return send(res, 200, { ok: false, error: redact((e as Error).message) });
        }
      }
      if (req.method === 'POST' && u.pathname === '/api/oauth/start') {
        const b = await readJson(req);
        const s = (raw.sources ?? []).find((x: any) => x.name === b.name);
        const provider = s ? providerFor({ type: s.type, apiUrl: s.apiUrl }) : null;
        if (!s || !provider) return send(res, 400, { error: 'This tool has no OAuth sign-in for your own app' });
        if (typeof b.clientId !== 'string' || !b.clientId.trim() || typeof b.clientSecret !== 'string' || !b.clientSecret.trim()) return send(res, 400, { error: 'Enter your OAuth app client id and secret' });
        const started = startAuthorization(provider, b.clientId.trim(), b.clientSecret.trim(), redirectUri, s.tokenEnv ?? DEFAULT_TOKEN_ENV[s.type as SourceType]);
        pending.set(started.pending.state, started.pending);
        return send(res, 200, { url: started.url, redirectUri });
      }
      if (req.method === 'GET' && u.pathname === '/oauth/callback') {
        const p = pending.get(u.searchParams.get('state') ?? '');
        if (!p) return send(res, 400, page('<p>This sign-in is not known (state mismatch). Start it again from the setup page.</p>'));
        pending.delete(p.state);
        if (u.searchParams.get('error')) return send(res, 400, page(`<p>The sign-in was refused: ${esc(u.searchParams.get('error') ?? '')}</p><p><a href="/">Back</a></p>`));
        await finishAuthorization(p, u.searchParams.get('code') ?? '', credentialsPath(), validate(raw, configPath).http.caFile);
        return send(res, 303, '', { Location: '/?connected=1' });
      }
      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      const msg = redact((e as Error).message);
      return send(res, e instanceof ConfigError ? 400 : 502, { error: msg });
    }
  };

  const server = http.createServer((req, res) => { handle(req, res).catch((e) => send(res, 500, { error: redact((e as Error).message) })); });
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(port, host, () => ok()); });
  const addr = server.address() as { port: number };
  livePort = addr.port;
  for (const h of ['127.0.0.1', 'localhost', '[::1]']) allowedHosts.add(`${h}:${addr.port}`);
  redirectUri = `http://127.0.0.1:${addr.port}/oauth/callback`;
  print(`qe-exporter ${VERSION} setup page: open this link in a browser on this machine (it works once):`);
  print(`  http://127.0.0.1:${addr.port}/?token=${token}`);
  print(`Config file: ${configPath}; credentials: ${credentialsPath()} (0600). Press Ctrl+C to stop.`);
  log.debug('setup page listening', { host, port: addr.port });
  await new Promise<void>((ok) => {
    const stop = () => { server.closeAllConnections(); server.close(() => ok()); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    o.onReady?.({ url: `http://127.0.0.1:${addr.port}/?token=${token}`, port: addr.port, close: () => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); stop(); } });
  });
  return 0;
}

/**
 * The test preset (fake vendors only): GitHub (two repositories), GitLab, Bitbucket, Jira, PagerDuty, SonarQube and the
 * KPI file, with fake credentials, each data set mapped to the team whose name fits (Payments, Mobile, Data,
 * Reporting), else to the company's teams in order. Every mapping can be changed on the page afterwards.
 */
export function demoSources(fv: string, ctx: ExporterContext, kpiFile: string): any[] {
  const teams = ctx.departments.flatMap((d) => d.teams);
  if (!teams.length) throw new ConfigError('Your company has no active team to map the fake data to');
  const pick = (re: RegExp, i: number) => (teams.find((t) => re.test(t.name)) ?? teams[i % teams.length]).id;
  const T = { payments: pick(/payment/i, 0), mobile: pick(/mobile/i, 1), data: pick(/data|pipeline/i, 2), reporting: pick(/report/i, 3) };
  const base = fv.replace(/\/+$/, '');
  return [
    { type: 'github', name: 'github', settings: { apiUrl: `${base}/github`, auth: 'token', environments: ['production'] }, secrets: { GITHUB_TOKEN: 'fake-github-token' }, mapping: { 'acme/payments-api': T.payments, 'acme/mobile-app': T.mobile } },
    { type: 'gitlab', name: 'gitlab', settings: { apiUrl: `${base}/gitlab/api/v4`, environments: ['production'] }, secrets: { GITLAB_TOKEN: 'fake-gitlab-token' }, mapping: { 'analytics/data-pipeline': T.data } },
    { type: 'bitbucket', name: 'bitbucket', settings: { apiUrl: `${base}/bitbucket/2.0`, auth: 'app-password', environments: ['production'] }, secrets: { BITBUCKET_USERNAME: 'fake-user', BITBUCKET_APP_PASSWORD: 'fake-app-password' }, mapping: { 'analytics/reporting': T.reporting } },
    { type: 'jira', name: 'jira', settings: { baseUrl: `${base}/jira`, deployment: 'cloud', auth: 'basic', allowHttp: true, jql: 'project in (PAY, MOB, DATA, REP)', fields: { environment: 'customfield_10060' } }, secrets: { JIRA_EMAIL: 'fake-account', JIRA_TOKEN: 'fake-jira-token' }, mapping: { PAY: T.payments, MOB: T.mobile, DATA: T.data, REP: T.reporting } },
    { type: 'pagerduty', name: 'pagerduty', settings: { apiUrl: `${base}/pagerduty`, services: { 'payments-api': T.payments, 'mobile-backend': T.mobile, 'data-pipeline': T.data, 'reporting-service': T.reporting }, categories: { 'mobile-backend': 'infrastructure', 'data-pipeline': 'infrastructure', 'payments-api': 'application', 'reporting-service': 'application' } }, secrets: { PAGERDUTY_TOKEN: 'fake-pagerduty-token' } },
    { type: 'sonarqube', name: 'sonarqube', settings: { baseUrl: `${base}/sonar`, allowHttp: true }, secrets: { SONAR_TOKEN: 'fake-sonar-token' }, mapping: { 'payments-api': T.payments, 'mobile-app': T.mobile, 'data-pipeline': T.data, reporting: T.reporting } },
    { type: 'kpis', name: 'kpis', settings: { path: kpiFile }, mapping: { payments: T.payments, mobile: T.mobile, data: T.data, reporting: T.reporting } },
  ];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QE Navigator Exporter setup</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:0;background:#f8fafc;color:#0f172a}main{max-width:960px;margin:0 auto;padding:24px}h1{font-size:20px}h2{font-size:16px;margin-top:28px}
section{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:12px 0}label{display:block;margin:6px 0 2px;font-size:12px;color:#475569}input,select,textarea{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font:inherit}
button{padding:6px 12px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#fff;cursor:pointer;margin:8px 8px 0 0}button.secondary{background:#fff;color:#0f172a}
.row{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end}.ok{color:#15803d}.bad{color:#b91c1c}code{background:#f1f5f9;padding:1px 4px;border-radius:4px}small{color:#64748b}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e2e8f0;padding:4px;text-align:left;font-size:13px}</style></head>
<body><main><h1>QE Navigator Exporter setup</h1>${body}</main></body></html>`;
}

/** The page's script: plain JavaScript, no external resources. */
const APP = `<p><small>Everything you enter stays on this machine: secrets go to the credentials file (0600), never to QE Navigator. The Exporter sends the raw data your tools hold; QE Navigator calculates.</small></p>
<section id="key"><h2>1. QE Navigator API key</h2>
<label for="url">QE Navigator address</label><input id="url" placeholder="https://app.irongate.ie">
<label for="apikey">API key (Admin console → API keys → Create)</label><input id="apikey" type="password" autocomplete="off" placeholder="igk_…">
<button id="savekey">Save key and load my company</button><div id="keymsg"></div><div id="ctx"></div></section>
<section id="demo" style="display:none"><h2>Test data</h2><p>This Exporter runs next to the fake vendors (made-up GitHub, GitLab, Bitbucket, Jira, PagerDuty and SonarQube data, with fake credentials). One click adds every one of them, mapped to your teams by name (Payments, Mobile, Data, Reporting; else in order). You can change each mapping below.</p><button id="demobtn">Connect the fake vendors</button><div id="demomsg"></div></section>
<section id="add"><h2>2. Connect a tool</h2>
<label for="type">Tool</label><select id="type"></select>
<label for="name">Name (letters, digits, - or _)</label><input id="name" placeholder="github">
<div id="fields"></div><div id="secrets"></div>
<h3 style="font-size:14px">Map each source to a team</h3><div id="map"></div><button class="secondary" id="addrow">Add a row</button>
<div><button id="savesrc">Save this tool</button></div><div id="srcmsg"></div></section>
<section id="list"><h2>3. Your tools</h2><div id="sources"></div></section>
<section><h2>4. Next</h2><p>Run <code>qe-exporter preview</code> to see exactly what would be sent (nothing is sent), then <code>qe-exporter sync</code>.</p></section>
<script>
const FIELDS={github:[['apiUrl','API URL (GitHub Enterprise: https://host/api/v3)','https://api.github.com'],['auth','Sign-in','token|app|oauth'],['appId','GitHub App id (auth app)',''],['installationId','Installation id (auth app)',''],['environments','Production environments (comma separated)','production']],
gitlab:[['apiUrl','API URL','https://gitlab.com/api/v4'],['auth','Sign-in','token|oauth'],['environments','Production environments','production']],
bitbucket:[['auth','Sign-in','app-password|oauth'],['environments','Production environments','production']],
'bitbucket-dc':[['baseUrl','Bitbucket Data Center URL','https://bitbucket.example.com'],['environments','Production environments','production']],
jenkins:[['baseUrl','Jenkins URL','https://jenkins.example.com']],
'azure-devops':[['orgUrl','Organization URL','https://dev.azure.com/your-org'],['project','Project',''],['environments','Production environments','Production']],
sonarqube:[['baseUrl','SonarQube URL','https://sonarcloud.io'],['auth','Token type','bearer|basic'],['coverage','Also read coverage (when your CI keeps no coverage report)','no|yes']],
jira:[['baseUrl','Jira URL','https://your-site.atlassian.net'],['auth','Sign-in','basic|bearer'],['jql','JQL (which issues)','project in (PAY)']],
linear:[['auth','Sign-in','key|oauth']],pagerduty:[],opsgenie:[['region','Region','us|eu']]};
const SECRETS={github:{token:[['GITHUB_TOKEN','Fine-grained token (Actions, Contents, Deployments, Metadata: read)']],app:[['GITHUB_APP_PRIVATE_KEY','GitHub App private key (PEM)']],oauth:[]},
gitlab:{token:[['GITLAB_TOKEN','Access token (read_api)']],oauth:[]},bitbucket:{'app-password':[['BITBUCKET_USERNAME','Bitbucket username'],['BITBUCKET_APP_PASSWORD','App password (Account, Repositories, Pipelines: Read)']],oauth:[]},
'bitbucket-dc':{'':[['BITBUCKET_TOKEN','HTTP access token (Read)']]},jenkins:{'':[['JENKINS_USER','Jenkins user'],['JENKINS_TOKEN','API token']]},'azure-devops':{'':[['AZURE_DEVOPS_TOKEN','Personal access token (Read)']]},
sonarqube:{'':[['SONAR_TOKEN','User token (Browse)']]},jira:{basic:[['JIRA_EMAIL','Account e-mail'],['JIRA_TOKEN','API token']],bearer:[['JIRA_TOKEN','Personal access token']]},
linear:{key:[['LINEAR_API_KEY','Personal API key']],oauth:[]},pagerduty:{'':[['PAGERDUTY_TOKEN','Read-only REST API key']]},opsgenie:{'':[['OPSGENIE_API_KEY','API key (read)']]}};
const MAPLABEL={github:'owner/repo',gitlab:'group/project',bitbucket:'workspace/repo','bitbucket-dc':'PROJECT/repo',jenkins:'folder/job','azure-devops':'pipeline name',sonarqube:'project key',jira:'project key',linear:'team key',pagerduty:'service name',opsgenie:'Opsgenie team'};
let S=null;const $=(id)=>document.getElementById(id);const esc=(s)=>String(s??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j;}
function teamOptions(sel){const deps=(S&&S.context&&S.context.departments)||[];return '<option value="">— team —</option>'+deps.map(d=>'<optgroup label="'+esc(d.name)+'">'+d.teams.map(t=>'<option value="'+esc(t.id)+'"'+(t.id===sel?' selected':'')+'>'+esc(t.name)+' ('+esc(t.id)+')</option>').join('')+'</optgroup>').join('');}
function addRow(k,t){const d=document.createElement('div');d.className='row';d.innerHTML='<div><label>'+esc(MAPLABEL[$('type').value]||'key')+'</label><input class="mk" value="'+esc(k||'')+'"></div><div><label>Department and team</label><select class="mt">'+teamOptions(t)+'</select></div><button class="secondary rm">Remove</button>';d.querySelector('.rm').onclick=()=>d.remove();$('map').appendChild(d);}
function authOf(){const a=document.querySelector('[data-f="auth"]');return a?a.value:'';}
function renderSecrets(){const t=$('type').value;const set=(SECRETS[t]||{})[authOf()]||(SECRETS[t]||{})['']||[];$('secrets').innerHTML=set.map(([e,l])=>'<label>'+esc(l)+' <small>('+esc(e)+', kept in the credentials file)</small></label>'+(e.endsWith('PRIVATE_KEY')?'<textarea data-s="'+e+'" rows="4"></textarea>':'<input data-s="'+e+'" type="password" autocomplete="off">')).join('')+(authOf()==='oauth'?'<p><small>Save the tool first, then use “Connect with OAuth” in the list below with your own OAuth app (redirect URI <code>http://127.0.0.1:'+location.port+'/oauth/callback</code>).</small></p>':'');}
function renderFields(){const t=$('type').value;$('name').value=$('name').value||t;$('fields').innerHTML=(FIELDS[t]||[]).map(([k,l,d])=>d.includes('|')?'<label>'+esc(l)+'</label><select data-f="'+k+'">'+d.split('|').map(o=>'<option>'+o+'</option>').join('')+'</select>':'<label>'+esc(l)+'</label><input data-f="'+k+'" placeholder="'+esc(d)+'">').join('');$('fields').querySelectorAll('select').forEach(s=>s.onchange=renderSecrets);renderSecrets();$('map').innerHTML='';addRow();}
function renderState(){$('url').value=S.url||'';$('keymsg').innerHTML=S.apiKeySet?'<span class="ok">API key saved.</span>':'<span class="bad">No API key yet.</span>';
 $('ctx').innerHTML=S.context?'<p>Company <b>'+esc(S.context.company.name)+'</b> (<code>'+esc(S.context.company.id)+'</code>)</p><table><tr><th>Department</th><th>Teams</th></tr>'+S.context.departments.map(d=>'<tr><td>'+esc(d.name)+' <code>'+esc(d.id)+'</code></td><td>'+d.teams.map(t=>esc(t.name)+' <code>'+esc(t.id)+'</code>').join(', ')+'</td></tr>').join('')+'</table>':'';
 $('sources').innerHTML=S.sources.length?S.sources.map(s=>{const mk=Object.entries(s[(S.types.find(x=>x.type===s.type)||{}).mapKey]||{});return '<div style="border-top:1px solid #e2e8f0;padding:8px 0"><b>'+esc(s.name)+'</b> ('+esc(s.type)+') — '+mk.map(([k,t])=>esc(k)+' → <code>'+esc(t)+'</code>').join(', ')+'<br><small>'+s.secrets.map(x=>esc(x.env)+': '+(x.set?'set':'<span class="bad">missing</span>')).join(' · ')+(s.oauthProvider?' · OAuth: '+(s.oauthConnected?'connected':'not connected'):'')+'</small><br><button class="secondary" data-test="'+esc(s.name)+'">Test connection</button>'+(s.oauthProvider&&(s.auth==='oauth'||s.type==='linear')?'<button class="secondary" data-oauth="'+esc(s.name)+'">Connect with OAuth</button>':'')+'<button class="secondary" data-del="'+esc(s.name)+'">Remove</button><div id="t-'+esc(s.name)+'"></div></div>';}).join(''):'<p>No tool yet.</p>';
 document.querySelectorAll('[data-test]').forEach(b=>b.onclick=async()=>{const n=b.dataset.test;$('t-'+n).textContent='Testing…';try{const r=await api('/api/test',{name:n});$('t-'+n).innerHTML=r.ok?'<span class="ok">'+r.lines.map(esc).join('<br>')+'</span>':'<span class="bad">'+esc(r.error)+'</span>';}catch(e){$('t-'+n).innerHTML='<span class="bad">'+esc(e.message)+'</span>';}});
 document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{S=await api('/api/source/delete',{name:b.dataset.del});renderState();});
 document.querySelectorAll('[data-oauth]').forEach(b=>b.onclick=async()=>{const n=b.dataset.oauth;const id=prompt('Your OAuth app client id');if(!id)return;const sec=prompt('Your OAuth app client secret (kept in the credentials file only)');if(!sec)return;try{const r=await api('/api/oauth/start',{name:n,clientId:id,clientSecret:sec});location.href=r.url;}catch(e){alert(e.message);}});}
$('demobtn').onclick=async()=>{$('demomsg').textContent='Adding…';try{S=await api('/api/demo',{});$('demomsg').innerHTML='<span class="ok">Added. Test each connection below, then run preview and sync.</span>';renderState();}catch(e){$('demomsg').innerHTML='<span class="bad">'+esc(e.message)+'</span>';}};
async function load(){S=await api('/api/state');$('demo').style.display=S.fakeVendors?'':'none';$('type').innerHTML=S.types.map(t=>'<option>'+t.type+'</option>').join('');renderFields();renderState();}
$('type').onchange=()=>{$('name').value=$('type').value;renderFields();};$('addrow').onclick=()=>addRow();
$('savekey').onclick=async()=>{$('keymsg').textContent='Checking…';try{S=await api('/api/key',{apiKey:$('apikey').value,url:$('url').value});$('apikey').value='';renderState();document.querySelectorAll('.mt').forEach(s=>{const v=s.value;s.innerHTML=teamOptions(v);});}catch(e){$('keymsg').innerHTML='<span class="bad">'+esc(e.message)+'</span>';}};
$('savesrc').onclick=async()=>{const t=$('type').value;const settings={};document.querySelectorAll('[data-f]').forEach(i=>{const v=i.value.trim();if(!v)return;if(i.dataset.f==='environments')settings.environments=v.split(',').map(x=>x.trim()).filter(Boolean);else if(i.dataset.f==='auth'&&t==='linear'){}else settings[i.dataset.f]=v;});
 const secrets={};document.querySelectorAll('[data-s]').forEach(i=>{if(i.value.trim())secrets[i.dataset.s]=i.value.trim();});const mapping={};document.querySelectorAll('#map .row').forEach(r=>{const k=r.querySelector('.mk').value.trim();const v=r.querySelector('.mt').value;if(k&&v)mapping[k]=v;});
 try{const r=await api('/api/source',{type:t,name:$('name').value.trim(),settings,secrets,mapping});S=r.state;$('srcmsg').innerHTML='<span class="ok">Saved '+esc(r.name)+'.</span>';document.querySelectorAll('[data-s]').forEach(i=>i.value='');renderState();}catch(e){$('srcmsg').innerHTML='<span class="bad">'+esc(e.message)+'</span>';}};
load();
</script>`;
