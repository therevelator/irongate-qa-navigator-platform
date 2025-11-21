import { test, expect } from '@playwright/test';
import { TEST_USERS } from './fixtures/test-users';
import { login, loginAsSuperAdmin, getAuthToken, isLoggedIn, logout } from './fixtures/auth-helpers';

test.describe('Authentication', () => {
  
  test.beforeEach(async ({ page }) => {
    // Clear storage before each test
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test.afterEach(async ({ page }) => {
    // Logout after each test
    await logout(page).catch(() => {
      console.log('Logout failed or already logged out');
    });
  });

  test('AUTH-UI-001: Super Admin login with valid credentials', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    // Verify token stored
    const token = await getAuthToken(page);
    expect(token).not.toBeNull();
    
    // Verify user info displayed
    await expect(page.locator('text=Admin User')).toBeVisible();
    
    // Verify Admin Panel menu visible
    await expect(page.locator('text=Admin Panel')).toBeVisible();
    
    // Verify Sign Out button visible (confirms logged in)
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
  });

  test('AUTH-UI-001B: QA Manager login with valid credentials', async ({ page }) => {
    await login(page, TEST_USERS.QA_MANAGER.email, TEST_USERS.QA_MANAGER.password);
    
    const token = await getAuthToken(page);
    expect(token).not.toBeNull();
    
    // Verify logged in and has admin access
    await expect(page.locator('text=Admin Panel')).toBeVisible();
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    
    // Verify email displayed
    await expect(page.locator('text=manager@irongate.com')).toBeVisible();
  });

  test('AUTH-UI-001C: Team Lead login with valid credentials', async ({ page }) => {
    await login(page, TEST_USERS.TEAM_LEAD.email, TEST_USERS.TEAM_LEAD.password);
    
    await expect(page.locator('text=Admin Panel')).toBeVisible();
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    await expect(page.locator('text=lead@irongate.com')).toBeVisible();
  });

  test('AUTH-UI-001D: QA Engineer login - no admin access', async ({ page }) => {
    await login(page, TEST_USERS.QA_ENGINEER.email, TEST_USERS.QA_ENGINEER.password);
    
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    await expect(page.locator('text=engineer@irongate.com')).toBeVisible();
    
    // Admin Panel should NOT be visible
    await expect(page.locator('text=Admin Panel')).not.toBeVisible();
  });

  test('AUTH-UI-002: Login with invalid email', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="email"]', 'nonexistent@example.com');
    await page.fill('input[type="password"]', 'AnyPassword123');
    await page.click('button:has-text("Sign In")');
    
    // Should show error message
    await expect(page.locator('text=/Invalid.*password/i')).toBeVisible();
    
    // Should remain on login page
    await expect(page).toHaveURL('/');
    
    // No token stored
    const token = await getAuthToken(page);
    expect(token).toBeNull();
  });

  test('AUTH-UI-003: Login with invalid password', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="email"]', TEST_USERS.SUPER_ADMIN.email);
    await page.fill('input[type="password"]', 'WrongPassword123');
    await page.click('button:has-text("Sign In")');
    
    await expect(page.locator('text=/Invalid.*password/i')).toBeVisible();
    await expect(page).toHaveURL('/');
    
    const token = await getAuthToken(page);
    expect(token).toBeNull();
  });

  test('AUTH-UI-008: User logout', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    // Verify logged in
    expect(await isLoggedIn(page)).toBe(true);
    
    // Logout
    await page.click('button:has-text("Sign Out")');
    
    // Verify back on login page
    await expect(page.locator('input[type="email"]')).toBeVisible();
    
    // Verify token removed
    const token = await getAuthToken(page);
    expect(token).toBeNull();
  });

  test('AUTH-UI-009: Session persistence after page refresh', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    const tokenBefore = await getAuthToken(page);
    
    // Refresh page
    await page.reload();
    
    // User should still be logged in
    const tokenAfter = await getAuthToken(page);
    expect(tokenAfter).toBe(tokenBefore);
    
    // Should not redirect to login
    await expect(page).not.toHaveURL('/');
  });

  test('AUTH-UI-011: Protected route access without authentication', async ({ page }) => {
    // Try to access admin panel directly
    await page.goto('/admin-panel');
    
    // Should redirect to login
    await expect(page).toHaveURL('/');
  });
});
