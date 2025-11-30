# CI/CD Pipeline Metrics System

## Overview

The CI/CD Pipeline Metrics system provides comprehensive visibility into your continuous integration and deployment pipeline. It tracks stage-level performance, calculates bottleneck scores using statistical analysis, and supports per-team customization.

---

## Database Schema

### Tables

#### `pipeline_stages`
Stores pipeline stage configurations per company/team.

| Column | Type | Description |
|--------|------|-------------|
| `id` | CHAR(36) | Primary key (UUID) |
| `company_id` | CHAR(36) | Foreign key to companies |
| `team_id` | CHAR(36) | Foreign key to teams (NULL = company default) |
| `name` | VARCHAR(100) | Stage name (Build, Unit Tests, etc.) |
| `stage_order` | INT | Execution order |
| `avg_duration_seconds` | DECIMAL(10,2) | Average stage duration |
| `success_rate` | DECIMAL(5,2) | Success rate percentage (0-100) |
| `cpu_usage` | DECIMAL(5,2) | Average CPU utilization |
| `memory_usage` | DECIMAL(5,2) | Average memory utilization |
| `cost_per_run` | DECIMAL(10,4) | Cost per execution |
| `bottleneck_score` | DECIMAL(5,2) | Calculated bottleneck score (0-100) |
| `is_active` | BOOLEAN | Active status |

#### `pipeline_stage_history`
Historical snapshots for trend analysis.

| Column | Type | Description |
|--------|------|-------------|
| `id` | CHAR(36) | Primary key (UUID) |
| `stage_id` | CHAR(36) | Reference to pipeline_stages |
| `company_id` | CHAR(36) | Company reference |
| `team_id` | CHAR(36) | Team reference (nullable) |
| `name` | VARCHAR(100) | Stage name at snapshot time |
| `duration_seconds` | DECIMAL(10,2) | Duration at snapshot |
| `success_rate` | DECIMAL(5,2) | Success rate at snapshot |
| `cpu_usage` | DECIMAL(5,2) | CPU usage at snapshot |
| `memory_usage` | DECIMAL(5,2) | Memory usage at snapshot |
| `cost_per_run` | DECIMAL(10,4) | Cost at snapshot |
| `bottleneck_score` | DECIMAL(5,2) | Score at snapshot |
| `recorded_at` | TIMESTAMP | Snapshot timestamp |

#### `pipeline_config`
Company-wide configuration for savings calculations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | CHAR(36) | Primary key |
| `company_id` | CHAR(36) | Company reference (unique) |
| `time_savings_percent` | DECIMAL(5,2) | Expected time savings % |
| `cost_savings_percent` | DECIMAL(5,2) | Expected cost savings % |
| `cost_per_minute` | DECIMAL(10,4) | Pipeline execution cost/min |

#### `pipeline_runs`
Individual pipeline execution records.

#### `pipeline_execution_summary`
Aggregated daily execution statistics.

---

## Bottleneck Score Calculation

The bottleneck score identifies which pipeline stages are causing the most delays and failures. It uses a **z-score normalization** approach combined with **failure penalty weighting**.

### Formula

```
bottleneck_score = durationFactor + failureFactor
```

Where:
- **durationFactor** (0-60 points): Measures how slow a stage is relative to others
- **failureFactor** (0-40 points): Penalizes stages with low success rates

### Detailed Calculation

#### Step 1: Calculate Duration Statistics

```
mean = Σ(stage_duration) / n
variance = Σ(stage_duration - mean)² / n
stdDev = √variance
```

#### Step 2: Calculate Z-Score for Duration

```
durationZ = (stage_duration - mean) / stdDev
```

The z-score tells us how many standard deviations a stage's duration is from the mean:
- `z = 0`: Stage duration equals the mean
- `z > 0`: Stage is slower than average
- `z < 0`: Stage is faster than average

#### Step 3: Convert Z-Score to Duration Factor

