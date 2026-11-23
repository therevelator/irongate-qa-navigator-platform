/**
 * Xray Cloud (Jira test management), read-only, through its GraphQL API.
 *
 * Auth: an Xray API key (client id + client secret, Xray → Settings → API Keys) exchanged for a token:
 *   POST <apiUrl>/authenticate { client_id, client_secret }   → the token (a JSON string)
 * Read per Jira project (projects: Jira project key → team), queries only, never a mutation:
 *   getTests(jql: "project = <KEY>")                  tests: issue key, test type, original estimate
 *   getTestExecutions(jql: "project = <KEY> AND updated >= …") { testRuns }   runs: status, started, finished, the test
 * A test is automated when its test type is not one of manualTypes (default: Manual): Xray's Generic and Cucumber
 * tests are run by automation. A run is an automated run when its test is automated.
 * Xray Server / Data Center has a different API and is not read by this connector.
 */
import type { HttpSettings, XraySource } from '../../config';
import { requireSecret, secret, ConfigError } from '../../config';
import { SourceClient, SourceError } from '../client';
import type { CiAdapter, CiPage } from '../ci/common';
import { testCase, testExecution } from './common';

const PAGE = 100;
const jqlDate = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

export class XrayAdapter implements CiAdapter {
  kind = 'ci' as const;
  private client: SourceClient;
  private token: string | null = null;
  private clientId: string;
  private clientSecret: string;

  constructor(private src: XraySource, http: HttpSettings, env: NodeJS.ProcessEnv = process.env) {
    this.clientSecret = requireSecret(src.tokenEnv, `sources.${src.name} (the Xray API key's client secret)`, env);
    const id = src.clientId ?? secret(src.clientIdEnv, env);
    if (!id) throw new ConfigError(`sources.${src.name}: set clientId (or the environment variable ${src.clientIdEnv}): the Xray API key's client id`);
    this.clientId = id;
    this.client = new SourceClient({
      source: src.name, baseUrl: src.apiUrl, caFile: src.caFile, http, headers: {},
      authHint: 'Use an Xray API key (Xray → Settings → API Keys) of a user who can browse the projects.',
    });
  }

  requests(): number { return this.client.requests; }

  describe(): string[] {
    return [
      `Xray Cloud GraphQL at ${this.src.apiUrl} (API key, queries only), projects: ${Object.entries(this.src.teams).map(([p, t]) => `${p} → ${t}`).join(', ')}`,
      `tests (issue key, test type: automated unless ${this.src.manualTypes.join(' / ')}, original estimate) and test runs (status, started, finished); no summaries, steps or comments`,
    ];
  }

  private async auth(): Promise<void> {
    if (this.token) return;
    const t = await this.client.postQuery<unknown>('/authenticate', { client_id: this.clientId, client_secret: this.clientSecret });
    if (typeof t !== 'string' || !t) throw new SourceError(`${this.src.name}: Xray did not return a token`, null, true);
    this.token = t;
    this.client.setHeader('Authorization', `Bearer ${t}`);
  }

  private async query(q: string, variables: Record<string, unknown>): Promise<any> {
    await this.auth();
    const r = await this.client.postQuery<any>('/graphql', { query: q, variables });
    if (Array.isArray(r?.errors) && r.errors.length) throw new SourceError(`${this.src.name}: Xray answered: ${String(r.errors[0]?.message ?? 'error').slice(0, 200)}`);
    return r?.data ?? {};
  }

  async check(): Promise<string[]> {
    const out: string[] = [];
    for (const key of Object.keys(this.src.teams)) {
      const d = await this.query('query($jql: String!) { getTests(jql: $jql, limit: 1) { total } }', { jql: `project = "${key}"` });
      out.push(`${key}: ${d.getTests?.total ?? 0} tests`);
    }
    return out;
  }

  async *collect(since: Date, until: Date): AsyncIterable<CiPage> {
    for (const [key, team] of Object.entries(this.src.teams)) {
      const page: CiPage = { records: [], skipped: [], changedAt: null };
      try {
        const automated = new Map<string, boolean>();
        for (let start = 0; ; start += PAGE) {
          const d = await this.query(
            'query($jql: String!, $limit: Int!, $start: Int!) { getTests(jql: $jql, limit: $limit, start: $start) { total results { issueId testType { name } jira(fields: ["key", "timeoriginalestimate", "updated"]) } } }',
            { jql: `project = "${key}"`, limit: PAGE, start });
          const list: any[] = d.getTests?.results ?? [];
          for (const t of list) {
            const k = String(t.jira?.key ?? t.issueId ?? '');
            if (!k) continue;
            const isAutomated = !this.src.manualTypes.includes(String(t.testType?.name ?? '').toLowerCase());
            automated.set(String(t.issueId), isAutomated);
            const upd = Date.parse(String(t.jira?.updated ?? ''));
            page.records.push(testCase(team, 'xray', { key: k, automated: isAutomated, manualEstimateSeconds: Number(t.jira?.timeoriginalestimate) || null, updatedAt: Number.isNaN(upd) ? null : upd }));
          }
          if (list.length < PAGE || start + PAGE >= (d.getTests?.total ?? 0)) break;
        }
        for (let start = 0; ; start += PAGE) {
          const d = await this.query(
            'query($jql: String!, $limit: Int!, $start: Int!) { getTestExecutions(jql: $jql, limit: $limit, start: $start) { total results { issueId testRuns(limit: 100) { results { id status { name } startedOn finishedOn test { issueId jira(fields: ["key"]) } } } } } }',
            { jql: `project = "${key}" AND updated >= "${jqlDate(since)}"`, limit: PAGE, start });
          const list: any[] = d.getTestExecutions?.results ?? [];
          for (const ex of list) {
            for (const r of ex.testRuns?.results ?? []) {
              const finished = Date.parse(String(r.finishedOn ?? ''));
              const started = Date.parse(String(r.startedOn ?? ''));
              const at = Number.isNaN(finished) ? started : finished;
              const caseKey = String(r.test?.jira?.key ?? r.test?.issueId ?? '');
              if (Number.isNaN(at) || at < since.getTime() || at >= until.getTime() || !caseKey) continue;
              page.records.push(testExecution(team, 'xray', {
                key: String(r.id), caseKey, automated: automated.get(String(r.test?.issueId)) ?? false, status: r.status?.name ?? null, executedAt: at,
                durationSeconds: !Number.isNaN(finished) && !Number.isNaN(started) && finished >= started ? (finished - started) / 1000 : null,
              }));
              const t = new Date(at).toISOString();
              if (!page.changedAt || t > page.changedAt) page.changedAt = t;
            }
          }
          if (list.length < PAGE || start + PAGE >= (d.getTestExecutions?.total ?? 0)) break;
        }
      } catch (e) {
        if (e instanceof SourceError && e.auth) throw e;
        page.skipped.push({ id: `project ${key}`, reason: (e as Error).message });
      }
      yield page;
    }
  }
}
