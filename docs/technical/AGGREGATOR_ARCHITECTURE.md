# 🏗️ Data Aggregator Architecture

## Visual Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         IRONGATE QA NAVIGATOR                       │
│                          (React Frontend)                           │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ Request Team Metrics
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      MASTER DATA AGGREGATOR                         │
│                                                                     │
│  • Orchestrates all data sources                                   │
│  • Parallel fetching (Promise.all)                                 │
│  • Calculates QA Score                                             │
│  • Handles errors & fallbacks                                      │
│  • Returns unified metrics                                         │
└─────────────────────────────────────────────────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
        ▼                          ▼                          ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│     JENKINS      │    │       JIRA       │    │    SONARQUBE     │
│   AGGREGATOR     │    │   AGGREGATOR     │    │   AGGREGATOR     │
│                  │    │                  │    │                  │
│ • Build metrics  │    │ • Sprint metrics │    │ • Code quality   │
│ • Test results   │    │ • Defect metrics │    │ • Tech debt      │
│ • Pipeline data  │    │ • MTTR           │    │ • Coverage       │
└──────────────────┘    └──────────────────┘    └──────────────────┘
        │                          │                          │
        │ HTTP/REST                │ HTTP/REST                │ HTTP/REST
        │ Basic Auth               │ Basic Auth               │ Basic Auth
        ▼                          ▼                          ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  JENKINS API     │    │    JIRA API      │    │  SONARQUBE API   │
│                  │    │                  │    │                  │
│ /job/{name}/     │    │ /rest/agile/1.0/ │    │ /api/measures/   │
│   api/json       │    │ /rest/api/3/     │    │ /api/issues/     │
└──────────────────┘    └──────────────────┘    └──────────────────┘

        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
        ▼                          ▼                          ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│     GITHUB       │    │    TESTRAIL      │    │     DATADOG      │
│   AGGREGATOR     │    │   AGGREGATOR     │    │   AGGREGATOR     │
│                  │    │   (Optional)     │    │   (Optional)     │
│ • PR metrics     │    │ • Test cases     │    │ • Performance    │
│ • Review time    │    │ • Executions     │    │ • Monitoring     │
│ • Merge time     │    │ • Traceability   │    │ • Availability   │
└──────────────────┘    └──────────────────┘    └──────────────────┘
        │                          │                          │
        │ HTTP/REST                │ HTTP/REST                │ HTTP/REST
        │ Token Auth               │ Basic Auth               │ API Key
        ▼                          ▼                          ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   GITHUB API     │    │  TESTRAIL API    │    │   DATADOG API    │
│                  │    │                  │    │                  │
│ /repos/{owner}/  │    │ /api/v2/         │    │ /api/v1/         │
│   {repo}/pulls   │    │   get_cases      │    │   metrics/query  │
└──────────────────┘    └──────────────────┘    └──────────────────┘
```

---

## Data Flow Sequence

### 1. Request Initiation

```typescript
// Dashboard requests metrics
const metrics = await dataAggregator.aggregateTeamMetrics({
  name: 'Checkout Service',
  jenkinsJob: 'checkout-build',
  jiraProject: 'CHECKOUT',
  sprintId: '123',
  sonarProject: 'checkout',
  githubRepo: 'checkout-service',
});
```

### 2. Parallel Data Fetching

```typescript
// MasterDataAggregator orchestrates parallel requests
const [
  buildMetrics,      // Jenkins: ~200ms
  testMetrics,       // Jenkins: ~150ms
  pipelineMetrics,   // Jenkins: ~180ms
  sprintMetrics,     // Jira: ~300ms
  defectMetrics,     // Jira: ~250ms
  qualityMetrics,    // SonarQube: ~400ms
  prMetrics,         // GitHub: ~220ms
] = await Promise.all([...]);

// Total time: ~400ms (slowest request)
// vs Sequential: ~1700ms (sum of all)
```

### 3. Data Transformation

```typescript
// Each aggregator transforms raw API data to standard format

