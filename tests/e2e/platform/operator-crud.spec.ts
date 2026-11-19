import { test, expect, TAG } from '../support/fixtures';
import { uid } from '../support/ids';
import { API_URL } from '../support/env';
import { sql } from '../support/db';
import { operatorSignIn } from '../support/operator';
import { deleteCompany, STRONG_PASSWORD } from '../support/data';
import { signInWithForm } from '../support/auth';

/**
 * Platform support panel: changing a company (src/components/operator/*, server/routes/operator.ts).
 *
 *   OPC-01 create a company with a first super admin, then add a department, a team and a person
 *   OPC-01b the first person may get another role (software engineer of the first team, invited)
 *   OPC-02 a person's page: sign-in history, sessions (valid) and Revoke of one session
 *   OPC-03 suspend a company: badge in the list; its people see "Your organisation's access is
 *          suspended" at sign-in and on their open session; reactivate
 *   OPC-04 deleting a team or a company needs the typed name
 *   OPC-05 Last views, Sessions and the Access log (CSV) of a company
 */

const openCompany = async (page: import('@playwright/test').Page, name: string) => {
  await page.getByRole('row', { name: new RegExp(name) }).getByTestId('operator-open-company').click();
  await expect(page.getByTestId('op-organisation')).toBeVisible({ timeout: 30000 });
};

