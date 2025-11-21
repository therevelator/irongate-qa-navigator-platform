import { test, expect } from '@playwright/test';
import { loginAsSuperAdmin, loginAsQAManager, loginAsTeamLead, loginAsQAEngineer, logout } from './fixtures/auth-helpers';

test.describe('Role-Based Permissions', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test.afterEach(async ({ page }) => {
    await logout(page).catch(() => {
      console.log('Logout failed or already logged out');
    });
  });

  test('PERM-UI-001: Super Admin has full access', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    
    // Can see Create User button
    await expect(page.locator('button:has-text("Create User")')).toBeVisible();
    
    // Can see Create Team button
    await expect(page.locator('button:has-text("Create Team")')).toBeVisible();
    
    // Can see all users
    await expect(page.locator('h2:has-text("Users")')).toBeVisible();
    
    // Can see all teams
    await expect(page.locator('h2:has-text("Teams")')).toBeVisible();
  });

  test('PERM-UI-002: QA Manager has department scope', async ({ page }) => {
    await loginAsQAManager(page);
    
    await page.click('text=Admin Panel');
    
    // Can see Create User button
    await expect(page.locator('button:has-text("Create User")')).toBeVisible();
    
    // Can see Create Team button
    await expect(page.locator('button:has-text("Create Team")')).toBeVisible();
    
    // Can see users (department-scoped)
    const userRows = page.locator('tbody tr');
    const userCount = await userRows.count();
    expect(userCount).toBeGreaterThan(0);
  });

  test('PERM-UI-003: Team Lead has team scope', async ({ page }) => {
    await loginAsTeamLead(page);
    
    await page.click('text=Admin Panel');
    
    // Can see Create User button
    await expect(page.locator('button:has-text("Create User")')).toBeVisible();
    
    // CANNOT see Create Team button
    await expect(page.locator('button:has-text("Create Team")')).not.toBeVisible();
    
    // Can see users (team-scoped)
    const userRows = page.locator('tbody tr');
    const userCount = await userRows.count();
    expect(userCount).toBeGreaterThan(0);
    
    // Should see only one team
    const teamRows = page.locator('h2:has-text("Teams")').locator('..').locator('tbody tr');
    const teamCount = await teamRows.count();
    expect(teamCount).toBeLessThanOrEqual(1);
  });

  test('PERM-UI-004: QA Engineer has no admin access', async ({ page }) => {
    await loginAsQAEngineer(page);
    
    // Admin Panel menu should NOT be visible
    await expect(page.locator('text=Admin Panel')).not.toBeVisible();
  });

  test('PERM-UI-006: Super Admin can create any subordinate role', async ({ page }) => {
    await loginAsSuperAdmin(page);
    
    await page.click('text=Admin Panel');
    await page.click('button:has-text("Create User")');
    
    // Check available roles
    const roleSelect = page.locator('select').first();
    const options = await roleSelect.locator('option').allTextContents();
    
    // Should have: qa_manager, team_lead, qa_engineer, viewer
    expect(options).toContain('qa_manager');
    expect(options).toContain('team_lead');
    expect(options).toContain('qa_engineer');
    expect(options).toContain('viewer');
    
    // Should NOT have super_admin
    expect(options).not.toContain('super_admin');
  });

  test('PERM-UI-007: QA Manager can only create team_lead', async ({ page }) => {
    await loginAsQAManager(page);
    
    await page.click('text=Admin Panel');
    await page.click('button:has-text("Create User")');
    
    const roleSelect = page.locator('select').first();
    const options = await roleSelect.locator('option').allTextContents();
    
    // Should only have team_lead
    expect(options.filter(o => o.trim())).toHaveLength(2); // Including "Select role..."
    expect(options).toContain('team_lead');
  });

  test('PERM-UI-008: Team Lead can only create qa_engineer', async ({ page }) => {
    await loginAsTeamLead(page);
    
    await page.click('text=Admin Panel');
    await page.click('button:has-text("Create User")');
    
    const roleSelect = page.locator('select').first();
    const options = await roleSelect.locator('option').allTextContents();
    
    // Should only have qa_engineer
    expect(options.filter(o => o.trim())).toHaveLength(2); // Including "Select role..."
    expect(options).toContain('qa_engineer');
  });

  test('PERM-UI-019: Admin Panel visibility for authorized roles', async ({ page }) => {
    // Test Super Admin
    await loginAsSuperAdmin(page);
    await expect(page.locator('text=Admin Panel')).toBeVisible();
    await page.click('button:has-text("Logout")');
    
    // Test QA Manager
    await loginAsQAManager(page);
    await expect(page.locator('text=Admin Panel')).toBeVisible();
    await page.click('button:has-text("Logout")');
    
    // Test Team Lead
    await loginAsTeamLead(page);
    await expect(page.locator('text=Admin Panel')).toBeVisible();
  });

  test('PERM-UI-020: Admin Panel hidden for unauthorized roles', async ({ page }) => {
    await loginAsQAEngineer(page);
    
    // Admin Panel should NOT be visible
    await expect(page.locator('text=Admin Panel')).not.toBeVisible();
  });
});