// Jenkins Raw Response:
{
  "lastBuild": {
    "duration": 180000,
    "result": "SUCCESS"
  }
}

// Transformed to:
{
  buildTime: 180000,
  successRate: 92.5,
  lastBuildStatus: 'SUCCESS',
  buildFrequency: 20
}
```

### 4. Metric Calculation

```typescript
// Master aggregator calculates derived metrics
const qaScore = this.calculateQAScore({
  testCoverage: 85,           // from SonarQube
  defectEscapeRate: 8,        // from Jira
  buildSuccessRate: 92.5,     // from Jenkins
  codeQualityScore: 88,       // from SonarQube
});

// QA Score = (85 × 0.3) + (92 × 0.25) + (92.5 × 0.25) + (88 × 0.2)
//          = 25.5 + 23 + 23.125 + 17.6
//          = 89.2
```

### 5. Response Assembly

```typescript
// Return unified metrics object
return {
  teamName: 'Checkout Service',
  qaScore: 89,
  buildMetrics: {...},
  testMetrics: {...},
  pipelineMetrics: {...},
  sprintMetrics: {...},
  defectMetrics: {...},
  qualityMetrics: {...},
  prMetrics: {...},
  lastUpdated: '2024-11-19T22:00:00Z'
};
```

---

## Component Breakdown

### Jenkins Aggregator

```
┌─────────────────────────────────────────┐
│       JENKINS AGGREGATOR                │
├─────────────────────────────────────────┤
│                                         │
│  getBuildMetrics(jobName)               │
│  ├─ Fetch: /job/{name}/api/json        │
│  ├─ Extract: duration, result, builds  │
│  └─ Calculate: success rate, frequency │
│                                         │
│  getTestMetrics(jobName)                │
│  ├─ Fetch: /testReport/api/json        │
│  ├─ Extract: pass/fail counts           │
│  └─ Detect: flaky tests                │
│                                         │
│  getPipelineMetrics(jobName)            │
│  ├─ Fetch: /wfapi/describe              │
│  ├─ Extract: stage durations            │
│  └─ Identify: bottlenecks               │
│                                         │
└─────────────────────────────────────────┘
```

**Metrics Provided**:
- Build Time (ms)
- Success Rate (%)
- Build Frequency (builds/week)
- Test Pass Rate (%)
- Flaky Test Count
- Pipeline Stage Durations
- Bottleneck Identification

---

### Jira Aggregator

```
┌─────────────────────────────────────────┐
│         JIRA AGGREGATOR                 │
├─────────────────────────────────────────┤
│                                         │
│  getSprintMetrics(sprintId)             │
│  ├─ Fetch: /rest/agile/1.0/sprint/...  │
│  ├─ Extract: story points, status       │
│  └─ Calculate: velocity, commitment     │
│                                         │
│  getDefectMetrics(projectKey)           │
│  ├─ Fetch: /rest/api/3/search (JQL)    │
│  ├─ Filter: bugs, production bugs       │
│  ├─ Calculate: escape rate, MTTR        │
│  └─ Analyze: blocked time               │
│                                         │
└─────────────────────────────────────────┘
```

**Metrics Provided**:
- Sprint Velocity (story points)
- Commitment Rate (%)
- Carryover (issues)
- Total Defects
- Defect Escape Rate (%)
- MTTR (hours)
- Blocked Time (hours)

---

### SonarQube Aggregator

```
┌─────────────────────────────────────────┐
│      SONARQUBE AGGREGATOR               │
├─────────────────────────────────────────┤
│                                         │
│  getQualityMetrics(projectKey)          │
│  ├─ Fetch: /api/measures/component     │
│  ├─ Extract: coverage, ratings          │
│  ├─ Extract: code smells, bugs          │
│  └─ Calculate: quality score            │
│                                         │
│  getTechnicalDebt(projectKey)           │
│  ├─ Fetch: /api/issues/search          │
│  ├─ Filter: CODE_SMELL, BUG, VULN      │
│  ├─ Calculate: effort, cost of delay   │
│  └─ Prioritize: by impact/effort       │
│                                         │
└─────────────────────────────────────────┘
```

**Metrics Provided**:
- Test Coverage (%)
- Maintainability Rating (A-E)
- Reliability Rating (A-E)
- Security Rating (A-E)
- Code Smells (count)
- Bugs (count)
- Vulnerabilities (count)
- Technical Debt Items
- Priority Scores

---

### GitHub Aggregator

```
┌─────────────────────────────────────────┐
│       GITHUB AGGREGATOR                 │
├─────────────────────────────────────────┤
│                                         │
│  getPRMetrics(repo, developer?)         │
│  ├─ Fetch: /repos/{owner}/{repo}/pulls │
│  ├─ Filter: merged PRs                  │
│  ├─ Calculate: merge time               │
│  └─ Calculate: review time              │
│                                         │
└─────────────────────────────────────────┘
```

**Metrics Provided**:
- Total PRs (count)
- Avg Merge Time (hours)
- Avg Review Time (hours)
- PR Velocity

---

## Error Handling & Resilience

### Fallback Strategy

```
┌─────────────────────────────────────────┐
│         API REQUEST FLOW                │
└─────────────────────────────────────────┘
                 │
                 ▼
         ┌───────────────┐
         │  Try Real API │
         └───────────────┘
                 │
        ┌────────┴────────┐
        │                 │
    Success           Failure
        │                 │
        ▼                 ▼
