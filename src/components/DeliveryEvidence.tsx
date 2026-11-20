import React, { useCallback, useEffect, useState } from 'react';
import { AlertOctagon, GitCommitHorizontal, Rocket, Undo2 } from 'lucide-react';
import API_URL from '../config/api';
import { formatAsOf } from '../data/advancedFeatures';
import { Badge, Card, CardHeader, cx } from './ui';
import type { Tone } from './ui';

/**
 * Deliveries & incidents (v2 phase 2) in the team page's Evidence section: the DORA values QE
 * Navigator calculated from the team's raw deployment, commit and incident events (each opens "How
 * this was calculated"), the recent production deploys with their commit count, lead time and
 * result, the failed changes with what made them failed, and the incidents with their duration and
 * linked deploy. Data: GET /api/ci/teams/:id/delivery (analytics scope).
 */

export type FailureType = 'rolled_back' | 'rollback' | 'hotfix' | 'incident';
export interface DeliveryDeploy {
  id: string; deploymentId: string; service: string | null; environment: string; commit: string; startedAt: string | null; finishedAt: string;
  result: 'success' | 'failure' | 'rolled_back'; hotfix: boolean; rollbackOf: string | null; counted: boolean; commitCount: number; leadTimeHours: number | null;
  url: string | null; failedBecause: Array<{ type: FailureType; ref: string | null; at: string }>;
}
export interface DeliveryIncident {
  id: string; incidentId: string; title: string | null; severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; service: string | null; outage: boolean; category: string | null;
  status: 'open' | 'acknowledged' | 'resolved'; openedAt: string; acknowledgedAt: string | null; resolvedAt: string | null; durationHours: number;
  deployment: { deploymentId: string; id: string | null; finishedAt: string | null; service: string | null } | null; url: string | null;
}
export interface Delivery {
  teamId: string;
  sample: boolean;
  lastReceived: Record<'deployments' | 'commits' | 'incidents', { at: string | null; uploads: number; sample: boolean }>;
  metrics: Array<{ key: string; label: string; day: string; value: number; unit: string | null; sampleSize: number; confidence: 'high' | 'medium' | 'low' }>;
  deployments: DeliveryDeploy[];
  notCounted: DeliveryDeploy[];
  failedChanges: DeliveryDeploy[];
  incidents: DeliveryIncident[];
  totals: { productionDeploys: number; failedChanges: number; incidents: number; openIncidents: number; days: number };
}

/** The DORA tiles, in this order. */
export const DELIVERY_KEYS = ['deployment_frequency', 'lead_time', 'change_failure_rate', 'mttr', 'availability', 'mtbf', 'incidents_per_deploy', 'infrastructure_failures'];

const hours = (h: number) => (h >= 48 ? `${(h / 24).toFixed(1)} days` : h >= 1 ? `${h.toFixed(1)} h` : `${Math.max(1, Math.round(h * 60))} min`);

export function fmtDelivery(key: string, v: number, unit: string | null): string {
  if (unit === '/week') return `${v.toFixed(1)} per week`;
  if (unit === 'days') return hours(v * 24);
  if (unit === 'h') return hours(v);
  if (unit === '%') return `${v.toFixed(key === 'availability' ? 2 : 1)} %`;
  if (unit === 'per deploy') return v.toFixed(2);
  if (unit === 'incidents') return `${Math.round(v)}`;
  return `${v}${unit ? ` ${unit}` : ''}`;
}

const short = (sha?: string | null) => (sha ? sha.slice(0, 8) : '—');

export const SEVERITY: Record<string, { label: string; tone: Tone }> = {
  critical: { label: 'Critical', tone: 'bad' },
  high: { label: 'High', tone: 'bad' },
  medium: { label: 'Medium', tone: 'warn' },
  low: { label: 'Low', tone: 'neutral' },
  info: { label: 'Info', tone: 'neutral' },
};

/** "Rolled back", "Hotfix rel-12 followed 3.2 h later", "Incident INC-7 linked to it". */
export function failureText(r: { type: FailureType; ref: string | null; at: string }, deployFinishedAt?: string | null): string {
  if (r.type === 'rolled_back') return 'Rolled back (deploy result)';
  if (r.type === 'rollback') return `Rolled back by deploy ${r.ref}`;
  if (r.type === 'hotfix') {
    const gap = deployFinishedAt ? (new Date(r.at).getTime() - new Date(deployFinishedAt).getTime()) / 3_600_000 : null;
    return `Hotfix ${r.ref} followed${gap !== null && gap >= 0 ? ` ${hours(gap)} later` : ''}`;
  }
  return `Incident ${r.ref} linked to it`;
}

export function useTeamDelivery(teamId: string) {
  const [data, setData] = useState<Delivery | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await fetch(`${API_URL}/ci/teams/${encodeURIComponent(teamId)}/delivery`, { credentials: 'include' });
      if (r.status === 403) { setState('forbidden'); setData(null); return; }
      if (!r.ok) throw new Error();
      setData(await r.json());
      setState('ready');
    } catch {
      setState('error');
    }
  }, [teamId]);
  useEffect(() => { load(); }, [load]);
  return { data, state, reload: load };
}

