import { test, expect, TAG } from '../support/fixtures';
import { ALL_ROLES, DEMO, type Role } from '../support/roles';
import { API_URL } from '../support/env';
import { trackPageErrors } from '../support/app';
import { createFixtureUser, deleteFixtureUser } from '../support/data';
import { sql } from '../support/db';

/**
 * Analytics hub and modules (src/components/FeaturesMenu.tsx, AnalyticsScopeBar.tsx and the module
 * components): the hub opens every module, the scope bar per role, every module renders for a team
 * without errors, team choice in ?team=, CSV / PDF exports, developer insights opt-in, and what a
 * module shows when its data cannot be loaded.
 */

const MODULES: Array<{ id: string; path: string; title: string }> = [
  { id: 'flaky-test-intelligence', path: '/analytics/flaky-tests', title: 'Flaky tests' },
  { id: 'test-execution-timeline', path: '/analytics/timeline', title: 'Test execution' },
  { id: 'technical-debt', path: '/analytics/technical-debt', title: 'Technical debt' },
  { id: 'performance-metrics', path: '/analytics/performance', title: 'Performance' },
  { id: 'pipeline-visualization', path: '/analytics/pipeline', title: 'CI/CD pipeline' },
  { id: 'developer-productivity', path: '/analytics/productivity', title: 'Developer productivity' },
  { id: 'team-pulse', path: '/analytics/pulse', title: 'Wellbeing pulse' },
  { id: 'business-impact', path: '/analytics/business-impact', title: 'Business impact' },
  { id: 'team-gamification', path: '/analytics/gamification', title: 'Team rankings' },
  { id: 'pdf-report-generator', path: '/analytics/reports', title: 'Reports' },
];

/** Whether the role chooses department / team in the scope bar or sees them fixed. */
const SCOPE: Record<Role, { department: 'select' | 'static'; team: 'select' | 'static' }> = {
  admin: { department: 'select', team: 'select' },
  manager: { department: 'static', team: 'select' },
  lead: { department: 'static', team: 'static' },
  engineer: { department: 'static', team: 'static' },
  viewer: { department: 'static', team: 'static' },
};

