import { test, expect, TAG } from '../support/fixtures';
import { sql } from '../support/db';
import { deleteCompany, STRONG_PASSWORD } from '../support/data';
import { uid } from '../support/ids';
import { ROLES } from '../support/roles';

/**
 * Create an account (src/components/Register.tsx, POST /api/auth/register): a new organisation
 * whose first user is its super admin; validation of every field; taken e-mail and organisation
 * name. Each test that registers removes its organisation again.
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
      await expect(page.getByText('Strong')).toBeVisible();
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

  test('REG-04 mismatched and weak passwords are refused', { tag: [TAG.negative] }, async ({ page }) => {
    await open(page);
    const base = { firstName: 'Ada', lastName: 'Lovelace', email: `${uid()}@uitest.example`, companyName: 'Some Org', departmentName: 'D', teamName: 'T' };
    await fill(page, { ...base, password: STRONG_PASSWORD, confirmPassword: `${STRONG_PASSWORD}x` });
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText('The passwords do not match.');
    await fill(page, { password: 'password', confirmPassword: 'password' });
    await expect(page.getByText('Weak')).toBeVisible();
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText(/Choose a stronger password/);
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

  test('REG-08 a second organisation for the same e-mail domain is refused with a clear message', { tag: [TAG.negative] }, async ({ freshCompany, page }) => {
    const domain = freshCompany.email.split('@')[1];
    await open(page);
    await fill(page, {
      firstName: 'Ada', lastName: 'Lovelace', email: `someone.else@${domain}`, companyName: `UI Other ${uid().slice(-6)}`,
      departmentName: 'D', teamName: 'T', password: STRONG_PASSWORD, confirmPassword: STRONG_PASSWORD,
    });
    await submit(page);
    await expect(page.getByRole('alert')).toHaveText(`An organisation already uses the e-mail domain ${domain}. Ask its administrator to invite you.`);
  });

  test('REG-07 "Sign in" goes back to the sign-in screen', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
