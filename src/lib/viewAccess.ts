import {
  ANALYTICS_ROLES, analyticsScopeLevelOf, canManageCompanyConfig, canOpenUserAdmin, canViewActivity, canViewIngestionLog,
  canInvite, canUploadFiles, canViewUserActivity, canWriteSomeTeamData, grantsOf, isCompanyAdmin, type PolicyActor,
} from '../../server/lib/userPolicy';

/**
 * May this person open a page (view) at all? The ONE rule for the navigation (sidebar drawer),
 * the Analytics hub tiles and the router (App.tsx: an address typed in for a page that is not
 * allowed opens the overview with "You don't have access to …"). Built only from the shared
 * policy (server/lib/userPolicy.ts), which the API enforces too. Pages a person may open with
 * limited data (their teams only, their own row only) stay open.
 */

/** The Analytics modules and the pages built on the analytics scope (one team at a time). */
export const ANALYTICS_VIEWS = [
  'features', 'flaky-test-intelligence', 'technical-debt', 'pipeline-visualization', 'business-impact', 'performance-metrics',
  'developer-productivity', 'team-pulse', 'test-execution-timeline', 'team-gamification', 'pdf-report-generator', 'compare',
] as const;

/** Every role may use them, provided at least one team is in their analytics scope. */
export function canUseAnalytics(actor: PolicyActor): boolean {
  return grantsOf(actor).some((g) => ANALYTICS_ROLES.includes(g.role)) && analyticsScopeLevelOf(actor) !== 'none';
}

/**
 * Compare teams needs at least two teams to compare: a company or department scope, or grants on two or more
 * teams. Someone on a single team (e.g. a software engineer on one team) is not offered it.
 */
export function canCompareTeams(actor: PolicyActor): boolean {
  const level = analyticsScopeLevelOf(actor);
  if (level === 'company' || level === 'department') return true;
  const teams = new Set(grantsOf(actor).filter((g) => g.scopeType === 'team' && ANALYTICS_ROLES.includes(g.role)).map((g) => g.scopeId));
  return teams.size >= 2;
}

/**
 * Not offered to a company in live operation (server/lib/liveData.ts): the page for typing metrics. Every module
 * has a raw source (Performance: load-test result files; Developer productivity: pull requests and calendars).
 */
export const LIVE_HIDDEN_VIEWS: readonly string[] = ['manual-metrics'];

export function canOpenView(actor: PolicyActor | null | undefined, view: string): boolean {
  if (!actor || !actor.id) return view === 'dashboard';
  if (actor.liveDataOnly && LIVE_HIDDEN_VIEWS.includes(view)) return false;
  if (view === 'compare') return canUseAnalytics(actor) && canCompareTeams(actor);
  if ((ANALYTICS_VIEWS as readonly string[]).includes(view)) return canUseAnalytics(actor);
  switch (view) {
    case 'dashboard':
    case 'notifications':
      return true;
    case 'summary':
    case 'time-lost':
    case 'findings':
    case 'outcomes':
    case 'data-readiness':
      // Executive summary and the "next move" pages (Time lost, Findings, Outcomes, Data readiness): every role
      // with a team in their analytics scope (they cover that scope); the navigation offers it to super admins and managers (showSummaryInNav).
      return canUseAnalytics(actor);
    case 'tv':
      // TV mode: every role may open it, for the teams of their analytics scope (the API refuses
      // others); without a team in scope it says so.
      return true;
    case 'users':
    case 'teams':
      return canOpenUserAdmin(actor);
    case 'departments':
      return isCompanyAdmin(actor);
    case 'roles':
      // Roles: everyone who invites people reads what each role gives; only super admins change them (the page and the API).
      return canInvite(actor);
    case 'activity':
      return canViewActivity(actor);
    case 'user-activity':
      return canViewUserActivity(actor);
    case 'ingestion-log':
      return canViewIngestionLog(actor);
    case 'admin-panel':
    case 'metric-intervals':
    case 'parameters-config':
      return canManageCompanyConfig(actor);
    case 'manual-metrics':
      return canWriteSomeTeamData(actor);
    case 'upload-files':
      // Upload files: super admins, managers (their departments' teams), team leads (teams they lead).
      return canUploadFiles(actor);
    default:
      return false;
  }
}

/** The executive summary is in the navigation for super admins and managers (company or department scope). */
export function showSummaryInNav(actor: PolicyActor): boolean {
  const level = analyticsScopeLevelOf(actor);
  return level === 'company' || level === 'department';
}
