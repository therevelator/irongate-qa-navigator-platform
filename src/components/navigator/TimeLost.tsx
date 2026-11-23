import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, Page, PageIntro, buttonClass, cx } from '../ui';
import { AboutPage, CAUSE_COLOR, CauseBar, Loading, Meter, Spark, StateBadge, dayText, hoursText, openPage, useLoad, type CauseRow, type Week } from './parts';

interface Status {
  available: boolean; companyName: string | null; weeks: Week[]; hoursNow: number | null; hoursBefore: number | null; period: { from: string; to: string } | null;
  causes: CauseRow[];
  teams: Array<{
    id: string; name: string; department: string | null; state: string; readiness: number; hoursNow: number | null; hoursBefore: number | null; trend: number[]; findings: number;
    focus: { id: string; title: string; hours: number | null; owner: string | null; dueDate: string | null; status: string } | null;
  }>;
  unowned: { count: number; hours: number };
  verified: Array<{ id: string; title: string; teamName: string; owner: string | null; metric: string | null; unit: string | null; before: number | null; after: number | null; completedAt: string | null }>;
  verifiedCount: number; waitingCount: number;
}

const delta = (now: number, before: number) => Math.round((now - before) * 10) / 10;

/**
 * Company status in one unit: hours lost per week, what causes them, how the figure moved in 12 weeks, and each
 * team's state with its one thing this week. The classic KPI dashboard stays on Overview.
 */
