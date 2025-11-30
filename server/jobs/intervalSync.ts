import cron from 'node-cron';
import { query, queryOne } from '../../src/lib/db';
import { runPipelineSeederForAllCompanies } from '../seeders/pipelineSeeder';

// Only log in non-serverless environments
if (!process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  console.log('📅 Metrics sync jobs initializing...');
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
    const generator = metricGenerators[metric];
    if (!generator) continue;
    
    const value = generator();
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

// Get all active teams
async function getActiveTeams(): Promise<{ id: string; name: string }[]> {
  return await query<any>('SELECT id, name FROM teams WHERE is_active = true');
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
  } catch (error) {
    console.error('🗓️ [MONTHLY] ❌ Sync failed:', error);
  }
}

// Full sync - all metrics at once (for manual trigger)
async function runIntervalSync(): Promise<void> {
  console.log('🔄 [FULL] Running full metrics sync...');
  await runHourlySync();
  await runDailySync();
  await runWeeklySync();
  await runMonthlySync();
  console.log('🔄 [FULL] Complete!');
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
    } catch (error) {
      console.error('🔄 [PIPELINE] Seeder failed:', error);
    }
  });
  console.log('  🔄 Pipeline job scheduled: */5 * * * * (every 5 minutes)');

  // Hourly: At minute 0 of every hour
  cron.schedule('0 * * * *', runHourlySync);
  console.log('  ⏰ Hourly job scheduled: 0 * * * * (every hour at :00)');

  // Daily: At 00:05 every day
  cron.schedule('5 0 * * *', runDailySync);
  console.log('  📅 Daily job scheduled: 5 0 * * * (daily at 00:05)');

  // Weekly: At 00:10 every Monday
  cron.schedule('10 0 * * 1', runWeeklySync);
  console.log('  📆 Weekly job scheduled: 10 0 * * 1 (Mondays at 00:10)');

  // Monthly: At 00:15 on the 1st of every month
  cron.schedule('15 0 1 * *', runMonthlySync);
  console.log('  🗓️ Monthly job scheduled: 15 0 1 * * (1st of month at 00:15)');

  console.log('✅ All metrics sync jobs scheduled!');
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
