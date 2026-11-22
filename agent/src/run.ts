/**
 * The three commands: check, preview and sync (incremental or --since backfill).
 */
import type { Config, SourceConfig } from './config';
import { ConfigError, requireSecret, secret } from './config';
import { log } from './log';
import { acquireLock, fingerprint, loadState, saveState, sourceState, emptyState, type State } from './state';
import { finalRecord, PrivacyViolation, type PrivacyContext } from './privacy';
import { JiraAdapter } from './sources/jira';
import { LinearAdapter } from './sources/linear';
import { PagerDutyAdapter } from './sources/pagerduty';
import { OpsgenieAdapter } from './sources/opsgenie';
import { SourceError, type Adapter } from './sources/client';
import { QeClient, QeError, deliver, makeBatches, type Item, type Kind } from './sender';
import { allowedFields } from './vendor/fieldAllowList';
import { VERSION } from './version';

export const EXIT = { OK: 0, INTERNAL: 1, CONFIG: 2, SOURCE: 3, QE: 4, LOCKED: 5, PARTIAL: 6 } as const;

export interface RunOptions {
  since?: Date | null;
  source?: string | null;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** preview: do not call QE Navigator at all (air-gapped review). */
  offline?: boolean;
  /** preview: include records already delivered. */
  all?: boolean;
  out?: (text: string) => void;
}

export function adapterFor(src: SourceConfig, cfg: Config, privacy: PrivacyContext, env: NodeJS.ProcessEnv): Adapter {
  switch (src.type) {
    case 'jira': return new JiraAdapter(src, cfg.http, privacy, env);
    case 'linear': return new LinearAdapter(src, cfg.http, privacy, env);
    case 'pagerduty': return new PagerDutyAdapter(src, cfg.http, privacy, env);
    case 'opsgenie': return new OpsgenieAdapter(src, cfg.http, privacy, env);
  }
}

function privacyContext(cfg: Config, env: NodeJS.ProcessEnv): PrivacyContext {
  const salt = cfg.privacy.people === 'hash' ? requireSecret(cfg.peopleSaltEnv, 'privacy.people: hash needs a salt that stays in your network', env) : null;
  if (salt && salt.length < 16) throw new ConfigError(`${cfg.peopleSaltEnv} must be at least 16 characters (e.g. openssl rand -hex 32)`);
  return { privacy: cfg.privacy, salt };
}

function selected(cfg: Config, name?: string | null): SourceConfig[] {
  const list = cfg.sources.filter((s) => s.enabled && (!name || s.name === name));
  if (name && !list.length) throw new ConfigError(`No enabled source named "${name}" (sources: ${cfg.sources.map((s) => s.name).join(', ')})`);
  return list;
}

const DAY = 86_400_000;

export interface Collected {
  source: string;
  kind: Kind;
  since: Date;
  until: Date;
  read: number;
  items: Item[];
  unchanged: number;
  skipped: Array<{ id: string; reason: string }>;
  maxChangedAt: string | null;
  perTeam: Record<string, number>;
  requests: number;
}

