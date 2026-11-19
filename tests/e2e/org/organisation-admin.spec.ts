import fs from 'fs';
import { test, expect, TAG } from '../support/fixtures';
import { API_URL } from '../support/env';
import { uid } from '../support/ids';
import { STRONG_PASSWORD } from '../support/data';
import { ROLES } from '../support/roles';
import { sql } from '../support/db';
import type { Page } from '@playwright/test';

/**
 * Organisation pages in a fresh organisation (freshCompany): Departments, Teams and Users (create,
 * edit, deactivate, delete, assignments), validation and duplicates, names with markup, the
 * Activity log with undo, and the User activity log with filters and CSV. Manager limits are
 * checked read-only on the demo company.
 */

const swalConfirm = (page: Page) => page.getByRole('button', { name: 'Yes, delete it!' }).click();
const XSS = '<img src=x onerror="window.__xss=1">';

async function createDepartment(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create department' }).first().click();
  await page.getByLabel('Department Name').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Create department' }).click();
}

async function addUser(page: Page, v: { first: string; last: string; email: string; password: string; role?: string; team?: string }) {
  await page.getByTestId('add-user-btn').click();
  const d = page.getByRole('dialog');
  await d.getByLabel('First Name').fill(v.first);
  await d.getByLabel('Last Name').fill(v.last);
  await d.getByLabel('Email').fill(v.email);
  await d.getByLabel('Password').fill(v.password);
  await d.getByLabel('Role').selectOption(v.role ?? 'qa_engineer');
  if (v.team) await d.getByTestId('team-select').selectOption({ label: v.team });
  await d.getByTestId('create-user-btn').click();
}

test.describe('Departments', { tag: [TAG.area('org')] }, () => {
  test('ORG-01 create, rename and delete a department; a duplicate name is refused; cancelling a delete keeps it', { tag: [TAG.smoke, TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/departments');
    const name = `Dept ${uid().slice(-6)}`;
    await createDepartment(page, name);
    await expect(page.getByText('Department created successfully!')).toBeVisible();
    await expect(page.getByRole('cell', { name }).first()).toBeVisible();

    await createDepartment(page, name);
    await expect(page.getByText(/Failed to create department/)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: `Edit ${name}` }).click();
    await page.getByLabel('Department Name').fill(`${name} renamed`);
    await page.getByRole('dialog').getByRole('button', { name: /Save|Update/ }).click();
    await expect(page.getByText('Department updated successfully!')).toBeVisible();

    await page.getByRole('button', { name: `Delete ${name} renamed` }).click();
    await page.getByRole('button', { name: 'No, cancel!' }).click();
    await expect(page.getByRole('cell', { name: `${name} renamed` }).first()).toBeVisible();
    await page.getByRole('button', { name: `Delete ${name} renamed` }).click();
    await swalConfirm(page);
    await expect(page.getByText('Department deleted successfully!')).toBeVisible();
    await expect(page.getByRole('cell', { name: `${name} renamed` })).toHaveCount(0);
  });

  test('ORG-02 a department name with markup is stored and shown as text', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/departments');
    await createDepartment(page, `X ${XSS}`);
    await expect(page.getByText(`X ${XSS}`).first()).toBeVisible();
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  });
});

test.describe('Moving teams and the Admin console', { tag: [TAG.area('org')] }, () => {
  test('ORG-03 a team moves to another department after the move plan is shown', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/departments');
    await createDepartment(page, 'Second Department');
    await expect(page.getByText('Department created successfully!')).toBeVisible();
    await page.getByRole('button', { name: freshCompany.departmentName, exact: true }).click();
    await page.getByLabel(`Move ${freshCompany.teamName} to another department`).selectOption({ label: 'Second Department' });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`What moves with ${freshCompany.teamName}`);
    await dialog.getByRole('button', { name: 'Move to Second Department' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('row', { name: /Second Department/ })).toContainText('1');
  });

  test('ORG-04 the Admin console creates a team that then appears on the Teams page', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page, app }) => {
    await signInAs(freshCompany, '/admin-panel');
    const name = `Console Team ${uid().slice(-5)}`;
    await page.getByRole('button', { name: 'Create Team' }).first().click();
    await page.getByTestId('create-team-name').fill(name);
    const dept = page.getByTestId('create-team-department');
    if (await dept.count()) await dept.selectOption({ label: freshCompany.departmentName });
    await page.locator('form').getByRole('button', { name: 'Create Team' }).click();
    await app.go('nav-teams', 'Teams');
    await expect(page.locator(`[data-testid="team-row"][data-team-name="${name}"]`)).toBeVisible();
  });
});

