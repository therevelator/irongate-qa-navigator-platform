import { test, expect, TAG } from '../support/fixtures';
import { ALL_ROLES, NAV_BY_ROLE, OPEN_PAGES, RESTRICTED_PAGES, DEMO, type Role } from '../support/roles';
import { API_URL } from '../support/env';

/**
 * Navigation per role (src/components/Layout.tsx NAV_GROUPS, src/App.tsx hasPermission), direct
 * URLs to pages a role may not open (the app sends them to the overview: there is no separate
 * "access denied" page), unknown routes, back / forward / reload, the navigation drawer itself.
 */

test.describe('Navigation per role', { tag: [TAG.area('navigation')] }, () => {
  for (const role of ALL_ROLES) {
    test(`NAV-01 ${role} sees exactly the navigation entries of the role`, { tag: [TAG.smoke, TAG.role(role)] }, async ({ signInAs, app }) => {
      await signInAs(role);
      await expect.poll(() => app.navItems()).toEqual(NAV_BY_ROLE[role]);
    });

    test(`NAV-02 ${role}: every page of the role opens from its address with its title`, { tag: [TAG.role(role)] }, async ({ signInAs, page, app }) => {
      await signInAs(role);
      const pages = [...OPEN_PAGES, ...RESTRICTED_PAGES.filter((p) => p.allowed.includes(role))];
      for (const p of pages) {
        await page.goto(p.path);
        await expect(app.title, p.path).toHaveText(p.title);
        expect(new URL(page.url()).pathname, p.path).toBe(p.path);
      }
    });

    const forbidden = RESTRICTED_PAGES.filter((p) => !p.allowed.includes(role));
    if (forbidden.length) {
      test(`NAV-03 ${role}: pages of other roles typed in the address bar lead to the overview with an access message`, { tag: [TAG.negative, TAG.role(role)] }, async ({ signInAs, page, app }) => {
        await signInAs(role);
        for (const p of forbidden) {
          await page.goto(p.path);
          await expect(page.getByTestId('dashboard'), p.path).toBeVisible();
          await expect(app.title).toHaveText('Overview');
          await expect(page, p.path).toHaveURL(/\/$/);
          const notice = page.getByTestId('access-denied');
          await expect(notice, p.path).toHaveRole('alert');
          await expect(notice, p.path).toContainText(`You don't have access to ${p.title}.`);
          await expect(notice).toBeFocused();
        }
        // The message goes when it is dismissed, and when another page is opened.
        await page.getByTestId('access-denied').getByRole('button', { name: 'Dismiss' }).click();
        await expect(page.getByTestId('access-denied')).toHaveCount(0);
        await page.goto(forbidden[0].path);
        await expect(page.getByTestId('access-denied')).toBeVisible();
        await app.go('nav-compare', 'Compare teams');
        await app.go('nav-dashboard', 'Overview');
        await expect(page.getByTestId('access-denied')).toHaveCount(0);
      });
    }
  }

  test('NAV-04 the API refuses what the navigation hides, even when called directly (403 before the body is checked)', { tag: [TAG.negative, TAG.role('viewer'), TAG.role('engineer')] }, async ({ signInAs, page }) => {
    const checks: Array<[Role, string, string]> = [
      ['viewer', 'GET', '/admin/audit'],
      ['viewer', 'GET', '/activity/log'],
      ['engineer', 'GET', '/ingestion-log'],
      ['engineer', 'PUT', '/targets'],
      ['viewer', 'POST', '/admin/users'],
      ['engineer', 'POST', '/admin/users'],
      ['viewer', 'POST', '/admin/configs'],
      ['engineer', 'PUT', '/alerts/rules'],
      ['viewer', 'POST', '/metrics/manual'],
    ];
    for (const [role, method, path] of checks) {
      await page.context().clearCookies();
      await signInAs(role);
      // An empty body: the refusal must not depend on (or describe) what a valid body looks like.
      const res = await page.request.fetch(`${API_URL}${path}`, { method, data: method === 'GET' ? undefined : {} });
      expect(res.status(), `${role} ${method} ${path}`).toBe(403);
    }
  });

  test('NAV-05 a refusal by the API during an action is shown, the page stays usable', { tag: [TAG.negative, TAG.role('lead')] }, async ({ signInAs, page }) => {
    // Rights can change while a page is open (an assignment revoked elsewhere): the API then refuses.
    await signInAs('lead', '/users');
    await page.route(`${API_URL}/admin/users/*/toggle-status`, (r) => r.fulfill({ status: 403, json: { error: 'You cannot manage this user' } }));
    const card = page.getByTestId('user-card').filter({ has: page.getByTestId('user-status-toggle') }).first();
    await card.getByTestId('user-status-toggle').click();
    await expect(page.getByText('Failed to update status')).toBeVisible();
    await expect(page.getByTestId('users-page')).toBeVisible();
  });
});

