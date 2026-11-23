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
import { pullRequest, kindsOf, findReports, parallelGroupOf, rollbackTracker, secondsBetween, ms, pipelineRun, reportItems, reportItem, junitOf, lcovTotalsOf, deployment, type CiAdapter, type CiPage, type CiRecord } from './common';

const V = '7.1';
const RESULT: Record<string, 'success' | 'failed' | 'cancelled' | undefined> = { succeeded: 'success', partiallySucceeded: 'failed', failed: 'failed', canceled: 'cancelled' };
const STEP: Record<string, 'success' | 'failed' | 'cancelled' | 'skipped'> = { succeeded: 'success', succeededWithIssues: 'success', failed: 'failed', canceled: 'cancelled', abandoned: 'cancelled', skipped: 'skipped' };
const OUTCOME: Record<string, 'passed' | 'failed' | 'error' | 'skipped'> = { Passed: 'passed', Failed: 'failed', Error: 'error', Aborted: 'error', Timeout: 'error' };

/** How far before the window deployments are read to recognise a rollback (a redeploy of an earlier build). */
const ROLLBACK_LOOKBACK_DAYS = 30;

export class AzureDevOpsAdapter implements CiAdapter {
  kind = 'ci' as const;
  private client: SourceClient;
  private vsrm: SourceClient | null = null;
  private defs = new Map<string, { id: number; name: string }>();

  constructor(private src: AzureDevOpsSource, http: HttpSettings, private opts: import('./common').CiOptions, env: NodeJS.ProcessEnv = process.env) {
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
    if (this.src.pullRequests) yield await this.pullRequests(since, until);
  }

