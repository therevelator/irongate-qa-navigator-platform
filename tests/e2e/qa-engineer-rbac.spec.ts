import { test, expect } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

test.describe('QA Engineer Role-Based Access Control', { tag: ['@area:navigation', '@role:engineer'] }, () => {
  // Written for one worker: these tests run in order, in one worker (a failure does not skip the rest).
  test.describe.configure({ mode: 'default' });
  test.setTimeout(60000);

  test('QA Engineer sees only the teams of their analytics scope on the dashboard', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');

    // Wait for dashboard to load
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

    // One scope for every page (docs/ROLE_ACCESS.md): the cards are exactly the teams of the scope.
    const teamCards = page.locator('[data-testid="team-card"]');
    await expect(teamCards.first()).toBeVisible();
    const scope = await (await page.request.get('http://localhost:3000/api/analytics/scope')).json();
    const names = ((scope.teams ?? []) as Array<{ name: string }>).map((t) => t.name).sort();
    expect((await teamCards.locator('[data-testid="team-name"]').allTextContents()).sort()).toEqual(names);
    await expect(page.getByTestId('hero-title')).toHaveText(names.length === 1 ? 'Your team' : 'Your teams');
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

    // Team members section should be visible for their own team
    await expect(page.getByRole('heading', { name: 'Team members', exact: true })).toBeVisible();

    // For QA Engineers, TeamDetailView shows only themselves as a member for their own team
    const memberCards = page.locator('[data-testid="team-member-card"]');
    await expect(memberCards).toHaveCount(1);
  });

  test('QA Engineer cannot open another team: no card for it, and its team detail API answers 403', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });
    // QualityCowboys (Payments Processing) is outside the engineer's scope (tests/e2e/support/roles.ts DEMO.otherTeam).
    await expect(page.locator('[data-testid="team-card"]', { hasText: 'QualityCowboys' })).toHaveCount(0);
    const res = await page.request.get('http://localhost:3000/api/teams/team-1764026236967-uphpblii4');
    expect(res.status()).toBe(403);
  });

  test('QA Engineer does NOT see AI Insights or Developer Insights', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');

    // Go to dashboard and click own team
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });
    await page.locator('[data-testid="team-card"]').first().click();
    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // Should NOT see team or developer recommendations
    await expect(page.locator('[data-testid="ai-insights-header"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Developer recommendations', exact: true })).toHaveCount(0);
  });

  test('QA Engineer opens team analytics for their own team, with only their own developer row', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');
    await page.goto('/analytics/productivity');
    await page.waitForSelector('[data-testid="analytics-scope-bar"]', { timeout: 10000 });
    // Read-only scope: their own department and team, no selectors.
    await expect(page.locator('[data-testid="analytics-scope-bar"] select')).toHaveCount(0);
    await expect(page.locator('[data-testid="analytics-scope-team-static"]')).toBeVisible();
    await expect(page.locator('[data-testid="own-row-only"]')).toBeVisible();
    // The URL carries the team, so a reload keeps it.
    expect(new URL(page.url()).searchParams.get('team')).toBeTruthy();
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

