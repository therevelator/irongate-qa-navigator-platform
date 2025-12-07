# Executive Engineering Dashboard (Hero Section)

## 1. Overview & Narrative

**"From scattered signals to confidence."**

The Hero Section serves as the "Heads-Up Display" (HUD) for the CTO/VP of Engineering. It moves beyond simple bug counting to provide a holistic view of the engineering organization's health.

The narrative arc of this dashboard is:
1.  **Global QA Score (The Battery):** "Are we shipping quality right now?" (The immediate pulse).
2.  **Engineering Health Score:** "Is our engineering machine healthy?" (The composite view).
3.  **DORA & Pipeline:** "Are we moving fast and stable?" (Velocity).
4.  **Wellness & Tech Debt:** "Is this pace sustainable?" (Longevity & Culture).

---

## 2. Data Architecture (Production Context)

In a production environment, this dashboard does **not** calculate raw metrics from scratch on every page load. Instead, it relies on an **Aggregated Snapshot Pattern**.

### Data Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  External Tools │     │  Background     │     │   Database      │
│  (Jira, GitHub, │────▶│  Jobs           │────▶│   Tables        │
│   Jenkins, etc) │     │  analyticsSync  │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
                                                ┌─────────────────┐
                                                │  /company-      │
                                                │  summary API    │
                                                └─────────────────┘
                                                        │
                                                        ▼
                                                ┌─────────────────┐
                                                │  Hero Section   │
                                                │  (React)        │
                                                └─────────────────┘
```

1.  **Ingestion:** Raw data (Jira tickets, GitHub PRs, Jenkins logs, SonarQube results) is ingested via webhooks or cron jobs.
2.  **Processing:** Background jobs (`server/jobs/analyticsSync.ts`) normalize this data.
3.  **Storage:**
    *   Team-level metrics → `kpi_snapshots` (one row per team per day).
    *   Developer metrics → `developer_metrics` (current state per developer).
    *   Debt items → `technical_debt`.
4.  **Presentation:** The Dashboard (`GET /api/analytics/company-summary`) queries these tables, aggregates them, and serves JSON to the React frontend.

---

## 3. Metric Definitions & Calculations

All metrics are calculated in `server/routes/analytics.ts` within the `/company-summary` endpoint.

---

### A. Global QA Score (The 3D Battery)

| Attribute        | Value                                                                 |
|------------------|-----------------------------------------------------------------------|
| **Definition**   | Simple average of the QA Score across all active teams in the company |
| **Business Value** | Single "at-a-glance" number representing the organization's quality posture. If this drops, a systemic issue exists. |
| **Data Source**  | `kpi_snapshots` table                                                 |
| **UI Component** | `HeroBattery` (3D vertical battery visualization)                     |

**Calculation Logic:**

```sql
-- Step 1: Get latest snapshot per active team
SELECT t.id AS team_id, t.name, ks.*
FROM teams t
LEFT JOIN kpi_snapshots ks ON t.id = ks.team_id
WHERE t.company_id = ? AND t.is_active = 1
ORDER BY ks.snapshot_date DESC
```

```typescript
// Step 2: Deduplicate to one row per team (latest snapshot)
const teamMap = new Map<string, any>();
for (const row of teamsWithKpis) {
  if (!teamMap.has(row.team_id)) {
    teamMap.set(row.team_id, row);
  }
}
const teams = Array.from(teamMap.values());
const teamsWithData = teams.filter(t => t.qa_score != null);

// Step 3: Calculate average
const qaScores = teamsWithData.map(t => Number(t.qa_score) || 0);
const globalQaScore = qaScores.length
  ? Math.round(qaScores.reduce((sum, score) => sum + score, 0) / qaScores.length)
  : 0;