const TimeLost: React.FC<{ onNavigate: (view: string) => void }> = ({ onNavigate }) => {
  const { data, error, loading } = useLoad<Status>('/navigator/status');
  if (loading || !data) return <Page><Loading error={error} /></Page>;
  const d = data;
  const has = d.hoursNow !== null && d.weeks.length > 0;
  const change = has ? delta(d.hoursNow!, d.hoursBefore ?? 0) : 0;
  const improving = d.teams.filter((t) => t.state === 'improving').length;
  const slipping = d.teams.filter((t) => t.state === 'slipping').length;
  return (
    <Page>
      <PageIntro
        title={has ? `${hoursText(d.hoursNow)} a week are lost to problems we can name` : 'Time lost'}
        description={has ? `${improving} ${improving === 1 ? 'team is' : 'teams are'} improving, ${slipping} ${slipping === 1 ? 'is' : 'are'} slipping. ${d.unowned.count} ${d.unowned.count === 1 ? 'finding' : 'findings'} worth ${hoursText(d.unowned.hours)} a week ${d.unowned.count === 1 ? 'has' : 'have'} no owner yet.` : 'Hours lost per week, calculated from pipeline runs, deployments, issues and pull requests.'}
        actions={<button type="button" className={buttonClass.primary} onClick={() => onNavigate('findings')} data-testid="time-lost-findings">See what we found <ArrowRight size={15} aria-hidden /></button>}
      />
      <AboutPage
        does="The company on one page: hours a week that go to waiting and rework, what causes them, how the figure moved in 12 weeks, and what each team should do next."
        goodFor="Reading in two minutes where to push this week. It puts one number, its causes and an owner in front of the KPI dashboard, which stays on Overview."
        from="Calculated from the records the Exporter reads: pipeline runs and stages, deployments and incidents, issue status history, pull requests. Hours are measured, not estimated, and not a money figure."
      />
      {!has ? (
        <Card><EmptyState title="No hours to show yet" description={d.available ? 'No team in your scope has sent pipeline runs, deployments or issues in the last 12 weeks. See Data readiness for what to connect.' : 'This installation has not been migrated yet (migration 20261210000000).'} /></Card>
      ) : (
        <>
          <Card className="mb-6 grid gap-6 lg:grid-cols-[1.25fr_1fr]" data-testid="time-lost-hero">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-800 dark:text-brand-300">Hours lost, last 7 days</p>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <span className="text-5xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-white" data-testid="time-lost-now">{Math.round(d.hoursNow! * 10) / 10}</span>
                <span className="pb-1.5 text-sm text-slate-500">hours</span>
                <Badge tone={change < 0 ? 'good' : change > 0 ? 'bad' : 'neutral'}>{change === 0 ? 'same as' : `${Math.abs(change)} h ${change < 0 ? 'fewer' : 'more'} than`} 12 weeks ago</Badge>
              </div>
              <div className="mt-3"><Spark data={d.weeks.map((w) => w.total)} width={440} height={64} tone={change > 0 ? 'bad' : 'brand'} /></div>
              <p className="mb-3 mt-1 text-xs text-slate-500">Each point is one week, {dayText(d.period?.from)} to {dayText(d.period?.to)}.</p>
              <CauseBar causes={d.causes} />
            </div>
            <div className="min-w-0 lg:border-l lg:border-slate-200 lg:pl-6 dark:lg:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Where the hours go, and how they moved</h3>
              <table className="mt-3 w-full text-sm" data-testid="time-lost-causes">
                <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="pb-1 font-semibold">Cause</th><th className="pb-1 pl-3 text-right font-semibold">12 weeks ago</th><th className="pb-1 pl-3 text-right font-semibold">Now</th><th className="pb-1 pl-3 text-right font-semibold">Change</th></tr></thead>
                <tbody>
                  {d.causes.map((c) => {
                    const x = delta(c.now, c.before);
                    return (
                      <tr key={c.key} className="border-t border-slate-100 dark:border-slate-800" title={c.rule}>
                        <td className="py-1.5"><span className={cx('mr-2 inline-block h-2.5 w-2.5 rounded-sm', CAUSE_COLOR[c.key])} />{c.label}</td>
                        <td className="py-1.5 pl-3 text-right tabular-nums text-slate-500">{hoursText(c.before)}</td>
                        <td className="py-1.5 pl-3 text-right font-medium tabular-nums">{hoursText(c.now)}</td>
                        <td className={cx('py-1.5 pl-3 text-right tabular-nums', x < 0 ? 'text-green-700 dark:text-green-400' : x > 0 ? 'text-red-700 dark:text-red-400' : 'text-slate-400')}>{x > 0 ? '+' : ''}{x === 0 ? '0' : x} h</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-slate-200 font-semibold dark:border-slate-700">
                    <td className="py-1.5">Total</td><td className="py-1.5 pl-3 text-right tabular-nums">{hoursText(d.hoursBefore)}</td><td className="py-1.5 pl-3 text-right tabular-nums">{hoursText(d.hoursNow)}</td>
                    <td className={cx('py-1.5 pl-3 text-right tabular-nums', change < 0 ? 'text-green-700 dark:text-green-400' : change > 0 ? 'text-red-700 dark:text-red-400' : '')}>{change > 0 ? '+' : ''}{change} h</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-3 text-xs text-slate-500">Hover a cause for its rule. To turn hours into money, multiply by your own hourly cost.</p>
            </div>
          </Card>

          <Card padded={false} className="mb-6" data-testid="time-lost-teams">
            <div className="flex items-center justify-between px-5 pt-5"><h3 className="text-sm font-semibold text-slate-900 dark:text-white">Teams: where each one stands, and its one thing this week</h3><span className="text-xs text-slate-500">Worst first</span></div>
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {d.teams.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => openPage(onNavigate, 'findings', t.id)} className="grid w-full gap-3 px-5 py-4 text-left hover:bg-slate-50 lg:grid-cols-[1.1fr_170px_1.4fr_150px] lg:items-center dark:hover:bg-slate-800/40" data-testid="time-lost-team">
                    <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900 dark:text-white">{t.name}</span><StateBadge state={t.state} /></span>
                      <span className="mt-0.5 block text-xs text-slate-500">{t.department ?? 'No department'} · {t.findings} {t.findings === 1 ? 'finding' : 'findings'}</span></span>
                    <span>{t.hoursNow === null ? <span className="text-xs text-slate-500">not measurable</span> : <><span className="text-sm tabular-nums"><b>{hoursText(t.hoursNow)}</b> <span className="text-slate-500">/ week</span></span><Spark data={t.trend} width={110} height={24} tone={t.state === 'slipping' ? 'bad' : t.state === 'improving' ? 'good' : 'neutral'} /></>}</span>
                    <span className="min-w-0 text-sm">
                      <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">This week</span>
                      {t.focus ? <><span className="block font-medium text-slate-900 dark:text-white">{t.focus.title}</span>
                        <span className="block text-xs text-slate-500">{t.focus.owner ? `${t.focus.owner}${t.focus.dueDate ? `, due ${dayText(t.focus.dueDate)}` : ''}` : 'No owner yet'}{t.focus.hours !== null ? ` · about ${hoursText(t.focus.hours)} a week` : ''}</span></>
                        : <span className="block text-slate-500">{t.readiness < 100 ? 'Connect the missing sources (Data readiness)' : 'Nothing found this week'}</span>}
                    </span>
                    <span><span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Data readiness {t.readiness} %</span><span className="mt-1 block"><Meter value={t.readiness} /></span></span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card data-testid="time-lost-verified">
              <CardHeader title="Fixes the numbers confirmed" subtitle={`${d.verifiedCount} verified in the last 90 days · ${d.waitingCount} waiting for a verdict`} action={<button type="button" className="text-xs font-medium text-brand-700 underline dark:text-brand-300" onClick={() => onNavigate('outcomes')}>All outcomes</button>} />
              {d.verified.length === 0 ? <p className="text-sm text-slate-500">None yet. A fix is verified when its KPI is better 14 or 30 days after the action was done.</p> : (
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {d.verified.map((v) => (
                    <li key={v.id} className="py-2.5"><span className="font-medium text-slate-900 dark:text-white">{v.title}</span>
                      <span className="block text-xs text-slate-500">{v.teamName}{v.metric ? ` · ${v.metric} ${v.before ?? '—'} → ${v.after ?? '—'}${v.unit ? ` ${v.unit}` : ''}` : ''}{v.owner ? ` · ${v.owner}` : ''}</span></li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="The rest of the picture" />
              <ul className="space-y-2 text-sm">
                {[['dashboard', 'Overview', 'the KPI dashboard: QA score, DORA metrics, targets'], ['summary', 'Executive summary', 'risks, forecasts and money on one phone screen'], ['data-readiness', 'Data readiness', 'what each team sends and what is missing'], ['outcomes', 'Outcomes', 'every action from suggested to verified, and the monthly report']].map(([view, label, text]) => (
                  <li key={view}><button type="button" className="font-medium text-brand-700 underline dark:text-brand-300" onClick={() => onNavigate(view)}>{label}</button> <span className="text-slate-500">{text}</span></li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </Page>
  );
};

export default TimeLost;
