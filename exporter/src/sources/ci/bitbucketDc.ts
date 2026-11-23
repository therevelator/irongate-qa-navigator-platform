/**
 * Bitbucket Data Center / Server (8.x and later), read-only, through its REST API 1.0.
 *
 * Auth: an HTTP access token (Bearer; a personal token, or a project / repository token with the Read permission).
 *
 * Bitbucket Data Center has no pipelines of its own: builds are reported to it by the CI (Bamboo, Jenkins, …) as
 * build statuses on commits, and deployments as deployment records (Deployments API). Read per repository
 * (repos: PROJECT/repo → team):
 *   GET /rest/api/1.0/projects/{p}/repos/{r}                                     check
 *   GET /rest/api/1.0/projects/{p}/repos/{r}/commits?limit=100&start=N           commits (id, author and commit times), newest first
 *   GET /rest/api/1.0/projects/{p}/repos/{r}/commits/{id}/builds?limit=100       the builds reported on a commit (key, name, state,
 *                                                                                created / updated time, duration)
 *   GET /rest/api/1.0/projects/{p}/repos/{r}/commits/{id}/deployments?limit=100  the deployments of a commit (environment, state, time)
 * Builds become pipeline runs (one stage: the build). Test results: Data Center keeps only counts on a build, not a
 * report, so none are sent (send the test report from the CI itself). Paging: isLastPage / nextPageStart.
 */
import type { BitbucketDcSource, HttpSettings } from '../../config';
import { requireSecret } from '../../config';
import { SourceClient, SourceError } from '../client';
import { ms, pipelineRun, deployment, type CiAdapter, type CiPage, type CiRecord } from './common';

const BUILD: Record<string, 'success' | 'failed' | 'cancelled'> = { SUCCESSFUL: 'success', FAILED: 'failed', CANCELLED: 'cancelled', UNKNOWN: 'cancelled' };

export class BitbucketDcAdapter implements CiAdapter {
  kind = 'ci' as const;
  private client: SourceClient;

  constructor(private src: BitbucketDcSource, http: HttpSettings, private opts: import('./common').CiOptions, env: NodeJS.ProcessEnv = process.env) {
    const token = requireSecret(src.tokenEnv, `sources.${src.name} (a Bitbucket Data Center HTTP access token with Read permission)`, env);
    this.client = new SourceClient({
      source: src.name, baseUrl: src.baseUrl, caFile: src.caFile, http, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      authHint: 'Use an HTTP access token (personal, project or repository) with the Read permission on the repositories.',
    });
  }

  requests(): number { return this.client.requests; }

  private repoPath(repo: string): string {
    const [p, r] = repo.split('/');
    return `/rest/api/1.0/projects/${encodeURIComponent(p)}/repos/${encodeURIComponent(r)}`;
  }

  describe(): string[] {
    return [
      `${this.src.baseUrl} (HTTP access token), repositories: ${Object.entries(this.src.teams).map(([r, t]) => `${r} → ${t}`).join(', ')}`,
      'commits, the builds your CI reports on them (as pipeline runs), and deployments to ' + this.src.environments.join(', ') + ' (or environments of type PRODUCTION)',
    ];
  }

  async check(): Promise<string[]> {
    const out: string[] = [];
    for (const repo of Object.keys(this.src.teams)) {
      const r = await this.client.get(this.repoPath(repo));
      const c = await this.client.get(`${this.repoPath(repo)}/commits`, { limit: 1 });
      out.push(`${repo}: ${r.public ? 'public' : 'private'} repository ${r.name ?? r.slug}; latest commit ${c.values?.[0]?.id?.slice(0, 12) ?? 'none'}`);
    }
    return out;
  }

  private async *paged(path: string, query: Record<string, string | number> = {}, max = 10_000): AsyncGenerator<any[]> {
    let start = 0;
    let n = 0;
    for (;;) {
      const body: any = await this.client.get(path, { limit: 100, start, ...query });
      const items: any[] = body?.values ?? [];
      n += items.length;
      yield items;
      if (body?.isLastPage !== false || typeof body?.nextPageStart !== 'number' || n >= max) return;
      start = body.nextPageStart;
    }
  }

