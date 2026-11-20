import React, { useCallback, useEffect, useState } from 'react';
import { Bug, CircleSlash, Gauge, ListChecks, Scale, ShieldAlert } from 'lucide-react';
import API_URL from '../config/api';
import { formatAsOf } from '../data/advancedFeatures';
import { Badge, Card, CardHeader } from './ui';
import type { Tone } from './ui';

/**
 * Work & code quality (v2 phase 3) in the team page's Evidence section: the sprint and defect values
 * QE Navigator calculated from the team's raw issues (Jira, Linear) and the code quality calculated
 * from its static-analysis reports (SARIF), each opening "How this was calculated"; the last closed
 * sprints, the escaped defects of the last 28 days, the most blocked, carried-over and worst-sized
 * issues of the latest sprint, and the latest reports with their findings by severity and rule and
 * the findings that are new or fixed since the previous report.
 * Data: GET /api/ci/teams/:id/work (analytics scope, like the KPI history).
 */

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export interface WorkIssue { key: string; title: string | null; type: string; url: string | null; points: number | null; openedAt: string | null; resolvedAt: string | null; environment: string | null; foundIn: string | null; components: string[] }
export interface WorkFinding { ruleId: string; ruleName: string | null; severity: Severity; message: string | null; path: string | null; line: number | null; repo: string; tool: string }
export interface Work {
  teamId: string;
  sample: { work: boolean; quality: boolean };
  lastReceived: Record<'issues' | 'static-analysis', { at: string | null; uploads: number; sample: boolean }>;
  metrics: Array<{ key: string; label: string; group: 'work' | 'quality'; day: string; value: number; unit: string | null; sampleSize: number; confidence: 'high' | 'medium' | 'low' }>;
  sprints: Array<{ id: string; name: string | null; startedAt: string | null; completedAt: string | null; issues: number; committedPoints: number; completedPoints: number; notCompletedPoints: number; addedIssues: number; commitment: number | null; carryover: number | null; blockedHours: number; sizingAccuracy: number | null }>;
  blocked: Array<WorkIssue & { hours: number; sprint: string }>;
  sizing: Array<WorkIssue & { estimateHours: number; loggedHours: number; ratio: number }>;
  carriedOver: Array<WorkIssue & { inLaterSprint: boolean }>;
  defects: { windowDays: number; bugs: number; escaped: number; preRelease: number; unknown: number; escapedList: WorkIssue[]; byComponent: Array<{ component: string; escaped: number }> };
  quality: {
    reports: Array<{ id: string; tool: string; repo: string; branch: string | null; commit: string; analyzedAt: string; linesOfCode: number | null; findings: number; bySeverity: Record<Severity, number>; weighted: number; newFindings: number | null; fixedFindings: number | null }>;
    rules: Array<{ ruleId: string; ruleName: string | null; findings: number; newFindings: number; severity: Severity; category: string | null; paths: string[] }>;
    newFindings: WorkFinding[];
    fixedFindings: WorkFinding[];
    history: Array<{ day: string; value: number }>;
  };
}

/** The tiles, in this order. */
export const WORK_KEYS = ['escape_rate', 'defect_density', 'velocity', 'commitment', 'carryover', 'blocked_time', 'sizing_accuracy'];
export const QUALITY_KEYS = ['code_quality', 'findings', 'new_findings', 'fixed_findings'];
export const PHASE3_KEYS = [...WORK_KEYS, ...QUALITY_KEYS];

export function fmtWork(key: string, v: number, unit: string | null): string {
  if (key === 'sizing_accuracy' || unit === 'ratio') return `${v.toFixed(2)}× estimate`;
  if (unit === '%') return `${v.toFixed(1)} %`;
  if (unit === 'defects/KLOC') return `${v.toFixed(2)} per KLOC`;
  if (unit === 'points') return `${Math.round(v)} points`;
  if (unit === 'h') return `${v >= 10 ? Math.round(v) : v.toFixed(1)} h`;
  if (unit === '/100') return `${Math.round(v)} / 100`;
  if (unit === 'findings') return `${Math.round(v)}`;
  return `${v}${unit ? ` ${unit}` : ''}`;
}

/** What a metric's sample size counts (for "Based on …"). */
export const workNoun = (key: string) => (['escape_rate', 'defect_density'].includes(key) ? 'bug' : key === 'sizing_accuracy' ? 'issue' : QUALITY_KEYS.includes(key) ? 'report' : 'sprint issue');

