# 📊 IronGate QA Navigator - Metrics & Data Sources (Part 2)

## Advanced Features #6-9: Detailed API Mappings

---

## 🚀 Feature #6: Developer Productivity

### Required Metrics & APIs

#### 1. **PR Merge Time**
**Source**: GitHub API
```
GET /repos/{owner}/{repo}/pulls?state=closed&per_page=100

Response:
{
  "created_at": "2024-11-19T10:00:00Z",
  "merged_at": "2024-11-20T14:30:00Z",
  "user": {"login": "developer1"}
}

Calculate:
- PR Merge Time = merged_at - created_at (in hours)
- Average per developer over last 30 days
```

**GitLab Alternative**:
```
GET /api/v4/projects/{id}/merge_requests?state=merged
```

**Bitbucket Alternative**:
```
GET /rest/api/1.0/projects/{project}/repos/{repo}/pull-requests?state=MERGED
```

---

#### 2. **Code Review Time**
**Source**: GitHub PR Reviews API
```
GET /repos/{owner}/{repo}/pulls/{number}/reviews

Response:
{
  "submitted_at": "2024-11-19T12:00:00Z",
  "user": {"login": "reviewer1"},
  "state": "APPROVED"
}

Calculate:
- Review Time = First review submitted_at - PR created_at
- Average per reviewer
```

---

#### 3. **Happiness Score**
**Source**: Custom Survey System

**Option 1 - Slack Bot**:
```
Weekly automated survey via Slack API:
POST /api/chat.postMessage
{
  "channel": "developer-happiness",
  "text": "Rate your satisfaction this week (1-10)",
  "blocks": [interactive rating buttons]
}

Store responses in database
```

**Option 2 - Jira Custom Field**:
```
GET /rest/api/3/user/properties/happiness_score

Store weekly happiness ratings as user properties
```

**Option 3 - Custom API**:
```
POST /api/v1/happiness-survey
{
  "developer_id": "dev-123",
  "score": 8,
  "week": "2024-W47",
  "comments": "Good sprint, clear requirements"
}

GET /api/v1/happiness-survey?developer_id=dev-123&period=30d
```

---

#### 4. **Context Switches Per Day**
**Source**: Git Commits + Jira Activity

**Git Commits**:
```
GitHub: GET /repos/{owner}/{repo}/commits?author={username}&since={date}

Response:
{
  "commits": [
    {
      "commit": {
        "message": "[PROJECT-A] Fix login bug",
        "author": {"date": "2024-11-19T10:00:00Z"}
      }
    },
    {
      "commit": {
        "message": "[PROJECT-B] Update API",
        "author": {"date": "2024-11-19T11:30:00Z"}
      }
    }
  ]
}
```

**Jira Activity**:
```
GET /rest/api/3/search?jql=assignee={username} AND updated >= -1d

Count unique projects/issues worked on per day
```

**Algorithm**:
```
1. Extract project identifiers from commits and Jira
2. Count unique projects per day
3. Context Switches = Number of different projects touched
4. High switches (>5/day) indicates fragmentation
```

---

#### 5. **Focus Time vs Meeting Time**
**Source**: Calendar API

**Google Calendar**:
```
GET /calendar/v3/calendars/{calendarId}/events
Params:
  - timeMin: 2024-11-19T00:00:00Z
  - timeMax: 2024-11-19T23:59:59Z
  - singleEvents: true

Response:
{
  "items": [
    {
      "summary": "Team Standup",
      "start": {"dateTime": "2024-11-19T09:00:00Z"},
      "end": {"dateTime": "2024-11-19T09:30:00Z"}
    },
    {
      "summary": "Sprint Planning",
      "start": {"dateTime": "2024-11-19T14:00:00Z"},
      "end": {"dateTime": "2024-11-19T16:00:00Z"}
    }
  ]
}

Calculate:
- Meeting Time = Sum of all event durations
- Work Hours = 8 hours (configurable)
- Focus Time = Work Hours - Meeting Time
- Balance Score = (Focus Time / Work Hours) * 100
```

**Microsoft Outlook/Office 365**:
```
GET /me/calendarview?startDateTime={start}&endDateTime={end}
```

---

## 🚀 Feature #7: Test Case Management

### Required Metrics & APIs

#### 1. **Test Case Repository**
**Source**: TestRail API
```
GET /index.php?/api/v2/get_cases/{project_id}&suite_id={suite_id}

Response:
{
  "cases": [
    {
      "id": 1,
      "title": "Verify user login with valid credentials",
      "type_id": 1,  // 1=Automated, 2=Manual, 3=Other
      "priority_id": 4,  // 1=Low, 2=Medium, 3=High, 4=Critical
      "refs": "REQ-1001,REQ-1002",  // Requirement links
      "created_on": 1700000000,
      "updated_on": 1700500000,
      "custom_automation_type": "Selenium",
      "custom_preconds": "User must be registered",
      "custom_steps": "1. Navigate to login\n2. Enter credentials\n3. Click login"
    }
  ]
}
```

