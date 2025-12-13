# Metrics Update and Seed Documentation

> **Last Updated:** December 13, 2025  
> **Location:** `server/jobs/intervalSync.ts`

## Overview

The IronGate QA Navigator uses an automated metrics synchronization system that updates all 23 KPI metrics at regular intervals. This document describes how metrics are seeded, updated, and synced across all teams.

---

## Sync Schedule

| Frequency | What Runs | When |
|-----------|-----------|------|
| **Startup** | Full sync (all 23 metrics) | 5 seconds after server start |
| **Every 5 min** | Pipeline stages seeder | `*/5 * * * *` |
| **Every Hour** | Full sync (all 23 metrics) | `0 * * * *` (at :00) |

---

## Real-Life Data Sources

### Where to Get Each Metric in Production

| Metric | Primary Source | API/Tool | Example Endpoint |
|--------|----------------|----------|------------------|
| `test_coverage` | **SonarQube** | SonarQube API | `GET /api/measures/component?metricKeys=coverage` |
| `test_flakiness_rate` | **Jenkins / CircleCI** | Test Reports | Parse JUnit XML for flaky patterns |
| `code_quality_score` | **SonarQube** | Quality Gate | `GET /api/qualitygates/project_status` |
| `defect_density` | **Jira + SonarQube** | Bugs ÷ LOC | Jira JQL + SonarQube ncloc |
| `defect_escape_rate` | **Jira** | Production bugs ÷ Total | JQL: `issuetype=Bug AND labels=production` |
| `avg_build_time_minutes` | **Jenkins** | Build API | `GET /job/{name}/lastBuild/api/json` → `duration` |
| `test_execution_time_minutes` | **Jenkins** | Test Report | JUnit report total time |
| `deployment_frequency_per_week` | **Jenkins / GitHub Actions** | Deployment jobs | Count deploys to prod in last 7 days |
| `lead_time_days` | **GitHub + Jenkins** | PR merge → deploy | Git commit timestamp to deploy timestamp |
| `mttr_hours` | **PagerDuty / Datadog** | Incident API | Mean time from alert to resolution |
| `parallel_test_efficiency` | **Jenkins** | Pipeline stages | Parallel stage duration ÷ sequential estimate |
| `sprint_velocity` | **Jira** | Sprint Report | `GET /rest/agile/1.0/board/{boardId}/sprint/{sprintId}/report` |
| `sprint_commitment_rate` | **Jira** | Sprint scope | Delivered points ÷ Committed points |
| `sprint_carryover` | **Jira** | Sprint Report | Issues moved to next sprint |
| `first_time_pass_rate` | **Jira / TestRail** | Test cycles | Tests passed on first run ÷ total |
| `blocked_time_hours` | **Jira** | Issue history | Time in "Blocked" status |
| `automation_coverage` | **TestRail / Xray** | Test cases | Automated tests ÷ total tests |
| `automation_roi` | **Calculated** | Manual formula | (Time saved × hourly rate) ÷ automation cost |
| `change_failure_rate` | **Jenkins + Jira** | DORA metric | Failed deploys ÷ total deploys |
| `mtbf_hours` | **Datadog / PagerDuty** | Incidents | Hours between failures |
| `system_availability` | **Datadog / New Relic** | Uptime monitoring | `(Total time - Downtime) ÷ Total time` |
| `infrastructure_failures` | **AWS CloudWatch / Datadog** | Alerts | Count of infra-related alerts |
| `sizing_accuracy` | **Jira** | Story points | Actual velocity ÷ estimated velocity |

---

## API Integration Examples

### SonarQube - Test Coverage & Code Quality

```bash
# Get test coverage
curl -u ${SONAR_TOKEN}: \
  "${SONAR_URL}/api/measures/component?component=${PROJECT_KEY}&metricKeys=coverage,ncloc,bugs,code_smells"

# Response
{
  "component": {
    "measures": [
      { "metric": "coverage", "value": "82.5" },
      { "metric": "ncloc", "value": "45000" },
      { "metric": "bugs", "value": "12" }
    ]
  }
}
```