```

**Formula:** `ROUND(SUM(team_qa_scores) / COUNT(teams_with_kpi_data))`

**Display:** Shows `{teamsWithKpiData}/{teamCount} teams in calculation` under the battery.

---

### B. Engineering Health Score (Primary Executive Metric)

| Attribute        | Value                                                                 |
|------------------|-----------------------------------------------------------------------|
| **Definition**   | Weighted composite score representing overall engineering health      |
| **Business Value** | Prevents "gaming" the system. Cannot score high by burning out developers or ignoring tech debt. |
| **Range**        | 0-100                                                                 |

**Calculation Formula:**

```typescript
const engineeringHealthScore = Math.round(
  (doraLevelScore      * 0.35) +  // Delivery Performance
  (pipelineHealthScore * 0.25) +  // CI/CD Stability
  (techDebtStatusScore * 0.20) +  // Technical Debt Health
  (happiness           * 0.15) +  // Developer Happiness
  (burnoutRiskScore    * 0.05)    // Burnout Risk (inverted)
);
```

**Weight Rationale:**
- **35% DORA:** Delivery velocity is the primary output metric.
- **25% Pipeline:** Stable CI/CD is foundational.
- **20% Tech Debt:** Accumulated debt slows future velocity.
- **15% Happiness:** Sustainable pace requires engaged developers.
- **5% Burnout Risk:** Early warning for retention issues.

---

### C. Delivery Performance Score (DORA)

| Attribute        | Value                                                                 |
|------------------|-----------------------------------------------------------------------|
| **Definition**   | Based on DevOps Research and Assessment (DORA) metrics                |
| **Business Value** | Industry-standard measure of software delivery performance            |
| **Data Source**  | `kpi_snapshots` (averaged across all teams)                           |

**Input Metrics:**

| Metric                         | Column in `kpi_snapshots`        |
|--------------------------------|----------------------------------|
| Deployment Frequency           | `deployment_frequency_per_week`  |
| Lead Time for Changes          | `lead_time_days`                 |
| Change Failure Rate            | `change_failure_rate`            |
| Mean Time to Recovery (MTTR)   | `mttr_hours`                     |

**Scoring Logic:**

```typescript
let doraLevelScore = 40; // Default: Low

if (avgDeployFreq >= 7 && avgLeadTime < 1 && avgFailureRate < 5 && avgMttr < 1) {
  doraLevelScore = 100; // Elite
} else if (avgDeployFreq >= 1 && avgLeadTime < 7 && avgFailureRate < 15 && avgMttr < 24) {
  doraLevelScore = 80;  // High
} else if (avgDeployFreq >= 0.25 && avgLeadTime < 30 && avgFailureRate < 30 && avgMttr < 48) {
  doraLevelScore = 60;  // Medium
}
```

| Level  | Score | Deploy Freq    | Lead Time | Failure Rate | MTTR    |
|--------|-------|----------------|-----------|--------------|---------|
| Elite  | 100   | Daily (≥7/wk)  | <1 day    | <5%          | <1 hour |
| High   | 80    | Weekly (≥1/wk) | <1 week   | <15%         | <1 day  |
| Medium | 60    | Monthly        | <1 month  | <30%         | <2 days |
| Low    | 40    | Infrequent     | >1 month  | >30%         | >2 days |

---

### D. Developer Wellness Index

| Attribute        | Value                                                                 |
|------------------|-----------------------------------------------------------------------|
| **Definition**   | Sustainability metric to predict retention and burnout                |
| **Business Value** | Early warning system for team health issues before they impact delivery |
| **Data Source**  | `developer_metrics` table                                             |

**Input Metrics:**

| Metric                | Column                      | Description                          |
|-----------------------|-----------------------------|--------------------------------------|
| Happiness Score       | `happiness_score`           | Self-reported or inferred (0-100)    |
| Focus Time            | `focus_time_hours`          | Uninterrupted coding blocks per day  |
| Meeting Time          | `meeting_time_hours`        | Hours in meetings per day            |
| Context Switches      | `context_switches_per_day`  | Interruptions per day                |

**Derived Scores:**

```typescript
// Burnout Risk Score (higher = lower risk)
let burnoutRiskScore = 100; // Low risk
if (happiness < 50 || meetingTime > 5 || focusTime < 2) burnoutRiskScore = 20; // High risk
else if (happiness < 70 || meetingTime > 4 || focusTime < 3) burnoutRiskScore = 60; // Moderate

// Focus Time Score
let focusTimeScore = 40;
if (focusTime >= 4) focusTimeScore = 100;
else if (focusTime >= 3) focusTimeScore = 80;
else if (focusTime >= 2) focusTimeScore = 60;

