import { test, expect } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

test.describe('Super Admin Role-Based Access Control', () => {
  test.setTimeout(60000);

  test('Super Admin has full access to all features', async ({ page }) => {
    await setupAuth(page, 'super_admin');

    // Wait for dashboard to load
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Check navigation menu - all items should be visible
    await expect(page.locator('text=Dashboard')).toBeVisible();
    await expect(page.locator('text=Users')).toBeVisible();
    await expect(page.locator('text=Teams')).toBeVisible();
    await expect(page.locator('text=Departments')).toBeVisible();
    await expect(page.locator('text=Analytics')).toBeVisible();
    await expect(page.locator('text=Admin')).toBeVisible();
    await expect(page.locator('text=Manual Metrics')).toBeVisible();
    await expect(page.locator('text=Metric Intervals')).toBeVisible();
    await expect(page.locator('text=Parameters Config')).toBeVisible();

    // Check dashboard shows all teams and departments
    const teamCards = page.locator('[data-testid="team-card"]');
    await expect(teamCards.first()).toBeVisible();

    // Click into a team detail view
    await teamCards.first().click();
    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // Super Admin should see all sections: team members, AI insights, developer insights
    await expect(page.locator('text=Team Members')).toBeVisible();
    await expect(page.locator('text=AI Insights')).toBeVisible();
    await expect(page.locator('text=Developer Insights')).toBeVisible();

    // Check admin panel access
    await page.goto('/admin-panel');
    await expect(page.locator('text=User Management')).toBeVisible();
    await expect(page.locator('text=Team Management')).toBeVisible();
    await expect(page.locator('text=Department Management')).toBeVisible();
  });

  test('Super Admin can create and manage all user roles', async ({ page }) => {
    await setupAuth(page, 'super_admin');

    // Go to users page
    await page.goto('/users');
    await page.waitForSelector('[data-testid="users-page"]', { timeout: 10000 });

    // Click add user
    await page.click('[data-testid="add-user-btn"]');

    // Fill user creation form
    await page.fill('[data-testid="first-name-input"]', 'Test');
    await page.fill('[data-testid="last-name-input"]', 'User');
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'password123');

    // Select role - Super Admin should be able to create any role
    await page.selectOption('[data-testid="role-select"]', 'qa_engineer');

    // Select department and team
    await page.selectOption('[data-testid="department-select"]', 'Engineering');
    await page.selectOption('[data-testid="team-select"]', 'Frontend Team');

    // Submit form
    await page.click('[data-testid="create-user-btn"]');

    // Verify success message
    await expect(page.locator('text=User created successfully')).toBeVisible();
  });

  test('Super Admin can access all analytics features', async ({ page }) => {
    await setupAuth(page, 'super_admin');

    // Go to analytics/features page
    await page.goto('/features');
    await page.waitForSelector('[data-testid="analytics-page"]', { timeout: 10000 });

    // Should see all analytics sections
    await expect(page.locator('text=Flaky Test Intelligence')).toBeVisible();
    await expect(page.locator('text=Technical Debt Tracker')).toBeVisible();
    await expect(page.locator('text=Pipeline Visualization')).toBeVisible();
    await expect(page.locator('text=Business Impact Analysis')).toBeVisible();
    await expect(page.locator('text=Performance Testing')).toBeVisible();
    await expect(page.locator('text=Developer Productivity')).toBeVisible();
  });
});
