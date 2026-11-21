import { test, expect, TAG } from '../support/fixtures';
import { API_URL } from '../support/env';
import { uid } from '../support/ids';

/**
 * A new organisation's first steps end to end (fresh organisation): the onboarding checklist ticks
 * each step from the real state; an API key is created (shown once), KPIs are sent with it through
 * the ingestion API, the Ingestion log shows the request and a rejected one with its reason, the
 * key is revoked and then refused. Also the Sample data panel (refused in a real company; the enabled
 * path is stubbed).
 */

test.describe('Onboarding, API keys and ingestion', { tag: [TAG.area('onboarding'), TAG.area('admin')] }, () => {
  test('ONB-01 the checklist follows the real state as the organisation is set up', { tag: [TAG.smoke, TAG.role('admin')] }, async ({ freshCompany, signInAs, page, app }) => {
    await signInAs(freshCompany);
    const list = page.getByTestId('onboarding-checklist');
    await expect(list).toBeVisible();
    for (const k of ['departments', 'teams']) await expect(page.getByTestId(`onboarding-step-${k}`)).toHaveAttribute('data-done', 'true');
    for (const k of ['people', 'targets', 'data']) await expect(page.getByTestId(`onboarding-step-${k}`)).toHaveAttribute('data-done', 'false');
    await expect(page.getByTestId('onboarding-progress')).toHaveText('2 of 5 steps done');

    // Invite people -> the Users page; an invitation ticks the step.
    await page.getByTestId('onboarding-step-people').getByRole('button').click();
    await expect(app.title).toHaveText('Users');
    await page.getByTestId('invite-user-btn').click();
    await page.getByTestId('invite-email').fill(`${uid('onb')}@${freshCompany.email.split('@')[1]}`);
    await page.getByTestId('invite-role').selectOption('viewer');
    await page.getByTestId('invite-submit').click();
    await expect(page.getByTestId('invite-link')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await app.go('nav-dashboard', 'Overview');
    await expect(page.getByTestId('onboarding-step-people')).toHaveAttribute('data-done', 'true');
    await expect(page.getByTestId('onboarding-progress')).toHaveText('3 of 5 steps done');
  });

  test('ONB-02 hiding the checklist and showing it again', async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany);
    await page.getByTestId('onboarding-dismiss').click();
    await expect(page.getByTestId('onboarding-checklist')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('onboarding-checklist')).toHaveCount(0);
  });

  test('ING-01 an API key is shown once, sends KPIs, appears in the Ingestion log, and is refused after revoking', { tag: [TAG.smoke, TAG.role('admin')] }, async ({ freshCompany, signInAs, page, request, app }) => {
    await signInAs(freshCompany, '/admin-panel');
    const name = `CI key ${uid().slice(-6)}`;
    await page.getByPlaceholder('Key name, e.g. Jenkins production').fill(name);
    await page.getByRole('button', { name: 'Create key' }).click();
    const created = page.getByTestId('api-key-created');
    await expect(created).toContainText(`Copy the key for “${name}” now. It will not be shown again.`);
    const key = (await created.locator('code').innerText()).trim();
    expect(key).toMatch(/^igk_/);

    const ok = await request.post(`${API_URL}/ingest/kpis`, {
      headers: { Authorization: `Bearer ${key}` },
      data: { teamId: freshCompany.teamId, source: 'ci', metrics: { test_coverage: 81.5, defect_escape_rate: 3 } },
    });
    expect(ok.status(), await ok.text()).toBeLessThan(300);
    const bad = await request.post(`${API_URL}/ingest/kpis`, {
      headers: { Authorization: `Bearer ${key}` },
      data: { teamId: freshCompany.teamId, source: 'ci', metrics: { test_coverage: 180 } },
    });
    expect(bad.status()).toBe(400);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText(key)).toHaveCount(0);

    await app.go('nav-ingestion-log', 'Ingestion log');
    await expect(page.getByTestId('ingestion-entry').first()).toBeVisible();
    await expect(page.getByTestId('ingestion-entries')).toContainText(/rejected/i);
    await expect(page.getByTestId('ingestion-entries')).toContainText(/written|accepted|ok/i);

    await app.go('nav-dashboard', 'Overview');
    await expect(page.getByTestId('onboarding-step-data')).toHaveAttribute('data-done', 'true');

    await app.go('nav-admin', 'Admin console');
    const row = page.getByRole('row', { name: new RegExp(name) });
    await row.getByRole('button', { name: 'Revoke' }).click();
    await row.getByRole('button', { name: 'Cancel' }).click();
    await expect(row).toContainText('Active');
    await row.getByRole('button', { name: 'Revoke' }).click();
    await row.getByRole('button', { name: 'Confirm revoke' }).click();
    await expect(row).toContainText('Revoked');
    const refused = await request.post(`${API_URL}/ingest/kpis`, {
      headers: { Authorization: `Bearer ${key}` }, data: { teamId: freshCompany.teamId, source: 'ci', metrics: { test_coverage: 80 } },
    });
    expect(refused.status()).toBe(401);
  });

  test('ING-02 a key without a name cannot be created; a manager has no API keys', { tag: [TAG.negative, TAG.role('manager')] }, async ({ freshCompany, signInAs, page, app }) => {
    await signInAs(freshCompany, '/admin-panel');
    await expect(page.getByRole('button', { name: 'Create key' })).toBeDisabled();
    await page.getByPlaceholder('Key name, e.g. Jenkins production').fill('   ');
    await expect(page.getByRole('button', { name: 'Create key' })).toBeDisabled();
    await app.signOut();
    await signInAs('manager', '/admin-panel');
    await expect(page.getByTestId('admin-panel')).toBeVisible();
    await expect(page.getByPlaceholder('Key name, e.g. Jenkins production')).toHaveCount(0);
  });

  test('ING-03 a manager sees the ingestion log of their departments; an engineer is refused', { tag: [TAG.role('manager'), TAG.role('engineer'), TAG.negative] }, async ({ signInAs, page, app }) => {
    await signInAs('manager', '/ingestion-log');
    await expect(page.getByTestId('ingestion-log')).toBeVisible();
    await app.signOut();
    await signInAs('engineer');
    const res = await page.request.get(`${API_URL}/ingestion-log`);
    expect(res.status()).toBe(403);
  });
});

