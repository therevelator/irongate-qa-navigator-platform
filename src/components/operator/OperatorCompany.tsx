import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Badge, SegmentedControl, StatTile, buttonClass, cx, inputClass } from '../ui';
import { opFetch } from '../../lib/operatorClient';
import { ROLE_LABELS } from '../../lib/policyActor';
import UserActivityList, { type ActivityFacets, type ActivityLoader } from '../UserActivityList';
import { emptyActivityFilters } from '../../lib/userActivityFilters';
import { ActionDialog, DataTable, ErrorText, Section, type RepairAction } from './OperatorBits';
import { fmtDate, fmtDay } from './format';

/** One company in the platform operator panel: tabs, each loaded (and recorded) on its own. */

type Tab = 'organisation' | 'users' | 'settings' | 'data' | 'alerts' | 'pulse' | 'activity' | 'user-activity' | 'errors';
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'organisation', label: 'Organisation' }, { value: 'users', label: 'Users' }, { value: 'settings', label: 'Settings & targets' },
  { value: 'data', label: 'Data' }, { value: 'alerts', label: 'Alerts & actions' }, { value: 'pulse', label: 'Wellbeing pulse' },
  { value: 'activity', label: 'Activity' }, { value: 'user-activity', label: 'User activity' }, { value: 'errors', label: 'Errors' },
];

const roleLabel = (r: string) => ROLE_LABELS[r] ?? r;

function useSection<T = any>(companyId: string, section: string, reason: string, params = '') {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await opFetch<T>(`/companies/${encodeURIComponent(companyId)}/${section}${params ? `?${params}` : ''}`, { reason }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [companyId, section, reason, params]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load };
}

const Loading: React.FC<{ loading: boolean; error: string | null }> = ({ loading, error }) =>
  error ? <ErrorText error={error} /> : loading ? <p className="text-sm text-slate-500 dark:text-slate-400" role="status">Loading…</p> : null;

const ActionButton: React.FC<{ onClick: () => void; children: React.ReactNode; testId?: string }> = ({ onClick, children, testId }) => (
  <button type="button" onClick={onClick} className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} data-testid={testId}>{children}</button>
);

const OperatorCompany: React.FC<{ company: { id: string; name: string }; reason: string; onBack: () => void }> = ({ company, reason, onBack }) => {
  const [tab, setTab] = useState<Tab>('organisation');
  const [action, setAction] = useState<RepairAction | null>(null);
  const [bump, setBump] = useState(0);
  const summary = useSection<any>(company.id, 'summary', reason);
  const c = summary.data?.counts;
  const base = `/companies/${encodeURIComponent(company.id)}`;

  return (
    <div className="space-y-4" data-testid="operator-company">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onBack} className={cx(buttonClass.secondary, 'h-8 px-2.5')} aria-label="Back to all companies"><ArrowLeft size={15} /></button>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-white">{company.name}</h2>
            <p className="break-all text-xs text-slate-500 dark:text-slate-400">{company.id} · Reason: {reason}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton testId="op-evaluate-alerts" onClick={() => setAction({ title: 'Re-run alert evaluation', description: `Evaluates the alert rules of ${company.name} now (opens and resolves alerts as the hourly job would).`, path: `${base}/actions/evaluate-alerts` })}>Re-run alerts</ActionButton>
          <ActionButton testId="op-recompute" onClick={() => setAction({ title: 'Recompute KPI snapshots', description: `Re-derives the KPI snapshots of every active team of ${company.name} from their metric values for the last 30 days. No value is changed or deleted.`, path: `${base}/actions/recompute-snapshots` })}>Recompute snapshots</ActionButton>
        </div>
      </div>

      {c && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Users" value={c.active_users} caption={`${c.users} in total`} />
          <StatTile label="Departments" value={c.departments} />
          <StatTile label="Teams" value={c.teams} />
          <StatTile label="Open alerts" value={c.open_alerts} tone={c.open_alerts ? 'warn' : 'neutral'} />
          <StatTile label="Errors (24 h)" value={c.errors_24h} tone={c.errors_24h ? 'bad' : 'neutral'} />
          <StatTile label="Onboarding" value={summary.data?.onboarding?.complete ? 'Done' : summary.data?.onboardingState?.dismissed_at ? 'Hidden' : 'Open'} />
        </div>
      )}

      <div className="max-w-full overflow-x-auto pb-1">
        <SegmentedControl value={tab} onChange={setTab} options={TABS} />
      </div>

      <div key={`${tab}-${bump}`}>
        {tab === 'organisation' && <OrganisationTab companyId={company.id} reason={reason} />}
        {tab === 'users' && <UsersTab companyId={company.id} reason={reason} onAction={setAction} />}
        {tab === 'settings' && <SettingsTab companyId={company.id} reason={reason} />}
        {tab === 'data' && <DataTab companyId={company.id} reason={reason} onAction={setAction} />}
        {tab === 'alerts' && <AlertsTab companyId={company.id} reason={reason} />}
        {tab === 'pulse' && <PulseTab companyId={company.id} reason={reason} />}
        {tab === 'activity' && <ActivityTab companyId={company.id} reason={reason} />}
        {tab === 'user-activity' && <UserActivityTab companyId={company.id} reason={reason} />}
        {tab === 'errors' && <ErrorsTab companyId={company.id} reason={reason} />}
      </div>

      <ActionDialog action={action} onClose={() => setAction(null)} onDone={() => { setBump((b) => b + 1); summary.reload(); }} />
    </div>
  );
};

