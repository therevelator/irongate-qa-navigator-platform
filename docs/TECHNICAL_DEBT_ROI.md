# Technical Debt ROI Calculator

## Overview

The Technical Debt ROI Calculator provides a data-driven approach to prioritizing technical debt items by quantifying their business impact and calculating the return on investment for fixing them.

## ROI Calculation Model

### Investment (Cost to Fix)

```
Investment = Estimated Effort Hours × Developer Hourly Rate
```

**Example:** 40 hours × $75/hr = **$3,000 investment**

### Monthly Cost of Delay

The monthly loss from not fixing the debt is calculated from multiple impact factors:

```
Monthly Cost = Support Cost + Downtime Cost + Revenue Loss + SLA Penalties
```

Where:
- **Support Cost** = Monthly Support Tickets × Cost per Ticket
- **Downtime Cost** = Monthly Downtime Minutes × Cost per Minute
- **Revenue Loss** = Affected Users × Revenue per User × Impact Percentage
- **SLA Penalties** = Monthly SLA Breaches × Penalty per Breach

### ROI Percentage

```
ROI% = ((Annual Savings - Investment) / Investment) × 100
```

- **Annual Savings** = Monthly Cost of Delay × 12
- **ROI > 100%** = Positive return within first year
- **ROI > 200%** = High-value fix, prioritize immediately

### Payback Period

```
Payback (months) = Investment / Monthly Cost of Delay
```

Indicates how quickly the fix pays for itself.

---

## Impact Metrics

Each technical debt item tracks the following business impact metrics:

| Metric | Description | Example |
|--------|-------------|---------|
| **Affected Users** | Number of users impacted by this issue | 500 users |
| **Support Tickets/Month** | Monthly tickets caused by this debt | 25 tickets |
| **Downtime Minutes/Month** | Monthly downtime attributed to this issue | 30 minutes |
| **Revenue Impact %** | Percentage impact on revenue/conversions | 2.5% |
| **SLA Breaches/Month** | Monthly SLA violations caused | 3 breaches |

---

## Financial Configuration

Configure these values in **Settings → Parameters Configuration → Financial & ROI Settings**:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `developer_hourly_rate` | $75 | Fully-loaded cost per developer hour |
| `support_ticket_cost` | $25 | Average cost to handle one support ticket |
| `revenue_per_user_monthly` | $50 | Average monthly revenue per active user |
| `downtime_cost_per_minute` | $100 | Revenue lost per minute of downtime |
| `sla_breach_penalty` | $1,000 | Penalty cost per SLA violation |

These can be configured at company, department, or team level with inheritance.

---

## Prioritization Guidelines

### ROI-Based Priority

| ROI Range | Recommendation | Action |
|-----------|----------------|--------|
| **> 500%** | Critical value | Fix immediately, massive savings |
| **200-500%** | High value | Schedule this sprint |
| **100-200%** | Positive ROI | Schedule this quarter |
| **50-100%** | Break-even | Consider during slack time |
| **< 50%** | Low priority | Defer or reconsider |

### Payback Period

| Payback | Priority |
|---------|----------|
| **< 1 month** | Immediate fix |
| **1-3 months** | High priority |
| **3-6 months** | Medium priority |
| **> 6 months** | Low priority |

---

## Example Calculation

### Scenario: Legacy Authentication Bug

**Impact Metrics:**
- Affected Users: 1,000
- Support Tickets/Month: 50
- Downtime Minutes/Month: 60
- Revenue Impact: 3%
- SLA Breaches/Month: 5

**Effort Estimate:** 80 hours

**Calculation:**

```
Investment = 80 hrs × $75 = $6,000

Monthly Cost:
  Support:    50 × $25     = $1,250
  Downtime:   60 × $100    = $6,000
  Revenue:    1000 × $50 × 3% = $1,500
  SLA:        5 × $1,000   = $5,000
  ────────────────────────────────
  Total:                    = $13,750/month

Annual Savings = $13,750 × 12 = $165,000

ROI = (($165,000 - $6,000) / $6,000) × 100 = 2,650%

Payback = $6,000 / $13,750 = 0.44 months (< 2 weeks)
```

**Verdict:** 🔥 Fix immediately - exceptional ROI with 2-week payback.

---

## Data Sources

Impact metrics can be populated from:

1. **Manual Input** - Team leads estimate based on experience
2. **Support System Integration** - Auto-populate from Jira/Zendesk ticket counts
3. **Monitoring Tools** - Downtime from Datadog/New Relic
4. **Analytics** - Revenue impact from conversion tracking

---

## API Reference

### GET /analytics/technical-debt

Returns technical debt items with calculated ROI:

```json
{
  "debts": [
    {
      "id": "td-123",
      "title": "Refactor auth module",
      "severity": "high",
      "estimated_effort_hours": 40,
      "affected_users": 500,
      "support_tickets_monthly": 25,
      "downtime_minutes_monthly": 30,
      "revenue_impact_percent": 2.5,
      "sla_breaches_monthly": 3,
      "investment_cost": 3000,
      "monthly_cost_of_delay": 8750,
      "annual_savings": 105000,
      "roi_percentage": 3400,
      "payback_months": 0.3
    }
  ],
  "financial_config": {
    "developer_hourly_rate": 75,
    "support_ticket_cost": 25,
    "revenue_per_user_monthly": 50,
    "downtime_cost_per_minute": 100,
    "sla_breach_penalty": 1000
  }
}
```

---

## Best Practices

1. **Update impact metrics regularly** - Review monthly as issues evolve
2. **Use conservative estimates** - Better to underestimate ROI than overcommit
3. **Consider hidden costs** - Developer frustration, onboarding friction
4. **Track actuals** - After fixing, verify if savings materialized
5. **Combine with qualitative factors** - Security risks may override pure ROI

---

## Related Features

- [Parameters Configuration](./PARAMETERS_CONFIGURATION.md) - Configure financial settings
- [Manual Metrics Input](./MANUAL_METRICS_INPUT.md) - Input impact metrics per debt item
- [Developer Productivity](./DEVELOPER_PRODUCTIVITY.md) - Track developer time impact