/** Read one source and turn its records into exactly what would be sent. */
export async function collect(adapter: Adapter, src: SourceConfig, cfg: Config, state: State, privacy: PrivacyContext, o: RunOptions): Promise<Collected> {
  const now = (o.now ?? (() => new Date()))();
  const st = sourceState(state, src.name);
  const since = o.since ?? (st.cursor ? new Date(Date.parse(st.cursor) - cfg.overlapMinutes * 60_000) : new Date(now.getTime() - cfg.backfillDays * DAY));
  const c: Collected = { source: src.name, kind: adapter.kind, since, until: now, read: 0, items: [], unchanged: 0, skipped: [], maxChangedAt: null, perTeam: {}, requests: 0 };
  const byId = new Map<string, Item>();
  const oldest = now.getTime() - 364 * DAY;
  const newest = now.getTime() + 5 * 60_000;
  for await (const page of adapter.collect(since, now)) {
    c.read += page.records.length + page.skipped.length;
    c.skipped.push(...page.skipped);
    for (const r of page.records) {
      if (r.changedAt && (!c.maxChangedAt || r.changedAt > c.maxChangedAt)) c.maxChangedAt = r.changedAt;
      let rec: Record<string, unknown>;
      try {
        rec = finalRecord(adapter.kind === 'issues' ? 'issue' : 'incident', r.record, privacy);
      } catch (e) {
        if (e instanceof PrivacyViolation) { c.skipped.push({ id: r.id, reason: e.message }); continue; }
        throw e;
      }
      if (adapter.kind === 'incidents') {
        // QE Navigator refuses incident times older than 365 days or in the future.
        const times = [rec.openedAt, rec.acknowledgedAt, rec.resolvedAt, rec.at].filter((x): x is string => typeof x === 'string').map(Date.parse);
        if (times.some((t) => t < oldest)) { c.skipped.push({ id: r.id, reason: 'older than 364 days (QE Navigator keeps 13 months)' }); continue; }
        if (times.some((t) => t > newest)) { c.skipped.push({ id: r.id, reason: 'a time is in the future (check the clock)' }); continue; }
      }
      const fp = fingerprint(rec);
      if (!o.all && (st.sent[r.id] === fp || st.rejected?.[r.id] === fp)) { byId.delete(r.id); c.unchanged++; continue; }
      byId.delete(r.id);
      byId.set(r.id, { id: r.id, fp, record: rec });
    }
  }
  c.items = Array.from(byId.values());
  for (const it of c.items) { const t = String(it.record.team); c.perTeam[t] = (c.perTeam[t] ?? 0) + 1; }
  c.requests = adapter.requests();
  return c;
}

