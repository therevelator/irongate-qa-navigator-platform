// Proper auth fixture for Playwright tests that simulates real login
import { Page } from '@playwright/test';

const DEMO_CREDENTIALS = {
  super_admin: { email: 'admin@irongate.com', password: 'demo123' },
  qa_manager: { email: 'manager@irongate.com', password: 'demo123' },
  team_lead: { email: 'lead@irongate.com', password: 'demo123' },
  qa_engineer: { email: 'engineer@irongate.com', password: 'demo123' },
  viewer: { email: 'viewer@irongate.com', password: 'demo123' }
};

export async function setupAuth(page: Page, role: 'super_admin' | 'qa_manager' | 'team_lead' | 'qa_engineer' | 'viewer') {
  const credentials = DEMO_CREDENTIALS[role];
  if (!credentials) {
    throw new Error(`No credentials found for role: ${role}`);
  }

  console.log(`Setting up auth for role: ${role} with email: ${credentials.email}`);

  // Navigate to the app
  await page.goto('http://localhost:5173');

  // Wait for login form to load
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });

  // Fill in login credentials
  await page.fill('input[type="email"]', credentials.email);
  await page.fill('input[type="password"]', credentials.password);

  // Submit the form
  await page.click('button[type="submit"]');

  // Wait for dashboard to load (indicating successful login)
  await page.waitForSelector('[data-testid="dashboard"]', { timeout: 30000 });

  console.log(`Successfully logged in as ${role}`);
}
