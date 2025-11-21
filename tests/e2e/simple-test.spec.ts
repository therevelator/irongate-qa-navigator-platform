import { test, expect } from '@playwright/test';

/**
 * Ultra-simple test to verify basic functionality
 */

test('Can load the login page', async ({ page }) => {
  await page.goto('http://localhost:5173');
  
  // Wait for page to be fully loaded
  await page.waitForLoadState('networkidle');
  
  // Check if we can see the login form
  const emailInput = await page.locator('input[type="email"]').isVisible();
  const passwordInput = await page.locator('input[type="password"]').isVisible();
  const signInButton = await page.locator('button:has-text("Sign In")').isVisible();
  
  expect(emailInput).toBe(true);
  expect(passwordInput).toBe(true);
  expect(signInButton).toBe(true);
  
  console.log('✅ Login page loaded successfully');
});

test('Can login with admin credentials', async ({ page }) => {
  // Go to login page
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
  
  // Fill credentials
  await page.locator('input[type="email"]').fill('admin@irongate.com');
  await page.locator('input[type="password"]').fill('demo123');
  
  // Click sign in
  await page.locator('button:has-text("Sign In")').click();
  
  // Wait for login to complete (give it plenty of time)
  await page.waitForTimeout(3000);
  
  // Check if we're logged in by looking for dashboard elements
  // The app doesn't change URL, it just shows different content
  const hasAdminPanel = await page.locator('text=Admin Panel').isVisible();
  const hasSignOut = await page.locator('button:has-text("Sign Out")').isVisible();
  const hasAllTeams = await page.locator('text=All Teams').isVisible();
  
  console.log('Has Admin Panel:', hasAdminPanel);
  console.log('Has Sign Out:', hasSignOut);
  console.log('Has All Teams:', hasAllTeams);
  
  // At least one of these should be visible
  expect(hasAdminPanel || hasSignOut || hasAllTeams).toBe(true);
  
  console.log('✅ Login successful');
});
