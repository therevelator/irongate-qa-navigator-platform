import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Copy, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../NotificationParts';
import { Badge, Card, EmptyState, Page, PageIntro, buttonClass, cx, inputClass } from '../ui';
import { AboutPage, CauseTag, Loading, Spark, dayText, hoursText, teamFromUrl, useLoad, type Finding } from './parts';

interface FindingsData { findings: Finding[]; hoursExplained: number; hoursTotal: number; teams: Array<{ id: string; name: string }> }

const ACTION_STATUS: Record<string, string> = { open: 'Owned', in_progress: 'In progress', done: 'Done', dropped: 'Dropped' };

/** The finding as text for a ticket: the team does the fix in its own tools. */
export function ticketText(f: Finding): string {
  return [
    `${f.title} (${f.teamName})`, '',
    `What we see: ${f.summary}`, '',
    ...(f.evidence.length ? ['Evidence:', ...f.evidence.map((e) => `  - ${e.label}: ${e.value}${e.detail ? ` (${e.detail})` : ''}`), ''] : []),
    ...(f.items.length ? ['Records:', ...f.items.map((i) => `  - ${i.name}: ${i.detail}`), ''] : []),
    ...(f.since ? [`Since: ${f.since}`, ''] : []),
    `Suggested next step: ${f.nextStep}`,
    ...(f.expected ? [`Expected effect: ${f.expected}`] : []),
    ...(f.hours !== null ? [`Cost now: about ${f.hours} hours a week${f.formula ? ` (${f.formula})` : ''}`] : []),
    '', 'Source: QE Navigator.',
  ].join('\n');
}

const Assign: React.FC<{ f: Finding; onDone: () => void }> = ({ f, onDone }) => {
  const [owners, setOwners] = useState<Array<{ id: string; name: string }> | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState('');
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ owners: Array<{ id: string; name: string }> }>(`/actions/owners?teamId=${encodeURIComponent(f.teamId)}`)
      .then((r) => { setOwners(r.owners); setOwnerId(r.owners[0]?.id ?? ''); })
      .catch((e) => setDenied((e as Error).message));
  }, [f.teamId]);
  if (denied) return <p className="text-xs text-slate-500" data-testid="finding-assign-denied">{denied}</p>;
  if (!owners) return <p className="text-xs text-slate-500">Loading the possible owners…</p>;
  const save = async () => {
    setBusy(true);
    try {
      if (f.recommendationId) await api(`/improve/recommendations/${f.recommendationId}/accept`, { method: 'POST', json: { ownerId: ownerId || null, dueDate } });
      else await api('/actions', { method: 'POST', json: { teamId: f.teamId, title: f.title, description: `${f.summary}\n\nNext step: ${f.nextStep}`, ownerId: ownerId || null, dueDate, metricKey: f.metricKey } });
      toast.success('Owner assigned. The action is in the team’s Action plan.');
      onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="finding-assign">
      <label className="text-xs text-slate-600 dark:text-slate-300">Owner<br />
        <select className={cx(inputClass, 'mt-1')} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} aria-label="Owner">
          <option value="">Unassigned</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select></label>
      <label className="text-xs text-slate-600 dark:text-slate-300">Due<br /><input type="date" className={cx(inputClass, 'mt-1')} value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" /></label>
      <button type="button" className={buttonClass.primary} disabled={busy} onClick={save} data-testid="finding-assign-save"><UserPlus size={15} aria-hidden /> Assign owner</button>
    </div>
  );
};