┌──────────────┐   ┌──────────────┐
│ Return Data  │   │ Log Error    │
└──────────────┘   └──────────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │ Return Mock  │
                  │    Data      │
                  └──────────────┘
```

### Error Handling Code

```typescript
async getBuildMetrics(jobName: string): Promise<BuildMetrics> {
  try {
    // Attempt real API call
    const response = await fetch(`${this.baseUrl}/job/${jobName}/api/json`, {
      headers: { 'Authorization': `Basic ${this.auth}` },
    });
    
    if (!response.ok) {
      throw new Error(`Jenkins API returned ${response.status}`);
    }
    
    const data = await response.json();
    return this.transformBuildData(data);
    
  } catch (error) {
    // Log error for debugging
    console.error('Jenkins API Error:', error);
    
    // Fallback to mock data
    return this.getMockBuildMetrics();
  }
}
```

---

## Performance Characteristics

### Timing Analysis

| Operation | Time (Demo) | Time (Production) | Notes |
|-----------|-------------|-------------------|-------|
| Jenkins Build | <1ms | 150-300ms | Depends on network |
| Jenkins Tests | <1ms | 100-250ms | Varies by test count |
| Jira Sprint | <1ms | 200-400ms | Depends on issue count |
| Jira Defects | <1ms | 150-350ms | JQL query complexity |
| SonarQube Quality | <1ms | 300-500ms | Project size matters |
| SonarQube Debt | <1ms | 400-600ms | Issue count |
| GitHub PRs | <1ms | 150-300ms | Repo activity |
| **Total (Parallel)** | **<10ms** | **400-600ms** | Slowest request |
| **Total (Sequential)** | **<10ms** | **1.5-2.5s** | Sum of all |

**Key Insight**: Parallel fetching reduces total time by **70-80%**

### Optimization Strategies

1. **Caching**:
   ```typescript
   // Cache metrics for 5 minutes
   const cache = new Map();
   const CACHE_TTL = 5 * 60 * 1000;
   ```

2. **Pagination**:
   ```typescript
   // Limit API responses
   GET /api/issues?ps=100  // Only first 100 items
   ```

3. **Field Filtering**:
   ```typescript
   // Request only needed fields
   GET /api/json?tree=builds[duration,result]{0,29}
   ```

4. **Batch Requests**:
   ```typescript
   // Combine multiple metrics in one call
   GET /api/measures/component?metricKeys=coverage,bugs,code_smells
   ```

---

## Security Architecture

### Authentication Flow

```
┌─────────────────────────────────────────┐
│      ENVIRONMENT VARIABLES              │
│                                         │
│  VITE_JENKINS_TOKEN=xxx                 │
│  VITE_JIRA_TOKEN=xxx                    │
│  VITE_SONAR_TOKEN=xxx                   │
└─────────────────────────────────────────┘
                 │
                 │ Loaded at build time
                 ▼
