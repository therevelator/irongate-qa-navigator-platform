/**
 * qe-collector: the QE Navigator Collector.
 *
 *   qe-collector check                    validate the config, reach every source and QE Navigator, print what would be read
 *   qe-collector preview [--offline]      print exactly the records that would be sent (nothing is sent)
 *   qe-collector sync                     send what changed since the last run
 *   qe-collector sync --since 2026-01-01  backfill from a date (QE Navigator ignores what it already has)
 *
 * Exit codes: 0 ok, 1 internal error, 2 configuration or usage, 3 a source could not be read,
 * 4 QE Navigator refused or could not be reached, 5 another run holds the lock, 6 some records refused.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { ConfigError, loadConfig, type Config } from './config';
import { configureLog, log } from './log';
import { EXIT, runCheck, runPreview, runSync } from './run';
import { VERSION } from './version';

const HELP = `qe-collector ${VERSION}: reads Jira, Linear, PagerDuty and Opsgenie inside your network and sends
minimised records to QE Navigator over outbound HTTPS.

Usage: qe-collector <command> [options]

Commands:
  check              Validate the config, test each source and QE Navigator, show what would be read
  preview            Print exactly the records that would be sent, as JSON (nothing is sent)
  sync               Send what changed since the last run
  version            Print the version

Options:
  -c, --config FILE  Config file (default: $QE_COLLECTOR_CONFIG or ./qe-collector.yaml)
  --since DATE       Read from this date (YYYY-MM-DD or ISO time), e.g. a backfill
  --source NAME      Only this source
  --state FILE       State file (overrides state.path)
  --offline          preview: do not contact QE Navigator (air-gapped review)
  --all              preview: include records already delivered
  --out FILE         preview: write the JSON to FILE instead of stdout
  --log-format F     json or text (default: text on a terminal, else json)
  -v, --verbose      Debug logs (requests, retries; never secrets)
  -h, --help         This help

Secrets come only from environment variables (or VAR_FILE): QE_API_KEY, JIRA_TOKEN, JIRA_EMAIL,
LINEAR_API_KEY, PAGERDUTY_TOKEN, OPSGENIE_API_KEY, QE_PEOPLE_SALT (names configurable).
Proxy: HTTPS_PROXY, NO_PROXY. Exit codes: 0 ok, 2 config, 3 source, 4 QE Navigator, 5 locked, 6 partial.`;

export interface Args {
  command: string | null;
  config: string | null;
  since: Date | null;
  source: string | null;
  state: string | null;
  offline: boolean;
  all: boolean;
  out: string | null;
  verbose: boolean;
  logFormat: 'json' | 'text' | null;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { command: null, config: null, since: null, source: null, state: null, offline: false, all: false, out: null, verbose: false, logFormat: null, help: false };
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
      case '-v': case '--verbose': a.verbose = true; break;
      case '-h': case '--help': a.help = true; break;
      case '--version': a.command = 'version'; break;
      default:
        if (x.startsWith('-')) throw new ConfigError(`Unknown option ${x} (qe-collector --help)`);
        if (a.command) throw new ConfigError(`Unexpected argument "${x}"`);
        a.command = x;
    }
  }
  return a;
}

/**
 * The config file when -c is not given: $QE_COLLECTOR_CONFIG, else $QE_AGENT_CONFIG (the variable of the earlier
 * releases, named the on-premises agent), else ./qe-collector.yaml, else ./qe-agent.yaml when only that exists.
 */
export function defaultConfigPath(env: NodeJS.ProcessEnv, exists: (p: string) => boolean = existsSync): string {
  if (env.QE_COLLECTOR_CONFIG) return env.QE_COLLECTOR_CONFIG;
  if (env.QE_AGENT_CONFIG) return env.QE_AGENT_CONFIG;
  if (!exists('./qe-collector.yaml') && exists('./qe-agent.yaml')) return './qe-agent.yaml';
  return './qe-collector.yaml';
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let args: Args;
  try { args = parseArgs(argv); } catch (e) { process.stderr.write(`${(e as Error).message}\n`); return EXIT.CONFIG; }
  if (args.help || !args.command) { process.stdout.write(HELP + '\n'); return args.help ? EXIT.OK : EXIT.CONFIG; }
  if (args.command === 'version') { process.stdout.write(`qe-collector ${VERSION}\n`); return EXIT.OK; }
  configureLog({ verbose: args.verbose, ...(args.logFormat ? { format: args.logFormat } : {}) });
  if (!['check', 'preview', 'sync'].includes(args.command)) { log.error(`Unknown command "${args.command}" (check, preview, sync)`); return EXIT.CONFIG; }
  let cfg: Config;
  try {
    cfg = loadConfig(args.config ?? defaultConfigPath(env));
    if (args.state) cfg.statePath = args.state;
  } catch (e) {
    log.error((e as Error).message);
    return EXIT.CONFIG;
  }
  const opts = { since: args.since, source: args.source, env, offline: args.offline, all: args.all };
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
    return await runSync(cfg, opts);
  } catch (e) {
    if (e instanceof ConfigError) { log.error(e.message); return EXIT.CONFIG; }
    log.error(`Unexpected error: ${(e as Error)?.message ?? e}`);
    if (args.verbose && e instanceof Error && e.stack) log.debug(e.stack);
    return EXIT.INTERNAL;
  }
}
