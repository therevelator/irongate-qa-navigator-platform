import { test, expect, TAG } from '../support/fixtures';
import { expectNoHorizontalScroll, trackPageErrors } from '../support/app';
import { signInWithForm, credentialsOf } from '../support/auth';

/**
 * Read-only smoke checks that also run against a deployed site (npm run test:ui:remote): they work
 * for any account and any data, and change nothing (no form is submitted except the sign-in, and
 * nothing is saved; the theme switch is per browser). Locally and in CI they run with the demo
 * super admin. Remote mode signs in with UI_REMOTE_EMAIL / UI_REMOTE_PASSWORD.
 */

test.describe('Live smoke (read-only)', { tag: [TAG.readonly, TAG.smoke, TAG.area('smoke')] }, () => {
  test('LIVE-01 the sign-in screen loads with its links', async ({ page }) => {
    const noErrors = trackPageErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByTestId('forgot-password-link')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create an account' })).toBeVisible();
    await page.getByTestId('forgot-password-link').click();
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
    noErrors();
  });

  test('LIVE-02 sign in, see the overview and open the first team', async ({ page }) => {
    const noErrors = trackPageErrors(page);
    await page.goto('/');
    await signInWithForm(page, credentialsOf('admin'));
    await expect(page.getByTestId('dashboard')).toBeVisible();
    const card = page.getByTestId('team-card').first();
    if (await card.count()) {
      await card.click();
      await expect(page.getByTestId('team-detail')).toBeVisible();
      await page.getByTestId('back-to-dashboard').click();
    }
    noErrors();
  });

  test('LIVE-03 every page in the navigation opens', async ({ page, app }) => {
    const noErrors = trackPageErrors(page);
    await page.goto('/');
    await signInWithForm(page, credentialsOf('admin'));
    for (const id of (await app.navItems()).filter((n) => n !== 'nav-operator')) {
      await app.go(id);
      if (id === 'nav-tv') {
        // TV mode is full screen (no app chrome): leave it with its Exit button.
        await expect(page.getByTestId('tv-mode')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('nav-toggle')).toBeVisible();
        continue;
      }
      await expect(app.title).not.toBeEmpty();
    }
    noErrors();
  });

  test('LIVE-04 unknown addresses lead to the overview; the theme switch works; the phone layout fits', async ({ page, app }) => {
    await page.goto('/');
    await signInWithForm(page, credentialsOf('admin'));
    await page.goto('/this-page-does-not-exist');
    await expect(page.getByTestId('dashboard')).toBeVisible();
    const dark = await app.isDark();
    await app.toggleTheme();
    await expect.poll(() => app.isDark()).toBe(!dark);
    await app.toggleTheme();
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
  });
});