export const FINDING_SEVERITY: Record<Severity, { label: string; tone: Tone }> = {
  critical: { label: 'Critical', tone: 'bad' }, high: { label: 'High', tone: 'bad' }, medium: { label: 'Medium', tone: 'warn' }, low: { label: 'Low', tone: 'neutral' }, info: { label: 'Info', tone: 'neutral' },
};

export function useTeamWork(teamId: string) {
  const [data, setData] = useState<Work | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await fetch(`${API_URL}/ci/teams/${encodeURIComponent(teamId)}/work`, { credentials: 'include' });
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

export const hasWorkData = (d: Work | null | undefined) =>
  !!d && (d.metrics.length > 0 || d.sprints.length > 0 || d.defects.bugs > 0 || d.quality.reports.length > 0);

const IssueRef: React.FC<{ i: { key: string; url: string | null } }> = ({ i }) => (
  i.url && /^https?:\/\//.test(i.url)
    ? <a href={i.url} target="_blank" rel="noopener noreferrer" className="font-mono text-brand-700 hover:underline dark:text-brand-300">{i.key}</a>
    : <span className="font-mono">{i.key}</span>
);

const sizingTone = (r: number): Tone => (Math.abs(r - 1) <= 0.15 ? 'good' : Math.abs(r - 1) <= 0.3 ? 'warn' : 'bad');

const Tiles: React.FC<{ metrics: Work['metrics']; keys: string[]; onExplain: (m: string) => void; testId: string }> = ({ metrics, keys, onExplain, testId }) => {
  const tiles = keys.map((k) => metrics.find((m) => m.key === k)).filter((m): m is Work['metrics'][number] => !!m);
  if (!tiles.length) return <p className="text-sm text-slate-500 dark:text-slate-400" data-testid={`${testId}-none`}>The data is stored; the values appear after the next calculation.</p>;
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid={testId}>
      {tiles.map((m) => (
        <li key={m.key}>
          <button
            type="button"
            onClick={() => onExplain(m.key)}
            className="flex w-full flex-col items-start rounded-md border border-slate-200 px-3 py-2 text-left hover:border-brand-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-800 dark:hover:bg-slate-800/60"
            data-testid={`work-metric-${m.key}`}
            aria-label={`${m.label}: ${fmtWork(m.key, m.value, m.unit)}. How this was calculated`}
          >
            <span className="text-xs text-slate-500 dark:text-slate-400">{m.label}</span>
            <span className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">{fmtWork(m.key, m.value, m.unit)}</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{formatAsOf(m.day)} · {m.sampleSize} {workNoun(m.key)}{m.sampleSize === 1 ? '' : 's'} · {m.confidence} confidence</span>
          </button>
        </li>
      ))}
    </ul>
  );
};

const SeverityChips: React.FC<{ c: Record<Severity, number> }> = ({ c }) => (
  <span className="flex flex-wrap justify-end gap-1">
    {(['critical', 'high', 'medium', 'low'] as Severity[]).filter((s) => c[s] > 0).map((s) => <Badge key={s} tone={FINDING_SEVERITY[s].tone}>{c[s]} {FINDING_SEVERITY[s].label.toLowerCase()}</Badge>)}
    {(['critical', 'high', 'medium', 'low'] as Severity[]).every((s) => !c[s]) && <Badge tone="good">No findings</Badge>}
  </span>
);

const FindingList: React.FC<{ list: WorkFinding[]; empty: string; testId: string }> = ({ list, empty, testId }) => (
  list.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">{empty}</p> : (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid={testId}>
      {list.map((f, i) => (
        <li key={`${f.ruleId}${f.path}${f.line}${i}`} className="py-2" data-testid={`${testId}-item`}>
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 break-words text-xs font-medium text-slate-900 dark:text-white">{f.ruleName ?? f.ruleId}</p>
            <Badge tone={FINDING_SEVERITY[f.severity]?.tone ?? 'neutral'}>{FINDING_SEVERITY[f.severity]?.label ?? f.severity}</Badge>
          </div>
          {f.message && <p className="mt-0.5 line-clamp-2 break-words text-xs text-slate-600 dark:text-slate-300">{f.message}</p>}
          <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">{f.path ?? '—'}{f.line ? `:${f.line}` : ''} · {f.repo || f.tool}</p>
        </li>
      ))}
    </ul>
  )
);

