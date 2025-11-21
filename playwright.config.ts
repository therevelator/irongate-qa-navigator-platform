import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for E2E tests
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',
  
  /* Maximum time one test can run */
  timeout: 60 * 1000, // 60 seconds per test
  
  /* Maximum time to wait for expect() assertions */
  expect: {
    timeout: 10 * 1000, // 10 seconds for assertions
  },
  
  /* Run tests in files in parallel */
  fullyParallel: false, // Run sequentially to avoid resource issues
  
  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,
  
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 1, // Retry once locally too
  
  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? 1 : 1, // Single worker to avoid conflicts
  
  /* Reporter to use */
  reporter: [
    ['html'],
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }]
  ],
  
  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: 'http://localhost:5173',
    
    /* Maximum time for actions like click, fill, etc. */
    actionTimeout: 15 * 1000, // 15 seconds
    
    /* Maximum time for navigation */
    navigationTimeout: 30 * 1000, // 30 seconds
    
    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',
    
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
    
    /* Video on failure */
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chrome',
      use: { 
        ...devices['Desktop Chrome'],
        channel: 'chrome', // Use installed Chrome instead of Chromium
        launchOptions: {
          args: [
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--no-sandbox',
            '--disable-setuid-sandbox',
          ],
          slowMo: 100, // Slow down by 100ms to help with timing
        },
      },
    },
    
    // Chromium for CI/CD environments
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--no-sandbox',
            '--disable-setuid-sandbox',
          ],
          slowMo: 100,
        },
      },
    },

    // Uncomment to test on more browsers
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm start',
    url: 'http://localhost:5173',
    reuseExistingServer: true, // Use existing server if already running
    timeout: 180 * 1000, // 3 minutes to start
  },
});
