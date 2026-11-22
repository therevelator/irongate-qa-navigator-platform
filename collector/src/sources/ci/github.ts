/**
 * GitHub Actions and deployments (github.com or GitHub Enterprise Server), read-only.
 *
 * Auth: a fine-grained personal access token (repository permissions Actions: read, Contents: read,
 * Deployments: read, Metadata: read) or a GitHub App installation with the same read permissions (the
 * Collector signs a short-lived JWT with the app's private key and asks for an installation token: the only
 * POST it makes, and it changes nothing in the repositories).
 *
 * Read per repository (repos: owner/name → team):
 *   GET /repos/{r}/actions/runs?status=completed&created=>=<cursor>        workflow runs (paged, newest first)
 *   GET /repos/{r}/actions/runs/{id}/attempts/{n}/jobs                      jobs and steps with their timings
 *   GET /repos/{r}/actions/runs/{id}/artifacts                              artifact names, sizes, expiry
 *   GET /repos/{r}/actions/artifacts/{id}/zip                               302 to a signed URL: followed without the token
 *   GET /repos/{r}/deployments?environment=<production env>                 deployments, newest first
 *   GET /repos/{r}/deployments/{id}/statuses                                final state and time
 *   GET /repos/{r}/compare/{previous}...{sha}                               the commits a deployment shipped (author dates)
 * Test, coverage and SARIF files are read from the artifacts whose names match `artifacts.*`.
 */
import { createSign } from 'node:crypto';
import type { GitHubSource, HttpSettings } from '../../config';
import { requireSecret, ConfigError } from '../../config';
import { SourceClient, SourceError, nextLink } from '../client';
import { log } from '../../log';
import { kindsOf, parseArtifacts, parallelGroupOf, secondsBetween, ms, type CiAdapter, type CiPage, type CiRecord } from './common';
import { testRunRecord, coverageRecord, analysisRecord, pipelineRecord, deploymentRecord, recordId } from '../../../../packages/engine/src/store/records';
import { stageKind } from '../../../../packages/engine/src/parsers/pipelineEvents';

const RESULT: Record<string, 'success' | 'failed' | 'cancelled' | null> = {
  success: 'success', failure: 'failed', timed_out: 'failed', startup_failure: 'failed', cancelled: 'cancelled', skipped: null, neutral: null, action_required: null, stale: null,
};
const STAGE_RESULT: Record<string, 'success' | 'failed' | 'cancelled' | 'skipped'> = { success: 'success', failure: 'failed', timed_out: 'failed', cancelled: 'cancelled', skipped: 'skipped', neutral: 'success' };

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** A GitHub App JWT (RS256, 9 minutes, issued a minute in the past for clock skew). */
export function appJwt(appId: string, privateKeyPem: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60;
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat, exp: iat + 540, iss: appId }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKeyPem);
  return `${head}.${body}.${b64url(sig)}`;
}

export class GitHubAdapter implements CiAdapter {
  kind = 'ci' as const;
  private client: SourceClient;
  private appToken: { token: string; expires: number } | null = null;
  private privateKey: string | null = null;

  constructor(private src: GitHubSource, http: HttpSettings, private opts: { links: boolean }, env: NodeJS.ProcessEnv = process.env) {
    let auth = '';
    if (src.auth === 'token') auth = `Bearer ${requireSecret(src.tokenEnv, `sources.${src.name} (a GitHub token with read access to Actions, Contents and Deployments)`, env)}`;
    else {
      this.privateKey = requireSecret(src.privateKeyEnv, `sources.${src.name} (the GitHub App's private key, PEM)`, env).replace(/\\n/g, '\n');
      if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(this.privateKey)) throw new ConfigError(`${src.privateKeyEnv} must hold the GitHub App's private key (PEM)`);
    }
    this.client = new SourceClient({
      source: src.name, baseUrl: src.apiUrl, caFile: src.caFile, http,
      headers: { ...(auth ? { Authorization: auth } : {}), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      authHint: src.auth === 'app'
        ? 'The GitHub App needs repository permissions Actions: read, Contents: read, Deployments: read and Metadata: read, and must be installed on the repositories.'
        : 'Use a token with read access to the repositories: fine-grained (Actions, Contents, Deployments, Metadata: read) or classic (repo, read for private repositories).',
    });
  }

  requests(): number { return this.client.requests; }