**Zephyr (Jira Plugin) Alternative**:
```
GET /rest/zapi/latest/execution?projectId={id}
GET /rest/zapi/latest/teststep/{testStepId}
```

**qTest Alternative**:
```
GET /api/v3/projects/{projectId}/test-cases
```

---

#### 2. **Test Execution History**
**Source**: TestRail Execution Results
```
GET /index.php?/api/v2/get_results_for_case/{run_id}/{case_id}

Response:
{
  "results": [
    {
      "id": 1,
      "test_id": 1,
      "status_id": 1,  // 1=Passed, 5=Failed, 2=Blocked, 3=Retest
      "created_on": 1700000000,
      "elapsed": "2m 30s",
      "defects": "BUG-123",
      "comment": "Test passed successfully"
    },
    {
      "id": 2,
      "test_id": 1,
      "status_id": 5,
      "created_on": 1699900000,
      "elapsed": "1m 45s",
      "defects": "BUG-122",
      "comment": "Login button not responding"
    }
  ]
}

Calculate:
- Pass Rate = (Passed Executions / Total Executions) * 100
- Execution Count = Total number of results
- Average Duration = Average of elapsed times
- Last Executed = Most recent created_on
```

---

#### 3. **Requirement Traceability**
**Source**: TestRail + Jira

**TestRail refs field**:
```
Test case has: "refs": "REQ-1001,REQ-1002,STORY-505"
```

**Verify in Jira**:
```
GET /rest/api/3/issue/REQ-1001

Response:
{
  "key": "REQ-1001",
  "fields": {
    "summary": "User must be able to login",
    "issuetype": {"name": "Requirement"},
    "status": {"name": "Done"}
  }
}

Build traceability matrix:
- Requirement ID
- Requirement Status
- Linked Test Cases
- Test Coverage (% of requirements with tests)
```

---

#### 4. **Effectiveness Score Calculation**
**Source**: Calculated from Multiple Metrics

**Algorithm**:
```
Effectiveness Score = (
  (Pass Rate * 0.4) +
  (Execution Frequency Score * 0.3) +
  (Defect Detection Score * 0.3)
) * 100

Where:

Pass Rate = (Passed / Total Executions) * 100

Execution Frequency Score = min(Executions per Sprint / 10, 1) * 100
- 10+ executions per sprint = 100 points
- 5 executions = 50 points
- 1 execution = 10 points

Defect Detection Score = (Bugs Found by Test / Total Bugs in Area) * 100
- Get bugs from Jira linked to test case
- Compare to total bugs in same component
```

**Example**:
```
Test Case: "Login Test"
- Pass Rate: 95% (19 passed, 1 failed out of 20 runs)
- Executions: 20 in last sprint (Score: 100)
- Bugs Found: 3 out of 10 total login bugs (Score: 30)

Effectiveness = (95 * 0.4) + (100 * 0.3) + (30 * 0.3)
              = 38 + 30 + 9
              = 77/100
```

---

#### 5. **Redundancy Detection**
**Source**: Test Case Analysis

**Algorithm**:
```
For each test case pair:

1. Compare Test Steps (Text Similarity):
   - Use Levenshtein distance or Cosine similarity
   - Threshold: > 80% similar = potential redundancy

2. Compare Requirements Covered:
   - If both cover exact same requirements = redundant

3. Compare Test Data:
   - If using identical test data = redundant

4. Check Execution Results:
   - If both always pass/fail together = redundant

Flag as redundant if 3+ criteria match
```

**Implementation**:
```python
# Pseudo-code
def detect_redundancy(test1, test2):
    similarity_score = 0
    
    # Step similarity
    step_similarity = calculate_text_similarity(
        test1.steps, 
        test2.steps
    )
    if step_similarity > 0.8:
        similarity_score += 25
    
    # Requirement overlap
    req_overlap = len(set(test1.refs) & set(test2.refs)) / len(set(test1.refs))
    if req_overlap > 0.8:
        similarity_score += 25
    
    # Execution correlation
    if test1.pass_rate == test2.pass_rate:
        similarity_score += 25
    
    # Same test data
    if test1.test_data == test2.test_data:
        similarity_score += 25
    
    return similarity_score > 75  # Redundant if > 75%
```

---

## 🚀 Feature #8: Test Execution Timeline

### Required Metrics & APIs

