/**
 * Jenkins (any recent LTS), read-only, through its JSON API.
 *
 * Auth: a user and its API token (Basic). The user needs Overall/Read and Job/Read on the jobs (and
 * Job/ExtendedRead is not needed); no write permission, no crumb (only GET requests).
 *
 * Read per job (jobs: folder/job → team; deployJobs: folder/job → team for deployment jobs):
 *   GET <job>/api/json?tree=builds[number,result,building,timestamp,duration,actions[…],artifacts[…],changeSets[…]]{0,N}
 *   GET <job>/<n>/wfapi/describe                                  Pipeline stages with start and duration
 *   GET <job>/<n>/testReport/api/json?tree=duration,suites[…]     the JUnit plugin's test report
 *   GET <job>/<n>/artifact/<path>                                 archived coverage / SARIF / test files
 * A deployment job's builds are deployments to deployEnvironment (production), with the commits of their
 * change sets. A successful build of a commit that an earlier successful build already deployed (not the
 * previous one) is sent as the rollback of the previous one (rollbackOf).
 */
import type { HttpSettings, JenkinsSource } from '../../config';
import { requireSecret, secret, ConfigError } from '../../config';
import { SourceClient, SourceError } from '../client';
import { globMatch, kindsOf, findReports, parallelGroupOf, rollbackTracker, secondsBetween, pipelineRun, reportItems, reportItem, junitOf, deployment, type CiAdapter, type CiPage, type CiRecord } from './common';

const RESULT: Record<string, 'success' | 'failed' | 'cancelled' | undefined> = { SUCCESS: 'success', FAILURE: 'failed', UNSTABLE: 'failed', ABORTED: 'cancelled' };
const STAGE: Record<string, 'success' | 'failed' | 'cancelled' | 'skipped'> = { SUCCESS: 'success', FAILED: 'failed', UNSTABLE: 'failed', ABORTED: 'cancelled', NOT_EXECUTED: 'skipped', SKIPPED: 'skipped' };
const CASE: Record<string, 'passed' | 'failed' | 'skipped'> = { PASSED: 'passed', FIXED: 'passed', FAILED: 'failed', REGRESSION: 'failed', SKIPPED: 'skipped' };

export const jobUrl = (path: string) => '/' + path.split('/').filter(Boolean).map((p) => `job/${encodeURIComponent(p)}`).join('/');

const BUILD_TREE = 'number,result,building,timestamp,duration,url,actions[_class,lastBuiltRevision[SHA1,branch[name]]],artifacts[fileName,relativePath],changeSets[items[commitId,timestamp]]';

export class JenkinsAdapter implements CiAdapter {
  kind = 'ci' as const;
  private client: SourceClient;

