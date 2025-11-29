# AI Features Overview

## Purpose
This document describes the AI-driven capabilities of the QA Navigator dashboard. It highlights the technical mechanics behind developer-level insights, team suggestions, and how the business can surface contextual intelligence for faster, higher-confidence decisions.

---

## Technical Architecture

### Data Ingestion
- **Sources**: CI/CD (Jenkins, GitHub Actions), issue trackers (Jira), code quality (SonarQube), time instrumentation (manual metrics form or future telemetry). Data flows into the backend via aggregation services (`src/services/dataAggregator.ts`) or direct `POST` endpoints (`/metrics/developer`, `/metrics/manual`).
- **Storage**: `developer_metrics` and `kpi_snapshots` tables hold historical snapshots. Web API routes (`server/routes/metrics.ts`) handle upserts with `ON DUPLICATE KEY UPDATE` so metrics remain current.
- **Auth**: Restricted by role (`super_admin`, `manager`, `team_lead`) plus team/department scoping via `AuthContext`. RBAC ensures data is visible only to authorized users.

### AI Layer
- **Developer Insights**: Each developer card is backed by AI suggestions fetched through `GET /teams/:id/developer-ai-suggestions`. This endpoint merges stored developer metrics with heuristics for context (e.g., merge time, code review latency) so the UI presents actionable talking points.
- **Team Suggestions**: QA scores and Technical Debt values are evaluated against centralized thresholds (`src/config/metricsConfig.ts`) to determine statuses (good/warning/critical) and UI colors. These thresholds are also used to craft guidance such as “Invest in automation” or “Reduce meeting load.”
- **Feedback Loop**: Manual metric saves trigger toast notifications and refresh behaviors in `ManualMetricsInput.tsx`, ensuring the system recalculates scores and propagates them to dashboards without user refreshes.

---

## Developer Insights

### Metrics Captured
For each developer, the dashboard surfaces:
1. **PR Merge Time** – average elapsed from PR creation to merge. Lower is better.
2. **Code Review Time** – how fast the developer reviews peers.
3. **Focus Time** – hours spent in deep work (enterable via the manual metrics form or future API ingest).
4. **Meeting Time & Context Switches** – qualitative indicators that affect productivity.
5. **Happiness** – captured via manual surveys or future telemetry, helps the AI contextualize burnout risk.

### Insight Generation
- Data -> thresholds -> status colors (green/orange/red) via `metricsConfig.ts` helper functions (`getMetricStatus`, `getMetricBgColor`, etc.).
- Developer cards describe high/low performers and include AI hints, e.g., “Happiness is trending down while merge time rises—check if meetings expanded this sprint.”
- Combined with manual QA scores, managers get a quick view of who needs support or recognition.

---

## Team-Level AI Suggestions

### KPI Intelligence
- QA Score is a composite, refreshed whenever `kpi_snapshots` updates. The dashboard colors cards based on the score relative to thresholds defined in `metricsConfig.ts`.
- Technical Debt, Automation Coverage, and other team KPIs are compared to historical snapshots. Suggestions reference deltas (e.g., “Automation dropped 6% vs last week—consider scheduling a focused spike”).

### Suggested Actions
AI suggestions fall into these categories:
1. **Mitigate Risks**: when QA score is below 75 but trending downward, the suggestion might say “Prioritize test automation and block faster fixes.”
2. **Celebrate Wins**: if QA improves and focus time remains high, the card can say “Great sprint—merge time improved while focus time stayed stable.”
3. **Operational Reminders**: if context switching spikes, the AI nudges teams to schedule deep-work slots.
4. **Manual Input Prompts**: use toast guidance after manual saves to suggest next steps (e.g., “Refresh team view to reflect the latest QA score”).

### Business Impact
- **Visibility**: Business stakeholders see aggregated AI stories per team without digging into spreadsheets.
- **Confidence**: Machine-generated context reduces ambiguity around metrics, enabling faster decisions by QA managers and executives.
- **Actionability**: The combination of color-coded cards, AI comments, and drill-down metrics empowers teams to execute continuous improvement with measurable targets.

---

## Next Steps & Enhancements
1. **Integrate external focus-tracking APIs** (RescueTime, IDE telemetry) so developer insights no longer rely solely on manual metrics.
2. **Trend Forecasting** via lightweight ML models on QA score deltas to suggest expected next-week outcomes.
3. **Automated Playbooks** triggered by warnings (e.g., automatically open a Playbook modal when Technical Debt hits the critical zone).
4. **Natural Language Summaries** that export top insights for leadership briefings.
5. **Team Comparison Matrix** that highlights which teams are driving improvements and which need support.

---

Document revision: _Nov 28, 2025_ — covers AI features framing for technical and business audiences.
