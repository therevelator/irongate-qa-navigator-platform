/**
 * Azure DevOps Pipelines (Services or Server), read-only.
 *
 * Auth: a personal access token with the scopes Build (Read), Test Management (Read), Code (Read) and
 * Environment (Read); Release (Read) when classic release pipelines are read (releases: true). Basic auth
 * with an empty user name.
 *
 * Read (pipelines: pipeline name or definition id → team):
 *   GET {org}/{project}/_apis/build/builds?definitions=…&minTime=<cursor>&statusFilter=completed   builds (x-ms-continuationtoken)
 *   GET …/_apis/build/builds/{id}/timeline                                                     jobs (stages) and tasks (steps) with timings
 *   GET …/_apis/test/runs?buildUri=vstfs:///Build/Build/{id}, …/_apis/test/Runs/{run}/results   test results
 *   GET …/_apis/test/codecoverage?buildId={id}                                                 code coverage summary
 *   GET …/_apis/build/builds/{id}/artifacts                                                    artifacts (coverage per file, SARIF, more tests)
 *   GET …/_apis/distributedtask/environments, …/environments/{id}/environmentdeploymentrecords deployments to production environments
 *   GET …/_apis/build/builds/{id}/changes                                                      the commits a deployment shipped
 *   GET {vsrm}/{project}/_apis/release/deployments (releases: true)                            classic release deployments
 */
import type { AzureDevOpsSource, HttpSettings } from '../../config';
import { requireSecret } from '../../config';
import { SourceClient, SourceError } from '../client';
import { kindsOf, parseArtifacts, parallelGroupOf, secondsBetween, ms, testReportOf, type CiAdapter, type CiPage, type CiRecord } from './common';
import { testRunRecord, coverageRecord, analysisRecord, pipelineRecord, deploymentRecord } from '../../../../packages/engine/src/store/records';
import { stageKind } from '../../../../packages/engine/src/parsers/pipelineEvents';
import type { ParsedCoverage } from '../../../../packages/engine/src/parsers/coverageReports';

const V = '7.1';
const RESULT: Record<string, 'success' | 'failed' | 'cancelled' | undefined> = { succeeded: 'success', partiallySucceeded: 'failed', failed: 'failed', canceled: 'cancelled' };
const STEP: Record<string, 'success' | 'failed' | 'cancelled' | 'skipped'> = { succeeded: 'success', succeededWithIssues: 'success', failed: 'failed', canceled: 'cancelled', abandoned: 'cancelled', skipped: 'skipped' };
const OUTCOME: Record<string, 'passed' | 'failed' | 'error' | 'skipped'> = { Passed: 'passed', Failed: 'failed', Error: 'error', Aborted: 'error', Timeout: 'error' };

export class AzureDevOpsAdapter implements CiAdapter {
  kind = 'ci' as const;
  private client: SourceClient;
  private vsrm: SourceClient | null = null;
  private defs = new Map<string, { id: number; name: string }>();

  constructor(private src: AzureDevOpsSource, http: HttpSettings, private opts: { links: boolean }, env: NodeJS.ProcessEnv = process.env) {
    const token = requireSecret(src.tokenEnv, `sources.${src.name} (an Azure DevOps personal access token)`, env);
    const headers = { Authorization: 'Basic ' + Buffer.from(`:${token}`).toString('base64') };
    const authHint = 'Use a personal access token with Build (Read), Test Management (Read), Code (Read) and Environment (Read)' + (src.releases ? ' and Release (Read)' : '') + ' on the organisation.';
    this.client = new SourceClient({ source: src.name, baseUrl: src.orgUrl, caFile: src.caFile, http, headers, authHint });
    if (src.releases) this.vsrm = new SourceClient({ source: src.name, baseUrl: src.releasesUrl, caFile: src.caFile, http, headers: { ...headers }, authHint });
  }

  requests(): number { return this.client.requests + (this.vsrm?.requests ?? 0); }
  private p(path: string): string { return `/${encodeURIComponent(this.src.project)}/_apis${path}`; }

