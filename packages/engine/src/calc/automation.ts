/**
 * Calculation engine: test automation, from the test management tool's own records (TestRail, Xray,
 * Zephyr Scale: test cases with "automated or not" and their manual estimate, test executions) and the
 * issue tracker's work items of test automation.
 *
 * Per team and UTC day D on which the team has test cases:
 *
 *   automation_coverage → automation_coverage   automated test cases ÷ test cases × 100
 *                                                (the cases known at the end of D; archived cases not counted)
 *   automation_roi      → automation_roi         (time saved − time invested) ÷ time invested × 100, over the
 *                                                ROI_WINDOW_DAYS days ending D:
 *                                                time saved    = Σ over the automated executions of cases with a
 *                                                                manual estimate: estimate − the run's own duration
 *                                                                (never below 0)
 *                                                time invested = time logged on the test-automation work items
 *                                                                resolved in the window
 *
 * No value is invented: without cases there is no coverage; without an automated execution of a case that has
 * an estimate, or without time logged on automation work, there is no ROI. Pure computeAutomationDay (the server
 * reads the records in server/lib/calc/automation.ts, loadAutomationData).
 */
import type { ComputedMetric, MetricSpec } from './types';

export const ROI_WINDOW_DAYS = 30;
const DAY = 86_400_000;

export const AUTOMATION_METRICS: Record<string, MetricSpec> = {
  automation_coverage: { key: 'automation_coverage', label: 'Test automation coverage', unit: '%', kpi: 'automation_coverage', group: 'automation',
    formula: 'automated test cases ÷ test cases × 100, over the cases of the test management tool known at the end of the day (archived cases not counted)' },
  automation_roi: { key: 'automation_roi', label: 'Automation ROI', unit: '%', kpi: 'automation_roi', group: 'automation',
    formula: '(time saved − time invested) ÷ time invested × 100 over the 30 days ending the day; time saved = Σ (manual estimate − run duration) over the automated executions of cases with an estimate; time invested = time logged on the test-automation work items resolved in the period' },
};

export interface CaseRow { key: string; source: string; automated: boolean; manualEstimateS: number | null; knownAt: number }
export interface ExecutionRow { key: string; caseKey: string; source: string; automated: boolean; executedAt: number; durationS: number | null }
export interface AutomationWorkRow { key: string; resolvedAt: number; timeLoggedHours: number }
export interface AutomationData { cases: CaseRow[]; executions: ExecutionRow[]; work: AutomationWorkRow[] }

const r2 = (v: number) => Math.round(v * 100) / 100;

export function computeAutomationDay(day: string, data: AutomationData, now = Date.now()): ComputedMetric[] {
  const dayStart = Date.parse(`${day}T00:00:00Z`);
  const asOf = Math.min(dayStart + DAY - 1, now);
  if (asOf < dayStart) return [];
  const cases = data.cases.filter((c) => c.knownAt <= asOf);
  if (!cases.length) return [];
  const out: ComputedMetric[] = [];
  const automated = cases.filter((c) => c.automated);
  const at = new Date(Math.min(asOf, Math.max(dayStart, ...cases.map((c) => c.knownAt).filter((t) => t <= asOf)))).toISOString();
  const bySource: Record<string, { cases: number; automated: number }> = {};
  for (const c of cases) {
    const s = (bySource[c.source] ??= { cases: 0, automated: 0 });
    s.cases += 1;
    if (c.automated) s.automated += 1;
  }
  out.push({
    key: 'automation_coverage', value: r2((automated.length / cases.length) * 100),
    inputs: { automatedCases: automated.length, testCases: cases.length, bySource },
    sources: { sample: cases.slice(0, 20).map((c) => ({ key: c.key, source: c.source, automated: c.automated })) },
    sampleSize: cases.length, recordedAt: at,
  });

  const from = asOf - ROI_WINDOW_DAYS * DAY;
  const estimate = new Map(cases.filter((c) => c.manualEstimateS !== null && c.manualEstimateS > 0).map((c) => [`${c.source}\u0000${c.key}`, c.manualEstimateS as number]));
  const runs = data.executions.filter((e) => e.automated && e.executedAt > from && e.executedAt <= asOf && estimate.has(`${e.source}\u0000${e.caseKey}`));
  const work = data.work.filter((w) => w.resolvedAt > from && w.resolvedAt <= asOf && w.timeLoggedHours > 0);
  const investedS = work.reduce((n, w) => n + w.timeLoggedHours * 3600, 0);
  if (runs.length && investedS > 0) {
    const savedS = runs.reduce((n, e) => n + Math.max(0, (estimate.get(`${e.source}\u0000${e.caseKey}`) as number) - (e.durationS ?? 0)), 0);
    out.push({
      key: 'automation_roi', value: r2(((savedS - investedS) / investedS) * 100),
      inputs: { timeSavedHours: r2(savedS / 3600), timeInvestedHours: r2(investedS / 3600), automatedExecutions: runs.length, automationWorkItems: work.length, periodDays: ROI_WINDOW_DAYS },
      sources: { workItems: work.slice(0, 50).map((w) => w.key), executions: runs.slice(0, 20).map((e) => e.key) },
      sampleSize: runs.length, recordedAt: new Date(Math.max(...runs.map((e) => e.executedAt), ...work.map((w) => w.resolvedAt))).toISOString(),
    });
  }
  return out;
}

/** The days whose automation values depend on a record of `day`: that day and the ROI window after it (up to today). */
export function automationAffectedDays(eventDays: string[], today = new Date().toISOString().slice(0, 10)): string[] {
  const set = new Set<string>();
  for (const d of eventDays.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x <= today)) {
    const start = Date.parse(`${d}T00:00:00Z`);
    for (let i = 0; i <= ROI_WINDOW_DAYS; i++) {
      const x = new Date(start + i * DAY).toISOString().slice(0, 10);
      if (x > today) break;
      set.add(x);
    }
  }
  return Array.from(set).sort();
}