  async *collect(since: Date, until: Date): AsyncIterable<CiPage> {
    for (const [repo, team] of Object.entries(this.src.teams)) {
      const page: CiPage = { records: [], skipped: [], changedAt: null };
      const service = repo.split('/')[1];
      const commits: Array<{ id: string; authoredAt: number | null; committedAt: number | null }> = [];
      let done = false;
      for await (const list of this.paged(`${this.repoPath(repo)}/commits`, {}, this.src.maxRunsPerRepo * 2)) {
        for (const c of list) {
          const t = ms(c.committerTimestamp) ?? ms(c.authorTimestamp);
          if (t !== null && t < since.getTime() - 30 * 86_400_000) { done = true; break; }
          commits.push({ id: String(c.id), authoredAt: ms(c.authorTimestamp), committedAt: ms(c.committerTimestamp) });
        }
        if (done) break;
      }
      commits.reverse();
      const deploys: Array<{ id: string; env: string; sha: string; at: number; ok: boolean }> = [];
      let runs = 0;
      for (const c of commits) {
        try {
          if (runs < this.src.maxRunsPerRepo) for await (const builds of this.paged(`${this.repoPath(repo)}/commits/${c.id}/builds`, {}, 200)) {
            for (const b of builds) {
              const result = BUILD[String(b.state)];
              const finished = ms(b.updatedDate) ?? ms(b.dateAdded);
              if (!result || finished === null || finished < since.getTime() || finished >= until.getTime()) continue;
              const dur = typeof b.duration === 'number' ? Math.round(b.duration / 1000) : null;
              const started = ms(b.createdDate) ?? (dur !== null ? finished - dur * 1000 : finished);
              const id = `${String(b.key ?? b.name ?? 'build')}@${c.id.slice(0, 12)}`;
              page.records.push(pipelineRun(team, {
                id, attempt: 1, name: String(b.name ?? b.key ?? 'build'), commit: c.id, branch: b.ref ? String(b.ref).replace(/^refs\/heads\//, '') : null,
                startedAt: started, finishedAt: finished, durationS: dur, result, url: this.opts.links ? b.url ?? null : null,
                stages: [{ name: String(b.name ?? b.key ?? 'build'), startedAt: started, finishedAt: finished, durationS: dur, result }],
              }));
              runs++;
              const iso = new Date(finished).toISOString();
              if (!page.changedAt || iso > page.changedAt) page.changedAt = iso;
            }
          }
          for await (const ds of this.paged(`${this.repoPath(repo)}/commits/${c.id}/deployments`, {}, 200)) {
            for (const d of ds) {
              const envName = String(d.environment?.displayName ?? d.environment?.key ?? '');
              const prod = String(d.environment?.type ?? '').toUpperCase() === 'PRODUCTION' || this.src.environments.some((x) => x.toLowerCase() === envName.toLowerCase());
              const at = ms(d.lastUpdated);
              if (!prod || at === null || at >= until.getTime() || !['SUCCESSFUL', 'FAILED', 'ROLLED_BACK'].includes(String(d.state))) continue;
              deploys.push({ id: `${String(d.key ?? 'deploy')}#${d.deploymentSequenceNumber ?? c.id.slice(0, 12)}`, env: envName, sha: c.id, at, ok: String(d.state) === 'SUCCESSFUL' });
            }
          }
        } catch (e) {
          if (e instanceof SourceError && e.auth) throw e;
          if (e instanceof SourceError && e.status === 404) continue;
          page.skipped.push({ id: `${repo}@${c.id.slice(0, 12)}`, reason: (e as Error).message });
        }
      }
      deploys.sort((a, b) => a.at - b.at);
      let prev: (typeof deploys)[number] | null = null;
      for (const d of deploys) {
        if (d.at >= since.getTime()) {
          // The commits since the previous successful deployment (from the commit list read above).
          const from = prev ? commits.findIndex((c) => c.id === prev!.sha) : -1;
          const to = commits.findIndex((c) => c.id === d.sha);
          const shipped = d.ok && to >= 0 ? commits.slice(from + 1, to + 1).slice(-1000).map((c) => ({ sha: c.id, authoredAt: c.authoredAt, committedAt: c.committedAt })) : [];
          page.records.push(deployment(team, { id: d.id, environment: d.env, service, commit: d.sha, previousCommit: prev?.sha ?? null, startedAt: null, finishedAt: d.at, result: d.ok ? 'success' : 'failure', commits: shipped }) as CiRecord);
          const iso = new Date(d.at).toISOString();
          if (!page.changedAt || iso > page.changedAt) page.changedAt = iso;
        }
        if (d.ok) prev = d;
      }
      yield page;
    }
  }
}
