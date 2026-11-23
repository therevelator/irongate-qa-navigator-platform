import { test, expect, TAG } from '../support/fixtures';
import { DEMO } from '../support/roles';
import { API_URL } from '../support/env';
import { checkA11y } from '../support/a11y';
import type { Page } from '@playwright/test';

/**
 * v2 phase 1 in the app: the team page's "Evidence from CI" (flaky tests with the runs that prove
 * them, lowest-coverage files, slowest tests, failing stages; the sample teams carry sample raw CI
 * data), "How this was calculated" from a KPI card and from a calculated metric, and Admin console →
 * Connect your CI (copy-paste steps per CI tool, the test call, last data received, main branch).
 */

async function openTeam(page: Page, name: string) {
  await page.getByLabel('Search teams').fill(name);
  await page.getByTestId('team-card').filter({ hasText: name }).first().click();
  await expect(page.getByTestId('team-detail')).toBeVisible();
}

const JUNIT = '<testsuites><testsuite name="s" time="1.5"><testcase classname="checkout" name="pays" time="0.5"/><testcase classname="checkout" name="refunds" time="1"><failure message="boom"/></testcase></testsuite></testsuites>';

test.describe('Evidence from CI', { tag: [TAG.area('team'), TAG.area('ci-evidence')] }, () => {
  test('CIEV-01 the team page shows flaky tests with their runs, lowest-coverage files, slowest tests and failing stages', { tag: [TAG.smoke, TAG.role('admin')] }, async ({ signInAs, page }) => {
    await signInAs('admin');
    await openTeam(page, DEMO.leadTeam.name);
    const ev = page.getByTestId('ci-evidence');
    await expect(ev.getByRole('heading', { name: 'Evidence from CI' })).toBeVisible();
    await expect(ev.getByTestId('ci-computed-metrics')).toBeVisible();
    await expect(ev.getByTestId('ci-lowest-files').locator('tbody tr').first()).toBeVisible();
    await expect(ev.getByTestId('ci-slowest-tests').locator('tbody tr').first()).toBeVisible();
    await expect(ev.getByTestId('ci-failing-stage').first()).toBeVisible();
    await expect(ev.getByTestId('ci-last-received')).toContainText('Tests:');
    const flaky = ev.getByTestId('ci-flaky-test');
    if (await flaky.count()) {
      await expect(flaky.first()).toContainText(/Failed in \d+ runs?, passed in \d+/);
      await expect(flaky.first().getByText(/^failed · run/).first()).toBeVisible();
      await expect(flaky.first().getByText(/^passed · run/).first()).toBeVisible();
    }
  });

  test('CIEV-02 How this was calculated: from a KPI card and from a calculated metric, with the formula, values and source runs', { tag: [TAG.role('admin'), TAG.a11y] }, async ({ signInAs, page }, testInfo) => {
    await signInAs('admin');
    await openTeam(page, DEMO.leadTeam.name);
    await page.getByTestId('how-calculated-test_coverage').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('How this was calculated: Line coverage');
    await expect(dialog.getByTestId('how-calculated-formula')).toContainText('lines hit ÷ lines found');
    await expect(dialog.getByTestId('how-calculated-inputs')).toContainText('Lines found');
    await expect(dialog.getByTestId('how-calculated-sources')).toContainText('Coverage report');
    await expect(dialog).toContainText('sample CI data');
    await checkA11y(page, testInfo, { include: '[role="dialog"]' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.getByTestId('ci-metric-build_time').click();
    await expect(page.getByRole('dialog')).toContainText('Average build time');
    await expect(page.getByRole('dialog').getByTestId('how-calculated-sources')).toContainText('Pipeline run');
    await page.getByRole('button', { name: 'Close' }).click();
    await checkA11y(page, testInfo, { include: '[data-testid="ci-evidence"]' });
  });

  test('CIEV-03 an engineer sees the evidence of their own team; another team is refused by the API', { tag: [TAG.role('engineer'), TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('engineer');
    await openTeam(page, DEMO.engineerTeam.name);
    await expect(page.getByTestId('ci-evidence')).toBeVisible();
    expect((await page.request.get(`${API_URL}/ci/teams/${DEMO.otherTeam.id}/evidence`)).status()).toBe(403);
    expect((await page.request.get(`${API_URL}/ci/status`)).status()).toBe(403);
  });

  test('CIEV-04 a team without CI data says so and points the admin to Connect your CI', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany);
    await openTeam(page, freshCompany.teamName);
    await expect(page.getByTestId('ci-evidence')).toContainText('No CI data for this team yet');
    await expect(page.getByTestId('ci-evidence')).toContainText('Connect your CI');
  });
});

test.describe('Connect your CI', { tag: [TAG.area('admin'), TAG.area('ci-evidence')] }, () => {
  test('CI-01 steps per CI tool with the endpoint and team, the test call, data received and the calculated evidence', { tag: [TAG.smoke, TAG.role('admin')] }, async ({ freshCompany, signInAs, page, request }) => {
    await signInAs(freshCompany, '/admin-panel');
    const ci = page.getByTestId('connect-ci');
    await expect(ci).toBeVisible();
    await expect(ci.getByTestId('connect-ci-endpoints')).toContainText('/api/ingest/tests');
    const code = ci.getByTestId('connect-ci-snippet');
    await expect(code).toContainText('secrets.QE_NAVIGATOR_API_KEY');
    await expect(code).toContainText(`team=${freshCompany.teamId}`);
    await ci.getByRole('tablist', { name: 'CI tool' }).getByRole('tab', { name: 'GitLab CI' }).click();
    await expect(code).toContainText('stage: .post');
    await ci.getByRole('tablist', { name: 'CI tool' }).getByRole('tab', { name: 'GitLab CI' }).press('ArrowRight');
    await expect(ci.getByRole('tablist', { name: 'CI tool' }).getByRole('tab', { name: 'Jenkins' })).toHaveAttribute('aria-selected', 'true');
    await expect(code).toContainText("credentialsId: 'qe-navigator-api-key'");
    await ci.getByRole('tablist', { name: 'CI tool' }).getByRole('tab', { name: 'Azure DevOps' }).click();
    await expect(code).toContainText('$(System.JobAttempt)');

    const row = ci.getByTestId('connect-ci-row').filter({ hasText: freshCompany.teamName });
    await expect(row).toContainText('none yet');

    // A key, then the test call: valid, nothing stored.
    await page.getByPlaceholder('Key name, e.g. Jenkins production').fill('CI evidence key');
    await page.getByRole('button', { name: 'Create key' }).click();
    const key = (await page.getByTestId('api-key-created').locator('code').innerText()).trim();
    await page.getByRole('button', { name: 'Done' }).click();
    await ci.getByLabel('API key').fill('igk_wrong');
    await ci.getByRole('button', { name: 'Send test call' }).click();
    await expect(ci.getByTestId('connect-ci-test-result')).toContainText('The key was refused');
    await ci.getByLabel('API key').fill(key);
    await ci.getByRole('button', { name: 'Send test call' }).click();
    await expect(ci.getByTestId('connect-ci-test-result')).toContainText('Connected. The key is valid');
    await expect(row).toContainText('none yet');

    // Real data: a JUnit report; the row shows it and the team page shows the calculated pass rate.
    const sent = await request.post(`${API_URL}/ingest/tests?team=${freshCompany.teamId}&commit=abc&branch=main&run=1`, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/xml' }, data: JUNIT,
    });
    expect(sent.status(), await sent.text()).toBe(201);
    await page.reload();
    await expect(page.getByTestId('connect-ci-row').filter({ hasText: freshCompany.teamName })).toContainText('junit');

    // Main branch
    await page.getByLabel(`Main branch of ${freshCompany.teamName}`).fill('develop');
    await page.getByTestId('connect-ci-row').filter({ hasText: freshCompany.teamName }).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('connect-ci-row').filter({ hasText: freshCompany.teamName })).toContainText('Saved');
    await page.getByLabel(`Main branch of ${freshCompany.teamName}`).fill('');
    await page.getByTestId('connect-ci-row').filter({ hasText: freshCompany.teamName }).getByRole('button', { name: 'Save' }).click();

    await page.goto('/');
    await openTeam(page, freshCompany.teamName);
    await page.getByTestId('ci-metric-pass_rate').click();
    await expect(page.getByRole('dialog').getByTestId('how-calculated-value')).toHaveText('50.0 %');
    await expect(page.getByRole('dialog')).toContainText('Shown here only (no KPI column)');
    await page.keyboard.press('Escape');
    // A metric with a KPI column: the card offers the calculation, written as source "computed".
    await expect(page.getByTestId('kpi-source-first_time_pass_rate')).toContainText('Calculated from CI data');
    await page.getByTestId('how-calculated-first_time_pass_rate').click();
    await expect(page.getByRole('dialog')).toContainText('Written to the team’s KPI as source “computed”');
  });

  test('CI-02 a manager has no Connect your CI', { tag: [TAG.role('manager'), TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('manager', '/admin-panel');
    await expect(page.getByTestId('admin-panel')).toBeVisible();
    await expect(page.getByTestId('connect-ci')).toHaveCount(0);
  });
});
