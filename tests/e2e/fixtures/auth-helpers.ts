import { Page } from '@playwright/test';
import { TEST_USERS } from './test-users';

/**
 * Helper functions for authentication in E2E tests
 */

export async function login(page: Page, email: string, password: string) {
  // Navigate with extended timeout
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for login form to be ready
  await page.waitForSelector('input[type="email"]', { state: 'visible', timeout: 15000 });
  
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  
  // Click sign in and wait for navigation
  await Promise.all([
    page.waitForNavigation({ timeout: 45000, waitUntil: 'domcontentloaded' }).catch(() => {
      console.log('Navigation timeout - checking if login succeeded anyway');
    }),
    page.click('button:has-text("Sign In")'),
  ]);
  
  // Give page time to settle
  await page.waitForTimeout(2000);
  
  // Check if we're logged in by looking for elements that appear after login
  // The app doesn't change URL, it just shows different content
  const isLoggedIn = await page.locator('text=Admin Panel').isVisible().catch(() => false) ||
                     await page.locator('text=All Teams').isVisible().catch(() => false) ||
                     await page.locator('button:has-text("Sign Out")').isVisible().catch(() => false);
  
  if (!isLoggedIn) {
    throw new Error('Login failed - dashboard elements not found');
  }
  
  // Wait for any loaders to disappear
  await page.waitForSelector('.irongate-loader', { state: 'hidden', timeout: 10000 }).catch(() => {});
  await page.waitForSelector('[data-loading="true"]', { state: 'hidden', timeout: 10000 }).catch(() => {});
  
  // Wait for network to settle
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  
  // Extra buffer
  await page.waitForTimeout(1000);
}

export async function loginAsSuperAdmin(page: Page) {
  await login(page, TEST_USERS.SUPER_ADMIN.email, TEST_USERS.SUPER_ADMIN.password);
}

export async function loginAsQAManager(page: Page) {
  await login(page, TEST_USERS.QA_MANAGER.email, TEST_USERS.QA_MANAGER.password);
}

export async function loginAsTeamLead(page: Page) {
  await login(page, TEST_USERS.TEAM_LEAD.email, TEST_USERS.TEAM_LEAD.password);
}

export async function loginAsQAEngineer(page: Page) {
  await login(page, TEST_USERS.QA_ENGINEER.email, TEST_USERS.QA_ENGINEER.password);
}

export async function logout(page: Page) {
  // Click user avatar/profile
  await page.click('[data-testid="user-menu"]', { timeout: 5000 }).catch(() => {
    // Fallback: look for logout button directly
  });
  await page.click('button:has-text("Logout")');
  await page.waitForURL('/');
}

export async function getAuthToken(page: Page): Promise<string | null> {
  return await page.evaluate(() => localStorage.getItem('irongate_token'));
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  const token = await getAuthToken(page);
  return token !== null;
}

/**
 * Wait for all loading indicators to disappear
 * Useful after navigation or data fetching
 */
export async function waitForLoadingToComplete(page: Page) {
  // Wait for page to be in a stable state
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  
  // Wait for common loading indicators
  const selectors = [
    '.irongate-loader',
    '[data-loading="true"]',
    '.loading',
    '.spinner',
    'text=Loading...',
  ];

  for (const selector of selectors) {
    await page.waitForSelector(selector, { state: 'hidden', timeout: 10000 }).catch(() => {
      // Selector might not exist, that's fine
    });
  }

  // Wait for network to settle
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // Delay to ensure UI has settled
  await page.waitForTimeout(1000);
}
