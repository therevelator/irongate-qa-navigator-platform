# 🎯 IronGate QA Navigator - Complete Backend Implementation Guide

## 1. System Overview

### Purpose
Multi-source QA metrics aggregation platform consolidating data from Jenkins, Jira, SonarQube, GitHub, TestRail, and Datadog for real-time quality insights.

### Architecture
```
MasterDataAggregator
├── JenkinsAggregator (Build, Test, Pipeline)
├── JiraAggregator (Sprint, Defects)
├── SonarQubeAggregator (Quality, Tech Debt)
└── GitHubAggregator (PR Metrics)
```

---

## 2. Core Metrics & Formulas

### QA Score (Master Metric)
```
QA Score = (
  Test Coverage × 0.30 +
  (100 - Defect Escape Rate) × 0.25 +
  Build Success Rate × 0.25 +
  Code Quality Score × 0.20
)
Range: 0-100
```

### 22 Dashboard KPIs

#### Quality & Reliability
1. **Test Coverage**: `(Covered Lines / Total Lines) × 100` | Source: SonarQube
2. **Flakiness Rate**: `(Flaky Tests / Total Tests) × 100` | Source: Jenkins history
3. **Defect Density**: `(Defects / LOC) × 1000` | Source: Jira + SonarQube
4. **Defect Escape Rate**: `(Prod Defects / Total Defects) × 100` | Source: Jira
5. **Code Quality Score**: Weighted SonarQube ratings | Source: SonarQube

#### Speed & Efficiency
6. **Build Time**: `Avg(build_duration)` last 50 builds | Source: Jenkins
7. **Test Execution Time**: `test_duration / 60000` ms→min | Source: Jenkins
8. **Deployment Frequency**: `Count(prod_deploys_last_7d)` | Source: Jenkins
9. **MTTR**: `Avg(resolved_at - created_at)` | Source: Jira incidents
10. **Pipeline Efficiency**: `(Build+Test+Deploy) / Total × 100` | Source: Jenkins

#### Agile & Planning
11. **Sprint Velocity**: `Sum(story_points WHERE status=Done)` | Source: Jira
12. **Commitment Rate**: `(Completed / Committed) × 100` | Source: Jira
13. **Carryover Rate**: `(Incomplete / Total) × 100` | Source: Jira
14. **Blocked Time**: `Sum(time_in_blocked)` hours | Source: Jira
15. **Cycle Time**: `Avg(done_at - in_progress_at)` days | Source: Jira

#### Reliability & Stability
16. **Build Success Rate**: `(Success / Total) × 100` | Source: Jenkins
17. **Test Pass Rate**: `(Passed / Total) × 100` | Source: Jenkins
18. **Production Incidents**: `Count(P1/P2 last 7d)` | Source: Jira
19. **Change Failure Rate**: `(Failed Deploys / Total) × 100` | Source: Jenkins
20. **Automation Rate**: `(Automated / Total Tests) × 100` | Source: TestRail

#### Developer Productivity
21. **PR Merge Time**: `Avg(merged_at - created_at)` hours | Source: GitHub
22. **Code Review Time**: `Avg(first_review - created_at)` hours | Source: GitHub

---

## 3. Advanced Feature Calculations

### Flaky Test Detection
```javascript
function detectFlakyTests(testHistory) {
  for (test in testHistory) {
    runs = getLast10Runs(test);
    failures = countFailures(runs);
    
    if (failures > 0 && failures < 10) {
      flakiness_score = failures / 10;
      if (flakiness_score > 0.2) {
        markAsFlaky(test, flakiness_score);
      }
    }
  }
}
```

### Technical Debt Priority
```
Priority Score = (Severity Weight × Cost of Delay) / Effort

Severity Weights: Critical=10, High=7, Medium=4, Low=2
Cost of Delay = Days Since Created × Lines Affected × Team Size × 10
```

### Pipeline Bottleneck Detection
```javascript
function detectBottleneck(stages) {
  for (stage in stages) {
    percentage = stage.duration / total_duration;
    if (percentage > 0.40) {
      efficiency = stage.success_rate;
      severity = percentage × (1 - efficiency);
      return { stage: stage.name, severity };
    }
  }
}
```

### Business Impact
```
Revenue Impact = Defects × Avg Customer Value × Churn Rate
Quality-Speed Balance = (Quality Score + Velocity Score) / 2
```

### Performance Score
```
Performance = (
  Response Time Score × 0.4 +
  Throughput Score × 0.3 +
  Error Rate Score × 0.3
)

Response Time Score = 100 - (actual / target × 100)
Throughput Score = (actual_rps / target_rps) × 100
Error Rate Score = 100 - (errors / total × 100)
```

