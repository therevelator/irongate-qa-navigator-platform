import { test, expect, TAG } from '../support/fixtures';
import { sql } from '../support/db';
import { signInWithForm } from '../support/auth';

/**
 * LIVE-UI-01: a company in live operation (companies.settings.liveDataOnly, set by platform support in the
 * operator panel; server/lib/liveData.ts) is not offered the page for typing metrics, nor the modules no
 * connected tool feeds (Performance, Developer productivity): not in the navigation, and their addresses
 * answer "You don't have access". With the setting off they are there as before.
 */
test.describe('Live data only', { tag: [TAG.area('admin')] }, () => {
  test('LIVE-UI-01 typed-metric pages are offered only while the company is not in live operation', async ({ freshCompany, page, app }) => {
    await page.goto('/');
    await signInWithForm(page, { email: freshCompany.email, password: freshCompany.password });
    await expect(page.getByTestId('nav-manual-metrics')).toHaveCount(1, { timeout: 30000 });
    await expect(page.getByTestId('nav-performance-metrics')).toHaveCount(1);
    await expect(page.getByTestId('nav-developer-productivity')).toHaveCount(1);
    await app.signOut();

    await sql(`UPDATE companies SET settings = COALESCE(settings, '{}'::jsonb) || '{"liveDataOnly": true}'::jsonb WHERE id = $1`, [freshCompany.id]);
    await signInWithForm(page, { email: freshCompany.email, password: freshCompany.password });
    await expect(page.getByTestId('nav-admin')).toHaveCount(1, { timeout: 30000 });
    await expect(page.getByTestId('nav-manual-metrics')).toHaveCount(0);
    await expect(page.getByTestId('nav-performance-metrics')).toHaveCount(0);
    await expect(page.getByTestId('nav-developer-productivity')).toHaveCount(0);
    // The modules fed by raw data stay.
    await expect(page.getByTestId('nav-flaky-test-intelligence')).toHaveCount(1);
    await expect(page.getByTestId('nav-pipeline-visualization')).toHaveCount(1);

    await page.goto('/manual-metrics');
    await expect(page.getByTestId('access-denied')).toContainText("You don't have access to Manual metrics.", { timeout: 30000 });
  });
});