test.describe('Teams', { tag: [TAG.area('org')] }, () => {
  test('ORG-10 create, edit and delete a team', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/teams');
    const name = `Team ${uid().slice(-6)}`;
    await page.getByTestId('add-team-btn').click();
    await page.getByTestId('team-name-input').fill(name);
    await page.getByRole('dialog').locator('select').selectOption({ label: freshCompany.departmentName });
    await page.getByTestId('create-team-btn').click();
    await expect(page.getByText('Team created')).toBeVisible();
    const row = page.locator(`[data-testid="team-row"][data-team-name="${name}"]`);
    await expect(row).toBeVisible();
    await row.getByTestId('edit-team-btn').click();
    await page.getByRole('dialog').getByRole('textbox').first().fill(`${name} 2`);
    await page.getByRole('dialog').getByRole('button', { name: /Save/ }).click();
    await expect(page.getByText('Team updated')).toBeVisible();
    const renamed = page.locator(`[data-testid="team-row"][data-team-name="${name} 2"]`);
    await renamed.getByTestId('delete-team-btn').click();
    await swalConfirm(page);
    await expect(renamed).toHaveCount(0);
  });

  test('ORG-11 a team needs a name and a department; a very long unicode name does not break the list', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/teams');
    await page.getByTestId('add-team-btn').click();
    await page.getByTestId('create-team-btn').click();
    await expect(page.getByRole('dialog')).toBeVisible(); // the browser's required-field check keeps it open
    expect(await page.getByTestId('team-name-input').evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    const long = `Ünïcødé 团队 🚀 ${'Long-Name-'.repeat(20)}`;
    await page.getByTestId('team-name-input').fill(long);
    await page.getByRole('dialog').locator('select').selectOption({ label: freshCompany.departmentName });
    await page.getByTestId('create-team-btn').click();
    const created = page.getByText('Team created').or(page.getByRole('status').filter({ hasText: /long|characters|name/i }));
    await expect(created.first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Users and assignments', { tag: [TAG.area('org')] }, () => {
  test('ORG-20 a super admin adds a user with a password, edits, deactivates, reactivates and deletes them', { tag: [TAG.smoke, TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/users');
    const email = `${uid('person')}@${freshCompany.email.split('@')[1]}`;
    await addUser(page, { first: 'Pat', last: 'Person', email, password: STRONG_PASSWORD, team: freshCompany.teamName });
    await expect(page.getByText('User created successfully!')).toBeVisible();
    const card = page.getByTestId('user-card').filter({ hasText: email });
    await expect(card.getByTestId('user-status')).toHaveText('Active');

    await card.getByTestId('edit-btn').click();
    await page.getByRole('dialog').getByLabel('First Name').fill('Patricia');
    await page.getByRole('dialog').getByRole('button', { name: /Save Changes/ }).click();
    await expect(page.getByText('User updated successfully!')).toBeVisible();
    await expect(card).toContainText('Patricia');

    await card.getByTestId('user-status-toggle').click();
    await expect(card.getByTestId('user-status')).toHaveText('Inactive');
    await card.getByTestId('user-status-toggle').click();
    await expect(card.getByTestId('user-status')).toHaveText('Active');

    await card.getByTestId('delete-btn').click();
    await swalConfirm(page);
    await expect(page.getByText('User deleted!')).toBeVisible();
  });

  test('ORG-21 adding a user: an e-mail already in use and a weak password are refused with the reason', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/users');
    await addUser(page, { first: 'Dup', last: 'Licate', email: ROLES.viewer.email, password: STRONG_PASSWORD, team: freshCompany.teamName });
    await expect(page.getByText(/^Failed: /)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await addUser(page, { first: 'Weak', last: 'Password', email: `${uid('weak')}@${freshCompany.email.split('@')[1]}`, password: 'abc', team: freshCompany.teamName });
    await expect(page.getByText(/^Failed: /).last()).toBeVisible();
    await expect(page.getByTestId('user-card').filter({ hasText: 'Weak Password' })).toHaveCount(0);
  });

  test('ORG-22 names with markup are shown as text on the users page', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/users');
    const email = `${uid('xss')}@${freshCompany.email.split('@')[1]}`;
    await addUser(page, { first: XSS, last: '<b>Bold</b>', email, password: STRONG_PASSWORD, team: freshCompany.teamName });
    const outcome = page.getByText('User created successfully!').or(page.getByText(/^Failed: /));
    await expect(outcome.first()).toBeVisible();
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
    await expect(page.locator('b', { hasText: 'Bold' })).toHaveCount(0);
  });

  test('ORG-23 an assignment is added as a chip and removed again after a confirmation in the page', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/users');
    const email = `${uid('chip')}@${freshCompany.email.split('@')[1]}`;
    await addUser(page, { first: 'Chip', last: 'Holder', email, password: STRONG_PASSWORD, team: freshCompany.teamName });
    const card = page.getByTestId('user-card').filter({ hasText: email });
    const before = await card.getByTestId('assignment-chip').count();
    await card.getByTestId('add-assignment').click();
    await page.getByTestId('assign-role').selectOption('viewer');
    await page.getByTestId('assign-scope').selectOption({ index: 1 }).catch(() => undefined);
    await page.getByTestId('assign-submit').click();
    await expect(card.getByTestId('assignment-chip')).toHaveCount(before + 1);
    let browserDialog = false;
    page.on('dialog', (d) => { browserDialog = true; void d.dismiss(); });
    // Cancel keeps the assignment.
    await card.getByRole('button', { name: /^Remove Viewer of / }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove this assignment?' });
    await expect(confirm).toContainText(/Remove Viewer of .+ from Chip Holder\?/);
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(card.getByTestId('assignment-chip')).toHaveCount(before + 1);
    // Escape closes it too.
    await card.getByRole('button', { name: /^Remove Viewer of / }).click();
    await expect(confirm).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirm).toHaveCount(0);
    await expect(card.getByTestId('assignment-chip')).toHaveCount(before + 1);
    // Confirmed, it is removed.
    await card.getByRole('button', { name: /^Remove Viewer of / }).click();
    await confirm.getByRole('button', { name: 'Remove assignment' }).click();
    await expect(page.getByText(/Chip Holder: removed Viewer of/)).toBeVisible();
    await expect(card.getByTestId('assignment-chip')).toHaveCount(before);
    expect(browserDialog, 'no window.confirm').toBe(false);
  });

  test('ORG-24 nobody can deactivate or delete themselves', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/users');
    const me = page.getByTestId('user-card').filter({ hasText: freshCompany.email });
    await expect(me).toBeVisible();
    await expect(me.getByTestId('user-status-toggle')).toHaveCount(0);
    await expect(me.getByTestId('delete-btn')).toHaveCount(0);
  });

  test('ORG-25 a manager cannot edit or remove the super admin', { tag: [TAG.negative, TAG.role('manager')] }, async ({ signInAs, page }) => {
    await signInAs('manager', '/users');
    await page.getByPlaceholder('Search users by name, email, team...').fill(ROLES.admin.email);
    const admin = page.getByTestId('user-card').filter({ hasText: ROLES.admin.email });
    if (await admin.count()) {
      await expect(admin.getByTestId('delete-btn')).toHaveCount(0);
      await expect(admin.getByTestId('user-status-toggle')).toHaveCount(0);
    }
    const [{ id }] = await sql<{ id: string }>('SELECT id FROM users WHERE email = $1', [ROLES.admin.email]);
    const res = await page.request.post(`${API_URL}/admin/users/${id}/toggle-status`);
    expect(res.status()).toBe(403);
    expect((await sql('SELECT is_active FROM users WHERE id = $1', [id]))[0].is_active).toBe(true);
  });
});

