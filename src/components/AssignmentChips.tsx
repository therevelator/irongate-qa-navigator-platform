import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, X } from 'lucide-react';
import API_URL from '../config/api';
import Modal from './Modal';
import { buttonClass, cx, inputClass } from './ui';
import { canGrant, ROLE_RANK, highestRole, isCompanyAdmin, type PolicyActor } from '../../server/lib/userPolicy';
import { ROLE_LABELS, type GrantRoleOption } from '../lib/policyActor';

/**
 * A user's role assignments as chips (role · scope), with remove buttons and "Add" for the
 * assignments the signed-in user may give (shared rule canGrant). Changes go to
 * POST / DELETE /api/admin/users/:id/assignments, are recorded in the change history and apply
 * to the person's next request.
 */

export interface AssignmentRow {
  id: string;
  role: string;
  scope_type: 'company' | 'department' | 'team';
  scope_id: string;
  scope_name: string | null;
  department_id: string | null;
  department_name: string | null;
}

const CHIP_TONE: Record<string, string> = {
  super_admin: 'bg-brand-50 text-brand-800 ring-brand-200 dark:bg-brand-950/40 dark:text-brand-200 dark:ring-brand-900',
  qa_manager: 'bg-brand-50 text-brand-800 ring-brand-200 dark:bg-brand-950/40 dark:text-brand-200 dark:ring-brand-900',
  team_lead: 'bg-slate-100 text-slate-800 ring-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600',
  qa_engineer: 'bg-white text-slate-700 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700',
  viewer: 'bg-white text-slate-600 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700',
};

