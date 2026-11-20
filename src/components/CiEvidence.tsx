import React, { useCallback, useEffect, useState } from 'react';
import { Calculator, FlaskConical, FileCode2, Timer, Workflow } from 'lucide-react';
import API_URL from '../config/api';
import { formatAsOf } from '../data/advancedFeatures';
import Modal from './Modal';
import { DELIVERY_KEYS, DeliveryEvidenceSection, failureText, fmtDelivery, hasDeliveryData, SEVERITY, type useTeamDelivery } from './DeliveryEvidence';
import { WorkEvidenceSection, fmtWork, hasWorkData, PHASE3_KEYS, workNoun, type useTeamWork } from './WorkEvidence';
import { Badge, Card, CardHeader, EmptyState, cx } from './ui';
import type { Tone } from './ui';

/**
 * Evidence from CI (v2 phase 1) on the team page: the metrics QE Navigator calculated from the
 * team's raw test reports, coverage reports and pipeline runs, and the records behind them —
 * flaky tests with the runs that prove them, the lowest-coverage files, the slowest tests and the
 * failing pipeline stages. Every computed metric opens "How this was calculated" (HowCalculatedDialog).
 * Data: GET /api/ci/teams/:id/evidence (analytics scope).
 */

export interface EvidenceRun { id: string; runId?: string | null; attempt?: number; commit?: string; branch?: string | null; startedAt?: string }
export interface Evidence {
  teamId: string;
  lastReceived: Record<'tests' | 'coverage' | 'pipelines', { at: string | null; uploads: number; sample: boolean }>;
  metrics: Array<{ key: string; label: string; day: string; value: number; unit: string | null; sampleSize: number; confidence: 'high' | 'medium' | 'low' }>;
  flakyTests: Array<{ testKey: string; suite: string | null; name: string; commits: string[]; failureMessage: string | null; lastSeen: string; failedRunCount: number; passedRunCount: number; failedRuns: EvidenceRun[]; passedRuns: EvidenceRun[] }>;
  coverage: null | { reportId: string; commit: string; branch: string | null; format: string; createdAt: string; linesFound: number; linesHit: number; fileCount: number; lowestFiles: Array<{ path: string; linesFound: number; linesHit: number; coverage: number }> };
  slowestTests: Array<{ testKey: string; suite: string | null; name: string; runs: number; medianMs: number; maxMs: number }>;
  failingStages: Array<{ name: string; runs: number; failed: number; failureRate: number; medianSeconds: number | null; lastFailedRuns: Array<{ id: string; runId: string | null; url: string | null }> }>;
}

/** KPI column → the evidence metric behind it (server/lib/calc/engine.ts EVIDENCE_FOR_KPI). */
export const EVIDENCE_FOR_KPI: Record<string, string> = {
  test_coverage: 'line_coverage',
  first_time_pass_rate: 'first_time_pass_rate',
  test_flakiness_rate: 'test_flakiness_rate',
  test_execution_time_minutes: 'test_execution_time',
  avg_build_time_minutes: 'build_time',
  parallel_test_efficiency: 'parallel_test_efficiency',
  // v2 phase 2: delivery and reliability, from deployment, commit and incident events.
  deployment_frequency_per_week: 'deployment_frequency',
  lead_time_days: 'lead_time',
  change_failure_rate: 'change_failure_rate',
  mttr_hours: 'mttr',
  mtbf_hours: 'mtbf',
  system_availability: 'availability',
  infrastructure_failures: 'infrastructure_failures',
  // v2 phase 3: work (issues) and code quality (static analysis).
  defect_escape_rate: 'escape_rate',
  defect_density: 'defect_density',
  sprint_velocity: 'velocity',
  sprint_commitment_rate: 'commitment',
  sprint_carryover: 'carryover',
  blocked_time_hours: 'blocked_time',
  sizing_accuracy: 'sizing_accuracy',
  code_quality_score: 'code_quality',
};

export const CONFIDENCE_TEXT: Record<string, { label: string; tone: Tone; help: string }> = {
  high: { label: 'High confidence', tone: 'good', help: '10 or more runs' },
  medium: { label: 'Medium confidence', tone: 'warn', help: '3 to 9 runs' },
  low: { label: 'Low confidence', tone: 'neutral', help: 'fewer than 3 runs' },
};

