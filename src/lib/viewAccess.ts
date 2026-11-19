import {
  ANALYTICS_ROLES, analyticsScopeLevelOf, canManageCompanyConfig, canOpenUserAdmin, canViewActivity, canViewIngestionLog,
  canViewUserActivity, canWriteSomeTeamData, grantsOf, isCompanyAdmin, type PolicyActor,
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

export function canOpenView(actor: PolicyActor | null | undefined, view: string): boolean {
  if (!actor || !actor.id) return view === 'dashboard';
  if ((ANALYTICS_VIEWS as readonly string[]).includes(view)) return canUseAnalytics(actor);
  switch (view) {
    case 'dashboard':
    case 'notifications':
      return true;
    case 'tv':
      // TV mode: every role may open it, for the teams of their analytics scope (the API refuses
      // others); without a team in scope it says so.
      return true;
    case 'users':
    case 'teams':
      return canOpenUserAdmin(actor);
    case 'departments':
      return isCompanyAdmin(actor);
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
    default:
      return false;
  }
}
