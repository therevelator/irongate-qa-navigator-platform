# Metrics Calculation Examples

This document shows how to use the real metric calculation functions in production.

## Technical Debt Score

### Example Usage

```typescript
import { calculateTechnicalDebtScore } from './utils/metricsAggregator';

// Example: Calculate technical debt for a team
const teamTechnicalDebt = calculateTechnicalDebtScore(
  // SonarQube data
  sonarDebtMinutes: 12500,        // From SonarQube API: /api/measures/component?component=project-key&metricKeys=sqale_index
  linesOfCode: 45000,             // From SonarQube API: /api/measures/component?component=project-key&metricKeys=ncloc
  
  // Code hotspots (from Git analytics)
  changeFrequency: 15,            // Number of commits to this file/module in last 30 days
  cyclomaticComplexity: 8.5,      // From SonarQube: /api/measures/component?metricKeys=complexity
  
  // CI/CD metrics
  failedBuildRate: 12.5,          // % from Jenkins/CircleCI: (failed builds / total builds) * 100
  flakyTestRate: 3.2,             // % from test reports: (flaky tests / total tests) * 100
  mttrPipeline: 2.5,              // Hours from incident tracking: avg time to fix broken pipeline
  
  // Product quality
  productionBugs: 8,              // From Jira: count of bugs with label "production" in last sprint
  storyPointsCompleted: 45        // From Jira: sum of story points in "Done" status
);

console.log(`Technical Debt Score: ${teamTechnicalDebt.toFixed(2)}`);
// Lower is better. Typical range: 15-85
// < 30 = Excellent (green)
// 30-60 = Moderate (yellow)
// > 60 = High debt (red)
```

### Data Sources

| Metric | Source | API Endpoint / Query |
|--------|--------|---------------------|
| `sonarDebtMinutes` | SonarQube | `GET /api/measures/component?component={project}&metricKeys=sqale_index` |
| `linesOfCode` | SonarQube | `GET /api/measures/component?component={project}&metricKeys=ncloc` |
| `changeFrequency` | Git | `git log --since="30 days ago" --format="%H" -- {file} \| wc -l` |
| `cyclomaticComplexity` | SonarQube | `GET /api/measures/component?component={project}&metricKeys=complexity` |
| `failedBuildRate` | Jenkins/CircleCI | `(failed_builds / total_builds) * 100` from build history API |
| `flakyTestRate` | Test Runner | Parse test XML reports for retries/reruns |
| `mttrPipeline` | PagerDuty/Jira | Average resolution time for "pipeline failure" incidents |
| `productionBugs` | Jira | `project = PROJ AND type = Bug AND labels = production AND created >= -30d` |
| `storyPointsCompleted` | Jira | `project = PROJ AND status = Done AND sprint = {current}` |

---

## Task Sizing Accuracy

### Example Usage

```typescript
import { calculateTaskSizingAccuracy } from './utils/metricsAggregator';

// Example: Calculate sizing accuracy for a completed story
const sizingAccuracy = calculateTaskSizingAccuracy(
  // Estimation
  storyPoints: 5,                 // From Jira: story.fields.customfield_10016 (story points field)
  
  // Real engineering signals
  commitCount: 12,                // From Git: number of commits for this story
  linesChanged: 450,              // From Git: total lines added + deleted
  prDurationHours: 18.5,          // From GitHub/GitLab: time from PR open to merge
  buildTimeMinutes: 8.2,          // From CI: average build time for this story's commits
  testTimeMinutes: 15.3           // From CI: average test execution time
);

console.log(`Sizing Accuracy: ${sizingAccuracy.toFixed(2)}x`);
// Interpretation:
// 1.0 = Perfect estimation
// < 1.0 = Overestimated (e.g., 0.8 = took 80% of estimated effort)
// > 1.0 = Underestimated (e.g., 1.3 = took 130% of estimated effort)
```

### Data Sources

