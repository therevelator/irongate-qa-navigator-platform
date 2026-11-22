/**
 * Calculation inside your network: the shared engine (packages/engine, the code QE Navigator runs) over the
 * local copy of the records, per team and UTC day, with the same selection of records per day as QE
 * Navigator's loaders. The engine version is recorded with every value sent.
 */
import {
  ENGINE_VERSION, METRICS, ciData, ciEvidence, computeCiDay, computeDeliveryDay, computeQualityDay, computeWorkDay, deliveryData, qualityData, workData,
  type CiEvidence, type ComputedMetric,
} from '../../packages/engine/src/index';
import type { TeamRecords } from './store';

export { ENGINE_VERSION, METRICS };

export interface TeamDay { day: string; metrics: ComputedMetric[] }

const DAY = 86_400_000;
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The days from `from` to `to` (YYYY-MM-DD, inclusive). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) out.push(dayOf(t));
  return out;
}

/** Every metric of a team for each day (as of the end of the day, or now for today). */
export function calculate(r: TeamRecords, days: string[], mainBranch: string | null, now = Date.now()): TeamDay[] {
  return days.map((d) => ({
    day: d,
    metrics: [
      ...computeCiDay(d, ciData(r.testRuns, r.coverage, r.pipelines, mainBranch, d, d)),
      ...computeDeliveryDay(d, deliveryData(r.deployments, r.commits, r.incidents, d, d), now),
      ...computeWorkDay(d, workData(r.sprints, r.issues, r.coverage, mainBranch, d, d), now),
      ...computeQualityDay(d, qualityData(r.analyses, r.coverage, mainBranch, d, d), now),
    ],
  }));
}

/** The evidence lists of a team as of a day (flaky tests, lowest-coverage files, slowest and failing stages). */
export function teamEvidence(r: TeamRecords, day: string, mainBranch: string | null): CiEvidence {
  return ciEvidence(day, ciData(r.testRuns, r.coverage, r.pipelines, mainBranch, day, day, 29));
}
