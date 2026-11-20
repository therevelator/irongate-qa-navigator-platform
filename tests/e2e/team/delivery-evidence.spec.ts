import { test, expect, TAG } from '../support/fixtures';
import { DEMO } from '../support/roles';
import { API_URL } from '../support/env';
import { checkA11y } from '../support/a11y';
import type { Page } from '@playwright/test';

/**
 * v2 phase 2 in the app: the team page's "Deliveries & incidents" (DORA tiles calculated from the
 * sample deployments, commits and incidents of the demo teams, recent production deploys with commit
 * count, lead time and result, failed changes with what made them failed, incidents with duration and
 * linked deploy), "How this was calculated" from a DORA tile and from a KPI card, and Admin console →
 * Connect your CI (deployment and incident steps per tool, the service → team mapping, the test call
 * per endpoint, real events turning into calculated values). Accessibility in the four themes.
 */

async function openTeam(page: Page, name: string) {
  await page.getByLabel('Search teams').fill(name);
  await page.getByTestId('team-card').filter({ hasText: name }).first().click();
  await expect(page.getByTestId('team-detail')).toBeVisible();
}

test.describe('Deliveries & incidents', { tag: [TAG.area('team'), TAG.area('ci-evidence')] }, () => {
  test('DLV-01 the team page shows DORA values, recent production deploys, failed changes and incidents from the sample events', { tag: [TAG.smoke, TAG.role('admin')] }, async ({ signInAs, page }) => {
    await signInAs('admin');
    await openTeam(page, DEMO.leadTeam.name);
    const d = page.getByTestId('delivery-evidence');
    await expect(d.getByRole('heading', { name: 'Deliveries & incidents' })).toBeVisible();
    const tiles = d.getByTestId('delivery-metrics');
    await expect(tiles).toBeVisible();
    await expect(d.getByTestId('delivery-metric-deployment_frequency')).toContainText(/per week/);
    await expect(d.getByTestId('delivery-metric-lead_time')).toContainText(/(h|min|days)\b/);
    await expect(d.getByTestId('delivery-metric-change_failure_rate')).toContainText('%');
    await expect(d.getByTestId('delivery-metric-availability')).toContainText('%');
    await expect(d).toContainText('sample data');
    const rows = d.getByTestId('delivery-deploy');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThanOrEqual(8);
    await expect(rows.first()).toContainText(/Succeeded|Failed change|Rolled back/);
    const toggle = d.getByTestId('delivery-deploys-toggle');
    if (await toggle.count()) {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(await rows.count()).toBeGreaterThan(8);
    }
    const failed = d.getByTestId('delivery-failed-change');
    if (await failed.count()) await expect(failed.first()).toContainText(/Rolled back|Hotfix .* followed|Incident .* linked/);
    const incident = d.getByTestId('delivery-incident').first();
    await expect(incident).toBeVisible();
    await expect(incident).toContainText(/resolved after|open for/);
    await expect(d.getByTestId('delivery-last-received')).toContainText('Deployments:');
    // The CI part of the evidence keeps its own values.
    await expect(page.getByTestId('ci-computed-metrics')).not.toContainText('Change failure rate');
  });

  test('DLV-02 How this was calculated: from a DORA tile and from the KPI card, with the formula, values and the deploys / incidents counted', { tag: [TAG.role('admin'), TAG.a11y] }, async ({ signInAs, page }, testInfo) => {
    await signInAs('admin');
    await openTeam(page, DEMO.leadTeam.name);
    await page.getByTestId('delivery-metric-change_failure_rate').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('How this was calculated: Change failure rate');
    await expect(dialog.getByTestId('how-calculated-formula')).toContainText('rolled back, followed within 72 h by a hotfix');
    await expect(dialog.getByTestId('how-calculated-inputs')).toContainText('Production deploys');
    await expect(dialog.getByTestId('how-calculated-deployment').first()).toContainText('Deploy rel-');
    await expect(dialog).toContainText(/Based on \d+ deploys?/);
    await expect(dialog).toContainText('sample CI data');
    await checkA11y(page, testInfo, { include: '[role="dialog"]' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.getByTestId('delivery-metric-mttr').click();
    await expect(page.getByRole('dialog').getByTestId('how-calculated-incident').first()).toContainText('Incident INC-');
    await page.getByRole('button', { name: 'Close' }).click();
    // The KPI card of the same metric offers the calculation too.
    await page.getByTestId('how-calculated-deployment_frequency_per_week').click();
    await expect(page.getByRole('dialog')).toContainText('How this was calculated: Deployment frequency');
    await expect(page.getByRole('dialog').getByTestId('how-calculated-value')).toContainText('per week');
    await page.keyboard.press('Escape');
    await checkA11y(page, testInfo, { include: '[data-testid="delivery-evidence"]' });
  });

  test('DLV-03 an engineer sees the deliveries of their own team; another team is refused by the API; service mappings are for super admins', { tag: [TAG.role('engineer'), TAG.negative] }, async ({ signInAs, page }) => {
    await signInAs('engineer');
    await openTeam(page, DEMO.engineerTeam.name);
    await expect(page.getByTestId('delivery-evidence')).toBeVisible();
    expect((await page.request.get(`${API_URL}/ci/teams/${DEMO.otherTeam.id}/delivery`)).status()).toBe(403);
    expect((await page.request.get(`${API_URL}/ci/services`)).status()).toBe(403);
    expect((await page.request.put(`${API_URL}/ci/services`, { data: { service: 'x', teamId: DEMO.engineerTeam.id } })).status()).toBe(403);
  });

  test('DLV-04 a team without deployments or incidents says so and points the admin to Connect your CI', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany);
    await openTeam(page, freshCompany.teamName);
    await expect(page.getByTestId('ci-evidence')).toContainText('No CI data for this team yet');
    await expect(page.getByTestId('delivery-evidence')).toHaveCount(0);
  });
});

