import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, Loader2, Plus, X, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import toast from 'react-hot-toast';
import API_URL from '../config/api';
import { useAnalyticsScope, type AnalyticsScopeTeam } from '../contexts/AnalyticsScopeContext';
import { Page, PageIntro, Card, Badge, EmptyState, inputClass, cx, type Tone } from './ui';
import { ConfidenceNote, StaleNote, SampleMarker, type ConfidenceInfo } from './MetricQuality';
import SampleDataBanner from './SampleDataBanner';
import SavedViewsMenu from './SavedViewsMenu';
import ExportCsvButton from './ExportCsvButton';
import { QA_SCORE_THRESHOLDS } from '../../server/lib/metricFormulas';

/**
 * Team comparison: 2–4 teams of the user's analytics scope side by side
 * (GET /api/compare/teams, server/lib/compare.ts). Team aggregates only.
 *
 * Every value is judged against the target valid at its date (target history), stale values are
 * greyed and not compared, the QA score shows what it is based on. Rows where the teams differ
 * (different status bands, or a gap of at least 10% of the target) are highlighted; the best value
 * of each row is marked. The choice of teams, window and "only differences" lives in the URL
 * (?teams=a,b&days=30) and can be saved as a view.
 */

type Status = 'good' | 'warning' | 'critical';

interface Metric { key: string; label: string; unit: string; group: string; lowerIsBetter: boolean; decimals: number }
interface Cell {
  value: number | null; display: string; status: Status | null;
  target: { good: number; warning: number; lowerIsBetter: boolean; scope: string } | null; targetDisplay: string;
  stale: boolean; staleSince: string | null; recordedAt: string | null; sample: boolean;
  trend: Array<{ date: string; value: number }>; change: number | null;
}
interface CompareTeam {
  id: string; name: string; departmentName: string | null; leadName: string | null; memberCount: number;
  snapshotDate: string | null; qaScoreConfidence: ConfidenceInfo | null; sampleData: boolean; cells: Record<string, Cell>;
}
interface Diff { best: string[]; worst: string[]; spread: number | null; spreadDisplay: string; differs: boolean }
interface Comparison { days: number; metrics: Metric[]; teams: CompareTeam[]; differences: Record<string, Diff>; differenceRule: string }

const DAY_OPTIONS = [7, 30, 90];
const MAX_TEAMS = 4;

const STATUS_TONE: Record<Status, Tone> = { good: 'good', warning: 'warn', critical: 'bad' };
const STATUS_LABEL: Record<Status, string> = { good: 'On target', warning: 'Watch', critical: 'Off target' };
const STATUS_TEXT: Record<Status, string> = {
  good: 'text-green-700 dark:text-green-400',
  warning: 'text-amber-700 dark:text-amber-400',
  critical: 'text-red-700 dark:text-red-400',
};
const STATUS_STROKE: Record<Status | 'none', string> = {
  good: 'stroke-green-600 dark:stroke-green-400',
  warning: 'stroke-amber-500 dark:stroke-amber-400',
  critical: 'stroke-red-600 dark:stroke-red-400',
  none: 'stroke-slate-400 dark:stroke-slate-500',
};

function readUrl(): { teamIds: string[]; days: number; onlyDifferences: boolean } {
  try {
    const p = new URLSearchParams(window.location.search);
    const teamIds = (p.get('teams') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_TEAMS);
    const d = Number(p.get('days'));
    return { teamIds, days: DAY_OPTIONS.includes(d) ? d : 30, onlyDifferences: p.get('diff') === '1' };
  } catch {
    return { teamIds: [], days: 30, onlyDifferences: false };
  }
}

function writeUrl(teamIds: string[], days: number, onlyDifferences: boolean) {
  if (window.location.pathname !== '/compare') return;
  const p = new URLSearchParams();
  if (teamIds.length) p.set('teams', teamIds.join(','));
  if (days !== 30) p.set('days', String(days));
  if (onlyDifferences) p.set('diff', '1');
  const qs = p.toString();
  window.history.replaceState(window.history.state, '', `/compare${qs ? `?${qs}` : ''}`);
}