test.describe('Activity and user activity', { tag: [TAG.area('activity')] }, () => {
  test('ORG-30 the Activity log records a deactivation; Undo restores it and cannot be done twice', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page, app }) => {
    await signInAs(freshCompany, '/users');
    const email = `${uid('undo')}@${freshCompany.email.split('@')[1]}`;
    await addUser(page, { first: 'Undo', last: 'Me', email, password: STRONG_PASSWORD, team: freshCompany.teamName });
    const card = page.getByTestId('user-card').filter({ hasText: email });
    await card.getByTestId('user-status-toggle').click();
    await expect(card.getByTestId('user-status')).toHaveText('Inactive');

    await app.go('nav-activity', 'Activity');
    const row = page.getByTestId('activity-row').filter({ has: page.getByText(/^Deactivated Undo Me/) });
    await expect(row).toHaveCount(1);
    await row.getByTestId('undo-btn').click();
    await page.getByTestId('undo-confirm').click();
    await expect(page.getByTestId('activity-row').filter({ has: page.getByText(/^Undid: Deactivated Undo Me/) })).toHaveCount(1);
    await expect(row).toContainText(/undone by/);
    await expect(row.getByTestId('undo-btn')).toHaveCount(0);

    await app.go('nav-users', 'Users');
    await expect(page.getByTestId('user-card').filter({ hasText: email }).getByTestId('user-status')).toHaveText('Active');
  });

  test('ORG-31 Activity search narrows the list; a search with no match says so', { tag: [TAG.negative] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/activity');
    await expect(page.getByTestId('activity-row').first()).toBeVisible();
    await page.getByLabel('Search').fill(`no-such-thing-${uid()}`);
    await expect(page.getByTestId('activity-row')).toHaveCount(0);
    await page.getByLabel('Search').fill('');
    await expect(page.getByTestId('activity-row').first()).toBeVisible();
  });

  test('ORG-32 User activity lists the sign-in and screens; filters; CSV export', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/compare');
    await page.goto('/user-activity');
    await expect(page.getByTestId('user-activity-notice')).toBeVisible();
    const rows = page.getByTestId('user-activity-row');
    await expect(rows.first()).toBeVisible();
    await page.getByTestId('ua-type').selectOption({ index: 1 });
    await expect(page.getByTestId('user-activity-list').or(page.getByText(/No activity|Nothing/))).toBeVisible();
    await page.getByTestId('ua-type').selectOption({ index: 0 });
    await page.getByLabel('Request id').fill(`no-such-request-${uid()}`);
    await expect(rows).toHaveCount(0);
    await page.getByLabel('Request id').fill('');
    const dl = page.waitForEvent('download');
    await page.getByRole('link', { name: /Export CSV/ }).or(page.getByRole('button', { name: /Export CSV/ })).first().click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
    const text = fs.readFileSync((await file.path())!, 'utf8');
    expect(text).toContain(freshCompany.email);
  });

  test('ORG-33 a manager has no User activity and the API refuses it', { tag: [TAG.negative, TAG.role('manager')] }, async ({ signInAs, page }) => {
    await signInAs('manager', '/user-activity');
    await expect(page.getByTestId('dashboard')).toBeVisible();
    const res = await page.request.get(`${API_URL}/activity/log`);
    expect(res.status()).toBe(403);
  });
});
