/**
 * Calculation engine: test automation coverage and ROI from the test management records (tm_cases,
 * tm_executions) and the test-automation work items (issues labelled "test-automation"). The calculation is the shared
 * engine's (packages/engine/src/calc/automation.ts); loadAutomationData reads what a range of days needs.
 */
import type pg from 'pg';
import type { ComputedMetric } from './engine';
import { computeAutomationDay, ROI_WINDOW_DAYS, type AutomationData } from '../../../packages/engine/src/calc/automation';

export { ROI_WINDOW_DAYS, AUTOMATION_METRICS, computeAutomationDay, automationAffectedDays, type AutomationData } from '../../../packages/engine/src/calc/automation';

let ready: boolean | null = null;
/** The test management tables exist (a deploy before migration 20261209000000 calculates no automation values). */
export async function automationTables(client: pg.PoolClient): Promise<boolean> {
  if (ready) return true;
  ready = !!(await client.query(`SELECT to_regclass('public.tm_cases') IS NOT NULL AS ok`)).rows[0]?.ok;
  return ready;
}

const ms = (v: any): number => new Date(v).getTime();

export async function loadAutomationData(client: pg.PoolClient, teamId: string, from: string, to: string): Promise<AutomationData> {
  const cases = (await client.query(
    `SELECT source, case_key, automated, manual_estimate_s, received_at FROM tm_cases WHERE team_id = $1 AND NOT archived AND received_at < $2::date + 1`, [teamId, to])).rows;
  if (!cases.length) return { cases: [], executions: [], work: [] };
  const executions = (await client.query(
    `SELECT source, execution_key, case_key, automated, executed_at, duration_s FROM tm_executions
      WHERE team_id = $1 AND executed_at >= $2::date - ${ROI_WINDOW_DAYS + 1} AND executed_at < $3::date + 1`, [teamId, from, to])).rows;
  const work = (await client.query(
    `SELECT external_id, resolved_at, time_logged_hours::float8 AS h FROM issues
      WHERE team_id = $1 AND labels @> ARRAY['test-automation']::varchar[] AND NOT is_sample AND resolved_at IS NOT NULL AND time_logged_hours > 0
        AND resolved_at >= $2::date - ${ROI_WINDOW_DAYS + 1} AND resolved_at < $3::date + 1`, [teamId, from, to]).catch(() => ({ rows: [] as any[] }))).rows;
  return {
    cases: cases.map((c: any) => ({ key: c.case_key, source: c.source, automated: !!c.automated, manualEstimateS: c.manual_estimate_s === null ? null : Number(c.manual_estimate_s), knownAt: ms(c.received_at) })),
    executions: executions.map((e: any) => ({ key: e.execution_key, caseKey: e.case_key, source: e.source, automated: !!e.automated, executedAt: ms(e.executed_at), durationS: e.duration_s === null ? null : Number(e.duration_s) })),
    work: work.map((w: any) => ({ key: w.external_id, resolvedAt: ms(w.resolved_at), timeLoggedHours: Number(w.h) })),
  };
}

export async function computeAutomationDays(client: pg.PoolClient, teamId: string, days: string[], now = Date.now()): Promise<Map<string, ComputedMetric[]>> {
  const out = new Map<string, ComputedMetric[]>();
  if (!days.length || !(await automationTables(client))) return out;
  const sorted = [...days].sort();
  const data = await loadAutomationData(client, teamId, sorted[0], sorted[sorted.length - 1]);
  if (!data.cases.length) return out;
  for (const d of sorted) out.set(d, computeAutomationDay(d, data, now));
  return out;
}
