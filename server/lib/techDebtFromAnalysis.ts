/**
 * Technical debt from static analysis: the Tech debt health gauge, the debt list and the debt part of Business impact
 * fed by the SARIF / SonarQube reports a team sends (docs/DATA_FLOW.md, "Technical debt").
 *
 * For each repository and tool, the latest main-branch report (real data only, never sample reports) gives one debt
 * item per severity that has open findings (critical, high, medium, low; info is not debt):
 *
 *   title         "<tool>: <n> <severity> finding(s) in <repo>"
 *   severity      the findings' severity (the gauge weights it: technical_debt severity weights)
 *   effort_hours  the sum of the findings' remediation effort (SonarQube "effort", the minutes sqale_index adds up),
 *                 null when the tool gave none
 *   category      security when most of the findings are security findings, else code_quality
 *   impact_score  the number of findings
 *   source        'static-analysis'
 *
 * An item whose findings are gone in the latest report is resolved (status resolved, resolved_at now). A status a
 * person set on the Technical debt page (won't fix, in progress) is kept while the findings remain; the impact
 * figures a person entered (support tickets, downtime, …) are never touched. Items have a stable id per team,
 * repository, tool and severity, so a repeated report updates the same items.
 */
import type pg from 'pg';
import { createHash } from 'crypto';

export const DEBT_SOURCE = 'static-analysis';
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const MAIN = `(r.branch IS NULL OR r.branch = '' OR (t.main_branch IS NULL AND r.branch IN ('main', 'master')) OR r.branch = t.main_branch)`;

export const debtItemId = (teamId: string, repo: string, tool: string, severity: string) =>
  `sa-${createHash('sha256').update(`${teamId}\u0000${repo}\u0000${tool}\u0000${severity}`).digest('hex').slice(0, 32)}`;

/** Recompute the team's static-analysis debt items from its latest main-branch reports. Returns the open items. */
export async function refreshTechDebtFromAnalysis(client: pg.PoolClient, companyId: string, teamId: string): Promise<number> {
  const rows = (await client.query(
    `WITH latest AS (
       SELECT DISTINCT ON (r.repo, r.tool) r.id, r.repo, r.tool, r.analyzed_at
         FROM analysis_reports r JOIN teams t ON t.id = r.team_id
        WHERE r.team_id = $1 AND NOT r.is_sample AND ${MAIN}
        ORDER BY r.repo, r.tool, r.analyzed_at DESC)
     SELECT l.repo, l.tool, l.analyzed_at, f.severity, COUNT(*)::int AS n,
            SUM(f.effort_minutes)::bigint AS effort, COUNT(f.effort_minutes)::int AS with_effort,
            COUNT(*) FILTER (WHERE f.category = 'security')::int AS security
       FROM latest l JOIN analysis_findings f ON f.report_id = l.id
      WHERE f.severity <> 'info'
      GROUP BY l.repo, l.tool, l.analyzed_at, f.severity`, [teamId])).rows;
  const ids: string[] = [];
  for (const r of rows) {
    if (!(SEVERITIES as readonly string[]).includes(r.severity)) continue;
    const id = debtItemId(teamId, r.repo ?? '', r.tool, r.severity);
    ids.push(id);
    const where = r.repo ? ` in ${r.repo}` : '';
    const title = `${r.tool}: ${r.n} ${r.severity} finding${r.n === 1 ? '' : 's'}${where}`.slice(0, 500);
    const description = `Open ${r.severity} findings of the latest main-branch ${r.tool} analysis${where} (${new Date(r.analyzed_at).toISOString().slice(0, 10)}).`
      + (r.with_effort ? ` Remediation effort: ${Math.round(Number(r.effort))} minutes over ${r.with_effort} finding${r.with_effort === 1 ? '' : 's'}.` : ' The tool gave no remediation effort.');
    await client.query(
      `INSERT INTO technical_debt (id, team_id, company_id, title, description, severity, category, impact_score, effort_hours, status, source, resolved_at, manually_edited)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10, NULL, FALSE)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, severity = EXCLUDED.severity, category = EXCLUDED.category,
         impact_score = EXCLUDED.impact_score, effort_hours = EXCLUDED.effort_hours,
         status = CASE WHEN technical_debt.status IN ('wont_fix', 'in_progress') THEN technical_debt.status ELSE 'open' END,
         resolved_at = NULL, updated_at = now()`,
      [id, teamId, companyId, title, description, r.severity, r.security * 2 > r.n ? 'security' : 'code_quality', r.n,
        r.with_effort ? Math.min(99_999_999, Math.round((Number(r.effort) / 60) * 100) / 100) : null, DEBT_SOURCE]
    );
  }
  await client.query(
    `UPDATE technical_debt SET status = 'resolved', resolved_at = now(), updated_at = now()
      WHERE team_id = $1 AND source = $2 AND NOT (id = ANY($3::text[])) AND status NOT IN ('resolved', 'wont_fix')`,
    [teamId, DEBT_SOURCE, ids]);
  return ids.length;
}
