/**
 * The commands: check, preview, sync (incremental or --since backfill).
 *
 * A sync reads every source (issues and incidents from Jira, Linear, PagerDuty, Opsgenie; pipeline runs, test
 * reports, coverage reports, SARIF and deployments from GitHub, GitLab, Bitbucket, Jenkins, Azure DevOps and
 * SonarQube; KPI values from a file), and sends what is new or changed to QE Navigator as JSON envelopes, one per
 * team and kind, each naming the company, the department and the team. The Exporter calculates nothing and keeps no
 * data: the state file holds the cursors and the fingerprints of what was delivered. Every run ends with a heartbeat
 * (version, sources, last success, error counts; no data).
 */
import { readFileSync } from 'node:fs';
import type { Config, KpisSource, SourceConfig } from './config';
import { ConfigError, isCiSource, mappedTeams, requireSecret, secret, targetProblems } from './config';
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
import { BitbucketAdapter } from './sources/ci/bitbucket';
import { BitbucketDcAdapter } from './sources/ci/bitbucketDc';
import { JenkinsAdapter } from './sources/ci/jenkins';
import { AzureDevOpsAdapter } from './sources/ci/azure';
import { SonarQubeAdapter } from './sources/ci/sonarqube';
import type { CiAdapter } from './sources/ci/common';
import { QeClient, QeError, deliver, makeBatches, type Batch, type EnvelopeKind, type Part } from './sender';
import { allowedFields } from './policy';
import { refreshOAuth } from './oauth';
import { VERSION } from './version';

export const EXIT = { OK: 0, INTERNAL: 1, CONFIG: 2, SOURCE: 3, QE: 4, LOCKED: 5, PARTIAL: 6 } as const;

export interface RunOptions {
  since?: Date | null;
  source?: string | null;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** check: do not call QE Navigator (preview never calls it). */
  offline?: boolean;
  /** preview: include what was already delivered. */
  all?: boolean;
  out?: (text: string) => void;
}

type AnyAdapter = Adapter | CiAdapter | KpisAdapter;

export function adapterFor(src: SourceConfig, cfg: Config, privacy: PrivacyContext, env: NodeJS.ProcessEnv): AnyAdapter {
  const links = { links: cfg.privacy.sendLinks };
  switch (src.type) {
    case 'jira': return new JiraAdapter(src, cfg.http, privacy, env);
    case 'linear': return new LinearAdapter(src, cfg.http, privacy, env);
    case 'pagerduty': return new PagerDutyAdapter(src, cfg.http, privacy, env);
    case 'opsgenie': return new OpsgenieAdapter(src, cfg.http, privacy, env);
    case 'github': return new GitHubAdapter(src, cfg.http, links, env);
    case 'gitlab': return new GitLabAdapter(src, cfg.http, links, env);
    case 'bitbucket': return new BitbucketAdapter(src, cfg.http, links, env);
    case 'bitbucket-dc': return new BitbucketDcAdapter(src, cfg.http, links, env);
    case 'jenkins': return new JenkinsAdapter(src, cfg.http, links, env);
    case 'azure-devops': return new AzureDevOpsAdapter(src, cfg.http, links, env);
    case 'sonarqube': return new SonarQubeAdapter(src, cfg.http, env);
    case 'kpis': return new KpisAdapter(src);
  }
}

/**
 * KPI values that no tool records as raw data (automation coverage, automation ROI, …), from a JSON file your own
 * scripts write: { "items": [ { "team": "<key>", "recordedAt": "<ISO time>", "metrics": { "automation_coverage": 61.5 } } ] }.
 * The values are QE Navigator's KPI columns, validated by QE Navigator; nothing is calculated here.
 */
