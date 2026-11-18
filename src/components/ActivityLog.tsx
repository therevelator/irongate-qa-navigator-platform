import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronUp, History, RotateCcw, Search } from 'lucide-react';
import API_URL from '../config/api';
import Modal from './Modal';
import { Badge, Card, EmptyState, Page, PageIntro, buttonClass, cx, inputClass, type Tone } from './ui';
import { ROLE_LABELS } from '../lib/policyActor';

/**
 * Activity (change history): every organisation, role, team, department, user, assignment and
 * configuration change, newest first, with filters. super_admin sees the whole company; a QA
 * manager the changes that concern the departments they manage. Reversible changes (role and
 * assignment changes, team move, team lead change, department rename, user deactivation) have an
 * Undo button; the server refuses (and explains) when a newer change touches the same people,
 * team or department, or the state changed since.
 */

interface Grant { role: string; scopeType: string; scopeId: string }
interface Snapshot { id: string; name: string; email: string; role: string; is_active: boolean; department_id: string | null; primary_team_id: string | null; grants: Grant[] }

interface Entry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  before: any;
  after: any;
  department_ids: string[];
  created_at: string;
  undone_at: string | null;
  undo_of: string | null;
  actor_name: string | null;
  actor_email: string | null;
  undone_by_name: string | null;
  reversible: boolean;
  canUndo: boolean;
  undoBlockedReason: string | null;
}

interface Facets {
  actions: Array<{ action: string; n: number }>;
  actors: Array<{ id: string; name: string | null; email: string | null }>;
  departments: Array<{ id: string; name: string }>;
}

const ENTITY_LABEL: Record<string, string> = {
  user: 'People', team: 'Teams', department: 'Departments', assignment: 'Assignments', invitation: 'Invitations',
  config: 'Settings', api_key: 'API keys', company: 'Organisation',
};

/** Plain-language action names (the raw action is the key). */
const ACTION_LABEL: Record<string, string> = {
  'assignment.grant': 'Assignment added', 'assignment.revoke': 'Assignment removed',
  'user.create': 'User added', 'user.update': 'User changed', 'user.deactivate': 'User deactivated', 'user.activate': 'User reactivated',
  'user.password_reset': 'Password reset', 'user.developer_insights': 'Developer insights',
  'department.manager_assign': 'Manager assigned', 'department.manager_remove': 'Manager removed',
  'department.create': 'Department created', 'department.rename': 'Department renamed', 'department.deactivate': 'Department deleted', 'department.activate': 'Department reactivated',
  'team.create': 'Team created', 'team.update': 'Team changed', 'team.move': 'Team moved', 'team.lead_change': 'Team lead changed',
  'team.deactivate': 'Team deactivated', 'team.activate': 'Team reactivated',
  'invitation.create': 'Invitation sent', 'invitation.resend': 'Invitation re-sent', 'invitation.revoke': 'Invitation revoked', 'invitation.accept': 'Invitation accepted',
  'config.update': 'Settings changed', 'config.metric_interval': 'Update frequency', 'config.pipeline': 'Pipeline settings',
  'api_key.create': 'API key created', 'api_key.revoke': 'API key revoked', 'sso.link': 'Single sign-on linked', 'company.create': 'Organisation created',
  undo: 'Undo',
};
const actionLabel = (a: string) => ACTION_LABEL[a] ?? a;
const actionTone = (a: string): Tone =>
  a === 'undo' ? 'warn' : /deactivate|revoke|remove/.test(a) ? 'bad' : /grant|assign|create|activate|accept/.test(a) ? 'good' : 'neutral';

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const grantText = (g: Grant) => `${ROLE_LABELS[g.role] ?? g.role} (${g.scopeType})`;

