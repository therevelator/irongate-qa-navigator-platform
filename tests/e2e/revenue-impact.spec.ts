import { test, expect } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

/**
 * Business impact → Money (revenue impact): the plain-language money summary first, details one
 * click away, what-if, the all-teams roll-up for super admins / QA managers only, phone layout.
 */
const APP = 'http://localhost:5173';
const API = 'http://localhost:3000';
const MONEY = /^(—|−?\$\d+(\.\d)?k?|−?\$\d+(\.\d{1,2})?M)$/;

test.describe('Business impact: revenue impact', () => {
  test.setTimeout(90000);

  test('super admin: money summary first, explanations behind "How is this calculated?", what-if and all teams', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.goto(`${APP}/analytics/business-impact`);
    const money = page.locator('[data-testid="revenue-money"]');
    await expect(money).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Where the money is going now' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What you gain when these are fixed' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Where to put the money first' })).toBeVisible();
    // Five causes, each with a rounded $/month figure (or "—" with its reason).
    const going = page.locator('[data-testid="money-going-now"] > li');
    await expect(going).toHaveCount(5);
    for (const key of ['quality_gaps', 'debt', 'downtime', 'support', 'churn']) {
      const first = (await page.locator(`[data-testid="going-now-${key}"] p`).first().textContent())!.replace('/month', '').trim();
      expect(first).toMatch(MONEY);
    }
    // At most five gains before "Show all".
    expect(await page.locator('[data-testid="money-gains"] > li').count()).toBeLessThanOrEqual(5);
    // The explanation is collapsed, one click away.
    const how = going.first().getByText('How is this calculated?');
    await how.click();
    await expect(going.first().getByText(/Monthly revenue at stake = /)).toBeVisible();

    // What-if
    await page.getByRole('button', { name: 'What-if', exact: true }).click();
    await expect(page.locator('[data-testid="whatif-result"]')).toBeVisible();
    await page.fill('[data-testid="whatif-change"]', '2');
    await expect(page.locator('[data-testid="whatif-result"]')).toContainText(/associated with this change|No projection/);

    // Details: secondary sections, collapsed by default
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    const details = page.locator('[data-testid="business-details"] > details');
    expect(await details.count()).toBeGreaterThanOrEqual(3);
    for (const d of await details.all()) expect(await d.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    await page.getByText('How sure are we? Revenue per metric').click();
    await expect(page.locator('[data-testid="details-sensitivity"]')).toContainText(/\$ per month associated with \+1 unit|Not enough months yet/);

    // All teams (super admin)
    await page.getByRole('button', { name: 'All teams', exact: true }).click();
    await expect(page.locator('[data-testid="revenue-rollup"]')).toBeVisible();
    await expect(page.getByText('Teams with a figure')).toBeVisible();
    await expect(page.locator('[data-testid="revenue-rollup"] [data-testid="export-csv"]')).toBeVisible();
  });

  test('QA engineer: no roll-up tab and the roll-up API refuses; the money summary is shown for the own team', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');
    await page.goto(`${APP}/analytics/business-impact`);
    await expect(page.locator('[data-testid="revenue-money"]')).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'All teams', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Data entry', exact: true })).toHaveCount(0);
    expect((await page.request.get(`${API}/api/revenue-impact/rollup`)).status()).toBe(403);
  });

  test('phone width: the money summary fits without horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupAuth(page, 'qa_manager');
    await page.goto(`${APP}/analytics/business-impact`);
    await expect(page.locator('[data-testid="revenue-money"]')).toBeVisible({ timeout: 20000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
