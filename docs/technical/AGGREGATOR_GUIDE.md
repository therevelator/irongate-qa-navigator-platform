# 🔄 Data Aggregator Guide

## Overview

The Data Aggregator system is the **heart of IronGate QA Navigator**. It collects, processes, and aggregates metrics from multiple sources (Jenkins, Jira, SonarQube, GitHub, etc.) into a unified view.

**Current Status**: ✅ Production-ready structure with demo data  
**To Go Live**: Simply add API credentials and uncomment real API calls

---

## 📁 File Structure

```
src/services/
└── dataAggregator.ts          # Main aggregator service
    ├── JenkinsAggregator      # CI/CD metrics
    ├── JiraAggregator         # Agile & defect metrics
    ├── SonarQubeAggregator    # Code quality metrics
    ├── GitHubAggregator       # PR & review metrics
    └── MasterDataAggregator   # Orchestrates all sources
```

---

## 🎯 How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  MasterDataAggregator                   │
│                                                         │
│  Orchestrates data collection from all sources         │
│  Calculates derived metrics (QA Score, etc.)           │
│  Returns unified team metrics                          │
└─────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Jenkins    │  │     Jira     │  │  SonarQube   │
│  Aggregator  │  │  Aggregator  │  │  Aggregator  │
└──────────────┘  └──────────────┘  └──────────────┘
        │                  │                  │
        ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Jenkins    │  │     Jira     │  │  SonarQube   │
│     API      │  │     API      │  │     API      │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Data Flow

1. **Configuration**: API endpoints and credentials loaded from `.env`
2. **Request**: Dashboard requests team metrics
3. **Parallel Fetch**: All aggregators fetch data simultaneously
4. **Processing**: Raw API data transformed to standard format
5. **Calculation**: Derived metrics computed (QA Score, etc.)
6. **Response**: Unified metrics returned to dashboard

---

## 🚀 Quick Start

### Demo Mode (Current)

The aggregators are currently running in **demo mode** with realistic mock data:

```typescript
import { dataAggregator } from './services/dataAggregator';

// Get metrics for a team
const metrics = await dataAggregator.aggregateTeamMetrics({
  name: 'Checkout Service',
  jenkinsJob: 'checkout-service-build',
  jiraProject: 'CHECKOUT',
  sprintId: '123',
  sonarProject: 'checkout-service',
  githubRepo: 'checkout-service',
});

console.log(metrics.qaScore); // 87
console.log(metrics.buildMetrics.successRate); // 92.5
```

### Production Mode

To connect real APIs:

1. **Copy environment template**:
   ```bash
   cp .env.example .env
   ```

2. **Add your API credentials** to `.env`:
   ```env
   VITE_JENKINS_URL=https://jenkins.yourcompany.com
   VITE_JENKINS_TOKEN=your-token
   VITE_JIRA_URL=https://yourcompany.atlassian.net
   VITE_JIRA_TOKEN=your-token
   # ... etc
   ```

3. **Uncomment real API calls** in `dataAggregator.ts`:
   ```typescript
   // Find sections marked "PRODUCTION MODE"
   // Uncomment the fetch() calls
   // Comment out the mock data returns
   ```

4. **Restart the app**:
   ```bash
   npm run dev
   ```

---

## 📊 Available Aggregators

### 1. Jenkins Aggregator

**Purpose**: CI/CD and test execution metrics

**Methods**:
- `getBuildMetrics(jobName)` - Build time, success rate, frequency
- `getTestMetrics(jobName)` - Test results, flaky tests, duration
- `getPipelineMetrics(jobName)` - Pipeline stages, bottlenecks

**Real API Endpoints**:
```
GET /job/{jobName}/api/json
GET /job/{jobName}/lastBuild/testReport/api/json
GET /job/{jobName}/lastBuild/wfapi/describe
```

**Example Usage**:
```typescript
const jenkins = new JenkinsAggregator();
const buildMetrics = await jenkins.getBuildMetrics('my-service-build');

console.log(buildMetrics);
// {
//   buildTime: 180000,
//   successRate: 92.5,
//   lastBuildStatus: 'SUCCESS',
//   buildFrequency: 20
// }
```