const short = (sha?: string | null) => (sha ? sha.slice(0, 8) : '—');
const fmtMs = (ms: number) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const fmtCi = (v: number, unit: string | null) => (unit === 'tests' ? `${v}` : `${v.toFixed(unit === 'min' ? 2 : 1)}${unit === '%' ? ' %' : unit ? ` ${unit}` : ''}`);
const fmtValue = (v: number, unit: string | null, key?: string) => (key && DELIVERY_KEYS.includes(key) ? fmtDelivery(key, v, unit) : key && PHASE3_KEYS.includes(key) ? fmtWork(key, v, unit) : fmtCi(v, unit));
const covTone = (pct: number): Tone => (pct >= 80 ? 'good' : pct >= 50 ? 'warn' : 'bad');

/** Load the team's evidence once; shared by the section and the KPI cards' "How this was calculated" buttons. */
export function useTeamEvidence(teamId: string) {
  const [data, setData] = useState<Evidence | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await fetch(`${API_URL}/ci/teams/${encodeURIComponent(teamId)}/evidence`, { credentials: 'include' });
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

const RunChip: React.FC<{ run: EvidenceRun; tone: 'bad' | 'good' }> = ({ run, tone }) => (
  <span
    className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] ring-1 ring-inset',
      tone === 'bad' ? 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900' : 'bg-green-50 text-green-800 ring-green-200 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-900')}
    title={`Run ${run.runId ?? run.id}${run.attempt ? `, attempt ${run.attempt}` : ''}${run.commit ? `, commit ${run.commit}` : ''}${run.startedAt ? `, ${formatAsOf(run.startedAt)}` : ''}`}
  >
    {tone === 'bad' ? 'failed' : 'passed'} · run {run.runId ?? run.id.slice(0, 8)}{run.attempt && run.attempt > 1 ? ` #${run.attempt}` : ''}
  </span>
);