#### 1. **Test Suite Executions**
**Source**: Jenkins Build History
```
GET /job/{job_name}/api/json?tree=builds[number,timestamp,duration,result,actions[*]]{0,99}

Response:
{
  "builds": [
    {
      "number": 123,
      "timestamp": 1700000000000,
      "duration": 450000,  // milliseconds
      "result": "SUCCESS",
      "actions": [
        {
          "_class": "hudson.tasks.junit.TestResultAction",
          "failCount": 0,
          "skipCount": 2,
          "totalCount": 150
        }
      ]
    }
  ]
}
```

**TestRail Alternative**:
```
GET /index.php?/api/v2/get_runs/{project_id}

Response:
{
  "runs": [
    {
      "id": 1,
      "name": "Regression Suite - Sprint 23",
      "created_on": 1700000000,
      "completed_on": 1700000450,
      "passed_count": 145,
      "failed_count": 3,
      "blocked_count": 2
    }
  ]
}
```

---

#### 2. **Execution Timeline Data**
**Source**: Jenkins + TestRail

**For Gantt Chart**:
```
Required fields per execution:
- test_suite: "Smoke Tests"
- start_time: "2024-11-19T10:00:00Z"
- end_time: "2024-11-19T10:07:30Z"
- duration: 450 (seconds)
- status: "passed" | "failed" | "running" | "blocked"
- assigned_to: "Tester 1"
- dependencies: ["Smoke Tests"]  // Must complete before this

Calculate:
- Timeline start = earliest start_time
- Timeline end = latest end_time
- Parallel executions = overlapping time ranges
- Sequential executions = no overlap
```

---

#### 3. **Resource Allocation**
**Source**: Jenkins Node/Agent Info
```
GET /computer/api/json

Response:
{
  "computer": [
    {
      "displayName": "jenkins-agent-1",
      "idle": false,
      "offline": false,
      "executors": [
        {
          "currentExecutable": {
            "number": 123,
            "url": "http://jenkins/job/test-suite/123/"
          }
        }
      ]
    }
  ]
}

Map executions to agents/testers
```

---

#### 4. **Dependency Tracking**
**Source**: Jenkins Pipeline Stages
```
GET /job/{job_name}/lastBuild/wfapi/describe

Response shows stage dependencies:
{
  "stages": [
    {
      "name": "Unit Tests",
      "status": "SUCCESS"
    },
    {
      "name": "Integration Tests",
      "status": "IN_PROGRESS",
      "dependencies": ["Unit Tests"]  // Must wait for this
    }
  ]
}
```

**TestRail Test Plan**:
```
GET /index.php?/api/v2/get_plan/{plan_id}

Response:
{
  "entries": [
    {
      "name": "Smoke Tests",
      "runs": [{"id": 1}]
    },
    {
      "name": "Regression Tests",
      "runs": [{"id": 2}],
      "dependencies": [1]  // Depends on run 1
    }
  ]
}
```

---

#### 5. **Bottleneck Detection**
**Source**: Calculated from Timeline Data

**Algorithm**:
```
1. Identify longest running test suite
2. Check if it blocks other suites
3. Calculate bottleneck impact:

Bottleneck Score = (
  (Suite Duration / Total Timeline Duration) * 50 +
  (Number of Blocked Suites * 10)
)

If score > 40: Flag as bottleneck

Example:
- Integration Tests: 30 minutes
- Total Timeline: 60 minutes
- Blocks: 3 other suites
- Score = (30/60 * 50) + (3 * 10) = 25 + 30 = 55
- BOTTLENECK DETECTED
```

---

## 🚀 Feature #9: Team Gamification

### Required Metrics & APIs

#### 1. **Team Points Calculation**
**Source**: Aggregated from Multiple Sources

**Points System**:
```
Quality Achievements:
- 95%+ test coverage: +500 points (SonarQube)
- Zero production bugs in sprint: +1000 points (Jira)
- All tests passing: +300 points (Jenkins)
- Code quality A rating: +400 points (SonarQube)

Speed Achievements:
- Fastest CI/CD pipeline: +300 points (Jenkins)
- Deployment frequency > 10/week: +200 points (Jenkins)
- MTTR < 4 hours: +250 points (Jira)

Process Achievements:
- 100% sprint commitment: +400 points (Jira)
- All PRs reviewed within 24h: +200 points (GitHub)
- Zero carryover: +300 points (Jira)
```

**Data Collection**:
```
SonarQube:
GET /api/measures/component?metricKeys=coverage,sqale_rating

Jenkins:
GET /job/{team_job}/api/json?tree=builds[result,duration]

Jira:
GET /rest/agile/1.0/sprint/{sprintId}/issue
GET /rest/api/3/search?jql=issuetype=Bug AND environment=Production

GitHub:
GET /repos/{owner}/{repo}/pulls?state=closed
Check review times
```

---

#### 2. **Badges & Achievements**
**Source**: Rules Engine + Historical Data

