import { test, expect } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

test.describe('Viewer Role-Based Access Control', { tag: ['@area:navigation', '@role:viewer'] }, () => {
  // Written for one worker: these tests run in order, in one worker (a failure does not skip the rest).
  test.describe.configure({ mode: 'default' });
  test.setTimeout(60000);

  test('Viewer has minimal access to features', async ({ page }) => {
    await setupAuth(page, 'viewer');

    // Wait for dashboard to load
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Check navigation menu - should see Dashboard and the team-level Analytics modules
    // (limited to the viewer's own team). Should NOT see Users, Teams, Departments, Admin, etc.
    // Navigation sits in a drawer behind the burger button in the top bar
    await page.click('[data-testid="nav-toggle"]');
    await expect(page.locator('[data-testid="nav-dashboard"]')).toBeVisible();

    // Should NOT see these restricted nav items at all
    await expect(page.locator('[data-testid="nav-users"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="nav-teams"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="nav-departments"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="nav-analytics"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-admin"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="nav-manual-metrics"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="nav-metric-intervals"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="nav-parameters-config"]')).toHaveCount(0);
  });

  test('Viewer sees only the teams she is assigned to on the dashboard', async ({ page }) => {
    await setupAuth(page, 'viewer');

    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // One scope for every page (docs/ROLE_ACCESS.md): the cards are the teams of her assignments.
    const teamCards = page.locator('[data-testid="team-card"]');
    await expect(teamCards.first()).toBeVisible();
    const scope = await (await page.request.get('http://localhost:3000/api/analytics/scope')).json();
    const names = ((scope.teams ?? []) as Array<{ name: string }>).map((t) => t.name).sort();
    expect((await teamCards.locator('[data-testid="team-name"]').allTextContents()).sort()).toEqual(names);
    // The summary is about her team(s), not the company.
    await expect(page.getByTestId('hero-title')).toHaveText(names.length === 1 ? 'Your team' : 'Your teams');
    // Another team of the company: refused by the API (team detail and TV mode).
    expect((await page.request.get('http://localhost:3000/api/teams/team-1764026236967-uphpblii4')).status()).toBe(403);
    expect((await page.request.get('http://localhost:3000/api/tv/teams/team-1764026236967-uphpblii4')).status()).toBe(403);
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

    // Viewer should NOT see recommendations; the members table holds at most her own row
    await expect(page.locator('[data-testid="ai-insights-header"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Developer recommendations', exact: true })).toHaveCount(0);
    expect(await page.locator('[data-testid="team-member-card"]').count()).toBeLessThanOrEqual(1);

    // Should still see basic team information
    await expect(page.locator('[data-testid="team-kpis"]')).toBeVisible();
  });

  test('Viewer can go back and forth between the overview and the teams of her scope', async ({ page }) => {
    await setupAuth(page, 'viewer');

    // Go to dashboard
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Click on first team
    const teamCards = page.locator('[data-testid="team-card"]');
    await teamCards.first().click();
    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // Verify team detail loaded
    await expect(page.locator('[data-testid="team-detail"]')).toBeVisible();

    // Go back to dashboard (breadcrumb link)
    await page.click('[data-testid="back-to-dashboard"]');
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });

    // Every other card (a viewer of several teams) opens too; the demo viewer has one team.
    const count = await teamCards.count();
    for (let i = 1; i < count; i++) {
      await teamCards.nth(i).click();
      await expect(page.locator('[data-testid="team-detail"]')).toBeVisible();
      await page.click('[data-testid="back-to-dashboard"]');
    }
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('Viewer cannot access any admin or management pages', async ({ page }) => {
    await setupAuth(page, 'viewer');

    // Try to access restricted pages directly - should be redirected or show access denied
    const restrictedUrls = [
      '/users', '/teams', '/departments', '/admin-panel',
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

  test('Viewer opens Analytics read-only for their own team (or sees the no-team state)', async ({ page }) => {
    await setupAuth(page, 'viewer');
    await page.goto('/analytics');
    await page.waitForSelector('[data-testid="features-menu"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="analytics-scope-bar"]')).toBeVisible();
    // No editable department / team selector for a viewer.
    await expect(page.locator('[data-testid="analytics-scope-bar"] select')).toHaveCount(0);
    const noTeam = await page.locator('[data-testid="analytics-no-team"]').isVisible().catch(() => false);
    if (!noTeam) {
      await expect(page.locator('[data-testid="analytics-scope-team-static"]')).toBeVisible();
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
