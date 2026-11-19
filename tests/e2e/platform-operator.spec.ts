import { test, expect, type Page } from '@playwright/test';
import { setupAuth } from './fixtures/auth';

/**
 * Smoke test of the platform support panel (/operator) and the User activity page.
 * The test API runs with PLATFORM_OPERATOR_EMAILS=admin@irongate.com (CI .env), so the demo
 * super admin is the operator; other roles never see the panel.
 */

const noSidewaysScroll = async (page: Page) => {
  const overflow = await page.evaluate(() => {
    const main = document.getElementById('main-scroll');
    return {
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
  expect(overflow.doc).toBeLessThanOrEqual(1);
  expect(overflow.main).toBeLessThanOrEqual(1);
};

test.describe('Platform support panel', { tag: ['@area:operator'] }, () => {
  // Written for one worker: these tests run in order, in one worker (a failure does not skip the rest).
  test.describe.configure({ mode: 'default' });
  test.setTimeout(120000);

  test('the operator steps up, opens a company with a reason, sees the banner and leaves', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.click('[data-testid="nav-toggle"]');
    await expect(page.locator('[data-testid="nav-operator"]')).toBeVisible();
    await page.click('[data-testid="nav-operator"]');
    await expect(page).toHaveURL(/\/operator$/);
    await expect(page.locator('[data-testid="operator-banner"]')).toContainText('Platform support mode');

    // Wrong password first.
    await page.fill('[data-testid="operator-password"]', 'not-the-password');
    await page.click('[data-testid="operator-enter"]');
    await expect(page.getByRole('alert')).toContainText('Wrong password');
    await page.fill('[data-testid="operator-password"]', 'demo123');
    await page.click('[data-testid="operator-enter"]');
    await expect(page.locator('[data-testid="operator-overview"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="operator-countdown"]')).toHaveText(/^(29|30):\d\d$/);
    await expect(page.locator('[data-testid="operator-jobs"]')).toContainText('db-keepalive');

    await page.locator('[data-testid="operator-open-company"]').first().click();
    await expect(page.locator('[data-testid="operator-open-confirm"]')).toBeDisabled();
    await page.fill('[data-testid="operator-open-reason"]', 'E2E smoke test');
    await page.click('[data-testid="operator-open-confirm"]');
    await expect(page.locator('[data-testid="operator-company"]')).toBeVisible();
    await expect(page.locator('[data-testid="op-organisation"]')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    await expect(page.locator('[data-testid="op-users"]')).toBeVisible({ timeout: 30000 });

    // A repair action needs a reason and a confirmation.
    await page.click('[data-testid="op-evaluate-alerts"]');
    await expect(page.locator('[data-testid="op-action-run"]')).toBeDisabled();
    await page.fill('[data-testid="op-action-reason"]', 'E2E smoke test');
    await page.check('[data-testid="op-action-confirm-check"]');
    await page.click('[data-testid="op-action-run"]');
    await expect(page.locator('[data-testid="op-action-run"]')).toHaveCount(0, { timeout: 30000 });

    await page.click('[data-testid="operator-leave"]');
    await expect(page.locator('[data-testid="operator-stepup"]')).toBeVisible();
  });

  test('works at 390 px without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setupAuth(page, 'super_admin');
    await page.goto('http://localhost:5173/operator');
    await page.fill('[data-testid="operator-password"]', 'demo123');
    await page.click('[data-testid="operator-enter"]');
    await expect(page.locator('[data-testid="operator-overview"]')).toBeVisible({ timeout: 30000 });
    await noSidewaysScroll(page);
    await page.locator('[data-testid="operator-open-company"]').first().click();
    await page.fill('[data-testid="operator-open-reason"]', 'E2E phone check');
    await page.click('[data-testid="operator-open-confirm"]');
    await expect(page.locator('[data-testid="op-organisation"]')).toBeVisible({ timeout: 30000 });
    await noSidewaysScroll(page);
  });

  test('other roles have no Platform entry and /operator says it is not available', async ({ page }) => {
    await setupAuth(page, 'qa_engineer');
    await page.click('[data-testid="nav-toggle"]');
    await expect(page.locator('[data-testid="nav-user-activity"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="nav-operator"]')).toHaveCount(0);
    await page.goto('http://localhost:5173/operator');
    await expect(page.getByText('This area is not available for your account.')).toBeVisible({ timeout: 30000 });
  });
});

test.describe('User activity', { tag: ['@area:operator'] }, () => {
  // Written for one worker: these tests run in order, in one worker (a failure does not skip the rest).
  test.describe.configure({ mode: 'default' });
  test.setTimeout(90000);

  test('super admins see the user activity with the privacy notice', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.click('[data-testid="nav-toggle"]');
    await page.click('[data-testid="nav-user-activity"]');
    await expect(page.getByRole('heading', { name: 'User activity', level: 2 })).toBeVisible();
    await expect(page.locator('[data-testid="user-activity-notice"]')).toContainText('Every action by your users is recorded for 90 days');
    await expect(page.locator('[data-testid="user-activity-row"]').first()).toBeVisible({ timeout: 30000 });
    await page.selectOption('[data-testid="ua-type"]', 'sign_in');
    await expect(page.locator('[data-testid="user-activity-row"]').first()).toContainText('Sign-in');
  });

  test('a QA manager has no User activity page', async ({ page }) => {
    await setupAuth(page, 'qa_manager');
    await page.goto('http://localhost:5173/user-activity');
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 30000 });
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
  });
});
