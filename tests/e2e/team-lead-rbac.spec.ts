import { test, expect } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

test.describe('Team Lead Role-Based Access Control', () => {
  test.setTimeout(60000);

  test('Team Lead has limited admin access', async ({ page }) => {
    await setupAuth(page, 'team_lead');

    // Wait for dashboard to load
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Check navigation menu - should see Users, Teams, Analytics
    // Should NOT see Departments, Admin, Manual Metrics, Metric Intervals, Parameters Config
    await expect(page.locator('text=Dashboard')).toBeVisible();
    await expect(page.locator('text=Users')).toBeVisible();
    await expect(page.locator('text=Teams')).toBeVisible();
    await expect(page.locator('text=Analytics')).toBeVisible();

    // Should NOT see these restricted items
    await expect(page.locator('text=Departments')).not.toBeVisible();
    await expect(page.locator('text=Admin')).not.toBeVisible();
    await expect(page.locator('text=Manual Metrics')).not.toBeVisible();
    await expect(page.locator('text=Metric Intervals')).not.toBeVisible();
    await expect(page.locator('text=Parameters Config')).not.toBeVisible();
  });

  test('Team Lead can manage users in their department', async ({ page }) => {
    await setupAuth(page, 'team_lead');

    // Go to users page
    await page.goto('/users');
    await page.waitForSelector('[data-testid="users-page"]', { timeout: 10000 });

    // Should see users in their department
    const userRows = page.locator('[data-testid="user-row"]');
    await expect(userRows.first()).toBeVisible();

    // Should be able to create users
    await page.click('[data-testid="add-user-btn"]');

    // Fill user creation form
    await page.fill('[data-testid="first-name-input"]', 'Team Lead');
    await page.fill('[data-testid="last-name-input"]', 'Test User');
    await page.fill('[data-testid="email-input"]', 'teamleadtest@example.com');
    await page.fill('[data-testid="password-input"]', 'password123');

    // Select role - Team Lead should be able to create qa_engineer and viewer
    await page.selectOption('[data-testid="role-select"]', 'qa_engineer');

    // Select department and team
    await page.selectOption('[data-testid="department-select"]', 'Engineering');
    await page.selectOption('[data-testid="team-select"]', 'Frontend Team');

    // Submit form
    await page.click('[data-testid="create-user-btn"]');

    // Verify success message
    await expect(page.locator('text=User created successfully')).toBeVisible();
  });

  test('Team Lead can edit their own team but not create new teams', async ({ page }) => {
    await setupAuth(page, 'team_lead');

    // Go to teams page
    await page.goto('/teams');
    await page.waitForSelector('[data-testid="teams-page"]', { timeout: 10000 });

    // Should see teams but NOT have add team button (cannot create teams)
    await expect(page.locator('[data-testid="add-team-btn"]')).not.toBeVisible();

    // Should be able to edit existing teams (assuming they have permission for their own team)
    const editButtons = page.locator('[data-testid="edit-team-btn"]');
    if (await editButtons.count() > 0) {
      await editButtons.first().click();
      await expect(page.locator('[data-testid="team-edit-modal"]')).toBeVisible();
    }
  });

  test('Team Lead can see team details with full insights', async ({ page }) => {
    await setupAuth(page, 'team_lead');

    // Go to dashboard and click on a team
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });
    await page.locator('[data-testid="team-card"]').first().click();

    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // Team Lead should see all sections: team members, AI insights, developer insights
    await expect(page.locator('text=Team Members')).toBeVisible();
    await expect(page.locator('text=AI Insights')).toBeVisible();
    await expect(page.locator('text=Developer Insights')).toBeVisible();
  });
});
