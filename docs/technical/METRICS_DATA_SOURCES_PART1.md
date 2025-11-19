# 📊 IronGate QA Navigator - Metrics & Data Sources (Part 1)

## Complete Mapping of Features to Real API Metrics

This document provides exact API endpoints and metrics for each feature.

---

## 🎯 Core Dashboard (22 KPIs)

### Quality & Testing Metrics

#### 1. **Test Coverage**
**Source**: SonarQube API
```
GET /api/measures/component?component={key}&metricKeys=coverage
Response: {"measures": [{"metric": "coverage", "value": "85.3"}]}
```

#### 2. **Flakiness Rate**
**Source**: Jenkins Test Results
```
GET /job/{name}/lastBuild/testReport/api/json
Calculate: (Flaky Tests / Total Tests) * 100
```

#### 3. **Defect Density**
**Source**: Jira + SonarQube
```
Jira: GET /rest/api/3/search?jql=issuetype=Bug
SonarQube: GET /api/measures/component?metricKeys=ncloc
Calculate: (Bugs / Lines of Code) * 1000
```

#### 4. **Defect Escape Rate**
**Source**: Jira
```
GET /rest/api/3/search?jql=environment=Production AND issuetype=Bug
Calculate: (Production Bugs / Total Bugs) * 100
```

#### 5. **Code Quality Score**
**Source**: SonarQube
```
GET /api/measures/component?metricKeys=sqale_rating,reliability_rating,security_rating
Convert ratings to numeric score (A=100, B=80, C=60, D=40, E=20)
```

### Speed & Efficiency Metrics

#### 6. **Build Time**
**Source**: Jenkins
```
GET /job/{name}/lastBuild/api/json
Field: duration (milliseconds)
```

#### 7. **Test Execution Time**
**Source**: Jenkins Test Results
```
GET /job/{name}/lastBuild/testReport/api/json
Field: duration (seconds)
```

#### 8. **Deployment Frequency**
**Source**: Jenkins Deployment Jobs
```
GET /job/{deployment_job}/api/json?tree=builds[timestamp,result]
Count successful deployments per time period
```

#### 9. **Lead Time for Changes**
**Source**: GitHub + Jenkins
```
GitHub: GET /repos/{owner}/{repo}/pulls/{number}
Calculate: Deployment Time - PR Created Time
```

#### 10. **MTTR**
**Source**: Jira
```
GET /rest/api/3/search?jql=issuetype=Bug AND status=Closed
Calculate: Average(resolved_date - created_date)
```

#### 11. **Parallel Test Efficiency**
**Source**: Jenkins Pipeline
```
GET /job/{name}/lastBuild/wfapi/describe
Calculate: (Sequential Time / Parallel Time) * 100
```

### Agile & Process Metrics

#### 12. **Sprint Velocity**
**Source**: Jira Agile
```
GET /rest/agile/1.0/sprint/{sprintId}/issue
Sum story points for completed issues
```

#### 13. **Sprint Commitment Rate**
**Source**: Jira Sprint
```
GET /rest/agile/1.0/sprint/{sprintId}
Calculate: (Completed Points / Committed Points) * 100
```

#### 14. **Sprint Carryover**
**Source**: Jira
```
GET /rest/agile/1.0/board/{boardId}/sprint/{sprintId}/issue
Calculate: (Incomplete Issues / Total Issues) * 100
```

#### 15. **First-Time Pass Rate**
**Source**: Jenkins
```
GET /job/{name}/api/json?tree=builds[result]
Calculate: (First-Time Success / Total Builds) * 100
```

#### 16. **Blocked Time**
**Source**: Jira Changelog
```
GET /rest/api/3/issue/{key}/changelog
Sum time in "Blocked" status
```

#### 17. **Test Automation Coverage**
**Source**: TestRail
```
GET /index.php?/api/v2/get_cases/{project_id}
Calculate: (Automated Tests / Total Tests) * 100
```

#### 18. **Automation ROI**
**Source**: Jenkins + Time Tracking
```
Calculate: (Time Saved * Rate - Cost) / Cost * 100
```

### Reliability & Stability Metrics

#### 19. **Change Failure Rate**
**Source**: Jenkins
```
GET /job/{deployment_job}/api/json?tree=builds[result]
Calculate: (Failed Deployments / Total) * 100
```

#### 20. **MTBF**
**Source**: Datadog/New Relic
```
Datadog: GET /api/v1/monitor
Calculate: Total Uptime / Number of Failures
```

