import { test, expect, TAG } from '../support/fixtures';
import { DEMO } from '../support/roles';
import { API_URL } from '../support/env';
import { uid } from '../support/ids';
import { sql } from '../support/db';
import type { Page } from '@playwright/test';

/**
 * Compare teams (src/components/CompareTeams.tsx) and saved views (SavedViewsMenu.tsx), beyond the
 * round trips in tests/e2e/compare-views-onboarding.spec.ts: the four-team limit, the window,
 * removing teams, addresses with bad or foreign team ids, sharing views (super admins only),
 * names with markup, double clicks, and a failed save.
 */

const chips = (page: Page) => page.getByTestId('compare-chip');

async function newView(page: Page, name: string, opts: { double?: boolean } = {}) {
  await page.getByTestId('saved-views-toggle').click();
  await page.getByTestId('saved-view-new').click();
  await page.getByTestId('saved-view-name').fill(name);
  if (opts.double) await page.getByTestId('saved-view-save').dblclick();
  else await page.getByTestId('saved-view-save').click();
  await expect(page.getByTestId('saved-views-toggle')).toContainText(name.slice(0, 20));
}

async function deleteViewsNamed(prefix: string) {
  await sql('DELETE FROM saved_views WHERE name LIKE $1', [`${prefix}%`]);
}

test.describe('Compare teams', { tag: [TAG.area('compare')] }, () => {
  test('CMP-01 at most four teams; removing one brings the add list back; the window is kept in the address', async ({ signInAs, page }) => {
    await signInAs('admin', '/compare');
    await expect(chips(page)).toHaveCount(2);
    const add = page.getByTestId('compare-add');
    for (let n = 3; n <= 4; n++) {
      const value = await add.locator('option').nth(1).getAttribute('value');
      await add.selectOption(value!);
      await expect(chips(page)).toHaveCount(n);
    }
    await expect(page.getByText('Teams (4 of 4)')).toBeVisible();
    await expect(add).toHaveCount(0);
    await page.getByRole('button', { name: /^Remove .* from the comparison$/ }).first().click();
    await expect(chips(page)).toHaveCount(3);
    await expect(page.getByTestId('compare-add')).toBeVisible();
    await page.getByTestId('compare-days').selectOption('90');
    await expect(page).toHaveURL(/days=90/);
    await page.reload();
    await expect(page.getByTestId('compare-days')).toHaveValue('90');
    await expect(chips(page)).toHaveCount(3);
  });

  test('CMP-02 an address with unknown ids, too many ids or a bad window falls back safely', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('manager', '/compare?teams=no-such-team,also-not,%3Cscript%3E,x,y,z&days=999&diff=1');
    await expect(page.getByTestId('compare-teams')).toBeVisible();
    await expect(page.getByTestId('compare-days')).toHaveValue('30');
    await expect(page.getByText(/Teams \(\d of 4\)/)).toBeVisible();
    expect(await chips(page).count()).toBeLessThanOrEqual(4);
  });

  test('CMP-03 a team outside the scope in the address is not compared', { tag: [TAG.negative, TAG.role('engineer')] }, async ({ signInAs, page }) => {
    await signInAs('engineer', `/compare?teams=${DEMO.engineerTeam.id},${DEMO.otherTeam.id}`);
    await expect(page.getByTestId('compare-teams')).toBeVisible();
    await expect(page.getByTestId('compare-team-card').filter({ hasText: DEMO.otherTeam.name })).toHaveCount(0);
  });

  test('CMP-04 a failed comparison request shows a message', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await page.route(`${API_URL}/compare/teams?*`, (r) => r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'rid-cmp' } }));
    await signInAs('admin', '/compare');
    await expect(page.getByTestId('compare-teams')).toContainText(/could not|failed|error/i);
  });
});

