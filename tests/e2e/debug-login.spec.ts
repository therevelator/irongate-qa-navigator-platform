import { test, expect } from '@playwright/test';

/**
 * Simple debug test to check if login works
 * Run this first to diagnose login issues
 */

test.describe('Debug Login', () => {
  
  test('Simple login test - manual steps', async ({ page }) => {
    // Go to home page
    console.log('1. Navigating to home page...');
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    
    // Take screenshot of login page
    await page.screenshot({ path: 'test-results/01-login-page.png' });
    console.log('2. Login page loaded');
    
    // Wait for form
    console.log('3. Waiting for email input...');
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    
    // Fill email
    console.log('4. Filling email...');
    await page.fill('input[type="email"]', 'admin@irongate.com');
    
    // Fill password
    console.log('5. Filling password...');
    await page.fill('input[type="password"]', 'demo123');
    
    // Take screenshot before clicking
    await page.screenshot({ path: 'test-results/02-before-login.png' });
    
    // Click sign in
    console.log('6. Clicking Sign In...');
    await page.click('button:has-text("Sign In")');
    
    // Wait a bit
    console.log('7. Waiting for response...');
    await page.waitForTimeout(5000);
    
    // Take screenshot after clicking
    await page.screenshot({ path: 'test-results/03-after-login.png' });
    
    // Check current URL
    const currentUrl = page.url();
    console.log('8. Current URL:', currentUrl);
    
    // Check if we're still on login page
    if (currentUrl === 'http://localhost:5173/') {
      console.log('❌ Still on login page - login failed!');
      
      // Check for error messages
      const errorText = await page.textContent('body').catch(() => '') || '';
      console.log('Page content:', errorText.substring(0, 500));
      
      throw new Error('Login failed - still on login page');
    }
    
    // Check for dashboard elements
    console.log('9. Checking for dashboard elements...');
    const hasAllTeams = await page.locator('text=All Teams').isVisible().catch(() => false);
    const hasDashboard = await page.locator('text=Dashboard').isVisible().catch(() => false);
    
    console.log('Has "All Teams":', hasAllTeams);
    console.log('Has "Dashboard":', hasDashboard);
    
    if (!hasAllTeams && !hasDashboard) {
      console.log('❌ Dashboard elements not found!');
      throw new Error('Dashboard elements not visible after login');
    }
    
    console.log('✅ Login successful!');
    
    // Final screenshot
    await page.screenshot({ path: 'test-results/04-logged-in.png' });
  });
  
  test('Check if backend is responding', async ({ page }) => {
    // Try to access the API directly
    const response = await page.request.get('http://localhost:3000/api/teams');
    console.log('API Status:', response.status());
    console.log('API Response:', await response.text().catch(() => 'No response'));
  });
  
  test('Check if frontend is loading', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    console.log('Page title:', title);
    
    const bodyText = await page.textContent('body') || '';
    console.log('Page has content:', bodyText.length > 0);
  });
});