  constructor(private src: JenkinsSource, http: HttpSettings, private opts: { links: boolean }, env: NodeJS.ProcessEnv = process.env) {
    const token = requireSecret(src.tokenEnv, `sources.${src.name} (a Jenkins API token)`, env);
    const user = src.user ?? secret(src.userEnv, env);
    if (!user) throw new ConfigError(`sources.${src.name}: set user (or the environment variable ${src.userEnv}): the Jenkins user of the API token`);
    this.client = new SourceClient({
      source: src.name, baseUrl: src.baseUrl, caFile: src.caFile, http, headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${token}`).toString('base64') },
      authHint: 'Use a dedicated Jenkins user with Overall/Read and Job/Read on the jobs, and an API token of that user (People → user → Configure → API Token).',
    });
  }

  requests(): number { return this.client.requests; }

  describe(): string[] {
    return [
      `${this.src.baseUrl} (user + API token), jobs: ${Object.entries(this.src.teams).map(([j, t]) => `${j} → ${t}`).join(', ')}`,
      `builds, Pipeline stages (wfapi), test reports (JUnit plugin), archived artifacts matching ${[...this.src.artifacts.tests, ...this.src.artifacts.coverage, ...this.src.artifacts.sarif].join(' ')} (at most ${this.src.artifacts.maxMB} MB)`,
      Object.keys(this.src.deployJobs).length ? `deployment jobs (${this.src.deployEnvironment}): ${Object.entries(this.src.deployJobs).map(([j, t]) => `${j} → ${t}`).join(', ')}` : 'no deployment jobs (deployJobs)',
    ];
  }

  async check(): Promise<string[]> {
    const out: string[] = [];
    for (const job of [...Object.keys(this.src.teams), ...Object.keys(this.src.deployJobs)]) {
      const j = await this.client.get(`${jobUrl(job)}/api/json`, { tree: 'fullName,lastCompletedBuild[number,timestamp]' });
      out.push(`${job}: last completed build ${j.lastCompletedBuild ? `#${j.lastCompletedBuild.number} (${new Date(j.lastCompletedBuild.timestamp).toISOString()})` : 'none'}`);
    }
    return out;
  }

  /** The finished builds of a job, oldest first: those started in the window, or (all) every one Jenkins returns. */
  private async builds(job: string, since: Date, until: Date, all = false): Promise<any[]> {
    const r = await this.client.get(`${jobUrl(job)}/api/json`, { tree: `builds[${BUILD_TREE}]{0,${this.src.maxRunsPerRepo}}` });
    return (r.builds ?? []).filter((b: any) => !b.building && (all || (b.timestamp >= since.getTime() && b.timestamp < until.getTime()))).sort((a: any, b: any) => a.timestamp - b.timestamp);
  }

  async *collect(since: Date, until: Date): AsyncIterable<CiPage> {
    for (const [job, team] of Object.entries(this.src.teams)) {
      const page: CiPage = { records: [], skipped: [], changedAt: null };
      for (const b of await this.builds(job, since, until)) {
        const result = RESULT[String(b.result)];
        if (!result) { page.skipped.push({ id: `${job}#${b.number}`, reason: `result ${b.result ?? 'none'}` }); continue; }
        try { page.records.push(...(await this.build(job, team, b, result, page))); } catch (e) {
          if (e instanceof SourceError && e.auth) throw e;
          page.skipped.push({ id: `${job}#${b.number}`, reason: (e as Error).message });
        }
        const at = new Date(b.timestamp + (b.duration ?? 0)).toISOString();
        if (!page.changedAt || at > page.changedAt) page.changedAt = at;
      }
      yield page;
    }
    for (const [job, team] of Object.entries(this.src.deployJobs)) {
      const page: CiPage = { records: [], skipped: [], changedAt: null };
      const service = job.split('/').pop()!;
      // Every build Jenkins still lists is read (not only the window), so a redeploy of an earlier commit is recognised as a rollback.
      const rollback = rollbackTracker();
      for (const b of await this.builds(job, since, until, true)) {
        const r = RESULT[String(b.result)];
        if (r !== 'success' && r !== 'failed') continue;
        const rev = this.revision(b);
        const finished = b.timestamp + (b.duration ?? 0);
        const rollbackOf = rollback(job, `${job}#${b.number}`, rev.sha, r === 'success');
        if (b.timestamp < since.getTime() || b.timestamp >= until.getTime()) continue;
        const commits = r === 'success' ? (b.changeSets ?? []).flatMap((c: any) => c.items ?? []).filter((i: any) => i.commitId)
          .map((i: any) => ({ sha: String(i.commitId), authoredAt: typeof i.timestamp === 'number' && i.timestamp > 0 ? i.timestamp : null, committedAt: null })) : [];
        page.records.push(deployment(team, {
          id: `${job}#${b.number}`, environment: this.src.deployEnvironment, service, commit: rev.sha, startedAt: b.timestamp, finishedAt: finished,
          result: r === 'success' ? 'success' : 'failure', rollbackOf, hotfix: /hotfix/i.test(rev.branch ?? ''), url: this.opts.links ? b.url ?? null : null, commits,
        }));
        const at = new Date(finished).toISOString();
        if (!page.changedAt || at > page.changedAt) page.changedAt = at;
      }
      yield page;
    }
  }