const FindingCard: React.FC<{ f: Finding; rank: number; open: boolean; onToggle: () => void; onChanged: () => void }> = ({ f, rank, open, onToggle, onChanged }) => {
  const copy = async () => {
    try { await navigator.clipboard.writeText(ticketText(f)); toast.success('Ticket text copied'); } catch { toast.error('Select the text and copy it'); }
  };
  return (
    <Card padded={false} data-testid="finding">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-4 px-5 py-4 text-left">
        <span className="w-6 pt-0.5 text-xl font-semibold tabular-nums text-slate-400">{rank}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2"><CauseTag cause={f.cause} label={f.causeLabel} /><span className="text-xs text-slate-500">{f.teamName}</span>
            {f.action ? <Badge tone="brand">{ACTION_STATUS[f.action.status] ?? f.action.status}{f.action.owner ? ` · ${f.action.owner}` : ''}</Badge> : <Badge tone="warn">No owner</Badge>}</span>
          <span className="mt-1.5 block font-semibold text-slate-900 dark:text-white" data-testid="finding-title">{f.title}</span>
          <span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">{f.summary}</span>
          <span className="mt-1.5 block text-sm"><b>Next step:</b> {f.nextStep}</span>
        </span>
        <span className="shrink-0 text-right">
          {f.hours !== null ? <><span className="block text-2xl font-semibold tabular-nums text-slate-900 dark:text-white" data-testid="finding-hours">{f.hours}</span><span className="block text-xs text-slate-500">h / week</span></> : <span className="block text-xs text-slate-500">not in hours</span>}
          <ChevronDown size={16} aria-hidden className={cx('ml-auto mt-2 text-slate-400 transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      {open && (
        <div className="grid gap-6 border-t border-slate-100 px-5 py-5 lg:grid-cols-2 dark:border-slate-800" data-testid="finding-detail">
          <div className="min-w-0 space-y-4">
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Evidence</h4>
              <ul className="mt-1.5 space-y-1 text-sm">{f.evidence.map((e, i) => <li key={i}><span className="text-slate-500">{e.label}:</span> <b>{e.value}</b>{e.detail ? <span className="text-slate-500"> ({e.detail})</span> : null}</li>)}</ul>
            </div>
            {f.items.length > 0 && (
              <div className="overflow-x-auto">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">The records behind it</h4>
                <table className="mt-1.5 w-full text-sm"><tbody>
                  {f.items.map((i, k) => <tr key={k} className="border-t border-slate-100 dark:border-slate-800"><td className="py-1.5 pr-3 font-medium">{i.url ? <a className="underline" href={i.url} target="_blank" rel="noreferrer">{i.name}</a> : i.name}</td><td className="py-1.5 text-slate-600 dark:text-slate-300">{i.detail}</td></tr>)}
                </tbody></table>
              </div>
            )}
            {f.trend.length > 1 && <div><h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Hours a week from this cause, last 12 weeks{f.since ? ` · slow since ${dayText(f.since)}` : ''}</h4><div className="mt-1.5"><Spark data={f.trend} width={360} height={56} /></div></div>}
            <p className="text-xs text-slate-500">Confidence {f.confidence}: {f.confidenceWhy}{f.formula ? ` Hours are counted as: ${f.formula}.` : ''}</p>
          </div>
          <div className="min-w-0 space-y-4">
            <div><h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Owner</h4>
              <div className="mt-1.5">{f.action ? <p className="text-sm" data-testid="finding-owner"><b>{f.action.owner ?? 'Unassigned'}</b>{f.action.dueDate ? `, due ${dayText(f.action.dueDate)}` : ''} · {ACTION_STATUS[f.action.status] ?? f.action.status}. The verdict comes from the KPI 14 and 30 days after it is done.</p> : <Assign f={f} onDone={onChanged} />}</div></div>
            {f.expected && <p className="text-sm"><b>Expected effect:</b> {f.expected}</p>}
            <div>
              <div className="flex items-center justify-between"><h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">As a ticket</h4><button type="button" className={buttonClass.secondary} onClick={copy} data-testid="finding-copy"><Copy size={14} aria-hidden /> Copy</button></div>
              <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">{ticketText(f)}</pre>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};

/**
 * What we found: the problems behind the hours, the costliest first; for one team, its one thing this week. Giving a
 * finding an owner makes it a tracked action; the team does the fix in its own tools.
 */
const Findings: React.FC = () => {
  const { data, error, loading, reload } = useLoad<FindingsData>('/navigator/findings');
  const [team, setTeam] = useState<string>(() => teamFromUrl() ?? '');
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => (data?.findings ?? []).filter((f) => !team || f.teamId === team), [data, team]);
  if (loading && !data) return <Page><Loading error={error} /></Page>;
  if (!data) return <Page><Loading error={error} /></Page>;
  const explained = Math.round(list.reduce((n, f) => n + (f.hours ?? 0), 0) * 10) / 10;
  const focus = team ? list.find((f) => f.hours !== null) ?? list[0] : null;
  return (
    <Page>
      <PageIntro
        title={list.length ? `${list.length} ${list.length === 1 ? 'finding' : 'findings'}${explained ? ` explain ${hoursText(explained)} lost each week` : ''}` : 'What we found'}
        description="Ranked by the hours they cost. Each one names its evidence and a next step; the team decides who takes it."
        actions={<select className={inputClass} value={team} onChange={(e) => { setTeam(e.target.value); setOpen(null); }} aria-label="Team" data-testid="findings-team">
          <option value="">All teams</option>{data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
      />
      <AboutPage
        does="Lists the concrete problems found in the records, the costliest first: what happened, since when, how many hours a week it costs, how sure we are and what to do next."
        goodFor="Knowing what to take into the sprint without an investigation. Pick a team to see its one thing this week; open a finding to check the records, give it an owner or copy it as a ticket."
        from="Two kinds of finding: a cause of lost hours with the records behind it, and the team's recommendations from its KPI history. Rules over records; no language model writes them."
      />
      {focus && (
        <Card className="mb-6" data-testid="one-thing">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-800 dark:text-brand-300">The one thing this week · {focus.teamName}</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{focus.action?.title ?? focus.title}</h3>
          <ol className="mt-4 grid gap-4 text-sm md:grid-cols-5">
            {[
              ['Finding', focus.title, focus.hours !== null ? `${hoursText(focus.hours)} a week` : null, true],
              ['Evidence', focus.evidence[0] ? `${focus.evidence[0].label}: ${focus.evidence[0].value}` : 'See the records below', focus.evidence[0]?.detail ?? null, true],
              ['Next step', focus.nextStep, focus.expected, true],
              ['Owner', focus.action?.owner ?? 'Nobody yet', focus.action?.dueDate ? `due ${dayText(focus.action.dueDate)}` : focus.action ? null : 'Open the finding below to assign it', !!focus.action],
              ['Verdict', focus.action ? (ACTION_STATUS[focus.action.status] ?? focus.action.status) : 'Not started', 'The KPI decides, 14 and 30 days after it is done', !!focus.action],
            ].map(([k, main, sub, on], i) => (
              <li key={String(k)} className={cx('md:border-l md:border-slate-200 md:pl-4 md:first:border-l-0 md:first:pl-0 dark:md:border-slate-800', !on && 'opacity-60')}>
                <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-100 text-[10px] text-brand-800 dark:bg-brand-950 dark:text-brand-300">{i + 1}</span>{k}</span>
                <span className="mt-1 block font-medium text-slate-900 dark:text-white">{main}</span>
                {sub && <span className="mt-0.5 block text-xs text-slate-500">{sub}</span>}
              </li>
            ))}
          </ol>
        </Card>
      )}
      {list.length === 0 ? <Card><EmptyState title="Nothing found" description="No cause costs this scope half an hour a week or more, and there is no open recommendation. Check Data readiness if that looks too good." /></Card> : (
        <div className="space-y-3">{list.map((f, i) => <FindingCard key={f.id} f={f} rank={i + 1} open={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} onChanged={reload} />)}</div>
      )}
    </Page>
  );
};

export default Findings;
