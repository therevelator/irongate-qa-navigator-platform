import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Download, Plus, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { Badge, SegmentedControl, StatTile, buttonClass, cx, inputClass } from '../ui';
import { opDownload, opFetch } from '../../lib/operatorClient';
import { ROLE_LABELS } from '../../lib/policyActor';
import UserActivityList, { type ActivityFacets, type ActivityLoader } from '../UserActivityList';
import { activityParams, emptyActivityFilters } from '../../lib/userActivityFilters';
import {
  CompanyStatusBadge, DataTable, ErrorText, FormDialog, Section, SessionBadge, SmallButton, deviceText, placeText, useOpActions,
  type FormSpec, type OpAction,
} from './OperatorBits';
import AuthEventsList from './OperatorAuthEvents';
import OperatorUser from './OperatorUser';
import { DemoDataDialog, type DemoMode } from './OperatorDemoData';
import { fmtDate, fmtDay } from './format';
import { PASSWORD_RULES_TEXT } from '../../lib/passwordPolicy';

/**
 * One company in the platform operator panel: everything in it, readable and changeable. Changes
 * the company app also offers run through the company app's own rules on the server. Destructive
 * actions are confirmed in the page (typed name for deletes). Nothing here is logged.
 */

type Tab = 'organisation' | 'users' | 'sessions' | 'sign-ins' | 'views' | 'settings' | 'data' | 'modules' | 'alerts' | 'pulse' | 'activity' | 'user-activity' | 'errors';
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'organisation', label: 'Organisation' }, { value: 'users', label: 'Users' }, { value: 'sessions', label: 'Sessions' },
  { value: 'sign-ins', label: 'Sign-ins' }, { value: 'views', label: 'Last views' }, { value: 'settings', label: 'Settings & targets' },
  { value: 'data', label: 'Data' }, { value: 'modules', label: 'Modules' }, { value: 'alerts', label: 'Alerts & actions' }, { value: 'pulse', label: 'Wellbeing pulse' },
  { value: 'activity', label: 'Activity' }, { value: 'user-activity', label: 'Access log' }, { value: 'errors', label: 'Errors' },
];

export const ROLE_OPTIONS = ['super_admin', 'qa_manager', 'team_lead', 'qa_engineer', 'viewer'].map((r) => ({ value: r, label: ROLE_LABELS[r] ?? r }));
const roleLabel = (r: string) => ROLE_LABELS[r] ?? r;
const enc = encodeURIComponent;

export function useSection<T = any>(companyId: string, section: string, params = '') {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await opFetch<T>(`/companies/${enc(companyId)}/${section}${params ? `?${params}` : ''}`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [companyId, section, params]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load };
}

export const Loading: React.FC<{ loading: boolean; error: string | null }> = ({ loading, error }) =>
  error ? <ErrorText error={error} /> : loading ? <p className="text-sm text-slate-500 dark:text-slate-400" role="status">Loading…</p> : null;

/** Organisation lists shared by the forms (departments, teams, people). */
export interface Org { departments: any[]; teams: any[]; users: any[]; assignments: any[] }
export const deptOptions = (org: Org | null, activeOnly = true) => (org?.departments ?? []).filter((d) => !activeOnly || d.is_active).map((d) => ({ value: d.id, label: d.name }));
export const teamOptions = (org: Org | null, activeOnly = true) => (org?.teams ?? []).filter((t) => !activeOnly || t.is_active).map((t) => ({ value: t.id, label: t.name }));
export const userOptions = (org: Org | null) => (org?.users ?? []).filter((u) => u.is_active).map((u) => ({ value: u.id, label: u.name ?? u.email }));

/** Scope of a grant: the company, a department or a team (by the role's scope). */
export const scopeOptions = (org: Org | null, role: string) =>
  role === 'super_admin' ? [] : role === 'qa_manager' ? deptOptions(org) : teamOptions(org);

const OperatorCompany: React.FC<{ company: { id: string; name: string }; onBack: () => void }> = ({ company, onBack }) => {
  const [tab, setTab] = useState<Tab>('organisation');
  const [bump, setBump] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [form, setForm] = useState<FormSpec | null>(null);
  const [demoMode, setDemoMode] = useState<DemoMode | null>(null);
  const summary = useSection<any>(company.id, 'summary');
  const orgQ = useSection<Org>(company.id, 'organisation');
  const org = orgQ.data;
  const refresh = useCallback(() => { setBump((b) => b + 1); summary.reload(); orgQ.reload(); }, [summary, orgQ]);
  const { run, dialog } = useOpActions(refresh);
  const c = summary.data?.counts;
  const info = summary.data?.company;
  const base = `/companies/${enc(company.id)}`;
  const name = info?.name ?? company.name;
  const suspended = info?.status === 'suspended';

  const editCompany = () => setForm({
    title: 'Edit company',
    initial: { name, domain: info?.domain ?? '', hideSampleDataNotice: !!info?.hideSampleDataNotice },
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'domain', label: 'E-mail domain', required: true },
      { name: 'hideSampleDataNotice', label: 'Hide the sample-data notices in the app', type: 'checkbox' },
    ],
    submit: (v) => opFetch(base, { method: 'PUT', body: v }),
  });
  const suspend = () => setForm({
    title: `Suspend ${name}`,
    description: 'Its users cannot sign in or use the app; every open session and API key is refused ("Your organisation\'s access is suspended. Contact your administrator."). Scheduled jobs skip it. Nothing is deleted.',
    destructive: true,
    submitLabel: 'Suspend company',
    fields: [
      { name: 'reason', label: 'Reason (shown to operators only)', required: true },
      { name: 'suspendedUntil', label: 'Suspended until (optional)', type: 'date' },
      { name: 'billingNote', label: 'Billing note (optional)', type: 'textarea' },
    ],
    submit: (v) => opFetch(`${base}/suspend`, { method: 'POST', body: { ...v, confirm: true } }),
    doneMessage: () => `${name} is suspended`,
  });

  if (userId) {
    return <OperatorUser companyId={company.id} companyName={name} userId={userId} org={org} onBack={() => { setUserId(null); refresh(); }} />;
  }

  return (
    <div className="space-y-4" data-testid="operator-company">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onBack} className={cx(buttonClass.secondary, 'h-8 px-2.5')} aria-label="Back to all companies" data-testid="op-back"><ArrowLeft size={15} /></button>
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white"><span className="truncate" data-testid="op-company-name">{name}</span> <CompanyStatusBadge status={info?.status} /></h2>
            <p className="break-all text-xs text-slate-500 dark:text-slate-400">{company.id}{info?.domain ? ` · ${info.domain}` : ''}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <SmallButton testId="op-edit-company" onClick={editCompany}>Edit company</SmallButton>
          {suspended
            ? <SmallButton testId="op-reactivate-company" onClick={() => run({ title: `Reactivate ${name}`, description: 'Its users can sign in again (sessions ended by the suspension stay ended). Scheduled jobs include it again.', path: `${base}/reactivate`, destructive: true, confirmLabel: 'Reactivate' })}>Reactivate</SmallButton>
            : <SmallButton testId="op-suspend-company" danger onClick={suspend}>Suspend</SmallButton>}
          <SmallButton testId="op-demo-data" onClick={() => setDemoMode('generate')} title="Generate departments, teams, people and a year of sample data">Demo Data</SmallButton>
          <SmallButton testId="op-populate-metrics" onClick={() => setDemoMode('populate')} title="Fill a year of sample data for the teams that have none">Populate metrics</SmallButton>
          <SmallButton testId="op-evaluate-alerts" onClick={() => run({ title: 'Re-run alert evaluation', description: '', path: `${base}/actions/evaluate-alerts`, doneMessage: (o) => `Alerts evaluated: ${o.opened} opened, ${o.resolved} resolved` })}>Re-run alerts</SmallButton>
          <SmallButton testId="op-recompute" onClick={() => run({ title: 'Recompute KPI snapshots', description: '', path: `${base}/actions/recompute-snapshots`, doneMessage: (o) => `Recomputed ${o.teams?.length ?? 0} team(s)` })}>Recompute snapshots</SmallButton>
          <SmallButton testId="op-delete-company" danger onClick={() => run({
            title: `Delete ${name}`, description: 'Deletes the company and ALL its data for good: people, teams, metrics, history, sign-in records. This cannot be undone.',
            path: base, method: 'DELETE', destructive: true, typeToConfirm: name, typedField: 'confirmName', confirmLabel: 'Delete company for good',
          })}>Delete</SmallButton>
        </div>
      </div>

      {suspended && (
        <div role="status" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" data-testid="op-suspended-note">
          Suspended {fmtDate(info.suspended_at)}{info.suspended_by_name ? ` by ${info.suspended_by_name}` : ''}: {info.suspended_reason}
          {info.suspended_until ? ` · until ${fmtDay(info.suspended_until)}` : ''}{info.billing_note ? ` · ${info.billing_note}` : ''}
        </div>
      )}

      {c && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <StatTile label="Users" value={c.active_users} caption={`${c.users} in total`} />
          <StatTile label="Departments" value={c.departments} />
          <StatTile label="Teams" value={c.teams} />
          <StatTile label="Sessions now" value={c.active_sessions} />
          <StatTile label="Sign-ins 7 d" value={c.sign_ins_7d} />
          <StatTile label="Failed 7 d" value={c.failed_7d} tone={c.failed_7d ? 'warn' : 'neutral'} />
          <StatTile label="Open alerts" value={c.open_alerts} tone={c.open_alerts ? 'warn' : 'neutral'} />
          <StatTile label="Errors (24 h)" value={c.errors_24h} tone={c.errors_24h ? 'bad' : 'neutral'} />
        </div>
      )}

      <div className="max-w-full overflow-x-auto pb-1" data-testid="op-company-tabs">
        <SegmentedControl value={tab} onChange={setTab} options={TABS} />
      </div>

      <div key={`${tab}-${bump}`}>
        {tab === 'organisation' && <OrganisationTab companyId={company.id} org={org} error={orgQ.error} run={run} setForm={setForm} />}
        {tab === 'users' && <UsersTab companyId={company.id} org={org} run={run} setForm={setForm} onOpenUser={setUserId} />}
        {tab === 'sessions' && <SessionsTab companyId={company.id} run={run} onOpenUser={setUserId} />}
        {tab === 'sign-ins' && <Section title="Sign-ins" subtitle="Every sign-in and failed sign-in of this company's people (180 days)."><AuthEventsList base={base} users={org?.users} /></Section>}
        {tab === 'views' && <ViewsTab companyId={company.id} onOpenUser={setUserId} />}
        {tab === 'settings' && <SettingsTab companyId={company.id} org={org} summary={summary.data} run={run} setForm={setForm} />}
        {tab === 'data' && <DataTab companyId={company.id} onAction={run} />}
        {tab === 'modules' && <ModulesTab companyId={company.id} />}
        {tab === 'alerts' && <AlertsTab companyId={company.id} />}
        {tab === 'pulse' && <PulseTab companyId={company.id} />}
        {tab === 'activity' && <ActivityTab companyId={company.id} />}
        {tab === 'user-activity' && <UserActivityTab companyId={company.id} />}
        {tab === 'errors' && <ErrorsTab companyId={company.id} />}
      </div>

      {dialog}
      <DemoDataDialog mode={demoMode} companyId={company.id} companyName={name} onClose={() => setDemoMode(null)} onChanged={refresh} />
      <FormDialog spec={form} onClose={() => setForm(null)} onDone={refresh} />
    </div>
  );
};

