/**
 * qe-collector diagnose: a diagnostics bundle for support, written to a local file that you can read and then
 * choose to send (nothing is sent by this command, nothing is read from your tools). It holds versions, the
 * runtime, the configuration without secrets (which secret variables are set, never their values), per source
 * the cursor, last success and error counts, the local copy's size per kind, and a configuration error if
 * there is one. No record, no id of a record, no name. Every string passes the log redaction as well.
 */
import { existsSync, writeFileSync } from 'node:fs';
import type { Config } from './config';
import { secret } from './config';
import { log, redactValue } from './log';
import { loadState } from './state';
import { LocalStore, STORE_KINDS } from './store';
import { ENGINE_VERSION } from './calc';
import { VERSION } from './version';

const SECRET_ENVS = (cfg: Config): string[] => Array.from(new Set([
  cfg.qeNavigator.apiKeyEnv, cfg.peopleSaltEnv, cfg.serve.userEnv, cfg.serve.passwordEnv,
  ...cfg.sources.flatMap((s) => [s.tokenEnv, ...('emailEnv' in s ? [s.emailEnv] : []), ...('userEnv' in s ? [s.userEnv] : []), ...('privateKeyEnv' in s ? [s.privateKeyEnv] : [])]),
]));

/** The bundle's content (also used by the tests). */
export function diagnostics(cfg: Config | null, env: NodeJS.ProcessEnv, configError: string | null = null): Record<string, unknown> {
  const out: Record<string, unknown> = {
    generatedAt: new Date().toISOString(), collector: VERSION, engine: ENGINE_VERSION, node: process.versions.node, platform: `${process.platform} ${process.arch}`,
    proxy: { https: !!(env.HTTPS_PROXY ?? env.https_proxy), noProxy: !!(env.NO_PROXY ?? env.no_proxy) }, configError,
  };
  if (!cfg) return redactValue(out) as Record<string, unknown>;
  out.config = {
    path: cfg.path, destination: cfg.qeNavigator.url, privacyMode: cfg.privacy.mode, localEvidenceUrl: cfg.privacy.localEvidenceUrl, titles: cfg.privacy.sendTitles, links: cfg.privacy.sendLinks,
    people: cfg.privacy.people, backfillDays: cfg.backfillDays, recalcDays: cfg.recalcDays, heartbeat: cfg.heartbeat, http: cfg.http, serve: { host: cfg.serve.host, port: cfg.serve.port },
    store: cfg.store,
    sources: cfg.sources.map((s) => ({ name: s.name, type: s.type, enabled: s.enabled, teams: Object.keys(s.teams).length, defaultTeam: !!s.defaultTeam, caFile: !!s.caFile,
      host: (() => { const u = (s as any).baseUrl ?? (s as any).apiUrl ?? (s as any).orgUrl; try { return u ? new URL(u).host : null; } catch { return null; } })() })),
  };
  out.secrets = Object.fromEntries(SECRET_ENVS(cfg).map((n) => [n, secret(n, env) ? 'set' : 'not set']));
  try {
    const st = existsSync(cfg.statePath) ? loadState(cfg.statePath) : null;
    out.state = st ? {
      collectorVersion: st.collectorVersion, lastHeartbeatAt: st.lastHeartbeatAt ?? null, valuesDelivered: Object.keys(st.metrics ?? {}).length,
      sources: Object.fromEntries(Object.entries(st.sources).map(([k, v]) => [k, { cursor: v.cursor, lastSuccessAt: v.lastSuccessAt, errors: v.errors ?? 0, lastErrorAt: v.lastErrorAt ?? null, lastErrorKind: v.lastErrorKind ?? null, delivered: Object.keys(v.sent).length, refused: Object.keys(v.rejected ?? {}).length }])),
    } : 'no state file yet';
  } catch (e) { out.state = `unreadable: ${(e as Error).message}`; }
  try {
    const store = new LocalStore(cfg.store.dir, cfg.store.retentionDays, cfg.store.detailDays, { memoryOnly: true });
    const l = store.load();
    out.localCopy = { ...store.size(), damagedLines: l.damaged, teams: store.teams().length, records: Object.fromEntries(STORE_KINDS.map((k) => [k, store.count(k)])) };
  } catch (e) { out.localCopy = `unreadable: ${(e as Error).message}`; }
  return redactValue(out) as Record<string, unknown>;
}

export async function runDiagnose(cfg: Config | null, o: { env?: NodeJS.ProcessEnv; out?: string | null; configError?: string | null } = {}): Promise<number> {
  const file = o.out ?? `qe-collector-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify(diagnostics(cfg, o.env ?? process.env, o.configError ?? null), null, 2) + '\n', { mode: 0o600 });
  log.info(`diagnostics written to ${file}: read it, then send it to QE Navigator support if you choose to (nothing was sent)`);
  return 0;
}
