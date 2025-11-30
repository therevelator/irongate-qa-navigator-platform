import { query } from '../../src/lib/db';

// Pipeline stage definitions with realistic base values
const PIPELINE_STAGES = [
  { name: 'Build', order: 1, baseDuration: 120, baseSuccess: 98, baseCpu: 75, baseMem: 60, baseCost: 0.15 },
  { name: 'Unit Tests', order: 2, baseDuration: 180, baseSuccess: 96, baseCpu: 50, baseMem: 40, baseCost: 0.10 },
  { name: 'Integration Tests', order: 3, baseDuration: 300, baseSuccess: 92, baseCpu: 65, baseMem: 55, baseCost: 0.25 },
  { name: 'Security Scan', order: 4, baseDuration: 90, baseSuccess: 99, baseCpu: 30, baseMem: 25, baseCost: 0.08 },
  { name: 'Deploy to Staging', order: 5, baseDuration: 60, baseSuccess: 97, baseCpu: 40, baseMem: 35, baseCost: 0.12 },
  { name: 'E2E Tests', order: 6, baseDuration: 420, baseSuccess: 88, baseCpu: 80, baseMem: 70, baseCost: 0.35 },
  { name: 'Deploy to Prod', order: 7, baseDuration: 45, baseSuccess: 99.5, baseCpu: 35, baseMem: 30, baseCost: 0.10 }
];

// Add realistic variance to values
function addVariance(base: number, variancePercent: number = 10): number {
  const variance = base * (variancePercent / 100);
  return base + (Math.random() * variance * 2 - variance);
}

function computeDurationStats(values: number[]) {
  if (!values.length) {
    return { mean: 0, stdDev: 1 };
  }
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(Math.max(variance, 1e-6));
  return { mean, stdDev };
}

// Calculate bottleneck score using z-score and failure weighting
function calculateBottleneck(duration: number, successRate: number, mean: number, stdDev: number): number {
  const durationZ = stdDev > 0 ? (duration - mean) / stdDev : 0;
  const durationFactor = Math.min(60, Math.max(0, ((durationZ + 2) / 4) * 60));
  const successDecimal = Math.max(0, Math.min(1, successRate / 100));
  const failureFactor = (1 - successDecimal) * 40;
  return Math.round((durationFactor + failureFactor) * 10) / 10;
}

