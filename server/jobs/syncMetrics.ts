import cron from 'node-cron';
import { query } from '../../src/lib/db';

console.log('📅 Metrics sync job initialized');

// Run every 15 minutes: */15 * * * *
cron.schedule('*/15 * * * *', async () => {
  console.log('🔄 Starting metrics sync...', new Date().toISOString());
  
  try {
    // Get all active teams
    const teams = await query<any[]>(
      'SELECT id, name, company_id FROM teams WHERE is_active = true'
    );
    
    console.log(`Found ${teams.length} active teams to sync`);
    
    for (const team of teams) {
      try {
        // In production, you would:
        // 1. Fetch from Jenkins API
        // 2. Fetch from Jira API
        // 3. Fetch from SonarQube API
        // 4. Calculate KPIs
        // 5. Upsert to database
        
        // For now, generate mock data
        const kpiData = generateMockKPIs(team.id);
        
        await query(
          `INSERT INTO kpi_snapshots (
            team_id, snapshot_date,
            test_coverage, test_flakiness_rate, defect_density, defect_escape_rate, code_quality_score,
            avg_build_time_minutes, test_execution_time_minutes, deployment_frequency_per_week,
            lead_time_days, mttr_hours, parallel_test_efficiency,
            sprint_velocity, sprint_commitment_rate, sprint_carryover, first_time_pass_rate,
            blocked_time_hours, automation_coverage, automation_roi,
            change_failure_rate, mtbf_hours, system_availability, infrastructure_failures,
            qa_score, status
          ) VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            test_coverage = VALUES(test_coverage),
            test_flakiness_rate = VALUES(test_flakiness_rate),
            defect_density = VALUES(defect_density),
            defect_escape_rate = VALUES(defect_escape_rate),
            code_quality_score = VALUES(code_quality_score),
            avg_build_time_minutes = VALUES(avg_build_time_minutes),
            test_execution_time_minutes = VALUES(test_execution_time_minutes),
            deployment_frequency_per_week = VALUES(deployment_frequency_per_week),
            lead_time_days = VALUES(lead_time_days),
            mttr_hours = VALUES(mttr_hours),
            parallel_test_efficiency = VALUES(parallel_test_efficiency),
            sprint_velocity = VALUES(sprint_velocity),
            sprint_commitment_rate = VALUES(sprint_commitment_rate),
            sprint_carryover = VALUES(sprint_carryover),
            first_time_pass_rate = VALUES(first_time_pass_rate),
            blocked_time_hours = VALUES(blocked_time_hours),
            automation_coverage = VALUES(automation_coverage),
            automation_roi = VALUES(automation_roi),
            change_failure_rate = VALUES(change_failure_rate),
            mtbf_hours = VALUES(mtbf_hours),
            system_availability = VALUES(system_availability),
            infrastructure_failures = VALUES(infrastructure_failures),
            qa_score = VALUES(qa_score),
            status = VALUES(status)`,
          [
            team.id,
            kpiData.test_coverage,
            kpiData.test_flakiness_rate,
            kpiData.defect_density,
            kpiData.defect_escape_rate,
            kpiData.code_quality_score,
            kpiData.avg_build_time_minutes,
            kpiData.test_execution_time_minutes,
            kpiData.deployment_frequency_per_week,
            kpiData.lead_time_days,
            kpiData.mttr_hours,
            kpiData.parallel_test_efficiency,
            kpiData.sprint_velocity,
            kpiData.sprint_commitment_rate,
            kpiData.sprint_carryover,
            kpiData.first_time_pass_rate,
            kpiData.blocked_time_hours,
            kpiData.automation_coverage,
            kpiData.automation_roi,
            kpiData.change_failure_rate,
            kpiData.mtbf_hours,
            kpiData.system_availability,
            kpiData.infrastructure_failures,
            kpiData.qa_score,
            kpiData.status
          ]
        );
        
        console.log(`✅ Synced metrics for team: ${team.name}`);
      } catch (error) {
        console.error(`❌ Failed to sync team ${team.name}:`, error);
      }
    }
    
    console.log('✅ Metrics sync completed');
  } catch (error) {
    console.error('❌ Metrics sync failed:', error);
  }
});

// Generate mock KPI data (replace with real API calls in production)
function generateMockKPIs(teamId: string) {
  const baseScore = 70 + Math.random() * 25;
  
  return {
    test_coverage: Number((60 + Math.random() * 35).toFixed(2)),
    test_flakiness_rate: Number((Math.random() * 5).toFixed(2)),
    defect_density: Number((Math.random() * 1.5).toFixed(3)),
    defect_escape_rate: Number((Math.random() * 8).toFixed(2)),
    code_quality_score: Math.floor(70 + Math.random() * 25),
    avg_build_time_minutes: Math.floor(5 + Math.random() * 15),
    test_execution_time_minutes: Math.floor(20 + Math.random() * 40),
    deployment_frequency_per_week: Math.floor(5 + Math.random() * 15),
    lead_time_days: Number((1 + Math.random() * 4).toFixed(2)),
    mttr_hours: Number((2 + Math.random() * 8).toFixed(2)),
    parallel_test_efficiency: Number((70 + Math.random() * 25).toFixed(2)),
    sprint_velocity: Math.floor(30 + Math.random() * 30),
    sprint_commitment_rate: Number((75 + Math.random() * 20).toFixed(2)),
    sprint_carryover: Number((5 + Math.random() * 20).toFixed(2)),
    first_time_pass_rate: Number((60 + Math.random() * 30).toFixed(2)),
    blocked_time_hours: Math.floor(10 + Math.random() * 20),
    automation_coverage: Number((60 + Math.random() * 35).toFixed(2)),
    automation_roi: Number((200 + Math.random() * 200).toFixed(2)),
    change_failure_rate: Number((Math.random() * 10).toFixed(2)),
    mtbf_hours: Math.floor(80 + Math.random() * 80),
    system_availability: Number((99 + Math.random()).toFixed(3)),
    infrastructure_failures: Math.floor(Math.random() * 8),
    qa_score: Math.floor(baseScore),
    status: baseScore > 85 ? 'good' : baseScore > 70 ? 'warning' : 'critical'
  };
}

console.log('✅ Cron job scheduled: Every 15 minutes');