test.describe('Platform support: changes', { tag: [TAG.area('operator')] }, () => {
  test.setTimeout(120000);

  test('OPC-01b the first person can be invited as a software engineer of the first team', async ({ page }) => {
    const id = uid('opcr');
    const name = `Op Engineer First ${id}`;
    await operatorSignIn(page);
    await page.getByTestId('op-create-company').click();
    await page.getByTestId('op-f-name').fill(name);
    await page.getByTestId('op-f-adminEmail').fill(`dev@${id}.uitest.example`);
    await page.getByTestId('op-f-adminRole').selectOption('qa_engineer');
    await page.getByTestId('op-form-submit').click();
    await expect(page.getByTestId('op-company-name')).toHaveText(name, { timeout: 30000 });
    const companyId = (await sql<{ id: string }>('SELECT id FROM companies WHERE name = $1', [name]))[0].id;
    try {
      const inv = await sql<{ role: string; scope_type: string }>('SELECT role, scope_type FROM invitations WHERE company_id = $1', [companyId]);
      expect(inv).toEqual([{ role: 'qa_engineer', scope_type: 'team' }]);
    } finally {
      await sql('DELETE FROM companies WHERE id = $1', [companyId]);
    }
  });

  test('OPC-01 create a company, then a department, a team and a person', async ({ page }) => {
    const id = uid('opc');
    const name = `Op Created ${id}`;
    await operatorSignIn(page);
    await page.getByTestId('op-create-company').click();
    await page.getByTestId('op-f-name').fill(name);
    await page.getByTestId('op-f-adminEmail').fill(`boss@${id}.uitest.example`);
    // The first person's role: super admin by default, with the reason.
    await expect(page.getByTestId('op-f-adminRole')).toHaveValue('super_admin');
    await expect(page.getByText('Every company needs a super admin to manage it; you can also manage it yourself from this panel.')).toBeVisible();
    await page.getByTestId('op-f-adminMode').selectOption('password');
    await page.getByTestId('op-f-adminFirstName').fill('Bo');
    await page.getByTestId('op-f-adminLastName').fill('Ss');
    await page.getByTestId('op-f-adminPassword').fill(STRONG_PASSWORD);
    await page.getByTestId('op-form-submit').click();
    // The new company opens.
    await expect(page.getByTestId('op-company-name')).toHaveText(name, { timeout: 30000 });
    const companyId = (await sql<{ id: string }>('SELECT id FROM companies WHERE name = $1', [name]))[0].id;
    try {
      await expect(page.getByTestId('op-organisation')).toContainText('Team 1');
      await page.getByTestId('op-add-department').click();
      await page.getByTestId('op-f-name').fill('Quality');
      await page.getByTestId('op-form-submit').click();
      await expect(page.getByTestId('op-organisation')).toContainText('Quality', { timeout: 30000 });
      await page.getByTestId('op-add-team').click();
      await page.getByTestId('op-f-name').fill('Beta squad');
      await page.getByTestId('op-f-departmentId').selectOption({ label: 'Quality' });
      await page.getByTestId('op-form-submit').click();
      await expect(page.getByTestId('op-organisation')).toContainText('Beta squad', { timeout: 30000 });

      await page.getByRole('button', { name: 'Users', exact: true }).click();
      await page.getByTestId('op-add-user').click();
      await page.getByTestId('op-f-firstName').fill('Pat');
      await page.getByTestId('op-f-lastName').fill('Person');
      await page.getByTestId('op-f-email').fill(`pat@${id}.uitest.example`);
      await page.getByTestId('op-f-role').selectOption('qa_engineer');
      await page.getByTestId('op-f-teamId').selectOption({ label: 'Beta squad' });
      await page.getByTestId('op-f-password').fill(STRONG_PASSWORD);
      await page.getByTestId('op-form-submit').click();
      await expect(page.getByTestId(`op-user-row-pat@${id}.uitest.example`)).toBeVisible({ timeout: 30000 });
      // The company app's own rules apply: a duplicate e-mail is refused with its message.
      await page.getByTestId('op-add-user').click();
      await page.getByTestId('op-f-firstName').fill('Pat');
      await page.getByTestId('op-f-lastName').fill('Again');
      await page.getByTestId('op-f-email').fill(`pat@${id}.uitest.example`);
      await page.getByTestId('op-f-role').selectOption('qa_engineer');
      await page.getByTestId('op-f-teamId').selectOption({ label: 'Beta squad' });
      await page.getByTestId('op-f-password').fill(STRONG_PASSWORD);
      await page.getByTestId('op-form-submit').click();
      await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Email already registered');
    } finally {
      await deleteCompany(companyId);
    }
  });

  test('OPC-02 a person\'s sign-ins and sessions; Revoke ends one session', async ({ freshCompany, browser, page }) => {
    // The company's owner signs in from a second browser: one session to revoke.
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await other.goto('/');
    await signInWithForm(other, { email: freshCompany.email, password: freshCompany.password });

    await operatorSignIn(page);
    await openCompany(page, freshCompany.name);
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    const row = page.getByTestId(`op-user-row-${freshCompany.email}`);
    await expect(row.getByTestId('op-user-last-sign-in')).toBeVisible({ timeout: 30000 });
    await row.getByTestId('op-user-details').click();
    await expect(page.getByTestId('op-user-detail')).toBeVisible();
    await expect(page.getByTestId('op-auth-events-table')).toContainText('Success');
    await expect(page.getByTestId('op-auth-events-table')).toContainText('Password');
    const valid = page.getByTestId('op-user-sessions').getByTestId('op-session-status').filter({ hasText: 'Valid' });
    const before = await valid.count();
    expect(before).toBeGreaterThanOrEqual(1);
    await page.getByTestId('op-user-sessions').getByTestId('op-session-revoke').first().click();
    await expect(page.getByTestId('op-confirm-run')).toBeDisabled();
    await page.getByTestId('op-confirm-check').check();
    await page.getByTestId('op-confirm-run').click();
    await expect(page.getByTestId('op-user-sessions').getByTestId('op-session-status').filter({ hasText: 'Revoked' }).first()).toBeVisible({ timeout: 30000 });
    await expect(valid).toHaveCount(before - 1);
    await ctx.close();
  });

  test('OPC-03 suspend a company until it pays; its people see why; reactivate', async ({ freshCompany, browser, page }) => {
    const ctx = await browser.newContext();
    const user = await ctx.newPage();
    await user.goto('/');
    await signInWithForm(user, { email: freshCompany.email, password: freshCompany.password });

    await operatorSignIn(page);
    await openCompany(page, freshCompany.name);
    await page.getByTestId('op-suspend-company').click();
    await page.getByTestId('op-f-reason').fill('Invoice 2026-11 unpaid');
    await page.getByTestId('op-f-billingNote').fill('Pay by bank transfer');
    await expect(page.getByTestId('op-form-submit')).toBeDisabled(); // the confirmation tick
    await page.getByTestId('op-confirm-check').check();
    await page.getByTestId('op-form-submit').click();
    await expect(page.getByTestId('op-suspended-note')).toContainText('Invoice 2026-11 unpaid', { timeout: 30000 });
    await page.getByTestId('op-back').click();
    await expect(page.getByTestId(`op-company-row-${freshCompany.id}`).getByTestId('op-company-status')).toHaveText('Suspended');

    // The open session: back to the sign-in screen with the message on the next request.
    await user.reload();
    await expect(user.getByText("Your organisation's access is suspended. Contact your administrator.")).toBeVisible({ timeout: 30000 });
    // Signing in again: the same message.
    await signInWithForm(user, { email: freshCompany.email, password: freshCompany.password }, { expectSuccess: false });
    await expect(user.getByText("Your organisation's access is suspended. Contact your administrator.").first()).toBeVisible();

    await openCompany(page, freshCompany.name);
    await page.getByTestId('op-reactivate-company').click();
    await page.getByTestId('op-confirm-check').check();
    await page.getByTestId('op-confirm-run').click();
    await expect(page.getByTestId('op-suspended-note')).toHaveCount(0, { timeout: 30000 });
    await signInWithForm(user, { email: freshCompany.email, password: freshCompany.password });
    await ctx.close();
  });

  test('OPC-04 deleting a team or a company needs the typed name', { tag: [TAG.negative] }, async ({ page }) => {
    const id = uid('opd');
    const name = `Op Delete ${id}`;
    await operatorSignIn(page);
    await page.getByTestId('op-create-company').click();
    await page.getByTestId('op-f-name').fill(name);
    await page.getByTestId('op-f-domain').fill(`${id}.uitest.example`);
    await page.getByTestId('op-form-submit').click();
    await expect(page.getByTestId('op-company-name')).toHaveText(name, { timeout: 30000 });
    const companyId = (await sql<{ id: string }>('SELECT id FROM companies WHERE name = $1', [name]))[0].id;
    try {
      await page.getByTestId('op-team-delete').first().click();
      await page.getByTestId('op-confirm-typed').fill('Team');
      await expect(page.getByTestId('op-confirm-run')).toBeDisabled();
      await page.getByTestId('op-confirm-typed').fill('Team 1');
      await page.getByTestId('op-confirm-run').click();
      await expect(page.getByTestId('op-organisation')).not.toContainText('Team 1', { timeout: 30000 });

      await page.getByTestId('op-delete-company').click();
      await page.getByTestId('op-confirm-typed').fill(name.toLowerCase());
      await expect(page.getByTestId('op-confirm-run')).toBeDisabled();
      await page.getByTestId('op-confirm-typed').fill(name);
      await page.getByTestId('op-confirm-run').click();
      await expect.poll(async () => (await sql('SELECT 1 FROM companies WHERE id = $1', [companyId])).length, { timeout: 30000 }).toBe(0);
    } finally {
      await sql('DELETE FROM companies WHERE id = $1', [companyId]);
    }
  });

  test('OPC-05 last views, sessions and the access log of a company', async ({ freshCompany, page, browser }) => {
    // The owner looks at their team once, so the team has a last view.
    const ctx = await browser.newContext();
    const owner = await ctx.newPage();
    await owner.goto('/');
    await signInWithForm(owner, { email: freshCompany.email, password: freshCompany.password });
    expect((await owner.request.get(`${API_URL}/teams/${encodeURIComponent(freshCompany.teamId)}`)).status()).toBe(200);

    await operatorSignIn(page);
    await openCompany(page, freshCompany.name);
    await page.getByRole('button', { name: 'Last views', exact: true }).click();
    await expect(page.getByTestId('op-views-teams')).toContainText(freshCompany.teamName, { timeout: 30000 });
    await expect(page.getByTestId('op-views-teams')).toContainText('Uitest Owner', { timeout: 30000 });
    await page.getByRole('button', { name: 'Sessions', exact: true }).click();
    await expect(page.getByTestId('op-sessions').getByTestId('op-session-status').first()).toHaveText('Valid', { timeout: 30000 });
    await page.getByRole('button', { name: 'Access log', exact: true }).click();
    await expect(page.getByTestId('op-access-log')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByTestId('op-user-activity-csv').click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    await page.getByRole('button', { name: 'Sign-ins', exact: true }).click();
    await page.getByTestId('ae-outcome').selectOption('success');
    await page.getByTestId('ae-apply').click();
    await expect(page.getByTestId('op-auth-events-table')).toContainText('Success', { timeout: 30000 });
    await ctx.close();
  });
});
