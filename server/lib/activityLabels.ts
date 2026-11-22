/**
 * Readable descriptions of user activity rows ("Viewed team Payments – KPIs", "Changed targets").
 * Pure (no DB): used by the User activity screen, its CSV export and the operator panel.
 * A route without a rule gets a sensible fallback built from its path.
 */

export interface ActivityLabelInput {
  category: string;
  method?: string | null;
  route?: string | null;
  screen?: string | null;
  team_name?: string | null;
  entity_type?: string | null;
  status?: number | null;
}

export const CATEGORY_LABELS: Record<string, string> = {
  sign_in: 'Sign-in', sign_in_failed: 'Failed sign-in', view: 'View', screen: 'Screen', change: 'Change', export: 'Export', ingest: 'API ingestion',
};

/** Screen keys (the app's views) → names. */
export const SCREEN_LABELS: Record<string, string> = {
  dashboard: 'Overview', features: 'Analytics', compare: 'Compare teams', users: 'Users', teams: 'Teams', departments: 'Departments',
  activity: 'Activity log', 'user-activity': 'User activity', 'ingestion-log': 'Ingestion log', 'admin-panel': 'Admin console',
  'manual-metrics': 'Manual metrics', 'upload-files': 'Upload files', 'metric-intervals': 'Update frequency', 'parameters-config': 'Parameters',
  'flaky-test-intelligence': 'Flaky tests', 'technical-debt': 'Technical debt', 'pipeline-visualization': 'CI/CD pipeline',
  'business-impact': 'Business impact', 'performance-metrics': 'Performance', 'developer-productivity': 'Developer productivity',
  'team-pulse': 'Wellbeing pulse', 'test-execution-timeline': 'Test execution', 'team-gamification': 'Team rankings',
  'pdf-report-generator': 'Reports', notifications: 'Notifications', tv: 'TV mode', 'team-detail': 'Team detail',
};