  private revision(b: any): { sha: string; branch: string | null } {
    const a = (b.actions ?? []).find((x: any) => x?.lastBuiltRevision?.SHA1);
    const branch = a?.lastBuiltRevision?.branch?.[0]?.name ? String(a.lastBuiltRevision.branch[0].name).replace(/^(refs\/remotes\/)?origin\//, '').replace(/^refs\/heads\//, '') : null;
    return { sha: String(a?.lastBuiltRevision?.SHA1 ?? '').slice(0, 80), branch };
  }

  private async build(job: string, team: string, b: any, result: 'success' | 'failed' | 'cancelled', page: CiPage): Promise<CiRecord[]> {
    const base = `${jobUrl(job)}/${b.number}`;
    const rev = this.revision(b);
    const startedAt = Number(b.timestamp);
    const finishedAt = startedAt + Number(b.duration ?? 0);
    const wf = await this.client.getOptional(`${base}/wfapi/describe`);
    const wfStages = (wf?.stages ?? []).filter((x: any) => x.startTimeMillis);
    const stageNames = wfStages.map((x: any) => String(x.name));
    const stages = wfStages.map((x: any) => {
      const a = Number(x.startTimeMillis);
      const d = Number(x.durationMillis ?? 0);
      // Sharded stages ("tests 1/3", "tests (chrome)") are one parallel group; other parallel test stages are recognised by their overlap in time.
      return { name: String(x.name), parallelGroup: parallelGroupOf(String(x.name), stageNames), startedAt: a, finishedAt: a + d, durationS: Math.round(d / 1000), result: STAGE[String(x.status)] ?? 'skipped' };
    });
    const runId = `${job}#${b.number}`;
    const out: CiRecord[] = [pipelineRun(team, {
      id: runId, attempt: 1, name: job, commit: rev.sha, branch: rev.branch, startedAt, finishedAt,
      durationS: secondsBetween(startedAt, finishedAt), result, url: this.opts.links ? b.url ?? null : null, stages,
    })];
    const meta = { commit: rev.sha, branch: rev.branch, run: runId, attempt: 1, startedAt };
    const tr = await this.client.getOptional(`${base}/testReport/api/json`, { tree: 'duration,suites[name,cases[className,name,status,duration]]' });
    const cases = (tr?.suites ?? []).flatMap((s: any) => (s.cases ?? []).map((c: any) => ({
      suite: String(c.className ?? s.name ?? ''), name: String(c.name ?? ''), status: CASE[String(c.status)] ?? 'skipped', durationMs: Math.round(Number(c.duration ?? 0) * 1000),
    })));
    const files: Array<{ artifact: string; name: string; data: Buffer; kinds: Array<'tests' | 'coverage' | 'sarif'> }> = [];
    for (const a of b.artifacts ?? []) {
      const rel = String(a.relativePath ?? a.fileName);
      const kinds = Array.from(new Set([...kindsOf(String(a.fileName), this.src.artifacts), ...kindsOf(rel, this.src.artifacts)])).filter((k) => k !== 'tests' || !cases.length);
      if (!kinds.length || !(/\.(xml|trx|json|info|lcov|sarif|zip)$/i.test(rel) || globMatch('*lcov*', rel))) continue;
      const d = await this.client.download(`${base}/artifact/${rel.split('/').map(encodeURIComponent).join('/')}`, this.src.artifacts.maxMB * 1024 * 1024);
      if (!d.ok) { page.skipped.push({ id: `${runId}/${rel}`, reason: `artifact ${d.reason}: ${d.message}` }); continue; }
      files.push({ artifact: rel, name: String(a.fileName), data: d.body, kinds });
    }
    const found = files.length ? findReports(files) : { tests: [], coverage: [], sarif: [], files: 0, skipped: [] };
    page.skipped.push(...found.skipped.map((x) => ({ id: `${runId}/${x.id}`, reason: x.reason })));
    // The JUnit plugin gives its results as JSON only: written out as a JUnit file (form, not content).
    if (cases.length) out.push(reportItem('test-report', team, [junitOf(cases, tr?.duration ? Math.round(Number(tr.duration) * 1000) : undefined)], meta, { format: 'junit' }));
    out.push(...reportItems(team, { ...found, tests: cases.length ? [] : found.tests }, meta, job));
    return out;
  }
}
