# Georgel - Complete Metrics Documentation

## Table of Contents
1. [Core Team Metrics](#core-team-metrics)
2. [Quality & Testing Metrics](#quality--testing-metrics)
3. [Speed & Efficiency Metrics](#speed--efficiency-metrics)
4. [Agile & Process Metrics](#agile--process-metrics)
5. [Reliability Metrics](#reliability-metrics)
6. [Advanced Composite Metrics](#advanced-composite-metrics)
7. [Performance Testing Metrics](#performance-testing-metrics)

---

## Core Team Metrics

### 1. QA Score (Team Quality Score)

**Purpose:**  
Provides a single, at-a-glance health indicator for a team's overall quality posture. This is the "North Star" metric that executives and stakeholders use to quickly assess if a team is delivering quality software.

**Calculation Method:**  
```
QA Score = Weighted Average of:
  - Test Coverage (30%)
  - Defect Escape Rate (25%)
  - Code Quality Score (20%)
  - Test Flakiness Rate (15%)
  - MTTR (10%)

Formula:
QA Score = (Coverage × 0.3) + ((100 - DefectEscapeRate) × 0.25) + 
           (CodeQuality × 0.2) + ((100 - Flakiness) × 0.15) + 
           (MTTRScore × 0.1)

Where MTTRScore = 100 - (MTTR_hours / 24 × 100)
```

**Data Sources:**
- **Test Coverage**: Jest/Istanbul/Jacoco coverage reports via CI/CD
- **Defect Escape Rate**: Jira (production bugs / total bugs)
- **Code Quality**: SonarQube quality gate score
- **Flakiness**: CI test runner logs (flaky test count)
- **MTTR**: PagerDuty/Jira incident resolution times

**Business Purpose:**  
Enables leadership to:
- Quickly identify which teams need support or intervention
- Make informed decisions about release readiness
- Allocate resources to teams struggling with quality
- Track quality improvement trends over time
- Compare team performance across the organization

**Technical Purpose:**  
Helps engineering teams:
- Understand their quality standing relative to organizational goals
- Identify which quality dimension needs the most attention
- Justify investment in quality initiatives (tooling, training, refactoring)
- Celebrate wins when scores improve

**Extraction Method:**
```javascript
// Pseudo-code for production implementation
const qaScore = await calculateQAScore({
  // FROM: Jenkins/CircleCI coverage artifacts (coverage-summary.json)
  // API: GET /job/{name}/{buildNumber}/artifact/coverage/coverage-summary.json
  coverage: await getCoverageFromCI(teamId),
  
  // FROM: Jira - production bugs vs all bugs
  // JQL: (type=Bug AND labels=production) / (type=Bug)
  defectEscape: await getDefectEscapeRate(teamId),
  
  // FROM: SonarQube quality gate status
  // API: GET /api/qualitygates/project_status?projectKey={key}
  codeQuality: await getSonarQubeScore(teamId),
  
  // FROM: CI test runner logs (JUnit XML, pytest JSON)
  // Parse: <rerunFailure> tags or retry counts
  flakiness: await getFlakinessRate(teamId),
  
  // FROM: PagerDuty incidents
  // API: GET /incidents?since={date}&statuses[]=resolved
  // Calculate: (resolved_at - created_at) average
  mttr: await getMTTR(teamId)
});
```

**Usage in UI:**
- **Dashboard**: Large circular progress indicator with color coding (green >90, yellow 75-90, red <75)
- **Team List**: Compact circular badge next to each team name
- **Team Detail**: Prominent header metric with historical trend line
- **Alerts**: Triggers notifications when score drops below threshold

---

### 2. Technical Debt Score

**Purpose:**  
Quantifies the "invisible tax" that accumulated technical shortcuts, poor code quality, and process friction impose on development velocity. This metric answers: "How much is our past catching up with us?"

**Calculation Method:**  
```
Technical Debt Score = 
  (β1 × SonarDebtNormalized) +
  (β2 × HotspotRisk) +
  (β3 × PipelineFriction) +
  (β4 × BugDensity)

Where:
  β1 = 0.4  (SonarQube debt weight)
  β2 = 0.25 (Code hotspot weight)
  β3 = 0.2  (CI friction weight)
  β4 = 0.15 (Bug density weight)

Components:
  SonarDebtNormalized = (SonarDebt_minutes / LOC) × 1000
  HotspotRisk = ChangeFrequency × CyclomaticComplexity
  PipelineFriction = (FailedBuildRate × 2) + (FlakyTestRate × 1.5) + MTTR_pipeline
  BugDensity = ProductionBugs / StoryPointsCompleted
```

**Data Sources:**
- **SonarQube**: Technical debt minutes, lines of code, cyclomatic complexity
  - API: `GET /api/measures/component?metricKeys=sqale_index,ncloc,complexity`
- **Git Analytics**: Change frequency per file/module
  - Command: `git log --since="30 days ago" --format="%H" -- {file} | wc -l`
- **CI/CD**: Failed build rate, flaky test rate, pipeline MTTR
  - Jenkins/CircleCI build history APIs
- **Jira**: Production bugs, story points completed
  - JQL: `project = PROJ AND type = Bug AND labels = production`

**Business Purpose:**  
Enables stakeholders to:
- **Forecast Slowdowns**: Predict when velocity will decrease due to debt
- **Budget Planning**: Justify dedicated refactoring sprints with quantified debt
- **Risk Assessment**: Understand which teams/codebases are at highest risk of failure
- **ROI Calculation**: Measure return on investment for debt paydown initiatives
- **Strategic Planning**: Make informed build-vs-buy decisions based on codebase health

**Technical Purpose:**  
Helps engineering teams:
- **Prioritize Refactoring**: Identify highest-impact areas to clean up
- **Prevent Accumulation**: Catch debt early before it becomes unmanageable
- **Track Paydown**: Measure progress on debt reduction efforts
- **Onboarding Efficiency**: New engineers can identify risky areas to avoid
- **Architecture Decisions**: Guide microservice extraction or module boundaries

**Extraction Method:**
```javascript
import { calculateTechnicalDebtScore } from './utils/metricsAggregator';

const teamDebt = calculateTechnicalDebtScore(
  // FROM: SonarQube - technical debt in minutes
  // API: GET /api/measures/component?component={key}&metricKeys=sqale_index
  await sonarQube.getDebtMinutes(projectKey),
  
  // FROM: SonarQube - non-comment lines of code
  // API: GET /api/measures/component?component={key}&metricKeys=ncloc
  await sonarQube.getLinesOfCode(projectKey),
  
  // FROM: Git - number of commits to files in last 30 days
  // Command: git log --since="30 days ago" --format="%H" -- {file} | wc -l
  await git.getChangeFrequency(repoPath, 30),
  
  // FROM: SonarQube - cyclomatic complexity score
  // API: GET /api/measures/component?component={key}&metricKeys=complexity
  await sonarQube.getComplexity(projectKey),
  
  // FROM: Jenkins/CircleCI - percentage of failed builds
  // API: GET /job/{name}/api/json?tree=builds[result]
  // Calculate: (failed_count / total_count) * 100
  await ci.getFailedBuildRate(teamId),
  
  // FROM: CI test runner - percentage of flaky tests
  // Parse JUnit XML for tests with retries or <rerunFailure> tags
  await ci.getFlakyTestRate(teamId),
  
  // FROM: PagerDuty/Jira - mean time to restore pipeline
  // Filter incidents with label="pipeline" or type="build_failure"
  await incidents.getMTTR(teamId, 'pipeline'),
  
  // FROM: Jira - count of production bugs in last sprint
  // JQL: project={proj} AND type=Bug AND labels=production AND created>=-30d
  await jira.getProductionBugs(teamId),
  
  // FROM: Jira - sum of story points marked Done in last sprint
  // JQL: project={proj} AND status=Done AND sprint={current}
  // Sum: customfield_10016 (story points field)
  await jira.getStoryPointsCompleted(teamId)
);
```

**Usage in UI:**
- **Team Detail Header**: Large number with color coding (green <30, yellow 30-60, red >60)
- **Trend Chart**: 30-day historical view showing debt accumulation or paydown
- **Heatmap**: Visual representation of code hotspots (frequently changed + complex)
- **Recommendations**: Actionable suggestions for debt reduction
- **Alerts**: Notify when debt crosses critical thresholds

---

### 3. Task Sizing Accuracy

**Purpose:**  
Measures how well teams estimate work effort. Perfect estimation (1.0) means actual effort matches estimates. This metric reveals estimation maturity and helps improve sprint planning.

**Calculation Method:**
```
Task Sizing Accuracy = ActualEffort / EstimatedEffort

ActualEffort = 
  (α1 × CommitCount) +
  (α2 × LinesChanged) +
  (α3 × PRDurationHours) +
  (α4 × BuildTimeMinutes) +
  (α5 × TestTimeMinutes)

Where:
  α1 = 1.0   (commit count weight)
  α2 = 0.05  (lines changed weight)
  α3 = 2.0   (PR duration weight)
  α4 = 0.3   (build time weight)
  α5 = 0.2   (test time weight)

EstimatedEffort = StoryPoints (from Jira)

Interpretation:
  1.0 = Perfect estimation
  <1.0 = Overestimated (e.g., 0.8 = took 80% of estimate)
  >1.0 = Underestimated (e.g., 1.3 = took 130% of estimate)
```

**Data Sources:**
- **Jira**: Story points from custom field
  - API: `GET /rest/api/3/issue/{key}` → `fields.customfield_10016`
- **Git**: Commit count, lines changed
  - `git log --grep="PROJ-123" --format="%H" | wc -l`
  - `git log --grep="PROJ-123" --numstat`
- **GitHub/GitLab**: PR duration (merged_at - created_at)
  - API: `GET /repos/{owner}/{repo}/pulls/{pr}`
- **CI/CD**: Build time, test execution time
  - Jenkins: `build.duration / 60000` (milliseconds to minutes)

**Business Purpose:**  
Enables management to:
- **Improve Predictability**: More accurate sprint commitments lead to reliable delivery dates
- **Resource Planning**: Better estimates enable accurate capacity planning
- **Stakeholder Trust**: Consistent delivery builds confidence with customers and executives
- **Budget Accuracy**: Estimation accuracy directly impacts project cost forecasts
- **Risk Mitigation**: Identify stories likely to overrun before they become problems

**Technical Purpose:**  
Helps engineering teams:
- **Estimation Training**: Identify patterns in over/underestimation for coaching
- **Story Breakdown**: Learn which types of work need to be split into smaller pieces
- **Complexity Signals**: Understand what makes work harder than expected
- **Process Improvement**: Refine estimation techniques based on historical data
- **Velocity Calibration**: Adjust team velocity based on actual vs estimated effort

**Extraction Method:**
```javascript
import { calculateTaskSizingAccuracy } from './utils/metricsAggregator';

// FROM: Jira - get all stories marked Done in sprint
// JQL: sprint={sprintId} AND status=Done AND type=Story
const completedStories = await jira.getCompletedStories(sprintId);

const accuracies = await Promise.all(
  completedStories.map(async (story) => {
    // FROM: Git - analyze commits for this story
    const gitMetrics = await git.getStoryMetrics(story.key);
    
    // FROM: Jenkins/CircleCI - build and test metrics for story
    const ciMetrics = await ci.getStoryMetrics(story.key);
    
    return calculateTaskSizingAccuracy(
      // FROM: Jira - story points custom field
      // API: GET /rest/api/3/issue/{key} → fields.customfield_10016
      story.storyPoints,
      
      // FROM: Git - count commits mentioning story key
      // Command: git log --grep="PROJ-123" --format="%H" | wc -l
      gitMetrics.commitCount,
      
      // FROM: Git - sum of lines added + deleted
      // Command: git log --grep="PROJ-123" --numstat --format=""
      // Parse: awk '{add+=$1; del+=$2} END {print add+del}'
      gitMetrics.linesChanged,
      
      // FROM: GitHub/GitLab - PR duration in hours
      // API: GET /repos/{owner}/{repo}/pulls?head={branch}
      // Calculate: (merged_at - created_at) / 3600000
      gitMetrics.prDurationHours,
      
      // FROM: Jenkins - average build time for story commits
      // API: GET /job/{name}/{buildNumber}/api/json → duration
      // Convert: duration / 60000 (ms to minutes)
      ciMetrics.buildTimeMinutes,
      
      // FROM: CI test runner - test execution time
      // Parse JUnit XML: sum of <testsuite time="X"> attributes
      ciMetrics.testTimeMinutes
    );
  })
);

// Calculate average accuracy across all stories
const avgAccuracy = accuracies.reduce((a, b) => a + b) / accuracies.length;
```

**Usage in UI:**
- **Team Detail Header**: Multiplier value (e.g., "1.15x") with interpretation label
- **Color Coding**: Green (0.85-1.15), Yellow (0.7-0.85 or 1.15-1.3), Red (<0.7 or >1.3)
- **Story-Level View**: Individual accuracy per completed story in sprint retrospective
- **Trend Analysis**: Chart showing accuracy improvement over multiple sprints
- **Recommendations**: Suggest story splitting when accuracy is consistently >1.3

---

## Quality & Testing Metrics

### 4. Test Coverage

**Purpose:**  
Measures what percentage of your codebase is exercised by automated tests. Higher coverage reduces the risk of undetected bugs and increases confidence when refactoring.

**Calculation Method:**
```
Test Coverage = (Lines Executed by Tests / Total Lines of Code) × 100

Types of Coverage:
  - Line Coverage: % of code lines executed
  - Branch Coverage: % of decision branches taken
  - Function Coverage: % of functions called
  - Statement Coverage: % of statements executed

Overall Coverage = Weighted average of all types
```

**Data Sources:**
- **JavaScript/TypeScript**: Jest + Istanbul
  - File: `coverage/coverage-summary.json`
- **Java**: JaCoCo
  - File: `target/site/jacoco/jacoco.xml`
- **Python**: Coverage.py
  - Command: `coverage report --format=json`
- **CI/CD**: Coverage reports uploaded to CI system
  - Jenkins: Cobertura plugin
  - CircleCI: Coverage artifacts

**Business Purpose:**  
Enables stakeholders to:
- **Risk Assessment**: Low coverage = higher risk of production bugs
- **Release Confidence**: High coverage enables faster, safer releases
- **Compliance**: Meet regulatory requirements for critical systems (e.g., healthcare, finance)
- **Cost Reduction**: Catch bugs in testing rather than production (10-100x cheaper)
- **Customer Satisfaction**: Fewer bugs = happier customers = better retention

**Technical Purpose:**  
Helps engineering teams:
- **Refactoring Safety**: High coverage enables confident code changes
- **Regression Prevention**: Tests catch when changes break existing functionality
- **Documentation**: Tests serve as executable documentation of expected behavior
- **Design Quality**: Testable code tends to be better designed (loose coupling, clear interfaces)
- **Onboarding**: New engineers can understand code behavior through tests

**Extraction Method:**
```javascript
// FROM: Jenkins/CircleCI - coverage artifact from build
// API: GET /job/{name}/{buildNumber}/artifact/coverage/coverage-summary.json
// OR: CircleCI API: GET /project/{vcs}/{org}/{repo}/{buildNum}/artifacts
const coverage = await ci.getCoverageReport(buildId);
const coveragePercent = coverage.lines.pct; // 85.4

// FROM: Local file system - Jest/Istanbul coverage report
// File location: ./coverage/coverage-summary.json (generated by npm test)
// Structure: { total: { lines: { pct: 85.4 }, branches: { pct: 78.2 } } }
const fs = require('fs');
const coverageData = JSON.parse(
  fs.readFileSync('coverage/coverage-summary.json', 'utf8')
);
const totalCoverage = coverageData.total.lines.pct;

// FROM: SonarQube - code coverage metric
// API: GET /api/measures/component?component={key}&metricKeys=coverage
const sonarCoverage = await sonarQube.getMetric(projectKey, 'coverage');

// FROM: Codecov/Coveralls - coverage service
// API: GET /api/v2/repos/{owner}/{repo}/coverage
const codecovData = await codecov.getCoverage(repoId);
```

**Usage in UI:**
- **Dashboard**: Percentage with circular progress indicator
- **Trend Chart**: 30-day historical coverage trend
- **File-Level View**: Drill down to see coverage per file/module
- **Diff View**: Show coverage change for new code in PRs
- **Alerts**: Notify when coverage drops below threshold (e.g., <70%)
- **PR Comments**: Automated comments showing coverage impact of changes

---
### 5. Test Flakiness Rate

**Purpose:**  
Identifies tests that produce inconsistent results without code changes. Flaky tests erode trust in CI/CD, waste developer time investigating false failures, and mask real issues.

**Calculation Method:**
```
Flakiness Rate = (Flaky Test Runs / Total Test Runs) × 100

A test is "flaky" if it:
  - Fails, then passes on retry without code changes
  - Passes locally but fails in CI (or vice versa)
  - Fails intermittently across multiple runs

Detection Methods:
  - Retry analysis: Tests that pass after 1+ retries
  - Historical analysis: Tests with <95% pass rate over 30 days
  - Timing analysis: Tests with high variance in execution time
```

**Data Sources:**
- **CI Test Runner Logs**: JUnit XML, pytest results, Jest output
  - Parse `<rerunFailure>` or `<flakyFailure>` tags
- **Test Retry Plugins**: Gradle test retry, pytest-rerunfailures
  - Count tests that needed retries to pass
- **Test Analytics Platforms**: BuildPulse, Launchable, TestRail
  - API endpoints for flaky test identification

**Business Purpose:**  
Enables stakeholders to:
- **Reduce Wasted Time**: Flaky tests cost 15-30 min per false failure × number of engineers
- **Improve Velocity**: Teams move faster when they trust their test suite
- **Cost Savings**: Calculate ROI of fixing flaky tests (time saved × hourly rate)
- **Release Confidence**: Reliable tests mean confident deployments
- **Developer Satisfaction**: Reduce frustration and improve morale

**Technical Purpose:**  
Helps engineering teams:
- **Root Cause Analysis**: Identify common patterns (race conditions, timing issues, external dependencies)
- **Prioritize Fixes**: Focus on most frequently flaky tests first
- **Test Quality**: Improve test design (isolation, determinism, proper cleanup)
- **CI Optimization**: Reduce build times by fixing or quarantining flaky tests
- **Monitoring**: Track flakiness trends to prevent regression

**Extraction Method:**
```javascript
// FROM: Jenkins/CircleCI - test execution results
// Parse JUnit XML files for <rerunFailure> or <flakyFailure> tags
// API: GET /job/{name}/{buildNumber}/testReport/api/json
const testRuns = await ci.getTestRuns(teamId, last30Days);

// Filter tests that passed after retry (flaky indicator)
// A test is flaky if: status='passed' AND retryCount > 0
const flakyTests = testRuns.filter(test => 
  test.status === 'passed' && test.retryCount > 0
);
const flakinessRate = (flakyTests.length / testRuns.length) * 100;

// FROM: BuildPulse/Launchable/TestRail - test analytics platform
// API: GET /api/v1/projects/{id}/flaky_tests?days=30
// These platforms track historical pass/fail patterns
const flakiness = await testAnalytics.getFlakinessRate({
  project: projectId,
  timeRange: '30d',
  threshold: 0.95 // Tests with <95% pass rate are considered flaky
});

// FROM: pytest-rerunfailures plugin - Python test retries
// Parse pytest JSON report: tests with "rerun" > 0
// Command: pytest --json-report --json-report-file=report.json

// FROM: Gradle Test Retry Plugin - Java test retries
// Parse build/test-results/test/TEST-*.xml for retry attempts
```

**Usage in UI:**
- **Dashboard**: Percentage with trend indicator (down is good)
- **Flaky Test List**: Table of most problematic tests with failure frequency
- **Test Detail**: Historical pass/fail pattern visualization
- **Alerts**: Notify when flakiness exceeds 2% threshold
- **Recommendations**: Suggest quarantine or fix based on impact

---

### 6. Defect Density

**Purpose:**  
Measures code quality by calculating defects per unit of code. Lower density indicates higher quality code and better development practices.

**Calculation Method:**
```
Defect Density = (Total Defects Found / Total Lines of Code) × 1000

Expressed as: X defects per 1,000 lines of code (1k LOC)

Defect Categories:
  - Critical: System crashes, data loss, security vulnerabilities
  - Major: Feature broken, significant functionality impaired
  - Minor: Small bugs, cosmetic issues, edge cases

Weighted Defect Density = 
  (Critical × 3 + Major × 2 + Minor × 1) / LOC × 1000
```

**Data Sources:**
- **Bug Tracker**: Jira, Azure DevOps, GitHub Issues
  - JQL: `project = PROJ AND type = Bug AND created >= -30d`
- **Code Analysis**: SonarQube lines of code
  - API: `GET /api/measures/component?metricKeys=ncloc`
- **Git**: Lines of code from repository
  - Command: `git ls-files | xargs wc -l`

**Business Purpose:**  
Enables stakeholders to:
- **Quality Benchmarking**: Compare against industry standards (0.5-1.0 defects/1k LOC is good)
- **Vendor Evaluation**: Assess third-party code quality
- **Team Performance**: Identify teams needing quality support
- **Cost Forecasting**: Predict maintenance costs based on defect density
- **Release Readiness**: Gate releases when density exceeds acceptable threshold

**Technical Purpose:**  
Helps engineering teams:
- **Code Review Focus**: Identify modules with high defect density for extra scrutiny
- **Refactoring Priority**: Target high-density areas for cleanup
- **Process Improvement**: Correlate density with practices (TDD, pair programming, code review)
- **Training Needs**: Identify skill gaps when certain types of defects cluster
- **Architecture Decisions**: High density may indicate need for module rewrite

**Extraction Method:**
```javascript
// FROM: Jira - get all bugs created in last 30 days
// API: GET /rest/api/3/search?jql={jql}&fields=priority,severity,created
// JQL: project = PROJ AND type = Bug AND created >= -30d
const bugs = await jira.query({
  jql: 'project = PROJ AND type = Bug AND created >= -30d',
  fields: ['severity', 'created', 'priority']
});

// FROM: SonarQube - non-comment lines of code
// API: GET /api/measures/component?component={key}&metricKeys=ncloc
// ncloc = lines of code excluding comments and blank lines
const loc = await sonarQube.getMetric(projectKey, 'ncloc');

// Calculate simple defect density (bugs per 1000 LOC)
const defectDensity = (bugs.length / loc) * 1000;

// Calculate weighted defect density (severity-adjusted)
// Critical bugs count 3x, Major 2x, Minor 1x
const weightedDensity = bugs.reduce((sum, bug) => {
  // FROM: Jira bug severity field (Critical/Major/Minor)
  const weight = bug.severity === 'Critical' ? 3 : 
                 bug.severity === 'Major' ? 2 : 1;
  return sum + weight;
}, 0) / loc * 1000;

// Alternative FROM: GitHub Issues - count bugs by label
// API: GET /repos/{owner}/{repo}/issues?labels=bug&since={date}
const githubBugs = await github.getIssues({
  labels: ['bug'],
  since: thirtyDaysAgo
});
```

**Usage in UI:**
- **Team Detail**: Number with unit "/1k LOC" and color coding
- **Trend Chart**: 90-day historical defect density
- **Module Heatmap**: Visual representation of high-density areas
- **Comparison View**: Team vs team or module vs module
- **Alerts**: Notify when density exceeds 1.5 defects/1k LOC

---

### 7. Defect Escape Rate

**Purpose:**  
Measures testing effectiveness by tracking what percentage of bugs escape to production. Lower rate means better testing catches more issues before customers see them.

**Calculation Method:**
```
Defect Escape Rate = (Production Bugs / Total Bugs Found) × 100

Where:
  Production Bugs = Bugs reported by customers or found in production
  Total Bugs = Production Bugs + Pre-Production Bugs

Alternative calculation:
  Defect Escape Rate = Production Bugs / (Production Bugs + Bugs Found in Testing) × 100

Target: <5% (elite teams), <10% (good), >15% (needs improvement)
```

**Data Sources:**
- **Jira**: Bug tickets with environment labels
  - Production: `labels = production OR environment = prod`
  - Pre-Production: `labels IN (dev, staging, qa, test)`
- **Customer Support**: Tickets categorized as bugs
  - Zendesk, Intercom, Salesforce Service Cloud
- **Monitoring**: Production error tracking
  - Sentry, Rollbar, New Relic errors

**Business Purpose:**  
Enables stakeholders to:
- **Customer Impact**: Direct measure of quality experienced by users
- **Brand Protection**: High escape rate damages reputation and trust
- **Support Costs**: Production bugs generate expensive support tickets
- **Revenue Impact**: Critical bugs can cause customer churn and lost sales
- **SLA Compliance**: Track against service level agreements

**Technical Purpose:**  
Helps engineering teams:
- **Test Strategy**: Identify gaps in test coverage or test scenarios
- **Environment Parity**: Ensure test environments match production
- **Shift Left**: Catch bugs earlier in development cycle
- **Test Automation**: Prioritize automation for scenarios that escape
- **Release Process**: Improve staging validation and smoke tests

**Extraction Method:**
```javascript
const productionBugs = await jira.query({
  jql: 'type = Bug AND labels = production AND created >= -30d'
});

const allBugs = await jira.query({
  jql: 'type = Bug AND created >= -30d'
});

const escapeRate = (productionBugs.length / allBugs.length) * 100;

// Alternative: from customer support
const supportBugs = await zendesk.getTickets({
  type: 'incident',
  tags: ['bug'],
  created_at: 'last_30_days'
});
```

**Usage in UI:**
- **Dashboard**: Percentage with inverse color coding (lower is better)
- **Trend Analysis**: Monthly escape rate over 12 months
- **Bug Categorization**: Breakdown by severity and root cause
- **Comparison**: Pre-production vs production bug discovery
- **Alerts**: Escalate when rate exceeds 10% threshold

---

## Speed & Efficiency Metrics

### 8. Average Build Time

**Purpose:**  
Measures how long CI/CD pipelines take to compile, test, and package code. Faster builds enable quicker feedback and more frequent deployments.

**Calculation Method:**
```
Average Build Time = Sum of Build Durations / Number of Builds

Measured over: Last 7 days or last 100 builds

Components:
  - Compile Time: Code compilation
  - Test Time: Unit + integration tests
  - Package Time: Docker build, artifact creation
  - Deploy Time: Deployment to staging/production

Total Build Time = Compile + Test + Package + Deploy
```

**Data Sources:**
- **Jenkins**: Build duration from API
  - `GET /job/{name}/{buildNumber}/api/json` → `duration`
- **CircleCI**: Workflow duration
  - `GET /workflow/{id}` → `duration`
- **GitHub Actions**: Workflow run time
  - `GET /repos/{owner}/{repo}/actions/runs/{id}` → `run_duration_ms`
- **GitLab CI**: Pipeline duration
  - `GET /projects/{id}/pipelines/{pipeline_id}` → `duration`

**Business Purpose:**  
Enables stakeholders to:
- **Developer Productivity**: Long builds waste expensive engineering time
- **Time-to-Market**: Faster builds enable quicker feature delivery
- **Cost Optimization**: Reduce CI/CD infrastructure costs
- **Competitive Advantage**: Ship features faster than competitors
- **ROI Calculation**: Quantify savings from build optimization

**Technical Purpose:**  
Helps engineering teams:
- **Feedback Loop**: Faster builds mean quicker error detection
- **Deployment Frequency**: Short builds enable multiple daily deployments
- **Developer Experience**: Reduce context switching and waiting time
- **Optimization Targets**: Identify slowest build stages
- **Parallelization**: Find opportunities for parallel execution

**Extraction Method:**
```javascript
const builds = await jenkins.getBuilds({
  job: jobName,
  count: 100,
  status: 'all'
});

const totalDuration = builds.reduce((sum, build) => 
  sum + build.duration, 0
);

const avgBuildTime = totalDuration / builds.length / 60000; // Convert to minutes
```

**Usage in UI:**
- **Dashboard**: Time in minutes with trend arrow
- **Build Stage Breakdown**: Pie chart showing time per stage
- **Historical Trend**: Line chart of build times over 30 days
- **Comparison**: Current vs previous sprint average
- **Alerts**: Notify when build time exceeds 15 minutes

---


### 9. Deployment Frequency (DORA Metric)

**Purpose:**  
Measures how often code is deployed to production. Higher frequency indicates mature DevOps practices, faster value delivery, and lower deployment risk (smaller changes).

**Calculation Method:**
```
Deployment Frequency = Number of Production Deployments / Time Period

Common measurements:
  - Deployments per day
  - Deployments per week
  - Deployments per month

DORA Performance Levels:
  - Elite: Multiple deployments per day
  - High: Once per day to once per week
  - Medium: Once per week to once per month
  - Low: Less than once per month
```

**Data Sources:**
- **CD Tools**: Spinnaker, ArgoCD, Flux
  - API: Count successful production deployments
- **Git Tags**: Production release tags
  - `git tag --list 'v*' --sort=-creatordate`
- **Kubernetes**: Deployment events
  - `kubectl get events --field-selector involvedObject.kind=Deployment`
- **Cloud Platforms**: AWS CodeDeploy, Azure DevOps, GCP Cloud Deploy

**Business Purpose:**  
Enables stakeholders to:
- **Faster Time-to-Market**: Ship features and fixes to customers quickly
- **Competitive Advantage**: Respond to market changes faster than competitors
- **Revenue Impact**: More frequent releases = more opportunities for revenue
- **Customer Satisfaction**: Bugs get fixed faster, features arrive sooner
- **Risk Reduction**: Smaller, frequent changes are less risky than big releases

**Technical Purpose:**  
Helps engineering teams:
- **Continuous Improvement**: Frequent deployments force automation and process refinement
- **Blast Radius**: Small changes limit impact of failures
- **Rollback Speed**: Easy to revert small changes
- **Confidence**: Regular deployments build muscle memory and reduce fear
- **Feedback**: Faster user feedback on new features

**Extraction Method:**
```javascript
const deployments = await argoCD.getApplicationHistory({
  appName: 'production-app',
  timeRange: 'last_7_days'
});

const successfulDeploys = deployments.filter(d => 
  d.status === 'Healthy' && d.syncStatus === 'Synced'
);

const deploysPerWeek = successfulDeploys.length;
const deploysPerDay = deploysPerWeek / 7;
```

**Usage in UI:**
- **Dashboard**: Number per week with DORA level badge
- **Calendar View**: Visual deployment calendar showing frequency
- **Trend Chart**: Deployment frequency over 12 months
- **Team Comparison**: Compare deployment frequency across teams
- **Alerts**: Notify if no deployments in 7 days

---

### 10. Lead Time for Changes (DORA Metric)

**Purpose:**  
Measures time from code commit to running in production. Shorter lead time means faster feature delivery and quicker bug fixes.

**Calculation Method:**
```
Lead Time = Median(Deployment Time - Commit Time)

Measured for all commits deployed in a time period

Breakdown:
  - Coding Time: Commit to PR creation
  - Review Time: PR creation to approval
  - CI Time: PR merge to build completion
  - Deployment Time: Build completion to production

DORA Performance Levels:
  - Elite: Less than 1 day
  - High: 1 day to 1 week
  - Medium: 1 week to 1 month
  - Low: More than 1 month
```

**Data Sources:**
- **Git**: Commit timestamps
  - `git log --format="%H %ct" --since="30 days ago"`
- **GitHub/GitLab**: PR timestamps
  - API: `created_at`, `merged_at` from pull requests
- **CI/CD**: Build and deployment timestamps
  - Jenkins, CircleCI, GitHub Actions logs
- **CD Tools**: Production deployment timestamps
  - ArgoCD, Spinnaker deployment history

**Business Purpose:**  
Enables stakeholders to:
- **Predictability**: Know how long features take from code to customer
- **Planning**: Set realistic expectations for feature delivery
- **Bottleneck Identification**: Find where work gets stuck
- **Process Improvement**: Measure impact of process changes
- **Customer Promises**: Make accurate delivery commitments

**Technical Purpose:**  
Helps engineering teams:
- **Pipeline Optimization**: Identify slow stages in delivery pipeline
- **Automation Opportunities**: Find manual steps slowing delivery
- **Batch Size**: Encourage smaller, more frequent changes
- **WIP Limits**: Reduce work in progress to improve flow
- **Continuous Deployment**: Move toward automated production deployments

**Extraction Method:**
```javascript
const deployments = await getProductionDeployments(last30Days);

const leadTimes = await Promise.all(
  deployments.map(async (deploy) => {
    const commits = await git.getCommitsInDeployment(deploy.id);
    const firstCommit = commits[commits.length - 1];
    
    const leadTimeHours = 
      (deploy.timestamp - firstCommit.timestamp) / 3600000;
    
    return leadTimeHours / 24; // Convert to days
  })
);

const medianLeadTime = calculateMedian(leadTimes);
```

**Usage in UI:**
- **Dashboard**: Days/hours with DORA level indicator
- **Distribution Chart**: Histogram showing lead time distribution
- **Trend Analysis**: Lead time over time to track improvements
- **Breakdown View**: Time spent in each stage (code, review, CI, deploy)
- **Alerts**: Notify when lead time exceeds 7 days

---

### 11. Mean Time to Repair - MTTR (DORA Metric)

**Purpose:**  
Measures how quickly teams restore service after an incident. Lower MTTR indicates better incident response, monitoring, and system resilience.

**Calculation Method:**
```
MTTR = Average(Incident Resolution Time - Incident Detection Time)

Measured in hours or minutes

Components:
  - Detection Time: Incident occurrence to detection
  - Diagnosis Time: Detection to root cause identification
  - Fix Time: Root cause to fix deployed
  - Verification Time: Fix deployed to incident closed

DORA Performance Levels:
  - Elite: Less than 1 hour
  - High: Less than 1 day
  - Medium: 1 day to 1 week
  - Low: More than 1 week
```

**Data Sources:**
- **Incident Management**: PagerDuty, Opsgenie, VictorOps
  - API: `incident.resolved_at - incident.created_at`
- **Jira**: Incident tickets
  - JQL: `type = Incident AND status = Resolved`
  - Time: `resolutiondate - created`
- **Monitoring**: Datadog, New Relic, Prometheus alerts
  - Alert creation to resolution timestamps
- **ChatOps**: Slack/Teams incident channels
  - Bot-tracked incident timelines

**Business Purpose:**  
Enables stakeholders to:
- **Downtime Cost**: Calculate revenue lost per hour of downtime
- **SLA Compliance**: Meet service level agreements for uptime
- **Customer Trust**: Fast recovery maintains customer confidence
- **Competitive Advantage**: Reliability is a key differentiator
- **Insurance/Compliance**: Demonstrate incident response capability

**Technical Purpose:**  
Helps engineering teams:
- **Runbook Quality**: Identify gaps in incident response procedures
- **Monitoring Gaps**: Find blind spots in observability
- **Automation Opportunities**: Automate common incident responses
- **On-Call Effectiveness**: Measure and improve on-call processes
- **System Design**: Identify systems needing better resilience

**Extraction Method:**
```javascript
const incidents = await pagerDuty.getIncidents({
  since: last30Days,
  status: 'resolved',
  urgency: 'high'
});

const mttrHours = incidents.reduce((sum, incident) => {
  const resolutionTime = 
    (incident.resolved_at - incident.created_at) / 3600000;
  return sum + resolutionTime;
}, 0) / incidents.length;
```

**Usage in UI:**
- **Dashboard**: Hours/minutes with DORA level badge
- **Incident Timeline**: Visual timeline of recent incidents
- **Breakdown**: Time spent in detection, diagnosis, fix, verification
- **Trend Chart**: MTTR over 12 months
- **Alerts**: Escalate when MTTR exceeds 24 hours

---

### 12. Change Failure Rate (DORA Metric)

**Purpose:**  
Measures deployment quality by tracking what percentage of deployments cause production failures requiring hotfix or rollback. Lower rate means more stable releases.

**Calculation Method:**
```
Change Failure Rate = (Failed Deployments / Total Deployments) × 100

Failed Deployment = Deployment that causes:
  - Rollback to previous version
  - Hotfix deployment within 24 hours
  - Service degradation or outage
  - Critical incident

DORA Performance Levels:
  - Elite: 0-5%
  - High: 5-15%
  - Medium: 15-30%
  - Low: More than 30%
```

**Data Sources:**
- **CD Tools**: Deployment status (success, failed, rolled back)
  - ArgoCD, Spinnaker deployment history
- **Incident Management**: Incidents linked to deployments
  - PagerDuty incidents with deployment correlation
- **Git**: Revert commits or hotfix tags
  - `git log --grep="revert" --grep="hotfix"`
- **Monitoring**: Error rate spikes after deployments
  - Datadog, New Relic deployment markers + error rates

**Business Purpose:**  
Enables stakeholders to:
- **Risk Assessment**: Understand deployment risk profile
- **Release Planning**: Schedule releases during low-traffic periods if CFR is high
- **Cost of Quality**: Calculate cost of failed deployments
- **Customer Impact**: Failed deployments affect user experience
- **Process Investment**: Justify investment in testing and staging

**Technical Purpose:**  
Helps engineering teams:
- **Testing Gaps**: Identify what types of issues escape testing
- **Staging Parity**: Ensure staging matches production
- **Deployment Process**: Improve deployment automation and validation
- **Feature Flags**: Use flags to reduce deployment risk
- **Monitoring**: Improve detection of deployment-related issues

**Extraction Method:**
```javascript
const deployments = await getProductionDeployments(last30Days);

const failedDeployments = await Promise.all(
  deployments.map(async (deploy) => {
    // Check for rollback
    const wasRolledBack = await checkRollback(deploy.id);
    
    // Check for incidents within 24h
    const incidents = await getIncidentsAfterDeployment(
      deploy.timestamp,
      deploy.timestamp + 86400000 // +24 hours
    );
    
    return wasRolledBack || incidents.length > 0;
  })
);

const cfr = (failedDeployments.filter(Boolean).length / deployments.length) * 100;
```

**Usage in UI:**
- **Dashboard**: Percentage with DORA level indicator
- **Deployment History**: Table showing success/failure per deployment
- **Correlation View**: Link deployments to incidents
- **Trend Analysis**: CFR over time to track improvements
- **Alerts**: Notify when CFR exceeds 15% threshold

---

## Agile & Process Metrics

### 13. Sprint Velocity

**Purpose:**  
Measures team capacity by tracking story points completed per sprint. Stable velocity enables predictable planning and delivery.

**Calculation Method:**
```
Sprint Velocity = Sum of Story Points for Completed Stories

Measured per sprint (usually 2 weeks)

Average Velocity = Sum of last 3-5 sprint velocities / Number of sprints

Velocity should be stable (±10%) over time
```

**Data Sources:**
- **Jira**: Completed stories in sprint
  - JQL: `sprint = {sprintId} AND status = Done`
  - Sum: `fields.customfield_10016` (story points)
- **Azure DevOps**: Completed work items
  - API: `GET /work/iterations/{id}/workitems`
- **Rally**: User stories completed
  - API: Iteration query with PlanEstimate sum

**Business Purpose:**  
Enables stakeholders to:
- **Capacity Planning**: Predict how much work team can complete
- **Release Planning**: Forecast feature delivery dates
- **Resource Allocation**: Understand team capacity for new work
- **Hiring Decisions**: Identify when teams need additional capacity
- **Budget Forecasting**: Estimate project costs based on velocity

**Technical Purpose:**  
Helps engineering teams:
- **Sprint Planning**: Commit to realistic amount of work
- **Continuous Improvement**: Track impact of process changes on velocity
- **Bottleneck Identification**: Investigate when velocity drops
- **Team Health**: Stable velocity indicates healthy team dynamics
- **Estimation Calibration**: Refine story point estimates over time

**Extraction Method:**
```javascript
const sprint = await jira.getSprint(sprintId);
const completedIssues = await jira.query({
  jql: `sprint = ${sprintId} AND status = Done AND type = Story`
});

const velocity = completedIssues.reduce((sum, issue) => 
  sum + (issue.fields.customfield_10016 || 0), 0
);

// Calculate average velocity
const last5Sprints = await getLastNSprints(5);
const avgVelocity = last5Sprints.reduce((sum, s) => 
  sum + s.velocity, 0) / 5;
```

**Usage in UI:**
- **Dashboard**: Story points with trend indicator
- **Velocity Chart**: Bar chart showing last 10 sprints
- **Forecast**: Projected completion dates based on velocity
- **Comparison**: Team vs team velocity
- **Alerts**: Notify when velocity drops >20% from average

---


### 14. Sprint Commitment Rate

**Purpose:**  
Measures planning accuracy by tracking what percentage of committed sprint work is actually completed. High commitment rate indicates mature estimation and planning.

**Calculation Method:**
```
Sprint Commitment Rate = (Completed Story Points / Committed Story Points) × 100

Where:
  Committed = Story points at sprint start
  Completed = Story points in "Done" status at sprint end

Target: >85% indicates good planning
```

**Data Sources:**
- **Jira**: Sprint board snapshots
  - Sprint start: Sum of story points in sprint
  - Sprint end: Sum of completed story points
- **Azure DevOps**: Iteration planning vs actuals
- **Rally**: Committed vs accepted work

**Business Purpose:**  
Enables stakeholders to:
- **Predictability**: Reliable delivery builds stakeholder trust
- **Planning Accuracy**: Improve forecast accuracy for roadmap planning
- **Resource Optimization**: Avoid over/under-committing team capacity
- **Stakeholder Communication**: Set realistic expectations
- **Risk Management**: Low commitment rate signals planning issues

**Technical Purpose:**  
Helps engineering teams:
- **Estimation Improvement**: Learn from over/under-estimation patterns
- **Scope Management**: Identify scope creep during sprint
- **Capacity Planning**: Understand true team capacity
- **Process Refinement**: Improve sprint planning ceremonies
- **Team Morale**: Consistent achievement builds confidence

**Extraction Method:**
```javascript
const sprintStart = await jira.getSprintSnapshot(sprintId, 'start');
const sprintEnd = await jira.getSprintSnapshot(sprintId, 'end');

const committedPoints = sprintStart.issues.reduce((sum, issue) => 
  sum + (issue.storyPoints || 0), 0
);

const completedPoints = sprintEnd.issues
  .filter(i => i.status === 'Done')
  .reduce((sum, issue) => sum + (issue.storyPoints || 0), 0);

const commitmentRate = (completedPoints / committedPoints) * 100;
```

**Usage in UI:**
- **Sprint Board**: Progress bar showing committed vs completed
- **Retrospective View**: Commitment rate per sprint over time
- **Team Comparison**: Compare commitment rates across teams
- **Alerts**: Notify when rate drops below 75%

---

### 15. Sprint Carryover

**Purpose:**  
Tracks work not completed and moved to the next sprint. High carryover indicates poor estimation, scope creep, or blockers.

**Calculation Method:**
```
Sprint Carryover = (Incomplete Story Points / Committed Story Points) × 100

Where:
  Incomplete = Story points not in "Done" status at sprint end
  
Target: <10% indicates healthy sprint execution
```

**Data Sources:**
- **Jira**: Incomplete stories moved to next sprint
  - JQL: `sprint = {previousSprint} AND status != Done AND sprint = {currentSprint}`
- **Sprint Reports**: Jira sprint report API
- **Azure DevOps**: Iteration carryover report

**Business Purpose:**  
Enables stakeholders to:
- **Delivery Risk**: High carryover signals unreliable delivery
- **Root Cause Analysis**: Understand why work isn't completing
- **Process Improvement**: Identify systemic issues
- **Capacity Planning**: Adjust future sprint commitments
- **Stakeholder Management**: Explain delays and set expectations

**Technical Purpose:**  
Helps engineering teams:
- **Story Sizing**: Identify stories that are too large
- **Blocker Management**: Surface impediments preventing completion
- **WIP Limits**: Encourage finishing work before starting new work
- **Sprint Planning**: Improve estimation and commitment
- **Team Health**: High carryover can indicate team stress or burnout

**Extraction Method:**
```javascript
const previousSprint = await jira.getSprint(previousSprintId);
const currentSprint = await jira.getSprint(currentSprintId);

const carriedOver = await jira.query({
  jql: `sprint = ${previousSprintId} AND status != Done AND sprint = ${currentSprintId}`
});

const carryoverPoints = carriedOver.reduce((sum, issue) => 
  sum + (issue.fields.customfield_10016 || 0), 0
);

const carryoverRate = (carryoverPoints / previousSprint.committedPoints) * 100;
```

**Usage in UI:**
- **Sprint Board**: Badge showing carryover count
- **Trend Chart**: Carryover percentage over last 10 sprints
- **Story Detail**: Highlight stories carried over multiple sprints
- **Alerts**: Escalate when carryover exceeds 15%

---

### 16. First-Time Pass Rate

**Purpose:**  
Measures development quality by tracking user stories that pass QA testing on the first attempt. Higher rate means better quality from development and clearer acceptance criteria.

**Calculation Method:**
```
First-Time Pass Rate = (Stories Passing QA First Time / Total Stories Tested) × 100

Where:
  First-Time Pass = Story moves from "In QA" to "Done" without returning to "In Progress"
  
Target: >75% indicates good development quality
```

**Data Sources:**
- **Jira**: Workflow transition history
  - API: `GET /issue/{key}/changelog`
  - Check if story went: Dev → QA → Done (no loops back)
- **Custom Fields**: QA rejection count
- **Workflow Metrics**: Time in each status

**Business Purpose:**  
Enables stakeholders to:
- **Quality Indicator**: Direct measure of development quality
- **Efficiency**: Rework is expensive and slows delivery
- **Customer Satisfaction**: Higher quality = fewer production bugs
- **Cost Reduction**: First-time quality reduces total cost
- **Team Morale**: Reduces frustration from rework cycles

**Technical Purpose:**  
Helps engineering teams:
- **Acceptance Criteria**: Improve story definition and clarity
- **Development Practices**: Identify need for better testing or code review
- **QA Collaboration**: Improve dev-QA communication
- **Technical Debt**: High rejection rate may indicate debt accumulation
- **Skill Development**: Identify training needs

**Extraction Method:**
```javascript
const stories = await jira.getCompletedStories(sprintId);

const firstTimePass = await Promise.all(
  stories.map(async (story) => {
    const changelog = await jira.getChangelog(story.key);
    
    // Check if story went directly: Dev → QA → Done
    const transitions = changelog.histories
      .filter(h => h.items.some(i => i.field === 'status'))
      .map(h => h.items.find(i => i.field === 'status').toString);
    
    const hasRework = transitions.includes('In Progress') && 
                      transitions.indexOf('In Progress') > 
                      transitions.indexOf('In QA');
    
    return !hasRework;
  })
);

const ftpRate = (firstTimePass.filter(Boolean).length / stories.length) * 100;
```

**Usage in UI:**
- **Dashboard**: Percentage with trend indicator
- **Story Detail**: Badge showing if story passed first time
- **Retrospective**: List of stories requiring rework
- **Team Comparison**: Compare FTP rates across teams
- **Alerts**: Notify when rate drops below 70%

---

### 17. Test Automation Coverage

**Purpose:**  
Measures what percentage of test cases are automated vs manual. Higher automation enables faster regression testing and continuous delivery.

**Calculation Method:**
```
Test Automation Coverage = (Automated Test Cases / Total Test Cases) × 100

Where:
  Automated = Tests that run in CI/CD without human intervention
  Total = Automated + Manual test cases
  
Target: >70% for regression tests, >50% overall
```

**Data Sources:**
- **Test Management**: TestRail, Zephyr, qTest
  - API: Count of automated vs manual test cases
- **Test Frameworks**: Jest, Pytest, JUnit test counts
  - Parse test result files for test count
- **CI/CD**: Test execution reports
  - JUnit XML, pytest JSON, Jest coverage

**Business Purpose:**  
Enables stakeholders to:
- **Speed to Market**: Automated tests enable faster releases
- **Cost Reduction**: Automation reduces manual testing costs over time
- **Quality Consistency**: Automated tests run the same way every time
- **Scalability**: Manual testing doesn't scale with codebase growth
- **ROI Tracking**: Measure return on automation investment

**Technical Purpose:**  
Helps engineering teams:
- **Regression Testing**: Automate repetitive test scenarios
- **CI/CD Enablement**: Automated tests are prerequisite for continuous deployment
- **Test Maintenance**: Identify manual tests to automate
- **Coverage Gaps**: Find areas lacking automated coverage
- **Team Efficiency**: Free QA engineers for exploratory testing

**Extraction Method:**
```javascript
const testCases = await testRail.getTestCases(projectId);

const automated = testCases.filter(tc => 
  tc.custom_automation_type === 'Automated'
).length;

const automationCoverage = (automated / testCases.length) * 100;

// Alternative: from test results
const testResults = await ci.getTestResults(buildId);
const automatedTests = testResults.tests.length;
const manualTests = await testRail.getManualTestCount(projectId);
const coverage = (automatedTests / (automatedTests + manualTests)) * 100;
```

**Usage in UI:**
- **Dashboard**: Percentage with progress bar
- **Trend Chart**: Automation coverage growth over 6 months
- **Test Pyramid**: Visual showing unit/integration/E2E test distribution
- **Gap Analysis**: List of high-priority manual tests to automate
- **Alerts**: Notify when coverage drops below 60%

---

### 18. Automation ROI

**Purpose:**  
Measures return on investment from test automation efforts. Justifies automation investment and identifies high-value automation opportunities.

**Calculation Method:**
```
Automation ROI = (Time Saved by Automation / Time Invested in Automation) × 100

Where:
  Time Saved = (Manual execution time per run × Number of runs) - Automated execution time
  Time Invested = Time to create + maintain automated tests
  
ROI > 200% means automation saves more time than it costs

Example:
  Manual test: 30 min/run, runs 50 times/month = 1500 min/month
  Automated test: 5 min/run, took 8 hours to create = 480 min investment
  Monthly savings: 1500 - (5 × 50) = 1250 min
  ROI after 1 month: (1250 / 480) × 100 = 260%
```

**Data Sources:**
- **Test Management**: Manual test execution times
  - TestRail test case duration estimates
- **CI/CD**: Automated test execution times
  - Test runner logs, JUnit XML duration
- **Time Tracking**: Automation development time
  - Jira time tracking on automation stories
  - Git commit history for automation code

**Business Purpose:**  
Enables stakeholders to:
- **Investment Justification**: Prove value of automation initiatives
- **Budget Planning**: Allocate resources to high-ROI automation
- **Prioritization**: Focus on tests with highest ROI potential
- **Cost-Benefit Analysis**: Compare automation vs manual testing costs
- **Strategic Planning**: Decide when to automate vs keep manual

**Technical Purpose:**  
Helps engineering teams:
- **Automation Strategy**: Identify which tests to automate first
- **Maintenance Focus**: Track maintenance costs vs savings
- **Tool Selection**: Evaluate automation frameworks by ROI
- **Team Allocation**: Justify dedicated automation engineers
- **Continuous Improvement**: Optimize existing automated tests

**Extraction Method:**
```javascript
const automatedTests = await getAutomatedTests(projectId);

const roi = automatedTests.map(test => {
  const manualTimePerRun = test.estimatedManualDuration; // minutes
  const automatedTimePerRun = test.actualAutomatedDuration;
  const runsPerMonth = test.executionFrequency;
  const developmentTime = test.automationDevelopmentTime;
  const maintenanceTime = test.maintenanceTimePerMonth;
  
  const monthlySavings = 
    (manualTimePerRun * runsPerMonth) - 
    (automatedTimePerRun * runsPerMonth) - 
    maintenanceTime;
  
  const monthlyROI = (monthlySavings / developmentTime) * 100;
  
  return { test: test.name, roi: monthlyROI };
});

const avgROI = roi.reduce((sum, r) => sum + r.roi, 0) / roi.length;
```

**Usage in UI:**
- **Dashboard**: Percentage with ROI indicator
- **Test-Level ROI**: Table showing ROI per automated test
- **Trend Analysis**: ROI improvement over time
- **Prioritization Matrix**: Tests by ROI potential vs effort
- **Alerts**: Highlight tests with negative ROI for review

---

## Reliability Metrics

### 19. Mean Time Between Failures (MTBF)

**Purpose:**  
Measures system stability by calculating average time the system operates without failure. Higher MTBF indicates more reliable systems.

**Calculation Method:**
```
MTBF = Total Operational Time / Number of Failures

Measured in hours

Example:
  System ran for 720 hours (30 days)
  Had 6 failures
  MTBF = 720 / 6 = 120 hours
  
Target: >100 hours indicates stable system
```

**Data Sources:**
- **Incident Management**: PagerDuty, Opsgenie incident count
  - Count of high-severity incidents
- **Monitoring**: Datadog, New Relic uptime tracking
  - System availability metrics
- **Logs**: Application error logs
  - Critical error count from Elasticsearch, Splunk

**Business Purpose:**  
Enables stakeholders to:
- **Reliability Planning**: Predict failure frequency
- **SLA Compliance**: Calculate expected uptime
- **Capacity Planning**: Understand system stability under load
- **Customer Trust**: Demonstrate system reliability
- **Insurance/Compliance**: Prove system reliability for audits

**Technical Purpose:**  
Helps engineering teams:
- **System Health**: Track reliability improvements
- **Architecture Decisions**: Identify unreliable components
- **Preventive Maintenance**: Schedule maintenance before failures
- **Monitoring Gaps**: Improve failure detection
- **Resilience Engineering**: Design for failure recovery

**Extraction Method:**
```javascript
const incidents = await pagerDuty.getIncidents({
  since: last30Days,
  urgency: 'high',
  status: 'resolved'
});

const totalHours = 30 * 24; // 30 days
const mtbf = totalHours / incidents.length;

// Alternative: from monitoring
const uptime = await datadog.getUptime(serviceId, last30Days);
const failures = uptime.incidents.length;
const mtbfHours = (uptime.totalMinutes / 60) / failures;
```

**Usage in UI:**
- **Dashboard**: Hours with trend indicator
- **Reliability Chart**: MTBF over 12 months
- **Component View**: MTBF per service/component
- **Comparison**: Team vs team or service vs service
- **Alerts**: Notify when MTBF drops below 80 hours

---

### 20. System Availability

**Purpose:**  
Measures uptime percentage. Critical for user satisfaction and SLA compliance. Industry standard is "number of nines" (99.9%, 99.99%, etc.).

**Calculation Method:**
```
System Availability = (Total Uptime / Total Time) × 100

Downtime Allowance by "Nines":
  - 99% (two nines): 7.2 hours/month downtime
  - 99.9% (three nines): 43 minutes/month
  - 99.99% (four nines): 4.3 minutes/month
  - 99.999% (five nines): 26 seconds/month
  
Calculation:
  Availability = ((Total Time - Downtime) / Total Time) × 100
```

**Data Sources:**
- **Monitoring**: Datadog, New Relic, Pingdom uptime
  - API: Uptime percentage over time period
- **Load Balancer**: Health check logs
  - AWS ELB, GCP Load Balancer metrics
- **Synthetic Monitoring**: External uptime monitors
  - UptimeRobot, StatusCake, Pingdom
- **APM Tools**: Application performance monitoring
  - New Relic, AppDynamics availability metrics

**Business Purpose:**  
Enables stakeholders to:
- **SLA Compliance**: Meet contractual uptime commitments
- **Revenue Protection**: Downtime directly impacts revenue
- **Customer Retention**: Poor availability drives customer churn
- **Competitive Advantage**: Reliability is a key differentiator
- **Financial Planning**: Calculate cost of downtime

**Technical Purpose:**  
Helps engineering teams:
- **Reliability Engineering**: Design for high availability
- **Incident Response**: Minimize downtime duration
- **Architecture**: Implement redundancy and failover
- **Monitoring**: Improve detection and alerting
- **Capacity Planning**: Ensure sufficient resources for uptime

**Extraction Method:**
```javascript
const uptime = await datadog.getMonitorUptime({
  monitorId: productionMonitorId,
  timeRange: 'last_30_days'
});

const availability = uptime.overall.uptime_percentage;

// Alternative: from synthetic monitoring
const checks = await pingdom.getChecks(checkId, last30Days);
const totalChecks = checks.length;
const successfulChecks = checks.filter(c => c.status === 'up').length;
const availabilityPercent = (successfulChecks / totalChecks) * 100;
```

**Usage in UI:**
- **Dashboard**: Percentage with "nines" indicator (e.g., "99.95% - Three Nines")
- **Uptime Chart**: Daily availability over 90 days
- **Downtime Calendar**: Visual calendar showing outages
- **SLA Dashboard**: Current vs target availability
- **Alerts**: Critical alert when availability drops below 99.9%

---

## Performance Testing Metrics

### 21. Response Time Percentiles (P50, P95, P99)

**Purpose:**  
Measures API/endpoint performance at different percentiles. P95 and P99 show worst-case user experience, not just average.

**Calculation Method:**
```
P50 (Median): 50% of requests complete in this time or less
P95: 95% of requests complete in this time or less
P99: 99% of requests complete in this time or less

Example:
  100 requests with response times from 50ms to 500ms
  P50 = 150ms (50th fastest request)
  P95 = 450ms (95th fastest request)
  P99 = 490ms (99th fastest request)
  
Targets:
  P50 < 100ms: Excellent
  P95 < 500ms: Good
  P99 < 1000ms: Acceptable
```

**Data Sources:**
- **APM Tools**: New Relic, Datadog, AppDynamics
  - API: Transaction response time percentiles
- **Load Balancers**: AWS ALB, NGINX access logs
  - Parse logs for request duration
- **Application Logs**: Structured logging with duration
  - Elasticsearch, Splunk queries for percentiles
- **Load Testing**: JMeter, k6, Gatling results
  - Test report percentile calculations

**Business Purpose:**  
Enables stakeholders to:
- **User Experience**: P95/P99 show real user pain points
- **SLA Definition**: Set realistic performance SLAs
- **Capacity Planning**: Understand performance under load
- **Cost Optimization**: Right-size infrastructure
- **Competitive Analysis**: Compare performance to competitors

**Technical Purpose:**  
Helps engineering teams:
- **Performance Optimization**: Identify slow endpoints
- **Caching Strategy**: Target high-latency endpoints for caching
- **Database Tuning**: Find slow queries
- **Architecture Decisions**: Identify services needing optimization
- **Alerting**: Set meaningful performance alerts

**Extraction Method:**
```javascript
const metrics = await datadog.getMetrics({
  query: 'avg:trace.web.request.duration{service:api}',
  from: Date.now() - 3600000, // Last hour
  to: Date.now()
});

const responseTimes = metrics.series[0].pointlist.map(p => p[1]);
responseTimes.sort((a, b) => a - b);

const p50 = responseTimes[Math.floor(responseTimes.length * 0.50)];
const p95 = responseTimes[Math.floor(responseTimes.length * 0.95)];
const p99 = responseTimes[Math.floor(responseTimes.length * 0.99)];
```

**Usage in UI:**
- **Dashboard**: Three cards showing P50, P95, P99 with color coding
- **Trend Chart**: Line chart showing percentiles over 24 hours
- **Endpoint Comparison**: Table comparing percentiles across endpoints
- **Distribution**: Histogram showing response time distribution
- **Alerts**: Notify when P95 exceeds 500ms

---

## Summary: Metrics Quick Reference

| Metric | Purpose | Target | Primary Source |
|--------|---------|--------|----------------|
| QA Score | Overall quality health | >90 | Composite (Coverage, Defects, Quality) |
| Technical Debt | Code health & velocity impact | <30 | SonarQube + Git + CI + Jira |
| Task Sizing Accuracy | Estimation quality | 0.85-1.15 | Jira + Git + CI |
| Test Coverage | Code tested | >70% | Jest/Jacoco/Coverage.py |
| Flakiness Rate | Test reliability | <2% | CI test runner logs |
| Defect Density | Code quality | <0.5/1k LOC | Jira + SonarQube |
| Defect Escape Rate | Testing effectiveness | <5% | Jira (prod vs all bugs) |
| Build Time | CI/CD speed | <10 min | Jenkins/CircleCI |
| Deployment Frequency | Release cadence | Daily | ArgoCD/Spinnaker |
| Lead Time | Code to production | <1 day | Git + CI + CD |
| MTTR | Incident recovery | <1 hour | PagerDuty/Jira |
| Change Failure Rate | Deployment quality | <5% | CD tools + Incidents |
| Sprint Velocity | Team capacity | Stable ±10% | Jira story points |
| Commitment Rate | Planning accuracy | >85% | Jira sprint data |
| Carryover | Sprint execution | <10% | Jira incomplete stories |
| First-Time Pass | Dev quality | >75% | Jira workflow history |
| Automation Coverage | Test automation | >70% | TestRail/test results |
| Automation ROI | Automation value | >200% | Time tracking + test data |
| MTBF | System stability | >100 hrs | PagerDuty/monitoring |
| Availability | Uptime | >99.9% | Datadog/Pingdom |
| Response Time P95 | Performance | <500ms | APM tools/logs |

---

## Implementation Priority

### Phase 1: Foundation (Weeks 1-4)
1. QA Score
2. Test Coverage
3. Defect Escape Rate
4. Sprint Velocity
5. Build Time

### Phase 2: DORA Metrics (Weeks 5-8)
6. Deployment Frequency
7. Lead Time for Changes
8. MTTR
9. Change Failure Rate

### Phase 3: Advanced Quality (Weeks 9-12)
10. Technical Debt Score
11. Task Sizing Accuracy
12. Flakiness Rate
13. Defect Density

### Phase 4: Process & Performance (Weeks 13-16)
14. Sprint Commitment/Carryover
15. First-Time Pass Rate
16. Automation Coverage/ROI
17. Response Time Percentiles
18. MTBF & Availability

---

**Document Version:** 1.0  
**Last Updated:** November 24, 2025  
**Maintained By:** QA Dashboard Team