### Jenkins - Build Time & Deployment Frequency

```bash
# Get last build info
curl -u ${JENKINS_USER}:${JENKINS_TOKEN} \
  "${JENKINS_URL}/job/${JOB_NAME}/lastBuild/api/json"

# Response
{
  "duration": 180000,  // milliseconds
  "result": "SUCCESS",
  "timestamp": 1702500000000
}
```

### Jira - Sprint Metrics & Defects

```bash
# Get sprint report
curl -u ${JIRA_EMAIL}:${JIRA_TOKEN} \
  "${JIRA_URL}/rest/agile/1.0/board/${BOARD_ID}/sprint/${SPRINT_ID}/report"

# Search for bugs
curl -u ${JIRA_EMAIL}:${JIRA_TOKEN} \
  "${JIRA_URL}/rest/api/3/search?jql=project=${PROJECT}%20AND%20issuetype=Bug"
```

### GitHub - Lead Time & Deployment Tracking

```bash
# Get merged PRs with deployment info
curl -H "Authorization: token ${GITHUB_TOKEN}" \
  "https://api.github.com/repos/${OWNER}/${REPO}/pulls?state=closed&per_page=100"

# Calculate lead time: merge_timestamp - first_commit_timestamp
```

### Datadog - MTTR & System Availability

```bash
# Get incidents
curl -H "DD-API-KEY: ${DD_API_KEY}" -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" \
  "https://api.datadoghq.com/api/v1/monitor?tags=team:${TEAM}"

# Get SLO status
curl -H "DD-API-KEY: ${DD_API_KEY}" -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" \
  "https://api.datadoghq.com/api/v1/slo/${SLO_ID}/history"
```

---

## Metrics Categories

### Hourly Metrics (2 metrics)
Updated every hour - these fluctuate frequently based on CI/CD activity.

| Metric | Generator | Range | Real Source |
|--------|-----------|-------|-------------|
| `avg_build_time_minutes` | `5 + random * 15` | 5-20 min | Jenkins/CircleCI build duration |
| `test_execution_time_minutes` | `20 + random * 40` | 20-60 min | JUnit/Jest test report |

### Daily Metrics (9 metrics)
Quality and performance metrics that change daily.

| Metric | Generator | Range | Target | Real Source |
|--------|-----------|-------|--------|-------------|
| `test_coverage` | `60 + random * 35` | 60-95% | >80% | SonarQube / Codecov |
| `test_flakiness_rate` | **Pipeline calc** | 0-15% | <2% | Pipeline runs analysis |
| `code_quality_score` | `70 + random * 25` | 70-95 | >85 | SonarQube quality gate |
| `lead_time_days` | `1 + random * 4` | 1-5 days | <3.5 | Git + Jenkins timestamps |
| `mttr_hours` | `2 + random * 8` | 2-10 hrs | <4 | PagerDuty / Opsgenie |
| `parallel_test_efficiency` | `70 + random * 25` | 70-95% | >85% | Jenkins parallel stages |
| `first_time_pass_rate` | `60 + random * 30` | 60-90% | >85% | TestRail / Xray |
| `blocked_time_hours` | `10 + random * 20` | 10-30 hrs | <15 | Jira issue history |
| `system_availability` | `99 + random * 0.9` | 99-99.9% | >99.9% | Datadog / New Relic SLO |

### Weekly Metrics (11 metrics)
Sprint and deployment metrics updated weekly.

