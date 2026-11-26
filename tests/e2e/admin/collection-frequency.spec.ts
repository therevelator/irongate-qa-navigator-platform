import { test, expect, TAG } from '../support/fixtures';

/**
 * Collection frequency (Update frequency page → "How often data is collected") and the page tools added with it:
 * the team page's sections and "Download PDF".
 *
 *   COLF-01  a new company: every team reads on the default; choosing a release rhythm pre-fills the recommended
 *            intervals; they can be changed, saved, and changed again later; the onboarding step ticks
 *   SEC-01   the team page shows one section at a time; "Everything" shows all; the choice is remembered
 *   PDF-01   "Download PDF" is in the top bar of every page and prints the page with every section shown
 */
test.describe('Collection frequency, page sections and Download PDF', { tag: ['@area:admin'] }, () => {
  test.describe.configure({ mode: 'default' });

  test('COLF-01 recommended intervals are pre-filled, editable now and later', { tag: [TAG.role('admin')] }, async ({ freshCompany, signInAs, page }) => {
    await signInAs(freshCompany, '/metric-intervals');
    const card = page.getByTestId('collection-schedule');
    await expect(card).toBeVisible();
    await expect(card).toContainText('0 of');
    const team = card.getByTestId('collection-team').filter({ hasText: freshCompany.teamName });
    await expect(team).toContainText('Default: everything every 15 minutes');
    await team.locator('button').first().click();
    const form = team.getByTestId('collection-form');
    // A team that was never set up starts from the weekly recommendation.
    await expect(form.getByTestId('collection-cadence')).toHaveValue('weekly');
    await expect(form.getByTestId('collection-interval-ci')).toHaveValue('60');
    await expect(form).toContainText('These are our recommended intervals for that rhythm.');
    // Monthly releases: pipelines once a day, incidents and deployments still every hour.
    await form.getByTestId('collection-cadence').selectOption('monthly');
    await expect(form.getByTestId('collection-interval-ci')).toHaveValue('1440');
    await expect(form.getByTestId('collection-interval-delivery')).toHaveValue('60');
    // Changed by hand: said so, and "Back to recommended" restores it.
    await form.getByTestId('collection-interval-work').selectOption('240');
    await expect(form).toContainText('Changed from our recommendation.');
    await form.getByTestId('collection-reset').click();
    await expect(form.getByTestId('collection-interval-work')).toHaveValue('1440');
    await form.getByTestId('collection-interval-work').selectOption('240');
    await form.getByTestId('collection-save').click();
    await expect(page.getByText(`Collection frequency of ${freshCompany.teamName} saved`)).toBeVisible();
    await expect(team).toContainText('Monthly or less often');
    await expect(team).toContainText('issues every 4 hours');
    // Later: reopen, the saved values are there, change one again.
    await page.reload();
    const again = page.getByTestId('collection-team').filter({ hasText: freshCompany.teamName });
    await again.locator('button').first().click();
    await expect(again.getByTestId('collection-interval-work')).toHaveValue('240');
    await again.getByTestId('collection-interval-ci').selectOption('720');
    await again.getByTestId('collection-save').click();
    await expect(again).toContainText('Pipelines every 12 hours');
    // The onboarding step is done.
    await page.goto('/');
    await expect(page.getByTestId('onboarding-step-collection')).toHaveAttribute('data-done', 'true');
  });

  test('SEC-01 the team page shows one section at a time', { tag: [TAG.role('admin')] }, async ({ page, signInAs }) => {
    await signInAs('admin');
    await page.getByTestId('team-card').first().click();
    const tabs = page.getByTestId('section-switch');
    await expect(tabs).toBeVisible();
    // The tests start with "Everything" chosen (playwright.config.ts); a person starts on the first section.
    await expect(page.getByTestId('section-tab-all')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('section-tab-recommendations').click();
    const panel = (id: string) => page.locator(`[data-section="${id}"]`);
    // Only "Recommendations and actions" is shown under the headline scores.
    await expect(page.getByTestId('section-tab-recommendations')).toHaveAttribute('aria-selected', 'true');
    await expect(panel('recommendations')).toBeVisible();
    for (const id of ['people', 'kpis', 'evidence']) await expect(panel(id)).toBeHidden();
    await page.getByTestId('section-tab-kpis').click();
    await expect(panel('kpis')).toBeVisible();
    await expect(panel('recommendations')).toBeHidden();
    await page.getByTestId('section-tab-all').click();
    for (const id of ['recommendations', 'people', 'kpis', 'evidence']) await expect(panel(id)).toBeVisible();
    // The choice is remembered.
    await page.getByTestId('section-tab-people').click();
    await page.getByTestId('back-to-dashboard').click();
    await page.getByTestId('team-card').nth(1).click();
    await expect(page.getByTestId('section-tab-people')).toHaveAttribute('aria-selected', 'true');
    await expect(panel('people')).toBeVisible();
    await expect(panel('kpis')).toBeHidden();
  });

  test('PDF-01 Download PDF prints the whole page with every section shown', { tag: [TAG.role('admin')] }, async ({ page, signInAs }) => {
    await signInAs('admin');
    await expect(page.getByTestId('download-page-pdf')).toBeVisible();
    await page.getByTestId('team-card').first().click();
    await expect(page.getByTestId('section-switch')).toBeVisible();
    await page.getByTestId('section-tab-recommendations').click();
    // What the print dialog sees: every section, no navigation, the print header with the logo.
    await page.evaluate(() => { (window as any).__printed = null; window.print = () => {
      (window as any).__printed = { theme: document.documentElement.getAttribute('data-theme'), title: document.title, printing: document.documentElement.getAttribute('data-printing') };
    }; });
    await page.getByTestId('download-page-pdf').click();
    await expect.poll(() => page.evaluate(() => (window as any).__printed)).not.toBeNull();
    const printed = await page.evaluate(() => (window as any).__printed);
    expect(printed.theme).toBe('light');
    expect(printed.printing).toBe('true');
    expect(printed.title).toMatch(/^QE Navigator - .+ - \d{4}-\d{2}-\d{2}$/);
    await page.emulateMedia({ media: 'print' });
    for (const id of ['recommendations', 'people', 'kpis', 'evidence']) await expect(page.locator(`[data-section="${id}"]`)).toBeVisible();
    await expect(page.getByTestId('print-header')).toBeVisible();
    await expect(page.getByTestId('section-switch')).toBeHidden();
    await expect(page.locator('#app-navigation')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    // Afterwards the page is as it was.
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-printing'))).toBeNull();
    await expect(page.locator('[data-section="kpis"]')).toBeHidden();
  });
});
