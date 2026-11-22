/**
 * Bitbucket Cloud Pipelines and deployments (api.bitbucket.org/2.0), read-only.
 *
 * Auth: an app password (or Atlassian API token) of a user with read access (Basic: username + app password; the
 * app password needs the permissions Account: Read, Repositories: Read, Pipelines: Read), or OAuth with the
 * customer's own OAuth consumer (the same read permissions; connected on the setup page).
 *
 * Read per repository (repos: workspace/repo → team):
 *   GET /repositories/{ws}/{repo}                                                  check
 *   GET /repositories/{ws}/{repo}/pipelines/?sort=-created_on&pagelen=100          pipelines, newest first (paged by "next")
 *   GET /repositories/{ws}/{repo}/pipelines/{uuid}/steps/?pagelen=100              steps with their times and results
 *   GET /repositories/{ws}/{repo}/pipelines/{uuid}/steps/{step}/test_reports/test_cases?pagelen=100
 *                                                                                  the test report of a step, where one exists
 *   GET /repositories/{ws}/{repo}/environments/?pagelen=100                        environments and their type
 *   GET /repositories/{ws}/{repo}/deployments/?sort=-state.started_on&pagelen=100   deployments, newest first
 *   GET /repositories/{ws}/{repo}/commits/{to}?exclude={from}&pagelen=100          the commits a deployment shipped (hash, date)
 * Bitbucket's test report API gives the results as JSON only: they are written out as a JUnit file (form, not
 * content: suite, name, status, time; no messages). 429 answers are retried with Retry-After (http.ts).
 */
import type { BitbucketSource, HttpSettings } from '../../config';
import { requireSecret, secret, ConfigError } from '../../config';
import { credentialEntry } from '../../credentials';
import { SourceClient, SourceError } from '../client';
import { ms, secondsBetween, pipelineRun, reportItem, junitOf, deployment, type CiAdapter, type CiPage, type CiRecord, type StructuredCase } from './common';

const RESULT: Record<string, 'success' | 'failed' | 'cancelled'> = { SUCCESSFUL: 'success', FAILED: 'failed', ERROR: 'failed', STOPPED: 'cancelled', EXPIRED: 'cancelled' };
const STEP: Record<string, string> = { SUCCESSFUL: 'success', FAILED: 'failed', ERROR: 'failed', STOPPED: 'cancelled', NOT_RUN: 'skipped', SKIPPED: 'skipped' };
const CASE: Record<string, StructuredCase['status']> = { PASSED: 'passed', SUCCESSFUL: 'passed', FAILED: 'failed', ERROR: 'error', SKIPPED: 'skipped', NOT_RUN: 'skipped' };

