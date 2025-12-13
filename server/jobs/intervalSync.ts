import cron from 'node-cron';
import { query, queryOne } from '../../src/lib/db';
import { runPipelineSeederForAllCompanies } from '../seeders/pipelineSeeder';
import { emitJobNotification } from '../eventBus';

// Only log in non-serverless environments
if (!process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  console.log('📅 Metrics sync jobs initializing...');
}

// ============================================================================
// CALCULATE TEST FLAKINESS FROM PIPELINE DATA
// ============================================================================

// Calculate test flakiness rate from pipeline runs for a specific team
// Flakiness = percentage of test runs that failed intermittently
async function calculateTestFlakinessFromPipeline(teamId: string, companyId: string): Promise<number> {
  try {
    // Get test stage runs for this team from the last 7 days
    const testRuns = await query<any>(
      `SELECT 
        ps.name as stage_name,
        pr.status,
        pr.commit_sha,
        COUNT(*) as run_count
       FROM pipeline_runs pr
       JOIN pipeline_stages ps ON pr.stage_id = ps.id
       WHERE ps.company_id = ?
         AND (ps.team_id = ? OR ps.team_id IS NULL)
         AND ps.name IN ('Unit Tests', 'Integration Tests', 'E2E Tests')
         AND pr.started_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY ps.name, pr.status, pr.commit_sha
       ORDER BY ps.name, pr.commit_sha`,
      [companyId, teamId]
    );

    if (!testRuns || testRuns.length === 0) {
      // No pipeline data, return a realistic default
      return Number((1 + Math.random() * 3).toFixed(2)); // 1-4% default
    }

    // Calculate flakiness: tests that sometimes pass and sometimes fail for same commit
    let totalTestRuns = 0;
    let failedTestRuns = 0;

    // Group by commit to detect flaky behavior
    const commitStats: Record<string, { passed: number; failed: number }> = {};

    for (const run of testRuns) {
      const key = `${run.stage_name}-${run.commit_sha}`;
      if (!commitStats[key]) {
        commitStats[key] = { passed: 0, failed: 0 };
      }

      if (run.status === 'success') {
        commitStats[key].passed += run.run_count;
      } else {
        commitStats[key].failed += run.run_count;
      }
      totalTestRuns += run.run_count;
    }

    // Count flaky tests (commits with both passes and failures)
    for (const stats of Object.values(commitStats)) {
      if (stats.passed > 0 && stats.failed > 0) {
        // This is a flaky test - count the failures
        failedTestRuns += stats.failed;
      } else if (stats.failed > 0) {
        // Pure failures also contribute to flakiness score
        failedTestRuns += stats.failed * 0.5; // Weight lower since might be legit failure
      }
    }

    if (totalTestRuns === 0) {
      return Number((1 + Math.random() * 3).toFixed(2));
    }

    // Calculate flakiness percentage (capped at 15%)
    const flakinessRate = Math.min(15, (failedTestRuns / totalTestRuns) * 100);
    return Number(flakinessRate.toFixed(2));
  } catch (error) {
    console.error(`Error calculating flakiness for team ${teamId}:`, error);
    return Number((1 + Math.random() * 3).toFixed(2)); // Fallback
  }
}

// Get company ID for a team
async function getCompanyIdForTeam(teamId: string): Promise<string | null> {
  const team = await queryOne<any>('SELECT company_id FROM teams WHERE id = ?', [teamId]);
  return team?.company_id || null;
}

// ============================================================================
// METRICS GROUPED BY UPDATE FREQUENCY
// ============================================================================

const HOURLY_METRICS = [
  'avg_build_time_minutes',
  'test_execution_time_minutes',
];

const DAILY_METRICS = [
  'test_coverage',
  'test_flakiness_rate',
  'code_quality_score',
  'lead_time_days',
  'mttr_hours',
  'parallel_test_efficiency',
  'first_time_pass_rate',
  'blocked_time_hours',
  'system_availability',
];

const WEEKLY_METRICS = [
  'defect_density',
  'defect_escape_rate',
  'deployment_frequency_per_week',
  'automation_coverage',
  'change_failure_rate',
  'mtbf_hours',
  'infrastructure_failures',
  'sprint_velocity',
  'sprint_commitment_rate',
  'sprint_carryover',
  'sizing_accuracy',
];

const MONTHLY_METRICS = [
  'automation_roi',
];

