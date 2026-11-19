import { test, expect, TAG } from '../support/fixtures';
import { expectNoHorizontalScroll } from '../support/app';
import { DEMO } from '../support/roles';

/**
 * Light / dark theme (src/contexts/ThemeContext.tsx: the choice is kept in the browser and the
 * system preference is ignored) and the phone layout (390 x 844): no page may scroll sideways.
 */

test.describe('Theme', { tag: [TAG.area('ux')] }, () => {
  test('UX-01 the theme switch toggles dark mode and the choice survives a reload and signing out', { tag: [TAG.smoke] }, async ({ signInAs, page, app }) => {
    await signInAs('viewer');
    const start = await app.isDark();
    await app.toggleTheme();
    await expect.poll(() => app.isDark()).toBe(!start);
    await page.reload();
    await expect(page.getByTestId('dashboard')).toBeVisible();
    expect(await app.isDark()).toBe(!start);
    await app.signOut();
    expect(await app.isDark()).toBe(!start);
    await page.evaluate(() => localStorage.removeItem('irongate_theme_mode'));
  });

  test('UX-02 the system dark preference does not override the light default', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false);
    await ctx.close();
  });
});

test.describe('Phone layout (390 px)', { tag: [TAG.area('ux')] }, () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('UX-10 sign-in, forgot-password and registration screens fit the phone', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goto('/forgot-password');
    await expectNoHorizontalScroll(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await expectNoHorizontalScroll(page);
  });

  const pages: Array<[string, string]> = [
    ['/', 'Overview'], ['/compare', 'Compare teams'], ['/analytics', 'Analytics'],
    [`/analytics/technical-debt?team=${DEMO.leadTeam.id}`, 'Technical debt'], [`/analytics/pulse?team=${DEMO.leadTeam.id}`, 'Wellbeing pulse'],
    [`/analytics/business-impact?team=${DEMO.leadTeam.id}`, 'Business impact'], [`/analytics/productivity?team=${DEMO.leadTeam.id}`, 'Developer productivity'],
    ['/notifications', 'Notifications'], ['/users', 'Users'], ['/teams', 'Teams'], ['/departments', 'Departments'],
    ['/activity', 'Activity'], ['/user-activity', 'User activity'], ['/parameters-config', 'Parameters'], ['/manual-metrics', 'Manual metrics'],
    ['/admin-panel', 'Admin console'], ['/ingestion-log', 'Ingestion log'], ['/metric-intervals', 'Expected update frequency'],
  ];
  for (const [path, title] of pages) {
    test(`UX-11 ${title} has no sideways scrolling on a phone`, async ({ signInAs, app }) => {
      await signInAs('admin', path);
      await expect(app.title).toHaveText(title);
      await expectNoHorizontalScroll(app.page);
    });
  }

  test('UX-12 team detail, its members and the navigation drawer fit the phone', async ({ signInAs, page, app }) => {
    await signInAs('viewer');
    await page.getByTestId('team-card').first().click();
    await expect(page.getByTestId('team-detail')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await app.openNav();
    const box = await app.drawer.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
  });

  test('UX-13 very long names and unicode do not break the phone layout', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('admin');
    const long = `${'Ünïcødé-名前-🚀-'.repeat(12)}VeryLongTeamNameWithoutAnySpacesThatCouldOverflowTheCard`;
    await page.route('http://localhost:3000/api/teams', async (r) => {
      const res = await r.fetch().catch(() => null);
      if (!res) return;
      const body = await res.json();
      body.teams = (body.teams ?? []).map((t: any, i: number) => (i === 0 ? { ...t, name: long } : t));
      await r.fulfill({ response: res, json: body });
    });
    await page.reload();
    await expect(page.getByTestId('team-name').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
