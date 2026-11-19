import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, LogOut, ShieldAlert } from 'lucide-react';
import Modal from '../Modal';
import { Badge, Page, PageIntro, SegmentedControl, StatTile, buttonClass, cx, inputClass } from '../ui';
import { fetchOperatorStatus, onOperatorSessionChange, opFetch, operatorSession, setOperatorSession } from '../../lib/operatorClient';
import { DataTable, ErrorText, OkBadge, Section, ActionDialog, type RepairAction } from './OperatorBits';
import { fmtBytes, fmtDate } from './format';
import OperatorCompany, { ErrorRows } from './OperatorCompany';

/**
 * Platform operator panel (/operator): for the product owner only (PLATFORM_OPERATOR_EMAILS).
 * Entering asks for the password again; the operator token is kept in memory for 30 minutes.
 * Every company opened and every repair action is recorded in that company's Activity log.
 */

const useSession = () => {
  const [s, setS] = useState(operatorSession());
  useEffect(() => onOperatorSessionChange(() => setS(operatorSession())), []);
  return s;
};

const Countdown: React.FC<{ until: string; onExpired: () => void }> = ({ until, onExpired }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, Date.parse(until) - now);
  useEffect(() => { if (left === 0) onExpired(); }, [left, onExpired]);
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  return <span className="tabular-nums" data-testid="operator-countdown">{m}:{String(s).padStart(2, '0')}</span>;
};

const StepUp: React.FC = () => {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const out = await opFetch<{ token: string; expiresAt: string }>('/session', { method: 'POST', body: { password } });
      setPassword('');
      setOperatorSession(out.token, out.expiresAt);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900" data-testid="operator-stepup">
      <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-white"><KeyRound size={18} /><h2 className="text-base font-semibold">Confirm it is you</h2></div>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
        Enter your password again to open platform support for 30 minutes. Every company you open is recorded in that company's Activity log.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="op-password" className="block text-xs font-medium text-slate-500 dark:text-slate-400">Password</label>
        <input id="op-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={cx(inputClass, 'w-full')} data-testid="operator-password" />
        <ErrorText error={error} />
        <button type="submit" disabled={!password || busy} className={cx(buttonClass.primary, 'w-full')} data-testid="operator-enter">{busy ? 'Checking…' : 'Enter platform support'}</button>
      </form>
    </div>
  );
};

type Screen = 'overview' | 'errors' | 'access';

const OperatorPanel: React.FC = () => {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const session = useSession();
  const [screen, setScreen] = useState<Screen>('overview');
  const [company, setCompany] = useState<{ id: string; name: string; reason: string } | null>(null);
  const [pending, setPending] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => { fetchOperatorStatus().then(setAllowed); }, []);
  const leave = useCallback(async () => {
    try { await opFetch('/session/end', { method: 'POST' }); } catch { /* the token is dropped anyway */ }
    setOperatorSession(null, null);
    setCompany(null);
  }, []);
  const expired = useCallback(() => { setOperatorSession(null, null); setCompany(null); }, []);

  if (allowed === null) return <Page><p className="text-sm text-slate-500" role="status">Loading…</p></Page>;
  if (!allowed) {
    return (
      <Page>
        <PageIntro title="Platform" description="This area is not available for your account." />
      </Page>
    );
  }

  return (
    <Page>
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-col gap-2 border-y border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:-mx-8 sm:flex-row sm:items-center sm:justify-between sm:px-8 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100" role="status" data-testid="operator-banner">
        <p className="flex items-start gap-2"><ShieldAlert size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span><strong>Platform support mode</strong> — your access is recorded in this company's Activity log.</span>
        </p>
        {session && (
          <div className="flex items-center gap-3">
            <span>Session ends in <Countdown until={session.expiresAt} onExpired={expired} /></span>
            <button type="button" onClick={leave} className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} data-testid="operator-leave"><LogOut size={14} /> Leave</button>
          </div>
        )}
      </div>

      {!session ? <StepUp /> : company ? (
        <OperatorCompany company={company} reason={company.reason} onBack={() => setCompany(null)} />
      ) : (
        <>
          <PageIntro title="Platform" description="All companies, scheduled jobs and server errors." actions={
            <SegmentedControl value={screen} onChange={setScreen} options={[{ value: 'overview', label: 'Overview' }, { value: 'errors', label: 'Error search' }, { value: 'access', label: 'Access log' }]} />
          } />
          {screen === 'overview' && <Overview onOpen={(c) => { setReason(''); setPending(c); }} />}
          {screen === 'errors' && <ErrorSearch />}
          {screen === 'access' && <AccessLog />}
        </>
      )}

      <Modal isOpen={!!pending} onClose={() => setPending(null)} title={`Open ${pending?.name ?? ''}`} size="sm">
        <form onSubmit={(e) => { e.preventDefault(); if (pending && reason.trim().length >= 3) { setCompany({ ...pending, reason: reason.trim() }); setPending(null); } }} className="space-y-3">
          <p className="text-sm text-slate-700 dark:text-slate-200">Why are you opening this company? The reason is shown to its super admins in their Activity log.</p>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} aria-label="Reason" className={cx(inputClass, 'h-auto w-full py-2')} data-testid="operator-open-reason" />
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => setPending(null)}>Cancel</button>
            <button type="submit" className={buttonClass.primary} disabled={reason.trim().length < 3} data-testid="operator-open-confirm">Open company</button>
          </div>
        </form>
      </Modal>
    </Page>
  );
};