  /**
   * The project's pull requests created or closed in the window (or still open): created and closed times, the first
   * comment or vote by someone other than the author (from the threads), and (developer metrics only) the author's
   * sign-in address, sent as a pseudonym. The team is the one mapped to the repository's name (or defaultTeam).
   */
  private async pullRequests(since: Date, until: Date): Promise<CiPage> {
    const page: CiPage = { records: [], skipped: [], changedAt: null };
    for (let skip = 0; skip < this.src.maxRunsPerRepo; skip += 100) {
      const list: any[] = (await this.client.get(this.p('/git/pullrequests'), { 'searchCriteria.status': 'all', $top: 100, $skip: skip, 'api-version': V }))?.value ?? [];
      for (const pr of list) {
        const opened = ms(pr.creationDate);
        const closed = ms(pr.closedDate);
        if (opened === null || opened >= until.getTime()) continue;
        if (pr.status !== 'active' && (closed ?? opened) < since.getTime() && opened < since.getTime()) continue;
        const repo = String(pr.repository?.name ?? '');
        const team = this.src.teams[repo] ?? this.src.defaultTeam;
        if (!team) { page.skipped.push({ id: `pull request ${pr.pullRequestId}`, reason: `repository ${repo || '?'} is not mapped to a team (pipelines / defaultTeam)` }); continue; }
        try {
          const author = String(pr.createdBy?.id ?? '');
          const threads: any[] = (await this.client.getOptional(this.p(`/git/repositories/${pr.repository?.id}/pullRequests/${pr.pullRequestId}/threads`), { 'api-version': V }))?.value ?? [];
          const reviews = threads.flatMap((t) => (t.comments ?? []).filter((c: any) => String(c.author?.id ?? '') !== author
            && (c.commentType !== 'system' || t.properties?.CodeReviewThreadType?.$value === 'VoteUpdate')).map((c: any) => ms(c.publishedDate))).filter((t: number | null): t is number => t !== null);
          const state = pr.status === 'completed' ? 'merged' : pr.status === 'abandoned' ? 'closed' : 'open';
          page.records.push(pullRequest(team, {
            id: String(pr.pullRequestId), repo, authorEmail: this.opts.person ? String(pr.createdBy?.uniqueName ?? '') : null, state,
            openedAt: opened, firstReviewAt: reviews.length ? Math.min(...reviews) : null, mergedAt: state === 'merged' ? closed : null, closedAt: state === 'closed' ? closed : null,
          }, this.opts));
        } catch (e) {
          if (e instanceof SourceError && e.auth) throw e;
          page.skipped.push({ id: `pull request ${pr.pullRequestId}`, reason: (e as Error).message });
        }
        const at = closed ?? opened;
        if (!page.changedAt || new Date(at).toISOString() > page.changedAt) page.changedAt = new Date(at).toISOString();
      }
      if (list.length < 100) break;
    }
    return page;
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
    const out: CiRecord[] = [pipelineRun(team, {
      id: String(b.id), attempt: 1, name: b.definition?.name ?? null, commit, branch, startedAt, finishedAt,
      durationS: secondsBetween(startedAt, finishedAt), result, url: this.opts.links ? b._links?.web?.href ?? null : null,
      stages: jobs.map((j) => {
        const a = ms(j.startTime);
        const z = ms(j.finishTime);
        const siblings = byParent.get(j.parentId) ?? [];
        return {
          name: String(j.name), parallelGroup: siblings.length >= 2 ? String(parentName(j.parentId) ?? parallelGroupOf(String(j.name), names) ?? 'parallel') : parallelGroupOf(String(j.name), names),
          startedAt: a, finishedAt: z, durationS: secondsBetween(a, z), result: STEP[String(j.result)] ?? 'skipped',
        };
      }),
    })];
    const meta = { commit, branch, run: String(b.id), attempt: 1, startedAt };
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
    const files: Array<{ artifact: string; name: string; data: Buffer; kinds: import('./common').ArtifactKind[] }> = [];
    for (const a of (await this.client.get(this.p(`/build/builds/${b.id}/artifacts`), { 'api-version': V })).value ?? []) {
      const kinds = kindsOf(String(a.name), this.src.artifacts).filter((k) => k !== 'tests' || !cases.length);
      const url = a.resource?.downloadUrl;
      if (!kinds.length || !url) continue;
      if (new URL(url).origin !== new URL(this.src.orgUrl).origin) { page.skipped.push({ id: `build ${b.id}/${a.name}`, reason: `artifact on another host (${new URL(url).host}): not downloaded with your token` }); continue; }
      const d = await this.client.download(url, this.src.artifacts.maxMB * 1024 * 1024);
      if (!d.ok) { page.skipped.push({ id: `build ${b.id}/${a.name}`, reason: `artifact ${d.reason}: ${d.message}` }); continue; }
      files.push({ artifact: String(a.name), name: `${a.name}.zip`, data: d.body, kinds });
    }
    const found = files.length ? findReports(files) : { tests: [], coverage: [], sarif: [], performance: [], files: 0, skipped: [] };
    page.skipped.push(...found.skipped.map((x) => ({ id: `build ${b.id}/${x.id}`, reason: x.reason })));
    // Azure DevOps gives test results as JSON only: written out as a JUnit file (form, not content).
    if (cases.length) out.push(reportItem('test-report', team, [junitOf(cases)], meta, { format: 'junit' }));
    out.push(...reportItems(team, { ...found, tests: cases.length ? [] : found.tests }, meta, String(b.repository?.name ?? this.src.project)));
    if (!found.coverage.length) {
      // No coverage file: the build's code coverage summary (totals only), as an lcov file of the totals.
      const cc = await this.client.getOptional(this.p('/test/codecoverage'), { buildId: b.id, 'api-version': `${V}-preview.1` });
      const stats = (cc?.coverageData ?? []).flatMap((d: any) => d.coverageStats ?? []);
      const stat = (re: RegExp) => stats.filter((x: any) => re.test(String(x.label))).reduce((acc: { c: number; t: number }, x: any) => ({ c: acc.c + Number(x.covered ?? 0), t: acc.t + Number(x.total ?? 0) }), { c: 0, t: 0 });
      const lines = stat(/^lines?$/i);
      const br = stat(/^branch(es)?$/i);
      if (lines.t > 0) out.push(reportItem('coverage', team, [lcovTotalsOf({ linesFound: lines.t, linesHit: lines.c, branchesFound: br.t, branchesHit: br.c })], meta, { format: 'lcov' }));
    }
    return out;
  }

  private async changes(buildId: number): Promise<Array<{ sha: string; authoredAt: number | null; committedAt: number | null }>> {
    const r = await this.client.getOptional(this.p(`/build/builds/${buildId}/changes`), { $top: 1000, 'api-version': V });
    return (r?.value ?? []).filter((c: any) => c.id && c.type !== 'TfsVersionControl').map((c: any) => ({ sha: String(c.id), authoredAt: ms(c.timestamp), committedAt: null }));
  }