export const hasDeliveryData = (d: Delivery | null | undefined) =>
  !!d && (d.metrics.length > 0 || d.deployments.length > 0 || d.incidents.length > 0 || d.notCounted.length > 0);

const resultBadge = (d: DeliveryDeploy) => {
  if (d.failedBecause.length) return <Badge tone="bad">Failed change</Badge>;
  if (d.result === 'rolled_back') return <Badge tone="bad">Rolled back</Badge>;
  if (d.result === 'failure') return <Badge tone="warn">Did not complete</Badge>;
  if (d.rollbackOf) return <Badge tone="neutral">Rollback</Badge>;
  return <Badge tone="good">Succeeded</Badge>;
};

const DeployRef: React.FC<{ d: DeliveryDeploy }> = ({ d }) => (
  d.url && /^https?:\/\//.test(d.url)
    ? <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-mono text-brand-700 hover:underline dark:text-brand-300">{d.deploymentId}</a>
    : <span className="font-mono">{d.deploymentId}</span>
);

export const DeliveryEvidenceSection: React.FC<{ delivery: ReturnType<typeof useTeamDelivery>; onExplain: (metric: string) => void; canConnect?: boolean }> = ({ delivery, onExplain, canConnect }) => {
  const { data, state } = delivery;
  const [allDeploys, setAllDeploys] = useState(false);
  if (state === 'forbidden') return null;
  const tiles = data ? DELIVERY_KEYS.map((k) => data.metrics.find((m) => m.key === k)).filter((m): m is Delivery['metrics'][number] => !!m) : [];
  const deploys = data?.deployments ?? [];
  const shown = allDeploys ? deploys : deploys.slice(0, 8);
  const last = data?.lastReceived;
  return (
    <section aria-labelledby="delivery-evidence-title" data-testid="delivery-evidence" className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h4 id="delivery-evidence-title" className="text-sm font-semibold text-slate-900 dark:text-white">Deliveries &amp; incidents</h4>
        {last && hasDeliveryData(data) && (
          <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="delivery-last-received">
            Last data received — {(['deployments', 'commits', 'incidents'] as const).map((k) => `${k[0].toUpperCase()}${k.slice(1)}: ${last[k].at ? formatAsOf(last[k].at) : 'none yet'}`).join(' · ')}
          </p>
        )}
      </div>
      {state === 'loading' && !data ? (
        <Card><p className="text-sm text-slate-500 dark:text-slate-400">Loading deliveries and incidents…</p></Card>
      ) : state === 'error' ? (
        <Card><p className="text-sm text-red-700 dark:text-red-400">Deliveries and incidents could not be loaded.</p></Card>
      ) : !hasDeliveryData(data) ? (
        <Card>
          <p className="text-sm font-medium text-slate-900 dark:text-white">No deployments or incidents for this team yet</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400" data-testid="delivery-empty">
            {canConnect
              ? 'Send deployment events from your CI/CD and incidents from PagerDuty, Opsgenie or your own tool; QE Navigator calculates deployment frequency, lead time, change failure rate, MTTR and availability. Set it up in Admin console → Connect your CI.'
              : 'When the team’s pipelines send deployments and its incident tool sends incidents, the calculated delivery metrics and their evidence appear here.'}
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title="Delivery and reliability (DORA)"
              subtitle={`Calculated by QE Navigator from the raw deployment, commit and incident events over the last 28 days${data!.sample ? ' (sample data: shown as evidence, not written to the team’s KPIs)' : ''}; open one to see the formula and the deploys or incidents it counts.`}
            />
            {tiles.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="delivery-not-calculated">The events are stored; the values appear after the next calculation.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="delivery-metrics">
                {tiles.map((m) => (
                  <li key={m.key}>
                    <button
                      type="button"
                      onClick={() => onExplain(m.key)}
                      className="flex w-full flex-col items-start rounded-md border border-slate-200 px-3 py-2 text-left hover:border-brand-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-800 dark:hover:bg-slate-800/60"
                      data-testid={`delivery-metric-${m.key}`}
                      aria-label={`${m.label}: ${fmtDelivery(m.key, m.value, m.unit)}. How this was calculated`}
                    >
                      <span className="text-xs text-slate-500 dark:text-slate-400">{m.label}</span>
                      <span className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">{fmtDelivery(m.key, m.value, m.unit)}</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">{formatAsOf(m.day)} · {m.sampleSize} {['mttr', 'availability', 'mtbf', 'infrastructure_failures'].includes(m.key) ? (m.key === 'mtbf' ? 'interval' : 'incident') : 'deploy'}{m.sampleSize === 1 ? '' : 's'} · {m.confidence} confidence</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Recent production deploys"
              subtitle={`${data!.totals.productionDeploys} in the last ${data!.totals.days} days${data!.notCounted.length ? ` · ${data!.notCounted.length} more did not complete or were rollbacks (not counted)` : ''}. Lead time: from the first commit authored to the deploy finished.`}
              action={<Rocket size={16} className="text-slate-400" aria-hidden="true" />}
            />
            {deploys.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No production deploys in the last {data!.totals.days} days.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm" data-testid="delivery-deploys">
                    <caption className="sr-only">Recent production deploys with their commits, lead time and result</caption>
                    <thead><tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                      <th scope="col" className="pb-1 pr-2 font-medium">Deploy</th><th scope="col" className="pb-1 pr-2 font-medium">Finished</th>
                      <th scope="col" className="pb-1 pr-2 text-right font-medium">Commits</th><th scope="col" className="pb-1 pr-2 text-right font-medium">Lead time</th>
                      <th scope="col" className="pb-1 text-right font-medium">Result</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {shown.map((d) => (
                        <tr key={d.id} data-testid="delivery-deploy">
                          <td className="py-1.5 pr-2 text-xs text-slate-800 dark:text-slate-200">
                            <DeployRef d={d} />{d.hotfix && <span className="ml-1.5"><Badge tone="warn">Hotfix</Badge></span>}
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400">{d.service ?? d.environment} · commit <span className="font-mono">{short(d.commit)}</span></span>
                          </td>
                          <td className="py-1.5 pr-2 text-xs text-slate-600 dark:text-slate-300">{formatAsOf(d.finishedAt)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-xs text-slate-700 dark:text-slate-300">{d.commitCount}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-xs text-slate-700 dark:text-slate-300">{d.leadTimeHours === null ? <span className="text-slate-500 dark:text-slate-400" title="No commit times were sent for this deploy">—</span> : hours(d.leadTimeHours)}</td>
                          <td className="py-1.5 text-right">{resultBadge(d)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {deploys.length > 8 && (
                  <button type="button" onClick={() => setAllDeploys((v) => !v)} className="mt-2 rounded text-xs font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300" aria-expanded={allDeploys} data-testid="delivery-deploys-toggle">
                    {allDeploys ? 'Show fewer' : `Show all ${deploys.length}`}
                  </button>
                )}
              </>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Failed changes" subtitle="Production deploys that were rolled back, followed by a hotfix of the same service within 72 h, or linked to an incident (last 30 days)." action={<Undo2 size={16} className="text-slate-400" aria-hidden="true" />} />
              {data!.failedChanges.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No failed changes in the last {data!.totals.days} days.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="delivery-failed-changes">
                  {data!.failedChanges.map((d) => (
                    <li key={d.id} className="py-2.5" data-testid="delivery-failed-change">
                      <p className="text-sm font-medium text-slate-900 dark:text-white"><DeployRef d={d} /> <span className="font-normal text-slate-500 dark:text-slate-400">· {d.service ?? d.environment} · {formatAsOf(d.finishedAt)}</span></p>
                      <ul className="mt-1 space-y-0.5">
                        {d.failedBecause.map((r, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                            <span aria-hidden="true" className={cx('mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full', r.type === 'incident' ? 'bg-red-500' : r.type === 'hotfix' ? 'bg-amber-500' : 'bg-slate-500')} />
                            {failureText(r, d.finishedAt)}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Incidents" subtitle={`${data!.totals.incidents} opened in the last ${data!.totals.days} days${data!.totals.openIncidents ? ` · ${data!.totals.openIncidents} open now` : ''}; critical and high count as outages unless marked otherwise.`} action={<AlertOctagon size={16} className="text-slate-400" aria-hidden="true" />} />
              {data!.incidents.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No incidents in the last {data!.totals.days} days.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="delivery-incidents">
                  {data!.incidents.map((i) => (
                    <li key={i.id} className="py-2.5" data-testid="delivery-incident">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 break-words text-sm font-medium text-slate-900 dark:text-white">
                          {i.url && /^https?:\/\//.test(i.url) ? <a href={i.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{i.title ?? i.incidentId}</a> : (i.title ?? i.incidentId)}
                        </p>
                        <span className="flex shrink-0 gap-1">
                          {i.outage && <Badge tone="bad">Outage</Badge>}
                          <Badge tone={SEVERITY[i.severity]?.tone ?? 'neutral'}>{SEVERITY[i.severity]?.label ?? i.severity}</Badge>
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                        <span className="font-mono">{i.incidentId}</span>{i.service ? ` · ${i.service}` : ''} · opened {formatAsOf(i.openedAt)} · {i.status === 'resolved' ? `resolved after ${hours(i.durationHours)}` : `${i.status === 'acknowledged' ? 'acknowledged, ' : ''}open for ${hours(i.durationHours)}`}
                      </p>
                      {i.deployment && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400" data-testid="delivery-incident-deploy">
                          <GitCommitHorizontal size={12} aria-hidden="true" /> Linked deploy <span className="font-mono">{i.deployment.deploymentId}</span>{i.deployment.finishedAt ? ` (${formatAsOf(i.deployment.finishedAt)})` : ' (not received)'}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </section>
  );
};
