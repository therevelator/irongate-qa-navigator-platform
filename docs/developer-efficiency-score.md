# DDPS (Daily Developer Productivity Score) Documentation

## Overview

The DDPS is a metric that measures what percentage of a developer's workday is converted into deep, value-producing work. It uses **normalized metrics** based on an 8-hour workday.

## Formula

### Normalization (8-hour workday)
```
FT_n  = focus_time_hours / 8
PRT_n = pr_merge_time_avg / 8
RT_n  = code_review_time_avg / 8
MT_n  = meeting_time_hours / 8
CS_n  = min(context_switches / 5, 1)
```

### DDPS Calculation
```
DDPS = (1.0 * FT_n + 0.8 * PRT_n) / (1 + 0.5 * RT_n + 0.7 * MT_n + 1.2 * CS_n)
```

---

## Numeric Example

| Metric | Raw Value | Normalized |
|--------|-----------|------------|
| Focus Time | 1.0h | 0.125 |
| PR Time | 1.0h | 0.125 |
| Review Time | 1.0h | 0.125 |
| Meetings | 1.0h | 0.125 |
| Context Switches | 1 | 0.2 |

**Numerator:** 1.0 × 0.125 + 0.8 × 0.125 = **0.225**

**Denominator:** 1 + 0.5 × 0.125 + 0.7 × 0.125 + 1.2 × 0.2 = **1.39**

**DDPS = 0.225 / 1.39 ≈ 0.16 (16%)**

---

## Interpretation

| DDPS | Status | Description |
|------|--------|-------------|
| < 0.2 | 🔧 Fragmented | Blocked day, minimal deep work |
| 0.2–0.4 | ⚠️ Low | Below optimal productivity |
| 0.4–0.6 | ✅ Healthy | Good balance of deep work |
| 0.6–0.8 | ⚡ High | Strong productivity |
| > 0.8 | 🚀 Exceptional | Deep-focus day |

---

## Executive Summary Format

```
"Only ~16% of the day converted into deep, value-producing work.
Primary loss drivers: meetings and context switching."
```

---

## Database Schema

### Table: `developer_productivity_snapshots`

| Column | Type | Description |
|--------|------|-------------|
| id | INT | Primary key |
| developer_id | VARCHAR(100) | FK to users |
| snapshot_date | DATE | Date of snapshot |
| focus_time_hours | DECIMAL(5,2) | Raw focus time |
| pr_merge_time_avg | DECIMAL(5,2) | Raw PR time |
| code_review_time_avg | DECIMAL(5,2) | Raw review time |
| meeting_time_hours | DECIMAL(5,2) | Raw meeting time |
| context_switches_per_day | INT | Raw context switches |
| focus_time_norm | DECIMAL(5,4) | Normalized focus (0-1) |
| pr_time_norm | DECIMAL(5,4) | Normalized PR (0-1) |
| review_time_norm | DECIMAL(5,4) | Normalized review (0-1) |
| meeting_time_norm | DECIMAL(5,4) | Normalized meeting (0-1) |
| context_switches_norm | DECIMAL(5,4) | Normalized switches (0-1) |
| ddps_score | DECIMAL(5,4) | Calculated DDPS (0-1) |

---

## API Endpoint

### GET `/api/analytics/ddps-history`

**Query Parameters:**
- `developerId` - Filter by developer (optional)
- `teamId` - Filter by team (optional)
- `range` - Time range: `1d`, `7d`, `30d`, `3m`, `6m` (default: `30d`)

**Response:**
```json
{
  "range": "30d",
  "startDate": "2024-11-14",
  "endDate": "2024-12-14",
  "stats": {
    "average": 0.3245,
    "min": 0.1123,
    "max": 0.6789,
    "trend": 2.45,
    "totalSnapshots": 640
  },
  "executiveSummary": {
    "headline": "Only ~32% of the day converted into deep, value-producing work.",
    "status": "low productivity",
    "lossDrivers": "Primary loss drivers: meetings and context switching.",
    "recommendation": "Consider reducing meetings and protecting focus time blocks."
  },
  "chartData": [
    { "date": "2024-11-14", "ddps": 0.28, "developers": 35 },
    { "date": "2024-11-15", "ddps": 0.31, "developers": 35 }
  ],
  "snapshots": [...]
}
```

---

## Files

| Path | Description |
|------|-------------|
| `server/migrations/add_developer_productivity_snapshots.sql` | Database schema |
| `server/seeds/seedProductivitySnapshots.ts` | Seed 6 months of data |
| `server/routes/analytics.ts` | API endpoint (`/ddps-history`) |
| `src/components/DeveloperProductivity.tsx` | Frontend component |

---

## Seeding Data

```bash
npx ts-node server/seeds/seedProductivitySnapshots.ts
```

This generates 6 months of historical DDPS data for all developers (engineers, qa_engineers, team_leads).