// Seed or update pipeline stages for a company (and optionally per team)
export async function seedPipelineStages(companyId: string, teamId?: string): Promise<number> {
  let recordsAffected = 0;
  
  try {
    // Check if company default stages exist (team_id IS NULL)
    const companyDefaults = await query<any>(
      'SELECT COUNT(*) as count FROM pipeline_stages WHERE company_id = ? AND team_id IS NULL',
      [companyId]
    );

    // First, ensure company defaults exist
    if (companyDefaults[0].count === 0) {
      const stagePayloads = PIPELINE_STAGES.map(stage => {
        const duration = Math.round(addVariance(stage.baseDuration, 15));
        const successRate = Math.min(100, addVariance(stage.baseSuccess, 3));
        const cpuUsage = Math.min(100, addVariance(stage.baseCpu, 20));
        const memUsage = Math.min(100, addVariance(stage.baseMem, 20));
        const cost = Math.max(0.01, addVariance(stage.baseCost, 25));
        return { name: stage.name, order: stage.order, duration, successRate, cpuUsage, memUsage, cost };
      });

      const { mean, stdDev } = computeDurationStats(stagePayloads.map(s => s.duration));

      for (const payload of stagePayloads) {
        const bottleneck = calculateBottleneck(payload.duration, payload.successRate, mean, stdDev);
        await query(
          `INSERT INTO pipeline_stages 
           (company_id, team_id, name, stage_order, avg_duration_seconds, success_rate, 
            cpu_usage, memory_usage, cost_per_run, bottleneck_score, is_active)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
          [companyId, payload.name, payload.order, payload.duration,
           payload.successRate.toFixed(2), payload.cpuUsage.toFixed(2), payload.memUsage.toFixed(2),
           payload.cost.toFixed(2), bottleneck.toFixed(2)]
        );
        recordsAffected++;
      }
    }

    // If teamId is provided, seed team-specific stages
    if (teamId) {
      const teamStages = await query<any>(
        'SELECT COUNT(*) as count FROM pipeline_stages WHERE company_id = ? AND team_id = ?',
        [companyId, teamId]
      );

      if (teamStages[0].count === 0) {
        // Create team-specific stages with variance from defaults
        const stagePayloads = PIPELINE_STAGES.map(stage => {
          const duration = Math.round(addVariance(stage.baseDuration, 25)); // More variance per team
          const successRate = Math.min(100, addVariance(stage.baseSuccess, 5));
          const cpuUsage = Math.min(100, addVariance(stage.baseCpu, 25));
          const memUsage = Math.min(100, addVariance(stage.baseMem, 25));
          const cost = Math.max(0.01, addVariance(stage.baseCost, 30));
          return { name: stage.name, order: stage.order, duration, successRate, cpuUsage, memUsage, cost };
        });

        const { mean, stdDev } = computeDurationStats(stagePayloads.map(s => s.duration));

        for (const payload of stagePayloads) {
          const bottleneck = calculateBottleneck(payload.duration, payload.successRate, mean, stdDev);
          await query(
            `INSERT INTO pipeline_stages 
             (company_id, team_id, name, stage_order, avg_duration_seconds, success_rate, 
              cpu_usage, memory_usage, cost_per_run, bottleneck_score, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
            [companyId, teamId, payload.name, payload.order, payload.duration,
             payload.successRate.toFixed(2), payload.cpuUsage.toFixed(2), payload.memUsage.toFixed(2),
             payload.cost.toFixed(2), bottleneck.toFixed(2)]
          );
          recordsAffected++;
        }
      }
    }

    // Update existing stages (for periodic refresh)
    const existing = await query<any>(
      'SELECT COUNT(*) as count FROM pipeline_stages WHERE company_id = ?',
      [companyId]
    );

    if (existing[0].count > 0 && companyDefaults[0].count > 0) {
      // Update existing stages with new values (simulating real pipeline runs)
      // SKIP manually edited stages - those are set by users via ManualMetricsInput
      const stages = await query<any>(
        `SELECT id, name, team_id, avg_duration_seconds, success_rate 
         FROM pipeline_stages 
         WHERE company_id = ? AND (manually_edited = FALSE OR manually_edited IS NULL)`,
        [companyId]
      );

      const stageUpdates: {
        id: string;
        name: string;
        duration: number;
        successRate: number;
        cpu: number;
        mem: number;
        cost: number;
      }[] = [];

      for (const dbStage of stages) {
        const stageDef = PIPELINE_STAGES.find(s => s.name === dbStage.name);
        if (!stageDef) continue;

        // Gradual evolution of values (weighted average with new sample)
        const newDuration = Math.round(addVariance(stageDef.baseDuration, 20));
        const newSuccess = Math.min(100, addVariance(stageDef.baseSuccess, 5));
        const newCpu = Math.min(100, addVariance(stageDef.baseCpu, 25));
        const newMem = Math.min(100, addVariance(stageDef.baseMem, 25));
        const newCost = Math.max(0.01, addVariance(stageDef.baseCost, 30));

        // Blend old and new (70% old, 30% new for smoother transitions)
        const blendedDuration = Math.round(dbStage.avg_duration_seconds * 0.7 + newDuration * 0.3);
        const blendedSuccess = Number(dbStage.success_rate) * 0.7 + newSuccess * 0.3;
        stageUpdates.push({
          id: dbStage.id,
          name: dbStage.name,
          duration: blendedDuration,
          successRate: blendedSuccess,
          cpu: newCpu,
          mem: newMem,
          cost: newCost
        });
      }

      const { mean, stdDev } = computeDurationStats(stageUpdates.map(s => s.duration));

      for (const update of stageUpdates) {
        const bottleneck = calculateBottleneck(update.duration, update.successRate, mean, stdDev);

        await query(
          `UPDATE pipeline_stages 
           SET avg_duration_seconds = ?, success_rate = ?, cpu_usage = ?, 
               memory_usage = ?, cost_per_run = ?, bottleneck_score = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [update.duration, update.successRate.toFixed(2), update.cpu.toFixed(2),
           update.mem.toFixed(2), update.cost.toFixed(2), bottleneck.toFixed(2), update.id]
        );

        await query(
          `INSERT INTO pipeline_stage_history 
           (stage_id, company_id, team_id, name, duration_seconds, success_rate,
            cpu_usage, memory_usage, cost_per_run, bottleneck_score)
           SELECT id, company_id, team_id, name, avg_duration_seconds, success_rate,
                  cpu_usage, memory_usage, cost_per_run, bottleneck_score
           FROM pipeline_stages WHERE id = ?`,
          [update.id]
        );

        recordsAffected++;
      }
    }

    // Log seeder run
    await query(
      `INSERT INTO seeder_runs (seeder_name, company_id, records_affected, status)
       VALUES ('pipeline_stages', ?, ?, 'success')`,
      [companyId, recordsAffected]
    );

    return recordsAffected;
  } catch (error) {
    console.error('Pipeline seeder error:', error);
    await query(
      `INSERT INTO seeder_runs (seeder_name, company_id, status, error_message)
       VALUES ('pipeline_stages', ?, 'failed', ?)`,
      [companyId, (error as Error).message]
    ).catch(() => {});
    throw error;
  }
}

// Seed pipeline runs (simulated execution history)
export async function seedPipelineRuns(companyId: string, count: number = 10): Promise<number> {
  let recordsAffected = 0;

  try {
    const stages = await query<any>(
      'SELECT id, name, avg_duration_seconds, success_rate FROM pipeline_stages WHERE company_id = ? AND is_active = true',
      [companyId]
    );

    if (stages.length === 0) return 0;

    const branches = ['main', 'develop', 'feature/auth', 'feature/dashboard', 'bugfix/login'];
    const users = ['ci-bot', 'developer1', 'developer2', 'qa-engineer'];

    for (let i = 0; i < count; i++) {
      // Generate a pipeline run for each stage
      const runTime = new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000); // Last 24 hours
      const branch = branches[Math.floor(Math.random() * branches.length)];
      const commitSha = [...Array(40)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
      const triggeredBy = users[Math.floor(Math.random() * users.length)];

      for (const stage of stages) {
        const baseSuccessRate = Number(stage.success_rate);
        const isSuccess = Math.random() * 100 < baseSuccessRate;
        const duration = Math.round(addVariance(stage.avg_duration_seconds, 30));
        const completedAt = new Date(runTime.getTime() + duration * 1000);

        await query(
          `INSERT INTO pipeline_runs 
           (company_id, stage_id, status, duration_seconds, triggered_by, commit_sha, branch, started_at, completed_at, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            companyId, 
            stage.id, 
            isSuccess ? 'success' : 'failed',
            duration,
            triggeredBy,
            commitSha,
            branch,
            runTime,
            completedAt,
            isSuccess ? null : 'Build failed: Exit code 1'
          ]
        );
        recordsAffected++;
      }
    }

    // Update execution summary
    await updateExecutionSummary(companyId);

    return recordsAffected;
  } catch (error) {
    console.error('Pipeline runs seeder error:', error);
    throw error;
  }
}