type TabProps = { companyId: string; org: Org | null; run: (a: OpAction) => void; setForm: (f: FormSpec) => void };

const OrganisationTab: React.FC<TabProps & { error: string | null }> = ({ companyId, org, error, run, setForm }) => {
  if (!org) return <Loading loading={!error} error={error} />;
  const base = `/companies/${enc(companyId)}`;
  const userName = (id: string) => org.users.find((u: any) => u.id === id)?.name ?? org.users.find((u: any) => u.id === id)?.email ?? id;
  const byTeam = (teamId: string) => org.assignments.filter((a: any) => a.scope_type === 'team' && a.scope_id === teamId);
  const groups = [...org.departments, { id: null, name: 'No department', is_active: true }];
  const addTeam = (departmentId?: string) => setForm({
    title: 'Add team', initial: { departmentId: departmentId ?? '' },
    fields: [{ name: 'name', label: 'Team name', required: true }, { name: 'description', label: 'Description' }, { name: 'departmentId', label: 'Department', type: 'select', options: deptOptions(org), required: true }],
    submit: (v) => opFetch(`${base}/teams`, { method: 'POST', body: v }),
  });
  return (
    <div className="space-y-3" data-testid="op-organisation">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={cx(buttonClass.primary, 'h-8 px-2.5 text-xs')} data-testid="op-add-department" onClick={() => setForm({
          title: 'Add department', fields: [{ name: 'name', label: 'Department name', required: true }, { name: 'description', label: 'Description' }],
          submit: (v) => opFetch(`${base}/departments`, { method: 'POST', body: v }),
        })}><Plus size={14} /> Add department</button>
        <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} data-testid="op-add-team" onClick={() => addTeam()}><Plus size={14} /> Add team</button>
      </div>
      <Section title="Company roles" subtitle="Super admins">
        <ul className="px-4 py-3 text-sm text-slate-800 dark:text-slate-200">
          {org.assignments.filter((a: any) => a.scope_type === 'company').map((a: any) => <li key={a.id}>{userName(a.user_id)} — {roleLabel(a.role)}</li>)}
        </ul>
      </Section>
      {groups.map((d: any) => {
        const teams = org.teams.filter((t: any) => (t.department_id ?? null) === d.id);
        const managers = org.assignments.filter((a: any) => a.scope_type === 'department' && a.scope_id === d.id);
        if (d.id === null && !teams.length) return null;
        return (
          <Section key={d.id ?? 'none'} testId={`op-dept-${d.id ?? 'none'}`} title={d.name}
            subtitle={<>{!d.is_active && <Badge tone="warn">Inactive</Badge>} {managers.length ? `Managers: ${managers.map((m: any) => userName(m.user_id)).join(', ')}` : 'No manager'}</>}
            action={d.id && (
              <>
                <SmallButton testId="op-dept-rename" onClick={() => setForm({
                  title: `Edit ${d.name}`, initial: { name: d.name, description: d.description ?? '' },
                  fields: [{ name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description' }],
                  submit: (v) => opFetch(`${base}/departments/${enc(d.id)}`, { method: 'PUT', body: v }),
                })}>Edit</SmallButton>
                <SmallButton testId="op-dept-manager" onClick={() => setForm({
                  title: `Add a manager to ${d.name}`, fields: [{ name: 'userId', label: 'Person', type: 'select', options: userOptions(org), required: true }],
                  submit: (v) => opFetch(`${base}/departments/${enc(d.id)}/managers`, { method: 'POST', body: v }),
                })}>Add manager</SmallButton>
                {managers.map((m: any) => (
                  <SmallButton key={m.id} danger onClick={() => run({ title: `Remove ${userName(m.user_id)} as manager`, description: `${userName(m.user_id)} stops managing ${d.name}.`, path: `${base}/departments/${enc(d.id)}/managers/${enc(m.user_id)}/remove`, destructive: true })}>Remove {userName(m.user_id)}</SmallButton>
                ))}
                <SmallButton onClick={() => addTeam(d.id)}>Add team</SmallButton>
                {d.is_active && <SmallButton testId="op-dept-delete" danger onClick={() => run({ title: `Delete ${d.name}`, description: 'Deactivates the department (the company app\'s rule: refused while it has active teams or people).', path: `${base}/departments/${enc(d.id)}`, method: 'DELETE', destructive: true })}>Delete</SmallButton>}
              </>
            )}>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {teams.map((t: any) => (
                <li key={t.id} className="flex flex-col gap-2 px-4 py-2 text-sm sm:flex-row sm:items-start sm:justify-between" data-testid={`op-team-${t.id}`}>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white">{t.name} {!t.is_active && <Badge tone="warn">Archived</Badge>}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {byTeam(t.id).map((a: any) => `${userName(a.user_id)} (${roleLabel(a.role)})`).join(' · ') || 'No members'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <SmallButton testId="op-team-edit" onClick={() => setForm({
                      title: `Edit ${t.name}`, initial: { name: t.name, description: t.description ?? '' },
                      fields: [{ name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description' }],
                      submit: (v) => opFetch(`${base}/teams/${enc(t.id)}`, { method: 'PUT', body: { description: '', ...v } }),
                    })}>Edit</SmallButton>
                    <SmallButton testId="op-team-move" onClick={() => setForm({
                      title: `Move ${t.name}`, description: 'Moves the team, the members who follow it and its team settings to another department.',
                      fields: [{ name: 'departmentId', label: 'To department', type: 'select', options: deptOptions(org).filter((o) => o.value !== t.department_id), required: true }],
                      submit: (v) => opFetch(`${base}/teams/${enc(t.id)}/department`, { method: 'PUT', body: v }),
                    })}>Move</SmallButton>
                    <SmallButton onClick={() => setForm({
                      title: `Team lead of ${t.name}`, fields: [{ name: 'userId', label: 'Person', type: 'select', options: userOptions(org), required: true }],
                      submit: (v) => opFetch(`${base}/teams/${enc(t.id)}/lead`, { method: 'PUT', body: { ...v, replaceLead: true } }),
                    })}>Set lead</SmallButton>
                    {t.is_active
                      ? <SmallButton testId="op-team-archive" onClick={() => run({ title: `Archive ${t.name}`, description: 'The team is hidden from the app; its data is kept. You can restore it.', path: `${base}/teams/${enc(t.id)}/archive`, destructive: true, confirmLabel: 'Archive' })}>Archive</SmallButton>
                      : <SmallButton testId="op-team-restore" onClick={() => run({ title: `Restore ${t.name}`, description: '', path: `${base}/teams/${enc(t.id)}/restore` })}>Restore</SmallButton>}
                    <SmallButton testId="op-team-delete" danger onClick={() => run({
                      title: `Delete ${t.name}`, description: 'Deletes the team and all its data for good (metrics, history, alerts). Its members keep their accounts. This cannot be undone.',
                      path: `${base}/teams/${enc(t.id)}`, method: 'DELETE', destructive: true, typeToConfirm: t.name, typedField: 'confirmName', confirmLabel: 'Delete team for good',
                    })}>Delete</SmallButton>
                  </div>
                </li>
              ))}
              {!teams.length && <li className="px-4 py-2 text-sm text-slate-500">No teams.</li>}
            </ul>
          </Section>
        );
      })}
    </div>
  );
};

