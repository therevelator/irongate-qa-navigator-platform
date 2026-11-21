import { test, expect, TAG } from '../support/fixtures';
import { createFixtureTeam, deleteFixtureTeam, type FixtureTeam, type FreshCompany } from '../support/data';
import { sql } from '../support/db';
import { uid } from '../support/ids';
import type { Page } from '@playwright/test';

/**
 * Stored XSS through names (SECURITY.md "Input handling"). The API now refuses names with markup,
 * so these tests plant the payload DIRECTLY in the database, as legacy data written before the
 * validation existed would be, and then walk the attacker's path: a super admin opens the
 * confirmation dialogs, toasts and "cannot delete" warnings that show those names.
 *
 * Each test asserts that (1) no payload ran: window.__xss and the data-xss attribute that the
 * onerror handler sets are absent, no <img src="x"> or <b data-xss-bold> element was created, and
 * (2) the name is shown literally, as text, in the dialog.
 *
 *   XSS-01 Users page: Delete user dialog and the Cancelled dialog show a user's name as text
 *   XSS-02 Admin console: Delete user, then Deactivate user dialog and the "deactivated" toast
 *   XSS-03 Admin console: deleting a team (name with markup) with active members lists the
 *          members' names as text in the "Cannot delete team" warning
 *   XSS-04 Teams page: deleting a team with members (the warning lists names as text), and deleting
 *          an empty team (the "deactivated" toast shows its name as text)
 *   XSS-05 Departments page: Delete department dialog and the Cancelled dialog
 *   XSS-06 Manual metrics: the "Team Metrics Saved" dialog shows the team's name as text
 */

// Short enough for users.first_name (varchar 100).
const XSS_HANDLER = 'window.__xss=1;document.documentElement.dataset.xss=1';
const FIRST = `<img src=x onerror="${XSS_HANDLER}">`;
const LAST = '<b data-xss-bold="1">Bold</b>';
const TEAM = `Team <img src=x onerror="${XSS_HANDLER}">`;
const DEPT = `Dept <img src=x onerror="${XSS_HANDLER}">`;

const popup = (page: Page) => page.locator('.swal2-popup');

/**
 * A SweetAlert2 dialog or toast is open (it shows `fixed`, a literal of the code): first check that
 * nothing ran, then that `literal` (the name) is shown as text.
 */
async function dialogShowsAsText(page: Page, fixed: string, literal: string, where = popup(page)) {
  await expect(where).toContainText(fixed);
  await expectNoScriptRan(page);
  await expect(where).toContainText(literal);
}

async function expectNoScriptRan(page: Page) {
  // An <img src=x> fails to load within a few milliseconds; give the handler time to run.
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), 'the onerror payload ran (window.__xss)').toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-xss')), 'the onerror payload ran (data-xss)').toBeNull();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator('[data-xss-bold]')).toHaveCount(0);
}

