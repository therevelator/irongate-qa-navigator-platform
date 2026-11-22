/**
 * GitLab CI and deployments (gitlab.com or self-managed), read-only.
 *
 * Auth: a personal, group or project access token with the read_api scope (role Reporter or above on the
 * projects), sent as PRIVATE-TOKEN.
 *
 * Read per project (projects: group/project → team):
 *   GET /projects/:id/pipelines?updated_after=<cursor>&order_by=updated_at&sort=asc     finished pipelines
 *   GET /projects/:id/pipelines/:pid                                                     start, finish, duration
 *   GET /projects/:id/pipelines/:pid/jobs?include_retried=true                           jobs (stages) with timings, artifacts
 *   GET /projects/:id/pipelines/:pid/test_report                                         the parsed JUnit reports (artifacts:reports:junit)
 *   GET /projects/:id/jobs/:job/artifacts                                                job artifacts archive (coverage, SARIF, more tests)
 *   GET /projects/:id/deployments?environment=<production env>&updated_after=<cursor>   deployments
 *   GET /projects/:id/repository/compare?from=<previous>&to=<sha>                        the commits a deployment shipped
 * Pagination: X-Next-Page; rate limits: RateLimit-Remaining / RateLimit-Reset and Retry-After.
 */
import type { GitLabSource, HttpSettings } from '../../config';
import { requireSecret } from '../../config';
import { SourceClient, SourceError } from '../client';
import { changedLinesOf, kindsOf, findReports, parallelGroupOf, secondsBetween, ms, pipelineRun, reportItems, reportItem, junitOf, deployment, type CiAdapter, type CiPage, type CiRecord } from './common';

const RESULT: Record<string, 'success' | 'failed' | 'cancelled' | undefined> = { success: 'success', failed: 'failed', canceled: 'cancelled' };
const JOB_RESULT: Record<string, 'success' | 'failed' | 'cancelled' | 'skipped'> = { success: 'success', failed: 'failed', canceled: 'cancelled', skipped: 'skipped', manual: 'skipped' };
const CASE: Record<string, 'passed' | 'failed' | 'error' | 'skipped'> = { success: 'passed', failed: 'failed', error: 'error', skipped: 'skipped' };

export class GitLabAdapter implements CiAdapter {
  kind = 'ci' as const;
  private client: SourceClient;
  private ids = new Map<string, number>();

  constructor(private src: GitLabSource, http: HttpSettings, private opts: { links: boolean }, env: NodeJS.ProcessEnv = process.env) {
    const token = requireSecret(src.tokenEnv, `sources.${src.name} (a GitLab access token with the read_api scope)`, env);
    this.client = new SourceClient({
      source: src.name, baseUrl: src.apiUrl, caFile: src.caFile, http, headers: src.auth === 'oauth' ? { Authorization: `Bearer ${token}` } : { 'PRIVATE-TOKEN': token },
      authHint: 'Use a personal, group or project access token with the read_api scope, of a user with the Reporter role (or above) on the projects.',
    });
  }

  requests(): number { return this.client.requests; }

  describe(): string[] {
    return [
      `${this.src.apiUrl} (${this.src.auth === 'oauth' ? 'OAuth' : 'token'}), projects: ${Object.entries(this.src.teams).map(([p, t]) => `${p} → ${t}`).join(', ')}`,
      `finished pipelines, their jobs, test reports, job artifacts matching ${[...this.src.artifacts.tests, ...this.src.artifacts.coverage, ...this.src.artifacts.sarif].join(' ')} (at most ${this.src.artifacts.maxMB} MB)`,
      `deployments to ${this.src.environments.join(', ')} and the commits between them (compare)`,
    ];
  }

  private async projectId(path: string): Promise<number> {
    if (/^\d+$/.test(path)) return Number(path);
    if (!this.ids.has(path)) this.ids.set(path, (await this.client.get(`/projects/${encodeURIComponent(path)}`)).id);
    return this.ids.get(path)!;
  }

  async check(): Promise<string[]> {
    const out: string[] = [];
    for (const p of Object.keys(this.src.teams)) {
      const id = await this.projectId(p);
      const pipes = await this.client.get<any[]>(`/projects/${id}/pipelines`, { per_page: 1 });
      const envs = (await this.client.getOptional<any[]>(`/projects/${id}/environments`, { per_page: 100 })) ?? [];
      out.push(`${p} (id ${id}): pipelines ${pipes.length ? 'readable' : 'none yet'}; environments: ${envs.map((e) => e.name).join(', ') || 'none'}`);
    }
    return out;
  }

