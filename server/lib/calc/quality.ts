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
 * findings still are. The calculation is the shared engine's (packages/engine/src/calc/quality.ts);
 * loadQualityData reads what a range of days needs.
 */
import type pg from 'pg';
import type { ComputedMetric } from './engine';
import { phase3Tables } from './work';
import { computeQualityDay, REPORT_STALE_DAYS, type QualityData } from '../../../packages/engine/src/calc/quality';

export {
  REPORT_STALE_DAYS, SEVERITY_WEIGHTS, SCORE_SCALE, QUALITY_METRICS, weightedOf, qualityScore, latestReports, computeQualityDay, qualityAffectedDays,
  type ReportRow, type QualityData,
} from '../../../packages/engine/src/calc/quality';

const ms = (v: any): number | null => (v === null || v === undefined ? null : new Date(v).getTime());
const MAIN = (a: string) => `(${a}.branch IS NULL OR ${a}.branch = '' OR (t.main_branch IS NULL AND ${a}.branch IN ('main', 'master')) OR ${a}.branch = t.main_branch)`;

export async function loadQualityData(client: pg.PoolClient, teamId: string, from: string, to: string): Promise<QualityData> {
  const reports = (await client.query(
    `SELECT r.id, r.tool, r.repo, r.branch, r.commit_sha, r.analyzed_at, r.lines_of_code, r.findings, r.critical, r.high, r.medium, r.low, r.info, r.new_findings, r.fixed_findings, ${MAIN('r')} AS main
       FROM analysis_reports r JOIN teams t ON t.id = r.team_id
      WHERE r.team_id = $1 AND r.analyzed_at >= $2::date - ${REPORT_STALE_DAYS + 1} AND r.analyzed_at < $3::date + 1 ORDER BY r.analyzed_at`, [teamId, from, to])).rows;
  const coverage = (await client.query(
    `SELECT r.id, r.created_at, COALESCE(r.lines_of_code, r.lines_found) AS lines_found FROM coverage_reports r JOIN teams t ON t.id = r.team_id
      WHERE r.team_id = $1 AND r.created_at < $2::date + 1 AND COALESCE(r.lines_of_code, r.lines_found) > 0 AND ${MAIN('r')} ORDER BY r.created_at`, [teamId, to])).rows;
  return {
    reports: reports.map((r: any) => ({
      id: r.id, tool: r.tool, repo: r.repo, branch: r.branch, commit: r.commit_sha, analyzedAt: ms(r.analyzed_at)!, linesOfCode: r.lines_of_code, findings: r.findings,
      critical: r.critical, high: r.high, medium: r.medium, low: r.low, info: r.info, newFindings: r.new_findings, fixedFindings: r.fixed_findings, main: !!r.main,
    })),
    coverage: coverage.map((c: any) => ({ id: c.id, at: ms(c.created_at)!, linesFound: Number(c.lines_found) })),
  };
}

export async function computeQualityDays(client: pg.PoolClient, teamId: string, days: string[], now = Date.now()): Promise<Map<string, ComputedMetric[]>> {
  const out = new Map<string, ComputedMetric[]>();
  if (!days.length) return out;
  if (!(await phase3Tables(client))) return out;
  const sorted = [...days].sort();
  const data = await loadQualityData(client, teamId, sorted[0], sorted[sorted.length - 1]);
  if (!data.reports.length) return out;
  for (const d of sorted) out.set(d, computeQualityDay(d, data, now));
  return out;
}