// Meeting Load Score (lower meetings = higher score)
let meetingLoadScore = 40;
if (meetingTime <= 2) meetingLoadScore = 100;
else if (meetingTime <= 4) meetingLoadScore = 80;
else if (meetingTime <= 6) meetingLoadScore = 60;
```

**Final Calculation:**

```typescript
const developerWellnessIndex = Math.round(
  (happiness        * 0.60) +
  (burnoutRiskScore * 0.20) +
  (focusTimeScore   * 0.10) +
  (meetingLoadScore * 0.10)
);
```

---

### E. Technical Debt Status

| Attribute        | Value                                                                 |
|------------------|-----------------------------------------------------------------------|
| **Definition**   | Quantified view of open technical debt relative to organization size  |
| **Business Value** | Makes invisible "drag" on velocity visible to leadership              |
| **Data Source**  | `technical_debt` table                                                |

**Severity Weights:**

| Severity | Weight |
|----------|--------|
| Critical | 30     |
| High     | 20     |
| Medium   | 10     |
| Low      | 5      |

**Calculation:**

```typescript
// SQL: Sum weights of all open debt items
const techDebtSummary = await queryOne<any>(`
  SELECT 
    SUM(CASE 
      WHEN status NOT IN ('resolved','wont_fix') THEN
        CASE severity
          WHEN 'critical' THEN 30
          WHEN 'high' THEN 20
          WHEN 'medium' THEN 10
          WHEN 'low' THEN 5
          ELSE 0
        END
      ELSE 0
    END) AS total_weight
  FROM technical_debt td
  JOIN teams t ON td.team_id = t.id
  WHERE t.company_id = ?
`, [companyId]);

// Normalize per team and invert to health score
const totalTechDebtScore = Math.min(100, totalWeight / teamCount);
const techDebtStatusScore = Math.round(Math.max(0, 100 - totalTechDebtScore) * 10) / 10;
```

**Interpretation:**
- **90-100:** Minimal debt, healthy codebase.
- **70-89:** Manageable debt, monitor closely.
- **50-69:** Significant debt, prioritize reduction.
- **<50:** Critical debt load, impacting velocity.

---

### F. Pipeline Health Score

| Attribute        | Value                                                                 |
|------------------|-----------------------------------------------------------------------|
| **Definition**   | Stability and efficiency of CI/CD infrastructure                      |
| **Business Value** | Unreliable pipelines slow down all teams                              |
| **Data Source**  | `pipeline_execution_summary` / `pipeline_config`                      |

**Current Implementation:**

```typescript
const pipelineHealthScore = 96; // Static baseline
```

**Production Implementation (Future):**

```typescript
// Calculate from actual pipeline data
const pipelineHealth = await queryOne<any>(`
  SELECT 
    SUM(successful_runs) as success,
    SUM(total_runs) as total
  FROM pipeline_execution_summary
  WHERE company_id = ? AND execution_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
`, [companyId]);

const pipelineHealthScore = Math.round((success / total) * 100);
```

---

## 4. AI Executive Analysis

### Feature Overview

The "Generate AI Executive Analysis" button triggers an AI-powered interpretation of the metrics.

### Implementation Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  User clicks    │     │  POST /company- │     │  Groq API       │
│  "Generate AI"  │────▶│  insights       │────▶│  (LLM)          │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                │                       │
                                ▼                       ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │  Save snapshot  │     │  Return         │
                        │  to company_    │     │  analysis text  │
                        │  kpi_snapshots  │     │                 │
                        └─────────────────┘     └─────────────────┘
```

### Backend Endpoint

**Route:** `POST /api/analytics/company-insights`

**Steps:**
1. Calculate all metrics (same logic as `/company-summary`).
2. Save snapshot to `company_kpi_snapshots` for trend tracking.
3. Fetch last 30 days of history.
4. Construct prompt for Groq LLM with current metrics + trends.
5. Return AI analysis + history for trend visualization.

### AI Prompt Context

```typescript
const prompt = `You are a CTO/VP of Engineering advisor. Analyze these company-wide metrics and trends.

Current Metrics:
- Engineering Health: ${engineeringHealthScore}/100
- Delivery (DORA): ${deliveryPerformanceScore}/100
- Wellness: ${developerWellnessIndex}/100
- Tech Debt Status: ${techDebtStatusScore}/100
- Pipeline Health: ${pipelineHealthScore}/100

Provide a concise executive summary (3-4 sentences) highlighting the biggest risk and the biggest win. Then provide 3 strategic recommendations.`;
```

### Disclaimer

All AI-generated insights display:
> "Analysis generated by AI. Please verify critical metrics independently."

---

## 5. Database Schema Reference

### `teams`
```sql
id              VARCHAR(50) PRIMARY KEY
name            VARCHAR(255)
company_id      VARCHAR(50)
department_id   VARCHAR(50)
is_active       BOOLEAN DEFAULT TRUE
```