  describe(): string[] {
    return [
      `${this.src.orgUrl}, project ${this.src.project} (personal access token), pipelines: ${Object.entries(this.src.teams).map(([p, t]) => `${p} → ${t}`).join(', ')}`,
      `completed builds, their timelines (jobs and tasks), test runs and results, code coverage, artifacts matching ${[...this.src.artifacts.tests, ...this.src.artifacts.coverage, ...this.src.artifacts.sarif].join(' ')} (at most ${this.src.artifacts.maxMB} MB)`,
      `deployments to the environments ${this.src.environments.join(', ')}${this.src.releases ? ` and classic release deployments (${this.src.releasesUrl})` : ''}, with the commits of each build`,
    ];
  }

  private async definitions(): Promise<Map<string, { id: number; name: string }>> {
    if (!this.defs.size) {
      const all: any[] = [];
      for await (const l of this.pages<any>(this.client, this.p('/build/definitions'), { 'api-version': V })) all.push(...l);
      for (const [key] of Object.entries(this.src.teams)) {
        const d = all.find((x) => String(x.id) === key || x.name === key);
        if (d) this.defs.set(key, { id: d.id, name: d.name });
      }
    }
    return this.defs;
  }

  async check(): Promise<string[]> {
    const defs = await this.definitions();
    const out = Object.keys(this.src.teams).map((k) => (defs.has(k) ? `pipeline ${k}: definition ${defs.get(k)!.id}` : `pipeline ${k}: NOT FOUND in project ${this.src.project}`));
    const envs = await this.client.get(this.p('/distributedtask/environments'), { 'api-version': `${V}-preview.1` });
    out.push(`environments: ${(envs.value ?? []).map((e: any) => e.name).join(', ') || 'none'}`);
    if (this.vsrm) { await this.vsrm.get(this.p('/release/definitions'), { 'api-version': V, $top: 1 }); out.push(`classic releases readable (${this.src.releasesUrl})`); }
    return out;
  }

  /** Pages of a list endpoint ({value: […]} with the continuation token header). */
  private async *pages<T>(client: SourceClient, path: string, query: Record<string, string | number>, max = 10_000): AsyncGenerator<T[]> {
    let token: string | null = null;
    let n = 0;
    do {
      const res = await client.getResponse(path, { ...query, ...(token ? { continuationToken: token } : {}) });
      const items: T[] = res.json<any>()?.value ?? [];
      n += items.length;
      yield items;
      token = (res.headers['x-ms-continuationtoken'] as string | undefined) ?? null;
    } while (token && n < max);
  }

  private teamOf(def: { id?: number; name?: string } | undefined): string | null {
    if (!def) return this.src.defaultTeam;
    return this.src.teams[String(def.id)] ?? this.src.teams[String(def.name)] ?? this.src.defaultTeam;
  }

  async *collect(since: Date, until: Date): AsyncIterable<CiPage> {
    const defs = await this.definitions();
    if (defs.size) {
      for await (const builds of this.pages<any>(this.client, this.p('/build/builds'), {
        definitions: Array.from(defs.values()).map((d) => d.id).join(','), minTime: since.toISOString(), maxTime: until.toISOString(), statusFilter: 'completed',
        queryOrder: 'finishTimeAscending', $top: 100, 'api-version': V,
      }, this.src.maxRunsPerRepo * Math.max(1, defs.size))) {
        const page: CiPage = { records: [], skipped: [], changedAt: null };
        for (const b of builds) {
          const team = this.teamOf(b.definition);
          const result = RESULT[String(b.result)];
          if (!team || !result) { page.skipped.push({ id: `build ${b.id}`, reason: !team ? `pipeline ${b.definition?.name} is not mapped` : `result ${b.result}` }); continue; }
          try { page.records.push(...(await this.build(team, b, result, page))); } catch (e) {
            if (e instanceof SourceError && e.auth) throw e;
            page.skipped.push({ id: `build ${b.id}`, reason: (e as Error).message });
          }
          const at = ms(b.finishTime);
          if (at && (!page.changedAt || new Date(at).toISOString() > page.changedAt)) page.changedAt = new Date(at).toISOString();
        }
        yield page;
      }
    }
    yield await this.environmentDeployments(since, until);
    if (this.vsrm) yield await this.releaseDeployments(since, until);
  }

