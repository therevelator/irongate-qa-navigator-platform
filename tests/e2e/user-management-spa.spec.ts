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
    await expect(page.getByTestId('create-user-email')).toBeVisible();
    
    // Fill form
    const timestamp = Date.now();
    const testEmail = `test-user-${timestamp}@irongate.com`;
    
    await page.getByTestId('create-user-email').fill(testEmail);
    await page.getByTestId('create-user-password').fill('TestPass123!');
    await page.getByTestId('create-user-firstname').fill('Test');
    await page.getByTestId('create-user-lastname').fill('User');
    
    // Select role
    await page.getByTestId('create-user-role').selectOption('qa_engineer');
    
    // Select team
    await page.getByTestId('create-user-team').selectOption({ index: 1 });
    
    // Submit
    await page.click('button[type="submit"]:has-text("Create User")');
    await page.waitForTimeout(2000);
    
    // Modal should close (SPA behavior)
    await expect(page.locator('input[type="email"]').nth(1)).not.toBeVisible();
    
    // User should appear in table (content updated)
    await expect(page.locator(`text=${testEmail}`)).toBeVisible();
    
    console.log(`✅ Created user: ${testEmail}`);
    
    // Cleanup: Delete the test user
    const userRow = page.locator(`tr:has-text("${testEmail}")`).first();
    await userRow.scrollIntoViewIfNeeded();
    await userRow.locator('button:has-text("Delete")').click();
    await page.locator('button:has-text("Delete")').last().click();
    await page.waitForTimeout(1000);
    await expect(page.locator(`text=${testEmail}`)).not.toBeVisible();
    console.log(`🧹 Cleaned up user: ${testEmail}`);
  });

  test('USER-SPA-002: QA Manager can create Team Lead', async ({ page }) => {
    await loginAsQAManager(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await page.click('button:has-text("Create User")');
    await expect(page.getByTestId('create-user-email')).toBeVisible();
    
    const timestamp = Date.now();
    const testEmail = `team-lead-${timestamp}@irongate.com`;
    
    await page.getByTestId('create-user-email').fill(testEmail);
    await page.getByTestId('create-user-password').fill('TestPass123!');
    await page.getByTestId('create-user-firstname').fill('Team');
    await page.getByTestId('create-user-lastname').fill('Lead');
    
    // QA Manager should see team_lead, qa_engineer, viewer options
    await page.getByTestId('create-user-role').selectOption('team_lead');
    await page.getByTestId('create-user-team').selectOption({ index: 1 });
    
    await page.click('button[type="submit"]:has-text("Create User")');
    await page.waitForTimeout(2000);
    
    await expect(page.locator(`text=${testEmail}`)).toBeVisible();
    console.log(`✅ QA Manager created Team Lead: ${testEmail}`);
    
    // Cleanup: Delete the test user
    const userRow = page.locator(`tr:has-text("${testEmail}")`).first();
    await userRow.scrollIntoViewIfNeeded();
    await userRow.locator('button:has-text("Delete")').click();
    await page.locator('button:has-text("Delete")').last().click();
    await page.waitForTimeout(1000);
    await expect(page.locator(`text=${testEmail}`)).not.toBeVisible();
    console.log(`🧹 Cleaned up user: ${testEmail}`);
  });

  test('USER-SPA-003: Team Lead can create QA Engineer only', async ({ page }) => {
    await loginAsTeamLead(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await page.click('button:has-text("Create User")');
    await expect(page.getByTestId('create-user-email')).toBeVisible();
    
    const timestamp = Date.now();
    const testEmail = `engineer-${timestamp}@irongate.com`;
    
    await page.getByTestId('create-user-email').fill(testEmail);
    await page.getByTestId('create-user-password').fill('TestPass123!');
    await page.getByTestId('create-user-firstname').fill('QA');
    await page.getByTestId('create-user-lastname').fill('Engineer');
    
    // Team Lead should see qa_engineer and viewer options
    await page.getByTestId('create-user-role').selectOption('qa_engineer');
    await page.getByTestId('create-user-team').selectOption({ index: 1 });
    
    await page.click('button[type="submit"]:has-text("Create User")');
    await page.waitForTimeout(2000);
    
    await expect(page.locator(`text=${testEmail}`)).toBeVisible();
    console.log(`✅ Team Lead created QA Engineer: ${testEmail}`);
    
    // Cleanup: Delete the test user
    const userRow = page.locator(`tr:has-text("${testEmail}")`).first();
    await userRow.scrollIntoViewIfNeeded();
    await userRow.locator('button:has-text("Delete")').click();
    await page.locator('button:has-text("Delete")').last().click();
    await page.waitForTimeout(1000);
    await expect(page.locator(`text=${testEmail}`)).not.toBeVisible();
    console.log(`🧹 Cleaned up user: ${testEmail}`);
  });

  test('USER-SPA-004: Cannot create duplicate email', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await page.click('button:has-text("Create User")');
    await expect(page.getByTestId('create-user-email')).toBeVisible();
    
    // Try to create with existing email
    await page.getByTestId('create-user-email').fill('admin@irongate.com');
    await page.getByTestId('create-user-password').fill('TestPass123!');
    await page.getByTestId('create-user-firstname').fill('Duplicate');
    await page.getByTestId('create-user-lastname').fill('User');
    
    await page.getByTestId('create-user-role').selectOption('qa_engineer');
    await page.getByTestId('create-user-team').selectOption({ index: 1 });
    
    await page.click('button[type="submit"]:has-text("Create User")');
    await page.waitForTimeout(1000);
    
    // Should show error toast
    await expect(page.locator('text=/already exists|duplicate/i')).toBeVisible({ timeout: 3000 });
    
    console.log('✅ Duplicate email correctly rejected');
  });

  test('USER-SPA-005: Can cancel user creation', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await page.click('button:has-text("Create User")');
    await expect(page.getByTestId('create-user-email')).toBeVisible();
    
    // Fill some data
    await page.getByTestId('create-user-email').fill('cancel@test.com');
    
    // Click Cancel
    await page.click('button:has-text("Cancel")');
    await page.waitForTimeout(500);
    
    // Modal should close
    await expect(page.getByTestId('create-user-email')).not.toBeVisible();
    
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
    await expect(page.getByTestId('edit-user-email')).toBeVisible();
    
    // Change first name
    await page.getByTestId('edit-user-firstname').clear();
    await page.getByTestId('edit-user-firstname').fill('Updated');
    
    // Save
    await page.click('button[type="submit"]:has-text("Update User")');
    await page.waitForTimeout(2000);
    
    // Modal should close
    await expect(page.getByTestId('edit-user-email')).not.toBeVisible();
    
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
    
    await expect(page.getByTestId('edit-user-email')).toBeVisible();
    
    // Make a change
    const originalValue = await page.getByTestId('edit-user-firstname').inputValue();
    await page.getByTestId('edit-user-firstname').clear();
    await page.getByTestId('edit-user-firstname').fill('CancelledChange');
    
    // Click Cancel
    await page.click('button:has-text("Cancel")');
    await page.waitForTimeout(500);
    
    // Modal should close
    await expect(page.getByTestId('edit-user-email')).not.toBeVisible();
    
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
    await expect(page.getByTestId('create-user-email')).toBeVisible();
    
    const timestamp = Date.now();
    const testEmail = `delete-me-${timestamp}@irongate.com`;
    
    await page.getByTestId('create-user-email').fill(testEmail);
    await page.getByTestId('create-user-password').fill('TestPass123!');
    await page.getByTestId('create-user-firstname').fill('Delete');
    await page.getByTestId('create-user-lastname').fill('Me');
    
    await page.getByTestId('create-user-role').selectOption('qa_engineer');
    await page.getByTestId('create-user-team').selectOption({ index: 1 });
    
    await page.click('button[type="submit"]:has-text("Create User")');
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
    await expect(page.getByTestId('reset-password-new')).toBeVisible();
    
    // Fill new password
    await page.getByTestId('reset-password-new').fill('NewPass123!');
    await page.getByTestId('reset-password-confirm').fill('NewPass123!');
    
    // Submit
    await page.click('button[type="submit"]:has-text("Reset Password")');
    await page.waitForTimeout(1000);
    
    // Modal should close
    await expect(page.getByTestId('reset-password-new')).not.toBeVisible();
    
    console.log('✅ Password reset successfully');
  });

  // ==================== TEAM MANAGEMENT TESTS ====================

  test('TEAM-SPA-001: Super Admin can create team', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Click Create Team button
    await page.click('button:has-text("Create Team")');
    await page.waitForTimeout(500);
    await expect(page.getByTestId('create-team-name')).toBeVisible();
    
    // Fill team form
    const timestamp = Date.now();
    const teamName = `Test Team ${timestamp}`;
    
    await page.getByTestId('create-team-name').fill(teamName);
    await page.getByTestId('create-team-description').fill('Test team description');
    await page.getByTestId('create-team-platform').selectOption('Web');
    
    // Submit
    await page.click('button[type="submit"]:has-text("Create Team")');
    await page.waitForTimeout(2000);
    
    // Team should appear in table
    await expect(page.locator(`text=${teamName}`)).toBeVisible();
    console.log(`✅ Created team: ${teamName}`);
    
    // Cleanup: Delete the test team (only if empty)
    const teamRow = page.locator(`tr:has-text("${teamName}")`).first();
    await teamRow.scrollIntoViewIfNeeded();
    await teamRow.click();
    await page.waitForTimeout(1000);
    
    // Check if team is empty, then we can delete
    const memberCount = await page.locator('text=/0.*Team Members|No team members/i').isVisible();
    if (memberCount) {
      await page.click('button:has-text("Back")');
      console.log(`🧹 Team ${teamName} is empty and can be deleted in future tests`);
    }
  });

  test('TEAM-SPA-002: QA Manager can create team in their department', async ({ page }) => {
    await loginAsQAManager(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Click Create Team button
    await page.click('button:has-text("Create Team")');
    await page.waitForTimeout(500);
    await expect(page.getByTestId('create-team-name')).toBeVisible();
    
    // Fill team form
    const timestamp = Date.now();
    const teamName = `QA Manager Team ${timestamp}`;
    
    await page.getByTestId('create-team-name').fill(teamName);
    await page.getByTestId('create-team-description').fill('Team created by QA Manager');
    await page.getByTestId('create-team-platform').selectOption('API');
    
    // Submit
    await page.click('button[type="submit"]:has-text("Create Team")');
    await page.waitForTimeout(2000);
    
    // Team should appear in table
    await expect(page.locator(`text=${teamName}`)).toBeVisible();
    console.log(`✅ QA Manager created team: ${teamName}`);
  });

  test('TEAM-SPA-003: Team Lead cannot create team', async ({ page }) => {
    await loginAsTeamLead(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Create Team button should NOT be visible
    await expect(page.locator('button:has-text("Create Team")')).not.toBeVisible();
    
    console.log('✅ Team Lead correctly cannot create teams');
  });

  test('TEAM-SPA-004: Can view team details', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Scroll to teams section and click on a team
    await page.locator('h2:has-text("Teams")').scrollIntoViewIfNeeded();
    const teamRow = page.locator('h2:has-text("Teams") ~ div table tr:has-text("Nebula")');
    await teamRow.click();
    await page.waitForTimeout(1000);
    
    // Should show team details
    await expect(page.locator('h1:has-text("Nebula")')).toBeVisible();
    await expect(page.locator('text=Team Members')).toBeVisible();
    
    // Go back
    await page.click('button:has-text("Back")');
    await page.waitForTimeout(500);
    
    console.log('✅ Team details viewed successfully');
  });

  test('TEAM-SPA-005: Cannot delete team with members', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Scroll to teams section and click on a team that has members (Nebula)
    await page.locator('h2:has-text("Teams")').scrollIntoViewIfNeeded();
    const teamRow = page.locator('h2:has-text("Teams") ~ div table tr:has-text("Nebula")');
    await teamRow.click();
    await page.waitForTimeout(1000);
    
    // Check if team has members
    const hasMembersText = await page.locator('text=/[1-9]\\d*.*Team Members/').isVisible();
    
    if (hasMembersText) {
      // Try to find delete button - should not exist or be disabled
      const deleteButton = page.locator('button:has-text("Delete Team")');
      const isVisible = await deleteButton.isVisible().catch(() => false);
      
      if (isVisible) {
        await deleteButton.click();
        // Should show error message
        await expect(page.locator('text=/cannot delete.*members|team has members/i')).toBeVisible({ timeout: 3000 });
      }
      
      console.log('✅ Cannot delete team with members');
    }
    
    await page.click('button:has-text("Back")');
  });
});