test.describe('Saved views', { tag: [TAG.area('saved-views')] }, () => {
  test('VIEW-01 a super admin shares a view; a manager sees it read-only and cannot share their own', { tag: [TAG.role('admin'), TAG.role('manager')] }, async ({ signInAs, page, app }) => {
    const name = `${uid('UI shared')}`;
    try {
      await signInAs('admin');
      await newView(page, name);
      await page.getByTestId('saved-view-item').filter({ hasText: name }).getByTestId('saved-view-share').click();
      await expect(page.getByTestId('saved-view-item').filter({ hasText: name }).getByTestId('saved-view-unshare')).toBeVisible();
      await page.keyboard.press('Escape');
      await app.signOut();

      await signInAs('manager');
      await page.getByTestId('saved-views-toggle').click();
      const shared = page.getByTestId('saved-view-item').filter({ hasText: name });
      await expect(shared).toBeVisible();
      await expect(shared.getByTestId('saved-view-delete')).toHaveCount(0);
      await expect(shared.getByTestId('saved-view-share')).toHaveCount(0);
      await shared.getByTestId('saved-view-apply').click();
      await expect(page.getByTestId('saved-views-toggle')).toContainText(name.slice(0, 20));

      const own = `${uid('UI mine')}`;
      await page.getByTestId('saved-views-toggle').click();
      await page.getByTestId('saved-view-new').click();
      await page.getByTestId('saved-view-name').fill(own);
      await page.getByTestId('saved-view-save').click();
      await page.getByTestId('saved-views-toggle').click();
      await expect(page.getByTestId('saved-view-item').filter({ hasText: own }).getByTestId('saved-view-share')).toHaveCount(0);
    } finally {
      await deleteViewsNamed('UI shared');
      await deleteViewsNamed('UI mine');
    }
  });

  test('VIEW-02 an empty name cannot be saved; a name with markup is shown as text; a double click saves once', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    const name = `UI xss <img src=x onerror="window.__xss=1"> ${uid()}`;
    try {
      await signInAs('lead');
      await page.getByTestId('saved-views-toggle').click();
      await page.getByTestId('saved-view-new').click();
      await expect(page.getByTestId('saved-view-save')).toBeDisabled();
      await page.getByTestId('saved-view-name').fill('   ');
      await expect(page.getByTestId('saved-view-save')).toBeDisabled();
      await page.getByTestId('saved-view-name').fill(name);
      await page.getByTestId('saved-view-save').dblclick();
      await page.getByTestId('saved-views-toggle').click().catch(() => undefined);
      await page.getByTestId('saved-views-toggle').click();
      await expect(page.getByTestId('saved-view-item').filter({ hasText: 'UI xss <img' })).toHaveCount(1);
      expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
    } finally {
      await deleteViewsNamed('UI xss');
    }
  });

  test('VIEW-03 a view of an analytics module keeps the team', async ({ signInAs, page }) => {
    const name = uid('UI module view');
    try {
      await signInAs('admin', `/analytics/technical-debt?team=${DEMO.engineerTeam.id}`);
      await newView(page, name);
      await page.keyboard.press('Escape');
      await page.getByTestId('analytics-scope-team').selectOption(DEMO.leadTeam.id).catch(async () => {
        await page.getByTestId('analytics-scope-department').selectOption({ label: DEMO.leadTeam.department });
        await page.getByTestId('analytics-scope-team').selectOption(DEMO.leadTeam.id);
      });
      await page.getByTestId('saved-views-toggle').click();
      await page.getByTestId('saved-view-item').filter({ hasText: name }).getByTestId('saved-view-apply').click();
      await expect(page).toHaveURL(new RegExp(`team=${DEMO.engineerTeam.id}`));
    } finally {
      await deleteViewsNamed('UI module view');
    }
  });

  test('VIEW-04 a failed save is reported and nothing is listed', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('viewer');
    await page.route(`${API_URL}/saved-views`, (r) => (r.request().method() === 'POST'
      ? r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'rid-view' } })
      : r.continue()));
    const name = uid('UI failing view');
    await page.getByTestId('saved-views-toggle').click();
    await page.getByTestId('saved-view-new').click();
    await page.getByTestId('saved-view-name').fill(name);
    await page.getByTestId('saved-view-save').click();
    await expect(page.getByRole('status').filter({ hasText: 'Internal server error' })).toBeVisible();
    await expect(page.getByTestId('saved-view-item').filter({ hasText: name })).toHaveCount(0);
  });
});
