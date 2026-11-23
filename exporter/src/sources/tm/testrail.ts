/**
 * TestRail (cloud or server), read-only, API v2.
 *
 * Auth: a user's e-mail address and API key (Basic). The user needs read access to the projects; no write permission
 * is used (only GET requests).
 *
 * Read per project (projects: TestRail project id → team):
 *   GET index.php?/api/v2/get_case_types                       which case types are named "Automated"
 *   GET index.php?/api/v2/get_suites/<project>                 the suites (a single-suite project has one)
 *   GET index.php?/api/v2/get_cases/<project>&suite_id=<id>    cases: id, type, the automation field, estimate, updated_on
 *   GET index.php?/api/v2/get_runs/<project>&created_after=…   runs created in the window
 *   GET index.php?/api/v2/get_tests/<run>                      which case each test of the run is
 *   GET index.php?/api/v2/get_results_for_run/<run>            results: status, created_on, elapsed
 * A case is automated when its automation field (automatedField, default custom_automation_type) is set and not 0,
 * or its type is named "Automated". A result is an automated run when its case is automated.
 */
import type { HttpSettings, TestRailSource } from '../../config';
import { requireSecret, secret, ConfigError } from '../../config';
import { SourceClient, SourceError } from '../client';
import type { CiAdapter, CiPage } from '../ci/common';
import { spanSeconds, testCase, testExecution } from './common';

const STATUS: Record<number, string> = { 1: 'passed', 2: 'blocked', 3: 'untested', 4: 'retest', 5: 'failed' };

export class TestRailAdapter implements CiAdapter {
  kind = 'ci' as const;
  private client: SourceClient;

  constructor(private src: TestRailSource, http: HttpSettings, env: NodeJS.ProcessEnv = process.env) {
    const key = requireSecret(src.tokenEnv, `sources.${src.name} (a TestRail API key)`, env);
    const user = src.user ?? secret(src.userEnv, env);
    if (!user) throw new ConfigError(`sources.${src.name}: set user (or the environment variable ${src.userEnv}): the e-mail address of the API key's TestRail user`);
    this.client = new SourceClient({
      source: src.name, baseUrl: src.baseUrl, caFile: src.caFile, http, headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${key}`).toString('base64') },
      authHint: 'Use a dedicated TestRail user with read-only access to the projects, and an API key of that user (My Settings → API Keys). The API must be enabled (Administration → Site Settings → API).',
    });
  }

  requests(): number { return this.client.requests; }

  describe(): string[] {
    return [
      `${this.src.baseUrl} (user + API key), projects: ${Object.entries(this.src.teams).map(([p, t]) => `${p} → ${t}`).join(', ')}`,
      `test cases (id, automated: ${this.src.automatedField} or a type named "Automated", estimate) and test results (status, time, elapsed); no titles, steps or comments`,
    ];
  }

  /** TestRail's API path lives in the query string (index.php?/api/v2/…), so the parameters are joined with &. */
  private path(call: string, params: Record<string, string | number> = {}): string {
    return `/index.php?/api/v2/${call}${Object.entries(params).map(([k, v]) => `&${k}=${encodeURIComponent(String(v))}`).join('')}`;
  }

  /** Every item of a list call: the newer paged form ({ <key>: [...], _links.next }) or the older plain list. */
  private async list(call: string, key: string, params: Record<string, string | number> = {}, max = 100_000): Promise<any[]> {
    const out: any[] = [];
    for (let offset = 0; out.length < max; offset += 250) {
      const body: any = await this.client.get(this.path(call, { ...params, limit: 250, offset }));
      const items: any[] = Array.isArray(body) ? body : body?.[key] ?? [];
      out.push(...items);
      if (Array.isArray(body) || items.length < 250 || !body?._links?.next) break;
    }
    return out;
  }

  async check(): Promise<string[]> {
    const out: string[] = [];
    for (const project of Object.keys(this.src.teams)) {
      const p = await this.client.get(this.path(`get_project/${project}`));
      out.push(`project ${project}: ${p?.is_completed ? 'completed' : 'active'}, suite mode ${p?.suite_mode ?? '?'}`);
    }
    return out;
  }

  async *collect(since: Date, until: Date): AsyncIterable<CiPage> {
    const types: any[] = (await this.client.getOptional(this.path('get_case_types'))) ?? [];
    const automatedTypes = new Set(types.filter((t) => /automat/i.test(String(t?.name ?? ''))).map((t) => Number(t.id)));
    for (const [project, team] of Object.entries(this.src.teams)) {
      const page: CiPage = { records: [], skipped: [], changedAt: null };
      try {
        const suites: any[] = (await this.client.getOptional(this.path(`get_suites/${project}`))) ?? [];
        const automated = new Map<number, boolean>();
        for (const suite of suites.length ? suites : [{ id: null }]) {
          for (const c of await this.list(`get_cases/${project}`, 'cases', suite.id ? { suite_id: suite.id } : {})) {
            const field = c[this.src.automatedField];
            const isAutomated = (field !== undefined && field !== null && field !== '' && field !== 0 && field !== '0' && field !== false) || automatedTypes.has(Number(c.type_id));
            automated.set(Number(c.id), isAutomated);
            page.records.push(testCase(team, 'testrail', {
              key: `C${c.id}`, automated: isAutomated, manualEstimateSeconds: spanSeconds(c.estimate), archived: c.is_deleted === 1 || c.is_deleted === true,
              updatedAt: typeof c.updated_on === 'number' ? c.updated_on * 1000 : null,
            }));
          }
        }
        const runs = await this.list(`get_runs/${project}`, 'runs', { created_after: Math.floor(since.getTime() / 1000) - 30 * 86_400 }, 2000);
        for (const run of runs) {
          const tests = await this.list(`get_tests/${run.id}`, 'tests');
          const caseOf = new Map<number, number>(tests.map((t) => [Number(t.id), Number(t.case_id)]));
          for (const r of await this.list(`get_results_for_run/${run.id}`, 'results')) {
            const at = typeof r.created_on === 'number' ? r.created_on * 1000 : null;
            const caseId = caseOf.get(Number(r.test_id));
            // A result without a status is a comment or an assignment, not a run.
            if (at === null || at < since.getTime() || at >= until.getTime() || !caseId || !r.status_id) continue;
            page.records.push(testExecution(team, 'testrail', {
              key: `R${r.id}`, caseKey: `C${caseId}`, automated: automated.get(caseId) ?? false, status: STATUS[Number(r.status_id)] ?? 'other', executedAt: at, durationSeconds: spanSeconds(r.elapsed),
            }));
            const t = new Date(at).toISOString();
            if (!page.changedAt || t > page.changedAt) page.changedAt = t;
          }
        }
      } catch (e) {
        if (e instanceof SourceError && e.auth) throw e;
        page.skipped.push({ id: `project ${project}`, reason: (e as Error).message });
      }
      yield page;
    }
  }
}