| Metric | Source | API Endpoint / Query |
|--------|--------|---------------------|
| `storyPoints` | Jira | `GET /rest/api/3/issue/{issueKey}` → `fields.customfield_10016` |
| `commitCount` | Git | `git log --grep="PROJ-123" --format="%H" \| wc -l` |
| `linesChanged` | Git | `git log --grep="PROJ-123" --numstat --format="" \| awk '{add+=$1; del+=$2} END {print add+del}'` |
| `prDurationHours` | GitHub | `GET /repos/{owner}/{repo}/pulls/{pr}` → `(merged_at - created_at) / 3600` |
| `buildTimeMinutes` | Jenkins | Average of `build.duration / 60000` for commits in story |
| `testTimeMinutes` | CI Reports | Parse test execution time from JUnit XML or test runner logs |

---

## Integration Example

### Complete Team Metrics Calculation

```typescript
import { calculateTechnicalDebtScore, calculateTaskSizingAccuracy } from './utils/metricsAggregator';

async function calculateTeamMetrics(teamId: string) {
  // Fetch data from various sources
  const sonarData = await fetchSonarQubeMetrics(teamId);
  const gitData = await fetchGitAnalytics(teamId);
  const ciData = await fetchCIMetrics(teamId);
  const jiraData = await fetchJiraMetrics(teamId);
  
  // Calculate Technical Debt Score
  const technicalDebtScore = calculateTechnicalDebtScore(
    sonarData.debtMinutes,
    sonarData.linesOfCode,
    gitData.changeFrequency,
    sonarData.complexity,
    ciData.failedBuildRate,
    ciData.flakyTestRate,
    ciData.mttrPipeline,
    jiraData.productionBugs,
    jiraData.storyPointsCompleted
  );
  
  // Calculate Task Sizing Accuracy (average across all stories in sprint)
  const completedStories = jiraData.completedStories;
  const sizingAccuracies = await Promise.all(
    completedStories.map(async (story) => {
      const storyGitData = await fetchStoryGitMetrics(story.key);
      const storyCIData = await fetchStoryCIMetrics(story.key);
      
      return calculateTaskSizingAccuracy(
        story.storyPoints,
        storyGitData.commitCount,
        storyGitData.linesChanged,
        storyGitData.prDurationHours,
        storyCIData.buildTimeMinutes,
        storyCIData.testTimeMinutes
      );
    })
  );
  
  const avgSizingAccuracy = sizingAccuracies.reduce((a, b) => a + b, 0) / sizingAccuracies.length;
  
  return {
    technicalDebtScore: Number(technicalDebtScore.toFixed(1)),
    taskSizingAccuracy: Number(avgSizingAccuracy.toFixed(2))
  };
}
```

---

## Thresholds & Interpretation

### Technical Debt Score

| Range | Status | Meaning | Action |
|-------|--------|---------|--------|
| 0-30 | 🟢 Excellent | Low technical debt, healthy codebase | Maintain current practices |
| 30-60 | 🟡 Moderate | Some debt accumulating | Schedule refactoring sprints |
| 60-100+ | 🔴 High | Significant debt, high risk | Immediate action required |

### Task Sizing Accuracy

| Range | Status | Meaning | Action |
|-------|--------|---------|--------|
| 0.85-1.15 | 🟢 Accurate | Estimates within ±15% | Good estimation practices |
| 0.70-0.85 or 1.15-1.30 | 🟡 Moderate | Estimates off by 15-30% | Review estimation process |
| <0.70 or >1.30 | 🔴 Poor | Estimates off by >30% | Estimation training needed |

---

## Production Implementation Checklist

- [ ] Set up SonarQube integration
- [ ] Configure Git analytics pipeline
- [ ] Connect to CI/CD system (Jenkins/CircleCI/GitHub Actions)
- [ ] Set up Jira API access
- [ ] Create scheduled job to calculate metrics daily
- [ ] Store historical data in database
- [ ] Set up alerts for threshold violations
- [ ] Create dashboard visualizations
- [ ] Document team-specific weight adjustments (beta/alpha parameters)
