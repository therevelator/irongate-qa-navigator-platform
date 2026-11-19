import { test, expect, TAG } from '../support/fixtures';
import { sql } from '../support/db';
import { deleteCompany, STRONG_PASSWORD } from '../support/data';
import { fakeClientIp, uid } from '../support/ids';
import { ROLES } from '../support/roles';
import { API_URL } from '../support/env';

/**
 * Create an account (src/components/Register.tsx, POST /api/auth/register): a new organisation
 * whose first user is its super admin; validation of every field (the password rules are those of
 * invitations and resets); taken e-mail, organisation name and company e-mail domain; public e-mail
 * domains (gmail.com, …) never block a registration. Each test that registers removes its
 * organisation again.
 */

const open = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create your organisation' })).toBeVisible();
};

const fill = async (page: import('@playwright/test').Page, v: Partial<Record<'firstName' | 'lastName' | 'email' | 'companyName' | 'departmentName' | 'teamName' | 'password' | 'confirmPassword', string>>) => {
  for (const [id, value] of Object.entries(v)) await page.locator(`#${id}`).fill(value);
};

const submit = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /Create account/ }).click();

test.describe('Registration', { tag: [TAG.area('auth')] }, () => {
  test('REG-01 a new organisation is created and its creator is signed in as super admin', { tag: [TAG.smoke] }, async ({ page, app }) => {
    const id = uid('uit-reg');
    const company = `UI Reg ${id.replace(/[^a-z0-9]/gi, ' ')}`;
    try {
      await open(page);
      await fill(page, {
        firstName: 'Ada', lastName: "O'Neil-Smith", email: `ada@${id}.uitest.example`, companyName: company,
        departmentName: 'Engineering', teamName: 'Payments QA', password: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD,
      });
      await expect(page.getByTestId('password-rules').getByText('(not met)')).toHaveCount(0);
      await submit(page);
      await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30000 });
      await expect(page.getByRole('heading', { name: /Ada/ })).toBeVisible();
      await expect(page.getByTestId('onboarding-checklist')).toBeVisible();
      await app.openNav();
      await expect(app.drawer.getByText('Super admin', { exact: true })).toBeVisible();
      await app.go('nav-departments', 'Departments');
      await expect(page.getByRole('cell', { name: 'Engineering' }).first()).toBeVisible();
    } finally {
      const rows = await sql<{ id: string }>('SELECT id FROM companies WHERE name = $1', [company]);
      for (const r of rows) await deleteCompany(r.id);
    }
  });

  test('REG-02 every field is required', { tag: [TAG.negative] }, async ({ page }) => {
    await open(page);
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText('Please complete all fields.');
    await fill(page, { firstName: 'Ada', lastName: 'Lovelace', email: 'a@b.example', companyName: 'X Org', departmentName: 'D' });
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText('Please complete all fields.');
  });

  test('REG-03 names and organisation names with markup or symbols are refused', { tag: [TAG.negative] }, async ({ page }) => {
    await open(page);
    const base = { lastName: 'Lovelace', email: `${uid()}@uitest.example`, companyName: 'Org', departmentName: 'D', teamName: 'T', password: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD };
    await fill(page, { ...base, firstName: '<img src=x onerror=alert(1)>' });
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText('Names may contain letters, spaces, hyphens and apostrophes only.');
    await fill(page, { firstName: 'Ada', companyName: 'Evil <script>' });
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText("Organisation name may contain letters, numbers, spaces and the characters - ' & .");
  });

  test('REG-04 mismatched and weak passwords are refused (the invitation and reset rules)', { tag: [TAG.negative] }, async ({ page }) => {
    await open(page);
    const base = { firstName: 'Ada', lastName: 'Lovelace', email: `lovelace@${uid('reg4')}.uitest.example`, companyName: 'Some Org', departmentName: 'D', teamName: 'T' };
    await fill(page, { ...base, password: STRONG_PASSWORD, confirmPassword: `${STRONG_PASSWORD}x` });
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText('The passwords do not match.');
    const rules = page.getByTestId('password-rules');
    // 9 characters with three classes: accepted before (8 was enough), refused now (10 or more).
    for (const [weak, broken] of [
      ['Abcdefg1!', 'At least 10 characters'],
      ['abcdefghijkl', 'Three of: lower case, upper case, number, symbol'],
      ['Lovelace-2024!', 'Does not contain your email name'],
    ] as const) {
      await fill(page, { password: weak, confirmPassword: weak });
      await expect(rules.getByRole('listitem').filter({ hasText: broken })).toContainText('(not met)');
      await submit(page);
      await expect(page.getByRole('alert')).toHaveText('Choose a stronger password (see the rules below the password).');
    }
    // The API applies the same rules (a 9-character password is refused there too).
    const res = await page.request.post(`${API_URL}/auth/register`, { headers: { 'x-forwarded-for': fakeClientIp() }, data: { ...base, email: `api.${uid().slice(-6)}@uitest.example`, companyName: `UI Weak ${uid().slice(-6)}`, password: 'Abcdefg1!' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('The password must be 10 to 128 characters long.');
  });

  test('REG-05 an e-mail that already has an account is refused, and what was typed stays', { tag: [TAG.negative] }, async ({ page }) => {
    await open(page);
    await fill(page, {
      firstName: 'Ada', lastName: 'Lovelace', email: ROLES.viewer.email, companyName: `UI Dup ${uid().slice(-6)}`,
      departmentName: 'D', teamName: 'T', password: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD,
    });
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText('Email already registered');
    await expect(page.locator('#firstName')).toHaveValue('Ada');
  });

  test('REG-06 the name of an existing organisation is refused (no joining by name)', { tag: [TAG.negative] }, async ({ page }) => {
    const [{ name }] = await sql<{ name: string }>(`SELECT name FROM companies WHERE id = 'novatech'`);
    await open(page);
    await fill(page, {
      firstName: 'Ada', lastName: 'Lovelace', email: `${uid()}@uitest.example`, companyName: name,
      departmentName: 'D', teamName: 'T', password: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD,
    });
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText('An organisation with this name already exists. Ask its administrator to create an account for you.');
  });

  test('REG-08 a second organisation for the same company e-mail domain is refused with a clear message', { tag: [TAG.negative] }, async ({ freshCompany, page }) => {
    const domain = freshCompany.email.split('@')[1];
    await open(page);
    await fill(page, { email: `someone.else@${domain}` });
    await expect(page.getByTestId('email-domain-hint')).toHaveText(/yours is the only organisation for that e-mail domain/);
    await fill(page, {
      firstName: 'Ada', lastName: 'Lovelace', companyName: `UI Other ${uid().slice(-6)}`,
      departmentName: 'D', teamName: 'T', password: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD,
    });
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText(`An organisation already uses the e-mail domain ${domain}. Ask its administrator to invite you.`);
  });

  test('REG-09 people with a public e-mail address (gmail.com) each create their own organisation', async ({ browser }) => {
    const id = uid('uit-gm').replace(/[^a-z0-9]/gi, '');
    const created: string[] = [];
    try {
      for (const who of ['first', 'second']) {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await open(page);
        await fill(page, { email: `uitest.${who}.${id}@gmail.com` });
        await expect(page.getByTestId('email-domain-hint')).toHaveText('gmail.com is a personal e-mail provider, so it is not linked to your organisation. You invite the people who join.');
        await fill(page, {
          firstName: 'Gail', lastName: who === 'first' ? 'First' : 'Second', companyName: `UI Gmail ${who} ${id}`,
          departmentName: 'Engineering', teamName: 'Team', password: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD,
        });
        await submit(page);
        await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 30000 });
        const [row] = await sql<{ id: string }>('SELECT company_id AS id FROM users WHERE email = $1', [`uitest.${who}.${id}@gmail.com`]);
        created.push(row.id);
        // Each sees only their own organisation: they are its only person.
        await page.goto('/users');
        await expect(page.getByTestId('user-card')).toHaveCount(1);
        await ctx.close();
      }
      expect(created[0]).not.toBe(created[1]);
    } finally {
      for (const c of created) await deleteCompany(c);
    }
  });

  test('REG-07 "Sign in" goes back to the sign-in screen', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
