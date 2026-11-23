/**
 * Where each monthly Business impact value came from (value_sources, migration 20261207000000).
 *
 *   manual     typed in on the Business impact page (single month or bulk)
 *   synthetic  generated sample data (sample companies only)
 *   ingested   derived from the team's KPI values (quality side: public.refresh_business_quality_month) or
 *              calculated from the business data the Exporter sends (business side)
 *
 * Precedence: a typed-in value is never overwritten by an ingested one (the derivation skips it); a value typed in
 * over an ingested one replaces it and is recorded as manual. The row's data_source summarises its values:
 * 'ingested', 'manual', 'synthetic' or 'mixed'.
 */
import { query } from '../../src/lib/db';

export type BusinessImpactTable = 'business_impact_quality_metrics' | 'business_impact_business_kpis' | 'business_impact_context';
export type ValueSource = 'manual' | 'synthetic' | 'ingested';

/** Record the source of the values just written to a month (the columns that were sent, non-null). */
export async function markValueSources(table: BusinessImpactTable, teamId: string, month: string, values: Record<string, unknown>, source: ValueSource): Promise<void> {
  const cols = Object.entries(values).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k]) => k);
  if (!cols.length) return;
  const hasDataSource = table !== 'business_impact_context';
  await query(
    `UPDATE ${table} SET value_sources = value_sources || (SELECT jsonb_object_agg(k, ?::text) FROM unnest(?::text[]) k)
       ${hasDataSource ? `, data_source = CASE
           WHEN NOT EXISTS (SELECT 1 FROM jsonb_each_text(value_sources || (SELECT jsonb_object_agg(k, ?::text) FROM unnest(?::text[]) k)) s WHERE s.value <> ?) THEN ?
           ELSE 'mixed' END` : ''}
      WHERE team_id = ? AND month_year = ?`,
    hasDataSource ? [source, cols, source, cols, source, source, teamId, month] : [source, cols, teamId, month]
  );
}