export const inviteSpec = (companyId: string, org: Org | null): FormSpec => ({
  title: 'Invite a person',
  description: 'Sends an invitation e-mail; the person chooses their own password. The link is never shown here.',
  initial: { role: 'qa_engineer' },
  fields: [
    { name: 'email', label: 'E-mail', type: 'email', required: true },
    { name: 'role', label: 'Role', type: 'select', options: ROLE_OPTIONS, required: true },
    { name: 'scopeId', label: 'Department', type: 'select', options: deptOptions(org), when: (v) => v.role === 'qa_manager', required: true },
    { name: 'teamScopeId', label: 'Team', type: 'select', options: teamOptions(org), when: (v) => ['team_lead', 'qa_engineer', 'viewer'].includes(v.role), required: true },
  ],
  submit: (v) => opFetch(`/companies/${enc(companyId)}/invitations`, {
    method: 'POST', body: { email: v.email, role: v.role, scopeId: v.role === 'super_admin' ? companyId : v.role === 'qa_manager' ? v.scopeId : v.teamScopeId },
  }),
  doneMessage: (o) => (o.delivery?.delivered ? `Invitation sent to ${o.invitation?.email}` : `Invitation created; the e-mail was not delivered (${o.delivery?.error ?? o.delivery?.channel ?? 'no e-mail channel'})`),
});

