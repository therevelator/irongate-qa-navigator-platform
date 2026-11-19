import { test, expect, TAG } from '../support/fixtures';
import { ALL_ROLES } from '../support/roles';
import { API_URL } from '../support/env';
import { uid } from '../support/ids';
import type { Page } from '@playwright/test';

/**
 * Platform support panel (src/components/operator/*), the parts tests/e2e/platform-operator.spec.ts
 * does not cover: who can enter, the session kept in memory only (a reload asks again), the tabs,
 * the request id search, a reason that is too short, a failed repair action showing its request
 * id, and the transparency entry in the company's own Activity log. admin@irongate.com is the
 * operator (PLATFORM_OPERATOR_EMAILS). Wrong passwords are avoided (5 lock the step for 15 minutes).
 */

async function stepUp(page: Page) {
  await page.getByTestId('operator-password').fill('demo123');
  await page.getByTestId('operator-enter').click();
  await expect(page.getByTestId('operator-overview')).toBeVisible({ timeout: 30000 });
}

test.describe('Platform support panel', { tag: [TAG.area('operator')] }, () => {
  for (const role of ALL_ROLES.filter((r) => r !== 'admin')) {
    test(`OPS-01 ${role}: no Platform entry and /operator is not available`, { tag: [TAG.negative, TAG.role(role)] }, async ({ signInAs, page, app }) => {
      await signInAs(role);
      await app.openNav();
      await expect(page.getByTestId('nav-operator')).toHaveCount(0);
      await page.goto('/operator');
      await expect(page.getByText('This area is not available for your account.')).toBeVisible();
    });
  }

  test('OPS-02 the support session lives in memory only: a reload asks for the password again', { tag: [TAG.role('admin')] }, async ({ signInAs, page }) => {
    await signInAs('admin', '/operator');
    await stepUp(page);
    await page.reload();
    await expect(page.getByTestId('operator-stepup')).toBeVisible();
  });

  test('OPS-03 tabs: error search by request id (none found) and the access log', { tag: [TAG.role('admin')] }, async ({ signInAs, page }) => {
    await signInAs('admin', '/operator');
    await stepUp(page);
    await page.getByRole('button', { name: 'Error search', exact: true }).click();
    await page.getByTestId('operator-rid').fill(`no-such-request-${uid()}`);
    await page.getByTestId('operator-rid-search').click();
    await expect(page.locator('#main-scroll')).toContainText(/No (server )?errors|Nothing|No matching/i);
    await page.getByRole('button', { name: 'Access log', exact: true }).click();
    await expect(page.locator('#main-scroll')).toContainText('step_up');
  });

  test('OPS-04 a reason shorter than 3 characters cannot open a company; Cancel closes', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('admin', '/operator');
    await stepUp(page);
    await page.getByTestId('operator-open-company').first().click();
    await page.getByTestId('operator-open-reason').fill('  x ');
    await expect(page.getByTestId('operator-open-confirm')).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('operator-overview')).toBeVisible();
  });

  test('OPS-05 a failed repair action shows the error with its request id', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('admin', '/operator');
    await stepUp(page);
    await page.route(`${API_URL}/operator/actions/**`, (r) => r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'rid-op-500' } }));
    await page.getByTestId('op-demo-refresh').click();
    await page.getByTestId('op-action-reason').fill('UI test of a failing action');
    await page.getByTestId('op-action-confirm-check').check();
    await page.getByTestId('op-action-run').click();
    await expect(page.getByText('Internal server error (request id rid-op-500)')).toBeVisible();
  });

  test('OPS-06 opening a company is written to that company\'s Activity log with the reason', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page, app }) => {
    const reason = `UI test reason ${uid()}`;
    await signInAs('admin', '/operator');
    await stepUp(page);
    await page.getByRole('row', { name: new RegExp(freshCompany.name) }).getByTestId('operator-open-company').click();
    await page.getByTestId('operator-open-reason').fill(reason);
    await page.getByTestId('operator-open-confirm').click();
    await expect(page.getByTestId('op-organisation')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('operator-leave').click();
    await app.signOut();

    await signInAs(freshCompany, '/activity');
    // One entry per section opened (organisation, ...), each with the reason, by platform support.
    const rows = page.getByTestId('activity-row').filter({ hasText: reason });
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) await expect(row).toContainText('IronGate platform support');
  });
});