  private async *pages<T>(path: string, query: Record<string, string | number>, max = 10_000): AsyncGenerator<T[]> {
    let page = 1;
    let n = 0;
    while (page && n < max) {
      const res = await this.client.getResponse(path, { per_page: 100, page, ...query });
      const items = res.json<T[]>() ?? [];
      n += items.length;
      yield items;
      const next = String(res.headers['x-next-page'] ?? '');
      page = /^\d+$/.test(next) && items.length ? Number(next) : 0;
    }
  }

  async *collect(since: Date, until: Date): AsyncIterable<CiPage> {
    for (const [path, team] of Object.entries(this.src.teams)) {
      const id = await this.projectId(path);
      yield* this.pipelines(path, id, team, since, until);
      yield* this.deployments(path, id, team, since, until);
    }
  }

  private async *pipelines(path: string, id: number, team: string, since: Date, until: Date): AsyncGenerator<CiPage> {
    let count = 0;
    for await (const list of this.pages<any>(`/projects/${id}/pipelines`, { updated_after: since.toISOString(), updated_before: until.toISOString(), order_by: 'updated_at', sort: 'asc' }, this.src.maxRunsPerRepo)) {
      const page: CiPage = { records: [], skipped: [], changedAt: null };
      for (const p of list) {
        const result = RESULT[String(p.status)];
        if (!result) continue;
        if (count++ >= this.src.maxRunsPerRepo) break;
        try { page.records.push(...(await this.pipeline(path, id, team, p.id, result, page))); } catch (e) {
          if (e instanceof SourceError && e.auth) throw e;
          page.skipped.push({ id: `${path}!${p.id}`, reason: (e as Error).message });
        }
        const upd = ms(p.updated_at);
        if (upd && (!page.changedAt || new Date(upd).toISOString() > page.changedAt)) page.changedAt = new Date(upd).toISOString();
      }
      yield page;
    }
  }

  private async pipeline(path: string, id: number, team: string, pid: number, result: 'success' | 'failed' | 'cancelled', page: CiPage): Promise<CiRecord[]> {
    const p = await this.client.get(`/projects/${id}/pipelines/${pid}`);
    const jobs: any[] = [];
    for await (const l of this.pages<any>(`/projects/${id}/pipelines/${pid}/jobs`, { include_retried: 'true' })) jobs.push(...l);
    const startedAt = ms(p.started_at) ?? ms(p.created_at)!;
    const finishedAt = ms(p.finished_at);
    const commit = String(p.sha ?? '').slice(0, 80);
    const branch = p.ref ? String(p.ref) : null;
    const names = jobs.map((j) => String(j.name));
    const out: CiRecord[] = [pipelineRun(team, {
      id: String(pid), attempt: 1, name: p.name ?? null, commit, branch, startedAt, finishedAt,
      durationS: typeof p.duration === 'number' ? Math.round(p.duration) : secondsBetween(startedAt, finishedAt), result, url: this.opts.links ? p.web_url ?? null : null,
      stages: jobs.filter((j) => j.started_at).map((j) => {
        const a = ms(j.started_at);
        const b = ms(j.finished_at);
        return {
          name: String(j.name), ...(/test/i.test(String(j.stage)) ? { kind: 'test' as const } : {}), parallelGroup: parallelGroupOf(String(j.name), names),
          startedAt: a, finishedAt: b, durationS: typeof j.duration === 'number' ? Math.round(j.duration) : secondsBetween(a, b), result: JOB_RESULT[String(j.status)] ?? 'skipped',
        };
      }),
    })];
    const meta = { commit, branch, run: String(pid), attempt: 1, startedAt };
    // Tests: GitLab's own parsed JUnit reports.
    const tr = await this.client.getOptional(`/projects/${id}/pipelines/${pid}/test_report`);
    const cases = (tr?.test_suites ?? []).flatMap((s: any) => (s.test_cases ?? []).map((c: any) => ({
      suite: String(c.classname ?? s.name ?? ''), name: String(c.name ?? ''), status: CASE[String(c.status)] ?? 'skipped', durationMs: Math.round(Number(c.execution_time ?? 0) * 1000),
    })));
    // Coverage, SARIF (and test files when there is no test report): the job artifact archives.
    const files: Array<{ artifact: string; name: string; data: Buffer; kinds: Array<'tests' | 'coverage' | 'sarif'> }> = [];
    for (const j of jobs) {
      const archive = (j.artifacts ?? []).find((a: any) => a.file_type === 'archive');
      if (!archive) continue;
      const kinds = Array.from(new Set([...kindsOf(String(j.name), this.src.artifacts), ...kindsOf(String(archive.filename ?? ''), this.src.artifacts)])).filter((k) => k !== 'tests' || !cases.length);
      if (!kinds.length) continue;
      const aid = `${path}!${pid}/${j.name}`;
      if (j.artifacts_expire_at && Date.parse(j.artifacts_expire_at) < Date.now()) { page.skipped.push({ id: aid, reason: 'artifacts expired' }); continue; }
      if (Number(archive.size) > this.src.artifacts.maxMB * 1024 * 1024) { page.skipped.push({ id: aid, reason: `artifacts are ${Math.round(Number(archive.size) / 1024 / 1024)} MB (artifacts.maxMB: ${this.src.artifacts.maxMB})` }); continue; }
      const d = await this.client.download(`/projects/${id}/jobs/${j.id}/artifacts`, this.src.artifacts.maxMB * 1024 * 1024);
      if (!d.ok) { page.skipped.push({ id: aid, reason: `artifacts ${d.reason}: ${d.message}` }); continue; }
      files.push({ artifact: String(j.name), name: String(archive.filename ?? 'artifacts.zip'), data: d.body, kinds });
    }
    const found = files.length ? findReports(files) : { tests: [], coverage: [], sarif: [], files: 0, skipped: [] };
    page.skipped.push(...found.skipped.map((x) => ({ id: `${path}!${pid}/${x.id}`, reason: x.reason })));
    // GitLab gives its parsed JUnit results as JSON only: written out as a JUnit file (form, not content).
    if (cases.length) out.push(reportItem('test-report', team, [junitOf(cases, Math.round(Number(tr?.total_time ?? 0) * 1000) || undefined)], meta, { format: 'junit' }));
    // The lines the pipeline's commit changed (line numbers from the diff hunks; the code is not sent): coverage of changed code.
    let changed: Record<string, Array<number | string>> | null = null;
    if (found.coverage.length && commit) {
      try {
        const diff = (await this.client.getOptional<any[]>(`/projects/${id}/repository/commits/${commit}/diff`, { per_page: 100 })) ?? [];
        changed = changedLinesOf(diff.map((d: any) => ({ filename: d.new_path, patch: d.diff })));
      } catch (e) {
        if (e instanceof SourceError && e.auth) throw e;
        page.skipped.push({ id: `${path}@${commit.slice(0, 12)}`, reason: `changed lines not read: ${(e as Error).message}` });
      }
    }
    out.push(...reportItems(team, { ...found, tests: cases.length ? [] : found.tests }, meta, path, changed));
    return out;
  }

