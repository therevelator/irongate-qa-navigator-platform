import { test, expect, TAG } from '../support/fixtures';
import { checkA11y } from '../support/a11y';
import { API_URL, APP_URL } from '../support/env';
import { ensureOperator, OPERATOR } from '../support/operator';
import { signInWithForm } from '../support/auth';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * The self-serve demo sandbox (/try; src/components/TryDemo.tsx, SandboxBanner.tsx, server/lib/sandbox.ts):
 * the visitor reads the intro, picks a role and starts exploring as that persona of "Northwind Bank —
 * demo" without a password; the banner is on every page with Book a demo / Start a pilot; a team page
 * and TV mode work; signing out returns to /try. The server-side limits are covered by
 * tests/api/sandbox.test.ts.
 *
 *   SBX-01 /try → CTO → overview with the banner → a team page → TV mode → sign out back to /try
 *   SBX-02 the Engineer persona sees their one team; no "Sign out my other devices"; Switch role opens /try
 *   SBX-03 the CTO's e-mail cannot sign in with a password on the sign-in page
 *   A11Y-66 … A11Y-69 the overview with the sandbox banner, in Light, Dark, Graphite and Porcelain
 *   A11Y-70 the /try page
 */

/** The sandbox exists and is ready (built through the operator API on a fresh test database). */
async function ensureSandbox(request: APIRequestContext): Promise<void> {
  const info = await (await request.get(`${API_URL}/auth/sandbox`)).json();
  if (info.ready) return;
  await ensureOperator();
  const login = await request.post(`${API_URL}/operator/login`, { data: { email: OPERATOR.email, password: OPERATOR.password } });
  expect(login.status()).toBe(200);
  const token = (await login.json()).token;
  const r = await request.post(`${API_URL}/operator/sandbox/reset`, { data: { confirm: true }, headers: token ? { 'X-Operator-Token': token } : {}, timeout: 180_000 });
  expect([200, 409]).toContain(r.status());
  await expect.poll(async () => (await (await request.get(`${API_URL}/auth/sandbox`)).json()).ready, { timeout: 180_000 }).toBe(true);
}

async function startAs(page: Page, persona: 'cto' | 'head_of_qa' | 'team_lead' | 'engineer'): Promise<void> {
  await page.goto(`${APP_URL}/try`);
  await expect(page.getByTestId('try-page')).toBeVisible();
  await page.getByTestId(`try-persona-${persona}`).click();
  await page.getByTestId('try-start').click();
  await expect(page.getByTestId('sandbox-banner')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30000 });
}

test.describe('Demo sandbox (/try)', { tag: ['@area:sandbox'] }, () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await ensureSandbox(request);
  });

  test('SBX-01 /try → CTO → banner → a team page → TV mode → sign out back to /try', { tag: [TAG.smoke] }, async ({ page }) => {
    await page.goto(`${APP_URL}/try`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Explore QE Navigator with a sample bank');
    await expect(page.getByTestId('try-page')).toContainText('Sample data.');
    await expect(page.getByTestId('try-page')).toContainText('Resets every night.');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    for (const p of ['cto', 'head_of_qa', 'team_lead', 'engineer']) await expect(page.getByTestId(`try-persona-${p}`)).toBeVisible();
    await expect(page.getByTestId('try-persona-cto')).toContainText('CTO');
    await page.getByTestId('try-persona-cto').click();
    await page.getByTestId('try-start').click();

    // Overview: the banner, the sandbox company, every team of the company.
    const banner = page.getByTestId('sandbox-banner');
    await expect(banner).toBeVisible({ timeout: 30000 });
    await expect(banner).toContainText('Demo sandbox — sample data, resets every night.');
    await expect(banner).toContainText('Alex Morgan (CTO)');
    await expect(page.getByTestId('sandbox-book-demo')).toHaveAttribute('href', 'https://irongate.ie/navigator');
    await expect(page.getByTestId('sandbox-start-pilot')).toHaveAttribute('href', 'https://irongate.ie/navigator/pilot');
    await expect(page.getByTestId('company-badge')).toContainText('Northwind Bank — demo');
    await expect(page.getByTestId('team-card')).toHaveCount(5, { timeout: 30000 });

    // A team page: data and the banner.
    await page.getByTestId('team-card').filter({ hasText: 'Mobile Banking' }).first().click();
    await expect(page.getByTestId('team-detail')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('sandbox-banner')).toBeVisible();

    // TV mode of that team: the sandbox note in its footer.
    await page.getByRole('button', { name: /Open TV mode/ }).first().click();
    await expect(page.getByTestId('tv-mode')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('tv-team-name')).toHaveText('Mobile Banking');
    await expect(page.getByTestId('tv-sandbox')).toContainText('Demo sandbox');
    await page.keyboard.press('Escape');

    // Sign out: back to /try.
    await page.goto(`${APP_URL}/`);
    await page.getByTestId('account-menu-button').click();
    await expect(page.getByTestId('account-sign-out-others')).toHaveCount(0);
    await page.getByTestId('account-sign-out').click();
    await expect(page).toHaveURL(/\/try$/, { timeout: 30000 });
    await expect(page.getByTestId('try-page')).toBeVisible();
  });

  test('SBX-02 the Engineer sees their one team; Switch role opens /try', async ({ page }) => {
    await startAs(page, 'engineer');
    await expect(page.getByTestId('sandbox-banner')).toContainText('Jamie Lindqvist (Engineer)');
    await expect(page.getByTestId('team-card')).toHaveCount(1, { timeout: 30000 });
    await expect(page.getByTestId('team-name')).toHaveText('Mobile Banking');
    await page.getByTestId('sandbox-switch').click();
    await expect(page).toHaveURL(/\/try$/);
    await expect(page.getByTestId('try-page')).toBeVisible();
  });

  test('SBX-03 a sandbox persona cannot sign in with a password', { tag: [TAG.negative] }, async ({ page }) => {
    await page.goto(`${APP_URL}/`);
    await signInWithForm(page, { email: 'alex.morgan@northwind-bank.example', password: 'demo123' }, { expectSuccess: false });
    await expect(page.getByText(/Invalid credentials/)).toBeVisible();
    await expect(page.getByTestId('dashboard')).toHaveCount(0);
  });

  const cases = [
    { id: 'A11Y-66', theme: 'Light' },
    { id: 'A11Y-67', theme: 'Dark' },
    { id: 'A11Y-68', theme: 'Graphite' },
    { id: 'A11Y-69', theme: 'Porcelain' },
  ] as const;
  for (const c of cases) {
    test(`${c.id} ${c.theme} theme: the overview with the sandbox banner has no serious violations`, { tag: [TAG.a11y] }, async ({ page, app }, testInfo) => {
      await startAs(page, 'cto');
      await app.setTheme(c.theme);
      await expect(page.getByTestId('team-card').first()).toBeVisible({ timeout: 30000 });
      await checkA11y(page, testInfo, { known: [], include: '[data-testid="sandbox-banner"]' });
      await checkA11y(page, testInfo, { known: [] });
      await page.evaluate(() => localStorage.removeItem('irongate_theme_mode'));
    });
  }

  test('A11Y-70 the /try page has no serious violations', { tag: [TAG.a11y] }, async ({ page }, testInfo) => {
    await page.goto(`${APP_URL}/try`);
    await expect(page.getByTestId('try-persona-cto')).toBeVisible({ timeout: 30000 });
    await checkA11y(page, testInfo, { known: [] });
  });
});
