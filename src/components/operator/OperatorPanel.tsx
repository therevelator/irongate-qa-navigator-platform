import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, LogOut, Plus, ShieldAlert } from 'lucide-react';
import BrandMark from '../BrandMark';
import { Toaster } from 'react-hot-toast';
import { Badge, Page, PageIntro, SegmentedControl, StatTile, buttonClass, cx, inputClass } from '../ui';
import { fetchOperatorStatus, onOperatorSessionChange, opFetch, operatorSession, operatorSignIn, operatorSignOut, type OperatorStatus } from '../../lib/operatorClient';
import { CompanyStatusBadge, DataTable, ErrorText, FormDialog, OkBadge, Section, useOpActions, type FormSpec } from './OperatorBits';
import { fmtBytes, fmtDate } from './format';
import OperatorCompany, { ErrorRows } from './OperatorCompany';
import AuthEventsList from './OperatorAuthEvents';
import { PASSWORD_RULES_TEXT } from '../../lib/passwordPolicy';

/**
 * Platform support (/operator): IronGate's own operators (platform_operators), not users of any
 * company. Own sign-in (e-mail + password, 8-hour session in an httpOnly cookie), outside the
 * company app. Full access to every company; nothing an operator does is logged and no reason is
 * asked for. Destructive actions are confirmed in the page.
 */

const useSession = () => {
  const [s, setS] = useState(operatorSession());
  useEffect(() => onOperatorSessionChange(() => setS(operatorSession())), []);
  return s;
};

const SignIn: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await operatorSignIn(email.trim(), password);
      setPassword('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto mt-10 max-w-md rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900" data-testid="operator-signin">
      <div className="mb-4 flex items-center gap-2 text-slate-900 dark:text-white"><KeyRound size={18} /><h1 className="text-base font-semibold">Platform support sign-in</h1></div>
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">For IronGate platform operators only. Company accounts cannot sign in here.</p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="op-email" className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">E-mail address</label>
          <input id="op-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={cx(inputClass, 'w-full')} data-testid="operator-email" />
        </div>
        <div>
          <label htmlFor="op-password" className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Password</label>
          <input id="op-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={cx(inputClass, 'w-full')} data-testid="operator-password" />
        </div>
        <ErrorText error={error} />
        <button type="submit" disabled={!email.trim() || !password || busy} className={cx(buttonClass.primary, 'w-full')} data-testid="operator-enter">{busy ? 'Checking…' : 'Sign in'}</button>
      </form>
    </div>
  );
};

type Screen = 'overview' | 'sign-ins' | 'errors';

const OperatorPanel: React.FC = () => {
  const [status, setStatus] = useState<OperatorStatus | null>(null);
  const session = useSession();
  const [screen, setScreen] = useState<Screen>('overview');
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => { document.title = 'IronGate platform support'; fetchOperatorStatus().then(setStatus); }, []);
  const signOut = useCallback(async () => { await operatorSignOut(); setCompany(null); }, []);

  const shell = (children: React.ReactNode) => (
    <div className="ig-app-bg min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-8 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100" data-testid="operator-banner">
        <p className="flex items-center gap-2"><BrandMark height={24} className="flex-shrink-0" /><ShieldAlert size={16} className="flex-shrink-0" aria-hidden="true" /><strong>IronGate platform support</strong></p>
        {session && (
          <div className="flex items-center gap-3">
            <span data-testid="operator-who">{session.name}</span>
            <button type="button" onClick={signOut} className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} data-testid="operator-leave"><LogOut size={14} /> Sign out</button>
          </div>
        )}
      </header>
      <main id="main-scroll">{children}</main>
      <Toaster position="top-right" toastOptions={{ duration: 3000, style: { fontSize: '14px' } }} />
    </div>
  );

  if (status === null) return shell(<Page><p className="text-sm text-slate-500" role="status">Loading…</p></Page>);
  if (!status.available) return shell(<Page><PageIntro title="Platform support" description="Platform support is not available." /></Page>);
  if (!status.allowed) return shell(<Page><PageIntro title="Platform support" description="Platform support is not available from this network." /></Page>);
  if (!session) return shell(<Page><SignIn /></Page>);

  return shell(
    <Page>
      {company ? (
        <OperatorCompany company={company} onBack={() => setCompany(null)} />
      ) : (
        <>
          <PageIntro title="Platform" description="All companies, sign-ins, scheduled jobs and server errors." actions={
            <SegmentedControl value={screen} onChange={setScreen} options={[{ value: 'overview', label: 'Overview' }, { value: 'sign-ins', label: 'Sign-ins' }, { value: 'errors', label: 'Error search' }]} />
          } />
          {screen === 'overview' && <Overview onOpen={(c) => setCompany(c)} />}
          {screen === 'sign-ins' && <Section title="Sign-in events" subtitle="Every company, including failed sign-ins with an e-mail that belongs to nobody. Kept 180 days."><AuthEventsList base="" /></Section>}
          {screen === 'errors' && <ErrorSearch />}
        </>
      )}
    </Page>
  );
};