const OrganisationTab: React.FC<{ companyId: string; reason: string }> = ({ companyId, reason }) => {
  const { data, error, loading } = useSection<any>(companyId, 'organisation', reason);
  if (!data) return <Loading loading={loading} error={error} />;
  const userName = (id: string) => data.users.find((u: any) => u.id === id)?.name ?? data.users.find((u: any) => u.id === id)?.email ?? id;
  const byTeam = (teamId: string) => data.assignments.filter((a: any) => a.scope_type === 'team' && a.scope_id === teamId);
  const groups = [...data.departments, { id: null, name: 'No department', is_active: true }];
  return (
    <div className="space-y-3" data-testid="op-organisation">
      <Section title="Company roles" subtitle="Super admins">
        <ul className="px-4 py-3 text-sm text-slate-800 dark:text-slate-200">
          {data.assignments.filter((a: any) => a.scope_type === 'company').map((a: any) => <li key={a.id}>{userName(a.user_id)} — {roleLabel(a.role)}</li>)}
        </ul>
      </Section>
      {groups.map((d: any) => {
        const teams = data.teams.filter((t: any) => (t.department_id ?? null) === d.id);
        const managers = data.assignments.filter((a: any) => a.scope_type === 'department' && a.scope_id === d.id);
        if (d.id === null && !teams.length) return null;
        return (
          <Section key={d.id ?? 'none'} title={d.name} subtitle={<>{!d.is_active && <Badge tone="warn">Inactive</Badge>} {managers.length ? `Managers: ${managers.map((m: any) => userName(m.user_id)).join(', ')}` : 'No manager'}</>}>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {teams.map((t: any) => (
                <li key={t.id} className="px-4 py-2 text-sm">
                  <p className="font-medium text-slate-900 dark:text-white">{t.name} {!t.is_active && <Badge tone="warn">Inactive</Badge>}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {byTeam(t.id).map((a: any) => `${userName(a.user_id)} (${roleLabel(a.role)})`).join(' · ') || 'No members'}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
    </div>
  );
};

const UsersTab: React.FC<{ companyId: string; reason: string; onAction: (a: RepairAction) => void }> = ({ companyId, reason, onAction }) => {
  const { data, error, loading } = useSection<any>(companyId, 'users', reason);
  if (!data) return <Loading loading={loading} error={error} />;
  const base = `/companies/${encodeURIComponent(companyId)}`;
  const grants = (id: string) => data.assignments.filter((a: any) => a.user_id === id).map((a: any) => `${roleLabel(a.role)}: ${a.scope_name ?? a.scope_id}`).join(', ');
  return (
    <div className="space-y-3">
      <Section title="Users" subtitle={data.lockoutNote}>
        <DataTable testId="op-users" rows={data.users} columns={[
          { key: 'name', label: 'Name', render: (u: any) => <><p className="font-medium">{u.name ?? '—'}</p><p className="break-all text-xs text-slate-500 dark:text-slate-400">{u.email}</p></> },
          { key: 'is_active', label: 'Status', render: (u: any) => <>{u.is_active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Inactive</Badge>} {u.locked && <Badge tone="warn">Locked</Badge>} {u.sso_linked && <Badge>SSO</Badge>}</> },
          { key: 'roles', label: 'Assignments', render: (u: any) => <span className="text-xs">{grants(u.id) || '—'}</span> },
          { key: 'last_login', label: 'Last sign-in', render: (u: any) => fmtDate(u.last_login) },
          { key: 'created_at', label: 'Created', render: (u: any) => fmtDay(u.created_at) },
          { key: 'actions', label: '', render: (u: any) => (
            <div className="flex flex-wrap gap-1">
              <ActionButton testId={`op-user-${u.is_active ? 'deactivate' : 'reactivate'}`} onClick={() => onAction({
                title: u.is_active ? 'Deactivate account' : 'Reactivate account',
                description: `${u.is_active ? 'Deactivates' : 'Reactivates'} the account of ${u.name ?? u.email}. A super admin of the company can undo this in their Activity log.`,
                path: `${base}/users/${encodeURIComponent(u.id)}/${u.is_active ? 'deactivate' : 'reactivate'}`,
              })}>{u.is_active ? 'Deactivate' : 'Reactivate'}</ActionButton>
              {(u.failed_login_attempts > 0 || u.locked_until) && (
                <ActionButton onClick={() => onAction({ title: 'Clear sign-in lockout', description: `Resets the failed sign-in count and lockout of ${u.name ?? u.email}.`, path: `${base}/users/${encodeURIComponent(u.id)}/clear-lockout` })}>Clear lockout</ActionButton>
              )}
            </div>
          ) },
        ]} />
      </Section>
      <Section title="Invitations" subtitle="Status only; links and tokens are never shown.">
        <DataTable rows={data.invitations} columns={[
          { key: 'email', label: 'Email', className: 'break-all' },
          { key: 'role', label: 'Role', render: (i: any) => roleLabel(i.role) },
          { key: 'status', label: 'Status', render: (i: any) => <Badge tone={i.status === 'open' ? 'brand' : i.status === 'accepted' ? 'good' : 'neutral'}>{i.status}</Badge> },
          { key: 'last_sent_at', label: 'Last sent', render: (i: any) => `${fmtDate(i.last_sent_at)} (${i.send_count}×)` },
          { key: 'expires_at', label: 'Expires', render: (i: any) => fmtDate(i.expires_at) },
          { key: 'actions', label: '', render: (i: any) => (i.status === 'open' || i.status === 'expired') ? (
            <ActionButton onClick={() => onAction({ title: 'Resend invitation', description: `Sends ${i.email} a new invitation e-mail. The previous link stops working.`, path: `${base}/invitations/${encodeURIComponent(i.id)}/resend` })}>Resend</ActionButton>
          ) : null },
        ]} />
      </Section>
      <Section title="API keys" subtitle="Name and prefix only; the key itself is never stored in readable form.">
        <DataTable rows={data.apiKeys} columns={[
          { key: 'name', label: 'Name' }, { key: 'key_prefix', label: 'Prefix', render: (k: any) => <code>{k.key_prefix}…</code> },
          { key: 'created_at', label: 'Created', render: (k: any) => fmtDate(k.created_at) },
          { key: 'last_used_at', label: 'Last used', render: (k: any) => fmtDate(k.last_used_at) },
          { key: 'revoked_at', label: 'Status', render: (k: any) => (k.revoked_at ? <Badge tone="bad">Revoked</Badge> : <Badge tone="good">Active</Badge>) },
        ]} />
      </Section>
    </div>
  );
};

const SettingsTab: React.FC<{ companyId: string; reason: string }> = ({ companyId, reason }) => {
  const { data, error, loading } = useSection<any>(companyId, 'settings', reason);
  if (!data) return <Loading loading={loading} error={error} />;
  return (
    <div className="space-y-3">
      <Section title="Configuration" subtitle="Per scope: team overrides department overrides company. Secret values are masked.">
        <DataTable testId="op-configs" rows={data.configs} columns={[
          { key: 'config_key', label: 'Key' },
          { key: 'scope', label: 'Scope', render: (r: any) => `${r.scope}${r.team_name ? `: ${r.team_name}` : r.department_name ? `: ${r.department_name}` : ''}` },
          { key: 'config_value', label: 'Value', className: 'max-w-xs break-all', render: (r: any) => (r.secret ? <Badge>Hidden</Badge> : r.config_value) },
          { key: 'updated_at', label: 'Updated', render: (r: any) => fmtDate(r.updated_at) },
        ]} />
      </Section>
      <Section title="Target history">
        <DataTable rows={data.targets} columns={[
          { key: 'metric_key', label: 'Metric' }, { key: 'scope_type', label: 'Scope', render: (r: any) => `${r.scope_type} ${r.scope_id}` },
          { key: 'good', label: 'Good' }, { key: 'warning', label: 'Warning' },
          { key: 'valid_from', label: 'From', render: (r: any) => fmtDay(r.valid_from) }, { key: 'valid_to', label: 'To', render: (r: any) => fmtDay(r.valid_to) },
        ]} />
      </Section>
      <Section title="Update frequency (overrides)">
        <DataTable rows={data.intervals} rowKey={(r: any) => r.metric_key} columns={[{ key: 'metric_key', label: 'Metric' }, { key: 'interval', label: 'Every', render: (r: any) => `${r.interval_value} ${r.interval_unit}` }]} />
      </Section>
      <Section title="Slack and saved views">
        <p className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
          Slack: {data.notificationSettings?.slack_configured ? `configured (${data.notificationSettings.slack_webhook_hint ?? 'hidden'}), ${data.notificationSettings.slack_enabled ? 'on' : 'off'}` : 'not configured'}
        </p>
        <DataTable rows={data.savedViews} columns={[
          { key: 'name', label: 'Saved view' }, { key: 'module', label: 'Module' }, { key: 'owner_name', label: 'Owner' },
          { key: 'shared', label: 'Shared', render: (r: any) => (r.shared ? 'yes' : 'no') }, { key: 'updated_at', label: 'Updated', render: (r: any) => fmtDate(r.updated_at) },
        ]} />
      </Section>
    </div>
  );
};

const DataTab: React.FC<{ companyId: string; reason: string; onAction: (a: RepairAction) => void }> = ({ companyId, reason, onAction }) => {
  const [teamId, setTeamId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = new URLSearchParams(Object.entries({ teamId, from, to }).filter(([, v]) => v)).toString();
  const { data, error, loading } = useSection<any>(companyId, 'data', reason, params);
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
            action={data.teamId && <ActionButton onClick={() => onAction({ title: 'Recompute this team', description: 'Re-derives this team\'s KPI snapshots from its metric values from the start date. No value is changed or deleted.', path: `/companies/${encodeURIComponent(companyId)}/actions/recompute-snapshots`, body: { teamId: data.teamId, from: data.from } })}><RefreshCw size={13} /> Recompute</ActionButton>}>
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
            <Section title="Developer metrics" subtitle={`Team figures need at least 3 developers who opted in. Individual rows: only people who opted in. ${data.developers.summary?.privacy?.suppressed ? 'Team figures: not shown (fewer than 3).' : ''}`}>
              <DataTable rows={data.developers.optedInRows} rowKey={(r: any) => r.developer_id} empty="Nobody on this team has opted in." columns={[
                { key: 'name', label: 'Developer' }, { key: 'pr_merge_time_avg', label: 'PR merge (h)' }, { key: 'code_review_time_avg', label: 'Review (h)' },
                { key: 'focus_time_hours', label: 'Focus (h)' }, { key: 'meeting_time_hours', label: 'Meetings (h)' },
              ]} />
            </Section>
          )}
        </>
      )}
    </div>
  );
};

const AlertsTab: React.FC<{ companyId: string; reason: string }> = ({ companyId, reason }) => {
  const { data, error, loading } = useSection<any>(companyId, 'alerts', reason);
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

const PulseTab: React.FC<{ companyId: string; reason: string }> = ({ companyId, reason }) => {
  const { data, error, loading } = useSection<any>(companyId, 'pulse', reason);
  if (!data) return <Loading loading={loading} error={error} />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">Only the aggregates the team sees (at least 3 responses). Single answers and comments are never shown here.</p>
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
        </Section>
      ))}
    </div>
  );
};