  private async build(team: string, b: any, result: 'success' | 'failed' | 'cancelled', page: CiPage): Promise<CiRecord[]> {
    const startedAt = ms(b.startTime) ?? ms(b.queueTime)!;
    const finishedAt = ms(b.finishTime);
    const commit = String(b.sourceVersion ?? '').slice(0, 80);
    const branch = b.sourceBranch ? String(b.sourceBranch).replace(/^refs\/heads\//, '') : null;
    const tl = await this.client.getOptional(this.p(`/build/builds/${b.id}/timeline`), { 'api-version': V });
    const records: any[] = tl?.records ?? [];
    const jobs = records.filter((r) => r.type === 'Job' && r.startTime);
    const byParent = new Map<string, any[]>();
    for (const j of jobs) { const l = byParent.get(j.parentId) ?? []; l.push(j); byParent.set(j.parentId, l); }
    const names = jobs.map((j) => String(j.name));
    const parentName = (id: string) => records.find((r) => r.id === id)?.name ?? null;
    const out: CiRecord[] = [{
      kind: 'pipeline', team, rec: {
        ...pipelineRecord(team, {
          id: String(b.id), attempt: 1, name: b.definition?.name ?? null, commit, branch, startedAt: new Date(startedAt), finishedAt: finishedAt ? new Date(finishedAt) : null,
          durationS: secondsBetween(startedAt, finishedAt), result, url: this.opts.links ? b._links?.web?.href ?? null : null,
          stages: jobs.map((j) => {
            const a = ms(j.startTime);
            const z = ms(j.finishTime);
            const siblings = byParent.get(j.parentId) ?? [];
            return {
              name: String(j.name).slice(0, 255), kind: stageKind(String(j.name)), parallelGroup: siblings.length >= 2 ? String(parentName(j.parentId) ?? parallelGroupOf(String(j.name), names) ?? 'parallel') : parallelGroupOf(String(j.name), names),
              startedAt: a ? new Date(a) : null, finishedAt: z ? new Date(z) : null, durationS: secondsBetween(a, z), result: STEP[String(j.result)] ?? 'skipped',
            };
          }),
        }),
        steps: records.filter((r) => r.type === 'Task' && r.startTime).map((t) => ({
          job: String(records.find((r) => r.id === t.parentId)?.name ?? '').slice(0, 255), name: String(t.name).slice(0, 255), durationS: secondsBetween(ms(t.startTime), ms(t.finishTime)), result: STEP[String(t.result)] ?? 'skipped',
        })),
      },
    }];
    const meta = { commit, branch, runId: String(b.id), attempt: 1, startedAt };
    // Test results of the build's test runs.
    const runs = (await this.client.get(this.p('/test/runs'), { buildUri: `vstfs:///Build/Build/${b.id}`, 'api-version': V })).value ?? [];
    const cases: Array<{ suite: string; name: string; status: 'passed' | 'failed' | 'error' | 'skipped'; durationMs: number }> = [];
    for (const r of runs) {
      for (let skip = 0; skip < 100_000; skip += 1000) {
        const res = (await this.client.get(this.p(`/test/Runs/${r.id}/results`), { $top: 1000, $skip: skip, 'api-version': V })).value ?? [];
        for (const x of res) cases.push({ suite: String(x.automatedTestStorage ?? r.name ?? ''), name: String(x.automatedTestName ?? x.testCaseTitle ?? ''), status: OUTCOME[String(x.outcome)] ?? 'skipped', durationMs: Number(x.durationInMs ?? 0) });
        if (res.length < 1000) break;
      }
    }
    // Artifacts (coverage per file, SARIF; test files when there are no test runs).
    const files: Array<{ artifact: string; name: string; data: Buffer; kinds: Array<'tests' | 'coverage' | 'sarif'> }> = [];
    for (const a of (await this.client.get(this.p(`/build/builds/${b.id}/artifacts`), { 'api-version': V })).value ?? []) {
      const kinds = kindsOf(String(a.name), this.src.artifacts).filter((k) => k !== 'tests' || !cases.length);
      const url = a.resource?.downloadUrl;
      if (!kinds.length || !url) continue;
      if (new URL(url).origin !== new URL(this.src.orgUrl).origin) { page.skipped.push({ id: `build ${b.id}/${a.name}`, reason: `artifact on another host (${new URL(url).host}): not downloaded with your token` }); continue; }
      const d = await this.client.download(url, this.src.artifacts.maxMB * 1024 * 1024);
      if (!d.ok) { page.skipped.push({ id: `build ${b.id}/${a.name}`, reason: `artifact ${d.reason}: ${d.message}` }); continue; }
      files.push({ artifact: String(a.name), name: `${a.name}.zip`, data: d.body, kinds });
    }
    const parsed = files.length ? parseArtifacts(files) : null;
    if (parsed) page.skipped.push(...parsed.skipped.map((s) => ({ id: `build ${b.id}/${s.id}`, reason: s.reason })));
    const tests = cases.length ? testReportOf(cases, 'trx', new Date(startedAt)) : parsed?.tests ?? null;
    if (tests) out.push({ kind: 'testRun', team, rec: testRunRecord(team, tests, meta) });
    let coverage: ParsedCoverage | null = parsed?.coverage ?? null;
    if (!coverage) {
      const cc = await this.client.getOptional(this.p('/test/codecoverage'), { buildId: b.id, 'api-version': `${V}-preview.1` });
      const stats = (cc?.coverageData ?? []).flatMap((d: any) => d.coverageStats ?? []);
      const stat = (re: RegExp) => stats.filter((s: any) => re.test(String(s.label))).reduce((acc: { c: number; t: number }, s: any) => ({ c: acc.c + Number(s.covered ?? 0), t: acc.t + Number(s.total ?? 0) }), { c: 0, t: 0 });
      const lines = stat(/^lines?$/i);
      const br = stat(/^branch(es)?$/i);
      if (lines.t > 0) coverage = { format: 'cobertura', files: [], totals: { linesFound: lines.t, linesHit: lines.c, branchesFound: br.t, branchesHit: br.c } };
    }
    if (coverage) out.push({ kind: 'coverage', team, rec: coverageRecord(team, coverage, { commit, branch, runId: String(b.id), attempt: 1, createdAt: finishedAt ?? startedAt }) });
    for (const s of parsed?.sarif ?? []) out.push({ kind: 'analysis', team, rec: analysisRecord(team, s, { repo: String(b.repository?.name ?? this.src.project), branch, commit, runId: String(b.id), attempt: 1, analyzedAt: finishedAt ?? startedAt, linesOfCode: s.linesOfCode }) });
    return out;
  }

  private async changes(buildId: number): Promise<Array<{ sha: string; deployment: string; authoredAt: number | null; committedAt: number | null; branch: string | null }>> {
    const r = await this.client.getOptional(this.p(`/build/builds/${buildId}/changes`), { $top: 1000, 'api-version': V });
    return (r?.value ?? []).filter((c: any) => c.id && c.type !== 'TfsVersionControl').map((c: any) => ({ sha: String(c.id), deployment: '', authoredAt: ms(c.timestamp), committedAt: null, branch: null }));
  }

  private async environmentDeployments(since: Date, until: Date): Promise<CiPage> {
    const page: CiPage = { records: [], skipped: [], changedAt: null };
    const envs = ((await this.client.get(this.p('/distributedtask/environments'), { 'api-version': `${V}-preview.1` })).value ?? [])
      .filter((e: any) => this.src.environments.some((x) => x.toLowerCase() === String(e.name).toLowerCase()));
    for (const env of envs) {
      for await (const recs of this.pages<any>(this.client, this.p(`/distributedtask/environments/${env.id}/environmentdeploymentrecords`), { top: 100, 'api-version': `${V}-preview.1` }, 2000)) {
        for (const r of recs) {
          const at = ms(r.finishTime);
          if (!at || at < since.getTime() || at >= until.getTime()) continue;
          if (!['succeeded', 'failed'].includes(String(r.result))) continue;
          const team = this.teamOf(r.definition);
          if (!team) { page.skipped.push({ id: `deployment ${r.id}`, reason: `pipeline ${r.definition?.name ?? '?'} is not mapped` }); continue; }
          const build = r.owner?.id ? await this.client.getOptional(this.p(`/build/builds/${r.owner.id}`), { 'api-version': V }) : null;
          const id = `env-${env.id}-${r.id}`;
          page.records.push({
            kind: 'deployment', team, rec: deploymentRecord(team, {
              id, team, environment: String(env.name), production: true, service: String(r.definition?.name ?? env.name), commit: String(build?.sourceVersion ?? '').slice(0, 80), commits: [], commitFrom: null,
              startedAt: ms(r.startTime) ? new Date(ms(r.startTime)!) : null, finishedAt: new Date(at), result: r.result === 'succeeded' ? 'success' : 'failure', rollbackOf: null,
              hotfix: /hotfix/i.test(String(build?.sourceBranch ?? '')), url: null,
            }),
          });
          if (r.result === 'succeeded' && r.owner?.id) {
            const commits = await this.changes(r.owner.id);
            if (commits.length) page.records.push({ kind: 'commits', team, deployment: id, commits });
          }
          const iso = new Date(at).toISOString();
          if (!page.changedAt || iso > page.changedAt) page.changedAt = iso;
        }
      }
    }
    return page;
  }

  private async releaseDeployments(since: Date, until: Date): Promise<CiPage> {
    const page: CiPage = { records: [], skipped: [], changedAt: null };
    for await (const list of this.pages<any>(this.vsrm!, this.p('/release/deployments'), { minStartedTime: since.toISOString(), maxStartedTime: until.toISOString(), queryOrder: 'ascending', $top: 100, 'api-version': V }, 5000)) {
      for (const d of list) {
        if (!this.src.environments.some((x) => x.toLowerCase() === String(d.releaseEnvironment?.name ?? '').toLowerCase())) continue;
        const status = String(d.deploymentStatus);
        if (!['succeeded', 'failed', 'partiallySucceeded'].includes(status)) continue;
        const team = this.teamOf(d.releaseDefinition);
        if (!team) { page.skipped.push({ id: `release deployment ${d.id}`, reason: `release ${d.releaseDefinition?.name ?? '?'} is not mapped` }); continue; }
        const art = (d.release?.artifacts ?? [])[0]?.definitionReference ?? {};
        const at = ms(d.completedOn) ?? ms(d.lastModifiedOn);
        if (!at) continue;
        page.records.push({
          kind: 'deployment', team, rec: deploymentRecord(team, {
            id: `release-${d.id}`, team, environment: String(d.releaseEnvironment?.name), production: true, service: String(d.releaseDefinition?.name ?? ''), commit: String(art.sourceVersion?.id ?? '').slice(0, 80),
            commits: [], commitFrom: null, startedAt: ms(d.startedOn) ? new Date(ms(d.startedOn)!) : null, finishedAt: new Date(at), result: status === 'succeeded' ? 'success' : 'failure',
            rollbackOf: null, hotfix: /hotfix/i.test(String(art.branch?.name ?? '')), url: null,
          }),
        });
        const buildId = Number(art.version?.id);
        if (status === 'succeeded' && Number.isInteger(buildId) && buildId > 0) {
          const commits = await this.changes(buildId);
          if (commits.length) page.records.push({ kind: 'commits', team, deployment: `release-${d.id}`, commits });
        }
        const iso = new Date(at).toISOString();
        if (!page.changedAt || iso > page.changedAt) page.changedAt = iso;
      }
    }
    return page;
  }
}
