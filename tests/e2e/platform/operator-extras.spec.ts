import { test, expect, TAG } from '../support/fixtures';
import { ALL_ROLES } from '../support/roles';
import { API_URL } from '../support/env';
import { uid } from '../support/ids';
import { operatorSignIn } from '../support/operator';

/**
 * Platform support panel (src/components/operator/*), the parts tests/e2e/platform-operator.spec.ts
 * does not cover: company users never get in, the session survives a reload until Sign out, the
 * tabs, the request id search, a reason that is too short, a failed repair action showing its
 * request id, full data views, and the transparency entry in the company's own Activity log.
 * The operator is a platform_operators account (tests/e2e/support/operator.ts), not a company user.
 */

test.describe('Platform support panel', { tag: [TAG.area('operator')] }, () => {
  for (const role of ALL_ROLES) {
    test(`OPS-01 ${role}: no Platform entry; /operator asks for a platform support account`, { tag: [TAG.negative, TAG.role(role)] }, async ({ signInAs, page, app }) => {
      await signInAs(role);
      await app.openNav();
      await expect(page.getByTestId('nav-operator')).toHaveCount(0);
      await operatorSignIn(page).catch(() => undefined); // makes sure an operator exists
      await page.getByTestId('operator-leave').click().catch(() => undefined);
      await page.goto('/operator');
      await expect(page.getByTestId('operator-signin')).toBeVisible();
      await expect(page.getByTestId('operator-overview')).toHaveCount(0);
    });
  }

  test('OPS-02 the support session survives a reload; Sign out ends it', async ({ page }) => {
    await operatorSignIn(page);
    await page.reload();
    await expect(page.getByTestId('operator-overview')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('operator-leave').click();
    await expect(page.getByTestId('operator-signin')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('operator-signin')).toBeVisible();
  });

  test('OPS-03 tabs: error search by request id (none found) and the access log', async ({ page }) => {
    await operatorSignIn(page);
    await page.getByRole('button', { name: 'Error search', exact: true }).click();
    await page.getByTestId('operator-rid').fill(`no-such-request-${uid()}`);
    await page.getByTestId('operator-rid-search').click();
    await expect(page.locator('#main-scroll')).toContainText(/No (server )?errors|Nothing|No matching/i);
    await page.getByRole('button', { name: 'Access log', exact: true }).click();
    await expect(page.locator('#main-scroll')).toContainText('sign_in.ok');
  });

  test('OPS-04 a reason shorter than 3 characters cannot open a company; Cancel closes', { tag: [TAG.negative] }, async ({ page }) => {
    await operatorSignIn(page);
    await page.getByTestId('operator-open-company').first().click();
    await page.getByTestId('operator-open-reason').fill('  x ');
    await expect(page.getByTestId('operator-open-confirm')).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('operator-overview')).toBeVisible();
  });

  test('OPS-05 a failed repair action shows the error with its request id', { tag: [TAG.negative] }, async ({ page }) => {
    await operatorSignIn(page);
    await page.route(`${API_URL}/operator/actions/**`, (r) => r.fulfill({ status: 500, json: { error: 'Internal server error', requestId: 'rid-op-500' } }));
    await page.getByTestId('op-demo-refresh').click();
    await page.getByTestId('op-action-reason').fill('UI test of a failing action');
    await page.getByTestId('op-action-confirm-check').check();
    await page.getByTestId('op-action-run').click();
    await expect(page.getByText('Internal server error (request id rid-op-500)')).toBeVisible();
  });

  test('OPS-07 "Refresh sample data now": started in the background on the hosted site, run directly elsewhere', async ({ page }) => {
    await operatorSignIn(page);
    const bodies: any[] = [];
    let mode: 'background' | 'direct' = 'background';
    // The answer of the API function on Netlify (202 started) and of a long-running server (the result).
    await page.route(`${API_URL}/operator/actions/demo-refresh`, async (r) => {
      bodies.push(r.request().postDataJSON());
      await r.fulfill(mode === 'background'
        ? { status: 202, json: { started: true, mode: 'background' } }
        : { status: 200, json: { started: true, mode: 'direct', result: { insertedTotal: 5, companies: [] } } });
    });
    await page.getByRole('button', { name: 'Refresh sample data now' }).click();
    await expect(page.getByRole('dialog')).toContainText('runs in the background for a few minutes');
    await expect(page.getByTestId('op-action-run')).toBeDisabled();
    await page.getByTestId('op-action-reason').fill('Sample data is a day behind');
    await page.getByTestId('op-action-confirm-check').check();
    await page.getByRole('button', { name: 'Refresh now' }).click();
    await expect(page.getByText('Sample data refresh started. It runs in the background for a few minutes.')).toBeVisible();
    expect(bodies[0]).toEqual({ reason: 'Sample data is a day behind', confirm: true });

    mode = 'direct';
    await page.getByRole('button', { name: 'Refresh sample data now' }).click();
    await page.getByTestId('op-action-reason').fill('Sample data is a day behind');
    await page.getByTestId('op-action-confirm-check').check();
    await page.getByRole('button', { name: 'Refresh now' }).click();
    await expect(page.getByText('Sample data refreshed: 5 new rows.')).toBeVisible();
  });

  test('OPS-08 every module of a company in detail: all developer rows, single pulse answers, module data', async ({ page }) => {
    await operatorSignIn(page);
    await page.getByRole('row', { name: /Northwind/ }).getByTestId('operator-open-company').click();
    await page.getByTestId('operator-open-reason').fill('UI test: full data views');
    await page.getByTestId('operator-open-confirm').click();
    await expect(page.getByTestId('op-organisation')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await expect(page.getByTestId('op-developers')).toContainText('Opted in', { timeout: 30000 });
    await page.getByRole('button', { name: 'Wellbeing pulse', exact: true }).click();
    await expect(page.getByTestId('op-pulse-answers').first()).toContainText('Workload', { timeout: 30000 });
    await expect(page.getByText('The app never stores which person gave which answer.')).toBeVisible();
    await page.getByRole('button', { name: 'Modules', exact: true }).click();
    await expect(page.getByTestId('op-module-technical_debt')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('op-module-pipeline_runs')).toBeVisible();
  });

  test('OPS-06 opening a company is written to that company\'s Activity log with the reason', async ({ freshCompany, signInAs, page }) => {
    const reason = `UI test reason ${uid()}`;
    await operatorSignIn(page);
    await page.getByRole('row', { name: new RegExp(freshCompany.name) }).getByTestId('operator-open-company').click();
    await page.getByTestId('operator-open-reason').fill(reason);
    await page.getByTestId('operator-open-confirm').click();
    await expect(page.getByTestId('op-organisation')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('operator-leave').click();

    await signInAs(freshCompany, '/activity');
    // One entry per section opened (organisation, ...), each with the reason, by platform support.
    const rows = page.getByTestId('activity-row').filter({ hasText: reason });
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) await expect(row).toContainText('IronGate platform support');
  });
});
