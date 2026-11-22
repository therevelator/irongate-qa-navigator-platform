/**
 * The commands: check, preview, sync (incremental or --since backfill), recalc.
 *
 * A sync reads every source (issues and incidents from Jira, Linear, PagerDuty, Opsgenie; pipelines, tests,
 * coverage, deployments, commits and findings from GitHub, GitLab, Jenkins, Azure DevOps and SonarQube), keeps
 * the records in the local copy (store.ts), and then, by privacy.mode:
 *   full      sends the minimised raw records to the ingestion endpoints (QE Navigator calculates);
 *   evidence  calculates with the shared engine here and sends the values with the allowed evidence lists;
 *   metrics   calculates here and sends the values and counts only.
 * Every run ends with a heartbeat (versions, sources, last success, error counts; no data).
 */
import type { CiSourceConfig, Config, SourceConfig } from './config';
import { ConfigError, isCiSource, requireSecret, secret } from './config';
import { log } from './log';
import { acquireLock, fingerprint, loadState, saveState, sourceState, emptyState, type State } from './state';
import { finalRecord, PrivacyViolation, type PrivacyContext } from './privacy';
import { JiraAdapter } from './sources/jira';
import { LinearAdapter } from './sources/linear';
import { PagerDutyAdapter } from './sources/pagerduty';
import { OpsgenieAdapter } from './sources/opsgenie';
import { SourceError, type Adapter } from './sources/client';
import { GitHubAdapter } from './sources/ci/github';
import { GitLabAdapter } from './sources/ci/gitlab';
import { JenkinsAdapter } from './sources/ci/jenkins';
import { AzureDevOpsAdapter } from './sources/ci/azure';
import { SonarQubeAdapter } from './sources/ci/sonarqube';
import type { CiAdapter, CiRecord } from './sources/ci/common';
import { QeClient, QeError, deliver, keyOf, makeBatches, type Item, type Kind } from './sender';
import { allowedFields } from './policy';
import { VERSION } from './version';
import { LocalStore } from './store';
import { calculate, daysBetween, dayOf, teamEvidence, ENGINE_VERSION } from './calc';
import { metricItem, teamEvidenceItem } from './modes';
import { analysisRequest, coverageRequest, deploymentJson, pipelineJson, testsRequest, type RawRequest } from './rawPayloads';
import { mergeIncident, mergeIssue, mergeSprint, type CommitRec } from '../../packages/engine/src/store/records';
import { parseIssueBody } from '../../packages/engine/src/parsers/issueEvents';
import { parseIncidentBody } from '../../packages/engine/src/parsers/deliveryEvents';

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

type AnyAdapter = Adapter | CiAdapter;