const UsersTab: React.FC<TabProps & { onOpenUser: (id: string) => void }> = ({ companyId, org, run, setForm, onOpenUser }) => {
  const { data, error, loading } = useSection<any>(companyId, 'users');
  if (!data) return <Loading loading={loading} error={error} />;
  const base = `/companies/${enc(companyId)}`;
  const grants = (id: string) => data.assignments.filter((a: any) => a.user_id === id).map((a: any) => `${roleLabel(a.role)}: ${a.scope_name ?? a.scope_id}`).join(', ');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={cx(buttonClass.primary, 'h-8 px-2.5 text-xs')} data-testid="op-add-user" onClick={() => setForm({
          title: 'Add a person with a password', initial: { role: 'qa_engineer' },
          fields: [
            { name: 'firstName', label: 'First name', required: true }, { name: 'lastName', label: 'Last name', required: true },
            { name: 'email', label: 'E-mail', type: 'email', required: true },
            { name: 'role', label: 'Role', type: 'select', options: ROLE_OPTIONS, required: true },
            { name: 'teamId', label: 'Primary team', type: 'select', options: teamOptions(org), help: 'Required for team lead, engineer and viewer; super admins and managers may have none.' },
            { name: 'departmentId', label: 'Department', type: 'select', options: deptOptions(org), help: 'Needed when no team is chosen.' },
            { name: 'password', label: 'Password', type: 'password', required: true, help: PASSWORD_RULES_TEXT },
          ],
          submit: (v) => opFetch(`${base}/users`, { method: 'POST', body: v }),
        })}><Plus size={14} /> Add person</button>
        <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} data-testid="op-invite-user" onClick={() => setForm(inviteSpec(companyId, org))}><Plus size={14} /> Invite</button>
      </div>
      <Section title="People" subtitle="Last sign-in from the sign-in records (IP, location, device); sessions as the server checks them now.">
        <DataTable testId="op-users" rows={data.users} rowTestId={(u: any) => `op-user-row-${u.email}`} columns={[
          { key: 'name', label: 'Name', render: (u: any) => (
            <button type="button" className="text-left" onClick={() => onOpenUser(u.id)} data-testid="op-open-user">
              <p className="font-medium text-brand-700 hover:underline dark:text-brand-300">{u.name ?? '—'}</p><p className="break-all text-xs text-slate-500 dark:text-slate-400">{u.email}</p>{u.job_title && <p className="text-xs text-slate-500 dark:text-slate-400">{u.job_title}</p>}
            </button>
          ) },
          { key: 'is_active', label: 'Status', render: (u: any) => <>{u.is_active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Inactive</Badge>} {u.locked && <Badge tone="warn">Locked</Badge>} {u.sso_linked && <Badge>SSO</Badge>}</> },
          { key: 'roles', label: 'Assignments', render: (u: any) => <span className="text-xs">{grants(u.id) || '—'}</span> },
          { key: 'last_sign_in_at', label: 'Last sign-in', render: (u: any) => (u.last_sign_in_at ? (
            <span className="text-xs" data-testid="op-user-last-sign-in"><span className="block">{fmtDate(u.last_sign_in_at)}</span>
              <span className="block text-slate-500">{u.last_sign_in_ip ?? '—'} · {placeText({ city: u.last_sign_in_city, country: u.last_sign_in_country })}</span>
              <span className="block text-slate-500">{deviceText({ browser: u.last_sign_in_browser, os: u.last_sign_in_os, device: u.last_sign_in_device })}</span></span>
          ) : <span className="text-xs">{u.last_login ? fmtDate(u.last_login) : 'Never'}</span>) },
          { key: 'active_sessions', label: 'Sessions now', render: (u: any) => <span data-testid="op-user-sessions">{u.active_sessions}</span> },
          { key: 'last_seen_at', label: 'Last seen', render: (u: any) => fmtDate(u.last_seen_at) },
          { key: 'failed_7d', label: 'Failed 7 d', render: (u: any) => (u.failed_7d ? <Badge tone="warn">{u.failed_7d}</Badge> : '0') },
          { key: 'actions', label: '', render: (u: any) => (
            <div className="flex flex-wrap gap-1">
              <SmallButton testId="op-user-details" onClick={() => onOpenUser(u.id)}>Details</SmallButton>
              {u.is_active
                ? <SmallButton testId="op-user-deactivate" onClick={() => run({ title: 'Deactivate account', description: `${u.name ?? u.email} can no longer sign in; every session is refused.`, path: `${base}/users/${enc(u.id)}/deactivate`, destructive: true, confirmLabel: 'Deactivate' })}>Deactivate</SmallButton>
                : <SmallButton testId="op-user-reactivate" onClick={() => run({ title: 'Reactivate account', description: '', path: `${base}/users/${enc(u.id)}/reactivate` })}>Reactivate</SmallButton>}
            </div>
          ) },
        ]} />
      </Section>
      <Section title="Invitations" subtitle="Status only; links and tokens are never shown.">
        <DataTable testId="op-invitations" rows={data.invitations} columns={[
          { key: 'email', label: 'Email', className: 'break-all' },
          { key: 'role', label: 'Role', render: (i: any) => roleLabel(i.role) },
          { key: 'status', label: 'Status', render: (i: any) => <Badge tone={i.status === 'open' ? 'brand' : i.status === 'accepted' ? 'good' : 'neutral'}>{i.status}</Badge> },
          { key: 'invited_by_name', label: 'Invited by', render: (i: any) => i.invited_by_name ?? i.invited_by_email ?? '—' },
          { key: 'last_sent_at', label: 'Last sent', render: (i: any) => `${fmtDate(i.last_sent_at)} (${i.send_count}×)` },
          { key: 'expires_at', label: 'Expires', render: (i: any) => fmtDate(i.expires_at) },
          { key: 'actions', label: '', render: (i: any) => (i.status === 'open' || i.status === 'expired') ? (
            <div className="flex flex-wrap gap-1">
              <SmallButton testId="op-invitation-resend" onClick={() => run({ title: 'Resend invitation', description: '', path: `${base}/invitations/${enc(i.id)}/resend`, doneMessage: (o) => (o.delivered ? `Invitation re-sent to ${i.email}` : `Not delivered: ${o.error ?? o.channel}`) })}>Resend</SmallButton>
              <SmallButton testId="op-invitation-revoke" danger onClick={() => run({ title: 'Revoke invitation', description: `The link sent to ${i.email} stops working.`, path: `${base}/invitations/${enc(i.id)}/revoke`, destructive: true, confirmLabel: 'Revoke' })}>Revoke</SmallButton>
            </div>
          ) : null },
        ]} />
      </Section>
    </div>
  );
};

export const SessionsTable: React.FC<{ rows: any[]; run: (a: OpAction) => void; companyId: string; showUser?: boolean; onOpenUser?: (id: string) => void; testId?: string }> = ({ rows, run, companyId, showUser, onOpenUser, testId = 'op-sessions' }) => (
  <DataTable testId={testId} rows={rows} rowTestId={(s: any) => `op-session-${s.id}`} empty="No sessions recorded." columns={[
    ...(showUser ? [{ key: 'user', label: 'User', render: (s: any) => <button type="button" className="text-left text-brand-700 hover:underline dark:text-brand-300" onClick={() => onOpenUser?.(s.user_id)}>{s.user_name ?? s.user_email}</button> }] : []),
    { key: 'status', label: 'Status', render: (s: any) => <span data-testid="op-session-status"><SessionBadge status={s.status} /></span> },
    { key: 'issued_at', label: 'Issued', render: (s: any) => fmtDate(s.issued_at) },
    { key: 'expires_at', label: 'Expires', render: (s: any) => fmtDate(s.expires_at) },
    { key: 'last_seen_at', label: 'Last seen', render: (s: any) => fmtDate(s.last_seen_at) },
    { key: 'kind', label: 'Kind', render: (s: any) => `${s.persistent ? 'Kept signed in' : 'Browser session'} · ${s.method ?? ''}` },
    { key: 'ip', label: 'IP (issue / last)', render: (s: any) => `${s.ip ?? '—'}${s.last_ip && s.last_ip !== s.ip ? ` / ${s.last_ip}` : ''}` },
    { key: 'country', label: 'Location', render: (s: any) => `${placeText(s)}${s.last_country && s.last_country !== s.country ? ` / ${s.last_country}` : ''}` },
    { key: 'device', label: 'Device', render: (s: any) => deviceText(s) },
    { key: 'revoked', label: 'Revoked', render: (s: any) => (s.revoked_at ? <span className="text-xs">{fmtDate(s.revoked_at)} · {s.revoked_by}{s.revoke_reason ? ` (${s.revoke_reason})` : ''}</span> : '—') },
    { key: 'actions', label: '', render: (s: any) => (s.status === 'valid' ? (
      <SmallButton testId="op-session-revoke" danger onClick={() => run({ title: 'Revoke session', description: 'This session is refused on its next request; the person signs in again on that device.', path: `/companies/${enc(companyId)}/sessions/${enc(s.id)}/revoke`, destructive: true, confirmLabel: 'Revoke' })}>Revoke</SmallButton>
    ) : null) },
  ]} />
);

const SessionsTab: React.FC<{ companyId: string; run: (a: OpAction) => void; onOpenUser: (id: string) => void }> = ({ companyId, run, onOpenUser }) => {
  const [onlyValid, setOnlyValid] = useState(true);
  const { data, error, loading } = useSection<any>(companyId, 'sessions', onlyValid ? 'status=valid' : '');
  return (
    <Section title="Sessions" subtitle="Company sign-in sessions with their status as the server checks it on each request." action={
      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" checked={onlyValid} onChange={(e) => setOnlyValid(e.target.checked)} data-testid="op-sessions-valid-only" /> Valid only</label>
    }>
      {!data ? <div className="p-4"><Loading loading={loading} error={error} /></div> : <SessionsTable rows={data.sessions} run={run} companyId={companyId} showUser onOpenUser={onOpenUser} />}
    </Section>
  );
};