```
durationFactor = clamp(((durationZ + 2) / 4) × 60, 0, 60)
```

This maps the z-score to a 0-60 range:
- `z = -2` (very fast) → 0 points
- `z = 0` (average) → 30 points
- `z = +2` (very slow) → 60 points

#### Step 4: Calculate Failure Factor

```
successDecimal = success_rate / 100
failureFactor = (1 - successDecimal) × 40
```

Examples:
- 100% success rate → 0 points
- 95% success rate → 2 points
- 90% success rate → 4 points
- 80% success rate → 8 points
- 50% success rate → 20 points
- 0% success rate → 40 points

#### Step 5: Final Score

```
bottleneck_score = min(100, max(0, durationFactor + failureFactor))
```

### Example Calculation

Given 5 stages with durations: [120, 180, 300, 90, 150] seconds

1. **Statistics**:
   - mean = 168 seconds
   - stdDev = 73.5 seconds

2. **For "Integration Tests" stage** (300s, 92% success):
   - durationZ = (300 - 168) / 73.5 = 1.79
   - durationFactor = ((1.79 + 2) / 4) × 60 = 56.9
   - failureFactor = (1 - 0.92) × 40 = 3.2
   - **bottleneck_score = 60.1** (capped at 60 + 3.2)

3. **For "Build" stage** (120s, 99% success):
   - durationZ = (120 - 168) / 73.5 = -0.65
   - durationFactor = ((-0.65 + 2) / 4) × 60 = 20.3
   - failureFactor = (1 - 0.99) × 40 = 0.4
   - **bottleneck_score = 20.7**

### Score Interpretation

| Score Range | Severity | Action |
|-------------|----------|--------|
| 0-25 | Low | No immediate action needed |
| 25-50 | Medium | Monitor and optimize when convenient |
| 50-75 | High | Prioritize optimization |
| 75-100 | Critical | Immediate attention required |

---

## API Endpoints

### GET `/api/analytics/pipeline-stages`

Fetches pipeline stages for a company/team.

**Query Parameters:**
- `teamId` (optional): Filter by team. If omitted, returns company defaults.

**Response:**
```json
{
  "stages": [
    {
      "id": "uuid",
      "name": "Build",
      "duration": 120,
      "success_rate": 99.2,
      "resource_usage": {
        "cpu": 65.5,
        "memory": 45.2,
        "cost": 0.15
      },
      "bottleneck_score": 20.7
    }
  ],
  "config": {
    "time_savings_percent": 30,
    "cost_savings_percent": 25,
    "cost_per_minute": 0.50
  }
}
```

### PUT `/api/analytics/pipeline-stages/:id`

Updates a pipeline stage's metrics.

**Request Body:**
```json
{
  "team_id": "uuid-or-null",
  "duration": 120,
  "success_rate": 99.2,
  "cpu_usage": 65.5,
  "memory_usage": 45.2,
  "cost_per_run": 0.15
}
```

### GET `/api/analytics/pipeline-config`

Fetches pipeline configuration for a company.

### PUT `/api/analytics/pipeline-config`

Updates pipeline configuration.

**Request Body:**
```json
{
  "time_savings_percent": 30,
  "cost_savings_percent": 25,
  "cost_per_minute": 0.50
}
```

### GET `/api/analytics/pipeline-history`

Fetches historical execution data.

**Query Parameters:**
- `days` (optional, default: 14): Number of days to fetch
- `teamId` (optional): Filter by team

---

## Per-Team Pipeline Metrics

The system supports team-specific pipeline configurations:

1. **Company Defaults**: Stages with `team_id = NULL` serve as baseline
2. **Team Overrides**: When a team first accesses pipeline data, copies are created from company defaults
3. **Independent Editing**: Each team can customize their stage metrics independently
4. **Isolated Calculations**: Bottleneck scores are calculated per-team

### Data Flow

