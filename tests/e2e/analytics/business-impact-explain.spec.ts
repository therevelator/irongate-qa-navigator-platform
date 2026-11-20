import { test, expect, TAG } from '../support/fixtures';
import { checkA11y } from '../support/a11y';
import { API_URL } from '../support/env';
import { DEMO } from '../support/roles';
import type { Page } from '@playwright/test';

/**
 * Business impact is fully populated and explained (src/components/BusinessImpactAnalysisV2.tsx,
 * BusinessImpactHowItWorks.tsx, RevenueImpact.tsx): every section of every tab has content (no
 * "—", no empty state), "How this works" opens with the method actually used, every tile on
 * Details opens "How this was calculated", and the summary is there without an AI provider (the
 * UI test servers run without one). The demo company's teams are filled by the same generator as
 * Meridian (Populate metrics); BIZ-05 checks the Meridian showcase company when it is loaded.
 */

const EMPTY = /No gain can be shown yet|Nothing to rank yet|No correlations calculated|Not enough months yet|Revenue impact not available|No summary generated yet|Roll-up not available|NaN|undefined/;

async function expectFullyPopulated(page: Page, opts: { rollup: boolean }) {
  // Money
  const money = page.getByTestId('revenue-money');
  await expect(money).toBeVisible({ timeout: 20000 });
  for (const key of ['quality_gaps', 'debt', 'downtime', 'support', 'churn']) {
    await expect(page.getByTestId(`going-now-${key}`).locator('p').first()).toHaveText(/^\$[\d.]+[kM]?\/month$/);
  }
  expect(await page.getByTestId('money-gains').locator('> li').count()).toBeGreaterThan(0);
  expect(await page.getByTestId('money-priorities').locator('> li').count()).toBeGreaterThan(0);
  await expect(money).not.toContainText(EMPTY);
  // What-if: the preselected metric projects (team or company-wide link).
  await page.getByRole('button', { name: 'What-if', exact: true }).click();
  await expect(page.getByTestId('whatif-result')).toContainText('associated with this change in monthly revenue');
  await expect(page.getByTestId('whatif-amount')).toContainText(/\$[\d.]+[kM]?\/month/);
  // Details: every section opened has content.
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  const details = page.getByTestId('business-details');
  await expect(details).toBeVisible();
  await details.evaluate((el) => el.querySelectorAll(':scope > details').forEach((d) => ((d as HTMLDetailsElement).open = true)));
  await expect(page.getByTestId('revenue-sensitivity-table')).toBeVisible();
  await expect(details.getByText('Not significant', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('details-tiles')).not.toContainText('—');
  await expect(page.getByTestId('bi-summary')).toContainText('In short');
  await expect(details).not.toContainText(EMPTY);
  if (opts.rollup) {
    await page.getByRole('button', { name: 'All teams', exact: true }).click();
    const roll = page.getByTestId('revenue-rollup');
    await expect(roll.getByText('Teams with a figure')).toBeVisible();
    await expect(roll).not.toContainText(EMPTY);
    await expect(roll.locator('tbody td:nth-child(2)').filter({ hasText: /^—$/ })).toHaveCount(0);
  }
}

test.describe('Business impact: populated and explained', { tag: [TAG.area('business-impact')] }, () => {
  test.setTimeout(120000);

  test('BIZ-03 super admin: every tab of a filled team has content, the summary works without an AI provider', async ({ signInAs, page }) => {
    await signInAs('admin', `/analytics/business-impact?team=${DEMO.leadTeam.id}`);
    await expectFullyPopulated(page, { rollup: true });
    // "Generate AI summary" without a provider: the rule-based summary stays (no error, no empty box).
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await page.getByTestId('business-details').evaluate((el) => el.querySelectorAll(':scope > details').forEach((d) => ((d as HTMLDetailsElement).open = true)));
    await page.getByRole('button', { name: 'Generate AI summary' }).click();
    await expect(page.getByTestId('bi-summary')).toContainText('Rule-based summary');
    await expect(page.getByTestId('bi-summary')).toContainText('What this does not say');
  });

  test('BIZ-04 "How this works" opens with the method used; Details tiles open "How this was calculated"', async ({ signInAs, page }) => {
    await signInAs('engineer', '/analytics/business-impact');
    const how = page.getByTestId('bi-how-it-works');
    await expect(how).toBeVisible({ timeout: 20000 });
    expect(await how.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    await how.locator('summary').click();
    const body = page.getByTestId('bi-how-it-works-body');
    await expect(body).toBeVisible();
    for (const text of ['Benjamini–Hochberg', 'q < 0.05', 'same month (no lag)', 'Financial and ROI settings', 'Company-wide evidence', 'correlation is not causation']) {
      await expect(body).toContainText(text);
    }
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await page.getByText('Monthly trends', { exact: true }).click();
    const tiles = page.getByTestId('details-tiles');
    await expect(tiles.getByText('How this was calculated')).toHaveCount(4);
    await tiles.getByText('How this was calculated').nth(1).click();
    await expect(tiles).toContainText('Benjamini–Hochberg: q = p × pairs ÷ rank');
  });

  test('BIZ-05 Meridian (when the showcase company is loaded): every team is fully populated for the CTO', async ({ signInAs, page, request }) => {
    const creds = { email: 'eleanor.vance@meridian-fintech.example', password: process.env.UI_MERIDIAN_PASSWORD || 'Demo-Pass-2026!' };
    const probe = await request.post(`${API_URL}/auth/login`, { data: creds });
    test.skip(probe.status() !== 200, 'Meridian showcase company not loaded in this database');
    for (const team of ['mft-team-payments-core-116', 'mft-team-lending-journey-64', 'mft-team-mobile-experience-140']) {
      await signInAs(creds, `/analytics/business-impact?team=${team}`);
      await expectFullyPopulated(page, { rollup: team === 'mft-team-payments-core-116' });
    }
  });
});

test.describe('Business impact accessibility', { tag: [TAG.a11y, TAG.area('business-impact')] }, () => {
  const cases = [
    { id: 'A11Y-54', theme: 'Light' },
    { id: 'A11Y-55', theme: 'Dark' },
    { id: 'A11Y-56', theme: 'Graphite' },
    { id: 'A11Y-57', theme: 'Porcelain' },
  ] as const;
  for (const c of cases) {
    test(`${c.id} ${c.theme} theme: Business impact with "How this works" and every Details section open has no serious violations`, async ({ signInAs, page, app }, testInfo) => {
      await signInAs('admin', `/analytics/business-impact?team=${DEMO.leadTeam.id}`);
      await app.setTheme(c.theme);
      await expect(page.getByTestId('revenue-money')).toBeVisible({ timeout: 20000 });
      await page.getByTestId('bi-how-it-works').locator('summary').click();
      await page.evaluate(() => document.querySelectorAll('[data-testid="revenue-money"] details').forEach((d) => ((d as HTMLDetailsElement).open = true)));
      await checkA11y(page, testInfo, { known: [] });
      await page.getByRole('button', { name: 'Details', exact: true }).click();
      await page.evaluate(() => document.querySelectorAll('[data-testid="business-details"] details').forEach((d) => ((d as HTMLDetailsElement).open = true)));
      await expect(page.getByTestId('bi-summary')).toBeVisible();
      await checkA11y(page, testInfo, { known: [] });
      await page.evaluate(() => localStorage.removeItem('irongate_theme_mode'));
    });
  }
});
