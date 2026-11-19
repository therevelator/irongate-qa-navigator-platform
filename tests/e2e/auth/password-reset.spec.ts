import { createHash, randomBytes } from 'crypto';
import { test, expect, TAG } from '../support/fixtures';
import { useOwnClientAddress, signInWithForm, signedInContext } from '../support/auth';
import { createFixtureUser, deleteFixtureUser, STRONG_PASSWORD } from '../support/data';
import { sql } from '../support/db';
import { API_URL } from '../support/env';
import { linkFromMail, mailCaptureEnabled, mailsTo } from '../support/mail';
import type { Page } from '@playwright/test';

/**
 * Forgot / reset password, the cases the happy-path spec (tests/e2e/password-reset.spec.ts) does
 * not cover: format check, unknown address (same answer, no e-mail), wrong / incomplete / expired
 * links, weak and mismatched passwords, a reset ending the other sessions, an administrator's
 * "Send reset link", and an unreachable server. Every test has its own fixture user and client
 * address (the API allows 5 forgot-password requests per 15 minutes per address).
 */

async function issueResetToken(userId: string, expired = false): Promise<string> {
  const token = `igr_${randomBytes(32).toString('base64url')}`;
  await sql(
    `INSERT INTO password_resets (user_id, company_id, token_hash, created_at, expires_at)
     SELECT id, company_id, $2, now() - make_interval(mins => $3::int), now() - make_interval(mins => $3::int) + interval '60 minutes'
       FROM users WHERE id = $1`,
    [userId, createHash('sha256').update(token).digest('hex'), expired ? 65 : 0]);
  return token;
}

const choose = async (page: Page, password: string, confirm = password) => {
  await page.locator('#reset-password').fill(password);
  await page.locator('#reset-confirm').fill(confirm);
  await page.getByTestId('reset-submit').click();
};

test.describe('Password reset: negative cases', { tag: [TAG.area('auth')] }, () => {
  test('PWR-01 the forgot-password form checks the address format', { tag: [TAG.negative] }, async ({ page }) => {
    await page.goto('/forgot-password');
    await page.locator('#forgot-email').fill('not an e-mail');
    await page.getByTestId('forgot-submit').click();
    await expect(page.getByTestId('forgot-error')).toHaveText('Enter the e-mail address you sign in with.');
    await page.getByTestId('back-to-sign-in').click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('PWR-02 an unknown address gets the same answer and no e-mail is sent', { tag: [TAG.negative] }, async ({ page }) => {
    await useOwnClientAddress(page);
    const unknown = `nobody-${Date.now()}@uitest.example`;
    await page.goto('/forgot-password');
    await page.locator('#forgot-email').fill(unknown);
    await page.getByTestId('forgot-submit').click();
    await expect(page.getByTestId('forgot-sent')).toHaveText("If an account exists for that e-mail, we've sent a link.");
    expect(mailsTo(unknown)).toHaveLength(0);
  });

  test('PWR-03 the forgot-password form survives an unreachable server', { tag: [TAG.negative] }, async ({ page }) => {
    await page.route(`${API_URL}/auth/forgot-password`, (r) => r.abort('internetdisconnected'));
    await page.goto('/forgot-password');
    await page.locator('#forgot-email').fill('someone@uitest.example');
    await page.getByTestId('forgot-submit').click();
    await expect(page.getByTestId('forgot-error')).toHaveText('The server could not be reached. Try again in a moment.');
  });

  test('PWR-04 a reset page without a token or with a wrong token offers no reset', { tag: [TAG.negative] }, async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page.getByTestId('reset-link-error')).toHaveText('This reset link is incomplete. Open the link from your e-mail again, or ask for a new one.');
    await useOwnClientAddress(page);
    await page.goto('/reset-password?token=igr_wrong-token-value');
    await expect(page).toHaveURL(/\/reset-password$/);
    await choose(page, STRONG_PASSWORD);
    await expect(page.getByTestId('reset-link-error')).not.toBeEmpty();
    await expect(page.getByTestId('reset-done')).toHaveCount(0);
  });

  test('PWR-05 an expired link is refused and the password stays as it was', { tag: [TAG.negative] }, async ({ page }) => {
    const user = await createFixtureUser();
    try {
      await useOwnClientAddress(page);
      const token = await issueResetToken(user.id, true);
      await page.goto(`/reset-password?token=${token}`);
      await choose(page, STRONG_PASSWORD);
      await expect(page.getByTestId('reset-link-error')).toContainText(/expired/i);
      await page.goto('/');
      await signInWithForm(page, user);
    } finally {
      await deleteFixtureUser(user.id);
    }
  });

  test('PWR-06 weak and mismatched new passwords are refused before anything is sent', { tag: [TAG.negative] }, async ({ page }) => {
    let sent = 0;
    await page.route(`${API_URL}/auth/reset-password`, (r) => { sent++; return r.continue(); });
    await page.goto('/reset-password?token=igr_some-token');
    await choose(page, 'short1');
    await expect(page.getByTestId('reset-error')).toHaveText('Choose a stronger password (see the rules below).');
    await choose(page, STRONG_PASSWORD, `${STRONG_PASSWORD}!`);
    await expect(page.getByTestId('reset-error')).toHaveText('The two passwords do not match.');
    expect(sent).toBe(0);
  });

  test('PWR-07 completing a reset signs the person out on their other devices', { tag: [TAG.negative] }, async ({ page, browser }) => {
    const user = await createFixtureUser();
    const other = await signedInContext(browser, user);
    try {
      await useOwnClientAddress(page);
      const token = await issueResetToken(user.id);
      await new Promise((r) => setTimeout(r, 1100)); // sessions of the same second as the reset stay valid
      await page.goto(`/reset-password?token=${token}`);
      await choose(page, STRONG_PASSWORD);
      await expect(page.getByTestId('reset-done')).toBeVisible();
      // The other browser reloads: its session is refused (and the cookie cleared): sign-in with the message.
      await other.page.reload();
      await expect(other.page.getByTestId('session-notice')).toHaveText('Your session has ended. Please sign in again.');
      // Reloaded again, without the cookie, the sign-in screen still says why (FI-16).
      await other.page.reload();
      await expect(other.page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expect(other.page.getByTestId('session-notice')).toHaveText('Your session has ended. Please sign in again.');
    } finally {
      await other.ctx.close();
      await deleteFixtureUser(user.id);
    }
  });

  test('PWR-08 an administrator sends a reset link from Users; it arrives and works', { tag: [TAG.role('admin')] }, async ({ signInAs, page, browser }) => {
    test.skip(!mailCaptureEnabled(), 'Needs MAIL_CAPTURE_FILE (set by the local runner and CI) to read the e-mailed link.');
    const user = await createFixtureUser();
    try {
      await signInAs('admin', '/users');
      await page.getByPlaceholder('Search users by name, email, team...').fill(user.email);
      const card = page.getByTestId('user-card').filter({ hasText: user.email });
      await card.getByTitle('Reset Password').click();
      await page.getByTestId('send-reset-link-btn').click();
      const link = await linkFromMail(user.email, /(http\S+\/reset-password\?token=[A-Za-z0-9_%-]+)/);
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await p.goto(link);
      await choose(p, STRONG_PASSWORD);
      await expect(p.getByTestId('reset-done')).toBeVisible();
      await p.getByTestId('back-to-sign-in').click();
      await signInWithForm(p, { email: user.email, password: STRONG_PASSWORD });
      await ctx.close();
    } finally {
      await deleteFixtureUser(user.id);
    }
  });
});
