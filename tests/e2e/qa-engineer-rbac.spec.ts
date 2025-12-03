import { test, expect } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

test.describe('QA Engineer Role-Based Access Control', () => {
  test.setTimeout(60000);

  test('QA Engineer has limited access to features', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');

    // Wait for dashboard to load
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Check navigation menu - should ONLY see Dashboard
    // Should NOT see Users, Teams, Departments, Analytics, Admin, Manual Metrics, etc.
    await expect(page.locator('text=Dashboard')).toBeVisible();

    // Should NOT see these restricted items
    await expect(page.locator('text=Users')).not.toBeVisible();
    await expect(page.locator('text=Teams')).not.toBeVisible();
    await expect(page.locator('text=Departments')).not.toBeVisible();
    await expect(page.locator('text=Analytics')).not.toBeVisible();
    await expect(page.locator('text=Admin')).not.toBeVisible();
    await expect(page.locator('text=Manual Metrics')).not.toBeVisible();
    await expect(page.locator('text=Metric Intervals')).not.toBeVisible();
    await expect(page.locator('text=Parameters Config')).not.toBeVisible();
  });

  test('QA Engineer can view dashboard with all teams and departments', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');

    // Wait for dashboard to load
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Should see all teams and departments on dashboard
    const teamCards = page.locator('[data-testid="team-card"]');
    await expect(teamCards.first()).toBeVisible();

    // Should be able to filter by departments
    const departmentFilters = page.locator('[data-testid="department-filter"]');
    if (await departmentFilters.count() > 0) {
      await expect(departmentFilters.first()).toBeVisible();
    }
  });

  test('QA Engineer cannot see team colleagues in team detail view', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');

    // Go to dashboard and click on a team
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });
    await page.locator('[data-testid="team-card"]').first().click();

    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // QA Engineer should NOT see team members section
    await expect(page.locator('text=Team Members')).not.toBeVisible();

    // Should still see team KPIs and metrics
    await expect(page.locator('[data-testid="team-kpis"]')).toBeVisible();
  });

  test('QA Engineer cannot see AI insights or developer insights', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');

    // Go to dashboard and click on a team
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });
    await page.locator('[data-testid="team-card"]').first().click();

    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // QA Engineer should NOT see AI Insights or Developer Insights sections
    await expect(page.locator('text=AI Insights')).not.toBeVisible();
    await expect(page.locator('text=Developer Insights')).not.toBeVisible();

    // Should see team KPIs and metrics
    await expect(page.locator('[data-testid="team-kpis"]')).toBeVisible();
  });

  test('QA Engineer can view other teams but without developer information', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');

    // Go to dashboard
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Click on multiple teams to verify access
    const teamCards = page.locator('[data-testid="team-card"]');
    const teamCount = await teamCards.count();

    for (let i = 0; i < Math.min(3, teamCount); i++) {
      await teamCards.nth(i).click();
      await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

      // Should see team detail but without restricted sections
      await expect(page.locator('[data-testid="team-kpis"]')).toBeVisible();
      await expect(page.locator('text=Team Members')).not.toBeVisible();
      await expect(page.locator('text=AI Insights')).not.toBeVisible();
      await expect(page.locator('text=Developer Insights')).not.toBeVisible();

      // Go back to dashboard
      await page.click('[data-testid="back-to-dashboard"]');
      await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });
    }
  });

  test('QA Engineer cannot access restricted pages directly', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');

    // Try to access restricted pages directly - should be redirected or show access denied
    const restrictedUrls = ['/users', '/teams', '/departments', '/features', '/admin-panel'];

    for (const url of restrictedUrls) {
      await page.goto(url);
      await page.waitForTimeout(2000); // Wait for potential redirect

      // Should either be redirected to dashboard or show access denied
      const currentUrl = page.url();
      const isRedirected = !currentUrl.includes(url) || currentUrl.includes('/dashboard');
      const hasAccessDenied = await page.locator('text=Access denied').isVisible().catch(() => false);

      expect(isRedirected || hasAccessDenied).toBe(true);
    }
  });
});
