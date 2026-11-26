import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from './NotificationParts';
import { Badge, Card, CardHeader, EmptyState, buttonClass, cx, inputClass } from './ui';
import { useLoad } from './navigator/parts';

type Group = 'ci' | 'delivery' | 'work' | 'quality' | 'automation' | 'people';
type Cadence = 'continuous' | 'weekly' | 'biweekly' | 'monthly';
interface TeamRow { id: string; name: string; department: string | null; cadence: Cadence | null; intervals: Record<Group, number>; configured: boolean; canEdit: boolean }
interface ScheduleData {
  groups: Array<{ key: Group; label: string; reads: string; feeds: string }>;
  cadences: Array<{ key: Cadence; label: string; hint: string }>;
  recommended: Record<Cadence, Record<Group, number>>;
  defaultMinutes: number; minMinutes: number; maxMinutes: number; teams: TeamRow[]; note: string;
}

/** The intervals offered (minutes). Anything stored that is not in the list is shown as it is. */
const CHOICES = [15, 30, 60, 240, 720, 1440, 10080, 43200];
export function intervalLabel(minutes: number): string {
  if (minutes % 1440 === 0) { const d = minutes / 1440; return d === 1 ? 'Once a day' : d === 7 ? 'Once a week' : d === 30 ? 'Once a month' : `Every ${d} days`; }
  if (minutes % 60 === 0) { const h = minutes / 60; return h === 1 ? 'Every hour' : `Every ${h} hours`; }
  return `Every ${minutes} minutes`;
}

const TeamForm: React.FC<{ team: TeamRow; data: ScheduleData; onSaved: () => void }> = ({ team, data, onSaved }) => {
  // A team that was never set up starts from the recommendation of its cadence (weekly when not known yet).
  const startCadence: Cadence = team.cadence ?? 'weekly';
  const [cadence, setCadence] = useState<Cadence>(startCadence);
  const [intervals, setIntervals] = useState<Record<Group, number>>(team.configured ? team.intervals : data.recommended[startCadence]);
  const [busy, setBusy] = useState(false);
  const recommended = data.recommended[cadence];
  const matches = data.groups.every((g) => intervals[g.key] === recommended[g.key]);
  const pick = (c: Cadence) => { setCadence(c); setIntervals(data.recommended[c]); };
  const save = async () => {
    setBusy(true);
    try {
      await api(`/collection-schedule/teams/${encodeURIComponent(team.id)}`, { method: 'PUT', json: { cadence, intervals } });
      toast.success(`Collection frequency of ${team.name} saved`);
      onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-800" data-testid="collection-form">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600 dark:text-slate-300">How often does this team release?<br />
          <select className={cx(inputClass, 'mt-1')} value={cadence} onChange={(e) => pick(e.target.value as Cadence)} disabled={!team.canEdit} data-testid="collection-cadence">
            {data.cadences.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select></label>
        <span className="pb-2 text-xs text-slate-500">{matches ? 'These are our recommended intervals for that rhythm.' : 'Changed from our recommendation.'}</span>
        {!matches && team.canEdit && <button type="button" className={buttonClass.secondary} onClick={() => setIntervals(recommended)} data-testid="collection-reset">Back to recommended</button>}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.groups.map((g) => {
          const choices = [...new Set([...CHOICES, intervals[g.key]])].sort((a, b) => a - b);
          return (
            <label key={g.key} className="block rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800" title={`Reads ${g.reads}. Feeds ${g.feeds}.`}>
              <span className="font-medium text-slate-900 dark:text-white">{g.label}</span>
              <span className="mt-0.5 block text-xs text-slate-500">Feeds {g.feeds}.</span>
              <select className={cx(inputClass, 'mt-2 w-full')} value={intervals[g.key]} onChange={(e) => setIntervals({ ...intervals, [g.key]: Number(e.target.value) })} disabled={!team.canEdit} aria-label={`${g.label}: how often`} data-testid={`collection-interval-${g.key}`}>
                {choices.map((m) => <option key={m} value={m}>{intervalLabel(m)}{m === recommended[g.key] ? ' (recommended)' : m === data.defaultMinutes ? ' (default)' : ''}</option>)}
              </select>
            </label>
          );
        })}
      </div>
      {team.canEdit
        ? <div className="mt-3"><button type="button" className={buttonClass.primary} disabled={busy} onClick={save} data-testid="collection-save">{team.configured ? 'Save changes' : 'Use these intervals'}</button></div>
        : <p className="mt-3 text-xs text-slate-500">Only the team’s leads, its department’s managers and administrators can change this.</p>}
    </div>
  );
};

/**
 * Collection frequency: per team, how often the Exporter reads each kind of data. Pre-filled with the
 * recommendation for the team's release rhythm; every value can be changed, at setup and at any time later.
 */
const CollectionSchedule: React.FC = () => {
  const { data, error, reload } = useLoad<ScheduleData>('/collection-schedule');
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return <Card className="mb-6"><p className={cx('text-sm', error ? 'text-red-700' : 'text-slate-500')}>{error ?? 'Loading the collection frequency…'}</p></Card>;
  const set = data.teams.filter((t) => t.configured).length;
  return (
    <Card padded={false} className="mb-6" data-testid="collection-schedule">
      <div className="px-5 pt-5">
        <CardHeader
          title="How often data is collected"
          subtitle={`Per team. ${set} of ${data.teams.length} ${data.teams.length === 1 ? 'team has' : 'teams have'} their own schedule; the others are read ${intervalLabel(data.defaultMinutes).toLowerCase()} (the default).`}
        />
        <p className="-mt-2 mb-4 max-w-3xl text-xs text-slate-500">A team that releases once a month does not need its pipelines read every 15 minutes. Say how often the team releases and we pre-fill the intervals we recommend; change any of them now or later. {data.note}</p>
      </div>
      {data.teams.length === 0 ? <div className="px-5 pb-5"><EmptyState title="No team in your scope" /></div> : (
        <ul>
          {data.teams.map((t) => (
            <li key={t.id} className="border-t border-slate-100 dark:border-slate-800" data-testid="collection-team">
              <button type="button" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <span><span className="font-medium text-slate-900 dark:text-white">{t.name}</span><span className="ml-2 text-xs text-slate-500">{t.department ?? 'No department'}</span></span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  {t.configured
                    ? <><Badge tone="good">{data.cadences.find((c) => c.key === t.cadence)?.label ?? 'Own schedule'}</Badge><span>Pipelines {intervalLabel(t.intervals.ci).toLowerCase()} · issues {intervalLabel(t.intervals.work).toLowerCase()}</span></>
                    : <Badge tone="warn">Default: everything {intervalLabel(data.defaultMinutes).toLowerCase()}</Badge>}
                </span>
              </button>
              {open === t.id && <TeamForm team={t} data={data} onSaved={reload} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

export default CollectionSchedule;
