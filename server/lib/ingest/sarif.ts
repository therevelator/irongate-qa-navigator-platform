/**
 * Static-analysis reports (v2 phase 3): SARIF 2.1.0, as exported by SonarQube / SonarCloud, GitHub
 * CodeQL, ESLint (@microsoft/eslint-formatter-sarif), Semgrep, Checkmarx, Snyk Code and others.
 * POST /api/ingest/static-analysis reads one file; each tool in it (runs[].tool.driver.name) becomes
 * one report. Results that are suppressed (accepted in the tool), absent in a baseline run, or of a
 * kind other than "fail" are not findings (suppressed ones are counted separately).
 *
 * Severity of a finding (first that applies):
 *   1. SonarQube severity (result or rule properties "severity", or the highest "impacts" severity):
 *      BLOCKER → critical, CRITICAL / HIGH → high, MAJOR / MEDIUM → medium, MINOR / LOW → low, INFO → info
 *   2. "security-severity" (CodeQL, 0–10, result or rule properties): ≥ 9 critical, ≥ 7 high, ≥ 4 medium, > 0 low
 *   3. SARIF level (result, else the rule's default configuration, else warning): error → high,
 *      warning → medium, note → low, none → info
 * Fingerprint (new vs fixed between reports): the result's partialFingerprints / fingerprints when
 * given, else rule + file + message.
 */
import { createHash } from 'crypto';
import { ReportError } from './testReports';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export const SEVERITIES: FindingSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
export const STATIC_ANALYSIS_FORMATS = ['sarif'] as const;

export interface Finding {
  fingerprint: string;
  ruleId: string;
  ruleName: string | null;
  severity: FindingSeverity;
  level: string | null;
  category: string | null;
  message: string | null;
  path: string | null;
  line: number | null;
}

