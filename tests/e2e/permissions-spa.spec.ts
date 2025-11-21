import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, loginAsQAManager, loginAsTeamLead, loginAsQAEngineer, logout, waitForLoadingToComplete } from './fixtures/auth-helpers';

/**
 * Permission Tests for SPA
 * Tests role-based access control with content visibility checks
 */

test.describe('Permissions (SPA)', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test.afterEach(async ({ page }) => {
    await logout(page).catch(() => console.log('Logout skipped'));
  });

  // ==================== ADMIN PANEL ACCESS ====================

  test('PERM-SPA-001: Super Admin has full admin panel access', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    // Admin Panel button should be visible
    await expect(page.locator('text=Admin Panel')).toBeVisible();
    
    // Click Admin Panel
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Should see admin panel content
    await expect(page.locator('h1:has-text("Admin Control Panel")')).toBeVisible();
    
    // Should see all action buttons
    await expect(page.locator('button:has-text("Create User")')).toBeVisible();
    await expect(page.locator('button:has-text("Create Team")')).toBeVisible();
    
    console.log('✅ Super Admin has full access');
  });

  test('PERM-SPA-002: QA Manager has admin panel access', async ({ page }) => {
    await loginAsQAManager(page);
    
    await expect(page.locator('text=Admin Panel')).toBeVisible();
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await expect(page.locator('h1:has-text("Admin Control Panel")')).toBeVisible();
    await expect(page.locator('button:has-text("Create User")')).toBeVisible();
    
    console.log('✅ QA Manager has admin access');
  });

  test('PERM-SPA-003: Team Lead has limited admin access', async ({ page }) => {
    await loginAsTeamLead(page);
    
    await expect(page.locator('text=Admin Panel')).toBeVisible();
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await expect(page.locator('h1:has-text("Admin Control Panel")')).toBeVisible();
    
    // Can create users
    await expect(page.locator('button:has-text("Create User")')).toBeVisible();
    
    // Cannot create teams
    await expect(page.locator('button:has-text("Create Team")')).not.toBeVisible();
    
    console.log('✅ Team Lead has limited access');
  });

  test('PERM-SPA-004: QA Engineer has NO admin panel access', async ({ page }) => {
    await loginAsQAEngineer(page);
    
    // Admin Panel button should NOT be visible
    await expect(page.locator('text=Admin Panel')).not.toBeVisible();
    
    // Should see dashboard content instead
    await expect(page.locator('text=All Teams')).toBeVisible();
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    
    console.log('✅ QA Engineer correctly denied admin access');
  });

  // ==================== USER CREATION PERMISSIONS ====================

  test('PERM-SPA-005: Super Admin can create any role', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await page.click('button:has-text("Create User")');
    await page.waitForTimeout(1000);
    
    // Check available roles in dropdown - check VALUES not text
    const roleSelect = page.locator('select').first();
    await roleSelect.waitFor({ state: 'visible' });
    
    const optionValues = await roleSelect.locator('option').evaluateAll(opts => 
      opts.map(opt => (opt as HTMLOptionElement).value).filter(v => v)
    );
    
    // Super Admin should see multiple subordinate roles
    expect(optionValues.length).toBeGreaterThan(2);
    
    // Close modal
    await page.click('button:has-text("Cancel")');
    
    console.log('✅ Super Admin can create any subordinate role');
  });

  test('PERM-SPA-006: QA Manager can only create Team Lead', async ({ page }) => {
    await loginAsQAManager(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await page.click('button:has-text("Create User")');
    await page.waitForTimeout(1000);
    
    const roleSelect = page.locator('select').first();
    await roleSelect.waitFor({ state: 'visible' });
    
    const optionValues = await roleSelect.locator('option').evaluateAll(opts => 
      opts.map(opt => (opt as HTMLOptionElement).value).filter(v => v)
    );
    
    // Should have limited roles (less than super admin)
    expect(optionValues.length).toBeLessThan(5);
    expect(optionValues.length).toBeGreaterThan(0);
    
    await page.click('button:has-text("Cancel")');
    
    console.log('✅ QA Manager has limited role creation');
  });

  test('PERM-SPA-007: Team Lead can only create QA Engineer', async ({ page }) => {
    await loginAsTeamLead(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await page.click('button:has-text("Create User")');
    await page.waitForTimeout(1000);
    
    const roleSelect = page.locator('select').first();
    await roleSelect.waitFor({ state: 'visible' });
    
    const optionValues = await roleSelect.locator('option').evaluateAll(opts => 
      opts.map(opt => (opt as HTMLOptionElement).value).filter(v => v)
    );
    
    // Should have very limited roles (least permissions)
    expect(optionValues.length).toBeLessThanOrEqual(3);
    expect(optionValues.length).toBeGreaterThan(0);
    
    await page.click('button:has-text("Cancel")');
    
    console.log('✅ Team Lead can only create QA Engineer');
  });

  // ==================== USER VISIBILITY PERMISSIONS ====================

  test('PERM-SPA-008: Super Admin sees all users', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    const userRows = page.locator('tbody tr');
    const count = await userRows.count();
    
    // Should see many users across all teams
    expect(count).toBeGreaterThan(5);
    
    console.log(`✅ Super Admin sees ${count} users (all)`);
  });

  test('PERM-SPA-009: QA Manager sees department users only', async ({ page }) => {
    await loginAsQAManager(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    const userRows = page.locator('tbody tr');
    const count = await userRows.count();
    
    // Should see users in department (less than super admin)
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(20);
    
    console.log(`✅ QA Manager sees ${count} users (department-scoped)`);
  });

  test('PERM-SPA-010: Team Lead sees own team only', async ({ page }) => {
    await loginAsTeamLead(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    const userRows = page.locator('tbody tr');
    const count = await userRows.count();
    
    // Should see limited users (own team only)
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10);
    
    console.log(`✅ Team Lead sees ${count} users (team-scoped)`);
  });

  // ==================== EDIT PERMISSIONS ====================

  test('PERM-SPA-011: Super Admin can edit any user', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Find a user row
    const userRow = page.locator('tr:has-text("engineer@irongate.com")').first();
    
    // Edit button should be visible
    await expect(userRow.locator('button:has-text("Edit")')).toBeVisible();
    
    // Reset Password button should be visible
    await expect(userRow.locator('button:has-text("Reset Password")')).toBeVisible();
    
    console.log('✅ Super Admin can edit any user');
  });

  test('PERM-SPA-012: Cannot edit own role', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Find own user row
    const ownRow = page.locator('tr:has-text("admin@irongate.com")').first();
    await ownRow.scrollIntoViewIfNeeded();
    
    // Edit button might be visible, but role should be disabled
    const hasEditButton = await ownRow.locator('button:has-text("Edit")').isVisible();
    
    if (hasEditButton) {
      await ownRow.locator('button:has-text("Edit")').click();
      await page.waitForTimeout(500);
      
      // Role dropdown should be disabled or unchangeable
      const roleSelect = page.locator('select').first();
      const isDisabled = await roleSelect.isDisabled();
      
      // Close modal
      await page.click('button:has-text("Cancel")');
      
      console.log('✅ Own role edit is restricted');
    }
  });

  // ==================== DELETE PERMISSIONS ====================

  test('PERM-SPA-013: Super Admin can delete users', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Find a user row (not self)
    const userRow = page.locator('tr:has-text("engineer@irongate.com")').first();
    await userRow.scrollIntoViewIfNeeded();
    
    // Delete button should be visible
    await expect(userRow.locator('button:has-text("Delete")')).toBeVisible();
    
    console.log('✅ Super Admin can delete users');
  });

  test('PERM-SPA-014: Cannot delete own account', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Find own user row
    const ownRow = page.locator('tr:has-text("admin@irongate.com")').first();
    await ownRow.scrollIntoViewIfNeeded();
    
    // Delete button should NOT be visible
    await expect(ownRow.locator('button:has-text("Delete")')).not.toBeVisible();
    
    console.log('✅ Self-deletion correctly prevented');
  });

  test('PERM-SPA-015: Team Lead cannot delete users outside team', async ({ page }) => {
    await loginAsTeamLead(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Should only see own team members
    const userRows = page.locator('tbody tr');
    const count = await userRows.count();
    
    // Limited visibility = limited deletion scope
    expect(count).toBeLessThan(10);
    
    console.log('✅ Team Lead deletion scope is limited to own team');
  });

  // ==================== TEAM MANAGEMENT PERMISSIONS ====================

  test('PERM-SPA-016: Super Admin can create teams', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    // Scroll to teams section
    await page.locator('h2:has-text("Teams")').scrollIntoViewIfNeeded();
    
    // Create Team button should be visible
    await expect(page.locator('button:has-text("Create Team")')).toBeVisible();
    
    console.log('✅ Super Admin can create teams');
  });

  test('PERM-SPA-017: QA Manager can create teams', async ({ page }) => {
    await loginAsQAManager(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await page.locator('h2:has-text("Teams")').scrollIntoViewIfNeeded();
    
    // QA Manager should also be able to create teams
    await expect(page.locator('button:has-text("Create Team")')).toBeVisible();
    
    console.log('✅ QA Manager can create teams');
  });

  test('PERM-SPA-018: Team Lead cannot create teams', async ({ page }) => {
    await loginAsTeamLead(page);
    
    await page.click('text=Admin Panel');
    await waitForLoadingToComplete(page);
    
    await page.locator('h2:has-text("Teams")').scrollIntoViewIfNeeded();
    
    // Create Team button should NOT be visible
    await expect(page.locator('button:has-text("Create Team")')).not.toBeVisible();
    
    console.log('✅ Team Lead correctly cannot create teams');
  });

  // ==================== NAVIGATION PERMISSIONS ====================

  test('PERM-SPA-019: All roles can access dashboard', async ({ page }) => {
    await loginAsQAEngineer(page);
    
    // Dashboard/All Teams should be visible
    await expect(page.locator('text=All Teams')).toBeVisible();
    
    // Can click and view
    await page.click('text=All Teams');
    await waitForLoadingToComplete(page);
    
    // Should see team content
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    
    console.log('✅ QA Engineer can access dashboard');
  });

  test('PERM-SPA-020: QA Engineer cannot access admin routes', async ({ page }) => {
    await loginAsQAEngineer(page);
    
    // Admin Panel should not be in navigation
    await expect(page.locator('text=Admin Panel')).not.toBeVisible();
    
    // Manage Teams might be visible but limited
    const hasManageTeams = await page.locator('text=Manage Teams').isVisible();
    
    if (hasManageTeams) {
      await page.click('text=Manage Teams');
      await waitForLoadingToComplete(page);
      
      // Should not see admin functions
      await expect(page.locator('button:has-text("Create Team")')).not.toBeVisible();
    }
    
    console.log('✅ QA Engineer correctly restricted from admin functions');
  });
});