/** Before → after, in words (users: role, status and assignments; others: changed fields). */
const Details: React.FC<{ e: Entry }> = ({ e }) => {
  if (e.before?.users || e.after?.users) {
    const ids = [...new Set([...Object.keys(e.before?.users ?? {}), ...Object.keys(e.after?.users ?? {})])];
    return (
      <div className="space-y-3">
        {ids.map((id) => {
          const b: Snapshot | undefined = e.before?.users?.[id];
          const a: Snapshot | undefined = e.after?.users?.[id];
          const key = (g: Grant) => `${g.role}|${g.scopeType}|${g.scopeId}`;
          const added = (a?.grants ?? []).filter((g) => !(b?.grants ?? []).some((x) => key(x) === key(g)));
          const removed = (b?.grants ?? []).filter((g) => !(a?.grants ?? []).some((x) => key(x) === key(g)));
          return (
            <div key={id} className="text-xs">
              <p className="font-medium text-slate-800 dark:text-slate-100">{a?.name ?? b?.name} <span className="font-normal text-slate-500 dark:text-slate-400">{a?.email ?? b?.email}</span></p>
              <ul className="mt-1 space-y-0.5 text-slate-600 dark:text-slate-300">
                {b && a && b.role !== a.role && <li>Role: {ROLE_LABELS[b.role] ?? b.role} → {ROLE_LABELS[a.role] ?? a.role}</li>}
                {b && a && b.is_active !== a.is_active && <li>Status: {b.is_active ? 'active' : 'inactive'} → {a.is_active ? 'active' : 'inactive'}</li>}
                {added.map((g) => <li key={`+${key(g)}`} className="text-green-700 dark:text-green-400">+ {grantText(g)}</li>)}
                {removed.map((g) => <li key={`-${key(g)}`} className="text-red-700 dark:text-red-400">− {grantText(g)}</li>)}
                {b && a && b.role === a.role && b.is_active === a.is_active && !added.length && !removed.length && <li>Profile details</li>}
              </ul>
            </div>
          );
        })}
      </div>
    );
  }
  const rows = Object.keys({ ...(e.before ?? {}), ...(e.after ?? {}) })
    .filter((k) => !['movedUserIds', 'revokedMemberships', 'grants', 'userId'].includes(k))
    .map((k) => [k, e.before?.[k], e.after?.[k]] as const);
  if (!rows.length) return <p className="text-xs text-slate-500 dark:text-slate-400">No further details recorded.</p>;
  const show = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'object' && v && 'role' in v && 'scopeType' in v) return grantText(v as Grant);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmt(v);
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  };
  const label = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return (
    <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1 text-xs">
      {rows.map(([k, b, a]) => (
        <React.Fragment key={k}>
          <dt className="truncate text-slate-500 dark:text-slate-400">{label(k)}</dt>
          <dd className="break-words text-slate-700 dark:text-slate-200">{e.before ? `${show(b)} → ${show(a)}` : show(a)}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
};

const ActivityLog: React.FC = () => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ q: '', entityType: '', action: '', actorId: '', departmentId: '', from: '', to: '', reversible: false });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [moreFilters, setMoreFilters] = useState(false);
  const [confirm, setConfirm] = useState<Entry | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, String(v)); });
    return p;
  }, [filters]);

  const load = useCallback(async (more = false) => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams(query);
      p.set('limit', '50');
      if (more && nextBefore) p.set('before', nextBefore);
      const res = await fetch(`${API_URL}/admin/audit?${p.toString()}`, { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Could not load the change history (${res.status})`);
      setEntries((prev) => (more ? [...prev, ...body.entries] : body.entries));
      setNextBefore(body.nextBefore ?? null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [query, nextBefore]);

  useEffect(() => {
    const t = setTimeout(() => { load(false); }, filters.q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the filters change
  }, [query]);

  useEffect(() => {
    fetch(`${API_URL}/admin/audit/facets`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null)).then((f) => f && setFacets(f)).catch(() => undefined);
  }, []);

  const set = (k: keyof typeof filters, v: string | boolean) => setFilters((f) => ({ ...f, [k]: v }));
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const doUndo = async () => {
    if (!confirm) return;
    setUndoing(true);
    setUndoError(null);
    try {
      const res = await fetch(`${API_URL}/admin/audit/${confirm.id}/undo`, { method: 'POST', credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Undo failed (${res.status})`);
      toast.success(body.summary || 'Change undone');
      setConfirm(null);
      await load(false);
    } catch (e: any) {
      setUndoError(e.message);
    } finally {
      setUndoing(false);
    }
  };

  const labelCls = 'mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400';
  return (
    <Page>
      <PageIntro
        title="Activity"
        description="Changes to the organisation, roles, teams, departments, people and settings. Reversible changes can be undone while nothing newer touches the same thing."
      />

      <Card className="mb-4" padded>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor="act-q" className={labelCls}>Search</label>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input id="act-q" value={filters.q} onChange={(e) => set('q', e.target.value)} placeholder="Name, team, department…" className={cx(inputClass, 'w-full pl-8')} />
            </div>
          </div>
          <div>
            <label htmlFor="act-type" className={labelCls}>What</label>
            <select id="act-type" value={filters.entityType} onChange={(e) => set('entityType', e.target.value)} className={cx(inputClass, 'w-full')}>
              <option value="">Everything</option>
              {Object.entries(ENTITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="act-action" className={labelCls}>Change</label>
            <select id="act-action" value={filters.action} onChange={(e) => set('action', e.target.value)} className={cx(inputClass, 'w-full')}>
              <option value="">Any change</option>
              {(facets?.actions ?? []).map((a) => <option key={a.action} value={a.action}>{actionLabel(a.action)} ({a.n})</option>)}
            </select>
          </div>
          <button type="button" onClick={() => setMoreFilters((v) => !v)} aria-expanded={moreFilters} aria-controls="act-more"
            className="inline-flex items-center gap-1 justify-self-start text-sm font-medium text-brand-700 hover:text-brand-800 sm:hidden dark:text-brand-300">
            {moreFilters ? 'Fewer filters' : 'More filters'} {moreFilters ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </button>
          <div id="act-more" className={cx('contents', !moreFilters && 'max-sm:hidden')}>
          <div>
            <label htmlFor="act-actor" className={labelCls}>By</label>
            <select id="act-actor" value={filters.actorId} onChange={(e) => set('actorId', e.target.value)} className={cx(inputClass, 'w-full')}>
              <option value="">Anyone</option>
              {(facets?.actors ?? []).map((a) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
            </select>
          </div>
          {(facets?.departments.length ?? 0) > 1 && (
            <div>
              <label htmlFor="act-dept" className={labelCls}>Department</label>
              <select id="act-dept" value={filters.departmentId} onChange={(e) => set('departmentId', e.target.value)} className={cx(inputClass, 'w-full')}>
                <option value="">All departments</option>
                {facets!.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="act-from" className={labelCls}>From</label>
            <input id="act-from" type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} className={cx(inputClass, 'w-full')} />
          </div>
          <div>
            <label htmlFor="act-to" className={labelCls}>To</label>
            <input id="act-to" type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} className={cx(inputClass, 'w-full')} />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={filters.reversible} onChange={(e) => set('reversible', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500 dark:border-slate-600" />
            Only changes that can be undone
          </label>
          </div>
        </div>
      </Card>

      <Card padded={false}>
        {error ? (
          <p role="alert" className="px-5 py-6 text-sm text-red-700 dark:text-red-400">{error}</p>
        ) : !loading && entries.length === 0 ? (
          <EmptyState icon={<History size={28} />} title="No changes match" description="Changes appear here as soon as someone makes them." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="activity-list">
            {entries.map((e) => (
              <li key={e.id} className="px-4 py-3 sm:px-5" data-testid="activity-row">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={actionTone(e.action)}>{actionLabel(e.action)}</Badge>
                      {e.undone_at && <Badge tone="warn">Undone</Badge>}
                      <span className="text-xs text-slate-500 dark:text-slate-400">{fmt(e.created_at)}</span>
                    </div>
                    <p className={cx('mt-1 text-sm text-slate-900 dark:text-slate-100', e.undone_at && 'line-through decoration-slate-400')}>{e.summary}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      By {e.actor_name || e.actor_email || 'the system'}
                      {e.undone_at ? ` · undone by ${e.undone_by_name ?? 'someone'} on ${fmt(e.undone_at)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {(e.before || e.after) && (
                      <button type="button" onClick={() => toggle(e.id)} aria-expanded={open.has(e.id)} aria-controls={`act-details-${e.id}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/40 dark:text-slate-300 dark:hover:bg-slate-800">
                        Details {open.has(e.id) ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                      </button>
                    )}
                    {e.reversible && !e.undone_at && (
                      e.canUndo ? (
                        <button type="button" onClick={() => { setUndoError(null); setConfirm(e); }} className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} data-testid="undo-btn">
                          <RotateCcw size={14} aria-hidden="true" /> Undo
                        </button>
                      ) : (
                        e.undoBlockedReason ? <span className="max-w-[16rem] text-right text-xs text-slate-500 dark:text-slate-400">{e.undoBlockedReason}</span> : null
                      )
                    )}
                  </div>
                </div>
                {open.has(e.id) && (
                  <div id={`act-details-${e.id}`} className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                    <Details e={e} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {(loading || nextBefore) && (
          <div className="border-t border-slate-100 px-5 py-3 text-center dark:border-slate-800">
            {loading ? <span className="text-sm text-slate-500 dark:text-slate-400" role="status">Loading…</span>
              : <button type="button" onClick={() => load(true)} className={buttonClass.secondary}>Load older changes</button>}
          </div>
        )}
      </Card>

      <Modal isOpen={!!confirm} onClose={() => setConfirm(null)} title="Undo this change?" size="sm">
        {confirm && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700 dark:text-slate-200">{confirm.summary}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              The previous state is restored in one step and the undo is recorded here. If something newer changed the same people, team or department, nothing is changed and you are told why.
            </p>
            {undoError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" data-testid="undo-error">{undoError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonClass.secondary} onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className={buttonClass.primary} onClick={doUndo} disabled={undoing} data-testid="undo-confirm">
                <RotateCcw size={15} aria-hidden="true" /> {undoing ? 'Undoing…' : 'Undo'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Page>
  );
};

export default ActivityLog;