const ViewsTab: React.FC<{ companyId: string; onOpenUser: (id: string) => void }> = ({ companyId, onOpenUser }) => {
  const { data, error, loading } = useSection<any>(companyId, 'views');
  if (!data) return <Loading loading={loading} error={error} />;
  const top = (r: any) => (r.top_viewers ?? []).map((v: any) => `${v.who?.replace(/ <.*>$/, '') ?? '—'} (${v.n})`).join(', ') || '—';
  const who = (r: any) => (r.last_viewer_id ? <button type="button" className="text-left text-brand-700 hover:underline dark:text-brand-300" onClick={() => onOpenUser(r.last_viewer_id)}>{r.last_viewer}</button> : r.last_viewer ?? '—');
  const cols = [
    { key: 'name', label: 'Name', render: (r: any) => <>{r.name} {!r.is_active && <Badge tone="warn">Inactive</Badge>}</> },
    { key: 'last_view_at', label: 'Last viewed', render: (r: any) => fmtDate(r.last_view_at) },
    { key: 'last_viewer', label: 'By', render: who },
    { key: 'last_route', label: 'What', className: 'break-all text-xs', render: (r: any) => r.last_screen ? `screen ${r.last_screen}` : r.last_route ?? '—' },
    { key: 'views', label: `Views (${data.days} d)` },
    { key: 'top', label: 'Most active viewers', className: 'text-xs', render: top },
  ];
  return (
    <div className="space-y-3" data-testid="op-views">
      <Section title="Teams" subtitle="From the access log: the latest read of the team's pages or data, and who looks most."><DataTable testId="op-views-teams" rows={data.teams} columns={cols} /></Section>
      <Section title="Departments" subtitle="Views of the department or of any of its teams."><DataTable testId="op-views-departments" rows={data.departments} columns={cols} /></Section>
      <Section title={`Most active viewers (${data.days} days)`}>
        <DataTable rows={data.viewers} rowKey={(r: any) => r.user_id} columns={[
          { key: 'who', label: 'Who', render: (r: any) => <button type="button" className="text-left text-brand-700 hover:underline dark:text-brand-300" onClick={() => onOpenUser(r.user_id)}>{r.who}</button> },
          { key: 'views', label: 'Views' }, { key: 'teams', label: 'Teams viewed' }, { key: 'last_at', label: 'Last', render: (r: any) => fmtDate(r.last_at) },
        ]} />
      </Section>
    </div>
  );
};

