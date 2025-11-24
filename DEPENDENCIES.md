# QA Dashboard - System Dependencies

This document lists all external systems, tools, plugins, and integrations required to collect metrics for the QA Dashboard in a production environment.

---

## Table of Contents
1. [Core Systems](#core-systems)
2. [CI/CD Tools](#cicd-tools)
3. [Code Quality & Analysis](#code-quality--analysis)
4. [Issue Tracking & Project Management](#issue-tracking--project-management)
5. [Version Control](#version-control)
6. [Monitoring & Observability](#monitoring--observability)
7. [Test Management](#test-management)
8. [Optional Enhancements](#optional-enhancements)
9. [Infrastructure Requirements](#infrastructure-requirements)
10. [Setup Checklist](#setup-checklist)

---

## Core Systems

### 1. **Jira** (Required)
**Purpose:** Issue tracking, sprint management, story points, bug tracking  
**Metrics Provided:**
- ProductionBugs
- StoryPointsCompleted
- DefectEscapeRate
- Sprint Velocity
- Sprint Commitment Rate
- Sprint Carryover
- First-Time Pass Rate

**Required Configuration:**
- Story points custom field (usually `customfield_10016`)
- Bug issue type configured
- Labels: `production`, `staging`, `dev`
- Sprint board configured
- Workflow with statuses: `To Do`, `In Progress`, `In QA`, `Done`

**API Access:**
- REST API v3: `https://your-domain.atlassian.net/rest/api/3/`
- Authentication: API Token or OAuth 2.0
- Required permissions: Read issues, Read projects, Read boards

**Alternative:** Azure DevOps, Linear, Shortcut (requires adapter)

---

### 2. **Jenkins** (Required for CI/CD)
**Purpose:** Continuous Integration, build automation, test execution  
**Metrics Provided:**
- BuildTimeMinutes
- FailedBuildRate
- TestTimeMinutes
- Test Coverage (via plugins)
- Deployment Frequency

**Required Plugins:**
1. **JUnit Plugin** - Parse test results
   - Install: `Manage Jenkins > Manage Plugins > Available > JUnit`
   - Purpose: Parse JUnit XML test reports
   
2. **Cobertura Plugin** OR **JaCoCo Plugin** - Code coverage
   - Cobertura: For Python, Ruby, JavaScript
   - JaCoCo: For Java, Kotlin
   - Install: `Manage Jenkins > Manage Plugins > Available > Cobertura/JaCoCo`
   - Purpose: Publish coverage reports
   
3. **Pipeline Plugin** - Pipeline as code
   - Usually pre-installed
   - Purpose: Define build pipelines
   
4. **Test Results Analyzer Plugin** - Test trend analysis
   - Install: `Manage Jenkins > Manage Plugins > Available > Test Results Analyzer`
   - Purpose: Track test flakiness and trends
   
5. **Build Failure Analyzer Plugin** - Categorize failures
   - Install: `Manage Jenkins > Manage Plugins > Available > Build Failure Analyzer`
   - Purpose: Identify failure patterns

**API Access:**
- REST API: `https://jenkins.company.com/api/json`
- Authentication: API Token
- Required permissions: Read builds, Read test results

**Alternative:** CircleCI, GitHub Actions, GitLab CI, Travis CI

---

### 3. **SonarQube** (Required)
**Purpose:** Code quality analysis, technical debt tracking  
**Metrics Provided:**
- SonarDebt_minutes
- LOC (Lines of Code)
- CyclomaticComplexity
- CodeQualityScore
- Test Coverage (alternative source)
- Code Smells, Bugs, Vulnerabilities

**Required Edition:**
- Community Edition (free) - Basic metrics
- Developer Edition ($$ - Recommended for branch analysis
- Enterprise Edition ($$$ - For portfolio management

**Required Configuration:**
- Project key configured
- Quality gate defined
- Scanner integrated in CI/CD pipeline
- Branch analysis enabled (Developer+ edition)

**Scanner Integration:**
```bash
# For Maven projects
mvn sonar:sonar \
  -Dsonar.projectKey=my-project \
  -Dsonar.host.url=https://sonarqube.company.com \
  -Dsonar.login=$SONAR_TOKEN

# For JavaScript/TypeScript
sonar-scanner \
  -Dsonar.projectKey=my-project \
  -Dsonar.sources=src \
  -Dsonar.host.url=https://sonarqube.company.com \
  -Dsonar.login=$SONAR_TOKEN
```

**API Access:**
- REST API: `https://sonarqube.company.com/api/`
- Authentication: User Token
- Key endpoints:
  - `/api/measures/component` - Get metrics
  - `/api/qualitygates/project_status` - Quality gate status
  - `/api/issues/search` - Search issues

**Alternative:** SonarCloud (SaaS), CodeClimate, Codacy

---

## CI/CD Tools

### 4. **CircleCI** (Alternative to Jenkins)
**Purpose:** Cloud-based CI/CD  
**Metrics Provided:** Same as Jenkins

**Required Configuration:**
- `.circleci/config.yml` in repository
- Test results stored as artifacts
- Coverage reports uploaded

**API Access:**
- REST API: `https://circleci.com/api/v2/`
- Authentication: Personal API Token
- Key endpoints:
  - `/project/{vcs}/{org}/{repo}` - Project builds
  - `/project/{vcs}/{org}/{repo}/{buildNum}/artifacts` - Build artifacts

---

### 5. **GitHub Actions** (Alternative to Jenkins)
**Purpose:** GitHub-native CI/CD  
**Metrics Provided:** Same as Jenkins

**Required Configuration:**
- `.github/workflows/*.yml` workflow files
- Test results uploaded as artifacts
- Coverage reports uploaded to Codecov/Coveralls

**API Access:**
- REST API: `https://api.github.com/`
- Authentication: Personal Access Token or GitHub App
- Key endpoints:
  - `/repos/{owner}/{repo}/actions/runs` - Workflow runs
  - `/repos/{owner}/{repo}/actions/runs/{run_id}` - Run details

---

## Code Quality & Analysis

### 6. **Git** (Required)
**Purpose:** Version control, change tracking  
**Metrics Provided:**
- ChangeFrequency
- CommitCount
- LinesChanged

**Required Setup:**
- Repository access (read permissions)
- Git CLI installed on metrics collection server
- SSH keys or HTTPS credentials configured

**Commands Used:**
```bash
# Change frequency
git log --since="30 days ago" --format="%H" -- {file} | wc -l

# Commit count
git log --grep="PROJ-123" --format="%H" | wc -l

# Lines changed
git log --grep="PROJ-123" --numstat --format="" | awk '{add+=$1; del+=$2} END {print add+del}'
```

---

### 7. **GitHub** OR **GitLab** (Required)
**Purpose:** Git hosting, pull request management  
**Metrics Provided:**
- PRDurationHours
- Code review metrics
- Commit metadata

**GitHub API Access:**
- REST API: `https://api.github.com/`
- Authentication: Personal Access Token
- Key endpoints:
  - `/repos/{owner}/{repo}/pulls` - Pull requests
  - `/repos/{owner}/{repo}/commits` - Commits
  - `/repos/{owner}/{repo}/issues` - Issues (if not using Jira)

**GitLab API Access:**
- REST API: `https://gitlab.com/api/v4/`
- Authentication: Personal Access Token
- Key endpoints:
  - `/projects/{id}/merge_requests` - Merge requests
  - `/projects/{id}/repository/commits` - Commits

---

## Monitoring & Observability

### 8. **PagerDuty** (Required for MTTR)
**Purpose:** Incident management, on-call scheduling  
**Metrics Provided:**
- MTTR_incidents
- MTTR_pipeline
- IncidentCount
- MTBF

**Required Configuration:**
- Services configured for each team/application
- Incident tagging: `pipeline`, `production`, `critical`
- Integration with monitoring tools (Datadog, New Relic)

**API Access:**
- REST API: `https://api.pagerduty.com/`
- Authentication: API Token
- Key endpoints:
  - `/incidents` - List incidents
  - `/incidents/{id}` - Incident details

**Alternative:** Opsgenie, VictorOps, Jira Service Management

---

### 9. **Datadog** OR **New Relic** (Required for Performance)
**Purpose:** Application performance monitoring, system uptime  
**Metrics Provided:**
- ResponseTime_P50, P95, P99
- Throughput
- ErrorRate
- SystemUptime
- MTBF

**Datadog Configuration:**
- APM enabled for applications
- Custom metrics configured
- Monitors set up for uptime tracking

**Datadog API Access:**
- REST API: `https://api.datadoghq.com/api/v1/`
- Authentication: API Key + Application Key
- Key endpoints:
  - `/metrics` - Query metrics
  - `/monitor/uptime` - Uptime data

**New Relic Configuration:**
- APM agent installed in applications
- Custom attributes configured
- Alerts configured

**New Relic API Access:**
- REST API: `https://api.newrelic.com/v2/`
- Authentication: API Key
- Key endpoints:
  - `/applications/{id}/metrics` - Application metrics

**Alternative:** Prometheus + Grafana, AppDynamics, Dynatrace

---

### 10. **Prometheus** (Optional - Alternative Monitoring)
**Purpose:** Time-series metrics collection  
**Metrics Provided:**
- Custom application metrics
- System performance metrics
- Service uptime

**Required Configuration:**
- Prometheus server deployed
- Exporters configured (node_exporter, application exporters)
- Scrape configs for targets
- Grafana for visualization (recommended)

**Query Language:**
```promql
# Example queries
rate(http_requests_total[5m])  # Request rate
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))  # P95 latency
```

**API Access:**
- HTTP API: `http://prometheus:9090/api/v1/`
- Key endpoints:
  - `/query` - Instant queries
  - `/query_range` - Range queries

---

## Test Management

### 11. **Test Coverage Tools**

#### **Jest + Istanbul** (JavaScript/TypeScript)
**Purpose:** Unit testing and coverage for JS/TS  
**Metrics Provided:** TestCoverage

**Installation:**
```bash
npm install --save-dev jest
```

**Configuration (`jest.config.js`):**
```javascript
module.exports = {
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['json-summary', 'lcov', 'text'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  }
};
```

**Output:** `coverage/coverage-summary.json`

---

#### **JaCoCo** (Java)
**Purpose:** Code coverage for Java  
**Metrics Provided:** TestCoverage

**Maven Configuration (`pom.xml`):**
```xml
<plugin>
  <groupId>org.jacoco</groupId>
  <artifactId>jacoco-maven-plugin</artifactId>
  <version>0.8.10</version>
  <executions>
    <execution>
      <goals>
        <goal>prepare-agent</goal>
      </goals>
    </execution>
    <execution>
      <id>report</id>
      <phase>test</phase>
      <goals>
        <goal>report</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

**Output:** `target/site/jacoco/jacoco.xml`

---

#### **Coverage.py** (Python)
**Purpose:** Code coverage for Python  
**Metrics Provided:** TestCoverage

**Installation:**
```bash
pip install coverage pytest-cov
```

**Usage:**
```bash
pytest --cov=src --cov-report=json --cov-report=html
```

**Output:** `coverage.json`

---

### 12. **Test Analytics Platforms** (Optional)

#### **BuildPulse**
**Purpose:** Flaky test detection and analytics  
**Metrics Provided:** FlakyTestRate, test trends

**Integration:** Upload JUnit XML to BuildPulse after each build

---

#### **Launchable**
**Purpose:** Predictive test selection, flaky test detection  
**Metrics Provided:** FlakyTestRate, test optimization

**Integration:** Launchable CLI in CI pipeline

---

## Optional Enhancements

### 13. **Codecov** OR **Coveralls** (Coverage Hosting)
**Purpose:** Coverage report hosting and PR comments  
**Metrics Provided:** TestCoverage (alternative source)

**Codecov Setup:**
```yaml
# .codecov.yml
coverage:
  status:
    project:
      default:
        target: 70%
    patch:
      default:
        target: 80%
```

**API Access:**
- REST API: `https://codecov.io/api/v2/`
- Authentication: Token
- Endpoint: `/repos/{owner}/{repo}/coverage`

---

### 14. **Sentry** OR **Rollbar** (Error Tracking)
**Purpose:** Production error monitoring  
**Metrics Provided:** ProductionBugs (alternative source), ErrorRate

**Sentry Configuration:**
```javascript
Sentry.init({
  dsn: 'https://...@sentry.io/...',
  environment: 'production',
  release: process.env.RELEASE_VERSION
});
```

**API Access:**
- REST API: `https://sentry.io/api/0/`
- Authentication: Auth Token
- Endpoint: `/projects/{org}/{project}/issues/`

---

### 15. **Zendesk** OR **Intercom** (Customer Support)
**Purpose:** Customer-reported bugs  
**Metrics Provided:** ProductionBugs (customer-reported)

**Zendesk API:**
- REST API: `https://{subdomain}.zendesk.com/api/v2/`
- Authentication: API Token
- Endpoint: `/search.json?query=type:ticket tags:bug`

---

## Infrastructure Requirements

### **Metrics Collection Server**

**Minimum Specifications:**
- **CPU:** 2 cores
- **RAM:** 4 GB
- **Storage:** 50 GB
- **OS:** Linux (Ubuntu 20.04+ or CentOS 8+)

**Required Software:**
- Node.js 18+ (for metrics aggregation scripts)
- Python 3.9+ (for data processing)
- Git CLI
- curl/wget
- PostgreSQL 14+ OR MySQL 8+ (for metrics storage)

**Network Requirements:**
- Outbound HTTPS (443) to all external APIs
- Access to internal Jenkins, SonarQube, Jira instances
- SSH access to Git repositories (port 22)

---

### **Database**

**PostgreSQL (Recommended):**
```sql
CREATE DATABASE qa_metrics;
CREATE USER qa_dashboard WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE qa_metrics TO qa_dashboard;
```

**Tables Needed:**
- `teams` - Team metadata
- `metrics_history` - Time-series metrics data
- `builds` - Build history
- `incidents` - Incident history
- `sprints` - Sprint data

---

### **Scheduled Jobs**

**Cron Jobs for Metrics Collection:**
```cron
# Collect metrics every hour
0 * * * * /opt/qa-dashboard/scripts/collect-metrics.sh

# Daily aggregation at 2 AM
0 2 * * * /opt/qa-dashboard/scripts/daily-aggregation.sh

# Weekly reports on Monday at 9 AM
0 9 * * 1 /opt/qa-dashboard/scripts/weekly-report.sh
```

---

## Setup Checklist

### Phase 1: Core Dependencies (Week 1)
- [ ] Jira access configured
  - [ ] API token generated
  - [ ] Story points field identified
  - [ ] Labels configured (production, staging, dev)
- [ ] Jenkins access configured
  - [ ] API token generated
  - [ ] Required plugins installed (JUnit, Cobertura/JaCoCo)
  - [ ] Test results publishing enabled
- [ ] SonarQube configured
  - [ ] Project created
  - [ ] Scanner integrated in CI
  - [ ] Quality gate defined
  - [ ] API token generated

### Phase 2: Version Control (Week 1)
- [ ] Git repository access
  - [ ] SSH keys configured
  - [ ] Read permissions verified
- [ ] GitHub/GitLab API access
  - [ ] Personal access token generated
  - [ ] PR data accessible

### Phase 3: Monitoring (Week 2)
- [ ] PagerDuty integration
  - [ ] API token generated
  - [ ] Services configured
  - [ ] Incident tagging standardized
- [ ] APM tool configured (Datadog/New Relic)
  - [ ] API keys generated
  - [ ] Metrics accessible
  - [ ] Uptime monitors configured

### Phase 4: Test Coverage (Week 2)
- [ ] Coverage tools configured
  - [ ] Jest/JaCoCo/Coverage.py installed
  - [ ] Coverage reports generated
  - [ ] Reports uploaded to CI
- [ ] Coverage thresholds defined
  - [ ] Minimum coverage: 70%
  - [ ] PR coverage delta: +0%

### Phase 5: Infrastructure (Week 3)
- [ ] Metrics collection server provisioned
  - [ ] Node.js installed
  - [ ] Python installed
  - [ ] Git CLI installed
- [ ] Database configured
  - [ ] PostgreSQL installed
  - [ ] Schema created
  - [ ] Backup configured
- [ ] Scheduled jobs configured
  - [ ] Hourly metrics collection
  - [ ] Daily aggregation
  - [ ] Weekly reports

### Phase 6: Validation (Week 4)
- [ ] Test data collection for each metric
- [ ] Verify API access to all systems
- [ ] Run end-to-end metrics collection
- [ ] Validate data accuracy
- [ ] Set up monitoring for collection jobs
- [ ] Document any custom configurations

---

## API Token Security

**Best Practices:**
1. Store tokens in environment variables or secrets manager (AWS Secrets Manager, HashiCorp Vault)
2. Never commit tokens to Git
3. Rotate tokens quarterly
4. Use service accounts with minimal permissions
5. Enable IP whitelisting where possible
6. Monitor API usage for anomalies

**Example `.env` file:**
```bash
JIRA_API_TOKEN=xxxxxxxxxxxxx
JENKINS_API_TOKEN=xxxxxxxxxxxxx
SONAR_TOKEN=xxxxxxxxxxxxx
GITHUB_TOKEN=xxxxxxxxxxxxx
PAGERDUTY_TOKEN=xxxxxxxxxxxxx
DATADOG_API_KEY=xxxxxxxxxxxxx
DATADOG_APP_KEY=xxxxxxxxxxxxx
```

---

## Troubleshooting

### Common Issues

**Issue:** SonarQube metrics not updating  
**Solution:** Check scanner execution in CI logs, verify project key matches

**Issue:** Jenkins coverage reports missing  
**Solution:** Verify Cobertura/JaCoCo plugin installed, check coverage file path in Jenkins config

**Issue:** Jira API rate limiting  
**Solution:** Implement exponential backoff, cache results, reduce query frequency

**Issue:** Git commands timing out  
**Solution:** Use shallow clones (`--depth=1`), increase timeout values

**Issue:** PagerDuty incidents missing  
**Solution:** Verify incident tagging, check date range in API query

---

**Document Version:** 1.0  
**Last Updated:** November 24, 2025  
**Maintained By:** QA Dashboard Team
