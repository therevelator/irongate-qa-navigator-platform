import { test, expect } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

test.describe('QA Engineer Role-Based Access Control', () => {
  test.setTimeout(60000);

  test('QA Engineer sees ALL teams on dashboard', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');

    // Wait for dashboard to load
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Should see all teams (more than 1)
    const teamCards = page.locator('[data-testid="team-card"]');
    await expect(teamCards.first()).toBeVisible();

    // Check count - should be > 1 (assuming seed data has multiple teams)
    const count = await teamCards.count();
    expect(count).toBeGreaterThan(1);
  });

  test('QA Engineer sees themselves in Team Members for their own team', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');

    // Wait for dashboard to load
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Click the card for the engineer's actual primary team using the dashboard's own
    // primary-team marker. This is more robust than relying on specific seeded IDs.
    const myTeamCard = page.locator('[data-testid="team-card"][data-primary-team="true"]').first();
    await expect(myTeamCard).toBeVisible();
    await myTeamCard.click();

    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // Team Members section should be visible for their own team
    await expect(page.locator('text=Team Members')).toBeVisible();

    // For QA Engineers, TeamDetailView shows only themselves as a member for their own team
    const memberCards = page.locator('[data-testid="team-member-card"]');
    await expect(memberCards).toHaveCount(1);
  });

  test('QA Engineer does NOT see Team Members for other teams', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');

    // Go to dashboard
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Click a team that is NOT QualityCowboys
    const otherTeamCard = page.locator('[data-testid="team-card"]').filter({ hasNotText: 'QualityCowboys' }).first();

    if (await otherTeamCard.count() > 0) {
      await otherTeamCard.click();
      await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

      // Should NOT see Team Members section
      await expect(page.locator('text=Team Members')).not.toBeVisible();
    }
  });

  test('QA Engineer does NOT see AI Insights or Developer Insights', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');

    // Go to dashboard and click own team
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });
    await page.locator('[data-testid="team-card"]').first().click();
    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // Should NOT see AI Insights
    await expect(page.locator('text=AI Insights')).not.toBeVisible();
    await expect(page.locator('text=Developer Insights')).not.toBeVisible();
  });

  test('QA Engineer cannot access restricted pages directly', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');

    // Try to access restricted pages directly - should be redirected or show access denied
    const restrictedUrls = ['/users', '/teams', '/departments', '/admin-panel'];

    for (const url of restrictedUrls) {
      await page.goto(`http://localhost:5173${url}`);
      await page.waitForTimeout(2000); // Wait for potential redirect

      // Should either be redirected to dashboard or show access denied
      const currentUrl = page.url();
      const isRedirected = !currentUrl.includes(url) || currentUrl.includes('/dashboard') || currentUrl === 'http://localhost:5173/';

      expect(isRedirected).toBe(true);
    }
  });
});

