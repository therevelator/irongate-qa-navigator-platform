# Seed Data & Scheduled Jobs Explanation

This document explains all scheduled cron jobs and the data seeding process for the QA Dashboard.

---

## Scheduled Jobs Overview

### 1. Metrics Sync Jobs (`/server/jobs/intervalSync.ts`)

These jobs update **KPI snapshots** with mock data based on configured update intervals. They simulate real metric updates for teams.

| Job | Schedule | Cron Expression | Description |
|-----|----------|-----------------|-------------|
| **Hourly** | Every hour at :00 | `0 * * * *` | Updates metrics configured for hourly refresh |
| **Daily** | Daily at 00:05 | `5 0 * * *` | Updates metrics configured for daily refresh |
| **Weekly** | Mondays at 00:10 | `10 0 * * 1` | Updates metrics configured for weekly refresh |
| **Monthly** | 1st of month at 00:15 | `15 0 1 * *` | Updates metrics configured for monthly refresh |

#### Metrics by Frequency

**Hourly Metrics:**
- `avg_build_time_minutes` - Average CI/CD build duration
- `test_execution_time_minutes` - Test suite execution time

**Daily Metrics:**
- `test_coverage` - Code test coverage percentage
- `test_flakiness_rate` - Percentage of flaky tests
- `code_quality_score` - Static analysis score
- `lead_time_days` - Time from commit to production
- `mttr_hours` - Mean Time To Recovery
- `parallel_test_efficiency` - Test parallelization efficiency
- `first_time_pass_rate` - Tests passing on first run
- `blocked_time_hours` - Time blocked waiting for dependencies
- `system_availability` - Uptime percentage

**Weekly Metrics:**
- `defect_density` - Defects per 1000 lines of code
- `defect_escape_rate` - Defects found in production
- `deployment_frequency_per_week` - Deployments per week
- `automation_coverage` - Automated vs manual tests
- `change_failure_rate` - Failed deployments percentage
- `mtbf_hours` - Mean Time Between Failures
- `infrastructure_failures` - Infrastructure incident count
- `sprint_velocity` - Story points completed
- `sprint_commitment_rate` - Planned vs delivered
- `sprint_carryover` - Work carried to next sprint

**Monthly Metrics:**
- `automation_roi` - Return on automation investment

---

### 2. Analytics Sync Job (`/server/jobs/analyticsSync.ts`)

| Job | Schedule | Cron Expression | Description |
|-----|----------|-----------------|-------------|
| **Daily Analytics** | Daily at 00:30 | `30 0 * * *` | Updates analytics feature data |

#### What Gets Updated Daily

1. **Pipeline Stages** - Slight variations in duration, success rate, CPU/memory usage
2. **Business Impact Metrics** - New daily record for each metric
3. **Test Execution Runs** - 5-15 new test runs added
4. **Performance Metrics** - New endpoint performance data
5. ~~Developer Metrics~~ - Skipped (entered via Manual Metrics Input)

---

## Manual Seed Endpoint

**Endpoint:** `POST /api/analytics/seed-data`  
**Auth:** Requires `super_admin` role

Seeds 30 days of historical data for all analytics features.

### What Gets Seeded

| Feature | Table | Records | Description |
|---------|-------|---------|-------------|
| **CI/CD Pipeline Insights** | `pipeline_stages` | 9 stages | Checkout, Build, Tests, Deploy stages |
| **Business Impact Analysis** | `business_impact_metrics` | 5 metrics × 30 days | Revenue impact, satisfaction correlation |
| **Test Case Management** | `test_cases` | 30 cases | Test definitions with pass rates, duration |
| **Flaky Test Intelligence** | `flaky_tests` | Links to flaky test_cases | Root cause, suggested fixes |
| **Test Execution Timeline** | `test_execution_runs` | 100 runs | Test suite executions over 7 days |
| **Performance Testing** | `performance_metrics` | 5 endpoints × 30 days | Response times, throughput, errors |
| **Technical Debt Tracker** | `technical_debt` | 20 items | Debt items with priority scores |

---

## Data NOT Seeded (Manual Input)

These tables are populated via the **Manual Metrics Input** feature:

| Table | Used By | Reason |
|-------|---------|--------|
| `kpi_snapshots` | Team Dashboard, KPI Cards | User enters actual team metrics |
| `developer_metrics` | Developer Productivity | User enters actual developer metrics |

---

## Triggering Jobs Manually

### Seed All Analytics Data
```javascript
fetch('http://localhost:3000/api/analytics/seed-data', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`,
    'Content-Type': 'application/json'
  }
}).then(r => r.json()).then(console.log)
```

### Trigger Daily Analytics Update
```javascript
fetch('http://localhost:3000/api/analytics/update-daily', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`,
    'Content-Type': 'application/json'
  }
}).then(r => r.json()).then(console.log)
```

### Trigger Metric Sync (by frequency)
```javascript
fetch('http://localhost:3000/api/settings/sync-metrics', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('irongate_token')}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ frequency: 'daily' }) // hourly, daily, weekly, monthly, or all
}).then(r => r.json()).then(console.log)
```

---

## Database Tables Summary

### Analytics Features Tables

| Table | Purpose | Seeded |
|-------|---------|--------|
| `pipeline_stages` | CI/CD stage definitions | ✅ |
| `pipeline_runs` | CI/CD run history | ❌ (future) |
| `business_impact_metrics` | Quality-to-business correlation | ✅ |
| `test_cases` | Test case definitions | ✅ |
| `test_case_tags` | Test categorization | ✅ |
| `flaky_tests` | Flaky test tracking | ✅ |
| `test_execution_runs` | Test run history | ✅ |
| `performance_metrics` | API performance data | ✅ |
| `technical_debt` | Tech debt inventory | ✅ |

### Manual Input Tables

| Table | Purpose | Seeded |
|-------|---------|--------|
| `kpi_snapshots` | Team KPI history | ❌ Manual |
| `developer_metrics` | Developer productivity | ❌ Manual |

---

## File Locations

- **Metrics Sync Jobs:** `/server/jobs/intervalSync.ts`
- **Analytics Sync Job:** `/server/jobs/analyticsSync.ts`
- **Analytics API Routes:** `/server/routes/analytics.ts`
- **Settings API (manual triggers):** `/server/routes/settings.ts`