**Achievement Definitions**:
```json
{
  "achievements": [
    {
      "id": "quality-champion",
      "name": "Quality Champion",
      "description": "Maintained 95%+ test coverage for 3 sprints",
      "icon": "🏆",
      "category": "quality",
      "criteria": {
        "metric": "test_coverage",
        "threshold": 95,
        "duration_sprints": 3
      }
    },
    {
      "id": "speed-demon",
      "name": "Speed Demon",
      "description": "Fastest pipeline execution time",
      "icon": "⚡",
      "category": "speed",
      "criteria": {
        "metric": "pipeline_duration",
        "rank": 1
      }
    },
    {
      "id": "bug-hunter",
      "name": "Bug Hunter",
      "description": "Found and fixed 50+ bugs",
      "icon": "🎯",
      "category": "quality",
      "criteria": {
        "metric": "bugs_fixed",
        "threshold": 50
      }
    }
  ]
}
```

**Check Achievement Eligibility**:
```
For each team:
1. Query historical metrics
2. Check against achievement criteria
3. Award badge if criteria met
4. Store in database:

POST /api/v1/achievements
{
  "team_id": "team-123",
  "achievement_id": "quality-champion",
  "earned_date": "2024-11-19",
  "evidence": {
    "sprint_1_coverage": 96.5,
    "sprint_2_coverage": 97.2,
    "sprint_3_coverage": 95.8
  }
}
```

---

#### 3. **Leaderboard Rankings**
**Source**: Points Database + Real-time Calculations

**Leaderboard Query**:
```sql
SELECT 
  team_id,
  team_name,
  SUM(points) as total_points,
  COUNT(DISTINCT achievement_id) as badge_count,
  RANK() OVER (ORDER BY SUM(points) DESC) as rank
FROM team_points
WHERE period = 'current_quarter'
GROUP BY team_id, team_name
ORDER BY total_points DESC
```

**API Response**:
```json
{
  "leaderboard": [
    {
      "rank": 1,
      "team_id": "team-checkout",
      "team_name": "Checkout Service",
      "points": 4500,
      "badges": ["🏆", "⚡", "🎯"],
      "achievements": [
        {
          "id": "quality-champion",
          "name": "Quality Champion",
          "earned_date": "2024-11-15"
        }
      ]
    }
  ]
}
```

---

#### 4. **Real-time Point Updates**
**Source**: Webhook Listeners

**Jenkins Webhook**:
```
POST /api/v1/gamification/jenkins-webhook
{
  "build": {
    "number": 123,
    "result": "SUCCESS",
    "duration": 180000,
    "team": "checkout-service"
  }
}

Process:
- If all tests passed: +300 points
- If fastest build: +300 bonus points
- Update leaderboard in real-time
```

**Jira Webhook**:
```
POST /api/v1/gamification/jira-webhook
{
  "issue": {
    "key": "BUG-123",
    "fields": {
      "status": "Closed",
      "resolution": "Fixed",
      "assignee": "team-checkout"
    }
  }
}

Process:
- Bug fixed: +50 points
- If production bug: +100 bonus
- Update team score
```

---

## 📊 Summary: Complete Data Source Matrix

| Feature | Primary Sources | Alternative Sources |
|---------|----------------|---------------------|
| Core Dashboard | Jenkins, Jira, SonarQube | TestRail, GitHub |
| Flaky Tests | Jenkins Test Results | TestRail, Selenium Grid |
| Technical Debt | SonarQube | CodeClimate, Codacy |
| Pipeline Viz | Jenkins Pipeline API | GitLab CI, CircleCI |
| Business Impact | Jira + Analytics | Custom BI, Salesforce |
| Performance | New Relic, Datadog | Dynatrace, AppDynamics |
| Developer Productivity | GitHub, Calendar API | GitLab, Bitbucket |
| Test Management | TestRail | Zephyr, qTest, Xray |
| Execution Timeline | Jenkins, TestRail | Azure DevOps |
| Gamification | Aggregated from all | Custom database |

---

## 🔧 Implementation Notes

### Authentication
All APIs require authentication:
- **Jenkins**: API Token or Username/Password
- **Jira**: API Token or OAuth
- **GitHub**: Personal Access Token or OAuth App
- **SonarQube**: User Token
- **TestRail**: API Key
- **Datadog/New Relic**: API Key

### Rate Limiting
Be aware of API rate limits:
- **GitHub**: 5,000 requests/hour (authenticated)
- **Jira Cloud**: 10 requests/second
- **SonarQube**: No official limit, but recommended < 100/min

### Data Refresh Frequency
Recommended update intervals:
- **Real-time metrics**: Every 1-5 minutes (Jenkins builds, test results)
- **Daily metrics**: Once per day (code quality, technical debt)
- **Weekly metrics**: Once per week (happiness scores, sprint metrics)

---

*All metrics are obtainable through documented, production-ready APIs*
