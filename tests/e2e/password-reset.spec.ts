import fs from 'fs';
import { createHash, randomBytes } from 'crypto';
import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import dotenv from 'dotenv';

/**
 * Forgot password: "Forgot password?" on the sign-in screen, the e-mail address, the link from the
 * e-mail, a new password (the rules apply), then sign in with it. The page removes the token from
 * the address bar and sends no Referer; the link works once.
 *
 * Own fixture user (e2e-pwreset-*) in the IronGate company, created and removed through the LOCAL
 * database. The link's token only exists in the e-mail: with MAIL_CAPTURE_FILE (development aid of
 * the log mailer) it is read from there, otherwise a link is issued for the user the same way the
 * server does (only the sha256 is stored).
 */

dotenv.config();

const USER = `e2e-pwreset-${Date.now()}`;
const EMAIL = `${USER}@irongate.test`;
const NEW_PASSWORD = 'Fresh-Passw0rd-42';

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

test.describe('Forgot password and reset by e-mail', () => {
  test.setTimeout(120000);

  test.beforeAll(async () => {
    const c = await db();
    try {
      const eng = (await c.query(`SELECT company_id, department_id, primary_team_id, password_hash FROM users WHERE email = 'engineer@irongate.com'`)).rows[0];
      await c.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
         VALUES ($1, $2, $3, 'Reset', 'Person', 'qa_engineer', $4, $5, $6, TRUE, TRUE)`,
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
      await c.query('DELETE FROM role_assignments WHERE user_id = $1', [USER]);
      await c.query('DELETE FROM audit_log WHERE entity_id = $1', [USER]).catch(() => undefined);
      await c.query('DELETE FROM users WHERE id = $1', [USER]); // password_resets cascade
    } finally {
      await c.end();
    }
  });

  /** The reset link from the captured e-mail, else one issued like the server does. */
  async function resetLink(): Promise<string> {
    const capture = process.env.MAIL_CAPTURE_FILE;
    if (capture) {
      for (let i = 0; i < 20; i++) {
        if (fs.existsSync(capture)) {
          const mails = fs.readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.to === EMAIL);
          const m = mails[mails.length - 1]?.text.match(/(http\S+\/reset-password\?token=[A-Za-z0-9_%-]+)/);
          if (m) return m[1];
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    const token = `igr_${randomBytes(32).toString('base64url')}`;
    const c = await db();
    try {
      const u = (await c.query('SELECT company_id FROM users WHERE id = $1', [USER])).rows[0];
      await c.query('UPDATE password_resets SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL', [USER]);
      await c.query(`INSERT INTO password_resets (user_id, company_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '60 minutes')`,
        [USER, u.company_id, createHash('sha256').update(token).digest('hex')]);
    } finally {
      await c.end();
    }
    return `http://localhost:5173/reset-password?token=${token}`;
  }

  test('Forgot password, follow the e-mailed link, choose a new password, sign in with it', async ({ page, browser }) => {
    await page.goto('http://localhost:5173/');
    await page.click('[data-testid="forgot-password-link"]');
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
    await page.fill('#forgot-email', EMAIL);
    await page.click('[data-testid="forgot-submit"]');
    await expect(page.locator('[data-testid="forgot-sent"]')).toHaveText("If an account exists for that e-mail, we've sent a link.");

    const link = await resetLink();
    expect(link).toContain('/reset-password?token=igr_');
    const ctx = await browser.newContext();
    const reset = await ctx.newPage();
    await reset.goto(link);
    await expect(reset.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    // The token leaves the address bar at once, and the page sends no Referer.
    expect(new URL(reset.url()).search).toBe('');
    expect(new URL(reset.url()).pathname).toBe('/reset-password');
    await expect(reset.locator('meta[name="referrer"][content="no-referrer"]')).toHaveCount(1);

    await reset.fill('#reset-password', 'weak');
    await reset.fill('#reset-confirm', 'weak');
    await reset.click('[data-testid="reset-submit"]');
    await expect(reset.locator('[data-testid="reset-error"]')).toContainText(/stronger password/);
    await reset.fill('#reset-password', NEW_PASSWORD);
    await reset.fill('#reset-confirm', NEW_PASSWORD);
    await reset.click('[data-testid="reset-submit"]');
    await expect(reset.locator('[data-testid="reset-done"]')).toContainText('Sign in with your new password');

    // Not signed in by the reset: back to sign-in, the new password works.
    await reset.click('[data-testid="back-to-sign-in"]');
    await reset.waitForSelector('input[type="email"]');
    await reset.fill('input[type="email"]', EMAIL);
    await reset.fill('input[type="password"]', NEW_PASSWORD);
    await reset.click('button[type="submit"]');
    await expect(reset.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 30000 });

    // The link works once.
    const again = await ctx.newPage();
    await again.goto(link);
    await again.fill('#reset-password', `${NEW_PASSWORD}x`);
    await again.fill('#reset-confirm', `${NEW_PASSWORD}x`);
    await again.click('[data-testid="reset-submit"]');
    await expect(again.locator('[data-testid="reset-link-error"]')).toContainText(/already been used/);
    await ctx.close();
  });
});