### Developer Productivity
```
Productivity = (
  Commit Frequency × 0.2 +
  PR Quality × 0.3 +
  Code Review Participation × 0.2 +
  Bug Fix Rate × 0.3
)

PR Quality = (1 - Revisions / Total PRs) × 100
Review Participation = Reviews Given / Reviews Received
```

### Gamification Points
```
Points = (
  Tests Written × 10 +
  Bugs Fixed × 15 +
  Code Reviews × 5 +
  Documentation × 8 +
  Quality Improvements × 20
)

Multipliers:
- Streak: +10% per consecutive day
- Team Target: +20%
- Zero Defects: +50%
```

---

## 4. API Integration Specs

### Jenkins
**Auth**: Basic (username:token)
```
GET /job/{job}/api/json → builds[]
GET /job/{job}/lastBuild/testReport/api/json → test results
GET /job/{job}/lastBuild/wfapi/describe → pipeline stages
```

### Jira
**Auth**: Basic (email:token)
```
GET /rest/agile/1.0/sprint/{id}/issue → sprint data
GET /rest/api/3/search?jql={query} → defects, incidents

JQL Examples:
- Bugs: "project=X AND issuetype=Bug"
- Prod: "project=X AND issuetype=Bug AND environment=Production"
- Sprint: "project=X AND sprint={id}"
```

### SonarQube
**Auth**: Token
```
GET /api/measures/component?component={key}&metricKeys=coverage,sqale_rating,reliability_rating,security_rating,code_smells,bugs,vulnerabilities,ncloc

GET /api/issues/search?componentKeys={key}&types=CODE_SMELL,BUG,VULNERABILITY
```

### GitHub
**Auth**: Bearer token
```
GET /repos/{owner}/{repo}/pulls?state=closed&per_page=100
GET /repos/{owner}/{repo}/pulls/{number}/reviews
```

---

## 5. Database Schema

### teams
```sql
CREATE TABLE teams (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  platform VARCHAR(100),
  department_id UUID,
  company_id UUID,
  jenkins_job VARCHAR(255),
  jira_project VARCHAR(50),
  sonar_project VARCHAR(255),
  github_repo VARCHAR(255),
  sprint_id VARCHAR(50),
  is_active BOOLEAN,
  created_at TIMESTAMP
);
```

### metrics_cache
```sql
CREATE TABLE metrics_cache (
  id UUID PRIMARY KEY,
  team_id UUID,
  metric_type VARCHAR(100),
  metric_data JSONB,
  calculated_at TIMESTAMP,
  expires_at TIMESTAMP
);
CREATE INDEX idx_team_metric ON metrics_cache(team_id, metric_type);
```

### metric_history
```sql
CREATE TABLE metric_history (
  id UUID PRIMARY KEY,
  team_id UUID,
  metric_name VARCHAR(100),
  metric_value DECIMAL(10,2),
  recorded_at TIMESTAMP
);
CREATE INDEX idx_team_metric_date ON metric_history(team_id, metric_name, recorded_at);
```

### flaky_tests
```sql
CREATE TABLE flaky_tests (
  id UUID PRIMARY KEY,
  team_id UUID,
  test_name VARCHAR(500),
  test_suite VARCHAR(255),
  flakiness_score DECIMAL(5,2),
  failure_count INT,
  total_runs INT,
  last_failure TIMESTAMP,
  root_cause VARCHAR(100)
);
```

### technical_debt
```sql
CREATE TABLE technical_debt (
  id UUID PRIMARY KEY,
  team_id UUID,
  external_id VARCHAR(255),
  title TEXT,
  category VARCHAR(50),
  severity VARCHAR(20),
  effort_hours DECIMAL(6,2),
  cost_of_delay DECIMAL(10,2),
  priority_score DECIMAL(6,2),
  status VARCHAR(50),
  created_at TIMESTAMP,
  resolved_at TIMESTAMP
);
```

---

## 6. Aggregator Implementation

