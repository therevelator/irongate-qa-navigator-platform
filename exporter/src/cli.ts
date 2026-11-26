/**
 * qe-exporter: the QE Navigator Exporter (qe-collector and qe-agent are the same program under its earlier names).
 *
 *   qe-exporter setup                    a local page (127.0.0.1 only, one-time token) to enter the API key, connect each
 *                                        tool, test it, and pick the department and team of each source
 *   qe-exporter check                    validate the config, reach every source and QE Navigator, print what would be read
 *   qe-exporter preview                  print exactly the JSON that would be sent, with the three ids (nothing is sent)
 *   qe-exporter sync                     read what changed since the last run and send the raw data
 *   qe-exporter sync --since 2026-01-01  backfill from a date (QE Navigator ignores what it already has)
 *   qe-exporter diagnose                 write a redacted diagnostics bundle you can choose to send to support
 *
 * Exit codes: 0 ok, 1 internal error, 2 configuration or usage, 3 a source could not be read,
 * 4 QE Navigator refused or could not be reached, 5 another run holds the lock, 6 some items refused.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { ConfigError, loadConfig, type Config } from './config';
import { configureLog, log } from './log';
import { EXIT, runCheck, runPreview, runSync } from './run';
import { runDiagnose } from './diagnose';
import { runSetup } from './setup';
import { VERSION } from './version';

const HELP = `qe-exporter ${VERSION}: the QE Navigator Exporter. Reads your CI (GitHub Actions, GitLab CI, Bitbucket,
Jenkins, Azure DevOps), SonarQube, Jira, Linear, PagerDuty and Opsgenie inside your network and sends the raw data
to QE Navigator as JSON over outbound HTTPS. QE Navigator calculates everything; the Exporter calculates nothing.

Usage: qe-exporter <command> [options]        (qe-collector and qe-agent <command> work the same)

Commands:
  setup              Local setup page: API key, connect your tools, test them, map sources to teams
  check              Validate the config, test each source and QE Navigator, show what would be read
  preview            Print exactly what would be sent, as JSON (nothing is sent, nothing is stored)
  sync               Read what changed and send it; heartbeat
  diagnose           Write a redacted diagnostics bundle (--out FILE); nothing is sent
  version            Print the version

Options:
  -c, --config FILE  Config file (default: $QE_EXPORTER_CONFIG or ./qe-exporter.yaml / ./qe-exporter.json)
  --since DATE       Read from this date (YYYY-MM-DD or ISO time), e.g. a backfill
  --source NAME      Only this source
  --force            sync: read every source now, whatever the collection schedule in QE Navigator says
  --state FILE       State file (overrides state.path)
  --offline          check: do not contact QE Navigator
  --all              preview / sync: include what was already delivered
  --out FILE         preview: write the JSON to FILE instead of stdout; diagnose: the bundle file
  --host H, --port P setup: where the page listens (127.0.0.1 / localhost / ::1 only; default 127.0.0.1:8788)
  --log-format F     json or text (default: text on a terminal, else json)
  -v, --verbose      Debug logs (requests, retries; never secrets)
  -h, --help         This help

Secrets come from environment variables (or VAR_FILE), or the setup page's credentials file (0600):
QE_API_KEY, GITHUB_TOKEN (or GITHUB_APP_PRIVATE_KEY), GITLAB_TOKEN, BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD,
BITBUCKET_TOKEN (Data Center), JENKINS_USER + JENKINS_TOKEN, AZURE_DEVOPS_TOKEN, SONAR_TOKEN, JIRA_TOKEN, JIRA_EMAIL,
LINEAR_API_KEY, PAGERDUTY_TOKEN, OPSGENIE_API_KEY, QE_PEOPLE_SALT (names configurable).
Proxy: HTTPS_PROXY, NO_PROXY. Exit codes: 0 ok, 2 config, 3 source, 4 QE Navigator, 5 locked, 6 partial.`;

export interface Args {
  command: string | null;
  config: string | null;
  since: Date | null;
  force: boolean;
  source: string | null;
  state: string | null;
  offline: boolean;
  all: boolean;
  out: string | null;
  verbose: boolean;
  logFormat: 'json' | 'text' | null;
  help: boolean;
  host: string | null;
  port: number | null;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { command: null, config: null, since: null, source: null, state: null, offline: false, all: false, force: false, out: null, verbose: false, logFormat: null, help: false, host: null, port: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const [flag, inline] = x.startsWith('--') && x.includes('=') ? [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)] : [x, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || (inline === undefined && v.startsWith('-'))) throw new ConfigError(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '-c': case '--config': a.config = value(); break;
      case '--since': {
        const v = value();
        const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
        if (Number.isNaN(d.getTime())) throw new ConfigError(`--since must be a date (YYYY-MM-DD) or an ISO time, not "${v}"`);
        if (d.getTime() > Date.now()) throw new ConfigError('--since is in the future');
        a.since = d;
        break;
      }
      case '--source': a.source = value(); break;
      case '--force': a.force = true; break;
      case '--state': a.state = value(); break;
      case '--offline': a.offline = true; break;
      case '--all': a.all = true; break;
      case '--out': a.out = value(); break;
      case '--log-format': {
        const v = value();
        if (v !== 'json' && v !== 'text') throw new ConfigError('--log-format must be json or text');
        a.logFormat = v;
        break;
      }
      case '--host': a.host = value(); break;
      case '--port': {
        const v = Number(value());
        if (!Number.isInteger(v) || v < 1 || v > 65535) throw new ConfigError('--port must be a port number');
        a.port = v;
        break;
      }
      case '-v': case '--verbose': a.verbose = true; break;
      case '-h': case '--help': a.help = true; break;
      case '--version': a.command = 'version'; break;
      default:
        if (x.startsWith('-')) throw new ConfigError(`Unknown option ${x} (qe-exporter --help)`);
        if (a.command) throw new ConfigError(`Unexpected argument "${x}"`);
        a.command = x;
    }
  }
  return a;
}

/**
 * The config file when -c is not given: $QE_EXPORTER_CONFIG, else the variables of the earlier releases
 * ($QE_COLLECTOR_CONFIG, $QE_AGENT_CONFIG), else the first that exists of ./qe-exporter.yaml, ./qe-exporter.json,
 * ./qe-collector.yaml, ./qe-agent.yaml (default ./qe-exporter.yaml).
 */