test.describe('Sample (demo) data controls', { tag: [TAG.area('demo-data')] }, () => {
  // A real company never gets generated rows from its own super admin (server/lib/sampleCompany.ts):
  // the panel says so and the button is disabled, whatever ENABLE_SYNTHETIC_DATA says.
  test('DEMO-01 in a real company the panel says sample data is only for the sample company and the button is disabled', { tag: [TAG.role('admin')] }, async ({ signInAs, page }) => {
    await signInAs('admin', '/admin-panel');
    await expect(page.getByTestId('load-sample-data')).toBeDisabled();
    await expect(page.getByText(/only generated in the sample company, never in a real one/).first()).toBeVisible();
    const res = await page.request.post(`${API_URL}/analytics/seed-data`);
    expect(res.status()).toBe(403);
  });

  test('DEMO-02 when enabled, loading sample data reports the result and lists the logins (stubbed server)', { tag: [TAG.role('admin')] }, async ({ signInAs, page }) => {
    let seeded = false;
    await page.route(`${API_URL}/analytics/seed-data/status`, (r) => r.fulfill({ json: {
      enabled: true, message: null, seeded, companyName: 'Northwind Payments (Sample data)', teams: 10, users: 40,
      logins: seeded ? [{ role: 'super_admin', email: 'olivia.bennett@northwind.example', name: 'Olivia Bennett' }] : [], password: 'demo123', ownCompany: { teams: 7, lacking: 0 },
    } }));
    await page.route(`${API_URL}/analytics/seed-data`, (r) => { seeded = true; return r.fulfill({ json: { message: 'Sample data loaded: 10 teams, 40 users.' } }); });
    await signInAs('admin', '/admin-panel');
    await page.getByTestId('load-sample-data').click();
    await expect(page.getByRole('status').filter({ hasText: 'Sample data loaded: 10 teams, 40 users.' })).toBeVisible();
    await expect(page.getByText('olivia.bennett@northwind.example')).toBeVisible();
    await expect(page.getByTestId('load-sample-data')).toHaveText('Load sample data again (adds only missing rows)');
  });

  test('DEMO-03 a failure to load sample data is reported', { tag: [TAG.negative] }, async ({ signInAs, page }) => {
    await page.route(`${API_URL}/analytics/seed-data/status`, (r) => r.fulfill({ json: {
      enabled: true, message: null, seeded: false, companyName: 'Northwind Payments (Sample data)', teams: 10, users: 40, logins: [], password: 'demo123', ownCompany: null,
    } }));
    await page.route(`${API_URL}/analytics/seed-data`, (r) => r.fulfill({ status: 500, json: { error: 'Seeding failed', requestId: 'rid-seed' } }));
    await signInAs('admin', '/admin-panel');
    await page.getByTestId('load-sample-data').click();
    await expect(page.getByRole('alert').filter({ hasText: 'Seeding failed' })).toBeVisible();
  });

  test('DEMO-04 a manager has no sample data controls', { tag: [TAG.negative, TAG.role('manager')] }, async ({ signInAs, page }) => {
    await signInAs('manager', '/admin-panel');
    await expect(page.getByTestId('admin-panel')).toBeVisible();
    await expect(page.getByTestId('load-sample-data')).toHaveCount(0);
  });
});