// ============================================================================
// METRIC VALUE GENERATORS (Mock data - replace with real API calls)
// ============================================================================

const metricGenerators: Record<string, () => number> = {
  // Hourly - build/test times fluctuate frequently
  avg_build_time_minutes: () => Math.floor(5 + Math.random() * 15),
  test_execution_time_minutes: () => Math.floor(20 + Math.random() * 40),

  // Daily - code quality and test metrics
  test_coverage: () => Number((60 + Math.random() * 35).toFixed(2)),
  test_flakiness_rate: () => Number((Math.random() * 5).toFixed(2)),
  code_quality_score: () => Math.floor(70 + Math.random() * 25),
  lead_time_days: () => Number((1 + Math.random() * 4).toFixed(2)),
  mttr_hours: () => Number((2 + Math.random() * 8).toFixed(2)),
  parallel_test_efficiency: () => Number((70 + Math.random() * 25).toFixed(2)),
  first_time_pass_rate: () => Number((60 + Math.random() * 30).toFixed(2)),
  blocked_time_hours: () => Math.floor(10 + Math.random() * 20),
  system_availability: () => Number((99 + Math.random() * 0.9).toFixed(3)),

  // Weekly - defects, deployments, sprint metrics
  defect_density: () => Number((Math.random() * 1.5).toFixed(3)),
  defect_escape_rate: () => Number((Math.random() * 8).toFixed(2)),
  deployment_frequency_per_week: () => Math.floor(5 + Math.random() * 15),
  automation_coverage: () => Number((60 + Math.random() * 35).toFixed(2)),
  change_failure_rate: () => Number((Math.random() * 10).toFixed(2)),
  mtbf_hours: () => Math.floor(80 + Math.random() * 80),
  infrastructure_failures: () => Math.floor(Math.random() * 8),
  sprint_velocity: () => Math.floor(30 + Math.random() * 30),
  sprint_commitment_rate: () => Number((75 + Math.random() * 20).toFixed(2)),
  sprint_carryover: () => Number((5 + Math.random() * 20).toFixed(2)),
  sizing_accuracy: () => Number((0.7 + Math.random() * 0.6).toFixed(2)), // 0.7-1.3 ratio

  // Monthly - ROI calculations
  automation_roi: () => Number((200 + Math.random() * 200).toFixed(2)),
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

// Ensure today's snapshot exists for a team
async function ensureTodaySnapshot(teamId: string): Promise<string> {
  const existing = await queryOne<any>(
    'SELECT id FROM kpi_snapshots WHERE team_id = ? AND snapshot_date = CURDATE()',
    [teamId]
  );

  if (existing) {
    return existing.id;
  }

  // Create new snapshot for today
  const snapshotId = `kpi-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  await query(
    `INSERT INTO kpi_snapshots (id, team_id, snapshot_date, status, system_availability)
     VALUES (?, ?, CURDATE(), 'warning', 99.9)`,
    [snapshotId, teamId]
  );
  return snapshotId;
}

// Update specific metrics for a team
async function updateMetrics(teamId: string, metrics: string[]): Promise<number> {
  await ensureTodaySnapshot(teamId);

  let updated = 0;
  for (const metric of metrics) {
    let value: number;

    // Special handling for test_flakiness_rate - calculate from pipeline data
    if (metric === 'test_flakiness_rate') {
      const companyId = await getCompanyIdForTeam(teamId);
      if (companyId) {
        value = await calculateTestFlakinessFromPipeline(teamId, companyId);
      } else {
        value = metricGenerators[metric]();
      }
    } else {
      const generator = metricGenerators[metric];
      if (!generator) continue;
      value = generator();
    }

    await query(
      `UPDATE kpi_snapshots SET ${metric} = ? WHERE team_id = ? AND snapshot_date = CURDATE()`,
      [value, teamId]
    );
    updated++;
  }
  return updated;
}

// Recalculate QA score after updates
async function recalculateQAScore(teamId: string): Promise<void> {
  const snapshot = await queryOne<any>(
    `SELECT test_coverage, automation_coverage, defect_density, code_quality_score,
            first_time_pass_rate, test_flakiness_rate
     FROM kpi_snapshots WHERE team_id = ? AND snapshot_date = CURDATE()`,
    [teamId]
  );

  if (!snapshot) return;

  const qaScore = Math.round(
    (snapshot.test_coverage || 0) * 0.20 +
    (snapshot.automation_coverage || 0) * 0.15 +
    Math.max(0, 100 - (snapshot.defect_density || 0) * 50) * 0.20 +
    (snapshot.code_quality_score || 0) * 0.15 +
    (snapshot.first_time_pass_rate || 0) * 0.15 +
    Math.max(0, 100 - (snapshot.test_flakiness_rate || 0) * 10) * 0.15
  );

  const status = qaScore >= 85 ? 'good' : qaScore >= 70 ? 'warning' : 'critical';

  await query(
    'UPDATE kpi_snapshots SET qa_score = ?, status = ? WHERE team_id = ? AND snapshot_date = CURDATE()',
    [qaScore, status, teamId]
  );
}

// Get all active teams that are NOT excluded from auto-sync (manually edited data)
async function getActiveTeams(): Promise<{ id: string; name: string }[]> {
  // Get teams not excluded from auto-sync
  const teams = await query<any>(
    `SELECT id, name FROM teams 
     WHERE is_active = true 
     AND (exclude_from_auto_sync = 0 OR exclude_from_auto_sync IS NULL)`
  );

  // Also check for teams with manually edited snapshots
  const manualTeams = await query<any>(
    `SELECT DISTINCT team_id FROM kpi_snapshots WHERE manually_edited = 1`
  );
  const manualTeamIds = new Set(manualTeams.map((t: any) => t.team_id));

  // Filter out teams with manually edited data
  const teamsToSync = teams.filter((t: any) => !manualTeamIds.has(t.id));

  if (teams.length !== teamsToSync.length) {
    console.log(`  ℹ️  Skipping ${teams.length - teamsToSync.length} teams with manually edited data`);
  }

  return teamsToSync;
}

// ============================================================================
// SYNC JOBS BY FREQUENCY
// ============================================================================

// HOURLY JOB - Build times, test execution times
async function runHourlySync(): Promise<void> {
  const timestamp = new Date().toISOString();
  console.log(`⏰ [HOURLY] Starting metrics sync... ${timestamp}`);

  try {
    const teams = await getActiveTeams();
    let totalUpdates = 0;

    for (const team of teams) {
      const count = await updateMetrics(team.id, HOURLY_METRICS);
      if (count > 0) {
        await recalculateQAScore(team.id);
        totalUpdates += count;
      }
    }

    console.log(`⏰ [HOURLY] ✅ Updated ${totalUpdates} metrics (${HOURLY_METRICS.join(', ')}) for ${teams.length} teams`);
    emitJobNotification({
      source: 'metrics',
      frequency: 'hourly',
      message: 'Hourly metrics updated',
      updatedMetrics: HOURLY_METRICS,
      timestamp,
    });
  } catch (error) {
    console.error('⏰ [HOURLY] ❌ Sync failed:', error);
  }
}

// DAILY JOB - Coverage, quality scores, pass rates
async function runDailySync(): Promise<void> {
  const timestamp = new Date().toISOString();
  console.log(`📅 [DAILY] Starting metrics sync... ${timestamp}`);

  try {
    const teams = await getActiveTeams();
    let totalUpdates = 0;

    for (const team of teams) {
      const count = await updateMetrics(team.id, DAILY_METRICS);
      if (count > 0) {
        await recalculateQAScore(team.id);
        totalUpdates += count;
      }
    }

    console.log(`📅 [DAILY] ✅ Updated ${totalUpdates} metrics for ${teams.length} teams`);
    emitJobNotification({
      source: 'metrics',
      frequency: 'daily',
      message: 'Daily metrics updated',
      updatedMetrics: DAILY_METRICS,
      timestamp,
    });
  } catch (error) {
    console.error('📅 [DAILY] ❌ Sync failed:', error);
  }
}

// WEEKLY JOB - Defects, deployments, sprint metrics
async function runWeeklySync(): Promise<void> {
  const timestamp = new Date().toISOString();
  console.log(`📆 [WEEKLY] Starting metrics sync... ${timestamp}`);

  try {
    const teams = await getActiveTeams();
    let totalUpdates = 0;

    for (const team of teams) {
      const count = await updateMetrics(team.id, WEEKLY_METRICS);
      if (count > 0) {
        await recalculateQAScore(team.id);
        totalUpdates += count;
      }
    }

    console.log(`📆 [WEEKLY] ✅ Updated ${totalUpdates} metrics for ${teams.length} teams`);
    emitJobNotification({
      source: 'metrics',
      frequency: 'weekly',
      message: 'Weekly metrics updated',
      updatedMetrics: WEEKLY_METRICS,
      timestamp,
    });
  } catch (error) {
    console.error('📆 [WEEKLY] ❌ Sync failed:', error);
  }
}

// MONTHLY JOB - ROI calculations
async function runMonthlySync(): Promise<void> {
  const timestamp = new Date().toISOString();
  console.log(`🗓️ [MONTHLY] Starting metrics sync... ${timestamp}`);

  try {
    const teams = await getActiveTeams();
    let totalUpdates = 0;

    for (const team of teams) {
      const count = await updateMetrics(team.id, MONTHLY_METRICS);
      if (count > 0) {
        await recalculateQAScore(team.id);
        totalUpdates += count;
      }
    }

    console.log(`🗓️ [MONTHLY] ✅ Updated ${totalUpdates} metrics for ${teams.length} teams`);
    emitJobNotification({
      source: 'metrics',
      frequency: 'monthly',
      message: 'Monthly metrics updated',
      updatedMetrics: MONTHLY_METRICS,
      timestamp,
    });
  } catch (error) {
    console.error('🗓️ [MONTHLY] ❌ Sync failed:', error);
  }
}

// Full sync - all metrics at once (for manual trigger or hourly combined sync)
async function runIntervalSync(): Promise<void> {
  const timestamp = new Date().toISOString();
  const allMetrics = [...HOURLY_METRICS, ...DAILY_METRICS, ...WEEKLY_METRICS, ...MONTHLY_METRICS];

  console.log('🔄 [FULL] Running full metrics sync...');
  console.log(`🔄 [FULL] Syncing ${allMetrics.length} metrics: ${allMetrics.join(', ')}`);

  await runHourlySync();
  await runDailySync();
  await runWeeklySync();
  await runMonthlySync();

  console.log(`🔄 [FULL] ✅ Complete! All ${allMetrics.length} metrics synced at ${timestamp}`);
  emitJobNotification({
    source: 'metrics',
    frequency: 'hourly',
    message: `Full metrics sync complete: ${allMetrics.length} metrics updated`,
    updatedMetrics: allMetrics,
    timestamp,
  });
}

// ============================================================================
// CRON SCHEDULES (only in non-serverless environments)
// ============================================================================

// Only initialize cron jobs when not running in serverless (Netlify Functions)
if (!process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  // Every 5 minutes: Pipeline stages seeder
  cron.schedule('*/5 * * * *', async () => {
    console.log('🔄 [PIPELINE] Running pipeline seeder...');
    try {
      await runPipelineSeederForAllCompanies();
      emitJobNotification({
        source: 'pipeline',
        frequency: '5-min',
        message: 'Pipeline data updated',
        timestamp: new Date().toISOString(),
        updatedMetrics: [],
      });
    } catch (error) {
      console.error('🔄 [PIPELINE] Seeder failed:', error);
    }
  });
  console.log('  🔄 Pipeline job scheduled: */5 * * * * (every 5 minutes)');

  // HOURLY: Run ALL metrics sync (hourly + daily + weekly + monthly combined)
  cron.schedule('0 * * * *', async () => {
    console.log('⏰ [HOURLY-FULL] Running complete metrics sync...');
    await runIntervalSync();
  });
  console.log('  ⏰ Full sync scheduled: 0 * * * * (every hour at :00)');

  console.log('✅ All metrics sync jobs scheduled!');

  // RUN FULL SYNC AT STARTUP (after a short delay to ensure DB connection)
  setTimeout(async () => {
    console.log('🚀 [STARTUP] Running initial full metrics sync...');
    try {
      await runPipelineSeederForAllCompanies();
      await runIntervalSync();
      console.log('🚀 [STARTUP] Initial sync complete!');
      emitJobNotification({
        source: 'metrics',
        frequency: 'startup',
        message: 'Initial metrics sync complete',
        updatedMetrics: [...HOURLY_METRICS, ...DAILY_METRICS, ...WEEKLY_METRICS, ...MONTHLY_METRICS],
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('🚀 [STARTUP] Initial sync failed:', error);
    }
  }, 5000); // Wait 5 seconds for DB connection
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  runIntervalSync,
  runHourlySync,
  runDailySync,
  runWeeklySync,
  runMonthlySync,
  runPipelineSeederForAllCompanies,
  HOURLY_METRICS,
  DAILY_METRICS,
  WEEKLY_METRICS,
  MONTHLY_METRICS,
};
