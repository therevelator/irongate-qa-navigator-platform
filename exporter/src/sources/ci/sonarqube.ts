/**
 * SonarQube (Server 9.9 LTS and later) and SonarCloud, read-only: open issues as static-analysis findings
 * (the same fields a SARIF report gives: rule, severity, file, a stable fingerprint) and the quality gate.
 *
 * Auth: a user token of a user with Browse on the projects (no Administer, no Execute Analysis), as a
 * Bearer token (SonarQube 10+, SonarCloud) or, for older servers, as the Basic user name (auth: basic).
 *
 * Each issue carries its remediation effort (SonarQube's "effort", the minutes its technical debt, sqale_index,
 * adds up): QE Navigator derives the team's technical debt items from it.
 *
 * Read per project (projects: project key → team):
 *   GET /api/project_analyses/search?project=<key>&ps=1        the latest analysis (date, revision): read again only when it changed
 *   GET /api/issues/search?componentKeys=<key>&resolved=false&ps=500&p=<n>   open issues (at most 10,000: SonarQube's limit)
 *   GET /api/measures/component?component=<key>&metricKeys=ncloc            lines of code (code quality score per KLOC);
 *                                                                           with coverage: true also lines_to_cover, uncovered_lines,
 *                                                                           conditions_to_cover, uncovered_conditions
 */
import { createHash } from 'node:crypto';
import type { HttpSettings, SonarQubeSource } from '../../config';
import { requireSecret } from '../../config';
import { SourceClient, SourceError } from '../client';
import { ms, reportItem, sarifOf, type CiAdapter, type CiPage, type Finding, lcovTotalsOf } from './common';

type FindingSeverity = Finding['severity'];

const SEVERITY: Record<string, FindingSeverity> = { BLOCKER: 'critical', CRITICAL: 'high', HIGH: 'high', MAJOR: 'medium', MEDIUM: 'medium', MINOR: 'low', LOW: 'low', INFO: 'info' };
const RANK: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const MAX_ISSUES = 10_000;

/** One SonarQube issue as a static-analysis finding (Clean Code impacts first, else the legacy severity). */
export function findingOf(i: any): Finding {
  const impacts: FindingSeverity[] = (Array.isArray(i.impacts) ? i.impacts : []).map((x: any) => SEVERITY[String(x?.severity ?? '').toUpperCase()]).filter(Boolean);
  const severity = impacts.length ? impacts.sort((a, b) => RANK[a] - RANK[b])[0] : SEVERITY[String(i.severity ?? '').toUpperCase()] ?? 'medium';
  const path = typeof i.component === 'string' && i.component.includes(':') ? i.component.slice(i.component.indexOf(':') + 1) : null;
  const type = String(i.type ?? '').toUpperCase();
  return {
    fingerprint: createHash('sha256').update(`sonarqube\u0000${i.key}`).digest('hex').slice(0, 40), ruleId: String(i.rule ?? 'unknown').slice(0, 255), severity,
    category: type === 'VULNERABILITY' || type === 'SECURITY_HOTSPOT' ? 'security' : type === 'BUG' ? 'reliability' : type === 'CODE_SMELL' ? 'maintainability' : null,
    path: path ? path.slice(0, 1000) : null, line: typeof i.line === 'number' ? i.line : null, effortMinutes: effortMinutes(i.effort ?? i.debt),
  };
}

/** SonarQube's effort ("2d 1h 30min", "45min"; a day is 8 hours) in minutes, or null. */
export function effortMinutes(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  const re = /(\d+(?:\.\d+)?)\s*(d|h|min)\b/g;
  let total = 0; let any = false; let m: RegExpExecArray | null;
  while ((m = re.exec(v.toLowerCase()))) { any = true; total += Number(m[1]) * (m[2] === 'd' ? 480 : m[2] === 'h' ? 60 : 1); }
  return any ? Math.round(total) : null;
}

/** The measures the coverage totals are read from. */
const COVERAGE_MEASURES = ['lines_to_cover', 'uncovered_lines', 'conditions_to_cover', 'uncovered_conditions'];

export class SonarQubeAdapter implements CiAdapter {
  kind = 'ci' as const;
  private client: SourceClient;

  constructor(private src: SonarQubeSource, http: HttpSettings, env: NodeJS.ProcessEnv = process.env) {
    const token = requireSecret(src.tokenEnv, `sources.${src.name} (a SonarQube user token)`, env);
    this.client = new SourceClient({
      source: src.name, baseUrl: src.baseUrl, caFile: src.caFile, http,
      headers: { Authorization: src.auth === 'basic' ? 'Basic ' + Buffer.from(`${token}:`).toString('base64') : `Bearer ${token}` },
      authHint: 'Use a user token of a user with the Browse permission on the projects (My Account → Security → Generate token, type User token).',
    });
  }