  private async *deployments(path: string, id: number, team: string, since: Date, until: Date): AsyncGenerator<CiPage> {
    const page: CiPage = { records: [], skipped: [], changedAt: null };
    const service = path.split('/').pop() ?? path;
    for (const env of this.src.environments) {
      const list: any[] = [];
      // From a month before the cursor: the previous deployment gives the commit range.
      for await (const l of this.pages<any>(`/projects/${id}/deployments`, { environment: env, updated_after: new Date(since.getTime() - 30 * 86_400_000).toISOString(), order_by: 'updated_at', sort: 'asc' }, 2000)) list.push(...l);
      const done = list.filter((d) => ['success', 'failed', 'canceled'].includes(String(d.status)))
        .map((d) => ({ d, at: ms(d.finished_at) ?? ms(d.deployable?.finished_at) ?? ms(d.updated_at)! }))
        .filter((x) => x.at < until.getTime()).sort((a, b) => a.at - b.at);
      let prev: string | null = null;
      const okShas: string[] = [];
      for (const { d, at } of done) {
        if (d.status === 'canceled') continue;
        const ok = d.status === 'success';
        if (at >= since.getTime()) {
          const rollbackOf = ok && prev && prev !== d.sha && okShas.slice(0, -1).includes(String(d.sha)) ? String(done.filter((x) => x.d.status === 'success' && x.at < at).pop()?.d.id ?? '') || null : null;
          let commits: Array<{ sha: string; authoredAt: number | null; committedAt: number | null }> = [];
          if (ok && prev && prev !== d.sha) {
            try {
              const cmp = await this.client.get(`/projects/${id}/repository/compare`, { from: prev, to: String(d.sha) });
              commits = (cmp.commits ?? []).slice(0, 1000).map((c: any) => ({ sha: String(c.id), authoredAt: ms(c.authored_date), committedAt: ms(c.committed_date) }));
            } catch (e) {
              if (e instanceof SourceError && e.auth) throw e;
              page.skipped.push({ id: `${path} ${prev}...${d.sha}`, reason: `commits not read: ${(e as Error).message}` });
            }
          }
          page.records.push(deployment(team, {
            id: String(d.id), environment: String(d.environment?.name ?? env), service, commit: String(d.sha), previousCommit: prev,
            startedAt: ms(d.created_at), finishedAt: at, result: ok ? 'success' : 'failure', rollbackOf, hotfix: /hotfix/i.test(String(d.ref ?? '')), commits,
          }));
          const iso = new Date(at).toISOString();
          if (!page.changedAt || iso > page.changedAt) page.changedAt = iso;
        }
        if (ok) { prev = String(d.sha); okShas.push(prev); }
      }
    }
    yield page;
  }
}
