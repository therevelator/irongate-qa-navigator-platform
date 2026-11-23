import React, { useState } from 'react';
import { Printer } from 'lucide-react';
import { Badge, Card, Page, PageIntro, buttonClass, cx, inputClass, type Tone } from '../ui';
import { AboutPage, CauseTag, Loading, dayText, hoursText, openPage, useLoad, type CauseRow, type Finding, type Week } from './parts';

interface ActionCard {
  id: string; teamId: string; teamName: string; title: string; owner: string | null; dueDate: string | null; overdue: boolean; status: string;
  metric: { key: string; label: string; unit: string; lowerIsBetter: boolean } | null; baseline: number | null; current: number | null; completedAt: string | null;
  outcomes: Array<{ checkpoint: string; label: string; value: number | null; outcome: string }>;
}
interface OutcomesData {
  month: string | null; suggested: Finding[]; owned: ActionCard[]; waiting: ActionCard[]; verified: ActionCard[]; notHeld: ActionCard[];
  weeks: Week[]; causes: CauseRow[]; verdictRule: string;
}

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  improved: { label: 'improved', tone: 'good' }, unchanged: { label: 'unchanged', tone: 'neutral' }, worse: { label: 'worse', tone: 'bad' }, no_data: { label: 'no new data', tone: 'warn' }, pending: { label: 'pending', tone: 'neutral' },
};