  describe(): string[] {
    return [
      `${this.src.apiUrl} (${this.src.auth === 'app' ? `GitHub App ${this.src.appId}, installation ${this.src.installationId}` : 'token'}), repositories: ${Object.entries(this.src.teams).map(([r, t]) => `${r} → ${t}`).join(', ')}`,
      `workflow runs${this.src.workflows.length ? ` of ${this.src.workflows.join(', ')}` : ''}${this.src.branches.length ? ` on ${this.src.branches.join(', ')}` : ''}, their jobs and steps, artifacts named ${[...this.src.artifacts.tests, ...this.src.artifacts.coverage, ...this.src.artifacts.sarif].join(' ')} (at most ${this.src.artifacts.maxMB} MB each)`,
      `deployments to ${this.src.environments.join(', ')} with their statuses, and the commits between deployments (compare)`,
    ];
  }

  private async auth(): Promise<void> {
    if (this.src.auth !== 'app') return;
    if (this.appToken && this.appToken.expires - Date.now() > 5 * 60_000) return;
    const jwt = appJwt(this.src.appId!, this.privateKey!);
    this.client.setHeader('Authorization', `Bearer ${jwt}`);
    const r = await this.client.postQuery<{ token: string; expires_at: string }>(`/app/installations/${this.src.installationId}/access_tokens`, {});
    if (!r?.token) throw new SourceError(`${this.src.name}: GitHub did not return an installation token`);
    this.appToken = { token: r.token, expires: Date.parse(r.expires_at) || Date.now() + 3600_000 };
    this.client.setHeader('Authorization', `Bearer ${r.token}`);
  }

  async check(): Promise<string[]> {
    await this.auth();
    const out: string[] = [];
    for (const repo of Object.keys(this.src.teams)) {
      const r = await this.client.get(`/repos/${repo}`);
      const runs = await this.client.get(`/repos/${repo}/actions/runs`, { per_page: 1, status: 'completed' });
      const envs = await this.client.getOptional<{ environments?: Array<{ name: string }> }>(`/repos/${repo}/environments`);
      const names = (envs?.environments ?? []).map((e) => e.name);
      out.push(`${repo}: ${r.private ? 'private' : 'public'}, ${runs.total_count ?? 0} completed workflow runs; environments: ${names.join(', ') || 'none'}${names.length && !names.some((n) => this.isProd(n)) ? ` (none matches environments: ${this.src.environments.join(', ')})` : ''}`);
    }
    return out;
  }

  private isProd(env: string): boolean { return this.src.environments.some((e) => e.toLowerCase() === env.toLowerCase()); }

  /** Every page of a list endpoint (Link: rel="next"), up to `max` items. */
  private async *pages<T>(path: string, query: Record<string, string | number>, key: string | null, max = 10_000): AsyncGenerator<T[]> {
    let url: string | null = this.client.url(path, { per_page: 100, ...query });
    let n = 0;
    while (url && n < max) {
      const res = await this.client.getResponse(url);
      const body = res.json<any>();
      const items: T[] = key ? body?.[key] ?? [] : Array.isArray(body) ? body : [];
      n += items.length;
      yield items;
      url = items.length ? nextLink(res.headers) : null;
    }
  }

  async *collect(since: Date, until: Date): AsyncIterable<CiPage> {
    await this.auth();
    for (const [repo, team] of Object.entries(this.src.teams)) {
      yield* this.runs(repo, team, since, until);
      yield* this.deployments(repo, team, since, until);
    }
  }

  private async *runs(repo: string, team: string, since: Date, until: Date): AsyncGenerator<CiPage> {
    let count = 0;
    for await (const runs of this.pages<any>(`/repos/${repo}/actions/runs`, { status: 'completed', created: `>=${since.toISOString().replace(/\.\d{3}Z$/, 'Z')}` }, 'workflow_runs', this.src.maxRunsPerRepo)) {
      const page: CiPage = { records: [], skipped: [], changedAt: null };
      for (const run of runs) {
        if (count >= this.src.maxRunsPerRepo) break;
        const created = ms(run.created_at);
        if (created !== null && created >= until.getTime()) continue;
        const wf = String(run.path ?? '').split('/').pop() ?? '';
        if (this.src.workflows.length && !this.src.workflows.some((w) => w === run.name || w === wf || w === run.path)) continue;
        if (this.src.branches.length && !this.src.branches.includes(run.head_branch)) continue;
        const result = RESULT[String(run.conclusion ?? '')];
        if (!result) { page.skipped.push({ id: `${repo}#${run.id}`, reason: `conclusion ${run.conclusion ?? 'none'} (not a finished run)` }); continue; }
        count++;
        try {
          page.records.push(...(await this.run(repo, team, run, result, page)));
        } catch (e) {
          if (e instanceof SourceError && e.auth) throw e;
          page.skipped.push({ id: `${repo}#${run.id}`, reason: (e as Error).message });
        }
        const upd = run.updated_at ?? run.created_at;
        if (upd && (!page.changedAt || upd > page.changedAt)) page.changedAt = new Date(upd).toISOString();
      }
      yield page;
    }
  }