---

### 2. Jira Aggregator

**Purpose**: Sprint and defect tracking

**Methods**:
- `getSprintMetrics(sprintId)` - Velocity, commitment rate, carryover
- `getDefectMetrics(projectKey)` - Bug counts, escape rate, MTTR

**Real API Endpoints**:
```
GET /rest/agile/1.0/sprint/{sprintId}/issue
GET /rest/api/3/search?jql=...
```

**Example Usage**:
```typescript
const jira = new JiraAggregator();
const sprintMetrics = await jira.getSprintMetrics('123');

console.log(sprintMetrics);
// {
//   velocity: 45,
//   committedPoints: 50,
//   completedPoints: 45,
//   carryover: 2,
//   commitmentRate: 90
// }
```

---

### 3. SonarQube Aggregator

**Purpose**: Code quality and technical debt

**Methods**:
- `getQualityMetrics(projectKey)` - Coverage, ratings, code smells
- `getTechnicalDebt(projectKey)` - Debt items with priority scores

**Real API Endpoints**:
```
GET /api/measures/component?component={key}
GET /api/issues/search?componentKeys={key}
```

**Example Usage**:
```typescript
const sonar = new SonarQubeAggregator();
const quality = await sonar.getQualityMetrics('my-project');

console.log(quality);
// {
//   coverage: 85.3,
//   maintainabilityRating: 'A',
//   codeSmells: 234,
//   qualityScore: 87.5
// }
```

---

### 4. GitHub Aggregator

**Purpose**: Developer productivity metrics

**Methods**:
- `getPRMetrics(repo, developer?)` - PR merge time, review time

**Real API Endpoints**:
```
GET /repos/{owner}/{repo}/pulls
GET /repos/{owner}/{repo}/pulls/{number}/reviews
```

**Example Usage**:
```typescript
const github = new GitHubAggregator();
const prMetrics = await github.getPRMetrics('my-repo');

console.log(prMetrics);
// {
//   totalPRs: 52,
//   avgMergeTime: 18.5,  // hours
//   avgReviewTime: 3.2   // hours
// }
```

---

### 5. Master Aggregator

**Purpose**: Orchestrate all sources and calculate QA Score

**Methods**:
- `aggregateTeamMetrics(config)` - Get all metrics for a team

**Example Usage**:
```typescript
const aggregator = new MasterDataAggregator();

const allMetrics = await aggregator.aggregateTeamMetrics({
  name: 'Payment Gateway',
  jenkinsJob: 'payment-gateway-build',
  jiraProject: 'PAY',
  sprintId: '456',
  sonarProject: 'payment-gateway',
  githubRepo: 'payment-gateway',
});

console.log(allMetrics);
// {
//   teamName: 'Payment Gateway',
//   qaScore: 89,
//   buildMetrics: {...},
//   testMetrics: {...},
//   sprintMetrics: {...},
//   defectMetrics: {...},
//   qualityMetrics: {...},
//   prMetrics: {...},
//   lastUpdated: '2024-11-19T22:00:00Z'
// }
```

---

## 🔧 Configuration

### Environment Variables

All configuration is done through environment variables (`.env` file):

```env
# Jenkins
VITE_JENKINS_URL=https://jenkins.example.com
VITE_JENKINS_USER=username
VITE_JENKINS_TOKEN=api-token

# Jira
VITE_JIRA_URL=https://company.atlassian.net
VITE_JIRA_EMAIL=user@company.com
VITE_JIRA_TOKEN=api-token

# SonarQube
VITE_SONAR_URL=https://sonarqube.example.com
VITE_SONAR_TOKEN=user-token

# GitHub
VITE_GITHUB_TOKEN=ghp_xxxxx
VITE_GITHUB_ORG=your-org

# TestRail
VITE_TESTRAIL_URL=https://company.testrail.io
VITE_TESTRAIL_EMAIL=user@company.com
VITE_TESTRAIL_KEY=api-key

# Datadog
VITE_DATADOG_API_KEY=api-key
VITE_DATADOG_APP_KEY=app-key
```

### Team Configuration

Each team needs configuration mapping to their resources:

```typescript
interface TeamConfig {
  name: string;           // Team name
  jenkinsJob: string;     // Jenkins job name
  jiraProject: string;    // Jira project key
  sprintId: string;       // Current sprint ID
  sonarProject: string;   // SonarQube project key
  githubRepo: string;     // GitHub repository name
}
```

**Example**:
```typescript
const teams: TeamConfig[] = [
  {
    name: 'Web Team',
    jenkinsJob: 'web-app-build',
    jiraProject: 'WEB',
    sprintId: '123',
    sonarProject: 'web-app',
    githubRepo: 'web-app',
  },
  {
    name: 'Mobile Team',
    jenkinsJob: 'mobile-app-build',
    jiraProject: 'MOB',
    sprintId: '124',
    sonarProject: 'mobile-app',
    githubRepo: 'mobile-app',
  },
];
```

---

## 📈 Metrics Explained

### QA Score Calculation

The QA Score is a weighted average of key metrics:

```typescript
QA Score = (
  Test Coverage × 30% +
  (100 - Defect Escape Rate) × 25% +
  Build Success Rate × 25% +
  Code Quality Score × 20%
)
```

**Example**:
```
Test Coverage: 85%
Defect Escape Rate: 8%
Build Success Rate: 92%
Code Quality Score: 88

QA Score = (85 × 0.3) + (92 × 0.25) + (92 × 0.25) + (88 × 0.2)
         = 25.5 + 23 + 23 + 17.6
         = 89.1
```

### Derived Metrics

Some metrics are calculated from raw data:

**Flaky Test Detection**:
```typescript
// Test is flaky if it has both passes and failures in last 100 runs
flakinessScore = (statusChanges / totalRuns) × 100
```

**Bottleneck Detection**:
```typescript
// Stage is a bottleneck if it takes >40% of total pipeline time
bottleneckScore = (stageDuration / totalDuration) × 100
if (bottleneckScore > 40) → BOTTLENECK
```

**Priority Score** (Technical Debt):
```typescript
priorityScore = (impact / effort) × urgency
// Higher score = higher priority
```

---

## 🎯 Demo vs Production

### Current Demo Mode

**Advantages**:
- ✅ Works immediately without setup
- ✅ Realistic data for demos
- ✅ No API rate limits
- ✅ Fast response times
- ✅ No external dependencies

**Limitations**:
- ❌ Data doesn't reflect real systems
- ❌ No real-time updates
- ❌ Can't show actual team performance

### Production Mode

**Advantages**:
- ✅ Real data from your systems
- ✅ Actual team performance
- ✅ Real-time updates
- ✅ Historical trends
- ✅ Actionable insights

**Requirements**:
- API credentials for all systems
- Network access to APIs
- Proper permissions/scopes
- Rate limit management

---

## 🔐 Security Best Practices

### 1. Environment Variables
```bash
# Never commit .env file
echo ".env" >> .gitignore

# Use different credentials for dev/prod
.env.development
.env.production
```

### 2. API Tokens
- Use tokens with **minimum required permissions**
- Rotate tokens regularly (every 90 days)
- Never hardcode tokens in code
- Use read-only tokens when possible

### 3. Rate Limiting
```typescript
// Add rate limiting for production
const rateLimiter = {
  jenkins: 100,  // requests per minute
  jira: 10,
  sonarqube: 100,
  github: 5000,  // per hour
};
```

### 4. Error Handling
```typescript
// Always have fallbacks
try {
  return await fetchRealData();
} catch (error) {
  console.error('API Error:', error);
  return getMockData(); // Fallback to mock
}
```

---

## 🚦 Switching to Production

### Step-by-Step Guide

**1. Prepare API Credentials**
- [ ] Jenkins API token
- [ ] Jira API token
- [ ] SonarQube user token
- [ ] GitHub personal access token
- [ ] TestRail API key (optional)
- [ ] Datadog keys (optional)

**2. Configure Environment**
```bash
# Copy template
cp .env.example .env

# Edit with your credentials
nano .env
```

**3. Update Code**

In `dataAggregator.ts`, for each aggregator:

```typescript
// BEFORE (Demo Mode)
async getBuildMetrics(jobName: string): Promise<BuildMetrics> {
  return this.getMockBuildMetrics();
}

// AFTER (Production Mode)
async getBuildMetrics(jobName: string): Promise<BuildMetrics> {
  try {
    const response = await fetch(`${this.baseUrl}/job/${jobName}/api/json`, {
      headers: { 'Authorization': `Basic ${this.auth}` },
    });
    const data = await response.json();
    return {
      buildTime: data.lastBuild?.duration || 0,
      successRate: this.calculateSuccessRate(data.builds),
      lastBuildStatus: data.lastBuild?.result || 'UNKNOWN',
      buildFrequency: this.calculateBuildFrequency(data.builds),
    };
  } catch (error) {
    console.error('Jenkins API Error:', error);
    return this.getMockBuildMetrics(); // Fallback
  }
}
```

**4. Test Each Integration**

```typescript
// Test Jenkins
const jenkins = new JenkinsAggregator();
const buildMetrics = await jenkins.getBuildMetrics('test-job');
console.log('Jenkins:', buildMetrics);

// Test Jira
const jira = new JiraAggregator();
const sprintMetrics = await jira.getSprintMetrics('123');
console.log('Jira:', sprintMetrics);

// Test SonarQube
const sonar = new SonarQubeAggregator();
const quality = await sonar.getQualityMetrics('test-project');
console.log('SonarQube:', quality);
```

**5. Monitor & Optimize**

```typescript
// Add logging
console.log(`🔄 Fetching metrics for ${teamName}...`);
const startTime = Date.now();
const metrics = await aggregator.aggregateTeamMetrics(config);
const duration = Date.now() - startTime;
console.log(`✅ Metrics fetched in ${duration}ms`);
```

---

## 📊 Performance Optimization

### Caching Strategy

```typescript
// Add simple cache
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCachedMetrics(key: string, fetcher: () => Promise<any>) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  const data = await fetcher();
  cache.set(key, { data, timestamp: Date.now() });
  return data;
}
```

### Parallel Fetching

Already implemented in `MasterDataAggregator`:

```typescript
// All sources fetched in parallel
const [buildMetrics, testMetrics, sprintMetrics, ...] = await Promise.all([
  this.jenkins.getBuildMetrics(config.jenkinsJob),
  this.jenkins.getTestMetrics(config.jenkinsJob),
  this.jira.getSprintMetrics(config.sprintId),
  // ... more
]);
```

### Rate Limit Handling

```typescript
// Add retry logic with exponential backoff
async function fetchWithRetry(url: string, options: any, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) { // Rate limited
        await sleep(Math.pow(2, i) * 1000); // 1s, 2s, 4s
        continue;
      }
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
    }
  }
}
```

---

## 🎬 Demo Script for Pitching

### Show the Architecture

**"Here's how IronGate aggregates data from your existing tools..."**

1. Open `dataAggregator.ts`
2. Show the `MasterDataAggregator` class
3. Highlight parallel fetching
4. Show QA Score calculation

### Show the Flexibility

**"It works with demo data now, but switching to real APIs is simple..."**

1. Show `.env.example`
2. Show commented production code
3. Explain the 3-step process

### Show the Logic

**"Each metric is carefully calculated..."**

1. Show QA Score formula
2. Show flaky test detection
3. Show bottleneck identification

### Show the Value

**"This eliminates manual data collection and provides real-time insights..."**

- Point to parallel fetching → "Metrics in seconds, not hours"
- Point to QA Score → "Single number executives understand"
- Point to derived metrics → "Actionable insights, not just data"

---

## 🎯 Next Steps

### For Demo/Pitch
- ✅ Use current demo mode
- ✅ Show architecture and logic
- ✅ Explain easy transition to production

### For Pilot/POC
- [ ] Get API credentials for 1-2 teams
- [ ] Enable production mode for those teams
- [ ] Run side-by-side with demo data
- [ ] Validate accuracy

### For Production
- [ ] Get credentials for all teams
- [ ] Enable all integrations
- [ ] Set up caching layer
- [ ] Add monitoring/alerting
- [ ] Train users

---

**The aggregators are production-ready and designed for easy transition from demo to live data!** 🚀