/** Small trend line of the window; the dot is the latest value. */
const Sparkline: React.FC<{ points: Array<{ value: number }>; status: Status | null; label: string }> = ({ points, status, label }) => {
  if (points.length < 2) return <span className="text-xs text-slate-500 dark:text-slate-400">No trend</span>;
  const w = 88, h = 24, pad = 2;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const xy = points.map((p, i) => [pad + (i / (points.length - 1)) * (w - pad * 2), h - pad - ((p.value - min) / span) * (h - pad * 2)] as const);
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="block overflow-visible">
      <polyline points={xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className={STATUS_STROKE[status ?? 'none']} />
      <circle cx={lx} cy={ly} r={2.2} className={cx(STATUS_STROKE[status ?? 'none'], 'fill-white dark:fill-slate-900')} strokeWidth={1.5} />
    </svg>
  );
};

const Change: React.FC<{ cell: Cell; metric: Metric; days: number }> = ({ cell, metric, days }) => {
  if (cell.change === null) return null;
  const c = cell.change;
  const flat = Math.abs(c) < 0.5 * 10 ** -metric.decimals;
  const better = !flat && (metric.lowerIsBetter ? c < 0 : c > 0);
  const Icon = flat ? Minus : c > 0 ? ArrowUpRight : ArrowDownRight;
  const unit = metric.unit === '%' ? ' pts' : metric.unit === '/100' ? '' : metric.unit.startsWith('/') ? metric.unit : metric.unit ? ` ${metric.unit}` : '';
  const text = flat ? 'No change' : `${c > 0 ? '+' : ''}${c.toFixed(metric.decimals)}${unit}`;
  return (
    <span
      className={cx('inline-flex items-center gap-0.5 text-xs tabular-nums', flat ? 'text-slate-500 dark:text-slate-400' : better ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')}
      title={`Change over the last ${days} days`}
    >
      <Icon size={12} aria-hidden /> {text}
    </span>
  );
};

const CellView: React.FC<{ cell: Cell; metric: Metric; isBest: boolean; isWorst: boolean; days: number; teamName: string }> = ({ cell, metric, isBest, isWorst, days, teamName }) => {
  const valueCls = cell.value === null ? 'text-slate-500 dark:text-slate-400' : cell.stale ? 'text-slate-500 dark:text-slate-400' : cell.status ? STATUS_TEXT[cell.status] : 'text-slate-900 dark:text-white';
  return (
    <div className={'flex min-w-0 flex-col gap-1'}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={cx('text-base font-semibold tabular-nums', valueCls)} data-testid="compare-value">{cell.display}</span>
        {cell.status && !cell.stale && <span className="sr-only">{STATUS_LABEL[cell.status]}</span>}
        {isBest && <Badge tone="brand" className="!py-0 text-[10px] uppercase tracking-wide">Best</Badge>}
        {isWorst && <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" title="The weakest value of the compared teams (direction-aware: the highest value for lower-is-better metrics)">Weakest</span>}
        {cell.sample && <SampleMarker />}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {cell.value !== null && metric.key !== 'technical_debt_score' && <Sparkline points={cell.trend} status={cell.stale ? null : cell.status} label={`${teamName}, ${metric.label}: ${cell.trend.length} daily values over ${days} days`} />}
        <Change cell={cell} metric={metric} days={days} />
      </div>
      {cell.stale ? (
        <StaleNote staleSince={cell.staleSince} recordedAt={cell.recordedAt} />
      ) : (
        cell.target && <span className="text-xs text-slate-500 dark:text-slate-400">Target {cell.targetDisplay}</span>
      )}
    </div>
  );
};

const CompareTeams: React.FC = () => {
  const scope = useAnalyticsScope();
  const initial = useMemo(readUrl, []);
  const [teamIds, setTeamIds] = useState<string[]>(initial.teamIds);
  const [days, setDays] = useState(initial.days);
  const [onlyDifferences, setOnlyDifferences] = useState(initial.onlyDifferences);
  const [data, setData] = useState<Comparison | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [defaulted, setDefaulted] = useState(initial.teamIds.length > 0);

  const scopeTeams = scope.teams;
  const inScope = useCallback((id: string) => scopeTeams.some((t) => t.id === id), [scopeTeams]);

  // Once the scope is known: drop teams outside it; with nothing chosen, start with the selected
  // analytics team and another team of its department.
  useEffect(() => {
    if (scope.loading) return;
    setTeamIds((ids) => {
      const kept = ids.filter(inScope);
      if (kept.length || defaulted) return kept;
      const first = scope.team ?? scopeTeams[0];
      if (!first) return [];
      const second = scopeTeams.find((t) => t.id !== first.id && t.department_id === first.department_id) ?? scopeTeams.find((t) => t.id !== first.id);
      return second ? [first.id, second.id] : [first.id];
    });
    setDefaulted(true);
  }, [scope.loading, scopeTeams, scope.team, inScope, defaulted]);

  useEffect(() => { writeUrl(teamIds, days, onlyDifferences); }, [teamIds, days, onlyDifferences]);

  const query = teamIds.length >= 2 ? `ids=${teamIds.map(encodeURIComponent).join(',')}&days=${days}` : null;

  useEffect(() => {
    if (!query) { setData(null); setState('idle'); return; }
    let cancelled = false;
    setState('loading');
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API_URL}/compare/teams?${query}`, { credentials: 'include' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `Could not compare the teams (${res.status})`);
        if (!cancelled) { setData(body); setState('ready'); }
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || 'Could not compare the teams'); setState('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [query]);

  const available = scopeTeams.filter((t) => !teamIds.includes(t.id));
  const byDept = useMemo(() => {
    const groups = new Map<string, AnalyticsScopeTeam[]>();
    for (const t of available) {
      const k = t.department_name || 'No department';
      groups.set(k, [...(groups.get(k) ?? []), t]);
    }
    return [...groups.entries()];
  }, [available]);

  const teamName = (id: string) => scopeTeams.find((t) => t.id === id)?.name ?? data?.teams.find((t) => t.id === id)?.name ?? 'Team';

  const viewState = useMemo(() => ({ teamIds, days, ...(onlyDifferences ? { onlyDifferences: true } : {}) }), [teamIds, days, onlyDifferences]);
  const applyView = (s: Record<string, unknown>) => {
    const ids = Array.isArray(s.teamIds) ? (s.teamIds as string[]) : [];
    const kept = ids.filter(inScope);
    if (kept.length < ids.length) toast(`${ids.length - kept.length} team${ids.length - kept.length === 1 ? ' is' : 's are'} outside your scope and left out`);
    setTeamIds(kept.slice(0, MAX_TEAMS));
    setDays(DAY_OPTIONS.includes(Number(s.days)) ? Number(s.days) : 30);
    setOnlyDifferences(s.onlyDifferences === true);
  };

  const teams = data?.teams ?? [];
  const metrics = (data?.metrics ?? []).filter((m) => !onlyDifferences || data?.differences[m.key]?.differs);
  const groups = metrics.reduce<Array<{ group: string; items: Metric[] }>>((acc, m) => {
    const g = acc.find((x) => x.group === m.group);
    if (g) g.items.push(m); else acc.push({ group: m.group, items: [m] });
    return acc;
  }, []);
  const differing = data ? data.metrics.filter((m) => data.differences[m.key]?.differs).length : 0;

  return (
    <Page>
      <div data-testid="compare-teams">
        <PageIntro
          title="Compare teams"
          description="Two to four teams of your analytics scope side by side: current KPIs against the targets valid at each value's date, the QA score with what it is based on, and the trend of the chosen window."
          actions={
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <SavedViewsMenu kind="compare" state={viewState} onApply={applyView} saveDisabledReason={teamIds.length < 2 ? 'Choose at least 2 teams to save a comparison.' : null} />
              {query ? (
                <ExportCsvButton what="Team comparison" href={`${API_URL}/compare/teams.csv?${query}`} testId="compare-export" />
              ) : (
                <ExportCsvButton what="Team comparison" columns={[]} rows={[]} testId="compare-export" />
              )}
            </div>
          }
        />

        <SampleDataBanner show={teams.some((t) => t.sampleData)} />

        <Card className="mb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 flex-1">
              <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400" id="compare-teams-label">Teams ({teamIds.length} of {MAX_TEAMS})</p>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="compare-teams-label">
                {teamIds.map((id) => (
                  <span key={id} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 pl-3 pr-1 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100" data-testid="compare-chip">
                    <span className="max-w-[12rem] truncate">{teamName(id)}</span>
                    <button
                      type="button"
                      onClick={() => setTeamIds((ids) => ids.filter((x) => x !== id))}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
                      aria-label={`Remove ${teamName(id)} from the comparison`}
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
                {teamIds.length < MAX_TEAMS && available.length > 0 && (
                  <label className="relative inline-flex items-center">
                    <span className="sr-only">Add a team to the comparison</span>
                    <Plus size={14} className="pointer-events-none absolute left-2.5 text-slate-400" aria-hidden />
                    <select
                      value=""
                      onChange={(e) => { const v = e.target.value; if (v) setTeamIds((ids) => (ids.includes(v) ? ids : [...ids, v].slice(0, MAX_TEAMS))); }}
                      className={cx(inputClass, 'max-w-[16rem] pl-7 pr-8')}
                      data-testid="compare-add"
                    >
                      <option value="">Add team</option>
                      {byDept.map(([dept, list]) => (
                        <optgroup key={dept} label={dept}>
                          {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Trend window</span>
                <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={cx(inputClass, 'pr-8')} data-testid="compare-days">
                  {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d} days</option>)}
                </select>
              </label>
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={onlyDifferences}
                  onChange={(e) => setOnlyDifferences(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900"
                  data-testid="compare-only-diff"
                />
                Only rows that differ{data ? ` (${differing})` : ''}
              </label>
            </div>
          </div>
        </Card>

        {scope.loading ? null : scopeTeams.length < 2 ? (
          <Card>
            <EmptyState
              icon={<GitCompareArrows size={28} />}
              title="Not enough teams to compare"
              description="Comparison works within your analytics scope, which has fewer than two teams. Ask an administrator if you need to see more teams."
            />
          </Card>
        ) : teamIds.length < 2 ? (
          <Card>
            <EmptyState icon={<GitCompareArrows size={28} />} title="Choose at least two teams" description="Add two to four teams of your scope to see them side by side." />
          </Card>
        ) : state === 'error' ? (
          <Card><EmptyState title="Comparison unavailable" description={error ?? undefined} /></Card>
        ) : !data ? (
          <Card><p className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500 dark:text-slate-400"><Loader2 size={16} className="animate-spin" /> Comparing teams…</p></Card>
        ) : (
          <div className={cx(state === 'loading' && 'opacity-60 transition-opacity')} aria-busy={state === 'loading'}>
            {/* Team headers */}
            <div className={cx('mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2', teams.length === 3 && 'xl:grid-cols-3', teams.length === 4 && 'xl:grid-cols-4')}>
              {teams.map((t) => {
                const qa = t.cells.qa_score;
                return (
                  <Card key={t.id} className="flex flex-col gap-2" >
                    <div className="min-w-0" data-testid="compare-team-card">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{t.name}</p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {[t.departmentName, t.leadName ? `Lead ${t.leadName}` : null, `${t.memberCount} member${t.memberCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className={cx('text-3xl font-semibold tabular-nums', qa.status ? STATUS_TEXT[qa.status] : 'text-slate-500 dark:text-slate-400')}>{qa.display}</span>
                      {qa.value !== null && <span className="text-sm text-slate-500 dark:text-slate-400">QA score</span>}
                      {qa.status && <Badge tone={STATUS_TONE[qa.status]}>{STATUS_LABEL[qa.status]}</Badge>}
                    </div>
                    <ConfidenceNote c={t.qaScoreConfidence} compact />
                    <p className="text-xs text-slate-500 dark:text-slate-400">{t.snapshotDate ? `Latest snapshot ${t.snapshotDate}` : 'No KPI snapshot recorded'}</p>
                  </Card>
                );
              })}
            </div>

            {metrics.length === 0 ? (
              <Card><EmptyState title="No differences" description="The teams are in the same status band on every metric with a current value." /></Card>
            ) : (
              <>
                {/* Wide screens: one column per team */}
                <Card padded={false} className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[720px] table-fixed text-left text-sm" data-testid="compare-table">
                    <caption className="sr-only">KPI comparison of {teams.map((t) => t.name).join(', ')}</caption>
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800">
                        <th scope="col" className="w-56 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Metric</th>
                        {teams.map((t) => (
                          <th key={t.id} scope="col" className="px-4 py-3 text-xs font-semibold text-slate-700 dark:text-slate-200"><span className="block truncate">{t.name}</span></th>
                        ))}
                      </tr>
                    </thead>
                    {groups.map((g) => (
                      <tbody key={g.group}>
                        <tr className="bg-slate-50 dark:bg-slate-800/40">
                          <th colSpan={teams.length + 1} scope="colgroup" className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{g.group}</th>
                        </tr>
                        {g.items.map((m) => {
                          const d = data.differences[m.key];
                          return (
                            <tr key={m.key} className={cx('border-b border-slate-100 align-top last:border-0 dark:border-slate-800', d?.differs && 'bg-amber-50/50 dark:bg-amber-950/15')} data-testid="compare-row" data-differs={d?.differs ? 'true' : 'false'}>
                              <th scope="row" className={cx('px-4 py-3 font-normal', d?.differs && 'border-l-2 border-amber-500 dark:border-amber-400')}>
                                <span className="block font-medium text-slate-900 dark:text-white">{m.label}</span>
                                <span className="block text-xs text-slate-500 dark:text-slate-400">
                                  {m.lowerIsBetter ? 'Lower is better' : 'Higher is better'}
                                  {d?.differs && <> · <span className="font-medium text-amber-700 dark:text-amber-400">Differs by {d.spreadDisplay}</span></>}
                                </span>
                              </th>
                              {teams.map((t) => (
                                <td key={t.id} className="px-4 py-3">
                                  <CellView cell={t.cells[m.key]} metric={m} days={data.days} teamName={t.name} isBest={!!d?.best.includes(t.id)} isWorst={!!d?.worst.includes(t.id) && teams.length > 2} />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    ))}
                  </table>
                </Card>

                {/* Phones: one card per metric, teams listed inside */}
                <div className="flex flex-col gap-4 md:hidden" data-testid="compare-cards">
                  {groups.map((g) => (
                    <section key={g.group} aria-label={g.group}>
                      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{g.group}</h3>
                      <div className="flex flex-col gap-3">
                        {g.items.map((m) => {
                          const d = data.differences[m.key];
                          return (
                            <Card key={m.key} className={cx('!p-4', d?.differs && 'border-l-2 !border-l-amber-500 dark:!border-l-amber-400')}>
                              <p className="text-sm font-medium text-slate-900 dark:text-white">{m.label}</p>
                              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                                {m.lowerIsBetter ? 'Lower is better' : 'Higher is better'}
                                {d?.differs && <> · <span className="font-medium text-amber-700 dark:text-amber-400">Differs by {d.spreadDisplay}</span></>}
                              </p>
                              <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
                                {teams.map((t) => (
                                  <li key={t.id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                                    <span className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{t.name}</span>
                                    <div className="min-w-0">
                                      <CellView cell={t.cells[m.key]} metric={m} days={data.days} teamName={t.name} isBest={!!d?.best.includes(t.id)} isWorst={!!d?.worst.includes(t.id) && teams.length > 2} />
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </Card>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </>
            )}
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">{data.differenceRule} QA score bands: on target ≥ {QA_SCORE_THRESHOLDS.good}, watch ≥ {QA_SCORE_THRESHOLDS.warning}. Each value is judged against the target valid at its date.</p>
          </div>
        )}
      </div>
    </Page>
  );
};

export default CompareTeams;
