import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import Modal from '../Modal';
import { buttonClass, cx, inputClass } from '../ui';
import { opFetch } from '../../lib/operatorClient';
import { ErrorText } from './OperatorBits';

/**
 * Platform operator panel: "Demo Data" (departments, Scrum teams, people and a year of sample data)
 * and "Populate metrics" (a year of sample data for the company's teams that lack it). The server
 * creates the people at once and fills the data in a job (a background function on Netlify); this
 * dialog polls the job. The shared password of the new people is shown once, when the job is done.
 */

export type DemoMode = 'generate' | 'populate';

interface Job { id: string; status: 'queued' | 'running' | 'done' | 'failed'; step: string | null; done: number; total: number; result: any; error: string | null }
interface Created {
  password: string; domain: string; people: number;
  departments: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string; department: string; story: string }>;
  logins: Array<{ role: string; label: string; name: string; email: string; title: string }>;
}

const LIMITS = { departments: [1, 10], teamsPerDepartment: [1, 8], membersPerTeam: [3, 12] } as const;
const STORY_LABEL: Record<string, string> = { strong: 'steady, strong', struggling: 'struggling', improving: 'improving', recovering: 'dip and recovery', declining: 'declining' };
const enc = encodeURIComponent;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The preview line: members of every team plus one manager per department. */
export function demoPreview(d: number, t: number, m: number): string {
  return `Creates ${plural(d, 'department')}, ${plural(d * t, 'team')}, ${plural(d * (1 + t * m), 'person', 'people')} and one year of data`;
}

const CopyButton: React.FC<{ text: string; testId: string; label: string }> = ({ text, testId, label }) => {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} data-testid={testId} aria-label={label}
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined); }}>
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} <span className="ml-1">{done ? 'Copied' : 'Copy'}</span>
    </button>
  );
};

const PasswordBox: React.FC<{ password: string }> = ({ password }) => (
  <div className="flex items-center gap-2">
    <code className="flex-1 break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" data-testid="op-demo-password">{password}</code>
    <CopyButton text={password} testId="op-demo-copy" label="Copy the password" />
  </div>
);

