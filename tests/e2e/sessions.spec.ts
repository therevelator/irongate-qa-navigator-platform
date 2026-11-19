import { test, expect, type Browser } from '@playwright/test';
import { Client } from 'pg';
import dotenv from 'dotenv';
import { setupAuth } from './fixtures/auth';

/**
 * Sessions: a super admin sets "Sign-in lasts" to 1 hour in Parameters (the sign-in cookie then
 * lasts 1 hour); a user's "Sign out my other devices" keeps this browser signed in and sends the
 * other one to the sign-in screen with a clear message. The setting is put back and the fixture
 * user (e2e-sess-*) removed through the LOCAL database.
 */

dotenv.config();

const USER = `e2e-sess-${Date.now()}`;
const EMAIL = `${USER}@irongate.test`;

async function db(): Promise<Client> {
  const url = new URL(process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/irongate_dev');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`Refusing non-local database host ${url.hostname}`);
  const client = new Client({
    host: url.hostname, port: parseInt(url.port || '5432', 10), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: url.pathname.slice(1),
  });
  await client.connect();
  return client;
}

async function signIn(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173/');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'demo123');
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 30000 });
  return { ctx, page };
}

test.describe('Sign-in lifetime and signing out other devices', { tag: ['@area:auth'] }, () => {
  // Written for one worker: these tests run in order, in one worker (a failure does not skip the rest).
  test.describe.configure({ mode: 'default' });
  test.setTimeout(120000);

  test.beforeAll(async () => {
    const c = await db();
    try {
      const eng = (await c.query(`SELECT company_id, department_id, primary_team_id, password_hash FROM users WHERE email = 'engineer@irongate.com'`)).rows[0];
      await c.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
         VALUES ($1, $2, $3, 'Sess', 'Person', 'qa_engineer', $4, $5, $6, TRUE, TRUE)`,
        [USER, EMAIL, eng.password_hash, eng.company_id, eng.department_id, eng.primary_team_id]
      );
      await c.query(`INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, 'qa_engineer', 'team', $4)`,
        [`${USER}-ra`, eng.company_id, USER, eng.primary_team_id]);
    } finally {
      await c.end();
    }
  });

  test.afterAll(async () => {
    const c = await db();
    try {
      await c.query(`DELETE FROM configs WHERE config_key = 'session_lifetime_hours' AND company_id = (SELECT company_id FROM users WHERE email = 'admin@irongate.com')`);
      await c.query('DELETE FROM role_assignments WHERE user_id = $1', [USER]);
      await c.query('DELETE FROM audit_log WHERE entity_id = $1', [USER]).catch(() => undefined);
      await c.query('DELETE FROM users WHERE id = $1', [USER]);
    } finally {
      await c.end();
    }
  });

  test('A super admin sets "Sign-in lasts" to 1 hour; the next sign-in lasts 1 hour', async ({ page, browser }) => {
    await setupAuth(page, 'super_admin');
    await page.goto('http://localhost:5173/parameters-config');
    const select = page.locator('[data-testid="session-lifetime"]');
    await expect(select).toBeVisible({ timeout: 20000 });
    await select.selectOption('1');
    await page.click('[data-testid="session-lifetime-save"]');
    await expect(page.locator('[data-testid="session-lifetime-current"]')).toContainText('Current: 1 hour.');
    await expect(page.locator('[data-testid="session-lifetime-current"]')).toContainText('Shortening it signs out anyone signed in for longer than the new limit.');

    const { ctx, page: again } = await signIn(browser, 'admin@irongate.com');
    const cookie = (await ctx.cookies()).find((k) => k.name === 'irongate_token')!;
    const hoursLeft = (cookie.expires * 1000 - Date.now()) / 3600_000;
    expect(hoursLeft).toBeGreaterThan(0.9);
    expect(hoursLeft).toBeLessThanOrEqual(1.01);
    await again.goto('http://localhost:5173/parameters-config');
    await expect(again.locator('[data-testid="session-lifetime"]')).toHaveValue('1', { timeout: 20000 });
    await ctx.close();
  });

  test('"Sign out my other devices" keeps this browser and signs the other one out with a message', async ({ browser }) => {
    const other = await signIn(browser, EMAIL);
    // A second earlier than the sign-out (sessions of the same second as the sign-out stay valid).
    await new Promise((r) => setTimeout(r, 1100));
    const mine = await signIn(browser, EMAIL);
    await new Promise((r) => setTimeout(r, 1100));
    await mine.page.click('[data-testid="nav-toggle"]');
    mine.page.once('dialog', (d) => d.accept());
    await mine.page.click('[data-testid="sign-out-others"]');
    await expect(mine.page.getByText('You were signed out on all other devices')).toBeVisible();

    // The other browser's next request is refused (the cookie is cleared with it), so trigger one
    // instead of reloading: a background poll may already have used up the refusal.
    await other.page.evaluate(() => fetch('http://localhost:3000/api/teams', { credentials: 'include' }).catch(() => undefined));
    await expect(other.page.locator('[data-testid="session-notice"]')).toHaveText('Your session has ended. Please sign in again.');
    await mine.page.reload();
    await expect(mine.page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 30000 });
    await other.ctx.close();
    await mine.ctx.close();
  });
});
