import {
  canInvite, canManageCompanyConfig, canManageSampleData, canOpenUserAdmin, canRequestExecutiveBriefing, canSetJobTitle,
  canUseFormulaMode, canViewActivity, canViewIngestionLog, canViewRevenueRollup, canViewUserActivity, canWriteSomeTeamData, canUploadFiles,
  grantsOf, isCompanyAdmin, ledTeamIds, managedDepartmentIds, DEVELOPER_INSIGHT_ROLES, capAnywhere, type PolicyActor,
} from '../../server/lib/userPolicy';
import { ROLE_LABELS } from '../../server/lib/roleLabels';
import { canCompareTeams, canUseAnalytics } from './viewAccess';

/**
 * "What you can do here" (the help button in the top bar): the signed-in person's roles and
 * scope in plain English, generated from the same policy functions the server enforces
 * (server/lib/userPolicy.ts), never from a fixed text per role. docs/ROLE_ACCESS.md is the long
 * form of the same rules.
 */

export interface AssignmentLike {
  role: string;
  scopeType: string;
  scopeId: string;
  scopeName?: string | null;
  customRoleName?: string | null;
}

export interface AccessSummary {
  /** "Viewer · Payments Core", "Manager · Digital Banking (department)", "Super admin · Meridian Financial Technologies". */
  roles: string[];
  /** Which teams' data the person sees, in one sentence. */
  scope: string;
  can: string[];
  cannot: string[];
}

const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

export function accessSummary(actor: PolicyActor, assignments: AssignmentLike[], companyName?: string | null): AccessSummary {
  const nameOf = (a: AssignmentLike) => a.scopeName || (a.scopeType === 'company' ? companyName || 'the company' : a.scopeId);
  const roles = assignments.map((a) => `${a.customRoleName ?? ROLE_LABELS[a.role] ?? a.role} · ${nameOf(a)}${a.scopeType === 'department' ? ' (department)' : ''}`);
  const teams = assignments.filter((a) => a.scopeType === 'team').map(nameOf);
  const depts = assignments.filter((a) => a.scopeType === 'department').map(nameOf);
  const company = isCompanyAdmin(actor);
  const analytics = canUseAnalytics(actor);

  const parts = [depts.length ? `the teams of ${list(depts)}` : null, teams.length ? list(Array.from(new Set(teams))) : null].filter(Boolean);
  const scope = company
    ? `You see every team of ${companyName || 'the company'}.`
    : !analytics || parts.length === 0
      ? 'No team is in your scope yet, so there are no team dashboards for you. Ask an administrator to add you to a team.'
      : `You see ${parts.join(' and ')}. Other teams are not shown to you.`;

  const can: string[] = [];
  const cannot: string[] = [];
  const add = (allowed: boolean, yes: string, no?: string) => { if (allowed) can.push(yes); else if (no) cannot.push(no); };

  // Compare teams only for someone with two or more teams to compare (canCompareTeams), as in the navigation.
  add(analytics, `Open the overview, team dashboards, ${canCompareTeams(actor) ? 'TV mode, Compare teams' : 'TV mode'} and the Analytics modules for the teams in your scope, with their targets and trends.`);
  add(analytics, 'See wellbeing pulse results (team averages of at least 3 answers) and alerts and tracked actions of your teams.');
  if (assignments.some((a) => a.scopeType === 'team')) can.push('Answer the wellbeing pulse of the teams you belong to (anonymously).');
  const seesOthers = capAnywhere(actor, 'view_individuals');
  add(seesOthers,
    'See individual developer metrics of people in your scope who opted in to developer insights.',
    'See other people\'s individual developer metrics (you see only your own row).');
  add(canWriteSomeTeamData(actor),
    `Enter metrics, acknowledge alerts, manage tracked actions and send the pulse survey for ${company ? 'any team' : ledTeamIds(actor).length && !managedDepartmentIds(actor).length ? 'the teams you lead' : 'the teams you manage'}.`,
    'Change team data, acknowledge alerts or manage tracked actions (read-only).');
  add(canInvite(actor), 'Invite people and give or remove assignments within your scope.', 'Invite people or change anyone\'s access.');
  add(canOpenUserAdmin(actor), 'Open the Users and Teams pages for the people and teams you manage.');
  add(canUploadFiles(actor), 'Upload exported files (test reports, coverage, Jira, Linear, PagerDuty, Opsgenie, CSV) for the teams whose data you may write, after a preview.');
  add(canManageCompanyConfig(actor),
    'Change settings: KPI targets, parameters, expected update frequency and alert rules.',
    'Change settings, KPI targets or alert rules.');
  add(canViewActivity(actor) || canViewIngestionLog(actor), 'Read the change history (Activity) and the ingestion log.');
  add(canViewRevenueRollup(actor), 'See the revenue impact roll-up of all teams in your scope.');
  add(canRequestExecutiveBriefing(actor), 'Ask for the executive briefing (AI summary) of your scope.');
  add(canViewUserActivity(actor), 'See the user activity log, departments, API keys, session settings and Slack.');
  add(canSetJobTitle(actor), 'Set people\'s job titles.');
  add(canUseFormulaMode(actor), 'Turn on "Show formulas & data sources".');
  add(canManageSampleData(actor), 'Load or refresh sample data.');
  return { roles, scope, can, cannot };
}