  private async run(repo: string, team: string, run: any, result: 'success' | 'failed' | 'cancelled', page: CiPage): Promise<CiRecord[]> {
    const attempt = Number(run.run_attempt) || 1;
    const startedAt = ms(run.run_started_at) ?? ms(run.created_at)!;
    const finishedAt = ms(run.updated_at);
    const jobs: any[] = [];
    for await (const p of this.pages<any>(`/repos/${repo}/actions/runs/${run.id}/attempts/${attempt}/jobs`, {}, 'jobs')) jobs.push(...p);
    const names = jobs.map((j) => String(j.name));
    const out: CiRecord[] = [];
    const commit = String(run.head_sha ?? '').slice(0, 80);
    const branch = run.head_branch ? String(run.head_branch) : null;
    out.push({
      kind: 'pipeline', team, rec: {
        ...pipelineRecord(team, {
          id: String(run.id), attempt, name: run.name ?? null, commit, branch, startedAt: new Date(startedAt), finishedAt: finishedAt ? new Date(finishedAt) : null,
          durationS: secondsBetween(startedAt, finishedAt), result, url: this.opts.links ? run.html_url ?? null : null,
          stages: jobs.filter((j) => j.started_at).map((j) => {
            const a = ms(j.started_at);
            const b = ms(j.completed_at);
            return {
              name: String(j.name).slice(0, 255), kind: stageKind(String(j.name)), parallelGroup: parallelGroupOf(String(j.name), names),
              startedAt: a ? new Date(a) : null, finishedAt: b ? new Date(b) : null, durationS: secondsBetween(a, b), result: STAGE_RESULT[String(j.conclusion ?? '')] ?? 'skipped',
            };
          }),
        }),
        steps: jobs.flatMap((j) => (Array.isArray(j.steps) ? j.steps : []).map((s: any) => ({ job: String(j.name).slice(0, 255), name: String(s.name).slice(0, 255), durationS: secondsBetween(ms(s.started_at), ms(s.completed_at)), result: STAGE_RESULT[String(s.conclusion ?? '')] ?? 'skipped' }))),
      },
    });
    // Artifacts: test, coverage and SARIF reports.
    const arts: any[] = [];
    for await (const p of this.pages<any>(`/repos/${repo}/actions/runs/${run.id}/artifacts`, {}, 'artifacts')) arts.push(...p);
    const files: Array<{ artifact: string; name: string; data: Buffer; kinds: Array<'tests' | 'coverage' | 'sarif'> }> = [];
    for (const a of arts) {
      const kinds = kindsOf(String(a.name), this.src.artifacts);
      if (!kinds.length) continue;
      const id = `${repo}#${run.id}/${a.name}`;
      if (a.expired) { page.skipped.push({ id, reason: 'artifact expired' }); continue; }
      if (Number(a.size_in_bytes) > this.src.artifacts.maxMB * 1024 * 1024) { page.skipped.push({ id, reason: `artifact is ${Math.round(Number(a.size_in_bytes) / 1024 / 1024)} MB (artifacts.maxMB: ${this.src.artifacts.maxMB})` }); continue; }
      const d = await this.client.download(a.archive_download_url ?? `/repos/${repo}/actions/artifacts/${a.id}/zip`, this.src.artifacts.maxMB * 1024 * 1024);
      if (!d.ok) { page.skipped.push({ id, reason: `artifact ${d.reason}: ${d.message}` }); continue; }
      files.push({ artifact: String(a.name), name: `${a.name}.zip`, data: d.body, kinds });
    }
    if (files.length) {
      const parsed = parseArtifacts(files);
      page.skipped.push(...parsed.skipped.map((s) => ({ id: `${repo}#${run.id}/${s.id}`, reason: s.reason })));
      const meta = { commit, branch, runId: String(run.id), attempt, startedAt };
      if (parsed.tests) out.push({ kind: 'testRun', team, rec: testRunRecord(team, parsed.tests, meta) });
      if (parsed.coverage) out.push({ kind: 'coverage', team, rec: coverageRecord(team, parsed.coverage, { commit, branch, runId: String(run.id), attempt, createdAt: finishedAt ?? startedAt }) });
      for (const s of parsed.sarif) out.push({ kind: 'analysis', team, rec: analysisRecord(team, s, { repo, branch, commit, runId: String(run.id), attempt, analyzedAt: finishedAt ?? startedAt, linesOfCode: s.linesOfCode }) });
      log.debug('artifacts read', { source: this.src.name, repo, run: run.id, files: parsed.files, tests: parsed.tests?.cases.length ?? 0, coverageFiles: parsed.coverage?.files.length ?? 0, sarif: parsed.sarif.length });
    }
    return out;
  }