test.describe('Connect your CI: deployments and incidents', { tag: [TAG.area('admin'), TAG.area('ci-evidence')] }, () => {
  test('CI-03 deployment and incident steps per tool, the service mapping, the test call, and real events calculated on the team page', { tag: [TAG.smoke, TAG.role('admin')] }, async ({ freshCompany, signInAs, page, request }) => {
    await signInAs(freshCompany, '/admin-panel');
    const ci = page.getByTestId('connect-ci');
    await expect(ci.getByTestId('connect-ci-endpoints')).toContainText('/api/ingest/deployments');
    await expect(ci.getByTestId('connect-ci-endpoints')).toContainText('/api/ingest/incidents');
    const del = ci.getByTestId('connect-ci-delivery');
    const deploy = del.getByTestId('connect-ci-deploy-snippet');
    await expect(deploy).toContainText(`/ingest/deployments?team=${freshCompany.teamId}`);
    await expect(deploy).toContainText(`/ingest/commits?team=${freshCompany.teamId}`);
    await expect(deploy).toContainText('job.status');
    await del.getByRole('tab', { name: 'GitLab CI' }).click();
    await expect(deploy).toContainText('CI_JOB_STATUS');
    await del.getByRole('tab', { name: 'GitLab CI' }).press('ArrowRight');
    await expect(del.getByRole('tab', { name: 'Jenkins' })).toHaveAttribute('aria-selected', 'true');
    await expect(deploy).toContainText('GIT_PREVIOUS_SUCCESSFUL_COMMIT');
    await del.getByRole('tab', { name: 'Azure DevOps' }).click();
    await expect(deploy).toContainText('Agent.JobStatus');
    const inc = del.getByTestId('connect-ci-incident-snippet');
    await expect(inc).toContainText('Generic Webhooks (v3)');
    await expect(inc).toContainText(`/ingest/incidents?team=${freshCompany.teamId}`);
    await del.getByRole('tab', { name: 'Opsgenie' }).click();
    await expect(inc).toContainText('GenieKey');
    await del.getByRole('tab', { name: 'Other tool (JSON)' }).click();
    await expect(inc).toContainText('"status":"resolved"');

    // Service → team mapping
    const svc = del.getByTestId('connect-ci-services');
    await expect(svc.getByTestId('connect-ci-no-mappings')).toBeVisible();
    await svc.getByTestId('connect-ci-service-name').fill('checkout-api');
    await svc.getByRole('button', { name: 'Map service' }).click();
    await expect(svc.getByTestId('connect-ci-services-result')).toContainText(`Events of service “checkout-api” without a team now go to ${freshCompany.teamName}`);
    await expect(svc.getByTestId('connect-ci-service-mapping')).toContainText('checkout-api');

    // A key, then the test call for deployments: valid, nothing stored.
    await page.getByPlaceholder('Key name, e.g. Jenkins production').fill('Delivery key');
    await page.getByRole('button', { name: 'Create key' }).click();
    const key = (await page.getByTestId('api-key-created').locator('code').innerText()).trim();
    await page.getByRole('button', { name: 'Done' }).click();
    await ci.getByTestId('connect-ci-test-kind').selectOption('deployments');
    await ci.getByLabel('API key').fill(key);
    await ci.getByRole('button', { name: 'Send test call' }).click();
    await expect(ci.getByTestId('connect-ci-test-result')).toContainText('the sample deployment was read');
    const row = ci.getByTestId('connect-ci-row').filter({ hasText: freshCompany.teamName });
    await expect(row).toContainText('none yet');

    // Real events, without a team: the mapping routes them; the team page shows the calculated values.
    const h = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
    const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    const d = await request.post(`${API_URL}/ingest/deployments`, { headers: auth, data: [
      { id: 'rel-1', environment: 'production', service: 'checkout-api', commit: 'aaaa1111', commits: [{ sha: 'aaaa1111', authoredAt: h(30), author: 'dev@fresh.example' }], finishedAt: h(6), result: 'success' },
      { id: 'rel-2', environment: 'production', service: 'checkout-api', commit: 'bbbb2222', finishedAt: h(4), result: 'success', hotfix: true },
    ] });
    expect(d.status(), await d.text()).toBe(201);
    const i = await request.post(`${API_URL}/ingest/incidents`, { headers: auth, data: { id: 'INC-1', title: 'Checkout errors', severity: 'SEV2', service: 'checkout-api', openedAt: h(5), resolvedAt: h(4.5), deploymentId: 'rel-1' } });
    expect(i.status(), await i.text()).toBe(201);
    await page.reload();
    await expect(page.getByTestId('connect-ci-row').filter({ hasText: freshCompany.teamName })).toContainText('json');
    await page.getByTestId('connect-ci-service-mapping').filter({ hasText: 'checkout-api' }).getByRole('button', { name: 'Remove the mapping of checkout-api' }).click();
    await expect(page.getByTestId('connect-ci-no-mappings')).toBeVisible();

    await page.goto('/');
    await openTeam(page, freshCompany.teamName);
    const dl = page.getByTestId('delivery-evidence');
    await expect(dl.getByTestId('delivery-metric-change_failure_rate')).toContainText('50.0 %');
    await expect(dl.getByTestId('delivery-failed-change')).toContainText('Hotfix rel-2 followed 2.0 h later');
    await expect(dl.getByTestId('delivery-failed-change')).toContainText('Incident INC-1 linked to it');
    await expect(dl.getByTestId('delivery-incident')).toContainText('resolved after 30 min');
    await expect(dl.getByTestId('delivery-incident-deploy')).toContainText('rel-1');
    await expect(page.getByTestId('kpi-source-change_failure_rate')).toContainText('computed');
    await page.getByTestId('how-calculated-change_failure_rate').click();
    await expect(page.getByRole('dialog')).toContainText('Written to the team’s KPI as source “computed”');
    await expect(page.getByRole('dialog').getByTestId('how-calculated-value')).toHaveText('50.0 %');
  });
});

test.describe('Deliveries & incidents accessibility', { tag: [TAG.a11y, TAG.area('ci-evidence')] }, () => {
  const cases = [
    { id: 'A11Y-38', theme: 'Light' },
    { id: 'A11Y-39', theme: 'Dark' },
    { id: 'A11Y-40', theme: 'Graphite' },
    { id: 'A11Y-41', theme: 'Porcelain' },
  ] as const;
  for (const c of cases) {
    test(`${c.id} ${c.theme} theme: Deliveries & incidents and Connect your CI have no serious violations`, async ({ signInAs, page, app }, testInfo) => {
      await signInAs('admin');
      await app.setTheme(c.theme);
      await openTeam(page, DEMO.leadTeam.name);
      await expect(page.getByTestId('delivery-metrics')).toBeVisible();
      await checkA11y(page, testInfo, { include: '[data-testid="delivery-evidence"]' });
      await page.goto('/admin-panel');
      await expect(page.getByTestId('connect-ci-delivery')).toBeVisible();
      await checkA11y(page, testInfo, { include: '[data-testid="connect-ci-delivery"]' });
      await page.evaluate(() => localStorage.removeItem('irongate_theme_mode'));
    });
  }
});