test.describe('Routes, history and the navigation drawer', { tag: [TAG.area('navigation')] }, () => {
  test('NAV-10 unknown addresses open the overview instead of a blank page', { tag: [TAG.negative, TAG.smoke] }, async ({ signInAs, page, app }) => {
    await signInAs('engineer');
    for (const path of ['/no-such-page', '/analytics/unknown-module', '/users/123/edit', '/%E2%9C%93?x=%3Cscript%3E']) {
      await page.goto(path);
      await expect(page.getByTestId('dashboard'), path).toBeVisible();
      await expect(app.title).toHaveText('Overview');
    }
  });

  test('NAV-11 unknown addresses while signed out show the sign-in screen', { tag: [TAG.negative] }, async ({ page }) => {
    await page.goto('/definitely/not/here');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('NAV-12 Back and Forward move between pages opened from the navigation', { tag: [TAG.smoke] }, async ({ signInAs, page, app }) => {
    await signInAs('manager');
    await app.go('nav-compare', 'Compare teams');
    await app.go('nav-technical-debt', 'Technical debt');
    await app.go('nav-users', 'Users');
    await page.goBack();
    await expect(app.title).toHaveText('Technical debt');
    await page.goBack();
    await expect(app.title).toHaveText('Compare teams');
    await page.goForward();
    await expect(app.title).toHaveText('Technical debt');
  });

  test('NAV-13 reloading keeps the page and the analytics team (?team=)', async ({ signInAs, page, app }) => {
    await signInAs('admin', `/analytics/technical-debt?team=${DEMO.engineerTeam.id}`);
    await expect(page.getByTestId('analytics-scope-team')).toHaveValue(DEMO.engineerTeam.id);
    await page.reload();
    await expect(app.title).toHaveText('Technical debt');
    await expect(page).toHaveURL(new RegExp(`team=${DEMO.engineerTeam.id}`));
    await expect(page.getByTestId('analytics-scope-team')).toHaveValue(DEMO.engineerTeam.id);
  });

  test('NAV-14 a team outside the scope in ?team= is not shown', { tag: [TAG.negative, TAG.role('engineer')] }, async ({ signInAs, page }) => {
    await signInAs('engineer', `/analytics/technical-debt?team=${DEMO.otherTeam.id}`);
    await expect(page.getByTestId('analytics-scope-bar')).toBeVisible();
    await expect(page.getByText(DEMO.otherTeam.name)).toHaveCount(0);
  });

  test('NAV-15 the drawer closes with Escape and the backdrop, and gives focus back to the menu button', async ({ signInAs, page, app }) => {
    await signInAs('viewer');
    await app.openNav();
    await page.keyboard.press('Escape');
    await expect(app.burger).toHaveAttribute('aria-expanded', 'false');
    await expect(app.burger).toBeFocused();
    await app.openNav();
    await page.getByTestId('nav-backdrop').click({ position: { x: 1200, y: 400 } });
    await expect(app.burger).toHaveAttribute('aria-expanded', 'false');
  });

  test('NAV-16 on a wide screen the navigation can be pinned and stays pinned after a reload', async ({ signInAs, page, app }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAs('viewer');
    await app.openNav();
    await page.getByTestId('nav-pin').click();
    await expect(page.getByTestId('nav-pin')).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByTestId('sidebar-nav')).toBeVisible();
    await expect(app.burger).toHaveAttribute('aria-label', 'Hide navigation');
    await app.burger.click(); // unpin again (per-browser preference)
    await expect(page.getByTestId('sidebar-nav')).toBeHidden();
  });

  test('NAV-17 the brand button returns to the overview from any page', async ({ signInAs, page, app }) => {
    await signInAs('lead', '/compare');
    await page.getByRole('button', { name: 'IronGate QE Navigator, go to overview' }).click();
    await expect(app.title).toHaveText('Overview');
  });
});
