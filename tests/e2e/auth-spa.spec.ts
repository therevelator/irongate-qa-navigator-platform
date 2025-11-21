import { test, expect } from '@playwright/test';
import { TEST_USERS } from './fixtures/test-users';
import { login, loginAsSuperAdmin, loginAsQAManager, loginAsTeamLead, loginAsQAEngineer, logout, getAuthToken, isLoggedIn } from './fixtures/auth-helpers';

/**
 * Authentication Tests for SPA
 * Tests focus on content changes, not URL changes
 */

test.describe('Authentication (SPA)', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test.afterEach(async ({ page }) => {
    await logout(page).catch(() => {
      console.log('Logout skipped or already logged out');
    });
  });

  // ==================== SUCCESSFUL LOGIN TESTS ====================

  test('AUTH-SPA-001: Super Admin login shows dashboard with full access', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    // Verify JWT token stored
    const token = await getAuthToken(page);
    expect(token).not.toBeNull();
    expect(token?.length).toBeGreaterThan(20);
    
    // Verify dashboard elements visible
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    await expect(page.locator('text=admin@irongate.com')).toBeVisible();
    await expect(page.locator('text=Admin User')).toBeVisible();
    
    // Verify full access elements
    await expect(page.locator('text=Admin Panel')).toBeVisible();
    await expect(page.locator('text=All Teams')).toBeVisible();
    
    // Verify login form is NOT visible
    await expect(page.locator('input[type="email"]')).not.toBeVisible();
    await expect(page.locator('input[type="password"]')).not.toBeVisible();
  });

  test('AUTH-SPA-002: QA Manager login shows admin access', async ({ page }) => {
    await loginAsQAManager(page);
    
    const token = await getAuthToken(page);
    expect(token).not.toBeNull();
    
    // Verify logged in
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    await expect(page.locator('text=manager@irongate.com')).toBeVisible();
    
    // QA Manager should have admin panel access
    await expect(page.locator('text=Admin Panel')).toBeVisible();
    
    // Login form should be hidden
    await expect(page.locator('button:has-text("Sign In")')).not.toBeVisible();
  });

  test('AUTH-SPA-003: Team Lead login shows limited admin access', async ({ page }) => {
    await loginAsTeamLead(page);
    
    const token = await getAuthToken(page);
    expect(token).not.toBeNull();
    
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    await expect(page.locator('text=lead@irongate.com')).toBeVisible();
    await expect(page.locator('text=Admin Panel')).toBeVisible();
  });

  test('AUTH-SPA-004: QA Engineer login shows NO admin access', async ({ page }) => {
    await loginAsQAEngineer(page);
    
    const token = await getAuthToken(page);
    expect(token).not.toBeNull();
    
    // Verify logged in
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    await expect(page.locator('text=engineer@irongate.com')).toBeVisible();
    
    // Admin Panel should NOT be visible
    await expect(page.locator('text=Admin Panel')).not.toBeVisible();
    
    // Should see dashboard content
    await expect(page.locator('text=All Teams')).toBeVisible();
  });

  test('AUTH-SPA-005: Viewer login shows read-only access', async ({ page }) => {
    await login(page, TEST_USERS.VIEWER.email, TEST_USERS.VIEWER.password);
    
    const token = await getAuthToken(page);
    expect(token).not.toBeNull();
    
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    await expect(page.locator('text=viewer@irongate.com')).toBeVisible();
    
    // No admin access
    await expect(page.locator('text=Admin Panel')).not.toBeVisible();
  });

  // ==================== FAILED LOGIN TESTS ====================

  test('AUTH-SPA-006: Invalid email shows error, stays on login', async ({ page }) => {
    await page.goto('/');
    
    await page.fill('input[type="email"]', 'nonexistent@example.com');
    await page.fill('input[type="password"]', 'AnyPassword123');
    await page.click('button:has-text("Sign In")');
    
    await page.waitForTimeout(2000);
    
    // Should still see login form
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Sign In")')).toBeVisible();
    
    // Should NOT see dashboard
    await expect(page.locator('button:has-text("Sign Out")')).not.toBeVisible();
    
    // No token stored
    const token = await getAuthToken(page);
    expect(token).toBeNull();
  });

  test('AUTH-SPA-007: Invalid password shows error, stays on login', async ({ page }) => {
    await page.goto('/');
    
    await page.fill('input[type="email"]', TEST_USERS.SUPER_ADMIN.email);
    await page.fill('input[type="password"]', 'WrongPassword123');
    await page.click('button:has-text("Sign In")');
    
    await page.waitForTimeout(2000);
    
    // Should still see login form
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('button:has-text("Sign In")')).toBeVisible();
    
    // No dashboard
    await expect(page.locator('button:has-text("Sign Out")')).not.toBeVisible();
    
    const token = await getAuthToken(page);
    expect(token).toBeNull();
  });

  test('AUTH-SPA-008: Empty credentials shows validation error', async ({ page }) => {
    await page.goto('/');
    
    // Try to submit without filling
    await page.click('button:has-text("Sign In")');
    
    await page.waitForTimeout(1000);
    
    // Should still be on login page
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    
    const token = await getAuthToken(page);
    expect(token).toBeNull();
  });

  // ==================== LOGOUT TESTS ====================

  test('AUTH-SPA-009: Logout removes token and shows login form', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    // Verify logged in
    expect(await isLoggedIn(page)).toBe(true);
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    
    // Logout
    await page.click('button:has-text("Sign Out")');
    await page.waitForTimeout(1000);
    
    // Should see login form again
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Sign In")')).toBeVisible();
    
    // Dashboard should be hidden
    await expect(page.locator('button:has-text("Sign Out")')).not.toBeVisible();
    await expect(page.locator('text=Admin Panel')).not.toBeVisible();
    
    // Token should be removed
    const token = await getAuthToken(page);
    expect(token).toBeNull();
    expect(await isLoggedIn(page)).toBe(false);
  });

  // ==================== SESSION PERSISTENCE ====================

  test('AUTH-SPA-010: Session persists after page refresh', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    const tokenBefore = await getAuthToken(page);
    expect(tokenBefore).not.toBeNull();
    
    // Refresh page
    await page.reload();
    await page.waitForTimeout(2000);
    
    // Should still be logged in
    const tokenAfter = await getAuthToken(page);
    expect(tokenAfter).toBe(tokenBefore);
    
    // Dashboard should still be visible
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    await expect(page.locator('text=admin@irongate.com')).toBeVisible();
    
    // Login form should NOT be visible
    await expect(page.locator('button:has-text("Sign In")')).not.toBeVisible();
  });

  test('AUTH-SPA-011: Can navigate between views while logged in', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    // Click on different navigation items
    await page.click('text=All Teams');
    await page.waitForTimeout(500);
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    
    // Navigate to Admin Panel
    await page.click('text=Admin Panel');
    await page.waitForTimeout(1000);
    await expect(page.locator('h1:has-text("Admin Control Panel")')).toBeVisible();
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    
    // Token should persist
    const token = await getAuthToken(page);
    expect(token).not.toBeNull();
  });
});
