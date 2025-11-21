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
  await page.click('button:has-text("Sign In")');
  
  // Wait for navigation to complete with extended timeout
  await page.waitForURL((url) => url.pathname !== '/', { timeout: 30000 });
  
  // Wait for page to load
  await page.waitForLoadState('load', { timeout: 30000 });
  
  // Wait for IronGate loader to disappear (if present)
  await page.waitForSelector('.irongate-loader', { state: 'hidden', timeout: 10000 }).catch(() => {
    // Loader might not be present, that's okay
  });
  
  // Alternative: wait for any loading spinner to disappear
  await page.waitForSelector('[data-loading="true"]', { state: 'hidden', timeout: 10000 }).catch(() => {
    // Loading indicator might not be present
  });
  
  // Wait for network to settle
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
    // Network might not be idle, continue anyway
  });
  
  // Extra buffer for slow systems
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