const ActivityTab: React.FC<{ companyId: string; reason: string }> = ({ companyId, reason }) => {
  const [entries, setEntries] = useState<any[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((before?: string | null) => {
    opFetch<any>(`/companies/${encodeURIComponent(companyId)}/activity${before ? `?before=${encodeURIComponent(before)}` : ''}`, { reason })
      .then((body) => { setEntries((p) => (before ? [...p, ...body.entries] : body.entries)); setNext(body.nextBefore); })
      .catch((e) => setError(e.message));
  }, [companyId, reason]);
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

const UserActivityTab: React.FC<{ companyId: string; reason: string }> = ({ companyId, reason }) => {
  const [facets, setFacets] = useState<ActivityFacets | null>(null);
  const [filters, setFilters] = useState(emptyActivityFilters);
  const load: ActivityLoader = useCallback(async (p) => {
    if (!facets) p.set('facets', 'true');
    const body = await opFetch<any>(`/companies/${encodeURIComponent(companyId)}/user-activity?${p.toString()}`, { reason });
    if (body.facets) setFacets(body.facets);
    return body;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- facets are loaded once with the first page
  }, [companyId, reason]);
  return <UserActivityList load={load} facets={facets} filters={filters} onFiltersChange={setFilters} />;
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

const ErrorsTab: React.FC<{ companyId: string; reason: string }> = ({ companyId, reason }) => {
  const [rid, setRid] = useState('');
  const [q, setQ] = useState('');
  const { data, error, loading } = useSection<any>(companyId, 'errors', reason, q ? `requestId=${encodeURIComponent(q)}` : '');
  return (
    <Section title="Server errors" subtitle="5xx answers for this company, last 30 days."
      action={<form onSubmit={(e) => { e.preventDefault(); setQ(rid.trim()); }} className="flex gap-2"><input aria-label="Request id" value={rid} onChange={(e) => setRid(e.target.value)} placeholder="Request id" className={cx(inputClass, 'w-44')} /><button className={buttonClass.secondary} type="submit">Find</button></form>}>
      {!data ? <div className="p-4"><Loading loading={loading} error={error} /></div> : <ErrorRows rows={data.errors} />}
    </Section>
  );
};

export default OperatorCompany;
