/**
 * Calculation engine, phase 2: delivery and reliability (docs/V2_PLAN.md, "Calculation rules (phase 2)").
 *
 * From deployments_raw / deployment_commits / incidents_raw it computes, per team and UTC day D, over
 * the WINDOW_DAYS (28) days ending D, "as of" the end of D (an event counts from the moment it
 * happened, so a later rollback or incident changes the values from its own day on):
 *
 *   deployment_frequency → deployment_frequency_per_week   production deploys ÷ weeks in the period
 *   lead_time            → lead_time_days                  median (deploy finished − first commit authored)
 *   change_failure_rate  → change_failure_rate             failed changes ÷ production deploys × 100
 *   mttr                 → mttr_hours                      median (resolved − opened) of incidents resolved
 *   mtbf                 → mtbf_hours                      mean time between incident starts per service
 *   availability         → system_availability             (1 − outage time ÷ period) × 100
 *   incidents_per_deploy                                   incidents opened ÷ production deploys
 *   infrastructure_failures → infrastructure_failures      incidents of category "infrastructure"
 *
 * Production deploys = deploys to a production environment that reached it (result success or
 * rolled_back); rollback deploys (rollbackOf set) and deploys that failed to complete are not counted.
 * A production deploy is a failed change when it was rolled back (result rolled_back, or a rollback
 * deploy names it), when the next production deploy of the same service is a hotfix finished within
 * CHANGE_FAILURE_WINDOW_HOURS (72 h), or when an incident is linked to it.
 * The period starts at the team's first event when that is later than the window start (a new team
 * is not diluted by weeks without data), and is at least 7 days.
 *
 * The calculation itself is the shared engine's (packages/engine/src/calc/delivery.ts); this file reads the rows needed for a range of days in three queries (loadDeliveryData)
 * and applies the server's hotfix window (CHANGE_FAILURE_WINDOW_HOURS).
 */
import type pg from 'pg';
import type { ComputedMetric } from './engine';
import {
  classifyFailedChanges as classifyWith, computeDeliveryDay as computeWith, deliveryMetrics, DEFAULT_CHANGE_FAILURE_WINDOW_HOURS, WINDOW_DAYS,
  type DeliveryData, type DeployRow, type IncidentRow,
} from '../../../packages/engine/src/calc/delivery';

export {
  WINDOW_DAYS, MIN_PERIOD_DAYS, isCountedDeploy, medianOf, unionLength, deliveryAffectedDays,
  type DeployRow, type IncidentRow, type DeliveryData, type FailureReason,
} from '../../../packages/engine/src/calc/delivery';

export const CHANGE_FAILURE_WINDOW_HOURS = Number(process.env.CHANGE_FAILURE_WINDOW_HOURS) || DEFAULT_CHANGE_FAILURE_WINDOW_HOURS;
export const DELIVERY_METRICS = deliveryMetrics(CHANGE_FAILURE_WINDOW_HOURS);

/** The failed changes among the production deploys, as of `asOf` (the server's hotfix window). */
export const classifyFailedChanges = (deploys: DeployRow[], incidents: IncidentRow[], asOf: number, windowHours = CHANGE_FAILURE_WINDOW_HOURS) =>
  classifyWith(deploys, incidents, asOf, windowHours);

/** The delivery metrics of one day (the shared engine, with the server's hotfix window). */
export const computeDeliveryDay = (day: string, data: DeliveryData, now = Date.now()): ComputedMetric[] =>
  computeWith(day, data, now, { changeFailureWindowHours: CHANGE_FAILURE_WINDOW_HOURS });

const ms = (v: any): number | null => (v === null || v === undefined ? null : new Date(v).getTime());

/** Read the deploys and incidents that the days from `from` to `to` (inclusive) depend on. */
export async function loadDeliveryData(client: pg.PoolClient, teamId: string, from: string, to: string): Promise<DeliveryData> {
  const deploys = (await client.query(
    `SELECT d.id, d.external_id, d.service, d.environment, d.result, d.rollback_of, d.is_hotfix, d.started_at, d.finished_at, d.commit_sha, d.url,
            fc.first_authored,
            (SELECT COUNT(*) FROM (SELECT unnest(d.commit_shas) UNION SELECT c.sha FROM deployment_commits c
                                    WHERE c.team_id = d.team_id AND c.deployment_external_id = d.external_id) s)::int AS commit_count
       FROM deployments_raw d
       LEFT JOIN LATERAL (SELECT MIN(c.authored_at) AS first_authored FROM deployment_commits c
                           WHERE c.team_id = d.team_id AND (c.deployment_external_id = d.external_id OR c.sha = ANY(d.commit_shas))) fc ON TRUE
      WHERE d.team_id = $1 AND d.is_production AND d.finished_at >= $2::date - ${WINDOW_DAYS + 3} AND d.finished_at < $3::date + 1
      ORDER BY d.finished_at`, [teamId, from, to])).rows;
  const incidents = (await client.query(
    `SELECT id, external_id, title, service, severity, outage, category, opened_at, acknowledged_at, resolved_at, deployment_external_id, url
       FROM incidents_raw
      WHERE team_id = $1 AND opened_at < $3::date + 1 AND (opened_at >= $2::date - 150 OR resolved_at IS NULL OR resolved_at >= $2::date - ${WINDOW_DAYS + 3})
      ORDER BY opened_at`, [teamId, from, to])).rows;
  const firsts = (await client.query(
    `SELECT (SELECT MIN(finished_at) FROM deployments_raw WHERE team_id = $1 AND is_production) AS first_deploy,
            (SELECT MIN(opened_at) FROM incidents_raw WHERE team_id = $1) AS first_incident,
            EXISTS (SELECT 1 FROM incidents_raw WHERE team_id = $1 AND category IS NOT NULL) AS has_categories`, [teamId])).rows[0];
  return {
    deploys: deploys.map((d: any) => ({
      id: d.id, externalId: d.external_id, service: d.service, environment: d.environment, result: d.result, rollbackOf: d.rollback_of, hotfix: d.is_hotfix,
      startedAt: ms(d.started_at), finishedAt: ms(d.finished_at)!, firstAuthoredAt: ms(d.first_authored), commitCount: d.commit_count, commit: d.commit_sha, url: d.url,
    })),
    incidents: incidents.map((i: any) => ({
      id: i.id, externalId: i.external_id, title: i.title, service: i.service, severity: i.severity, outage: i.outage, category: i.category,
      openedAt: ms(i.opened_at)!, acknowledgedAt: ms(i.acknowledged_at), resolvedAt: ms(i.resolved_at), deployment: i.deployment_external_id, url: i.url,
    })),
    firstDeployAt: ms(firsts?.first_deploy), firstIncidentAt: ms(firsts?.first_incident), hasCategories: !!firsts?.has_categories,
  };
}

/** Delivery metrics of several days of a team (one read for all of them). */
export async function computeDeliveryDays(client: pg.PoolClient, teamId: string, days: string[], now = Date.now()): Promise<Map<string, ComputedMetric[]>> {
  const out = new Map<string, ComputedMetric[]>();
  if (!days.length) return out;
  const sorted = [...days].sort();
  const data = await loadDeliveryData(client, teamId, sorted[0], sorted[sorted.length - 1]);
  if (data.firstDeployAt === null && data.firstIncidentAt === null) return out;
  for (const d of sorted) out.set(d, computeDeliveryDay(d, data, now));
  return out;
}

