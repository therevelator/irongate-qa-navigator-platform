import React from 'react';
import { Check, Minus, X } from 'lucide-react';
import { Badge, Card, EmptyState, Page, PageIntro, cx } from '../ui';
import { AboutPage, Loading, Meter, dayText, useLoad } from './parts';

type State = 'ok' | 'stale' | 'missing';
interface Gap { source: string; label: string; required: boolean; state: State; lastSeen: string | null; blocks: string[]; fix: string; effort: string; seen: string[] }
interface ReadinessData {
  sources: Array<{ key: string; label: string; required: boolean }>;
  teams: Array<{ id: string; name: string; department: string | null; cells: Record<string, State>; last: Record<string, string>; readiness: number; gaps: Gap[]; discovery: Array<{ source: string; reportedAt: string; counts: Record<string, number> }> }>;
  exporter: { version: string | null; host: string | null; lastSeen: string } | null;
  rule: string;
}

const Cell: React.FC<{ state: State; required: boolean; label: string; last?: string }> = ({ state, required, label, last }) => {
  const text = state === 'ok' ? 'connected' : state === 'stale' ? `nothing new since ${dayText(last)}` : required ? 'missing' : 'not connected (optional)';
  const cls = state === 'ok' ? 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400' : state === 'stale' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
    : required ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400' : 'text-slate-300 dark:text-slate-600';
  return (
    <span className={cx('inline-flex h-7 w-7 items-center justify-center rounded-md', cls)} title={`${label}: ${text}`} aria-label={`${label}: ${text}`} data-state={state}>
      {state === 'ok' ? <Check size={15} aria-hidden /> : state === 'stale' ? <span className="text-xs font-bold" aria-hidden>!</span> : required ? <X size={15} aria-hidden /> : <Minus size={15} aria-hidden />}
    </span>
  );
};

/**
 * Data readiness: per team and source, whether QE Navigator receives what the metrics need; for each gap what it
 * blocks, the fix and the effort. A metric without a source is shown as missing, never guessed.
 */
const DataReadiness: React.FC = () => {
  const { data, error } = useLoad<ReadinessData>('/navigator/readiness');
  if (!data) return <Page><Loading error={error} /></Page>;
  const full = data.teams.filter((t) => t.readiness === 100).length;
  const gaps = data.teams.flatMap((t) => t.gaps.filter((g) => g.required).map((g) => ({ ...g, team: t.name })));
  const optional = data.teams.flatMap((t) => t.gaps.filter((g) => !g.required).map((g) => ({ ...g, team: t.name })));
  return (
    <Page>
      <PageIntro
        title={`${full} of ${data.teams.length} ${data.teams.length === 1 ? 'team is' : 'teams are'} fully measurable`}
        description={gaps.length ? `${gaps.length} ${gaps.length === 1 ? 'gap stands' : 'gaps stand'} between the rest and their numbers. For each: what it blocks, the fix and how long it takes.` : 'Every required source of every team is connected.'}
      />
      <AboutPage
        does="Shows, per team and per source, whether QE Navigator receives the records its metrics need. Each gap names the metrics it blocks and how to close it."
        goodFor="Turning an empty tile into a short to-do list for whoever looks after the pipelines. It also keeps the figures honest: no source, no number."
        from={data.rule}
      />
      {data.teams.length === 0 ? <Card><EmptyState title="No team in your scope" /></Card> : (
        <>
          <Card padded={false} className="mb-6 overflow-x-auto" data-testid="readiness-matrix">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="text-[11px] uppercase tracking-wider text-slate-500"><th className="px-5 py-3 text-left font-semibold">Team</th>
                {data.sources.map((s) => <th key={s.key} className="px-2 py-3 text-center font-semibold">{s.label}{!s.required && <span className="block font-normal normal-case tracking-normal text-slate-400">optional</span>}</th>)}
                <th className="px-5 py-3 text-left font-semibold">Readiness</th></tr></thead>
              <tbody>
                {data.teams.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800" data-testid="readiness-team">
                    <td className="px-5 py-3"><span className="font-semibold text-slate-900 dark:text-white">{t.name}</span><span className="block text-xs text-slate-500">{t.department ?? 'No department'}</span></td>
                    {data.sources.map((s) => <td key={s.key} className="px-2 py-3 text-center"><Cell state={t.cells[s.key]} required={s.required} label={s.label} last={t.last[s.key]} /></td>)}
                    <td className="min-w-[130px] px-5 py-3"><span className="text-xs tabular-nums text-slate-500">{t.readiness} %</span><Meter value={t.readiness} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {[['Gaps, and how to close them', gaps, 'readiness-gaps'], ['Optional sources not connected', optional, 'readiness-optional']].map(([title, list, id]) => (list as typeof gaps).length > 0 && (
            <Card key={id as string} padded={false} className="mb-6 overflow-x-auto" data-testid={id as string}>
              <h3 className="px-5 pt-5 text-sm font-semibold text-slate-900 dark:text-white">{title as string}</h3>
              <table className="mt-3 w-full min-w-[820px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="px-5 py-2 font-semibold">Team · source</th><th className="px-3 py-2 font-semibold">Blocks</th><th className="px-3 py-2 font-semibold">Fix</th><th className="px-5 py-2 font-semibold">Effort</th></tr></thead>
                <tbody>
                  {(list as typeof gaps).map((g) => (
                    <tr key={g.team + g.source} className="border-t border-slate-100 align-top dark:border-slate-800">
                      <td className="px-5 py-3"><span className="font-semibold text-slate-900 dark:text-white">{g.team}</span><span className="block text-xs text-slate-500">{g.label}{g.state === 'stale' ? ` · nothing since ${dayText(g.lastSeen)}` : ''}</span></td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{g.blocks.join(', ')}</td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{g.fix}{g.seen.map((s) => <span key={s} className="mt-1 block text-xs text-amber-700 dark:text-amber-400">Exporter: {s}</span>)}</td>
                      <td className="px-5 py-3"><Badge>{g.effort}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
          <Card data-testid="readiness-exporter">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="text-sm font-semibold text-slate-900 dark:text-white">QE Navigator Exporter{data.exporter?.version ? ` ${data.exporter.version}` : ''}</h3>
                <p className="mt-0.5 text-xs text-slate-500">{data.exporter ? `Last delivery ${new Date(data.exporter.lastSeen).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC${data.exporter.host ? ` from ${data.exporter.host}` : ''}. It runs in your network with read-only keys.` : 'No delivery from an Exporter yet. Set it up from Admin console → Connect your CI.'}</p></div>
              <Badge tone={data.exporter ? 'good' : 'warn'}>{data.exporter ? 'Connected' : 'Not connected'}</Badge>
            </div>
          </Card>
        </>
      )}
    </Page>
  );
};

export default DataReadiness;
