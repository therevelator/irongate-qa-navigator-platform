import { isProductionRuntime } from './runtimeEnv';
/**
 * Synthetic (randomly generated) data switch.
 *
 * Every generator that writes random/simulated values into the database
 * (KPI sync generators, pipeline seeder, daily analytics drift, productivity
 * snapshot seed, analytics seed) is OFF unless the process is started with
 *
 *   ENABLE_SYNTHETIC_DATA=true
 *
 * This keeps demo data out of environments where the numbers are shown to
 * people as real measurements.
 */
/**
 * "Load sample data" also creates the separate fictional sample company (shared users, known
 * password) only where demo accounts make sense: local development, or DEMO_MODE=true. In
 * production and on Netlify it only fills the caller's own company (no shared accounts).
 */
export function separateSampleCompanyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isProductionRuntime(env)) return env.DEMO_MODE === 'true';
  if (env.DEMO_MODE !== undefined && env.DEMO_MODE !== '') return env.DEMO_MODE === 'true' || env.DEMO_MODE === '1';
  return true;
}

export function isSyntheticDataEnabled(): boolean {
  return process.env.ENABLE_SYNTHETIC_DATA === 'true';
}

/** Logs (once per label) that a synthetic generator was skipped. */
const loggedSkips = new Set<string>();
export function logSyntheticSkip(label: string): void {
  if (loggedSkips.has(label)) return;
  loggedSkips.add(label);
  console.log(`[synthetic-data] ${label} skipped: set ENABLE_SYNTHETIC_DATA=true to enable generated sample data.`);
}
