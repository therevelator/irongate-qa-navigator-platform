import { test, expect } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

test.describe('QA Manager Role-Based Access Control', () => {
  test.setTimeout(60000);

  test('QA Manager has access to department-level features', async ({ page }) => {
    await setupAuth(page, 'qa_manager');

    // Wait for dashboard to load
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Check navigation menu - should see Users, Teams, Analytics, Admin, Metric Intervals, Parameters Config
    // Should NOT see Departments, Manual Metrics
    await expect(page.locator('text=Dashboard')).toBeVisible();
    await expect(page.locator('text=Users')).toBeVisible();
    await expect(page.locator('text=Teams')).toBeVisible();
    await expect(page.locator('text=Analytics')).toBeVisible();
    await expect(page.locator('text=Admin')).toBeVisible();
    await expect(page.locator('text=Metric Intervals')).toBeVisible();
    await expect(page.locator('text=Parameters Config')).toBeVisible();

    // Should NOT see these restricted items
    await expect(page.locator('text=Departments')).not.toBeVisible();
    await expect(page.locator('text=Manual Metrics')).not.toBeVisible();
  });

  test('QA Manager can manage users and teams in their department', async ({ page }) => {
    await setupAuth(page, 'qa_manager');

    // Go to users page
    await page.goto('/users');
    await page.waitForSelector('[data-testid="users-page"]', { timeout: 10000 });

    // Should see users in their department
    const userRows = page.locator('[data-testid="user-row"]');
    await expect(userRows.first()).toBeVisible();

    // Go to teams page
    await page.goto('/teams');
    await page.waitForSelector('[data-testid="teams-page"]', { timeout: 10000 });

    // Should be able to create teams
    await page.click('[data-testid="add-team-btn"]');
    await page.fill('[data-testid="team-name-input"]', 'QA Manager Test Team');
    await page.fill('[data-testid="team-description-input"]', 'Test team created by QA Manager');
    await page.click('[data-testid="create-team-btn"]');

    // Verify team creation
    await expect(page.locator('text=QA Manager Test Team')).toBeVisible();
  });

  test('QA Manager can see team details with full insights', async ({ page }) => {
    await setupAuth(page, 'qa_manager');

    // Go to dashboard and click on a team
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });
    await page.locator('[data-testid="team-card"]').first().click();

    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // QA Manager should see all sections: team members, AI insights, developer insights
    await expect(page.locator('text=Team Members')).toBeVisible();
    await expect(page.locator('text=AI Insights')).toBeVisible();
    await expect(page.locator('text=Developer Insights')).toBeVisible();
  });

  test('QA Manager can access admin panel', async ({ page }) => {
    await setupAuth(page, 'qa_manager');

    await page.goto('/admin-panel');
    await expect(page.locator('text=User Management')).toBeVisible();
    await expect(page.locator('text=Team Management')).toBeVisible();

    // Should NOT see department management (only super admin)
    await expect(page.locator('text=Department Management')).not.toBeVisible();
  });
});