const Overview: React.FC<{ onOpen: (c: { id: string; name: string }) => void }> = ({ onOpen }) => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<RepairAction | null>(null);
  const load = useCallback(() => { opFetch('/overview').then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return error ? <ErrorText error={error} /> : <p className="text-sm text-slate-500" role="status">Loading…</p>;
  const p = data.platform;
  return (
    <div className="space-y-4" data-testid="operator-overview">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Companies" value={data.total} />
        <StatTile label="Errors (24 h)" value={p.errors24h} tone={p.errors24h ? 'bad' : 'neutral'} />
        <StatTile label="Database size" value={fmtBytes(p.dbSizeBytes)} />
        <StatTile label="Jobs failing" value={p.jobs.filter((j: any) => j.last && j.last.ok === false).length} tone={p.jobs.some((j: any) => j.last?.ok === false) ? 'bad' : 'good'} />
      </div>
      <Section title="Companies" subtitle="Open one to see its data in detail.">
        <DataTable testId="operator-companies" rows={data.companies} columns={[
          { key: 'name', label: 'Company', render: (c: any) => (
            <button type="button" onClick={() => onOpen({ id: c.id, name: c.name })} className="text-left font-medium text-brand-700 hover:underline dark:text-brand-300" data-testid="operator-open-company">
              {c.name}{c.demo && <Badge tone="warn" className="ml-1">Demo</Badge>}{c.sample_teams > 0 && <Badge className="ml-1">Sample data</Badge>}
            </button>
          ) },
          { key: 'users', label: 'Users' }, { key: 'teams', label: 'Teams' },
          { key: 'last_data_at', label: 'Last data', render: (c: any) => fmtDate(c.last_data_at) },
          { key: 'stale_pct', label: 'Stale', render: (c: any) => (c.stale_pct == null ? '—' : <Badge tone={c.stale_pct > 30 ? 'bad' : c.stale_pct > 10 ? 'warn' : 'good'}>{c.stale_pct}%</Badge>) },
          { key: 'open_alerts', label: 'Open alerts' },
          { key: 'errors_24h', label: 'Errors 24 h', render: (c: any) => (c.errors_24h ? <Badge tone="bad">{c.errors_24h}</Badge> : '0') },
          { key: 'last_activity_at', label: 'Last activity', render: (c: any) => fmtDate(c.last_activity_at) },
        ]} />
      </Section>
      <Section title="Scheduled jobs" subtitle="Last run of each job." action={
        <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} data-testid="op-demo-refresh" onClick={() => setAction({
          title: 'Refresh sample data now',
          description: 'Adds the missing recent days of sample data up to today (never changes or deletes a row, never touches real data). On the hosted site it runs in the background for a few minutes; its result appears under demo-refresh-background.',
          path: '/actions/demo-refresh',
          confirmLabel: 'Refresh now',
          doneMessage: (out) => (out?.mode === 'background'
            ? 'Sample data refresh started. It runs in the background for a few minutes.'
            : `Sample data refreshed: ${out?.result?.insertedTotal ?? 0} new rows.`),
        })}>Refresh sample data now</button>
      }>
        <DataTable testId="operator-jobs" rows={p.jobs} rowKey={(j: any) => j.job} columns={[
          { key: 'job', label: 'Job' },
          { key: 'last', label: 'Last run', render: (j: any) => (j.last ? fmtDate(j.last.started_at) : 'Never') },
          { key: 'ok', label: 'Result', render: (j: any) => (j.last ? <OkBadge ok={j.last.ok} /> : '—') },
          { key: 'summary', label: 'Summary', className: 'max-w-md', render: (j: any) => j.last?.summary ?? '—' },
          { key: 'lastOkAt', label: 'Last success', render: (j: any) => fmtDate(j.lastOkAt) },
        ]} />
      </Section>
      <Section title="Main tables" subtitle="Approximate row counts (planner statistics) and size on disk.">
        <DataTable rows={p.tables} rowKey={(t: any) => t.table} columns={[{ key: 'table', label: 'Table' }, { key: 'approx_rows', label: 'Rows (approx.)' }, { key: 'bytes', label: 'Size', render: (t: any) => fmtBytes(t.bytes) }]} />
      </Section>
      <ActionDialog action={action} onClose={() => setAction(null)} onDone={load} />
    </div>
  );
};