export interface ParsedAnalysis {
  tool: string;
  toolVersion: string | null;
  repo: string | null;
  branch: string | null;
  commit: string | null;
  analyzedAt: Date | null;
  linesOfCode: number | null;
  findings: Finding[];
  suppressed: number;
  rules: number;
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function looksLikeSarif(body: any): boolean {
  return !!body && typeof body === 'object' && !Array.isArray(body) && Array.isArray(body.runs) && (typeof body.version === 'string' || typeof body.$schema === 'string');
}

const SONAR: Record<string, FindingSeverity> = { blocker: 'critical', critical: 'high', high: 'high', major: 'medium', medium: 'medium', minor: 'low', low: 'low', info: 'info', informational: 'info' };
const LEVEL: Record<string, FindingSeverity> = { error: 'high', warning: 'medium', note: 'low', none: 'info' };
const RANK: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function severityOf(result: any, rule: any): { severity: FindingSeverity; level: string } {
  const props = { ...(rule?.properties ?? {}), ...(result?.properties ?? {}) };
  const level = String(result?.level ?? rule?.defaultConfiguration?.level ?? 'warning').toLowerCase();
  const sonar = typeof props.severity === 'string' ? SONAR[props.severity.toLowerCase()] : undefined;
  const impacts: FindingSeverity[] = (Array.isArray(props.impacts) ? props.impacts : [])
    .map((i: any) => (typeof i?.severity === 'string' ? SONAR[i.severity.toLowerCase()] : undefined)).filter(Boolean);
  if (impacts.length) return { severity: impacts.sort((a, b) => RANK[a] - RANK[b])[0], level };
  if (sonar) return { severity: sonar, level };
  const ss = Number(props['security-severity'] ?? props.securitySeverity);
  if (Number.isFinite(ss) && ss > 0) return { severity: ss >= 9 ? 'critical' : ss >= 7 ? 'high' : ss >= 4 ? 'medium' : 'low', level };
  return { severity: LEVEL[level] ?? 'medium', level };
}

function categoryOf(result: any, rule: any): string | null {
  const props = { ...(rule?.properties ?? {}), ...(result?.properties ?? {}) };
  const type = String(props.type ?? props.issueType ?? '').toLowerCase();
  if (type === 'vulnerability' || type === 'security_hotspot') return 'security';
  if (type === 'bug') return 'reliability';
  if (type === 'code_smell') return 'maintainability';
  const tags: string[] = (Array.isArray(props.tags) ? props.tags : []).map((t: unknown) => String(t).toLowerCase());
  if (tags.some((t) => t === 'security' || t.startsWith('external/cwe') || t.startsWith('cwe'))) return 'security';
  if (tags.some((t) => ['correctness', 'reliability', 'bug', 'error-prone', 'problem'].includes(t))) return 'reliability';
  if (tags.some((t) => ['maintainability', 'code-smell', 'style', 'readability', 'suggestion', 'layout', 'convention'].includes(t))) return 'maintainability';
  return null;
}

/** owner/name from a repository URI (https://github.com/acme/app.git → acme/app); other strings as given. */
export function repoName(uri: string | null): string | null {
  if (!uri) return null;
  const m = /^(?:https?:\/\/|git@|ssh:\/\/git@)[^/:]+[/:](.+?)(?:\.git)?\/?$/.exec(uri.trim());
  return (m ? m[1] : uri.trim()).slice(0, 255);
}

/** Parse a SARIF document: one ParsedAnalysis per tool. */
export function parseSarif(text: string): ParsedAnalysis[] {
  let doc: any;
  try { doc = JSON.parse(text); } catch { throw new ReportError('The report must be SARIF 2.1.0 JSON'); }
  if (!looksLikeSarif(doc)) throw new ReportError('Not a SARIF document: expected {"version": "2.1.0", "runs": [...]}');
  const version = String(doc.version ?? '2.1.0');
  if (!/^2\.1\.0/.test(version)) throw new ReportError(`SARIF version ${version} is not supported: send SARIF 2.1.0`);
  const byTool = new Map<string, ParsedAnalysis>();
  doc.runs.forEach((run: any, ri: number) => {
    if (!run || typeof run !== 'object') throw new ReportError(`runs[${ri}] must be an object`);
    const driver = run.tool?.driver;
    const tool = str(driver?.name, 100);
    if (!tool) throw new ReportError(`runs[${ri}].tool.driver.name is required`);
    const rulesList: any[] = [...(Array.isArray(driver.rules) ? driver.rules : []), ...((Array.isArray(run.tool?.extensions) ? run.tool.extensions : []).flatMap((x: any) => (Array.isArray(x?.rules) ? x.rules : [])))];
    const ruleById = new Map<string, any>();
    for (const r of rulesList) if (r && typeof r.id === 'string') ruleById.set(r.id, r);
    const vcp = Array.isArray(run.versionControlProvenance) ? run.versionControlProvenance[0] : null;
    const inv = Array.isArray(run.invocations) ? run.invocations[0] : null;
    const at = str(inv?.endTimeUtc, 40) ?? str(inv?.startTimeUtc, 40);
    const analyzedAt = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : null;
    const locRaw = run.properties?.linesOfCode ?? run.properties?.ncloc ?? run.properties?.metrics?.linesOfCode;
    const loc = Number.isFinite(Number(locRaw)) && Number(locRaw) > 0 ? Math.round(Number(locRaw)) : null;
    const entry = byTool.get(tool) ?? {
      tool, toolVersion: str(driver.semanticVersion ?? driver.version, 100), repo: repoName(str(vcp?.repositoryUri, 1000)), branch: str(vcp?.branch, 255)?.replace(/^refs\/heads\//, '') ?? null,
      commit: str(vcp?.revisionId, 80), analyzedAt, linesOfCode: loc, findings: [], suppressed: 0, rules: 0,
    };
    if (!entry.analyzedAt && analyzedAt) entry.analyzedAt = analyzedAt;
    if (!entry.linesOfCode && loc) entry.linesOfCode = loc;
    const seen = new Map<string, number>(entry.findings.map((f) => [f.fingerprint, 1]));
    const results: any[] = Array.isArray(run.results) ? run.results : [];
    results.forEach((res: any, i: number) => {
      if (!res || typeof res !== 'object') throw new ReportError(`runs[${ri}].results[${i}] must be an object`);
      if (res.kind && res.kind !== 'fail') return;
      if (res.baselineState === 'absent') return;
      if (Array.isArray(res.suppressions) && res.suppressions.some((s: any) => s?.status !== 'rejected')) { entry.suppressed++; return; }
      const ruleId = str(res.ruleId ?? res.rule?.id, 255) ?? (typeof res.ruleIndex === 'number' && rulesList[res.ruleIndex]?.id) ?? 'unknown-rule';
      const rule = ruleById.get(ruleId) ?? (typeof res.ruleIndex === 'number' ? rulesList[res.ruleIndex] : undefined);
      const loc0 = Array.isArray(res.locations) ? res.locations[0]?.physicalLocation : null;
      const uri = str(loc0?.artifactLocation?.uri, 1000)?.replace(/^file:\/\/\/?/, '') ?? null;
      const line = Number.isInteger(loc0?.region?.startLine) ? loc0.region.startLine : null;
      const message = str(res.message?.text ?? (res.message?.id && rule?.messageStrings?.[res.message.id]?.text), 1000);
      const { severity, level } = severityOf(res, rule);
      const fp = res.partialFingerprints && typeof res.partialFingerprints === 'object' && Object.keys(res.partialFingerprints).length
        ? Object.entries(res.partialFingerprints).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('|')
        : res.fingerprints && typeof res.fingerprints === 'object' && Object.keys(res.fingerprints).length
          ? Object.entries(res.fingerprints).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('|')
          : `${uri ?? ''}|${(message ?? '').replace(/\s+/g, ' ')}`;
      let fingerprint = sha(`${tool}|${ruleId}|${fp}`).slice(0, 60);
      const n = seen.get(fingerprint);
      if (n) { seen.set(fingerprint, n + 1); fingerprint = `${fingerprint.slice(0, 56)}#${n + 1}`; } else seen.set(fingerprint, 1);
      entry.findings.push({ fingerprint, ruleId, ruleName: str(rule?.name ?? rule?.shortDescription?.text, 255), severity, level, category: categoryOf(res, rule), message, path: uri, line });
    });
    entry.rules = new Set(entry.findings.map((f) => f.ruleId)).size;
    byTool.set(tool, entry);
  });
  if (!byTool.size) throw new ReportError('The SARIF document has no runs');
  return Array.from(byTool.values());
}

export const severityCounts = (findings: Array<{ severity: FindingSeverity }>) => {
  const c: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
};