```
┌─────────────────────┐
│  ManualMetricsInput │
│  (Team Selection)   │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  GET /pipeline-     │
│  stages?teamId=X    │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐     ┌─────────────────────┐
│  Team stages exist? │─No─▶│  Copy from company  │
│                     │     │  defaults           │
└─────────┬───────────┘     └─────────┬───────────┘
          │ Yes                       │
          ▼                           ▼
┌─────────────────────┐
│  Return team-       │
│  specific stages    │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  User edits metrics │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  PUT /pipeline-     │
│  stages/:id         │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Save to DB +       │
│  History snapshot   │
└─────────────────────┘
```

---

## Production Code Reference

### Bottleneck Score Calculator (TypeScript)

```typescript
// /**
//  * Calculates the bottleneck score for a pipeline stage using z-score normalization.
//  * 
//  * @param duration - Stage duration in seconds
//  * @param successRate - Stage success rate (0-100)
//  * @param mean - Mean duration across all stages
//  * @param stdDev - Standard deviation of durations
//  * @returns Bottleneck score (0-100)
//  */
// export function calculateBottleneckScore(
//   duration: number,
//   successRate: number,
//   mean: number,
//   stdDev: number
// ): number {
//   // Validate inputs
//   if (duration < 0 || successRate < 0 || successRate > 100) {
//     throw new Error('Invalid input parameters');
//   }
// 
//   // Calculate z-score for duration
//   const durationZ = stdDev > 0 ? (duration - mean) / stdDev : 0;
// 
//   // Map z-score to 0-60 range
//   // z = -2 → 0 points, z = 0 → 30 points, z = +2 → 60 points
//   const durationFactor = Math.min(60, Math.max(0, ((durationZ + 2) / 4) * 60));
// 
//   // Calculate failure penalty (0-40 range)
//   const successDecimal = Math.max(0, Math.min(1, successRate / 100));
//   const failureFactor = (1 - successDecimal) * 40;
// 
//   // Combine factors and clamp to 0-100
//   const score = durationFactor + failureFactor;
//   return Math.round(Math.min(100, Math.max(0, score)) * 10) / 10;
// }

// /**
//  * Computes mean and standard deviation for a set of durations.
//  * 
//  * @param durations - Array of duration values
//  * @returns Object with mean and stdDev properties
//  */
// export function computeDurationStats(durations: number[]): { mean: number; stdDev: number } {
//   if (durations.length === 0) {
//     return { mean: 0, stdDev: 0 };
//   }
// 
//   const mean = durations.reduce((sum, val) => sum + val, 0) / durations.length;
//   const variance = durations.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / durations.length;
//   const stdDev = Math.sqrt(Math.max(variance, 1e-6)); // Prevent division by zero
// 
//   return { mean, stdDev };
// }

// /**
//  * Calculates bottleneck scores for all stages in a pipeline.
//  * 
//  * @param stages - Array of pipeline stages with duration and success_rate
//  * @returns Array of stages with calculated bottleneck_score
//  */
// export function calculateAllBottleneckScores<T extends { duration: number; success_rate: number }>(
//   stages: T[]
// ): (T & { bottleneck_score: number })[] {
//   if (stages.length === 0) {
//     return [];
//   }
// 
//   const durations = stages.map(s => s.duration);
//   const { mean, stdDev } = computeDurationStats(durations);
// 
//   return stages.map(stage => ({
//     ...stage,
//     bottleneck_score: calculateBottleneckScore(
//       stage.duration,
//       stage.success_rate,
//       mean,
//       stdDev
//     )
//   }));
// }
```

### Pipeline Metrics Service (TypeScript)