export const CiEvidenceSection: React.FC<{ teamId: string; evidence: ReturnType<typeof useTeamEvidence>; delivery?: ReturnType<typeof useTeamDelivery>; work?: ReturnType<typeof useTeamWork>; onExplain: (metric: string) => void; canConnect?: boolean }> = ({ evidence, delivery, work, onExplain, canConnect }) => {
  const { data, state } = evidence;
  if (state === 'forbidden') return null;
  const hasCi = !!data && (data.metrics.length > 0 || data.flakyTests.length > 0 || !!data.coverage || data.slowestTests.length > 0 || data.failingStages.length > 0);
  const hasDelivery = hasDeliveryData(delivery?.data);
  const hasWork = hasWorkData(work?.data);
  const hasAny = hasCi || hasDelivery || hasWork;
  const last = data?.lastReceived;
  const lastText = last
    ? (['tests', 'coverage', 'pipelines'] as const).map((k) => `${k === 'tests' ? 'Tests' : k === 'coverage' ? 'Coverage' : 'Pipelines'}: ${last[k].at ? formatAsOf(last[k].at) : 'none yet'}`).join(' · ')
    : null;
  return (
    <section aria-labelledby="ci-evidence-title" data-testid="ci-evidence">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h3 id="ci-evidence-title" className="text-sm font-semibold text-slate-900 dark:text-white">Evidence from CI</h3>
        {lastText && hasAny && <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="ci-last-received">Last data received — {lastText}</p>}
      </div>
      {state === 'loading' && !data ? (
        <Card><p className="text-sm text-slate-500 dark:text-slate-400">Loading the evidence…</p></Card>
      ) : state === 'error' ? (
        <Card><p className="text-sm text-red-700 dark:text-red-400">The evidence could not be loaded.</p></Card>
      ) : !hasAny ? (
        <Card>
          <EmptyState
            title="No CI data for this team yet"
            description={canConnect
              ? 'Send test reports, coverage reports, pipeline runs, deployments, incidents, issues and static-analysis reports from your tools and QE Navigator calculates the metrics and shows the evidence here. Set it up in Admin console → Connect your CI.'
              : 'When the team’s CI sends test reports, coverage reports, pipeline runs, deployments, incidents, issues and static-analysis reports, the calculated metrics and their evidence appear here.'}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {hasCi && data!.metrics.length > 0 && (
            <Card>
              <CardHeader title="Calculated from CI data" subtitle="Each value is calculated by QE Navigator from the raw reports; open one to see the formula, the values used and the source runs." />
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="ci-computed-metrics">
                {data!.metrics.map((m) => (
                  <li key={m.key}>
                    <button
                      type="button"
                      onClick={() => onExplain(m.key)}
                      className="flex w-full flex-col items-start rounded-md border border-slate-200 px-3 py-2 text-left hover:border-brand-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-800 dark:hover:bg-slate-800/60"
                      data-testid={`ci-metric-${m.key}`}
                      aria-label={`${m.label}: ${fmtValue(m.value, m.unit, m.key)}. How this was calculated`}
                    >
                      <span className="text-xs text-slate-500 dark:text-slate-400">{m.label}</span>
                      <span className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">{fmtValue(m.value, m.unit)}</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">{formatAsOf(m.day)} · {m.sampleSize} run{m.sampleSize === 1 ? '' : 's'} · {CONFIDENCE_TEXT[m.confidence]?.label.toLowerCase()}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {hasCi && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Flaky tests" subtitle="Failed and passed on the same commit within 7 days (last 30 days); the runs prove it." action={<FlaskConical size={16} className="text-slate-400" aria-hidden="true" />} />
              {data!.flakyTests.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No flaky tests found.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="ci-flaky-tests">
                  {data!.flakyTests.map((f) => (
                    <li key={f.testKey} className="py-2.5" data-testid="ci-flaky-test">
                      <p className="break-words text-sm font-medium text-slate-900 dark:text-white">{f.name}</p>
                      {f.suite && <p className="break-words text-xs text-slate-500 dark:text-slate-400">{f.suite}</p>}
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        Failed in {f.failedRunCount} run{f.failedRunCount === 1 ? '' : 's'}, passed in {f.passedRunCount} · commit{f.commits.length === 1 ? '' : 's'} <span className="font-mono">{f.commits.map(short).join(', ')}</span>
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {f.failedRuns.map((r) => <RunChip key={`f${r.id}`} run={r} tone="bad" />)}
                        {f.passedRuns.map((r) => <RunChip key={`p${r.id}`} run={r} tone="good" />)}
                      </div>
                      {f.failureMessage && <p className="mt-1 line-clamp-2 break-words font-mono text-[11px] text-slate-500 dark:text-slate-400">{f.failureMessage}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader
                title="Lowest-coverage files"
                subtitle={data!.coverage ? `Latest report: commit ${short(data!.coverage.commit)}${data!.coverage.branch ? ` on ${data!.coverage.branch}` : ''} (${data!.coverage.format}, ${data!.coverage.fileCount} files), ${formatAsOf(data!.coverage.createdAt)}` : 'From the latest coverage report.'}
                action={<FileCode2 size={16} className="text-slate-400" aria-hidden="true" />}
              />
              {!data!.coverage || data!.coverage.lowestFiles.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No coverage report yet.</p>
              ) : (
                <table className="w-full table-fixed text-sm" data-testid="ci-lowest-files">
                  <caption className="sr-only">Files with the lowest line coverage</caption>
                  <thead><tr className="text-left text-xs text-slate-500 dark:text-slate-400"><th scope="col" className="pb-1 font-medium">File</th><th scope="col" className="w-24 pb-1 text-right font-medium">Lines hit</th><th scope="col" className="w-24 pb-1 text-right font-medium">Coverage</th></tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data!.coverage.lowestFiles.map((f) => (
                      <tr key={f.path}>
                        <td className="truncate py-1.5 pr-2 font-mono text-xs text-slate-700 dark:text-slate-300" title={f.path}>{f.path}</td>
                        <td className="py-1.5 text-right tabular-nums text-xs text-slate-600 dark:text-slate-300">{f.linesHit} / {f.linesFound}</td>
                        <td className="py-1.5 text-right"><Badge tone={covTone(f.coverage)}>{f.coverage.toFixed(1)} %</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card>
              <CardHeader title="Slowest tests" subtitle="Median duration over the last 7 days." action={<Timer size={16} className="text-slate-400" aria-hidden="true" />} />
              {data!.slowestTests.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No test results in the last 7 days.</p>
              ) : (
                <table className="w-full table-fixed text-sm" data-testid="ci-slowest-tests">
                  <caption className="sr-only">Slowest tests</caption>
                  <thead><tr className="text-left text-xs text-slate-500 dark:text-slate-400"><th scope="col" className="pb-1 font-medium">Test</th><th scope="col" className="w-20 pb-1 text-right font-medium">Median</th><th scope="col" className="w-14 pb-1 text-right font-medium">Runs</th></tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data!.slowestTests.map((t) => (
                      <tr key={t.testKey}>
                        <td className="py-1.5 pr-2"><p className="truncate text-xs text-slate-800 dark:text-slate-200" title={t.name}>{t.name}</p>{t.suite && <p className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={t.suite}>{t.suite}</p>}</td>
                        <td className="py-1.5 text-right tabular-nums text-xs text-slate-700 dark:text-slate-300" title={`Longest: ${fmtMs(t.maxMs)}`}>{fmtMs(t.medianMs)}</td>
                        <td className="py-1.5 text-right tabular-nums text-xs text-slate-500 dark:text-slate-400">{t.runs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card>
              <CardHeader title="Failing stages" subtitle="Pipeline stages that failed in the last 30 days." action={<Workflow size={16} className="text-slate-400" aria-hidden="true" />} />
              {data!.failingStages.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No failing stages.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="ci-failing-stages">
                  {data!.failingStages.map((s) => (
                    <li key={s.name} className="py-2.5" data-testid="ci-failing-stage">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{s.name}</p>
                        <Badge tone={s.failureRate >= 20 ? 'bad' : 'warn'}>{s.failureRate.toFixed(1)} % failed</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                        {s.failed} of {s.runs} runs failed{s.medianSeconds != null ? ` · median ${fmtMs(s.medianSeconds * 1000)}` : ''}
                      </p>
                      {s.lastFailedRuns.length > 0 && (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Latest failures:{' '}
                          {s.lastFailedRuns.map((r, i) => (
                            <React.Fragment key={r.id}>
                              {i > 0 && ', '}
                              {r.url && /^https?:\/\//.test(r.url)
                                ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-mono text-brand-700 hover:underline dark:text-brand-300">run {r.runId ?? r.id.slice(0, 8)}</a>
                                : <span className="font-mono">run {r.runId ?? r.id.slice(0, 8)}</span>}
                            </React.Fragment>
                          ))}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          )}
          {delivery && (hasDelivery || hasCi) && <DeliveryEvidenceSection delivery={delivery} onExplain={onExplain} canConnect={canConnect} />}
          {work && hasAny && <WorkEvidenceSection work={work} onExplain={onExplain} canConnect={canConnect} />}
        </div>
      )}
    </section>
  );
};

interface Calculation {
  sample?: boolean;
  metric: string; label: string; kpiColumn: string | null; day: string; value: number; unit: string | null; formula: string;
  inputs: Record<string, unknown>; sampleSize: number; confidence: 'high' | 'medium' | 'low'; recordedAt: string | null; computedAt: string;
  flakyTests?: Array<{ name: string; suite: string | null; commit: string; failedRuns: string[]; passedRuns: string[] }>;
  lowestFiles?: Array<{ path: string; linesFound: number; linesHit: number }>;
  sources: {
    testRuns: Array<{ id: string; runId: string; attempt: number; commit: string; branch: string | null; startedAt: string; passed: number; failed: number; errors: number; skipped: number; durationMs: number; format: string }>;
    pipelineRuns: Array<{ id: string; runId: string; attempt: number; name: string | null; commit: string; branch: string | null; startedAt: string; durationSeconds: number | null; result: string; url: string | null }>;
    coverageReports: Array<{ id: string; commit: string; branch: string | null; format: string; createdAt: string; linesFound: number; linesHit: number; branchesFound: number; branchesHit: number; files: number; changedLinesFound: number | null; changedLinesHit: number | null }>;
    deployments?: Array<{ id: string; deploymentId: string; service: string | null; environment: string; commit: string; startedAt: string | null; finishedAt: string; result: string; rollbackOf: string | null; hotfix: boolean; url: string | null; failedBecause: Array<{ type: 'rolled_back' | 'rollback' | 'hotfix' | 'incident'; ref: string | null; at: string }> }>;
    incidents?: Array<{ id: string; incidentId: string; title: string | null; severity: string; service: string | null; outage: boolean; status: string; openedAt: string; resolvedAt: string | null; deploymentId: string | null; url: string | null }>;
    issues?: Array<{ key: string; title: string | null; type: string; status: string | null; foundIn: string | null; environment: string | null; points: number | null; estimateHours: number | null; loggedHours: number | null; openedAt: string; resolvedAt: string | null; url: string | null; roles: string[] }>;
    analysisReports?: Array<{ id: string; tool: string; repo: string; branch: string | null; commit: string; analyzedAt: string; linesOfCode: number | null; findings: number; critical: number; high: number; medium: number; low: number; info: number; newFindings: number | null; fixedFindings: number | null }>;
  };
  sprint?: { id: string; name: string | null; startedAt: string | null; completedAt: string };
}

const INPUT_LABELS: Record<string, string> = {
  linesHit: 'Lines hit', linesFound: 'Lines found', branchesHit: 'Branches hit', branchesFound: 'Branches found', files: 'Files', format: 'Report format',
  changedLinesHit: 'Changed lines hit', changedLinesFound: 'Changed coverable lines', branch: 'Branch',
  passed: 'Passed', failed: 'Failed', errors: 'Errors', skipped: 'Skipped (not counted)', runs: 'Runs',
  medianMs: 'Median run duration (ms)', minMs: 'Shortest run (ms)', maxMs: 'Longest run (ms)',
  flakyTests: 'Flaky tests', distinctTests: 'Distinct tests run', windowDays: 'Window (days)',
  firstAttemptPassed: 'First attempts that passed', basis: 'Based on', successful: 'Successful runs', cancelled: 'Cancelled (not counted)',
  medianSeconds: 'Median duration (s)', minSeconds: 'Shortest (s)', maxSeconds: 'Longest (s)',
  productionDeploys: 'Production deploys', periodDays: 'Period (days)', weeks: 'Weeks', notCompleted: 'Deploys that did not complete (not counted)',
  rollbackDeploys: 'Rollback deploys (not counted)', deploysWithCommits: 'Deploys with commit times', deploysWithoutCommitTimes: 'Deploys without commit times (left out)',
  medianHours: 'Median (hours)', commits: 'Commits', failedChanges: 'Failed changes', rolledBack: 'Rolled back', followedByHotfix: 'Followed by a hotfix',
  linkedIncident: 'Linked to an incident', hotfixWindowHours: 'Hotfix window (hours)', incidentsResolved: 'Incidents resolved', shortestHours: 'Shortest (hours)',
  longestHours: 'Longest (hours)', outageHours: 'Outage time (hours)', periodHours: 'Period (hours)', outages: 'Outages', openOutages: 'Open outages',
  intervals: 'Intervals between incidents', incidents: 'Incidents', services: 'Services', infrastructureIncidents: 'Infrastructure incidents',
  escapedBugs: 'Bugs found in production', bugsWithEnvironment: 'Bugs with a known environment', bugsWithoutEnvironment: 'Bugs without an environment (left out)',
  linesOfCode: 'Lines of code', kloc: 'Thousands of lines (KLOC)', sprint: 'Sprint', completedPoints: 'Completed story points', completedIssues: 'Completed issues',
  unestimatedCompleted: 'Completed without story points', committedPoints: 'Committed story points', committedIssues: 'Committed issues', addedIssues: 'Added after the start',
  addedPoints: 'Points added after the start', notCompletedPoints: 'Story points not completed', notCompletedIssues: 'Issues not completed', blockedHours: 'Blocked hours',
  blockedIssues: 'Blocked issues', sprintIssues: 'Issues in the sprint', activeIssues: 'Active issues', timeLoggedHours: 'Time logged (hours)', estimateHours: 'Original estimate (hours)',
  issues: 'Issues', weightedFindings: 'Weighted findings', linesOfCodeFrom: 'Lines of code from', weightedPerKloc: 'Weighted findings per KLOC', critical: 'Critical', high: 'High',
  medium: 'Medium', low: 'Low', info: 'Info (weight 0)', reports: 'Reports',
};

const inputValue = (v: unknown): string => (v && typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${x}`).join(', ') : String(v));

/**
 * "How this was calculated": the formula, the values used, the number of runs (confidence) and the
 * source runs / reports with their ids. When the card shows a value from another source (e.g. sent
 * to /api/ingest/kpis or entered by hand), the dialog says so.
 */
export const HowCalculatedDialog: React.FC<{ teamId: string; metric: string | null; date?: string | null; cardSource?: string | null; onClose: () => void }> = ({ teamId, metric, date, cardSource, onClose }) => {
  const [calc, setCalc] = useState<Calculation | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!metric) return;
    setCalc(null);
    setError(null);
    const q = date ? `?date=${encodeURIComponent(date)}` : '';
    fetch(`${API_URL}/ci/teams/${encodeURIComponent(teamId)}/metrics/${encodeURIComponent(metric)}${q}`, { credentials: 'include' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || 'The calculation could not be loaded');
        setCalc(body);
      })
      .catch((e) => setError(e.message));
  }, [teamId, metric, date]);

  const conf = calc ? CONFIDENCE_TEXT[calc.confidence] : null;
  const delivery = !!calc && DELIVERY_KEYS.includes(calc.metric);
  const phase3 = !!calc && PHASE3_KEYS.includes(calc.metric);
  const noun = !calc ? 'run' : phase3 ? workNoun(calc.metric) : !delivery ? 'run' : ['mttr', 'availability', 'infrastructure_failures'].includes(calc.metric) ? 'incident' : calc.metric === 'mtbf' ? 'interval' : 'deploy';
  const help = conf && (delivery || phase3) ? conf.help.replace('runs', `${noun}s`) : conf?.help;
  return (
    <Modal isOpen={!!metric} onClose={onClose} title={calc ? `How this was calculated: ${calc.label}` : 'How this was calculated'} size="lg" scrollBody
      subtitle={calc ? `Value for ${formatAsOf(calc.day)}, calculated ${formatAsOf(calc.computedAt)}` : undefined}
      titleAside={conf ? <Badge tone={conf.tone}>{conf.label}</Badge> : undefined}
    >
      {error ? (
        <p className="text-sm text-slate-600 dark:text-slate-300" role="alert">{error}</p>
      ) : !calc ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : (
        <div className="space-y-5 text-sm" data-testid="how-calculated">
          <div className="flex items-start gap-3 rounded-md bg-slate-50 p-3 dark:bg-slate-800/60">
            <Calculator size={18} className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            <div>
              <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white" data-testid="how-calculated-value">{fmtValue(calc.value, calc.unit, calc.metric)}</p>
              <p className="mt-1 text-slate-700 dark:text-slate-300" data-testid="how-calculated-formula"><span className="font-medium">Formula:</span> {calc.formula}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Based on {calc.sampleSize} {noun}{calc.sampleSize === 1 ? '' : 's'} ({help}).{calc.sample ? ' Calculated from sample CI data: shown as evidence, not written to the team’s KPIs.' : calc.kpiColumn ? ' Written to the team’s KPI as source “computed”.' : ' Shown here only (no KPI column).'}</p>
              {cardSource && cardSource !== 'computed' && calc.kpiColumn && !calc.sample && (
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300" data-testid="how-calculated-other-source">The card shows the latest value from “{cardSource === 'synthetic' ? 'sample data' : cardSource}”; this is the value calculated from CI data.</p>
              )}
            </div>
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Values used</h3>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2" data-testid="how-calculated-inputs">
              {Object.entries(calc.inputs).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-slate-100 py-1 dark:border-slate-800">
                  <dt className="text-slate-600 dark:text-slate-400">{INPUT_LABELS[k] ?? k}</dt>
                  <dd className="text-right font-medium tabular-nums text-slate-900 dark:text-white">{inputValue(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
          {calc.flakyTests && calc.flakyTests.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Flaky tests counted</h3>
              <ul className="space-y-1">
                {calc.flakyTests.map((f) => (
                  <li key={`${f.name}${f.commit}`} className="text-xs text-slate-700 dark:text-slate-300"><span className="font-medium">{f.name}</span> · commit <span className="font-mono">{short(f.commit)}</span> · failed in {f.failedRuns.length}, passed in {f.passedRuns.length} run{f.passedRuns.length === 1 ? '' : 's'}</li>
                ))}
              </ul>
            </div>
          )}
          {calc.lowestFiles && calc.lowestFiles.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Lowest-coverage files in this report</h3>
              <ul className="space-y-0.5">
                {calc.lowestFiles.slice(0, 5).map((f) => (
                  <li key={f.path} className="flex justify-between gap-3 text-xs"><span className="truncate font-mono text-slate-700 dark:text-slate-300" title={f.path}>{f.path}</span><span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{f.linesHit} / {f.linesFound}</span></li>
                ))}
              </ul>
            </div>
          )}
          {calc.sprint && (
            <p className="text-xs text-slate-600 dark:text-slate-300" data-testid="how-calculated-sprint">
              Sprint <span className="font-medium">{calc.sprint.name ?? calc.sprint.id}</span>{calc.sprint.startedAt ? `, started ${formatAsOf(calc.sprint.startedAt)}` : ''}, closed {formatAsOf(calc.sprint.completedAt)}
            </p>
          )}
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Source records</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="how-calculated-sources">
                <caption className="sr-only">The runs and reports this value was calculated from</caption>
                <thead><tr className="text-left text-slate-500 dark:text-slate-400"><th scope="col" className="pb-1 pr-3 font-medium">Record</th><th scope="col" className="pb-1 pr-3 font-medium">Commit / branch</th><th scope="col" className="pb-1 pr-3 font-medium">When</th><th scope="col" className="pb-1 font-medium">Result</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {calc.sources.coverageReports.map((c) => (
                    <tr key={c.id}><td className="py-1 pr-3">Coverage report ({c.format}) <span className="font-mono text-slate-500 dark:text-slate-400" title={c.id}>{c.id.slice(-8)}</span></td><td className="py-1 pr-3 font-mono">{short(c.commit)}{c.branch ? ` · ${c.branch}` : ''}</td><td className="py-1 pr-3">{formatAsOf(c.createdAt)}</td><td className="py-1 tabular-nums">{c.linesHit} / {c.linesFound} lines · {c.files} files</td></tr>
                  ))}
                  {calc.sources.testRuns.map((t) => (
                    <tr key={t.id}><td className="py-1 pr-3">Test run {t.runId}{t.attempt > 1 ? ` (attempt ${t.attempt})` : ''} <span className="font-mono text-slate-500 dark:text-slate-400" title={t.id}>{t.id.slice(-8)}</span></td><td className="py-1 pr-3 font-mono">{short(t.commit)}{t.branch ? ` · ${t.branch}` : ''}</td><td className="py-1 pr-3">{formatAsOf(t.startedAt)}</td><td className="py-1 tabular-nums">{t.passed} passed · {t.failed + t.errors} failed · {t.skipped} skipped · {fmtMs(t.durationMs)}</td></tr>
                  ))}
                  {[...(calc.sources.deployments ?? [])].sort((a, b) => b.failedBecause.length - a.failedBecause.length).map((d) => (
                    <tr key={d.id} data-testid="how-calculated-deployment"><td className="py-1 pr-3">{d.url && /^https?:\/\//.test(d.url) ? <a className="text-brand-700 hover:underline dark:text-brand-300" href={d.url} target="_blank" rel="noopener noreferrer">Deploy {d.deploymentId}</a> : <>Deploy {d.deploymentId}</>}{d.hotfix ? ' (hotfix)' : ''}{d.service ? <span className="text-slate-500 dark:text-slate-400"> · {d.service}</span> : null}</td><td className="py-1 pr-3 font-mono">{short(d.commit)} · {d.environment}</td><td className="py-1 pr-3">{formatAsOf(d.finishedAt)}</td><td className="py-1">{d.failedBecause.length ? <span className="text-red-700 dark:text-red-400">Failed change: {d.failedBecause.map((r) => failureText(r, d.finishedAt)).join('; ')}</span> : d.result === 'rolled_back' ? 'rolled back' : 'succeeded'}</td></tr>
                  ))}
                  {(calc.sources.incidents ?? []).map((i) => (
                    <tr key={i.id} data-testid="how-calculated-incident"><td className="py-1 pr-3">Incident {i.incidentId} <span className="text-slate-500 dark:text-slate-400">· {SEVERITY[i.severity]?.label ?? i.severity}{i.outage ? ', outage' : ''}</span></td><td className="py-1 pr-3">{i.service ?? '—'}{i.deploymentId ? <span className="font-mono"> · deploy {i.deploymentId}</span> : null}</td><td className="py-1 pr-3">{formatAsOf(i.openedAt)}</td><td className="py-1">{i.resolvedAt ? `resolved after ${(((new Date(i.resolvedAt).getTime() - new Date(i.openedAt).getTime()) / 3_600_000)).toFixed(1)} h` : 'open'}</td></tr>
                  ))}
                  {(calc.sources.issues ?? []).map((i) => (
                    <tr key={i.key} data-testid="how-calculated-issue"><td className="py-1 pr-3">{i.url && /^https?:\/\//.test(i.url) ? <a className="font-mono text-brand-700 hover:underline dark:text-brand-300" href={i.url} target="_blank" rel="noopener noreferrer">{i.key}</a> : <span className="font-mono">{i.key}</span>} <span className="text-slate-500 dark:text-slate-400">· {i.type}{i.points !== null ? `, ${i.points} pts` : ''}</span>{i.title ? <span className="block text-slate-600 dark:text-slate-300">{i.title}</span> : null}</td><td className="py-1 pr-3">{i.status ?? '—'}{i.environment ? ` · found in ${i.environment}` : ''}</td><td className="py-1 pr-3">{formatAsOf(i.openedAt)}{i.resolvedAt ? ` → ${formatAsOf(i.resolvedAt)}` : ''}</td><td className="py-1">{i.roles.join('; ')}</td></tr>
                  ))}
                  {(calc.sources.analysisReports ?? []).map((r) => (
                    <tr key={r.id} data-testid="how-calculated-report"><td className="py-1 pr-3">{r.tool} report <span className="font-mono text-slate-500 dark:text-slate-400" title={r.id}>{r.id.slice(-8)}</span>{r.repo ? <span className="block font-mono text-slate-600 dark:text-slate-300">{r.repo}</span> : null}</td><td className="py-1 pr-3 font-mono">{short(r.commit)}{r.branch ? ` · ${r.branch}` : ''}</td><td className="py-1 pr-3">{formatAsOf(r.analyzedAt)}</td><td className="py-1 tabular-nums">{r.findings} findings ({r.critical} critical, {r.high} high, {r.medium} medium, {r.low} low){r.linesOfCode ? ` · ${r.linesOfCode.toLocaleString('en-GB')} lines` : ''}{r.newFindings !== null ? ` · +${r.newFindings} / −${r.fixedFindings}` : ''}</td></tr>
                  ))}
                  {calc.sources.pipelineRuns.map((p) => (
                    <tr key={p.id}><td className="py-1 pr-3">{p.url && /^https?:\/\//.test(p.url) ? <a className="text-brand-700 hover:underline dark:text-brand-300" href={p.url} target="_blank" rel="noopener noreferrer">Pipeline run {p.runId}</a> : <>Pipeline run {p.runId}</>}{p.attempt > 1 ? ` (attempt ${p.attempt})` : ''}</td><td className="py-1 pr-3 font-mono">{short(p.commit)}{p.branch ? ` · ${p.branch}` : ''}</td><td className="py-1 pr-3">{formatAsOf(p.startedAt)}</td><td className="py-1">{p.result}{p.durationSeconds != null ? ` · ${fmtMs(p.durationSeconds * 1000)}` : ''}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};