export function defaultConfigPath(env: NodeJS.ProcessEnv, exists: (p: string) => boolean = existsSync): string {
  for (const k of ['QE_EXPORTER_CONFIG', 'QE_COLLECTOR_CONFIG', 'QE_AGENT_CONFIG']) if (env[k]) return env[k]!;
  for (const p of ['./qe-exporter.yaml', './qe-exporter.json', './qe-collector.yaml', './qe-agent.yaml']) if (exists(p)) return p;
  return './qe-exporter.yaml';
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let args: Args;
  try { args = parseArgs(argv); } catch (e) { process.stderr.write(`${(e as Error).message}\n`); return EXIT.CONFIG; }
  if (args.help || !args.command) { process.stdout.write(HELP + '\n'); return args.help ? EXIT.OK : EXIT.CONFIG; }
  if (args.command === 'version') { process.stdout.write(`qe-exporter ${VERSION}\n`); return EXIT.OK; }
  configureLog({ verbose: args.verbose, ...(args.logFormat ? { format: args.logFormat } : {}) });
  if (!['check', 'preview', 'sync', 'diagnose', 'setup'].includes(args.command)) {
    if (['recalc', 'serve'].includes(args.command)) { log.error(`"${args.command}" was removed in 0.3.0: the Exporter sends the raw data and QE Navigator calculates (see the README)`); return EXIT.CONFIG; }
    log.error(`Unknown command "${args.command}" (setup, check, preview, sync, diagnose)`);
    return EXIT.CONFIG;
  }
  const path = args.config ?? defaultConfigPath(env);
  if (args.command === 'setup') {
    try { return await runSetup({ configPath: path, host: args.host, port: args.port, env }); } catch (e) { log.error((e as Error).message); return e instanceof ConfigError ? EXIT.CONFIG : EXIT.INTERNAL; }
  }
  let cfg: Config;
  try {
    cfg = loadConfig(path);
    if (args.state) cfg.statePath = args.state;
  } catch (e) {
    if (args.command === 'diagnose') { await runDiagnose(null, { env, out: args.out, configError: (e as Error).message }); return EXIT.CONFIG; }
    log.error((e as Error).message);
    return EXIT.CONFIG;
  }
  const opts = { since: args.since, source: args.source, env, offline: args.offline, all: args.all, force: args.force };
  try {
    if (args.command === 'check') return await runCheck(cfg, opts);
    if (args.command === 'preview') {
      if (args.out) {
        let text = '';
        const code = await runPreview(cfg, { ...opts, out: (t) => { text += t + '\n'; } });
        writeFileSync(args.out, text, { mode: 0o600 });
        log.info(`preview written to ${args.out}`);
        return code;
      }
      return await runPreview(cfg, opts);
    }
    if (args.command === 'diagnose') return await runDiagnose(cfg, { env, out: args.out });
    return await runSync(cfg, opts);
  } catch (e) {
    if (e instanceof ConfigError) { log.error(e.message); return EXIT.CONFIG; }
    log.error(`Unexpected error: ${(e as Error)?.message ?? e}`);
    if (args.verbose && e instanceof Error && e.stack) log.debug(e.stack);
    return EXIT.INTERNAL;
  }
}
