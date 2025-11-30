# Flaky Test Intelligence

## Overview

Flaky Test Intelligence is an advanced analytics feature that identifies, classifies, and tracks unstable tests in your test suites. It helps QA teams understand why tests fail intermittently and provides actionable recommendations to stabilize them.

---

## How It Works

### Architecture Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  test_cases     │────▶│   flaky_tests    │────▶│  Pattern Analysis   │
│  (source data)  │     │  (tracking)      │     │  (code logic)       │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
        │                       │                         │
        ▼                       ▼                         ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ test_executions │────▶│  History Chart   │────▶│  Suggested Fix      │
│ (run history)   │     │  (timeline)      │     │  (recommendations)  │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
```

### Data Flow

1. **Test cases** are linked to **flaky_tests** records via `test_case_id`
2. **Test executions** store individual run results with timestamps and status
3. **Pattern analysis** happens in code (not database) to classify failure types
4. **Frontend** displays the analysis with filters, charts, and recommendations

---

## Features

### 1. Pattern-Based Classification
Tests are classified into 5 failure patterns:

| Pattern | Description | Detected Keywords | Suggested Fix |
|---------|-------------|-------------------|---------------|
| **Timing** | Async operations, timeouts, race conditions | `timeout`, `timed out`, `TimeoutError`, `async`, `await` | Add explicit waits or increase timeout thresholds |
| **Environment** | Test environment configuration or infrastructure | `environment`, `config`, `docker`, `container`, `connection refused` | Ensure consistent environment setup with health checks |
| **Data** | Test data pollution or shared state | `assertion failed`, `expected`, `duplicate key`, `null`, `undefined` | Use isolated fixtures and database transactions per test |
| **Network** | External API calls or network issues | `ECONNREFUSED`, `ETIMEDOUT`, `fetch failed`, `HTTP 5xx`, `API error` | Mock external APIs or add retry logic |
| **Unknown** | Unclassified failures | No matching keywords | Collect more failure data and analyze patterns |

### 2. Flakiness Score (0-100)
Calculated from:
- **Failure rate**: `(failure_count / total_runs) * 100`
- **Severity levels**:
  - `> 70`: CRITICAL (red badge)
  - `> 40`: WARNING (yellow badge)
  - `≤ 40`: MODERATE (green badge)

### 3. Execution History
- **Line chart** showing pass/fail pattern over time
- **Green dots** = passed, **Red dots** = failed
- **Sorted chronologically** (oldest on left, newest on right)
- **Deduplicated** by timestamp to avoid duplicate entries

### 4. Detailed Run Table
Expandable section showing:
- Date and time of each run
- Pass/fail status with colored badges
- Scrollable list of last 20 executions

### 5. Most Common Failure Reason
Dynamically generated based on the pattern classification:
- Shows the detected keyword that triggered classification
- Labeled as "Most Common" since tests may fail for various reasons

---

## Code Implementation

### Backend: Pattern Analysis Engine

Located in `server/routes/analytics.ts`:

```typescript
// Pattern analysis happens in code, NOT from database columns
const patternAnalysis: Record<string, { keyword: string; fix: string }> = {
  timing: {
    keyword: 'timeout keyword detected in error logs',
    fix: 'Add explicit waits or increase timeout thresholds'
  },
  environment: {
    keyword: 'environment keyword detected in error logs',
    fix: 'Ensure consistent environment setup with health checks'
  },
  data: {
    keyword: 'assertion failed keyword detected in error logs',
    fix: 'Use isolated fixtures and database transactions per test'
  },
  network: {
    keyword: 'ECONNREFUSED keyword detected in error logs',
    fix: 'Mock external APIs or add retry logic'
  },
  unknown: {
    keyword: 'No matching pattern found',
    fix: 'Collect more failure data and analyze patterns'
  }
};
```

### Frontend: FlakyTestCard Component

Located in `src/components/FlakyTestIntelligence.tsx`:

**Key features:**
- Responsive design (mobile-first)
- Pattern filter buttons
- Expandable details section
- Line chart with colored dots
- Recent runs table

```tsx
// History data processing
const historyData = useMemo(() => {
  const seen = new Set<string>();
  return [...test.history]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .filter(entry => {
      const key = `${new Date(entry.date).getTime()}-${entry.passed}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}, [test.history]);
```

---

## Database Schema

### flaky_tests Table
```sql
CREATE TABLE flaky_tests (
  id CHAR(36) PRIMARY KEY,
  test_case_id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  company_id CHAR(36),
  test_name VARCHAR(255),
  failure_pattern ENUM('timing','environment','data','network','unknown') DEFAULT 'unknown',
  flakiness_score DECIMAL(5,2) DEFAULT 0,
  failure_count INT DEFAULT 0,
  pass_count INT DEFAULT 0,
  total_runs INT DEFAULT 0,
  last_flaky_at TIMESTAMP,
  is_quarantined BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**Note:** `root_cause` and `suggested_fix` columns exist but are NOT used. These are generated from code logic based on `failure_pattern`.

### test_executions Table
```sql
CREATE TABLE test_executions (
  id CHAR(36) PRIMARY KEY,
  test_case_id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  status ENUM('passed','failed','skipped','blocked') NOT NULL,
  duration_ms INT,
  error_message TEXT,
  stack_trace TEXT,
  environment VARCHAR(50) DEFAULT 'staging',
  build_number VARCHAR(100),
  branch VARCHAR(255),
  executed_by CHAR(36),
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Endpoints

### GET /api/analytics/flaky-tests

Retrieves flaky tests with pattern analysis.

**Query Parameters:**
- `teamId` (optional): Filter by team

**Response:**
```json
{
  "flakyTests": [{
    "id": "ft-abc123",
    "test_name": "Login timeout test",
    "flakiness_score": 75.5,
    "failure_pattern": "timing",
    "occurrences": 12,
    "first_detected": "2025-11-01T10:00:00Z",
    "last_occurrence": "2025-11-29T15:30:00Z",
    "suggested_fix": "Add explicit waits or increase timeout thresholds",
    "root_cause": "timeout keyword detected in error logs",
    "history": [
      { "date": "2025-11-28T10:00:00Z", "passed": false },
      { "date": "2025-11-28T14:00:00Z", "passed": true }
    ]
  }]
}
```

---

## Production Integration

### Auto-Classification from CI/CD Logs

When ready for production, uncomment and use the classification engine in `server/routes/analytics.ts`:

```typescript
const PATTERN_KEYWORDS = {
  timing: [
    'timeout', 'timed out', 'TimeoutError', 'async', 'await', 'Promise',
    'race condition', 'flaky wait', 'sleep', 'delay exceeded', 'Exceeded timeout'
  ],
  environment: [
    'environment', 'config', 'configuration', 'docker', 'container',
    'service unavailable', 'connection refused', 'port already in use',
    'permission denied', 'file not found', 'ENOENT', 'health check'
  ],
  data: [
    'assertion failed', 'expected', 'but got', 'duplicate key', 'constraint',
    'null', 'undefined', 'NaN', 'fixture', 'seed data', 'database state',
    'data mismatch', 'stale data'
  ],
  network: [
    'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'fetch failed', 'request timeout',
    'HTTP 5', 'API error', 'socket hang up', 'SSL', 'certificate', 'network error'
  ]
};

function classifyFailurePattern(errorMessage: string): string {
  const lowerError = errorMessage.toLowerCase();
  for (const [pattern, keywords] of Object.entries(PATTERN_KEYWORDS)) {
    if (keywords.some(kw => lowerError.includes(kw.toLowerCase()))) {
      return pattern;
    }
  }
  return 'unknown';
}
```

### CI/CD Data Sources

#### Jenkins
```bash
# Get test report
curl -u user:token "https://jenkins.company.com/job/my-pipeline/lastBuild/testReport/api/json"

# Get console output (for error messages)
curl -u user:token "https://jenkins.company.com/job/my-pipeline/lastBuild/consoleText"
```

#### GitHub Actions
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/owner/repo/actions/runs/{run_id}/jobs"
```

#### GitLab CI
```bash
curl --header "PRIVATE-TOKEN: $TOKEN" \
  "https://gitlab.com/api/v4/projects/{id}/pipelines/{pipeline_id}/test_report"
```

#### Azure DevOps
```bash
curl -u user:token \
  "https://dev.azure.com/{org}/{project}/_apis/test/runs/{runId}/results"
```

---

## Seeding Demo Data

### Distribute Patterns Evenly
```sql
SET @row := 0;
UPDATE flaky_tests ft
JOIN (
  SELECT id, @row := @row + 1 as row_num
  FROM flaky_tests ORDER BY id
) numbered ON ft.id = numbered.id
SET ft.failure_pattern = ELT(MOD(numbered.row_num - 1, 5) + 1, 
  'timing', 'environment', 'data', 'network', 'unknown');
```

### Seed Test Executions (~60% failure rate)
```sql
INSERT INTO test_executions (id, test_case_id, team_id, status, executed_at, duration_ms)
SELECT
  UUID(), ft.test_case_id, ft.team_id,
  CASE WHEN RAND() < 0.60 THEN 'failed' ELSE 'passed' END,
  DATE_SUB(NOW(), INTERVAL FLOOR(RAND() * 30) DAY),
  30000 + FLOOR(RAND() * 180000)
FROM flaky_tests ft
CROSS JOIN (SELECT 1 UNION SELECT 2 ... UNION SELECT 20) n;
```

### Update Aggregated Stats
```sql
UPDATE flaky_tests ft
LEFT JOIN (
  SELECT test_case_id,
    SUM(status = 'failed') AS failures,
    SUM(status = 'passed') AS passes,
    COUNT(*) AS total_runs,
    MAX(CASE WHEN status = 'failed' THEN executed_at END) AS last_fail,
    MIN(executed_at) AS first_seen
  FROM test_executions GROUP BY test_case_id
) ex ON ex.test_case_id = ft.test_case_id
SET
  ft.failure_count = COALESCE(ex.failures, 0),
  ft.pass_count = COALESCE(ex.passes, 0),
  ft.total_runs = COALESCE(ex.total_runs, 0),
  ft.last_flaky_at = ex.last_fail,
  ft.created_at = ex.first_seen,
  ft.flakiness_score = ROUND(COALESCE(ex.failures, 0) / COALESCE(ex.total_runs, 1) * 100, 2);
```

---

## UI Components

### Header Stats
- **Total Flaky**: Count of all flaky tests
- **Avg Flakiness**: Mean flakiness score
- **Critical**: Count of tests with score > 70

### Pattern Filters
Buttons to filter by failure pattern:
- All Patterns (🔍)
- Timing Issues (⏱️)
- Environment (🌍)
- Data Issues (📊)
- Network (🌐)
- Unknown (❓)

### Test Card
Each flaky test displays:
- Test name and pattern badge
- Failure count, age, pass rate
- Flakiness score with severity badge
- Suggested fix (blue info box)
- 20-day history chart
- Expandable details with:
  - Most Common Failure Reason (red box)
  - First detected / Last occurrence dates
  - Total runs / Failure rate
  - Recommended actions
  - Recent runs table

---

## Responsive Design

The page is fully responsive:
- **Mobile**: Stacked layouts, smaller text, wrapped filters
- **Tablet**: 2-column grids, medium sizing
- **Desktop**: Full horizontal layouts, large stats

Key breakpoints:
- `sm`: 640px
- `lg`: 1024px

---

## Future Enhancements

1. **ML-Based Classification**: Train model on historical failure data
2. **Quarantine Automation**: Auto-quarantine tests exceeding threshold
3. **Slack/Teams Notifications**: Alert on new flaky tests
4. **Trend Analysis**: Track flakiness over sprints/releases
5. **Cost Impact**: Calculate CI time/cost wasted on flaky tests
6. **Error Message Storage**: Store actual error messages for analysis

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/components/FlakyTestIntelligence.tsx` | Main UI component |
| `server/routes/analytics.ts` | Backend API with pattern analysis |
| `src/data/advancedFeatures.ts` | Type definitions and mock data |
| `docs/flaky_test_intelligence.md` | This documentation |

---

*Last updated: November 30, 2025*
