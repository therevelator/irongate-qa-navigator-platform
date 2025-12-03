import { test, expect } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

test.describe('Viewer Role-Based Access Control', () => {
  test.setTimeout(60000);

  test('Viewer has minimal access to features', async ({ page }) => {
    await setupAuth(page, 'viewer');

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

  test('Viewer can view dashboard with all teams and departments', async ({ page }) => {
    await setupAuth(page, 'viewer');

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

    // Count teams to verify viewer can see all teams
    const teamCount = await teamCards.count();
    expect(teamCount).toBeGreaterThan(0);
  });

  test('Viewer can click into team detail views', async ({ page }) => {
    await setupAuth(page, 'viewer');

    // Go to dashboard
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Click on a team
    await page.locator('[data-testid="team-card"]').first().click();
    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // Should see team detail page
    await expect(page.locator('[data-testid="team-detail"]')).toBeVisible();

    // Should see team KPIs and metrics
    await expect(page.locator('[data-testid="team-kpis"]')).toBeVisible();
  });

  test('Viewer cannot see AI insights or developer insights', async ({ page }) => {
    await setupAuth(page, 'viewer');

    // Go to dashboard and click on a team
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });
    await page.locator('[data-testid="team-card"]').first().click();

    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // Viewer should NOT see AI Insights or Developer Insights sections
    await expect(page.locator('text=AI Insights')).not.toBeVisible();
    await expect(page.locator('text=Developer Insights')).not.toBeVisible();
    await expect(page.locator('text=Team Members')).not.toBeVisible();

    // Should still see basic team information
    await expect(page.locator('[data-testid="team-kpis"]')).toBeVisible();
  });

  test('Viewer can navigate between multiple teams', async ({ page }) => {
    await setupAuth(page, 'viewer');

    // Go to dashboard
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Click on first team
    const teamCards = page.locator('[data-testid="team-card"]');
    await teamCards.first().click();
    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // Verify team detail loaded
    await expect(page.locator('[data-testid="team-detail"]')).toBeVisible();

    // Go back to dashboard
    await page.click('[data-testid="back-to-dashboard"]');
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });

    // Click on another team
    await teamCards.nth(1).click();
    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // Should be able to view this team too
    await expect(page.locator('[data-testid="team-detail"]')).toBeVisible();
  });

  test('Viewer cannot access any admin or management pages', async ({ page }) => {
    await setupAuth(page, 'viewer');

    // Try to access restricted pages directly - should be redirected or show access denied
    const restrictedUrls = [
      '/users', '/teams', '/departments', '/features', '/admin-panel',
      '/manual-metrics', '/metric-intervals', '/parameters-config'
    ];

    for (const url of restrictedUrls) {
      await page.goto(url);
      await page.waitForTimeout(2000); // Wait for potential redirect

      // Should either be redirected to dashboard or show access denied
      const currentUrl = page.url();
      const isRedirected = !currentUrl.includes(url) || currentUrl.includes('/dashboard');
      const hasAccessDenied = await page.locator('text=Access denied').isVisible().catch(() => false);
      const hasLoginPage = await page.locator('text=Login').isVisible().catch(() => false);

      expect(isRedirected || hasAccessDenied || hasLoginPage).toBe(true);
    }
  });

  test('Viewer cannot perform any write operations', async ({ page }) => {
    await setupAuth(page, 'viewer');

    // Go to dashboard
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Should not see any buttons for creating, editing, or deleting
    await expect(page.locator('[data-testid="add-user-btn"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="add-team-btn"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="edit-btn"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="delete-btn"]')).not.toBeVisible();

    // In team detail view, should not see any action buttons
    await page.locator('[data-testid="team-card"]').first().click();
    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    await expect(page.locator('[data-testid="edit-team-btn"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="delete-team-btn"]')).not.toBeVisible();
  });
});
