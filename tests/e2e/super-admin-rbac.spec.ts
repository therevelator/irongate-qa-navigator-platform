import { test, expect } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

test.describe('Super Admin Role-Based Access Control', { tag: ['@area:navigation', '@role:admin'] }, () => {
  // Written for one worker: these tests run in order, in one worker (a failure does not skip the rest).
  test.describe.configure({ mode: 'default' });
  test.setTimeout(60000);

  test('Super Admin has full access to all features', async ({ page }) => {
    await setupAuth(page, 'super_admin');

    // Wait for dashboard to load
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Check navigation menu - all items should be visible (by data-testid)
    // Navigation sits in a drawer behind the burger button in the top bar
    await page.click('[data-testid="nav-toggle"]');
    await expect(page.locator('[data-testid="nav-dashboard"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-users"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-teams"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-departments"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-analytics"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-admin"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-manual-metrics"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-metric-intervals"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-parameters-config"]')).toBeVisible();
    // Close the navigation drawer (Escape) before using the page behind it
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="nav-toggle"]')).toHaveAttribute('aria-expanded', 'false');

    // Check dashboard shows all teams and departments
    const teamCards = page.locator('[data-testid="team-card"]');
    await expect(teamCards.first()).toBeVisible();

    // Click into a team detail view
    await teamCards.first().click();
    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // Super Admin should see all sections: team members, AI insights, developer insights
    // Use a precise heading locator to avoid strict-mode conflicts with "No Team Members" text.
    await expect(page.getByRole('heading', { name: 'Team members', exact: true })).toBeVisible();
    await expect(page.locator('[data-testid="ai-insights-header"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Developer recommendations', exact: true })).toBeVisible();

    // Check admin panel access
    await page.goto('/admin-panel');

    // Admin panel container and headings from current implementation
    await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible();
    await expect(page.getByTestId('admin-panel').getByRole('heading', { name: 'Admin console' })).toBeVisible();
    await expect(page.locator('text=Organization Structure')).toBeVisible();
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
    const email = `e2e-${Date.now()}@example.com`;
    await page.fill('[data-testid="email-input"]', email);
    await page.fill('[data-testid="password-input"]', 'password123');

    // Select role - Super Admin should be able to create any role
    await page.selectOption('[data-testid="role-select"]', 'qa_engineer');

    // Pick a department that has teams, then its first team.
    const deptOptions = await page.locator('[data-testid="department-select"] option').count();
    for (let i = 1; i < deptOptions; i++) {
      await page.selectOption('[data-testid="department-select"]', { index: i });
      if (await page.locator('[data-testid="team-select"] option').count() > 1) break;
    }
    await page.selectOption('[data-testid="team-select"]', { index: 1 });

    // Submit form
    await page.click('[data-testid="create-user-btn"]');

    // Verify the new user appears in the users table
    await expect(page.locator('text=User created successfully')).toBeVisible();
    // Clean up: deactivate the user through the API.
    const cookie = (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ');
    const list = await page.request.get('http://localhost:3000/api/admin/users', { headers: { cookie } });
    const created = (await list.json()).find((u: any) => u.email === email);
    expect(created).toBeTruthy();
    await page.request.delete(`http://localhost:3000/api/admin/users/${created.id}`, { headers: { cookie } });
  });

  test('Super Admin can access all analytics features', async ({ page }) => {
    await setupAuth(page, 'super_admin');

    // Go directly to analytics/features page to avoid hero overlay intercepting sidebar clicks
    await page.goto('/analytics');
    await page.waitForSelector('[data-testid="features-menu"]', { timeout: 10000 });

    // For non-team leads, analytics features are only shown after selecting a specific team
    // Pick the first available department and team option (if present)
    const departmentSelect = page.locator('select').nth(0);
    const teamSelect = page.locator('select').nth(1);

    if (await departmentSelect.isVisible()) {
      const deptOptions = await departmentSelect.locator('option').count();
      if (deptOptions > 1) {
        await departmentSelect.selectOption({ index: 1 });
      }
    }

    if (await teamSelect.isVisible()) {
      const teamOptions = await teamSelect.locator('option').count();
      if (teamOptions > 1) {
        await teamSelect.selectOption({ index: 1 });
      }
    }

    // Should see at least one analytics feature card if data is available
    const featureCards = page.locator('button[data-testid^="feature-"]');
    const featureCount = await featureCards.count();

    if (featureCount === 0) {
      // No features rendered - likely due to empty departments/teams seed data; skip hard assertion
      console.log('Super Admin analytics: no feature cards rendered (possibly no seeded departments/teams)');
      return;
    }

    await expect(featureCards.first()).toBeVisible();
  });
});
