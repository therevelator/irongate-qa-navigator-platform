import { test, expect, type Page } from '@playwright/test';
import { setupAuth } from './fixtures/auth';
import { OPERATOR, ensureOperator, operatorSignIn } from './support/operator';

/**
 * Smoke test of the platform support panel (/operator) and the User activity page. Platform
 * support has its own accounts (platform_operators, tests/e2e/support/operator.ts), never a
 * company user: company users have no Platform entry and cannot sign in at /operator.
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

  test('the operator signs in at /operator, opens a company with a reason, runs an action and signs out', async ({ page }) => {
    await ensureOperator();
    await page.goto('http://localhost:5173/operator');
    await expect(page.locator('[data-testid="operator-banner"]')).toContainText('IronGate platform support');
    await expect(page.locator('[data-testid="operator-signin"]')).toBeVisible();

    // Wrong password first.
    await page.fill('[data-testid="operator-email"]', OPERATOR.email);
    await page.fill('[data-testid="operator-password"]', 'not-the-password');
    await page.click('[data-testid="operator-enter"]');
    await expect(page.getByRole('alert')).toContainText('Wrong e-mail address or password');
    await page.fill('[data-testid="operator-password"]', OPERATOR.password);
    await page.click('[data-testid="operator-enter"]');
    await expect(page.locator('[data-testid="operator-overview"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="operator-who"]')).toHaveText(OPERATOR.name);
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
    await expect(page.locator('[data-testid="operator-signin"]')).toBeVisible();
  });

  test('works at 390 px without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await operatorSignIn(page);
    await noSidewaysScroll(page);
    await page.locator('[data-testid="operator-open-company"]').first().click();
    await page.fill('[data-testid="operator-open-reason"]', 'E2E phone check');
    await page.click('[data-testid="operator-open-confirm"]');
    await expect(page.locator('[data-testid="op-organisation"]')).toBeVisible({ timeout: 30000 });
    await noSidewaysScroll(page);
  });

  test('company users have no Platform entry and cannot sign in at /operator', async ({ page }) => {
    await setupAuth(page, 'super_admin');
    await page.click('[data-testid="nav-toggle"]');
    await expect(page.locator('[data-testid="nav-user-activity"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-operator"]')).toHaveCount(0);
    await ensureOperator();
    await page.goto('http://localhost:5173/operator');
    // The company session does not count here: the platform support sign-in is shown.
    await expect(page.locator('[data-testid="operator-signin"]')).toBeVisible({ timeout: 30000 });
    await page.fill('[data-testid="operator-email"]', 'admin@irongate.com');
    await page.fill('[data-testid="operator-password"]', 'demo123');
    await page.click('[data-testid="operator-enter"]');
    await expect(page.getByRole('alert')).toContainText('Wrong e-mail address or password');
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