### `kpi_snapshots`
```sql
id                          INT AUTO_INCREMENT PRIMARY KEY
team_id                     VARCHAR(50)
snapshot_date               DATE
qa_score                    INT
test_coverage               DECIMAL(5,2)
automation_coverage         DECIMAL(5,2)
defect_escape_rate          DECIMAL(5,2)
test_flakiness_rate         DECIMAL(5,2)
deployment_frequency_per_week DECIMAL(5,2)
lead_time_days              DECIMAL(5,2)
change_failure_rate         DECIMAL(5,2)
mttr_hours                  DECIMAL(5,2)
```

### `company_kpi_snapshots`
```sql
id                          INT AUTO_INCREMENT PRIMARY KEY
company_id                  VARCHAR(50)
snapshot_date               DATE
engineering_health_score    DECIMAL(5,2)
delivery_performance_score  DECIMAL(5,2)
developer_wellness_index    DECIMAL(5,2)
tech_debt_status_score      DECIMAL(5,2)
pipeline_health_score       DECIMAL(5,2)
avg_qa_score                DECIMAL(5,2)
avg_test_coverage           DECIMAL(5,2)
UNIQUE KEY (company_id, snapshot_date)
```

### `developer_metrics`
```sql
id                      INT AUTO_INCREMENT PRIMARY KEY
developer_id            VARCHAR(50)
team_id                 VARCHAR(50)
happiness_score         DECIMAL(5,2)
focus_time_hours        DECIMAL(5,2)
meeting_time_hours      DECIMAL(5,2)
context_switches_per_day DECIMAL(5,2)
```

### `technical_debt`
```sql
id              INT AUTO_INCREMENT PRIMARY KEY
team_id         VARCHAR(50)
company_id      VARCHAR(50)
title           VARCHAR(255)
severity        ENUM('critical','high','medium','low')
status          ENUM('open','in_progress','resolved','wont_fix')
effort_hours    INT
```

---

## 6. Frontend Components

| Component              | File                                      | Purpose                              |
|------------------------|-------------------------------------------|--------------------------------------|
| `CompanyHeroSection`   | `src/components/CompanyHeroSection.tsx`   | Main hero container                  |
| `HeroBattery`          | `src/components/HeroBattery.tsx`          | 3D battery visualization             |
| `MetricCard`           | (inline in CompanyHeroSection)            | Individual metric tile               |

### Data Fetching

```typescript
const fetchSummary = useCallback(async () => {
  const response = await fetch(`${API_URL}/analytics/company-summary`, {
    credentials: 'include'
  });
  if (response.ok) {
    const data = await response.json();
    setSummary(data);
  }
}, []);
```

---

## 7. API Response Schema

**Endpoint:** `GET /api/analytics/company-summary`

```json
{
  "globalQaScore": 87,
  "globalQaScoreTrend": 2,
  "riskLevel": "stable",
  
  "engineeringHealthScore": 87,
  "deliveryPerformanceScore": 80,
  "developerWellnessIndex": 83,
  "techDebtStatusScore": 93.2,
  "pipelineHealthScore": 96,
  "techDebtResolutionRate": 78,
  
  "avgTestCoverage": 82.5,
  "avgDefectEscapeRate": 1.2,
  "automationCoverage": 74.0,
  "avgFlakinessRate": 2.1,
  
  "topImproving": [
    { "name": "LegacyCode Warriors", "score": 100 },
    { "name": "Mavericks", "score": 100 }
  ],
  "needsAttention": [
    { "name": "QA Manager Test Team", "score": 33, "issue": "Critical QA Score" }
  ],
  
  "kpiStatus": { "onTrack": 7, "atRisk": 1, "offTrack": 1 },
  "aiSummary": "Quality metrics stable. 2 teams below 80% coverage.",
  
  "teamCount": 9,
  "teamsWithKpiData": 9
}
```

---

## 8. Thresholds & Color Coding

### QA Score Thresholds

| Range   | Status   | Color  |
|---------|----------|--------|
| ≥85     | Good     | Green  |
| 70-84   | Warning  | Amber  |
| <70     | Critical | Red    |

### Risk Level Mapping

```typescript
let riskLevel: 'stable' | 'watch' | 'at-risk' = 'stable';
if (globalQaScore < 60) riskLevel = 'at-risk';
else if (globalQaScore < 75) riskLevel = 'watch';
```

---

## 9. Future Enhancements

1. **Real-time Pipeline Health:** Connect to Jenkins/GitHub Actions webhooks.
2. **Predictive Analytics:** Use historical trends to forecast QA score changes.
3. **Team Drill-down:** Click on a metric to see per-team breakdown.
4. **Custom Weights:** Allow companies to adjust metric weights.
5. **Alerting:** Trigger Slack/email when metrics cross thresholds.
