import { createHash, randomBytes } from 'crypto';
import { test, expect, TAG } from '../support/fixtures';
import { sql } from '../support/db';
import { STRONG_PASSWORD } from '../support/data';
import { uid } from '../support/ids';
import type { Page } from '@playwright/test';

/**
 * Invitations (src/components/InviteDialog.tsx, AcceptInvite.tsx; /api/admin/invitations,
 * /api/auth/invitations): invite, accept with exactly that assignment, resend (old link dies),
 * revoke, expired / wrong / incomplete links, dialog and accept-form validation, an invitation
 * opened while signed in. Runs in a fresh organisation, so nothing of the demo company changes.
 */

async function invite(page: Page, email: string, role = 'viewer'): Promise<string> {
  await page.getByTestId('invite-user-btn').click();
  await page.getByTestId('invite-email').fill(email);
  await page.getByTestId('invite-role').selectOption(role);
  await page.getByTestId('invite-submit').click();
  const box = page.getByTestId('invite-link');
  await expect(box).toBeVisible();
  const link = await box.inputValue();
  expect(link).toMatch(/\/accept-invite\?token=igi_/);
  await page.getByRole('button', { name: 'Done' }).click();
  return link;
}

async function acceptForm(page: Page, v: { first?: string; last?: string; password?: string; confirm?: string }) {
  if (v.first !== undefined) await page.locator('#invite-first').fill(v.first);
  if (v.last !== undefined) await page.locator('#invite-last').fill(v.last);
  if (v.password !== undefined) await page.locator('#invite-password').fill(v.password);
  if (v.confirm !== undefined) await page.locator('#invite-confirm').fill(v.confirm);
  await page.locator('form button[type="submit"]').click();
}