/** [method, route pattern, label]; '*' = any method. {team} is replaced by "team <name>". */
const RULES: Array<[string, string, string]> = [
  ['POST', '/api/auth/login', 'Signed in'],
  ['POST', '/api/auth/logout', 'Signed out'],
  ['POST', '/api/auth/register', 'Registered the organisation'],
  ['GET', '/api/auth/sso/:provider/callback', 'Signed in with single sign-on'],
  ['POST', '/api/auth/invitations/accept', 'Accepted an invitation'],
  ['POST', '/api/auth/forgot-password', 'Asked for a password reset link'],
  ['POST', '/api/auth/reset-password', 'Changed the password with a reset link (or tried to)'],
  ['GET', '/api/teams', 'Viewed the team list'],
  ['GET', '/api/teams/:id', 'Viewed {team}'],
  ['GET', '/api/teams/:id/kpi-history', 'Viewed {team} – KPI history'],
  ['GET', '/api/teams/:id/ai-suggestions', 'Viewed {team} – AI insights'],
  ['GET', '/api/metrics/teams/:teamId', 'Viewed {team} – KPIs'],
  ['GET', '/api/metrics/teams/:teamId/history', 'Viewed {team} – KPI history'],
  ['GET', '/api/metrics/team/:teamId/all', 'Viewed {team} – all metrics'],
  ['GET', '/api/metrics/dashboard', 'Viewed the dashboard'],
  ['POST', '/api/metrics/manual', 'Entered metrics manually'],
  ['POST', '/api/metrics/developer', 'Entered developer metrics'],
  ['GET', '/api/metrics/developer/:userId', 'Viewed developer metrics of a person'],
  ['GET', '/api/targets', 'Viewed KPI targets'],
  ['PUT', '/api/targets', 'Changed targets'],
  ['GET', '/api/admin/users', 'Viewed the user list'],
  ['POST', '/api/admin/users', 'Added a user'],
  ['PUT', '/api/admin/users/:id', 'Changed a user'],
  ['POST', '/api/admin/users/:id/toggle-status', 'Activated or deactivated a user'],
  ['POST', '/api/admin/users/:id/reset-password', 'Reset a password'],
  ['POST', '/api/admin/users/:id/send-reset-link', 'Sent a password reset link'],
  ['POST', '/api/admin/users/:id/sign-out-everywhere', 'Signed a user out everywhere'],
  ['POST', '/api/auth/sessions/sign-out-others', 'Signed out of all other devices'],
  ['GET', '/api/admin/session-settings', 'Viewed the sign-in settings'],
  ['PUT', '/api/admin/session-settings', 'Changed how long sign-ins last'],
  ['GET', '/api/uploads/context', 'Opened Upload files'],
  ['POST', '/api/uploads/preview', 'Previewed files to upload (nothing stored)'],
  ['POST', '/api/uploads/commit', 'Uploaded files'],
  ['GET', '/api/uploads/privacy', 'Viewed whether issue and incident titles are stored'],
  ['PUT', '/api/uploads/privacy', 'Changed whether issue and incident titles are stored'],
  ['DELETE', '/api/admin/users/:id', 'Deleted a user'],
  ['POST', '/api/admin/teams', 'Created a team'],
  ['PUT', '/api/admin/teams/:id', 'Changed {team}'],
  ['PUT', '/api/admin/teams/:id/department', 'Moved {team} to another department'],
  ['PUT', '/api/admin/teams/:id/lead', 'Changed the lead of {team}'],
  ['DELETE', '/api/admin/teams/:id', 'Deleted {team}'],
  ['POST', '/api/admin/departments', 'Created a department'],
  ['PUT', '/api/admin/departments/:id', 'Changed a department'],
  ['GET', '/api/admin/configs', 'Viewed settings'],
  ['POST', '/api/admin/configs', 'Changed settings'],
  ['GET', '/api/admin/api-keys', 'Viewed API keys'],
  ['POST', '/api/admin/api-keys', 'Created an API key'],
  ['POST', '/api/admin/api-keys/:id/revoke', 'Revoked an API key'],
  ['GET', '/api/admin/audit', 'Viewed the activity log'],
  ['POST', '/api/admin/audit/:id/undo', 'Undid a change'],
  ['POST', '/api/admin/invitations', 'Invited someone'],
  ['POST', '/api/admin/invitations/:id/resend', 'Re-sent an invitation'],
  ['POST', '/api/admin/invitations/:id/revoke', 'Revoked an invitation'],
  ['POST', '/api/admin/users/:id/assignments', 'Added a role assignment'],
  ['DELETE', '/api/admin/users/:id/assignments/:assignmentId', 'Removed a role assignment'],
  ['GET', '/api/pulse/teams/:teamId', 'Viewed {team} – wellbeing pulse'],
  ['PUT', '/api/pulse/teams/:teamId/cadence', 'Changed the pulse cadence of {team}'],
  ['PUT', '/api/pulse/teams/:teamId/settings', 'Changed the pulse reminders of {team}'],
  ['POST', '/api/pulse/teams/:teamId/send', 'Sent the pulse survey to {team}'],
  ['POST', '/api/pulse/teams/:teamId/remind', 'Sent a pulse reminder to {team}'],
  ['GET', '/api/compare/teams', 'Compared teams'],
  ['GET', '/api/compare/teams.csv', 'Exported a team comparison'],
  ['GET', '/api/activity/log.csv', 'Exported the user activity log'],
  ['GET', '/api/ingestion-log', 'Viewed the ingestion log'],
  ['POST', '/api/ingest/kpis', 'Sent KPIs through the API'],
  ['GET', '/api/alerts', 'Viewed alerts'],
  ['PUT', '/api/alerts/rules', 'Changed alert rules'],
  ['POST', '/api/alerts/:id/acknowledge', 'Acknowledged an alert'],
  ['GET', '/api/revenue-impact/teams/:teamId', 'Viewed {team} – revenue impact'],
  ['GET', '/api/analytics/business-impact-v2/:teamId', 'Viewed {team} – business impact'],
  ['GET', '/api/tv/teams/:id', 'Opened TV mode for {team}'],
];

const VERB: Record<string, string> = { GET: 'Viewed', HEAD: 'Viewed', POST: 'Changed', PUT: 'Changed', PATCH: 'Changed', DELETE: 'Deleted' };

const teamText = (name?: string | null) => (name ? `team ${name}` : 'a team');

/** Fallback: "Viewed analytics › flaky tests" from the pattern's words. */
function fallback(method: string, route: string): string {
  const words = route.replace(/^\/api\//, '').split('/').filter((p) => p && !p.startsWith(':')).map((p) => p.replace(/[-_]/g, ' ').replace(/\.csv$/, ' (CSV)'));
  return `${VERB[method] ?? method} ${words.join(' › ') || 'the app'}`;
}

export function activityLabel(row: ActivityLabelInput): string {
  if (row.category === 'screen') {
    const name = SCREEN_LABELS[row.screen ?? ''] ?? row.screen ?? 'a screen';
    return row.team_name ? `Opened ${name} (team ${row.team_name})` : `Opened ${name}`;
  }
  if (row.category === 'export' && !row.route) {
    const name = SCREEN_LABELS[row.screen ?? ''] ?? row.screen ?? 'a list';
    return `Exported ${name} (CSV)`;
  }
  if (row.category === 'sign_in_failed') return 'Failed sign-in (wrong password or inactive account)';
  const method = (row.method ?? 'GET').toUpperCase();
  const route = row.route ?? '';
  const rule = RULES.find(([m, r]) => (m === '*' || m === method) && r === route);
  if (rule) return rule[2].replace('{team}', teamText(row.team_name));
  if (row.category === 'sign_in') return 'Signed in';
  if (!route || route === 'unmatched') return `${VERB[method] ?? method} an unknown address`;
  const base = fallback(method, route);
  return row.team_name ? `${base} (team ${row.team_name})` : base;
}