// Update daily execution summary from pipeline_runs
async function updateExecutionSummary(companyId: string): Promise<void> {
  await query(`
    INSERT INTO pipeline_execution_summary 
      (company_id, team_id, stage_id, execution_date, total_runs, successful_runs, 
       failed_runs, avg_duration_seconds, min_duration_seconds, max_duration_seconds, total_cost)
    SELECT 
      pr.company_id,
      ps.team_id,
      pr.stage_id,
      DATE(pr.started_at) as execution_date,
      COUNT(*) as total_runs,
      SUM(CASE WHEN pr.status = 'success' THEN 1 ELSE 0 END) as successful_runs,
      SUM(CASE WHEN pr.status = 'failed' THEN 1 ELSE 0 END) as failed_runs,
      AVG(pr.duration_seconds) as avg_duration_seconds,
      MIN(pr.duration_seconds) as min_duration_seconds,
      MAX(pr.duration_seconds) as max_duration_seconds,
      SUM(ps.cost_per_run) as total_cost
    FROM pipeline_runs pr
    JOIN pipeline_stages ps ON pr.stage_id = ps.id
    WHERE pr.company_id = ?
      AND DATE(pr.started_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    GROUP BY pr.company_id, ps.team_id, pr.stage_id, DATE(pr.started_at)
    ON DUPLICATE KEY UPDATE
      total_runs = VALUES(total_runs),
      successful_runs = VALUES(successful_runs),
      failed_runs = VALUES(failed_runs),
      avg_duration_seconds = VALUES(avg_duration_seconds),
      min_duration_seconds = VALUES(min_duration_seconds),
      max_duration_seconds = VALUES(max_duration_seconds),
      total_cost = VALUES(total_cost),
      updated_at = CURRENT_TIMESTAMP
  `, [companyId]);
}

// Seed pipeline stages for all teams in a company
export async function seedPipelineStagesForAllTeams(companyId: string): Promise<number> {
  let totalAffected = 0;
  
  try {
    // Get all active teams for this company
    const teams = await query<any>(
      'SELECT id FROM teams WHERE company_id = ? AND is_active = true',
      [companyId]
    );
    
    console.log(`[PipelineSeeder] Seeding stages for ${teams.length} teams in company ${companyId}`);
    
    for (const team of teams) {
      const affected = await seedPipelineStages(companyId, team.id);
      totalAffected += affected;
    }
    
    return totalAffected;
  } catch (error) {
    console.error(`[PipelineSeeder] Failed to seed all teams for company ${companyId}:`, error);
    throw error;
  }
}

// Run seeder for all companies
export async function runPipelineSeederForAllCompanies(): Promise<void> {
  try {
    const companies = await query<any>('SELECT id FROM companies WHERE is_active = true');
    
    console.log(`[PipelineSeeder] Running for ${companies.length} companies...`);
    
    for (const company of companies) {
      try {
        // Seed company defaults first
        const affected = await seedPipelineStages(company.id);
        // Seed all teams
        const teamAffected = await seedPipelineStagesForAllTeams(company.id);
        await seedPipelineRuns(company.id, 3); // 3 runs per update
        console.log(`[PipelineSeeder] Company ${company.id}: ${affected + teamAffected} stages updated`);
      } catch (err) {
        console.error(`[PipelineSeeder] Failed for company ${company.id}:`, err);
      }
    }
    
    console.log('[PipelineSeeder] Completed');
  } catch (error) {
    console.error('[PipelineSeeder] Fatal error:', error);
  }
}
