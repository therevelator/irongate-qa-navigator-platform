import { test, expect } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

/**
 * Metric storage and ingestion quality in the UI: confidence next to every score, KPI targets with
 * history on the Parameters page, and the Ingestion log (super admins and QA managers only).
 */
test.describe('Confidence, KPI targets and the ingestion log', () => {
  test.setTimeout(90000);

  test('The dashboard and team detail say what the QA score is based on', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await expect(page.locator('[data-testid="global-qa-confidence"]')).toContainText(/Based on \d+ of \d+ teams/);
    const card = page.locator('[data-testid="team-card"]').first();
    await expect(card).toBeVisible({ timeout: 15000 });
    await card.click();
    await expect(page.locator('[data-testid="team-detail"]')).toBeVisible();
    const conf = page.locator('[data-testid="team-qa-confidence"]');
    if (await conf.count()) await expect(conf).toContainText(/Based on \d of 4 inputs/);
  });

  test('Parameters shows KPI targets with their history', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.goto('http://localhost:5173/parameters-config');
    await expect(page.locator('[data-testid="kpi-targets"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="kpi-target-test_coverage"]')).toBeVisible();
  });

  test('Ingestion log is in the navigation for super admins and QA managers only', async ({ page }) => {
    await setupAuth(page, 'qa_manager');
    await page.click('[data-testid="nav-toggle"]');
    await expect(page.locator('[data-testid="nav-ingestion-log"]')).toBeVisible();
    await page.click('[data-testid="nav-ingestion-log"]');
    await expect(page.locator('[data-testid="ingestion-log"]')).toBeVisible();
  });

  test('An engineer has no Ingestion log', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');
    await page.click('[data-testid="nav-toggle"]');
    await expect(page.locator('[data-testid="nav-ingestion-log"]')).toHaveCount(0);
    await page.goto('http://localhost:5173/ingestion-log');
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 30000 });
    expect(new URL(page.url()).pathname).toBe('/');
  });
});
