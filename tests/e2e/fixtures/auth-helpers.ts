import { Page } from '@playwright/test';
import { TEST_USERS } from './test-users';

/**
 * Helper functions for authentication in E2E tests
 */

export async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign In")');
  
  // Wait for navigation to complete
  await page.waitForURL((url) => url.pathname !== '/');
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