const ErrorSearch: React.FC = () => {
  const [rid, setRid] = useState('');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback((q: string) => {
    opFetch(`/errors${q ? `?requestId=${encodeURIComponent(q)}` : ''}`).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { run(''); }, [run]);
  return (
    <Section title="Server errors" subtitle="All companies, last 30 days. Search by the request id a customer quotes." action={
      <form onSubmit={(e) => { e.preventDefault(); run(rid.trim()); }} className="flex gap-2">
        <input aria-label="Request id" value={rid} onChange={(e) => setRid(e.target.value)} placeholder="Request id" className={cx(inputClass, 'w-44 sm:w-64')} data-testid="operator-rid" />
        <button type="submit" className={buttonClass.secondary} data-testid="operator-rid-search">Search</button>
      </form>
    }>
      <ErrorText error={error} />
      {data && data.activity?.length > 0 && (
        <div className="border-b border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
          {data.activity.map((a: any, i: number) => <p key={i}>Request of {a.actor_display ?? 'someone'} in {a.company_name}: {a.method ?? ''} {a.route ?? ''} → {a.status} ({fmtDate(a.created_at)})</p>)}
        </div>
      )}
      {data && <ErrorRows rows={data.errors} />}
    </Section>
  );
};

const AccessLog: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { opFetch('/access-log').then(setData).catch((e) => setError(e.message)); }, []);
  return (
    <Section title="Operator access log" subtitle="Every platform support access, across companies.">
      <ErrorText error={error} />
      {data && <DataTable rows={data.entries} columns={[
        { key: 'created_at', label: 'When', render: (r: any) => fmtDate(r.created_at) }, { key: 'operator_email', label: 'Operator', className: 'break-all' },
        { key: 'action', label: 'Action' }, { key: 'company_name', label: 'Company' }, { key: 'section', label: 'Section' }, { key: 'reason', label: 'Reason', className: 'max-w-xs' }, { key: 'ip', label: 'IP' },
      ]} />}
    </Section>
  );
};

export default OperatorPanel;