const SettingsTab: React.FC<TabProps & { summary: any }> = ({ companyId, org, summary, run, setForm }) => {
  const { data, error, loading } = useSection<any>(companyId, 'settings');
  const users = useSection<any>(companyId, 'users');
  const [scope, setScope] = useState('company:');
  const [scopeType, scopeId] = scope.split(':');
  const scopeQs = `scopeType=${scopeType}${scopeId ? `&scopeId=${enc(scopeId)}` : ''}`;
  const targets = useSection<any>(companyId, 'app/targets', scopeQs);
  const rules = useSection<any>(companyId, 'app/alert-rules', scopeQs);
  const intervals = useSection<any>(companyId, 'app/metric-intervals');
  const [lifetime, setLifetime] = useState<string>('');
  if (!data) return <Loading loading={loading} error={error} />;
  const base = `/companies/${enc(companyId)}`;
  const scopeBody = { scopeType, scopeId: scopeId || companyId };
  const current = summary?.company?.sessionLifetimeHours;
  const choices: number[] = summary?.sessionLifetimeChoices ?? [1, 8, 24, 168, 336, 720];
  const hoursLabel = (h: number) => (h < 24 ? `${h} hour${h === 1 ? '' : 's'}` : `${h / 24} day${h === 24 ? '' : 's'}`);
  const scopeSelect = (
    <select aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value)} className={cx(inputClass, 'h-8 text-xs')} data-testid="op-settings-scope">
      <option value="company:">Company</option>
      {deptOptions(org).map((d) => <option key={d.value} value={`department:${d.value}`}>Department: {d.label}</option>)}
      {teamOptions(org).map((t) => <option key={t.value} value={`team:${t.value}`}>Team: {t.label}</option>)}
    </select>
  );
  return (
    <div className="space-y-3">
      <Section title="Sign-in" subtitle="How long a sign-in lasts (the company's Parameters → Sign-in). Shortening it ends longer sessions at once.">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
          <label htmlFor="op-lifetime" className="text-slate-600 dark:text-slate-300">Sign-in lasts</label>
          <select id="op-lifetime" value={lifetime || String(current ?? '')} onChange={(e) => setLifetime(e.target.value)} className={cx(inputClass, 'h-8')} data-testid="op-lifetime">
            {choices.map((h) => <option key={h} value={h}>{hoursLabel(h)}</option>)}
          </select>
          <SmallButton testId="op-lifetime-save" disabled={!lifetime || Number(lifetime) === current} onClick={() => run({
            title: 'Sign-in lasts', description: '', path: `${base}/session-settings`, method: 'PUT', body: { lifetimeHours: Number(lifetime) }, doneMessage: () => `Sign-ins now last ${hoursLabel(Number(lifetime))}`,
          })}>Save</SmallButton>
        </div>
      </Section>

      <Section title="KPI targets" subtitle="Own targets at this scope; empty = inherited (team → department → company → default)." action={scopeSelect}>
        {!targets.data ? <div className="p-4"><Loading loading={targets.loading} error={targets.error} /></div> : (
          <DataTable testId="op-targets" rows={targets.data.metrics} rowKey={(m: any) => m.metric} columns={[
            { key: 'label', label: 'Metric', render: (m: any) => `${m.label}${m.unit ? ` (${m.unit})` : ''}` },
            { key: 'effective', label: 'Applies (good / warning)', render: (m: any) => (m.effective ? `${m.effective.good} / ${m.effective.warning}` : '—') },
            { key: 'own', label: 'Set here', render: (m: any) => (m.own ? `${m.own.good} / ${m.own.warning}` : '—') },
            { key: 'actions', label: '', render: (m: any) => (
              <div className="flex flex-wrap gap-1">
                <SmallButton testId={`op-target-edit-${m.metric}`} onClick={() => setForm({
                  title: `Target: ${m.label}`, initial: { good: m.own?.good ?? m.effective?.good ?? '', warning: m.own?.warning ?? m.effective?.warning ?? '' },
                  fields: [{ name: 'good', label: 'Target (good)', type: 'number', required: true }, { name: 'warning', label: 'Warning level', type: 'number', required: true }],
                  submit: (v) => opFetch(`${base}/targets`, { method: 'PUT', body: { ...scopeBody, targets: { [m.metric]: { good: v.good, warning: v.warning } } } }),
                })}>Edit</SmallButton>
                {m.own && <SmallButton danger onClick={() => run({ title: `Clear the ${m.label} target here`, description: 'The inherited target applies again.', path: `${base}/targets`, method: 'PUT', body: { ...scopeBody, targets: { [m.metric]: null } } })}>Clear</SmallButton>}
              </div>
            ) },
          ]} />
        )}
      </Section>

      <Section title="Alert rules" subtitle="At the scope chosen above." action={scopeSelect}>
        {!rules.data ? <div className="p-4"><Loading loading={rules.loading} error={rules.error} /></div> : (
          <DataTable testId="op-alert-rules" rows={rules.data.rules} rowKey={(r: any) => r.rule} columns={[
            { key: 'label', label: 'Rule', render: (r: any) => <><p>{r.label}</p><p className="text-xs text-slate-500">{r.description}</p></> },
            { key: 'effective', label: 'Applies', render: (r: any) => <>{r.effective?.enabled ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>} <span className="text-xs text-slate-500">({r.effective?.scope})</span></> },
            { key: 'params', label: 'Parameters', className: 'text-xs', render: (r: any) => JSON.stringify(r.effective?.params ?? {}) },
            { key: 'actions', label: '', render: (r: any) => (
              <div className="flex flex-wrap gap-1">
                <SmallButton testId={`op-rule-toggle-${r.rule}`} onClick={() => run({
                  title: `${r.effective?.enabled ? 'Turn off' : 'Turn on'} ${r.label}`, description: '', path: `${base}/alert-rules`, method: 'PUT',
                  body: { ...scopeBody, rules: { [r.rule]: { enabled: !r.effective?.enabled, params: r.effective?.params ?? {} } } },
                })}>{r.effective?.enabled ? 'Turn off' : 'Turn on'}</SmallButton>
                {r.own && <SmallButton onClick={() => run({ title: `Reset ${r.label}`, description: 'The inherited setting applies again.', path: `${base}/alert-rules`, method: 'PUT', body: { ...scopeBody, rules: { [r.rule]: null } }, destructive: true })}>Reset</SmallButton>}
              </div>
            ) },
          ]} />
        )}
      </Section>

      <Section title="Configuration" subtitle="Per scope: team overrides department overrides company. Secret values are masked and can only be replaced." action={
        <SmallButton testId="op-config-set" onClick={() => setForm({
          title: 'Set a configuration value', initial: { scope: 'company:' },
          fields: [
            { name: 'key', label: 'Key', required: true, help: 'For example sla_response_time_ms. The sign-in lifetime has its own setting above.' },
            { name: 'value', label: 'Value (empty = remove)' },
            { name: 'scope', label: 'Scope', type: 'select', required: true, options: [{ value: 'company:', label: 'Company' }, ...deptOptions(org).map((d) => ({ value: `department:${d.value}`, label: `Department: ${d.label}` })), ...teamOptions(org).map((t) => ({ value: `team:${t.value}`, label: `Team: ${t.label}` }))] },
          ],
          submit: (v) => {
            const [st, sid] = String(v.scope).split(':');
            return opFetch(`${base}/configs`, { method: 'POST', body: { configs: { [v.key]: v.value ?? '' }, departmentId: st === 'department' ? sid : undefined, teamId: st === 'team' ? sid : undefined } });
          },
        })}>Set value</SmallButton>
      }>
        <DataTable testId="op-configs" rows={data.configs} columns={[
          { key: 'config_key', label: 'Key' },
          { key: 'scope', label: 'Scope', render: (r: any) => `${r.scope}${r.team_name ? `: ${r.team_name}` : r.department_name ? `: ${r.department_name}` : ''}` },
          { key: 'config_value', label: 'Value', className: 'max-w-xs break-all', render: (r: any) => (r.secret ? <Badge>Hidden</Badge> : r.config_value) },
          { key: 'updated_at', label: 'Updated', render: (r: any) => fmtDate(r.updated_at) },
        ]} />
      </Section>

      <Section title="Expected update frequency">
        {!intervals.data ? <div className="p-4"><Loading loading={intervals.loading} error={intervals.error} /></div> : (
          <DataTable rows={intervals.data.intervals} rowKey={(r: any) => r.metric_key} columns={[
            { key: 'metric_key', label: 'Metric', render: (r: any) => r.custom_label ?? r.metric_key },
            { key: 'every', label: 'Every', render: (r: any) => `${r.interval_value} ${r.interval_unit}${r.is_default ? ' (default)' : ''}` },
            { key: 'actions', label: '', render: (r: any) => (
              <div className="flex flex-wrap gap-1">
                <SmallButton onClick={() => setForm({
                  title: `Update frequency: ${r.custom_label ?? r.metric_key}`, initial: { interval_value: r.interval_value, interval_unit: r.interval_unit },
                  fields: [{ name: 'interval_value', label: 'Every', type: 'number', required: true }, { name: 'interval_unit', label: 'Unit', type: 'select', required: true, options: ['minutes', 'hours', 'days', 'weeks', 'months'].map((u) => ({ value: u, label: u })) }],
                  submit: (v) => opFetch(`${base}/metric-intervals/${enc(r.metric_key)}`, { method: 'PUT', body: v }),
                })}>Edit</SmallButton>
                {!r.is_default && <SmallButton onClick={() => run({ title: 'Back to the default', description: '', path: `${base}/metric-intervals/${enc(r.metric_key)}`, method: 'DELETE', destructive: true })}>Reset</SmallButton>}
              </div>
            ) },
          ]} />
        )}
      </Section>

      <Section title="API keys" subtitle="Name and prefix only; a new key is shown once, when it is created." action={
        <SmallButton testId="op-api-key-create" onClick={() => setForm({
          title: 'Create API key', fields: [{ name: 'name', label: 'Name', required: true }],
          submit: (v) => opFetch(`${base}/api-keys`, { method: 'POST', body: v }),
          showResult: (o) => (o?.plaintextKey ? (
            <div className="space-y-2 text-sm">
              <p>Copy the key now. It is not shown again (only its prefix is kept readable).</p>
              <code className="block break-all rounded bg-slate-100 p-2 text-xs dark:bg-slate-800" data-testid="op-api-key-plain">{o.plaintextKey}</code>
            </div>
          ) : null),
        })}>Create key</SmallButton>
      }>
        <DataTable testId="op-api-keys" rows={users.data?.apiKeys ?? []} columns={[
          { key: 'name', label: 'Name' }, { key: 'key_prefix', label: 'Prefix', render: (k: any) => <code>{k.key_prefix}…</code> },
          { key: 'created_at', label: 'Created', render: (k: any) => fmtDate(k.created_at) },
          { key: 'last_used_at', label: 'Last used', render: (k: any) => fmtDate(k.last_used_at) },
          { key: 'revoked_at', label: 'Status', render: (k: any) => (k.revoked_at ? <Badge tone="bad">Revoked</Badge> : <Badge tone="good">Active</Badge>) },
          { key: 'actions', label: '', render: (k: any) => (!k.revoked_at ? <SmallButton testId="op-api-key-revoke" danger onClick={() => run({ title: `Revoke ${k.name}`, description: 'Requests with this key are refused from now on.', path: `${base}/api-keys/${enc(k.id)}/revoke`, destructive: true, confirmLabel: 'Revoke' })}>Revoke</SmallButton> : null) },
        ]} />
      </Section>

      <Section title="E-mail, Slack and saved views">
        <p className="px-4 pt-3 text-sm text-slate-700 dark:text-slate-300" data-testid="operator-email-channel">
          E-mail (this server): {data.emailChannel === 'resend' ? 'Resend' : data.emailChannel === 'smtp' ? 'SMTP' : 'not configured (written to the server log)'}
        </p>
        <p className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
          Slack: {data.notificationSettings?.slack_configured ? `configured (${data.notificationSettings.slack_webhook_hint ?? 'hidden'}), ${data.notificationSettings.slack_enabled ? 'on' : 'off'}` : 'not configured'}
        </p>
        <DataTable testId="op-saved-views" rows={data.savedViews} columns={[
          { key: 'name', label: 'Saved view' }, { key: 'module', label: 'Module', render: (r: any) => r.module ?? r.kind }, { key: 'owner_name', label: 'Owner' },
          { key: 'shared', label: 'Shared', render: (r: any) => (r.shared ? 'yes' : 'no') }, { key: 'updated_at', label: 'Updated', render: (r: any) => fmtDate(r.updated_at) },
          { key: 'actions', label: '', render: (r: any) => (
            <div className="flex flex-wrap gap-1">
              <SmallButton onClick={() => setForm({ title: 'Rename view', initial: { name: r.name }, fields: [{ name: 'name', label: 'Name', required: true }], submit: (v) => opFetch(`${base}/saved-views/${enc(r.id)}`, { method: 'PUT', body: v }) })}>Rename</SmallButton>
              <SmallButton onClick={() => run({ title: r.shared ? 'Stop sharing' : 'Share with the company', description: '', path: `${base}/saved-views/${enc(r.id)}`, method: 'PUT', body: { shared: !r.shared } })}>{r.shared ? 'Unshare' : 'Share'}</SmallButton>
              <SmallButton danger onClick={() => run({ title: `Delete the view ${r.name}`, description: 'The view is deleted for its owner and everyone it was shared with.', path: `${base}/saved-views/${enc(r.id)}`, method: 'DELETE', destructive: true })}>Delete</SmallButton>
            </div>
          ) },
        ]} />
      </Section>
    </div>
  );
};

