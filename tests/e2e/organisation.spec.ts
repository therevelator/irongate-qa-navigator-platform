import { test, expect, request as pwRequest } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

/**
 * Organisation & roles UI: the Activity page is offered to super admins and QA managers only,
 * the Users page invites by email (link shown when no email is sent), and the invited person
 * accepts on /accept-invite and lands in the app with exactly the invited access.
 */
test.describe('Organisation, invitations and activity', { tag: ['@area:org', '@area:activity'] }, () => {
  // Written for one worker: these tests run in order, in one worker (a failure does not skip the rest).
  test.describe.configure({ mode: 'default' });
  test.setTimeout(90000);

  test('Activity is in the navigation for super admins and QA managers only', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.click('[data-testid="nav-toggle"]');
    await expect(page.locator('[data-testid="nav-activity"]')).toBeVisible();
    await page.click('[data-testid="nav-activity"]');
    await expect(page.getByRole('heading', { name: 'Activity', level: 2 })).toBeVisible();
    await expect(page.locator('[data-testid="activity-list"]').or(page.getByText('No changes match'))).toBeVisible();
  });

  test('An engineer has no Activity page', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');
    await page.click('[data-testid="nav-toggle"]');
    await expect(page.locator('[data-testid="nav-activity"]')).toHaveCount(0);
    await page.goto('http://localhost:5173/activity');
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 30000 });
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  });

  test('Invite by email, then accept the invitation and sign in', async ({ page, browser }) => {
    await setupAuth(page, 'super_admin');
    await page.goto('http://localhost:5173/users');
    await page.click('[data-testid="invite-user-btn"]');
    const email = `e2e-invite-${Date.now()}@irongate.test`;
    await page.fill('[data-testid="invite-email"]', email);
    await page.selectOption('[data-testid="invite-role"]', 'viewer');
    await page.click('[data-testid="invite-submit"]');
    // No SMTP in tests: the link is shown to copy.
    const linkBox = page.locator('[data-testid="invite-link"]');
    await expect(linkBox).toBeVisible();
    const link = await linkBox.inputValue();
    expect(link).toContain('/accept-invite?token=igi_');

    const ctx = await browser.newContext();
    const invited = await ctx.newPage();
    await invited.goto(link);
    await expect(invited.getByRole('heading', { name: /^Join / })).toBeVisible();
    await invited.fill('#invite-first', 'Eto');
    await invited.fill('#invite-last', 'Invited');
    await invited.fill('#invite-password', 'Weak');
    await invited.fill('#invite-confirm', 'Weak');
    await invited.click('button[type="submit"]');
    await expect(invited.locator('[role="alert"]')).toContainText(/stronger password/);
    await invited.fill('#invite-password', 'Str0ng-Passw0rd');
    await invited.fill('#invite-confirm', 'Str0ng-Passw0rd');
    await invited.click('button[type="submit"]');
    await expect(invited.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 30000 });

    // The link works once.
    const again = await ctx.newPage();
    await again.goto(link);
    await expect(again.locator('[data-testid="invite-error"]')).toContainText(/already been used|signed in/i).catch(async () => {
      await expect(again.getByRole('heading', { name: 'You are already signed in' })).toBeVisible();
    });
    await ctx.close();

    // Clean up: deactivate the new account.
    const api = await pwRequest.newContext({ baseURL: 'http://localhost:3000', storageState: await page.context().storageState() });
    const users = await (await api.get('/api/admin/users')).json();
    const created = (users as any[]).find((u) => u.email === email);
    if (created) await api.delete(`/api/admin/users/${created.id}`);
    await api.dispose();
  });
});
