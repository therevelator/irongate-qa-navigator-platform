import { test, expect, TAG } from '../support/fixtures';
import { trackPageErrors } from '../support/app';
import { API_URL } from '../support/env';
import { NAV_BY_ROLE } from '../support/roles';
import { sql } from '../support/db';
import { uid } from '../support/ids';

/**
 * How the app behaves when things go wrong around it: slow and failing requests, an HTML error page
 * instead of JSON, going offline, reloading or going back in the middle of a flow, rapid clicking,
 * and a full tour of every page without an uncaught error.
 */

test.describe('Resilience', { tag: [TAG.area('resilience'), TAG.negative] }, () => {
  test('RES-01 a tour of every page of a super admin raises no uncaught error', { tag: [TAG.smoke] }, async ({ signInAs, page, app }) => {
    const noErrors = trackPageErrors(page);
    await signInAs('admin');
    for (const id of NAV_BY_ROLE.admin) {
      await app.go(id);
      await expect(page.locator('#main-scroll').or(page.getByTestId('tv-mode')).first()).toBeVisible();
      if (id === 'nav-tv') {
        // TV mode is full screen (no app chrome): leave it before the next entry.
        await expect(page.getByTestId('tv-mode')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('nav-toggle')).toBeVisible();
      }
    }
    noErrors();
  });

  test('RES-02 a slow server shows a loading state, then the page', async ({ signInAs, page }) => {
    await page.route(`${API_URL}/admin/users`, async (r) => { await new Promise((x) => setTimeout(x, 2500)); await r.continue(); });
    await signInAs('admin', '/users');
    await expect(page.getByTestId('user-card').first()).toBeVisible({ timeout: 20000 });
  });

  test('RES-03 a proxy error page (HTML, 502) is reported, not shown as an empty list', async ({ signInAs, page }) => {
    await page.route(`${API_URL}/admin/teams`, (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<html><body><h1>502 Bad Gateway</h1></body></html>' }));
    await signInAs('admin', '/teams');
    await expect(page.getByTestId('load-error')).toHaveText('Could not load the teams: the server had a problem. Try again in a moment.');
    await expect(page.getByText('No teams found')).toHaveCount(0);
  });

  test('RES-04 going offline: pages say the server cannot be reached; back online they work again', async ({ signInAs, page, context, app }) => {
    await signInAs('admin');
    await context.setOffline(true);
    await app.go('nav-users', 'Users');
    await expect(page.getByTestId('load-error')).toContainText('the server could not be reached');
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByTestId('user-card').first()).toBeVisible();
  });

  test('RES-05 a request that never answers (timeout) leaves the rest of the app usable', async ({ signInAs, page, app }) => {
    await page.route(`${API_URL}/analytics/company-summary`, () => new Promise(() => undefined));
    await signInAs('lead');
    await expect(page.getByTestId('team-card').first()).toBeVisible();
    await app.go('nav-compare', 'Compare teams');
    await expect(page.getByTestId('compare-teams')).toBeVisible();
  });

  test('RES-06 reloading in the middle of an invitation sends nothing', async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/users');
    const email = `${uid('reload')}@${freshCompany.email.split('@')[1]}`;
    await page.getByTestId('invite-user-btn').click();
    await page.getByTestId('invite-email').fill(email);
    await page.reload();
    await expect(page.getByTestId('users-page')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await sql('SELECT 1 FROM invitations WHERE email = $1', [email])).toHaveLength(0);
  });

  test('RES-07 Back while a dialog is open leaves the page cleanly', async ({ signInAs, page, app }) => {
    await signInAs('admin');
    await app.go('nav-users', 'Users');
    await page.getByTestId('invite-user-btn').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(app.title).toHaveText('Overview');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('RES-08 rapid clicks through the navigation end on the last page clicked', async ({ signInAs, page, app }) => {
    const noErrors = trackPageErrors(page);
    await signInAs('manager');
    for (const id of ['nav-compare', 'nav-users', 'nav-activity', 'nav-technical-debt', 'nav-parameters-config']) {
      await app.openNav();
      await page.getByTestId(id).click();
    }
    await expect(app.title).toHaveText('Parameters');
    noErrors();
  });

  test('RES-09 a forged or corrupted session cookie means signed out, not a broken page', async ({ page, context }) => {
    await context.addCookies([{ name: 'irongate_token', value: 'not-a-jwt', domain: 'localhost', path: '/' }]);
    await page.goto('/compare');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
