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
 * Pure: inputs in, metric values and evidence out (no database, no environment). The server reads the rows
 * (server/lib/calc/delivery.ts, loadDeliveryData); the QE Navigator Collector reads its local copy.
 */
import type { ComputedMetric, MetricSpec } from './types';
import { isOutage, type Severity } from '../parsers/deliveryEvents';

export const WINDOW_DAYS = 28;
export const MIN_PERIOD_DAYS = 7;
/** A production deploy followed by a hotfix of the same service within this many hours is a failed change (the server can override it). */
export const DEFAULT_CHANGE_FAILURE_WINDOW_HOURS = 72;
const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface DeliveryOptions { changeFailureWindowHours?: number }

/** The delivery metric specs; the change-failure formula names the hotfix window. */
export const deliveryMetrics = (CHANGE_FAILURE_WINDOW_HOURS = DEFAULT_CHANGE_FAILURE_WINDOW_HOURS): Record<string, MetricSpec> => ({
  deployment_frequency: { key: 'deployment_frequency', label: 'Deployment frequency', unit: '/week', kpi: 'deployment_frequency_per_week', group: 'delivery',
    formula: 'production deploys ÷ weeks in the period (the 28 days ending the day, from the first production deploy when later; at least 7 days); rollback deploys and deploys that did not complete are not counted' },
  lead_time: { key: 'lead_time', label: 'Lead time for changes', unit: 'days', kpi: 'lead_time_days', group: 'delivery',
    formula: 'median over the period’s production deploys of (deploy finished − first commit authored), in days; deploys without commit times are left out' },
  change_failure_rate: { key: 'change_failure_rate', label: 'Change failure rate', unit: '%', kpi: 'change_failure_rate', group: 'delivery',
    formula: `production deploys that were rolled back, followed within ${CHANGE_FAILURE_WINDOW_HOURS} h by a hotfix deploy of the same service, or linked to an incident ÷ production deploys × 100 (period)` },
  mttr: { key: 'mttr', label: 'Mean time to recovery', unit: 'h', kpi: 'mttr_hours', group: 'delivery',
    formula: 'median (resolved − opened) of the incidents resolved in the 28 days ending the day, in hours' },
  mtbf: { key: 'mtbf', label: 'Mean time between failures', unit: 'h', kpi: 'mtbf_hours', group: 'delivery',
    formula: 'mean time between the starts of consecutive incidents of the same service, for the incidents opened in the 28 days ending the day (the last earlier incident of the service counts as the previous start), in hours' },
  availability: { key: 'availability', label: 'System availability', unit: '%', kpi: 'system_availability', group: 'delivery',
    formula: '(1 − outage time ÷ time in the period) × 100; outages are incidents marked as outage, or of severity critical or high unless marked otherwise; overlapping outages count once, open ones until now' },
  incidents_per_deploy: { key: 'incidents_per_deploy', label: 'Incidents per deploy', unit: 'per deploy', kpi: null, group: 'delivery',
    formula: 'incidents opened in the period ÷ production deploys in the period' },
  infrastructure_failures: { key: 'infrastructure_failures', label: 'Infrastructure failures', unit: 'incidents', kpi: 'infrastructure_failures', group: 'delivery',
    formula: 'incidents of category “infrastructure” opened in the 28 days ending the day (computed when the team’s incidents carry a category)' },
});

export const DELIVERY_METRICS = deliveryMetrics();

export interface DeployRow {
  id: string;
  externalId: string;
  service: string | null;
  environment: string;
  result: 'success' | 'failure' | 'rolled_back';
  rollbackOf: string | null;
  hotfix: boolean;
  startedAt: number | null;
  finishedAt: number;
  firstAuthoredAt: number | null;
  commitCount: number;
  commit: string;
  url: string | null;
}

