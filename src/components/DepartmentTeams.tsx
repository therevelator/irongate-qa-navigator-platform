import React, { useEffect, useId, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowRightLeft, ChevronRight, Plus, ShieldCheck, UserMinus, UserPlus, Users, UsersRound } from 'lucide-react';
import Modal from './Modal';
import API_URL from '../config/api';
import { Badge, EmptyState, buttonClass, cx, inputClass, type Tone } from './ui';
import { QA_SCORE_THRESHOLDS, qaStatusFromScore } from '../../server/lib/metricFormulas';
import type { AssignmentRequest } from './RoleAssignment';

/**
 * Department detail on the Departments page: the department's teams (active and inactive)
 * and moving teams between departments. What a move changes is decided by the server
 * (server/lib/teamDepartment.ts); the confirm dialog shows the server's own dry-run plan.
 */

export interface DepartmentOption {
  id: string;
  name: string;
}

export interface DepartmentTeam {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  department_id: string;
  /** Active members: primary team or team_members (server/lib/teamMembership). */
  member_count: number;
  team_lead_name: string | null;
  /** The lead team_lead_name names: teams.lead_id, else the fallback team_lead. */
  team_lead_id: string | null;
  qa_score: number | null;
  snapshot_date: string | null;
}

export interface DepartmentDetail {
  department: { id: string; name: string; description: string | null; is_active: boolean };
  managers: Array<{ id: string; name: string; email: string; primary_team_id: string | null }>;
  teams: DepartmentTeam[];
}

/** A team that can be pulled into a department (from GET /admin/teams). */
export interface CandidateTeam {
  id: string;
  name: string;
  department_id: string;
  department_name?: string | null;
}

interface Person { id: string; name: string; email: string; role?: string; is_active?: boolean }
interface MovePlan {
  team: { id: string; name: string; is_active: boolean };
  from: DepartmentOption | null;
  to: DepartmentOption;
  followers: Person[];
  managersLosing: Person[];
  managersGaining: Person[];
}

const QA_TONE: Record<string, Tone> = { good: 'good', warning: 'warn', critical: 'bad' };

/** QA score badge with the shared status thresholds (green / amber / red, grey for no data). */
export const QaScoreBadge: React.FC<{ score: number | null; date?: string | null }> = ({ score, date }) => {
  const status = qaStatusFromScore(score);
  if (!status || score == null) return <Badge tone="neutral">No data</Badge>;
  const label = status === 'good' ? 'good' : status === 'warning' ? 'watch' : 'critical';
  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={QA_TONE[status]} className="tabular-nums">
        <span aria-hidden="true" className={cx('h-1.5 w-1.5 rounded-full', status === 'good' ? 'bg-green-600 dark:bg-green-400' : status === 'warning' ? 'bg-amber-500 dark:bg-amber-400' : 'bg-red-600 dark:bg-red-400')} />
        {Math.round(score)}
        <span className="sr-only"> ({label})</span>
      </Badge>
      {date && <span className="hidden text-xs text-slate-400 dark:text-slate-500 xl:inline">{new Date(date).toLocaleDateString()}</span>}
    </span>
  );
};

const names = (people: Person[], max = 4) => {
  const shown = people.slice(0, max).map((p) => p.name);
  const more = people.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ').replace(/, ([^,]*)$/, ' and $1');
};

/* ------------------------------------------------------------------------------------------ */

export interface MoveRequest {
  mode: 'move' | 'add';
  /** move: the team being moved. add: preselected team (optional). */
  teamId?: string;
  teamName?: string;
  fromDepartmentId?: string;
  /** move: preselected destination (optional). add: the department the team joins. */
  toDepartmentId?: string;
}