| Metric | Generator | Range | Target | Real Source |
|--------|-----------|-------|--------|-------------|
| `defect_density` | `random * 1.5` | 0-1.5/1k | <0.5 | Jira bugs ÷ SonarQube LOC |
| `defect_escape_rate` | `random * 8` | 0-8% | <5% | Jira production bugs |
| `deployment_frequency_per_week` | `5 + random * 15` | 5-20 | >7 | Jenkins deploy jobs |
| `automation_coverage` | `60 + random * 35` | 60-95% | >70% | TestRail test cases |
| `change_failure_rate` | `random * 10` | 0-10% | <5% | Jenkins failed deploys |
| `mtbf_hours` | `80 + random * 80` | 80-160 | >100 | PagerDuty incidents |
| `infrastructure_failures` | `random * 8` | 0-8 | <3 | CloudWatch / Datadog |
| `sprint_velocity` | `30 + random * 30` | 30-60 pts | stable | Jira sprint report |
| `sprint_commitment_rate` | `75 + random * 20` | 75-95% | >90% | Jira delivered ÷ committed |
| `sprint_carryover` | `5 + random * 20` | 5-25% | <10% | Jira rollover issues |
| `sizing_accuracy` | `0.7 + random * 0.6` | 0.7-1.3x | ~1.0 | Jira actual ÷ estimate |

### Monthly Metrics (1 metric)

| Metric | Generator | Range | Real Source |
|--------|-----------|-------|-------------|
| `automation_roi` | `200 + random * 200` | 200-400% | (Hours saved × $75/hr) ÷ Investment |

---

## Test Flakiness Calculation

Unlike other metrics which use random generators, `test_flakiness_rate` is **calculated from actual pipeline data**:

```typescript
// Query pipeline_runs for test stages from last 7 days
SELECT ps.name, pr.status, pr.commit_sha, COUNT(*) as run_count
FROM pipeline_runs pr
JOIN pipeline_stages ps ON pr.stage_id = ps.id
WHERE ps.name IN ('Unit Tests', 'Integration Tests', 'E2E Tests')
  AND pr.started_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY ps.name, pr.status, pr.commit_sha
```

**Flakiness Detection Logic:**
1. Group test runs by commit SHA
2. Detect flaky tests = commits with BOTH passes and failures
3. Calculate: `(flaky_failures / total_runs) * 100`
4. Cap at 15% maximum

---

## Notifications

Each sync emits a WebSocket notification via `emitJobNotification()`:

```typescript
emitJobNotification({
  source: 'metrics',           // 'pipeline' | 'metrics' | 'analytics'
  frequency: 'hourly',         // '5-min' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'startup'
  message: 'Full metrics sync complete: 23 metrics updated',
  updatedMetrics: ['test_coverage', 'defect_density', ...],
  timestamp: '2025-12-13T21:30:00.000Z'
});
```

---

## QA Score Calculation

After every metric update, the QA Score is recalculated:

```typescript
qaScore = Math.round(
  test_coverage * 0.20 +
  automation_coverage * 0.15 +
  max(0, 100 - defect_density * 50) * 0.20 +
  code_quality_score * 0.15 +
  first_time_pass_rate * 0.15 +
  max(0, 100 - test_flakiness_rate * 10) * 0.15
);

status = qaScore >= 85 ? 'good' : qaScore >= 70 ? 'warning' : 'critical';
```

---

## Manual Data Protection

Teams with manually entered data are **excluded from auto-sync**:

1. Teams with `exclude_from_auto_sync = 1` in `teams` table
2. Teams with `manually_edited = 1` in `kpi_snapshots` table

---

## Environment Variables for Real Integration

```bash
# SonarQube
VITE_SONAR_URL=https://sonarqube.yourcompany.com
VITE_SONAR_TOKEN=squ_xxxxxxxxxxxx

# Jenkins
VITE_JENKINS_URL=https://jenkins.yourcompany.com
VITE_JENKINS_USER=your-username
VITE_JENKINS_TOKEN=your-api-token

# Jira
VITE_JIRA_URL=https://yourcompany.atlassian.net
VITE_JIRA_EMAIL=your-email@company.com
VITE_JIRA_TOKEN=your-api-token

# GitHub
VITE_GITHUB_TOKEN=ghp_xxxxxxxxxxxx
VITE_GITHUB_ORG=your-organization

# Datadog
VITE_DATADOG_API_KEY=your-api-key
VITE_DATADOG_APP_KEY=your-app-key
```

---

## File Locations