export function adapterFor(src: SourceConfig, cfg: Config, privacy: PrivacyContext, env: NodeJS.ProcessEnv): AnyAdapter {
  const links = { links: cfg.privacy.sendLinks };
  switch (src.type) {
    case 'jira': return new JiraAdapter(src, cfg.http, privacy, env);
    case 'linear': return new LinearAdapter(src, cfg.http, privacy, env);
    case 'pagerduty': return new PagerDutyAdapter(src, cfg.http, privacy, env);
    case 'opsgenie': return new OpsgenieAdapter(src, cfg.http, privacy, env);
    case 'github': return new GitHubAdapter(src, cfg.http, links, env);
    case 'gitlab': return new GitLabAdapter(src, cfg.http, links, env);
    case 'jenkins': return new JenkinsAdapter(src, cfg.http, links, env);
    case 'azure-devops': return new AzureDevOpsAdapter(src, cfg.http, links, env);
    case 'sonarqube': return new SonarQubeAdapter(src, cfg.http, env);
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

function windowOf(src: SourceConfig, cfg: Config, state: State, o: RunOptions): { since: Date; until: Date } {
  const now = (o.now ?? (() => new Date()))();
  const st = sourceState(state, src.name);
  const since = o.since ?? (st.cursor ? new Date(Date.parse(st.cursor) - cfg.overlapMinutes * 60_000) : new Date(now.getTime() - cfg.backfillDays * DAY));
  return { since, until: now };
}

/** Read one issue or incident source and turn its records into exactly what full mode would send. */
export async function collect(adapter: Adapter, src: SourceConfig, cfg: Config, state: State, privacy: PrivacyContext, o: RunOptions): Promise<Collected> {
  const { since, until: now } = windowOf(src, cfg, state, o);
  const st = sourceState(state, src.name);
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

/** Keep issues (with their sprints) and incidents in the local copy, merged as QE Navigator merges them. */
export function storeItems(store: LocalStore, kind: Kind, items: Item[], now = Date.now()): { stored: number; skipped: Array<{ id: string; reason: string }> } {
  let stored = 0;
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const it of items) {
    const team = String(it.record.team);
    try {
      if (kind === 'issues') {
        const parsed = parseIssueBody({ issues: [it.record] }, 'json', { team });
        for (const s of parsed.sprints) if (store.put('sprint', team, s.id, mergeSprint(team, store.get('sprint', team, s.id), s, now))) stored++;
        for (const e of parsed.issues) if (store.put('issue', team, e.key, mergeIssue(team, store.get('issue', team, e.key), e))) stored++;
      } else {
        for (const e of parseIncidentBody({ incidents: [it.record] }, 'json', { team })) if (store.put('incident', team, e.id, mergeIncident(team, store.get('incident', team, e.id), e, now))) stored++;
      }
    } catch (e) {
      skipped.push({ id: it.id, reason: `not kept locally: ${(e as Error).message}` });
    }
  }
  return { stored, skipped };
}

/** Keep CI records in the local copy; returns the records that changed (what full mode sends). */
export function storeCi(store: LocalStore, records: CiRecord[]): CiRecord[] {
  const changed: CiRecord[] = [];
  for (const r of records) {
    switch (r.kind) {
      case 'testRun': if (store.put('testRun', r.team, r.rec.id, r.rec)) changed.push(r); break;
      case 'coverage': if (store.put('coverage', r.team, r.rec.id, r.rec)) changed.push(r); break;
      case 'pipeline': if (store.put('pipeline', r.team, r.rec.id, r.rec)) changed.push(r); break;
      case 'analysis': if (store.put('analysis', r.team, r.rec.id, r.rec)) changed.push(r); break;
      case 'deployment': if (store.put('deployment', r.team, r.rec.externalId, r.rec)) changed.push(r); break;
      case 'commits': {
        const fresh: CommitRec[] = [];
        for (const c of r.commits) {
          const id = `${r.deployment}\u0000${c.sha}`;
          const prev = store.get('commit', r.team, id);
          const next: CommitRec = { sha: c.sha, deployment: r.deployment, authoredAt: c.authoredAt ?? prev?.authoredAt ?? null, committedAt: c.committedAt ?? prev?.committedAt ?? null, branch: prev?.branch ?? c.branch ?? null };
          if (store.put('commit', r.team, id, next)) fresh.push(next);
        }
        if (fresh.length) changed.push({ ...r, commits: fresh });
        break;
      }
    }
  }
  return changed;
}

/** Full mode: the raw requests for the changed CI records (deployments carry their commits). */
export function rawRequests(changed: CiRecord[], store: LocalStore): RawRequest[] {
  const out: RawRequest[] = [];
  const pipes = new Map<string, Record<string, unknown>[]>();
  const deps = new Map<string, Map<string, Record<string, unknown>>>();
  const depOf = (team: string) => { if (!deps.has(team)) deps.set(team, new Map()); return deps.get(team)!; };
  for (const r of changed) {
    if (r.kind === 'testRun') { if (r.rec.cases?.length) out.push(testsRequest(r.team, r.rec)); }
    else if (r.kind === 'coverage') out.push(coverageRequest(r.team, r.rec));
    else if (r.kind === 'analysis') out.push(analysisRequest(r.team, r.rec));
    else if (r.kind === 'pipeline') { const l = pipes.get(r.team) ?? []; l.push(pipelineJson(r.rec)); pipes.set(r.team, l); }
    else if (r.kind === 'deployment' || r.kind === 'commits') {
      const id = r.kind === 'deployment' ? r.rec.externalId : r.deployment;
      const d = store.get('deployment', r.team, id);
      if (!d || !d.commit) continue;
      const commits = store.records(r.team).commits.filter((c) => c.deployment === id);
      depOf(r.team).set(id, deploymentJson(d, commits));
    }
  }
  for (const [team, list] of pipes) for (let i = 0; i < list.length; i += 100) {
    const part = list.slice(i, i + 100);
    out.push({ kind: 'pipelines', id: `pipelines:${team}:${part.map((p) => `${p.id}#${p.attempt}`).join(',')}`.slice(0, 500), query: { team }, contentType: 'application/json', body: JSON.stringify(part) });
  }
  for (const [team, m] of deps) {
    const list = Array.from(m.values());
    for (let i = 0; i < list.length; i += 200) {
      const part = list.slice(i, i + 200);
      out.push({ kind: 'deployments', id: `deployments:${team}:${part.map((p) => p.id).join(',')}`.slice(0, 500), query: { team }, contentType: 'application/json', body: JSON.stringify(part) });
    }
  }
  return out;
}

function summarise(c: Pick<Collected, 'source' | 'read' | 'items' | 'unchanged' | 'skipped' | 'since' | 'perTeam' | 'requests'>, label = 'to send'): void {
  log.info(`${c.source}: read ${c.read}, ${label} ${c.items.length}, unchanged ${c.unchanged}, skipped ${c.skipped.length}`, {
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

const errorKind = (e: unknown) => (e instanceof SourceError ? (e.auth ? 'auth' : e.status ? `http ${e.status}` : 'network') : e instanceof QeError ? 'qe-navigator' : e instanceof ConfigError ? 'config' : 'internal');

const worst = (codes: number[]) => [EXIT.QE, EXIT.SOURCE, EXIT.INTERNAL, EXIT.PARTIAL].find((c) => codes.includes(c)) ?? EXIT.OK;

const teamsOf = (cfg: Config): string[] => {
  const teams = new Set<string>();
  for (const src of cfg.sources) {
    for (const t of Object.values(src.teams)) teams.add(t);
    if ('services' in src) for (const t of Object.values(src.services)) teams.add(t);
    if ('deployJobs' in src) for (const t of Object.values(src.deployJobs)) teams.add(t);
    if (src.defaultTeam) teams.add(src.defaultTeam);
  }
  return Array.from(teams);
};

// ---------------------------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------------------------

export async function runCheck(cfg: Config, o: RunOptions = {}): Promise<number> {
  const env = o.env ?? process.env;
  const print = o.out ?? ((t: string) => process.stdout.write(t + '\n'));
  const codes: number[] = [];
  print(`qe-collector ${VERSION} (engine ${ENGINE_VERSION}): checking ${cfg.path}`);
  print(`  destination: ${cfg.qeNavigator.url} (outbound HTTPS only)`);
  print(`  privacy mode: ${cfg.privacy.mode} (${cfg.privacy.mode === 'full' ? 'minimised raw records are sent; QE Navigator calculates' : cfg.privacy.mode === 'evidence' ? 'values calculated here are sent with the allowed evidence lists; no raw records' : 'values and counts only; no names, keys, paths or titles'})`);
  if (cfg.privacy.mode === 'full') {
    print(`  privacy: titles ${cfg.privacy.sendTitles ? 'SENT' : 'not sent'}, links ${cfg.privacy.sendLinks ? 'SENT' : 'not sent'}, people ${cfg.privacy.people === 'hash' ? 'as salted hashes' : 'not sent'}`);
    print(`  issue fields sent: ${allowedFields('issue', { titles: cfg.privacy.sendTitles, links: cfg.privacy.sendLinks, people: cfg.privacy.people === 'hash' }).join(', ')}`);
    print(`  incident fields sent: ${allowedFields('incident', { titles: cfg.privacy.sendTitles, links: cfg.privacy.sendLinks, people: cfg.privacy.people === 'hash' }).join(', ')}`);
  }
  if (cfg.privacy.mode === 'metrics') print(`  local evidence page: ${cfg.privacy.localEvidenceUrl ?? 'not set (privacy.localEvidenceUrl): the app will say the details stay in your network, without a link'}`);
  print(`  state: ${cfg.statePath}; local copy: ${cfg.store.dir} (kept ${cfg.store.retentionDays} days)`);
  let privacy: PrivacyContext;
  try { privacy = privacyContext(cfg, env); } catch (e) { return errorExit(e, 'privacy'); }
  const apiKey = secret(cfg.qeNavigator.apiKeyEnv, env);
  print(`  ${cfg.qeNavigator.apiKeyEnv}: ${apiKey ? (apiKey.startsWith('igk_') ? 'set' : 'set, but does not start with igk_') : 'MISSING'}`);
  if (apiKey && !apiKey.startsWith('igk_')) codes.push(EXIT.CONFIG);
  let state: State;
  try { state = loadState(cfg.statePath); } catch (e) { print(`  state: ${(e as Error).message}`); state = emptyState(); codes.push(EXIT.CONFIG); }
  for (const src of selected(cfg, o.source)) {
    print('');
    print(`[${src.name}] ${src.type}`);
    const st = state.sources[src.name];
    print(`  next read from: ${st?.cursor ? `${st.cursor} (cursor) minus ${cfg.overlapMinutes} min` : `${cfg.backfillDays} days ago (first run)`}`);
    let adapter: AnyAdapter;
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
  const teams = teamsOf({ ...cfg, sources: selected(cfg, o.source) });
  if (!apiKey) {
    print(`  FAILED: set ${cfg.qeNavigator.apiKeyEnv} (an igk_ key from Admin console → API keys)`);
    codes.push(EXIT.CONFIG);
  } else if (teams.length) {
    const now = (o.now ?? (() => new Date()))().toISOString();
    const items: Item[] = teams.map((team, i) => ({ id: `check-${i}`, fp: '', record: { key: `QECOLLECTOR-CHECK-${i + 1}`, team, type: 'task', status: 'To Do', statusCategory: 'todo', createdAt: now } }));
    const qe = new QeClient(cfg, apiKey);
    try {
      const r = await qe.post(makeBatches('issues', items)[0], true);
      if (r.status === 200) print(`  ok: key valid, ${teams.length} team id(s) accepted (${teams.join(', ')}); dry run, nothing stored`);
      else { print(`  FAILED: HTTP ${r.status}: ${r.body?.error ?? ''}`); codes.push(EXIT.QE); }
    } catch (e) {
      print(`  FAILED: ${(e as Error).message}`);
      codes.push(EXIT.QE);
    }
  } else {
    print('  FAILED: no team ids in the config (sources[].teams / repos / projects / jobs / pipelines / services / defaultTeam)');
    codes.push(EXIT.CONFIG);
  }
  const code = codes.includes(EXIT.CONFIG) ? EXIT.CONFIG : worst(codes);
  print('');
  print(code === EXIT.OK ? 'All checks passed.' : `Checks failed (exit ${code}).`);
  return code;
}

// ---------------------------------------------------------------------------------------------
// The values (evidence and metrics modes)
// ---------------------------------------------------------------------------------------------

export interface MetricsBody {
  collector: string;
  engineVersion: string;
  mode: 'evidence' | 'metrics';
  localEvidenceUrl?: string;
  teams: Array<{ teamId: string; days: Array<{ day: string; metrics: ReturnType<typeof metricItem>[] }>; evidence?: Record<string, unknown> & { asOf: string } }>;
}

/**
 * The metric payloads to send: per team the days from `from` to today whose values changed since they were
 * last delivered (the fingerprint includes the engine version, so an engine update resends what it changes),
 * and the evidence panel when it changed. Batches of at most 60 team-days. `mark` records them as delivered.
 */
export function metricBodies(cfg: Config, store: LocalStore, state: State, from: string, now: number, opts: { all?: boolean; teams?: string[] } = {}): { bodies: MetricsBody[]; mark: (b: MetricsBody) => void; values: number } {
  const mode = cfg.privacy.mode as 'evidence' | 'metrics';
  state.metrics = state.metrics ?? {};
  state.evidence = state.evidence ?? {};
  const today = dayOf(now);
  const days = daysBetween(from < today ? from : today, today);
  const bodies: MetricsBody[] = [];
  const base = (): MetricsBody => ({ collector: `qe-collector/${VERSION}`, engineVersion: ENGINE_VERSION, mode, ...(mode === 'metrics' && cfg.privacy.localEvidenceUrl ? { localEvidenceUrl: cfg.privacy.localEvidenceUrl } : {}), teams: [] });
  let cur = base();
  let size = 0;
  let values = 0;
  const fps = new Map<MetricsBody, Array<[string, string, 'metrics' | 'evidence']>>();
  const push = (team: string, entry: { day: string; metrics: ReturnType<typeof metricItem>[] } | null, evidence: (Record<string, unknown> & { asOf: string }) | null, marks: Array<[string, string, 'metrics' | 'evidence']>) => {
    if (size >= 60) { bodies.push(cur); cur = base(); size = 0; }
    let t = cur.teams.find((x) => x.teamId === team);
    if (!t) { t = { teamId: team, days: [] }; cur.teams.push(t); }
    if (entry) { t.days.push(entry); size++; values += entry.metrics.length; }
    if (evidence) t.evidence = evidence;
    fps.set(cur, [...(fps.get(cur) ?? []), ...marks]);
  };
  const allowed = new Set(teamsOf(cfg));
  for (const team of (opts.teams ?? store.teams()).filter((t) => allowed.has(t))) {
    const recs = store.records(team);
    const main = cfg.mainBranches[team] ?? null;
    for (const d of calculate(recs, days, main, now)) {
      if (!d.metrics.length) continue;
      const items = d.metrics.map((m) => metricItem(m, mode));
      const k = `${team}|${d.day}`;
      const fp = fingerprint({ e: ENGINE_VERSION, mode, items });
      if (!opts.all && state.metrics[k] === fp) continue;
      push(team, { day: d.day, metrics: items }, null, [[k, fp, 'metrics']]);
    }
    if (mode === 'evidence') {
      const ev = teamEvidenceItem(teamEvidence(recs, today, main), mode)!;
      const fp = fingerprint({ e: ENGINE_VERSION, ev });
      if (opts.all || state.evidence[team] !== fp) push(team, null, { asOf: today, ...ev }, [[team, fp, 'evidence']]);
    }
  }
  if (cur.teams.length) bodies.push(cur);
  const mark = (b: MetricsBody) => { for (const [k, fp, kind] of fps.get(b) ?? []) (kind === 'metrics' ? state.metrics! : state.evidence!)[k] = fp; };
  return { bodies, mark, values };
}

/** The heartbeat body: versions, sources with their last success and error counts, the local copy's size. No data. */
export function heartbeatBody(cfg: Config, state: State, store: LocalStore | null): Record<string, unknown> {
  return {
    collector: `qe-collector/${VERSION}`, version: VERSION, engineVersion: ENGINE_VERSION, mode: cfg.privacy.mode,
    ...(cfg.privacy.localEvidenceUrl ? { localEvidenceUrl: cfg.privacy.localEvidenceUrl } : {}),
    node: process.versions.node, platform: process.platform,
    sources: cfg.sources.filter((s) => s.enabled).map((s) => {
      const st = state.sources[s.name];
      return { name: s.name, type: s.type, lastSuccessAt: st?.lastSuccessAt ?? null, errors: st?.errors ?? 0, lastErrorAt: st?.lastErrorAt ?? null, lastErrorKind: st?.lastErrorKind ?? null };
    }),
    teams: teamsOf(cfg).length,
    store: store ? { records: store.count(), ...store.size() } : null,
  };
}

export async function sendHeartbeat(cfg: Config, qe: QeClient, state: State, store: LocalStore | null): Promise<boolean> {
  if (!cfg.heartbeat) return false;
  try {
    const body = JSON.stringify(heartbeatBody(cfg, state, store));
    const r = await qe.send('/api/ingest/collector/heartbeat', {}, 'application/json', body, null, { kind: 'heartbeat' });
    if (r.status === 200 || r.status === 201) { state.lastHeartbeatAt = new Date().toISOString(); return true; }
    log.warn(`heartbeat not accepted (HTTP ${r.status}): ${String(r.body?.error ?? '').slice(0, 200)}`);
  } catch (e) {
    if (e instanceof QeError && e.auth) throw e;
    log.warn(`heartbeat not sent: ${(e as Error).message}`);
  }
  return false;
}

async function deliverMetrics(qe: QeClient, bodies: MetricsBody[], mark: (b: MetricsBody) => void, save: () => void): Promise<{ sent: number; refused: number }> {
  let sent = 0;
  let refused = 0;
  for (const b of bodies) {
    const json = JSON.stringify(b);
    const r = await qe.send('/api/ingest/collector/metrics', {}, 'application/json', json, keyOf('metrics', json), { kind: 'metrics', teams: b.teams.length });
    if (r.status === 200 || r.status === 201) { mark(b); save(); sent++; continue; }
    if (r.status === 400 || r.status === 413) { refused++; log.warn(`calculated values refused by QE Navigator (HTTP ${r.status}): ${String(r.body?.error ?? '').slice(0, 300)}`, { details: r.body?.details }); continue; }
    throw new QeError(`QE Navigator refused the calculated values (HTTP ${r.status}): ${String(r.body?.error ?? '').slice(0, 300)}`, r.status);
  }
  return { sent, refused };
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
  const now = (o.now ?? (() => new Date()))();
  const report: any = {
    collector: `qe-collector/${VERSION}`, engineVersion: ENGINE_VERSION, generatedAt: now.toISOString(), destination: cfg.qeNavigator.url, mode: cfg.privacy.mode,
    privacy: cfg.privacy, note: `Each request below is exactly what "qe-collector sync" would send now in ${cfg.privacy.mode} mode (body shown as JSON or text; sent gzip-compressed). Nothing was sent and nothing was stored.`,
    sources: [] as any[], requests: [] as any[],
  };
  // A scratch copy of the local records: the preview stores nothing.
  const scratch = new LocalStore(cfg.store.dir, cfg.store.retentionDays, cfg.store.detailDays, { memoryOnly: true });
  scratch.load();
  const dry = async (req: any, path: string, query: Record<string, string>, contentType: string, body: string) => {
    if (!apiKey) return;
    try {
      const r = await qe.send(path, { ...query, dryRun: 'true' }, contentType, body, null, { preview: true });
      req.dryRun = { status: r.status, answer: r.body };
      if (r.status !== 200) codes.push(EXIT.QE);
    } catch (e) {
      req.dryRun = { error: (e as Error).message };
      codes.push(EXIT.QE);
    }
  };
  for (const src of selected(cfg, o.source)) {
    try {
      const adapter = adapterFor(src, cfg, privacy, env);
      if (adapter.kind === 'ci') {
        const { since, until } = windowOf(src, cfg, state, o);
        const recs: CiRecord[] = [];
        const skipped: Array<{ id: string; reason: string }> = [];
        for await (const page of adapter.collect(since, until)) { recs.push(...page.records); skipped.push(...page.skipped); }
        const changed = o.all ? recs : storeCi(scratch, recs);
        const perKind: Record<string, number> = {};
        for (const r of changed) perKind[r.kind] = (perKind[r.kind] ?? 0) + 1;
        report.sources.push({ name: src.name, type: src.type, since: since.toISOString(), until: until.toISOString(), read: recs.length, new: changed.length, perKind, skipped: skipped.slice(0, 100), skippedTotal: skipped.length });
        summarise({ source: src.name, read: recs.length, items: changed as any, unchanged: recs.length - changed.length, skipped, since, perTeam: {}, requests: adapter.requests() }, 'new');
        if (cfg.privacy.mode === 'full') {
          for (const q of rawRequests(changed, scratch)) {
            const req: any = { source: src.name, method: 'POST', url: qe.endpoint(`/api/ingest/${q.kind}`, q.query), headers: { Authorization: 'Bearer [redacted]', 'Content-Type': q.contentType, 'Content-Encoding': 'gzip' }, bytes: Buffer.byteLength(q.body), body: q.contentType === 'application/json' ? JSON.parse(q.body) : q.body };
            await dry(req, `/api/ingest/${q.kind}`, q.query, q.contentType, q.body);
            report.requests.push(req);
          }
        }
        continue;
      }
      const c = await collect(adapter, src, cfg, state, privacy, o);
      summarise(c);
      storeItems(scratch, c.kind, c.items);
      report.sources.push({
        name: src.name, type: src.type, since: c.since.toISOString(), until: c.until.toISOString(), read: c.read, toSend: c.items.length, unchanged: c.unchanged,
        perTeam: c.perTeam, skipped: c.skipped.slice(0, 100), skippedTotal: c.skipped.length,
      });
      if (cfg.privacy.mode !== 'full') continue;
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
  if (cfg.privacy.mode !== 'full') {
    const from = dayOf((o.since ?? new Date(now.getTime() - cfg.recalcDays * DAY)).getTime());
    const { bodies } = metricBodies(cfg, scratch, { ...state, metrics: { ...(state.metrics ?? {}) }, evidence: { ...(state.evidence ?? {}) } }, from, now.getTime(), { all: o.all });
    for (const b of bodies) {
      const json = JSON.stringify(b);
      const req: any = { method: 'POST', url: qe.endpoint('/api/ingest/collector/metrics', {}), headers: { Authorization: 'Bearer [redacted]', 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Idempotency-Key': keyOf('metrics', json) }, values: b.teams.reduce((n, t) => n + t.days.reduce((m, d) => m + d.metrics.length, 0), 0), bytes: Buffer.byteLength(json), body: b };
      await dry(req, '/api/ingest/collector/metrics', {}, 'application/json', json);
      report.requests.push(req);
    }
  }
  report.heartbeat = { url: qe.endpoint('/api/ingest/collector/heartbeat', {}), body: heartbeatBody(cfg, state, scratch) };
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
  let state: State | null = null;
  const qe = new QeClient(cfg, apiKey);
  const store = new LocalStore(cfg.store.dir, cfg.store.retentionDays, cfg.store.detailDays);
  try {
    try { state = loadState(cfg.statePath); } catch (e) { return errorExit(new ConfigError((e as Error).message), 'state'); }
    const st0 = state;
    const save = () => saveState(cfg.statePath, st0);
    const loaded = store.load();
    if (loaded.damaged) log.warn(`local copy: ${loaded.damaged} damaged line(s) skipped`, { dir: cfg.store.dir });
    const startSeq = store.sequence;
    const budget = { extraRequests: 40 };
    let earliest = Infinity;
    for (const src of selected(cfg, o.source)) {
      const t0 = Date.now();
      const st = sourceState(state, src.name);
      try {
        const adapter = adapterFor(src, cfg, privacy, env);
        if (adapter.kind === 'ci') {
          const r = await syncCi(adapter, src as CiSourceConfig, cfg, state, store, qe, o, save);
          if (r.refused) codes.push(EXIT.PARTIAL);
          earliest = Math.min(earliest, r.earliest);
        } else {
          const c = await collect(adapter, src, cfg, state, privacy, o);
          summarise(c, cfg.privacy.mode === 'full' ? 'to send' : 'new or changed');
          const kept = storeItems(store, c.kind, c.items);
          for (const s of kept.skipped) log.warn(`${src.name}: ${s.id}: ${s.reason}`);
          for (const it of c.items) {
            const times = [it.record.createdAt, it.record.openedAt, it.record.resolvedAt, it.record.updatedAt].filter((x): x is string => typeof x === 'string').map(Date.parse);
            if (times.length) earliest = Math.min(earliest, ...times);
          }
          let written = 0;
          let duplicate = 0;
          let rejected = 0;
          if (cfg.privacy.mode === 'full') {
            for (const b of makeBatches(c.kind, c.items)) {
              const r = await deliver(qe, b, budget, (items) => {
                for (const it of items) { delete st.sent[it.id]; st.sent[it.id] = it.fp; if (st.rejected) delete st.rejected[it.id]; }
                save();
              });
              written += r.written;
              duplicate += r.duplicate;
              if (r.rejected.length) {
                st.rejected = st.rejected ?? {};
                for (const x of r.rejected) st.rejected[x.item.id] = x.item.fp;
                rejected += r.rejected.length;
              }
            }
          } else {
            for (const it of c.items) { delete st.sent[it.id]; st.sent[it.id] = it.fp; }
          }
          // Every record read was delivered (or refused one by one) or kept: the cursor moves on.
          const next = c.maxChangedAt && adapter.kind === 'issues' ? c.maxChangedAt : c.until.toISOString();
          if (!st.cursor || next > st.cursor) st.cursor = next;
          if (cfg.privacy.mode === 'full') {
            log.info(`${src.name}: delivered ${c.items.length - rejected} (${written} new or changed, ${duplicate} already known), refused ${rejected}`, {
              source: src.name, cursor: st.cursor, seconds: Math.round((Date.now() - t0) / 100) / 10, qeRequests: qe.requests,
            });
          } else log.info(`${src.name}: kept ${kept.stored} record(s) in the local copy`, { source: src.name, cursor: st.cursor, seconds: Math.round((Date.now() - t0) / 100) / 10 });
          if (rejected) codes.push(EXIT.PARTIAL);
        }
        st.lastSuccessAt = new Date().toISOString();
        st.errors = 0;
        save();
      } catch (e) {
        codes.push(errorExit(e, src.name));
        st.errors = (st.errors ?? 0) + 1;
        st.lastErrorAt = new Date().toISOString();
        st.lastErrorKind = errorKind(e);
        // Records delivered before the failure stay recorded; the cursor does not move.
        try { save(); } catch { /* reported by the next run */ }
        if (e instanceof QeError && e.auth) break;
      }
    }
    const compacted = store.compact();
    if (compacted.deletedFiles || compacted.rewrittenFiles) log.info('local copy compacted', compacted);
    // evidence / metrics: calculate here, send the values.
    if (cfg.privacy.mode !== 'full' && !codes.includes(EXIT.QE)) {
      const now = Date.now();
      const changedFrom = store.changedSince(startSeq).reduce((m, x) => Math.min(m, x.time), earliest);
      const from = o.since ? o.since.getTime() : Math.max(now - cfg.store.retentionDays * DAY, Math.min(now - cfg.recalcDays * DAY, changedFrom));
      try {
        const { bodies, mark, values } = metricBodies(cfg, store, state, dayOf(from), now);
        const r = await deliverMetrics(qe, bodies, mark, save);
        log.info(`calculated with engine ${ENGINE_VERSION}: ${values} value(s) changed, delivered in ${r.sent} request(s)${r.refused ? `, ${r.refused} refused` : ''}`, { mode: cfg.privacy.mode, from: dayOf(from) });
        if (r.refused) codes.push(EXIT.PARTIAL);
      } catch (e) { codes.push(errorExit(e, 'values')); }
    }
    if (!codes.includes(EXIT.QE)) {
      try { await sendHeartbeat(cfg, qe, state, store); save(); } catch (e) { codes.push(errorExit(e, 'heartbeat')); }
    }
  } finally {
    release();
  }
  return worst(codes);
}

async function syncCi(adapter: CiAdapter, src: CiSourceConfig, cfg: Config, state: State, store: LocalStore, qe: QeClient, o: RunOptions, save: () => void): Promise<{ refused: number; earliest: number }> {
  const { since, until } = windowOf(src, cfg, state, o);
  const st = sourceState(state, src.name);
  let read = 0;
  let maxChanged: string | null = null;
  const changed: CiRecord[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for await (const page of adapter.collect(since, until)) {
    read += page.records.length;
    skipped.push(...page.skipped);
    changed.push(...storeCi(store, page.records));
    if (page.changedAt && (!maxChanged || page.changedAt > maxChanged)) maxChanged = page.changedAt;
  }
  const perTeam: Record<string, number> = {};
  for (const r of changed) perTeam[r.team] = (perTeam[r.team] ?? 0) + 1;
  summarise({ source: src.name, read, items: changed as any, unchanged: read - changed.length, skipped, since, perTeam, requests: adapter.requests() }, 'new or changed');
  let refused = 0;
  if (cfg.privacy.mode === 'full') {
    for (const q of rawRequests(changed, store)) {
      const fp = fingerprint(q.body);
      if (st.sent[q.id] === fp) continue;
      const r = await qe.send(`/api/ingest/${q.kind}`, q.query, q.contentType, q.body, keyOf(q.kind, `${JSON.stringify(q.query)}\n${q.body}`), { kind: q.kind });
      if (r.status === 200 || r.status === 201) { st.sent[q.id] = fp; save(); continue; }
      if (r.status === 400 || r.status === 413 || r.status === 415) { refused++; st.rejected = st.rejected ?? {}; st.rejected[q.id] = fp; log.warn(`${src.name}: ${q.kind} refused by QE Navigator (HTTP ${r.status}): ${String(r.body?.error ?? '').slice(0, 300)}`, { id: q.id.slice(0, 120) }); continue; }
      throw new QeError(`QE Navigator refused ${q.kind} (HTTP ${r.status}): ${String(r.body?.error ?? '').slice(0, 300)}`, r.status);
    }
  }
  const next = maxChanged && maxChanged < until.toISOString() ? maxChanged : until.toISOString();
  if (!st.cursor || next > st.cursor) st.cursor = next;
  const times = changed.map((r) => (r.kind === 'commits' ? r.commits[0]?.authoredAt ?? Infinity : r.kind === 'deployment' ? r.rec.finishedAt : r.kind === 'analysis' ? r.rec.analyzedAt : r.kind === 'coverage' ? r.rec.createdAt : r.rec.startedAt));
  log.info(`${src.name}: kept ${changed.length} new or changed record(s)${cfg.privacy.mode === 'full' ? ', sent the raw records' : ''}`, { source: src.name, cursor: st.cursor });
  return { refused, earliest: times.length ? Math.min(...times) : Infinity };
}

// ---------------------------------------------------------------------------------------------
// recalc
// ---------------------------------------------------------------------------------------------

/**
 * Recalculate from the local copy (no source is read): after an engine update, or to resend a period. Values
 * that the engine now calculates differently (or with a new engine version) are sent again; the rest is not.
 */
export async function runRecalc(cfg: Config, o: RunOptions = {}): Promise<number> {
  const env = o.env ?? process.env;
  if (!o.since) { log.error('recalc needs --since DATE (the first day to recalculate)'); return EXIT.CONFIG; }
  if (cfg.privacy.mode === 'full') { log.error('privacy.mode is full: QE Navigator calculates from the raw records it has; recalc is for the evidence and metrics modes'); return EXIT.CONFIG; }
  let apiKey: string | null = null;
  if (!o.offline) {
    try { apiKey = requireSecret(cfg.qeNavigator.apiKeyEnv, 'QE Navigator API key (Admin console → API keys)', env); } catch (e) { return errorExit(e, 'config'); }
  }
  let release: () => void;
  try { release = acquireLock(cfg.statePath); } catch (e) { log.error((e as Error).message); return EXIT.LOCKED; }
  try {
    let state: State;
    try { state = loadState(cfg.statePath); } catch (e) { return errorExit(new ConfigError((e as Error).message), 'state'); }
    const store = new LocalStore(cfg.store.dir, cfg.store.retentionDays, cfg.store.detailDays);
    const loaded = store.load();
    if (!loaded.records) { log.error(`the local copy ${cfg.store.dir} is empty: run sync first`); return EXIT.CONFIG; }
    const now = (o.now ?? (() => new Date()))().getTime();
    const { bodies, mark, values } = metricBodies(cfg, store, state, dayOf(o.since.getTime()), now, { all: o.all });
    if (o.offline) {
      (o.out ?? ((t: string) => process.stdout.write(t + '\n')))(JSON.stringify({ engineVersion: ENGINE_VERSION, values, requests: bodies.length, bodies }, null, 2));
      return EXIT.OK;
    }
    const qe = new QeClient(cfg, apiKey);
    const r = await deliverMetrics(qe, bodies, mark, () => saveState(cfg.statePath, state));
    log.info(`recalculated from ${dayOf(o.since.getTime())} with engine ${ENGINE_VERSION}: ${values} value(s) changed, delivered in ${r.sent} request(s)`, { refused: r.refused });
    await sendHeartbeat(cfg, qe, state, store);
    saveState(cfg.statePath, state);
    return r.refused ? EXIT.PARTIAL : EXIT.OK;
  } catch (e) {
    return errorExit(e, 'recalc');
  } finally {
    release();
  }
}

export { isCiSource };
