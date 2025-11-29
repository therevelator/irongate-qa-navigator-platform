# IronGate QA Navigator - Metrics and Calculations Reference

## Table of Contents
1. [Overview](#overview)
2. [QA Score Calculation](#qa-score-calculation)
3. [Quality Metrics](#quality-metrics)
4. [Speed & Efficiency Metrics](#speed--efficiency-metrics)
5. [Agile & Process Metrics](#agile--process-metrics)
6. [Reliability Metrics](#reliability-metrics)
7. [Developer Productivity Metrics](#developer-productivity-metrics)
8. [Status Thresholds](#status-thresholds)
9. [Data Flow](#data-flow)

---

## Overview

The IronGate QA Navigator uses 22 team-level metrics and 6 developer-level metrics to provide comprehensive quality engineering insights. All metrics are calculated from raw inputs using specific formulas, then aggregated into an overall **QA Score**.

### Key Principles
- **Higher is better** for most metrics (coverage, pass rates, efficiency)
- **Lower is better** for negative metrics (defects, failures, blocked time)
- **Trends require 2+ data points** - no graphs or "vs last period" shown on day 1
- **0 is a valid input** for all numerator values (e.g., 0 production bugs = 0% defect escape rate)

---

## QA Score Calculation

The overall QA Score (0-100) is calculated using a weighted average of four key metrics:

### Formula
```
QA_Score = (Test_Coverage × 0.30) + 
           ((100 - Defect_Escape_Rate) × 0.25) + 
           (Build_Success_Rate × 0.25) + 
           (Code_Quality_Score × 0.20)
```

### Component Breakdown

| Component | Weight | Description | Impact on Score |
|-----------|--------|-------------|-----------------|
| **Test Coverage** | 30% | % of code covered by tests | Direct: Higher coverage = higher score |
| **Defect Escape Rate** | 25% | % of bugs found in production | Inverse: Lower escape rate = higher score (100 - rate) |
| **Build Success Rate** | 25% | % of successful deployments | Direct: Higher success = higher score |
| **Code Quality Score** | 20% | Static analysis score (0-100) | Direct: Higher quality = higher score |

### Build Success Rate Derivation
Build Success Rate is calculated from Change Failure Rate:
```
Build_Success_Rate = 100 - Change_Failure_Rate
```

If Change Failure Rate is not provided, defaults to 85%.

### Example Calculations

**Excellent Team (Target: 100%)**
```
Test Coverage: 100% × 0.30 = 30.00
Defect Escape: (100 - 0%) × 0.25 = 25.00
Build Success: 100% × 0.25 = 25.00
Code Quality: 100 × 0.20 = 20.00
-----------------------------------
QA Score = 100.00
```

**Good Team (Target: ~85%)**
```
Test Coverage: 85% × 0.30 = 25.50
Defect Escape: (100 - 3%) × 0.25 = 24.25
Build Success: 95% × 0.25 = 23.75
Code Quality: 85 × 0.20 = 17.00
-----------------------------------
QA Score = 90.50
```

**Problem Case: Why might score drop unexpectedly?**
If you enter 0 for a metric that's used directly (not inversely), the score drops:
```
Test Coverage: 0% × 0.30 = 0.00  ← This zeroes out 30% of score!
Defect Escape: (100 - 0%) × 0.25 = 25.00
Build Success: 100% × 0.25 = 25.00
Code Quality: 85 × 0.20 = 17.00
-----------------------------------
QA Score = 67.00  ← Dropped significantly!
```

### QA Score Status Thresholds
| Score Range | Status | Color |
|-------------|--------|-------|
| ≥ 85 | Good | Green |
| 70-84 | Warning | Yellow/Orange |
| < 70 | Critical | Red |

---

## Quality Metrics

### 1. Test Coverage
**Category:** Quality  
**Unit:** %  
**Target:** >80% for critical paths, >70% overall  
**Higher is Better:** Yes

**Formula:**
```
Test_Coverage = (Lines_Executed_By_Tests ÷ Total_Lines_Of_Code) × 100
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Lines Executed by Tests | Number | 0 | Lines of code executed during test runs |
| Total Lines of Code | Number | 1 | Total LOC in the codebase |

**Example:**
```
Lines Executed: 8,500
Total LOC: 10,000
Coverage = (8500 ÷ 10000) × 100 = 85%
```

**Status Thresholds:**
- Good: ≥ 80%
- Warning: ≥ 70%
- Critical: < 70%

---

### 2. Test Flakiness Rate
**Category:** Quality  
**Unit:** %  
**Target:** <2%  
**Lower is Better:** Yes

**Formula:**
```
Flakiness_Rate = (Flaky_Test_Runs ÷ Total_Test_Runs) × 100
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Flaky Test Runs | Number | 0 | Tests with inconsistent pass/fail results |
| Total Test Runs | Number | 1 | Total number of test executions |

**Example:**
```
Flaky Runs: 5
Total Runs: 500
Flakiness = (5 ÷ 500) × 100 = 1%
```

**Status Thresholds:**
- Good: ≤ 2%
- Warning: ≤ 5%
- Critical: > 5%

---

### 3. Defect Density
**Category:** Quality  
**Unit:** /1k LOC  
**Target:** <0.5 per 1k LOC  
**Lower is Better:** Yes

**Formula:**
```
Defect_Density = Total_Bugs ÷ Lines_Of_Code_In_Thousands
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Total Bugs Found | Number | 0 | All bugs discovered in the codebase |
| Lines of Code (thousands) | Number | 0.1 | Total LOC divided by 1000 |

**Example:**
```
Total Bugs: 12
LOC (thousands): 50
Density = 12 ÷ 50 = 0.24/1k LOC
```

**Status Thresholds:**
- Good: ≤ 0.5
- Warning: ≤ 1.0
- Critical: > 1.0

---

### 4. Defect Escape Rate
**Category:** Quality  
**Unit:** %  
**Target:** <5%  
**Lower is Better:** Yes  
**Affects QA Score:** Yes (25% weight, inverted)

**Formula:**
```
Defect_Escape_Rate = (Production_Bugs ÷ Total_Bugs) × 100
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Production Bugs | Number | 0 | Bugs found in production environment |
| Total Bugs Found | Number | 1 | All bugs (dev + staging + prod) |

**Example:**
```
Production Bugs: 3
Total Bugs: 50
Escape Rate = (3 ÷ 50) × 100 = 6%
```

**Special Case - 0 Production Bugs:**
```
Production Bugs: 0
Total Bugs: 50
Escape Rate = (0 ÷ 50) × 100 = 0%  ← Perfect score!
```

**Impact on QA Score:**
```
With 0% escape rate: (100 - 0) × 0.25 = 25 points (maximum)
With 10% escape rate: (100 - 10) × 0.25 = 22.5 points
With 50% escape rate: (100 - 50) × 0.25 = 12.5 points
```

**Status Thresholds:**
- Good: ≤ 5%
- Warning: ≤ 10%
- Critical: > 10%

---

### 5. Code Quality Score
**Category:** Quality  
**Unit:** /100  
**Target:** >85  
**Higher is Better:** Yes  
**Affects QA Score:** Yes (20% weight)

**Formula:**
```
Code_Quality = (Maintainability × 0.40) + (Reliability × 0.35) + (Security × 0.25)
```

**Inputs:**
| Input | Type | Min | Max | Description |
|-------|------|-----|-----|-------------|
| Maintainability | Number | 0 | 100 | SonarQube maintainability rating |
| Reliability | Number | 0 | 100 | SonarQube reliability rating |
| Security | Number | 0 | 100 | SonarQube security rating |

**Rating Conversion (SonarQube):**
- A = 100
- B = 80
- C = 60
- D = 40
- E = 20

**Example:**
```
Maintainability: 85 (A-)
Reliability: 90 (A)
Security: 95 (A)
Quality = (85 × 0.40) + (90 × 0.35) + (95 × 0.25)
        = 34 + 31.5 + 23.75 = 89.25
```

**Status Thresholds:**
- Good: ≥ 85
- Warning: ≥ 70
- Critical: < 70

---

## Speed & Efficiency Metrics

### 6. Average Build Time
**Category:** Speed  
**Unit:** minutes  
**Target:** <10 minutes  
**Lower is Better:** Yes

**Source:** `kpi_snapshots.avg_build_time_minutes`

**Formula:**
```
Avg_Build_Time = Total_Build_Time ÷ Build_Count
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Total Build Time (min) | Number | 0 | Sum of all build durations |
| Number of Builds | Number | 1 | Count of builds in period |

**Example:**
```
Total Build Time: 450 min
Build Count: 30
Avg Build Time = 450 ÷ 30 = 15 min
```

**Status Thresholds:**
- Good: ≤ 10 min
- Warning: ≤ 15 min
- Critical: > 15 min

---

### 7. Test Execution Time
**Category:** Speed  
**Unit:** minutes  
**Target:** <30 min full suite, <5 min critical  
**Lower is Better:** Yes

**Formula:**
```
Test_Execution_Time = Direct input (total suite duration)
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Test Suite Duration (min) | Number | 0 | Time to run complete test suite |

**Status Thresholds:**
- Good: ≤ 30 min
- Warning: ≤ 45 min
- Critical: > 45 min

---

### 8. Deployment Frequency
**Category:** Speed  
**Unit:** /week  
**Target:** >5/week (daily for elite teams)  
**Higher is Better:** Yes

**Formula:**
```
Deployment_Frequency = Successful_Deploys ÷ Weeks
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Successful Production Deploys | Number | 0 | Count of successful deployments |
| Number of Weeks | Number | 1 | Time period in weeks |

**Example:**
```
Successful Deploys: 12
Weeks: 2
Frequency = 12 ÷ 2 = 6/week
```

**Status Thresholds (DORA):**
- Good (Elite): ≥ 5/week
- Warning (High): ≥ 2/week
- Critical: < 2/week

---

### 9. Lead Time for Changes
**Category:** Speed  
**Unit:** days  
**Target:** <1 day (elite), <7 days (high)  
**Lower is Better:** Yes

**Formula:**
```
Lead_Time = Average(Deploy_Timestamp - Commit_Timestamp)
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Average Lead Time (days) | Number | 0 | Median time from commit to production |

**Status Thresholds (DORA):**
- Good (Elite): ≤ 1 day
- Warning (High): ≤ 7 days
- Critical: > 7 days

---

### 10. Mean Time to Repair (MTTR)
**Category:** Speed  
**Unit:** hours  
**Target:** <1 hour (elite), <24 hours (high)  
**Lower is Better:** Yes

**Source:** `kpi_snapshots.mttr_hours`

**Formula:**
```
MTTR = Total_Repair_Time ÷ Incident_Count
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Total Repair Time (hours) | Number | 0 | Sum of all incident resolution times |
| Number of Incidents | Number | 1 | Count of incidents in period |

**Example:**
```
Total Repair Time: 24 hours
Incident Count: 5
MTTR = 24 ÷ 5 = 4.8 hours
```

**Status Thresholds (DORA):**
- Good (Elite): ≤ 1 hour
- Warning (High): ≤ 24 hours
- Critical: > 24 hours

---

### 11. Parallel Test Efficiency
**Category:** Speed  
**Unit:** %  
**Target:** >80% (near-linear scaling)  
**Higher is Better:** Yes

**Formula:**
```
Parallel_Efficiency = (Sequential_Time ÷ Parallel_Time) ÷ Workers × 100
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Sequential Execution Time (min) | Number | 0 | Time to run tests sequentially |
| Parallel Execution Time (min) | Number | 1 | Time with parallel execution |
| Number of Workers | Number | 1 | Parallel execution workers/nodes |

**Example:**
```
Sequential Time: 120 min
Parallel Time: 35 min
Workers: 4
Efficiency = (120 ÷ 35) ÷ 4 × 100 = 85.7%
```

**Status Thresholds:**
- Good: ≥ 80%
- Warning: ≥ 60%
- Critical: < 60%

---

### 12. Environment Startup Time
**Category:** Speed  
**Unit:** minutes  
**Target:** <5 min (fast), <10 min (acceptable)  
**Lower is Better:** Yes

**Formula:**
```
Env_Startup_Time = Average(Ready_Time - Request_Time)
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Average Startup Time (min) | Number | 0 | Time to provision test environment |

**Status Thresholds:**
- Good: ≤ 5 min
- Warning: ≤ 10 min
- Critical: > 10 min

---

## Agile & Process Metrics

### 13. Sprint Velocity
**Category:** Agile  
**Unit:** points  
**Target:** Stable (±10% over 3-4 sprints)  
**Higher is Better:** Relative (consistency matters more)

**Formula:**
```
Sprint_Velocity = Sum(Story_Points WHERE status = 'Done')
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Completed Story Points | Number | 0 | Points delivered in sprint |

**Note:** Velocity should be compared to team's historical average. Absolute value varies by team size and complexity.

---

### 14. Sprint Commitment Rate
**Category:** Agile  
**Unit:** %  
**Target:** >85%  
**Higher is Better:** Yes

**Formula:**
```
Commitment_Rate = (Completed_Points ÷ Committed_Points) × 100
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Completed Story Points | Number | 0 | Points actually delivered |
| Committed Story Points | Number | 1 | Points committed at sprint start |

**Example:**
```
Completed: 40 points
Committed: 45 points
Rate = (40 ÷ 45) × 100 = 88.9%
```

**Status Thresholds:**
- Good: ≥ 85%
- Warning: ≥ 70%
- Critical: < 70%

---

### 15. Sprint Carryover
**Category:** Agile  
**Unit:** %  
**Target:** <10%  
**Lower is Better:** Yes

**Formula:**
```
Carryover = (Incomplete_Points ÷ Committed_Points) × 100
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Incomplete Story Points | Number | 0 | Points not completed |
| Committed Story Points | Number | 1 | Points committed at sprint start |

**Example:**
```
Incomplete: 5 points
Committed: 45 points
Carryover = (5 ÷ 45) × 100 = 11.1%
```

**Status Thresholds:**
- Good: ≤ 10%
- Warning: ≤ 20%
- Critical: > 20%

---

### 16. First-Time Pass Rate
**Category:** Agile  
**Unit:** %  
**Target:** >75%  
**Higher is Better:** Yes

**Formula:**
```
First_Time_Pass = (Stories_With_0_Rejections ÷ Total_Stories) × 100
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Stories Passed First Time | Number | 0 | Stories passing QA first attempt |
| Total Stories Tested | Number | 1 | All stories that went through QA |

**Example:**
```
Passed First Time: 18
Total Stories: 24
Rate = (18 ÷ 24) × 100 = 75%
```

**Status Thresholds:**
- Good: ≥ 75%
- Warning: ≥ 60%
- Critical: < 60%

---

### 17. Blocked Time
**Category:** Agile  
**Unit:** hours  
**Target:** <15 hours/sprint  
**Lower is Better:** Yes

**Formula:**
```
Blocked_Time = Sum(Unblock_Time - Block_Time)
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Total Blocked Hours | Number | 0 | Hours tickets spent blocked |

**Status Thresholds:**
- Good: ≤ 15 hours
- Warning: ≤ 25 hours
- Critical: > 25 hours

---

### 18. Test Automation Coverage
**Category:** Agile  
**Unit:** %  
**Target:** >70% regression, >50% overall  
**Higher is Better:** Yes

**Formula:**
```
Automation_Coverage = (Automated_Tests ÷ Total_Tests) × 100
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Automated Test Cases | Number | 0 | Tests that are automated |
| Total Test Cases | Number | 1 | All test cases (manual + automated) |

**Example:**
```
Automated: 350
Total: 500
Coverage = (350 ÷ 500) × 100 = 70%
```

**Status Thresholds:**
- Good: ≥ 70%
- Warning: ≥ 50%
- Critical: < 50%

---

### 19. Automation ROI
**Category:** Agile  
**Unit:** %  
**Target:** >200%  
**Higher is Better:** Yes

**Formula:**
```
Automation_ROI = ((Time_Saved - Time_Invested) ÷ Time_Invested) × 100
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Time Saved (hours) | Number | 0 | Manual testing time eliminated |
| Time Invested (hours) | Number | 1 | Automation development time |

**Example:**
```
Time Saved: 200 hours
Time Invested: 50 hours
ROI = ((200 - 50) ÷ 50) × 100 = 300%
```

**Interpretation:**
- 100% = Break even (saved = invested)
- 200% = 2x return
- 300% = 3x return

**Status Thresholds:**
- Good: ≥ 200%
- Warning: ≥ 100%
- Critical: < 100%

---

## Reliability Metrics

### 20. Change Failure Rate
**Category:** Reliability  
**Unit:** %  
**Target:** <5% (elite), <15% (high)  
**Lower is Better:** Yes  
**Affects QA Score:** Yes (via Build Success Rate)

**Formula:**
```
Change_Failure_Rate = (Failed_Deploys ÷ Total_Deploys) × 100
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Failed Deployments | Number | 0 | Deploys causing failures/rollbacks |
| Total Deployments | Number | 1 | All production deployments |

**Example:**
```
Failed Deploys: 2
Total Deploys: 25
Rate = (2 ÷ 25) × 100 = 8%
```

**Impact on QA Score:**
```
Build_Success_Rate = 100 - Change_Failure_Rate
8% failure rate → 92% success rate
92% × 0.25 = 23 points (out of 25 maximum)
```

**Status Thresholds (DORA):**
- Good (Elite): ≤ 5%
- Warning (High): ≤ 15%
- Critical: > 15%

---

### 21. Mean Time Between Failures (MTBF)
**Category:** Reliability  
**Unit:** hours  
**Target:** >100 hours  
**Higher is Better:** Yes

**Source:** `kpi_snapshots.mtbf_hours`

**Formula:**
```
MTBF = Total_Operational_Hours ÷ Failure_Count
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Total Operational Hours | Number | 0 | Hours system was running |
| Number of Failures | Number | 1 | Count of system failures |

**Example:**
```
Operational Hours: 720 (30 days)
Failures: 3
MTBF = 720 ÷ 3 = 240 hours
```

**Special Case - 0 Failures:**
If failures = 0, MTBF = Total Operational Hours (maximum possible)

**Status Thresholds:**
- Good: ≥ 100 hours
- Warning: ≥ 50 hours
- Critical: < 50 hours

---

### 22. System Availability
**Category:** Reliability  
**Unit:** %  
**Target:** >99.9% (three nines)  
**Higher is Better:** Yes

**Formula:**
```
Availability = ((Total_Time - Downtime) ÷ Total_Time) × 100
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Total Time (hours) | Number | 1 | Total monitoring period |
| Downtime (hours) | Number | 0 | Time system was unavailable |

**Example:**
```
Total Time: 720 hours (30 days)
Downtime: 2 hours
Availability = ((720 - 2) ÷ 720) × 100 = 99.72%
```

**Availability Levels:**
- 99% = 3.65 days downtime/year
- 99.9% = 8.76 hours downtime/year (three nines)
- 99.99% = 52.56 minutes downtime/year (four nines)

**Status Thresholds:**
- Good: ≥ 99.9%
- Warning: ≥ 99%
- Critical: < 99%

---

### 23. Infrastructure Failures
**Category:** Reliability  
**Unit:** count  
**Target:** <5 per sprint  
**Lower is Better:** Yes

**Formula:**
```
Infrastructure_Failures = Count of infrastructure-caused test failures
```

**Inputs:**
| Input | Type | Min | Description |
|-------|------|-----|-------------|
| Infrastructure Failure Count | Number | 0 | Test failures due to infra issues |

**Status Thresholds:**
- Good: ≤ 5
- Warning: ≤ 10
- Critical: > 10

---

## Developer Productivity Metrics

These metrics are tracked per developer and rolled up to team level.

### Happiness Score
**Unit:** 0-100  
**Higher is Better:** Yes

**Formula:**
```
Happiness = Focus_Score (40%) + Context_Score (30%) + Meeting_Score (15%) + PR_Score (7.5%) + Review_Score (7.5%)

Where:
- Focus_Score = (Focus_Hours ÷ (Focus_Hours + Meeting_Hours)) × 100 × 0.40
- Context_Score = max(0, (10 - Context_Switches) ÷ 10 × 100) × 0.30
- Meeting_Score = max(0, (4 - Meeting_Hours) ÷ 4 × 100) × 0.15
- PR_Score = max(0, (24 - PR_Merge_Time) ÷ 24 × 100) × 0.075
- Review_Score = max(0, (8 - Code_Review_Time) ÷ 8 × 100) × 0.075
```

**Developer Inputs:**
| Input | Type | Ideal | Warning |
|-------|------|-------|---------|
| PR Merge Time (hours) | Number | <4 | >24 |
| Code Review Time (hours) | Number | <2 | >8 |
| Focus Time (hours/day) | Number | >5 | <3 |
| Meeting Time (hours/day) | Number | <2 | >4 |
| Context Switches/Day | Number | <5 | >8 |

### Burnout Risk
**Levels:** Low, Moderate, High

**Calculation:**
```
Risk_Score starts at 0

Add 30 if Meeting_Time > 4 hours, 15 if > 2.5 hours
Add 30 if Focus_Time < 3 hours, 15 if < 4 hours
Add 25 if Context_Switches > 8, 10 if > 5
Add 25 if Happiness_Score < 60, 10 if < 75

Result:
- High: Risk_Score ≥ 50
- Moderate: Risk_Score ≥ 25
- Low: Risk_Score < 25
```

---

## Status Thresholds

### Color Coding
| Status | Color | Meaning |
|--------|-------|---------|
| Good | Green | Meeting or exceeding targets |
| Warning | Yellow/Orange | Below target but acceptable |
| Critical | Red | Needs immediate attention |

### Threshold Logic
For **Higher is Better** metrics:
```
if (value >= good_threshold) → Good
else if (value >= warning_threshold) → Warning
else → Critical
```

For **Lower is Better** metrics:
```
if (value <= good_threshold) → Good
else if (value <= warning_threshold) → Warning
else → Critical
```

---

## Data Flow

### 1. Input Stage
```
Manual Metrics Input Page
         ↓
    Raw Values (per metric)
         ↓
    Calculate using formulas
         ↓
    Calculated Values (22 metrics)
```

### 2. Storage Stage
```
Calculated Values
         ↓
    POST /api/metrics/manual
         ↓
    Calculate QA Score (server-side)
         ↓
    Store in kpi_snapshots table
```

### 3. Display Stage
```
kpi_snapshots table
         ↓
    GET /api/teams/{teamId}
         ↓
    Dashboard (team cards)
         +
    Team Detail View (full metrics)
```

### 4. Trend Calculation
- **Day 1:** Only current values shown, no graphs, no "vs last period"
- **Day 2+:** Compare with previous snapshot, show graphs and trends

---

## Troubleshooting

### Common Issues

**Issue: Score drops unexpectedly**
- Check if a key metric (Test Coverage, Code Quality) was set to 0
- Verify Change Failure Rate isn't accidentally high

**Issue: Metrics not saving**
- Ensure all required inputs have values
- Check for validation errors (min/max constraints)

**Issue: Graphs not showing**
- Expected on Day 1 - graphs require 2+ data points
- Check if kpi_snapshots has multiple entries for the team

**Issue: 0 values not saving**
- Fixed in latest version using nullish coalescing (??)
- Previously `value || null` converted 0 to null

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-11-29 | Initial documentation |

