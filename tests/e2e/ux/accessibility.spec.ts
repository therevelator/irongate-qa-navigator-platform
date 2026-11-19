import { test, expect, TAG } from '../support/fixtures';
import { checkA11y } from '../support/a11y';
import { DEMO } from '../support/roles';

/**
 * Accessibility smoke check with axe-core on the main pages: serious and critical violations fail.
 * No page has a known (accepted) violation any more: the colour-contrast problems KA11Y-01 … 04 were
 * fixed, and A11Y-13 checks the same pages in the dark theme. A new problem that has to be accepted
 * for a while goes into `known` and docs/testing/E2E_FLOWS.md ("Known accessibility issues").
 */

test.describe('Accessibility', { tag: [TAG.a11y, TAG.area('ux')] }, () => {
  test('A11Y-01 sign-in screen', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await checkA11y(page, testInfo, { known: [] });
  });

  test('A11Y-02 forgot password and registration', async ({ page }, testInfo) => {
    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
    await checkA11y(page, testInfo, { known: [] });
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await expect(page.getByRole('heading', { name: 'Create your organisation' })).toBeVisible();
    await checkA11y(page, testInfo, { known: [] });
  });

  const pages: Array<{ id: string; path: string; title: string; known: string[] }> = [
    { id: 'A11Y-03', path: '/', title: 'Overview', known: [] },
    { id: 'A11Y-04', path: '/compare', title: 'Compare teams', known: [] },
    { id: 'A11Y-05', path: `/analytics/pulse?team=${DEMO.leadTeam.id}`, title: 'Wellbeing pulse', known: [] },
    { id: 'A11Y-06', path: `/analytics/technical-debt?team=${DEMO.leadTeam.id}`, title: 'Technical debt', known: [] },
    { id: 'A11Y-07', path: '/notifications', title: 'Notifications', known: [] },
    { id: 'A11Y-08', path: '/users', title: 'Users', known: [] },
    { id: 'A11Y-09', path: '/parameters-config', title: 'Parameters', known: [] },
    { id: 'A11Y-10', path: '/activity', title: 'Activity', known: [] },
  ];
  for (const p of pages) {
    test(`${p.id} ${p.title}`, async ({ signInAs, app }, testInfo) => {
      await signInAs('admin', p.path);
      await expect(app.title).toHaveText(p.title);
      await app.page.waitForLoadState('networkidle').catch(() => undefined);
      await checkA11y(app.page, testInfo, { known: p.known });
    });
  }

  test('A11Y-11 team detail', async ({ signInAs, page }, testInfo) => {
    await signInAs('admin');
    await page.getByTestId('team-card').filter({ hasText: DEMO.leadTeam.name }).first().click();
    await expect(page.getByTestId('team-detail')).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await checkA11y(page, testInfo, { known: [] });
  });

  test('A11Y-12 navigation drawer and dark mode overview', async ({ signInAs, page, app }, testInfo) => {
    await signInAs('admin');
    await app.toggleTheme();
    await app.openNav();
    await checkA11y(page, testInfo, { known: [] });
    await app.closeNav();
    await app.toggleTheme();
  });

  test('A11Y-13 compare teams, users and team detail in the dark theme', async ({ signInAs, page, app }, testInfo) => {
    await signInAs('admin', '/compare');
    await app.toggleTheme();
    expect(await app.isDark()).toBe(true);
    for (const [path, title] of [['/compare', 'Compare teams'], ['/users', 'Users']] as const) {
      await page.goto(path);
      await expect(app.title).toHaveText(title);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await checkA11y(page, testInfo, { known: [] });
    }
    await page.goto('/');
    await page.getByTestId('team-card').filter({ hasText: DEMO.leadTeam.name }).first().click();
    await expect(page.getByTestId('team-detail')).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await checkA11y(page, testInfo, { known: [] });
    await app.toggleTheme();
  });
});
