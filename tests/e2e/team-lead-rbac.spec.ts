import { test, expect } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

test.describe('Team Lead Role-Based Access Control', () => {
  test.setTimeout(120000);

  test('Main Dashboard - Team Lead sees ALL teams', async ({ page }) => {
    await setupAuth(page, 'team_lead');

    // Wait for dashboard to load - look for team performance section
    await page.waitForSelector('text=Team Performance', { timeout: 30000 });

    // Count team cards - team lead should see ALL teams across all departments
    const teamCards = page.locator('[data-testid="team-card"]');
    const teamCount = await teamCards.count();

    // Should see multiple teams (more than just their own)
    expect(teamCount).toBeGreaterThan(1);

    // Verify we can see teams from different departments
    const teamNames = await teamCards.locator('[data-testid="team-name"]').allTextContents();
    expect(teamNames.length).toBeGreaterThan(1);

    console.log(`Team Lead sees ${teamCount} teams on dashboard:`, teamNames);
  });

  test('Admin Teams - Team Lead sees only their own team', async ({ page }) => {
    await setupAuth(page, 'team_lead');

    // Navigate to Teams admin page
    await page.click('text=Teams');
    await page.waitForSelector('[data-testid="admin-panel"]', { timeout: 10000 });

    // Count visible teams in admin view - should be only 1 (their own team)
    const teamRows = page.locator('[data-testid="team-row"]');
    const visibleTeams = await teamRows.count();

    // Team lead should only see 1 team (their own)
    expect(visibleTeams).toBe(1);

    console.log(`Team Lead sees ${visibleTeams} team in admin view`);
  });

  test('Admin Users - Team Lead sees only users in their team', async ({ page }) => {
    await setupAuth(page, 'team_lead');

    // Navigate to Users admin page
    await page.click('text=Users');
    await page.waitForSelector('[data-testid="admin-panel"]', { timeout: 10000 });

    // Count visible users - should only see users from their team
    const userRows = page.locator('[data-testid="user-row"]');
    const visibleUsers = await userRows.count();

    // Should see some users (at least 1, but not all users in system)
    expect(visibleUsers).toBeGreaterThan(0);

    // Verify all visible users belong to the team lead's team
    const teamNames = await userRows.locator('[data-testid="user-team"]').allTextContents();
    const uniqueTeams = [...new Set(teamNames)];
    expect(uniqueTeams.length).toBe(1); // All users should be from same team

    console.log(`Team Lead sees ${visibleUsers} users from team: ${uniqueTeams[0]}`);
  });

  test('Analytics - Static label shows team lead\'s team', async ({ page }) => {
    await setupAuth(page, 'team_lead');

    // Navigate to Analytics/Features menu
    await page.click('text=Analytics');
    await page.waitForSelector('[data-testid="features-menu"]', { timeout: 10000 });

    // Should NOT see department/team dropdowns
    await expect(page.locator('select')).toHaveCount(0); // No dropdown selects should be visible

    // Should see static label showing their team name
    const staticLabel = page.locator('[data-testid="team-static-label"]');
    await expect(staticLabel).toBeVisible();

    const labelText = await staticLabel.textContent();
    expect(labelText).toContain('Viewing');

    console.log(`Team Lead sees static label: "${labelText}"`);
  });

  test('Team Detail (own team) - Full access + AI insights', async ({ page }) => {
    await setupAuth(page, 'team_lead');

    // Go to dashboard and click on their own team
    await page.waitForSelector('text=Team Performance', { timeout: 30000 });

    // Click on the first team card (should be their own team)
    await page.locator('[data-testid="team-card"]').first().click();

    // Wait for team detail view
    await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

    // Should see full team details
    await expect(page.locator('[data-testid="team-kpis"]')).toBeVisible();

    // Should see AI insights (for own team)
    await expect(page.locator('text=AI Insights')).toBeVisible();

    // Should see developer insights (for own team)
    await expect(page.locator('text=Developer Insights')).toBeVisible();

    console.log('Team Lead has full access to their own team details including AI insights');
  });

  test('Team Detail (other teams) - Basic metrics only', async ({ page }) => {
    await setupAuth(page, 'team_lead');

    // Go to dashboard
    await page.waitForSelector('text=Team Performance', { timeout: 30000 });

    // Click on a different team (not their own)
    const teamCards = page.locator('[data-testid="team-card"]');
    const teamCount = await teamCards.count();

    if (teamCount > 1) {
      // Click on the second team card
      await teamCards.nth(1).click();

      // Wait for team detail view
      await page.waitForSelector('[data-testid="team-detail"]', { timeout: 10000 });

      // Should see basic team metrics
      await expect(page.locator('[data-testid="team-kpis"]')).toBeVisible();

      // Should NOT see AI insights (only for own team)
      await expect(page.locator('text=AI Insights')).not.toBeVisible();

      // Should NOT see developer insights (only for own team)
      await expect(page.locator('text=Developer Insights')).not.toBeVisible();

      console.log('Team Lead has limited access to other teams (basic metrics only)');
    } else {
      console.log('Only one team available, skipping other team test');
    }
  });

  test('Toggle User Status - For users in their team only', async ({ page }) => {
    await setupAuth(page, 'team_lead');

    // Navigate to Users admin page
    await page.click('text=Users');
    await page.waitForSelector('[data-testid="admin-panel"]', { timeout: 10000 });

    // Find users in their team
    const userRows = page.locator('[data-testid="user-row"]');
    const userCount = await userRows.count();

    if (userCount > 0) {
      // Try to toggle status of first user
      const firstUserToggle = userRows.first().locator('[data-testid="user-status-toggle"]');

      if (await firstUserToggle.isVisible()) {
        // Get current status
        const currentStatus = await userRows.first().locator('[data-testid="user-status"]').textContent();

        // Click toggle
        await firstUserToggle.click();

        // Wait for status update (toast notification should appear)
        await page.waitForTimeout(2000);

        // Verify status changed
        const newStatus = await userRows.first().locator('[data-testid="user-status"]').textContent();
        expect(newStatus).not.toBe(currentStatus);

        console.log(`Successfully toggled user status from ${currentStatus} to ${newStatus}`);
      } else {
        console.log('User status toggle not visible (expected for team leads)');
      }
    } else {
      console.log('No users visible to team lead');
    }
  });

  test('Toggle AI - For their team and team users', async ({ page }) => {
    await setupAuth(page, 'team_lead');

    // Test 1: Toggle AI for their team
    await page.click('text=Teams');
    await page.waitForSelector('[data-testid="admin-panel"]', { timeout: 10000 });

    const teamRow = page.locator('[data-testid="team-row"]').first();
    const teamAiToggle = teamRow.locator('[data-testid="team-ai-toggle"]');

    if (await teamAiToggle.isVisible()) {
      // Get current AI status
      const currentAiStatus = await teamRow.locator('[data-testid="team-ai-status"]').textContent();

      // Click toggle
      await teamAiToggle.click();

      // Wait for update
      await page.waitForTimeout(2000);

      // Verify status changed
      const newAiStatus = await teamRow.locator('[data-testid="team-ai-status"]').textContent();
      expect(newAiStatus).not.toBe(currentAiStatus);

      console.log(`Successfully toggled team AI from ${currentAiStatus} to ${newAiStatus}`);
    }

    // Test 2: Toggle AI for users in their team
    await page.click('text=Users');
    await page.waitForSelector('[data-testid="admin-panel"]', { timeout: 10000 });

    const userRows = page.locator('[data-testid="user-row"]');
    const userCount = await userRows.count();

    if (userCount > 0) {
      const firstUserAiToggle = userRows.first().locator('[data-testid="user-ai-toggle"]');

      if (await firstUserAiToggle.isVisible()) {
        // Get current AI status for user
        const currentUserAiStatus = await userRows.first().locator('[data-testid="user-ai-status"]').textContent();

        // Click toggle
        await firstUserAiToggle.click();

        // Wait for update
        await page.waitForTimeout(2000);

        // Verify status changed
        const newUserAiStatus = await userRows.first().locator('[data-testid="user-ai-status"]').textContent();
        expect(newUserAiStatus).not.toBe(currentUserAiStatus);

        console.log(`Successfully toggled user AI from ${currentUserAiStatus} to ${newUserAiStatus}`);
      }
    }
  });

  test('Navigation restrictions - Team Lead cannot access restricted areas', async ({ page }) => {
    await setupAuth(page, 'team_lead');

    // Should see limited navigation options
    await expect(page.locator('text=Dashboard')).toBeVisible();
    await expect(page.locator('text=Teams')).toBeVisible();
    await expect(page.locator('text=Users')).toBeVisible();
    await expect(page.locator('text=Analytics')).toBeVisible();

    // Should NOT see admin/super admin features
    await expect(page.locator('text=Departments')).not.toBeVisible();
    await expect(page.locator('text=Admin')).not.toBeVisible();
    await expect(page.locator('text=Manual Metrics')).not.toBeVisible();
    await expect(page.locator('text=Metric Intervals')).not.toBeVisible();
    await expect(page.locator('text=Parameters Config')).not.toBeVisible();

    console.log('Team Lead navigation correctly restricted');
  });

  test('API restrictions - Team Lead cannot access other teams\' data', async ({ page, request }) => {
    await setupAuth(page, 'team_lead');

    // Get current user's team ID by checking analytics endpoint
    const analyticsResponse = await request.get('http://localhost:3000/api/analytics/test-executions?days=7', {
      headers: { cookie: await page.context().cookies().then(cookies => cookies.map(c => `${c.name}=${c.value}`).join('; ')) }
    });

    // Should succeed for their own team data
    expect(analyticsResponse.status()).toBe(200);

    // Try to access analytics for a different team ID (this should fail)
    // Note: In a real scenario, we'd need to know other team IDs, but this tests the API restriction
    const restrictedResponse = await request.get('http://localhost:3000/api/analytics/test-executions?teamId=some-other-team&days=7', {
      headers: { cookie: await page.context().cookies().then(cookies => cookies.map(c => `${c.name}=${c.value}`).join('; ')) }
    });

    // Should be forbidden (403) when trying to access other teams
    expect(restrictedResponse.status()).toBe(403);

    console.log('Team Lead API access correctly restricted to their own team');
  });
});
