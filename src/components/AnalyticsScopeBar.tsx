import React from 'react';
import { Lock, Loader2, UsersRound } from 'lucide-react';
import { useAnalyticsScope } from '../contexts/AnalyticsScopeContext';
import type { AnalyticsScopeTeam } from '../contexts/AnalyticsScopeContext';
import { Card, EmptyState, inputClass, buttonClass, cx } from './ui';
import toast from 'react-hot-toast';
import SavedViewsMenu from './SavedViewsMenu';

/** Analytics module of the current page (App.tsx paths), for saved views of that module. */
const MODULE_BY_PATH: Record<string, string> = {
  '/analytics': 'features',
  '/analytics/flaky-tests': 'flaky-test-intelligence',
  '/analytics/technical-debt': 'technical-debt',
  '/analytics/pipeline': 'pipeline-visualization',
  '/analytics/business-impact': 'business-impact',
  '/analytics/performance': 'performance-metrics',
  '/analytics/productivity': 'developer-productivity',
  '/analytics/timeline': 'test-execution-timeline',
  '/analytics/gamification': 'team-gamification',
  '/analytics/reports': 'pdf-report-generator',
};

/**
 * Department + Team selector shown at the top of the Analytics hub and of every Analytics
 * module. Reads and writes the shared AnalyticsScopeContext, so the choice carries across
 * modules, survives reloads (?team= in the URL, localStorage) and follows the role rules:
 *   super_admin  department and team selectable
 *   qa_manager   department fixed (their own), team selectable within it
 *   team_lead / qa_engineer / viewer  both read-only (their own department and team)
 */

const LEVEL_HINT: Record<string, string> = {
  company: 'You can open any department and team of your company.',
  department: 'You can open every team in the departments you manage.',
  team: 'Analytics is limited to the teams you belong to.',
};

const ReadOnlyField: React.FC<{ label: string; value: string; testId: string }> = ({ label, value, testId }) => (
  <div
    className="inline-flex h-9 min-w-[10rem] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100"
    aria-label={`${label} (read-only)`}
    data-testid={testId}
    title={`${label} is fixed for your role`}
  >
    <Lock size={13} className="flex-shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
    <span className="truncate">{value}</span>
  </div>
);

const FieldLabel: React.FC<{ children: React.ReactNode; htmlFor?: string }> = ({ children, htmlFor }) => (
  <label htmlFor={htmlFor} className="text-xs font-medium text-slate-500 dark:text-slate-400">{children}</label>
);

export const AnalyticsScopeBar: React.FC<{ note?: React.ReactNode }> = ({ note }) => {
  const scope = useAnalyticsScope();
  const { team, departments, teamsInDepartment, departmentId, level } = scope;
  const departmentName = team?.department_name || departments.find((d) => d.id === departmentId)?.name || 'No department';

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 dark:border-slate-800 dark:bg-slate-900"
      data-testid="analytics-scope-bar"
    >
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <UsersRound size={14} aria-hidden /> Scope
      </div>

      {scope.loading ? (
        <span className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading teams…
        </span>
      ) : !team ? (
        <span className="text-sm text-slate-500 dark:text-slate-400" data-testid="analytics-scope-none">No team in your scope</span>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <FieldLabel htmlFor={scope.canChangeDepartment ? 'analytics-scope-department' : undefined}>Department</FieldLabel>
            {scope.canChangeDepartment ? (
              <select
                id="analytics-scope-department"
                aria-label="Department"
                data-testid="analytics-scope-department"
                value={departmentId ?? ''}
                onChange={(e) => scope.setDepartmentId(e.target.value)}
                className={cx(inputClass, 'min-w-[10rem] pr-8')}
              >
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            ) : (
              <ReadOnlyField label="Department" value={departmentName} testId="analytics-scope-department-static" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <FieldLabel htmlFor={scope.canChangeTeam ? 'analytics-scope-team' : undefined}>Team</FieldLabel>
            {scope.canChangeTeam ? (
              <select
                id="analytics-scope-team"
                aria-label="Team"
                data-testid="analytics-scope-team"
                value={team.id}
                onChange={(e) => scope.setTeamId(e.target.value)}
                className={cx(inputClass, 'min-w-[12rem] max-w-[18rem] pr-8')}
              >
                {teamsInDepartment.map((t: AnalyticsScopeTeam) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ) : (
              <ReadOnlyField label="Team" value={team.name} testId="analytics-scope-team-static" />
            )}
          </div>
          {MODULE_BY_PATH[window.location.pathname] && (
            <SavedViewsMenu
              kind="analytics"
              module={MODULE_BY_PATH[window.location.pathname]}
              state={{ departmentId: team.department_id ?? undefined, teamId: team.id }}
              onApply={(s) => {
                const id = typeof s.teamId === 'string' ? s.teamId : '';
                if (scope.teams.some((t) => t.id === id)) scope.setTeamId(id);
                else toast.error('The team of this view is outside your analytics scope');
              }}
              className="self-start sm:self-auto"
            />
          )}
        </>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400 sm:ml-auto sm:max-w-md sm:text-right" data-testid="analytics-scope-note">
        {note ?? LEVEL_HINT[level] ?? ''}
      </p>
    </div>
  );
};

/**
 * Wraps an Analytics module: the scope bar on top, then the module for the selected team.
 * The module is keyed by team id so it reloads cleanly when the team changes. With no team
 * in scope (or the scope failing to load) a clear empty state is shown instead.
 */
export const AnalyticsScopeGate: React.FC<{
  note?: React.ReactNode;
  children: (team: AnalyticsScopeTeam) => React.ReactNode;
}> = ({ note, children }) => {
  const scope = useAnalyticsScope();
  return (
    <>
      <div className="mx-auto w-full max-w-[1400px] px-4 pt-6 sm:px-8 sm:pt-8 -mb-2 sm:-mb-4">
        <AnalyticsScopeBar note={note} />
      </div>
      {scope.loading ? null : !scope.team ? (
        <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-8 sm:py-8">
          <AnalyticsNoTeam error={scope.error} />
        </div>
      ) : (
        <React.Fragment key={scope.team.id}>{children(scope.team)}</React.Fragment>
      )}
    </>
  );
};

export const AnalyticsNoTeam: React.FC<{ error?: string | null }> = ({ error }) => (
  <Card>
    <div data-testid="analytics-no-team">
      <EmptyState
        icon={<UsersRound size={28} />}
        title={error ? 'Analytics scope unavailable' : 'No team in your analytics scope'}
        description={
          error
            ? error
            : 'Analytics shows metrics for one team at a time. You are not assigned to an active team that you can view. Ask an administrator to assign you to a team.'
        }
      />
    </div>
  </Card>
);

export default AnalyticsScopeBar;