const DataTab: React.FC<{ companyId: string; onAction: (a: OpAction) => void }> = ({ companyId, onAction }) => {
  const [teamId, setTeamId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = new URLSearchParams(Object.entries({ teamId, from, to }).filter(([, v]) => v)).toString();
  const { data, error, loading } = useSection<any>(companyId, 'data', params);
  const lbl = 'mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400';
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label htmlFor="op-team" className={lbl}>Team</label>
          <select id="op-team" value={teamId || data?.teamId || ''} onChange={(e) => setTeamId(e.target.value)} className={cx(inputClass, 'w-full')}>
            {(data?.teams ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}{t.is_active ? '' : ' (inactive)'}</option>)}
          </select>
        </div>
        <div><label htmlFor="op-from" className={lbl}>From</label><input id="op-from" type="date" value={from || data?.from || ''} onChange={(e) => setFrom(e.target.value)} className={cx(inputClass, 'w-full')} /></div>
        <div><label htmlFor="op-to" className={lbl}>To</label><input id="op-to" type="date" value={to || data?.to || ''} onChange={(e) => setTo(e.target.value)} className={cx(inputClass, 'w-full')} /></div>
      </div>
      {!data ? <Loading loading={loading} error={error} /> : (
        <>
          <Section title="KPI snapshots" subtitle="Staleness as the app computes it (expected update interval per metric)."
            action={data.teamId && <SmallButton onClick={() => onAction({ title: 'Recompute this team', description: 'Re-derives this team\'s KPI snapshots from its metric values from the start date. No value is changed or deleted.', path: `/companies/${encodeURIComponent(companyId)}/actions/recompute-snapshots`, body: { teamId: data.teamId, from: data.from } })}><RefreshCw size={13} /> Recompute</SmallButton>}>
            <DataTable testId="op-snapshots" rows={data.snapshots} rowKey={(r: any) => r.snapshot_date} columns={[
              { key: 'snapshot_date', label: 'Day' },
              { key: 'qa_score', label: 'QA score' },
              { key: 'status', label: 'Status' },
              { key: 'values', label: 'Values', render: (r: any) => `${r.valueCount - r.staleCount} current, ${r.staleCount} stale` },
              { key: 'sample', label: 'Source', render: (r: any) => (r.sample ? <Badge tone="warn">Sample</Badge> : <Badge tone="good">Real</Badge>) },
            ]} />
          </Section>
          <Section title="Metric values">
            <DataTable rows={data.metricValues} columns={[
              { key: 'recorded_at', label: 'For', render: (r: any) => fmtDate(r.recorded_at) }, { key: 'metric_key', label: 'Metric' }, { key: 'value', label: 'Value' },
              { key: 'source', label: 'Source' }, { key: 'received_at', label: 'Received', render: (r: any) => fmtDate(r.received_at) },
              { key: 'superseded_by', label: 'Corrected', render: (r: any) => (r.superseded_by ? 'yes' : '') },
            ]} />
          </Section>
          <Section title="Ingestion log">
            <DataTable rows={data.ingestion} columns={[
              { key: 'received_at', label: 'Received', render: (r: any) => fmtDate(r.received_at) }, { key: 'channel', label: 'Channel' }, { key: 'source', label: 'Source' },
              { key: 'status', label: 'Status', render: (r: any) => <Badge tone={r.status === 'accepted' ? 'good' : r.status === 'partial' ? 'warn' : 'bad'}>{r.status}</Badge> },
              { key: 'value_count', label: 'Values' }, { key: 'errors', label: 'Errors', className: 'max-w-xs break-all', render: (r: any) => (r.errors ? JSON.stringify(r.errors).slice(0, 200) : '') },
            ]} />
          </Section>
          {data.developers && (
            <Section title="Developer metrics" subtitle="Every person's recorded metrics. Opted in: whether the person shares them inside the company.">
              <DataTable testId="op-developers" rows={data.developers.rows} rowKey={(r: any) => r.developer_id} empty="No developer metrics recorded for this team." columns={[
                { key: 'name', label: 'Developer' }, { key: 'email', label: 'E-mail', className: 'break-all' },
                { key: 'opted_in', label: 'Opted in', render: (r: any) => (r.opted_in ? 'yes' : 'no') },
                { key: 'pr_merge_time_avg', label: 'PR merge (h)' }, { key: 'code_review_time_avg', label: 'Review (h)' },
                { key: 'focus_time_hours', label: 'Focus (h)' }, { key: 'meeting_time_hours', label: 'Meetings (h)' },
                { key: 'context_switches_per_day', label: 'Switches' }, { key: 'happiness_score', label: 'Happiness' },
                { key: 'updated_at', label: 'Updated', render: (r: any) => fmtDate(r.updated_at) },
              ]} />
            </Section>
          )}
        </>
      )}
    </div>
  );
};

const AlertsTab: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { data, error, loading } = useSection<any>(companyId, 'alerts');
  if (!data) return <Loading loading={loading} error={error} />;
  return (
    <div className="space-y-3">
      <Section title="Alerts">
        <DataTable rows={data.alerts} columns={[
          { key: 'created_at', label: 'Opened', render: (r: any) => fmtDate(r.created_at) }, { key: 'team_name', label: 'Team' },
          { key: 'severity', label: 'Severity', render: (r: any) => <Badge tone={r.severity === 'critical' ? 'bad' : r.severity === 'warning' ? 'warn' : 'neutral'}>{r.severity}</Badge> },
          { key: 'message', label: 'Message', className: 'max-w-md' }, { key: 'resolved_at', label: 'Resolved', render: (r: any) => fmtDate(r.resolved_at) },
        ]} />
      </Section>
      <Section title="Alert rules">
        <DataTable rows={data.rules} columns={[{ key: 'rule', label: 'Rule' }, { key: 'scope_type', label: 'Scope' }, { key: 'enabled', label: 'On', render: (r: any) => (r.enabled ? 'yes' : 'no') }, { key: 'params', label: 'Parameters', render: (r: any) => JSON.stringify(r.params) }]} />
      </Section>
      <Section title="Tracked actions">
        <DataTable rows={data.actions} columns={[{ key: 'title', label: 'Action' }, { key: 'team_name', label: 'Team' }, { key: 'status', label: 'Status' }, { key: 'owner_name', label: 'Owner' }, { key: 'due_date', label: 'Due', render: (r: any) => fmtDay(r.due_date) }]} />
      </Section>
      <Section title="Notifications and deliveries">
        <DataTable rows={data.notifications} columns={[{ key: 'created_at', label: 'When', render: (r: any) => fmtDate(r.created_at) }, { key: 'title', label: 'Title' }, { key: 'user_name', label: 'For' }, { key: 'read_at', label: 'Read', render: (r: any) => (r.read_at ? 'yes' : 'no') }]} />
        <DataTable rows={data.deliveries} columns={[{ key: 'created_at', label: 'Queued', render: (r: any) => fmtDate(r.created_at) }, { key: 'channel', label: 'Channel' }, { key: 'kind', label: 'Kind' }, { key: 'status', label: 'Status' }, { key: 'attempts', label: 'Tries' }, { key: 'error', label: 'Error', className: 'max-w-xs break-all' }]} />
      </Section>
    </div>
  );
};