/** Legacy data: names with markup written straight to the database (the API refuses them now). */
async function plantLegacyNames(co: FreshCompany, opts: { team?: boolean; dept?: boolean } = {}): Promise<{ userId: string; email: string }> {
  const userId = uid('uit-xss');
  const email = `${userId}@${co.email.split('@')[1]}`;
  const [{ password_hash }] = await sql<{ password_hash: string }>('SELECT password_hash FROM users WHERE email = $1', [co.email]);
  await sql(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, department_id, primary_team_id, is_active, email_verified)
     VALUES ($1, $2, $3, $4, $5, 'qa_engineer', $6, $7, $8, TRUE, TRUE)`,
    [userId, email, password_hash, FIRST, LAST, co.id, co.departmentId, co.teamId]);
  await sql(`INSERT INTO role_assignments (id, company_id, user_id, role, scope_type, scope_id) VALUES ($1, $2, $3, 'qa_engineer', 'team', $4)`,
    [`${userId}-ra`, co.id, userId, co.teamId]);
  if (opts.team) await sql('UPDATE teams SET name = $2 WHERE id = $1', [co.teamId, TEAM]);
  if (opts.dept) await sql('UPDATE departments SET name = $2 WHERE id = $1', [co.departmentId, DEPT]);
  return { userId, email };
}

test.describe('Stored XSS: names with markup are shown as text', { tag: [TAG.area('org'), TAG.area('admin'), TAG.negative] }, () => {
  test('XSS-01 Users page: the Delete user and Cancelled dialogs show the name as text and run nothing', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    const { email } = await plantLegacyNames(freshCompany);
    await signInAs(freshCompany, '/users');
    const card = page.getByTestId('user-card').filter({ hasText: email });
    await card.getByTestId('delete-btn').click();
    await dialogShowsAsText(page, 'will be permanently deleted.', `${FIRST} ${LAST} will be permanently deleted.`);
    await page.getByRole('button', { name: 'No, cancel!' }).click();
    await dialogShowsAsText(page, 'is safe.', `${FIRST} ${LAST} is safe.`);
  });

  test('XSS-02 Admin console: Delete user, Deactivate user and the deactivated toast show the name as text and run nothing', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    const { userId } = await plantLegacyNames(freshCompany);
    await signInAs(freshCompany, '/admin-panel');
    await page.locator('h3', { hasText: freshCompany.departmentName }).first().click();
    await page.getByTestId('team-row').filter({ hasText: freshCompany.teamName }).getByText(freshCompany.teamName, { exact: true }).click();
    const row = page.getByTestId('user-row').filter({ hasText: 'onerror' });
    await expect(row).toContainText(`${FIRST} ${LAST}`);
    await row.getByTitle('Delete User').click();
    await dialogShowsAsText(page, 'will be permanently deleted.', `${FIRST} ${LAST} will be permanently deleted.`);
    await page.getByRole('button', { name: 'Yes, delete it!' }).click();
    await dialogShowsAsText(page, 'has been deleted.', `${FIRST} ${LAST} has been deleted.`);

    // The console's own Delete User panel, then the Deactivate User? dialog.
    await page.locator('div.fixed.inset-0').getByRole('button', { name: 'Delete User', exact: true }).click();
    await dialogShowsAsText(page, 'Deactivate User?', `${FIRST} ${LAST} will be deactivated`);
    await page.getByRole('button', { name: 'Yes, deactivate' }).click();
    await dialogShowsAsText(page, 'has been deactivated', `${FIRST} ${LAST} has been deactivated`, page.locator('.swal2-toast'));
    expect((await sql<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1', [userId]))[0].is_active).toBe(false);
  });

  test('XSS-03 Admin console: deleting a team with markup in its name lists the members\' names as text', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await plantLegacyNames(freshCompany, { team: true });
    await signInAs(freshCompany, '/admin-panel');
    await page.locator('h3', { hasText: freshCompany.departmentName }).first().click();
    const teamRow = page.getByTestId('team-row').filter({ hasText: TEAM });
    await teamRow.getByTitle('Delete Team').click();
    await dialogShowsAsText(page, 'will be permanently deleted.', `${TEAM} will be permanently deleted.`);
    await page.getByRole('button', { name: 'Yes, delete it!' }).click();
    await dialogShowsAsText(page, 'Cannot Delete Team', `${FIRST} ${LAST}`);
    await expect(popup(page).locator('li', { hasText: 'onerror' })).toHaveText(`${FIRST} ${LAST}`);
  });

  test('XSS-04 Teams page: the Cannot delete team warning and the deactivated toast show names as text', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await plantLegacyNames(freshCompany, { team: true });
    // A second team with markup in its name and nobody on it: deleting it succeeds (toast).
    const emptyTeamId = uid('uit-xss-team');
    const emptyTeam = `Empty <img src=x onerror="${XSS_HANDLER}">`;
    await sql(`INSERT INTO teams (id, company_id, department_id, name, is_active) VALUES ($1, $2, $3, $4, TRUE)`, [emptyTeamId, freshCompany.id, freshCompany.departmentId, emptyTeam]);

    await signInAs(freshCompany, '/teams');
    const row = page.locator(`[data-testid="team-row"][data-team-id="${freshCompany.teamId}"]`);
    await expect(row).toContainText(TEAM);
    await row.getByTestId('delete-team-btn').click();
    await dialogShowsAsText(page, 'will be permanently deleted.', `${TEAM} will be permanently deleted.`);
    await page.getByRole('button', { name: 'Yes, delete it!' }).click();
    await dialogShowsAsText(page, 'Cannot Delete Team', `${FIRST} ${LAST}`);
    await expect(popup(page).locator('li', { hasText: 'onerror' })).toHaveText(`${FIRST} ${LAST}`);
    await page.getByRole('button', { name: 'I Understand' }).click();

    await page.locator(`[data-testid="team-row"][data-team-id="${emptyTeamId}"]`).getByTestId('delete-team-btn').click();
    await dialogShowsAsText(page, 'will be permanently deleted.', `${emptyTeam} will be permanently deleted.`);
    await page.getByRole('button', { name: 'Yes, delete it!' }).click();
    await dialogShowsAsText(page, 'deactivated', `${emptyTeam} deactivated`, page.locator('.swal2-toast'));
  });

  test('XSS-05 Departments page: the Delete department and Cancelled dialogs show the name as text', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await plantLegacyNames(freshCompany, { dept: true });
    await signInAs(freshCompany, '/departments');
    await page.getByRole('button', { name: `Delete ${DEPT}` }).click();
    await dialogShowsAsText(page, 'will be permanently deleted.', `${DEPT} will be permanently deleted.`);
    await page.getByRole('button', { name: 'No, cancel!' }).click();
    await dialogShowsAsText(page, 'is safe.', `${DEPT} is safe.`);
  });
});

test.describe('Stored XSS: a team name with markup in Manual metrics', { tag: [TAG.area('admin'), TAG.area('metrics'), TAG.negative] }, () => {
  let team: FixtureTeam;
  test.beforeAll(async () => { team = await createFixtureTeam({ lead: true, name: `${TEAM} ${uid().slice(-5)}` }); });
  test.afterAll(async () => { await deleteFixtureTeam(team); });

  test('XSS-06 the Team Metrics Saved dialog shows the team name as text and runs nothing', { tag: [TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs({ email: team.leadEmail!, password: 'demo123' }, '/manual-metrics');
    await page.locator('select').first().selectOption(team.id);
    await page.getByPlaceholder('e.g., 8500').first().fill('850');
    await page.getByPlaceholder('e.g., 10000').first().fill('1000');
    await page.getByRole('button', { name: 'Save team metrics' }).click();
    await expect(page.getByRole('heading', { name: 'Team Metrics Saved' })).toBeVisible();
    await dialogShowsAsText(page, 'metrics saved successfully', `${team.name} metrics saved successfully`);
  });
});