export class KpisAdapter {
  kind = 'kpis' as const;
  constructor(private src: KpisSource) {}
  requests(): number { return 0; }
  describe(): string[] { return [`the KPI values in ${this.src.path} (teams: ${Object.entries(this.src.teams).map(([k, t]) => `${k} → ${t}`).join(', ') || `all → ${this.src.defaultTeam}`})`]; }
  private read(): any[] {
    let raw: any;
    try { raw = JSON.parse(readFileSync(this.src.path, 'utf8')); } catch (e) { throw new SourceError(`${this.src.name}: cannot read ${this.src.path}: ${(e as Error).message}`); }
    return Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [];
  }
  async check(): Promise<string[]> { return [`${this.read().length} value set(s) in ${this.src.path}`]; }
  items(since: Date): { parts: Array<{ team: string; part: Part }>; skipped: Array<{ id: string; reason: string }> } {
    const parts: Array<{ team: string; part: Part }> = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const [i, x] of this.read().entries()) {
      const team = (typeof x?.team === 'string' && this.src.teams[x.team]) || this.src.defaultTeam;
      const id = `kpis:${x?.team ?? '?'}|${x?.recordedAt ?? i}`;
      if (!team) { skipped.push({ id, reason: `team ${x?.team ?? '?'} is not mapped (sources[].teams)` }); continue; }
      if (!x || typeof x.metrics !== 'object' || Array.isArray(x.metrics)) { skipped.push({ id, reason: 'no metrics object' }); continue; }
      if (x.recordedAt && Date.parse(x.recordedAt) < since.getTime()) continue;
      const item = { ...(x.recordedAt ? { recordedAt: String(x.recordedAt) } : {}), metrics: x.metrics };
      parts.push({ team, part: { id, fp: fingerprint(item), item } });
    }
    return { parts, skipped };
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

function windowOf(src: SourceConfig, cfg: Config, state: State, o: RunOptions): { since: Date; until: Date } {
  const now = (o.now ?? (() => new Date()))();
  const st = sourceState(state, src.name);
  const since = o.since ?? (st.cursor ? new Date(Date.parse(st.cursor) - cfg.overlapMinutes * 60_000) : new Date(now.getTime() - cfg.backfillDays * DAY));
  return { since, until: now };
}

/** What one source gives: per team and kind the parts not yet delivered. */
export interface Collected {
  source: string;
  since: Date;
  until: Date;
  read: number;
  unchanged: number;
  skipped: Array<{ id: string; reason: string }>;
  groups: Map<string, { team: string; kind: EnvelopeKind; parts: Part[] }>;
  /** The newest change time read (the cursor moves to it after a successful delivery). */
  cursor: string;
  requests: number;
}

const groupKey = (team: string, kind: string) => `${team}\u0000${kind}`;

/** Read one source and turn what it gives into envelope parts (issues and incidents through the allow-list and send policy). */
export async function collect(adapter: AnyAdapter, src: SourceConfig, cfg: Config, state: State, privacy: PrivacyContext, o: RunOptions): Promise<Collected> {
  const { since, until } = windowOf(src, cfg, state, o);
  const st = sourceState(state, src.name);
  const c: Collected = { source: src.name, since, until, read: 0, unchanged: 0, skipped: [], groups: new Map(), cursor: until.toISOString(), requests: 0 };
  const add = (team: string, kind: EnvelopeKind, part: Part) => {
    c.read++;
    if (!o.all && (st.sent[part.id] === part.fp || st.rejected?.[part.id] === part.fp)) { c.unchanged++; return; }
    const k = groupKey(team, kind);
    if (!c.groups.has(k)) c.groups.set(k, { team, kind, parts: [] });
    const g = c.groups.get(k)!;
    const i = g.parts.findIndex((p) => p.id === part.id);
    if (i >= 0) g.parts.splice(i, 1);
    g.parts.push(part);
  };
  if (adapter.kind === 'kpis') {
    const r = adapter.items(since);
    for (const x of r.parts) add(x.team, 'kpis', x.part);
    c.skipped.push(...r.skipped);
    return c;
  }
  if (adapter.kind === 'ci') {
    let maxChanged: string | null = null;
    for await (const page of adapter.collect(since, until)) {
      c.skipped.push(...page.skipped);
      for (const r of page.records) add(r.team, r.kind, { id: r.id, fp: fingerprint(r.item), item: r.item });
      if (page.changedAt && (!maxChanged || page.changedAt > maxChanged)) maxChanged = page.changedAt;
    }
    c.cursor = maxChanged && maxChanged < until.toISOString() ? maxChanged : until.toISOString();
    c.requests = adapter.requests();
    return c;
  }
  const oldest = until.getTime() - 364 * DAY;
  const newest = until.getTime() + 5 * 60_000;
  let maxChanged: string | null = null;
  for await (const page of adapter.collect(since, until)) {
    c.skipped.push(...page.skipped);
    for (const r of page.records) {
      if (r.changedAt && (!maxChanged || r.changedAt > maxChanged)) maxChanged = r.changedAt;
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
      // The team is the envelope's: it is not repeated in the item.
      const { team, ...item } = rec;
      add(String(team), adapter.kind, { id: r.id, fp: fingerprint(item), item });
    }
  }
  c.cursor = maxChanged && adapter.kind === 'issues' ? maxChanged : until.toISOString();
  c.requests = adapter.requests();
  return c;
}

/** The longest period of records one envelope covers (issues and incidents: shorter, their calculation reads more days). */
export const SPAN_DAYS = 14;
const SPAN_OF: Partial<Record<EnvelopeKind, number>> = { issues: 7, incidents: 7 };

/** The time an item is about (for ordering: each envelope then covers a short period, so QE Navigator recalculates few days per request). */
const timeOf = (it: Record<string, unknown>): string => String(it.updatedAt ?? it.createdAt ?? it.finishedAt ?? it.startedAt ?? it.openedAt ?? it.recordedAt ?? '');

/** The envelopes of what a source gave, per team and kind (oldest first), with the company and the team's department. */
export function batchesOf(cfg: Config, c: Collected): Batch[] {
  const out: Batch[] = [];
  for (const g of c.groups.values()) {
    const departmentId = cfg.teams[g.team];
    if (!cfg.qeNavigator.companyId || !departmentId) throw new ConfigError(targetProblems(cfg).join('; ') || `team ${g.team} has no department in "teams"`);
    const parts = [...g.parts].sort((a, b) => timeOf(a.item).localeCompare(timeOf(b.item)));
    // At most SPAN_DAYS of records per envelope: QE Navigator recalculates the days a request touches while it answers.
    let start = 0;
    for (let i = 1; i <= parts.length; i++) {
      const t0 = Date.parse(timeOf(parts[start].item));
      const ti = i < parts.length ? Date.parse(timeOf(parts[i].item)) : NaN;
      if (i < parts.length && !(Number.isFinite(t0) && Number.isFinite(ti) && ti - t0 > (SPAN_OF[g.kind] ?? SPAN_DAYS) * DAY)) continue;
      out.push(...makeBatches({ companyId: cfg.qeNavigator.companyId, departmentId, teamId: g.team, source: c.source, kind: g.kind }, parts.slice(start, i)));
      start = i;
    }
  }
  return out;
}

function summarise(c: Collected): void {
  const perTeam: Record<string, number> = {};
  let toSend = 0;
  for (const g of c.groups.values()) { perTeam[g.team] = (perTeam[g.team] ?? 0) + g.parts.length; toSend += g.parts.length; }
  log.info(`${c.source}: read ${c.read}, to send ${toSend}, unchanged ${c.unchanged}, skipped ${c.skipped.length}`, { source: c.source, since: c.since.toISOString(), perTeam, sourceRequests: c.requests });
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

const worst = (codes: number[]) => [EXIT.CONFIG, EXIT.QE, EXIT.SOURCE, EXIT.INTERNAL, EXIT.PARTIAL].find((c) => codes.includes(c)) ?? EXIT.OK;

function warnIgnored(cfg: Config): void {
  if (cfg.ignored.length) log.warn(`config: ${cfg.ignored.join(', ')} no longer apply (the Exporter sends the raw data; QE Navigator calculates) and are ignored`);
}

// ---------------------------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------------------------

export async function runCheck(cfg: Config, o: RunOptions = {}): Promise<number> {
  const env = o.env ?? process.env;
  const print = o.out ?? ((t: string) => process.stdout.write(t + '\n'));
  const codes: number[] = [];
  print(`qe-exporter ${VERSION}: checking ${cfg.path}`);
  print(`  destination: ${cfg.qeNavigator.url} (outbound HTTPS only; the raw data is sent as JSON, QE Navigator calculates)`);
  print(`  company: ${cfg.qeNavigator.companyId ?? 'NOT SET (qeNavigator.companyId)'}`);
  for (const p of targetProblems(cfg)) { print(`  FAILED: ${p}`); codes.push(EXIT.CONFIG); }
  if (cfg.ignored.length) print(`  ignored (no longer used): ${cfg.ignored.join(', ')}`);
  print(`  privacy: titles ${cfg.privacy.sendTitles ? 'SENT' : 'not sent'}, links ${cfg.privacy.sendLinks ? 'SENT' : 'not sent'}, people ${cfg.privacy.people === 'hash' ? 'as salted hashes' : 'not sent'}`);
  print(`  issue fields sent: ${allowedFields('issue', { titles: cfg.privacy.sendTitles, links: cfg.privacy.sendLinks, people: cfg.privacy.people === 'hash' }).join(', ')}`);
  print(`  incident fields sent: ${allowedFields('incident', { titles: cfg.privacy.sendTitles, links: cfg.privacy.sendLinks, people: cfg.privacy.people === 'hash' }).join(', ')}`);
  print(`  state: ${cfg.statePath} (cursors and fingerprints only); credentials file: ${cfg.credentialsPath}`);
  let privacy: PrivacyContext;
  try { privacy = privacyContext(cfg, env); } catch (e) { return errorExit(e, 'privacy'); }
  const apiKey = secret(cfg.qeNavigator.apiKeyEnv, env);
  print(`  ${cfg.qeNavigator.apiKeyEnv}: ${apiKey ? (apiKey.startsWith('igk_') ? 'set' : 'set, but does not start with igk_') : 'MISSING'}`);
  if (apiKey && !apiKey.startsWith('igk_')) codes.push(EXIT.CONFIG);
  let state: State;
  try { state = loadState(cfg.statePath); } catch (e) { print(`  state: ${(e as Error).message}`); state = emptyState(); codes.push(EXIT.CONFIG); }
  try { await refreshOAuth(cfg, env); } catch (e) { print(`  OAuth: ${(e as Error).message}`); codes.push(EXIT.SOURCE); }
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
  const teams = mappedTeams({ sources: selected(cfg, o.source) });
  if (o.offline) print('  skipped (--offline)');
  else if (!apiKey) {
    print(`  FAILED: set ${cfg.qeNavigator.apiKeyEnv} (an igk_ key from Admin console → API keys, or the setup page)`);
    codes.push(EXIT.CONFIG);
  } else {
    const qe = new QeClient(cfg, apiKey);
    try {
      const ctx = await qe.context();
      print(`  ok: key valid for ${ctx.company.name ?? ctx.company.id} (company id ${ctx.company.id})`);
      if (cfg.qeNavigator.companyId && cfg.qeNavigator.companyId !== ctx.company.id) { print(`  FAILED: qeNavigator.companyId is ${cfg.qeNavigator.companyId}, but the key belongs to company ${ctx.company.id}`); codes.push(EXIT.CONFIG); }
      for (const t of teams) {
        const dep = ctx.departments.find((d) => d.teams.some((x) => x.id === t));
        if (!dep) { print(`  FAILED: team ${t} is not an active team of your company`); codes.push(EXIT.CONFIG); continue; }
        if (cfg.teams[t] && cfg.teams[t] !== dep.id) { print(`  FAILED: team ${t} is in department ${dep.id} (${dep.name}), not ${cfg.teams[t]}`); codes.push(EXIT.CONFIG); continue; }
        if (!cfg.teams[t]) print(`  add to "teams": ${t}: ${dep.id}   # ${dep.name}`);
        else print(`  ok: ${t} (${dep.teams.find((x) => x.id === t)!.name}) in ${dep.name}`);
      }
      // A dry run per team: QE Navigator checks the three ids exactly as for a sync; nothing is stored.
      if (!targetProblems(cfg).length) {
        const now = (o.now ?? (() => new Date()))().toISOString();
        for (const t of teams) {
          const [b] = makeBatches({ companyId: cfg.qeNavigator.companyId!, departmentId: cfg.teams[t], teamId: t, source: 'check', kind: 'issues' }, [{ id: 'check', fp: '', item: { key: 'QEEXPORTER-CHECK-1', type: 'task', status: 'To Do', statusCategory: 'todo', createdAt: now } }]);
          const r = await qe.post(b, true);
          if (r.status === 200) print(`  ok: dry run for ${t} accepted (nothing stored)`);
          else { print(`  FAILED: dry run for ${t}: HTTP ${r.status}: ${r.body?.error ?? ''}`); codes.push(EXIT.QE); }
        }
      }
    } catch (e) {
      print(`  FAILED: ${(e as Error).message}`);
      codes.push(EXIT.QE);
    }
  }
  const code = worst(codes);
  print('');
  print(code === EXIT.OK ? 'All checks passed.' : `Checks failed (exit ${code}).`);
  return code;
}

// ---------------------------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------------------------

/** The heartbeat body: the version and the sources with their last success and error counts. No data. */
export function heartbeatBody(cfg: Config, state: State): Record<string, unknown> {
  return {
    exporter: `qe-exporter/${VERSION}`, version: VERSION, node: process.versions.node, platform: process.platform,
    sources: cfg.sources.filter((s) => s.enabled && s.type !== 'kpis').map((s) => {
      const st = state.sources[s.name];
      return { name: s.name, type: s.type, lastSuccessAt: st?.lastSuccessAt ?? null, errors: st?.errors ?? 0, lastErrorAt: st?.lastErrorAt ?? null, lastErrorKind: st?.lastErrorKind ?? null };
    }),
    teams: mappedTeams(cfg).length,
  };
}

/**
 * Print every envelope exactly as "sync" would send it now (URL, headers with the key redacted, the JSON body with
 * the company, department and team ids). Nothing is sent to QE Navigator and nothing is stored.
 */
export async function runPreview(cfg: Config, o: RunOptions = {}): Promise<number> {
  const env = o.env ?? process.env;
  const print = o.out ?? ((t: string) => process.stdout.write(t + '\n'));
  warnIgnored(cfg);
  let privacy: PrivacyContext;
  try { privacy = privacyContext(cfg, env); } catch (e) { return errorExit(e, 'privacy'); }
  let state: State;
  try { state = loadState(cfg.statePath); } catch (e) { return errorExit(new ConfigError((e as Error).message), 'state'); }
  try { await refreshOAuth(cfg, env); } catch (e) { return errorExit(e, 'oauth'); }
  // No key is needed and none is used: the preview makes no request to QE Navigator.
  const qe = new QeClient(cfg, null);
  const codes: number[] = [];
  const now = (o.now ?? (() => new Date()))();
  const report: any = {
    exporter: `qe-exporter/${VERSION}`, generatedAt: now.toISOString(), destination: cfg.qeNavigator.url, companyId: cfg.qeNavigator.companyId, teams: cfg.teams,
    note: 'Each request below is exactly what "qe-exporter sync" would send now (body shown as JSON; sent gzip-compressed). Nothing was sent and nothing was stored.',
    problems: targetProblems(cfg), sources: [] as any[], requests: [] as any[],
  };
  if (report.problems.length) codes.push(EXIT.CONFIG);
  for (const src of selected(cfg, o.source)) {
    try {
      const adapter = adapterFor(src, cfg, privacy, env);
      const c = await collect(adapter, src, cfg, state, privacy, o);
      summarise(c);
      report.sources.push({
        name: src.name, type: src.type, since: c.since.toISOString(), until: c.until.toISOString(), read: c.read, unchanged: c.unchanged,
        toSend: Array.from(c.groups.values()).map((g) => ({ team: g.team, kind: g.kind, items: g.parts.length })), skipped: c.skipped.slice(0, 100), skippedTotal: c.skipped.length,
      });
      if (report.problems.length) continue;
      for (const b of batchesOf(cfg, c)) {
        report.requests.push({ source: src.name, method: 'POST', url: qe.endpoint('/api/ingest/exporter/batch'), headers: qe.displayHeaders(b, false), items: b.parts.length, bytes: Buffer.byteLength(b.json), body: JSON.parse(b.json) });
      }
    } catch (e) {
      codes.push(errorExit(e, src.name));
      report.sources.push({ name: src.name, type: src.type, error: (e as Error).message });
    }
  }
  report.heartbeat = { url: qe.endpoint('/api/ingest/exporter/heartbeat'), body: heartbeatBody(cfg, state) };
  print(JSON.stringify(report, null, 2));
  return worst(codes);
}

// ---------------------------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------------------------

export async function sendHeartbeat(cfg: Config, qe: QeClient, state: State): Promise<boolean> {
  if (!cfg.heartbeat) return false;
  try {
    const r = await qe.heartbeat(heartbeatBody(cfg, state));
    if (r.status === 200 || r.status === 201) { state.lastHeartbeatAt = new Date().toISOString(); return true; }
    log.warn(`heartbeat not accepted (HTTP ${r.status}): ${String(r.body?.error ?? '').slice(0, 200)}`);
  } catch (e) {
    if (e instanceof QeError && e.auth) throw e;
    log.warn(`heartbeat not sent: ${(e as Error).message}`);
  }
  return false;
}

export async function runSync(cfg: Config, o: RunOptions = {}): Promise<number> {
  const env = o.env ?? process.env;
  warnIgnored(cfg);
  let privacy: PrivacyContext;
  let apiKey: string;
  try {
    privacy = privacyContext(cfg, env);
    apiKey = requireSecret(cfg.qeNavigator.apiKeyEnv, 'QE Navigator API key (Admin console → API keys)', env);
    const problems = targetProblems(cfg);
    if (problems.length) throw new ConfigError(`Nothing can be sent until the company and every team's department are set: ${problems.join('; ')} (run "qe-exporter check" or the setup page)`);
  } catch (e) {
    return errorExit(e, 'config');
  }
  let release: () => void;
  try { release = acquireLock(cfg.statePath); } catch (e) { log.error((e as Error).message); return EXIT.LOCKED; }
  const codes: number[] = [];
  const qe = new QeClient(cfg, apiKey);
  try {
    let state: State;
    try { state = loadState(cfg.statePath); } catch (e) { return errorExit(new ConfigError((e as Error).message), 'state'); }
    const st0 = state;
    const save = () => saveState(cfg.statePath, st0);
    try { await refreshOAuth(cfg, env); } catch (e) { codes.push(errorExit(e, 'oauth')); }
    const budget = { extraRequests: 40 };
    for (const src of selected(cfg, o.source)) {
      const t0 = Date.now();
      const st = sourceState(state, src.name);
      try {
        const adapter = adapterFor(src, cfg, privacy, env);
        const c = await collect(adapter, src, cfg, state, privacy, o);
        summarise(c);
        let written = 0;
        let duplicate = 0;
        let rejected = 0;
        let delivered = 0;
        for (const b of batchesOf(cfg, c)) {
          const r = await deliver(qe, b, budget, (parts) => {
            for (const p of parts) { delete st.sent[p.id]; st.sent[p.id] = p.fp; if (st.rejected) delete st.rejected[p.id]; }
            save();
          });
          written += r.written;
          duplicate += r.duplicate;
          delivered += r.delivered.length;
          if (r.rejected.length) {
            st.rejected = st.rejected ?? {};
            for (const x of r.rejected) st.rejected[x.part.id] = x.part.fp;
            rejected += r.rejected.length;
          }
        }
        // Everything read was delivered (or refused one by one): the cursor moves on.
        if (!st.cursor || c.cursor > st.cursor) st.cursor = c.cursor;
        log.info(`${src.name}: delivered ${delivered} item(s) (${written} request part(s) with new data, ${duplicate} already known), refused ${rejected}`, {
          source: src.name, cursor: st.cursor, seconds: Math.round((Date.now() - t0) / 100) / 10, qeRequests: qe.requests,
        });
        if (rejected) codes.push(EXIT.PARTIAL);
        st.lastSuccessAt = new Date().toISOString();
        st.errors = 0;
        save();
      } catch (e) {
        codes.push(errorExit(e, src.name));
        st.errors = (st.errors ?? 0) + 1;
        st.lastErrorAt = new Date().toISOString();
        st.lastErrorKind = errorKind(e);
        // Items delivered before the failure stay recorded; the cursor does not move.
        try { save(); } catch { /* reported by the next run */ }
        if (e instanceof QeError && e.auth) break;
      }
    }
    if (!codes.includes(EXIT.QE)) {
      try { await sendHeartbeat(cfg, qe, state); save(); } catch (e) { codes.push(errorExit(e, 'heartbeat')); }
    }
  } finally {
    release();
  }
  return worst(codes);
}

export { isCiSource };
