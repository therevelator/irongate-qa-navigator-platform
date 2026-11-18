/**
 * Financial and ROI settings of a team (Parameters → Financial and ROI settings), with the same
 * inheritance as every other config reader (team, then department, then company;
 * server/lib/configResolver.ts). Keys with no configured value keep the built-in default
 * (FINANCIAL_DEFAULTS, server/lib/metricFormulas.ts) and are listed in `defaultsUsed`.
 * Read by the Technical debt page and the revenue impact analysis.
 */
import { resolveConfigs } from './configResolver';
import { FINANCIAL_DEFAULTS, toNum, type FinancialConfig, type FinancialKey } from './metricFormulas';

export async function getFinancialConfig(companyId: string, teamId?: string): Promise<{ config: FinancialConfig; defaultsUsed: FinancialKey[] }> {
  const config: FinancialConfig = { ...FINANCIAL_DEFAULTS };
  const configured = new Set<string>();
  try {
    const resolved = await resolveConfigs(companyId, { teamId });
    for (const [key, cfg] of Object.entries(resolved)) {
      const value = toNum((cfg as { value?: unknown }).value as string | number | null | undefined);
      if (Object.prototype.hasOwnProperty.call(FINANCIAL_DEFAULTS, key) && value !== null) {
        config[key as FinancialKey] = value;
        configured.add(key);
      }
    }
  } catch (e) {
    console.error('Error loading financial config, using defaults:', e);
  }
  return { config, defaultsUsed: (Object.keys(FINANCIAL_DEFAULTS) as FinancialKey[]).filter(k => !configured.has(k)) };
}
