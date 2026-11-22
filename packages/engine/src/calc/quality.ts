/**
 * Calculation engine, phase 3: code quality from static analysis (docs/V2_PLAN.md, "Calculation rules
 * (phase 3)").
 *
 * Per team and UTC day D with at least one main-branch report: the latest main-branch report of each
 * repository and tool analysed on or before the end of D (at most REPORT_STALE_DAYS days old):
 *
 *   code_quality   → code_quality_score   round(100 × e^(−weighted findings per 1,000 lines ÷ 20))
 *                                          weights: critical 10, high 5, medium 2, low 0.5, info 0
 *                                          lines: the lines of code sent with each repository's report,
 *                                          else lines found of the latest main-branch coverage report
 *   findings                              open findings (sum over the reports), by severity and rule
 *   new_findings                          findings not in the previous report of the same repository,
 *                                          branch and tool (sum over the reports)
 *   fixed_findings                        findings of the previous report that are gone
 *
 * Without a code size (no lines of code sent and no coverage report) the score is not calculated; the
 * findings still are. Pure computeQualityDay (the server reads the reports in server/lib/calc/quality.ts,
 * loadQualityData; the QE Navigator Collector from its local copy).
 */
import type { ComputedMetric, MetricSpec } from './types';

export const REPORT_STALE_DAYS = 30;
export const SEVERITY_WEIGHTS = { critical: 10, high: 5, medium: 2, low: 0.5, info: 0 } as const;
export const SCORE_SCALE = 20;
const DAY = 86_400_000;

export const QUALITY_METRICS: Record<string, MetricSpec> = {
  code_quality: { key: 'code_quality', label: 'Code quality score', unit: '/100', kpi: 'code_quality_score', group: 'quality',
    formula: 'round(100 × e^(−weighted findings per 1,000 lines of code ÷ 20)); weights critical 10, high 5, medium 2, low 0.5, info 0; the latest main-branch report of each repository and tool; lines of code sent with the report, else lines found of the latest main-branch coverage report' },
  findings: { key: 'findings', label: 'Static-analysis findings', unit: 'findings', kpi: null, group: 'quality',
    formula: 'open findings in the latest main-branch report of each repository and tool (suppressed findings not counted)' },
  new_findings: { key: 'new_findings', label: 'New findings', unit: 'findings', kpi: null, group: 'quality',
    formula: 'findings not in the previous report of the same repository, branch and tool (sum over the latest reports)' },
  fixed_findings: { key: 'fixed_findings', label: 'Fixed findings', unit: 'findings', kpi: null, group: 'quality',
    formula: 'findings of the previous report of the same repository, branch and tool that are gone (sum over the latest reports)' },
};

export interface ReportRow {
  id: string; tool: string; repo: string; branch: string | null; commit: string; analyzedAt: number; linesOfCode: number | null;
  findings: number; critical: number; high: number; medium: number; low: number; info: number; newFindings: number | null; fixedFindings: number | null; main: boolean;
}
export interface QualityData { reports: ReportRow[]; coverage: Array<{ id: string; at: number; linesFound: number }> }

export const weightedOf = (r: Pick<ReportRow, 'critical' | 'high' | 'medium' | 'low' | 'info'>) =>
  r.critical * SEVERITY_WEIGHTS.critical + r.high * SEVERITY_WEIGHTS.high + r.medium * SEVERITY_WEIGHTS.medium + r.low * SEVERITY_WEIGHTS.low + r.info * SEVERITY_WEIGHTS.info;
export const qualityScore = (weighted: number, linesOfCode: number) => Math.round(100 * Math.exp(-(weighted / (linesOfCode / 1000)) / SCORE_SCALE));

/** The latest main-branch report of each repository and tool as of `asOf` (within REPORT_STALE_DAYS). */
export function latestReports(data: QualityData, asOf: number): ReportRow[] {
  const by = new Map<string, ReportRow>();
  for (const r of data.reports) {
    if (!r.main || r.analyzedAt > asOf || r.analyzedAt < asOf - REPORT_STALE_DAYS * DAY) continue;
    const k = `${r.repo}\u0000${r.tool}`;
    const p = by.get(k);
    if (!p || r.analyzedAt > p.analyzedAt) by.set(k, r);
  }
  return Array.from(by.values()).sort((a, b) => a.repo.localeCompare(b.repo) || a.tool.localeCompare(b.tool));
}