export const DemoDataDialog: React.FC<{
  mode: DemoMode | null; companyId: string; companyName: string; onClose: () => void; onChanged: () => void;
}> = ({ mode, companyId, companyName, onClose, onChanged }) => {
  const [size, setSize] = useState({ departments: '3', teamsPerDepartment: '3', membersPerTeam: '6' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const timer = useRef<number | null>(null);
  const base = `/companies/${enc(companyId)}`;

  useEffect(() => {
    setBusy(false); setError(null); setCreated(null); setJob(null);
    setSize({ departments: '3', teamsPerDepartment: '3', membersPerTeam: '6' });
  }, [mode]);

  // Poll the job every 2 seconds until it is done or failed.
  const jobId = job?.id;
  const active = job && (job.status === 'queued' || job.status === 'running');
  useEffect(() => {
    if (!jobId || !active) return;
    timer.current = window.setTimeout(async () => {
      try {
        const r = await opFetch<{ job: Job }>(`${base}/demo-data/jobs/${enc(jobId)}`);
        setJob(r.job);
        if (r.job.status === 'done' || r.job.status === 'failed') onChanged();
      } catch (e: any) {
        setError(e.message);
      }
    }, 2000);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [jobId, active, job, base, onChanged]);

  if (!mode) return <Modal isOpen={false} onClose={onClose} title="">{null}</Modal>;

  const num = (k: keyof typeof size) => Number(size[k]);
  const valid = (Object.keys(LIMITS) as Array<keyof typeof LIMITS>).every((k) => Number.isInteger(num(k)) && num(k) >= LIMITS[k][0] && num(k) <= LIMITS[k][1]);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'generate') {
        const r = await opFetch<Created & { job: Job }>(`${base}/demo-data`, {
          method: 'POST', body: { departments: num('departments'), teamsPerDepartment: num('teamsPerDepartment'), membersPerTeam: num('membersPerTeam') },
        });
        setCreated(r);
        setJob(r.job);
      } else {
        const r = await opFetch<{ job: Job }>(`${base}/populate-metrics`, { method: 'POST' });
        setJob(r.job);
      }
      onChanged();
    } catch (e: any) {
      setError(`${e.message}${e.requestId ? ` (request id ${e.requestId})` : ''}`);
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'generate' ? `Demo Data for ${companyName}` : `Populate metrics of ${companyName}`;
  const lbl = 'mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400';
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;
  const rows = job?.result?.rowsWritten?.toLocaleString?.('en-US') ?? '0';

  return (
    <Modal isOpen onClose={onClose} title={title} size="md">
      <div className="space-y-4" data-testid="op-demo-dialog">
        {!job && mode === 'generate' && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) start(); }} data-testid="op-demo-form">
            <p className="text-sm text-slate-700 dark:text-slate-200">
              Adds departments with a manager and Scrum teams (a Product Owner, a Scrum Master and developers) with realistic names, job titles
              and e-mail addresses on the company's domain, and fills one year of sample data in every module for the new teams. Existing
              departments, teams and people are not changed. Everyone gets one shared password, shown once at the end.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {([['departments', 'Departments'], ['teamsPerDepartment', 'Teams per department'], ['membersPerTeam', 'Members per team']] as Array<[keyof typeof size, string]>).map(([k, label]) => (
                <div key={k}>
                  <label htmlFor={`op-demo-${k}`} className={lbl}>{label} ({LIMITS[k][0]}–{LIMITS[k][1]})</label>
                  <input id={`op-demo-${k}`} type="number" inputMode="numeric" min={LIMITS[k][0]} max={LIMITS[k][1]} step={1} value={size[k]}
                    onChange={(e) => setSize((s) => ({ ...s, [k]: e.target.value }))} className={cx(inputClass, 'w-full')} data-testid={`op-demo-${k}`} />
                </div>
              ))}
            </div>
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 dark:bg-slate-800/60 dark:text-slate-100" data-testid="op-demo-preview" aria-live="polite">
              {valid ? `${demoPreview(num('departments'), num('teamsPerDepartment'), num('membersPerTeam'))}.` : 'Enter whole numbers within the ranges shown.'}
            </p>
            <ErrorText error={error} />
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
              <button type="submit" className={buttonClass.primary} disabled={!valid || busy} data-testid="op-demo-submit">{busy ? 'Creating…' : 'Generate'}</button>
            </div>
          </form>
        )}

        {!job && mode === 'populate' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-700 dark:text-slate-200">
              Fills one year of sample data in every module (KPIs, pipelines, tests, technical debt, DORA, performance, developer
              productivity, sprints, wellbeing pulse, actions, alerts, business impact, targets, ingestion log) for every team of this company
              that has no data there yet. Nobody is created: a team without a team lead or software engineer is skipped. Existing data is
              never changed; the nightly refresh keeps the sample data current.
            </p>
            <ErrorText error={error} />
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
              <button type="button" className={buttonClass.primary} disabled={busy} onClick={start} data-testid="op-demo-submit">{busy ? 'Starting…' : 'Populate metrics'}</button>
            </div>
          </div>
        )}

        {job && (job.status === 'queued' || job.status === 'running') && (
          <div className="space-y-3" data-testid="op-demo-progress" role="status" aria-live="polite">
            {created && (
              <p className="text-sm text-slate-700 dark:text-slate-200">
                Created {plural(created.departments.length, 'department')}, {plural(created.teams.length, 'team')} and {plural(created.people, 'person', 'people')}. Now filling one year of data…
              </p>
            )}
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progress">
              <div className="h-full rounded-full bg-blue-600 transition-all dark:bg-blue-500" style={{ width: `${Math.max(pct, 3)}%` }} />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="op-demo-step">
              {job.step ?? 'Working'}{job.total ? ` · ${job.done} of ${job.total} steps (${pct} %)` : ''}
            </p>
            {created && <p className="text-xs text-amber-700 dark:text-amber-300">Keep this window open: the shared password is shown here once, when the data is ready.</p>}
          </div>
        )}

        {job?.status === 'failed' && (
          <div className="space-y-3" data-testid="op-demo-failed">
            <ErrorText error={job.error ?? 'Generating the data failed.'} />
            {created && (
              <>
                <p className="text-sm text-slate-700 dark:text-slate-200">
                  The departments, teams and people were created. Use <strong>Populate metrics</strong> to fill their data again (it only adds what is missing).
                  Their shared password:
                </p>
                <PasswordBox password={created.password} />
              </>
            )}
          </div>
        )}

        {job?.status === 'done' && (
          <div className="space-y-3" data-testid="op-demo-done">
            <p className="text-sm text-slate-700 dark:text-slate-200" data-testid="op-demo-summary">
              {created
                ? <>Done: {plural(created.departments.length, 'department')}, {plural(created.teams.length, 'team')} and {plural(created.people, 'person', 'people')} with one year of data ({rows} rows).</>
                : <>Done: one year of data for {plural(job.result?.teamsFilled ?? 0, 'team')} ({rows} rows)
                  {job.result?.teamsToppedUp ? `; ${plural(job.result.teamsToppedUp, 'team')} that already had sample data topped up` : ''}
                  {job.result?.teamsSkippedNoPeople ? `; ${plural(job.result.teamsSkippedNoPeople, 'team')} without a team lead or engineer skipped` : ''}.</>}
            </p>
            {created && (
              <>
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Shared password of the new people (shown once: copy it now)</p>
                  <PasswordBox password={created.password} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">One sign-in per role level</p>
                  <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 text-sm dark:divide-slate-700 dark:border-slate-700" data-testid="op-demo-logins">
                    {created.logins.map((l) => (
                      <li key={l.email} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-slate-800 dark:text-slate-100"><strong>{l.label}</strong> · {l.name} <span className="text-slate-500 dark:text-slate-400">({l.title})</span></span>
                        <span className="break-all font-mono text-xs text-slate-600 dark:text-slate-300">{l.email}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <details className="text-sm text-slate-700 dark:text-slate-200">
                  <summary className="cursor-pointer text-xs font-medium text-slate-500 dark:text-slate-400">Teams and their year</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5" data-testid="op-demo-teams">
                    {created.teams.map((t) => <li key={t.id}>{t.name} <span className="text-slate-500 dark:text-slate-400">({t.department}: {STORY_LABEL[t.story] ?? t.story})</span></li>)}
                  </ul>
                </details>
              </>
            )}
          </div>
        )}

        {job && (
          <div className="flex justify-end">
            <button type="button" className={buttonClass.primary} onClick={onClose} data-testid="op-demo-close">{job.status === 'done' ? 'Done' : 'Close'}</button>
          </div>
        )}
      </div>
    </Modal>
  );
};
