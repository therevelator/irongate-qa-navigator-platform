import { canOpenView, ANALYTICS_VIEWS } from '../../src/lib/viewAccess';
import { accessSummary } from '../../src/lib/accessSummary';
import type { PolicyActor } from '../../server/lib/userPolicy';

/**
 * Which pages each role may open (src/lib/viewAccess.ts: navigation, Analytics hub and router)
 * and the "What you can do here" text (src/lib/accessSummary.ts), both from server/lib/userPolicy.ts.
 * Pure functions: no backend needed.
 */
const actor = (id: string, role: string, grants: Array<[string, string, string]>): PolicyActor => ({
  id, role, grants: grants.map(([r, st, sid]) => ({ role: r, scopeType: st, scopeId: sid })),
});
const admin = actor('a', 'super_admin', [['super_admin', 'company', 'co']]);
const manager = actor('m', 'qa_manager', [['qa_manager', 'department', 'd1']]);
const lead = actor('l', 'team_lead', [['team_lead', 'team', 't1']]);
const engineer = actor('e', 'qa_engineer', [['qa_engineer', 'team', 't1']]);
const viewer = actor('v', 'viewer', [['viewer', 'team', 't1']]);
const noTeam = actor('n', 'viewer', []);
/** An engineer on two teams (e.g. a DevOps engineer shared by two teams). */
const engineerTwoTeams = actor('e2', 'qa_engineer', [['qa_engineer', 'team', 't1'], ['qa_engineer', 'team', 't2']]);
/** Two grants on the same team are still one team. */
const leadAndViewerOneTeam = actor('lv', 'team_lead', [['team_lead', 'team', 't1'], ['viewer', 'team', 't1']]);

const ADMIN_VIEWS = ['users', 'teams', 'departments', 'activity', 'user-activity', 'ingestion-log', 'admin-panel', 'manual-metrics', 'upload-files', 'metric-intervals', 'parameters-config'];
const open = (a: PolicyActor) => ADMIN_VIEWS.filter((v) => canOpenView(a, v));

describe('canOpenView', () => {
  it('VIEW-001: administration pages per role', () => {
    expect(open(admin)).toEqual(ADMIN_VIEWS);
    expect(open(manager)).toEqual(['users', 'teams', 'activity', 'ingestion-log', 'admin-panel', 'manual-metrics', 'upload-files', 'metric-intervals', 'parameters-config']);
    expect(open(lead)).toEqual(['users', 'teams', 'manual-metrics', 'upload-files']);
    expect(open(engineer)).toEqual([]);
    expect(open(viewer)).toEqual([]);
  });

  it('VIEW-002: Analytics modules for every role with a team in scope; none without', () => {
    const modules = ANALYTICS_VIEWS.filter((v) => v !== 'compare');
    for (const a of [admin, manager, lead, engineer, viewer]) for (const v of modules) expect([a.role, v, canOpenView(a, v)]).toEqual([a.role, v, true]);
    for (const v of ANALYTICS_VIEWS) expect(canOpenView(noTeam, v)).toBe(false);
  });

  it('VIEW-006: Compare teams only with two or more teams to compare (company or department scope, or 2+ teams)', () => {
    expect(canOpenView(admin, 'compare')).toBe(true);
    expect(canOpenView(manager, 'compare')).toBe(true);
    expect(canOpenView(engineerTwoTeams, 'compare')).toBe(true);
    // One team: nothing to compare (software engineer, viewer or team lead of a single team).
    for (const a of [engineer, viewer, lead, leadAndViewerOneTeam, noTeam]) expect([a.id, canOpenView(a, 'compare')]).toEqual([a.id, false]);
    expect(canOpenView(null, 'compare')).toBe(false);
  });

  it('VIEW-004: TV mode entry for every role (the API limits it to the teams in scope)', () => {
    for (const a of [admin, manager, lead, engineer, viewer, noTeam]) expect(canOpenView(a, 'tv')).toBe(true);
    expect(canOpenView(null, 'tv')).toBe(false);
  });

  it('VIEW-003: overview and notifications for everyone; unknown pages for nobody; signed out: overview only', () => {
    for (const a of [admin, viewer, noTeam]) {
      expect(canOpenView(a, 'dashboard')).toBe(true);
      expect(canOpenView(a, 'notifications')).toBe(true);
      expect(canOpenView(a, 'no-such-page')).toBe(false);
    }
    expect(canOpenView(null, 'dashboard')).toBe(true);
    expect(canOpenView(null, 'features')).toBe(false);
  });
});