export function computeQualityDay(day: string, data: QualityData, now = Date.now()): ComputedMetric[] {
  const dayStart = Date.parse(`${day}T00:00:00Z`);
  const asOf = Math.min(dayStart + DAY - 1, now);
  if (asOf < dayStart) return [];
  if (!data.reports.some((r) => r.main && r.analyzedAt >= dayStart && r.analyzedAt <= asOf)) return [];
  const latest = latestReports(data, asOf);
  if (!latest.length) return [];
  const at = new Date(Math.max(...latest.map((r) => r.analyzedAt))).toISOString();
  const ids = latest.map((r) => r.id);
  const tot = (k: 'findings' | 'critical' | 'high' | 'medium' | 'low' | 'info') => latest.reduce((n, r) => n + r[k], 0);
  const bySeverity = { critical: tot('critical'), high: tot('high'), medium: tot('medium'), low: tot('low'), info: tot('info') };
  const out: ComputedMetric[] = [];
  const reportsList = latest.map((r) => ({ id: r.id, tool: r.tool, repo: r.repo }));
  out.push({ key: 'findings', value: tot('findings'), inputs: { ...bySeverity, reports: latest.length }, sources: { analysisReports: ids }, sampleSize: latest.length, recordedAt: at });
  // Code size per repository: its lines of code (largest of its tools), else the coverage report (once).
  const repos = new Map<string, number | null>();
  for (const r of latest) repos.set(r.repo, Math.max(repos.get(r.repo) ?? 0, r.linesOfCode ?? 0) || null);
  const sent = Array.from(repos.values()).filter((x): x is number => !!x).reduce((a, b) => a + b, 0);
  const missing = Array.from(repos.values()).some((x) => !x);
  const cov = missing ? [...data.coverage].filter((c) => c.at <= asOf && c.linesFound > 0).pop() : undefined;
  const lines = sent + (missing && cov ? cov.linesFound : 0);
  if (lines > 0 && (!missing || cov)) {
    const weighted = latest.reduce((n, r) => n + weightedOf(r), 0);
    out.push({
      key: 'code_quality', value: qualityScore(weighted, lines),
      inputs: { weightedFindings: Math.round(weighted * 10) / 10, linesOfCode: lines, linesOfCodeFrom: missing ? (sent ? 'reports and coverage' : 'coverage report') : 'reports', weightedPerKloc: Math.round((weighted / (lines / 1000)) * 100) / 100, ...bySeverity },
      sources: { analysisReports: ids, ...(cov ? { coverageReports: [cov.id] } : {}) }, sampleSize: latest.length, recordedAt: at,
    });
  }
  const linked = latest.filter((r) => r.newFindings !== null);
  if (linked.length) {
    out.push({ key: 'new_findings', value: linked.reduce((n, r) => n + (r.newFindings ?? 0), 0), inputs: { reports: linked.length }, sources: { analysisReports: linked.map((r) => r.id), reportsList }, sampleSize: linked.length, recordedAt: at });
    out.push({ key: 'fixed_findings', value: linked.reduce((n, r) => n + (r.fixedFindings ?? 0), 0), inputs: { reports: linked.length }, sources: { analysisReports: linked.map((r) => r.id), reportsList }, sampleSize: linked.length, recordedAt: at });
  }
  return out;
}

/** The days whose quality values depend on a report of `day`: that day and the REPORT_STALE_DAYS after it (up to today). */
export function qualityAffectedDays(eventDays: string[], today = new Date().toISOString().slice(0, 10)): string[] {
  const set = new Set<string>();
  for (const d of eventDays.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x <= today)) {
    const start = Date.parse(`${d}T00:00:00Z`);
    for (let i = 0; i <= REPORT_STALE_DAYS; i++) {
      const x = new Date(start + i * DAY).toISOString().slice(0, 10);
      if (x > today) break;
      set.add(x);
    }
  }
  return Array.from(set).sort();
}