export const WorkEvidenceSection: React.FC<{ work: ReturnType<typeof useTeamWork>; onExplain: (metric: string) => void; canConnect?: boolean }> = ({ work, onExplain, canConnect }) => {
  const { data, state } = work;
  const [allRules, setAllRules] = useState(false);
  if (state === 'forbidden') return null;
  const last = data?.lastReceived;
  const q = data?.quality;
  const workMetrics = data?.metrics.filter((m) => m.group === 'work') ?? [];
  const qualityMetrics = data?.metrics.filter((m) => m.group === 'quality') ?? [];
  const hasIssues = !!data && (workMetrics.length > 0 || data.sprints.length > 0 || data.defects.bugs > 0);
  const hasQuality = !!q && (q.reports.length > 0 || qualityMetrics.length > 0);
  const rules = q ? (allRules ? q.rules : q.rules.slice(0, 6)) : [];
  return (
    <section aria-labelledby="work-evidence-title" data-testid="work-evidence" className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h4 id="work-evidence-title" className="text-sm font-semibold text-slate-900 dark:text-white">Work &amp; code quality</h4>
        {last && hasWorkData(data) && (
          <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="work-last-received">
            Last data received — Issues: {last.issues.at ? formatAsOf(last.issues.at) : 'none yet'} · Static analysis: {last['static-analysis'].at ? formatAsOf(last['static-analysis'].at) : 'none yet'}
          </p>
        )}
      </div>
      {state === 'loading' && !data ? (
        <Card><p className="text-sm text-slate-500 dark:text-slate-400">Loading work and code quality…</p></Card>
      ) : state === 'error' ? (
        <Card><p className="text-sm text-red-700 dark:text-red-400">Work and code quality could not be loaded.</p></Card>
      ) : !hasWorkData(data) ? (
        <Card>
          <p className="text-sm font-medium text-slate-900 dark:text-white">No issues or static-analysis reports for this team yet</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400" data-testid="work-empty">
            {canConnect
              ? 'Send issues from Jira or Linear and SARIF reports from SonarQube, CodeQL or ESLint; QE Navigator calculates defect escape rate, defect density, velocity, commitment, carryover, blocked time, sizing accuracy and the code quality score. Set it up in Admin console → Connect your CI.'
              : 'When the team’s issue tracker sends issues and its pipeline sends static-analysis reports, the calculated values and their evidence appear here.'}
          </p>
        </Card>
      ) : (
        <>
          {hasIssues && (
            <Card>
              <CardHeader
                title="Sprints and defects"
                subtitle={`Calculated by QE Navigator from the team’s raw issues: defects over the last ${data!.defects.windowDays} days, sprint values from the latest closed sprint${data!.sample.work ? ' (sample data: shown as evidence, not written to the team’s KPIs)' : ''}; open one to see the formula and the issues it counts.`}
              />
              <Tiles metrics={workMetrics} keys={WORK_KEYS} onExplain={onExplain} testId="work-metrics" />
            </Card>
          )}

          {data!.sprints.length > 0 && (
            <Card>
              <CardHeader title="Last closed sprints" subtitle="Committed = in the sprint when it started; completed = done before it closed; carried over = not done when it closed." action={<ListChecks size={16} className="text-slate-400" aria-hidden="true" />} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm" data-testid="work-sprints">
                  <caption className="sr-only">Last closed sprints with committed and completed story points, carryover, blocked time and sizing accuracy</caption>
                  <thead><tr className="text-left text-xs text-slate-500 dark:text-slate-400">
                    <th scope="col" className="pb-1 pr-2 font-medium">Sprint</th><th scope="col" className="pb-1 pr-2 text-right font-medium">Committed</th>
                    <th scope="col" className="pb-1 pr-2 text-right font-medium">Completed</th><th scope="col" className="pb-1 pr-2 text-right font-medium">Commitment</th>
                    <th scope="col" className="pb-1 pr-2 text-right font-medium">Carryover</th><th scope="col" className="pb-1 pr-2 text-right font-medium">Blocked</th>
                    <th scope="col" className="pb-1 text-right font-medium">Sizing</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data!.sprints.map((s) => (
                      <tr key={s.id} data-testid="work-sprint">
                        <td className="py-1.5 pr-2 text-xs text-slate-800 dark:text-slate-200">{s.name ?? s.id}<span className="block text-[11px] text-slate-500 dark:text-slate-400">closed {s.completedAt ? formatAsOf(s.completedAt) : '—'} · {s.issues} issues{s.addedIssues ? `, ${s.addedIssues} added after the start` : ''}</span></td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-xs text-slate-700 dark:text-slate-300">{s.committedPoints} pts</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-xs text-slate-700 dark:text-slate-300">{s.completedPoints} pts</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-xs text-slate-700 dark:text-slate-300">{s.commitment === null ? '—' : `${s.commitment.toFixed(1)} %`}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-xs text-slate-700 dark:text-slate-300">{s.carryover === null ? '—' : `${s.carryover.toFixed(1)} %`}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-xs text-slate-700 dark:text-slate-300">{s.blockedHours} h</td>
                        <td className="py-1.5 text-right">{s.sizingAccuracy === null ? <span className="text-xs text-slate-500 dark:text-slate-400">—</span> : <Badge tone={sizingTone(s.sizingAccuracy)}>{s.sizingAccuracy.toFixed(2)}×</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {hasIssues && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader
                  title="Escaped defects"
                  subtitle={`${data!.defects.escaped} of ${data!.defects.escaped + data!.defects.preRelease} bugs with a known environment were found in production (last ${data!.defects.windowDays} days)${data!.defects.unknown ? ` · ${data!.defects.unknown} without an environment, not counted` : ''}.`}
                  action={<Bug size={16} className="text-slate-400" aria-hidden="true" />}
                />
                {data!.defects.byComponent.length > 0 && (
                  <p className="mb-2 text-xs text-slate-600 dark:text-slate-300" data-testid="work-escaped-components">
                    Where: {data!.defects.byComponent.map((c) => `${c.component} (${c.escaped})`).join(' · ')}
                  </p>
                )}
                {data!.defects.escapedList.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No defects found in production in the last {data!.defects.windowDays} days.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="work-escaped">
                    {data!.defects.escapedList.map((i) => (
                      <li key={i.key} className="py-2" data-testid="work-escaped-defect">
                        <p className="break-words text-sm text-slate-900 dark:text-white"><IssueRef i={i} /> {i.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">found in {i.environment ?? 'production'} · opened {i.openedAt ? formatAsOf(i.openedAt) : '—'}{i.components.length ? ` · ${i.components.join(', ')}` : ''}{i.resolvedAt ? ' · resolved' : ' · open'}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card>
                <CardHeader title="Blocked and carried over" subtitle={data!.sprints[0] ? `Latest closed sprint: ${data!.sprints[0].name ?? data!.sprints[0].id}.` : 'Issues of the last 14 days.'} action={<CircleSlash size={16} className="text-slate-400" aria-hidden="true" />} />
                {data!.blocked.length === 0 && data!.carriedOver.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Nothing was blocked or carried over.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="work-blocked">
                    {data!.blocked.map((b) => (
                      <li key={`b${b.key}`} className="flex items-start justify-between gap-2 py-2" data-testid="work-blocked-issue">
                        <p className="min-w-0 break-words text-xs text-slate-800 dark:text-slate-200"><IssueRef i={b} /> {b.title}</p>
                        <Badge tone={b.hours >= 24 ? 'bad' : 'warn'}>blocked {b.hours} h</Badge>
                      </li>
                    ))}
                    {data!.carriedOver.map((c) => (
                      <li key={`c${c.key}`} className="flex items-start justify-between gap-2 py-2" data-testid="work-carried-issue">
                        <p className="min-w-0 break-words text-xs text-slate-800 dark:text-slate-200"><IssueRef i={c} /> {c.title}</p>
                        <Badge tone="neutral">{c.points ?? 0} pts carried over</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              {data!.sizing.length > 0 && (
                <Card className="lg:col-span-2">
                  <CardHeader title="Sizing: estimate against time logged" subtitle="Completed issues of the latest closed sprint, furthest from their estimate first." action={<Scale size={16} className="text-slate-400" aria-hidden="true" />} />
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[30rem] text-sm" data-testid="work-sizing">
                      <caption className="sr-only">Completed issues with their original estimate, time logged and ratio</caption>
                      <thead><tr className="text-left text-xs text-slate-500 dark:text-slate-400"><th scope="col" className="pb-1 pr-2 font-medium">Issue</th><th scope="col" className="pb-1 pr-2 text-right font-medium">Estimate</th><th scope="col" className="pb-1 pr-2 text-right font-medium">Logged</th><th scope="col" className="pb-1 text-right font-medium">Ratio</th></tr></thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {data!.sizing.map((z) => (
                          <tr key={z.key}>
                            <td className="py-1.5 pr-2 text-xs text-slate-800 dark:text-slate-200"><IssueRef i={z} /> {z.title}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums text-xs text-slate-700 dark:text-slate-300">{z.estimateHours} h</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums text-xs text-slate-700 dark:text-slate-300">{z.loggedHours} h</td>
                            <td className="py-1.5 text-right"><Badge tone={sizingTone(z.ratio)}>{z.ratio.toFixed(2)}×</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          )}

          {hasQuality && (
            <>
              <Card>
                <CardHeader
                  title="Code quality (static analysis)"
                  subtitle={`Calculated from the latest main-branch SARIF report of each repository and tool${data!.sample.quality ? ' (sample data: shown as evidence, not written to the team’s KPIs)' : ''}. Score = 100 × e^(−weighted findings per 1,000 lines ÷ 20); weights critical 10, high 5, medium 2, low 0.5.`}
                  action={<Gauge size={16} className="text-slate-400" aria-hidden="true" />}
                />
                <Tiles metrics={qualityMetrics} keys={QUALITY_KEYS} onExplain={onExplain} testId="quality-metrics" />
                {q!.history.length > 1 && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400" data-testid="quality-history">
                    Score {formatAsOf(q!.history[0].day)}: {Math.round(q!.history[0].value)} → now {Math.round(q!.history[q!.history.length - 1].value)}
                  </p>
                )}
                {q!.reports.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[34rem] text-sm" data-testid="quality-reports">
                      <caption className="sr-only">Latest static-analysis reports with findings by severity, new and fixed findings</caption>
                      <thead><tr className="text-left text-xs text-slate-500 dark:text-slate-400"><th scope="col" className="pb-1 pr-2 font-medium">Repository and tool</th><th scope="col" className="pb-1 pr-2 font-medium">Analysed</th><th scope="col" className="pb-1 pr-2 text-right font-medium">New / fixed</th><th scope="col" className="pb-1 text-right font-medium">Findings</th></tr></thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {q!.reports.map((r) => (
                          <tr key={r.id} data-testid="quality-report">
                            <td className="py-1.5 pr-2 text-xs text-slate-800 dark:text-slate-200"><span className="font-mono">{r.repo || '—'}</span><span className="block text-[11px] text-slate-500 dark:text-slate-400">{r.tool} · {r.branch ?? 'main'} · commit <span className="font-mono">{r.commit ? r.commit.slice(0, 8) : '—'}</span></span></td>
                            <td className="py-1.5 pr-2 text-xs text-slate-600 dark:text-slate-300">{formatAsOf(r.analyzedAt)}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums text-xs text-slate-700 dark:text-slate-300">{r.newFindings === null ? 'first report' : `+${r.newFindings} / −${r.fixedFindings}`}</td>
                            <td className="py-1.5 text-right"><SeverityChips c={r.bySeverity} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-1">
                  <CardHeader title="Findings by rule" subtitle="Highest severity first, then the most findings." action={<ShieldAlert size={16} className="text-slate-400" aria-hidden="true" />} />
                  {rules.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No open findings.</p> : (
                    <>
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="quality-rules">
                        {rules.map((r) => (
                          <li key={r.ruleId} className="py-2" data-testid="quality-rule">
                            <div className="flex items-start justify-between gap-2">
                              <p className="min-w-0 break-words text-xs font-medium text-slate-900 dark:text-white">{r.ruleName ?? r.ruleId}</p>
                              <Badge tone={FINDING_SEVERITY[r.severity]?.tone ?? 'neutral'}>{FINDING_SEVERITY[r.severity]?.label ?? r.severity}</Badge>
                            </div>
                            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300"><span className="font-mono">{r.ruleId}</span> · {r.findings} finding{r.findings === 1 ? '' : 's'}{r.newFindings ? `, ${r.newFindings} new` : ''}{r.category ? ` · ${r.category}` : ''}</p>
                            {r.paths.length > 0 && <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">{r.paths.join(', ')}</p>}
                          </li>
                        ))}
                      </ul>
                      {q!.rules.length > 6 && (
                        <button type="button" onClick={() => setAllRules((v) => !v)} aria-expanded={allRules} data-testid="quality-rules-toggle" className="mt-2 rounded text-xs font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300">
                          {allRules ? 'Show fewer' : `Show all ${q!.rules.length}`}
                        </button>
                      )}
                    </>
                  )}
                </Card>
                <Card>
                  <CardHeader title="New findings" subtitle="Not in the previous report of the same repository and tool." />
                  <FindingList list={q!.newFindings} empty="No new findings since the previous report." testId="quality-new" />
                </Card>
                <Card>
                  <CardHeader title="Fixed findings" subtitle="In the previous report, gone from the latest." />
                  <FindingList list={q!.fixedFindings} empty="No findings fixed since the previous report." testId="quality-fixed" />
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
};


