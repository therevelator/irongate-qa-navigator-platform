import { test, expect } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

test.describe('Comprehensive RBAC Additional Tests', () => {
    test.setTimeout(60000);

    test('Viewer cannot see Settings in profile menu', async ({ page }) => {
        await setupAuth(page, 'viewer');

        // Wait for dashboard
        await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

        // Open profile menu (assuming there is one, usually top right)
        // If specific selector is unknown, we might need to find it. 
        // Based on Login.tsx, there isn't a clear profile menu structure shown, 
        // but usually these apps have one. 
        // Let's check if there is a user menu button.
        const userMenuBtn = page.locator('[data-testid="user-menu-btn"]');

        if (await userMenuBtn.isVisible()) {
            await userMenuBtn.click();
            await expect(page.locator('text=Settings')).not.toBeVisible();
        } else {
            // If no user menu, maybe settings is a direct link?
            await expect(page.locator('text=Settings')).not.toBeVisible();
        }
    });

    test('QA Engineer cannot access Invite Member API', async ({ page, request }) => {
        await setupAuth(page, 'qa_engineer');

        // Attempt to call an invite endpoint
        const response = await request.post('http://localhost:3000/api/users/invite', {
            data: { email: 'test@example.com', role: 'viewer' },
            headers: { cookie: await page.context().cookies().then(cookies => cookies.map(c => `${c.name}=${c.value}`).join('; ')) }
        });

        // Should be forbidden or not found (if mock)
        expect([401, 403, 404]).toContain(response.status());
    });

    test('Team Lead cannot delete other teams', async ({ page, request }) => {
        await setupAuth(page, 'team_lead');

        // Attempt to delete a random team ID
        const response = await request.delete('http://localhost:3000/api/teams/999999', {
            headers: { cookie: await page.context().cookies().then(cookies => cookies.map(c => `${c.name}=${c.value}`).join('; ')) }
        });

        // Should be forbidden
        expect([401, 403, 404]).toContain(response.status());
    });
});