/** An ISO 8601 duration (PT1M2.5S) or a number of seconds, in milliseconds. */
export function durationMs(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 1000);
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(String(v ?? ''));
  if (!m) return 0;
  return Math.round((((Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 60 + Number(m[4] ?? 0)) * 1000);
}

export class BitbucketAdapter implements CiAdapter {
  kind = 'ci' as const;
  private client: SourceClient;

  constructor(private src: BitbucketSource, http: HttpSettings, private opts: { links: boolean }, env: NodeJS.ProcessEnv = process.env) {
    const secretValue = requireSecret(src.tokenEnv, `sources.${src.name} (${src.auth === 'oauth' ? 'the OAuth token from the setup page' : 'a Bitbucket app password'})`, env);
    const oauth = src.auth === 'oauth' || (credentialEntry(src.tokenEnv) as any)?.type === 'oauth';
    let header: string;
    if (oauth) header = `Bearer ${secretValue}`;
    else {
      const user = src.username ?? secret(src.usernameEnv, env);
      if (!user) throw new ConfigError(`sources.${src.name}: set username (or ${src.usernameEnv}): the Bitbucket user of the app password`);
      header = 'Basic ' + Buffer.from(`${user}:${secretValue}`).toString('base64');
    }
    this.client = new SourceClient({
      source: src.name, baseUrl: src.apiUrl, caFile: src.caFile, http, headers: { Authorization: header, Accept: 'application/json' },
      authHint: 'Use an app password (or API token) with Account: Read, Repositories: Read and Pipelines: Read, of a user who can read the repositories; or connect your own OAuth consumer on the setup page.',
    });
  }

  requests(): number { return this.client.requests; }

  describe(): string[] {
    return [
      `${this.src.apiUrl} (${this.src.auth === 'oauth' ? 'OAuth' : 'app password'}), repositories: ${Object.entries(this.src.teams).map(([r, t]) => `${r} → ${t}`).join(', ')}`,
      'pipelines with their steps and timings, step test reports where they exist',
      `deployments to environments of type Production or named ${this.src.environments.join(', ')}, with the commits between deployments`,
    ];
  }

  async check(): Promise<string[]> {
    const out: string[] = [];
    for (const repo of Object.keys(this.src.teams)) {
      const r = await this.client.get(`/repositories/${repo}`);
      const p = await this.client.get(`/repositories/${repo}/pipelines/`, { pagelen: 1, sort: '-created_on' });
      const envs = (await this.client.getOptional(`/repositories/${repo}/environments/`, { pagelen: 100 }))?.values ?? [];
      out.push(`${repo}: ${r.is_private ? 'private' : 'public'}, ${p.size ?? (p.values ?? []).length} pipelines; environments: ${envs.map((e: any) => e.name).join(', ') || 'none'}`);
    }
    return out;
  }

  /** Every page of a list (Bitbucket's "next" link; only to the API's own host), up to max items. */
  private async *pages(path: string, query: Record<string, string | number>, max = 10_000): AsyncGenerator<any[]> {
    let url: string | null = this.client.url(path, { pagelen: 100, ...query });
    let n = 0;
    while (url && n < max) {
      const body: any = (await this.client.getResponse(url)).json();
      const items: any[] = body?.values ?? [];
      n += items.length;
      yield items;
      url = items.length && typeof body?.next === 'string' ? body.next : null;
    }
  }

  async *collect(since: Date, until: Date): AsyncIterable<CiPage> {
    for (const [repo, team] of Object.entries(this.src.teams)) {
      yield* this.pipelines(repo, team, since, until);
      yield await this.deployments(repo, team, since, until);
    }
  }

  private async *pipelines(repo: string, team: string, since: Date, until: Date): AsyncGenerator<CiPage> {
    let count = 0;
    for await (const list of this.pages(`/repositories/${repo}/pipelines/`, { sort: '-created_on' }, this.src.maxRunsPerRepo + 100)) {
      const page: CiPage = { records: [], skipped: [], changedAt: null };
      let older = false;
      for (const p of list) {
        const created = ms(p.created_on);
        if (created !== null && created < since.getTime()) { older = true; break; }
        if (created !== null && created >= until.getTime()) continue;
        if (String(p.state?.name) !== 'COMPLETED') continue;
        const result = RESULT[String(p.state?.result?.name ?? '')];
        const id = `${repo}#${p.build_number ?? p.uuid}`;
        if (!result) { page.skipped.push({ id, reason: `result ${p.state?.result?.name ?? 'none'}` }); continue; }
        if (count++ >= this.src.maxRunsPerRepo) break;
        try { page.records.push(...(await this.pipeline(repo, team, p, result))); } catch (e) {
          if (e instanceof SourceError && e.auth) throw e;
          page.skipped.push({ id, reason: (e as Error).message });
        }
        const done = ms(p.completed_on) ?? created;
        if (done && (!page.changedAt || new Date(done).toISOString() > page.changedAt)) page.changedAt = new Date(done).toISOString();
      }
      yield page;
      if (older || count >= this.src.maxRunsPerRepo) break;
    }
  }

  private async pipeline(repo: string, team: string, p: any, result: 'success' | 'failed' | 'cancelled'): Promise<CiRecord[]> {
    const uuid = encodeURIComponent(String(p.uuid));
    const steps: any[] = [];
    for await (const l of this.pages(`/repositories/${repo}/pipelines/${uuid}/steps/`, {})) steps.push(...l);
    const startedAt = ms(p.created_on)!;
    const finishedAt = ms(p.completed_on);
    const commit = String(p.target?.commit?.hash ?? '').slice(0, 80);
    const branch = p.target?.ref_type === 'branch' && p.target?.ref_name ? String(p.target.ref_name) : null;
    const runId = String(p.build_number ?? p.uuid);
    const attempt = Number(p.run_number) || 1;
    const out: CiRecord[] = [pipelineRun(team, {
      id: runId, attempt, name: p.target?.selector?.pattern ?? p.target?.selector?.type ?? 'pipeline', commit, branch, startedAt, finishedAt,
      durationS: typeof p.duration_in_seconds === 'number' ? p.duration_in_seconds : secondsBetween(startedAt, finishedAt), result,
      url: this.opts.links ? p.links?.html?.href ?? null : null,
      stages: steps.filter((s) => s.started_on).map((s) => {
        const a = ms(s.started_on);
        const b = ms(s.completed_on);
        return { name: String(s.name ?? 'step'), startedAt: a, finishedAt: b, durationS: typeof s.duration_in_seconds === 'number' ? s.duration_in_seconds : secondsBetween(a, b), result: STEP[String(s.state?.result?.name ?? s.state?.name ?? '')] ?? 'skipped' };
      }),
    })];
    // Test reports of the steps that have one (404 or an empty list: none).
    const cases: StructuredCase[] = [];
    for (const s of steps) {
      const path = `/repositories/${repo}/pipelines/${uuid}/steps/${encodeURIComponent(String(s.uuid))}/test_reports/test_cases`;
      const first = await this.client.getOptional(path, { pagelen: 100 });
      if (!first) continue;
      let body: any = first;
      for (let n = 0; body && n < 50; n++) {
        for (const c of body.values ?? []) {
          const fq = String(c.fully_qualified_name ?? c.name ?? '');
          const name = String(c.name ?? fq);
          const suite = fq && fq !== name && fq.endsWith(name) ? fq.slice(0, fq.length - name.length).replace(/[.#:/\s]+$/, '') : String(c.suite ?? s.name ?? '');
          cases.push({ suite, name, status: CASE[String(c.status ?? '').toUpperCase()] ?? 'skipped', durationMs: durationMs(c.duration) });
        }
        body = typeof body.next === 'string' ? (await this.client.getResponse(body.next)).json() : null;
      }
    }
    if (cases.length) out.push(reportItem('test-report', team, [junitOf(cases)], { commit, branch, run: runId, attempt, startedAt }, { format: 'junit' }));
    return out;
  }

  private async deployments(repo: string, team: string, since: Date, until: Date): Promise<CiPage> {
    const page: CiPage = { records: [], skipped: [], changedAt: null };
    const envs: any[] = [];
    for await (const l of this.pages(`/repositories/${repo}/environments/`, {})) envs.push(...l);
    const prod = new Map<string, string>(envs.filter((e) => String(e.environment_type?.name ?? '').toLowerCase() === 'production' || this.src.environments.some((x) => x.toLowerCase() === String(e.name).toLowerCase()))
      .map((e) => [String(e.uuid), String(e.name)]));
    if (!prod.size) return page;
    const found: Array<{ id: string; env: string; sha: string; started: number | null; at: number; ok: boolean; name: string }> = [];
    for await (const list of this.pages(`/repositories/${repo}/deployments/`, { sort: '-state.started_on' }, 2000)) {
      let older = false;
      for (const d of list) {
        const env = prod.get(String(d.environment?.uuid));
        if (!env) continue;
        const at = ms(d.state?.completed_on) ?? ms(d.last_update_time);
        // A month before the cursor too: the previous deployment gives the commit range.
        if (at !== null && at < since.getTime() - 30 * 86_400_000) { older = true; break; }
        const status = String(d.state?.status?.name ?? '');
        if (String(d.state?.name) !== 'COMPLETED' || !['SUCCESSFUL', 'FAILED'].includes(status) || at === null || at >= until.getTime()) continue;
        found.push({ id: String(d.uuid).replace(/[{}]/g, ''), env, sha: String(d.release?.commit?.hash ?? d.deployable?.commit?.hash ?? '').slice(0, 80), started: ms(d.state?.started_on), at, ok: status === 'SUCCESSFUL', name: String(d.release?.name ?? d.deployable?.name ?? '') });
      }
      if (older) break;
    }
    found.sort((a, b) => a.at - b.at);
    let prevOk: (typeof found)[number] | null = null;
    const okShas: string[] = [];
    const service = repo.split('/')[1];
    for (const f of found) {
      if (f.at >= since.getTime()) {
        const rollbackOf = f.ok && prevOk && prevOk.sha !== f.sha && okShas.slice(0, -1).includes(f.sha) ? prevOk.id : null;
        let commits: Array<{ sha: string; authoredAt: number | null; committedAt: number | null }> = [];
        if (f.ok && f.sha) {
          try {
            const q: Record<string, string | number> = prevOk?.sha ? { exclude: prevOk.sha } : { pagelen: 1 };
            let n = 0;
            for await (const l of this.pages(`/repositories/${repo}/commits/${f.sha}`, q, prevOk?.sha ? 1000 : 1)) {
              for (const c of l) commits.push({ sha: String(c.hash), authoredAt: ms(c.date), committedAt: null });
              if (++n >= 10) break;
            }
          } catch (e) {
            if (e instanceof SourceError && e.auth) throw e;
            page.skipped.push({ id: `${repo} ${prevOk?.sha ?? ''}..${f.sha}`, reason: `commits not read: ${(e as Error).message}` });
            commits = [];
          }
        }
        page.records.push(deployment(team, {
          id: f.id, environment: f.env, service, commit: f.sha, previousCommit: prevOk?.sha ?? null, startedAt: f.started, finishedAt: f.at, result: f.ok ? 'success' : 'failure',
          rollbackOf, hotfix: /hotfix/i.test(f.name), commits,
        }));
        const iso = new Date(f.at).toISOString();
        if (!page.changedAt || iso > page.changedAt) page.changedAt = iso;
      }
      if (f.ok) { prevOk = f; okShas.push(f.sha); }
    }
    return page;
  }
}
