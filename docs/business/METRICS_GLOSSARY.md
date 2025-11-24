# Metrics Glossary - Complete Reference

This document provides an extensive explanation of every individual metric used in the QA Dashboard, including atomic metrics and their role in composite calculations.

---

## Table of Contents

### Atomic Metrics (Raw Data Points)
1. [SonarDebt_minutes](#sonardebt_minutes)
2. [LOC (Lines of Code)](#loc-lines-of-code)
3. [ChangeFrequency](#changefrequency)
4. [CyclomaticComplexity](#cyclomaticcomplexity)
5. [FailedBuildRate](#failedbuildrate)
6. [FlakyTestRate](#flakytestrate)
7. [MTTR_pipeline](#mttr_pipeline)
8. [ProductionBugs](#productionbugs)
9. [StoryPointsCompleted](#storypointscompleted)
10. [CommitCount](#commitcount)
11. [LinesChanged](#lineschanged)
12. [PRDurationHours](#prdurationhours)
13. [BuildTimeMinutes](#buildtimeminutes)
14. [TestTimeMinutes](#testtimeminutes)
15. [TestCoverage](#testcoverage)
16. [DefectEscapeRate](#defectescaperate)
17. [CodeQualityScore](#codequalityscore)
18. [ResponseTime_P50](#responsetime_p50)
19. [ResponseTime_P95](#responsetime_p95)
20. [ResponseTime_P99](#responsetime_p99)
21. [Throughput](#throughput)
22. [ErrorRate](#errorrate)
23. [IncidentCount](#incidentcount)
24. [MTTR_incidents](#mttr_incidents)
25. [MTBF](#mtbf)
26. [SystemUptime](#systemuptime)
27. [DeploymentCount](#deploymentcount)
28. [LeadTime](#leadtime)
29. [ChangeFailureRate](#changefailurerate)

### Composite Metrics (Calculated)
30. [QA Score](#qa-score-composite)
31. [Technical Debt Score](#technical-debt-score-composite)
32. [Task Sizing Accuracy](#task-sizing-accuracy-composite)
33. [Performance Score](#performance-score-composite)

---

## Atomic Metrics

### SonarDebt_minutes

**What It Means:**  
The estimated time (in minutes) required to fix all code quality issues identified by SonarQube. This is also called "Technical Debt" or "Remediation Effort". SonarQube calculates this by analyzing code smells, bugs, vulnerabilities, and code duplications, then estimating how long it would take a developer to fix each issue.

**Why It Matters:**  
- **Velocity Impact**: High technical debt slows down feature development because developers spend time working around poor code
- **Maintenance Cost**: Directly translates to engineering hours needed to clean up the codebase
- **Risk Indicator**: High debt often correlates with more production bugs and system instability
- **Refactoring Priority**: Helps justify dedicated cleanup sprints to management
- **Trend Analysis**: Increasing debt over time signals deteriorating code quality

**Formula:**
```
SonarDebt_minutes = Sum of remediation effort for all issues

Where each issue has an estimated fix time:
  - Code Smell (Minor): 5-30 minutes
  - Code Smell (Major): 30-120 minutes
  - Bug: 30-240 minutes
  - Vulnerability: 60-480 minutes
  - Duplication: Based on duplicated lines
```

**Data Source:**
- **System**: SonarQube
- **Endpoint**: `GET /api/measures/component?component={projectKey}&metricKeys=sqale_index`
- **Response Field**: `measures[0].value` (in minutes)
- **Alternative Endpoint**: `GET /api/issues/search?componentKeys={projectKey}&resolved=false`
  - Sum the `effort` field from all issues

**Calculation Example:**
```javascript
// FROM: SonarQube API
const response = await fetch(
  'https://sonarqube.company.com/api/measures/component?component=my-project&metricKeys=sqale_index'
);
const data = await response.json();
const debtMinutes = parseInt(data.component.measures[0].value);
// Result: 12500 minutes = 208 hours = 26 developer days
```

**Business Value:**  
Enables executives to understand the "invisible tax" on development velocity. If a team has 12,500 minutes (26 days) of technical debt, and they allocate 20% of each sprint to debt paydown, it will take 5 sprints to eliminate. This justifies investment in refactoring and helps explain why new features take longer to deliver.

---

### LOC (Lines of Code)

**What It Means:**  
The total number of lines of code in the codebase, excluding comments and blank lines (also called NCLOC - Non-Comment Lines of Code). This is the actual executable code that developers maintain.

**Why It Matters:**  
- **Normalization**: Used to normalize other metrics (defect density, debt per 1k LOC)
- **Codebase Size**: Indicates complexity and maintenance burden
- **Team Capacity**: Larger codebases require more developers to maintain
- **Comparison**: Enables fair comparison between teams/projects of different sizes
- **Growth Tracking**: Shows if codebase is growing sustainably or bloating

**Formula:**
```
LOC = Total lines of code - (Comment lines + Blank lines)

Counted across all source files in the project
```

**Data Source:**
- **System**: SonarQube (primary)
- **Endpoint**: `GET /api/measures/component?component={projectKey}&metricKeys=ncloc`
- **Response Field**: `measures[0].value`
- **Alternative**: Git command
  - Command: `git ls-files '*.js' '*.ts' '*.java' | xargs wc -l`
  - Then subtract comments using language-specific parsers

**Calculation Example:**
```javascript
// FROM: SonarQube
const response = await fetch(
  'https://sonarqube.company.com/api/measures/component?component=my-project&metricKeys=ncloc'
);
const data = await response.json();
const linesOfCode = parseInt(data.component.measures[0].value);
// Result: 45000 lines of code

// Alternative FROM: Git + cloc tool
const { exec } = require('child_process');
exec('cloc . --json', (error, stdout) => {
  const data = JSON.parse(stdout);
  const loc = data.SUM.code; // Excludes comments and blanks
});
```

**Business Value:**  
Provides context for other metrics. A team with 100 bugs in 10,000 LOC (10 bugs/1k LOC) has a quality problem. The same 100 bugs in 100,000 LOC (1 bug/1k LOC) is industry-standard. LOC helps executives understand if teams are appropriately sized for their codebase.

---

### ChangeFrequency

**What It Means:**  
The number of times a specific file, module, or codebase section has been modified (committed to) within a time period (typically 30 days). High change frequency indicates "hot spots" - areas of code that are frequently touched.

**Why It Matters:**  
- **Risk Identification**: Frequently changed code is more likely to have bugs
- **Hotspot Detection**: Combined with complexity, identifies high-risk areas
- **Refactoring Priority**: Frequently changed complex code should be refactored first
- **Knowledge Concentration**: Shows which code needs the most team familiarity
- **Stability Indicator**: Stable code changes infrequently; volatile code changes often

**Formula:**
```
ChangeFrequency = Number of commits touching a file/module in last N days

For entire codebase:
  ChangeFrequency = Total commits in last N days / Number of files
```

**Data Source:**
- **System**: Git repository
- **Command**: `git log --since="30 days ago" --format="%H" -- {filepath} | wc -l`
- **Alternative**: GitHub/GitLab API
  - GitHub: `GET /repos/{owner}/{repo}/commits?path={filepath}&since={date}`
  - Count items in response array

**Calculation Example:**
```javascript
// FROM: Git command
const { exec } = require('child_process');
const filepath = 'src/services/payment.js';

exec(`git log --since="30 days ago" --format="%H" -- ${filepath} | wc -l`, 
  (error, stdout) => {
    const changeFrequency = parseInt(stdout.trim());
    // Result: 15 commits in last 30 days
  }
);

// FROM: GitHub API
const response = await fetch(
  `https://api.github.com/repos/company/project/commits?path=${filepath}&since=${thirtyDaysAgo}`
);
const commits = await response.json();
const changeFrequency = commits.length;
```

**Business Value:**  
Identifies where development effort is concentrated. If 80% of commits touch 20% of files, those files are critical to business operations and deserve extra quality attention. High change frequency in complex code signals technical debt that's actively slowing the team down.

---

### CyclomaticComplexity

**What It Means:**  
A measure of code complexity based on the number of independent paths through the code. Each decision point (if, while, for, case, &&, ||) increases complexity by 1. Higher complexity means code is harder to understand, test, and maintain.

**Why It Matters:**  
- **Bug Correlation**: Studies show bugs increase exponentially with complexity
- **Testing Difficulty**: Complex code requires more test cases for full coverage
- **Maintenance Cost**: Complex code takes longer to modify safely
- **Onboarding**: New developers struggle with high-complexity code
- **Refactoring Target**: Complexity >10 is a red flag for refactoring

**Formula:**
```
CyclomaticComplexity = E - N + 2P

Where:
  E = Number of edges in control flow graph
  N = Number of nodes in control flow graph
  P = Number of connected components (usually 1)

Simplified:
  Complexity = 1 + (number of decision points)
  
Decision points: if, else, while, for, case, &&, ||, ?, catch
```

**Data Source:**
- **System**: SonarQube
- **Endpoint**: `GET /api/measures/component?component={projectKey}&metricKeys=complexity`
- **Response Field**: `measures[0].value` (average complexity)
- **File-level**: `GET /api/measures/component_tree?component={projectKey}&metricKeys=complexity`

**Calculation Example:**
```javascript
// FROM: SonarQube
const response = await fetch(
  'https://sonarqube.company.com/api/measures/component?component=my-project&metricKeys=complexity'
);
const data = await response.json();
const avgComplexity = parseFloat(data.component.measures[0].value);
// Result: 8.5 average complexity per function

// Example code with complexity = 5:
function processPayment(amount, user) {  // +1 (function entry)
  if (amount <= 0) return false;         // +1 (if)
  if (!user.verified) return false;      // +1 (if)
  
  if (user.balance >= amount) {          // +1 (if)
    user.balance -= amount;
    return true;
  } else {                               // +1 (else)
    return false;
  }
}
// Complexity = 5
```

**Business Value:**  
Predicts maintenance costs and bug risk. A module with average complexity of 15 will cost 3-5x more to maintain than one with complexity of 5. Executives can use this to justify refactoring investments and understand why certain features take longer to develop.

---

### FailedBuildRate

**What It Means:**  
The percentage of CI/CD builds that fail (don't complete successfully). A failed build means code didn't compile, tests failed, or deployment checks didn't pass. This measures pipeline reliability and code quality at commit time.

**Why It Matters:**  
- **Developer Productivity**: Failed builds waste developer time investigating and fixing
- **Deployment Velocity**: Can't deploy if builds are failing
- **Code Quality**: High failure rate indicates poor testing practices or rushing
- **CI/CD Health**: Shows if pipeline is stable and reliable
- **Team Discipline**: Reflects whether developers run tests locally before pushing

**Formula:**
```
FailedBuildRate = (Number of Failed Builds / Total Builds) × 100

Where:
  Failed Build = Build with status: FAILURE, ABORTED, or UNSTABLE
  Total Builds = All builds in time period
  
Target: <5% is healthy, >15% indicates problems
```

**Data Source:**
- **System**: Jenkins
- **Endpoint**: `GET /job/{jobName}/api/json?tree=builds[result,timestamp]`
- **Alternative**: CircleCI
  - `GET /project/{vcs}/{org}/{repo}?limit=100`
- **Alternative**: GitHub Actions
  - `GET /repos/{owner}/{repo}/actions/runs?status=completed`

**Calculation Example:**
```javascript
// FROM: Jenkins API
const response = await fetch(
  'https://jenkins.company.com/job/my-project/api/json?tree=builds[result]'
);
const data = await response.json();
const builds = data.builds.slice(0, 100); // Last 100 builds

const failedBuilds = builds.filter(b => 
  b.result === 'FAILURE' || b.result === 'ABORTED' || b.result === 'UNSTABLE'
).length;

const failedBuildRate = (failedBuilds / builds.length) * 100;
// Result: 12.5% (12-13 failed builds out of 100)
```

**Business Value:**  
Quantifies the "tax" of poor quality on development velocity. If 15% of builds fail and each failure costs 30 minutes of developer time, that's 45 hours wasted per 100 builds. For a team doing 20 builds/day, that's 135 wasted hours per month - nearly one full-time developer's capacity lost to rework.

---

### FlakyTestRate

**What It Means:**  
The percentage of tests that produce inconsistent results - passing sometimes and failing other times without any code changes. Flaky tests are usually caused by race conditions, timing issues, external dependencies, or improper test isolation.

**Why It Matters:**  
- **Trust Erosion**: Teams ignore test failures if tests are flaky
- **Time Waste**: Developers spend hours investigating false failures
- **Deployment Delays**: Can't deploy confidently with flaky tests
- **CI/CD Reliability**: Flaky tests make pipelines unreliable
- **Real Bugs Masked**: Flaky tests can hide actual regressions

**Formula:**
```
FlakyTestRate = (Number of Flaky Tests / Total Tests) × 100

A test is flaky if:
  - It passes after retry without code changes
  - It has <95% pass rate over 30 days
  - It passes locally but fails in CI (or vice versa)
  
Target: <2% is acceptable, >5% is critical problem
```

**Data Source:**
- **System**: CI Test Runner (Jenkins, CircleCI)
- **Method 1**: Parse JUnit XML for `<rerunFailure>` or `<flakyFailure>` tags
- **Method 2**: Test analytics platforms (BuildPulse, Launchable)
  - `GET /api/v1/projects/{id}/flaky_tests?days=30`
- **Method 3**: Custom tracking of test retry counts

**Calculation Example:**
```javascript
// FROM: Jenkins Test Results API
const response = await fetch(
  'https://jenkins.company.com/job/my-project/lastBuild/testReport/api/json'
);
const data = await response.json();

// Count tests that passed after retry
const flakyTests = data.suites.flatMap(suite => 
  suite.cases.filter(test => 
    test.status === 'PASSED' && test.age > 1 // Passed but failed before
  )
);

const flakyTestRate = (flakyTests.length / data.totalCount) * 100;
// Result: 3.2% (16 flaky tests out of 500 total)

// FROM: pytest-rerunfailures plugin
// Parse pytest JSON report for tests with "rerun" > 0
const pytestReport = require('./pytest-report.json');
const flakyTests = pytestReport.tests.filter(t => t.rerun > 0);
```

**Business Value:**  
Flaky tests are expensive. If a team has 3% flaky tests (15 out of 500) and each false failure wastes 15 minutes investigating, that's 3.75 hours per build. With 10 builds/day, that's 187.5 hours/month - nearly a full developer's time wasted on false alarms. Fixing flaky tests has immediate ROI.

---

### MTTR_pipeline

**What It Means:**  
Mean Time To Repair for CI/CD pipeline failures. This measures how long it takes to fix a broken build pipeline and get it back to green (passing) state. Includes time to detect the failure, diagnose the root cause, implement a fix, and verify the fix works.

**Why It Matters:**  
- **Deployment Velocity**: Broken pipelines block all deployments
- **Developer Productivity**: Developers can't merge code while pipeline is broken
- **Incident Response**: Shows team's ability to respond to build failures
- **Process Quality**: Long MTTR indicates poor monitoring or unclear ownership
- **Opportunity Cost**: Every hour of broken pipeline is lost deployment opportunity

**Formula:**
```
MTTR_pipeline = Average(Resolution Time - Detection Time)

Where:
  Detection Time = When pipeline failure was first detected
  Resolution Time = When pipeline returned to passing state
  
Measured in: Hours or Minutes
Target: <1 hour is excellent, <4 hours is acceptable
```

**Data Source:**
- **System**: PagerDuty or Jira (incident tracking)
- **Method 1**: PagerDuty incidents tagged with "pipeline" or "build"
  - `GET /incidents?incident_key=pipeline&statuses[]=resolved`
  - Calculate: `(resolved_at - created_at) / 3600000` (ms to hours)
- **Method 2**: Jira issues with label "pipeline-failure"
  - JQL: `type=Incident AND labels=pipeline-failure AND status=Resolved`
  - Calculate: `resolutiondate - created`

**Calculation Example:**
```javascript
// FROM: PagerDuty API
const response = await fetch(
  'https://api.pagerduty.com/incidents?incident_key=pipeline&statuses[]=resolved&since=2024-10-01',
  { headers: { 'Authorization': `Token token=${apiKey}` } }
);
const data = await response.json();

const mttrValues = data.incidents.map(incident => {
  const detectionTime = new Date(incident.created_at);
  const resolutionTime = new Date(incident.resolved_at);
  const durationHours = (resolutionTime - detectionTime) / 3600000;
  return durationHours;
});

const mttr_pipeline = mttrValues.reduce((a, b) => a + b) / mttrValues.length;
// Result: 2.5 hours average time to fix broken pipeline

// FROM: Jenkins build history
// Find time between failed build and next successful build
const builds = await jenkins.getBuilds(jobName, 100);
const failures = builds.filter(b => b.result === 'FAILURE');
const mttrValues = failures.map(failure => {
  const nextSuccess = builds.find(b => 
    b.timestamp > failure.timestamp && b.result === 'SUCCESS'
  );
  return (nextSuccess.timestamp - failure.timestamp) / 3600000;
});
```

**Business Value:**  
Broken pipelines are deployment blockers. If MTTR_pipeline is 4 hours and the pipeline breaks twice per week, that's 8 hours per week where no deployments can happen. For a team doing continuous deployment, this directly impacts time-to-market. Reducing MTTR from 4 hours to 1 hour unlocks 6 additional deployment windows per week.

---

### ProductionBugs

**What It Means:**  
The count of bugs discovered in the production environment by end users or monitoring systems. These are defects that escaped all testing phases (unit, integration, QA, staging) and made it to live customers. This is the most critical quality metric because it directly impacts users.

**Why It Matters:**  
- **Customer Impact**: Production bugs directly harm user experience
- **Revenue Risk**: Critical bugs can cause customer churn and lost sales
- **Brand Damage**: Public bugs damage company reputation
- **Support Cost**: Each production bug generates support tickets
- **Testing Effectiveness**: High production bugs mean testing is inadequate

**Formula:**
```
ProductionBugs = Count of bugs found in production environment

Typically measured over:
  - Last sprint (2 weeks)
  - Last month
  - Last quarter
  
Filtered by:
  - Environment = Production
  - Severity = All or Critical/Major only
```

**Data Source:**
- **System**: Jira (primary)
- **JQL**: `project={proj} AND type=Bug AND labels=production AND created>=-30d`
- **Alternative**: Filter by custom field "Environment"
  - `environment=Production AND created>=-30d`
- **Alternative**: Customer support tickets
  - Zendesk: `GET /api/v2/search.json?query=type:ticket tags:bug created>2024-10-01`

**Calculation Example:**
```javascript
// FROM: Jira API
const response = await fetch(
  'https://jira.company.com/rest/api/3/search',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql: 'project=PROJ AND type=Bug AND labels=production AND created>=-30d',
      fields: ['key', 'summary', 'priority', 'created']
    })
  }
);
const data = await response.json();
const productionBugs = data.total;
// Result: 8 production bugs in last 30 days

// Breakdown by severity
const criticalBugs = data.issues.filter(i => 
  i.fields.priority.name === 'Critical'
).length;
const majorBugs = data.issues.filter(i => 
  i.fields.priority.name === 'Major'
).length;

// FROM: Sentry/Rollbar (error tracking)
const errors = await sentry.getIssues({
  project: projectId,
  query: 'is:unresolved',
  statsPeriod: '30d'
});
```

**Business Value:**  
Production bugs have measurable costs. If each critical bug costs $10K in lost revenue, support time, and engineering effort, and a team has 3 critical bugs per month, that's $360K annual cost. Reducing production bugs from 8 to 4 per month saves $240K/year. This justifies investment in better testing, staging environments, and quality processes.

---

### StoryPointsCompleted

**What It Means:**  
The sum of story points for all user stories marked as "Done" in a sprint or time period. Story points are a relative measure of effort/complexity assigned to work items during sprint planning. This measures team throughput and capacity.

**Why It Matters:**  
- **Velocity Tracking**: Primary metric for sprint planning
- **Capacity Planning**: Predicts how much work team can complete
- **Forecasting**: Enables roadmap and release planning
- **Productivity Baseline**: Normalizes other metrics (bugs per story point)
- **Team Comparison**: Allows comparing teams of different sizes

**Formula:**
```
StoryPointsCompleted = Sum of story points for all stories in "Done" status

For a sprint:
  StoryPointsCompleted = Σ(story.storyPoints) where story.status = 'Done'
  
Typical range: 20-60 points per 2-week sprint for a 5-person team
```

**Data Source:**
- **System**: Jira
- **JQL**: `sprint={sprintId} AND status=Done AND type=Story`
- **Field**: `customfield_10016` (story points - field ID varies)
- **API**: `GET /rest/api/3/search?jql={jql}&fields=customfield_10016`

**Calculation Example:**
```javascript
// FROM: Jira API
const response = await fetch(
  'https://jira.company.com/rest/api/3/search',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql: 'sprint=123 AND status=Done AND type=Story',
      fields: ['customfield_10016'] // Story points field
    })
  }
);
const data = await response.json();

const storyPointsCompleted = data.issues.reduce((sum, issue) => {
  const points = issue.fields.customfield_10016 || 0;
  return sum + points;
}, 0);
// Result: 45 story points completed in sprint

// Calculate velocity (average over last 3 sprints)
const sprints = [123, 122, 121];
const velocities = await Promise.all(
  sprints.map(sprintId => getStoryPointsCompleted(sprintId))
);
const avgVelocity = velocities.reduce((a,b) => a+b) / velocities.length;
```

**Business Value:**  
Enables predictable delivery. If a team's average velocity is 40 points/sprint and a feature is estimated at 120 points, executives know it will take 3 sprints. This allows accurate roadmap planning, resource allocation, and stakeholder communication. Stable velocity also indicates healthy team dynamics and sustainable pace.

---


### CommitCount

**What It Means:**  
The total number of Git commits made for a specific story, feature, or time period. Each commit represents a saved change to the codebase. High commit counts can indicate either thorough incremental development or excessive rework.

**Why It Matters:**  
- **Work Effort Signal**: More commits often means more work invested
- **Development Style**: Shows if team commits frequently (good) or in large batches (risky)
- **Rework Indicator**: Excessive commits on one story may indicate unclear requirements
- **Collaboration**: Multiple developers committing shows pair programming or collaboration
- **Estimation Input**: Historical commit counts help estimate future work

**Formula:**
```
CommitCount = Number of commits in time period or for specific story

For a story:
  CommitCount = Count of commits with story key in message
  
For a time period:
  CommitCount = Total commits between start and end date
```

**Data Source:**
- **System**: Git repository
- **Command**: `git log --grep="PROJ-123" --format="%H" | wc -l`
- **Alternative**: GitHub API
  - `GET /repos/{owner}/{repo}/commits?since={date}&until={date}`
- **Alternative**: GitLab API
  - `GET /projects/{id}/repository/commits?since={date}`

**Calculation Example:**
```javascript
// FROM: Git command
const { exec } = require('child_process');
const storyKey = 'PROJ-123';

exec(`git log --grep="${storyKey}" --format="%H" | wc -l`, 
  (error, stdout) => {
    const commitCount = parseInt(stdout.trim());
    // Result: 12 commits for this story
  }
);

// FROM: GitHub API
const response = await fetch(
  `https://api.github.com/repos/company/project/commits?since=${startDate}&until=${endDate}`
);
const commits = await response.json();
const commitCount = commits.length;

// Filter commits by story key in message
const storyCommits = commits.filter(c => 
  c.commit.message.includes(storyKey)
).length;
```

**Business Value:**  
Helps understand actual work effort vs estimates. If a 3-point story consistently takes 20+ commits while 5-point stories take 10 commits, the estimation is wrong. This data improves future estimation accuracy and helps identify stories that need better requirements definition.

---

### LinesChanged

**What It Means:**  
The total number of lines added plus lines deleted in commits. This measures the scope of code changes. Large changes are riskier and harder to review than small changes.

**Why It Matters:**  
- **Change Magnitude**: Shows how much code was touched
- **Review Complexity**: Large PRs (>500 lines) are hard to review thoroughly
- **Risk Assessment**: More lines changed = higher chance of bugs
- **Refactoring Detection**: Large line changes with no feature work indicates refactoring
- **Productivity Signal**: Combined with time, shows development speed

**Formula:**
```
LinesChanged = Lines Added + Lines Deleted

For a commit:
  LinesChanged = Additions + Deletions
  
For a story:
  LinesChanged = Sum of (additions + deletions) across all commits
```

**Data Source:**
- **System**: Git repository
- **Command**: `git log --grep="PROJ-123" --numstat --format=""`
  - Parse output: `awk '{add+=$1; del+=$2} END {print add+del}'`
- **Alternative**: GitHub API
  - `GET /repos/{owner}/{repo}/pulls/{pr_number}`
  - Fields: `additions + deletions`

**Calculation Example:**
```javascript
// FROM: Git command
const { exec } = require('child_process');
const storyKey = 'PROJ-123';

exec(
  `git log --grep="${storyKey}" --numstat --format="" | awk '{add+=$1; del+=$2} END {print add+del}'`,
  (error, stdout) => {
    const linesChanged = parseInt(stdout.trim());
    // Result: 450 lines changed (250 added, 200 deleted)
  }
);

// FROM: GitHub Pull Request API
const response = await fetch(
  `https://api.github.com/repos/company/project/pulls/${prNumber}`
);
const pr = await response.json();
const linesChanged = pr.additions + pr.deletions;

// Breakdown
console.log(`Added: ${pr.additions}, Deleted: ${pr.deletions}, Changed: ${linesChanged}`);
```

**Business Value:**  
Correlates with bug risk and review quality. Studies show PRs over 400 lines have 90% more defects than PRs under 200 lines. Teams can use this to enforce PR size limits, improving code quality. Also helps estimate work - if historical data shows 5-point stories average 300 lines changed, new 5-point stories should be similar.

---

### PRDurationHours

**What It Means:**  
The time (in hours) between when a Pull Request is created and when it's merged. This measures how long code waits in review before being integrated. Long PR durations indicate review bottlenecks or process issues.

**Why It Matters:**  
- **Lead Time Component**: Major contributor to overall lead time for changes
- **Bottleneck Detection**: Long PR times indicate review capacity issues
- **Context Switching**: Developers lose context during long review cycles
- **Deployment Velocity**: Faster PR reviews enable faster deployments
- **Team Collaboration**: Shows effectiveness of code review process

**Formula:**
```
PRDurationHours = (PR Merged Time - PR Created Time) / 3600000

Measured in hours from creation to merge
  
Typical ranges:
  - <4 hours: Excellent (same-day review)
  - 4-24 hours: Good (next-day review)
  - 24-72 hours: Acceptable
  - >72 hours: Problem (review bottleneck)
```

**Data Source:**
- **System**: GitHub/GitLab
- **GitHub API**: `GET /repos/{owner}/{repo}/pulls?state=closed&sort=updated`
  - Calculate: `(merged_at - created_at) / 3600000`
- **GitLab API**: `GET /projects/{id}/merge_requests?state=merged`
  - Calculate: `(merged_at - created_at) / 3600000`

**Calculation Example:**
```javascript
// FROM: GitHub API
const response = await fetch(
  `https://api.github.com/repos/company/project/pulls?state=closed&per_page=100`
);
const prs = await response.json();

const mergedPRs = prs.filter(pr => pr.merged_at !== null);

const prDurations = mergedPRs.map(pr => {
  const created = new Date(pr.created_at);
  const merged = new Date(pr.merged_at);
  const durationHours = (merged - created) / 3600000;
  return durationHours;
});

const avgPRDuration = prDurations.reduce((a,b) => a+b) / prDurations.length;
// Result: 18.5 hours average PR duration

// Breakdown by size
const smallPRs = mergedPRs.filter(pr => pr.additions + pr.deletions < 200);
const largePRs = mergedPRs.filter(pr => pr.additions + pr.deletions > 500);
```

**Business Value:**  
Long PR review times directly impact time-to-market. If average PR duration is 48 hours and a feature requires 5 PRs, that's 10 days just waiting for reviews. Reducing PR duration from 48 to 12 hours saves 7.5 days per feature. For a team shipping 10 features/month, that's 75 days saved annually.

---

### BuildTimeMinutes

**What It Means:**  
The time (in minutes) it takes for the CI/CD system to compile code, run tests, and create deployment artifacts. This is the duration from when a build starts to when it completes (success or failure).

**Why It Matters:**  
- **Developer Productivity**: Long builds mean developers wait longer for feedback
- **Deployment Speed**: Build time is part of deployment lead time
- **CI/CD Cost**: Longer builds cost more in compute resources
- **Feedback Loop**: Fast builds enable rapid iteration
- **Optimization Target**: Shows where to invest in build optimization

**Formula:**
```
BuildTimeMinutes = (Build End Time - Build Start Time) / 60000

Measured in minutes
  
Typical ranges:
  - <5 minutes: Excellent
  - 5-10 minutes: Good
  - 10-20 minutes: Acceptable
  - >20 minutes: Needs optimization
```

**Data Source:**
- **System**: Jenkins
- **API**: `GET /job/{name}/{buildNumber}/api/json`
  - Field: `duration` (in milliseconds)
  - Convert: `duration / 60000`
- **Alternative**: CircleCI
  - `GET /project/{vcs}/{org}/{repo}/{buildNum}`
  - Field: `build_time_millis / 60000`
- **Alternative**: GitHub Actions
  - `GET /repos/{owner}/{repo}/actions/runs/{run_id}`
  - Calculate: `(updated_at - created_at) / 60000`

**Calculation Example:**
```javascript
// FROM: Jenkins API
const response = await fetch(
  `https://jenkins.company.com/job/my-project/lastBuild/api/json`
);
const build = await response.json();
const buildTimeMinutes = build.duration / 60000;
// Result: 8.2 minutes

// Calculate average over last 100 builds
const buildsResponse = await fetch(
  `https://jenkins.company.com/job/my-project/api/json?tree=builds[duration]{0,99}`
);
const data = await buildsResponse.json();
const avgBuildTime = data.builds.reduce((sum, b) => 
  sum + (b.duration / 60000), 0
) / data.builds.length;

// Breakdown by stage
const stages = build.stages; // Requires Pipeline Stage View plugin
stages.forEach(stage => {
  console.log(`${stage.name}: ${stage.durationMillis / 60000} min`);
});
```

**Business Value:**  
Build time directly impacts developer productivity. If developers trigger 10 builds/day and build time is 15 minutes, that's 2.5 hours/day waiting. For a 5-person team, that's 12.5 hours/day = 1.5 developers worth of capacity lost to waiting. Reducing build time from 15 to 5 minutes recovers 1 full developer's capacity.

---

### TestTimeMinutes

**What It Means:**  
The time (in minutes) spent executing automated tests during a build. This includes unit tests, integration tests, and end-to-end tests. Test time is usually the longest part of build time.

**Why It Matters:**  
- **Build Speed**: Test execution is often 60-80% of total build time
- **Parallelization Opportunity**: Tests can often be parallelized for speed
- **Test Efficiency**: Shows if test suite is optimized
- **Feedback Speed**: Faster tests mean faster developer feedback
- **Cost Optimization**: Test execution consumes CI/CD resources

**Formula:**
```
TestTimeMinutes = Sum of all test execution times

For parallel execution:
  TestTimeMinutes = Max(parallel test durations)
  
For sequential execution:
  TestTimeMinutes = Sum(all test durations)
```

**Data Source:**
- **System**: CI Test Runner
- **Method 1**: Parse JUnit XML
  - Sum `<testsuite time="X">` attributes
- **Method 2**: Jenkins Test Results
  - `GET /job/{name}/{buildNumber}/testReport/api/json`
  - Field: `duration` (in seconds, convert to minutes)
- **Method 3**: Test framework output
  - Jest: Parse console output for "Time:" line
  - pytest: `--durations=0` flag shows test times

**Calculation Example:**
```javascript
// FROM: JUnit XML report
const xml2js = require('xml2js');
const fs = require('fs');

const xmlData = fs.readFileSync('test-results/junit.xml', 'utf8');
xml2js.parseString(xmlData, (err, result) => {
  const testSuites = result.testsuites.testsuite;
  const testTimeMinutes = testSuites.reduce((sum, suite) => 
    sum + parseFloat(suite.$.time), 0
  ) / 60; // Convert seconds to minutes
  // Result: 15.3 minutes
});

// FROM: Jenkins API
const response = await fetch(
  `https://jenkins.company.com/job/my-project/lastBuild/testReport/api/json`
);
const testReport = await response.json();
const testTimeMinutes = testReport.duration / 60; // Convert seconds to minutes

// Breakdown by test type
console.log(`Unit tests: ${unitTestTime} min`);
console.log(`Integration tests: ${integrationTestTime} min`);
console.log(`E2E tests: ${e2eTestTime} min`);
```

**Business Value:**  
Test time optimization has high ROI. If test suite takes 20 minutes and runs 50 times/day, that's 16.7 hours/day of CI compute time. At $0.10/minute, that's $100/day = $36K/year. Optimizing tests to 10 minutes saves $18K/year in CI costs alone, plus developer productivity gains from faster feedback.

---

## Composite Metrics

### QA Score (Composite)

**What It Means:**  
A weighted composite score (0-100) that combines multiple quality dimensions into a single health indicator. This is the "North Star" metric for team quality.

**Formula:**
```
QA Score = (Coverage × 0.3) + 
           ((100 - DefectEscapeRate) × 0.25) + 
           (CodeQuality × 0.2) + 
           ((100 - Flakiness) × 0.15) + 
           (MTTRScore × 0.1)

Where:
  Coverage = Test coverage percentage (0-100)
  DefectEscapeRate = % of bugs found in production (0-100)
  CodeQuality = SonarQube quality gate score (0-100)
  Flakiness = Flaky test rate percentage (0-100)
  MTTRScore = 100 - (MTTR_hours / 24 × 100)
```

**Data Sources:**
- Coverage: Jenkins/CircleCI coverage artifacts
- DefectEscape: Jira production vs total bugs
- CodeQuality: SonarQube quality gate
- Flakiness: CI test runner logs
- MTTR: PagerDuty incidents

**Calculation:**
```javascript
const qaScore = (
  (testCoverage * 0.3) +
  ((100 - defectEscapeRate) * 0.25) +
  (codeQualityScore * 0.2) +
  ((100 - flakinessRate) * 0.15) +
  (mttrScore * 0.1)
);
```

**Business Value:**  
Single metric for executive dashboards. Instead of explaining 5 different metrics, leadership sees one number. QA Score >90 = green (ship confidently), 75-90 = yellow (monitor closely), <75 = red (quality intervention needed).

---

### Technical Debt Score (Composite)

**What It Means:**  
A weighted composite score (0-100+) quantifying technical debt from code quality, hotspots, pipeline friction, and bug density. Lower is better.

**Formula:**
```
Technical Debt Score = 
  (β1 × SonarDebtNormalized) +
  (β2 × HotspotRisk) +
  (β3 × PipelineFriction) +
  (β4 × BugDensity)

Where:
  β1 = 0.4, β2 = 0.25, β3 = 0.2, β4 = 0.15
  
  SonarDebtNormalized = (SonarDebt_minutes / LOC) × 1000
  HotspotRisk = ChangeFrequency × CyclomaticComplexity
  PipelineFriction = (FailedBuildRate × 2) + (FlakyTestRate × 1.5) + MTTR_pipeline
  BugDensity = ProductionBugs / StoryPointsCompleted
```

**Data Sources:**
- SonarQube: Debt minutes, LOC, complexity
- Git: Change frequency
- Jenkins: Failed build rate, flaky test rate
- PagerDuty: Pipeline MTTR
- Jira: Production bugs, story points

**Calculation:**
See detailed extraction in main Georgel.md document.

**Business Value:**  
Quantifies the "invisible tax" on velocity. Score of 60 means team is spending ~30% of time fighting technical debt instead of building features. Justifies refactoring sprints with concrete numbers.

---

### Task Sizing Accuracy (Composite)

**What It Means:**  
Ratio of actual effort to estimated effort. 1.0 = perfect estimation, <1.0 = overestimated, >1.0 = underestimated.

**Formula:**
```
Task Sizing Accuracy = ActualEffort / EstimatedEffort

ActualEffort = 
  (α1 × CommitCount) +
  (α2 × LinesChanged) +
  (α3 × PRDurationHours) +
  (α4 × BuildTimeMinutes) +
  (α5 × TestTimeMinutes)

EstimatedEffort = StoryPoints

Where: α1=1.0, α2=0.05, α3=2.0, α4=0.3, α5=0.2
```

**Data Sources:**
- Jira: Story points
- Git: Commits, lines changed
- GitHub: PR duration
- Jenkins: Build time, test time

**Calculation:**
See detailed extraction in main Georgel.md document.

**Business Value:**  
Improves sprint planning accuracy. If team consistently has 1.3x accuracy (underestimates by 30%), adjust future sprint commitments by 0.77x to account for this. Turns estimation from guesswork into data-driven planning.

---

## Quick Reference Table

| Metric | Unit | Source | Target | Business Impact |
|--------|------|--------|--------|-----------------|
| SonarDebt_minutes | minutes | SonarQube | <5000 | Velocity drag |
| LOC | lines | SonarQube/Git | N/A | Normalization |
| ChangeFrequency | commits | Git | <20/month | Hotspot risk |
| CyclomaticComplexity | number | SonarQube | <10 | Bug correlation |
| FailedBuildRate | % | Jenkins | <5% | Wasted time |
| FlakyTestRate | % | CI Logs | <2% | Trust erosion |
| MTTR_pipeline | hours | PagerDuty | <1 | Deployment blocker |
| ProductionBugs | count | Jira | <5/month | Customer impact |
| StoryPointsCompleted | points | Jira | 30-50 | Velocity baseline |
| CommitCount | count | Git | 5-15/story | Effort signal |
| LinesChanged | lines | Git | <400/PR | Review quality |
| PRDurationHours | hours | GitHub | <24 | Lead time |
| BuildTimeMinutes | minutes | Jenkins | <10 | Feedback speed |
| TestTimeMinutes | minutes | CI | <8 | CI cost |

---

**Document Version:** 1.0  
**Last Updated:** November 24, 2025  
**Maintained By:** QA Dashboard Team