test.describe('Analytics', { tag: [TAG.area('analytics')] }, () => {
  test('AN-01 the hub opens each of the ten modules', { tag: [TAG.smoke] }, async ({ signInAs, page, app }) => {
    await signInAs('lead', '/analytics');
    for (const m of MODULES) {
      await page.goto('/analytics');
      await page.getByTestId(`feature-${m.id}`).click();
      await expect(app.title).toHaveText(m.title);
      await expect(page).toHaveURL(new RegExp(`${m.path}(\\?|$)`));
    }
  });

  for (const role of ALL_ROLES) {
    test(`AN-02 ${role}: the scope bar lets the role choose exactly what its scope allows`, { tag: [TAG.role(role)] }, async ({ signInAs, page }) => {
      await signInAs(role, '/analytics/technical-debt');
      await expect(page.getByTestId('analytics-scope-bar')).toBeVisible();
      const s = SCOPE[role];
      await expect(page.getByTestId(s.department === 'select' ? 'analytics-scope-department' : 'analytics-scope-department-static')).toBeVisible();
      await expect(page.getByTestId(s.team === 'select' ? 'analytics-scope-team' : 'analytics-scope-team-static')).toBeVisible();
      if (s.team === 'static') await expect(page.getByTestId('analytics-scope-team')).toHaveCount(0);
    });
  }

  test('AN-03 every module renders for a team without an uncaught error', { tag: [TAG.smoke] }, async ({ signInAs, page, app }) => {
    const noErrors = trackPageErrors(page);
    await signInAs('admin');
    for (const m of MODULES) {
      await page.goto(`${m.path}?team=${DEMO.leadTeam.id}`);
      await expect(app.title).toHaveText(m.title);
      await expect(page.getByTestId('analytics-scope-bar')).toBeVisible();
      await expect(page.locator('#main-scroll')).toContainText(m.title === 'Test execution' ? 'Test execution timeline' : m.title);
    }
    noErrors();
  });

  test('AN-04 the chosen team stays in the address while moving between modules', async ({ signInAs, page, app }) => {
    await signInAs('manager', '/analytics/flaky-tests');
    const select = page.getByTestId('analytics-scope-team');
    const values = await select.locator('option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value).filter(Boolean));
    const target = values.find((v) => v !== (DEMO.leadTeam.id)) ?? values[0];
    await select.selectOption(target);
    await expect(page).toHaveURL(new RegExp(`team=${target}`));
    await app.go('nav-pipeline-visualization', 'CI/CD pipeline');
    await expect(page).toHaveURL(new RegExp(`team=${target}`));
    await expect(page.getByTestId('analytics-scope-team')).toHaveValue(target);
  });

  test('AN-05 CSV and PDF exports download files', async ({ signInAs, page }) => {
    await signInAs('admin', `/analytics/technical-debt?team=${DEMO.leadTeam.id}`);
    const csv = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export CSV/ }).first().click();
    expect((await csv).suggestedFilename()).toMatch(/\.csv$/);
    await page.goto(`/analytics/reports?team=${DEMO.leadTeam.id}`);
    const pdf = page.waitForEvent('download');
    await page.getByTestId('download-team-report').click();
    expect((await pdf).suggestedFilename()).toMatch(/\.pdf$/);
  });

  test('AN-06 the analytics scope cannot be loaded: the modules say so', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await page.route(`${API_URL}/analytics/scope*`, (r) => r.fulfill({ status: 500, json: { error: 'Internal server error' } }));
    await signInAs('lead', '/analytics/technical-debt');
    await expect(page.getByText('Analytics scope unavailable')).toBeVisible();
    await expect(page.getByText('Could not load your analytics scope (500).')).toBeVisible();
  });

  const failing: Array<{ path: string; api: string; message: string | RegExp }> = [
    { path: '/analytics/flaky-tests', api: '/analytics/flaky-tests*', message: /Could not load flaky tests/ },
    { path: '/analytics/technical-debt', api: '/analytics/technical-debt*', message: /Could not load technical debt/ },
    { path: '/analytics/pipeline', api: '/analytics/pipeline*', message: /Could not load pipeline stages/ },
    { path: '/analytics/performance', api: '/analytics/performance*', message: /Could not load/ },
    { path: '/analytics/timeline', api: '/analytics/test-executions*', message: 'Could not load the test runs: the server had a problem. Try again in a moment. Reference: rid-mod.' },
    { path: '/analytics/reports', api: '/**', message: /Could not load report data/ },
  ];
  for (const f of failing) {
    test(`AN-07 ${f.path}: a server error shows a message, not an empty module`, { tag: [TAG.negative] }, async ({ signInAs, page }) => {
      await signInAs('admin');
      await page.route(new RegExp(`^${API_URL.replace(/[.]/g, '\\.')}/(?!auth/|analytics/scope|operator/status|teams$|notifications|pulse/pending|saved-views|activity/)`), (r) =>
        f.api === '/**' || new RegExp(f.api.replace('*', '')).test(r.request().url())
          ? r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'rid-mod' } })
          : r.continue());
      await page.goto(`${f.path}?team=${DEMO.leadTeam.id}`);
      await expect(page.getByText(f.message)).toBeVisible();
    });
  }

  test('AN-08 developer productivity: a server error is not shown as "no data"', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    test.fail(true, 'Found issue FI-06 (docs/testing/E2E_FLOWS.md): failed requests show "No data recorded".');
    await page.route(`${API_URL}/analytics/developer-metrics*`, (r) => r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'rid-dev' } }));
    await signInAs('admin', `/analytics/productivity?team=${DEMO.leadTeam.id}`);
    await expect(page.getByText(/Could not load/)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Developer insights opt-in', { tag: [TAG.area('analytics'), TAG.area('privacy')] }, () => {
  test('DEV-01 an engineer sees only their own developer row', { tag: [TAG.role('engineer')] }, async ({ signInAs, page }) => {
    await signInAs('engineer', '/analytics/productivity');
    await expect(page.getByTestId('own-row-only')).toHaveText('Showing your own metrics only');
    await expect(page.getByLabel('Developer')).toHaveCount(0);
  });

  test('DEV-02 a super admin switches a person\'s developer insights on and off in Users', { tag: [TAG.role('admin')] }, async ({ signInAs, page }) => {
    const user = await createFixtureUser();
    try {
      await signInAs('admin', '/users');
      await page.getByPlaceholder('Search users by name, email, team...').fill(user.email);
      const card = page.getByTestId('user-card').filter({ hasText: user.email });
      await expect(card.getByTestId('user-ai-status')).toHaveText('Developer insights off');
      await card.getByTestId('user-ai-toggle').click();
      await expect(card.getByTestId('user-ai-status')).toHaveText('Developer insights on');
      expect((await sql('SELECT developer_insights_enabled FROM users WHERE id = $1', [user.id]))[0].developer_insights_enabled).toBe(true);
      await card.getByTestId('user-ai-toggle').click();
      await expect(card.getByTestId('user-ai-status')).toHaveText('Developer insights off');
    } finally {
      await deleteFixtureUser(user.id);
    }
  });

  test('DEV-03 the opt-in cannot be changed by someone who does not manage the person', { tag: [TAG.negative, TAG.role('lead')] }, async ({ signInAs, page }) => {
    const user = await createFixtureUser(); // on the engineer's team, not led by lead@
    try {
      await signInAs('lead');
      const res = await page.request.patch(`${API_URL}/admin/users/${user.id}/developer-insights-toggle`, { data: { enabled: true } });
      expect([403, 404]).toContain(res.status());
      expect((await sql('SELECT developer_insights_enabled FROM users WHERE id = $1', [user.id]))[0].developer_insights_enabled).not.toBe(true);
    } finally {
      await deleteFixtureUser(user.id);
    }
  });
});