### Master Aggregator Flow
```javascript
class MasterDataAggregator {
  async aggregateTeamMetrics(teamConfig) {
    // Parallel fetch from all sources
    const [build, test, pipeline, sprint, defect, quality, pr] = 
      await Promise.all([
        jenkins.getBuildMetrics(teamConfig.jenkinsJob),
        jenkins.getTestMetrics(teamConfig.jenkinsJob),
        jenkins.getPipelineMetrics(teamConfig.jenkinsJob),
        jira.getSprintMetrics(teamConfig.sprintId),
        jira.getDefectMetrics(teamConfig.jiraProject),
        sonarqube.getQualityMetrics(teamConfig.sonarProject),
        github.getPRMetrics(teamConfig.githubRepo)
      ]);
    
    // Calculate QA Score
    const qaScore = this.calculateQAScore({
      testCoverage: quality.coverage,
      defectEscapeRate: defect.defectEscapeRate,
      buildSuccessRate: build.successRate,
      codeQualityScore: quality.qualityScore
    });
    
    return {
      teamName: teamConfig.name,
      qaScore,
      buildMetrics: build,
      testMetrics: test,
      pipelineMetrics: pipeline,
      sprintMetrics: sprint,
      defectMetrics: defect,
      qualityMetrics: quality,
      prMetrics: pr,
      lastUpdated: new Date().toISOString()
    };
  }
  
  calculateQAScore(metrics) {
    return Math.round(
      metrics.testCoverage * 0.30 +
      (100 - metrics.defectEscapeRate) * 0.25 +
      metrics.buildSuccessRate * 0.25 +
      metrics.codeQualityScore * 0.20
    );
  }
}
```

---

## 7. Error Handling & Resilience

### Retry with Exponential Backoff
```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      
      if (response.status === 429) {
        await sleep(Math.pow(2, i) * 1000);
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(1000 * (i + 1));
    }
  }
}
```

### Circuit Breaker
```javascript
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failureCount = 0;
    this.threshold = threshold;
    this.state = 'CLOSED';
  }
  
  async execute(fn) {
    if (this.state === 'OPEN') {
      throw new Error('Circuit breaker OPEN');
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
}
```

### Fallback Strategy
```javascript
async function getMetricsWithFallback(teamId) {
  try {
    return await fetchRealTimeMetrics(teamId);
  } catch {
    const cached = await getCachedMetrics(teamId);
    if (cached && !isCacheExpired(cached)) return cached;
    return getMockMetrics(teamId);
  }
}
```

---

## 8. Caching Strategy

**Level 1: Redis (5 min TTL)** - Real-time metrics  
**Level 2: PostgreSQL (1 hour TTL)** - Historical data  
**Level 3: Mock Data** - Fallback when APIs unavailable - for demo purposes

```javascript
async function getMetrics(teamId) {
  // Check Redis
  const redis = await redisClient.get(`metrics:${teamId}`);
  if (redis) return JSON.parse(redis);
  
  // Check DB cache
  const db = await db.query(
    'SELECT * FROM metrics_cache WHERE team_id = $1 AND expires_at > NOW()',
    [teamId]
  );
  if (db.rows.length) return db.rows[0].metric_data;
  
  // Fetch fresh
  const fresh = await aggregator.aggregateTeamMetrics(teamId);
  
  // Cache in Redis (5 min)
  await redisClient.setex(`metrics:${teamId}`, 300, JSON.stringify(fresh));
  
  // Cache in DB (1 hour)
  await db.query(
    'INSERT INTO metrics_cache (team_id, metric_data, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'1 hour\')',
    [teamId, fresh]
  );
  
  return fresh;
}
```

---

## 9. Implementation Roadmap

**Phase 1 (Week 1-2)**: Core aggregator + Jenkins + Jira  
**Phase 2 (Week 3-4)**: SonarQube + Flaky tests + Tech debt  
**Phase 3 (Week 5-6)**: GitHub + PR metrics + Pipeline viz  
**Phase 4 (Week 7-8)**: Business impact + Gamification + Predictions  
**Phase 5 (Week 9-10)**: Optimization + Caching + Performance tuning

---

## 10. Environment Variables

```bash
# Jenkins
VITE_JENKINS_URL=https://jenkins.company.com
VITE_JENKINS_USER=admin
VITE_JENKINS_TOKEN=your_token

# Jira
VITE_JIRA_URL=https://company.atlassian.net
VITE_JIRA_EMAIL=admin@company.com
VITE_JIRA_TOKEN=your_token

# SonarQube
VITE_SONAR_URL=https://sonarqube.company.com
VITE_SONAR_TOKEN=your_token

# GitHub
VITE_GITHUB_TOKEN=ghp_your_token
VITE_GITHUB_ORG=your_org

# TestRail (Optional)
VITE_TESTRAIL_URL=https://company.testrail.io
VITE_TESTRAIL_EMAIL=admin@company.com
VITE_TESTRAIL_KEY=your_key

# Datadog (Optional)
VITE_DATADOG_API_KEY=your_api_key
VITE_DATADOG_APP_KEY=your_app_key
```

---

**End of Backend Implementation Guide**