async function call(method: 'POST' | 'DELETE', url: string, body?: object) {
  const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const AssignmentChips: React.FC<{
  actor: PolicyActor;
  user: { id: string; role: string; first_name: string; last_name: string; is_active: boolean; assignments?: AssignmentRow[] };
  teams: Array<{ id: string; department_id: string | null }>;
  options: GrantRoleOption[];
  onChanged: () => void;
}> = ({ actor, user, teams, options, onChanged }) => {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const list = user.assignments ?? [];
  const isSelf = actor.id === user.id;
  // Same guard as the server: never your own, never someone of your rank or above (unless super admin).
  const mayChange = !isSelf && (isCompanyAdmin(actor) || (ROLE_RANK[user.role] ?? 0) < (ROLE_RANK[highestRole(actor)] ?? 0));
  const teamOf = (id: string) => teams.find((t) => t.id === id) ?? null;
  const canRemove = (a: AssignmentRow) => mayChange && canGrant(actor, { role: a.role, scopeType: a.scope_type, scopeId: a.scope_id }, a.scope_type === 'team' ? teamOf(a.scope_id) : null);
  const name = `${user.first_name} ${user.last_name}`.trim();

  const remove = async (a: AssignmentRow) => {
    setBusy(a.id);
    try {
      await call('DELETE', `${API_URL}/admin/users/${user.id}/assignments/${a.id}`);
      toast.success(`${name}: removed ${ROLE_LABELS[a.role] ?? a.role} of ${a.scope_name ?? ''}`);
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="assignment-chips">
      {list.length === 0 && <span className="text-xs text-slate-500 dark:text-slate-400">No assignment: no access to team data</span>}
      {list.map((a) => (
        <span key={a.id} className={cx('inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-2.5 text-xs font-medium ring-1 ring-inset', CHIP_TONE[a.role] ?? CHIP_TONE.viewer, canRemove(a) ? 'pr-1' : 'pr-2.5')} data-testid="assignment-chip">
          <span className="truncate" title={a.department_name && a.scope_type === 'team' ? `${a.scope_name} (${a.department_name})` : a.scope_name ?? ''}>
            {ROLE_LABELS[a.role] ?? a.role} · {a.scope_type === 'company' ? 'Organisation' : a.scope_name ?? '—'}
          </span>
          {canRemove(a) && (
            <button type="button" onClick={() => remove(a)} disabled={busy === a.id}
              className="rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500/40 dark:hover:bg-slate-700 dark:hover:text-white"
              aria-label={`Remove ${ROLE_LABELS[a.role] ?? a.role} of ${a.scope_name ?? 'the organisation'} from ${name}`}>
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {mayChange && user.is_active && options.length > 0 && (
        <button type="button" onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:border-brand-500 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/40 dark:border-slate-600 dark:text-slate-300 dark:hover:text-brand-300"
          aria-label={`Add an assignment for ${name}`} data-testid="add-assignment">
          <Plus size={12} aria-hidden="true" /> Add
        </button>
      )}
      <AddAssignmentDialog isOpen={adding} onClose={() => setAdding(false)} userId={user.id} userName={name} options={options} existing={list}
        onAdded={() => { setAdding(false); onChanged(); }} />
    </div>
  );
};

const AddAssignmentDialog: React.FC<{
  isOpen: boolean; onClose: () => void; userId: string; userName: string; options: GrantRoleOption[]; existing: AssignmentRow[]; onAdded: () => void;
}> = ({ isOpen, onClose, userId, userName, options, existing, onAdded }) => {
  const [role, setRole] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [replaceLead, setReplaceLead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    const first = options.find((o) => o.role === 'qa_engineer') ?? options[0];
    setRole(first?.role ?? ''); setScopeId(first?.scopes[0]?.id ?? ''); setReplaceLead(false); setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [isOpen]);

  const opt = options.find((o) => o.role === role);
  const scope = opt?.scopes.find((s) => s.id === scopeId);
  const current = existing.find((a) => a.scope_id === scopeId);
  const leadTaken = role === 'team_lead' && !!scope?.leadName;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await call('POST', `${API_URL}/admin/users/${userId}/assignments`, { role, scopeId, replaceLead: leadTaken && replaceLead });
      toast.success(`${userName}: added ${ROLE_LABELS[role]} of ${scope?.name ?? ''}`);
      onAdded();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Add an assignment for ${userName}`} subtitle="Applies on their next request; recorded in the change history." size="sm">
      <form onSubmit={submit} className="space-y-4">
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        <div>
          <label htmlFor="assign-role" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Role</label>
          <select id="assign-role" data-autofocus value={role} className={cx(inputClass, 'w-full')} data-testid="assign-role"
            onChange={(e) => { setRole(e.target.value); setScopeId(options.find((o) => o.role === e.target.value)?.scopes[0]?.id ?? ''); setReplaceLead(false); }}>
            {options.map((o) => <option key={o.role} value={o.role}>{o.label}</option>)}
          </select>
        </div>
        {opt && opt.scopes[0]?.scopeType !== 'company' && (
          <div>
            <label htmlFor="assign-scope" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{opt.scopes[0]?.scopeType === 'department' ? 'Department' : 'Team'}</label>
            <select id="assign-scope" value={scopeId} onChange={(e) => { setScopeId(e.target.value); setReplaceLead(false); }} className={cx(inputClass, 'w-full')} data-testid="assign-scope">
              {opt.scopes.map((s) => <option key={s.id} value={s.id}>{s.name}{s.departmentName ? ` (${s.departmentName})` : ''}</option>)}
            </select>
          </div>
        )}
        {current && current.role !== role && (
          <p className="text-xs text-slate-600 dark:text-slate-300">Replaces their {ROLE_LABELS[current.role] ?? current.role} assignment on {current.scope_name}.</p>
        )}
        {leadTaken && (
          <label className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
            <input type="checkbox" checked={replaceLead} onChange={(e) => setReplaceLead(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500" />
            <span>{scope?.name} is led by {scope?.leadName}. Replace them (they stay on the team as a QA engineer).</span>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={buttonClass.primary} disabled={busy || !role || !scopeId || (leadTaken && !replaceLead)} data-testid="assign-submit">{busy ? 'Saving…' : 'Add assignment'}</button>
        </div>
      </form>
    </Modal>
  );
};

export default AssignmentChips;