test.describe('Invitations', { tag: [TAG.area('org'), TAG.area('auth')] }, () => {
  test('INV-01 a super admin invites a viewer; the person accepts and gets exactly that role', { tag: [TAG.smoke, TAG.role('admin')] }, async ({ freshCompany, signInAs, page, browser }) => {
    await signInAs(freshCompany, '/users');
    const email = `${uid('uit-inv')}@uitest.example`;
    const link = await invite(page, email, 'viewer');
    await expect(page.getByTestId('invitation-row').filter({ hasText: email })).toContainText('Pending');

    const ctx = await browser.newContext();
    const invited = await ctx.newPage();
    await invited.goto(link);
    await expect(invited.getByRole('heading', { name: `Join ${freshCompany.name}` })).toBeVisible();
    await expect(invited.locator('#invite-email')).toHaveValue(email);
    await acceptForm(invited, { first: 'Ivy', last: 'Invited', password: STRONG_PASSWORD, confirm: STRONG_PASSWORD });
    await expect(invited.getByTestId('dashboard')).toBeVisible({ timeout: 30000 });
    await invited.getByTestId('nav-toggle').click();
    await expect(invited.locator('#app-navigation').getByText('Viewer', { exact: true })).toBeVisible();
    await expect(invited.getByTestId('nav-users')).toHaveCount(0);
    await ctx.close();

    await page.reload();
    await page.getByLabel('Show accepted and revoked').check();
    await expect(page.getByTestId('invitation-row').filter({ hasText: email })).toContainText('Accepted');
  });

  test('INV-02 resending makes a new link and the old one stops working', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page, browser }) => {
    await signInAs(freshCompany, '/users');
    const email = `${uid('uit-inv')}@uitest.example`;
    const first = await invite(page, email);
    await page.getByRole('button', { name: `Resend the invitation to ${email}` }).click();
    const second = await page.getByTestId('invite-link').inputValue();
    expect(second).not.toBe(first);
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(first);
    await expect(p.getByRole('heading', { name: 'This invitation cannot be used' })).toBeVisible();
    await expect(p.getByTestId('invite-error')).not.toBeEmpty();
    await p.goto(second);
    await expect(p.getByRole('heading', { name: `Join ${freshCompany.name}` })).toBeVisible();
    await ctx.close();
  });

  test('INV-03 a revoked invitation cannot be used', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page, browser }) => {
    await signInAs(freshCompany, '/users');
    const email = `${uid('uit-inv')}@uitest.example`;
    const link = await invite(page, email);
    await page.getByRole('button', { name: `Revoke the invitation to ${email}` }).click();
    await expect(page.getByText(`Invitation to ${email} revoked`)).toBeVisible();
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(link);
    await expect(p.getByRole('heading', { name: 'This invitation cannot be used' })).toBeVisible();
    await ctx.close();
  });

  test('INV-04 an expired invitation says so and offers no form', { tag: [TAG.negative] }, async ({ freshCompany, page }) => {
    const token = `igi_${randomBytes(32).toString('base64url')}`;
    const email = `${uid('uit-inv')}@uitest.example`;
    await sql(
      `INSERT INTO invitations (id, company_id, email, role, scope_type, scope_id, token_hash, invited_by, expires_at, last_sent_at)
       VALUES ($1, $2, $3, 'viewer', 'team', $4, $5, (SELECT id FROM users WHERE company_id = $2::varchar LIMIT 1), now() - interval '1 hour', now() - interval '8 days')`,
      [uid('uit-invrow'), freshCompany.id, email, freshCompany.teamId, createHash('sha256').update(token).digest('hex')]);
    await page.goto(`/accept-invite?token=${token}`);
    await expect(page.getByRole('heading', { name: 'This invitation cannot be used' })).toBeVisible();
    await expect(page.getByTestId('invite-error')).toContainText(/expired/i);
    await expect(page.locator('#invite-password')).toHaveCount(0);
  });

  test('INV-05 a wrong or incomplete link says the invitation cannot be used', { tag: [TAG.negative] }, async ({ page }) => {
    await page.goto('/accept-invite?token=igi_not-a-real-token');
    await expect(page.getByRole('heading', { name: 'This invitation cannot be used' })).toBeVisible();
    await page.goto('/accept-invite');
    await expect(page.getByTestId('invite-error')).toHaveText('This invitation link is incomplete. Open the link from your email again.');
    await page.getByRole('button', { name: /sign-in|Sign in/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('INV-06 the invite dialog checks the e-mail; the API refuses an address that already has an account', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/users');
    await page.getByTestId('invite-user-btn').click();
    await page.getByTestId('invite-email').fill('not-an-email');
    await page.getByTestId('invite-submit').click();
    await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Enter a valid email address.');
    await page.getByTestId('invite-email').fill(freshCompany.email);
    await page.getByTestId('invite-submit').click();
    await expect(page.getByRole('dialog').getByRole('alert')).not.toBeEmpty();
    await expect(page.getByTestId('invite-link')).toHaveCount(0);
  });

  test('INV-07 the accept form checks names, password strength and the repeat', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page, browser }) => {
    await signInAs(freshCompany, '/users');
    const name = uid('uit-inv');
    const link = await invite(page, `${name}@uitest.example`);
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(link);
    await acceptForm(p, { first: '', last: '', password: STRONG_PASSWORD, confirm: STRONG_PASSWORD });
    await expect(p.getByTestId('accept-error')).toHaveText('Enter your first and last name.');
    await acceptForm(p, { first: 'Ivy', last: 'Invited', password: 'short', confirm: 'short' });
    await expect(p.getByTestId('accept-error')).toHaveText('Choose a stronger password (see the rules below).');
    await acceptForm(p, { password: `${name}-A1!`, confirm: `${name}-A1!` });
    await expect(p.getByTestId('accept-error')).toHaveText('Choose a stronger password (see the rules below).');
    await acceptForm(p, { password: STRONG_PASSWORD, confirm: `${STRONG_PASSWORD}?` });
    await expect(p.getByTestId('accept-error')).toHaveText('The two passwords do not match.');
    await expect(p.getByTestId('dashboard')).toHaveCount(0);
    await ctx.close();
  });

  test('INV-08 an invitation opened while signed in asks to sign out first', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/users');
    const link = await invite(page, `${uid('uit-inv')}@uitest.example`);
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'You are already signed in' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: `Join ${freshCompany.name}` })).toBeVisible();
  });

  test('INV-09 a manager may invite team leads, software engineers and viewers only; a team lead engineers and viewers', { tag: [TAG.role('manager'), TAG.role('lead')] }, async ({ signInAs, page, app }) => {
    await signInAs('manager', '/users');
    await page.getByTestId('invite-user-btn').click();
    await expect(page.getByTestId('invite-role').locator('option')).toHaveText(['Team lead', 'Software engineer', 'Viewer']);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await app.signOut();
    await signInAs('lead', '/users');
    await page.getByTestId('invite-user-btn').click();
    await expect(page.getByTestId('invite-role').locator('option')).toHaveText(['Software engineer', 'Viewer']);
  });
});