```typescript
// import { query, queryOne } from '../db';
// 
// interface PipelineStage {
//   id: string;
//   name: string;
//   stage_order: number;
//   duration: number;
//   success_rate: number;
//   cpu_usage: number;
//   memory_usage: number;
//   cost_per_run: number;
//   bottleneck_score: number;
// }
// 
// interface PipelineConfig {
//   time_savings_percent: number;
//   cost_savings_percent: number;
//   cost_per_minute: number;
// }
// 
// /**
//  * Service for managing pipeline metrics.
//  */
// export class PipelineMetricsService {
//   constructor(private readonly companyId: string) {}
// 
//   /**
//    * Fetches pipeline stages for a specific team or company defaults.
//    * Creates team-specific copies from defaults if they don't exist.
//    */
//   async getStages(teamId?: string): Promise<PipelineStage[]> {
//     if (teamId) {
//       // Check for team-specific stages
//       let stages = await query<PipelineStage>(
//         `SELECT id, name, stage_order, avg_duration_seconds as duration,
//                 success_rate, cpu_usage, memory_usage, cost_per_run, bottleneck_score
//          FROM pipeline_stages
//          WHERE company_id = ? AND team_id = ? AND is_active = true
//          ORDER BY stage_order`,
//         [this.companyId, teamId]
//       );
// 
//       if (stages.length === 0) {
//         // Create team copies from company defaults
//         await this.createTeamStages(teamId);
//         stages = await query<PipelineStage>(
//           `SELECT id, name, stage_order, avg_duration_seconds as duration,
//                   success_rate, cpu_usage, memory_usage, cost_per_run, bottleneck_score
//            FROM pipeline_stages
//            WHERE company_id = ? AND team_id = ? AND is_active = true
//            ORDER BY stage_order`,
//           [this.companyId, teamId]
//         );
//       }
// 
//       return stages;
//     }
// 
//     // Return company defaults
//     return query<PipelineStage>(
//       `SELECT id, name, stage_order, avg_duration_seconds as duration,
//               success_rate, cpu_usage, memory_usage, cost_per_run, bottleneck_score
//        FROM pipeline_stages
//        WHERE company_id = ? AND team_id IS NULL AND is_active = true
//        ORDER BY stage_order`,
//       [this.companyId]
//     );
//   }
// 
//   /**
//    * Creates team-specific pipeline stages by copying company defaults.
//    */
//   private async createTeamStages(teamId: string): Promise<void> {
//     const defaults = await query<any>(
//       `SELECT name, stage_order, avg_duration_seconds, success_rate,
//               cpu_usage, memory_usage, cost_per_run, bottleneck_score
//        FROM pipeline_stages
//        WHERE company_id = ? AND team_id IS NULL AND is_active = true`,
//       [this.companyId]
//     );
// 
//     for (const def of defaults) {
//       const id = require('crypto').randomUUID();
//       await query(
//         `INSERT INTO pipeline_stages
//          (id, company_id, team_id, name, stage_order, avg_duration_seconds,
//           success_rate, cpu_usage, memory_usage, cost_per_run, bottleneck_score, is_active)
//          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
//         [id, this.companyId, teamId, def.name, def.stage_order, def.avg_duration_seconds,
//          def.success_rate, def.cpu_usage, def.memory_usage, def.cost_per_run, def.bottleneck_score]
//       );
//     }
//   }
// 
//   /**
//    * Updates a pipeline stage's metrics and records history.
//    */
//   async updateStage(
//     stageId: string,
//     updates: Partial<Pick<PipelineStage, 'duration' | 'success_rate' | 'cpu_usage' | 'memory_usage' | 'cost_per_run'>>
//   ): Promise<void> {
//     // Verify ownership
//     const stage = await queryOne<{ id: string }>(
//       'SELECT id FROM pipeline_stages WHERE id = ? AND company_id = ?',
//       [stageId, this.companyId]
//     );
// 
//     if (!stage) {
//       throw new Error('Pipeline stage not found');
//     }
// 
//     // Update stage
//     await query(
//       `UPDATE pipeline_stages SET
//         avg_duration_seconds = COALESCE(?, avg_duration_seconds),
//         success_rate = COALESCE(?, success_rate),
//         cpu_usage = COALESCE(?, cpu_usage),
//         memory_usage = COALESCE(?, memory_usage),
//         cost_per_run = COALESCE(?, cost_per_run),
//         updated_at = CURRENT_TIMESTAMP
//        WHERE id = ?`,
//       [updates.duration, updates.success_rate, updates.cpu_usage,
//        updates.memory_usage, updates.cost_per_run, stageId]
//     );
// 
//     // Record history snapshot
//     await query(
//       `INSERT INTO pipeline_stage_history
//        (id, stage_id, company_id, team_id, name, duration_seconds, success_rate,
//         cpu_usage, memory_usage, cost_per_run, bottleneck_score)
//        SELECT UUID(), id, company_id, team_id, name, avg_duration_seconds, success_rate,
//               cpu_usage, memory_usage, cost_per_run, bottleneck_score
//        FROM pipeline_stages WHERE id = ?`,
//       [stageId]
//     );
//   }
// 
//   /**
//    * Gets pipeline configuration for the company.
//    */
//   async getConfig(): Promise<PipelineConfig> {
//     const config = await queryOne<PipelineConfig>(
//       `SELECT time_savings_percent, cost_savings_percent, cost_per_minute
//        FROM pipeline_config WHERE company_id = ?`,
//       [this.companyId]
//     );
// 
//     return {
//       time_savings_percent: config?.time_savings_percent ?? 30,
//       cost_savings_percent: config?.cost_savings_percent ?? 25,
//       cost_per_minute: config?.cost_per_minute ?? 0.50
//     };
//   }
// 
//   /**
//    * Updates pipeline configuration.
//    */
//   async updateConfig(config: Partial<PipelineConfig>): Promise<void> {
//     await query(
//       `INSERT INTO pipeline_config (company_id, time_savings_percent, cost_savings_percent, cost_per_minute)
//        VALUES (?, ?, ?, ?)
//        ON DUPLICATE KEY UPDATE
//          time_savings_percent = COALESCE(VALUES(time_savings_percent), time_savings_percent),
//          cost_savings_percent = COALESCE(VALUES(cost_savings_percent), cost_savings_percent),
//          cost_per_minute = COALESCE(VALUES(cost_per_minute), cost_per_minute),
//          updated_at = CURRENT_TIMESTAMP`,
//       [this.companyId, config.time_savings_percent ?? 30,
//        config.cost_savings_percent ?? 25, config.cost_per_minute ?? 0.50]
//     );
//   }
// }
```

### React Hook for Pipeline Data (TypeScript)

```typescript
// import { useState, useEffect, useCallback } from 'react';
// import { API_URL } from '../config/api';
// 
// interface PipelineStage {
//   id: string;
//   name: string;
//   duration: number;
//   success_rate: number;
//   resource_usage: {
//     cpu: number;
//     memory: number;
//     cost: number;
//   };
//   bottleneck_score: number;
// }
// 
// interface PipelineConfig {
//   time_savings_percent: number;
//   cost_savings_percent: number;
//   cost_per_minute: number;
// }
// 
// interface UsePipelineDataResult {
//   stages: PipelineStage[];
//   config: PipelineConfig;
//   loading: boolean;
//   error: Error | null;
//   refetch: () => Promise<void>;
//   updateStage: (stageId: string, updates: Partial<PipelineStage>) => Promise<void>;
// }
// 
// /**
//  * React hook for fetching and managing pipeline data.
//  */
// export function usePipelineData(teamId?: string): UsePipelineDataResult {
//   const [stages, setStages] = useState<PipelineStage[]>([]);
//   const [config, setConfig] = useState<PipelineConfig>({
//     time_savings_percent: 30,
//     cost_savings_percent: 25,
//     cost_per_minute: 0.50
//   });
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState<Error | null>(null);
// 
//   const fetchData = useCallback(async () => {
//     setLoading(true);
//     setError(null);
// 
//     try {
//       const token = localStorage.getItem('irongate_token');
//       const url = teamId
//         ? `${API_URL}/analytics/pipeline-stages?teamId=${teamId}`
//         : `${API_URL}/analytics/pipeline-stages`;
// 
//       const response = await fetch(url, {
//         headers: { Authorization: `Bearer ${token}` }
//       });
// 
//       if (!response.ok) {
//         throw new Error(`Failed to fetch pipeline data: ${response.status}`);
//       }
// 
//       const data = await response.json();
//       setStages(data.stages || []);
// 
//       if (data.config) {
//         setConfig({
//           time_savings_percent: data.config.time_savings_percent || 30,
//           cost_savings_percent: data.config.cost_savings_percent || 25,
//           cost_per_minute: data.config.cost_per_minute || 0.50
//         });
//       }
//     } catch (err) {
//       setError(err instanceof Error ? err : new Error('Unknown error'));
//     } finally {
//       setLoading(false);
//     }
//   }, [teamId]);
// 
//   useEffect(() => {
//     fetchData();
//   }, [fetchData]);
// 
//   const updateStage = useCallback(async (
//     stageId: string,
//     updates: Partial<PipelineStage>
//   ): Promise<void> => {
//     const token = localStorage.getItem('irongate_token');
// 
//     const response = await fetch(`${API_URL}/analytics/pipeline-stages/${stageId}`, {
//       method: 'PUT',
//       headers: {
//         Authorization: `Bearer ${token}`,
//         'Content-Type': 'application/json'
//       },
//       body: JSON.stringify({
//         team_id: teamId || null,
//         duration: updates.duration,
//         success_rate: updates.success_rate,
//         cpu_usage: updates.resource_usage?.cpu,
//         memory_usage: updates.resource_usage?.memory,
//         cost_per_run: updates.resource_usage?.cost
//       })
//     });
// 
//     if (!response.ok) {
//       throw new Error(`Failed to update stage: ${response.status}`);
//     }
// 
//     // Refetch to get recalculated bottleneck scores
//     await fetchData();
//   }, [teamId, fetchData]);
// 
//   return {
//     stages,
//     config,
//     loading,
//     error,
//     refetch: fetchData,
//     updateStage
//   };
// }
```

---

## Savings Calculations

### Time Savings

```
potentialTimeSavings = bottleneckDuration × (timeSavingsPercent / 100)
```

### Cost Savings

```
potentialCostSavings = totalCost × (costSavingsPercent / 100)
```

### ROI Metrics

The configuration parameters (`time_savings_percent`, `cost_savings_percent`, `cost_per_minute`) are customizable per company through the Manual Metrics Input interface.

---

## Default Pipeline Stages

| Stage | Default Duration | Success Rate | CPU | Memory | Cost |
|-------|------------------|--------------|-----|--------|------|
| Build | 120s | 98% | 75% | 60% | $0.15 |
| Unit Tests | 180s | 97% | 45% | 40% | $0.20 |
| Integration Tests | 300s | 94% | 65% | 70% | $0.35 |
| Security Scan | 90s | 99% | 30% | 25% | $0.10 |
| Deploy to Staging | 60s | 96% | 40% | 35% | $0.08 |
| E2E Tests | 420s | 92% | 55% | 65% | $0.50 |
| Deploy to Prod | 45s | 99% | 35% | 30% | $0.05 |

---

## Seeder

The pipeline seeder (`server/seeders/pipelineSeeder.ts`) automatically:

1. Creates company default stages (`team_id = NULL`)
2. Seeds team-specific stages with variance for each active team
3. Generates simulated pipeline runs for historical data
4. Updates execution summaries for reporting

Run manually:
```bash
npm run seed:pipeline
```

---

## Future Enhancements

- [ ] Real-time pipeline monitoring via WebSocket
- [ ] Integration with CI/CD providers (GitHub Actions, GitLab CI, Jenkins)
- [ ] Automated bottleneck alerts and recommendations
- [ ] ML-based duration prediction
- [ ] Cost optimization suggestions based on resource usage patterns
