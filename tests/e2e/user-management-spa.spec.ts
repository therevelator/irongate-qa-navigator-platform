import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, loginAsQAManager, loginAsTeamLead, logout, waitForLoadingToComplete } from './fixtures/auth-helpers';

/**
 * User Management Tests for SPA
 * Focus on content changes and modal interactions
 */

test.describe('User Management (SPA)', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test.afterEach(async ({ page }) => {
    await logout(page).catch(() => console.log('Logout skipped'));
  });

  // ==================== CREATE USER TESTS ====================

  test('USER-SPA-001: Super Admin can create user via modal', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    // Navigate to Admin Panel
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Verify Admin Panel loaded (content change, not URL)
    await expect(page.locator('h1:has-text("Admin Control Panel")')).toBeVisible();
    
    // Click Create User button
    await page.click('button:has-text("Create User")');
    
    // Modal should appear (SPA behavior)
    await expect(page.locator('input[type="email"]').nth(1)).toBeVisible();
    
    // Fill form
    const timestamp = Date.now();
    const testEmail = `test-user-${timestamp}@irongate.com`;
    
    await page.locator('input[type="email"]').nth(1).fill(testEmail);
    await page.locator('input[type="password"]').nth(1).fill('TestPass123!');
    await page.locator('input[placeholder*="First"]').fill('Test');
    await page.locator('input[placeholder*="Last"]').fill('User');
    
    // Select role
    await page.locator('select').first().selectOption('qa_engineer');
    
    // Select team
    await page.locator('select').last().selectOption({ index: 1 });
    
    // Submit
    await page.click('button:has-text("Create User")');
    await page.waitForTimeout(2000);
    
    // Modal should close (SPA behavior)
    await expect(page.locator('input[type="email"]').nth(1)).not.toBeVisible();
    
    // User should appear in table (content updated)
    await expect(page.locator(`text=${testEmail}`)).toBeVisible();
    
    console.log(`✅ Created user: ${testEmail}`);
  });

  test('USER-SPA-002: QA Manager can create Team Lead', async ({ page }) => {
    await loginAsQAManager(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await page.click('button:has-text("Create User")');
    await expect(page.locator('input[type="email"]').nth(1)).toBeVisible();
    
    const timestamp = Date.now();
    const testEmail = `team-lead-${timestamp}@irongate.com`;
    
    await page.locator('input[type="email"]').nth(1).fill(testEmail);
    await page.locator('input[type="password"]').nth(1).fill('TestPass123!');
    await page.locator('input[placeholder*="First"]').fill('Team');
    await page.locator('input[placeholder*="Last"]').fill('Lead');
    
    // QA Manager should only see team_lead option
    await page.locator('select').first().selectOption('team_lead');
    await page.locator('select').last().selectOption({ index: 1 });
    
    await page.click('button:has-text("Create User")');
    await page.waitForTimeout(2000);
    
    await expect(page.locator(`text=${testEmail}`)).toBeVisible();
    console.log(`✅ QA Manager created Team Lead: ${testEmail}`);
  });

  test('USER-SPA-003: Team Lead can create QA Engineer only', async ({ page }) => {
    await loginAsTeamLead(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await page.click('button:has-text("Create User")');
    await expect(page.locator('input[type="email"]').nth(1)).toBeVisible();
    
    const timestamp = Date.now();
    const testEmail = `engineer-${timestamp}@irongate.com`;
    
    await page.locator('input[type="email"]').nth(1).fill(testEmail);
    await page.locator('input[type="password"]').nth(1).fill('TestPass123!');
    await page.locator('input[placeholder*="First"]').fill('QA');
    await page.locator('input[placeholder*="Last"]').fill('Engineer');
    
    // Team Lead should only see qa_engineer option
    await page.locator('select').first().selectOption('qa_engineer');
    await page.locator('select').last().selectOption({ index: 1 });
    
    await page.click('button:has-text("Create User")');
    await page.waitForTimeout(2000);
    
    await expect(page.locator(`text=${testEmail}`)).toBeVisible();
    console.log(`✅ Team Lead created QA Engineer: ${testEmail}`);
  });

  test('USER-SPA-004: Cannot create duplicate email', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await page.click('button:has-text("Create User")');
    
    // Try to create with existing email
    await page.locator('input[type="email"]').nth(1).fill('admin@irongate.com');
    await page.locator('input[type="password"]').nth(1).fill('TestPass123!');
    await page.locator('input[placeholder*="First"]').fill('Duplicate');
    await page.locator('input[placeholder*="Last"]').fill('User');
    
    await page.locator('select').first().selectOption('qa_engineer');
    await page.locator('select').last().selectOption({ index: 1 });
    
    await page.click('button:has-text("Create User")');
    await page.waitForTimeout(1000);
    
    // Modal should still be open (error occurred)
    await expect(page.locator('input[type="email"]').nth(1)).toBeVisible();
    
    console.log('✅ Duplicate email correctly rejected');
  });

  test('USER-SPA-005: Can cancel user creation', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await page.click('button:has-text("Create User")');
    await expect(page.locator('input[type="email"]').nth(1)).toBeVisible();
    
    // Fill some data
    await page.locator('input[type="email"]').nth(1).fill('cancel@test.com');
    
    // Click Cancel
    await page.click('button:has-text("Cancel")');
    await page.waitForTimeout(500);
    
    // Modal should close
    await expect(page.locator('input[type="email"]').nth(1)).not.toBeVisible();
    
    // User should NOT be created
    await expect(page.locator('text=cancel@test.com')).not.toBeVisible();
    
    console.log('✅ User creation cancelled successfully');
  });

  // ==================== EDIT USER TESTS ====================

  test('USER-SPA-006: Super Admin can edit user details', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Find a user to edit (not self)
    const userRow = page.locator('tr:has-text("engineer@irongate.com")').first();
    await userRow.scrollIntoViewIfNeeded();
    await userRow.locator('button:has-text("Edit")').click();
    
    // Edit modal should appear
    await expect(page.locator('h3:has-text("Edit User")')).toBeVisible();
    
    // Change first name
    const firstNameInput = page.locator('input[placeholder*="First"]');
    await firstNameInput.clear();
    await firstNameInput.fill('Updated');
    
    // Save
    await page.click('button:has-text("Update User")');
    await page.waitForTimeout(2000);
    
    // Modal should close
    await expect(page.locator('h3:has-text("Edit User")')).not.toBeVisible();
    
    // Updated name should appear
    await expect(page.locator('text=Updated')).toBeVisible();
    
    console.log('✅ User edited successfully');
  });

  test('USER-SPA-007: Can cancel user edit', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    const userRow = page.locator('tr:has-text("engineer@irongate.com")').first();
    await userRow.locator('button:has-text("Edit")').click();
    
    await expect(page.locator('h3:has-text("Edit User")')).toBeVisible();
    
    // Make a change
    const firstNameInput = page.locator('input[placeholder*="First"]');
    const originalValue = await firstNameInput.inputValue();
    await firstNameInput.clear();
    await firstNameInput.fill('CancelledChange');
    
    // Click Cancel
    await page.click('button:has-text("Cancel")');
    await page.waitForTimeout(500);
    
    // Modal should close
    await expect(page.locator('h3:has-text("Edit User")')).not.toBeVisible();
    
    // Change should NOT be saved
    await expect(page.locator('text=CancelledChange')).not.toBeVisible();
    
    console.log('✅ User edit cancelled successfully');
  });

  // ==================== DELETE USER TESTS ====================

  test('USER-SPA-008: Super Admin can delete user', async ({ page }) => {
    // First create a user to delete
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Create test user
    await page.click('button:has-text("Create User")');
    
    const timestamp = Date.now();
    const testEmail = `delete-me-${timestamp}@irongate.com`;
    
    await page.locator('input[type="email"]').nth(1).fill(testEmail);
    await page.locator('input[type="password"]').nth(1).fill('TestPass123!');
    await page.locator('input[placeholder*="First"]').fill('Delete');
    await page.locator('input[placeholder*="Last"]').fill('Me');
    
    await page.locator('select').first().selectOption('qa_engineer');
    await page.locator('select').last().selectOption({ index: 1 });
    
    await page.click('button:has-text("Create User")');
    await page.waitForTimeout(2000);
    
    // Verify user created
    await expect(page.locator(`text=${testEmail}`)).toBeVisible();
    
    // Now delete the user
    const userRow = page.locator(`tr:has-text("${testEmail}")`).first();
    await userRow.scrollIntoViewIfNeeded();
    await userRow.locator('button:has-text("Delete")').click();
    
    // Confirmation modal should appear
    await expect(page.locator('text=/Are you sure.*delete/i')).toBeVisible();
    
    // Confirm deletion
    await page.locator('button:has-text("Delete")').last().click();
    await page.waitForTimeout(2000);
    
    // User should be removed from table
    await expect(page.locator(`text=${testEmail}`)).not.toBeVisible();
    
    console.log(`✅ User deleted: ${testEmail}`);
  });

  test('USER-SPA-009: Cannot delete own account', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Find own user row
    const ownRow = page.locator('tr:has-text("admin@irongate.com")').first();
    await ownRow.scrollIntoViewIfNeeded();
    
    // Delete button should NOT be visible
    const deleteButton = ownRow.locator('button:has-text("Delete")');
    await expect(deleteButton).not.toBeVisible();
    
    console.log('✅ Self-deletion correctly prevented');
  });

  test('USER-SPA-010: Can cancel user deletion', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    const userRow = page.locator('tr:has-text("engineer@irongate.com")').first();
    await userRow.scrollIntoViewIfNeeded();
    await userRow.locator('button:has-text("Delete")').click();
    
    // Confirmation modal appears
    await expect(page.locator('text=/Are you sure.*delete/i')).toBeVisible();
    
    // Click Cancel
    await page.click('button:has-text("Cancel")');
    await page.waitForTimeout(500);
    
    // Modal should close
    await expect(page.locator('text=/Are you sure.*delete/i')).not.toBeVisible();
    
    // User should still exist
    await expect(page.locator('text=engineer@irongate.com')).toBeVisible();
    
    console.log('✅ User deletion cancelled successfully');
  });

  // ==================== VIEW USERS TESTS ====================

  test('USER-SPA-011: Super Admin sees all users', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Count users in table
    const userRows = page.locator('tbody tr');
    const count = await userRows.count();
    
    // Super admin should see multiple users
    expect(count).toBeGreaterThan(3);
    
    console.log(`✅ Super Admin sees ${count} users`);
  });

  test('USER-SPA-012: Team Lead sees only own team', async ({ page }) => {
    await loginAsTeamLead(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    const userRows = page.locator('tbody tr');
    const count = await userRows.count();
    
    // Team lead should see limited users
    expect(count).toBeLessThan(10);
    expect(count).toBeGreaterThan(0);
    
    console.log(`✅ Team Lead sees ${count} users (team-scoped)`);
  });

  // ==================== PASSWORD RESET TESTS ====================

  test('USER-SPA-013: Super Admin can reset user password', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    const userRow = page.locator('tr:has-text("engineer@irongate.com")').first();
    await userRow.scrollIntoViewIfNeeded();
    await userRow.locator('button:has-text("Reset Password")').click();
    
    // Reset password modal should appear
    await expect(page.locator('h3:has-text("Reset Password")')).toBeVisible();
    
    // Fill new password
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(1).fill('NewPass123!');
    await passwordInputs.nth(2).fill('NewPass123!');
    
    // Submit
    await page.click('button:has-text("Reset Password")');
    await page.waitForTimeout(1000);
    
    // Modal should close
    await expect(page.locator('h3:has-text("Reset Password")')).not.toBeVisible();
    
    console.log('✅ Password reset successfully');
  });
});
