# Technical Debt Tracker

Comprehensive ROI-driven prioritization workflow for technical debt items.

## Overview
- Visual dashboard for tracking investment vs savings
- Filter by category/severity, sort by ROI, effort, cost, priority
- Responsive UI with dark mode support
- Real-time ROI calculations from backend metrics
- PDF export aligned with severity ordering & business impact

## Data Pipeline
1. **Backend (`/analytics/technical-debt`)**
   - Aggregates technical debt records with impact metrics:
     - `affected_users`, `support_tickets_monthly`, `downtime_minutes_monthly`, `revenue_impact_percent`, `sla_breaches_monthly`
   - Applies financial configuration inheritance (company/department/team)
   - Calculates derived metrics per debt:
     - `investment_cost = effort_hours × developer_hourly_rate`
     - `monthly_cost_of_delay = support + downtime + revenue loss + SLA penalties`
     - `annual_savings = monthly_cost_of_delay × 12`
     - `roi_percentage = ((annual_savings - investment_cost) / investment_cost) × 100`
     - `payback_months = investment_cost / monthly_cost_of_delay`
   - Returns `financial_config` plus enriched `debts[]`

2. **Manual Metrics Input**
   - Allows admins to update impact metrics per debt item
   - Real-time recalculation of ROI using same formula as backend
   - Saves via `PUT /analytics/technical-debt/:id/impact`
   - Emits `technical-debt-updated` event to refresh tracker UI

3. **Frontend (`TechnicalDebtTracker.tsx`)**
   - Fetches debts on mount and on update events
   - Stores filters (category, severity) and sorting preference (ROI default)
   - Derived arrays:
     - `filteredDebt`: excludes resolved items and applies filters
     - `sortedDebt`: sorts by selected criterion (ROI/priority/effort/cost)
     - `matrixData`: feeds scatter chart (effort vs impact vs priority)

## UI Sections
### 1. Header & Stats
- Sticky header with back button and PDF export
- Responsive stats grid (Total items, Effort, Cost of Delay, In Progress)
- Dark mode-compatible backgrounds per stat type

### 2. Filters
- Category buttons (scrollable on mobile)
- Severity chips
- Sort dropdown (ROI default)
- All components support light/dark themes and small screens

### 3. Priority Matrix
- Scatter plot (Effort vs Impact) with priority bubble size
- Tooltip shows effort, impact, priority, title
- Legend keyed to severity colors

### 4. Debt Cards
Each card displays:
- Severity badges + status chips
- Dynamic ROI metric row (Investment, Monthly Loss, Annual Savings, ROI, Age)
- CTA buttons (start work, mark resolved)
- Expandable section with:
  - Business impact tiles (users, tickets, downtime, revenue impact, SLA breaches)
  - ROI analysis (investment, savings, net benefit)
  - Priority justification text referencing ROI and payback
- Responsive grid layout ensures readability on mobile

## PDF Export
Triggered via "Export PDF" button.

### Report Content
1. **Cover/Header**
   - IronGate branding and filters summary
   - Generated timestamp
2. **Summary line**
   - Total items, total effort, total investment, annual savings, avg ROI
   - Critical/high ROI item counts highlighted
3. **Main Table**
   - Columns: Title, Severity, Category, Effort, Investment, Monthly Loss, Annual Save, ROI, Payback
   - Severity-aware row backgrounds (light red/orange/yellow/green)
   - Severity ordering enforced when "All severities" selected
   - Payback < 0.1 months rendered as "Instant"
4. **Impact Details Page** (if available)
   - Table with Affected Users, Tickets, Downtime, Revenue Impact %, SLA breaches

### Implementation Notes
- Uses `jspdf` + `jspdf-autotable`
- Logo loaded from `/irongate-logo.png`; errors ignored
- `technical-debt-roi-report.pdf` filename

## Key Files
- `server/routes/analytics.ts`: data & ROI calculations
- `src/components/ManualMetricsInput.tsx`: impact editing form
- `src/components/TechnicalDebtTracker.tsx`: frontend dashboard + PDF export
- `docs/TECHNICAL_DEBT_ROI.md`: formula reference

## Future Enhancements
- Add per-team breakdown within PDF
- Allow CSV export of same dataset
- Integrate status transitions when marking resolved