  requests(): number { return this.client.requests; }

  describe(): string[] {
    return [
      `${this.src.baseUrl} (${this.src.auth} token), projects: ${Object.entries(this.src.teams).map(([p, t]) => `${p} → ${t}`).join(', ')}${this.src.branch ? `, branch ${this.src.branch}` : ''}`,
      'the latest analysis, open issues (rule, severity, file, remediation effort; no messages), lines of code (ncloc), sent as one SARIF file',
      ...(this.src.coverage ? ['coverage totals of the latest analysis (lines and conditions to cover, uncovered), sent as a coverage report'] : []),
    ];
  }

  async check(): Promise<string[]> {
    const out: string[] = [];
    for (const key of Object.keys(this.src.teams)) {
      const a = await this.client.get('/api/project_analyses/search', { project: key, ps: 1, ...(this.src.branch ? { branch: this.src.branch } : {}) });
      const gate = await this.client.getOptional('/api/qualitygates/project_status', { projectKey: key, ...(this.src.branch ? { branch: this.src.branch } : {}) });
      out.push(`${key}: latest analysis ${a.analyses?.[0]?.date ?? 'none'}, quality gate ${gate?.projectStatus?.status ?? 'unknown'}`);
    }
    return out;
  }

  async *collect(since: Date, until: Date): AsyncIterable<CiPage> {
    for (const [key, team] of Object.entries(this.src.teams)) {
      const page: CiPage = { records: [], skipped: [], changedAt: null };
      const branch = this.src.branch ? { branch: this.src.branch } : {};
      const latest = (await this.client.get('/api/project_analyses/search', { project: key, ps: 1, ...branch })).analyses?.[0];
      const at = ms(latest?.date);
      if (!at || at < since.getTime() || at >= until.getTime()) { yield page; continue; }
      try {
        const findings: Finding[] = [];
        let total = 0;
        for (let p = 1; p * 500 <= MAX_ISSUES + 500; p++) {
          const r = await this.client.get('/api/issues/search', { componentKeys: key, resolved: 'false', ps: 500, p, ...branch });
          total = Number(r.paging?.total ?? r.total ?? 0);
          for (const i of r.issues ?? []) findings.push(findingOf(i));
          if ((r.issues ?? []).length < 500 || findings.length >= MAX_ISSUES) break;
        }
        if (total > findings.length) page.skipped.push({ id: key, reason: `${total} open issues: SonarQube returns at most ${MAX_ISSUES}; the score uses the first ${findings.length}` });
        const ncloc = await this.client.getOptional('/api/measures/component', { component: key, metricKeys: this.src.coverage ? `ncloc,${COVERAGE_MEASURES.join(',')}` : 'ncloc', ...branch });
        const measure = (name: string) => Number((ncloc?.component?.measures ?? []).find((m: any) => m.metric === name)?.value);
        const loc = measure('ncloc');
        // SonarQube gives its findings through its API only: written out as a SARIF file (rule, severity, file, fingerprint; no messages).
        page.records.push(reportItem('sarif', team, [sarifOf('SonarQube', findings)], {
          commit: String(latest.revision ?? latest.key ?? '').slice(0, 80), branch: this.src.branch, run: String(latest.key ?? at), attempt: 1, startedAt: at,
        }, { repo: key, loc: Number.isFinite(loc) && loc > 0 ? loc : null }));
        // Coverage (optional): SonarQube's totals of the latest analysis, written out as an lcov file of totals. QE Navigator
        // calculates the percentage; no per-file coverage comes this way.
        if (this.src.coverage) {
          const [toCover, uncovered, conditions, uncoveredConditions] = COVERAGE_MEASURES.map(measure);
          if (Number.isFinite(toCover) && toCover > 0 && Number.isFinite(uncovered)) {
            const branches = Number.isFinite(conditions) && conditions > 0 && Number.isFinite(uncoveredConditions);
            page.records.push(reportItem('coverage', team, [lcovTotalsOf({
              linesFound: toCover, linesHit: Math.max(0, toCover - uncovered),
              branchesFound: branches ? conditions : 0, branchesHit: branches ? Math.max(0, conditions - uncoveredConditions) : 0,
            })], { commit: String(latest.revision ?? latest.key ?? '').slice(0, 80), branch: this.src.branch, run: String(latest.key ?? at), attempt: 1, startedAt: at },
            { repo: key, loc: Number.isFinite(loc) && loc > 0 ? loc : null, format: 'lcov' }));
          } else {
            page.skipped.push({ id: `${key} coverage`, reason: 'the latest analysis has no coverage measures (lines_to_cover)' });
          }
        }
        page.changedAt = new Date(at).toISOString();
      } catch (e) {
        if (e instanceof SourceError && e.auth) throw e;
        page.skipped.push({ id: key, reason: (e as Error).message });
      }
      yield page;
    }
  }
}