  private async environmentDeployments(since: Date, until: Date): Promise<CiPage> {
    const page: CiPage = { records: [], skipped: [], changedAt: null };
    const envs = ((await this.client.get(this.p('/distributedtask/environments'), { 'api-version': `${V}-preview.1` })).value ?? [])
      .filter((e: any) => this.src.environments.some((x) => x.toLowerCase() === String(e.name).toLowerCase()));
    for (const env of envs) {
      // The records are read 30 days further back than the window and taken in the order they finished: a
      // redeploy of a build that an earlier record already deployed (not the previous one) is the rollback of the previous one.
      const all: any[] = [];
      for await (const recs of this.pages<any>(this.client, this.p(`/distributedtask/environments/${env.id}/environmentdeploymentrecords`), { top: 100, 'api-version': `${V}-preview.1` }, 2000)) all.push(...recs);
      const rollback = rollbackTracker();
      const lookback = since.getTime() - ROLLBACK_LOOKBACK_DAYS * 86_400_000;
      {
        for (const r of all.filter((x) => (ms(x.finishTime) ?? 0) >= lookback).sort((a, b) => (ms(a.finishTime) ?? 0) - (ms(b.finishTime) ?? 0))) {
          const at = ms(r.finishTime);
          if (!at || at >= until.getTime()) continue;
          if (!['succeeded', 'failed'].includes(String(r.result))) continue;
          const rollbackOf = rollback(String(r.definition?.id ?? r.definition?.name ?? ''), `env-${env.id}-${r.id}`, String(r.owner?.id ?? ''), r.result === 'succeeded');
          if (at < since.getTime()) continue;
          const team = this.teamOf(r.definition);
          if (!team) { page.skipped.push({ id: `deployment ${r.id}`, reason: `pipeline ${r.definition?.name ?? '?'} is not mapped` }); continue; }
          const build = r.owner?.id ? await this.client.getOptional(this.p(`/build/builds/${r.owner.id}`), { 'api-version': V }) : null;
          const id = `env-${env.id}-${r.id}`;
          const commits = r.result === 'succeeded' && r.owner?.id ? await this.changes(r.owner.id) : [];
          page.records.push(deployment(team, {
            id, environment: String(env.name), service: String(r.definition?.name ?? env.name), commit: String(build?.sourceVersion ?? '').slice(0, 80),
            startedAt: ms(r.startTime), finishedAt: at, result: r.result === 'succeeded' ? 'success' : 'failure', rollbackOf, hotfix: /hotfix/i.test(String(build?.sourceBranch ?? '')), commits,
          }));
          const iso = new Date(at).toISOString();
          if (!page.changedAt || iso > page.changedAt) page.changedAt = iso;
        }
      }
    }
    return page;
  }

  private async releaseDeployments(since: Date, until: Date): Promise<CiPage> {
    const page: CiPage = { records: [], skipped: [], changedAt: null };
    // Read 30 days further back than the window (ascending), so a redeploy of an earlier build is recognised as a rollback.
    const rollback = rollbackTracker();
    const from = new Date(since.getTime() - ROLLBACK_LOOKBACK_DAYS * 86_400_000);
    for await (const list of this.pages<any>(this.vsrm!, this.p('/release/deployments'), { minStartedTime: from.toISOString(), maxStartedTime: until.toISOString(), queryOrder: 'ascending', $top: 100, 'api-version': V }, 5000)) {
      for (const d of list) {
        if (!this.src.environments.some((x) => x.toLowerCase() === String(d.releaseEnvironment?.name ?? '').toLowerCase())) continue;
        const status = String(d.deploymentStatus);
        if (!['succeeded', 'failed', 'partiallySucceeded'].includes(status)) continue;
        const shipped = (d.release?.artifacts ?? [])[0]?.definitionReference ?? {};
        const rollbackOf = rollback(`${d.releaseDefinition?.id ?? d.releaseDefinition?.name ?? ''}:${d.releaseEnvironment?.name ?? ''}`, `release-${d.id}`, String(shipped.version?.id ?? shipped.sourceVersion?.id ?? ''), status === 'succeeded');
        if ((ms(d.startedOn) ?? ms(d.completedOn) ?? 0) < since.getTime()) continue;
        const team = this.teamOf(d.releaseDefinition);
        if (!team) { page.skipped.push({ id: `release deployment ${d.id}`, reason: `release ${d.releaseDefinition?.name ?? '?'} is not mapped` }); continue; }
        const art = (d.release?.artifacts ?? [])[0]?.definitionReference ?? {};
        const at = ms(d.completedOn) ?? ms(d.lastModifiedOn);
        if (!at) continue;
        const buildId = Number(art.version?.id);
        const commits = status === 'succeeded' && Number.isInteger(buildId) && buildId > 0 ? await this.changes(buildId) : [];
        page.records.push(deployment(team, {
          id: `release-${d.id}`, environment: String(d.releaseEnvironment?.name), service: String(d.releaseDefinition?.name ?? ''), commit: String(art.sourceVersion?.id ?? '').slice(0, 80),
          startedAt: ms(d.startedOn), finishedAt: at, result: status === 'succeeded' ? 'success' : 'failure', rollbackOf, hotfix: /hotfix/i.test(String(art.branch?.name ?? '')), commits,
        }));
        const iso = new Date(at).toISOString();
        if (!page.changedAt || iso > page.changedAt) page.changedAt = iso;
      }
    }
    return page;
  }
}