const PulseTab: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { data, error, loading } = useSection<any>(companyId, 'pulse');
  if (!data) return <Loading loading={loading} error={error} />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">Aggregates as the team sees them, every single answer with its comment, and who answered in each period. The app never stores which person gave which answer.</p>
      {data.teams.map((t: any) => (
        <Section key={t.team.id} title={t.team.name} subtitle={`${t.cadence.cadence} · automatic sending ${t.autoSend.enabled ? 'on' : 'off'} · sent to ${t.sentThisPeriod} of ${t.members} this period`}>
          <DataTable rows={t.periods} rowKey={(p: any) => p.start} empty="No closed periods with responses." columns={[
            { key: 'start', label: 'Period', render: (p: any) => `${p.start} – ${p.end}` },
            { key: 'responses', label: 'Responses', render: (p: any) => (p.suppressed ? 'Not shown (fewer than 3)' : p.responses ?? 0) },
            { key: 'responseRate', label: 'Response rate', render: (p: any) => (p.responseRate == null ? '—' : `${p.responseRate}%`) },
            { key: 'score', label: 'Wellbeing', render: (p: any) => p.score ?? '—' },
          ]} />
          <DataTable rows={t.sendLog} columns={[
            { key: 'at', label: 'Sent', render: (s: any) => fmtDate(s.at) }, { key: 'kind', label: 'Kind' }, { key: 'trigger', label: 'How' },
            { key: 'delivered', label: 'Delivered', render: (s: any) => (s.recipients == null ? 'Not shown' : `${s.delivered} of ${s.recipients}`) },
          ]} />
          <DataTable testId="op-pulse-answers" rows={t.answers ?? []} rowKey={(a: any, i?: number) => `${a.period_start}-${i}`} empty="No answers in the last 180 days." columns={[
            { key: 'period_start', label: 'Period' }, { key: 'q_workload', label: 'Workload' }, { key: 'q_focus', label: 'Focus' },
            { key: 'q_support', label: 'Support' }, { key: 'q_energy', label: 'Energy' }, { key: 'q_outlook', label: 'Outlook' },
            { key: 'comment', label: 'Comment', className: 'max-w-md' },
          ]} />
          <DataTable testId="op-pulse-participants" rows={t.participants ?? []} rowKey={(p: any, i?: number) => `${p.period_start}-${p.email}-${i}`} empty="Nobody answered in the last 180 days." columns={[
            { key: 'period_start', label: 'Period' }, { key: 'name', label: 'Answered' }, { key: 'email', label: 'E-mail', className: 'break-all' },
          ]} />
        </Section>
      ))}
    </div>
  );
};

const ModulesTab: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [teamId, setTeamId] = useState('');
  const { data, error, loading } = useSection<any>(companyId, 'modules', teamId ? `teamId=${encodeURIComponent(teamId)}` : '');
  if (!data) return <Loading loading={loading} error={error} />;
  return (
    <div className="space-y-3">
      <div className="max-w-md">
        <label htmlFor="op-modules-team" className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Team</label>
        <select id="op-modules-team" value={teamId || data.teamId || ''} onChange={(e) => setTeamId(e.target.value)} className={cx(inputClass, 'w-full')}>
          {(data.teams ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {data.modules.map((m: any) => {
        const cols = m.rows.length ? Object.keys(m.rows[0]).slice(0, 12) : [];
        return (
          <Section key={m.key} title={m.label} subtitle={`${m.total} row${m.total === 1 ? '' : 's'}; newest ${m.rows.length} shown`}>
            <DataTable testId={`op-module-${m.key}`} rows={m.rows} rowKey={(r: any, i?: number) => String(r.id ?? i)} empty="No rows." columns={cols.map((k) => ({
              key: k, label: k, className: 'max-w-xs break-all',
              render: (r: any) => (r[k] === null || r[k] === undefined ? '' : typeof r[k] === 'object' ? JSON.stringify(r[k]).slice(0, 120) : String(r[k]).slice(0, 120)),
            }))} />
          </Section>
        );
      })}
    </div>
  );
};

const ActivityTab: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [entries, setEntries] = useState<any[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((before?: string | null) => {
    opFetch<any>(`/companies/${encodeURIComponent(companyId)}/activity${before ? `?before=${encodeURIComponent(before)}` : ''}`)
      .then((body) => { setEntries((p) => (before ? [...p, ...body.entries] : body.entries)); setNext(body.nextBefore); })
      .catch((e) => setError(e.message));
  }, [companyId]);
  useEffect(() => { load(); }, [load]);
  return (
    <Section title="Activity log (change history)">
      <ErrorText error={error} />
      <DataTable testId="op-activity" rows={entries} columns={[
        { key: 'created_at', label: 'When', render: (r: any) => fmtDate(r.created_at) }, { key: 'action', label: 'Action' },
        { key: 'summary', label: 'Summary', className: 'max-w-md' }, { key: 'actor_name', label: 'By', render: (r: any) => r.actor_name ?? r.actor_email ?? (r.action.startsWith('platform_support') ? 'Platform support' : 'System') },
      ]} />
      {next && <div className="p-3 text-center"><button type="button" className={buttonClass.secondary} onClick={() => load(next)}>Load older</button></div>}
    </Section>
  );
};

const UserActivityTab: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [facets, setFacets] = useState<ActivityFacets | null>(null);
  const [filters, setFilters] = useState(emptyActivityFilters);
  const load: ActivityLoader = useCallback(async (p) => {
    if (!facets) p.set('facets', 'true');
    const body = await opFetch<any>(`/companies/${encodeURIComponent(companyId)}/user-activity?${p.toString()}`);
    if (body.facets) setFacets(body.facets);
    return body;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- facets are loaded once with the first page
  }, [companyId]);
  return (
    <div className="space-y-2" data-testid="op-access-log">
      <p className="text-xs text-slate-500 dark:text-slate-400">Every request and screen of the company's people and API keys (90 days). Filter by person, type, team, IP or request id.</p>
      <div className="flex justify-end">
        <SmallButton testId="op-user-activity-csv" onClick={() => opDownload(`/companies/${encodeURIComponent(companyId)}/user-activity.csv?${activityParams(filters).toString()}`, 'irongate-user-activity.csv').catch((e) => toast.error(e.message))}><Download size={13} /> CSV</SmallButton>
      </div>
      <UserActivityList load={load} facets={facets} filters={filters} onFiltersChange={setFilters} ipFilter />
    </div>
  );
};

export const ErrorRows: React.FC<{ rows: any[] }> = ({ rows }) => {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No errors.</p>;
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="op-errors">
      {rows.map((e) => (
        <li key={e.id} className="px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="bad">{e.status ?? 'error'}</Badge>
            <span className="text-xs text-slate-500 dark:text-slate-400">{fmtDate(e.created_at)}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{e.function_name}</span>
            {e.company_name && <span className="text-xs text-slate-500 dark:text-slate-400">{e.company_name}</span>}
          </div>
          <p className="mt-1 break-all font-mono text-xs text-slate-800 dark:text-slate-200">{e.method} {e.route}</p>
          <p className="mt-0.5 break-words text-slate-900 dark:text-slate-100">{e.error_name}: {e.error_message}</p>
          <p className="mt-0.5 break-all text-xs text-slate-500 dark:text-slate-400">Request id {e.request_id ?? '—'}</p>
          {e.stack && (
            <button type="button" className="mt-1 text-xs font-medium text-brand-700 dark:text-brand-300" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
              {open === e.id ? 'Hide stack' : 'Show stack'}
            </button>
          )}
          {open === e.id && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-[11px] text-slate-700 dark:bg-slate-950 dark:text-slate-300">{e.stack}</pre>}
        </li>
      ))}
    </ul>
  );
};

const ErrorsTab: React.FC<{ companyId: string }> = ({ companyId }) => {
  const [rid, setRid] = useState('');
  const [q, setQ] = useState('');
  const { data, error, loading } = useSection<any>(companyId, 'errors', q ? `requestId=${encodeURIComponent(q)}` : '');
  return (
    <Section title="Server errors" subtitle="5xx answers for this company, last 30 days."
      action={<form onSubmit={(e) => { e.preventDefault(); setQ(rid.trim()); }} className="flex gap-2"><input aria-label="Request id" value={rid} onChange={(e) => setRid(e.target.value)} placeholder="Request id" className={cx(inputClass, 'w-44')} /><button className={buttonClass.secondary} type="submit">Find</button></form>}>
      {!data ? <div className="p-4"><Loading loading={loading} error={error} /></div> : <ErrorRows rows={data.errors} />}
    </Section>
  );
};

export default OperatorCompany;
