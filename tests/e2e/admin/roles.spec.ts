import { test, expect, TAG } from '../support/fixtures';
import { API_URL } from '../support/env';

/**
 * Roles (Organisation → Roles) and invitations that give several assignments.
 *
 *   ROLE-01  the page shows the access levels and the recommended roles; a recommended role opens pre-filled,
 *            can be adjusted, is created, edited later ("Back to recommended" restores the level's set) and archived
 *   ROLE-02  an invitation with a custom role on three teams of two departments: the summary lists them, the
 *            invitation row and the accept page show all of them
 *   ROLE-03  a team lead reads the Roles page and cannot change it
 */
test.describe('Roles and invitations with several assignments', { tag: ['@area:admin'] }, () => {
  test.describe.configure({ mode: 'default' });

  test('ROLE-01 a recommended role is created, adjusted and archived', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/roles');
    await expect(page.getByTestId('role-level')).toHaveCount(5);
    await expect(page.getByTestId('roles-custom')).toContainText('No roles of your own yet');
    // The recommendation of the level: a team lead writes team data, a software engineer does not.
    await expect(page.locator('[data-level="team_lead"]')).toContainText('Yes: Actions, alerts and team data');
    await expect(page.locator('[data-level="qa_engineer"]')).toContainText('No: Actions, alerts and team data');

    await page.locator('[data-template="scrum_master"]').getByRole('button', { name: /Use the recommended role/ }).click();
    const form = page.getByTestId('role-form');
    await expect(form.getByTestId('role-name')).toHaveValue('Scrum Master');
    await expect(form.getByTestId('role-base')).toHaveValue('qa_engineer');
    await expect(form.getByTestId('role-cap-write_team_data')).toBeChecked();
    await expect(form.getByTestId('role-cap-run_pulse')).toBeChecked();
    await expect(form.getByTestId('role-cap-view_individuals')).not.toBeChecked();
    // Logs need a department: not available on a team-level role.
    await expect(form.getByTestId('role-cap-view_logs')).toBeDisabled();
    // More rights than recommended: the money view.
    await form.getByTestId('role-cap-view_money').check();
    await form.getByTestId('role-save').click();
    await expect(page.getByText('Role “Scrum Master” created')).toBeVisible();

    const card = page.locator('[data-role-name="Scrum Master"]');
    await expect(card).toContainText('Customised');
    await expect(card).toContainText('Yes: Money at risk and the revenue roll-up(added)');
    await expect(page.locator('[data-template="scrum_master"]')).toContainText('In use');

    // Later: back to the level's recommendation, then one right.
    await card.getByRole('button', { name: 'Edit the role Scrum Master' }).click();
    await expect(form.getByTestId('role-base')).toBeDisabled();
    await form.getByTestId('role-reset').click();
    await expect(form.getByTestId('role-cap-write_team_data')).not.toBeChecked();
    await form.getByTestId('role-cap-write_team_data').check();
    await form.getByTestId('role-save').click();
    await expect(page.getByText(/Scrum Master: saved/)).toBeVisible();
    await expect(card).toContainText('No: Money at risk and the revenue roll-up');

    await card.getByRole('button', { name: 'Archive the role Scrum Master' }).click();
    await page.getByTestId('role-archive-confirm').click();
    await expect(page.getByTestId('roles-custom')).toContainText('No roles of your own yet');
  });

  test('ROLE-02 one invitation, a custom role on three teams of two departments', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/');
    const post = async (path: string, data: object) => {
      const res = await page.request.post(`${API_URL}${path}`, { data });
      expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
      return res.json();
    };
    const dept = await post('/admin/departments', { name: 'Platform' });
    await post('/admin/teams', { name: 'Team A', departmentId: dept.id });
    await post('/admin/teams', { name: 'Team B', departmentId: dept.id });
    await post('/roles', { name: 'Scrum Master', baseRole: 'qa_engineer', added: ['write_team_data', 'run_pulse'], templateKey: 'scrum_master', description: 'Runs the improvement loop.' });

    await page.goto('/users');
    await page.getByTestId('invite-user-btn').click();
    const email = `sm-${Date.now()}@example.test`;
    await page.getByTestId('invite-email').fill(email);
    await page.getByTestId('invite-role').selectOption({ label: 'Scrum Master' });
    await expect(page.getByTestId('invite-role-description')).toHaveText('Runs the improvement loop.');
    await page.getByTestId('invite-scope').selectOption({ label: `${freshCompany.teamName} (${freshCompany.departmentName})` });
    // Two more teams, in the other department. A team already chosen is not offered again.
    await page.getByTestId('invite-extra-add').click();
    await page.getByTestId('invite-extra-add').click();
    const rows = page.getByTestId('invite-extra-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByTestId('invite-extra-role')).toHaveValue(/^custom:/);
    // Each new row takes the next free team of the same role; a team chosen in one row is not offered in another.
    const chosen = await rows.getByTestId('invite-extra-scope').evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).selectedOptions[0].textContent));
    expect([...chosen].sort()).toEqual(['Team A (Platform)', 'Team B (Platform)']);
    await expect(rows.nth(0).getByTestId('invite-extra-scope').locator('option')).toHaveCount(1);
    const summary = page.getByTestId('invite-summary');
    for (const t of [freshCompany.teamName, 'Team A', 'Team B']) await expect(summary).toContainText(`Scrum Master of ${t}`);
    await page.getByTestId('invite-submit').click();

    // No mail server in the test environment: the link is shown to pass on.
    const link = await page.getByTestId('invite-link').inputValue();
    await page.getByRole('button', { name: 'Done' }).click();
    const row = page.getByTestId('invitation-row').filter({ hasText: email });
    for (const t of [freshCompany.teamName, 'Team A', 'Team B']) await expect(row).toContainText(`Scrum Master of ${t}`);

    // The invited person sees everything they are getting before accepting.
    await page.context().clearCookies();
    await page.goto(link);
    const access = page.getByTestId('invite-access');
    await expect(access.locator('li')).toHaveCount(3);
    await expect(access).toContainText('Scrum Master of Team B');
  });

  test('ROLE-03 a team lead reads the roles and cannot change them', { tag: [TAG.role('lead')] }, async ({ signInAs, page }) => {
    await signInAs('lead', '/roles');
    await expect(page.getByTestId('role-level')).toHaveCount(5);
    await expect(page.getByTestId('role-new')).toHaveCount(0);
    await expect(page.getByTestId('roles-templates')).toHaveCount(0);
  });
});
