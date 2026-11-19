import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Search, UserCog } from 'lucide-react';
import Modal from './Modal';
import API_URL from '../config/api';
import { ROLE_LABELS } from '../lib/policyActor';
import { buttonClass, cx, inputClass } from './ui';

/**
 * Assigning department QA managers and team leads (Departments page, super_admin only).
 * The rules and the consequence wording come from the server (server/lib/roleAssignment.ts):
 * every dialog asks for a dry run and shows its consequences before the admin confirms.
 */

export interface CompanyUser {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
  is_active: boolean;
  department_id: string | null;
  department_name: string | null;
  primary_team_id: string | null;
  team_name: string | null;
  /** Teams the user is assigned to (role assignments). */
  team_ids?: string[];
}

const ROLE_LABEL = ROLE_LABELS;

const fullName = (u: CompanyUser) => `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email;

/* ------------------------------------------------------------------------------------------ */

/**
 * Searchable single-select of users (combobox + listbox): type to filter by name, email, role,
 * department or team; arrow keys move, Enter picks. Shows each person's current role and place.
 */
export const UserPicker: React.FC<{
  users: CompanyUser[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** Ids to list first (e.g. the team's own members). */
  preferredIds?: Set<string>;
  preferredLabel?: string;
}> = ({ users, value, onChange, label, preferredIds, preferredLabel }) => {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputId = useId();
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const LIMIT = 80;

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = users.filter((u) =>
      !needle || `${fullName(u)} ${u.email} ${ROLE_LABEL[u.role] ?? u.role} ${u.department_name ?? ''} ${u.team_name ?? ''}`.toLowerCase().includes(needle));
    return filtered.sort((a, b) => {
      const pa = preferredIds?.has(a.id) ? 0 : 1;
      const pb = preferredIds?.has(b.id) ? 0 : 1;
      return pa - pb || fullName(a).localeCompare(fullName(b));
    });
  }, [users, q, preferredIds]);
  const shown = matches.slice(0, LIMIT);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) onChange(shown[active].id); }
  };
  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      <div className="rounded-md border border-slate-300 dark:border-slate-700">
        <div className="relative border-b border-slate-200 dark:border-slate-700">
          <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id={inputId}
            data-autofocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown[active] ? optionId(active) : undefined}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search by name, email, role or department"
            className="h-9 w-full rounded-t-md bg-white pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500/40 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <ul ref={listRef} id={listId} role="listbox" aria-label={label} className="max-h-56 overflow-y-auto py-1">
          {shown.length === 0 && <li className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">No active user matches.</li>}
          {shown.map((u, i) => {
            const selected = u.id === value;
            const firstOther = preferredIds && preferredIds.size > 0 && i > 0 && preferredIds.has(shown[i - 1].id) && !preferredIds.has(u.id);
            return (
              <React.Fragment key={u.id}>
                {preferredLabel && i === 0 && preferredIds?.has(u.id) && (
                  <li role="presentation" className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{preferredLabel}</li>
                )}
                {firstOther && (
                  <li role="presentation" className="mt-1 border-t border-slate-100 px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">Everyone else</li>
                )}
                <li
                  id={optionId(i)}
                  data-index={i}
                  role="option"
                  aria-selected={selected}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange(u.id); setActive(i); }}
                  className={cx(
                    'flex cursor-pointer items-center gap-3 px-3 py-2 text-sm',
                    i === active && 'bg-slate-100 dark:bg-slate-800',
                    selected && 'bg-brand-50 dark:bg-brand-950/40',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900 dark:text-white">{fullName(u)}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{u.email}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs">
                    <span className="block text-slate-700 dark:text-slate-300">{ROLE_LABEL[u.role] ?? u.role}</span>
                    <span className="block max-w-[200px] truncate text-slate-500 dark:text-slate-400" title={u.team_name ? `Team: ${u.team_name}` : undefined}>{u.department_name || 'No department'}</span>
                  </span>
                  <Check size={16} aria-hidden="true" className={cx('shrink-0 text-brand-700 dark:text-brand-300', !selected && 'invisible')} />
                </li>
              </React.Fragment>
            );
          })}
          {matches.length > shown.length && (
            <li role="presentation" className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">Showing {shown.length} of {matches.length}; type to narrow.</li>
          )}
        </ul>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------------------------------ */

export type AssignmentRequest =
  | { kind: 'assign_manager'; departmentId: string; departmentName: string; excludeIds: string[] }
  | { kind: 'remove_manager'; departmentId: string; departmentName: string; user: { id: string; name: string }; teams: Array<{ id: string; name: string }>; currentTeamId: string | null }
  | { kind: 'assign_lead'; teamId: string; teamName: string; currentLeadId: string | null; currentLeadName: string | null };

interface Plan { user: { id: string; name: string }; consequences: string[]; role: { from: string; to: string } }

export const AssignmentDialog: React.FC<{
  request: AssignmentRequest | null;
  users: CompanyUser[];
  onClose: () => void;
  onDone: () => void;
}> = ({ request, users, onClose, onDone }) => {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'qa_engineer' | 'viewer'>('qa_engineer');
  const [teamId, setTeamId] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const teamField = useId();

  useEffect(() => {
    setUserId(request?.kind === 'remove_manager' ? request.user.id : '');
    setRole('qa_engineer');
    setTeamId(request?.kind === 'remove_manager' ? (request.currentTeamId ?? request.teams[0]?.id ?? '') : '');
    setPlan(null);
    setError(null);
  }, [request]);

  const endpoint = (): { url: string; method: string; body: Record<string, unknown> } | null => {
    if (!request || !userId) return null;
    if (request.kind === 'assign_manager') {
      return { url: `/admin/departments/${encodeURIComponent(request.departmentId)}/managers`, method: 'POST', body: { userId } };
    }
    if (request.kind === 'remove_manager') {
      return {
        url: `/admin/departments/${encodeURIComponent(request.departmentId)}/managers/${encodeURIComponent(userId)}/remove`,
        method: 'POST',
        body: { role, teamId: teamId || undefined },
      };
    }
    return { url: `/admin/teams/${encodeURIComponent(request.teamId)}/lead`, method: 'PUT', body: { userId } };
  };

  // Dry run whenever the choice changes: the server validates and words the consequences.
  useEffect(() => {
    const ep = endpoint();
    if (!ep) { setPlan(null); setError(null); return; }
    let cancelled = false;
    setChecking(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API_URL}${ep.url}`, {
          method: ep.method, credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...ep.body, dryRun: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) setPlan(data);
        else { setPlan(null); setError(data.error || `Could not check this change (${res.status})`); }
      } catch {
        if (!cancelled) { setPlan(null); setError('Could not reach the server to check this change'); }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, userId, role, teamId]);

  const candidates = useMemo(() => {
    if (!request || request.kind === 'remove_manager') return [];
    const exclude = new Set(request.kind === 'assign_manager' ? request.excludeIds : request.currentLeadId ? [request.currentLeadId] : []);
    return users.filter((u) => u.is_active && !exclude.has(u.id));
  }, [request, users]);
  const teamMemberIds = useMemo(
    () => new Set(request?.kind === 'assign_lead'
      ? users.filter((u) => u.primary_team_id === request.teamId || (u.team_ids ?? []).includes(request.teamId)).map((u) => u.id)
      : []),
    [request, users],
  );

  if (!request) return null;

  const confirm = async () => {
    const ep = endpoint();
    if (!ep || !plan) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}${ep.url}`, {
        method: ep.method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ep.body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || 'Could not save the change'); return; }
      const who = plan.user.name;
      toast.success(
        request.kind === 'assign_manager' ? `${who} is now a manager of ${request.departmentName}`
          : request.kind === 'remove_manager' ? `${who} is no longer a manager of ${request.departmentName}`
          : `${who} is now team lead of ${request.teamName}`,
      );
      onDone();
    } catch {
      toast.error('Could not save the change: the server did not respond');
    } finally {
      setSaving(false);
    }
  };

  const title = request.kind === 'assign_manager' ? `Assign a department manager to ${request.departmentName}`
    : request.kind === 'remove_manager' ? `Remove ${request.user.name} as manager`
    : `Assign team lead for ${request.teamName}`;
  const subtitle = request.kind === 'assign_manager' ? 'Managers see every team of their department and manage its teams and users. A department can have several.'
    : request.kind === 'remove_manager' ? `They stay in ${request.departmentName} with the role you choose.`
    : request.currentLeadName ? `Current lead: ${request.currentLeadName}.` : 'This team has no lead yet.';
  const action = request.kind === 'assign_manager' ? 'Make department manager' : request.kind === 'remove_manager' ? 'Remove as manager' : 'Make team lead';

  return (
    <Modal isOpen onClose={onClose} title={title} subtitle={subtitle} size="prose">
      <div className="space-y-4">
        {request.kind === 'remove_manager' ? (
          <>
            <fieldset>
              <legend className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">New role</legend>
              <div className="grid grid-cols-2 gap-2">
                {(['qa_engineer', 'viewer'] as const).map((r, i) => (
                  <label key={r} className={cx(
                    'flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2.5 text-sm',
                    role === r ? 'border-brand-600 bg-brand-50 dark:border-brand-400 dark:bg-brand-950/40' : 'border-slate-300 dark:border-slate-700',
                  )}>
                    <input type="radio" name="new-role" value={r} checked={role === r} onChange={() => setRole(r)} data-autofocus={i === 0 ? true : undefined} className="mt-0.5 accent-brand-700" />
                    <span>
                      <span className="block font-medium text-slate-900 dark:text-white">{ROLE_LABEL[r]}{r === 'qa_engineer' ? ' (default)' : ''}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{r === 'qa_engineer' ? 'Works on one team' : 'Read-only, one team'}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor={teamField} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Team</label>
              <select id={teamField} value={teamId} onChange={(e) => setTeamId(e.target.value)} className={cx(inputClass, 'w-full pr-8')}>
                {role === 'viewer' && <option value="">No team</option>}
                {request.teams.length === 0 && role !== 'viewer' && <option value="">No active team in {request.departmentName}</option>}
                {request.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </>
        ) : (
          <UserPicker
            label="Person"
            users={candidates}
            value={userId}
            onChange={setUserId}
            preferredIds={teamMemberIds}
            preferredLabel={request.kind === 'assign_lead' ? `On ${request.teamName}` : undefined}
          />
        )}

        <div aria-live="polite">
          {error && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>
          )}
          {!error && checking && <p className="text-sm text-slate-500 dark:text-slate-400">Checking what changes…</p>}
          {!error && !checking && plan && (
            <div className="rounded-md border border-slate-200 dark:border-slate-700">
              <p className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <UserCog size={14} aria-hidden="true" /> What changes
              </p>
              <ul className="space-y-1.5 px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                {plan.consequences.map((line, i) => (
                  <li key={i} className="flex gap-2"><span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />{line}</li>
                ))}
              </ul>
              <p className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Takes effect on their next request; they do not need to sign in again. Recorded under Activity, where it can be undone.
              </p>
            </div>
          )}
          {!error && !checking && !plan && request.kind !== 'remove_manager' && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Choose a person to see what changes.</p>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onClose} className={buttonClass.secondary}>Cancel</button>
        <button type="button" onClick={confirm} disabled={!plan || saving || checking} className={cx(buttonClass.primary, 'disabled:cursor-not-allowed')}>
          {saving ? 'Saving…' : action}
        </button>
      </div>
    </Modal>
  );
};
