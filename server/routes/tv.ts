import express from 'express';
import { query, queryOne } from '../../src/lib/db';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { assertTeamAnalytics } from '../middleware/access';
import { TECH_DEBT_OPEN_WEIGHT_SQL, techDebtScoreFromWeight, toNum, qaStatusFromScore } from '../lib/metricFormulas';
import { teamMemberCountSql, teamLeadNameSql } from '../lib/teamMembership';

/**
 * Team TV / meeting mode (src/components/TeamTvView.tsx).
 *
 * GET /api/tv/teams/:id — everything the TV screen shows for ONE team, team aggregates only:
 * name, department, lead, member count, the latest KPI snapshot, 90 days of KPI history and
 * the technical debt score. No member list and no individual developer data.
 *
 * Scope: the shared analytics rule (assertTeamAnalytics → canViewTeamAnalytics in
 * server/lib/userPolicy.ts): super_admin any team of their company, qa_manager the teams of
 * their department, team_lead / qa_engineer / viewer their own team. Another company's team,
 * an unknown id and an out-of-scope team all get the same 403.
 */

const router = express.Router();

/** kpi_snapshots column → camelCase key used by the UI (same names as GET /api/teams kpiData). */
const KPI_COLUMNS: Record<string, string> = {
  test_coverage: 'testCoverage',
  test_flakiness_rate: 'testFlakinessRate',
  defect_density: 'defectDensity',
  defect_escape_rate: 'defectEscapeRate',
  code_quality_score: 'codeQualityScore',
  avg_build_time_minutes: 'avgBuildTimeMinutes',
  test_execution_time_minutes: 'testExecutionTimeMinutes',
  deployment_frequency_per_week: 'deploymentFrequencyPerWeek',
  lead_time_days: 'leadTimeDays',
  mttr_hours: 'mttrHours',
  parallel_test_efficiency: 'parallelTestEfficiency',
  sprint_velocity: 'sprintVelocity',
  sprint_commitment_rate: 'sprintCommitmentRate',
  sprint_carryover: 'sprintCarryover',
  first_time_pass_rate: 'firstTimePassRate',
  blocked_time_hours: 'blockedTimeHours',
  automation_coverage: 'automationCoverage',
  automation_roi: 'automationRoi',
  change_failure_rate: 'changeFailureRate',
  mtbf_hours: 'mtbfHours',
  system_availability: 'systemAvailability',
  infrastructure_failures: 'infrastructureFailures',
};
const HISTORY_COLUMNS = [...Object.keys(KPI_COLUMNS), 'qa_score'];
const HISTORY_DAYS = 90;

router.get('/teams/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const owned = await assertTeamAnalytics(req, res, req.params.id);
    if (!owned) return;

    const team = await queryOne<any>(
      `SELECT t.id, t.name, t.is_active, d.name AS department_name,
              ${teamLeadNameSql('t')} AS lead_name,
              ${teamMemberCountSql('t')} AS member_count
         FROM teams t
         LEFT JOIN departments d ON d.id = t.department_id
        WHERE t.id = ? AND t.company_id = ?`,
      [owned.id, req.companyId]
    );
    if (!team) return res.status(403).json({ error: 'Access denied. This team is outside your analytics scope.' });

    const snapshot = await queryOne<any>(
      `SELECT * FROM kpi_snapshots WHERE team_id = ? ORDER BY snapshot_date DESC LIMIT 1`,
      [owned.id]
    );
    const debt = await queryOne<any>(
      `SELECT ${TECH_DEBT_OPEN_WEIGHT_SQL} AS open_weight FROM technical_debt WHERE team_id = ?`,
      [owned.id]
    );
    const history = await query<any>(
      `SELECT snapshot_date, ${HISTORY_COLUMNS.join(', ')}
         FROM kpi_snapshots
        WHERE team_id = ? AND snapshot_date >= CURRENT_DATE - CAST(? AS INTEGER)
        ORDER BY snapshot_date ASC`,
      [owned.id, HISTORY_DAYS]
    );

    const metricHistory: Record<string, { date: string; value: number }[]> = {};
    for (const key of HISTORY_COLUMNS) metricHistory[key] = [];
    for (const row of history) {
      const date = String(row.snapshot_date);
      for (const key of HISTORY_COLUMNS) {
        const v = toNum(row[key]);
        if (v !== null) metricHistory[key].push({ date, value: v });
      }
    }

    let latest: any = null;
    if (snapshot) {
      const kpiData: Record<string, number | null> = {};
      for (const [col, key] of Object.entries(KPI_COLUMNS)) kpiData[key] = toNum(snapshot[col]);
      const sources: Record<string, any> = snapshot.field_sources && typeof snapshot.field_sources === 'object' ? snapshot.field_sources : {};
      const recorded = Object.values(sources)
        .map((s: any) => (s && typeof s.recorded_at === 'string' ? Date.parse(s.recorded_at) : NaN))
        .filter((t) => Number.isFinite(t));
      const qaScore = toNum(snapshot.qa_score);
      latest = {
        snapshotDate: String(snapshot.snapshot_date),
        qaScore,
        status: qaScore === null ? 'no-data' : qaStatusFromScore(qaScore),
        kpiData,
        // Newest per-field recorded_at of the snapshot (ingestion provenance), when known.
        lastRecordedAt: recorded.length ? new Date(Math.max(...recorded)).toISOString() : null,
        // Any value of the snapshot from generated demo data (field_sources source 'synthetic').
        sampleData: Object.values(sources).some((s: any) => s?.source === 'synthetic'),
      };
    }

    res.json({
      team: {
        id: team.id,
        name: team.name,
        isActive: !!team.is_active,
        departmentName: team.department_name ?? null,
        leadName: team.lead_name ?? null,
        memberCount: Number(team.member_count) || 0,
      },
      latest,
      // Same value as Team detail (metricFormulas.techDebtScoreFromWeight over open items).
      technicalDebtScore: techDebtScoreFromWeight(debt?.open_weight),
      history: metricHistory,
      historyDays: HISTORY_DAYS,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('TV summary error:', error);
    res.status(500).json({ error: 'Failed to load the team summary' });
  }
});

export default router;
