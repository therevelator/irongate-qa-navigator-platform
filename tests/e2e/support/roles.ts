/**
 * Demo logins of the demo company (NovaTech) created by the snapshot + demo seed
 * (scripts/ci/prepare-db.sh). Password demo123. Remote mode uses UI_REMOTE_EMAIL / UI_REMOTE_PASSWORD.
 */
export type Role = 'admin' | 'manager' | 'lead' | 'engineer' | 'viewer';

export const ROLES: Record<Role, { email: string; password: string; key: string; label: string }> = {
  admin: { email: 'admin@irongate.com', password: 'demo123', key: 'super_admin', label: 'Super admin' },
  manager: { email: 'manager@irongate.com', password: 'demo123', key: 'qa_manager', label: 'Manager' },
  lead: { email: 'lead@irongate.com', password: 'demo123', key: 'team_lead', label: 'Team lead' },
  engineer: { email: 'engineer@irongate.com', password: 'demo123', key: 'qa_engineer', label: 'Software engineer' },
  viewer: { email: 'viewer@irongate.com', password: 'demo123', key: 'viewer', label: 'Viewer' },
};

export const ALL_ROLES: Role[] = ['admin', 'manager', 'lead', 'engineer', 'viewer'];

/** Demo data facts the tests rely on (NovaTech, server/seeds + db_snapshots). */
export const DEMO = {
  companyId: 'novatech',
  /** Led by lead@, viewer@ is a viewer on it, in the DevOps department managed by manager@. */
  leadTeam: { id: 'team-1764200682441-sckxod8xd', name: 'The Away Team', department: 'DevOps' },
  /** engineer@'s team (Digital Products department, not managed by manager@). */
  engineerTeam: { id: 'team-1764026202608-vcbic0w8g', name: 'Mavericks', department: 'Digital Products' },
  /** A team outside lead@ / engineer@ / viewer@ / manager@ scope. */
  otherTeam: { id: 'team-1764026236967-uphpblii4', name: 'QualityCowboys', department: 'Payments Processing' },
  managerDepartment: { id: 'dept-decision-mgmt', name: 'DevOps' },
};

/** Navigation entries (data-testid nav-*) each role must see, from server/lib/userPolicy.ts. */
const ANALYTICS = ['nav-dashboard', 'nav-analytics', 'nav-compare', 'nav-tv', 'nav-time-lost', 'nav-findings', 'nav-outcomes', 'nav-data-readiness', 'nav-flaky-test-intelligence', 'nav-test-execution-timeline',
  'nav-technical-debt', 'nav-performance-metrics', 'nav-pipeline-visualization', 'nav-developer-productivity', 'nav-team-pulse',
  'nav-business-impact', 'nav-team-gamification', 'nav-pdf-report-generator'];
/**
 * Compare teams needs two or more teams to compare (src/lib/viewAccess.ts canCompareTeams): a company or department
 * scope, or grants on 2+ teams. lead@, engineer@ and viewer@ each have one team in the demo data, so it is hidden for them.
 */
const ONE_TEAM = ANALYTICS.filter((id) => id !== 'nav-compare');
/** The executive summary is in the navigation of super admins and managers (after the overview). */
const WITH_SUMMARY = ['nav-dashboard', 'nav-summary', ...ANALYTICS.slice(1)];
export const NAV_BY_ROLE: Record<Role, string[]> = {
  admin: [...WITH_SUMMARY, 'nav-users', 'nav-teams', 'nav-departments', 'nav-activity', 'nav-user-activity', 'nav-admin',
    'nav-manual-metrics', 'nav-upload-files', 'nav-metric-intervals', 'nav-parameters-config', 'nav-ingestion-log'],
  manager: [...WITH_SUMMARY, 'nav-users', 'nav-teams', 'nav-activity', 'nav-admin', 'nav-manual-metrics', 'nav-upload-files', 'nav-metric-intervals',
    'nav-parameters-config', 'nav-ingestion-log'],
  lead: [...ONE_TEAM, 'nav-users', 'nav-teams', 'nav-manual-metrics', 'nav-upload-files'],
  engineer: [...ONE_TEAM],
  viewer: [...ONE_TEAM],
};
export const ALL_NAV = NAV_BY_ROLE.admin;

/** Restricted pages: path -> roles that may open it. Others are sent to the overview. */
export const RESTRICTED_PAGES: Array<{ path: string; title: string; allowed: Role[] }> = [
  // Only with two or more teams to compare: lead@, engineer@ and viewer@ have one team each.
  { path: '/compare', title: 'Compare teams', allowed: ['admin', 'manager'] },
  { path: '/users', title: 'Users', allowed: ['admin', 'manager', 'lead'] },
  { path: '/teams', title: 'Teams', allowed: ['admin', 'manager', 'lead'] },
  { path: '/departments', title: 'Departments', allowed: ['admin'] },
  { path: '/activity', title: 'Activity', allowed: ['admin', 'manager'] },
  { path: '/user-activity', title: 'User activity', allowed: ['admin'] },
  { path: '/ingestion-log', title: 'Ingestion log', allowed: ['admin', 'manager'] },
  { path: '/admin-panel', title: 'Admin console', allowed: ['admin', 'manager'] },
  { path: '/manual-metrics', title: 'Manual metrics', allowed: ['admin', 'manager', 'lead'] },
  { path: '/upload-files', title: 'Upload files', allowed: ['admin', 'manager', 'lead'] },
  { path: '/metric-intervals', title: 'Expected update frequency', allowed: ['admin', 'manager'] },
  { path: '/parameters-config', title: 'Parameters', allowed: ['admin', 'manager'] },
];

/** Pages every role may open (path -> top bar title). */
export const OPEN_PAGES: Array<{ path: string; title: string }> = [
  { path: '/', title: 'Overview' },
  { path: '/analytics', title: 'Analytics' },
  { path: '/analytics/flaky-tests', title: 'Flaky tests' },
  { path: '/analytics/timeline', title: 'Test execution' },
  { path: '/analytics/technical-debt', title: 'Technical debt' },
  { path: '/analytics/performance', title: 'Performance' },
  { path: '/analytics/pipeline', title: 'CI/CD pipeline' },
  { path: '/analytics/productivity', title: 'Developer productivity' },
  { path: '/analytics/pulse', title: 'Wellbeing pulse' },
  { path: '/analytics/business-impact', title: 'Business impact' },
  { path: '/analytics/gamification', title: 'Team rankings' },
  { path: '/analytics/reports', title: 'Reports' },
  { path: '/notifications', title: 'Notifications' },
  { path: '/summary', title: 'Summary' },
  { path: '/time-lost', title: 'Time lost' },
  { path: '/findings', title: 'Findings' },
  { path: '/outcomes', title: 'Outcomes' },
  { path: '/data-readiness', title: 'Data readiness' },
];
