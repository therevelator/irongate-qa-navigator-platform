import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, loginAsTeamLead, waitForLoadingToComplete, logout } from './fixtures/auth-helpers';

test.describe('User Management', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test.afterEach(async ({ page }) => {
    await logout(page).catch(() => {
      console.log('Logout failed or already logged out');
    });
  });

  test('USER-MGMT-UI-001: Create user as Super Admin', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    // Navigate to Admin Panel
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    await expect(page.locator('h1:has-text("Admin Control Panel")')).toBeVisible();
    
    // Click Create User
    await page.click('button:has-text("Create User")');
    
    // Fill form
    const timestamp = Date.now();
    const testEmail = `test-user-${timestamp}@irongate.com`;
    
    await page.fill('input[type="email"]', testEmail);
    await page.fill('input[type="password"]', 'TestPass123!');
    await page.fill('input[placeholder*="First"]', 'Test');
    await page.fill('input[placeholder*="Last"]', 'User');
    
    // Select role
    await page.selectOption('select', 'qa_engineer');
    
    // Select team (first available team)
    const teamSelect = page.locator('select').last();
    await teamSelect.selectOption({ index: 1 });
    
    // Submit
    await page.click('button:has-text("Create User")');
    
    // Verify success message
    await expect(page.locator('text=/created successfully/i')).toBeVisible({ timeout: 5000 });
    
    // Verify user appears in table
    await expect(page.locator(`text=${testEmail}`)).toBeVisible();
  });

  test('USER-MGMT-UI-006: Create user with duplicate email', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await page.click('button:has-text("Create User")');
    
    // Try to create user with existing email
    await page.fill('input[type="email"]', 'admin@irongate.com');
    await page.fill('input[type="password"]', 'TestPass123!');
    await page.fill('input[placeholder*="First"]', 'Test');
    await page.fill('input[placeholder*="Last"]', 'Duplicate');
    await page.selectOption('select', 'qa_engineer');
    
    const teamSelect = page.locator('select').last();
    await teamSelect.selectOption({ index: 1 });
    
    await page.click('button:has-text("Create User")');
    
    // Should show error
    await expect(page.locator('text=/already registered/i')).toBeVisible();
  });

  test('USER-MGMT-UI-014: Prevent self-deletion', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    
    // Find own user row (admin@irongate.com)
    const adminRow = page.locator('tr:has-text("admin@irongate.com")');
    
    // Delete button should NOT be visible for own account
    const deleteButton = adminRow.locator('button:has-text("Delete")');
    await expect(deleteButton).not.toBeVisible();
  });

  test('USER-MGMT-UI-016: Reset user password', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    
    // Find a user (not self)
    const userRow = page.locator('tr:has-text("engineer@irongate.com")').first();
    await userRow.locator('button:has-text("Reset Password")').click();
    
    // Fill password reset form
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.first().fill('NewPass123!');
    await passwordInputs.last().fill('NewPass123!');
    
    await page.click('button:has-text("Reset Password")');
    
    // Verify success
    await expect(page.locator('text=/reset successfully/i')).toBeVisible();
  });

  test('USER-MGMT-UI-009: Team Lead sees only own team users', async ({ page }) => {
    await loginAsTeamLead(page);
    
    await page.click('text=Admin Panel');
    
    // Should see users table
    await expect(page.locator('h2:has-text("Users")')).toBeVisible();
    
    // Count users - should be limited to own team
    const userRows = page.locator('tbody tr');
    const count = await userRows.count();
    
    // Team lead should see fewer users than super admin
    expect(count).toBeLessThan(10);
  });

  test('USER-MGMT-UI-019: View team members in team context', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    
    // Scroll to teams table
    await page.locator('h2:has-text("Teams")').scrollIntoViewIfNeeded();
    
    // Click on a team
    await page.locator('tr:has-text("Nebula")').first().click();
    
    // Should navigate to team detail page
    await expect(page.locator('h1:has-text("Nebula")')).toBeVisible();
    
    // Should show team members
    await expect(page.locator('h2:has-text("Team Members")')).toBeVisible();
  });
});