const createCompanySpec = (onCreated: (c: { id: string; name: string }) => void): FormSpec => ({
  title: 'Create company',
  description: 'Creates the organisation with a first department and team, and optionally its first person, created with a password or invited by e-mail.',
  submitLabel: 'Create company',
  initial: { departmentName: 'General', teamName: 'Team 1', adminMode: 'invite', adminRole: 'super_admin' },
  fields: [
    { name: 'name', label: 'Company name', required: true },
    { name: 'domain', label: 'E-mail domain', help: 'Defaults to the domain of the first person.' },
    { name: 'departmentName', label: 'First department', required: true },
    { name: 'teamName', label: 'First team', required: true },
    { name: 'adminEmail', label: 'First person: e-mail', type: 'email' },
    { name: 'adminRole', label: 'Role', type: 'select', when: (v) => !!v.adminEmail, options: [
      { value: 'super_admin', label: 'Super admin' },
      { value: 'qa_manager', label: 'Manager of the first department' },
      { value: 'team_lead', label: 'Team lead of the first team' },
      { value: 'qa_engineer', label: 'Software engineer of the first team' },
      { value: 'viewer', label: 'Viewer of the first team' },
    ], help: 'Every company needs a super admin to manage it; you can also manage it yourself from this panel.' },
    { name: 'adminMode', label: 'How they get access', type: 'select', options: [{ value: 'invite', label: 'Invitation e-mail' }, { value: 'password', label: 'Password set now' }], when: (v) => !!v.adminEmail },
    { name: 'adminFirstName', label: 'First name', when: (v) => !!v.adminEmail && v.adminMode === 'password' },
    { name: 'adminLastName', label: 'Last name', when: (v) => !!v.adminEmail && v.adminMode === 'password' },
    { name: 'adminPassword', label: 'Password', type: 'password', when: (v) => !!v.adminEmail && v.adminMode === 'password', help: PASSWORD_RULES_TEXT },
  ],
  submit: async (v) => {
    const out = await opFetch<any>('/companies', {
      method: 'POST',
      body: {
        name: v.name, domain: v.domain, departmentName: v.departmentName, teamName: v.teamName,
        admin: v.adminEmail ? { email: v.adminEmail, role: v.adminRole || 'super_admin', mode: v.adminMode, firstName: v.adminFirstName, lastName: v.adminLastName, password: v.adminPassword } : undefined,
      },
    });
    if (out.admin?.error) throw new Error(`The company was created, but the first person was not: ${out.admin.error}`);
    onCreated({ id: out.company.id, name: out.company.name });
    return out;
  },
  doneMessage: (out) => `${out.company.name} created`,
});

