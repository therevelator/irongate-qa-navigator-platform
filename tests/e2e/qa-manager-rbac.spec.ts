import { test, expect } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

test.describe('QA Manager Role-Based Access Control', () => {
  test.setTimeout(60000);

  test('QA Manager has access to department-level features', async ({ page }) => {
    await setupAuth(page, 'qa_manager');

    // Wait for dashboard to load
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // QA Manager should see the same global team overview as other roles on the main dashboard.
    const teamCards = page.locator('[data-testid="team-card"]');
    const teamCount = await teamCards.count();
    expect(teamCount).toBeGreaterThan(1);

    // Check navigation menu - should see Users, Teams, Analytics, Admin, Metric Intervals, Parameters Config
    // Should NOT see Departments
    // Navigation sits in a drawer behind the burger button in the top bar
    await page.click('[data-testid="nav-toggle"]');
    await expect(page.locator('[data-testid="nav-dashboard"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-users"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-teams"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-analytics"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-admin"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-metric-intervals"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-parameters-config"]')).toBeVisible();
    // Manual metrics: same roles as POST /api/metrics/manual (team scope enforced server-side)
    await expect(page.locator('[data-testid="nav-manual-metrics"]')).toBeVisible();

    // Should NOT see these restricted items
    await expect(page.locator('[data-testid="nav-departments"]')).toHaveCount(0);
  });

  test('QA Manager can manage users and teams in their department', async ({ page }) => {
    await setupAuth(page, 'qa_manager');

    // Go to users page
    await page.goto('/users');
    await page.waitForSelector('[data-testid="users-page"]', { timeout: 10000 });

    // Should see users in their department
    const userRows = page.locator('[data-testid="user-card"]');
    await expect(userRows.first()).toBeVisible();

    // Go to teams page
    await page.goto('/teams');
    await page.waitForSelector('[data-testid="teams-page"]', { timeout: 10000 });

    // Should be able to create teams
    await page.click('[data-testid="add-team-btn"]');
    const teamName = `QA Manager Test Team ${Date.now()}`;
    await page.fill('[data-testid="team-name-input"]', teamName);
    await page.fill('[data-testid="team-description-input"]', 'Test team created by QA Manager');
    await page.click('[data-testid="create-team-btn"]');

    // Verify team creation, then deactivate it again
    const row = page.locator('[data-testid="team-row"]', { hasText: teamName });
    await expect(row).toBeVisible();
    const id = await row.getAttribute('data-team-id');
    const cookie = (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ');
    await page.request.delete(`http://localhost:3000/api/admin/teams/${id}`, { headers: { cookie } });
  });

  test('QA Manager can see team details with full insights', async ({ page }) => {
    await setupAuth(page, 'qa_manager');

    // Go to dashboard and click on a team
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });
    await page.locator('[data-testid="team-card"]').first().click();

    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // QA Manager should see AI insights section for the selected team.
    // We target the dedicated AI insights header to avoid strict mode issues with error banners.
    await expect(page.locator('[data-testid="ai-insights-header"]')).toBeVisible();
  });

  test('QA Manager can access admin panel', async ({ page }) => {
    await setupAuth(page, 'qa_manager');

    await page.goto('/admin-panel');

    // Admin panel container should be visible
    await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible();

    // Header content matches current AdminPanel copy
    await expect(page.getByTestId('admin-panel').getByRole('heading', { name: 'Admin console' })).toBeVisible();
    await expect(page.locator('text=Organization Structure')).toBeVisible();

    // Note: Department creation and its empty-state message are controlled by Super Admin.
    // We intentionally do not assert on department visibility here to keep the test resilient to seed data.
  });
});