| File | Purpose |
|------|---------|
| `server/jobs/intervalSync.ts` | Main metric sync logic |
| `server/jobs/analyticsSync.ts` | Analytics data sync |
| `server/seeders/pipelineSeeder.ts` | Pipeline stages seeding |
| `server/eventBus.ts` | WebSocket notification types |

---

## Troubleshooting

### Metrics not updating?
1. Check if team has `manually_edited = 1` in kpi_snapshots
2. Check server logs for sync errors
3. Verify database connection

### Test flakiness showing 0?
1. Ensure pipeline_runs table has recent data
2. Check pipeline_stages has test stages

### Startup sync not running?
1. Check server logs for "[STARTUP]" message
2. Verify 5-second delay completed

---

## Complete Metrics Reference (Simple vs Composite)

This table shows where to get each metric from real systems (if simple) or how to calculate it (if composite).

### Simple Metrics (Direct API Calls)

| Metric | Type | Application | API Endpoint |
|--------|------|-------------|--------------|
| `test_coverage` | Simple | **SonarQube** | `GET /api/measures/component?component={key}&metricKeys=coverage` |
| `code_quality_score` | Simple | **SonarQube** | `GET /api/qualitygates/project_status?projectKey={key}` → convert A=100, B=80, C=60, D=40, E=20 |
| `avg_build_time_minutes` | Simple | **Jenkins** | `GET /job/{name}/lastBuild/api/json` → `duration / 60000` |
| `test_execution_time_minutes` | Simple | **Jenkins** | `GET /job/{name}/lastBuild/testReport/api/json` → `duration / 60000` |
| `sprint_velocity` | Simple | **Jira** | `GET /rest/agile/1.0/board/{boardId}/sprint/{sprintId}/report` → `completedIssuesEstimateSum` |
| `blocked_time_hours` | Simple | **Jira** | `GET /rest/api/3/issue/{issueKey}/changelog` → sum time in "Blocked" status |
| `infrastructure_failures` | Simple | **Datadog** | `GET /api/v1/events?tags=type:infrastructure` → count in period |
| `system_availability` | Simple | **Datadog** | `GET /api/v1/slo/{slo_id}/history` → `overall.sli_value` |
| `mtbf_hours` | Simple | **PagerDuty** | `GET /incidents?statuses[]=resolved` → avg hours between incidents |
| `mttr_hours` | Simple | **PagerDuty** | `GET /analytics/metrics/incidents/mean_time_to_resolve` |

### Composite Metrics (Calculated from Multiple Sources)