  private async *deployments(repo: string, team: string, since: Date, until: Date): AsyncGenerator<CiPage> {
    const page: CiPage = { records: [], skipped: [], changedAt: null };
    const service = repo.split('/')[1];
    const found: Array<{ id: string; sha: string; ref: string; description: string; env: string; createdAt: number }> = [];
    for (const env of this.src.environments) {
      for await (const list of this.pages<any>(`/repos/${repo}/deployments`, { environment: env }, null, 2000)) {
        let older = false;
        for (const d of list) {
          const created = ms(d.created_at)!;
          // Read a little further back than the cursor: the previous deployment gives the commit range.
          if (created < since.getTime() - 30 * 86_400_000) { older = true; break; }
          if (created >= until.getTime()) continue;
          found.push({ id: String(d.id), sha: String(d.sha), ref: String(d.ref ?? ''), description: String(d.description ?? ''), env: String(d.environment ?? env), createdAt: created });
        }
        if (older) break;
      }
    }
    found.sort((a, b) => a.createdAt - b.createdAt);
    const finished: Array<{ d: (typeof found)[number]; result: 'success' | 'failure'; at: number; url: string | null }> = [];
    for (const d of found) {
      const statuses = (await this.client.get<any[]>(`/repos/${repo}/deployments/${d.id}/statuses`, { per_page: 100 })) ?? [];
      const final = statuses.find((s) => ['success', 'failure', 'error'].includes(s.state));
      if (!final) { page.skipped.push({ id: `${repo} deployment ${d.id}`, reason: `not finished (${statuses[0]?.state ?? 'no status'})` }); continue; }
      finished.push({ d, result: final.state === 'success' ? 'success' : 'failure', at: ms(final.created_at)!, url: this.opts.links ? final.log_url ?? final.target_url ?? null : null });
    }
    let prevOk: (typeof finished)[number] | null = null;
    const okShas: Array<{ sha: string; id: string }> = [];
    for (const f of finished) {
      const inWindow = f.at >= since.getTime();
      // A deployment of a commit that an earlier successful deployment already shipped (not the previous one) rolls the previous one back.
      const rollbackOf = f.result === 'success' && prevOk && prevOk.d.sha !== f.d.sha && okShas.slice(0, -1).some((x) => x.sha === f.d.sha) ? prevOk.d.id : null;
      if (inWindow) {
        page.records.push({
          kind: 'deployment', team, rec: deploymentRecord(team, {
            id: f.d.id, team, environment: f.d.env, production: true, service, commit: f.d.sha, commits: [], commitFrom: prevOk?.d.sha ?? null,
            startedAt: new Date(f.d.createdAt), finishedAt: new Date(f.at), result: f.result, rollbackOf, hotfix: /hotfix/i.test(`${f.d.ref} ${f.d.description}`), url: f.url,
          }),
        });
        if (f.result === 'success') {
          const commits = await this.commitsBetween(repo, prevOk?.d.sha ?? null, f.d.sha, page);
          if (commits.length) page.records.push({ kind: 'commits', team, deployment: f.d.id, commits });
        }
        const iso = new Date(f.at).toISOString();
        if (!page.changedAt || iso > page.changedAt) page.changedAt = iso;
      }
      if (f.result === 'success') { prevOk = f; okShas.push({ sha: f.d.sha, id: f.d.id }); }
    }
    yield page;
  }

  private async commitsBetween(repo: string, from: string | null, to: string, page: CiPage) {
    try {
      if (!from) {
        const c = await this.client.get(`/repos/${repo}/commits/${to}`);
        return [{ sha: String(c.sha), deployment: '', authoredAt: ms(c.commit?.author?.date), committedAt: ms(c.commit?.committer?.date), branch: null }];
      }
      const cmp = await this.client.get(`/repos/${repo}/compare/${from}...${to}`, { per_page: 250 });
      return (cmp.commits ?? []).slice(0, 1000).map((c: any) => ({ sha: String(c.sha), deployment: '', authoredAt: ms(c.commit?.author?.date), committedAt: ms(c.commit?.committer?.date), branch: null }));
    } catch (e) {
      if (e instanceof SourceError && e.auth) throw e;
      page.skipped.push({ id: `${repo} ${from ?? ''}...${to}`, reason: `commits not read: ${(e as Error).message}` });
      return [];
    }
  }
}

export { recordId };