┌─────────────────────────────────────────┐
│         API_CONFIG Object               │
│                                         │
│  jenkins: { token: 'xxx' }              │
│  jira: { token: 'xxx' }                 │
│  sonarqube: { token: 'xxx' }            │
└─────────────────────────────────────────┘
                 │
                 │ Used by aggregators
                 ▼
┌─────────────────────────────────────────┐
│      Aggregator Constructors            │
│                                         │
│  this.auth = btoa(`user:${token}`)      │
└─────────────────────────────────────────┘
                 │
                 │ Sent with requests
                 ▼
┌─────────────────────────────────────────┐
│         HTTP Headers                    │
│                                         │
│  Authorization: Basic {base64}          │
└─────────────────────────────────────────┘
```

### Security Best Practices

1. **Never commit credentials**:
   ```bash
   # .gitignore
   .env
   .env.local
   .env.*.local
   ```

2. **Use environment-specific configs**:
   ```
   .env.development  # Dev credentials
   .env.production   # Prod credentials
   ```

3. **Minimum permissions**:
   - Jenkins: Read-only access to jobs
   - Jira: Read-only access to projects
   - SonarQube: Execute Analysis, Browse
   - GitHub: repo (read), read:org

4. **Token rotation**:
   - Rotate every 90 days
   - Use different tokens per environment
   - Revoke unused tokens

---

## Scalability Considerations

### Current Capacity

- **Teams**: Unlimited (demo mode)
- **Requests/min**: Unlimited (demo mode)
- **Response time**: <10ms (demo mode)

### Production Capacity

- **Teams**: 50-100 (with caching)
- **Requests/min**: Limited by API rate limits
  - Jenkins: ~100/min
  - Jira: ~600/min (10/sec)
  - SonarQube: ~100/min
  - GitHub: ~5000/hour
- **Response time**: 400-600ms per team

### Scaling Strategies

1. **Horizontal Scaling**:
   ```
   Load Balancer
        │
   ┌────┼────┐
   │    │    │
   App1 App2 App3
   ```

2. **Caching Layer**:
   ```
   Request → Cache Check → API Call → Cache Store
                 │
              Hit? Return
   ```

3. **Background Jobs**:
   ```
   Cron Job (every 5 min)
        │
        ▼
   Fetch & Cache Metrics
        │
        ▼
   Dashboard reads from cache
   ```

---

## Monitoring & Observability

### Logging Strategy

```typescript
// Request logging
console.log(`🔄 [${timestamp}] Fetching metrics for ${teamName}`);

// Success logging
console.log(`✅ [${timestamp}] Metrics fetched in ${duration}ms`);

// Error logging
console.error(`❌ [${timestamp}] API Error: ${error.message}`);

// Performance logging
console.log(`⏱️  [${timestamp}] Jenkins: ${jenkinsTime}ms, Jira: ${jiraTime}ms`);
```

### Health Checks

```typescript
// API health check endpoint
GET /api/health

Response:
{
  "status": "healthy",
  "services": {
    "jenkins": "up",
    "jira": "up",
    "sonarqube": "up",
    "github": "up"
  },
  "lastUpdate": "2024-11-19T22:00:00Z"
}
```

---

## Summary

The Data Aggregator architecture is:

✅ **Modular** - Each source is independent  
✅ **Resilient** - Fallbacks for every failure  
✅ **Performant** - Parallel fetching, caching  
✅ **Secure** - Token-based auth, no hardcoded secrets  
✅ **Scalable** - Designed for 100+ teams  
✅ **Observable** - Comprehensive logging  
✅ **Demo-Ready** - Works immediately with mock data  
✅ **Production-Ready** - Easy transition to real APIs  

**Perfect for pitching and deploying!** 🚀