describe('accessSummary', () => {
  it('ACC-001: a viewer of one team: role, scope and read-only limits in plain English', () => {
    const s = accessSummary(viewer, [{ role: 'viewer', scopeType: 'team', scopeId: 't1', scopeName: 'Payments Core' }], 'Meridian');
    expect(s.roles).toEqual(['Viewer · Payments Core']);
    expect(s.scope).toBe('You see Payments Core. Other teams are not shown to you.');
    expect(s.cannot.join(' ')).toMatch(/read-only/);
    expect(s.cannot.join(' ')).toMatch(/Change settings/);
    expect(s.can.join(' ')).not.toMatch(/Invite people/);
    expect(s.can.join(' ')).toMatch(/team dashboards, TV mode and the Analytics modules for the teams in your scope/);
    expect(s.can.join(' ')).not.toMatch(/Compare teams/);
  });

  it('ACC-002: a super admin sees every team and may change settings and job titles', () => {
    const s = accessSummary(admin, [{ role: 'super_admin', scopeType: 'company', scopeId: 'co', scopeName: null }], 'Meridian');
    expect(s.roles).toEqual(['Super admin · Meridian']);
    expect(s.scope).toBe('You see every team of Meridian.');
    expect(s.can.join(' ')).toMatch(/job titles/);
    expect(s.can.join(' ')).toMatch(/TV mode, Compare teams and the Analytics modules/);
    expect(s.cannot).toEqual([]);
  });

  it('ACC-003: a manager of a department; a person without a team', () => {
    const m = accessSummary(manager, [{ role: 'qa_manager', scopeType: 'department', scopeId: 'd1', scopeName: 'Digital Banking' }], 'Meridian');
    expect(m.roles).toEqual(['Manager · Digital Banking (department)']);
    expect(m.scope).toBe('You see the teams of Digital Banking. Other teams are not shown to you.');
    expect(m.can.join(' ')).toMatch(/revenue impact roll-up/);
    expect(m.can.join(' ')).toMatch(/TV mode, Compare teams and the Analytics modules/);
    expect(accessSummary(noTeam, [], 'Meridian').scope).toMatch(/No team is in your scope/);
  });

  it('ACC-004: Compare teams is mentioned for an engineer on two teams, not for one on a single team', () => {
    const two = accessSummary(engineerTwoTeams, [
      { role: 'qa_engineer', scopeType: 'team', scopeId: 't1', scopeName: 'Payments Core' },
      { role: 'qa_engineer', scopeType: 'team', scopeId: 't2', scopeName: 'Mobile Experience' },
    ], 'Meridian');
    expect(two.can.join(' ')).toMatch(/TV mode, Compare teams and the Analytics modules/);
    const one = accessSummary(engineer, [{ role: 'qa_engineer', scopeType: 'team', scopeId: 't1', scopeName: 'Payments Core' }], 'Meridian');
    expect(one.can.join(' ')).not.toMatch(/Compare teams/);
  });
});

describe('Upload files', () => {
  it('VIEW-005: the Upload files page and the "What you can do here" line: super admins, managers and team leads only', () => {
    for (const a of [admin, manager, lead]) expect([a.role, canOpenView(a, 'upload-files')]).toEqual([a.role, true]);
    for (const a of [engineer, viewer, noTeam]) expect([a.role, canOpenView(a, 'upload-files')]).toEqual([a.role, false]);
    expect(accessSummary(lead, [{ role: 'team_lead', scopeType: 'team', scopeId: 't1', scopeName: 'Payments Core' }], 'Meridian').can.join(' ')).toMatch(/Upload exported files/);
    expect(accessSummary(viewer, [{ role: 'viewer', scopeType: 'team', scopeId: 't1', scopeName: 'Payments Core' }], 'Meridian').can.join(' ')).not.toMatch(/Upload exported files/);
  });
});
