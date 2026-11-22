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
 * change sets.
 */
import type { HttpSettings, JenkinsSource } from '../../config';
import { requireSecret, secret, ConfigError } from '../../config';
import { SourceClient, SourceError } from '../client';
import { globMatch, kindsOf, parseArtifacts, secondsBetween, testReportOf, type CiAdapter, type CiPage, type CiRecord } from './common';
import { testRunRecord, coverageRecord, analysisRecord, pipelineRecord, deploymentRecord } from '../../../../packages/engine/src/store/records';
import { stageKind } from '../../../../packages/engine/src/parsers/pipelineEvents';

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

  private async builds(job: string, since: Date, until: Date): Promise<any[]> {
    const r = await this.client.get(`${jobUrl(job)}/api/json`, { tree: `builds[${BUILD_TREE}]{0,${this.src.maxRunsPerRepo}}` });
    return (r.builds ?? []).filter((b: any) => !b.building && b.timestamp >= since.getTime() && b.timestamp < until.getTime()).sort((a: any, b: any) => a.timestamp - b.timestamp);
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
      for (const b of await this.builds(job, since, until)) {
        const r = RESULT[String(b.result)];
        if (r !== 'success' && r !== 'failed') continue;
        const rev = this.revision(b);
        const finished = b.timestamp + (b.duration ?? 0);
        page.records.push({
          kind: 'deployment', team, rec: deploymentRecord(team, {
            id: `${job}#${b.number}`, team, environment: this.src.deployEnvironment, production: true, service, commit: rev.sha, commits: [], commitFrom: null,
            startedAt: new Date(b.timestamp), finishedAt: new Date(finished), result: r === 'success' ? 'success' : 'failure', rollbackOf: null, hotfix: /hotfix/i.test(rev.branch ?? ''),
            url: this.opts.links ? b.url ?? null : null,
          }),
        });
        const commits = (b.changeSets ?? []).flatMap((c: any) => c.items ?? []).filter((i: any) => i.commitId)
          .map((i: any) => ({ sha: String(i.commitId), deployment: '', authoredAt: typeof i.timestamp === 'number' && i.timestamp > 0 ? i.timestamp : null, committedAt: null, branch: rev.branch }));
        if (commits.length) page.records.push({ kind: 'commits', team, deployment: `${job}#${b.number}`, commits });
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
    const stages = (wf?.stages ?? []).filter((s: any) => s.startTimeMillis).map((s: any) => {
      const a = Number(s.startTimeMillis);
      const d = Number(s.durationMillis ?? 0);
      return { name: String(s.name).slice(0, 255), kind: stageKind(String(s.name)), parallelGroup: null, startedAt: new Date(a), finishedAt: new Date(a + d), durationS: Math.round(d / 1000), result: STAGE[String(s.status)] ?? 'skipped' };
    });
    const runId = `${job}#${b.number}`;
    const out: CiRecord[] = [{
      kind: 'pipeline', team, rec: pipelineRecord(team, {
        id: runId, attempt: 1, name: job, commit: rev.sha, branch: rev.branch, startedAt: new Date(startedAt), finishedAt: new Date(finishedAt),
        durationS: secondsBetween(startedAt, finishedAt), result, url: this.opts.links ? b.url ?? null : null, stages,
      }),
    }];
    const meta = { commit: rev.sha, branch: rev.branch, runId, attempt: 1, startedAt };
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
    const parsed = files.length ? parseArtifacts(files) : null;
    if (parsed) page.skipped.push(...parsed.skipped.map((s) => ({ id: `${runId}/${s.id}`, reason: s.reason })));
    const tests = cases.length ? testReportOf(cases, 'junit', new Date(startedAt), tr?.duration ? Math.round(Number(tr.duration) * 1000) : undefined) : parsed?.tests ?? null;
    if (tests) out.push({ kind: 'testRun', team, rec: testRunRecord(team, tests, meta) });
    if (parsed?.coverage) out.push({ kind: 'coverage', team, rec: coverageRecord(team, parsed.coverage, { commit: rev.sha, branch: rev.branch, runId, attempt: 1, createdAt: finishedAt }) });
    for (const s of parsed?.sarif ?? []) out.push({ kind: 'analysis', team, rec: analysisRecord(team, s, { repo: s.repo ?? job, branch: rev.branch, commit: rev.sha, runId, attempt: 1, analyzedAt: finishedAt, linesOfCode: s.linesOfCode }) });
    return out;
  }
}