| Metric | Type | Formula | Data Sources |
|--------|------|---------|--------------|
| `defect_density` | **Composite** | `(Total Bugs / Lines of Code) × 1000` | **Jira:** `JQL: issuetype=Bug` → count<br/>**SonarQube:** `/api/measures?metricKeys=ncloc` → LOC |
| `defect_escape_rate` | **Composite** | `(Production Bugs / Total Bugs) × 100` | **Jira:** `JQL: issuetype=Bug AND labels=production` → prod count<br/>**Jira:** `JQL: issuetype=Bug` → total count |
| `test_flakiness_rate` | **Composite** | `(Flaky Failures / Total Test Runs) × 100` | **Jenkins:** Parse JUnit XML for tests that pass/fail on same commit<br/>**Internal:** `pipeline_runs` table analysis |
| `deployment_frequency_per_week` | **Composite** | `Count of production deploys in 7 days` | **Jenkins:** `GET /job/{deploy-job}/api/json` → filter by `timestamp` in last 7 days<br/>**GitHub Actions:** `GET /repos/{owner}/{repo}/actions/runs?event=push&branch=main` |
| `lead_time_days` | **Composite** | `(Deploy Timestamp - First Commit Timestamp) / 86400` | **GitHub:** `GET /repos/{owner}/{repo}/pulls/{number}` → `merged_at`<br/>**GitHub:** `GET /repos/{owner}/{repo}/pulls/{number}/commits` → first commit `date`<br/>**Jenkins:** Deploy job timestamp |
| `parallel_test_efficiency` | **Composite** | `(Sequential Estimate / Actual Parallel Duration) × 100` | **Jenkins:** `GET /job/{name}/lastBuild/wfapi/describe` → stage durations<br/>Sum individual stages vs. actual total duration |
| `first_time_pass_rate` | **Composite** | `(Tests Passed on First Run / Total Tests) × 100` | **TestRail:** `GET /get_runs/{project_id}` → filter by `untested_count = 0`<br/>**Xray:** `/rest/raven/1.0/testruns?testExecKey={key}` → status history |
| `automation_coverage` | **Composite** | `(Automated Test Cases / Total Test Cases) × 100` | **TestRail:** `GET /get_cases/{project_id}&type_id=3` (automated)<br/>**TestRail:** `GET /get_cases/{project_id}` (all) |
| `automation_roi` | **Composite** | `((Hours Saved × Hourly Rate) / Automation Investment) × 100` | **Manual Input:** Hours saved per run × runs per month<br/>**Manual Input:** Automation development + maintenance cost |
| `change_failure_rate` | **Composite** | `(Failed Deployments / Total Deployments) × 100` | **Jenkins:** `GET /job/{deploy-job}/api/json` → count `result=FAILURE`<br/>**Jira:** `JQL: issuetype=Incident AND labels=post-deploy` |
| `sprint_commitment_rate` | **Composite** | `(Delivered Points / Committed Points) × 100` | **Jira:** Sprint start: `GET /rest/agile/1.0/sprint/{sprintId}` → committed at start<br/>**Jira:** Sprint end: `/report` → `completedIssuesEstimateSum` |
| `sprint_carryover` | **Composite** | `(Unfinished Issues / Total Issues) × 100` | **Jira:** `GET /rest/agile/1.0/sprint/{sprintId}/report` → `issuesNotCompletedEstimateSum` |
| `sizing_accuracy` | **Composite** | `Actual Velocity / Estimated Velocity` | **Jira:** Actual from sprint report<br/>**Jira:** Estimate from sprint planning commitment |
| `qa_score` | **Composite** | `test_coverage×0.20 + automation_coverage×0.15 + (100-defect_density×50)×0.20 + code_quality×0.15 + first_time_pass×0.15 + (100-flakiness×10)×0.15` | All from `kpi_snapshots` table |
| `technical_debt_score` | **Composite** | `MIN(100, SUM(items × severity_weight))` where critical=20, high=10, medium=5, low=2 | `technical_debt` table |
| `dora_performance` | **Composite** | Elite: deploy≥7/wk + lead<1d + CFR<5% + MTTR<1h | `kpi_snapshots` table - deployment_frequency, lead_time, change_failure_rate, mttr_hours |
| `pipeline_health` | **Composite** | `AVG(success_rate) across all pipeline stages` | `pipeline_stages` table |
| `developer_happiness` | **Composite** | `100 - (meeting_burden×5) - (context_switch×3) + (focus_time_bonus×5)` | `developer_metrics` table |

---

## File Locations

| File | Purpose |
|------|---------|
| `server/jobs/intervalSync.ts` | Main metric sync logic |
| `server/jobs/analyticsSync.ts` | Analytics data sync |
| `server/seeders/pipelineSeeder.ts` | Pipeline stages seeding |
| `server/eventBus.ts` | WebSocket notification types |

---

## Troubleshooting

### Metrics not updating?
1. Check if team has `manually_edited = 1` in kpi_snapshots
2. Check server logs for sync errors
3. Verify database connection

### Test flakiness showing 0?
1. Ensure pipeline_runs table has recent data
2. Check pipeline_stages has test stages

### Startup sync not running?
1. Check server logs for "[STARTUP]" message
2. Verify 5-second delay completed

---

## Related Documentation

- [Pipeline Data Sources](./technical/METRICS_DATA_SOURCES_PART1.md)
- [KPI Formulas](./QUICK_START.md)
- [Manual Metrics Input](./FRONTEND_INTEGRATION_COMPLETE.md)