export const MoveTeamDialog: React.FC<{
  request: MoveRequest | null;
  departments: DepartmentOption[];
  candidates: CandidateTeam[];
  onClose: () => void;
  onMoved: (plan: MovePlan) => void;
}> = ({ request, departments, candidates, onClose, onMoved }) => {
  const [teamId, setTeamId] = useState('');
  const [toId, setToId] = useState('');
  const [plan, setPlan] = useState<MovePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [saving, setSaving] = useState(false);
  const teamFieldId = useId();
  const deptFieldId = useId();

  useEffect(() => {
    setTeamId(request?.teamId ?? '');
    setToId(request?.toDepartmentId ?? '');
    setPlan(null);
    setPlanError(null);
  }, [request]);

  // Ask the server what this move would change (dry run) whenever the pair is complete.
  useEffect(() => {
    if (!request || !teamId || !toId) {
      setPlan(null);
      setPlanError(null);
      return;
    }
    let cancelled = false;
    setLoadingPlan(true);
    setPlanError(null);
    (async () => {
      try {
        const res = await fetch(`${API_URL}/admin/teams/${encodeURIComponent(teamId)}/department`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ departmentId: toId, dryRun: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) setPlan(data as MovePlan);
        else {
          setPlan(null);
          setPlanError(data.error || `Could not check this move (${res.status})`);
        }
      } catch {
        if (!cancelled) setPlanError('Could not reach the server to check this move');
      } finally {
        if (!cancelled) setLoadingPlan(false);
      }
    })();
    return () => { cancelled = true; };
  }, [request, teamId, toId]);

  if (!request) return null;
  const isAdd = request.mode === 'add';
  const toName = departments.find((d) => d.id === (isAdd ? request.toDepartmentId : toId))?.name;
  const destinations = departments.filter((d) => d.id !== request.fromDepartmentId);

  // add: teams from other departments, grouped by department
  const groups = isAdd
    ? departments
        .filter((d) => d.id !== request.toDepartmentId)
        .map((d) => ({ dept: d, teams: candidates.filter((t) => t.department_id === d.id).sort((a, b) => a.name.localeCompare(b.name)) }))
        .filter((g) => g.teams.length > 0)
    : [];
  const nothingToAdd = isAdd && groups.length === 0;
  const nowhereToMove = !isAdd && destinations.length === 0;

  const confirm = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/admin/teams/${encodeURIComponent(plan.team.id)}/department`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departmentId: plan.to.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Could not move ${plan.team.name}`);
        return;
      }
      const n = plan.followers.length;
      toast.success(`${plan.team.name} moved to ${plan.to.name}${n ? ` with ${n} member${n === 1 ? '' : 's'}` : ''}`);
      onMoved(plan);
    } catch {
      toast.error(`Could not move ${plan.team.name}: the server did not respond`);
    } finally {
      setSaving(false);
    }
  };

  const title = isAdd ? `Add a team to ${toName ?? 'this department'}` : `Move ${request.teamName ?? 'team'}`;
  const fromName = plan?.from?.name ?? departments.find((d) => d.id === request.fromDepartmentId)?.name ?? 'its department';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={title}
      size="prose"
      subtitle={isAdd ? 'Pull an existing team in from another department.' : `Currently in ${fromName}.`}
    >
      <div className="space-y-4">
        {isAdd ? (
          <div>
            <label htmlFor={teamFieldId} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Team</label>
            {nothingToAdd ? (
              <p className="rounded-md border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Every active team is already in this department. Create a team on the Teams page, or move one into another department first.
              </p>
            ) : (
              <select id={teamFieldId} data-autofocus value={teamId} onChange={(e) => setTeamId(e.target.value)} className={cx(inputClass, 'w-full pr-8')}>
                <option value="">Choose a team…</option>
                {groups.map((g) => (
                  <optgroup key={g.dept.id} label={g.dept.name}>
                    {g.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </optgroup>
                ))}
              </select>
            )}
          </div>
        ) : (
          <div>
            <label htmlFor={deptFieldId} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Move to</label>
            {nowhereToMove ? (
              <p className="rounded-md border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                There is no other active department. Create one first.
              </p>
            ) : (
              <select id={deptFieldId} data-autofocus value={toId} onChange={(e) => setToId(e.target.value)} className={cx(inputClass, 'w-full pr-8')}>
                <option value="">Choose a department…</option>
                {destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
        )}

        {/* What moves with it: the server's dry-run plan */}
        <div aria-live="polite">
          {planError && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {planError}
            </p>
          )}
          {!planError && loadingPlan && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Checking what moves with the team…</p>
          )}
          {!planError && !loadingPlan && plan && (
            <div className="rounded-md border border-slate-200 dark:border-slate-700">
              <p className="border-b border-slate-200 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                What moves with {plan.team.name}
              </p>
              <dl className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <div className="flex gap-3 px-4 py-3">
                  <Users size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <dt className="font-medium text-slate-900 dark:text-white">Members' department</dt>
                    <dd className="mt-0.5 text-slate-600 dark:text-slate-300">
                      {plan.followers.length > 0 ? (
                        <>
                          {plan.followers.length} {plan.followers.length === 1 ? 'person' : 'people'} with {plan.team.name} as primary team move from {plan.from?.name ?? 'no department'} to {plan.to.name}: {names(plan.followers)}.
                        </>
                      ) : (
                        <>Nobody has {plan.team.name} as primary team in {plan.from?.name ?? 'the old department'}, so no one's department changes.</>
                      )}
                    </dd>
                  </div>
                </div>
                <div className="flex gap-3 px-4 py-3">
                  <ShieldCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <dt className="font-medium text-slate-900 dark:text-white">Which QA manager sees it</dt>
                    <dd className="mt-0.5 space-y-1 text-slate-600 dark:text-slate-300">
                      <p>
                        {plan.managersLosing.length > 0
                          ? <>{names(plan.managersLosing)} ({plan.from?.name}) will no longer see or manage this team.</>
                          : <>{plan.from?.name ?? 'The old department'} has no QA manager, so no manager loses access.</>}
                      </p>
                      <p>
                        {plan.managersGaining.length > 0
                          ? <>{names(plan.managersGaining)} ({plan.to.name}) will see its analytics and manage it.</>
                          : <>{plan.to.name} has no QA manager yet; only super admins and the team itself will see it.</>}
                      </p>
                    </dd>
                  </div>
                </div>
              </dl>
              <p className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                QA managers and super admins never move with a team: they stay in their department, so a manager keeps managing it and loses this team (a membership of it ends; Undo on the Activity page restores it). To give the team a manager in {plan.to.name}, assign one there. KPI history, metrics and team settings stay with the team; people for whom it is a secondary team keep their department.
                {!plan.team.is_active && ' This team is inactive; it stays inactive.'}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onClose} className={buttonClass.secondary}>Cancel</button>
        <button type="button" onClick={confirm} disabled={!plan || saving || loadingPlan} className={cx(buttonClass.primary, 'disabled:cursor-not-allowed')}>
          <ArrowRightLeft size={16} aria-hidden="true" />
          {saving ? 'Moving…' : plan ? `Move to ${plan.to.name}` : 'Move team'}
        </button>
      </div>
    </Modal>
  );
};

/* ------------------------------------------------------------------------------------------ */

const TH = 'px-4 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400';

export const DepartmentTeamsPanel: React.FC<{
  departmentId: string;
  departmentName: string;
  detail: DepartmentDetail | null;
  error: string | null;
  departments: DepartmentOption[];
  onOpenTeam?: (teamId: string) => void;
  onRequestMove: (req: MoveRequest) => void;
  onRequestAssignment: (req: AssignmentRequest) => void;
}> = ({ departmentId, departmentName, detail, error, departments, onOpenTeam, onRequestMove, onRequestAssignment }) => {
  const otherDepartments = useMemo(() => departments.filter((d) => d.id !== departmentId), [departments, departmentId]);
  const teams = detail?.teams ?? [];
  const activeCount = teams.filter((t) => t.is_active).length;
  const activeTeams = teams.filter((t) => t.is_active).map((t) => ({ id: t.id, name: t.name }));
  const managers = detail?.managers ?? [];

  return (
    <div className="space-y-5 px-4 py-4 sm:px-6">
      {/* QA managers */}
      <section aria-labelledby={`mgr-${departmentId}`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 id={`mgr-${departmentId}`} className="text-sm font-semibold text-slate-900 dark:text-white">QA managers</h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">See every team of {departmentName} and manage its teams and users. They stay here when teams move.</p>
          </div>
          <button
            type="button"
            disabled={!detail}
            onClick={() => onRequestAssignment({ kind: 'assign_manager', departmentId, departmentName, excludeIds: managers.map((m) => m.id) })}
            className={cx(buttonClass.secondary, 'h-8 shrink-0 px-3')}
          >
            <UserPlus size={16} aria-hidden="true" />
            Assign manager
          </button>
        </div>
        {detail && (managers.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            No QA manager yet. Only super admins manage {departmentName} until one is assigned.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {managers.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {m.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{m.name}</span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{m.email}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onRequestAssignment({
                    kind: 'remove_manager', departmentId, departmentName, user: { id: m.id, name: m.name },
                    teams: activeTeams, currentTeamId: m.primary_team_id && activeTeams.some((t) => t.id === m.primary_team_id) ? m.primary_team_id : null,
                  })}
                  aria-label={`Remove ${m.name} as manager`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                >
                  <UserMinus size={14} aria-hidden="true" />
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ))}
      </section>

      <section>
      <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Teams in {departmentName}
            {detail && (
              <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">
                {activeCount} active{teams.length > activeCount ? ` · ${teams.length - activeCount} inactive` : ''}
              </span>
            )}
          </h3>

        </div>
        <button
          type="button"
          onClick={() => onRequestMove({ mode: 'add', toDepartmentId: departmentId })}
          className={cx(buttonClass.secondary, 'h-8 shrink-0 px-3')}
        >
          <Plus size={16} aria-hidden="true" />
          Add existing team
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>
      ) : !detail ? (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">Loading teams…</p>
      ) : teams.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
          <EmptyState
            icon={<UsersRound size={28} aria-hidden="true" />}
            title="No teams in this department"
            description="Use Add existing team to move one in from another department, or create a team on the Teams page."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Teams in {departmentName}</caption>
            <thead className="border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th scope="col" className={TH}>Team</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={cx(TH, 'text-right')}>Members</th>
                <th scope="col" className={TH}>Team lead</th>
                <th scope="col" className={TH}>
                  <span title={`Latest QA score: ≥${QA_SCORE_THRESHOLDS.good} good, ≥${QA_SCORE_THRESHOLDS.warning} watch, below critical`}>QA score</span>
                </th>
                <th scope="col" className={cx(TH, 'w-48')}>Reassign</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {teams.map((t) => (
                <tr key={t.id} className={cx(!t.is_active && 'text-slate-500 dark:text-slate-400')}>
                  <td className="px-4 py-2.5">
                    {t.is_active && onOpenTeam ? (
                      <button
                        type="button"
                        onClick={() => onOpenTeam(t.id)}
                        className="group inline-flex items-center gap-1 rounded font-medium text-brand-700 hover:text-brand-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300 dark:hover:text-brand-200"
                        aria-label={`Open ${t.name} team detail`}
                      >
                        {t.name}
                        <ChevronRight size={14} aria-hidden="true" className="opacity-60 group-hover:opacity-100" />
                      </button>
                    ) : (
                      <span className="font-medium text-slate-700 dark:text-slate-300" title={t.is_active ? undefined : 'Inactive teams have no detail page'}>{t.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {t.is_active ? <Badge tone="good">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-900 dark:text-white">{t.member_count}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className={cx('min-w-0 truncate', t.team_lead_name ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500')}>
                        {t.team_lead_name || 'No lead'}
                      </span>
                      {t.is_active && (
                        <button
                          type="button"
                          onClick={() => onRequestAssignment({ kind: 'assign_lead', teamId: t.id, teamName: t.name, currentLeadId: t.team_lead_id, currentLeadName: t.team_lead_name })}
                          aria-label={`Assign team lead for ${t.name}`}
                          className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300 dark:hover:bg-brand-950/40 dark:hover:text-brand-200"
                        >
                          {t.team_lead_name ? 'Change' : 'Assign'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5"><QaScoreBadge score={t.qa_score} date={t.snapshot_date} /></td>
                  <td className="px-4 py-2">
                    <select
                      value=""
                      disabled={otherDepartments.length === 0}
                      title={otherDepartments.length === 0 ? 'There is no other active department' : undefined}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        onRequestMove({ mode: 'move', teamId: t.id, teamName: t.name, fromDepartmentId: departmentId, toDepartmentId: e.target.value });
                      }}
                      aria-label={`Move ${t.name} to another department`}
                      className={cx(inputClass.replace('h-9', 'h-8'), 'w-full pr-8 disabled:cursor-not-allowed disabled:opacity-60')}
                    >
                      <option value="">Move to…</option>
                      {otherDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </section>
    </div>
  );
};