#### 21. **System Availability**
**Source**: Monitoring Tools
```
Datadog: GET /api/v1/monitor/{id}
Calculate: (Total Time - Downtime) / Total Time * 100
```

#### 22. **Infrastructure Failures**
**Source**: Jenkins + Logs
```
GET /job/{name}/api/json?tree=builds[result,actions[causes]]
Count infrastructure-related failures
```

---

## 🚀 Feature #1: Flaky Test Intelligence

### Required Metrics

**1. Test Execution History**
- Source: Jenkins `/job/{name}/lastBuild/testReport/api/json`
- Fields: test name, status, duration, timestamp

**2. Flakiness Score**
- Calculate: (Status Changes / Total Runs) * 100
- Track last 100 executions per test

**3. Failure Pattern**
- Analyze error messages for keywords:
  - Timing: "timeout", "wait"
  - Environment: "connection", "network"
  - Data: "null", "assertion"
  - Network: "socket", "http"

**4. Historical Data (20 days)**
- Jenkins: Get daily test results
- Create pass/fail timeline

**5. Suggested Fixes**
- Pattern-based recommendations
- Stored in configuration

---

## 🚀 Feature #2: Technical Debt Tracker

### Required Metrics

**1. Debt Items**
- Source: SonarQube `/api/issues/search`
- Types: CODE_SMELL, BUG, VULNERABILITY
- Fields: severity, debt time, creation date

**2. Estimated Effort**
- Source: SonarQube `sqale_index` metric
- Convert minutes to hours

**3. Cost of Delay**
- Calculate: Severity Weight * Days Open
- Weights: BLOCKER=$1000/day, CRITICAL=$500/day, MAJOR=$200/day

**4. Priority Score**
- Formula: (Impact / Effort) * Urgency
- Impact from severity, Effort from debt time

**5. Categories**
- Map SonarQube types to categories:
  - CODE_SMELL → code_quality
  - BUG → testing
  - VULNERABILITY → security

---

## 🚀 Feature #3: CI/CD Pipeline Visualization

### Required Metrics

**1. Pipeline Stages**
- Source: Jenkins `/job/{name}/lastBuild/wfapi/describe`
- Fields: stage name, duration, status, start time

**2. Stage Duration**
- From wfapi: durationMillis per stage
- Track trends over 30 builds

**3. Success Rate**
- Calculate per stage: (Successful / Total) * 100

**4. Resource Usage**
- Source: Datadog `/api/v1/metrics/query`
- Metrics: CPU, memory during execution
- Calculate cost: Duration * Resource Rate

**5. Bottleneck Score**
- Formula: (Stage Duration / Total Duration) * 100
- Flag if > 40%

---

## 🚀 Feature #4: Business Impact Correlation

### Required Metrics

**1. Quality Score**
- Aggregate: Test Coverage (30%) + Defect Density (25%) + Code Quality (25%) + Build Success (20%)

**2. Revenue Impact**
- Source: Jira incidents + Business analytics
- Calculate: Downtime * Revenue Rate * Affected Users %

**3. Customer Satisfaction (NPS)**
- Source: Zendesk/Salesforce satisfaction ratings
- Formula: % Promoters - % Detractors

**4. Feature Adoption Rate**
- Source: Google Analytics/Mixpanel
- Calculate: (Active Users / Total Users) * 100

**5. Correlation Strength**
- Pearson coefficient: r = Σ((x-x̄)(y-ȳ)) / √(Σ(x-x̄)² * Σ(y-ȳ)²)
- Track quality vs business metrics over time

---

## 🚀 Feature #5: Performance Testing Metrics

### Required Metrics

**1. Response Time Percentiles**
- Source: New Relic `/v2/applications/{id}/metrics/data.json`
- Or Datadog: `p50:trace.web.request`, `p95:trace.web.request`, `p99:trace.web.request`

**2. Throughput**
- Source: Datadog `sum:nginx.requests.per_second`
- Or AWS CloudWatch: RequestCount metric

**3. Error Rate**
- Source: New Relic Errors/all metric
- Calculate: (Errors / Total Requests) * 100

**4. Load Test Results**
- Source: JMeter CSV, k6 JSON, Gatling reports
- Parse: response times, throughput, errors at different load levels

**5. Endpoint Metrics**
- Source: New Relic `/v2/applications/{id}/transactions.json`
- Track per endpoint: response time, throughput, error rate

---

See METRICS_DATA_SOURCES_PART2.md for remaining features...
