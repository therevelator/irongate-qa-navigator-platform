/**
 * Calculate the forecasts and recommendations (v2 phase 4) of every active team of a company now,
 * instead of waiting for the hourly job (alerts-evaluate recalculates the teams that are due) or the
 * first visit of each team page.
 *
 *   DATABASE_URL=… npx tsx scripts/reseed/improve-refresh.ts --company mft-meridian
 *
 * Reads the stored KPI history and CI evidence; writes only the tables forecasts and recommendations
 * (decisions already taken on recommendations are kept). Safe to run again at any time.
 */
import { query } from '../../src/lib/db';
import { refreshTeamImprove } from '../../server/lib/recommendations/store';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

(async () => {
  const company = arg('company');
  if (!company) throw new Error('--company <id> is required');
  const teams = await query<any[]>(`SELECT id, company_id, department_id, name FROM teams WHERE company_id = ? AND is_active ORDER BY name`, [company]);
  for (const t of teams) {
    const r = await refreshTeamImprove({ id: String(t.id), company_id: String(t.company_id), department_id: t.department_id ? String(t.department_id) : null, name: t.name });
    console.log(`${t.name}: ${r.forecasts} forecasts, ${r.recommendations} recommendations (${r.ms} ms)`);
  }
  process.exit(0);
})().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
