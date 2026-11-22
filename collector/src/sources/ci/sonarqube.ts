/**
 * SonarQube (Server 9.9 LTS and later) and SonarCloud, read-only: open issues as static-analysis findings
 * (the same fields a SARIF report gives: rule, severity, file, a stable fingerprint) and the quality gate.
 *
 * Auth: a user token of a user with Browse on the projects (no Administer, no Execute Analysis), as a
 * Bearer token (SonarQube 10+, SonarCloud) or, for older servers, as the Basic user name (auth: basic).
 *
 * Read per project (projects: project key → team):
 *   GET /api/project_analyses/search?project=<key>&ps=1        the latest analysis (date, revision): read again only when it changed
 *   GET /api/issues/search?componentKeys=<key>&resolved=false&ps=500&p=<n>   open issues (at most 10,000: SonarQube's limit)
 *   GET /api/measures/component?component=<key>&metricKeys=ncloc            lines of code (code quality score per KLOC)
 *   GET /api/qualitygates/project_status?projectKey=<key>                     quality gate status (evidence)
 */
import { createHash } from 'node:crypto';
import type { HttpSettings, SonarQubeSource } from '../../config';
import { requireSecret } from '../../config';
import { SourceClient, SourceError } from '../client';
import { ms, type CiAdapter, type CiPage } from './common';
import { analysisRecord } from '../../../../packages/engine/src/store/records';
import type { Finding, FindingSeverity, ParsedAnalysis } from '../../../../packages/engine/src/parsers/sarif';

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
    fingerprint: createHash('sha256').update(`sonarqube\u0000${i.key}`).digest('hex').slice(0, 40), ruleId: String(i.rule ?? 'unknown').slice(0, 255), ruleName: null, severity,
    level: null, category: type === 'VULNERABILITY' || type === 'SECURITY_HOTSPOT' ? 'security' : type === 'BUG' ? 'reliability' : type === 'CODE_SMELL' ? 'maintainability' : null,
    message: null, path: path ? path.slice(0, 1000) : null, line: typeof i.line === 'number' ? i.line : null,
  };
}

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
      'the latest analysis, open issues (rule, severity, file; no messages), lines of code (ncloc), quality gate status',
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
        const ncloc = await this.client.getOptional('/api/measures/component', { component: key, metricKeys: 'ncloc', ...branch });
        const loc = Number((ncloc?.component?.measures ?? []).find((m: any) => m.metric === 'ncloc')?.value);
        const gate = await this.client.getOptional('/api/qualitygates/project_status', { projectKey: key, ...branch });
        const a: ParsedAnalysis = { tool: 'SonarQube', toolVersion: null, repo: key, branch: this.src.branch, commit: latest.revision ?? null, analyzedAt: new Date(at), linesOfCode: Number.isFinite(loc) && loc > 0 ? loc : null, findings, suppressed: 0, rules: new Set(findings.map((f) => f.ruleId)).size };
        const rec = analysisRecord(team, a, { repo: key, branch: this.src.branch, commit: String(latest.revision ?? latest.key ?? '').slice(0, 80), runId: String(latest.key ?? at), attempt: 1, analyzedAt: at, linesOfCode: a.linesOfCode });
        page.records.push({ kind: 'analysis', team, rec: { ...rec, qualityGate: gate?.projectStatus?.status ?? null } });
        page.changedAt = new Date(at).toISOString();
      } catch (e) {
        if (e instanceof SourceError && e.auth) throw e;
        page.skipped.push({ id: key, reason: (e as Error).message });
      }
      yield page;
    }
  }
}
