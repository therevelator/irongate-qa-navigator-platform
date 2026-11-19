import { test, expect, TAG } from '../support/fixtures';
import { ALL_ROLES, ROLES, DEMO } from '../support/roles';
import { API_URL } from '../support/env';
import { createFixtureUser, deleteFixtureUser } from '../support/data';

/**
 * Top bar (src/components/Layout.tsx, HeaderParts.tsx): QE Navigator shield and name, page title,
 * company badge, the person with their job title (or role label), "What you can do here"
 * (src/lib/accessSummary.ts, from server/lib/userPolicy.ts), the account menu; phone layout.
 */

test.describe('Top bar', { tag: [TAG.area('navigation')] }, () => {
  for (const role of ALL_ROLES) {
    test(`HDR-01 ${role}: brand, company badge, name and role label`, { tag: [TAG.role(role)] }, async ({ signInAs, page }) => {
      await signInAs(role);
      const brand = page.getByRole('button', { name: 'QE Navigator, go to overview' });
      await expect(brand).toBeVisible();
      await expect(brand.getByRole('img', { name: 'IronGate' })).toHaveAttribute('src', /\/brand\/qe-shield-40\.png$/);
      await expect(page.getByTestId('company-badge')).toContainText('NovaTech');
      await expect(page.getByTestId('header-person-title')).toHaveText(ROLES[role].label);
    });
  }

  test('HDR-02 viewer: "What you can do here" says her role, scope and limits; Escape and outside click close it', { tag: [TAG.role('viewer'), TAG.smoke, TAG.a11y] }, async ({ signInAs, page }) => {
    await signInAs('viewer');
    const button = page.getByTestId('access-help-button');
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'What you can do here' });
    await expect(dialog).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('access-help-roles')).toContainText(`Viewer · ${DEMO.leadTeam.name}`);
    await expect(page.getByTestId('access-help-scope')).toHaveText(`You see ${DEMO.leadTeam.name}. Other teams are not shown to you.`);
    await expect(page.getByTestId('access-help-can')).toContainText('in TV mode');
    await expect(page.getByTestId('access-help-cannot')).toContainText('Change settings, KPI targets or alert rules.');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
    await button.click();
    await expect(dialog).toBeVisible();
    await page.getByTestId('dashboard').click({ position: { x: 5, y: 5 } });
    await expect(dialog).toHaveCount(0);
  });

  test('HDR-03 super admin: help lists company-wide powers and nothing she cannot do', { tag: [TAG.role('admin')] }, async ({ signInAs, page }) => {
    await signInAs('admin');
    await page.getByTestId('access-help-button').click();
    await expect(page.getByTestId('access-help-scope')).toHaveText('You see every team of NovaTech.');
    await expect(page.getByTestId('access-help-can')).toContainText('Set people\'s job titles.');
    await expect(page.getByTestId('access-help-cannot')).toHaveCount(0);
  });

  test('HDR-04 a job title set by a super admin replaces the role label; only super admins may set it', { tag: [TAG.role('admin'), TAG.role('viewer')] }, async ({ signInAs, page, app }) => {
    // Own fixture viewer (tests run in parallel: the demo viewer's title stays untouched).
    const person = await createFixtureUser({ role: 'viewer', teamId: DEMO.leadTeam.id });
    try {
      await signInAs('admin', '/users');
      expect((await page.request.put(`${API_URL}/admin/users/${person.id}`, { data: { jobTitle: 'Product Owner' } })).status()).toBe(200);
      await app.signOut();
      await signInAs({ email: person.email, password: person.password });
      await expect(page.getByTestId('header-person-title')).toHaveText('Product Owner');
      expect((await page.request.put(`${API_URL}/admin/users/${person.id}`, { data: { jobTitle: 'Chief' } })).status()).toBe(403);
    } finally {
      await deleteFixtureUser(person.id);
    }
  });

  test('HDR-05 phone: company initials only; name, title and sign out in the account menu', { tag: [TAG.role('viewer')] }, async ({ signInAs, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAs('viewer');
    await expect(page.getByTestId('company-badge')).toContainText('NT');
    await expect(page.getByTestId('header-person')).toBeHidden();
    await page.getByTestId('account-menu-button').click();
    const menu = page.getByRole('menu', { name: 'Account' });
    await expect(menu).toContainText('Viewer');
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await menu.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});

test.describe('Navigation entries follow the access policy', { tag: [TAG.area('navigation')] }, () => {
  test('HDR-06 TV mode is in everyone\'s navigation and opens with a team', { tag: [TAG.role('viewer')] }, async ({ signInAs, page, app }) => {
    await signInAs('viewer');
    await app.go('nav-tv');
    await expect(page.getByTestId('tv-mode')).toBeVisible();
    await expect(page.getByTestId('tv-team-name')).toHaveText(DEMO.leadTeam.name);
  });
});