const Ticket: React.FC<{ a: ActionCard }> = ({ a }) => (
  <li className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900" data-testid="outcome-action">
    <span className="block text-xs text-slate-500">{a.teamName}</span>
    <span className="mt-0.5 block font-semibold text-slate-900 dark:text-white">{a.title}</span>
    {a.metric && <span className="mt-1 block tabular-nums text-slate-700 dark:text-slate-300">{a.metric.label}: {a.baseline ?? '—'}{a.current !== null ? ` → ${a.current}` : ''} {a.metric.unit}</span>}
    <span className="mt-1 block text-xs text-slate-500">{a.owner ?? 'Unassigned'}{a.status !== 'done' && a.dueDate ? ` · due ${dayText(a.dueDate)}` : ''}{a.overdue ? ' · overdue' : ''}{a.completedAt ? ` · done ${dayText(a.completedAt)}` : ''}</span>
    {a.outcomes.length > 0 && <span className="mt-2 flex flex-wrap gap-1">{a.outcomes.map((o) => <Badge key={o.checkpoint} tone={OUTCOME[o.outcome]?.tone ?? 'neutral'}>{o.label}: {OUTCOME[o.outcome]?.label ?? o.outcome}</Badge>)}</span>}
    {!a.metric && a.status === 'done' && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">No KPI linked: there is nothing to judge it by.</span>}
  </li>
);

const Column: React.FC<{ title: string; hint: string; count: number; children: React.ReactNode; testId: string }> = ({ title, hint, count, children, testId }) => (
  <section className="min-w-0" aria-label={title} data-testid={testId}>
    <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500"><span>{title}</span><span>{count}</span></div>
    <p className="mb-2 mt-0.5 text-xs text-slate-500 print:hidden">{hint}</p>
    <ul className="space-y-2">{children}</ul>
    {count === 0 && <p className="text-xs text-slate-400">Nothing here.</p>}
  </section>
);

/**
 * Outcomes: every finding from suggested to proven. The last two columns are decided by the KPI, not by a person.
 * With a month selected and printed, it is the monthly outcomes report.
 */
const Outcomes: React.FC<{ onNavigate: (view: string) => void }> = ({ onNavigate }) => {
  const [month, setMonth] = useState('');
  const { data, error, loading } = useLoad<OutcomesData>(`/navigator/outcomes${month ? `?month=${month}` : ''}`);
  if (!data) return <Page><Loading error={loading ? null : error} /></Page>;
  const d = data;
  const months = Array.from({ length: 6 }, (_, i) => { const x = new Date(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() - i); return x.toISOString().slice(0, 7); });
  const now = d.weeks[d.weeks.length - 1]?.total ?? null;
  const before = d.weeks[0]?.total ?? null;
  const open = d.suggested.filter((f) => f.hours !== null).reduce((n, f) => n + (f.hours ?? 0), 0);
  return (
    <Page>
      <PageIntro
        title={`${d.verified.length} ${d.verified.length === 1 ? 'fix' : 'fixes'} confirmed by the numbers${month ? ` in ${month}` : ''}`}
        description={`${d.waiting.length} waiting for a verdict, ${d.notHeld.length} did not hold, ${d.owned.length} in progress, ${d.suggested.length} without an owner${open ? ` (worth ${hoursText(Math.round(open * 10) / 10)} a week)` : ''}.`}
        actions={<><select className={cx(inputClass, 'print:hidden')} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Period" data-testid="outcomes-month">
          <option value="">Last 120 days</option>{months.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <button type="button" className={cx(buttonClass.secondary, 'print:hidden')} onClick={() => window.print()} data-testid="outcomes-print"><Printer size={15} aria-hidden /> Print report</button></>}
      />
      <AboutPage
        does="Follows each finding from suggested to proven: who owns it, when it was done, and whether its KPI confirmed the fix. Pick a month and print it for the monthly outcomes report."
        goodFor="Answering “what did we get for this?” without slides, and seeing honestly which fixes did not hold."
        from={d.verdictRule}
      />
      {now !== null && (
        <Card className="mb-6" data-testid="outcomes-hours">
          <div className="grid gap-4 sm:grid-cols-3">
            <div><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Hours lost, last 7 days</p><p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900 dark:text-white">{hoursText(now)}</p><p className="text-xs text-slate-500">12 weeks ago: {hoursText(before)}</p></div>
            <div className="sm:col-span-2"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">By cause, 12 weeks ago → now</p>
              <ul className="mt-1 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">{d.causes.map((c) => <li key={c.key} className="flex justify-between gap-3"><span>{c.label}</span><span className="tabular-nums text-slate-600 dark:text-slate-300">{hoursText(c.before)} → <b>{hoursText(c.now)}</b></span></li>)}</ul></div>
          </div>
        </Card>
      )}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5 print:grid-cols-2" data-testid="outcomes-board">
        <Column title="Suggested" hint="Found. Needs an owner." count={d.suggested.length} testId="outcomes-suggested">
          {d.suggested.slice(0, 12).map((f) => (
            <li key={f.id}><button type="button" onClick={() => openPage(onNavigate, 'findings', f.teamId)} className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left text-sm hover:border-brand-500 dark:border-slate-800 dark:bg-slate-900">
              <span className="flex items-center justify-between gap-2"><CauseTag cause={f.cause} label={f.causeLabel} />{f.hours !== null && <b className="tabular-nums">{hoursText(f.hours)}</b>}</span>
              <span className="mt-1 block text-xs text-slate-500">{f.teamName}</span><span className="block font-semibold text-slate-900 dark:text-white">{f.title}</span></button></li>
          ))}
          {d.suggested.length > 12 && <li className="text-xs text-slate-500">and {d.suggested.length - 12} more on Findings</li>}
        </Column>
        <Column title="Owned" hint="Someone took it." count={d.owned.length} testId="outcomes-owned">{d.owned.map((a) => <Ticket key={a.id} a={a} />)}</Column>
        <Column title="Waiting for verdict" hint="Done. The KPI is being watched." count={d.waiting.length} testId="outcomes-waiting">{d.waiting.map((a) => <Ticket key={a.id} a={a} />)}</Column>
        <Column title="Verified" hint="The KPI improved and held." count={d.verified.length} testId="outcomes-verified">{d.verified.map((a) => <Ticket key={a.id} a={a} />)}</Column>
        <Column title="Did not hold" hint="Unchanged or worse at the checkpoint." count={d.notHeld.length} testId="outcomes-not-held">{d.notHeld.map((a) => <Ticket key={a.id} a={a} />)}</Column>
      </div>
    </Page>
  );
};

export default Outcomes;
