/**
 * Zephyr Scale Cloud (Jira test management), read-only, REST API v2.
 *
 * Auth: an API access token (Zephyr Scale → API Access Tokens), Bearer. Only GET requests.
 *
 * Read per Jira project (projects: Jira project key → team):
 *   GET /testcases?projectKey=<KEY>                                  cases: key, estimatedTime (ms), labels, custom fields
 *   GET /testexecutions?projectKey=<KEY>&actualEndDateAfter=…        executions: the case, automated, end date, executionTime (ms)
 *   GET /statuses?projectKey=<KEY>&statusType=TEST_EXECUTION         the names of the execution statuses
 * Zephyr Scale has no built-in "automated" flag on a case: a case is automated when its custom field automatedField
 * (default "Automated") has one of automatedValues (true, yes, automated), or it carries one of automatedLabels
 * (automated, automation). An execution is automated when Zephyr marks it so (its own "automated" flag).
 */
import type { HttpSettings, ZephyrSource } from '../../config';
import { requireSecret } from '../../config';
import { SourceClient, SourceError } from '../client';
import type { CiAdapter, CiPage } from '../ci/common';
import { testCase, testExecution } from './common';

const PAGE = 100;

export class ZephyrAdapter implements CiAdapter {
  kind = 'ci' as const;
  private client: SourceClient;

  constructor(private src: ZephyrSource, http: HttpSettings, env: NodeJS.ProcessEnv = process.env) {
    const token = requireSecret(src.tokenEnv, `sources.${src.name} (a Zephyr Scale API access token)`, env);
    this.client = new SourceClient({
      source: src.name, baseUrl: src.apiUrl, caFile: src.caFile, http, headers: { Authorization: `Bearer ${token}` },
      authHint: 'Use a Zephyr Scale API access token (your Jira profile → Zephyr Scale API Access Tokens) of a user who can browse the projects.',
    });
  }

  requests(): number { return this.client.requests; }

  describe(): string[] {
    return [
      `Zephyr Scale at ${this.src.apiUrl} (API access token), projects: ${Object.entries(this.src.teams).map(([p, t]) => `${p} → ${t}`).join(', ')}`,
      `test cases (key, automated: custom field "${this.src.automatedField}" or a label ${this.src.automatedLabels.join(' / ')}, estimated time) and test executions (automated, status, end date, execution time); no names, steps or comments`,
    ];
  }

  private async list(path: string, query: Record<string, string | number>, max = 100_000): Promise<any[]> {
    const out: any[] = [];
    for (let startAt = 0; out.length < max; startAt += PAGE) {
      const body: any = await this.client.get(path, { ...query, maxResults: PAGE, startAt });
      const items: any[] = body?.values ?? [];
      out.push(...items);
      if (items.length < PAGE || body?.isLast === true) break;
    }
    return out;
  }

  async check(): Promise<string[]> {
    const out: string[] = [];
    for (const key of Object.keys(this.src.teams)) {
      const body: any = await this.client.get('/testcases', { projectKey: key, maxResults: 1 });
      out.push(`${key}: ${body?.total ?? (body?.values ?? []).length} test cases`);
    }
    return out;
  }

  private isAutomated(c: any): boolean {
    const v = c?.customFields?.[this.src.automatedField];
    const values = (Array.isArray(v) ? v : [v]).filter((x) => x !== undefined && x !== null).map((x) => String(x).toLowerCase());
    if (values.some((x) => this.src.automatedValues.includes(x))) return true;
    return (Array.isArray(c?.labels) ? c.labels : []).some((l: unknown) => this.src.automatedLabels.includes(String(l).toLowerCase()));
  }

  async *collect(since: Date, until: Date): AsyncIterable<CiPage> {
    for (const [key, team] of Object.entries(this.src.teams)) {
      const page: CiPage = { records: [], skipped: [], changedAt: null };
      try {
        for (const c of await this.list('/testcases', { projectKey: key })) {
          if (!c?.key) continue;
          page.records.push(testCase(team, 'zephyr', { key: String(c.key), automated: this.isAutomated(c), manualEstimateSeconds: typeof c.estimatedTime === 'number' ? c.estimatedTime / 1000 : null }));
        }
        const statuses = new Map<number, string>(((await this.client.getOptional<any>('/statuses', { projectKey: key, statusType: 'TEST_EXECUTION', maxResults: PAGE }))?.values ?? []).map((s: any) => [Number(s.id), String(s.name)]));
        for (const e of await this.list('/testexecutions', { projectKey: key, actualEndDateAfter: since.toISOString().replace(/\.\d{3}Z$/, 'Z') }, 20_000)) {
          const at = Date.parse(String(e.actualEndDate ?? ''));
          // The case is given as a link: …/testcases/<KEY>/versions/<n>.
          const caseKey = /\/testcases\/([^/]+)/.exec(String(e.testCase?.self ?? ''))?.[1] ?? '';
          if (Number.isNaN(at) || at < since.getTime() || at >= until.getTime() || !caseKey) continue;
          page.records.push(testExecution(team, 'zephyr', {
            key: String(e.key ?? e.id), caseKey, automated: e.automated === true, status: statuses.get(Number(e.testExecutionStatus?.id)) ?? null, executedAt: at,
            durationSeconds: typeof e.executionTime === 'number' ? e.executionTime / 1000 : null,
          }));
          const t = new Date(at).toISOString();
          if (!page.changedAt || t > page.changedAt) page.changedAt = t;
        }
      } catch (e) {
        if (e instanceof SourceError && e.auth) throw e;
        page.skipped.push({ id: `project ${key}`, reason: (e as Error).message });
      }
      yield page;
    }
  }
}
