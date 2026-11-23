/**
 * "Live data only" (companies.settings.liveDataOnly, set by platform support in the operator panel).
 *
 * For a company in live operation every metric comes from the raw data its tools hold, sent by the
 * QE Navigator Exporter (or the raw ingestion API / Upload files), and QE Navigator calculates it.
 * With the setting on:
 *   - nobody types a metric: Manual metrics (team KPIs, developer metrics, pipeline stages) is off
 *     in the app and refused by the API;
 *   - a finished value is refused for every KPI QE Navigator calculates itself (RAW_SOURCED_KPIS),
 *     whoever sends it (POST /api/ingest/kpis, the Exporter's KPI file). A KPI with no raw source
 *     (automation coverage, automation ROI) may still be sent, but never typed;
 *   - the monthly quality side of Business impact is the one derived from the KPI values; typed
 *     quality values are refused (business figures, which no tool of ours measures, are still entered);
 *   - modules with no raw source (Performance) are not offered.
 * Off (the default, and every sample company) nothing changes.
 */
import type pg from 'pg';
import { queryOne } from '../../src/lib/db';
import { METRICS } from './calc/engine';

/** The KPI columns the calculation engine writes from raw data (source `computed`). */
export const RAW_SOURCED_KPIS: ReadonlySet<string> = new Set(
  Object.values(METRICS).map((m) => m.kpi).filter((k): k is string => !!k));

export const LIVE_MANUAL_MESSAGE =
  'Manual entry is off for this company: its metrics are calculated from the raw data the QE Navigator Exporter sends.';

/** SQL (scalar): the company of the users row `alias` is in live operation. */
export const liveDataOnlySql = (alias = 'u') =>
  `(SELECT COALESCE((c.settings->>'liveDataOnly')::boolean, false) FROM companies c WHERE c.id = ${alias}.company_id)`;

export async function isLiveDataOnly(companyId: string | null | undefined, client?: pg.PoolClient): Promise<boolean> {
  if (!companyId) return false;
  const sql = `SELECT COALESCE((settings->>'liveDataOnly')::boolean, false) AS live FROM companies WHERE id = `;
  if (client) return !!(await client.query(`${sql}$1`, [companyId])).rows[0]?.live;
  return !!(await queryOne<any>(`${sql}?`, [companyId]))?.live;
}

/** The problems of a finished-value write in a live company: one line per KPI QE Navigator calculates itself. */
export function liveKpiProblems(columns: string[]): string[] {
  return columns.filter((c) => RAW_SOURCED_KPIS.has(c)).map((c) =>
    `${c} is calculated by QE Navigator from raw data for this company and cannot be supplied as a finished value`);
}