export interface IncidentRow {
  id: string;
  externalId: string;
  title: string | null;
  service: string | null;
  severity: Severity;
  outage: boolean | null;
  category: string | null;
  openedAt: number;
  acknowledgedAt: number | null;
  resolvedAt: number | null;
  deployment: string | null;
  url: string | null;
}

export interface DeliveryData {
  deploys: DeployRow[];
  incidents: IncidentRow[];
  firstDeployAt: number | null;
  firstIncidentAt: number | null;
  hasCategories: boolean;
}

export interface FailureReason { type: 'rolled_back' | 'rollback' | 'hotfix' | 'incident'; ref: string | null; at: number }

/** A deploy that reached production and is not itself a rollback. */
export const isCountedDeploy = (d: DeployRow) => d.result !== 'failure' && !d.rollbackOf;

/** The failed changes among the production deploys, as of `asOf` (signals after it are not known yet). */
export function classifyFailedChanges(deploys: DeployRow[], incidents: IncidentRow[], asOf: number, windowHours = DEFAULT_CHANGE_FAILURE_WINDOW_HOURS): Map<string, FailureReason[]> {
  const out = new Map<string, FailureReason[]>();
  const add = (id: string, r: FailureReason) => { const l = out.get(id) ?? []; l.push(r); out.set(id, l); };
  const visible = deploys.filter((d) => d.finishedAt <= asOf).sort((a, b) => a.finishedAt - b.finishedAt);
  const counted = visible.filter(isCountedDeploy);
  const byExt = new Map(counted.map((d) => [d.externalId, d]));
  for (const d of counted) if (d.result === 'rolled_back') add(d.id, { type: 'rolled_back', ref: null, at: d.finishedAt });
  for (const r of visible) {
    if (!r.rollbackOf) continue;
    const target = byExt.get(r.rollbackOf);
    if (target && target.id !== r.id) add(target.id, { type: 'rollback', ref: r.externalId, at: r.finishedAt });
  }
  for (let i = 0; i < counted.length; i++) {
    const h = counted[i];
    if (!h.hotfix) continue;
    for (let j = i - 1; j >= 0; j--) {
      const p = counted[j];
      if ((p.service ?? null) !== (h.service ?? null)) continue;
      if (p.finishedAt < h.finishedAt && h.finishedAt - p.finishedAt <= windowHours * HOUR) add(p.id, { type: 'hotfix', ref: h.externalId, at: h.finishedAt });
      break;
    }
  }
  for (const inc of incidents) {
    if (!inc.deployment || inc.openedAt > asOf) continue;
    const target = byExt.get(inc.deployment);
    if (target) add(target.id, { type: 'incident', ref: inc.externalId, at: inc.openedAt });
  }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const startOfDay = (ms: number) => Math.floor(ms / DAY) * DAY;

export function medianOf(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Length of the union of the intervals (ms), each clipped to [from, to]. */
export function unionLength(intervals: Array<[number, number]>, from: number, to: number): number {
  const xs = intervals.map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const x of xs) {
    if (!cur || x[0] > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [x[0], x[1]]; } else cur[1] = Math.max(cur[1], x[1]);
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

/** The delivery metrics of one day (UTC, YYYY-MM-DD), as of the end of the day (or now, for today). Pure. */
export function computeDeliveryDay(day: string, data: DeliveryData, now = Date.now(), opts: DeliveryOptions = {}): ComputedMetric[] {
  const CHANGE_FAILURE_WINDOW_HOURS = opts.changeFailureWindowHours ?? DEFAULT_CHANGE_FAILURE_WINDOW_HOURS;
  const dayStart = Date.parse(`${day}T00:00:00Z`);
  const dayEnd = dayStart + DAY - 1;
  const asOf = Math.min(dayEnd, now);
  if (asOf < dayStart) return [];
  const windowStart = dayStart - (WINDOW_DAYS - 1) * DAY;
  const periodStart = (first: number) => Math.min(Math.max(windowStart, startOfDay(first)), dayStart - (MIN_PERIOD_DAYS - 1) * DAY);
  const out: ComputedMetric[] = [];
  let latest = 0;
  const seen = (t: number) => { if (t <= asOf && t > latest) latest = t; };
  const recordedAt = () => new Date(Math.max(dayStart, latest)).toISOString();
  const push = (m: Omit<ComputedMetric, 'recordedAt'>) => out.push({ ...m, recordedAt: '' });

  let counted: DeployRow[] = [];
  let pStart = 0;
  let periodDays = 0;
  const firstData = Math.min(data.firstDeployAt ?? Infinity, data.firstIncidentAt ?? Infinity);
  if (data.firstDeployAt !== null && data.firstDeployAt <= asOf) {
    pStart = periodStart(data.firstDeployAt);
    periodDays = Math.round((dayStart - pStart) / DAY) + 1;
    const inPeriod = data.deploys.filter((d) => d.finishedAt >= pStart && d.finishedAt <= asOf);
    counted = inPeriod.filter(isCountedDeploy).sort((a, b) => a.finishedAt - b.finishedAt);
    inPeriod.forEach((d) => seen(d.finishedAt));
    const weeks = periodDays / 7;
    const ids = counted.slice(-50).map((d) => d.id);
    push({
      key: 'deployment_frequency', value: r2(counted.length / weeks),
      inputs: { productionDeploys: counted.length, periodDays, weeks: r2(weeks), notCompleted: inPeriod.filter((d) => d.result === 'failure').length, rollbackDeploys: inPeriod.filter((d) => d.rollbackOf).length },
      sources: { deployments: ids }, sampleSize: counted.length,
    });
    const leads = counted.filter((d) => d.firstAuthoredAt !== null && d.firstAuthoredAt <= d.finishedAt);
    if (leads.length) {
      const med = medianOf(leads.map((d) => (d.finishedAt - d.firstAuthoredAt!) / DAY))!;
      push({
        key: 'lead_time', value: r2(med),
        inputs: { deploysWithCommits: leads.length, deploysWithoutCommitTimes: counted.length - leads.length, medianHours: r2(med * 24), commits: leads.reduce((n, d) => n + d.commitCount, 0) },
        sources: { deployments: leads.slice(-50).map((d) => d.id) }, sampleSize: leads.length,
      });
    }
    if (counted.length) {
      const failures = classifyFailedChanges(data.deploys, data.incidents, asOf, CHANGE_FAILURE_WINDOW_HOURS);
      const failed = counted.filter((d) => failures.has(d.id));
      const by = (t: FailureReason['type']) => failed.filter((d) => failures.get(d.id)!.some((r) => r.type === t)).length;
      for (const d of failed) for (const r of failures.get(d.id)!) seen(r.at);
      push({
        key: 'change_failure_rate', value: r2((failed.length / counted.length) * 100),
        inputs: { failedChanges: failed.length, productionDeploys: counted.length, rolledBack: by('rolled_back') + by('rollback'), followedByHotfix: by('hotfix'), linkedIncident: by('incident'), hotfixWindowHours: CHANGE_FAILURE_WINDOW_HOURS },
        sources: { deployments: ids, failedDeployments: failed.slice(-50).map((d) => ({ id: d.id, externalId: d.externalId, reasons: failures.get(d.id)!.map((r) => ({ type: r.type, ref: r.ref, at: new Date(r.at).toISOString() })) })) },
        sampleSize: counted.length,
      });
    }
  }

  if (data.firstIncidentAt !== null && data.firstIncidentAt <= asOf) {
    const visible = data.incidents.filter((i) => i.openedAt <= asOf);
    const resolved = visible.filter((i) => i.resolvedAt !== null && i.resolvedAt >= windowStart && i.resolvedAt <= asOf);
    resolved.forEach((i) => seen(i.resolvedAt!));
    if (resolved.length) {
      const hours = resolved.map((i) => (i.resolvedAt! - i.openedAt) / HOUR);
      push({
        key: 'mttr', value: r2(medianOf(hours)!),
        inputs: { incidentsResolved: resolved.length, shortestHours: r2(Math.min(...hours)), longestHours: r2(Math.max(...hours)) },
        sources: { incidents: resolved.slice(-50).map((i) => i.id) }, sampleSize: resolved.length,
      });
    }
    const aStart = periodStart(firstData);
    const aDays = Math.round((dayStart - aStart) / DAY) + 1;
    const outages = visible.filter((i) => isOutage(i.severity, i.outage) && (i.resolvedAt === null || i.resolvedAt > aStart));
    const down = unionLength(outages.map((i) => [i.openedAt, i.resolvedAt === null || i.resolvedAt > asOf ? asOf : i.resolvedAt] as [number, number]), aStart, asOf + 1);
    const span = asOf + 1 - aStart;
    outages.forEach((i) => seen(i.openedAt));
    push({
      key: 'availability', value: r3((1 - down / span) * 100),
      inputs: { outageHours: r2(down / HOUR), periodHours: r2(span / HOUR), periodDays: aDays, outages: outages.length, openOutages: outages.filter((i) => i.resolvedAt === null || i.resolvedAt > asOf).length },
      sources: { incidents: outages.slice(-50).map((i) => i.id) }, sampleSize: visible.filter((i) => i.openedAt >= aStart).length,
    });
    const recent = visible.filter((i) => i.openedAt >= windowStart).sort((a, b) => a.openedAt - b.openedAt);
    recent.forEach((i) => seen(i.openedAt));
    const gaps: number[] = [];
    for (const inc of recent) {
      const prev = visible.filter((p) => p.id !== inc.id && (p.service ?? null) === (inc.service ?? null) && p.openedAt < inc.openedAt)
        .reduce<IncidentRow | null>((m, p) => (!m || p.openedAt > m.openedAt ? p : m), null);
      if (prev) gaps.push((inc.openedAt - prev.openedAt) / HOUR);
    }
    if (gaps.length) {
      push({
        key: 'mtbf', value: r2(gaps.reduce((a, b) => a + b, 0) / gaps.length),
        inputs: { intervals: gaps.length, incidents: recent.length, services: new Set(recent.map((i) => i.service ?? '')).size },
        sources: { incidents: recent.slice(-50).map((i) => i.id) }, sampleSize: gaps.length,
      });
    }
    if (counted.length) {
      const opened = visible.filter((i) => i.openedAt >= pStart);
      push({
        key: 'incidents_per_deploy', value: r2(opened.length / counted.length),
        inputs: { incidents: opened.length, productionDeploys: counted.length, periodDays },
        sources: { incidents: opened.slice(-50).map((i) => i.id), deployments: counted.slice(-50).map((d) => d.id) }, sampleSize: counted.length,
      });
    }
    if (data.hasCategories) {
      const infra = recent.filter((i) => i.category === 'infrastructure');
      push({
        key: 'infrastructure_failures', value: infra.length,
        inputs: { infrastructureIncidents: infra.length, incidents: recent.length, windowDays: WINDOW_DAYS },
        sources: { incidents: infra.slice(-50).map((i) => i.id) }, sampleSize: recent.length,
      });
    }
  }
  const at = recordedAt();
  return out.map((m) => ({ ...m, recordedAt: at }));
}

/** The days whose delivery values depend on events of the given days: each day and the WINDOW_DAYS − 1 after it (up to today). */
export function deliveryAffectedDays(eventDays: string[], today = new Date().toISOString().slice(0, 10)): string[] {
  const valid = eventDays.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today).sort();
  if (!valid.length) return [];
  const set = new Set<string>();
  for (const d of valid) {
    const start = Date.parse(`${d}T00:00:00Z`);
    for (let i = 0; i < WINDOW_DAYS; i++) {
      const x = new Date(start + i * DAY).toISOString().slice(0, 10);
      if (x > today) break;
      set.add(x);
    }
  }
  return Array.from(set).sort();
}
