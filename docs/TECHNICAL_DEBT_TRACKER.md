# Technical Debt Tracker - Complete Documentation

**Date**: December 14, 2024  
**Version**: 1.0.0

## Overview

The Technical Debt Tracker is a feature in QA Navigator that helps teams identify, prioritize, and quantify the business impact of technical debt. It calculates the **Cost of Delay** for each debt item, enabling data-driven decisions about which issues to fix first.

---

## Table of Contents

1. [Cost of Delay Formula](#cost-of-delay-formula)
2. [Input Metrics](#input-metrics)
3. [ROI Calculations](#roi-calculations)
4. [Real-World Data Sources](#real-world-data-sources)
5. [API Integration Examples](#api-integration-examples)
6. [Database Schema](#database-schema)
7. [Configuration Options](#configuration-options)

---

## Cost of Delay Formula

### Overview

**Cost of Delay** represents the monthly financial impact of NOT fixing a technical debt item. It answers: *"How much money are we losing each month by leaving this unfixed?"*

### Formula

```
Monthly Cost of Delay = Support Cost + Downtime Cost + Revenue Loss + SLA Penalties
```

### Component Breakdown

| Component | Formula | Default Rate |
|-----------|---------|--------------|
| **Support Cost** | `support_tickets_monthly × support_ticket_cost` | $25/ticket |
| **Downtime Cost** | `downtime_minutes_monthly × downtime_cost_per_minute` | $100/minute |
| **Revenue Loss** | `affected_users × revenue_per_user_monthly × (revenue_impact_percent / 100)` | $50/user |
| **SLA Penalties** | `sla_breaches_monthly × sla_breach_penalty` | $1,000/breach |

### Example Calculation

For a technical debt item with:
- 50 support tickets/month
- 10 minutes downtime/month
- 500 affected users with 5% revenue impact
- 2 SLA breaches/month

```
Support Cost    = 50 × $25         = $1,250
Downtime Cost   = 10 × $100        = $1,000
Revenue Loss    = 500 × $50 × 5%   = $1,250
SLA Penalties   = 2 × $1,000       = $2,000
────────────────────────────────────────────
Monthly Cost of Delay              = $5,500
Annual Cost of Delay               = $66,000
```

---

## Input Metrics

### Per-Item Impact Metrics

| Metric | Description | How to Measure |
|--------|-------------|----------------|
| **Affected Users** | Number of users who experience this issue | Support ticket analysis, error logs, user complaints |
| **Support Tickets/Month** | Tickets generated specifically by this issue | Jira/Zendesk filtering by bug ID or keyword |
| **Downtime Minutes/Month** | System outage or degradation caused | Monitoring tools (Datadog, PagerDuty) |
| **Revenue Impact %** | Percentage of user revenue affected | Business analysis, conversion funnel data |
| **SLA Breaches/Month** | Contract violations caused by this issue | SLA monitoring dashboards |
| **Estimated Effort Hours** | Developer hours required to fix | Engineering estimation, story points conversion |

### Financial Configuration (Customizable)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `developer_hourly_rate` | $75 | Fully-loaded developer cost |
| `support_ticket_cost` | $25 | Average cost to handle one ticket |
| `downtime_cost_per_minute` | $100 | Business cost per minute of outage |
| `revenue_per_user_monthly` | $50 | Average revenue per affected user |
| `sla_breach_penalty` | $1,000 | Financial penalty per SLA violation |

---

## ROI Calculations

### Formulas

```typescript
// Investment to fix
investmentCost = estimated_effort_hours × developer_hourly_rate

// Savings if fixed
annualSavings = monthly_cost_of_delay × 12

// Return on Investment
roiPercentage = ((annualSavings - investmentCost) / investmentCost) × 100

// Time to recoup investment
paybackMonths = investmentCost / monthly_cost_of_delay
```

### ROI Interpretation Guide

| ROI % | Payback | Recommendation |
|-------|---------|----------------|
| > 200% | < 3 months | **High Priority** - Fix immediately |
| 100-200% | 3-6 months | **Schedule Now** - Fix within quarter |
| 50-100% | 6-12 months | **Plan** - Add to roadmap |
| < 50% | > 12 months | **Defer** - May not justify immediate action |

---

## Real-World Data Sources

### 1. Support Tickets

**Jira Service Management**
```
Endpoint: /rest/servicedeskapi/request
Purpose: Get support tickets related to specific issues
```

**Zendesk**
```
Endpoint: /api/v2/search.json?query=tags:bug-{bugId}
Purpose: Search tickets tagged with bug IDs
```

**Freshdesk**
```
Endpoint: /api/v2/tickets?filter=all&tag={issueTag}
Purpose: Filter tickets by issue tags
```

---

### 2. Downtime & Incidents

**PagerDuty**
```
Endpoint: /incidents
Purpose: Get incident duration and frequency
```

**Datadog**
```
Endpoint: /api/v1/events (or /api/v2/incidents)
Purpose: Monitor outages, calculate MTTR
```

**StatusPage.io**
```
Endpoint: /api/v2/incidents.json
Purpose: Get historical incident data
```

**AWS CloudWatch**
```
Endpoint: cloudwatch:GetMetricStatistics
Purpose: Monitor availability metrics
```

---

### 3. User Impact & Error Rates

**Sentry**
```
Endpoint: /api/0/projects/{org}/{project}/issues/
Purpose: Get error counts per issue, affected users
```

**New Relic**
```
Endpoint: /v2/applications/{app_id}/metrics/data.json
Purpose: Error rates, user sessions affected
```

**Google Analytics**
```
Endpoint: POST /v4/reports:batchGet
Purpose: User journey dropoffs, session data
```

**Mixpanel**
```
Endpoint: /api/2.0/jql?script=...
Purpose: User behavior, funnel conversion
```

---

### 4. Code Quality & Technical Debt

**SonarQube**
```
Endpoint: /api/issues/search
Purpose: Get code smells, bugs, vulnerabilities
```

**GitHub**
```
Endpoint: /repos/{owner}/{repo}/issues
Purpose: Open issues, pull request age
```

**CodeClimate**
```
Endpoint: /v1/repos/{repo_id}/issues
Purpose: Technical debt rating per file
```

---

### 5. SLA & Performance

**Prometheus**
```
Endpoint: /api/v1/query
Purpose: SLA compliance metrics (uptime, latency)
```

**Grafana**
```
Endpoint: /api/datasources/proxy/{id}/api/v1/query
Purpose: Query Prometheus/InfluxDB for SLA data
```

**Uptime Robot**
```
Endpoint: /v2/getMonitors
Purpose: Uptime percentage, response times
```

---

## API Integration Examples

### 1. Jira - Get Bug Impact Data

```typescript
// Get all issues related to technical debt
const response = await fetch(
  `${JIRA_URL}/rest/api/3/search?jql=project=${PROJECT}&labels=tech-debt`,
  {
    headers: {
      'Authorization': `Basic ${btoa(`${JIRA_EMAIL}:${JIRA_TOKEN}`)}`,
      'Content-Type': 'application/json'
    }
  }
);

const data = await response.json();
const debtItems = data.issues.map(issue => ({
  id: issue.key,
  title: issue.fields.summary,
  category: issue.fields.labels.find(l => l.startsWith('category-')),
  severity: issue.fields.priority.name,
  estimated_effort_hours: issue.fields.customfield_10016 // Story points × 4
}));
```

### 2. Zendesk - Get Support Ticket Count

```typescript
// Get tickets related to a specific bug
const getTicketCount = async (bugId: string) => {
  const response = await fetch(
    `${ZENDESK_URL}/api/v2/search.json?query=tags:bug-${bugId}`,
    {
      headers: {
        'Authorization': `Basic ${btoa(`${ZENDESK_EMAIL}/token:${ZENDESK_TOKEN}`)}`
      }
    }
  );
  
  const data = await response.json();
  return data.count;
};
```

### 3. PagerDuty - Get Incident Duration

```typescript
// Get total downtime for incidents related to a service
const getDowntimeMinutes = async (serviceId: string) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  
  const response = await fetch(
    `${PAGERDUTY_URL}/incidents?service_ids[]=${serviceId}&since=${since}`,
    {
      headers: {
        'Authorization': `Token token=${PAGERDUTY_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
  
  const data = await response.json();
  
  let totalMinutes = 0;
  for (const incident of data.incidents) {
    const created = new Date(incident.created_at);
    const resolved = new Date(incident.resolved_at || Date.now());
    totalMinutes += (resolved - created) / (1000 * 60);
  }
  
  return totalMinutes;
};
```

### 4. Sentry - Get Affected Users

```typescript
// Get number of users affected by an issue
const getAffectedUsers = async (issueId: string) => {
  const response = await fetch(
    `${SENTRY_URL}/api/0/issues/${issueId}/`,
    {
      headers: {
        'Authorization': `Bearer ${SENTRY_TOKEN}`
      }
    }
  );
  
  const issue = await response.json();
  return issue.userCount;
};
```

### 5. SonarQube - Get Technical Debt Items

```typescript
// Get all issues with technical debt
const getTechnicalDebt = async (projectKey: string) => {
  const response = await fetch(
    `${SONAR_URL}/api/issues/search?componentKeys=${projectKey}&types=CODE_SMELL,BUG&ps=500`,
    {
      headers: {
        'Authorization': `Basic ${btoa(`${SONAR_TOKEN}:`)}`
      }
    }
  );
  
  const data = await response.json();
  
  return data.issues.map(issue => ({
    id: issue.key,
    title: issue.message,
    category: mapIssueType(issue.type),
    severity: issue.severity.toLowerCase(),
    effort_hours: parseEffort(issue.debt), // "2h30min" → 2.5
    file: issue.component
  }));
};
```

### 6. Datadog - Monitor SLA Breaches

```typescript
// Check SLA compliance
const getSLABreaches = async (serviceId: string) => {
  const response = await fetch(
    `${DATADOG_URL}/api/v1/slo/${serviceId}/history`,
    {
      headers: {
        'DD-API-KEY': DATADOG_API_KEY,
        'DD-APPLICATION-KEY': DATADOG_APP_KEY
      }
    }
  );
  
  const data = await response.json();
  const target = data.data.target; // e.g., 99.9
  const actual = data.data.uptime;
  
  // Count periods where actual < target
  const breaches = data.data.history.filter(
    period => period.uptime < target
  ).length;
  
  return breaches;
};
```

---

## Database Schema

### Technical Debt Table

```sql
CREATE TABLE technical_debt (
  id VARCHAR(36) PRIMARY KEY,
  team_id VARCHAR(36) REFERENCES teams(id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category ENUM('code_quality', 'testing', 'documentation', 'infrastructure', 'security', 'performance'),
  severity ENUM('low', 'medium', 'high', 'critical'),
  status ENUM('open', 'in_progress', 'resolved') DEFAULT 'open',
  priority_score DECIMAL(5,2),
  
  -- Impact Metrics (input)
  estimated_effort_hours INT DEFAULT 0,
  affected_users INT DEFAULT 0,
  support_tickets_monthly INT DEFAULT 0,
  downtime_minutes_monthly INT DEFAULT 0,
  revenue_impact_percent DECIMAL(5,2) DEFAULT 0,
  sla_breaches_monthly INT DEFAULT 0,
  
  -- Calculated Fields
  cost_of_delay DECIMAL(12,2),
  monthly_cost_of_delay DECIMAL(12,2),
  investment_cost DECIMAL(12,2),
  annual_savings DECIMAL(12,2),
  roi_percentage INT,
  payback_months DECIMAL(4,1),
  
  created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Financial Configuration Table

```sql
CREATE TABLE financial_config (
  id VARCHAR(36) PRIMARY KEY,
  company_id VARCHAR(36) REFERENCES companies(id),
  developer_hourly_rate DECIMAL(10,2) DEFAULT 75.00,
  support_ticket_cost DECIMAL(10,2) DEFAULT 25.00,
  downtime_cost_per_minute DECIMAL(10,2) DEFAULT 100.00,
  revenue_per_user_monthly DECIMAL(10,2) DEFAULT 50.00,
  sla_breach_penalty DECIMAL(10,2) DEFAULT 1000.00,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

---

## Configuration Options

### Environment Variables

```env
# Developer rates
DEVELOPER_HOURLY_RATE=75
SUPPORT_TICKET_COST=25
DOWNTIME_COST_PER_MINUTE=100
REVENUE_PER_USER_MONTHLY=50
SLA_BREACH_PENALTY=1000

# External API connections (for automated data collection)
JIRA_URL=https://company.atlassian.net
JIRA_EMAIL=api@company.com
JIRA_TOKEN=your-jira-api-token

ZENDESK_URL=https://company.zendesk.com
ZENDESK_EMAIL=api@company.com
ZENDESK_TOKEN=your-zendesk-token

PAGERDUTY_URL=https://api.pagerduty.com
PAGERDUTY_TOKEN=your-pagerduty-token

SENTRY_URL=https://sentry.io
SENTRY_TOKEN=your-sentry-token

SONAR_URL=https://sonarqube.company.com
SONAR_TOKEN=your-sonar-token

DATADOG_URL=https://api.datadoghq.com
DATADOG_API_KEY=your-datadog-api-key
DATADOG_APP_KEY=your-datadog-app-key
```

---

## Future Enhancements

1. **Automated Data Collection** - Scheduled jobs to pull metrics from external APIs
2. **ML-Based Prioritization** - Use machine learning to predict which debts will cause issues
3. **Trend Analysis** - Show how Cost of Delay changes over time
4. **Team Comparison** - Compare technical debt across teams
5. **Integration Webhooks** - Receive real-time updates when incidents occur
6. **Export to Jira** - Create Jira tickets directly from debt items
7. **Slack Notifications** - Alert teams when high-priority debt items emerge
