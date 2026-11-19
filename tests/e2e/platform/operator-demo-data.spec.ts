import fs from 'node:fs';
import path from 'node:path';
import { test, expect, TAG } from '../support/fixtures';
import { operatorSignIn } from '../support/operator';
import { withDb } from '../support/db';

/**
 * Platform support panel, company view: "Demo Data" (departments, Scrum teams, people and one year of
 * sample data, the shared password shown once) and "Populate metrics" (src/components/operator/
 * OperatorDemoData.tsx). Small numbers keep the run short. DEMO_SHOTS_DIR=<dir> also runs OPD-02,
 * which saves screenshots of the modal (before, progress, done) at device scale factor 2.
 */
const SHOTS = process.env.DEMO_SHOTS_DIR;
if (SHOTS) test.use({ deviceScaleFactor: 2, viewport: { width: 1280, height: 900 } });

test.describe('Platform support: Demo Data', { tag: [TAG.area('operator')] }, () => {
  test('OPD-01 Demo Data: sizes and preview, progress, then the password and one login per role level; Populate metrics', async ({ freshCompany, page }) => {
    test.setTimeout(180_000);
    await operatorSignIn(page);
    await page.getByRole('row', { name: new RegExp(freshCompany.name) }).getByTestId('operator-open-company').click();
    await page.getByTestId('op-demo-data').click();
    const dialog = page.getByTestId('op-demo-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('op-demo-preview')).toHaveText('Creates 3 departments, 9 teams, 57 people and one year of data.');
    // Out of range: no preview, Generate is off.
    await page.getByTestId('op-demo-membersPerTeam').fill('2');
    await expect(page.getByTestId('op-demo-preview')).toHaveText(/whole numbers within the ranges/);
    await expect(page.getByTestId('op-demo-submit')).toBeDisabled();
    await page.getByTestId('op-demo-departments').fill('1');
    await page.getByTestId('op-demo-teamsPerDepartment').fill('1');
    await page.getByTestId('op-demo-membersPerTeam').fill('3');
    await expect(page.getByTestId('op-demo-preview')).toHaveText('Creates 1 department, 1 team, 4 people and one year of data.');
    await page.getByTestId('op-demo-submit').click();
    await expect(page.getByTestId('op-demo-progress').or(page.getByTestId('op-demo-done'))).toBeVisible();
    await expect(page.getByTestId('op-demo-done')).toBeVisible({ timeout: 150_000 });
    await expect(page.getByTestId('op-demo-summary')).toContainText(/Done: 1 department, 1 team and 4 people with one year of data \([\d,]+ rows\)/);
    const password = (await page.getByTestId('op-demo-password').textContent())?.trim() ?? '';
    expect(password.length).toBeGreaterThanOrEqual(20);
    await expect(page.getByTestId('op-demo-logins').locator('li')).toHaveCount(4);
    for (const label of ['Manager', 'Team lead', 'Software engineer', 'Viewer']) await expect(page.getByTestId('op-demo-logins')).toContainText(label);
    const people = await withDb(async (c) => (await c.query(
      `SELECT role, job_title FROM users WHERE company_id = $1 AND job_title IS NOT NULL ORDER BY role`, [freshCompany.id])).rows);
    expect(people.map((p: { role: string }) => p.role).sort()).toEqual(['qa_engineer', 'qa_manager', 'team_lead', 'viewer']);
    await page.getByTestId('op-demo-close').click();
    await expect(dialog).toHaveCount(0);

    // Populate metrics: the new team already has its year (topped up), the company's first team has
    // nobody to attribute work to (skipped). Nobody is created and no password is shown.
    await page.getByTestId('op-populate-metrics').click();
    await page.getByTestId('op-demo-submit').click();
    await expect(page.getByTestId('op-demo-done')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('op-demo-summary')).toContainText('one year of data for 0 teams');
    await expect(page.getByTestId('op-demo-summary')).toContainText('without a team lead or engineer skipped');
    await expect(page.getByTestId('op-demo-password')).toHaveCount(0);
    await page.getByTestId('op-demo-close').click();
  });

  test('OPD-02 screenshots of the modal (only with DEMO_SHOTS_DIR)', async ({ freshCompany, page }) => {
    test.skip(!SHOTS, 'screenshots only');
    test.setTimeout(240_000);
    const shot = async (name: string) => {
      fs.mkdirSync(SHOTS!, { recursive: true });
      await page.getByRole('dialog').screenshot({ path: path.join(SHOTS!, `${name}.png`) });
    };
    await operatorSignIn(page);
    await page.getByRole('row', { name: new RegExp(freshCompany.name) }).getByTestId('operator-open-company').click();
    await page.getByTestId('op-demo-data').click();
    await page.getByTestId('op-demo-departments').fill('2');
    await page.getByTestId('op-demo-teamsPerDepartment').fill('3');
    await page.getByTestId('op-demo-membersPerTeam').fill('7');
    await expect(page.getByTestId('op-demo-preview')).toHaveText('Creates 2 departments, 6 teams, 44 people and one year of data.');
    await shot('1-before');
    await page.getByTestId('op-demo-submit').click();
    await expect(page.getByTestId('op-demo-step')).toContainText(' of ', { timeout: 60_000 });
    await shot('2-progress');
    await expect(page.getByTestId('op-demo-done')).toBeVisible({ timeout: 200_000 });
    await shot('3-done');
  });
});