function summarise(c: Collected): void {
  log.info(`${c.source}: read ${c.read}, to send ${c.items.length}, unchanged ${c.unchanged}, skipped ${c.skipped.length}`, {
    source: c.source, since: c.since.toISOString(), perTeam: c.perTeam, sourceRequests: c.requests,
  });
  const reasons = new Map<string, number>();
  for (const s of c.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
  for (const [reason, n] of reasons) log.warn(`${c.source}: ${n} skipped: ${reason}`);
}

function errorExit(e: unknown, where: string): number {
  if (e instanceof ConfigError) { log.error(e.message); return EXIT.CONFIG; }
  if (e instanceof SourceError) { log.error(e.message, { source: where }); return EXIT.SOURCE; }
  if (e instanceof QeError) { log.error(e.message); return EXIT.QE; }
  log.error(`${where}: ${(e as Error)?.message ?? e}`);
  return EXIT.INTERNAL;
}

const worst = (codes: number[]) => [EXIT.QE, EXIT.SOURCE, EXIT.INTERNAL, EXIT.PARTIAL].find((c) => codes.includes(c)) ?? EXIT.OK;

// ---------------------------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------------------------

export async function runCheck(cfg: Config, o: RunOptions = {}): Promise<number> {
  const env = o.env ?? process.env;
  const print = o.out ?? ((t: string) => process.stdout.write(t + '\n'));
  const codes: number[] = [];
  print(`qe-agent ${VERSION}: checking ${cfg.path}`);
  print(`  destination: ${cfg.qeNavigator.url} (outbound HTTPS only)`);
  print(`  privacy: titles ${cfg.privacy.sendTitles ? 'SENT' : 'not sent'}, links ${cfg.privacy.sendLinks ? 'SENT' : 'not sent'}, people ${cfg.privacy.people === 'hash' ? 'as salted hashes' : 'not sent'}`);
  print(`  issue fields sent: ${allowedFields('issue', { titles: cfg.privacy.sendTitles, links: cfg.privacy.sendLinks, people: cfg.privacy.people === 'hash' }).join(', ')}`);
  print(`  incident fields sent: ${allowedFields('incident', { titles: cfg.privacy.sendTitles, links: cfg.privacy.sendLinks, people: cfg.privacy.people === 'hash' }).join(', ')}`);
  print(`  state: ${cfg.statePath}`);
  let privacy: PrivacyContext;
  try { privacy = privacyContext(cfg, env); } catch (e) { return errorExit(e, 'privacy'); }
  const apiKey = secret(cfg.qeNavigator.apiKeyEnv, env);
  print(`  ${cfg.qeNavigator.apiKeyEnv}: ${apiKey ? (apiKey.startsWith('igk_') ? 'set' : 'set, but does not start with igk_') : 'MISSING'}`);
  if (apiKey && !apiKey.startsWith('igk_')) codes.push(EXIT.CONFIG);
  let state: State;
  try { state = loadState(cfg.statePath); } catch (e) { print(`  state: ${(e as Error).message}`); state = emptyState(); codes.push(EXIT.CONFIG); }
  const teams = new Set<string>();
  for (const src of selected(cfg, o.source)) {
    print('');
    print(`[${src.name}] ${src.type}`);
    const st = state.sources[src.name];
    print(`  next read from: ${st?.cursor ? `${st.cursor} (cursor) minus ${cfg.overlapMinutes} min` : `${cfg.backfillDays} days ago (first run)`}`);
    for (const t of Object.values(src.teams)) teams.add(t);
    if ('services' in src) for (const t of Object.values(src.services)) teams.add(t);
    if (src.defaultTeam) teams.add(src.defaultTeam);
    let adapter: Adapter;
    try { adapter = adapterFor(src, cfg, privacy, env); } catch (e) { print(`  FAILED: ${(e as Error).message}`); codes.push(e instanceof ConfigError ? EXIT.CONFIG : EXIT.SOURCE); continue; }
    for (const line of adapter.describe()) print(`  reads: ${line}`);
    try {
      for (const line of await adapter.check()) print(`  ok: ${line}`);
    } catch (e) {
      print(`  FAILED: ${(e as Error).message}`);
      codes.push(e instanceof SourceError ? EXIT.SOURCE : EXIT.INTERNAL);
    }
  }
  print('');
  print('[QE Navigator]');
  if (!apiKey) {
    print(`  FAILED: set ${cfg.qeNavigator.apiKeyEnv} (an igk_ key from Admin console → API keys)`);
    codes.push(EXIT.CONFIG);
  } else if (teams.size) {
    const now = (o.now ?? (() => new Date()))().toISOString();
    const items: Item[] = Array.from(teams).map((team, i) => ({ id: `check-${i}`, fp: '', record: { key: `QEAGENT-CHECK-${i + 1}`, team, type: 'task', status: 'To Do', statusCategory: 'todo', createdAt: now } }));
    const qe = new QeClient(cfg, apiKey);
    try {
      const r = await qe.post(makeBatches('issues', items)[0], true);
      if (r.status === 200) print(`  ok: key valid, ${teams.size} team id(s) accepted (${Array.from(teams).join(', ')}); dry run, nothing stored`);
      else { print(`  FAILED: HTTP ${r.status}: ${r.body?.error ?? ''}`); codes.push(EXIT.QE); }
    } catch (e) {
      print(`  FAILED: ${(e as Error).message}`);
      codes.push(EXIT.QE);
    }
  } else {
    print('  FAILED: no team ids in the config (sources[].teams / services / defaultTeam)');
    codes.push(EXIT.CONFIG);
  }
  const code = codes.includes(EXIT.CONFIG) ? EXIT.CONFIG : worst(codes);
  print('');
  print(code === EXIT.OK ? 'All checks passed.' : `Checks failed (exit ${code}).`);
  return code;
}

// ---------------------------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------------------------

export async function runPreview(cfg: Config, o: RunOptions = {}): Promise<number> {
  const env = o.env ?? process.env;
  const print = o.out ?? ((t: string) => process.stdout.write(t + '\n'));
  let privacy: PrivacyContext;
  try { privacy = privacyContext(cfg, env); } catch (e) { return errorExit(e, 'privacy'); }
  let state: State;
  try { state = loadState(cfg.statePath); } catch (e) { return errorExit(new ConfigError((e as Error).message), 'state'); }
  const apiKey = o.offline ? null : secret(cfg.qeNavigator.apiKeyEnv, env);
  if (!o.offline && !apiKey) log.warn(`${cfg.qeNavigator.apiKeyEnv} is not set: the preview is not checked by QE Navigator's dry run (use --offline to silence this)`);
  const qe = new QeClient(cfg, apiKey);
  const codes: number[] = [];
  const report: any = {
    agent: `qe-agent/${VERSION}`, generatedAt: (o.now ?? (() => new Date()))().toISOString(), destination: cfg.qeNavigator.url,
    privacy: cfg.privacy, note: 'Each request below is exactly what "qe-agent sync" would send now (body shown as JSON; sent gzip-compressed). Nothing was sent.',
    sources: [] as any[], requests: [] as any[],
  };
  for (const src of selected(cfg, o.source)) {
    try {
      const adapter = adapterFor(src, cfg, privacy, env);
      const c = await collect(adapter, src, cfg, state, privacy, o);
      summarise(c);
      report.sources.push({
        name: src.name, type: src.type, since: c.since.toISOString(), until: c.until.toISOString(), read: c.read, toSend: c.items.length, unchanged: c.unchanged,
        perTeam: c.perTeam, skipped: c.skipped.slice(0, 100), skippedTotal: c.skipped.length,
      });
      for (const b of makeBatches(c.kind, c.items)) {
        const req: any = { source: src.name, method: 'POST', url: qe.url(b.kind, false), headers: qe.headers(b, false, true), records: b.items.length, bytes: Buffer.byteLength(b.json), body: JSON.parse(b.json) };
        if (apiKey) {
          try {
            const r = await qe.post(b, true);
            req.dryRun = { status: r.status, answer: r.body };
            if (r.status !== 200) codes.push(EXIT.QE);
          } catch (e) {
            req.dryRun = { error: (e as Error).message };
            codes.push(EXIT.QE);
          }
        }
        report.requests.push(req);
      }
    } catch (e) {
      codes.push(errorExit(e, src.name));
      report.sources.push({ name: src.name, type: src.type, error: (e as Error).message });
    }
  }
  print(JSON.stringify(report, null, 2));
  return worst(codes);
}

// ---------------------------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------------------------

export async function runSync(cfg: Config, o: RunOptions = {}): Promise<number> {
  const env = o.env ?? process.env;
  let privacy: PrivacyContext;
  let apiKey: string;
  try {
    privacy = privacyContext(cfg, env);
    apiKey = requireSecret(cfg.qeNavigator.apiKeyEnv, 'QE Navigator API key (Admin console → API keys)', env);
  } catch (e) {
    return errorExit(e, 'config');
  }
  let release: () => void;
  try { release = acquireLock(cfg.statePath); } catch (e) { log.error((e as Error).message); return EXIT.LOCKED; }
  const codes: number[] = [];
  try {
    let state: State;
    try { state = loadState(cfg.statePath); } catch (e) { return errorExit(new ConfigError((e as Error).message), 'state'); }
    const qe = new QeClient(cfg, apiKey);
    const budget = { extraRequests: 40 };
    for (const src of selected(cfg, o.source)) {
      const t0 = Date.now();
      try {
        const adapter = adapterFor(src, cfg, privacy, env);
        const c = await collect(adapter, src, cfg, state, privacy, o);
        summarise(c);
        const st = sourceState(state, src.name);
        let written = 0;
        let duplicate = 0;
        let rejected = 0;
        for (const b of makeBatches(c.kind, c.items)) {
          const r = await deliver(qe, b, budget, (items) => {
            for (const it of items) { delete st.sent[it.id]; st.sent[it.id] = it.fp; if (st.rejected) delete st.rejected[it.id]; }
            saveState(cfg.statePath, state);
          });
          written += r.written;
          duplicate += r.duplicate;
          if (r.rejected.length) {
            st.rejected = st.rejected ?? {};
            for (const x of r.rejected) st.rejected[x.item.id] = x.item.fp;
            rejected += r.rejected.length;
          }
        }
        // Every record read was delivered (or refused one by one): the cursor moves on.
        const next = c.maxChangedAt && adapter.kind === 'issues' ? c.maxChangedAt : c.until.toISOString();
        if (!st.cursor || next > st.cursor) st.cursor = next;
        st.lastSuccessAt = new Date().toISOString();
        saveState(cfg.statePath, state);
        log.info(`${src.name}: delivered ${c.items.length - rejected} (${written} new or changed, ${duplicate} already known), refused ${rejected}`, {
          source: src.name, cursor: st.cursor, seconds: Math.round((Date.now() - t0) / 100) / 10, qeRequests: qe.requests,
        });
        if (rejected) codes.push(EXIT.PARTIAL);
      } catch (e) {
        codes.push(errorExit(e, src.name));
        // Records delivered before the failure stay recorded; the cursor does not move.
        try { saveState(cfg.statePath, state); } catch { /* reported by the next run */ }
        if (e instanceof QeError && e.auth) break;
      }
    }
  } finally {
    release();
  }
  return worst(codes);
}
