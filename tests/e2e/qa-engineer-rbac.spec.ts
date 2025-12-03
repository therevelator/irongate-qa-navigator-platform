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

    // Go to dashboard
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // Find their own team (QualityCowboys based on seed data usually, or check text)
    // For now, we'll click the one that says "QualityCowboys" if possible, or just iterate
    // But we know from seed data that engineer@irongate.com is in QualityCowboys

    const myTeamCard = page.locator('[data-testid="team-card"]').filter({ hasText: 'QualityCowboys' });
    if (await myTeamCard.count() > 0) {
      await myTeamCard.click();
    } else {
      // Fallback: click first team if we can't find specific one (might fail if not own team)
      // Better to log warning
      console.log('Could not find QualityCowboys team card, clicking first available');
      await page.locator('[data-testid="team-card"]').first().click();
    }

    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // Should see Team Members section
    await expect(page.locator('text=Team Members')).toBeVisible();

    // Should see themselves
    await expect(page.locator('text=QA Engineer')).toBeVisible();
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

