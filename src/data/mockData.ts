// Team data shapes returned by GET /api/teams.
// (This file used to also export a random mock-team generator; it was removed so that
// no invented team, score or history can be displayed. All team data comes from the API.)

export interface KPIMetric {
  id: string;
  name: string;
  value: number | string;
  unit?: string;
  change: number;
  trend: 'up' | 'down' | 'neutral';
  status: 'good' | 'warning' | 'critical';
  history: { date: string; value: number }[];
}

export interface Team {
  id: string;
  name: string;
  department: string;
  qaScore: number;               // 0–100; may be null at runtime when the team has no KPI snapshot
  status: 'good' | 'warning' | 'critical';
  velocity: { sprint: string; committed: number; delivered: number }[];
  metrics: KPIMetric[];
  technicalDebtScore?: number | null;  // Lower is better (0-100 scale)
  taskSizingAccuracy?: number | null;  // 1.0 is perfect, <1 overestimated, >1 underestimated
  snapshotDate?: string | null;        // date of the KPI snapshot the scores come from
}