const Overview: React.FC<{ onOpen: (c: { id: string; name: string }) => void }> = ({ onOpen }) => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormSpec | null>(null);
  const load = useCallback(() => { opFetch('/overview').then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(() => { load(); }, [load]);
  const { run, dialog } = useOpActions(load);
  if (!data) return error ? <ErrorText error={error} /> : <p className="text-sm text-slate-500" role="status">Loading…</p>;
  const p = data.platform;
  const noRuns = !p.jobRunsTotal;
  return (
    <div className="space-y-4" data-testid="operator-overview">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Companies" value={data.total} caption={p.suspended ? `${p.suspended} suspended` : undefined} />
        <StatTile label="Active sessions" value={p.activeSessions} />
        <StatTile label="Sign-ins (7 days)" value={p.signIns7d} />
        <StatTile label="Failed sign-ins (7 days)" value={p.failedSignIns7d} tone={p.failedSignIns7d ? 'warn' : 'neutral'} />
        <StatTile label="Errors (24 h)" value={p.errors24h} tone={p.errors24h ? 'bad' : 'neutral'} />
        <StatTile label="Database size" value={fmtBytes(p.dbSizeBytes)} />
      </div>
      <Section title="Companies" subtitle="Open one to see and change everything in it." action={
        <button type="button" className={cx(buttonClass.primary, 'h-8 px-2.5 text-xs')} data-testid="op-create-company" onClick={() => setForm(createCompanySpec(onOpen))}><Plus size={14} /> Create company</button>
      }>
        <DataTable testId="operator-companies" rows={data.companies} rowTestId={(c: any) => `op-company-row-${c.id}`} columns={[
          { key: 'name', label: 'Company', render: (c: any) => (
            <button type="button" onClick={() => onOpen({ id: c.id, name: c.name })} className="text-left font-medium text-brand-700 hover:underline dark:text-brand-300" data-testid="operator-open-company">
              {c.name}{c.demo && <Badge tone="warn" className="ml-1">Demo</Badge>}{c.sample_teams > 0 && <Badge className="ml-1">Sample data</Badge>}
            </button>
          ) },
          { key: 'status', label: 'Status', render: (c: any) => (
            <span title={c.status === 'suspended' ? `${c.suspended_reason ?? ''}${c.suspended_until ? ` · until ${fmtDate(c.suspended_until)}` : ''}` : undefined} data-testid="op-company-status"><CompanyStatusBadge status={c.status} /></span>
          ) },
          { key: 'users', label: 'Users' }, { key: 'teams', label: 'Teams' },
          { key: 'active_sessions', label: 'Sessions now' },
          { key: 'sign_ins_7d', label: 'Sign-ins 7 d' },
          { key: 'failed_7d', label: 'Failed 7 d', render: (c: any) => (c.failed_7d ? <Badge tone="warn">{c.failed_7d}</Badge> : '0') },
          { key: 'countries', label: 'Countries (30 d)', className: 'max-w-[12rem]', render: (c: any) => (c.countries?.length ? c.countries.join(', ') : '—') },
          { key: 'last_data_at', label: 'Last data', render: (c: any) => fmtDate(c.last_data_at) },
          { key: 'stale_pct', label: 'Stale', render: (c: any) => (c.stale_pct == null ? '—' : <Badge tone={c.stale_pct > 30 ? 'bad' : c.stale_pct > 10 ? 'warn' : 'good'}>{c.stale_pct}%</Badge>) },
          { key: 'open_alerts', label: 'Open alerts' },
          { key: 'errors_24h', label: 'Errors 24 h', render: (c: any) => (c.errors_24h ? <Badge tone="bad">{c.errors_24h}</Badge> : '0') },
          { key: 'last_activity_at', label: 'Last activity', render: (c: any) => fmtDate(c.last_activity_at) },
        ]} />
      </Section>
      <Section title="Scheduled jobs" subtitle={noRuns ? 'No runs recorded yet: the jobs record a row each time they run (on Netlify, scheduled functions; locally, the server\'s schedules).' : 'Last run of each job.'} action={
        <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} data-testid="op-demo-refresh" onClick={() => run({
          title: 'Refresh sample data now',
          description: 'Adds the missing recent days of sample data up to today (never changes or deletes a row, never touches real data).',
          path: '/actions/demo-refresh',
          doneMessage: (out) => (out?.mode === 'background'
            ? 'Sample data refresh started. It runs in the background for a few minutes.'
            : `Sample data refreshed: ${out?.result?.insertedTotal ?? 0} new rows.`),
        })}>Refresh sample data now</button>
      }>
        {noRuns ? <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400" data-testid="operator-jobs-empty">No runs recorded yet.</p> : (
          <DataTable testId="operator-jobs" rows={p.jobs} rowKey={(j: any) => j.job} columns={[
            { key: 'job', label: 'Job' },
            { key: 'last', label: 'Last run', render: (j: any) => (j.last ? fmtDate(j.last.started_at) : 'No runs recorded yet') },
            { key: 'ok', label: 'Result', render: (j: any) => (j.last ? <OkBadge ok={j.last.ok} /> : '—') },
            { key: 'summary', label: 'Summary', className: 'max-w-md', render: (j: any) => j.last?.summary ?? '—' },
            { key: 'lastOkAt', label: 'Last success', render: (j: any) => fmtDate(j.lastOkAt) },
          ]} />
        )}
      </Section>
      <Section title="Main tables" subtitle="Row counts (exact below 200 000 rows, else the live-row statistic) and size on disk.">
        <DataTable testId="operator-tables" rows={p.tables} rowKey={(t: any) => t.table} columns={[
          { key: 'table', label: 'Table' },
          { key: 'rows', label: 'Rows', render: (t: any) => `${Number(t.rows).toLocaleString()}${t.exact ? '' : ' (approx.)'}` },
          { key: 'bytes', label: 'Size', render: (t: any) => fmtBytes(t.bytes) },
        ]} />
      </Section>
      {dialog}
      <FormDialog spec={form} onClose={() => setForm(null)} onDone={load} />
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

export default OperatorPanel;
