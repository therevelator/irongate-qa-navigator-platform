import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { Badge, buttonClass, cx } from '../ui';
import { opFetch } from '../../lib/operatorClient';
import { ROLE_LABELS } from '../../lib/policyActor';
import { DataTable, ErrorText, FormDialog, Section, SmallButton, useOpActions, type FormSpec } from './OperatorBits';
import AuthEventsList from './OperatorAuthEvents';
import { ROLE_OPTIONS, SessionsTable, deptOptions, scopeOptions, teamOptions, type Org } from './OperatorCompany';
import { fmtDate } from './format';

/**
 * One person of a company (platform operator panel): profile, role assignments, teams, every
 * sign-in (successful and failed), every session with its status and a Revoke button, recent
 * activity, and the account actions (edit, reset password, sign out everywhere, deactivate,
 * delete). Changes use the company app's own rules on the server.
 */

const roleLabel = (r: string) => ROLE_LABELS[r] ?? r;
const enc = encodeURIComponent;

const OperatorUser: React.FC<{ companyId: string; companyName: string; userId: string; org: Org | null; onBack: () => void }> = ({ companyId, companyName, userId, org, onBack }) => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormSpec | null>(null);
  const [gone, setGone] = useState(false);
  const base = `/companies/${enc(companyId)}`;
  const ubase = `${base}/users/${enc(userId)}`;
  const load = useCallback(() => {
    opFetch<any>(ubase).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  }, [ubase]);
  useEffect(() => { load(); }, [load]);
  const { run, dialog } = useOpActions((out) => { if (out?.deleted) { setGone(true); onBack(); } else load(); });
  if (gone) return null;
  if (!data) return error ? <ErrorText error={error} /> : <p className="text-sm text-slate-500" role="status">Loading…</p>;
  const u = data.user;
  const who = u.name ?? u.email;

  const editProfile = () => setForm({
    title: `Edit ${who}`, initial: { firstName: u.first_name ?? '', lastName: u.last_name ?? '', email: u.email, jobTitle: u.job_title ?? '' },
    fields: [
      { name: 'firstName', label: 'First name', required: true }, { name: 'lastName', label: 'Last name', required: true },
      { name: 'email', label: 'E-mail', type: 'email', required: true },
      { name: 'jobTitle', label: 'Job title', help: 'Shown in the top bar and on Team detail; empty = the role label.' },
    ],
    submit: (v) => opFetch(ubase, { method: 'PUT', body: { ...v, jobTitle: v.jobTitle ?? '' } }),
  });
  const editRole = () => setForm({
    title: `Role and primary team of ${who}`,
    description: 'Changes the person\'s primary assignment (other assignments stay).',
    initial: { role: u.role, departmentId: u.department_id ?? '', primaryTeamId: u.primary_team_id ?? '' },
    fields: [
      { name: 'role', label: 'Role', type: 'select', options: ROLE_OPTIONS.filter((r) => r.value !== 'super_admin'), required: true, help: 'Super admin: add a company assignment below.' },
      { name: 'departmentId', label: 'Department', type: 'select', options: deptOptions(org), required: true },
      { name: 'primaryTeamId', label: 'Primary team', type: 'select', options: teamOptions(org) },
    ],
    submit: (v) => opFetch(ubase, { method: 'PUT', body: { role: v.role, departmentId: v.departmentId, primaryTeamId: v.primaryTeamId ?? null } }),
  });
  const addAssignment = () => setForm({
    title: `Add an assignment to ${who}`, initial: { role: 'qa_engineer' },
    fields: [
      { name: 'role', label: 'Role', type: 'select', options: ROLE_OPTIONS, required: true },
      { name: 'scopeId', label: 'Department', type: 'select', options: scopeOptions(org, 'qa_manager'), when: (v) => v.role === 'qa_manager', required: true },
      { name: 'teamId', label: 'Team', type: 'select', options: scopeOptions(org, 'qa_engineer'), when: (v) => ['team_lead', 'qa_engineer', 'viewer'].includes(v.role), required: true },
      { name: 'replaceLead', label: 'Replace the current team lead', type: 'checkbox', when: (v) => v.role === 'team_lead' },
    ],
    submit: (v) => opFetch(`${ubase}/assignments`, {
      method: 'POST',
      body: { role: v.role, scopeId: v.role === 'super_admin' ? companyId : v.role === 'qa_manager' ? v.scopeId : v.teamId, replaceLead: v.replaceLead === true },
    }),
  });

  return (
    <div className="space-y-4" data-testid="op-user-detail">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onBack} className={cx(buttonClass.secondary, 'h-8 px-2.5')} aria-label={`Back to ${companyName}`} data-testid="op-user-back"><ArrowLeft size={15} /></button>
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
              <span data-testid="op-user-name">{who}</span>
              {u.is_active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Inactive</Badge>}
              {u.locked && <Badge tone="warn">Locked</Badge>}
            </h2>
            <p className="break-all text-xs text-slate-500 dark:text-slate-400">{u.email} · {companyName} · {roleLabel(u.role)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <SmallButton testId="op-user-edit" onClick={editProfile}>Edit profile</SmallButton>
          <SmallButton testId="op-user-role" onClick={editRole}>Role / team</SmallButton>
          <SmallButton testId="op-user-reset-password" onClick={() => setForm({
            title: `Set a new password for ${who}`, description: 'Every session of this person ends.', destructive: true,
            fields: [{ name: 'newPassword', label: 'New password', type: 'password', required: true, help: 'At least 8 characters.' }],
            submit: (v) => opFetch(`${ubase}/reset-password`, { method: 'POST', body: { ...v, confirm: true } }),
          })}>Set password</SmallButton>
          <SmallButton testId="op-user-reset-link" onClick={() => run({ title: 'Send a reset link', description: '', path: `${ubase}/send-reset-link`, doneMessage: (o) => o.message ?? 'Reset link sent' })}>Send reset link</SmallButton>
          <SmallButton testId="op-user-sign-out" onClick={() => run({ title: 'Sign out everywhere', description: `Ends every session of ${who} on every device. They can sign in again at once.`, path: `${ubase}/sign-out-everywhere`, destructive: true, confirmLabel: 'Sign out everywhere' })}>Sign out everywhere</SmallButton>
          {(u.failed_login_attempts > 0 || u.locked_until) && <SmallButton onClick={() => run({ title: 'Clear lockout', description: '', path: `${ubase}/clear-lockout` })}>Clear lockout</SmallButton>}
          {u.is_active
            ? <SmallButton testId="op-user-deactivate" onClick={() => run({ title: 'Deactivate account', description: `${who} can no longer sign in; every session is refused.`, path: `${ubase}/deactivate`, destructive: true, confirmLabel: 'Deactivate' })}>Deactivate</SmallButton>
            : <SmallButton testId="op-user-reactivate" onClick={() => run({ title: 'Reactivate account', description: '', path: `${ubase}/reactivate` })}>Reactivate</SmallButton>}
          <SmallButton testId="op-user-delete" danger onClick={() => run({
            title: `Delete ${who}`, description: 'Deletes the account for good: sessions, assignments, notifications and own saved views go with it. History entries keep their text. This cannot be undone.',
            path: ubase, method: 'DELETE', destructive: true, typeToConfirm: u.email, typedField: 'confirmEmail', confirmLabel: 'Delete for good',
          })}>Delete</SmallButton>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Section title="Profile">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-3 text-sm">
            <dt className="text-slate-500">Job title</dt><dd data-testid="op-user-job-title">{u.job_title ?? '—'}</dd>
            <dt className="text-slate-500">Department</dt><dd>{u.department_name ?? '—'}</dd>
            <dt className="text-slate-500">Primary team</dt><dd>{u.primary_team_name ?? '—'}</dd>
            <dt className="text-slate-500">Created</dt><dd>{fmtDate(u.created_at)}</dd>
            <dt className="text-slate-500">Last sign-in</dt><dd>{fmtDate(u.last_login)}</dd>
            <dt className="text-slate-500">Password</dt><dd>{u.password_set ? 'Set' : 'None (SSO only)'}</dd>
            <dt className="text-slate-500">Single sign-on</dt><dd>{u.sso?.length ? u.sso.map((s: any) => s.provider).join(', ') : 'Not linked'}</dd>
            <dt className="text-slate-500">Signed out everywhere</dt><dd>{fmtDate(u.sessions_valid_after)}</dd>
            <dt className="text-slate-500">Failed sign-ins in a row</dt><dd>{u.failed_login_attempts ?? 0}</dd>
          </dl>
        </Section>
        <Section title="Role assignments and teams" action={<SmallButton testId="op-user-add-assignment" onClick={addAssignment}><Plus size={13} /> Add</SmallButton>}>
          <DataTable testId="op-user-assignments" rows={data.assignments} empty="No assignments." columns={[
            { key: 'role', label: 'Role', render: (a: any) => roleLabel(a.role) },
            { key: 'scope', label: 'Where', render: (a: any) => `${a.scope_type}: ${a.scope_name ?? a.scope_id}` },
            { key: 'created_at', label: 'Since', render: (a: any) => fmtDate(a.created_at) },
            { key: 'actions', label: '', render: (a: any) => (
              <SmallButton testId="op-user-remove-assignment" danger onClick={() => run({ title: `Remove ${roleLabel(a.role)} of ${a.scope_name ?? a.scope_id}`, description: '', path: `${ubase}/assignments/${enc(a.id)}`, method: 'DELETE', destructive: true, confirmLabel: 'Remove' })}>Remove</SmallButton>
            ) },
          ]} />
          <p className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400" data-testid="op-user-teams">Teams: {data.teams.map((t: any) => `${t.name} (${roleLabel(t.role)})`).join(', ') || 'none'}</p>
        </Section>
      </div>

      <Section title="Sessions" subtitle="Valid = accepted on the next request. Revoke ends one session; Sign out everywhere ends all.">
        <SessionsTable rows={data.sessions} run={run} companyId={companyId} testId="op-user-sessions" />
      </Section>

      <Section title="Sign-in history" subtitle="Successful and failed sign-ins with IP, location and device (180 days).">
        <AuthEventsList base={base} fixedUserId={u.id} />
      </Section>

      <Section title="Recent activity" subtitle="The latest 100 requests and screens of this person (Access log tab for more).">
        <DataTable testId="op-user-activity" rows={data.activity} columns={[
          { key: 'created_at', label: 'When', render: (r: any) => fmtDate(r.created_at) },
          { key: 'label', label: 'What' }, { key: 'categoryLabel', label: 'Type' }, { key: 'team_name', label: 'Team' },
          { key: 'status', label: 'Status' }, { key: 'ip', label: 'IP' },
        ]} />
      </Section>
      {dialog}
      <FormDialog spec={form} onClose={() => setForm(null)} onDone={load} />
    </div>
  );
};

export default OperatorUser;
